# Architecture

## Pipeline
`run_pipeline.py` orchestrates 3 stages in order:
1. **Collect** (`collector.py`) — plugins fetch raw data, store in SQLite
2. **Build** (`digest_builder.py`) — LLM summarizes, builds Slack Block Kit payloads
3. **Deliver** (`delivery_worker.py`) — sends queued messages with exponential backoff retry

## File Map
```
vibebot/
  main.py                  # Entry: loads config.yaml, calls run_pipeline
  core/
    llm_factory.py         # get_llm(provider, model) → LangChain BaseChatModel
    slack_sender.py        # SlackSender.send(blocks) via Incoming Webhook
    db.py                  # SQLite helpers
    base_plugin.py         # Plugin base class
    message_utils.py       # Block Kit block builders
  plugins/news/
    fetcher.py             # NewsAPI → list[dict] (title, description, url, source, published_at)
    summarizer.py          # LLM chain → (summary, why_it_matters) per article
    og_image.py            # Scrapes og:image / twitter:image from article URLs
  workers/
    collector.py
    digest_builder.py
    delivery_worker.py
    run_pipeline.py
```

## Tests
```
pytest
```
Test files mirror source structure under `tests/`.
