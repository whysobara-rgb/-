/**
 * Offline rendering (OfflineAudioContext) through the exact production graph: same recipes,
 * same mixer, same limiter. Used by the dev gallery's QA hooks (Playwright renders WAVs that are
 * analyzed for peak / loudness / DC / spectrum) and handy for regression comparisons.
 * Browser-only: requires OfflineAudioContext.
 */
import type { Vec2 } from '../sim/types';
import type { LoopId, SfxId, TrackId } from './ids';
import { createMixer, type Volumes } from './mixer';
import { makeRng } from './rng';
import { MusicPlayer } from './sequencer';
import { SFX_RECIPES } from './sfx';
import { spatialMix } from './spatial';
import { SFX_KEY_ROOT } from './theory';
import { spawnLoop, spawnSfx, updateLoopSpatial } from './voice';

export const QA_SAMPLE_RATE = 48000;
/**
 * Silence before the sound starts. A DynamicsCompressor starts from an unsettled state and
 * attenuates the first ~100 ms of a fresh context; a realtime context has long settled by the
 * time anything plays, so renders start after this pre-roll to measure what players hear.
 */
export const PRE_ROLL = 0.6;
const FULL: Volumes = { master: 1, music: 1, sfx: 1, ui: 1 };

function offline(seconds: number, sampleRate: number): OfflineAudioContext {
  const length = Math.max(1, Math.ceil(seconds * sampleRate));
  return new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
}

export interface SfxRenderOptions {
  variant?: number;
  seed?: number;
  pitch?: number;
  step?: number;
  volume?: number;
  pos?: Vec2;
  listener?: Vec2;
  sampleRate?: number;
  /** Extra tail (s) after the recipe's declared length (reverb). */
  tail?: number;
}

export async function renderSfx(id: SfxId, o: SfxRenderOptions = {}): Promise<AudioBuffer> {
  const r = SFX_RECIPES[id];
  const sr = o.sampleRate ?? QA_SAMPLE_RATE;
  const ctx = offline(PRE_ROLL + r.length + (o.tail ?? 0.8), sr);
  const mixer = createMixer(ctx);
  mixer.setVolumes(FULL, false);
  const mix = r.global ? spatialMix(o.listener ?? { x: 0, y: 0 }, null) : spatialMix(o.listener ?? { x: 0, y: 0 }, o.pos);
  spawnSfx(ctx, mixer, id, {
    t: PRE_ROLL,
    mix,
    volume: o.volume ?? 1,
    pitch: o.pitch ?? 1,
    variant: (o.variant ?? 0) % r.variants,
    step: o.step ?? 0,
    key: SFX_KEY_ROOT,
    rnd: makeRng(o.seed ?? 1),
  });
  return ctx.startRendering();
}

export interface MusicRenderOptions {
  /** Constant intensity, or a function of time (s). */
  intensity?: number | ((t: number) => number);
  seed?: number;
  sampleRate?: number;
  /** QA: render only these instruments. */
  only?: readonly string[];
}

export async function renderMusic(id: TrackId, seconds: number, o: MusicRenderOptions = {}): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? QA_SAMPLE_RATE;
  const ctx = offline(PRE_ROLL + seconds, sr);
  const mixer = createMixer(ctx);
  mixer.setVolumes(FULL, false);
  const player = new MusicPlayer({ ctx, input: mixer.inputs.music, reverb: mixer.musicReverb }, o.seed ?? 7);
  const only = o.only;
  if (only) player.eventFilter = (ev) => only.includes(ev.inst);
  const inten = o.intensity ?? 0.75;
  const at = (t: number): number => (typeof inten === 'number' ? inten : inten(t));
  player.setIntensity(at(0), PRE_ROLL);
  player.play(id, PRE_ROLL);
  // Schedule in slices exactly like the realtime pump so composition sees intensity changes.
  for (let t = 0; t < seconds; t += 0.25) {
    player.setIntensity(at(t), PRE_ROLL + t);
    player.schedule(PRE_ROLL + Math.min(seconds, t + 0.3), PRE_ROLL + t);
  }
  return ctx.startRendering();
}

