// Scripted strategy bots. They play either faction through the same commands and view a human or LLM gets.
// Strategies are data, so new ones (and balance experiments) need no new logic.
import {
  BUILDINGS, createRng, FAIRNESS, isqrt, MILLI, SIGNAL, TICK_RATE, UNITS, TILE, dist2, sectorCenter, type BuildingTypeId, type Command, type Faction, type FactionView,
  type Rng, type Role, type SectorId, type SiteView, type UnitTypeId, type UnitView,
} from '../sim/index.ts';
import type { Controller } from './controller.ts';

export interface Strategy {
  name: string;
  workers: number;
  racks: number;
  /** Physical barricades to build (humans only). */
  barricades: number;
  /** Static defenses (Security Post / Sentry Gun) to build in front of the core. */
  defenses: number;
  mix: Partial<Record<Role, number>>;
  /**
   * Army value (Data spent on combat units) that triggers an attack. Value, not unit count: human
   * units cost more, so a count threshold made humans wait far longer than the AI.
   */
  attackValue: number;
  /** Skilled play: in a fight, each role focuses the weakest enemy it counters (else the weakest in reach). */
  focusFire: boolean;
  /** Skilled play: shift the build mix toward counters of scouted enemy units. */
  counterBuild: boolean;
  /** Use Pull the Plug on clustered AI units (humans only). */
  usePlug: boolean;
  /** Earliest tick for the first attack (gives new players time to learn). */
  attackNotBefore?: number;
  /** Defend workers, buildings and owned sites anywhere on our half, not just the core (D-018 pressure test). */
  guardOutposts?: boolean;
  /**
   * Most Server Racks a bot may have once Data piles up (production is short of Compute, not Data).
   * See `spareWhen` for what counts as piling up.
   */
  spareRacks?: number;
  /**
   * Banked Data (milli) that must last `ticks` in a row before spare racks go up. Default: 300 Data, at
   * once. The balance strategies wait for a large, lasting bank (issue #1): four racks on the instant
   * trigger let rush snowball, and even one rack on a 300 Data / 20 s trigger moved rush vs boom ~40 points.
   */
  spareWhen?: { data: number; ticks: number };
  /**
   * After an attack is wiped out, regroup and rebuild to full strength instead of sending reinforcements in
   * small waves. Off for the balance strategies: on for them it pushed the rush and boom mirrors out of 40-60%.
   */
  regroup?: boolean;
  /** Attack this sector instead of the enemy core (the LLM General's target; its waves still mass first). */
  attackAt?: SectorId;
}

/** Balance strategies add one spare rack only after banking 1,000+ Data for a full minute (issue #1). */
const BANKED = { data: 1000 * MILLI, ticks: 60 * TICK_RATE };

export const STRATEGIES: Record<string, Strategy> = {
  rush: { name: 'rush', workers: 4, racks: 0, barricades: 0, defenses: 0, mix: { fast: 2, ranged: 1 }, attackValue: 250, focusFire: true, counterBuild: true, usePlug: true, guardOutposts: true, spareRacks: 1, spareWhen: BANKED },
  boom: { name: 'boom', workers: 8, racks: 2, barricades: 0, defenses: 1, mix: { fast: 1, ranged: 1, tank: 1 }, attackValue: 700, focusFire: true, counterBuild: true, usePlug: true, guardOutposts: true, spareRacks: 3, spareWhen: BANKED },
  turtle: { name: 'turtle', workers: 6, racks: 1, barricades: 3, defenses: 3, mix: { ranged: 2, tank: 2, fast: 1 }, attackValue: 900, focusFire: true, counterBuild: true, usePlug: true, guardOutposts: true, spareRacks: 2, spareWhen: BANKED },
};

/** Gentle opponent for learning the game: slow economy, no micro, attacks late. Not part of balance runs. */
export const TRAINING: Strategy = {
  name: 'training', workers: 4, racks: 0, barricades: 0, defenses: 0, mix: { fast: 1, ranged: 1, tank: 1 }, attackValue: 500,
  focusFire: false, counterBuild: false, usePlug: false, attackNotBefore: 8 * 60 * 20, spareRacks: 4, regroup: true,
};

/**
 * Hard opponent for players who beat the training AI: fast-heavy army on 3 Server Racks (more when Data
 * piles up), no static defenses, full micro, outpost defense, no grace period. Tuned on 40 unseen seeds
 * against the bot strategies: wins ~68% vs rush, 100% vs boom and turtle (the boom AI: ~25/78/98%).
 * No cheats: same commands, APM cap and reaction delay as every bot. Not part of balance runs.
 */
