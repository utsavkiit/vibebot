from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate


# ---------------------------------------------------------------------------
# Single-article prompt (kept for backward compatibility)
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Cluster-aware prompt — generates a thematic headline from multiple headlines
# ---------------------------------------------------------------------------
_CLUSTER_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are a sharp news editor writing for a busy professional audience.\n"
        "You are given a cluster of related news headlines all covering the same story or theme.\n"
        "Write:\n"
        "1. HEADLINE: A single punchy, newspaper-style headline that captures the key angle of "
        "this story. Max 10 words. Active voice. Specific. No fluff.\n"
        "2. SUMMARY: One concise sentence summarizing what is happening. "
        "Plain language, no jargon. Max 25 words.\n"
        "3. EMOJI: A single emoji for the news category "
        "(e.g. 🏛️ politics, 📈 business, ⚔️ conflict, 🌍 climate, 💻 tech, "
        "🏥 health, 🔬 science, 🚨 disaster, 🏆 sports, 🏎️ F1, 🏏 cricket, ⚽ soccer, "
        "🎾 tennis, 🤖 AI, 🇮🇳 India).\n\n"
        "Respond in exactly this format (no extra text):\n"
        "HEADLINE: <10 words max>\n"
        "SUMMARY: <1 sentence, max 25 words>\n"
        "EMOJI: <single emoji>",
    ),
    (
        "human",
        "Related headlines on the same story:\n{headlines}",
    ),
])


def _parse_output(raw: str, fallback: str) -> tuple[str, str, str]:
    headline = ""
    blurb = ""
    emoji = "📰"
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("HEADLINE:"):
            headline = line[9:].strip()
        elif line.startswith("SUMMARY:"):
            blurb = line[8:].strip()
        elif line.startswith("EMOJI:"):
            emoji = line[6:].strip()
    return headline or fallback, blurb, emoji


def summarize_article(llm: BaseChatModel, title: str, description: str) -> tuple[str, str, str]:
    """
    Summarize a single news article using the provided LangChain LLM.

    Returns:
        A tuple of (headline, blurb, category_emoji).
    """
    chain = _PROMPT | llm | StrOutputParser()
    raw = chain.invoke({"title": title, "description": description}).strip()
    return _parse_output(raw, title)


def summarize_cluster(llm: BaseChatModel, articles: list[dict]) -> tuple[str, str, str]:
    """
    Summarize a cluster of related articles into a thematic (headline, blurb, emoji).

    Passes up to 6 article titles to the LLM so it can pick the best angle.

    Returns:
        A tuple of (headline, blurb, category_emoji).
    """
    headlines = "\n".join(f"- {a['title']}" for a in articles[:6])
    chain = _CLUSTER_PROMPT | llm | StrOutputParser()
    raw = chain.invoke({"headlines": headlines}).strip()
    return _parse_output(raw, articles[0]["title"])
