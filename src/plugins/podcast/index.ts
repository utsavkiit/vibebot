import Database from 'better-sqlite3';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { insertOutboundMessage } from '../../core/db';
import { buildHeader, buildFooter } from '../../core/messageUtils';
import { RankedCluster } from '../../workers/globalDigestBuilder';
import { summarizeGroupForPodcast } from './podcastSummarizer';
import { generatePodcastScript } from './scriptWriter';
import { generateAudio, TtsConfig } from './ttsClient';

export interface PodcastPluginConfig {
  ttsUrl: string;
  voice: string;
  model: string;
  outputDir: string;
  serveUrl: string;
  storyCount: number;
}

export class PodcastPlugin {
  private config: PodcastPluginConfig;

  constructor(config: PodcastPluginConfig) {
    this.config = config;
  }

  async buildFromClusters(ranked: RankedCluster[], db: Database.Database, llm: BaseChatModel): Promise<number | null> {
    const topClusters = ranked.slice(0, this.config.storyCount);

    if (!topClusters.length) {
      console.info('[podcast] No clusters to build from.');
      return null;
    }

    const date = new Date().toISOString().split('T')[0];
    console.info(`[podcast] Summarizing ${topClusters.length} stories...`);

    const stories = await Promise.all(
      topClusters.map((cluster) => summarizeGroupForPodcast(llm, cluster.headlines)),
    );

    console.info('[podcast] Generating script...');
    const script = await generatePodcastScript(llm, stories, date);

    const ttsConfig: TtsConfig = {
      ttsUrl: this.config.ttsUrl,
      voice: this.config.voice,
      model: this.config.model,
      outputDir: this.config.outputDir,
      fileBasename: `podcast-${date}`,
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

    const blocks = this.buildSlackBlocks(date, audioUrl, script, topClusters.length);
    const msgId = insertOutboundMessage(db, 'slack_default', 'podcast_digest', blocks, 3);
    console.info(`[podcast] Digest built → outbound_message id=${msgId}.`);
    return msgId;
  }

  private buildSlackBlocks(
    date: string,
    audioUrl: string | null,
    script: string,
    storyCount: number,
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
          text: `✅ *Podcast ready!* Covering ${storyCount} top stories.\n🎧 <${audioUrl}|Listen now>`,
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
