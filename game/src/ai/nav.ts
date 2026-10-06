/**
 * Bot navigation (doc §16 "봇 이동: 검수된 배치의 금고 경로와 은행 경로, 막힘 시 재탐색·근거리 회피").
 *
 * A 0.5 m clearance grid shared by every bot of one Simulation:
 *  - static layer: exact distance from each cell center to the nearest static collider
 *    (boundary, buildings, planters, kiosks, benches, trees, lamps, vans), computed once;
 *  - dynamic layer: intact fences + the walls of every unrecovered bank at its CURRENT pose
 *    (re-stamped every few ticks while banks move, door corridors kept open so bank interiors
 *    are walkable through the doors), rebuilt when a fence breaks or a bank is recovered.
 *
 * Clearance classes: a cell is passable for class c when its clearance >= NAV_CLEARANCE[c]:
 *  walk (character body), small (character pulling a small safe; same 1.1 m alleys),
 *  large (character pulling a large safe; only the >= 2 m lanes, never the 1.1 m alleys).
 * Banks never use the grid: they follow the curated layout.bankRoutes.
 *
 * Searches: A* (octile heuristic, lane-centering cost, optional per-bot trail discount) with
 * line-of-sight smoothing on the bilinear clearance field, and multi-source Dijkstra fields
 * (zone carry distances per team/class, cached and refreshed lazily; walk fields from a bot).
 * Everything is deterministic and allocation-light (typed arrays, reusable heap).
 */
import type { Simulation } from '../sim/sim';
import { BANK_MODEL } from '../sim/config';
import type { OBB, TeamId, Vec2 } from '../sim/types';

export const NAV_CELL = 0.5;
export type NavClass = 'walk' | 'small' | 'large';
export const NAV_CLASSES: readonly NavClass[] = ['walk', 'small', 'large'];

/** Required clearance (m) from a cell center to the nearest obstacle, per class. */
export const NAV_CLEARANCE: Readonly<Record<NavClass, number>> = {
  walk: 0.46,
  small: 0.5,
  // A large safe trailing a raccoon is 1.2-1.4 m wide (aligned) and needs the 2 m+ lanes; the
  // 1.1 m alleys (0.55 m) must stay closed. Bank doors are opened explicitly (door corridors).
  large: 0.8,
};

/**
 * Required distance from a cell center to the nearest ANCHORED safe, per class. Anchored safes
 * are immovable until someone unanchors them; a carried large safe trails aligned (1.2 m wide),
 * so it squeezes past a small safe through a 1.6 m gap that the conservative free-rotation
 * radius above would reject.
 */
export const NAV_SAFE_CLEARANCE: Readonly<Record<NavClass, number>> = {
  walk: 0.46,
  small: 0.5,
  large: 0.55,
};

/** Large-class step cost added within this distance of an anchored safe (tight squeeze). */
const SQUEEZE_SAFE_DIST = 0.85;
const SQUEEZE_COST = 4;
/** Distances are capped here (enough for lane-centering costs). */
const CAP = 3;
/** Lane-centering: extra cost per meter when clearance < r + CENTER_BAND. */
const CENTER_BAND = 0.6;
const CENTER_WEIGHT = 0.35;
const SQRT2 = Math.SQRT2;

/** Signed distance from p to an OBB (negative inside). */
export function sdOBB(o: OBB, px: number, py: number): number {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = px - o.center.x;
  const dy = py - o.center.y;
  const lx = Math.abs(dx * c + dy * s) - o.half.x;
  const ly = Math.abs(-dx * s + dy * c) - o.half.y;
  const ox = lx > 0 ? lx : 0;
  const oy = ly > 0 ? ly : 0;
  const outside = Math.sqrt(ox * ox + oy * oy);
  const inside = Math.min(Math.max(lx, ly), 0);
  return outside + inside;
}

function obbBounds(o: OBB): { minX: number; minY: number; maxX: number; maxY: number } {
  const c = Math.abs(Math.cos(o.angle));
  const s = Math.abs(Math.sin(o.angle));
  const ex = c * o.half.x + s * o.half.y;
  const ey = s * o.half.x + c * o.half.y;
  return { minX: o.center.x - ex, minY: o.center.y - ey, maxX: o.center.x + ex, maxY: o.center.y + ey };
}

/** Binary min-heap over (int key, float priority) with lazy duplicates. */
class Heap {
  private keys = new Int32Array(1024);
  private pri = new Float64Array(1024);
  size = 0;
  clear(): void {
    this.size = 0;
  }
  push(k: number, p: number): void {
    if (this.size >= this.keys.length) {
      const nk = new Int32Array(this.keys.length * 2);
      nk.set(this.keys);
      const np = new Float64Array(this.pri.length * 2);
      np.set(this.pri);
      this.keys = nk;
      this.pri = np;
    }
    const keys = this.keys;
    const pri = this.pri;
    let i = this.size++;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (pri[par]! <= p) break;
      keys[i] = keys[par]!;
      pri[i] = pri[par]!;
      i = par;
    }
    keys[i] = k;
    pri[i] = p;
  }
  /** Pops the min key; its priority is left in `lastPri`. */
  lastPri = 0;
  pop(): number {
    const keys = this.keys;
    const pri = this.pri;
    const top = keys[0]!;
    this.lastPri = pri[0]!;
    const n = --this.size;
    if (n > 0) {
      const k = keys[n]!;
      const p = pri[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && pri[r]! < pri[l]! ? r : l;
        if (pri[m]! >= p) break;
        keys[i] = keys[m]!;
        pri[i] = pri[m]!;
        i = m;
      }
      keys[i] = k;
      pri[i] = p;
    }
    return top;
  }
}

export interface PathOptions {
  /** Max node expansions (search budget); null result when exceeded. */
  maxExpand?: number;
  /** Per-cell cost multiplier discount in [0, 1) (e.g. a favourite-route trail), index = cell. */
  discount?: Float32Array | null;
  /** Extra cost circles (soft avoidance of threats / crowds). */
  avoid?: ReadonlyArray<{ x: number; y: number; r: number; cost: number }>;
  /** Accept any cell within this distance of the goal (m). */
  goalRadius?: number;
  /** Extra clearance the smoothed segments keep (m; a trailing object cuts corners). */
  smoothMargin?: number;
}

