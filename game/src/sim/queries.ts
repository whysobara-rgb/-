/**
 * Spatial queries over the live simulation (used by rules, anti-pin, bots via Simulation).
 */
import { BANK_MODEL, CHARACTER, PROP_SPECS } from './config';
import { COINS } from './config';
import type { SimContext } from './context';
import { bankFootprint, bankWalls, lootOBBOf } from './actions';
import { circleOverlapsOBB, obbOverlap, pointInOBB, rayCircle, rayOBB } from './math';
import { SHAPE_CIRCLE, type StaticShape } from './physics';
import type { CharacterState, EntityId, LootKind, LootState, OBB, SimState, TeamId, Vec2 } from './types';
import type { CoinPile } from './types';

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
    // police officers count as characters here (they are solid walkers too)
    if (ctx.police && !ctx.police.isFreeOfOfficers(p, radius, opt.ignoreCharId)) return false;
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

// ---------------------------------------------------------------------------------------------
// Fun round contracts (docs/ARCHITECTURE.md "Fun round contracts"; owner WP4). Pure reads of
// SimState, no sim behaviour change. Consumers (HUD, MomentTracker, feel, audio tension, tools)
// call these and never re-derive match point / swing arithmetic themselves.
// ---------------------------------------------------------------------------------------------

/**
 * The single largest load whose recovery right now would END the match (doc §8 end check).
 *
 * - `team`: the team that would recover it.
 * - `kind`: 'win' = that recovery ends the match with `team` ahead (an early decision
 *   `lead > other + remainingValue`, or the last loot with `team` ahead); 'tie' = it is the
 *   last loot and its recovery leaves the scores equal (a draw). A 'tie' load is never a win:
 *   the HUD must not claim "승리 확정" for it.
 * - `value`: the points it would add (`LootState.estimatedValue`; bank = 500 + loaded safes).
 * - `lootIds`: the load id first, then (bank) its loaded safe ids ascending — what the view glows.
 * - `carrierIds`: characters of `team` holding it now, ascending (may be empty while it dwells
 *   in the zone on its own).
 */
export interface MatchPointInfo {
  team: TeamId;
  kind: 'win' | 'tie';
  value: number;
  lootIds: EntityId[];
  carrierIds: EntityId[];
  /**
   * (add-only, F4 / Content 2.0) Characters of `team` whose coin bag (주머니) is part of this load,
   * ascending. Present only when bags count: a bag on its own (`lootIds` is then EMPTY and
   * `carrierIds` = `bagCharIds`), or the bags of a held load's carriers riding along with it
   * (deposited in the same zone visit). `value` includes those bags. Absent in classic.
   */
  bagCharIds?: EntityId[];
}

/** How far a team is from the other one (HUD "역전까지 N · 남은 M"). */
export interface SwingInfo {
  /** Points still needed to draw level (0 when level or ahead). */
  toTie: number;
  /**
   * Points still needed to be strictly ahead (0 when already ahead). Loot values are multiples
   * of the smallest loot value (100), so "ahead" means deficit + that step (tied -> 100).
   */
  toLead: number;
  /** `state.remainingValue`: every point still on the field. */
  remaining: number;
}

export interface MatchPointOptions {
  /** Mirror of `RuleConfig.earlyDecision` (default true, as in DEFAULT_RULES / every match). */
  earlyDecision?: boolean;
}

type MatchPointState = Pick<SimState, 'over' | 'scores' | 'remainingValue' | 'loot' | 'characters'>;

/**
 * Outcome of `team` recovering `value` points of loot right now, with the exact arithmetic of
 * `checkEnd` (rules.ts): all loot recovered -> by score; else an early decision when
 * `max > min + remaining`. null = the match goes on.
 */
