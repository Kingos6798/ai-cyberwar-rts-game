// Draws the world as the human player sees it (fog of war applies). Shapes encode role (worker circle,
// fast triangle, ranged diamond, tank square), color encodes faction (blue/orange is colorblind-safe),
// so units read without relying on color alone. Each faction has its own silhouette on top of that:
// humans build in squares and shields, the Model in octagons, hexagons and rotor drones.
import type { Graphics } from 'pixi.js';
import {
  BUILDINGS, PULL_THE_PLUG, UNITS, type BuildingView, type Faction, type FactionView, type Role, type UnitTypeId, type UnitView, type World,
} from '../sim/index.ts';
import { drawFog } from './fog.ts';
import { drawJobs, drawSourceIssues } from './jobs.ts';

export const COLORS = {
  human: 0x4aa3ff,
  ai: 0xff8a3d,
  neutral: 0x7f8ca3,
  unseen: 0x34404f,
  darkFiber: 0x223040,
  selection: 0xffffff,
  selected: 0x55ff99,
  hpGood: 0x5bd88a,
  hpBad: 0xff6259,
  blackout: 0x000000,
  ground: 0x0f1722,
  grid: 0x6f9bd1,
  void: 0x060910,
} as const;

/** Blend two colors (0..1 toward b). */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}
const light = (c: number, t: number) => mix(c, 0xffffff, t);
const dark = (c: number, t: number) => mix(c, 0x05080d, t);
const OUTLINE = 0x04070c;

export const factionColor = (f: Faction | null | 'unknown') =>
  f === 'human' ? COLORS.human : f === 'ai' ? COLORS.ai : f === 'unknown' ? COLORS.unseen : COLORS.neutral;

export function drawWorld(g: Graphics, world: World, view: FactionView, selected: Set<number>): void {
  const now = performance.now();
  g.clear();
  drawGround(g, world.map.width, world.map.height);

  drawLinks(g, world, view, now);

  for (const s of view.sites) if (s.kind !== 'core') drawSite(g, s, now);

  // Fog of war over the ground and sites; your buildings and units draw on top.
  drawFog(g, view);

  for (const b of view.buildings) drawBuilding(g, b, view.faction, true, selected.has(b.id), view, now);
  const enemy: Faction = view.faction === 'human' ? 'ai' : 'human';
  for (const b of view.enemyBuildings) drawBuilding(g, b, enemy, false, selected.has(b.id), view, now);

  // Worker jobs: claim rings, fiber being lit, walking lines, idle markers.
  drawJobs(g, view, factionColor(view.faction), now);
  drawSourceIssues(g, view, now);

  for (const u of view.units) drawUnit(g, u, view.faction, selected.has(u.id), now);
  for (const u of view.enemyUnits) drawUnit(g, u, enemy, selected.has(u.id), now);

  drawBlackouts(g, world, now);
}

/** Ground, grid, sector lines and map edge. `surround`: also fill the void around the map (top-down view). */
export function drawGround(g: Graphics, tilesW: number, tilesH: number, surround = true): void {
  const W = tilesW * 1000;
  const H = tilesH * 1000;
  if (surround) g.rect(-6000, -6000, W + 12000, H + 12000).fill(COLORS.void);
  g.rect(0, 0, W, H).fill(COLORS.ground);
  // Faint tile grid, a stronger line every 4 tiles, and the 3x3 sector lines the General talks about.
  for (let x = 1; x < tilesW; x++) if (x % 4) g.moveTo(x * 1000, 0).lineTo(x * 1000, H);
  for (let y = 1; y < tilesH; y++) if (y % 4) g.moveTo(0, y * 1000).lineTo(W, y * 1000);
  g.stroke({ width: 22, color: COLORS.grid, alpha: 0.045 });
  for (let x = 4; x < tilesW; x += 4) g.moveTo(x * 1000, 0).lineTo(x * 1000, H);
  for (let y = 4; y < tilesH; y += 4) g.moveTo(0, y * 1000).lineTo(W, y * 1000);
  g.stroke({ width: 34, color: COLORS.grid, alpha: 0.085 });
  for (const f of [1 / 3, 2 / 3]) g.moveTo(W * f, 0).lineTo(W * f, H).moveTo(0, H * f).lineTo(W, H * f);
  g.stroke({ width: 60, color: COLORS.grid, alpha: 0.11 });
  // Map edge: a soft glow and a crisp line.
  g.rect(0, 0, W, H).stroke({ width: 900, color: COLORS.grid, alpha: 0.035 });
  g.rect(0, 0, W, H).stroke({ width: 110, color: COLORS.grid, alpha: 0.28 });
}

