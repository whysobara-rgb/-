/**
 * (Content 2.0, C6) Coin goals: scoop (주워 담기), deposit (쏟아붓기), spill scavenging, plus the
 * scoop detour overlay (content-plan §3.3, §6 C6).
 *
 * - scoop: a cluster of loose piles (public positions / values) worth its walk; picking up is by
 *   touch (centre within COINS.pickupRadius), so the bot just walks over them, nearest first, while
 *   the bag cap (COINS.bagCap) allows. A freshly spilled pile (와르르) is extra attractive to an
 *   opportunist (눈치왕) — and the victim cannot retake its own piles for a moment anyway.
 * - deposit: the bag is never score; standing inside the own zone for COINS.depositTicks banks it.
 *   Wanted when the bag is big (>= 120), a threat is near (an officer marks bag carriers, an
 *   opponent can knock half of it loose), or the clock is short. Hauling loot home deposits on the
 *   way anyway.
 * - overlay: walking somewhere empty-handed (or with a small safe), a pile right on the way is
 *   picked up with a small step aside (a detour of a metre or two, never a new plan).
 */
import { COINS, TICK_RATE } from '../../sim/config';
import type { CoinPile, Command, EntityId, SimEvent, Vec2 } from '../../sim/types';
import { V, insideOBB } from '../geom';
import type { BotView, Candidate, Goal, GoalProvider } from './types';

const WALK = 5;
/** Piles closer together than this form one scoop cluster (m). */
const CLUSTER_R = 3.2;
/** Piles farther than this (straight line) are not considered at all (m). */
const SCAN_R = 32;
/** Pickup time per pile (s): a step over it. */
const PER_PILE_S = 0.3;

/** Can I take this pile when touching it (sim rule `canPickUp`, from public state)? */
export function mayTake(view: BotView, p: Readonly<CoinPile>, bag: number): boolean {
  if (bag + p.value > COINS.bagCap) return false;
  return !(p.noPickupCharId === view.id && view.sim.state.tick < p.noPickupUntil);
}

export class CoinGoals implements GoalProvider {
  readonly kinds = ['scoop', 'deposit'] as const;
  /** Piles that came out of a spill (pile id -> tick) — 눈치왕's scavenging. */
  private readonly spilled = new Map<EntityId, number>();

  onEvents(view: BotView, events: readonly SimEvent[]): void {
    const me = view.me();
    for (const e of events) {
      if (e.type === 'coinSpawn' && e.source === 'spill') {
        for (const id of e.ids) this.spilled.set(id, e.tick);
        // 와르르 right next to me: worth a fresh look (the victim takes it back in a second)
        if (!me.grab && V.dist(e.pos, me.pos) < 9 && (me.bag ?? 0) + COINS.coin <= COINS.bagCap) view.markUrgent();
      } else if (e.type === 'coinPickup') this.spilled.delete(e.coinId);
    }
    if (this.spilled.size > 64) {
      const t = view.sim.state.tick;
      for (const [id, at] of this.spilled) if (t - at > 20 * TICK_RATE) this.spilled.delete(id);
    }
  }

