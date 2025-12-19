"""
Square Yards - Real Estate Search (v0 + v1)

This file is intentionally self-contained to avoid dependency mismatches while we iterate on resolver logic.
It implements:
- /api/v1/search/resolve (resolver)
- /api/v1/search/zero-state (recent + trending)
- /api/v1/events/search + /api/v1/events/click (jsonl event logging)

Key v1 behaviors implemented:
- Page intent routing: rate_page + locality_overview
- Constraint-heavy routing to listing paths: /<scope>/<buy|rent>?<filters>
- Builder intent routing: "dlf projects in noida" -> /noida/buy?builder_id=builder_dlf
- Project + constraints routing: "godrej woods resale" / "godrej woods rent under 30k" ->
  /noida/buy?project_id=... or /noida/rent?project_id=...&max_rent=30000
"""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode, quote_plus

from fastapi import APIRouter, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# -----------------------------
# Config
# -----------------------------

APP_TITLE = "realestate-search-backend"

MIN_REDIRECT_SCORE = float(os.getenv("MIN_REDIRECT_SCORE", "7.0"))
MIN_REDIRECT_GAP = float(os.getenv("MIN_REDIRECT_GAP", "0.35"))

# Event logs directory:
# We want: <repo_root>/backend/.events/*.jsonl (as you observed).
# backend/app/main.py -> parents: app/ (0), backend/ (1), repo_root/ (2)
REPO_ROOT = Path(__file__).resolve().parents[2] if len(Path(__file__).resolve().parents) >= 3 else Path.cwd()
BACKEND_DIR = REPO_ROOT / "backend"
EVENT_LOG_DIR = Path(os.getenv("EVENT_LOG_DIR", str(BACKEND_DIR / ".events")))
EVENT_LOG_DIR.mkdir(parents=True, exist_ok=True)

SEARCH_EVENTS_PATH = EVENT_LOG_DIR / "search.jsonl"
CLICK_EVENTS_PATH = EVENT_LOG_DIR / "click.jsonl"

# Optional redirects registry (clean path -> target)
REDIRECTS: Dict[str, str] = {}

# -----------------------------
# Models
# -----------------------------

class EntityOut(BaseModel):
    id: str
    entity_type: str
    name: str
    city: str = ""
    city_id: str = ""
    parent_name: str = ""
    canonical_url: str = ""
    score: Optional[float] = None
    popularity_score: Optional[float] = None


class ResolveResponse(BaseModel):
    action: str  # redirect | serp | disambiguate
    query: str
    normalized_query: str
    url: Optional[str] = None
    match: Optional[EntityOut] = None
    candidates: Optional[List[EntityOut]] = None
    reason: str
    debug: Optional[Dict[str, Any]] = None


class ParseResponse(BaseModel):
    q: str
    intent: Optional[str] = None  # buy | rent
    bhk: Optional[int] = None
    locality_hint: Optional[str] = None
    page_intent: Optional[str] = None  # rate_page | locality_overview | listing
    location_query: Optional[str] = None
    property_type: Optional[str] = None
    status: Optional[str] = None
    min_price: Optional[int] = None
    max_price: Optional[int] = None
    min_rent: Optional[int] = None
    max_rent: Optional[int] = None
    builder_hint: Optional[str] = None
    ok: bool = True


class SearchEventIn(BaseModel):
    query_id: str
    raw_query: str
    normalized_query: str
    city_id: Optional[str] = None
    context_url: str = "/"
    timestamp: str


class ClickEventIn(BaseModel):
    query_id: str
    entity_id: str
    entity_type: str
    rank: int
    url: str
    city_id: Optional[str] = None
    context_url: str = "/"
    timestamp: str


class RecentSearchOut(BaseModel):
    q: str
    city_id: Optional[str] = None
    context_url: str = "/"
    timestamp: str


