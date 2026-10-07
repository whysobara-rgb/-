/**
 * Content 2.0 item sounds (C9, wave 1): the 뿅망치 (squeaky toy hammer), the 황금 뿅망치 and the
 * supply balloons (보급 풍선). Toy-box materials only: an accordion-bellows rubber squeak, a hollow
 * plastic head, springs and bells. No realistic impacts, nothing that sounds like a weapon.
 *
 *   hammerWindup     the 0.1 s wind-up (6 ticks): bellows squeezing, a squeak rising in key — the
 *                    audible telegraph a player can dodge on
 *   hammerSwing      the 9-tick swing / lunge: a light rubbery whoosh
 *   hammerBonk       "뿅!": hollow plastic knock + the bellows squeak, pitched in the song's key
 *   hammerClash      "챙!": two hammers meeting in the same substep (both bounce)
 *   itemPickup       squeak-squeak + a bright glock "ting" (touch pickup, no button)
 *   itemDrop         knocked out of the paws: plastic clatter bouncing away
 *   itemPoof         a ground item's lifetime runs out / a held item expires: a soft puff
 *   supplyIncoming   the 3 s drop warning: a "ding-dong" motif, balloon rubber creak and a slide
 *                    whistle gliding down while the crate descends
 *   supplyLand       the crate touching down: thud, the balloon popping, a sparkle
 *   goldHammerSting  the golden hammer is announced (3 s before it lands on the axis pad): a
 *                    timpani roll + glock tremolo left unresolved, global, no duck. The "coming"
 *                    half of a pair: F8's stingGoldHammer (brass + bell, ducked) is the "landed"
 *                    half and resolves it
 *
 * Tonal parts use the current music key (`v.key`, the F major pentatonic of every track, see
 * ./theory.ts) so the squeaks sit inside the music. Convention: `step <= GOLD_STEP` marks the
 * golden hammer (two scale degrees lower = still in key, plus a bell shimmer); `step > 0` lifts a
 * bonk (a home run). Gains are loudness-matched offline through the production mixer (see
 * test/unit/audio-content.test.ts and the C9 report): a bonk sits with the dash hit, pickups and
 * swings well under it, the gold sting under the bank callout.
 */
import { noise, partials, perc, tone, type Partial } from './dsp';
import { glock, marimba, snare, timpani } from './instruments';
import { jitter, rrange } from './rng';
import { crackles, thump, type SfxRecipe, type SfxVoice } from './sfxkit';
import { midiToHz, scaleNote } from './theory';

export type ItemSfxId =
  | 'hammerWindup'
  | 'hammerSwing'
  | 'hammerBonk'
  | 'hammerClash'
  | 'itemPickup'
  | 'itemDrop'
  | 'itemPoof'
  | 'supplyIncoming'
  | 'supplyLand'
  | 'goldHammerSting';

/** `step` the director passes for the golden hammer (two pentatonic degrees down: still in key). */
export const GOLD_STEP = -2;

const isGold = (v: SfxVoice): boolean => v.step <= GOLD_STEP;
/** Scale degree `d` (+ the voice's step) of the current key as Hz, times the pitch option. */
const deg = (v: SfxVoice, d: number): number => midiToHz(scaleNote(v.key, d + v.step)) * v.pitch;
const degMidi = (v: SfxVoice, d: number): number => scaleNote(v.key, d + v.step);
/** Light humanization: velocity +-6 %, onset +-4 ms (never before 0). */
const hv = (v: SfxVoice, vel: number): number => vel * jitter(v.rnd, 0.06);
const ht = (v: SfxVoice, at: number): number => Math.max(0, at + (v.rnd() * 2 - 1) * 0.004);

/**
 * The accordion-bellows rubber squeak at the heart of the toy hammer: a nasal square through a
 * band-pass, fast rubbery vibrato, the pitch following `contour` (pairs of [t, ratio] of `f`).
 */
