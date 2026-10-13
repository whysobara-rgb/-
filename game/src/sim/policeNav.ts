/**
 * Police navigation grid (owner addition beyond doc v0.5). Lives inside the sim so officer
 * movement is deterministic and identical for every client.
 *
 * - 0.5 m cells, cell (i, j) centered at ((i + 0.5) * CELL, (j + 0.5) * CELL).
 * - Two blocking layers: `stat` (layout statics, circles, vans, arena boundary — built once)
 *   and `dyn` (intact fences, unrecovered bank walls, resting safes — re-stamped every few
 *   ticks by the caller). Bank doors stay open, so officers walk into bank interiors.
 * - A cell is HARD-blocked when its center is closer than HARD_R to an obstacle (small on
 *   purpose so 1.1 m alleys stay walkable on a 0.5 m grid; physics keeps the 0.42 m body
 *   off the walls) and SOFT (costlier) within SOFT_R, so paths prefer the middle of lanes.
 * - A* (8-connected, no corner cutting, octile heuristic, bounded expansions) + greedy
 *   string-pulling. Fixed iteration order everywhere; no randomness. Searches run in a
 *   mirror-canonical frame (see findPath) so mirrored situations get mirror-image paths.
 */
import { BANK_MODEL } from './config';
import type { SimContext } from './context';
import { SHAPE_CIRCLE } from './physics';
import type { Vec2 } from './types';

export const NAV_CELL = 0.5;
/** Hard block radius around obstacles (cell centers closer than this are not walkable). */
const HARD_R = 0.28;
/** Soft band: walkable but 2.5x as expensive (keeps paths off walls). */
const SOFT_R = 0.62;
const SOFT_COST = 2.5;
/** Dynamic obstacles (banks, safes, fences) use a slightly smaller soft band. */
const DYN_SOFT_R = 0.5;
const SQRT2 = Math.SQRT2;
/** A* expansion budget (the arena has ~16k cells; typical chases expand a few hundred). */
const MAX_EXPAND = 5000;

const HARD = 2;
const SOFT = 1;

export class PoliceNav {
  readonly nx: number;
  readonly ny: number;
  /** Per cell: 0 free, 1 soft, 2 hard (static layer). */
  private readonly stat: Uint8Array;
  /** Dynamic layer, same encoding. */
  private readonly dyn: Uint8Array;
  // A* scratch (reused, typed arrays only)
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private epoch = 0;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;
  /** Expansions of the last search (perf tests). */
  lastExpanded = 0;

  constructor(private readonly ctx: SimContext) {
    const size = ctx.layout.size;
    this.nx = Math.max(1, Math.ceil(size.x / NAV_CELL));
    this.ny = Math.max(1, Math.ceil(size.y / NAV_CELL));
    const n = this.nx * this.ny;
    this.stat = new Uint8Array(n);
    this.dyn = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(1024);
    this.heapF = new Float32Array(1024);
    this.buildStatic();
  }

  // -------------------------------------------------------------------------
  // Grid helpers
  // -------------------------------------------------------------------------

  cx(x: number): number {
    const i = Math.floor(x / NAV_CELL);
    return i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
  }
  cy(y: number): number {
    const j = Math.floor(y / NAV_CELL);
    return j < 0 ? 0 : j >= this.ny ? this.ny - 1 : j;
  }
  centerX(i: number): number {
    return (i + 0.5) * NAV_CELL;
  }
  centerY(j: number): number {
    return (j + 0.5) * NAV_CELL;
  }
  level(k: number): number {
    const a = this.stat[k]!;
    if (this.staticOnly) return a;
    const b = this.dyn[k]!;
    return a > b ? a : b;
  }
  /** While true, searches and line checks see only the static layer (a ghosting officer). */
  staticOnly = false;
  /** True if the cell containing (x, y) is hard-blocked (or outside the arena). */
  blockedAt(x: number, y: number): boolean {
    const s = this.ctx.layout.size;
    if (x < 0 || y < 0 || x > s.x || y > s.y) return true;
    return this.level(this.cy(y) * this.nx + this.cx(x)) === HARD;
  }

