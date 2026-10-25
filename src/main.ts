// Browser entry: human plays through the UI; the AI faction is a scripted bot or the LLM General.
// URL options: ?ai=training|brutal|rush|boom|turtle&seed=123&stress=300 (stress spawns N fighting units to check frame rate)
// LLM General: ?ai=llm&model=qwen3:8b[&base=boom][&ollama=http://localhost:11434] (needs `ollama serve`; if the
// model is unreachable the General's base plays on as the scripted bot). Cloud (D-020): ?ai=llm&provider=openai
// [&model=...] asks for the player's own OpenAI key once per session; &newkey forgets a saved key. Blind test (Gate 2): ?ai=blind picks
// the LLM General or scripted boom at random, hides which and hides chat, and reveals it after the match.
// &renderer=pixi|three|iso picks the view (M4.0 renderer spike, D-017); pixi (top-down 2D) is the default.
// &map=duel|long picks the map (Duel is the default; Long Haul is longer, with two fiber routes).
// Testing: &human=rush|boom|turtle lets a bot play your side (to watch or screenshot), &autostart skips the start screen,
// &skip=60 fast-forwards 60 seconds before the first frame.
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import './ui.css';
import { createLlmBrain, createOllamaClient, type LlmClient } from './ai/llm/client.ts';
import { filterChat } from './ai/llm/filter.ts';
import { createGeneral } from './ai/llm/general.ts';
import { forgetKey, loadKey, saveKey, type KeyStorage } from './ai/llm/keystore.ts';
import { createOpenAiClient } from './ai/llm/openai.ts';
import { promptForKey } from './render/keyprompt.ts';
import { createScriptedBot, OPPONENTS, STRATEGIES, TRAINING } from './ai/scripted.ts';
import { createChatPanel } from './render/chat.ts';
import { createSession, tickSession } from './harness/session.ts';
import { createStats, recordStats } from './harness/stats.ts';
import { attachSummaryHover, summaryHtml } from './render/summary.ts';
import { createHud } from './render/hud.ts';
import { buildCard } from './render/card.ts';
import { createEffects, intel, updateEffects } from './render/effects.ts';
import { createMood, createMusic, fighting, updateMood } from './render/music.ts';
import { createMinimap, type MinimapCamera } from './render/minimap.ts';
import { createGroups, groupCenter, ownIds, recallGroup, saveGroup, tapGroup } from './render/groups.ts';
import { createSound, cueFor } from './render/sound.ts';
import { boxSelectWhere, describeAt, describeMode, key, modeClick, pickOwn, rightClick, sameTypeWhere, type UiState } from './render/input.ts';
import { batterySaverActive, createMobileBar, isTouchUi, loadSettings, promptResume, saveSettings, touchWords } from './render/mobile.ts';
import { promptSetup } from './render/setup.ts';
import { DIFFICULTY, isDifficulty } from './ai/difficulty.ts';
import { compatible, fastForward, snapshot, type SavedMatch } from './harness/resume.ts';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { createRenderer, rendererKind, viewport } from './render/renderer.ts';
import { createGestures, type Gesture } from './render/touch.ts';
import { setWording, word } from './render/wording.ts';
import { applyCommand, ECONOMY, factionView, issue, MAPS, spawnUnit, START, TICK_RATE, TILE, toReplay, type Command } from './sim/index.ts';

