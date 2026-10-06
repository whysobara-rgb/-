/**
 * Low-level synthesis building blocks on top of the WebAudio graph.
 *
 * Everything takes a `Target` (context + destination node + start time + rng) so the same
 * recipes run in a realtime AudioContext and in an OfflineAudioContext (QA renders, tests).
 * Helpers create short-lived nodes with explicit start/stop times; nothing here keeps state
 * except the per-context buffer cache.
 */
import { makeRng, type Rng } from './rng';

/** Floor for exponential ramps (they cannot reach 0). -80 dB. */
export const EPS = 1e-4;

export interface Target {
  ctx: BaseAudioContext;
  /** Node every helper connects to unless `dest` is given. */
  out: AudioNode;
  /** Absolute context time of offset 0. */
  t: number;
  rnd: Rng;
}

/**
 * Envelope point: [offset seconds, value, curve?]. The first point is set instantly. Without an
 * explicit curve a segment between two positive values is exponential, a segment from 0 is
 * linear, and a segment that ends at exactly 0 decays exponentially to -80 dB then snaps to 0.
 */
export type EnvPt = readonly [number, number] | readonly [number, number, 'lin' | 'exp' | 'set'];
export type Env = readonly EnvPt[];

/** Apply an envelope to a param. Returns the absolute time of the last point. */
export function automate(param: AudioParam, t0: number, env: Env, scale = 1, maxValue = Infinity): number {
  let prev = 0;
  let prevT = t0;
  let end = t0;
  for (let i = 0; i < env.length; i++) {
    const pt = env[i];
    const t = Math.max(prevT, t0 + Math.max(0, pt[0]));
    const v = Math.min(maxValue, pt[1] * scale);
    const curve = pt.length > 2 ? pt[2] : undefined;
    if (i === 0 || curve === 'set') {
      param.setValueAtTime(v, t);
    } else if (curve === 'lin') {
      param.linearRampToValueAtTime(v, t);
    } else if (curve === 'exp' || (prev > 0 && v > 0)) {
      param.exponentialRampToValueAtTime(Math.max(EPS, v), t);
    } else if (prev > 0 && v === 0) {
      param.exponentialRampToValueAtTime(EPS, t);
      param.setValueAtTime(0, t);
    } else {
      param.linearRampToValueAtTime(v, t);
    }
    prev = v;
    prevT = t;
    end = t;
  }
  return end;
}

/** Set a param to a constant or an envelope. */
export function setParam(param: AudioParam, t0: number, x: number | Env, scale = 1, maxValue = Infinity): void {
  if (typeof x === 'number') param.setValueAtTime(Math.min(maxValue, x * scale), t0);
  else automate(param, t0, x, scale, maxValue);
}

/** Percussive envelope: linear attack to `peak`, exponential decay to silence. */
export const perc = (attack: number, peak: number, decay: number): Env => [
  [0, 0],
  [attack, peak],
  [attack + decay, 0],
];

/** Attack / hold / release envelope for sustained notes. */
export const ahr = (attack: number, peak: number, hold: number, release: number, sustainLevel = 1): Env => [
  [0, 0],
  [attack, peak],
  [attack + hold, peak * sustainLevel],
  [attack + hold + release, 0],
];

const nyquist = (ctx: BaseAudioContext): number => ctx.sampleRate / 2 - 100;

/** Connect `node` to the destination, optionally through a fixed stereo pan. */
export function route(ctx: BaseAudioContext, node: AudioNode, dest: AudioNode, pan?: number): void {
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    p.connect(dest);
  } else {
    node.connect(dest);
  }
}

export interface VibratoOpts {
  rate: number;
  /** Depth in cents (or an envelope of cents). */
  cents: number | Env;
  /** Rate envelope (Hz) instead of a constant. */
  rateEnv?: Env;
}

export interface ToneOpts {
  type?: Exclude<OscillatorType, 'custom'>;
  wave?: PeriodicWave;
  /** Hz, constant or envelope. */
  freq: number | Env;
  amp: Env;
  /** Start offset (s) relative to target.t. */
  at?: number;
  detune?: number;
  vib?: VibratoOpts;
  pan?: number;
  dest?: AudioNode;
  /** Optional filter between oscillator and amp. */
  filter?: FilterOpts;
}

