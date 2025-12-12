from __future__ import annotations

import importlib
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def _load_router(candidates: List[str]):
    """
    Load `router` from the first module that exists.
    This avoids hard-coding filenames like admin.py vs admin_routes.py, etc.
    """
    last_err = None
    for mod in candidates:
        try:
            m = importlib.import_module(mod)
            r = getattr(m, "router", None)
            if r is None:
                raise AttributeError(f"Module {mod} has no attribute `router`")
            return r
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(
        "Could not import a router from any candidate modules.\n"
        f"Tried: {candidates}\n"
        f"Last error: {last_err}"
    )


# ---- Router candidates (adjustable if needed) ----
ADMIN_CANDIDATES = [
    "app.api.v1.admin",
    "app.api.v1.admin_routes",
    "app.api.v1.admin_api",
    "app.api.v1.admin_router",
]

SEARCH_CANDIDATES = [
    "app.api.v1.search",
    "app.api.v1.search_api",
    "app.api.v1.search_routes",
    "app.api.v1.search_router",
]

RESOLVE_CANDIDATES = [
    "app.api.v1.search_resolve",
    "app.api.v1.resolve",
    "app.api.v1.search_resolve_api",
]

TRENDING_CANDIDATES = [
    "app.api.v1.search_trending",
    "app.api.v1.trending",
    "app.api.v1.search_trending_api",
]

PARSE_CANDIDATES = [
    "app.api.v1.search_parse",  # this is the file we created
]


app = FastAPI(title="RealEstate Search API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


# Mount routers (Elastic-backed)
admin_router = _load_router(ADMIN_CANDIDATES)
search_router = _load_router(SEARCH_CANDIDATES)
resolve_router = _load_router(RESOLVE_CANDIDATES)
trending_router = _load_router(TRENDING_CANDIDATES)
parse_router = _load_router(PARSE_CANDIDATES)

app.include_router(admin_router, prefix="/api/v1/admin")
app.include_router(search_router, prefix="/api/v1/search")
app.include_router(resolve_router, prefix="/api/v1/search")
app.include_router(trending_router, prefix="/api/v1/search")
app.include_router(parse_router, prefix="/api/v1/search")
