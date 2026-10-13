/**
 * Synthesized instruments for the music sequencer and the musical sound effects (jingles,
 * chimes, fanfares). Every instrument is a pure function scheduling a handful of nodes:
 *
 *   (target, at, midi, dur, vel, pan?) => end offset in seconds (relative to target.t)
 *
 * Levels are normalized so that vel = 1 peaks around 0.3-0.45 linear per note before bus gains.
 * Timbres aim for a toy-box feel: wooden mallets, plucked strings, soft brass, round leads.
 */
import { ahr, fm, noise, partials, perc, tone, type Target } from './dsp';
import { midiToHz } from './theory';

export type NoteFn = (v: Target, at: number, midi: number, dur: number, vel: number, pan?: number) => number;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------------------------------------
// Pitched
// ---------------------------------------------------------------------------------------------

/** Wooden bar: fundamental + the characteristic ~4x overtone + a mallet tick. */
export const marimba: NoteFn = (v, at, midi, _dur, vel, pan) => {
  const f = midiToHz(midi);
  const decay = clamp(0.95 - (midi - 48) * 0.02, 0.2, 0.95);
  let end = tone(v, { freq: f, amp: perc(0.002, 0.42 * vel, decay), at, pan });
  if (f * 3.93 < 16000) end = Math.max(end, tone(v, { freq: f * 3.93, amp: perc(0.001, 0.11 * vel, decay * 0.16), at, pan }));
  noise(v, {
    color: 'white',
    filters: [{ type: 'bandpass', freq: Math.min(9000, f * 2.2), q: 2 }],
    amp: perc(0.0008, 0.06 * vel, 0.012),
    at,
    pan,
  });
  return end;
};

/** Soft vibraphone: sustained bar with a slow tremolo-like beating between two partials. */
export const vibes: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const amp = [
    [0, 0],
    [0.004, 0.2 * vel],
    [Math.max(0.05, dur), 0.12 * vel],
    [Math.max(0.05, dur) + 0.7, 0],
  ] as const;
  // Two slightly detuned fundamentals beat at ~5 Hz: a cheap, smooth tremolo.
  const e1 = tone(v, { freq: f, amp, at, pan });
  tone(v, { freq: f * 1.0025 + 2.5, amp: perc(0.004, 0.09 * vel, Math.max(0.3, dur + 0.4)), at, pan });
  if (f * 4 < 15000) tone(v, { freq: f * 4, amp: perc(0.002, 0.035 * vel, 0.12), at, pan });
  return e1;
};

/** Glockenspiel / toy bell: inharmonic bar partials. */
export const glock: NoteFn = (v, at, midi, _dur, vel, pan) => {
  const f = midiToHz(midi);
  return partials(
    v,
    f,
    [
      [1, 0.3, 1.1],
      [2.76, 0.1, 0.35],
      [5.4, 0.045, 0.14],
      [8.93, 0.02, 0.07],
    ],
    { at, pan, gain: vel },
  );
};

/** Pizzicato upright bass: soft triangle pluck with a brief bright onset. */
export const pizz: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const decay = clamp(dur * 1.4, 0.18, 0.55);
  tone(v, { type: 'triangle', freq: [[0, f * 1.012], [0.03, f]], amp: perc(0.003, 0.45 * vel, decay), at, pan });
  tone(v, { freq: f * 2, amp: perc(0.002, 0.1 * vel, 0.08), at, pan });
  return tone(v, { freq: f, amp: perc(0.004, 0.32 * vel, decay * 1.3), at, pan });
};

/** Funky synth bass: saw through a plucky resonant lowpass + sine sub for weight. */
export const funkBass: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const hold = Math.max(0.03, dur * 0.85);
  tone(v, {
    type: 'sawtooth',
    freq: f,
    amp: ahr(0.004, 0.16 * vel, hold, 0.05, 0.7),
    filter: { type: 'lowpass', freq: [[0, 260], [0.006, 700 + 1300 * vel], [0.16, 340]], q: 4 },
    at,
    pan,
  });
  return tone(v, { freq: f, amp: ahr(0.004, 0.22 * vel, hold, 0.05, 0.85), at, pan });
};

/** Driving bass for the final countdown: square + sub, tighter envelope. */
export const synthBass: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const hold = Math.max(0.03, dur * 0.7);
  tone(v, {
    type: 'square',
    freq: f,
    amp: ahr(0.003, 0.14 * vel, hold, 0.04, 0.6),
    filter: { type: 'lowpass', freq: [[0, 1600], [0.08, 520]], q: 2 },
    at,
    pan,
  });
  return tone(v, { freq: f, amp: ahr(0.003, 0.36 * vel, hold, 0.04, 0.8), at, pan });
};

/** Clavinet-ish chord stab: short bright pulse. */
export const clav: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  return tone(v, {
    type: 'square',
    freq: f,
    amp: perc(0.002, 0.16 * vel, clamp(dur * 1.5, 0.15, 0.35)),
    filter: { type: 'lowpass', freq: [[0, 3800], [0.09, 1100]], q: 2.5 },
    at,
    pan,
  });
};

