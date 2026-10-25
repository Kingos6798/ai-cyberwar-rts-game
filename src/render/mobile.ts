// Mobile port: phone layout switch, the on-screen toolbar for what a keyboard does on desktop
// (pause, speed, box select, deselect, fit map), and touch wording for help text.

/** Phones and tablets (coarse pointer), or ?mobile to try the touch layout on a desktop. */
export function isTouchUi(params: URLSearchParams): boolean {
  if (params.has('desktop')) return false;
  return params.has('mobile') || window.matchMedia('(pointer: coarse)').matches;
}

/** Help text says "click"/"right-click"; on a phone both are a tap. */
export function touchWords(text: string): string {
  return text
    .replace(/Drag a box around your engineers \(blue dots\), then right-click/g, 'Tap "Select all engineers" (or use ⬚ Box), then tap')
    .replace(/Hover anything on the map/g, 'Press and hold anything on the map')
    .replace(/Right[- ]click/g, 'Tap')
    .replace(/right[- ]click/g, 'tap')
    .replace(/Double-click/g, 'Double-tap')
    .replace(/Click/g, 'Tap')
    .replace(/\bclick/g, 'tap')
    .replace(/Drag a box or tap a unit/g, 'Tap a unit, or use ⬚ Box');
}

/** Choices from the phone's settings menu; URL options win over them. Saved per device. */
export interface GameSettings { renderer?: string; map?: string; ai?: string }
const SETTINGS_KEY = 'ai-cyberwar-settings';

export function loadSettings(): GameSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return s && typeof s === 'object' ? s : {};
  } catch { return {}; }
}

function saveSettings(s: GameSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* not saved: applies to this game only */ }
}

export interface SettingsChoices {
  current: Required<GameSettings>;
  maps: { id: string; name: string }[];
  opponents: string[];
}

export interface MobileBar {
  readonly boxMode: boolean;
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
}

/** The phone toolbar. Every button does something a key or mouse gesture does on desktop. */
export function createMobileBar(root: HTMLElement, actions: {
  togglePause: () => void;
  cycleSpeed: () => void;
  deselect: () => void;
  fit: () => void;
  onBoxMode: (on: boolean) => void;
}, settings: SettingsChoices): MobileBar {
  const bar = document.createElement('div');
  bar.id = 'mobile-bar';
  bar.className = 'hud-panel';
  bar.innerHTML = `
    <button type="button" data-a="pause" aria-label="Pause">⏸</button>
    <button type="button" data-a="speed" aria-label="Game speed">×1</button>
    <button type="button" data-a="box" aria-pressed="false" aria-label="Box select: drag to select">⬚ Box</button>
    <button type="button" data-a="deselect" aria-label="Deselect">✕</button>
    <button type="button" data-a="fit" aria-label="Show whole map">⤢</button>
    <button type="button" data-a="settings" aria-label="Game settings">⚙</button>`;
  root.appendChild(bar);

  // Settings: view, map and opponent. Applying saves them and starts a new game with them.
  const opt = (value: string, label: string, on: string) => `<option value="${value}"${value === on ? ' selected' : ''}>${label}</option>`;
  const name = (id: string) => id[0]!.toUpperCase() + id.slice(1);
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.className = 'hud-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="settings-title">Game settings</div>
    <label for="set-renderer">View</label>
    <select id="set-renderer">${opt('pixi', 'Top-down', settings.current.renderer)}${opt('iso', 'Isometric', settings.current.renderer)}${opt('three', '3D', settings.current.renderer)}</select>
    <label for="set-map">Map</label>
    <select id="set-map">${settings.maps.map((m) => opt(m.id, m.name, settings.current.map)).join('')}</select>
    <label for="set-ai">Opponent</label>
    <select id="set-ai">${settings.opponents.map((o) => opt(o, name(o), settings.current.ai)).join('')}</select>
    <div class="settings-note">Applying starts a new game.</div>
    <div class="settings-buttons"><button type="button" data-s="cancel">Cancel</button><button type="button" data-s="apply">Apply</button></div>`;
  root.appendChild(panel);
  const pick = (id: string) => panel.querySelector<HTMLSelectElement>(`#${id}`)!.value;
  panel.querySelector<HTMLButtonElement>('[data-s="cancel"]')!.onclick = () => { panel.hidden = true; };
  panel.querySelector<HTMLButtonElement>('[data-s="apply"]')!.onclick = () => {
    saveSettings({ renderer: pick('set-renderer'), map: pick('set-map'), ai: pick('set-ai') });
    location.reload();
  };
  const btn = (a: string) => bar.querySelector<HTMLButtonElement>(`[data-a="${a}"]`)!;
  let boxMode = false;
  btn('pause').onclick = actions.togglePause;
  btn('speed').onclick = actions.cycleSpeed;
  btn('deselect').onclick = actions.deselect;
  btn('fit').onclick = actions.fit;
  btn('settings').onclick = () => { panel.hidden = !panel.hidden; };
  btn('box').onclick = () => {
    boxMode = !boxMode;
    btn('box').setAttribute('aria-pressed', String(boxMode));
    btn('box').classList.toggle('on', boxMode);
    actions.onBoxMode(boxMode);
  };

  // Portrait phones squeeze the map: suggest turning sideways (dismissible; the game still works).
  const hint = document.createElement('div');
  hint.id = 'rotate-hint';
  hint.innerHTML = '⟳ Turn your phone sideways for a bigger map <button type="button" aria-label="Dismiss">✕</button>';
  hint.querySelector('button')!.onclick = () => hint.remove();
  root.appendChild(hint);

  return {
    get boxMode() { return boxMode; },
    setPaused(paused) { btn('pause').textContent = paused ? '▶' : '⏸'; btn('pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause'); },
    setSpeed(speed) { btn('speed').textContent = `×${speed}`; },
  };
}
