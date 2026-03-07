import json

from vibebot.core.db import (
    get_connection,
    get_deliverable_messages,
    get_pending_raw_items,
    init_db,
    insert_outbound_message,
    insert_raw_item,
    mark_message_failed,
    mark_message_retry,
    mark_message_sent,
    mark_raw_item_processed,
)


def test_init_db_creates_tables(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    conn = get_connection(db_path)
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert "raw_items" in tables
    assert "outbound_messages" in tables


def test_insert_raw_item_new(db):
    result = insert_raw_item(db, "news", "abc123", {"title": "Test"})
    assert result is True


def test_insert_raw_item_duplicate(db):
    insert_raw_item(db, "news", "abc123", {"title": "Test"})
    result = insert_raw_item(db, "news", "abc123", {"title": "Test again"})
    assert result is False


def test_get_pending_raw_items_returns_pending(db):
    insert_raw_item(db, "news", "abc123", {"title": "Test"})
    items = get_pending_raw_items(db, "news")
    assert len(items) == 1
    assert json.loads(items[0]["payload"])["title"] == "Test"


def test_get_pending_raw_items_filters_by_source(db):
    insert_raw_item(db, "news", "abc123", {"title": "News"})
    insert_raw_item(db, "stocks", "def456", {"ticker": "AAPL"})
    assert len(get_pending_raw_items(db, "news")) == 1
    assert len(get_pending_raw_items(db, "stocks")) == 1


def test_mark_raw_item_processed(db):
    insert_raw_item(db, "news", "abc123", {"title": "Test"})
    items = get_pending_raw_items(db, "news")
    mark_raw_item_processed(db, items[0]["id"])
    assert get_pending_raw_items(db, "news") == []


def test_insert_outbound_message_returns_id(db):
    msg_id = insert_outbound_message(db, "slack_default", "news_digest", [{"type": "section"}])
    assert isinstance(msg_id, int)
    assert msg_id > 0


def test_get_deliverable_messages_returns_pending(db):
    insert_outbound_message(db, "slack_default", "news_digest", [])
    messages = get_deliverable_messages(db)
    assert len(messages) == 1


def test_mark_message_sent_removes_from_queue(db):
    msg_id = insert_outbound_message(db, "slack_default", "news_digest", [])
    mark_message_sent(db, msg_id)
    assert get_deliverable_messages(db) == []


def test_mark_message_retry_increments_count(db):
    msg_id = insert_outbound_message(db, "slack_default", "news_digest", [])
    mark_message_retry(db, msg_id, "timeout")
    row = db.execute(
        "SELECT retry_count, last_error FROM outbound_messages WHERE id=?", (msg_id,)
    ).fetchone()
    assert row["retry_count"] == 1
    assert row["last_error"] == "timeout"


def test_mark_message_failed(db):
    msg_id = insert_outbound_message(db, "slack_default", "news_digest", [])
    mark_message_failed(db, msg_id, "fatal error")
    row = db.execute(
        "SELECT status, last_error FROM outbound_messages WHERE id=?", (msg_id,)
    ).fetchone()
    assert row["status"] == "failed"
    assert row["last_error"] == "fatal error"
