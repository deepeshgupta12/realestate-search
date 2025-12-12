from typing import Optional
from fastapi import APIRouter, Query

from app.search.suggest_service import suggest

router = APIRouter(prefix="/search", tags=["search"])

@router.get("/suggest")
def search_suggest(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = None,
    limit: int = Query(10, ge=1, le=25),
    context_url: Optional[str] = None,  # reserved for later use
):
    return suggest(q=q, city_id=city_id, limit=limit)
