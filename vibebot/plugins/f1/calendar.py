import logging
import sqlite3
from datetime import datetime, timezone
from typing import Optional

import requests

log = logging.getLogger(__name__)

_OPENF1_SESSIONS_URL = "https://api.openf1.org/v1/sessions"


def fetch_and_store_calendar(conn: sqlite3.Connection, year: int) -> int:
    """
    Fetch the F1 session calendar for the given year from OpenF1 and store
    new sessions in f1_sessions. Returns count of newly inserted rows.
    """
    resp = requests.get(_OPENF1_SESSIONS_URL, params={"year": year}, timeout=15)
    resp.raise_for_status()
    sessions = resp.json()

    # Derive round_number from sorted unique meeting_keys
    meeting_keys = sorted({s["meeting_key"] for s in sessions})
    round_for_meeting = {mk: i + 1 for i, mk in enumerate(meeting_keys)}

    new_count = 0
    for s in sessions:
        session_key = str(s["session_key"])
        round_number = round_for_meeting[s["meeting_key"]]
        try:
            conn.execute(
                """INSERT INTO f1_sessions
                   (session_key, year, round_number, event_name, circuit,
                    country, session_type, start_utc, end_utc)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_key,
                    s["year"],
                    round_number,
                    s.get("meeting_name", ""),
                    s.get("circuit_short_name", ""),
                    s.get("country_name", ""),
                    s.get("session_type", ""),
                    s.get("date_start", ""),
                    s.get("date_end", ""),
                ),
            )
            conn.commit()
            new_count += 1
        except sqlite3.IntegrityError:
            pass  # already exists

    log.info("Calendar refresh for %d: %d new sessions stored.", year, new_count)
    return new_count


def get_upcoming_sessions(
    conn: sqlite3.Connection,
    from_utc: Optional[str] = None,
) -> list:
    """
    Return all f1_sessions with start_utc >= from_utc, ordered by start_utc.
    If from_utc is None, uses current UTC time.
    """
    if from_utc is None:
        from_utc = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "SELECT * FROM f1_sessions WHERE start_utc >= ? ORDER BY start_utc",
        (from_utc,),
    )
    return cursor.fetchall()
