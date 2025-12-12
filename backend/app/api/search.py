from typing import Optional
from fastapi import APIRouter, Query

from app.search.suggest_service import suggest
from app.search.resolve_service import resolve

router = APIRouter(prefix="/search", tags=["search"])

@router.get("/suggest")
def search_suggest(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    limit: int = Query(10, ge=1, le=25),
    context_url: Optional[str] = None,
):
    return suggest(q=q, city_id=city_id, limit=limit)

@router.get("/resolve")
def search_resolve(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    context_url: Optional[str] = None,
):
    return resolve(q=q, city_id=city_id, context_url=context_url)
