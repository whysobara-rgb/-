/**
 * Scoring rules (doc §8 점수 확정과 종료 판정) — loading, recovery dwell, settlement,
 * final countdown and end conditions. Called by Simulation.step in the documented order:
 *   3. updateLoading   4. updateRecovery + settle + removeRecovered   5. updateTimer   6. checkEnd
 */
import { SCORE } from './config';
import { emit, lootById, type SimContext } from './context';
import { bankFootprint, doRelease, floorAt, lootOBBOf, safeFullyOnFloor } from './actions';
import { obbInsideOBB } from './math';
import { ejectSpot } from './queries';
import type { EntityId, LootState, MatchResult, TeamId } from './types';

// ---------------------------------------------------------------------------
// 3. Loading (moving floor contents)
// ---------------------------------------------------------------------------

/** Bank value if recovered now: building + every unrecovered safe fully loaded on its floor. */
function bankValue(ctx: SimContext, bank: LootState): number {
  let v = SCORE.bankBuilding;
  for (const sid of bank.loadedSafes) {
    const s = lootById(ctx, sid);
    if (s && !s.state.recovered) v += s.state.baseValue;
  }
  return v;
}

/** Holder team of a bank right now (lowest-id holder), or null. */
function bankCarrierTeam(ctx: SimContext, bank: LootState): TeamId | null {
  for (const cid of bank.grabbedBy) {
    const ch = ctx.state.characters[cid - 1];
    if (ch) return ch.team;
  }
  return null;
}

/**
 * Recompute floorOf / loadedIn / loadedSafes / estimatedValue and emit safeLoaded /
 * safeUnloaded for every change (ascending safe id). A safe is LOADED iff its whole OBB lies
 * inside the bank's interior floor rect (doc §5: no partial / stacked loading).
 */
export function updateLoading(ctx: SimContext): void {
  const st = ctx.state;
  for (let i = 0; i < st.characters.length; i++) {
    const b = ctx.chars[i]!.body;
    const f = floorAt(ctx, b.x, b.y);
    st.characters[i]!.floorOf = f ? f.id : null;
  }
  const changes: { safe: LootState; from: EntityId | null; to: EntityId | null }[] = [];
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.kind === 'bank') continue;
    if (l.recovered) {
      l.floorOf = null;
      l.loadedIn = null;
      continue;
    }
    const b = ctx.loot[i]!.body;
    const f = floorAt(ctx, b.x, b.y);
    l.floorOf = f ? f.id : null;
    let loaded: EntityId | null = null;
    if (f) {
      const fb = lootById(ctx, f.id)!.rt.body;
      // Only cargo that actually moves with the bank can be loaded: a safe welded to this bank,
      // or a free (unanchored, dynamic) safe fully on its floor. An anchored outdoor safe the
      // bank happens to drive over stays where it is, so it is never counted (doc §5 실린 금고).
      if (b.weldParent === fb) loaded = f.id;
      else if (!l.anchored && b.motion === 'dynamic' && safeFullyOnFloor(lootOBBOf(l, b), fb)) loaded = f.id;
    } else if (b.weldParent) {
      // welded safes are always on their bank floor; be defensive anyway
      const p = b.weldParent;
      const pl = lootById(ctx, p.entityId);
      if (pl && !pl.state.recovered) loaded = p.entityId;
    }
    if (loaded !== l.loadedIn) changes.push({ safe: l, from: l.loadedIn, to: loaded });
    l.loadedIn = loaded;
  }
  // banks: loadedSafes ascending id + estimate
  for (const l of st.loot) {
    if (l.kind !== 'bank') continue;
    if (l.recovered) continue;
    const list: EntityId[] = [];
    for (const s of st.loot) if (s.kind !== 'bank' && !s.recovered && s.loadedIn === l.id) list.push(s.id);
    l.loadedSafes = list;
    l.estimatedValue = bankValue(ctx, l);
  }
  for (const c of changes) {
    if (c.from !== null) {
      const bank = lootById(ctx, c.from)!.state;
      emit(ctx, {
        type: 'safeUnloaded',
        tick: st.tick,
        safeId: c.safe.id,
        bankId: c.from,
        bankValue: bank.estimatedValue,
        byCharId: c.safe.grabbedBy.length ? c.safe.grabbedBy[0]! : null,
        bankCarrierTeam: bankCarrierTeam(ctx, bank),
      });
    }
    if (c.to !== null) {
      const bank = lootById(ctx, c.to)!.state;
      emit(ctx, { type: 'safeLoaded', tick: st.tick, safeId: c.safe.id, bankId: c.to, bankValue: bank.estimatedValue });
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Recovery dwell + settlement
// ---------------------------------------------------------------------------

/** Team whose zone fully contains the item's marked range, or null. */
export function zoneTeamFor(ctx: SimContext, idx: number): TeamId | null {
  const l = ctx.state.loot[idx]!;
  const b = ctx.loot[idx]!.body;
  const obb = l.kind === 'bank' ? bankFootprint(b) : lootOBBOf(l, b);
  const prev = l.recovery ? l.recovery.team : null;
  // keep the current zone if still inside (stable when zones touch)
  if (prev !== null) {
    for (const z of ctx.zones) if (z.team === prev && obbInsideOBB(obb, z.obb, 0)) return prev;
  }
  for (const z of ctx.zones) if (obbInsideOBB(obb, z.obb, 0)) return z.team;
  return null;
}

/**
 * Advance every eligible item's dwell. Eligible: unrecovered, unanchored, and for safes not
 * loaded in a bank (loaded safes are settled with their bank, doc §8). Only leaving the zone
 * resets progress (no low-speed condition; grabbing it or standing in the zone does not).
 * Returns the ids that completed this tick (ascending).
 */
export function updateRecovery(ctx: SimContext): EntityId[] {
  const st = ctx.state;
  const done: EntityId[] = [];
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.recovered) continue;
    const eligible = !l.anchored && (l.kind === 'bank' || l.loadedIn === null);
    const team = eligible ? zoneTeamFor(ctx, i) : null;
    const prev = l.recovery;
    if (team === null) {
      if (prev) {
        emit(ctx, { type: 'recoveryCancel', tick: st.tick, lootId: l.id, team: prev.team, progressTicks: prev.ticks });
        l.recovery = null;
      }
      continue;
    }
    if (prev && prev.team === team) {
      prev.ticks = Math.min(ctx.rules.recoveryTicks, prev.ticks + 1);
    } else {
      if (prev) emit(ctx, { type: 'recoveryCancel', tick: st.tick, lootId: l.id, team: prev.team, progressTicks: prev.ticks });
      l.recovery = { team, ticks: 1 };
      emit(ctx, { type: 'recoveryStart', tick: st.tick, lootId: l.id, team });
    }
    if (l.recovery!.ticks >= ctx.rules.recoveryTicks) done.push(l.id);
  }
  return done;
}

