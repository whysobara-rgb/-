/**
 * Continuous sounds whose character follows an intensity 0..1 every frame:
 *
 *   drag       a heavy toy hauled over paving: soft rounded "dugu-dugu" bumps over a warm thrum;
 *              intensity = drag speed (bump rate, warmth, level), pitch = size
 *   bankRumble a whole building heaving along: rumble, sub, slow soft thunks and a gentle
 *              musical groan; intensity = bank speed
 *   strain     the uproot build-up while pulling an anchored target; intensity = unanchor progress
 *              (pitch = size: small safe high, bank low). Creak and groan rise in pitch and grit,
 *              taut roots start to quiver and snap past 40 %, the ground shakes past 80 %
 *              (the stages of src/render/uproot.ts)
 *   sirenLoop  police wailing in the distance during "30초 뒤 출발!"; intensity = urgency
 *   policeSiren a police car's cute two-tone "삐뽀" (red / blue strobe rhythm); intensity = level,
 *              pitch = doppler bend while it drives in
 *   alarmBell  an uprooted bank's old-fashioned clapper bell; intensity = level (the director
 *              settles it after the first seconds and ducks it with distance)
 *
 * A LoopVoice owns long-running looped sources; the engine creates one per (id, key) on demand,
 * feeds it intensity changes and destroys it after it has been silent for a while.
 */
import { alarmBellBuffer, crackleBuffer, creakBuffer, groanBuffer, heaveBuffer, noiseBuffer, rollBuffer, scrapeBuffer, type NoiseColor } from './dsp';
import type { LoopId } from './ids';

export interface LoopVoice {
  readonly id: LoopId;
  /** Output (pre-spatial) node. */
  readonly output: GainNode;
  /** Smoothly move towards the sound for this intensity (0 = silent). */
  set(intensity: number, t: number): void;
  /**
   * Pitch multiplier (1 = natural): the strain's size, the police siren's doppler bend, the
   * bell's tuning. Loops without a pitch character ignore it.
   */
  setPitch(pitch: number, t: number): void;
  /** Stop every source at time t (after fading). */
  stop(t: number): void;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};

/** WaveShaper curve sampling fn over [-1, 1] (odd length, so input 0 maps to fn(0) exactly). */
function shaperCurve(fn: (x: number) => number, n = 1025): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let k = 0; k < n; k++) c[k] = fn((k / (n - 1)) * 2 - 1);
  return c;
}

/** Bar grid of the music playing when a loop starts: time (s) of bar 0 and bar length (s). */
export interface BarGrid {
  origin: number;
  bar: number;
}

/** Siren wail range: A4 -> A5 (the A is a chord tone or a 9th over every 'final' chord). */
export const SIREN_LOW_HZ = 440;
export const SIREN_HIGH_HZ = 880;
/** Tempo the siren phrases at when no music is playing (the 'final' track's). */
const SIREN_FALLBACK_BPM = 148;
/** Bars per siren phrase: one wail over the first two bars, then two bars of room for the music. */
export const SIREN_PHRASE_BARS = 4;

/**
 * When the siren's first wail starts: the next phrase boundary (every SIREN_PHRASE_BARS bars from
 * the track's bar 0), so the wails always land on the same bars of the music. Without music the
 * phrase starts right away at the fallback tempo.
 */
export function sirenPhraseStart(grid: BarGrid | null | undefined, t: number): { start: number; bar: number } {
  const earliest = t + 0.05;
  if (!grid || !Number.isFinite(grid.origin) || !(grid.bar > 0.5 && grid.bar < 8)) {
    return { start: earliest, bar: 240 / SIREN_FALLBACK_BPM };
  }
  const phrase = SIREN_PHRASE_BARS * grid.bar;
  const n = Math.max(0, Math.ceil((earliest - grid.origin) / phrase - 1e-9));
  return { start: grid.origin + n * phrase, bar: grid.bar };
}

/**
 * Siren wail level at a given urgency (linear, before LOOP_GAIN). Measured against the 'final'
 * track at default volumes: the wails sit ~9 dB under the music at the start of the countdown and
 * ~4 dB under it at the end, so they build tension without masking the melody.
 */
