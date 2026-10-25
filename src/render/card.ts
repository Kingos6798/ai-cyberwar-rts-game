// The command card: clickable buttons for everything the current selection can do. Hotkeys are only
// shortcuts for these buttons; nothing in the game requires knowing them.
import {
  BUILDINGS, MILLI, powerHeadroom, UNITS, type BuildingTypeId, type Command, type FactionView, type UnitTypeId,
} from '../sim/index.ts';
import { freeGroup, ownIds, recallGroup, saveGroup, type Groups } from './groups.ts';
import type { UiState } from './input.ts';

export interface CardButton {
  id: string;
  label: string;
  key?: string;
  cost?: number;
  tip: string;
  /** Reason the button can't be used right now; undefined = enabled. */
  disabled?: string;
  run: () => Command[];
}

const cost = (n: number) => Math.trunc(n / MILLI);

const UNIT_TIPS: Partial<Record<UnitTypeId, string>> = {
  field_engineer: 'Worker. Claims sites, connects fiber links, and builds. More engineers = faster expansion.',
  counter_drone_team: 'Fast team with jammers and drone interceptors. Strong against Hunter Drones and Red Teams (ranged). Weak against tanks.',
  red_team: 'Operators who hack and disable machines over radio, from range. Strong against Industrial Robots and Armored Vehicles (tanks). Weak against fast units.',
  armored_vehicle: 'Armored Response Vehicle: tough, shields crews. Strong against Botnet Swarms and Counter-Drone Teams (fast). Weak against ranged attackers.',
};

const BUILD_TIPS: Partial<Record<BuildingTypeId, string>> = {
  soc: 'Security Operations Center: trains your combat units. Build one first. One is usually enough: all your training shares one pool of Compute, so extra SOCs don’t train faster. Server Racks do.',
  server_rack: '+5 Compute: all your training gets faster (your NOC gives 10). Draws 2 Power.',
  barricade: 'A physical wall that blocks AI machines until they break through it. Your units pass freely.',
  security_post: 'Armed guard post: shoots AI machines within 5 tiles. Guards need no grid power, so it keeps firing in a blackout.',
};

export function buildCard(view: FactionView, ui: UiState, actions: {
  setMode: (m: UiState['mode']) => void;
  select: (ids: number[]) => void;
}, groups?: Groups): CardButton[] {
  const units = view.units.filter((u) => ui.selected.has(u.id));
  const building = view.buildings.find((b) => ui.selected.has(b.id));
  const workers = units.filter((u) => u.role === 'worker');
  const army = units.filter((u) => u.role !== 'worker');
  const core = view.buildings.find((b) => b.type === 'noc');
  const soc = view.buildings.find((b) => b.type === 'soc' && b.built);
  const afford = (c: number) => (view.data >= c ? undefined : `Need ${cost(c)} Data`);
  const allSubstations = view.sites.filter((s) => s.kind === 'substation').every((s) => s.owner === view.faction);
  const power = (t: UnitTypeId) => (UNITS[t].power <= powerHeadroom(view) ? undefined
    : `Power full (${view.powerUsed}/${view.powerCap}). ${allSubstations ? 'You hold every substation: this is your unit limit.' : 'Claim another substation for more Power.'}`);
  const out: CardButton[] = [];

  const train = (b: { id: number; queue: unknown[] } | undefined, t: UnitTypeId, key?: string): CardButton => ({
    id: `train:${t}`, label: `Train ${pretty(t)}`, key, cost: UNITS[t].cost, tip: UNIT_TIPS[t] ?? '',
    disabled: !b ? 'Build a SOC first' : b.queue.length >= 5 ? 'Queue full' : power(t) ?? afford(UNITS[t].cost),
    run: () => (b ? [{ type: 'train', building: b.id, unit: t }] : []),
  });
  const haveSoc = view.buildings.some((b) => b.type === 'soc');
  const build = (t: BuildingTypeId, key: string): CardButton => ({
    id: `build:${t}`, label: `Build ${pretty(t)}`, key, cost: BUILDINGS[t].cost,
    tip: `${t === 'soc' && haveSoc ? 'You already have a SOC: another one won’t train faster, because training shares your Compute. Build a Server Rack instead. ' : ''}${BUILD_TIPS[t] ?? ''} Click, then click the map to place it.`,
    disabled: afford(BUILDINGS[t].cost),
    run: () => { actions.setMode({ type: 'place', building: t }); return []; },
  });

  if (building?.type === 'noc' || (units.length === 0 && !building)) {
    out.push(train(core, 'field_engineer', 'E'));
  }
  if (building?.type === 'soc') {
    if (!building.built) out.push({ id: 'wait', label: 'Under construction', tip: 'Engineers are building this. Select engineers and right-click it to help.', disabled: 'Not finished', run: () => [] });
    else for (const [t, k] of [['counter_drone_team', 'U'], ['red_team', 'I'], ['armored_vehicle', 'O']] as const) out.push(train(building, t, k));
  }
  if (units.length === 0 && !building) {
    out.push({
      id: 'sel-workers', label: 'Select all engineers', tip: 'Select every Field Engineer.',
      disabled: view.units.some((u) => u.role === 'worker') ? undefined : 'No engineers',
      run: () => { actions.select(view.units.filter((u) => u.role === 'worker').map((u) => u.id)); return []; },
    });
    out.push({
      id: 'sel-army', label: 'Select army', key: 'Ctrl+A', tip: 'Select every combat unit.',
      disabled: view.units.some((u) => u.role !== 'worker') ? undefined : 'No combat units yet',
      run: () => { actions.select(view.units.filter((u) => u.role !== 'worker').map((u) => u.id)); return []; },
    });
    if (soc) for (const [t, k] of [['counter_drone_team', 'U'], ['red_team', 'I'], ['armored_vehicle', 'O']] as const) out.push(train(soc, t, k));
  }
  if (workers.length > 0) {
    out.push({
      id: 'expand', label: 'Claim nearest site', key: 'X',
      tip: 'Send an idle engineer to claim the nearest site you don\'t own. Or right-click a site yourself.',
      run: () => [{ type: 'expand' }],
    });
    const link = nextLink(view);
    out.push({
      id: 'connect', label: 'Connect fiber', key: 'C',
      tip: 'Send the selected engineers to light the next dark fiber link that joins your sites to your NOC. Data only flows over lit links.',
      disabled: link === null ? 'Nothing to connect: claim a site first' : undefined,
      run: () => (link === null ? [] : [{ type: 'lightLink', units: workers.map((u) => u.id), link }]),
    });
    out.push(build('soc', 'Q'), build('server_rack', 'R'), build('barricade', 'F'), build('security_post', 'V'));
  }
  if (army.length > 0) {
    out.push({ id: 'amove', label: 'Attack-move', key: 'A', tip: 'Click a destination: units fight anything they meet on the way.', run: () => { actions.setMode({ type: 'attackMove' }); return []; } });
    out.push({ id: 'attack-base', label: 'Attack AI base', tip: 'Attack-move the selected units to the AI\'s Primary Cluster.', run: () => {
      const target = view.sites.find((s) => s.kind === 'core' && !(core && s.x === core.x && s.y === core.y));
      return target ? [{ type: 'attackMove', units: army.map((u) => u.id), x: target.x, y: target.y }] : [];
    } });
    out.push({ id: 'defend', label: 'Return to base', tip: 'Move the selected units back to your NOC.', run: () => (core ? [{ type: 'move', units: army.map((u) => u.id), x: core.x + 3000, y: core.y }] : []) });
  }
  if (groups) out.push(...groupButtons(view, ui, groups, actions.select));
  if (units.length > 0) out.push({ id: 'stop', label: 'Stop', key: 'S', tip: 'Cancel current orders.', run: () => [{ type: 'stop', units: units.map((u) => u.id) }] });
  out.push({
    id: 'plug', label: 'Pull the Plug', key: 'P',
    tip: 'Cut power to a zone for 5 seconds: AI machines there lose their link to the Model and freeze, and buildings there go dark (yours too). 60s cooldown.',
    disabled: view.plugReadyIn === 0 ? undefined : `Ready in ${Math.ceil((view.plugReadyIn ?? 0) / 20)}s`,
    run: () => { actions.setMode({ type: 'pullThePlug' }); return []; },
  });
  return out;
}

