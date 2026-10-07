/**
 * Sim -> render state sync: per-entity previous/current poses captured after every sim tick,
 * blended with the frame's alpha (fixed 60 Hz sim, variable render rate).
 *
 *  - Angles blend along the shortest arc.
 *  - A jump of more than SNAP_DISTANCE per tick (ejections from a recovered bank, unstuck
 *    teleports, debug teleports) snaps instead of sliding across the map.
 *  - Floor heights (riders and safes on a bank floor are raised by BANK_FLOOR_Y) are smoothed
 *    per frame so crossing the door threshold never pops.
 */
import type { EntityId, Simulation, Vec2 } from '../sim';
import { BANK_MODEL } from '../sim';

/** Per-tick travel (m) above which an entity is snapped rather than interpolated. */
export const SNAP_DISTANCE = 2;

export interface Pose2 {
  x: number;
  y: number;
  a: number;
}

interface Entry {
  prev: Pose2;
  curr: Pose2;
  /** Tick of the last capture that saw this entity. */
  tick: number;
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Pose store for characters (facing) and loot (body angle). */
export class PoseBuffer {
  private readonly map = new Map<EntityId, Entry>();

  clear(): void {
    this.map.clear();
  }

  /** Store the latest sim state; previous = last capture. */
  capture(sim: Simulation): void {
    const st = sim.state;
    for (const c of st.characters) this.put(c.id, c.pos.x, c.pos.y, c.facing, st.tick);
    for (const l of st.loot) if (!l.recovered) this.put(l.id, l.pos.x, l.pos.y, l.angle, st.tick);
  }

  /** Make the entity jump to its current pose (no slide from the previous one). */
  snap(id: EntityId): void {
    const e = this.map.get(id);
    if (e) copyPose(e.prev, e.curr);
  }

  has(id: EntityId): boolean {
    return this.map.has(id);
  }

  /** Interpolated pose; falls back to `fallback` (live sim values) if never captured. */
  sample(id: EntityId, alpha: number, out: Pose2, fallback?: { pos: Vec2; angle: number }): Pose2 {
    const e = this.map.get(id);
    if (!e) {
      if (fallback) {
        out.x = fallback.pos.x;
        out.y = fallback.pos.y;
        out.a = fallback.angle;
      }
      return out;
    }
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    out.x = e.prev.x + (e.curr.x - e.prev.x) * t;
    out.y = e.prev.y + (e.curr.y - e.prev.y) * t;
    out.a = lerpAngle(e.prev.a, e.curr.a, t);
    return out;
  }

  /** Current (latest captured) pose. */
  current(id: EntityId): Pose2 | null {
    return this.map.get(id)?.curr ?? null;
  }

  private put(id: EntityId, x: number, y: number, a: number, tick: number): void {
    let e = this.map.get(id);
    if (!e) {
      e = { prev: { x, y, a }, curr: { x, y, a }, tick };
      this.map.set(id, e);
      return;
    }
    if (tick === e.tick) {
      // Same tick captured twice (e.g. paused): keep prev, refresh curr.
      e.curr.x = x;
      e.curr.y = y;
      e.curr.a = a;
      return;
    }
    copyPose(e.prev, e.curr);
    e.curr.x = x;
    e.curr.y = y;
    e.curr.a = a;
    const ticks = Math.max(1, tick - e.tick);
    e.tick = tick;
    if (Math.hypot(x - e.prev.x, y - e.prev.y) > SNAP_DISTANCE * ticks) copyPose(e.prev, e.curr);
  }
}

function copyPose(dst: Pose2, src: Pose2): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.a = src.a;
}

/** Exponential smoothing factor for a rate (1/s) over dt seconds. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * Math.max(0, dt));
}

/** Point inside an oriented rectangle (center, half extents, angle) with an optional margin. */
export function insideRect(p: Vec2, center: Vec2, half: Vec2, angle: number, margin = 0): boolean {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) <= half.x + margin && Math.abs(ly) <= half.y + margin;
}

/** World point -> bank-local (sim frame). */
export function toLocal(p: Vec2, center: Vec2, angle: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.x = dx * c + dy * s;
  out.y = -dx * s + dy * c;
  return out;
}

/** True if a point (sim) stands on the visual slab of a bank (footprint + rim). */
export function onBankSlab(p: Vec2, bankPos: Vec2, bankAngle: number): boolean {
  return insideRect(p, bankPos, BANK_MODEL.half, bankAngle, 0.15);
}

/** Velocity of a point riding a rigid body (v + w x r). */
export function pointVelocity(bodyPos: Vec2, vel: Vec2, angVel: number, p: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const rx = p.x - bodyPos.x;
  const ry = p.y - bodyPos.y;
  out.x = vel.x - angVel * ry;
  out.y = vel.y + angVel * rx;
  return out;
}
