/**
 * Result stingers (victory / defeat / draw). Short original phrases on the same instruments as
 * the score so they sit naturally before the results bed. Defeat is wistful and gentle, never
 * mocking (doc §13: 패배는 처벌 대신 짧은 반응).
 */
import type { Target } from './dsp';
import { block, brass, clarinet, crash, glock, hat, kick, marimba, organ, pizz, snare, vibes } from './instruments';
import { scaleNote } from './theory';

export type JingleId = 'victory' | 'defeat' | 'draw';

/** [8th index, semitones above the key tonic, length in 8ths, velocity] */
type Ev = readonly [number, number, number, number];

function seq(v: Target, unit: number, key: number, evs: readonly Ev[], fn: typeof marimba, velScale = 1): void {
  for (const [i, st, len, vel] of evs) fn(v, i * unit, key + st, len * unit, vel * velScale);
}

function chordAt(v: Target, unit: number, key: number, i: number, semis: readonly number[], len: number, fn: typeof organ, vel: number): void {
  for (const st of semis) fn(v, i * unit, key + st, len * unit, vel);
}

/** Schedules the jingle into v.out. `key` = tonic MIDI (F4 = 65). Returns duration (s). */
export function playJingle(v: Target, id: JingleId, key: number): number {
  switch (id) {
    case 'victory': {
      const u = 0.2; // 150 bpm eighths
      const mel: Ev[] = [
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
      ];
      seq(v, u, key, mel, marimba, 0.9);
      seq(v, u, key - 12, mel, brass, 0.55);
      chordAt(v, u, key, 0, [-8, -5, 0], 4, organ, 0.7);
      chordAt(v, u, key, 4, [-8, -5, 0], 4, organ, 0.7);
      chordAt(v, u, key, 8, [-7, -3, 0], 2, organ, 0.7);
      chordAt(v, u, key, 10, [-5, -1, 2], 2, organ, 0.7);
      chordAt(v, u, key, 12, [-12, -8, -5, 0], 7, brass, 0.6);
      const bass: Ev[] = [
        [0, -24, 2, 1],
        [2, -17, 2, 0.9],
        [4, -24, 2, 1],
        [6, -20, 2, 0.9],
        [8, -19, 2, 1],
        [10, -17, 2, 0.9],
        [12, -24, 6, 1],
      ];
      seq(v, u, key, bass, pizz);
      for (const i of [0, 4, 8, 12]) kick(v, i * u, 0, 0.2, 0.7);
      for (const i of [2, 6, 10, 10.5, 11, 11.5]) snare(v, i * u, 0, 0.1, i >= 10 ? 0.35 + (i - 10) * 0.15 : 0.45);
      for (let i = 0; i < 12; i++) hat(v, i * u, 0, 0.05, i % 2 ? 0.5 : 0.8);
      crash(v, 12 * u, 0, 1, 0.8);
      for (let i = 0; i < 8; i++) glock(v, 12 * u + i * 0.045, scaleNote(key, 8 + i), 0.1, 0.4, i / 4 - 1);
      return 12 * u + 1.7;
    }
    case 'defeat': {
      const u = 0.3; // 100 bpm eighths, unhurried
      const mel: Ev[] = [
        [0, 4, 1, 0.8],
        [1, 2, 1, 0.75],
        [2, 0, 1, 0.75],
        [3, -1, 2, 0.8],
        [5, -3, 5, 0.85],
      ];
      seq(v, u, key, mel, clarinet);
      // Gm(9) -> A7 -> Dm(add9), soft vibes.
      chordAt(v, u, key, 0, [-10, -7, -3, 4], 3, vibes, 0.45);
      chordAt(v, u, key, 3, [-8, -4, -1, 2], 2, vibes, 0.45);
      chordAt(v, u, key, 5, [-8, -3, 0, 11], 5, vibes, 0.4);
      const bass: Ev[] = [
        [0, -22, 3, 0.8],
        [3, -20, 2, 0.8],
        [5, -27, 5, 0.85],
      ];
      seq(v, u, key, bass, pizz);
      // A tiny hopeful "plip" so it ends with a shrug, not a punishment.
      marimba(v, 9.4 * u, key + 9 + 12, 0.1, 0.35);
      return 10 * u + 1.1;
    }
    case 'draw': {
      const u = 0.25; // 120 bpm eighths
      const mel: Ev[] = [
        [0, 4, 1, 0.8],
        [1, 7, 1, 0.8],
        [2, 9, 2, 0.85],
        [4, 9, 1, 0.8],
        [5, 7, 1, 0.8],
        [6, 14, 3, 0.9],
      ];
      seq(v, u, key, mel, marimba);
      chordAt(v, u, key, 0, [-8, -5, 2], 4, organ, 0.6);
      chordAt(v, u, key, 4, [-7, -3, 0], 2, organ, 0.6);
      // Csus4 left hanging: "we'll settle this next time".
      chordAt(v, u, key, 6, [-5, 0, 2], 4, organ, 0.6);
      const bass: Ev[] = [
        [0, -24, 2, 0.8],
        [4, -19, 2, 0.8],
        [6, -17, 4, 0.85],
      ];
      seq(v, u, key, bass, pizz);
      block(v, 9 * u, key + 19, 0.05, 0.6);
      block(v, 9.6 * u, key + 14, 0.05, 0.5);
      return 10 * u + 0.8;
    }
  }
}
