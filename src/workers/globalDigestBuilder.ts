import Database from 'better-sqlite3';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getAllPendingRawItems, getAllRawItemsForDate, insertOutboundMessage, markRawItemProcessed, RawItem } from '../core/db';
import { buildHeader, buildFooter } from '../core/messageUtils';
import { clusterByTopic, TopicGroup } from '../plugins/gnews/clusterer';
import { summarizeGroup } from '../plugins/gnews/groupSummarizer';
import { HeadlineWithEmbedding } from '../plugins/gnews/index';

export type RankedCluster = TopicGroup & { feedCount: number; bestTier: number };

const SOURCE_LABELS: Record<string, string> = {
  us_news: '🇺🇸 US',
  world_news: '🌍 World',
  india_news: '🇮🇳 India',
  tech_news: '💻 Tech',
  stocks_news: '📈 Stocks',
};

const SPORT_LABELS: Record<string, string> = {
  sports_f1: '🏎️ F1',
  sports_soccer: '⚽ Soccer',
  sports_cricket: '🏏 Cricket',
  sports_tennis: '🎾 Tennis',
};

const SOURCE_PRIORITY: string[] = [
  // Tier 1 — wire services (most authoritative, least sensational)
  'reuters', 'associated press', 'ap news',
  // Tier 2 — top global broadcasters / newspapers
  'the new york times', 'the washington post', 'wsj', 'wall street journal',
  'bbc', 'the guardian', 'financial times', 'bloomberg', 'the economist',
  'npr', 'pbs',
  // Tier 3 — top Indian sources
  'ndtv', 'times of india', 'timesofindia', 'times now', 'the hindu', 'hindustan times',
  // Tier 4 — other major US outlets
  'cnn', 'abc news', 'cbs news', 'nbc news', 'msnbc',
  'politico', 'axios', 'the hill',
  // Tier 5 — tech press
  'ars technica', 'wired', 'techcrunch', 'the verge',
];

function sourceTier(source: string): number {
  const lower = source.toLowerCase();
  const idx = SOURCE_PRIORITY.findIndex((s) => lower.includes(s));
  return idx === -1 ? SOURCE_PRIORITY.length : idx;
}

function pickBestUrl(headlines: HeadlineWithEmbedding[]): string {
  const sorted = [...headlines].sort((a, b) => {
    const tierDiff = sourceTier(a.source) - sourceTier(b.source);
    if (tierDiff !== 0) return tierDiff;
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
  });
  return sorted[0].url;
}

function parseEmbeddedItems(rawItems: RawItem[]): {
  embeddedItems: Array<{ item: RawItem; headline: HeadlineWithEmbedding }>;
  sportsItems: Array<{ item: RawItem; sourceType: string; headline: HeadlineWithEmbedding }>;
} {
  const embeddedItems: Array<{ item: RawItem; headline: HeadlineWithEmbedding }> = [];
  const sportsItems: Array<{ item: RawItem; sourceType: string; headline: HeadlineWithEmbedding }> = [];

  for (const item of rawItems) {
    if (item.source_type === 'podcast') continue;
    const payload = JSON.parse(item.payload) as HeadlineWithEmbedding;
    if (item.source_type.startsWith('sports_')) {
      sportsItems.push({ item, sourceType: item.source_type, headline: payload });
    } else {
      embeddedItems.push({ item, headline: payload });
    }
  }

  return { embeddedItems, sportsItems };
}

/**
 * Cluster all headlines cross-feed at a high threshold (0.85) to catch only
 * genuine same-story duplicates, then rank by:
 *   1. Number of unique feeds represented (cross-regional stories first)
 *   2. Cluster size (more coverage = more important)
 *   3. Best source tier in the cluster (more credible sources rank higher)
 */
