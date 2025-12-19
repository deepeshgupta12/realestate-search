from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

# Base directory of backend (folder that contains app/)
# This file lives at: backend/app/events/store.py
# parents[0] = events, parents[1] = app, parents[2] = backend
BASE_DIR = Path(__file__).resolve().parents[2]


def _resolve_events_dir() -> Path:
    """
    Resolve the events directory deterministically relative to the backend folder,
    not the current working directory.

    Supports:
      - EVENTS_DIR=/abs/path
      - EVENTS_DIR=.events
      - EVENTS_DIR=backend/.events (backward-compat; strips redundant 'backend/')
    """
    env = os.getenv("EVENTS_DIR")
    if env:
        env_norm = env.replace("\\", "/")
        # Backward-compat: if someone sets EVENTS_DIR=backend/.events, strip redundant prefix
        if env_norm.startswith("backend/"):
            env_norm = env_norm[len("backend/") :]

        p = Path(env_norm)
        if not p.is_absolute():
            p = (BASE_DIR / p).resolve()
        return p

    # Default: <repo>/backend/.events
    return (BASE_DIR / ".events").resolve()


EVENTS_DIR = _resolve_events_dir()
EVENTS_DIR.mkdir(parents=True, exist_ok=True)

SEARCH_LOG = EVENTS_DIR / "search.jsonl"
CLICK_LOG = EVENTS_DIR / "click.jsonl"


class SearchEvent(BaseModel):
    query_id: str
    raw_query: str
    normalized_query: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: str


class ClickEvent(BaseModel):
    query_id: str
    entity_id: str
    entity_type: str
    rank: int
    url: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: str


def _append_jsonl(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(payload, separators=(",", ":"))
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def log_search_event(ev: SearchEvent) -> None:
    """Persist a search event to JSONL."""
    _append_jsonl(SEARCH_LOG, ev.model_dump())


def log_click_event(ev: ClickEvent) -> None:
    """Persist a click event to JSONL."""
    _append_jsonl(CLICK_LOG, ev.model_dump())