function squeak(v: SfxVoice, at: number, f: number, contour: readonly (readonly [number, number])[], dur: number, amp: number): void {
  const freq = contour.map(([t, r]) => [t, f * r] as const);
  tone(v, {
    type: 'square',
    freq,
    amp: [[0, 0], [0.008, amp], [dur * 0.7, amp * 0.8], [dur, 0]],
    filter: { type: 'bandpass', freq: Math.min(5200, f * 2.1), q: 2.4 },
    vib: { rate: 31, cents: 38 },
    at,
  });
  tone(v, { type: 'triangle', freq, amp: [[0, 0], [0.006, amp * 0.9], [dur * 0.75, amp * 0.6], [dur, 0]], vib: { rate: 31, cents: 38 }, at });
}

/** Breath of the bellows (air through a rubber valve). */
function bellows(v: SfxVoice, at: number, dur: number, amp: number, up: boolean): void {
  noise(v, {
    color: 'pink',
    filters: [{ type: 'bandpass', freq: up ? [[0, 900], [dur, 2400]] : [[0, 2200], [dur, 900]], q: 1.3 }],
    amp: [[0, 0], [dur * 0.35, amp], [dur, 0]],
    at,
  });
}

/** Hollow plastic hammer head striking: a pitched knock falling fast + a click. */
function plasticKnock(v: SfxVoice, at: number, f: number, amp: number): void {
  tone(v, { type: 'triangle', freq: [[0, f], [0.055, f * 0.52]], amp: perc(0.0015, amp, 0.11), at });
  tone(v, { freq: [[0, f * 0.5], [0.08, f * 0.3]], amp: perc(0.002, amp * 0.8, 0.13), at });
  noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 2600, q: 1.1 }], amp: perc(0.0006, amp * 0.55, 0.018), at });
}

/** Golden shimmer (a small bell chord ringing after a gold hammer action). */
function goldShimmer(v: SfxVoice, at: number, amp: number): void {
  const bell: Partial[] = [
    [1, 0.22, 0.9],
    [2.76, 0.07, 0.3],
    [5.4, 0.03, 0.12],
  ];
  partials(v, midiToHz(scaleNote(v.key + 24, 2)), bell, { at, gain: amp });
  partials(v, midiToHz(scaleNote(v.key + 24, 4)), bell, { at: at + 0.035, gain: amp * 0.8 });
}

