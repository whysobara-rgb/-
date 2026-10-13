/**
 * Master mixing graph, identical for the realtime engine and offline QA renders:
 *
 *   music tracks ─► musicDuck ─┬─► musicVol ─┐
 *   music reverb return ───────┘      ▲      │
 *   jingles ──────────────────────────┘      ├─► world ─► muffle LPF ─┐
 *   sfx voices / loops ─► sfxVol ────────────┘                        ├─► master ─► DC block
 *   ambience ─► ambDuck ─┘                                            │      ─► glue comp ─► limiter
 *   sfx reverb return ───┘  ▲                                         │      ─► safety clip ─► out
 *   ambience reverb send ─► ambRevDuck ─► sfx reverb                  │
 *   ui sounds ─► uiVol ───────────────────────────────────────────────┘
 *
 * Two duckers: scoring / big moments push the music down (musicDuck), and scoring sounds push the
 * "ambience" down so it never masks the coins (ambDuck, and the same duck on the ambience's reverb
 * send): the police sirens, bank alarm bells and getaway wail loops plus the police chatter
 * one-shots (whistles, "멈춰!", car noises). Overlapping ducks merge: the deeper one wins and the
 * later end holds.
 *
 * Bus gains are calibrated at the shipped default slider positions (DEFAULT_VOLUMES): untouched
 * settings give exactly the measured balance, and each slider scales around its default.
 *
 * The safety clipper is a WaveShaper (oversampled 2x) that is the identity below 0.7 and saturates
 * smoothly to a hard ceiling at -1.4 dBFS, so nothing the game does can ever clip the output, not
 * even between samples, even if the limiter (a DynamicsCompressor, not a true brickwall) lets a
 * transient through.
 */
import { impulseResponse } from './dsp';
import type { BusId } from './ids';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  ui: number;
}

/**
 * Shipped slider positions, and the positions the mix is calibrated at. They must equal
 * `DEFAULT_SETTINGS.volumes` in src/platform/settings.ts (a unit test checks it): with the
 * settings untouched every bus runs at exactly its calibrated gain below, so the measured balance
 * (music ~7 dB under the sound effects, peaks under -1 dBFS) is what players hear out of the box.
 */
export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 0.8, music: 0.7, sfx: 0.9, ui: 0.8 };

/**
 * Output ceiling of the safety clipper (linear). 0.85 = -1.41 dBFS; with the clipper oversampled
 * 2x the inter-sample (true) peak stays under -1 dBTP even at max volume, where the limiter's
 * automatic makeup gain keeps the clipper shaping the densest moments (measured on full bot
 * matches: -1.2 / -1.3 dBTP at max sliders; at the defaults it only touches big moments).
 */
export const OUTPUT_CEILING = 0.85;

/** Settings slider 0..1 -> linear gain. Square law approximates perceived loudness. */
export function volumeToGain(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const c = Math.min(1, v);
  return c * c;
}

/**
 * Linear gain of each bus with its slider at the default position. These set the balance:
 * music ~7 dB under the medium sound effects, UI a little under gameplay (measured with the
 * offline QA renders, see dev/audio-gallery.html).
 */
export const BUS_TRIM: Readonly<Record<BusId, number>> = {
  sfx: 1,
  ui: 0.8,
  music: 0.5,
};

/**
 * Master gain with the master slider at its default position. It sits before the glue
 * compressor and limiter and compensates their automatic makeup gain (measured offline).
 */
export const MASTER_TRIM = 0.5;

/**
 * Gain multiplier of a slider relative to its calibration position: 1 at the default, square law
 * around it (0 = silent). Raising a slider above its default makes that bus louder than the
 * calibrated mix; the limiter and the safety clipper keep the output under the ceiling.
 */
export function sliderGain(slider: number, calibratedAt: number): number {
  const ref = volumeToGain(calibratedAt);
  return ref > 0 ? volumeToGain(slider) / ref : volumeToGain(slider);
}

/** Linear gains the mixer applies for these slider positions (exported for tests and tools). */
export function busGains(v: Volumes): { master: number } & Record<BusId, number> {
  return {
    master: sliderGain(v.master, DEFAULT_VOLUMES.master) * MASTER_TRIM,
    music: sliderGain(v.music, DEFAULT_VOLUMES.music) * BUS_TRIM.music,
    sfx: sliderGain(v.sfx, DEFAULT_VOLUMES.sfx) * BUS_TRIM.sfx,
    ui: sliderGain(v.ui, DEFAULT_VOLUMES.ui) * BUS_TRIM.ui,
  };
}

