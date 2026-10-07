/**
 * Taunt sounds (owner addition): one short, cute, musical sound per taunt emote, timed to the
 * animation in src/render/models/tauntPoses.ts and written in the songs' key (`v.key`, the
 * pentatonic of the current track) so a taunt lands inside the music. No voice lines, nothing
 * crude: toy instruments, kazoo-like reeds, springs and sparkles.
 *
 *   tauntWiggle  a kazoo-ish reed bouncing "boop-be-doo-boop" with woodblock ticks (4 Hz sway)
 *   tauntBleh    a fluttery reed "brrrp" sliding down, then two cheeky plucks (no spit noise)
 *   tauntCash    paper flutter + three fanning swishes, a coin tink and a sparkle run
 *   tauntSquat   four springy boings climbing the scale, a twinkle at each bottom
 *   tauntZoom    tiny feet pattering faster and faster, a zip, then a "ta-da" stab
 *   tauntFlex    an inhale, a brass hit on the flex, three glints on the pumps
 *   tauntShrug   a lazy reed slide up and a soft "eh~" falling back down
 *
 * All positional (a rival's taunt comes from where it stands), low priority (scoring sounds win
 * the voice budget) and short enough to never mask gameplay. Gains are loudness-matched offline
 * (dev/audio-gallery audioQA renders): about -21 dB peak short-term RMS, just under a small-safe
 * recovery, so a taunt never out-shouts a score.
 */
import { noise, perc, ahr, tone } from './dsp';
import { block, clap, clarinet, glock, hat, marimba, pizz, brass, shaker, timpani, vibes } from './instruments';
import { jitter, rrange } from './rng';
import type { SfxRecipe, SfxVoice } from './sfxkit';
import { midiToHz, scaleNote } from './theory';

export type TauntSfxId = 'tauntWiggle' | 'tauntBleh' | 'tauntCash' | 'tauntSquat' | 'tauntZoom' | 'tauntFlex' | 'tauntShrug';

/** Light humanization: velocity +-6 %, onset +-4 ms (never before 0). */
const hv = (v: SfxVoice, vel: number): number => vel * jitter(v.rnd, 0.06);
const ht = (v: SfxVoice, at: number): number => Math.max(0, at + (v.rnd() * 2 - 1) * 0.004);
/** Scale degree of the current key (pentatonic), as Hz. */
const deg = (v: SfxVoice, d: number, oct = 0): number => midiToHz(scaleNote(v.key + oct * 12, d)) * v.pitch;
const degMidi = (v: SfxVoice, d: number, oct = 0): number => scaleNote(v.key + oct * 12, d);

/**
 * Kazoo-like reed note: a buzzy saw through a nasal band-pass with a little vibrato and a breath
 * of noise. `glideFrom` scoops in from another frequency.
 */
function kazoo(v: SfxVoice, at: number, f: number, dur: number, vel: number, glideFrom?: number): void {
  const freq = glideFrom ? ([[0, glideFrom], [0.035, f]] as const) : f;
  tone(v, {
    type: 'sawtooth',
    freq,
    amp: ahr(0.012, 0.11 * vel, Math.max(0.02, dur - 0.04), 0.05, 0.85),
    filter: { type: 'bandpass', freq: Math.min(4200, Math.max(900, f * 2.6)), q: 2.2 },
    vib: { rate: 7, cents: 22 },
    at,
  });
  tone(v, { type: 'square', freq, amp: ahr(0.012, 0.03 * vel, Math.max(0.02, dur - 0.04), 0.05, 0.85), filter: { type: 'lowpass', freq: 1800, q: 0.7 }, at });
  noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: 2400, q: 1.2 }], amp: perc(0.006, 0.02 * vel, dur * 0.8), at });
}

/** Springy "boing": a sine flicked upward with a wobble that settles. */
function boing(v: SfxVoice, at: number, f: number, vel: number): void {
  tone(v, {
    freq: [[0, f * 0.7], [0.05, f * 1.12], [0.11, f]],
    amp: perc(0.004, 0.24 * vel, 0.24),
    vib: { rate: 17, cents: [[0, 70], [0.25, 0]] },
    at,
  });
  tone(v, { type: 'triangle', freq: [[0, f * 1.4], [0.05, f * 2.24], [0.11, f * 2]], amp: perc(0.003, 0.05 * vel, 0.12), at });
}

/** Breathy swish (a fan stroke, a zip). */
function swish(v: SfxVoice, at: number, f0: number, f1: number, dur: number, amp: number): void {
  noise(v, {
    color: 'pink',
    filters: [{ type: 'bandpass', freq: [[0, f0], [dur, f1]], q: 1.6 }],
    amp: [[0, 0], [dur * 0.45, amp], [dur, 0]],
    at,
  });
}

