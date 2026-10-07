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
import type { DepositClaim } from './coins';
import type { EntityId, LootState, MatchResult, SimState, TeamId } from './types';

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
    // Content 2.0: dormant / airborne loot is out of the world (no floor); props never load (they
    // ride a bank floor like any body). All three fields are absent in classic.
    const f = l.dormant || l.airborne ? null : floorAt(ctx, b.x, b.y);
    l.floorOf = f ? f.id : null;
    let loaded: EntityId | null = null;
    if (l.variant) {
      // never cargo
    } else if (f) {
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
    // Content 2.0: dormant / airborne loot cannot be recovered (absent in classic)
    const eligible = !l.anchored && !l.dormant && !l.airborne && (l.kind === 'bank' || l.loadedIn === null);
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
    // Content 2.0: a prop pays its shell + the coins still inside (innerValue absent in classic)
    const inner = l.innerValue ?? 0;
    let value = l.baseValue + inner;
    const safeIds: EntityId[] = [];
    let safesValue = 0;
    if (l.kind === 'bank') {
      for (const sid of l.loadedSafes) {
        const s = lootById(ctx, sid);
        if (!s || s.state.recovered || ctx.settled.has(sid)) continue;
        safeIds.push(sid);
        safesValue += s.state.baseValue + (s.state.innerValue ?? 0);
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
      ...(l.variant ? { innerValue: inner, variant: l.variant } : {}),
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

/** Recompute state.remainingValue (computeRemainingValue). */
export function updateRemaining(ctx: SimContext): void {
  ctx.state.remainingValue = computeRemainingValue(ctx.state);
}

/**
 * Every point still on the field (content-plan §3.5, Content 2.0 extension point; C1 owns the
 * producers of each term):
 *   Σ unrecovered loot (baseValue + innerValue; dormant included) + Σ coin piles + Σ bags
 *   + Σ unbroken breakables' innerValue + Σ matchEvents' pendingValue.
 * Classic: every unrecovered safe + 500 per unrecovered bank body (the other terms are empty).
 * Invariant every tick: scores[0] + scores[1] + remainingValue === totalValue.
 */
export function computeRemainingValue(st: Readonly<Pick<SimState, 'loot' | 'coins' | 'characters' | 'breakables' | 'matchEvents'>>): number {
  let v = 0;
  for (const l of st.loot) if (!l.recovered) v += l.baseValue + (l.innerValue ?? 0);
  for (const c of st.coins) v += c.value;
  for (const ch of st.characters) v += ch.bag ?? 0;
  for (const b of st.breakables) if (!b.broken) v += b.innerValue;
  for (const e of st.matchEvents) v += e.pendingValue;
  return v;
}

/**
 * "모두 털림" (Content 2.0 extension point): every loot item recovered (dormant ones are not),
 * no loose piles, every bag empty, every breakable broken and no pending event value.
 * Classic: every loot item recovered.
 */
export function isAllRecovered(st: Readonly<Pick<SimState, 'loot' | 'coins' | 'characters' | 'breakables' | 'matchEvents'>>): boolean {
  if (st.loot.length === 0 || !st.loot.every((l) => l.recovered)) return false;
  if (st.coins.length > 0) return false;
  for (const ch of st.characters) if (ch.bag) return false;
  for (const b of st.breakables) if (!b.broken) return false;
  for (const e of st.matchEvents) if (e.pendingValue > 0) return false;
  return true;
}

/**
 * [C1] Step 4: settle this tick's bag deposits (after the loot settlements of the same tick, same
 * batch): bag -> score, emits `coinsBanked`. Claims are applied in ascending charId; a claim whose
 * bag is already empty pays nothing. Day-0 skeleton by C0 (C1 may refine; the signature is frozen).
 */
export function settleDeposits(ctx: SimContext, claims: ReadonlyArray<DepositClaim>): void {
  const st = ctx.state;
  const sorted = [...claims].sort((a, b) => a.charId - b.charId);
  for (const c of sorted) {
    const ch = st.characters[c.charId - 1];
    if (!ch || !ch.bag) continue;
    const value = Math.min(ch.bag, c.value);
    ch.bag -= value;
    ch.depositTicks = 0;
    st.scores[ch.team] += value;
    emit(ctx, { type: 'coinsBanked', tick: st.tick, charId: ch.id, team: ch.team, value });
  }
  if (sorted.length) updateRemaining(ctx);
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
  if (isAllRecovered(st)) reason = 'allRecovered';
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
