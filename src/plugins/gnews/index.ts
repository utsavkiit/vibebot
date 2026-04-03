import { fetchGNewsHeadlines, GNewsHeadline } from './rssParser';
import { getEmbedder, EmbedderConfig } from './embedder';

export interface GNewsFetcherConfig {
  feedUrl: string;
  articleCount: number;
  embeddings: EmbedderConfig;
}

export interface HeadlineWithEmbedding {
  title: string;
  url: string;
  source: string;
  published_at: string;
  description: string;
  fetched_at: string;
  vector: number[];
}

export interface FetchResult {
  fetched: number;
  headlines: HeadlineWithEmbedding[];
}

const EMBED_CHUNK_SIZE = 20;

export class GNewsFetcher {
  constructor(private config: GNewsFetcherConfig) {}

  async run(): Promise<FetchResult> {
    const headlines: GNewsHeadline[] = await fetchGNewsHeadlines(
      this.config.feedUrl,
      this.config.articleCount,
    );

    if (headlines.length === 0) {
      return { fetched: 0, headlines: [] };
    }

    const embedder = getEmbedder(this.config.embeddings);
    const texts = headlines.map((h) => h.description || `${h.title} — ${h.source}`);

    // Embed in chunks to avoid timeouts with local models
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_CHUNK_SIZE) {
      const chunk = texts.slice(i, i + EMBED_CHUNK_SIZE);
      const chunkVectors = await embedder.embedDocuments(chunk);
      vectors.push(...chunkVectors);
    }

    const now = new Date().toISOString();
    const result: HeadlineWithEmbedding[] = headlines.map((h, i) => ({
      ...h,
      fetched_at: now,
      vector: vectors[i],
    }));

    return { fetched: result.length, headlines: result };
  }
}
