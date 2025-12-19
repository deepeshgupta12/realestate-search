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
from fastapi import APIRouter, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from app.events.recent import load_recent_queries, RecentQuery

from urllib.parse import urlencode

LISTING_BASE = {
    "buy": "/{city_slug}/{locality_slug}/buy",
    "rent": "/{city_slug}/{locality_slug}/rent",
}


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
EVENTS_DIR = Path(os.getenv("EVENTS_DIR", "backend/.events"))
SEARCH_EVENTS_FILE = EVENTS_DIR / "search.jsonl"
CLICK_EVENTS_FILE = EVENTS_DIR / "click.jsonl"

# Resolver thresholds (demo-tuned)
MIN_REDIRECT_SCORE = float(os.getenv("MIN_REDIRECT_SCORE", "5.0"))
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
    builder_hint: Optional[str] = None
    # V1 intent + constraints
    page_intent: Optional[str] = None  # rate_page | locality_overview | listing | None
    location_query: Optional[str] = None  # cleaned location-ish part of the query
    property_type: Optional[str] = None  # apartment | builder_floor | plot | ...
    status: Optional[str] = None  # ready | under_construction

    # Budgets
    min_price: Optional[int] = None  # INR
    max_price: Optional[int] = None  # INR
    min_rent: Optional[int] = None   # INR / month
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


# -----------------------
# Helpers
# -----------------------
def normalize_q(q: Optional[str]) -> str:
    """Normalize query-ish strings safely.

    Some parse branches may not produce locality_hint while still producing a usable
    location_query. Accept None and return "".
    """
    if not q:
        return ""
    return re.sub(r"\s+", " ", q.strip()).lower()


