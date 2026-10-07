/**
 * Tension audio (F8: fun-plan WP8 + the content-plan F8 delta). Musical beats that make the
 * match's story audible: who is about to win, who just took the lead, who is on a run, how much
 * time is left. Toy-box materials and the songs' key (F major pentatonic / D minor, `v.key`), so
 * every cue lands inside whatever music is playing (ART_DIRECTION §1). No voices, nothing mocking
 * (design §13): rivals "bark" in instrument timbres only.
 *
 *   tensionHeartbeat  match point heartbeat, one "lub-dub" per call (the director paces it):
 *                     warm and round for OUR match point, tighter and darker for THEIRS
 *   stingBlocked      "막았다!" on matchPointStopped: a firm stop + bright "ta-da" when we stopped
 *                     theirs; a deflating "wah-wah" when ours was stopped
 *   stingLead         lead change: a pentatonic run rising for us, falling for them; variant 2 is
 *                     the short brass tag that closes a bank fanfare ("은행째 + 역전" = one sting)
 *   stingEqual        scores level again: a neutral two-note motif (up for us, down for them)
 *   streakFill        scoring run tier: a drum fill (variant 0 = tier 1, variant 1 = tier 2 with
 *                     toms, crash and a brass hit)
 *   streakScratch     a run with a tier got answered: a record-scratch blip (procedural, no sample)
 *   runClimb          a coin deposit (>= 50) that continues our run: one chime on the climb step
 *   finalTick         the last 3 s: a clock tick per second, rising (`step` = seconds left)
 *   vanRev            the final 10 s: the getaway van revving under the music (`step` > 0 bigger)
 *   vanDriveOff       every ending with a winner: after the end horn (the van's own honk,
 *                     ./sfx.ts hornEnd) the winners' van pulls away (engine rising through two
 *                     gears, tyre chirp, "슝" whoosh), synced with the view's getaway beat
 *   tauntPunish       a taunter got bonked: a cartoon "boing-oing"
 *   dodgeWhoosh       the human side-stepped a bot's wind-up: an airy whoosh + slide-whistle zip
 *   clashAccent       head-on clash involving the human: a short brass + snare "ta!" accent
 *   barkBlip          a rival's bark bubble, non-verbal, one timbre per rival (variant 0 호다닥 quick
 *                     chirps, 1 통큰이 low tuba "bwom-bwom", 2 눈치왕 sly ocarina glide)
 *   stingGoldHammer   the golden hammer touches down on the axis pad: sparkle rise + bell hit
 *
 * Convention (as the callouts in ./sfxStage.ts): a negative `step` plays the rival flavor (the
 * other team did it: lower, softer, minor) — except `finalTick` / `vanRev` / `runClimb`, where
 * `step` is a count. Gains are loudness-matched offline through the production mixer against the
 * existing callouts (see test/unit/audio-tension.test.ts and the F8 report).
 */
import { noise, partials, perc, tone } from './dsp';
import { block, brass, clarinet, clav, crash, glock, kick, marimba, pizz, snare, timpani, tom, vibes, whistle } from './instruments';
import { jitter, rrange } from './rng';
import { coin, pn, type SfxRecipe, type SfxVoice } from './sfxkit';
import { midiToHz, scaleNote } from './theory';

export type TensionSfxId =
  | 'tensionHeartbeat'
  | 'stingBlocked'
  | 'stingLead'
  | 'stingEqual'
  | 'streakFill'
  | 'streakScratch'
  | 'runClimb'
  | 'finalTick'
  | 'vanRev'
  | 'vanDriveOff'
  | 'tauntPunish'
  | 'dodgeWhoosh'
  | 'clashAccent'
  | 'barkBlip'
  | 'stingGoldHammer';

/** `variant` of stingLead that closes a bank recovery fanfare instead of a separate sting. */
export const LEAD_BANK_VARIANT = 2;
/** `variant` of barkBlip per rival (the director maps a BarkKey prefix to one of these). */
export const BARK_VARIANT = { hodadak: 0, tongkeun: 1, nunchi: 2 } as const;

/** Light humanization: velocity +-6 %, onset +-4 ms (never before 0). */
const hv = (v: SfxVoice, vel: number): number => vel * jitter(v.rnd, 0.06);
const ht = (v: SfxVoice, at: number): number => Math.max(0, at + (v.rnd() * 2 - 1) * 0.004);
const rival = (v: SfxVoice): boolean => v.step < 0;
/** Pentatonic degree `d` of the key as MIDI (ignores the voice's step: stings use step as a flag). */
const dm = (v: SfxVoice, d: number): number => scaleNote(v.key, d);

