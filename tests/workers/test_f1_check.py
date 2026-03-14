# tests/workers/test_f1_check.py
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from vibebot.core.db import get_connection, init_db
from vibebot.workers.f1_check import (
    _compute_triggers,
    _post_ntype,
    mark_notification_sent,
    notification_already_sent,
    run_checks,
)

_DISPLAY_TZ = "US/Eastern"

_CFG = {
    "plugins": {
        "f1": {
            "enabled": True,
            "display_timezone": _DISPLAY_TZ,
            "pre_session_minutes": 30,
            "pre_race_minutes": 60,
            "post_session_delay_minutes": 45,
        }
    }
}

_NOW = datetime(2026, 3, 16, 12, 0, 0, tzinfo=timezone.utc)
_START = _NOW + timedelta(hours=2)
_END = _START + timedelta(hours=1, minutes=30)


def _tmp_conn():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    p = Path(f.name)
    f.close()
    init_db(p)
    return get_connection(p)


def _session(session_type="Race", start=None, end=None, session_key="9999"):
    s = _START if start is None else start
    return {
        "session_key": session_key,
        "year": 2026,
        "round_number": 3,
        "event_name": "Test Grand Prix",
        "circuit": "Test Circuit",
        "country": "Testland",
        "session_type": session_type,
        "start_utc": s.isoformat(),
        "end_utc": end.isoformat() if end else None,
    }


# ---------------------------------------------------------------------------
# _post_ntype mapping
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("stype,expected", [
    ("Practice 1",        "post_practice_1"),
    ("Practice 2",        "post_practice_2"),
    ("Practice 3",        "post_practice_3"),
    ("Qualifying",        "post_quali"),
    ("Sprint Qualifying", "post_sprint_quali"),
    ("Sprint",            "post_sprint"),
    ("Race",              "post_race"),
])
def test_post_ntype_mapping(stype, expected):
    assert _post_ntype(stype) == expected


def test_post_ntype_unknown_returns_none():
    assert _post_ntype("Unknown") is None


# ---------------------------------------------------------------------------
# _compute_triggers
# ---------------------------------------------------------------------------

def test_compute_triggers_race(freezer=None):
    s = _session("Race", start=_START, end=_END)
    cfg = _CFG["plugins"]["f1"]
    triggers = {t[0]: t for t in _compute_triggers(s, cfg)}

    assert "pre_session" in triggers
    assert "pre_race" in triggers
    assert "post_race" in triggers
    assert "pre_sprint" not in triggers

    _, pre_time, stale = triggers["pre_session"]
    assert pre_time == _START - timedelta(minutes=30)
    assert stale == _START  # stale once session starts

    _, pre_race_time, _ = triggers["pre_race"]
    assert pre_race_time == _START - timedelta(minutes=60)

    _, post_time, post_stale = triggers["post_race"]
    assert post_time == _END + timedelta(minutes=45)
    assert post_stale == post_time + timedelta(hours=2)


def test_compute_triggers_sprint():
    s = _session("Sprint", start=_START, end=_END)
    cfg = _CFG["plugins"]["f1"]
    triggers = {t[0]: t for t in _compute_triggers(s, cfg)}

    assert "pre_sprint" in triggers
    assert "post_sprint" in triggers
    assert "pre_race" not in triggers


def test_compute_triggers_fp():
    s = _session("Practice 1", start=_START, end=_END)
    cfg = _CFG["plugins"]["f1"]
    triggers = {t[0]: t for t in _compute_triggers(s, cfg)}

    assert "pre_session" in triggers
    assert "post_practice_1" in triggers
    assert "pre_race" not in triggers
    assert "pre_sprint" not in triggers


def test_compute_triggers_no_end_utc_defaults_to_start_plus_2h():
    s = _session("Race", start=_START, end=None)
    cfg = _CFG["plugins"]["f1"]
    triggers = {t[0]: t for t in _compute_triggers(s, cfg)}

    expected_end = _START + timedelta(hours=2)
    _, post_time, _ = triggers["post_race"]
    assert post_time == expected_end + timedelta(minutes=45)


# ---------------------------------------------------------------------------
# Staleness checks
# ---------------------------------------------------------------------------

