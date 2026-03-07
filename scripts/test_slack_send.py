"""
Smoke-test the Slack integration without making any LLM or News API calls.

Builds a digest from hardcoded fake articles and sends it to the real
Slack webhook configured in .env (or the environment).

Usage:
    python3 scripts/test_slack_send.py
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
from unittest.mock import patch

load_dotenv(REPO_ROOT / ".env")

FAKE_ARTICLES = [
    {
        "title": "Scientists Discover New Species of Deep-Sea Fish",
        "description": "Researchers exploring the Mariana Trench have identified a previously unknown species.",
        "url": "https://example.com/deep-sea-fish",
        "source": "Science Daily",
        "published_at": "2026-03-07T09:00:00Z",
    },
    {
        "title": "Global Leaders Agree on Climate Framework",
        "description": "A landmark agreement was signed by 190 countries at the annual climate summit.",
        "url": "https://example.com/climate-framework",
        "source": "World News",
        "published_at": "2026-03-07T08:30:00Z",
    },
    {
        "title": "Tech Giant Unveils Next-Generation Chip",
        "description": "The new processor offers a 40% performance boost over its predecessor.",
        "url": "https://example.com/new-chip",
        "source": "Tech Insider",
        "published_at": "2026-03-07T07:00:00Z",
    },
]

FAKE_SUMMARY = (
    "A placeholder summary generated without an LLM call.",
    "This illustrates how the digest will look in production.",
)


def main():
    with (
        patch("vibebot.plugins.news.fetch_top_articles", return_value=FAKE_ARTICLES),
        patch("vibebot.plugins.news.summarize_article", return_value=FAKE_SUMMARY),
        patch("vibebot.plugins.news.fetch_og_image", return_value=None),
    ):
        from unittest.mock import MagicMock
        from vibebot.plugins.news import NewsPlugin
        from vibebot.core.slack_sender import SlackSender
        from vibebot.main import build_header

        plugin = NewsPlugin(llm=MagicMock(), article_count=len(FAKE_ARTICLES))
        blocks = build_header() + plugin.get_blocks()

        print(f"Sending {len(blocks)} blocks to Slack...")
        SlackSender().send(blocks)
        print("Done. Check your Slack channel.")


if __name__ == "__main__":
    main()
