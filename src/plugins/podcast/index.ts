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
import { extractTextFromBlocks } from './blockExtractor';
import { generatePodcastScript, DigestSection } from './scriptWriter';
import { generateAudio, TtsConfig } from './ttsClient';

export interface PodcastPluginConfig {
  ttsUrl: string;
  voice: string;
  model: string;
  outputDir: string;
  digestTypes: string[];
}

const TOPIC_LABELS: Record<string, string> = {
  us_news_digest: '🇺🇸 US News',
  world_news_digest: '🌍 World News',
  india_news_digest: '🇮🇳 India News',
  sports_digest: '⚽ Sports',
  tech_news_digest: '💻 Tech',
  stocks_news_digest: '📈 Markets',
};

interface DigestRow {
  message_type: string;
  payload: string;
}

export class PodcastPlugin extends BasePlugin {
  readonly name = 'podcast';
  private config: PodcastPluginConfig;

  constructor(config: PodcastPluginConfig) {
    super();
    this.config = config;
  }

  async collect(db: Database.Database): Promise<number> {
    const placeholders = this.config.digestTypes.map(() => '?').join(', ');
    const today = new Date().toISOString().split('T')[0];

    const rows = db
      .prepare(
        `SELECT message_type, payload FROM outbound_messages
         WHERE message_type IN (${placeholders})
           AND date(created_at) = ?
           AND status != 'failed'
         ORDER BY created_at ASC`,
      )
      .all(...this.config.digestTypes, today) as DigestRow[];

    if (!rows.length) {
      console.warn('[podcast] No topic digests found for today — skipping collect.');
      return 0;
    }

    const sections: DigestSection[] = rows
      .map((row) => {
        let blocks: object[];
        try {
          blocks = JSON.parse(row.payload) as object[];
        } catch {
          return null;
        }
        const text = extractTextFromBlocks(blocks as Parameters<typeof extractTextFromBlocks>[0]);
        return text ? { topic: row.message_type, text } : null;
      })
      .filter((s): s is DigestSection => s !== null);

    if (!sections.length) {
      console.warn('[podcast] Could not extract text from any digest — skipping collect.');
      return 0;
    }

    const externalId = crypto
      .createHash('md5')
      .update(today + 'podcast')
      .digest('hex');

    const inserted = insertRawItem(db, 'podcast', externalId, { date: today, sections });
    return inserted ? 1 : 0;
  }

  async buildDigest(db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const items = getPendingRawItems(db, 'podcast');
    if (!items.length) return null;

    const item = items[0];
    const { date, sections } = JSON.parse(item.payload) as { date: string; sections: DigestSection[] };

    console.info(`[podcast] Generating script from ${sections.length} topic sections.`);
    const script = await generatePodcastScript(llm, sections, date);

    const ttsConfig: TtsConfig = {
      ttsUrl: this.config.ttsUrl,
      voice: this.config.voice,
      model: this.config.model,
      outputDir: this.config.outputDir,
    };

    let audioPath: string | null = null;
    try {
      console.info('[podcast] Sending script to mlx-audio TTS...');
      audioPath = await generateAudio(script, ttsConfig);
      console.info(`[podcast] Audio saved to ${audioPath}`);
    } catch (err) {
      console.warn(`[podcast] TTS failed — will post script-only notification. Error: ${(err as Error).message}`);
    }

    const blocks = this.buildSlackBlocks(date, audioPath, script, sections.length);
    const msgId = insertOutboundMessage(db, 'slack_default', 'podcast_digest', blocks, 3);
    markRawItemProcessed(db, item.id);
    return msgId;
  }

  private buildSlackBlocks(
    date: string,
    audioPath: string | null,
    script: string,
    sectionCount: number,
  ): object[] {
    const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    const blocks: object[] = [
      ...buildHeader(),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*🎙 VibeBot Daily Podcast — ${formattedDate}*` },
      },
      { type: 'divider' },
    ];

    if (audioPath) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Podcast ready!* Covering ${sectionCount} topics.\n📁 \`${audioPath}\``,
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⚠️ *Audio generation failed* — here's the script instead:\n\n${script.slice(0, 2900)}${script.length > 2900 ? '…' : ''}`,
        },
      });
    }

    blocks.push(...buildFooter());
    return blocks;
  }
}
