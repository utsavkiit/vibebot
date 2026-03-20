import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { initDb, getConnection, insertOutboundMessage, getDeliverableMessages } from '../src/core/db';
import { run } from '../src/workers/deliveryWorker';

vi.mock('../src/core/slackSender', () => ({
  SlackSender: vi.fn(),
}));

import { SlackSender } from '../src/core/slackSender';

let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dbPath = join(tmpdir(), `vibebot-delivery-test-${Date.now()}-${Math.random()}.db`);
  initDb(dbPath);
  db = getConnection(dbPath);
  vi.clearAllMocks();
});

afterEach(() => {
  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
  vi.unstubAllEnvs();
});

function setupMockSender(sendImpl: () => Promise<void>) {
  (SlackSender as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    send: vi.fn().mockImplementation(sendImpl),
  }));
}

describe('deliveryWorker.run', () => {
  it('delivers a pending message and marks it sent', async () => {
    setupMockSender(() => Promise.resolve());
    insertOutboundMessage(db, 'slack_default', 'news_digest', [{ type: 'section' }]);

    await run(db);

    const MockSender = SlackSender as ReturnType<typeof vi.fn>;
    expect(MockSender.mock.instances[0].send).toHaveBeenCalledOnce();
    expect(getDeliverableMessages(db)).toHaveLength(0);
  });

  it('does nothing when there are no pending messages', async () => {
    setupMockSender(() => Promise.resolve());

    await run(db);

    expect(SlackSender).not.toHaveBeenCalled();
  });

  it('retries on failure then marks sent on success', async () => {
    let calls = 0;
    setupMockSender(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('timeout'));
      return Promise.resolve();
    });
    insertOutboundMessage(db, 'slack_default', 'news_digest', [], 3);

    await run(db);

    expect(calls).toBe(2);
    expect(getDeliverableMessages(db)).toHaveLength(0);
  });

  it('marks message failed and sends notification after max retries', async () => {
    setupMockSender(() => Promise.reject(new Error('always fails')));
    insertOutboundMessage(db, 'slack_default', 'news_digest', [], 2);

    await run(db);

    // 2 delivery attempts + 1 failure notification attempt
    const MockSender = SlackSender as ReturnType<typeof vi.fn>;
    const totalSendCalls = MockSender.mock.instances.reduce(
      (sum: number, inst: { send: ReturnType<typeof vi.fn> }) => sum + inst.send.mock.calls.length,
      0,
    );
    expect(totalSendCalls).toBe(3);
    const row = db.prepare('SELECT status FROM outbound_messages').get() as { status: string };
    expect(row.status).toBe('failed');
  });

  it('persists retry_count and last_error on each failure', async () => {
    setupMockSender(() => Promise.reject(new Error('fail')));
    insertOutboundMessage(db, 'slack_default', 'news_digest', [], 2);

    await run(db);

    const row = db
      .prepare('SELECT retry_count, last_error FROM outbound_messages')
      .get() as { retry_count: number; last_error: string };
    expect(row.retry_count).toBe(2);
    expect(row.last_error).toContain('fail');
  });
});
