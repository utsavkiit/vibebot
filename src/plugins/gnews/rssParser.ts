import Parser from 'rss-parser';

export interface GNewsHeadline {
  title: string;
  url: string;
  source: string;
  published_at: string;
  description: string;
}

type GNewsItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  source?: { $?: { url?: string }; _?: string } | string;
};

export async function fetchGNewsHeadlines(
  feedUrl: string,
  count: number,
): Promise<GNewsHeadline[]> {
  const parser = new Parser<object, GNewsItem>({
    customFields: {
      item: ['source'],
    },
  });

  const feed = await parser.parseURL(feedUrl);

  const seen = new Set<string>();
  const headlines: GNewsHeadline[] = [];

  for (const item of feed.items) {
    if (headlines.length >= count) break;

    const url = item.link ?? '';
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const title = item.title ?? '';
    if (!title) continue;

    // Google News RSS includes <source> with the publisher name in the text node
    let source = 'Unknown';
    if (item.source) {
      if (typeof item.source === 'string') {
        source = item.source;
      } else if (typeof item.source === 'object' && item.source._ ) {
        source = item.source._;
      }
    }

    headlines.push({
      title,
      url,
      source,
      published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      description: item.contentSnippet ?? '',
    });
  }

  return headlines;
}