def test_pre_session_not_stale_before_start():
    # trigger in past, now is before session start → should send
    start = _NOW + timedelta(minutes=10)  # session starts in 10 min
    s = _session("Practice 1", start=start)
    cfg = _CFG["plugins"]["f1"]
    triggers = {t[0]: t for t in _compute_triggers(s, cfg)}
    ntype, trigger_time, stale_at = triggers["pre_session"]
    # trigger_time = start - 30min = NOW - 20min (past), stale_at = start = NOW + 10min
    assert trigger_time < _NOW
    assert _NOW < stale_at  # not stale yet


def test_pre_session_stale_after_start():
    # session already started 5 minutes ago
    start = _NOW - timedelta(minutes=5)
    s = _session("Practice 1", start=start)
    cfg = _CFG["plugins"]["f1"]
    triggers = {t[0]: t for t in _compute_triggers(s, cfg)}
    ntype, trigger_time, stale_at = triggers["pre_session"]
    assert stale_at == start
    assert _NOW > stale_at  # stale


def test_post_session_not_stale_within_2h():
    # session ended 1 hour ago, trigger was 45 min ago → within 2h window
    end = _NOW - timedelta(hours=1)
    start = end - timedelta(hours=2)
    s = _session("Race", start=start, end=end)
    cfg = _CFG["plugins"]["f1"]
    triggers = {t[0]: t for t in _compute_triggers(s, cfg)}
    ntype, trigger_time, stale_at = triggers["post_race"]
    assert trigger_time < _NOW
    assert _NOW < stale_at  # not stale


def test_post_session_stale_after_2h():
    # trigger was 3 hours ago
    end = _NOW - timedelta(hours=3, minutes=45)
    start = end - timedelta(hours=2)
    s = _session("Race", start=start, end=end)
    cfg = _CFG["plugins"]["f1"]
    triggers = {t[0]: t for t in _compute_triggers(s, cfg)}
    ntype, trigger_time, stale_at = triggers["post_race"]
    assert _NOW > stale_at  # stale


# ---------------------------------------------------------------------------
# run_checks integration (mocked)
# ---------------------------------------------------------------------------

