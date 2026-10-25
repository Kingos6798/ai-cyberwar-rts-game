// Picks the LLM client for the headless scripts (llm-turn, llm-match). D-020: `--provider openai` uses an
// OpenAI-compatible API; the key comes only from OPENAI_API_KEY (a local .env or the shell), never from args.
import { createOllamaClient, type LlmClient } from '../src/ai/llm/client.ts';
import { createOpenAiClient } from '../src/ai/llm/openai.ts';

export function clientFromArgs(v: { provider?: string; model: string; url: string; 'no-think'?: boolean }): LlmClient {
  if (v.provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('--provider openai needs OPENAI_API_KEY in the environment (for example in a local .env, which git ignores).');
      process.exit(2);
    }
    const baseUrl = process.env.OPENAI_BASE_URL;
    return createOpenAiClient({ model: v.model, apiKey, ...(baseUrl ? { baseUrl } : {}) });
  }
  return createOllamaClient({ model: v.model, url: v.url, ...(v['no-think'] ? { think: false } : {}) });
}
