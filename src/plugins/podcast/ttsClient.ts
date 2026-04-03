import fs from 'fs';
import path from 'path';

export interface TtsConfig {
  ttsUrl: string;
  voice: string;
  model: string;
  outputDir: string;
  fileBasename?: string;
}

export async function generateAudio(script: string, config: TtsConfig): Promise<string> {
  const outputDir = config.outputDir.replace(/^~/, process.env.HOME ?? '');
  fs.mkdirSync(outputDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const outputPath = path.join(outputDir, `${config.fileBasename ?? date}.mp3`);

  const response = await fetch(`${config.ttsUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      input: script,
      voice: config.voice,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`mlx-audio TTS failed (${response.status}): ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}
