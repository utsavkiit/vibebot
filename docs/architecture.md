# VibeBot Architecture

## Overview

VibeBot is a daily Slack digest bot with a 3-stage pipeline: **Collect → Build → Deliver**.
A 4th pipeline (podcast) runs at 12:30 PM, aggregating all topic digests into a spoken audio briefing.

---

## Daily Schedule

```
7:00 AM  → us_news      (collect + build + deliver)
8:00 AM  → world_news   (collect + build + deliver)
9:00 AM  → india_news   (collect + build + deliver)
10:00 AM → sports       (collect + build + deliver)
11:00 AM → tech_news    (collect + build + deliver)
12:00 PM → stocks_news  (collect + build + deliver)
12:30 PM → podcast      (aggregate + script + TTS + deliver)
```

Each job is a separate launchd agent running `node dist/main.js --plugin <name>`.

---

## Core Pipeline (per topic plugin)

```
Google News RSS
      │
      ▼
 [Stage 1: Collect]
 GNewsTopicPlugin.collect()
  - Fetch 50 headlines from RSS feed
  - Embed each headline (Ollama nomic-embed-text)
  - Insert into raw_items (SQLite) — deduplicated by URL hash
      │
      ▼
 [Stage 2: Build]
 GNewsTopicPlugin.buildDigest()
  - Read pending raw_items
  - Cluster by semantic similarity (cosine distance)
  - Pick top N clusters (story_count)
  - LLM summarizes each cluster → (headline, summary, emoji)  [Ollama qwen3:8b]
  - Build Slack Block Kit JSON
  - Insert into outbound_messages (SQLite)
      │
      ▼
 [Stage 3: Deliver]
 deliveryWorker.run()
  - Read pending outbound_messages
  - POST to Slack Incoming Webhook
  - Retry with exponential backoff (2^attempt seconds, max 3 retries)
  - Mark message sent / failed
```

---

## Podcast Pipeline

Runs at 12:30 PM after all 6 topic digests have been delivered.

```
SQLite outbound_messages (today's 6 topic digests)
      │
      ▼
 [Stage 1: Collect]
 PodcastPlugin.collect()
  - Query today's *_digest rows from outbound_messages
  - Strip Slack Block Kit JSON → plain text (blockExtractor.ts)
  - Bundle all 6 sections into one raw_items record
  - Deduplicated by date — one podcast per day
      │
      ▼
 [Stage 2: Build]
 PodcastPlugin.buildDigest()
  - Read pending raw_items
  - Send all 6 sections to LLM with podcast scriptwriter prompt
  - LLM outputs a flowing ~700-word spoken script   [Ollama qwen3:8b]
  - POST script to mlx-audio REST API (port 8080)
      │
      │   mlx-audio TTS pipeline (internal):
      │    text → [spaCy] → grammar/context tags
      │         → [misaki] → phonemes (/sæt.ər.deɪ/)
      │         → [Kokoro-82M-bf16] → raw WAV audio
      │         → [ffmpeg] → MP3
      │
  - Save MP3 to ~/VibeBot-Podcasts/YYYY-MM-DD.mp3
  - Build Slack Block Kit with clickable "Listen now" link
  - Insert into outbound_messages
      │
      ▼
 [Stage 3: Deliver]
 deliveryWorker.run()
  - POST Slack notification with Tailscale URL
  - Link: http://100.104.18.70:8888/YYYY-MM-DD.mp3
  - Accessible from iPhone via Tailscale VPN
```

---

## Local Services (always-on, managed by launchd)

| Service | Binary | Port | Purpose |
|---------|--------|------|---------|
| Ollama | `ollama serve` | 11434 | LLM inference (qwen3:8b, nomic-embed-text) |
| mlx-audio | `mlx_audio.server` | 8080 | Kokoro TTS — text → MP3 |
| podcast-server | `python3 -m http.server` | 8888 | Serves ~/VibeBot-Podcasts over HTTP |
| Tailscale | `tailscaled` | — | Private network — iPhone access to Mac mini |