  /**
   * Straight walk check: every 0.2 m sample along a->b is in a non-hard cell. Evaluated in the
   * mirror-canonical frame (see findPath), so a line and its mirror image always agree.
   */
  clearLine(ax: number, ay: number, bx: number, by: number): boolean {
    const span = this.nx * NAV_CELL;
    const flip = ax + bx > span + 1e-9;
    return flip ? this.clearLineV(span - ax, ay, span - bx, by, true) : this.clearLineV(ax, ay, bx, by, false);
  }

  /** clearLine in the virtual frame (x mirrored about the grid's center line when `flip`). */
  private clearLineV(ax: number, ay: number, bx: number, by: number, flip: boolean): boolean {
    const s = this.ctx.layout.size;
    const span = this.nx * NAV_CELL;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / 0.2));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = ax + dx * t;
      const y = ay + dy * t;
      const rx = flip ? span - x : x;
      if (rx < 0 || y < 0 || rx > s.x || y > s.y) return false;
      if (this.levelV(this.cx(x), this.cy(y), flip) === HARD) return false;
    }
    return true;
  }

  private mark(arr: Uint8Array, k: number, v: number): void {
    if (arr[k]! < v) arr[k] = v;
  }

  /** Stamp an oriented box (center, unit x-axis (ux, uy), half extents) with hard/soft radii. */
  private stampBox(arr: Uint8Array, x: number, y: number, ux: number, uy: number, hx: number, hy: number, softR: number): void {
    const ex = Math.abs(ux) * hx + Math.abs(uy) * hy + softR;
    const ey = Math.abs(uy) * hx + Math.abs(ux) * hy + softR;
    const i0 = this.cx(x - ex);
    const i1 = this.cx(x + ex);
    const j0 = this.cy(y - ey);
    const j1 = this.cy(y + ey);
    for (let j = j0; j <= j1; j++) {
      const py = this.centerY(j) - y;
      for (let i = i0; i <= i1; i++) {
        const px = this.centerX(i) - x;
        const lx = Math.abs(px * ux + py * uy) - hx;
        const ly = Math.abs(-px * uy + py * ux) - hy;
        const ox = lx > 0 ? lx : 0;
        const oy = ly > 0 ? ly : 0;
        const d = lx > 0 || ly > 0 ? Math.hypot(ox, oy) : Math.max(lx, ly);
        if (d < HARD_R) this.mark(arr, j * this.nx + i, HARD);
        else if (d < softR) this.mark(arr, j * this.nx + i, SOFT);
      }
    }
  }

  private stampCircle(arr: Uint8Array, x: number, y: number, r: number, softR: number): void {
    const e = r + softR;
    const i0 = this.cx(x - e);
    const i1 = this.cx(x + e);
    const j0 = this.cy(y - e);
    const j1 = this.cy(y + e);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(this.centerX(i) - x, this.centerY(j) - y) - r;
        if (d < HARD_R) this.mark(arr, j * this.nx + i, HARD);
        else if (d < softR) this.mark(arr, j * this.nx + i, SOFT);
      }
    }
  }

  private buildStatic(): void {
    const st = this.stat;
    const size = this.ctx.layout.size;
    // arena boundary
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.centerX(i);
        const y = this.centerY(j);
        const d = Math.min(x, y, size.x - x, size.y - y);
        if (d < HARD_R + 0.1) this.mark(st, j * this.nx + i, HARD);
        else if (d < SOFT_R) this.mark(st, j * this.nx + i, SOFT);
      }
    }
    for (const s of this.ctx.physics.statics) {
      if (s.fenceIndex >= 0) continue; // fences live in the dynamic layer (they break)
      if (s.type === SHAPE_CIRCLE) this.stampCircle(st, s.x, s.y, s.r, SOFT_R);
      else this.stampBox(st, s.x, s.y, s.ux, s.uy, s.hx, s.hy, SOFT_R);
    }
  }

  /** Re-stamp intact fences, unrecovered bank walls (doors stay open) and resting safes. */
  refreshDynamic(): void {
    const ctx = this.ctx;
    const dyn = this.dyn;
    dyn.fill(0);
    for (const f of ctx.fences) {
      const s = f.shape;
      if (!s.enabled) continue;
      this.stampBox(dyn, s.x, s.y, s.ux, s.uy, s.hx, s.hy, DYN_SOFT_R);
    }
    const st = ctx.state;
    for (let i = 0; i < st.loot.length; i++) {
      const l = st.loot[i]!;
      if (l.recovered) continue;
      const b = ctx.loot[i]!.body;
      const c = Math.cos(b.a);
      const s = Math.sin(b.a);
      if (l.kind === 'bank') {
        for (const w of BANK_MODEL.walls) {
          const wx = b.x + w.center.x * c - w.center.y * s;
          const wy = b.y + w.center.x * s + w.center.y * c;
          this.stampBox(dyn, wx, wy, c, s, w.half.x, w.half.y, DYN_SOFT_R);
        }
      } else if (l.grabbedBy.length === 0) {
        // held safes move with their carrier; resting ones are obstacles
        this.stampBox(dyn, b.x, b.y, c, s, l.half.x, l.half.y, DYN_SOFT_R);
      }
    }
  }

  // -------------------------------------------------------------------------
  // A*
  // -------------------------------------------------------------------------

  /**
   * Level of virtual cell (i, j): in the mirrored frame (`flip`) column i is the real column
   * nx - 1 - i, so a search in that frame sees the arena mirrored about its center line.
   */
  private levelV(i: number, j: number, flip: boolean): number {
    return this.level(j * this.nx + (flip ? this.nx - 1 - i : i));
  }

  /**
   * Nearest non-hard cell to (x, y) within `rings` cells, or -1, as a VIRTUAL index (see
   * levelV; x is given in the same frame). Equally near cells go to the one nearer the
   * reference point (rx, ry) — the other end of the path — then ring order.
   */
  private nearestFree(x: number, y: number, rings: number, flip: boolean, rx: number, ry: number): number {
    const ci = this.cx(x);
    const cj = this.cy(y);
    let best = -1;
    let bestD = Infinity;
    let bestR = Infinity;
    let found = -1;
    for (let r = 0; r <= rings + 1; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= this.ny) continue;
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || i >= this.nx) continue;
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          if (this.levelV(i, j, flip) === HARD) continue;
          const d = (this.centerX(i) - x) ** 2 + (this.centerY(j) - y) ** 2;
          const dr = (this.centerX(i) - rx) ** 2 + (this.centerY(j) - ry) ** 2;
          if (d < bestD - 1e-9 || (d <= bestD + 1e-9 && dr < bestR - 1e-9)) {
            bestD = d;
            bestR = dr;
            best = j * this.nx + i;
          }
        }
      }
      // one extra ring: (x, y) is rarely the cell center, so the truly nearest cell (and its
      // mirror twin) can sit one ring further out than the first hit
      if (best >= 0 && found < 0) found = r;
      else if (found >= 0) return best;
    }
    return best;
  }

  private push(k: number, f: number): void {
    if (this.heapSize === this.heap.length) {
      const h = new Int32Array(this.heap.length * 2);
      h.set(this.heap);
      this.heap = h;
      const hf = new Float32Array(this.heapF.length * 2);
      hf.set(this.heapF);
      this.heapF = hf;
    }
    let i = this.heapSize++;
    const heap = this.heap;
    const hf = this.heapF;
    while (i > 0) {
      const p = (i - 1) >> 1;
      // ties by cell index -> deterministic
      if (hf[p]! < f || (hf[p] === f && heap[p]! < k)) break;
      heap[i] = heap[p]!;
      hf[i] = hf[p]!;
      i = p;
    }
    heap[i] = k;
    hf[i] = f;
  }

  private pop(): number {
    const heap = this.heap;
    const hf = this.heapF;
    const top = heap[0]!;
    const n = --this.heapSize;
    if (n > 0) {
      const k = heap[n]!;
      const f = hf[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        let c = l;
        const r = l + 1;
        if (r < n && (hf[r]! < hf[l]! || (hf[r] === hf[l] && heap[r]! < heap[l]!))) c = r;
        if (f < hf[c]! || (f === hf[c] && k < heap[c]!)) break;
        heap[i] = heap[c]!;
        hf[i] = hf[c]!;
        i = c;
      }
      heap[i] = k;
      hf[i] = f;
    }
    return top;
  }

  /**
   * Path from (sx, sy) to (gx, gy) as smoothed waypoints (excluding the start, ending at the
   * goal or at the reachable cell closest to it). Returns null if the start is enclosed.
   * `fullSearch` lifts the expansion cap (walking back to the car: never a partial path).
   */
  findPath(sx: number, sy: number, gx: number, gy: number, fullSearch = false): Vec2[] | null {
    // Mirror-canonical frame: a problem whose start/goal midpoint lies east of the grid's center
    // line is solved mirrored, so a team-0 situation and its mirror image for team 1 run the
    // exact same search (same tie-breaks) and get mirror-image paths.
    const span = this.nx * NAV_CELL;
    const flip = sx + gx > span + 1e-9;
    const vsx = flip ? span - sx : sx;
    const vgx = flip ? span - gx : gx;
    const start = this.nearestFree(vsx, sy, 4, flip, vgx, gy);
    const goal = this.nearestFree(vgx, gy, 6, flip, vsx, sy);
    if (start < 0 || goal < 0) return null;
    const nx = this.nx;
    const ny = this.ny;
    const maxExpand = fullSearch ? nx * ny : MAX_EXPAND;
    const gi = goal % nx;
    const gj = (goal / nx) | 0;
    const ep = ++this.epoch;
    const g = this.g;
    const parent = this.parent;
    const seen = this.seen;
    const closed = this.closed;
    this.heapSize = 0;
    const h = (i: number, j: number): number => {
      const dx = Math.abs(i - gi);
      const dy = Math.abs(j - gj);
      return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
    };
    const si = start % nx;
    const sj = (start / nx) | 0;
    g[start] = 0;
    parent[start] = -1;
    seen[start] = ep;
    this.push(start, h(si, sj));
    let best = start;
    let bestH = h(si, sj);
    let expanded = 0;
    let found = false;
    while (this.heapSize > 0) {
      const k = this.pop();
      if (closed[k] === ep) continue;
      closed[k] = ep;
      if (k === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const i = k % nx;
      const j = (k / nx) | 0;
      const hk = h(i, j);
      if (hk < bestH) {
        bestH = hk;
        best = k;
      }
      const gk = g[k]!;
      for (let dj = -1; dj <= 1; dj++) {
        const j2 = j + dj;
        if (j2 < 0 || j2 >= ny) continue;
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const i2 = i + di;
          if (i2 < 0 || i2 >= nx) continue;
          const k2 = j2 * nx + i2;
          const lv = this.levelV(i2, j2, flip);
          if (lv === HARD || closed[k2] === ep) continue;
          if (di !== 0 && dj !== 0) {
            // no corner cutting
            if (this.levelV(i2, j, flip) === HARD || this.levelV(i, j2, flip) === HARD) continue;
          }
          const step = (di !== 0 && dj !== 0 ? SQRT2 : 1) * (lv === SOFT ? SOFT_COST : 1);
          const ng = gk + step;
          if (seen[k2] === ep && ng >= g[k2]!) continue;
          seen[k2] = ep;
          g[k2] = ng;
          parent[k2] = k;
          this.push(k2, ng + h(i2, j2));
        }
      }
    }
    this.lastExpanded = expanded;
    const end = found ? goal : best;
    // collect cells end -> start
    const cells: number[] = [];
    for (let k = end; k >= 0; k = parent[k]!) {
      cells.push(k);
      if (k === start) break;
    }
    cells.reverse();
    // virtual-frame cell centers (+ the exact goal when it is in plain reach)
    const pts: Vec2[] = cells.map((k) => ({ x: this.centerX(k % nx), y: this.centerY((k / nx) | 0) }));
    let exactGoal = false;
    if (found && this.clearLineV(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y, vgx, gy, flip)) {
      pts.push({ x: vgx, y: gy });
      exactGoal = true;
    }
    // greedy string pulling from the start, still in the virtual frame (same result for a
    // mirrored problem), then back to the real frame
    const out: Vec2[] = [];
    let ax = vsx;
    let ay = sy;
    let idx = 0;
    while (idx < pts.length) {
      let far = idx;
      while (far + 1 < pts.length && this.clearLineV(ax, ay, pts[far + 1]!.x, pts[far + 1]!.y, flip)) far++;
      const p = pts[far]!;
      const last = exactGoal && far === pts.length - 1;
      out.push(last ? { x: gx, y: gy } : { x: flip ? span - p.x : p.x, y: p.y });
      ax = p.x;
      ay = p.y;
      idx = far + 1;
    }
    return out;
  }
}
