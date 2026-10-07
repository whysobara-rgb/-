/**
 * [C3] Props: 동전 ATM, 대왕 돼지저금통, 돈나무, 황금 금고 body (content-plan §3.1, §5.1), plus the
 * flight helper (`flyBody`) and the frozen `addUnanchorProgress` helper.
 *
 * Verbs (every one deterministic, mirrored hits give mirrored piles, no RNG):
 * - 동전 ATM (tug-spurt): crossing 1/3 and 2/3 of its uproot progress spurts 2 동전 each (whatever
 *   raised the progress: a tug, a hammer, a stomper, the quake), fanned away from the pullers so a
 *   rival next to you can snatch them. A dash into it at >= 4 m/s bonks 2 out (0.5 s cooldown per
 *   ATM). The rest rides inside and is settled with the shell.
 * - 대왕 돼지저금통 (kick + smash): free-standing and kickable (a dash hits it at full mass, about
 *   6 m of travel). 3 cracks smash it: a dash by the team opposing whoever touched it last = 1,
 *   a hammer = 2, a wall / loot impact >= 5 m/s = 1, a hazard (fountain show, pile driver, quake)
 *   = 1. On the last crack every pile bursts out radially and the shell is removed from play
 *   (`recovered = true`, `recoveredBy = null`, no `recovered` event: it scored nothing).
 * - 돈나무 (careful carry): once uprooted, every impact faster than 2.5 m/s while it moves (wall,
 *   loot, a raccoon it is swung into) sheds one 지폐 다발, debounced 0.3 s; so does a dash into it
 *   once uprooted (an anchored tree never sheds to a dash) and its carrier being knocked down. A
 *   hammer sheds 2 (anchored or not).
 * - 황금 금고: a plain heavy body (C5 builds it dormant with `createPropLoot`).
 *
 * Entry points for other packages (call through `ctx.content.props` in v2):
 * - `hammerHit(lootId, byCharId, dir)` — the hammer's prop effects (C2); false for non-props.
 * - `hazardHit(lootId, byCharId, dir?)` — fountain show / pile driver / quake on a prop (C4, C5);
 *   a smashing burst points along the mirror axis unless `dir` (radians) is given.
 * - `crackPiggy(lootId, cracks, byCharId, dir?)` — raw crack entry point.
 *
 * Mirror symmetry (§3.3): every burst orders its 10s and 50s so a pile and its pattern partner
 * carry equal values (`mirrorValues`), so a mirrored hit yields mirrored piles, mixed values too.
 * - free functions `addUnanchorProgress`, `flyBody`, `endFlight`, `createPropLoot`.
 *
 * Conservation: coins only MOVE out of `innerValue` (CoinSystem.spawnCoins, same statement block
 * subtracts the exact pile values), and every prop keeps `estimatedValue === baseValue +
 * innerValue`, so heldValue, matchPointInfo, police targeting and the HUD stay right.
 */
import { PROP_RULES, PROP_SPECS, type PropSpec } from './config';
import { bankFootprint, doRelease, lootOBBOf, onFloor, setLootAnchored, setLootFree } from './actions';
import { emit, lootById, type SimContext } from './context';
import { circleOverlapsOBB, obbOverlap } from './math';
import { CAT_CHARACTER, CAT_SAFE, PhysicsWorld, SHAPE_CIRCLE, type Body } from './physics';
import { spiralSearch, staticToOBB } from './queries';
import { ContentSystemBase } from './systemBase';
import type { CoinSpawnSource, EntityId, LayoutV2Def, LootState, OBB, PropVariant, TeamId, Vec2 } from './types';
import { appendLoot, boxInertia, nextLootId } from './world';

/** How a prop was hit (SimEvent `propHit.how`). */
export type PropHitHow = 'dash' | 'hammer' | 'impact' | 'plunger' | 'hazard';

/** Optional landing behaviour of `flyBody` (add-only extension of the frozen signature). */
export interface FlyOptions {
  /** Velocity on landing (m/s, world), e.g. the tube's 3 m/s pop-out. Ignored for anchored loot. */
  exitVel?: Vec2;
}

/** A moving prop slower than this never sheds on contact (a raccoon walking into a resting tree). */
const SHED_MIN_OWN_SPEED = 1;
/** Coins spawn this far outside the shell along the burst direction (fan patterns). */
const SPAWN_GAP = 0.25;

/**
 * buildV2 callback [C3]: append one prop loot per LayoutV2Def.props entry (ids right after the
 * v2 safes, via appendLoot in world.ts), kind = PROP_SPECS[variant].kind, baseValue = shell,
 * innerValue = Σ inner piles, estimatedValue = shell + innerValue; free-standing props
 * (uprootTicks 0, the piggy) start unanchored. Runs first, before breakables.
 */
export function buildProps(ctx: SimContext, v2: LayoutV2Def): void {
  for (const p of v2.props) createPropLoot(ctx, p.variant, p.pos, p.angle);
}

/**
 * [C3] Build one prop loot item (state + body) and append it with the next loot id. Used by
 * buildProps and by C5 for the dormant 황금 금고 (C5 then sets `dormant` and disables the body).
 * The body is a box, or a circle for the piggy (grab and zone tests use the bounding square
 * `half`); anchored props are static until uprooted, free-standing ones dynamic.
 */
