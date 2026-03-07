"""
VibeBot — main entry point.

Loads enabled plugins from config.yaml and runs the 3-stage pipeline:
  Stage 1 — Collect:  fetch raw data and store in the database
  Stage 2 — Build:    summarize with LLM and build Slack blocks
  Stage 3 — Deliver:  send queued messages with retry and failure notification

Usage:
    python3 -m vibebot.main

Scheduling (Mac mini — launchd):
    See com.vibebot.plist in the repo root.
"""

import logging
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv

from vibebot.workers.run_pipeline import run_pipeline

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def load_config(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env")

    config_path = repo_root / "config.yaml"
    if not config_path.exists():
        log.error("config.yaml not found at %s", config_path)
        sys.exit(1)

    config = load_config(config_path)
    run_pipeline(config)
    log.info("VibeBot pipeline complete.")


if __name__ == "__main__":
    main()
