import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Embeddings } from '@langchain/core/embeddings';

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted by Vitest before any imports)
// ---------------------------------------------------------------------------

// rss-parser: controlled per-test via mockParseURL
const mockParseURL = vi.fn();
vi.mock('rss-parser', () => ({
  default: vi.fn().mockImplementation(() => ({ parseURL: mockParseURL })),
}));

// LangChain providers: controlled per-test via their constructor spies
const MockOllamaEmbeddings = vi.fn();
vi.mock('@langchain/ollama', () => ({ OllamaEmbeddings: MockOllamaEmbeddings }));

const MockOpenAIEmbeddings = vi.fn();
vi.mock('@langchain/openai', () => ({ OpenAIEmbeddings: MockOpenAIEmbeddings }));

// gnews/embedder: in GNewsFetcher tests we inject a fully fake embedder
const mockGetEmbedder = vi.fn();
vi.mock('../src/plugins/gnews/embedder', () => ({ getEmbedder: mockGetEmbedder }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockEmbedder(dims = 8): Embeddings {
  return {
    embedDocuments: vi.fn(async (texts: string[]) =>
      texts.map((_, i) => Array.from({ length: dims }, (__, d) => i * dims + d + 0.1)),
    ),
    embedQuery: vi.fn(async () => Array.from({ length: dims }, (_, d) => d + 0.1)),
  } as unknown as Embeddings;
}

const SAMPLE_RSS_ITEMS = [
  {
    title: 'Markets rally on rate cut hopes',
    link: 'https://example.com/article/1',
    pubDate: 'Sat, 21 Mar 2026 09:00:00 GMT',
    contentSnippet: 'Stocks rose sharply Friday.',
    source: { _: 'Reuters' },
  },
  {
    title: 'Tech giants face new antitrust probe',
    link: 'https://example.com/article/2',
    pubDate: 'Sat, 21 Mar 2026 08:00:00 GMT',
    contentSnippet: 'Regulators announced a wide-ranging inquiry.',
    source: { _: 'BBC News' },
  },
  {
    title: 'Climate summit ends with landmark deal',
    link: 'https://example.com/article/3',
    pubDate: 'Sat, 21 Mar 2026 07:00:00 GMT',
    contentSnippet: 'Nations agreed to cut emissions by 50% by 2040.',
    source: 'AP',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// rssParser
// ---------------------------------------------------------------------------

describe('fetchGNewsHeadlines', () => {
  it('returns parsed headlines from RSS feed', async () => {
    mockParseURL.mockResolvedValue({ items: SAMPLE_RSS_ITEMS });
    const { fetchGNewsHeadlines } = await import('../src/plugins/gnews/rssParser');
    const headlines = await fetchGNewsHeadlines('https://news.google.com/rss', 10);

    expect(headlines).toHaveLength(3);
    expect(headlines[0].title).toBe('Markets rally on rate cut hopes');
    expect(headlines[0].url).toBe('https://example.com/article/1');
    expect(headlines[0].source).toBe('Reuters');
    expect(headlines[0].published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(headlines[2].source).toBe('AP');
  });

  it('respects the count limit', async () => {
    mockParseURL.mockResolvedValue({ items: SAMPLE_RSS_ITEMS });
    const { fetchGNewsHeadlines } = await import('../src/plugins/gnews/rssParser');
    const headlines = await fetchGNewsHeadlines('https://news.google.com/rss', 2);
    expect(headlines).toHaveLength(2);
  });

  it('deduplicates items with the same URL', async () => {
    const dupeItems = [...SAMPLE_RSS_ITEMS, { ...SAMPLE_RSS_ITEMS[0] }];
    mockParseURL.mockResolvedValue({ items: dupeItems });
    const { fetchGNewsHeadlines } = await import('../src/plugins/gnews/rssParser');
    const headlines = await fetchGNewsHeadlines('https://news.google.com/rss', 10);
    expect(headlines).toHaveLength(3);
  });

  it('skips items missing title or url', async () => {
    const badItems = [
      { title: '', link: 'https://example.com/a', pubDate: '', source: 'Foo' },
      { title: 'Good title', link: '', pubDate: '', source: 'Bar' },
      SAMPLE_RSS_ITEMS[0],
    ];
    mockParseURL.mockResolvedValue({ items: badItems });
    const { fetchGNewsHeadlines } = await import('../src/plugins/gnews/rssParser');
    const headlines = await fetchGNewsHeadlines('https://news.google.com/rss', 10);
    expect(headlines).toHaveLength(1);
    expect(headlines[0].title).toBe('Markets rally on rate cut hopes');
  });

  it('returns empty array when feed has no items', async () => {
    mockParseURL.mockResolvedValue({ items: [] });
    const { fetchGNewsHeadlines } = await import('../src/plugins/gnews/rssParser');
    const headlines = await fetchGNewsHeadlines('https://news.google.com/rss', 10);
    expect(headlines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// embedder
// ---------------------------------------------------------------------------

describe('getEmbedder', () => {
  // vi.importActual bypasses the top-level vi.mock so we test the real implementation,
  // while @langchain/ollama and @langchain/openai are still intercepted by their own
  // top-level mocks.
  async function realGetEmbedder() {
    const mod = await vi.importActual<typeof import('../src/plugins/gnews/embedder')>(
      '../src/plugins/gnews/embedder',
    );
    return mod.getEmbedder;
  }

  it('creates OllamaEmbeddings for provider=ollama', async () => {
    // embedder.ts uses require() at call-time (CJS, not interceptable by vi.mock).
    // Verify the real OllamaEmbeddings is constructed and exposes the Embeddings interface.
    const getEmbedder = await realGetEmbedder();
    const embedder = getEmbedder({ provider: 'ollama', model: 'nomic-embed-text' });
    expect(typeof embedder.embedDocuments).toBe('function');
    expect(typeof embedder.embedQuery).toBe('function');
  });

  it('creates OpenAIEmbeddings for provider=openai when key is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
    const getEmbedder = await realGetEmbedder();
    const embedder = getEmbedder({ provider: 'openai', model: 'text-embedding-3-small' });
    expect(typeof embedder.embedDocuments).toBe('function');
    expect(typeof embedder.embedQuery).toBe('function');
  });

  it('throws if provider=openai but OPENAI_API_KEY is missing', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const getEmbedder = await realGetEmbedder();
    expect(() => getEmbedder({ provider: 'openai', model: 'text-embedding-3-small' })).toThrow(
      'OPENAI_API_KEY',
    );
  });

  it('throws for unsupported provider', async () => {
    const getEmbedder = await realGetEmbedder();
    expect(() => getEmbedder({ provider: 'cohere', model: 'embed-v3' })).toThrow(
      "Unsupported embeddings provider: 'cohere'",
    );
  });
});

// ---------------------------------------------------------------------------
// GNewsFetcher (index.ts) — full pipeline
// ---------------------------------------------------------------------------

describe('GNewsFetcher', () => {
  // Import once at describe level; module is cached so mock is stable
  const GNewsFetcherModule = import('../src/plugins/gnews/index');

  function setupFetcher(items = SAMPLE_RSS_ITEMS) {
    mockParseURL.mockResolvedValue({ items });
    const mockEmbedder = makeMockEmbedder(8);
    mockGetEmbedder.mockReturnValue(mockEmbedder);
    return mockEmbedder;
  }

  it('returns correct count and shapes for each headline', async () => {
    setupFetcher();
    const { GNewsFetcher } = await GNewsFetcherModule;
    const result = await new GNewsFetcher({
      feedUrl: 'https://news.google.com/rss',
      articleCount: 10,
      embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
    }).run();

    expect(result.fetched).toBe(3);
    expect(result.headlines).toHaveLength(3);
    const h = result.headlines[0];
    expect(h).toHaveProperty('title');
    expect(h).toHaveProperty('url');
    expect(h).toHaveProperty('source');
    expect(h).toHaveProperty('published_at');
    expect(h).toHaveProperty('description');
    expect(h).toHaveProperty('fetched_at');
    expect(Array.isArray(h.vector)).toBe(true);
    expect(h.vector).toHaveLength(8);
  });

  it('vector values are all numbers', async () => {
    setupFetcher(SAMPLE_RSS_ITEMS.slice(0, 2));
    const { GNewsFetcher } = await GNewsFetcherModule;
    const { headlines } = await new GNewsFetcher({
      feedUrl: 'https://news.google.com/rss',
      articleCount: 10,
      embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
    }).run();

    for (const h of headlines) {
      expect(h.vector.every((v) => typeof v === 'number')).toBe(true);
    }
  });

  it('each headline gets a unique vector', async () => {
    setupFetcher();
    const { GNewsFetcher } = await GNewsFetcherModule;
    const { headlines } = await new GNewsFetcher({
      feedUrl: 'https://news.google.com/rss',
      articleCount: 10,
      embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
    }).run();

    const v0 = headlines[0].vector.join(',');
    const v1 = headlines[1].vector.join(',');
    expect(v0).not.toBe(v1);
  });

  it('calls embedDocuments with title+source text', async () => {
    const mockEmbedder = setupFetcher();
    const { GNewsFetcher } = await GNewsFetcherModule;
    await new GNewsFetcher({
      feedUrl: 'https://news.google.com/rss',
      articleCount: 10,
      embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
    }).run();

    const embedSpy = mockEmbedder.embedDocuments as ReturnType<typeof vi.fn>;
    expect(embedSpy).toHaveBeenCalledOnce();
    const [texts] = embedSpy.mock.calls[0] as [string[]];
    expect(texts[0]).toContain('Markets rally on rate cut hopes');
    expect(texts[0]).toContain('Reuters');
  });

  it('returns empty result when feed has no items', async () => {
    setupFetcher([]);
    const { GNewsFetcher } = await GNewsFetcherModule;
    const result = await new GNewsFetcher({
      feedUrl: 'https://news.google.com/rss',
      articleCount: 10,
      embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
    }).run();

    expect(result.fetched).toBe(0);
    expect(result.headlines).toHaveLength(0);
  });

  it('fetched_at is a valid ISO timestamp', async () => {
    setupFetcher(SAMPLE_RSS_ITEMS.slice(0, 1));
    const { GNewsFetcher } = await GNewsFetcherModule;
    const { headlines } = await new GNewsFetcher({
      feedUrl: 'https://news.google.com/rss',
      articleCount: 10,
      embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
    }).run();

    expect(() => new Date(headlines[0].fetched_at).toISOString()).not.toThrow();
  });
});