const params = new URLSearchParams(location.search);
// Phones close apps in the background: offer to pick up a saved match (scripted opponents only, see resume.ts).
const SAVE_KEY = 'ai-cyberwar-save';
const clock = (t: number) => `${Math.trunc(t / TICK_RATE / 60)}:${String(Math.trunc(t / TICK_RATE) % 60).padStart(2, '0')}`;
let resume: SavedMatch | null = null;
if (!params.has('seed') && !params.has('human') && !params.has('ai')) {
  let s: SavedMatch | null = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null'); } catch { /* storage blocked */ }
  if (s && compatible(s) && OPPONENTS[s.ai] && MAPS[s.mapId]
    && await promptResume(`${MAPS[s.mapId]!.name} against the ${s.ai} AI${s.difficulty ? ` (${s.difficulty})` : ''}${s.quick ? ', quick match' : ''}, at ${clock(s.tick)}.`)) resume = s;
}
// Setup screen: choose opponent, difficulty, map, view and match length before the game is created.
// Skipped when resuming, with ?autostart, or when the link already picks the opponent or seed.
const touchUi = isTouchUi(params);
const setupDone = !resume && !params.has('autostart') && !params.has('ai') && !params.has('seed') && !params.has('stress');
if (setupDone) {
  const s = loadSettings();
  const choice = await promptSetup({
    ai: s.ai && (OPPONENTS[s.ai] || s.ai === 'llm') ? s.ai : 'training',
    difficulty: isDifficulty(s.difficulty) ? s.difficulty : 'normal',
    map: s.map && MAPS[s.map] ? s.map : 'duel',
    renderer: s.renderer ?? 'pixi',
    quick: !!s.quick,
  }, Object.values(MAPS).map((m) => ({ id: m.id, name: m.name })), ['training', ...Object.keys(OPPONENTS).filter((o) => o !== 'training'), 'llm'], touchUi);
  saveSettings({ ...s, ...choice });
}
// The settings (setup screen or the phone menu) pick view, map, opponent and difficulty; URL options still win.
const saved = loadSettings();
let vibrateOn = saved.vibrate ?? true;
const savedLlm = !params.get('ai') && !resume && saved.ai === 'llm';
const aiParam = resume?.ai ?? params.get('ai') ?? (savedLlm ? 'llm' : saved.ai && OPPONENTS[saved.ai] ? saved.ai : 'training');
// Quick match (mobile port): a richer start and faster claiming, for short sessions on a phone.
const quick = resume ? resume.quick : params.has('quick') || !!saved.quick;
if (quick) {
  START.data = 600 * 1000;
  START.workers = 5;
  ECONOMY.claimTicks = 60;
  ECONOMY.lightLinkTicks = 40;
}
const blind = aiParam === 'blind';
// Outside the sim, so Math.random is fine: the blind pick must not be guessable from the seed.
const useLlm = aiParam === 'llm' || (blind && Math.random() < 0.5);
const baseStrategy = useLlm || blind ? STRATEGIES[params.get('base') ?? 'boom'] ?? STRATEGIES.boom! : OPPONENTS[aiParam] ?? TRAINING;
// Difficulty handicaps the AI only: slower reactions, fewer actions, less micro, a smaller economy.
const difficultyId = resume ? (isDifficulty(resume.difficulty) ? resume.difficulty : 'hard')
  : isDifficulty(params.get('difficulty')) ? params.get('difficulty') as 'easy' | 'normal' | 'hard'
  : isDifficulty(saved.difficulty) ? saved.difficulty : 'normal';
