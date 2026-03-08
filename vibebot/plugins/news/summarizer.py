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
        "2. EMOJI: A single emoji that best represents the news category "
        "(e.g. 🏛️ politics, 📈 business, ⚔️ conflict, 🌍 climate, 💻 tech, "
        "🏥 health, 🔬 science, 🚨 disaster, 🏆 sports).\n\n"
        "Respond in exactly this format (no extra text):\n"
        "HEADLINE: <8 words max>\n"
        "EMOJI: <single emoji>",
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
        A tuple of (headline, category_emoji).
    """
    chain = _PROMPT | llm | StrOutputParser()
    raw = chain.invoke({"title": title, "description": description}).strip()

    summary = ""
    emoji = "📰"
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("HEADLINE:"):
            summary = line[len("HEADLINE:"):].strip()
        elif line.startswith("EMOJI:"):
            emoji = line[len("EMOJI:"):].strip()

    return summary or raw, emoji