---

## TTS Stack (inside mlx-audio)

```
Script text (English)
      │
      ▼
   spaCy                  — parses grammar, resolves word sense ambiguity
      │                     e.g. "read" (present) vs "read" (past)
      ▼
   misaki                 — converts words to phonemes
      │                     e.g. "Saturday" → /ˈsæt.ər.deɪ/
      ▼
   Kokoro-82M-bf16        — neural TTS model (Apple Silicon / MLX)
      │                     phonemes → raw WAV audio
      ▼
   ffmpeg                 — WAV → MP3 (10x size reduction, browser-streamable)
      │
      ▼
   ~/VibeBot-Podcasts/YYYY-MM-DD.mp3
```

---

## Database Schema

**`raw_items`**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| source_type | TEXT | Plugin name (e.g. `us_news`, `podcast`) |
| external_id | TEXT | Dedup key (URL hash or date hash) |
| payload | TEXT | JSON blob |
| collected_at | TIMESTAMP | |
| status | TEXT | `pending` / `processed` |

**`outbound_messages`**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| channel | TEXT | `slack_default` |
| message_type | TEXT | e.g. `us_news_digest`, `podcast_digest` |
| payload | TEXT | Slack Block Kit JSON array |
| status | TEXT | `pending` / `sent` / `failed` |
| retry_count | INTEGER | |
| max_retries | INTEGER | Default 3 |
| created_at | TIMESTAMP | |
| sent_at | TIMESTAMP | |
| last_error | TEXT | |

---

## File Map

```
src/
  main.ts                        # Entry point: parses --plugin flag, calls runPipeline()
  core/
    basePlugin.ts                # Abstract BasePlugin (collect + buildDigest)
    db.ts                        # SQLite schema, CRUD helpers
    llmFactory.ts                # getLlm(provider, model) → LangChain BaseChatModel
    messageUtils.ts              # Slack Block Kit builders (header, footer)
    slackSender.ts               # SlackSender.send(blocks) → POST to webhook
  plugins/
    gnewsTopic/index.ts          # GNewsTopicPlugin — us_news, world_news, india_news, tech_news, stocks_news
    gnewsSports/index.ts         # GNewsSportsPlugin — sports (F1, soccer, cricket, tennis)
    podcast/
      index.ts                   # PodcastPlugin — aggregates digests, drives TTS
      blockExtractor.ts          # Strips Slack Block Kit JSON → plain text
      scriptWriter.ts            # LLM prompt: news summaries → spoken podcast script
      ttsClient.ts               # fetch() wrapper for mlx-audio /v1/audio/speech
    gnews/
      rssParser.ts               # Fetches + parses Google News RSS
      embedder.ts                # Ollama embeddings (nomic-embed-text)
      clusterer.ts               # Cosine similarity clustering
      groupSummarizer.ts         # LLM: cluster → (headline, summary, emoji)
    news/                        # Legacy Tavily-based plugin (disabled)
  workers/
    runPipeline.ts               # Orchestrates all 3 stages, registers plugins
    collector.ts                 # Stage 1: calls plugin.collect(db)
    digestBuilder.ts             # Stage 2: calls plugin.buildDigest(db, llm)
    deliveryWorker.ts            # Stage 3: sends pending messages, retry + backoff

launchd/
  com.vibebot.us_news.plist      # 7:00 AM
  com.vibebot.world_news.plist   # 8:00 AM
  com.vibebot.india_news.plist   # 9:00 AM
  com.vibebot.sports.plist       # 10:00 AM
  com.vibebot.tech_news.plist    # 11:00 AM
  com.vibebot.stocks_news.plist  # 12:00 PM
  com.vibebot.podcast.plist      # 12:30 PM
  com.vibebot.mlx-audio.plist    # KeepAlive — Kokoro TTS server
  com.vibebot.podcast-server.plist # KeepAlive — MP3 HTTP server
```
