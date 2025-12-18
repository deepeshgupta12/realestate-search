from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse, unquote


_PATH_ALLOWED = re.compile(r"^/[A-Za-z0-9._~:/?#\\[\\]@!$&'()*+,;=%\\-]*$")


def extract_path_candidate(raw: str) -> Optional[str]:
    """
    Accepts:
      - full URLs: https://example.com/pune/baner?x=1
      - absolute paths: /pune/baner
      - slug paths: pune/baner
      - domain+path without scheme: squareyards.com/pune/baner

    Returns a normalized path like: /pune/baner (no querystring), or None.
    """
    s = (raw or "").strip()
    if not s:
        return None

    path = s

    # Full URL
    if s.startswith("http://") or s.startswith("https://"):
        try:
            u = urlparse(s)
            path = u.path or ""
        except Exception:
            return None

    # domain/path without scheme (e.g. squareyards.com/pune/baner)
    if not path.startswith("/") and re.match(r"^[a-z0-9.-]+\.[a-z]{2,}/", path, re.IGNORECASE):
        path = "/" + path.split("/", 1)[1]

    # slug-like path (pune/baner)
    if not path.startswith("/"):
        if " " in path:
            return None
        path = "/" + path

    path = unquote(path)
    path = re.sub(r"/{2,}", "/", path)

    # trim trailing slash (except root)
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    # basic safety
    if not _PATH_ALLOWED.match(path):
        return None

    # avoid treating just "/" as meaningful
    if path == "/":
        return None

    return path