import os
from langchain_core.language_models.chat_models import BaseChatModel


def get_llm(provider: str, model: str) -> BaseChatModel:
    """
    Return a configured LangChain chat model based on provider and model name.

    Supported providers:
        - "anthropic": uses langchain_anthropic.ChatAnthropic
        - "openai":    uses langchain_openai.ChatOpenAI
        - "ollama":    uses langchain_ollama.ChatOllama (local, no API key required)

    To add a new provider, add a new branch below and install the
    corresponding langchain integration package.

    Args:
        provider: LLM provider name (e.g. "anthropic", "openai")
        model:    Model identifier (e.g. "claude-sonnet-4-6", "gpt-4o")

    Returns:
        A LangChain BaseChatModel instance ready for inference.
    """
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise EnvironmentError("ANTHROPIC_API_KEY is not set in the environment.")
        return ChatAnthropic(model=model, api_key=api_key)

    elif provider == "openai":
        from langchain_openai import ChatOpenAI
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise EnvironmentError("OPENAI_API_KEY is not set in the environment.")
        return ChatOpenAI(model=model, api_key=api_key)

    elif provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(model=model)

    else:
        raise ValueError(
            f"Unsupported LLM provider: '{provider}'. "
            "Supported providers: 'anthropic', 'openai', 'ollama'."
        )