/** One site (not cores) in its owner's color: data source, router or substation. */
export function drawSite(g: Graphics, s: FactionView['sites'][number], now: number): void {
  const c = factionColor(s.owner);
  const owned = s.owner === 'human' || s.owner === 'ai';
  const pulse = owned ? 0.5 + 0.5 * Math.sin(now / 700 + s.x / 3000) : 0;
  if (s.kind === 'data_source') {
    // Bigger rings for richer sources (mid 200, home 120, expansions 50 milli-Data per tick).
    const k = s.rate >= 200 ? 1.2 : s.rate <= 60 ? 0.82 : 1;
    if (owned) g.circle(s.x, s.y, 950 * k + pulse * 120).fill({ color: c, alpha: 0.08 });
    g.circle(s.x, s.y, 680 * k).fill({ color: dark(c, 0.78), alpha: 0.85 }).stroke({ width: 80, color: c, alpha: 0.95 });
    g.circle(s.x, s.y, 450 * k).stroke({ width: 30, color: c, alpha: 0.55 });
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + (owned ? now / 4000 : 0);
      g.moveTo(s.x + Math.cos(a) * 520 * k, s.y + Math.sin(a) * 520 * k).lineTo(s.x + Math.cos(a) * 610 * k, s.y + Math.sin(a) * 610 * k);
    }
    g.stroke({ width: 40, color: c, alpha: 0.8 });
    g.circle(s.x, s.y, 230 * k).fill(light(c, 0.2));
    g.circle(s.x, s.y, 95 * k).fill({ color: 0xffffff, alpha: 0.85 });
  } else if (s.kind === 'router') {
    const r = 720;
    if (owned) g.circle(s.x, s.y, 980 + pulse * 100).fill({ color: c, alpha: 0.07 });
    g.poly([s.x, s.y - r, s.x + r, s.y, s.x, s.y + r, s.x - r, s.y]).fill({ color: dark(c, 0.78), alpha: 0.9 }).stroke({ width: 85, color: c });
    g.poly([s.x, s.y - 360, s.x + 360, s.y, s.x, s.y + 360, s.x - 360, s.y]).fill({ color: c, alpha: 0.45 });
    g.moveTo(s.x - 520, s.y).lineTo(s.x + 520, s.y).moveTo(s.x, s.y - 520).lineTo(s.x, s.y + 520).stroke({ width: 35, color: light(c, 0.3), alpha: 0.8 });
    g.circle(s.x, s.y, 110).fill({ color: 0xffffff, alpha: 0.8 });
  } else {
    // Substation: a hexagon with a lightning bolt.
    if (owned) g.circle(s.x, s.y, 950 + pulse * 100).fill({ color: c, alpha: 0.07 });
    g.regularPoly(s.x, s.y, 680, 6, Math.PI / 6).fill({ color: dark(c, 0.78), alpha: 0.9 }).stroke({ width: 85, color: c });
    g.poly([s.x + 110, s.y - 440, s.x - 260, s.y + 60, s.x - 10, s.y + 60, s.x - 110, s.y + 440, s.x + 260, s.y - 60, s.x + 10, s.y - 60])
      .fill(light(c, 0.25));
  }
}

