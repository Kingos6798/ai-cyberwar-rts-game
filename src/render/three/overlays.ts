// Readability overlays: selection rings, billboard health/progress bars, Pull the Plug blackouts, shot
// beams between units and their targets in range, and death markers / pings. All instanced or prebuilt
// buffers with a fixed capacity: nothing is allocated per frame.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, InstancedMesh, LineBasicMaterial, LineSegments,
  MeshBasicMaterial, Object3D, PlaneGeometry, RingGeometry, Vector3, type Camera, type Scene,
} from 'three';
import { BUILDINGS, dist2, PULL_THE_PLUG, TILE, UNITS, type FactionView, type World } from '../../sim/index.ts';
import { COLORS } from '../draw.ts';
import type { Effects } from '../effects.ts';
import { buildingHeight } from './buildings.ts';
import { UNIT_HEIGHT } from './shapes.ts';
import { UNIT_SCALE } from './units.ts';

const CAP = 2048;
const LINE_CAP = 4096;

function instanced(scene: Scene, geo: BufferGeometry, mat: MeshBasicMaterial, order: number, colored = false): InstancedMesh {
  const m = new InstancedMesh(geo, mat, CAP);
  m.count = 0;
  m.frustumCulled = false;
  m.renderOrder = order;
  if (colored) m.setColorAt(0, new Color(0xffffff));
  scene.add(m);
  return m;
}

export interface OverlayLayer { update(world: World, view: FactionView, selected: Set<number>, fx: Effects, now: number): void }

