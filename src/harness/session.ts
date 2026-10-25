// One match loop for headless runs and live play: controllers decide on a fixed interval, under the
// APM cap and reaction delay, then the world advances one tick. Factions without a controller are
// driven from outside (the human UI) by calling `issue` directly.
import type { Controller } from '../ai/controller.ts';
import { advance, createGame, factionView, FAIRNESS, issue, type Faction, type Game } from '../sim/index.ts';
import { available, createPacer, spend, type Pacer } from './pacer.ts';

export interface SessionOptions {
  seed: number;
  mapId?: string;
  controllers: Partial<Record<Faction, Controller>>;
  /** Ticks between controller decisions. */
  decisionInterval?: number;
  apm?: number;
  reactionDelay?: number;
  /** Per-side overrides of the fair-play limits (difficulty levels slow only the AI). */
  pacing?: Partial<Record<Faction, { apm?: number; reactionDelay?: number }>>;
}

export interface Session {
  game: Game;
  players: { faction: Faction; controller: Controller; pacer: Pacer; delay: number }[];
  interval: number;
  delay: number;
}

export function createSession(opts: SessionOptions): Session {
  const players = (['human', 'ai'] as const)
    .filter((f) => opts.controllers[f])
    .map((faction) => ({
      faction, controller: opts.controllers[faction]!,
      pacer: createPacer(opts.pacing?.[faction]?.apm ?? opts.apm),
      delay: opts.pacing?.[faction]?.reactionDelay ?? opts.reactionDelay ?? FAIRNESS.reactionDelay,
    }));
  return {
    game: createGame(opts.seed, opts.mapId ?? 'duel'),
    players,
    interval: opts.decisionInterval ?? 10,
    delay: opts.reactionDelay ?? FAIRNESS.reactionDelay,
  };
}

export function tickSession(s: Session): void {
  const { game } = s;
  if (game.world.winner === null && game.world.tick % s.interval === 0) {
    for (const p of s.players) {
      let budget = available(p.pacer, game.world.tick);
      if (budget === 0) continue;
      for (const cmd of p.controller.decide(factionView(game.world, p.faction))) {
        if (budget-- === 0) break;
        spend(p.pacer);
        issue(game, p.faction, cmd, p.delay);
      }
    }
  }
  advance(game);
}
