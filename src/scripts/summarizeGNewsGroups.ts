import path from 'path';
import fs from 'fs';
import * as dotenv from 'dotenv';
import * as yaml from 'js-yaml';
import { getLlm } from '../core/llmFactory';
import { summarizeGroup } from '../plugins/gnews/groupSummarizer';
import { buildHeader, buildFooter } from '../core/messageUtils';

interface GroupedHeadline {
  title: string;
  url: string;
  source: string;
  description: string;
  published_at: string;
}

interface TopicGroup {
  label: string;
  size: number;
  headlines: GroupedHeadline[];
}

interface AppConfig {
  llm: { provider: string; model: string };
}

// Ordered by trust tier — earlier = more reputable. Case-insensitive prefix match.
const SOURCE_PRIORITY: string[] = [
  'reuters', 'associated press', 'ap news',
  'bbc', 'npr', 'pbs',
  'the new york times', 'the washington post', 'the guardian', 'wsj', 'wall street journal',
  'financial times', 'bloomberg', 'the economist',
  'cnn', 'abc news', 'cbs news', 'nbc news', 'msnbc',
  'politico', 'axios', 'the hill',
  'ars technica', 'wired', 'techcrunch', 'the verge',
];

function sourceTier(source: string): number {
  const lower = source.toLowerCase();
  const idx = SOURCE_PRIORITY.findIndex((s) => lower.includes(s));
  return idx === -1 ? SOURCE_PRIORITY.length : idx; // unknown sources sort last
}

function pickBestUrl(headlines: GroupedHeadline[]): string {
  // Sort by source tier (ascending = more reputable), then by recency (descending) within same tier
  const sorted = [...headlines].sort((a, b) => {
    const tierDiff = sourceTier(a.source) - sourceTier(b.source);
    if (tierDiff !== 0) return tierDiff;
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
  });
  return sorted[0].url;
}

const repoRoot = path.resolve(__dirname, '../..');

async function main(): Promise<void> {
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const inputPath = path.join(repoRoot, 'gnews_groups.json');
  if (!fs.existsSync(inputPath)) {
    console.error('gnews_groups.json not found — run `npm run group-gnews` first.');
    process.exit(1);
  }

  const allGroups: TopicGroup[] = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const groups = allGroups.filter((g) => g.size >= 2).slice(0, 5);
  console.info(`Loaded ${allGroups.length} groups → ${groups.length} multi-source groups (top 5).\n`);

  const config = yaml.load(
    fs.readFileSync(path.join(repoRoot, 'config.yaml'), 'utf8'),
  ) as AppConfig;
  const llm = getLlm(config.llm.provider, config.llm.model);

  const blocks: object[] = [
    ...buildHeader(),
    { type: 'section', text: { type: 'mrkdwn', text: '*🗞️ Top Stories by Topic*' } },
    { type: 'divider' },
  ];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    console.info(`Summarizing group ${i + 1}/${groups.length}: "${group.label.slice(0, 60)}..."`);

    const { headline, summary, emoji } = await summarizeGroup(llm, group.headlines);

    const url = pickBestUrl(group.headlines);
    const sources = [...new Set(group.headlines.map((h) => h.source))].join(', ');

    let cardText = `${emoji} *${i + 1}. <${url}|${headline}>*`;
    if (summary) cardText += `\n${summary}`;
    if (group.size > 1) cardText += `\n_${group.size} sources_`;

    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: cardText } });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `📌 ${sources}` }],
    });

    if (i < groups.length - 1) {
      blocks.push({ type: 'divider' });
    }
  }

  blocks.push(...buildFooter());

  // Save Block Kit JSON
  const outputPath = path.join(repoRoot, 'gnews_digest.json');
  fs.writeFileSync(outputPath, JSON.stringify(blocks, null, 2), 'utf8');

  console.info(`\nDone. ${groups.length} groups summarized.`);
  console.info(`Block Kit saved to ${outputPath}`);
  console.info(`\n--- Preview ---`);
  for (const block of blocks) {
    const b = block as Record<string, unknown>;
    if (b.type === 'section' && (b.text as Record<string, unknown>)?.type === 'mrkdwn') {
      console.info((b.text as Record<string, unknown>).text);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
