interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

export interface Article {
  title: string;
  description: string;
  url: string;
  source: string;
  published_at: string;
}

export async function fetchTopArticles(count: number = 5): Promise<Article[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set in the environment.');

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query:
        'biggest world news today site:reuters.com OR site:bbc.com OR site:apnews.com OR site:ft.com',
      max_results: count,
      topic: 'news',
      time_range: 'day',
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as TavilyResponse;
  const results = (data.results ?? []).slice(0, count);

  return results.map((result) => {
    const url = result.url ?? '';
    let source = 'Unknown';
    if (url) {
      try {
        source = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        // leave as Unknown
      }
    }
    return {
      title: result.title ?? 'Untitled',
      description: result.content ?? '',
      url,
      source,
      published_at: new Date().toISOString(),
    };
  });
}
