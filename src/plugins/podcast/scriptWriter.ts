import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface DigestSection {
  topic: string;
  text: string;
}

const TOPIC_INTROS: Record<string, string> = {
  us_news_digest: 'US News',
  world_news_digest: 'World News',
  india_news_digest: 'India News',
  sports_digest: 'Sports',
  tech_news_digest: 'Tech',
  stocks_news_digest: 'Markets',
};

export async function generatePodcastScript(
  llm: BaseChatModel,
  sections: DigestSection[],
  date: string,
): Promise<string> {
  const sectionBlocks = sections
    .map((s) => {
      const label = TOPIC_INTROS[s.topic] ?? s.topic;
      return `### ${label}\n${s.text}`;
    })
    .join('\n\n');

  const systemPrompt = `You are a professional podcast scriptwriter for a daily news briefing called "VibeBot Daily".
Your job is to rewrite a set of news summaries as a flowing, engaging, spoken podcast script.

Rules:
- Write entirely in spoken English — no bullet points, no markdown, no hyperlinks, no asterisks.
- Open with a warm 2-sentence welcome that mentions today's date: ${date}.
- Cover each topic in the order given. Introduce each section with a natural spoken transition
  (e.g. "Moving on to world news...", "In the tech world today...", "On the sports front...").
- Weave a conversational, curious tone throughout. Brief commentary is welcome.
- Close with a 2-sentence sign-off that feels warm and personal.
- Target: 600–800 words — approximately a 5-minute listen at a natural reading pace.
- Do not invent facts not present in the summaries. Do not mention URLs.
- Output only the script text. No titles, no headers, no stage directions.`;

  const userPrompt = `Here are today's news summaries. Rewrite them as one flowing podcast script:\n\n${sectionBlocks}`;

  const response = await llm.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  return (response.content as string).trim();
}
