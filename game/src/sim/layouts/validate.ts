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
 * Content 2.0 (content-plan §3.2, §6 C4): `validateLayout(def, meta, { content: 'v2' })` checks the
 * map's `LayoutDef.v2` composition with the same machinery (v2 safes replace the classic ones, props
 * join them as loot, breakables join the statics) plus the v2 rules: composition and the 4,000 total,
 * mirror value balance, chirality of every v2 element (props, breakables, item pads, event spots,
 * gimmicks), starter sockets, breakable placement, natural-path crates, item pads, event spots,
 * the 돈나무 haul (propHaul), lanes squeezed but never sealed by breakables / anchored loot, gimmick
 * landing / exit discs, and hammerable fences. The classic composition is validated exactly as before.
 *
 * Used by tools/layout-check.ts (CLI) and test/sim/layouts*.test.ts.
 */
import { BANK_MODEL, BREAKABLE_SPECS, CHARACTER, ITEMS, POLICE, POLICE_CAR, PROP_SPECS, SAFE_SPECS, SCORE, VAN } from '../config';
import { officerStepOutSpot } from '../police';
import type { GimmickDef, LayoutDef, LayoutV2Def, OBB, PropPlacementDef, PropVariant, SafeKind, TeamId, Vec2 } from '../types';
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
/**
 * Wall pockets (stall bug fix): an anchored outdoor safe must sit either flush against a solid
 * (gap <= POCKET_FLUSH) or at least POCKET_MIN_GAP away from every solid, other safe, bank and
 * the arena edge. A gap in between is narrower than a raccoon (0.9 m) plus a margin: a body
 * shoved into it wedges between two opposing contacts.
 */
export const POCKET_MIN_GAP = 1.0;
export const POCKET_FLUSH = 0.08;
/** Decor (visual only) keeps at least this far from loot and breakables, so it never hides them. */
export const DECOR_LOOT_GAP = 0.6;
/** Character center may be this far from a safe's surface and still grab it. */
const GRAB_RANGE = CHARACTER.radius + CHARACTER.reach;

// ---- Content 2.0 (v2 composition) rules, content-plan §3.2 / §5.2 / §5.3 ------------------------

/** Base value of every v2 match map (banks 2,000 + safes 800 + ATMs 400 + 돼지 300 + 돈나무 300 + breakables 200). */
export const V2_TOTAL = 4000;
/** v2 outdoor safes: 2 small (one per side, or both on the axis) + 2 large. */
export const V2_SAFES = { smallSafe: 2, largeSafe: 2 } as const;
/** Props per map: the ATM starter-socket pair, one 돼지저금통 and one 돈나무 on the axis. */
export const V2_PROPS: Readonly<Record<'atm' | 'piggy' | 'moneyTree', number>> = { atm: 2, piggy: 1, moneyTree: 1 };
/** Breakables per side (mirrored): 2 crates + 1 vending machine. */
export const V2_BREAKABLES_PER_SIDE: Readonly<Record<'crate' | 'vending', number>> = { crate: 2, vending: 1 };
/** Starter socket (ATM): walk from the nearest own spawn to a grab spot. */
export const STARTER_WALK = { min: 8, max: 12 } as const;
/** Starter socket: footprint at least this far outside its own zone (m). */
export const STARTER_ZONE_GAP = 6;
/** No breakable (its center) within this distance of any zone edge (m). */
export const BREAKABLE_ZONE_GAP = 6;
/** Natural-path crate: walk from the spawn to a hitting spot. */
export const NATURAL_CRATE_WALK = { min: 5, max: 9 } as const;
/** A crate is on a spawn's natural path when visiting it costs at most this detour (m) on the way to a first target. */
export const NATURAL_PATH_DETOUR = 2.5;
/** Mirrored item pads: walk from the nearest own spawn. */
export const ITEM_PAD_WALK = { min: 12, max: 18 } as const;
/** Item pads: free ground around the pad center (static clearance, m) and gap to loot / breakables. */
export const ITEM_PAD_CLEAR = 0.9;
/**
 * Landing / exit discs (event spots, catapult landings, tube exits, crane drops) clear of solids by
 * 1.2 m (content-plan §6 C4).
 */
export const LANDING_CLEAR = 1.2;
/**
 * Event spot: the 황금 금고 footprint radius + LANDING_CLEAR of free ground (statics, breakables).
 * Loot at start only needs LANDING_CLEAR (it has moved long before the 75-110 s event; a landing
 * on loot falls back to the nearest free spot).
 */
export const EVENT_SPOT_CLEAR = Math.hypot(PROP_SPECS.goldSafe.half.x, PROP_SPECS.goldSafe.half.y) + LANDING_CLEAR;
/** 돈비 ring (content-plan §5.4): bills land 6..9 m around the spot; at least this fraction should be open ground. */
export const EVENT_RING = { min: 6, max: 9, minOpen: 0.5 } as const;
/**
 * propHaul (돈나무): its haul paths to both zones must have no turn tighter than a 2.5 m lane, i.e.
 * a disc of this radius (a 2.4 m wide passage; the 2.5 m lanes pass) reaches both zones.
 */
export const PROP_HAUL_RADIUS = 1.2;
/**
 * Squeeze check: with breakables and anchored loot standing, a large safe carried aligned (its
 * 1.2 m narrow side across, plus a hair) still gets everywhere — lanes may be squeezed, never sealed.
 * Mirrors the bots' NAV_SAFE_CLEARANCE.large (0.55).
 */
export const SQUEEZE_RADIUS = { walk: CHARACTER.radius, small: CHARACTER.radius, large: 0.62 } as const;
/** Hammerable fences: a raccoon can stand within the hammer's reach of the fence (m beyond its surface). */
export const FENCE_HAMMER_REACH = ITEMS.hammer.reach;
/** Both teams' walks to a fence's hammer spots must match within this (m). */
export const FENCE_HAMMER_TOL = 0.75;

/** Coins inside a prop at build (PROP_SPECS inner piles). */
export function propInnerValue(variant: PropVariant): number {
  const i = PROP_SPECS[variant].inner;
  return i.c10 * 10 + i.c50 * 50;
}

/** Shell + coins inside (what recovering the prop intact pays). */
export function propValue(variant: PropVariant): number {
  return PROP_SPECS[variant].shell + propInnerValue(variant);
}

/** Footprint of a prop placement (circle props: the bounding square, as the sim's grab / zone tests). */
export function propOBB(p: PropPlacementDef): OBB {
  return { center: p.pos, half: PROP_SPECS[p.variant].half, angle: p.angle };
}

/** Base value of a v2 composition (banks + interiors + v2 safes + props + breakables' coins). */
export function v2TotalValue(def: LayoutDef, v2: LayoutV2Def): number {
  const interiorValue = BANK_MODEL.interior.reduce((a, s) => a + SCORE[s.kind], 0);
  return (
    def.banks.length * (SCORE.bankBuilding + interiorValue) +
    v2.safes.reduce((a, s) => a + SCORE[s.kind], 0) +
    v2.props.reduce((a, p) => a + propValue(p.variant), 0) +
    v2.breakables.reduce((a, b) => a + BREAKABLE_SPECS[b.kind].inner, 0)
  );
}

/** One loot footprint the validator checks: an outdoor safe, or (v2) a prop. */
export interface LootFootprint {
  /** 'safe 3' for outdoor safes (classic messages unchanged), 'atm 0' / 'piggy 0' / … for props. */
  label: string;
  /** Nav / carry class. */
  kind: SafeKind;
  variant: PropVariant | null;
  pos: Vec2;
  obb: OBB;
  /** Anchored at start (uproot needed); the free-standing 돼지 is not. */
  anchored: boolean;
  /** Clearance disc used for carry reachability (m). */
  carryRadius: number;
  value: number;
}

