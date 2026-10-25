import { describe, expect, it } from 'vitest';
import { createEffects, updateEffects } from '../src/render/effects.ts';
import { POWER_FULL_ALERT } from '../src/render/hud.ts';
import { createCueLimiter, createSound, cueFor, SOUND } from '../src/render/sound.ts';
import { buildings, factionView, spawnUnit, TILE } from '../src/sim/index.ts';
import { newGame } from './helpers.ts';

// Sound cues for alerts (#4).
describe('sound cues', () => {
  it('every alert the game raises maps to a cue', () => {
    const game = newGame();
    const noc = buildings(game.world).find((b) => b.type === 'noc')!;
    const fx = createEffects();
    updateEffects(fx, factionView(game.world, 'human'), 0);
    spawnUnit(game.world, 'botnet_swarm', 'ai', noc.x + 4 * TILE, noc.y);
    spawnUnit(game.world, 'botnet_swarm', 'ai', noc.x + 5 * TILE, noc.y);
    noc.hp -= 10;
    const alerts = updateEffects(fx, factionView(game.world, 'human'), 1000);
    expect(alerts.length).toBe(3);
    expect(alerts.map(cueFor).sort()).toEqual(['approaching', 'attacked', 'spotted']);
    expect(cueFor(POWER_FULL_ALERT)).toBe('power');
    expect(cueFor('Group 1 saved')).toBeNull();
  });

  it('the same cue plays at most once every few seconds; different cues are independent', () => {
    const l = createCueLimiter();
    expect(l('attacked', 0)).toBe(true);
    expect(l('attacked', SOUND.gapMs - 1)).toBe(false);
    expect(l('spotted', 100)).toBe(true);
    expect(l('attacked', SOUND.gapMs)).toBe(true);
  });

  it('stays silent until started (browser autoplay rules): no AudioContext before the Start click', () => {
    const s = createSound();
    expect(s.play('attacked', 0)).toBe(false);
  });
});
