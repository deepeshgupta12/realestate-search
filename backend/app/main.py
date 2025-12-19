from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urlparse

from elasticsearch import Elasticsearch
from elasticsearch.exceptions import NotFoundError
from fastapi import APIRouter, FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from app.events.recent import load_recent_queries, RecentQuery


# -----------------------
# Config
# -----------------------
INDEX_NAME = os.getenv("ES_INDEX", "re_entities_v1")
ES_URL = os.getenv("ES_URL", "http://localhost:9200")

ES_USERNAME = os.getenv("ES_USERNAME")
ES_PASSWORD = os.getenv("ES_PASSWORD")
REQUEST_TIMEOUT = float(os.getenv("ES_REQUEST_TIMEOUT", "3.0"))

# Local JSON redirects registry (optional)
# Format: {"/old-path": "/new-path", ...}
REDIRECTS_FILE = os.getenv("REDIRECTS_FILE", "backend/data/redirects.json")

# Local event log folder (runtime; gitignored)
# Always resolve relative to this backend package, not the current working directory.
BACKEND_DIR = Path(__file__).resolve().parents[1]  # .../backend

def _resolve_events_dir() -> Path:
    env = os.getenv("EVENTS_DIR")
    if env:
        # Backward-compat: if someone sets EVENTS_DIR=backend/.events, strip the redundant prefix.
        env_norm = env.replace("\\", "/")
        if env_norm.startswith("backend/"):
            env_norm = env_norm[len("backend/") :]

        p = Path(env_norm)
        if not p.is_absolute():
            p = (BACKEND_DIR / p).resolve()
        return p

    # Default: <repo>/backend/.events
    return BACKEND_DIR / ".events"

EVENTS_DIR = _resolve_events_dir()
SEARCH_EVENTS_FILE = EVENTS_DIR / "search.jsonl"
CLICK_EVENTS_FILE = EVENTS_DIR / "click.jsonl"

# Resolver thresholds (demo-tuned)
MIN_REDIRECT_SCORE = float(os.getenv("MIN_REDIRECT_SCORE", "5.0"))
CITY_REDIRECT_MIN_SCORE = float(os.getenv("CITY_REDIRECT_MIN_SCORE", "3.0"))
CITY_REDIRECT_MIN_GAP = float(os.getenv("CITY_REDIRECT_MIN_GAP", "0.30"))
CITY_REDIRECT_SECOND_REL_MAX = float(os.getenv("CITY_REDIRECT_SECOND_REL_MAX", "0.92"))
MIN_REDIRECT_GAP = float(os.getenv("MIN_REDIRECT_GAP", "0.30"))


def get_es() -> Elasticsearch:
    kwargs: Dict[str, Any] = {
        "hosts": [ES_URL],
        "request_timeout": REQUEST_TIMEOUT,
    }
    if ES_USERNAME and ES_PASSWORD:
        kwargs["basic_auth"] = (ES_USERNAME, ES_PASSWORD)

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
    max_price: Optional[int] = None  # INR
    max_rent: Optional[int] = None   # INR / month
    currency: str = "INR"
    ok: bool = True

class RecentSearchOut(BaseModel):
    q: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: Optional[str] = None


class ZeroStateResponse(BaseModel):
    city_id: Optional[str] = None
    recent_searches: List[RecentSearchOut]
    trending_searches: List[EntityOut]
    trending_localities: List[EntityOut]
    popular_entities: List[EntityOut]


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


class EventOk(BaseModel):
    ok: bool

class ClearRecentIn(BaseModel):
    """Clear recent searches derived from search.jsonl.

    V0 semantics:
      - if city_id is provided: remove *search events* whose city_id matches
      - if city_id is null: clear all search events (truncate search.jsonl)
    """
    city_id: Optional[str] = None


class ClearRecentOut(BaseModel):
    ok: bool
    path: str
    removed: int
    kept: int


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
        r"\bbhk\b", r"\b1bhk\b", r"\b2bhk\b", r"\b3bhk\b", r"\b4bhk\b", r"\b5bhk\b", r"\b6bhk\b",
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


def ensure_events_dir() -> None:
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)


def append_jsonl(path: Path, obj: Dict[str, Any]) -> None:
    ensure_events_dir()
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def build_serp_url(
    q: str,
    city_id: Optional[str] = None,
    qid: Optional[str] = None,
    context_url: Optional[str] = None,
) -> str:
    base = f"/search?q={quote_plus(q)}"
    if city_id:
        base += f"&city_id={quote_plus(city_id)}"
    if qid:
        base += f"&qid={quote_plus(qid)}"
    if context_url:
        base += f"&context_url={quote_plus(context_url)}"
    return base