export const sirenLevel = (i: number): number => 0.03 + 0.09 * i;
/** Level of the in-between wails (0 = silent gaps) at a given urgency: only in the last seconds. */
export const sirenGapFill = (i: number): number => 0.5 * smoothstep(0.8, 1, i);

/** Relative loudness of each loop at intensity 1 (loudness-matched offline). */
export const LOOP_GAIN: Readonly<Record<LoopId, number>> = {
  drag: 0.6,
  bankRumble: 0.52,
  strain: 0.55,
  sirenLoop: 0.5,
  policeSiren: 0.5,
  alarmBell: 0.5,
};

/** Drag level smoothing (s): a gentle start, a slower let-go (no sputter at the speed gate). */
export const DRAG_ATTACK_TAU = 0.07;
export const DRAG_RELEASE_TAU = 0.14;

/**
 * The drag voice's settings at intensity i (speed) and pitch p (size, 1 = large safe-ish):
 * bump-texture rate (= bump rate and pitch), bump and thrum levels (both 0 at i = 0, no floor),
 * the thrum's resonant lowpass and the final lowpass, which stays under ~2.2 kHz.
 *
 * Size moves the bumps' pitch and rate only by sqrt(p) (a small safe ~3 semitones over a gold
 * safe) and the speed range is narrow, so even a slow gold safe's "tok" stays near 300 Hz, where
 * small laptop speakers still play it; weight comes from a heavier, deeper thrum and a darker
 * final lowpass instead.
 */
export function dragParams(i: number, p = 1): { rate: number; bumps: number; thrum: number; thrumHz: number; toneHz: number } {
  const sp = Math.sqrt(p);
  const heavy = Math.min(1.25, 1 / p);
  return {
    rate: (0.82 + 0.4 * i) * sp,
    bumps: i > 0 ? 0.42 * Math.pow(i, 0.75) : 0,
    thrum: i > 0 ? 0.3 * heavy * Math.pow(i, 0.85) : 0,
    thrumHz: (190 + 130 * i) * sp,
    toneHz: (1500 + 600 * i) * Math.sqrt(sp),
  };
}

/** The bank rumble's settings at intensity i (bank speed). */
export function bankParams(i: number): { rumble: number; rumbleHz: number; sub: number; rate: number; heave: number; heaveHz: number; groan: number } {
  return {
    rumble: 0.28 * Math.pow(i, 0.85),
    rumbleHz: 110 + 170 * i,
    sub: 0.2 * i,
    rate: 0.9 + 0.3 * i,
    // A slow bank's thunks are softer than a fast one's (they would stick out of the quiet body).
    heave: i > 0 ? 0.56 * Math.pow(i, 1.35) : 0,
    heaveHz: 480 + 420 * i,
    // The groan plays at rate 1 (in key at every speed); only its level follows the speed.
    groan: i > 0 ? 0.4 * Math.pow(i, 0.9) : 0,
  };
}

/** Police two-tone: high D6 / low A5 (chord tones of the songs' D minor tonic), "삐-뽀". */
export const POLICE_SIREN_HI_HZ = 1174.66;
export const POLICE_SIREN_LO_HZ = 880;
/** Hi-lo cycles per second: the light bar's red / blue strobe rate (src/render/models/police.ts). */
export const POLICE_SIREN_RATE = 2.2;
/** Police siren level (linear, before LOOP_GAIN) at a given intensity. */
export const policeSirenLevel = (i: number): number => 0.3 * Math.pow(i, 1.3);
/** Alarm bell level (linear, before LOOP_GAIN) at a given intensity. */
export const alarmBellLevel = (i: number): number => 0.55 * Math.pow(i, 1.4);

/**
 * Control waveforms of the police siren, one period each: the frequency contour (Hz offsets from
 * the mean: high tone then low tone, each with a quick upward scoop) and the amplitude contour
 * (a short dip at every tone change, the "pi-po" articulation). Built as PeriodicWaves so the
 * pattern runs sample-accurately on the audio clock (Lanczos-smoothed, no Gibbs ringing).
 */
