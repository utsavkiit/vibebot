import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PodcastStorySummary } from './podcastSummarizer';

export async function generatePodcastScript(
  llm: BaseChatModel,
  stories: PodcastStorySummary[],
  date: string,
): Promise<string> {
  const storyBlocks = stories
    .map((s, i) => `Story ${i + 1}:\n${s.intro}\n${s.summary}`)
    .join('\n\n');

  const systemPrompt = `You are a professional podcast scriptwriter for a daily news briefing called "VibeBot Daily".
Your job is to stitch pre-written story summaries into one cohesive, flowing podcast script.

Rules:
- Write entirely in spoken English — no bullet points, no markdown, no emoji, no URLs.
- Open with a warm 2-sentence welcome that mentions today's date: ${date}.
- Present stories in order as given — do not reorganize them.
- Use the provided INTRO phrases as natural spoken transitions between stories.
- Keep each story's SUMMARY largely intact — your job is to connect them, not rewrite them.
- Transitions between stories should be natural and story-driven (e.g. "Our next story...", "In other developments...", "Turning now to..."). Do not use region-based transitions like "In US news..." or "Moving on to India...".
- Close with a warm 2-sentence sign-off.
- Output only the script. No titles, headers, or stage directions.`;

  const userPrompt = `Here are today's top stories in order of importance. Stitch them into one flowing podcast script:\n\n${storyBlocks}`;

  const response = await llm.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  return (response.content as string).trim();
}
