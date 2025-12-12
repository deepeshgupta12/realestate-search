from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.admin import router as admin_router
from app.api.v1.search import router as search_router
from app.api.v1.search_resolve import router as resolve_router
from app.api.v1.search_trending import router as trending_router
from app.api.v1.search_parse import router as parse_router

app = FastAPI(title="RealEstate Search API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health
@app.get("/health")
def health():
    return {"status": "ok"}

# API v1
app.include_router(admin_router, prefix="/api/v1/admin")
app.include_router(search_router, prefix="/api/v1/search")
app.include_router(resolve_router, prefix="/api/v1/search")
app.include_router(trending_router, prefix="/api/v1/search")
app.include_router(parse_router, prefix="/api/v1/search")
