# VibeBot

Daily Slack digest bot. 3-stage pipeline: Collect → Build → Deliver.

## Run
```
python3 -m vibebot.main
```
Scheduled via launchd (`com.vibebot.plist`) on Mac mini, daily at 9 AM.

## Stack
Python, LangChain, SQLite, Slack Incoming Webhooks.
Config: `config.yaml`. Secrets: `.env`.

## Docs (read when needed)
- Architecture & file map: `docs/architecture.md`
- Adding a new plugin: `docs/plugins.md`
- Config & env vars reference: `docs/config.md`