/** Outdoor safes followed by props (v2), in that order (= SafeMetric.index). */
export function lootFootprints(safes: LayoutDef['safes'], props: ReadonlyArray<PropPlacementDef> = []): LootFootprint[] {
  const out: LootFootprint[] = safes.map((s, i) => ({
    label: `safe ${i}`,
    kind: s.kind,
    variant: null,
    pos: s.pos,
    obb: safeOBB(s),
    anchored: true,
    carryRadius: s.kind === 'smallSafe' ? CLASS_RADIUS.small : CLASS_RADIUS.large,
    value: SCORE[s.kind],
  }));
  const seen: Partial<Record<PropVariant, number>> = {};
  for (const p of props) {
    const spec = PROP_SPECS[p.variant];
    const n = seen[p.variant] ?? 0;
    seen[p.variant] = n + 1;
    const rot = spec.shape === 'circle' ? spec.half.x : Math.hypot(spec.half.x, spec.half.y);
    const cls = spec.kind === 'smallSafe' ? CLASS_RADIUS.small : CLASS_RADIUS.large;
    out.push({
      label: `${p.variant} ${n}`,
      kind: spec.kind,
      variant: p.variant,
      pos: p.pos,
      obb: propOBB(p),
      anchored: spec.uprootTicks > 0,
      carryRadius: p.variant === 'moneyTree' ? PROP_HAUL_RADIUS : Math.max(cls, rot),
      value: propValue(p.variant),
    });
  }
  return out;
}

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
  /** (v2) Prop variant; absent for plain safes. */
  variant?: PropVariant;
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
  /** Content 2.0 measurements (only when validating the v2 composition). */
  v2?: V2Metrics;
}

/** Content 2.0 measurements of a v2 composition. */
export interface V2Metrics {
  /** Value on the west / east half (axis elements excluded); must match. */
  sideValue: [number, number];
  /** Starter-socket ATMs: walk from the nearest own spawn, gap to the own zone, clearance from bank sweeps. */
  starters: { pos: Vec2; walk: number; zoneGap: number; sweepGap: number }[];
  /** Breakables: walk from the nearest spawn (any team), center distance to the nearest zone. */
  breakables: { id: string; kind: string; walk: number; zoneGap: number }[];
  /** Per spawn: the best natural-path crate (walk, detour, target) or null. */
  naturalCrates: ({ id: string; walk: number; detour: number; target: string } | null)[];
  /** Item pads: walk from the nearest own spawn (axis pad: nearest spawn), clearance from bank sweeps. */
  pads: { id: string; twin: string | null; walk: number; sweepGap: number }[];
  /** Event spots: static clearance, gap to loot at start, open fraction of the 돈비 ring. */
  spots: { pos: Vec2; clearance: number; lootGap: number; ringOpen: number }[];
  /** 돈나무 haul (PROP_HAUL_RADIUS disc) per zone. */
  haul: { label: string; toZone: number[] }[];
  /** Fences: nearest walk to a hammer spot per team. */
  fenceHammer: { id: string; walk: number[] }[];
}

