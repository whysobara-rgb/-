/**
 * Content 2.0 economy and prop sounds (C9, wave 1): loose coins, the bag (주머니), deposits
 * (쏟아붓기), spills (와르르), the 동전 ATM, the 대왕 돼지저금통, the 돈나무, and the breakables
 * (나무 상자, 꿀꺽 자판기).
 *
 *   coinPickup    one 동전 10 taken by touch: a single coin "tink" in key; the director passes
 *                 `step` = how many piles this raccoon took within 1.5 s, so a scoop climbs the scale
 *   billPickup    one 지폐 다발 50: a paper snap + a rounder bell note, on the same climb
 *   coinPop       a burst of coins popping out (vending cough, rain, truck, anything without its
 *                 own sound)
 *   coinSpill     와르르: a descending cascade of coins hitting the ground; variant = size
 *                 (0 small <= 30, 1 medium <= 70, 2 big)
 *   depositStart  the 0.5 s deposit dwell in the own zone: the bag opens and coins start to slide
 *                 (tagged per raccoon; cut on cancel, replaced by coinDeposit when it lands)
 *   coinDeposit   쏟아붓기 landed: coins pouring into the van, climbing to a chime; variant = size
 *                 (0 <= 40, 1 <= 100, 2 bigger); `step` < 0 = the other team (lower, softer)
 *   atmSpurt      "삐빅" two beeps, then a cash-register cha-ching and the coins shooting out
 *   atmBonk       a dash / hammer bonk on the cabinet: hollow metal "텅", an error "bup", coins
 *   piggyOink     a squeaky synth "oink" glide (kicks; pitch rises with the cracks)
 *   piggyCrack    a ceramic crack opening up
 *   piggyJackpot  "잭팟!": the piggy shatters, every coin bursts out, a falling squeal, a stab
 *   rootRip       the 돈나무's root ball tearing out of the bed: rips, soil chunks, a crackle-thump,
 *                 the leaves (bills) rustling — layered over the usual uproot pop
 *   billFlutter   bills shed on an impact, fluttering down
 *   crateBreak    the wooden crate splintering, planks clattering, two coins
 *   vendingHit    a dash on the vending machine: a thunk, the machine "coughs" a coin out
 *   vendingBreak  the vending machine bursts: metal crash, a gulping "꿀꺽" burp, coins everywhere
 *
 * Coins are the most frequent sounds in a v2 match, so the pickup "tink" is short, light and well
 * under the scoring sounds; the score-like coinDeposit is global like the recovery coins. Tonal
 * parts use the current music key (`v.key`, see ./theory.ts). Gains are loudness-matched offline
 * through the production mixer (see test/unit/audio-content.test.ts and the C9 report).
 */
import { ahr, noise, partials, perc, route, tone, type Partial } from './dsp';
import { brass, crash, glock, kick, marimba, snare } from './instruments';
import { jitter, rint, rrange } from './rng';
import { coin, crackles, thump, type SfxRecipe, type SfxVoice } from './sfxkit';
import { midiToHz, scaleNote } from './theory';

export type PropSfxId =
  | 'coinPickup'
  | 'billPickup'
  | 'coinPop'
  | 'coinSpill'
  | 'depositStart'
  | 'coinDeposit'
  | 'atmSpurt'
  | 'atmBonk'
  | 'piggyOink'
  | 'piggyCrack'
  | 'piggyJackpot'
  | 'rootRip'
  | 'billFlutter'
  | 'crateBreak'
  | 'vendingHit'
  | 'vendingBreak';

/** Seconds of the deposit dwell (COINS.depositTicks = 30 at 60 Hz); the depositStart riser lasts this long. */
export const DEPOSIT_SECONDS = 0.5;

/** Scale degree `d` (+ step) of the current key as Hz, times the pitch option. */
const deg = (v: SfxVoice, d: number): number => midiToHz(scaleNote(v.key, d + v.step)) * v.pitch;
const degMidi = (v: SfxVoice, d: number): number => scaleNote(v.key, d + v.step);
const hv = (v: SfxVoice, vel: number): number => vel * jitter(v.rnd, 0.06);
const ht = (v: SfxVoice, at: number): number => Math.max(0, at + (v.rnd() * 2 - 1) * 0.004);
const rpan = (v: SfxVoice, w: number): number => (v.rnd() * 2 - 1) * w;

