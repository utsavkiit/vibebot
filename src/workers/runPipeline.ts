import path from 'path';
import { getConnection, initDb } from '../core/db';
import { getLlm } from '../core/llmFactory';
import { NewsPlugin } from '../plugins/news';
import { PorscheMacanPlugin } from '../plugins/porscheMacan';
import * as collector from './collector';
import * as digestBuilder from './digestBuilder';
import * as deliveryWorker from './deliveryWorker';

const DB_PATH = path.resolve(__dirname, '../../vibebot.db');

interface PluginConfig {
  enabled?: boolean;
  article_count?: number;
  zip?: string;
  distance_miles?: number;
  year_min?: number;
  year_max?: number;
  max_price?: number;
  max_mileage?: number;
  listing_count?: number;
}

interface Config {
  plugins?: Record<string, PluginConfig>;
  llm?: { provider?: string; model?: string };
  delivery?: { max_retries?: number };
}

export async function runPipeline(config: Config): Promise<void> {
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
    } else if (name === 'porsche_macan') {
      plugins.push(
        new PorscheMacanPlugin(
          cfg.zip ?? '29715',
          cfg.distance_miles ?? 50,
          cfg.year_min ?? 2022,
          cfg.year_max ?? 2026,
          cfg.max_price ?? 55000,
          cfg.max_mileage ?? 25000,
          cfg.listing_count ?? 5,
        ),
      );
    } else {
      console.warn(`Plugin '${name}' is enabled but not registered — skipping.`);
    }
  }

  if (!plugins.length) {
    console.warn('No plugins enabled — nothing to run.');
    db.close();
    return;
  }

  const llm = getLlm(llmCfg.provider ?? 'anthropic', llmCfg.model ?? 'claude-haiku-4-5-20251001');

  console.info('Stage 1: Collecting raw data.');
  await collector.run(plugins, db);

  console.info('Stage 2: Building digests.');
  await digestBuilder.run(plugins, db, llm);

  console.info('Stage 3: Delivering messages.');
  await deliveryWorker.run(db);

  db.close();
}
