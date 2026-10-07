/**
 * Spatial queries over the live simulation (used by rules, anti-pin, bots via Simulation).
 */
import { BANK_MODEL, CHARACTER } from './config';
import type { SimContext } from './context';
import { bankFootprint, bankWalls, lootOBBOf } from './actions';
import { circleOverlapsOBB, obbOverlap, pointInOBB, rayCircle, rayOBB } from './math';
import { SHAPE_CIRCLE, type StaticShape } from './physics';
import type { EntityId, OBB, SimState, TeamId, Vec2 } from './types';

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

/**
 * Match point right now (null = none, or the match is over). Considers every unrecovered loot
 * that is in play: dwelling in a recovery zone (`recovery`, for that zone's team) or held by
 * characters while free (unanchored), for each team holding it. Safes loaded in a bank are
 * settled with the bank, never on their own, so only the bank counts for them.
 *
 * Picks the largest `value`; ties broken by a load already dwelling in that team's zone (its
 * recovery is under way, so it beats another team merely holding the same load), then 'win'
 * before 'tie', more carriers, lower loot id, lower team id (deterministic).
 */
export function matchPointInfo(state: Readonly<MatchPointState>, opts: MatchPointOptions = {}): MatchPointInfo | null {
  if (state.over) return null;
  const early = opts.earlyDecision ?? true;
  const teamOf = new Map<EntityId, TeamId>();
  for (const c of state.characters) teamOf.set(c.id, c.team);
  let best: (MatchPointInfo & { dwelling: boolean; lootId: EntityId }) | null = null;
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
      const kind = endIfRecovered(state, team, l.estimatedValue, early);
      if (!kind) continue;
      const carrierIds = l.anchored ? [] : l.grabbedBy.filter((id) => teamOf.get(id) === team).sort((a, b) => a - b);
      const cand = {
        team,
        kind,
        value: l.estimatedValue,
        lootIds: l.kind === 'bank' ? [l.id, ...[...l.loadedSafes].sort((a, b) => a - b)] : [l.id],
        carrierIds,
        dwelling: l.recovery?.team === team,
        lootId: l.id,
      };
      if (!best || better(cand, best)) best = cand;
    }
  }
  if (!best) return null;
  return { team: best.team, kind: best.kind, value: best.value, lootIds: best.lootIds, carrierIds: best.carrierIds };
}

function better(
  a: MatchPointInfo & { dwelling: boolean; lootId: EntityId },
  b: MatchPointInfo & { dwelling: boolean; lootId: EntityId },
): boolean {
  if (a.value !== b.value) return a.value > b.value;
  // a recovery already under way is what happens next: it beats a mere holder's claim (a load
  // held by one team while it dwells in the other team's zone is THAT team's match point)
  if (a.dwelling !== b.dwelling) return a.dwelling;
  if (a.kind !== b.kind) return a.kind === 'win';
  if (a.carrierIds.length !== b.carrierIds.length) return a.carrierIds.length > b.carrierIds.length;
  if (a.lootId !== b.lootId) return a.lootId < b.lootId;
  return a.team < b.team;
}

/** Swing readout for `team` (pure; see SwingInfo). */
export function swingInfo(state: Readonly<Pick<SimState, 'scores' | 'remainingValue' | 'loot'>>, team: TeamId): SwingInfo {
  const mine = state.scores[team];
  const theirs = state.scores[team === 0 ? 1 : 0];
  let step = Infinity;
  for (const l of state.loot) if (l.baseValue > 0 && l.baseValue < step) step = l.baseValue;
  if (!Number.isFinite(step)) step = 100;
  const deficit = theirs - mine;
  return {
    toTie: Math.max(0, deficit),
    toLead: mine > theirs ? 0 : deficit + step,
    remaining: state.remainingValue,
  };
}
