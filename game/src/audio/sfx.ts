/**
 * Procedural sound-effect recipes: one per SfxId, each with 2-4 discrete variations plus small
 * continuous jitter so repeated sounds never machine-gun. Style: cute, punchy, cartoony
 * (ART_DIRECTION: toy-box materials, layered feedback, musical SFX in the song's key).
 *
 * A recipe schedules nodes into `v.out` starting at `v.t` and returns its duration (s).
 * Levels are matched per family with `gain` (measured offline; see dev/audio-gallery.html).
 */
import { DEFAULT_RULES, TICK_RATE } from '../sim/config';
import { ahr, creakBuffer, fm, noise, partials, perc, route, scrapeBuffer, sub, tone, type Partial, type Target } from './dsp';
import type { BusId, SfxId } from './ids';
import { brass, glock, marimba, timpani, crash, snare, kick } from './instruments';
import { playJingle } from './jingles';
import { jitter, rint, rrange } from './rng';
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
  /** Ignore positions (always centered, full level): global signals and rewards. */
  global?: boolean;
  play(v: SfxVoice): number;
}

/** Recovery dwell (doc §8: 1.5 s). The recoverStart riser lasts exactly this long. */
export const RECOVERY_SECONDS = DEFAULT_RULES.recoveryTicks / TICK_RATE;

/** Pentatonic note frequency for scale degree `deg` (+ combo step) in the voice's key. */
const pn = (v: SfxVoice, deg: number): number => midiToHz(scaleNote(v.key, deg + v.step)) * v.pitch;
const pnMidi = (v: SfxVoice, deg: number): number => scaleNote(v.key, deg + v.step);

/**
 * Metallic coin "tink": inharmonic FM (+ an octave partial unless `light`). Components share
 * one panner so a coin shower stays cheap (~5 nodes per coin).
 */
function coin(v: Target, at: number, f: number, amp: number, decay: number, pan?: number, light = false): number {
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
function thump(v: Target, at: number, f0: number, f1: number, amp: number, decay: number): number {
  noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 900 }], amp: perc(0.001, amp * 0.6, decay * 0.4), at });
  return tone(v, { freq: [[0, f0], [decay * 0.6, f1]], amp: perc(0.002, amp, decay), at });
}

