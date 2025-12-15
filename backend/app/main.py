from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

from fastapi import FastAPI, APIRouter, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from elasticsearch import Elasticsearch
from elasticsearch.exceptions import NotFoundError  # noqa: F401

# -----------------------
# Config
# -----------------------
INDEX_NAME = os.getenv("ES_INDEX", "re_entities_v1")
ES_URL = os.getenv("ES_URL", "http://localhost:9200")

# If your docker-compose enables security, set these env vars:
#   ES_USERNAME=elastic
#   ES_PASSWORD=<password>
ES_USERNAME = os.getenv("ES_USERNAME")
ES_PASSWORD = os.getenv("ES_PASSWORD")

REQUEST_TIMEOUT = float(os.getenv("ES_REQUEST_TIMEOUT", "3.0"))
MIN_RESULT_SCORE = float(os.getenv("MIN_RESULT_SCORE", "1.2"))  # below this, treat as no-results


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
    action: str  # redirect | serp
    query: str
    normalized_query: str
    url: Optional[str] = None
    match: Optional[EntityOut] = None
    reason: Optional[str] = None
    debug: Optional[Dict[str, Any]] = None


class TrendingResponse(BaseModel):
    city_id: Optional[str]
    items: List[EntityOut]


class ZeroStateResponse(BaseModel):
    city_id: Optional[str]
    recent_searches: List[str] = []
    trending: List[EntityOut] = []
    popular_entities: List[EntityOut] = []


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


class SearchEventIn(BaseModel):
    query_id: str
    raw_query: str
    normalized_query: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: str  # ISO string


class ClickEventIn(BaseModel):
    query_id: str
    entity_id: str
    entity_type: str
    rank: Optional[int] = None
    url: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: str  # ISO string

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

    # locality hint: grab token after "in <...>" up to "under/below/near/for"
    locality_hint = None
    m = re.search(r"\bin\s+([a-z0-9 \-]+?)(?:\s+\bunder\b|\s+\bbelow\b|\s+\bfor\b|\s+\bnear\b|$)", s)
    if m:
        locality_hint = m.group(1).strip()

    # budget/rent extraction: e.g. "under 80L", "under 50k"
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
    # Mirrors your earlier working demo dataset
    return [
        {
            "id": "builder_dlf", "entity_type": "builder", "name": "DLF",
            "name_norm": "dlf", "city": "", "city_id": "", "parent_name": "",
            "canonical_url": "/builders/dlf", "popularity_score": 95.0
        },
        {
            "oved": "city_noida" if False else "city_noida",  # no-op; keeps file stable even if pasted
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


def build_serp_url(q: str, city_id: Optional[str] = None) -> str:
    # frontend SERP route is /search?q=...
    base = f"/search?q={quote_plus(q)}"
    if city_id:
        base += f"&city_id={quote_plus(city_id)}"
    return base

EVENTS_DIR = Path(os.getenv("EVENTS_DIR", "backend/.events"))

def _append_jsonl(path: Path, payload: dict) -> None:
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


@search.get("", response_model=SuggestResponse)
def search_serp(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    limit: int = 10,
):
    hits, did_you_mean = es_search_entities(q=q, limit=limit, city_id=city_id)
    max_score = max((float(h.get("_score") or 0.0) for h in hits), default=0.0)
    entities = [hit_to_entity(h) for h in hits]
    groups = group_entities(entities)

    fallbacks: Dict[str, Any] = {"relaxed_used": False, "trending": [], "reason": None}
    # If we only have very low-confidence fuzzy hits, treat it as a no-results state.
    if (not hits) or (max_score < MIN_RESULT_SCORE) or (sum(len(v) for v in groups.values()) == 0):
        groups = {k: [] for k in groups.keys()}
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
    max_score = max((float(h.get("_score") or 0.0) for h in hits), default=0.0)
    entities = [hit_to_entity(h) for h in hits]
    groups = group_entities(entities)

    fallbacks: Dict[str, Any] = {"relaxed_used": False, "trending": [], "reason": None}
    # If we only have very low-confidence fuzzy hits, treat it as a no-results state.
    if (not hits) or (max_score < MIN_RESULT_SCORE) or (sum(len(v) for v in groups.values()) == 0):
        groups = {k: [] for k in groups.keys()}
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


@search.get("/resolve", response_model=ResolveResponse)
def resolve(q: str, city_id: Optional[str] = None):
    # if query has constraints -> send to SERP with a URL
    if is_constraint_heavy(q):
        return ResolveResponse(
            action="serp",
            query=q,
            normalized_query=q,
            url=build_serp_url(q, city_id=city_id),
            reason="constraint_heavy",
        )

    hits, _ = es_search_entities(q=q, limit=5, city_id=city_id)
    if not hits:
        return ResolveResponse(
            action="serp",
            query=q,
            normalized_query=q,
            url=build_serp_url(q, city_id=city_id),
            reason="no_results",
        )

    top = hits[0]
    second = hits[1] if len(hits) > 1 else None
    top_score = float(top.get("_score") or 0.0)
    second_score = float(second.get("_score") or 0.0) if second else 0.0
    gap = 1.0 if top_score <= 0 else (top_score - second_score) / max(top_score, 1e-9)

    match = hit_to_entity(top)
    # threshold tuned for demo; refine later with evals
    if top_score >= 5.0 and gap >= 0.30:
        return ResolveResponse(
            action="redirect",
            query=q,
            normalized_query=q,
            url=match.canonical_url,
            match=match,
            debug={"top_score": top_score, "second_score": second_score, "gap": gap},
        )

    return ResolveResponse(
        action="serp",
        query=q,
        normalized_query=q,
        url=build_serp_url(q, city_id=city_id),
        reason="ambiguous",
        debug={"top_score": top_score, "second_score": second_score, "gap": gap},
    )


@search.get("/zero-state", response_model=ZeroStateResponse)
def zero_state(city_id: Optional[str] = None, limit: int = 8):
    """Zero-state payload for an empty search box.

    Note: recents are currently maintained client-side (localStorage).
    """
    items = fetch_trending(city_id=city_id, limit=limit)
    return ZeroStateResponse(city_id=city_id, recent_searches=[], trending=items, popular_entities=items)


@search.get("/trending", response_model=TrendingResponse)
def trending(city_id: Optional[str] = None, limit: int = 5):
    items = fetch_trending(city_id=city_id, limit=limit)
    return TrendingResponse(city_id=city_id, items=items)


@search.get("/parse", response_model=ParseResponse)
def parse(q: str = Query(..., min_length=1)):
    return parse_query(q)

@events.post("/search", response_model=EventOk)
def log_search(evt: SearchEventIn):
    _append_jsonl(EVENTS_DIR / "search.jsonl", evt.model_dump())
    return EventOk(ok=True)


@events.post("/click", response_model=EventOk)
def log_click(evt: ClickEventIn):
    _append_jsonl(EVENTS_DIR / "click.jsonl", evt.model_dump())
    return EventOk(ok=True)


# Mount routers
app.include_router(admin, prefix="/api/v1/admin")
app.include_router(search, prefix="/api/v1/search")
app.include_router(events, prefix="/api/v1/events")
app.include_router(search, prefix="/api/v1/search")