function sirenContours(): { freq: Float32Array; amp: Float32Array; meanFreq: number; meanAmp: number } {
  const N = 2048;
  const P = 1 / POLICE_SIREN_RATE;
  const freq = new Float32Array(N);
  const amp = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const ph = n / N;
    const hi = ph < 0.5;
    const tau = (hi ? ph : ph - 0.5) * P;
    const base = hi ? POLICE_SIREN_HI_HZ : POLICE_SIREN_LO_HZ;
    // Scoop: starts 70 cents flat and snaps up within ~20 ms (a bouncy toy attack).
    freq[n] = base * Math.pow(2, (-70 * Math.exp(-tau / 0.018)) / 1200);
    // Dip around each tone change (+-14 ms raised cosine to 0.4).
    const d = Math.min(Math.abs(ph - 0.5), ph, 1 - ph) * P;
    amp[n] = d < 0.014 ? 1 - 0.6 * 0.5 * (1 + Math.cos((Math.PI * d) / 0.014)) : 1;
  }
  const mean = (x: Float32Array): number => x.reduce((a, b) => a + b, 0) / x.length;
  return { freq, amp, meanFreq: mean(freq), meanAmp: mean(amp) };
}

const waveCache = new WeakMap<BaseAudioContext, { freq: PeriodicWave; amp: PeriodicWave; meanFreq: number; meanAmp: number }>();

/** PeriodicWave whose output is exactly `x - mean(x)` over one period (H harmonics). */
function periodicFrom(ctx: BaseAudioContext, x: Float32Array, H = 160): PeriodicWave {
  const N = x.length;
  const real = new Float32Array(H + 1);
  const imag = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const a = (2 * Math.PI * k * n) / N;
      re += x[n] * Math.cos(a);
      im += x[n] * Math.sin(a);
    }
    // Lanczos sigma factor tames the overshoot at the tone steps.
    const z = (Math.PI * k) / (H + 1);
    const sigma = Math.sin(z) / z;
    real[k] = ((2 * re) / N) * sigma;
    imag[k] = ((2 * im) / N) * sigma;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

function sirenWaves(ctx: BaseAudioContext): { freq: PeriodicWave; amp: PeriodicWave; meanFreq: number; meanAmp: number } {
  let w = waveCache.get(ctx);
  if (!w) {
    const c = sirenContours();
    w = { freq: periodicFrom(ctx, c.freq), amp: periodicFrom(ctx, c.amp), meanFreq: c.meanFreq, meanAmp: c.meanAmp };
    waveCache.set(ctx, w);
  }
  return w;
}

/**
 * The synthesized material the loops (and many one-shots) build lazily on first use, as separate
 * steps: noise colors, the scrape / creak / root-crackle textures, the police siren's wave tables
 * and the alarm bell (the heaviest, ~25 ms). The engine runs one step per idle slot after unlock,
 * so the first police car or bank alarm (which lands right on the bank-uproot slam) never stalls a
 * frame building them. Every step is cached per context: running it again is free.
 */
export function prewarmSteps(ctx: BaseAudioContext): (() => void)[] {
  const colors: NoiseColor[] = ['white', 'pink', 'brown'];
  return [
    ...colors.map((c) => (): void => void noiseBuffer(ctx, c)),
    (): void => void scrapeBuffer(ctx),
    (): void => void rollBuffer(ctx),
    (): void => void heaveBuffer(ctx),
    (): void => void groanBuffer(ctx),
    (): void => void creakBuffer(ctx),
    (): void => void crackleBuffer(ctx),
    (): void => void sirenWaves(ctx),
    (): void => void alarmBellBuffer(ctx),
  ];
}

/** tanh saturation curve with makeup so a driven signal keeps roughly the same peak. */
function gritCurve(): Float32Array<ArrayBuffer> {
  return shaperCurve((x) => Math.tanh(2.5 * x) / Math.tanh(2.5));
}

interface Graph {
  ctx: BaseAudioContext;
  out: GainNode;
  sources: AudioScheduledSourceNode[];
}

