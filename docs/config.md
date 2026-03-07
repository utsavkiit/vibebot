# Config & Env Vars

## config.yaml
```yaml
llm:
  provider: anthropic   # or openai
  model: claude-haiku-4-5-20251001

plugins:
  news:
    enabled: true
    article_count: 5

delivery:
  max_retries: 3
  retry_backoff_base: 2   # wait = base^attempt seconds
```

## .env (never commit)
```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...       # only if provider=openai
NEWS_API_KEY=...         # newsapi.org free tier, 100 req/day
SLACK_WEBHOOK_URL=...    # Slack app → Incoming Webhooks
```
