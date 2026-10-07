/**
 * Shared match camera for local multiplayer (pure; unit-tested).
 *
 * One screen, every human player (and what they carry) in frame: the camera keeps the fixed
 * match yaw / pitch (doc §4: screen-up is always sim -y) and only moves its target and distance.
 * It zooms between the single-player walking distance and SHARED_MAX_DIST (raccoons still read
 * at that size). When the group is spread wider than that, the frame keeps as many players on
 * screen as it can (rather than centring on an empty middle) and leans toward the rest; whoever
 * is still outside gets an off-screen arrow in their colour (HUD).
 */
import type { Vec2 } from '../sim';
import { MATCH_DIST, MATCH_FOV, MATCH_PITCH } from './camera';

/**
 * Furthest the shared camera pulls back (m): raccoons stay ~28 px tall at 720p (~42 px at 1080p)
 * and every human also wears a ground ring + "P1" tag in their colour.
 */
export const SHARED_MAX_DIST = 44;
/** Fraction of the visible half-extent the group may use (the rest is margin for labels / HUD). */
const INNER = 0.78;

const DEG = Math.PI / 180;

export interface FramePoint {
  x: number;
  y: number;
  /** Radius around the point that must stay visible (m). */
  r: number;
  /** Whose point this is (a player and what they carry move in and out of frame together). */
  owner?: number;
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
 * point. When the whole group cannot fit even at the max distance, the frame keeps as many
 * players fully visible as possible (points with the same `owner` stay together: a player and
 * what they carry), slid as far toward the rest of the group as it can go so the others sit
 * just past the edge (their arrows point a short way). Ties between equally large groups keep
 * the one nearest `prev` (the last frame: no flip-flopping), else the one with the lowest owner.
 */
export function sharedFraming(
  points: readonly FramePoint[],
  aspect: number,
  minDist: number = MATCH_DIST.walk,
  maxDist: number = SHARED_MAX_DIST,
  prev: { x: number; y: number } | null = null,
): SharedFrame {
  if (!points.length) return { x: 0, y: 0, dist: minDist, fits: true };
  const all = bounds(points);
  const fitsAt = (b: Bounds, dist: number): boolean => {
    const e = visibleExtents(dist, aspect);
    return b.maxX - b.minX <= 2 * e.half * INNER && b.maxY - b.minY <= (e.north + e.south) * INNER;
  };
  for (let s = minDist; s <= maxDist + 1e-6; s += 0.5) {
    if (fitsAt(all, s)) {
      const p = place(all, all, visibleExtents(s, aspect));
      return { x: p.x, y: p.y, dist: s, fits: true };
    }
  }
  // Too spread out: the largest set of players that fits at the max distance.
  const e = visibleExtents(maxDist, aspect);
  const owners = [...new Set(points.map((q, i) => q.owner ?? i))].sort((a, b) => a - b);
  const ownerOf = (q: FramePoint, i: number): number => q.owner ?? i;
  let best: { n: number; d: number; low: number; x: number; y: number } | null = null;
  const subsets = 1 << Math.min(owners.length, 8);
  for (let m = 1; m < subsets; m++) {
    const set = owners.filter((_, k) => m & (1 << k));
    const sub = bounds(points.filter((q, i) => set.includes(ownerOf(q, i))));
    if (!fitsAt(sub, maxDist)) continue;
    const p = place(sub, all, e);
    const ref = prev ?? { x: (all.minX + all.maxX) / 2, y: (all.minY + all.maxY) / 2 };
    const d = Math.hypot(p.x - ref.x, p.y - ref.y);
    const low = set[0];
    const better =
      !best ||
      set.length > best.n ||
      (set.length === best.n && (d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && low < best.low)));
    if (better) best = { n: set.length, d, low, x: p.x, y: p.y };
  }
  if (best) return { x: best.x, y: best.y, dist: maxDist, fits: false };
  // Not even one player fits (huge loot): the middle of everything.
  const p = place(all, all, e);
  return { x: p.x, y: p.y, dist: maxDist, fits: false };
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function bounds(points: readonly FramePoint[]): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const q of points) {
    b.minX = Math.min(b.minX, q.x - q.r);
    b.maxX = Math.max(b.maxX, q.x + q.r);
    b.minY = Math.min(b.minY, q.y - q.r);
    b.maxY = Math.max(b.maxY, q.y + q.r);
  }
  return b;
}

/**
 * Look-at point (the screen centre) that keeps `keep` inside the inner frame, as close to the
 * centre of `aim` as that allows (north shows more ground than south).
 */
function place(keep: Bounds, aim: Bounds, e: { half: number; north: number; south: number }): { x: number; y: number } {
  const hw = e.half * INNER;
  const n = e.north * INNER;
  const so = e.south * INNER;
  const clampTo = (v: number, lo: number, hi: number): number => (lo <= hi ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);
  // feasible tx: keep.maxX - tx <= hw and tx - keep.minX <= hw
  const x = clampTo((aim.minX + aim.maxX) / 2, keep.maxX - hw, keep.minX + hw);
  // feasible ty: keep.maxY - ty <= so and ty - keep.minY <= n
  const y = clampTo((aim.minY + aim.maxY) / 2, keep.maxY - so, keep.minY + n);
  return { x, y };
}