const level = DIFFICULTY[difficultyId];
const strategy = level.tweak(baseStrategy);
const seed = resume?.seed ?? Number(params.get('seed') ?? Date.now() % 100000);
const humanBot = STRATEGIES[params.get('human') ?? ''];
// Model names use only these characters; anything else is dropped (the name is shown in HTML).
const cloud = params.get('provider') === 'openai' || savedLlm;
let model = (params.get('model') ?? (cloud ? '' : 'qwen3:8b')).replace(/[^\w.:/-]/g, '');
const ollama = params.get('ollama');
let client: LlmClient | null = null;
// D-020: the player's own key, entered when needed, kept for the session (or on this device if they ask).
const keyStore = (s: () => Storage): KeyStorage => ({
  getItem: (k) => s().getItem(k), setItem: (k, v) => s().setItem(k, v), removeItem: (k) => s().removeItem(k),
});
const [keySession, keyLocal] = [keyStore(() => sessionStorage), keyStore(() => localStorage)];
if (useLlm && cloud) {
  const [session, local] = [keySession, keyLocal];
  if (params.has('newkey')) forgetKey(session, local);
  let apiKey = loadKey(session, local);
  if (!apiKey || !model) {
    const answer = await promptForKey(model, !apiKey);
    if (answer) {
      model = answer.model;
      if (!apiKey) { saveKey(answer.key, answer.remember, session, local); apiKey = answer.key; }
    }
  }
  if (apiKey && model) client = createOpenAiClient({ model, apiKey });
} else if (useLlm) {
  client = createOllamaClient({ model, think: false, ...(ollama ? { url: ollama } : {}) });
}
const general = client ? createGeneral('ai', createLlmBrain(client, 'ai'), strategy, { seed }) : null;
const aiName = blind ? 'AI (blind test)' : general ? `The Model (${model}) · ${level.label}` : `AI (${strategy.name}) · ${level.label}`;
// ?map=duel|long picks the map (#5); unknown ids fall back to Duel.
const mapParam = resume?.mapId ?? params.get('map') ?? saved.map ?? '';
const mapId = MAPS[mapParam] ? mapParam : 'duel';
const session = createSession({ seed, mapId, pacing: { ai: { apm: level.apm, reactionDelay: level.reactionDelay } }, controllers: {
  ai: general ?? createScriptedBot('ai', strategy, seed),
  ...(humanBot ? { human: createScriptedBot('human', humanBot, seed) } : {}),
} });
const { game } = session;
const { world } = game;

for (let i = 0; i < Number(params.get('skip') ?? 0) * TICK_RATE; i++) tickSession(session);

const stress = Number(params.get('stress') ?? 0);
if (stress > 0) {
  // Gate 1 performance check: N units fighting in the middle of the map.
  for (const [faction, type, x] of [['human', 'red_team', 18], ['ai', 'botnet_swarm', 30]] as const) {
    const ids: number[] = [];
    for (let i = 0; i < stress / 2; i++) ids.push(spawnUnit(world, type, faction, (x + (i % 6)) * TILE, (4 + Math.trunc(i / 6) % 24) * TILE).id);
    applyCommand(world, faction, { type: 'attackMove', units: ids, x: (48 - x) * TILE, y: 16 * TILE });
  }
}

// Mobile port: phones get touch controls, a toolbar and a compact layout (CSS: body.touch).
if (touchUi) {
  document.body.classList.add('touch');
  setWording(touchWords);
}

const kind = rendererKind(params.get('renderer') ?? saved.renderer ?? null);
const renderer = await createRenderer(kind, world.map.width, world.map.height);
renderer.fit();
const fx = createEffects();

const hudRoot = document.createElement('div');
hudRoot.id = 'hud';
document.body.appendChild(hudRoot);
const hud = createHud(hudRoot, aiName);
const chat = createChatPanel(hudRoot, 'The Model', TICK_RATE);

const ui: UiState = { selected: new Set(), mode: { type: 'none' } };
const groups = createGroups();
hud.onNarrowSelection((ids) => { ui.selected = new Set(ids); });
let cursor: [number, number] = [0, 0];
let dragStart: [number, number] | null = null;
let panLast: [number, number] | null = null;
let paused = stress === 0 && !setupDone && (!params.has('autostart') || resume !== null);
// Alert sounds (#4) wait for the Start click; with ?autostart, for the first click or key press.
const sound = createSound();
let waitingForStart = paused && !resume;
// The setup screen's Start click already unlocked audio.
if (setupDone) sound.start();
if (waitingForStart) hud.showStart(() => { paused = false; waitingForStart = false; sound.start(); });
hud.onAlert((text) => { const cue = cueFor(text); if (cue) sound.play(cue, performance.now()); });
const toggleSound = () => { const on = sound.toggleMute(); hud.message(on ? '🔔 Alert sounds on' : '🔕 Alert sounds off'); return on; };
hud.setSoundToggle(!sound.muted, toggleSound);
const SPEEDS = [0.5, 1, 2, 4];
let speed = 1;

/** Human commands apply on the next tick; rejections show up as HUD messages. */
function send(cmds: Command[]): void {
  for (const c of cmds) issue(game, 'human', c);
}

