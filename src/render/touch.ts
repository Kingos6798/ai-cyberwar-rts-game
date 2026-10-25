// Mobile port: turns raw touch pointers into gestures (tap, double tap, long press, pan, pinch, box
// drag). Pure logic with explicit times, so it is testable without a screen; main.ts feeds it pointer
// events and maps gestures to the same commands the mouse gives (Tenet 2: no touch-only powers).

export const TOUCH = {
  /** Pixels a finger may drift and still count as a tap. */
  tapSlop: 12,
  /** A press held this long without moving is a long press. */
  longPressMs: 550,
  /** Max gap and distance between two taps for a double tap. */
  doubleTapMs: 320,
  doubleTapDist: 40,
};

export type Gesture =
  | { type: 'tap' | 'doubleTap' | 'longPress'; x: number; y: number }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'pinch'; x: number; y: number; factor: number }
  | { type: 'boxStart'; x0: number; y0: number }
  | { type: 'box' | 'boxEnd'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'boxCancel' }
  | { type: 'commandStart'; x0: number; y0: number }
  | { type: 'command' | 'commandEnd'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'commandCancel' };

interface Finger { x: number; y: number; startX: number; startY: number; startT: number }

export interface Gestures {
  down(id: number, x: number, y: number, t: number): Gesture[];
  move(id: number, x: number, y: number, t: number): Gesture[];
  up(id: number, x: number, y: number, t: number): Gesture[];
  cancel(id: number): void;
  /** Call every frame: fires a long press once a still finger has been held long enough. */
  tick(t: number): Gesture[];
}

/**
 * `boxMode`: whether one-finger drags draw a selection box (else they pan). `commandFrom`: whether a drag
 * starting at this point is an order (it starts on a selected unit): the finger then draws an order line.
 */
export function createGestures(opts: { boxMode: () => boolean; commandFrom?: (x: number, y: number) => boolean }): Gestures {
  const fingers = new Map<number, Finger>();
  // pending: one finger down, not moved yet. drag: one finger panning or boxing. multi: two fingers.
  // spent: the gesture already produced its result; ignore until every finger is up.
  let mode: 'idle' | 'pending' | 'drag' | 'multi' | 'spent' = 'idle';
  let boxing = false;
  let commanding = false;
  let lastTap: { x: number; y: number; t: number } | null = null;
  let pair: { cx: number; cy: number; dist: number } | null = null;

  const two = () => {
    const [a, b] = [...fingers.values()];
    return { cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1 };
  };
  const release = () => { if (fingers.size === 0) { mode = 'idle'; boxing = false; commanding = false; pair = null; } };

  return {
    down(id, x, y, t) {
      fingers.set(id, { x, y, startX: x, startY: y, startT: t });
      if (fingers.size === 1 && mode === 'idle') { mode = 'pending'; return []; }
      if (fingers.size === 2 && mode !== 'spent') {
        const out: Gesture[] = boxing ? [{ type: 'boxCancel' }] : commanding ? [{ type: 'commandCancel' }] : [];
        boxing = false;
        commanding = false;
        mode = 'multi';
        pair = two();
        return out;
      }
      return [];
    },
    move(id, x, y) {
      const f = fingers.get(id);
      if (!f) return [];
      const [px, py] = [f.x, f.y];
      f.x = x;
      f.y = y;
      if (mode === 'pending') {
        if (Math.hypot(x - f.startX, y - f.startY) <= TOUCH.tapSlop) return [];
        mode = 'drag';
        if (!opts.boxMode() && opts.commandFrom?.(f.startX, f.startY)) {
          commanding = true;
          return [{ type: 'commandStart', x0: f.startX, y0: f.startY }, { type: 'command', x0: f.startX, y0: f.startY, x1: x, y1: y }];
        }
        if (opts.boxMode()) {
          boxing = true;
          return [{ type: 'boxStart', x0: f.startX, y0: f.startY }, { type: 'box', x0: f.startX, y0: f.startY, x1: x, y1: y }];
        }
        return [{ type: 'pan', dx: x - f.startX, dy: y - f.startY }];
      }
      if (mode === 'drag') {
        if (commanding) return [{ type: 'command', x0: f.startX, y0: f.startY, x1: x, y1: y }];
        return boxing ? [{ type: 'box', x0: f.startX, y0: f.startY, x1: x, y1: y }] : [{ type: 'pan', dx: x - px, dy: y - py }];
      }
      if (mode === 'multi' && pair && fingers.size === 2) {
        const now = two();
        const out: Gesture[] = [{ type: 'pan', dx: now.cx - pair.cx, dy: now.cy - pair.cy }, { type: 'pinch', x: now.cx, y: now.cy, factor: now.dist / pair.dist }];
        pair = now;
        return out;
      }
      return [];
    },
    up(id, x, y, t) {
      const f = fingers.get(id);
      fingers.delete(id);
      if (!f) return [];
      let out: Gesture[] = [];
      if (mode === 'pending') {
        const double = lastTap && t - lastTap.t <= TOUCH.doubleTapMs && Math.hypot(x - lastTap.x, y - lastTap.y) <= TOUCH.doubleTapDist;
        out = [{ type: double ? 'doubleTap' : 'tap', x, y }];
        lastTap = double ? null : { x, y, t };
        mode = 'spent';
      } else if (mode === 'drag' && commanding) {
        out = [{ type: 'commandEnd', x0: f.startX, y0: f.startY, x1: x, y1: y }];
        mode = 'spent';
      } else if (mode === 'drag' && boxing) {
        out = [{ type: 'boxEnd', x0: f.startX, y0: f.startY, x1: x, y1: y }];
        mode = 'spent';
      } else if (mode === 'multi') {
        // One finger of a pinch lifted: the other mustn't turn into a tap or a pan.
        mode = 'spent';
      }
      release();
      return out;
    },
    cancel(id) {
      fingers.delete(id);
      if (fingers.size === 0) { mode = 'idle'; boxing = false; commanding = false; pair = null; } else mode = 'spent';
    },
    tick(t) {
      if (mode !== 'pending' || fingers.size !== 1) return [];
      const f = [...fingers.values()][0]!;
      if (t - f.startT < TOUCH.longPressMs) return [];
      mode = 'spent';
      lastTap = null;
      return [{ type: 'longPress', x: f.x, y: f.y }];
    },
  };
}
