// LLM providers for the General (Phase 2, M2.4). One small interface so the General never cares which
// model answers. Ollama runs locally; the cloud provider (OpenAI-compatible, the player's own key; D-020)
// lives in openai.ts.
import type { Faction } from '../../sim/index.ts';
import type { Brain } from './general.ts';
import { systemPrompt, userPrompt } from './prompt.ts';
import { turnSchema } from './tools.ts';

export interface LlmRequest {
  system: string;
  user: string;
  /** JSON Schema the reply must follow (structured output). */
  schema: Record<string, unknown>;
}

export interface LlmClient {
  readonly name: string;
  /** The model's reply text. Rejects on transport or provider errors. */
  complete(req: LlmRequest, signal?: AbortSignal): Promise<string>;
}

export interface OllamaOptions {
  model: string;
  /** Default http://localhost:11434. */
  url?: string;
  temperature?: number;
  /** Thinking models (e.g. Qwen3): false skips the slow reasoning pass. Omitted by default. */
  think?: boolean;
  /** How long Ollama keeps the model loaded after a call. Default 30m: a reload mid-match takes over a minute. */
  keepAlive?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

export function createOllamaClient(opts: OllamaOptions): LlmClient {
  const url = (opts.url ?? 'http://localhost:11434').replace(/\/$/, '');
  // Wrapped so the browser calls fetch with the right receiver.
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return {
    name: `ollama:${opts.model}`,
    async complete(req, signal) {
      const res = await doFetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: opts.model,
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
          format: req.schema,
          stream: false,
          options: { temperature: opts.temperature ?? 0.7 },
          keep_alive: opts.keepAlive ?? '30m',
          ...(opts.think === undefined ? {} : { think: opts.think }),
        }),
        signal,
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json() as { message?: { content?: unknown } };
      if (typeof body.message?.content !== 'string') throw new Error('ollama: reply has no message content');
      return body.message.content;
    },
  };
}

/** A Brain backed by an LLM. Requests past `timeoutMs` are aborted; the General treats them as late. */
export function createLlmBrain(client: LlmClient, faction: Faction, opts: { timeoutMs?: number } = {}): Brain {
  const system = systemPrompt(faction);
  const schema = turnSchema(faction);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return ({ digest, youSaid }) => client.complete({ system, user: userPrompt(digest, youSaid), schema }, AbortSignal.timeout(timeoutMs));
}
