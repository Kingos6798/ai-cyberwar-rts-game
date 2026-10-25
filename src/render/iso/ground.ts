// Flat things on the ground plane, drawn in world units into a container whose transform is the iso
// matrix: the map itself, fiber links, site footprints, fog, worker job marks, rings.
import type { Graphics } from 'pixi.js';
import { BUILDINGS, TILE, type Faction, type FactionView, type World } from '../../sim/index.ts';
import { COLORS, drawGround as drawSharedGround, drawLinks, drawSite } from '../draw.ts';
import { drawSourceIssues } from '../jobs.ts';
import { project } from './camera.ts';
import { shade } from './shapes.ts';

export const factionColor = (f: Faction | null | 'unknown'): number =>
  f === 'human' ? COLORS.human : f === 'ai' ? COLORS.ai : f === 'unknown' ? COLORS.unseen : COLORS.neutral;

/** The map slab: ground with a faint tile grid (iso layer). Static, drawn once. */
export function drawGroundStatic(g: Graphics, mapWidth: number, mapHeight: number): void {
  drawSharedGround(g, mapWidth, mapHeight, false);
}

/** The two front edges of the slab, extruded down (object layer, projected units). Static. */
export function drawSlabSides(g: Graphics, mapWidth: number, mapHeight: number): void {
  const W = mapWidth * TILE;
  const H = mapHeight * TILE;
  const depth = 900;
  const [rx, ry] = project(W, 0);
  const [fx, fy] = project(W, H);
  const [lx, ly] = project(0, H);
  g.poly([rx, ry, fx, fy, fx, fy + depth, rx, ry + depth]).fill(shade(COLORS.ground, 0.75));
  g.poly([fx, fy, lx, ly, lx, ly + depth, fx, fy + depth]).fill(shade(COLORS.ground, 0.55));
}

/** Everything flat that changes: links, sites, fog, rings, job marks (iso layer). */
export function drawGround(g: Graphics, world: World, view: FactionView, selected: Set<number>, seen: Uint8Array, now: number): void {
  g.clear();
  drawLinks(g, world, view, now);
  for (const s of view.sites) if (s.kind !== 'core') drawSite(g, s, now);
  drawSourceIssues(g, view, now);
  drawJobsGround(g, view, factionColor(view.faction), now);
  drawFogRuns(g, view, seen);

  // Rings sit on top of fog so your own selection and turret ranges stay readable.
  for (const b of [...view.buildings, ...view.enemyBuildings]) {
    const weapon = BUILDINGS[b.type].weapon;
    const mine = view.buildings.includes(b);
    const c = factionColor(mine ? view.faction : view.faction === 'human' ? 'ai' : 'human');
    if (weapon && b.built) g.circle(b.x, b.y, weapon.range).stroke({ width: 40, color: c, alpha: 0.28 });
    if (selected.has(b.id)) {
      const r = BUILDINGS[b.type].radius + 250;
      g.rect(b.x - r, b.y - r, 2 * r, 2 * r).stroke({ width: 220, color: COLORS.selected, alpha: 0.2 }).stroke({ width: 80, color: COLORS.selected });
    }
  }
  for (const u of view.units) {
    if (!selected.has(u.id)) continue;
    g.circle(u.x, u.y, 700).stroke({ width: 240, color: COLORS.selected, alpha: 0.16 });
    g.circle(u.x, u.y, 700).stroke({ width: 90, color: COLORS.selected });
  }
}

function drawFogRuns(g: Graphics, view: FactionView, seen: Uint8Array): void {
  for (let ty = 0; ty < view.mapHeight; ty++) {
    let start = -1;
    for (let tx = 0; tx <= view.mapWidth; tx++) {
      const fogged = tx < view.mapWidth && !seen[ty * view.mapWidth + tx];
      if (fogged && start < 0) start = tx;
      if (!fogged && start >= 0) {
        g.rect(start * TILE, ty * TILE, (tx - start) * TILE, TILE).fill({ color: 0x02050b, alpha: 0.66 });
        start = -1;
      }
    }
  }
}

/** The ground half of jobs.ts drawJobs: walking lines, claim progress rings, fiber being lit. */
function drawJobsGround(g: Graphics, view: FactionView, color: number, now: number): void {
  for (const u of view.units) {
    const job = u.job;
    if (u.role !== 'worker' || !job) continue;
    if (!job.working) {
      g.moveTo(u.x, u.y).lineTo(job.x, job.y).stroke({ width: 50, color, alpha: 0.35 });
      continue;
    }
    const f = Math.max(0, Math.min(1, job.progress / 100));
    if (job.kind === 'claim') {
      const r = 1000;
      g.circle(job.x, job.y, r).stroke({ width: 200, color: 0x0b0e12, alpha: 0.8 });
      if (job.contested) g.circle(job.x, job.y, r).stroke({ width: 200, color: 0xff7a59, alpha: 0.5 + 0.4 * Math.sin(now / 150) });
      else if (f > 0) {
        const start = -Math.PI / 2;
        g.moveTo(job.x, job.y - r).arc(job.x, job.y, r, start, start + f * 2 * Math.PI).stroke({ width: 200, color });
      }
    } else if (job.kind === 'link' && job.toX !== undefined && job.toY !== undefined) {
      const x = job.x + (job.toX - job.x) * f;
      const y = job.y + (job.toY - job.y) * f;
      g.moveTo(job.x, job.y).lineTo(x, y).stroke({ width: 140, color, alpha: 0.9 });
      g.circle(x, y, 140).fill({ color: 0xffffff, alpha: 0.6 + 0.3 * Math.sin(now / 120) });
    }
  }
}
