"""
Build Slack Block Kit payloads for F1 session notifications.
No LLM required — all data is structured.
"""
from datetime import datetime
from zoneinfo import ZoneInfo


_SESSION_EMOJI = {
    "Practice 1": "🔧",
    "Practice 2": "🔧",
    "Practice 3": "🔧",
    "Qualifying": "⏱️",
    "Sprint Qualifying": "⚡",
    "Sprint": "⚡",
    "Race": "🏁",
}

# Human-friendly label used in message headers.
_SESSION_LABEL = {
    "Practice 1": "Free Practice 1",
    "Practice 2": "Free Practice 2",
    "Practice 3": "Free Practice 3",
    "Qualifying": "Qualifying",
    "Sprint Qualifying": "Sprint Shoot-out",
    "Sprint": "Sprint Race",
    "Race": "Grand Prix Race",
}

# One-line description added to pre-session messages so the context is obvious.
_SESSION_DESCRIPTION = {
    "Practice 1": "Free practice — no championship points.",
    "Practice 2": "Free practice — no championship points.",
    "Practice 3": "Free practice — no championship points.",
    "Qualifying": "Sets the starting grid for Sunday's Grand Prix.",
    "Sprint Qualifying": "Sets the grid for Saturday's Sprint Race.",
    "Sprint": "Short race — championship points for top 8 finishers.",
    "Race": "Full Grand Prix — championship points awarded to top 10.",
}

_MEDAL = {1: "🥇", 2: "🥈", 3: "🥉"}


def _fmt_time(utc_iso: str, tz_name: str) -> str:
    """Format a UTC ISO string as 'Fri Mar 20 · 7:30 AM ET'."""
    dt = datetime.fromisoformat(utc_iso).astimezone(ZoneInfo(tz_name))
    tz_abbr = dt.strftime("%Z")
    return dt.strftime(f"%a %b %-d · %-I:%M %p {tz_abbr}")


def _header(text: str) -> dict:
    return {"type": "header", "text": {"type": "plain_text", "text": text, "emoji": True}}


def _section(text: str) -> dict:
    return {"type": "section", "text": {"type": "mrkdwn", "text": text}}


def _divider() -> dict:
    return {"type": "divider"}


def build_pre_session_blocks(session: dict, display_tz: str = "US/Eastern") -> list:
    """30-minute warning before any session."""
    session_type = session["session_type"]
    emoji = _SESSION_EMOJI.get(session_type, "🏎️")
    label = _SESSION_LABEL.get(session_type, session_type)
    desc = _SESSION_DESCRIPTION.get(session_type, "")
    time_str = _fmt_time(session["start_utc"], display_tz)
    desc_line = f"_{desc}_\n" if desc else ""
    return [
        _header(f"{emoji} {label} — Starting Soon"),
        _section(
            f"*{session['event_name']}*  |  Round {session['round_number']}\n"
            f"📍 {session['circuit']}, {session['country']}\n"
            f"🕐 {time_str}"
        ),
        _divider(),
        _section(f"{desc_line}_Session begins in ~30 minutes._"),
    ]


def build_pre_sprint_blocks(session: dict, grid: list, display_tz: str = "US/Eastern") -> list:
    """1-hour Sprint Race briefing with sprint qualifying grid."""
    time_str = _fmt_time(session["start_utc"], display_tz)
    top8 = []
    for r in grid[:8]:
        pos = r.get("position", "?")
        code = r.get("driver_code", "???")
        medal = _MEDAL.get(int(pos), f"  {pos}.")
        top8.append(f"{medal}  *{code}*")
    grid_text = "\n".join(top8) if top8 else "_Grid not yet available._"
    return [
        _header(f"⚡ Sprint Race — {session['event_name']}"),
        _section(
            f"*Round {session['round_number']}*  |  📍 {session['circuit']}, {session['country']}\n"
            f"🕐 Lights out at {time_str}"
        ),
        _divider(),
        _section("*Sprint Grid (Top 8)*\n" + grid_text),
        _divider(),
        _section("_Sprint Race begins in ~1 hour. Points for top 8 finishers._"),
    ]