def is_constraint_heavy(q: str) -> bool:
    """Heuristic: treat the query as constraint-heavy if it contains filters beyond pure navigation."""
    parsed = parse_query(q)
    return any(
        v is not None
        for v in (
            parsed.intent,
            parsed.bhk,
            parsed.property_type,
            parsed.status,
            parsed.min_price,
            parsed.max_price,
            parsed.min_rent,
            parsed.max_rent,
        )
    ) or (parsed.page_intent == "listing")


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
    """Parse lightweight intent + constraints from a free-form search query.

    V0: intent(buy/rent), bhk, locality_hint, under X budget.
    V1: adds page_intent (rate_page/locality_overview/listing) and richer constraints.
    V1.3: adds builder_hint extraction for queries like "dlf projects in noida".
    """
    raw = q
    s = normalize_q(q)

    # ------------------
    # Page intent
    # ------------------
    page_intent: Optional[str] = None
    rate_re = r"\b(property\s+rates?|rates?|price\s+trends?|trends?)\b"
    overview_re = r"\b(locality\s+overview|overview|about|guide)\b"

    if re.search(rate_re, s):
        page_intent = "rate_page"
    elif re.search(overview_re, s):
        page_intent = "locality_overview"

    # ------------------
    # Buy vs Rent intent
    # ------------------
    intent: Optional[str] = None
    if re.search(r"\brent\b|\brental\b|\btenant\b", s):
        intent = "rent"
    elif re.search(r"\bbuy\b|\bresale\b|\bsale\b|\bfor sale\b", s):
        intent = "buy"

    # ------------------
    # BHK
    # ------------------
    bhk: Optional[int] = None
    m = re.search(r"\b([1-6])\s*bhk\b", s)
    if m:
        bhk = int(m.group(1))
    else:
        m = re.search(r"\b([1-6])bhk\b", s)
        if m:
            bhk = int(m.group(1))

    # ------------------
    # Status
    # ------------------
    status: Optional[str] = None
    if re.search(r"\b(ready\s*to\s*move|rtm|ready)\b", s):
        status = "ready"
    elif re.search(r"\b(under\s*construction|uc)\b", s):
        status = "under_construction"

    # ------------------
    # Property type
    # ------------------
    property_type: Optional[str] = None
    type_map = [
        ("builder_floor", r"\b(builder\s*floor|floor)\b"),
        ("apartment", r"\b(apartment|flat)\b"),
        ("plot", r"\b(plot|land)\b"),
        ("villa", r"\b(villa)\b"),
        ("independent_house", r"\b(independent\s*house|house)\b"),
        ("office", r"\b(office)\b"),
        ("shop", r"\b(shop|retail)\b"),
    ]
    for key, pat in type_map:
        if re.search(pat, s):
            property_type = key
            break

    # ------------------
    # Builder hint (V1.3)
    # ------------------
    builder_hint: Optional[str] = None

    # Example: "dlf projects in noida" -> builder_hint="dlf"
    m = re.search(r"^([a-z0-9&.\- ]+?)\s+(?:projects?|properties?|listings?|homes?)\b", s)
    if m:
        builder_hint = m.group(1).strip()

    # Example: "projects by dlf in noida" -> builder_hint="dlf"
    if not builder_hint:
        m = re.search(r"\b(?:projects?|properties?|listings?|homes?)\s+(?:by|from)\s+([a-z0-9&.\- ]+?)(?:\s+\b(in|near|at)\b|$)", s)
        if m:
            builder_hint = m.group(1).strip()

    # Example: "builder dlf in noida" -> builder_hint="dlf"
    if not builder_hint:
        m = re.search(r"\bbuilder\s+([a-z0-9&.\- ]+?)(?:\s+\b(in|near|at)\b|$)", s)
        if m:
            builder_hint = m.group(1).strip()

    # ------------------
    # Location hint ("in Baner", "near Baner", "at Baner")
    # ------------------
    locality_hint: Optional[str] = None
    m = re.search(
        r"\b(?:in|near|at)\s+([a-z0-9 \-]+?)(?:\s+\bunder\b|\s+\bbelow\b|\s+\bbetween\b|\s+\bfor\b|\s+\bwith\b|\s+\bnear\b|\s+\brates?\b|\s+\boverview\b|$)",
        s,
    )
    if m:
        locality_hint = m.group(1).strip()

    # ------------------
    # Budgets (INR)
    # ------------------
    min_price: Optional[int] = None
    max_price: Optional[int] = None
    min_rent: Optional[int] = None
    max_rent: Optional[int] = None

    rent_context = bool(re.search(r"\brent\b|\brental\b|\bper\s*month\b|\bpm\b", s)) or intent == "rent"

    def _apply_budget(min_v: Optional[int], max_v: Optional[int]) -> None:
        nonlocal min_price, max_price, min_rent, max_rent
        if rent_context:
            min_rent = min_v if min_v is not None else min_rent
            max_rent = max_v if max_v is not None else max_rent
        else:
            min_price = min_v if min_v is not None else min_price
            max_price = max_v if max_v is not None else max_price

    # between X and Y
    m = re.search(
        r"\bbetween\s+([0-9]+(?:\.[0-9]+)?)\s*(cr|crore|l|lac|lakh|k)?\s*(?:and|to)\s+([0-9]+(?:\.[0-9]+)?)\s*(cr|crore|l|lac|lakh|k)?\b",
        s,
    )
    if m:
        v1 = float(m.group(1))
        u1 = (m.group(2) or "").lower() or "l"
        v2 = float(m.group(3))
        u2 = (m.group(4) or "").lower() or u1
        _apply_budget(money_to_rupees(v1, u1), money_to_rupees(v2, u2))

    # under / below / upto
    m = re.search(
        r"\b(?:under|below|upto|up\s*to|less\s*than|max)\s+([0-9]+(?:\.[0-9]+)?)\s*(cr|crore|l|lac|lakh|k)\b",
        s,
    )
    if m and (max_price is None and max_rent is None):
        v = float(m.group(1))
        u = m.group(2)
        _apply_budget(None, money_to_rupees(v, u))

    # above / over / more than
    m = re.search(
        r"\b(?:above|over|more\s*than|min)\s+([0-9]+(?:\.[0-9]+)?)\s*(cr|crore|l|lac|lakh|k)\b",
        s,
    )
    if m and (min_price is None and min_rent is None):
        v = float(m.group(1))
        u = m.group(2)
        _apply_budget(money_to_rupees(v, u), None)

    # ------------------
    # Decide listing intent
    # ------------------
    if page_intent is None and any(v is not None for v in (bhk, status, property_type, min_price, max_price, min_rent, max_rent, intent)):
        page_intent = "listing"

    # ------------------
    # Location-ish remainder
    # ------------------
    loc = s

    # remove obvious non-location tokens
    loc = re.sub(rate_re, " ", loc)
    loc = re.sub(overview_re, " ", loc)
    loc = re.sub(r"\b([1-6])\s*bhk\b", " ", loc)
    loc = re.sub(r"\b(?:buy|resale|sale|rent|rental|tenant)\b", " ", loc)
    loc = re.sub(r"\b(ready\s*to\s*move|rtm|ready|under\s*construction|uc)\b", " ", loc)
    loc = re.sub(r"\b(builder\s*floor|floor|apartment|flat|plot|land|villa|independent\s*house|house|office|shop|retail)\b", " ", loc)

    # remove builder/listing words
    loc = re.sub(r"\b(projects?|properties?|listings?|homes?|developer|developers|builder|builders|by|from)\b", " ", loc)
    if builder_hint:
        # remove the builder name phrase from loc so we don't treat it as location
        loc = re.sub(r"\b" + re.escape(builder_hint) + r"\b", " ", loc)

    # remove budget phrases
    loc = re.sub(r"\bbetween\b[\s\S]{0,40}\b(?:cr|crore|l|lac|lakh|k)\b", " ", loc)
    loc = re.sub(r"\b(?:under|below|upto|up\s*to|less\s*than|max|above|over|more\s*than|min)\b[\s\S]{0,20}\b(?:cr|crore|l|lac|lakh|k)\b", " ", loc)

    # cleanup stopwords
    loc = re.sub(r"\b(in|near|at|for|with|without|and|to)\b", " ", loc)
    loc = re.sub(r"\s+", " ", loc).strip()

    location_query: Optional[str] = None
    if locality_hint:
        location_query = locality_hint
    elif loc:
        location_query = loc

    return ParseResponse(
        q=s,
        intent=intent,
        bhk=bhk,
        locality_hint=locality_hint,
        page_intent=page_intent,
        location_query=location_query,
        property_type=property_type,
        status=status,
        min_price=min_price,
        max_price=max_price,
        min_rent=min_rent,
        max_rent=max_rent,
        builder_hint=builder_hint,
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


def es_search_entities(
    q: str,
    limit: int,
    city_id: Optional[str],
    entity_types: Optional[List[str]] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    nq = normalize_q(q)

    filters: List[Dict[str, Any]] = []
    if entity_types:
        filters.append({"terms": {"entity_type": entity_types}})

    body: Dict[str, Any] = {
        "size": limit,
        "query": {
            "bool": {
                "filter": filters,
                "should": [
                    {"match_phrase_prefix": {"name": {"query": q, "slop": 2}}},
                    {"match": {"name": {"query": q, "fuzziness": "AUTO"}}},
                    {"term": {"name_norm": nq}},
                    # city-scoped bias (do not hard-filter; keep global entities like builders)
                    *(
                        [
                            {"term": {"city_id": {"value": city_id, "boost": 2.0}}},
                            {"term": {"city_id": {"value": "", "boost": 0.3}}},
                        ]
                        if city_id
                        else []
                    ),
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
    base = (entity.canonical_url or "").rstrip("/")
    if not base:
        base = "/"

    intent = (getattr(parsed, "intent", None) or "").strip().lower()
    segment = "rent" if intent == "rent" else "buy"

    if entity.entity_type in ("city", "micromarket", "locality", "listing_page", "locality_overview"):
        base_with_intent = f"{base}/{segment}" if base != "/" else f"/{segment}"
    else:
        base_with_intent = base

    params = {}

    bhk = getattr(parsed, "bhk", None)
    if bhk is not None:
        params["bhk"] = bhk

    min_price = getattr(parsed, "min_price", None)
    max_price = getattr(parsed, "max_price", None)
    if min_price is not None:
        params["min_price"] = min_price
    if max_price is not None:
        params["max_price"] = max_price

    min_rent = getattr(parsed, "min_rent", None)
    max_rent = getattr(parsed, "max_rent", None)
    if min_rent is not None:
        params["min_rent"] = min_rent
    if max_rent is not None:
        params["max_rent"] = max_rent

    status = getattr(parsed, "status", None)
    if status:
        params["status"] = status

    property_type = getattr(parsed, "property_type", None) or getattr(parsed, "ptype", None)
    if property_type:
        params["property_type"] = property_type

    qs = urlencode(params)
    return base_with_intent + (f"?{qs}" if qs else "")

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
        # 2.6B: redirect registry first (optional)
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

        # direct canonical lookup
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
        # If looks like a path but not found: fall through to normal resolver (SERP/no_results)

    # V1.1: if query strongly signals a target page type (rates / locality overview),
    # try a type-scoped redirect first.
    parsed = parse_query(raw_q)
    if parsed.page_intent in ("rate_page", "locality_overview") and parsed.location_query:
        hits, _ = es_search_entities(
            q=parsed.location_query,
            limit=10,
            city_id=city_id,
            entity_types=[parsed.page_intent],
        )
        ents = [hit_to_entity(h) for h in hits]

        # Prefer exact name match
        name_key = normalize_q(parsed.location_query)
        exact = [e for e in ents if normalize_q(e.name) == name_key]
        candidates = exact or ents

        # If city-scoped, prefer entity in that city when available
        if city_id:
            in_city = [e for e in candidates if e.city_id == city_id]
            if in_city:
                picked = in_city[0]
                return ResolveResponse(
                    action="redirect",
                    query=raw_q,
                    normalized_query=parsed.q,
                    url=picked.canonical_url,
                    match=picked,
                    reason="page_intent_city_scoped",
                    debug={"page_intent": parsed.page_intent, "picked": picked.id, "city_id": city_id},
                )

        # If multiple candidates across cities, ask for disambiguation
        cities = sorted({e.city_id for e in candidates if e.city_id})
        if len(candidates) > 1 and len(cities) > 1 and not city_id:
            return ResolveResponse(
                action="disambiguate",
                query=raw_q,
                normalized_query=parsed.q,
                url=None,
                match=None,
                candidates=candidates[:8],
                reason="page_intent_same_name",
                debug={"page_intent": parsed.page_intent, "candidate_count": len(candidates), "cities": cities},
            )

        if candidates:
            picked = candidates[0]
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=parsed.q,
                url=picked.canonical_url,
                match=picked,
                reason="page_intent_confident_redirect",
                debug={"page_intent": parsed.page_intent, "picked": picked.id},
            )
        # V1.3: builder-intent → route to listing with builder filter (not builder page)
    if getattr(parsed, "builder_hint", None):
        # Resolve builder entity (prefer exact name)
        bhits, _ = es_search_entities(
            q=parsed.builder_hint,
            limit=5,
            city_id=None,
            entity_types=["builder"],
        )
        builders = [hit_to_entity(h) for h in bhits]
        if builders:
            bkey = normalize_q(parsed.builder_hint)
            exact_builders = [b for b in builders if normalize_q(b.name) == bkey]
            builder_ent = (exact_builders or builders)[0]

            # Find best base location to build listing URL on
            base_ent = None
            location_q = parsed.locality_hint or parsed.location_query
            if location_q:
                lhits, _ = es_search_entities(q=location_q, limit=10, city_id=city_id)
                lents = [hit_to_entity(h) for h in lhits]
                locs = [e for e in lents if e.entity_type in ("city", "micromarket", "locality", "listing_page", "locality_overview")]

                if locs:
                    lkey = normalize_q(location_q)
                    exact_locs = [e for e in locs if normalize_q(e.name) == lkey]
                    candidates = exact_locs or locs

                    if city_id:
                        in_city = [e for e in candidates if e.city_id == city_id]
                        if in_city:
                            base_ent = in_city[0]
                    if base_ent is None:
                        base_ent = candidates[0]

            # If no location inferred but city_id is present, fall back to city entity
            if base_ent is None and city_id:
                chits, _ = es_search_entities(q=city_id, limit=5, city_id=None, entity_types=["city"])
                cents = [hit_to_entity(h) for h in chits]
                exact_city = [c for c in cents if c.id == city_id]
                if exact_city:
                    base_ent = exact_city[0]

            if base_ent is not None:
                listing_url = build_listing_url(base_ent, parsed)

                # append builder_id param
                if "?" in listing_url:
                    listing_url = f"{listing_url}&builder_id={builder_ent.id}"
                else:
                    listing_url = f"{listing_url}?builder_id={builder_ent.id}"

                return ResolveResponse(
                    action="redirect",
                    query=raw_q,
                    normalized_query=parsed.q,
                    url=listing_url,
                    match=base_ent,
                    reason="builder_intent_listing",
                    debug={
                        "builder_hint": parsed.builder_hint,
                        "builder_id": builder_ent.id,
                        "base": base_ent.canonical_url,
                        "city_id": city_id,
                    },
                )

    # 2.7A: constraint-heavy → try DSE-style redirect if we can extract a location confidently
    if is_constraint_heavy(raw_q):
        # If we can detect a location ("in <locality>" or a remaining location phrase), use it.
        location_q = parsed.locality_hint or parsed.location_query
        if location_q:
            hits, _ = es_search_entities(q=location_q, limit=10, city_id=city_id)

            entities = [hit_to_entity(h) for h in hits]
            # Restrict to locations only
            locs = [e for e in entities if e.entity_type in ("city", "micromarket", "locality", "listing_page", "locality_overview")]

            # If multiple same-name locations across cities and city_id not provided -> disambiguate
            if locs:
                # Detect same-name multi-city ambiguity
                by_name: Dict[str, List[EntityOut]] = {}
                for e in locs:
                    k = normalize_q(e.name)
                    by_name.setdefault(k, []).append(e)
                # Pick the group that matches the locality hint best (exact normalized)
                key = normalize_q(location_q)
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

                # If city-scoped, choose the best match within city
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

                # Otherwise if only one candidate overall -> redirect to listing URL
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

        # fallback (existing behavior): send to SERP
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=raw_q,
            url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
            reason="constraint_heavy",
        )

    # Normal resolver (no constraints)
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

    # same-name disambiguation (2.4A/2.4C)
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
                    debug={"city_id": city_id, "candidate_count": len(same_name)},
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
    if top_score >= MIN_REDIRECT_SCORE and gap >= MIN_REDIRECT_GAP:
        return ResolveResponse(
            action="redirect",
            query=raw_q,
            normalized_query=normalize_q(raw_q),
            url=match.canonical_url,
            match=match,
            reason="confident_redirect",
            debug={"top_score": top_score, "second_score": second_score, "gap": gap},
        )

    return ResolveResponse(
        action="serp",
        query=raw_q,
        normalized_query=normalize_q(raw_q),
        url=build_serp_url(raw_q, city_id=city_id, qid=None, context_url=context_url),
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


# Mount routers
app.include_router(admin, prefix="/api/v1/admin")
app.include_router(search, prefix="/api/v1/search")