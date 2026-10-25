// Turns mouse and keyboard input into commands. The UI has no powers of its own: everything it does
// goes through the same command API the AI uses (Tenet 2).
import { nextLink } from './card.ts';
import { jobText } from './jobs.ts';
import {
  BUILDINGS, dist2, issueText, sectorOf, within, type BuildingTypeId, type Command, type FactionView, type GameMap,
  type UnitTypeId,
} from '../sim/index.ts';

export type Mode =
  | { type: 'none' }
  | { type: 'attackMove' }
  | { type: 'pullThePlug' }
  | { type: 'place'; building: BuildingTypeId };

export interface UiState {
  selected: Set<number>;
  mode: Mode;
}

// U / I / O sit together like 1 / 2 / 3 used to; the number keys are control groups now (#3).
const SOC_UNITS: Record<string, UnitTypeId> = { u: 'counter_drone_team', i: 'red_team', o: 'armored_vehicle' };
const BUILD_KEYS: Record<string, BuildingTypeId> = { q: 'soc', r: 'server_rack', f: 'barricade', v: 'security_post' };

export const HOTKEYS: [string, string][] = [
  ['Left click / drag', 'select units'],
  ['Double-click a unit', 'select all of that type on screen'],
  ['Right click', 'move / attack / claim site / light link'],
  ['A then click', 'attack-move'],
  ['E', 'train Field Engineer (NOC)'],
  ['U / I / O', 'train Counter-Drone / Red Team / Armored Vehicle (SOC)'],
  ['Ctrl+1–9', 'save the selection as a control group'],
  ['1–9', 'select that control group (press twice to jump the camera to it)'],
  ['Q / R / F / V then click', 'build SOC / Server Rack / Barricade / Security Post (workers)'],
  ['P then click', 'Pull the Plug'],
  ['G / D', 'army attack / defend the sector under the cursor'],
  ['X', 'expand: an idle engineer claims the nearest site'],
  ['C', 'connect fiber: selected engineers light the next useful link'],
  ['S', 'stop'],
  ['Ctrl+A', 'select all combat units'],
  ['T', 'toggle the text view (what an LLM General would read)'],
  ['M', 'music on / off'],
  ['N', 'alert sounds on / off (also the 🔔 button, top bar)'],
  ['Space', 'pause   + / -  game speed'],
  ['Arrows, wheel, middle-drag', 'pan and zoom'],
];

/** Selection by click: the own unit or building under the cursor (`radius`: wider for fingers on touch screens). */
export function pickOwn(view: FactionView, x: number, y: number, radius = 700): number | null {
  let best: number | null = null;
  let bestD = radius ** 2;
  for (const u of view.units) {
    const d = dist2(u.x, u.y, x, y);
    if (d < bestD) { bestD = d; best = u.id; }
  }
  if (best !== null) return best;
  for (const b of view.buildings) if (within(x, y, b.x, b.y, BUILDINGS[b.type].radius)) return b.id;
  return null;
}

