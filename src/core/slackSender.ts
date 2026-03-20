export class SlackSender {
  private webhookUrl: string;

  constructor(webhookUrl?: string) {
    const url = webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
    if (!url) throw new Error('SLACK_WEBHOOK_URL is not set in the environment.');
    this.webhookUrl = url;
  }

  async send(blocks: object[]): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}: ${await response.text()}`);
    }
  }
}
