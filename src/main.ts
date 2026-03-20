/**
 * VibeBot — main entry point.
 *
 * Loads enabled plugins from config.yaml and runs the 3-stage pipeline:
 *   Stage 1 — Collect:  fetch raw data and store in the database
 *   Stage 2 — Build:    summarize with LLM and build Slack blocks
 *   Stage 3 — Deliver:  send queued messages with retry and failure notification
 *
 * Usage:
 *   node dist/main.js
 *
 * Scheduling (Mac mini — launchd):
 *   See com.vibebot.plist in the repo root.
 */

import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import * as dotenv from 'dotenv';
import { runPipeline } from './workers/runPipeline';

const repoRoot = path.resolve(__dirname, '..');

function loadConfig(configPath: string): object {
  const content = fs.readFileSync(configPath, 'utf8');
  return yaml.load(content) as object;
}

async function main(): Promise<void> {
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const configPath = path.join(repoRoot, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    console.error(`config.yaml not found at ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  await runPipeline(config as Parameters<typeof runPipeline>[0]);
  console.info('VibeBot pipeline complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
