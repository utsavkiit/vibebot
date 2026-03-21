/**
 * Converts Slack Block Kit JSON (as used by VibeBot digests) into clean plain text
 * suitable for use in a podcast script prompt.
 */

interface Block {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text: string }>;
}

function stripMrkdwn(text: string): string {
  return text
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2') // <url|label> → label
    .replace(/<[^>]+>/g, '')               // <url> → remove
    .replace(/\*([^*]+)\*/g, '$1')         // *bold* → bold
    .replace(/_([^_]+)_/g, '$1')           // _italic_ → italic
    .replace(/~([^~]+)~/g, '$1')           // ~strike~ → text
    .replace(/^\s*\d+\.\s+/, '')           // leading "1. " numbering
    .trim();
}

export function extractTextFromBlocks(blocks: Block[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.type === 'divider') continue;

    if (block.type === 'header' && block.text?.text) {
      // Skip the "VibeBot Daily Digest" header — the script writer handles the intro
      continue;
    }

    if (block.type === 'section' && block.text?.text) {
      const cleaned = stripMrkdwn(block.text.text);
      if (cleaned) lines.push(cleaned);
    }

    if (block.type === 'context' && block.elements) {
      for (const el of block.elements) {
        if (!el.text) continue;
        const cleaned = stripMrkdwn(el.text);
        // Skip footer and source attribution lines
        if (cleaned.includes('Powered by VibeBot') || cleaned.includes('AI-curated')) continue;
        if (cleaned.startsWith('📌')) continue; // source bylines, not needed in script
        if (cleaned) lines.push(cleaned);
      }
    }
  }

  return lines.join('\n');
}
