/**
 * Shared vocabulary of the sound-effect recipes (./sfx.ts core sounds, ./sfxStage.ts uproot and
 * callout presentation, ./sfxPolice.ts police): the recipe contract and small layered helpers.
 */
import { fm, noise, perc, sub, tone, type Target } from './dsp';
import type { BusId } from './ids';
import { rrange } from './rng';
import { midiToHz, scaleNote } from './theory';

export interface SfxVoice extends Target {
  /** Variation index in [0, recipe.variants). */
  variant: number;
  /** Frequency multiplier (play option `pitch`). */
  pitch: number;
  /** Tonic (MIDI) of the current music key; tonal SFX use its major pentatonic. */
  key: number;
  /** Extra scale steps (combo climb for consecutive recoveries). */
  step: number;
}

export interface SfxRecipe {
  bus: BusId;
  variants: number;
  /** Linear trim for loudness matching inside a family. */
  gain: number;
  /** Max simultaneous voices of this id (oldest is faded out). */
  maxVoices: number;
  /** Minimum seconds between two triggers (extra triggers are dropped). */
  minInterval: number;
  /** Higher survives when the global voice budget is exhausted. */
  priority: number;
  /** Upper bound of the duration including tails (offline render length). */
  length: number;
  /** Reverb send 0..1. */
  reverb?: number;
  /** Duck the music while this plays (dB, seconds). */
  duck?: { db: number; hold: number };
  /** Duck the ambience bus (police sirens, alarm bells, whistles...) while this plays: scoring stays clear. */
  duckAmbience?: { db: number; hold: number };
  /**
   * (sfx bus only) Route through the ambience sub-bus, ducked under scoring sounds like the sirens
   * and alarm bells: police chatter (whistles, "멈춰!", car noises) must never mask the coins.
   */
  ambience?: boolean;
  /** Ignore positions (always centered, full level): global signals and rewards. */
  global?: boolean;
  /**
   * Seconds during which a retrigger reuses the previous variation instead of picking a new one
   * (a "3, 2, 1, GO" countdown keeps one timbre; the next countdown may use the other).
   */
  holdVariant?: number;
  play(v: SfxVoice): number;
}

/** Pentatonic note frequency for scale degree `deg` (+ combo step) in the voice's key. */
export const pn = (v: SfxVoice, deg: number): number => midiToHz(scaleNote(v.key, deg + v.step)) * v.pitch;
export const pnMidi = (v: SfxVoice, deg: number): number => scaleNote(v.key, deg + v.step);

/**
 * Metallic coin "tink": inharmonic FM (+ an octave partial unless `light`). Components share
 * one panner so a coin shower stays cheap (~5 nodes per coin).
 */
export function coin(v: Target, at: number, f: number, amp: number, decay: number, pan?: number, light = false): number {
  let t: Target = v;
  if (pan && typeof v.ctx.createStereoPanner === 'function') {
    const p = v.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(v.out);
    t = sub(v, p);
  }
  const end = fm(t, { freq: f, ratio: 3.51, index: [[0, 2.4], [decay * 0.4, 0.2]], amp: perc(0.0008, amp, decay), at });
  if (light) return end;
  return Math.max(end, tone(t, { freq: f * 2.003, amp: perc(0.0008, amp * 0.22, decay * 0.45), at }));
}

/** Short broadband impact used by many recipes (transient + body). */
export function thump(v: Target, at: number, f0: number, f1: number, amp: number, decay: number): number {
  noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 900 }], amp: perc(0.001, amp * 0.6, decay * 0.4), at });
  return tone(v, { freq: [[0, f0], [decay * 0.6, f1]], amp: perc(0.002, amp, decay), at });
}

/** Many tiny random clicks (fibres snapping, coin rattle, debris). */
export function crackles(
  v: Target,
  count: number,
  from: number,
  to: number,
  o: { fLo: number; fHi: number; ampLo: number; ampHi: number; durLo: number; durHi: number; skew?: number; panWidth?: number },
): void {
  for (let i = 0; i < count; i++) {
    // skew > 1 front-loads the events.
    const u = Math.pow(v.rnd(), o.skew ?? 1);
    const at = from + (to - from) * u;
    const fade = 1 - 0.6 * u;
    noise(v, {
      color: 'white',
      filters: [{ type: 'bandpass', freq: rrange(v.rnd, o.fLo, o.fHi), q: rrange(v.rnd, 2.5, 6) }],
      amp: perc(0.0005, rrange(v.rnd, o.ampLo, o.ampHi) * fade, rrange(v.rnd, o.durLo, o.durHi)),
      at,
      pan: (v.rnd() * 2 - 1) * (o.panWidth ?? 0.4),
    });
  }
}