def build_disambiguate_url(
    q: str,
    qid: Optional[str] = None,
    city_id: Optional[str] = None,
    context_url: Optional[str] = None,
) -> str:
    base = f"/disambiguate?q={quote_plus(q)}"
    if qid:
        base += f"&qid={quote_plus(qid)}"
    if city_id:
        base += f"&city_id={quote_plus(city_id)}"
    if context_url:
        base += f"&context_url={quote_plus(context_url)}"
    return base


def clean_path_from_anything(q: str) -> Optional[str]:
    """
    Accept:
      - "/pune/baner"
      - "pune/baner"
      - "https://example.com/pune/baner?utm=1"
    Return normalized path: "/pune/baner" (no query/fragment)
    """
    raw = q.strip()
    if not raw:
        return None

    # Full URL
    if re.match(r"^https?://", raw, re.I):
        u = urlparse(raw)
        path = u.path or ""
    else:
        # slug/path-ish
        path = raw

    if not path:
        return None

    # strip query-ish if user pasted "pune/baner?x=1"
    path = path.split("?", 1)[0].split("#", 1)[0].strip()

    if not path:
        return None

    if not path.startswith("/"):
        path = "/" + path

    # normalize multiple slashes, trim trailing slash (except root)
    path = re.sub(r"/{2,}", "/", path)
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    return path


def load_redirect_registry() -> Dict[str, str]:
    p = Path(REDIRECTS_FILE)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            # normalize keys/values
            out: Dict[str, str] = {}
            for k, v in data.items():
                if not isinstance(k, str) or not isinstance(v, str):
                    continue
                ck = clean_path_from_anything(k) or k
                cv = clean_path_from_anything(v) or v
                out[ck] = cv
            return out
    except Exception:
        return {}
    return {}


REDIRECTS: Dict[str, str] = load_redirect_registry()


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

    # Filter: if city_id present -> allow (same city) OR (global city_id == "")
    filter_clauses: List[Dict[str, Any]] = []
    if city_id:
        filter_clauses.append(
            {
                "bool": {
                    "should": [
                        {"term": {"city_id": city_id}},
                        {"term": {"city_id": ""}},
                    ],
                    "minimum_should_match": 1,
                }
            }
        )

    should: List[Dict[str, Any]] = [
        {"match_phrase_prefix": {"name": {"query": q, "slop": 2, "max_expansions": 50}}},
        {"match": {"name": {"query": q, "fuzziness": "AUTO"}}},
        {"term": {"name_norm": {"value": nq, "boost": 3.0}}},
    ]

    # Mild boost for city match (ordering improvement)
    if city_id:
        should.append({"term": {"city_id": {"value": city_id, "boost": 2.5}}})

    body: Dict[str, Any] = {
        "size": limit,
        "query": {
            "bool": {
                "filter": filter_clauses,
                "should": should,
                "minimum_should_match": 1,
            }
        },
        "sort": [
            {"_score": {"order": "desc"}},
            {"popularity_score": {"order": "desc", "missing": 0}},
        ],
        "suggest": {
            "did_you_mean": {
                "text": q,
                "term": {"field": "name"},
            }
        },
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


def es_lookup_by_canonical_url(path: str) -> Optional[Dict[str, Any]]:
    try:
        res = es.search(
            index=INDEX_NAME,
            body={
                "size": 1,
                "query": {"term": {"canonical_url": path}},
            },
        )
        hits = res.get("hits", {}).get("hits", [])
        return hits[0] if hits else None
    except Exception:
        return None


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


def filter_trending_localities(items: List[EntityOut]) -> List[EntityOut]:
    out: List[EntityOut] = []
    for it in items:
        if it.entity_type in ("city", "micromarket", "locality"):
            out.append(it)
    # keep small + stable
    return out[:4]


def build_listing_url(entity: EntityOut, parsed: ParseResponse) -> str:
    """
    V1 MVP: add constraints as query params to the location canonical url.
    Later we can map to true SY DSE filter syntax.
    """
    base = entity.canonical_url
    params: List[str] = []

    if parsed.intent:
        params.append(f"intent={quote_plus(parsed.intent)}")
    if parsed.bhk is not None:
        params.append(f"bhk={parsed.bhk}")
    if parsed.max_price is not None:
        params.append(f"max_price={parsed.max_price}")
    if parsed.max_rent is not None:
        params.append(f"max_rent={parsed.max_rent}")

    if not params:
        return base
    return base + ("?" + "&".join(params))


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
    city_id: Optional[str] = Query(default=None),
    limit: int = Query(default=8, ge=1, le=32),
):
    """
    Zero-state payload for the search box:
    - recent_searches: last N unique queries from JSONL logs
    - trending_searches: top entities across all types
    - trending_localities: subset of trending_searches (cities/localities/mm)
    - popular_entities: same list as trending_searches (alias)
    """
    trending = fetch_trending(city_id=city_id, limit=limit)

    # --- Recent searches (fully guarded, never allowed to crash) ---
    try:
        from app.events.recent import load_recent_searches  # type: ignore
        raw_recents = load_recent_searches(city_id=city_id, limit=limit)
    except Exception as e:  # pragma: no cover - safety net only
        print(f"[zero-state] recent_searches error: {e}")
        raw_recents = []

    recent_items: List[RecentSearchOut] = []
    for item in raw_recents:
        # Works whether recent.py returns dataclasses or dicts
        if isinstance(item, dict):
            q = (item.get("q") or item.get("normalized_query") or item.get("raw_query") or "").strip()
            city_val = item.get("city_id")
            context_url = item.get("context_url")
            ts = item.get("timestamp")
        else:
            q = (
                getattr(item, "q", None)
                or getattr(item, "normalized_query", None)
                or getattr(item, "raw_query", None)
                or ""
            ).strip()
            city_val = getattr(item, "city_id", None)
            context_url = getattr(item, "context_url", None)
            ts = getattr(item, "timestamp", None)

        if not q:
            continue

        recent_items.append(
            RecentSearchOut(
                q=q,
                city_id=city_val,
                context_url=context_url,
                timestamp=ts,
            )
        )
        if len(recent_items) >= limit:
            break

    # --- Trending slices, using your existing fetch_trending helper ---
    trending_localities = [
        ent for ent in trending if ent.entity_type in ("city", "locality", "micromarket")
    ]
    popular_entities = trending

    return ZeroStateResponse(
        city_id=city_id,
        recent_searches=recent_items,
        trending_searches=trending,
        trending_localities=trending_localities,
        popular_entities=popular_entities,
    )


