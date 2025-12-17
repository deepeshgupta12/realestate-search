from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

from elasticsearch import Elasticsearch
from fastapi import APIRouter, Body, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from urllib.parse import urlparse, unquote
import re

# -----------------------
# Config
# -----------------------
INDEX_NAME = os.getenv("ES_INDEX", "re_entities_v1")
ES_URL = os.getenv("ES_URL", "http://localhost:9200")

ES_USERNAME = os.getenv("ES_USERNAME")
ES_PASSWORD = os.getenv("ES_PASSWORD")

REQUEST_TIMEOUT = float(os.getenv("ES_REQUEST_TIMEOUT", "3.0"))


def get_es() -> Elasticsearch:
    kwargs: Dict[str, Any] = {
        "hosts": [ES_URL],
        "request_timeout": REQUEST_TIMEOUT,
    }
    if ES_USERNAME and ES_PASSWORD:
        kwargs["basic_auth"] = (ES_USERNAME, ES_PASSWORD)

    # local dev typically without TLS; keep warnings quiet if users enable TLS later
    kwargs["verify_certs"] = False
    kwargs["ssl_show_warn"] = False
    return Elasticsearch(**kwargs)


es = get_es()


# -----------------------
# Models
# -----------------------
class EntityOut(BaseModel):
    id: str
    entity_type: str
    name: str
    city: str = ""
    city_id: str = ""
    parent_name: str = ""
    canonical_url: str
    score: Optional[float] = None
    popularity_score: Optional[float] = None


class SuggestResponse(BaseModel):
    q: str
    normalized_q: str
    did_you_mean: Optional[str] = None
    groups: Dict[str, List[EntityOut]]
    fallbacks: Optional[Dict[str, Any]] = None


class ResolveResponse(BaseModel):
    action: str  # redirect | serp | disambiguate
    query: str
    normalized_query: str
    url: Optional[str] = None
    match: Optional[EntityOut] = None
    candidates: Optional[List[EntityOut]] = None
    reason: Optional[str] = None
    debug: Optional[Dict[str, Any]] = None


class TrendingResponse(BaseModel):
    city_id: Optional[str]
    items: List[EntityOut]


class ZeroStateResponse(BaseModel):
    city_id: Optional[str]
    recent_searches: List[str]
    trending_searches: List[EntityOut]
    trending_localities: List[EntityOut]
    popular_entities: List[EntityOut]


class AdminOk(BaseModel):
    ok: bool
    message: Optional[str] = None
    seeded: Optional[int] = None
    index_count: Optional[int] = None
    cluster_name: Optional[str] = None
    version: Optional[str] = None


class ParseResponse(BaseModel):
    q: str
    intent: Optional[str] = None  # buy | rent
    bhk: Optional[int] = None
    locality_hint: Optional[str] = None
    max_price: Optional[int] = None  # rupees
    max_rent: Optional[int] = None   # rupees/month
    currency: str = "INR"
    ok: bool = True


class EventOk(BaseModel):
    ok: bool = True
    query_id: Optional[str] = None


class SearchEventIn(BaseModel):
    query_id: str
    raw_query: str
    normalized_query: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: str


class ClickEventIn(BaseModel):
    query_id: str
    entity_id: str
    entity_type: str
    rank: int
    url: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: str


# -----------------------
# Helpers
# -----------------------
def normalize_q(q: str) -> str:
    return re.sub(r"\s+", " ", q.strip()).lower()


def is_constraint_heavy(q: str) -> bool:
    s = normalize_q(q)
    patterns = [
        r"\bunder\b", r"\bbelow\b", r"\bless than\b",
        r"\bbetween\b", r"\bto\b",
        r"\bbhk\b", r"\b1bhk\b", r"\b2bhk\b", r"\b3bhk\b", r"\b4bhk\b", r"\b5bhk\b",
        r"\brent\b", r"\brental\b",
        r"\bbuy\b", r"\bresale\b", r"\bsale\b",
        r"\b₹\b", r"\brs\b", r"\bl\b", r"\bcr\b", r"\bk\b",
    ]
    return any(re.search(p, s) for p in patterns)


def money_to_rupees(num: float, unit: str) -> int:
    unit = unit.lower()
    if unit in ("k",):
        return int(num * 1_000)
    if unit in ("l", "lac", "lakh"):
        return int(num * 100_000)
    if unit in ("cr", "crore"):
        return int(num * 10_000_000)
    return int(num)