export const ITEM_RECIPES: Record<ItemSfxId, SfxRecipe> = {
  hammerWindup: {
    bus: 'sfx', variants: 3, gain: 1.78, maxVoices: 2, minInterval: 0.05, priority: 6, length: 0.4,
    play(v) {
      // 6 ticks = 0.1 s: the bellows squeeze while the hammer goes up ("뀨잇~"), rising a fourth in
      // key, so a player hears the swing coming and can sidestep.
      const f = deg(v, [7, 6, 8][v.variant]!) * jitter(v.rnd, 0.015);
      bellows(v, 0, 0.12, 0.09, true);
      squeak(v, 0.005, f, [[0, 0.72], [0.09, 1], [0.12, 1.04]], 0.13, 0.085);
      // Paw tightening on the handle: a tiny rubber creak.
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: rrange(v.rnd, 1800, 2600), q: 5 }], amp: perc(0.002, 0.05, 0.03), at: 0.01 });
      if (isGold(v)) glock(v, 0.08, degMidi(v, 14), 0.1, hv(v, 0.25));
      return 0.22;
    },
  },
  hammerSwing: {
    bus: 'sfx', variants: 3, gain: 2.14, maxVoices: 2, minInterval: 0.05, priority: 4, length: 0.4,
    play(v) {
      // The lunge: a light whoosh (it is a toy) and a soft rubbery wobble of the accordion head.
      const p = v.pitch * jitter(v.rnd, 0.05) * (isGold(v) ? 0.85 : 1);
      const dur = [0.17, 0.2, 0.15][v.variant]! * jitter(v.rnd, 0.06);
      noise(v, {
        color: 'pink',
        filters: [{ type: 'bandpass', freq: [[0, 600 * p], [dur * 0.45, 2600 * p], [dur, 900 * p]], q: 1.5 }],
        amp: [[0, 0], [dur * 0.4, 0.5], [dur, 0]],
      });
      tone(v, { type: 'triangle', freq: [[0, 210 * p], [dur, 150 * p]], amp: [[0, 0], [0.02, 0.06], [dur, 0]], vib: { rate: 14, cents: 60 } });
      return dur + 0.04;
    },
  },
  hammerBonk: {
    bus: 'sfx', variants: 4, gain: 0.88, maxVoices: 2, minInterval: 0.03, priority: 7, length: 1.1, reverb: 0.14,
    play(v) {
      // "뿅!": the hollow plastic head knocks, then the bellows squeeze out a squeak that pops up a
      // fifth in key and falls back (the accordion springing open). Pass volume for size.
      const gold = isGold(v);
      const p = v.pitch * jitter(v.rnd, 0.03);
      plasticKnock(v, 0, [640, 560, 720, 600][v.variant]! * p * (gold ? 0.85 : 1), 0.5);
      const f = deg(v, [9, 10, 8, 9][v.variant]!) * jitter(v.rnd, 0.012);
      const contours = [
        [[0, 0.75], [0.035, 1.5], [0.15, 1.0]],
        [[0, 0.8], [0.03, 1.33], [0.07, 1.5], [0.17, 1.12]],
        [[0, 1.0], [0.04, 1.5], [0.13, 1.25]],
        [[0, 0.67], [0.03, 1.33], [0.09, 1.0], [0.16, 1.33]],
      ] as const;
      squeak(v, 0.012, f, contours[v.variant]!, 0.19, 0.12);
      bellows(v, 0.012, 0.16, 0.07, false);
      // A little spring left wobbling in the head.
      tone(v, { freq: f * 0.5, amp: perc(0.004, 0.05, 0.3), vib: { rate: 19, cents: [[0, 120], [0.3, 10]] }, at: 0.05 });
      if (gold) goldShimmer(v, 0.04, 0.9);
      if (v.step > 0) {
        // Home run: an extra squeak an octave up and a woodblock "crack of the bat".
        squeak(v, 0.17, f * 2, [[0, 1], [0.06, 1.25], [0.14, 1.5]], 0.16, 0.06);
        marimba(v, 0.16, degMidi(v, 12), 0.1, hv(v, 0.4));
      }
      return gold ? 1.0 : v.step > 0 ? 0.42 : 0.36;
    },
  },
  hammerClash: {
    bus: 'sfx', variants: 3, gain: 1.08, maxVoices: 2, minInterval: 0.06, priority: 7, length: 1.0, reverb: 0.2,
    play(v) {
      // "챙!": two toy heads meet: a bright struck-metal ring (the accordion frames), a spark burst
      // and both squeaks at once, a third apart in key, bending away from each other.
      const p = v.pitch * jitter(v.rnd, 0.03);
      noise(v, { color: 'white', filters: [{ type: 'highpass', freq: 2500 }], amp: perc(0.0005, 0.4, 0.03) });
      const ring: Partial[] = [
        [1, 0.2, 0.55],
        [2.41, 0.11, 0.32],
        [3.77, 0.07, 0.2],
        [5.93, 0.04, 0.11],
      ];
      const base = [1180, 1320, 1050][v.variant]! * p;
      partials(v, base, ring, { gain: 0.9 });
      partials(v, base * 1.06, ring, { gain: 0.55, at: 0.004 });
      crackles(v, 9, 0.005, 0.18, { fLo: 3500, fHi: 8000, ampLo: 0.05, ampHi: 0.14, durLo: 0.003, durHi: 0.012, skew: 1.6, panWidth: 0.6 });
      const f = deg(v, 9);
      squeak(v, 0.01, f, [[0, 1], [0.12, 0.84]], 0.14, 0.06);
      squeak(v, 0.01, deg(v, 11), [[0, 1], [0.12, 1.12]], 0.14, 0.05);
      return 0.65;
    },
  },
  itemPickup: {
    bus: 'sfx', variants: 3, gain: 1.42, maxVoices: 2, minInterval: 0.05, priority: 6, length: 0.8, reverb: 0.15,
    play(v) {
      // Paws close on the handle: two quick squeaks ("뾱뾱") and a bright glock "ting-ting".
      const f = deg(v, 7) * jitter(v.rnd, 0.015);
      squeak(v, 0, f, [[0, 0.9], [0.05, 1.12]], 0.06, 0.06);
      squeak(v, 0.075, f * 1.125, [[0, 0.9], [0.05, 1.33]], 0.07, 0.065);
      const run = [
        [9, 12],
        [10, 12],
        [9, 11, 12],
      ][v.variant]!;
      run.forEach((d, i) => glock(v, ht(v, 0.13 + i * 0.05), degMidi(v, d), 0.1, hv(v, 0.42 - i * 0.04), i % 2 ? 0.25 : -0.25));
      return 0.55;
    },
  },
  itemDrop: {
    bus: 'sfx', variants: 3, gain: 1.32, maxVoices: 2, minInterval: 0.05, priority: 5, length: 0.8,
    play(v) {
      // Knocked out of the paws: the plastic toy bounces away (three hops, each shorter and softer)
      // with a deflating squeak.
      const p = v.pitch * jitter(v.rnd, 0.05);
      const hops = [
        [0, 1],
        [0.16, 0.6],
        [0.27, 0.35],
        [0.34, 0.18],
      ] as const;
      hops.forEach(([at, a], i) => {
        if (v.variant === 2 && i === 3) return;
        const f = [520, 600, 470][v.variant]! * p * (1 + i * 0.06);
        tone(v, { type: 'triangle', freq: [[0, f], [0.04, f * 0.6]], amp: perc(0.001, 0.32 * a, 0.07), at: ht(v, at) });
        noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 2200 * p, q: 1.5 }], amp: perc(0.0006, 0.16 * a, 0.012), at });
      });
      squeak(v, 0.03, deg(v, 6), [[0, 1.1], [0.2, 0.7]], 0.22, 0.04);
      return 0.5;
    },
  },
  itemPoof: {
    bus: 'sfx', variants: 2, gain: 1.1, maxVoices: 2, minInterval: 0.08, priority: 3, length: 0.8, reverb: 0.2,
    play(v) {
      // Lifetime over: a soft puff of smoke and a little descending twinkle ("gone~").
      const p = v.pitch * jitter(v.rnd, 0.05);
      noise(v, {
        color: 'pink',
        filters: [{ type: 'lowpass', freq: [[0, 3800 * p], [0.25, 500 * p]], q: 0.8 }],
        amp: [[0, 0], [0.015, 0.32], [0.3, 0]],
      });
      tone(v, { freq: [[0, 330 * p], [0.12, 180 * p]], amp: perc(0.004, 0.12, 0.12) });
      const fall = v.variant === 0 ? [11, 9, 7] : [12, 10, 7];
      fall.forEach((d, i) => glock(v, ht(v, 0.08 + i * 0.06), degMidi(v, d), 0.1, hv(v, 0.2 - i * 0.04)));
      return 0.55;
    },
  },
  supplyIncoming: {
    bus: 'sfx', variants: 2, gain: 0.95, maxVoices: 2, minInterval: 0, priority: 6, length: 2.9, reverb: 0.25,
    play(v) {
      // The 3 s warning while the crate sinks under its balloon: a "ding-dong" motif (the supply
      // drop's own two notes, in key), the balloon's rubber creak, then a slide whistle gliding
      // down to the pad, and the ropes fluttering in the wind. Ends before the landing thud.
      const [a, b] = v.variant === 0 ? [11, 9] : [12, 10];
      glock(v, 0, degMidi(v, a), 0.2, hv(v, 0.42));
      glock(v, 0.2, degMidi(v, b), 0.3, hv(v, 0.42));
      marimba(v, 0, degMidi(v, a - 5), 0.2, hv(v, 0.35));
      marimba(v, 0.2, degMidi(v, b - 5), 0.3, hv(v, 0.35));
      // Balloon rubber creak (two short squeaky rubs).
      for (const at of [0.55, 0.78]) {
        noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: rrange(v.rnd, 1100, 1500), q: 7 }], amp: [[0, 0], [0.03, 0.08], [0.1, 0]], at });
      }
      // Slide whistle down (top of the scale to the tonic) with a gentle vibrato.
      const top = deg(v, 14);
      const bot = deg(v, 5);
      tone(v, {
        freq: [[0, top], [1.55, bot]],
        amp: [[0, 0], [0.1, 0.07], [1.3, 0.06], [1.6, 0]],
        vib: { rate: 6, cents: 22 },
        at: 0.75,
      });
      tone(v, { type: 'triangle', freq: [[0, top * 2], [1.55, bot * 2]], amp: [[0, 0], [0.1, 0.012], [1.6, 0]], at: 0.75 });
      // Rope / fabric flutter in the wind.
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: 700, q: 0.9 }], amp: [[0, 0], [0.6, 0.06], [1.8, 0.08], [2.4, 0]], at: 0.3 });
      return 2.75;
    },
  },
  supplyLand: {
    bus: 'sfx', variants: 3, gain: 0.71, maxVoices: 2, minInterval: 0, priority: 6, length: 0.9, reverb: 0.2,
    play(v) {
      // Touch-down: a wooden crate thud, the balloon popping ("펑!") as it lets go, a sparkle.
      const p = v.pitch * jitter(v.rnd, 0.04);
      thump(v, 0, 150 * p, 70 * p, 0.45, 0.16);
      tone(v, { type: 'triangle', freq: [[0, 420 * p], [0.05, 260 * p]], amp: perc(0.001, 0.15, 0.06) });
      const popAt = [0.06, 0.08, 0.05][v.variant]!;
      noise(v, { color: 'white', filters: [{ type: 'highpass', freq: 1400 }], amp: perc(0.0004, 0.32, 0.03), at: popAt });
      tone(v, { freq: [[0, 900 * p], [0.05, 300 * p]], amp: perc(0.002, 0.14, 0.06), at: popAt });
      [10, 12].forEach((d, i) => glock(v, ht(v, 0.16 + i * 0.07), degMidi(v, d + (v.variant === 1 ? 1 : 0)), 0.1, hv(v, 0.3)));
      return 0.6;
    },
  },
  goldHammerSting: {
    bus: 'sfx', variants: 2, gain: 0.51, maxVoices: 1, minInterval: 1, priority: 7, length: 2.0, reverb: 0.3, global: true,
    play(v) {
      // 황금 뿅망치 on its way (3 s before it lands): the "coming" half of a deliberate pair. The
      // "landed" half is F8's stingGoldHammer (sfxTension.ts: glock run + bell + brass on the
      // tonic, with a duck). So this one is lighter and left OPEN: no brass, no duck, a timpani
      // roll swelling on the dominant, a glock tremolo hanging on the 5th / 6th degrees, a gold
      // shimmer and a short rising squeak. The landing sting resolves it.
      const k = v.key;
      squeak(v, 0, deg(v, 7), [[0, 0.75], [0.08, 1.0]], 0.1, 0.045);
      // Timpani roll on the dominant (a fifth above the low tonic), crescendo then a soft accent.
      const n = 12;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        timpani(v, 0.08 + i * 0.055, k - 24 + 7, 0.3, hv(v, 0.12 + 0.3 * u), i % 2 ? 0.12 : -0.12);
      }
      timpani(v, 0.08 + n * 0.055, k - 24 + 7, 0.8, hv(v, 0.5));
      snare(v, 0.08 + n * 0.055, 0, 0.1, hv(v, 0.18));
      // Glock tremolo between two upper degrees, getting louder, never landing on the tonic.
      const [a, b] = v.variant === 0 ? [11, 12] : [12, 13];
      for (let i = 0; i < 8; i++) glock(v, ht(v, 0.12 + i * 0.07), scaleNote(k, i % 2 ? b : a), 0.08, hv(v, 0.1 + i * 0.022), i % 2 ? 0.3 : -0.3);
      goldShimmer(v, 0.1 + n * 0.055, 0.55);
      return 0.1 + n * 0.055 + 0.9;
    },
  },
};