export const TAUNT_RECIPES: Record<TauntSfxId, SfxRecipe> = {
  tauntWiggle: {
    bus: 'sfx', variants: 2, gain: 2.2, maxVoices: 3, minInterval: 0.25, priority: 3, length: 1.6, reverb: 0.15,
    play(v) {
      // Four sway beats (4 Hz) from 0.2 s, like the bottom swinging: boop-be-doo-boop.
      const tune = v.variant === 0 ? [4, 5, 4, 7] : [2, 4, 2, 5];
      const beat = 0.125;
      tune.forEach((d, i) => {
        const at = ht(v, 0.2 + i * beat * 2);
        const f = deg(v, d);
        kazoo(v, at, f, i === 3 ? 0.3 : 0.17, hv(v, i === 3 ? 1.1 : 0.95), i ? deg(v, tune[i - 1]!) : f * 0.9);
        block(v, at, 84 + (i % 2) * 5, 0.05, hv(v, 0.45));
        // Off-beat tail tick.
        if (i < 3) block(v, at + beat, 89, 0.05, hv(v, 0.25));
      });
      return 1.2;
    },
  },
  tauntBleh: {
    bus: 'sfx', variants: 2, gain: 0.64, maxVoices: 3, minInterval: 0.25, priority: 3, length: 1.3, reverb: 0.12,
    play(v) {
      // The tongue pops out at ~0.15 s: a fluttering reed "brrrp" bending down a fourth.
      const top = deg(v, v.variant === 0 ? 7 : 5);
      const bot = top * 0.75;
      tone(v, {
        type: 'sawtooth',
        freq: [[0, top], [0.12, top], [0.42, bot]],
        amp: ahr(0.01, 0.1, 0.32, 0.08, 0.9),
        filter: { type: 'lowpass', freq: [[0, 2600], [0.42, 900]], q: 3 },
        vib: { rate: 31, cents: [[0, 160], [0.42, 90]] },
        at: 0.14,
      });
      tone(v, { type: 'square', freq: [[0, top / 2], [0.42, bot / 2]], amp: ahr(0.01, 0.04, 0.3, 0.08, 0.9), filter: { type: 'lowpass', freq: 900, q: 0.7 }, vib: { rate: 31, cents: 120 }, at: 0.14 });
      // "Nyah" wobble of the head: two cheeky plucks, up then down.
      pizz(v, ht(v, 0.66), degMidi(v, 7), 0.1, hv(v, 0.7));
      pizz(v, ht(v, 0.82), degMidi(v, 5), 0.1, hv(v, 0.6));
      block(v, 0.66, 88, 0.05, hv(v, 0.3));
      return 1.0;
    },
  },
  tauntCash: {
    bus: 'sfx', variants: 2, gain: 1.2, maxVoices: 3, minInterval: 0.25, priority: 3, length: 1.9, reverb: 0.18,
    play(v) {
      // Whip-out (0.3 s): a quick paper riffle.
      for (let i = 0; i < 9; i++) {
        noise(v, {
          color: 'white',
          filters: [{ type: 'bandpass', freq: rrange(v.rnd, 2600, 4600), q: 2.2 }],
          amp: perc(0.001, rrange(v.rnd, 0.05, 0.09), 0.012),
          at: 0.26 + i * 0.018,
        });
      }
      // Coin tink + a short sparkle run up the scale.
      tone(v, { freq: deg(v, 10), amp: perc(0.001, 0.12, 0.3), at: 0.36 });
      tone(v, { freq: deg(v, 10) * 2.76, amp: perc(0.001, 0.04, 0.14), at: 0.36 });
      [7, 9, 10, 12].forEach((d, i) => glock(v, ht(v, 0.42 + i * 0.05), degMidi(v, d), 0.1, hv(v, 0.28)));
      // Three fanning swishes on the 3 Hz fan strokes.
      for (let i = 0; i < 3; i++) {
        const at = 0.5 + i * 0.333;
        swish(v, at, 1400, 3400, 0.22, 0.085);
        for (let k = 0; k < 4; k++) noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 3800, q: 3 }], amp: perc(0.001, 0.035, 0.01), at: at + 0.04 + k * 0.03 });
      }
      if (v.variant === 1) marimba(v, ht(v, 1.48), degMidi(v, 5), 0.1, hv(v, 0.45));
      return 1.6;
    },
  },
  tauntSquat: {
    bus: 'sfx', variants: 2, gain: 1.0, maxVoices: 3, minInterval: 0.25, priority: 3, length: 1.7, reverb: 0.12,
    play(v) {
      // Bounces at 0.1 + k * 0.34 s (SQUAT_BOUNCE): squish at the bottom, boing on the spring up.
      const climb = v.variant === 0 ? [0, 1, 2, 4] : [0, 2, 1, 4];
      for (let k = 0; k < 4; k++) {
        const t0 = 0.1 + k * 0.34;
        noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 700 }], amp: perc(0.002, 0.06, 0.05), at: t0 + 0.08 });
        boing(v, ht(v, t0 + 0.15), deg(v, climb[k]!, 0), hv(v, 0.8 + k * 0.06));
        glock(v, ht(v, t0 + 0.12), degMidi(v, 10 + climb[k]!), 0.1, hv(v, 0.16));
      }
      return 1.55;
    },
  },
  tauntZoom: {
    bus: 'sfx', variants: 2, gain: 0.72, maxVoices: 3, minInterval: 0.25, priority: 3, length: 1.5, reverb: 0.15,
    play(v) {
      // Tiny feet pattering faster and faster for the in-place sprint (0.05-0.65 s).
      let at = 0.05;
      let gap = 0.075;
      let i = 0;
      while (at < 0.64) {
        block(v, at, 86 + (i % 2) * 3, 0.04, hv(v, 0.22 + 0.2 * (at / 0.64)));
        hat(v, at, 0, 0.04, hv(v, 0.18));
        at += gap;
        gap = Math.max(0.038, gap * 0.92);
        i++;
      }
      // Zip into the pose (~0.7 s), then the stab.
      tone(v, { type: 'triangle', freq: [[0, deg(v, 0)], [0.12, deg(v, 10)]], amp: [[0, 0], [0.03, 0.09], [0.12, 0.06], [0.15, 0]], vib: { rate: 10, cents: 20 }, at: 0.58 });
      swish(v, 0.58, 900, 5200, 0.16, 0.07);
      const stab = 0.72;
      const ch = v.variant === 0 ? [0, 4, 7] : [5, 9, 12];
      for (const st of ch) marimba(v, ht(v, stab), v.key + 12 + st, 0.1, hv(v, 0.55));
      glock(v, stab, v.key + 24 + ch[2]!, 0.1, hv(v, 0.25));
      clap(v, stab, 0, 0.1, hv(v, 0.35));
      return 1.2;
    },
  },
  tauntFlex: {
    bus: 'sfx', variants: 2, gain: 0.55, maxVoices: 3, minInterval: 0.25, priority: 3, length: 1.9, reverb: 0.22,
    play(v) {
      // Inhale (the anticipation), the flex hit at ~0.3 s, glints on the three pumps.
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: [[0, 700], [0.28, 1600]], q: 1.2 }], amp: [[0, 0], [0.24, 0.05], [0.3, 0]] });
      const hit = 0.3;
      const ch = v.variant === 0 ? [0, 4, 7] : [-3, 0, 4];
      for (const st of ch) brass(v, ht(v, hit), v.key + st, 0.22, hv(v, 0.55));
      brass(v, ht(v, hit), v.key - 12, 0.22, hv(v, 0.45));
      timpani(v, hit, v.key - 24, 0.4, hv(v, 0.5));
      for (const [k, at] of [0.64, 1.0, 1.36].entries()) {
        glock(v, ht(v, at), degMidi(v, 10 + k), 0.1, hv(v, 0.3));
        tone(v, { freq: deg(v, 12 + k) * 2, amp: perc(0.001, 0.035, 0.18), vib: { rate: 22, cents: 30 }, at });
      }
      return 1.6;
    },
  },
  tauntShrug: {
    bus: 'sfx', variants: 2, gain: 1.0, maxVoices: 3, minInterval: 0.25, priority: 3, length: 1.6, reverb: 0.18,
    play(v) {
      // Shoulders rise (0.12-0.55 s): a lazy reed slide up; "eh~" falling back on the drop.
      const lo = deg(v, v.variant === 0 ? 2 : 4, -1);
      const hi = deg(v, v.variant === 0 ? 4 : 5, -1);
      tone(v, {
        type: 'square',
        freq: [[0, lo], [0.36, hi]],
        amp: ahr(0.06, 0.08, 0.3, 0.1, 0.9),
        filter: { type: 'lowpass', freq: 1300, q: 0.6 },
        vib: { rate: 4.5, cents: [[0, 0], [0.3, 14]] },
        at: 0.14,
      });
      shaker(v, 0.5, 0, 0.1, hv(v, 0.25));
      clarinet(v, ht(v, 0.98), degMidi(v, 4, -1), 0.14, hv(v, 0.55));
      vibes(v, ht(v, 1.12), degMidi(v, 2, -1), 0.25, hv(v, 0.45));
      return 1.45;
    },
  },
};
