from unittest.mock import MagicMock, patch

import pytest

from vibebot.core.slack_sender import SlackSender


FAKE_BLOCKS = [{"type": "section", "text": {"type": "mrkdwn", "text": "Hello"}}]


def _mock_response(status_code=200, text="ok"):
    mock = MagicMock()
    mock.status_code = status_code
    mock.text = text
    return mock


def test_send_posts_to_webhook(monkeypatch):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")
    with patch("vibebot.core.slack_sender.requests.post", return_value=_mock_response()) as mock_post:
        SlackSender().send(FAKE_BLOCKS)

    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args
    assert call_kwargs[0][0] == "https://hooks.slack.com/test"


def test_send_missing_webhook_url(monkeypatch):
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    with pytest.raises(EnvironmentError, match="SLACK_WEBHOOK_URL"):
        SlackSender()


def test_send_non_200_raises(monkeypatch):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")
    with patch("vibebot.core.slack_sender.requests.post", return_value=_mock_response(status_code=500, text="error")):
        with pytest.raises(RuntimeError, match="500"):
            SlackSender().send(FAKE_BLOCKS)


def test_send_payload_contains_blocks(monkeypatch):
    import json
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")
    with patch("vibebot.core.slack_sender.requests.post", return_value=_mock_response()) as mock_post:
        SlackSender().send(FAKE_BLOCKS)

    sent_data = json.loads(mock_post.call_args[1]["data"])
    assert sent_data["blocks"] == FAKE_BLOCKS
