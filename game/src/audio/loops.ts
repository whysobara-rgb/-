/**
 * Continuous sounds whose character follows an intensity 0..1 every frame:
 *
 *   drag       safe scraping over paving; intensity = drag speed (rate, brightness, level)
 *   bankRumble a whole building grinding along; intensity = bank speed
 *   strain     rising creak while pulling an anchored target; intensity = unanchor progress
 *   sirenLoop  continuous wail during "30초 뒤 출발!"; intensity = urgency / proximity
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

export function createLoop(ctx: BaseAudioContext, id: LoopId, t: number, rnd: () => number): LoopVoice {
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
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.48; // ~2 s wail cycle
      const lfoDepth = gainNode(ctx, 380);
      chain(lfo, lfoDepth);
      const vib = ctx.createOscillator();
      vib.frequency.value = 7;
      const vibDepth = gainNode(ctx, 12);
      chain(vib, vibDepth);
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.value = 900;
      const sq = ctx.createOscillator();
      sq.type = 'square';
      sq.frequency.value = 900;
      for (const o of [tri, sq]) {
        lfoDepth.connect(o.frequency);
        vibDepth.connect(o.frequency);
      }
      const sqLp = filter(ctx, 'lowpass', 1800, 0.7);
      const sqLvl = gainNode(ctx, 0.25);
      chain(sq, sqLp, sqLvl);
      const mix = gainNode(ctx, 1);
      tri.connect(mix);
      sqLvl.connect(mix);
      const tone = filter(ctx, 'lowpass', 2000, 0.6);
      const lvl = gainNode(ctx);
      chain(mix, tone, lvl, g.out);
      for (const o of [lfo, vib, tri, sq]) {
        o.start(t);
        g.sources.push(o);
      }
      set = (i, at) => {
        const tau = 0.25;
        to(lvl.gain, 0.3 * i, at, tau);
        to(tone.frequency, 1300 + 1700 * i, at, tau);
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
