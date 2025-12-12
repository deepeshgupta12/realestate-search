from fastapi import APIRouter
from app.api.admin import router as admin_router
from app.api.search import router as search_router

api_router = APIRouter()
api_router.include_router(admin_router)
api_router.include_router(search_router)
