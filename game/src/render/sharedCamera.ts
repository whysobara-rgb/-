/**
 * Shared match camera for local multiplayer (pure; unit-tested).
 *
 * One screen, every human player (and what they carry) in frame: the camera keeps the fixed
 * match yaw / pitch (doc §4: screen-up is always sim -y) and only moves its target and distance.
 * It zooms between the single-player walking distance and SHARED_MAX_DIST (raccoons still read
 * at that size). When the group is spread wider than that, the target is chosen so that as much
 * of the group as possible stays visible (balanced between the extremes rather than centred on
 * P1); whoever is still outside gets an off-screen arrow in their colour (HUD).
 */
import type { Vec2 } from '../sim';
import { MATCH_DIST, MATCH_FOV, MATCH_PITCH } from './camera';

/** Furthest the shared camera pulls back (m). ~22 px raccoons at 720p. */
export const SHARED_MAX_DIST = 36;
/** Fraction of the visible half-extent the group may use (the rest is margin for labels / HUD). */
const INNER = 0.78;

const DEG = Math.PI / 180;

export interface FramePoint {
  x: number;
  y: number;
  /** Radius around the point that must stay visible (m). */
  r: number;
}

export interface SharedFrame {
  x: number;
  y: number;
  dist: number;
  /** Every point fits at this distance. */
  fits: boolean;
}

/** Visible ground extents around the look-at point at a distance (m): west/east half-width, north, south. */
export function visibleExtents(dist: number, aspect: number, pitchDeg = MATCH_PITCH, fovDeg = MATCH_FOV): { half: number; north: number; south: number } {
  const p = pitchDeg * DEG;
  const vf = fovDeg * DEG;
  const h = Math.sin(p) * dist;
  const back = Math.cos(p) * dist;
  const topDep = Math.max(0.12, p - vf / 2);
  const botDep = Math.min(Math.PI / 2 - 0.01, p + vf / 2);
  return {
    // half-width at the look-at depth (rows further north are wider, nearer rows narrower)
    half: dist * Math.tan(vf / 2) * aspect,
    north: h / Math.tan(topDep) - back,
    south: back - h / Math.tan(botDep),
  };
}

/**
 * Smallest distance in [minDist, SHARED_MAX_DIST] that frames every point, and the look-at
 * point. Past the max distance the target sits in the middle of what can be shown.
 */
export function sharedFraming(points: readonly FramePoint[], aspect: number, minDist: number = MATCH_DIST.walk, maxDist: number = SHARED_MAX_DIST): SharedFrame {
  if (!points.length) return { x: 0, y: 0, dist: minDist, fits: true };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of points) {
    minX = Math.min(minX, q.x - q.r);
    maxX = Math.max(maxX, q.x + q.r);
    minY = Math.min(minY, q.y - q.r);
    maxY = Math.max(maxY, q.y + q.r);
  }
  const w = maxX - minX;
  const d = maxY - minY;
  const fitsAt = (dist: number): boolean => {
    const e = visibleExtents(dist, aspect);
    return w <= 2 * e.half * INNER && d <= (e.north + e.south) * INNER;
  };
  let dist = maxDist;
  let fits = false;
  for (let s = minDist; s <= maxDist + 1e-6; s += 0.5) {
    if (fitsAt(s)) {
      dist = s;
      fits = true;
      break;
    }
  }
  const e = visibleExtents(dist, aspect);
  // North shows more ground than south: place the target so both ends keep the same share of margin.
  const n = e.north * INNER;
  const so = e.south * INNER;
  // feasible ty: maxY - ty <= so and ty - minY <= n  ->  ty in [maxY - so, minY + n]
  const lo = maxY - so;
  const hi = minY + n;
  const y = lo <= hi ? (lo + hi) / 2 : (lo + hi) / 2;
  const x = (minX + maxX) / 2;
  return { x, y, dist, fits };
}
