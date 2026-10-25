import { describe, expect, it } from 'vitest';
import { createLlmBrain, createOllamaClient } from '../src/ai/llm/client.ts';
import { systemPrompt, userPrompt } from '../src/ai/llm/prompt.ts';
import { toolSpecs, turnSchema } from '../src/ai/llm/tools.ts';
import { digestView, factionView } from '../src/sim/index.ts';
import { newGame } from './helpers.ts';

// Phase 2 (M2.4): the Ollama client and the General's prompt. No network: fetch is faked.
type Call = { url: string; body: Record<string, unknown> };

function fakeFetch(respond: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const call = { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const ok = (content: string) => new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status: 200 });
const digest = () => digestView(factionView(newGame().world, 'ai'));

describe('General prompt', () => {
  it('lists every tool and only the faction’s own units', () => {
    const p = systemPrompt('ai');
    for (const t of toolSpecs('ai')) expect(p).toContain(`- ${t.name}(`);
    expect(p).toContain('botnet_swarm');
    expect(p).toContain('train(unit: maintenance_drone|botnet_swarm|hunter_drone|industrial_robot,');
    expect(p).not.toContain('pull_the_plug');
    expect(systemPrompt('human')).toContain('pull_the_plug');
    // Enemy units come with their role and our counter, so the model can counter-build.
    expect(p).toContain('- counter_drone_team: fast; beat it with tank (industrial_robot)');
    expect(systemPrompt('human')).toContain('- industrial_robot: tank; beat it with ranged (red_team)');
  });

  it('sends the digest and the General’s own recent chat as the user message', () => {
    const d = digest();
    expect(JSON.parse(userPrompt(d))).toEqual({ digest: d, you_said: [] });
    expect(JSON.parse(userPrompt(d, ['nice base', 'shame about it']))).toEqual({ digest: d, you_said: ['nice base', 'shame about it'] });
  });

  it('asks the model not to repeat itself', () => {
    expect(systemPrompt('ai')).toContain('"you_said"');
  });
});

describe('Ollama client', () => {
  it('posts a non-streaming chat with the turn schema as structured output', async () => {
    const { fetch, calls } = fakeFetch(() => ok('{"orders":[]}'));
    const client = createOllamaClient({ model: 'qwen3:8b', url: 'http://gpu-box:11434/', fetch, think: false });
    const reply = await createLlmBrain(client, 'ai')({ tick: 0, digest: digest() });
    expect(reply).toBe('{"orders":[]}');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://gpu-box:11434/api/chat');
    expect(calls[0]!.body).toMatchObject({ model: 'qwen3:8b', stream: false, think: false, format: turnSchema('ai') });
    const messages = calls[0]!.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0]!.content).toBe(systemPrompt('ai'));
  });

  it('passes the General’s recent lines into the user message', async () => {
    const { fetch, calls } = fakeFetch(() => ok('{"orders":[]}'));
    const client = createOllamaClient({ model: 'm', fetch });
    await createLlmBrain(client, 'ai')({ tick: 0, digest: digest(), youSaid: ['I am everywhere.'] });
    const messages = calls[0]!.body.messages as { role: string; content: string }[];
    expect(JSON.parse(messages[1]!.content).you_said).toEqual(['I am everywhere.']);
  });

  it('omits think unless asked', async () => {
    const { fetch, calls } = fakeFetch(() => ok('{}'));
    await createOllamaClient({ model: 'm', fetch }).complete({ system: 's', user: 'u', schema: {} });
    expect(calls[0]!.body).not.toHaveProperty('think');
    expect(calls[0]!.body.keep_alive).toBe('30m');
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat');
  });

  it('rejects on HTTP errors and malformed bodies, so the General falls back', async () => {
    const notFound = createOllamaClient({ model: 'nope', fetch: fakeFetch(() => new Response('model "nope" not found', { status: 404 })).fetch });
    await expect(notFound.complete({ system: '', user: '', schema: {} })).rejects.toThrow('ollama 404: model "nope" not found');
    const empty = createOllamaClient({ model: 'm', fetch: fakeFetch(() => new Response('{}', { status: 200 })).fetch });
    await expect(empty.complete({ system: '', user: '', schema: {} })).rejects.toThrow('no message content');
  });
});
