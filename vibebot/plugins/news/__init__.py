import hashlib
import json
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
from vibebot.plugins.news.fetcher import fetch_top_articles
from vibebot.plugins.news.og_image import fetch_og_image
from vibebot.plugins.news.summarizer import summarize_article


def _format_published_at(iso_str: str) -> str:
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc).strftime("%-I:%M %p")


class NewsPlugin(BasePlugin):
    """
    Fetches top world news headlines, summarizes each with an LLM,
    and builds a Slack Block Kit digest message.
    """

    name = "news"

    def __init__(self, article_count: int = 5) -> None:
        self.article_count = article_count

    def collect(self, conn) -> int:
        """Fetch top headlines and store new ones in raw_items."""
        articles = fetch_top_articles(count=self.article_count)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        new_count = 0
        for article in articles:
            # Include date so the same URL can be re-collected on a new day
            external_id = hashlib.md5(f"{today}:{article['url']}".encode()).hexdigest()
            if insert_raw_item(conn, "news", external_id, article):
                new_count += 1
        return new_count

    def build_digest(self, conn, llm: BaseChatModel) -> Optional[int]:
        """Build a Slack digest from pending news items and queue it for delivery."""
        items = get_pending_raw_items(conn, "news")
        if not items:
            return None
        articles = [json.loads(item["payload"]) for item in items]
        blocks = build_header() + self._build_blocks(llm, articles) + build_footer()
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

    def _build_blocks(self, llm: BaseChatModel, articles: list) -> list[dict]:
        """Build per-article Slack blocks for the news section."""
        blocks: list[dict] = []

        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "*📰 Top Stories*"},
        })
        blocks.append({"type": "divider"})

        for i, article in enumerate(articles, start=1):
            summary, why = summarize_article(
                llm,
                title=article["title"],
                description=article["description"],
            )
            image_url = fetch_og_image(article["url"])
            time_str = _format_published_at(article["published_at"])

            # Headline as clickable link (with optional thumbnail accessory)
            block_a: dict = {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{i}. <{article['url']}|{summary}>*",
                },
            }
            if image_url:
                block_a["accessory"] = {
                    "type": "image",
                    "image_url": image_url,
                    "alt_text": article["title"],
                }
            blocks.append(block_a)

            # Source + publish time
            blocks.append({
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"📌 {article['source']}  ·  {time_str}"}
                ],
            })

            # Why it matters
            why_text = f"*💡 Why it matters:* {why}" if why else "_No further context._"
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": why_text},
            })

            if i < len(articles):
                blocks.append({"type": "divider"})

        return blocks
