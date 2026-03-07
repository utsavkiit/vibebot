"""
Stocks plugin — coming soon.

This plugin will fetch stock performance data (e.g. from Yahoo Finance or
Alpha Vantage) and return a Slack digest showing gains/losses for a
configured watchlist.

To implement:
    1. Add your data-fetching logic in `fetcher.py`
    2. Optionally add LLM-based commentary in `summarizer.py`
    3. Subclass BasePlugin here and implement `get_blocks()`
    4. Set `plugins.stocks.enabled: true` in config.yaml
    5. Add any required API keys to .env and .env.example
"""
