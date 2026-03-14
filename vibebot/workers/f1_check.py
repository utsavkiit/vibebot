# vibebot/workers/f1_check.py
"""
Short-lived F1 notification check — run by launchd every 5 minutes.

On each run: refresh calendar, determine which notifications are due
and not yet sent, send them, then exit. launchd's StartInterval handles
scheduling, so notifications survive Mac sleep/wake naturally.

Run with:
    python -m vibebot.workers.f1_check
"""
import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv
from typing import Optional

from vibebot.core.db import get_connection, init_db
from vibebot.plugins.f1.calendar import fetch_and_store_calendar
from vibebot.plugins.f1.notifier import (
    build_post_fp_blocks,
    build_post_quali_blocks,
    build_post_race_blocks,
    build_post_sprint_blocks,
    build_post_sprint_quali_blocks,
    build_pre_race_blocks,
    build_pre_session_blocks,
    build_pre_sprint_blocks,
)
from vibebot.plugins.f1.results import (
    fetch_fp_top_times,
    fetch_quali_grid,
    fetch_race_result,
    fetch_sprint_quali_grid,
    fetch_sprint_result,
)

log = logging.getLogger(__name__)

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "vibebot.db"
_YEAR = 2026
_FP_TYPES = {"Practice 1", "Practice 2", "Practice 3"}
_POST_STALE_HOURS = 2   # post_* notifications remain useful this long after trigger
_LOOKBACK_HOURS = 3     # how far back to scan for actionable sessions


# ---------------------------------------------------------------------------
# Slack sender
# ---------------------------------------------------------------------------

