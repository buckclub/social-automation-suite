"""
Deterministic pre-TTS substitutions.

Run these BEFORE Ollama normalization so the resulting text is stable and
Ollama doesn't accidentally undo them. The substitutions are strictly
pattern-based — we don't want to call an LLM for every edge case.

Rules:
  * Reddit-style age+gender tags: "39F", "25 m", "(M32)", "[28f]"
    -> "thirty nine female", "twenty five male", "(thirty two male)", ...
  * TL;DR / TL:DR / TLDR -> "too long; didn't read"
  * AITA / YTA / NTA / ESH / NAH -> spelled out readings common in r/AITA
    (these always show up in the content and sound like gibberish via TTS).
  * Various common Reddit acronyms -> plain English.
"""
from __future__ import annotations
import re

# --- Number-to-words (0..120 covers all Reddit ages) -----------------------

_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def _num_words(n: int) -> str:
    if n < 0 or n > 999:
        return str(n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        t, o = divmod(n, 10)
        return _TENS[t] + ("" if o == 0 else " " + _ONES[o])
    if n == 100:
        return "one hundred"
    if n < 1000:
        h, rem = divmod(n, 100)
        return _ONES[h] + " hundred" + ("" if rem == 0 else " " + _num_words(rem))
    return str(n)


# --- Pattern builders -------------------------------------------------------

_SEX = {"m": "male", "f": "female"}

# Age+gender in either order. Require 2+ digit age so we don't catch
# "M3" (BMW), "F1" (Formula 1), etc. Reddit narrators skew adult anyway.
# Word boundaries guard against "25mg" / "A25M1".
_AGE_GENDER_NUM_FIRST = re.compile(
    r"(?<!\w)(\d{2,3})\s*([MmFf])(?!\w)"
)
_AGE_GENDER_GEN_FIRST = re.compile(
    r"(?<!\w)([MmFf])\s*(\d{2,3})(?!\w)"
)

# TL;DR / TL:DR / TLDR / Tl;dr / ... — optional punctuation between letters.
_TLDR = re.compile(r"\bTL\s*[;:,.\-]?\s*DR\b", re.IGNORECASE)

# Reddit acronyms we spell out. Only unambiguous ones — acronyms like OP / SO /
# BF / GF / INFO collide with regular words or names too often.
_ACRONYM_EXPANSIONS = {
    "AITA":   "am I the asshole",
    "AITAH":  "am I the asshole here",
    "YTA":    "you're the asshole",
    "YWBTA":  "you would be the asshole",
    "NTA":    "not the asshole",
    "YWNBTA": "you would not be the asshole",
    "ESH":    "everyone sucks here",
    "NAH":    "no assholes here",
    "IMO":    "in my opinion",
    "IMHO":   "in my humble opinion",
    "FWIW":   "for what it's worth",
    "IIRC":   "if I recall correctly",
    "AFAIK":  "as far as I know",
    "BIL":    "brother-in-law",
    "SIL":    "sister-in-law",
    "MIL":    "mother-in-law",
    "FIL":    "father-in-law",
    "DH":     "dear husband",
    "DW":     "dear wife",
}


def _age_gender_sub(m: re.Match, num_first: bool) -> str:
    if num_first:
        num = int(m.group(1))
        gen = m.group(2).lower()
    else:
        gen = m.group(1).lower()
        num = int(m.group(2))
    if num < 1 or num > 120:
        return m.group(0)  # don't touch "25M followers" (25 million)
    words = _num_words(num)
    sex = _SEX.get(gen, gen)
    return f"{words} {sex}" if num_first else f"{sex} {words}"


def apply_rules(text: str, *,
                expand_age_gender: bool = True,
                expand_tldr: bool = True,
                expand_acronyms: bool = True) -> str:
    """Return text with deterministic pre-TTS substitutions applied."""
    if not text:
        return text
    # First: normalize Unicode junk that occasionally leaks from Reddit JSON
    # or earlier Ollama passes. U+FFFD (replacement char) would otherwise reach
    # the TTS engine or poison whisper's initial_prompt.
    out = re.sub(
        r"[\ufffd\u2581\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]",
        "",
        text,
    )
    # Convert common smart-quotes to plain ASCII for consistent TTS.
    out = (out
           .replace("\u2018", "'").replace("\u2019", "'")
           .replace("\u201c", '"').replace("\u201d", '"')
           .replace("\u2013", "-").replace("\u2014", "-")
           .replace("\u2026", "..."))

    if expand_age_gender:
        out = _AGE_GENDER_NUM_FIRST.sub(lambda m: _age_gender_sub(m, True), out)
        out = _AGE_GENDER_GEN_FIRST.sub(lambda m: _age_gender_sub(m, False), out)

    if expand_tldr:
        out = _TLDR.sub("too long; didn't read", out)

    if expand_acronyms:
        # Word-boundary replacement, case-sensitive to avoid munging regular words.
        for acronym, expansion in _ACRONYM_EXPANSIONS.items():
            # Only replace when the token appears as a standalone word.
            pattern = r"(?<!\w)" + re.escape(acronym) + r"(?!\w)"
            out = re.sub(pattern, expansion, out)

    return out