/** Coins landing on pavement: small metallic bounce clicks (a rattle, not a tune). */
function coinRattle(v: SfxVoice, n: number, from: number, span: number, amp: number): void {
  crackles(v, n, from, from + span, { fLo: 3200, fHi: 7800, ampLo: amp * 0.4, ampHi: amp, durLo: 0.006, durHi: 0.02, skew: 1.3, panWidth: 0.6 });
}

/** Paper flaps: short band-passed noise bursts with a flutter (bills riffling). */
function paperFlaps(v: SfxVoice, n: number, from: number, span: number, amp: number, fLo = 1400, fHi = 3200): void {
  for (let i = 0; i < n; i++) {
    const at = from + (n > 1 ? (span * i) / (n - 1) : 0) + rrange(v.rnd, -0.015, 0.015);
    noise(v, {
      color: 'pink',
      filters: [{ type: 'bandpass', freq: rrange(v.rnd, fLo, fHi), q: rrange(v.rnd, 1.2, 2.4) }],
      amp: perc(0.002, amp * rrange(v.rnd, 0.6, 1), rrange(v.rnd, 0.025, 0.05)),
      at: Math.max(0, at),
      pan: rpan(v, 0.5),
    });
  }
}

/**
 * A fluttering bill falling: a band of noise amplitude-chattered at ~20 Hz (the paper flipping),
 * its band drifting down while it falls.
 */
function flutter(v: SfxVoice, at: number, dur: number, amp: number, pan: number): void {
  const ctx = v.ctx;
  const t = v.t + at;
  const g = ctx.createGain();
  g.gain.value = 0;
  const am = ctx.createOscillator();
  am.type = 'square';
  am.frequency.setValueAtTime(rrange(v.rnd, 16, 24), t);
  am.frequency.linearRampToValueAtTime(rrange(v.rnd, 9, 13), t + dur);
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  am.connect(depth);
  depth.connect(g.gain);
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(amp, t + 0.04);
  out.gain.linearRampToValueAtTime(amp * 0.6, t + dur * 0.7);
  out.gain.linearRampToValueAtTime(0, t + dur);
  g.connect(out);
  route(ctx, out, v.out, pan);
  const f0 = rrange(v.rnd, 2200, 3200);
  noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: [[0, f0], [dur, f0 * 0.55]], q: 1.8 }], amp: [[0, 0.5], [dur, 0.5]], at, dest: g });
  am.start(t);
  am.stop(t + dur + 0.02);
}

/** The cash-register cha-ching: drawer clunk, ratchet ticks and a struck bell in key. */
function chaChing(v: SfxVoice, at: number, bellDeg: number, amp: number): void {
  thump(v, at, 120 * v.pitch, 75 * v.pitch, 0.35 * amp, 0.12);
  for (let i = 0; i < 3; i++) noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 3000, q: 3 }], amp: perc(0.0005, (0.18 - i * 0.04) * amp, 0.01), at: at + i * 0.022 });
  const bell: Partial[] = [
    [1, 0.22, 0.8],
    [2.41, 0.1, 0.45],
    [3.98, 0.06, 0.25],
    [5.92, 0.03, 0.14],
  ];
  partials(v, deg(v, bellDeg), bell, { at: at + 0.07, gain: amp });
}

/** Ceramic: a hard click and a short glassy ring (the piggy's glaze). */
function ceramicTink(v: SfxVoice, at: number, f: number, amp: number): void {
  noise(v, { color: 'white', filters: [{ type: 'highpass', freq: 3000 }], amp: perc(0.0004, amp, 0.012), at });
  const glaze: Partial[] = [
    [1, 0.12, 0.18],
    [2.32, 0.07, 0.1],
    [4.25, 0.04, 0.06],
  ];
  partials(v, f, glaze, { at, gain: amp * 2.2 });
}