export function createPropLoot(ctx: SimContext, variant: PropVariant, pos: Vec2, angle: number): LootState {
  const spec = PROP_SPECS[variant];
  const id = nextLootId(ctx);
  const anchored = spec.uprootTicks > 0;
  const body = ctx.physics.createBody(id, CAT_SAFE);
  if (spec.shape === 'circle') {
    const r = spec.half.x;
    body.addCircle(0, 0, r);
    body.setMass(spec.mass, 0.5 * spec.mass * r * r);
  } else {
    body.addBox(0, 0, spec.half.x, spec.half.y);
    body.setMass(spec.mass, boxInertia(spec.mass, spec.half.x, spec.half.y));
  }
  body.linDrag = spec.drag;
  body.kickable = spec.kickable;
  if (spec.kickable) body.kickRestitution = PROP_RULES.piggy.kickRestitution;
  body.motion = anchored ? 'static' : 'dynamic';
  body.x = pos.x;
  body.y = pos.y;
  body.a = angle;
  body.updateShapes(0);
  const inner = innerOf(spec);
  const l: LootState = {
    id,
    kind: spec.kind,
    baseValue: spec.shell,
    pos: { x: pos.x, y: pos.y },
    angle,
    vel: { x: 0, y: 0 },
    angVel: 0,
    half: { x: spec.half.x, y: spec.half.y },
    anchored,
    unanchorProgress: anchored ? 0 : 1,
    recovered: false,
    recoveredBy: null,
    recoveredTick: null,
    grabbedBy: [],
    recovery: null,
    floorOf: null,
    loadedIn: null,
    homeBank: null,
    loadedSafes: [],
    estimatedValue: spec.shell + inner,
    lastHolder: null,
    variant,
    innerValue: inner,
    bonkCooldown: 0,
  };
  if (variant === 'piggy') l.cracks = 0;
  appendLoot(ctx, l, { body, baseMass: spec.mass, stuckTicks: 0, lastX: pos.x, lastY: pos.y, lastA: angle });
  return l;
}

const innerOf = (spec: PropSpec): number => spec.inner.c10 * 10 + spec.inner.c50 * 50;

/**
 * Add `amount` of uproot progress (a fraction of the item's uproot time: hammer small 1.0 /
 * large 0.5 / bank 0.25, stomper 0.35, quake 0.5, …) to an anchored, unrecovered, non-dormant
 * loot item. On reaching 1 the item is freed exactly like a pull and the existing `unanchored`
 * event is emitted (byTeam = the team of `byCharId`, null for hazards). Returns true if freed.
 * ATM spurts follow from the progress itself (PropSystem.afterPhysics compares it with the last
 * value it saw), so callers never touch unanchorProgress directly and never spawn spurt coins.
 */
export function addUnanchorProgress(ctx: SimContext, lootId: EntityId, amount: number, byCharId: EntityId | null): boolean {
  const r = lootById(ctx, lootId);
  if (!r) return false;
  const l = r.state;
  if (!l.anchored || l.recovered || l.dormant || l.airborne || !(amount > 0)) return false;
  l.unanchorProgress = Math.min(1, l.unanchorProgress + amount);
  if (l.unanchorProgress < 1 - 1e-9) return false;
  setLootFree(ctx, ctx.lootIndex.get(lootId)!);
  for (const cid of l.grabbedBy) {
    const ch = ctx.state.characters[cid - 1];
    if (ch) ch.straining = false;
  }
  const by = byCharId !== null ? ctx.state.characters[byCharId - 1] : undefined;
  const byTeam: TeamId | null = by ? by.team : null;
  emit(ctx, { type: 'unanchored', tick: ctx.state.tick, lootId: l.id, kind: l.kind, byTeam });
  return true;
}

/**
 * [C3] Send loot on a fixed flight (catapult / tube / crane / parachute): disables its body,
 * sets `LootState.airborne` { fromTick: now, toTick: now + ticks, from, to, via } and releases
 * every holder; while flying it moves the disabled body's pose along the fixed arc each tick (so
 * `l.pos` = ground position of the flight, linear in time; height is derivable from `airborne`;
 * stabilize skips it); on `toTick` (in PropSystem.afterPhysics) re-enables the body at `to` or
 * the nearest free spot (spiralSearch over statics, fences, bank footprints and other loot;
 * characters are not obstacles — a landing on someone is the caller's bonk), with UNSTUCK /
 * STALL_RESCUE as the fallback, and clears `airborne`. Anchored loot (the dormant gold safe)
 * lands anchored; free loot lands with `opts.exitVel` (default at rest). Dormant loot is woken
 * (`dormant = false`). A flown bank takes its cargo along (welded interior safes and free safes
 * on its floor keep their place on it, also airborne; welded ones stay loaded, free ones unload
 * for the flight and load again on landing); characters are the caller's to eject.
 * Callers: C4 (catapult, tube, crane), C5 (gold-safe parachute). v2 only (needs ctx.content).
 */
export function flyBody(ctx: SimContext, lootId: EntityId, to: Vec2, ticks: number, via: 'catapult' | 'tube' | 'crane' | 'parachute', opts: FlyOptions = {}): void {
  const props = ctx.content?.props;
  if (!props) throw new Error(`flyBody needs the v2 content systems (loot ${lootId})`);
  props.startFlight(lootId, to, ticks, via, opts);
}

/**
 * [C3] End a flight now (crane cat stunned mid-swing): the item lands at `at` (default: its
 * current ground position on the arc) or the nearest free spot. No-op if it is not flying.
 */
