# tests/core/test_db_f1.py
import sqlite3
import tempfile
from pathlib import Path
from vibebot.core.db import init_db, get_connection

def _tmp_db():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    p = Path(f.name)
    f.close()
    init_db(p)
    return get_connection(p)

def test_f1_sessions_table_exists():
    conn = _tmp_db()
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='f1_sessions'"
    )
    assert cursor.fetchone() is not None
    conn.close()

def test_f1_sent_notifications_table_exists():
    conn = _tmp_db()
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='f1_sent_notifications'"
    )
    assert cursor.fetchone() is not None
    conn.close()

def test_f1_sessions_columns():
    conn = _tmp_db()
    cursor = conn.execute("PRAGMA table_info(f1_sessions)")
    cols = {row[1] for row in cursor.fetchall()}
    assert {"session_key", "year", "round_number", "event_name", "circuit",
            "country", "session_type", "start_utc", "end_utc"}.issubset(cols)
    conn.close()