URL_SCHEME_RE = re.compile(r"^https?://", re.IGNORECASE)

def extract_clean_path(raw_q: str) -> str | None:
    """
    Detect if query is a URL or slug-like path and extract a clean path that can match canonical_url in ES.
    Examples:
      - "https://example.com/pune/baner?x=1" -> "/pune/baner"
      - "/pune/baner/" -> "/pune/baner"
      - "pune/baner" -> "/pune/baner"
    Returns None if it doesn't look like a path/URL.
    """
    if not raw_q:
        return None

    q = raw_q.strip()
    if not q:
        return None

    # If it's a full URL, parse it and take the path
    if URL_SCHEME_RE.match(q):
        try:
            parsed = urlparse(q)
            path = parsed.path or ""
        except Exception:
            return None
    else:
        # If it contains spaces, it's not a clean URL/slug
        if " " in q:
            return None

        # If it starts with "/", treat as a path
        if q.startswith("/"):
            path = q
        else:
            # slug-like: must contain "/" to be considered a path candidate
            if "/" not in q:
                return None
            path = "/" + q

    # Decode URL-encoded chars and strip query/hash fragments if any leaked in
    path = unquote(path)
    path = path.split("?", 1)[0].split("#", 1)[0].strip()

    if not path.startswith("/"):
        path = "/" + path

    # Normalize trailing slash (except root)
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    # Avoid treating "/search" itself as a canonical entity (optional guard)
    if path in ("/search", "/disambiguate", "/go"):
        return None

    return path or None


def es_lookup_by_canonical_url(path: str):
    """
    Exact lookup in ES using canonical_url.
    Returns EntityOut (via hit_to_entity) or None.
    """
    if not path:
        return None

    body = {
        "size": 1,
        "query": {
            "bool": {
                "should": [
                    {"term": {"canonical_url": path}},
                    # in case mapping uses keyword subfield in your index
                    {"term": {"canonical_url.keyword": path}},
                ],
                "minimum_should_match": 1,
            }
        },
    }

    try:
        res = es.search(index=INDEX_NAME, body=body)
        hits = (res.get("hits") or {}).get("hits") or []
        if not hits:
            return None
        return hit_to_entity(hits[0])
    except Exception:
        return None

def parse_query(q: str) -> ParseResponse:
    s = normalize_q(q)

    intent = None
    if re.search(r"\brent\b|\brental\b", s):
        intent = "rent"
    elif re.search(r"\bbuy\b|\bresale\b|\bsale\b", s):
        intent = "buy"

    bhk = None
    m = re.search(r"\b([1-6])\s*bhk\b", s)
    if m:
        bhk = int(m.group(1))

    locality_hint = None
    m = re.search(r"\bin\s+([a-z0-9 \-]+?)(?:\s+\bunder\b|\s+\bbelow\b|\s+\bfor\b|\s+\bnear\b|$)", s)
    if m:
        locality_hint = m.group(1).strip()

    max_price = None
    max_rent = None

    m = re.search(r"\bunder\s+([0-9]+(?:\.[0-9]+)?)\s*(cr|crore|l|lac|lakh|k)\b", s)
    if m:
        value = float(m.group(1))
        unit = m.group(2)
        rupees = money_to_rupees(value, unit)
        if intent == "rent" or unit == "k":
            max_rent = rupees
        else:
            max_price = rupees

    return ParseResponse(
        q=q,
        intent=intent,
        bhk=bhk,
        locality_hint=locality_hint,
        max_price=max_price,
        max_rent=max_rent,
        ok=True,
    )


def build_mapping() -> Dict[str, Any]:
    return {
        "settings": {
            "analysis": {
                "normalizer": {
                    "lc": {"type": "custom", "filter": ["lowercase", "asciifolding"]}
                }
            }
        },
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "entity_type": {"type": "keyword"},
                "name": {"type": "text"},
                "name_norm": {"type": "keyword", "normalizer": "lc"},
                "city": {"type": "keyword"},
                "city_id": {"type": "keyword"},
                "parent_name": {"type": "keyword"},
                "canonical_url": {"type": "keyword"},
                "popularity_score": {"type": "float"},
            }
        }
    }


