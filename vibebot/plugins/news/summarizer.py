from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser


_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are a sharp news editor writing for a busy professional audience. "
        "Given a news article, write three things:\n"
        "1. HEADLINE: A punchy, newspaper-style headline. Max 8 words. "
        "Active voice. No fluff. Make it specific and intriguing — not generic.\n"
        "2. SUMMARY: A concise 1-sentence summary of the story. Plain language, no jargon. Max 20 words.\n"
        "3. EMOJI: A single emoji that best represents the news category "
        "(e.g. 🏛️ politics, 📈 business, ⚔️ conflict, 🌍 climate, 💻 tech, "
        "🏥 health, 🔬 science, 🚨 disaster, 🏆 sports).\n\n"
        "Respond in exactly this format (no extra text):\n"
        "HEADLINE: <8 words max>\n"
        "SUMMARY: <1 sentence, max 20 words>\n"
        "EMOJI: <single emoji>",
    ),
    (
        "human",
        "Article title: {title}\n\nArticle description: {description}",
    ),
])


def summarize_article(llm: BaseChatModel, title: str, description: str) -> tuple[str, str, str]:
    """
    Summarize a news article using the provided LangChain LLM.

    Returns:
        A tuple of (headline, blurb, category_emoji).
    """
    chain = _PROMPT | llm | StrOutputParser()
    raw = chain.invoke({"title": title, "description": description}).strip()

    headline = ""
    blurb = ""
    emoji = "📰"
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("HEADLINE:"):
            headline = line[len("HEADLINE:"):].strip()
        elif line.startswith("SUMMARY:"):
            blurb = line[len("SUMMARY:"):].strip()
        elif line.startswith("EMOJI:"):
            emoji = line[len("EMOJI:"):].strip()

    return headline or raw, blurb, emoji
