import { describe, expect, it } from 'vitest';
import { createEffects, updateEffects } from '../src/render/effects.ts';
import { POWER_FULL_ALERT } from '../src/render/hud.ts';
import { createSounds, cueFor, shouldPlay, SOUND, type Cue } from '../src/render/sound.ts';
import { buildings, factionView, spawnUnit, TILE } from '../src/sim/index.ts';
import { newGame } from './helpers.ts';

// Issue #4: short sound cues for the existing alerts, with a mute toggle and no sound before Start.
describe('alert sound cues', () => {
  it('maps every real alert to a cue: base hit → attack, enemies spotted or approaching → warning, Power full → power', () => {
    const game = newGame();
    const noc = buildings(game.world).find((b) => b.type === 'noc')!;
    const fx = createEffects();
    updateEffects(fx, factionView(game.world, 'human'), 0);
    for (let i = 0; i < 3; i++) spawnUnit(game.world, 'botnet_swarm', 'ai', noc.x + 4 * TILE, noc.y + i * TILE);
    noc.hp -= 50;
    const alerts = updateEffects(fx, factionView(game.world, 'human'), 1000);
    const cues = alerts.map((a) => [a, cueFor(a)] as const);
    expect(cues.some(([a, c]) => a.includes('under attack') && c === 'attack')).toBe(true);
    expect(cues.some(([a, c]) => a.includes('spotted') && c === 'warning')).toBe(true);
    expect(cues.some(([a, c]) => a.includes('approaching') && c === 'warning')).toBe(true);
    expect(cueFor(POWER_FULL_ALERT)).toBe('power');
    expect(cueFor('✗ train: not enough Data')).toBeNull();
  });

  it('the same cue plays at most once per cooldown; different cues are independent', () => {
    const last = new Map<Cue, number>();
    expect(shouldPlay(last, 'attack', 0)).toBe(true);
    expect(shouldPlay(last, 'attack', SOUND.cooldownMs - 1)).toBe(false);
    expect(shouldPlay(last, 'warning', 10)).toBe(true);
    expect(shouldPlay(last, 'attack', SOUND.cooldownMs)).toBe(true);
    expect(SOUND.cooldownMs).toBeGreaterThanOrEqual(3000);
  });

  it('stays silent until unlocked by a user gesture, and while muted', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    let t = 0;
    const s = createSounds({ storage, createContext: () => null, now: () => t });
    expect(s.play('attack')).toBe(false); // before Start: nothing
    s.unlock();
    expect(s.play('attack')).toBe(true);
    t = 1000;
    expect(s.play('attack')).toBe(false); // cooldown
    expect(s.toggleMute()).toBe(false); // now off
    t = 10_000;
    expect(s.play('warning')).toBe(false);
    expect(store.get('sound')).toBe('off');
    // A new page load remembers the choice.
    expect(createSounds({ storage, createContext: () => null, now: () => t }).muted).toBe(true);
    expect(s.toggleMute()).toBe(true);
    expect(s.play('warning')).toBe(true);
  });

  it('works with storage blocked', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const s = createSounds({ storage: blocked, createContext: () => null, now: () => 0 });
    expect(s.muted).toBe(false);
    expect(() => s.toggleMute()).not.toThrow();
  });
});
