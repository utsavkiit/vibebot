from datetime import date, datetime


def build_header() -> list[dict]:
    today = date.today().strftime("%A, %B %-d, %Y")
    now = datetime.now().strftime("%-I:%M %p")
    return [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🤖 VibeBot Daily Digest — {today}",
                "emoji": True,
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"Your AI-curated morning briefing  ·  Sent at {now}",
                }
            ],
        },
    ]


def build_footer() -> list[dict]:
    return [
        {"type": "divider"},
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": "🤖 _Powered by VibeBot_"}],
        },
    ]
