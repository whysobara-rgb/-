/**
 * 2D positional mixing for a fixed high top-down camera (docs/ARCHITECTURE.md: the camera never
 * rotates, screen right == sim +x). Sounds are panned by their x offset from the listener and
 * attenuated by distance: full level within 6 m, inverse-distance roll-off beyond, and a smooth
 * fade to silence by 40 m. Distant sounds also lose some highs (air absorption), which helps the
 * ear tell "over there" from "right here" on stereo speakers.
 */
import type { Vec2 } from '../sim/types';

export const SPATIAL = {
  /** Full level inside this radius (m). */
  refDistance: 6,
  /** Silent beyond this distance (m). */
  maxDistance: 40,
  /** The final fade to silence starts here (m). */
  fadeStart: 24,
  /** Inverse-distance roll-off factor (0.6 = gentle, keeps on-screen sounds clearly audible). */
  rolloff: 0.6,
  /** x offset (m) that reaches full pan. Roughly half the visible play area. */
  panWidth: 14,
  /** Never pan hard: sounds stay present in both ears on headphones. */
  maxPan: 0.8,
  /** Lowpass cutoff at refDistance and at maxDistance (Hz). */
  nearCutoff: 20000,
  farCutoff: 2400,
} as const;

export interface SpatialMix {
  /** Linear gain 0..1. */
  gain: number;
  /** Stereo pan -1..1. */
  pan: number;
  /** Lowpass cutoff (Hz); >= 18000 means "no filter needed". */
  cutoff: number;
  distance: number;
}

const CENTERED: SpatialMix = Object.freeze({ gain: 1, pan: 0, cutoff: SPATIAL.nearCutoff, distance: 0 });

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Gain-only distance law (exported for tests and for loudness-based culling). */
export function distanceGain(d: number): number {
  if (!Number.isFinite(d)) return 0;
  if (d <= SPATIAL.refDistance) return 1;
  if (d >= SPATIAL.maxDistance) return 0;
  const inv = SPATIAL.refDistance / (SPATIAL.refDistance + SPATIAL.rolloff * (d - SPATIAL.refDistance));
  return inv * (1 - smoothstep(SPATIAL.fadeStart, SPATIAL.maxDistance, d));
}

/** Mix parameters for a sound at `pos` heard from `listener`. No position = centered, full level. */
export function spatialMix(listener: Vec2, pos?: Vec2 | null): SpatialMix {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return CENTERED;
  const dx = pos.x - listener.x;
  const dy = pos.y - listener.y;
  const d = Math.hypot(dx, dy);
  const gain = distanceGain(d);
  // Very close sounds collapse toward the center so a sound "on top of" the player is not
  // yanked hard left/right by a tiny offset.
  const nearFactor = smoothstep(0.5, 3, d);
  const pan = Math.max(-1, Math.min(1, dx / SPATIAL.panWidth)) * SPATIAL.maxPan * nearFactor;
  const far = smoothstep(SPATIAL.refDistance, SPATIAL.maxDistance, d);
  const cutoff = SPATIAL.nearCutoff * Math.pow(SPATIAL.farCutoff / SPATIAL.nearCutoff, far);
  return { gain, pan, cutoff, distance: d };
}

/** Caption direction for a positioned sound (doc §13 subtitles with direction). */
export function captionSide(mix: SpatialMix): 'left' | 'right' | null {
  if (mix.pan <= -0.25) return 'left';
  if (mix.pan >= 0.25) return 'right';
  return null;
}
