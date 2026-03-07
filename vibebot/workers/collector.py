import logging

log = logging.getLogger(__name__)


def run(plugins: list, conn) -> None:
    """Stage 1: Call collect() on each enabled plugin."""
    for plugin in plugins:
        count = plugin.collect(conn)
        log.info("Plugin '%s' collected %d new item(s).", plugin.name, count)
