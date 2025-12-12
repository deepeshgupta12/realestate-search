from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Query

from app.api.router import (
    HealthResponse,
    ResolveResponse,
    SearchResponse,
    SuggestResponse,
)
from app.search.search_service import SearchService

router = APIRouter()


def _default_serp_url(q: str, city_id: str | None) -> str:
    q_enc = quote(q)
    if city_id:
        return f"/search?q={q_enc}&city_id={quote(city_id)}"
    return f"/search?q={q_enc}"


@router.get("/health", response_model=HealthResponse)
def health():
    return {"status": "ok"}


@router.get("/api/v1/search", response_model=SearchResponse)
def search(
    q: str = Query(..., min_length=1),
    city_id: str | None = None,
    limit: int = 10,
):
    svc = SearchService()
    return svc.search(q=q, city_id=city_id, limit=limit)


@router.get("/api/v1/search/suggest", response_model=SuggestResponse)
def suggest(
    q: str = Query(..., min_length=1),
    city_id: str | None = None,
    limit: int = 10,
):
    svc = SearchService()
    return svc.suggest(q=q, city_id=city_id, limit=limit)


@router.get("/api/v1/search/resolve", response_model=ResolveResponse)
def resolve(
    q: str = Query(..., min_length=1),
    city_id: str | None = None,
):
    svc = SearchService()
    res = svc.resolve(q=q, city_id=city_id)

    # Step 2.1 fix:
    # For constraint-heavy queries we intentionally route to SERP, but url should not be null.
    if getattr(res, "action", None) == "serp" and not getattr(res, "url", None):
        res.url = _default_serp_url(q, city_id)

    return res