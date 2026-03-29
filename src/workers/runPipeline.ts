import path from 'path';
import { getConnection, initDb } from '../core/db';
import { getLlm } from '../core/llmFactory';
import { NewsPlugin } from '../plugins/news';
import { NewsCollectorPlugin, FeedConfig } from '../plugins/newsCollector';
import { PodcastPlugin } from '../plugins/podcast';
import * as collector from './collector';
import * as digestBuilder from './digestBuilder';
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
  source_plugins?: string[];
}

interface Config {
  plugins?: Record<string, { enabled?: boolean; article_count?: number } & Partial<NewsCollectorPluginConfig> & Partial<PodcastPluginConfig>>;
  llm?: { provider?: string; model?: string };
  delivery?: { max_retries?: number };
  global_digest?: { story_count?: number };
}

export async function runPipeline(config: Config, pluginFilter?: string, dryRunDate?: string, storiesOverride?: number, inspect?: boolean): Promise<void> {
  const pluginsCfg = config.plugins ?? {};
  const llmCfg = config.llm ?? {};

  initDb(DB_PATH);
  const db = getConnection(DB_PATH);

  const plugins = [];
  for (const [name, cfg] of Object.entries(pluginsCfg)) {
    if (!cfg.enabled) {
      console.info(`Plugin '${name}' is disabled — skipping.`);
      continue;
    }

    if (name === 'news') {
      plugins.push(new NewsPlugin(cfg.article_count ?? 5));
    } else if (name === 'news_collector') {
      const collectorCfg = cfg as NewsCollectorPluginConfig;
      plugins.push(new NewsCollectorPlugin({
        feeds: (collectorCfg.feeds ?? []) as FeedConfig[],
        fetchCount: collectorCfg.fetch_count ?? 50,
        embeddings: collectorCfg.embeddings,
      }));
    } else if (name === 'podcast') {
      const podcastCfg = cfg as PodcastPluginConfig;
      plugins.push(new PodcastPlugin({
        ttsUrl: podcastCfg.tts_url ?? 'http://localhost:8080',
        voice: podcastCfg.voice ?? 'af_heart',
        model: podcastCfg.model ?? 'mlx-community/Kokoro-82M-bf16',
        outputDir: podcastCfg.output_dir ?? '~/VibeBot-Podcasts',
        serveUrl: podcastCfg.serve_url ?? 'http://localhost:8888',
        storyCount: podcastCfg.story_count ?? 2,
        sourcePlugins: podcastCfg.source_plugins ?? [
          'us_news', 'world_news', 'india_news',
          'sports_f1', 'sports_soccer', 'sports_cricket', 'sports_tennis',
          'tech_news', 'stocks_news',
        ],
      }));
    } else {
      console.warn(`Plugin '${name}' is enabled but not registered — skipping.`);
    }
  }

  // Apply plugin filter if --plugin flag was passed
  const activePlugins = pluginFilter
    ? plugins.filter((p) => p.name === pluginFilter)
    : plugins;

  if (pluginFilter && !activePlugins.length) {
    console.error(`Plugin filter '${pluginFilter}' matched no registered plugins.`);
    db.close();
    process.exit(1);
  }

  if (!activePlugins.length) {
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
    await collector.run(activePlugins, db);
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
  await collector.run(activePlugins, db);

  console.info('Stage 2: Building digests.');
  const nonNewsPlugins = activePlugins.filter((p) => p.name !== 'news_collector');

  // Run non-news plugins (e.g. podcast) before globalBuilder so they can
  // read pending news raw_items before globalBuilder marks them processed.
  if (nonNewsPlugins.length > 0) {
    await digestBuilder.run(nonNewsPlugins, db, llm);
  }

  const globalMsgId = await globalBuilder.run(db, llm);
  if (globalMsgId === null) {
    console.info('Global digest: no news items to process.');
  }

  console.info('Stage 3: Delivering messages.');
  await deliveryWorker.run(db);

  db.close();
}
