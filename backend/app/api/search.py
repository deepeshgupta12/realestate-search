from __future__ import annotations

from typing import Optional, Any, Dict
from urllib.parse import quote_plus

from fastapi import APIRouter, Query

from app.search.suggest_service import suggest
from app.search.resolve_service import resolve
from app.search.search_service import search, get_trending

router = APIRouter(prefix="/search", tags=["search"])


def _to_dict(obj: Any) -> Dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    # pydantic v2
    if hasattr(obj, "model_dump") and callable(getattr(obj, "model_dump")):
        return obj.model_dump()
    # pydantic v1
    if hasattr(obj, "dict") and callable(getattr(obj, "dict")):
        return obj.dict()
    # fallback
    if hasattr(obj, "__dict__"):
        return dict(obj.__dict__)
    return {"value": obj}


def _serp_url(q: str, city_id: Optional[str]) -> str:
    base = f"/search?q={quote_plus(q)}"
    if city_id:
        base += f"&city_id={quote_plus(city_id)}"
    return base


@router.get("")
@router.get("/")
def search_serp(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    limit: int = Query(20, ge=5, le=50),
    context_url: Optional[str] = None,
):
    # context_url reserved for future personalization/contextual ranking
    return search(q=q, city_id=city_id, limit=limit)


@router.get("/suggest")
def search_suggest(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    limit: int = Query(10, ge=1, le=25),
    context_url: Optional[str] = None,
):
    # context_url reserved for future personalization/contextual ranking
    return suggest(q=q, city_id=city_id, limit=limit)


@router.get("/resolve")
def search_resolve(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    context_url: Optional[str] = None,
):
    """
    Resolve query to either:
      - redirect to a clean URL (entity match)
      - serp for constraint-heavy queries

    HARD GUARANTEE:
    If action == "serp" then url is NEVER null.
    """
    res_obj = resolve(q=q, city_id=city_id)
    res = _to_dict(res_obj)

    action = (res.get("action") or "").lower()

    if action == "serp" and not res.get("url"):
        # use query from response if present, else fall back to incoming q
        qq = res.get("query") or q
        res["url"] = _serp_url(qq, city_id)

    return res


@router.get("/trending")
def search_trending(
    city_id: Optional[str] = None,
    limit: int = Query(10, ge=1, le=25),
):
    return {"city_id": city_id, "items": get_trending(city_id, limit)}