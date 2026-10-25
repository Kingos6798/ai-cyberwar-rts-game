// Gate 2 numbers from an LLM General's turn log (invalid-command rate, fallbacks, latency percentiles), and
// the results of a whole llm-match run as plain data for `--out` (issue #28).
import { DATA_VERSION, GAME_VERSION, TICK_RATE, type Faction } from '../../sim/index.ts';
import type { TurnLog } from './general.ts';

export interface TurnStats {
  turns: number;
  fallbacks: { late: number; invalid: number; error: number };
  orders: number;
  rejected: number;
  /** Rejected orders per order received, in percent. */
  invalidPct: number;
  /** Seconds from request to apply, over answered turns (null if none). */
  p50: number | null;
  p95: number | null;
}

export function turnStats(logs: TurnLog[]): TurnStats {
  const fallbacks = { late: 0, invalid: 0, error: 0 };
  for (const t of logs) if (t.fallback) fallbacks[t.fallback]++;
  const rejected = logs.reduce((s, t) => s + t.rejected, 0);
  // A reply that is not even a turn counts as one rejected order.
  const orders = logs.reduce((s, t) => s + t.calls.length + t.rejected, 0);
  const lat = logs.flatMap((t) => (t.latency === null ? [] : [t.latency])).sort((a, b) => a - b);
  const pct = (p: number) => (lat.length === 0 ? null : lat[Math.min(lat.length - 1, Math.ceil((p / 100) * lat.length) - 1)]! / TICK_RATE);
  return {
    turns: logs.length, fallbacks, orders, rejected,
    invalidPct: orders === 0 ? 0 : Math.round((rejected * 1000) / orders) / 10,
    p50: pct(50), p95: pct(95),
  };
}

/** One headless match in an llm-match run. The General plays the AI side; `turns` is empty for the control. */
export interface MatchRecord {
  opponent: string;
  brain: 'general' | 'control';
  seed: number;
  winner: Faction | null;
  ticks: number;
  turns: TurnLog[];
}

export interface WinRate { matches: number; wins: number; winPct: number }

export interface MatchSummary {
  /** AI-side wins of the LLM General / the attack-every-turn control (null if that side did not play). */
  general: WinRate | null;
  control: WinRate | null;
  /** General win % minus control win %, in points (null unless both played). */
  gap: number | null;
  /** Win % per opponent, for each side that played. */
  byOpponent: Record<string, { general: number | null; control: number | null }>;
  /** Over the General's turns only. */
  turns: TurnStats;
}

/** Everything an llm-match run produced, as plain JSON-safe data (AGENTS.md rule 9: versions included). */
export interface MatchResults {
  gameVersion: string;
  dataVersion: number;
  model: string | null;
  options: Record<string, unknown>;
  matches: MatchRecord[];
  summary: MatchSummary;
}

export function matchResults(run: { model: string | null; options: Record<string, unknown>; matches: MatchRecord[] }): MatchResults {
  const rate = (ms: MatchRecord[]): WinRate | null => {
    if (ms.length === 0) return null;
    const wins = ms.filter((m) => m.winner === 'ai').length;
    return { matches: ms.length, wins, winPct: Math.round((wins * 100) / ms.length) };
  };
  const of = (brain: MatchRecord['brain'], ms = run.matches) => ms.filter((m) => m.brain === brain);
  const general = rate(of('general'));
  const control = rate(of('control'));
  const byOpponent: MatchSummary['byOpponent'] = {};
  for (const name of new Set(run.matches.map((m) => m.opponent))) {
    const vs = run.matches.filter((m) => m.opponent === name);
    byOpponent[name] = { general: rate(of('general', vs))?.winPct ?? null, control: rate(of('control', vs))?.winPct ?? null };
  }
  return {
    gameVersion: GAME_VERSION,
    dataVersion: DATA_VERSION,
    model: run.model,
    options: run.options,
    matches: run.matches,
    summary: {
      general, control, byOpponent,
      gap: general && control ? general.winPct - control.winPct : null,
      turns: turnStats(of('general').flatMap((m) => m.turns)),
    },
  };
}
