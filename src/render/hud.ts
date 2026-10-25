// HTML overlay: resources, selection, messages, hotkeys, and the text view. Plain DOM keeps it readable,
// scalable and screen-reader friendly.
import { BUILDINGS, construction, describeView, MILLI, powerHeadroom, TICK_RATE, training, type FactionView, type World } from '../sim/index.ts';
import { pretty, type CardButton } from './card.ts';
import { renderGuide } from './guide.ts';
import { jobText } from './jobs.ts';
import { HOTKEYS } from './input.ts';
import { word } from './wording.ts';

export interface Hud {
  update(world: World, view: FactionView, selected: Set<number>, modeText: string, speed: number, paused: boolean, fps: number): void;
  message(text: string): void;
  toggleTextView(): void;
  setCard(buttons: CardButton[], onPress: (b: CardButton) => void): void;
  tooltip(text: string | null, sx: number, sy: number): void;
  showStart(onStart: () => void): void;
  /** `at`: where it happened; the alert is then tappable and jumps the camera there. */
  alert(text: string, at?: [number, number]): void;
  onAlertTap(fn: (at: [number, number]) => void): void;
  setIntel(html: string): void;
  /** Replace the end-of-match banner with the post-match summary; `attach` wires up its interactivity. */
  showSummary(html: string, attach: (el: HTMLElement) => void): void;
  onNarrowSelection(fn: (ids: number[]) => void): void;
  /** Called with every alert line as it is raised (sound cues, #4). */
  onAlert(fn: (text: string) => void): void;
  /** Wires the sound on/off button: `toggle` flips it and returns whether sounds are now on. */
  setSoundToggle(on: boolean, toggle: () => boolean): void;
}

export const POWER_FULL_ALERT = '⚡ Power full: new units will wait. Claim substations for more Power.';