export function createOverlayLayer(scene: Scene, camera: Camera): OverlayLayer {
  const ringMat = new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const rings = instanced(scene, new RingGeometry(0.62, 0.74, 40).rotateX(-Math.PI / 2), ringMat, 4);
  const barMat = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
  const barGeo = new PlaneGeometry(1, 1);
  const barBack = instanced(scene, barGeo, barMat, 20, true);
  const barFill = instanced(scene, barGeo, barMat, 21, true);
  const blackMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
  const blackouts = instanced(scene, new CircleGeometry(1, 48).rotateX(-Math.PI / 2), blackMat, 5);
  const beamMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
  const beams = instanced(scene, new BoxGeometry(1, 1, 1).translate(0.5, 0, 0), beamMat, 6, true);

  const linePos = new Float32Array(LINE_CAP * 6);
  const lineCol = new Float32Array(LINE_CAP * 8);
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new BufferAttribute(linePos, 3));
  lineGeo.setAttribute('color', new BufferAttribute(lineCol, 4));
  const lines = new LineSegments(lineGeo, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
  lines.frustumCulled = false;
  lines.renderOrder = 7;
  scene.add(lines);

  const d = new Object3D();
  const c = new Color();
  const right = new Vector3();
  const byId = new Map<number, { x: number; y: number }>();
  let nRing = 0, nBar = 0, nBlack = 0, nBeam = 0, nLine = 0;

  function ring(x: number, y: number, r: number): void {
    if (nRing >= CAP) return;
    d.position.set(x / TILE, 0.04, y / TILE);
    d.rotation.set(0, 0, 0);
    d.scale.set(r, 1, r);
    d.updateMatrix();
    rings.setMatrixAt(nRing++, d.matrix);
  }

  function bar(x: number, y: number, h: number, w: number, f: number, color: number): void {
    if (nBar >= CAP) return;
    f = Math.max(0, Math.min(1, f));
    const hh = 0.13;
    d.quaternion.copy(camera.quaternion);
    d.position.set(x / TILE, h, y / TILE);
    d.scale.set(w + 0.08, hh + 0.08, 1);
    d.updateMatrix();
    barBack.setMatrixAt(nBar, d.matrix);
    barBack.setColorAt(nBar, c.set(0x04070c));
    d.position.addScaledVector(right, -(w / 2) + (w * f) / 2);
    d.scale.set(Math.max(0.001, w * f), hh, 1);
    d.updateMatrix();
    barFill.setMatrixAt(nBar, d.matrix);
    barFill.setColorAt(nBar, c.set(color));
    nBar++;
  }

  const hpColor = (f: number) => (f > 0.6 ? COLORS.hpGood : f > 0.3 ? 0xffcf5a : COLORS.hpBad);

  function line(ax: number, az: number, bx: number, bz: number, y: number, color: number, a: number): void {
    if (nLine >= LINE_CAP) return;
    c.set(color);
    const p = nLine * 6;
    linePos[p] = ax; linePos[p + 1] = y; linePos[p + 2] = az;
    linePos[p + 3] = bx; linePos[p + 4] = y; linePos[p + 5] = bz;
    const q = nLine * 8;
    for (let k = 0; k < 2; k++) { lineCol[q + k * 4] = c.r; lineCol[q + k * 4 + 1] = c.g; lineCol[q + k * 4 + 2] = c.b; lineCol[q + k * 4 + 3] = a; }
    nLine++;
  }

  function circle(x: number, z: number, r: number, color: number, a: number): void {
    const n = 40;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2;
      const t1 = ((i + 1) / n) * Math.PI * 2;
      line(x + Math.cos(t0) * r, z + Math.sin(t0) * r, x + Math.cos(t1) * r, z + Math.sin(t1) * r, 0.06, color, a);
    }
  }

  return {
    update(world, view, selected, fx, now) {
      nRing = nBar = nBlack = nBeam = nLine = 0;
      right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      byId.clear();
      for (const list of [view.units, view.enemyUnits, view.buildings, view.enemyBuildings]) for (const e of list) byId.set(e.id, e);

      for (const u of [view.units, view.enemyUnits]) for (const e of u) {
        const sel = selected.has(e.id);
        if (sel) ring(e.x, e.y, 1);
        if (sel || e.hp < e.maxHp) bar(e.x, e.y, UNIT_HEIGHT[e.role] * UNIT_SCALE + 0.35, 0.9, e.hp / e.maxHp, hpColor(e.hp / e.maxHp));
      }
      for (const list of [view.buildings, view.enemyBuildings]) for (const b of list) {
        const r = BUILDINGS[b.type].radius / TILE;
        if (selected.has(b.id)) ring(b.x, b.y, r * 1.45 + 0.3);
        const top = buildingHeight(b.type) + 0.4;
        if (selected.has(b.id) || b.hp < b.maxHp) bar(b.x, b.y, top, r * 2, b.hp / b.maxHp, hpColor(b.hp / b.maxHp));
        const own = list === view.buildings;
        if (own && !b.built) bar(b.x, b.y, top + 0.3, r * 2, b.buildProgress / BUILDINGS[b.type].buildWork, 0x9fb3c8);
        const next = b.queue[0];
        if (own && b.built && next) bar(b.x, b.y, top + 0.3, r * 2, b.progress / UNITS[next].work, 0x7fd4ff);
      }

      for (const b of world.blackouts) {
        if (b.until <= world.tick || nBlack >= CAP) continue;
        const r = PULL_THE_PLUG.radius / TILE;
        d.position.set(b.x / TILE, 0.05, b.y / TILE);
        d.rotation.set(0, 0, 0);
        d.scale.set(r, 1, r);
        d.updateMatrix();
        blackouts.setMatrixAt(nBlack++, d.matrix);
        circle(b.x / TILE, b.y / TILE, r, 0xffffff, 0.45);
      }

      // Shot beams: a unit with a target in range is firing.
      for (const [list, color] of [[view.units, 0x9fd0ff], [view.enemyUnits, 0xffc29a]] as const) {
        for (const u of list) {
          if (u.target === null || nBeam >= CAP) continue;
          const t = byId.get(u.target);
          if (!t) continue;
          const reach = UNITS[u.type].range + 1800;
          if (dist2(u.x, u.y, t.x, t.y) > reach * reach) continue;
          const dx = (t.x - u.x) / TILE;
          const dz = (t.y - u.y) / TILE;
          const len = Math.hypot(dx, dz);
          if (len < 0.01) continue;
          // Flicker so the beams read as fire, not static wires.
          const pulse = 0.5 + 0.5 * Math.sin(now / 60 + u.id * 1.7);
          d.position.set(u.x / TILE, 0.45, u.y / TILE);
          d.rotation.set(0, -Math.atan2(dz, dx), 0);
          d.scale.set(len, 0.035 + 0.035 * pulse, 0.035 + 0.035 * pulse);
          d.updateMatrix();
          beams.setMatrixAt(nBeam, d.matrix);
          beams.setColorAt(nBeam, c.set(color));
          nBeam++;
        }
      }

      for (const m of fx.deaths) {
        const a = Math.max(0, (m.until - now) / 1500);
        const x = m.x / TILE, z = m.y / TILE;
        line(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0.06, m.color, a);
        line(x + 0.4, z - 0.4, x - 0.4, z + 0.4, 0.06, m.color, a);
      }
      for (const p of fx.pings) {
        const t = (p.until - now) / 1000;
        circle(p.x / TILE, p.y / TILE, 1.5 + ((3 - t) % 1) * 2.5, p.color, Math.min(1, t));
      }

      for (const [m, n] of [[rings, nRing], [barBack, nBar], [barFill, nBar], [blackouts, nBlack], [beams, nBeam]] as const) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      lineGeo.setDrawRange(0, nLine * 2);
      lineGeo.attributes.position!.needsUpdate = true;
      lineGeo.attributes.color!.needsUpdate = true;
    },
  };
}