export const BRUTAL: Strategy = {
  name: 'brutal', workers: 5, racks: 3, barricades: 0, defenses: 0, mix: { fast: 3, ranged: 1, tank: 1 }, attackValue: 600,
  focusFire: true, counterBuild: true, usePlug: true, spareRacks: 4, regroup: true, guardOutposts: true,
};

/** Every opponent a player can pick (`?ai=` in the browser, `--ai` in the sim). */
export const OPPONENTS: Record<string, Strategy> = { ...STRATEGIES, training: TRAINING, brutal: BRUTAL };

const ARMY_UNITS: Record<Faction, Record<Exclude<Role, 'worker'>, UnitTypeId>> = {
  human: { fast: 'counter_drone_team', ranged: 'red_team', tank: 'armored_vehicle' },
  ai: { fast: 'botnet_swarm', ranged: 'hunter_drone', tank: 'industrial_robot' },
};
const BEATS = { fast: 'ranged', ranged: 'tank', tank: 'fast' } as const;
const PRODUCTION: Record<Faction, BuildingTypeId> = { human: 'soc', ai: 'training_cluster' };
const CORE: Record<Faction, BuildingTypeId> = { human: 'noc', ai: 'primary_cluster' };
const WORKER: Record<Faction, UnitTypeId> = { human: 'field_engineer', ai: 'maintenance_drone' };
const DEFENSE: Record<Faction, BuildingTypeId> = { human: 'security_post', ai: 'sentry_gun' };
/**
 * A site is guarded while enemy combat units or static defenses are seen within `range` of it. Workers
 * don't go to claim it, and the bot remembers it for `memoryTicks` after the guards drop out of sight.
 */
const GUARD = { range: 6 * TILE, memoryTicks: 60 * 20 };
/**
 * Spare Data: production speed comes from Compute, shared by all production buildings, so a bot banking
 * more than `data` adds Server Racks (+Compute, up to its strategy's `spareRacks`) while `powerFree` Power
 * is left. A strategy's `spareWhen` can ask for a bigger bank held for a while.
 */
const SURPLUS = { data: 300 * MILLI, powerFree: 4 };

/** A scripted bot whose strategy can be swapped between decisions (the LLM General steers it this way). */
export interface ScriptedBot extends Controller {
  strategy: Strategy;
}

