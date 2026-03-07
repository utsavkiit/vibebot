from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser


_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are a concise news editor. Summarize news articles in 2-3 clear, "
        "engaging sentences for a general audience. Be informative and neutral.",
    ),
    (
        "human",
        "Article title: {title}\n\nArticle description: {description}\n\n"
        "Write a 2-3 sentence summary:",
    ),
])


def summarize_article(llm: BaseChatModel, title: str, description: str) -> str:
    """
    Summarize a single news article using the provided LangChain LLM.

    Args:
        llm:         A configured LangChain BaseChatModel instance.
        title:       The article headline.
        description: The article description or lead paragraph.

    Returns:
        A 2-3 sentence plain-text summary.
    """
    chain = _PROMPT | llm | StrOutputParser()
    return chain.invoke({"title": title, "description": description}).strip()
