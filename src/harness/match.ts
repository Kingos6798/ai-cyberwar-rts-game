// Run a full match between two controllers, headless. Used by `npm run sim`, balance runs and tests.
import type { Controller } from '../ai/controller.ts';
import { TICK_RATE, type Faction, type Game } from '../sim/index.ts';
import { createSession, tickSession } from './session.ts';

export interface MatchOptions {
  seed: number;
  mapId?: string;
  human: Controller;
  ai: Controller;
  /** Default 20 minutes. */
  maxTicks?: number;
  /** Ticks between controller decisions. */
  decisionInterval?: number;
  /** Override the fair-play limits (e.g. for experiments); defaults come from data.ts. */
  apm?: number;
  reactionDelay?: number;
  /** Per-side overrides (difficulty levels). */
  pacing?: Partial<Record<Faction, { apm?: number; reactionDelay?: number }>>;
}

export interface MatchResult {
  winner: Faction | null;
  ticks: number;
  game: Game;
}

export function runMatch(opts: MatchOptions): MatchResult {
  const session = createSession({ ...opts, controllers: { human: opts.human, ai: opts.ai } });
  const maxTicks = opts.maxTicks ?? 20 * 60 * TICK_RATE;
  const { world } = session.game;
  while (world.tick < maxTicks && world.winner === null) tickSession(session);
  return { winner: world.winner, ticks: world.tick, game: session.game };
}

/**
 * Same as `runMatch`, but the sim waits for async controllers (real LLM calls) before each tick, so a
 * slow model costs game ticks (its measured latency) rather than skipped turns.
 */
export async function runMatchAsync(opts: MatchOptions): Promise<MatchResult> {
  const session = createSession({ ...opts, controllers: { human: opts.human, ai: opts.ai } });
  const maxTicks = opts.maxTicks ?? 20 * 60 * TICK_RATE;
  const { world } = session.game;
  while (world.tick < maxTicks && world.winner === null) {
    for (const p of session.players) await p.controller.settle?.();
    tickSession(session);
  }
  return { winner: world.winner, ticks: world.tick, game: session.game };
}
