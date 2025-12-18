# backend/app/events/recent.py

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Set, Tuple


# Path to the JSONL search events file
SEARCH_LOG_PATH = Path(__file__).resolve().parent.parent / ".events" / "search.jsonl"


@dataclass
class RecentQuery:
    """Lightweight representation of a recent search query.

    We keep this intentionally simple so it is easy to evolve later.
    """
    raw_query: str
    normalized_query: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: Optional[str] = None  # ISO string; string is fine for display/sorting


def _iter_log_lines(path: Path) -> Iterable[str]:
    """Yield lines from the log file in reverse order (newest first).

    For dev / local usage, reading the whole file and reversing is fine.
    We can optimize later if needed.
    """
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8") as f:
        lines = f.readlines()

    # Newest events are at the bottom; iterate from newest to oldest
    return reversed(lines)


def load_recent_queries(
    city_id: Optional[str] = None,
    limit: int = 8,
    log_path: Optional[Path] = None,
) -> List[RecentQuery]:
    """Load deduplicated recent queries from the search events log.

    - Reads from backend/.events/search.jsonl
    - Returns at most `limit` RecentQuery objects
    - Dedupes by (normalized_query, city_id)
    - If `city_id` is provided, filters only that city
    """
    path = log_path or SEARCH_LOG_PATH
    results: List[RecentQuery] = []
    seen: Set[Tuple[str, Optional[str]]] = set()

    for line in _iter_log_lines(path):
        line = line.strip()
        if not line:
            continue

        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            # Skip malformed lines instead of crashing the endpoint
            continue

        raw_q = (obj.get("raw_query") or "").strip()
        norm_q = (obj.get("normalized_query") or raw_q).strip()
        line_city = obj.get("city_id") or None
        ctx_url = obj.get("context_url") or None
        ts = obj.get("timestamp") or None

        if not norm_q:
            continue

        # If caller passed a city_id, filter by that
        if city_id is not None and line_city != city_id:
            continue

        key = (norm_q.lower(), line_city)
        if key in seen:
            continue

        seen.add(key)

        results.append(
            RecentQuery(
                raw_query=raw_q or norm_q,
                normalized_query=norm_q,
                city_id=line_city,
                context_url=ctx_url,
                timestamp=ts,
            )
        )

        if len(results) >= limit:
            break

    return results


# Backwards-/forwards-compat alias used in some of our earlier iterations.
# main.py can safely import either name.
def load_recent_searches(
    city_id: Optional[str] = None,
    limit: int = 8,
    log_path: Optional[Path] = None,
) -> List[RecentQuery]:
    """Alias wrapper so both `load_recent_queries` and `load_recent_searches`
    can be used from main.py without breaking."""
    return load_recent_queries(city_id=city_id, limit=limit, log_path=log_path)