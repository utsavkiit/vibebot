# vibebot/workers/f1_agent.py
"""
Long-running F1 notification daemon.

Run with:
    python -m vibebot.workers.f1_agent
"""
import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.date import DateTrigger
from dotenv import load_dotenv

from vibebot.core.db import get_connection, init_db
from vibebot.plugins.f1.calendar import fetch_and_store_calendar, get_upcoming_sessions
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


# ---------------------------------------------------------------------------
# Slack sender (uses F1_SLACK_WEBHOOK_URL, separate from news plugin)
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


def build_job_id(session_key: str, notification_type: str) -> str:
    return f"f1_{session_key}_{notification_type}"


# ---------------------------------------------------------------------------
# Job handlers
# ---------------------------------------------------------------------------

def _job_pre_session(session_dict: dict, cfg: dict) -> None:
    conn = get_connection(_DB_PATH)
    key = session_dict["session_key"]
    if notification_already_sent(conn, key, "pre_session"):
        conn.close()
        return
    blocks = build_pre_session_blocks(session_dict, display_tz=cfg["display_timezone"])
    _send_slack(blocks)
    mark_notification_sent(conn, key, "pre_session")
    conn.close()
    log.info("Sent pre_session for session %s", key)


def _job_pre_sprint(session_dict: dict, cfg: dict) -> None:
    conn = get_connection(_DB_PATH)
    key = session_dict["session_key"]
    if notification_already_sent(conn, key, "pre_sprint"):
        conn.close()
        return
    # Find the Sprint Qualifying session for the same round to get the grid.
    row = conn.execute(
        "SELECT session_key FROM f1_sessions WHERE year=? AND round_number=? AND session_type='Sprint Qualifying'",
        (session_dict["year"], session_dict["round_number"]),
    ).fetchone()
    sq_key = row[0] if row else None
    grid = fetch_sprint_quali_grid(sq_key) if sq_key else []
    blocks = build_pre_sprint_blocks(session_dict, grid, display_tz=cfg["display_timezone"])
    _send_slack(blocks)
    mark_notification_sent(conn, key, "pre_sprint")
    conn.close()
    log.info("Sent pre_sprint for session %s", key)


def _job_post_session(session_dict: dict, cfg: dict) -> None:
    conn = get_connection(_DB_PATH)
    key = session_dict["session_key"]
    stype = session_dict["session_type"]
    tz = cfg["display_timezone"]

    if stype in _FP_TYPES:
        ntype = f"post_{stype.lower().replace(' ', '_')}"
        if notification_already_sent(conn, key, ntype):
            conn.close()
            return
        results = fetch_fp_top_times(key)
        blocks = build_post_fp_blocks(session_dict, results, display_tz=tz)

    elif stype == "Qualifying":
        ntype = "post_quali"
        if notification_already_sent(conn, key, ntype):
            conn.close()
            return
        grid = fetch_quali_grid(session_dict["year"], session_dict["round_number"])
        blocks = build_post_quali_blocks(session_dict, grid, display_tz=tz)

    elif stype == "Sprint Qualifying":
        ntype = "post_sprint_quali"
        if notification_already_sent(conn, key, ntype):
            conn.close()
            return
        grid = fetch_quali_grid(session_dict["year"], session_dict["round_number"])
        blocks = build_post_sprint_quali_blocks(session_dict, grid, display_tz=tz)

    elif stype == "Sprint":
        ntype = "post_sprint"
        if notification_already_sent(conn, key, ntype):
            conn.close()
            return
        results = fetch_sprint_result(session_dict["year"], session_dict["round_number"])
        blocks = build_post_sprint_blocks(session_dict, results, display_tz=tz)

    elif stype == "Race":
        ntype = "post_race"
        if notification_already_sent(conn, key, ntype):
            conn.close()
            return
        results = fetch_race_result(session_dict["year"], session_dict["round_number"])
        blocks = build_post_race_blocks(session_dict, results, display_tz=tz)

    else:
        log.warning("Unknown session type for post-session: %s", stype)
        conn.close()
        return

    _send_slack(blocks)
    mark_notification_sent(conn, key, ntype)
    conn.close()
    log.info("Sent %s for session %s", ntype, key)