/** One soft heartbeat thump: a pitched-down sine knock with a felt-like noise touch. */
function thumpBeat(v: SfxVoice, at: number, f0: number, f1: number, amp: number, decay: number, bright: number): void {
  tone(v, { freq: [[0, f0], [decay * 0.55, f1]], amp: perc(0.004, amp, decay), at });
  tone(v, { freq: [[0, f0 * 2.02], [decay * 0.4, f1 * 2]], amp: perc(0.003, amp * 0.18, decay * 0.45), at });
  noise(v, { color: 'pink', filters: [{ type: 'lowpass', freq: 380 + 500 * bright }], amp: perc(0.002, amp * 0.35, decay * 0.35), at });
}

/** A short engine note (saw through a moving lowpass) — the toy van's motor. */
function engine(v: SfxVoice, at: number, freq: readonly (readonly [number, number])[], amp: readonly (readonly [number, number])[], cutoff: readonly (readonly [number, number])[]): number {
  tone(v, { type: 'sawtooth', freq, amp, filter: { type: 'lowpass', freq: cutoff, q: 3 }, at, vib: { rate: 23, cents: 18 } });
  return tone(v, { type: 'square', freq: freq.map(([t, f]) => [t, f * 0.5] as const), amp: amp.map(([t, a]) => [t, a * 0.55] as const), filter: { type: 'lowpass', freq: 240 }, at });
}

