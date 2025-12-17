from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple
from urllib.parse import quote_plus, urlparse

from elasticsearch import Elasticsearch
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ---------------------------
# Config
# ---------------------------

ES_URL = os.getenv("ES_URL", "http://localhost:9200")
ES_INDEX = os.getenv("ES_INDEX", "re_entities_v1")

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(__file__).resolve().parent / "data"
REDIRECTS_FILE = DATA_DIR / "redirects.json"

EVENTS_DIR = ROOT_DIR / ".events"
EVENTS_DIR.mkdir(parents=True, exist_ok=True)

es = Elasticsearch(ES_URL)


# ---------------------------
# Models
# ---------------------------

EntityType = Literal[
    "city",
    "micromarket",
    "locality",
    "locality_overview",
    "rate_page",
    "listing_page",
    "project",
    "property_pdp",
    "builder",
]

ResolveAction = Literal["redirect", "disambiguate", "serp"]


class AdminOk(BaseModel):
    ok: bool = True
    message: Optional[str] = None
    seeded: Optional[bool] = None
    index_count: Optional[int] = None
    cluster_name: Optional[str] = None
    version: Optional[str] = None


class EntityOut(BaseModel):
    id: str
    entity_type: EntityType
    name: str
    city: str = ""
    city_id: str = ""
    parent_name: str = ""
    canonical_url: str
    score: Optional[float] = None
    popularity_score: Optional[float] = None


class SuggestGroups(BaseModel):
    locations: List[EntityOut] = Field(default_factory=list)
    projects: List[EntityOut] = Field(default_factory=list)
    builders: List[EntityOut] = Field(default_factory=list)
    rate_pages: List[EntityOut] = Field(default_factory=list)
    property_pdps: List[EntityOut] = Field(default_factory=list)


class SearchFallbacks(BaseModel):
    relaxed_used: bool = False
    trending: List[EntityOut] = Field(default_factory=list)
    reason: Optional[str] = None


class SuggestResponse(BaseModel):
    q: str
    normalized_q: str
    did_you_mean: Optional[str] = None
    groups: SuggestGroups = Field(default_factory=SuggestGroups)
    fallbacks: SearchFallbacks = Field(default_factory=SearchFallbacks)


class ZeroStateResponse(BaseModel):
    city_id: Optional[str] = None
    recent_searches: List[str] = Field(default_factory=list)
    trending_searches: List[EntityOut] = Field(default_factory=list)
    trending_localities: List[EntityOut] = Field(default_factory=list)
    popular_entities: List[EntityOut] = Field(default_factory=list)


class ResolveResponse(BaseModel):
    action: ResolveAction
    query: str
    normalized_query: str
    url: Optional[str] = None
    match: Optional[EntityOut] = None
    candidates: Optional[List[EntityOut]] = None
    reason: Optional[str] = None
    debug: Optional[Dict[str, Any]] = None


class EventOk(BaseModel):
    ok: bool = True


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


# ---------------------------
# Helpers
# ---------------------------

_WS_RE = re.compile(r"\s+")

CONSTRAINT_PATTERNS = [
    r"\b\d+\s*bhk\b",
    r"\bunder\s*\d+(\.\d+)?\s*(l|lac|lakh|cr|crore)\b",
    r"\babove\s*\d+(\.\d+)?\s*(l|lac|lakh|cr|crore)\b",
    r"\bwithin\s*\d+(\.\d+)?\s*(l|lac|lakh|cr|crore)\b",
    r"\b\d+\s*(l|lac|lakh|cr|crore)\b",
    r"\bready to move\b",
    r"\bunder construction\b",
    r"\brent\b|\brental\b|\blease\b",
    r"\bresale\b|\bbuy\b|\bsale\b",
]

CONSTRAINT_RE = re.compile("|".join(CONSTRAINT_PATTERNS), re.I)


def normalize_q(q: str) -> str:
    q = (q or "").strip()
    q = _WS_RE.sub(" ", q)
    return q


def is_constraint_heavy(q: str) -> bool:
    return bool(CONSTRAINT_RE.search(q or ""))


