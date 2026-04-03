/**
 * Research Podcast Script
 *
 * Loads headlines from gnews_headlines.json, clusters them, picks the top 3
 * by size, then runs a LangChain research agent on each to produce a
 * ~2-minute spoken podcast segment per topic. Stitches into a full script
 * and sends to TTS.
 *
 * Usage:
 *   npm run research-podcast
 *   npm run research-podcast -- --input ./gnews_headlines.json
 *   npm run research-podcast -- --no-tts   (skip audio generation)
 */

import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import * as yaml from 'js-yaml';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { HeadlineWithEmbedding } from '../plugins/gnews/index';
import { clusterByTopic } from '../plugins/gnews/clusterer';
import { getLlm } from '../core/llmFactory';
import { researchTopicSegment } from '../plugins/podcast/researchAgent';
import { generateAudio, TtsConfig } from '../plugins/podcast/ttsClient';

// ── Config types ─────────────────────────────────────────────────────────────

interface LlmConfig { provider: string; model: string; }
interface ResearchPodcastConfig {
  topic_count?: number;
  max_searches_per_topic?: number;
  llm: LlmConfig;
}
interface PodcastConfig {
  tts_url: string;
  serve_url: string;
  voice: string;
  model: string;
  output_dir: string;
}
interface AppConfig {
  research_podcast: ResearchPodcastConfig;
  podcast: PodcastConfig;
}

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { inputFile: string; noTts: boolean } {
  const args = argv.slice(2);
  let inputFile = path.resolve(process.cwd(), 'gnews_headlines.json');
  let noTts = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputFile = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--no-tts') {
      noTts = true;
    }
  }
  return { inputFile, noTts };
}

// ── Script stitcher ───────────────────────────────────────────────────────────

async function stitchScript(
  llm: ReturnType<typeof getLlm>,
  segments: Array<{ label: string; text: string }>,
  date: string,
): Promise<string> {
  const segmentBlocks = segments
    .map((s, i) => `Segment ${i + 1} — Topic: ${s.label}\n${s.text}`)
    .join('\n\n---\n\n');

  const system = `You are a professional podcast scriptwriter for "VibeBot Daily".
Stitch these pre-researched story segments into one cohesive, flowing script.

Rules:
- Write entirely in spoken English — no bullet points, no markdown, no emoji, no URLs.
- Open with a warm 2-sentence welcome that mentions today's date: ${date}.
- Present segments in order as given.
- Add natural spoken transitions between segments (e.g. "Our next story...", "Turning now to...", "In other developments..."). Do not use region-based transitions.
- Keep each segment's content largely intact — your job is to connect them, not rewrite them.
- Close with a warm 2-sentence sign-off.
- Output only the script. No titles, headers, or stage directions.`;

  const user = `Here are today's 3 deeply researched stories. Stitch them into one flowing podcast script:\n\n${segmentBlocks}`;

  const response = await llm.invoke([new SystemMessage(system), new HumanMessage(user)]);
  return (response.content as string).trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const { inputFile, noTts } = parseArgs(process.argv);

  // Load config
  const configPath = path.join(repoRoot, 'config.yaml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as AppConfig;
  const rpCfg = config.research_podcast;
  const podcastCfg = config.podcast;

  if (!rpCfg) {
    console.error('research_podcast block missing from config.yaml');
    process.exit(1);
  }

  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    console.error('TAVILY_API_KEY is not set in .env');
    process.exit(1);
  }

  // Load headlines
  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    console.error('Run "npm run fetch-gnews" first.');
    process.exit(1);
  }

  const headlines: HeadlineWithEmbedding[] = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  console.info(`Loaded ${headlines.length} headlines. Clustering at 0.62...`);

  // Cluster + rank by size, take top N
  const topicCount = rpCfg.topic_count ?? 3;
  const clusters = clusterByTopic(headlines, 0.62)
    .filter((g) => g.headlines.length > 1)
    .slice(0, topicCount);

  if (clusters.length === 0) {
    console.error('No multi-member clusters found. Try running fetch-gnews first.');
    process.exit(1);
  }

  console.info(`Top ${clusters.length} clusters:`);
  clusters.forEach((c, i) =>
    console.info(`  [${i + 1}] (${c.headlines.length} articles) ${c.label.slice(0, 80)}`),
  );

  // Init LLMs
  const agentLlm = getLlm(rpCfg.llm.provider, rpCfg.llm.model);
  const stitchLlm = getLlm(rpCfg.llm.provider, rpCfg.llm.model);
  const maxSearches = rpCfg.max_searches_per_topic ?? 3;

  // Research each cluster
  const segments: Array<{ label: string; text: string }> = [];

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const label = cluster.label;
    console.info(`\n[${i + 1}/${clusters.length}] Researching: "${label.slice(0, 70)}..."`);

    const text = await researchTopicSegment(
      agentLlm,
      label,
      cluster.headlines,
      tavilyKey,
      maxSearches,
    );

    const wordCount = text.split(/\s+/).length;
    console.info(`  ✓ Segment written (${wordCount} words)`);
    segments.push({ label, text });
  }

  // Stitch into full script
  console.info('\nStitching script...');
  const date = new Date().toISOString().split('T')[0];
  const script = await stitchScript(stitchLlm, segments, date);

  // Save script text
  const scriptPath = path.join(repoRoot, `research-podcast-${date}.txt`);
  fs.writeFileSync(scriptPath, script, 'utf-8');
  console.info(`Script saved → ${scriptPath}`);
  console.info(`\n${'─'.repeat(60)}\n${script}\n${'─'.repeat(60)}\n`);

  // TTS
  if (!noTts && podcastCfg) {
    const ttsConfig: TtsConfig = {
      ttsUrl: podcastCfg.tts_url,
      voice: podcastCfg.voice,
      model: podcastCfg.model,
      outputDir: podcastCfg.output_dir.replace('${date}', date),
    };

    try {
      console.info('Sending to TTS...');
      const audioPath = await generateAudio(script, ttsConfig);
      console.info(`Audio saved → ${audioPath}`);
    } catch (err) {
      console.warn(`TTS failed — script saved as text only. Error: ${(err as Error).message}`);
    }
  } else if (noTts) {
    console.info('Skipping TTS (--no-tts).');
  } else {
    console.warn('No podcast config found — skipping TTS.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