function drawBuilding(g: Graphics, b: BuildingView, faction: Faction, mine: boolean, sel: boolean, view: FactionView, now: number): void {
  const r = BUILDINGS[b.type].radius;
  const c = factionColor(faction);
  const body = dark(c, 0.74);
  const weapon = BUILDINGS[b.type].weapon;
  const { x, y } = b;

  if (!b.built) {
    // Under construction: a holographic outline that fills as work progresses.
    const f = mine ? Math.max(0, Math.min(1, b.buildProgress / BUILDINGS[b.type].buildWork)) : 0.5;
    g.rect(x - r, y + r - 2 * r * f, 2 * r, 2 * r * f).fill({ color: c, alpha: 0.18 });
    g.rect(x - r, y - r, 2 * r, 2 * r).stroke({ width: 50, color: c, alpha: 0.55 + 0.25 * Math.sin(now / 250) });
    g.moveTo(x - r, y + r - 2 * r * f).lineTo(x + r, y + r - 2 * r * f).stroke({ width: 60, color: light(c, 0.5), alpha: 0.9 });
  } else {
    // Soft footprint glow under every building.
    g.circle(x, y, r * 1.45).fill({ color: c, alpha: 0.07 });
    switch (b.type) {
      case 'noc': {
        g.roundRect(x - r, y - r, 2 * r, 2 * r, 160).fill(body).stroke({ width: 110, color: c });
        g.roundRect(x - r + 260, y - r + 260, 2 * r - 520, 2 * r - 520, 80).stroke({ width: 40, color: light(c, 0.2), alpha: 0.55 });
        // Server lights: a 3x3 rack that blinks.
        const step = Math.floor(now / 380);
        for (let i = 0; i < 9; i++) {
          const lx = x - 560 + (i % 3) * 560;
          const ly = y - 560 + Math.floor(i / 3) * 560;
          const on = (i * 7 + step) % 5 !== 0;
          g.roundRect(lx - 150, ly - 110, 300, 220, 40).fill({ color: on ? light(c, 0.45) : dark(c, 0.4), alpha: on ? 0.95 : 0.8 });
        }
        break;
      }
      case 'primary_cluster': {
        g.regularPoly(x, y, r * 1.1, 8, Math.PI / 8).fill(body).stroke({ width: 110, color: c });
        g.regularPoly(x, y, r * 0.78, 8, Math.PI / 8).stroke({ width: 40, color: light(c, 0.2), alpha: 0.5 });
        // The Model's eye: a pulsing core.
        const p = 0.5 + 0.5 * Math.sin(now / 400);
        g.circle(x, y, r * 0.45 + p * 80).fill({ color: c, alpha: 0.25 });
        g.circle(x, y, r * 0.32).fill(c);
        g.circle(x, y, r * 0.14).fill({ color: light(c, 0.8), alpha: 0.95 });
        break;
      }
      case 'soc': {
        g.roundRect(x - r, y - r, 2 * r, 2 * r, 120).fill(body).stroke({ width: 90, color: c });
        // Shield emblem.
        g.poly([x, y - 560, x + 460, y - 380, x + 380, y + 220, x, y + 600, x - 380, y + 220, x - 460, y - 380]).fill({ color: c, alpha: 0.85 });
        g.poly([x, y - 330, x + 250, y - 220, x + 200, y + 140, x, y + 360, x - 200, y + 140, x - 250, y - 220]).fill({ color: light(c, 0.55), alpha: 0.9 });
        break;
      }
      case 'training_cluster': {
        g.regularPoly(x, y, r * 1.08, 6, 0).fill(body).stroke({ width: 90, color: c });
        // A small neural net.
        const nodes = [[-420, -260], [-420, 260], [0, -420], [0, 0], [0, 420], [420, -260], [420, 260]];
        for (const [ax, ay] of nodes.slice(0, 2)) for (const [bx, by] of nodes.slice(2, 5)) g.moveTo(x + ax!, y + ay!).lineTo(x + bx!, y + by!);
        for (const [ax, ay] of nodes.slice(2, 5)) for (const [bx, by] of nodes.slice(5)) g.moveTo(x + ax!, y + ay!).lineTo(x + bx!, y + by!);
        g.stroke({ width: 30, color: c, alpha: 0.6 });
        nodes.forEach(([nx, ny], i) => g.circle(x + nx!, y + ny!, 110).fill(i === 3 ? light(c, 0.6) : c));
        break;
      }
      case 'server_rack': {
        const w = r * 0.85;
        g.roundRect(x - w, y - r * 1.1, 2 * w, 2.2 * r, 70).fill(body).stroke({ width: 70, color: c });
        const step = Math.floor(now / 260);
        for (let i = 0; i < 4; i++) {
          const sy = y - r * 0.8 + i * r * 0.52;
          g.roundRect(x - w + 120, sy, 2 * w - 240, r * 0.3, 30).fill({ color: dark(c, 0.45), alpha: 0.95 });
          g.circle(x + w - 200, sy + r * 0.15, 55).fill((i + step) % 3 ? 0x5bd88a : light(c, 0.6));
        }
        break;
      }
      case 'barricade': {
        const bw = (2 * r) / 3;
        g.rect(x - bw / 2, y - r, bw, 2 * r).fill(dark(c, 0.55)).stroke({ width: 50, color: c });
        // Hazard stripes.
        for (let i = 0; i < 5; i++) {
          const sy = y - r + i * ((2 * r) / 5);
          g.poly([x - bw / 2, sy + 80, x + bw / 2, sy - 40, x + bw / 2, sy + 100, x - bw / 2, sy + 220]).fill({ color: 0xffcf5a, alpha: 0.85 });
        }
        break;
      }
      case 'signal_relay': {
        g.poly([x, y - r * 1.4, x + r * 0.7, y + r, x - r * 0.7, y + r]).fill(body).stroke({ width: 60, color: c });
        const p = (now / 900) % 1;
        g.circle(x, y - r * 1.4, 200 + p * 900).stroke({ width: 40, color: c, alpha: 0.6 * (1 - p) });
        g.circle(x, y - r * 1.4, 110).fill(light(c, 0.5));
        break;
      }
      default: {
        if (weapon) {
          // Turret: a base, a rotating head pointed at its target, and its firing range.
          const foes = mine ? view.enemyUnits : view.units;
          let target: UnitView | undefined;
          let best = weapon.range * weapon.range;
          for (const u of foes) {
            const d = (u.x - x) ** 2 + (u.y - y) ** 2;
            if (d <= best) { best = d; target = u; }
          }
          const ang = target ? Math.atan2(target.y - y, target.x - x) : -Math.PI / 2 + Math.sin(now / 1500) * 0.6;
          g.circle(x, y, r).fill(body).stroke({ width: 90, color: c });
          g.moveTo(x, y).lineTo(x + Math.cos(ang) * r * 1.25, y + Math.sin(ang) * r * 1.25).stroke({ width: 170, color: light(c, 0.3) });
          g.circle(x, y, r * 0.48).fill(c).stroke({ width: 40, color: OUTLINE, alpha: 0.6 });
          // Range: a dashed ring, so players can see where it's safe.
          const R = weapon.range;
          for (let i = 0; i < 36; i += 2) {
            const a0 = (i / 36) * Math.PI * 2;
            g.moveTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R).arc(x, y, R, a0, a0 + Math.PI / 18);
          }
          g.stroke({ width: 40, color: c, alpha: 0.28 });
        } else {
          g.roundRect(x - r, y - r, 2 * r, 2 * r, 100).fill(body).stroke({ width: 90, color: c });
        }
      }
    }
  }
  if (sel) brackets(g, x, y, (b.type === 'primary_cluster' ? r * 1.1 : r) + 260, now);
  bar(g, x, y - r - 420, Math.max(1400, 2 * r), b.hp, b.maxHp);
  // Construction progress (own buildings only; enemy progress is unknown).
  if (!b.built && mine) bar(g, x, y + r + 300, Math.max(1400, 2 * r), b.buildProgress, BUILDINGS[b.type].buildWork, 0x9fd0ff);
  // Training progress for the unit at the front of the queue (own buildings only).
  const next = b.queue[0];
  if (b.built && next) bar(g, x, y + r + 300, Math.max(1400, 2 * r), b.progress, UNITS[next].work, 0x7fd4ff);
}

