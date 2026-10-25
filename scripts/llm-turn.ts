// One LLM General turn against a real model, for checking a model before batch runs.
// Plays scripted bots to a mid-game state, sends that faction's digest, and prints the reply,
// validation result, planned commands and latency.
// Usage: npm run llm-turn -- --model qwen3:8b [--url http://localhost:11434] [--minutes 4] [--faction ai] [--seed 3] [--no-think] [--digest]
import { parseArgs } from 'node:util';
import { createLlmBrain } from '../src/ai/llm/client.ts';
import { clientFromArgs } from './llm-provider.ts';
import { planTurn } from '../src/ai/llm/plan.ts';
import { systemPrompt } from '../src/ai/llm/prompt.ts';
import { parseTurn } from '../src/ai/llm/tools.ts';
import { createScriptedBot, STRATEGIES } from '../src/ai/scripted.ts';
import { runMatch } from '../src/harness/match.ts';
import { digestView, factionView, TICK_RATE, type Faction } from '../src/sim/index.ts';

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'ollama' },
    model: { type: 'string', default: 'qwen3:8b' },
    url: { type: 'string', default: process.env.OLLAMA_URL ?? 'http://localhost:11434' },
    minutes: { type: 'string', default: '4' },
    faction: { type: 'string', default: 'ai' },
    seed: { type: 'string', default: '3' },
    'no-think': { type: 'boolean', default: false },
    digest: { type: 'boolean', default: false },
  },
});
const faction = values.faction as Faction;
if (faction !== 'ai' && faction !== 'human') {
  console.error('--faction must be ai or human');
  process.exit(2);
}

const seed = Number(values.seed);
const { game } = runMatch({
  seed, maxTicks: Number(values.minutes) * 60 * TICK_RATE,
  human: createScriptedBot('human', STRATEGIES.boom!, seed), ai: createScriptedBot('ai', STRATEGIES.boom!, seed),
});
const view = factionView(game.world, faction);
const digest = digestView(view);
const client = clientFromArgs(values);
const brain = createLlmBrain(client, faction, { timeoutMs: 120_000 });

console.log(`model ${client.name}, ${faction} at ${digest.t}; system prompt ${systemPrompt(faction).length} chars, digest ${JSON.stringify(digest).length} chars`);
if (values.digest) console.log(`digest: ${JSON.stringify(digest)}`);
const start = performance.now();
let reply: unknown;
try {
  reply = await brain({ tick: view.tick, digest });
} catch (e) {
  console.error(`request failed: ${String(e)}`);
  console.error(`Is Ollama running at ${values.url}? Try: ollama serve, then ollama pull ${values.model}`);
  process.exit(1);
}
const ms = Math.round(performance.now() - start);
console.log(`latency ${ms} ms (${Math.ceil((ms * TICK_RATE) / 1000)} ticks)`);
console.log(`reply: ${String(reply)}`);
const { calls, errors } = parseTurn(faction, reply);
const plan = planTurn(view, calls);
console.log(`valid orders: ${calls.length}, schema errors: ${errors.length}`);
for (const e of [...errors, ...plan.errors]) console.log(`  error: ${e}`);
for (const c of plan.commands) console.log(`  command: ${JSON.stringify(c)}`);
for (const m of plan.chat) console.log(`  chat: ${m}`);
