import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTopArticles } from '../src/plugins/news/fetcher';

function mockFetch(status: number, data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const SAMPLE_RESPONSE = {
  results: [
    {
      title: 'Test Headline',
      content: 'Test description.',
      url: 'https://reuters.com/article',
    },
  ],
};

describe('fetchTopArticles', () => {
  it('throws if TAVILY_API_KEY is not set', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(fetchTopArticles()).rejects.toThrow('TAVILY_API_KEY');
  });

  it('returns articles from Tavily response', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'test-key');
    vi.stubGlobal('fetch', mockFetch(200, SAMPLE_RESPONSE));

    const articles = await fetchTopArticles(1);

    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Test Headline');
    expect(articles[0].description).toBe('Test description.');
    expect(articles[0].url).toBe('https://reuters.com/article');
    expect(articles[0].source).toBe('reuters.com');
  });

  it('throws on non-200 response', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'test-key');
    vi.stubGlobal('fetch', mockFetch(429, 'rate limited'));

    await expect(fetchTopArticles()).rejects.toThrow('429');
  });

  it('handles missing fields gracefully', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'test-key');
    const sparseResponse = { results: [{ title: null, content: null, url: null }] };
    vi.stubGlobal('fetch', mockFetch(200, sparseResponse));

    const articles = await fetchTopArticles(1);

    expect(articles[0].title).toBe('Untitled');
    expect(articles[0].source).toBe('Unknown');
  });

  it('respects the count limit', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'test-key');
    const manyResults = {
      results: Array.from({ length: 10 }, (_, i) => ({
        title: `Article ${i}`,
        url: `https://example.com/${i}`,
        content: 'desc',
      })),
    };
    vi.stubGlobal('fetch', mockFetch(200, manyResults));

    const articles = await fetchTopArticles(3);

    expect(articles).toHaveLength(3);
  });
});