export interface Settlement {
  lootId: EntityId;
  team: TeamId;
  value: number;
  /** Every id recovered by this settlement (bank + its loaded safes). */
  ids: EntityId[];
}

/**
 * Settle completions together (doc §8: 같은 시각의 회수 완료를 일괄 정산).
 * Each id settles at most once; a bank pays 500 + the unrecovered safes loaded at this moment
 * and takes them with it; already-recovered ids pay nothing. Returns what was settled.
 */
export function settle(ctx: SimContext, ids: ReadonlyArray<EntityId>, teamOverride?: TeamId): Settlement[] {
  const st = ctx.state;
  const out: Settlement[] = [];
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  for (const id of sorted) {
    const rec = lootById(ctx, id);
    if (!rec) continue;
    const l = rec.state;
    if (l.recovered || ctx.settled.has(id)) continue; // duplicate request: no points
    const team = teamOverride ?? l.recovery?.team;
    if (team === undefined) continue;
    let value = l.baseValue;
    const safeIds: EntityId[] = [];
    let safesValue = 0;
    if (l.kind === 'bank') {
      for (const sid of l.loadedSafes) {
        const s = lootById(ctx, sid);
        if (!s || s.state.recovered || ctx.settled.has(sid)) continue;
        safeIds.push(sid);
        safesValue += s.state.baseValue;
      }
      value += safesValue;
    }
    const holders = [...l.grabbedBy];
    const all = [id, ...safeIds];
    for (const rid of all) {
      const r = lootById(ctx, rid)!.state;
      r.recovered = true;
      r.recoveredBy = team;
      r.recoveredTick = st.tick;
      r.recovery = null;
      ctx.settled.add(rid);
    }
    l.estimatedValue = value;
    st.scores[team] += value;
    emit(ctx, {
      type: 'recovered',
      tick: st.tick,
      lootId: id,
      kind: l.kind,
      team,
      value,
      safeIds,
      safesValue,
      holders,
    });
    if (l.kind === 'bank') {
      st.banksRecovered++;
      emit(ctx, { type: 'bankBodyRecovered', tick: st.tick, bankId: id, count: st.banksRecovered });
    }
    out.push({ lootId: id, team, value, ids: all });
  }
  if (out.length) updateRemaining(ctx);
  return out;
}

