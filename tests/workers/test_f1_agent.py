# tests/workers/test_f1_agent.py
import tempfile
from pathlib import Path
import sqlite3

from vibebot.core.db import init_db, get_connection
from vibebot.workers.f1_agent import (
    notification_already_sent,
    mark_notification_sent,
    build_job_id,
)

def _tmp_conn():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    p = Path(f.name)
    f.close()
    init_db(p)
    return get_connection(p)

def test_notification_not_sent_initially():
    conn = _tmp_conn()
    assert not notification_already_sent(conn, "9158", "pre_session")
    conn.close()

def test_mark_and_check_notification_sent():
    conn = _tmp_conn()
    mark_notification_sent(conn, "9158", "pre_session")
    assert notification_already_sent(conn, "9158", "pre_session")
    conn.close()

def test_mark_notification_idempotent():
    conn = _tmp_conn()
    mark_notification_sent(conn, "9158", "pre_session")
    mark_notification_sent(conn, "9158", "pre_session")  # must not raise
    count = conn.execute(
        "SELECT COUNT(*) FROM f1_sent_notifications WHERE session_key='9158'"
    ).fetchone()[0]
    assert count == 1
    conn.close()

def test_build_job_id_is_stable():
    jid = build_job_id("9158", "pre_session")
    assert jid == build_job_id("9158", "pre_session")
    assert jid != build_job_id("9158", "post_fp")
