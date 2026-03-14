# Plugins

## Existing
- `news` — enabled. NewsAPI headlines → LLM summary → rich Slack cards with thumbnails.
- `f1` — enabled. Daemon-based; run via `python -m vibebot.workers.f1_agent`. Sends Slack notifications before and after each F1 race weekend session (practice, qualifying, sprint, race) via `F1_SLACK_WEBHOOK_URL`. Calendar and session times from OpenF1 API; results from Jolpica-F1 API. Year hardcoded to 2026. Scheduled unattended via launchd `com.vibebot.f1.plist` (KeepAlive).
- `stocks` — stub, disabled.
- `real_estate` — stub, disabled.

## Adding a Plugin
1. Create `vibebot/plugins/<name>/` with an `__init__.py` implementing `BasePlugin`.
2. Enable it in `config.yaml` under `plugins.<name>.enabled: true`.
3. The collector stage will pick it up automatically.
