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

function normalizePeak(data: Float32Array, peak: number): void {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  const k = m > 0 ? peak / m : 1;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

/**
 * Root fibres snapping under tension: a sparse, loopable train of tiny damped "tk" snaps (one
 * random resonance each, mostly small, now and then a bigger crack). The strain loop plays it
 * faster and louder as the roots stretch (src/render/uproot.ts stages 2-3).
 */
export function crackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedBuffer(ctx, 'tex:crackle', () => {
    const sr = ctx.sampleRate;
    const fade = Math.floor(sr * 0.03);
    const len = Math.floor(sr * 1.7) + fade;
    const rnd = makeRng(9191);
    const d = new Float32Array(len);
    let t = 0;
    while (true) {
      // Poisson-ish spacing, ~28 snaps per second.
      t += -Math.log(1 - rnd() * 0.999) / 28;
      const at = Math.floor(t * sr);
      if (at >= len) break;
      const f = 700 + Math.pow(rnd(), 1.6) * 3000;
      const tau = 0.0012 + rnd() * 0.004;
      const big = rnd() < 0.12;
      const amp = (big ? 0.7 + rnd() * 0.3 : 0.12 + rnd() * 0.35) * (rnd() < 0.5 ? -1 : 1);
      const w = (2 * Math.PI * f) / sr;
      const k = Math.exp(-1 / (tau * sr));
      const n = Math.min(len - at, Math.floor(sr * tau * 7));
      let e = amp;
      for (let i = 0; i < n; i++) {
        // Noisy onset (fibre tearing) blending into the resonance.
        const grit = i < sr * 0.0008 ? (rnd() * 2 - 1) * 0.8 : 0;
        d[at + i] += e * (Math.sin(w * i) + grit);
        e *= k;
      }
    }
    const out = makeLoopable(d, fade);
    normalizePeak(out, 0.9);
    return monoBuffer(ctx, out);
  });
}

/**
 * The banks' alarm bell (old-fashioned electric bell): [ratio, amplitude, decay s] over a D5
 * fundamental, so the clang sits in the songs' D minor / F major. Shared by the alarm loop and the
 * clang when a bank slams down after its uproot hop.
 */
export const BANK_BELL_HZ = 587.33;
export const BANK_BELL_PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 0.5, 0.45],
  [2.004, 0.24, 0.3],
  [2.53, 0.36, 0.24],
  [3.01, 0.13, 0.18],
  [4.18, 0.1, 0.11],
  [5.43, 0.06, 0.07],
];
/** Clapper strikes per second (the bell models swing at ~5.7 Hz, two strikes per swing). */
export const ALARM_STRIKE_HZ = 11.6;
/** Sustained ring level between clapper impacts (relative to the impact). */
const ALARM_RING_FLOOR = 0.4;
/** The ring swells and eases like the bells' swing amplitude in the bank model (~2 s). */
export const ALARM_SWELL_SECONDS = 2.03;

/**
 * One seamless loop of the alarm bell ringing (two swell cycles): the clapper re-excites damped
 * resonators (one per partial) at ALARM_STRIKE_HZ with jittered strength, plus a small clapper
 * tick. The strike pattern is periodic in the buffer length and the buffer is taken from the
 * second simulated period (the first one only fills the resonators: its start-up has decayed by
 * ~80 dB a period later), so the ringing tails wrap around the loop point without a seam.
 * Written as a tight scalar loop (~25 ms at 48 kHz); the engine also builds it ahead of time at
 * unlock (loops.ts prewarmSteps) so the first bank alarm never stalls a frame.
 */