class ZeroStateResponse(BaseModel):
    city_id: Optional[str] = None
    recent_searches: List[RecentSearchOut] = Field(default_factory=list)
    trending_searches: List[EntityOut] = Field(default_factory=list)
    trending_localities: List[EntityOut] = Field(default_factory=list)
    popular_entities: List[EntityOut] = Field(default_factory=list)


# -----------------------------
# App
# -----------------------------

app = FastAPI(title=APP_TITLE)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api/v1")
search = APIRouter(prefix="/search", tags=["search"])
events = APIRouter(prefix="/events", tags=["events"])

# -----------------------------
# Utility helpers
# -----------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_q(q: Optional[str]) -> str:
    """Safe normalizer: handles None and trims+lowercases."""
    if not q:
        return ""
    q = str(q)
    return re.sub(r"\s+", " ", q.strip()).lower()


def slugify(s: str) -> str:
    s = normalize_q(s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def city_slug_from_city_id(city_id: Optional[str]) -> Optional[str]:
    if not city_id:
        return None
    if city_id.startswith("city_"):
        return city_id[len("city_") :]
    return slugify(city_id)


def clean_path_from_anything(raw: str) -> Optional[str]:
    """Extract a plausible path (/pune/baner) from a query that might be a full URL."""
    s = (raw or "").strip()
    if not s:
        return None

    # full URL -> keep path+query-ish, but we only want path
    s = re.sub(r"^https?://[^/]+", "", s)
    s = s.strip()

    if not s.startswith("/"):
        # maybe a slug like "pune/baner"
        if "/" in s:
            s = "/" + s
        else:
            return None

    # normalize multiple slashes
    s = re.sub(r"/{2,}", "/", s)

    # drop querystring/fragment
    s = s.split("?", 1)[0].split("#", 1)[0]
    if s == "":
        return None
    return s


def build_serp_url(q: str, city_id: Optional[str], context_url: Optional[str]) -> str:
    params = {"q": q}
    if city_id:
        params["city_id"] = city_id
    if context_url:
        params["context_url"] = context_url
    return "/search?" + urlencode(params, quote_via=quote_plus)


def money_to_rupees(v: float, unit: str) -> int:
    u = (unit or "").lower()
    if u in ("cr", "crore", "crores"):
        return int(v * 10_000_000)
    if u in ("l", "lac", "lakh", "lakhs"):
        return int(v * 100_000)
    if u in ("k",):
        return int(v * 1000)
    # default assume rupees
    return int(v)


# -----------------------------
# Parsing
# -----------------------------

def parse_query(q: str) -> ParseResponse:
    """Parse lightweight intent + constraints from a free-form search query."""
    raw = q or ""
    s = normalize_q(raw)

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
    elif re.search(r"\bbuy\b|\bresale\b|\bsale\b|\bfor\s+sale\b", s):
        intent = "buy"

    # ------------------
    # BHK
    # ------------------
    bhk: Optional[int] = None
    m = re.search(r"\b([1-6])\s*bhk\b", s) or re.search(r"\b([1-6])bhk\b", s)
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
        ("builder_floor", r"\b(builder\s*floor|builder\s*floor\s*s)\b"),
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
    # Builder hint ("dlf projects", "projects by dlf")
    # ------------------
    builder_hint: Optional[str] = None
    m = re.search(r"\bprojects?\s+by\s+([a-z0-9 \-]+?)(?:\s+in\s+|$)", s)
    if m:
        builder_hint = m.group(1).strip()
    else:
        # prefix style: "<builder> projects in <city>"
        m = re.search(r"\b([a-z0-9 \-]+?)\s+projects?\b", s)
        if m and len(m.group(1).strip()) <= 30:
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

    # Decide listing intent: constraints or intent implies listing
    if page_intent is None and any(v is not None for v in (bhk, status, property_type, min_price, max_price, min_rent, max_rent, intent, builder_hint)):
        page_intent = "listing"

    # ------------------
    # Location-ish remainder
    # ------------------
    loc = s
    # remove non-location tokens
    loc = re.sub(rate_re, " ", loc)
    loc = re.sub(overview_re, " ", loc)
    loc = re.sub(r"\b([1-6])\s*bhk\b", " ", loc)
    loc = re.sub(r"\b(?:buy|resale|sale|rent|rental|tenant)\b", " ", loc)
    loc = re.sub(r"\b(ready\s*to\s*move|rtm|ready|under\s*construction|uc)\b", " ", loc)
    loc = re.sub(r"\b(builder\s*floor|apartment|flat|plot|land|villa|independent\s*house|house|office|shop|retail)\b", " ", loc)
    loc = re.sub(r"\bprojects?\b", " ", loc)
    loc = re.sub(r"\bby\b", " ", loc)

    # remove budget phrases
    loc = re.sub(r"\bbetween\b[\s\S]{0,40}\b(?:cr|crore|l|lac|lakh|k)\b", " ", loc)
    loc = re.sub(r"\b(?:under|below|upto|up\s*to|less\s*than|max|above|over|more\s*than|min)\b[\s\S]{0,20}\b(?:cr|crore|l|lac|lakh|k)\b", " ", loc)

    # cleanup stopwords
    loc = re.sub(r"\b(in|near|at|for|with|without|and|to|of)\b", " ", loc)
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


def is_constraint_heavy(q: str) -> bool:
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
            parsed.builder_hint,
        )
    ) or (parsed.page_intent == "listing")


