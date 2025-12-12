from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.core.es import get_es
from app.core.config import ELASTIC_INDEX
from app.search.normalize import normalize_query
from app.search.suggest_service import (
    _extract_did_you_mean,  # reuse
    _group_hits,            # reuse
)

def _city_filter(city_id: Optional[str]) -> List[Dict[str, Any]]:
    if not city_id:
        return []
    # City scoped or global docs (city_id == "")
    return [{
        "bool": {
            "should": [
                {"term": {"city_id": city_id}},
                {"term": {"city_id": ""}},
            ],
            "minimum_should_match": 1
        }
    }]

def _base_source_fields() -> List[str]:
    return [
        "id", "entity_type", "name", "aliases", "city", "city_id",
        "parent_name", "canonical_url", "popularity_score", "status"
    ]

def _primary_query(q_norm: str, city_id: Optional[str], fetch_size: int) -> Dict[str, Any]:
    return {
        "size": fetch_size,
        "_source": _base_source_fields(),
        "query": {
            "bool": {
                "filter": [{"term": {"status": "active"}}] + _city_filter(city_id),
                "must": [{
                    "multi_match": {
                        "query": q_norm,
                        "type": "best_fields",
                        "fields": ["name^5", "aliases^3", "name_sayt^2"],
                        "fuzziness": "AUTO",
                        "operator": "AND",
                    }
                }],
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
        }
    }

def _relaxed_query(q_norm: str, city_id: Optional[str], fetch_size: int) -> Dict[str, Any]:
    # Relaxations:
    # - operator OR
    # - search_as_you_type bool_prefix
    # - lower field boosts
    return {
        "size": fetch_size,
        "_source": _base_source_fields(),
        "query": {
            "bool": {
                "filter": [{"term": {"status": "active"}}] + _city_filter(city_id),
                "must": [{
                    "multi_match": {
                        "query": q_norm,
                        "type": "bool_prefix",
                        "fields": [
                            "name_sayt",
                            "name_sayt._2gram",
                            "name_sayt._3gram",
                            "aliases^2",
                            "name^2",
                        ],
                        "fuzziness": "AUTO",
                        "operator": "OR",
                    }
                }],
            }
        },
        "sort": [
            {"_score": {"order": "desc"}},
            {"popularity_score": {"order": "desc", "missing": 0}},
        ],
    }

def _trending(city_id: Optional[str], limit: int = 10) -> List[Dict[str, Any]]:
    es = get_es()
    body: Dict[str, Any] = {
        "size": limit,
        "_source": ["id", "entity_type", "name", "city", "city_id", "parent_name", "canonical_url", "popularity_score"],
        "query": {
            "bool": {
                "filter": [{"term": {"status": "active"}}] + _city_filter(city_id)
            }
        },
        "sort": [{"popularity_score": {"order": "desc", "missing": 0}}],
    }
    resp = es.search(index=ELASTIC_INDEX, **body)
    hits = (resp.get("hits", {}) or {}).get("hits", []) or []
    out = []
    for h in hits:
        src = h.get("_source", {}) or {}
        out.append({
            "id": src.get("id"),
            "entity_type": src.get("entity_type"),
            "name": src.get("name"),
            "city": src.get("city"),
            "city_id": src.get("city_id"),
            "parent_name": src.get("parent_name"),
            "canonical_url": src.get("canonical_url"),
            "popularity_score": src.get("popularity_score"),
        })
    return out

def search(q: str, city_id: Optional[str] = None, limit: int = 20) -> Dict[str, Any]:
    q_norm = normalize_query(q)
    if not q_norm:
        return {
            "q": q,
            "normalized_q": q_norm,
            "did_you_mean": None,
            "groups": {"locations": [], "projects": [], "builders": [], "rate_pages": [], "property_pdps": []},
            "fallbacks": {"reason": "empty", "relaxed_used": False, "trending": _trending(city_id, 10)},
        }

    # Fetch more than needed; grouping will cap.
    fetch_size = max(60, limit * 5)

    es = get_es()
    resp = es.search(index=ELASTIC_INDEX, **_primary_query(q_norm, city_id, fetch_size))
    hits = (resp.get("hits", {}) or {}).get("hits", []) or []
    did_you_mean = _extract_did_you_mean(resp.get("suggest", {}) or {}, q_norm)

    per_group = {
        "locations": 10,
        "projects": 10,
        "builders": 10,
        "rate_pages": 10,
        "property_pdps": 10,
    }
    groups = _group_hits(hits, city_id=city_id, per_group=per_group)

    total_returned = sum(len(v) for v in groups.values())
    relaxed_used = False

    # If nothing returned, try relaxed query
    if total_returned == 0:
        relaxed = es.search(index=ELASTIC_INDEX, **_relaxed_query(q_norm, city_id, fetch_size))
        hits2 = (relaxed.get("hits", {}) or {}).get("hits", []) or []
        groups = _group_hits(hits2, city_id=city_id, per_group=per_group)
        total_returned = sum(len(v) for v in groups.values())
        relaxed_used = True

    fallbacks: Dict[str, Any] = {
        "relaxed_used": relaxed_used,
        "trending": [],
    }
    if total_returned == 0:
        fallbacks["reason"] = "no_results"
        fallbacks["trending"] = _trending(city_id, 10)
    else:
        fallbacks["reason"] = None

    return {
        "q": q,
        "normalized_q": q_norm,
        "did_you_mean": did_you_mean,
        "groups": groups,
        "fallbacks": fallbacks,
    }
