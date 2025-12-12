from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.core.es import get_es
from app.core.config import ELASTIC_INDEX
from app.search.normalize import normalize_query

# Entity types that are allowed to directly redirect
REDIRECT_TYPES = {
    "city",
    "micromarket",
    "locality",
    "listing_page",
    "locality_overview",
    "rate_page",
    "project",
    "property_pdp",
    "builder",
}

# Lightweight "constraint-heavy" detection (V1 will be far better)
CONSTRAINT_TOKENS = {
    "bhk", "bedroom", "ready", "rtm", "uc", "under", "below", "above", "budget",
    "lakh", "lac", "cr", "crore", "rent", "rental", "resale", "buy", "sale",
    "furnished", "semi-furnished", "unfurnished", "possession", "new", "projects",
}

def _looks_constraint_heavy(q: str) -> bool:
    toks = q.lower().split()
    hits = sum(1 for t in toks if t in CONSTRAINT_TOKENS)
    # If query length is large and includes some constraint tokens -> SERP
    return (len(toks) >= 4 and hits >= 1) or (hits >= 2)

def _score_gap(top_score: float, second_score: float) -> float:
    if top_score <= 0:
        return 0.0
    return (top_score - second_score) / top_score

def _make_candidate(hit: Dict[str, Any]) -> Dict[str, Any]:
    src = hit.get("_source", {}) or {}
    return {
        "id": src.get("id"),
        "entity_type": src.get("entity_type"),
        "name": src.get("name"),
        "city": src.get("city"),
        "city_id": src.get("city_id"),
        "parent_name": src.get("parent_name"),
        "canonical_url": src.get("canonical_url"),
        "score": hit.get("_score"),
    }

def resolve(q: str, city_id: Optional[str] = None, context_url: Optional[str] = None) -> Dict[str, Any]:
    q_norm = normalize_query(q)
    if not q_norm:
        return {"action": "serp", "query": q, "normalized_query": q_norm, "reason": "empty"}

    # If query looks like constraints, default to SERP (V1 will parse and build DSE URLs)
    if _looks_constraint_heavy(q_norm):
        return {"action": "serp", "query": q, "normalized_query": q_norm, "reason": "constraint_heavy"}

    es = get_es()

    body: Dict[str, Any] = {
        "size": 8,
        "_source": ["id", "entity_type", "name", "city", "city_id", "parent_name", "canonical_url", "status", "popularity_score"],
        "query": {
            "bool": {
                "filter": [{"term": {"status": "active"}}],
                "must": [
                    {
                        "multi_match": {
                            "query": q_norm,
                            "fields": ["name^4", "aliases^3", "name_sayt^2"],
                            "type": "best_fields",
                            "fuzziness": "AUTO",
                        }
                    }
                ],
            }
        },
        "sort": [
            {"_score": {"order": "desc"}},
            {"popularity_score": {"order": "desc", "missing": 0}},
        ],
    }

    resp = es.search(index=ELASTIC_INDEX, **body)
    hits = (resp.get("hits", {}) or {}).get("hits", []) or []
    if not hits:
        return {"action": "serp", "query": q, "normalized_query": q_norm, "reason": "no_hits"}

    # Apply city scoping (keep same city_id or global)
    def city_ok(src: Dict[str, Any]) -> bool:
        if not city_id:
            return True
        doc_city_id = (src.get("city_id") or "").strip()
        return (doc_city_id == city_id) or (doc_city_id == "")

    filtered: List[Dict[str, Any]] = []
    for h in hits:
        src = h.get("_source", {}) or {}
        if not city_ok(src):
            continue
        if src.get("entity_type") not in REDIRECT_TYPES:
            continue
        filtered.append(h)

    if not filtered:
        return {"action": "serp", "query": q, "normalized_query": q_norm, "reason": "no_city_scoped_hits"}

    top = filtered[0]
    top_score = float(top.get("_score") or 0.0)
    second_score = float(filtered[1].get("_score") or 0.0) if len(filtered) > 1 else 0.0
    gap = _score_gap(top_score, second_score)

    # Thresholds (tunable; safe defaults)
    # - If top score is strong and gap is meaningful -> redirect
    # - If top score strong but gap weak -> disambiguate
    # - Else -> SERP
    strong = top_score >= 5.0
    gap_ok = gap >= 0.18

    top_cand = _make_candidate(top)

    if strong and gap_ok:
        return {
            "action": "redirect",
            "query": q,
            "normalized_query": q_norm,
            "url": top_cand["canonical_url"],
            "match": top_cand,
            "debug": {"top_score": top_score, "second_score": second_score, "gap": gap},
        }

    # Disambiguate when we have multiple close candidates
    # choose up to 6 candidates above a relative score threshold
    candidates: List[Dict[str, Any]] = []
    min_rel = 0.75  # within 75% of top score
    for h in filtered[:8]:
        sc = float(h.get("_score") or 0.0)
        if top_score > 0 and (sc / top_score) >= min_rel:
            candidates.append(_make_candidate(h))

    if len(candidates) >= 2:
        return {
            "action": "disambiguate",
            "query": q,
            "normalized_query": q_norm,
            "candidates": candidates[:6],
            "debug": {"top_score": top_score, "second_score": second_score, "gap": gap},
        }

    # Fallback to SERP
    return {
        "action": "serp",
        "query": q,
        "normalized_query": q_norm,
        "reason": "low_confidence",
        "debug": {"top_score": top_score, "second_score": second_score, "gap": gap},
    }
