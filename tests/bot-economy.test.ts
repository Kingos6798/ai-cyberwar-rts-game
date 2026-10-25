import { describe, expect, it } from 'vitest';
import { createScriptedBot, STRATEGIES, TRAINING } from '../src/ai/scripted.ts';
import { createSession, tickSession } from '../src/harness/session.ts';
import { buildings, dist2, factionView, MILLI, spawnBuilding, spawnUnit, TICK_RATE, TILE, units, type Command } from '../src/sim/index.ts';
import { newGame } from './helpers.ts';

describe('scripted bot economy', () => {
  // Playtest replays seed37250 / seed37884: the training AI banked 4,000+ Data by minute 8 and 7,500 by
  // the end, training on the core's 10 Compute alone. Production speed comes from Compute, so a bot with
  // Data to spare should add Server Racks. (Banking once the army fills the Power cap is fine.)
  it('turns spare Data into Compute instead of banking it', () => {
    const s = createSession({ seed: 37884, controllers: { ai: createScriptedBot('ai', TRAINING, 37884) } });
    while (s.game.world.tick < 3 * 60 * TICK_RATE) tickSession(s);
    const ai = s.game.world.factions.ai;
    expect(ai.powerUsed).toBeLessThan(ai.powerCap);
    expect(ai.compute).toBeGreaterThan(10);
    expect(ai.data / MILLI).toBeLessThan(500);
  });

  // Replay seed37884 (training AI): after its 47-unit push died, the AI sent 3-4 units at a time into the human army
  // for eight minutes and never rebuilt a real army.
  it('after its attack is wiped out, regroups instead of trickling reinforcements in', () => {
    const game = newGame();
    const core = buildings(game.world).find((b) => b.type === 'primary_cluster')!;
    const bot = createScriptedBot('ai', { ...TRAINING, attackNotBefore: 0, attackValue: STRATEGIES.boom!.attackValue }, 1);
    const attackMoves = (cmds: Command[]) => cmds.filter((c) => c.type === 'attackMove');

    const army = Array.from({ length: 12 }, (_, i) => spawnUnit(game.world, 'industrial_robot', 'ai', core.x - 3 * TILE, core.y + (i - 6) * TILE));
    expect(attackMoves(bot.decide(factionView(game.world, 'ai')))).toHaveLength(1);

    for (const u of army) game.world.entities.delete(u.id);
    for (let i = 0; i < 3; i++) spawnUnit(game.world, 'industrial_robot', 'ai', core.x - 3 * TILE, core.y + i * TILE);
    game.world.tick += 100; // past the reaction delay
    expect(attackMoves(bot.decide(factionView(game.world, 'ai')))).toHaveLength(0);
  });

  // Issue #1 (seventeenth playtest): a rush bot builds no racks, so from 3:00 it banked 500-740 Data it
  // could not spend. Every balance strategy turns a large, lasting Data surplus into Compute while Power
  // allows; a short bank (saving up for the next wave) does not count, or rush snowballs.
  const bankFrom2Min = (name: string, seconds: number) => {
    // A turtle on the other side keeps the match going, like the playtest where rush stalled at Security Posts.
    const s = createSession({ seed: 7, controllers: {
      ai: createScriptedBot('ai', STRATEGIES[name]!, 7), human: createScriptedBot('human', STRATEGIES.turtle!, 7),
    } });
    while (s.game.world.tick < 2 * 60 * TICK_RATE) tickSession(s);
    const ai = s.game.world.factions.ai;
    const racksBefore = buildings(s.game.world).filter((b) => b.faction === 'ai' && b.type === 'server_rack').length;
    const end = (2 * 60 + seconds) * TICK_RATE;
    while (s.game.world.tick < end) {
      ai.data = Math.max(ai.data, 1500 * MILLI); // keeps banking, as in the playtest
      tickSession(s);
    }
    const rackOrders = s.game.log.filter((c) => c.faction === 'ai' && c.tick >= 2 * 60 * TICK_RATE
      && c.command.type === 'build' && c.command.building === 'server_rack');
    expect(s.game.world.winner).toBeNull();
    return { rackOrders: rackOrders.length, racksBefore, powerFree: ai.powerCap - ai.powerUsed };
  };

  it.each(['rush', 'boom', 'turtle'])('a %s bot banking well over a rack’s cost for over a minute, with Power to spare, builds a Server Rack', (name) => {
    const r = bankFrom2Min(name, 90);
    expect(r.powerFree).toBeGreaterThan(0);
    // At least one rack beyond what the strategy plans.
    expect(r.racksBefore + r.rackOrders).toBeGreaterThan(Math.max(r.racksBefore, STRATEGIES[name]!.racks));
  });

  it.each(['rush', 'boom', 'turtle'])('a %s bot saving up for half a minute builds no spare rack', (name) => {
    // Planned racks (the strategy's `racks`) may still go up; nothing beyond them.
    const r = bankFrom2Min(name, 30);
    expect(r.racksBefore + r.rackOrders).toBeLessThanOrEqual(Math.max(r.racksBefore, STRATEGIES[name]!.racks));
  });
});

