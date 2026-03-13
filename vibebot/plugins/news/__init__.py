import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from langchain_core.language_models.chat_models import BaseChatModel

from vibebot.core.base_plugin import BasePlugin
from vibebot.core.db import (
    get_pending_raw_items,
    insert_outbound_message,
    insert_raw_item,
    mark_raw_item_processed,
)
from vibebot.core.message_utils import build_footer, build_header
from vibebot.plugins.news.clusterer import cluster_and_rank, pick_best_article
from vibebot.plugins.news.fetcher import fetch_all_articles, resolve_article_url
from vibebot.plugins.news.og_image import fetch_og_image
from vibebot.plugins.news.summarizer import summarize_cluster

logger = logging.getLogger(__name__)


def _format_published_at(iso_str: str) -> str:
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc).strftime("%-I:%M %p")


class NewsPlugin(BasePlugin):
    """
    Fetches ~80 news articles from Google News RSS across multiple categories,
    clusters them by semantic similarity, and builds a Slack digest from the
    top 5 story clusters — each represented by a catchy headline, summary,
    and a link to the best no-paywall source.
    """

    name = "news"

    def __init__(self, article_count: int = 80, top_clusters: int = 5) -> None:
        self.article_count = article_count  # kept for config compatibility
        self.top_clusters = top_clusters

    def collect(self, conn) -> int:
        """Fetch articles from Google News RSS and store new ones in raw_items."""
        articles = fetch_all_articles()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        new_count = 0
        for article in articles:
            external_id = hashlib.md5(f"{today}:{article['url']}".encode()).hexdigest()
            if insert_raw_item(conn, "news", external_id, article):
                new_count += 1
        return new_count

    def build_digest(self, conn, llm: BaseChatModel) -> Optional[int]:
        """Cluster pending articles, pick top 5 stories, build a Slack digest."""
        items = get_pending_raw_items(conn, "news")
        if not items:
            return None

        articles = [json.loads(item["payload"]) for item in items]
        top_clusters = cluster_and_rank(articles, top_k=self.top_clusters)
        if not top_clusters:
            return None

        blocks = build_header() + self._build_cluster_blocks(llm, top_clusters) + build_footer()
        msg_id = insert_outbound_message(
            conn,
            channel="slack_default",
            message_type="news_digest",
            payload=blocks,
            max_retries=3,
        )
        for item in items:
            mark_raw_item_processed(conn, item["id"])
        return msg_id

    def _build_cluster_blocks(self, llm: BaseChatModel, clusters: list[list[dict]]) -> list[dict]:
        blocks: list[dict] = [
            {"type": "section", "text": {"type": "mrkdwn", "text": "*📰 Top Stories*"}},
            {"type": "divider"},
        ]

        for i, cluster_articles in enumerate(clusters, start=1):
            best = pick_best_article(cluster_articles)

            # Resolve Google News redirect → actual article URL
            actual_url = resolve_article_url(best["url"])

            headline, blurb, emoji = summarize_cluster(llm, cluster_articles)
            image_url = fetch_og_image(actual_url)
            time_str = _format_published_at(best["published_at"])
            related = len(cluster_articles)

            card_text = f"{emoji} *{i}. <{actual_url}|{headline}>*"
            if blurb:
                card_text += f"\n{blurb}"

            card_block: dict = {"type": "section", "text": {"type": "mrkdwn", "text": card_text}}
            if image_url:
                card_block["accessory"] = {
                    "type": "image",
                    "image_url": image_url,
                    "alt_text": headline,
                }
            blocks.append(card_block)

            buzz = f"  ·  {related} related articles" if related > 1 else ""
            blocks.append({
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"📌 {best['source']}  ·  {time_str}{buzz}"}
                ],
            })

            if i < len(clusters):
                blocks.append({"type": "divider"})

        return blocks
