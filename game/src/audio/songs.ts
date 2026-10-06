/**
 * Procedural score: four original tracks in D minor / F major (so every tonal SFX, tuned to the
 * F major pentatonic, fits whichever track is playing).
 *
 *   title    ~110 bpm swung, "cheerful sneaky caper": pizzicato tiptoe bass, finger snaps,
 *            marimba melody with spy-ish leading tones, whistle-led bright bridge.
 *   match    124 bpm heist groove, 32-bar form A B A' C (C = breakdown so 4 minutes never
 *            feel like one loop). Layers follow setMusicIntensity: base (bass, clav, shaker)
 *            -> drums -> lead -> extra (congas, brass hits, fills, countermelody).
 *   final    148 bpm urgent variant for "30초 뒤 출발!": pumping bass, tick-tock clock, stabs.
 *   results  92 bpm gentle bed: pad + marimba arpeggios, bell melody on alternate passes.
 *
 * Melodies are hand-written in a compact bar notation (see parseBar) and varied per pass with
 * a seeded RNG (grace notes, dropped notes, octave doublings), so repeats are never identical.
 * A song only *composes* note events per bar; ./sequencer.ts turns them into sound on time.
 */
import type { TrackId } from './ids';
import type { InstId } from './instruments';
import { chance, type Rng } from './rng';
import { bassNote, chord, noteToMidi, pcAtOrAbove, voicing, type BassRole, type Chord } from './theory';

/**
 * Layers of a track: four follow the music intensity (base -> drums -> lead -> extra); the
 * 'tension' layer (police chase: low toms + pizzicato ostinato) follows setMusicTension instead.
 */
export type IntensityLayerId = 'base' | 'drums' | 'lead' | 'extra';
export type LayerId = IntensityLayerId | 'tension';
export const INTENSITY_LAYERS: readonly IntensityLayerId[] = ['base', 'drums', 'lead', 'extra'];
export const LAYERS: readonly LayerId[] = [...INTENSITY_LAYERS, 'tension'];

export interface NoteEvent {
  /** Position in 16th steps from the bar start (fractions allowed, swing applied later). */
  step: number;
  inst: InstId;
  midi: number;
  /** Length in 16th steps. */
  dur: number;
  vel: number;
  layer: LayerId;
}

export interface ComposeCtx {
  /** Bar index since the track started. */
  bar: number;
  /** Current music intensity 0..1 (dynamic tracks only). */
  intensity: number;
  /** Police chase tension 0..1 (the 'tension' layer is only composed while it is > 0). */
  tension?: number;
  rnd: Rng;
}

export interface InstMix {
  gain?: number;
  pan?: number;
  /** Reverb send (0..1); defaults to the song's reverb. */
  reverb?: number;
}

export interface SongDef {
  id: TrackId;
  bpm: number;
  /** 0..0.34: how late off-beat notes land (0.33 = triplet swing). */
  swing: number;
  swingUnit: 8 | 16;
  /** Tonic for tonal SFX while this track plays (F4). */
  sfxKey: number;
  /** Track output gain (loudness matching between tracks). */
  gain: number;
  reverb: number;
  /** true = layers follow setMusicIntensity; false = all layers always on. */
  dynamic: boolean;
  mix: Partial<Record<InstId, InstMix>>;
  compose(c: ComposeCtx): NoteEvent[];
}

// ---------------------------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------------------------

export interface MelNote {
  step: number;
  midi: number;
  dur: number;
  accent: boolean;
}

/**
 * One bar of melody. Tokens separated by spaces, each worth `unit` 16th steps:
 *   'D5' note, 'D5!' accented note, '.' rest, '-' extends the previous note.
 * Returns the notes and the total length in steps (tests check it equals 16).
 */
export function parseBar(src: string, unit: number): { notes: MelNote[]; steps: number } {
  const notes: MelNote[] = [];
  let pos = 0;
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === '.') {
      pos += unit;
    } else if (tok === '-') {
      if (notes.length) notes[notes.length - 1].dur += unit;
      pos += unit;
    } else {
      const accent = tok.endsWith('!');
      notes.push({ step: pos, midi: noteToMidi(accent ? tok.slice(0, -1) : tok), dur: unit, accent });
      pos += unit;
    }
  }
  return { notes, steps: pos };
}