function loopSource(g: Graph, buffer: AudioBuffer, t: number, rnd: () => number): AudioBufferSourceNode {
  const s = g.ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.start(t, rnd() * buffer.duration * 0.9);
  g.sources.push(s);
  return s;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gainNode(ctx: BaseAudioContext, v = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function chain(...nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

const to = (p: AudioParam, v: number, t: number, tau: number): void => {
  p.setTargetAtTime(v, t, tau);
};

function noiseLoop(g: Graph, color: NoiseColor, t: number, rnd: () => number): AudioBufferSourceNode {
  return loopSource(g, noiseBuffer(g.ctx, color), t, rnd);
}

/**
 * Build a loop voice starting at time t. `grid` is the bar grid of the music playing now; loops
 * with a musical rhythm (the siren) lock their phrasing to it.
 */
export function createLoop(ctx: BaseAudioContext, id: LoopId, t: number, rnd: () => number, grid?: BarGrid | null): LoopVoice {
  const g: Graph = { ctx, out: gainNode(ctx, LOOP_GAIN[id]), sources: [] };
  let set: (i: number, t: number) => void;
  let setPitch: (p: number, t: number) => void = () => undefined;

  switch (id) {
    case 'drag': {
      // A heavy toy hauled over paving: rounded wooden "dugu-dugu" bumps whose rate follows the
      // speed (./dsp.ts rollBuffer) over a warm resonant thrum, all under a 12 dB/oct lowpass that
      // only opens a little with speed. Nothing hisses; `pitch` is the object's size (small safe
      // lighter and quicker, gold safe deeper).
      let pitch = 1;
      let last = 0;
      const roll = loopSource(g, rollBuffer(ctx), t, rnd);
      const rollLvl = gainNode(ctx);
      const body = noiseLoop(g, 'brown', t, rnd);
      const thrum = filter(ctx, 'lowpass', 220, 1.5);
      const bodyLvl = gainNode(ctx);
      const tone = filter(ctx, 'lowpass', 1200, 0.5);
      chain(roll, rollLvl, tone);
      chain(body, thrum, bodyLvl, tone);
      tone.connect(g.out);
      const apply = (i: number, at: number, tau: number): void => {
        const d = dragParams(i, pitch);
        to(roll.playbackRate, d.rate, at, tau);
        to(rollLvl.gain, d.bumps, at, tau);
        to(thrum.frequency, d.thrumHz, at, tau);
        to(bodyLvl.gain, d.thrum, at, tau);
        to(tone.frequency, d.toneHz, at, tau);
      };
      set = (i, at) => {
        // Gentle on, slower off: stop-and-go and hovering at the director's speed gate breathe
        // instead of sputtering.
        const tau = i >= last ? DRAG_ATTACK_TAU : DRAG_RELEASE_TAU;
        last = i;
        apply(i, at, tau);
      };
      setPitch = (p, at) => {
        pitch = p;
        apply(last, at, 0.1);
      };
      break;
    }
    case 'bankRumble': {
      // A whole building heaving along: a warm resonant rumble, the foundation's sub, slow soft
      // "thunk... thunk"s (./dsp.ts heaveBuffer, rate follows speed) and now and then a gentle
      // musical groan (./dsp.ts groanBuffer, fixed rate so it stays on the songs' chord tones).
      let last = 0;
      const rumble = noiseLoop(g, 'brown', t, rnd);
      const lp = filter(ctx, 'lowpass', 120, 1.3);
      const rumbleLvl = gainNode(ctx);
      chain(rumble, lp, rumbleLvl, g.out);
      // Sub tone with a slow wobble (the foundation dragging).
      const subOsc = ctx.createOscillator();
      subOsc.frequency.value = 41;
      const wob = ctx.createOscillator();
      wob.frequency.value = 0.37;
      const wobDepth = gainNode(ctx, 3);
      chain(wob, wobDepth);
      wobDepth.connect(subOsc.frequency);
      const subLvl = gainNode(ctx);
      chain(subOsc, subLvl, g.out);
      subOsc.start(t);
      wob.start(t);
      g.sources.push(subOsc, wob);
      // The heave: what carries the movement on laptop speakers.
      const heave = loopSource(g, heaveBuffer(ctx), t, rnd);
      const heaveLp = filter(ctx, 'lowpass', 700, 0.5);
      const heaveLvl = gainNode(ctx);
      chain(heave, heaveLp, heaveLvl, g.out);
      const groan = loopSource(g, groanBuffer(ctx), t, rnd);
      const groanLvl = gainNode(ctx);
      chain(groan, groanLvl, g.out);
      set = (i, at) => {
        const tau = i >= last ? 0.15 : 0.25;
        last = i;
        const b = bankParams(i);
        to(lp.frequency, b.rumbleHz, at, tau);
        to(rumbleLvl.gain, b.rumble, at, tau);
        to(subLvl.gain, b.sub, at, tau);
        to(heave.playbackRate, b.rate, at, tau);
        to(heaveLp.frequency, b.heaveHz, at, tau);
        to(heaveLvl.gain, b.heave, at, tau);
        to(groanLvl.gain, b.groan, at, tau);
      };
      break;
    }
    case 'strain': {
      // The uproot build-up (src/render/uproot.ts): 0-40 % creak + groan, 40-80 % the roots
      // stretch (a quivering taut whine, first fibre snaps), 80-100 % violent shake (dense snaps,
      // a trembling low rumble). Pitch and grit rise with progress; `pitch` is the object's size.
      let pitch = 1;
      let last = 0;
      const creak = loopSource(g, creakBuffer(ctx), t, rnd);
      const bp = filter(ctx, 'bandpass', 600, 1.6);
      const lvl = gainNode(ctx);
      chain(creak, bp, lvl, g.out);
      // Groan: a saw driven into a tanh shaper harder and harder (grit) through a lowpass.
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = 64;
      const drive = gainNode(ctx, 1);
      const grit = ctx.createWaveShaper();
      grit.curve = gritCurve();
      const lp = filter(ctx, 'lowpass', 420, 2);
      const sawLvl = gainNode(ctx);
      chain(saw, drive, grit, lp, sawLvl, g.out);
      // Taut roots: a thin whine whose quiver gets faster and wider.
      const whine = ctx.createOscillator();
      whine.type = 'triangle';
      whine.frequency.value = 200;
      const quiver = ctx.createOscillator();
      quiver.frequency.value = 7;
      const quiverDepth = gainNode(ctx, 0);
      chain(quiver, quiverDepth);
      quiverDepth.connect(whine.detune);
      const whineBp = filter(ctx, 'bandpass', 400, 2.5);
      const whineLvl = gainNode(ctx);
      chain(whine, whineBp, whineLvl, g.out);
      // Fibres snapping.
      const snaps = loopSource(g, crackleBuffer(ctx), t, rnd);
      const snapBp = filter(ctx, 'bandpass', 1900, 0.7);
      const snapLvl = gainNode(ctx);
      chain(snaps, snapBp, snapLvl, g.out);
      // Ground shaking: low rumble with a fast tremolo.
      const rumble = noiseLoop(g, 'brown', t, rnd);
      const rumbleLp = filter(ctx, 'lowpass', 150, 0.8);
      const trem = gainNode(ctx, 0.6);
      const tremOsc = ctx.createOscillator();
      tremOsc.type = 'triangle';
      tremOsc.frequency.value = 11;
      const tremDepth = gainNode(ctx, 0.4);
      chain(tremOsc, tremDepth);
      tremDepth.connect(trem.gain);
      const rumbleLvl = gainNode(ctx);
      chain(rumble, rumbleLp, trem, rumbleLvl, g.out);
      for (const o of [saw, whine, quiver, tremOsc]) {
        o.start(t);
        g.sources.push(o);
      }
      const apply = (i: number, at: number): void => {
        const tau = 0.1;
        const on = i > 0.001;
        const p = pitch;
        const stretch = smoothstep(0.45, 1, i);
        const shake = smoothstep(0.8, 0.98, i);
        to(creak.playbackRate, (0.5 + 1.35 * i) * p, at, tau);
        to(bp.frequency, (520 + 1250 * i) * p, at, tau);
        to(lvl.gain, on ? 0.42 + 0.33 * i : 0, at, tau);
        to(saw.frequency, (56 + 50 * Math.pow(i, 1.3)) * p, at, tau);
        to(drive.gain, 0.6 + 5 * i * i, at, tau);
        to(lp.frequency, (300 + 900 * i) * Math.sqrt(p), at, tau);
        to(sawLvl.gain, on ? 0.03 + 0.04 * i : 0, at, tau);
        to(whine.frequency, (190 + 300 * stretch) * p, at, tau);
        to(whineBp.frequency, (380 + 600 * stretch) * p, at, tau);
        to(quiver.frequency, 6 + 9 * i, at, tau);
        to(quiverDepth.gain, 6 + 45 * stretch, at, tau);
        to(whineLvl.gain, on ? 0.07 * stretch : 0, at, tau);
        to(snaps.playbackRate, (0.6 + 1.0 * i) * Math.sqrt(p), at, tau);
        to(snapBp.frequency, 1900 * p, at, tau);
        to(snapLvl.gain, on ? 0.75 * smoothstep(0.4, 0.95, i) : 0, at, tau);
        to(rumbleLp.frequency, 150 * Math.sqrt(p), at, tau);
        to(tremOsc.frequency, 9 + 4 * shake, at, tau);
        to(rumbleLvl.gain, on ? 0.9 * shake * (1.4 - 0.4 * p) : 0, at, tau);
      };
      set = (i, at) => {
        last = i;
        apply(i, at);
      };
      setPitch = (p, at) => {
        pitch = p;
        apply(last, at);
      };
      break;
    }
    case 'sirenLoop': {
      // Police wailing in the distance, not a wall of sound. One rising-and-falling wail per
      // 4-bar phrase, locked to the music's bar grid: two bars of wail, two bars of room for the
      // 'final' melody. A single slow sine drives both pitch and level through wave shapers, so
      // the phrasing runs sample-accurately on the audio clock with no per-frame scheduling.
      // Urgency brings it nearer (louder, brighter); in the last seconds a softer second wail
      // fills the gaps.
      const { start, bar } = sirenPhraseStart(grid, t);
      const phase = ctx.createOscillator();
      phase.frequency.value = 1 / (SIREN_PHRASE_BARS * bar);
      // Gate: open while the phase sine is clearly positive (the first two bars of the phrase).
      // curve(0) = 0, so nothing sounds before the phase oscillator starts.
      const gate = ctx.createWaveShaper();
      gate.curve = shaperCurve((x) => smoothstep(0, 0.55, x));
      // Pitch: |sin| rises over one bar and falls over the next (low A -> high A -> low A).
      const sweep = ctx.createWaveShaper();
      sweep.curve = shaperCurve((x) => Math.abs(x));
      const span = gainNode(ctx, SIREN_HIGH_HZ - SIREN_LOW_HZ);
      chain(phase, sweep, span);
      chain(phase, gate);
      const vib = ctx.createOscillator();
      vib.frequency.value = 6.5;
      const vibDepth = gainNode(ctx, 9);
      chain(vib, vibDepth);
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.value = SIREN_LOW_HZ;
      const sq = ctx.createOscillator();
      sq.type = 'square';
      sq.frequency.value = SIREN_LOW_HZ;
      for (const o of [tri, sq]) {
        span.connect(o.frequency);
        vibDepth.connect(o.frequency);
      }
      const sqLp = filter(ctx, 'lowpass', 1500, 0.7);
      const sqLvl = gainNode(ctx, 0.2);
      chain(sq, sqLp, sqLvl);
      const mix = gainNode(ctx, 1);
      tri.connect(mix);
      sqLvl.connect(mix);
      const tone = filter(ctx, 'lowpass', 1200, 0.6);
      // amp = fill + (1 - fill) * gate: fill is the level of the in-between wails.
      const amp = gainNode(ctx, 0);
      const gateDepth = gainNode(ctx, 1);
      chain(gate, gateDepth);
      gateDepth.connect(amp.gain);
      const lvl = gainNode(ctx);
      chain(mix, tone, amp, lvl, g.out);
      for (const o of [vib, tri, sq]) {
        o.start(t);
        g.sources.push(o);
      }
      phase.start(start);
      g.sources.push(phase);
      set = (i, at) => {
        const tau = 0.4;
        to(lvl.gain, i > 0 ? sirenLevel(i) : 0, at, tau);
        to(tone.frequency, 1000 + 1500 * i, at, tau);
        // Gap fill only once the phrase has begun (before that the oscillators sit at the low A).
        const fill = sirenGapFill(i);
        const ft = Math.max(at, start);
        to(amp.gain, fill, ft, tau);
        to(gateDepth.gain, 1 - fill, ft, tau);
      };
      break;
    }
    case 'policeSiren': {
      // A toy police car "삐뽀삐뽀": high / low tone in the light bar's red / blue rhythm, a
      // bouncy scoop into each tone and a tiny gap between them. One PeriodicWave oscillator
      // drives the pitch, another the articulation; doppler bends the carriers' detune.
      const w = sirenWaves(ctx);
      const contour = ctx.createOscillator();
      contour.setPeriodicWave(w.freq);
      contour.frequency.value = POLICE_SIREN_RATE;
      const articulation = ctx.createOscillator();
      articulation.setPeriodicWave(w.amp);
      articulation.frequency.value = POLICE_SIREN_RATE;
      const sq = ctx.createOscillator();
      sq.type = 'square';
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      const shine = ctx.createOscillator();
      const vib = ctx.createOscillator();
      vib.frequency.value = 8.5;
      const vibDepth = gainNode(ctx, 9);
      chain(vib, vibDepth);
      for (const o of [sq, tri]) {
        o.frequency.value = w.meanFreq;
        contour.connect(o.frequency);
        vibDepth.connect(o.detune);
      }
      // The sparkle partial follows at double the contour.
      const twice = gainNode(ctx, 2);
      contour.connect(twice);
      shine.frequency.value = w.meanFreq * 2;
      twice.connect(shine.frequency);
      vibDepth.connect(shine.detune);
      const sqLp = filter(ctx, 'lowpass', 2600, 1.4);
      const sqLvl = gainNode(ctx, 0.22);
      chain(sq, sqLp, sqLvl);
      const triLvl = gainNode(ctx, 0.8);
      tri.connect(triLvl);
      const shineLvl = gainNode(ctx, 0.07);
      shine.connect(shineLvl);
      const artic = gainNode(ctx, w.meanAmp);
      articulation.connect(artic.gain);
      for (const n of [sqLvl, triLvl, shineLvl]) n.connect(artic);
      const tone = filter(ctx, 'lowpass', 4000, 0.6);
      const lvl = gainNode(ctx);
      chain(artic, tone, lvl, g.out);
      // Every police car starts at the top of the high tone: the two oscillators stay locked.
      for (const o of [contour, articulation, sq, tri, shine, vib]) {
        o.start(t);
        g.sources.push(o);
      }
      set = (i, at) => {
        const tau = 0.12;
        to(lvl.gain, policeSirenLevel(i), at, tau);
        to(tone.frequency, 1800 + 5200 * i, at, tau);
      };
      setPitch = (p, at) => {
        const cents = 1200 * Math.log2(Math.max(0.5, Math.min(2, p)));
        for (const o of [sq, tri, shine]) to(o.detune, cents, at, 0.06);
      };
      break;
    }
    case 'alarmBell': {
      // Old-fashioned clapper bell, one seamless pre-rendered ring (./dsp.ts alarmBellBuffer).
      // Lower intensity = further away / settled: quieter and duller.
      const ring = loopSource(g, alarmBellBuffer(ctx), t, rnd);
      const hp = filter(ctx, 'highpass', 260, 0.7);
      const tone = filter(ctx, 'lowpass', 6000, 0.6);
      const lvl = gainNode(ctx);
      chain(ring, hp, tone, lvl, g.out);
      set = (i, at) => {
        const tau = 0.15;
        to(lvl.gain, alarmBellLevel(i), at, tau);
        to(tone.frequency, 1600 + 7000 * i, at, tau);
      };
      setPitch = (p, at) => to(ring.playbackRate, Math.max(0.5, Math.min(2, p)), at, 0.1);
      break;
    }
  }

  return {
    id,
    output: g.out,
    set: (i, at) => set(Math.max(0, Math.min(1, i)), at),
    setPitch: (p, at) => setPitch(Number.isFinite(p) && p > 0 ? p : 1, at),
    stop(at: number): void {
      for (const s of g.sources) {
        try {
          s.stop(at);
        } catch {
          /* already stopped */
        }
      }
    },
  };
}