/** Fiber links: dark ones dim, lit ones glowing in their operator's color with data packets flowing. */
export function drawLinks(g: Graphics, world: World, view: FactionView, now: number): void {
  const siteById = new Map(view.sites.map((s) => [s.id, s]));
  for (const l of world.links) {
    const a = siteById.get(l.a)!;
    const b = siteById.get(l.b)!;
    const seen = a.visible || b.visible;
    const w = 40 + l.bandwidth / 3;
    if (l.owner === null || !seen) {
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 0.7, color: COLORS.darkFiber, alpha: 0.95 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 22, color: 0x3a4d63, alpha: 0.6 });
      continue;
    }
    const c = factionColor(l.owner);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 3.4, color: c, alpha: 0.08 });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 1.5, color: c, alpha: 0.28 });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 0.55, color: light(c, 0.35), alpha: 0.95 });
    // Packets: evenly spaced, moving at a steady speed, so busier (longer) links show more traffic.
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = Math.max(1, Math.round(len / 2600));
    const shift = ((now / 1000) * 2200) / len;
    for (let i = 0; i < n; i++) {
      const t = (shift + i / n) % 1;
      g.circle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, w * 0.5 + 40).fill({ color: light(c, 0.75), alpha: 0.95 });
    }
  }

}

/** Pull the Plug blackouts: a dark disk with a crackling rim. */
export function drawBlackouts(g: Graphics, world: World, now: number): void {
  for (const b of world.blackouts) {
    if (b.until <= world.tick) continue;
    const r = PULL_THE_PLUG.radius;
    g.circle(b.x, b.y, r).fill({ color: 0x010309, alpha: 0.55 });
    g.circle(b.x, b.y, r * 0.66).stroke({ width: 40, color: 0x9fd0ff, alpha: 0.08 });
    g.circle(b.x, b.y, r * 0.33).stroke({ width: 40, color: 0x9fd0ff, alpha: 0.06 });
    g.circle(b.x, b.y, r).stroke({ width: 90, color: 0xcfe6ff, alpha: 0.35 + 0.2 * Math.sin(now / 60) });
    const seed = Math.floor(now / 90);
    for (let k = 0; k < 7; k++) {
      const a0 = (((seed * 37 + k * 101) % 360) * Math.PI) / 180;
      const pts: number[] = [];
      for (let j = 0; j <= 4; j++) {
        const a = a0 + j * 0.07;
        const rr = r + (((seed + k * 13 + j * 7) % 5) - 2) * 120;
        pts.push(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr);
      }
      g.poly(pts, false).stroke({ width: 45, color: 0xe8f4ff, alpha: 0.75 });
    }
  }
}

