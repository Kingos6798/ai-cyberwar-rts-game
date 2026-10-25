// Upright 2.5D primitives for the object layer, drawn in projected units (see camera.ts): boxes with a
// lit top and two shaded sides, shadows, and HP bars. Light comes from the top left, so the
// right-facing (+x) side is mid shade and the left-facing (+y) side is darkest.
import type { Graphics } from 'pixi.js';
import { project } from './camera.ts';

export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/**
 * Box standing on the ground at world (x, y), half-sizes hx/hy in world units, raised `base` and
 * `h` tall (projected units). Draws only the three faces the camera sees.
 */
export function isoBox(g: Graphics, x: number, y: number, hx: number, hy: number, h: number, color: number, alpha = 1, base = 0): void {
  const [ax, ay] = project(x + hx, y - hy); // right corner
  const [bx, by] = project(x + hx, y + hy); // front (bottom) corner
  const [cx, cy] = project(x - hx, y + hy); // left corner
  const [dx, dy] = project(x - hx, y - hy); // back (top) corner
  const lo = base;
  const hi = base + h;
  // +x face (screen right side).
  g.poly([ax, ay - lo, bx, by - lo, bx, by - hi, ax, ay - hi]).fill({ color: shade(color, 0.62), alpha });
  // +y face (screen left side).
  g.poly([bx, by - lo, cx, cy - lo, cx, cy - hi, bx, by - hi]).fill({ color: shade(color, 0.42), alpha });
  // Top.
  g.poly([ax, ay - hi, bx, by - hi, cx, cy - hi, dx, dy - hi]).fill({ color, alpha });
}

/** Soft ground shadow under an object at world (x, y). */
export function shadow(g: Graphics, x: number, y: number, r: number): void {
  const [px, py] = project(x, y);
  g.ellipse(px, py, r, r / 2).fill({ color: 0x000000, alpha: 0.35 });
}

/** Upright bar centered at projected (px, py); hp/max fills it. */
export function bar(g: Graphics, px: number, py: number, w: number, hp: number, max: number, color?: number): void {
  const f = Math.max(0, Math.min(1, hp / max));
  g.roundRect(px - w / 2 - 35, py - 35, w + 70, 210, 105).fill({ color: 0x04070c, alpha: 0.85 }).stroke({ width: 22, color: 0xffffff, alpha: 0.12 });
  if (f > 0) g.roundRect(px - w / 2, py, w * f, 140, 70).fill(color ?? (f > 0.6 ? 0x5bd88a : f > 0.3 ? 0xffcf5a : 0xff6259));
}
