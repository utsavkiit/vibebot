import path from 'path';
import fs from 'fs';
import * as dotenv from 'dotenv';
import * as yaml from 'js-yaml';
import { GNewsFetcher } from '../plugins/gnews/index';

interface GNewsPluginConfig {
  enabled?: boolean;
  article_count?: number;
  feed_url?: string;
  embeddings: {
    provider: string;
    model: string;
  };
}

interface AppConfig {
  plugins?: {
    gnews?: GNewsPluginConfig;
  };
}

const repoRoot = path.resolve(__dirname, '../..');

async function main(): Promise<void> {
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const configPath = path.join(repoRoot, 'config.yaml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as AppConfig;

  const gnewsCfg = config.plugins?.gnews;
  if (!gnewsCfg?.enabled) {
    console.info('gnews plugin is disabled in config.yaml — exiting.');
    process.exit(0);
  }

  const fetcher = new GNewsFetcher({
    feedUrl: gnewsCfg.feed_url ?? 'https://news.google.com/rss',
    articleCount: gnewsCfg.article_count ?? 50,
    embeddings: gnewsCfg.embeddings,
  });

  console.info('Fetching headlines and generating embeddings...');
  const result = await fetcher.run();

  console.info(`Done. Fetched: ${result.fetched} headlines with embeddings.`);
  if (result.headlines.length === 0) return;

  // Save to JSON for downstream use (grouping, clustering, etc.)
  const outputPath = path.join(repoRoot, 'gnews_headlines.json');
  fs.writeFileSync(outputPath, JSON.stringify(result.headlines, null, 2), 'utf8');
  console.info(`Saved to ${outputPath}`);
  console.info(`Vector dimensions: ${result.headlines[0].vector.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
