// Saved llm-match results (`--out`): plain data stamped with the game + data version (AGENTS.md rule 9),
// so a later script can compare models, prompts and runs. Per-turn logs feed prompt tuning and
// `measuredLatencies()` for headless runs.
import { DATA_VERSION, GAME_VERSION, type Faction } from '../../sim/index.ts';
import type { TurnLog } from './general.ts';
import { turnStats, type TurnStats } from './stats.ts';

export interface MatchRecord {
  /** Who played the AI side: the LLM General or the attack-every-turn control. */
  general: 'llm' | 'control';
  opponent: string;
  seed: number;
  winner: Faction | null;
  ticks: number;
  /** The LLM General's turn log; empty for the control. */
  turns: TurnLog[];
}

export interface SideSummary {
  matches: number;
  /** AI-side wins. */
  wins: number;
  winPct: number;
}

export interface MatchReport {
  gameVersion: string;
  dataVersion: number;
  /** Client name, e.g. `ollama:qwen3:8b`; null for a control-only run. */
  model: string | null;
  options: Record<string, unknown>;
  matches: MatchRecord[];
  summary: {
    llm: SideSummary | null;
    control: SideSummary | null;
    /** LLM win % minus control win % (the Gate 2 gap); null unless both played. */
    gap: number | null;
    byOpponent: Record<string, { llm: SideSummary | null; control: SideSummary | null }>;
    /** Invalid-command rate, fallbacks and latency over every LLM turn; null if the LLM did not play. */
    stats: TurnStats | null;
  };
}

/** Win rate of one side over `records`, rounded like the printed report; null if it played none. */
export function sideSummary(records: MatchRecord[], general: MatchRecord['general']): SideSummary | null {
  const mine = records.filter((r) => r.general === general);
  if (mine.length === 0) return null;
  const wins = mine.filter((r) => r.winner === 'ai').length;
  return { matches: mine.length, wins, winPct: Math.round((wins * 100) / mine.length) };
}

export function matchReport(input: { model: string | null; options: Record<string, unknown>; matches: MatchRecord[] }): MatchReport {
  const { matches } = input;
  const llm = sideSummary(matches, 'llm');
  const control = sideSummary(matches, 'control');
  const byOpponent: MatchReport['summary']['byOpponent'] = {};
  for (const name of new Set(matches.map((r) => r.opponent))) {
    const vs = matches.filter((r) => r.opponent === name);
    byOpponent[name] = { llm: sideSummary(vs, 'llm'), control: sideSummary(vs, 'control') };
  }
  return {
    gameVersion: GAME_VERSION, dataVersion: DATA_VERSION, model: input.model, options: input.options, matches,
    summary: {
      llm, control, byOpponent,
      gap: llm && control ? llm.winPct - control.winPct : null,
      stats: llm ? turnStats(matches.flatMap((r) => (r.general === 'llm' ? r.turns : []))) : null,
    },
  };
}
