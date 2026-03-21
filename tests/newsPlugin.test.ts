import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { initDb, getConnection } from '../src/core/db';
import { NewsPlugin } from '../src/plugins/news';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

vi.mock('../src/plugins/news/fetcher');
vi.mock('../src/plugins/news/summarizer');
vi.mock('../src/plugins/news/ogImage');

import { fetchTopArticles } from '../src/plugins/news/fetcher';
import { summarizeArticle } from '../src/plugins/news/summarizer';
import { fetchOgImage } from '../src/plugins/news/ogImage';

const FAKE_ARTICLES = [
  {
    title: 'Headline One',
    description: 'Desc one.',
    url: 'https://example.com/1',
    source: 'Source A',
    published_at: '2026-03-07T09:00:00Z',
  },
  {
    title: 'Headline Two',
    description: 'Desc two.',
    url: 'https://example.com/2',
    source: 'Source B',
    published_at: '2026-03-07T09:00:00Z',
  },
];

const MOCK_LLM = {} as BaseChatModel;

let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dbPath = join(tmpdir(), `vibebot-plugin-test-${Date.now()}-${Math.random()}.db`);
  initDb(dbPath);
  db = getConnection(dbPath);
  vi.clearAllMocks();
  vi.mocked(fetchOgImage).mockResolvedValue(null);
  vi.mocked(summarizeArticle).mockResolvedValue(['Summary.', 'Why.', '📰']);
});

afterEach(() => {
  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('NewsPlugin.collect', () => {
  it('returns count of new (non-duplicate) items', async () => {
    vi.mocked(fetchTopArticles).mockResolvedValue(FAKE_ARTICLES);

    const plugin = new NewsPlugin(2);
    const count = await plugin.collect(db);

    expect(count).toBe(2);
  });

  it('skips duplicate articles', async () => {
    vi.mocked(fetchTopArticles).mockResolvedValue(FAKE_ARTICLES);

    const plugin = new NewsPlugin(2);
    await plugin.collect(db); // first run inserts 2
    const count = await plugin.collect(db); // second run: both duplicates

    expect(count).toBe(0);
  });

  it('calls fetchTopArticles for each article', async () => {
    vi.mocked(fetchTopArticles).mockResolvedValue(FAKE_ARTICLES);
    const plugin = new NewsPlugin(2);
    await plugin.collect(db);
    expect(fetchTopArticles).toHaveBeenCalledOnce();
  });
});

describe('NewsPlugin.buildDigest', () => {
  it('returns null when there are no pending items', async () => {
    const plugin = new NewsPlugin();
    const result = await plugin.buildDigest(db, MOCK_LLM);
    expect(result).toBeNull();
  });

  it('returns a message id when digest is built', async () => {
    vi.mocked(fetchTopArticles).mockResolvedValue(FAKE_ARTICLES);
    const plugin = new NewsPlugin(2);
    await plugin.collect(db);

    const msgId = await plugin.buildDigest(db, MOCK_LLM);

    expect(typeof msgId).toBe('number');
    expect(msgId).toBeGreaterThan(0);
  });

  it('calls summarizeArticle for each article', async () => {
    vi.mocked(fetchTopArticles).mockResolvedValue(FAKE_ARTICLES);
    const plugin = new NewsPlugin(2);
    await plugin.collect(db);
    await plugin.buildDigest(db, MOCK_LLM);

    expect(summarizeArticle).toHaveBeenCalledTimes(2);
  });

  it('marks all items as processed after building', async () => {
    vi.mocked(fetchTopArticles).mockResolvedValue(FAKE_ARTICLES);
    const plugin = new NewsPlugin(2);
    await plugin.collect(db);
    await plugin.buildDigest(db, MOCK_LLM);

    const pending = db
      .prepare("SELECT * FROM raw_items WHERE status = 'pending'")
      .all();
    expect(pending).toHaveLength(0);
  });

  it('payload contains article content', async () => {
    vi.mocked(fetchTopArticles).mockResolvedValue(FAKE_ARTICLES);
    const plugin = new NewsPlugin(2);
    await plugin.collect(db);
    const msgId = await plugin.buildDigest(db, MOCK_LLM);

    const row = db
      .prepare('SELECT payload FROM outbound_messages WHERE id = ?')
      .get(msgId) as { payload: string };
    const allText = row.payload;
    // summarizeArticle mock returns ['Summary.', 'Why.', '📰'] — the headline in the
    // payload is what the LLM returns, not the raw article title.
    expect(allText).toContain('Summary.');
    expect(allText).toContain('Source A');
  });
});
