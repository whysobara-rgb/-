/**
 * Builds the per-voice chain for one sound effect, shared by the realtime engine and offline
 * QA renders so both produce identical audio:
 *
 *   recipe nodes ─► voice gain (volume x trim x distance) ─► [air lowpass] ─► [pan] ─► bus
 *                         └─► reverb send ─► bus reverb
 */
import { AMBIENCE_LOOPS, type LoopId } from './ids';
import { createLoop, type BarGrid, type LoopVoice } from './loops';
import type { Mixer } from './mixer';
import type { Rng } from './rng';
import { SFX_RECIPES } from './sfx';
import type { SfxId } from './ids';
import type { SpatialMix } from './spatial';

export interface SpawnOptions {
  /** Absolute start time. */
  t: number;
  mix: SpatialMix;
  volume: number;
  pitch: number;
  variant: number;
  step: number;
  key: number;
  rnd: Rng;
}

export interface SpawnedVoice {
  id: SfxId;
  out: GainNode;
  nodes: AudioNode[];
  start: number;
  /** Time after which every node of the voice is silent and can be disconnected. */
  end: number;
  priority: number;
}

/** Linear spatial cutoff above which no air-absorption filter is inserted. */
const FILTER_THRESHOLD = 17000;

function attachSpatial(ctx: BaseAudioContext, src: AudioNode, mix: SpatialMix, nodes: AudioNode[]): {
  head: AudioNode;
  lp: BiquadFilterNode | null;
  pan: StereoPannerNode | null;
} {
  let head = src;
  let lp: BiquadFilterNode | null = null;
  let pan: StereoPannerNode | null = null;
  if (mix.cutoff < FILTER_THRESHOLD) {
    lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = mix.cutoff;
    lp.Q.value = 0.5;
    head.connect(lp);
    head = lp;
    nodes.push(lp);
  }
  if (mix.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    pan = ctx.createStereoPanner();
    pan.pan.value = mix.pan;
    head.connect(pan);
    head = pan;
    nodes.push(pan);
  }
  return { head, lp, pan };
}

export function spawnSfx(ctx: BaseAudioContext, mixer: Mixer, id: SfxId, o: SpawnOptions): SpawnedVoice {
  const r = SFX_RECIPES[id];
  const out = ctx.createGain();
  out.gain.value = Math.max(0, o.volume * r.gain * o.mix.gain);
  const nodes: AudioNode[] = [out];
  const { head } = attachSpatial(ctx, out, o.mix, nodes);
  // Police chatter goes through the ambience sub-bus (dry and reverb send both ducked under scoring).
  const amb = r.ambience === true && r.bus === 'sfx';
  head.connect(r.bus === 'music' ? mixer.inputs.jingle : amb ? mixer.inputs.ambience : mixer.inputs[r.bus]);
  if (r.reverb && r.bus !== 'ui') {
    const send = ctx.createGain();
    send.gain.value = r.reverb;
    out.connect(send);
    send.connect(r.bus === 'music' ? mixer.musicReverb : amb ? mixer.ambienceReverb : mixer.sfxReverb);
    nodes.push(send);
  }
  const dur = r.play({ ctx, out, t: o.t, rnd: o.rnd, variant: o.variant, pitch: o.pitch, key: o.key, step: o.step });
  if (r.duck) mixer.duckMusic(o.t, r.duck.db, Math.max(r.duck.hold, dur * 0.8));
  if (r.duckAmbience) mixer.duckAmbience(o.t, r.duckAmbience.db, Math.max(r.duckAmbience.hold, dur * 0.6));
  return { id, out, nodes, start: o.t, end: o.t + Math.max(dur, r.length) + 0.05, priority: r.priority };
}

export interface SpawnedLoop {
  id: LoopId;
  voice: LoopVoice;
  gain: GainNode;
  lp: BiquadFilterNode;
  pan: StereoPannerNode | null;
  nodes: AudioNode[];
}

/**
 * A loop with a fixed spatial chain whose parameters are updated smoothly afterwards. `grid` is
 * the bar grid of the music playing now (rhythmic loops phrase with it).
 */
export function spawnLoop(
  ctx: BaseAudioContext,
  mixer: Mixer,
  id: LoopId,
  t: number,
  rnd: Rng,
  mix: SpatialMix,
  grid?: BarGrid | null,
): SpawnedLoop {
  const voice = createLoop(ctx, id, t, rnd, grid);
  const gain = ctx.createGain();
  gain.gain.value = mix.gain;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(ctx.sampleRate / 2 - 100, mix.cutoff);
  lp.Q.value = 0.5;
  voice.output.connect(gain);
  gain.connect(lp);
  let pan: StereoPannerNode | null = null;
  const nodes: AudioNode[] = [voice.output, gain, lp];
  // Sirens and alarm bells go through the ambience sub-bus (ducked under scoring sounds).
  // (Loops have no reverb send.)
  const bus = AMBIENCE_LOOPS.includes(id) ? mixer.inputs.ambience : mixer.inputs.sfx;
  if (typeof ctx.createStereoPanner === 'function') {
    pan = ctx.createStereoPanner();
    pan.pan.value = mix.pan;
    lp.connect(pan);
    pan.connect(bus);
    nodes.push(pan);
  } else {
    lp.connect(bus);
  }
  return { id, voice, gain, lp, pan, nodes };
}

/** Smoothly move a loop's spatial chain to a new mix. */
export function updateLoopSpatial(ctx: BaseAudioContext, l: SpawnedLoop, mix: SpatialMix, t: number): void {
  l.gain.gain.setTargetAtTime(mix.gain, t, 0.06);
  l.lp.frequency.setTargetAtTime(Math.min(ctx.sampleRate / 2 - 100, mix.cutoff), t, 0.08);
  l.pan?.pan.setTargetAtTime(mix.pan, t, 0.06);
}

export function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
