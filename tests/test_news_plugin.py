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


@patch("vibebot.plugins.news.summarize_article", return_value=("A short summary.", "A reason."))
@patch("vibebot.plugins.news.fetch_top_articles", return_value=FAKE_ARTICLES)
@patch("vibebot.plugins.news.fetch_og_image", return_value=None)
def test_get_blocks_structure(mock_og, mock_fetch, mock_summarize):
    llm = MagicMock()
    plugin = NewsPlugin(llm=llm, article_count=2)
    blocks = plugin.get_blocks()

    # header section + divider + (section + context + section + divider) * (n-1) + section + context + section
    # = 2 + 4*(N-1) + 3 = 4N + 1 = 9 for N=2
    assert len(blocks) == 9
    assert blocks[0]["type"] == "section"  # "Top Stories" header
    assert blocks[1]["type"] == "divider"
    assert blocks[2]["type"] == "section"  # article 1: headline+summary
    assert blocks[3]["type"] == "context"  # article 1: source+time
    assert blocks[4]["type"] == "section"  # article 1: why it matters + button
    assert blocks[5]["type"] == "divider"  # divider between articles
    assert blocks[6]["type"] == "section"  # article 2: headline+summary
    assert blocks[7]["type"] == "context"  # article 2: source+time
    assert blocks[8]["type"] == "section"  # article 2: why it matters + button


@patch("vibebot.plugins.news.summarize_article", return_value=("Summary.", "Why."))
@patch("vibebot.plugins.news.fetch_top_articles", return_value=FAKE_ARTICLES)
@patch("vibebot.plugins.news.fetch_og_image", return_value=None)
def test_get_blocks_contains_article_text(mock_og, mock_fetch, mock_summarize):
    llm = MagicMock()
    plugin = NewsPlugin(llm=llm, article_count=2)
    blocks = plugin.get_blocks()

    article_block = blocks[2]["text"]["text"]
    assert "Headline One" in article_block
    assert "Summary." in article_block
    assert "Source A" in blocks[3]["elements"][0]["text"]
    assert "https://example.com/1" == blocks[4]["accessory"]["url"]


@patch("vibebot.plugins.news.summarize_article", return_value=("Summary.", "Why."))
@patch("vibebot.plugins.news.fetch_top_articles", return_value=FAKE_ARTICLES)
@patch("vibebot.plugins.news.fetch_og_image", return_value=None)
def test_get_blocks_calls_summarize_for_each_article(mock_og, mock_fetch, mock_summarize):
    llm = MagicMock()
    plugin = NewsPlugin(llm=llm, article_count=2)
    plugin.get_blocks()

    assert mock_summarize.call_count == 2


@patch("vibebot.plugins.news.summarize_article", return_value=("Summary.", "Why."))
@patch("vibebot.plugins.news.fetch_top_articles", return_value=FAKE_ARTICLES)
@patch("vibebot.plugins.news.fetch_og_image", return_value=None)
def test_get_blocks_no_trailing_divider(mock_og, mock_fetch, mock_summarize):
    llm = MagicMock()
    plugin = NewsPlugin(llm=llm, article_count=2)
    blocks = plugin.get_blocks()

    assert blocks[-1]["type"] == "section"
