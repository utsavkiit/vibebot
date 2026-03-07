from unittest.mock import patch

from vibebot.core.db import get_deliverable_messages, insert_outbound_message
from vibebot.workers.delivery_worker import run


@patch("vibebot.workers.delivery_worker.SlackSender")
def test_delivers_pending_message(mock_sender_cls, db):
    mock_sender_cls.return_value.send.return_value = None
    insert_outbound_message(db, "slack_default", "news_digest", [{"type": "section"}])
    run(db)
    assert mock_sender_cls.return_value.send.call_count == 1
    assert get_deliverable_messages(db) == []


@patch("vibebot.workers.delivery_worker.SlackSender")
def test_skips_when_no_pending_messages(mock_sender_cls, db):
    run(db)
    mock_sender_cls.return_value.send.assert_not_called()


@patch("vibebot.workers.delivery_worker.time.sleep")
@patch("vibebot.workers.delivery_worker.SlackSender")
def test_retries_on_failure_then_succeeds(mock_sender_cls, mock_sleep, db):
    mock_sender_cls.return_value.send.side_effect = [
        RuntimeError("timeout"),
        None,  # succeeds on second attempt
    ]
    insert_outbound_message(db, "slack_default", "news_digest", [], max_retries=3)
    run(db)
    assert mock_sender_cls.return_value.send.call_count == 2
    assert get_deliverable_messages(db) == []


@patch("vibebot.workers.delivery_worker.time.sleep")
@patch("vibebot.workers.delivery_worker.SlackSender")
def test_marks_failed_and_notifies_after_max_retries(mock_sender_cls, mock_sleep, db):
    # All send calls fail (delivery attempts + failure notification)
    mock_sender_cls.return_value.send.side_effect = RuntimeError("always fails")
    insert_outbound_message(db, "slack_default", "news_digest", [], max_retries=2)
    run(db)
    # 2 delivery attempts + 1 failure notification
    assert mock_sender_cls.return_value.send.call_count == 3
    row = db.execute("SELECT status FROM outbound_messages").fetchone()
    assert row["status"] == "failed"


@patch("vibebot.workers.delivery_worker.time.sleep")
@patch("vibebot.workers.delivery_worker.SlackSender")
def test_retry_count_persisted_on_each_failure(mock_sender_cls, mock_sleep, db):
    mock_sender_cls.return_value.send.side_effect = RuntimeError("fail")
    insert_outbound_message(db, "slack_default", "news_digest", [], max_retries=2)
    run(db)
    row = db.execute("SELECT retry_count, last_error FROM outbound_messages").fetchone()
    assert row["retry_count"] == 2
    assert "fail" in row["last_error"]