def build_post_fp_blocks(session: dict, results: list, display_tz: str = "US/Eastern") -> list:
    """Post-FP summary with top lap times."""
    emoji = _SESSION_EMOJI.get(session["session_type"], "🔧")
    lines = [f"*{emoji} {session['session_type']} — Top Times*\n"]
    for r in results[:10]:
        pos = r.get("position", "?")
        code = r.get("driver_code", r.get("Driver", {}).get("code", "???"))
        lap = r.get("lap_duration", "")
        lap_str = f"{lap:.3f}s" if isinstance(lap, float) else str(lap)
        medal = _MEDAL.get(int(pos), f"{pos}.")
        lines.append(f"{medal}  *{code}*  —  {lap_str}")
    return [
        _header(f"{emoji} {session['session_type']} Complete"),
        _section("\n".join(lines)),
        _divider(),
        _section(f"_{session['event_name']} · {session['circuit']}_"),
    ]


def _quali_row(r: dict) -> str:
    pos = r.get("position", "?")
    code = r.get("Driver", {}).get("code", "???")
    team = r.get("Constructor", {}).get("name", "")
    time = r.get("Q3") or r.get("Q2") or r.get("Q1") or "—"
    medal = _MEDAL.get(int(pos), f"  {pos}.")
    return f"{medal}  *{code}*  {team}  `{time}`"


def build_post_quali_blocks(session: dict, grid: list, display_tz: str = "US/Eastern") -> list:
    """Post-qualifying grid summary."""
    lines = [_quali_row(r) for r in grid[:20]]
    return [
        _header("⏱️ Qualifying Complete — Starting Grid"),
        _section("\n".join(lines)),
        _divider(),
        _section(f"_{session['event_name']} · {session['circuit']}_"),
    ]


def build_post_sprint_quali_blocks(session: dict, grid: list, display_tz: str = "US/Eastern") -> list:
    """Post-sprint qualifying grid."""
    lines = [_quali_row(r) for r in grid[:8]]
    return [
        _header("⚡ Sprint Qualifying Complete — Sprint Grid"),
        _section("\n".join(lines)),
        _divider(),
        _section(f"_{session['event_name']} · {session['circuit']}_"),
    ]


def build_post_sprint_blocks(session: dict, results: list, display_tz: str = "US/Eastern") -> list:
    """Post-sprint race result."""
    lines = []
    for r in results[:8]:
        pos = r.get("position", "?")
        code = r.get("Driver", {}).get("code", "???")
        team = r.get("Constructor", {}).get("name", "")
        time_info = r.get("Time", {}) or {}
        t = time_info.get("time", "") or ""
        medal = _MEDAL.get(int(pos), f"  {pos}.")
        lines.append(f"{medal}  *{code}*  {team}  {t}".strip())
    return [
        _header("⚡ Sprint Race Result"),
        _section("\n".join(lines)),
        _divider(),
        _section(f"_{session['event_name']} · {session['circuit']}_"),
    ]


def build_pre_race_blocks(session: dict, grid: list, display_tz: str = "US/Eastern") -> list:
    """1-hour race day briefing with starting grid."""
    time_str = _fmt_time(session["start_utc"], display_tz)
    top5 = []
    for r in grid[:5]:
        pos = r.get("position", "?")
        code = r.get("Driver", {}).get("code", "???")
        team = r.get("Constructor", {}).get("name", "")
        medal = _MEDAL.get(int(pos), f"  {pos}.")
        top5.append(f"{medal}  *{code}*  {team}")
    return [
        _header(f"🏁 Race Day — {session['event_name']}"),
        _section(
            f"*Round {session['round_number']}*  |  📍 {session['circuit']}, {session['country']}\n"
            f"🕐 Lights out at {time_str}"
        ),
        _divider(),
        _section("*Starting Grid (Top 5)*\n" + "\n".join(top5)),
        _divider(),
        _section("_Race begins in ~1 hour. Good luck out there!_"),
    ]


def build_post_race_blocks(session: dict, podium: list, display_tz: str = "US/Eastern") -> list:
    """Post-race podium result."""
    lines = []
    for r in podium[:3]:
        pos = int(r.get("position", 99))
        driver = r.get("Driver", {})
        name = f"{driver.get('givenName', '')} {driver.get('familyName', '')}".strip()
        code = driver.get("code", "???")
        team = r.get("Constructor", {}).get("name", "")
        time_info = r.get("Time", {}) or {}
        t = time_info.get("time", "")
        medal = _MEDAL.get(pos, f"  {pos}.")
        lines.append(f"{medal}  *{name}* ({code})  —  {team}  {t}".strip())
    return [
        _header(f"🏆 Race Result — {session['event_name']}"),
        _section("*Podium*\n" + "\n".join(lines)),
        _divider(),
        _section(f"_Round {session['round_number']} · {session['circuit']}, {session['country']}_"),
    ]
