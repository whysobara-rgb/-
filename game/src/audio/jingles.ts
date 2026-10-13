/**
 * Result stingers (victory / defeat / draw). Short original phrases on the same instruments as
 * the score so they sit naturally before the results bed. Defeat is wistful and gentle, never
 * mocking (doc §13: 패배는 처벌 대신 짧은 반응).
 *
 * Each result has several composed variations (a player hears one after every match, so the
 * same four seconds must not wear thin over a long session), and every performance is lightly
 * humanized (velocity and timing) from the voice's random stream.
 *
 * Scores are data so a unit test can check the harmony: chord symbols are spelled in the home
 * key F major (key = 65); every pitch is in semitones relative to the key tonic.
 */
import { sub, type Target } from './dsp';
import {
  block,
  brass,
  clap,
  clarinet,
  crash,
  glock,
  hat,
  kick,
  marimba,
  organ,
  pad,
  pizz,
  snare,
  timpani,
  vibes,
  type NoteFn,
} from './instruments';
import { scaleNote } from './theory';

export type JingleId = 'victory' | 'defeat' | 'draw';

/** [8th index, semitones above the key tonic, length in 8ths, velocity] */
export type JingleNote = readonly [at: number, semis: number, len: number, vel: number];

export interface JingleChord {
  /** 8th index and length in 8ths. */
  at: number;
  len: number;
  /** Chord symbol in the home key (F major), e.g. 'Bbmaj7' (checked by tests). */
  sym: string;
  /** Voicing, semitones relative to the key tonic. */
  notes: readonly number[];
  /** Instrument / velocity override for this chord (default: the score's comping). */
  inst?: NoteFn;
  vel?: number;
}

export interface JingleScore {
  /** Seconds per 8th note. */
  unit: number;
  /** Seconds the final chord rings after the last 8th. */
  tail: number;
  /** Total length in 8ths (the final chord starts before this). */
  eighths: number;
  /** Overall level (loudness-matched across variations, measured offline). */
  level: number;
  melody: readonly JingleNote[];
  lead: NoteFn;
  leadVel: number;
  /** Optional doubling of the melody: instrument, octave shift (semitones), relative velocity. */
  double?: { inst: NoteFn; shift: number; vel: number };
  chords: readonly JingleChord[];
  comp: NoteFn;
  compVel: number;
  bass: readonly JingleNote[];
  /** Drums, fills and decorative flourishes (unpitched or outside the harmony check). */
  extras?: (v: Target, u: number, key: number) => void;
}

// ---------------------------------------------------------------------------------------------
// Victory: bright F major, ~4 s
// ---------------------------------------------------------------------------------------------