export function createHud(root: HTMLElement, aiName: string): Hud {
  root.innerHTML = `
    <div id="hud-top" class="hud-panel">
      <span class="t-time"><i class="ico"></i><span id="t-time"></span></span>
      <span class="t-state" id="t-state"></span>
      <span class="t-data" title="Data: spend on units and buildings"><i class="ico"></i><i class="lbl">Data</i> <b id="t-data"></b> <span class="inc" id="t-inc"></span></span>
      <span class="t-power" title="Power is your unit limit: every unit and building draws Power; your NOC and each substation you hold supply it. When it's full, new units wait."><i class="ico"></i><i class="lbl">Power</i> <span id="t-power"></span></span>
      <span class="t-compute" title="Compute: training speed, shared by all your buildings that are training. Server Racks add 5; extra SOCs add nothing."><i class="ico"></i><i class="lbl">Compute</i> <b id="t-compute"></b></span>
      <span class="t-plug" title="Pull the Plug: black out a zone, freezing AI units and unpowering buildings"><i class="ico"></i><i class="lbl">Plug</i> <span id="t-plug"></span></span>
      <span class="dim t-meta" id="t-meta"></span>
      <button type="button" id="t-sound" title="Alert sounds on/off (N)"></button>
    </div>
    <div id="hud-mode" class="hud-panel"></div>
    <div id="hud-messages"></div>
    <div id="hud-alerts"></div>
    <div id="hud-intel" class="hud-panel"></div>
    <div id="hud-selection" class="hud-panel"></div>
    <div id="hud-guide" class="hud-panel"></div>
    <div id="hud-card" class="hud-panel"></div>
    <div id="hud-tip" hidden></div>
    <div id="hud-start" hidden></div>
    <details id="hud-help" class="hud-panel"><summary>Keyboard shortcuts</summary><table>${
      HOTKEYS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')
    }</table></details>
    <pre id="hud-text" class="hud-panel" hidden></pre>
    <div id="hud-banner" hidden></div>`;
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  $('hud-alerts').addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.jump');
    if (el) onAlertTap([Number(el.dataset.x), Number(el.dataset.y)]);
  });
  const messages: { text: string; at: number }[] = [];
  // Write to the DOM only when content changes: rewriting every frame causes needless repaints.
  const shown = new Map<string, string>();
  const setHtml = (id: string, html: string) => { if (shown.get(id) !== html) { shown.set(id, html); $(id).innerHTML = html; } };
  let showText = false;
  let lastTextTick = -1;
  let cardKey = '';
  let selKey: string | null = null;
  let onNarrow: (ids: number[]) => void = () => {};
  let onAlert: (text: string) => void = () => {};
  const icon: Record<string, string> = { worker: '●', fast: '▲', ranged: '◆', tank: '■' };
  const bar = (hp: number, max: number) => {
    const f = Math.max(0, Math.min(1, hp / max));
    const c = f > 0.6 ? '#55d27a' : f > 0.3 ? '#ffd866' : '#e5534b';
    return `<span class="bar"><span style="width:${Math.round(f * 100)}%;background:${c}"></span></span>`;
  };
  /** Selection panel: total count, one clickable row per unit type with combined health. */
  function renderSelection(v: FactionView, selected: Set<number>): void {
    const units = v.units.filter((u) => selected.has(u.id));
    const b = v.buildings.find((x) => selected.has(x.id));
    const t = b ? training(v, b) : null;
    const c = b ? construction(v, b) : null;
    const key = units.map((u) => `${u.id}:${u.hp}:${JSON.stringify(u.job)}`).join(',') + (b ? `b${b.id}:${b.hp}:${b.queue.length}:${b.built}:${JSON.stringify(t)}:${JSON.stringify(c)}` : '');
    if (key === selKey) return;
    selKey = key;
    const el = $('hud-selection');
    if (units.length) {
      const groups = new Map<string, typeof units>();
      for (const u of units) groups.set(u.type, [...(groups.get(u.type) ?? []), u]);
      el.innerHTML = `<div class="sel-head">Selected: <b>${units.length}</b> unit${units.length === 1 ? '' : 's'}</div>`
        + [...groups].map(([t, list]) => {
          const hp = list.reduce((s, u) => s + u.hp, 0);
          const max = list.reduce((s, u) => s + u.maxHp, 0);
          return `<button type="button" class="sel-row" data-type="${t}" title="Click to keep only these">`
            + `<span class="ico">${icon[list[0]!.role]}</span> ${list.length} × ${pretty(t)} ${bar(hp, max)} <span class="dim">${hp}/${max}</span></button>`;
        }).join('')
        // What each selected worker is doing (up to 6), so nobody gets pulled off a job by mistake.
        + units.filter((u) => u.role === 'worker').slice(0, 6).map((u) => `<div class="job">${icon.worker} ${jobText(u, v)}</div>`).join('')
        + (units.some((u) => u.job && u.job.kind !== 'build')
          ? '<div class="dim">Giving a new order resets claim and fiber progress.</div>' : '');
      for (const row of el.querySelectorAll<HTMLButtonElement>('.sel-row')) {
        row.addEventListener('click', () => onNarrow(units.filter((u) => u.type === row.dataset.type).map((u) => u.id)));
      }
    } else if (b) {
      el.innerHTML = `<div class="sel-head">${pretty(b.type)}</div>`
        + (c ? `<div>${constructionText(c)}</div>` : '')
        + `${bar(b.hp, BUILDINGS[b.type].hp)} <span class="dim">${b.hp}/${BUILDINGS[b.type].hp} hp</span>`
        + (t ? `<div>${trainingText(t)}</div>` : '');
    } else {
      el.innerHTML = `<span class="dim">${word('Nothing selected. Drag a box or click a unit.')}</span>`;
    }
  }
  let intelHtml = '';
  const alerts: { text: string; at: number; where?: [number, number] }[] = [];
  let onAlertTap: (at: [number, number]) => void = () => {};
  let guideKey = '';
  let powerWasFull = false;
  let summaryShown = false;
  let powerAlertAt = -Infinity;
  let fpsAt = -Infinity;
  let fpsShown = 0;

  return {
    update(world, v, selected, modeText, speed, paused, fps) {
      const secs = Math.trunc(world.tick / TICK_RATE);
      // The bar's layout is fixed; only values that changed are written, so nothing shifts or repaints
      // needlessly. The fps reading refreshes twice a second.
      const now0 = performance.now();
      if (now0 - fpsAt > 500) { fpsAt = now0; fpsShown = fps; }
      setHtml('t-time', `${Math.trunc(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
      setHtml('t-state', `${paused ? 'PAUSED' : ''}${paused && speed !== 1 ? ' ' : ''}${speed !== 1 ? `×${speed}` : ''}`);
      setHtml('t-data', String(Math.trunc(v.data / MILLI)));
      setHtml('t-inc', `+${((v.income * TICK_RATE) / MILLI).toFixed(1)}/s`);
      setHtml('t-power', `<b${powerHeadroom(v) === 0 ? ' class="warn"' : ''}>${v.powerUsed}/${v.powerCap}${powerHeadroom(v) === 0 ? ' FULL' : ''}</b>`);
      setHtml('t-compute', String(v.compute));
      setHtml('t-plug', `<b${v.plugReadyIn === 0 ? ' class="ready"' : ''}>${v.plugReadyIn === 0 ? 'READY' : `${Math.ceil((v.plugReadyIn ?? 0) / TICK_RATE)}s`}</b>`);
      setHtml('t-meta', `vs ${aiName} · ${fpsShown} fps`);
      $('hud-mode').textContent = modeText;
      $('hud-mode').hidden = !modeText;

      renderSelection(v, selected);

      // Warn once each time Power fills up: new units wait in their building until there is Power for them.
      const powerFull = powerHeadroom(v) === 0;
      if (powerFull && !powerWasFull && performance.now() - powerAlertAt > 30_000) {
        powerAlertAt = performance.now();
        alerts.push({ text: POWER_FULL_ALERT, at: powerAlertAt });
        onAlert(POWER_FULL_ALERT);
      }
      powerWasFull = powerFull;

      const now = performance.now();
      while (messages.length && now - messages[0]!.at > 4000) messages.shift();
      while (alerts.length && now - alerts[0]!.at > 6000) alerts.shift();
      setHtml('hud-alerts', alerts.map((m) => (m.where ? `<div class="jump" data-x="${m.where[0]}" data-y="${m.where[1]}" title="Show me">${m.text} <span class="dim">▸ show</span></div>` : `<div>${m.text}</div>`)).join(''));
      setHtml('hud-messages', messages.map((m) => `<div>${m.text}</div>`).join(''));

      // Re-render the guide only when progress changes (keeps text selectable and cheap).
      const gk = `${v.income > 0}|${v.units.length}|${v.buildings.length}|${v.sites.filter((x) => x.owner === v.faction).length}`;
      if (gk !== guideKey) { guideKey = gk; renderGuide($('hud-guide'), v); }

      if (showText && world.tick !== lastTextTick && world.tick % 10 === 0) {
        lastTextTick = world.tick;
        $('hud-text').textContent = describeView(v);
      }
      if (world.winner && !summaryShown) {
        $('hud-banner').hidden = false;
        $('hud-banner').innerHTML = world.winner === 'human'
          ? '<span style="color:var(--human)">The network holds.</span> <b>Humans win.</b><br><small>Reload to play again.</small>'
          : '<span style="color:var(--ai)">The Model has taken the network.</span> <b>AI wins.</b><br><small>Reload to play again.</small>';
      }
    },
    showSummary(html, attach) {
      summaryShown = true;
      const el = $('hud-banner');
      el.hidden = false;
      el.classList.add('has-summary');
      el.innerHTML = html;
      attach(el);
    },
    message(text) {
      messages.push({ text, at: performance.now() });
      if (messages.length > 4) messages.shift();
    },
    setCard(buttons, onPress) {
      // Rebuild only when buttons change, so hovering and clicking stay stable.
      const key = buttons.map((b) => `${b.id}:${b.disabled ?? ''}`).join('|');
      if (key === cardKey) return;
      cardKey = key;
      const el = $('hud-card');
      el.innerHTML = '';
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.kind = b.id.startsWith('train:') ? 'train' : b.id.startsWith('build:') ? 'build' : b.id === 'plug' ? 'plug' : b.id.startsWith('group:') ? 'group' : 'order';
        btn.innerHTML = `<span class="label">${b.label}</span>`
          + (b.cost ? `<span class="cost">${Math.trunc(b.cost / MILLI)}</span>` : '')
          + (b.key ? `<kbd>${b.key}</kbd>` : '');
        btn.title = b.disabled ? `${b.tip}

(${b.disabled})` : b.tip;
        btn.disabled = !!b.disabled;
        btn.addEventListener('click', () => onPress(b));
        el.appendChild(btn);
      }
    },
    tooltip(text, sx, sy) {
      const tip = $('hud-tip');
      tip.hidden = !text;
      if (!text) return;
      tip.textContent = text;
      tip.style.left = `${sx + 16}px`;
      tip.style.top = `${sy + 16}px`;
    },
    showStart(onStart) {
      const el = $('hud-start');
      el.hidden = false;
      el.innerHTML = word(`<div class="eyebrow">Real-time strategy · Metro region network</div>
        <h1>AI Cyberwar</h1>
        <div class="sides">
          <div class="side you"><h2>You · Human ops team</h2><p>Engineers, security operators and vehicles. Blue, on the left.</p></div>
          <div class="side them"><h2>Enemy · The Model</h2><p>A rogue AI driving hijacked machines. Orange, on the right, hidden by fog.</p></div>
        </div>
        <p class="how"><b>Goal:</b> destroy the AI's Primary Cluster before it destroys your NOC. Claim Data Sources, connect them to your base with fiber, build a SOC, train an army, attack.</p>
        <button type="button" id="start-btn" class="btn primary">Start</button>
        <div class="hint">The checklist on the left walks you through it. Hover anything on the map to learn what it is.</div>`);
      el.querySelector('#start-btn')!.addEventListener('click', () => { el.hidden = true; onStart(); });
    },
    alert(text, where) {
      alerts.push({ text, at: performance.now(), ...(where ? { where } : {}) });
      if (alerts.length > 3) alerts.shift();
      onAlert(text);
    },
    onNarrowSelection(fn) { onNarrow = fn; },
    onAlertTap(fn) { onAlertTap = fn; },
    onAlert(fn) { onAlert = fn; },
    setSoundToggle(on, toggle) {
      const btn = $('t-sound');
      const label = (v: boolean) => { btn.textContent = v ? '🔔 Sounds' : '🔕 Muted'; btn.setAttribute('aria-pressed', String(v)); };
      label(on);
      btn.onclick = () => label(toggle());
    },
    setIntel(html) {
      if (html === intelHtml) return;
      intelHtml = html;
      $('hud-intel').innerHTML = html;
    },
    toggleTextView() {
      showText = !showText;
      $('hud-text').hidden = !showText;
      lastTextTick = -1;
    },
  };
}

/** "Training Red Team: 6s (+2 queued)", or a Power warning when the finished unit can't come online. */
export function trainingText(t: NonNullable<ReturnType<typeof training>>): string {
  const when = t.waitingForPower ? '<b class="warn">waiting for Power</b>' : `<b>${t.seconds}s</b>`;
  return `Training ${pretty(t.unit)}: ${when}${t.queued ? ` <span class="dim">(+${t.queued} queued)</span>` : ''}`;
}

/** "Building: 45% · 8s (2 engineers)", or a warning when no engineer is assigned. */
export function constructionText(c: NonNullable<ReturnType<typeof construction>>): string {
  const eta = c.seconds === null
    ? `<b class="warn">paused: no engineers building it</b> <span class="dim">(${word('select engineers, right-click it')})</span>`
    : `<b>${c.seconds}s</b> <span class="dim">(${c.builders} engineer${c.builders === 1 ? '' : 's'}; more build faster)</span>`;
  return `Building: <b>${c.percent}%</b> · ${eta}`;
}
