// Visual feedback the sim doesn't need: hit flashes, death markers, map pings, and attack alerts.
// Derived by comparing the player's view frame to frame (render-only, never affects the game).
import type { Graphics } from 'pixi.js';
import { construction, dist2, TILE, training, UNITS, type FactionView, type Role, type UnitView } from '../sim/index.ts';
import { pretty } from './card.ts';
import { constructionText, trainingText } from './hud.ts';
import { sourceWarnings, workforce } from './jobs.ts';

interface Mark { x: number; y: number; until: number; color: number }

export interface Effects {
  hp: Map<number, number>;
  pos: Map<number, { x: number; y: number; mine: boolean }>;
  flashes: Map<number, number>;
  deaths: Mark[];
  pings: Mark[];
  lastAlert: Map<string, number>;
  /** Where each alert happened (by its text), so tapping the alert can jump the camera there. */
  alertAt: Map<string, [number, number]>;
}

export function createEffects(): Effects {
  return { hp: new Map(), pos: new Map(), flashes: new Map(), deaths: [], pings: [], lastAlert: new Map(), alertAt: new Map() };
}

const ALERT_COOLDOWN_MS = 20_000;

/** Update from the latest view. Returns alert messages to show. */
export function updateEffects(fx: Effects, v: FactionView, now: number): string[] {
  const alerts: string[] = [];
  const all = [...v.units.map((u) => ({ e: u, mine: true })), ...v.enemyUnits.map((u) => ({ e: u, mine: false })),
    ...v.buildings.map((b) => ({ e: b, mine: true })), ...v.enemyBuildings.map((b) => ({ e: b, mine: false }))];
  const seen = new Set<number>();
  for (const { e, mine } of all) {
    seen.add(e.id);
    const before = fx.hp.get(e.id);
    if (before !== undefined && e.hp < before) {
      fx.flashes.set(e.id, now + 150);
      if (mine && 'built' in e) {
        if (alert(fx, alerts, `hit:${e.id}`, now, `⚠ Your ${pretty(e.type)} is under attack!`)) fx.alertAt.set(alerts[alerts.length - 1]!, [e.x, e.y]);
        fx.pings.push({ x: e.x, y: e.y, until: now + 2000, color: 0xe5534b });
      }
    }
    fx.hp.set(e.id, e.hp);
    fx.pos.set(e.id, { x: e.x, y: e.y, mine });
  }
  // Anything we were tracking that vanished while visible died (or left sight; only mark our own losses
  // and enemies that disappeared at low HP).
  for (const [id, p] of fx.pos) {
    if (seen.has(id)) continue;
    if (p.mine || (fx.hp.get(id) ?? 1) <= 0 || fx.flashes.has(id)) {
      fx.deaths.push({ x: p.x, y: p.y, until: now + 1500, color: p.mine ? 0x4aa3ff : 0xff8a3d });
    }
    fx.pos.delete(id);
    fx.hp.delete(id);
    fx.flashes.delete(id);
  }

  // Enemy forces near our buildings: warn once per area per cooldown.
  const raiders = v.enemyUnits.filter((e) => e.role !== 'worker');
  const core = v.buildings.find((b) => b.type === 'noc' || b.type === 'primary_cluster');
  // Earlier warning: enemy army spotted anywhere on our half of the map.
  const ourHalf = core ? raiders.filter((e) => Math.abs(e.x - core.x) < (v.mapWidth * TILE) / 2) : [];
  if (ourHalf.length >= 2) {
    const cx = Math.trunc(ourHalf.reduce((s, e) => s + e.x, 0) / ourHalf.length);
    const cy = Math.trunc(ourHalf.reduce((s, e) => s + e.y, 0) / ourHalf.length);
    if (alert(fx, alerts, `spotted:${ourHalf[0]!.sector}`, now, `⚠ AI forces spotted in sector ${ourHalf[0]!.sector}: ${composition(ourHalf)}`)) {
      fx.alertAt.set(alerts[alerts.length - 1]!, [cx, cy]);
      fx.pings.push({ x: cx, y: cy, until: now + 3000, color: 0xffd866 });
    }
  }
  for (const b of v.buildings) {
    const near = raiders.filter((e) => dist2(e.x, e.y, b.x, b.y) < (14 * TILE) ** 2);
    if (near.length === 0) continue;
    const key = `near:${b.sector}`;
    if (alert(fx, alerts, key, now, `⚠ Enemy forces approaching your ${pretty(b.type)} (${b.sector}): ${composition(near)}`)) {
      const cx = Math.trunc(near.reduce((s, e) => s + e.x, 0) / near.length);
      const cy = Math.trunc(near.reduce((s, e) => s + e.y, 0) / near.length);
      fx.alertAt.set(alerts[alerts.length - 1]!, [cx, cy]);
      fx.pings.push({ x: cx, y: cy, until: now + 3000, color: 0xffd866 });
    }
  }
  fx.deaths = fx.deaths.filter((d) => d.until > now);
  fx.pings = fx.pings.filter((p) => p.until > now);
  for (const [id, until] of fx.flashes) if (until <= now) fx.flashes.delete(id);
  return alerts;
}