export interface PathResult {
  points: Vec2[];
  /** Path length along the smoothed polyline (m). */
  length: number;
  /** Goal was unreachable; the path ends at the closest reachable cell instead. */
  partial: boolean;
}

interface ZoneField {
  dist: Float64Array;
  version: number;
  tick: number;
}

/**
 * A distance field computed over several ticks (time-sliced Dijkstra), so a refresh never
 * costs a whole full-grid search inside one frame. The previous field stays in use meanwhile.
 */
export class FieldJob {
  readonly heap = new Heap();
  done = false;
  /** Set when the result was taken by its owner. */
  consumed = false;
  constructor(
    readonly dist: Float64Array,
    readonly cls: NavClass,
    /** dynVersion / tick when the job started (the result describes that moment). */
    readonly version: number,
    readonly tick: number,
    /** Free-form owner data (e.g. the origin of a walk field). */
    readonly origin: Vec2 | null,
  ) {}
}

/** Dijkstra pops per tick shared by all background field jobs of one grid (~0.3-0.5 ms). */
const FIELD_POPS_PER_TICK = 3500;
/** A* expansions per tick (all bots) before non-urgent re-paths wait for the next tick. */
export const ASTAR_TICK_BUDGET = 9000;

/**
 * Shared navigation grid of one Simulation. Obtain with `NavGrid.for(sim)`.
 */
export class NavGrid {
  private static readonly cache = new WeakMap<Simulation, NavGrid>();
  static for(sim: Simulation): NavGrid {
    let g = NavGrid.cache.get(sim);
    if (!g) {
      g = new NavGrid(sim);
      NavGrid.cache.set(sim, g);
    }
    return g;
  }

  readonly nx: number;
  readonly ny: number;
  readonly n: number;
  readonly staticDist: Float32Array;
  readonly dynDist: Float32Array;
  /** min(staticDist, dynDist): statics, intact fences, bank walls (not safes), kept current. */
  readonly clear: Float32Array;
  /** Distance to the nearest anchored safe (capped). */
  readonly safeDist: Float32Array;
  /** min(clear, safeDist): overall clearance (costs, local checks). */
  readonly eff: Float32Array;
  /** Per-class passability (clear >= NAV_CLEARANCE and safeDist >= NAV_SAFE_CLEARANCE). */
  private readonly masks: Record<NavClass, Uint8Array>;
  /** Incremented whenever the dynamic layer changes. */
  dynVersion = 0;
  lastStampTick = -1;

  private readonly heap = new Heap();
  private readonly nbOff = new Int32Array(8);
  private readonly gScore: Float64Array;
  private readonly came: Int32Array;
  private readonly stamp: Uint32Array;
  private epoch = 0;
  private readonly bankPose = new Map<number, { x: number; y: number; a: number; recovered: boolean }>();
  private fenceBroken: boolean[] = [];
  private safeSig = 0;
  private readonly zoneFields = new Map<string, ZoneField>();
  private readonly zoneJobs = new Map<string, FieldJob>();
  private readonly spareFields = new Map<string, Float64Array>();
  private readonly jobs: FieldJob[] = [];
  private serviceTick = -1;
  private astarTick = -1;
  private astarSpent = 0;
  /** Instrumentation (tools). */
  stats = { astar: 0, astarExpanded: 0, dijkstra: 0, restamps: 0 };

