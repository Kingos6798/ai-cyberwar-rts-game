// Units as one InstancedMesh per role × faction, so hundreds of units cost a handful of draw calls.
// Matrices and colors are rewritten every frame; meshes only grow (rarely) when a batch runs out of room.
import { Color, InstancedMesh, MeshStandardMaterial, Object3D, type Scene } from 'three';
import { TILE, type Faction, type FactionView, type Role, type UnitView } from '../../sim/index.ts';
import { ownerColor } from './palette.ts';
import { UNIT_GEOMETRY } from './shapes.ts';

/** Shapes are modelled at true footprint; drawn a bit larger so they read at RTS zoom. */
export const UNIT_SCALE = 1.35;
const ROLES: Role[] = ['worker', 'fast', 'ranged', 'tank'];
const FACTIONS: Faction[] = ['human', 'ai'];

interface Batch { mesh: InstancedMesh; count: number }

export interface UnitLayer {
  update(view: FactionView, flashes: Map<number, number>, now: number): void;
  /** Smoothed heading (radians) of a unit, for effects. */
  readonly headings: Map<number, number>;
}

export function createUnitLayer(scene: Scene): UnitLayer {
  const batches = new Map<string, Batch>();
  const geometries = new Map(ROLES.map((r) => [r, UNIT_GEOMETRY[r]()]));
  const materials = new Map<Faction, MeshStandardMaterial>();
  for (const f of FACTIONS) {
    const c = new Color(ownerColor(f));
    materials.set(f, new MeshStandardMaterial({ color: 0xffffff, emissive: c.clone().multiplyScalar(0.2), roughness: 0.45, metalness: 0.15, flatShading: true }));
  }
  const headings = new Map<number, number>();
  const last = new Map<number, { x: number; y: number }>();
  const dummy = new Object3D();
  const white = new Color(0xffffff);
  const tint = new Color();
  const seen = new Set<number>();

  function makeBatch(role: Role, f: Faction, capacity: number): Batch {
    const mesh = new InstancedMesh(geometries.get(role)!, materials.get(f)!, capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.setColorAt(0, white);
    scene.add(mesh);
    return { mesh, count: 0 };
  }
  for (const r of ROLES) for (const f of FACTIONS) batches.set(`${r}:${f}`, makeBatch(r, f, 256));

  function place(u: UnitView, f: Faction, flashes: Map<number, number>, now: number): void {
    const key = `${u.role}:${f}`;
    let b = batches.get(key)!;
    if (b.count >= b.mesh.instanceMatrix.count) {
      // Out of room: replace with a batch twice the size (happens a few times per session at most).
      scene.remove(b.mesh);
      b.mesh.dispose();
      b = makeBatch(u.role, f, b.mesh.instanceMatrix.count * 2);
      batches.set(key, b);
    }
    const prev = last.get(u.id);
    let heading = headings.get(u.id) ?? (f === 'human' ? 0 : Math.PI);
    if (prev && (prev.x !== u.x || prev.y !== u.y)) {
      const want = Math.atan2(u.y - prev.y, u.x - prev.x);
      let d = want - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading += d * 0.25;
    }
    headings.set(u.id, heading);
    if (prev) { prev.x = u.x; prev.y = u.y; } else last.set(u.id, { x: u.x, y: u.y });
    // Drones (ranged) hover with a gentle bob.
    const bob = u.role === 'ranged' ? Math.sin(now / 400 + u.id) * 0.06 : 0;
    dummy.position.set(u.x / TILE, bob, u.y / TILE);
    dummy.rotation.set(0, -heading, 0);
    dummy.scale.setScalar(UNIT_SCALE);
    dummy.updateMatrix();
    b.mesh.setMatrixAt(b.count, dummy.matrix);
    const flash = flashes.has(u.id);
    tint.set(ownerColor(f));
    if (flash) tint.lerp(white, 0.7);
    b.mesh.setColorAt(b.count, tint);
    b.count++;
  }

  return {
    headings,
    update(view, flashes, now) {
      for (const b of batches.values()) b.count = 0;
      seen.clear();
      const enemy = view.faction === 'human' ? 'ai' : 'human';
      for (const u of view.units) { place(u, view.faction, flashes, now); seen.add(u.id); }
      for (const u of view.enemyUnits) { place(u, enemy, flashes, now); seen.add(u.id); }
      for (const b of batches.values()) {
        b.mesh.count = b.count;
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      }
      for (const id of last.keys()) if (!seen.has(id)) { last.delete(id); headings.delete(id); }
    },
  };
}