/** One oscillator through an amplitude envelope. Returns end offset (s) relative to target.t. */
export function tone(v: Target, o: ToneOpts): number {
  const { ctx } = v;
  const t = v.t + (o.at ?? 0);
  const osc = ctx.createOscillator();
  if (o.wave) osc.setPeriodicWave(o.wave);
  else osc.type = o.type ?? 'sine';
  setParam(osc.frequency, t, o.freq, 1, nyquist(ctx));
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);
  const g = ctx.createGain();
  g.gain.value = 0;
  const end = automate(g.gain, t, o.amp);
  let head: AudioNode = osc;
  if (o.filter) {
    const f = makeFilter(ctx, t, o.filter);
    osc.connect(f);
    head = f;
  }
  head.connect(g);
  route(ctx, g, o.dest ?? v.out, o.pan);
  if (o.vib) addVibrato(ctx, osc.detune, t, end, o.vib);
  osc.start(t);
  osc.stop(end + 0.02);
  return end - v.t;
}

function addVibrato(ctx: BaseAudioContext, detune: AudioParam, t: number, end: number, vib: VibratoOpts): void {
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  if (vib.rateEnv) automate(lfo.frequency, t, vib.rateEnv);
  else lfo.frequency.setValueAtTime(vib.rate, t);
  const depth = ctx.createGain();
  depth.gain.value = 0;
  setParam(depth.gain, t, vib.cents);
  lfo.connect(depth);
  depth.connect(detune);
  lfo.start(t);
  lfo.stop(end + 0.02);
}

export interface FilterOpts {
  type: BiquadFilterType;
  freq: number | Env;
  q?: number | Env;
  gain?: number;
}

export function makeFilter(ctx: BaseAudioContext, t: number, f: FilterOpts): BiquadFilterNode {
  const n = ctx.createBiquadFilter();
  n.type = f.type;
  setParam(n.frequency, t, f.freq, 1, nyquist(ctx));
  if (f.q !== undefined) setParam(n.Q, t, f.q);
  if (f.gain !== undefined) n.gain.setValueAtTime(f.gain, t);
  return n;
}

export type NoiseColor = 'white' | 'pink' | 'brown';

export interface NoiseOpts {
  color?: NoiseColor;
  /** Custom looping buffer instead of a noise color. */
  buffer?: AudioBuffer;
  amp: Env;
  at?: number;
  filters?: readonly FilterOpts[];
  /** playbackRate, constant or envelope. */
  rate?: number | Env;
  pan?: number;
  dest?: AudioNode;
}

/** Filtered noise burst. Returns end offset (s). */
export function noise(v: Target, o: NoiseOpts): number {
  const { ctx } = v;
  const t = v.t + (o.at ?? 0);
  const src = ctx.createBufferSource();
  const buf = o.buffer ?? noiseBuffer(ctx, o.color ?? 'white');
  src.buffer = buf;
  src.loop = true;
  if (o.rate !== undefined) setParam(src.playbackRate, t, o.rate);
  let head: AudioNode = src;
  for (const f of o.filters ?? []) {
    const n = makeFilter(ctx, t, f);
    head.connect(n);
    head = n;
  }
  const g = ctx.createGain();
  g.gain.value = 0;
  const end = automate(g.gain, t, o.amp);
  head.connect(g);
  route(ctx, g, o.dest ?? v.out, o.pan);
  // Random read offset so repeated bursts never sound identical.
  src.start(t, v.rnd() * Math.max(0, buf.duration - 0.05));
  src.stop(end + 0.02);
  return end - v.t;
}

/** [ratio, amplitude, decay seconds] */
export type Partial = readonly [number, number, number];

export interface PartialsOpts {
  at?: number;
  attack?: number;
  pan?: number;
  dest?: AudioNode;
  /** Overall amplitude multiplier. */
  gain?: number;
  type?: Exclude<OscillatorType, 'custom'>;
}

/** Additive struck sound (bells, bars, metal). Returns end offset (s). */
export function partials(v: Target, base: number, parts: readonly Partial[], o: PartialsOpts = {}): number {
  const ny = nyquist(v.ctx);
  const gain = o.gain ?? 1;
  const attack = o.attack ?? 0.002;
  let end = 0;
  for (const [ratio, a, d] of parts) {
    const f = base * ratio;
    if (f >= ny || a <= 0) continue;
    end = Math.max(
      end,
      tone(v, { type: o.type ?? 'sine', freq: f, amp: perc(attack, a * gain, d), at: o.at, pan: o.pan, dest: o.dest }),
    );
  }
  return end;
}

