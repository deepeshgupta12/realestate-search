from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple


# Base paths
BACKEND_DIR = Path(__file__).resolve().parents[2]
EVENTS_DIR = BACKEND_DIR / ".events"
SEARCH_EVENTS_PATH = EVENTS_DIR / "search.jsonl"


@dataclass
class RecentQuery:
    """Lightweight representation of a recent search query."""

    q: str
    city_id: Optional[str]
    ts: Optional[str]


def _load_all_events() -> List[dict]:
    """Load all search events from the JSONL file (if present)."""
    if not SEARCH_EVENTS_PATH.exists():
        return []

    events: List[dict] = []
    with SEARCH_EVENTS_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                # Ignore corrupt lines instead of breaking entire feature
                continue
            events.append(ev)
    return events


def load_recent_queries(
    city_id: Optional[str] = None,
    limit: int = 5,
) -> List[RecentQuery]:
    """
    Return up to `limit` de-duplicated recent queries from the search event log.

    Behaviour:
    - Walks events in reverse (latest first)
    - Dedupes by (normalized_query, city_id)
    - If `city_id` is provided:
        - Prefer events with that city_id
        - If not enough, backfill with global events
    - If `city_id` is None:
        - Just return global latest unique queries
    """
    events = _load_all_events()
    if not events:
        return []

    seen: set[Tuple[str, Optional[str]]] = set()
    preferred: List[RecentQuery] = []
    fallback: List[RecentQuery] = []

    for ev in reversed(events):  # latest events last in file → iterate reversed
        raw_q = (ev.get("raw_query") or ev.get("normalized_query") or "").strip()
        if not raw_q:
            continue

        ev_city = ev.get("city_id") or None
        norm = (ev.get("normalized_query") or raw_q).strip().lower()
        key = (norm, ev_city)

        if key in seen:
            continue
        seen.add(key)

        item = RecentQuery(
            q=raw_q,
            city_id=ev_city,
            ts=ev.get("timestamp") or None,
        )

        if city_id and ev_city == city_id:
            preferred.append(item)
        else:
            fallback.append(item)

        if len(preferred) + len(fallback) >= limit * 3:
            # Hard cap to avoid scanning huge logs unnecessarily
            break

    # Merge preferred (same-city) first, then fallback
    result: List[RecentQuery] = []
    for item in preferred:
        if len(result) >= limit:
            break
        result.append(item)

    if len(result) < limit:
        for item in fallback:
            if len(result) >= limit:
                break
            result.append(item)

    return result