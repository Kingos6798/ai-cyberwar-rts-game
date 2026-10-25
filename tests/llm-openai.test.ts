import { describe, expect, it } from 'vitest';
import { createLlmBrain } from '../src/ai/llm/client.ts';
import { forgetKey, loadKey, saveKey, type KeyStorage } from '../src/ai/llm/keystore.ts';
import { createOpenAiClient, redactKeys } from '../src/ai/llm/openai.ts';
import { systemPrompt } from '../src/ai/llm/prompt.ts';
import { digestView, factionView } from '../src/sim/index.ts';
import { newGame } from './helpers.ts';

// D-020: an OpenAI-compatible cloud General with the player's own key. No network: fetch is faked.
type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function fakeFetch(respond: () => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) as Record<string, unknown> });
    return respond();
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200 });
const KEY = 'sk-test-0123456789abcdef';

describe('OpenAI-compatible client', () => {
  it('posts a JSON-mode chat completion with the key only in the Authorization header', async () => {
    const { fetch, calls } = fakeFetch(() => reply('{"orders":[]}'));
    const client = createOpenAiClient({ model: 'some-model', apiKey: KEY, fetch });
    const out = await createLlmBrain(client, 'ai')({ tick: 0, digest: digestView(factionView(newGame().world, 'ai')) });
    expect(out).toBe('{"orders":[]}');
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]!.url).not.toContain(KEY);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.body).toMatchObject({ model: 'some-model', response_format: { type: 'json_object' } });
    expect(calls[0]!.body).not.toHaveProperty('temperature');
    expect(JSON.stringify(calls[0]!.body)).not.toContain(KEY);
    const messages = calls[0]!.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0]!.content).toBe(systemPrompt('ai'));
  });

  it('supports another compatible base URL (headless only)', async () => {
    const { fetch, calls } = fakeFetch(() => reply('{}'));
    await createOpenAiClient({ model: 'm', apiKey: KEY, baseUrl: 'http://localhost:1234/v1/', fetch }).complete({ system: '', user: '', schema: {} });
    expect(calls[0]!.url).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('rejects on errors without ever repeating the key', async () => {
    const echo = new Response(`{"error":{"message":"Incorrect API key provided: ${KEY}"}}`, { status: 401 });
    const client = createOpenAiClient({ model: 'm', apiKey: KEY, fetch: fakeFetch(() => echo).fetch });
    const err = await client.complete({ system: '', user: '', schema: {} }).catch((e: Error) => e.message);
    expect(err).toContain('openai 401');
    expect(err).not.toContain(KEY);
    const empty = createOpenAiClient({ model: 'm', apiKey: KEY, fetch: fakeFetch(() => new Response('{}', { status: 200 })).fetch });
    await expect(empty.complete({ system: '', user: '', schema: {} })).rejects.toThrow('no message content');
    expect(redactKeys('key sk-proj-abc123def456 here')).toBe('key sk-… here');
    // Browsers report OpenAI's CORS-less 401 as a bare network error; the message says what to check.
    const blocked = createOpenAiClient({ model: 'm', apiKey: KEY, fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    await expect(blocked.complete({ system: '', user: '', schema: {} })).rejects.toThrow('&newkey');
  });
});

describe('player key storage', () => {
  const mem = (): KeyStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
  };

  it('keeps the key for the session unless asked to remember it', () => {
    const [s, l] = [mem(), mem()];
    saveKey(` ${KEY} `, false, s, l);
    expect([s.data.size, l.data.size]).toEqual([1, 0]);
    expect(loadKey(s, l)).toBe(KEY);
    saveKey(KEY, true, s, l);
    expect([s.data.size, l.data.size]).toEqual([0, 1]);
    forgetKey(s, l);
    expect(loadKey(s, l)).toBeNull();
  });

  it('survives storage that throws (private mode)', () => {
    const broken: KeyStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(() => saveKey(KEY, true, broken, broken)).not.toThrow();
    expect(loadKey(broken, broken)).toBeNull();
  });
});