export interface FmOpts {
  freq: number | Env;
  /** Modulator frequency = carrier * ratio. */
  ratio: number;
  /** Modulation index envelope (peak deviation / modulator frequency). */
  index: Env;
  amp: Env;
  at?: number;
  pan?: number;
  dest?: AudioNode;
  type?: Exclude<OscillatorType, 'custom'>;
}

/** Two-operator FM tone (bells, plucks, metallic coins). Returns end offset (s). */
export function fm(v: Target, o: FmOpts): number {
  const { ctx } = v;
  const t = v.t + (o.at ?? 0);
  const car = ctx.createOscillator();
  car.type = o.type ?? 'sine';
  const mod = ctx.createOscillator();
  mod.type = 'sine';
  setParam(car.frequency, t, o.freq, 1, nyquist(ctx));
  setParam(mod.frequency, t, o.freq, o.ratio, nyquist(ctx));
  const baseF = typeof o.freq === 'number' ? o.freq : o.freq[0][1];
  const modGain = ctx.createGain();
  modGain.gain.value = 0;
  automate(modGain.gain, t, o.index, baseF * o.ratio);
  mod.connect(modGain);
  modGain.connect(car.frequency);
  const g = ctx.createGain();
  g.gain.value = 0;
  const end = automate(g.gain, t, o.amp);
  car.connect(g);
  route(ctx, g, o.dest ?? v.out, o.pan);
  car.start(t);
  mod.start(t);
  car.stop(end + 0.02);
  mod.stop(end + 0.02);
  return end - v.t;
}

/** A gain node scheduled with an envelope, connected to dest; returns it as a sub-bus input. */
export function envBus(v: Target, env: Env, dest?: AudioNode, at = 0): GainNode {
  const g = v.ctx.createGain();
  g.gain.value = 0;
  automate(g.gain, v.t + at, env);
  g.connect(dest ?? v.out);
  return g;
}

/** Sub-target with a different output and/or time offset. */
export const sub = (v: Target, out: AudioNode, at = 0): Target => ({ ctx: v.ctx, out, t: v.t + at, rnd: v.rnd });

// ---------------------------------------------------------------------------------------------
// Cached buffers (noise colors, textures, impulse responses), one set per context.
// ---------------------------------------------------------------------------------------------

const bufferCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

export function cachedBuffer(ctx: BaseAudioContext, key: string, make: () => AudioBuffer): AudioBuffer {
  let m = bufferCache.get(ctx);
  if (!m) {
    m = new Map();
    bufferCache.set(ctx, m);
  }
  let b = m.get(key);
  if (!b) {
    b = make();
    m.set(key, b);
  }
  return b;
}

function normalizeRms(data: Float32Array, rms: number): void {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  const cur = Math.sqrt(s / data.length) || 1;
  const k = rms / cur;
  for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i] * k));
}

/** Remove DC and blend the tail into the head so a looping buffer has no click. */
function makeLoopable(data: Float32Array, fade: number): Float32Array {
  const n = data.length - fade;
  const out = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  for (let i = 0; i < n; i++) out[i] = data[i] - mean;
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = (data[i] - mean) * w + (data[n + i] - mean) * (1 - w);
  }
  return out;
}

function monoBuffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.getChannelData(0).set(data);
  return b;
}

/** 2 s looping noise; deterministic content per color. */
export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  return cachedBuffer(ctx, `noise:${color}`, () => {
    const sr = ctx.sampleRate;
    const fade = Math.floor(sr * 0.05);
    const len = Math.floor(sr * 2) + fade;
    const rnd = makeRng(color === 'white' ? 11 : color === 'pink' ? 23 : 37);
    const d = new Float32Array(len);
    if (color === 'white') {
      for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
    } else if (color === 'pink') {
      // Paul Kellet's refined pink filter.
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = rnd() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      }
    } else {
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
        d[i] = last;
      }
    }
    const out = makeLoopable(d, fade);
    normalizeRms(out, 0.3);
    return monoBuffer(ctx, out);
  });
}

/**
 * Stick-slip scrape texture (safe dragged over paving): noise whose amplitude jumps between
 * random levels every few milliseconds plus sparse grit clicks. Looped at a playback rate that
 * follows the drag speed.
 */
