// Control groups (#3): Ctrl+1–9 saves the selection as a group, 1–9 recalls it, and a double tap
// centers the camera on it. Selection is UI state, not a command, so this adds no hidden powers.
import type { FactionView } from '../sim/index.ts';

/** Max ms between two taps of the same number for it to count as a double tap. */
export const DOUBLE_TAP_MS = 350;

export interface Groups {
  groups: Map<number, number[]>;
  /** The last number tapped and when, for double-tap detection. */
  last: { n: number; at: number } | null;
}

export function createGroups(): Groups {
  return { groups: new Map(), last: null };
}

/** Saves `ids` as group `n`, replacing it; an empty selection clears the group. */
export function saveGroup(g: Groups, n: number, ids: number[]): void {
  if (ids.length === 0) g.groups.delete(n);
  else g.groups.set(n, [...ids]);
}

/** The living members of group `n`; dead units are dropped from the group for good. */
export function recallGroup(g: Groups, n: number, alive: Set<number>): number[] {
  const ids = (g.groups.get(n) ?? []).filter((id) => alive.has(id));
  saveGroup(g, n, ids);
  return ids;
}

/** Records a tap of number `n` at `now` (ms); true when it completes a double tap. */
export function tapGroup(g: Groups, n: number, now: number): boolean {
  const double = g.last !== null && g.last.n === n && now - g.last.at <= DOUBLE_TAP_MS;
  g.last = double ? null : { n, at: now };
  return double;
}

/** Ids of everything of ours still standing: group members are checked against this. */
export function ownIds(view: FactionView): Set<number> {
  return new Set([...view.units, ...view.buildings].map((e) => e.id));
}

/** Average ground position of the group's units and buildings, or null if none are left. */
export function groupCenter(view: FactionView, ids: number[]): [number, number] | null {
  const own = [...view.units, ...view.buildings].filter((e) => ids.includes(e.id));
  if (own.length === 0) return null;
  const x = own.reduce((s, e) => s + e.x, 0);
  const y = own.reduce((s, e) => s + e.y, 0);
  return [Math.round(x / own.length), Math.round(y / own.length)];
}

/** Lowest group number not in use, or null when 1–9 are all taken. */
export function freeGroup(g: Groups): number | null {
  for (let n = 1; n <= 9; n++) if (!g.groups.has(n)) return n;
  return null;
}
