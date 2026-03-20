import Database from 'better-sqlite3';
import path from 'path';

export const DEFAULT_DB_PATH = path.resolve(__dirname, '../../vibebot.db');

export interface RawItem {
  id: number;
  source_type: string;
  external_id: string;
  payload: string;
  collected_at: string;
  status: string;
}

export interface OutboundMessage {
  id: number;
  channel: string;
  message_type: string;
  payload: string;
  status: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
  sent_at: string | null;
  last_error: string | null;
}

export function initDb(dbPath: string = DEFAULT_DB_PATH): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type  TEXT NOT NULL,
      external_id  TEXT,
      payload      TEXT NOT NULL,
      collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status       TEXT NOT NULL DEFAULT 'pending',
      UNIQUE(source_type, external_id)
    );

    CREATE TABLE IF NOT EXISTS outbound_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      channel      TEXT NOT NULL,
      message_type TEXT NOT NULL,
      payload      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      retry_count  INTEGER NOT NULL DEFAULT 0,
      max_retries  INTEGER NOT NULL DEFAULT 3,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      sent_at      TIMESTAMP,
      last_error   TEXT
    );
  `);
  db.close();
}

export function getConnection(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  return new Database(dbPath);
}

export function insertRawItem(
  db: Database.Database,
  sourceType: string,
  externalId: string,
  payload: object,
): boolean {
  try {
    db.prepare(
      'INSERT INTO raw_items (source_type, external_id, payload) VALUES (?, ?, ?)',
    ).run(sourceType, externalId, JSON.stringify(payload));
    return true;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message?.includes('UNIQUE constraint failed')) {
      return false;
    }
    throw e;
  }
}

export function getPendingRawItems(db: Database.Database, sourceType: string): RawItem[] {
  return db
    .prepare("SELECT * FROM raw_items WHERE source_type = ? AND status = 'pending'")
    .all(sourceType) as RawItem[];
}

export function markRawItemProcessed(db: Database.Database, itemId: number): void {
  db.prepare("UPDATE raw_items SET status = 'processed' WHERE id = ?").run(itemId);
}

export function insertOutboundMessage(
  db: Database.Database,
  channel: string,
  messageType: string,
  payload: object[],
  maxRetries: number = 3,
): number {
  const result = db
    .prepare(
      'INSERT INTO outbound_messages (channel, message_type, payload, max_retries) VALUES (?, ?, ?, ?)',
    )
    .run(channel, messageType, JSON.stringify(payload), maxRetries);
  return result.lastInsertRowid as number;
}

export function getDeliverableMessages(db: Database.Database): OutboundMessage[] {
  return db
    .prepare("SELECT * FROM outbound_messages WHERE status = 'pending'")
    .all() as OutboundMessage[];
}

export function markMessageSent(db: Database.Database, msgId: number): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE outbound_messages SET status = 'sent', sent_at = ? WHERE id = ?").run(now, msgId);
}

export function markMessageRetry(db: Database.Database, msgId: number, error: string): void {
  db.prepare(
    'UPDATE outbound_messages SET retry_count = retry_count + 1, last_error = ? WHERE id = ?',
  ).run(error, msgId);
}

export function markMessageFailed(db: Database.Database, msgId: number, error: string): void {
  db.prepare("UPDATE outbound_messages SET status = 'failed', last_error = ? WHERE id = ?").run(
    error,
    msgId,
  );
}
