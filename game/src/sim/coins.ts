/**
 * [C1] Coin economy: loose piles, bags (주머니), deposit (쏟아붓기), spill (와르르)
 * (content-plan §3.3–3.5), plus the dash bonk on breakables (breakables.ts holds the damage path).
 *
 * Callers: props (C3: spurts, bonks, sheds, smash), items (C2: hammer spill), police (tackle ->
 * spillBag through the knockDown chokepoint), events (C5: rain, truck), gimmicks (C4: hazard spills).
 * Conservation: value only MOVES (innerValue -> pile -> bag -> score); spawnCoins never creates
 * value, the caller subtracts exactly Σ values from its source in the same tick.
 *
 * Rules implemented here (all deterministic, no RNG, never slot order):
 * - Piles are point bodies (COINS.radius) with ground drag COINS.drag. They collide only with
 *   enabled statics (incl. intact fences, vans, unbroken breakables) and the arena bounds; bank walls,
 *   safes and characters pass over them; they do not ride bank floors. Gimmicks (C4) move them by
 *   changing `CoinPile.vel` (belts, fountain, rinks); the integration below applies it next tick.
 *   A pile found inside a static (spawned there, or a static appeared on it) is moved to the
 *   nearest free spot (spiralSearch). Piles never despawn.
 * - Spawn patterns are fixed tables relative to (pos, dir): 'fan' ±COINS.fanHalfAngle, 'radial'
 *   evenly around, 'ring' landing ring. Directions come from a quantised unit-vector table that is
 *   mirror-exact (angle a and π − a give (−c, s) and (c, s) bit for bit) and the fan offsets /
 *   speeds are symmetric per index, so a mirrored burst yields bit-exact mirrored launch velocities.
 * - Pickup (afterLoading): any non-knocked-down character whose centre is within
 *   COINS.pickupRadius of a pile takes it if bag + value ≤ COINS.bagCap (the spill victim is locked
 *   out of its own piles until `noPickupUntil`). Same tick: the closest centre wins, an exact tie
 *   means nobody takes it that tick. A character winning several piles takes them nearest first
 *   (then smaller value, then id) while the cap allows.
 * - Deposit (step 4, collectDeposits): centre inside the own zone shrunk by the character radius,
 *   not knocked down, bag > 0, for COINS.depositTicks consecutive ticks -> the whole bag is claimed
 *   and settled with the loot recoveries of the same tick (rules.settleDeposits). Leaving the zone,
 *   a knockdown or an emptied bag resets the timer (`coinDepositCancel`).
 * - Spill (knockDown -> ContentSystems.onKnockdown -> spillBag): max(spillMin,
 *   floor(bag·spillFraction/10)·10) capped at the bag, as 동전 10 piles fanned around the knockback.
 */
import { BREAKABLE_DAMAGE, CHARACTER, COINS, DASH, DT } from './config';
import { emit, type SimContext } from './context';
import { damageBreakable } from './breakables';
import { circleOverlapsOBB } from './math';
import { SHAPE_CIRCLE } from './physics';
import { canPickUp, spiralSearch, staticToOBB } from './queries';
import { ContentSystemBase } from './systemBase';
import type { CoinPile, CoinSpawnSource, EntityId, SpillCause, TeamId, Vec2 } from './types';
import { nextEntityId } from './world';

/** A burst of piles (fixed tables relative to the source, no RNG; mirrored hit -> mirrored piles). */
export interface CoinSpawnRequest {
  /** Burst origin (world). */
  pos: Vec2;
  /** Pattern centre direction in radians (hit / knockback direction); ignored by 'radial'. */
  dir: number;
  /** Pile values in spawn order (index i uses COINS.speeds[i % n]). */
  values: ReadonlyArray<10 | 50>;
  /** 'fan' = ±COINS.fanHalfAngle around dir; 'radial' = evenly around; 'ring' = landing ring. */
  pattern: 'fan' | 'radial' | 'ring';
  source: CoinSpawnSource;
  sourceId: EntityId | string | null;
  byCharId: EntityId | null;
  /** Spill victim: cannot pick these up for COINS.ownSpillLockTicks. */
  noPickupCharId?: EntityId | null;
  /** 'ring' only: landing radius range around pos (돈비 6–9 m). */
  ring?: { min: number; max: number };
}