# -----------------------------
# ES adapter (minimal)
# -----------------------------

try:
    from elasticsearch import Elasticsearch, NotFoundError  # type: ignore
except Exception:  # pragma: no cover
    Elasticsearch = None  # type: ignore
    NotFoundError = Exception  # type: ignore


ES_URL = os.getenv("ES_URL", "http://localhost:9200")
ES_INDEX = os.getenv("ES_INDEX", "re_entities_v1")  # index name (override via env)
INDEX_NAME = ES_INDEX  # backward-compatible alias

_es = Elasticsearch(ES_URL) if Elasticsearch else None


def _es_available() -> bool:
    if _es is None:
        return False
    try:
        _es.info()
        return True
    except Exception:
        return False


def hit_to_entity(hit: Dict[str, Any]) -> EntityOut:
    src = hit.get("_source") or {}
    return EntityOut(
        id=str(src.get("id") or src.get("entity_id") or hit.get("_id") or ""),
        entity_type=str(src.get("entity_type") or src.get("type") or ""),
        name=str(src.get("name") or ""),
        city=str(src.get("city") or ""),
        city_id=str(src.get("city_id") or ""),
        parent_name=str(src.get("parent_name") or ""),
        canonical_url=str(src.get("canonical_url") or src.get("url") or ""),
        score=float(hit.get("_score") or 0.0) if hit.get("_score") is not None else None,
        popularity_score=float(src.get("popularity_score")) if src.get("popularity_score") is not None else None,
    )


