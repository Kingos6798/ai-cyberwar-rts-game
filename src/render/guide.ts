// Getting-started checklist. Each step checks itself off from the player's view of the game.
import type { FactionView } from '../sim/index.ts';
import { word } from './wording.ts';

export interface GuideStep {
  title: string;
  how: string;
  done: (v: FactionView) => boolean;
}

const owned = (v: FactionView, kind: string) => v.sites.filter((s) => s.kind === kind && s.owner === v.faction).length;

export const GUIDE: GuideStep[] = [
  {
    title: 'Claim a Data Source',
    how: 'Data Sources are the circles with a dot. Drag a box around your engineers (blue dots), then right-click a Data Source. Or click "Claim nearest site".',
    done: (v) => owned(v, 'data_source') > 0,
  },
  {
    title: 'Connect it to your base',
    how: 'Data travels over fiber. Select engineers and click "Connect fiber" (twice: NOC to router, router to source), or right-click the grey lines. Lit lines turn blue and income appears in the top bar.',
    done: (v) => v.income > 0,
  },
  {
    title: 'Grow your workforce',
    how: 'Click empty ground to deselect, then click "Train Field Engineer" (or select your NOC, the big blue square). Aim for 6 or more engineers.',
    done: (v) => v.units.filter((u) => u.role === 'worker').length >= 6,
  },
  {
    title: 'Build a SOC',
    how: 'Select an engineer, click "Build SOC", then click open ground near your base. The SOC trains your combat units.',
    done: (v) => v.buildings.some((b) => b.type === 'soc' && b.built),
  },
  {
    title: 'Train an army',
    how: 'Click the SOC and train units. Mix them: Counter-Drone Teams beat ranged, Red Teams beat tanks, Armored Vehicles beat fast units. Grab a Substation (lightning icon) for more Power.',
    done: (v) => v.units.filter((u) => u.role !== 'worker').length >= 6,
  },
  {
    title: 'Destroy the AI\'s Primary Cluster',
    how: 'Select your army and click "Attack AI base". When AI units bunch up, use Pull the Plug on them to freeze them.',
    done: () => false,
  },
];

export function renderGuide(el: HTMLElement, v: FactionView): void {
  const current = GUIDE.findIndex((s) => !s.done(v));
  const done = GUIDE.filter((s) => s.done(v)).length;
  el.innerHTML = `<div class="guide-title">Getting started<span class="guide-count">${done}/${GUIDE.length}</span></div>`
    + `<div class="guide-bar"><span style="width:${Math.round((done / GUIDE.length) * 100)}%"></span></div><ol>${GUIDE.map((s, i) => {
    const state = s.done(v) ? 'done' : i === current ? 'current' : 'todo';
    return `<li class="${state}">${s.title}${state === 'current' ? `<div class="how">${word(s.how)}</div>` : ''}</li>`;
  }).join('')}</ol>`;
}
