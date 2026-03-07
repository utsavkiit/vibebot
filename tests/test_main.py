from unittest.mock import patch

import pytest

import vibebot.main as main_module
from vibebot.core.message_utils import build_header


def test_main_calls_run_pipeline(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")

    with patch.object(main_module, "load_config", return_value={
        "llm": {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
        "plugins": {"news": {"enabled": True, "article_count": 2}},
        "delivery": {"max_retries": 3},
    }):
        with patch("vibebot.main.run_pipeline") as mock_pipeline:
            main_module.main()

    mock_pipeline.assert_called_once()


def test_main_exits_if_config_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")
    # Point repo_root to a directory with no config.yaml
    with patch("vibebot.main.Path.exists", return_value=False):
        with pytest.raises(SystemExit):
            main_module.main()


def test_build_header_format():
    blocks = build_header()
    assert blocks[0]["type"] == "header"
    assert "VibeBot" in blocks[0]["text"]["text"]
    assert blocks[1]["type"] == "context"