def es_search_entities(
    q: str,
    limit: int,
    city_id: Optional[str],
    entity_types: Optional[List[str]] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    """Search entities. city_id is required in our earlier signatures; we keep it explicit but allow None."""
    if not _es_available():
        return ([], 0)

    must: List[Dict[str, Any]] = []
    filt: List[Dict[str, Any]] = []

    if q:
        must.append(
            {
                "multi_match": {
                    "query": q,
                    "fields": ["name^4", "name.ngram^2", "canonical_url^1"],
                    "type": "best_fields",
                    "operator": "and",
                }
            }
        )

    if city_id:
        filt.append({"term": {"city_id": city_id}})

    if entity_types:
        filt.append({"terms": {"entity_type": entity_types}})

    body = {"size": limit, "query": {"bool": {"must": must or [{"match_all": {}}], "filter": filt}}}
    # Search with index fallback (helps when ES_INDEX env differs across setups)
    indices_to_try = [ES_INDEX]
    for cand in ("re_entities_v1", "entities_v0", "entities"):
        if cand and cand not in indices_to_try:
            indices_to_try.append(cand)
    last_err = None
    res = None
    for idx in indices_to_try:
        try:
            res = _es.search(index=idx, body=body)
            if idx != ES_INDEX:
                # update global so future calls use the working index
                globals()["ES_INDEX"] = idx
                globals()["INDEX_NAME"] = idx
            break
        except NotFoundError as e:  # type: ignore[name-defined]
            last_err = e
            continue
    if res is None:
        # Re-raise the last error so we don't mask genuine ES issues
        raise last_err  # type: ignore[misc]
    hits = (res.get("hits") or {}).get("hits") or []
    total = (res.get("hits") or {}).get("total") or {}
    total_v = int(total.get("value") or len(hits))
    return hits[:limit], total_v


def es_lookup_by_canonical_url(path: str) -> Optional[Dict[str, Any]]:
    if not _es_available():
        return None
    body = {"size": 1, "query": {"term": {"canonical_url.keyword": path}}}
    # Search with index fallback (helps when ES_INDEX env differs across setups)
    indices_to_try = [ES_INDEX]
    for cand in ("re_entities_v1", "entities_v0", "entities"):
        if cand and cand not in indices_to_try:
            indices_to_try.append(cand)
    last_err = None
    res = None
    for idx in indices_to_try:
        try:
            res = _es.search(index=idx, body=body)
            if idx != ES_INDEX:
                globals()["ES_INDEX"] = idx
                globals()["INDEX_NAME"] = idx
            break
        except NotFoundError as e:  # type: ignore[name-defined]
            last_err = e
            continue
    if res is None:
        raise last_err  # type: ignore[misc]
    hits = (res.get("hits") or {}).get("hits") or []
    return hits[0] if hits else None


# -----------------------------
# Listing URL builder
# -----------------------------

def build_listing_url(entity: EntityOut, parsed: ParseResponse, *, force_intent: Optional[str] = None) -> str:
    """
    Listing URL rules (v1):
    - Location scope (city/locality/micromarket/listing_page/locality_overview):
        <canonical>/<buy|rent>?filters
      e.g. /pune/baner/rent?bhk=2&max_rent=30000
    - Project scope:
        /<city_slug>/<buy|rent>?project_id=<id>&filters
      e.g. /noida/buy?project_id=proj_godrej_woods&bhk=2&max_price=15000000
    - Builder scope (handled by resolve; also supported here if entity_type == builder):
        /<city_slug>/<buy|rent>?builder_id=<id>
    """
    intent_raw = (force_intent or parsed.intent or "buy").strip().lower()
    segment = "rent" if intent_raw == "rent" else "buy"

    params: Dict[str, Any] = {}

    # Common filters
    if parsed.bhk is not None:
        params["bhk"] = parsed.bhk
    if parsed.status:
        params["status"] = parsed.status
    if parsed.property_type:
        params["property_type"] = parsed.property_type

    if parsed.min_price is not None:
        params["min_price"] = parsed.min_price
    if parsed.max_price is not None:
        params["max_price"] = parsed.max_price

    if parsed.min_rent is not None:
        params["min_rent"] = parsed.min_rent
    if parsed.max_rent is not None:
        params["max_rent"] = parsed.max_rent

    # Special IDs (may be set by resolve)
    builder_id = getattr(parsed, "builder_id", None)
    if builder_id:
        params["builder_id"] = builder_id

    if entity.entity_type == "project":
        # Project listing is city-scoped listing with project_id filter
        city_slug = city_slug_from_city_id(entity.city_id) or slugify(entity.city) or ""
        base = f"/{city_slug}/{segment}" if city_slug else f"/{segment}"
        params["project_id"] = entity.id
        qs = urlencode(params, quote_via=quote_plus)
        return base + (f"?{qs}" if qs else "")

    if entity.entity_type == "builder":
        # Builder listing is city-scoped; city must come from parsed or elsewhere.
        city_slug = city_slug_from_city_id(getattr(parsed, "city_id", None)) or ""
        base = f"/{city_slug}/{segment}" if city_slug else f"/{segment}"
        params["builder_id"] = entity.id
        qs = urlencode(params, quote_via=quote_plus)
        return base + (f"?{qs}" if qs else "")

    base = (entity.canonical_url or "").rstrip("/") or "/"
    if entity.entity_type in ("city", "micromarket", "locality", "listing_page", "locality_overview"):
        base = f"{base}/{segment}" if base != "/" else f"/{segment}"

    qs = urlencode(params, quote_via=quote_plus)
    return base + (f"?{qs}" if qs else "")


def _pick_best(entities: List[EntityOut], *, name_key: Optional[str] = None, prefer_types: Optional[List[str]] = None) -> EntityOut:
    """Pick best candidate; optionally prefer exact name and certain entity types."""
    if not entities:
        raise ValueError("No entities to pick from")

    prefer_types = prefer_types or []

    def score_key(e: EntityOut) -> Tuple[int, int, float, float]:
        # (type preference, exact name, es score, popularity)
        type_pref = 0
        if prefer_types and e.entity_type in prefer_types:
            type_pref = 1
        exact = 0
        if name_key and normalize_q(e.name) == name_key:
            exact = 1
        es_score = float(e.score or 0.0)
        pop = float(e.popularity_score or 0.0)
        return (type_pref, exact, es_score, pop)

    return sorted(entities, key=score_key, reverse=True)[0]


# -----------------------------
# Events store + read
# -----------------------------

def _append_jsonl(path: Path, obj: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def _read_jsonl_tail(path: Path, limit: int) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    # Small file heuristic: read all and slice (fine for v0/v1)
    lines = path.read_text(encoding="utf-8").splitlines()
    out: List[Dict[str, Any]] = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
        if len(out) >= limit:
            break
    return list(reversed(out))


# -----------------------------
# Zero-state (simple + deterministic)
# -----------------------------

# If ES is down, these will be empty; the endpoint still works.
def _get_popular_entities(limit: int, city_id: Optional[str]) -> List[EntityOut]:
    hits, _ = es_search_entities(q="", limit=limit, city_id=city_id, entity_types=None)
    ents = [hit_to_entity(h) for h in hits]
    # When query is empty, ES match_all ranking may be arbitrary; prefer popularity_score.
    ents = sorted(ents, key=lambda e: float(e.popularity_score or 0.0), reverse=True)
    return ents[:limit]


def _get_trending_localities(limit: int, city_id: Optional[str]) -> List[EntityOut]:
    hits, _ = es_search_entities(q="", limit=limit * 3, city_id=city_id, entity_types=["city", "micromarket", "locality"])
    ents = [hit_to_entity(h) for h in hits]
    ents = sorted(ents, key=lambda e: float(e.popularity_score or 0.0), reverse=True)
    return ents[:limit]


def _get_recent_searches(limit: int, city_id: Optional[str]) -> List[RecentSearchOut]:
    rows = _read_jsonl_tail(SEARCH_EVENTS_PATH, limit=200)
    out: List[RecentSearchOut] = []
    seen: set = set()

    for r in reversed(rows):
        qv = r.get("normalized_query") or r.get("raw_query") or ""
        qv = normalize_q(qv)
        if not qv:
            continue

        # city scoping
        if city_id and (r.get("city_id") != city_id):
            continue

        key = (qv, r.get("city_id") or "", r.get("context_url") or "")
        if key in seen:
            continue
        seen.add(key)

        out.append(
            RecentSearchOut(
                q=qv,
                city_id=r.get("city_id"),
                context_url=r.get("context_url") or "/",
                timestamp=r.get("timestamp") or now_iso(),
            )
        )
        if len(out) >= limit:
            break

    return out


# -----------------------------
# Endpoints
# -----------------------------

@api.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "ts": now_iso(),
        "es_available": _es_available(),
        "es_index": ES_INDEX,
        "event_log_dir": str(EVENT_LOG_DIR),
    }


@events.post("/search")
def log_search(ev: SearchEventIn) -> Dict[str, Any]:
    _append_jsonl(SEARCH_EVENTS_PATH, ev.dict())
    return {"ok": True}


@events.post("/click")
def log_click(ev: ClickEventIn) -> Dict[str, Any]:
    _append_jsonl(CLICK_EVENTS_PATH, ev.dict())
    return {"ok": True}


@search.get("/zero-state", response_model=ZeroStateResponse)
def zero_state(limit: int = 8, city_id: Optional[str] = None) -> ZeroStateResponse:
    limit = max(1, min(int(limit or 8), 20))
    recent = _get_recent_searches(limit=limit, city_id=city_id)
    trending_searches = _get_popular_entities(limit=limit, city_id=city_id)
    trending_localities = _get_trending_localities(limit=min(limit, 8), city_id=city_id)
    popular_entities = trending_searches

    return ZeroStateResponse(
        city_id=city_id,
        recent_searches=recent,
        trending_searches=trending_searches,
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
                normalized_query=normalize_q(raw_q),
                url=target,
                reason="redirect_registry",
                debug={"clean_path": clean_path, "target": target},
            )

        hit = es_lookup_by_canonical_url(clean_path)
        if hit:
            ent = hit_to_entity(hit)
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=normalize_q(raw_q),
                url=ent.canonical_url,
                match=ent,
                reason="clean_url",
                debug={"clean_path": clean_path},
            )
        # If looks like a path but not found: fall through to normal resolver (SERP/no_results)

    parsed = parse_query(raw_q)

    # V1.1: page intent (rates / locality overview)
    if parsed.page_intent in ("rate_page", "locality_overview") and parsed.location_query:
        hits, _ = es_search_entities(
            q=parsed.location_query,
            limit=10,
            city_id=city_id,
            entity_types=[parsed.page_intent],
        )
        ents = [hit_to_entity(h) for h in hits]
        if ents:
            name_key = normalize_q(parsed.location_query)
            picked = _pick_best(ents, name_key=name_key)
            return ResolveResponse(
                action="redirect",
                query=raw_q,
                normalized_query=parsed.q,
                url=picked.canonical_url,
                match=picked,
                reason="page_intent_city_scoped" if city_id else "page_intent_redirect",
                debug={"page_intent": parsed.page_intent, "picked": picked.id, "city_id": city_id},
            )

    # V1.3: builder intent -> listing with builder_id
    # if query contains a builder hint AND has a location target, route to listing
    if parsed.builder_hint and parsed.location_query:
        # Resolve builder entity
        bhits, _ = es_search_entities(q=parsed.builder_hint, limit=5, city_id=None, entity_types=["builder"])
        bents = [hit_to_entity(h) for h in bhits]
        if bents:
            builder = _pick_best(bents, name_key=normalize_q(parsed.builder_hint))
            # Resolve location entity (prefer city/locality/micromarket)
            lhits, _ = es_search_entities(q=parsed.location_query, limit=10, city_id=city_id, entity_types=["city", "micromarket", "locality", "listing_page"])
            lents = [hit_to_entity(h) for h in lhits]
            if lents:
                loc = _pick_best(lents, name_key=normalize_q(parsed.location_query), prefer_types=["city", "locality", "micromarket"])
                # attach builder_id and build listing url
                setattr(parsed, "builder_id", builder.id)
                listing_url = build_listing_url(loc, parsed)
                return ResolveResponse(
                    action="redirect",
                    query=raw_q,
                    normalized_query=parsed.q,
                    url=listing_url,
                    match=loc,
                    reason="builder_intent_listing",
                    debug={"builder_hint": parsed.builder_hint, "builder_id": builder.id, "base": loc.canonical_url, "city_id": city_id},
                )

    # 2.7A: constraint-heavy → try listing redirect
    if is_constraint_heavy(raw_q):
        location_q = parsed.locality_hint or parsed.location_query
        if location_q:
            # Search broadly; we'll filter allowed scopes
            hits, _ = es_search_entities(q=location_q, limit=12, city_id=city_id, entity_types=None)
            entities = [hit_to_entity(h) for h in hits]

            # Allow: city/micromarket/locality/listing_page/locality_overview/project
            scopes = [e for e in entities if e.entity_type in ("city", "micromarket", "locality", "listing_page", "locality_overview", "project")]
            if scopes:
                key = normalize_q(location_q)

                # City scoped: prefer in-city; then prefer project if exact match
                if city_id:
                    in_city = [e for e in scopes if e.city_id == city_id]
                    if in_city:
                        picked = _pick_best(in_city, name_key=key, prefer_types=["project", "locality", "city", "micromarket"])
                        listing_url = build_listing_url(picked, parsed)
                        return ResolveResponse(
                            action="redirect",
                            query=raw_q,
                            normalized_query=parsed.q,
                            url=listing_url,
                            match=picked,
                            reason="constraint_heavy_city_scoped_listing",
                            debug={"city_id": city_id, "base": picked.canonical_url or picked.id},
                        )

                # Not city-scoped: if multiple cities and same-name, disambiguate
                by_name: Dict[str, List[EntityOut]] = {}
                for e in scopes:
                    by_name.setdefault(normalize_q(e.name), []).append(e)
                candidates = by_name.get(key, scopes)

                cities = sorted({c.city_id for c in candidates if c.city_id})
                if len(candidates) > 1 and len(cities) > 1 and not city_id:
                    return ResolveResponse(
                        action="disambiguate",
                        query=raw_q,
                        normalized_query=parsed.q,
                        candidates=candidates[:10],
                        reason="constraint_heavy_same_name",
                        debug={"candidate_count": len(candidates), "cities": cities},
                    )

                if candidates:
                    picked = _pick_best(candidates, name_key=key, prefer_types=["project", "locality", "city", "micromarket"])
                    listing_url = build_listing_url(picked, parsed)
                    return ResolveResponse(
                        action="redirect",
                        query=raw_q,
                        normalized_query=parsed.q,
                        url=listing_url,
                        match=picked,
                        reason="constraint_heavy_listing",
                        debug={"base": picked.canonical_url or picked.id},
                    )

        # fallback: SERP
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=parsed.q,
            url=build_serp_url(raw_q, city_id=city_id, context_url=context_url),
            reason="constraint_heavy",
        )

    # Normal resolver (no constraints)
    hits, _ = es_search_entities(q=raw_q, limit=10, city_id=city_id, entity_types=None)
    if not hits:
        return ResolveResponse(
            action="serp",
            query=raw_q,
            normalized_query=normalize_q(raw_q),
            url=build_serp_url(raw_q, city_id=city_id, context_url=context_url),
            reason="no_results",
        )

    entities = [hit_to_entity(h) for h in hits]

    # Same-name disambiguation
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

    # Score-gap heuristic (if ES scores exist)
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
            debug={"top_score": top_score, "second_score": second_score, "gap": gap, "city_id": city_id},
        )

    return ResolveResponse(
        action="serp",
        query=raw_q,
        normalized_query=normalize_q(raw_q),
        url=build_serp_url(raw_q, city_id=city_id, context_url=context_url),
        reason="ambiguous",
        debug={"top_score": top_score, "second_score": second_score, "gap": gap, "city_id": city_id},
    )


api.include_router(search)
api.include_router(events)
app.include_router(api)