/** Soft drawbar organ pad (three sine drawbars). */
export const organ: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const env = ahr(0.04, 0.07 * vel, Math.max(0.05, dur - 0.04), 0.18, 0.9);
  tone(v, { freq: f * 2, amp: env, at, pan, detune: 3 });
  tone(v, { freq: f * 3, amp: ahr(0.04, 0.025 * vel, Math.max(0.05, dur - 0.04), 0.15, 0.9), at, pan });
  return tone(v, { freq: f, amp: env, at, pan });
};

/** Warm analog-style pad: two detuned saws, slow attack. */
export const pad: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const env = ahr(0.35, 0.05 * vel, Math.max(0.1, dur - 0.2), 0.8, 0.9);
  const filter = { type: 'lowpass' as const, freq: 1100, q: 0.5 };
  tone(v, { type: 'sawtooth', freq: f, detune: -8, amp: env, filter, at, pan });
  return tone(v, { type: 'sawtooth', freq: f, detune: 8, amp: env, filter, at, pan });
};

/** Cute whistle lead: sine with delayed vibrato and a breath of noise. */
export const whistle: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const hold = Math.max(0.04, dur - 0.03);
  noise(v, {
    color: 'white',
    filters: [{ type: 'bandpass', freq: Math.min(12000, f * 2), q: 8 }],
    amp: ahr(0.02, 0.05 * vel, hold, 0.05, 0.5),
    at,
    pan,
  });
  return tone(v, {
    freq: [[0, f * 0.99], [0.03, f]],
    amp: ahr(0.025, 0.24 * vel, hold, 0.07, 0.85),
    vib: { rate: 5.6, cents: [[0, 0], [0.14, 0], [0.4, 16]] },
    at,
    pan,
  });
};

/** Round square lead (match melody): filtered square + triangle body. */
export const lead: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const hold = Math.max(0.03, dur * 0.88);
  tone(v, {
    type: 'square',
    freq: f,
    amp: ahr(0.006, 0.075 * vel, hold, 0.06, 0.8),
    filter: { type: 'lowpass', freq: 2600, q: 0.7 },
    vib: { rate: 5.8, cents: [[0, 0], [0.18, 0], [0.4, 12]] },
    at,
    pan,
  });
  return tone(v, { type: 'triangle', freq: f, amp: ahr(0.006, 0.16 * vel, hold, 0.06, 0.8), at, pan });
};

/** Soft brass section: two detuned saws, filter swell, slight scoop into pitch. */
export const brass: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  const hold = Math.max(0.05, dur);
  const filter = { type: 'lowpass' as const, freq: [[0, 450], [0.05, 2200 + 1400 * vel], [0.3, 1500]] as const, q: 0.8 };
  const freq = [[0, f * 0.985], [0.045, f]] as const;
  const amp = ahr(0.025, 0.1 * vel, hold, 0.14, 0.85);
  tone(v, { type: 'sawtooth', freq, detune: -9, amp, filter, at, pan });
  return tone(v, { type: 'sawtooth', freq, detune: 9, amp, filter, at, pan });
};

/** Mellow clarinet-like reed (defeat jingle). */
export const clarinet: NoteFn = (v, at, midi, dur, vel, pan) => {
  const f = midiToHz(midi);
  return tone(v, {
    type: 'square',
    freq: f,
    amp: ahr(0.05, 0.13 * vel, Math.max(0.05, dur - 0.05), 0.18, 0.85),
    filter: { type: 'lowpass', freq: 1400, q: 0.5 },
    vib: { rate: 4.8, cents: [[0, 0], [0.25, 0], [0.6, 10]] },
    at,
    pan,
  });
};

/** FM electric piano / music box tine. */
export const tine: NoteFn = (v, at, midi, _dur, vel, pan) => {
  const f = midiToHz(midi);
  return fm(v, {
    freq: f,
    ratio: 2,
    index: [[0, 1.6], [0.3, 0.2]],
    amp: perc(0.002, 0.22 * vel, 0.9),
    at,
    pan,
  });
};

// ---------------------------------------------------------------------------------------------
// Percussion (midi argument ignored unless noted)
// ---------------------------------------------------------------------------------------------

export const kick: NoteFn = (v, at, _m, _d, vel, pan) => {
  noise(v, { color: 'white', filters: [{ type: 'highpass', freq: 2500 }], amp: perc(0.0005, 0.1 * vel, 0.008), at, pan });
  return tone(v, { freq: [[0, 150], [0.09, 52], [0.3, 44]], amp: perc(0.002, 0.75 * vel, 0.32), at, pan });
};

export const snare: NoteFn = (v, at, _m, _d, vel, pan) => {
  tone(v, { type: 'triangle', freq: [[0, 235], [0.05, 180]], amp: perc(0.001, 0.3 * vel, 0.12), at, pan });
  return noise(v, {
    color: 'white',
    filters: [{ type: 'highpass', freq: 900 }, { type: 'peaking', freq: 3500, q: 1, gain: 4 }],
    amp: perc(0.001, 0.4 * vel, 0.26),
    at,
    pan,
  });
};

