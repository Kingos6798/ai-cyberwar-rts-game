// Save and resume a live match (mobile port: phones close apps in the background). The sim and the
// scripted AI are deterministic, so a save is just the setup plus the player's own commands: replaying
// them from the same seed rebuilds the exact same game, AI decisions included. Matches against an LLM
// General can't be rebuilt this way (its replies aren't reproducible), so they aren't saved.
import { DATA_VERSION, GAME_VERSION, issue, type Game, type StampedCommand } from '../sim/index.ts';
import { tickSession, type Session } from './session.ts';

export interface SavedMatch {
  gameVersion: string;
  dataVersion: number;
  seed: number;
  mapId: string;
  /** Opponent strategy id. */
  ai: string;
  quick: boolean;
  /** AI difficulty; missing in saves made before difficulty levels existed (those were 'hard'). */
  difficulty?: string;
  /** Ticks played when saved. */
  tick: number;
  /** The player's applied commands, stamped with the tick they applied on. */
  human: StampedCommand[];
}

export function snapshot(game: Game, setup: { seed: number; mapId: string; ai: string; quick: boolean; difficulty?: string }): SavedMatch {
  return {
    gameVersion: GAME_VERSION, dataVersion: DATA_VERSION, ...setup,
    tick: game.world.tick, human: game.log.filter((c) => c.faction === 'human'),
  };
}

/** A save made by a different game or data version would replay differently, so it is refused. */
export function compatible(s: SavedMatch): boolean {
  return s.gameVersion === GAME_VERSION && s.dataVersion === DATA_VERSION && Array.isArray(s.human);
}

/**
 * Replays a save into a fresh session built with the same seed, map and opponent. Each player command is
 * issued on the tick it originally applied, before that tick runs, exactly as the UI does live.
 */
export function fastForward(session: Session, saved: SavedMatch, onTick?: () => void): void {
  const { game } = session;
  let next = 0;
  while (game.world.tick < saved.tick && game.world.winner === null) {
    while (next < saved.human.length && saved.human[next]!.tick === game.world.tick) {
      const c = saved.human[next++]!;
      issue(game, 'human', c.command);
    }
    tickSession(session);
    onTick?.();
  }
}
