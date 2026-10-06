/**
 * Spatial queries over the live simulation (used by rules, anti-pin, bots via Simulation).
 */
import { BANK_MODEL, CHARACTER } from './config';
import type { SimContext } from './context';
import { bankFootprint, bankWalls, lootOBBOf } from './actions';
import { circleOverlapsOBB, obbOverlap, pointInOBB, rayCircle, rayOBB } from './math';
import { SHAPE_CIRCLE, type StaticShape } from './physics';
import type { OBB, Vec2 } from './types';

export function staticToOBB(s: StaticShape): OBB {
  return { center: { x: s.x, y: s.y }, half: { x: s.hx, y: s.hy }, angle: Math.atan2(s.uy, s.ux) };
}

/** Line of sight: blocked by tall statics (buildings/walls/kiosks/vans/boundary) and bank walls. */
export function lineOfSight(ctx: SimContext, a: Vec2, b: Vec2): boolean {
  const dir = { x: b.x - a.x, y: b.y - a.y };
  const statics = ctx.physics.queryStatics(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  for (const s of statics) {
    if (!s.blocksLOS) continue;
    if (s.type === SHAPE_CIRCLE) {
      if (rayCircle(a, dir, { x: s.x, y: s.y }, s.r, 1) !== null) return false;
    } else if (rayOBB(a, dir, staticToOBB(s), 1) !== null) return false;
  }
  const st = ctx.state;
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.kind !== 'bank' || l.recovered) continue;
    const body = ctx.loot[i]!.body;
    if (rayOBB(a, dir, bankFootprint(body), 1) === null) continue;
    for (const w of bankWalls(body)) if (rayOBB(a, dir, w, 1) !== null) return false;
  }
  return true;
}

export interface FreeOptions {
  /** Also treat characters as obstacles (except this id). */
  characters?: boolean;
  ignoreCharId?: number;
  /** Ignore this loot id (the body being placed). */
  ignoreLootId?: number;
  /** Treat unrecovered bank footprints as solid (not only their walls). */
  bankFootprints?: boolean;
}

function insideArena(ctx: SimContext, minX: number, minY: number, maxX: number, maxY: number): boolean {
  const s = ctx.layout.size;
  return minX >= 0 && minY >= 0 && maxX <= s.x && maxY <= s.y;
}

/**
 * True if a circle at p fits: no overlap with enabled statics (incl. intact fences, vans,
 * boundary), bank walls, unrecovered safes (and optionally characters / bank footprints).
 */
export function isFreeCircle(ctx: SimContext, p: Vec2, radius: number, opt: FreeOptions = {}): boolean {
  if (!insideArena(ctx, p.x - radius, p.y - radius, p.x + radius, p.y + radius)) return false;
  for (const s of ctx.physics.queryStatics(p.x - radius, p.y - radius, p.x + radius, p.y + radius)) {
    if (!s.enabled) continue;
    if (s.type === SHAPE_CIRCLE) {
      if (Math.hypot(p.x - s.x, p.y - s.y) < s.r + radius) return false;
    } else if (circleOverlapsOBB(p, radius, staticToOBB(s))) return false;
  }
  const st = ctx.state;
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.recovered || l.id === opt.ignoreLootId) continue;
    const body = ctx.loot[i]!.body;
    if (Math.hypot(body.x - p.x, body.y - p.y) > radius + Math.hypot(l.half.x, l.half.y) + 0.01) continue;
    if (l.kind === 'bank') {
      if (opt.bankFootprints && pointInOBB(p, bankFootprint(body), radius)) return false;
      for (const w of bankWalls(body)) if (circleOverlapsOBB(p, radius, w)) return false;
    } else if (circleOverlapsOBB(p, radius, lootOBBOf(l, body))) return false;
  }
  if (opt.characters) {
    for (let i = 0; i < st.characters.length; i++) {
      const ch = st.characters[i]!;
      if (ch.id === opt.ignoreCharId) continue;
      const b = ctx.chars[i]!.body;
      if (Math.hypot(b.x - p.x, b.y - p.y) < radius + CHARACTER.radius) return false;
    }
  }
  return true;
}

