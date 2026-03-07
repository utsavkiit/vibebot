# VibeBot

An extensible AI-powered Slack digest bot. Every morning at 9 AM it fetches the top news headlines, summarizes each with an LLM, scrapes thumbnail images, and sends a polished card-based digest to a Slack channel.

---

## How it works

VibeBot runs a 3-stage pipeline on a schedule:

```
Stage 1 — Collect:  fetch raw articles → store in SQLite (raw_items)
Stage 2 — Build:    summarize with LLM, build Slack blocks → store in SQLite (outbound_messages)
Stage 3 — Deliver:  send queued messages to Slack, retry on failure, notify on max retries
```

Each stage is independent — if the LLM API is temporarily overloaded, the raw articles are already stored and the pipeline can retry. Failed deliveries are retried with exponential backoff.

---

## What it looks like in Slack

Each news card includes:
- **Headline + 1-line summary** with optional thumbnail image
- **Source and publish time**
- **"Why it matters"** — LLM-generated significance
- **Read →** button linking to the full article

---

## Project structure

```
vibebot/
  core/
    base_plugin.py      # Abstract BasePlugin interface (collect + build_digest)
    db.py               # SQLite schema and CRUD helpers (generic, not news-specific)
    llm_factory.py      # LangChain LLM factory (Anthropic or OpenAI)
    message_utils.py    # build_header() and build_footer() shared utilities
    slack_sender.py     # Slack Incoming Webhook client
  plugins/
    news/
      __init__.py       # NewsPlugin — collect() and build_digest()
      fetcher.py        # Fetches top headlines from NewsAPI.org
      summarizer.py     # LLM prompt: 1-line summary + why-it-matters
      og_image.py       # Scrapes og:image / twitter:image from article URLs
    stocks/             # Stub — ready to implement
    real_estate/        # Stub — ready to implement
  workers/
    collector.py        # Stage 1: calls plugin.collect() for each enabled plugin
    digest_builder.py   # Stage 2: calls plugin.build_digest() for each plugin
    delivery_worker.py  # Stage 3: sends pending messages, handles retry + notification
    run_pipeline.py     # Orchestrates all 3 stages
  main.py               # Entry point — loads config, calls run_pipeline()

config.yaml             # Plugin enable/disable, LLM provider/model, delivery settings
scripts/
  test_slack_send.py    # Smoke-test: sends a fake digest without LLM/API calls
tests/                  # pytest suite (39 tests)
com.vibebot.plist       # launchd agent — runs daily at 9 AM on macOS
```

---

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/utsavkiit/VibeBot.git
cd VibeBot
pip install -r requirements.txt
```

### 2. Create a `.env` file

```env
ANTHROPIC_API_KEY=sk-ant-...
NEWS_API_KEY=...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

- **ANTHROPIC_API_KEY** — get one at [console.anthropic.com](https://console.anthropic.com)
- **NEWS_API_KEY** — free tier (100 req/day) at [newsapi.org/register](https://newsapi.org/register)
- **SLACK_WEBHOOK_URL** — create an Incoming Webhook in your Slack workspace settings

### 3. Configure `config.yaml`

```yaml
llm:
  provider: anthropic          # or "openai"
  model: claude-haiku-4-5-20251001

plugins:
  news:
    enabled: true
    article_count: 5

delivery:
  max_retries: 3               # Attempts before marking failed and notifying
```

### 4. Test the Slack integration (no LLM or API calls)

```bash
python3 scripts/test_slack_send.py
```

### 5. Run end-to-end

```bash
python3 -m vibebot.main
```

---

## Scheduling on macOS (launchd)

A `com.vibebot.plist` is included that runs VibeBot daily at 9 AM.

```bash
cp com.vibebot.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vibebot.plist
```

**Useful commands:**

```bash
launchctl start com.vibebot.daily          # trigger immediately
tail -f ~/Library/Logs/vibebot.log         # watch logs
launchctl unload ~/Library/LaunchAgents/com.vibebot.plist  # disable
```

No restart needed after code changes — launchd spawns a fresh process each run.

---

## Running tests

```bash
python3 -m pytest tests/ -v
```

---

## Adding a new plugin

1. Create `vibebot/plugins/yourplugin/__init__.py` with a class extending `BasePlugin`
2. Implement `collect(conn)` — fetch data, store in `raw_items` via `db.insert_raw_item()`
3. Implement `build_digest(conn, llm)` — read pending items, build Slack blocks, store via `db.insert_outbound_message()`
4. Register the plugin in `vibebot/workers/run_pipeline.py`
5. Add an entry in `config.yaml` under `plugins:`

The delivery stage is fully generic — no changes needed there.

---

## LLM providers

| Provider | `provider` value | Key env var |
|---|---|---|
| Anthropic Claude | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |

---

## Planned plugins

| Plugin | Description | Status |
|---|---|---|
| `news` | Top headlines, AI-summarized with why-it-matters | ✅ Live |
| `stocks` | Daily performance of a custom watchlist | 🔜 Planned |
| `real_estate` | New listings matching saved search criteria | 🔜 Planned |
