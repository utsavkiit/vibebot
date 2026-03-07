from datetime import date

from langchain_core.language_models.chat_models import BaseChatModel

from vibebot.core.base_plugin import BasePlugin
from vibebot.plugins.news.fetcher import fetch_top_articles
from vibebot.plugins.news.summarizer import summarize_article


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
        today = date.today().strftime("%A, %B %-d, %Y")
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*📰 World News — {today}*",
            },
        })
        blocks.append({"type": "divider"})

        for i, article in enumerate(articles, start=1):
            summary = summarize_article(
                self.llm,
                title=article["title"],
                description=article["description"],
            )

            text = (
                f"*{i}. {article['title']}*\n"
                f"{summary}\n"
                f"_Source: {article['source']}_ · <{article['url']}|Read full article>"
            )

            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": text},
            })

            if i < len(articles):
                blocks.append({"type": "divider"})

        return blocks