  propose(view: BotView, out: Candidate[]): void {
    const sim = view.sim;
    if (sim.rules.content !== 'v2') return;
    const st = sim.state;
    const me = view.me();
    const bag = me.bag ?? 0;
    const left = view.planLeft();
    const W = view.W;
    const wCoins = W.coins ?? 1;
    const ps = view.ps();
    // (carrying a load home deposits on the way; a scoop or a deposit trip never drops a load)
    if (me.grab) return;
    // ---- deposit ----
    if (bag > 0) {
      const zc = view.zoneCenter();
      const dz = view.walkDist(zc);
      if (Number.isFinite(dz)) {
        const t = Math.max(0, dz - 3) / WALK + 0.7;
        let urgency = bag >= 120 ? 1 : bag >= 60 ? 0.55 : 0.28;
        if (bag + COINS.coin > COINS.bagCap) urgency *= 1.5; // full: nothing more fits
        // an officer marks bag carriers: a tackle spills half of it
        if (ps.onField()) {
          const chased = ps.chasers(view.id).length > 0;
          const near = ps.nearest(me.pos);
          if (chased) urgency *= 2.4;
          else if (near && near.d < 8) urgency *= 1.5;
        }
        // an opponent close by can knock half of it loose
        if (view.threatNear(me.pos, 6)) urgency *= 1.4;
        // the clock: unbanked coins are worth nothing at the whistle
        if (left < t + 8) urgency *= 3;
        if (left < t + 1) urgency = 0;
        if (urgency > 0) out.push(view.mk('deposit', 'deposit', null, (bag / t) * urgency, bag, t, { pos: { ...zc } }));
      }
    }
    // ---- scoop ----
    const room = COINS.bagCap - bag;
    if (room < COINS.coin || st.coins.length === 0) return;
    const near: CoinPile[] = [];
    for (const p of st.coins) {
      if (!mayTake(view, p, bag)) continue;
      if (Math.abs(p.pos.x - me.pos.x) > SCAN_R || Math.abs(p.pos.y - me.pos.y) > SCAN_R) continue;
      near.push(p);
    }
    if (!near.length) return;
    near.sort((a, b) => V.dist(a.pos, me.pos) - V.dist(b.pos, me.pos) || a.id - b.id);
    if (near.length > 24) near.length = 24;
    const used = new Set<EntityId>();
    const opps = view.opponents().filter((o) => o.last && o.age < 120 && !o.last.knockedDown);
    let clusters = 0;
    for (const seed of near) {
      if (used.has(seed.id)) continue;
      const members: CoinPile[] = [];
      for (const p of near) if (!used.has(p.id) && V.dist(p.pos, seed.pos) <= CLUSTER_R) members.push(p);
      for (const p of members) used.add(p.id);
      if (++clusters > 4) break;
      const key = `scoop:${seed.id}`;
      if (view.blacklisted(key)) continue;
      if (members.some((p) => view.claimedByOther(`scoop:${p.id}`, p.id))) continue;
      let value = 0;
      let spill = 0;
      for (const p of members) {
        if (value + p.value > room) continue;
        value += p.value;
        if (this.spilled.has(p.id)) spill += p.value;
      }
      if (value <= 0) continue;
      const walk = view.walkDist(seed.pos);
      if (!Number.isFinite(walk)) continue;
      const cx = members.reduce((s, p) => s + p.pos.x, 0) / members.length;
      const cy = members.reduce((s, p) => s + p.pos.y, 0) / members.length;
      const home = view.carryDist({ x: cx, y: cy }, 'walk');
      // the coins still have to be carried home (shared with whatever comes next: a fraction)
      const t = Math.max(0, walk - 0.6) / WALK + PER_PILE_S * members.length + (Number.isFinite(home) ? home / WALK : 20) * 0.35 + 0.4;
      if (t + 2 > left) continue;
      let w = wCoins;
      // fresh spills: the opportunist's moment (and anyone's: they lie right there, and what the
      // other team does not get back is a swing both ways)
      if (spill > 0) {
        w *= 1 + (0.8 + 0.8 * W.opportunism) * (spill / value);
        // right at my feet (I just knocked them over): a second's work before anything else
        if (walk < 4) w *= 1.8;
      }
      // an opponent much closer gets there first
      for (const o of opps) {
        const od = V.dist(o.last!.pos, seed.pos) * 1.1 + (o.age / TICK_RATE) * 2.5;
        if (od + 2 < walk) {
          w *= 0.65;
          break;
        }
      }
      // police on duty: a bag makes me their mark
      if (ps.onField() && bag + value >= COINS.policeBagMin) w *= 1 - 0.25 * view.P.policeAwareness;
      out.push(view.mk('scoop', key, seed.id, (value / t) * w, value, t, { pileIds: members.map((p) => p.id), pos: { x: cx, y: cy } }));
    }
  }

