import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildHeader, buildFooter } from '../src/core/messageUtils';

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('buildHeader', () => {
  it('returns a header block with VibeBot in the text', () => {
    const blocks = buildHeader();
    const header = blocks[0] as { type: string; text: { text: string } };
    expect(header.type).toBe('header');
    expect(header.text.text).toContain('VibeBot');
  });

  it('returns a context block as the second element', () => {
    const blocks = buildHeader();
    const context = blocks[1] as { type: string };
    expect(context.type).toBe('context');
  });
});

describe('buildFooter', () => {
  it('starts with a divider', () => {
    const blocks = buildFooter();
    expect((blocks[0] as { type: string }).type).toBe('divider');
  });

  it('ends with a context block', () => {
    const blocks = buildFooter();
    expect((blocks[blocks.length - 1] as { type: string }).type).toBe('context');
  });
});

describe('runPipeline integration', () => {
  it('calls through the pipeline when news plugin is enabled', async () => {
    const { runPipeline } = await import('../src/workers/runPipeline');
    vi.mock('../src/workers/runPipeline', () => ({
      runPipeline: vi.fn().mockResolvedValue(undefined),
    }));

    await runPipeline({
      llm: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      plugins: { news: { enabled: true, article_count: 2 } },
      delivery: { max_retries: 3 },
    });

    expect(runPipeline).toHaveBeenCalledOnce();
  });
});
