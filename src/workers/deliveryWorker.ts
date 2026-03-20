import Database from 'better-sqlite3';
import {
  getDeliverableMessages,
  markMessageFailed,
  markMessageRetry,
  markMessageSent,
  OutboundMessage,
} from '../core/db';
import { SlackSender } from '../core/slackSender';

export async function run(db: Database.Database): Promise<void> {
  const messages = getDeliverableMessages(db);
  if (!messages.length) {
    console.info('No pending messages to deliver.');
    return;
  }
  for (const msg of messages) {
    await deliverWithRetry(db, msg);
  }
}

async function deliverWithRetry(db: Database.Database, msg: OutboundMessage): Promise<void> {
  const maxRetries = msg.max_retries;
  let lastError = '';

  for (let attempt = msg.retry_count; attempt < maxRetries; attempt++) {
    try {
      await new SlackSender().send(JSON.parse(msg.payload));
      markMessageSent(db, msg.id);
      console.info(`Delivered message id=${msg.id} (${msg.message_type}) on attempt ${attempt + 1}.`);
      return;
    } catch (e) {
      lastError = String(e instanceof Error ? e.message : e);
      markMessageRetry(db, msg.id, lastError);
      const wait = Math.pow(2, attempt) * 1000;
      console.warn(
        `Delivery attempt ${attempt + 1}/${maxRetries} failed for message id=${msg.id}: ${lastError}. Retrying in ${wait / 1000}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  markMessageFailed(db, msg.id, lastError);
  console.error(
    `Message id=${msg.id} (${msg.message_type}) permanently failed after ${maxRetries} attempt(s).`,
  );
  await notifyFailure(msg.message_type, maxRetries, lastError);
}

async function notifyFailure(messageType: string, attempts: number, error: string): Promise<void> {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *VibeBot delivery failed*\n*Type:* ${messageType}\n*After ${attempts} attempt(s)*\n*Error:* \`${error}\``,
      },
    },
  ];
  try {
    await new SlackSender().send(blocks);
  } catch {
    console.error('Could not send failure notification to Slack.');
  }
}
