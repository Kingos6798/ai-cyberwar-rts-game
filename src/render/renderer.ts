// What main.ts needs from a renderer, so the view can be swapped without touching the game (D-017, M4.0
// renderer spike, issue #7). Pick one with ?renderer=pixi|three|iso; pixi (top-down 2D) is the default.
// A renderer only reads the frame (FactionView, fog applied) and maps screen pixels to the ground.
import type { FactionView, World } from '../sim/index.ts';
import type { Effects } from './effects.ts';

export interface Frame {
  world: World;
  view: FactionView;
  selected: Set<number>;
  fx: Effects;
  /** performance.now() */
  now: number;
}

export interface ScreenBox { x0: number; y0: number; x1: number; y1: number }

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  /** World point on the ground under a canvas pixel (CSS pixels, like offsetX/offsetY). */
  toWorld(sx: number, sy: number): [number, number];
  /** Canvas pixel where a ground point appears. */
  toScreen(x: number, y: number): [number, number];
  /** Move the view by a drag of (dx, dy) canvas pixels. */
  pan(dx: number, dy: number): void;
  /** Zoom by `factor` (>1 = closer), keeping the ground under (sx, sy) in place. */
  zoomAt(sx: number, sy: number, factor: number): void;
  /** Frame the whole map in the screen area right of the guide panel and above the command card. */
  fit(): void;
  /** Screen-space selection box while dragging, or null. */
  setBox(box: ScreenBox | null): void;
  render(frame: Frame): void;
}

export type RendererKind = 'pixi' | 'three' | 'iso';

export function rendererKind(param: string | null): RendererKind {
  return param === 'three' || param === 'iso' ? param : 'pixi';
}

/**
 * Screen area the map should fill: right of the 320 px guide panel, above the 110 px command card. Phones
 * (mobile port: under 900 px wide) overlay the smaller panels on the map instead.
 */
export function viewport(width: number, height: number): { left: number; top: number; width: number; height: number } {
  const phone = width < 900;
  const left = phone ? 0 : 320;
  const bottom = phone ? 64 : 110;
  return { left, top: 0, width: width - left, height: height - bottom };
}

export async function createRenderer(kind: RendererKind, mapWidth: number, mapHeight: number): Promise<Renderer> {
  // Dynamic imports keep Three.js out of the bundle for players who use the default renderer.
  if (kind === 'three') return (await import('./three/renderer.ts')).createThreeRenderer(mapWidth, mapHeight);
  if (kind === 'iso') return (await import('./iso/renderer.ts')).createIsoRenderer(mapWidth, mapHeight);
  return (await import('./pixi.ts')).createPixiRenderer(mapWidth, mapHeight);
}
