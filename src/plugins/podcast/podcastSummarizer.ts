import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

const PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are a podcast news writer. You will receive a group of related news headlines ' +
      'covering the same story.\n\n' +
      'Write a spoken summary of this story for a daily news podcast. Rules:\n' +
      '- 2-4 flowing sentences in natural spoken English\n' +
      '- No bullet points, no markdown, no emoji, no URLs\n' +
      '- Spell out abbreviations (e.g. "the United States" not "US", "artificial intelligence" not "AI")\n' +
      '- Spell out numbers and symbols (e.g. "three point five billion dollars" not "$3.5B")\n' +
      '- Conversational but informative tone — like a trusted radio journalist\n' +
      '- Also write a short spoken topic introduction (max 8 words) to transition into this story\n\n' +
      'Respond in exactly this format (no extra text):\n' +
      'INTRO: <transition phrase, max 8 words>\n' +
      'SUMMARY: <2-4 spoken sentences>',
  ],
  ['human', '{articles}'],
]);

export interface PodcastStorySummary {
  intro: string;
  summary: string;
}

export async function summarizeGroupForPodcast(
  llm: BaseChatModel,
  articles: Array<{ title: string; description: string; source: string }>,
): Promise<PodcastStorySummary> {
  const articlesText = articles
    .map((a, i) => `Article ${i + 1} [${a.source}]:\nTitle: ${a.title}\nDescription: ${a.description}`)
    .join('\n\n');

  const chain = PROMPT.pipe(llm).pipe(new StringOutputParser());
  const raw = (await chain.invoke({ articles: articlesText })).trim();

  let intro = '';
  let summary = '';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('INTRO:')) {
      intro = trimmed.slice('INTRO:'.length).trim();
    } else if (trimmed.startsWith('SUMMARY:')) {
      summary = trimmed.slice('SUMMARY:'.length).trim();
    }
  }

  return {
    intro: intro || 'In other news...',
    summary: summary || articles.map((a) => a.title).join('. '),
  };
}
