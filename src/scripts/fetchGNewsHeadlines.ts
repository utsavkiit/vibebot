import path from 'path';
import fs from 'fs';
import * as dotenv from 'dotenv';
import * as yaml from 'js-yaml';
import { GNewsFetcher, HeadlineWithEmbedding } from '../plugins/gnews/index';

interface FeedConfig {
  name: string;
  url: string;
}

interface NewsCollectorConfig {
  fetch_count?: number;
  embeddings: {
    provider: string;
    model: string;
  };
  feeds: FeedConfig[];
}

interface AppConfig {
  plugins?: {
    news_collector?: NewsCollectorConfig;
  };
}

const repoRoot = path.resolve(__dirname, '../..');

async function main(): Promise<void> {
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const configPath = path.join(repoRoot, 'config.yaml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as AppConfig;

  const collectorCfg = config.plugins?.news_collector;
  if (!collectorCfg?.feeds?.length) {
    console.error('No news_collector feeds configured in config.yaml.');
    process.exit(1);
  }

  const articleCount = collectorCfg.fetch_count ?? 50;
  const allHeadlines: HeadlineWithEmbedding[] = [];

  for (const feed of collectorCfg.feeds) {
    console.info(`Fetching feed: ${feed.name} (${feed.url})`);
    const fetcher = new GNewsFetcher({
      feedUrl: feed.url,
      articleCount,
      embeddings: collectorCfg.embeddings,
    });
    const result = await fetcher.run();
    console.info(`  → ${result.fetched} headlines`);
    allHeadlines.push(...result.headlines);
  }

  console.info(`\nTotal: ${allHeadlines.length} headlines across ${collectorCfg.feeds.length} feeds.`);
  if (allHeadlines.length === 0) return;

  const outputPath = path.join(repoRoot, 'gnews_headlines.json');
  fs.writeFileSync(outputPath, JSON.stringify(allHeadlines, null, 2), 'utf8');
  console.info(`Saved to ${outputPath}`);
  console.info(`Vector dimensions: ${allHeadlines[0].vector.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