function alert(fx: Effects, out: string[], key: string, now: number, text: string): boolean {
  if (now - (fx.lastAlert.get(key) ?? -Infinity) < ALERT_COOLDOWN_MS) return false;
  fx.lastAlert.set(key, now);
  out.push(text);
  return true;
}

/**
 * Army strength: Data value scaled by remaining health, so a battered army counts for less. A rough
 * guide only: counters and Adaptation can swing a fight either way.
 */
export function strength(list: UnitView[]): number {
  return list.reduce((sum, u) => sum + Math.trunc((UNITS[u.type].cost / 1000) * u.hp / u.maxHp), 0);
}

export function verdict(ours: number, theirs: number): string {
  if (theirs === 0) return 'no enemy army in sight';
  if (ours >= theirs * 1.3) return '<b class="ready">you are stronger</b>';
  if (theirs >= ours * 1.3) return '<b class="warn">they are stronger</b>';
  return '<b>evenly matched</b>';
}

export function composition(list: UnitView[]): string {
  const m = new Map<string, number>();
  for (const u of list) m.set(u.type, (m.get(u.type) ?? 0) + 1);
  return [...m].map(([t, n]) => `${n} ${pretty(t)}`).join(', ');
}

/** Engagement lines, hit flashes, death markers and pings, drawn on top of the world. */
/** Deaths (flash, shock ring, shards) and alert pings (two rippling rings). */
export function drawBursts(g: Graphics, fx: Effects, now: number): void {
  for (const d of fx.deaths) {
    // Death: a flash, an expanding shock ring and shards flying out, all fading over 1.5 s.
    const age = 1 - Math.max(0, (d.until - now) / 1500);
    const fade = 1 - age;
    if (age < 0.15) g.circle(d.x, d.y, 500 + age * 4000).fill({ color: 0xffffff, alpha: (0.15 - age) * 4 });
    g.circle(d.x, d.y, 400 + age * 2200).stroke({ width: 140 * fade + 20, color: d.color, alpha: 0.8 * fade });
    const seed = (d.x * 7 + d.y * 13) % 360;
    for (let i = 0; i < 9; i++) {
      const a = ((seed + i * 40 + (i % 3) * 11) * Math.PI) / 180;
      const dist = 300 + age * (1400 + (i % 4) * 350);
      const sx = d.x + Math.cos(a) * dist;
      const sy = d.y + Math.sin(a) * dist;
      g.moveTo(sx, sy).lineTo(sx + Math.cos(a) * 260 * fade, sy + Math.sin(a) * 260 * fade).stroke({ width: 70, color: d.color, alpha: fade });
    }
    g.circle(d.x, d.y, 180).fill({ color: d.color, alpha: 0.5 * fade });
  }
  for (const p of fx.pings) {
    // Alert pings: two rings rippling out from where the trouble is.
    for (const off of [0, 0.5]) {
      const t = ((now / 1000 + off) % 1);
      const life = Math.min(1, (p.until - now) / 1000);
      g.circle(p.x, p.y, 1200 + t * 3200).stroke({ width: 160 * (1 - t) + 30, color: p.color, alpha: (1 - t) * 0.8 * life });
    }
    g.circle(p.x, p.y, 380).fill({ color: p.color, alpha: 0.35 * Math.min(1, (p.until - now) / 1000) });
  }
}