export function alarmBellBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedBuffer(ctx, 'tex:alarmBell', () => {
    const sr = ctx.sampleRate;
    const L = Math.round(sr * ALARM_SWELL_SECONDS * 2);
    const strikes = Math.round((L / sr) * ALARM_STRIKE_HZ);
    const rnd = makeRng(4711);
    const strength = new Float64Array(strikes);
    for (let j = 0; j < strikes; j++) {
      const ph = j / strikes; // two swells per buffer
      const swell = 0.42 + 0.58 * Math.pow(Math.max(0, Math.sin(ph * Math.PI * 4)), 0.8);
      strength[j] = swell * (0.88 + rnd() * 0.24);
    }
    const P = BANK_BELL_PARTIALS.length;
    const a1 = new Float64Array(P);
    const a2 = new Float64Array(P);
    const g = new Float64Array(P);
    const y1 = new Float64Array(P);
    const y2 = new Float64Array(P);
    BANK_BELL_PARTIALS.forEach(([ratio, amp, tau], k) => {
      const w = (2 * Math.PI * BANK_BELL_HZ * ratio) / sr;
      const r = Math.exp(-1 / (tau * sr));
      a1[k] = 2 * r * Math.cos(w);
      a2[k] = r * r;
      g[k] = amp * Math.sin(w);
    });
    const out = new Float32Array(L);
    const tickLen = Math.floor(sr * 0.0015);
    // Per-strike envelope factors, applied recursively (exp(-age / tau) without a call per sample).
    const kImpact = Math.exp(-1 / (sr * 0.025));
    const kAttack = Math.exp(-1 / (sr * 0.0007));
    let hp = 0;
    let lastIn = 0;
    for (let period = 0; period < 2; period++) {
      for (let j = 0; j < strikes; j++) {
        const at = Math.ceil((j * L) / strikes);
        const next = j + 1 < strikes ? Math.ceil(((j + 1) * L) / strikes) : L;
        const st = strength[j];
        let eImpact = 1;
        let eAttack = 1;
        for (let n = at; n < next; n++) {
          const x = n === at ? st : 0;
          let s = 0;
          for (let k = 0; k < P; k++) {
            const y = a1[k] * y1[k] - a2[k] * y2[k] + x * g[k];
            y2[k] = y1[k];
            y1[k] = y;
            s += y;
          }
          const age = n - at;
          // Clapper tick: a 1.5 ms burst of high-passed noise.
          if (age < tickLen) {
            const w = (rnd() * 2 - 1) * st * 0.5 * (1 - age / tickLen);
            hp = 0.6 * (hp + w - lastIn);
            lastIn = w;
            s += hp;
          }
          // Each impact rings out louder than the sustained gong: the articulate "rrrring".
          // (1 ms attack: an instant gain step would click down into the lows.)
          s *= ALARM_RING_FLOOR + (1 - ALARM_RING_FLOOR) * (1 - eAttack) * eImpact;
          eImpact *= kImpact;
          eAttack *= kAttack;
          if (period === 1) out[n] = s;
        }
      }
    }
    normalizePeak(out, 0.9);
    return monoBuffer(ctx, out);
  });
}

// ---------------------------------------------------------------------------------------------
// Soft haul textures (the drag / bankRumble loops). Band-limited by construction: rounded
// partials and low-passed noise only, so nothing hisses or clicks however fast they are played.
// ---------------------------------------------------------------------------------------------

/** Raised-cosine attack gain at sample i of an `att`-sample attack (no click, no step). */
const softAttack = (i: number, att: number): number => (i < att ? 0.5 - 0.5 * Math.cos((Math.PI * i) / att) : 1);

const bumpWindows = new Map<string, Float32Array>();

/** A bump's gain curve: raised-cosine attack, then a raised-cosine fade over its last third. */
function bumpWindow(full: number, att: number): Float32Array {
  const key = `${full}:${att}`;
  let w = bumpWindows.get(key);
  if (!w) {
    w = new Float32Array(full);
    const rel0 = Math.floor(full * 0.66);
    for (let i = 0; i < full; i++) {
      const tail = i > rel0 ? 0.5 + 0.5 * Math.cos((Math.PI * (i - rel0)) / (full - rel0)) : 1;
      w[i] = softAttack(i, att) * tail;
    }
    bumpWindows.set(key, w);
  }
  return w;
}

/**
 * One rounded "tok" (felt mallet on a wooden toy): damped partials [ratio, amplitude, decay s]
 * over f0, a pitch that starts a little sharp and settles (the plump toy "boop"), a raised-cosine
 * attack and a faded end (never a step, so never a click). Oscillators run as rotations and the
 * glide is updated every 32 samples (phase-continuous).
 */