  private constructor(private readonly sim: Simulation) {
    const size = sim.layout.size;
    this.nx = Math.round(size.x / NAV_CELL) + 1;
    this.ny = Math.round(size.y / NAV_CELL) + 1;
    this.n = this.nx * this.ny;
    this.staticDist = new Float32Array(this.n);
    this.dynDist = new Float32Array(this.n).fill(CAP);
    this.clear = new Float32Array(this.n);
    this.safeDist = new Float32Array(this.n).fill(CAP);
    this.eff = new Float32Array(this.n);
    this.masks = { walk: new Uint8Array(this.n), small: new Uint8Array(this.n), large: new Uint8Array(this.n) };
    this.gScore = new Float64Array(this.n);
    this.came = new Int32Array(this.n);
    this.stamp = new Uint32Array(this.n);
    // boundary distance
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = i * NAV_CELL;
        const y = j * NAV_CELL;
        this.staticDist[j * this.nx + i] = Math.min(CAP, x, y, size.x - x, size.y - y);
      }
    }
    for (const o of sim.staticOBBs()) this.stampOBB(this.staticDist, o);
    for (const c of sim.staticCircles()) this.stampCircle(this.staticDist, c.center, c.radius);
    this.update(sim, true);
    // warm the hot loops up while the match loads (the first in-match re-stamp / re-label would
    // otherwise run unoptimized: a one-off 10-20 ms hitch)
    for (let r = 0; r < 3; r++) {
      this.restamp(sim);
      for (const c of NAV_CLASSES) {
        this.labelCache.delete(c);
        this.labels(c);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Grid basics
  // -------------------------------------------------------------------------

  idx(i: number, j: number): number {
    return j * this.nx + i;
  }
  cellX(k: number): number {
    return (k % this.nx) * NAV_CELL;
  }
  cellY(k: number): number {
    return Math.floor(k / this.nx) * NAV_CELL;
  }
  cellAt(x: number, y: number): number {
    let i = Math.round(x / NAV_CELL);
    let j = Math.round(y / NAV_CELL);
    if (i < 0) i = 0;
    else if (i >= this.nx) i = this.nx - 1;
    if (j < 0) j = 0;
    else if (j >= this.ny) j = this.ny - 1;
    return j * this.nx + i;
  }

  /** Bilinear clearance at a world point. */
  clearanceAt(x: number, y: number): number {
    const fx = x / NAV_CELL;
    const fy = y / NAV_CELL;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i < 0) i = 0;
    else if (i > this.nx - 2) i = this.nx - 2;
    if (j < 0) j = 0;
    else if (j > this.ny - 2) j = this.ny - 2;
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const k = j * this.nx + i;
    const c = this.eff;
    const a = c[k]! * (1 - tx) + c[k + 1]! * tx;
    const b = c[k + this.nx]! * (1 - tx) + c[k + this.nx + 1]! * tx;
    return a * (1 - ty) + b * ty;
  }

  /** Bilinear sample of a field. */
  private sample(c: Float32Array, x: number, y: number): number {
    const fx = x / NAV_CELL;
    const fy = y / NAV_CELL;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i < 0) i = 0;
    else if (i > this.nx - 2) i = this.nx - 2;
    if (j < 0) j = 0;
    else if (j > this.ny - 2) j = this.ny - 2;
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const k = j * this.nx + i;
    const a = c[k]! * (1 - tx) + c[k + 1]! * tx;
    const b = c[k + this.nx]! * (1 - tx) + c[k + this.nx + 1]! * tx;
    return a * (1 - ty) + b * ty;
  }

  /** True if a point keeps the class clearances (walls and anchored safes). */
  pointClear(x: number, y: number, cls: NavClass, margin = 0): boolean {
    return this.sample(this.clear, x, y) >= NAV_CLEARANCE[cls] + margin && this.sample(this.safeDist, x, y) >= NAV_SAFE_CLEARANCE[cls] + margin;
  }

  passable(k: number, cls: NavClass): boolean {
    return this.masks[cls][k] === 1;
  }

  isFreeAt(p: Vec2, cls: NavClass, margin = 0): boolean {
    return this.pointClear(p.x, p.y, cls, margin);
  }

  /** True if the straight segment a->b keeps the class clearances (+margin) everywhere (sampled). */
  segmentClear(a: Vec2, b: Vec2, cls: NavClass, margin = 0.03): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 0.2));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.pointClear(a.x + dx * t, a.y + dy * t, cls, margin)) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Stamping
  // -------------------------------------------------------------------------

  private stampOBB(field: Float32Array, o: OBB): void {
    const bb = obbBounds(o);
    const i0 = Math.max(0, Math.floor((bb.minX - CAP) / NAV_CELL));
    const i1 = Math.min(this.nx - 1, Math.ceil((bb.maxX + CAP) / NAV_CELL));
    const j0 = Math.max(0, Math.floor((bb.minY - CAP) / NAV_CELL));
    const j1 = Math.min(this.ny - 1, Math.ceil((bb.maxY + CAP) / NAV_CELL));
    for (let j = j0; j <= j1; j++) {
      const y = j * NAV_CELL;
      for (let i = i0; i <= i1; i++) {
        const d = sdOBB(o, i * NAV_CELL, y);
        const k = j * this.nx + i;
        const v = d > 0 ? d : 0;
        if (v < field[k]!) field[k] = v;
      }
    }
  }

  private stampCircle(field: Float32Array, c: Vec2, r: number): void {
    const i0 = Math.max(0, Math.floor((c.x - r - CAP) / NAV_CELL));
    const i1 = Math.min(this.nx - 1, Math.ceil((c.x + r + CAP) / NAV_CELL));
    const j0 = Math.max(0, Math.floor((c.y - r - CAP) / NAV_CELL));
    const j1 = Math.min(this.ny - 1, Math.ceil((c.y + r + CAP) / NAV_CELL));
    for (let j = j0; j <= j1; j++) {
      const dy = j * NAV_CELL - c.y;
      for (let i = i0; i <= i1; i++) {
        const dx = i * NAV_CELL - c.x;
        const d = Math.sqrt(dx * dx + dy * dy) - r;
        const k = j * this.nx + i;
        const v = d > 0 ? d : 0;
        if (v < field[k]!) field[k] = v;
      }
    }
  }

  private clearMaskInOBB(mask: Uint8Array, o: OBB): void {
    const bb = obbBounds(o);
    const i0 = Math.max(0, Math.floor(bb.minX / NAV_CELL));
    const i1 = Math.min(this.nx - 1, Math.ceil(bb.maxX / NAV_CELL));
    const j0 = Math.max(0, Math.floor(bb.minY / NAV_CELL));
    const j1 = Math.min(this.ny - 1, Math.ceil(bb.maxY / NAV_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (sdOBB(o, i * NAV_CELL, j * NAV_CELL) <= 0) mask[j * this.nx + i] = 0;
      }
    }
  }

  /** Keep the door corridors of a bank open (clearance = true half door width). */
  private openDoors(field: Float32Array, pos: Vec2, angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const half = BANK_MODEL.doorWidth / 2;
    for (const d of BANK_MODEL.doors) {
      const cx = pos.x + d.center.x * c - d.center.y * s;
      const cy = pos.y + d.center.x * s + d.center.y * c;
      const nx = d.normal.x * c - d.normal.y * s;
      const ny = d.normal.x * s + d.normal.y * c;
      const ext = 1.4;
      const i0 = Math.max(0, Math.floor((cx - ext) / NAV_CELL));
      const i1 = Math.min(this.nx - 1, Math.ceil((cx + ext) / NAV_CELL));
      const j0 = Math.max(0, Math.floor((cy - ext) / NAV_CELL));
      const j1 = Math.min(this.ny - 1, Math.ceil((cy + ext) / NAV_CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = i * NAV_CELL - cx;
          const dy = j * NAV_CELL - cy;
          const along = dx * nx + dy * ny; // across the wall
          const lat = Math.abs(-dx * ny + dy * nx); // along the wall
          if (Math.abs(along) > 1.2 || lat > 0.4) continue;
          const k = j * this.nx + i;
          const v = half - lat;
          if (v > field[k]!) field[k] = Math.min(v, CAP);
        }
      }
    }
  }

  /**
   * Refresh the dynamic layer when banks moved / fences broke / banks were recovered.
   * Cheap when nothing changed; shared by all bots (call once per tick per sim).
   */
  update(sim: Simulation, force = false): boolean {
    const st = sim.state;
    this.lastSeenTick = st.tick;
    if (!force && st.tick === this.lastStampTick) return false;
    let dirty = force;
    if (this.fenceBroken.length !== st.fences.length) {
      this.fenceBroken = st.fences.map((f) => f.broken);
      dirty = true;
    } else {
      for (let i = 0; i < st.fences.length; i++) {
        if (st.fences[i]!.broken !== this.fenceBroken[i]) {
          this.fenceBroken[i] = st.fences[i]!.broken;
          dirty = true;
        }
      }
    }
    let moved = false;
    for (const l of st.loot) {
      if (l.kind !== 'bank') continue;
      const p = this.bankPose.get(l.id);
      if (!p || p.recovered !== l.recovered) {
        dirty = true;
        continue;
      }
      if (l.recovered) continue;
      if (Math.hypot(l.pos.x - p.x, l.pos.y - p.y) > 0.12 || Math.abs(l.angle - p.a) > 0.02) moved = true;
    }
    // resting safes (anchored, or loose and not held): they block like statics until moved
    let sig = 0;
    this.collectDoors(st.loot);
    for (const l of st.loot) {
      if (l.kind === 'bank' || l.recovered || !this.safeBlocks(l)) continue;
      sig = (sig * 31 + l.id * 7 + Math.round(l.pos.x * 5) * 13 + Math.round(l.pos.y * 5) * 17 + Math.round(l.angle * 10)) | 0;
    }
    if (sig !== this.safeSig) {
      this.safeSig = sig;
      moved = true;
    }
    // moving banks / safes: restamp at most every 4 ticks
    if (moved && (this.lastStampTick < 0 || st.tick - this.lastStampTick >= 4)) dirty = true;
    if (!dirty) return false;
    this.lastStampTick = st.tick;
    this.restamp(sim);
    return true;
  }

  /**
   * Safes the grid treats as obstacles: anchored ones, and loose ones nobody holds that rest in
   * a bank doorway (a safe wedged in a door plugs it: paths must use the other door).
   */
  private safeBlocks(l: { anchored: boolean; pos: Vec2; vel: Vec2; grabbedBy: readonly number[] }): boolean {
    // anchored safes are as solid as statics until someone unanchors them; other loose safes are
    // pushable and handled by local avoidance (stamping them would also wall in the very
    // safe a bot is carrying)
    if (l.anchored) return true;
    if (l.grabbedBy.length > 0 || Math.abs(l.vel.x) + Math.abs(l.vel.y) > 0.08) return false;
    for (let i = 0; i < this.doorPts.length; i += 2) {
      const dx = l.pos.x - this.doorPts[i]!;
      const dy = l.pos.y - this.doorPts[i + 1]!;
      if (dx * dx + dy * dy < 2.0 * 2.0) return true;
    }
    return false;
  }
  private doorPts: number[] = [];
  private collectDoors(loot: ReadonlyArray<{ kind: string; recovered: boolean; pos: Vec2; angle: number }>): void {
    const pts: number[] = [];
    for (const b of loot) {
      if (b.kind !== 'bank' || b.recovered) continue;
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      for (const d of BANK_MODEL.doors) pts.push(b.pos.x + d.center.x * c - d.center.y * s, b.pos.y + d.center.x * s + d.center.y * c);
    }
    this.doorPts = pts;
  }

  private restamp(sim: Simulation): void {
    const st = sim.state;
    const dyn = this.dynDist;
    dyn.fill(CAP);
    for (const f of st.fences) if (!f.broken) this.stampOBB(dyn, f);
    const sd = this.safeDist;
    sd.fill(CAP);
    for (const l of st.loot) {
      if (l.kind === 'bank' || l.recovered || !this.safeBlocks(l)) continue;
      this.stampOBB(sd, { center: l.pos, half: l.half, angle: l.angle });
    }
    for (const l of st.loot) {
      if (l.kind !== 'bank') continue;
      this.bankPose.set(l.id, { x: l.pos.x, y: l.pos.y, a: l.angle, recovered: l.recovered });
      if (l.recovered) continue;
      for (const w of sim.bankWallOBBs(l.id)) this.stampOBB(dyn, w);
    }
    for (const l of st.loot) {
      if (l.kind !== 'bank' || l.recovered) continue;
      this.openDoors(dyn, l.pos, l.angle);
    }
    const stat = this.staticDist;
    const cl = this.clear;
    const ef = this.eff;
    const mw = this.masks.walk;
    const ms = this.masks.small;
    const ml = this.masks.large;
    const rw = NAV_CLEARANCE.walk;
    const rs = NAV_CLEARANCE.small;
    const rl = NAV_CLEARANCE.large;
    const sw = NAV_SAFE_CLEARANCE.walk;
    const ss = NAV_SAFE_CLEARANCE.small;
    const sl = NAV_SAFE_CLEARANCE.large;
    for (let k = 0; k < this.n; k++) {
      const c = stat[k]! < dyn[k]! ? stat[k]! : dyn[k]!;
      const s = sd[k]!;
      cl[k] = c;
      ef[k] = c < s ? c : s;
      mw[k] = c >= rw && s >= sw ? 1 : 0;
      ms[k] = c >= rs && s >= ss ? 1 : 0;
      ml[k] = c >= rl && s >= sl ? 1 : 0;
    }
    // carrying classes never route THROUGH a bank (in one door, out the other): the interior is
    // cramped and a safe left on its floor is loaded onto it. Taking a safe out of a bank or
    // putting one in are explicit door manoeuvres of the bot, not paths.
    for (const l of st.loot) {
      if (l.kind !== 'bank' || l.recovered) continue;
      this.clearMaskInOBB(ms, { center: l.pos, half: { x: BANK_MODEL.half.x + 0.2, y: BANK_MODEL.half.y + 0.2 }, angle: l.angle });
      this.clearMaskInOBB(ml, { center: l.pos, half: { x: BANK_MODEL.half.x + 0.2, y: BANK_MODEL.half.y + 0.2 }, angle: l.angle });
    }
    this.dynVersion++;
    this.stats.restamps++;
  }

  // -------------------------------------------------------------------------
  // Searches
  // -------------------------------------------------------------------------

  /** Nearest passable cell to p (ring search up to maxR meters), or -1. */
  nearestPassable(p: Vec2, cls: NavClass, maxR = 3): number {
    const k0 = this.cellAt(p.x, p.y);
    if (this.passable(k0, cls)) return k0;
    const mask = this.masks[cls];
    let best = -1;
    let bestD = Infinity;
    const ci = Math.round(p.x / NAV_CELL);
    const cj = Math.round(p.y / NAV_CELL);
    const R = Math.ceil(maxR / NAV_CELL);
    for (let ring = 1; ring <= R; ring++) {
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
          const k = j * this.nx + i;
          if (mask[k] !== 1) continue;
          const d = Math.hypot(i * NAV_CELL - p.x, j * NAV_CELL - p.y);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
      }
      if (best >= 0 && bestD <= (ring + 0.5) * NAV_CELL) return best;
    }
    return best;
  }

  /**
   * A* from `from` to `to` for a clearance class. Returns a smoothed polyline starting at
   * `from` and ending at `to` (or at the closest reachable point when unreachable).
   */
  findPath(from: Vec2, to: Vec2, cls: NavClass, opts?: PathOptions): PathResult | null {
    this.stats.astar++;
    const r = NAV_CLEARANCE[cls];
    const s = this.nearestPassable(from, cls, 3);
    const goalCell = this.nearestPassable(to, cls, 3);
    if (s < 0 || goalCell < 0) return null;
    const nx = this.nx;
    const ny = this.ny;
    const gx = goalCell % nx;
    const gy = (goalCell - gx) / nx;
    const goalR = opts?.goalRadius ?? 0;
    const goalR2 = goalR * goalR;
    let maxExpand = opts?.maxExpand ?? 40000;
    // a goal in another connected region can only get a partial path: a small search toward it
    // (instead of flooding the whole reachable region)
    if (goalR <= 0) {
      // (labels are refreshed at most every 30 ticks while banks keep moving; a stale labelling
      // only skips the cap)
      const L = this.labelCache.get(cls);
      const fresh = L !== undefined && L.version === this.dynVersion;
      if (fresh || !L || this.lastSeenTick - L.tick >= 30) {
        const lab = this.labels(cls);
        if (lab[s] !== lab[goalCell]) maxExpand = Math.min(maxExpand, 2500);
      }
    }
    this.epoch++;
    const ep = this.epoch;
    const stamp = this.stamp;
    const g = this.gScore;
    const came = this.came;
    const heap = this.heap;
    heap.clear();
    const minMult = opts?.discount ? 0.6 : 1;
    const hScale = NAV_CELL * minMult;
    const DIAG = SQRT2 - 2;
    stamp[s] = ep;
    g[s] = 0;
    came[s] = -1;
    const sx0 = s % nx;
    const sy0 = (s - sx0) / nx;
    {
      const dx = Math.abs(sx0 - gx);
      const dy = Math.abs(sy0 - gy);
      heap.push(s, (dx + dy + DIAG * (dx < dy ? dx : dy)) * hScale);
    }
    let found = -1;
    let bestK = s;
    let bestH = Infinity;
    let expanded = 0;
    const mask = this.masks[cls];
    const eff = this.eff;
    const band = r + CENTER_BAND;
    const centerK = CENTER_WEIGHT / CENTER_BAND;
    const discount = opts?.discount ?? null;
    const sdist = this.safeDist;
    const squeezeK = cls === 'large' ? SQUEEZE_COST : 0;
    const avoid = opts?.avoid && opts.avoid.length ? opts.avoid : null;
    const D = NAV_CELL * SQRT2;
    const offs = this.nbOff;
    offs[0] = -1;
    offs[1] = 1;
    offs[2] = -nx;
    offs[3] = nx;
    offs[4] = -nx - 1;
    offs[5] = -nx + 1;
    offs[6] = nx - 1;
    offs[7] = nx + 1;
    while (heap.size > 0) {
      const k = heap.pop();
      const fk = heap.lastPri;
      const gk = g[k]!;
      const i = k % nx;
      const j = (k - i) / nx;
      const hdx = i > gx ? i - gx : gx - i;
      const hdy = j > gy ? j - gy : gy - j;
      const hk = (hdx + hdy + DIAG * (hdx < hdy ? hdx : hdy)) * hScale;
      if (fk - hk > gk + 1e-9) continue; // stale
      if (k === goalCell) {
        found = k;
        break;
      }
      if (goalR > 0) {
        const dx = i * NAV_CELL - to.x;
        const dy = j * NAV_CELL - to.y;
        if (dx * dx + dy * dy <= goalR2) {
          found = k;
          break;
        }
      }
      if (hk < bestH) {
        bestH = hk;
        bestK = k;
      }
      if (++expanded > maxExpand) break;
      const L = i > 0 && mask[k - 1] === 1;
      const R = i < nx - 1 && mask[k + 1] === 1;
      const U = j > 0 && mask[k - nx] === 1;
      const Dn = j < ny - 1 && mask[k + nx] === 1;
      for (let e = 0; e < 8; e++) {
        let ok: boolean;
        switch (e) {
          case 0: ok = L; break;
          case 1: ok = R; break;
          case 2: ok = U; break;
          case 3: ok = Dn; break;
          case 4: ok = L && U && mask[k - nx - 1] === 1; break;
          case 5: ok = R && U && mask[k - nx + 1] === 1; break;
          case 6: ok = L && Dn && mask[k + nx - 1] === 1; break;
          default: ok = R && Dn && mask[k + nx + 1] === 1; break;
        }
        if (!ok) continue;
        const q = k + offs[e]!;
        // step cost: lane-centering, trail discount, soft avoidance circles
        const c = eff[q]!;
        let mult = c < band ? 1 + centerK * (band - c) : 1;
        // a large safe squeezing past an anchored safe snags easily: detour when there is one
        if (squeezeK > 0 && sdist[q]! < SQUEEZE_SAFE_DIST) mult += squeezeK;
        if (discount) mult *= 1 - discount[q]!;
        if (avoid) {
          const qi = e === 0 || e === 4 || e === 6 ? i - 1 : e === 1 || e === 5 || e === 7 ? i + 1 : i;
          const qj = e === 2 || e === 4 || e === 5 ? j - 1 : e === 3 || e === 6 || e === 7 ? j + 1 : j;
          const x = qi * NAV_CELL;
          const y = qj * NAV_CELL;
          for (const a of avoid) {
            const ax = x - a.x;
            const ay = y - a.y;
            const d2 = ax * ax + ay * ay;
            if (d2 < a.r * a.r) mult += a.cost * (1 - Math.sqrt(d2) / a.r);
          }
        }
        const ng = gk + (e < 4 ? NAV_CELL : D) * mult;
        if (stamp[q] !== ep || ng < g[q]! - 1e-9) {
          stamp[q] = ep;
          g[q] = ng;
          came[q] = k;
          const qi = q % nx;
          const qj = (q - qi) / nx;
          const dx = qi > gx ? qi - gx : gx - qi;
          const dy = qj > gy ? qj - gy : gy - qj;
          heap.push(q, ng + (dx + dy + DIAG * (dx < dy ? dx : dy)) * hScale);
        }
      }
    }
    this.stats.astarExpanded += expanded;
    if (this.astarTick !== this.lastSeenTick) {
      this.astarTick = this.lastSeenTick;
      this.astarSpent = 0;
    }
    this.astarSpent += expanded;
    const partial = found < 0;
    const end = partial ? bestK : found;
    const cells: number[] = [];
    for (let k = end; k >= 0; k = came[k]!) {
      cells.push(k);
      if (k === s) break;
    }
    cells.reverse();
    const raw: Vec2[] = [{ x: from.x, y: from.y }];
    for (let q = 1; q < cells.length; q++) raw.push({ x: this.cellX(cells[q]!), y: this.cellY(cells[q]!) });
    if (!partial) raw.push({ x: to.x, y: to.y });
    const pts = this.smooth(raw, cls, opts?.smoothMargin ?? 0.03, avoid);
    let length = 0;
    for (let q = 1; q < pts.length; q++) length += Math.hypot(pts[q]!.x - pts[q - 1]!.x, pts[q]!.y - pts[q - 1]!.y);
    return { points: pts, length, partial };
  }

  /**
   * Greedy line-of-sight string pulling on the clearance field. Strong avoidance circles
   * (cost >= HARD_AVOID_COST, e.g. an officer blocking a one-body alley) also block a shortcut
   * that would cut through their core, so the detour A* found is not straightened back into it.
   */
  smooth(raw: Vec2[], cls: NavClass, margin = 0.03, avoid: ReadonlyArray<{ x: number; y: number; r: number; cost: number }> | null = null): Vec2[] {
    if (raw.length <= 2) return raw;
    const out: Vec2[] = [raw[0]!];
    let a = 0;
    while (a < raw.length - 1) {
      let best = a + 1;
      // look ahead (bounded) for the farthest directly reachable point
      const limit = Math.min(raw.length - 1, a + 60);
      for (let b = limit; b > a + 1; b--) {
        // endpoints may sit in low-clearance spots (start inside a door, goal at a safe face);
        // only the interior of the segment must be clear
        if (this.segmentClearInterior(raw[a]!, raw[b]!, cls, a === 0, b === raw.length - 1, margin) && !crossesHardAvoid(raw[a]!, raw[b]!, avoid)) {
          best = b;
          break;
        }
      }
      out.push(raw[best]!);
      a = best;
    }
    return out;
  }

  private segmentClearInterior(a: Vec2, b: Vec2, cls: NavClass, relaxStart: boolean, relaxEnd: boolean, margin = 0.03): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 0.2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const dS = t * len;
      const dE = (1 - t) * len;
      if (relaxStart && dS < 0.6) continue;
      if (relaxEnd && dE < 0.6) continue;
      // (cells next to the raw path may be narrower than the margin: never stricter than them)
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      if (!this.pointClear(x, y, cls, 0.03)) return false;
      if (margin > 0.03 && !this.pointClear(x, y, cls, margin)) return false;
    }
    return true;
  }

  /** Full-grid Dijkstra runs in the current tick (budgeting: callers reuse stale fields). */
  fieldsThisTick(): number {
    return this.fieldTick === this.lastSeenTick ? this.fieldCount : 0;
  }
  private fieldTick = -1;
  private fieldCount = 0;
  private lastSeenTick = -1;

  /** Connected-region labels of the passable cells of a class (recomputed lazily on change). */
  labels(cls: NavClass): Int32Array {
    let L = this.labelCache.get(cls);
    if (L && L.version === this.dynVersion) return L.lab;
    const lab = L?.lab ?? new Int32Array(this.n);
    lab.fill(0);
    const mask = this.masks[cls];
    const nx = this.nx;
    const ny = this.ny;
    const q = this.labelQueue;
    let next = 0;
    for (let k0 = 0; k0 < this.n; k0++) {
      if (mask[k0] !== 1 || lab[k0] !== 0) continue;
      next++;
      let head = 0;
      let tail = 0;
      q[tail++] = k0;
      lab[k0] = next;
      while (head < tail) {
        const k = q[head++]!;
        const i = k % nx;
        const j = (k - i) / nx;
        const L1 = i > 0 && mask[k - 1] === 1;
        const R1 = i < nx - 1 && mask[k + 1] === 1;
        const U1 = j > 0 && mask[k - nx] === 1;
        const D1 = j < ny - 1 && mask[k + nx] === 1;
        if (L1 && lab[k - 1] === 0) (lab[k - 1] = next), (q[tail++] = k - 1);
        if (R1 && lab[k + 1] === 0) (lab[k + 1] = next), (q[tail++] = k + 1);
        if (U1 && lab[k - nx] === 0) (lab[k - nx] = next), (q[tail++] = k - nx);
        if (D1 && lab[k + nx] === 0) (lab[k + nx] = next), (q[tail++] = k + nx);
        // diagonals only where A* allows them (both orthogonal neighbours open)
        if (L1 && U1 && mask[k - nx - 1] === 1 && lab[k - nx - 1] === 0) (lab[k - nx - 1] = next), (q[tail++] = k - nx - 1);
        if (R1 && U1 && mask[k - nx + 1] === 1 && lab[k - nx + 1] === 0) (lab[k - nx + 1] = next), (q[tail++] = k - nx + 1);
        if (L1 && D1 && mask[k + nx - 1] === 1 && lab[k + nx - 1] === 0) (lab[k + nx - 1] = next), (q[tail++] = k + nx - 1);
        if (R1 && D1 && mask[k + nx + 1] === 1 && lab[k + nx + 1] === 0) (lab[k + nx + 1] = next), (q[tail++] = k + nx + 1);
      }
    }
    this.labelCache.set(cls, { lab, version: this.dynVersion, tick: this.lastSeenTick });
    return lab;
  }
  private readonly labelCache = new Map<NavClass, { lab: Int32Array; version: number; tick: number }>();
  private get labelQueue(): Int32Array {
    return (this.labelQ ??= new Int32Array(this.n));
  }
  private labelQ: Int32Array | null = null;

  /** A* expansions already spent this tick (all bots); callers defer optional re-paths. */
  astarSpentThisTick(): number {
    return this.astarTick === this.lastSeenTick ? this.astarSpent : 0;
  }

  /** Multi-source Dijkstra (m) over cells passable for cls, computed at once. */
  distanceField(seeds: ReadonlyArray<number>, cls: NavClass, out?: Float64Array, maxDist = Infinity): Float64Array {
    this.stats.dijkstra++;
    if (this.fieldTick !== this.lastSeenTick) {
      this.fieldTick = this.lastSeenTick;
      this.fieldCount = 0;
    }
    this.fieldCount++;
    const d = out ?? new Float64Array(this.n);
    this.seedField(d, this.heap, seeds, cls);
    this.relaxField(d, this.heap, cls, Infinity, maxDist);
    return d;
  }

  /**
   * Starts a time-sliced distance field (advanced by `service()` once per tick within a fixed
   * pop budget). Poll `job.done`.
   */
  startField(seeds: ReadonlyArray<number>, cls: NavClass, out?: Float64Array, origin: Vec2 | null = null): FieldJob {
    const job = new FieldJob(out ?? new Float64Array(this.n), cls, this.dynVersion, this.lastSeenTick, origin);
    this.seedField(job.dist, job.heap, seeds, cls);
    this.jobs.push(job);
    this.stats.dijkstra++;
    return job;
  }

  /** Abandon a background job (its owner no longer needs it). */
  cancelField(job: FieldJob): void {
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
    job.done = true;
  }

  /** Advance background field jobs (idempotent per tick). */
  service(tick: number): void {
    if (tick === this.serviceTick) return;
    this.serviceTick = tick;
    let budget = FIELD_POPS_PER_TICK;
    while (budget > 0 && this.jobs.length > 0) {
      const job = this.jobs[0]!;
      const used = this.relaxField(job.dist, job.heap, job.cls, budget, Infinity);
      budget -= used;
      if (job.heap.size === 0) {
        job.done = true;
        this.jobs.shift();
      }
    }
    // swap finished zone fields in
    for (const [key, job] of this.zoneJobs) {
      if (!job.done) continue;
      this.zoneJobs.delete(key);
      const old = this.zoneFields.get(key);
      if (old) this.spareFields.set(key, old.dist);
      this.zoneFields.set(key, { dist: job.dist, version: job.version, tick: job.tick });
    }
  }

  private seedField(d: Float64Array, heap: Heap, seeds: ReadonlyArray<number>, cls: NavClass): void {
    d.fill(Infinity);
    heap.clear();
    const mask = this.masks[cls];
    for (const s of seeds) {
      if (s >= 0 && mask[s] === 1) {
        d[s] = 0;
        heap.push(s, 0);
      }
    }
  }

  /** Dijkstra relaxation loop; returns the number of pops used (stops after maxPops). */
  private relaxField(d: Float64Array, heap: Heap, cls: NavClass, maxPops: number, maxDist: number): number {
    const mask = this.masks[cls];
    const nx = this.nx;
    const ny = this.ny;
    const D = NAV_CELL * SQRT2;
    let pops = 0;
    while (heap.size > 0 && pops < maxPops) {
      const k = heap.pop();
      pops++;
      const dk = heap.lastPri;
      if (dk > d[k]!) continue;
      if (dk > maxDist) {
        heap.clear();
        break;
      }
      const i = k % nx;
      const j = (k - i) / nx;
      const L = i > 0 && mask[k - 1] === 1;
      const R = i < nx - 1 && mask[k + 1] === 1;
      const U = j > 0 && mask[k - nx] === 1;
      const Dn = j < ny - 1 && mask[k + nx] === 1;
      if (L && dk + NAV_CELL < d[k - 1]!) (d[k - 1] = dk + NAV_CELL), heap.push(k - 1, dk + NAV_CELL);
      if (R && dk + NAV_CELL < d[k + 1]!) (d[k + 1] = dk + NAV_CELL), heap.push(k + 1, dk + NAV_CELL);
      if (U && dk + NAV_CELL < d[k - nx]!) (d[k - nx] = dk + NAV_CELL), heap.push(k - nx, dk + NAV_CELL);
      if (Dn && dk + NAV_CELL < d[k + nx]!) (d[k + nx] = dk + NAV_CELL), heap.push(k + nx, dk + NAV_CELL);
      if (L && U && mask[k - nx - 1] === 1 && dk + D < d[k - nx - 1]!) (d[k - nx - 1] = dk + D), heap.push(k - nx - 1, dk + D);
      if (R && U && mask[k - nx + 1] === 1 && dk + D < d[k - nx + 1]!) (d[k - nx + 1] = dk + D), heap.push(k - nx + 1, dk + D);
      if (L && Dn && mask[k + nx - 1] === 1 && dk + D < d[k + nx - 1]!) (d[k + nx - 1] = dk + D), heap.push(k + nx - 1, dk + D);
      if (R && Dn && mask[k + nx + 1] === 1 && dk + D < d[k + nx + 1]!) (d[k + nx + 1] = dk + D), heap.push(k + nx + 1, dk + D);
    }
    return pops;
  }

  /** Field value at a world point: best (value + offset) over reached cells within 2.5 m, else Infinity. */
  fieldAt(field: Float64Array, p: Vec2, _cls: NavClass): number {
    const k = this.cellAt(p.x, p.y);
    const v = field[k]!;
    if (Number.isFinite(v)) return v + Math.hypot(this.cellX(k) - p.x, this.cellY(k) - p.y);
    const R = 5; // cells (2.5 m)
    const ci = Math.round(p.x / NAV_CELL);
    const cj = Math.round(p.y / NAV_CELL);
    let best = Infinity;
    for (let dj = -R; dj <= R; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= this.ny) continue;
      for (let di = -R; di <= R; di++) {
        const i = ci + di;
        if (i < 0 || i >= this.nx) continue;
        const q = j * this.nx + i;
        const fv = field[q]!;
        if (!Number.isFinite(fv)) continue;
        const d = fv + Math.hypot(i * NAV_CELL - p.x, j * NAV_CELL - p.y) * 1.2;
        if (d < best) best = d;
      }
    }
    return best;
  }

  /**
   * Points where the descent along a distance field from p (the carry route a field implies)
   * squeezes past an anchored safe (safe clearance < SQUEEZE_SAFE_DIST). Up to `max` points.
   */
  routeSqueezes(field: Float64Array, p: Vec2, max = 4): Vec2[] {
    const out: Vec2[] = [];
    let k = this.cellAt(p.x, p.y);
    if (!Number.isFinite(field[k]!)) {
      // start from the best reached neighbour within 1.5 m
      let best = -1;
      let bv = Infinity;
      const ci = k % this.nx;
      const cj = (k - ci) / this.nx;
      for (let dj = -3; dj <= 3; dj++) {
        for (let di = -3; di <= 3; di++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
          const q = j * this.nx + i;
          if (field[q]! < bv) {
            bv = field[q]!;
            best = q;
          }
        }
      }
      if (best < 0) return out;
      k = best;
    }
    const nx = this.nx;
    let lastHit = -100;
    for (let step = 0; step < 600 && field[k]! > 0; step++) {
      const i = k % nx;
      const j = (k - i) / nx;
      let next = k;
      let nv = field[k]!;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= this.ny) continue;
          const q = jj * nx + ii;
          if (field[q]! < nv) {
            nv = field[q]!;
            next = q;
          }
        }
      }
      if (next === k) break;
      k = next;
      if (this.safeDist[k]! < SQUEEZE_SAFE_DIST && step - lastHit > 4) {
        lastHit = step;
        out.push({ x: this.cellX(k), y: this.cellY(k) });
        if (out.length >= max) break;
      }
    }
    return out;
  }

  /** Seeds: cells inside a zone rect shrunk by `inset` (deep inside, where recoveries happen). */
  zoneSeeds(team: TeamId, inset: number): number[] {
    const z = this.sim.layout.zones.find((zz) => zz.team === team);
    if (!z) return [];
    const out: number[] = [];
    const c = Math.cos(z.angle);
    const s = Math.sin(z.angle);
    const ext = Math.hypot(z.half.x, z.half.y);
    const i0 = Math.max(0, Math.floor((z.center.x - ext) / NAV_CELL));
    const i1 = Math.min(this.nx - 1, Math.ceil((z.center.x + ext) / NAV_CELL));
    const j0 = Math.max(0, Math.floor((z.center.y - ext) / NAV_CELL));
    const j1 = Math.min(this.ny - 1, Math.ceil((z.center.y + ext) / NAV_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * NAV_CELL - z.center.x;
        const dy = j * NAV_CELL - z.center.y;
        const lx = Math.abs(dx * c + dy * s);
        const ly = Math.abs(-dx * s + dy * c);
        if (lx <= z.half.x - inset && ly <= z.half.y - inset) out.push(j * this.nx + i);
      }
    }
    return out;
  }

  /**
   * Carry distance field to a team's zone for a class (refreshed lazily: when the dynamic
   * layer changed and the cached field is older than `maxAgeTicks`).
   */
  zoneField(team: TeamId, cls: NavClass, tick: number, maxAgeTicks = 120): Float64Array {
    const key = `${team}:${cls}`;
    const f = this.zoneFields.get(key);
    if (f && (f.version === this.dynVersion || tick - f.tick < maxAgeTicks)) return f.dist;
    if (f) {
      // refresh in the background (time-sliced); the cached field stays in use meanwhile
      if (!this.zoneJobs.has(key)) {
        const spare = this.spareFields.get(key);
        this.spareFields.delete(key);
        this.zoneJobs.set(key, this.startField(this.zoneSeeds(team, cls === 'large' ? 1.6 : 1.2), cls, spare));
      }
      return f.dist;
    }
    // first use (match loading): synchronous
    const dist = this.distanceField(this.zoneSeeds(team, cls === 'large' ? 1.6 : 1.2), cls);
    this.zoneFields.set(key, { dist, version: this.dynVersion, tick });
    return dist;
  }
}