@search.get("/resolve", response_model=ResolveResponse)
def resolve(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    context_url: Optional[str] = None,
):
    raw_q = q

    # 2.6A: clean URL / slug / full URL resolution
    clean_path = clean_path_from_anything(raw_q)
    if clean_path and ("/" in clean_path):
        # redirect registry first
        if clean_path in REDIRECTS:
            target = REDIRECTS[clean_path]
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=raw_q,
                url=target,
                reason="redirect_registry",
                debug={"clean_path": clean_path, "target": target},
            )

        # canonical lookup
        hit = es_lookup_by_canonical_url(clean_path)
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

    # 2.7A: constraint-heavy → try location + attach params
    if is_constraint_heavy(raw_q):
        parsed = parse_query(raw_q)

        if parsed.locality_hint:
            hits, _ = es_search_entities(q=parsed.locality_hint, limit=10, city_id=city_id)
            entities = [hit_to_entity(h) for h in hits]
            locs = [e for e in entities if e.entity_type in ("city", "micromarket", "locality", "listing_page", "locality_overview")]

            if locs:
                by_name: Dict[str, List[EntityOut]] = {}
                for e in locs:
                    by_name.setdefault(normalize_q(e.name), []).append(e)

                key = normalize_q(parsed.locality_hint)
                candidates = by_name.get(key, locs)
                cities = sorted({c.city_id for c in candidates if c.city_id})

                if len(candidates) > 1 and len(cities) > 1 and not city_id:
                    return ResolveResponse(
                        action="disambiguate",
                        query=raw_q,
                        normalized_query=normalize_q(raw_q),
                        candidates=candidates[:10],
                        reason="constraint_heavy_same_name",
                        debug={"candidate_count": len(candidates), "cities": cities},
                    )

                if city_id:
                    scoped = [c for c in candidates if c.city_id == city_id]
                    if len(scoped) == 1:
                        listing_url = build_listing_url(scoped[0], parsed)
                        return ResolveResponse(
                            action="redirect",
                            query=raw_q,
                            normalized_query=normalize_q(raw_q),
                            url=listing_url,
                            match=scoped[0],
                            reason="constraint_heavy_city_scoped_listing",
                            debug={"city_id": city_id, "base": scoped[0].canonical_url},
                        )

                if len(candidates) == 1:
                    listing_url = build_listing_url(candidates[0], parsed)
                    return ResolveResponse(
                        action="redirect",
                        query=raw_q,
                        normalized_query=normalize_q(raw_q),
                        url=listing_url,
                        match=candidates[0],
                        reason="constraint_heavy_listing",
                        debug={"base": candidates[0].canonical_url},
                    )

        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=raw_q,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            reason="constraint_heavy",
        )

    # Normal resolver
    hits, _ = es_search_entities(q=raw_q, limit=10, city_id=city_id)
    if not hits:
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=raw_q,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            reason="no_results",
        )

    entities = [hit_to_entity(h) for h in hits]

    # same-name disambiguation
    top = entities[0]
    same_name = [e for e in entities if normalize_q(e.name) == normalize_q(top.name) and e.entity_type == top.entity_type]
    cities = sorted({e.city_id for e in same_name if e.city_id})

    if len(same_name) > 1 and len(cities) > 1:
        if city_id:
            scoped = [e for e in same_name if e.city_id == city_id]
            if len(scoped) == 1:
                return ResolveResponse(
                    action="redirect",
                    query=raw_q,
                    normalized_query=normalize_q(raw_q),
                    url=scoped[0].canonical_url,
                    match=scoped[0],
                    reason="city_scoped_same_name",
                    debug={"city_id": city_id, "candidate_count": len(same_name), "cities": cities},
                )

        return ResolveResponse(
            action="disambiguate",
            query=raw_q,
            normalized_query=normalize_q(raw_q),
            candidates=same_name[:10],
            reason="same_name",
            debug={"candidate_count": len(same_name), "cities": cities},
        )

    # score-gap heuristic
    top_hit = hits[0]
    second_hit = hits[1] if len(hits) > 1 else None
    top_score = float(top_hit.get("_score") or 0.0)
    second_score = float(second_hit.get("_score") or 0.0) if second_hit else 0.0
    gap = 1.0 if top_score <= 0 else (top_score - second_score) / max(top_score, 1e-9)

    match = hit_to_entity(top_hit)

    debug = {"top_score": top_score, "second_score": second_score, "gap": gap, "city_id": city_id}

    # City-aware relaxed redirect: if top match is from this city, allow smaller gap
    if city_id and match.city_id == city_id:
        if top_score >= CITY_REDIRECT_MIN_SCORE and gap >= CITY_REDIRECT_MIN_GAP:
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=normalize_q(raw_q),
                url=match.canonical_url,
                match=match,
                reason="city_scoped_relaxed_redirect",
                debug=debug,
            )

    # Default confident redirect
    if top_score >= MIN_REDIRECT_SCORE and gap >= MIN_REDIRECT_GAP:
        return ResolveResponse(
            action="redirect",
            query=raw_q,
            normalized_query=normalize_q(raw_q),
            url=match.canonical_url,
            match=match,
            reason="confident_redirect",
            debug=debug,
        )

    return ResolveResponse(
        action="serp",
        query=raw_q,
        normalized_query=raw_q,
        url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
        reason="ambiguous",
        debug=debug,
    )

    # Normal resolver (no constraints)
    hits, _ = es_search_entities(q=raw_q, limit=10, city_id=city_id)
    debug: Dict[str, Any] = {}

    # If city-scoped search returns nothing, retry globally (helps when city context is wrong)
    if not hits and city_id:
        debug["city_fallback_used"] = True
        hits, _ = es_search_entities(q=raw_q, limit=10, city_id=None)

    if not hits:
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=raw_q,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            reason="no_results",
            debug=debug or None,
        )

    entities = [hit_to_entity(h) for h in hits]

    # same-name disambiguation (2.4A/2.4C)
    top = entities[0]
    same_name = [
        e
        for e in entities
        if normalize_q(e.name) == normalize_q(top.name) and e.entity_type == top.entity_type
    ]
    cities = sorted({e.city_id for e in same_name if e.city_id})

    if len(same_name) > 1 and len(cities) > 1:
        if city_id:
            scoped = [e for e in same_name if e.city_id == city_id]
            if len(scoped) == 1:
                return ResolveResponse(
                    action="redirect",
                    query=raw_q,
                    normalized_query=normalize_q(raw_q),
                    url=scoped[0].canonical_url,
                    match=scoped[0],
                    reason="city_scoped_same_name",
                    debug={"city_id": city_id, "candidate_count": len(same_name), **debug},
                )

        return ResolveResponse(
            action="disambiguate",
            query=raw_q,
            normalized_query=normalize_q(raw_q),
            candidates=same_name[:10],
            reason="same_name",
            debug={"candidate_count": len(same_name), "cities": cities, **debug},
        )

    # score-gap heuristic
    top_hit = hits[0]
    second_hit = hits[1] if len(hits) > 1 else None
    top_score = float(top_hit.get("_score") or 0.0)
    second_score = float(second_hit.get("_score") or 0.0) if second_hit else 0.0
    gap = 1.0 if top_score <= 0 else (top_score - second_score) / max(top_score, 1e-9)
    second_rel = 0.0 if top_score <= 0 else (second_score / max(top_score, 1e-9))

    match = hit_to_entity(top_hit)

    # City context: relax redirect thresholds a bit (reduces unnecessary SERP when city is known)
    if city_id and match.city_id == city_id:
        debug.update(
            {
                "city_scoped": True,
                "top_score": top_score,
                "second_score": second_score,
                "gap": gap,
                "second_rel": second_rel,
            }
        )

        if top_score >= CITY_REDIRECT_MIN_SCORE and (
            gap >= CITY_REDIRECT_MIN_GAP or second_rel <= CITY_REDIRECT_SECOND_REL_MAX
        ):
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=normalize_q(raw_q),
                url=match.canonical_url,
                match=match,
                reason="city_scoped_relaxed_redirect",
                debug=debug,
            )

    # Default confident redirect
    debug.update({"top_score": top_score, "second_score": second_score, "gap": gap})
    if top_score >= MIN_REDIRECT_SCORE and gap >= MIN_REDIRECT_GAP:
        return ResolveResponse(
            action="redirect",
            query=raw_q,
            normalized_query=normalize_q(raw_q),
            url=match.canonical_url,
            match=match,
            reason="confident_redirect",
            debug=debug,
        )

    return ResolveResponse(
        action="serp",
        query=raw_q,
        normalized_query=raw_q,
        url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
        reason="ambiguous",
        debug=debug,
    )


