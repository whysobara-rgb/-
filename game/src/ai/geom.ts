/**
 * Small geometry helpers for bot motor skills (grab spots, bank faces, doors, zones).
 * All inputs are public state (loot poses, layout).
 */
import { BANK_MODEL, CHARACTER } from '../sim/config';
import type { LayoutDef, LootState, OBB, TeamId, Vec2 } from '../sim/types';

export const V = {
  len: (a: Vec2): number => Math.hypot(a.x, a.y),
  dist: (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y),
  sub: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y }),
  add: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y }),
  scale: (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s }),
  dot: (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y,
  norm(a: Vec2): Vec2 {
    const l = Math.hypot(a.x, a.y);
    return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
  },
  rot(a: Vec2, ang: number): Vec2 {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
  },
  toWorld(local: Vec2, pos: Vec2, ang: number): Vec2 {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: pos.x + local.x * c - local.y * s, y: pos.y + local.x * s + local.y * c };
  },
  toLocal(w: Vec2, pos: Vec2, ang: number): Vec2 {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const dx = w.x - pos.x;
    const dy = w.y - pos.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  },
  clampLen(a: Vec2, m: number): Vec2 {
    const l = Math.hypot(a.x, a.y);
    return l > m && l > 1e-9 ? { x: (a.x / l) * m, y: (a.y / l) * m } : { x: a.x, y: a.y };
  },
  angle: (a: Vec2): number => Math.atan2(a.y, a.x),
};

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Distance from the character center to a target surface when standing ready to grab. */
export const STAND_OFF = 0.72;
/** Max center-to-surface distance for a grab (sim reach). */
export const GRAB_REACH = CHARACTER.radius + CHARACTER.reach;

export interface GrabSpot {
  /** Face outward normal (world). */
  normal: Vec2;
  /** Anchor point on the target surface (world) and in the target's local frame. */
  anchor: Vec2;
  anchorLocal: Vec2;
  /** Where the character stands (world). */
  stand: Vec2;
  /** Face index (0:+x 1:-x 2:+y 3:-y). */
  face: number;
}

const FACE_NORMALS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** The four face-center grab spots of a safe. */
export function safeGrabSpots(l: LootState, standOff = STAND_OFF): GrabSpot[] {
  const out: GrabSpot[] = [];
  for (let f = 0; f < 4; f++) {
    const n = FACE_NORMALS[f]!;
    const anchorLocal = { x: n.x * l.half.x, y: n.y * l.half.y };
    const anchor = V.toWorld(anchorLocal, l.pos, l.angle);
    const normal = V.rot(n, l.angle);
    out.push({ normal, anchor, anchorLocal, stand: V.add(anchor, V.scale(normal, standOff)), face: f });
  }
  return out;
}

/**
 * Exterior wall grab spots of a bank. Side walls (local ±x) are solid: anchors at the center
 * (solo) and at ±1.5 m (pairs). Front/back walls (local ±y) have the door in the middle: anchors
 * at the jambs' outer halves (±2.4 m).
 */
export function bankGrabSpots(bank: LootState, standOff = STAND_OFF): (GrabSpot & { slotKey: string; solo: boolean })[] {
  const hx = BANK_MODEL.half.x;
  const hy = BANK_MODEL.half.y;
  const defs: { face: number; local: Vec2; solo: boolean; key: string }[] = [
    { face: 0, local: { x: hx, y: 0 }, solo: true, key: '0c' },
    { face: 0, local: { x: hx, y: 1.5 }, solo: false, key: '0p' },
    { face: 0, local: { x: hx, y: -1.5 }, solo: false, key: '0n' },
    { face: 1, local: { x: -hx, y: 0 }, solo: true, key: '1c' },
    { face: 1, local: { x: -hx, y: 1.5 }, solo: false, key: '1p' },
    { face: 1, local: { x: -hx, y: -1.5 }, solo: false, key: '1n' },
    { face: 2, local: { x: 2.4, y: hy }, solo: true, key: '2p' },
    { face: 2, local: { x: -2.4, y: hy }, solo: true, key: '2n' },
    { face: 3, local: { x: 2.4, y: -hy }, solo: true, key: '3p' },
    { face: 3, local: { x: -2.4, y: -hy }, solo: true, key: '3n' },
  ];
  return defs.map((d) => {
    const n = FACE_NORMALS[d.face]!;
    const anchor = V.toWorld(d.local, bank.pos, bank.angle);
    const normal = V.rot(n, bank.angle);
    return { normal, anchor, anchorLocal: d.local, stand: V.add(anchor, V.scale(normal, standOff)), face: d.face, slotKey: d.key, solo: d.solo };
  });
}

export interface DoorInfo {
  index: number;
  /** Door center on the wall line (world). */
  center: Vec2;
  /** Outward normal (world). */
  normal: Vec2;
}

export function bankDoors(bank: { pos: Vec2; angle: number }): DoorInfo[] {
  return BANK_MODEL.doors.map((d, index) => ({
    index,
    center: V.toWorld(d.center, bank.pos, bank.angle),
    normal: V.rot(d.normal, bank.angle),
  }));
}

export function zoneOf(layout: LayoutDef, team: TeamId): LayoutDef['zones'][number] {
  const z = layout.zones.find((zz) => zz.team === team);
  if (!z) throw new Error(`no zone for team ${team}`);
  return z;
}

export function zoneOBB(layout: LayoutDef, team: TeamId): OBB {
  const z = zoneOf(layout, team);
  return { center: z.center, half: z.half, angle: z.angle };
}

/** True if p lies inside the OBB shrunk by `inset`. */
export function insideOBB(p: Vec2, o: OBB, inset = 0): boolean {
  const l = V.toLocal(p, o.center, o.angle);
  return Math.abs(l.x) <= o.half.x - inset && Math.abs(l.y) <= o.half.y - inset;
}

/** True if a loot OBB is fully inside another OBB (with tolerance). */
export function obbInside(inner: OBB, outer: OBB, tol = 0): boolean {
  const c = Math.cos(inner.angle);
  const s = Math.sin(inner.angle);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const lx = sx * inner.half.x;
      const ly = sy * inner.half.y;
      const p = { x: inner.center.x + lx * c - ly * s, y: inner.center.y + lx * s + ly * c };
      const q = V.toLocal(p, outer.center, outer.angle);
      if (Math.abs(q.x) > outer.half.x + tol || Math.abs(q.y) > outer.half.y + tol) return false;
    }
  }
  return true;
}

/** Ray (origin, unit dir) vs OBB; entry distance or null. */
export function rayOBB(o: Vec2, d: Vec2, box: OBB, maxT: number): number | null {
  const lo = V.toLocal(o, box.center, box.angle);
  const ld = V.rot(d, -box.angle);
  let tmin = 0;
  let tmax = maxT;
  for (const ax of ['x', 'y'] as const) {
    const h = box.half[ax];
    if (Math.abs(ld[ax]) < 1e-9) {
      if (Math.abs(lo[ax]) > h) return null;
    } else {
      let t1 = (-h - lo[ax]) / ld[ax];
      let t2 = (h - lo[ax]) / ld[ax];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
