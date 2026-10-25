import { describe, expect, it } from 'vitest';
import { createScriptedBot, STRATEGIES } from '../src/ai/scripted.ts';
import { compatible, fastForward, snapshot } from '../src/harness/resume.ts';
import { createSession, tickSession } from '../src/harness/session.ts';
import { factionView, hashWorld, issue, TICK_RATE } from '../src/sim/index.ts';
import { workersOf } from './helpers.ts';

// Mobile port: a saved match is seed + map + opponent + the player's commands; replaying rebuilds it exactly.
describe('save and resume', () => {
  const setup = { seed: 7, mapId: 'duel', ai: 'boom', quick: false };
  const fresh = () => createSession({ seed: setup.seed, mapId: setup.mapId, controllers: { ai: createScriptedBot('ai', STRATEGIES.boom!, setup.seed) } });

  it('rebuilds the exact same world, AI decisions included', () => {
    const live = fresh();
    // A player who expands, then later builds and stops, at odd moments between ticks.
    for (let t = 0; t < 3 * 60 * TICK_RATE; t++) {
      if (t === 5) issue(live.game, 'human', { type: 'expand' });
      if (t === 200) {
        const ws = workersOf(live.game, 'human');
        const core = factionView(live.game.world, 'human').buildings.find((b) => b.type === 'noc')!;
        issue(live.game, 'human', { type: 'build', units: ws.slice(0, 2), building: 'soc', x: core.x - 3000, y: core.y + 4000 });
      }
      if (t === 1500) issue(live.game, 'human', { type: 'stop', units: workersOf(live.game, 'human').slice(0, 1) });
      tickSession(live);
    }
    const saved = JSON.parse(JSON.stringify(snapshot(live.game, setup)));
    expect(compatible(saved)).toBe(true);
    expect(saved.human.length).toBeGreaterThanOrEqual(3);

    const resumed = fresh();
    let ticks = 0;
    fastForward(resumed, saved, () => ticks++);
    expect(ticks).toBe(saved.tick);
    expect(hashWorld(resumed.game.world)).toBe(hashWorld(live.game.world));
    expect(resumed.game.log).toEqual(live.game.log);
  });

  it('refuses saves from another data version', () => {
    const s = snapshot(fresh().game, setup);
    expect(compatible({ ...s, dataVersion: s.dataVersion - 1 })).toBe(false);
  });
});