@search.get("/trending", response_model=TrendingResponse)
def trending(city_id: Optional[str] = None, limit: int = 5):
    items = fetch_trending(city_id=city_id, limit=limit)
    return TrendingResponse(city_id=city_id, items=items)


@search.get("/parse", response_model=ParseResponse)
def parse(q: str = Query(..., min_length=1)):
    return parse_query(q)


# -----------------------
# Events logging
# -----------------------
@app.post("/api/v1/events/search", response_model=EventOk)
def log_search(evt: SearchEventIn):
    append_jsonl(
        SEARCH_EVENTS_FILE,
        {
            "query_id": evt.query_id,
            "raw_query": evt.raw_query,
            "normalized_query": evt.normalized_query,
            "city_id": evt.city_id,
            "context_url": evt.context_url,
            "timestamp": evt.timestamp,
        },
    )
    return EventOk(ok=True)


@app.post("/api/v1/events/click", response_model=EventOk)
def log_click(evt: ClickEventIn):
    append_jsonl(
        CLICK_EVENTS_FILE,
        {
            "query_id": evt.query_id,
            "entity_id": evt.entity_id,
            "entity_type": evt.entity_type,
            "rank": evt.rank,
            "url": evt.url,
            "city_id": evt.city_id,
            "context_url": evt.context_url,
            "timestamp": evt.timestamp,
        },
    )
    return EventOk(ok=True)