export function endFlight(ctx: SimContext, lootId: EntityId, at?: Vec2): void {
  ctx.content?.props.landNow(lootId, at);
}

interface PropRuntime {
  /** ATM: unanchorProgress seen at the last check (spurt thresholds). */
  lastProgress: number;
  /** 돈나무: first tick another shed may happen (debounce). */
  shedReadyTick: number;
  /** Piggy: first tick another wall crack may happen (debounce). */
  crackReadyTick: number;
  /** Per dasher (character id): first tick its contacts count as a new dash hit again. */
  dashReady: Map<EntityId, number>;
}

interface PendingImpact {
  idx: number;
  lootId: EntityId;
  other: Body | null;
  approach: number;
  /** The prop's own speed at impact (pre-solve). */
  ownSpeed: number;
  /** Unit direction from the other body toward the prop (the hit direction). */
  dx: number;
  dy: number;
  /** Slot of a dashing character that hit it, or -1. */
  dashSlot: number;
}

interface Flight {
  anchored: boolean;
  exitVx: number;
  exitVy: number;
  /** Cargo of a flown bank: loot index and pose in the bank frame. */
  cargo: { idx: number; lx: number; ly: number; la: number; tempWeld: boolean }[];
}

/**
 * [C3] Prop runtime. Invariant C3 maintains: a prop's `estimatedValue === baseValue + innerValue`
 * (update both in the same statement whenever coins spurt / shed), so heldValue, matchPointInfo,
 * police targeting and the HUD stay right without knowing about props.
 */
export class PropSystem extends ContentSystemBase {
  readonly name = 'props' as const;
  /** Per loot index (props only). */
  private readonly rts = new Map<number, PropRuntime>();
  private pending: PendingImpact[] = [];
  /** Flights started by flyBody, per loot index. */
  private readonly flights = new Map<number, Flight>();

  constructor(ctx: SimContext) {
    super(ctx);
    const loot = ctx.state.loot;
    for (let i = 0; i < loot.length; i++) if (loot[i]!.variant) this.rtOf(i);
  }

  private rtOf(idx: number): PropRuntime {
    let r = this.rts.get(idx);
    if (!r) {
      r = { lastProgress: this.ctx.state.loot[idx]!.unanchorProgress, shedReadyTick: 0, crackReadyTick: 0, dashReady: new Map() };
      this.rts.set(idx, r);
    }
    return r;
  }

  /** Loot index of a live prop body, or -1. */
  private propIdx(b: Body): number {
    if (b.cat !== CAT_SAFE) return -1;
    const idx = this.ctx.lootIndex.get(b.entityId);
    if (idx === undefined) return -1;
    const l = this.ctx.state.loot[idx]!;
    return l.variant && !l.recovered && !l.airborne && !l.dormant ? idx : -1;
  }

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  override prePhysics(): void {
    const loot = this.ctx.state.loot;
    for (const idx of this.rts.keys()) {
      const l = loot[idx]!;
      if (l.bonkCooldown) l.bonkCooldown--;
    }
  }

  override onImpact(a: Body, b: Body | null, approach: number): void {
    const ia = this.propIdx(a);
    if (ia >= 0) this.collect(ia, a, b, approach);
    if (b) {
      const ib = this.propIdx(b);
      if (ib >= 0) this.collect(ib, b, a, approach);
    }
  }

