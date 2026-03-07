import os
from unittest.mock import MagicMock, patch

import pytest

from vibebot.plugins.news.fetcher import fetch_top_articles


SAMPLE_RESPONSE = {
    "status": "ok",
    "articles": [
        {
            "title": "Test Headline",
            "description": "Test description.",
            "url": "https://example.com/article",
            "source": {"name": "Example News"},
            "publishedAt": "2026-03-07T09:00:00Z",
        }
    ],
}


def _mock_response(status_code=200, json_data=None):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data or SAMPLE_RESPONSE
    mock.text = "ok"
    return mock


def test_fetch_returns_articles(monkeypatch):
    monkeypatch.setenv("NEWS_API_KEY", "test-key")
    with patch("vibebot.plugins.news.fetcher.requests.get", return_value=_mock_response()):
        articles = fetch_top_articles(count=1)

    assert len(articles) == 1
    assert articles[0]["title"] == "Test Headline"
    assert articles[0]["source"] == "Example News"
    assert articles[0]["url"] == "https://example.com/article"


def test_fetch_missing_api_key(monkeypatch):
    monkeypatch.delenv("NEWS_API_KEY", raising=False)
    with pytest.raises(EnvironmentError, match="NEWS_API_KEY"):
        fetch_top_articles()


def test_fetch_non_200_raises(monkeypatch):
    monkeypatch.setenv("NEWS_API_KEY", "test-key")
    with patch("vibebot.plugins.news.fetcher.requests.get", return_value=_mock_response(status_code=429)):
        with pytest.raises(RuntimeError, match="429"):
            fetch_top_articles()


def test_fetch_api_error_status_raises(monkeypatch):
    monkeypatch.setenv("NEWS_API_KEY", "test-key")
    error_response = _mock_response(json_data={"status": "error", "message": "API limit reached"})
    with patch("vibebot.plugins.news.fetcher.requests.get", return_value=error_response):
        with pytest.raises(RuntimeError, match="API limit reached"):
            fetch_top_articles()


def test_fetch_handles_missing_fields(monkeypatch):
    monkeypatch.setenv("NEWS_API_KEY", "test-key")
    sparse_response = {
        "status": "ok",
        "articles": [{"title": None, "description": None, "url": None, "source": None, "publishedAt": None}],
    }
    with patch("vibebot.plugins.news.fetcher.requests.get", return_value=_mock_response(json_data=sparse_response)):
        articles = fetch_top_articles(count=1)

    assert articles[0]["title"] == "Untitled"
    assert articles[0]["source"] == "Unknown"
