// Worker job feedback (playtest: "I can't tell what engineers are doing"). Map marks show work in
// progress where it happens; text helpers describe each job for panels and tooltips.
import type { Graphics } from 'pixi.js';
import { issueText, type FactionView, type Job, type UnitView } from '../sim/index.ts';
import { pretty } from './card.ts';

const WARN = 0xff7a59;
const IDLE = 0xffd866;

/** Draw progress marks for every own worker's job, plus a marker over idle workers. */
export function drawJobs(g: Graphics, view: FactionView, color: number, now: number): void {
  for (const u of view.units) {
    if (u.role !== 'worker') continue;
    const job = u.job;
    if (!job) {
      // Idle: a small yellow marker over the worker's head.
      const bob = Math.sin(now / 260 + u.id) * 60;
      g.poly([u.x, u.y - 1020 + bob, u.x + 170, u.y - 820 + bob, u.x, u.y - 620 + bob, u.x - 170, u.y - 820 + bob]).fill({ color: IDLE, alpha: 0.95 })
        .stroke({ width: 40, color: 0x04070c, alpha: 0.8 });
      continue;
    }
    if (!job.working) {
      // On the way: a faint line to where the work will happen.
      g.moveTo(u.x, u.y).lineTo(job.x, job.y).stroke({ width: 50, color, alpha: 0.35 });
      continue;
    }
    const f = Math.max(0, Math.min(1, job.progress / 100));
    if (job.kind === 'claim') {
      const r = 1000;
      g.circle(job.x, job.y, r).stroke({ width: 200, color: 0x0b0e12, alpha: 0.8 });
      if (job.contested) {
        // Contested: nobody progresses; pulse a warning ring.
        g.circle(job.x, job.y, r).stroke({ width: 200, color: WARN, alpha: 0.5 + 0.4 * Math.sin(now / 150) });
      } else if (f > 0) {
        const start = -Math.PI / 2;
        g.moveTo(job.x, job.y - r).arc(job.x, job.y, r, start, start + f * 2 * Math.PI).stroke({ width: 200, color });
      }
    } else if (job.kind === 'link' && job.toX !== undefined && job.toY !== undefined) {
      // Fiber lights up from the end being worked on toward the far end.
      const x = job.x + (job.toX - job.x) * f;
      const y = job.y + (job.toY - job.y) * f;
      g.moveTo(job.x, job.y).lineTo(x, y).stroke({ width: 140, color, alpha: 0.9 });
      g.circle(x, y, 140).fill({ color: 0xffffff, alpha: 0.6 + 0.3 * Math.sin(now / 120) });
    }
    // A small bar over the worker while it works.
    g.roundRect(u.x - 480, u.y - 1010, 960, 200, 100).fill({ color: 0x04070c, alpha: 0.85 });
    if (f > 0) g.roundRect(u.x - 450, u.y - 980, 900 * f, 140, 70).fill(job.contested ? WARN : 0x7fd4ff);
  }
}

const WHAT: Record<Job['kind'], string> = { claim: 'Claiming', link: 'Connecting fiber', build: 'Building' };

/** One line for a worker's job, e.g. "Claiming Data Source: 45% · 3s". */
export function jobText(u: UnitView, view: FactionView): string {
  const job = u.job;
  if (!job) return '<span class="warn">Idle</span>';
  const where = job.kind === 'claim' ? ` ${pretty(view.sites.find((s) => s.id === job.target)?.kind ?? 'site')}`
    : job.kind === 'build' ? ` ${pretty(view.buildings.find((b) => String(b.id) === job.target)?.type ?? 'building')}` : '';
  if (!job.working) return `Walking to work: ${WHAT[job.kind]}${where}`;
  if (job.contested) return `${WHAT[job.kind]}${where}: <b class="warn">contested</b>, an enemy worker is claiming it too. Nobody progresses until one of you leaves or dies.`;
  return `${WHAT[job.kind]}${where}: <b>${job.progress}%</b>${job.seconds !== null ? ` · ${job.seconds}s` : ''}`;
}

/** Summary across all workers, e.g. "2 claiming · 1 connecting fiber · 1 idle". */
export function workforce(view: FactionView): string {
  const counts = new Map<string, number>();
  for (const u of view.units) {
    if (u.role !== 'worker') continue;
    const k = !u.job ? 'idle' : !u.job.working ? 'walking' : u.job.contested ? 'contested' : WHAT[u.job.kind].toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (k === 'idle' || k === 'contested' ? `<b class="warn">${n} ${k}</b>` : `${n} ${k}`)).join(' · ');
}

/** Mark owned Data sources that aren't feeding the base (red, pulsing) or are throttled (orange). */
export function drawSourceIssues(g: Graphics, view: FactionView, now: number): void {
  for (const s of view.sites) {
    if (!s.issue) continue;
    const dead = s.issue !== 'bandwidth';
    const color = dead ? 0xe5534b : WARN;
    g.circle(s.x, s.y, 1250).stroke({ width: 140, color, alpha: dead ? 0.55 + 0.35 * Math.sin(now / 200) : 0.7 });
    if (dead) {
      // A cross through the source: nothing is getting home.
      g.moveTo(s.x - 450, s.y - 450).lineTo(s.x + 450, s.y + 450).moveTo(s.x + 450, s.y - 450).lineTo(s.x - 450, s.y + 450)
        .stroke({ width: 140, color });
    }
  }
}

/** Intel panel lines for owned sources that aren't feeding the base properly. */
export function sourceWarnings(view: FactionView): string[] {
  return view.sites.filter((s) => s.issue).map((s) =>
    `<b class="warn">⚠ ${s.id.startsWith('mid') ? 'Center' : s.id.includes('exp') ? 'Far' : 'Home'} Data Source</b> ${issueText(s.issue!, s.flow, s.rate)}`);
}