  private collect(idx: number, pb: Body, other: Body | null, approach: number): void {
    const st = this.ctx.state;
    let dx: number;
    let dy: number;
    if (other) {
      dx = pb.x - other.x;
      dy = pb.y - other.y;
    } else {
      dx = -pb.vx;
      dy = -pb.vy;
    }
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) {
      dx /= d;
      dy /= d;
    } else {
      dx = Math.cos(pb.a);
      dy = Math.sin(pb.a);
    }
    let dashSlot = -1;
    if (other && other.cat === CAT_CHARACTER) {
      const ch = st.characters[other.entityId - 1];
      if (ch && ch.dashTicks > 0 && ch.knockdownTicks === 0) dashSlot = ch.slot;
    }
    this.pending.push({ idx, lootId: pb.entityId, other, approach, ownSpeed: Math.hypot(pb.vx, pb.vy), dx, dy, dashSlot });
  }

  /** Impacts of this substep, applied per prop in id order (never in contact or slot order). */
  override afterSubstep(_substep: number): void {
    if (this.pending.length === 0) return;
    const list = this.pending;
    this.pending = [];
    list.sort((p, q) => p.lootId - q.lootId || (q.dashSlot >= 0 ? 1 : 0) - (p.dashSlot >= 0 ? 1 : 0) || q.approach - p.approach || otherKey(p) - otherKey(q));
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j < list.length && list[j]!.lootId === list[i]!.lootId) j++;
      this.applyImpacts(list.slice(i, j));
      i = j;
    }
  }

  private applyImpacts(hits: PendingImpact[]): void {
    const st = this.ctx.state;
    const idx = hits[0]!.idx;
    const l = st.loot[idx]!;
    if (!l.variant || l.recovered || l.airborne || l.dormant) return;
    const prt = this.rtOf(idx);
    const R = PROP_RULES;
    // dash hits: one per character (its best contact), and one per dash (a burst keeps pushing)
    const dashes: PendingImpact[] = [];
    for (const h of hits) {
      if (h.dashSlot < 0 || dashes.some((d) => d.dashSlot === h.dashSlot)) continue;
      const cid = st.characters[h.dashSlot]!.id;
      if (st.tick < (prt.dashReady.get(cid) ?? 0)) continue;
      dashes.push(h);
    }
    for (const h of dashes) prt.dashReady.set(st.characters[h.dashSlot]!.id, st.tick + R.dashHitDebounceTicks);
    const holders = l.grabbedBy;
    if (l.variant === 'atm') {
      const bonks = dashes.filter((h) => h.approach >= R.atm.bonkSpeed);
      if (bonks.length && !l.bonkCooldown) {
        l.bonkCooldown = R.atm.bonkCooldownTicks;
        const by = soleChar(st, bonks);
        const coins = this.releaseCoins(idx, R.atm.bonkCoins, 'bonk', meanDir(bonks), by, 10);
        emit(this.ctx, { type: 'propHit', tick: st.tick, lootId: l.id, byCharId: by, how: 'dash', coins });
      }
    } else if (l.variant === 'piggy') {
      if (dashes.length) {
        // a kick by the team opposing whoever touched it last cracks it; simultaneous kicks are
        // judged against the touch before them, so slot order never matters
        const pre = l.lastHolder !== null ? st.characters[l.lastHolder - 1]?.team ?? null : null;
        const teams = new Set(dashes.map((h) => st.characters[h.dashSlot]!.team));
        let cracks = 0;
        if (pre !== null) for (const t of teams) if (t !== pre) cracks += R.piggy.dashCracks;
        const by = soleChar(st, dashes);
        l.lastHolder = teams.size === 1 ? lowestId(st, dashes) : null;
        let coins = 0;
        if (cracks > 0) coins = this.crack(idx, cracks, by, meanDir(dashes));
        emit(this.ctx, { type: 'propHit', tick: st.tick, lootId: l.id, byCharId: by, how: 'dash', coins });
        if (l.recovered) return;
      }
      // a hard knock into a wall, a safe or an officer (never a raccoon)
      const wall = hits.find((h) => h.dashSlot < 0 && h.approach >= R.piggy.wallCrackSpeed && (!h.other || h.other.cat !== CAT_CHARACTER));
      if (wall && st.tick >= prt.crackReadyTick) {
        prt.crackReadyTick = st.tick + R.piggy.wallCrackDebounceTicks;
        const coins = this.crack(idx, 1, l.lastHolder, { x: wall.dx, y: wall.dy });
        emit(this.ctx, { type: 'propHit', tick: st.tick, lootId: l.id, byCharId: l.lastHolder, how: 'impact', coins });
      }
    } else if (l.variant === 'moneyTree') {
      if (st.tick < prt.shedReadyTick) return;
      const body = this.ctx.loot[idx]!.body;
      // a dash is a bump only once it is uprooted (an anchored tree is drained by the hammer,
      // never by dash spam; §3.1 lists the dash bonk as the ATM's verb)
      const dash = l.anchored ? undefined : dashes.find((h) => h.approach > R.moneyTree.shedSpeed);
      const impact = dash
        ? null
        : body.motion === 'dynamic'
          ? hits.find((h) => h.dashSlot < 0 && h.approach > R.moneyTree.shedSpeed && h.ownSpeed >= SHED_MIN_OWN_SPEED && !(h.other && h.other.cat === CAT_CHARACTER && holders.includes(h.other.entityId)))
          : undefined;
      const h = dash ?? impact;
      if (!h) return;
      prt.shedReadyTick = st.tick + R.moneyTree.shedDebounceTicks;
      const by = dash ? soleChar(st, dashes.filter((d) => d.approach > R.moneyTree.shedSpeed)) : l.lastHolder;
      const coins = this.releaseCoins(idx, 1, 'shed', dash ? meanDir(dashes) : { x: h.dx, y: h.dy }, by, 50);
      emit(this.ctx, { type: 'propHit', tick: st.tick, lootId: l.id, byCharId: by, how: dash ? 'dash' : 'impact', coins });
    }
  }

  /** ATM spurts (progress thresholds) and flights; body poses are current here. */
  override afterPhysics(): void {
    const st = this.ctx.state;
    const R = PROP_RULES.atm;
    for (const [idx, prt] of this.rts) {
      const l = st.loot[idx]!;
      if (l.variant !== 'atm' || l.recovered) continue;
      const p = l.unanchorProgress;
      if (p <= prt.lastProgress) {
        prt.lastProgress = p;
        continue;
      }
      let n = 0;
      for (const t of R.spurtAt) if (prt.lastProgress < t - 1e-9 && p >= t - 1e-9) n++;
      prt.lastProgress = p;
      for (let k = 0; k < n; k++) this.spurt(idx);
    }
    if (this.flights.size) {
      for (let idx = 0; idx < st.loot.length; idx++) {
        if (!this.flights.has(idx)) continue;
        const l = st.loot[idx]!;
        const a = l.airborne;
        if (!a || l.recovered) {
          this.flights.delete(idx);
          continue;
        }
        if (st.tick >= a.toTick) this.land(idx, a.to);
        else {
          const t = (st.tick - a.fromTick) / Math.max(1, a.toTick - a.fromTick);
          this.poseFlight(idx, a.from.x + (a.to.x - a.from.x) * t, a.from.y + (a.to.y - a.from.y) * t);
        }
      }
    }
  }

  /** 돈나무: its carrier knocked down (any cause) sheds a bundle (end of tick, all knockdowns seen). */
  override postTick(): void {
    const st = this.ctx.state;
    const evs = this.ctx.events;
    for (let k = 0; k < evs.length; k++) {
      const e = evs[k]!;
      if (e.type !== 'release' || !e.forced) continue;
      const ch = st.characters[e.charId - 1];
      if (!ch || ch.knockdownTicks <= 0) continue;
      const idx = this.ctx.lootIndex.get(e.targetId);
      if (idx === undefined) continue;
      const l = st.loot[idx]!;
      if (l.variant !== 'moneyTree' || l.recovered || l.airborne) continue;
      const prt = this.rtOf(idx);
      if (st.tick < prt.shedReadyTick) continue;
      prt.shedReadyTick = st.tick + PROP_RULES.moneyTree.shedDebounceTicks;
      const body = this.ctx.loot[idx]!.body;
      const cb = this.ctx.chars[ch.slot]!.body;
      const coins = this.releaseCoins(idx, 1, 'shed', { x: body.x - cb.x, y: body.y - cb.y }, null, 50);
      emit(this.ctx, { type: 'propHit', tick: st.tick, lootId: l.id, byCharId: null, how: 'impact', coins });
    }
  }

  // -------------------------------------------------------------------------
  // Entry points for other packages
  // -------------------------------------------------------------------------

  /**
   * [C3 for C2] The hammer (or golden hammer) hit prop `lootId` swinging along `dir` (radians):
   * ATM +0.5 uproot progress and 3 coins out, 돈나무 +0.4 and 2 bundles, piggy 2 cracks, gold safe
   * +0.5 (a large safe). Emits `propHit` (how 'hammer'). Returns false (and does nothing) when
   * `lootId` is not a live prop, so the caller applies its plain-safe / bank rule instead.
   */
  hammerHit(lootId: EntityId, byCharId: EntityId | null, dir: number): boolean {
    const idx = this.liveProp(lootId);
    if (idx < 0) return false;
    const st = this.ctx.state;
    const l = st.loot[idx]!;
    const R = PROP_RULES;
    const d = { x: Math.cos(dir), y: Math.sin(dir) };
    let coins = 0;
    if (l.variant === 'atm') {
      coins = this.releaseCoins(idx, R.atm.hammerCoins, 'bonk', d, byCharId, 10);
      if (l.anchored) addUnanchorProgress(this.ctx, lootId, R.atm.hammerProgress, byCharId);
    } else if (l.variant === 'moneyTree') {
      coins = this.releaseCoins(idx, R.moneyTree.hammerBundles, 'shed', d, byCharId, 50);
      if (l.anchored) addUnanchorProgress(this.ctx, lootId, R.moneyTree.hammerProgress, byCharId);
    } else if (l.variant === 'piggy') {
      if (byCharId !== null) l.lastHolder = byCharId;
      coins = this.crack(idx, R.piggy.hammerCracks, byCharId, d);
    } else if (l.anchored) {
      addUnanchorProgress(this.ctx, lootId, R.goldSafe.hammerProgress, byCharId);
    }
    emit(this.ctx, { type: 'propHit', tick: st.tick, lootId, byCharId, how: 'hammer', coins });
    return true;
  }

  /**
   * [C3 for C4 / C5] A hazard (fountain show, pile driver, quake) hit prop `lootId`: the piggy
   * takes 1 crack (`propHit` how 'hazard'). Uproot progress for anchored props stays the caller's
   * `addUnanchorProgress` (ATM spurts follow from it). Returns false when not a live prop.
   * `dir` (radians) orients a smashing burst; the default points along the mirror axis (+y), so
   * a hazard smash on the axis splits the jackpot evenly between the halves.
   */
  hazardHit(lootId: EntityId, byCharId: EntityId | null = null, dir: number = AXIS_DIR): boolean {
    const idx = this.liveProp(lootId);
    if (idx < 0) return false;
    const l = this.ctx.state.loot[idx]!;
    if (l.variant !== 'piggy') return true;
    const coins = this.crack(idx, PROP_RULES.piggy.hazardCracks, byCharId, angleVec(dir));
    emit(this.ctx, { type: 'propHit', tick: this.ctx.state.tick, lootId, byCharId, how: 'hazard', coins });
    return true;
  }

  /**
   * [C3] Add `cracks` to piggy `lootId` (emits `piggyCrack`; the smashing crack bursts every pile
   * and removes the shell). Returns the number of piles spawned. No-op for anything else.
   * `dir` (radians) orients a smashing burst (default: along the mirror axis, as `hazardHit`).
   */
  crackPiggy(lootId: EntityId, cracks: number, byCharId: EntityId | null, dir: number = AXIS_DIR): number {
    const idx = this.liveProp(lootId);
    if (idx < 0 || this.ctx.state.loot[idx]!.variant !== 'piggy') return 0;
    return this.crack(idx, cracks, byCharId, angleVec(dir));
  }

  private liveProp(lootId: EntityId): number {
    const idx = this.ctx.lootIndex.get(lootId);
    if (idx === undefined) return -1;
    const l = this.ctx.state.loot[idx]!;
    return l.variant && !l.recovered && !l.airborne && !l.dormant ? idx : -1;
  }

  // -------------------------------------------------------------------------
  // Coins out of a shell
  // -------------------------------------------------------------------------

  private spurt(idx: number): void {
    const st = this.ctx.state;
    const l = st.loot[idx]!;
    const body = this.ctx.loot[idx]!.body;
    // away from the pullers (a rival beside you can snatch them), else out of the ATM's front
    let mx = 0;
    let my = 0;
    let n = 0;
    let by: EntityId | null = null;
    for (const cid of l.grabbedBy) {
      const cb = this.ctx.chars[cid - 1]!.body;
      mx += cb.x;
      my += cb.y;
      n++;
      by = n === 1 ? cid : null;
    }
    let dir = n > 0 ? { x: body.x - mx / n, y: body.y - my / n } : null;
    if (!dir || Math.hypot(dir.x, dir.y) < 0.1) dir = { x: Math.cos(body.a), y: Math.sin(body.a) }; // pulled from both sides
    this.releaseCoins(idx, PROP_RULES.atm.spurtCoins, 'spurt', dir, by, 10);
  }

  /** Crack the piggy; on the smashing crack burst everything and remove the shell. Returns piles spawned. */
  private crack(idx: number, cracks: number, byCharId: EntityId | null, dir: Vec2): number {
    const st = this.ctx.state;
    const l = st.loot[idx]!;
    if (cracks <= 0 || l.recovered) return 0;
    const total = PROP_RULES.piggy.cracksToSmash;
    l.cracks = Math.min(total, (l.cracks ?? 0) + cracks);
    const smashed = l.cracks >= total;
    let coins = 0;
    if (smashed) {
      coins = this.releaseCoins(idx, Infinity, 'smash', dir, byCharId, 50, 'radial');
      // the shell scored nothing: out of play (no recovered event)
      const rt = this.ctx.loot[idx]!;
      for (const cid of [...l.grabbedBy]) doRelease(this.ctx, cid - 1, false);
      l.grabbedBy = [];
      l.recovered = true;
      l.recoveredBy = null;
      l.recoveredTick = st.tick;
      l.recovery = null;
      l.floorOf = null;
      l.loadedIn = null;
      l.vel = { x: 0, y: 0 };
      l.angVel = 0;
      l.estimatedValue = l.baseValue + (l.innerValue ?? 0);
      this.ctx.settled.add(l.id);
      const b = rt.body;
      b.enabled = false;
      b.vx = 0;
      b.vy = 0;
      b.w = 0;
      b.floor = null;
    }
    emit(this.ctx, { type: 'piggyCrack', tick: st.tick, lootId: l.id, cracks: l.cracks, smashed, byCharId });
    return coins;
  }

  /**
   * Move up to `n` piles (preferring `prefer`-valued ones) out of the prop's innerValue as a
   * burst: spawnCoins, then innerValue / estimatedValue drop by exactly the pile values. Returns
   * the number of piles spawned (0 when empty).
   */
  private releaseCoins(idx: number, n: number, source: CoinSpawnSource, dir: Vec2, byCharId: EntityId | null, prefer: 10 | 50, pattern: 'fan' | 'radial' = 'fan'): number {
    const st = this.ctx.state;
    const l = st.loot[idx]!;
    const spec = PROP_SPECS[l.variant!];
    const inner = l.innerValue ?? 0;
    let c50 = Math.min(spec.inner.c50, Math.floor(inner / 50));
    let c10 = Math.floor((inner - c50 * 50) / 10);
    let t50 = 0;
    let t10 = 0;
    while (t50 + t10 < n && c10 + c50 > 0) {
      if ((prefer === 50 && c50 > 0) || c10 === 0) {
        t50++;
        c50--;
      } else {
        t10++;
        c10--;
      }
    }
    const values = mirrorValues(t50, t10, pattern, prefer);
    if (values.length === 0) return 0;
    const body = this.ctx.loot[idx]!.body;
    const dl = Math.hypot(dir.x, dir.y);
    const ux = dl > 1e-9 ? dir.x / dl : Math.cos(body.a);
    const uy = dl > 1e-9 ? dir.y / dl : Math.sin(body.a);
    const off = pattern === 'radial' ? 0 : Math.max(l.half.x, l.half.y) + SPAWN_GAP;
    const pos = { x: body.x + ux * off, y: body.y + uy * off };
    let sum = 0;
    for (const v of values) sum += v;
    this.ctx.content!.coins.spawnCoins({ pos, dir: Math.atan2(uy, ux), values, pattern, source, sourceId: l.id, byCharId });
    l.innerValue = inner - sum;
    l.estimatedValue = l.baseValue + l.innerValue;
    return values.length;
  }

  // -------------------------------------------------------------------------
  // Flights
  // -------------------------------------------------------------------------

  /** @internal flyBody */
  startFlight(lootId: EntityId, to: Vec2, ticks: number, via: 'catapult' | 'tube' | 'crane' | 'parachute', opts: FlyOptions): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const idx = ctx.lootIndex.get(lootId);
    if (idx === undefined) throw new Error(`flyBody: unknown loot ${lootId}`);
    const l = st.loot[idx]!;
    if (l.recovered) throw new Error(`flyBody: loot ${lootId} is already recovered`);
    if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) throw new Error('flyBody: non-finite target');
    const body = ctx.loot[idx]!.body;
    const n = Math.max(1, Math.round(Number.isFinite(ticks) ? ticks : 1));
    const prev = this.flights.get(idx);
    const cargo: Flight['cargo'] = prev ? prev.cargo : [];
    if (!prev && l.kind === 'bank') {
      const c = Math.cos(body.a);
      const s = Math.sin(body.a);
      for (let j = 0; j < st.loot.length; j++) {
        const o = st.loot[j]!;
        if (o.kind === 'bank' || o.recovered || o.airborne || o.dormant) continue;
        const ob = ctx.loot[j]!.body;
        if (!(ob.weldParent === body || (ob.motion === 'dynamic' && onFloor(body, ob.x, ob.y)))) continue;
        const dx = ob.x - body.x;
        const dy = ob.y - body.y;
        const lx = dx * c + dy * s;
        const ly = -dx * s + dy * c;
        // a free safe LOADED on the floor rides welded for the flight (bodies are disabled, so the
        // weld only tells updateLoading it stays loaded: no unload / load events, the bank keeps
        // its estimate); the weld comes off on landing
        const tempWeld = ob.weldParent !== body && o.loadedIn === l.id;
        if (tempWeld) {
          ob.weldParent = body;
          ob.weldLx = lx;
          ob.weldLy = ly;
          ob.weldLa = ob.a - body.a;
        }
        cargo.push({ idx: j, lx, ly, la: ob.a - body.a, tempWeld });
      }
    }
    this.flights.set(idx, {
      anchored: prev ? prev.anchored : l.anchored,
      exitVx: opts.exitVel?.x ?? 0,
      exitVy: opts.exitVel?.y ?? 0,
      cargo,
    });
    const air = { fromTick: st.tick, toTick: st.tick + n, from: { x: body.x, y: body.y }, to: { x: to.x, y: to.y }, via };
    this.takeOff(idx, air);
    for (const cg of cargo) {
      const o = st.loot[cg.idx]!;
      this.takeOff(cg.idx, { ...air, from: { ...o.pos }, to: { x: to.x, y: to.y } });
    }
  }

  private takeOff(idx: number, air: NonNullable<LootState['airborne']>): void {
    const l = this.ctx.state.loot[idx]!;
    const body = this.ctx.loot[idx]!.body;
    for (const cid of [...l.grabbedBy]) doRelease(this.ctx, cid - 1, true);
    l.airborne = air;
    if (l.dormant) l.dormant = false;
    l.recovery = null;
    // floorOf / loadedIn are left to updateLoading, which emits the safeUnloaded of a safe flown
    // off a bank on its own and keeps a flown bank's cargo loaded (welded) all flight
    if (body.weldParent && !this.isCargo(idx)) {
      // an anchored interior safe flown on its own leaves its weld (lands anchored where it lands)
      body.weldParent = null;
      body.motion = l.anchored ? 'static' : 'dynamic';
    }
    body.enabled = false;
    body.vx = 0;
    body.vy = 0;
    body.w = 0;
    body.floor = null;
  }

  private isCargo(idx: number): boolean {
    for (const f of this.flights.values()) if (f.cargo.some((c) => c.idx === idx)) return true;
    return false;
  }

  /** Ground pose of a flying item (and its cargo) at (x, y). */
  private poseFlight(idx: number, x: number, y: number): void {
    const body = this.ctx.loot[idx]!.body;
    body.x = x;
    body.y = y;
    body.updateShapes(0);
    const f = this.flights.get(idx);
    if (!f) return;
    const c = Math.cos(body.a);
    const s = Math.sin(body.a);
    for (const cg of f.cargo) {
      const ob = this.ctx.loot[cg.idx]!.body;
      ob.x = x + cg.lx * c - cg.ly * s;
      ob.y = y + cg.lx * s + cg.ly * c;
      ob.a = body.a + cg.la;
      ob.updateShapes(0);
    }
  }

  /** @internal endFlight */
  landNow(lootId: EntityId, at?: Vec2): void {
    const idx = this.ctx.lootIndex.get(lootId);
    if (idx === undefined || !this.flights.has(idx)) return;
    const body = this.ctx.loot[idx]!.body;
    this.land(idx, at ?? { x: body.x, y: body.y });
  }

  private land(idx: number, target: Vec2): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const l = st.loot[idx]!;
    const rt = ctx.loot[idx]!;
    const body = rt.body;
    const f = this.flights.get(idx)!;
    this.flights.delete(idx);
    const ignore = new Set<number>([l.id]);
    for (const cg of f.cargo) ignore.add(st.loot[cg.idx]!.id);
    const half = l.kind === 'bank' ? bankFootprint(body).half : l.half;
    const fits = (p: Vec2): boolean => this.landingFree({ center: p, half, angle: body.a }, ignore);
    const spot = spiralSearch(target, fits, 14, 0.25) ?? { x: target.x, y: target.y };
    this.poseFlight(idx, spot.x, spot.y);
    l.airborne = null;
    body.enabled = true;
    body.w = 0;
    if (f.anchored) setLootAnchored(ctx, idx);
    else {
      body.weldParent = null;
      body.motion = 'dynamic';
      body.vx = f.exitVx;
      body.vy = f.exitVy;
    }
    body.updateShapes(0);
    settleRt(rt);
    for (const cg of f.cargo) {
      const o = st.loot[cg.idx]!;
      const crt = ctx.loot[cg.idx]!;
      const ob = crt.body;
      o.airborne = null;
      if (cg.tempWeld) ob.weldParent = null;
      ob.enabled = true;
      ob.vx = 0;
      ob.vy = 0;
      ob.w = 0;
      if (ob.motion === 'kinematic' && ob.weldParent) PhysicsWorld.syncWeld(ob);
      ob.updateShapes(0);
      settleRt(crt);
    }
  }

  /** Landing test: inside the arena, clear of enabled statics, bank footprints and other loot. */
  private landingFree(o: OBB, ignore: Set<number>): boolean {
    const ctx = this.ctx;
    const ex = Math.abs(Math.cos(o.angle)) * o.half.x + Math.abs(Math.sin(o.angle)) * o.half.y;
    const ey = Math.abs(Math.sin(o.angle)) * o.half.x + Math.abs(Math.cos(o.angle)) * o.half.y;
    const c = o.center;
    const size = ctx.layout.size;
    if (c.x - ex < 0 || c.y - ey < 0 || c.x + ex > size.x || c.y + ey > size.y) return false;
    for (const s of ctx.physics.queryStatics(c.x - ex, c.y - ey, c.x + ex, c.y + ey)) {
      if (!s.enabled) continue;
      if (s.type === SHAPE_CIRCLE) {
        if (circleOverlapsOBB({ x: s.x, y: s.y }, s.r, o)) return false;
      } else if (obbOverlap(o, staticToOBB(s))) return false;
    }
    const st = ctx.state;
    const rad = Math.hypot(o.half.x, o.half.y);
    for (let i = 0; i < st.loot.length; i++) {
      const l = st.loot[i]!;
      if (l.recovered || l.airborne || l.dormant || ignore.has(l.id)) continue;
      const b = ctx.loot[i]!.body;
      if (!b.enabled) continue;
      if (Math.hypot(b.x - c.x, b.y - c.y) > rad + Math.hypot(l.half.x, l.half.y) + 0.01) continue;
      if (obbOverlap(o, l.kind === 'bank' ? bankFootprint(b) : lootOBBOf(l, b))) return false;
    }
    return true;
  }
}

