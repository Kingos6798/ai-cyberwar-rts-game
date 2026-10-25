// The General's memory of enemy armies it saw but can't see now (#30). Fog of war hides an army that
// steps out of view, so the digest alone forgets it. Built only from the FactionViews the General
// actually received (fog-safe); lives in the General, not the sim. Deterministic: plain data, no clocks.
import { BUILDINGS, SECTORS, TICK_RATE, UNITS, within, type FactionView, type SectorId, type UnitTypeId } from '../../sim/index.ts';

/** Forget a sighting after this long: armies move on. */
export const MEMORY_TICKS = 120 * TICK_RATE;

export interface LastSeen {
  sector: SectorId;
  enemy: Partial<Record<UnitTypeId, number>>;
  /** Seconds since the most recent sighting in this sector. */
  secondsAgo: number;
}

interface Sighting { type: UnitTypeId; x: number; y: number; sector: SectorId; tick: number }

export interface EnemyMemory {
  units: Map<number, Sighting>;
}

export function createEnemyMemory(): EnemyMemory {
  return { units: new Map() };
}

/** Whether our side can see a point right now (the sim's sight rule: units, and finished buildings). */
function inSight(v: FactionView, x: number, y: number): boolean {
  return v.units.some((u) => within(x, y, u.x, u.y, UNITS[u.type].sight))
    || v.buildings.some((b) => b.built && within(x, y, b.x, b.y, BUILDINGS[b.type].sight));
}

/**
 * Updates the memory from one view: visible enemy combat units are (re)recorded; a remembered unit is
 * dropped once its spot is in sight again without it, or after MEMORY_TICKS.
 */
export function observe(m: EnemyMemory, v: FactionView): void {
  const visible = new Set<number>();
  for (const e of v.enemyUnits) {
    if (e.role === 'worker') continue;
    visible.add(e.id);
    m.units.set(e.id, { type: e.type, x: e.x, y: e.y, sector: e.sector, tick: v.tick });
  }
  for (const [id, s] of m.units) {
    if (visible.has(id)) continue;
    if (v.tick - s.tick > MEMORY_TICKS || inSight(v, s.x, s.y)) m.units.delete(id);
  }
}

/** Remembered enemy units not in sight now, by sector (map order); empty when there are none. */
export function lastSeen(m: EnemyMemory, v: FactionView): LastSeen[] {
  const visible = new Set(v.enemyUnits.map((e) => e.id));
  const out: LastSeen[] = [];
  for (const sector of SECTORS) {
    const here = [...m.units].filter(([id, s]) => s.sector === sector && !visible.has(id)).map(([, s]) => s);
    if (here.length === 0) continue;
    const enemy: Partial<Record<UnitTypeId, number>> = {};
    for (const t of [...new Set(here.map((s) => s.type))].sort()) enemy[t] = here.filter((s) => s.type === t).length;
    const newest = Math.max(...here.map((s) => s.tick));
    out.push({ sector, enemy, secondsAgo: Math.trunc((v.tick - newest) / TICK_RATE) });
  }
  return out;
}