const VICTORY: readonly JingleScore[] = [
  // v0 "hooray": marimba over soft brass, organ comping, glockenspiel run up at the end.
  {
    unit: 0.2,
    tail: 1.7,
    eighths: 12,
    level: 1,
    melody: [
      [0, 4, 1, 0.8],
      [1, 7, 1, 0.8],
      [2, 12, 1, 0.9],
      [3, 16, 1, 1],
      [4, 14, 1, 0.85],
      [5, 16, 1, 0.9],
      [6, 19, 2, 1],
      [8, 17, 1, 0.85],
      [9, 16, 1, 0.85],
      [10, 14, 1, 0.85],
      [11, 11, 1, 0.85],
      [12, 12, 6, 1],
    ],
    lead: marimba,
    leadVel: 0.9,
    double: { inst: brass, shift: -12, vel: 0.55 / 0.9 },
    comp: organ,
    compVel: 0.7,
    chords: [
      { at: 0, len: 4, sym: 'F', notes: [-8, -5, 0] },
      { at: 4, len: 4, sym: 'F', notes: [-8, -5, 0] },
      { at: 8, len: 2, sym: 'Bb', notes: [-7, -3, 0] },
      { at: 10, len: 2, sym: 'C', notes: [-5, -1, 2] },
      { at: 12, len: 7, sym: 'F', notes: [-12, -8, -5, 0], inst: brass, vel: 0.6 },
    ],
    bass: [
      [0, -24, 2, 1],
      [2, -17, 2, 0.9],
      [4, -24, 2, 1],
      [6, -20, 2, 0.9],
      [8, -19, 2, 1],
      [10, -17, 2, 0.9],
      [12, -24, 6, 1],
    ],
    extras(v, u, key) {
      for (const i of [0, 4, 8, 12]) kick(v, i * u, 0, 0.2, 0.7);
      for (const i of [2, 6, 10, 10.5, 11, 11.5]) snare(v, i * u, 0, 0.1, i >= 10 ? 0.35 + (i - 10) * 0.15 : 0.45);
      for (let i = 0; i < 12; i++) hat(v, i * u, 0, 0.05, i % 2 ? 0.5 : 0.8);
      crash(v, 12 * u, 0, 1, 0.8);
      for (let i = 0; i < 8; i++) glock(v, 12 * u + i * 0.045, scaleNote(key, 8 + i), 0.1, 0.4, i / 4 - 1);
    },
  },
  // v1 "cheeky skip": through D minor and back, vibes comping, double clap, sparkle falling down.
  {
    unit: 0.2,
    tail: 1.7,
    eighths: 12,
    level: 1,
    melody: [
      [0, 7, 1, 0.8],
      [1, 12, 1, 0.8],
      [2, 16, 1, 0.9],
      [3, 12, 1, 0.8],
      [4, 9, 1, 0.85],
      [5, 12, 1, 0.85],
      [6, 16, 2, 1],
      [8, 17, 1, 0.9],
      [9, 14, 1, 0.85],
      [10, 19, 1, 0.95],
      [11, 14, 1, 0.85],
      [12, 16, 6, 1],
    ],
    lead: marimba,
    leadVel: 0.95,
    double: { inst: glock, shift: 12, vel: 0.3 },
    comp: vibes,
    compVel: 0.55,
    chords: [
      { at: 0, len: 4, sym: 'F', notes: [-8, -5, 0] },
      { at: 4, len: 4, sym: 'Dm7', notes: [-8, -5, -3, 0] },
      { at: 8, len: 2, sym: 'Bb', notes: [-7, -3, 0] },
      { at: 10, len: 2, sym: 'C', notes: [-5, -1, 2] },
      { at: 12, len: 7, sym: 'F', notes: [-12, -8, -5, 0], inst: brass, vel: 0.6 },
    ],
    bass: [
      [0, -24, 2, 1],
      [2, -17, 2, 0.9],
      [4, -27, 2, 1],
      [6, -20, 2, 0.9],
      [8, -19, 2, 1],
      [10, -17, 2, 0.9],
      [12, -24, 6, 1],
    ],
    extras(v, u, key) {
      for (const i of [0, 3, 6, 8, 12]) kick(v, i * u, 0, 0.2, 0.7);
      snare(v, 4 * u, 0, 0.1, 0.45);
      for (const i of [10, 11]) clap(v, i * u, 0, 0.1, 0.5);
      for (let i = 0; i < 12; i++) hat(v, i * u, 0, 0.05, i % 2 ? 0.45 : 0.75);
      crash(v, 12 * u, 0, 1, 0.75);
      for (let i = 0; i < 6; i++) glock(v, 12 * u + i * 0.05, scaleNote(key, 14 - i), 0.1, 0.35, 1 - i / 3);
      glock(v, 12 * u + 0.42, scaleNote(key, 12), 0.2, 0.45);
    },
  },
  // v2 "fanfare": triplet pickup on brass, timpani, snare roll into the final chord.
  {
    unit: 0.21,
    tail: 1.8,
    eighths: 12,
    level: 0.92,
    melody: [
      [0, 7, 0.67, 0.8],
      [0.67, 7, 0.67, 0.72],
      [1.33, 7, 0.67, 0.8],
      [2, 12, 2, 1],
      [4, 14, 1, 0.9],
      [5, 17, 1, 0.9],
      [6, 16, 2, 1],
      [8, 14, 1, 0.9],
      [9, 17, 1, 0.9],
      [10, 19, 1, 0.95],
      [11, 16, 1, 0.9],
      [12, 12, 6, 1],
    ],
    lead: brass,
    leadVel: 0.75,
    double: { inst: marimba, shift: 0, vel: 0.8 },
    comp: organ,
    compVel: 0.55,
    chords: [
      { at: 0, len: 2, sym: 'F', notes: [-8, -5, 0] },
      { at: 2, len: 2, sym: 'F', notes: [-8, -5, 0] },
      { at: 4, len: 2, sym: 'Bb', notes: [-7, -3, 0] },
      { at: 6, len: 2, sym: 'F', notes: [-8, -5, 0] },
      { at: 8, len: 2, sym: 'Gm7', notes: [-10, -7, -3, 0] },
      { at: 10, len: 2, sym: 'C7', notes: [-5, -1, 2, 5] },
      { at: 12, len: 7, sym: 'F', notes: [-12, -8, -5, 0], inst: brass, vel: 0.55 },
    ],
    bass: [
      [0, -24, 2, 1],
      [2, -17, 2, 0.9],
      [4, -19, 2, 1],
      [6, -20, 2, 0.9],
      [8, -22, 2, 1],
      [10, -17, 2, 0.9],
      [12, -24, 6, 1],
    ],
    extras(v, u, key) {
      timpani(v, 0, key - 24, 0.5, 0.6);
      timpani(v, 2 * u, key - 17, 0.5, 0.5);
      for (const i of [4, 8]) kick(v, i * u, 0, 0.2, 0.65);
      for (const i of [2, 6]) snare(v, i * u, 0, 0.1, 0.4);
      for (let k = 0; k < 8; k++) snare(v, (10 + k * 0.25) * u, 0, 0.05, 0.22 + k * 0.05);
      timpani(v, 12 * u, key - 24, 1, 0.75);
      crash(v, 12 * u, 0, 1, 0.8);
      glock(v, 12 * u + 0.12, scaleNote(key, 10), 0.2, 0.4);
      glock(v, 12 * u + 0.2, scaleNote(key, 12), 0.2, 0.4);
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Defeat: wistful D minor, gentle, ~4 s
// ---------------------------------------------------------------------------------------------

const DEFEAT: readonly JingleScore[] = [
  // v0 "aw, shucks": clarinet over soft vibes, Gm(add9) -> A7 -> Dm(add9), a hopeful plip.
  {
    unit: 0.3,
    tail: 1.1,
    eighths: 10,
    level: 1,
    melody: [
      [0, 4, 1, 0.8],
      [1, 2, 1, 0.75],
      [2, 0, 1, 0.75],
      [3, -1, 2, 0.8],
      [5, -3, 5, 0.85],
    ],
    lead: clarinet,
    leadVel: 1,
    comp: vibes,
    compVel: 0.45,
    chords: [
      { at: 0, len: 3, sym: 'Gmadd9', notes: [-10, -7, -3, 4] },
      { at: 3, len: 2, sym: 'A7', notes: [-8, -4, -1, 2] },
      { at: 5, len: 5, sym: 'Dmadd9', notes: [-8, -3, 0, 11], vel: 0.4 },
    ],
    bass: [
      [0, -22, 3, 0.8],
      [3, -20, 2, 0.8],
      [5, -27, 5, 0.85],
    ],
    extras(v, u, key) {
      // A tiny hopeful "plip" so it ends with a shrug, not a punishment.
      marimba(v, 9.4 * u, key + 21, 0.1, 0.35);
    },
  },
  // v1 "sigh": falling vibes line over a lament bass (Bb -> A -> D), soft pad, two little plips.
  {
    unit: 0.3,
    tail: 1.2,
    eighths: 10,
    level: 1.15,
    melody: [
      [0, 9, 1, 0.75],
      [1, 7, 1, 0.7],
      [2, 5, 1, 0.7],
      [3, 4, 1, 0.75],
      [4, 2, 1, 0.7],
      [5, 0, 1, 0.72],
      [6, -3, 4, 0.8],
    ],
    lead: vibes,
    leadVel: 0.9,
    comp: pad,
    compVel: 0.45,
    chords: [
      { at: 0, len: 3, sym: 'Bbmaj7', notes: [-7, -3, 0, 4] },
      { at: 3, len: 2, sym: 'A7', notes: [-8, -4, -1, 2] },
      { at: 5, len: 5, sym: 'Dm', notes: [-8, -3, 0, 4] },
    ],
    bass: [
      [0, -19, 3, 0.8],
      [3, -20, 2, 0.8],
      [5, -27, 5, 0.85],
    ],
    extras(v, u, key) {
      glock(v, 9 * u, key + 16, 0.1, 0.22);
      glock(v, 9.35 * u, key + 21, 0.1, 0.26);
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Draw: "we'll settle this next time", ends unresolved on a sus4
// ---------------------------------------------------------------------------------------------

const DRAW: readonly JingleScore[] = [
  // v0: Fadd9 -> Bb -> Csus4 left hanging, woodblock "tick-tock" falling.
  {
    unit: 0.25,
    tail: 0.8,
    eighths: 10,
    level: 1,
    melody: [
      [0, 4, 1, 0.8],
      [1, 7, 1, 0.8],
      [2, 9, 2, 0.85],
      [4, 9, 1, 0.8],
      [5, 7, 1, 0.8],
      [6, 14, 3, 0.9],
    ],
    lead: marimba,
    leadVel: 1,
    comp: organ,
    compVel: 0.6,
    chords: [
      { at: 0, len: 4, sym: 'Fadd9', notes: [-8, -5, 2] },
      { at: 4, len: 2, sym: 'Bb', notes: [-7, -3, 0] },
      { at: 6, len: 4, sym: 'Csus4', notes: [-5, 0, 2] },
    ],
    bass: [
      [0, -24, 2, 0.8],
      [4, -19, 2, 0.8],
      [6, -17, 4, 0.85],
    ],
    extras(v, u, key) {
      block(v, 9 * u, key + 19, 0.05, 0.6);
      block(v, 9.6 * u, key + 14, 0.05, 0.5);
    },
  },
  // v1: Dm7 -> Bb -> Csus4, the line stops on the suspended 4th; woodblock asks "huh?" (rising).
  {
    unit: 0.25,
    tail: 0.8,
    eighths: 10,
    level: 1,
    melody: [
      [0, 9, 1, 0.8],
      [1, 12, 1, 0.8],
      [2, 16, 2, 0.85],
      [4, 14, 1, 0.8],
      [5, 12, 1, 0.8],
      [6, 12, 3, 0.9],
    ],
    lead: marimba,
    leadVel: 1,
    double: { inst: vibes, shift: -12, vel: 0.35 },
    comp: organ,
    compVel: 0.55,
    chords: [
      { at: 0, len: 4, sym: 'Dm7', notes: [-8, -5, -3, 0] },
      { at: 4, len: 2, sym: 'Bb', notes: [-7, -3, 0] },
      { at: 6, len: 4, sym: 'Csus4', notes: [-5, 0, 2] },
    ],
    bass: [
      [0, -27, 2, 0.8],
      [2, -20, 2, 0.75],
      [4, -19, 2, 0.8],
      [6, -17, 4, 0.85],
    ],
    extras(v, u, key) {
      block(v, 8.8 * u, key + 14, 0.05, 0.5);
      block(v, 9.5 * u, key + 19, 0.05, 0.6);
    },
  },
];

export const JINGLES: Readonly<Record<JingleId, readonly JingleScore[]>> = {
  victory: VICTORY,
  defeat: DEFEAT,
  draw: DRAW,
};

/** Light humanization: velocity +-6 %, melodic timing +-5 ms (never before the downbeat). */
const human = (v: Target, at: number, vel: number, loose: boolean): [number, number] => [
  loose && at > 0 ? at + (v.rnd() * 2 - 1) * 0.005 : at,
  vel * (0.94 + v.rnd() * 0.12),
];

/**
 * Schedules variation `variant` of the jingle into v.out. `key` = tonic MIDI (F4 = 65).
 * Returns the duration (s).
 */
export function playJingle(v0: Target, id: JingleId, key: number, variant = 0): number {
  const all = JINGLES[id];
  const s = all[((Math.floor(variant) % all.length) + all.length) % all.length];
  let v = v0;
  if (s.level !== 1) {
    const g = v0.ctx.createGain();
    g.gain.value = s.level;
    g.connect(v0.out);
    v = sub(v0, g);
  }
  const u = s.unit;
  for (const [i, st, len, vel] of s.melody) {
    const [at, vv] = human(v, i * u, vel * s.leadVel, true);
    s.lead(v, at, key + st, len * u, vv);
    if (s.double) s.double.inst(v, at, key + st + s.double.shift, len * u, vv * s.double.vel);
  }
  for (const c of s.chords) {
    const fn = c.inst ?? s.comp;
    for (const st of c.notes) {
      const [at, vv] = human(v, c.at * u, c.vel ?? s.compVel, false);
      fn(v, at, key + st, c.len * u, vv);
    }
  }
  for (const [i, st, len, vel] of s.bass) {
    const [at, vv] = human(v, i * u, vel, false);
    pizz(v, at, key + st, len * u, vv);
  }
  s.extras?.(v, u, key);
  return s.eighths * u + s.tail;
}