function settleRt(rt: SimContext['loot'][number]): void {
  rt.lastX = rt.body.x;
  rt.lastY = rt.body.y;
  rt.lastA = rt.body.a;
  rt.stuckTicks = 0;
}

/** Burst direction along the map's mirror axis (x = W/2 maps onto itself): +y. */
const AXIS_DIR = Math.PI / 2;

/** Unit vector of `a`, exact on the axes (cos(π/2) is not 0 in floating point). */
function angleVec(a: number): Vec2 {
  if (a === AXIS_DIR) return { x: 0, y: 1 };
  if (a === -AXIS_DIR) return { x: 0, y: -1 };
  return { x: Math.cos(a), y: Math.sin(a) };
}

/**
 * Order `n50` 50s and `n10` 10s so the burst is mirror-symmetric about its direction (§3.3: a
 * mirrored hit yields mirrored piles). C1's tables pair pile i with n − i ('radial'; 0 and n/2
 * lie on the axis) or n − 1 − i ('fan'; the middle pile lies on the axis), so partners must carry
 * equal values. The 50s take the on-axis slots first, then pairs spread evenly round the burst.
 * When no symmetric order exists (an even 'fan' with an odd count of each) the last pile of the
 * non-preferred value stays inside.
 */
export function mirrorValues(n50: number, n10: number, pattern: 'fan' | 'radial', prefer: 10 | 50): (10 | 50)[] {
  let n = n50 + n10;
  if (n === 0) return [];
  if (pattern === 'fan' && n % 2 === 0 && n50 % 2 === 1) {
    if (prefer === 50) n10--;
    else n50--;
    n--;
  }
  const out = new Array<10 | 50>(n).fill(10);
  const selfs: number[] = [];
  const pairs: [number, number][] = [];
  if (pattern === 'radial') {
    selfs.push(0);
    if (n % 2 === 0 && n > 1) selfs.push(n / 2);
    for (let i = 1; i * 2 < n; i++) pairs.push([i, n - i]);
  } else {
    if (n % 2 === 1) selfs.push((n - 1) / 2);
    for (let i = 0; i * 2 < n - 1; i++) pairs.push([i, n - 1 - i]);
  }
  let r50 = n50;
  let r10 = n10;
  for (const k of selfs) {
    // fix the parity of the 50s first (then of the 10s); both even: prefer a bill on the axis
    const v: 10 | 50 = r50 % 2 === 1 ? 50 : r10 % 2 === 1 ? 10 : r50 > 0 ? 50 : 10;
    out[k] = v;
    if (v === 50) r50--;
    else r10--;
  }
  const p50 = r50 / 2;
  for (let j = 0; j < p50; j++) {
    const [a, b] = pairs[Math.floor(((j + 0.5) * pairs.length) / p50)]!;
    out[a] = 50;
    out[b] = 50;
  }
  return out;
}

const otherKey = (p: PendingImpact): number => (p.other ? p.other.entityId : 0);

/** The one character behind these hits, or null when several hit together. */
function soleChar(st: SimContext['state'], hs: PendingImpact[]): EntityId | null {
  const ids = new Set(hs.map((h) => st.characters[h.dashSlot]!.id));
  return ids.size === 1 ? [...ids][0]! : null;
}

function lowestId(st: SimContext['state'], hs: PendingImpact[]): EntityId {
  let id = Infinity;
  for (const h of hs) id = Math.min(id, st.characters[h.dashSlot]!.id);
  return id;
}

/** Sum of the hit directions (order-independent); falls back to the first when they cancel. */
function meanDir(hs: PendingImpact[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const h of hs) {
    x += h.dx;
    y += h.dy;
  }
  return Math.hypot(x, y) > 1e-6 ? { x, y } : { x: hs[0]!.dx, y: hs[0]!.dy };
}