export function createScriptedBot(faction: Faction, initial: Strategy, seed = 1): ScriptedBot {
  const rng = createRng(seed);
  // Small per-seed variation so batch matches differ.
  const attackJitter = 50 * rng.int(-1, 2);
  const busy = new Map<number, string>(); // worker id -> job key
  let attacking = false;
  let lastTarget: [number, number] | null = null;
  let rallySet = false;
  /** Most enemy units of each role seen at once (scouting memory, used for counter-building). */
  const seen: Record<Exclude<Role, 'worker'>, number> = { fast: 0, ranged: 0, tank: 0 };
  /** Current focus target per role, so focus fire doesn't spend an action every decision. */
  const focus: Record<Exclude<Role, 'worker'>, number | null> = { fast: null, ranged: null, tank: null };
  // The bot sees the world a reaction delay late. Remember orders and spending not visible yet, so it
  // neither repeats an order nor spends the same Data twice.
  const pendingUntil = new Map<number, number>(); // unit or building id -> last tick its order may be unseen
  let reserved: { until: number; cost: number }[] = [];
  /** Site id -> last tick it counts as guarded (sending lone workers there just feeds them to the guards). */
  const guardedUntil = new Map<string, number>();
  /** Units sent to attack-move at a threat (no-micro defense), so they aren't re-ordered on the way. */
  const defending = new Set<number>();
  /** Tick since which Data has stayed above the strategy's spare-rack bank (null while it is below). */
  let bankingSince: number | null = null;

  const bot: ScriptedBot = {
    name: `${initial.name}${initial.focusFire || initial.counterBuild ? '' : '-sloppy'}`,
    strategy: initial,
    decide(raw: FactionView): Command[] {
      const strategy = bot.strategy;
      const attackValue = strategy.attackValue + attackJitter;
      const out: Command[] = [];
      reserved = reserved.filter((r) => r.until >= raw.tick);
      const v = { ...raw, data: raw.data - reserved.reduce((sum, r) => sum + r.cost, 0) };
      const bank = strategy.spareWhen ?? { data: SURPLUS.data, ticks: 0 };
      bankingSince = v.data >= bank.data ? bankingSince ?? v.tick : null;
      const banking = bankingSince !== null && v.tick - bankingSince >= bank.ticks;
      const pending = (id: number) => (pendingUntil.get(id) ?? -1) >= v.tick;
      const order = (cmd: Command, ids: number[], cost = 0) => {
        out.push(cmd);
        for (const id of ids) pendingUntil.set(id, v.tick + FAIRNESS.reactionDelay);
        if (cost > 0) {
          v.data -= cost;
          reserved.push({ until: v.tick + FAIRNESS.reactionDelay, cost });
        }
      };
      const core = v.buildings.find((b) => b.type === CORE[faction]);
      if (!core) return out;
      const enemyCore = v.sites.find((s) => s.kind === 'core' && !(s.x === core.x && s.y === core.y));
      const workers = v.units.filter((u) => u.role === 'worker');
      const army = v.units.filter((u) => u.role !== 'worker');
      const value = (us: UnitView[]) => us.reduce((sum, u) => sum + Math.trunc(UNITS[u.type].cost / MILLI), 0);
      const prod = v.buildings.find((b) => b.type === PRODUCTION[faction]);
      const towardCenter = Math.sign(v.mapWidth * TILE / 2 - core.x);

      // Forget jobs of workers that went idle or died.
      for (const [id] of busy) {
        const w = workers.find((u) => u.id === id);
        if (!w || (w.order === 'idle' && !pending(id))) busy.delete(id);
      }

      // 1. Defend the base, and with guardOutposts also workers, buildings and owned sites on our half.
      const near = (e: UnitView, x: number, y: number, tiles: number) => dist2(e.x, e.y, x, y) < (tiles * TILE) ** 2;
      const ourHalf = (e: UnitView) => !enemyCore || dist2(e.x, e.y, core.x, core.y) <= dist2(e.x, e.y, enemyCore.x, enemyCore.y);
      const threats = v.enemyUnits.filter((e) => near(e, core.x, core.y, 12) || (strategy.guardOutposts && ourHalf(e) && (
        workers.some((w) => near(e, w.x, w.y, 6)) || v.buildings.some((b) => near(e, b.x, b.y, 6))
        || v.sites.some((s) => s.owner === faction && near(e, s.x, s.y, 6)))))
        .sort((a, b) => dist2(a.x, a.y, core.x, core.y) - dist2(b.x, b.y, core.x, core.y) || a.id - b.id);
      // Only units not already fighting a threat get orders: at the APM cap, re-issuing the same order
      // every decision would starve production and worker jobs.
      for (const id of defending) {
        if (!pending(id) && !army.some((u) => u.id === id && u.order === 'attackMove')) defending.delete(id);
      }
      const defenders = army.filter((u) => !pending(u.id) && !defending.has(u.id) && !threats.some((t) => t.id === u.target));
      if (threats.length > 0 && defenders.length > 0) {
        if (strategy.focusFire) {
          for (const role of ['fast', 'ranged', 'tank'] as const) {
            const group = defenders.filter((u) => u.role === role).map((u) => u.id);
            if (group.length > 0) order({ type: 'attack', units: group, target: pickTarget(role, threats).id }, group);
          }
        } else {
          // No micro, but head for the threat: attack-moving to our own core left defenders idle there
          // whenever attackers stood just out of their sight.
          const ids = defenders.map((u) => u.id);
          const t = threats[0]!; // nearest to the core (threats are sorted)
          for (const id of ids) defending.add(id);
          order({ type: 'attackMove', units: ids, x: t.x, y: t.y }, ids);
        }
      }

      // 2. Pull the Plug on clustered enemies near our units.
      if (strategy.usePlug && v.plugReadyIn === 0) {
        const target = clusterNear(v.enemyUnits, [...army, ...workers]);
        if (target) order({ type: 'pullThePlug', x: target[0], y: target[1] }, []);
      }

      for (const role of ['fast', 'ranged', 'tank'] as const) {
        seen[role] = Math.max(seen[role], v.enemyUnits.filter((e) => e.role === role).length);
      }

      // 3. Micro: each role in a fight focuses the enemy it counters.
      if (strategy.focusFire && threats.length === 0) {
        for (const role of ['fast', 'ranged', 'tank'] as const) {
          const group = army.filter((a) => a.role === role && !pending(a.id)
            && v.enemyUnits.some((e) => dist2(a.x, a.y, e.x, e.y) < (7 * TILE) ** 2));
          const near = v.enemyUnits.filter((e) => group.some((a) => dist2(a.x, a.y, e.x, e.y) < (6 * TILE) ** 2));
          // Re-target only when the current focus target is gone.
          if (near.length === 0 || near.some((e) => e.id === focus[role])) continue;
          const target = pickTarget(role, near);
          focus[role] = target.id;
          order({ type: 'attack', units: group.map((u) => u.id), target: target.id }, group.map((u) => u.id));
        }
      }

      // 4. Production comes before worker jobs: the APM cap allows about one action per decision.
      // When a larger enemy army is on our half, stop growing the economy and train army only.
      const invaders = v.enemyUnits.filter((e) => e.role !== 'worker'
        && (!enemyCore || dist2(e.x, e.y, core.x, core.y) < dist2(e.x, e.y, enemyCore.x, enemyCore.y)));
      const underPressure = invaders.length > army.length;
      if (prod?.built) {
        if (!rallySet) {
          rallySet = true;
          order({ type: 'setRally', building: prod.id, x: core.x + towardCenter * 5 * TILE, y: core.y }, []);
        }
        if (prod.queue.length < 2 && !pending(prod.id)) {
          const unit = pickArmyUnit(faction, strategy.counterBuild ? counterMix(strategy, seen) : strategy, army);
          if (unit && v.data >= UNITS[unit].cost) order({ type: 'train', building: prod.id, unit }, [prod.id], UNITS[unit].cost);
        }
      }

      // Under pressure, keep at least a minimal workforce so the economy can recover after a raid.
      const wantWorkers = underPressure ? Math.min(2, strategy.workers) : strategy.workers;
      if (workers.length < wantWorkers && core.queue.length === 0 && !pending(core.id)
        && v.data >= UNITS[WORKER[faction]].cost) {
        order({ type: 'train', building: core.id, unit: WORKER[faction] }, [core.id], UNITS[WORKER[faction]].cost);
      }

      // 5. Jobs for idle workers, away from guarded sites.
      const guards = [...v.enemyUnits.filter((e) => e.role !== 'worker'), ...v.enemyBuildings.filter((b) => Object.values(DEFENSE).includes(b.type))];
      for (const s of v.sites) {
        if (guards.some((g) => dist2(g.x, g.y, s.x, s.y) < GUARD.range ** 2)) guardedUntil.set(s.id, v.tick + GUARD.memoryTicks);
      }
      const guarded = new Set([...guardedUntil].filter(([, until]) => until >= v.tick).map(([id]) => id));
      for (const w of workers) {
        if (w.order !== 'idle' || busy.has(w.id)) continue;
        const wantRelay = SIGNAL.enabled && faction === 'ai' && value(army) >= attackValue;
        const job = nextJob(v, faction, strategy, core, prod, busy, rng, towardCenter, wantRelay, guarded, banking);
        if (!job) break;
        busy.set(w.id, job.key);
        if ('units' in job.cmd) job.cmd.units = [w.id];
        order(job.cmd, [w.id], job.cmd.type === 'build' ? BUILDINGS[job.cmd.building].cost : 0);
      }

      // 6. Attack once the army is big enough; keep feeding reinforcements.
      const idleArmy = army.filter((u) => u.order === 'idle' && !pending(u.id));
      const mayAttack = v.tick >= (strategy.attackNotBefore ?? 0);
      // The LLM General picks the target sector (attackAt); otherwise go for the enemy core.
      const target: [number, number] | null = strategy.attackAt
        ? sectorCenter({ width: v.mapWidth, height: v.mapHeight }, strategy.attackAt) : enemyCore ? [enemyCore.x, enemyCore.y] : null;
      // No attack wanted (the General called it off): stop sending waves.
      if (!Number.isFinite(attackValue)) attacking = false;
      // A new target turns the marching army with it, so waves don't split between old and new targets.
      if (attacking && target && lastTarget && (target[0] !== lastTarget[0] || target[1] !== lastTarget[1])) {
        const marching = army.filter((u) => u.order === 'attackMove' && !pending(u.id)).map((u) => u.id);
        if (marching.length > 0) order({ type: 'attackMove', units: marching, x: target[0], y: target[1] }, marching);
      }
      lastTarget = target;
      // Reinforcements go out in waves worth about three average units.
      // An attack that was wiped out regroups and rebuilds to full strength; feeding a few units at a
      // time into a standing army just loses them one by one.
      if (strategy.regroup && attacking && value(army) < attackValue / 3) attacking = false;
      if (target && mayAttack && (attacking ? value(idleArmy) >= 150 : value(army) >= attackValue)) {
        const group = attacking ? idleArmy : army;
        attacking = true;
        if (group.length > 0) order({ type: 'attackMove', units: group.map((u) => u.id), x: target[0], y: target[1] }, group.map((u) => u.id));
      }
      return out;
    },
  };
  return bot;
}

