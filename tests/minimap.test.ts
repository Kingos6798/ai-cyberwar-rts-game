import { describe, expect, it } from 'vitest';
import { minimapLayout, minimapMarks, minimapToWorld, worldToMinimap } from '../src/render/minimap.ts';
import { factionView, spawnUnit, TILE } from '../src/sim/index.ts';
import { newGame } from './helpers.ts';

describe('minimap', () => {
  it('fits the map in the box and keeps its aspect ratio', () => {
    const wide = minimapLayout(48, 32, 240, 180);
    expect([wide.width, wide.height]).toEqual([240, 160]);
    const tall = minimapLayout(32, 48, 240, 180);
    expect([tall.width, tall.height]).toEqual([120, 180]);
  });

  it('maps world points to minimap pixels and back', () => {
    const layout = minimapLayout(48, 32, 240, 180);
    expect(worldToMinimap(layout, 0, 0)).toEqual([0, 0]);
    expect(worldToMinimap(layout, 48 * TILE, 32 * TILE)).toEqual([240, 160]);
    expect(worldToMinimap(layout, 24 * TILE, 16 * TILE)).toEqual([120, 80]);
    expect(minimapToWorld(layout, 120, 80)).toEqual([24 * TILE, 16 * TILE]);
  });

  it('clamps clicks outside the map to its edge', () => {
    const layout = minimapLayout(48, 32, 240, 180);
    expect(minimapToWorld(layout, -10, 500)).toEqual([0, 32 * TILE]);
  });

  it('shows enemies only when the view can see them', () => {
    const game = newGame();
    const hidden = spawnUnit(game.world, 'botnet_swarm', 'ai', 30 * TILE, 4 * TILE);
    const at = (v: ReturnType<typeof factionView>) => minimapMarks(v).filter((m) => m.x === hidden.x && m.y === hidden.y && m.faction === 'ai');
    expect(at(factionView(game.world, 'human'))).toHaveLength(0);
    spawnUnit(game.world, 'counter_drone_team', 'human', 30 * TILE, 5 * TILE);
    expect(at(factionView(game.world, 'human'))).toHaveLength(1);
  });

  it('shows your own units and buildings', () => {
    const game = newGame();
    const v = factionView(game.world, 'human');
    const mine = minimapMarks(v).filter((m) => m.faction === 'human');
    expect(mine.filter((m) => m.kind === 'unit')).toHaveLength(v.units.length);
    expect(mine.filter((m) => m.kind === 'building')).toHaveLength(v.buildings.length);
  });
});
