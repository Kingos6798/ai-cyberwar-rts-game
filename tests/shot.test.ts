import { describe, expect, it } from 'vitest';
import { browserCandidates, pageError } from '../scripts/cdp.ts';

// `npm run shot` (#34): the pure parts of the headless screenshot tool. Launching a real browser is
// checked by hand (see the PR), since CI has none.
describe('shot: browser search', () => {
  it('BROWSER_PATH overrides the search', () => {
    expect(browserCandidates('win32', { BROWSER_PATH: 'C:\\b\\chrome.exe', PROGRAMFILES: 'C:\\Program Files' })).toEqual(['C:\\b\\chrome.exe']);
  });

  it('tries Chrome, then Edge, then Chromium under the Windows program folders', () => {
    const c = browserCandidates('win32', { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PF86' });
    expect(c[0]).toMatch(/PF.*Chrome.*chrome\.exe$/);
    expect(c.findIndex((p) => p.includes('msedge'))).toBeGreaterThan(c.findIndex((p) => p.includes('Google')));
    expect(c.some((p) => p.includes('PF86') && p.endsWith('msedge.exe'))).toBe(true);
  });

  it('looks in the usual Linux and macOS places', () => {
    expect(browserCandidates('linux', {})).toContain('/usr/bin/chromium');
    expect(browserCandidates('darwin', {})[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });
});

describe('shot: page errors', () => {
  it('reports exceptions, console.error and error log entries', () => {
    expect(pageError('Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x is undefined' } } }))
      .toBe('exception: TypeError: x is undefined');
    expect(pageError('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: 'boom' }, { type: 'number', value: 3 }] }))
      .toBe('console.error: boom 3');
    expect(pageError('Log.entryAdded', { entry: { level: 'error', text: 'Failed to load resource', url: 'http://x/a.png' } }))
      .toBe('log: Failed to load resource (http://x/a.png)');
  });

  it('ignores logs, warnings and other events', () => {
    expect(pageError('Runtime.consoleAPICalled', { type: 'log', args: [] })).toBeNull();
    expect(pageError('Log.entryAdded', { entry: { level: 'warning', text: 'meh' } })).toBeNull();
    expect(pageError('Page.loadEventFired', {})).toBeNull();
  });

  it("ignores the browser's own favicon request (the game has none)", () => {
    expect(pageError('Log.entryAdded', { entry: { level: 'error', text: 'Failed to load resource: 404', url: 'http://localhost:5173/favicon.ico' } })).toBeNull();
  });
});
