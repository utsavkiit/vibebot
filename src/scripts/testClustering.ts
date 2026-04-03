/**
 * Offline clustering threshold tester.
 *
 * Reads headlines + pre-computed embeddings from a JSON file (default:
 * gnews_headlines.json in the repo root) and runs clusterByTopic() at one or
 * more thresholds. Prints a human-readable report to stdout — no API, LLM,
 * or Slack calls.
 *
 * Usage:
 *   npx ts-node src/scripts/testClustering.ts --threshold 0.80
 *   npx ts-node src/scripts/testClustering.ts --threshold 0.70,0.75,0.80,0.85
 *   npx ts-node src/scripts/testClustering.ts --threshold 0.80 --verbose
 *   npx ts-node src/scripts/testClustering.ts --threshold 0.80 --input ./my_headlines.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { HeadlineWithEmbedding } from '../plugins/gnews/index';
import { clusterByTopic, TopicGroup } from '../plugins/gnews/clusterer';

// ── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { thresholds: number[]; inputFile: string; verbose: boolean } {
  const args = argv.slice(2);
  let thresholds: number[] = [0.80];
  let inputFile = path.resolve(process.cwd(), 'gnews_headlines.json');
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold' && args[i + 1]) {
      thresholds = args[i + 1].split(',').map((t) => {
        const v = parseFloat(t.trim());
        if (isNaN(v) || v < 0 || v > 1) {
          console.error(`Invalid threshold value: "${t}". Must be a number between 0 and 1.`);
          process.exit(1);
        }
        return v;
      });
      i++;
    } else if (args[i] === '--input' && args[i + 1]) {
      inputFile = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--verbose') {
      verbose = true;
    }
  }

  return { thresholds, inputFile, verbose };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function padLeft(s: string, width: number): string {
  return s.padStart(width);
}

interface ClusterStats {
  threshold: number;
  total: number;
  groups: number;
  singletons: number;
  multiMember: number;
  avgGroupSize: number;
  largest: number;
}

function computeStats(threshold: number, total: number, groups: TopicGroup[]): ClusterStats {
  const singletons = groups.filter((g) => g.headlines.length === 1).length;
  const multiMember = groups.length - singletons;
  const largest = groups.reduce((m, g) => Math.max(m, g.headlines.length), 0);
  const avgGroupSize = groups.length === 0 ? 0 : total / groups.length;
  return { threshold, total, groups: groups.length, singletons, multiMember, avgGroupSize, largest };
}

function printThresholdReport(
  stats: ClusterStats,
  groups: TopicGroup[],
  verbose: boolean,
): void {
  const bar = '═'.repeat(60);
  const divider = '─'.repeat(60);
  const pct = ((stats.singletons / stats.groups) * 100).toFixed(0);

  console.log(`\n${bar}`);
  console.log(` Threshold: ${stats.threshold.toFixed(2)}  |  Headlines: ${stats.total}`);
  console.log(bar);
  console.log(
    ` Groups: ${stats.groups}  |  Singletons: ${stats.singletons} (${pct}%)  |  Multi-member: ${stats.multiMember}  |  Avg size: ${stats.avgGroupSize.toFixed(1)}  |  Largest: ${stats.largest}`,
  );
  console.log(divider);

  groups.forEach((g, idx) => {
    const num = `[${idx + 1}]`;
    const size = `(${g.headlines.length})`;
    const label = g.headlines.length === 1 ? `[singleton] ${g.label}` : g.label;
    console.log(`${padLeft(num, 5)}  ${pad(size, 4)}  ${truncate(label, 90)}`);

    if (verbose && g.headlines.length > 1) {
      for (const h of g.headlines) {
        console.log(`           • ${truncate(h.title, 80)}  (${h.source})`);
      }
    }
  });
}

function printComparisonTable(allStats: ClusterStats[]): void {
  const COL = [11, 8, 13, 11, 14];
  const headers = ['Threshold', 'Groups', 'Singletons', 'Multi-mbr', 'Avg Grp Size'];

  function row(cells: string[]): string {
    return '│ ' + cells.map((c, i) => pad(c, COL[i])).join(' │ ') + ' │';
  }

  function sep(left: string, mid: string, right: string): string {
    return left + COL.map((w) => '─'.repeat(w + 2)).join(mid) + right;
  }

  console.log('\nThreshold Comparison:');
  console.log(sep('┌', '┬', '┐'));
  console.log(row(headers));
  console.log(sep('├', '┼', '┤'));
  for (const s of allStats) {
    const pct = ((s.singletons / s.groups) * 100).toFixed(0);
    console.log(
      row([
        s.threshold.toFixed(2),
        String(s.groups),
        `${s.singletons} (${pct}%)`,
        String(s.multiMember),
        s.avgGroupSize.toFixed(1),
      ]),
    );
  }
  console.log(sep('└', '┴', '┘'));
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { thresholds, inputFile, verbose } = parseArgs(process.argv);

  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    console.error('Run "npm run fetch-gnews" first to generate gnews_headlines.json.');
    process.exit(1);
  }

  console.log(`Loading headlines from: ${inputFile}`);
  const raw = fs.readFileSync(inputFile, 'utf-8');
  const headlines: HeadlineWithEmbedding[] = JSON.parse(raw);
  console.log(`Loaded ${headlines.length} headlines.`);

  const allStats: ClusterStats[] = [];

  for (const threshold of thresholds) {
    const groups = clusterByTopic(headlines, threshold);
    const stats = computeStats(threshold, headlines.length, groups);
    allStats.push(stats);
    printThresholdReport(stats, groups, verbose);
  }

  if (thresholds.length > 1) {
    printComparisonTable(allStats);
  }
}

main();