def _job_pre_race(session_dict: dict, cfg: dict) -> None:
    conn = get_connection(_DB_PATH)
    key = session_dict["session_key"]
    if notification_already_sent(conn, key, "pre_race"):
        conn.close()
        return
    grid = fetch_quali_grid(session_dict["year"], session_dict["round_number"])
    blocks = build_pre_race_blocks(session_dict, grid, display_tz=cfg["display_timezone"])
    _send_slack(blocks)
    mark_notification_sent(conn, key, "pre_race")
    conn.close()
    log.info("Sent pre_race for session %s", key)


# ---------------------------------------------------------------------------
# Scheduler setup
# ---------------------------------------------------------------------------

def _session_row_to_dict(row) -> dict:
    return dict(zip(row.keys(), tuple(row)))


def schedule_sessions(scheduler: BlockingScheduler, conn: sqlite3.Connection, cfg: dict) -> None:
    """Schedule upcoming notification jobs. Safe to call repeatedly (jobs are replaced by id)."""
    now = datetime.now(timezone.utc)
    pre_delta = timedelta(minutes=cfg.get("pre_session_minutes", 30))
    pre_race_delta = timedelta(minutes=cfg.get("pre_race_minutes", 60))
    post_delay = timedelta(minutes=cfg.get("post_session_delay_minutes", 45))

    sessions = get_upcoming_sessions(conn)
    for row in sessions:
        s = _session_row_to_dict(row)
        start = datetime.fromisoformat(s["start_utc"]).astimezone(timezone.utc)
        end_str = s.get("end_utc") or ""
        end = (datetime.fromisoformat(end_str).astimezone(timezone.utc)
               if end_str else start + timedelta(hours=2))

        # Pre-session job
        pre_time = start - pre_delta
        if pre_time > now:
            jid = build_job_id(s["session_key"], "pre_session")
            scheduler.add_job(
                _job_pre_session, DateTrigger(run_date=pre_time),
                args=[s, cfg], id=jid, replace_existing=True,
            )

        # Post-session + optional pre-race/pre-sprint jobs
        post_time = end + post_delay
        if post_time > now:
            if s["session_type"] == "Race":
                pre_race_time = start - pre_race_delta
                if pre_race_time > now:
                    jid = build_job_id(s["session_key"], "pre_race")
                    scheduler.add_job(
                        _job_pre_race, DateTrigger(run_date=pre_race_time),
                        args=[s, cfg], id=jid, replace_existing=True,
                    )
            elif s["session_type"] == "Sprint":
                pre_sprint_time = start - pre_race_delta
                if pre_sprint_time > now:
                    jid = build_job_id(s["session_key"], "pre_sprint")
                    scheduler.add_job(
                        _job_pre_sprint, DateTrigger(run_date=pre_sprint_time),
                        args=[s, cfg], id=jid, replace_existing=True,
                    )
            jid = build_job_id(s["session_key"], "post")
            scheduler.add_job(
                _job_post_session, DateTrigger(run_date=post_time),
                args=[s, cfg], id=jid, replace_existing=True,
            )

    log.info("Scheduled %d upcoming sessions.", len(sessions))


def run_f1_agent(config: dict) -> None:
    load_dotenv()
    f1_cfg = config.get("plugins", {}).get("f1", {})
    if not f1_cfg.get("enabled", False):
        log.info("F1 plugin disabled — exiting.")
        return

    refresh_hours = f1_cfg.get("calendar_refresh_hours", 24)

    init_db(_DB_PATH)
    conn = get_connection(_DB_PATH)

    fetch_and_store_calendar(conn, _YEAR)

    scheduler = BlockingScheduler(timezone="UTC")
    schedule_sessions(scheduler, conn, f1_cfg)

    def _refresh():
        refresh_conn = get_connection(_DB_PATH)
        fetch_and_store_calendar(refresh_conn, _YEAR)
        schedule_sessions(scheduler, refresh_conn, f1_cfg)
        refresh_conn.close()

    scheduler.add_job(_refresh, "interval", hours=refresh_hours, id="calendar_refresh")

    log.info("F1 agent starting.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("F1 agent stopped.")
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, stream=sys.stdout)
    _CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config.yaml"
    with open(_CONFIG_PATH) as f:
        _config = yaml.safe_load(f)
    run_f1_agent(_config)
