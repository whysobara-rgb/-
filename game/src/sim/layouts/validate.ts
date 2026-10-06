/**
 * Layout validation (geometry only — no dependency on the physics core).
 *
 * Checks every hard requirement a shipped layout must satisfy (doc §5, §6, §8, §9):
 * symmetry, loot totals, arena size, zones and vans, spawn clearance, reachability
 * per size class on a 0.25 m grid, declared path widths, bank-route sweeps, the
 * small-safe bypass with both banks anywhere along their routes, bank separation,
 * overlaps, decor placement, chokepoints standable (not on loot), one-spot defense of both
 * banks' doors, weak fences that really block a bank, bank-interior fairness per team and
 * per-layout identity rules; cross-layout: strings, unique shop signs, the shared dressing
 * vocabulary. It also measures the distances designers care about (spawn -> bank, route
 * lengths, nearest safes).
 *
 * Used by tools/layout-check.ts (CLI) and test/sim/layouts.test.ts.
 */
import { BANK_MODEL, CHARACTER, POLICE, POLICE_CAR, SAFE_SPECS, SCORE, VAN } from '../config';
import { officerStepOutSpot } from '../police';
import type { LayoutDef, OBB, SafeKind, TeamId, Vec2 } from '../types';
import {
  EPS,
  dist,
  distPointPolyline,
  isMultipleOf,
  mirrorAngle,
  mirrorPoint,
  obbAabb,
  obbCorners,
  obbInside,
  obbOverlap,
  polylineLength,
  samplePolyline,
  sdCircle,
  sdOBB,
  toWorld,
} from './geometry';
import { KIOSK_STYLES, PATH_CLASS_WIDTH, SHOP_STYLES, type LayoutDesignMeta } from './meta';

// ---------------------------------------------------------------------------
// Tunables of the validation itself
// ---------------------------------------------------------------------------

export const GRID = 0.25;
/** Bounding radius of the 8 x 6 bank footprint (any rotation). */
export const BANK_SWEEP_RADIUS = Math.hypot(BANK_MODEL.half.x, BANK_MODEL.half.y);
/** Clearance classes (disc radius in meters). */
export const CLASS_RADIUS = {
  /** Character on foot; also small-safe carry (character body is the wider part). */
  walk: CHARACTER.radius,
  small: CHARACTER.radius,
  /** Large safe free-rotation clearance (half diagonal of 1.4 x 1.2). */
  large: Math.hypot(SAFE_SPECS.largeSafe.half.x, SAFE_SPECS.largeSafe.half.y),
} as const;
export const MATCH_SIZE = { min: { x: 64, y: 44 }, max: { x: 80, y: 52 } } as const;
export const MIN_BANK_SEPARATION = 24;
/** Minimum count per collidable dressing kind in every match layout (shared asset vocabulary). */
export const MIN_DRESSING: Readonly<Record<string, number>> = { building: 10, tree: 4, lamp: 4, bench: 2, planter: 2, kiosk: 2 };
/**
 * Doc §6 "두 은행 모두를 한 위치에서 쉽게 방어할 수 있는 배치는 사용하지 않는다": no walkable
 * spot may be within this walking distance of a door of BOTH banks (5 m/s walk -> ~2 s).
 */
export const MIN_ONE_SPOT_DOOR_COVER = 9.5;
/** Interior safes must be equally far (walk in / carry home) for both teams, within this. */
export const INTERIOR_FAIRNESS_TOL = 0.75;
/**
 * A fence listed in breaksFences must really be in the bank's way: with every fence standing,
 * a bank-width body (disc of the bank's half width, the most permissive bank model) either
 * cannot reach the zone at all, or only by a detour at least this much longer than the route.
 */
export const FENCE_DETOUR_FACTOR = 1.15;
export const BYPASS_SAMPLE_STEP = 2.5;
export const ROUTE_SAMPLE_STEP = 0.2;
/** Character center may be this far from a safe's surface and still grab it. */
const GRAB_RANGE = CHARACTER.radius + CHARACTER.reach;

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  level: 'error' | 'warn';
  code: string;
  msg: string;
}

export interface RouteMetric {
  bankIndex: number;
  team: TeamId;
  length: number;
  straight: number;
  minClearance: number;
  breaksFences: string[];
  safesInSweep: number;
}

export interface SafeMetric {
  index: number;
  kind: SafeKind;
  pos: Vec2;
  /** Walking distance from each spawn (index-aligned with def.spawns). */
  walkFromSpawn: number[];
  /** Carry distance (by size class) to each zone (index = team). */
  carryToZone: number[];
  /**
   * Layouts with fences: carry distance once the banks have left and every fence is
   * busted, versus banks gone with fences standing ([standing, busted] per zone).
   */
  fenceEffect?: { standing: number[]; busted: number[] };
}

export interface InteriorMetric {
  bankIndex: number;
  kind: SafeKind;
  /** World position at the bank's start pose. */
  pos: Vec2;
  /** Walking distance from the team's nearest spawn to a grab spot (through a door), index = team. */
  walk: number[];
  /** Carry distance (by size class, out through a door) to the team's zone, index = team. */
  carry: number[];
}

export interface LayoutMetrics {
  size: Vec2;
  totalValue: number;
  outdoorSmall: number;
  outdoorLarge: number;
  bankSeparation: number;
  /**
   * One-spot defense (doc §6): over every walkable spot, the smallest possible
   * "walk to the nearest door of the farther bank" (anyDoor) and "walk to the farthest
   * of all bank doors" (allDoors).
   */
  oneSpot: { anyDoor: number; allDoors: number };
  /** Per bank, the walking distance a bank-width body needs with every fence standing (Infinity = blocked). */
  fenceFreeBankTrip: number[][];
  interior: InteriorMetric[];
  routes: RouteMetric[];
  /** spawnToBank[s][b] = walking distance from spawn s to the nearest door of bank b. */
  spawnToBank: number[][];
  safes: SafeMetric[];
  paths: { id: string; cls: string; minWidth: number; maxWidth: number }[];
  bypass: { combos: number; failures: number };
  chokepoints: number;
  fences: number;
  decor: number;
  /** Police entries (owner addition): park spot, heading and the tightest officer step-out clearance. */
  police: { park: Vec2; angle: number; stepOutClearance: number }[];
}

export interface ValidationReport {
  id: string;
  ok: boolean;
  issues: ValidationIssue[];
  metrics: LayoutMetrics;
}

// ---------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------

type Shape =
  | { type: 'box'; id: string; obb: OBB; solidKind: string }
  | { type: 'circle'; id: string; center: Vec2; radius: number; solidKind: string };

function shapeSd(s: Shape, p: Vec2): number {
  return s.type === 'box' ? sdOBB(s.obb, p) : sdCircle(s.center, s.radius, p);
}

function shapeAabb(s: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
  if (s.type === 'box') return obbAabb(s.obb);
  return { minX: s.center.x - s.radius, minY: s.center.y - s.radius, maxX: s.center.x + s.radius, maxY: s.center.y + s.radius };
}

export function vanOBB(z: LayoutDef['zones'][number]): OBB {
  return { center: z.vanPos, half: VAN.half, angle: z.vanAngle };
}

export function bankOBB(b: LayoutDef['banks'][number]): OBB {
  return { center: b.pos, half: BANK_MODEL.half, angle: b.angle };
}

export function safeOBB(s: LayoutDef['safes'][number]): OBB {
  return { center: s.pos, half: SAFE_SPECS[s.kind].half, angle: s.angle };
}

export function zoneOBB(z: LayoutDef['zones'][number]): OBB {
  return { center: z.center, half: z.half, angle: z.angle };
}

/** World positions just outside each door of a bank at its start pose (1.2 m out). */
export function bankDoorExteriors(b: LayoutDef['banks'][number], out = 1.2): { pos: Vec2; normal: Vec2 }[] {
  const o = bankOBB(b);
  return BANK_MODEL.doors.map((d) => {
    const pos = toWorld(o, { x: d.center.x + d.normal.x * out, y: d.center.y + d.normal.y * out });
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    return { pos, normal: { x: d.normal.x * c - d.normal.y * s, y: d.normal.x * s + d.normal.y * c } };
  });
}

interface ObstacleOpts {
  fences: 'all' | 'none' | ReadonlySet<string>;
  banksAtStart: boolean;
}

/** Collidable world for a given situation. `fences` = which fences are still standing. */
function obstacles(def: LayoutDef, o: ObstacleOpts): Shape[] {
  const out: Shape[] = [];
  for (const s of def.statics) out.push({ type: 'box', id: s.id, obb: s, solidKind: s.kind });
  for (const c of def.circles) out.push({ type: 'circle', id: c.id, center: c.center, radius: c.radius, solidKind: c.kind });
  for (const z of def.zones) out.push({ type: 'box', id: `van${z.team}`, obb: vanOBB(z), solidKind: 'van' });
  for (const f of def.fences) {
    const standing = o.fences === 'all' ? true : o.fences === 'none' ? false : o.fences.has(f.id);
    if (standing) out.push({ type: 'box', id: f.id, obb: f, solidKind: 'fence' });
  }
  if (o.banksAtStart) def.banks.forEach((b, i) => out.push({ type: 'box', id: `bank${i}`, obb: bankOBB(b), solidKind: 'bank' }));
  return out;
}

function boundaryDist(def: LayoutDef, p: Vec2): number {
  return Math.min(p.x, p.y, def.size.x - p.x, def.size.y - p.y);
}

