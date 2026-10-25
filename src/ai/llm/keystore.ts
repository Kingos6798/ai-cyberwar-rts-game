// Where a player's own API key lives in the browser (D-020). Session storage by default, so it is gone
// when the tab closes; local storage only if the player asks to remember it on this device.
const KEY = 'cyberwar.openai-key';

/** The parts of Web Storage this needs, so tests can pass a plain object. Every call may throw (private mode). */
export interface KeyStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export function loadKey(session: KeyStorage, local: KeyStorage): string | null {
  return safe(() => session.getItem(KEY), null) ?? safe(() => local.getItem(KEY), null);
}

export function saveKey(key: string, remember: boolean, session: KeyStorage, local: KeyStorage): void {
  forgetKey(session, local);
  safe(() => (remember ? local : session).setItem(KEY, key.trim()), undefined);
}

export function forgetKey(session: KeyStorage, local: KeyStorage): void {
  safe(() => session.removeItem(KEY), undefined);
  safe(() => local.removeItem(KEY), undefined);
}
