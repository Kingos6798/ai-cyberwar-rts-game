// Minimap (issue #2): the whole map in a corner, drawn only from FactionView so fog applies (no hidden
// enemy info). Shows sites by owner as you know them, your units and buildings, visible enemies, and the
// camera's footprint. Left-click or drag centers the camera there; right-click orders the selection there.
// Plain 2D canvas, separate from the game renderer, so it works with every renderer kind.
import { TILE, type Faction, type FactionView } from '../sim/index.ts';
import { COLORS } from './draw.ts';
import { visibleTiles } from './fog.ts';

export interface MinimapLayout {
  /** Minimap pixels per world unit. */
  scale: number;
  width: number;
  height: number;
}

/** Largest minimap that fits in maxW × maxH CSS pixels and keeps the map's aspect ratio. */
export function minimapLayout(mapWidth: number, mapHeight: number, maxW: number, maxH: number): MinimapLayout {
  const scale = Math.min(maxW / (mapWidth * TILE), maxH / (mapHeight * TILE));
  return { scale, width: Math.round(mapWidth * TILE * scale), height: Math.round(mapHeight * TILE * scale) };
}

export function worldToMinimap(layout: MinimapLayout, x: number, y: number): [number, number] {
  return [x * layout.scale, y * layout.scale];
}

/** World point under a minimap pixel, clamped to the map (integers, like the rest of the game's coordinates). */
export function minimapToWorld(layout: MinimapLayout, mx: number, my: number): [number, number] {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v / layout.scale)));
  return [clamp(mx, layout.width / layout.scale), clamp(my, layout.height / layout.scale)];
}

export interface MinimapMark { x: number; y: number; faction: Faction; kind: 'unit' | 'building' }

/** Units and buildings the minimap draws: yours, plus only the enemies your view can see. */
export function minimapMarks(view: FactionView): MinimapMark[] {
  const enemy: Faction = view.faction === 'human' ? 'ai' : 'human';
  const mark = (faction: Faction, kind: MinimapMark['kind']) => (e: { x: number; y: number }): MinimapMark => ({ x: e.x, y: e.y, faction, kind });
  return [
    ...view.buildings.map(mark(view.faction, 'building')),
    ...view.enemyBuildings.map(mark(enemy, 'building')),
    ...view.units.map(mark(view.faction, 'unit')),
    ...view.enemyUnits.map(mark(enemy, 'unit')),
  ];
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const ownerColor = (f: Faction | null | 'unknown') =>
  css(f === 'human' ? COLORS.human : f === 'ai' ? COLORS.ai : f === 'unknown' ? COLORS.unseen : COLORS.neutral);

/** What the minimap needs from the game's camera. */
export interface MinimapCamera {
  /** Ground point under a canvas pixel. */
  toWorld(sx: number, sy: number): [number, number];
  /** Screen corners of the map viewport, in canvas pixels. */
  corners(): [number, number][];
}

export interface Minimap {
  /** Redraw: contents at most every `refreshMs`, the camera footprint every frame. */
  update(view: FactionView, camera: MinimapCamera, now: number): void;
}

export interface MinimapOptions {
  maxWidth?: number;
  maxHeight?: number;
  refreshMs?: number;
  /** Left-click / drag: center the camera on this world point. */
  onCenter(x: number, y: number): void;
  /** Right-click: act on this world point (same as right-clicking the ground there). */
  onAction(x: number, y: number): void;
}

export function createMinimap(root: HTMLElement, mapWidth: number, mapHeight: number, opts: MinimapOptions): Minimap {
  const layout = minimapLayout(mapWidth, mapHeight, opts.maxWidth ?? 240, opts.maxHeight ?? 180);
  const dpr = window.devicePixelRatio || 1;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(layout.width * dpr);
    c.height = Math.round(layout.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr * layout.scale, 0, 0, dpr * layout.scale, 0, 0);
    return { c, ctx };
  };
  const shown = make();
  const cache = make(); // map contents, redrawn at most every refreshMs
  shown.c.id = 'hud-minimap';
  shown.c.className = 'hud-panel';
  shown.c.style.width = `${layout.width}px`;
  shown.c.style.height = `${layout.height}px`;
  shown.c.title = 'Minimap: click or drag to move the camera, right-click to send your selection';
  // Before the shortcuts panel, so that panel covers the minimap when it is opened.
  root.insertBefore(shown.c, root.querySelector('#hud-help'));

  const at = (e: PointerEvent) => minimapToWorld(layout, e.offsetX, e.offsetY);
  let dragging = false;
  shown.c.addEventListener('contextmenu', (e) => e.preventDefault());
  shown.c.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (e.button === 2) { opts.onAction(...at(e)); return; }
    if (e.button !== 0) return;
    dragging = true;
    shown.c.setPointerCapture(e.pointerId);
    opts.onCenter(...at(e));
  });
  shown.c.addEventListener('pointermove', (e) => { if (dragging) opts.onCenter(...at(e)); });
  shown.c.addEventListener('pointerup', () => { dragging = false; });

  let lastDraw = -Infinity;
  const W = mapWidth * TILE;
  const H = mapHeight * TILE;
  const dot = layout.scale > 0 ? 2.5 / layout.scale : 0; // world units for a ~2.5 px dot

  function drawContents(view: FactionView): void {
    const g = cache.ctx;
    g.fillStyle = css(COLORS.ground);
    g.fillRect(0, 0, W, H);
    // Sites, as you last knew them.
    for (const s of view.sites) {
      if (s.kind === 'core') continue;
      g.fillStyle = ownerColor(s.owner);
      g.fillRect(s.x - 600, s.y - 600, 1200, 1200);
    }
    // Fog: tiles out of sight right now are shaded, like on the main view.
    const seen = visibleTiles(view);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    for (let ty = 0; ty < view.mapHeight; ty++) {
      for (let tx = 0; tx < view.mapWidth; tx++) if (!seen[ty * view.mapWidth + tx]) g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
    for (const m of minimapMarks(view)) {
      const r = m.kind === 'building' ? dot * 1.4 : dot / 2;
      g.fillStyle = ownerColor(m.faction);
      g.fillRect(m.x - r, m.y - r, 2 * r, 2 * r);
    }
  }

  return {
    update(view, camera, now) {
      if (now - lastDraw >= (opts.refreshMs ?? 100)) {
        drawContents(view);
        lastDraw = now;
      }
      const g = shown.ctx;
      g.drawImage(cache.c, 0, 0, W, H);
      // Camera footprint: where the viewport's corners land on the ground (a trapezoid on tilted views).
      g.beginPath();
      camera.corners().forEach(([sx, sy], i) => {
        const [x, y] = camera.toWorld(sx, sy);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.closePath();
      g.lineWidth = 1.5 / layout.scale;
      g.strokeStyle = '#ffffff';
      g.stroke();
    },
  };
}
