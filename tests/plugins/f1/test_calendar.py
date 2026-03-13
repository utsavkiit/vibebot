import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
from vibebot.core.db import init_db, get_connection
from vibebot.plugins.f1.calendar import fetch_and_store_calendar, get_upcoming_sessions

FAKE_SESSIONS = [
    {
        "session_key": 9158,
        "year": 2026,
        "meeting_key": 1241,
        "meeting_name": "Bahrain Grand Prix",
        "meeting_official_name": "Formula 1 Gulf Air Bahrain Grand Prix 2026",
        "circuit_short_name": "Bahrain",
        "country_name": "Bahrain",
        "session_type": "Practice 1",
        "date_start": "2026-03-20T11:30:00+00:00",
        "date_end": "2026-03-20T12:30:00+00:00",
    },
    {
        "session_key": 9159,
        "year": 2026,
        "meeting_key": 1241,
        "meeting_name": "Bahrain Grand Prix",
        "meeting_official_name": "Formula 1 Gulf Air Bahrain Grand Prix 2026",
        "circuit_short_name": "Bahrain",
        "country_name": "Bahrain",
        "session_type": "Race",
        "date_start": "2026-03-22T15:00:00+00:00",
        "date_end": "2026-03-22T17:00:00+00:00",
    },
]

def _tmp_conn():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    p = Path(f.name)
    f.close()
    init_db(p)
    return get_connection(p)

def test_fetch_and_store_calendar_inserts_sessions():
    conn = _tmp_conn()
    with patch("vibebot.plugins.f1.calendar.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = FAKE_SESSIONS
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp
        count = fetch_and_store_calendar(conn, year=2026)
    assert count == 2
    rows = conn.execute("SELECT * FROM f1_sessions").fetchall()
    assert len(rows) == 2
    conn.close()

def test_fetch_and_store_calendar_is_idempotent():
    conn = _tmp_conn()
    with patch("vibebot.plugins.f1.calendar.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = FAKE_SESSIONS
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp
        fetch_and_store_calendar(conn, year=2026)
        count2 = fetch_and_store_calendar(conn, year=2026)
    assert count2 == 0  # no new inserts on second call
    conn.close()

def test_get_upcoming_sessions_returns_future_only():
    conn = _tmp_conn()
    with patch("vibebot.plugins.f1.calendar.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = FAKE_SESSIONS
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp
        fetch_and_store_calendar(conn, year=2026)
    sessions = get_upcoming_sessions(conn, from_utc="2026-01-01T00:00:00+00:00")
    assert len(sessions) == 2
    conn.close()

def test_get_upcoming_sessions_filters_past():
    conn = _tmp_conn()
    with patch("vibebot.plugins.f1.calendar.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = FAKE_SESSIONS
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp
        fetch_and_store_calendar(conn, year=2026)
    sessions = get_upcoming_sessions(conn, from_utc="2026-03-23T00:00:00+00:00")
    assert len(sessions) == 0
    conn.close()
