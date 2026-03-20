import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

const PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are a sharp news editor writing for a busy professional audience. ' +
      'Given a news article, write three things:\n' +
      '1. HEADLINE: A punchy, newspaper-style headline. Max 8 words. ' +
      'Active voice. No fluff. Make it specific and intriguing — not generic.\n' +
      '2. SUMMARY: A concise 1-sentence summary of the story. Plain language, no jargon. Max 20 words.\n' +
      '3. EMOJI: A single emoji that best represents the news category ' +
      '(e.g. 🏛️ politics, 📈 business, ⚔️ conflict, 🌍 climate, 💻 tech, ' +
      '🏥 health, 🔬 science, 🚨 disaster, 🏆 sports).\n\n' +
      'Respond in exactly this format (no extra text):\n' +
      'HEADLINE: <8 words max>\n' +
      'SUMMARY: <1 sentence, max 20 words>\n' +
      'EMOJI: <single emoji>',
  ],
  ['human', 'Article title: {title}\n\nArticle description: {description}'],
]);

export async function summarizeArticle(
  llm: BaseChatModel,
  title: string,
  description: string,
): Promise<[string, string, string]> {
  const chain = PROMPT.pipe(llm).pipe(new StringOutputParser());
  const raw = (await chain.invoke({ title, description })).trim();

  let headline = '';
  let blurb = '';
  let emoji = '📰';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('HEADLINE:')) {
      headline = trimmed.slice('HEADLINE:'.length).trim();
    } else if (trimmed.startsWith('SUMMARY:')) {
      blurb = trimmed.slice('SUMMARY:'.length).trim();
    } else if (trimmed.startsWith('EMOJI:')) {
      emoji = trimmed.slice('EMOJI:'.length).trim();
    }
  }

  return [headline || raw, blurb, emoji];
}
