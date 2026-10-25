// Ground marks drawn over the objects (iso layer, world units): blackouts, death bursts, map pings.
import type { Graphics } from 'pixi.js';
import type { World } from '../../sim/index.ts';
import { drawBlackouts } from '../draw.ts';
import { drawBursts, type Effects } from '../effects.ts';

export function drawOverlay(g: Graphics, world: World, fx: Effects, now: number): void {
  g.clear();
  drawBlackouts(g, world, now);
  drawBursts(g, fx, now);
}
