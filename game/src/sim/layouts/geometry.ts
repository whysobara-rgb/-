/**
 * Small, dependency-free 2D geometry helpers used by the layout builder,
 * the layout validator and the layout tools. Kept separate from the sim core
 * so level validation never depends on the physics implementation.
 */
import type { OBB, Vec2 } from '../types';

export const EPS = 1e-6;

export function v(x: number, y: number): Vec2 {
  return { x, y };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Normalizes an angle to (-PI, PI]. */
export function normAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
}

/** Mirror of a point across the vertical line x = axisX. */
export function mirrorPoint(p: Vec2, axisX: number): Vec2 {
  return { x: 2 * axisX - p.x, y: p.y };
}

/** Mirror of a heading/rotation across a vertical line: theta -> PI - theta. */
export function mirrorAngle(a: number): number {
  return normAngle(Math.PI - a);
}

/** True if `a` is a multiple of `step` (within tolerance). */
export function isMultipleOf(a: number, step: number, tol = 1e-6): boolean {
  const k = Math.round(a / step);
  return Math.abs(a - k * step) < tol;
}

/** World-space corners of an oriented box, counter-clockwise in local frame. */
export function obbCorners(o: OBB): Vec2[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const out: Vec2[] = [];
  const signs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sy] of signs) {
    const lx = sx * o.half.x;
    const ly = sy * o.half.y;
    out.push({ x: o.center.x + lx * c - ly * s, y: o.center.y + lx * s + ly * c });
  }
  return out;
}

/** Converts a world point into the box's local frame. */
export function toLocal(o: OBB, p: Vec2): Vec2 {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = p.x - o.center.x;
  const dy = p.y - o.center.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Converts a local point of the box to world space. */
export function toWorld(o: OBB, p: Vec2): Vec2 {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return { x: o.center.x + p.x * c - p.y * s, y: o.center.y + p.x * s + p.y * c };
}

/**
 * Signed distance from a point to an oriented box: negative inside,
 * positive outside (Euclidean distance to the surface).
 */
export function sdOBB(o: OBB, p: Vec2): number {
  const l = toLocal(o, p);
  const qx = Math.abs(l.x) - o.half.x;
  const qy = Math.abs(l.y) - o.half.y;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0);
}

export function sdCircle(center: Vec2, radius: number, p: Vec2): number {
  return dist(center, p) - radius;
}

/** Axis-aligned bounding box of an OBB. */
export function obbAabb(o: OBB): { minX: number; minY: number; maxX: number; maxY: number } {
  const c = Math.abs(Math.cos(o.angle));
  const s = Math.abs(Math.sin(o.angle));
  const ex = o.half.x * c + o.half.y * s;
  const ey = o.half.x * s + o.half.y * c;
  return { minX: o.center.x - ex, minY: o.center.y - ey, maxX: o.center.x + ex, maxY: o.center.y + ey };
}

/** Separating-axis overlap test between two OBBs. `margin` inflates both boxes. */
export function obbOverlap(a: OBB, b: OBB, margin = 0): boolean {
  const axes: Vec2[] = [];
  for (const o of [a, b]) {
    axes.push({ x: Math.cos(o.angle), y: Math.sin(o.angle) });
    axes.push({ x: -Math.sin(o.angle), y: Math.cos(o.angle) });
  }
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  for (const ax of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const p of ca) {
      const d = p.x * ax.x + p.y * ax.y;
      minA = Math.min(minA, d);
      maxA = Math.max(maxA, d);
    }
    for (const p of cb) {
      const d = p.x * ax.x + p.y * ax.y;
      minB = Math.min(minB, d);
      maxB = Math.max(maxB, d);
    }
    if (maxA + margin <= minB - EPS || maxB + margin <= minA - EPS) return false;
  }
  return true;
}

/** True if every corner of `inner` lies inside `outer` (shrunk by `margin`). */
export function obbInside(inner: OBB, outer: OBB, margin = 0): boolean {
  for (const p of obbCorners(inner)) {
    if (sdOBB(outer, p) > -margin + EPS) return false;
  }
  return true;
}

/** Length of a polyline. */
export function polylineLength(pts: ReadonlyArray<Vec2>): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

/** Points along a polyline every `step` meters (always includes both ends). */
export function samplePolyline(pts: ReadonlyArray<Vec2>, step: number): Vec2[] {
  const out: Vec2[] = [];
  if (pts.length === 0) return out;
  out.push({ ...pts[0] });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = dist(a, b);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Distance from point p to segment ab. */
export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < EPS) return dist(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Distance from p to the nearest point of a polyline. */
export function distPointPolyline(p: Vec2, pts: ReadonlyArray<Vec2>): number {
  if (pts.length === 1) return dist(p, pts[0]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distPointSegment(p, pts[i - 1], pts[i]));
  return best;
}
