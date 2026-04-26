"""
Myinstants browser — pulls trending + search results from
myinstants.com so users can import meme/viral sounds into the local
SFX library without manual download.

Why myinstants specifically:
  - It's the de facto meme-sound library on the internet. Trending
    page tracks what's actually being used in viral content right
    now — same sounds you hear on TikTok/Instagram/Shorts.
  - Public site, every sound has a direct .mp3 URL the page exposes
    via a `data-url` attribute on its play button.
  - No API, but the HTML structure is stable enough that regex
    extraction beats pulling in BeautifulSoup as a dependency for
    one feature.

Scope here is just BROWSE + IMPORT. The actual SFX storage and
tagging is in sfx_library.py — once we download an mp3 from
myinstants we hand off to that module.

Legal reality: many myinstants sounds are clips from copyrighted
media (movies, games, viral clips). Using them in monetized content
has the usual fair-use grey area. The frontend surfaces a one-line
disclaimer near the import controls; this module doesn't enforce
anything beyond a polite User-Agent and short request timeouts.
"""
from __future__ import annotations

import os
import re
import time
import urllib.parse
from typing import Optional

import requests


_BASE = "https://www.myinstants.com"
_USER_AGENT = (
    "social-automation-suite/1.0 "
    "(self-hosted creator tool; contact via the project's GitHub issues)"
)
_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
}

# Trending and search results don't change minute-to-minute — cache
# them for an hour so flipping tabs is cheap. The cache is a simple
# in-memory dict keyed by URL.
_CACHE_TTL_S = 3600
_cache: dict[str, dict] = {}


# ── HTML extraction ───────────────────────────────────────────────────
# Myinstants encodes each sound as a play button whose `data-url`
# holds the relative mp3 path and whose immediate-sibling link holds
# the human title + the per-sound detail page. Pattern hasn't changed
# in years; scraping it with two regexes is robust enough for our
# purposes (browse-and-import, not building a scraping product).

_SOUND_RE = re.compile(
    # Each sound card: a play button with data-url + onmousedown,
    # immediately followed by the sound's title inside an <a> tag.
    r'<button[^>]*class="[^"]*small-button[^"]*"[^>]*'
    r'onmousedown="play\(\'(?P<mp3>[^\']+)\''
    r'[\s\S]*?'
    r'<a[^>]+class="[^"]*instant-link[^"]*"[^>]*'
    r'href="(?P<href>[^"]+)"[^>]*>(?P<title>[^<]+)</a>',
    re.IGNORECASE,
)


def _absolutize(path: str) -> str:
    """Make a relative URL absolute against the myinstants origin."""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("//"):
        return "https:" + path
    if path.startswith("/"):
        return _BASE + path
    return f"{_BASE}/{path}"


def _parse_sound_list(html: str, limit: int) -> list[dict]:
    """Extract sound cards from a myinstants listing page."""
    out: list[dict] = []
    seen: set[str] = set()
    for m in _SOUND_RE.finditer(html):
        mp3 = _absolutize(m.group("mp3").strip())
        if mp3 in seen:
            continue
        seen.add(mp3)
        title = re.sub(r"\s+", " ", m.group("title")).strip()
        href = _absolutize(m.group("href").strip())
        out.append({
            "title":     title or "Untitled",
            "mp3_url":   mp3,
            "page_url":  href,
        })
        if len(out) >= limit:
            break
    return out


def _fetch_html(url: str) -> str:
    """GET an HTML page from myinstants with a short timeout. Caller
    handles caching."""
    r = requests.get(url, headers=_HEADERS, timeout=10)
    r.raise_for_status()
    return r.text


def _cached_fetch(url: str) -> str:
    """Hourly-cached HTML fetch. Errors aren't cached — a transient
    timeout shouldn't poison the next hour's lookups."""
    now = time.time()
    hit = _cache.get(url)
    if hit and now - hit["at"] < _CACHE_TTL_S:
        return hit["html"]
    html = _fetch_html(url)
    _cache[url] = {"at": now, "html": html}
    return html


# ── Public API ────────────────────────────────────────────────────────

def trending(region: str = "us", limit: int = 24) -> list[dict]:
    """
    Fetch the regional trending list. `region` is a 2-letter ISO code
    that myinstants accepts in its URL (us / gb / br / mx / etc).
    Falls back to "us" on unsupported codes — myinstants 404s
    gracefully so we'll just get an empty list.
    """
    region = (region or "us").strip().lower()[:3]
    if not re.fullmatch(r"[a-z]{2,3}", region):
        region = "us"
    url = f"{_BASE}/en/index/{region}/"
    try:
        html = _cached_fetch(url)
    except Exception:
        return []
    return _parse_sound_list(html, max(1, min(60, limit)))


def search(query: str, limit: int = 24) -> list[dict]:
    """
    Search myinstants by name. Empty query → empty list (no point
    burning a request on a no-op search).
    """
    q = (query or "").strip()
    if not q:
        return []
    url = f"{_BASE}/en/search/?name={urllib.parse.quote(q)}"
    try:
        html = _cached_fetch(url)
    except Exception:
        return []
    return _parse_sound_list(html, max(1, min(60, limit)))


def download_mp3(mp3_url: str, dest_path: str) -> bool:
    """
    Stream a sound's mp3 to dest_path. Returns True on success.
    Caps at 5 MB so a misbehaving URL can't fill the disk; myinstants
    sounds are typically 50-500 KB so the cap is well above normal.
    """
    if not mp3_url.startswith(_BASE) and not mp3_url.startswith("https://www.myinstants.com"):
        # Be paranoid about where we let this function write FROM —
        # users could theoretically pass arbitrary URLs through the
        # import endpoint.
        return False
    MAX_BYTES = 5 * 1024 * 1024
    try:
        with requests.get(mp3_url, headers=_HEADERS, timeout=15, stream=True) as r:
            r.raise_for_status()
            os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
            total = 0
            with open(dest_path, "wb") as f:
                for chunk in r.iter_content(8192):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_BYTES:
                        # Truncate and bail out; don't keep a partial
                        # file around because a downstream check on
                        # file size would say "ok, looks like a clip."
                        f.close()
                        try: os.remove(dest_path)
                        except OSError: pass
                        return False
                    f.write(chunk)
        return os.path.isfile(dest_path) and os.path.getsize(dest_path) > 200
    except Exception:
        return False


def slug_from_title(title: str) -> str:
    """Filesystem-safe slug. Used as the default filename when a sound
    is imported without a user-supplied name."""
    s = re.sub(r"[^A-Za-z0-9]+", "_", (title or "sound").strip()).strip("_").lower()
    return s[:60] or "sound"