/** Corner brackets: the selection mark for buildings. */
function brackets(g: Graphics, x: number, y: number, h: number, now: number): void {
  const L = Math.max(260, h * 0.35);
  const p = 1 + 0.04 * Math.sin(now / 250);
  const s = h * p;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    g.moveTo(x + sx * s, y + sy * (s - L)).lineTo(x + sx * s, y + sy * s).lineTo(x + sx * (s - L), y + sy * s);
  }
  g.stroke({ width: 160, color: COLORS.selected, alpha: 0.2 });
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    g.moveTo(x + sx * s, y + sy * (s - L)).lineTo(x + sx * s, y + sy * s).lineTo(x + sx * (s - L), y + sy * s);
  }
  g.stroke({ width: 70, color: COLORS.selected });
}

function drawUnit(g: Graphics, u: UnitView, faction: Faction, sel: boolean, now: number): void {
  const c = factionColor(faction);
  const { x, y } = u;
  // Soft glow, then the selection ring under the body.
  g.circle(x, y, u.role === 'worker' ? 480 : 680).fill({ color: c, alpha: 0.1 });
  if (sel) {
    g.circle(x, y, 760).stroke({ width: 220, color: COLORS.selected, alpha: 0.16 });
    g.circle(x, y, 760).stroke({ width: 70, color: COLORS.selected, alpha: 0.95 });
    const a = now / 600;
    for (let i = 0; i < 4; i++) {
      const t = a + (i * Math.PI) / 2;
      g.moveTo(x + Math.cos(t) * 860, y + Math.sin(t) * 860).lineTo(x + Math.cos(t) * 1000, y + Math.sin(t) * 1000);
    }
    g.stroke({ width: 70, color: COLORS.selected });
  }
  unitShape(g, u.type, u.role, x, y, c, now);
  // Health: always on selected units, and on any damaged unit (either side).
  if (sel || u.hp < u.maxHp) bar(g, x, y - 1000, 1000, u.hp, u.maxHp);
}