interface ChordSpan {
  chord: Chord;
  start: number;
  len: number;
}

/** 'Gm7 C7' -> two half-bar spans. */
function spans(sym: string): ChordSpan[] {
  const parts = sym.trim().split(/\s+/);
  const len = 16 / parts.length;
  return parts.map((p, i) => ({ chord: chord(p), start: i * len, len }));
}

type BassPattern = readonly (readonly [number, BassRole, number])[];

/** Bass line for one bar: pattern positions are mapped into each chord span of the bar. */
function bassLine(
  out: NoteEvent[],
  bar: ChordSpan[],
  nextFirst: Chord,
  pat: BassPattern,
  inst: InstId,
  lo: number,
  vel: number,
  layer: LayerId = 'base',
): void {
  for (let s = 0; s < bar.length; s++) {
    const sp = bar[s];
    const next = s + 1 < bar.length ? bar[s + 1].chord : nextFirst;
    const scale = sp.len / 16;
    for (const [step, role, dur] of pat) {
      // With two chords per bar, keep only the first half of the pattern for each, compressed.
      if (bar.length > 1 && step >= 8) continue;
      const st = sp.start + (bar.length > 1 ? step : step * scale);
      const r: BassRole = bar.length > 1 && step >= 4 && role !== 'R' ? 'A' : role;
      out.push({ step: st, inst, midi: bassNote(sp.chord, r, lo, next), dur, vel: vel * (step === 0 ? 1 : 0.85), layer });
    }
  }
}

function chordHits(
  out: NoteEvent[],
  bar: ChordSpan[],
  steps: readonly number[],
  inst: InstId,
  lo: number,
  dur: number,
  vel: number,
  layer: LayerId,
  maxNotes = 3,
): void {
  for (const st of steps) {
    const sp = bar.find((b) => st >= b.start && st < b.start + b.len) ?? bar[0];
    for (const m of voicing(sp.chord, lo, maxNotes)) out.push({ step: st, inst, midi: m, dur, vel, layer });
  }
}

function hits(out: NoteEvent[], inst: InstId, steps: readonly number[], vel: number | ((i: number) => number), layer: LayerId, midi = 60): void {
  steps.forEach((st, i) => out.push({ step: st, inst, midi, dur: 1, vel: typeof vel === 'number' ? vel : vel(i), layer }));
}

/**
 * Melody with per-pass variation: occasional chromatic grace notes into strong notes, rare
 * dropped inner notes. First and last notes always stay (phrase shape is preserved).
 */
function melody(
  out: NoteEvent[],
  src: string,
  unit: number,
  inst: InstId,
  vel: number,
  layer: LayerId,
  rnd: Rng,
  o: { transpose?: number; grace?: number; drop?: number } = {},
): void {
  const { notes } = parseBar(src, unit);
  const tr = o.transpose ?? 0;
  notes.forEach((n, i) => {
    const inner = i > 0 && i < notes.length - 1;
    if (inner && o.drop && chance(rnd, o.drop)) return;
    if (o.grace && n.step % 4 === 0 && n.dur >= 2 && chance(rnd, o.grace)) {
      out.push({ step: n.step - 0.5, inst, midi: n.midi + tr - 1, dur: 0.5, vel: vel * 0.55, layer });
    }
    out.push({ step: n.step, inst, midi: n.midi + tr, dur: n.dur, vel: vel * (n.accent ? 1.15 : 1), layer });
  });
}

// ---------------------------------------------------------------------------------------------
// TITLE — cheerful sneaky caper
// ---------------------------------------------------------------------------------------------

const TITLE_CHORDS = ['Dm', 'Dm', 'Gm', 'Gm', 'Dm', 'Dm', 'Bb7', 'A7', 'F', 'F', 'Bb', 'Bb', 'F', 'Dm', 'Gm7 C7', 'A7'];