  execute(view: BotView, g: Goal): Command | null {
    return g.kind === 'deposit' ? this.execDeposit(view, g) : this.execScoop(view, g);
  }

  private execScoop(view: BotView, g: Goal): Command {
    const st = view.sim.state;
    const me = view.me();
    const bag = me.bag ?? 0;
    if (me.grab) return idle(false);
    // the nearest pile of the cluster still lying there (or any takeable pile right next to me)
    let best: CoinPile | null = null;
    let bd = Infinity;
    const ids = new Set(g.pileIds ?? []);
    for (const p of st.coins) {
      if (!mayTake(view, p, bag)) continue;
      const d = V.dist(p.pos, me.pos);
      if (!ids.has(p.id) && d > 2.5) continue;
      if (g.pos && V.dist(p.pos, g.pos) > CLUSTER_R + 2 && d > 2.5) continue;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) {
      view.endGoal(bag + COINS.coin > COINS.bagCap ? 'bag full' : 'scooped');
      return idle(false);
    }
    g.phase = 'scoop';
    g.targetId = best.id;
    if (bd < 3 && view.nav.segmentClear(me.pos, best.pos, 'walk', -0.05)) return cmd(V.norm(V.sub(best.pos, me.pos)));
    const m = view.moveTo(best.pos, 'walk', 0.3);
    if (m.stuck) {
      view.blacklist(`scoop:${best.id}`, 8 * TICK_RATE);
      g.pileIds = (g.pileIds ?? []).filter((id) => id !== best!.id);
    }
    return cmd(m.move);
  }

  private execDeposit(view: BotView, g: Goal): Command {
    const me = view.me();
    if ((me.bag ?? 0) <= 0) {
      view.endGoal('deposited');
      return idle(me.grab !== null);
    }
    const zone = view.zoneOBB();
    const zc = zone.center;
    // inside the zone shrunk by a body (sim rule): stand still until the bag is banked
    if (insideOBB(me.pos, zone, 0.9)) {
      g.phase = 'deposit';
      return idle(me.grab !== null);
    }
    g.phase = 'travel';
    const m = view.moveTo(zc, 'walk', 0.8);
    return { ...cmd(m.move), grab: me.grab !== null };
  }

  /** Scoop detour: a takeable pile right on the way is picked up with a step aside. */
  overlay(view: BotView, c: Command): Command | null {
    const sim = view.sim;
    if (sim.rules.content !== 'v2' || sim.state.coins.length === 0) return null;
    if (c.dash || c.grab) return null;
    const g = view.goal();
    if (!g || g.kind === 'scoop' || g.kind === 'deposit' || g.kind === 'smash' || g.kind === 'kickPiggy' || g.kind === 'fetchItem' || g.kind === 'bonk') return null;
    if (g.phase === 'grab' || g.phase === 'aiming' || g.phase === 'strain' || g.phase === 'block') return null;
    const me = view.me();
    if (me.grab) return null;
    const ml = V.len(c.move);
    if (ml < 0.5) return null;
    const dir = V.scale(c.move, 1 / ml);
    const bag = me.bag ?? 0;
    let best: CoinPile | null = null;
    let bd = 2.2;
    for (const p of sim.state.coins) {
      const d = V.dist(p.pos, me.pos);
      if (d >= bd || d < 0.05) continue;
      if (!mayTake(view, p, bag)) continue;
      if (V.dot(V.sub(p.pos, me.pos), dir) / d < 0.35) continue;
      best = p;
      bd = d;
    }
    if (!best || !view.nav.segmentClear(me.pos, best.pos, 'walk', -0.05)) return null;
    return { ...c, move: V.norm(V.sub(best.pos, me.pos)), aim: null };
  }
}

function cmd(move: Vec2): Command {
  return { move: V.clampLen(move, 1), grab: false, dash: false, aim: null, ping: null };
}

function idle(grab: boolean): Command {
  return { move: { x: 0, y: 0 }, grab, dash: false, aim: null, ping: null };
}
