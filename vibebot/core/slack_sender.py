import os
import json
import requests


class SlackSender:
    """
    Sends Block Kit messages to a Slack channel via an Incoming Webhook.

    Setup:
        1. Go to https://api.slack.com/apps and create (or select) an app.
        2. Enable "Incoming Webhooks" and add a webhook to your workspace.
        3. Copy the webhook URL into your .env as SLACK_WEBHOOK_URL.
    """

    def __init__(self) -> None:
        self.webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
        if not self.webhook_url:
            raise EnvironmentError("SLACK_WEBHOOK_URL is not set in the environment.")

    def send(self, blocks: list[dict]) -> None:
        """
        POST a list of Block Kit blocks to the configured Slack webhook.

        Args:
            blocks: List of Slack Block Kit block dicts.

        Raises:
            RuntimeError: If Slack returns a non-200 response.
        """
        payload = {"blocks": blocks}
        response = requests.post(
            self.webhook_url,
            data=json.dumps(payload),
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"Slack webhook returned {response.status_code}: {response.text}"
            )
