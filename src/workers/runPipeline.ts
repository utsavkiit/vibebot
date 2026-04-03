import path from 'path';
import { getConnection, initDb } from '../core/db';
import { getLlm } from '../core/llmFactory';
import { NewsPlugin } from '../plugins/news';
import { NewsCollectorPlugin, FeedConfig } from '../plugins/newsCollector';
import { PodcastPlugin } from '../plugins/podcast';
import { ResearchPodcastPlugin } from '../plugins/podcast/researchPodcast';
import * as collector from './collector';
import * as deliveryWorker from './deliveryWorker';
import { GlobalDigestBuilder } from './globalDigestBuilder';

const DB_PATH = path.resolve(__dirname, '../../vibebot.db');

interface EmbeddingsConfig {
  provider: string;
  model: string;
}

interface NewsCollectorPluginConfig {
  enabled?: boolean;
  fetch_count?: number;
  embeddings: EmbeddingsConfig;
  feeds: Array<{ name: string; url: string }>;
}

interface PodcastPluginConfig {
  enabled?: boolean;
  tts_url?: string;
  serve_url?: string;
  voice?: string;
  model?: string;
  output_dir?: string;
  story_count?: number;
}

interface ResearchPodcastPluginConfig {
  enabled?: boolean;
  topic_count?: number;
  max_searches_per_topic?: number;
  llm: {
    provider: string;
    model: string;
  };
}

interface Config {
  plugins?: Record<string, { enabled?: boolean; article_count?: number } & Partial<NewsCollectorPluginConfig> & Partial<PodcastPluginConfig>>;
  llm?: { provider?: string; model?: string };
  delivery?: { max_retries?: number };
  global_digest?: { story_count?: number };
  research_podcast?: ResearchPodcastPluginConfig;
}

export async function runPipeline(config: Config, pluginFilter?: string, dryRunDate?: string, storiesOverride?: number, inspect?: boolean): Promise<void> {
  const pluginsCfg = config.plugins ?? {};
  const llmCfg = config.llm ?? {};

  initDb(DB_PATH);
  const db = getConnection(DB_PATH);

  // Collect plugins (news only — podcast is no longer a collector)
  const collectPlugins: Array<NewsPlugin | NewsCollectorPlugin> = [];
  let podcastPlugin: PodcastPlugin | null = null;
  let researchPodcastPlugin: ResearchPodcastPlugin | null = null;

  for (const [name, cfg] of Object.entries(pluginsCfg)) {
    if (!cfg.enabled) {
      console.info(`Plugin '${name}' is disabled — skipping.`);
      continue;
    }

    if (name === 'news') {
      collectPlugins.push(new NewsPlugin(cfg.article_count ?? 5));
    } else if (name === 'news_collector') {
      const collectorCfg = cfg as NewsCollectorPluginConfig;
      collectPlugins.push(new NewsCollectorPlugin({
        feeds: (collectorCfg.feeds ?? []) as FeedConfig[],
        fetchCount: collectorCfg.fetch_count ?? 50,
        embeddings: collectorCfg.embeddings,
      }));
    } else if (name === 'podcast') {
      const podcastCfg = cfg as PodcastPluginConfig;
      podcastPlugin = new PodcastPlugin({
        ttsUrl: podcastCfg.tts_url ?? 'http://localhost:8080',
        voice: podcastCfg.voice ?? 'af_heart',
        model: podcastCfg.model ?? 'mlx-community/Kokoro-82M-bf16',
        outputDir: podcastCfg.output_dir ?? '~/VibeBot-Podcasts',
        serveUrl: podcastCfg.serve_url ?? 'http://localhost:8888',
        storyCount: podcastCfg.story_count ?? 5,
      });
    } else {
      console.warn(`Plugin '${name}' is enabled but not registered — skipping.`);
    }
  }

  const researchCfg = config.research_podcast;
  if (researchCfg && researchCfg.enabled !== false) {
    const podcastCfg = pluginsCfg.podcast as PodcastPluginConfig | undefined;
    if (!podcastCfg?.enabled) {
      console.warn('Research podcast is configured but podcast plugin is disabled; skipping research podcast.');
    } else {
      researchPodcastPlugin = new ResearchPodcastPlugin({
        repoRoot: path.resolve(__dirname, '../..'),
        research: {
          topicCount: researchCfg.topic_count ?? 3,
          maxSearchesPerTopic: researchCfg.max_searches_per_topic ?? 3,
          llm: researchCfg.llm,
        },
        runtime: {
          ttsUrl: podcastCfg.tts_url ?? 'http://localhost:8080',
          voice: podcastCfg.voice ?? 'af_heart',
          model: podcastCfg.model ?? 'mlx-community/Kokoro-82M-bf16',
          outputDir: podcastCfg.output_dir ?? '~/VibeBot-Podcasts',
          serveUrl: podcastCfg.serve_url ?? 'http://localhost:8888',
        },
      });
    }
  }

  // Apply plugin filter (only applies to collect plugins)
  const activeCollectPlugins = pluginFilter
    ? collectPlugins.filter((p) => p.name === pluginFilter)
    : collectPlugins;

  if (pluginFilter === 'podcast') {
    console.warn('Podcast runs as part of the main pipeline — use no filter to run everything.');
    db.close();
    process.exit(1);
  }

  if (pluginFilter && !activeCollectPlugins.length) {
    console.error(`Plugin filter '${pluginFilter}' matched no registered plugins.`);
    db.close();
    process.exit(1);
  }

  if (!activeCollectPlugins.length && !podcastPlugin && !researchPodcastPlugin) {
    console.warn('No plugins enabled — nothing to run.');
    db.close();
    return;
  }

  const llm = getLlm(llmCfg.provider ?? 'anthropic', llmCfg.model ?? 'claude-haiku-4-5-20251001');

  const globalBuilder = new GlobalDigestBuilder({
    storyCount: storiesOverride ?? config.global_digest?.story_count ?? 10,
  });

  if (inspect) {
    console.info('Stage 1: Collecting raw data.');
    await collector.run(activeCollectPlugins, db);
    console.info('Inspect mode: clustering without LLM.');
    globalBuilder.inspectClusters(db);
    db.close();
    return;
  }

  if (dryRunDate !== undefined) {
    const date = dryRunDate || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    console.info(`Dry-run mode: previewing digest for ${date} (no Slack send).`);
    await globalBuilder.preview(db, llm, date);
    db.close();
    return;
  }

  console.info('Stage 1: Collecting raw data.');
  await collector.run(activeCollectPlugins, db);

  console.info('Stage 2: Clustering and building digests.');
  const ranked = globalBuilder.getRankedClusters(db);

  if (researchPodcastPlugin) {
    try {
      await researchPodcastPlugin.buildFromPendingHeadlines(db);
    } catch (err) {
      console.warn(`Research podcast failed - continuing without it. Error: ${(err as Error).message}`);
    }
  }

  await globalBuilder.buildFromClusters(ranked, db, llm);

  if (podcastPlugin) {
    await podcastPlugin.buildFromClusters(ranked, db, llm);
  }

  console.info('Stage 3: Delivering messages.');
  await deliveryWorker.run(db);

  db.close();
}