export function drawEffects(g: Graphics, v: FactionView, fx: Effects, now: number): void {
  // Drawn on an additive layer (pixi.ts): overlapping light brightens, like real glow.
  g.clear();
  const byId = new Map<number, { x: number; y: number }>();
  for (const e of [...v.units, ...v.enemyUnits, ...v.buildings, ...v.enemyBuildings]) byId.set(e.id, e);
  for (const [list, color] of [[v.units, 0x7fc0ff], [v.enemyUnits, 0xffa766]] as const) {
    for (const u of list) {
      if (u.target === null) continue;
      const t = byId.get(u.target);
      if (!t) continue;
      // In range (allowing for building footprints): the unit is firing, so draw a tracer.
      const reach = UNITS[u.type].range + 1800;
      if (dist2(u.x, u.y, t.x, t.y) > reach * reach) continue;
      // A bolt travels from shooter to target over and over; its phase is staggered per unit.
      const p = ((now + u.id * 137) % 420) / 420;
      const hx = u.x + (t.x - u.x) * p;
      const hy = u.y + (t.y - u.y) * p;
      const tx = u.x + (t.x - u.x) * Math.max(0, p - 0.25);
      const ty = u.y + (t.y - u.y) * Math.max(0, p - 0.25);
      g.moveTo(u.x, u.y).lineTo(t.x, t.y).stroke({ width: 30, color, alpha: 0.12 });
      g.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: 110, color, alpha: 0.35 });
      g.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: 40, color: 0xffffff, alpha: 0.85 });
      // Impact spark at the target as each bolt lands.
      if (p > 0.8) g.circle(t.x, t.y, 160 + (p - 0.8) * 1600).fill({ color, alpha: (1 - p) * 2.5 });
    }
  }
  for (const [id, until] of fx.flashes) {
    const e = byId.get(id);
    if (!e) continue;
    const k = Math.max(0, (until - now) / 150);
    g.circle(e.x, e.y, 420 + (1 - k) * 260).fill({ color: 0xffffff, alpha: 0.35 * k });
    g.circle(e.x, e.y, 560 + (1 - k) * 400).stroke({ width: 60, color: 0xffffff, alpha: 0.6 * k });
  }
  drawBursts(g, fx, now);
}

const COUNTER: Record<Exclude<Role, 'worker'>, string> = {
  fast: 'Armored Vehicle', ranged: 'Counter-Drone Team', tank: 'Red Team',
};
const ROLE_NAME: Record<Exclude<Role, 'worker'>, string> = { fast: 'fast', ranged: 'ranged', tank: 'tank' };

/** Intel panel: visible enemy composition with the counter to build, plus our own army. */
export function intel(v: FactionView): string {
  const enemy = v.enemyUnits.filter((u) => u.role !== 'worker');
  const ours = v.units.filter((u) => u.role !== 'worker');
  const lines = [`<b>Your army:</b> ${ours.length ? `${composition(ours)} · strength ${strength(ours)}` : 'none'}`];
  if (enemy.length === 0) {
    lines.push('<b>Enemy seen:</b> none in sight');
  } else {
    lines.push(`<b>Enemy seen:</b> ${enemy.length} units · strength ${strength(enemy)}`);
    lines.push(`&nbsp;→ ${verdict(strength(ours), strength(enemy))} <span class="dim">(only what you can see)</span>`);
    for (const role of ['fast', 'ranged', 'tank'] as const) {
      const n = enemy.filter((u) => u.role === role);
      if (n.length) lines.push(`&nbsp;· ${composition(n)} (${ROLE_NAME[role]}) → counter: <b>${COUNTER[role]}</b>`);
    }
  }
  if (v.units.some((u) => u.role === 'worker')) lines.push(`<b>Engineers:</b> ${workforce(v)}`);
  lines.push(...sourceWarnings(v));
  for (const b of v.buildings) {
    const t = training(v, b);
    if (t) lines.push(`<b>${pretty(b.type)}:</b> ${trainingText(t)}`);
    const c = construction(v, b);
    if (c) lines.push(`<b>${pretty(b.type)}:</b> ${constructionText(c)}`);
  }
  lines.push('<span class="dim">● engineer ▲ fast ◆ ranged ■ tank · blue = you, orange = AI · dark ground = fog (enemies there are hidden)</span>');
  return lines.join('<br>');
}