function softBump(
  sr: number,
  f0: number,
  parts: readonly (readonly [number, number, number])[],
  o: { attack: number; glide: number; glideTau: number; length: number },
): Float32Array {
  const n = Math.floor(sr * o.length);
  const d = new Float32Array(n);
  const win = bumpWindow(n, Math.max(1, Math.floor(sr * o.attack)));
  const P = parts.length;
  const cs = new Float64Array(P);
  const sn = new Float64Array(P);
  const rc = new Float64Array(P);
  const rs = new Float64Array(P);
  const e = new Float64Array(P);
  const k = new Float64Array(P);
  for (let p = 0; p < P; p++) {
    // Spread start phases so the partials never all peak together (a rounder, less peaky bump).
    cs[p] = Math.cos(p * 2.1);
    sn[p] = Math.sin(p * 2.1);
    e[p] = parts[p][1];
    k[p] = Math.exp(-1 / (parts[p][2] * sr));
  }
  const BLOCK = 32;
  const kGlide = Math.exp(-BLOCK / (o.glideTau * sr));
  let glide = o.glide;
  for (let i = 0; i < n; ) {
    const w = (2 * Math.PI * f0 * (1 + glide)) / sr;
    for (let p = 0; p < P; p++) {
      rc[p] = Math.cos(w * parts[p][0]);
      rs[p] = Math.sin(w * parts[p][0]);
    }
    const end = Math.min(n, i + BLOCK);
    for (; i < end; i++) {
      let s = 0;
      for (let p = 0; p < P; p++) {
        const x = cs[p] * rc[p] - sn[p] * rs[p];
        sn[p] = sn[p] * rc[p] + cs[p] * rs[p];
        cs[p] = x;
        s += sn[p] * e[p];
        e[p] *= k[p];
      }
      d[i] = s * win[i];
    }
    glide *= kGlide;
  }
  return d;
}

/** `count` pre-synthesized bumps at pitches spread evenly over f0 * (1 +- spread). */
function bumpBank(
  sr: number,
  f0: number,
  spread: number,
  count: number,
  parts: readonly (readonly [number, number, number])[],
  o: { attack: number; glide: number; glideTau: number; length: number },
): Float32Array[] {
  const bank: Float32Array[] = [];
  for (let k = 0; k < count; k++) bank.push(softBump(sr, f0 * (1 + spread * ((2 * k) / (count - 1) - 1)), parts, o));
  return bank;
}

/** Mix a bump into d at sample `at`, scaled by amp. */
function addScaled(d: Float32Array, at: number, b: Float32Array, amp: number): void {
  const n = Math.min(b.length, d.length - at);
  for (let i = 0; i < n; i++) d[at + i] += amp * b[i];
}

/** Bump fundamental of rollBuffer at playback rate 1 (the "du"; "gu" is ~14 % higher). */
export const ROLL_BUMP_HZ = 320;

/** One RBJ biquad pass over x, in place (b0, b1, b2, a1, a2 already divided by a0). */
function biquadInPlace(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    x[i] = v;
  }
}

/**
 * The wooden body of a "tok": a short burst of noise rung through a soft resonance of the toy's
 * hollow wooden shell (centre `ratio` x f0, quality q). Unlike a sine partial it has no single
 * pitch line, so a long haul reads as knocks on wood rather than "bloops". The noise is first
 * darkened (two 2-pole lowpasses at ~2.3 f0, so the resonance's upper skirt never reaches the hiss
 * range), rung through the resonance twice (a rounder skirt), RMS-normalized, then shaped by a
 * slow raised-cosine attack (no click, no noisy spit), an exponential decay and the bump window.
 */
