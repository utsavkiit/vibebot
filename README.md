# VibeBot 🤖

An extensible personal AI agent that runs on your Mac mini and delivers beautifully formatted daily digests to Slack. Powered by [LangChain](https://langchain.com) with a swappable LLM backend (Claude, OpenAI, and more).

**First plugin: World News** — fetches the top 5 headlines via NewsAPI.org and summarizes each one with AI in 2–3 readable sentences, complete with source links.

Built to grow: adding new capabilities (stocks, real estate, weather, etc.) requires no changes to core — just drop in a new plugin.

---

## Example Slack Output

```
🤖 VibeBot Daily Digest — Saturday, March 7, 2026
────────────────────────────────────────────────────

📰 World News — Saturday, March 7, 2026

1. Ukraine and Russia hold first peace talks in years
   Delegations from both countries met in Istanbul for the first
   direct negotiations since 2022. Talks focused on a ceasefire
   framework, with no agreement reached on the first day.
   Source: Reuters · Read full article

────────────────────────────────────────────────────

2. Global markets rally on US jobs data
   ...
```

---

## Features

- **Plugin architecture** — each capability is a self-contained module; enable/disable in `config.yaml`
- **Configurable LLM** — swap between Anthropic Claude, OpenAI GPT, or any LangChain-supported model via a single config line
- **Slack Block Kit formatting** — rich, readable messages with bold titles, summaries, source names, and article links
- **Mac mini scheduling** — ships with a `launchd` plist that runs the digest daily at 9:00 AM (survives sleep/wake, unlike cron)
- **One-command setup** — `bash setup.sh` handles dependencies, `.env` scaffolding, and launchd registration

---

## Project Structure

```
NewsBot/
├── vibebot/
│   ├── core/
│   │   ├── base_plugin.py      # Abstract BasePlugin interface
│   │   ├── llm_factory.py      # LangChain LLM factory (provider-agnostic)
│   │   └── slack_sender.py     # Slack Incoming Webhook delivery
│   ├── plugins/
│   │   ├── news/               # World news: NewsAPI.org + LLM summarizer
│   │   │   ├── fetcher.py
│   │   │   ├── summarizer.py
│   │   │   └── __init__.py     # NewsPlugin (BasePlugin subclass)
│   │   ├── stocks/             # Stub — ready to implement
│   │   └── real_estate/        # Stub — ready to implement
│   └── main.py                 # Orchestrator: loads plugins → sends to Slack
├── config.yaml                 # Plugin toggles + LLM provider/model settings
├── requirements.txt
├── .env.example                # Template for required secrets
├── setup.sh                    # One-time Mac mini setup script
└── com.vibebot.plist           # launchd agent (9:00 AM daily)
```

---

## Prerequisites

- Python 3.11+
- A [Slack Incoming Webhook URL](https://api.slack.com/messaging/webhooks)
- An [Anthropic API key](https://console.anthropic.com) *(or OpenAI key if switching providers)*
- A [NewsAPI.org key](https://newsapi.org/register) *(free tier: 100 req/day)*

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/utsavkiit/NewsBot.git
cd NewsBot
```

### 2. Run the setup script

```bash
bash setup.sh
```

This will:
1. Install Python dependencies (`pip install -r requirements.txt`)
2. Create `.env` from `.env.example` and prompt you to fill in your keys
3. Register the launchd agent at `~/Library/LaunchAgents/com.vibebot.plist`

### 3. Fill in your `.env`

```env
ANTHROPIC_API_KEY=sk-ant-...
NEWS_API_KEY=your_newsapi_key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### 4. Test it

```bash
python3 vibebot/main.py
```

You should see the digest appear in your Slack channel immediately.

---

## Configuration

All settings live in `config.yaml`:

```yaml
llm:
  provider: anthropic          # Options: anthropic, openai
  model: claude-sonnet-4-6     # Any model supported by the provider

plugins:
  news:
    enabled: true
    article_count: 5           # How many headlines to include
  stocks:
    enabled: false
  real_estate:
    enabled: false
```

### Switching LLM providers

Change `provider` and `model`, then set the corresponding key in `.env`:

| Provider    | `provider` value | Model example        | Env var           |
|-------------|------------------|----------------------|-------------------|
| Anthropic   | `anthropic`      | `claude-sonnet-4-6`  | `ANTHROPIC_API_KEY` |
| OpenAI      | `openai`         | `gpt-4o`             | `OPENAI_API_KEY`  |

---

## Scheduling (Mac mini)

The setup script registers a `launchd` agent that runs VibeBot every day at **9:00 AM**.

```bash
# Trigger immediately (for testing)
launchctl start com.vibebot.daily

# View logs
tail -f ~/Library/Logs/vibebot.log

# Disable the schedule
launchctl unload ~/Library/LaunchAgents/com.vibebot.plist

# Re-enable
launchctl load ~/Library/LaunchAgents/com.vibebot.plist
```

> **Why launchd over cron?** launchd catches up on missed runs after the machine wakes from sleep, so you won't miss a day if your Mac was asleep at 9 AM.

---

## Adding a New Plugin

1. **Create your plugin directory:**
   ```
   vibebot/plugins/my_plugin/__init__.py
   ```

2. **Implement `BasePlugin`:**
   ```python
   from vibebot.core.base_plugin import BasePlugin

   class MyPlugin(BasePlugin):
       name = "my_plugin"

       def __init__(self, llm, ...):
           self.llm = llm

       def get_blocks(self) -> list[dict]:
           # Fetch data, build Block Kit blocks, return them
           return [...]
   ```

3. **Register it in `vibebot/main.py`** under `PLUGIN_REGISTRY`.

4. **Enable it in `config.yaml`:**
   ```yaml
   plugins:
     my_plugin:
       enabled: true
   ```

5. Add any new API keys to `.env` and `.env.example`.

No changes to core or the orchestrator are needed.

---

## Planned Plugins

| Plugin         | Description                                      | Status     |
|----------------|--------------------------------------------------|------------|
| `news`         | Top 5 world headlines, AI-summarized             | ✅ Live    |
| `stocks`       | Daily performance of a custom watchlist          | 🔜 Planned |
| `real_estate`  | New home listings matching saved search criteria | 🔜 Planned |

---

## License

MIT
