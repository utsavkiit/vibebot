import path from 'path';
import { getConnection, initDb } from '../core/db';
import { getLlm } from '../core/llmFactory';
import { NewsPlugin } from '../plugins/news';
import { GNewsTopicPlugin } from '../plugins/gnewsTopic';
import { GNewsSportsPlugin } from '../plugins/gnewsSports';
import { PodcastPlugin } from '../plugins/podcast';
import * as collector from './collector';
import * as digestBuilder from './digestBuilder';
import * as deliveryWorker from './deliveryWorker';

const DB_PATH = path.resolve(__dirname, '../../vibebot.db');

interface EmbeddingsConfig {
  provider: string;
  model: string;
}

interface TopicPluginConfig {
  enabled?: boolean;
  feed_url: string;
  story_count?: number;
  embeddings: EmbeddingsConfig;
}

interface SportsPluginConfig {
  enabled?: boolean;
  feeds: {
    f1: string;
    soccer: string;
    cricket: string;
    tennis: string;
  };
  embeddings: EmbeddingsConfig;
}

interface PodcastPluginConfig {
  enabled?: boolean;
  tts_url?: string;
  voice?: string;
  model?: string;
  output_dir?: string;
  digest_types?: string[];
}

interface Config {
  plugins?: Record<string, { enabled?: boolean; article_count?: number } & Partial<TopicPluginConfig> & Partial<SportsPluginConfig> & Partial<PodcastPluginConfig>>;
  llm?: { provider?: string; model?: string };
  delivery?: { max_retries?: number };
}

const TOPIC_PLUGINS = ['us_news', 'world_news', 'india_news', 'tech_news', 'stocks_news'];

export async function runPipeline(config: Config, pluginFilter?: string): Promise<void> {
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
    } else if (TOPIC_PLUGINS.includes(name)) {
      const topicCfg = cfg as TopicPluginConfig;
      plugins.push(new GNewsTopicPlugin({
        pluginName: name,
        feedUrl: topicCfg.feed_url,
        storyCount: topicCfg.story_count ?? 3,
        embeddings: topicCfg.embeddings,
      }));
    } else if (name === 'sports') {
      const sportsCfg = cfg as SportsPluginConfig;
      plugins.push(new GNewsSportsPlugin({
        feeds: sportsCfg.feeds,
        embeddings: sportsCfg.embeddings,
      }));
    } else if (name === 'podcast') {
      const podcastCfg = cfg as PodcastPluginConfig;
      plugins.push(new PodcastPlugin({
        ttsUrl: podcastCfg.tts_url ?? 'http://localhost:8080',
        voice: podcastCfg.voice ?? 'af_heart',
        model: podcastCfg.model ?? 'mlx-community/Kokoro-82M-bf16',
        outputDir: podcastCfg.output_dir ?? '~/VibeBot-Podcasts',
        digestTypes: podcastCfg.digest_types ?? [
          'us_news_digest', 'world_news_digest', 'india_news_digest',
          'sports_digest', 'tech_news_digest', 'stocks_news_digest',
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

  console.info('Stage 1: Collecting raw data.');
  await collector.run(activePlugins, db);

  console.info('Stage 2: Building digests.');
  await digestBuilder.run(activePlugins, db, llm);

  console.info('Stage 3: Delivering messages.');
  await deliveryWorker.run(db);

  db.close();
}