/** Same as isFreeCircle for an oriented box (safe placement). */
export function isFreeOBB(ctx: SimContext, o: OBB, opt: FreeOptions = {}): boolean {
  const ext = Math.abs(Math.cos(o.angle)) * o.half.x + Math.abs(Math.sin(o.angle)) * o.half.y;
  const eyt = Math.abs(Math.sin(o.angle)) * o.half.x + Math.abs(Math.cos(o.angle)) * o.half.y;
  const c = o.center;
  if (!insideArena(ctx, c.x - ext, c.y - eyt, c.x + ext, c.y + eyt)) return false;
  for (const s of ctx.physics.queryStatics(c.x - ext, c.y - eyt, c.x + ext, c.y + eyt)) {
    if (!s.enabled) continue;
    if (s.type === SHAPE_CIRCLE) {
      if (circleOverlapsOBB({ x: s.x, y: s.y }, s.r, o)) return false;
    } else if (obbOverlap(o, staticToOBB(s))) return false;
  }
  const st = ctx.state;
  const rad = Math.hypot(o.half.x, o.half.y);
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.recovered || l.id === opt.ignoreLootId) continue;
    const body = ctx.loot[i]!.body;
    if (Math.hypot(body.x - c.x, body.y - c.y) > rad + Math.hypot(l.half.x, l.half.y) + 0.01) continue;
    if (l.kind === 'bank') {
      if (opt.bankFootprints && obbOverlap(o, bankFootprint(body))) return false;
      for (const w of bankWalls(body)) if (obbOverlap(o, w)) return false;
    } else if (obbOverlap(o, lootOBBOf(l, body))) return false;
  }
  if (opt.characters) {
    for (let i = 0; i < st.characters.length; i++) {
      const ch = st.characters[i]!;
      if (ch.id === opt.ignoreCharId) continue;
      const b = ctx.chars[i]!.body;
      if (circleOverlapsOBB({ x: b.x, y: b.y }, CHARACTER.radius, o)) return false;
    }
  }
  return true;
}

/**
 * Nearest free spot to `from` on rings of increasing radius (deterministic order).
 * `test` decides whether a candidate center is acceptable.
 */
export function spiralSearch(from: Vec2, test: (p: Vec2) => boolean, maxRadius = 12, step = 0.3): Vec2 | null {
  if (test(from)) return { x: from.x, y: from.y };
  for (let r = step; r <= maxRadius + 1e-9; r += step) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
      if (test(p)) return p;
    }
  }
  return null;
}

/**
 * Safe drop-off spot for a character on a bank that was just recovered (doc §8 회수 후):
 * just outside the nearest door first, then the other door, then anywhere around the footprint.
 */
export function ejectSpot(ctx: SimContext, bankPos: Vec2, bankAngle: number, from: Vec2, charId: number): Vec2 | null {
  const r = CHARACTER.radius;
  const c = Math.cos(bankAngle);
  const s = Math.sin(bankAngle);
  const test = (p: Vec2): boolean => isFreeCircle(ctx, p, r, { characters: true, ignoreCharId: charId, bankFootprints: true });
  const doors = BANK_MODEL.doors
    .map((d) => {
      const center = { x: bankPos.x + d.center.x * c - d.center.y * s, y: bankPos.y + d.center.x * s + d.center.y * c };
      const normal = { x: d.normal.x * c - d.normal.y * s, y: d.normal.x * s + d.normal.y * c };
      return { center, normal, dist: Math.hypot(center.x - from.x, center.y - from.y) };
    })
    .sort((a, b) => a.dist - b.dist);
  for (const d of doors) {
    const tx = -d.normal.y;
    const ty = d.normal.x;
    for (let out = 0.2 + r + 0.15; out <= 4; out += 0.5) {
      for (const lat of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const p = { x: d.center.x + d.normal.x * out + tx * lat, y: d.center.y + d.normal.y * out + ty * lat };
        if (test(p)) return p;
      }
    }
  }
  return spiralSearch(from, test, 20, 0.35);
}