/** A bag deposit completed this tick (settled in step 4 with the loot recoveries). */
export interface DepositClaim {
  charId: EntityId;
  team: TeamId;
  value: number;
}

// ---------------------------------------------------------------------------------------------
// Mirror-exact direction table
// ---------------------------------------------------------------------------------------------

/** Directions per full turn (0.088°). Divisible by 4 so the quadrant symmetry is exact. */
const DIR_STEPS = 4096;
const DIR_COS = new Float64Array(DIR_STEPS);
const DIR_SIN = new Float64Array(DIR_STEPS);
{
  const q = DIR_STEPS / 4;
  for (let j = 0; j <= q; j++) {
    const a = (j / DIR_STEPS) * 2 * Math.PI;
    // first quadrant computed once; the others are exact sign flips of it
    const c = j === q ? 0 : Math.cos(a);
    const s = j === 0 ? 0 : j === q ? 1 : Math.sin(a);
    const set = (k: number, cx: number, sy: number): void => {
      const i = ((k % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
      DIR_COS[i] = cx;
      DIR_SIN[i] = sy;
    };
    set(j, c, s);
    set(DIR_STEPS / 2 - j, -c, s);
    set(DIR_STEPS / 2 + j, -c, -s);
    set(DIR_STEPS - j, c, -s);
  }
}

/** Index of the table direction nearest to `angle`. Mirror: index(π − a) = N/2 − index(a). */
function dirIndex(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const k = Math.round((angle / (2 * Math.PI)) * DIR_STEPS);
  return ((k % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
}

/** Quantised unit vector of `angle` (mirror-exact: angle and π − angle give (c, s) / (−c, s)). */
export function coinDir(angle: number): Vec2 {
  const i = dirIndex(angle);
  return { x: DIR_COS[i]!, y: DIR_SIN[i]! };
}

/** Pile launch velocity factor per tick of drag. */
const DRAG_KEEP = Math.exp(-COINS.drag * DT);

/** Symmetric speed of pile `i` of `n` (index i and its mirror partner get the same speed). */
function symSpeed(s: number): number {
  const sp = COINS.speeds;
  return sp[s % sp.length]!;
}

export class CoinSystem extends ContentSystemBase {
  readonly name = 'coins' as const;

  constructor(ctx: SimContext) {
    super(ctx);
    for (const ch of ctx.state.characters) {
      ch.bag ??= 0;
      ch.depositTicks ??= 0;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Spawning, spilling
  // -------------------------------------------------------------------------------------------

  /**
   * [C1] Spawn piles for a burst, emit one `coinSpawn`, return the new pile ids (ascending).
   * The CALLER removes Σ values from its source (innerValue / pendingValue / bag) the same tick.
   *
   * Pattern tables (index i of n, m = (n − 1) / 2, symmetric index s = min(i, n − 1 − i)):
   * - 'fan':    direction dir rotated by fanHalfAngle·(i − m)/m (n = 1: dir), speed speeds[s].
   * - 'radial': direction dir + 2π·i/n, speed speeds[min(i, n − i)].
   * - 'ring':   lands at rest at pos + R·(direction of 'radial'), R = ring.min + (ring.max −
   *             ring.min)·ringFracs[min(i, n − i)] (no ring: 0). A single pile lands at dir.
   */
  spawnCoins(req: CoinSpawnRequest): EntityId[] {
    const n = req.values.length;
    if (n === 0) return [];
    const st = this.ctx.state;
    const k0 = dirIndex(req.dir);
    const ux = DIR_COS[k0]!;
    const uy = DIR_SIN[k0]!;
    const ids: EntityId[] = [];
    let total = 0;
    const lockUntil = req.noPickupCharId != null ? st.tick + COINS.ownSpillLockTicks : 0;
    for (let i = 0; i < n; i++) {
      const value = req.values[i]!;
      if (value !== 10 && value !== 50) throw new RangeError(`coin pile value must be 10 or 50 (got ${String(value)})`);
      let dx: number;
      let dy: number;
      let speed: number;
      if (req.pattern === 'fan') {
        const m = (n - 1) / 2;
        const off = m > 0 ? (COINS.fanHalfAngle * (i - m)) / m : 0;
        // cos(|off|), ±sin(|off|): the mirror partner's offset is the exact negative
        const cd = Math.cos(Math.abs(off));
        const sd = off < 0 ? -Math.sin(-off) : Math.sin(off);
        dx = ux * cd - uy * sd;
        dy = ux * sd + uy * cd;
        speed = symSpeed(Math.min(i, n - 1 - i));
      } else {
        // radial / ring: pile i and its mirror partner n − i are rotated by ± the same table step
        const off = i * 2 <= n ? Math.round((i * DIR_STEPS) / n) : -Math.round(((n - i) * DIR_STEPS) / n);
        const idx = (((k0 + off) % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
        dx = DIR_COS[idx]!;
        dy = DIR_SIN[idx]!;
        speed = symSpeed(Math.min(i, n - i));
      }
      const id = nextEntityId(this.ctx, 'coin');
      let pos: Vec2;
      let vel: Vec2;
      if (req.pattern === 'ring') {
        const fr = COINS.ringFracs;
        const r = req.ring ? req.ring.min + (req.ring.max - req.ring.min) * fr[Math.min(i, n - i) % fr.length]! : 0;
        pos = { x: req.pos.x + dx * r, y: req.pos.y + dy * r };
        vel = { x: 0, y: 0 };
      } else {
        pos = { x: req.pos.x, y: req.pos.y };
        vel = { x: dx * speed, y: dy * speed };
      }
      const pile: CoinPile = {
        id,
        pos,
        vel,
        value,
        noPickupCharId: req.noPickupCharId ?? null,
        noPickupUntil: lockUntil,
      };
      this.place(pile);
      st.coins.push(pile);
      ids.push(id);
      total += value;
    }
    emit(this.ctx, {
      type: 'coinSpawn',
      tick: st.tick,
      ids,
      total,
      pos: { x: req.pos.x, y: req.pos.y },
      source: req.source,
      sourceId: req.sourceId,
      byCharId: req.byCharId,
    });
    return ids;
  }

  /**
   * [C1] 와르르: knock `victimId`'s bag loose (knockdown by an opposing dash, a hammer, a police
   * tackle or a hazard). Spills max(spillMin, floor(bag·spillFraction/10)·10) capped at the bag,
   * as 동전 10 piles fanned around `dir` (knockback direction); emits `bagSpilled`. Returns the
   * spilled value (0 for an empty bag, a protected victim, or a self-inflicted crash).
   * (Protected victims are never knocked down, so knockDown never calls this for them.)
   */
  spillBag(victimId: EntityId, cause: SpillCause, byId: EntityId | null, dir: number): number {
    const st = this.ctx.state;
    const ch = st.characters[victimId - 1];
    if (!ch || ch.id !== victimId || !ch.bag || ch.bag <= 0) return 0;
    const bag = ch.bag;
    const value = Math.min(bag, Math.max(COINS.spillMin, Math.floor((bag * COINS.spillFraction) / COINS.coin) * COINS.coin));
    const piles = Math.floor(value / COINS.coin);
    if (piles <= 0) return 0;
    const spilled = piles * COINS.coin;
    ch.bag = bag - spilled;
    if (ch.depositTicks) {
      ch.depositTicks = 0;
      emit(this.ctx, { type: 'coinDepositCancel', tick: st.tick, charId: ch.id, team: ch.team });
    }
    emit(this.ctx, { type: 'bagSpilled', tick: st.tick, charId: ch.id, value: spilled, byId, cause });
    const body = this.ctx.chars[victimId - 1]!.body;
    const values: (10 | 50)[] = new Array<10 | 50>(piles).fill(10);
    this.spawnCoins({
      pos: { x: body.x, y: body.y },
      dir,
      values,
      pattern: 'fan',
      source: 'spill',
      sourceId: ch.id,
      byCharId: byId,
      noPickupCharId: ch.id,
    });
    return spilled;
  }

  // -------------------------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------------------------

  /**
   * After every substep (after character dash hits): a dash that reaches an unbroken breakable
   * inside the dash cone (DASH.hitConeHalfAngle) ends on it and deals BREAKABLE_DAMAGE.dash.
   * Hits are collected first, then applied in character id order.
   */
  override afterSubstep(_substep: number): void {
    const ctx = this.ctx;
    const st = ctx.state;
    if (st.breakables.length === 0) return;
    let hits: { slot: number; id: string; dir: number }[] | null = null;
    const reach = CHARACTER.radius + COINS.dashHitGap;
    const cos = Math.cos(DASH.hitConeHalfAngle);
    for (let slot = 0; slot < st.characters.length; slot++) {
      const ch = st.characters[slot]!;
      if (ch.dashTicks <= 0 || ch.knockdownTicks > 0) continue;
      const rt = ctx.chars[slot]!;
      const b = rt.body;
      let best: string | null = null;
      let bestD = Infinity;
      for (const br of st.breakables) {
        if (br.broken) continue;
        // closest point of the box to the character centre
        const c = Math.cos(br.angle);
        const s = Math.sin(br.angle);
        const rx = b.x - br.center.x;
        const ry = b.y - br.center.y;
        const lx = rx * c + ry * s;
        const ly = -rx * s + ry * c;
        const qx = Math.max(-br.half.x, Math.min(br.half.x, lx));
        const qy = Math.max(-br.half.y, Math.min(br.half.y, ly));
        const ddx = qx - lx;
        const ddy = qy - ly;
        const d = Math.hypot(ddx, ddy);
        if (d > reach || d >= bestD) continue;
        // direction from the character to the box (world), inside the forward cone
        let nx: number;
        let ny: number;
        if (d > 1e-6) {
          nx = (ddx * c - ddy * s) / d;
          ny = (ddx * s + ddy * c) / d;
        } else {
          nx = rt.dashDirX;
          ny = rt.dashDirY;
        }
        if (nx * rt.dashDirX + ny * rt.dashDirY < cos) continue;
        best = br.id;
        bestD = d;
      }
      if (best !== null) (hits ??= []).push({ slot, id: best, dir: Math.atan2(rt.dashDirY, rt.dashDirX) });
    }
    if (!hits) return;
    for (const h of hits) {
      const ch = st.characters[h.slot]!;
      ch.dashTicks = 0;
      ctx.chars[h.slot]!.body.noDrag = false;
    }
    for (const h of hits) damageBreakable(ctx, h.id, BREAKABLE_DAMAGE.dash, st.characters[h.slot]!.id, h.dir);
  }

  /** Step 2 (after fences): integrate loose piles (drag, static collisions, un-burying). */
  override afterPhysics(): void {
    const coins = this.ctx.state.coins;
    for (let i = 0; i < coins.length; i++) this.integrate(coins[i]!);
  }

  /** Step 3: the pickup contest (closest centre wins, exact tie = nobody). */
  override afterLoading(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    if (st.coins.length === 0) return;
    const chars = st.characters;
    const r2 = COINS.pickupRadius * COINS.pickupRadius;
    let won: Map<number, { pile: CoinPile; d2: number }[]> | null = null;
    for (const pile of st.coins) {
      let best = -1;
      let bestD2 = Infinity;
      let tie = false;
      for (let slot = 0; slot < chars.length; slot++) {
        const ch = chars[slot]!;
        if (!canPickUp(st, ch.id, pile)) continue;
        const dx = ch.pos.x - pile.pos.x;
        const dy = ch.pos.y - pile.pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (d2 < bestD2) {
          best = slot;
          bestD2 = d2;
          tie = false;
        } else if (d2 === bestD2) tie = true;
      }
      if (best < 0 || tie) continue;
      won ??= new Map();
      let list = won.get(best);
      if (!list) won.set(best, (list = []));
      list.push({ pile, d2: bestD2 });
    }
    if (!won) return;
    const taken = new Set<CoinPile>();
    for (let slot = 0; slot < chars.length; slot++) {
      const list = won.get(slot);
      if (!list) continue;
      const ch = chars[slot]!;
      list.sort((a, b) => a.d2 - b.d2 || a.pile.value - b.pile.value || a.pile.id - b.pile.id);
      for (const w of list) {
        const bag = ch.bag ?? 0;
        if (bag + w.pile.value > COINS.bagCap) continue;
        ch.bag = bag + w.pile.value;
        taken.add(w.pile);
        emit(ctx, { type: 'coinPickup', tick: st.tick, charId: ch.id, coinId: w.pile.id, value: w.pile.value, bag: ch.bag });
      }
    }
    if (taken.size) st.coins = st.coins.filter((p) => !taken.has(p));
  }

  /**
   * [C1] Step 4: advance every character's deposit timer and return the deposits completed this
   * tick (ascending charId). Settled by settleDeposits (rules.ts) after the loot settlements.
   */
  collectDeposits(): DepositClaim[] {
    const ctx = this.ctx;
    const st = ctx.state;
    let out: DepositClaim[] | null = null;
    for (let slot = 0; slot < st.characters.length; slot++) {
      const ch = st.characters[slot]!;
      const bag = ch.bag ?? 0;
      const prev = ch.depositTicks ?? 0;
      const inZone = bag > 0 && ch.knockdownTicks <= 0 && this.insideOwnZone(slot);
      if (!inZone) {
        if (prev > 0) {
          ch.depositTicks = 0;
          emit(ctx, { type: 'coinDepositCancel', tick: st.tick, charId: ch.id, team: ch.team });
        }
        continue;
      }
      const next = Math.min(COINS.depositTicks, prev + 1);
      ch.depositTicks = next;
      if (prev === 0) emit(ctx, { type: 'coinDepositStart', tick: st.tick, charId: ch.id, team: ch.team });
      if (next >= COINS.depositTicks) (out ??= []).push({ charId: ch.id, team: ch.team, value: bag });
    }
    return out ?? NO_DEPOSITS;
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  /** Centre inside the own team's zone OBB shrunk by the character radius. */
  private insideOwnZone(slot: number): boolean {
    const ch = this.ctx.state.characters[slot]!;
    const p = ch.pos;
    const R = CHARACTER.radius;
    for (const z of this.ctx.zones) {
      if (z.team !== ch.team) continue;
      const o = z.obb;
      const c = Math.cos(o.angle);
      const s = Math.sin(o.angle);
      const dx = p.x - o.center.x;
      const dy = p.y - o.center.y;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      if (Math.abs(lx) <= o.half.x - R && Math.abs(ly) <= o.half.y - R) return true;
    }
    return false;
  }

  /** True if a pile fits at p: inside the arena, no enabled static overlapping. */
  private free(x: number, y: number): boolean {
    const r = COINS.radius;
    const size = this.ctx.layout.size;
    if (x < r || y < r || x > size.x - r || y > size.y - r) return false;
    const statics = this.ctx.physics.queryStatics(x - r, y - r, x + r, y + r);
    for (const s of statics) {
      if (!s.enabled) continue;
      if (s.type === SHAPE_CIRCLE) {
        const dx = x - s.x;
        const dy = y - s.y;
        if (dx * dx + dy * dy < (s.r + r) * (s.r + r)) return false;
      } else if (circleOverlapsOBB({ x, y }, r, staticToOBB(s))) return false;
    }
    return true;
  }

  /** Move a pile out of statics / back into the arena (nearest free spot), keeping its velocity. */
  private place(pile: CoinPile): void {
    if (this.free(pile.pos.x, pile.pos.y)) return;
    const size = this.ctx.layout.size;
    const r = COINS.radius;
    const from = {
      x: Math.min(size.x - r, Math.max(r, pile.pos.x)),
      y: Math.min(size.y - r, Math.max(r, pile.pos.y)),
    };
    const spot = spiralSearch(from, (p) => this.free(p.x, p.y), 12, 0.2);
    if (spot) {
      pile.pos.x = spot.x;
      pile.pos.y = spot.y;
    } else {
      pile.pos.x = from.x;
      pile.pos.y = from.y;
      pile.vel.x = 0;
      pile.vel.y = 0;
    }
  }

  private integrate(pile: CoinPile): void {
    const v = pile.vel;
    if (v.x === 0 && v.y === 0) {
      // at rest: only un-bury (a static may have appeared on it)
      this.place(pile);
      return;
    }
    v.x *= DRAG_KEEP;
    v.y *= DRAG_KEEP;
    if (v.x * v.x + v.y * v.y < COINS.restSpeed * COINS.restSpeed) {
      v.x = 0;
      v.y = 0;
      this.place(pile);
      return;
    }
    const p = pile.pos;
    if (!this.free(p.x, p.y)) {
      this.place(pile);
      return;
    }
    const nx = p.x + v.x * DT;
    const ny = p.y + v.y * DT;
    if (this.free(nx, ny)) {
      p.x = nx;
      p.y = ny;
    } else if (this.free(nx, p.y)) {
      p.x = nx;
      v.y = 0;
    } else if (this.free(p.x, ny)) {
      p.y = ny;
      v.x = 0;
    } else {
      v.x = 0;
      v.y = 0;
    }
  }
}

export const NO_DEPOSITS: DepositClaim[] = [];
