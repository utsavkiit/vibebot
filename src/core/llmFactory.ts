import { BaseChatModel } from '@langchain/core/language_models/chat_models';

export function getLlm(provider: string, model: string): BaseChatModel {
  if (provider === 'anthropic') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ChatAnthropic } = require('@langchain/anthropic');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in the environment.');
    return new ChatAnthropic({ model, apiKey });
  }

  if (provider === 'openai') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ChatOpenAI } = require('@langchain/openai');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set in the environment.');
    return new ChatOpenAI({ model, apiKey });
  }

  if (provider === 'ollama') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ChatOllama } = require('@langchain/ollama');
    return new ChatOllama({ model });
  }

  throw new Error(
    `Unsupported LLM provider: '${provider}'. Supported providers: 'anthropic', 'openai', 'ollama'.`,
  );
}