function woodKnock(sr: number, f0: number, ratio: number, q: number, o: { attack: number; decay: number; length: number }, rnd: () => number): Float32Array {
  const n = Math.floor(sr * o.length);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rnd() * 2 - 1;
  let w = (2 * Math.PI * Math.min(f0 * 2.3, sr / 4)) / sr;
  let al = Math.sin(w) / (2 * Math.SQRT1_2);
  let c = Math.cos(w);
  let a0 = 1 + al;
  for (let pass = 0; pass < 2; pass++) biquadInPlace(x, (1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
  w = (2 * Math.PI * f0 * ratio) / sr;
  al = Math.sin(w) / (2 * q);
  c = Math.cos(w);
  a0 = 1 + al;
  for (let pass = 0; pass < 2; pass++) biquadInPlace(x, al / a0, 0, -al / a0, (-2 * c) / a0, (1 - al) / a0);
  const m = Math.min(n, Math.floor(sr * 0.06));
  let e = 0;
  for (let i = 0; i < m; i++) e += x[i] * x[i];
  const att = Math.max(1, Math.floor(sr * o.attack));
  const win = bumpWindow(n, att);
  const k = Math.exp(-1 / (o.decay * sr));
  let env = 1 / Math.sqrt(e / m + 1e-12);
  for (let i = 0; i < n; i++) {
    x[i] *= env * softAttack(i, att) * win[i];
    env *= k;
  }
  return x;
}

/**
 * Rolling-bump texture of a heavy toy hauled over paving (the 'drag' loop): rounded wooden "tok"s
 * in loose "du-gu" pairs (a short gap inside a pair, a longer one between pairs, now and then a
 * skipped or extra bump so it never ticks like a metronome) over a soft low-passed rolling bed
 * that swells with each contact. Each "tok" is a short plump thump (fundamental near
 * ROLL_BUMP_HZ, where small laptop speakers still play it, and a soft sub-octave) with two short
 * inharmonic wooden overtones, inside a noise-rung wooden knock (a soft resonance at ~1.7 f0, the
 * 0.4-0.9 kHz presence small speakers carry). Every bump has its own pitch (+-10 %), its own
 * overtone tuning and its own knock, so a long haul has no fixed pitch lines ("bloops"); nothing
 * above ~2 kHz. 9.4 s (the pattern does not audibly repeat over a long haul), seamless; the loop
 * plays it at a rate that follows the haul speed, so "dugu-dugu" speeds up as the object does.
 */
export function rollBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedBuffer(ctx, 'tex:roll', () => {
    const sr = ctx.sampleRate;
    const fade = Math.floor(sr * 0.08);
    const seconds = 9.4;
    const len = Math.floor(sr * seconds) + fade;
    const rnd = makeRng(5150);
    const d = new Float32Array(len);
    const contact = new Float32Array(len);
    const shape = { attack: 0.006, glide: 0.03, glideTau: 0.012, length: 0.2 };
    const knock = { attack: 0.012, decay: 0.07, length: shape.length };
    // Nine pitches per stroke over +-10 %, each with its own overtones and knock: "du" and the
    // higher "gu" (their ranges overlap: no fixed interval either).
    const make = (base: number): Float32Array[] => {
      const bank: Float32Array[] = [];
      for (let k = 0; k < 9; k++) {
        const f0 = base * (1 + 0.1 * (k / 4 - 1));
        const jit = (): number => 1 + 0.06 * (2 * rnd() - 1);
        // Fundamental, two short inharmonic wooden overtones, soft sub-octave body (last, so its
        // start phase lines up with the fundamental's: a round, not peaky, onset).
        const parts: [number, number, number][] = [
          [1, 1, 0.055],
          [2.27 * jit(), 0.3, 0.016],
          [3.1 * jit(), 0.16, 0.01],
          [0.5, 0.36, 0.045],
        ];
        const b = softBump(sr, f0, parts, shape);
        const kn = woodKnock(sr, f0, 1.7, 1.4, knock, rnd);
        for (let i = 0; i < b.length; i++) b[i] += 0.3 * kn[i];
        bank.push(b);
      }
      return bank;
    };
    const du = make(ROLL_BUMP_HZ);
    const gu = make(ROLL_BUMP_HZ * 1.14);
    // Contact swell of the rolling bed after each bump (~90 ms decay, same window).
    const cn = Math.floor(sr * shape.length);
    const cwin = bumpWindow(cn, Math.max(1, Math.floor(sr * shape.attack)));
    const cproto = new Float32Array(cn);
    for (let i = 0; i < cn; i++) cproto[i] = Math.exp(-i / (0.09 * sr)) * cwin[i];
    let t = 0.03;
    let k = 0;
    while (t < len / sr - 0.01) {
      const second = k % 2 === 1;
      const bank = second ? gu : du;
      const b = bank[Math.min(bank.length - 1, Math.floor(rnd() * bank.length))];
      const amp = (second ? 0.78 : 1) * (0.88 + 0.12 * rnd());
      const at = Math.floor(t * sr);
      addScaled(d, at, b, amp);
      for (let i = 0, n = Math.min(cn, len - at); i < n; i++) contact[at + i] = Math.max(contact[at + i], amp * cproto[i]);
      if (!second) t += 0.085 + rnd() * 0.025;
      else {
        t += 0.19 + rnd() * 0.07;
        // Now and then a lone bump or a quick extra one (uneven paving).
        const r = rnd();
        if (r < 0.08) t += 0.12;
        else if (r < 0.14) k++;
      }
      k++;
    }
    // Rolling bed: brown noise through two one-pole lowpasses (~420 Hz), breathing with contact.
    const a = 1 - Math.exp((-2 * Math.PI * 420) / sr);
    let br = 0;
    let l1 = 0;
    let l2 = 0;
    for (let i = 0; i < len; i++) {
      br = (br + 0.02 * (rnd() * 2 - 1)) / 1.02;
      l1 += a * (br - l1);
      l2 += a * (l1 - l2);
      d[i] += l2 * 1.2 * (0.3 + 0.7 * contact[i]);
    }
    tamePeaks(d, sr, 6);
    const out = makeLoopable(d, fade);
    normalizePeak(out, 0.9);
    return monoBuffer(ctx, out);
  });
}

/**
 * Round off the loudest peaks of a pre-rendered texture (a smooth look-ahead soft-knee limiter):
 * peaks more than `crestDb` over the RMS are pulled in 3:1, with a gain that glides over a few ms
 * so it never clicks. Keeps a bump texture punchy but not spiky (no single bump sticks out).
 */
function tamePeaks(d: Float32Array, sr: number, crestDb: number): void {
  const n = d.length;
  let e = 0;
  for (let i = 0; i < n; i++) e += d[i] * d[i];
  const thr = Math.sqrt(e / n) * Math.pow(10, crestDb / 20);
  // Peak per 2 ms block, then the max over +-6 ms around each block.
  const B = Math.max(1, Math.floor(sr * 0.002));
  const nb = Math.ceil(n / B);
  const bm = new Float32Array(nb);
  for (let i = 0; i < n; i++) {
    const v = Math.abs(d[i]);
    const j = (i / B) | 0;
    if (v > bm[j]) bm[j] = v;
  }
  const gb = new Float32Array(nb);
  for (let j = 0; j < nb; j++) {
    let m = 0;
    for (let q = Math.max(0, j - 3); q <= Math.min(nb - 1, j + 3); q++) m = Math.max(m, bm[q]);
    gb[j] = m > thr ? (thr + (m - thr) / 3) / m : 1;
  }
  // Per-sample gain, zero-phase smoothed (forward + backward one-pole, ~2 ms): it never steps.
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = gb[(i / B) | 0];
  const k = Math.exp(-1 / (0.002 * sr));
  let y = 1;
  for (let i = 0; i < n; i++) g[i] = y = k * y + (1 - k) * g[i];
  y = 1;
  for (let i = n - 1; i >= 0; i--) g[i] = y = k * y + (1 - k) * g[i];
  for (let i = 0; i < n; i++) d[i] *= g[i];
}

/**
 * One period of a harmonic tone with a soft "oh" vowel (harmonics weighted around 300 Hz).
 * Schroeder phases spread the harmonics' peaks over the period: the same spectrum with a far
 * lower crest (a smooth hum rather than a buzzy pulse train).
 */
function groanCycle(f0: number, n = 2048): Float32Array {
  const c = new Float32Array(n);
  // Harmonics stay under ~700 Hz: a buzzier series would beat at f0 (roughness) up there.
  const H = Math.max(1, Math.ceil(700 / f0) - 1);
  for (let h = 1; h * f0 < 700; h++) {
    const f = h * f0;
    const formant = Math.exp(-Math.pow(Math.log2(f / 300), 2) / (2 * 0.6 * 0.6));
    const a = (0.25 + formant) / h;
    const phase = (Math.PI * h * (h - 1)) / H;
    for (let i = 0; i < n; i++) c[i] += a * Math.sin((2 * Math.PI * h * i) / n + phase);
  }
  return c;
}

/**
 * Slow heave texture of a whole building hauled along (the 'bankRumble' loop): big soft
 * foundation "thunk... thunk"s (deep rounded partials, slow attack, long decay, now and then a
 * double). The loop plays it at a rate that follows the bank's speed; the musical groan is a
 * separate texture (groanBuffer) played at a fixed rate so it stays in key. 6 s, seamless.
 */
export function heaveBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedBuffer(ctx, 'tex:heave', () => {
    const sr = ctx.sampleRate;
    const fade = Math.floor(sr * 0.12);
    const seconds = 6;
    const len = Math.floor(sr * seconds) + fade;
    const rnd = makeRng(6262);
    const d = new Float32Array(len);
    const parts = [
      [1, 1, 0.4],
      [2.02, 0.7, 0.16],
      [3.05, 0.4, 0.06],
    ] as const;
    // Four thunk pitches over 104 Hz * (0.95 .. 1.11): the upper ones also serve the doubles.
    // A slow 60 ms swell and a long body: a heave, not a hit (a low crest under the rumble).
    const thunks = bumpBank(sr, 104 * 1.03, 0.08, 4, parts, { attack: 0.06, glide: 0.08, glideTau: 0.03, length: 0.9 });
    const pickThunk = (lo: number): Float32Array => thunks[Math.min(3, lo + Math.floor(rnd() * 3))];
    let t = 0.08;
    while (t < len / sr - 0.02) {
      addScaled(d, Math.floor(t * sr), pickThunk(0), 0.88 + 0.12 * rnd());
      if (rnd() < 0.18) addScaled(d, Math.floor((t + 0.15 + rnd() * 0.04) * sr), pickThunk(1), 0.55);
      t += 0.5 + rnd() * 0.35;
    }
    tamePeaks(d, sr, 3);
    const out = makeLoopable(d, fade);
    normalizePeak(out, 0.9);
    return monoBuffer(ctx, out);
  });
}

