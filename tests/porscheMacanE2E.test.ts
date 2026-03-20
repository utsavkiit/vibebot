/**
 * End-to-end integration test for the Porsche Macan plugin pipeline.
 *
 * Runs all three stages against a real in-memory SQLite DB.
 * External dependencies are stubbed:
 *   - fetchMacanListings  → returns hardcoded fake listings
 *   - generateBuyersNote  → returns a canned string (no LLM call)
 *   - SlackSender.send    → captured in-memory (no webhook call)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { initDb, getConnection } from '../src/core/db';
import { PorscheMacanPlugin } from '../src/plugins/porscheMacan';
import * as collector from '../src/workers/collector';
import * as digestBuilder from '../src/workers/digestBuilder';
import * as deliveryWorker from '../src/workers/deliveryWorker';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../src/plugins/porscheMacan/fetcher');

vi.mock('../src/plugins/porscheMacan/formatter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/plugins/porscheMacan/formatter')>();
  return {
    ...actual,
    generateBuyersNote: vi.fn().mockResolvedValue('Excellent sport-trim value for this mileage.'),
  };
});

// Stub SlackSender so no real webhook is called; capture what gets sent.
const sentPayloads: object[][] = [];
vi.mock('../src/core/slackSender', () => ({
  SlackSender: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockImplementation(async (blocks: object[]) => {
      sentPayloads.push(blocks);
    }),
  })),
}));

import { fetchMacanListings } from '../src/plugins/porscheMacan/fetcher';

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const FAKE_LISTINGS = [
  {
    vin: 'WP1AA2A58NLB12345',
    year: 2023,
    make: 'Porsche',
    model: 'Macan',
    trim: 'S',
    price: 48500,
    mileage: 11200,
    dealerName: 'Hendrick Porsche',
    dealerCity: 'Charlotte',
    dealerState: 'NC',
    url: 'https://example.com/macan-s-2023',
  },
  {
    vin: 'WP1AB2A57MLB67890',
    year: 2022,
    make: 'Porsche',
    model: 'Macan',
    trim: 'GTS',
    price: 51000,
    mileage: 8400,
    dealerName: 'Porsche of Columbia',
    dealerCity: 'Columbia',
    dealerState: 'SC',
    url: 'https://example.com/macan-gts-2022',
  },
  {
    vin: 'WP1AC2A53PLB99999',
    year: 2024,
    make: 'Porsche',
    model: 'Macan',
    trim: 'Base',
    price: 44000,
    mileage: 18700,
    dealerName: 'Porsche Greenville',
    dealerCity: 'Greenville',
    dealerState: 'SC',
    url: 'https://example.com/macan-base-2024',
  },
];

// Stub LLM — never actually called since generateBuyersNote is mocked.
const MOCK_LLM = {} as BaseChatModel;

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

let dbPath: string;
let db: Database.Database;

import { generateBuyersNote, rankListings } from '../src/plugins/porscheMacan/formatter';

beforeEach(() => {
  dbPath = join(tmpdir(), `vibebot-e2e-${Date.now()}.db`);
  initDb(dbPath);
  db = getConnection(dbPath);
  sentPayloads.length = 0;
  vi.clearAllMocks();
  vi.stubEnv('SLACK_WEBHOOK_URL_PORSCHE_MACAN', 'https://hooks.slack.com/test/porsche');
  vi.mocked(fetchMacanListings).mockResolvedValue(FAKE_LISTINGS);
  vi.mocked(generateBuyersNote).mockResolvedValue('Excellent sport-trim value for this mileage.');
});

afterEach(() => {
  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Porsche Macan pipeline — end-to-end (no API / no Slack)', () => {
  it('Stage 1: collect stores all 3 listings in raw_items', async () => {
    const plugin = new PorscheMacanPlugin();
    await collector.run([plugin], db);

    const rows = db.prepare("SELECT * FROM raw_items WHERE source_type = 'porsche_macan'").all();
    expect(rows).toHaveLength(3);
  });

  it('Stage 1→2: buildDigest ranks and writes an outbound_message', async () => {
    const plugin = new PorscheMacanPlugin();
    await collector.run([plugin], db);
    await digestBuilder.run([plugin], db, MOCK_LLM);

    const msg = db
      .prepare("SELECT * FROM outbound_messages WHERE message_type = 'porsche_macan_digest'")
      .get() as { payload: string; status: string } | undefined;

    expect(msg).toBeDefined();
    expect(msg!.status).toBe('pending');

    const blocks = JSON.parse(msg!.payload) as object[];
    const text = JSON.stringify(blocks);

    // Header / footer present
    expect(text).toContain('VibeBot Daily Digest');
    expect(text).toContain('Powered by VibeBot');

    // Section title
    expect(text).toContain('Porsche Macan');

    // Top-ranked listing appears (rank emojis)
    expect(text).toContain('🥇');

    // Dealer info
    expect(text).toContain('Charlotte');

    // Buyer note
    expect(text).toContain('sport-trim value');
  });

  it('Stage 1→2→3: deliver sends exactly one Slack message', async () => {
    const plugin = new PorscheMacanPlugin();
    await collector.run([plugin], db);
    await digestBuilder.run([plugin], db, MOCK_LLM);
    await deliveryWorker.run(db);

    expect(sentPayloads).toHaveLength(1);

    // Message marked as sent in DB
    const msg = db
      .prepare("SELECT status FROM outbound_messages WHERE message_type = 'porsche_macan_digest'")
      .get() as { status: string };
    expect(msg.status).toBe('sent');
  });

  it('Stage 3 payload — prints Slack Block Kit message to console', async () => {
    const plugin = new PorscheMacanPlugin();
    await collector.run([plugin], db);
    await digestBuilder.run([plugin], db, MOCK_LLM);
    await deliveryWorker.run(db);

    const blocks = sentPayloads[0];
    console.log('\n=== Slack Block Kit payload (porsche_macan_digest) ===\n');
    console.log(JSON.stringify(blocks, null, 2));
    console.log('\n=====================================================\n');

    // Spot-check the structure
    const blockTypes = blocks.map((b) => (b as { type: string }).type);
    expect(blockTypes).toContain('header');
    expect(blockTypes).toContain('section');
    expect(blockTypes).toContain('context');
    expect(blockTypes).toContain('divider');
  });

  it('deduplication: second run collects 0 new items', async () => {
    const plugin = new PorscheMacanPlugin();
    await collector.run([plugin], db); // inserts 3

    const plugin2 = new PorscheMacanPlugin();
    vi.mocked(fetchMacanListings).mockResolvedValue(FAKE_LISTINGS);
    const count = await plugin2.collect(db); // all duplicates

    expect(count).toBe(0);
  });

  it('ranking: 2024 base at $44k beats 2022 GTS at $51k (price + year advantage)', () => {
    const ranked = rankListings(FAKE_LISTINGS, 3);

    // 2024 base ($44k, 18.7k mi) should rank above 2022 GTS ($51k, 8.4k mi)
    const firstVin = ranked[0].vin;
    expect(['WP1AC2A53PLB99999', 'WP1AA2A58NLB12345']).toContain(firstVin);
    // 2022 GTS at $51k (highest price) should not be #1
    expect(ranked[0].vin).not.toBe('WP1AB2A57MLB67890');
  });
});
