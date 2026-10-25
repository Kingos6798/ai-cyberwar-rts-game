// Sound cues for alerts (#4): short tones synthesized with Web Audio, so there are no asset files to
// license. Silent until the player starts the game (browsers block audio before a user gesture), at
// most one cue of a kind every few seconds, and a mute toggle remembered in localStorage.

export const SOUND = {
  volume: 0.12,
  /** The same cue never repeats faster than this. */
  gapMs: 5000,
};

export type Cue = 'attacked' | 'approaching' | 'spotted' | 'power';

/** Which cue an alert line gets; null for messages that aren't alerts. */
export function cueFor(text: string): Cue | null {
  if (/under attack/i.test(text)) return 'attacked';
  if (/approaching/i.test(text)) return 'approaching';
  if (/spotted/i.test(text)) return 'spotted';
  if (/power full/i.test(text)) return 'power';
  return null;
}

/** Returns a check that says whether a cue may play now, and records it when it may. */
export function createCueLimiter(gapMs = SOUND.gapMs): (cue: Cue, now: number) => boolean {
  const last = new Map<Cue, number>();
  return (cue, now) => {
    if (now - (last.get(cue) ?? -Infinity) < gapMs) return false;
    last.set(cue, now);
    return true;
  };
}

/** Each cue's notes: [frequency Hz, start s, length s]. Falling = danger, rising = incoming. */
const NOTES: Record<Cue, { wave: OscillatorType; notes: [number, number, number][] }> = {
  attacked: { wave: 'square', notes: [[880, 0, 0.09], [660, 0.12, 0.12]] },
  approaching: { wave: 'triangle', notes: [[523, 0, 0.1], [784, 0.12, 0.14]] },
  spotted: { wave: 'triangle', notes: [[659, 0, 0.12]] },
  power: { wave: 'sine', notes: [[220, 0, 0.18], [196, 0.2, 0.22]] },
};

export interface SoundPlayer {
  /** Call when the player starts the game (a user gesture). Safe to call again. */
  start(): void;
  /** Plays a cue unless muted, not started yet, or played too recently. Returns whether it played. */
  play(cue: Cue, now: number): boolean;
  readonly muted: boolean;
  /** Returns whether sounds are now on. */
  toggleMute(): boolean;
}

export function createSound(): SoundPlayer {
  let muted = false;
  try { muted = localStorage.getItem('sounds') === 'off'; } catch { /* storage blocked: default on */ }
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const allowed = createCueLimiter();
  return {
    start() {
      if (ctx) return;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = SOUND.volume;
      master.connect(ctx.destination);
    },
    play(cue, now) {
      if (!ctx || !master || muted || !allowed(cue, now)) return false;
      const { wave, notes } = NOTES[cue];
      for (const [freq, at, len] of notes) {
        const t = ctx.currentTime + at;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = wave;
        osc.frequency.value = freq;
        // Quick attack and decay: a blip, not a click.
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(1, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, t + len);
        osc.connect(env).connect(master);
        osc.start(t);
        osc.stop(t + len + 0.02);
      }
      return true;
    },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('sounds', muted ? 'off' : 'on'); } catch { /* not saved */ }
      return !muted;
    },
  };
}