/** Control groups (#3): save the selection to a free number, and one button per saved group. */
function groupButtons(view: FactionView, ui: UiState, groups: Groups, select: (ids: number[]) => void): CardButton[] {
  const out: CardButton[] = [];
  const alive = ownIds(view);
  const free = freeGroup(groups);
  if (ui.selected.size > 0) {
    out.push({
      id: 'group:save', label: free ? `Save as group ${free}` : 'Save as group', key: free ? `Ctrl+${free}` : 'Ctrl+1–9',
      tip: 'Remember this selection under a number. Press the number (or click its button) to select it again; press it twice to jump the camera there.',
      disabled: free ? undefined : 'Groups 1–9 are all in use: press Ctrl+number to overwrite one',
      run: () => { if (free) saveGroup(groups, free, [...ui.selected].filter((id) => alive.has(id))); return []; },
    });
  }
  for (const [n, ids] of [...groups.groups].sort(([a], [b]) => a - b)) {
    const left = ids.filter((id) => alive.has(id)).length;
    if (left === 0) continue;
    out.push({
      id: `group:${n}`, label: `Group ${n} (${left})`, key: String(n), tip: `Select control group ${n}.`,
      run: () => { select(recallGroup(groups, n, alive)); return []; },
    });
  }
  return out;
}

export function pretty(id: string): string {
  const names: Record<string, string> = { soc: 'SOC', noc: 'NOC' };
  return names[id] ?? id.split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

/** The dark link closest to our core whose ends are both ours (or a neutral router): lighting it extends the network. */
export function nextLink(view: FactionView): number | null {
  const core = view.buildings.find((b) => b.type === 'noc');
  if (!core) return null;
  const sites = new Map(view.sites.map((s) => [s.id, s]));
  const friendly = (id: string) => {
    const s = sites.get(id);
    if (!s) return false;
    if (s.kind === 'core') return s.x === core.x && s.y === core.y;
    return s.owner === view.faction || (s.kind === 'router' && s.owner === null);
  };
  let best: number | null = null;
  let bestD = Infinity;
  for (const l of view.links) {
    if (l.mine || !friendly(l.a) || !friendly(l.b)) continue;
    const a = sites.get(l.a)!;
    const b = sites.get(l.b)!;
    // Only useful if it touches something we actually own (not just two neutral routers).
    if (a.owner !== view.faction && b.owner !== view.faction && a.kind !== 'core' && b.kind !== 'core') continue;
    const d = Math.min((a.x - core.x) ** 2 + (a.y - core.y) ** 2, (b.x - core.x) ** 2 + (b.y - core.y) ** 2);
    if (d < bestD) { bestD = d; best = l.index; }
  }
  return best;
}
