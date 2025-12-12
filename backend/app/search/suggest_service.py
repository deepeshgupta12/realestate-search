from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.core.es import get_es
from app.core.config import ELASTIC_INDEX
from app.search.normalize import normalize_query

# Bucketing rules (can evolve)
LOCATION_TYPES = {"city", "micromarket", "locality", "listing_page", "locality_overview"}
PROJECT_TYPES = {"project"}
BUILDER_TYPES = {"builder"}
RATE_TYPES = {"rate_page"}
PDP_TYPES = {"property_pdp"}

def _extract_did_you_mean(suggest_block: Dict[str, Any], original: str) -> Optional[str]:
    """
    Elasticsearch term suggester returns token-level corrections.
    We'll produce a simple corrected string by applying top suggestions.
    """
    if not suggest_block:
        return None

    original_tokens = original.split()
    tokens = original_tokens[:]

    # suggest structure: suggest["did_you_mean"] -> list[entry] where entry has "options"
    entries = suggest_block.get("did_you_mean", [])
    for i, entry in enumerate(entries):
        opts = entry.get("options") or []
        if not opts:
            continue
        top = opts[0]
        text = top.get("text")
        if not text:
            continue

        # Replace the token that ES thinks is wrong, if present
        wrong = entry.get("text")
        if wrong and wrong in tokens:
            idx = tokens.index(wrong)
            tokens[idx] = text

    candidate = " ".join(tokens).strip()
    if not candidate or candidate.lower() == original.lower():
        return None
    return candidate

def _group_hits(
    hits: List[Dict[str, Any]],
    city_id: Optional[str],
    per_group: Dict[str, int],
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Group by entity type into UI-friendly buckets.
    City scoping:
      - If city_id provided: keep items matching city_id OR global items with empty city_id.
    """
    groups: Dict[str, List[Dict[str, Any]]] = {
        "locations": [],
        "projects": [],
        "builders": [],
        "rate_pages": [],
        "property_pdps": [],
    }

    def city_ok(doc: Dict[str, Any]) -> bool:
        if not city_id:
            return True
        doc_city_id = (doc.get("city_id") or "").strip()
        return (doc_city_id == city_id) or (doc_city_id == "")

    for h in hits:
        src = h.get("_source", {}) or {}
        if not city_ok(src):
            continue

        et = src.get("entity_type")
        item = {
            "id": src.get("id"),
            "entity_type": et,
            "name": src.get("name"),
            "city": src.get("city"),
            "city_id": src.get("city_id"),
            "parent_name": src.get("parent_name"),
            "canonical_url": src.get("canonical_url"),
            "score": h.get("_score"),
        }

        if et in LOCATION_TYPES and len(groups["locations"]) < per_group["locations"]:
            groups["locations"].append(item)
        elif et in PROJECT_TYPES and len(groups["projects"]) < per_group["projects"]:
            groups["projects"].append(item)
        elif et in BUILDER_TYPES and len(groups["builders"]) < per_group["builders"]:
            groups["builders"].append(item)
        elif et in RATE_TYPES and len(groups["rate_pages"]) < per_group["rate_pages"]:
            groups["rate_pages"].append(item)
        elif et in PDP_TYPES and len(groups["property_pdps"]) < per_group["property_pdps"]:
            groups["property_pdps"].append(item)

        # Stop early if all buckets full
        if all(len(groups[k]) >= per_group[k] for k in per_group):
            break

    return groups

def suggest(q: str, city_id: Optional[str] = None, limit: int = 10) -> Dict[str, Any]:
    """
    Autocomplete suggestions using:
      - search_as_you_type fields (bool_prefix)
      - fuzzy matching
      - popularity tie-breaker
      - term suggester for did-you-mean
    """
    q_norm = normalize_query(q)
    if not q_norm:
        return {
            "q": q,
            "normalized_q": q_norm,
            "did_you_mean": None,
            "groups": {"locations": [], "projects": [], "builders": [], "rate_pages": [], "property_pdps": []},
        }

    # We fetch more than needed then group + cap by buckets
    fetch_size = max(30, limit * 5)

    # NOTE: completion suggester doesn't support filtering without contexts.
    # We'll use bool_prefix over search_as_you_type, which is filterable + fast.
    body: Dict[str, Any] = {
        "size": fetch_size,
        "_source": [
            "id", "entity_type", "name", "aliases", "city", "city_id",
            "parent_name", "canonical_url", "popularity_score", "status"
        ],
        "query": {
            "bool": {
                "filter": [
                    {"term": {"status": "active"}},
                ],
                "must": [
                    {
                        "multi_match": {
                            "query": q_norm,
                            "type": "bool_prefix",
                            "fields": [
                                "name_sayt",
                                "name_sayt._2gram",
                                "name_sayt._3gram",
                                "aliases",
                                "name",
                            ],
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
        "suggest": {
            "text": q_norm,
            "did_you_mean": {
                "term": {
                    "field": "name",
                    "suggest_mode": "popular",
                    "size": 3,
                }
            }
        },
    }

    es = get_es()
    resp = es.search(index=ELASTIC_INDEX, **body)

    hits = (resp.get("hits", {}) or {}).get("hits", []) or []
    did_you_mean = _extract_did_you_mean(resp.get("suggest", {}) or {}, q_norm)

    # Per-bucket caps (tune later)
    per_group = {
        "locations": min(6, limit),
        "projects": min(5, limit),
        "builders": min(4, limit),
        "rate_pages": min(4, limit),
        "property_pdps": min(4, limit),
    }
    groups = _group_hits(hits, city_id=city_id, per_group=per_group)

    return {
        "q": q,
        "normalized_q": q_norm,
        "did_you_mean": did_you_mean,
        "groups": groups,
    }
