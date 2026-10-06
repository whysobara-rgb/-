/**
 * Continuous sounds whose character follows an intensity 0..1 every frame:
 *
 *   drag       safe scraping over paving; intensity = drag speed (rate, brightness, level)
 *   bankRumble a whole building grinding along; intensity = bank speed
 *   strain     rising creak while pulling an anchored target; intensity = unanchor progress
 *   sirenLoop  police wailing in the distance during "30초 뒤 출발!"; intensity = urgency
 *
 * A LoopVoice owns long-running looped sources; the engine creates one per (id, key) on demand,
 * feeds it intensity changes and destroys it after it has been silent for a while.
 */
import { creakBuffer, noiseBuffer, scrapeBuffer, type NoiseColor } from './dsp';
import type { LoopId } from './ids';

export interface LoopVoice {
  readonly id: LoopId;
  /** Output (pre-spatial) node. */
  readonly output: GainNode;
  /** Smoothly move towards the sound for this intensity (0 = silent). */
  set(intensity: number, t: number): void;
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
  drag: 0.65,
  bankRumble: 0.52,
  strain: 0.55,
  sirenLoop: 0.5,
};

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

  switch (id) {
    case 'drag': {
      const scrape = loopSource(g, scrapeBuffer(ctx), t, rnd);
      const bp = filter(ctx, 'bandpass', 600, 0.9);
      const lvl = gainNode(ctx);
      chain(scrape, bp, lvl, g.out);
      const body = noiseLoop(g, 'brown', t, rnd);
      const lp = filter(ctx, 'lowpass', 170);
      const bodyLvl = gainNode(ctx);
      chain(body, lp, bodyLvl, g.out);
      set = (i, at) => {
        const tau = 0.06;
        to(scrape.playbackRate, 0.55 + 0.9 * i, at, tau);
        to(bp.frequency, 450 + 1400 * i, at, tau);
        to(lvl.gain, i > 0 ? 0.25 + 0.45 * Math.pow(i, 0.8) : 0, at, tau);
        to(bodyLvl.gain, 0.5 * i, at, tau);
      };
      break;
    }
    case 'bankRumble': {
      const rumble = noiseLoop(g, 'brown', t, rnd);
      const lp = filter(ctx, 'lowpass', 120, 0.9);
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
      // Mid-range grinding so the movement is audible on laptop speakers.
      const grind = loopSource(g, scrapeBuffer(ctx), t, rnd);
      const bp = filter(ctx, 'bandpass', 350, 1);
      const grindLvl = gainNode(ctx);
      chain(grind, bp, grindLvl, g.out);
      // Occasional groaning of the structure.
      const groan = loopSource(g, creakBuffer(ctx), t, rnd);
      groan.playbackRate.value = 0.33;
      const groanBp = filter(ctx, 'bandpass', 420, 3);
      const groanLvl = gainNode(ctx);
      chain(groan, groanBp, groanLvl, g.out);
      set = (i, at) => {
        const tau = 0.15;
        to(lp.frequency, 90 + 130 * i, at, tau);
        to(rumbleLvl.gain, 0.75 * i, at, tau);
        to(subLvl.gain, 0.3 * i, at, tau);
        to(grind.playbackRate, 0.28 + 0.4 * i, at, tau);
        to(bp.frequency, 280 + 300 * i, at, tau);
        to(grindLvl.gain, 0.4 * i, at, tau);
        to(groanLvl.gain, 0.16 * i, at, tau);
      };
      break;
    }
    case 'strain': {
      const creak = loopSource(g, creakBuffer(ctx), t, rnd);
      const bp = filter(ctx, 'bandpass', 600, 1.6);
      const lvl = gainNode(ctx);
      chain(creak, bp, lvl, g.out);
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = 64;
      const lp = filter(ctx, 'lowpass', 420, 2);
      const sawLvl = gainNode(ctx);
      chain(saw, lp, sawLvl, g.out);
      saw.start(t);
      g.sources.push(saw);
      set = (i, at) => {
        const tau = 0.1;
        const on = i > 0.001;
        to(creak.playbackRate, 0.55 + 1.1 * i, at, tau);
        to(bp.frequency, 550 + 900 * i, at, tau);
        to(lvl.gain, on ? 0.45 + 0.4 * i : 0, at, tau);
        to(saw.frequency, 62 + 36 * i, at, tau);
        to(sawLvl.gain, on ? 0.035 + 0.045 * i : 0, at, tau);
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
  }

  return {
    id,
    output: g.out,
    set: (i, at) => set(Math.max(0, Math.min(1, i)), at),
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
