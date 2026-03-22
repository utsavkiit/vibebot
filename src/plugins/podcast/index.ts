import crypto from 'crypto';
import Database from 'better-sqlite3';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BasePlugin } from '../../core/basePlugin';
import {
  getPendingRawItems,
  insertOutboundMessage,
  insertRawItem,
  markRawItemProcessed,
  RawItem,
} from '../../core/db';
import { buildHeader, buildFooter } from '../../core/messageUtils';
import { HeadlineWithEmbedding } from '../gnews/index';
import { clusterByTopic } from '../gnews/clusterer';
import { summarizeGroupForPodcast } from './podcastSummarizer';
import { generatePodcastScript, TopicSection, getTopicLabel } from './scriptWriter';
import { generateAudio, TtsConfig } from './ttsClient';

export interface PodcastPluginConfig {
  ttsUrl: string;
  voice: string;
  model: string;
  outputDir: string;
  serveUrl: string;
  storyCount: number;
  sourcePlugins: string[];
}

interface CollectedTopic {
  name: string;
  headlines: HeadlineWithEmbedding[];
}

export class PodcastPlugin extends BasePlugin {
  readonly name = 'podcast';
  private config: PodcastPluginConfig;

  constructor(config: PodcastPluginConfig) {
    super();
    this.config = config;
  }

  async collect(db: Database.Database): Promise<number> {
    const today = new Date().toISOString().split('T')[0];

    const topics: CollectedTopic[] = [];

    for (const pluginName of this.config.sourcePlugins) {
      // Read raw_items collected today for this topic plugin
      const rows = db
        .prepare(
          `SELECT * FROM raw_items
           WHERE source_type = ?
             AND date(collected_at) = ?`,
        )
        .all(pluginName, today) as RawItem[];

      if (!rows.length) {
        console.warn(`[podcast] No raw_items found for '${pluginName}' today — skipping.`);
        continue;
      }

      const headlines = rows
        .map((row) => {
          try {
            return JSON.parse(row.payload) as HeadlineWithEmbedding;
          } catch {
            return null;
          }
        })
        .filter((h): h is HeadlineWithEmbedding => h !== null && Array.isArray(h.vector));

      if (headlines.length) {
        topics.push({ name: pluginName, headlines });
      }
    }

    if (!topics.length) {
      console.warn('[podcast] No headline data found for any topic today — skipping collect.');
      return 0;
    }

    const externalId = crypto.createHash('md5').update(today + 'podcast').digest('hex');
    const inserted = insertRawItem(db, 'podcast', externalId, { date: today, topics });
    return inserted ? 1 : 0;
  }

  async buildDigest(db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const items = getPendingRawItems(db, 'podcast');
    if (!items.length) return null;

    const item = items[0];
    const { date, topics } = JSON.parse(item.payload) as { date: string; topics: CollectedTopic[] };

    console.info(`[podcast] Summarizing ${topics.length} topics (${this.config.storyCount} stories each)...`);

    const sections: TopicSection[] = [];

    for (const topic of topics) {
      const groups = clusterByTopic(topic.headlines, 0.70);
      const topGroups = groups.slice(0, this.config.storyCount);

      const stories = await Promise.all(
        topGroups.map((group) => summarizeGroupForPodcast(llm, group.headlines)),
      );

      sections.push({
        topic: topic.name,
        label: getTopicLabel(topic.name),
        stories,
      });
    }

    console.info(`[podcast] Generating script from ${sections.length} sections...`);
    const script = await generatePodcastScript(llm, sections, date);

    const ttsConfig: TtsConfig = {
      ttsUrl: this.config.ttsUrl,
      voice: this.config.voice,
      model: this.config.model,
      outputDir: this.config.outputDir,
    };

    let audioUrl: string | null = null;
    try {
      console.info('[podcast] Sending script to mlx-audio TTS...');
      const audioPath = await generateAudio(script, ttsConfig);
      const filename = audioPath.split('/').pop();
      audioUrl = `${this.config.serveUrl}/${filename}`;
      console.info(`[podcast] Audio saved → ${audioPath}`);
    } catch (err) {
      console.warn(`[podcast] TTS failed — posting script-only. Error: ${(err as Error).message}`);
    }

    const blocks = this.buildSlackBlocks(date, audioUrl, script, sections.length);
    const msgId = insertOutboundMessage(db, 'slack_default', 'podcast_digest', blocks, 3);
    markRawItemProcessed(db, item.id);
    return msgId;
  }

  private buildSlackBlocks(
    date: string,
    audioUrl: string | null,
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

    if (audioUrl) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Podcast ready!* Covering ${sectionCount} topics.\n🎧 <${audioUrl}|Listen now>`,
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