/** Length of a polyline. */
export function polylineLength(pts: ReadonlyArray<Vec2>): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return s;
}

/** Closest point on a polyline: segment index, parameter, arc length from the start, distance. */
export function projectOnPolyline(pts: ReadonlyArray<Vec2>, p: Vec2): { seg: number; t: number; s: number; dist: number; point: Vec2 } {
  let best = { seg: 0, t: 0, s: 0, dist: Infinity, point: { x: pts[0]!.x, y: pts[0]!.y } };
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const L = Math.sqrt(L2);
    let t = L2 > 1e-12 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best.dist) best = { seg: i, t, s: acc + L * t, dist: d, point: { x: qx, y: qy } };
    acc += L;
  }
  return best;
}

/** Point at arc length s along a polyline (clamped). */
export function pointAtArc(pts: ReadonlyArray<Vec2>, s: number): Vec2 {
  if (s <= 0) return { x: pts[0]!.x, y: pts[0]!.y };
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + L >= s) {
      const t = L > 1e-9 ? (s - acc) / L : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += L;
  }
  const last = pts[pts.length - 1]!;
  return { x: last.x, y: last.y };
}

/** Avoidance circles at least this costly are treated as blocked for path smoothing. */
const HARD_AVOID_COST = 10;

/** Does segment a-b pass through the core (60 % radius) of a hard avoid circle neither end is in? */
function crossesHardAvoid(a: Vec2, b: Vec2, avoid: ReadonlyArray<{ x: number; y: number; r: number; cost: number }> | null): boolean {
  if (!avoid) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  for (const c of avoid) {
    if (c.cost < HARD_AVOID_COST) continue;
    const core = c.r * 0.6;
    if (Math.hypot(a.x - c.x, a.y - c.y) < c.r || Math.hypot(b.x - c.x, b.y - c.y) < c.r) continue;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / l2)) : 0;
    if (Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y) < core) return true;
  }
  return false;
}
