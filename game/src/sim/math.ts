/**
 * Layout-independent 2D geometry helpers used by the simulation, bots and tools.
 *
 * Everything here is pure and deterministic (no Math.random, no Date). Functions that
 * return vectors allocate small objects; the physics hot path uses its own inlined
 * arithmetic instead (see physics.ts), so these are meant for queries and tooling.
 */
import type { OBB, Vec2 } from './types';

export const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Vec2
// ---------------------------------------------------------------------------

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const vadd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const vscale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const vdot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D cross product (z component of a x b). */
export const vcross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const vlen = (a: Vec2): number => Math.hypot(a.x, a.y);
export const vlenSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const vdist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const vdistSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const vlerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const vclone = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });
export const vperp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function vnorm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > EPS ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Clamp a vector's length to at most `max`. */
export function vclampLen(a: Vec2, max: number): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > max && l > EPS ? { x: (a.x / l) * max, y: (a.y / l) * max } : { x: a.x, y: a.y };
}

export const vfromAngle = (angle: number, len = 1): Vec2 => ({ x: Math.cos(angle) * len, y: Math.sin(angle) * len });
export const vangle = (a: Vec2): number => Math.atan2(a.y, a.x);

/** Rotate `a` by `angle` radians. */
export function vrot(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Local -> world for a frame at (pos, angle). */
export function toWorld(local: Vec2, pos: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: pos.x + local.x * c - local.y * s, y: pos.y + local.x * s + local.y * c };
}

