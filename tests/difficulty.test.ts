import { describe, expect, it } from 'vitest';
import { DIFFICULTY } from '../src/ai/difficulty.ts';
import { createScriptedBot, STRATEGIES } from '../src/ai/scripted.ts';
import { runMatch } from '../src/harness/match.ts';
import { FAIRNESS } from '../src/sim/index.ts';

// Difficulty levels handicap only the AI, in ways a player would recognize (never by cheating for them).
describe('difficulty levels', () => {
  it('hard is the AI as balanced; normal and easy react slower and act less', () => {
    expect(DIFFICULTY.hard.tweak(STRATEGIES.boom!)).toBe(STRATEGIES.boom);
    expect(DIFFICULTY.hard).toMatchObject({ apm: FAIRNESS.apm, reactionDelay: FAIRNESS.reactionDelay });
    for (const d of ['normal', 'easy'] as const) {
      const s = DIFFICULTY[d].tweak(STRATEGIES.boom!);
      expect(s.focusFire).toBe(false);
      expect(s.workers).toBeLessThan(STRATEGIES.boom!.workers);
      expect(DIFFICULTY[d].apm).toBeLessThan(FAIRNESS.apm);
      expect(DIFFICULTY[d].reactionDelay).toBeGreaterThan(FAIRNESS.reactionDelay);
    }
    expect(DIFFICULTY.easy.apm).toBeLessThan(DIFFICULTY.normal.apm);
  });

  it('a player bot wins more often as the AI gets easier (boom vs boom, 8 seeds)', () => {
    const wins = (d: keyof typeof DIFFICULTY) => {
      let n = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const r = runMatch({
          seed, human: createScriptedBot('human', STRATEGIES.boom!, seed), ai: createScriptedBot('ai', DIFFICULTY[d].tweak(STRATEGIES.boom!), seed * 7919),
          pacing: { ai: { apm: DIFFICULTY[d].apm, reactionDelay: DIFFICULTY[d].reactionDelay } },
        });
        if (r.winner === 'human') n++;
      }
      return n;
    };
    const [hard, normal, easy] = [wins('hard'), wins('normal'), wins('easy')];
    expect(normal).toBeGreaterThan(hard);
    expect(easy).toBeGreaterThanOrEqual(normal);
  }, 60_000);
});
