/**
 * Master mixing graph, identical for the realtime engine and offline QA renders:
 *
 *   music tracks ─► musicDuck ─┬─► musicVol ─┐
 *   music reverb return ───────┘      ▲      │
 *   jingles ──────────────────────────┘      ├─► world ─► muffle LPF ─┐
 *   sfx voices / loops ─► sfxVol ────────────┘                        ├─► master ─► DC block
 *   sfx reverb return ───┘                                            │      ─► glue comp ─► limiter
 *   ui sounds ─► uiVol ───────────────────────────────────────────────┘      ─► safety clip ─► out
 *
 * The safety clipper is a WaveShaper that is the identity below 0.7 and saturates smoothly to a
 * hard ceiling just under -1 dBFS, so nothing the game does can ever clip the output even if the
 * limiter (a DynamicsCompressor, not a true brickwall) lets a transient through.
 */
import { impulseResponse } from './dsp';
import type { BusId } from './ids';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  ui: number;
}

export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 0.8, music: 0.7, sfx: 0.9, ui: 0.8 };

/** Output ceiling of the safety clipper (linear). 0.875 = -1.16 dBFS. */
export const OUTPUT_CEILING = 0.875;

/** Settings slider 0..1 -> linear gain. Square law approximates perceived loudness. */
export function volumeToGain(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const c = Math.min(1, v);
  return c * c;
}

/**
 * Fixed bus trims (linear). These set the overall balance: music sits ~7 dB under the sound
 * effects (measured with the offline QA renders, see dev/audio-gallery.html).
 */
export const BUS_TRIM: Readonly<Record<BusId, number>> = {
  sfx: 1,
  ui: 0.8,
  music: 0.5,
};

export interface Mixer {
  readonly ctx: BaseAudioContext;
  /** Inputs per bus. `music` = song tracks (ducked), `jingle` = victory/defeat/draw stingers. */
  readonly inputs: Readonly<Record<BusId | 'jingle', AudioNode>>;
  /** Reverb send inputs. */
  readonly musicReverb: AudioNode;
  readonly sfxReverb: AudioNode;
  /** Last node before the destination (attach analysers here). */
  readonly output: AudioNode;
  setVolumes(v: Volumes, smooth?: boolean): void;
  /** Lower the music by `db` (negative) for `hold` seconds starting at `t`, then recover. */
  duckMusic(t: number, db: number, hold: number, release?: number): void;
  /** Pause-menu muffle: lowpass + slight attenuation of the game world (music + sfx). */
  setMuffle(on: boolean): void;
  disconnect(): void;
}

function softClipCurve(ceiling: number, knee: number): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    curve[i] = Math.sign(x) * Math.min(ceiling, y);
  }
  return curve;
}

export function createMixer(ctx: BaseAudioContext, destination: AudioNode = ctx.destination): Mixer {
  const gain = (v = 1): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };

  // --- buses -----------------------------------------------------------------------------
  const musicIn = gain();
  const musicDuck = gain();
  const jingleIn = gain();
  const musicVol = gain();
  const sfxIn = gain();
  const sfxVol = gain();
  const uiIn = gain();
  const uiVol = gain();
  musicIn.connect(musicDuck);
  musicDuck.connect(musicVol);
  jingleIn.connect(musicVol);
  sfxIn.connect(sfxVol);
  uiIn.connect(uiVol);

  // --- reverbs (procedural IRs) -------------------------------------------------------------
  const musicReverb = gain();
  const musicConv = ctx.createConvolver();
  musicConv.normalize = false;
  musicConv.buffer = impulseResponse(ctx, 1.7, 0.85, 'music');
  musicReverb.connect(musicConv);
  musicConv.connect(musicDuck);

  const sfxReverb = gain();
  const sfxConv = ctx.createConvolver();
  sfxConv.normalize = false;
  sfxConv.buffer = impulseResponse(ctx, 1.1, 0.9, 'sfx');
  sfxReverb.connect(sfxConv);
  sfxConv.connect(sfxVol);

  // --- world (muffle-able) + master chain ---------------------------------------------------
  const world = gain();
  const muffle = ctx.createBiquadFilter();
  muffle.type = 'lowpass';
  muffle.frequency.value = 20000;
  muffle.Q.value = 0.5;
  musicVol.connect(world);
  sfxVol.connect(world);
  world.connect(muffle);

  const master = gain();
  muffle.connect(master);
  uiVol.connect(master);

  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 20;
  dcBlock.Q.value = 0.6;

  // Gentle glue so stacked events stay controlled; WebAudio adds automatic makeup gain, which
  // the master trim below compensates (measured offline).
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.knee.value = 10;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.004;
  glue.release.value = 0.22;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.0008;
  limiter.release.value = 0.12;

  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve(OUTPUT_CEILING, 0.7);
  clip.oversample = 'none';

  master.connect(dcBlock);
  dcBlock.connect(glue);
  glue.connect(limiter);
  limiter.connect(clip);
  clip.connect(destination);

  // Pre-compressor trim compensating the compressors' automatic makeup gain.
  const MASTER_TRIM = 0.5;

  const now = (): number => ctx.currentTime;
  const setGain = (p: AudioParam, v: number, smooth: boolean): void => {
    const t = now();
    p.cancelScheduledValues(t);
    if (smooth) {
      p.setValueAtTime(p.value, t);
      p.setTargetAtTime(v, t, 0.04);
    } else {
      p.setValueAtTime(v, t);
    }
  };

  let muffled = false;

  return {
    ctx,
    inputs: { music: musicIn, jingle: jingleIn, sfx: sfxIn, ui: uiIn },
    musicReverb,
    sfxReverb,
    output: clip,
    setVolumes(v: Volumes, smooth = true): void {
      setGain(master.gain, volumeToGain(v.master) * MASTER_TRIM, smooth);
      setGain(musicVol.gain, volumeToGain(v.music) * BUS_TRIM.music, smooth);
      setGain(sfxVol.gain, volumeToGain(v.sfx) * BUS_TRIM.sfx, smooth);
      setGain(uiVol.gain, volumeToGain(v.ui) * BUS_TRIM.ui, smooth);
    },
    duckMusic(t: number, db: number, hold: number, release = 0.6): void {
      const target = Math.pow(10, Math.min(0, db) / 20);
      const p = musicDuck.gain;
      const start = Math.max(t, now());
      p.cancelScheduledValues(start);
      p.setTargetAtTime(target, start, 0.03);
      p.setTargetAtTime(1, start + Math.max(0.05, hold), Math.max(0.05, release / 3));
    },
    setMuffle(on: boolean): void {
      if (on === muffled) return;
      muffled = on;
      const t = now();
      muffle.frequency.cancelScheduledValues(t);
      muffle.frequency.setValueAtTime(muffle.frequency.value, t);
      muffle.frequency.setTargetAtTime(on ? 650 : 20000, t, on ? 0.08 : 0.15);
      world.gain.cancelScheduledValues(t);
      world.gain.setValueAtTime(world.gain.value, t);
      world.gain.setTargetAtTime(on ? 0.6 : 1, t, 0.1);
    },
    disconnect(): void {
      try {
        clip.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}