def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


def load_redirects() -> Dict[str, str]:
    try:
        if REDIRECTS_FILE.exists():
            data = json.loads(REDIRECTS_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                # normalize keys/values to leading slash paths
                out: Dict[str, str] = {}
                for k, v in data.items():
                    if not isinstance(k, str) or not isinstance(v, str):
                        continue
                    kk = k.strip()
                    vv = v.strip()
                    if not kk.startswith("/"):
                        kk = "/" + kk
                    if not vv.startswith("/"):
                        vv = "/" + vv
                    out[kk] = vv
                return out
    except Exception:
        pass
    return {}


REDIRECTS: Dict[str, str] = load_redirects()


def extract_clean_path(raw_q: str) -> Optional[str]:
    """
    Accept:
      - /pune/baner
      - pune/baner
      - https://example.com/pune/baner?utm=1
    Return normalized path like /pune/baner (no trailing slash unless root).
    """
    q = (raw_q or "").strip()
    if not q:
        return None

    # full URL
    if "://" in q:
        try:
            u = urlparse(q)
            path = u.path or ""
        except Exception:
            return None
    else:
        # path-like
        path = q

    path = path.strip()
    if not path:
        return None

    # convert "pune/baner" -> "/pune/baner"
    if not path.startswith("/"):
        if "/" in path:
            path = "/" + path
        else:
            return None  # single token, not a path

    # remove trailing slash unless root
    if path != "/" and path.endswith("/"):
        path = path[:-1]

    return path


def build_serp_url(q: str, city_id: Optional[str] = None, qid: Optional[str] = None, context_url: Optional[str] = None) -> str:
    params = [f"q={quote_plus(q)}"]
    if city_id:
        params.append(f"city_id={quote_plus(city_id)}")
    if qid:
        params.append(f"qid={quote_plus(qid)}")
    if context_url:
        params.append(f"context_url={quote_plus(context_url)}")
    return "/search?" + "&".join(params)


def hit_to_entity(hit: Dict[str, Any]) -> EntityOut:
    src = hit.get("_source") or {}
    return EntityOut(
        id=str(src.get("id") or hit.get("_id") or ""),
        entity_type=src.get("entity_type") or "locality",
        name=src.get("name") or "",
        city=src.get("city") or "",
        city_id=src.get("city_id") or "",
        parent_name=src.get("parent_name") or "",
        canonical_url=src.get("canonical_url") or "",
        score=float(hit.get("_score")) if hit.get("_score") is not None else None,
        popularity_score=float(src.get("popularity_score")) if src.get("popularity_score") is not None else None,
    )


def group_entities(entities: List[EntityOut]) -> SuggestGroups:
    g = SuggestGroups()
    for e in entities:
        if e.entity_type in ("city", "micromarket", "locality", "locality_overview"):
            g.locations.append(e)
        elif e.entity_type == "project":
            g.projects.append(e)
        elif e.entity_type == "builder":
            g.builders.append(e)
        elif e.entity_type == "rate_page":
            g.rate_pages.append(e)
        elif e.entity_type == "property_pdp":
            g.property_pdps.append(e)
    return g


def es_search_entities(q: str, limit: int = 10, city_id: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Returns (hits, did_you_mean)
    """
    nq = normalize_q(q).lower()
    if not nq:
        return [], None

    must: List[Dict[str, Any]] = [{"term": {"status": "active"}}]
    if city_id:
        must.append({"term": {"city_id": city_id}})

    query = {
        "bool": {
            "must": must,
            "should": [
                {"term": {"name_norm": {"value": nq, "boost": 6.0}}},
                {"match": {"name": {"query": nq, "boost": 3.0, "fuzziness": "AUTO"}}},
                {"match": {"aliases": {"query": nq, "boost": 2.0, "fuzziness": "AUTO"}}},
                {"match_phrase_prefix": {"name": {"query": nq, "boost": 2.0}}},
            ],
            "minimum_should_match": 1,
        }
    }

    body: Dict[str, Any] = {
        "size": limit,
        "query": query,
        "sort": [{"_score": "desc"}, {"popularity_score": "desc"}],
        "suggest": {
            "dym": {
                "text": nq,
                "term": {"field": "name_norm", "suggest_mode": "popular"},
            }
        },
    }

    resp = es.search(index=ES_INDEX, body=body)
    hits = (resp.get("hits") or {}).get("hits") or []

    dym = None
    try:
        opts = (((resp.get("suggest") or {}).get("dym") or [])[0] or {}).get("options") or []
        if opts:
            dym = opts[0].get("text")
    except Exception:
        dym = None

    return hits, dym


def es_find_by_canonical_url(path: str) -> Optional[Dict[str, Any]]:
    """
    Exact lookup by canonical_url keyword.
    """
    path = path.strip()
    if not path:
        return None

    body = {
        "size": 1,
        "query": {
            "bool": {
                "must": [
                    {"term": {"status": "active"}},
                    {"term": {"canonical_url": path}},
                ]
            }
        },
    }
    resp = es.search(index=ES_INDEX, body=body)
    hits = (resp.get("hits") or {}).get("hits") or []
    return hits[0] if hits else None


def append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


# ---------------------------
# FastAPI
# ---------------------------

app = FastAPI(title="RealEstate Search API (Local)", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

admin = APIRouter(prefix="/api/v1/admin", tags=["admin"])
search = APIRouter(prefix="/api/v1/search", tags=["search"])
events = APIRouter(prefix="/api/v1/events", tags=["events"])


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True}


@admin.get("/ping-es", response_model=AdminOk)
def ping_es() -> AdminOk:
    info = es.info()
    return AdminOk(
        ok=True,
        cluster_name=(info.get("cluster_name") if isinstance(info, dict) else None),
        version=((info.get("version") or {}).get("number") if isinstance(info, dict) else None),
    )


@admin.post("/create-index", response_model=AdminOk)
def create_index() -> AdminOk:
    if es.indices.exists(index=ES_INDEX):
        return AdminOk(ok=True, message=f"Index {ES_INDEX} already exists")

    mapping = {
        "settings": {
            "analysis": {
                "analyzer": {
                    "folding": {
                        "tokenizer": "standard",
                        "filter": ["lowercase", "asciifolding"],
                    }
                }
            }
        },
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "entity_type": {"type": "keyword"},
                "name": {"type": "text", "analyzer": "folding"},
                "name_norm": {"type": "keyword"},
                "aliases": {"type": "text", "analyzer": "folding"},
                "city": {"type": "keyword"},
                "city_id": {"type": "keyword"},
                "parent_name": {"type": "keyword"},
                "canonical_url": {"type": "keyword"},
                "status": {"type": "keyword"},
                "popularity_score": {"type": "float"},
            }
        },
    }
    es.indices.create(index=ES_INDEX, body=mapping)
    return AdminOk(ok=True, message=f"Created index {ES_INDEX}")


@admin.post("/seed", response_model=AdminOk)
def seed() -> AdminOk:
    """
    Minimal demo seed. Safe to re-run.
    """
    docs = [
        {
            "id": "builder_dlf",
            "entity_type": "builder",
            "name": "DLF",
            "name_norm": "dlf",
            "aliases": ["dlf limited"],
            "city": "",
            "city_id": "",
            "parent_name": "",
            "canonical_url": "/builders/dlf",
            "status": "active",
            "popularity_score": 95.0,
        },
        {
            "id": "city_noida",
            "entity_type": "city",
            "name": "Noida",
            "name_norm": "noida",
            "aliases": [],
            "city": "Noida",
            "city_id": "city_noida",
            "parent_name": "",
            "canonical_url": "/noida",
            "status": "active",
            "popularity_score": 90.0,
        },
        {
            "id": "proj_godrej_woods",
            "entity_type": "project",
            "name": "Godrej Woods",
            "name_norm": "godrej woods",
            "aliases": ["godrej woods noida"],
            "city": "Noida",
            "city_id": "city_noida",
            "parent_name": "Sector 43",
            "canonical_url": "/projects/noida/godrej-woods",
            "status": "active",
            "popularity_score": 88.0,
        },
        {
            "id": "city_pune",
            "entity_type": "city",
            "name": "Pune",
            "name_norm": "pune",
            "aliases": [],
            "city": "Pune",
            "city_id": "city_pune",
            "parent_name": "",
            "canonical_url": "/pune",
            "status": "active",
            "popularity_score": 85.0,
        },
        {
            "id": "loc_baner_pune",
            "entity_type": "locality",
            "name": "Baner",
            "name_norm": "baner",
            "aliases": ["baner pune"],
            "city": "Pune",
            "city_id": "city_pune",
            "parent_name": "West Pune",
            "canonical_url": "/pune/baner",
            "status": "active",
            "popularity_score": 80.0,
        },
        {
            "id": "mm_sector150_noida",
            "entity_type": "micromarket",
            "name": "Sector 150",
            "name_norm": "sector 150",
            "aliases": ["sec 150"],
            "city": "Noida",
            "city_id": "city_noida",
            "parent_name": "Noida Expressway",
            "canonical_url": "/noida/sector-150",
            "status": "active",
            "popularity_score": 78.0,
        },
        {
            "id": "rate_baner",
            "entity_type": "rate_page",
            "name": "Baner Property Rates",
            "name_norm": "baner property rates",
            "aliases": ["baner rates", "baner price trend"],
            "city": "Pune",
            "city_id": "city_pune",
            "parent_name": "Baner",
            "canonical_url": "/property-rates/pune/baner",
            "status": "active",
            "popularity_score": 60.0,
        },
        {
            "id": "pdp_resale_1",
            "entity_type": "property_pdp",
            "name": "2 BHK Resale Apartment in Baner",
            "name_norm": "2 bhk resale apartment in baner",
            "aliases": ["2 bhk baner resale"],
            "city": "Pune",
            "city_id": "city_pune",
            "parent_name": "Baner",
            "canonical_url": "/pune/baner/resale/2-bhk-apartment-123",
            "status": "active",
            "popularity_score": 40.0,
        },
    ]

    for d in docs:
        es.index(index=ES_INDEX, id=d["id"], body=d)

    es.indices.refresh(index=ES_INDEX)
    return AdminOk(ok=True, seeded=True, message="Seeded docs")


@search.get("/zero-state", response_model=ZeroStateResponse)
def zero_state(city_id: Optional[str] = None, limit: int = 8, context_url: Optional[str] = None) -> ZeroStateResponse:
    # Global trending derived from popularity_score
    hits, _ = es_search_entities(q="pune", limit=200, city_id=None)  # hack to pull something; we’ll sort below
    all_entities = [hit_to_entity(h) for h in hits]
    all_entities = [e for e in all_entities if e.popularity_score is not None]
    all_entities.sort(key=lambda e: float(e.popularity_score or 0.0), reverse=True)

    if city_id:
        city_scoped = [e for e in all_entities if (e.city_id or "") == city_id]
        trending_searches = city_scoped[:limit]
    else:
        trending_searches = all_entities[:limit]

    trending_localities = [e for e in trending_searches if e.entity_type in ("city", "micromarket", "locality")][: max(2, limit // 2)]
    popular_entities = trending_searches[:limit]

    return ZeroStateResponse(
        city_id=city_id,
        recent_searches=[],
        trending_searches=trending_searches,
        trending_localities=trending_localities,
        popular_entities=popular_entities,
    )


@search.get("/suggest", response_model=SuggestResponse)
def suggest(q: str, city_id: Optional[str] = None, limit: int = 10, context_url: Optional[str] = None) -> SuggestResponse:
    nq = normalize_q(q).lower()
    hits, dym = es_search_entities(q=nq, limit=limit, city_id=city_id)
    entities = [hit_to_entity(h) for h in hits]
    groups = group_entities(entities)

    fb = SearchFallbacks(relaxed_used=False, trending=[], reason=None)
    if not entities:
        # relaxed fallback: trending
        z = zero_state(city_id=city_id, limit=limit, context_url=context_url)
        fb = SearchFallbacks(relaxed_used=True, trending=z.trending_searches, reason="no_results")

    return SuggestResponse(
        q=q,
        normalized_q=nq,
        did_you_mean=dym,
        groups=groups,
        fallbacks=fb,
    )


@search.get("", response_model=SuggestResponse)
def serp_search(q: str, city_id: Optional[str] = None, limit: int = 20, context_url: Optional[str] = None) -> SuggestResponse:
    # same shape as suggest (V0)
    return suggest(q=q, city_id=city_id, limit=limit, context_url=context_url)


@search.get("/resolve", response_model=ResolveResponse)
def resolve(q: str, city_id: Optional[str] = None, context_url: Optional[str] = None) -> ResolveResponse:
    raw_q = normalize_q(q)
    nq = raw_q.lower()

    # 1) Long-tail / clean URL handling (with redirect registry)
    clean_path = extract_clean_path(raw_q)
    if clean_path:
        # a) redirects registry first
        target = REDIRECTS.get(clean_path)
        if target:
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=raw_q,
                url=target,
                match=None,
                reason="redirect_registry",
                debug={"clean_path": clean_path, "target": target},
            )

        # b) direct canonical_url lookup in ES
        hit = es_find_by_canonical_url(clean_path)
        if hit:
            ent = hit_to_entity(hit)
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=raw_q,
                url=ent.canonical_url,
                match=ent,
                reason="clean_url",
                debug={"clean_path": clean_path},
            )

        # c) path-like but no match -> SERP (must NOT crash)
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=raw_q,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            reason="no_results",
        )

    # 2) Constraint heavy -> SERP
    if is_constraint_heavy(raw_q):
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=raw_q,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            reason="constraint_heavy",
        )

    # 3) Entity candidate retrieval
    hits, _ = es_search_entities(q=nq, limit=5, city_id=None)
    if not hits:
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=raw_q,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            reason="no_results",
        )

    entities = [hit_to_entity(h) for h in hits]
    top = entities[0]
    second = entities[1] if len(entities) > 1 else None

    # 4) Same-name disambiguation (city-scoped shortcut)
    # if top 2 share same normalized name AND same entity_type but different city_id -> disambiguate
    if second and (top.name.strip().lower() == second.name.strip().lower()) and (top.entity_type == second.entity_type):
        candidates = [e for e in entities if e.name.strip().lower() == top.name.strip().lower() and e.entity_type == top.entity_type]

        # city-scoped shortcut
        if city_id:
            scoped = [c for c in candidates if (c.city_id or "") == city_id]
            if len(scoped) == 1:
                return ResolveResponse(
                    action="redirect",
                    query=raw_q,
                    normalized_query=nq,
                    url=scoped[0].canonical_url,
                    match=scoped[0],
                    reason="city_scoped_same_name",
                    debug={"city_id": city_id, "candidate_count": len(candidates)},
                )

        return ResolveResponse(
            action="disambiguate",
            query=raw_q,
            normalized_query=nq,
            candidates=candidates,
            reason="same_name",
            debug={"candidate_count": len(candidates), "cities": sorted(list({c.city_id for c in candidates if c.city_id}))},
        )

    # 5) Default ambiguous -> SERP (kept conservative)
    return ResolveResponse(
        action="serp",
        query=raw_q,
        normalized_query=nq,
        url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
        reason="ambiguous",
    )


@events.post("/search", response_model=EventOk)
def log_search(e: SearchEventIn) -> EventOk:
    append_jsonl(EVENTS_DIR / "search.jsonl", e.model_dump())
    return EventOk(ok=True)


@events.post("/click", response_model=EventOk)
def log_click(e: ClickEventIn) -> EventOk:
    append_jsonl(EVENTS_DIR / "click.jsonl", e.model_dump())
    return EventOk(ok=True)


app.include_router(admin)
app.include_router(search)
app.include_router(events)