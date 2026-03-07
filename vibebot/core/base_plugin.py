from abc import ABC, abstractmethod


class BasePlugin(ABC):
    """
    Base class for all VibeBot plugins.

    Each plugin is responsible for fetching/processing data and returning
    a list of Slack Block Kit blocks to be included in the daily digest.

    To create a new plugin:
        1. Subclass BasePlugin
        2. Set a unique `name` class attribute
        3. Implement `get_blocks()` returning a list of Block Kit dicts
        4. Register it in config.yaml under `plugins`
    """

    name: str = "base"

    @abstractmethod
    def get_blocks(self) -> list[dict]:
        """
        Fetch and process data, then return Slack Block Kit blocks.

        Returns:
            list[dict]: A list of Slack Block Kit block objects.
        """
        ...
