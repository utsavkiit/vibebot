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
import { fetchMacanListings, Listing } from './fetcher';
import { generateBuyersNote, rankListings } from './formatter';

const RANK_EMOJIS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

export class PorscheMacanPlugin extends BasePlugin {
  readonly name = 'porsche_macan';

  constructor(
    private zipCode: string = '29715',
    private distance: number = 50,
    private yearMin: number = 2022,
    private yearMax: number = 2026,
    private maxPrice: number = 55000,
    private maxMileage: number = 25000,
    private listingCount: number = 5,
  ) {
    super();
  }

  async collect(db: Database.Database): Promise<number> {
    const listings = await fetchMacanListings(
      this.zipCode,
      this.distance,
      this.yearMin,
      this.yearMax,
      this.maxPrice,
      this.maxMileage,
    );
    let newCount = 0;
    for (const listing of listings) {
      const externalId = crypto.createHash('md5').update(listing.vin).digest('hex');
      if (insertRawItem(db, this.name, externalId, listing)) {
        newCount++;
      }
    }
    return newCount;
  }

  async buildDigest(db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const items = getPendingRawItems(db, this.name);
    if (!items.length) return null;

    const allListings: Listing[] = items.map((item) => JSON.parse(item.payload) as Listing);
    const topListings = rankListings(allListings, this.listingCount);
    const blocks = [...buildHeader(), ...(await this.buildBlocks(llm, topListings)), ...buildFooter()];

    const msgId = insertOutboundMessage(db, 'slack_default', 'porsche_macan_digest', blocks, 3);
    for (const item of items) {
      markRawItemProcessed(db, item.id);
    }
    return msgId;
  }

  private async buildBlocks(llm: BaseChatModel, listings: Listing[]): Promise<object[]> {
    const blocks: object[] = [
      { type: 'section', text: { type: 'mrkdwn', text: '*🏎️ Porsche Macan — Today\'s Top Picks*' } },
      { type: 'divider' },
    ];

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      const rankEmoji = i < RANK_EMOJIS.length ? RANK_EMOJIS[i] : '🚘';
      const buyersNote = await generateBuyersNote(llm, listing);

      const trimPart = listing.trim ? ` ${listing.trim}` : '';
      const title =
        `${rankEmoji} *${i + 1}. ` +
        `<${listing.url}|${listing.year} ${listing.make} ${listing.model}${trimPart} — $${listing.price.toLocaleString()}>*`;

      const ctxParts: string[] = [`🛣️ ${listing.mileage.toLocaleString()} mi`];
      if (listing.dealerName && listing.dealerName !== 'Unknown Dealer') {
        ctxParts.push(listing.dealerName);
      }
      if (listing.dealerCity && listing.dealerState) {
        ctxParts.push(`${listing.dealerCity}, ${listing.dealerState}`);
      }

      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: title } });
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: ctxParts.join('  ·  ') }] });

      if (buyersNote) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `💡 _${buyersNote}_` }],
        });
      }

      if (i < listings.length - 1) {
        blocks.push({ type: 'divider' });
      }
    }

    return blocks;
  }
}
