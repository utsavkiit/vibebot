import crypto from 'crypto';
import Database from 'better-sqlite3';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BasePlugin } from '../../core/basePlugin';
import { insertRawItem } from '../../core/db';
import { fetchGNewsHeadlines } from '../gnews/rssParser';
import { getEmbedder, EmbedderConfig } from '../gnews/embedder';
import { HeadlineWithEmbedding } from '../gnews/index';

export interface FeedConfig {
  name: string;
  url: string;
}

export interface NewsCollectorConfig {
  feeds: FeedConfig[];
  fetchCount: number;
  embeddings: EmbedderConfig;
}

const EMBED_CHUNK_SIZE = 20;

export class NewsCollectorPlugin extends BasePlugin {
  readonly name = 'news_collector';
  private config: NewsCollectorConfig;

  constructor(config: NewsCollectorConfig) {
    super();
    this.config = config;
  }

  async collect(db: Database.Database): Promise<number> {
    const embedder = getEmbedder(this.config.embeddings);
    let totalNew = 0;
    const now = new Date().toISOString();

    for (const feed of this.config.feeds) {
      const headlines = await fetchGNewsHeadlines(feed.url, this.config.fetchCount);
      if (!headlines.length) continue;

      const texts = headlines.map((h) => h.description || `${h.title} — ${h.source}`);
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_CHUNK_SIZE) {
        const chunk = texts.slice(i, i + EMBED_CHUNK_SIZE);
        vectors.push(...(await embedder.embedDocuments(chunk)));
      }

      for (let i = 0; i < headlines.length; i++) {
        const payload: HeadlineWithEmbedding = { ...headlines[i], fetched_at: now, vector: vectors[i] };
        const externalId = crypto.createHash('md5').update(headlines[i].url).digest('hex');
        if (insertRawItem(db, feed.name, externalId, payload)) {
          totalNew++;
        }
      }
    }

    return totalNew;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async buildDigest(_db: Database.Database, _llm: BaseChatModel): Promise<number | null> {
    // Digest building is handled by GlobalDigestBuilder
    return null;
  }
}