describe('idle workers once every site is claimed (#33)', () => {
  /** Human owns every site and link, has a built SOC and no Data: nothing left to claim, light or buy. */
  function claimedOut() {
    const game = newGame();
    for (const s of game.world.sites.values()) if (s.kind !== 'core') s.owner = 'human';
    for (const l of game.world.links) l.owner = 'human';
    const noc = buildings(game.world).find((b) => b.type === 'noc')!;
    spawnBuilding(game.world, 'soc', 'human', noc.x - 3 * TILE, noc.y + 4 * TILE).built = true;
    game.world.factions.human.data = 0;
    for (const u of units(game.world)) if (u.faction === 'human') game.world.entities.delete(u.id);
    const engineers = Array.from({ length: 4 }, (_, i) => spawnUnit(game.world, 'field_engineer', 'human', noc.x + 2 * TILE, noc.y + (i - 2) * TILE));
    return { game, noc, engineers };
  }
  const boom = STRATEGIES.boom!;

  it('idle workers all help finish an unbuilt building', () => {
    const { game, noc, engineers } = claimedOut();
    const rack = spawnBuilding(game.world, 'server_rack', 'human', noc.x - 3 * TILE, noc.y - 4 * TILE);
    const cmds = createScriptedBot('human', boom, 1).decide(factionView(game.world, 'human'));
    const builders = cmds.flatMap((c) => (c.type === 'construct' && c.building === rack.id ? c.units : []));
    expect(builders.sort()).toEqual(engineers.map((e) => e.id).sort());
  });

  it('with nothing to do, idle workers far from base go back near the core', () => {
    const { game, noc, engineers } = claimedOut();
    const stray = engineers[0]!;
    stray.x = noc.x + 20 * TILE;
    const cmds = createScriptedBot('human', boom, 1).decide(factionView(game.world, 'human'));
    const home = cmds.find((c) => c.type === 'move' && c.units.includes(stray.id));
    expect(home).toBeDefined();
    if (home?.type === 'move') expect(dist2(home.x, home.y, noc.x, noc.y)).toBeLessThan((5 * TILE) ** 2);
    // Workers already near the core are left alone (no wasted actions).
    expect(cmds.filter((c) => c.type === 'move' && c.units.some((id) => id !== stray.id))).toEqual([]);
  });

  it('does not train more workers when there is no work for the idle ones', () => {
    const { game } = claimedOut();
    game.world.factions.human.data = 2000 * MILLI;
    const cmds = createScriptedBot('human', { ...boom, racks: 0, defenses: 0 }, 1).decide(factionView(game.world, 'human'));
    expect(cmds.filter((c) => c.type === 'train' && c.unit === 'field_engineer')).toEqual([]);
  });
});