/** Role shape (shared silhouette) with faction details, an outline and a highlight. */
function unitShape(g: Graphics, type: UnitTypeId, role: Role, x: number, y: number, c: number, now: number): void {
  const hi = light(c, 0.5);
  const outline = { width: 70, color: OUTLINE, alpha: 0.9 };
  switch (type) {
    case 'field_engineer':
      g.circle(x, y, 310).fill(c).stroke(outline);
      g.circle(x, y, 140).fill(hi);
      break;
    case 'maintenance_drone': {
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.circle(x + dx! * 260, y + dy! * 260, 120).stroke({ width: 45, color: c, alpha: 0.85 });
      g.circle(x, y, 230).fill(c).stroke(outline);
      g.circle(x, y, 90).fill(hi);
      break;
    }
    case 'counter_drone_team':
      g.poly([x, y - 520, x + 450, y + 320, x - 450, y + 320]).fill(c).stroke(outline);
      g.poly([x, y - 230, x + 200, y + 150, x - 200, y + 150]).fill(hi);
      break;
    case 'botnet_swarm': {
      // Three small drones that jitter as one swarm.
      const j = (k: number) => Math.sin(now / 140 + k * 2.1 + x / 700) * 50;
      for (const [dx, dy, k] of [[0, -230, 0], [-260, 200, 1], [260, 200, 2]] as const) {
        const px = x + dx + j(k);
        const py = y + dy + j(k + 1);
        g.poly([px, py - 260, px + 230, py + 170, px - 230, py + 170]).fill(c).stroke({ width: 50, color: OUTLINE, alpha: 0.9 });
      }
      g.circle(x, y + 40, 70).fill(hi);
      break;
    }
    case 'red_team':
      g.poly([x, y - 520, x + 400, y, x, y + 520, x - 400, y]).fill(c).stroke(outline);
      g.poly([x, y - 240, x + 180, y, x, y + 240, x - 180, y]).fill(hi);
      break;
    case 'hunter_drone': {
      for (const [dx, dy] of [[-1, 0], [1, 0]]) g.circle(x + dx! * 430, y + dy! * 0, 150).stroke({ width: 45, color: c, alpha: 0.85 });
      g.poly([x, y - 500, x + 360, y, x, y + 500, x - 360, y]).fill(c).stroke(outline);
      g.circle(x, y, 120).fill(0xffffff);
      break;
    }
    case 'armored_vehicle':
      g.roundRect(x - 450, y - 400, 900, 800, 140).fill(c).stroke(outline);
      g.moveTo(x, y).lineTo(x, y - 600).stroke({ width: 130, color: dark(c, 0.4) });
      g.circle(x, y, 230).fill(hi).stroke({ width: 40, color: dark(c, 0.4) });
      break;
    case 'industrial_robot':
      g.regularPoly(x, y, 500, 8, Math.PI / 8).fill(c).stroke(outline);
      g.moveTo(x + 200, y - 120).lineTo(x + 560, y - 420).lineTo(x + 700, y - 260).stroke({ width: 100, color: dark(c, 0.35) });
      g.rect(x - 200, y - 120, 400, 160).fill(hi);
      break;
    default:
      // A unit type without its own art falls back to the plain role shape.
      if (role === 'worker') g.circle(x, y, 300).fill(c);
      else g.circle(x, y, 480).fill(c);
      g.circle(x, y, role === 'worker' ? 300 : 480).stroke(outline);
  }
}

/** A rounded health or progress bar, centered at x, top at y. */
function bar(g: Graphics, x: number, y: number, w: number, value: number, max: number, color?: number): void {
  const f = Math.max(0, Math.min(1, value / max));
  const c = color ?? (f > 0.6 ? COLORS.hpGood : f > 0.3 ? 0xffcf5a : COLORS.hpBad);
  g.roundRect(x - w / 2 - 40, y - 40, w + 80, 250, 120).fill({ color: OUTLINE, alpha: 0.85 }).stroke({ width: 25, color: 0xffffff, alpha: 0.12 });
  if (f > 0) {
    g.roundRect(x - w / 2, y, w * f, 170, 85).fill(c);
    g.roundRect(x - w / 2, y, w * f, 60, 30).fill({ color: 0xffffff, alpha: 0.25 });
  }
}
