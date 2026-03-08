from datetime import datetime, timezone
from urllib.parse import urlparse

from langchain_tavily import TavilySearch


def fetch_top_articles(count: int = 5) -> list[dict]:
    """
    Fetch the top world news articles via Tavily Search.

    Requires TAVILY_API_KEY in the environment.

    Args:
        count: Number of articles to fetch (default: 5).

    Returns:
        List of article dicts with keys:
            title, description, url, source, published_at
    """
    tool = TavilySearch(max_results=count, topic="news")
    response = tool.invoke(
        "biggest world news today site:reuters.com OR site:bbc.com OR site:apnews.com OR site:ft.com"
    )

    articles = []
    for result in response.get("results", [])[:count]:
        url = result.get("url") or ""
        source = urlparse(url).netloc.removeprefix("www.") if url else "Unknown"
        articles.append({
            "title": result.get("title") or "Untitled",
            "description": result.get("content") or "",
            "url": url,
            "source": source,
            "published_at": datetime.now(timezone.utc).isoformat(),
        })

    return articles