/** Whether a ground point shows up inside a screen rectangle (works for tilted and isometric views too). */
function onScreenIn(x0: number, y0: number, x1: number, y1: number) {
  const [lx, hx, ly, hy] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
  return (x: number, y: number) => {
    const [sx, sy] = renderer.toScreen(x, y);
    return sx >= lx && sx <= hx && sy >= ly && sy <= hy;
  };
}

const canvas = renderer.canvas;
/** Move the camera so a ground point sits in the middle of the map viewport (twice, to settle tilted views). */
function centerOn(x: number, y: number): void {
  const vp = viewport(canvas.clientWidth, canvas.clientHeight);
  for (let i = 0; i < 2; i++) {
    const [sx, sy] = renderer.toScreen(x, y);
    renderer.pan(vp.left + vp.width / 2 - sx, vp.top + vp.height / 2 - sy);
  }
}
const minimapCamera: MinimapCamera = {
  toWorld: (sx, sy) => renderer.toWorld(sx, sy),
  corners: () => {
    const vp = viewport(canvas.clientWidth, canvas.clientHeight);
    const [l, t, r, b] = [vp.left, vp.top, vp.left + vp.width, vp.top + vp.height];
    return [[l, t], [r, t], [r, b], [l, b]];
  },
};
const minimap = createMinimap(hudRoot, world.map.width, world.map.height, {
  // Phones: a smaller minimap tucked under the toolbar (mobile port).
  ...(touchUi ? { maxWidth: 140, maxHeight: 90 } : {}),
  onCenter: centerOn,
  onAction: (x, y) => {
    if (ui.mode.type !== 'none') { ui.mode = { type: 'none' }; return; }
    send(rightClick(factionView(world, 'human'), ui, x, y));
  },
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return; // touch: see the gesture handlers below
  const p = renderer.toWorld(e.offsetX, e.offsetY);
  if (e.button === 1) { panLast = [e.offsetX, e.offsetY]; return; }
  if (e.button === 2) {
    if (ui.mode.type !== 'none') { ui.mode = { type: 'none' }; return; }
    send(rightClick(factionView(world, 'human'), ui, p[0], p[1]));
    return;
  }
  if (ui.mode.type !== 'none') { send(modeClick(factionView(world, 'human'), ui, p[0], p[1])); return; }
  dragStart = [e.offsetX, e.offsetY];
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  cursor = renderer.toWorld(e.offsetX, e.offsetY);
  hud.tooltip(dragStart || panLast ? null : describeAtWords(factionView(world, 'human'), cursor[0], cursor[1]), e.clientX, e.clientY);
  if (panLast) {
    renderer.pan(e.offsetX - panLast[0], e.offsetY - panLast[1]);
    panLast = [e.offsetX, e.offsetY];
  }
  renderer.setBox(dragStart ? { x0: dragStart[0], y0: dragStart[1], x1: e.offsetX, y1: e.offsetY } : null);
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') return;
  panLast = null;
  renderer.setBox(null);
  if (!dragStart || e.button !== 0) return;
  const view = factionView(world, 'human');
  const small = Math.abs(e.offsetX - dragStart[0]) + Math.abs(e.offsetY - dragStart[1]) < 6;
  if (!e.shiftKey) ui.selected.clear();
  if (small) {
    const [bx, by] = renderer.toWorld(e.offsetX, e.offsetY);
    const id = pickOwn(view, bx, by);
    if (id !== null) ui.selected.add(id);
  } else {
    for (const id of boxSelectWhere(view, onScreenIn(dragStart[0], dragStart[1], e.offsetX, e.offsetY))) ui.selected.add(id);
  }
  dragStart = null;
});
canvas.addEventListener('dblclick', (e) => {
  if (touchUi) return; // phones synthesize dblclick from taps; double tap is handled by the gestures
  // Select every unit of the clicked type that is on screen (shift adds to the selection).
  const view = factionView(world, 'human');
  const [x, y] = renderer.toWorld(e.offsetX, e.offsetY);
  const id = pickOwn(view, x, y);
  if (id === null) return;
  const ids = sameTypeWhere(view, id, onScreenIn(0, 0, canvas.clientWidth, canvas.clientHeight));
  if (ids.length === 0) return;
  if (!e.shiftKey) ui.selected.clear();
  for (const i of ids) ui.selected.add(i);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

const describeAtWords = (v: Parameters<typeof describeAt>[0], x: number, y: number) => {
  const text = describeAt(v, x, y);
  return text === null ? null : word(text);
};

// Touch (mobile port). Tap: select your own unit or building, else order the selection there (the
// right click), or place/aim when a mode is active. Double tap: every unit of that type on screen.
// Long press: what is this? One finger drags the map (or a selection box with ⬚ Box on); two fingers
// pan and pinch-zoom. Everything goes through the same command functions as the mouse.
const gestures = createGestures({
  boxMode: () => mobileBar?.boxMode ?? false,
  // A drag that starts on one of your selected units is an order: release on the target.
  commandFrom: (sx, sy) => {
    const [x, y] = renderer.toWorld(sx, sy);
    const view = factionView(world, 'human');
    const hit = pickOwn(view, x, y, fingerRadius());
    return hit !== null && ui.selected.has(hit) && view.units.some((u) => u.id === hit);
  },
});
const orderLine = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
orderLine.id = 'order-line';
orderLine.innerHTML = '<line stroke="#55ff99" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round"/><circle r="10" fill="none" stroke="#55ff99" stroke-width="3"/>';
orderLine.style.display = 'none';
hudRoot.appendChild(orderLine);
function drawOrderLine(g: { x0: number; y0: number; x1: number; y1: number } | null): void {
  orderLine.style.display = g ? '' : 'none';
  if (!g) return;
  const line = orderLine.querySelector('line')!;
  const ring = orderLine.querySelector('circle')!;
  line.setAttribute('x1', String(g.x0)); line.setAttribute('y1', String(g.y0));
  line.setAttribute('x2', String(g.x1)); line.setAttribute('y2', String(g.y1));
  ring.setAttribute('cx', String(g.x1)); ring.setAttribute('cy', String(g.y1));
}
let tipTimer = 0;
/** World units per screen pixel right now, so finger-sized hit areas follow the zoom. */
const worldPerPx = () => Math.abs(renderer.toWorld(100, 0)[0] - renderer.toWorld(0, 0)[0]) / 100;
const fingerRadius = () => Math.max(700, Math.round(worldPerPx() * 30));
function onGesture(g: Gesture): void {
  const view = factionView(world, 'human');
  switch (g.type) {
    case 'tap': {
      const [x, y] = renderer.toWorld(g.x, g.y);
      cursor = [x, y];
      if (ui.mode.type !== 'none') { send(modeClick(view, ui, x, y)); return; }
      const hit = pickOwn(view, x, y, fingerRadius());
      const building = hit === null ? undefined : view.buildings.find((b) => b.id === hit);
      const workersSelected = view.units.some((u) => ui.selected.has(u.id) && u.role === 'worker');
      // Engineers selected + tap your unfinished building = help build it (the right click), not select it.
      if (hit !== null && !(building && !building.built && workersSelected)) { ui.selected = new Set([hit]); return; }
      if (ui.selected.size > 0) send(rightClick(view, ui, x, y));
      else showTip(g.x, g.y, x, y);
      return;
    }
    case 'doubleTap': {
      const [x, y] = renderer.toWorld(g.x, g.y);
      const hit = pickOwn(view, x, y, fingerRadius());
      const ids = hit === null ? [] : sameTypeWhere(view, hit, onScreenIn(0, 0, canvas.clientWidth, canvas.clientHeight));
      if (ids.length > 0) ui.selected = new Set(ids);
      else onGesture({ ...g, type: 'tap' });
      return;
    }
    case 'longPress': {
      const [x, y] = renderer.toWorld(g.x, g.y);
      showTip(g.x, g.y, x, y);
      return;
    }
    case 'pan': renderer.pan(g.dx, g.dy); return;
    case 'pinch': renderer.zoomAt(g.x, g.y, g.factor); return;
    case 'boxStart': return;
    case 'box': renderer.setBox(g); return;
    case 'boxCancel': renderer.setBox(null); return;
    case 'boxEnd':
      renderer.setBox(null);
      ui.selected = new Set(boxSelectWhere(view, onScreenIn(g.x0, g.y0, g.x1, g.y1)));
      return;
    case 'commandStart': return;
    case 'command': drawOrderLine(g); return;
    case 'commandCancel': drawOrderLine(null); return;
    case 'commandEnd': {
      drawOrderLine(null);
      const [x, y] = renderer.toWorld(g.x1, g.y1);
      send(rightClick(view, ui, x, y));
    }
  }
}
function showTip(sx: number, sy: number, x: number, y: number): void {
  // Keep the tip (up to 70% of the screen wide) on screen near the right edge.
  hud.tooltip(describeAtWords(factionView(world, 'human'), x, y), Math.min(sx, window.innerWidth * 0.3 - 24), Math.max(0, sy - 60));
  clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => hud.tooltip(null, 0, 0), 2500);
}
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
  canvas.addEventListener(type, (e) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    const out = type === 'pointerdown' ? gestures.down(e.pointerId, e.offsetX, e.offsetY, e.timeStamp)
      : type === 'pointermove' ? gestures.move(e.pointerId, e.offsetX, e.offsetY, e.timeStamp)
        : type === 'pointerup' ? gestures.up(e.pointerId, e.offsetX, e.offsetY, e.timeStamp)
          : (gestures.cancel(e.pointerId), []);
    for (const g of out) onGesture(g);
  });
}
const mobileBar = touchUi ? createMobileBar(hudRoot, {
  togglePause: () => { paused = !paused; },
  cycleSpeed: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!; },
  deselect: () => { ui.selected.clear(); ui.mode = { type: 'none' }; },
  fit: () => renderer.fit(),
  onBoxMode: () => {},
  idleWorker: () => {
    // Each press jumps to the next idle engineer, so all of them can be put to work in turn.
    const idle = factionView(world, 'human').units.filter((u) => u.role === 'worker' && u.order === 'idle');
    if (idle.length === 0) { hud.message('No idle engineers'); return; }
    const u = idle[idleCycle++ % idle.length]!;
    ui.selected = new Set([u.id]);
    centerOn(u.x, u.y);
  },
  army: () => {
    const view = factionView(world, 'human');
    const ids = view.units.filter((u) => u.role !== 'worker').map((u) => u.id);
    if (ids.length === 0) { hud.message('No combat units yet'); return; }
    ui.selected = new Set(ids);
    const c = groupCenter(view, ids);
    if (c) centerOn(c[0], c[1]);
  },
}, {
  current: {
    renderer: kind, map: mapId, ai: useLlm && cloud ? 'llm' : OPPONENTS[aiParam] ? aiParam : 'training', quick,
    vibrate: vibrateOn, battery: saved.battery ?? 'auto', difficulty: difficultyId,
  },
  maps: Object.values(MAPS).map((m) => ({ id: m.id, name: m.name })),
  opponents: [...Object.keys(OPPONENTS), 'llm'],
  onLiveChange: (next) => { vibrateOn = next.vibrate; void batterySaverActive(next.battery).then((on) => { saver = on; }); },
  forgetKey: () => forgetKey(keySession, keyLocal),
  onNewGame: () => { discardSave = true; try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing saved */ } },
}) : null;
// Installed as an app (mobile port): cache the game for offline play. Production builds only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('offline cache unavailable', err));
}
// On a phone the checklist covers the map: tap it to fold it away and back.
if (touchUi) hudRoot.querySelector('#hud-guide')?.addEventListener('click', (e) => (e.currentTarget as HTMLElement).classList.toggle('collapsed'));