def _send_slack(blocks: list) -> None:
    webhook_url = os.environ.get("F1_SLACK_WEBHOOK_URL")
    if not webhook_url:
        log.error("F1_SLACK_WEBHOOK_URL is not set — cannot send Slack message.")
        return
    try:
        resp = requests.post(
            webhook_url,
            data=json.dumps({"blocks": blocks}),
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        if resp.status_code != 200:
            log.error("Slack returned %s: %s", resp.status_code, resp.text)
    except Exception as exc:
        log.error("Failed to send Slack message: %s", exc)


# ---------------------------------------------------------------------------
# Notification state helpers
# ---------------------------------------------------------------------------

def notification_already_sent(conn: sqlite3.Connection, session_key: str, notification_type: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM f1_sent_notifications WHERE session_key=? AND notification_type=?",
        (session_key, notification_type),
    ).fetchone()
    return row is not None


def mark_notification_sent(conn: sqlite3.Connection, session_key: str, notification_type: str) -> None:
    try:
        conn.execute(
            "INSERT INTO f1_sent_notifications (session_key, notification_type) VALUES (?, ?)",
            (session_key, notification_type),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        pass  # already marked


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def _get_actionable_sessions(conn: sqlite3.Connection) -> list:
    """Return sessions that may still have unsent notifications (3h lookback)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=_LOOKBACK_HOURS)).isoformat()
    cursor = conn.execute(
        "SELECT * FROM f1_sessions WHERE start_utc >= ? ORDER BY start_utc",
        (cutoff,),
    )
    return cursor.fetchall()


def _row_to_dict(row) -> dict:
    return dict(zip(row.keys(), tuple(row)))


def _post_ntype(stype: str) -> Optional[str]:
    """Map session_type to post-notification type string.
    Strings must match what f1_agent.py writes to f1_sent_notifications."""
    return {
        "Practice 1":        "post_practice_1",
        "Practice 2":        "post_practice_2",
        "Practice 3":        "post_practice_3",
        "Qualifying":        "post_quali",
        "Sprint Qualifying": "post_sprint_quali",
        "Sprint":            "post_sprint",
        "Race":              "post_race",
    }.get(stype)


# ---------------------------------------------------------------------------
# Trigger computation
# ---------------------------------------------------------------------------

def _compute_triggers(s: dict, cfg: dict) -> list:
    """
    Return (ntype, trigger_time, stale_at) for every notification this session generates.
    A notification is sendable when: trigger_time <= now < stale_at AND not already sent.
    """
    pre_delta   = timedelta(minutes=cfg.get("pre_session_minutes", 30))
    pre_r_delta = timedelta(minutes=cfg.get("pre_race_minutes", 60))
    post_delay  = timedelta(minutes=cfg.get("post_session_delay_minutes", 45))
    post_stale  = timedelta(hours=_POST_STALE_HOURS)

    start = datetime.fromisoformat(s["start_utc"]).astimezone(timezone.utc)
    end_str = s.get("end_utc") or ""
    end = (datetime.fromisoformat(end_str).astimezone(timezone.utc)
           if end_str else start + timedelta(hours=2))

    stype = s["session_type"]
    triggers = []

    # pre_session: all session types; stale once session has started
    triggers.append(("pre_session", start - pre_delta, start))

    # pre_race / pre_sprint: stale once session has started
    if stype == "Race":
        triggers.append(("pre_race", start - pre_r_delta, start))
    elif stype == "Sprint":
        triggers.append(("pre_sprint", start - pre_r_delta, start))

    # post_*: stale 2 hours after trigger
    ntype = _post_ntype(stype)
    if ntype:
        post_time = end + post_delay
        triggers.append((ntype, post_time, post_time + post_stale))

    return triggers


# ---------------------------------------------------------------------------
# Block builders
# ---------------------------------------------------------------------------

def _build_pre_sprint_blocks(conn: sqlite3.Connection, s: dict, cfg: dict) -> list:
    row = conn.execute(
        "SELECT session_key FROM f1_sessions WHERE year=? AND round_number=? AND session_type='Sprint Qualifying'",
        (s["year"], s["round_number"]),
    ).fetchone()
    sq_key = row[0] if row else None
    grid = fetch_sprint_quali_grid(sq_key) if sq_key else []
    return build_pre_sprint_blocks(s, grid, display_tz=cfg["display_timezone"])


def _build_post_blocks(s: dict, cfg: dict) -> list:
    stype = s["session_type"]
    tz = cfg["display_timezone"]
    if stype in _FP_TYPES:
        return build_post_fp_blocks(s, fetch_fp_top_times(s["session_key"]), display_tz=tz)
    if stype == "Qualifying":
        return build_post_quali_blocks(s, fetch_quali_grid(s["year"], s["round_number"]), display_tz=tz)
    if stype == "Sprint Qualifying":
        return build_post_sprint_quali_blocks(s, fetch_quali_grid(s["year"], s["round_number"]), display_tz=tz)
    if stype == "Sprint":
        return build_post_sprint_blocks(s, fetch_sprint_result(s["year"], s["round_number"]), display_tz=tz)
    if stype == "Race":
        return build_post_race_blocks(s, fetch_race_result(s["year"], s["round_number"]), display_tz=tz)
    return []


def _build_blocks(conn: sqlite3.Connection, s: dict, ntype: str, cfg: dict) -> list:
    tz = cfg["display_timezone"]
    if ntype == "pre_session":
        return build_pre_session_blocks(s, display_tz=tz)
    if ntype == "pre_race":
        return build_pre_race_blocks(s, fetch_quali_grid(s["year"], s["round_number"]), display_tz=tz)
    if ntype == "pre_sprint":
        return _build_pre_sprint_blocks(conn, s, cfg)
    if ntype.startswith("post_"):
        return _build_post_blocks(s, cfg)
    log.warning("Unknown notification type: %s", ntype)
    return []


# ---------------------------------------------------------------------------
# Main check loop
# ---------------------------------------------------------------------------

def run_checks(config: dict) -> None:
    load_dotenv()
    f1_cfg = config.get("plugins", {}).get("f1", {})
    if not f1_cfg.get("enabled", False):
        log.info("F1 plugin disabled — exiting.")
        return

    init_db(_DB_PATH)
    conn = get_connection(_DB_PATH)

    try:
        fetch_and_store_calendar(conn, _YEAR)
    except Exception as exc:
        log.warning("Calendar refresh failed (continuing with cached data): %s", exc)

    now = datetime.now(timezone.utc)
    sessions = _get_actionable_sessions(conn)
    log.info("Checking %d actionable session(s) at %s", len(sessions), now.isoformat())

    sent_count = 0
    for row in sessions:
        s = _row_to_dict(row)
        for ntype, trigger_time, stale_at in _compute_triggers(s, f1_cfg):
            if trigger_time > now:
                continue  # not due yet
            if now > stale_at:
                log.debug("Skipping stale %s for session %s", ntype, s["session_key"])
                continue
            if notification_already_sent(conn, s["session_key"], ntype):
                continue

            log.info("Sending %s for session %s (%s)", ntype, s["session_key"], s["event_name"])
            try:
                blocks = _build_blocks(conn, s, ntype, f1_cfg)
                if blocks:
                    _send_slack(blocks)
                    mark_notification_sent(conn, s["session_key"], ntype)
                    sent_count += 1
            except Exception as exc:
                log.error("Failed to send %s for session %s: %s", ntype, s["session_key"], exc)

    log.info("Done. Sent %d notification(s).", sent_count)
    conn.close()


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, stream=sys.stdout)
    _CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config.yaml"
    with open(_CONFIG_PATH) as f:
        _config = yaml.safe_load(f)
    run_checks(_config)
