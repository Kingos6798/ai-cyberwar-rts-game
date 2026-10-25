import { describe, expect, it } from 'vitest';
import { buildCard } from '../src/render/card.ts';
import { createGroups, freeGroup, groupCenter, recallGroup, saveGroup, tapGroup } from '../src/render/groups.ts';
import { key, type UiState } from '../src/render/input.ts';
import { factionView, spawnBuilding, spawnUnit } from '../src/sim/index.ts';
import { newGame } from './helpers.ts';

// Control groups (#3): Ctrl+1–9 saves the selection, 1–9 recalls it, a double tap centers the camera.
describe('control groups', () => {
  it('saves a selection and recalls it', () => {
    const g = createGroups();
    saveGroup(g, 1, [4, 7]);
    expect(recallGroup(g, 1, new Set([4, 7, 9]))).toEqual([4, 7]);
    expect(recallGroup(g, 2, new Set([4]))).toEqual([]);
  });

  it('saving again replaces the group, and saving nothing clears it', () => {
    const g = createGroups();
    saveGroup(g, 3, [1, 2]);
    saveGroup(g, 3, [5]);
    expect(recallGroup(g, 3, new Set([1, 2, 5]))).toEqual([5]);
    saveGroup(g, 3, []);
    expect(g.groups.has(3)).toBe(false);
  });

  it('dead units drop out of groups', () => {
    const g = createGroups();
    saveGroup(g, 1, [4, 7, 8]);
    expect(recallGroup(g, 1, new Set([7]))).toEqual([7]);
    expect(g.groups.get(1)).toEqual([7]);
    expect(recallGroup(g, 1, new Set())).toEqual([]);
    expect(g.groups.has(1)).toBe(false);
  });

  it('a second tap of the same number within 350 ms is a double tap', () => {
    const g = createGroups();
    expect(tapGroup(g, 1, 1000)).toBe(false);
    expect(tapGroup(g, 1, 1200)).toBe(true);
    expect(tapGroup(g, 1, 1300)).toBe(false); // a triple tap does not re-center twice
    expect(tapGroup(g, 2, 1400)).toBe(false);
    expect(tapGroup(g, 1, 1500)).toBe(false); // a different number in between resets it
    expect(tapGroup(g, 1, 2000)).toBe(false); // too slow
  });

  it('centers on the average position of the group', () => {
    const game = newGame();
    const a = spawnUnit(game.world, 'red_team', 'human', 1000, 2000);
    const b = spawnUnit(game.world, 'red_team', 'human', 3000, 4000);
    expect(groupCenter(factionView(game.world, 'human'), [a.id, b.id])).toEqual([2000, 3000]);
    expect(groupCenter(factionView(game.world, 'human'), [])).toBeNull();
  });
});

describe('number keys no longer train (they are control groups)', () => {
  const game = newGame();
  spawnBuilding(game.world, 'soc', 'human', 9000, 16000).built = true;
  const view = factionView(game.world, 'human');
  const ui: UiState = { selected: new Set(), mode: { type: 'none' } };
  it('1/2/3 issue no command; SOC training moved to U/I/O', () => {
    for (const k of ['1', '2', '3']) expect(key(view, ui, game.world.map, k, [0, 0])).toEqual([]);
    expect(key(view, ui, game.world.map, 'u', [0, 0])).toMatchObject([{ type: 'train', unit: 'counter_drone_team' }]);
    const card = buildCard(view, ui, { setMode: () => {}, select: () => {} });
    expect(card.filter((b) => b.id.startsWith('train:') && b.id !== 'train:field_engineer').map((b) => b.key)).toEqual(['U', 'I', 'O']);
  });
});

describe('control group buttons (every action is clickable)', () => {
  it('"Save as group" takes the lowest free number, and each saved group gets a select button', () => {
    const game = newGame();
    const a = spawnUnit(game.world, 'red_team', 'human', 9000, 16000);
    const view = factionView(game.world, 'human');
    const ui: UiState = { selected: new Set([a.id]), mode: { type: 'none' } };
    const g = createGroups();
    saveGroup(g, 1, [view.units[0]!.id]);
    expect(freeGroup(g)).toBe(2);
    let selected: number[] = [];
    const card = () => buildCard(view, ui, { setMode: () => {}, select: (ids) => { selected = ids; } }, g);
    const save = card().find((b) => b.id === 'group:save')!;
    expect(save).toMatchObject({ label: 'Save as group 2', key: 'Ctrl+2' });
    save.run();
    expect(g.groups.get(2)).toEqual([a.id]);
    const recall = card().find((b) => b.id === 'group:2')!;
    expect(recall).toMatchObject({ label: 'Group 2 (1)', key: '2' });
    recall.run();
    expect(selected).toEqual([a.id]);
  });
});
