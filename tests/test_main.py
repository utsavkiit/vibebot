from unittest.mock import MagicMock, patch

import pytest

import vibebot.main as main_module


FAKE_BLOCKS = [{"type": "section", "text": {"type": "mrkdwn", "text": "News item"}}]


@patch("vibebot.main.SlackSender")
@patch("vibebot.main.get_llm")
def test_main_runs_enabled_plugins(mock_get_llm, mock_slack_cls, monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")

    # Write a temporary config
    config = tmp_path / "config.yaml"
    config.write_text(
        "llm:\n  provider: anthropic\n  model: claude-haiku-4-5-20251001\n"
        "plugins:\n  news:\n    enabled: true\n    article_count: 2\n"
    )

    mock_llm = MagicMock()
    mock_get_llm.return_value = mock_llm

    mock_sender = MagicMock()
    mock_slack_cls.return_value = mock_sender

    fake_plugin = MagicMock()
    fake_plugin.get_blocks.return_value = FAKE_BLOCKS

    with patch("vibebot.main.Path.__new__") as _:
        # Patch importlib so we don't actually import the news plugin
        with patch("importlib.import_module") as mock_import:
            mock_module = MagicMock()
            mock_module.NewsPlugin.return_value = fake_plugin
            mock_import.return_value = mock_module

            with patch.object(main_module, "load_config", return_value={
                "llm": {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
                "plugins": {"news": {"enabled": True, "article_count": 2}},
            }):
                main_module.main()

    fake_plugin.get_blocks.assert_called_once()
    mock_sender.send.assert_called_once()
    sent_blocks = mock_sender.send.call_args[0][0]
    # Header block + plugin blocks
    assert sent_blocks[0]["type"] == "header"
    assert FAKE_BLOCKS[0] in sent_blocks


@patch("vibebot.main.SlackSender")
@patch("vibebot.main.get_llm")
def test_main_skips_disabled_plugins(mock_get_llm, mock_slack_cls, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")

    with patch.object(main_module, "load_config", return_value={
        "llm": {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
        "plugins": {"news": {"enabled": False}},
    }):
        main_module.main()

    mock_slack_cls.return_value.send.assert_not_called()


@patch("vibebot.main.SlackSender")
@patch("vibebot.main.get_llm")
def test_main_header_block_format(mock_get_llm, mock_slack_cls, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")

    mock_sender = MagicMock()
    mock_slack_cls.return_value = mock_sender
    fake_plugin = MagicMock()
    fake_plugin.get_blocks.return_value = FAKE_BLOCKS

    with patch("importlib.import_module") as mock_import:
        mock_module = MagicMock()
        mock_module.NewsPlugin.return_value = fake_plugin
        mock_import.return_value = mock_module

        with patch.object(main_module, "load_config", return_value={
            "llm": {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
            "plugins": {"news": {"enabled": True, "article_count": 1}},
        }):
            main_module.main()

    sent_blocks = mock_sender.send.call_args[0][0]
    header = sent_blocks[0]
    assert header["type"] == "header"
    assert "VibeBot" in header["text"]["text"]
