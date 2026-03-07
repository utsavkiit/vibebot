"""
VibeBot — main entry point.

Loads enabled plugins from config.yaml, runs each one to collect Slack
Block Kit blocks, prepends a VibeBot header, and sends a single combined
message to Slack via the configured Incoming Webhook.

Usage:
    python vibebot/main.py

Scheduling (Mac mini — launchd):
    See com.vibebot.plist in the repo root.
"""

import logging
import os
import sys
from datetime import date, datetime
from pathlib import Path

import yaml
from dotenv import load_dotenv

from vibebot.core.llm_factory import get_llm
from vibebot.core.slack_sender import SlackSender

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Plugin registry
# Map config key → (import path, class name, extra constructor kwargs factory)
# To register a new plugin add an entry here.
# ---------------------------------------------------------------------------
PLUGIN_REGISTRY: dict[str, dict] = {
    "news": {
        "module": "vibebot.plugins.news",
        "class": "NewsPlugin",
        "extra_kwargs": lambda cfg, llm: {
            "llm": llm,
            "article_count": cfg.get("article_count", 5),
        },
        "needs_llm": True,
    },
    # Future plugins — add entries here as you implement them:
    # "stocks": {
    #     "module": "vibebot.plugins.stocks",
    #     "class": "StocksPlugin",
    #     "extra_kwargs": lambda cfg, llm: {"llm": llm, ...},
    #     "needs_llm": True,
    # },
    # "real_estate": {
    #     "module": "vibebot.plugins.real_estate",
    #     "class": "RealEstatePlugin",
    #     "extra_kwargs": lambda cfg, llm: {...},
    #     "needs_llm": False,
    # },
}


def load_config(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def build_header() -> list[dict]:
    today = date.today().strftime("%A, %B %-d, %Y")
    now = datetime.now().strftime("%-I:%M %p")
    return [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🤖 VibeBot Daily Digest — {today}",
                "emoji": True,
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"Your AI-curated morning briefing  ·  Sent at {now}",
                }
            ],
        },
    ]


def main() -> None:
    # Load env vars from .env (no-op if already set in environment)
    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env")

    config_path = repo_root / "config.yaml"
    if not config_path.exists():
        log.error("config.yaml not found at %s", config_path)
        sys.exit(1)

    config = load_config(config_path)
    plugins_cfg: dict = config.get("plugins", {})
    llm_cfg: dict = config.get("llm", {})

    # Build LLM once (shared across all plugins that need it)
    llm = None
    needs_llm = any(
        plugins_cfg.get(name, {}).get("enabled") and PLUGIN_REGISTRY.get(name, {}).get("needs_llm")
        for name in plugins_cfg
    )
    if needs_llm:
        provider = llm_cfg.get("provider", "anthropic")
        model = llm_cfg.get("model", "claude-sonnet-4-6")
        log.info("Initialising LLM: provider=%s model=%s", provider, model)
        llm = get_llm(provider=provider, model=model)

    # Collect blocks from each enabled plugin
    all_blocks: list[dict] = build_header()
    enabled_count = 0

    for plugin_name, plugin_cfg in plugins_cfg.items():
        if not plugin_cfg.get("enabled", False):
            log.info("Plugin '%s' is disabled — skipping.", plugin_name)
            continue

        registry_entry = PLUGIN_REGISTRY.get(plugin_name)
        if not registry_entry:
            log.warning("Plugin '%s' is enabled in config but not registered in PLUGIN_REGISTRY.", plugin_name)
            continue

        log.info("Running plugin: %s", plugin_name)
        try:
            import importlib
            module = importlib.import_module(registry_entry["module"])
            cls = getattr(module, registry_entry["class"])
            kwargs = registry_entry["extra_kwargs"](plugin_cfg, llm)
            plugin = cls(**kwargs)
            blocks = plugin.get_blocks()
            all_blocks.extend(blocks)
            enabled_count += 1
            log.info("Plugin '%s' returned %d block(s).", plugin_name, len(blocks))
        except Exception:
            log.exception("Plugin '%s' failed — skipping.", plugin_name)

    if enabled_count == 0:
        log.warning("No plugins produced output. Nothing to send.")
        return

    # Footer
    all_blocks.append({"type": "divider"})
    all_blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": "🤖 _Powered by VibeBot_"}],
    })

    # Send to Slack
    log.info("Sending digest to Slack (%d total blocks).", len(all_blocks))
    sender = SlackSender()
    sender.send(all_blocks)
    log.info("Done. VibeBot digest delivered successfully.")


if __name__ == "__main__":
    main()
