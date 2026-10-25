// Minimal Chrome DevTools Protocol helpers for `npm run shot`: find a Chromium browser, talk to a page
// over the built-in WebSocket, and turn console/exception events into readable errors. No dependencies.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where Chrome, Edge or Chromium usually live, in the order we try them. `BROWSER_PATH` wins. */
export function browserCandidates(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  if (env.BROWSER_PATH) return [env.BROWSER_PATH];
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r);
    return [
      'Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe',
    ].flatMap((p) => roots.map((r) => join(r, p)));
  }
  if (platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Chromium'].map((a) => `/Applications/${a}.app/Contents/MacOS/${a}`);
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    .flatMap((b) => ['/usr/bin/', '/usr/local/bin/', '/snap/bin/'].map((d) => d + b));
}

export function findBrowser(platform = process.platform, env = process.env): string | undefined {
  return browserCandidates(platform, env).find((p) => existsSync(p));
}

interface RemoteObject { type: string; value?: unknown; description?: string }

/** A page error worth failing on, from a CDP event; null for everything else. */
export function pageError(method: string, params: Record<string, any>): string | null {
  if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails ?? {};
    return `exception: ${d.exception?.description ?? d.text ?? 'unknown'}`;
  }
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    const args = (params.args ?? []) as RemoteObject[];
    return `console.error: ${args.map((a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type)).join(' ')}`;
  }
  // The browser asks for /favicon.ico on its own; the game has none, so that 404 is not a page error.
  if (method === 'Log.entryAdded' && params.entry?.level === 'error' && !String(params.entry.url ?? '').endsWith('/favicon.ico')) {
    return `log: ${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`;
  }
  return null;
}

export interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  /** Resolves on the next event named `method`. */
  once(method: string): Promise<any>;
  close(): void;
}

/** Connects to a page target's `webSocketDebuggerUrl`; `onEvent` sees every event. */
export async function connect(url: string, onEvent: (method: string, params: any) => void): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`cannot connect to ${url}`)); });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const waiters = new Map<string, ((p: any) => void)[]>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p?.resolve(msg.result);
      return;
    }
    onEvent(msg.method, msg.params ?? {});
    for (const w of waiters.get(msg.method) ?? []) w(msg.params);
    waiters.delete(msg.method);
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    once: (method) => new Promise((resolve) => waiters.set(method, [...(waiters.get(method) ?? []), resolve])),
    close: () => ws.close(),
  };
}
