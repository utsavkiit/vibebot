/**
 * Live integration test for the Porsche Macan plugin.
 * Runs all 3 pipeline stages with real APIs and sends to Slack.
 *
 * Usage:
 *   npx ts-node scripts/testPorscheMacanLive.ts
 */

import path from 'path';
import { existsSync, unlinkSync } from 'fs';
import * as dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { initDb, getConnection } from '../src/core/db';
import { getLlm } from '../src/core/llmFactory';
import { PorscheMacanPlugin } from '../src/plugins/porscheMacan';
import * as collector from '../src/workers/collector';
import * as digestBuilder from '../src/workers/digestBuilder';
import * as deliveryWorker from '../src/workers/deliveryWorker';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DB_PATH = path.resolve(__dirname, '../vibebot-test-live.db');

async function main(): Promise<void> {
  // Clean slate
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  initDb(DB_PATH);
  const db: Database.Database = getConnection(DB_PATH);

  const plugin = new PorscheMacanPlugin(
    '29715',  // Fort Mill, SC
    500,      // distance_miles (wider to find real listings)
    2022,
    2026,
    55000,
    25000,
    5,        // listing_count
  );

  const llm = getLlm('ollama', 'qwen3:8b');

  console.log('\n=== Stage 1: Fetching listings from auto.dev ===');
  const newCount = await collector.run([plugin], db);
  console.log(`  Collected ${newCount} new listing(s).`);

  const rows = db.prepare("SELECT * FROM raw_items WHERE source_type = 'porsche_macan'").all() as { payload: string }[];
  console.log(`  Total in DB: ${rows.length} listing(s).`);
  if (rows.length) {
    const first = JSON.parse(rows[0].payload);
    console.log(`  Sample: ${first.year} ${first.make} ${first.model} ${first.trim} — $${first.price?.toLocaleString()} (${first.mileage?.toLocaleString()} mi)`);
  }

  console.log('\n=== Stage 2: Building digest with LLM buyer notes ===');
  const msgId = await digestBuilder.run([plugin], db, llm);
  console.log(`  Outbound message queued (id=${msgId ?? 'null'}).`);

  console.log('\n=== Stage 3: Delivering to Slack ===');
  await deliveryWorker.run(db);

  const msg = db
    .prepare("SELECT status FROM outbound_messages WHERE message_type = 'porsche_macan_digest'")
    .get() as { status: string } | undefined;
  console.log(`  Delivery status: ${msg?.status ?? 'no message found'}`);

  db.close();
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  console.log('\nDone. Check your Slack channel for the Porsche Macan digest.\n');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
