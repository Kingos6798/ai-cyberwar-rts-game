// Headless match runner.
// Usage: npm run sim -- --matches 10 --minutes 20 --seed 1 --human boom --ai rush [--map duel|long] [--difficulty easy|normal|hard] [--max-ms 10000] [--verbose]
// --difficulty handicaps the AI side only (src/ai/difficulty.ts); default hard = the AI as balanced.
// --max-ms: performance budget per match; exits non-zero if any match is slower (used by CI).
import { parseArgs } from 'node:util';
import { DIFFICULTY, isDifficulty } from '../src/ai/difficulty.ts';
import { createScriptedBot, OPPONENTS } from '../src/ai/scripted.ts';
import { runMatch } from '../src/harness/match.ts';
import { describeView, factionView, hashWorld, MAPS, TICK_RATE } from '../src/sim/index.ts';

const { values } = parseArgs({
  options: {
    matches: { type: 'string', default: '1' },
    minutes: { type: 'string', default: '20' },
    seed: { type: 'string', default: '1' },
    human: { type: 'string', default: 'boom' },
    ai: { type: 'string', default: 'boom' },
    map: { type: 'string', default: 'duel' },
    difficulty: { type: 'string', default: 'hard' },
    'max-ms': { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
});

const humanStrategy = OPPONENTS[values.human];
const aiStrategy = OPPONENTS[values.ai];
if (!isDifficulty(values.difficulty)) {
  console.error('unknown difficulty; choose from: easy, normal, hard');
  process.exit(2);
}
const level = DIFFICULTY[values.difficulty];
if (!MAPS[values.map]) {
  console.error(`unknown map; choose from: ${Object.keys(MAPS).join(', ')}`);
  process.exit(2);
}
if (!humanStrategy || !aiStrategy) {
  console.error(`unknown strategy; choose from: ${Object.keys(OPPONENTS).join(', ')}`);
  process.exit(2);
}

const matches = Number(values.matches);
const maxTicks = Number(values.minutes) * 60 * TICK_RATE;
const baseSeed = Number(values.seed);
const maxMs = values['max-ms'] === undefined ? Infinity : Number(values['max-ms']);

const wins = { human: 0, ai: 0, draw: 0 };
let totalTicks = 0;
let slowest = 0;
const start = performance.now();
for (let i = 0; i < matches; i++) {
  const seed = baseSeed + i;
  const matchStart = performance.now();
  const r = runMatch({
    seed, maxTicks, mapId: values.map,
    human: createScriptedBot('human', humanStrategy, seed),
    ai: createScriptedBot('ai', level.tweak(aiStrategy), seed * 7919),
    pacing: { ai: { apm: level.apm, reactionDelay: level.reactionDelay } },
  });
  const ms = performance.now() - matchStart;
  slowest = Math.max(slowest, ms);
  wins[r.winner ?? 'draw']++;
  totalTicks += r.ticks;
  const mins = (r.ticks / TICK_RATE / 60).toFixed(1);
  console.log(`match ${i + 1}: seed ${seed} winner=${r.winner ?? 'draw'} after ${mins} min ${hashWorld(r.game.world)} (${ms.toFixed(0)} ms)`);
  if (values.verbose) {
    console.log(describeView(factionView(r.game.world, 'human')));
    console.log(describeView(factionView(r.game.world, 'ai')));
  }
}
const pctOf = (n: number) => `${Math.round((100 * n) / matches)}%`;
console.log(`human(${humanStrategy.name}) ${pctOf(wins.human)} | ai(${aiStrategy.name}) ${pctOf(wins.ai)} | draw ${pctOf(wins.draw)}`
  + ` | avg ${(totalTicks / matches / TICK_RATE / 60).toFixed(1)} min | ${(performance.now() - start).toFixed(0)} ms total`);

if (slowest > maxMs) {
  console.error(`FAIL: slowest match took ${slowest.toFixed(0)} ms, budget is ${maxMs} ms`);
  process.exit(1);
}
