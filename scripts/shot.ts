// Headless screenshot for visual checks: opens the game in Chrome, Edge or Chromium, lets it run for
// --wait seconds of real time, saves a PNG, and prints the chat panel text and any page errors.
// Exits 1 if the page threw or logged an error. A one-shot `--screenshot` fires before the game loop runs.
// Usage (with `npm run dev` running):
//   npm run shot -- "http://localhost:5173/?seed=3&human=boom&ai=turtle&autostart" shot.png [--wait 20] [--width 1280] [--height 800]
// BROWSER_PATH=/path/to/chrome overrides the browser search.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { connect, findBrowser, pageError } from './cdp.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    wait: { type: 'string', default: '20' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '800' },
  },
});
const [url, out] = positionals;
if (!url || !out) {
  console.error('usage: npm run shot -- <url> <out.png> [--wait 20] [--width 1280] [--height 800]');
  process.exit(2);
}
const browserPath = findBrowser();
if (!browserPath) {
  console.error('no Chrome, Edge or Chromium found; set BROWSER_PATH to one');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'shot-'));
const browser = spawn(browserPath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  `--window-size=${values.width},${values.height}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

/** The browser writes its debugging port to DevToolsActivePort once it is listening. */
async function debugPort(): Promise<number> {
  for (let i = 0; i < 100; i++) {
    try {
      const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch { /* not written yet */ }
    await sleep(100);
  }
  throw new Error(`${browserPath} did not open a debugging port`);
}

const errors: string[] = [];
let code = 0;
try {
  const port = await debugPort();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const cdp = await connect(page.webSocketDebuggerUrl, (method, params) => {
    const e = pageError(method, params);
    if (e) errors.push(e);
  });
  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map((m) => cdp.send(m)));
  // --window-size includes browser chrome; pin the page itself to the requested size.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: Number(values.width), height: Number(values.height), deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  const nav = await cdp.send('Page.navigate', { url });
  if (nav.errorText) throw new Error(`cannot open ${url}: ${nav.errorText} (is \`npm run dev\` running?)`);
  await loaded;
  await sleep(Number(values.wait) * 1000);
  const chat = await cdp.send('Runtime.evaluate', { expression: "document.getElementById('hud-chat')?.innerText ?? ''", returnByValue: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out} after ${values.wait} s`);
  const text = String(chat.result?.value ?? '').trim();
  if (text) console.log(`chat panel:\n${text}`);
  await cdp.send('Browser.close').catch(() => {});
  cdp.close();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  code = 2;
} finally {
  browser.kill();
  await sleep(300);
  // Windows can hold profile files a moment after exit.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir, best effort */ }
}
for (const e of errors) console.error(e);
if (errors.length > 0) code ||= 1;
process.exit(code);