export const brush: NoteFn = (v, at, _m, _d, vel, pan) =>
  noise(v, {
    color: 'white',
    filters: [{ type: 'bandpass', freq: 3800, q: 0.6 }],
    amp: [[0, 0], [0.015, 0.25 * vel], [0.25, 0]],
    at,
    pan,
  });

export const hat: NoteFn = (v, at, _m, _d, vel, pan) =>
  noise(v, { color: 'white', filters: [{ type: 'highpass', freq: 7200 }], amp: perc(0.0008, 0.22 * vel, 0.09), at, pan });

export const hatOpen: NoteFn = (v, at, _m, _d, vel, pan) =>
  noise(v, {
    color: 'white',
    filters: [{ type: 'highpass', freq: 6500 }, { type: 'peaking', freq: 10000, q: 1, gain: 3 }],
    amp: perc(0.001, 0.16 * vel, 0.45),
    at,
    pan,
  });

export const shaker: NoteFn = (v, at, _m, _d, vel, pan) =>
  noise(v, {
    color: 'white',
    filters: [{ type: 'bandpass', freq: 6200, q: 1.3 }],
    amp: [[0, 0], [0.015, 0.2 * vel], [0.12, 0]],
    at,
    pan,
  });

export const snap: NoteFn = (v, at, _m, _d, vel, pan) => {
  tone(v, { type: 'triangle', freq: 1750, amp: perc(0.0005, 0.07 * vel, 0.02), at, pan });
  return noise(v, {
    color: 'white',
    filters: [{ type: 'bandpass', freq: 2500, q: 3 }],
    amp: perc(0.0005, 0.5 * vel, 0.09),
    at,
    pan,
  });
};

export const clap: NoteFn = (v, at, _m, _d, vel, pan) => {
  const f = [{ type: 'bandpass' as const, freq: 1500, q: 1.4 }];
  for (const dt of [0, 0.009, 0.018]) noise(v, { color: 'white', filters: f, amp: perc(0.0005, 0.25 * vel, 0.012), at: at + dt, pan });
  return noise(v, { color: 'white', filters: f, amp: perc(0.001, 0.22 * vel, 0.12), at: at + 0.024, pan }) ;
};

/** Woodblock / clock tick. midi selects the pitch (e.g. 84 tick, 79 tock). */
export const block: NoteFn = (v, at, midi, _d, vel, pan) => {
  const f = midiToHz(midi);
  tone(v, { freq: f * 2.6, amp: perc(0.0005, 0.07 * vel, 0.02), at, pan });
  return tone(v, { type: 'triangle', freq: [[0, f * 1.04], [0.01, f]], amp: perc(0.0008, 0.3 * vel, 0.09), at, pan });
};

/** Tom: pitched drum (midi = pitch). */
export const tom: NoteFn = (v, at, midi, _d, vel, pan) => {
  const f = midiToHz(midi);
  return tone(v, { freq: [[0, f * 1.45], [0.07, f]], amp: perc(0.002, 0.5 * vel, 0.32), at, pan });
};

export const conga: NoteFn = (v, at, midi, _d, vel, pan) => {
  const f = midiToHz(midi);
  noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 1900, q: 1.2 }], amp: perc(0.0005, 0.07 * vel, 0.012), at, pan });
  return tone(v, { freq: [[0, f * 1.15], [0.03, f]], amp: perc(0.002, 0.34 * vel, 0.3), at, pan });
};

export const crash: NoteFn = (v, at, _m, _d, vel, pan) => {
  noise(v, { color: 'white', filters: [{ type: 'bandpass', freq: 8200, q: 0.8 }], amp: perc(0.002, 0.08 * vel, 1.0), at, pan });
  return noise(v, { color: 'white', filters: [{ type: 'highpass', freq: 4200 }], amp: perc(0.002, 0.15 * vel, 1.6), at, pan });
};

/** Timpani boom (midi = pitch). */
export const timpani: NoteFn = (v, at, midi, _d, vel, pan) => {
  const f = midiToHz(midi);
  noise(v, { color: 'brown', filters: [{ type: 'lowpass', freq: 320 }], amp: perc(0.002, 0.3 * vel, 0.18), at, pan });
  tone(v, { freq: f * 2.02, amp: perc(0.003, 0.12 * vel, 0.5), at, pan });
  return tone(v, { freq: [[0, f * 1.04], [0.12, f]], amp: perc(0.004, 0.55 * vel, 1.2), at, pan });
};

export const INSTRUMENTS = {
  marimba,
  vibes,
  glock,
  pizz,
  funkBass,
  synthBass,
  clav,
  organ,
  pad,
  whistle,
  lead,
  brass,
  clarinet,
  tine,
  kick,
  snare,
  brush,
  hat,
  hatOpen,
  shaker,
  snap,
  clap,
  block,
  tom,
  conga,
  crash,
  timpani,
} as const satisfies Record<string, NoteFn>;

export type InstId = keyof typeof INSTRUMENTS;