/** 8th-note grid (unit 2). A: staccato marimba with spy leading tones. B: legato whistle. */
export const TITLE_MELODY = [
  '. A4 D5 E5 F5 . E5 D5',
  'C#5 D5 . A4 . . . .',
  '. D5 G5 A5 Bb5 . A5 G5',
  'F#5 G5 . D5 . . . .',
  '. A4 D5 E5 F5 . G5 A5',
  'Bb5 A5 G5 F5 E5 . D5 .',
  'D5 . F5 . Ab5 . F5 .',
  'G5 . E5 . C#5 . A4 .',
  'A5 - - G5 F5 - C5 -',
  'D5 - C5 - A4 - - -',
  'Bb4 - D5 - F5 - G5 F5',
  'D5 - - - . . C5 D5',
  'A5 - - G5 F5 - C5 -',
  'F5 - E5 - D5 - A4 -',
  'Bb4 - D5 - E5 - G5 -',
  'C#5 - E5 - G5 - - .',
];

const TITLE_BASS_A: BassPattern = [
  [0, 'R', 2],
  [4, '5', 2],
  [8, 'O', 2],
  [12, 'A', 2],
];
const TITLE_BASS_B: BassPattern = [
  [0, 'R', 3.5],
  [4, '3', 3.5],
  [8, '5', 3.5],
  [12, 'A', 3.5],
];

