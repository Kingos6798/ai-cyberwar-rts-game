// Difficulty levels for the AI opponent. Hard is the AI as balanced (D-015 bots, full fair-play limits);
// Normal and Easy make it worse in ways a person would recognize, never by cheating for the player:
// it reacts later, takes fewer actions per minute, stops micro-managing fights, attacks later and
// builds less. Only the AI side changes; the sim and the human side are untouched.
import { FAIRNESS, TICK_RATE } from '../sim/index.ts';
import type { Strategy } from './scripted.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export interface DifficultyLevel {
  label: string;
  blurb: string;
  /** Actions per minute the AI may take. */
  apm: number;
  /** Ticks between an AI decision and when its orders apply. */
  reactionDelay: number;
  /** The AI's strategy, handicapped. */
  tweak: (s: Strategy) => Strategy;
}

const min = (minutes: number) => minutes * 60 * TICK_RATE;

export const DIFFICULTY: Record<Difficulty, DifficultyLevel> = {
  easy: {
    label: 'Easy',
    blurb: 'Slow to react, no micro, a small economy, first attack after 7 minutes.',
    apm: 30,
    reactionDelay: 2 * TICK_RATE,
    tweak: (s) => ({
      ...s, focusFire: false, counterBuild: false, usePlug: false,
      workers: Math.max(3, s.workers - 3), racks: 0, spareRacks: 0, defenses: Math.min(1, s.defenses),
      attackNotBefore: Math.max(s.attackNotBefore ?? 0, min(7)), attackValue: Math.round(s.attackValue * 1.25),
    }),
  },
  normal: {
    label: 'Normal',
    blurb: 'Reacts a beat slower, no micro or counter-building, a smaller economy.',
    apm: 60,
    reactionDelay: TICK_RATE,
    // Not a later first attack: a delayed AI just masses a bigger army (measured: it won more, not less).
    tweak: (s) => ({
      ...s, focusFire: false, counterBuild: false,
      workers: Math.max(3, s.workers - 2), racks: Math.max(0, s.racks - 1), spareRacks: 0,
    }),
  },
  hard: {
    label: 'Hard',
    blurb: 'The full AI: quick reactions, focus fire, Pull the Plug, constant pressure.',
    apm: FAIRNESS.apm,
    reactionDelay: FAIRNESS.reactionDelay,
    tweak: (s) => s,
  },
};

export function isDifficulty(x: unknown): x is Difficulty {
  return typeof x === 'string' && (DIFFICULTIES as readonly string[]).includes(x);
}
