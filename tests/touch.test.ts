import { describe, expect, it } from 'vitest';
import { createGestures, TOUCH } from '../src/render/touch.ts';

// Mobile port: raw touch pointers become taps, long presses, pans, pinches and box drags.
describe('touch gestures', () => {
  const g = (box = false) => createGestures({ boxMode: () => box });

  it('a quick still touch is a tap; a second one nearby soon after is a double tap', () => {
    const t = g();
    t.down(1, 100, 100, 0);
    expect(t.up(1, 103, 101, 120)).toEqual([{ type: 'tap', x: 103, y: 101 }]);
    t.down(2, 110, 105, 200);
    expect(t.up(2, 110, 105, 260)).toEqual([{ type: 'doubleTap', x: 110, y: 105 }]);
    // A third tap starts over.
    t.down(3, 110, 105, 300);
    expect(t.up(3, 110, 105, 350)).toEqual([{ type: 'tap', x: 110, y: 105 }]);
  });

  it('a slow second tap, or one far away, is just another tap', () => {
    const t = g();
    t.down(1, 100, 100, 0); t.up(1, 100, 100, 50);
    t.down(2, 100, 100, 50 + TOUCH.doubleTapMs + 1);
    expect(t.up(2, 100, 100, 450)).toEqual([{ type: 'tap', x: 100, y: 100 }]);
    t.down(3, 300, 300, 500);
    expect(t.up(3, 300, 300, 520)).toEqual([{ type: 'tap', x: 300, y: 300 }]);
  });

  it('holding still is a long press, and lifting after it is not a tap', () => {
    const t = g();
    t.down(1, 50, 60, 0);
    expect(t.tick(TOUCH.longPressMs - 1)).toEqual([]);
    expect(t.tick(TOUCH.longPressMs)).toEqual([{ type: 'longPress', x: 50, y: 60 }]);
    expect(t.tick(TOUCH.longPressMs + 100)).toEqual([]);
    expect(t.up(1, 50, 60, 900)).toEqual([]);
  });

  it('one finger dragging pans the map by how far it moved', () => {
    const t = g();
    t.down(1, 100, 100, 0);
    expect(t.move(1, 105, 100, 10)).toEqual([]); // still within tap slop
    expect(t.move(1, 130, 90, 20)).toEqual([{ type: 'pan', dx: 30, dy: -10 }]);
    expect(t.move(1, 140, 95, 30)).toEqual([{ type: 'pan', dx: 10, dy: 5 }]);
    expect(t.up(1, 140, 95, 40)).toEqual([]);
    expect(t.tick(5000)).toEqual([]);
  });

  it('in box mode, one finger dragging draws a selection box', () => {
    const t = g(true);
    t.down(1, 10, 20, 0);
    expect(t.move(1, 60, 80, 10)).toEqual([{ type: 'boxStart', x0: 10, y0: 20 }, { type: 'box', x0: 10, y0: 20, x1: 60, y1: 80 }]);
    expect(t.move(1, 70, 90, 20)).toEqual([{ type: 'box', x0: 10, y0: 20, x1: 70, y1: 90 }]);
    expect(t.up(1, 75, 95, 30)).toEqual([{ type: 'boxEnd', x0: 10, y0: 20, x1: 75, y1: 95 }]);
  });

  it('two fingers pinch to zoom around their midpoint and pan together', () => {
    const t = g(true);
    t.down(1, 100, 100, 0);
    expect(t.down(2, 200, 100, 10)).toEqual([]);
    const out = t.move(2, 300, 100, 20); // spread from 100 to 200 px apart
    expect(out).toEqual([{ type: 'pan', dx: 50, dy: 0 }, { type: 'pinch', x: 200, y: 100, factor: 2 }]);
    // Lifting one finger ends the gesture: the other one no longer taps or pans.
    expect(t.up(2, 300, 100, 30)).toEqual([]);
    expect(t.move(1, 150, 150, 40)).toEqual([]);
    expect(t.up(1, 150, 150, 50)).toEqual([]);
    // Fresh touches work again.
    t.down(3, 10, 10, 60);
    expect(t.up(3, 10, 10, 80)).toEqual([{ type: 'tap', x: 10, y: 10 }]);
  });

  it('a second finger landing mid box-drag cancels the box', () => {
    const t = g(true);
    t.down(1, 0, 0, 0);
    t.move(1, 50, 50, 10);
    expect(t.down(2, 100, 100, 20)).toEqual([{ type: 'boxCancel' }]);
  });

  it('a cancelled touch (e.g. a system gesture) leaves nothing behind', () => {
    const t = g();
    t.down(1, 0, 0, 0);
    t.cancel(1);
    expect(t.tick(5000)).toEqual([]);
  });
});
