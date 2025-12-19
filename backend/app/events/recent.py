# backend/app/events/recent.py

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Set, Tuple

# Single source of truth for the log path (uses BASE_DIR/.events, not CWD)
from .store import SEARCH_LOG as SEARCH_LOG_PATH


@dataclass
class RecentQuery:
    """Lightweight representation of a recent search query."""
    raw_query: str
    normalized_query: str
    city_id: Optional[str] = None
    context_url: Optional[str] = None
    timestamp: Optional[str] = None  # ISO string


def _iter_log_lines(path: Path) -> Iterable[str]:
    """Yield lines from the log file in reverse order (newest first)."""
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8") as f:
        lines = f.readlines()

    return reversed(lines)


def load_recent_queries(
    city_id: Optional[str] = None,
    limit: int = 8,
    log_path: Optional[Path] = None,
) -> List[RecentQuery]:
    """
    Load deduplicated recent queries from the search events log.

    - Reads from <repo>/backend/.events/search.jsonl (via store.SEARCH_LOG)
    - Returns at most `limit` RecentQuery objects
    - Dedupes by (normalized_query.lower(), city_id)
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
            continue

        raw_q = (obj.get("raw_query") or "").strip()
        norm_q = (obj.get("normalized_query") or raw_q).strip()
        line_city = obj.get("city_id") or None
        ctx_url = obj.get("context_url") or None
        ts = obj.get("timestamp") or None

        if not norm_q:
            continue

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


def load_recent_searches(
    city_id: Optional[str] = None,
    limit: int = 8,
    log_path: Optional[Path] = None,
) -> List[RecentQuery]:
    """Alias wrapper for compatibility with older imports."""
    return load_recent_queries(city_id=city_id, limit=limit, log_path=log_path)