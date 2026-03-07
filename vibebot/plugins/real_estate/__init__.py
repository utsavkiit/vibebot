"""
Real estate plugin — coming soon.

This plugin will search for home listings matching configured criteria
(location, price range, bedrooms, etc.) and surface the top matches
as a Slack digest with links to the listings.

To implement:
    1. Add your listing-search logic in `fetcher.py` (e.g. Zillow API, Realtor.com)
    2. Optionally add LLM-based commentary in `summarizer.py`
    3. Subclass BasePlugin here and implement `get_blocks()`
    4. Set `plugins.real_estate.enabled: true` in config.yaml
    5. Add any required API keys to .env and .env.example
"""