export const TENSION_RECIPES: Record<TensionSfxId, SfxRecipe> = {
  tensionHeartbeat: {
    bus: 'sfx', variants: 2, gain: 0.72, maxVoices: 2, minInterval: 0.2, priority: 6, length: 0.9, global: true,
    play(v) {
      const p = v.pitch * jitter(v.rnd, 0.025);
      const k = v.key;
      if (!rival(v)) {
        // Ours: a warm, round "lub-dub" with a low tonic glow under it (almost there!).
        const gap = 0.19 + v.variant * 0.015;
        thumpBeat(v, ht(v, 0), 96 * p, 52 * p, hv(v, 0.5), 0.2, 0.2);
        thumpBeat(v, ht(v, gap), 84 * p, 48 * p, hv(v, 0.38), 0.22, 0.1);
        tone(v, { type: 'triangle', freq: midiToHz(k - 24) * p, amp: [[0, 0], [0.05, hv(v, 0.07)], [0.3, 0.05], [0.62, 0]] });
        tone(v, { freq: midiToHz(k - 12 + 7) * p, amp: [[0, 0], [0.06, hv(v, 0.025)], [0.5, 0]] });
        return 0.75;
      }
      // Theirs: tighter, higher knock, a dark low D under it and a dry tick (hurry!).
      const gap = 0.15 + v.variant * 0.012;
      thumpBeat(v, ht(v, 0), 120 * p, 62 * p, hv(v, 0.5), 0.15, 0.6);
      thumpBeat(v, ht(v, gap), 108 * p, 58 * p, hv(v, 0.42), 0.16, 0.5);
      tone(v, { type: 'triangle', freq: midiToHz(k - 27) * p, amp: [[0, 0], [0.03, hv(v, 0.07)], [0.25, 0.04], [0.5, 0]] });
      block(v, gap + 0.02, 91 + v.variant * 2, 0.05, hv(v, 0.12));
      return 0.6;
    },
  },

  stingBlocked: {
    bus: 'sfx', variants: 2, gain: 0.75, maxVoices: 1, minInterval: 0.4, priority: 8, length: 1.3, reverb: 0.22, global: true,
    duck: { db: -3, hold: 0.45 },
    play(v) {
      const k = v.key;
      if (rival(v)) {
        // Our match point was stopped: a deflating "wah-wah" falling through D minor.
        const wah = v.variant === 0 ? [[0, 7], [0.16, 4], [0.32, 2]] : [[0, 9], [0.16, 5], [0.32, 2]];
        wah.forEach(([at, st], i) => clarinet(v, ht(v, at), k + st - 12, i === 2 ? 0.45 : 0.13, hv(v, 0.5)));
        tone(v, { type: 'triangle', freq: [[0.32, midiToHz(k - 10)], [0.8, midiToHz(k - 13)]], amp: [[0, 0], [0.34, 0.05], [0.6, 0.04], [0.85, 0]] });
        pizz(v, 0.32, k - 27, 0.3, hv(v, 0.5));
        return 1.05;
      }
      // We stopped theirs: a firm "STOP" hit (kick + snare + brass on the tonic), then a cheeky
      // "ta-da" up the pentatonic.
      kick(v, 0, 0, 0.1, hv(v, 0.6));
      snare(v, 0, 0, 0.1, hv(v, 0.45));
      for (const st of [0, 4, 7]) brass(v, ht(v, 0), k + st - 12, 0.12, hv(v, 0.75));
      brass(v, ht(v, 0), k - 24, 0.12, hv(v, 0.6));
      const tada = v.variant === 0 ? [[0.17, 9], [0.27, 12]] : [[0.17, 7], [0.24, 9], [0.31, 12]];
      tada.forEach(([at, d], i) => marimba(v, ht(v, at), dm(v, d), 0.1, hv(v, i === tada.length - 1 ? 0.8 : 0.6)));
      glock(v, tada[tada.length - 1][0], dm(v, 12) + 12, 0.1, hv(v, 0.28));
      return 1.0;
    },
  },

  stingLead: {
    bus: 'sfx', variants: 3, gain: 0.76, maxVoices: 1, minInterval: 0.4, priority: 8, length: 1.4, reverb: 0.25, global: true,
    duck: { db: -3, hold: 0.5 },
    play(v) {
      const k = v.key;
      if (v.variant === 2) {
        // Bank fanfare tag ("은행째 + 역전"): V -> I up the octave, brass + timpani, rising for us,
        // a minor sigh for them. Played by the director just after the bank fanfare's hit.
        const steps = rival(v) ? [[0, -5], [0.14, -3]] : [[0, 7], [0.14, 12]];
        steps.forEach(([at, st], i) => {
          for (const add of [0, i ? 4 : 5]) brass(v, ht(v, at), k + st + add - (rival(v) ? 12 : 0), i ? 0.4 : 0.1, hv(v, rival(v) ? 0.45 : 0.7));
        });
        timpani(v, 0.14, k - 24 + (rival(v) ? -3 : 0), 0.5, hv(v, 0.55));
        return 1.0;
      }
      if (rival(v)) {
        // They took the lead: a falling run in D minor, soft, ending on a low pizz.
        const notes = v.variant === 0 ? [9, 7, 5, 4, 2] : [10, 8, 7, 5, 3];
        notes.forEach((d, i) => marimba(v, ht(v, i * 0.055), dm(v, d) - 3, 0.1, hv(v, 0.55 - i * 0.04)));
        clarinet(v, ht(v, 0.3), k - 3, 0.4, hv(v, 0.45));
        pizz(v, 0.3, k - 27, 0.3, hv(v, 0.55));
        return 1.05;
      }
      // We took the lead: a quick rising pentatonic run landing on a bright tonic chord.
      const run = v.variant === 0 ? [5, 6, 7, 8, 9, 10] : [4, 5, 7, 8, 9, 11];
      run.forEach((d, i) => (v.variant === 0 ? marimba : glock)(v, ht(v, i * 0.04), dm(v, d), 0.08, hv(v, (v.variant === 0 ? 0.45 : 0.3) + i * 0.03)));
      const hit = run.length * 0.04 + 0.02;
      for (const st of [0, 4, 7, 12]) brass(v, ht(v, hit), k + st, 0.3, hv(v, 0.65));
      brass(v, ht(v, hit), k - 12, 0.3, hv(v, 0.5));
      kick(v, hit, 0, 0.1, hv(v, 0.45));
      crash(v, hit, 0, 0.5, hv(v, 0.32));
      return hit + 1.0;
    },
  },

  stingEqual: {
    bus: 'sfx', variants: 2, gain: 0.76, maxVoices: 1, minInterval: 0.4, priority: 7, length: 1.0, reverb: 0.2, global: true,
    play(v) {
      // Level again: two vibes notes and a woodblock, up for us, down for them.
      const [a, b] = rival(v) ? (v.variant === 0 ? [7, 4] : [9, 5]) : v.variant === 0 ? [4, 7] : [5, 9];
      const s = rival(v) ? 0.75 : 1;
      vibes(v, ht(v, 0), dm(v, a), 0.12, hv(v, 0.7 * s));
      vibes(v, ht(v, 0.13), dm(v, b), 0.3, hv(v, 0.8 * s));
      block(v, 0.13, 84, 0.05, hv(v, 0.35 * s));
      return 0.95;
    },
  },

  streakFill: {
    bus: 'sfx', variants: 2, gain: 0.8, maxVoices: 1, minInterval: 0.5, priority: 7, length: 1.6, reverb: 0.15, global: true,
    play(v) {
      const k = v.key;
      const s = rival(v) ? 0.65 : 1;
      const down = rival(v) ? -3 : 0;
      if (v.variant === 0) {
        // Tier 1 "on a roll": a snare roll-up and a glock sparkle.
        [0, 0.06, 0.12, 0.16, 0.2].forEach((at, i) => snare(v, ht(v, at), 0, 0.05, hv(v, (0.18 + i * 0.06) * s)));
        kick(v, 0.26, 0, 0.1, hv(v, 0.5 * s));
        if (!rival(v)) [10, 11, 12].forEach((d, i) => glock(v, 0.26 + i * 0.035, dm(v, d), 0.08, hv(v, 0.22)));
        else marimba(v, 0.26, k - 3, 0.2, hv(v, 0.45));
        return 0.95;
      }
      // Tier 2 "unstoppable": descending toms, a crash and a brass hit (the music's extra layer
      // takes over from here while the run lasts).
      [[0, 52], [0.07, 50], [0.14, 47], [0.21, 45], [0.27, 43]].forEach(([at, m]) => tom(v, ht(v, at), m + down, 0.1, hv(v, 0.6 * s)));
      kick(v, 0.34, 0, 0.1, hv(v, 0.6 * s));
      crash(v, 0.34, 0, 1, hv(v, 0.45 * s));
      for (const st of rival(v) ? [-3, 0, 4] : [0, 4, 7]) brass(v, ht(v, 0.34), k + st, 0.35, hv(v, 0.7 * s));
      return 1.45;
    },
  },

  streakScratch: {
    bus: 'sfx', variants: 2, gain: 1.78, maxVoices: 1, minInterval: 0.4, priority: 6, length: 0.6, global: true,
    play(v) {
      // Record scratch: a buzzy saw + band-passed noise swept back and forth ("wikka-wik").
      const p = v.pitch * jitter(v.rnd, 0.05);
      const sweep = v.variant === 0
        ? [[0, 260], [0.07, 900], [0.13, 320], [0.2, 720], [0.28, 180]]
        : [[0, 320], [0.06, 820], [0.15, 240], [0.24, 160]];
      const f = sweep.map(([t, x]) => [t, x * p] as const);
      const end = sweep[sweep.length - 1][0];
      tone(v, { type: 'sawtooth', freq: f, amp: [[0, 0], [0.01, 0.09], [end * 0.8, 0.07], [end + 0.03, 0]], filter: { type: 'bandpass', freq: f.map(([t, x]) => [t, x * 2.4] as const), q: 3 } });
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: f.map(([t, x]) => [t, x * 3] as const), q: 4 }], amp: [[0, 0], [0.01, 0.3], [end, 0.2], [end + 0.03, 0]] });
      kick(v, end + 0.02, 0, 0.1, hv(v, 0.25));
      return end + 0.35;
    },
  },

  runClimb: {
    bus: 'sfx', variants: 2, gain: 0.88, maxVoices: 2, minInterval: 0.1, priority: 6, length: 0.9, reverb: 0.25, global: true,
    play(v) {
      // One bright coin chime on the climb step (step = degrees up, like scoreSmall's combo).
      const top = pn(v, 9 + v.variant);
      coin(v, 0, pn(v, 7), 0.16, 0.12, -0.2);
      coin(v, 0.05, top, 0.3, 0.55, 0.15);
      if (v.step >= 3) coin(v, 0.058, top / 2, 0.09, 0.4, 0, true);
      tone(v, { freq: rrange(v.rnd, 5600, 7400), amp: perc(0.001, 0.03, 0.04), at: 0.1 });
      return 0.75;
    },
  },

  finalTick: {
    bus: 'sfx', variants: 2, gain: 1.7, maxVoices: 2, minInterval: 0.3, priority: 8, length: 0.5, global: true,
    play(v) {
      // Clock tick per second for the last 3 s: step = seconds left (3, 2, 1), rising toward 0.
      const left = Math.max(1, Math.min(3, v.step || 3));
      const m = dm(v, 12 + (3 - left) * 2);
      block(v, ht(v, 0), m, 0.06, hv(v, 1 + (3 - left) * 0.05));
      // variant 1: a clock with a little escapement rattle after the tick
      if (v.variant === 1) block(v, 0.045, m - 5, 0.04, hv(v, 0.2));
      tone(v, { type: 'triangle', freq: midiToHz(m - 12), amp: perc(0.002, hv(v, 0.06), 0.08) });
      if (left === 1) glock(v, 0.002, m + 12, 0.1, hv(v, 0.2));
      return 0.35;
    },
  },

  vanRev: {
    bus: 'sfx', variants: 2, gain: 0.85, maxVoices: 2, minInterval: 0.3, priority: 5, length: 1.7, global: true,
    play(v) {
      // The getaway van revving under the music ("vroom-vroom"); step > 0 = a bigger rev.
      const p = v.pitch * jitter(v.rnd, 0.04) * (v.variant === 0 ? 1 : 1.07);
      const big = v.step > 0 ? 1 : 0;
      const a = 0.11 + 0.04 * big;
      engine(
        v,
        0,
        [[0, 48 * p], [0.12, (96 + 30 * big) * p], [0.3, 70 * p], [0.45, (104 + 36 * big) * p], [0.75 + 0.3 * big, 58 * p]],
        [[0, 0], [0.04, a], [0.6, a * 0.9], [1.0 + 0.4 * big, 0]],
        [[0, 300], [0.12, 1100 + 500 * big], [0.35, 600], [0.5, 1300 + 500 * big], [1.0, 400]],
      );
      noise(v, { color: 'brown', filters: [{ type: 'lowpass', freq: 260 }], amp: [[0, 0], [0.05, 0.12], [0.8 + 0.4 * big, 0]] });
      return 1.1 + 0.4 * big;
    },
  },

  vanDriveOff: {
    bus: 'sfx', variants: 2, gain: 0.8, maxVoices: 1, minInterval: 0.6, priority: 6, length: 2.1, global: true,
    play(v) {
      // Pull-away: a tyre chirp, the motor climbing through two gears while it fades into the
      // distance (lowpass closing), and a "슝" whoosh as it leaves.
      const p = v.pitch * jitter(v.rnd, 0.04) * (v.variant === 0 ? 1 : 0.94);
      noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 2300 * p, q: 6 }], amp: [[0, 0], [0.01, 0.14], [0.14, 0.05], [0.2, 0]] });
      engine(
        v,
        0.02,
        [[0, 55 * p], [0.5, 150 * p], [0.62, 95 * p], [1.4, 170 * p]],
        [[0, 0], [0.05, 0.13], [0.55, 0.12], [1.0, 0.07], [1.6, 0]],
        [[0, 500], [0.5, 1700], [0.62, 900], [1.6, 380]],
      );
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: [[0, 500], [0.35, 2600], [0.8, 900]], q: 1.2 }], amp: [[0, 0], [0.3, 0.12], [0.85, 0]], at: 0.35 });
      return 1.75;
    },
  },

  tauntPunish: {
    bus: 'sfx', variants: 2, gain: 0.98, maxVoices: 2, minInterval: 0.2, priority: 6, length: 0.9,
    play(v) {
      // Cartoon "boing-oing": a jaw-harp twang whose wobble dies away, on a note of the key.
      const p = v.pitch * jitter(v.rnd, 0.03);
      const f = midiToHz(dm(v, v.variant === 0 ? 2 : 4) - 12) * p;
      const cents = [[0, 700], [0.6, 40]] as const;
      tone(v, { type: 'square', freq: [[0, f * 0.8], [0.04, f]], amp: perc(0.003, 0.09, 0.6), filter: { type: 'lowpass', freq: [[0, 2600], [0.5, 700]], q: 6 }, vib: { rate: 13, cents } });
      tone(v, { freq: [[0, f * 0.8], [0.04, f]], amp: perc(0.003, 0.18, 0.65), vib: { rate: 13, cents } });
      marimba(v, 0.02, dm(v, 9), 0.1, hv(v, 0.3));
      return 0.75;
    },
  },

  dodgeWhoosh: {
    bus: 'sfx', variants: 2, gain: 1.8, maxVoices: 2, minInterval: 0.2, priority: 5, length: 0.6,
    play(v) {
      // Airy side-step whoosh with a tiny slide-whistle zip up ("휙~").
      const p = v.pitch * jitter(v.rnd, 0.05) * (v.variant === 0 ? 1 : 1.15);
      noise(v, { color: 'pink', filters: [{ type: 'bandpass', freq: [[0, 600 * p], [0.12, 3200 * p], [0.28, 1200 * p]], q: 1.4 }], amp: [[0, 0], [0.09, 0.32], [0.3, 0]] });
      const f = midiToHz(dm(v, 7)) * p;
      tone(v, { freq: [[0.05, f], [0.2, f * 2]], amp: [[0, 0], [0.07, 0.05], [0.18, 0.045], [0.24, 0]], vib: { rate: 10, cents: 20 } });
      return 0.42;
    },
  },

  clashAccent: {
    bus: 'sfx', variants: 2, gain: 1.17, maxVoices: 2, minInterval: 0.25, priority: 6, length: 0.8, reverb: 0.2,
    play(v) {
      // "Ta!": a short brass stab on the tonic chord with a snare crack and a glock ting.
      const k = v.key;
      snare(v, 0, 0, 0.05, hv(v, 0.4));
      for (const st of v.variant === 0 ? [0, 4, 7] : [2, 5, 9]) brass(v, ht(v, 0.005), k + st, 0.07, hv(v, 0.6));
      glock(v, 0.01, dm(v, 12), 0.08, hv(v, 0.25));
      return 0.55;
    },
  },

  barkBlip: {
    bus: 'sfx', variants: 3, gain: 0.74, maxVoices: 2, minInterval: 0.15, priority: 4, length: 0.7,
    play(v) {
      // Non-verbal rival barks (design §13: no mocking voice), one instrument per rival.
      const p = v.pitch * jitter(v.rnd, 0.03);
      if (v.variant === 0) {
        // 호다닥: quick high chirps.
        [[0, 9], [0.07, 11], [0.14, 12]].forEach(([at, d]) => whistle(v, ht(v, at), dm(v, d) + 12, 0.05, hv(v, 0.45)));
        return 0.4;
      }
      if (v.variant === 1) {
        // 통큰이: a low tuba "bwom-bwom".
        [[0, 0], [0.16, -3]].forEach(([at, st], i) => {
          const f = midiToHz(v.key - 24 + st) * p;
          tone(v, { type: 'sawtooth', freq: [[0, f * 0.92], [0.05, f]], amp: [[0, 0], [0.03, 0.12], [0.11, 0.09], [0.16 + i * 0.08, 0]], filter: { type: 'lowpass', freq: [[0, 300], [0.05, 900], [0.15, 450]], q: 1.5 }, at: ht(v, at) });
          tone(v, { freq: f, amp: [[0, 0], [0.03, 0.18], [0.16 + i * 0.08, 0]], at: ht(v, at) });
        });
        return 0.55;
      }
      // 눈치왕: a sly two-note ocarina glide (down then up, "흐~응?").
      const f1 = midiToHz(dm(v, 9)) * p;
      const f2 = midiToHz(dm(v, 7)) * p;
      tone(v, { freq: [[0, f1], [0.14, f2], [0.3, f1 * 1.06]], amp: [[0, 0], [0.04, 0.16], [0.26, 0.12], [0.36, 0]], vib: { rate: 6, cents: 25 } });
      tone(v, { type: 'triangle', freq: [[0, f1 * 2], [0.14, f2 * 2], [0.3, f1 * 2.12]], amp: [[0, 0], [0.04, 0.025], [0.36, 0]] });
      return 0.45;
    },
  },

  stingGoldHammer: {
    bus: 'sfx', variants: 2, gain: 0.85, maxVoices: 1, minInterval: 0.6, priority: 8, length: 1.8, reverb: 0.35, global: true,
    duck: { db: -3, hold: 0.6 },
    play(v) {
      // The golden hammer is HERE: a glock sparkle rising up the key into a bright bell strike on
      // the tonic with a brass swell — "go get it".
      const k = v.key;
      const run = v.variant === 0 ? [7, 8, 9, 10, 11, 12] : [6, 8, 9, 11, 12, 14];
      run.forEach((d, i) => glock(v, ht(v, i * 0.035), dm(v, d), 0.08, hv(v, 0.18 + i * 0.03), (i / 5) * 0.8 - 0.4));
      const hit = run.length * 0.035 + 0.02;
      partials(v, midiToHz(k + 12), [[1, 0.2, 1.1], [2.01, 0.08, 0.6], [3.02, 0.05, 0.35], [4.17, 0.03, 0.2]], { at: hit });
      for (const st of [0, 7, 12]) brass(v, ht(v, hit), k + st - 12, 0.5, hv(v, 0.6));
      clav(v, hit, k + 16, 0.1, hv(v, 0.6));
      return hit + 1.35;
    },
  },
};