/** Double-click: every own unit of the clicked unit's type inside the visible area (corners in world units). */
export function selectSameType(view: FactionView, id: number, [x0, y0]: [number, number], [x1, y1]: [number, number]): number[] {
  return sameTypeWhere(view, id, (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

/** Same as selectSameType, for any visible-area test (tilted or isometric views aren't world rectangles). */
export function sameTypeWhere(view: FactionView, id: number, inside: (x: number, y: number) => boolean): number[] {
  const type = view.units.find((u) => u.id === id)?.type;
  if (!type) return [];
  return view.units.filter((u) => u.type === type && inside(u.x, u.y)).map((u) => u.id);
}

export function boxSelect(view: FactionView, x0: number, y0: number, x1: number, y1: number): number[] {
  const [lx, hx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ly, hy] = [Math.min(y0, y1), Math.max(y0, y1)];
  return boxSelectWhere(view, (x, y) => x >= lx && x <= hx && y >= ly && y <= hy);
}

/** Box selection for any box shape (the renderer decides what is inside the dragged screen box). */
export function boxSelectWhere(view: FactionView, inside: (x: number, y: number) => boolean): number[] {
  const inBox = view.units.filter((u) => inside(u.x, u.y));
  // Prefer combat units when a box catches both, like most RTS games.
  const army = inBox.filter((u) => u.role !== 'worker');
  return (army.length > 0 ? army : inBox).map((u) => u.id);
}

/** Context command for a right click at (x, y) with the current selection. */
export function rightClick(view: FactionView, ui: UiState, x: number, y: number): Command[] {
  const ids = selectedUnits(view, ui);
  if (ids.length === 0) {
    const b = selectedBuilding(view, ui);
    return b ? [{ type: 'setRally', building: b.id, x, y }] : [];
  }
  const enemy = [...view.enemyUnits, ...view.enemyBuildings].find((e) =>
    within(x, y, e.x, e.y, 'role' in e ? 700 : BUILDINGS[e.type].radius));
  if (enemy) return [{ type: 'attack', units: ids, target: enemy.id }];

  const workers = ids.filter((id) => view.units.find((u) => u.id === id)?.role === 'worker');
  const others = ids.filter((id) => !workers.includes(id));
  const out: Command[] = [];
  const unfinished = view.buildings.find((b) => !b.built && within(x, y, b.x, b.y, BUILDINGS[b.type].radius));
  const site = view.sites.find((s) => s.kind !== 'core' && within(x, y, s.x, s.y, 900));
  const link = site || unfinished ? undefined : nearestLink(view, x, y);
  if (workers.length > 0 && unfinished) out.push({ type: 'construct', units: workers, building: unfinished.id });
  else if (workers.length > 0 && site && site.owner !== view.faction) out.push({ type: 'claim', units: workers, site: site.id });
  else if (workers.length > 0 && link && !link.mine) out.push({ type: 'lightLink', units: workers, link: link.index });
  else if (workers.length > 0) out.push({ type: 'move', units: workers, x, y });
  if (others.length > 0) out.push({ type: 'move', units: others, x, y });
  return out;
}

/** Left click while a mode is active. */
export function modeClick(view: FactionView, ui: UiState, x: number, y: number): Command[] {
  const mode = ui.mode;
  ui.mode = { type: 'none' };
  switch (mode.type) {
    case 'attackMove': {
      const ids = selectedUnits(view, ui);
      return ids.length ? [{ type: 'attackMove', units: ids, x, y }] : [];
    }
    case 'pullThePlug':
      return [{ type: 'pullThePlug', x, y }];
    case 'place': {
      let workers = selectedUnits(view, ui).filter((id) => view.units.find((u) => u.id === id)?.role === 'worker');
      if (workers.length === 0) {
        const idle = view.units.find((u) => u.role === 'worker' && u.order === 'idle') ?? view.units.find((u) => u.role === 'worker');
        workers = idle ? [idle.id] : [];
      }
      return workers.length ? [{ type: 'build', units: workers, building: mode.building, x, y }] : [];
    }
    case 'none':
      return [];
  }
}

/** Keyboard shortcuts that produce commands or change mode. Returns commands to issue. */
export function key(view: FactionView, ui: UiState, map: GameMap, k: string, cursor: [number, number]): Command[] {
  const core = view.buildings.find((b) => b.type === 'noc');
  const soc = view.buildings.find((b) => b.type === 'soc' && b.built && (b.queue.length < 5));
  if (k === 'a') ui.mode = { type: 'attackMove' };
  else if (k === 'p') ui.mode = { type: 'pullThePlug' };
  else if (k === 'escape') ui.mode = { type: 'none' };
  else if (BUILD_KEYS[k]) ui.mode = { type: 'place', building: BUILD_KEYS[k] };
  else if (k === 'e' && core) return [{ type: 'train', building: core.id, unit: 'field_engineer' }];
  else if (SOC_UNITS[k]) {
    const target = selectedBuilding(view, ui)?.type === 'soc' ? selectedBuilding(view, ui) : soc;
    return target ? [{ type: 'train', building: target.id, unit: SOC_UNITS[k] }] : [];
  } else if (k === 'g') return [{ type: 'attackSector', sector: sectorOf(map, cursor[0], cursor[1]) }];
  else if (k === 'd') return [{ type: 'defendSector', sector: sectorOf(map, cursor[0], cursor[1]) }];
  else if (k === 'x') return [{ type: 'expand' }];
  else if (k === 'c') {
    const link = nextLink(view);
    const workers = selectedUnits(view, ui).filter((id) => view.units.find((u) => u.id === id)?.role === 'worker');
    return link !== null && workers.length ? [{ type: 'lightLink', units: workers, link }] : [];
  }
  else if (k === 's') {
    const ids = selectedUnits(view, ui);
    return ids.length ? [{ type: 'stop', units: ids }] : [];
  }
  return [];
}

export function selectedUnits(view: FactionView, ui: UiState): number[] {
  return view.units.filter((u) => ui.selected.has(u.id)).map((u) => u.id);
}

function selectedBuilding(view: FactionView, ui: UiState) {
  return view.buildings.find((b) => ui.selected.has(b.id));
}

function nearestLink(view: FactionView, x: number, y: number) {
  const sites = new Map(view.sites.map((s) => [s.id, s]));
  let best: FactionView['links'][number] | undefined;
  let bestD = (800) ** 2;
  for (const l of view.links) {
    const a = sites.get(l.a)!;
    const b = sites.get(l.b)!;
    const d = segDist2(x, y, a.x, a.y, b.x, b.y);
    if (d < bestD) { bestD = d; best = l; }
  }
  return best;
}

/** Squared distance from a point to a segment (UI hit-testing only; floats are fine outside the sim). */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/** Plain-language tooltip for whatever is under the cursor. */
export function describeAt(view: FactionView, x: number, y: number): string | null {
  const mine = (o: string | null) => (o === view.faction ? 'yours' : o === null ? 'neutral' : o === 'unknown' ? 'not visible' : 'held by the AI');
  const u = [...view.units, ...view.enemyUnits].find((e) => within(x, y, e.x, e.y, 600));
  if (u) {
    const own = view.units.includes(u);
    const job = own && u.role === 'worker' ? ` · ${jobText(u, view).replace(/<[^>]+>/g, '')}` : '';
    return `${own ? 'Your' : 'Enemy'} ${u.type.replace(/_/g, ' ')} (${u.hp}/${u.maxHp} hp)${job}${own ? ' · click to select' : ' · right-click with units to attack'}`;
  }
  const b = [...view.buildings, ...view.enemyBuildings].find((e) => within(x, y, e.x, e.y, BUILDINGS[e.type].radius));
  if (b) {
    const names: Record<string, string> = {
      noc: 'Your NOC (base). Trains engineers. Lose it and you lose.', primary_cluster: 'AI Primary Cluster. Destroy it to win.',
      soc: 'SOC: trains combat units.', training_cluster: 'AI Training Cluster: trains AI units.',
      server_rack: 'Server Rack: adds Compute.', barricade: 'Barricade: a physical wall that blocks enemy machines.',
      security_post: 'Security Post: armed guards shoot AI machines in range.', sentry_gun: 'AI Sentry Gun: a hijacked automated turret. Pull the Plug silences it.',
    };
    return `${names[b.type] ?? b.type}${b.built ? '' : ' (under construction)'} ${b.hp}/${b.maxHp} hp`;
  }
  const s = view.sites.find((e) => e.kind !== 'core' && within(x, y, e.x, e.y, 900));
  if (s) {
    const what: Record<string, string> = {
      data_source: `Data Source: ${((s.rate * 20) / 1000).toFixed(1)} Data/s once claimed and connected to your NOC by fiber.`,
      router: 'Router: forwards traffic. Neutral routers forward for everyone; claim one to block the AI\'s traffic.',
      substation: 'Substation: claim it for +20 Power (lets you field more units).',
    };
    const issue = s.issue ? ` ⚠ Yours, but ${issueText(s.issue, s.flow, s.rate)}` : '';
    return `${what[s.kind]} Currently ${mine(s.owner)}.${issue}${s.owner !== view.faction ? ' Right-click with engineers to claim.' : ''}`;
  }
  const l = nearestLink(view, x, y);
  if (l) {
    return l.mine
      ? `Your fiber link: carries up to ${(l.bandwidth * 20) / 1000} Data/s.`
      : 'Dark fiber link. Right-click with engineers to connect it. Data flows only over your lit links.';
  }
  return null;
}

export function describeMode(m: Mode): string {
  switch (m.type) {
    case 'attackMove': return 'Attack-move: click a destination';
    case 'pullThePlug': return 'Pull the Plug: click a zone to black out';
    case 'place': return `Place ${m.building.replace('_', ' ')}: click a location`;
    case 'none': return '';
  }
}