def _insert_session(conn, s: dict):
    conn.execute(
        """INSERT OR IGNORE INTO f1_sessions
           (session_key, year, round_number, event_name, circuit, country,
            session_type, start_utc, end_utc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (s["session_key"], s["year"], s["round_number"], s["event_name"],
         s["circuit"], s["country"], s["session_type"], s["start_utc"], s["end_utc"]),
    )
    conn.commit()


def _make_due_session(stype="Race"):
    """A session whose post_* trigger was 15 minutes ago and is not yet stale.
    start = _NOW - 2h (within the 3h lookback), end = _NOW - 1h."""
    end = _NOW - timedelta(hours=1)
    start = end - timedelta(hours=1)
    return _session(stype, start=start, end=end)


@patch("vibebot.workers.f1_check._DB_PATH")
@patch("vibebot.workers.f1_check.fetch_and_store_calendar")
@patch("vibebot.workers.f1_check._send_slack")
@patch("vibebot.workers.f1_check.fetch_race_result", return_value=[])
@patch("vibebot.workers.f1_check.datetime")
def test_sends_due_notification(mock_dt, mock_result, mock_slack, mock_cal, mock_db_path):
    mock_dt.now.return_value = _NOW
    mock_dt.fromisoformat.side_effect = datetime.fromisoformat

    import tempfile
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_path = Path(f.name)
    f.close()
    init_db(db_path)

    s = _make_due_session("Race")
    setup_conn = get_connection(db_path)
    _insert_session(setup_conn, s)
    setup_conn.close()

    with patch("vibebot.workers.f1_check.get_connection", side_effect=lambda p: get_connection(db_path)), \
         patch("vibebot.workers.f1_check.init_db"):
        run_checks(_CFG)

    assert mock_slack.called
    verify_conn = get_connection(db_path)
    assert notification_already_sent(verify_conn, s["session_key"], "post_race")
    verify_conn.close()


@patch("vibebot.workers.f1_check._DB_PATH")
@patch("vibebot.workers.f1_check.fetch_and_store_calendar")
@patch("vibebot.workers.f1_check._send_slack")
@patch("vibebot.workers.f1_check.fetch_race_result", return_value=[])
@patch("vibebot.workers.f1_check.datetime")
def test_skips_already_sent(mock_dt, mock_result, mock_slack, mock_cal, mock_db_path):
    mock_dt.now.return_value = _NOW
    mock_dt.fromisoformat.side_effect = datetime.fromisoformat

    conn = _tmp_conn()
    s = _make_due_session("Race")
    _insert_session(conn, s)
    mark_notification_sent(conn, s["session_key"], "post_race")

    with patch("vibebot.workers.f1_check.get_connection", return_value=conn), \
         patch("vibebot.workers.f1_check.init_db"):
        run_checks(_CFG)

    mock_slack.assert_not_called()
    conn.close()


@patch("vibebot.workers.f1_check._DB_PATH")
@patch("vibebot.workers.f1_check.fetch_and_store_calendar")
@patch("vibebot.workers.f1_check._send_slack")
@patch("vibebot.workers.f1_check.datetime")
def test_skips_not_yet_due(mock_dt, mock_slack, mock_cal, mock_db_path):
    mock_dt.now.return_value = _NOW
    mock_dt.fromisoformat.side_effect = datetime.fromisoformat

    conn = _tmp_conn()
    # session starts 2 hours from now — no notifications due
    s = _session("Race", start=_NOW + timedelta(hours=2))
    _insert_session(conn, s)

    with patch("vibebot.workers.f1_check.get_connection", return_value=conn), \
         patch("vibebot.workers.f1_check.init_db"):
        run_checks(_CFG)

    mock_slack.assert_not_called()
    conn.close()


@patch("vibebot.workers.f1_check._DB_PATH")
@patch("vibebot.workers.f1_check.fetch_and_store_calendar")
@patch("vibebot.workers.f1_check._send_slack")
@patch("vibebot.workers.f1_check.datetime")
def test_skips_stale_pre_session(mock_dt, mock_slack, mock_cal, mock_db_path):
    mock_dt.now.return_value = _NOW
    mock_dt.fromisoformat.side_effect = datetime.fromisoformat

    conn = _tmp_conn()
    # session started 10 minutes ago — pre_session is stale
    start = _NOW - timedelta(minutes=10)
    s = _session("Practice 1", start=start, end=_NOW + timedelta(hours=1))
    _insert_session(conn, s)

    with patch("vibebot.workers.f1_check.get_connection", return_value=conn), \
         patch("vibebot.workers.f1_check.init_db"):
        run_checks(_CFG)

    mock_slack.assert_not_called()
    conn.close()


@patch("vibebot.workers.f1_check._DB_PATH")
@patch("vibebot.workers.f1_check.fetch_and_store_calendar", side_effect=Exception("API down"))
@patch("vibebot.workers.f1_check._send_slack")
@patch("vibebot.workers.f1_check.fetch_race_result", return_value=[])
@patch("vibebot.workers.f1_check.datetime")
def test_calendar_failure_does_not_block(mock_dt, mock_result, mock_slack, mock_cal, mock_db_path):
    mock_dt.now.return_value = _NOW
    mock_dt.fromisoformat.side_effect = datetime.fromisoformat

    conn = _tmp_conn()
    s = _make_due_session("Race")
    _insert_session(conn, s)

    with patch("vibebot.workers.f1_check.get_connection", return_value=conn), \
         patch("vibebot.workers.f1_check.init_db"):
        run_checks(_CFG)  # must not raise

    assert mock_slack.called
    conn.close()


@patch("vibebot.workers.f1_check._DB_PATH")
@patch("vibebot.workers.f1_check.fetch_and_store_calendar")
@patch("vibebot.workers.f1_check._send_slack")
@patch("vibebot.workers.f1_check.fetch_race_result", return_value=[])
@patch("vibebot.workers.f1_check.datetime")
def test_idempotency(mock_dt, mock_result, mock_slack, mock_cal, mock_db_path):
    mock_dt.now.return_value = _NOW
    mock_dt.fromisoformat.side_effect = datetime.fromisoformat

    import tempfile
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_path = Path(f.name)
    f.close()
    init_db(db_path)

    s = _make_due_session("Race")
    setup_conn = get_connection(db_path)
    _insert_session(setup_conn, s)
    setup_conn.close()

    with patch("vibebot.workers.f1_check.get_connection", side_effect=lambda p: get_connection(db_path)), \
         patch("vibebot.workers.f1_check.init_db"):
        run_checks(_CFG)
        run_checks(_CFG)

    assert mock_slack.call_count == 1  # sent exactly once
