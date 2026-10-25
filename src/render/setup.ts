// The setup screen before a match: pick the opponent, how hard it plays, the map, the view and the
// match length, then Start. Shown before the game is created, so choices apply without a reload.
import { DIFFICULTIES, DIFFICULTY, type Difficulty } from '../ai/difficulty.ts';

export interface SetupChoice {
  ai: string;
  difficulty: Difficulty;
  map: string;
  renderer: string;
  quick: boolean;
}

const OPPONENT_TEXT: Record<string, [string, string]> = {
  training: ['Training', 'Gentle: a slow economy and a late first attack. Learn the game here.'],
  rush: ['Rush', 'Early attacks with fast units. Defend first, then counter.'],
  boom: ['Boom', 'Builds a big economy, then a big army.'],
  turtle: ['Turtle', 'Walls and defenses first, a slow and heavy push.'],
  brutal: ['Brutal', 'A fast army with full micro from minute one. For veterans.'],
  llm: ['AI General', 'A language model commands the AI, through your own OpenAI API key.'],
};

const VIEWS: [string, string][] = [['pixi', 'Top-down'], ['iso', 'Isometric'], ['three', '3D']];

export function promptSetup(current: SetupChoice, maps: { id: string; name: string }[], opponents: string[], touch: boolean): Promise<SetupChoice> {
  return new Promise((resolve) => {
    const choice = { ...current };
    const el = document.createElement('div');
    el.id = 'game-setup';
    const chips = (group: keyof SetupChoice, items: [string, string][]) =>
      `<div class="chips" role="radiogroup" data-group="${group}">${items.map(([v, label]) =>
        `<button type="button" role="radio" data-v="${v}">${label}</button>`).join('')}</div>`;
    el.innerHTML = `
      <div class="eyebrow">Real-time strategy · Metro region network</div>
      <h1>AI Cyberwar</h1>
      <div class="sides">
        <div class="side you"><h2>You · Human ops team</h2><p>Engineers, security operators and vehicles. Blue, on the left.</p></div>
        <div class="side them"><h2>Enemy · The Model</h2><p>A rogue AI driving hijacked machines. Orange, on the right, hidden by fog.</p></div>
      </div>
      <div class="setup-grid">
        <div class="setup-row"><span class="setup-label">Opponent</span>${chips('ai', opponents.filter((o) => OPPONENT_TEXT[o]).map((o) => [o, OPPONENT_TEXT[o]![0]]))}<p class="setup-note" data-note="ai"></p></div>
        <div class="setup-row"><span class="setup-label">Difficulty</span>${chips('difficulty', DIFFICULTIES.map((d) => [d, DIFFICULTY[d].label]))}<p class="setup-note" data-note="difficulty"></p></div>
        <div class="setup-row"><span class="setup-label">Map</span>${chips('map', maps.map((m) => [m.id, m.name]))}</div>
        <div class="setup-row"><span class="setup-label">View</span>${chips('renderer', VIEWS)}</div>
        <div class="setup-row"><span class="setup-label">Match</span>${chips('quick', [['std', 'Standard'], ['quick', 'Quick']])}</div>
      </div>
      <p class="how"><b>Goal:</b> destroy the AI's Primary Cluster before it destroys your NOC. Claim Data Sources, connect them to your base with fiber, build a SOC, train an army, attack.</p>
      <button type="button" class="btn primary" data-start>Start</button>
      <div class="hint">${touch ? 'Press and hold' : 'Hover'} anything on the map to learn what it is. The checklist on the left walks you through your first match.</div>`;
    document.body.append(el);

    const value = (g: keyof SetupChoice) => (g === 'quick' ? (choice.quick ? 'quick' : 'std') : String(choice[g]));
    const refresh = () => {
      for (const group of el.querySelectorAll<HTMLElement>('.chips')) {
        const g = group.dataset.group as keyof SetupChoice;
        for (const b of group.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.v === value(g)));
      }
      el.querySelector<HTMLElement>('[data-note="ai"]')!.textContent = OPPONENT_TEXT[choice.ai]?.[1] ?? '';
      el.querySelector<HTMLElement>('[data-note="difficulty"]')!.textContent = DIFFICULTY[choice.difficulty].blurb;
    };
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.hasAttribute('data-start')) { el.remove(); resolve(choice); return; }
      const g = b.closest<HTMLElement>('.chips')?.dataset.group as keyof SetupChoice | undefined;
      if (!g || b.dataset.v === undefined) return;
      if (g === 'quick') choice.quick = b.dataset.v === 'quick';
      else if (g === 'difficulty') choice.difficulty = b.dataset.v as Difficulty;
      else choice[g] = b.dataset.v;
      refresh();
    });
    refresh();
    el.querySelector<HTMLButtonElement>('[data-start]')!.focus();
  });
}
