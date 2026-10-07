/**
 * Police sound effects (owner addition beyond doc v0.5). Puppy cops in a toy town: everything is
 * cartoon-sized and synthesized (no voice samples). Tonal bits use the songs' pentatonic (`v.key`).
 *
 *   policeSkid     drift stop at the curb: tire squeal, gravel, suspension "bwong"
 *   carDoor        door slam "ka-chunk" (one per officer hopping out)
 *   carVroom       the car revving off at the end of the shift
 *   policeWhistle  short pea-whistle tweet (higher, shorter and chirpier than the referee whistle)
 *   policeBark     a cartoon "멈춰!" chirp: two formant-synthesized syllables on a puppy voice
 *   tackleWhoosh   the lunge (a diving whoosh)
 *   tackleHit      comic thump + tumble when the lunge lands
 *   tackleMiss     soft swish and a belly slide when it whiffs
 *   policeStun     an officer knocked over by a dash: flop, boing, birdies circling
 *   policePhew     cheeky "phew~" stinger when the last car drives off
 *
 * The police chatter (skid, doors, revving off, whistles, "멈춰!") runs on the mixer's ambience
 * sub-bus with the sirens and alarm bells, ducked under the scoring sounds. The tackle and stun
 * sounds stay on the plain sfx bus: they are gameplay feedback.
 */
import { ahr, creakBuffer, noise, perc, scrapeBuffer, tone, type Env } from './dsp';
import { block, glock, marimba, pizz } from './instruments';
import { jitter, rrange } from './rng';
import { pn, pnMidi, thump, type SfxRecipe, type SfxVoice } from './sfxkit';

export type PoliceSfxId =
  | 'policeSkid'
  | 'carDoor'
  | 'carVroom'
  | 'policeWhistle'
  | 'policeBark'
  | 'tackleWhoosh'
  | 'tackleHit'
  | 'tackleMiss'
  | 'policeStun'
  | 'policePhew';

/** Scale an envelope's times (and optionally its values). */
const scaleEnv = (env: Env, ts: number, vs = 1): Env => env.map(([t, x]) => [t * ts, x * vs] as const);

interface Syllable {
  /** Start (s) and time scale. */
  at: number;
  ts: number;
  f0: Env;
  f1: Env;
  f2: Env;
  f3: number;
  /** Overall lowpass: closes for the nasal "m" murmur. */
  lp: Env;
  amp: Env;
  /** Puppy growl (fast vibrato) depth in cents. */
  growl: number;
}

/**
 * One formant-synthesized syllable: a sawtooth "voice" through three parallel band-passes
 * (F1-F3) and a lowpass, all automated. Cartoon-intelligible at best — a chirp shaped like a word.
 */
