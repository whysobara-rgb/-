/**
 * Score integrity: notation, harmony sanity, composition output and sequencer math.
 * Catches authoring mistakes (a bar one 16th too long, a sustained note grinding a semitone
 * against the chord, an instrument id typo) that would otherwise only be heard in game.
 */
import { describe, expect, it } from 'vitest';
import { TRACK_IDS } from '../../src/audio/ids';
import { INSTRUMENTS } from '../../src/audio/instruments';
import { makeRng } from '../../src/audio/rng';
import { layerLevels, swingStep } from '../../src/audio/sequencer';
import { SONGS, SONG_CHORDS, SONG_MELODIES, parseBar } from '../../src/audio/songs';
import { MAJOR_PENTATONIC, chord, noteToMidi, scaleNote, voicing } from '../../src/audio/theory';

describe('theory helpers', () => {
  it('parses notes and chords', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(chord('Dm7')).toEqual({ root: 2, tones: [0, 3, 7, 10] });
    expect(chord('Bbmaj7').root).toBe(10);
    expect(() => noteToMidi('H2')).toThrow();
    expect(() => chord('Dx9')).toThrow();
  });

  it('pentatonic degrees climb (combo) and stay in F major pentatonic', () => {
    const pcs = new Set([0, 2, 4, 7, 9].map((x) => (65 + x) % 12));
    let prev = -Infinity;
    for (let d = -5; d < 20; d++) {
      const m = scaleNote(65, d, MAJOR_PENTATONIC);
      expect(m).toBeGreaterThan(prev);
      expect(pcs.has(((m % 12) + 12) % 12)).toBe(true);
      prev = m;
    }
  });

  it('voicings stay within one octave above the floor', () => {
    for (const sym of ['Dm7', 'Bbmaj7', 'C7', 'A7', 'F', 'Gm']) {
      const v = voicing(chord(sym), 57);
      expect(v.length).toBeGreaterThanOrEqual(2);
      for (const m of v) {
        expect(m).toBeGreaterThanOrEqual(57);
        expect(m).toBeLessThan(69);
      }
    }
  });
});

describe('scores', () => {
  for (const id of TRACK_IDS) {
    const { bars, unit } = SONG_MELODIES[id];
    const chords = SONG_CHORDS[id];

    it(`${id}: every melody bar is exactly one 4/4 bar and matches the chord chart`, () => {
      expect(bars.length).toBe(chords.length);
      bars.forEach((b, i) => expect(parseBar(b, unit).steps, `${id} bar ${i + 1}`).toBe(16));
    });

    it(`${id}: no sustained melody note sits a half step above a chord tone (avoid notes)`, () => {
      bars.forEach((b, i) => {
        const parts = chords[i].split(' ');
        const span = 16 / parts.length;
        for (const n of parseBar(b, unit).notes) {
          if (n.dur < 4) continue; // passing / neighbour tones are fine
          const c = chord(parts[Math.min(parts.length - 1, Math.floor(n.step / span))]);
          const pc = n.midi % 12;
          const tones = c.tones.map((iv) => (c.root + iv) % 12);
          if (tones.includes(pc)) continue;
          for (const tpc of tones) {
            expect((pc - tpc + 12) % 12, `${id} bar ${i + 1} note ${n.midi} vs chord ${chords[i]}`).not.toBe(1);
          }
        }
      });
    });

    it(`${id}: accompaniment (comping, pads, arpeggios) only plays chord tones`, () => {
      const song = SONGS[id];
      const rnd = makeRng(3);
      const comp = new Set(['vibes', 'clav', 'organ', 'pad']);
      for (let bar = 0; bar < chords.length * 2; bar++) {
        const parts = chords[bar % chords.length].split(' ');
        const span = 16 / parts.length;
        for (const e of song.compose({ bar, intensity: 1, rnd })) {
          const isComp = comp.has(e.inst) || (id === 'results' && e.inst === 'marimba');
          if (!isComp || e.layer === 'lead') continue;
          const c = chord(parts[Math.min(parts.length - 1, Math.floor(Math.max(0, e.step) / span))]);
          const tones = c.tones.map((iv) => (c.root + iv) % 12);
          expect(tones, `${id} bar ${bar + 1} ${e.inst} step ${e.step} midi ${e.midi}`).toContain(e.midi % 12);
        }
      }
    });

    it(`${id}: composes valid events for 64 bars at any intensity`, () => {
      const song = SONGS[id];
      const rnd = makeRng(5);
      for (let bar = 0; bar < 64; bar++) {
        const evs = song.compose({ bar, intensity: (bar % 5) / 4, rnd });
        expect(evs.length, `${id} bar ${bar}`).toBeGreaterThan(3);
        for (const e of evs) {
          expect(INSTRUMENTS[e.inst], e.inst).toBeTypeOf('function');
          expect(Number.isFinite(e.midi)).toBe(true);
          expect(e.midi).toBeGreaterThanOrEqual(24);
          expect(e.midi).toBeLessThanOrEqual(108);
          expect(e.dur).toBeGreaterThan(0);
          expect(e.vel).toBeGreaterThan(0);
          expect(e.vel).toBeLessThanOrEqual(1.5);
          expect(e.step).toBeGreaterThanOrEqual(-1);
          expect(e.step).toBeLessThan(16);
        }
      }
    });
  }

  it('tempos fit the brief (title ~110, match upbeat, final faster, results calm)', () => {
    expect(Math.abs(SONGS.title.bpm - 110)).toBeLessThanOrEqual(6);
    expect(SONGS.match.bpm).toBeGreaterThanOrEqual(116);
    expect(SONGS.final.bpm).toBeGreaterThan(SONGS.match.bpm);
    expect(SONGS.results.bpm).toBeLessThan(SONGS.title.bpm);
    expect(SONGS.match.dynamic).toBe(true);
  });
});

describe('sequencer math', () => {
  it('swing keeps beat boundaries and delays off-beats', () => {
    for (const unit of [8, 16] as const) {
      expect(swingStep(0, 0.3, unit)).toBe(0);
      expect(swingStep(4, 0.3, unit)).toBeCloseTo(4);
      expect(swingStep(16, 0.3, unit)).toBeCloseTo(16);
      let prev = -1;
      for (let s = 0; s < 16; s += 0.25) {
        const w = swingStep(s, 0.3, unit);
        expect(w).toBeGreaterThan(prev);
        prev = w;
      }
    }
    expect(swingStep(2, 1 / 3, 8)).toBeCloseTo(8 / 3);
    expect(swingStep(6, 0, 8)).toBe(6);
  });

  it('intensity adds layers in order: drums, lead, extra', () => {
    const at = (x: number) => layerLevels(x);
    expect(at(0)).toEqual({ base: 1, drums: 0, lead: 0, extra: 0 });
    expect(at(1)).toEqual({ base: 1, drums: 1, lead: 1, extra: 1 });
    expect(at(0.3).drums).toBeCloseTo(1);
    expect(at(0.3).lead).toBe(0);
    expect(at(0.5).lead).toBeCloseTo(1);
    expect(at(0.5).extra).toBe(0);
    for (let x = 0; x <= 1; x += 0.05) {
      const l = at(x);
      expect(l.drums).toBeGreaterThanOrEqual(l.lead);
      expect(l.lead).toBeGreaterThanOrEqual(l.extra);
    }
  });
});