def seed_docs() -> List[Dict[str, Any]]:
    return [
        {
            "id": "builder_dlf", "entity_type": "builder", "name": "DLF",
            "name_norm": "dlf", "city": "", "city_id": "", "parent_name": "",
            "canonical_url": "/builders/dlf", "popularity_score": 95.0
        },
        {
            "id": "city_noida", "entity_type": "city", "name": "Noida",
            "name_norm": "noida", "city": "Noida", "city_id": "city_noida", "parent_name": "",
            "canonical_url": "/noida", "popularity_score": 90.0
        },
        {
            "id": "proj_godrej_woods", "entity_type": "project", "name": "Godrej Woods",
            "name_norm": "godrej woods", "city": "Noida", "city_id": "city_noida", "parent_name": "Sector 43",
            "canonical_url": "/projects/noida/godrej-woods", "popularity_score": 88.0
        },
        {
            "id": "city_pune", "entity_type": "city", "name": "Pune",
            "name_norm": "pune", "city": "Pune", "city_id": "city_pune", "parent_name": "",
            "canonical_url": "/pune", "popularity_score": 85.0
        },
        {
            "id": "loc_baner_pune", "entity_type": "locality", "name": "Baner",
            "name_norm": "baner", "city": "Pune", "city_id": "city_pune", "parent_name": "West Pune",
            "canonical_url": "/pune/baner", "popularity_score": 80.0
        },
        {
            "id": "mm_sector150_noida", "entity_type": "micromarket", "name": "Sector 150",
            "name_norm": "sector 150", "city": "Noida", "city_id": "city_noida", "parent_name": "Noida Expressway",
            "canonical_url": "/noida/sector-150", "popularity_score": 78.0
        },
        {
            "id": "rate_baner", "entity_type": "rate_page", "name": "Baner Property Rates",
            "name_norm": "baner property rates", "city": "Pune", "city_id": "city_pune", "parent_name": "Baner",
            "canonical_url": "/property-rates/pune/baner", "popularity_score": 60.0
        },
        {
            "id": "pdp_resale_1", "entity_type": "property_pdp", "name": "2 BHK Resale Apartment in Baner",
            "name_norm": "2 bhk resale apartment in baner", "city": "Pune", "city_id": "city_pune", "parent_name": "Baner",
            "canonical_url": "/pune/baner/resale/2-bhk-apartment-123", "popularity_score": 40.0
        },
    ]


def es_search_entities(q: str, limit: int, city_id: Optional[str]) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    nq = normalize_q(q)

    must: List[Dict[str, Any]] = []
    if city_id:
        must.append({"term": {"city_id": city_id}})

    body: Dict[str, Any] = {
        "size": limit,
        "query": {
            "bool": {
                "must": must,
                "should": [
                    {"match_phrase_prefix": {"name": {"query": q, "slop": 2}}},
                    {"match": {"name": {"query": q, "fuzziness": "AUTO"}}},
                    {"term": {"name_norm": nq}},
                ],
                "minimum_should_match": 1,
            }
        },
        "suggest": {
            "did_you_mean": {
                "text": q,
                "term": {"field": "name"}
            }
        }
    }

    res = es.search(index=INDEX_NAME, body=body)
    hits = res.get("hits", {}).get("hits", [])
    sugg = None
    try:
        opts = res.get("suggest", {}).get("did_you_mean", [])[0].get("options", [])
        if opts:
            sugg = opts[0].get("text")
    except Exception:
        sugg = None

    return hits, sugg


def hit_to_entity(hit: Dict[str, Any], for_trending: bool = False) -> EntityOut:
    src = hit.get("_source", {})
    score = hit.get("_score")
    return EntityOut(
        id=src.get("id", ""),
        entity_type=src.get("entity_type", ""),
        name=src.get("name", ""),
        city=src.get("city", "") or "",
        city_id=src.get("city_id", "") or "",
        parent_name=src.get("parent_name", "") or "",
        canonical_url=src.get("canonical_url", ""),
        score=None if for_trending else (float(score) if score is not None else None),
        popularity_score=float(src.get("popularity_score")) if src.get("popularity_score") is not None else None,
    )


def group_entities(entities: List[EntityOut]) -> Dict[str, List[EntityOut]]:
    groups = {
        "locations": [],
        "projects": [],
        "builders": [],
        "rate_pages": [],
        "property_pdps": [],
    }

    for e in entities:
        if e.entity_type in ("city", "micromarket", "locality", "listing_page", "locality_overview"):
            groups["locations"].append(e)
        elif e.entity_type in ("project",):
            groups["projects"].append(e)
        elif e.entity_type in ("builder", "developer"):
            groups["builders"].append(e)
        elif e.entity_type in ("rate_page",):
            groups["rate_pages"].append(e)
        elif e.entity_type in ("property_pdp",):
            groups["property_pdps"].append(e)

    return groups