/** The weakest enemy this role counters, else the weakest enemy. */
function pickTarget(role: Exclude<Role, 'worker'>, enemies: UnitView[]): UnitView {
  const prey = enemies.filter((e) => e.role === BEATS[role]);
  return [...(prey.length > 0 ? prey : enemies)].sort((a, b) => a.hp - b.hp || a.id - b.id)[0]!;
}

function clusterNear(enemies: UnitView[], ours: UnitView[]): [number, number] | null {
  for (const e of enemies) {
    const group = enemies.filter((o) => dist2(o.x, o.y, e.x, e.y) < (3 * TILE) ** 2);
    if (group.length >= 4 && ours.some((u) => dist2(u.x, u.y, e.x, e.y) < (8 * TILE) ** 2)) {
      const cx = Math.trunc(group.reduce((s, g) => s + g.x, 0) / group.length);
      const cy = Math.trunc(group.reduce((s, g) => s + g.y, 0) / group.length);
      return [cx, cy];
    }
  }
  return null;
}

/** Shift the build mix toward units that beat what we've scouted. */
function counterMix(s: Strategy, seen: Record<Exclude<Role, 'worker'>, number>): Strategy {
  const counterOf = { fast: 'tank', ranged: 'fast', tank: 'ranged' } as const;
  const mix = { ...s.mix };
  for (const role of ['fast', 'ranged', 'tank'] as const) {
    const c = counterOf[role];
    mix[c] = (mix[c] ?? 0) + seen[role];
  }
  return { ...s, mix };
}

