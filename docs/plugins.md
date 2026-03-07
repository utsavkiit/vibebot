# Plugins

## Existing
- `news` — enabled. NewsAPI headlines → LLM summary → rich Slack cards with thumbnails.
- `stocks` — stub, disabled.
- `real_estate` — stub, disabled.

## Adding a Plugin
1. Create `vibebot/plugins/<name>/` with an `__init__.py` implementing `BasePlugin`.
2. Enable it in `config.yaml` under `plugins.<name>.enabled: true`.
3. The collector stage will pick it up automatically.
