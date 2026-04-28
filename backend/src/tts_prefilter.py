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
  * Redundant title echoes at the start of the body (very common on
    r/AITA where people paste the title again, then "AITAH", then the
    real story).
  * Adjacent duplicate paragraphs / lines.
"""
from __future__ import annotations
import re
from difflib import SequenceMatcher

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
                expand_acronyms: bool = True,
                collapse_word_dupes: bool = True) -> str:
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

    if collapse_word_dupes:
        out = collapse_duplicate_words(out)

    return out


# --- Redundancy cleanup ----------------------------------------------------
#
# Reddit bodies frequently open by pasting the title verbatim, then a single-
# word acronym ("AITAH", "UPDATE"), then the actual story. When narrated the
# viewer hears the gist three times before the story even starts. These
# helpers strip those runs without touching mid-body text.

# Normalize for similarity comparison: lowercase, strip punctuation, collapse
# whitespace. We want "AITA for wanting X" and "am I the asshole for wanting X"
# to compare as similar strings after acronym expansion, so comparisons should
# happen AFTER apply_rules() has run.
_PUNCT = re.compile(r"[^\w\s]")
_SPACE = re.compile(r"\s+")

# Single-word fillers that add no information when repeated before the body.
_FILLER_OPENERS = {
    "aita", "aitah", "yta", "nta", "esh", "nah",
    "tldr", "tldr;", "tl;dr", "tl:dr", "update", "edit",
    "so", "ok", "okay", "alright", "hi", "hello",
}

# The prefilter's acronym expansions. We also check these so e.g. "AITAH"
# expanded to "am I the asshole here" still counts as a filler opener.
_FILLER_EXPANSIONS = {v.lower() for v in _ACRONYM_EXPANSIONS.values()}


def _norm(s: str) -> str:
    return _SPACE.sub(" ", _PUNCT.sub(" ", (s or "").lower())).strip()


def _similar(a: str, b: str) -> float:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _is_filler_opener(line: str) -> bool:
    """True if the line is just a short acronym / filler exclamation that
    adds zero story context — e.g. 'AITAH', 'EDIT:', 'So,' on its own."""
    n = _norm(line)
    if not n:
        return True
    if len(n) <= 4 and n in _FILLER_OPENERS:
        return True
    # Full-phrase match against the filler list or any acronym expansion.
    if n in _FILLER_OPENERS or n in _FILLER_EXPANSIONS:
        return True
    # "so" / "ok" by themselves with trailing punctuation.
    if len(n.split()) == 1 and n in _FILLER_OPENERS:
        return True
    return False


def remove_redundant_openers(body: str, title: str, *,
                             similarity_threshold: float = 0.82,
                             max_lines_to_strip: int = 4) -> str:
    """
    Drop leading paragraphs of `body` that are:
      * an exact / fuzzy duplicate of the title (≥ similarity_threshold), OR
      * a single-word filler opener (AITAH, EDIT, UPDATE, TLDR, etc.), OR
      * one-sentence paraphrase of the title (fuzzy match on the first
        sentence of the paragraph).

    Only strips from the very start — never touches mid-body text. Caps at
    `max_lines_to_strip` so a badly-similar body doesn't get gutted.
    """
    if not body:
        return body
    title_norm = _norm(title)
    if not title_norm:
        return body

    # Split on blank lines first (paragraphs), then within each paragraph we
    # also peek at the first line so a "AITA for X\nAITAH" paragraph gets
    # both halves stripped.
    paragraphs = re.split(r"\n\s*\n", body.strip())
    cleaned_paragraphs: list[str] = []
    stripped_count = 0
    still_at_start = True

    for p in paragraphs:
        if still_at_start and stripped_count < max_lines_to_strip:
            # Peel individual lines off the top of this paragraph.
            lines = [ln for ln in p.splitlines()]
            kept_lines: list[str] = []
            in_prefix = True
            for ln in lines:
                if in_prefix and stripped_count < max_lines_to_strip:
                    stripped = ln.strip()
                    if not stripped:
                        continue
                    if _is_filler_opener(stripped):
                        stripped_count += 1
                        continue
                    if _similar(stripped, title) >= similarity_threshold:
                        stripped_count += 1
                        continue
                    in_prefix = False
                kept_lines.append(ln)
            remainder = "\n".join(kept_lines).strip()
            if remainder:
                cleaned_paragraphs.append(remainder)
                still_at_start = False   # first non-empty paragraph kept
            # else: whole paragraph was stripped, keep scanning
        else:
            cleaned_paragraphs.append(p)

    return "\n\n".join(cleaned_paragraphs)


# Function words / short connectives that are *never* legitimately repeated
# back-to-back in English. Keep this list conservative — "had had", "that
# that", "is is" can all be valid in real prose, so we don't include them.
# These are the ones that always indicate a typo when doubled.
_NEVER_DOUBLED = {
    "and", "but", "or", "so", "the", "a", "an",
    "of", "to", "in", "on", "at", "for", "with",
    "then", "than", "from", "by", "as", "if",
    "i", "you", "he", "she", "we", "they", "it",
    "my", "your", "his", "her", "our", "their",
}

_WORD_RE = re.compile(r"[A-Za-z']+|[^A-Za-z'\s]+|\s+")


def collapse_duplicate_words(text: str) -> str:
    """
    Collapse erroneous adjacent duplicate words like "and and", "the the",
    "I I". Conservative: only collapses repeats of function words / pronouns
    that are never legitimately doubled, plus any 3+ identical-word runs
    (which are always typos regardless of the word).

    Punctuation between repeats blocks the collapse — "...and. And he..." is
    a valid sentence boundary, not a typo.
    """
    if not text:
        return text
    tokens = _WORD_RE.findall(text)
    out: list[str] = []
    # Walk tokens and collapse runs of an identical word separated only by
    # whitespace tokens. Track the last *word* token and how many times it
    # has appeared in a row so we can drop everything from the second
    # repeat onward.
    last_word_lower: str | None = None
    last_word_run: int = 0
    pending_ws: list[str] = []          # whitespace seen since last word
    for tok in tokens:
        if tok.isspace():
            pending_ws.append(tok)
            continue
        if re.match(r"[A-Za-z']+$", tok):
            low = tok.lower()
            if last_word_lower is not None and low == last_word_lower:
                # Repeat detected. Drop it (and the whitespace between)
                # if it's a function word OR we've already seen the word
                # twice in a row (3+ identical = always erroneous).
                if low in _NEVER_DOUBLED or last_word_run >= 2:
                    last_word_run += 1
                    pending_ws = []  # discard the whitespace we held back
                    continue
            # Not a collapse case → flush
            out.extend(pending_ws)
            pending_ws = []
            out.append(tok)
            last_word_lower = low
            last_word_run = 1
        else:
            # Punctuation / symbol token → flush and reset the run so
            # "and. And" doesn't get collapsed.
            out.extend(pending_ws)
            pending_ws = []
            out.append(tok)
            last_word_lower = None
            last_word_run = 0
    out.extend(pending_ws)
    return "".join(out)


def dedupe_adjacent_lines(text: str, *, similarity_threshold: float = 0.92) -> str:
    """
    Collapse consecutive duplicate (or near-duplicate) lines anywhere in
    the text. Common when the user wrote the same sentence twice by
    mistake, or Ollama normalization double-emitted a clause.
    """
    if not text:
        return text
    out_lines: list[str] = []
    prev_norm: str = ""
    for ln in text.splitlines():
        n = _norm(ln)
        if n and n == prev_norm:
            continue
        if n and prev_norm and _similar(ln, out_lines[-1] if out_lines else "") >= similarity_threshold:
            continue
        out_lines.append(ln)
        if n:
            prev_norm = n
    return "\n".join(out_lines)


def clean_redundant(body: str, title: str, *,
                    strip_title_echo: bool = True,
                    strip_adjacent_dupes: bool = True,
                    collapse_word_dupes: bool = True) -> str:
    """Convenience: apply all redundancy cleaners in the right order."""
    out = body
    if strip_title_echo:
        out = remove_redundant_openers(out, title)
    if strip_adjacent_dupes:
        out = dedupe_adjacent_lines(out)
    if collapse_word_dupes:
        out = collapse_duplicate_words(out)
    return out
