from datetime import datetime, timezone

from langchain_core.language_models.chat_models import BaseChatModel

from vibebot.core.base_plugin import BasePlugin
from vibebot.plugins.news.fetcher import fetch_top_articles
from vibebot.plugins.news.og_image import fetch_og_image
from vibebot.plugins.news.summarizer import summarize_article


def _format_published_at(iso_str: str) -> str:
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc).strftime("%-I:%M %p")


class NewsPlugin(BasePlugin):
    """
    Fetches the top world news headlines, summarizes each with an LLM,
    and returns Slack Block Kit blocks for the daily digest.
    """

    name = "news"

    def __init__(self, llm: BaseChatModel, article_count: int = 5) -> None:
        self.llm = llm
        self.article_count = article_count

    def get_blocks(self) -> list[dict]:
        articles = fetch_top_articles(count=self.article_count)
        blocks: list[dict] = []

        # Section header
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "*📰 Top Stories*"},
        })
        blocks.append({"type": "divider"})

        for i, article in enumerate(articles, start=1):
            summary, why = summarize_article(
                self.llm,
                title=article["title"],
                description=article["description"],
            )
            image_url = fetch_og_image(article["url"])
            time_str = _format_published_at(article["published_at"])

            # Block A — headline + summary (thumbnail as accessory if available)
            block_a: dict = {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{i}. {article['title']}*\n{summary}",
                },
            }
            if image_url:
                block_a["accessory"] = {
                    "type": "image",
                    "image_url": image_url,
                    "alt_text": article["title"],
                }
            blocks.append(block_a)

            # Block B — source + time
            blocks.append({
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"📌 {article['source']}  ·  {time_str}"}
                ],
            })

            # Block C — "Why it matters" + Read button
            why_text = f"*💡 Why it matters:* {why}" if why else "_No further context._"
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": why_text},
                "accessory": {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Read →", "emoji": False},
                    "url": article["url"],
                },
            })

            # Block D — divider (omit after last article)
            if i < len(articles):
                blocks.append({"type": "divider"})

        return blocks
