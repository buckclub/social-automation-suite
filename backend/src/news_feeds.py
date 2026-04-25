"""
RSS / Atom feed reader for the News Roundup page.

Pure stdlib — no feedparser dependency. Handles both RSS 2.0
(<channel><item>) and Atom (<feed><entry>) since most news sites publish
one or the other but not both.

Output shape per item:
    {
      "title":        str,
      "link":         str,    # canonical article URL
      "summary":      str,    # plain-text excerpt, HTML stripped, ≤ 600 chars
      "published_at": str,    # original RFC 822 / ISO timestamp, best-effort
      "source":       str,    # the feed's <title>, for context
    }

Errors return ([], "<error message>") so the API can surface a useful
toast instead of exploding.
"""
from __future__ import annotations
import html
import re
import urllib.request
import xml.etree.ElementTree as ET
from typing import Optional


# Curated feed presets — surfaced on the News Roundup page so users can
# get going without hunting for RSS URLs. Picked for high-volume,
# high-quality, niche-relevant English-language sources.
CURATED_FEEDS: list[dict] = [
    # Tech / startups
    {"id": "techcrunch",   "name": "TechCrunch",     "url": "https://techcrunch.com/feed/",                 "niche": "tech"},
    {"id": "hn-front",     "name": "Hacker News",    "url": "https://hnrss.org/frontpage",                  "niche": "tech"},
    {"id": "verge",        "name": "The Verge",      "url": "https://www.theverge.com/rss/index.xml",       "niche": "tech"},
    {"id": "ars",          "name": "Ars Technica",   "url": "https://feeds.arstechnica.com/arstechnica/index", "niche": "tech"},
    # General news
    {"id": "bbc-world",    "name": "BBC World",      "url": "https://feeds.bbci.co.uk/news/world/rss.xml",  "niche": "news"},
    {"id": "reuters-top",  "name": "Reuters Top",    "url": "https://feeds.reuters.com/reuters/topNews",    "niche": "news"},
    # Sports
    {"id": "espn",         "name": "ESPN Top",       "url": "https://www.espn.com/espn/rss/news",           "niche": "sports"},
    # Entertainment / pop
    {"id": "variety",      "name": "Variety",        "url": "https://variety.com/feed/",                    "niche": "entertainment"},
    {"id": "thr",          "name": "Hollywood Reporter", "url": "https://www.hollywoodreporter.com/feed",   "niche": "entertainment"},
    # Reddit-driven (the suite's home turf)
    {"id": "r-aita-top",   "name": "r/AmItheAsshole top", "url": "https://www.reddit.com/r/AmItheAsshole/top/.rss?t=day", "niche": "reddit"},
    {"id": "r-tifu-top",   "name": "r/tifu top",     "url": "https://www.reddit.com/r/tifu/top/.rss?t=day", "niche": "reddit"},
    {"id": "r-ra-top",     "name": "r/relationship_advice top", "url": "https://www.reddit.com/r/relationship_advice/top/.rss?t=day", "niche": "reddit"},
]


# ── Helpers ───────────────────────────────────────────────────────────

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(s: str) -> str:
    if not s:
        return ""
    s = _TAG_RE.sub(" ", s)
    s = html.unescape(s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def _ns_strip(tag: str) -> str:
    """`{http://www.w3.org/2005/Atom}entry` → `entry`."""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _find_first(elem: ET.Element, *names: str) -> Optional[ET.Element]:
    """Return the first child whose local name matches any of `names`."""
    for child in list(elem):
        if _ns_strip(child.tag) in names:
            return child
    return None


def _all_children(elem: ET.Element, *names: str) -> list[ET.Element]:
    return [c for c in list(elem) if _ns_strip(c.tag) in names]


def _text_of(elem: Optional[ET.Element]) -> str:
    if elem is None:
        return ""
    return (elem.text or "").strip()


# ── Fetch + parse ─────────────────────────────────────────────────────

def fetch_feed(url: str, *, max_items: int = 25, timeout: float = 10.0) -> tuple[list[dict], Optional[str]]:
    """
    Pull and parse an RSS 2.0 or Atom feed. Returns (items, error_message).
    items is empty and error is non-None on any failure.
    """
    if not url or not url.lower().startswith(("http://", "https://")):
        return [], "URL must start with http:// or https://"

    try:
        req = urllib.request.Request(url, headers={
            # Some feeds gate against the default urllib UA.
            "User-Agent": "Social-Automation-Suite/1.0 (RSS reader)",
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except Exception as e:
        return [], f"Fetch failed: {e}"

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        return [], f"Not a valid XML feed: {e}"

    local_root = _ns_strip(root.tag)
    items: list[dict] = []
    feed_title = ""

    if local_root == "rss":
        channel = _find_first(root, "channel")
        if channel is None:
            return [], "RSS root has no <channel>"
        feed_title = _text_of(_find_first(channel, "title"))
        for item in _all_children(channel, "item"):
            title = _text_of(_find_first(item, "title"))
            link  = _text_of(_find_first(item, "link"))
            desc  = _text_of(_find_first(item, "description", "summary"))
            # Reddit feeds put the body under content:encoded
            content_encoded = None
            for c in list(item):
                if _ns_strip(c.tag) == "encoded":
                    content_encoded = c
                    break
            if content_encoded is not None and (content_encoded.text or "").strip():
                desc = desc + " " + (content_encoded.text or "")
            pub = _text_of(_find_first(item, "pubDate", "published"))
            if not title and not link:
                continue
            items.append({
                "title": _strip_html(title)[:300],
                "link": link.strip(),
                "summary": _strip_html(desc)[:600],
                "published_at": pub,
                "source": _strip_html(feed_title)[:80],
            })
            if len(items) >= max_items:
                break

    elif local_root == "feed":
        # Atom
        feed_title = _text_of(_find_first(root, "title"))
        for entry in _all_children(root, "entry"):
            title = _text_of(_find_first(entry, "title"))
            # Atom <link href="..."> is an attribute, not text
            link = ""
            for c in list(entry):
                if _ns_strip(c.tag) == "link":
                    href = c.get("href")
                    if href:
                        link = href
                        break
            if not link:
                link = _text_of(_find_first(entry, "id"))
            summary = _text_of(_find_first(entry, "summary", "content"))
            pub = _text_of(_find_first(entry, "published", "updated"))
            if not title and not link:
                continue
            items.append({
                "title": _strip_html(title)[:300],
                "link": link.strip(),
                "summary": _strip_html(summary)[:600],
                "published_at": pub,
                "source": _strip_html(feed_title)[:80],
            })
            if len(items) >= max_items:
                break

    else:
        return [], f"Unknown feed format <{local_root}> (expected RSS or Atom)"

    return items, None
