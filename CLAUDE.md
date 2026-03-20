# VibeBot — AI Assistant Guide

Daily Slack digest bot. 3-stage pipeline: **Collect → Build → Deliver**.

---

## Run

```bash
npm run dev       # ts-node (development)
npm run build     # tsc → dist/
node dist/main.js # production
```

Scheduled via launchd (`com.vibebot.plist`) on Mac mini, daily at 9 AM.

---

## Stack

- **Language:** TypeScript (Node.js)
- **LLM:** LangChain.js (supports Anthropic, OpenAI, Ollama)
- **Database:** SQLite (`vibebot.db`) via `better-sqlite3`
- **Delivery:** Slack Incoming Webhooks (Block Kit)
- **News:** Tavily Search API
- **Config:** `config.yaml` / `.env`

---

## Repository Structure

```
vibebot/
├── src/                        # TypeScript source
│   ├── main.ts                 # Entry point: loads config, calls runPipeline()
│   ├── core/
│   │   ├── basePlugin.ts       # Abstract BasePlugin (collect + buildDigest)
│   │   ├── db.ts               # SQLite schema, CRUD helpers, status management
│   │   ├── llmFactory.ts       # getLlm(provider, model) → LangChain BaseChatModel
│   │   ├── messageUtils.ts     # Slack Block Kit builders (header, footer)
│   │   └── slackSender.ts      # SlackSender.send(blocks) → POST to webhook
│   ├── plugins/
│   │   ├── news/               # ACTIVE: fetches Reuters/BBC/AP via Tavily
│   │   │   ├── index.ts        # NewsPlugin: collect() + buildDigest()
│   │   │   ├── fetcher.ts      # fetchTopArticles(count) via TavilySearch
│   │   │   ├── summarizer.ts   # summarizeArticle(llm, title, desc) → (headline, summary, emoji)
│   │   │   └── ogImage.ts      # fetchOgImage(url) → Open Graph thumbnail
│   │   ├── stocks/             # STUB: placeholder, not yet implemented
│   │   └── realEstate/         # STUB: placeholder, not yet implemented
│   └── workers/
│       ├── runPipeline.ts      # Orchestrates all 3 stages, loads plugins from config
│       ├── collector.ts        # Stage 1: calls plugin.collect(conn)
│       ├── digestBuilder.ts    # Stage 2: calls plugin.buildDigest(conn, llm)
│       └── deliveryWorker.ts   # Stage 3: sends pending messages, exponential backoff retry
│
├── tests/                      # Vitest test suite
│   ├── db.test.ts
│   ├── newsPlugin.test.ts
│   ├── newsFetcher.test.ts
│   ├── newsSummarizer.test.ts
│   ├── slackSender.test.ts
│   ├── deliveryWorker.test.ts
│   └── main.test.ts
│
├── docs/
│   ├── architecture.md         # Pipeline overview and full file map
│   ├── plugins.md              # How to add a new plugin (3 steps)
│   ├── config.md               # config.yaml + .env reference
│   └── typescript-rewrite-assessment.md
│
├── config.yaml                 # LLM provider/model, plugin toggles, delivery settings
├── .env.example                # Required secrets template
├── package.json                # Node.js dependencies
├── tsconfig.json               # TypeScript compiler config
├── vitest.config.ts            # Vitest test runner config
├── com.vibebot.plist           # macOS launchd scheduler (daily 9 AM)
└── setup.sh                    # One-time Mac mini setup script
```

---

## Pipeline Architecture

### Stage 1 — Collect (`workers/collector.ts`)
- Calls `plugin.collect(conn)` for each enabled plugin
- Plugins insert raw fetched data into the `raw_items` SQLite table
- Deduplication is enforced via a `(source_type, external_id)` unique constraint

### Stage 2 — Build (`workers/digestBuilder.ts`)
- Calls `plugin.buildDigest(conn, llm)` for each plugin
- Reads pending items from `raw_items`, summarizes with LLM
- Stores Slack Block Kit JSON in `outbound_messages` table

### Stage 3 — Deliver (`workers/deliveryWorker.ts`)
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

All plugins inherit from `BasePlugin` in `core/basePlugin.ts`:

```typescript
abstract class BasePlugin {
  abstract name: string;

  abstract collect(conn: Database): Promise<number>;
  // Fetch raw data, store in raw_items. Return count of new items.

  abstract buildDigest(conn: Database, llm: BaseChatModel): Promise<number | null>;
  // Build Slack message, store in outbound_messages. Return message id or null.
}
```

**To add a new plugin:**
1. Create `src/plugins/<name>/index.ts` implementing `BasePlugin`
2. Add its config block to `config.yaml`
3. Register it in `src/workers/runPipeline.ts` (the `if (name === "...")` block)

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

### Tests
```bash
npm install
npm test          # Vitest
```

### Build & Run
```bash
npm run build     # tsc → dist/
npm run dev       # ts-node (development)
node dist/main.js # production
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
- **Slack Block Kit.** Messages are built as Block Kit JSON arrays. Use helpers in `core/messageUtils.ts` for headers/footers.

---

## Docs (read when needed)

- Architecture & file map: `docs/architecture.md`
- Adding a new plugin: `docs/plugins.md`
- Config & env vars reference: `docs/config.md`
