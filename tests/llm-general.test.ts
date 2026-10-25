import { describe, expect, it } from 'vitest';
import { createGeneral, DEFAULT_LATENCY, directed, measuredLatencies, TAUNT_MEMORY, TURN_TIMEOUT, type Brain } from '../src/ai/llm/general.ts';
import { createScriptedBot, STRATEGIES } from '../src/ai/scripted.ts';
import { runMatch } from '../src/harness/match.ts';
import { createSession, tickSession } from '../src/harness/session.ts';
import { buildings, DUEL_MAP, factionView, FAIRNESS, sectorCenter, spawnUnit, TICK_RATE, TILE } from '../src/sim/index.ts';
import { createEnemyMemory, lastSeen, MEMORY_TICKS, observe } from '../src/ai/llm/memory.ts';
import { command, newGame, run } from './helpers.ts';
import type { Controller } from '../src/ai/controller.ts';

// Phase 2 (M2.3, M2.3b): LLM turns steer a scripted operational layer after a latency; bad, missing or late turns fall back to it.
const boom = STRATEGIES.boom!;
const match = (ai: Controller, minutes = 6) => runMatch({
  seed: 5, maxTicks: minutes * 60 * 20, human: createScriptedBot('human', boom, 5), ai,
}).game;
const turnOf = (...orders: unknown[]) => JSON.stringify({ orders });

