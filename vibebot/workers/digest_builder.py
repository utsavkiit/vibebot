import logging

log = logging.getLogger(__name__)


def run(plugins: list, conn, llm) -> None:
    """Stage 2: Call build_digest() on each enabled plugin."""
    for plugin in plugins:
        msg_id = plugin.build_digest(conn, llm)
        if msg_id is not None:
            log.info(
                "Plugin '%s' built digest → outbound_message id=%d.",
                plugin.name,
                msg_id,
            )
        else:
            log.info("Plugin '%s': no new items to digest.", plugin.name)