export interface Mixer {
  readonly ctx: BaseAudioContext;
  /**
   * Inputs per bus. `music` = song tracks (ducked), `jingle` = victory/defeat/draw stingers,
   * `ambience` = sirens and alarm bells (part of the sfx bus, ducked under scoring sounds).
   */
  readonly inputs: Readonly<Record<BusId | 'jingle' | 'ambience', AudioNode>>;
  /** Reverb send inputs (`ambienceReverb` feeds the sfx reverb, ducked with the ambience). */
  readonly musicReverb: AudioNode;
  readonly sfxReverb: AudioNode;
  readonly ambienceReverb: AudioNode;
  /** Last node before the destination (attach analysers here). */
  readonly output: AudioNode;
  setVolumes(v: Volumes, smooth?: boolean): void;
  /** Lower the music by `db` (negative) for `hold` seconds starting at `t`, then recover. */
  duckMusic(t: number, db: number, hold: number, release?: number): void;
  /** Lower the ambience (sirens, alarm bells, police chatter) the same way. */
  duckAmbience(t: number, db: number, hold: number, release?: number): void;
  /** Pause-menu muffle: lowpass + slight attenuation of the game world (music + sfx). */
  setMuffle(on: boolean): void;
  disconnect(): void;
}

/**
 * A duck on one or more gain params (moved together). Overlapping requests merge: while a duck is
 * held, a new one can only deepen it or hold it longer (a shallow duck never lifts a deep one early).
 */
export function makeDucker(ctx: BaseAudioContext, ...params: AudioParam[]): (t: number, db: number, hold: number, release?: number) => void {
  let until = -Infinity;
  let depth = 1;
  return (t, db, hold, release = 0.6) => {
    const target = Math.pow(10, Math.min(0, Number.isFinite(db) ? db : 0) / 20);
    const start = Math.max(t, ctx.currentTime);
    const end = start + Math.max(0.05, Number.isFinite(hold) ? hold : 0);
    const active = start < until;
    const nextDepth = active ? Math.min(depth, target) : target;
    const nextUntil = active ? Math.max(until, end) : end;
    if (active && nextDepth === depth && nextUntil === until) return;
    for (const p of params) {
      p.cancelScheduledValues(start);
      p.setTargetAtTime(nextDepth, start, 0.03);
      p.setTargetAtTime(1, nextUntil, Math.max(0.05, release / 3));
    }
    depth = nextDepth;
    until = nextUntil;
  };
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
  const ambIn = gain();
  const ambDuck = gain();
  const uiIn = gain();
  const uiVol = gain();
  musicIn.connect(musicDuck);
  musicDuck.connect(musicVol);
  jingleIn.connect(musicVol);
  sfxIn.connect(sfxVol);
  ambIn.connect(ambDuck);
  ambDuck.connect(sfxVol);
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
  const ambienceReverb = gain();
  ambienceReverb.connect(sfxReverb);

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
  // 2x: the saturated harmonics are band-limited, so no inter-sample overs between samples.
  clip.oversample = '2x';

  master.connect(dcBlock);
  dcBlock.connect(glue);
  glue.connect(limiter);
  limiter.connect(clip);
  clip.connect(destination);

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
  const musicDucker = makeDucker(ctx, musicDuck.gain);
  const ambDucker = makeDucker(ctx, ambDuck.gain, ambienceReverb.gain);

  return {
    ctx,
    inputs: { music: musicIn, jingle: jingleIn, sfx: sfxIn, ui: uiIn, ambience: ambIn },
    musicReverb,
    sfxReverb,
    ambienceReverb,
    output: clip,
    setVolumes(v: Volumes, smooth = true): void {
      const g = busGains(v);
      setGain(master.gain, g.master, smooth);
      setGain(musicVol.gain, g.music, smooth);
      setGain(sfxVol.gain, g.sfx, smooth);
      setGain(uiVol.gain, g.ui, smooth);
    },
    duckMusic(t: number, db: number, hold: number, release = 0.6): void {
      musicDucker(t, db, hold, release);
    },
    duckAmbience(t: number, db: number, hold: number, release = 0.8): void {
      ambDucker(t, db, hold, release);
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
