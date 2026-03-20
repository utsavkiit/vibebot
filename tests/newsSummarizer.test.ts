import { describe, it, expect, vi } from 'vitest';
import { summarizeArticle } from '../src/plugins/news/summarizer';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

function makeMockLlm(response: string): BaseChatModel {
  // LangChain identifies Runnables via `lc_runnable: true` (isRunnableInterface check).
  // The sequence then calls invoke(), which must return { content: string } so that
  // StringOutputParser can extract the text.
  return {
    lc_runnable: true,
    invoke: async (_input: unknown) => ({ content: response }),
  } as unknown as BaseChatModel;
}

describe('summarizeArticle', () => {
  it('parses HEADLINE, SUMMARY, and EMOJI from the LLM response', async () => {
    const llm = makeMockLlm('HEADLINE: Markets Rally Hard\nSUMMARY: Stocks surged globally.\nEMOJI: 📈');

    const [headline, blurb, emoji] = await summarizeArticle(llm, 'Title', 'Description');

    expect(headline).toBe('Markets Rally Hard');
    expect(blurb).toBe('Stocks surged globally.');
    expect(emoji).toBe('📈');
  });

  it('strips surrounding whitespace', async () => {
    const llm = makeMockLlm(
      '  HEADLINE:   Trimmed Headline  \n  SUMMARY:   Trimmed summary.  \n  EMOJI:   🌍  ',
    );

    const [headline, blurb, emoji] = await summarizeArticle(llm, 'Title', 'Desc');

    expect(headline).toBe('Trimmed Headline');
    expect(blurb).toBe('Trimmed summary.');
    expect(emoji).toBe('🌍');
  });

  it('falls back to raw text as headline when format is missing', async () => {
    const llm = makeMockLlm('Some unexpected text');

    const [headline, blurb, emoji] = await summarizeArticle(llm, 'Title', 'Desc');

    expect(headline).toBe('Some unexpected text');
    expect(blurb).toBe('');
    expect(emoji).toBe('📰');
  });
});