// Music needs a user gesture before it may play; the Start button click is the usual one.
const music = createMusic();
if (setupDone) music.start();
const mood = createMood();
window.addEventListener('pointerdown', () => { music.start(); if (!waitingForStart) sound.start(); });
window.addEventListener('keydown', () => { music.start(); if (!waitingForStart) sound.start(); });

const held = new Set<string>();
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.key.startsWith('Arrow')) { held.add(e.key); return; }
  if (k === ' ') { paused = !paused; e.preventDefault(); return; }
  if (k === '+' || k === '=') { speed = Math.min(4, speed * 2); return; }
  if (k === '-') { speed = Math.max(0.5, speed / 2); return; }
  if (k === 't') { hud.toggleTextView(); return; }
  if (k === 'm') { hud.message(music.toggleMute() ? '♪ Music on' : '♪ Music off'); return; }
  if (k === 'n') { hud.setSoundToggle(toggleSound(), toggleSound); return; }
  if (k === 'home') { renderer.fit(); return; }
  // Control groups (#3): Ctrl+1–9 saves the selection, 1–9 selects it, a double tap jumps the camera there.
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) {
    const n = Number(digit[1]);
    const view = factionView(world, 'human');
    const alive = ownIds(view);
    if (e.ctrlKey) {
      e.preventDefault();
      saveGroup(groups, n, [...ui.selected].filter((id) => alive.has(id)));
      hud.message(groups.groups.has(n) ? `Group ${n} saved` : `Group ${n} cleared`);
      return;
    }
    const ids = recallGroup(groups, n, alive);
    if (ids.length === 0) return;
    ui.selected = new Set(ids);
    const center = groupCenter(view, ids);
    if (center && tapGroup(groups, n, performance.now())) centerOn(center[0], center[1]);
    return;
  }
  if (e.ctrlKey && k === 'a') {
    e.preventDefault();
    ui.selected = new Set(factionView(world, 'human').units.filter((u) => u.role !== 'worker').map((u) => u.id));
    return;
  }
  send(key(factionView(world, 'human'), ui, world.map, k, cursor));
});

