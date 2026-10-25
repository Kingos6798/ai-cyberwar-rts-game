import { describe, expect, it } from 'vitest';
import { createGame, DUEL_MAP, isqrt, MAPS, sectorCenter, sectorOf, stepToward, TILE, type GameMap } from '../src/sim/index.ts';

describe('integer math', () => {
  it('isqrt is exact', () => {
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 999_999, 1_000_000, 4_000_000_000]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
  });

  it('stepToward moves at most speed and lands exactly on target', () => {
    const [x, y] = stepToward(0, 0, 3000, 4000, 1000);
    expect(isqrt(x * x + y * y)).toBeLessThanOrEqual(1000);
    expect(stepToward(0, 0, 300, 400, 1000)).toEqual([300, 400]);
  });
});

// Every map gets the duel map's fairness checks (#5: a second map).
describe.each(Object.values(MAPS).map((m) => [m.id, m] as [string, GameMap]))('map %s', (_, DUEL_MAP) => {
  it('is point-symmetric: every site has a mirror of the same kind and rate', () => {
    for (const s of DUEL_MAP.sites) {
      const m = DUEL_MAP.sites.find((o) => o.x === DUEL_MAP.width - s.x && o.y === DUEL_MAP.height - s.y);
      expect(m, s.id).toBeDefined();
      expect(m!.kind).toBe(s.kind);
      expect(m!.rate ?? 0).toBe(s.rate ?? 0);
    }
  });

  it('links are mirrored with equal bandwidth', () => {
    const pos = new Map(DUEL_MAP.sites.map((s) => [s.id, [s.x, s.y] as const]));
    const key = (a: readonly number[], b: readonly number[]) => [a.join(','), b.join(',')].sort().join('|');
    const links = new Map(DUEL_MAP.links.map((l) => [key(pos.get(l.a)!, pos.get(l.b)!), l.bandwidth]));
    for (const l of DUEL_MAP.links) {
      const [ax, ay] = pos.get(l.a)!;
      const [bx, by] = pos.get(l.b)!;
      const mirrored = key([DUEL_MAP.width - ax, DUEL_MAP.height - ay], [DUEL_MAP.width - bx, DUEL_MAP.height - by]);
      expect(links.get(mirrored), `${l.a}-${l.b}`).toBe(l.bandwidth);
    }
  });

  // Booming must pay: income beyond the home sources comes from expansions away from the core (D-013).
  it('each side has expansion Data sources farther from its core than its home sources, linked to its network', () => {
    const core = DUEL_MAP.sites.find((s) => s.id === 'h_core')!;
    const d = (s: { x: number; y: number }) => (s.x - core.x) ** 2 + (s.y - core.y) ** 2;
    const home = DUEL_MAP.sites.filter((s) => s.id.startsWith('h_src'));
    const expansions = DUEL_MAP.sites.filter((s) => s.id.startsWith('h_exp'));
    expect(expansions.length).toBeGreaterThanOrEqual(2);
    for (const e of expansions) {
      expect(e.kind).toBe('data_source');
      expect(d(e)).toBeGreaterThan(Math.max(...home.map(d)));
      expect(e.x).toBeLessThan(DUEL_MAP.width / 2);
      expect(DUEL_MAP.links.some((l) => l.a === e.id || l.b === e.id)).toBe(true);
    }
  });

  it('is well formed: unique ids, links between real sites, one core each, everything on the map and reachable by fiber', () => {
    const ids = DUEL_MAP.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of DUEL_MAP.links) expect(ids.includes(l.a) && ids.includes(l.b), `${l.a}-${l.b}`).toBe(true);
    expect(DUEL_MAP.sites.filter((s) => s.kind === 'core').map((s) => s.owner).sort()).toEqual(['ai', 'human']);
    for (const s of DUEL_MAP.sites) expect(s.x > 0 && s.x < DUEL_MAP.width && s.y > 0 && s.y < DUEL_MAP.height, s.id).toBe(true);
    // Substations feed power by being held, not by fiber; every other site joins the network.
    const reached = new Set(['h_core']);
    for (let grew = true; grew;) {
      grew = false;
      for (const l of DUEL_MAP.links) {
        for (const [a, b] of [[l.a, l.b], [l.b, l.a]] as const) if (reached.has(a) && !reached.has(b)) { reached.add(b); grew = true; }
      }
    }
    for (const s of DUEL_MAP.sites) if (s.kind !== 'substation') expect(reached.has(s.id), s.id).toBe(true);
    expect(() => createGame(1, DUEL_MAP.id)).not.toThrow();
  });
});

describe('map list', () => {
  it('has the duel map and Long Haul, a longer map with two fiber routes and no center router', () => {
    expect(Object.keys(MAPS)).toEqual(['duel', 'long']);
    const long = MAPS.long!;
    expect(long.width).toBeGreaterThan(DUEL_MAP.width);
    expect(long.sites.some((s) => s.x === long.width / 2 && s.y === long.height / 2)).toBe(false);
  });
});

describe('duel map', () => {
  it('sectors name the 3x3 grid', () => {
    expect(sectorOf(DUEL_MAP, 0, 0)).toBe('NW');
    expect(sectorOf(DUEL_MAP, 24 * TILE, 16 * TILE)).toBe('C');
    const [x, y] = sectorCenter(DUEL_MAP, 'SE');
    expect(sectorOf(DUEL_MAP, x, y)).toBe('SE');
  });
});
