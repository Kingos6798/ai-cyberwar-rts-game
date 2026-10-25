// Fog of war, drawn: tiles none of your units or buildings can see right now are shaded. Enemy units
// there are hidden, and sites show what you last knew. Uses the same sight rules as the sim's view.
import type { Graphics } from 'pixi.js';
import { BUILDINGS, TILE, UNITS, within, type FactionView } from '../sim/index.ts';

/** One flag per tile (row-major): 1 if the tile center is in sight of any of your units or finished buildings. */
export function visibleTiles(view: FactionView): Uint8Array {
  const eyes = [
    ...view.units.map((u) => ({ x: u.x, y: u.y, r: UNITS[u.type].sight })),
    ...view.buildings.filter((b) => b.built).map((b) => ({ x: b.x, y: b.y, r: BUILDINGS[b.type].sight })),
  ];
  const out = new Uint8Array(view.mapWidth * view.mapHeight);
  // Visit only the tiles inside each eye's sight box (much cheaper than every tile against every eye,
  // which mattered with hundreds of units on screen).
  for (const e of eyes) {
    const x0 = Math.max(0, Math.floor((e.x - e.r) / TILE));
    const x1 = Math.min(view.mapWidth - 1, Math.floor((e.x + e.r) / TILE));
    const y0 = Math.max(0, Math.floor((e.y - e.r) / TILE));
    const y1 = Math.min(view.mapHeight - 1, Math.floor((e.y + e.r) / TILE));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * view.mapWidth + tx;
        if (!out[i] && within(tx * TILE + TILE / 2, ty * TILE + TILE / 2, e.x, e.y, e.r)) out[i] = 1;
      }
    }
  }
  return out;
}

export function drawFog(g: Graphics, view: FactionView): void {
  const seen = visibleTiles(view);
  // One rectangle per run of fogged tiles in a row, instead of one per tile.
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