describe('LLM General', () => {
  it.each<[string, Brain, string]>([
    ['late', () => null, 'late'],
    ['invalid', () => '{"orders":[{"tool":"launch_nukes"}]}', 'invalid'],
    ['garbage', () => 'I attack now!', 'invalid'],
    ['crashing', () => { throw new Error('connection refused'); }, 'error'],
  ])('a %s brain falls back to plain scripted play, command for command', (_, brain, why) => {
    const general = createGeneral('ai', brain, boom, { seed: 5 });
    const withGeneral = match(general);
    const scripted = match(createScriptedBot('ai', boom, 5));
    expect(withGeneral.log).toEqual(scripted.log);
    expect(general.log.length).toBeGreaterThan(10);
    expect(general.log.every((t) => t.fallback === why)).toBe(true);
  });

  it('applies every ordered command after its latency, one per decision, ahead of scripted orders', () => {
    const brain: Brain = ({ tick }) => tick === 0
      ? turnOf({ tool: 'train', args: { unit: 'maintenance_drone', count: 2 } }, { tool: 'taunt', args: { message: 'hello, meat' } })
      : turnOf({ tool: 'wait', args: {} });
    const general = createGeneral('ai', brain, boom, { seed: 5 });
    const game = match(general, 1);
    // Reply lands at tick 40 (2 s); each command then waits the reaction delay.
    const firstAt = (tick: number) => game.log.find((c) => c.faction === 'ai' && c.tick === tick)?.command;
    expect(firstAt(DEFAULT_LATENCY + FAIRNESS.reactionDelay)).toMatchObject({ type: 'train', unit: 'maintenance_drone' });
    expect(firstAt(DEFAULT_LATENCY + 2 * FAIRNESS.reactionDelay)).toMatchObject({ type: 'train', unit: 'maintenance_drone' });
    expect(general.log[0]).toMatchObject({ tick: 0, latency: DEFAULT_LATENCY, fallback: null, errors: [], chat: ['hello, meat'] });
  });

  it('draws latency from measured samples, seeded', () => {
    const brain: Brain = () => turnOf({ tool: 'wait', args: {} });
    const play = () => {
      const g = createGeneral('ai', brain, boom, { seed: 5, latency: [20, 60] });
      match(g, 8);
      return measuredLatencies(g.log);
    };
    const a = play();
    expect(new Set(a)).toEqual(new Set([20, 60]));
    expect(play()).toEqual(a);
  });

  it('a reply slower than the timeout is late, and play stays plain scripted', () => {
    const brain: Brain = () => turnOf({ tool: 'set_army_mix', args: { fast: 0, ranged: 0, tank: 0 } });
    const general = createGeneral('ai', brain, boom, { seed: 5, latency: [TURN_TIMEOUT + 20] });
    expect(match(general).log).toEqual(match(createScriptedBot('ai', boom, 5)).log);
    expect(general.log.every((t) => t.fallback === 'late' && t.latency === null)).toBe(true);
  });

  it('an async reply applies at the first decision after it arrives, with that latency logged', async () => {
    const general = createGeneral('ai', () => Promise.resolve(turnOf({ tool: 'expand', args: {} })), boom, { seed: 5 });
    const session = createSession({ seed: 5, controllers: { human: createScriptedBot('human', boom, 5), ai: general } });
    tickSession(session);
    await new Promise((r) => setTimeout(r, 0));
    while (session.game.world.tick < 30) tickSession(session);
    expect(general.log[0]).toMatchObject({ tick: 0, latency: session.interval, fallback: null });
  });

  it('keeps valid orders when some are invalid, and logs the rejects', () => {
    const general = createGeneral('ai', () => turnOf({ tool: 'expand', args: {} }, { tool: 'nuke' }), boom, { seed: 5 });
    match(general, 1);
    expect(general.log[0]).toMatchObject({ fallback: null, calls: [{ tool: 'expand', args: {} }] });
    expect(general.log[0]!.errors).toEqual(['order 2: unknown tool "nuke"']);
  });

  it('the directive steers the operational layer: an all-zero army mix trains no army, and attacks are left to the General', () => {
    const brain: Brain = () => turnOf({ tool: 'set_army_mix', args: { fast: 0, ranged: 0, tank: 0 } });
    const game = match(createGeneral('ai', brain, boom, { seed: 5 }), 8);
    const trained = game.log.filter((c) => c.faction === 'ai' && c.command.type === 'train').map((c) => c.command.type === 'train' && c.command.unit);
    expect(trained.length).toBeGreaterThan(0);
    expect(trained.every((u) => u === 'maintenance_drone')).toBe(true);
    expect(directed(boom, {}).attackValue).toBe(Infinity);
    expect(directed(boom, { workers: 3, mix: { tank: 1 } })).toMatchObject({ workers: 3, racks: boom.racks, mix: { tank: 1 }, counterBuild: false });
  });

  it('is deterministic for a deterministic brain', () => {
    const brain: Brain = ({ tick, digest }) => turnOf(
      { tool: 'set_build_plan', args: { workers: 6, racks: 1, defenses: 2 } },
      ...(digest.threats.length > 0 ? [{ tool: 'defend_sector', args: { sector: digest.threats[0]!.sector } }] : []),
      ...(tick >= 3 * 60 * 20 ? [{ tool: 'attack_sector', args: { sector: 'W' } }] : []),
    );
    const a = match(createGeneral('ai', brain, boom, { seed: 5 }));
    const b = match(createGeneral('ai', brain, boom, { seed: 5 }));
    expect(a.log).toEqual(b.log);
    const [wx, wy] = sectorCenter(DUEL_MAP, 'W');
    expect(a.log.some((c) => c.faction === 'ai' && c.command.type === 'attackMove' && c.command.x === wx && c.command.y === wy)).toBe(true);
  });

  // Replay seed 88632 (owner playtest): the General ordered attack_sector every turn against towers, and
  // every unit trained in between walked in alone; the AI never had more than 3 units alive.
  it('attacking every turn masses waves instead of feeding units in one at a time', () => {
    const [cx, cy] = sectorCenter(DUEL_MAP, 'C');
    const general = createGeneral('ai', () => turnOf({ tool: 'attack_sector', args: { sector: 'C' } }), boom, { seed: 5 });
    const game = runMatch({ seed: 5, maxTicks: 8 * 60 * 20, human: createScriptedBot('human', STRATEGIES.turtle!, 5), ai: general }).game;
    const waves = game.log.filter((c) => c.faction === 'ai' && c.command.type === 'attackMove' && c.command.x === cx && c.command.y === cy);
    expect(waves.length).toBeGreaterThan(0);
    // The first wave waits for the base strategy's full army; later waves go in groups, never alone.
    expect(waves[0]!.tick).toBeGreaterThan(2 * 60 * 20);
    for (const w of waves) expect(w.command.type === 'attackMove' && w.command.units.length).toBeGreaterThanOrEqual(2);
  });

  // Live matches: the model switched targets almost every turn, and waves split between old and new targets.
  it('a new target turns the marching army with it', () => {
    const [nx, ny] = sectorCenter(DUEL_MAP, 'N');
    const bot = createScriptedBot('ai', { ...boom, attackValue: 0, attackAt: 'C' }, 5);
    const game = newGame(5);
    const core = game.world.sites.get('a_core')!;
    for (let i = 0; i < 3; i++) spawnUnit(game.world, 'botnet_swarm', 'ai', core.x - 3 * TILE, core.y + i * TILE);
    for (const c of bot.decide(factionView(game.world, 'ai'))) command(game, 'ai', c);
    run(game, FAIRNESS.reactionDelay + 1);
    bot.strategy = { ...bot.strategy, attackAt: 'N' };
    const turned = bot.decide(factionView(game.world, 'ai')).filter((c) => c.type === 'attackMove');
    expect(turned).toEqual([expect.objectContaining({ x: nx, y: ny })]);
    expect(turned[0]!.type === 'attackMove' && turned[0]!.units).toHaveLength(3);
  });

  it('defend_sector and retreat call an attack off', () => {
    expect(directed(boom, { attack: 'C' })).toMatchObject({ attackAt: 'C', attackValue: boom.attackValue, regroup: true });
    expect(directed(boom, { attack: null }).attackValue).toBe(Infinity);
    expect(directed(boom, { attack: null })).not.toHaveProperty('attackAt');
  });

  it('remembers its last few taunts (filtered) and sends them with the next turn', () => {
    const taunts = ['one', 'two', 'visit evil.com now', 'three', 'four', 'five'];
    const heard: string[][] = [];
    const brain: Brain = ({ youSaid }) => {
      heard.push([...(youSaid ?? [])]);
      const message = taunts[heard.length - 1];
      return message ? turnOf({ tool: 'taunt', args: { message } }) : turnOf({ tool: 'wait', args: {} });
    };
    match(createGeneral('ai', brain, boom, { seed: 5 }), 3);
    expect(TAUNT_MEMORY).toBe(3);
    expect(heard[0]).toEqual([]);
    expect(heard[1]).toEqual(['one']);
    // The link is dropped by the chat filter, so it is never fed back to the model.
    expect(heard[3]).toEqual(['one', 'two']);
    expect(heard[5]).toEqual(['two', 'three', 'four']);
    expect(heard[6]).toEqual(['three', 'four', 'five']);
  });

  it('stays deterministic with taunt memory', () => {
    const brain: Brain = ({ tick, youSaid }) => turnOf(
      { tool: 'taunt', args: { message: `tick ${tick}, said ${(youSaid ?? []).length}` } },
      { tool: 'train', args: { unit: 'botnet_swarm', count: 1 } },
    );
    const a = match(createGeneral('ai', brain, boom, { seed: 5 }), 3);
    const b = match(createGeneral('ai', brain, boom, { seed: 5 }), 3);
    expect(a.log).toEqual(b.log);
  });
});

