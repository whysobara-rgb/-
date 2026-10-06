/**
 * Presentation sound effects synced with the view's choreography:
 *
 *   uprootLand / bankLand  the object slamming back down after its uproot hop
 *                          (src/render/uproot.ts `landed`: safes at 62 % of SAFE_POP.time, the bank
 *                          at BANK_POP.land), with dirt raining back down; the bank also clangs its
 *                          alarm bell (the view rings the bell model on landing).
 *   callout*               short musical stabs for the HUD callouts "뽑았다!", "은행째!",
 *                          "가로채기!", "태클 피했다!" — written in the songs' key (F major /
 *                          D minor, `v.key`) so they land inside whatever music is playing.
 *
 * Callout convention: a negative `step` plays the rival flavor (the other team did it: lower,
 * softer, minor) instead of climbing the scale.
 */
import { BANK_BELL_HZ, BANK_BELL_PARTIALS, noise, partials, perc, tone, ahr, type Partial } from './dsp';
import { brass, clap, clarinet, clav, crash, glock, kick, marimba, pizz, snap, snare, timpani, block, hat } from './instruments';
import { jitter, rint, rrange } from './rng';
import { crackles, thump, type SfxRecipe, type SfxVoice } from './sfxkit';
import { scaleNote } from './theory';

export type StageSfxId = 'uprootLand' | 'bankLand' | 'calloutUproot' | 'calloutBank' | 'calloutSteal' | 'calloutDodge';

/** Seconds from the 'unanchored' event to the view's landing (src/render/models: BANK_POP / SAFE_POP). */
export const LAND_DELAY = {
  smallSafe: 0.6 * 0.62,
  largeSafe: 0.7 * 0.62,
  bank: 0.6,
} as const;

/** Light humanization for the stingers: velocity +-7 %, onset +-4 ms (never before 0). */
const hv = (v: SfxVoice, vel: number): number => vel * jitter(v.rnd, 0.07);
const ht = (v: SfxVoice, at: number): number => Math.max(0, at + (v.rnd() * 2 - 1) * 0.004);

/** Dirt / pebbles raining back down after a landing: soft clicks thinning out. */
function dirtPatter(v: SfxVoice, n: number, from: number, span: number, amp: number, p: number): void {
  for (let i = 0; i < n; i++) {
    const u = Math.pow(v.rnd(), 1.35);
    noise(v, {
      color: 'pink',
      filters: [{ type: 'bandpass', freq: rrange(v.rnd, 1300, 4200) * p, q: rrange(v.rnd, 1.4, 3) }],
      amp: perc(0.001, rrange(v.rnd, 0.4, 1) * amp * (1 - 0.7 * u), rrange(v.rnd, 0.008, 0.022)),
      at: from + u * span,
      pan: (v.rnd() * 2 - 1) * 0.55,
    });
  }
}

/** Bell clang of the bank's alarm bell (the same partials as the alarm loop). */
function bellClang(v: SfxVoice, at: number, amp: number, p: number): void {
  // A single clang rings much longer than the alarm's re-struck partials.
  const parts: Partial[] = BANK_BELL_PARTIALS.map(([r, a, d]) => [r, a * amp, Math.min(1.4, d * 2.2)] as const);
  partials(v, BANK_BELL_HZ * p, parts, { at, attack: 0.001 });
}

