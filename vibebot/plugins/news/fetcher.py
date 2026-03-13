import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import feedparser
import requests

logger = logging.getLogger(__name__)

# (category_label, rss_url, max_per_feed)
_FEEDS: list[tuple[str, str, int]] = [
    # Topic-based feeds (curated by Google News)
    ("World",      "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFZxYUdjU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en", 12),
    ("US",         "https://news.google.com/rss/topics/CAAqIggKIhxDQkFTRHdvSkwyMHZNRGxqTjNjd0VnSmxiaWdBUAE?hl=en-US&gl=US&ceid=US:en", 10),
    ("Business",   "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en", 8),
    ("Technology", "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en", 8),
    ("Sports",     "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en", 8),
    # Search-based feeds (for specific niches)
    ("India",      "https://news.google.com/rss/search?q=india+news&hl=en-US&gl=US&ceid=US:en", 8),
    ("AI",         "https://news.google.com/rss/search?q=artificial+intelligence+AI&hl=en-US&gl=US&ceid=US:en", 8),
    ("F1",         "https://news.google.com/rss/search?q=formula+1+F1+racing&hl=en-US&gl=US&ceid=US:en", 6),
    ("Cricket",    "https://news.google.com/rss/search?q=cricket&hl=en-US&gl=US&ceid=US:en", 6),
    ("Soccer",     "https://news.google.com/rss/search?q=soccer+football&hl=en-US&gl=US&ceid=US:en", 6),
    ("Tennis",     "https://news.google.com/rss/search?q=tennis&hl=en-US&gl=US&ceid=US:en", 5),
]


def _parse_published(entry) -> str:
    for field in ("published", "updated"):
        val = entry.get(field)
        if val:
            try:
                return parsedate_to_datetime(val).isoformat()
            except Exception:
                pass
    return datetime.now(timezone.utc).isoformat()


def _parse_feed(url: str, max_articles: int, category: str) -> list[dict]:
    """Parse a single RSS feed and return normalized article dicts."""
    try:
        feed = feedparser.parse(url)
        articles = []
        for entry in feed.entries[:max_articles]:
            raw_title = entry.get("title", "Untitled")
            # Google News titles end with " - Source Name" — strip it
            source_from_title = ""
            if " - " in raw_title:
                parts = raw_title.rsplit(" - ", 1)
                raw_title = parts[0].strip()
                source_from_title = parts[1].strip()

            source_name = ""
            if hasattr(entry, "source") and entry.source:
                source_name = entry.source.get("title", "")
            if not source_name:
                source_name = source_from_title

            articles.append({
                "title": raw_title,
                "description": entry.get("summary", ""),
                "url": entry.get("link", ""),
                "source": source_name,
                "published_at": _parse_published(entry),
                "category": category,
            })
        return articles
    except Exception as exc:
        logger.warning("Failed to fetch feed [%s]: %s", category, exc)
        return []


def fetch_all_articles() -> list[dict]:
    """Fetch articles from all Google News RSS feeds, deduplicated by URL."""
    all_articles: list[dict] = []
    seen_urls: set[str] = set()
    for category, url, max_count in _FEEDS:
        articles = _parse_feed(url, max_count, category)
        new_count = 0
        for article in articles:
            if article["url"] and article["url"] not in seen_urls:
                seen_urls.add(article["url"])
                all_articles.append(article)
                new_count += 1
        logger.info("  Feed [%-12s] → %d new articles", category, new_count)
    logger.info("Total unique articles fetched: %d", len(all_articles))
    return all_articles


def resolve_article_url(google_news_url: str, timeout: int = 5) -> str:
    """Follow the Google News redirect to get the actual article URL."""
    try:
        resp = requests.get(
            google_news_url,
            allow_redirects=True,
            timeout=timeout,
            headers={"User-Agent": "Mozilla/5.0 (compatible; VibeBot/1.0)"},
        )
        return resp.url
    except Exception:
        return google_news_url
