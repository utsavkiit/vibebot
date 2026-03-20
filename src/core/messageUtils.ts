export function buildHeader(): object[] {
  const now = new Date();
  const today = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🤖 VibeBot Daily Digest — ${today}`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Your AI-curated morning briefing  ·  Sent at ${time}`,
        },
      ],
    },
  ];
}

export function buildFooter(): object[] {
  return [
    { type: 'divider' },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '🤖 _Powered by VibeBot_' }],
    },
  ];
}
