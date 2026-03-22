import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PodcastStorySummary } from './podcastSummarizer';

export interface TopicSection {
  topic: string;
  label: string;
  stories: PodcastStorySummary[];
}

const TOPIC_LABELS: Record<string, string> = {
  us_news: 'US News',
  world_news: 'World News',
  india_news: 'India News',
  sports_f1: 'Formula 1',
  sports_soccer: 'Soccer',
  sports_cricket: 'Cricket',
  sports_tennis: 'Tennis',
  tech_news: 'Tech',
  stocks_news: 'Markets',
};

export function getTopicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic;
}

export async function generatePodcastScript(
  llm: BaseChatModel,
  sections: TopicSection[],
  date: string,
): Promise<string> {
  const sectionBlocks = sections
    .map((s) => {
      const stories = s.stories
        .map((story, i) => `Story ${i + 1}:\n${story.intro}\n${story.summary}`)
        .join('\n\n');
      return `### ${s.label}\n${stories}`;
    })
    .join('\n\n');

  const systemPrompt = `You are a professional podcast scriptwriter for a daily news briefing called "VibeBot Daily".
Your job is to stitch pre-written story summaries into one cohesive, flowing podcast script.

Rules:
- Write entirely in spoken English — no bullet points, no markdown, no emoji, no URLs.
- Open with a warm 2-sentence welcome that mentions today's date: ${date}.
- Use the provided INTRO phrases as natural spoken transitions between stories.
- Keep each story's SUMMARY largely intact — your job is to connect them, not rewrite them.
- Add brief connective tissue between topics (e.g. "Moving on to world news...", "On the tech front...").
- Close with a warm 2-sentence sign-off.
- Output only the script. No titles, headers, or stage directions.`;

  const userPrompt = `Here are today's story summaries by topic. Stitch them into one flowing podcast script:\n\n${sectionBlocks}`;

  const response = await llm.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  return (response.content as string).trim();
}