def fetch_trending(city_id: Optional[str], limit: int) -> List[EntityOut]:
    if city_id:
        q = {
            "bool": {
                "should": [
                    {"term": {"city_id": city_id}},
                    {"term": {"city_id": ""}},
                ],
                "minimum_should_match": 1
            }
        }
    else:
        q = {"match_all": {}}

    res = es.search(
        index=INDEX_NAME,
        body={
            "size": limit,
            "query": q,
            "sort": [{"popularity_score": {"order": "desc"}}]
        }
    )
    hits = res.get("hits", {}).get("hits", [])
    return [hit_to_entity(h, for_trending=True) for h in hits]


def build_serp_url(
    q: str,
    city_id: str | None = None,
    qid: str | None = None,
    context_url: str | None = None,
) -> str:
    """
    Build a frontend SERP URL.
    Supports optional tracking params (qid/context_url) used by newer resolve() logic.
    """

    # Local import to avoid messing with your top-of-file imports if they differ.
    from urllib.parse import urlencode, quote_plus

    params: dict[str, str] = {"q": q}

    if city_id:
        params["city_id"] = city_id
    if qid:
        params["qid"] = qid
    if context_url:
        params["context_url"] = context_url

    return "/search?" + urlencode(params, quote_via=quote_plus)


# -----------------------
# Event logging (local dev)
# -----------------------
EVENTS_DIR = (Path(__file__).resolve().parents[1] / ".events")  # backend/.events


def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


