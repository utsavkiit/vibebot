import { Embeddings } from '@langchain/core/embeddings';

export interface EmbedderConfig {
  provider: string;
  model: string;
}

export function getEmbedder(config: EmbedderConfig): Embeddings {
  const { provider, model } = config;

  if (provider === 'ollama') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OllamaEmbeddings } = require('@langchain/ollama');
    return new OllamaEmbeddings({ model });
  }

  if (provider === 'openai') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OpenAIEmbeddings } = require('@langchain/openai');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set in the environment.');
    return new OpenAIEmbeddings({ model, apiKey });
  }

  throw new Error(
    `Unsupported embeddings provider: '${provider}'. Supported providers: 'ollama', 'openai'.`,
  );
}
