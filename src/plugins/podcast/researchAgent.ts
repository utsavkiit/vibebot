import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicTool } from '@langchain/core/tools';
import { HeadlineWithEmbedding } from '../gnews/index';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

export function createWebSearchTool(tavilyApiKey: string): DynamicTool {
  return new DynamicTool({
    name: 'web_search',
    description:
      'Search the web for recent news articles about a topic. Returns titles and content snippets. Use this to research a story in depth before writing.',
    func: async (query: string) => {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query,
          max_results: 5,
          topic: 'news',
          time_range: 'week',
        }),
      });

      if (!response.ok) {
        throw new Error(`Tavily API error ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as TavilyResponse;
      const results = data.results ?? [];

      if (results.length === 0) return 'No results found.';

      return results
        .map((r, i) => `[${i + 1}] ${r.title ?? 'No title'}\n${r.content ?? ''}`)
        .join('\n\n');
    },
  });
}

const SYSTEM_PROMPT = `You are a radio journalist preparing a deeply researched 2-minute podcast segment.

Your task:
1. You will be given a news topic and a few seed headlines as context.
2. Use the web_search tool 2-3 times to research the topic in depth — dig into key facts, why it matters, and what's at stake.
3. After researching, write a ~300-word spoken segment (about 2 minutes at normal speaking pace).

Writing rules for the final segment:
- Natural spoken English only — no bullet points, no markdown, no emoji, no URLs
- Spell out all abbreviations (e.g. "the United States" not "US", "artificial intelligence" not "AI")
- Spell out numbers and symbols (e.g. "three point five billion dollars" not "$3.5B")
- Radio journalist tone — authoritative, clear, engaging
- Cover: what happened, why it matters, what comes next
- When you are done researching and ready to write the final segment, output ONLY the spoken segment text with no preamble`;

/**
 * Runs a tool-calling research agent for a single news topic.
 * The agent searches the web 2-3 times, then writes a ~300-word spoken
 * podcast segment based on what it finds.
 *
 * @param llm          LangChain chat model with tool calling support (e.g. gemma3 via Ollama)
 * @param label        The topic label (most central headline title from the cluster)
 * @param headlines    The cluster's headlines as seed context
 * @param tavilyKey    Tavily API key
 * @param maxSearches  Max web_search calls before forcing the final write (default: 3)
 */
export async function researchTopicSegment(
  llm: BaseChatModel,
  label: string,
  headlines: HeadlineWithEmbedding[],
  tavilyKey: string,
  maxSearches = 3,
): Promise<string> {
  const searchTool = createWebSearchTool(tavilyKey);

  if (!llm.bindTools) {
    throw new Error(
      'LLM does not support tool calling. Use a model with tool call support (e.g. gemma3 via Ollama, or Claude/OpenAI).',
    );
  }
  const llmWithTools = llm.bindTools([searchTool]);

  const seedContext = headlines
    .slice(0, 6)
    .map((h) => `- ${h.title} (${h.source})`)
    .join('\n');

  const userPrompt =
    `Research this news topic and write a 2-minute spoken podcast segment about it.\n\n` +
    `Topic: ${label}\n\n` +
    `Seed headlines from our feed:\n${seedContext}\n\n` +
    `Search for more context, then write the segment.`;

  const messages: (HumanMessage | SystemMessage | ToolMessage | Awaited<ReturnType<typeof llmWithTools.invoke>>)[] = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ];

  let searchCount = 0;

  // Tool-calling loop
  while (searchCount < maxSearches) {
    const response = await llmWithTools.invoke(messages);
    messages.push(response);

    const toolCalls = (response as { tool_calls?: { id: string; name: string; args: { input?: string } | string }[] }).tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // Model returned a final answer without calling tools
      return (response.content as string).trim();
    }

    // Execute all tool calls
    for (const call of toolCalls) {
      searchCount++;
      const query = typeof call.args === 'string' ? call.args : (call.args.input ?? JSON.stringify(call.args));
      console.info(`  → search: "${query}"`);

      let result: string;
      try {
        result = await searchTool.func(query);
      } catch (err) {
        result = `Search failed: ${(err as Error).message}`;
      }

      messages.push(new ToolMessage({ content: result, tool_call_id: call.id }));
    }
  }

  // Force final write after maxSearches
  messages.push(
    new HumanMessage(
      'You have enough research. Now write the 2-minute spoken podcast segment. Output only the segment text.',
    ),
  );
  const finalResponse = await llm.invoke(messages);
  return (finalResponse.content as string).trim();
}