function endIfRecovered(st: MatchPointState, team: TeamId, value: number, earlyDecision: boolean): 'win' | 'tie' | null {
  const scores: [number, number] = [st.scores[0], st.scores[1]];
  scores[team] += value;
  const remaining = st.remainingValue - value;
  const other: TeamId = team === 0 ? 1 : 0;
  if (remaining <= 0) {
    if (scores[team] === scores[other]) return 'tie';
    return scores[team] > scores[other] ? 'win' : null;
  }
  if (earlyDecision && scores[team] > scores[other] + remaining) return 'win';
  return null;
}

/** Order key of a bag-only load: after every loot id (loot ids stay below the coin id range). */
const BAG_LOAD_ORDER = 1e9;

/**
 * Match point right now (null = none, or the match is over). Considers every unrecovered loot
 * that is in play: dwelling in a recovery zone (`recovery`, for that zone's team) or held by
 * characters while free (unanchored), for each team holding it. Safes loaded in a bank are
 * settled with the bank, never on their own, so only the bank counts for them.
 *
 * Content 2.0 (F4): coin bags (주머니) are loads too — a bag scores by a 0.5 s deposit in its own
 * team's zone, settled in the same step-4 batch as loot recoveries, so the same `checkEnd`
 * arithmetic applies. Each character with a bag is a bag load (`lootIds` empty, `bagCharIds` =
 * [it]); a held load also carries its team's carriers' bags (they arrive in the zone together).
 * Classic states have no bags, so classic answers are unchanged.
 *
 * Picks the largest `value`; ties broken by a load already dwelling in that team's zone (its
 * recovery or deposit is under way, so it beats another team merely holding the same load), then
 * 'win' before 'tie', more carriers, lower loot id (bag-only loads after every loot, by character
 * id), lower team id (deterministic).
 */
export function matchPointInfo(state: Readonly<MatchPointState>, opts: MatchPointOptions = {}): MatchPointInfo | null {
  if (state.over) return null;
  const early = opts.earlyDecision ?? true;
  const teamOf = new Map<EntityId, TeamId>();
  const bagOf = new Map<EntityId, number>();
  for (const c of state.characters) {
    teamOf.set(c.id, c.team);
    const bag = c.bag ?? 0;
    if (bag > 0) bagOf.set(c.id, bag);
  }
  let best: Candidate | null = null;
  for (const l of state.loot) {
    if (l.recovered || l.loadedIn !== null) continue;
    const teams: TeamId[] = [];
    if (l.recovery) teams.push(l.recovery.team);
    if (!l.anchored) {
      for (const id of l.grabbedBy) {
        const t = teamOf.get(id);
        if (t !== undefined && !teams.includes(t)) teams.push(t);
      }
    }
    for (const team of teams) {
      const carrierIds = l.anchored ? [] : l.grabbedBy.filter((id) => teamOf.get(id) === team).sort((a, b) => a - b);
      const bagCharIds = carrierIds.filter((id) => bagOf.has(id));
      let bags = 0;
      for (const id of bagCharIds) bags += bagOf.get(id)!;
      const value = l.estimatedValue + bags;
      const kind = endIfRecovered(state, team, value, early);
      if (!kind) continue;
      const cand: Candidate = {
        team,
        kind,
        value,
        lootIds: l.kind === 'bank' ? [l.id, ...[...l.loadedSafes].sort((a, b) => a - b)] : [l.id],
        carrierIds,
        dwelling: l.recovery?.team === team,
        lootId: l.id,
      };
      if (bagCharIds.length) cand.bagCharIds = bagCharIds;
      if (!best || better(cand, best)) best = cand;
    }
  }
  // every bag on its own (a carrier's bag also rides with its load above; the larger one wins)
  for (const c of state.characters) {
    const bag = bagOf.get(c.id);
    if (bag === undefined) continue;
    const kind = endIfRecovered(state, c.team, bag, early);
    if (!kind) continue;
    const cand: Candidate = {
      team: c.team,
      kind,
      value: bag,
      lootIds: [],
      carrierIds: [c.id],
      bagCharIds: [c.id],
      dwelling: (c.depositTicks ?? 0) > 0,
      lootId: BAG_LOAD_ORDER + c.id,
    };
    if (!best || better(cand, best)) best = cand;
  }
  if (!best) return null;
  const out: MatchPointInfo = { team: best.team, kind: best.kind, value: best.value, lootIds: best.lootIds, carrierIds: best.carrierIds };
  if (best.bagCharIds) out.bagCharIds = best.bagCharIds;
  return out;
}