/** Next army unit by mix weight; null when every weight is zero (army production paused). */
function pickArmyUnit(faction: Faction, s: Strategy, army: UnitView[]): UnitTypeId | null {
  let best: Exclude<Role, 'worker'> | null = null;
  let bestScore = Infinity;
  for (const role of ['fast', 'ranged', 'tank'] as const) {
    const weight = s.mix[role] ?? 0;
    if (weight <= 0) continue;
    const score = army.filter((u) => u.role === role).length / weight;
    if (score < bestScore) { bestScore = score; best = role; }
  }
  return best ? ARMY_UNITS[faction][best] : null;
}

type Job = { key: string; cmd: Command & { units?: number[] } };

function nextJob(
  v: FactionView, faction: Faction, s: Strategy, core: FactionView['buildings'][number],
  prod: FactionView['buildings'][number] | undefined, busy: Map<number, string>, rng: Rng, toward: number,
  wantRelay = false, guarded: Set<string> = new Set(), banking = false,
): Job | null {
  const taken = new Set(busy.values());
  const enemyCore = v.sites.find((x) => x.kind === 'core' && !(x.x === core.x && x.y === core.y));
  const mine = (site: SiteView | undefined) =>
    !!site && (site.owner === faction || (site.kind === 'router' && site.owner === null) || (site.kind === 'core' && site.x === core.x && site.y === core.y));
  const siteById = new Map(v.sites.map((x) => [x.id, x]));

  // Finish unbuilt buildings first.
  const unbuilt = v.buildings.find((b) => !b.built && !taken.has(`build:${b.id}`));
  if (unbuilt) return { key: `build:${unbuilt.id}`, cmd: { type: 'construct', units: [], building: unbuilt.id } };

  // Production building early.
  if (!prod && v.data >= BUILDINGS[PRODUCTION[faction]].cost && !taken.has('new:prod')) {
    const [x, y] = spot(v, core, toward, rng);
    return { key: 'new:prod', cmd: { type: 'build', units: [], building: PRODUCTION[faction], x, y } };
  }

  // Light links between friendly endpoints (our sites, our core, neutral routers), closest to home first.
  const links = v.links
    .filter((l) => !l.mine && !taken.has(`link:${l.index}`) && mine(siteById.get(l.a)) && mine(siteById.get(l.b)))
    .sort((a, b) => linkDist(a, siteById, core) - linkDist(b, siteById, core) || a.index - b.index);
  if (links[0]) return { key: `link:${links[0].index}`, cmd: { type: 'lightLink', units: [], link: links[0].index } };

  // Data piling up means production is short of Compute, not Data: add a Server Rack.
  const racks = v.buildings.filter((b) => b.type === 'server_rack').length;
  if (banking && v.data >= BUILDINGS.server_rack.cost && racks < (s.spareRacks ?? 0) && v.powerCap - v.powerUsed >= SURPLUS.powerFree
    && !taken.has('new:rack')) {
    const [x, y] = spot(v, core, toward, rng);
    return { key: 'new:rack', cmd: { type: 'build', units: [], building: 'server_rack', x, y } };
  }

  // Signal range (proposal 0001): before an attack, extend the Model's signal toward the enemy core.
  if (wantRelay && enemyCore && v.data >= BUILDINGS.signal_relay.cost && !taken.has('new:relay')) {
    const at = relaySpot(v, core, enemyCore);
    if (at) return { key: 'new:relay', cmd: { type: 'build', units: [], building: 'signal_relay', x: at[0], y: at[1] } };
  }

  // One worker builds static defenses while the others expand.
  const defense = DEFENSE[faction];
  const defenses = v.buildings.filter((b) => b.type === defense).length;
  if (defenses < s.defenses && v.data >= BUILDINGS[defense].cost && !taken.has('new:defense')) {
    const at = defenseSpot(v, faction, core, toward);
    if (at) return { key: 'new:defense', cmd: { type: 'build', units: [], building: defense, x: at[0], y: at[1] } };
  }

  // Claim (or retake) the nearest site on our half or in the center.
  const sites = v.sites
    .filter((x) => x.kind !== 'core' && x.owner !== faction && !taken.has(`claim:${x.id}`) && !guarded.has(x.id)
      // Workers stay on our half and the center; the far half is enemy territory.
      && (!enemyCore || dist2(x.x, x.y, core.x, core.y) <= dist2(x.x, x.y, enemyCore.x, enemyCore.y)))
    .sort((a, b) => dist2(a.x, a.y, core.x, core.y) - dist2(b.x, b.y, core.x, core.y)
      || side(core, enemyCore, a) - side(core, enemyCore, b) || a.id.localeCompare(b.id));
  if (sites[0]) return { key: `claim:${sites[0].id}`, cmd: { type: 'claim', units: [], site: sites[0].id } };

  if (racks < s.racks && v.data >= BUILDINGS.server_rack.cost && !taken.has('new:rack')) {
    const [x, y] = spot(v, core, toward, rng);
    return { key: 'new:rack', cmd: { type: 'build', units: [], building: 'server_rack', x, y } };
  }
  const walls = v.buildings.filter((b) => b.type === 'barricade').length;
  if (faction === 'human' && walls < s.barricades && v.data >= BUILDINGS.barricade.cost && !taken.has('new:wall')) {
    const x = core.x + toward * 9 * TILE;
    const y = core.y + (walls - 1) * 2 * TILE;
    return { key: 'new:wall', cmd: { type: 'build', units: [], building: 'barricade', x, y } };
  }
  return null;
}

