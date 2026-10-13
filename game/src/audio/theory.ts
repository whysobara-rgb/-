/**
 * Pitch helpers shared by music and tonal sound effects.
 *
 * Every track is written in D minor / F major, so the F major pentatonic (F G A C D) fits all
 * of them. Tonal SFX (coins, chimes, menu blips) pick their notes from that scale, which is how
 * "효과음을 현재 곡의 조성에 맞춤" (ART_DIRECTION §1) is achieved, and consecutive recoveries
 * climb it one degree at a time.
 */

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' -> 60, 'F#5' -> 78, 'Bb3' -> 58. Throws on malformed names (authoring error). */
export function noteToMidi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note name: ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_BASE[m[1]] + acc;
}

export const MAJOR_PENTATONIC = [0, 2, 4, 7, 9] as const;

/** Default tonic for tonal SFX: F4. All tracks are in F major / D minor. */
export const SFX_KEY_ROOT = 65;

/** Note `degree` steps up (or down) the scale from `root` (degree 0 = root). */
export function scaleNote(root: number, degree: number, scale: readonly number[] = MAJOR_PENTATONIC): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = degree - oct * n;
  return root + 12 * oct + scale[idx];
}

/** Chord: root pitch class (0..11, C = 0) + intervals from the root. */
export interface Chord {
  root: number;
  tones: readonly number[];
}

const QUALITIES: Record<string, readonly number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  m6: [0, 3, 7, 9],
  '6': [0, 4, 7, 9],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
};

/** 'Dm7' -> { root: 2, tones: [0,3,7,10] }. */
export function chord(symbol: string): Chord {
  const m = /^([A-G])(#|b)?(.*)$/.exec(symbol);
  if (!m || !(m[3] in QUALITIES)) throw new Error(`bad chord: ${symbol}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { root: (NOTE_BASE[m[1]] + acc + 12) % 12, tones: QUALITIES[m[3]] };
}

/** Lowest MIDI note >= lo with pitch class pc. */
export function pcAtOrAbove(pc: number, lo: number): number {
  const base = lo - (((lo % 12) + 12) % 12) + pc;
  return base >= lo ? base : base + 12;
}

/**
 * Close-position voicing of the chord's upper tones (3rd, 5th, 7th...) inside [lo, lo+12).
 * The root is left to the bass, which keeps comping light and avoids low mud.
 */
export function voicing(c: Chord, lo: number, maxNotes = 3): number[] {
  const tones = c.tones.length > 3 ? c.tones.slice(1) : c.tones;
  const notes = tones.map((iv) => pcAtOrAbove((c.root + iv) % 12, lo));
  notes.sort((a, b) => a - b);
  return notes.slice(0, maxNotes);
}

/** Bass pitch for a chord-relative role in octave starting at `lo` (e.g. 38 = D2). */
export function bassNote(c: Chord, role: BassRole, lo: number, next?: Chord): number {
  const root = pcAtOrAbove(c.root, lo);
  switch (role) {
    case 'R':
      return root;
    case 'O':
      return root + 12;
    case '3':
      return root + (c.tones[1] ?? 4);
    case '5':
      return root + (c.tones.includes(7) ? 7 : c.tones[2] ?? 7);
    case '7': {
      const sev = c.tones.find((t) => t === 10 || t === 11);
      return sev === undefined ? root + 12 : root + sev;
    }
    case 'A': {
      // Chromatic approach into the next chord's root (from below; from above when that
      // would collide with the current root).
      const target = next ? pcAtOrAbove(next.root, lo) : root;
      const below = target - 1;
      return below === root ? target + 1 : below;
    }
  }
}
export type BassRole = 'R' | 'O' | '3' | '5' | '7' | 'A';