type Candidate = MatchPointInfo & { dwelling: boolean; lootId: EntityId };

function better(a: Candidate, b: Candidate): boolean {
  if (a.value !== b.value) return a.value > b.value;
  // a recovery already under way is what happens next: it beats a mere holder's claim (a load
  // held by one team while it dwells in the other team's zone is THAT team's match point)
  if (a.dwelling !== b.dwelling) return a.dwelling;
  if (a.kind !== b.kind) return a.kind === 'win';
  if (a.carrierIds.length !== b.carrierIds.length) return a.carrierIds.length > b.carrierIds.length;
  if (a.lootId !== b.lootId) return a.lootId < b.lootId;
  return a.team < b.team;
}

/**
 * Swing readout for `team` (pure; see SwingInfo).
 *
 * `toLead` is the smallest score gain that puts `team` strictly ahead: the next multiple of the
 * field's value step above the deficit. The step is the greatest common divisor of every value
 * still on the field — classic: loot values (100) -> deficit + 100; Content 2.0 (F4, "the swing
 * readout counts coins"): coins, bags, props' inner coins and breakables come in 10s, so a
 * 30-point deficit needs 40, not 130. Optional state fields are read when present (classic
 * callers and old fixtures pass only scores / remainingValue / loot).
 */
export function swingInfo(
  state: Readonly<Pick<SimState, 'scores' | 'remainingValue' | 'loot'> & Partial<Pick<SimState, 'coins' | 'characters' | 'breakables' | 'matchEvents'>>>,
  team: TeamId,
): SwingInfo {
  const mine = state.scores[team];
  const theirs = state.scores[team === 0 ? 1 : 0];
  let g = 0;
  const add = (v: number | undefined): void => {
    if (v && v > 0 && Number.isInteger(v)) g = gcd(g, v);
  };
  // coin value (inner coins, piles, bags, breakables, pending event coins) moves in single coins
  // (spills split bags, piles merge into bags), so any of it makes the coin the step
  const addCoins = (v: number | undefined): void => {
    if (v && v > 0) {
      add(v);
      add(COINS.coin);
    }
  };
  for (const l of state.loot) {
    if (l.recovered) continue;
    add(l.baseValue);
    addCoins(l.innerValue);
  }
  for (const p of state.coins ?? []) addCoins(p.value);
  for (const c of state.characters ?? []) addCoins(c.bag);
  for (const b of state.breakables ?? []) if (!b.broken) addCoins(b.innerValue);
  for (const e of state.matchEvents ?? []) addCoins(e.pendingValue);
  if (g === 0) {
    // nothing left on the field: the old rule (smallest loot value, else 100)
    let step = Infinity;
    for (const l of state.loot) if (l.baseValue > 0 && l.baseValue < step) step = l.baseValue;
    g = Number.isFinite(step) ? step : 100;
  }
  const deficit = theirs - mine;
  return {
    toTie: Math.max(0, deficit),
    toLead: mine > theirs ? 0 : (Math.floor(deficit / g) + 1) * g,
    remaining: state.remainingValue,
  };
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

// ---------------------------------------------------------------------------------------------
// Content 2.0 contracts (C0 day-0 signatures; owner C1). Pure reads of SimState. Police targeting
// (C1 one-line hook), bots (C6), HUD (C8) and F4 call these instead of re-deriving them.
// ---------------------------------------------------------------------------------------------

/**
 * What a character carries right now: the estimatedValue of the loot it holds (bank wall
 * holders count the bank; props include their innerValue) + its coin bag. 0 = empty hands and an
 * empty bag (never tackled). Classic: the held loot's estimate.
 */
export function heldValue(state: Readonly<Pick<SimState, 'characters' | 'loot'>>, charId: EntityId): number {
  const ch: CharacterState | undefined = state.characters[charId - 1];
  if (!ch || ch.id !== charId) return 0;
  let v = ch.bag ?? 0;
  if (ch.grab) {
    const id = ch.grab.targetId;
    const l = state.loot.find((x) => x.id === id);
    if (l && !l.recovered) v += l.estimatedValue;
  }
  return v;
}

/**
 * [C1] Police "carrying" test: holding loot, or a coin bag of at least COINS.policeBagMin.
 * Empty hands and an empty bag are never chased or tackled.
 */
export function policeCarrying(ch: Readonly<Pick<CharacterState, 'grab' | 'bag'>>): boolean {
  return !!ch.grab || (ch.bag ?? 0) >= COINS.policeBagMin;
}

/** True if the loot can be grabbed / carried / recovered right now: not recovered, not dormant, not airborne. */
export function isCarryable(l: Readonly<LootState>): boolean {
  return !l.recovered && !l.dormant && !l.airborne;
}

/** Nav / carry class of a loot item: a prop's PROP_SPECS kind, otherwise its kind. */
export function navClassOf(l: Readonly<Pick<LootState, 'kind' | 'variant'>>): LootKind {
  return l.variant ? PROP_SPECS[l.variant].kind : l.kind;
}

/**
 * [C1] Could `charId` take this pile right now if it were close enough? (Not knocked down, the bag
 * cap allows it, and not its own freshly spilled pile.) Same rule as the sim's pickup contest.
 */
export function canPickUp(
  state: Readonly<Pick<SimState, 'characters' | 'tick'>>,
  charId: EntityId,
  pile: Readonly<Pick<CoinPile, 'value' | 'noPickupCharId' | 'noPickupUntil'>>,
): boolean {
  const ch = state.characters[charId - 1];
  if (!ch || ch.id !== charId || ch.knockdownTicks > 0) return false;
  if ((ch.bag ?? 0) + pile.value > COINS.bagCap) return false;
  return !(pile.noPickupCharId === charId && state.tick < pile.noPickupUntil);
}

/**
 * [C1] The loose pile nearest to `from` that `charId` may take (canPickUp, ignoring distance), within
 * `maxDist` (default: anywhere); ties -> lower id. null if none. For bots (C6 scoop) and HUD hints.
 */
export function nearestPile(
  state: Readonly<Pick<SimState, 'characters' | 'tick' | 'coins'>>,
  charId: EntityId,
  from: Vec2,
  maxDist = Infinity,
): CoinPile | null {
  let best: CoinPile | null = null;
  let bestD = maxDist;
  for (const p of state.coins) {
    const d = Math.hypot(p.pos.x - from.x, p.pos.y - from.y);
    if (d > bestD || (d === bestD && best !== null)) continue;
    if (!canPickUp(state, charId, p)) continue;
    best = p;
    bestD = d;
  }
  return best;
}

/** [C1] Deposit (쏟아붓기) progress of a character, 0..1 (HUD deposit ring). 0 in classic. */
export function depositProgress(state: Readonly<Pick<SimState, 'characters'>>, charId: EntityId): number {
  const ch = state.characters[charId - 1];
  if (!ch || ch.id !== charId) return 0;
  return Math.min(1, (ch.depositTicks ?? 0) / COINS.depositTicks);
}

/** [C1] Value of every loose pile on the field (not in bags). */
export function looseCoinValue(state: Readonly<Pick<SimState, 'coins'>>): number {
  let v = 0;
  for (const p of state.coins) v += p.value;
  return v;
}
