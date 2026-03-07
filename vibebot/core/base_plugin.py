from abc import ABC, abstractmethod
from typing import Optional


class BasePlugin(ABC):
    """
    Base class for all VibeBot plugins.

    Each plugin drives two stages of the pipeline:
      1. collect(conn)          — fetch raw data and store in the raw_items table
      2. build_digest(conn, llm) — read pending raw items, build a Slack Block Kit
                                   message, and store it in outbound_messages

    To create a new plugin:
        1. Subclass BasePlugin
        2. Set a unique `name` class attribute
        3. Implement `collect()` and `build_digest()`
        4. Add an entry in config.yaml under `plugins`
    """

    name: str = "base"

    @abstractmethod
    def collect(self, conn) -> int:
        """
        Fetch raw data from the source and store new items in raw_items.

        Returns:
            int: Number of new items inserted (0 if all were duplicates).
        """
        ...

    @abstractmethod
    def build_digest(self, conn, llm) -> Optional[int]:
        """
        Read pending raw_items for this plugin, build Slack blocks, and store
        the result as a pending outbound_message.

        Returns:
            int | None: The outbound_message id if a digest was built, else None.
        """
        ...