/** Many tiny random clicks (fibres snapping, coin rattle, debris). */
function crackles(
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

const twinkleNotes = [
  [10, 12, 11, 13, 12],
  [12, 10, 13, 11, 14],
  [11, 13, 10, 12, 10],
] as const;

// ---------------------------------------------------------------------------------------------

export const SFX_RECIPES: Record<SfxId, SfxRecipe> = {
  // ---- hands & bodies --------------------------------------------------------------------------
  grab: {
    bus: 'sfx', variants: 4, gain: 0.89, maxVoices: 6, minInterval: 0.03, priority: 4, length: 0.4,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      const base = [150, 172, 196, 136][v.variant] * p;
      // Soft "clunk": rounded low knock + a dull overtone + a short paw-pad click.
      tone(v, { freq: [[0, base * 1.7], [0.045, base]], amp: perc(0.002, 0.55, 0.12) });
      tone(v, { type: 'triangle', freq: [[0, base * 4.2], [0.03, base * 3.1]], amp: perc(0.001, 0.16, 0.05) });
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 1500 * p, q: 1.3 }], amp: perc(0.0008, 0.3, 0.025) });
      if (v.variant % 2) tone(v, { freq: [[0, base * 6], [0.02, base * 7.5]], amp: perc(0.001, 0.05, 0.03), at: 0.012 });
      return 0.2;
    },
  },
  release: {
    bus: 'sfx', variants: 3, gain: 1.24, maxVoices: 6, minInterval: 0.03, priority: 3, length: 0.3,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.05);
      const base = [330, 370, 300][v.variant] * p;
      // Light "pop-off": small upward blip + puff.
      tone(v, { freq: [[0, base], [0.06, base * 1.4]], amp: perc(0.004, 0.32, 0.09) });
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 1900 * p }], amp: perc(0.002, 0.2, 0.05) });
      return 0.16;
    },
  },
  dash: {
    bus: 'sfx', variants: 4, gain: 1.77, maxVoices: 4, minInterval: 0.05, priority: 4, length: 0.6,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.05);
      const dur = [0.28, 0.32, 0.25, 0.3][v.variant] * jitter(v.rnd, 0.06);
      const peakF = [2400, 2800, 2100, 2600][v.variant] * p;
      // Whoosh: band-passed noise sweeping up then settling.
      noise(v, {
        color: 'pink',
        filters: [{ type: 'bandpass', freq: [[0, 380 * p], [dur * 0.38, peakF], [dur, 700 * p]], q: 1.4 }],
        amp: [[0, 0], [dur * 0.32, 0.65], [dur, 0]],
      });
      noise(v, {
        color: 'white',
        filters: [{ type: 'highpass', freq: 3500 }],
        amp: [[0, 0], [dur * 0.3, 0.07], [dur * 0.8, 0]],
      });
      // Cartoon "zip" on half the variations.
      if (v.variant === 1 || v.variant === 3) {
        tone(v, { type: 'triangle', freq: [[0, 260 * p], [dur * 0.7, 780 * p]], amp: [[0, 0], [0.02, 0.07], [dur * 0.8, 0]] });
      }
      return dur + 0.05;
    },
  },
  dashHit: {
    bus: 'sfx', variants: 4, gain: 0.64, maxVoices: 4, minInterval: 0.05, priority: 7, length: 0.6, reverb: 0.12,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      const b = [520, 420, 620, 470][v.variant] * p;
      // Bonk: hollow wooden knock with a fast pitch drop.
      tone(v, { type: 'triangle', freq: [[0, b], [0.09, b * 0.45]], amp: perc(0.002, 0.55, 0.16) });
      tone(v, { freq: [[0, b * 0.5], [0.12, b * 0.25]], amp: perc(0.002, 0.55, 0.2) });
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 950, q: 1 }], amp: perc(0.0008, 0.45, 0.025) });
      // Squeak: rubber-toy chirp with a quick wobble, contour varies per variation.
      const contours = [
        [[0, 1300], [0.06, 2100], [0.14, 1800]],
        [[0, 1700], [0.1, 2350]],
        [[0, 2200], [0.05, 1500], [0.12, 1900]],
        [[0, 1500], [0.04, 1900], [0.08, 1600], [0.13, 2200]],
      ] as const;
      const squeak = (at: number, scale: number): void => {
        tone(v, {
          type: 'triangle',
          freq: contours[v.variant].map(([t, f]) => [t, f * p * scale] as const),
          amp: [[0, 0], [0.012, 0.2], [0.1, 0.15], [0.16, 0]],
          vib: { rate: 28, cents: 45 },
          at,
        });
      };
      squeak(v.variant === 1 ? 0.06 : 0.035, 1);
      // Variation 3: a second, higher squeak (the victim's surprised "eek-eek").
      if (v.variant === 3) squeak(0.2, 1.18);
      return v.variant === 3 ? 0.4 : 0.25;
    },
  },
  bump: {
    bus: 'sfx', variants: 4, gain: 1.38, maxVoices: 4, minInterval: 0.06, priority: 2, length: 0.3,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.05);
      const b = [300, 262, 340, 282][v.variant] * p;
      tone(v, { type: 'triangle', freq: [[0, b], [0.07, b * 0.6]], amp: perc(0.002, 0.45, 0.11) });
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 1300 }], amp: perc(0.001, 0.3, 0.04) });
      return 0.15;
    },
  },
  knockdown: {
    bus: 'sfx', variants: 3, gain: 0.59, maxVoices: 3, minInterval: 0.08, priority: 7, length: 1.6, reverb: 0.25,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.03);
      // Thud of the body hitting the ground.
      thump(v, 0, 125 * p, 55 * p, 0.6, 0.25);
      // Boing: a spring whose wobble dies away.
      const ctx = v.ctx;
      const t = v.t + 0.03;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(260 * p, t);
      osc.frequency.exponentialRampToValueAtTime(165 * p, t + 0.6);
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime([13, 15, 11][v.variant], t);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(95 * p, t);
      depth.gain.exponentialRampToValueAtTime(4, t + 0.6);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.32, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
      osc.connect(g);
      g.connect(v.out);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 0.65);
      lfo.stop(t + 0.65);
      // Twinkle: "seeing stars" circling (alternating pan).
      const notes = twinkleNotes[v.variant];
      notes.forEach((deg, i) => {
        glock(v, 0.24 + i * 0.085, pnMidi(v, deg), 0.2, 0.55 - i * 0.06, i % 2 ? 0.45 : -0.45);
      });
      return 1.3;
    },
  },
  footstep: {
    bus: 'sfx', variants: 4, gain: 1.35, maxVoices: 8, minInterval: 0.025, priority: 0, length: 0.15,
    play(v) {
      // Soft paws: a muffled tap, cheap (1-2 sources) because there are many of them.
      const lp = [700, 950, 820, 1100][v.variant] * jitter(v.rnd, 0.12) * v.pitch;
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: lp, q: 0.9 }], amp: perc(0.004, v.variant % 2 ? 0.75 : 0.45, 0.05) });
      if (v.variant % 2 === 0) tone(v, { freq: [[0, 150 * v.pitch], [0.04, 95 * v.pitch]], amp: perc(0.003, 0.18, 0.06) });
      return 0.08;
    },
  },
  eject: {
    bus: 'sfx', variants: 3, gain: 0.95, maxVoices: 3, minInterval: 0.05, priority: 5, length: 0.7, reverb: 0.15,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      // "퐁!": cork pop + rising bubble + a little spring.
      noise(v, { color: 'white', filters: [{ type: 'highpass', freq: 1600 }], amp: perc(0.0005, 0.35, 0.018) });
      tone(v, { freq: [[0, 380 * p], [0.07, 1150 * p]], amp: perc(0.003, 0.45, 0.12) });
      tone(v, { type: 'triangle', freq: [[0, 760 * p], [0.07, 2300 * p]], amp: perc(0.003, 0.08, 0.08) });
      const sp = [620, 700, 560][v.variant] * p;
      tone(v, { freq: sp, amp: perc(0.005, 0.16, 0.32), vib: { rate: 17, cents: [[0, 160], [0.3, 10]] }, at: 0.08 });
      return 0.45;
    },
  },

  // ---- loot physics ------------------------------------------------------------------------------
  strain: {
    bus: 'sfx', variants: 3, gain: 0.62, maxVoices: 3, minInterval: 0.2, priority: 3, length: 1.2,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.05);
      const dur = [0.9, 0.75, 1.05][v.variant];
      // Rising creak: stick-slip pulses speeding up + rising resonance, with a low groan.
      noise(v, {
        buffer: creakBuffer(v.ctx),
        rate: [[0, 0.6 * p], [dur, 1.55 * p]],
        filters: [{ type: 'bandpass', freq: [[0, 600 * p], [dur, 1300 * p]], q: 1.6 }],
        amp: [[0, 0], [0.08, 0.6], [dur * 0.85, 0.75], [dur + 0.08, 0]],
      });
      tone(v, {
        type: 'sawtooth',
        freq: [[0, 68 * p], [dur, 96 * p]],
        filter: { type: 'lowpass', freq: 420, q: 2 },
        amp: [[0, 0], [0.12, 0.06], [dur, 0.08], [dur + 0.1, 0]],
      });
      return dur + 0.12;
    },
  },
  unanchorSafe: {
    bus: 'sfx', variants: 3, gain: 0.8, maxVoices: 3, minInterval: 0.06, priority: 6, length: 0.9, reverb: 0.2,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      let at = 0;
      if (v.variant === 2) {
        // Ratchet ticks of the bolt turning before it pops.
        for (let i = 0; i < 3; i++) noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 3200, q: 4 }], amp: perc(0.0005, 0.22, 0.012), at: i * 0.035 });
        at = 0.11;
      }
      // Bolt pop: sharp pitch drop + crack.
      tone(v, { freq: [[0, 950 * p], [0.035, 190 * p]], amp: perc(0.001, 0.6, 0.07), at });
      noise(v, { color: 'white', filters: [{ type: 'highpass', freq: 2000 }], amp: perc(0.0005, 0.45, 0.02), at });
      thump(v, at, 160 * p, 80 * p, 0.4, 0.14);
      // Metal clink of the freed bolt.
      const metal: Partial[] = [
        [1, 0.16, 0.35],
        [2.32, 0.1, 0.22],
        [4.1, 0.06, 0.12],
        [6.6, 0.035, 0.07],
      ];
      partials(v, [1480, 1720, 1300][v.variant] * p, metal, { at: at + 0.04 });
      if (v.variant === 1) tone(v, { freq: 540 * p, amp: perc(0.004, 0.12, 0.25), vib: { rate: 19, cents: [[0, 140], [0.25, 10]] }, at: at + 0.05 });
      return at + 0.45;
    },
  },
  unanchorBank: {
    bus: 'sfx', variants: 3, gain: 0.53, maxVoices: 2, minInterval: 0.3, priority: 9, length: 4.2, reverb: 0.3,
    duck: { db: -7, hold: 2.2 },
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.03);
      // "기초가 끊기는 소리": deep crack, sub boom, swelling rumble, tearing roots, debris.
      // 1. Crack transient.
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 2600, q: 0.7 }], amp: perc(0.0008, 0.75, 0.05) });
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 1400 }], amp: perc(0.002, 0.7, 0.28) });
      // 2. Sub boom + an audible-on-laptops upper thump.
      tone(v, { freq: [[0, 88 * p], [0.5, 38 * p]], amp: perc(0.004, 0.75, 1.2) });
      tone(v, { freq: [[0, 175 * p], [0.3, 72 * p]], amp: perc(0.003, 0.35, 0.4) });
      // 3. Rumble swell (ground giving way).
      noise(v, {
        color: 'brown',
        filters: [{ type: 'lowpass', freq: [[0, 200], [2.8, 110]], q: 0.8 }],
        amp: [[0, 0], [0.18, 0.5], [0.9, 0.6], [3.2, 0]],
      });
      noise(v, {
        buffer: scrapeBuffer(v.ctx),
        rate: 0.45 * p,
        filters: [{ type: 'bandpass', freq: 380, q: 1.1 }],
        amp: [[0, 0], [0.12, 0], [0.45, 0.28], [2.4, 0]],
      });
      // 4. Roots tearing: front-loaded snaps, ripping sweeps and a fibrous groan.
      crackles(v, 46, 0.04, 1.7, { fLo: 650, fHi: 3400, ampLo: 0.12, ampHi: 0.42, durLo: 0.004, durHi: 0.028, skew: 1.7, panWidth: 0.55 });
      const rips = [
        [0.1, 0.3],
        [0.42, 0.26],
        [0.85, 0.34],
      ] as const;
      for (const [at, d] of rips) {
        const g = v.ctx.createGain();
        g.gain.value = 0;
        // Ripping texture: square-wave amplitude chatter on a rising band of noise.
        const am = v.ctx.createOscillator();
        am.type = 'square';
        am.frequency.setValueAtTime(rrange(v.rnd, 32, 55), v.t + at);
        const amDepth = v.ctx.createGain();
        amDepth.gain.value = 0.5;
        am.connect(amDepth);
        amDepth.connect(g.gain);
        const ripOut = v.ctx.createGain();
        ripOut.gain.value = 0;
        ripOut.gain.setValueAtTime(0, v.t + at);
        ripOut.gain.linearRampToValueAtTime(0.32, v.t + at + 0.03);
        ripOut.gain.exponentialRampToValueAtTime(0.0001, v.t + at + d);
        g.connect(ripOut);
        route(v.ctx, ripOut, v.out, (v.rnd() * 2 - 1) * 0.4);
        noise(v, {
          color: 'white',
          filters: [{ type: 'bandpass', freq: [[0, 450], [d, 1700]], q: 2.2 }],
          amp: [[0, 0.5], [d, 0.5]],
          at,
          dest: g,
        });
        am.start(v.t + at);
        am.stop(v.t + at + d + 0.02);
      }
      noise(v, {
        buffer: creakBuffer(v.ctx),
        rate: [[0, 0.42 * p], [1.4, 0.7 * p]],
        filters: [{ type: 'bandpass', freq: [[0, 380], [1.4, 520]], q: 2.5 }],
        amp: [[0, 0], [0.08, 0.45], [1.0, 0.35], [1.6, 0]],
      });
      // 5. Debris settling.
      crackles(v, 9, 1.0, 2.7, { fLo: 2200, fHi: 5200, ampLo: 0.04, ampHi: 0.11, durLo: 0.008, durHi: 0.02, panWidth: 0.7 });
      // Variation: an extra late "second snap" on two of the three.
      if (v.variant > 0) {
        const at = v.variant === 1 ? 0.62 : 0.95;
        noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 1900, q: 1 }], amp: perc(0.0008, 0.4, 0.04), at });
        tone(v, { freq: [[0, 120 * p], [0.25, 50 * p]], amp: perc(0.003, 0.35, 0.35), at });
      }
      return 3.4;
    },
  },
  fenceBreak: {
    bus: 'sfx', variants: 3, gain: 1.29, maxVoices: 3, minInterval: 0.1, priority: 8, length: 1.8, reverb: 0.25,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      const metalMix = [0.35, 1, 0.65][v.variant];
      const woodMix = [1, 0.45, 0.8][v.variant];
      // Impact.
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 1250, q: 0.8 }], amp: perc(0.0008, 0.7, 0.12) });
      noise(v, { color: 'brown', filters: [{ type: 'lowpass', freq: 520 }], amp: perc(0.002, 0.6, 0.22) });
      // Wood: a few short resonant modes (planks splintering).
      for (const f of [212, 468, 830]) tone(v, { freq: f * p * jitter(v.rnd, 0.05), amp: perc(0.002, 0.26 * woodMix, rrange(v.rnd, 0.12, 0.22)) });
      crackles(v, 14, 0.0, 0.25, { fLo: 900, fHi: 3000, ampLo: 0.12 * woodMix, ampHi: 0.3 * woodMix, durLo: 0.005, durHi: 0.02, skew: 1.5 });
      // Metal: an inharmonic clang.
      partials(
        v,
        380 * p,
        [
          [1, 0.17, 0.9],
          [2.71, 0.12, 0.6],
          [5.12, 0.08, 0.35],
          [8.3, 0.05, 0.2],
        ],
        { gain: metalMix },
      );
      // Clatter of bits landing.
      const n = 6 + rint(v.rnd, 3);
      for (let i = 0; i < n; i++) {
        const at = 0.07 + Math.pow(v.rnd(), 1.3) * 0.5;
        const amp = 0.24 * (1 - at);
        const pan = (v.rnd() * 2 - 1) * 0.5;
        if (v.rnd() < metalMix / (metalMix + woodMix)) {
          tone(v, { freq: rrange(v.rnd, 2000, 3800) * p, amp: perc(0.0008, amp * 0.6, 0.08), at, pan });
        } else {
          tone(v, { type: 'triangle', freq: [[0, rrange(v.rnd, 350, 700) * p], [0.04, rrange(v.rnd, 250, 400) * p]], amp: perc(0.001, amp, 0.06), at, pan });
        }
      }
      return 1.1;
    },
  },
  safeLoad: {
    bus: 'sfx', variants: 3, gain: 0.57, maxVoices: 3, minInterval: 0.05, priority: 5, length: 0.8, reverb: 0.15,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      // Heavy thunk onto the floor + small metal clank, then a soft rising chime ("+ value").
      thump(v, 0, 140 * p, 62 * p, 0.65, 0.25);
      partials(v, [620, 700, 560][v.variant] * p, [[1, 0.14, 0.15], [2.4, 0.08, 0.1], [3.9, 0.05, 0.06]]);
      marimba(v, 0.09, pnMidi(v, 5), 0.1, 0.4);
      marimba(v, 0.165, pnMidi(v, [7, 8, 7][v.variant]), 0.1, 0.45);
      return 0.6;
    },
  },
  safeUnload: {
    bus: 'sfx', variants: 3, gain: 0.78, maxVoices: 3, minInterval: 0.05, priority: 6, length: 0.9, reverb: 0.15,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      // Short slide-out scrape, drop thunk, then a falling chime ("- value").
      noise(v, {
        buffer: scrapeBuffer(v.ctx),
        rate: 1.1,
        filters: [{ type: 'bandpass', freq: [[0, 900], [0.14, 600]], q: 1.2 }],
        amp: [[0, 0], [0.02, 0.35], [0.14, 0]],
      });
      thump(v, 0.12, 120 * p, 58 * p, 0.55, 0.22);
      marimba(v, 0.2, pnMidi(v, [8, 7, 8][v.variant]), 0.1, 0.42);
      marimba(v, 0.28, pnMidi(v, 5), 0.1, 0.38);
      return 0.7;
    },
  },

  // ---- recovery & scoring -------------------------------------------------------------------------
  recoverStart: {
    bus: 'sfx', variants: 2, gain: 0.5, maxVoices: 6, minInterval: 0.05, priority: 6, length: RECOVERY_SECONDS + 0.4,
    play(v) {
      const D = RECOVERY_SECONDS;
      const root = pnMidi(v, v.variant === 0 ? 0 : 2);
      const f0 = midiToHz(root);
      // Riser that lasts exactly the recovery dwell: tone climbing an octave, tremolo speeding up.
      const g = v.ctx.createGain();
      g.gain.value = 1;
      const trem = v.ctx.createOscillator();
      trem.frequency.setValueAtTime(5, v.t);
      trem.frequency.exponentialRampToValueAtTime(18, v.t + D);
      const tremDepth = v.ctx.createGain();
      tremDepth.gain.value = 0.35;
      trem.connect(tremDepth);
      tremDepth.connect(g.gain);
      g.connect(v.out);
      trem.start(v.t);
      trem.stop(v.t + D + 0.05);
      const body = sub(v, g);
      const amp = [[0, 0], [0.06, 0.1], [D * 0.92, 0.22], [D, 0]] as const;
      tone(body, { type: 'triangle', freq: [[0, f0], [D, f0 * 2]], amp });
      tone(body, { freq: [[0, f0 * 1.5], [D, f0 * 3]], amp: amp.map(([t, a]) => [t, a * 0.35] as const) });
      noise(v, {
        color: 'white',
        filters: [{ type: 'bandpass', freq: [[0, 900], [D, 5200]], q: 1.5 }],
        amp: [[0, 0], [D * 0.95, 0.09], [D + 0.02, 0]],
      });
      return D + 0.05;
    },
  },
  recoverCancel: {
    bus: 'sfx', variants: 2, gain: 0.98, maxVoices: 3, minInterval: 0.08, priority: 6, length: 0.7,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.03);
      // Deflating "wah-wahh" (not mocking: short and soft).
      if (v.variant === 0) {
        tone(v, { type: 'triangle', freq: [[0, 620 * p], [0.35, 290 * p]], amp: perc(0.01, 0.34, 0.38), vib: { rate: 9, cents: 45 } });
        tone(v, { type: 'square', freq: [[0, 310 * p], [0.35, 145 * p]], amp: perc(0.01, 0.06, 0.34), filter: { type: 'lowpass', freq: 1100 } });
      } else {
        tone(v, { type: 'triangle', freq: [[0, 560 * p], [0.12, 520 * p]], amp: perc(0.008, 0.3, 0.14) });
        tone(v, { type: 'triangle', freq: [[0, 470 * p], [0.3, 300 * p]], amp: perc(0.008, 0.32, 0.34), vib: { rate: 8, cents: 40 }, at: 0.14 });
      }
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 800 }], amp: perc(0.002, 0.18, 0.06) });
      return 0.5;
    },
  },
  scoreSmall: {
    bus: 'sfx', variants: 4, gain: 0.56, maxVoices: 4, minInterval: 0.04, priority: 8, length: 1.4, reverb: 0.3, global: true,
    play(v) {
      // Coin cascade in key ("tli-li-ling"), climbing with the combo step.
      const pats = [
        [0, 1, 3],
        [0, 2, 3],
        [1, 0, 3],
        [0, 1, 2, 3],
      ] as const;
      const pat = pats[v.variant];
      let at = 0;
      pat.forEach((d, i) => {
        const last = i === pat.length - 1;
        coin(v, at, pn(v, 8 + d), last ? 0.34 : 0.2, last ? 0.6 : 0.12, last ? 0 : (i % 2 ? 0.2 : -0.2));
        at += 0.045;
      });
      for (let k = 0; k < 3; k++) {
        tone(v, { freq: rrange(v.rnd, 5200, 7600), amp: perc(0.001, 0.035, 0.04), at: at + k * 0.05, pan: (v.rnd() * 2 - 1) * 0.5 });
      }
      return at + 0.65;
    },
  },
  scoreLarge: {
    bus: 'sfx', variants: 3, gain: 0.61, maxVoices: 3, minInterval: 0.06, priority: 8, length: 1.8, reverb: 0.3, global: true,
    play(v) {
      const p = v.pitch;
      // Cash register "ka-ching": drawer clunk + ratchet, struck bell, coin rattle, confirm arpeggio.
      thump(v, 0, 110 * p, 70 * p, 0.55, 0.16);
      for (let i = 0; i < 3; i++) {
        noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 3000, q: 3 }], amp: perc(0.0005, 0.28 - i * 0.06, 0.012), at: i * 0.024 });
      }
      const bellF = pn(v, [13, 12, 14][v.variant]);
      partials(
        v,
        bellF,
        [
          [1, 0.3, 1.1],
          [2.41, 0.14, 0.6],
          [3.98, 0.09, 0.35],
          [5.92, 0.05, 0.2],
        ],
        { at: 0.08 },
      );
      crackles(v, 10, 0.1, 0.5, { fLo: 3000, fHi: 6500, ampLo: 0.05, ampHi: 0.12, durLo: 0.01, durHi: 0.025, panWidth: 0.5 });
      marimba(v, 0.16, pnMidi(v, 7), 0.1, 0.35);
      marimba(v, 0.25, pnMidi(v, 9), 0.1, 0.4);
      marimba(v, 0.34, pnMidi(v, 10), 0.2, 0.45);
      return 1.3;
    },
  },
  scoreBank: {
    bus: 'sfx', variants: 2, gain: 0.61, maxVoices: 2, minInterval: 0.2, priority: 10, length: 3.6, reverb: 0.35, global: true,
    duck: { db: -10, hold: 2.4 },
    play(v) {
      const k = v.key;
      // Fanfare (original motif) on soft brass with a timpani hit and a cymbal.
      const motifs = [
        // [offset s, semitones above key, dur, vel]
        [[0, 7, 0.11, 0.8], [0.12, 12, 0.11, 0.85], [0.24, 16, 0.11, 0.9], [0.36, 19, 0.9, 1]],
        [[0, 4, 0.09, 0.8], [0.1, 7, 0.09, 0.8], [0.2, 12, 0.09, 0.85], [0.3, 14, 0.12, 0.9], [0.44, 16, 0.85, 1]],
      ] as const;
      const motif = motifs[v.variant];
      for (const [at, st, dur, vel] of motif) brass(v, at, k + st, dur, vel);
      const hit = motif[motif.length - 1][0];
      for (const st of [0, 4, 7]) brass(v, hit, k + st, 0.9, 0.55);
      brass(v, hit, k - 12, 0.9, 0.6);
      timpani(v, hit, k - 24 + 5, 1, 0.8);
      timpani(v, 0, k - 24 + 12, 0.3, 0.45);
      crash(v, hit, 0, 1, 0.8);
      snare(v, hit - 0.12, 0, 0.1, 0.35);
      snare(v, hit - 0.06, 0, 0.1, 0.45);
      kick(v, hit, 0, 0.2, 0.6);
      // Sparkle glissando up the pentatonic.
      for (let i = 0; i < 9; i++) glock(v, hit + i * 0.035, scaleNote(k, 8 + i), 0.1, 0.35, (i / 8) * 1.2 - 0.6);
      // Coin shower: many coins, thinning out, spread across the stereo field.
      const n = 26;
      for (let i = 0; i < n; i++) {
        const at = hit + 0.1 + Math.pow(i / n, 1.4) * 1.9 + v.rnd() * 0.04;
        const f = midiToHz(scaleNote(k, 10 + rint(v.rnd, 6)));
        coin(v, at, f * jitter(v.rnd, 0.01), rrange(v.rnd, 0.09, 0.18) * (1 - (0.5 * i) / n), rrange(v.rnd, 0.12, 0.3), (v.rnd() * 2 - 1) * 0.75, true);
      }
      return hit + 2.4;
    },
  },

  // ---- match signals ------------------------------------------------------------------------------
  siren: {
    bus: 'sfx', variants: 3, gain: 0.64, maxVoices: 1, minInterval: 0.5, priority: 9, length: 2.6, reverb: 0.2, global: true,
    play(v) {
      const D = 2.1;
      const filter = { type: 'lowpass' as const, freq: 2400, q: 0.7 };
      let freq: readonly (readonly [number, number])[];
      if (v.variant === 1) {
        // Two-tone "nee-naw".
        const pts: [number, number][] = [];
        for (let i = 0; i < 4; i++) {
          const f = i % 2 ? 590 : 780;
          pts.push([i * 0.5, f], [i * 0.5 + 0.47, f]);
        }
        freq = pts;
      } else if (v.variant === 2) {
        freq = [[0, 540], [0.7, 1320], [1.1, 1250], [1.45, 1340], [2.05, 600]];
      } else {
        freq = [[0, 520], [0.85, 1350], [2.0, 560]];
      }
      const amp = [[0, 0], [0.12, 0.26], [D - 0.35, 0.24], [D, 0]] as const;
      // Rounded toy siren: triangle body + a filtered square for bite.
      tone(v, { type: 'triangle', freq, amp, vib: { rate: 7, cents: 14 } });
      tone(v, { type: 'square', freq, amp: amp.map(([t, a]) => [t, a * 0.28] as const), filter, vib: { rate: 7, cents: 14 } });
      return D;
    },
  },
  countdownBeep: {
    bus: 'sfx', variants: 2, gain: 0.37, maxVoices: 2, minInterval: 0.1, priority: 8, length: 0.5, global: true,
    play(v) {
      // A5 (the 3rd of F major); pass pitch 2 for the final "GO" beep.
      const f = midiToHz(v.key + 16) * v.pitch;
      const len = v.pitch > 1.5 ? 0.32 : 0.14;
      tone(v, { type: 'square', freq: f, amp: ahr(0.004, 0.13, len, 0.06, 0.85), filter: { type: 'lowpass', freq: 3200 } });
      tone(v, { freq: f, amp: ahr(0.004, 0.3, len, 0.06, 0.85) });
      if (v.variant === 1) tone(v, { freq: f * 2, amp: ahr(0.004, 0.05, len, 0.05, 0.8) });
      return len + 0.08;
    },
  },
  whistleStart: {
    bus: 'sfx', variants: 2, gain: 0.62, maxVoices: 1, minInterval: 0.3, priority: 9, length: 1.3, reverb: 0.25, global: true,
    play(v) {
      // Referee whistle: "tweet-tweeeet". The pea rattles the pitch at ~45 Hz.
      const blasts = v.variant === 0
        ? [[0, 0.16], [0.24, 0.62]]
        : [[0, 0.12], [0.18, 0.12], [0.36, 0.55]];
      const f0 = [3050, 2900][v.variant] * v.pitch;
      for (const [at, d] of blasts) {
        const amp = ahr(0.015, 0.22, d - 0.04, 0.035, 0.9);
        tone(v, { freq: [[0, f0 * 0.97], [0.03, f0]], amp, vib: { rate: 46, cents: 70 }, at });
        tone(v, { freq: f0 * 2, amp: ahr(0.015, 0.03, d - 0.04, 0.035, 0.9), vib: { rate: 46, cents: 70 }, at });
        noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: f0, q: 5 }], amp: ahr(0.01, 0.06, d - 0.03, 0.03, 0.8), at });
      }
      const last = blasts[blasts.length - 1];
      return last[0] + last[1] + 0.05;
    },
  },
  hornEnd: {
    bus: 'sfx', variants: 2, gain: 1.98, maxVoices: 1, minInterval: 0.3, priority: 9, length: 1.9, reverb: 0.25, global: true,
    play(v) {
      // Getaway-van honk: "빵빵-빠앙" in a major third, slight droop at the end.
      const honks = v.variant === 0
        ? [[0, 0.15], [0.21, 0.15], [0.46, 0.85]]
        : [[0, 0.22], [0.32, 0.9]];
      const filter = { type: 'lowpass' as const, freq: 2300, q: 0.8 };
      for (const [at, d] of honks) {
        for (const f of [415, 523]) {
          const fr = f * v.pitch;
          const freq = [[0, fr * 0.97], [0.025, fr], [d, fr], [d + 0.06, fr * 0.95]] as const;
          tone(v, { type: 'sawtooth', freq, amp: ahr(0.012, 0.075, d, 0.06, 0.95), filter, at });
          tone(v, { type: 'square', freq: freq.map(([t, x]) => [t, x / 2] as const), amp: ahr(0.012, 0.045, d, 0.06, 0.95), filter: { type: 'lowpass', freq: 900 }, at });
        }
      }
      const last = honks[honks.length - 1];
      return last[0] + last[1] + 0.1;
    },
  },
  victory: {
    bus: 'music', variants: 1, gain: 0.93, maxVoices: 1, minInterval: 0.5, priority: 10, length: 4.6, global: true,
    duck: { db: -40, hold: 3.6 },
    play: (v) => playJingle(v, 'victory', v.key),
  },
  defeat: {
    bus: 'music', variants: 1, gain: 0.89, maxVoices: 1, minInterval: 0.5, priority: 10, length: 4.6, global: true,
    duck: { db: -40, hold: 3.6 },
    play: (v) => playJingle(v, 'defeat', v.key),
  },
  draw: {
    bus: 'music', variants: 1, gain: 0.93, maxVoices: 1, minInterval: 0.5, priority: 10, length: 3.8, global: true,
    duck: { db: -40, hold: 3 },
    play: (v) => playJingle(v, 'draw', v.key),
  },
  ping: {
    bus: 'sfx', variants: 2, gain: 0.92, maxVoices: 3, minInterval: 0.08, priority: 6, length: 1.2,
    play(v) {
      // Bright "pip-pip" with a short echo so it reads as a call-out.
      const ctx = v.ctx;
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.13;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 3500;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(wet);
      wet.connect(v.out);
      const bus = ctx.createGain();
      bus.connect(v.out);
      bus.connect(delay);
      const sv = sub(v, bus);
      const [a, b] = v.variant === 0 ? [9, 12] : [12, 9];
      const shift = Math.round(12 * Math.log2(v.pitch > 0 ? v.pitch : 1));
      marimba(sv, 0, scaleNote(v.key, a) + shift, 0.1, 0.55);
      marimba(sv, 0.075, scaleNote(v.key, b) + shift, 0.1, 0.6);
      return 0.9;
    },
  },

  // ---- UI -------------------------------------------------------------------------------------------
  uiMove: {
    bus: 'ui', variants: 3, gain: 1.23, maxVoices: 3, minInterval: 0.025, priority: 3, length: 0.4, global: true,
    play(v) {
      marimba(v, 0, pnMidi(v, [7, 8, 9][v.variant]), 0.05, 0.4);
      return 0.25;
    },
  },
  uiConfirm: {
    bus: 'ui', variants: 2, gain: 1.11, maxVoices: 3, minInterval: 0.04, priority: 4, length: 0.7, global: true,
    play(v) {
      const [a, b] = v.variant === 0 ? [7, 10] : [8, 10];
      marimba(v, 0, pnMidi(v, a), 0.05, 0.45);
      marimba(v, 0.06, pnMidi(v, b), 0.1, 0.55);
      tone(v, { freq: pn(v, b + 5), amp: perc(0.001, 0.05, 0.12), at: 0.06 });
      return 0.45;
    },
  },
  uiBack: {
    bus: 'ui', variants: 2, gain: 1.11, maxVoices: 3, minInterval: 0.04, priority: 4, length: 0.6, global: true,
    play(v) {
      const [a, b] = v.variant === 0 ? [8, 5] : [7, 4];
      marimba(v, 0, pnMidi(v, a), 0.05, 0.4);
      marimba(v, 0.065, pnMidi(v, b), 0.1, 0.42);
      return 0.45;
    },
  },
  uiError: {
    bus: 'ui', variants: 2, gain: 1.48, maxVoices: 2, minInterval: 0.08, priority: 4, length: 0.5, global: true,
    play(v) {
      // Gentle muted "bup-bup", not a harsh buzzer.
      const f = midiToHz(v.key - 5 + (v.variant ? -1 : 0));
      for (const at of [0, 0.1]) {
        tone(v, { type: 'square', freq: [[0, f * 1.04], [0.05, f]], amp: perc(0.003, 0.14, 0.08), filter: { type: 'lowpass', freq: 900 }, at });
        tone(v, { freq: f, amp: perc(0.003, 0.25, 0.09), at });
      }
      return 0.25;
    },
  },
  uiTab: {
    bus: 'ui', variants: 2, gain: 1.39, maxVoices: 2, minInterval: 0.03, priority: 3, length: 0.4, global: true,
    play(v) {
      // Page flip: woody tick + a higher blip.
      tone(v, { type: 'triangle', freq: [[0, 1250], [0.01, 1150]], amp: perc(0.0008, 0.22, 0.04) });
      marimba(v, 0.03, pnMidi(v, v.variant ? 11 : 10), 0.05, 0.35);
      return 0.3;
    },
  },
  uiAdjust: {
    bus: 'ui', variants: 2, gain: 1.79, maxVoices: 3, minInterval: 0.035, priority: 2, length: 0.2, global: true,
    play(v) {
      // Tiny tick; pitch option follows the slider value.
      const f = pn(v, 7 + v.variant);
      tone(v, { type: 'triangle', freq: f, amp: perc(0.001, 0.25, 0.05) });
      return 0.08;
    },
  },
  popup: {
    bus: 'ui', variants: 3, gain: 1.25, maxVoices: 3, minInterval: 0.04, priority: 3, length: 0.4, global: true,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.03);
      const [a, b] = [[380, 950], [420, 1050], [340, 880]][v.variant];
      // Bubbly "bloop".
      tone(v, { freq: [[0, a * p], [0.07, b * p]], amp: perc(0.004, 0.38, 0.13) });
      tone(v, { type: 'triangle', freq: [[0, a * 2 * p], [0.07, b * 2 * p]], amp: perc(0.004, 0.05, 0.08) });
      return 0.2;
    },
  },
};

/** Picks variation indices without immediate repeats. */
export class VariantPicker {
  private last = new Map<SfxId, number>();
  next(id: SfxId, rnd: () => number): number {
    const n = SFX_RECIPES[id].variants;
    if (n <= 1) return 0;
    const prev = this.last.get(id);
    let k = Math.floor(rnd() * n);
    if (k === prev) k = (k + 1 + Math.floor(rnd() * (n - 1))) % n;
    this.last.set(id, k);
    return k;
  }
}