/** The squeaky synth oink: a buzzy saw through a nasal formant, gliding up then down. */
function oink(v: SfxVoice, at: number, f: number, dur: number, amp: number, fall = false): void {
  const freq = fall
    ? ([[0, f * 1.3], [dur * 0.25, f * 1.45], [dur, f * 0.6]] as const)
    : ([[0, f * 0.8], [dur * 0.35, f * 1.2], [dur, f * 0.85]] as const);
  tone(v, {
    type: 'sawtooth',
    freq,
    amp: [[0, 0], [0.012, amp], [dur * 0.7, amp * 0.75], [dur, 0]],
    filter: { type: 'bandpass', freq: [[0, 900], [dur * 0.35, 1500], [dur, 1000]], q: 3.2 },
    vib: { rate: 24, cents: 70 },
    at,
  });
  tone(v, { type: 'square', freq, amp: [[0, 0], [0.012, amp * 0.3], [dur, 0]], filter: { type: 'lowpass', freq: 1200, q: 0.8 }, at });
}

/** Soil chunks thudding back down (low, soft pebbly clicks). */
function soilChunks(v: SfxVoice, n: number, from: number, span: number, amp: number): void {
  for (let i = 0; i < n; i++) {
    const u = Math.pow(v.rnd(), 1.3);
    noise(v, {
      color: 'pink',
      filters: [{ type: 'bandpass', freq: rrange(v.rnd, 500, 1800), q: rrange(v.rnd, 1.2, 2.5) }],
      amp: perc(0.001, amp * rrange(v.rnd, 0.5, 1) * (1 - 0.6 * u), rrange(v.rnd, 0.012, 0.035)),
      at: from + u * span,
      pan: rpan(v, 0.5),
    });
  }
}

/** Ripping texture (fibres tearing): square-chattered noise in a rising band. */
function rip(v: SfxVoice, at: number, dur: number, amp: number, f0: number, f1: number): void {
  const ctx = v.ctx;
  const t = v.t + at;
  const g = ctx.createGain();
  g.gain.value = 0;
  const am = ctx.createOscillator();
  am.type = 'square';
  am.frequency.setValueAtTime(rrange(v.rnd, 30, 52), t);
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  am.connect(depth);
  depth.connect(g.gain);
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(amp, t + 0.03);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  route(ctx, out, v.out, rpan(v, 0.4));
  noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: [[0, f0], [dur, f1]], q: 2.2 }], amp: [[0, 0.5], [dur, 0.5]], at, dest: g });
  am.start(t);
  am.stop(t + dur + 0.02);
}

/** Wooden knock (planks, crate walls): inharmonic woody pair. */
function woodKnock(v: SfxVoice, at: number, f: number, amp: number): void {
  tone(v, { type: 'triangle', freq: [[0, f * 1.06], [0.02, f]], amp: perc(0.0008, amp, 0.07), at, pan: rpan(v, 0.35) });
  tone(v, { freq: f * 2.71, amp: perc(0.0006, amp * 0.3, 0.03), at });
}