/** Remove settled items from the arena: release holders, disable bodies, eject riders. */
export function removeRecovered(ctx: SimContext, settlements: ReadonlyArray<Settlement>): void {
  const st = ctx.state;
  for (const s of settlements) {
    for (const rid of s.ids) {
      const r = lootById(ctx, rid)!;
      for (const cid of [...r.state.grabbedBy]) doRelease(ctx, cid - 1, false);
      r.state.grabbedBy = [];
      r.state.vel = { x: 0, y: 0 };
      r.state.angVel = 0;
      r.state.floorOf = null;
      r.state.loadedIn = null;
      const b = r.rt.body;
      b.enabled = false;
      b.vx = 0;
      b.vy = 0;
      b.w = 0;
      b.floor = null;
    }
    const bank = lootById(ctx, s.lootId)!;
    if (bank.state.kind !== 'bank') continue;
    const bb = bank.rt.body;
    const fp = bankFootprint(bb);
    // anything that was riding this bank now stands on the ground
    for (const lr of ctx.loot) if (lr.body.floor === bb) lr.body.floor = null;
    for (let slot = 0; slot < st.characters.length; slot++) {
      const ch = st.characters[slot]!;
      const cb = ctx.chars[slot]!.body;
      if (cb.floor === bb) cb.floor = null;
      const inside = Math.abs((cb.x - fp.center.x) * Math.cos(fp.angle) + (cb.y - fp.center.y) * Math.sin(fp.angle)) <= fp.half.x &&
        Math.abs(-(cb.x - fp.center.x) * Math.sin(fp.angle) + (cb.y - fp.center.y) * Math.cos(fp.angle)) <= fp.half.y;
      if (!inside) continue;
      // no score / damage / movement advantage: drop them at the nearest free exit spot
      if (ch.grab) doRelease(ctx, slot, false);
      const spot = ejectSpot(ctx, fp.center, fp.angle, { x: cb.x, y: cb.y }, ch.id);
      if (spot) {
        cb.x = spot.x;
        cb.y = spot.y;
      }
      cb.vx = 0;
      cb.vy = 0;
      ch.floorOf = null;
      ch.pos = { x: cb.x, y: cb.y };
      ch.vel = { x: 0, y: 0 };
      ctx.chars[slot]!.lastX = cb.x;
      ctx.chars[slot]!.lastY = cb.y;
      emit(ctx, { type: 'ejected', tick: st.tick, charId: ch.id, pos: { x: cb.x, y: cb.y } });
    }
  }
  // pings at recovered loot are meaningless now
  if (settlements.length && st.pings.length) {
    st.pings = st.pings.filter((p) => p.targetId === null || !lootById(ctx, p.targetId)?.state.recovered);
  }
}

/** remainingValue = every unrecovered safe + 500 per unrecovered bank body. */
export function updateRemaining(ctx: SimContext): void {
  let v = 0;
  for (const l of ctx.state.loot) if (!l.recovered) v += l.baseValue;
  ctx.state.remainingValue = v;
}

// ---------------------------------------------------------------------------
// 5. Final countdown, 6. end check
// ---------------------------------------------------------------------------

/**
 * Both bank bodies recovered -> endTick = min(endTick, now + 30 s), exactly once.
 * Without a time limit (practice) there is no countdown at all: the match never times out.
 */
export function updateTimer(ctx: SimContext): void {
  const st = ctx.state;
  if (!ctx.rules.timeLimit || st.finalCountdown || st.banksRecovered < 2) return;
  const totalBanks = st.loot.filter((l) => l.kind === 'bank').length;
  if (totalBanks < 2) return;
  st.finalCountdown = true;
  st.finalCountdownTick = st.tick;
  const previous = st.endTick;
  st.endTick = Math.min(st.endTick, st.tick + ctx.rules.finalCountdownTicks);
  emit(ctx, { type: 'finalCountdown', tick: st.tick, endTick: st.endTick, previousEndTick: previous });
}

/** End conditions after settlement in the same tick. Returns true if the match ended. */
export function checkEnd(ctx: SimContext): boolean {
  const st = ctx.state;
  if (st.over) return true;
  const [a, b] = st.scores;
  let reason: MatchResult['reason'] | null = null;
  if (st.loot.length > 0 && st.loot.every((l) => l.recovered)) reason = 'allRecovered';
  else if (st.tick >= st.endTick) reason = 'time';
  else if (ctx.rules.earlyDecision && Math.max(a, b) > Math.min(a, b) + st.remainingValue) reason = 'decided';
  if (!reason) return false;
  const winner: TeamId | null = a === b ? null : a > b ? 0 : 1;
  const result: MatchResult = { reason, winner, scores: [a, b], endTick: st.tick };
  st.over = true;
  st.result = result;
  emit(ctx, { type: 'matchEnd', tick: st.tick, result: { ...result, scores: [a, b] } });
  return true;
}