/**
 * Pitches of the bank's groans, in order: D-minor chord tones (D2 / F2 / A2, the songs' key) in a
 * figure that goes up and comes back down (no short repeating three-note cycle).
 */
export const GROAN_NOTES_HZ: readonly number[] = [73.42, 87.31, 110, 73.42, 110, 87.31, 73.42];

/**
 * The bank's gentle musical groan (the 'bankRumble' loop, played at rate 1 so it stays in key
 * whatever the bank's speed): a vowel-like tone on a D-minor chord tone (GROAN_NOTES_HZ) that
 * scoops softly up into the note and swells, with a slow vibrato, then a short breath before the
 * next (groaning ~70 % of the time: steady under the rumble, not a peaky on-off). 13 s, seamless.
 */
export function groanBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedBuffer(ctx, 'tex:groan', () => {
    const sr = ctx.sampleRate;
    const fade = Math.floor(sr * 0.12);
    const seconds = 13;
    const len = Math.floor(sr * seconds) + fade;
    const rnd = makeRng(6363);
    const d = new Float32Array(len);
    // Groans: wavetable tone, broad swell, a soft scoop into the note, slow vibrato.
    const notes = GROAN_NOTES_HZ;
    let g = 0.6;
    let gi = 0;
    const tables = new Map<number, Float32Array>();
    for (let dur = 1.4 + rnd() * 0.8; g + dur < seconds; dur = 1.4 + rnd() * 0.8) {
      const f0 = notes[gi++ % notes.length];
      let table = tables.get(f0);
      if (!table) tables.set(f0, (table = groanCycle(f0)));
      const N = table.length;
      const s0 = Math.floor(g * sr);
      const n = Math.min(len - s0, Math.floor(dur * sr));
      const vib = 4 + rnd() * 1.2;
      let ph = rnd() * N;
      // Pitch moves slowly: updated every 16 samples (the phase stays continuous).
      let inc = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        if ((i & 15) === 0) {
          // A soft scoop up into the note over the first quarter (from 25 cents flat), then
          // exactly on the chord tone for the rest of the swell.
          const scoop = Math.max(0, 1 - u / 0.25);
          inc = (f0 * (1 - 0.0145 * scoop * scoop) * (1 + 0.006 * Math.sin((2 * Math.PI * vib * i) / sr)) * N) / sr;
        }
        // A broad swell, per sample: a soft rise, a long plateau and a soft fall (finite slope
        // at both ends, so the groan never starts or stops with a click).
        const swell = Math.sin(Math.PI * u);
        const env = 0.46 * swell * (2 - swell);
        ph += inc;
        if (ph >= N) ph -= N;
        const j = Math.floor(ph);
        const x = table[j] + (table[(j + 1) % N] - table[j]) * (ph - j);
        d[s0 + i] += x * env;
      }
      g += dur + 0.35 + rnd() * 0.6;
    }
    // Every groan ends inside the loop (no truncated swell to cross-fade): no limiter needed on
    // a smooth sustained tone.
    const out = makeLoopable(d, fade);
    normalizePeak(out, 0.9);
    return monoBuffer(ctx, out);
  });
}
