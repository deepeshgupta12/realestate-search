from __future__ import annotations

import inspect
import importlib
from typing import Any, Callable, Dict, Optional
from urllib.parse import quote_plus

from fastapi import APIRouter, Query

router = APIRouter(prefix="/search", tags=["search"])


# ---------------------------
# Helpers: robust dynamic loaders (so we don't depend on exact function names)
# ---------------------------

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
    # dataclass-ish / attrs-ish
    if hasattr(obj, "__dict__"):
        return dict(obj.__dict__)
    return {"value": obj}


def _call_any(fn: Callable[..., Any], **kwargs: Any) -> Any:
    """
    Call fn with kwargs if possible, else fallback to positional based on fn signature.
    This avoids breaking if the underlying service uses (q, city_id, limit) positional args.
    """
    try:
        return fn(**kwargs)
    except TypeError:
        pass

    sig = inspect.signature(fn)
    params = list(sig.parameters.keys())

    # Common patterns we support:
    # (q, city_id, limit) or (q, city_id) or (q, limit) or (q)
    positional = []
    for name in params:
        if name in kwargs:
            positional.append(kwargs[name])
    return fn(*positional)


def _load_callable(module_name: str, candidates: list[str]) -> Callable[..., Any]:
    mod = importlib.import_module(module_name)
    for name in candidates:
        if hasattr(mod, name) and callable(getattr(mod, name)):
            return getattr(mod, name)
    raise RuntimeError(
        f"Could not find a callable in {module_name}. Tried: {candidates}"
    )


# Load underlying services with tolerant function-name matching
_suggest_fn = _load_callable(
    "app.search.suggest_service",
    ["suggest", "suggest_query", "get_suggestions", "autocomplete"],
)

_search_fn = _load_callable(
    "app.search.search_service",
    ["search", "search_query", "serp", "run_search"],
)

_trending_fn = _load_callable(
    "app.search.search_service",
    ["trending", "get_trending", "top_trending"],
)

_resolve_fn = _load_callable(
    "app.search.resolve_service",
    ["resolve", "resolve_query", "resolve_search"],
)


def _build_serp_url(q: str, city_id: Optional[str]) -> str:
    base = f"/search?q={quote_plus(q)}"
    if city_id:
        base += f"&city_id={quote_plus(city_id)}"
    return base


# ---------------------------
# Routes
# ---------------------------

@router.get("")
async def search(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
) -> Dict[str, Any]:
    """
    SERP-ish grouped results endpoint (your UI uses this for /search?q=... page).
    """
    res = await _maybe_await(_call_any(_search_fn, q=q, city_id=city_id, limit=limit))
    return _to_dict(res)


@router.get("/suggest")
async def suggest(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
) -> Dict[str, Any]:
    """
    Autocomplete endpoint used while typing.
    """
    res = await _maybe_await(_call_any(_suggest_fn, q=q, city_id=city_id, limit=limit))
    return _to_dict(res)


@router.get("/trending")
async def trending(
    city_id: Optional[str] = Query(None),
    limit: int = Query(8, ge=1, le=50),
) -> Dict[str, Any]:
    res = await _maybe_await(_call_any(_trending_fn, city_id=city_id, limit=limit))
    return _to_dict(res)


@router.get("/resolve")
async def resolve(
    q: str = Query(..., min_length=1),
    city_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """
    Resolve query to either:
      - redirect (entity canonical)
      - serp (constraint-heavy / ambiguous)
    FIX: if action == serp, ensure url is NEVER null.
    """
    res_obj = await _maybe_await(_call_any(_resolve_fn, q=q, city_id=city_id))
    res = _to_dict(res_obj)

    action = (res.get("action") or "").lower()

    # ✅ Critical fix for Step 2.1:
    # If we decide SERP, always return a URL.
    if action == "serp" and not res.get("url"):
        res["url"] = _build_serp_url(res.get("query") or q, city_id)

    return res


async def _maybe_await(x: Any) -> Any:
    if inspect.isawaitable(x):
        return await x
    return x