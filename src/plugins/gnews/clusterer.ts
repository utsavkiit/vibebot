import { HeadlineWithEmbedding } from './index';

export interface TopicGroup {
  label: string; // title of the most central headline
  headlines: HeadlineWithEmbedding[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Greedy single-pass clustering by cosine similarity (seed-based).
 *
 * For each unassigned headline, seed a new group and pull in all remaining
 * unassigned headlines whose similarity to the seed exceeds `threshold`.
 * The group label is the title of the most central member (highest avg
 * similarity to the rest of the group).
 *
 * Uses seed-based (not average-linkage) comparison to prevent unrelated
 * articles from chaining into the same group via intermediaries.
 *
 * @param headlines  Array of headlines with embedding vectors
 * @param threshold  Cosine similarity cutoff (0–1). Default 0.70.
 */
export function clusterByTopic(
  headlines: HeadlineWithEmbedding[],
  threshold = 0.70,
): TopicGroup[] {
  const assigned = new Array(headlines.length).fill(false);
  const groups: TopicGroup[] = [];

  for (let i = 0; i < headlines.length; i++) {
    if (assigned[i]) continue;

    const members: number[] = [i];
    assigned[i] = true;

    for (let j = i + 1; j < headlines.length; j++) {
      if (assigned[j]) continue;
      if (cosine(headlines[i].vector, headlines[j].vector) >= threshold) {
        members.push(j);
        assigned[j] = true;
      }
    }

    // Pick the most central headline as group label
    let bestIdx = members[0];
    if (members.length > 1) {
      let bestAvg = -Infinity;
      for (const mi of members) {
        const sims = members
          .filter((mj) => mj !== mi)
          .map((mj) => cosine(headlines[mi].vector, headlines[mj].vector));
        const avg = sims.reduce((s, v) => s + v, 0) / sims.length;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestIdx = mi;
        }
      }
    }

    groups.push({
      label: headlines[bestIdx].title,
      headlines: members.map((idx) => headlines[idx]),
    });
  }

  // Largest groups first
  return groups.sort((a, b) => b.headlines.length - a.headlines.length);
}
