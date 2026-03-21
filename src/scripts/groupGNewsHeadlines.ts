import path from 'path';
import fs from 'fs';
import { HeadlineWithEmbedding } from '../plugins/gnews/index';
import { clusterByTopic, TopicGroup } from '../plugins/gnews/clusterer';

const repoRoot = path.resolve(__dirname, '../..');

function main(): void {
  const inputPath = path.join(repoRoot, 'gnews_headlines.json');
  if (!fs.existsSync(inputPath)) {
    console.error('gnews_headlines.json not found — run `npm run fetch-gnews` first.');
    process.exit(1);
  }

  const headlines: HeadlineWithEmbedding[] = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  console.info(`Loaded ${headlines.length} headlines.`);

  const threshold = parseFloat(process.env.CLUSTER_THRESHOLD ?? '0.70');
  console.info(`Clustering with cosine similarity threshold: ${threshold}\n`);

  const groups: TopicGroup[] = clusterByTopic(headlines, threshold);

  // Print results
  groups.forEach((group, i) => {
    console.info(`── Group ${i + 1} (${group.headlines.length} article${group.headlines.length > 1 ? 's' : ''})`);
    console.info(`   Topic: ${group.label}`);
    group.headlines.forEach((h) => {
      console.info(`   • [${h.source}] ${h.title}`);
    });
    console.info('');
  });

  console.info(`Total groups: ${groups.length} from ${headlines.length} articles`);

  // Save grouped output
  const outputPath = path.join(repoRoot, 'gnews_groups.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      groups.map((g) => ({
        label: g.label,
        size: g.headlines.length,
        headlines: g.headlines.map(({ vector: _v, ...rest }) => rest),
      })),
      null,
      2,
    ),
    'utf8',
  );
  console.info(`\nSaved to ${outputPath}`);
}

main();