/** Exact clearance (distance to nearest obstacle surface or boundary) at a point. */
function clearanceAt(def: LayoutDef, shapes: ReadonlyArray<Shape>, p: Vec2): number {
  let d = boundaryDist(def, p);
  for (const s of shapes) d = Math.min(d, shapeSd(s, p));
  return d;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/** Cell (i, j) has its center exactly at (i * GRID, j * GRID). */
export class Grid {
  readonly nx: number;
  readonly ny: number;
  /** Distance from cell center to the nearest obstacle, capped. */
  readonly dist: Float32Array;
  private stamp: Uint32Array;
  private epoch = 0;
  private stack: Int32Array;

  constructor(
    readonly def: LayoutDef,
    shapes: ReadonlyArray<Shape>,
    readonly cap = 1.6,
  ) {
    this.nx = Math.round(def.size.x / GRID) + 1;
    this.ny = Math.round(def.size.y / GRID) + 1;
    const n = this.nx * this.ny;
    this.dist = new Float32Array(n);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.dist[j * this.nx + i] = Math.min(cap, boundaryDist(def, { x: i * GRID, y: j * GRID }));
      }
    }
    for (const s of shapes) this.stampShape(s);
    this.stamp = new Uint32Array(n);
    this.stack = new Int32Array(n);
  }

  private stampShape(s: Shape): void {
    const bb = shapeAabb(s);
    const i0 = Math.max(0, Math.floor((bb.minX - this.cap) / GRID));
    const i1 = Math.min(this.nx - 1, Math.ceil((bb.maxX + this.cap) / GRID));
    const j0 = Math.max(0, Math.floor((bb.minY - this.cap) / GRID));
    const j1 = Math.min(this.ny - 1, Math.ceil((bb.maxY + this.cap) / GRID));
    const p = { x: 0, y: 0 };
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        p.x = i * GRID;
        p.y = j * GRID;
        const d = Math.max(0, shapeSd(s, p));
        const k = j * this.nx + i;
        if (d < this.dist[k]) this.dist[k] = d;
      }
    }
  }

  idx(i: number, j: number): number {
    return j * this.nx + i;
  }

  cellOf(p: Vec2): { i: number; j: number } {
    return { i: Math.round(p.x / GRID), j: Math.round(p.y / GRID) };
  }

  center(k: number): Vec2 {
    return { x: (k % this.nx) * GRID, y: Math.floor(k / this.nx) * GRID };
  }

  /** Free mask for a disc of radius r, optionally with extra disc blockers (moving banks). */
  freeMask(r: number, blockers: ReadonlyArray<{ c: Vec2; r: number }> = []): Uint8Array {
    const m = new Uint8Array(this.nx * this.ny);
    for (let k = 0; k < m.length; k++) m[k] = this.dist[k] >= r - 1e-4 ? 1 : 0;
    for (const b of blockers) this.carveDisc(m, b.c, b.r + r);
    return m;
  }

  /** Marks every cell within distance rr of c as blocked. */
  carveDisc(m: Uint8Array, c: Vec2, rr: number): void {
    const i0 = Math.max(0, Math.floor((c.x - rr) / GRID));
    const i1 = Math.min(this.nx - 1, Math.ceil((c.x + rr) / GRID));
    const j0 = Math.max(0, Math.floor((c.y - rr) / GRID));
    const j1 = Math.min(this.ny - 1, Math.ceil((c.y + rr) / GRID));
    const r2 = rr * rr;
    for (let j = j0; j <= j1; j++) {
      const dy = j * GRID - c.y;
      for (let i = i0; i <= i1; i++) {
        const dx = i * GRID - c.x;
        if (dx * dx + dy * dy < r2) m[j * this.nx + i] = 0;
      }
    }
  }

  /** Cells (free in m) whose centers satisfy pred, scanning the given world AABB. */
  cellsIn(m: Uint8Array, bb: { minX: number; minY: number; maxX: number; maxY: number }, pred: (p: Vec2) => boolean): number[] {
    const out: number[] = [];
    const i0 = Math.max(0, Math.floor(bb.minX / GRID));
    const i1 = Math.min(this.nx - 1, Math.ceil(bb.maxX / GRID));
    const j0 = Math.max(0, Math.floor(bb.minY / GRID));
    const j1 = Math.min(this.ny - 1, Math.ceil(bb.maxY / GRID));
    const p = { x: 0, y: 0 };
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        if (!m[k]) continue;
        p.x = i * GRID;
        p.y = j * GRID;
        if (pred(p)) out.push(k);
      }
    }
    return out;
  }

  /**
   * 8-connected flood fill (no corner cutting). Returns a function telling whether a
   * cell was reached; valid until the next flood call.
   */
  flood(m: Uint8Array, seeds: ReadonlyArray<number>): (k: number) => boolean {
    this.epoch++;
    const ep = this.epoch;
    const st = this.stamp;
    const stack = this.stack;
    const nx = this.nx;
    const ny = this.ny;
    let sp = 0;
    for (const s of seeds) {
      if (m[s] && st[s] !== ep) {
        st[s] = ep;
        stack[sp++] = s;
      }
    }
    while (sp > 0) {
      const k = stack[--sp];
      const i = k % nx;
      const j = (k - i) / nx;
      const l = i > 0 && m[k - 1] === 1;
      const r = i < nx - 1 && m[k + 1] === 1;
      const u = j > 0 && m[k - nx] === 1;
      const d = j < ny - 1 && m[k + nx] === 1;
      if (l && st[k - 1] !== ep) (st[k - 1] = ep), (stack[sp++] = k - 1);
      if (r && st[k + 1] !== ep) (st[k + 1] = ep), (stack[sp++] = k + 1);
      if (u && st[k - nx] !== ep) (st[k - nx] = ep), (stack[sp++] = k - nx);
      if (d && st[k + nx] !== ep) (st[k + nx] = ep), (stack[sp++] = k + nx);
      if (l && u && m[k - nx - 1] && st[k - nx - 1] !== ep) (st[k - nx - 1] = ep), (stack[sp++] = k - nx - 1);
      if (r && u && m[k - nx + 1] && st[k - nx + 1] !== ep) (st[k - nx + 1] = ep), (stack[sp++] = k - nx + 1);
      if (l && d && m[k + nx - 1] && st[k + nx - 1] !== ep) (st[k + nx - 1] = ep), (stack[sp++] = k + nx - 1);
      if (r && d && m[k + nx + 1] && st[k + nx + 1] !== ep) (st[k + nx + 1] = ep), (stack[sp++] = k + nx + 1);
    }
    return (k: number) => st[k] === ep;
  }

  /** Multi-source Dijkstra distances (meters) over free cells (8-connected, no corner cutting). */
  distances(m: Uint8Array, seeds: ReadonlyArray<number>): Float64Array {
    const n = this.nx * this.ny;
    const d = new Float64Array(n).fill(Infinity);
    const heap = new MinHeap();
    for (const s of seeds) {
      if (m[s]) {
        d[s] = 0;
        heap.push(s, 0);
      }
    }
    const nx = this.nx;
    const ny = this.ny;
    const diag = GRID * Math.SQRT2;
    while (heap.size > 0) {
      const [k, dk] = heap.pop();
      if (dk > d[k]) continue;
      const i = k % nx;
      const j = (k - i) / nx;
      const relax = (q: number, w: number): void => {
        const nd = dk + w;
        if (nd < d[q]) {
          d[q] = nd;
          heap.push(q, nd);
        }
      };
      const l = i > 0 && m[k - 1] === 1;
      const r = i < nx - 1 && m[k + 1] === 1;
      const u = j > 0 && m[k - nx] === 1;
      const dn = j < ny - 1 && m[k + nx] === 1;
      if (l) relax(k - 1, GRID);
      if (r) relax(k + 1, GRID);
      if (u) relax(k - nx, GRID);
      if (dn) relax(k + nx, GRID);
      if (l && u && m[k - nx - 1]) relax(k - nx - 1, diag);
      if (r && u && m[k - nx + 1]) relax(k - nx + 1, diag);
      if (l && dn && m[k + nx - 1]) relax(k + nx - 1, diag);
      if (r && dn && m[k + nx + 1]) relax(k + nx + 1, diag);
    }
    return d;
  }
}

