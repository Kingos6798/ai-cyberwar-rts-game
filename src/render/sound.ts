// Sound cues for alerts (issue #4): short tones made with the Web Audio API, so there are no asset files.
// Silent until a user gesture unlocks audio (browser autoplay rules; the HUD unlocks on Start), each cue at
// most once per cooldown, and a mute choice remembered in localStorage.

/** How each alert line starts (effects.ts and hud.ts build their messages from these); cues match on them. */
export const ALERT_PREFIX = {
  attack: '⚠ Your ',
  spotted: '⚠ AI forces spotted',
  approaching: '⚠ Enemy forces approaching',
  power: '⚡ Power full',
} as const;

export type Cue = 'attack' | 'warning' | 'power';

export const SOUND = {
  /** Master volume (0-1). Kept low: cues sit on top of the music. */
  volume: 0.22,
  /** The same cue never repeats faster than this. */
  cooldownMs: 4000,
};

/** Which cue an alert line gets, or null for lines that stay silent. */
export function cueFor(text: string): Cue | null {
  if (text.startsWith(ALERT_PREFIX.attack)) return 'attack';
  if (text.startsWith(ALERT_PREFIX.spotted) || text.startsWith(ALERT_PREFIX.approaching)) return 'warning';
  if (text.startsWith(ALERT_PREFIX.power)) return 'power';
  return null;
}

/** True (and remembered) if `cue` has not played within the cooldown. */
export function shouldPlay(last: Map<Cue, number>, cue: Cue, now: number, cooldownMs = SOUND.cooldownMs): boolean {
  if (now - (last.get(cue) ?? -Infinity) < cooldownMs) return false;
  last.set(cue, now);
  return true;
}

/** Tones per cue: [frequency Hz, start s, length s, waveform]. */
const TONES: Record<Cue, [number, number, number, OscillatorType][]> = {
  // Two quick falling beeps: something of yours is being hit.
  attack: [[880, 0, 0.09, 'square'], [660, 0.12, 0.12, 'square']],
  // One soft blip: enemies seen on your half.
  warning: [[740, 0, 0.14, 'sine']],
  // A low falling tone: Power is full.
  power: [[220, 0, 0.12, 'triangle'], [165, 0.12, 0.22, 'triangle']],
};

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export interface SoundOptions {
  storage?: Storage;
  /** Injected in tests; null means no audio device. */
  createContext?: () => AudioContext | null;
  now?: () => number;
}

export interface SoundPlayer {
  readonly muted: boolean;
  /** Call from a user gesture (the Start click). Before this, nothing plays. Safe to call again. */
  unlock(): void;
  /** Plays a cue unless locked, muted or cooling down. Returns whether it played. */
  play(cue: Cue): boolean;
  /** Returns whether sound is now on. */
  toggleMute(): boolean;
}

export function createSounds(opts: SoundOptions = {}): SoundPlayer {
  const storage = opts.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const createContext = opts.createContext ?? (() => (typeof AudioContext === 'undefined' ? null : new AudioContext()));
  const now = opts.now ?? (() => performance.now());
  let muted = false;
  try { muted = storage?.getItem('sound') === 'off'; } catch { /* storage blocked: default on */ }
  let unlocked = false;
  let ctx: AudioContext | null = null;
  const last = new Map<Cue, number>();

  function tone(freq: number, start: number, length: number, type: OscillatorType): void {
    if (!ctx) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // Short fade in and out, so the tones don't click.
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(SOUND.volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + length + 0.02);
  }

  return {
    get muted() { return muted; },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      try { ctx = createContext(); } catch { ctx = null; }
      void ctx?.resume();
    },
    play(cue) {
      if (!unlocked || muted || !shouldPlay(last, cue, now())) return false;
      for (const [f, s, l, type] of TONES[cue]) tone(f, s, l, type);
      return true;
    },
    toggleMute() {
      muted = !muted;
      try { storage?.setItem('sound', muted ? 'off' : 'on'); } catch { /* not remembered */ }
      return !muted;
    },
  };
}