def _atomic_write(path: Path, text: str) -> None:
    """Atomically overwrite a file by writing to a tmp file then renaming."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


@app.post("/api/v1/events/recent/clear", response_model=ClearRecentOut)
def clear_recent(payload: ClearRecentIn):
    """Clear recent searches by rewriting the search.jsonl log.

    NOTE: "recent searches" in V0 is derived from search events. So clearing recents
    removes rows from search.jsonl.
    """
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    path = SEARCH_EVENTS_FILE

    if not path.exists():
        return ClearRecentOut(ok=True, path=str(path), removed=0, kept=0)

    try:
        lines = path.read_text(encoding="utf-8").splitlines(True)  # keep newlines
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read {path}: {e}")

    # Clear all
    if payload.city_id is None:
        removed = len([ln for ln in lines if ln.strip()])
        try:
            _atomic_write(path, "")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to truncate {path}: {e}")
        return ClearRecentOut(ok=True, path=str(path), removed=removed, kept=0)

    # Clear only matching city_id
    target = payload.city_id
    kept_lines: list[str] = []
    removed = 0

    for ln in lines:
        if not ln.strip():
            continue
        try:
            obj = json.loads(ln)
            ln_city = obj.get("city_id")
        except Exception:
            # If the line isn't valid JSON, keep it to avoid data loss
            kept_lines.append(ln)
            continue

        if ln_city == target:
            removed += 1
        else:
            kept_lines.append(ln)

    try:
        _atomic_write(path, "".join(kept_lines))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rewrite {path}: {e}")

    return ClearRecentOut(ok=True, path=str(path), removed=removed, kept=len(kept_lines))


# Mount routers
app.include_router(admin, prefix="/api/v1/admin")
app.include_router(search, prefix="/api/v1/search")