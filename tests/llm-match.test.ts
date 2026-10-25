import { describe, expect, it } from 'vitest';
import { createGeneral, type TurnLog } from '../src/ai/llm/general.ts';
import { matchResults, turnStats, type MatchRecord } from '../src/ai/llm/stats.ts';
import { createScriptedBot, STRATEGIES } from '../src/ai/scripted.ts';
import { runMatch, runMatchAsync } from '../src/harness/match.ts';
import { attackEveryTurn, createControl } from '../src/ai/llm/control.ts';
import { pressureTest } from '../src/harness/balance.ts';
import { DATA_VERSION, digestView, factionView, GAME_VERSION } from '../src/sim/index.ts';
import { newGame } from './helpers.ts';

// Phase 2: full matches against a real (async) model, and the Gate 2 numbers from its turn log.
const boom = STRATEGIES.boom!;
const turn = JSON.stringify({ orders: [{ tool: 'expand', args: {} }] });

describe('async LLM matches', () => {
  it('runMatchAsync plays sync controllers exactly like runMatch', async () => {
    const opts = () => ({ seed: 2, maxTicks: 3 * 60 * 20, human: createScriptedBot('human', boom, 2), ai: createScriptedBot('ai', boom, 2) });
    expect((await runMatchAsync(opts())).game.log).toEqual(runMatch(opts()).game.log);
  });

  it('lockstep: the sim waits for a slow reply, which then costs its measured latency in ticks', async () => {
    const slow = () => new Promise<string>((r) => setTimeout(() => r(turn), 300));
    const general = createGeneral('ai', slow, boom, { seed: 2, lockstep: true });
    await runMatchAsync({ seed: 2, maxTicks: 60 * 20, human: createScriptedBot('human', boom, 2), ai: general });
    expect(general.log.length).toBe(3);
    for (const t of general.log) {
      expect(t.fallback).toBeNull();
      // 300 ms is 6 ticks; the reply applies at the next decision after that.
      expect(t.latency).toBeGreaterThanOrEqual(6);
      expect(t.latency).toBeLessThanOrEqual(20);
    }
  });

  it('lockstep: a reply slower than the timeout is still late', async () => {
    const slow = () => new Promise<string>((r) => setTimeout(() => r(turn), 150));
    const general = createGeneral('ai', slow, boom, { seed: 2, lockstep: true, timeout: 2 });
    await runMatchAsync({ seed: 2, maxTicks: 30, human: createScriptedBot('human', boom, 2), ai: general });
    expect(general.log[0]).toMatchObject({ fallback: 'late', latency: null });
  });
});

describe('Gate 2 control (D-018)', () => {
  it('orders an attack on the enemy core every turn', () => {
    const d = digestView(factionView(newGame().world, 'ai'));
    expect(JSON.parse(attackEveryTurn({ tick: 0, digest: d }) as string)).toEqual({ orders: [{ tool: 'attack_sector', args: { sector: 'W' } }] });
  });

  it('pressure test plays the control against every strategy on both sides', () => {
    const r = pressureTest(1, 2);
    expect(r).toHaveLength(Object.keys(STRATEGIES).length * 2);
    for (const x of r) expect(x.controlWinPct).toBeGreaterThanOrEqual(0);
    expect(r.every((x) => x.controlWinPct <= 100)).toBe(true);
  });
});

describe('turn stats', () => {
  const t = (over: Partial<TurnLog>): TurnLog => ({ tick: 0, latency: 20, reply: '', calls: [], rejected: 0, errors: [], fallback: null, chat: [], ...over });
  it('counts invalid orders, fallbacks and latency percentiles', () => {
    const wait = { tool: 'wait', args: {} };
    const s = turnStats([
      ...Array.from({ length: 18 }, (_, i) => t({ calls: [wait, wait], latency: 10 + i })),
      t({ calls: [wait], rejected: 1, latency: 60 }),
      t({ fallback: 'late', latency: null }),
      t({ fallback: 'invalid', rejected: 1, latency: 15 }),
    ]);
    expect(s).toMatchObject({ turns: 21, orders: 39, rejected: 2, invalidPct: 5.1, fallbacks: { late: 1, invalid: 1, error: 0 } });
    expect(s.p50).toBe(0.9);
    expect(s.p95).toBe(1.35);
  });
});

describe('llm-match results file (issue #28)', () => {
  // No network: a stub brain stands in for the model, and the control plays the same seeds.
  const play = (brain: 'general' | 'control', seed: number): MatchRecord => {
    const ai = brain === 'general'
      ? createGeneral('ai', () => turn, boom, { seed })
      : createControl('ai', boom, seed);
    const r = runMatch({ seed, maxTicks: 2 * 60 * 20, human: createScriptedBot('human', boom, seed), ai });
    return { opponent: 'boom', brain, seed, winner: r.winner, ticks: r.ticks, turns: brain === 'general' && 'log' in ai ? ai.log as TurnLog[] : [] };
  };

  it('carries game and data version, options, every match with its turn log, and the summary', () => {
    const matches = [play('general', 1), play('general', 2), play('control', 1), play('control', 2)];
    matches[0]!.winner = 'ai'; // fixed outcomes, so the summary is easy to check
    matches[1]!.winner = 'human';
    matches[2]!.winner = 'ai';
    matches[3]!.winner = 'ai';
    const out = matchResults({ model: 'stub', options: { matches: 2, human: 'boom' }, matches });
    expect(out).toMatchObject({ gameVersion: GAME_VERSION, dataVersion: DATA_VERSION, model: 'stub', options: { matches: 2, human: 'boom' } });
    expect(out.matches).toHaveLength(4);
    expect(out.matches[0]!.turns.length).toBeGreaterThan(0);
    expect(out.matches[2]!.turns).toEqual([]);
    expect(out.summary.general).toEqual({ matches: 2, wins: 1, winPct: 50 });
    expect(out.summary.control).toEqual({ matches: 2, wins: 2, winPct: 100 });
    expect(out.summary.gap).toBe(-50);
    expect(out.summary.byOpponent).toEqual({ boom: { general: 50, control: 100 } });
    // Turn stats cover the General's turns only.
    expect(out.summary.turns).toEqual(turnStats([...matches[0]!.turns, ...matches[1]!.turns]));
  });

  it('round-trips through JSON unchanged (plain data only)', () => {
    const out = matchResults({ model: 'stub', options: {}, matches: [play('general', 3)] });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('control-only runs have no General summary and no gap', () => {
    const out = matchResults({ model: null, options: { control: true }, matches: [play('control', 1)] });
    expect(out.summary.general).toBeNull();
    expect(out.summary.gap).toBeNull();
    expect(out.summary.control?.matches).toBe(1);
  });
});