// Vibration (mobile port): a buzz when you're attacked or a unit is ready. Haptics falls back to the
// browser's vibration where there is no native app.
let lastBuzz = 0;
function buzz(style: ImpactStyle): void {
  if (!vibrateOn || !touchUi || performance.now() - lastBuzz < 1500) return;
  lastBuzz = performance.now();
  Haptics.impact({ style }).catch(() => {});
}
let armySize = factionView(world, 'human').units.filter((u) => u.role !== 'worker').length;

// Battery saver: draw at most 30 frames a second (the sim keeps its pace). Auto checks the battery each minute.
let saver = false;
const checkBattery = () => void batterySaverActive(loadSettings().battery ?? 'auto').then((on) => { saver = on; });
checkBattery();
setInterval(checkBattery, 60_000);
let lastDraw = 0;

// Auto-pause when the app goes to the background, and save so a closed app can resume (resume.ts).
let discardSave = false;
let idleCycle = 0;
const canSave = !general && !humanBot && stress === 0;
const aiKey = OPPONENTS[aiParam] ? aiParam : 'training';
function saveNow(): void {
  if (!canSave || discardSave) return;
  try {
    if (world.winner !== null) localStorage.removeItem(SAVE_KEY);
    else if (world.tick > 0) localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot(game, { seed, mapId, ai: aiKey, quick, difficulty: difficultyId })));
  } catch { /* storage full or blocked: no resume */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { paused = true; saveNow(); }
});
window.addEventListener('pagehide', saveNow);
setInterval(() => { if (!paused) saveNow(); }, 15_000);

