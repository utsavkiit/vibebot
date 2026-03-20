# VibeBot — AI Assistant Guide

Daily Slack digest bot. 3-stage pipeline: **Collect → Build → Deliver**.

---

## Run

```bash
python3 -m vibebot.main
```

Scheduled via launchd (`com.vibebot.plist`) on Mac mini, daily at 9 AM.

---

## Stack

- **Language:** Python (primary) + TypeScript (parallel rewrite in `src/`)
- **LLM:** LangChain (supports Anthropic, OpenAI, Ollama)
- **Database:** SQLite (`vibebot.db`)
- **Delivery:** Slack Incoming Webhooks (Block Kit)
- **News:** Tavily Search API
- **Config:** `config.yaml` / `.env`

---

## Repository Structure

```
vibebot/
├── vibebot/                    # Python source (primary)
│   ├── main.py                 # Entry point: loads config, calls run_pipeline()
│   ├── core/
│   │   ├── base_plugin.py      # Abstract BasePlugin (collect + build_digest)
│   │   ├── db.py               # SQLite schema, CRUD helpers, status management
│   │   ├── llm_factory.py      # get_llm(provider, model) → LangChain BaseChatModel
│   │   ├── message_utils.py    # Slack Block Kit builders (header, footer)
│   │   └── slack_sender.py     # SlackSender.send(blocks) → POST to webhook
│   ├── plugins/
│   │   ├── news/               # ACTIVE: fetches Reuters/BBC/AP via Tavily
│   │   │   ├── __init__.py     # NewsPlugin: collect() + build_digest()
│   │   │   ├── fetcher.py      # fetch_top_articles(count) via TavilySearch
│   │   │   ├── summarizer.py   # summarize_article(llm, title, desc) → (headline, summary, emoji)
│   │   │   └── og_image.py     # fetch_og_image(url) → Open Graph thumbnail
│   │   ├── stocks/             # STUB: placeholder, not yet implemented
│   │   └── real_estate/        # STUB: placeholder, not yet implemented
│   └── workers/
│       ├── run_pipeline.py     # Orchestrates all 3 stages, loads plugins from config
│       ├── collector.py        # Stage 1: calls plugin.collect(conn)
│       ├── digest_builder.py   # Stage 2: calls plugin.build_digest(conn, llm)
│       └── delivery_worker.py  # Stage 3: sends pending messages, exponential backoff retry
│
├── src/                        # TypeScript rewrite (mirrors vibebot/ structure)
│   ├── main.ts
│   ├── core/                   # basePlugin.ts, db.ts, llmFactory.ts, etc.
│   ├── plugins/news/
│   └── workers/
│
├── tests/                      # pytest (Python) + Vitest (TypeScript)
│   ├── conftest.py             # pytest fixture: fresh SQLite DB per test
│   └── test_*.py               # 8 Python test files (~1053 lines total)
│
├── docs/
│   ├── architecture.md         # Pipeline overview and full file map
│   ├── plugins.md              # How to add a new plugin (3 steps)
│   ├── config.md               # config.yaml + .env reference
│   └── typescript-rewrite-assessment.md
│
├── scripts/
│   └── test_slack_send.py      # Smoke test: sends real Slack message with mocked data
│
├── config.yaml                 # LLM provider/model, plugin toggles, delivery settings
├── .env.example                # Required secrets template
├── requirements.txt            # Python deps (LangChain ecosystem + utilities)
├── package.json                # Node.js deps (TypeScript version)
├── com.vibebot.plist           # macOS launchd scheduler (daily 9 AM)
└── setup.sh                    # One-time Mac mini setup script
```

---

## Pipeline Architecture

### Stage 1 — Collect (`workers/collector.py`)
- Calls `plugin.collect(conn)` for each enabled plugin
- Plugins insert raw fetched data into the `raw_items` SQLite table
- Deduplication is enforced via a `(source_type, external_id)` unique constraint

### Stage 2 — Build (`workers/digest_builder.py`)
- Calls `plugin.build_digest(conn, llm)` for each plugin
- Reads pending items from `raw_items`, summarizes with LLM
- Stores Slack Block Kit JSON in `outbound_messages` table