class MinHeap {
  private keys: number[] = [];
  private pri: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, p: number): void {
    const a = this.keys;
    const b = this.pri;
    a.push(k);
    b.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (b[par] <= b[i]) break;
      [a[par], a[i]] = [a[i], a[par]];
      [b[par], b[i]] = [b[i], b[par]];
      i = par;
    }
  }
  pop(): [number, number] {
    const a = this.keys;
    const b = this.pri;
    const top: [number, number] = [a[0], b[0]];
    const lk = a.pop()!;
    const lp = b.pop()!;
    if (a.length > 0) {
      a[0] = lk;
      b[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [b[m], b[i]] = [b[i], b[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function near(a: number, b: number, tol = 1e-3): boolean {
  return Math.abs(a - b) <= tol;
}

function nearV(a: Vec2, b: Vec2, tol = 1e-3): boolean {
  return near(a.x, b.x, tol) && near(a.y, b.y, tol);
}

/** Order-insensitive corner-set match (boxes are symmetric under PI rotation). */
function sameBox(a: OBB, b: OBB, tol = 1e-3): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  return ca.every((p) => cb.some((q) => nearV(p, q, tol)));
}

function mirroredBox(o: OBB, axis: number): OBB {
  return { center: mirrorPoint(o.center, axis), half: o.half, angle: mirrorAngle(o.angle) };
}

function fmt(n: number, d = 1): string {
  return Number.isFinite(n) ? n.toFixed(d) : '∞';
}

/** Distinct unique sample points along all routes of a bank. */
function bankSamples(def: LayoutDef, bankIndex: number, step: number): Vec2[] {
  const out: Vec2[] = [def.banks[bankIndex].pos];
  for (const r of def.bankRoutes) {
    if (r.bankIndex !== bankIndex) continue;
    for (const p of samplePolyline(r.points, step)) {
      if (!out.some((q) => dist(p, q) < step * 0.5)) out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** Skip the (slowest) bypass combination check. */
  skipBypass?: boolean;
}

export function validateLayout(def: LayoutDef, meta: LayoutDesignMeta, opts: ValidateOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const err = (code: string, msg: string): void => void issues.push({ level: 'error', code, msg });
  const warn = (code: string, msg: string): void => void issues.push({ level: 'warn', code, msg });

  const isMatch = def.id !== 'tutorial';
  const axis = def.size.x / 2;

  // ---- counts, size, totals ------------------------------------------------
  const outdoorSmall = def.safes.filter((s) => s.kind === 'smallSafe').length;
  const outdoorLarge = def.safes.filter((s) => s.kind === 'largeSafe').length;
  const interiorValue = BANK_MODEL.interior.reduce((a, s) => a + SCORE[s.kind], 0);
  const totalValue =
    outdoorSmall * SCORE.smallSafe + outdoorLarge * SCORE.largeSafe + def.banks.length * (SCORE.bankBuilding + interiorValue);

  if (isMatch) {
    if (def.size.x < MATCH_SIZE.min.x || def.size.x > MATCH_SIZE.max.x || def.size.y < MATCH_SIZE.min.y || def.size.y > MATCH_SIZE.max.y) {
      err('size', `arena ${def.size.x}x${def.size.y} outside ${MATCH_SIZE.min.x}x${MATCH_SIZE.min.y}..${MATCH_SIZE.max.x}x${MATCH_SIZE.max.y}`);
    }
    if (outdoorSmall !== 6 || outdoorLarge !== 2) err('loot', `outdoor safes must be 6 small + 2 large (got ${outdoorSmall} + ${outdoorLarge})`);
    if (def.banks.length !== 2) err('banks', `expected 2 banks, got ${def.banks.length}`);
    if (def.zones.length !== 2) err('zones', `expected 2 zones, got ${def.zones.length}`);
    for (const t of [0, 1] as TeamId[]) {
      const n = def.spawns.filter((s) => s.team === t).length;
      if (n !== 2) err('spawns', `team ${t} needs 2 spawns, got ${n}`);
    }
    if (totalValue !== 3200) err('total', `total value ${totalValue} != 3200`);
    if (def.chokepoints.length < 4 || def.chokepoints.length > 8) err('choke', `need 4..8 chokepoints, got ${def.chokepoints.length}`);
  } else {
    if (def.banks.length !== 1) err('banks', `tutorial needs exactly 1 bank`);
    if (def.zones.length !== 1 || def.zones[0].team !== 0) err('zones', `tutorial needs exactly one team 0 zone`);
    if (def.spawns.length !== 1 || def.spawns[0].team !== 0) err('spawns', `tutorial needs exactly one team 0 spawn`);
    if (outdoorSmall < 2 || outdoorSmall > 3 || outdoorLarge !== 0) err('loot', `tutorial needs 2..3 outdoor small safes and no large`);
    if (def.fences.length < 1) err('fence', 'tutorial needs a weak fence on the bank path');
  }

  // ---- ids -----------------------------------------------------------------
  const ids = new Set<string>();
  for (const id of [...def.statics.map((s) => s.id), ...def.circles.map((c) => c.id), ...def.fences.map((f) => f.id)]) {
    if (ids.has(id)) err('id', `duplicate id ${id}`);
    ids.add(id);
  }
  const chokeIds = new Set<string>();
  for (const c of def.chokepoints) {
    if (chokeIds.has(c.id)) err('id', `duplicate chokepoint id ${c.id}`);
    chokeIds.add(c.id);
  }

  // ---- symmetry --------------------------------------------------------------
  if (isMatch) {
    for (const s of def.statics) {
      const m = mirroredBox(s, axis);
      const twin = def.statics.find((t) => t.kind === s.kind && near(t.height, s.height, 0.01) && sameBox(t, m));
      if (!twin) err('symmetry', `static ${s.id} has no mirror twin`);
    }
    for (const c of def.circles) {
      const mc = mirrorPoint(c.center, axis);
      if (!def.circles.some((t) => t.kind === c.kind && nearV(t.center, mc) && near(t.radius, c.radius))) err('symmetry', `circle ${c.id} has no mirror twin`);
    }
    for (const f of def.fences) {
      if (!def.fences.some((t) => sameBox(t, mirroredBox(f, axis)))) err('symmetry', `fence ${f.id} has no mirror twin`);
    }
    for (const s of def.safes) {
      const m = mirroredBox(safeOBB(s), axis);
      if (!def.safes.some((t) => t.kind === s.kind && sameBox(safeOBB(t), m))) err('symmetry', `safe at ${fmt(s.pos.x)},${fmt(s.pos.y)} has no mirror twin`);
    }
    def.banks.forEach((b, i) => {
      if (!near(b.pos.x, axis)) err('symmetry', `bank ${i} not on the mirror axis`);
      if (!isMultipleOf(b.angle, Math.PI / 2, 1e-4)) err('symmetry', `bank ${i} angle must be a multiple of PI/2`);
    });
    for (const z of def.zones) {
      const t = def.zones.find((q) => q.team !== z.team);
      if (
        !t ||
        !nearV(t.center, mirrorPoint(z.center, axis)) ||
        !nearV(t.half, z.half) ||
        !sameBox(vanOBB(t), mirroredBox(vanOBB(z), axis))
      ) {
        err('symmetry', `zone ${z.team} not mirrored`);
      }
    }
    for (const s of def.spawns) {
      const ok = def.spawns.some((t) => t.team !== s.team && nearV(t.pos, mirrorPoint(s.pos, axis)) && near(Math.cos(t.facing), Math.cos(mirrorAngle(s.facing))) && near(Math.sin(t.facing), Math.sin(mirrorAngle(s.facing))));
      if (!ok) err('symmetry', `spawn of team ${s.team} at ${fmt(s.pos.x)},${fmt(s.pos.y)} not mirrored`);
    }
    const fenceMirror = (id: string): string | undefined => {
      const f = def.fences.find((q) => q.id === id);
      if (!f) return undefined;
      return def.fences.find((t) => sameBox(t, mirroredBox(f, axis)))?.id;
    };
    for (const r of def.bankRoutes) {
      const ok = def.bankRoutes.some(
        (t) =>
          t.bankIndex === r.bankIndex &&
          t.team !== r.team &&
          t.points.length === r.points.length &&
          t.points.every((p, i) => nearV(p, mirrorPoint(r.points[i], axis))) &&
          t.breaksFences.length === r.breaksFences.length &&
          r.breaksFences.every((f) => t.breaksFences.includes(fenceMirror(f) ?? '?')),
      );
      if (!ok) err('symmetry', `route bank ${r.bankIndex} team ${r.team} not mirrored`);
    }
    for (const c of def.chokepoints) {
      if (!def.chokepoints.some((t) => nearV(t.pos, mirrorPoint(c.pos, axis)) && near(t.radius, c.radius))) err('symmetry', `chokepoint ${c.id} not mirrored`);
    }
  }

  // ---- banks -----------------------------------------------------------------
  let bankSeparation = Infinity;
  for (let i = 0; i < def.banks.length; i++) {
    for (let j = i + 1; j < def.banks.length; j++) bankSeparation = Math.min(bankSeparation, dist(def.banks[i].pos, def.banks[j].pos));
  }
  if (isMatch && bankSeparation < MIN_BANK_SEPARATION) err('banks', `banks only ${fmt(bankSeparation)} m apart (< ${MIN_BANK_SEPARATION})`);

  // ---- zones / vans --------------------------------------------------------------
  const arena: OBB = { center: { x: def.size.x / 2, y: def.size.y / 2 }, half: { x: def.size.x / 2, y: def.size.y / 2 }, angle: 0 };
  for (const z of def.zones) {
    const zo = zoneOBB(z);
    if (!obbInside(zo, arena)) err('zone', `zone ${z.team} leaves the arena`);
    for (let a = 0; a < Math.PI; a += Math.PI / 36) {
      if (!obbInside({ center: z.center, half: BANK_MODEL.half, angle: a }, zo)) {
        err('zone', `zone ${z.team} cannot hold the bank at ${fmt((a * 180) / Math.PI, 0)} deg`);
        break;
      }
    }
    const van = vanOBB(z);
    if (!obbInside(van, arena, -1e-6)) err('van', `van ${z.team} leaves the arena`);
    if (obbOverlap(van, zo)) err('van', `van ${z.team} overlaps its zone`);
    const vb = obbAabb(van);
    const zb = obbAabb(zo);
    const farSide = z.team === 0 ? vb.maxX <= zb.minX + EPS : vb.minX >= zb.maxX - EPS;
    if (!farSide) err('van', `van ${z.team} is not on the far side of its zone`);
    if ((z.team === 0 ? zb.minX - vb.maxX : vb.minX - zb.maxX) > 2) warn('van', `van ${z.team} sits more than 2 m from its zone`);
    for (const s of def.statics) if (obbOverlap(s, zo)) err('zone', `static ${s.id} intrudes into zone ${z.team}`);
    for (const c of def.circles) if (sdOBB(zo, c.center) < c.radius) err('zone', `circle ${c.id} intrudes into zone ${z.team}`);
    for (const f of def.fences) if (obbOverlap(f, zo)) err('zone', `fence ${f.id} intrudes into zone ${z.team}`);
    for (const s of def.safes) if (obbOverlap(safeOBB(s), zo, 0.5)) err('zone', `outdoor safe at ${fmt(s.pos.x)},${fmt(s.pos.y)} starts in/at zone ${z.team}`);
    for (const s of def.statics) if (obbOverlap(s, van)) err('van', `static ${s.id} overlaps van ${z.team}`);
    for (const c of def.circles) if (sdOBB(van, c.center) < c.radius) err('van', `circle ${c.id} overlaps van ${z.team}`);
  }

  // ---- overlaps of loot / spawns ---------------------------------------------------
  const staticShapes = obstacles(def, { fences: 'all', banksAtStart: false });
  const safeObbs = def.safes.map(safeOBB);
  const bankObbs = def.banks.map(bankOBB);
  safeObbs.forEach((so, i) => {
    if (!obbInside(so, arena, 0.3)) err('safe', `safe ${i} too close to the arena edge`);
    for (const sh of staticShapes) {
      const hit = sh.type === 'box' ? obbOverlap(so, sh.obb, 0.05) : sdOBB(so, sh.center) < sh.radius + 0.05;
      if (hit) err('safe', `safe ${i} overlaps ${sh.solidKind} ${sh.id}`);
    }
    bankObbs.forEach((bo, b) => {
      if (obbOverlap(so, bo, 0.3)) err('safe', `safe ${i} overlaps bank ${b}`);
    });
    for (let j = i + 1; j < safeObbs.length; j++) if (obbOverlap(so, safeObbs[j], 0.3)) err('safe', `safes ${i} and ${j} overlap`);
  });
  bankObbs.forEach((bo, b) => {
    if (!obbInside(bo, arena, 1)) err('bank', `bank ${b} too close to the arena edge`);
    for (const sh of staticShapes) {
      const hit = sh.type === 'box' ? obbOverlap(bo, sh.obb) : sdOBB(bo, sh.center) < sh.radius;
      if (hit) err('bank', `bank ${b} overlaps ${sh.solidKind} ${sh.id}`);
    }
  });
  const spawnR = CHARACTER.radius + 0.25;
  def.spawns.forEach((s, i) => {
    const c = clearanceAt(def, staticShapes, s.pos);
    if (c < spawnR) err('spawn', `spawn ${i} clearance ${fmt(c, 2)} < ${spawnR}`);
    for (const so of [...safeObbs, ...bankObbs]) if (sdOBB(so, s.pos) < spawnR) err('spawn', `spawn ${i} touches loot`);
    const z = def.zones.find((q) => q.team === s.team);
    if (z && dist(s.pos, z.vanPos) > 12) err('spawn', `spawn ${i} is ${fmt(dist(s.pos, z.vanPos))} m from its van (> 12)`);
    for (let j = i + 1; j < def.spawns.length; j++) if (dist(s.pos, def.spawns[j].pos) < 1.5) err('spawn', `spawns ${i} and ${j} too close`);
  });

  // ---- decor -------------------------------------------------------------------------
  const narrowPaths = meta.paths.filter((p) => p.cls === 'narrow');
  def.decor.forEach((d, i) => {
    if (d.pos.x < 0 || d.pos.y < 0 || d.pos.x > def.size.x || d.pos.y > def.size.y) err('decor', `decor ${i} outside the arena`);
    for (const p of narrowPaths) {
      if (distPointPolyline(d.pos, [p.a, p.b]) < PATH_CLASS_WIDTH.narrow.max / 2 + 0.5) err('decor', `decor ${i} (${d.kind}) sits in narrow alley ${p.id}`);
    }
    for (const z of def.zones) if (sdOBB(zoneOBB(z), d.pos) < 0.3) err('decor', `decor ${i} (${d.kind}) sits on zone ${z.team} paint`);
    for (const s of def.statics) {
      if ((s.kind === 'building' || s.kind === 'kiosk' || s.kind === 'wall') && sdOBB(s, d.pos) < -0.05) err('decor', `decor ${i} (${d.kind}) is buried in ${s.id}`);
    }
    bankObbs.forEach((bo, b) => {
      if (sdOBB(bo, d.pos) < 0.2) err('decor', `decor ${i} (${d.kind}) sits under bank ${b}`);
    });
    for (const s of def.spawns) if (dist(s.pos, d.pos) < 0.8) err('decor', `decor ${i} sits on a spawn`);
  });

  // ---- police entries (owner addition) ------------------------------------------------------
  // The car is visual and never collides, but it must never sit on (or drive across) the play
  // field: it parks at the curb OUTSIDE the arena edge, close enough that officers visibly hop
  // the fence, and its from -> park drive-in stays outside too. Officers step in just inside the
  // edge, which needs free, reachable ground (checked with the reachability grid below).
  // Mirrored layouts need it on the mirror axis.
  const police = def.policeEntries ?? [];
  if (isMatch && police.length < 2) err('police', `match layouts need police entries north and south (got ${police.length})`);
  const maxOfficers = Math.max(...POLICE.officersPerWave);
  const policeMetrics: LayoutMetrics['police'] = [];
  const stepOutSpots: { tag: string; k: number; p: Vec2 }[] = [];
  /** Distance from p to the arena rectangle (0 inside or on it). */
  const outsideBy = (p: Vec2): number => {
    const dx = Math.max(0, -p.x, p.x - def.size.x);
    const dy = Math.max(0, -p.y, p.y - def.size.y);
    return Math.hypot(dx, dy);
  };
  police.forEach((e, i) => {
    const tag = `police entry ${i}`;
    const car: OBB = { center: e.park, half: POLICE_CAR.half, angle: e.angle };
    const corners = obbCorners(car);
    const gap = Math.min(...corners.map(outsideBy), ...samplePolyline([corners[0], corners[1], corners[2], corners[3], corners[0]], 0.25).map(outsideBy));
    if (gap < 0.5) err('police', `${tag}: car at ${fmt(e.park.x)},${fmt(e.park.y)} must park at the curb outside the arena (gap to the edge ${fmt(gap, 2)} m < 0.5)`);
    else if (gap > 3) err('police', `${tag}: car at ${fmt(e.park.x)},${fmt(e.park.y)} parks ${fmt(gap, 2)} m from the edge (> 3 m: officers could not hop in from it)`);
    const drive = samplePolyline([e.from, e.park], 0.25);
    if (drive.some((q) => outsideBy(q) < 0.5)) err('police', `${tag}: drive-in ${fmt(e.from.x)},${fmt(e.from.y)} -> ${fmt(e.park.x)},${fmt(e.park.y)} crosses the arena`);
    let stepOut = Infinity;
    for (let k = 0; k < maxOfficers; k++) {
      const p = officerStepOutSpot(e, k, def.size);
      const need = POLICE.radius + 0.1;
      const c = clearanceAt(def, staticShapes, p);
      stepOut = Math.min(stepOut, c);
      const onLoot = [...safeObbs, ...bankObbs].some((o) => sdOBB(o, p) < need);
      const onZone = def.zones.some((z) => sdOBB(zoneOBB(z), p) < need);
      if (c < need || onLoot || onZone) err('police', `${tag}: officer ${k} has no room to step in at ${fmt(p.x)},${fmt(p.y)} (clearance ${fmt(c, 2)})`);
      else stepOutSpots.push({ tag, k, p });
    }
    if (isMatch) {
      const twin = police.some((t) => sameBox({ center: t.park, half: POLICE_CAR.half, angle: t.angle }, mirroredBox(car, axis)) && nearV(t.from, mirrorPoint(e.from, axis)));
      if (!twin) err('symmetry', `${tag} has no mirror twin (put cars on the mirror axis)`);
    }
    policeMetrics.push({ park: { ...e.park }, angle: e.angle, stepOutClearance: stepOut });
  });
  if (isMatch && police.length >= 2) {
    const north = police.filter((e) => e.park.y < def.size.y / 2).length;
    const south = police.length - north;
    if (north === 0 || south === 0) err('police', `police entries must cover the north and the south edge (north ${north}, south ${south})`);
    for (let i = 0; i + 1 < police.length; i++) {
      if (police[i].park.y < def.size.y / 2 === police[i + 1].park.y < def.size.y / 2) {
        err('police', `police entries ${i} and ${i + 1} are on the same half; waves alternate north/south`);
      }
    }
  }

  // ---- declared path widths ---------------------------------------------------------------
  const pathShapes = obstacles(def, { fences: 'all', banksAtStart: true });
  const pathMetrics: LayoutMetrics['paths'] = [];
  for (const p of meta.paths) {
    const len = dist(p.a, p.b);
    const dir = { x: (p.b.x - p.a.x) / len, y: (p.b.y - p.a.y) / len };
    const nrm = { x: -dir.y, y: dir.x };
    let minW = Infinity;
    let maxW = 0;
    const n = Math.max(2, Math.ceil(len / 0.25));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const c = { x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t };
      if (clearanceAt(def, pathShapes, c) <= 0) {
        minW = 0;
        continue;
      }
      const w = rayFree(def, pathShapes, c, nrm, 4) + rayFree(def, pathShapes, c, { x: -nrm.x, y: -nrm.y }, 4);
      minW = Math.min(minW, w);
      maxW = Math.max(maxW, w);
    }
    pathMetrics.push({ id: p.id, cls: p.cls, minWidth: minW, maxWidth: maxW });
    const lim = PATH_CLASS_WIDTH[p.cls];
    if (minW < lim.min - 1e-3 || maxW > lim.max + 1e-3) {
      err('path', `${p.cls} path ${p.id} width ${fmt(minW, 3)}..${fmt(maxW, 3)} outside ${lim.min}..${lim.max}`);
    }
  }

  // ---- bank routes ---------------------------------------------------------------------------
  const routeMetrics: RouteMetric[] = [];
  const sweptSafes = new Set<number>();
  def.bankRoutes.forEach((r) => {
    const bank = def.banks[r.bankIndex];
    const zone = def.zones.find((z) => z.team === r.team);
    const tag = `route bank ${r.bankIndex} -> team ${r.team}`;
    if (!bank || !zone) {
      err('route', `${tag}: unknown bank or zone`);
      return;
    }
    if (r.points.length < 2) err('route', `${tag}: needs at least 2 points`);
    if (!nearV(r.points[0], bank.pos, 0.01)) err('route', `${tag}: must start at the bank position`);
    const last = r.points[r.points.length - 1];
    if (dist(last, zone.center) > 0.5) err('route', `${tag}: must end at the zone center`);
    const standing = new Set(def.fences.map((f) => f.id).filter((id) => !r.breaksFences.includes(id)));
    const shapes = obstacles(def, { fences: standing, banksAtStart: false });
    let minC = Infinity;
    let worst = '';
    for (const p of samplePolyline(r.points, ROUTE_SAMPLE_STEP)) {
      let c = boundaryDist(def, p);
      let who = 'boundary';
      for (const s of shapes) {
        const d = shapeSd(s, p);
        if (d < c) {
          c = d;
          who = s.id;
        }
      }
      if (c < minC) {
        minC = c;
        worst = `${who} near ${fmt(p.x)},${fmt(p.y)}`;
      }
    }
    if (minC < BANK_SWEEP_RADIUS - 1e-3) err('route', `${tag}: ${BANK_SWEEP_RADIUS} m sweep touches ${worst} (clearance ${fmt(minC, 2)})`);
    for (const fid of r.breaksFences) {
      const f = def.fences.find((q) => q.id === fid);
      if (!f) err('route', `${tag}: unknown fence ${fid}`);
      else {
        const d = Math.min(...samplePolyline(r.points, ROUTE_SAMPLE_STEP).map((p) => sdOBB(f, p)));
        if (d > BANK_SWEEP_RADIUS * 0.6) err('route', `${tag}: fence ${fid} is not on the route`);
      }
    }
    // Other bank's start footprint should not sit on this route.
    def.banks.forEach((b2, j) => {
      if (j === r.bankIndex) return;
      const d = Math.min(...samplePolyline(r.points, 0.5).map((p) => sdOBB(bankOBB(b2), p)));
      if (d < BANK_SWEEP_RADIUS) err('route', `${tag}: passes over bank ${j}'s start position`);
    });
    let inSweep = 0;
    def.safes.forEach((s, i) => {
      const d = Math.min(...samplePolyline(r.points, 0.5).map((p) => sdOBB(safeOBB(s), p)));
      if (d < BANK_SWEEP_RADIUS) {
        inSweep++;
        sweptSafes.add(i);
      }
    });
    routeMetrics.push({
      bankIndex: r.bankIndex,
      team: r.team,
      length: polylineLength(r.points),
      straight: dist(bank.pos, zone.center),
      minClearance: minC,
      breaksFences: [...r.breaksFences],
      safesInSweep: inSweep,
    });
  });
  def.banks.forEach((_, b) => {
    for (const z of def.zones) {
      if (!def.bankRoutes.some((r) => r.bankIndex === b && r.team === z.team)) err('route', `missing route bank ${b} -> team ${z.team}`);
    }
  });
  if (sweptSafes.size > 3) err('route', `${sweptSafes.size} outdoor safes lie in bank-route sweeps (max 3)`);
  for (const f of def.fences) {
    if (!def.bankRoutes.some((r) => r.breaksFences.includes(f.id))) warn('fence', `fence ${f.id} is not on any curated bank route`);
  }

  // ---- reachability (banks at start, fences standing) -------------------------------------------
  const grid = new Grid(def, pathShapes);
  const walk = grid.freeMask(CLASS_RADIUS.walk);
  const large = grid.freeMask(CLASS_RADIUS.large);
  const zoneTargets = (m: Uint8Array, z: LayoutDef['zones'][number], inset: number): number[] =>
    grid.cellsIn(m, obbAabb(zoneOBB(z)), (p) => sdOBB(zoneOBB(z), p) <= -inset);
  const insetFor = (k: SafeKind): number => Math.hypot(SAFE_SPECS[k].half.x, SAFE_SPECS[k].half.y);
  const spawnCells = def.spawns.map((s) => {
    const c = grid.cellOf(s.pos);
    return grid.idx(c.i, c.j);
  });
  const spawnDist = spawnCells.map((c) => grid.distances(walk, [c]));
  const reachCells = (o: OBB): number[] => {
    const bb = obbAabb(o);
    return grid.cellsIn(walk, { minX: bb.minX - GRAB_RANGE, minY: bb.minY - GRAB_RANGE, maxX: bb.maxX + GRAB_RANGE, maxY: bb.maxY + GRAB_RANGE }, (p) => {
      const d = sdOBB(o, p);
      return d > 0 && d <= GRAB_RANGE;
    });
  };
  const minOver = (d: Float64Array, cells: number[]): number => cells.reduce((a, k) => Math.min(a, d[k]), Infinity);

  // spawn -> bank doors
  const spawnToBank: number[][] = def.spawns.map((_, si) =>
    def.banks.map((b) => {
      let best = Infinity;
      for (const door of bankDoorExteriors(b)) {
        const cells = grid.cellsIn(walk, { minX: door.pos.x - 0.6, minY: door.pos.y - 0.6, maxX: door.pos.x + 0.6, maxY: door.pos.y + 0.6 }, () => true);
        best = Math.min(best, minOver(spawnDist[si], cells));
      }
      return best;
    }),
  );
  spawnToBank.forEach((row, si) =>
    row.forEach((d, b) => {
      if (!Number.isFinite(d)) err('reach', `bank ${b} doors unreachable from spawn ${si}`);
    }),
  );

  // Bank doors must lead out to both zones for small and large interior safes.
  def.banks.forEach((b, bi) => {
    const doors = bankDoorExteriors(b, 1.6);
    for (const [cls, m] of [
      ['smallSafe', walk],
      ['largeSafe', large],
    ] as const) {
      const seeds = doors.flatMap((door) => grid.cellsIn(m, { minX: door.pos.x - 0.5, minY: door.pos.y - 0.5, maxX: door.pos.x + 0.5, maxY: door.pos.y + 0.5 }, () => true));
      if (seeds.length === 0) {
        err('reach', `bank ${bi}: no ${cls} clearance outside any door`);
        continue;
      }
      const reached = grid.flood(m, seeds);
      for (const z of def.zones) {
        if (!zoneTargets(m, z, insetFor(cls)).some(reached)) err('reach', `bank ${bi}: interior ${cls} cannot be carried to zone ${z.team}`);
      }
    }
  });

  // Outdoor safes: walkable from every spawn; carriable to both zones by size class.
  const safeMetrics: SafeMetric[] = [];
  def.safes.forEach((s, i) => {
    const so = safeOBB(s);
    const rc = reachCells(so);
    const walkFromSpawn = spawnDist.map((d) => minOver(d, rc));
    walkFromSpawn.forEach((d, si) => {
      if (!Number.isFinite(d)) err('reach', `safe ${i} (${s.kind}) unreachable on foot from spawn ${si}`);
    });
    const m = s.kind === 'smallSafe' ? walk : large;
    const c = grid.cellOf(s.pos);
    const start = grid.idx(c.i, c.j);
    const carryToZone: number[] = [Infinity, Infinity];
    if (!m[start]) {
      err('reach', `safe ${i} (${s.kind}) start lacks ${s.kind} clearance (${fmt(grid.dist[start], 2)} m)`);
    } else {
      const d = grid.distances(m, [start]);
      for (const z of def.zones) {
        carryToZone[z.team] = minOver(d, zoneTargets(m, z, insetFor(s.kind)));
        if (!Number.isFinite(carryToZone[z.team])) err('reach', `safe ${i} (${s.kind}) cannot be carried to zone ${z.team}`);
      }
    }
    safeMetrics.push({ index: i, kind: s.kind, pos: s.pos, walkFromSpawn, carryToZone });
  });

  // Fence effect: how much a busted fence shortens each carry (banks gone in both cases).
  if (def.fences.length > 0) {
    const gStand = new Grid(def, obstacles(def, { fences: 'all', banksAtStart: false }));
    const gOpen = new Grid(def, obstacles(def, { fences: 'none', banksAtStart: false }));
    const masks = {
      stand: { small: gStand.freeMask(CLASS_RADIUS.small), large: gStand.freeMask(CLASS_RADIUS.large) },
      open: { small: gOpen.freeMask(CLASS_RADIUS.small), large: gOpen.freeMask(CLASS_RADIUS.large) },
    };
    def.safes.forEach((s, i) => {
      const cls = s.kind === 'smallSafe' ? 'small' : 'large';
      const run = (g: Grid, m: Uint8Array): number[] => {
        const c = g.cellOf(s.pos);
        const k = g.idx(c.i, c.j);
        if (!m[k]) return def.zones.map(() => Infinity);
        const d = g.distances(m, [k]);
        return def.zones.map((z) => minOver(d, g.cellsIn(m, obbAabb(zoneOBB(z)), (p) => sdOBB(zoneOBB(z), p) <= -insetFor(s.kind))));
      };
      safeMetrics[i].fenceEffect = { standing: run(gStand, masks.stand[cls]), busted: run(gOpen, masks.open[cls]) };
    });
  }

  // Police step-in spots must connect to the play field (officers walk out to chase).
  for (const sp of stepOutSpots) {
    const c = grid.cellOf(sp.p);
    const k = grid.idx(c.i, c.j);
    if (!walk[k] || (spawnDist.length > 0 && !Number.isFinite(spawnDist[0][k]))) err('police', `${sp.tag}: officer ${sp.k} steps in at ${fmt(sp.p.x)},${fmt(sp.p.y)}, which is walled off from the arena`);
  }

  // Chokepoints must be walkable and reachable.
  def.chokepoints.forEach((c) => {
    const cell = grid.cellOf(c.pos);
    const k = grid.idx(cell.i, cell.j);
    if (!walk[k]) err('choke', `chokepoint ${c.id} is not on walkable ground`);
    else if (spawnDist.length > 0 && !Number.isFinite(spawnDist[0][k])) err('choke', `chokepoint ${c.id} unreachable`);
    if (c.radius < 1 || c.radius > 6) err('choke', `chokepoint ${c.id} radius ${c.radius} outside 1..6`);
    // A bot sent to watch the spot must be able to stand on it at match start
    // (reach checks ignore loot, so test safes and bank footprints explicitly).
    safeObbs.forEach((so, i) => {
      if (sdOBB(so, c.pos) < CHARACTER.radius) err('choke', `chokepoint ${c.id} sits on safe ${i}`);
    });
    bankObbs.forEach((bo, b) => {
      if (sdOBB(bo, c.pos) < CHARACTER.radius) err('choke', `chokepoint ${c.id} sits on bank ${b}`);
    });
  });

  // One-spot defense: walking distance from every door exterior, then the best single spot.
  const doorFields = def.banks.map((b) =>
    bankDoorExteriors(b).map((door) => {
      const cells = grid.cellsIn(walk, { minX: door.pos.x - 0.6, minY: door.pos.y - 0.6, maxX: door.pos.x + 0.6, maxY: door.pos.y + 0.6 }, () => true);
      return grid.distances(walk, cells);
    }),
  );
  const oneSpot = { anyDoor: Infinity, allDoors: Infinity };
  if (def.banks.length >= 2) {
    for (let k = 0; k < walk.length; k++) {
      if (!walk[k]) continue;
      let anyDoor = 0;
      let allDoors = 0;
      for (const fields of doorFields) {
        let nearest = Infinity;
        for (const f of fields) {
          nearest = Math.min(nearest, f[k]);
          allDoors = Math.max(allDoors, f[k]);
        }
        anyDoor = Math.max(anyDoor, nearest);
      }
      oneSpot.anyDoor = Math.min(oneSpot.anyDoor, anyDoor);
      oneSpot.allDoors = Math.min(oneSpot.allDoors, allDoors);
    }
    if (isMatch && oneSpot.anyDoor < MIN_ONE_SPOT_DOOR_COVER) {
      err('banks', `one spot is within ${fmt(oneSpot.anyDoor)} m of a door of both banks (< ${MIN_ONE_SPOT_DOOR_COVER}): too easy to guard both`);
    }
  }

  // Bank-width body with every fence standing: a listed fence must really be in the way.
  const fenceFreeBankTrip: number[][] = def.banks.map(() => def.zones.map(() => Infinity));
  if (def.bankRoutes.some((r) => r.breaksFences.length > 0)) {
    const bankR = Math.min(BANK_MODEL.half.x, BANK_MODEL.half.y);
    const fg = new Grid(def, obstacles(def, { fences: 'all', banksAtStart: false }), bankR + 0.2);
    const fm = fg.freeMask(bankR);
    def.banks.forEach((b, bi) => {
      const c = fg.cellOf(b.pos);
      const d = fg.distances(fm, [fg.idx(c.i, c.j)]);
      def.zones.forEach((z, zi) => {
        const zc = fg.cellOf(z.center);
        fenceFreeBankTrip[bi][zi] = d[fg.idx(zc.i, zc.j)];
      });
    });
    def.bankRoutes.forEach((r) => {
      if (r.breaksFences.length === 0) return;
      const zi = def.zones.findIndex((z) => z.team === r.team);
      const free = fenceFreeBankTrip[r.bankIndex]?.[zi] ?? Infinity;
      const len = polylineLength(r.points);
      if (free < len * FENCE_DETOUR_FACTOR) {
        err('fence', `route bank ${r.bankIndex} -> team ${r.team}: a bank can skip ${r.breaksFences.join('+')} (fence-free trip ${fmt(free)} m vs route ${fmt(len)} m)`);
      }
    });
  }

  // Bank contents (BANK_MODEL.interior is not mirror-symmetric in the bank's local x):
  // each team must get the same interior value on its side, and every interior safe must be
  // equally far to walk to and carry home for both teams.
  const interior = isMatch ? interiorFairness(def, axis, err) : [];

  // ---- bypass: both banks anywhere along their routes -------------------------------------------
  let combos = 0;
  let failures = 0;
  if (!opts.skipBypass && def.banks.length > 0 && def.zones.length > 0) {
    const bgrid = new Grid(def, staticShapes);
    const base = bgrid.freeMask(CLASS_RADIUS.small);
    const samples = def.banks.map((_, b) => bankSamples(def, b, BYPASS_SAMPLE_STEP));
    const z0 = def.zones[0];
    const zoneCells = def.zones.map((z) => bgrid.cellsIn(base, obbAabb(zoneOBB(z)), (p) => sdOBB(zoneOBB(z), p) <= -insetFor('smallSafe')));
    const safeInfo = def.safes.map((s) => ({
      pos: s.pos,
      cells: bgrid.cellsIn(base, { minX: s.pos.x - 0.5, minY: s.pos.y - 0.5, maxX: s.pos.x + 0.5, maxY: s.pos.y + 0.5 }, () => true),
    }));
    const siteDoors = def.banks.map((b) =>
      bankDoorExteriors(b, 1.0).map((d) => bgrid.cellsIn(base, { minX: d.pos.x - 0.6, minY: d.pos.y - 0.6, maxX: d.pos.x + 0.6, maxY: d.pos.y + 0.6 }, () => true)),
    );
    const siteCenters = def.banks.map((b) => bgrid.cellsIn(base, { minX: b.pos.x - 0.6, minY: b.pos.y - 0.6, maxX: b.pos.x + 0.6, maxY: b.pos.y + 0.6 }, () => true));
    const reported = new Set<string>();
    const blockR = BANK_SWEEP_RADIUS;
    const combosList: Vec2[][] = [];
    const rec = (b: number, acc: Vec2[]): void => {
      if (b === samples.length) {
        combosList.push([...acc]);
        return;
      }
      for (const p of samples[b]) rec(b + 1, [...acc, p]);
    };
    rec(0, []);
    const work = new Uint8Array(base.length);
    for (const combo of combosList) {
      combos++;
      work.set(base);
      combo.forEach((p, b) => {
        const atStart = nearV(p, def.banks[b].pos, 1e-6);
        if (atStart) carveObb(bgrid, work, bankOBB(def.banks[b]), CLASS_RADIUS.small);
        else bgrid.carveDisc(work, p, blockR + CLASS_RADIUS.small);
      });
      const covered = (q: Vec2, pad: number): boolean =>
        combo.some((p, b) => (nearV(p, def.banks[b].pos, 1e-6) ? sdOBB(bankOBB(def.banks[b]), q) < pad : dist(p, q) < blockR + pad));
      const seeds = zoneCells[0].filter((k) => work[k]);
      const reached = bgrid.flood(work, seeds);
      const fails: string[] = [];
      if (seeds.length === 0) fails.push(`zone ${z0.team} fully covered`);
      if (def.zones.length > 1 && !zoneCells[1].some((k) => work[k] && reached(k))) fails.push('zones disconnected');
      safeInfo.forEach((s, i) => {
        if (covered(s.pos, 1.2)) return; // being bulldozed by the bank itself
        if (!s.cells.some((k) => work[k] && reached(k))) fails.push(`safe ${i}`);
      });
      def.banks.forEach((b, bi) => {
        if (nearV(combo[bi], b.pos, 1e-6)) {
          siteDoors[bi].forEach((cells, di) => {
            if (cells.length === 0) return;
            const doorPos = bankDoorExteriors(b, 1.0)[di].pos;
            if (combo.some((p, ob) => ob !== bi && !nearV(p, def.banks[ob].pos, 1e-6) && dist(p, doorPos) < blockR + 1)) return;
            if (!cells.some((k) => work[k] && reached(k))) fails.push(`bank ${bi} door ${di}`);
          });
        } else if (!covered(b.pos, 0.6)) {
          if (!siteCenters[bi].some((k) => work[k] && reached(k))) fails.push(`bank ${bi} site`);
        }
      });
      if (fails.length > 0) {
        failures++;
        const key = fails.join(',');
        if (!reported.has(key) && reported.size < 6) {
          reported.add(key);
          err('bypass', `banks at ${combo.map((p) => `(${fmt(p.x)},${fmt(p.y)})`).join(' & ')} cut off: ${key}`);
        }
      }
    }
  }

  // ---- identity rules ------------------------------------------------------------------------------
  identityChecks(def, routeMetrics, safeMetrics, fenceFreeBankTrip, err);

  const metrics: LayoutMetrics = {
    size: def.size,
    totalValue,
    outdoorSmall,
    outdoorLarge,
    bankSeparation,
    oneSpot,
    fenceFreeBankTrip,
    interior,
    routes: routeMetrics,
    spawnToBank,
    safes: safeMetrics,
    paths: pathMetrics,
    bypass: { combos, failures },
    chokepoints: def.chokepoints.length,
    fences: def.fences.length,
    decor: def.decor.length,
    police: policeMetrics,
  };
  return { id: def.id, ok: !issues.some((i) => i.level === 'error'), issues, metrics };
}

/** World collider boxes of a bank's walls at its start pose (doors open). */
export function bankWallOBBs(b: LayoutDef['banks'][number]): OBB[] {
  const o = bankOBB(b);
  return BANK_MODEL.walls.map((w) => ({ center: toWorld(o, w.center), half: w.half, angle: b.angle }));
}

/** World poses of a bank's initial interior safes (BANK_MODEL.interior). */
export function bankInteriorSafes(b: LayoutDef['banks'][number]): { kind: SafeKind; obb: OBB }[] {
  const o = bankOBB(b);
  return BANK_MODEL.interior.map((it) => ({
    kind: it.kind,
    obb: { center: toWorld(o, it.pos), half: SAFE_SPECS[it.kind].half, angle: b.angle + it.angle },
  }));
}

/**
 * Fairness of the bank contents. The shared bank model puts its large safe on local -x, so
 * at angle 0 / PI a bank's contents are not mirror images of themselves. That is acceptable
 * only when (a) the interior value on each side of the mirror axis balances over all banks
 * (each team has "its" large safe), and (b) every interior safe is equally far for both
 * teams, i.e. it can only be reached and carried out through on-axis doors (walls block
 * grabbing). Banks at PI/2 / 3PI/2 satisfy both trivially.
 */
function interiorFairness(def: LayoutDef, axis: number, err: (code: string, msg: string) => void): InteriorMetric[] {
  let balance = 0;
  const items = def.banks.flatMap((b, bankIndex) => bankInteriorSafes(b).map((s) => ({ ...s, bankIndex })));
  for (const it of items) {
    const dx = it.obb.center.x - axis;
    if (Math.abs(dx) > 1e-3) balance += Math.sign(dx) * SCORE[it.kind];
  }
  if (balance !== 0) err('symmetry', `bank interiors favor team ${balance < 0 ? 0 : 1}: ${Math.abs(balance)} more interior value on its side`);

  // Banks as real walls with open doors; outdoor loot ignored (as in the reach checks).
  const shapes: Shape[] = obstacles(def, { fences: 'all', banksAtStart: false });
  def.banks.forEach((b, bi) => bankWallOBBs(b).forEach((w, wi) => shapes.push({ type: 'box', id: `bank${bi}.wall${wi}`, obb: w, solidKind: 'bankWall' })));
  const g = new Grid(def, shapes);
  const masks = { smallSafe: g.freeMask(CLASS_RADIUS.small), largeSafe: g.freeMask(CLASS_RADIUS.large) };
  const walkMask = g.freeMask(CLASS_RADIUS.walk);
  const spawnFields = def.spawns.map((s) => {
    const c = g.cellOf(s.pos);
    return { team: s.team, d: g.distances(walkMask, [g.idx(c.i, c.j)]) };
  });
  const out: InteriorMetric[] = [];
  for (const it of items) {
    const foot = bankOBB(def.banks[it.bankIndex]);
    const bb = obbAabb(it.obb);
    // Grab spots: inside the bank footprint (never through a wall), within reach of the safe.
    const grab = g.cellsIn(walkMask, { minX: bb.minX - GRAB_RANGE, minY: bb.minY - GRAB_RANGE, maxX: bb.maxX + GRAB_RANGE, maxY: bb.maxY + GRAB_RANGE }, (p) => {
      const d = sdOBB(it.obb, p);
      return d > 0 && d <= GRAB_RANGE && sdOBB(foot, p) < 0;
    });
    const walk = [0, 1].map((t) => spawnFields.filter((f) => f.team === t).reduce((a, f) => Math.min(a, grab.reduce((m, k) => Math.min(m, f.d[k]), Infinity)), Infinity));
    const m = masks[it.kind];
    const c = g.cellOf(it.obb.center);
    const start = g.idx(c.i, c.j);
    const carry = [Infinity, Infinity];
    if (m[start]) {
      const d = g.distances(m, [start]);
      for (const z of def.zones) {
        const zo = zoneOBB(z);
        const inset = Math.hypot(SAFE_SPECS[it.kind].half.x, SAFE_SPECS[it.kind].half.y);
        carry[z.team] = g.cellsIn(m, obbAabb(zo), (p) => sdOBB(zo, p) <= -inset).reduce((a, k) => Math.min(a, d[k]), Infinity);
      }
    }
    const tag = `bank ${it.bankIndex} interior ${it.kind} at ${fmt(it.obb.center.x)},${fmt(it.obb.center.y)}`;
    if (!walk.every(Number.isFinite)) err('interior', `${tag}: no grab spot reachable through a door for both teams`);
    if (!carry.every(Number.isFinite)) err('interior', `${tag}: cannot be carried out to both zones`);
    out.push({ bankIndex: it.bankIndex, kind: it.kind, pos: it.obb.center, walk, carry });
  }
  // Each bank must be fair on its own: every interior safe needs a "mirror partner" of the same
  // kind in the same bank (possibly itself) whose team-1 distances equal its team-0 distances.
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= INTERIOR_FAIRNESS_TOL;
  for (const s of out) {
    const partner = out.find(
      (q) => q.bankIndex === s.bankIndex && q.kind === s.kind && close(s.walk[0], q.walk[1]) && close(s.walk[1], q.walk[0]) && close(s.carry[0], q.carry[1]) && close(s.carry[1], q.carry[0]),
    );
    if (!partner && s.walk.every(Number.isFinite) && s.carry.every(Number.isFinite)) {
      err(
        'interior',
        `bank ${s.bankIndex} interior ${s.kind} at ${fmt(s.pos.x)},${fmt(s.pos.y)} has no fair twin (walk ${fmt(s.walk[0])}/${fmt(s.walk[1])}, carry ${fmt(s.carry[0])}/${fmt(s.carry[1])} m for team 0/1)`,
      );
    }
  }
  return out;
}

/** Blocks cells within r of an OBB. */
function carveObb(g: Grid, m: Uint8Array, o: OBB, r: number): void {
  const bb = obbAabb(o);
  const cells = g.cellsIn(m, { minX: bb.minX - r, minY: bb.minY - r, maxX: bb.maxX + r, maxY: bb.maxY + r }, (p) => sdOBB(o, p) < r);
  for (const k of cells) m[k] = 0;
}

/** Free distance along a ray before hitting an obstacle or the boundary (fine march). */
function rayFree(def: LayoutDef, shapes: ReadonlyArray<Shape>, from: Vec2, dir: Vec2, maxLen: number): number {
  // Sphere tracing: step by the clearance, finishing with a fine resolution.
  let t = 0;
  for (let it = 0; it < 400 && t < maxLen; it++) {
    const p = { x: from.x + dir.x * t, y: from.y + dir.y * t };
    const c = clearanceAt(def, shapes, p);
    if (c <= 1e-4) return t;
    t += Math.max(c, 1e-4);
  }
  return Math.min(t, maxLen);
}

function identityChecks(
  def: LayoutDef,
  routes: RouteMetric[],
  safes: SafeMetric[],
  fenceFree: number[][],
  err: (c: string, m: string) => void,
): void {
  const preferred = (b: number, t: TeamId): RouteMetric | undefined => routes.find((r) => r.bankIndex === b && r.team === t);
  switch (def.id) {
    case 'plaza': {
      // Bank recovery paths are relatively long: curated route clearly longer than the straight line.
      for (const r of routes) {
        if (r.length < r.straight * 1.15) err('identity', `plaza: bank ${r.bankIndex} -> team ${r.team} route not forced around (len ${fmt(r.length)} vs straight ${fmt(r.straight)})`);
      }
      // Outer small safes easy to reach: each spawn has two small safes within 20 m on foot.
      def.spawns.forEach((_, si) => {
        const close = safes.filter((s) => s.kind === 'smallSafe' && s.walkFromSpawn[si] <= 20).length;
        if (close < 2) err('identity', `plaza: spawn ${si} has only ${close} small safes within 20 m`);
      });
      break;
    }
    case 'shortcut': {
      if (def.fences.length < 2 || def.fences.length > 4) err('identity', `shortcut: needs 2..4 fences (got ${def.fences.length})`);
      // The preferred route of every (bank, team) pair busts a fence and beats any fence-free alternative.
      def.banks.forEach((_, b) => {
        for (const t of [0, 1] as TeamId[]) {
          const p = preferred(b, t);
          if (!p) continue;
          if (p.breaksFences.length === 0) err('identity', `shortcut: preferred route bank ${b} -> team ${t} breaks no fence`);
          const alt = routes.filter((r) => r.bankIndex === b && r.team === t && r.breaksFences.length === 0);
          for (const a of alt) if (a.length <= p.length) err('identity', `shortcut: fence route bank ${b} -> team ${t} is not shorter than its alternative`);
        }
        // The weak fence is the court's only bank-wide exit: no way home without busting it.
        fenceFree[b]?.forEach((d, zi) => {
          if (Number.isFinite(d)) err('identity', `shortcut: bank ${b} can reach zone ${zi} without busting a fence (${fmt(d)} m)`);
        });
      });
      // A busted fence must open a real shortcut for safe carriers (both teams benefit).
      for (const t of [0, 1] as TeamId[]) {
        const gain = Math.max(
          0,
          ...safes.map((s) => (s.fenceEffect ? s.fenceEffect.standing[t] - s.fenceEffect.busted[t] : 0)).filter(Number.isFinite),
        );
        if (gain < 10) err('identity', `shortcut: busting fences saves carriers to zone ${t} only ${fmt(gain)} m (< 10)`);
      }
      break;
    }
    case 'counter': {
      // Doors face a shared central intersection reachable equally by both teams.
      const center = { x: def.size.x / 2, y: def.size.y / 2 };
      def.banks.forEach((b, i) => {
        const facing = bankDoorExteriors(b).some((d) => {
          const to = { x: center.x - d.pos.x, y: center.y - d.pos.y };
          const l = Math.hypot(to.x, to.y);
          return l > 0 && (to.x * d.normal.x + to.y * d.normal.y) / l > 0.9;
        });
        if (!facing) err('identity', `counter: bank ${i} has no door facing the central intersection`);
      });
      break;
    }
    case 'tutorial': {
      const r = routes[0];
      if (!r || r.breaksFences.length === 0) err('identity', 'tutorial: the preferred bank route must bust the weak fence');
      // Practice beat "짧은 길의 펜스를 뚫고": the bank cannot get home any other way.
      if (Number.isFinite(fenceFree[0]?.[0] ?? Infinity)) err('identity', `tutorial: the bank can get home around the fence (${fmt(fenceFree[0][0])} m)`);
      const near0 = safes.some((s) => s.walkFromSpawn[0] <= 10);
      if (!near0) err('identity', 'tutorial: needs a small safe within 10 m of the spawn');
      break;
    }
  }
}

/** Human-readable multi-line summary of a report. */
export function formatReport(r: ValidationReport): string {
  const m = r.metrics;
  const lines: string[] = [];
  lines.push(`== ${r.id}  ${r.ok ? 'OK' : 'FAIL'}  (${m.size.x} x ${m.size.y} m, total ${m.totalValue}, outdoor ${m.outdoorSmall}S + ${m.outdoorLarge}L)`);
  lines.push(`   banks ${fmt(m.bankSeparation)} m apart · ${m.fences} fences · ${m.chokepoints} chokepoints · ${m.decor} decor`);
  if (Number.isFinite(m.oneSpot.anyDoor)) {
    lines.push(`   one-spot defense: best spot is ${fmt(m.oneSpot.anyDoor)} m from a door of both banks, ${fmt(m.oneSpot.allDoors)} m from all doors`);
  }
  if (m.fences > 0) {
    lines.push(`   bank without busting fences: ${m.fenceFreeBankTrip.map((row, b) => `b${b} ${row.map((d) => fmt(d)).join('/')}`).join(', ')} m (∞ = blocked)`);
  }
  for (const it of m.interior) {
    lines.push(
      `   interior b${it.bankIndex} ${it.kind === 'smallSafe' ? 'S' : 'L'} (${fmt(it.pos.x)},${fmt(it.pos.y)}): walk t0 ${fmt(it.walk[0])} / t1 ${fmt(it.walk[1])} · carry t0 ${fmt(it.carry[0])} / t1 ${fmt(it.carry[1])}`,
    );
  }
  m.spawnToBank.forEach((row, si) => lines.push(`   spawn ${si} -> bank doors: ${row.map((d, b) => `b${b} ${fmt(d)} m`).join(', ')}`));
  for (const rt of m.routes) {
    lines.push(
      `   route b${rt.bankIndex} -> t${rt.team}: ${fmt(rt.length)} m (straight ${fmt(rt.straight)}), clearance ${fmt(rt.minClearance, 2)}${rt.breaksFences.length ? `, breaks ${rt.breaksFences.join('+')}` : ''}${rt.safesInSweep ? `, ${rt.safesInSweep} safe(s) in sweep` : ''}`,
    );
  }
  for (const s of m.safes) {
    const fe = s.fenceEffect ? ` · fences busted: z0 ${fmt(s.fenceEffect.standing[0])}->${fmt(s.fenceEffect.busted[0])}${s.fenceEffect.standing.length > 1 ? ` z1 ${fmt(s.fenceEffect.standing[1])}->${fmt(s.fenceEffect.busted[1])}` : ''}` : '';
    lines.push(
      `   safe ${s.index} ${s.kind === 'smallSafe' ? 'S' : 'L'} (${fmt(s.pos.x)},${fmt(s.pos.y)}): walk ${s.walkFromSpawn.map((d) => fmt(d)).join('/')} · carry z0 ${fmt(s.carryToZone[0])} z1 ${fmt(s.carryToZone[1])}${fe}`,
    );
  }
  for (const p of m.paths) lines.push(`   ${p.cls.padEnd(6)} ${p.id}: ${fmt(p.minWidth, 3)}..${fmt(p.maxWidth, 3)} m`);
  lines.push(`   bypass: ${m.bypass.combos} bank-position combos, ${m.bypass.failures} failures`);
  m.police.forEach((p, i) =>
    lines.push(`   police ${i}: car parks at (${fmt(p.park.x)},${fmt(p.park.y)}) heading ${fmt((p.angle * 180) / Math.PI, 0)} deg · officer step-out clearance ${fmt(p.stepOutClearance, 2)} m`),
  );
  for (const i of r.issues) lines.push(`   [${i.level}] ${i.code}: ${i.msg}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Cross-layout checks (strings, dressing density, distinct identities)
// ---------------------------------------------------------------------------

export interface LayoutSetInput {
  layouts: Readonly<Record<string, LayoutDef>>;
  matchIds: ReadonlyArray<string>;
  strings: { ko: Record<string, string>; en: Record<string, string> };
  reports: ReadonlyArray<ValidationReport>;
}

/** Every display key a layout references. */
export function layoutStringKeys(def: LayoutDef): string[] {
  const keys = new Set<string>([def.nameKey, def.descKey]);
  for (const c of def.chokepoints) keys.add(c.nameKey);
  for (const s of def.statics) if (s.signKey) keys.add(s.signKey);
  return [...keys];
}

export function validateLayoutSet(input: LayoutSetInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, msg: string): void => void issues.push({ level: 'error', code, msg });
  if (input.matchIds.length !== 3) err('set', `expected 3 match layouts, got ${input.matchIds.length}`);
  for (const def of Object.values(input.layouts)) {
    for (const k of layoutStringKeys(def)) {
      for (const lang of ['ko', 'en'] as const) {
        const v = input.strings[lang][k];
        if (typeof v !== 'string' || v.trim() === '') err('strings', `${def.id}: missing ${lang} string for "${k}"`);
      }
    }
  }
  // Stale entries (renamed chokepoints, retired signs) should not linger in the dictionaries.
  const used = new Set(Object.values(input.layouts).flatMap(layoutStringKeys));
  for (const k of Object.keys(input.strings.ko)) {
    if (!used.has(k)) issues.push({ level: 'warn', code: 'strings', msg: `string "${k}" is not used by any layout` });
  }
  // Shop signs double as landmarks in chokepoint names ("빵집 골목"), so a sign may appear
  // only once per layout or a rival line could point at the wrong shop.
  for (const def of Object.values(input.layouts)) {
    const seen = new Set<string>();
    for (const st of def.statics) {
      if (!st.signKey) continue;
      if (seen.has(st.signKey)) err('strings', `${def.id}: shop sign "${st.signKey}" is used more than once`);
      seen.add(st.signKey);
    }
  }
  // Style vocabulary: every render style is part of the shared asset set.
  for (const def of Object.values(input.layouts)) {
    for (const st of def.statics) {
      if (!st.style) continue;
      const vocab: readonly string[] = st.kind === 'kiosk' ? KIOSK_STYLES : st.kind === 'building' ? SHOP_STYLES : [];
      if (!vocab.includes(st.style)) err('style', `${def.id}: ${st.kind} ${st.id} uses unknown style "${st.style}"`);
    }
  }
  // Dressing: same asset vocabulary, dense and charming.
  for (const id of input.matchIds) {
    const def = input.layouts[id];
    if (!def) {
      err('set', `match layout ${id} missing`);
      continue;
    }
    const shops = def.statics.filter((s) => s.kind === 'building' && s.signKey);
    const styles = new Set(shops.map((s) => s.style));
    const decorKinds = new Set(def.decor.map((d) => d.kind));
    if (shops.length < 10) err('dressing', `${id}: only ${shops.length} signed shop buildings (< 10)`);
    // Same asset vocabulary in every match layout (doc §9 "동일한 광장 자산").
    const count = (kind: string): number =>
      def.statics.filter((s) => s.kind === kind).length + def.circles.filter((c) => c.kind === kind).length;
    for (const [kind, min] of Object.entries(MIN_DRESSING)) {
      const n = count(kind);
      if (n < min) err('dressing', `${id}: only ${n} ${kind}(s) (< ${min})`);
    }
    if (styles.size < 6) err('dressing', `${id}: only ${styles.size} shop styles (< 6)`);
    if (decorKinds.size < 7) err('dressing', `${id}: only ${decorKinds.size} decor kinds (< 7)`);
    if (def.decor.length < 40) err('dressing', `${id}: only ${def.decor.length} decor items (< 40)`);
    if (!def.decor.some((d) => d.kind === 'arrow')) err('dressing', `${id}: no arrows toward the vans`);
  }
  // Distinct identities: plaza has the longest bank trips, counter the shortest.
  const avgRoute = (id: string): number => {
    const r = input.reports.find((q) => q.id === id);
    if (!r) return NaN;
    const firsts = new Map<string, number>();
    for (const rt of r.metrics.routes) {
      const k = `${rt.bankIndex}:${rt.team}`;
      if (!firsts.has(k)) firsts.set(k, rt.length);
    }
    const v = [...firsts.values()];
    return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  };
  const plaza = avgRoute('plaza');
  const counter = avgRoute('counter');
  const shortcut = avgRoute('shortcut');
  if (!(plaza > counter + 5)) err('identity', `plaza bank routes (${fmt(plaza)} m) should be clearly longer than counter's (${fmt(counter)} m)`);
  if (!(shortcut > counter)) err('identity', `shortcut bank routes (${fmt(shortcut)} m) should be longer than counter's (${fmt(counter)} m)`);
  return issues;
}
