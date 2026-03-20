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
import { buildFooter, buildHeader } from '../../core/messageUtils';
import { fetchTopArticles, Article } from './fetcher';
import { fetchOgImage } from './ogImage';
import { summarizeArticle } from './summarizer';

function formatPublishedAt(isoStr: string): string {
  const dt = new Date(isoStr);
  return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export class NewsPlugin extends BasePlugin {
  readonly name = 'news';
  private articleCount: number;

  constructor(articleCount: number = 5) {
    super();
    this.articleCount = articleCount;
  }

  async collect(db: Database.Database): Promise<number> {
    const articles = await fetchTopArticles(this.articleCount);
    let newCount = 0;
    for (const article of articles) {
      const externalId = crypto.createHash('md5').update(article.url).digest('hex');
      if (insertRawItem(db, 'news', externalId, article)) {
        newCount++;
      }
    }
    return newCount;
  }

  async buildDigest(db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const items = getPendingRawItems(db, 'news');
    if (!items.length) return null;

    const articles: Article[] = items.map((item) => JSON.parse(item.payload) as Article);
    const blocks = [...buildHeader(), ...(await this.buildBlocks(llm, articles)), ...buildFooter()];

    const msgId = insertOutboundMessage(db, 'news', 'news_digest', blocks, 3);
    for (const item of items) {
      markRawItemProcessed(db, item.id);
    }
    return msgId;
  }

  private async buildBlocks(llm: BaseChatModel, articles: Article[]): Promise<object[]> {
    const blocks: object[] = [];

    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*📰 Top Stories*' } });
    blocks.push({ type: 'divider' });

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const [headline, blurb, emoji] = await summarizeArticle(llm, article.title, article.description);
      const imageUrl = await fetchOgImage(article.url);
      const timeStr = formatPublishedAt(article.published_at);

      let cardText = `${emoji} *${i + 1}. <${article.url}|${headline}>*`;
      if (blurb) cardText += `\n${blurb}`;

      const blockA: Record<string, unknown> = {
        type: 'section',
        text: { type: 'mrkdwn', text: cardText },
      };
      if (imageUrl) {
        blockA.accessory = { type: 'image', image_url: imageUrl, alt_text: article.title };
      }
      blocks.push(blockA);

      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `📌 ${article.source}  ·  ${timeStr}` }],
      });

      if (i < articles.length - 1) {
        blocks.push({ type: 'divider' });
      }
    }

    return blocks;
  }
}