function computeRankedClusters(
  embeddedItems: Array<{ item: RawItem; headline: HeadlineWithEmbedding }>,
): RankedCluster[] {
  const urlToFeed = new Map<string, string>();
  const seen = new Set<string>();
  const deduped: typeof embeddedItems = [];
  for (const e of embeddedItems) {
    if (seen.has(e.headline.url)) continue;
    seen.add(e.headline.url);
    urlToFeed.set(e.headline.url, e.item.source_type);
    deduped.push(e);
  }

  const allHeadlines = deduped.map((e) => e.headline);
  const groups = clusterByTopic(allHeadlines, 0.85);

  const ranked: RankedCluster[] = groups.map((g) => {
    const feedCount = new Set(g.headlines.map((h) => urlToFeed.get(h.url))).size;
    const bestTier = Math.min(...g.headlines.map((h) => sourceTier(h.source)));
    return { ...g, feedCount, bestTier };
  });

  ranked.sort((a, b) => {
    if (b.feedCount !== a.feedCount) return b.feedCount - a.feedCount;
    if (b.headlines.length !== a.headlines.length) return b.headlines.length - a.headlines.length;
    return a.bestTier - b.bestTier;
  });

  return ranked;
}

export interface GlobalDigestConfig {
  storyCount: number;
}

export class GlobalDigestBuilder {
  private storyCount: number;

  constructor(config: GlobalDigestConfig) {
    this.storyCount = config.storyCount;
  }

  /** Cluster and rank all pending news items. Called once per pipeline run, shared with podcast. */
  getRankedClusters(db: Database.Database): RankedCluster[] {
    const rawItems = getAllPendingRawItems(db);
    const { embeddedItems } = parseEmbeddedItems(rawItems);
    return computeRankedClusters(embeddedItems);
  }

  /** Build Slack digest from pre-computed ranked clusters, then mark all pending items processed. */
  async buildFromClusters(ranked: RankedCluster[], db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const rawItems = getAllPendingRawItems(db);
    if (!rawItems.length) {
      console.info('GlobalDigestBuilder: no pending items.');
      return null;
    }

    const { embeddedItems, sportsItems } = parseEmbeddedItems(rawItems);
    const urlToSourceType = new Map<string, string>();
    for (const { item, headline } of embeddedItems) {
      urlToSourceType.set(headline.url, item.source_type);
    }

    const blocks = await this.buildBlocksFromClusters(ranked, sportsItems, urlToSourceType, llm);

    const msgId = insertOutboundMessage(db, 'slack_default', 'global_digest', blocks, 3);
    for (const item of rawItems) markRawItemProcessed(db, item.id);

    console.info(`GlobalDigestBuilder: digest built → outbound_message id=${msgId}.`);
    return msgId;
  }

  /** Convenience method: cluster + build in one step (used by preview). */
  async run(db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const ranked = this.getRankedClusters(db);
    return this.buildFromClusters(ranked, db, llm);
  }

  inspectClusters(db: Database.Database): void {
    const rawItems = getAllPendingRawItems(db);

    if (!rawItems.length) {
      console.info('No pending items in DB. Run without --inspect first to collect.');
      return;
    }

    const { embeddedItems, sportsItems } = parseEmbeddedItems(rawItems);

    console.info(`\n=== CLUSTER INSPECTION (${rawItems.length} total items) ===\n`);
    console.info(`Non-sports: ${embeddedItems.length} items  |  Sports: ${sportsItems.length} items\n`);

    if (embeddedItems.length > 0) {
      const ranked = computeRankedClusters(embeddedItems);

      console.info(`Clusters formed: ${ranked.length}  (showing top ${this.storyCount})\n`);
      console.info('--- TOP CLUSTERS ---');

      const topGroups = ranked.slice(0, this.storyCount);
      for (let i = 0; i < topGroups.length; i++) {
        const g = topGroups[i];
        const sources = [...new Set(g.headlines.map((h) => h.source))];
        const feedLabel = g.feedCount > 1 ? `${g.feedCount} feeds` : '1 feed';
        console.info(`\n[${i + 1}] (${g.headlines.length} articles, ${feedLabel}) ${g.label}`);
        for (const h of g.headlines) {
          const label = SOURCE_LABELS[embeddedItems.find((e) => e.headline.url === h.url)?.item.source_type ?? ''] ?? '';
          console.info(`    ${label} ${h.title}  — ${h.source}`);
        }
        console.info(`    Sources: ${sources.join(', ')}`);
      }

      if (ranked.length > this.storyCount) {
        console.info(`\n--- REMAINING ${ranked.length - this.storyCount} CLUSTERS (dropped) ---`);
        for (const g of ranked.slice(this.storyCount)) {
          const feedLabel = g.feedCount > 1 ? `${g.feedCount} feeds` : '1 feed';
          console.info(`  (${g.headlines.length} articles, ${feedLabel}) ${g.label}`);
        }
      }
    }

    if (sportsItems.length > 0) {
      console.info('\n--- SPORTS ITEMS ---');
      for (const { sourceType, headline } of sportsItems) {
        const label = SPORT_LABELS[sourceType] ?? sourceType;
        console.info(`  ${label}  ${headline.title}  — ${headline.source}`);
      }
    }

    console.info('\n=== END INSPECTION ===\n');
  }

