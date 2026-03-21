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
import { fetchGNewsHeadlines, GNewsHeadline } from '../gnews/rssParser';
import { EmbedderConfig } from '../gnews/embedder';
import { summarizeGroup } from '../gnews/groupSummarizer';

export interface GNewsSportsConfig {
  feeds: {
    f1: string;
    soccer: string;
    cricket: string;
    tennis: string;
  };
  embeddings: EmbedderConfig; // kept for structural consistency with other topic plugins
}

const SPORT_LABELS: Record<string, string> = {
  f1: '🏎️ Formula 1',
  soccer: '⚽ Soccer',
  cricket: '🏏 Cricket',
  tennis: '🎾 Tennis',
};

const SPORTS_ORDER = ['f1', 'soccer', 'cricket', 'tennis'] as const;

export class GNewsSportsPlugin extends BasePlugin {
  readonly name = 'sports';
  private config: GNewsSportsConfig;

  constructor(config: GNewsSportsConfig) {
    super();
    this.config = config;
  }

  async collect(db: Database.Database): Promise<number> {
    let newCount = 0;
    const now = new Date().toISOString();

    for (const sport of SPORTS_ORDER) {
      const feedUrl = this.config.feeds[sport];
      const headlines = await fetchGNewsHeadlines(feedUrl, 5);

      for (const h of headlines) {
        const sourceType = `sports_${sport}`;
        const externalId = crypto.createHash('md5').update(h.url).digest('hex');
        const payload = { ...h, sport, fetched_at: now };
        if (insertRawItem(db, sourceType, externalId, payload)) {
          newCount++;
          break; // one new story per sport is enough
        }
      }
    }
    return newCount;
  }

  async buildDigest(db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const sportItems: Array<{ sport: string; headline: GNewsHeadline & { sport: string; fetched_at: string } }> = [];

    for (const sport of SPORTS_ORDER) {
      const items = getPendingRawItems(db, `sports_${sport}`);
      if (items.length > 0) {
        const payload = JSON.parse(items[0].payload) as GNewsHeadline & { sport: string; fetched_at: string };
        sportItems.push({ sport, headline: payload });
      }
    }

    const blocks: object[] = [
      ...buildHeader(),
      { type: 'section', text: { type: 'mrkdwn', text: '*🏆 Sports Digest*' } },
      { type: 'divider' },
    ];

    if (!sportItems.length) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No new sports stories to report today._' },
      });
      blocks.push(...buildFooter());
      return insertOutboundMessage(db, 'slack_default', 'sports_digest', blocks, 3);
    }

    for (let i = 0; i < sportItems.length; i++) {
      const { sport, headline } = sportItems[i];
      const label = SPORT_LABELS[sport] ?? sport;
      const { headline: summaryHeadline, summary, emoji } = await summarizeGroup(llm, [headline]);

      let cardText = `*${label}*\n${emoji} *<${headline.url}|${summaryHeadline}>*`;
      if (summary) cardText += `\n${summary}`;

      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: cardText } });
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `📌 ${headline.source}` }] });
      if (i < sportItems.length - 1) blocks.push({ type: 'divider' });
    }

    blocks.push(...buildFooter());

    const msgId = insertOutboundMessage(db, 'slack_default', 'sports_digest', blocks, 3);

    // mark all collected sport items as processed
    for (const sport of SPORTS_ORDER) {
      const items = getPendingRawItems(db, `sports_${sport}`);
      for (const item of items) markRawItemProcessed(db, item.id);
    }

    return msgId;
  }
}