export interface LoopRenderOptions {
  /** Intensity as a function of time (s). */
  intensity: (t: number) => number;
  /** Position as a function of time (listener at origin). */
  pos?: (t: number) => Vec2 | undefined;
  seed?: number;
  sampleRate?: number;
}

export async function renderLoop(id: LoopId, seconds: number, o: LoopRenderOptions): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? QA_SAMPLE_RATE;
  const ctx = offline(seconds, sr);
  const mixer = createMixer(ctx);
  mixer.setVolumes(FULL, false);
  const origin = { x: 0, y: 0 };
  const l = spawnLoop(ctx, mixer, id, 0, makeRng(o.seed ?? 3), spatialMix(origin, o.pos?.(0)));
  for (let t = 0; t < seconds; t += 1 / 30) {
    l.voice.set(Math.max(0, Math.min(1, o.intensity(t))), t);
    updateLoopSpatial(ctx, l, spatialMix(origin, o.pos?.(t)), t);
  }
  l.voice.stop(seconds);
  return ctx.startRendering();
}

export interface SceneCue {
  t: number;
  id: SfxId;
  variant?: number;
  pos?: Vec2;
  volume?: number;
  step?: number;
}

export interface SceneOptions {
  music?: TrackId;
  intensity?: number;
  cues: readonly SceneCue[];
  /** Loops held at a constant intensity for the whole scene. */
  loops?: readonly { id: LoopId; intensity: number; pos?: Vec2 }[];
  seed?: number;
  sampleRate?: number;
}

/**
 * A whole moment of gameplay through the production mixer: music + loops + timed SFX
 * (listener at the origin). Used to check stacking headroom and the music/SFX balance.
 */
export async function renderScene(seconds: number, o: SceneOptions): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? QA_SAMPLE_RATE;
  const ctx = offline(PRE_ROLL + seconds, sr);
  const mixer = createMixer(ctx);
  mixer.setVolumes(FULL, false);
  const rnd = makeRng(o.seed ?? 11);
  const origin = { x: 0, y: 0 };
  for (const c of [...o.cues].sort((a, b) => a.t - b.t)) {
    const r = SFX_RECIPES[c.id];
    spawnSfx(ctx, mixer, c.id, {
      t: PRE_ROLL + c.t,
      mix: r.global ? spatialMix(origin, null) : spatialMix(origin, c.pos),
      volume: c.volume ?? 1,
      pitch: 1,
      variant: (c.variant ?? 0) % r.variants,
      step: c.step ?? 0,
      key: SFX_KEY_ROOT,
      rnd,
    });
  }
  for (const l of o.loops ?? []) {
    const sp = spawnLoop(ctx, mixer, l.id, PRE_ROLL, rnd, spatialMix(origin, l.pos));
    sp.voice.set(l.intensity, PRE_ROLL);
    sp.voice.stop(PRE_ROLL + seconds);
  }
  if (o.music) {
    const player = new MusicPlayer({ ctx, input: mixer.inputs.music, reverb: mixer.musicReverb }, o.seed ?? 7);
    player.setIntensity(o.intensity ?? 0.75, PRE_ROLL);
    player.play(o.music, PRE_ROLL);
    for (let t = 0; t < seconds; t += 0.25) player.schedule(PRE_ROLL + Math.min(seconds, t + 0.3), PRE_ROLL + t);
  }
  return ctx.startRendering();
}

/** Encode as WAV: 32-bit float (analysis) or 16-bit PCM (listening). */
export function encodeWav(buf: AudioBuffer, bits: 16 | 32 = 32): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bps = bits / 8;
  const dataLen = n * ch * bps;
  const ab = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(ab);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, bits === 32 ? 3 : 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * ch * bps, true);
  dv.setUint16(32, ch * bps, true);
  dv.setUint16(34, bits, true);
  str(36, 'data');
  dv.setUint32(40, dataLen, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = chans[c][i];
      if (bits === 32) dv.setFloat32(o, x, true);
      else dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x * 32767))), true);
      o += bps;
    }
  }
  return ab;
}