/**
 * Which side of the line from our core to the enemy core a site is on. Used as a tie-break so bots on
 * both sides of a symmetric map make mirror-image choices instead of racing for the same site.
 */
function side(core: { x: number; y: number }, enemy: { x: number; y: number } | undefined, s: { x: number; y: number }): number {
  if (!enemy) return 0;
  return Math.sign((enemy.x - core.x) * (s.y - core.y) - (enemy.y - core.y) * (s.x - core.x));
}

function linkDist(l: FactionView['links'][number], sites: Map<string, SiteView>, core: { x: number; y: number }): number {
  const a = sites.get(l.a)!;
  const b = sites.get(l.b)!;
  return Math.min(dist2(a.x, a.y, core.x, core.y), dist2(b.x, b.y, core.x, core.y));
}

/**
 * A spot guarding our most exposed Data source (the one nearest the enemy core), clear of sites and
 * other buildings. Falls back to the front of our core.
 */
function defenseSpot(v: FactionView, faction: Faction, core: { x: number; y: number }, toward: number): [number, number] | null {
  const enemyCore = v.sites.find((x) => x.kind === 'core' && !(x.x === core.x && x.y === core.y));
  const guarded = (x: number, y: number) => v.buildings.some((b) => b.type === DEFENSE[faction] && dist2(b.x, b.y, x, y) < (5 * TILE) ** 2);
  const exposed = v.sites
    .filter((x) => x.kind === 'data_source' && x.owner === faction && !guarded(x.x, x.y))
    .sort((a, b) => (enemyCore ? dist2(a.x, a.y, enemyCore.x, enemyCore.y) - dist2(b.x, b.y, enemyCore.x, enemyCore.y) : 0) || a.id.localeCompare(b.id));
  const anchors = [...exposed.map((x) => [x.x, x.y] as const), [core.x + toward * 4 * TILE, core.y] as const];
  for (const [ax, ay] of anchors) {
    for (const [dx, dy] of [[toward * 2, 0], [0, 2], [0, -2], [-toward * 2, 0]]) {
      const x = ax + dx! * TILE;
      const y = ay + dy! * TILE;
      if (clearOf(v, x, y, 2)) return [x, y];
    }
  }
  return null;
}