### Stage 3 — Deliver (`workers/delivery_worker.py`)
- Reads all pending messages from `outbound_messages`
- POSTs to Slack webhook via `SlackSender`
- Retry with exponential backoff: `wait = 2^attempt` seconds, up to `max_retries` (default: 3)
- Marks messages `sent`, `pending` (retry), or `failed`
- On total failure, sends a failure notification to Slack

---

## Database Schema

Two tables in `vibebot.db`:

**`raw_items`**
- `id`, `source_type`, `external_id` (dedup key), `payload` (JSON), `collected_at`, `status` (pending/processed)

**`outbound_messages`**
- `id`, `channel`, `message_type`, `payload` (JSON Block Kit), `status` (pending/sent/failed), `retry_count`, `max_retries`, `created_at`, `sent_at`, `last_error`

---

## Plugin System

All plugins inherit from `BasePlugin` in `core/base_plugin.py`:

```python
class BasePlugin(ABC):
    name: str = "base"

    @abstractmethod
    def collect(self, conn) -> int:
        """Fetch raw data, store in raw_items. Return count of new items."""

    @abstractmethod
    def build_digest(self, conn, llm) -> Optional[int]:
        """Build Slack message, store in outbound_messages. Return message id or None."""
```

**To add a new plugin:**
1. Create `vibebot/plugins/<name>/__init__.py` implementing `BasePlugin`
2. Add its config block to `config.yaml`
3. Register it in `workers/run_pipeline.py` (the `if name == "..."` block)

See `docs/plugins.md` for full details.

---

## Configuration

**`config.yaml`**
```yaml
llm:
  provider: ollama        # anthropic | openai | ollama
  model: qwen3:8b

plugins:
  news:
    enabled: true
    article_count: 5

delivery:
  max_retries: 3
  retry_backoff_base: 2
```

**`.env`** (copy from `.env.example`)
```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...       # optional
TAVILY_API_KEY=...       # required for news plugin
SLACK_WEBHOOK_URL=...
```

---

## LLM Providers

| Provider | Key env var | Notes |
|---|---|---|
| `ollama` | none | Local; default model `qwen3:8b` |
| `anthropic` | `ANTHROPIC_API_KEY` | Claude models |
| `openai` | `OPENAI_API_KEY` | GPT models |

Switch providers in `config.yaml` under `llm.provider`.

---

## Development Workflows

### Python Tests
```bash
pip install -r requirements.txt
pytest tests/
```

### TypeScript Tests
```bash
npm install
npm test          # Vitest
npm run build     # tsc → dist/
npm run dev       # ts-node
```

### Smoke Test (real Slack send)
```bash
python3 scripts/test_slack_send.py
```

### launchd (macOS scheduling)
```bash
launchctl start com.vibebot.daily       # Run immediately
launchctl stop com.vibebot.daily
tail -f ~/Library/Logs/vibebot.log      # View logs
```

---

## Key Conventions

- **No global state.** Config and DB connection are passed explicitly through the pipeline.
- **Deduplication by external_id.** Always set a stable `external_id` (e.g., URL hash) in `collect()` to avoid re-fetching.
- **Plugins are stateless.** All persistence goes through `conn` (SQLite). Plugins don't hold state between runs.
- **Delivery is generic.** The delivery worker doesn't know about plugins — it just sends whatever is in `outbound_messages`. Only Stages 1–2 are plugin-specific.
- **LLM output parsing.** The summarizer uses regex to extract `HEADLINE:`, `SUMMARY:`, `EMOJI:` fields from LLM output. Be defensive when changing prompt format.
- **Slack Block Kit.** Messages are built as Block Kit JSON arrays. Use helpers in `core/message_utils.py` for headers/footers.
- **TypeScript parity.** The `src/` directory is a parallel TypeScript rewrite. Changes to Python logic may need mirroring in TypeScript equivalents.

---

## Docs (read when needed)

- Architecture & file map: `docs/architecture.md`
- Adding a new plugin: `docs/plugins.md`
- Config & env vars reference: `docs/config.md`
- TypeScript rewrite notes: `docs/typescript-rewrite-assessment.md`
