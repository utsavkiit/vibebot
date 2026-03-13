import logging
import math
from datetime import datetime, timezone

import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize

logger = logging.getLogger(__name__)

# Source reputation scores: higher = more trusted + less likely paywalled.
# Checked against lower-cased source strings so partial matches work.
_SOURCE_SCORES: dict[str, int] = {
    "reuters": 10,
    "ap news": 10,
    "associated press": 10,
    "bbc": 9,
    "the guardian": 9,
    "guardian": 9,
    "al jazeera": 8,
    "aljazeera": 8,
    "npr": 8,
    "espn": 8,
    "cricinfo": 8,
    "formula 1": 8,
    "techcrunch": 8,
    "ars technica": 8,
    "the verge": 8,
    "wired": 7,
    "cnbc": 7,
    "marketwatch": 7,
    "yahoo finance": 7,
    "ndtv": 7,
    "the hindu": 7,
    "hindustan times": 7,
    "sky news": 7,
    "abc news": 7,
    "cbs news": 7,
    "nbc news": 7,
    # Paywalled — deprioritise but don't exclude
    "bloomberg": 5,
    "financial times": 5,
    "wall street journal": 5,
    "wsj": 5,
    "new york times": 5,
    "washington post": 5,
    "the economist": 5,
}
_DEFAULT_SCORE = 4


def _source_score(source: str) -> int:
    s = source.lower()
    for key, score in _SOURCE_SCORES.items():
        if key in s:
            return score
    return _DEFAULT_SCORE


def _recency_score(published_at: str) -> float:
    """1.0 if just published, decays linearly to 0.0 at 48 hours old."""
    try:
        dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
        return max(0.0, 1.0 - age_hours / 48.0)
    except Exception:
        return 0.5


def _score_cluster(articles: list[dict]) -> float:
    """Composite cluster score: size + source diversity + recency + best-source quality."""
    size = len(articles)
    diversity = len({a["source"] for a in articles})
    recency = sum(_recency_score(a["published_at"]) for a in articles) / size
    best_source = max(_source_score(a["source"]) for a in articles)
    return size * 2.0 + diversity * 1.5 + recency * 3.0 + best_source * 0.5


def cluster_and_rank(articles: list[dict], top_k: int = 5) -> list[list[dict]]:
    """
    Embed articles with sentence-transformers, cluster with K-means,
    score each cluster, and return the top_k clusters.

    Args:
        articles: Article dicts with at least title, description, source, published_at.
        top_k: How many clusters to return.

    Returns:
        List of up to top_k clusters (each a list of article dicts), best first.
    """
    n = len(articles)
    if n == 0:
        return []

    n_clusters = min(max(top_k, int(math.sqrt(n))), 25, n)
    logger.info("Embedding %d articles → %d clusters (top %d selected)...", n, n_clusters, top_k)

    model = SentenceTransformer("all-MiniLM-L6-v2")
    texts = [f"{a['title']}. {a.get('description', '')[:200]}" for a in articles]
    embeddings = normalize(model.encode(texts, show_progress_bar=False))

    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(embeddings)

    clusters: dict[int, list[dict]] = {}
    for idx, label in enumerate(labels):
        clusters.setdefault(int(label), []).append(articles[idx])

    ranked = sorted(clusters.values(), key=_score_cluster, reverse=True)
    logger.info(
        "Cluster sizes (top %d): %s",
        top_k,
        [len(c) for c in ranked[:top_k]],
    )
    return ranked[:top_k]


def pick_best_article(cluster_articles: list[dict]) -> dict:
    """Return the highest-quality (most reputable + most recent) article from a cluster."""
    return max(
        cluster_articles,
        key=lambda a: (_source_score(a["source"]), _recency_score(a["published_at"])),
    )