export interface ValidationReport {
  id: string;
  /** Which composition was validated. */
  content: 'classic' | 'v2';
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

/** Exact distance between two disjoint convex shapes (<= 0 when they touch or overlap). */
function obbGap(o: OBB, s: Shape): number {
  if (s.type === 'circle') return sdOBB(o, s.center) - s.radius;
  let d = Infinity;
  for (const v of obbCorners(o)) d = Math.min(d, sdOBB(s.obb, v));
  for (const v of obbCorners(s.obb)) d = Math.min(d, sdOBB(o, v));
  return d;
}

export interface SafePocket {
  safe: number;
  gap: number;
  against: string;
}

/**
 * Smallest gap between each outdoor safe (start pose) and any other solid: statics, circles,
 * vans, intact fences, banks at their start pose, other outdoor safes and the arena edge.
 */
export function safeGaps(def: LayoutDef): SafePocket[] {
  return lootGaps(def, lootFootprints(def.safes), []);
}

/**
 * safeGaps for any loot list (v2: safes + props) plus extra solids (v2: breakables). Only anchored
 * loot is measured and counted as a wall (a free-standing 돼지 is pushed aside, it cannot wedge
 * anyone); `safe` = index into `loot`, the gap is +Infinity for free-standing loot.
 */
function lootGaps(def: LayoutDef, loot: ReadonlyArray<LootFootprint>, extra: ReadonlyArray<Shape>): SafePocket[] {
  const shapes = [...obstacles(def, { fences: 'all', banksAtStart: true }), ...extra];
  return loot.map((l, i) => {
    let best: SafePocket = { safe: i, gap: Infinity, against: '' };
    if (!l.anchored) return best;
    const o = l.obb;
    const take = (gap: number, against: string): void => {
      if (gap < best.gap) best = { safe: i, gap, against };
    };
    for (const sh of shapes) {
      const a = shapeAabb(sh);
      if (a.minX > o.center.x + 4 || a.maxX < o.center.x - 4 || a.minY > o.center.y + 4 || a.maxY < o.center.y - 4) continue;
      take(obbGap(o, sh), `${sh.solidKind} ${sh.id}`);
    }
    loot.forEach((q, j) => {
      if (j !== i && q.anchored) take(obbGap(o, { type: 'box', id: `safe${j}`, obb: q.obb, solidKind: 'safe' }), q.label);
    });
    for (const v of obbCorners(o)) take(Math.min(v.x, v.y, def.size.x - v.x, def.size.y - v.y), 'arena edge');
    return best;
  });
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
  return bankSamplesWithFences(def, bankIndex, step).map((s) => s.p);
}

/**
 * bankSamples plus, per sample, the fences the bank has already busted to get there (a sample past
 * the point of a route nearest to a fence it breaks). A position reached by several routes keeps
 * only the fences every one of them busted (conservative).
 */
function bankSamplesWithFences(def: LayoutDef, bankIndex: number, step: number): { p: Vec2; broken: string[] }[] {
  const out: { p: Vec2; broken: string[] }[] = [{ p: def.banks[bankIndex].pos, broken: [] }];
  for (const r of def.bankRoutes) {
    if (r.bankIndex !== bankIndex) continue;
    const pts = samplePolyline(r.points, step);
    const arcs: number[] = [];
    pts.forEach((p, i) => arcs.push(i === 0 ? 0 : arcs[i - 1] + dist(pts[i - 1], p)));
    const fenceArc = r.breaksFences.map((id) => {
      const f = def.fences.find((q) => q.id === id);
      if (!f) return { id, arc: Infinity };
      let best = 0;
      pts.forEach((p, i) => {
        if (dist(p, f.center) < dist(pts[best], f.center)) best = i;
      });
      return { id, arc: arcs[best] };
    });
    pts.forEach((p, i) => {
      const broken = fenceArc.filter((f) => arcs[i] >= f.arc).map((f) => f.id);
      const q = out.find((o) => dist(p, o.p) < step * 0.5);
      if (!q) out.push({ p, broken });
      else q.broken = q.broken.filter((id) => broken.includes(id));
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** Skip the (slowest) bypass combination check. */
  skipBypass?: boolean;
  /**
   * Which composition to validate: the classic one (default; `LayoutDef.safes`, 3,200) or the
   * Content 2.0 `LayoutDef.v2` composition (v2 safes + props + breakables + pads + spots, 4,000).
   */
  content?: 'classic' | 'v2';
}

export function validateLayout(input: LayoutDef, meta: LayoutDesignMeta, opts: ValidateOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const err = (code: string, msg: string): void => void issues.push({ level: 'error', code, msg });
  const warn = (code: string, msg: string): void => void issues.push({ level: 'warn', code, msg });

  const content = opts.content ?? 'classic';
  const v2 = content === 'v2' ? (input.v2 ?? null) : null;
  if (content === 'v2' && !v2) err('v2', `${input.id} has no v2 composition (LayoutDef.v2)`);
  // v2: the v2 safes replace the classic ones (as in the sim's buildV2); props join them as loot.
  const def: LayoutDef = v2 ? { ...input, safes: v2.safes } : input;
  const loot = lootFootprints(def.safes, v2?.props ?? []);
  const breakableShapes: Shape[] = (v2?.breakables ?? []).map((b) => ({ type: 'box', id: b.id, obb: b, solidKind: 'breakable' }));

  const isMatch = def.id !== 'tutorial';
  const axis = def.size.x / 2;

  // ---- counts, size, totals ------------------------------------------------
  const outdoorSmall = def.safes.filter((s) => s.kind === 'smallSafe').length;
  const outdoorLarge = def.safes.filter((s) => s.kind === 'largeSafe').length;
  const interiorValue = BANK_MODEL.interior.reduce((a, s) => a + SCORE[s.kind], 0);
  const totalValue = v2
    ? v2TotalValue(def, v2)
    : outdoorSmall * SCORE.smallSafe + outdoorLarge * SCORE.largeSafe + def.banks.length * (SCORE.bankBuilding + interiorValue);

  if (v2 && !isMatch) err('v2', 'the tutorial stays classic (no v2 composition)');
  if (isMatch) {
    if (def.size.x < MATCH_SIZE.min.x || def.size.x > MATCH_SIZE.max.x || def.size.y < MATCH_SIZE.min.y || def.size.y > MATCH_SIZE.max.y) {
      err('size', `arena ${def.size.x}x${def.size.y} outside ${MATCH_SIZE.min.x}x${MATCH_SIZE.min.y}..${MATCH_SIZE.max.x}x${MATCH_SIZE.max.y}`);
    }
    if (v2) {
      if (outdoorSmall !== V2_SAFES.smallSafe || outdoorLarge !== V2_SAFES.largeSafe) {
        err('loot', `v2 outdoor safes must be ${V2_SAFES.smallSafe} small + ${V2_SAFES.largeSafe} large (got ${outdoorSmall} + ${outdoorLarge})`);
      }
    } else if (outdoorSmall !== 6 || outdoorLarge !== 2) err('loot', `outdoor safes must be 6 small + 2 large (got ${outdoorSmall} + ${outdoorLarge})`);
    if (def.banks.length !== 2) err('banks', `expected 2 banks, got ${def.banks.length}`);
    if (def.zones.length !== 2) err('zones', `expected 2 zones, got ${def.zones.length}`);
    for (const t of [0, 1] as TeamId[]) {
      const n = def.spawns.filter((s) => s.team === t).length;
      if (n !== 2) err('spawns', `team ${t} needs 2 spawns, got ${n}`);
    }
    if (v2) {
      if (totalValue !== V2_TOTAL) err('total', `v2 total value ${totalValue} != ${V2_TOTAL}`);
    } else if (totalValue !== 3200) err('total', `total value ${totalValue} != 3200`);
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
  for (const id of [
    ...def.statics.map((s) => s.id),
    ...def.circles.map((c) => c.id),
    ...def.fences.map((f) => f.id),
    ...(v2?.breakables ?? []).map((b) => b.id),
    ...(v2?.itemPads ?? []).map((p) => p.id),
  ]) {
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
    for (const l of loot) if (obbOverlap(l.obb, zo, 0.5)) err('zone', `${l.variant ?? 'outdoor safe'} at ${fmt(l.pos.x)},${fmt(l.pos.y)} starts in/at zone ${z.team}`);
    for (const b of v2?.breakables ?? []) if (obbOverlap(b, zo)) err('zone', `breakable ${b.id} intrudes into zone ${z.team}`);
    for (const s of def.statics) if (obbOverlap(s, van)) err('van', `static ${s.id} overlaps van ${z.team}`);
    for (const c of def.circles) if (sdOBB(van, c.center) < c.radius) err('van', `circle ${c.id} overlaps van ${z.team}`);
  }

  // ---- overlaps of loot / spawns ---------------------------------------------------
  // (v2: breakables are statics too — loot, spawns, police step-ins and chokepoints keep clear of them)
  const staticShapes = [...obstacles(def, { fences: 'all', banksAtStart: false }), ...breakableShapes];
  const safeObbs = loot.map((l) => l.obb);
  const bankObbs = def.banks.map(bankOBB);
  loot.forEach((l, i) => {
    const so = l.obb;
    if (!obbInside(so, arena, 0.3)) err('safe', `${l.label} too close to the arena edge`);
    for (const sh of staticShapes) {
      const hit = sh.type === 'box' ? obbOverlap(so, sh.obb, 0.05) : sdOBB(so, sh.center) < sh.radius + 0.05;
      if (hit) err('safe', `${l.label} overlaps ${sh.solidKind} ${sh.id}`);
    }
    bankObbs.forEach((bo, b) => {
      if (obbOverlap(so, bo, 0.3)) err('safe', `${l.label} overlaps bank ${b}`);
    });
    for (let j = i + 1; j < loot.length; j++) {
      if (obbOverlap(so, loot[j].obb, 0.3)) err('safe', l.variant || loot[j].variant ? `${l.label} and ${loot[j].label} overlap` : `safes ${i} and ${j} overlap`);
    }
  });
  // wall pockets: a safe is flush with a solid or leaves a raccoon-wide gap (never in between)
  for (const pk of lootGaps(def, loot, breakableShapes)) {
    if (pk.gap > POCKET_FLUSH && pk.gap < POCKET_MIN_GAP) {
      err('pocket', `${loot[pk.safe].label} leaves a ${fmt(pk.gap, 2)} m pocket against ${pk.against} (flush or >= ${POCKET_MIN_GAP} m)`);
    }
  }
  // breakables: inside the arena, never overlapping each other, banks or another static
  (v2?.breakables ?? []).forEach((b, i, all) => {
    if (!obbInside(b, arena, 0.3)) err('breakable', `breakable ${b.id} too close to the arena edge`);
    for (const sh of staticShapes) {
      if (sh.id === b.id) continue;
      const hit = sh.type === 'box' ? obbOverlap(b, sh.obb, 0.05) : sdOBB(b, sh.center) < sh.radius + 0.05;
      if (hit) err('breakable', `breakable ${b.id} overlaps ${sh.solidKind} ${sh.id}`);
    }
    bankObbs.forEach((bo, k) => {
      if (obbOverlap(b, bo, 0.3)) err('breakable', `breakable ${b.id} overlaps bank ${k}`);
    });
    for (let j = i + 1; j < all.length; j++) if (obbOverlap(b, all[j], 0.3)) err('breakable', `breakables ${b.id} and ${all[j].id} overlap`);
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
    // (decor never hides loot or a breakable: an umbrella over an ATM reads as one more cafe table)
    for (const l of loot) if (sdOBB(l.obb, d.pos) < DECOR_LOOT_GAP) err('decor', `decor ${i} (${d.kind}) sits on ${l.label}`);
    for (const b of v2?.breakables ?? []) if (sdOBB(b, d.pos) < DECOR_LOOT_GAP) err('decor', `decor ${i} (${d.kind}) sits on breakable ${b.id}`);
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
    // (v2: a breakable is a static until broken — a bank must never be stopped by a crate)
    const shapes = [...obstacles(def, { fences: standing, banksAtStart: false }), ...breakableShapes];
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
    loot.forEach((l, i) => {
      const d = Math.min(...samplePolyline(r.points, 0.5).map((p) => sdOBB(l.obb, p)));
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
  /** Carry mask per clearance radius (small / large class; v2: the 돈나무 haul disc). */
  const carryMasks = new Map<number, Uint8Array>([
    [CLASS_RADIUS.small, walk],
    [CLASS_RADIUS.large, large],
  ]);
  const carryMask = (r: number): Uint8Array => {
    let m = carryMasks.get(r);
    if (!m) carryMasks.set(r, (m = grid.freeMask(r)));
    return m;
  };
  /** Inset that keeps the whole footprint inside a zone (any rotation). */
  const lootInset = (l: LootFootprint): number => Math.hypot(l.obb.half.x, l.obb.half.y);
  loot.forEach((l, i) => {
    const what = l.variant ?? l.kind;
    const rc = reachCells(l.obb);
    const walkFromSpawn = spawnDist.map((d) => minOver(d, rc));
    walkFromSpawn.forEach((d, si) => {
      if (!Number.isFinite(d)) err('reach', `${l.label} (${what}) unreachable on foot from spawn ${si}`);
    });
    const code = l.variant === 'moneyTree' ? 'propHaul' : 'reach';
    const m = carryMask(l.carryRadius);
    const c = grid.cellOf(l.pos);
    let start = grid.idx(c.i, c.j);
    // (v2) A prop may stand flush on a wall (an ATM against a shop front): it is dragged clear
    // before it turns, so its haul starts from the nearest cell within 1 m of its footprint.
    if (!m[start] && l.variant) {
      const bb = obbAabb(l.obb);
      const near1 = grid.cellsIn(m, { minX: bb.minX - 1, minY: bb.minY - 1, maxX: bb.maxX + 1, maxY: bb.maxY + 1 }, (p) => sdOBB(l.obb, p) <= 1);
      if (near1.length > 0) start = near1.reduce((a, k) => (dist(grid.center(k), l.pos) < dist(grid.center(a), l.pos) ? k : a));
    }
    const carryToZone: number[] = [Infinity, Infinity];
    if (!m[start]) {
      err(code, `${l.label} (${what}) start lacks ${l.variant === 'moneyTree' ? `a ${fmt(2 * l.carryRadius)} m haul lane` : `${l.kind} clearance`} (${fmt(grid.dist[start], 2)} m)`);
    } else {
      const d = grid.distances(m, [start]);
      for (const z of def.zones) {
        carryToZone[z.team] = minOver(d, zoneTargets(m, z, lootInset(l)));
        if (!Number.isFinite(carryToZone[z.team])) {
          err(code, l.variant === 'moneyTree' ? `${l.label} has no haul path to zone ${z.team} without a turn tighter than a ${fmt(2 * l.carryRadius)} m lane` : `${l.label} (${what}) cannot be carried to zone ${z.team}`);
        }
      }
    }
    safeMetrics.push({ index: i, kind: l.kind, ...(l.variant ? { variant: l.variant } : {}), pos: l.pos, walkFromSpawn, carryToZone });
  });

  // Fence effect: how much a busted fence shortens each carry (banks gone in both cases).
  if (def.fences.length > 0) {
    const gStand = new Grid(def, obstacles(def, { fences: 'all', banksAtStart: false }));
    const gOpen = new Grid(def, obstacles(def, { fences: 'none', banksAtStart: false }));
    const masks = {
      stand: { small: gStand.freeMask(CLASS_RADIUS.small), large: gStand.freeMask(CLASS_RADIUS.large) },
      open: { small: gOpen.freeMask(CLASS_RADIUS.small), large: gOpen.freeMask(CLASS_RADIUS.large) },
    };
    loot.forEach((s, i) => {
      const cls = s.kind === 'smallSafe' ? 'small' : 'large';
      const run = (g: Grid, m: Uint8Array): number[] => {
        const c = g.cellOf(s.pos);
        const k = g.idx(c.i, c.j);
        if (!m[k]) return def.zones.map(() => Infinity);
        const d = g.distances(m, [k]);
        return def.zones.map((z) => minOver(d, g.cellsIn(m, obbAabb(zoneOBB(z)), (p) => sdOBB(zoneOBB(z), p) <= -lootInset(s))));
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
    loot.forEach((l) => {
      if (sdOBB(l.obb, c.pos) < CHARACTER.radius) err('choke', `chokepoint ${c.id} sits on ${l.label}`);
    });
    for (const b of v2?.breakables ?? []) if (sdOBB(b, c.pos) < CHARACTER.radius) err('choke', `chokepoint ${c.id} sits on breakable ${b.id}`);
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
    const fenceSamples = def.banks.map((_, b) => bankSamplesWithFences(def, b, BYPASS_SAMPLE_STEP));
    const samples = fenceSamples.map((list) => list.map((q) => q.p));
    /** A bank that rolled past a fence on its route has busted it: the bypass may use the gap. */
    const baseFor = new Map<string, Uint8Array>([['', base]]);
    const maskWithBroken = (broken: ReadonlySet<string>): Uint8Array => {
      const key = [...broken].sort().join('|');
      let m = baseFor.get(key);
      if (!m) {
        const standing = new Set(def.fences.map((f) => f.id).filter((id) => !broken.has(id)));
        const g = new Grid(def, [...obstacles(def, { fences: standing, banksAtStart: false }), ...breakableShapes]);
        baseFor.set(key, (m = g.freeMask(CLASS_RADIUS.small)));
      }
      return m;
    };
    const z0 = def.zones[0];
    const zoneCells = def.zones.map((z) => bgrid.cellsIn(base, obbAabb(zoneOBB(z)), (p) => sdOBB(zoneOBB(z), p) <= -insetFor('smallSafe')));
    const safeInfo = loot.map((s) => ({
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
    const combosBroken: Set<string>[] = [];
    const rec = (b: number, acc: Vec2[], broken: string[]): void => {
      if (b === samples.length) {
        combosList.push([...acc]);
        combosBroken.push(new Set(broken));
        return;
      }
      for (const q of fenceSamples[b]) rec(b + 1, [...acc, q.p], [...broken, ...q.broken]);
    };
    rec(0, [], []);
    const work = new Uint8Array(base.length);
    for (let ci = 0; ci < combosList.length; ci++) {
      const combo = combosList[ci];
      combos++;
      work.set(maskWithBroken(combosBroken[ci]));
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
        if (!loot[i].anchored) return; // (v2) a free-standing 돼지 is shoved along by the banks, never a fixed site
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

  // ---- Content 2.0 composition rules -----------------------------------------------------------------
  const v2Metrics = v2
    ? v2Checks({ def, v2, meta, loot, safeMetrics, breakableShapes, staticShapes, grid, walk, spawnDist, reachCells, minOver, zoneTargets, isMatch, axis, err, warn })
    : undefined;

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
    ...(v2Metrics ? { v2: v2Metrics } : {}),
  };
  return { id: def.id, content, ok: !issues.some((i) => i.level === 'error'), issues, metrics };
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

// ---------------------------------------------------------------------------
// Content 2.0: v2 composition rules (content-plan §3.2, §5.2–5.4, §6 C4)
// ---------------------------------------------------------------------------

interface V2CheckInput {
  /** The layout seen with its v2 safes (as the sim builds it). */
  def: LayoutDef;
  v2: LayoutV2Def;
  meta: LayoutDesignMeta;
  loot: LootFootprint[];
  safeMetrics: SafeMetric[];
  breakableShapes: Shape[];
  /** Statics + circles + vans + intact fences + breakables (no banks). */
  staticShapes: Shape[];
  /** Reachability grid: banks at start, fences standing, no breakables. */
  grid: Grid;
  walk: Uint8Array;
  spawnDist: Float64Array[];
  reachCells: (o: OBB) => number[];
  minOver: (d: Float64Array, cells: number[]) => number;
  zoneTargets: (m: Uint8Array, z: LayoutDef['zones'][number], inset: number) => number[];
  isMatch: boolean;
  axis: number;
  err: (code: string, msg: string) => void;
  warn: (code: string, msg: string) => void;
}

/** Signed gap between two boxes (<= 0 when they touch or overlap). */
function boxGap(a: OBB, b: OBB): number {
  return obbOverlap(a, b) ? 0 : obbGap(a, { type: 'box', id: '', obb: b, solidKind: '' });
}

/** Team whose half a point lies on (null on the axis). */
function sideOf(x: number, axis: number): TeamId | null {
  return Math.abs(x - axis) < 1e-3 ? null : x < axis ? 0 : 1;
}

function v2Checks(c: V2CheckInput): V2Metrics {
  const { def, v2, loot, grid, walk, spawnDist, reachCells, minOver, axis, err, warn } = c;
  const onAxis = (x: number): boolean => Math.abs(x - axis) < 1e-3;
  const mp = (p: Vec2): Vec2 => mirrorPoint(p, axis);
  const at = (p: Vec2): string => `${fmt(p.x)},${fmt(p.y)}`;
  const cellIdx = (p: Vec2): number => {
    const q = grid.cellOf(p);
    const i = Math.max(0, Math.min(grid.nx - 1, q.i));
    const j = Math.max(0, Math.min(grid.ny - 1, q.j));
    return grid.idx(i, j);
  };
  const teamSpawns = (t: TeamId): number[] => def.spawns.map((s, i) => (s.team === t ? i : -1)).filter((i) => i >= 0);
  const nearestOwnWalk = (t: TeamId | null, cells: number[]): number => {
    const ids = t === null ? def.spawns.map((_, i) => i) : teamSpawns(t);
    return ids.reduce((a, si) => Math.min(a, minOver(spawnDist[si], cells)), Infinity);
  };
  const sweepGapPoint = (p: Vec2): number =>
    def.bankRoutes.reduce((a, r) => Math.min(a, distPointPolyline(p, r.points)), Infinity) - BANK_SWEEP_RADIUS;
  const sweepGapObb = (o: OBB): number =>
    def.bankRoutes.reduce((a, r) => Math.min(a, ...samplePolyline(r.points, 0.5).map((p) => sdOBB(o, p))), Infinity) - BANK_SWEEP_RADIUS;
  const zoneOf = (t: TeamId): LayoutDef['zones'][number] | undefined => def.zones.find((z) => z.team === t);
  const bankObbs = def.banks.map(bankOBB);
  const props = loot.filter((l) => l.variant !== null);

  // ---- composition --------------------------------------------------------------------------------
  if (c.isMatch) {
    for (const [variant, n] of Object.entries(V2_PROPS) as [keyof typeof V2_PROPS, number][]) {
      const got = props.filter((l) => l.variant === variant).length;
      if (got !== n) err('v2', `needs ${n} ${variant} prop(s), got ${got}`);
    }
    for (const l of props) {
      if (l.variant === 'goldSafe') err('v2', `${l.label}: the 황금 금고 is event loot, never placed by a layout`);
      if ((l.variant === 'piggy' || l.variant === 'moneyTree') && !onAxis(l.pos.x)) err('v2', `${l.label} must sit on the mirror axis`);
      if (l.variant === 'atm' && onAxis(l.pos.x)) err('v2', `${l.label}: the ATM starter socket is a mirrored pair, not an axis prop`);
    }
    for (const t of [0, 1] as TeamId[]) {
      for (const [kind, n] of Object.entries(V2_BREAKABLES_PER_SIDE) as [keyof typeof V2_BREAKABLES_PER_SIDE, number][]) {
        const got = v2.breakables.filter((b) => b.kind === kind && sideOf(b.center.x, axis) === t).length;
        if (got !== n) err('v2', `team ${t} side needs ${n} ${kind}(s), got ${got}`);
      }
    }
    for (const b of v2.breakables) if (onAxis(b.center.x)) err('v2', `breakable ${b.id} sits on the axis (breakables are per-side mirrored pairs)`);
    const axisPads = v2.itemPads.filter((p) => p.twin === null);
    if (axisPads.length !== 1) err('pads', `needs exactly 1 axis item pad, got ${axisPads.length}`);
    if (v2.itemPads.filter((p) => p.twin !== null).length < 2) err('pads', 'needs at least one mirrored item pad pair');
    if (v2.itemPads.length > 5) warn('pads', `${v2.itemPads.length} item pads: more drop spots than the readability budget (<= 4 pickups on the field) can fill`);
    if (v2.eventSpots.length < 1) err('spots', 'needs at least one event spot (spot 0 on the axis)');
  }
  if (v2.gimmicks.length > 0 && v2.gimmicks.filter((g) => g.kind !== 'slick').length > 3) {
    warn('gimmick', `${v2.gimmicks.length} gimmicks: the readability budget is one signature hazard + at most two interactables`);
  }

  // ---- chirality (mirror twins) -------------------------------------------------------------------------
  if (c.isMatch) {
    for (const l of props) {
      const m = mirroredBox(l.obb, axis);
      if (!props.some((t) => t.variant === l.variant && sameBox(t.obb, m))) err('symmetry', `${l.label} at ${at(l.pos)} has no mirror twin`);
    }
    for (const b of v2.breakables) {
      const m = mirroredBox(b, axis);
      if (!v2.breakables.some((t) => t.kind === b.kind && sameBox(t, m))) err('symmetry', `breakable ${b.id} has no mirror twin`);
    }
    const byId = new Map(v2.itemPads.map((p) => [p.id, p]));
    for (const p of v2.itemPads) {
      if (p.twin === null) {
        if (!onAxis(p.pos.x)) err('symmetry', `axis item pad ${p.id} is off the axis (x ${fmt(p.pos.x, 2)})`);
        continue;
      }
      const t = byId.get(p.twin);
      if (!t || t.twin !== p.id || t.id === p.id) err('symmetry', `item pad ${p.id}: twin ${p.twin} must exist and name it back`);
      else if (!nearV(t.pos, mp(p.pos))) err('symmetry', `item pad ${p.id} and its twin ${t.id} are not mirrored`);
    }
    v2.eventSpots.forEach((s, i) => {
      if (i === 0 && !onAxis(s.x)) err('spots', `event spot 0 must sit on the mirror axis (x ${fmt(s.x, 2)})`);
      if (!onAxis(s.x) && !v2.eventSpots.some((q) => nearV(q, mp(s)))) err('symmetry', `event spot ${i} at ${at(s)} has no mirror twin`);
    });
    gimmickChirality(v2.gimmicks, axis, err);
  }

  // ---- mirror value balance ----------------------------------------------------------------------------
  const sideValue: [number, number] = [0, 0];
  const addSide = (x: number, v: number): void => {
    const t = sideOf(x, axis);
    if (t !== null) sideValue[t] += v;
  };
  for (const l of loot) addSide(l.pos.x, l.value);
  for (const b of v2.breakables) addSide(b.center.x, BREAKABLE_SPECS[b.kind].inner);
  if (c.isMatch && sideValue[0] !== sideValue[1]) err('balance', `value per half differs: west ${sideValue[0]} vs east ${sideValue[1]}`);

  // ---- starter sockets (ATM) -----------------------------------------------------------------------------
  const starters: V2Metrics['starters'] = [];
  for (const l of props.filter((p) => p.variant === 'atm')) {
    const t = sideOf(l.pos.x, axis);
    const z = t === null ? undefined : zoneOf(t);
    const walkD = nearestOwnWalk(t, reachCells(l.obb));
    const zoneGap = z ? boxGap(l.obb, zoneOBB(z)) : Infinity;
    const sweepGap = sweepGapObb(l.obb);
    starters.push({ pos: l.pos, walk: walkD, zoneGap, sweepGap });
    if (!(walkD >= STARTER_WALK.min - 1e-6 && walkD <= STARTER_WALK.max + 1e-6)) {
      err('starter', `${l.label} at ${at(l.pos)} is a ${fmt(walkD)} m walk from the nearest own spawn (starter socket: ${STARTER_WALK.min}..${STARTER_WALK.max} m)`);
    }
    if (zoneGap < STARTER_ZONE_GAP - 1e-6) err('starter', `${l.label} at ${at(l.pos)} is only ${fmt(zoneGap, 2)} m outside its zone (>= ${STARTER_ZONE_GAP})`);
    if (sweepGap < -1e-6) err('starter', `${l.label} at ${at(l.pos)} lies in a bank-route sweep (${fmt(sweepGap + BANK_SWEEP_RADIUS, 2)} m from a route)`);
  }

  // ---- breakables ------------------------------------------------------------------------------------------
  const breakables: V2Metrics['breakables'] = [];
  const hitCells = new Map<string, number[]>();
  for (const b of v2.breakables) {
    const cells = reachCells(b);
    hitCells.set(b.id, cells);
    // "none within 6 m of a zone edge": measured from the breakable's position (its center)
    const zoneGap = def.zones.reduce((a, z) => Math.min(a, sdOBB(zoneOBB(z), b.center)), Infinity);
    const walkD = nearestOwnWalk(null, cells);
    breakables.push({ id: b.id, kind: b.kind, walk: walkD, zoneGap });
    if (zoneGap < BREAKABLE_ZONE_GAP - 1e-6) err('breakable', `breakable ${b.id} is only ${fmt(zoneGap, 2)} m from a zone (>= ${BREAKABLE_ZONE_GAP})`);
    if (!Number.isFinite(walkD)) err('breakable', `breakable ${b.id} cannot be reached on foot`);
    // A 0.9 m crate in a 1.1 m alley does not squeeze it, it plugs it (small-safe carries included).
    for (const path of c.meta.paths) {
      if (path.cls !== 'narrow') continue;
      if (distPointPolyline(b.center, [path.a, path.b]) < PATH_CLASS_WIDTH.narrow.max / 2 + Math.hypot(b.half.x, b.half.y)) {
        err('breakable', `breakable ${b.id} plugs narrow alley ${path.id}`);
      }
    }
  }

  // ---- natural-path crates: per spawn, a crate 5..9 m out on the way to a first target ------------------------
  const naturalCrates: V2Metrics['naturalCrates'] = [];
  const targetsFor = (t: TeamId): { name: string; cells: number[] }[] => {
    const out: { name: string; cells: number[] }[] = [];
    for (const l of loot) {
      const side = sideOf(l.pos.x, axis);
      const first = l.variant === 'atm' || l.variant === 'piggy' || l.variant === 'moneyTree' || l.kind === 'smallSafe';
      if (first && (side === null || side === t)) out.push({ name: l.label, cells: reachCells(l.obb) });
    }
    def.banks.forEach((b, bi) => {
      const cells = bankDoorExteriors(b).flatMap((d) => grid.cellsIn(walk, { minX: d.pos.x - 0.6, minY: d.pos.y - 0.6, maxX: d.pos.x + 0.6, maxY: d.pos.y + 0.6 }, () => true));
      out.push({ name: `bank ${bi} door`, cells });
    });
    for (const p of v2.itemPads) {
      const side = sideOf(p.pos.x, axis);
      if (side === null || side === t) out.push({ name: `pad ${p.id}`, cells: [cellIdx(p.pos)] });
    }
    return out;
  };
  const crateFields = new Map<string, Float64Array>();
  def.spawns.forEach((s, si) => {
    const targets = targetsFor(s.team);
    let best: V2Metrics['naturalCrates'][number] = null;
    for (const b of v2.breakables) {
      if (b.kind !== 'crate') continue;
      const cells = hitCells.get(b.id) ?? [];
      const w = minOver(spawnDist[si], cells);
      if (!(w >= NATURAL_CRATE_WALK.min - 1e-6 && w <= NATURAL_CRATE_WALK.max + 1e-6)) continue;
      let field = crateFields.get(b.id);
      if (!field) crateFields.set(b.id, (field = grid.distances(walk, cells)));
      for (const t of targets) {
        const direct = minOver(spawnDist[si], t.cells);
        if (!Number.isFinite(direct)) continue;
        const detour = Math.max(0, w + minOver(field, t.cells) - direct);
        if (detour <= NATURAL_PATH_DETOUR + 1e-6 && (!best || detour < best.detour)) best = { id: b.id, walk: w, detour, target: t.name };
      }
    }
    naturalCrates.push(best);
    if (c.isMatch && !best) {
      err('crate', `spawn ${si} has no crate on its natural path (${NATURAL_CRATE_WALK.min}..${NATURAL_CRATE_WALK.max} m walk, <= ${NATURAL_PATH_DETOUR} m detour toward a first target)`);
    }
  });

  // ---- item pads --------------------------------------------------------------------------------------------
  const pads: V2Metrics['pads'] = [];
  const lootGapAt = (p: Vec2): number =>
    Math.min(
      ...loot.map((l) => sdOBB(l.obb, p)),
      ...bankObbs.map((o) => sdOBB(o, p)),
      ...v2.breakables.map((b) => sdOBB(b, p)),
      Infinity,
    );
  for (const p of v2.itemPads) {
    const t = sideOf(p.pos.x, axis);
    const k = cellIdx(p.pos);
    const clear = clearanceAt(def, c.staticShapes, p.pos);
    const gap = lootGapAt(p.pos);
    const walkD = t === null ? nearestOwnWalk(null, [k]) : nearestOwnWalk(t, [k]);
    const sweepGap = sweepGapPoint(p.pos);
    pads.push({ id: p.id, twin: p.twin, walk: walkD, sweepGap });
    if (clear < ITEM_PAD_CLEAR) err('pads', `item pad ${p.id} at ${at(p.pos)} has ${fmt(clear, 2)} m of free ground (>= ${ITEM_PAD_CLEAR})`);
    if (gap < ITEM_PAD_CLEAR) err('pads', `item pad ${p.id} at ${at(p.pos)} sits ${fmt(gap, 2)} m from loot / a breakable (>= ${ITEM_PAD_CLEAR})`);
    if (!def.spawns.every((_, si) => Number.isFinite(spawnDist[si][k]))) err('pads', `item pad ${p.id} at ${at(p.pos)} is not reachable from every spawn`);
    if (t !== null) {
      if (!(walkD >= ITEM_PAD_WALK.min - 1e-6 && walkD <= ITEM_PAD_WALK.max + 1e-6)) {
        err('pads', `item pad ${p.id} at ${at(p.pos)} is a ${fmt(walkD)} m walk from the nearest own spawn (${ITEM_PAD_WALK.min}..${ITEM_PAD_WALK.max})`);
      }
      if (sweepGap < 0) err('pads', `item pad ${p.id} at ${at(p.pos)} lies in a bank-route sweep (${fmt(sweepGap + BANK_SWEEP_RADIUS, 2)} m from a route)`);
    } else if (sweepGap < 0) {
      // The axis pad is the contested middle (황금 뿅망치). A bank rolling over a ground item is
      // harmless (items are not bodies), but a pad clear of the sweeps reads better.
      warn('pads', `axis item pad ${p.id} lies in a bank-route sweep (${fmt(sweepGap + BANK_SWEEP_RADIUS, 2)} m from a route)`);
    }
  }

  // ---- event spots --------------------------------------------------------------------------------------------
  const spots: V2Metrics['spots'] = [];
  v2.eventSpots.forEach((s, i) => {
    const clear = clearanceAt(def, c.staticShapes, s);
    const gap = lootGapAt(s);
    const k = cellIdx(s);
    let open = 0;
    let total = 0;
    for (const r of [EVENT_RING.min, (EVENT_RING.min + EVENT_RING.max) / 2, EVENT_RING.max]) {
      for (let a = 0; a < 48; a++) {
        const q = { x: s.x + r * Math.cos((a / 48) * 2 * Math.PI), y: s.y + r * Math.sin((a / 48) * 2 * Math.PI) };
        total++;
        if (q.x < 0 || q.y < 0 || q.x > def.size.x || q.y > def.size.y) continue;
        if (walk[cellIdx(q)]) open++;
      }
    }
    const ringOpen = open / total;
    spots.push({ pos: { ...s }, clearance: clear, lootGap: gap, ringOpen });
    if (clear < EVENT_SPOT_CLEAR - 1e-6) err('spots', `event spot ${i} at ${at(s)}: landing disc has ${fmt(clear, 2)} m of free ground (>= ${fmt(EVENT_SPOT_CLEAR, 2)})`);
    if (gap < LANDING_CLEAR - 1e-6) err('spots', `event spot ${i} at ${at(s)} is ${fmt(gap, 2)} m from loot / a breakable at start (>= ${LANDING_CLEAR})`);
    if (!def.spawns.every((_, si) => Number.isFinite(spawnDist[si][k]))) err('spots', `event spot ${i} at ${at(s)} is not reachable from every spawn`);
    if (ringOpen < EVENT_RING.minOpen) warn('spots', `event spot ${i}: only ${Math.round(ringOpen * 100)} % of the ${EVENT_RING.min}..${EVENT_RING.max} m 돈비 ring is open ground`);
    for (const p of v2.itemPads) {
      if (p.twin === null && dist(p.pos, s) < 3) warn('spots', `event spot ${i} is ${fmt(dist(p.pos, s), 2)} m from the axis item pad (keep the two beats apart)`);
    }
  });

  // ---- 돈나무 haul (propHaul: carry check with PROP_HAUL_RADIUS above) -------------------------------------------
  const haul = loot
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.variant === 'moneyTree')
    .map(({ l, i }) => ({ label: l.label, toZone: c.safeMetrics[i]?.carryToZone ?? [Infinity, Infinity] }));

  // ---- squeeze: breakables + anchored loot squeeze lanes but never seal them -----------------------------------------
  {
    const blockers: Shape[] = [...obstacles(def, { fences: 'all', banksAtStart: true }), ...c.breakableShapes];
    loot.forEach((l, i) => {
      if (l.anchored) blockers.push({ type: 'box', id: l.label, obb: l.obb, solidKind: `loot${i}` });
    });
    const sg = new Grid(def, blockers);
    const sWalk = sg.freeMask(SQUEEZE_RADIUS.walk);
    const sLarge = sg.freeMask(SQUEEZE_RADIUS.large);
    const zoneCells = (m: Uint8Array, inset: number): number[][] =>
      def.zones.map((z) => sg.cellsIn(m, obbAabb(zoneOBB(z)), (p) => sdOBB(zoneOBB(z), p) <= -inset));
    // On foot: every spawn reaches both zones and a grab spot of every loot item.
    def.spawns.forEach((s, si) => {
      const q = sg.cellOf(s.pos);
      const reached = sg.flood(sWalk, [sg.idx(q.i, q.j)]);
      zoneCells(sWalk, 0.5).forEach((cells, zi) => {
        if (!cells.some(reached)) err('squeeze', `spawn ${si} is sealed off from zone ${def.zones[zi].team} by breakables / anchored loot`);
      });
      loot.forEach((l) => {
        const bb = obbAabb(l.obb);
        const cells = sg.cellsIn(sWalk, { minX: bb.minX - GRAB_RANGE, minY: bb.minY - GRAB_RANGE, maxX: bb.maxX + GRAB_RANGE, maxY: bb.maxY + GRAB_RANGE }, (p) => {
          const d = sdOBB(l.obb, p);
          return d > 0 && d <= GRAB_RANGE;
        });
        if (!cells.some(reached)) err('squeeze', `${l.label} is sealed off from spawn ${si} by breakables / anchored loot`);
      });
    });
    // Carried (aligned): every loot item, once uprooted, still gets home through the squeezed lanes.
    loot.forEach((l) => {
      if (l.variant === 'moneyTree') return; // its haul lane is checked without breakables (one dash clears a crate)
      const m = l.kind === 'smallSafe' ? sWalk : sLarge;
      const r = l.kind === 'smallSafe' ? SQUEEZE_RADIUS.small : SQUEEZE_RADIUS.large;
      const bb = obbAabb(l.obb);
      const seeds = sg.cellsIn(m, { minX: bb.minX - 1.5, minY: bb.minY - 1.5, maxX: bb.maxX + 1.5, maxY: bb.maxY + 1.5 }, (p) => sdOBB(l.obb, p) <= r + 1.0);
      const reached = sg.flood(m, seeds);
      zoneCells(m, 0.5).forEach((cells, zi) => {
        if (!cells.some(reached)) err('squeeze', `${l.label} (${l.variant ?? l.kind}) cannot be carried to zone ${def.zones[zi].team} past breakables / anchored loot`);
      });
    });
  }

  // ---- hammerable fences (design §22.1-4: two 뿅망치 hits break a fence) -------------------------------------------
  const fenceHammer: V2Metrics['fenceHammer'] = [];
  for (const f of def.fences) {
    const bb = obbAabb(f);
    const r = FENCE_HAMMER_REACH;
    const cells = grid.cellsIn(walk, { minX: bb.minX - r, minY: bb.minY - r, maxX: bb.maxX + r, maxY: bb.maxY + r }, (p) => {
      const d = sdOBB(f, p);
      return d > 0 && d <= r;
    });
    const w = ([0, 1] as TeamId[]).map((t) => nearestOwnWalk(t, cells));
    fenceHammer.push({ id: f.id, walk: w });
    if (!w.every(Number.isFinite)) err('fenceHammer', `fence ${f.id} has no spot within hammer reach (${r} m) both teams can walk to`);
    else if (c.isMatch && Math.abs(w[0] - w[1]) > FENCE_HAMMER_TOL) err('fenceHammer', `fence ${f.id}: hammer spots are ${fmt(w[0])} / ${fmt(w[1])} m away for team 0 / 1`);
  }

  // ---- gimmick landing / exit discs ----------------------------------------------------------------------------------
  for (const g of v2.gimmicks) {
    const discs: { what: string; p: Vec2 }[] = [];
    if (g.kind === 'catapult') discs.push({ what: 'landing', p: g.landing });
    if (g.kind === 'tube') discs.push({ what: 'exit', p: g.exit });
    if (g.kind === 'crane') g.drops.forEach((p, t) => discs.push({ what: `drop ${t}`, p }));
    for (const d of discs) {
      const clear = clearanceAt(def, c.staticShapes, d.p);
      if (clear < LANDING_CLEAR - 1e-6) err('landing', `gimmick ${g.id} ${d.what} at ${at(d.p)} is ${fmt(clear, 2)} m from a solid (>= ${LANDING_CLEAR})`);
    }
  }

  // ---- anchored props in a bank's body path (warn: the bank stops until someone uproots it) -------------------------
  for (const l of props) {
    if (!l.anchored) continue;
    const hit = def.bankRoutes.some((r) => samplePolyline(r.points, 0.5).some((p) => sdOBB(l.obb, p) < Math.min(BANK_MODEL.half.x, BANK_MODEL.half.y)));
    if (hit) warn('bankPath', `${l.label} at ${at(l.pos)} sits in a bank's path: the bank stops on it until someone uproots it`);
  }

  return { sideValue, starters, breakables, naturalCrates, pads, spots, haul, fenceHammer };
}

/** Geometry fields of a gimmick, mirrored (for twin / axis-symmetry comparison). */
function mirrorGimmick(g: GimmickDef, axis: number): GimmickDef {
  const mb = (o: OBB): OBB => mirroredBox(o, axis);
  const mp = (p: Vec2): Vec2 => mirrorPoint(p, axis);
  switch (g.kind) {
    case 'belt':
      return { ...g, obb: mb(g.obb), dir: mirrorAngle(g.dir) };
    case 'fountainShow':
      return { ...g, center: mp(g.center) };
    case 'tube':
      return { ...g, intake: mb(g.intake), exit: mp(g.exit), exitDir: mirrorAngle(g.exitDir) };
    case 'catapult':
      return { ...g, seat: mb(g.seat), pedal: mb(g.pedal), landing: mp(g.landing) };
    case 'crane':
      return { ...g, base: mp(g.base), cab: mp(g.cab), pads: [mb(g.pads[1]), mb(g.pads[0])], drops: [mp(g.drops[1]), mp(g.drops[0])] };
    case 'stomper':
      return { ...g, center: mp(g.center) };
    case 'teacup':
      return { ...g, center: mp(g.center), spin: g.spin === 1 ? -1 : 1 };
    case 'slick':
      return { ...g, obb: mb(g.obb) };
    case 'bumperCar':
      return { ...g, path: g.path.map(mp) };
    case 'wheel':
      return { ...g, platform: mb(g.platform) };
  }
}

/** Same geometry + timing (ids / twin links ignored). Boxes compare as corner sets, angles mod 2π. */
function sameGimmick(a: GimmickDef, b: GimmickDef): boolean {
  if (a.kind !== b.kind) return false;
  const ang = (x: number, y: number): boolean => near(Math.cos(x), Math.cos(y)) && near(Math.sin(x), Math.sin(y));
  const rec = (x: unknown, y: unknown, key: string): boolean => {
    if (key === 'id' || key === 'twin') return true;
    if (typeof x === 'number' && typeof y === 'number') return key === 'dir' || key === 'exitDir' ? ang(x, y) : near(x, y);
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => rec(v, y[i], key));
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const ox = x as Record<string, unknown>;
      const oy = y as Record<string, unknown>;
      if ('center' in ox && 'half' in ox && 'angle' in ox) return sameBox(ox as unknown as OBB, oy as unknown as OBB);
      const keys = new Set([...Object.keys(ox), ...Object.keys(oy)]);
      return [...keys].every((k) => rec(ox[k], oy[k], k));
    }
    return x === y;
  };
  return rec(a, b, '');
}

/**
 * Chirality rule (content-plan §5.3): anything that moves or rotates either sits on the axis with an
 * axis-symmetric effect, or is a mirrored twin moving in mirrored phase (opposite spin, same phase).
 * Per-team devices (tube, catapult) and anything that spins or runs a path (teacup, bumper car) always
 * need a twin; the crane serves both teams from the axis (pads / drops mirrored).
 */
function gimmickChirality(gimmicks: ReadonlyArray<GimmickDef>, axis: number, err: (code: string, msg: string) => void): void {
  const byId = new Map(gimmicks.map((g) => [g.id, g]));
  for (const g of gimmicks) {
    const m = mirrorGimmick(g, axis);
    const twinId = 'twin' in g ? g.twin : undefined;
    if (twinId) {
      const t = byId.get(twinId);
      if (!t || t.kind !== g.kind || !('twin' in t) || t.twin !== g.id || t.id === g.id) {
        err('chirality', `gimmick ${g.id}: twin ${twinId} must exist, be a ${g.kind} and name it back`);
      } else if (!sameGimmick(m, t)) {
        err('chirality', `gimmick ${g.id} and its twin ${t.id} are not mirrored (geometry, opposite spin, same phase)`);
      }
      continue;
    }
    const needsTwin = g.kind === 'tube' || g.kind === 'catapult' || g.kind === 'teacup' || g.kind === 'bumperCar';
    if (needsTwin) {
      err('chirality', `gimmick ${g.id} (${g.kind}) needs a mirrored twin`);
      continue;
    }
    // Axis-symmetric by itself, or an unlinked mirrored counterpart of the same kind (belts / slicks).
    if (!sameGimmick(m, g) && !gimmicks.some((t) => t !== g && sameGimmick(m, t))) {
      err('chirality', `gimmick ${g.id} (${g.kind}) is neither axis-symmetric nor mirrored by another ${g.kind}`);
    }
  }
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
      // Outer small safes easy to reach: each spawn has two small safes within 20 m on foot
      // (v2: the starter-socket ATM is the second early pick beside the corner small safe).
      def.spawns.forEach((_, si) => {
        const close = safes.filter((s) => (s.kind === 'smallSafe' || s.variant === 'atm') && s.walkFromSpawn[si] <= 20).length;
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
  const tag = r.content === 'v2' ? ' [v2]' : '';
  lines.push(`== ${r.id}${tag}  ${r.ok ? 'OK' : 'FAIL'}  (${m.size.x} x ${m.size.y} m, total ${m.totalValue}, outdoor ${m.outdoorSmall}S + ${m.outdoorLarge}L)`);
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
      `   ${s.variant ? `${s.variant} ${s.index}` : `safe ${s.index} ${s.kind === 'smallSafe' ? 'S' : 'L'}`} (${fmt(s.pos.x)},${fmt(s.pos.y)}): walk ${s.walkFromSpawn.map((d) => fmt(d)).join('/')} · carry z0 ${fmt(s.carryToZone[0])} z1 ${fmt(s.carryToZone[1])}${fe}`,
    );
  }
  for (const p of m.paths) lines.push(`   ${p.cls.padEnd(6)} ${p.id}: ${fmt(p.minWidth, 3)}..${fmt(p.maxWidth, 3)} m`);
  lines.push(`   bypass: ${m.bypass.combos} bank-position combos, ${m.bypass.failures} failures`);
  m.police.forEach((p, i) =>
    lines.push(`   police ${i}: car parks at (${fmt(p.park.x)},${fmt(p.park.y)}) heading ${fmt((p.angle * 180) / Math.PI, 0)} deg · officer step-out clearance ${fmt(p.stepOutClearance, 2)} m`),
  );
  const v = m.v2;
  if (v) {
    lines.push(`   v2 value per half: west ${v.sideValue[0]} / east ${v.sideValue[1]}`);
    for (const st of v.starters) {
      lines.push(`   starter ATM (${fmt(st.pos.x)},${fmt(st.pos.y)}): walk ${fmt(st.walk)} m · ${fmt(st.zoneGap, 2)} m outside its zone · ${fmt(st.sweepGap + BANK_SWEEP_RADIUS, 2)} m from a bank route`);
    }
    for (const b of v.breakables) lines.push(`   breakable ${b.id} (${b.kind}): walk ${fmt(b.walk)} m · ${fmt(b.zoneGap, 2)} m from a zone`);
    v.naturalCrates.forEach((n, si) =>
      lines.push(`   spawn ${si} natural crate: ${n ? `${n.id} at ${fmt(n.walk)} m (detour ${fmt(n.detour, 2)} m toward ${n.target})` : 'none'}`),
    );
    for (const p of v.pads) {
      lines.push(`   item pad ${p.id}${p.twin ? ` (twin ${p.twin})` : ' (axis)'}: walk ${fmt(p.walk)} m · ${fmt(p.sweepGap + BANK_SWEEP_RADIUS, 2)} m from a bank route`);
    }
    v.spots.forEach((sp, i) =>
      lines.push(`   event spot ${i} (${fmt(sp.pos.x)},${fmt(sp.pos.y)}): clearance ${fmt(sp.clearance, 2)} m · loot ${fmt(sp.lootGap, 2)} m · 돈비 ring ${Math.round(sp.ringOpen * 100)} % open`),
    );
    for (const h of v.haul) lines.push(`   ${h.label} haul (${fmt(2 * PROP_HAUL_RADIUS)} m lanes): z0 ${fmt(h.toZone[0])} z1 ${fmt(h.toZone[1])} m`);
    for (const f of v.fenceHammer) lines.push(`   fence ${f.id} hammer spot: t0 ${fmt(f.walk[0])} / t1 ${fmt(f.walk[1])} m`);
  }
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