function syllable(v: SfxVoice, s: Syllable, p: number): void {
  const ctx = v.ctx;
  const t = v.t + s.at;
  const end = t + s.amp[s.amp.length - 1][0] * s.ts;
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  const fEnv = scaleEnv(s.f0, s.ts, p);
  let prevT = -1;
  for (const [i, [tt, f]] of fEnv.entries()) {
    const at = Math.max(t + tt, prevT + 1e-4);
    if (i === 0) src.frequency.setValueAtTime(f, at);
    else src.frequency.exponentialRampToValueAtTime(f, at);
    prevT = at;
  }
  const growl = ctx.createOscillator();
  growl.frequency.setValueAtTime(rrange(v.rnd, 26, 34), t);
  const growlDepth = ctx.createGain();
  growlDepth.gain.setValueAtTime(s.growl, t);
  growl.connect(growlDepth);
  growlDepth.connect(src.detune);
  const sum = ctx.createGain();
  sum.gain.value = 1;
  const formants: [Env | number, number, number][] = [
    [s.f1, 4, 1],
    [s.f2, 6, 0.55],
    [s.f3, 8, 0.22],
  ];
  for (const [f, q, a] of formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    if (typeof f === 'number') bp.frequency.setValueAtTime(f * Math.sqrt(p), t);
    else {
      const env = scaleEnv(f, s.ts, Math.sqrt(p));
      env.forEach(([tt, x], i) => (i === 0 ? bp.frequency.setValueAtTime(x, t + tt) : bp.frequency.linearRampToValueAtTime(x, t + tt)));
    }
    const g = ctx.createGain();
    g.gain.value = a * (q / 2);
    src.connect(bp);
    bp.connect(g);
    g.connect(sum);
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  scaleEnv(s.lp, s.ts).forEach(([tt, x], i) => (i === 0 ? lp.frequency.setValueAtTime(x, t + tt) : lp.frequency.linearRampToValueAtTime(x, t + tt)));
  const amp = ctx.createGain();
  amp.gain.value = 0;
  scaleEnv(s.amp, s.ts).forEach(([tt, x], i) => (i === 0 ? amp.gain.setValueAtTime(x, t + tt) : amp.gain.linearRampToValueAtTime(x, t + tt)));
  sum.connect(lp);
  lp.connect(amp);
  amp.connect(v.out);
  src.start(t);
  growl.start(t);
  src.stop(end + 0.02);
  growl.stop(end + 0.02);
}

/** "멈" — m, open vowel (어), m. */
const MEOM: Omit<Syllable, 'at' | 'ts'> = {
  f0: [[0, 470], [0.06, 545], [0.15, 500]],
  f1: [[0, 300], [0.035, 660], [0.11, 620], [0.15, 300]],
  f2: [[0, 900], [0.035, 1150], [0.11, 1100], [0.15, 900]],
  f3: 2600,
  lp: [[0, 520], [0.035, 4200], [0.11, 4200], [0.15, 600]],
  amp: [[0, 0], [0.015, 0.22], [0.04, 0.5], [0.11, 0.45], [0.15, 0.15], [0.17, 0]],
  growl: 18,
};
/** "춰" — (ch), w-glide into the open vowel, falling like an exclamation. */
const CHWO: Omit<Syllable, 'at' | 'ts'> = {
  f0: [[0, 700], [0.03, 770], [0.23, 460]],
  f1: [[0, 330], [0.05, 660], [0.23, 600]],
  f2: [[0, 760], [0.05, 1120], [0.23, 1040]],
  f3: 2750,
  lp: [[0, 4500], [0.23, 3000]],
  amp: [[0, 0], [0.02, 0.55], [0.12, 0.5], [0.22, 0.2], [0.27, 0]],
  growl: 28,
};
/** "멍!" — a puppy yip before the call (variation 2). */
const MEONG: Omit<Syllable, 'at' | 'ts'> = {
  f0: [[0, 640], [0.03, 820], [0.1, 600]],
  f1: [[0, 320], [0.025, 700], [0.08, 600], [0.1, 300]],
  f2: [[0, 950], [0.025, 1250], [0.1, 1000]],
  f3: 2800,
  lp: [[0, 600], [0.025, 4200], [0.08, 4000], [0.1, 700]],
  amp: [[0, 0], [0.012, 0.45], [0.07, 0.4], [0.1, 0.1], [0.11, 0]],
  growl: 30,
};

export const POLICE_RECIPES: Record<PoliceSfxId, SfxRecipe> = {
  policeSkid: {
    bus: 'sfx', ambience: true, variants: 3, gain: 0.9, maxVoices: 2, minInterval: 0.3, priority: 7, length: 1.3, reverb: 0.15,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.03);
      const D = [0.5, 0.42, 0.58][v.variant] * jitter(v.rnd, 0.05);
      const f0 = [1650, 1450, 1800][v.variant] * p;
      // Tire squeal: a chattering tonal squeal sliding down as the car stops.
      const sq: Env = [[0, f0 * 1.08], [D * 0.3, f0], [D, f0 * 0.82]];
      tone(v, {
        type: 'sawtooth',
        freq: sq,
        amp: [[0, 0], [0.02, 0.09], [D * 0.75, 0.08], [D, 0]],
        filter: { type: 'bandpass', freq: f0 * 1.1, q: 3 },
        vib: { rate: rrange(v.rnd, 21, 26), cents: 55 },
      });
      tone(v, { freq: sq, amp: [[0, 0], [0.02, 0.12], [D * 0.7, 0.1], [D, 0]], vib: { rate: rrange(v.rnd, 29, 33), cents: 35 } });
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 2800, q: 1.5 }], amp: [[0, 0], [0.03, 0.13], [D * 0.8, 0.09], [D + 0.05, 0]] });
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 1100 }], amp: [[0, 0], [0.04, 0.2], [D, 0]] });
      // The car rocks on its springs as it stops.
      const at = D - 0.04;
      tone(v, { freq: [[0, 135 * p], [0.3, 95 * p]], amp: perc(0.006, 0.3, 0.32), vib: { rate: 7.5, cents: [[0, 120], [0.3, 10]] }, at });
      thump(v, at, 120 * p, 60 * p, 0.35, 0.15);
      noise(v, { buffer: creakBuffer(v.ctx), rate: 0.9, filters: [{ type: 'bandpass', freq: 900, q: 2 }], amp: [[0, 0], [0.03, 0.16], [0.25, 0]], at: at + 0.02 });
      return D + 0.4;
    },
  },
  carDoor: {
    bus: 'sfx', ambience: true, variants: 3, gain: 1.0, maxVoices: 4, minInterval: 0.06, priority: 4, length: 0.5,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.05);
      // Variation 2: a little hinge squeak first.
      const at = v.variant === 2 ? 0.08 : 0;
      if (v.variant === 2) tone(v, { freq: [[0, 900 * p], [0.07, 1350 * p]], amp: perc(0.01, 0.05, 0.07) });
      // "Ka-chunk": latch click, then the panel thump with a short metal ring.
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 3200, q: 3 }], amp: perc(0.0005, 0.32, 0.01), at });
      tone(v, { type: 'triangle', freq: [[0, 2100 * p], [0.012, 1500 * p]], amp: perc(0.0005, 0.07, 0.02), at });
      tone(v, { freq: [[0, 150 * p], [0.05, 78 * p]], amp: perc(0.002, 0.6, 0.13), at: at + 0.012 });
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 700 }], amp: perc(0.001, 0.38, 0.07), at: at + 0.012 });
      tone(v, { type: 'triangle', freq: [340, 375, 312][v.variant] * p, amp: perc(0.002, 0.09, 0.09), at: at + 0.012 });
      return at + 0.25;
    },
  },
  carVroom: {
    bus: 'sfx', ambience: true, variants: 2, gain: 1.0, maxVoices: 2, minInterval: 0.3, priority: 4, length: 1.9, reverb: 0.1,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      const D = 1.4 * jitter(v.rnd, 0.05);
      // Toy engine "부릉~": a saw putter (amplitude chopped at the firing rate) revving up, then
      // easing off as the car drives away.
      const ctx = v.ctx;
      const chop = ctx.createGain();
      chop.gain.value = 0.55;
      const fire = ctx.createOscillator();
      fire.type = 'square';
      fire.frequency.setValueAtTime(20 * p, v.t);
      fire.frequency.linearRampToValueAtTime(34 * p, v.t + 0.35);
      fire.frequency.linearRampToValueAtTime(24 * p, v.t + D);
      const depth = ctx.createGain();
      depth.gain.value = 0.42;
      fire.connect(depth);
      depth.connect(chop.gain);
      chop.connect(v.out);
      fire.start(v.t);
      fire.stop(v.t + D + 0.05);
      const rev: Env = v.variant === 0 ? [[0, 62 * p], [0.35, 108 * p], [0.55, 94 * p], [D, 72 * p]] : [[0, 58 * p], [0.2, 96 * p], [0.32, 84 * p], [0.6, 112 * p], [D, 76 * p]];
      const sv = { ...v, out: chop };
      tone(sv, { type: 'sawtooth', freq: rev, amp: [[0, 0], [0.05, 0.16], [0.4, 0.2], [D, 0]], filter: { type: 'lowpass', freq: [[0, 500], [0.35, 1400], [D, 600]], q: 2.5 } });
      tone(sv, { type: 'square', freq: rev.map(([t, f]) => [t, f / 2] as const), amp: [[0, 0], [0.05, 0.08], [0.4, 0.1], [D, 0]], filter: { type: 'lowpass', freq: 380 } });
      // Exhaust pops and a tiny tire chirp on pull-away.
      for (const at of v.variant === 0 ? [0.42, 0.6] : [0.3, 0.66]) noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 650, q: 1.2 }], amp: perc(0.0008, 0.22, 0.03), at });
      tone(v, { freq: [[0, 1500 * p], [0.08, 1300 * p]], amp: perc(0.005, 0.04, 0.08), vib: { rate: 24, cents: 40 } });
      return D + 0.05;
    },
  },
  policeWhistle: {
    // -3 dB under the small-safe coins it shares a band with (~3.3 kHz), and ducked under them.
    bus: 'sfx', ambience: true, variants: 3, gain: 0.42, maxVoices: 3, minInterval: 0.12, priority: 6, length: 0.55, reverb: 0.2,
    play(v) {
      // Pea whistle: a quick upward chirp into a fast trill.
      const f0 = [3350, 3520, 3250][v.variant] * v.pitch * jitter(v.rnd, 0.01);
      const blasts = v.variant === 0 ? [[0, 0.17]] : v.variant === 1 ? [[0, 0.07], [0.1, 0.15]] : [[0, 0.24]];
      const trill = rrange(v.rnd, 54, 62);
      // Loudness-matched variations (the long blast would read louder).
      const lv = [1, 0.95, 0.8][v.variant];
      for (const [at, d] of blasts) {
        const freq: Env = v.variant === 2 ? [[0, f0 * 0.9], [0.025, f0], [d - 0.05, f0], [d, f0 * 0.93]] : [[0, f0 * 0.9], [0.025, f0]];
        tone(v, { freq, amp: ahr(0.008, 0.2 * lv, d - 0.035, 0.03, 0.9), vib: { rate: trill, cents: 85 }, at });
        tone(v, { freq: freq.map(([t, f]) => [t, f * 2] as const), amp: ahr(0.008, 0.025 * lv, d - 0.035, 0.03, 0.9), vib: { rate: trill, cents: 85 }, at });
        noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: f0, q: 4 }], amp: ahr(0.006, 0.05 * lv, d - 0.03, 0.03, 0.8), at });
      }
      const last = blasts[blasts.length - 1];
      return last[0] + last[1] + 0.05;
    },
  },
  policeBark: {
    bus: 'sfx', ambience: true, variants: 3, gain: 0.24, maxVoices: 2, minInterval: 0.3, priority: 6, length: 0.9, reverb: 0.15,
    play(v) {
      // "멈춰!": two chirpy syllables; variation 1 higher and quicker, variation 2 yips first.
      const p = v.pitch * [1, 1.13, 1.04][v.variant] * jitter(v.rnd, 0.03);
      const ts = [1, 0.86, 0.95][v.variant] * jitter(v.rnd, 0.04);
      let at = 0;
      if (v.variant === 2) {
        syllable(v, { ...MEONG, at: 0, ts }, p);
        at = 0.16 * ts;
      }
      syllable(v, { ...MEOM, at, ts }, p);
      const ch = at + 0.2 * ts;
      // The "ch": a short hissy burst right before the second vowel.
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 4300, q: 2 }, { type: 'highpass', freq: 2500 }], amp: perc(0.004, 0.3, 0.035), at: ch });
      syllable(v, { ...CHWO, at: ch + 0.03 * ts, ts }, p);
      return ch + 0.03 * ts + 0.28 * ts;
    },
  },
  tackleWhoosh: {
    bus: 'sfx', variants: 3, gain: 1.2, maxVoices: 3, minInterval: 0.08, priority: 5, length: 0.5,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.05);
      const dur = [0.24, 0.27, 0.21][v.variant] * jitter(v.rnd, 0.06);
      // A diving whoosh, heavier than the raccoon dash, with a flappy uniform.
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: [[0, 280 * p], [dur * 0.45, 1600 * p], [dur, 500 * p]], q: 1.3 }], amp: [[0, 0], [dur * 0.4, 0.6], [dur, 0]] });
      tone(v, { freq: [[0, 150 * p], [dur, 85 * p]], amp: [[0, 0], [0.04, 0.16], [dur, 0]] });
      const ctx = v.ctx;
      const flap = ctx.createGain();
      flap.gain.value = 0.5;
      const am = ctx.createOscillator();
      am.type = 'square';
      am.frequency.setValueAtTime(rrange(v.rnd, 30, 40), v.t);
      const amD = ctx.createGain();
      amD.gain.value = 0.5;
      am.connect(amD);
      amD.connect(flap.gain);
      flap.connect(v.out);
      am.start(v.t);
      am.stop(v.t + dur + 0.02);
      noise({ ...v, out: flap }, { color: 'white', filters: [{ type: 'bandpass', freq: 900 * p, q: 0.8 }], amp: [[0, 0], [dur * 0.5, 0.09], [dur, 0]] });
      return dur + 0.03;
    },
  },
  tackleHit: {
    bus: 'sfx', variants: 3, gain: 0.72, maxVoices: 3, minInterval: 0.06, priority: 8, length: 1.0, reverb: 0.15,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.04);
      // "WHUMP!" — a deep slam with a cushiony cartoon "pomf" on top. The layers are staggered by a
      // few ms (contact smack, then the body, then the pomf) so their peaks do not stack into the
      // limiter: same punch, ~3 dB more headroom.
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 1200, q: 0.9 }], amp: perc(0.0006, 0.4, 0.03) });
      noise(v, { color: 'brown', filters: [{ type: 'lowpass', freq: 700 }], amp: perc(0.002, 0.5, 0.18), at: 0.004 });
      tone(v, { freq: [[0, 150 * p], [0.06, 62 * p], [0.3, 48 * p]], amp: perc(0.004, 0.66, 0.3), at: 0.008 });
      tone(v, { type: 'triangle', freq: [[0, [330, 300, 360][v.variant] * p], [0.09, 150 * p]], amp: perc(0.003, 0.35, 0.12), at: 0.022 });
      // ...then a short tumble ("와당탕") and a dust puff.
      let at = 0.12;
      for (let k = 0; k < 3; k++) {
        thump(v, at, (140 - k * 15) * p, 70 * p, 0.3 * (1 - k * 0.22), 0.1);
        noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 1200 }], amp: perc(0.001, 0.15 * (1 - k * 0.2), 0.04), at });
        at += rrange(v.rnd, 0.07, 0.1);
      }
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: 1500, q: 0.7 }], amp: ahr(0.02, 0.09, 0.1, 0.3), at: 0.05 });
      if (v.variant === 2) tone(v, { freq: 560 * p, amp: perc(0.005, 0.1, 0.3), vib: { rate: 17, cents: [[0, 150], [0.3, 10]] }, at: 0.1 });
      return at + 0.3;
    },
  },
  tackleMiss: {
    bus: 'sfx', variants: 3, gain: 1.75, maxVoices: 3, minInterval: 0.08, priority: 5, length: 0.9,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.05);
      // Soft swish of the miss, the officer's belly slide and a little "oof".
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: [[0, 900 * p], [0.12, 1500 * p]], q: 1.4 }], amp: [[0, 0], [0.05, 0.24], [0.15, 0]] });
      thump(v, 0.12, 120 * p, 70 * p, 0.24, 0.1);
      const slide = [0.42, 0.36, 0.5][v.variant] * jitter(v.rnd, 0.06);
      noise(v, {
        buffer: scrapeBuffer(v.ctx),
        rate: [[0, 1.2], [slide, 0.6]],
        filters: [{ type: 'bandpass', freq: [[0, 900 * p], [slide, 450 * p]], q: 1.1 }],
        amp: [[0, 0], [0.04, 0.3], [slide, 0]],
        at: 0.13,
      });
      tone(v, { type: 'triangle', freq: [[0, 620 * p], [0.13, 360 * p]], amp: perc(0.01, 0.11, 0.13), vib: { rate: 12, cents: 40 }, at: 0.15 });
      return 0.13 + slide + 0.05;
    },
  },
  policeStun: {
    bus: 'sfx', variants: 3, gain: 0.75, maxVoices: 3, minInterval: 0.1, priority: 7, length: 1.8, reverb: 0.2,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.03);
      // Flop onto the back...
      thump(v, 0, 130 * p, 60 * p, 0.5, 0.2);
      // ...a springy "boi-oi-oing" (higher and faster than the raccoons' knockdown boing)...
      const ctx = v.ctx;
      const t = v.t + 0.02;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(430 * p, t);
      osc.frequency.exponentialRampToValueAtTime(300 * p, t + 0.55);
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime([17, 19, 16][v.variant], t);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(120 * p, t);
      depth.gain.exponentialRampToValueAtTime(5, t + 0.55);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.58);
      osc.connect(g);
      g.connect(v.out);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 0.6);
      lfo.stop(t + 0.6);
      // ...and birdies circling the dazed head: "tweet-tweet" pairs on the pentatonic, panning round.
      const degs = [[14, 15, 13, 15], [15, 13, 14, 16], [13, 15, 16, 14]][v.variant];
      degs.forEach((d, k) => {
        const at = 0.3 + k * 0.17 + (v.rnd() - 0.5) * 0.02;
        const f = pn(v, d);
        const pan = Math.sin(k * 1.9) * 0.6;
        for (const dt of [0, 0.06]) {
          tone(v, { freq: [[0, f * 0.78], [0.035, f], [0.05, f * 0.96]], amp: perc(0.004, 0.1, 0.05), at: at + dt, pan });
        }
      });
      return 1.2;
    },
  },
  policePhew: {
    bus: 'sfx', variants: 2, gain: 0.95, maxVoices: 1, minInterval: 1, priority: 6, length: 1.6, reverb: 0.25, global: true,
    play(v) {
      // "휴~": a breathy exhale through a falling resonance with a faint whistle in it...
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: [[0, 1900], [0.5, 520]], q: 3.5 }], amp: [[0, 0], [0.06, 0.3], [0.25, 0.24], [0.6, 0]] });
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 1200 }], amp: [[0, 0], [0.08, 0.1], [0.55, 0]] });
      tone(v, { freq: [[0, 1150], [0.5, 480]], amp: [[0, 0], [0.05, 0.05], [0.3, 0.045], [0.55, 0]], vib: { rate: 6, cents: 20 } });
      // ...and a cheeky wink in key.
      const vel = (x: number): number => x * jitter(v.rnd, 0.07) * (v.variant === 1 ? 1.35 : 1);
      if (v.variant === 0) {
        pizz(v, 0.62, pnMidi(v, 0), 0.1, vel(0.7));
        marimba(v, 0.74, pnMidi(v, 9), 0.1, vel(0.6));
        glock(v, 0.74, pnMidi(v, 14), 0.1, vel(0.25));
      } else {
        marimba(v, 0.62, pnMidi(v, 8), 0.1, vel(0.55));
        marimba(v, 0.72, pnMidi(v, 12), 0.1, vel(0.6));
        block(v, 0.72, 84, 0.1, vel(0.35));
      }
      return 1.2;
    },
  },
};
