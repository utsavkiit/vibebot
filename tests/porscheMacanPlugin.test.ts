import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { initDb, getConnection } from '../src/core/db';
import { PorscheMacanPlugin } from '../src/plugins/porscheMacan';
import { rankListings } from '../src/plugins/porscheMacan/formatter';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

vi.mock('../src/plugins/porscheMacan/fetcher');
vi.mock('../src/plugins/porscheMacan/formatter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/plugins/porscheMacan/formatter')>();
  return { ...actual, generateBuyersNote: vi.fn().mockResolvedValue('') };
});

import { fetchMacanListings } from '../src/plugins/porscheMacan/fetcher';
import { generateBuyersNote } from '../src/plugins/porscheMacan/formatter';

const FAKE_LISTINGS = [
  {
    vin: 'VIN1',
    year: 2023,
    make: 'Porsche',
    model: 'Macan',
    trim: 'S',
    price: 48000,
    mileage: 12000,
    dealerName: 'Dealer A',
    dealerCity: 'Charlotte',
    dealerState: 'NC',
    url: 'https://example.com/1',
  },
  {
    vin: 'VIN2',
    year: 2022,
    make: 'Porsche',
    model: 'Macan',
    trim: 'Base',
    price: 42000,
    mileage: 22000,
    dealerName: 'Dealer B',
    dealerCity: 'Rock Hill',
    dealerState: 'SC',
    url: 'https://example.com/2',
  },
];

const MOCK_LLM = {} as BaseChatModel;

let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dbPath = join(tmpdir(), `vibebot-macan-test-${Date.now()}-${Math.random()}.db`);
  initDb(dbPath);
  db = getConnection(dbPath);
  vi.clearAllMocks();
  vi.mocked(generateBuyersNote).mockResolvedValue('Great value pick.');
});

afterEach(() => {
  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe('PorscheMacanPlugin.collect', () => {
  it('returns count of new (non-duplicate) items', async () => {
    vi.mocked(fetchMacanListings).mockResolvedValue(FAKE_LISTINGS);

    const plugin = new PorscheMacanPlugin();
    const count = await plugin.collect(db);

    expect(count).toBe(2);
  });

  it('skips duplicate listings (same VIN)', async () => {
    vi.mocked(fetchMacanListings).mockResolvedValue(FAKE_LISTINGS);

    const plugin = new PorscheMacanPlugin();
    await plugin.collect(db);
    const count = await plugin.collect(db);

    expect(count).toBe(0);
  });

  it('calls fetchMacanListings once', async () => {
    vi.mocked(fetchMacanListings).mockResolvedValue(FAKE_LISTINGS);

    const plugin = new PorscheMacanPlugin();
    await plugin.collect(db);

    expect(fetchMacanListings).toHaveBeenCalledOnce();
  });
});

describe('PorscheMacanPlugin.buildDigest', () => {
  it('returns null when there are no pending items', async () => {
    const plugin = new PorscheMacanPlugin();
    const result = await plugin.buildDigest(db, MOCK_LLM);
    expect(result).toBeNull();
  });

  it('returns a message id when digest is built', async () => {
    vi.mocked(fetchMacanListings).mockResolvedValue(FAKE_LISTINGS);

    const plugin = new PorscheMacanPlugin();
    await plugin.collect(db);
    const msgId = await plugin.buildDigest(db, MOCK_LLM);

    expect(typeof msgId).toBe('number');
    expect(msgId).toBeGreaterThan(0);
  });

  it('marks all items as processed after building', async () => {
    vi.mocked(fetchMacanListings).mockResolvedValue(FAKE_LISTINGS);

    const plugin = new PorscheMacanPlugin();
    await plugin.collect(db);
    await plugin.buildDigest(db, MOCK_LLM);

    const pending = db.prepare("SELECT * FROM raw_items WHERE status = 'pending'").all();
    expect(pending).toHaveLength(0);
  });

  it('payload contains listing content', async () => {
    vi.mocked(fetchMacanListings).mockResolvedValue(FAKE_LISTINGS);

    const plugin = new PorscheMacanPlugin();
    await plugin.collect(db);
    const msgId = await plugin.buildDigest(db, MOCK_LLM);

    const row = db
      .prepare('SELECT payload FROM outbound_messages WHERE id = ?')
      .get(msgId) as { payload: string };
    expect(row.payload).toContain('Charlotte');
    expect(row.payload).toContain('48,000');
  });
});

describe('rankListings', () => {
  it('returns top N listings', () => {
    expect(rankListings(FAKE_LISTINGS, 1)).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(rankListings([])).toHaveLength(0);
  });

  it('prefers lower price when mileage and year are equal', () => {
    const listings = [
      { ...FAKE_LISTINGS[0], price: 50000, mileage: 10000, year: 2023 },
      { ...FAKE_LISTINGS[1], price: 40000, mileage: 10000, year: 2023 },
    ];
    const ranked = rankListings(listings, 2);
    expect(ranked[0].price).toBe(40000);
  });
});
