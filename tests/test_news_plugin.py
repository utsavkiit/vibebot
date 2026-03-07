import json
from unittest.mock import MagicMock, patch

from vibebot.plugins.news import NewsPlugin


FAKE_ARTICLES = [
    {
        "title": "Headline One",
        "description": "Desc one.",
        "url": "https://example.com/1",
        "source": "Source A",
        "published_at": "2026-03-07T09:00:00Z",
    },
    {
        "title": "Headline Two",
        "description": "Desc two.",
        "url": "https://example.com/2",
        "source": "Source B",
        "published_at": "2026-03-07T09:00:00Z",
    },
]

# Fake sqlite3.Row-like dicts for DB mocking
FAKE_DB_ITEMS = [
    {"id": 1, "payload": json.dumps(FAKE_ARTICLES[0])},
    {"id": 2, "payload": json.dumps(FAKE_ARTICLES[1])},
]


# ---------------------------------------------------------------------------
# collect() tests
# ---------------------------------------------------------------------------

@patch("vibebot.plugins.news.insert_raw_item", side_effect=[True, True])
@patch("vibebot.plugins.news.fetch_top_articles", return_value=FAKE_ARTICLES)
def test_collect_returns_count_of_new_items(mock_fetch, mock_insert):
    plugin = NewsPlugin(article_count=2)
    count = plugin.collect(MagicMock())
    assert count == 2


@patch("vibebot.plugins.news.insert_raw_item", side_effect=[True, False])
@patch("vibebot.plugins.news.fetch_top_articles", return_value=FAKE_ARTICLES)
def test_collect_skips_duplicates(mock_fetch, mock_insert):
    plugin = NewsPlugin(article_count=2)
    count = plugin.collect(MagicMock())
    assert count == 1  # second article was a duplicate


@patch("vibebot.plugins.news.insert_raw_item", return_value=True)
@patch("vibebot.plugins.news.fetch_top_articles", return_value=FAKE_ARTICLES)
def test_collect_calls_insert_for_each_article(mock_fetch, mock_insert):
    plugin = NewsPlugin(article_count=2)
    plugin.collect(MagicMock())
    assert mock_insert.call_count == 2


# ---------------------------------------------------------------------------
# build_digest() tests
# ---------------------------------------------------------------------------

@patch("vibebot.plugins.news.mark_raw_item_processed")
@patch("vibebot.plugins.news.insert_outbound_message", return_value=42)
@patch("vibebot.plugins.news.summarize_article", return_value=("Summary.", "Why."))
@patch("vibebot.plugins.news.fetch_og_image", return_value=None)
@patch("vibebot.plugins.news.get_pending_raw_items", return_value=FAKE_DB_ITEMS)
def test_build_digest_returns_message_id(mock_items, mock_og, mock_summarize, mock_insert_msg, mock_mark):
    plugin = NewsPlugin()
    msg_id = plugin.build_digest(MagicMock(), MagicMock())
    assert msg_id == 42


@patch("vibebot.plugins.news.mark_raw_item_processed")
@patch("vibebot.plugins.news.insert_outbound_message", return_value=1)
@patch("vibebot.plugins.news.summarize_article", return_value=("Summary.", "Why."))
@patch("vibebot.plugins.news.fetch_og_image", return_value=None)
@patch("vibebot.plugins.news.get_pending_raw_items", return_value=FAKE_DB_ITEMS)
def test_build_digest_marks_items_processed(mock_items, mock_og, mock_summarize, mock_insert_msg, mock_mark):
    plugin = NewsPlugin()
    plugin.build_digest(MagicMock(), MagicMock())
    assert mock_mark.call_count == 2


@patch("vibebot.plugins.news.get_pending_raw_items", return_value=[])
def test_build_digest_returns_none_when_no_items(mock_items):
    plugin = NewsPlugin()
    result = plugin.build_digest(MagicMock(), MagicMock())
    assert result is None


@patch("vibebot.plugins.news.mark_raw_item_processed")
@patch("vibebot.plugins.news.insert_outbound_message", return_value=1)
@patch("vibebot.plugins.news.summarize_article", return_value=("Summary.", "Why."))
@patch("vibebot.plugins.news.fetch_og_image", return_value=None)
@patch("vibebot.plugins.news.get_pending_raw_items", return_value=FAKE_DB_ITEMS)
def test_build_digest_calls_summarize_for_each_article(mock_items, mock_og, mock_summarize, mock_insert_msg, mock_mark):
    plugin = NewsPlugin()
    plugin.build_digest(MagicMock(), MagicMock())
    assert mock_summarize.call_count == 2


@patch("vibebot.plugins.news.mark_raw_item_processed")
@patch("vibebot.plugins.news.insert_outbound_message", return_value=1)
@patch("vibebot.plugins.news.summarize_article", return_value=("Summary.", "Why."))
@patch("vibebot.plugins.news.fetch_og_image", return_value=None)
@patch("vibebot.plugins.news.get_pending_raw_items", return_value=FAKE_DB_ITEMS)
def test_build_digest_payload_contains_article_content(mock_items, mock_og, mock_summarize, mock_insert_msg, mock_mark):
    plugin = NewsPlugin()
    plugin.build_digest(MagicMock(), MagicMock())
    # Inspect the payload passed to insert_outbound_message
    payload_blocks = mock_insert_msg.call_args[1]["payload"]
    all_text = json.dumps(payload_blocks)
    assert "Headline One" in all_text
    assert "Summary." in all_text
    assert "Source A" in all_text
