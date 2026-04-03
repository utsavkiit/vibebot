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
import { HeadlineWithEmbedding } from '../plugins/gnews/index';
import {
  buildResearchPodcastFromHeadlines,
  ResearchPodcastConfig,
  ResearchPodcastRuntimeConfig,
} from '../plugins/podcast/researchPodcast';

// ── Config types ─────────────────────────────────────────────────────────────

interface AppConfig {
  research_podcast: {
    topic_count?: number;
    max_searches_per_topic?: number;
    llm: { provider: string; model: string };
  };
  plugins?: {
    podcast?: {
      tts_url: string;
      serve_url: string;
      voice: string;
      model: string;
      output_dir: string;
    };
  };
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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const { inputFile, noTts } = parseArgs(process.argv);

  // Load config
  const configPath = path.join(repoRoot, 'config.yaml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as AppConfig;
  const rpCfg = config.research_podcast;
  const podcastCfg = config.plugins?.podcast;

  if (!rpCfg) {
    console.error('research_podcast block missing from config.yaml');
    process.exit(1);
  }

  // Load headlines
  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    console.error('Run "npm run fetch-gnews" first.');
    process.exit(1);
  }

  const headlines: HeadlineWithEmbedding[] = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  console.info(`Loaded ${headlines.length} headlines.`);

  const researchConfig: ResearchPodcastConfig = {
    topicCount: rpCfg.topic_count ?? 3,
    maxSearchesPerTopic: rpCfg.max_searches_per_topic ?? 3,
    llm: rpCfg.llm,
  };

  const runtimeConfig: ResearchPodcastRuntimeConfig | undefined = podcastCfg
    ? {
        ttsUrl: podcastCfg.tts_url,
        serveUrl: podcastCfg.serve_url,
        voice: podcastCfg.voice,
        model: podcastCfg.model,
        outputDir: podcastCfg.output_dir,
      }
    : undefined;

  const result = await buildResearchPodcastFromHeadlines(headlines, {
    repoRoot,
    research: researchConfig,
    runtime: runtimeConfig,
    noTts,
  });

  console.info(`\n${'-'.repeat(60)}\n${result.script}\n${'-'.repeat(60)}\n`);

  if (noTts) {
    console.info('Skipping TTS (--no-tts).');
  } else if (!podcastCfg) {
    console.warn('No podcast config found — skipping TTS.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
