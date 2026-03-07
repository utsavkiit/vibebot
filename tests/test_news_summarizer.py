from langchain_core.language_models.fake_chat_models import FakeListChatModel

from vibebot.plugins.news.summarizer import summarize_article


def test_summarize_returns_stripped_string():
    fake_llm = FakeListChatModel(responses=["SUMMARY: This is a summary.\nWHY: It matters."])
    summary, why = summarize_article(fake_llm, title="Test Title", description="Test description.")
    assert summary == "This is a summary."
    assert why == "It matters."


def test_summarize_passes_correct_inputs():
    fake_llm = FakeListChatModel(responses=["SUMMARY: Summary.\nWHY: Why."])
    summary, why = summarize_article(fake_llm, title="My Title", description="My description.")
    assert summary == "Summary."
    assert why == "Why."


def test_summarize_strips_whitespace():
    fake_llm = FakeListChatModel(responses=["  SUMMARY: Trimmed summary.  \n  WHY: Trimmed why.  "])
    summary, why = summarize_article(fake_llm, title="Title", description="Desc")
    assert summary == "Trimmed summary."
    assert why == "Trimmed why."
