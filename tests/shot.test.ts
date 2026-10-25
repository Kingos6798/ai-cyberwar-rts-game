import { describe, expect, it } from 'vitest';
import { browserCandidates, findBrowser, isThrown, parseShotArgs, problemFrom } from '../scripts/browser.ts';

// Issue #34: `npm run shot` screenshots the game headlessly. The browser-driving part needs a real browser;
// these are the pure pieces around it.
describe('npm run shot helpers', () => {
  it('BROWSER_PATH wins over every known install location', () => {
    expect(browserCandidates('win32', { BROWSER_PATH: 'D:/chrome.exe' })[0]).toBe('D:/chrome.exe');
    expect(findBrowser('linux', { BROWSER_PATH: '/opt/x/chrome' }, () => false)).toBe('/opt/x/chrome');
  });

  it('looks for Chrome, Edge and Chromium in the usual places for each OS', () => {
    const win = browserCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' });
    expect(win).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(win).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    expect(win).toContain('C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
    const linux = browserCandidates('linux', {});
    expect(linux).toEqual(expect.arrayContaining(['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium']));
    expect(browserCandidates('darwin', {})).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('picks the first candidate that exists, or null', () => {
    const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' };
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    expect(findBrowser('win32', env, (p) => p === edge)).toBe(edge);
    expect(findBrowser('win32', env, () => false)).toBeNull();
  });

  it('reads url, output file, wait and size; rejects a missing url or output', () => {
    expect(parseShotArgs(['http://localhost:5173/?autostart', 'shot.png', '--wait', '20'])).toEqual({
      url: 'http://localhost:5173/?autostart', out: 'shot.png', wait: 20, width: 1600, height: 900,
    });
    expect(parseShotArgs(['http://x', 'a.png', '--width', '1280', '--height', '720'])).toMatchObject({ wait: 10, width: 1280, height: 720 });
    expect(() => parseShotArgs(['http://x'])).toThrow(/usage/);
    expect(() => parseShotArgs(['http://x', 'a.png', '--wait', 'soon'])).toThrow(/--wait/);
  });

  it('turns thrown exceptions, console.error and error log entries into problems; ignores the rest', () => {
    expect(problemFrom('Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x is undefined' } } }))
      .toBe('exception: TypeError: x is undefined');
    expect(problemFrom('Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'boom' }, { description: 'Error: bad' }] }))
      .toBe('console.error: boom Error: bad');
    expect(problemFrom('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'hi' }] })).toBeNull();
    expect(problemFrom('Log.entryAdded', { entry: { level: 'error', text: 'Failed to load resource', url: 'http://x/a.js' } }))
      .toBe('log: Failed to load resource (http://x/a.js)');
    expect(problemFrom('Log.entryAdded', { entry: { level: 'warning', text: 'meh' } })).toBeNull();
  });

  it('ignores the missing favicon, and only thrown exceptions fail the run', () => {
    expect(problemFrom('Log.entryAdded', { entry: { level: 'error', text: '404 (Not Found)', url: 'http://localhost:5173/favicon.ico' } })).toBeNull();
    expect(isThrown('exception: TypeError: x')).toBe(true);
    expect(isThrown('console.error: boom')).toBe(false);
    expect(isThrown('log: Failed to load resource (http://x/a.js)')).toBe(false);
  });
});