  async preview(db: Database.Database, llm: BaseChatModel, date: string): Promise<void> {
    const rawItems = getAllRawItemsForDate(db, date);
    const newsItems = rawItems.filter((i) => !['news', 'podcast'].includes(i.source_type));

    if (!newsItems.length) {
      console.info(`No items found for ${date}.`);
      return;
    }

    console.info(`Preview: building digest from ${newsItems.length} items collected on ${date}...`);
    const { embeddedItems, sportsItems } = parseEmbeddedItems(newsItems);
    const ranked = computeRankedClusters(embeddedItems);
    const urlToSourceType = new Map<string, string>();
    for (const { item, headline } of embeddedItems) {
      urlToSourceType.set(headline.url, item.source_type);
    }
    const blocks = await this.buildBlocksFromClusters(ranked, sportsItems, urlToSourceType, llm);
    console.info('\n--- DIGEST PREVIEW ---');
    console.info(JSON.stringify(blocks, null, 2));
    console.info('--- END PREVIEW ---\n');
  }

  private async buildBlocksFromClusters(
    ranked: RankedCluster[],
    sportsItems: Array<{ item: RawItem; sourceType: string; headline: HeadlineWithEmbedding }>,
    urlToSourceType: Map<string, string>,
    llm: BaseChatModel,
  ): Promise<object[]> {
    const blocks: object[] = [...buildHeader(), { type: 'divider' }];

    const topGroups = ranked.slice(0, this.storyCount);
    for (let i = 0; i < topGroups.length; i++) {
      const group = topGroups[i];
      const { headline, summary, emoji } = await summarizeGroup(llm, group.headlines);
      const url = pickBestUrl(group.headlines);
      const sources = [...new Set(group.headlines.map((h) => h.source))].join(', ');

      const topicLabels = [
        ...new Set(
          group.headlines
            .map((h) => SOURCE_LABELS[urlToSourceType.get(h.url) ?? ''] ?? '')
            .filter(Boolean),
        ),
      ].join(' · ');

      let cardText = `${emoji} *${i + 1}. <${url}|${headline}>*`;
      if (summary) cardText += `\n${summary}`;
      const metaParts: string[] = [];
      if (group.headlines.length > 1) metaParts.push(`${group.headlines.length} sources`);
      if (topicLabels) metaParts.push(topicLabels);
      if (metaParts.length) cardText += `\n_${metaParts.join(' · ')}_`;

      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: cardText } });
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `📌 ${sources}` }] });
      if (i < topGroups.length - 1 || sportsItems.length > 0) {
        blocks.push({ type: 'divider' });
      }
    }

    if (sportsItems.length > 0) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*🏆 Sports*' } });
      blocks.push({ type: 'divider' });

      for (let i = 0; i < sportsItems.length; i++) {
        const { sourceType, headline } = sportsItems[i];
        const label = SPORT_LABELS[sourceType] ?? sourceType;
        const { headline: summaryHeadline, summary, emoji } = await summarizeGroup(llm, [headline]);

        let cardText = `*${label}*\n${emoji} *<${headline.url}|${summaryHeadline}>*`;
        if (summary) cardText += `\n${summary}`;

        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: cardText } });
        blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `📌 ${headline.source}` }] });
        if (i < sportsItems.length - 1) blocks.push({ type: 'divider' });
      }
    }

    blocks.push(...buildFooter());
    return blocks;
  }
}
