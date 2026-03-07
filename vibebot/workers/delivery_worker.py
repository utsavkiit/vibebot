import json
import logging
import time

from vibebot.core.db import (
    get_deliverable_messages,
    mark_message_failed,
    mark_message_retry,
    mark_message_sent,
)
from vibebot.core.slack_sender import SlackSender

log = logging.getLogger(__name__)


def run(conn) -> None:
    """Stage 3: Deliver all pending outbound messages with retry and failure notification."""
    messages = get_deliverable_messages(conn)
    if not messages:
        log.info("No pending messages to deliver.")
        return
    for msg in messages:
        _deliver_with_retry(conn, msg)


def _deliver_with_retry(conn, msg) -> None:
    max_retries = msg["max_retries"]
    last_error = ""

    for attempt in range(msg["retry_count"], max_retries):
        try:
            SlackSender().send(json.loads(msg["payload"]))
            mark_message_sent(conn, msg["id"])
            log.info(
                "Delivered message id=%d (%s) on attempt %d.",
                msg["id"], msg["message_type"], attempt + 1,
            )
            return
        except Exception as e:
            last_error = str(e)
            mark_message_retry(conn, msg["id"], last_error)
            wait = 2 ** attempt  # exponential backoff: 1s, 2s, 4s ...
            log.warning(
                "Delivery attempt %d/%d failed for message id=%d: %s. Retrying in %ds.",
                attempt + 1, max_retries, msg["id"], last_error, wait,
            )
            time.sleep(wait)

    # All attempts exhausted
    mark_message_failed(conn, msg["id"], last_error)
    log.error(
        "Message id=%d (%s) permanently failed after %d attempt(s).",
        msg["id"], msg["message_type"], max_retries,
    )
    _notify_failure(msg["message_type"], max_retries, last_error)


def _notify_failure(message_type: str, attempts: int, error: str) -> None:
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"⚠️ *VibeBot delivery failed*\n"
                    f"*Type:* {message_type}\n"
                    f"*After {attempts} attempt(s)*\n"
                    f"*Error:* `{error}`"
                ),
            },
        }
    ]
    try:
        SlackSender().send(blocks)
    except Exception:
        log.error("Could not send failure notification to Slack.")
