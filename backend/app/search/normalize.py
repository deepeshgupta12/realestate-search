import re

_ws = re.compile(r"\s+")

def normalize_query(q: str) -> str:
    q = (q or "").strip()
    q = _ws.sub(" ", q)
    return q