const title: SongDef = {
  id: 'title',
  bpm: 110,
  swing: 0.3,
  swingUnit: 8,
  sfxKey: 65,
  gain: 0.96,
  reverb: 0.22,
  dynamic: false,
  mix: {
    pizz: { gain: 0.84, reverb: 0.12 },
    marimba: { gain: 1.41, pan: 0.12, reverb: 0.25 },
    whistle: { gain: 0.67, pan: 0.08, reverb: 0.3 },
    vibes: { gain: 0.62, pan: -0.25, reverb: 0.35 },
    glock: { gain: 0.37, pan: 0.3, reverb: 0.4 },
    snap: { gain: 11.73, pan: -0.15, reverb: 0.25 },
    brush: { gain: 4.66, pan: 0.2 },
    kick: { gain: 0.71, reverb: 0.05 },
    shaker: { gain: 5.04, pan: 0.35 },
  },
  compose({ bar, rnd }) {
    const out: NoteEvent[] = [];
    const i = bar % 16;
    const pass = Math.floor(bar / 16);
    const secA = i < 8;
    const b = spans(TITLE_CHORDS[i]);
    const next = spans(TITLE_CHORDS[(i + 1) % 16])[0].chord;
    bassLine(out, b, next, secA ? TITLE_BASS_A : TITLE_BASS_B, 'pizz', 38, secA ? 0.9 : 0.8);
    // Comping: sneaky off-beat stabs in A, sustained bars in B.
    if (secA) chordHits(out, b, [6, 14], 'vibes', 57, 1, 0.55, 'base');
    else chordHits(out, b, b.length > 1 ? [0, 8] : [0], 'vibes', 57, b.length > 1 ? 7 : 14, 0.5, 'base');
    // Percussion.
    hits(out, 'snap', [4, 12], 0.75, 'drums');
    hits(out, 'brush', [0, 4, 6, 8, 12, 14], (k) => [0.5, 0.65, 0.4, 0.5, 0.65, 0.4][k], 'drums');
    hits(out, 'kick', secA ? [0, 8] : [0, 6, 8], (k) => (k === 0 ? 0.55 : 0.4), 'drums');
    if (!secA) hits(out, 'shaker', [0, 2, 4, 6, 8, 10, 12, 14], (k) => (k % 2 ? 0.55 : 0.35), 'extra');
    // Melody.
    const src = TITLE_MELODY[i];
    if (secA) {
      melody(out, src, 2, 'marimba', 0.85, 'lead', rnd, { grace: pass > 0 ? 0.25 : 0.1, drop: pass > 0 ? 0.08 : 0 });
      if (pass % 2 === 1) melody(out, src, 2, 'glock', 0.35, 'extra', rnd, { transpose: 12 });
    } else {
      melody(out, src, 2, 'whistle', 0.8, 'lead', rnd);
      if (pass % 2 === 1) melody(out, src, 2, 'marimba', 0.35, 'extra', rnd, { transpose: -12 });
    }
    // Sparkle at the end of each 8-bar phrase.
    if (i === 7 || i === 15) {
      [74, 77, 81, 86].forEach((m, k) => out.push({ step: 12 + k, inst: 'glock', midi: m, dur: 1, vel: 0.45, layer: 'extra' }));
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// MATCH — upbeat heist groove (A B A' C)
// ---------------------------------------------------------------------------------------------

const M_A = ['Dm7', 'Dm7', 'Bbmaj7', 'C7', 'Dm7', 'Dm7', 'Bbmaj7', 'A7'];
const M_B = ['Gm7', 'C7', 'Fmaj7', 'Bbmaj7', 'Gm7', 'C7', 'Am7', 'A7'];
const M_C = ['Bbmaj7', 'Bbmaj7', 'Gm7', 'A7', 'Bbmaj7', 'Bbmaj7', 'Gm7', 'A7'];
const MATCH_CHORDS = [...M_A, ...M_B, ...M_A, ...M_C];

/** 16th grid (unit 1), 32 bars. */
export const MATCH_MELODY = [
  // A
  'D5 . . D5 . . F5 - . . E5 D5 C5 - A4 -',
  'C5 - D5 - - - - - . . . . . . . .',
  'D5 . . D5 . . F5 - . . A5 G5 F5 - D5 -',
  'E5 - C5 - G4 - - - . . . . . . . .',
  'D5 . . D5 . . F5 - . . E5 D5 C5 - A4 -',
  'C5 - D5 - F5 - A5 - - - . . . . . .',
  'A5 - . G5 F5 - . D5 F5 - - - . . . .',
  'E5 - - - . . . . C#5 - E5 - A4 - - -',
  // B
  'Bb4 - - - D5 - - - F5 - - - - - G5 -',
  'E5 - - - - - - - . . . . C5 - D5 -',
  'E5 - - - F5 - - - A5 - - - - - - -',
  'A5 - - - G5 - F5 - D5 - - - - - - -',
  'Bb4 - - - D5 - - - F5 - - - - - A5 -',
  'G5 - - - - - - - Bb5 - - - G5 - - -',
  'E5 - - - C5 - - - A4 - - - - - - -',
  'C#5 - - - E5 - - - G5 - - - A5 - - -',
  // A'
  'D5 . . D5 . . F5 - . . E5 D5 C5 - A4 -',
  'C5 - D5 - - - - - . . A4 C5 D5 F5 E5 D5',
  'D5 . . D5 . . F5 - . . A5 G5 F5 - D5 -',
  'E5 - C5 - G4 - - - . . G4 A4 Bb4 C5 D5 E5',
  'D5 . . D5 . . F5 - . . E5 D5 C5 - A4 -',
  'C5 - D5 - F5 - A5 - - - C6 - A5 - F5 -',
  'A5 - . G5 F5 - . D5 F5 - - - . . . .',
  'E5 - - - . . . . C#5 - E5 - G5 - A5 -',
  // C (breakdown: sneaky low motif)
  'D4 . F4 . A4 . . . . . . . . . . .',
  '. . . . . . . . A4 . G4 . F4 . D4 .',
  'D4 . G4 . Bb4 . . . . . . . . . . .',
  '. . . . C#5 . . . E5 . . . G4 . A4 .',
  'D4 . F4 . A4 . . . . . . . . . . .',
  '. . . . . . . . A4 . G4 . F4 . D4 .',
  'D4 . G4 . Bb4 . . . . . . . . . . .',
  '. . . . C#5 . . . E5 . . . G4 . A4 .',
];

const M_BASS_A: BassPattern = [
  [0, 'R', 2],
  [3, 'R', 1],
  [6, 'O', 1],
  [8, 'R', 2],
  [10, '5', 1],
  [11, 'O', 1],
  [14, 'A', 2],
];
const M_BASS_B: BassPattern = [
  [0, 'R', 3],
  [4, '5', 2],
  [7, 'R', 1],
  [8, '3', 3],
  [12, '5', 2],
  [14, 'A', 2],
];
const M_BASS_C: BassPattern = [
  [0, 'R', 6],
  [8, '5', 4],
  [14, 'A', 2],
];

/** Police chase layer: a pizzicato ostinato in staccato 8ths over the chord (tension). */
const M_CHASE_OSTINATO: BassPattern = [
  [0, 'R', 0.8],
  [2, 'R', 0.8],
  [4, '5', 0.8],
  [6, 'R', 0.8],
  [8, 'O', 0.8],
  [10, 'R', 0.8],
  [12, '5', 0.8],
  [14, 'A', 0.8],
];
/** Chase toms (step, midi, vel): D3 / C3 / A2 / F2, a 3-3-2 push that ends in a pickup. */
const M_CHASE_TOMS = [
  [0, 50, 0.85],
  [3, 45, 0.55],
  [6, 45, 0.6],
  [8, 48, 0.75],
  [11, 45, 0.55],
  [14, 41, 0.65],
  [15, 45, 0.45],
] as const;

const match: SongDef = {
  id: 'match',
  bpm: 124,
  swing: 0.08,
  swingUnit: 16,
  sfxKey: 65,
  gain: 0.79,
  reverb: 0.16,
  dynamic: true,
  mix: {
    funkBass: { gain: 0.72, reverb: 0 },
    clav: { gain: 1.83, pan: -0.3, reverb: 0.15 },
    organ: { gain: 0.55, pan: 0.2, reverb: 0.3 },
    shaker: { gain: 5.64, pan: 0.4 },
    kick: { gain: 0.81, reverb: 0 },
    snare: { gain: 1.61, reverb: 0.2 },
    hat: { gain: 4.05, pan: 0.25 },
    hatOpen: { gain: 1.49, pan: 0.25 },
    lead: { gain: 0.97, pan: 0.05, reverb: 0.25 },
    whistle: { gain: 0.45, reverb: 0.3 },
    marimba: { gain: 0.89, pan: -0.15, reverb: 0.25 },
    pizz: { gain: 1, pan: -0.1, reverb: 0.2 },
    conga: { gain: 0.95, pan: -0.45 },
    brass: { gain: 0.54, pan: 0.1, reverb: 0.3 },
    tom: { gain: 0.30, reverb: 0.2 },
    crash: { gain: 0.94, pan: 0.3, reverb: 0.2 },
  },
  compose({ bar, intensity, rnd, tension = 0 }) {
    const out: NoteEvent[] = [];
    const i = bar % 32;
    const pass = Math.floor(bar / 32);
    const sec = i < 8 ? 'A' : i < 16 ? 'B' : i < 24 ? "A'" : 'C';
    const inSec = i % 8;
    const b = spans(MATCH_CHORDS[i]);
    const next = spans(MATCH_CHORDS[(i + 1) % 32])[0].chord;

    // --- base layer: bass, comping, shaker ---
    const bassPat = sec === 'B' ? M_BASS_B : sec === 'C' ? M_BASS_C : M_BASS_A;
    bassLine(out, b, next, bassPat, 'funkBass', 36, 0.9);
    if (sec === 'A' || sec === "A'") chordHits(out, b, [2, 6, 9, 14], 'clav', 60, 1, 0.65, 'base');
    if (sec === 'B') {
      chordHits(out, b, [0], 'organ', 57, 15, 0.7, 'base');
      chordHits(out, b, [6, 14], 'clav', 60, 1, 0.5, 'base');
    }
    if (sec === 'C') chordHits(out, b, [0], 'organ', 55, 15, 0.5, 'base');
    if (sec === 'C') hits(out, 'shaker', [0, 2, 4, 6, 8, 10, 12, 14], (k) => (k % 2 ? 0.45 : 0.25), 'base');
    else hits(out, 'shaker', [0, 2, 4, 6, 8, 10, 12, 14], (k) => (k % 2 ? 0.55 : 0.3), 'base');

    // --- drums layer ---
    if (sec === 'C') {
      hits(out, 'kick', inSec % 2 ? [0] : [0, 8], 0.8, 'drums');
      if (inSec < 7) hits(out, 'snare', [12], 0.5, 'drums');
      hits(out, 'hat', [2, 6, 10, 14], 0.4, 'drums');
      if (inSec === 7) {
        // Snare build back into A, stronger when the match is hot.
        const steps = intensity > 0.45 ? [0, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15] : [8, 10, 12, 14];
        hits(out, 'snare', steps, (k) => 0.2 + (0.6 * k) / steps.length, 'drums');
      }
    } else {
      hits(out, 'kick', sec === 'B' ? [0, 8, 10] : [0, 7, 8], (k) => [0.95, 0.6, 0.8][k], 'drums');
      hits(out, 'snare', [4, 12], 0.8, 'drums');
      hits(out, 'snare', [15], 0.18, 'drums');
      const hatSteps = Array.from({ length: 16 }, (_, k) => k).filter((k) => k !== 14);
      hits(out, 'hat', hatSteps, (k) => (hatSteps[k] % 2 ? 0.28 : 0.5), 'drums');
    }

    // --- lead layer ---
    const src = MATCH_MELODY[i];
    if (sec === 'A' || sec === "A'") {
      melody(out, src, 1, 'lead', 0.9, 'lead', rnd, { grace: 0.12 + 0.08 * pass });
      if (sec === "A'") melody(out, src, 1, 'marimba', 0.4, 'extra', rnd, { transpose: 12 });
    } else if (sec === 'B') {
      melody(out, src, 1, pass % 2 ? 'lead' : 'whistle', 0.85, 'lead', rnd);
    } else {
      melody(out, src, 1, inSec < 4 ? 'pizz' : 'marimba', inSec < 4 ? 0.9 : 0.75, 'lead', rnd, {
        transpose: inSec < 4 ? 0 : 12,
      });
    }

    // --- extra layer: congas, open hats, brass hits, countermelody, fills ---
    if (sec !== 'C') {
      out.push(
        { step: 3, inst: 'conga', midi: 69, dur: 1, vel: 0.6, layer: 'extra' },
        { step: 6, inst: 'conga', midi: 62, dur: 1, vel: 0.7, layer: 'extra' },
        { step: 11, inst: 'conga', midi: 69, dur: 1, vel: 0.55, layer: 'extra' },
        { step: 14, inst: 'conga', midi: 62, dur: 1, vel: 0.65, layer: 'extra' },
      );
      hits(out, 'hatOpen', [14], 0.6, 'extra');
    }
    if (inSec === 0) {
      chordHits(out, b, [0], 'brass', 57, 2, 0.75, 'extra', 4);
      hits(out, 'crash', [0], 0.7, 'extra');
    }
    if (sec === 'B') {
      // Countermelody: chord-tone answers while the lead holds.
      const tones = voicing(b[0].chord, 62, 3);
      [8, 10, 12, 14].forEach((st, k) => out.push({ step: st, inst: 'marimba', midi: tones[k % tones.length], dur: 1, vel: 0.45, layer: 'extra' }));
    }
    if (inSec === 7 && sec !== 'C') {
      [50, 47, 45, 43].forEach((m, k) => out.push({ step: 12 + k, inst: 'tom', midi: m, dur: 1, vel: 0.7, layer: 'extra' }));
    }

    // --- tension layer (police on the field): chase toms + pizzicato ostinato ---
    if (tension > 0.01) {
      if (sec === 'C') {
        // Breakdown: keep the pulse, thinner.
        for (const [st, m, v] of M_CHASE_TOMS) if (st === 0 || st === 8 || st === 14) out.push({ step: st, inst: 'tom', midi: m, dur: 1, vel: v * 0.8, layer: 'tension' });
        bassLine(out, b, next, [[0, 'R', 0.8], [4, '5', 0.8], [8, 'O', 0.8], [12, '5', 0.8]], 'pizz', 50, 0.55, 'tension');
      } else {
        for (const [st, m, v] of M_CHASE_TOMS) out.push({ step: st, inst: 'tom', midi: m, dur: 1, vel: v * 1.35, layer: 'tension' });
        bassLine(out, b, next, M_CHASE_OSTINATO, 'pizz', 50, 0.62, 'tension');
        // Low brass chase stabs ("dun-dun!") on the root and fifth of the bar's chord.
        const c0 = b[0].chord;
        for (const [st, role] of [[3, 'R'], [6, '5']] as const) {
          out.push({ step: st, inst: 'brass', midi: bassNote(c0, role, 45), dur: 0.8, vel: 0.6, layer: 'tension' });
          out.push({ step: st, inst: 'brass', midi: bassNote(c0, role, 45) + 12, dur: 0.8, vel: 0.45, layer: 'tension' });
        }
        // A rising snare pickup into every 4th bar.
        if (inSec % 4 === 3) hits(out, 'snare', [12, 13, 14, 15], (k) => 0.18 + k * 0.08, 'tension');
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// FINAL — urgent "30초 뒤 출발!"
// ---------------------------------------------------------------------------------------------

const FINAL_CHORDS = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A7', 'Gm', 'A7', 'Dm', 'Dm', 'Bb', 'Gm', 'A7', 'A7'];

export const FINAL_MELODY = [
  'A4 A4 D5 . A4 A4 E5 . A4 A4 F5 . E5 . D5 .',
  'A4 A4 D5 . A4 A4 E5 . F5 - E5 - D5 - C5 -',
  'Bb4 Bb4 D5 . Bb4 Bb4 F5 . Bb4 Bb4 G5 . F5 . D5 .',
  'C5 C5 E5 . C5 C5 G5 . E5 - G5 - C6 - - -',
  'A4 A4 D5 . A4 A4 E5 . A4 A4 F5 . E5 . D5 .',
  'A4 A4 D5 . A4 A4 E5 . F5 - G5 - A5 - - -',
  'Bb5 - A5 - G5 - F5 - D5 - F5 - Bb5 - - -',
  'A5 - - - G5 - - - E5 - - - C#5 - - -',
  'D5 - - - - - - - Bb4 - - - D5 - - -',
  'C#5 - - - - - - - E5 - - - A5 - - -',
  'F5 - - - - - - - A5 - - - G5 - - -',
  'F5 - - - - - - - E5 - - - D5 - - -',
  'F5 - - - - - - - D5 - - - F5 - - -',
  'G5 - - - - - - - Bb5 - - - G5 - - -',
  'A5 - - - - - - - G5 - - - E5 - - -',
  'C#5 - - - E5 - - - G5 - - - A5 - - -',
];

const FINAL_BASS: BassPattern = [
  [0, 'R', 1.5],
  [2, 'O', 1.5],
  [4, 'R', 1.5],
  [6, 'O', 1.5],
  [8, 'R', 1.5],
  [10, 'O', 1.5],
  [12, 'R', 1.5],
  [14, 'A', 1.5],
];

const final: SongDef = {
  id: 'final',
  bpm: 148,
  swing: 0,
  swingUnit: 16,
  sfxKey: 65,
  gain: 0.77,
  reverb: 0.14,
  dynamic: false,
  mix: {
    synthBass: { gain: 0.50, reverb: 0 },
    kick: { gain: 0.78, reverb: 0 },
    snare: { gain: 1.33, reverb: 0.15 },
    hat: { gain: 3.55, pan: 0.25 },
    hatOpen: { gain: 1.59, pan: 0.25 },
    block: { gain: 2.82, pan: -0.35, reverb: 0.2 },
    brass: { gain: 1.23, pan: -0.1, reverb: 0.25 },
    lead: { gain: 0.93, pan: 0.1, reverb: 0.2 },
    crash: { gain: 1.04, pan: 0.3 },
  },
  compose({ bar, rnd }) {
    const out: NoteEvent[] = [];
    const i = bar % 16;
    const b = spans(FINAL_CHORDS[i]);
    const next = spans(FINAL_CHORDS[(i + 1) % 16])[0].chord;
    bassLine(out, b, next, FINAL_BASS, 'synthBass', 36, 0.9);
    chordHits(out, b, i < 8 ? [0, 6] : [0, 3, 6], 'brass', 57, 1.5, 0.7, 'base');
    hits(out, 'kick', [0, 4, 8, 12], 0.9, 'drums');
    hits(out, 'snare', [4, 12], 0.8, 'drums');
    hits(out, 'hat', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15], (k) => (k % 2 ? 0.3 : 0.5), 'drums');
    hits(out, 'hatOpen', [14], 0.55, 'drums');
    // Tick-tock clock: the urgency signature.
    out.push(
      { step: 0, inst: 'block', midi: 84, dur: 1, vel: 0.6, layer: 'extra' },
      { step: 4, inst: 'block', midi: 79, dur: 1, vel: 0.5, layer: 'extra' },
      { step: 8, inst: 'block', midi: 84, dur: 1, vel: 0.6, layer: 'extra' },
      { step: 12, inst: 'block', midi: 79, dur: 1, vel: 0.5, layer: 'extra' },
    );
    if (i === 15) hits(out, 'snare', [8, 9, 10, 11, 12, 13, 14, 15], (k) => 0.3 + k * 0.07, 'drums');
    if (i === 0 || i === 8) hits(out, 'crash', [0], 0.75, 'extra');
    const src = FINAL_MELODY[i];
    if (i < 8) melody(out, src, 1, 'lead', 0.85, 'lead', rnd);
    else melody(out, src, 1, 'brass', 0.75, 'lead', rnd);
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// RESULTS — gentle bed
// ---------------------------------------------------------------------------------------------

const RESULTS_CHORDS = ['Fmaj7', 'Dm7', 'Bbmaj7', 'C7sus4 C7'];
export const RESULTS_MELODY = ['C6 - - - A5 - - -', 'F5 - - - A5 - - -', 'D6 - - - C6 - A5 -', 'G5 - - - - - - -'];

const results: SongDef = {
  id: 'results',
  bpm: 92,
  swing: 0.2,
  swingUnit: 8,
  sfxKey: 65,
  gain: 0.86,
  reverb: 0.3,
  dynamic: false,
  mix: {
    pad: { gain: 1.04, reverb: 0.4 },
    marimba: { gain: 1.65, pan: -0.1, reverb: 0.3 },
    pizz: { gain: 0.58, reverb: 0.15 },
    shaker: { gain: 6.12, pan: 0.35 },
    brush: { gain: 3.52, pan: 0.2 },
    tine: { gain: 1.62, pan: 0.2, reverb: 0.45 },
  },
  compose({ bar, rnd }) {
    const out: NoteEvent[] = [];
    const i = bar % 4;
    const pass = Math.floor(bar / 4);
    const b = spans(RESULTS_CHORDS[i]);
    const next = spans(RESULTS_CHORDS[(i + 1) % 4])[0].chord;
    for (const sp of b) for (const m of voicing(sp.chord, 57, 3)) out.push({ step: sp.start, inst: 'pad', midi: m, dur: sp.len, vel: 0.8, layer: 'base' });
    bassLine(out, b, next, [[0, 'R', 6], [8, '5', 6]], 'pizz', 41, 0.75);
    // Arpeggio of chord tones (root included) in the middle register; direction alternates and
    // each half follows the chord sounding under it.
    const order = pass % 2 ? [3, 2, 1, 0, 1, 2, 3, 2] : [0, 1, 2, 3, 2, 1, 0, 1];
    order.forEach((k, j) => {
      const step = j * 2;
      const c = (b.find((sp) => step >= sp.start && step < sp.start + sp.len) ?? b[0]).chord;
      const tones = c.tones.map((iv) => pcAtOrAbove((c.root + iv) % 12, 65)).sort((x, y) => x - y);
      out.push({ step, inst: 'marimba', midi: tones[k % tones.length], dur: 2, vel: j % 2 ? 0.45 : 0.6, layer: 'base' });
    });
    hits(out, 'shaker', [0, 2, 4, 6, 8, 10, 12, 14], (k) => (k % 2 ? 0.45 : 0.25), 'drums');
    hits(out, 'brush', [4, 12], 0.45, 'drums');
    if (pass % 2 === 1) melody(out, RESULTS_MELODY[i], 2, 'tine', 0.7, 'lead', rnd);
    return out;
  },
};

export const SONGS: Readonly<Record<TrackId, SongDef>> = { title, match, final, results };

/** Bar duration (s) of a song. */
export const barSeconds = (s: SongDef): number => (4 * 60) / s.bpm;

/** Chord symbols per bar (exported for tests / tooling). */
export const SONG_CHORDS: Readonly<Record<TrackId, readonly string[]>> = {
  title: TITLE_CHORDS,
  match: MATCH_CHORDS,
  final: FINAL_CHORDS,
  results: RESULTS_CHORDS,
};
export const SONG_MELODIES: Readonly<Record<TrackId, { bars: readonly string[]; unit: number }>> = {
  title: { bars: TITLE_MELODY, unit: 2 },
  match: { bars: MATCH_MELODY, unit: 1 },
  final: { bars: FINAL_MELODY, unit: 1 },
  results: { bars: RESULTS_MELODY, unit: 2 },
};
