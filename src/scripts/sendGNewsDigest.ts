import path from 'path';
import fs from 'fs';
import * as dotenv from 'dotenv';

const repoRoot = path.resolve(__dirname, '../..');

async function main(): Promise<void> {
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const inputPath = path.join(repoRoot, 'gnews_digest.json');
  if (!fs.existsSync(inputPath)) {
    console.error('gnews_digest.json not found — run `npm run summarize-gnews` first.');
    process.exit(1);
  }

  const blocks: object[] = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  const webhookUrl = process.env.SLACK_WEBHOOK_URL_NEWS;
  if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL_NEWS is not set in .env');

  console.info(`Sending ${blocks.length} blocks to Slack...`);
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook returned ${response.status}: ${await response.text()}`);
  }

  console.info('Sent successfully.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
