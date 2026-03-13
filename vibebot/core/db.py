import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / "vibebot.db"


def init_db(db_path: Path = _DEFAULT_DB_PATH) -> None:
    """Create tables if they don't already exist."""
    with get_connection(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS raw_items (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                source_type  TEXT NOT NULL,
                external_id  TEXT,
                payload      TEXT NOT NULL,
                collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status       TEXT NOT NULL DEFAULT 'pending',
                UNIQUE(source_type, external_id)
            );

            CREATE TABLE IF NOT EXISTS outbound_messages (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                channel      TEXT NOT NULL,
                message_type TEXT NOT NULL,
                payload      TEXT NOT NULL,
                status       TEXT NOT NULL DEFAULT 'pending',
                retry_count  INTEGER NOT NULL DEFAULT 0,
                max_retries  INTEGER NOT NULL DEFAULT 3,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sent_at      TIMESTAMP,
                last_error   TEXT
            );

            CREATE TABLE IF NOT EXISTS f1_sessions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                session_key  TEXT NOT NULL UNIQUE,
                year         INTEGER NOT NULL,
                round_number INTEGER NOT NULL,
                event_name   TEXT NOT NULL,
                circuit      TEXT NOT NULL,
                country      TEXT NOT NULL,
                session_type TEXT NOT NULL,
                start_utc    TEXT NOT NULL,
                end_utc      TEXT,
                last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS f1_sent_notifications (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                session_key       TEXT NOT NULL,
                notification_type TEXT NOT NULL,
                sent_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(session_key, notification_type)
            );
        """)


def get_connection(db_path: Path = _DEFAULT_DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def insert_raw_item(
    conn: sqlite3.Connection,
    source_type: str,
    external_id: str,
    payload: dict,
) -> bool:
    """Insert a raw item. Returns True if inserted, False if it was a duplicate."""
    try:
        conn.execute(
            "INSERT INTO raw_items (source_type, external_id, payload) VALUES (?, ?, ?)",
            (source_type, external_id, json.dumps(payload)),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def get_pending_raw_items(conn: sqlite3.Connection, source_type: str) -> list:
    cursor = conn.execute(
        "SELECT * FROM raw_items WHERE source_type = ? AND status = 'pending'",
        (source_type,),
    )
    return cursor.fetchall()


def mark_raw_item_processed(conn: sqlite3.Connection, item_id: int) -> None:
    conn.execute("UPDATE raw_items SET status = 'processed' WHERE id = ?", (item_id,))
    conn.commit()


def insert_outbound_message(
    conn: sqlite3.Connection,
    channel: str,
    message_type: str,
    payload: list,
    max_retries: int = 3,
) -> int:
    """Insert a message into the delivery queue. Returns the new row id."""
    cursor = conn.execute(
        """INSERT INTO outbound_messages (channel, message_type, payload, max_retries)
           VALUES (?, ?, ?, ?)""",
        (channel, message_type, json.dumps(payload), max_retries),
    )
    conn.commit()
    return cursor.lastrowid


def get_deliverable_messages(conn: sqlite3.Connection) -> list:
    """Return all messages with status='pending'."""
    cursor = conn.execute(
        "SELECT * FROM outbound_messages WHERE status = 'pending'",
    )
    return cursor.fetchall()


def mark_message_sent(conn: sqlite3.Connection, msg_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE outbound_messages SET status = 'sent', sent_at = ? WHERE id = ?",
        (now, msg_id),
    )
    conn.commit()


def mark_message_retry(conn: sqlite3.Connection, msg_id: int, error: str) -> None:
    conn.execute(
        "UPDATE outbound_messages SET retry_count = retry_count + 1, last_error = ? WHERE id = ?",
        (error, msg_id),
    )
    conn.commit()


def mark_message_failed(conn: sqlite3.Connection, msg_id: int, error: str) -> None:
    conn.execute(
        "UPDATE outbound_messages SET status = 'failed', last_error = ? WHERE id = ?",
        (error, msg_id),
    )
    conn.commit()
