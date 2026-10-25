// OpenAI-compatible provider for the General (D-020): OpenAI, or any service with the same
// `/chat/completions` API (OpenRouter, Groq, LM Studio, Ollama's /v1). The player brings their own key;
// it goes only in the Authorization header, never in a URL, a log or an error message.
import type { LlmClient } from './client.ts';

export interface OpenAiOptions {
  model: string;
  apiKey: string;
  /** Default https://api.openai.com/v1. */
  baseUrl?: string;
  /** Omitted unless set: some models only accept their default temperature. */
  temperature?: number;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/** Hide anything that looks like a key, in case a provider echoes it in an error. */
export const redactKeys = (text: string): string => text.replace(/\b(sk|rk|gsk)-[\w-]{6,}/g, '$1-…');

export function createOpenAiClient(opts: OpenAiOptions): LlmClient {
  const base = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  // Wrapped so the browser calls fetch with the right receiver.
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return {
    name: `openai:${opts.model}`,
    async complete(req, signal) {
      // In a browser, OpenAI's error replies (e.g. 401 for a wrong key) carry no CORS header, so they surface
      // as a bare network error. Say what to check instead of "Failed to fetch".
      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
          // JSON mode is the widest-supported structured output across compatible providers; the turn
          // validator checks the shape (tools.ts), so a reply that drifts from the schema is caught there.
          response_format: { type: 'json_object' },
          ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
        }),
        signal,
      }).catch((e: unknown) => {
        if (signal?.aborted) throw e;
        throw new Error('openai: request failed (wrong API key or model, or no network). Reload with &newkey to enter the key again.');
      });
      if (!res.ok) throw new Error(redactKeys(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`));
      const body = await res.json() as { choices?: { message?: { content?: unknown } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('openai: reply has no message content');
      return content;
    },
  };
}
