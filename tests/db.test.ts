import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import {
  initDb,
  getConnection,
  insertRawItem,
  getPendingRawItems,
  markRawItemProcessed,
  insertOutboundMessage,
  getDeliverableMessages,
  markMessageSent,
  markMessageRetry,
  markMessageFailed,
} from '../src/core/db';

let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dbPath = join(tmpdir(), `vibebot-test-${Date.now()}-${Math.random()}.db`);
  initDb(dbPath);
  db = getConnection(dbPath);
});

afterEach(() => {
  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('initDb', () => {
  it('creates raw_items and outbound_messages tables', () => {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    expect(tables.has('raw_items')).toBe(true);
    expect(tables.has('outbound_messages')).toBe(true);
  });
});

describe('insertRawItem', () => {
  it('returns true for a new item', () => {
    expect(insertRawItem(db, 'news', 'abc123', { title: 'Test' })).toBe(true);
  });

  it('returns false for a duplicate', () => {
    insertRawItem(db, 'news', 'abc123', { title: 'Test' });
    expect(insertRawItem(db, 'news', 'abc123', { title: 'Test again' })).toBe(false);
  });
});

describe('getPendingRawItems', () => {
  it('returns pending items', () => {
    insertRawItem(db, 'news', 'abc123', { title: 'Test' });
    const items = getPendingRawItems(db, 'news');
    expect(items).toHaveLength(1);
    expect(JSON.parse(items[0].payload).title).toBe('Test');
  });

  it('filters by source_type', () => {
    insertRawItem(db, 'news', 'abc123', { title: 'News' });
    insertRawItem(db, 'stocks', 'def456', { ticker: 'AAPL' });
    expect(getPendingRawItems(db, 'news')).toHaveLength(1);
    expect(getPendingRawItems(db, 'stocks')).toHaveLength(1);
  });
});

describe('markRawItemProcessed', () => {
  it('removes item from pending', () => {
    insertRawItem(db, 'news', 'abc123', { title: 'Test' });
    const items = getPendingRawItems(db, 'news');
    markRawItemProcessed(db, items[0].id);
    expect(getPendingRawItems(db, 'news')).toHaveLength(0);
  });
});

describe('insertOutboundMessage', () => {
  it('returns a positive integer id', () => {
    const msgId = insertOutboundMessage(db, 'slack_default', 'news_digest', [{ type: 'section' }]);
    expect(typeof msgId).toBe('number');
    expect(msgId).toBeGreaterThan(0);
  });
});

describe('getDeliverableMessages', () => {
  it('returns pending messages', () => {
    insertOutboundMessage(db, 'slack_default', 'news_digest', []);
    expect(getDeliverableMessages(db)).toHaveLength(1);
  });
});

describe('markMessageSent', () => {
  it('removes message from pending queue', () => {
    const msgId = insertOutboundMessage(db, 'slack_default', 'news_digest', []);
    markMessageSent(db, msgId);
    expect(getDeliverableMessages(db)).toHaveLength(0);
  });
});

describe('markMessageRetry', () => {
  it('increments retry_count and stores last_error', () => {
    const msgId = insertOutboundMessage(db, 'slack_default', 'news_digest', []);
    markMessageRetry(db, msgId, 'timeout');
    const row = db
      .prepare('SELECT retry_count, last_error FROM outbound_messages WHERE id = ?')
      .get(msgId) as { retry_count: number; last_error: string };
    expect(row.retry_count).toBe(1);
    expect(row.last_error).toBe('timeout');
  });
});

describe('markMessageFailed', () => {
  it('sets status to failed and stores last_error', () => {
    const msgId = insertOutboundMessage(db, 'slack_default', 'news_digest', []);
    markMessageFailed(db, msgId, 'fatal error');
    const row = db
      .prepare('SELECT status, last_error FROM outbound_messages WHERE id = ?')
      .get(msgId) as { status: string; last_error: string };
    expect(row.status).toBe('failed');
    expect(row.last_error).toBe('fatal error');
  });
});
