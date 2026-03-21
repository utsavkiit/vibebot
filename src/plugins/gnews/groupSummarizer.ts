import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

const PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are a sharp news editor writing for a busy professional audience. ' +
      'You will receive a group of related news headlines and their descriptions covering the same story or topic.\n\n' +
      'Write three things that represent the entire group:\n' +
      '1. HEADLINE: A punchy, newspaper-style headline capturing the overall story. Max 10 words. Active voice. Specific, not generic.\n' +
      '2. SUMMARY: A concise 1–2 sentence summary of the full picture across all articles. Plain language, no jargon. Max 30 words.\n' +
      '3. EMOJI: A single emoji that best represents the news category ' +
      '(e.g. 🏛️ politics, 📈 business, ⚔️ conflict, 🌍 climate, 💻 tech, ' +
      '🏥 health, 🔬 science, 🚨 disaster, 🏆 sports, 🎬 entertainment).\n\n' +
      'Respond in exactly this format (no extra text):\n' +
      'HEADLINE: <10 words max>\n' +
      'SUMMARY: <1–2 sentences, max 30 words>\n' +
      'EMOJI: <single emoji>',
  ],
  ['human', '{articles}'],
]);

export interface GroupSummary {
  headline: string;
  summary: string;
  emoji: string;
}

/**
 * Summarize a topic group (multiple related articles) into a single
 * headline, summary, and emoji using an LLM.
 */
export async function summarizeGroup(
  llm: BaseChatModel,
  articles: Array<{ title: string; description: string; source: string }>,
): Promise<GroupSummary> {
  const articlesText = articles
    .map((a, i) => `Article ${i + 1} [${a.source}]:\nTitle: ${a.title}\nDescription: ${a.description}`)
    .join('\n\n');

  const chain = PROMPT.pipe(llm).pipe(new StringOutputParser());
  const raw = (await chain.invoke({ articles: articlesText })).trim();

  let headline = '';
  let summary = '';
  let emoji = '📰';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('HEADLINE:')) {
      headline = trimmed.slice('HEADLINE:'.length).trim();
    } else if (trimmed.startsWith('SUMMARY:')) {
      summary = trimmed.slice('SUMMARY:'.length).trim();
    } else if (trimmed.startsWith('EMOJI:')) {
      emoji = trimmed.slice('EMOJI:'.length).trim();
    }
  }

  return { headline: headline || articles[0].title, summary, emoji };
}
