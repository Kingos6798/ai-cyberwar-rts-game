import { describe, expect, it } from 'vitest';
import { createScriptedBot, STRATEGIES, TRAINING } from '../src/ai/scripted.ts';
import { createSession, tickSession } from '../src/harness/session.ts';
import { buildings, factionView, MILLI, spawnUnit, TICK_RATE, TILE, type Command } from '../src/sim/index.ts';
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
