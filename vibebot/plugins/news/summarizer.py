from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser


_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are a sharp news editor writing for a busy professional audience. "
        "Given a news article, write two things:\n"
        "1. HEADLINE: A punchy, newspaper-style headline. Max 8 words. "
        "Active voice. No fluff. Make it specific and intriguing — not generic.\n"
        "2. WHY: Exactly 1 sentence explaining the broader significance or impact.\n\n"
        "Respond in exactly this format (no extra text):\n"
        "HEADLINE: <8 words max>\n"
        "WHY: <sentence>",
    ),
    (
        "human",
        "Article title: {title}\n\nArticle description: {description}",
    ),
])


def summarize_article(llm: BaseChatModel, title: str, description: str) -> tuple[str, str]:
    """
    Summarize a news article using the provided LangChain LLM.

    Returns:
        A tuple of (summary, why_it_matters) — each a single sentence.
    """
    chain = _PROMPT | llm | StrOutputParser()
    raw = chain.invoke({"title": title, "description": description}).strip()

    summary = ""
    why = ""
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("HEADLINE:"):
            summary = line[len("HEADLINE:"):].strip()
        elif line.startswith("WHY:"):
            why = line[len("WHY:"):].strip()

    return summary or raw, why