/** World -> local for a frame at (pos, angle). */
export function toLocal(world: Vec2, pos: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = world.x - pos.x;
  const dy = world.y - pos.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  if (a > -Math.PI && a <= Math.PI) return a;
  const twoPi = Math.PI * 2;
  a = a % twoPi;
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

/** Smallest absolute difference between two angles. */
export const angleDiff = (a: number, b: number): number => Math.abs(wrapAngle(a - b));

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export const isFiniteVec = (a: Vec2): boolean => Number.isFinite(a.x) && Number.isFinite(a.y);

// ---------------------------------------------------------------------------
// OBB
// ---------------------------------------------------------------------------

export function makeOBB(center: Vec2, half: Vec2, angle: number): OBB {
  return { center: { x: center.x, y: center.y }, half: { x: half.x, y: half.y }, angle };
}

/** Corners in CCW order (local (+,+), (-,+), (-,-), (+,-)). */
export function obbCorners(o: OBB): Vec2[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const ux = c * o.half.x;
  const uy = s * o.half.x;
  const vx = -s * o.half.y;
  const vy = c * o.half.y;
  const cx = o.center.x;
  const cy = o.center.y;
  return [
    { x: cx + ux + vx, y: cy + uy + vy },
    { x: cx - ux + vx, y: cy - uy + vy },
    { x: cx - ux - vx, y: cy - uy - vy },
    { x: cx + ux - vx, y: cy + uy - vy },
  ];
}

/** Axis-aligned bounds of an OBB. */
export function obbAABB(o: OBB): { minX: number; minY: number; maxX: number; maxY: number } {
  const c = Math.abs(Math.cos(o.angle));
  const s = Math.abs(Math.sin(o.angle));
  const ex = c * o.half.x + s * o.half.y;
  const ey = s * o.half.x + c * o.half.y;
  return { minX: o.center.x - ex, minY: o.center.y - ey, maxX: o.center.x + ex, maxY: o.center.y + ey };
}

/** True if p lies inside (or within `margin` of) the OBB. */
export function pointInOBB(p: Vec2, o: OBB, margin = 0): boolean {
  const l = toLocal(p, o.center, o.angle);
  return Math.abs(l.x) <= o.half.x + margin && Math.abs(l.y) <= o.half.y + margin;
}

/** True if every corner of `inner` lies inside `outer` (with `tolerance` slack). */
export function obbInsideOBB(inner: OBB, outer: OBB, tolerance = 1e-6): boolean {
  const c = Math.cos(outer.angle);
  const s = Math.sin(outer.angle);
  const ic = Math.cos(inner.angle);
  const is = Math.sin(inner.angle);
  for (let i = 0; i < 4; i++) {
    const sx = i === 0 || i === 3 ? 1 : -1;
    const sy = i < 2 ? 1 : -1;
    const lx = sx * inner.half.x;
    const ly = sy * inner.half.y;
    const wx = inner.center.x + lx * ic - ly * is - outer.center.x;
    const wy = inner.center.y + lx * is + ly * ic - outer.center.y;
    const ox = wx * c + wy * s;
    const oy = -wx * s + wy * c;
    if (Math.abs(ox) > outer.half.x + tolerance || Math.abs(oy) > outer.half.y + tolerance) return false;
  }
  return true;
}

/** Closest point on (or in) the OBB to p. Returns p itself when p is inside. */
export function closestPointOnOBB(p: Vec2, o: OBB): Vec2 {
  const l = toLocal(p, o.center, o.angle);
  return toWorld({ x: clamp(l.x, -o.half.x, o.half.x), y: clamp(l.y, -o.half.y, o.half.y) }, o.center, o.angle);
}

/** Closest point on the OBB boundary to p (also when p is inside). */
export function closestPointOnOBBBoundary(p: Vec2, o: OBB): Vec2 {
  const l = toLocal(p, o.center, o.angle);
  let x = clamp(l.x, -o.half.x, o.half.x);
  let y = clamp(l.y, -o.half.y, o.half.y);
  if (Math.abs(l.x) <= o.half.x && Math.abs(l.y) <= o.half.y) {
    const dx = o.half.x - Math.abs(l.x);
    const dy = o.half.y - Math.abs(l.y);
    if (dx < dy) x = l.x >= 0 ? o.half.x : -o.half.x;
    else y = l.y >= 0 ? o.half.y : -o.half.y;
  }
  return toWorld({ x, y }, o.center, o.angle);
}

/** Distance from p to the OBB (0 when inside). */
export function distancePointOBB(p: Vec2, o: OBB): number {
  return vdist(p, closestPointOnOBB(p, o));
}

/**
 * Ray / segment vs OBB (slab test in the box frame).
 * Returns the entry parameter t in [0, maxT] along `dir` (not necessarily unit length),
 * or null when there is no hit. A ray starting inside the box returns 0.
 */
export function rayOBB(origin: Vec2, dir: Vec2, o: OBB, maxT: number): number | null {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = origin.x - o.center.x;
  const dy = origin.y - o.center.y;
  const ox = dx * c + dy * s;
  const oy = -dx * s + dy * c;
  const rx = dir.x * c + dir.y * s;
  const ry = -dir.x * s + dir.y * c;
  let tmin = 0;
  let tmax = maxT;
  // x slab
  if (Math.abs(rx) < EPS) {
    if (Math.abs(ox) > o.half.x) return null;
  } else {
    let t1 = (-o.half.x - ox) / rx;
    let t2 = (o.half.x - ox) / rx;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // y slab
  if (Math.abs(ry) < EPS) {
    if (Math.abs(oy) > o.half.y) return null;
  } else {
    let t1 = (-o.half.y - oy) / ry;
    let t2 = (o.half.y - oy) / ry;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** True if segment a-b intersects the OBB (touching counts). */
export function segmentIntersectsOBB(a: Vec2, b: Vec2, o: OBB): boolean {
  return rayOBB(a, { x: b.x - a.x, y: b.y - a.y }, o, 1) !== null;
}

/** Ray vs circle: first t in [0, maxT] where |origin + dir*t - center| = r, or null. 0 when starting inside. */
export function rayCircle(origin: Vec2, dir: Vec2, center: Vec2, r: number, maxT: number): number | null {
  const fx = origin.x - center.x;
  const fy = origin.y - center.y;
  const cc = fx * fx + fy * fy - r * r;
  if (cc <= 0) return 0;
  const a = dir.x * dir.x + dir.y * dir.y;
  if (a < EPS) return null;
  const b = fx * dir.x + fy * dir.y;
  const disc = b * b - a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= maxT ? t : null;
}

export function segmentIntersectsCircle(a: Vec2, b: Vec2, center: Vec2, r: number): boolean {
  return rayCircle(a, { x: b.x - a.x, y: b.y - a.y }, center, r, 1) !== null;
}

/** Closest point on segment a-b to p. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < EPS) return { x: a.x, y: a.y };
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1);
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** True if circle overlaps the OBB by more than `slop` (penetration depth > slop). */
export function circleOverlapsOBB(center: Vec2, r: number, o: OBB, slop = 0): boolean {
  const l = toLocal(center, o.center, o.angle);
  const qx = clamp(l.x, -o.half.x, o.half.x);
  const qy = clamp(l.y, -o.half.y, o.half.y);
  const dx = l.x - qx;
  const dy = l.y - qy;
  const rr = r - slop;
  if (rr <= 0) return false;
  return dx * dx + dy * dy < rr * rr;
}

/** Separating-axis test between two OBBs. Returns true if they overlap by more than `slop`. */
export function obbOverlap(a: OBB, b: OBB, slop = 0): boolean {
  const ac = Math.cos(a.angle);
  const as = Math.sin(a.angle);
  const bc = Math.cos(b.angle);
  const bs = Math.sin(b.angle);
  const axes = [
    [ac, as],
    [-as, ac],
    [bc, bs],
    [-bs, bc],
  ];
  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  for (const [nx, ny] of axes) {
    const ra = a.half.x * Math.abs(ac * nx + as * ny) + a.half.y * Math.abs(-as * nx + ac * ny);
    const rb = b.half.x * Math.abs(bc * nx + bs * ny) + b.half.y * Math.abs(-bs * nx + bc * ny);
    const d = Math.abs(dx * nx + dy * ny);
    if (d >= ra + rb - slop) return false;
  }
  return true;
}

/** OBB vs circle overlap (penetration > slop). */
export function obbOverlapsCircle(o: OBB, center: Vec2, r: number, slop = 0): boolean {
  return circleOverlapsOBB(center, r, o, slop);
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (for bots / tools / tests; the sim core itself needs no randomness)
// ---------------------------------------------------------------------------

/** mulberry32: small, fast, deterministic 32-bit PRNG. Returns floats in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