/** Whether our own view says a point has the Model's signal (sites, built buildings, lit fiber). */
function covered(v: FactionView, x: number, y: number): boolean {
  const r2 = SIGNAL.range * SIGNAL.range;
  const sites = new Map(v.sites.map((s) => [s.id, s]));
  if (v.sites.some((s) => s.owner === v.faction && dist2(s.x, s.y, x, y) <= r2)) return true;
  if (v.buildings.some((b) => b.built && dist2(b.x, b.y, x, y) <= r2)) return true;
  return v.links.some((l) => {
    if (!l.mine) return false;
    const a = sites.get(l.a)!;
    const b = sites.get(l.b)!;
    // Sample the fiber every tile; close enough for planning.
    const n = Math.max(1, Math.trunc(isqrt(dist2(a.x, a.y, b.x, b.y)) / TILE));
    for (let i = 0; i <= n; i++) {
      if (dist2(a.x + Math.trunc(((b.x - a.x) * i) / n), a.y + Math.trunc(((b.y - a.y) * i) / n), x, y) <= r2) return true;
    }
    return false;
  });
}

/**
 * Next relay spot: walk from the enemy core toward ours to the first covered point, then place the relay
 * almost a full signal range further toward the enemy. Null once the enemy core is within reach.
 */
function relaySpot(v: FactionView, core: { x: number; y: number }, enemy: { x: number; y: number }): [number, number] | null {
  const len = isqrt(dist2(core.x, core.y, enemy.x, enemy.y));
  const at = (d: number): [number, number] =>
    [enemy.x + Math.trunc(((core.x - enemy.x) * d) / len), enemy.y + Math.trunc(((core.y - enemy.y) * d) / len)];
  const reach = 3 * TILE;
  if (covered(v, ...at(reach))) return null;
  for (let d = reach; d < len; d += TILE) {
    if (!covered(v, ...at(d))) continue;
    for (let back = 0; back < 4 * TILE; back += TILE) {
      const spot = at(Math.max(reach, d - SIGNAL.range + TILE + back));
      if (clearOf(v, spot[0], spot[1], 2)) return spot;
    }
    return null;
  }
  return null;
}

function clearOf(v: FactionView, x: number, y: number, tiles = 3): boolean {
  return v.buildings.every((b) => dist2(b.x, b.y, x, y) > (tiles * TILE) ** 2)
    && v.sites.every((s) => dist2(s.x, s.y, x, y) > (tiles * TILE) ** 2);
}

/** A building spot behind the core, away from sites and other buildings. */
function spot(v: FactionView, core: { x: number; y: number }, toward: number, rng: Rng): [number, number] {
  for (let i = 0; i < 20; i++) {
    const x = core.x + (rng.int(-4, 1) * toward) * TILE;
    const y = core.y + rng.int(-6, 6) * TILE;
    if (clearOf(v, x, y) && x > TILE && y > TILE && x < (v.mapWidth - 1) * TILE && y < (v.mapHeight - 1) * TILE) return [x, y];
  }
  return [core.x - toward * 3 * TILE, core.y + 4 * TILE];
}
