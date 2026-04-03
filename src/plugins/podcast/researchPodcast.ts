import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getLlm } from '../../core/llmFactory';
import { buildFooter, buildHeader } from '../../core/messageUtils';
import { getAllPendingRawItems, insertOutboundMessage } from '../../core/db';
import { clusterByTopic } from '../gnews/clusterer';
import { HeadlineWithEmbedding } from '../gnews';
import { researchTopicSegment } from './researchAgent';
import { generateAudio, TtsConfig } from './ttsClient';

interface LlmConfig {
  provider: string;
  model: string;
}

export interface ResearchPodcastConfig {
  topicCount: number;
  maxSearchesPerTopic: number;
  llm: LlmConfig;
}

export interface ResearchPodcastRuntimeConfig {
  ttsUrl: string;
  serveUrl: string;
  voice: string;
  model: string;
  outputDir: string;
}

export interface ResearchPodcastBuildConfig {
  repoRoot: string;
  research: ResearchPodcastConfig;
  runtime?: ResearchPodcastRuntimeConfig;
  noTts?: boolean;
}

export interface ResearchPodcastResult {
  date: string;
  script: string;
  scriptPath: string;
  audioPath: string | null;
  audioUrl: string | null;
  topicCount: number;
}

function getDateStamp(): string {
  return new Date().toISOString().split('T')[0];
}

async function stitchScript(
  llm: ReturnType<typeof getLlm>,
  segments: Array<{ label: string; text: string }>,
  date: string,
): Promise<string> {
  const segmentBlocks = segments
    .map((s, i) => `Segment ${i + 1} - Topic: ${s.label}\n${s.text}`)
    .join('\n\n---\n\n');

  const system = `You are a professional podcast scriptwriter for "VibeBot Daily".
Stitch these pre-researched story segments into one cohesive, flowing script.

Rules:
- Write entirely in spoken English - no bullet points, no markdown, no emoji, no URLs.
- Open with a warm 2-sentence welcome that mentions today's date: ${date}.
- Present segments in order as given.
- Add natural spoken transitions between segments (e.g. "Our next story...", "Turning now to...", "In other developments..."). Do not use region-based transitions.
- Keep each segment's content largely intact - your job is to connect them, not rewrite them.
- Close with a warm 2-sentence sign-off.
- Output only the script. No titles, headers, or stage directions.`;

  const user = `Here are today's deeply researched stories. Stitch them into one flowing podcast script:\n\n${segmentBlocks}`;
  const response = await llm.invoke([new SystemMessage(system), new HumanMessage(user)]);
  return (response.content as string).trim();
}

function loadResearchHeadlinesFromDb(db: Database.Database): HeadlineWithEmbedding[] {
  return getAllPendingRawItems(db)
    .filter((item) => !['podcast', 'news', 'stocks', 'real_estate'].includes(item.source_type))
    .map((item) => JSON.parse(item.payload) as HeadlineWithEmbedding);
}

export async function buildResearchPodcastFromHeadlines(
  headlines: HeadlineWithEmbedding[],
  config: ResearchPodcastBuildConfig,
): Promise<ResearchPodcastResult> {
  if (!headlines.length) {
    throw new Error('No headlines available for research podcast.');
  }

  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    throw new Error('TAVILY_API_KEY is not set in .env');
  }

  const date = getDateStamp();
  const clusters = clusterByTopic(headlines, 0.62)
    .filter((group) => group.headlines.length > 1)
    .slice(0, config.research.topicCount);

  if (!clusters.length) {
    throw new Error('No multi-member clusters found for research podcast.');
  }

  console.info(`[research-podcast] Top ${clusters.length} clusters selected.`);
  clusters.forEach((cluster, i) => {
    console.info(`  [${i + 1}] (${cluster.headlines.length} articles) ${cluster.label.slice(0, 80)}`);
  });

  const agentLlm = getLlm(config.research.llm.provider, config.research.llm.model);
  const stitchLlm = getLlm(config.research.llm.provider, config.research.llm.model);

  const segments: Array<{ label: string; text: string }> = [];
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    console.info(`[research-podcast] Researching ${i + 1}/${clusters.length}: "${cluster.label.slice(0, 70)}..."`);

    const text = await researchTopicSegment(
      agentLlm,
      cluster.label,
      cluster.headlines,
      tavilyKey,
      config.research.maxSearchesPerTopic,
    );

    segments.push({ label: cluster.label, text });
  }

  console.info('[research-podcast] Stitching final script...');
  const script = await stitchScript(stitchLlm, segments, date);

  const scriptPath = path.join(config.repoRoot, `research-podcast-${date}.txt`);
  fs.writeFileSync(scriptPath, script, 'utf-8');
  console.info(`[research-podcast] Script saved -> ${scriptPath}`);

  let audioPath: string | null = null;
  let audioUrl: string | null = null;
  if (!config.noTts && config.runtime) {
    const ttsConfig: TtsConfig = {
      ttsUrl: config.runtime.ttsUrl,
      voice: config.runtime.voice,
      model: config.runtime.model,
      outputDir: config.runtime.outputDir.replace('${date}', date),
      fileBasename: `research-podcast-${date}`,
    };

    try {
      console.info('[research-podcast] Sending script to TTS...');
      audioPath = await generateAudio(script, ttsConfig);
      const filename = path.basename(audioPath);
      audioUrl = `${config.runtime.serveUrl}/${filename}`;
      console.info(`[research-podcast] Audio saved -> ${audioPath}`);
    } catch (err) {
      console.warn(`[research-podcast] TTS failed - posting script-only. Error: ${(err as Error).message}`);
    }
  }

  return {
    date,
    script,
    scriptPath,
    audioPath,
    audioUrl,
    topicCount: clusters.length,
  };
}

function buildResearchPodcastSlackBlocks(result: ResearchPodcastResult): object[] {
  const formattedDate = new Date(result.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const blocks: object[] = [
    ...buildHeader(),
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*🎧 VibeBot Research Podcast - ${formattedDate}*` },
    },
    { type: 'divider' },
  ];

  if (result.audioUrl) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Research podcast ready!* Covering ${result.topicCount} deeply researched stories.\n🎧 <${result.audioUrl}|Listen now>`,
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Audio generation failed* - here's the research script instead:\n\n${result.script.slice(0, 2900)}${result.script.length > 2900 ? '…' : ''}`,
      },
    });
  }

  blocks.push(...buildFooter());
  return blocks;
}

export class ResearchPodcastPlugin {
  private config: ResearchPodcastBuildConfig;

  constructor(config: ResearchPodcastBuildConfig) {
    this.config = config;
  }

  async buildFromPendingHeadlines(db: Database.Database): Promise<number | null> {
    const headlines = loadResearchHeadlinesFromDb(db);
    if (!headlines.length) {
      console.info('[research-podcast] No pending headlines available.');
      return null;
    }

    const result = await buildResearchPodcastFromHeadlines(headlines, this.config);
    const blocks = buildResearchPodcastSlackBlocks(result);
    const msgId = insertOutboundMessage(db, 'slack_default', 'research_podcast_digest', blocks, 3);
    console.info(`[research-podcast] Digest built -> outbound_message id=${msgId}.`);
    return msgId;
  }
}