// Tapping an alert jumps the camera to where it happened.
hud.onAlertTap(([x, y]) => centerOn(x, y));

// Fixed-timestep loop: the sim advances at TICK_RATE × speed regardless of frame rate.
let accumulator = 0;
let seenRejections = 0;
let seenTurns = 0;
let offlineWarned = false;
const stats = createStats();
let summaryShown = false;
let last = performance.now();
let fps = 60;
function frame(now: number): void {
  if (saver && now - lastDraw < 32) { requestAnimationFrame(frame); return; }
  lastDraw = now;
  const deltaMS = Math.min(250, now - last);
  last = now;
  if (deltaMS > 0) fps += (1000 / deltaMS - fps) * 0.05;

  // Arrow keys pan at 900 screen pixels per second.
  const pan = 900 * (deltaMS / 1000);
  renderer.pan((held.has('ArrowLeft') ? pan : 0) - (held.has('ArrowRight') ? pan : 0),
    (held.has('ArrowUp') ? pan : 0) - (held.has('ArrowDown') ? pan : 0));

  if (!paused && world.winner === null) {
    accumulator += deltaMS * speed;
    const msPerTick = 1000 / TICK_RATE;
    let steps = 0;
    while (accumulator >= msPerTick && steps++ < 8) {
      tickSession(session);
      recordStats(stats, world);
      accumulator -= msPerTick;
    }
    if (steps >= 8) accumulator = 0;
  }
  // The General's turns: taunts go to the chat panel (filtered); chat never becomes commands.
  for (; general && seenTurns < general.log.length; seenTurns++) {
    const turn = general.log[seenTurns]!;
    if (turn.fallback === 'error' && !offlineWarned) {
      offlineWarned = true;
      const note = `General offline (${turn.errors[0] ?? 'no reply'}): its base plays on as the scripted bot`;
      if (blind) console.warn(note); else hud.message(note);
    }
    if (!blind) for (const m of turn.chat) { const clean = filterChat(m); if (clean) chat.push(turn.tick, clean); }
  }
  for (; seenRejections < game.rejected.length; seenRejections++) {
    const r = game.rejected[seenRejections]!;
    if (r.cmd.faction === 'human' && !humanBot) hud.message(`✗ ${r.cmd.command.type}: ${r.reason}`);
  }

  const view = factionView(world, 'human');
  for (const id of ui.selected) if (!world.entities.has(id)) ui.selected.delete(id);
  for (const a of updateEffects(fx, view, now)) {
    hud.alert(a, fx.alertAt.get(a));
    const cue = cueFor(a);
    if (cue === 'attacked') buzz(ImpactStyle.Heavy);
    else if (cue === 'approaching' || cue === 'spotted') buzz(ImpactStyle.Medium);
  }
  const army = view.units.filter((u) => u.role !== 'worker').length;
  if (army > armySize) buzz(ImpactStyle.Light);
  armySize = army;
  music.setCombat(world.winner === null && updateMood(mood, fighting(view), now));
  renderer.render({ world, view, selected: ui.selected, fx, now });
  minimap.update(view, minimapCamera, now);
  hud.setIntel(intel(view));
  hud.update(world, view, ui.selected, word(describeMode(ui.mode)), speed, paused, Math.round(fps));
  mobileBar?.setPaused(paused);
  mobileBar?.setSpeed(speed);
  for (const gesture of gestures.tick(now)) onGesture(gesture);
  if (world.winner && !summaryShown) {
    summaryShown = true;
    const reveal = blind ? `<p><b>Blind test:</b> you played ${general ? `the LLM General (${model})` : `the scripted ${strategy.name} bot`}.</p>` : '';
    hud.showSummary(reveal + summaryHtml(stats, world.winner), (el) => {
      attachSummaryHover(el, stats);
      el.querySelector('#save-replay')?.addEventListener('click', () => {
        // Seed + command log + versions: enough to re-run the match exactly.
        const blob = new Blob([JSON.stringify(toReplay(game))], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `replay-${world.winner}-seed${seed}-${Math.trunc(world.tick / TICK_RATE)}s.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    });
  }
  hud.setCard(buildCard(view, ui, {
    setMode: (m) => { ui.mode = m; },
    select: (ids) => { ui.selected = new Set(ids); },
  }, groups), (b) => send(b.run()));
  requestAnimationFrame(frame);
}
if (resume) {
  fastForward(session, resume, () => recordStats(stats, world));
  renderer.fit();
  hud.message(`Resumed at ${clock(world.tick)}. Tap ▶ to play.`);
}
requestAnimationFrame(frame);
