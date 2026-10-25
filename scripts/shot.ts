// Headless screenshot for visual checks (issue #34). A one-shot `--screenshot` fires before the game loop
// has run, so this drives the browser over the DevTools protocol instead: open the page, wait N seconds of
// real time, capture a PNG, then print page errors and the General's chat. Exits 1 if the page threw an
// exception (logged errors are printed but don't fail the run).
// Usage (with `npm run dev` running):
//   npm run shot -- "http://localhost:5173/?seed=3&human=boom&ai=turtle&autostart" shot.png --wait 20
// Finds Chrome, Edge or Chromium; set BROWSER_PATH to use another. No dependencies: Node's fetch + WebSocket.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBrowser, isThrown, parseShotArgs, problemFrom } from './browser.ts';

let args;
try {
  args = parseShotArgs(process.argv.slice(2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
const browser = findBrowser(process.platform, process.env, existsSync);
if (!browser) {
  console.error('No Chrome, Edge or Chromium found. Install one, or set BROWSER_PATH to its executable.');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'rts-shot-'));
const proc = spawn(browser, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${args.width},${args.height}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
  // Keep the game loop running at full speed in a page nobody is looking at. Without these, headless Edge on
  // Windows marked the page hidden after ~15 s and stopped animation frames (the game clock froze).
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

/** The browser prints its DevTools address on stderr once it is ready. */
function devtoolsOrigin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`browser did not start: ${buf.slice(-300)}`)), 20_000);
    proc.stderr.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const m = /DevTools listening on ws:\/\/([^/\s]+)\//.exec(buf);
      if (m) { clearTimeout(timer); resolve(`http://${m[1]}`); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`browser exited (${code}): ${buf.slice(-300)}`)); });
  });
}

/** A minimal DevTools-protocol session on one page. */
async function connect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`)); });
  let nextId = 1;
  const waiting = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const listeners: ((method: string, params: Record<string, unknown>) => void)[] = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string } };
    if (msg.id !== undefined) {
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) w?.reject(new Error(msg.error.message)); else w?.resolve(msg.result ?? {});
    } else if (msg.method) {
      for (const l of listeners) l(msg.method, msg.params ?? {});
    }
  };
  return {
    send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
    },
    on(listener: (method: string, params: Record<string, unknown>) => void) { listeners.push(listener); },
    close() { ws.close(); },
  };
}

const problems: string[] = [];
let exitCode = 0;
try {
  const origin = await devtoolsOrigin();
  const targets = await (await fetch(`${origin}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('browser has no page to drive');
  const cdp = await connect(page.webSocketDebuggerUrl);
  cdp.on((method, params) => { const p = problemFrom(method, params); if (p) problems.push(p); });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  // A focused page, plus a tiny screencast that keeps the browser producing frames: even when visible, a
  // headless page with no viewer slowed to ~1 frame/s after ~15 s, so --wait 20 showed the game at 0:15.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  cdp.on((method, params) => { if (method === 'Page.screencastFrame') void cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 1, maxWidth: 32, maxHeight: 32 });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: args.width, height: args.height, deviceScaleFactor: 1, mobile: false });
  // Count the wait from the load event, so --wait 20 shows the game at about 0:20 (the dev server can take
  // a few seconds to serve the modules).
  const loaded = new Promise<void>((resolve) => {
    cdp.on((method) => { if (method === 'Page.loadEventFired') resolve(); });
    setTimeout(resolve, 30_000);
  });
  const nav = await cdp.send('Page.navigate', { url: args.url });
  if (nav.errorText) throw new Error(`cannot open ${args.url}: ${String(nav.errorText)} (is \`npm run dev\` running?)`);
  await loaded;
  console.log(`loaded; waiting ${args.wait} s on ${args.url}`);
  await new Promise((r) => setTimeout(r, args.wait * 1000));
  const status = await cdp.send('Runtime.evaluate', {
    expression: `[document.getElementById('t-time')?.textContent, document.getElementById('t-meta')?.textContent].filter(Boolean).join(' | ')`,
    returnByValue: true,
  });
  const chat = await cdp.send('Runtime.evaluate', { expression: `document.getElementById('hud-chat')?.innerText ?? ''`, returnByValue: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(args.out, Buffer.from(String(shot.data), 'base64'));
  cdp.close();
  const value = (r: Record<string, unknown>) => String((r.result as { value?: unknown } | undefined)?.value ?? '');
  console.log(`wrote ${args.out}${value(status) ? ` (game: ${value(status)})` : ''}`);
  if (value(chat).trim()) console.log(`chat:\n${value(chat).trim()}`);
  if (problems.length > 0) console.error(`${problems.length} page error(s):\n- ${problems.join('\n- ')}`);
  if (problems.some(isThrown)) exitCode = 1;
} catch (e) {
  console.error((e as Error).message);
  exitCode = 1;
} finally {
  proc.kill();
  // The browser can hold its profile for a moment after exit (Windows); retry, and leave it if still locked.
  await new Promise((r) => proc.exitCode === null ? proc.once('exit', r) : r(null));
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir; the OS cleans it */ }
}
process.exit(exitCode);