export const PROP_RECIPES: Record<PropSfxId, SfxRecipe> = {
  // ---- coins and the bag -------------------------------------------------------------------------
  coinPickup: {
    bus: 'sfx', variants: 3, gain: 1.08, maxVoices: 4, minInterval: 0.025, priority: 5, length: 0.5,
    play(v) {
      // One coin into the bag: a light "tink" climbing one degree per pile taken within 1.5 s.
      const f = deg(v, [9, 9, 10][v.variant]!) * jitter(v.rnd, 0.004);
      coin(v, 0, f, 0.2, 0.22, rpan(v, 0.15), true);
      // The coin dropping onto the others in the bag.
      if (v.variant === 1) coin(v, 0.045, f * 1.5, 0.07, 0.08, 0, true);
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: rrange(v.rnd, 4500, 6500), q: 3 }], amp: perc(0.0005, 0.05, 0.015), at: 0.03 });
      return 0.3;
    },
  },
  billPickup: {
    bus: 'sfx', variants: 3, gain: 0.68, maxVoices: 4, minInterval: 0.025, priority: 5, length: 0.6,
    play(v) {
      // A bundle of bills: a crisp paper snap and a rounder bell note (worth five coins).
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: rrange(v.rnd, 2600, 3600), q: 1.6 }], amp: perc(0.001, 0.22, 0.03) });
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: 1500, q: 1.2 }], amp: perc(0.003, 0.12, 0.06), at: 0.012 });
      const m = degMidi(v, [7, 8, 7][v.variant]!);
      glock(v, 0.02, m, 0.1, hv(v, 0.4));
      marimba(v, 0.02, m - 12, 0.1, hv(v, 0.3));
      if (v.variant === 2) glock(v, 0.07, m + 12, 0.1, hv(v, 0.15));
      return 0.45;
    },
  },
  coinPop: {
    bus: 'sfx', variants: 3, gain: 1.5, maxVoices: 4, minInterval: 0.04, priority: 4, length: 0.8,
    play(v) {
      // Coins popping out and bouncing: three or four tinks spread in time and stereo + a rattle.
      const n = 3 + (v.variant === 2 ? 1 : 0);
      const degs = [[10, 12, 11, 13], [11, 10, 12, 14], [12, 11, 13, 10]][v.variant]!;
      for (let i = 0; i < n; i++) coin(v, ht(v, 0.02 + i * rrange(v.rnd, 0.035, 0.06)), deg(v, degs[i]!), 0.12, 0.16, rpan(v, 0.5), true);
      coinRattle(v, 6, 0.12, 0.35, 0.07);
      return 0.55;
    },
  },
  coinSpill: {
    bus: 'sfx', variants: 3, gain: 1.8, maxVoices: 4, minInterval: 0.05, priority: 6, length: 1.5, reverb: 0.12,
    play(v) {
      // 와르르: the bag bursts, coins tumble DOWN the scale (the opposite of the pickup climb) and
      // rattle on the ground. Variant = size (5 / 8 / 12 coins).
      const n = [5, 8, 12][v.variant]!;
      // A "whoops" pouch slap.
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: [[0, 1800], [0.1, 700]], q: 1.2 }], amp: perc(0.002, 0.25, 0.09) });
      let at = 0.02;
      for (let i = 0; i < n; i++) {
        const d = 13 - Math.round((i * 9) / Math.max(1, n - 1));
        coin(v, ht(v, at), deg(v, d), 0.15 * (1 - (0.4 * i) / n), 0.14, (i % 2 ? 1 : -1) * rrange(v.rnd, 0.15, 0.6), true);
        at += 0.045 - (0.015 * i) / n;
      }
      coinRattle(v, 8 + n, 0.1, at + 0.25, 0.09);
      return at + 0.45;
    },
  },
  depositStart: {
    bus: 'sfx', variants: 2, gain: 1.9, maxVoices: 2, minInterval: 0.05, priority: 4, length: 0.8,
    play(v) {
      // The 0.5 s dwell: the bag's drawstring loosens (a zip up) and coins start to slide inside,
      // the rattle thickening toward the pour. Cut on cancel.
      const T = DEPOSIT_SECONDS;
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: [[0, 900], [0.12, 3200]], q: 2 }], amp: [[0, 0], [0.04, 0.09], [0.13, 0]] });
      crackles(v, 14 + v.variant * 3, 0.06, T, { fLo: 3000, fHi: 7000, ampLo: 0.02, ampHi: 0.07, durLo: 0.005, durHi: 0.015, skew: 0.55, panWidth: 0.3 });
      tone(v, { type: 'triangle', freq: [[0, deg(v, 4)], [T, deg(v, 7)]], amp: [[0, 0], [0.1, 0.025], [T, 0.04], [T + 0.05, 0]] });
      return T + 0.06;
    },
  },
  coinDeposit: {
    bus: 'sfx', variants: 3, gain: 0.6, maxVoices: 2, minInterval: 0.05, priority: 8, length: 1.8, reverb: 0.28, global: true,
    duckAmbience: { db: -6, hold: 0.8 },
    play(v) {
      // 쏟아붓기: the bag empties into the van — a pouring rattle, coins rising quickly up the
      // scale, landing on a chime (bigger deposits pour longer and add a marimba arpeggio).
      // A negative step is the other team's deposit (lower, softer).
      const rival = v.step < 0;
      const s = rival ? 0.65 : 1;
      const n = [3, 5, 7][v.variant]!;
      const pour = 0.05 + n * 0.04;
      coinRattle(v, 10 + n * 3, 0, pour + 0.1, 0.1 * s);
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: 4200, q: 0.9 }], amp: [[0, 0], [0.04, 0.05 * s], [pour, 0.06 * s], [pour + 0.15, 0]] });
      for (let i = 0; i < n; i++) coin(v, ht(v, 0.02 + i * 0.04), deg(v, 7 + i), 0.15 * s, 0.12, i % 2 ? 0.25 : -0.25, true);
      const top = 7 + n;
      coin(v, pour, deg(v, top), 0.3 * s, 0.6, 0);
      glock(v, pour + 0.01, degMidi(v, top), 0.2, hv(v, 0.25 * s));
      if (v.variant >= 1) [top - 5, top - 3, top].forEach((d, i) => marimba(v, ht(v, pour + 0.04 + i * 0.05), degMidi(v, d), 0.1, hv(v, 0.35 * s)));
      for (let k = 0; k < 2 + v.variant; k++) tone(v, { freq: rrange(v.rnd, 5200, 7600), amp: perc(0.001, 0.03 * s, 0.04), at: pour + 0.05 + k * 0.05, pan: rpan(v, 0.5) });
      return pour + 0.75;
    },
  },

  // ---- 동전 ATM -------------------------------------------------------------------------------------
  atmSpurt: {
    bus: 'sfx', variants: 3, gain: 0.75, maxVoices: 2, minInterval: 0.05, priority: 6, length: 1.2, reverb: 0.15,
    play(v) {
      // The tug shakes it: "삐빅" (two keypad beeps), the cha-ching, coins shooting out.
      const beeps = [[12, 14], [14, 12], [12, 12]][v.variant]!;
      beeps.forEach((d, i) => {
        const f = deg(v, d);
        tone(v, { type: 'square', freq: f, amp: ahr(0.002, 0.045, 0.045, 0.01), filter: { type: 'lowpass', freq: 3800 }, at: i * 0.075 });
        tone(v, { freq: f, amp: ahr(0.002, 0.08, 0.045, 0.01), at: i * 0.075 });
      });
      chaChing(v, 0.16, [10, 11, 12][v.variant]!, 0.9);
      coin(v, 0.27, deg(v, 12), 0.12, 0.14, -0.35, true);
      coin(v, 0.31, deg(v, 13), 0.12, 0.14, 0.35, true);
      coinRattle(v, 6, 0.35, 0.3, 0.06);
      return 0.95;
    },
  },
  atmBonk: {
    bus: 'sfx', variants: 3, gain: 0.74, maxVoices: 2, minInterval: 0.05, priority: 6, length: 0.9, reverb: 0.12,
    play(v) {
      // A hollow metal cabinet "텅", the screen's error "bup-bup", the coins knocked loose.
      const p = v.pitch * jitter(v.rnd, 0.04);
      const cab: Partial[] = [
        [1, 0.3, 0.3],
        [1.52, 0.16, 0.22],
        [2.37, 0.09, 0.14],
        [3.6, 0.05, 0.08],
      ];
      partials(v, [196, 220, 175][v.variant]! * p, cab);
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 1200 }], amp: perc(0.001, 0.3, 0.05) });
      const f = deg(v, 2);
      for (const at of [0.08, 0.17]) tone(v, { type: 'square', freq: [[0, f * 1.04], [0.04, f]], amp: perc(0.003, 0.05, 0.06), filter: { type: 'lowpass', freq: 1400 }, at });
      coin(v, 0.1, deg(v, 11), 0.12, 0.14, -0.3, true);
      coin(v, 0.14, deg(v, 12), 0.12, 0.14, 0.3, true);
      coinRattle(v, 5, 0.2, 0.25, 0.06);
      return 0.65;
    },
  },

  // ---- 대왕 돼지저금통 ------------------------------------------------------------------------------
  piggyOink: {
    bus: 'sfx', variants: 3, gain: 1.75, maxVoices: 2, minInterval: 0.08, priority: 5, length: 0.7, reverb: 0.1,
    play(v) {
      // A cute synth "oink" (never a real pig): a nasal buzz gliding up and down; variant 1 doubles
      // it ("oink-oink"). Pass pitch to raise it (more cracks = more alarmed).
      const f = deg(v, [2, 3, 1][v.variant]!) * jitter(v.rnd, 0.02);
      oink(v, 0, f, 0.2, 0.14);
      if (v.variant === 1) oink(v, 0.22, f * 1.12, 0.16, 0.12);
      // Its hollow belly rolling (the coins inside shift).
      coinRattle(v, 5, 0.02, 0.2, 0.05);
      tone(v, { freq: [[0, 140 * v.pitch], [0.12, 95 * v.pitch]], amp: perc(0.003, 0.12, 0.12) });
      return v.variant === 1 ? 0.45 : 0.3;
    },
  },
  piggyCrack: {
    bus: 'sfx', variants: 3, gain: 2.0, maxVoices: 2, minInterval: 0.06, priority: 6, length: 0.7, reverb: 0.12,
    play(v) {
      // The glaze cracks: a sharp tick, a fissure of tiny snaps running along it, a glassy ring.
      const p = v.pitch * jitter(v.rnd, 0.04);
      ceramicTink(v, 0, [2350, 2600, 2150][v.variant]! * p, 0.25);
      crackles(v, 10 + rint(v.rnd, 5), 0.01, 0.16, { fLo: 2400, fHi: 6500, ampLo: 0.05, ampHi: 0.16, durLo: 0.002, durHi: 0.01, skew: 1.5, panWidth: 0.3 });
      tone(v, { type: 'triangle', freq: [[0, 380 * p], [0.05, 240 * p]], amp: perc(0.001, 0.18, 0.06) });
      // The coins inside jingle in alarm.
      coinRattle(v, 5, 0.04, 0.2, 0.05);
      return 0.42;
    },
  },
  piggyJackpot: {
    bus: 'sfx', variants: 3, gain: 0.86, maxVoices: 1, minInterval: 0.3, priority: 8, length: 2.4, reverb: 0.3,
    duck: { db: -4, hold: 0.8 },
    duckAmbience: { db: -6, hold: 1.0 },
    play(v) {
      // "잭팟!": the shell shatters, a squeal falls away, every coin bursts out radially, and a
      // short stab lands in key (bells + brass on the tonic chord).
      const p = v.pitch * jitter(v.rnd, 0.03);
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 3200, q: 0.7 }], amp: perc(0.0006, 0.55, 0.06) });
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 2200 }], amp: perc(0.002, 0.35, 0.2) });
      thump(v, 0, 160 * p, 70 * p, 0.4, 0.18);
      for (let i = 0; i < 4; i++) ceramicTink(v, ht(v, 0.03 + i * 0.05), rrange(v.rnd, 1900, 3200) * p, 0.12);
      crackles(v, 26, 0.0, 0.5, { fLo: 2000, fHi: 7000, ampLo: 0.05, ampHi: 0.18, durLo: 0.003, durHi: 0.016, skew: 1.6, panWidth: 0.7 });
      oink(v, 0.04, deg(v, 4), 0.42, 0.09, true);
      // The radial coin burst: wide stereo, rising then scattering.
      for (let i = 0; i < 10; i++) coin(v, ht(v, 0.08 + i * 0.028), deg(v, 9 + (i % 5) + (i >= 5 ? 1 : 0)), 0.12, 0.16, ((i % 2 ? 1 : -1) * (0.3 + 0.6 * ((i * 7) % 5) / 4)), true);
      coinRattle(v, 18, 0.25, 0.8, 0.08);
      // The stab.
      const k = v.key;
      const hit = 0.32;
      const chord = v.variant === 1 ? [5, 9, 12] : [0, 4, 7];
      for (const st of chord) brass(v, ht(v, hit), k + st, 0.35, hv(v, 0.55));
      brass(v, ht(v, hit), k - 12 + chord[0]!, 0.35, hv(v, 0.5));
      kick(v, hit, 0, 0.2, hv(v, 0.45));
      snare(v, hit, 0, 0.1, hv(v, 0.3));
      crash(v, hit, 0, 1, hv(v, 0.35));
      for (let i = 0; i < 5; i++) glock(v, hit + 0.05 + i * 0.04, scaleNote(k, 10 + i + (v.variant === 2 ? 1 : 0)), 0.1, hv(v, 0.3), (i / 4) * 1.0 - 0.5);
      return hit + 1.5;
    },
  },

  // ---- 돈나무 -------------------------------------------------------------------------------------
  rootRip: {
    bus: 'sfx', variants: 3, gain: 0.7, maxVoices: 2, minInterval: 0.3, priority: 6, length: 1.6, reverb: 0.18,
    play(v) {
      // The root ball tears out of the planter: long fibrous rips, a crackle-thump as it comes
      // free, soil chunks raining back down, and the bill-leaves rustling up top.
      const p = v.pitch * jitter(v.rnd, 0.04);
      const rips = [
        [[0, 0.32], [0.24, 0.3], [0.5, 0.36]],
        [[0, 0.4], [0.3, 0.36]],
        [[0, 0.25], [0.18, 0.25], [0.36, 0.3], [0.58, 0.28]],
      ][v.variant]!;
      for (const [at, d] of rips) rip(v, at, d, 0.24, 420 * p, 1600 * p);
      crackles(v, 30, 0, 0.75, { fLo: 600, fHi: 3000, ampLo: 0.08, ampHi: 0.28, durLo: 0.004, durHi: 0.024, skew: 1.5, panWidth: 0.5 });
      const freeAt = rips[rips.length - 1]![0] + 0.08;
      thump(v, freeAt, 120 * p, 55 * p, 0.45, 0.22);
      noise(v, { color: 'brown', filters: [{ type: 'lowpass', freq: 260 }], amp: [[0, 0], [0.06, 0.3], [0.5, 0]], at: freeAt });
      soilChunks(v, 14, freeAt + 0.05, 0.6, 0.18);
      paperFlaps(v, 7, 0.1, freeAt + 0.3, 0.07, 2200, 4200);
      return freeAt + 0.8;
    },
  },
  billFlutter: {
    bus: 'sfx', variants: 3, gain: 1.7, maxVoices: 2, minInterval: 0.06, priority: 5, length: 1.2, reverb: 0.15,
    play(v) {
      // Bills shaken loose: a paper snap off the branch, then each bill flutters down (a band of
      // noise flipping at ~20 Hz, sinking), with a light "shing" of value.
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 3000, q: 1.5 }], amp: perc(0.001, 0.18, 0.025) });
      const n = [2, 3, 2][v.variant]!;
      for (let i = 0; i < n; i++) flutter(v, 0.03 + i * rrange(v.rnd, 0.05, 0.11), rrange(v.rnd, 0.55, 0.8), 0.1, (i % 2 ? 1 : -1) * rrange(v.rnd, 0.1, 0.5));
      glock(v, 0.02, degMidi(v, [12, 11, 13][v.variant]!), 0.1, hv(v, 0.22));
      glock(v, 0.09, degMidi(v, [10, 9, 11][v.variant]!), 0.1, hv(v, 0.15));
      return 0.95;
    },
  },

  // ---- breakables ---------------------------------------------------------------------------------
  crateBreak: {
    bus: 'sfx', variants: 3, gain: 1.13, maxVoices: 2, minInterval: 0.05, priority: 5, length: 1.0, reverb: 0.12,
    play(v) {
      // 와직: the crate gives way — a woody crack, splinters, planks clattering down, two coins.
      const p = v.pitch * jitter(v.rnd, 0.04);
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 1800 * p, q: 0.9 }], amp: perc(0.0006, 0.45, 0.04) });
      woodKnock(v, 0, [330, 370, 300][v.variant]! * p, 0.45);
      thump(v, 0.005, 140 * p, 80 * p, 0.3, 0.1);
      crackles(v, 22, 0, 0.3, { fLo: 900, fHi: 4200, ampLo: 0.06, ampHi: 0.22, durLo: 0.003, durHi: 0.02, skew: 1.7, panWidth: 0.55 });
      const planks = [[0.14, 1], [0.23, 0.7], [0.3, 0.5], [0.42, 0.35]] as const;
      for (const [at, a] of planks) woodKnock(v, ht(v, at), rrange(v.rnd, 380, 620) * p, 0.25 * a);
      coin(v, 0.1, deg(v, 11), 0.12, 0.14, -0.3, true);
      coin(v, 0.15, deg(v, 12), 0.12, 0.14, 0.3, true);
      return 0.7;
    },
  },
  vendingHit: {
    bus: 'sfx', variants: 3, gain: 0.88, maxVoices: 2, minInterval: 0.06, priority: 5, length: 0.9, reverb: 0.1,
    play(v) {
      // A dash into the 꿀꺽 machine: a deep cabinet thunk with cans rattling inside, then the
      // machine "coughs" ("콜록") and a coin drops out of the return slot.
      const p = v.pitch * jitter(v.rnd, 0.04);
      const cab: Partial[] = [
        [1, 0.3, 0.22],
        [1.71, 0.12, 0.16],
        [2.9, 0.06, 0.09],
      ];
      partials(v, [128, 142, 118][v.variant]! * p, cab);
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 900 }], amp: perc(0.001, 0.32, 0.06) });
      crackles(v, 8, 0.02, 0.2, { fLo: 900, fHi: 2600, ampLo: 0.04, ampHi: 0.1, durLo: 0.006, durHi: 0.02, panWidth: 0.2 });
      // The cough: a throaty noise burst with a falling formant, twice.
      for (const [at, a] of [[0.16, 1], [0.27, 0.7]] as const) {
        noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: [[0, 1300 * p], [0.07, 600 * p]], q: 2.2 }], amp: perc(0.004, 0.2 * a, 0.07), at: ht(v, at) });
        tone(v, { type: 'sawtooth', freq: [[0, 190 * p], [0.06, 140 * p]], amp: perc(0.004, 0.04 * a, 0.06), filter: { type: 'lowpass', freq: 900 }, at });
      }
      coin(v, 0.36, deg(v, 10), 0.14, 0.18, 0, true);
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 3800, q: 3 }], amp: perc(0.0005, 0.05, 0.015), at: 0.42 });
      return 0.6;
    },
  },
  vendingBreak: {
    bus: 'sfx', variants: 2, gain: 0.58, maxVoices: 1, minInterval: 0.2, priority: 6, length: 1.6, reverb: 0.2,
    play(v) {
      // The machine gives up: a metal crash, the front panel glass tinkling, a gulping "꿀꺽"
      // burp (its brand) and every coin inside clattering out.
      const p = v.pitch * jitter(v.rnd, 0.03);
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 2400, q: 0.6 }], amp: perc(0.0006, 0.5, 0.1) });
      const cab: Partial[] = [
        [1, 0.3, 0.4],
        [1.52, 0.18, 0.3],
        [2.37, 0.1, 0.2],
        [3.6, 0.06, 0.12],
      ];
      partials(v, (v.variant ? 150 : 135) * p, cab);
      thump(v, 0, 110 * p, 55 * p, 0.45, 0.2);
      for (let i = 0; i < 7; i++) ceramicTink(v, ht(v, 0.02 + i * rrange(v.rnd, 0.025, 0.05)), rrange(v.rnd, 3000, 5200), 0.07);
      // "꿀꺽": a low gulp bloop sliding down, then a tiny burp.
      tone(v, { freq: [[0, 420 * p], [0.12, 160 * p]], amp: perc(0.004, 0.18, 0.14), at: 0.22 });
      tone(v, { type: 'sawtooth', freq: [[0, 120 * p], [0.1, 95 * p]], amp: perc(0.01, 0.06, 0.12), filter: { type: 'lowpass', freq: 700, q: 3 }, at: 0.4 });
      // Coins everywhere.
      for (let i = 0; i < 6; i++) coin(v, ht(v, 0.12 + i * 0.04), deg(v, 9 + ((i * 3) % 5)), 0.11, 0.15, (i % 2 ? 1 : -1) * rrange(v.rnd, 0.2, 0.6), true);
      coinRattle(v, 16, 0.2, 0.6, 0.08);
      return 1.1;
    },
  },
};
