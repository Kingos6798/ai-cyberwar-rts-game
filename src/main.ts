// Browser entry: human plays through the UI; the AI faction is a scripted bot or the LLM General.
// URL options: ?ai=training|brutal|rush|boom|turtle&seed=123&stress=300 (stress spawns N fighting units to check frame rate)
// LLM General: ?ai=llm&model=qwen3:8b[&base=boom][&ollama=http://localhost:11434] (needs `ollama serve`; if the
// model is unreachable the General's base plays on as the scripted bot). Blind test (Gate 2): ?ai=blind picks
// the LLM General or scripted boom at random, hides which and hides chat, and reveals it after the match.
// &renderer=pixi|three|iso picks the view (M4.0 renderer spike, D-017); pixi (top-down 2D) is the default.
// Testing: &human=rush|boom|turtle lets a bot play your side (to watch or screenshot), &autostart skips the start screen,
// &skip=60 fast-forwards 60 seconds before the first frame.
import { createLlmBrain, createOllamaClient } from './ai/llm/client.ts';
import { filterChat } from './ai/llm/filter.ts';
import { createGeneral } from './ai/llm/general.ts';
import { createScriptedBot, OPPONENTS, STRATEGIES, TRAINING } from './ai/scripted.ts';
import { createChatPanel } from './render/chat.ts';
import { createSession, tickSession } from './harness/session.ts';
import { createStats, recordStats } from './harness/stats.ts';
import { attachSummaryHover, summaryHtml } from './render/summary.ts';
import { createHud } from './render/hud.ts';
import { buildCard } from './render/card.ts';
import { createEffects, intel, updateEffects } from './render/effects.ts';
import { createMood, createMusic, fighting, updateMood } from './render/music.ts';
import { createSound, cueFor } from './render/sound.ts';
import { boxSelectWhere, describeAt, describeMode, key, modeClick, pickOwn, rightClick, sameTypeWhere, type UiState } from './render/input.ts';
import { createRenderer, rendererKind } from './render/renderer.ts';
import { applyCommand, factionView, issue, spawnUnit, TICK_RATE, TILE, toReplay, type Command } from './sim/index.ts';

const params = new URLSearchParams(location.search);
const aiParam = params.get('ai') ?? 'training';
const blind = aiParam === 'blind';
// Outside the sim, so Math.random is fine: the blind pick must not be guessable from the seed.
const useLlm = aiParam === 'llm' || (blind && Math.random() < 0.5);
const strategy = useLlm || blind ? STRATEGIES[params.get('base') ?? 'boom'] ?? STRATEGIES.boom! : OPPONENTS[aiParam] ?? TRAINING;
const seed = Number(params.get('seed') ?? Date.now() % 100000);
const humanBot = STRATEGIES[params.get('human') ?? ''];
// Ollama model names use only these characters; anything else is dropped (the name is shown in HTML).
const model = (params.get('model') ?? 'qwen3:8b').replace(/[^\w.:/-]/g, '');
const ollama = params.get('ollama');
const general = useLlm
  ? createGeneral('ai', createLlmBrain(createOllamaClient({ model, think: false, ...(ollama ? { url: ollama } : {}) }), 'ai'), strategy, { seed })
  : null;
const aiName = blind ? 'AI (blind test)' : general ? `The Model (${model})` : `AI (${strategy.name})`;
const session = createSession({ seed, controllers: {
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

const renderer = await createRenderer(rendererKind(params.get('renderer')), world.map.width, world.map.height);
renderer.fit();
const fx = createEffects();

const hudRoot = document.createElement('div');
hudRoot.id = 'hud';
document.body.appendChild(hudRoot);
const hud = createHud(hudRoot, aiName);
const chat = createChatPanel(hudRoot, 'The Model', TICK_RATE);

const ui: UiState = { selected: new Set(), mode: { type: 'none' } };
hud.onNarrowSelection((ids) => { ui.selected = new Set(ids); });
let cursor: [number, number] = [0, 0];
let dragStart: [number, number] | null = null;
let panLast: [number, number] | null = null;
let paused = stress === 0 && !params.has('autostart');
// Alert sounds (#4) wait for the Start click; with ?autostart, for the first click or key press.
const sound = createSound();
let waitingForStart = paused;
if (paused) hud.showStart(() => { paused = false; waitingForStart = false; sound.start(); });
hud.onAlert((text) => { const cue = cueFor(text); if (cue) sound.play(cue, performance.now()); });
const toggleSound = () => { const on = sound.toggleMute(); hud.message(on ? '🔔 Alert sounds on' : '🔕 Alert sounds off'); return on; };
hud.setSoundToggle(!sound.muted, toggleSound);
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
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
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
  cursor = renderer.toWorld(e.offsetX, e.offsetY);
  hud.tooltip(dragStart || panLast ? null : describeAt(factionView(world, 'human'), cursor[0], cursor[1]), e.clientX, e.clientY);
  if (panLast) {
    renderer.pan(e.offsetX - panLast[0], e.offsetY - panLast[1]);
    panLast = [e.offsetX, e.offsetY];
  }
  renderer.setBox(dragStart ? { x0: dragStart[0], y0: dragStart[1], x1: e.offsetX, y1: e.offsetY } : null);
});
window.addEventListener('pointerup', (e) => {
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

// Music needs a user gesture before it may play; the Start button click is the usual one.
const music = createMusic();
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
  if (e.ctrlKey && k === 'a') {
    e.preventDefault();
    ui.selected = new Set(factionView(world, 'human').units.filter((u) => u.role !== 'worker').map((u) => u.id));
    return;
  }
  send(key(factionView(world, 'human'), ui, world.map, k, cursor));
});

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
  for (const a of updateEffects(fx, view, now)) hud.alert(a);
  music.setCombat(world.winner === null && updateMood(mood, fighting(view), now));
  renderer.render({ world, view, selected: ui.selected, fx, now });
  hud.setIntel(intel(view));
  hud.update(world, view, ui.selected, describeMode(ui.mode), speed, paused, Math.round(fps));
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
  }), (b) => send(b.run()));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
