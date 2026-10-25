// Ground, tile grid and fog of war. Fog is a 1-texel-per-tile DataTexture on a black overlay plane;
// linear filtering softens tile edges and each texel eases toward its target so sight changes fade.
import {
  BufferGeometry, DataTexture, Float32BufferAttribute, LinearFilter, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RGBAFormat, type Scene,
} from 'three';
import type { FactionView } from '../../sim/index.ts';
import { COLORS } from '../draw.ts';
import { visibleTiles } from '../fog.ts';

const FOG_ALPHA = 0.62;

export interface GroundLayer { update(view: FactionView, dtMs: number): void }

export function createGroundLayer(scene: Scene, w: number, h: number): GroundLayer {
  // Surround: a darker apron so the map edge reads.
  const apron = new Mesh(new PlaneGeometry(w + 80, h + 80).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x070b12, roughness: 1 }));
  apron.position.set(w / 2, -0.02, h / 2);
  apron.receiveShadow = true;
  scene.add(apron);

  const ground = new Mesh(new PlaneGeometry(w, h).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: COLORS.ground, roughness: 0.92, metalness: 0.05 }));
  ground.position.set(w / 2, 0, h / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // Tile grid, brighter every 8 tiles, and the map border.
  const minor: number[] = [];
  const major: number[] = [];
  for (let x = 0; x <= w; x++) (x % 8 === 0 ? major : minor).push(x, 0.005, 0, x, 0.005, h);
  for (let y = 0; y <= h; y++) (y % 8 === 0 ? major : minor).push(0, 0.005, y, w, 0.005, y);
  for (const [pts, color, opacity] of [[minor, 0x2a3a52, 0.35], [major, 0x40618c, 0.55]] as const) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    scene.add(new LineSegments(g, new LineBasicMaterial({ color, transparent: true, opacity })));
  }

  const data = new Uint8Array(w * h * 4);
  const level = new Float32Array(w * h).fill(1);
  const tex = new DataTexture(data, w, h, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  const fog = new Mesh(new PlaneGeometry(w, h).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0xffffff, map: tex, transparent: true, depthWrite: false }));
  fog.position.set(w / 2, 0.02, h / 2);
  fog.renderOrder = 3;
  scene.add(fog);

  return {
    update(view, dtMs) {
      const seen = visibleTiles(view);
      const k = Math.min(1, dtMs / 180);
      for (let ty = 0; ty < h; ty++) {
        // The plane's v axis runs from map bottom (v = 0) to top, so texture rows are flipped.
        const row = (h - 1 - ty) * w;
        for (let tx = 0; tx < w; tx++) {
          const i = ty * w + tx;
          const want = seen[i] ? 0 : 1;
          level[i]! += (want - level[i]!) * k;
          const o = (row + tx) * 4;
          data[o] = 5; data[o + 1] = 8; data[o + 2] = 14;
          data[o + 3] = Math.round(level[i]! * FOG_ALPHA * 255);
        }
      }
      tex.needsUpdate = true;
    },
  };
}