describe('LLM General: memory of enemy armies out of sight (#30)', () => {
  /** An AI scout at the human NOC's doorstep, a human army next to it, and a far-off human army it can't see. */
  function scene() {
    const game = newGame();
    const noc = buildings(game.world).find((b) => b.type === 'noc')!;
    const scout = spawnUnit(game.world, 'botnet_swarm', 'ai', noc.x + 8 * TILE, noc.y);
    const army = [0, 1, 2].map((i) => spawnUnit(game.world, 'red_team', 'human', noc.x + 9 * TILE, noc.y + (i - 1) * TILE));
    const hidden = [0, 1].map((i) => spawnUnit(game.world, 'armored_vehicle', 'human', noc.x, noc.y + (10 + i) * TILE));
    const view = () => factionView(game.world, 'ai');
    return { game, noc, scout, army, hidden, view };
  }

  it('is fog-safe: units it never saw never appear', () => {
    const { game, scout, view } = scene();
    const m = createEnemyMemory();
    game.world.entities.delete(scout.id);
    for (let i = 0; i < 5; i++) { observe(m, view()); game.world.tick += 20; }
    expect(lastSeen(m, view())).toEqual([]);
  });

  it('remembers an army after losing sight of it, by sector, with how long ago', () => {
    const { game, scout, army, hidden, view } = scene();
    const m = createEnemyMemory();
    observe(m, view());
    expect(lastSeen(m, view())).toEqual([]); // in sight: the digest already shows it
    game.world.entities.delete(scout.id);
    game.world.tick += 40 * TICK_RATE;
    observe(m, view());
    const sector = factionView(game.world, 'human').units.find((u) => u.id === army[0]!.id)!.sector;
    expect(lastSeen(m, view())).toEqual([{ sector, enemy: { red_team: 3 }, secondsAgo: 40 }]);
    expect(JSON.stringify(lastSeen(m, view()))).not.toContain('armored_vehicle');
    expect(hidden).toHaveLength(2);
  });

  it('forgets once the spot is in sight again and empty, or after about 2 minutes', () => {
    const { game, noc, scout, army, view } = scene();
    const m = createEnemyMemory();
    observe(m, view());
    game.world.entities.delete(scout.id);
    observe(m, view());
    // The army leaves; a new scout sees the empty spot.
    for (const u of army) game.world.entities.delete(u.id);
    spawnUnit(game.world, 'botnet_swarm', 'ai', noc.x + 8 * TILE, noc.y);
    observe(m, view());
    expect(lastSeen(m, view())).toEqual([]);

    const s2 = scene();
    const m2 = createEnemyMemory();
    observe(m2, s2.view());
    s2.game.world.entities.delete(s2.scout.id);
    s2.game.world.tick += MEMORY_TICKS;
    observe(m2, s2.view());
    expect(lastSeen(m2, s2.view())).toHaveLength(1);
    s2.game.world.tick += 1;
    observe(m2, s2.view());
    expect(lastSeen(m2, s2.view())).toEqual([]);
  });

  it('puts lastSeen in the turn input, and a busy mid-game turn input stays small', () => {
    const inputs: string[] = [];
    const brain: Brain = ({ digest }) => { inputs.push(JSON.stringify(digest)); return turnOf({ tool: 'wait', args: {} }); };
    const s = createSession({ seed: 5, controllers: { human: createScriptedBot('human', boom, 5), ai: createGeneral('ai', brain, boom, { seed: 5 }) } });
    while (s.game.world.tick < 8 * 60 * 20 && s.game.world.winner === null) tickSession(s);
    expect(inputs.some((i) => i.includes('"lastSeen"'))).toBe(true);
    expect(Math.max(...inputs.map((i) => i.length))).toBeLessThan(2000);
  });
});