export function scrapeBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedBuffer(ctx, 'tex:scrape', () => {
    const sr = ctx.sampleRate;
    const fade = Math.floor(sr * 0.06);
    const len = Math.floor(sr * 2.2) + fade;
    const rnd = makeRng(4242);
    const d = new Float32Array(len);
    let level = 0.5;
    let target = 0.5;
    let hold = 0;
    let click = 0;
    for (let i = 0; i < len; i++) {
      if (--hold <= 0) {
        hold = Math.floor(sr * (0.004 + rnd() * 0.02));
        target = rnd() < 0.12 ? 1 : 0.15 + rnd() * 0.6;
      }
      level += (target - level) * 0.02;
      if (rnd() < 0.0009) click = 0.6 + rnd() * 0.4;
      click *= 0.93;
      const w = rnd() * 2 - 1;
      d[i] = w * level + click * (rnd() * 2 - 1);
    }
    const out = makeLoopable(d, fade);
    normalizeRms(out, 0.3);
    return monoBuffer(ctx, out);
  });
}

/**
 * Creak texture: irregular stick-slip pulses, each a few damped resonances (wood fibres /
 * roots under tension). Played faster = denser and higher = "rising creak".
 */
export function creakBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedBuffer(ctx, 'tex:creak', () => {
    const sr = ctx.sampleRate;
    const fade = Math.floor(sr * 0.04);
    const len = Math.floor(sr * 1.6) + fade;
    const rnd = makeRng(777);
    const d = new Float32Array(len);
    const modes = [
      [520, 0.007, 1],
      [1130, 0.0045, 0.6],
      [1960, 0.0028, 0.35],
    ] as const;
    let pos = 0;
    let phase = 0;
    while (pos < len) {
      // Slow "groan" swell modulates pulse strength.
      phase += 0.21;
      const swell = 0.55 + 0.45 * Math.sin(phase);
      const amp = (0.35 + rnd() * 0.65) * swell;
      const jit = 0.85 + rnd() * 0.3;
      const pl = Math.min(len - pos, Math.floor(sr * 0.03));
      for (const [f, tau, a] of modes) {
        const w = (2 * Math.PI * f * jit) / sr;
        const k = Math.exp(-1 / (tau * sr));
        let e = amp * a;
        for (let i = 0; i < pl; i++) {
          d[pos + i] += e * Math.sin(w * i);
          e *= k;
        }
      }
      pos += Math.floor(sr * (0.016 + rnd() * 0.03));
    }
    const out = makeLoopable(d, fade);
    normalizeRms(out, 0.3);
    return monoBuffer(ctx, out);
  });
}

/**
 * Stereo reverb impulse response: decorrelated noise with an exponential decay that also
 * darkens over time (high frequencies die first), plus a few early reflections.
 */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, damping: number, key: string): AudioBuffer {
  return cachedBuffer(ctx, `ir:${key}`, () => {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * seconds));
    const b = ctx.createBuffer(2, len, sr);
    const tau = seconds / 6.9; // -60 dB at `seconds`
    for (let ch = 0; ch < 2; ch++) {
      const rnd = makeRng(ch === 0 ? 1001 : 2002);
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // One-pole lowpass whose cutoff falls with time.
        const a = Math.min(0.98, damping * (t / seconds) + 0.05);
        lp = lp * a + (rnd() * 2 - 1) * (1 - a);
        d[i] = lp * Math.exp(-t / tau) * (1 - a * 0.5);
      }
      // Early reflections (plaza walls).
      const er = [0.011, 0.019, 0.027, 0.041, 0.053];
      er.forEach((et, k) => {
        const idx = Math.floor((et + (ch ? 0.003 : 0)) * sr);
        if (idx < len) d[idx] += (k % 2 ? -0.5 : 0.6) * (1 - k * 0.12);
      });
      // Gentle fade-in so the dry signal keeps its attack.
      const fadeIn = Math.floor(sr * 0.004);
      for (let i = 0; i < Math.min(fadeIn, len); i++) d[i] *= i / fadeIn;
    }
    // Normalize energy so wet level is predictable regardless of length.
    let e = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) e += d[i] * d[i];
    }
    const k = 1 / Math.sqrt(e / 2 || 1);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] *= k * 0.6;
    }
    return b;
  });
}
