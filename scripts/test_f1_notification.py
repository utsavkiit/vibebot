"""
Send a test F1 notification to Slack using real live data.

Fetches the next upcoming session from OpenF1, builds the requested
notification message, and sends it to F1_SLACK_WEBHOOK_URL.

Usage:
    python3 scripts/test_f1_notification.py [--type TYPE] [--dry-run]

Types:
    pre_session      (default) 30-min warning before any session
    pre_race         Race-day briefing with starting grid (race sessions only)
    post_fp          Post-practice top times
    post_quali       Post-qualifying starting grid
    post_sprint_quali  Post-sprint qualifying grid
    post_sprint      Post-sprint race result
    post_race        Post-race podium

Options:
    --dry-run   Print blocks as JSON without sending to Slack
    --type      Notification type (see above)
"""

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

import requests

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

_DB_PATH = REPO_ROOT / "vibebot.db"
_YEAR = 2026
_DISPLAY_TZ = "US/Eastern"


def _session_to_dict(row) -> dict:
    return dict(zip(row.keys(), tuple(row)))


def _pick_session(sessions: list, session_type_filter: str = None) -> dict:
    for row in sessions:
        s = _session_to_dict(row)
        if session_type_filter is None or s["session_type"] == session_type_filter:
            return s
    return None


def build_blocks(notification_type: str, session: dict) -> list:
    stype = session["session_type"]
    key = session["session_key"]
    year = session["year"]
    rnum = session["round_number"]

    if notification_type == "pre_session":
        return build_pre_session_blocks(session, display_tz=_DISPLAY_TZ)

    if notification_type == "pre_race":
        grid = fetch_quali_grid(year, rnum)
        return build_pre_race_blocks(session, grid, display_tz=_DISPLAY_TZ)

    if notification_type == "pre_sprint":
        # Find the Sprint Qualifying session_key for the same round
        init_db(_DB_PATH)
        conn = get_connection(_DB_PATH)
        row = conn.execute(
            "SELECT session_key FROM f1_sessions WHERE year=? AND round_number=? AND session_type='Sprint Qualifying'",
            (year, rnum),
        ).fetchone()
        conn.close()
        sq_key = row[0] if row else None
        grid = fetch_sprint_quali_grid(sq_key) if sq_key else []
        return build_pre_sprint_blocks(session, grid, display_tz=_DISPLAY_TZ)

    if notification_type == "post_fp":
        results = fetch_fp_top_times(key)
        return build_post_fp_blocks(session, results, display_tz=_DISPLAY_TZ)

    if notification_type == "post_quali":
        grid = fetch_quali_grid(year, rnum)
        return build_post_quali_blocks(session, grid, display_tz=_DISPLAY_TZ)

    if notification_type == "post_sprint_quali":
        grid = fetch_quali_grid(year, rnum)
        return build_post_sprint_quali_blocks(session, grid, display_tz=_DISPLAY_TZ)

    if notification_type == "post_sprint":
        results = fetch_sprint_result(year, rnum)
        return build_post_sprint_blocks(session, results, display_tz=_DISPLAY_TZ)

    if notification_type == "post_race":
        results = fetch_race_result(year, rnum)
        return build_post_race_blocks(session, results, display_tz=_DISPLAY_TZ)

    raise ValueError(f"Unknown notification type: {notification_type!r}")


_SESSION_TYPE_FOR_NOTIF = {
    "pre_session": None,          # any session
    "pre_race": "Race",
    "pre_sprint": "Sprint",
    "post_fp": "Practice 1",      # use FP1 as representative
    "post_quali": "Qualifying",
    "post_sprint_quali": "Sprint Qualifying",
    "post_sprint": "Sprint",
    "post_race": "Race",
}


def main():
    parser = argparse.ArgumentParser(description="Test F1 Slack notifications end-to-end.")
    parser.add_argument(
        "--type",
        default="pre_session",
        choices=list(_SESSION_TYPE_FOR_NOTIF.keys()),
        help="Notification type to test (default: pre_session)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print blocks as JSON without sending to Slack",
    )
    args = parser.parse_args()

    # Refresh calendar
    init_db(_DB_PATH)
    conn = get_connection(_DB_PATH)
    print(f"Fetching 2026 calendar from OpenF1...")
    n = fetch_and_store_calendar(conn, _YEAR)
    print(f"  {n} new session(s) stored.")

    # Find a matching session
    all_upcoming = get_upcoming_sessions(conn)
    conn.close()

    required_stype = _SESSION_TYPE_FOR_NOTIF[args.type]
    session = _pick_session(all_upcoming, required_stype)

    if session is None:
        # Fall back to the most recently passed session if nothing upcoming
        print(f"No upcoming session of type {required_stype!r} found — using hardcoded stub.")
        session = {
            "session_key": "stub_9999",
            "year": _YEAR,
            "round_number": 1,
            "event_name": "Bahrain Grand Prix",
            "circuit": "Bahrain International Circuit",
            "country": "Bahrain",
            "session_type": required_stype or "Race",
            "start_utc": "2026-03-15T13:00:00+00:00",
            "end_utc": "2026-03-15T15:00:00+00:00",
        }

    print(f"\nSession: [{session['session_type']}] {session['event_name']} — {session['start_utc']}")
    print(f"Notification type: {args.type}\n")

    blocks = build_blocks(args.type, session)

    if args.dry_run:
        print(json.dumps(blocks, indent=2))
        return

    webhook = os.environ.get("F1_SLACK_WEBHOOK_URL")
    if not webhook:
        print("ERROR: F1_SLACK_WEBHOOK_URL is not set in .env")
        sys.exit(1)

    resp = requests.post(
        webhook,
        data=json.dumps({"blocks": blocks}),
        headers={"Content-Type": "application/json"},
        timeout=10,
    )
    if resp.status_code == 200:
        print(f"Sent to Slack.")
    else:
        print(f"Slack returned {resp.status_code}: {resp.text}")
        sys.exit(1)


if __name__ == "__main__":
    main()
