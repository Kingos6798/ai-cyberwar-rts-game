// Shared colors and materials for the Three.js view. Faction colors come from the 2D view (blue/orange,
// colorblind-safe); bodies are muted so the faction color reads as trim, not an all-neon scene.
import { Color, MeshStandardMaterial } from 'three';
import type { Faction } from '../../sim/index.ts';
import { COLORS } from '../draw.ts';

export type Owner = Faction | null | 'unknown';

export const ownerColor = (o: Owner): number =>
  o === 'human' ? COLORS.human : o === 'ai' ? COLORS.ai : o === 'unknown' ? COLORS.unseen : COLORS.neutral;

export const enemyOf = (f: Faction): Faction => (f === 'human' ? 'ai' : 'human');

const cache = new Map<string, MeshStandardMaterial>();

/** Building/site body: faction color mixed toward slate. Ghost = unbuilt (semi-transparent). */
export function bodyMaterial(o: Owner, ghost = false): MeshStandardMaterial {
  const key = `body:${o}:${ghost}`;
  let m = cache.get(key);
  if (!m) {
    const c = new Color(ownerColor(o)).lerp(new Color(0x1b2636), 0.6);
    m = new MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.35, flatShading: true,
      transparent: ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost });
    cache.set(key, m);
  }
  return m;
}

/** Glowing trim in the pure faction color. */
export function trimMaterial(o: Owner, ghost = false): MeshStandardMaterial {
  const key = `trim:${o}:${ghost}`;
  let m = cache.get(key);
  if (!m) {
    const c = new Color(ownerColor(o));
    m = new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: o === 'unknown' || o === null ? 0.15 : 0.95,
      roughness: 0.4, transparent: ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost });
    cache.set(key, m);
  }
  return m;
}
