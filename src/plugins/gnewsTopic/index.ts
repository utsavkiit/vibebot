import crypto from 'crypto';
import Database from 'better-sqlite3';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BasePlugin } from '../../core/basePlugin';
import {
  getPendingRawItems,
  insertOutboundMessage,
  insertRawItem,
  markRawItemProcessed,
} from '../../core/db';
import { buildHeader, buildFooter } from '../../core/messageUtils';
import { fetchGNewsHeadlines } from '../gnews/rssParser';
import { getEmbedder, EmbedderConfig } from '../gnews/embedder';
import { clusterByTopic } from '../gnews/clusterer';
import { summarizeGroup } from '../gnews/groupSummarizer';
import { HeadlineWithEmbedding } from '../gnews/index';

export interface GNewsTopicConfig {
  pluginName: string;
  feedUrl: string;
  storyCount: number;
  embeddings: EmbedderConfig;
}

// Ordered by trust tier — earlier index = more reputable. Case-insensitive substring match.
const SOURCE_PRIORITY: string[] = [
  'reuters', 'associated press', 'ap news',
  'bbc', 'npr', 'pbs',
  'the new york times', 'the washington post', 'the guardian', 'wsj', 'wall street journal',
  'financial times', 'bloomberg', 'the economist',
  'cnn', 'abc news', 'cbs news', 'nbc news', 'msnbc',
  'politico', 'axios', 'the hill',
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

const TOPIC_LABELS: Record<string, string> = {
  us_news: '🇺🇸 US News',
  world_news: '🌍 World News',
  india_news: '🇮🇳 India News',
  tech_news: '💻 Tech News',
  stocks_news: '📈 US Stock Market',
};

const FETCH_COUNT = 50;
const EMBED_CHUNK_SIZE = 20;

export class GNewsTopicPlugin extends BasePlugin {
  readonly name: string;
  private config: GNewsTopicConfig;

  constructor(config: GNewsTopicConfig) {
    super();
    this.name = config.pluginName;
    this.config = config;
  }

  async collect(db: Database.Database): Promise<number> {
    const headlines = await fetchGNewsHeadlines(this.config.feedUrl, FETCH_COUNT);
    if (!headlines.length) return 0;

    const embedder = getEmbedder(this.config.embeddings);
    const texts = headlines.map((h) => h.description || `${h.title} — ${h.source}`);

    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_CHUNK_SIZE) {
      const chunk = texts.slice(i, i + EMBED_CHUNK_SIZE);
      vectors.push(...(await embedder.embedDocuments(chunk)));
    }

    const now = new Date().toISOString();
    let newCount = 0;
    for (let i = 0; i < headlines.length; i++) {
      const payload: HeadlineWithEmbedding = { ...headlines[i], fetched_at: now, vector: vectors[i] };
      const externalId = crypto.createHash('md5').update(headlines[i].url).digest('hex');
      if (insertRawItem(db, this.name, externalId, payload)) {
        newCount++;
      }
    }
    return newCount;
  }

  async buildDigest(db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const items = getPendingRawItems(db, this.name);

    if (!items.length) {
      const blocks = this.buildPlaceholderBlocks();
      return insertOutboundMessage(db, 'slack_default', `${this.name}_digest`, blocks, 3);
    }

    const headlines: HeadlineWithEmbedding[] = items.map((item) =>
      JSON.parse(item.payload) as HeadlineWithEmbedding,
    );

    const groups = clusterByTopic(headlines, 0.70);
    const topGroups = groups.slice(0, this.config.storyCount);

    const label = TOPIC_LABELS[this.name] ?? this.name;
    const blocks: object[] = [
      ...buildHeader(),
      { type: 'section', text: { type: 'mrkdwn', text: `*${label}*` } },
      { type: 'divider' },
    ];

    for (let i = 0; i < topGroups.length; i++) {
      const group = topGroups[i];
      const { headline, summary, emoji } = await summarizeGroup(llm, group.headlines);
      const url = pickBestUrl(group.headlines);
      const sources = [...new Set(group.headlines.map((h) => h.source))].join(', ');

      let cardText = `${emoji} *${i + 1}. <${url}|${headline}>*`;
      if (summary) cardText += `\n${summary}`;
      if (group.headlines.length > 1) cardText += `\n_${group.headlines.length} sources_`;

      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: cardText } });
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `📌 ${sources}` }] });
      if (i < topGroups.length - 1) blocks.push({ type: 'divider' });
    }

    blocks.push(...buildFooter());

    const msgId = insertOutboundMessage(db, 'slack_default', `${this.name}_digest`, blocks, 3);
    for (const item of items) markRawItemProcessed(db, item.id);
    return msgId;
  }

  private buildPlaceholderBlocks(): object[] {
    const label = TOPIC_LABELS[this.name] ?? this.name;
    return [
      ...buildHeader(),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${label}*\n_No new stories to report today._` },
      },
      ...buildFooter(),
    ];
  }
}
