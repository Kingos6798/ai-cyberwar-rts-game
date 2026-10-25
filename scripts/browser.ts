// Pure helpers for `npm run shot` (scripts/shot.ts, issue #34): where to find a Chromium-family browser,
// the command line, and which DevTools-protocol events count as page errors. Kept apart so tests can load
// them without launching a browser.
import { parseArgs } from 'node:util';

type Env = Record<string, string | undefined>;

/** Browser paths to try, in order. `BROWSER_PATH` comes first when set. */
export function browserCandidates(platform: string, env: Env): string[] {
  const own = env.BROWSER_PATH ? [env.BROWSER_PATH] : [];
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r);
    const apps = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe'];
    return [...own, ...apps.flatMap((app) => roots.map((root) => `${root}\\${app}`))];
  }
  if (platform === 'darwin') {
    return [...own, ...['Google Chrome.app/Contents/MacOS/Google Chrome', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Chromium.app/Contents/MacOS/Chromium']
      .map((app) => `/Applications/${app}`)];
  }
  return [...own, ...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']
    .map((name) => `/usr/bin/${name}`), '/snap/bin/chromium'];
}

/** First candidate that exists (`BROWSER_PATH` is trusted as given), or null. */
export function findBrowser(platform: string, env: Env, exists: (path: string) => boolean): string | null {
  if (env.BROWSER_PATH) return env.BROWSER_PATH;
  return browserCandidates(platform, env).find(exists) ?? null;
}

export interface ShotArgs { url: string; out: string; wait: number; width: number; height: number }

export const SHOT_USAGE = 'usage: npm run shot -- <url> <out.png> [--wait 10] [--width 1600] [--height 900]';

export function parseShotArgs(argv: string[]): ShotArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { wait: { type: 'string', default: '10' }, width: { type: 'string', default: '1600' }, height: { type: 'string', default: '900' } },
  });
  const [url, out] = positionals;
  if (!url || !out) throw new Error(SHOT_USAGE);
  const num = (name: 'wait' | 'width' | 'height', min: number) => {
    const n = Number(values[name]);
    if (!Number.isFinite(n) || n < min) throw new Error(`--${name} must be a number >= ${min}`);
    return n;
  };
  return { url, out, wait: num('wait', 0), width: num('width', 100), height: num('height', 100) };
}

interface RemoteValue { value?: unknown; description?: string }

/** Whether a problem line is a thrown exception (the run fails) rather than a logged error (reported only). */
export const isThrown = (problem: string) => problem.startsWith('exception: ');

/** A DevTools event as a one-line page error, or null if it is not an error. */
export function problemFrom(method: string, params: Record<string, unknown>): string | null {
  if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails as { text?: string; exception?: RemoteValue } | undefined;
    return `exception: ${d?.exception?.description ?? d?.text ?? 'unknown'}`;
  }
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    const args = (params.args as RemoteValue[] | undefined) ?? [];
    return `console.error: ${args.map((a) => (a.value !== undefined ? String(a.value) : a.description ?? '')).join(' ')}`;
  }
  if (method === 'Log.entryAdded') {
    const e = params.entry as { level?: string; text?: string; url?: string } | undefined;
    // The dev server has no favicon; the browser asking for one is not a game problem.
    if (e?.url?.endsWith('/favicon.ico')) return null;
    if (e?.level === 'error') return `log: ${e.text ?? ''}${e.url ? ` (${e.url})` : ''}`;
  }
  return null;
}