export const STAGE_RECIPES: Record<StageSfxId, SfxRecipe> = {
  uprootLand: {
    bus: 'sfx', variants: 3, gain: 0.78, maxVoices: 4, minInterval: 0.04, priority: 5, length: 0.9, reverb: 0.15,
    play(v) {
      // Pass pitch = size (small safe ~1.15, large ~0.85).
      const p = v.pitch * jitter(v.rnd, 0.04);
      const heavy = Math.max(0, Math.min(1, (1.2 - v.pitch) / 0.4));
      // Thunk of the box hitting the ground + the dull knock of its body.
      tone(v, { freq: [[0, 175 * p], [0.05, 72 * p]], amp: perc(0.002, 0.7, 0.2 + 0.08 * heavy) });
      tone(v, { type: 'triangle', freq: [[0, [330, 300, 360][v.variant] * p], [0.05, 215 * p]], amp: perc(0.001, 0.2, 0.06) });
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 950 }], amp: perc(0.001, 0.42 + 0.15 * heavy, 0.08) });
      // Dirt rains back down, then a little dust settles.
      dirtPatter(v, 8 + rint(v.rnd, 5) + Math.round(5 * heavy), 0.03, 0.42 + 0.15 * heavy, 0.12, 1);
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 2400 }], amp: ahr(0.02, 0.06, 0.05, 0.3) });
      return 0.62;
    },
  },
  bankLand: {
    bus: 'sfx', variants: 3, gain: 0.62, maxVoices: 2, minInterval: 0.3, priority: 9, length: 2.6, reverb: 0.3,
    duck: { db: -6, hold: 0.7 },
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.03);
      // The whole building slams down: deep boom, a body thump laptops can play, slab + crack.
      tone(v, { freq: [[0, 108 * p], [0.08, 52 * p], [0.6, 33 * p]], amp: perc(0.003, 0.85, 0.75) });
      tone(v, { freq: [[0, 215 * p], [0.12, 84 * p]], amp: perc(0.002, 0.42, 0.3) });
      noise(v, { color: 'brown', filters: [{ type: 'lowpass', freq: 360 }], amp: perc(0.002, 0.75, 0.42) });
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 1700, q: 0.8 }], amp: perc(0.0008, 0.45, 0.05) });
      // The alarm bell on the roof clangs with the impact (twice: it swings back).
      const swing = [0.19, 0.16, 0.23][v.variant];
      bellClang(v, 0.012, 0.42, 1);
      bellClang(v, swing, 0.22, 1);
      // Windows rattle.
      for (let i = 0; i < 7; i++) {
        tone(v, { freq: rrange(v.rnd, 2600, 5200), amp: perc(0.0008, rrange(v.rnd, 0.025, 0.05), rrange(v.rnd, 0.05, 0.12)), at: 0.03 + Math.pow(v.rnd(), 1.2) * 0.5, pan: (v.rnd() * 2 - 1) * 0.6 });
      }
      // Debris and dirt raining back down for a good while, then a dust cloud.
      crackles(v, 22, 0.08, 1.5, { fLo: 900, fHi: 3600, ampLo: 0.04, ampHi: 0.13, durLo: 0.006, durHi: 0.02, skew: 1.6, panWidth: 0.7 });
      dirtPatter(v, 16, 0.06, 1.1, 0.12, 0.85);
      noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 1800 }], amp: ahr(0.05, 0.12, 0.25, 0.9) });
      return 2.1;
    },
  },

  // ---- callout stingers ------------------------------------------------------------------------
  calloutUproot: {
    bus: 'sfx', variants: 3, gain: 0.7, maxVoices: 2, minInterval: 0.2, priority: 7, length: 1.2, reverb: 0.25, global: true,
    duck: { db: -3, hold: 0.35 },
    play(v) {
      // "뽑았다!": a quick upward pop of notes and a short brass stab (I, IV or a pentatonic run).
      const rival = v.step < 0;
      const k = v.key + (rival ? -12 : 0);
      const s = rival ? 0.6 : 1;
      if (v.variant === 2) {
        // Pentatonic run up, the top note doubled by brass.
        [7, 8, 9, 10].forEach((d, i) => marimba(v, ht(v, i * 0.034), scaleNote(k, d), 0.1, hv(v, 0.55 * s)));
        const top = scaleNote(k, 10);
        brass(v, ht(v, 0.12), top - 12, 0.16, hv(v, 0.6 * s));
        brass(v, ht(v, 0.12), top - 5, 0.16, hv(v, 0.5 * s));
        if (!rival) glock(v, 0.12, top + 12, 0.1, hv(v, 0.3));
      } else {
        // Arpeggio up into a chord stab: F major (I) or Bb major (IV) in the home key.
        const chordTones = v.variant === 0 ? [0, 4, 7] : [5, 9, 12];
        const arp = rival ? [9, 12, 16].map((x) => x - 12) : chordTones.map((x) => x + 12);
        arp.forEach((st, i) => marimba(v, ht(v, i * 0.045), k + st, 0.1, hv(v, 0.55 * s)));
        // Rival: the stab lands on D minor instead.
        for (const st of rival ? [-3, 0, 4] : chordTones) brass(v, ht(v, 0.11), k + st, 0.18, hv(v, 0.55 * s));
        if (!rival) glock(v, 0.11, k + 24 + chordTones[2] - 12, 0.1, hv(v, 0.3));
      }
      snare(v, 0.11, 0, 0.1, hv(v, 0.32 * s));
      kick(v, 0.11, 0, 0.1, hv(v, 0.35 * s));
      return 0.75;
    },
  },
  calloutBank: {
    bus: 'sfx', variants: 2, gain: 0.55, maxVoices: 1, minInterval: 0.5, priority: 9, length: 2.2, reverb: 0.3, global: true,
    duck: { db: -6, hold: 0.8 },
    play(v) {
      // "은행째!": pickup chord -> big tonic hit with timpani, cymbal and a sparkle run.
      // Rival: the same gesture landing on D minor, lower and softer ("uh-oh, they got it").
      const rival = v.step < 0;
      const k = v.key;
      const s = rival ? 0.62 : 1;
      const hit = 0.15;
      // Snare pickup.
      for (const [at, vel] of [[0, 0.25], [0.05, 0.32], [0.1, 0.42]] as const) snare(v, ht(v, at), 0, 0.1, hv(v, vel * s));
      const pickup = v.variant === 0 ? [7, 11, 14] : [5, 9, 12]; // C major (V) or Bb major (IV)
      for (const st of pickup) brass(v, ht(v, 0.02), k + st - 12, 0.1, hv(v, 0.55 * s));
      const target = rival ? [-3, 0, 4, 9] : [0, 4, 7, 12]; // D minor / F major voicing
      for (const st of target) brass(v, ht(v, hit), k + st, 0.55, hv(v, 0.8 * s));
      brass(v, ht(v, hit), k + (rival ? -15 : -12), 0.55, hv(v, 0.7 * s));
      timpani(v, hit, k - 24 + (rival ? -3 : 0), 1, hv(v, 0.85 * s));
      kick(v, hit, 0, 0.2, hv(v, 0.6 * s));
      crash(v, hit, 0, 1, hv(v, 0.7 * s));
      if (!rival) for (let i = 0; i < 6; i++) glock(v, hit + 0.04 + i * 0.03, scaleNote(k, 10 + i), 0.1, hv(v, 0.32), (i / 5) * 1.0 - 0.5);
      else marimba(v, hit + 0.3, k - 3, 0.2, hv(v, 0.35));
      return hit + 1.4;
    },
  },
  calloutSteal: {
    bus: 'sfx', variants: 2, gain: 1.0, maxVoices: 2, minInterval: 0.25, priority: 7, length: 1.1, reverb: 0.2, global: true,
    duck: { db: -3, hold: 0.35 },
    play(v) {
      const k = v.key;
      if (v.step < 0) {
        // They stole from us: a soft "uh-oh" falling through D minor.
        [[0, 4], [0.11, 0], [0.22, -3]].forEach(([at, st], i) => clarinet(v, ht(v, at), k + st, i === 2 ? 0.35 : 0.1, hv(v, 0.43)));
        pizz(v, 0.22, k - 15, 0.2, hv(v, 0.47));
        return 0.8;
      }
      // "가로채기!": a sly tiptoe up (with the D minor leading tone), a snap and a wink.
      // (Velocities loudness-matched between the two variations.)
      if (v.variant === 0) {
        [[0, 8], [0.035, 9], [0.09, 12], [0.15, 16]].forEach(([at, st]) => pizz(v, ht(v, at), k + st, 0.05, hv(v, 0.4)));
        snap(v, 0.22, 0, 0.1, hv(v, 0.45));
        glock(v, 0.22, k + 21, 0.1, hv(v, 0.2));
      } else {
        clav(v, ht(v, 0), k + 9, 0.08, hv(v, 1.1));
        clav(v, ht(v, 0.09), k + 16, 0.08, hv(v, 1.2));
        block(v, 0.16, 84, 0.1, hv(v, 0.8));
        hat(v, 0.16, 0, 0.1, hv(v, 0.9));
        marimba(v, ht(v, 0.16), k + 21, 0.1, hv(v, 0.9));
      }
      return 0.6;
    },
  },
  calloutDodge: {
    bus: 'sfx', variants: 2, gain: 1.0, maxVoices: 2, minInterval: 0.25, priority: 7, length: 1.0, reverb: 0.2, global: true,
    play(v) {
      // "태클 피했다!": a cheeky slide-whistle zip up, then a bright "ta-da" on the top.
      const k = v.key + (v.step < 0 ? -12 : 0);
      const lo = 440 * Math.pow(2, (k + 12 - 69) / 12);
      const hi = lo * 2;
      tone(v, { freq: [[0, lo], [0.13, hi]], amp: [[0, 0], [0.02, 0.12], [0.12, 0.1], [0.15, 0]], vib: { rate: 9, cents: 25 } });
      if (v.variant === 0) {
        marimba(v, ht(v, 0.15), k + 19, 0.1, hv(v, 0.6));
        marimba(v, ht(v, 0.23), k + 24, 0.1, hv(v, 0.7));
        glock(v, 0.23, k + 24, 0.1, hv(v, 0.3));
      } else {
        [[0.15, 21], [0.21, 19], [0.27, 24]].forEach(([at, st]) => marimba(v, ht(v, at), k + st, 0.1, hv(v, 0.5)));
        clap(v, 0.27, 0, 0.1, hv(v, 0.3));
      }
      return 0.65;
    },
  },
};
