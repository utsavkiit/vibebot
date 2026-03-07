import os
import requests


def fetch_top_articles(count: int = 5) -> list[dict]:
    """
    Fetch the top world news articles from NewsAPI.org.

    Requires NEWS_API_KEY in the environment.
    Free tier: 100 requests/day. Sign up at https://newsapi.org/register

    Args:
        count: Number of articles to fetch (default: 5).

    Returns:
        List of article dicts with keys:
            title, description, url, source, published_at
    """
    api_key = os.environ.get("NEWS_API_KEY")
    if not api_key:
        raise EnvironmentError("NEWS_API_KEY is not set in the environment.")

    response = requests.get(
        "https://newsapi.org/v2/top-headlines",
        params={
            "category": "general",
            "language": "en",
            "pageSize": count,
            "apiKey": api_key,
        },
        timeout=10,
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"NewsAPI returned {response.status_code}: {response.text}"
        )

    data = response.json()
    if data.get("status") != "ok":
        raise RuntimeError(f"NewsAPI error: {data.get('message', 'Unknown error')}")

    articles = []
    for item in data.get("articles", [])[:count]:
        articles.append({
            "title": item.get("title") or "Untitled",
            "description": item.get("description") or item.get("content") or "",
            "url": item.get("url") or "",
            "source": (item.get("source") or {}).get("name") or "Unknown",
            "published_at": item.get("publishedAt") or "",
        })

    return articles
