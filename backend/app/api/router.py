from fastapi import APIRouter

from app.api.v1.admin import router as admin_router
from app.api.v1.search import router as search_router
from app.api.v1.search_resolve import router as resolve_router
from app.api.v1.search_trending import router as trending_router
from app.api.v1.search_parse import router as parse_router

api_router = APIRouter()
api_router.include_router(admin_router, prefix="/admin")
api_router.include_router(search_router, prefix="/search")
api_router.include_router(resolve_router, prefix="/search")
api_router.include_router(trending_router, prefix="/search")
api_router.include_router(parse_router, prefix="/search")
