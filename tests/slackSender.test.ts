import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackSender } from '../src/core/slackSender';

const FAKE_BLOCKS = [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello' } }];

function mockFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('SlackSender', () => {
  it('throws if SLACK_WEBHOOK_URL is not set', () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', '');
    expect(() => new SlackSender()).toThrow('SLACK_WEBHOOK_URL');
  });

  it('POSTs blocks to the webhook URL', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.com/test');
    const fakeFetch = mockFetch(200, 'ok');
    vi.stubGlobal('fetch', fakeFetch);

    await new SlackSender().send(FAKE_BLOCKS);

    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.slack.com/test');
  });

  it('sends blocks in the request body', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.com/test');
    const fakeFetch = mockFetch(200, 'ok');
    vi.stubGlobal('fetch', fakeFetch);

    await new SlackSender().send(FAKE_BLOCKS);

    const [, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.blocks).toEqual(FAKE_BLOCKS);
  });

  it('throws on non-2xx response', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.com/test');
    vi.stubGlobal('fetch', mockFetch(500, 'error'));

    await expect(new SlackSender().send(FAKE_BLOCKS)).rejects.toThrow('500');
  });
});
