import logging
from pathlib import Path

from vibebot.core.db import get_connection, init_db
from vibebot.core.llm_factory import get_llm
from vibebot.plugins.news import NewsPlugin
from vibebot.workers import collector, digest_builder, delivery_worker

log = logging.getLogger(__name__)

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "vibebot.db"


def run_pipeline(config: dict) -> None:
    plugins_cfg: dict = config.get("plugins", {})
    llm_cfg: dict = config.get("llm", {})
    delivery_cfg: dict = config.get("delivery", {})
    max_retries: int = delivery_cfg.get("max_retries", 3)

    init_db(_DB_PATH)
    conn = get_connection(_DB_PATH)

    # Instantiate enabled plugins
    plugins = []
    for name, cfg in plugins_cfg.items():
        if not cfg.get("enabled", False):
            log.info("Plugin '%s' is disabled — skipping.", name)
            continue
        if name == "news":
            plugins.append(NewsPlugin(article_count=cfg.get("article_count", 5)))
        else:
            log.warning("Plugin '%s' is enabled but not registered — skipping.", name)

    if not plugins:
        log.warning("No plugins enabled — nothing to run.")
        return

    llm = get_llm(
        provider=llm_cfg.get("provider", "anthropic"),
        model=llm_cfg.get("model", "claude-haiku-4-5-20251001"),
    )

    log.info("Stage 1: Collecting raw data.")
    collector.run(plugins, conn)

    log.info("Stage 2: Building digests.")
    digest_builder.run(plugins, conn, llm)

    log.info("Stage 3: Delivering messages (max_retries=%d).", max_retries)
    delivery_worker.run(conn)
