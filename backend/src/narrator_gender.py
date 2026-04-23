"""
Best-effort narrator (OP) gender detection from a Reddit post.

Strategies, in order:
1. Look for `I (32M)` / `me (28f)` / `as a 24F` patterns — narrator self-tag.
2. Fallback: first gender-age token in title (`(M37)`, `32F`).
3. Return None if nothing found.

Returns 'male', 'female', or None.
"""
from __future__ import annotations
import re
from typing import Optional

# Matches: 32M, 32m, M32, m32, (M32), [32F], etc.
_AGE_GENDER = r"(?:(?P<g1>[MmFf])\s*(?P<a1>\d{1,3}))|(?:(?P<a2>\d{1,3})\s*(?P<g2>[MmFf]))"

# Narrator-scoped: "I 32M", "me (F28)", "as a 24f", etc.
_NARRATOR = re.compile(
    r"\b(?:I|me|myself|as\s+a)\s*[\(\[\s,]*(?:" + _AGE_GENDER + r")",
    re.IGNORECASE,
)
# Any age+gender marker anywhere.
_ANY = re.compile(r"[\(\[]?\s*(?:" + _AGE_GENDER + r")\s*[\)\]]?")


def _gender_from_match(m: re.Match) -> Optional[str]:
    g = m.group("g1") or m.group("g2")
    if not g:
        return None
    return "male" if g.lower() == "m" else "female"


def detect_narrator_gender(title: str, body: str = "") -> Optional[str]:
    """Try increasingly loose strategies; return 'male' | 'female' | None."""
    blobs = [title or "", body or ""]

    # 1. Narrator self-tag anywhere in title or body — the strongest signal.
    for blob in blobs:
        m = _NARRATOR.search(blob)
        if m:
            g = _gender_from_match(m)
            if g:
                return g

    # 2. Spouse/partner heuristic from the title: if narrator mentions "my wife"
    #    the narrator is presumably male, "my husband" female, etc. This beats
    #    taking the first age+gender tag in the title, because that tag usually
    #    belongs to the spouse the narrator is talking about.
    low_title = (title or "").lower()
    if re.search(r"\bmy\s+(husband|boyfriend|fianc[eé])\b", low_title):
        return "female"
    if re.search(r"\bmy\s+(wife|girlfriend|fianc[eé]e)\b", low_title):
        return "male"

    # 3. First age+gender marker in the title (usually OP when no spouse noun).
    if title:
        m = _ANY.search(title)
        if m:
            g = _gender_from_match(m)
            if g:
                return g

    return None
