// Mobile port: phone layout switch, the on-screen toolbar for what a keyboard does on desktop
// (pause, speed, box select, deselect, fit map), the settings menu, and touch wording for help text.

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

export type BatterySaver = 'auto' | 'on' | 'off';

/** Choices from the phone's settings menu; URL options win over them. Saved per device. */
export interface GameSettings {
  renderer?: string;
  map?: string;
  /** Opponent strategy id, or 'llm' for the cloud General (the player's own API key). */
  ai?: string;
  /** Quick match: richer start and faster claiming, for short sessions. */
  quick?: boolean;
  vibrate?: boolean;
  battery?: BatterySaver;
  /** How hard the AI plays (src/ai/difficulty.ts). */
  difficulty?: string;
}
const SETTINGS_KEY = 'ai-cyberwar-settings';

export function loadSettings(): GameSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return s && typeof s === 'object' ? s : {};
  } catch { return {}; }
}

export function saveSettings(s: GameSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* not saved: applies to this game only */ }
}

export interface SettingsChoices {
  current: Required<GameSettings>;
  maps: { id: string; name: string }[];
  opponents: string[];
  /** Settings that don't need a new game (vibration, battery saver) apply at once through this. */
  onLiveChange: (s: Required<GameSettings>) => void;
  /** Deletes a saved cloud API key. */
  forgetKey: () => void;
  /** Called just before a settings change starts a new game (drops the saved match). */
  onNewGame: () => void;
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
  idleWorker: () => void;
  army: () => void;
}, settings: SettingsChoices): MobileBar {
  const bar = document.createElement('div');
  bar.id = 'mobile-bar';
  bar.className = 'hud-panel';
  bar.innerHTML = `
    <button type="button" data-a="pause" aria-label="Pause">⏸</button>
    <button type="button" data-a="speed" aria-label="Game speed">×1</button>
    <button type="button" data-a="box" aria-pressed="false" aria-label="Box select: drag to select" class="small">⬚Box</button>
    <button type="button" data-a="idle" aria-label="Next idle engineer">👷</button>
    <button type="button" data-a="army" aria-label="Select your army">⚔</button>
    <button type="button" data-a="deselect" aria-label="Deselect">✕</button>
    <button type="button" data-a="fit" aria-label="Show whole map">⤢</button>
    <button type="button" data-a="settings" aria-label="Game settings">⚙</button>`;
  root.appendChild(bar);

  // Settings. Game choices (view, map, opponent, match) start a new game; the rest apply at once.
  const cur = settings.current;
  const opt = (value: string, label: string, on: string) => `<option value="${value}"${value === on ? ' selected' : ''}>${label}</option>`;
  const name = (id: string) => (id === 'llm' ? 'AI General (cloud, your API key)' : id[0]!.toUpperCase() + id.slice(1));
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.className = 'hud-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="settings-title">Game settings</div>
    <label for="set-renderer">View</label>
    <select id="set-renderer">${opt('pixi', 'Top-down', cur.renderer)}${opt('iso', 'Isometric', cur.renderer)}${opt('three', '3D', cur.renderer)}</select>
    <label for="set-map">Map</label>
    <select id="set-map">${settings.maps.map((m) => opt(m.id, m.name, cur.map)).join('')}</select>
    <label for="set-ai">Opponent</label>
    <select id="set-ai">${settings.opponents.map((o) => opt(o, name(o), cur.ai)).join('')}</select>
    <label for="set-difficulty">Difficulty</label>
    <select id="set-difficulty">${opt('easy', 'Easy', cur.difficulty)}${opt('normal', 'Normal', cur.difficulty)}${opt('hard', 'Hard', cur.difficulty)}</select>
    <label for="set-quick">Match</label>
    <select id="set-quick">${opt('std', 'Standard', cur.quick ? 'quick' : 'std')}${opt('quick', 'Quick (richer start, faster claims)', cur.quick ? 'quick' : 'std')}</select>
    <label for="set-vibrate">Vibration</label>
    <select id="set-vibrate">${opt('on', 'On', cur.vibrate ? 'on' : 'off')}${opt('off', 'Off', cur.vibrate ? 'on' : 'off')}</select>
    <label for="set-battery">Battery saver (30 fps)</label>
    <select id="set-battery">${opt('auto', 'Auto (when low and not charging)', cur.battery)}${opt('on', 'Always', cur.battery)}${opt('off', 'Off', cur.battery)}</select>
    <div class="settings-note">View, map, opponent, difficulty and match start a new game.</div>
    <button type="button" class="settings-link" data-s="forget">Forget saved API key</button>
    <div class="settings-buttons"><button type="button" data-s="cancel">Cancel</button><button type="button" data-s="apply">Apply</button></div>`;
  root.appendChild(panel);
  const pick = (id: string) => panel.querySelector<HTMLSelectElement>(`#${id}`)!.value;
  panel.querySelector<HTMLButtonElement>('[data-s="cancel"]')!.onclick = () => { panel.hidden = true; };
  panel.querySelector<HTMLButtonElement>('[data-s="forget"]')!.onclick = (e) => {
    settings.forgetKey();
    (e.currentTarget as HTMLButtonElement).textContent = 'API key forgotten';
  };
  panel.querySelector<HTMLButtonElement>('[data-s="apply"]')!.onclick = () => {
    const next: Required<GameSettings> = {
      renderer: pick('set-renderer'), map: pick('set-map'), ai: pick('set-ai'), quick: pick('set-quick') === 'quick',
      vibrate: pick('set-vibrate') === 'on', battery: pick('set-battery') as BatterySaver, difficulty: pick('set-difficulty'),
    };
    saveSettings(next);
    const newGame = next.renderer !== cur.renderer || next.map !== cur.map || next.ai !== cur.ai || next.quick !== cur.quick || next.difficulty !== cur.difficulty;
    if (newGame) { settings.onNewGame(); location.reload(); return; }
    Object.assign(cur, next);
    settings.onLiveChange(next);
    panel.hidden = true;
  };
  const btn = (a: string) => bar.querySelector<HTMLButtonElement>(`[data-a="${a}"]`)!;
  let boxMode = false;
  btn('pause').onclick = actions.togglePause;
  btn('speed').onclick = actions.cycleSpeed;
  btn('deselect').onclick = actions.deselect;
  btn('fit').onclick = actions.fit;
  btn('idle').onclick = actions.idleWorker;
  btn('army').onclick = actions.army;
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

/** Battery saver: on, off, or on while the phone is low (under 30%) and not charging. */
export async function batterySaverActive(mode: BatterySaver): Promise<boolean> {
  if (mode !== 'auto') return mode === 'on';
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
    const b = await nav.getBattery?.();
    return !!b && !b.charging && b.level < 0.3;
  } catch { return false; }
}

/** Asks whether to resume a saved match (phones close apps in the background). */
export function promptResume(summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'resume-prompt';
    el.innerHTML = `<div class="hud-panel"><h2>Resume your game?</h2><p>${summary}</p>
      <div class="settings-buttons"><button type="button" data-r="new">New game</button><button type="button" data-r="resume">Resume</button></div></div>`;
    document.body.append(el);
    const done = (yes: boolean) => { el.remove(); resolve(yes); };
    el.querySelector<HTMLButtonElement>('[data-r="resume"]')!.onclick = () => done(true);
    el.querySelector<HTMLButtonElement>('[data-r="new"]')!.onclick = () => done(false);
  });
}
