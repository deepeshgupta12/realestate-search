from __future__ import annotations

import re
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Query

router = APIRouter(tags=["search"])


BUDGET_RE = re.compile(
    r"""
    (?P<amount>\d+(\.\d+)?)
    \s*
    (?P<unit>cr|crore|l|lac|lakh|k)?
    """,
    re.IGNORECASE | re.VERBOSE,
)

BHK_RE = re.compile(r"(?P<bhk>\d+)\s*bhk", re.IGNORECASE)
INTENT_BUY_RE = re.compile(r"\b(buy|purchase)\b", re.IGNORECASE)
INTENT_RENT_RE = re.compile(r"\b(rent|rental|lease)\b", re.IGNORECASE)
UNDER_RE = re.compile(r"\b(under|below|upto|up to|<=)\b", re.IGNORECASE)
ABOVE_RE = re.compile(r"\b(above|over|>=|more than)\b", re.IGNORECASE)

PROPERTY_TYPE_MAP = {
    "apartment": ["apartment", "flat"],
    "builder_floor": ["builder floor", "floor"],
    "plot": ["plot", "land"],
    "villa": ["villa", "independent house", "house"],
    "office": ["office", "office space"],
    "retail": ["shop", "retail"],
}


def _normalize_space(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _parse_budget(q: str) -> Dict[str, Optional[float]]:
    ql = q.lower()
    matches = list(BUDGET_RE.finditer(ql))
    if not matches:
        return {"min": None, "max": None}

    # pick the last mentioned budget-like number (usually most relevant)
    m = matches[-1]
    amt = float(m.group("amount"))
    unit = (m.group("unit") or "").lower()

    # convert to INR absolute number (rough)
    # 1 Cr = 1e7, 1 Lakh = 1e5, 1K = 1e3
    if unit in ("cr", "crore"):
        value = amt * 1e7
    elif unit in ("l", "lac", "lakh"):
        value = amt * 1e5
    elif unit == "k":
        value = amt * 1e3
    else:
        # if no unit, treat as "lakhs" only if small; else treat as absolute
        value = amt * 1e5 if amt <= 200 else amt

    # determine direction based on nearby keywords
    window = ql[max(0, m.start() - 20) : min(len(ql), m.end() + 20)]
    if UNDER_RE.search(window) and not ABOVE_RE.search(window):
        return {"min": None, "max": value}
    if ABOVE_RE.search(window) and not UNDER_RE.search(window):
        return {"min": value, "max": None}

    # if ambiguous, default to max
    return {"min": None, "max": value}


def _parse_bhk(q: str) -> Optional[int]:
    m = BHK_RE.search(q)
    return int(m.group("bhk")) if m else None


def _parse_intent(q: str) -> Optional[str]:
    if INTENT_RENT_RE.search(q):
        return "rent"
    if INTENT_BUY_RE.search(q):
        return "buy"
    return None


def _parse_property_type(q: str) -> Optional[str]:
    ql = q.lower()
    for k, synonyms in PROPERTY_TYPE_MAP.items():
        for s in synonyms:
            if s in ql:
                return k
    return None


def _has_constraints(parsed: Dict[str, Any]) -> bool:
    return any(
        [
            parsed.get("bhk") is not None,
            parsed.get("budget", {}).get("min") is not None,
            parsed.get("budget", {}).get("max") is not None,
            parsed.get("intent") is not None,
            parsed.get("property_type") is not None,
        ]
    )


@router.get("/parse")
def parse_query(
    q: str = Query(..., min_length=1),
) -> Dict[str, Any]:
    raw = q
    q = _normalize_space(q)

    budget = _parse_budget(q)
    bhk = _parse_bhk(q)
    intent = _parse_intent(q)
    property_type = _parse_property_type(q)

    tokens: List[str] = []
    if bhk is not None:
        tokens.append(f"{bhk}bhk")
    if budget["max"] is not None:
        tokens.append("budget_max")
    if budget["min"] is not None:
        tokens.append("budget_min")
    if intent:
        tokens.append(intent)
    if property_type:
        tokens.append(property_type)

    parsed = {
        "q": raw,
        "normalized_q": q,
        "intent": intent,
        "bhk": bhk,
        "property_type": property_type,
        "budget": budget,
        "signals": tokens,
    }

    return {
        "ok": True,
        "parsed": parsed,
        "constraint_heavy": _has_constraints(parsed),
    }