# -----------------------
# App + Routers
# -----------------------
app = FastAPI(title="RealEstate Search API (Local)", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

admin = APIRouter()
search = APIRouter()
events = APIRouter()


@app.get("/health")
def health():
    return {"status": "ok"}


# -----------------------
# Admin
# -----------------------
@admin.get("/ping-es", response_model=AdminOk)
def ping_es():
    info = es.info()
    return AdminOk(
        ok=True,
        cluster_name=info.get("cluster_name"),
        version=info.get("version", {}).get("number"),
    )


@admin.post("/create-index", response_model=AdminOk)
def create_index():
    if es.indices.exists(index=INDEX_NAME):
        return AdminOk(ok=True, message=f"Index {INDEX_NAME} already exists")
    es.indices.create(index=INDEX_NAME, body=build_mapping())
    return AdminOk(ok=True, message=f"Created {INDEX_NAME}")


@admin.post("/seed", response_model=AdminOk)
def seed():
    if not es.indices.exists(index=INDEX_NAME):
        es.indices.create(index=INDEX_NAME, body=build_mapping())

    docs = seed_docs()
    for d in docs:
        es.index(index=INDEX_NAME, id=d["id"], document=d)

    es.indices.refresh(index=INDEX_NAME)
    count = es.count(index=INDEX_NAME).get("count", 0)
    return AdminOk(ok=True, seeded=len(docs), index_count=int(count))


# -----------------------
# Search
# -----------------------
@search.get("", response_model=SuggestResponse)
def search_serp(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    limit: int = 10,
):
    hits, did_you_mean = es_search_entities(q=q, limit=limit, city_id=city_id)
    entities = [hit_to_entity(h) for h in hits]
    groups = group_entities(entities)

    fallbacks: Dict[str, Any] = {"relaxed_used": False, "trending": [], "reason": None}
    if sum(len(v) for v in groups.values()) == 0:
        fallbacks["relaxed_used"] = True
        fallbacks["reason"] = "no_results"
        fallbacks["trending"] = fetch_trending(city_id=city_id, limit=8)

    return SuggestResponse(
        q=q,
        normalized_q=normalize_q(q),
        did_you_mean=did_you_mean,
        groups=groups,
        fallbacks={
            "relaxed_used": fallbacks["relaxed_used"],
            "trending": fallbacks["trending"],
            "reason": fallbacks["reason"],
        },
    )


@search.get("/suggest", response_model=SuggestResponse)
def suggest(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    limit: int = 10,
):
    hits, did_you_mean = es_search_entities(q=q, limit=limit, city_id=city_id)
    entities = [hit_to_entity(h) for h in hits]
    groups = group_entities(entities)

    fallbacks: Dict[str, Any] = {"relaxed_used": False, "trending": [], "reason": None}
    if sum(len(v) for v in groups.values()) == 0:
        fallbacks["relaxed_used"] = True
        fallbacks["reason"] = "no_results"
        fallbacks["trending"] = fetch_trending(city_id=city_id, limit=8)

    return SuggestResponse(
        q=q,
        normalized_q=normalize_q(q),
        did_you_mean=did_you_mean,
        groups=groups,
        fallbacks={
            "relaxed_used": fallbacks["relaxed_used"],
            "trending": fallbacks["trending"],
            "reason": fallbacks["reason"],
        },
    )


@search.get("/zero-state", response_model=ZeroStateResponse)
def zero_state(
    city_id: Optional[str] = None,
    limit: int = 8,
):
    trending = fetch_trending(city_id=city_id, limit=limit)
    loc_pool = fetch_trending(city_id=city_id, limit=max(limit * 2, 10))
    trending_localities = [e for e in loc_pool if e.entity_type in ("city", "locality", "micromarket")][: max(2, limit // 2)]
    return ZeroStateResponse(
        city_id=city_id,
        recent_searches=[],
        trending_searches=trending,
        trending_localities=trending_localities,
        popular_entities=trending,
    )


@search.get("/resolve", response_model=ResolveResponse)
def resolve(q: str, city_id: Optional[str] = None, context_url: Optional[str] = None):
    raw_q = q or ""
    nq = normalize_q(raw_q)

    # 0) Long-tail / clean URL resolution (NEW)
    clean_path = extract_clean_path(raw_q)
    if clean_path:
        url_match = es_lookup_by_canonical_url(clean_path)
        if url_match:
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=nq,
                url=url_match.canonical_url,
                match=url_match,
                candidates=None,
                reason="clean_url",
                debug={"clean_path": clean_path},
            )

    # 1) Constraint-heavy queries → SERP
    if is_constraint_heavy(raw_q):
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=nq,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            match=None,
            candidates=None,
            reason="constraint_heavy",
            debug=None,
        )

    # 2) Retrieve candidates
    hits, _dym = es_search_entities(q=raw_q, limit=10, city_id=city_id)
    if not hits:
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=nq,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            match=None,
            candidates=None,
            reason="no_results",
            debug=None,
        )

    entities = [hit_to_entity(h) for h in hits]

    # 3) Same-name disambiguation detection (exact name matches)
    exact_matches = [
        e for e in entities
        if normalize_q(e.name) == nq and e.city_id is not None
    ]

    # If we have multiple exact matches across different cities, disambiguate
    if len(exact_matches) >= 2:
        # City-scoped shortcut: if city_id provided and there is exactly one match for that city → redirect
        if city_id:
            scoped = [e for e in exact_matches if e.city_id == city_id]
            if len(scoped) == 1:
                return ResolveResponse(
                    action="redirect",
                    query=raw_q,
                    normalized_query=nq,
                    url=scoped[0].canonical_url,
                    match=scoped[0],
                    candidates=None,
                    reason="city_scoped_same_name",
                    debug={"city_id": city_id, "candidate_count": len(exact_matches)},
                )

        # Otherwise disambiguate (sorted by popularity)
        exact_matches_sorted = sorted(
            exact_matches,
            key=lambda x: float(x.popularity_score or 0.0),
            reverse=True,
        )
        return ResolveResponse(
            action="disambiguate",
            query=raw_q,
            normalized_query=nq,
            url=None,
            match=None,
            candidates=exact_matches_sorted,
            reason="same_name",
            debug={
                "candidate_count": len(exact_matches_sorted),
                "cities": sorted({(e.city_id or "") for e in exact_matches_sorted}),
            },
        )

    # 4) Confidence-based redirect vs SERP
    top = hits[0]
    second = hits[1] if len(hits) > 1 else None
    top_score = float(top.get("_score") or 0.0)
    second_score = float(second.get("_score") or 0.0) if second else 0.0
    gap = 1.0 if top_score <= 0 else (top_score - second_score) / max(top_score, 1e-9)

    match = hit_to_entity(top)

    # Tune-able thresholds (keep aligned with your existing behavior)
    if top_score >= 5.0 and gap >= 0.30:
        return ResolveResponse(
            action="redirect",
            query=raw_q,
            normalized_query=nq,
            url=match.canonical_url,
            match=match,
            candidates=None,
            reason="confident_top_hit",
            debug={"top_score": top_score, "second_score": second_score, "gap": gap},
        )

    return ResolveResponse(
        action="serp",
        query=raw_q,
        normalized_query=nq,
        url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
        match=None,
        candidates=None,
        reason="ambiguous",
        debug={"top_score": top_score, "second_score": second_score, "gap": gap},
    )
    
    # 2) GLOBAL lookup first to detect same-name collisions across cities
    global_hits, _ = es_search_entities(q=q, limit=10, city_id=None)
    if not global_hits:
        return ResolveResponse(
            action="serp",
            query=q,
            normalized_query=nq,
            url=build_serp_url(q, city_id),
            reason="no_results",
        )

    # candidates where name_norm == query norm (strong signal for “same-name”)
    same_name_hits: List[Dict[str, Any]] = []
    for h in global_hits:
        src = h.get("_source", {}) or {}
        name_norm = (src.get("name_norm") or "").strip().lower()
        if not name_norm:
            name_norm = normalize_q(str(src.get("name") or ""))
        if name_norm == nq:
            same_name_hits.append(h)

    same_name_candidates = [hit_to_entity(h) for h in same_name_hits]

    # if same-name exists across >=2 different cities -> disambiguate
    city_set = {c.city_id for c in same_name_candidates if c.city_id}
    if len(city_set) >= 2:
        # ---- Step 2.4C: if city_id is present, shortcut to the matching city candidate
        if city_id:
            scoped = [c for c in same_name_candidates if c.city_id == city_id]
            if len(scoped) == 1:
                chosen = scoped[0]
                return ResolveResponse(
                    action="redirect",
                    query=q,
                    normalized_query=nq,
                    url=chosen.canonical_url,
                    match=chosen,
                    reason="city_scoped_same_name",
                    debug={"city_id": city_id, "candidate_count": len(same_name_candidates)},
                )

        # no city_id (or no unique scoped candidate) -> true disambiguation response
        return ResolveResponse(
            action="disambiguate",
            query=q,
            normalized_query=nq,
            candidates=same_name_candidates,
            reason="same_name",
            debug={"candidate_count": len(same_name_candidates), "cities": sorted(list(city_set))},
        )

    # 3) normal resolver scoring (city-aware search)
    hits, _ = es_search_entities(q=q, limit=5, city_id=city_id)
    if not hits:
        # fallback to global for serp; still return url
        return ResolveResponse(
            action="serp",
            query=q,
            normalized_query=nq,
            url=build_serp_url(q, city_id),
            reason="no_results",
        )

    top = hits[0]
    second = hits[1] if len(hits) > 1 else None
    top_score = float(top.get("_score") or 0.0)
    second_score = float(second.get("_score") or 0.0) if second else 0.0
    gap = 1.0 if top_score <= 0 else (top_score - second_score) / max(top_score, 1e-9)

    match = hit_to_entity(top)
    if top_score >= 5.0 and gap >= 0.30:
        return ResolveResponse(
            action="redirect",
            query=q,
            normalized_query=nq,
            url=match.canonical_url,
            match=match,
            reason="confident",
            debug={"top_score": top_score, "second_score": second_score, "gap": gap},
        )

    return ResolveResponse(
        action="serp",
        query=q,
        normalized_query=nq,
        url=build_serp_url(q, city_id),
        reason="ambiguous",
        debug={"top_score": top_score, "second_score": second_score, "gap": gap},
    )


@search.get("/trending", response_model=TrendingResponse)
def trending(city_id: Optional[str] = None, limit: int = 5):
    items = fetch_trending(city_id=city_id, limit=limit)
    return TrendingResponse(city_id=city_id, items=items)


@search.get("/parse", response_model=ParseResponse)
def parse(q: str = Query(..., min_length=1)):
    return parse_query(q)


# -----------------------
# Events
# -----------------------
@events.post("/search", response_model=EventOk)
def log_search(evt: SearchEventIn = Body(...)):
    payload = evt.model_dump()
    _append_jsonl(EVENTS_DIR / "search.jsonl", payload)
    return EventOk(ok=True)


@events.post("/click", response_model=EventOk)
def log_click(evt: ClickEventIn = Body(...)):
    payload = evt.model_dump()
    _append_jsonl(EVENTS_DIR / "click.jsonl", payload)
    return EventOk(ok=True)


# Mount routers
app.include_router(admin, prefix="/api/v1/admin")
app.include_router(search, prefix="/api/v1/search")
app.include_router(events, prefix="/api/v1/events")