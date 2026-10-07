/**
 * (Content 2.0, C6) Item goals: fetch a supply drop, and use the 뿅망치 / 황금 뿅망치
 * (content-plan §5.2, §6 C6).
 *
 * - fetchItem: an item on the ground, or a crate descending under its balloon (public: pad, item
 *   silhouette, landing tick), when the pocket is empty. Utility = what holding it is worth
 *   (itemSense.itemWorth) per second of walk + wait, x personality (hammer weight), x itemSkill.
 *   Teammates never go for the same drop (team claims); a drop both teams race for stays a race.
 * - bonk: hammer in hand, an opposing carrier (loot in hand, or a visibly fat coin bag) within
 *   ~14 m: run at it; the swing itself is the overlay's (in range, aimed with lead + aim error).
 * - useItem: hammer in hand with nothing to bonk: walk to the best thing to swing at (an anchored
 *   safe / bank / ATM / 돈나무 we want, a breakable) — more urgent as the hammer's lifetime runs out,
 *   so bots spend their swings instead of letting the item expire.
 * - overlay (every tick, on top of any goal): with a ready hammer and empty hands, swing when a
 *   good target is in reach: an officer about to tackle me / a carrying teammate, an opposing
 *   carrier, the anchored loot my goal is about to grab (a small safe pops right out), a breakable.
 *   Never when the arc would bell our own hauled bank or crack the piggy nobody of theirs holds.
 *   While the sim runs the wind-up / swing, the bot keeps its hands off (a grab cancels it).
 */
import { CHARACTER, COINS, ITEMS, TICK_RATE } from '../../sim/config';
import type { Command, EntityId, LootState, SimEvent, Vec2 } from '../../sim/types';
import { V } from '../geom';
import {
  isHammer,
  OFFICER_R,
  aimWithError,
  arcSummary,
  boxSurfacePoint,
  hammerGeom,
  holdsHammer,
  itemWorth,
  LUNGE_BONUS,
  leadPoint,
  lootSurfacePoint,
  reachesBody,
  reachesPoint,
  swingBusy,
  swingCommand,
  usableHammer,
} from '../itemSense';
import { contentSkill } from '../params';
import type { BotView, Candidate, Goal, GoalProvider } from './types';

const WALK = 5;
/** Axis-pad drops are worth this much more (taking one also keeps it from the other team). */
const AXIS_RACE = 1.6;
/** Anticipation slack (m) on the reaction-delayed "in reach" check of an opponent. */
const NOTICE_SLACK = 0.1;
const ANTICIPATE_HOLD = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.C6_ANT_HOLD ?? 1);
const ANTICIPATE_FREE = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.C6_ANT_FREE ?? 0);
/** Hammer swing worth on anchored loot (uproot progress per hit, content-plan §5.2). */
function hammerProgress(l: Readonly<LootState>): number {
  if (l.variant === 'atm') return ITEMS.hammer.progress.largeSafe;
  if (l.variant === 'moneyTree') return 0.4;
  if (l.variant === 'goldSafe') return ITEMS.hammer.progress.largeSafe;
  if (l.variant === 'piggy') return 0;
  return ITEMS.hammer.progress[l.kind];
}

export class ItemGoals implements GoalProvider {
  readonly kinds = ['fetchItem', 'bonk', 'useItem'] as const;
  /** Tick the last swing was pressed (keeps the hands off while the sim runs it). */
  private swungAt = -100;
  /** Tick I let go of my load to swing at someone in reach (the swing follows next tick). */
  private releasedAt = -100;
  /** The item in my pocket has been used since it was picked up. */
  private usedSincePickup = false;

  onEvents(view: BotView, events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'itemPickup' && e.charId === view.id) this.usedSincePickup = false;
      else if (e.type === 'itemUse' && e.charId === view.id && e.phase === 'fire') this.usedSincePickup = true;
    }
  }

  propose(view: BotView, out: Candidate[]): void {
    const sim = view.sim;
    if (sim.rules.content !== 'v2') return;
    const st = sim.state;
    const me = view.me();
    const left = view.secondsLeft();
    const skill = contentSkill(view.P).item;
    const wHammer = view.W.hammer ?? 1;
    // ---- fetch ---- (never by letting go of a load: walking over a pad picks it up anyway)
    if (!me.item && !me.grab && st.items.length) {
      const opps = view.opponents().filter((o) => o.last && o.age < 120 && !o.last.knockedDown && !o.last.item);
      for (const it of st.items) {
        const key = `fetch:${it.id}`;
        if (view.blacklisted(key) || view.claimedByOther(key, it.id)) continue;
        if (V.dist(it.pos, me.pos) > 40) continue;
        const walk = view.walkDist(it.pos);
        if (!Number.isFinite(walk)) continue;
        const tWalk = walk / WALK;
        const landIn = it.phase === 'incoming' ? Math.max(0, (it.landTick - st.tick) / TICK_RATE) : 0;
        if (landIn > 6) continue; // (announced 3 s ahead; a slow walker may leave early)
        if (it.phase === 'ground' && (it.expiresTick - st.tick) / TICK_RATE < tWalk + 0.5) continue;
        const t = Math.max(tWalk, landIn) + 0.4;
        const worth = itemWorth(it.kind, left - t);
        if (worth <= 0) continue;
        let w = wHammer * (0.45 + 0.55 * skill);
        // an opponent clearly closer (and empty-pocketed) gets it first — the golden one and the
        // axis pad's drops are always worth the race
        const pad = it.padId !== null ? sim.layout.v2?.itemPads.find((p) => p.id === it.padId) : undefined;
        const axis = pad !== undefined && pad.twin === null;
        if (it.kind !== 'goldHammer' && !axis) {
          for (const o of opps) {
            const od = V.dist(o.last!.pos, it.pos) * 1.1 + (o.age / TICK_RATE) * 2.5;
            if (od + 2.5 < walk) {
              w *= 0.55;
              break;
            }
          }
        }
        // (the axis pad is the one drop both teams race for: whoever gets it also denies it)
        if (axis) w *= AXIS_RACE;
        out.push(view.mk('fetchItem', key, it.id, (worth / t) * w, worth, t, { pos: { ...it.pos } }));
      }
    }
    // (no pre-positioning on the axis pad from the drop schedule: players only learn of a drop when
    // it is announced, `ITEMS.drop.warnTicks` / `goldHammer.announceTicks` = 3 s ahead — from then
    // the incoming crate is in `st.items` and the fetch above races for it like a person would)
    const held = holdsHammer(me);
    if (!held || me.grab) return;
    const lifeLeft = held.expiresTick >= 0x7fffffff ? 999 : (held.expiresTick - st.tick) / TICK_RATE;
    // ---- bonk an opposing carrier ----
    for (const o of view.opponents()) {
      if (!o.last || !o.visible || o.last.knockedDown) continue;
      const bag = o.last.bag ?? 0;
      const held2 = o.last.holdingId !== null ? sim.getLoot(o.last.holdingId) : undefined;
      if (!held2 && bag < 40) continue;
      const d = V.dist(o.last.pos, me.pos);
      if (d > 14) continue;
      const key = `bonk:${o.id}`;
      if (view.blacklisted(key) || view.claimedByOther(key)) continue;
      // what a knockdown is worth: they drop what they hold (a bank haul breaks, a safe is ours to
      // take) and spill half the bag
      let value = Math.floor(bag / 2 / 10) * 10;
      if (held2 && !held2.recovered) value += held2.kind === 'bank' ? Math.min(400, held2.estimatedValue * 0.25) : view.lootValue(held2) * 0.6;
      if (value < 30) continue;
      const vAway = Math.max(0, V.dot(o.last.vel, V.norm(V.sub(o.last.pos, me.pos))));
      const tReach = Math.max(0, d - 2) / Math.max(1.5, WALK - vAway) + 0.4;
      if (tReach + 1 > left) continue;
      const pHit = 0.45 + 0.35 * skill;
      out.push(view.mk('bonk', key, o.id, ((value * pHit) / (tReach + 0.9)) * wHammer * (0.6 + 0.4 * skill), Math.round(value), tReach + 0.9, { pos: { ...o.last.pos } }));
    }
    // ---- use it on something (before it expires) ----
    let best: { u: number; l?: LootState; brId?: string; pos: Vec2; value: number; t: number } | null = null;
    // (an unused hammer wants a first swing: more so as its lifetime runs out)
    const urgency = (1 + 2.5 * Math.max(0, 1 - lifeLeft / 12)) * (this.usedSincePickup ? 1 : 1.8);
    for (const l of st.loot) {
      if (l.recovered || l.dormant || l.airborne || !l.anchored) continue;
      const prog = hammerProgress(l);
      if (prog <= 0) continue;
      if (view.oppHolding(l.id).length > 0) continue;
      const d = V.dist(l.pos, me.pos);
      if (d > 22) continue;
      const walk = view.walkDist(lootSurfacePoint(l, me.pos));
      if (!Number.isFinite(walk)) continue;
      // time saved on the uproot (+ the ATM's 3 coins), worth more on what we want anyway
      const uproot = l.variant ? (l.variant === 'atm' ? 3 : 2.5) : l.kind === 'bank' ? 3 : l.kind === 'largeSafe' ? 2 : 1;
      let value = Math.min(prog, 1 - l.unanchorProgress) * uproot * 25 + (l.variant === 'atm' ? 30 : l.variant === 'moneyTree' ? 50 : 0);
      if (l.kind === 'bank') value *= 1 + 0.4 * ((view.W.bank ?? 1) - 0.6);
      const t = walk / WALK + 0.7;
      const u = (value / t) * urgency;
      if (!best || u > best.u) best = { u, l, pos: l.pos, value, t };
    }
    // the 돼지저금통 the other team handled last: two cracks a swing — bust it open (잭팟, the coins
    // burst out around me) rather than let them roll it home
    for (const l of st.loot) {
      if (l.variant !== 'piggy' || !inPlayLoot(l) || (l.innerValue ?? 0) <= 0) continue;
      if (l.grabbedBy.some((id) => st.characters[id - 1]?.team === view.team)) continue;
      const lastOpp = l.lastHolder !== null && st.characters[l.lastHolder - 1]?.team !== view.team;
      if (!lastOpp) continue;
      if (V.dist(l.pos, me.pos) > 18) continue;
      const walk = view.walkDist(lootSurfacePoint(l, me.pos));
      if (!Number.isFinite(walk)) continue;
      const value = (l.innerValue ?? 0) * ((l.cracks ?? 0) >= 1 ? 0.55 : 0.3);
      const t = walk / WALK + 0.7;
      const u = (value / t) * urgency;
      if (!best || u > best.u) best = { u, l, pos: l.pos, value, t };
    }
    for (const br of st.breakables) {
      if (br.broken || br.innerValue <= 0) continue;
      const d = V.dist(br.center, me.pos);
      if (d > 22) continue;
      const walk = view.walkDist(boxSurfacePoint(br, me.pos));
      if (!Number.isFinite(walk)) continue;
      const t = walk / WALK + 0.7 + 1.0;
      const u = (br.innerValue / t) * urgency * (view.W.smash ?? 1);
      if (!best || u > best.u) best = { u, brId: br.id, pos: br.center, value: br.innerValue, t };
    }
    if (best) {
      const key = best.l ? `use:${best.l.id}` : `use:${best.brId}`;
      if (!view.blacklisted(key) && !view.claimedByOther(key)) {
        out.push(view.mk('useItem', key, best.l ? best.l.id : null, best.u * wHammer * (0.6 + 0.4 * skill), Math.round(best.value), best.t, { pos: { ...best.pos }, breakableId: best.brId }));
      }
    }
  }

  execute(view: BotView, g: Goal): Command | null {
    if (g.kind === 'fetchItem') return this.execFetch(view, g);
    if (g.kind === 'bonk') return this.execBonk(view, g);
    return this.execUse(view, g);
  }

  private execFetch(view: BotView, g: Goal): Command {
    const st = view.sim.state;
    const me = view.me();
    const it = st.items.find((x) => x.id === g.targetId);
    if (me.item) {
      view.endGoal(it ? 'pocket full' : 'got it');
      return still();
    }
    if (!it) {
      view.endGoal('gone');
      return still();
    }
    if (me.grab) return still(false);
    const d = V.dist(me.pos, it.pos);
    if (it.phase === 'incoming' && d < 1.2) {
      // under the balloon: wait on the pad (stand right on it)
      g.phase = 'wait';
      return d > 0.25 ? move(V.scale(V.norm(V.sub(it.pos, me.pos)), Math.min(1, d))) : still();
    }
    g.phase = 'travel';
    if (d < 3 && view.nav.segmentClear(me.pos, it.pos, 'walk', -0.05)) return move(V.norm(V.sub(it.pos, me.pos)));
    const m = view.moveTo(it.pos, 'walk', 0.2);
    if (m.stuck) view.endGoal('stuck', 5 * TICK_RATE);
    return move(m.move);
  }

  private execBonk(view: BotView, g: Goal): Command {
    const st = view.sim.state;
    const me = view.me();
    if (!holdsHammer(me) || me.grab) {
      view.endGoal('no hammer');
      return still(false);
    }
    const o = view.opponents().find((v) => v.id === g.targetId);
    const age = o?.last ? o.age : Infinity;
    if (!o || !o.last || age > 60 || st.tick - g.started > 12 * TICK_RATE) {
      view.endGoal('lost target', 2 * TICK_RATE);
      return still();
    }
    if (o.last.knockedDown || (o.last.holdingId === null && (o.last.bag ?? 0) < 30)) {
      view.endGoal('target down / empty');
      return still();
    }
    g.phase = 'chase';
    if (swingBusy(me)) return still();
    const tgt = V.add(o.last.pos, V.scale(o.last.vel, Math.min(0.6, V.dist(me.pos, o.last.pos) / 8) * view.P.leadQuality));
    const d = V.dist(me.pos, tgt);
    // close: keep at swing distance and face it (the overlay swings)
    if (d < 1.7) return { ...still(), aim: V.sub(o.last.pos, me.pos) };
    if (d < 6 && view.nav.segmentClear(me.pos, tgt, 'walk', 0)) return { ...move(V.norm(V.sub(tgt, me.pos))), aim: null };
    const m = view.moveTo(tgt, 'walk', 0.8);
    return move(m.move);
  }

  private execUse(view: BotView, g: Goal): Command {
    const st = view.sim.state;
    const me = view.me();
    const held = holdsHammer(me);
    if (!held) {
      view.endGoal('no hammer');
      return still(false);
    }
    if (me.grab) return still(false);
    if (swingBusy(me)) return still();
    if (this.swungAt >= g.started && st.tick - this.swungAt > 20) {
      view.endGoal('swung');
      return still();
    }
    let target: Vec2 | null = null;
    if (g.breakableId) {
      const br = st.breakables.find((b) => b.id === g.breakableId);
      if (!br || br.broken) {
        view.endGoal('broken');
        return still();
      }
      target = boxSurfacePoint(br, me.pos);
    } else if (g.targetId !== null) {
      const l = view.sim.getLoot(g.targetId);
      if (!l || !inPlayLoot(l) || (!l.anchored && l.variant !== 'piggy')) {
        view.endGoal('loose / gone');
        return still();
      }
      target = lootSurfacePoint(l, me.pos);
    }
    if (!target) {
      view.endGoal('no target');
      return still();
    }
    g.phase = 'approach';
    const d = V.dist(me.pos, target);
    if (d < 1.1) return { ...still(), aim: V.sub(target, me.pos) };
    if (d < 4 && view.nav.segmentClear(me.pos, target, 'walk', -0.3)) return move(V.norm(V.sub(target, me.pos)));
    const m = view.moveTo(target, 'walk', 1.0);
    if (m.stuck) view.endGoal('stuck', 5 * TICK_RATE);
    return move(m.move);
  }

  /** The swing layer: take a good swing that is in reach right now (see header). */
  overlay(view: BotView, _c: Command): Command | null {
    const sim = view.sim;
    if (sim.rules.content !== 'v2') return null;
    const st = sim.state;
    const me = view.me();
    if (!me.item) return null;
    // a swing under way: hands off (a grab cancels the wind-up), no steering (the sim locks it)
    if (swingBusy(me) || st.tick - this.swungAt < 3) return { move: { x: 0, y: 0 }, grab: false, dash: false, aim: null, ping: null };
    // hauling / carrying with a ready hammer: an opponent stepping into reach gets bonked (let go,
    // swing next tick, take hold again) — a hauler with a hammer is no easy strip
    if (me.grab) {
      const h = me.item;
      if (!isHammer(h.kind) || h.phase !== 'idle' || h.cooldown > 0 || h.uses <= 0 || me.knockdownTicks > 0) return null;
      const l = sim.getLoot(me.grab.targetId);
      if (!l || (l.recovery && l.recovery.team === view.team)) return null;
      if (st.tick - this.releasedAt < 90) return null; // (once in a while, never a release / regrab jitter)
      const foe = this.foeInReach(view, h.kind);
      if (!foe || !view.rngCheck(contentSkill(view.P).item, 3)) return null;
      this.releasedAt = st.tick;
      view.log(`lets go of ${l.id} to swing at opponent ${foe}`);
      return { move: { x: 0, y: 0 }, grab: false, dash: false, aim: null, ping: null };
    }
    const it = usableHammer(me);
    if (!it) return null;
    // a person takes most good chances, not all (itemSkill); a quick throttle like other reflexes
    const skill = contentSkill(view.P).item;
    const g = view.goal();
    const pick = this.pickTarget(view, it.kind, g);
    if (!pick) return null;
    // (right after letting go of a load for it, the swing is taken: no second roll)
    if (st.tick - this.releasedAt >= 12 && !view.rngCheck(Math.min(1, 0.35 + 0.65 * skill), 3)) return null;
    const aim = aimWithError(view, V.sub(pick.p, me.pos));
    const arc = arcSummary(view, aim, it.kind);
    if (arc.ourBank || (arc.piggy && !pick.piggyOk)) return null;
    this.swungAt = st.tick;
    view.log(`swings ${it.kind} at ${pick.what}`);
    return swingCommand(view, aim, pick.charId);
  }

  /**
   * A visible opponent (not down / protected) a swing pressed now would reach. The decision is made
   * on the reaction-delayed view (the bot noticed them in reach `reactionDelay` ticks ago, like
   * `dashAt`); the reach / aim check then uses the current sighting of that same opponent.
   */
  private foeInReach(view: BotView, kind: string): EntityId | null {
    for (const o of view.opponents()) {
      if (!o.visible || !o.last || o.last.knockedDown || o.last.protectedNow) continue;
      if (!noticedInReach(view, o.last.pos, o.last.vel, kind as 'hammer', ANTICIPATE_HOLD)) continue;
      const now = currentSighting(view, o.id);
      if (!now) continue;
      if (reachesBody(view, leadPoint(now.pos, now.vel, view.P.leadQuality), CHARACTER.radius, kind as 'hammer')) return o.id;
    }
    return null;
  }

  private pickTarget(view: BotView, kind: 'hammer' | 'goldHammer' | string, g: Goal | null): { p: Vec2; what: string; charId: EntityId | null; piggyOk?: boolean } | null {
    const sim = view.sim;
    const st = sim.state;
    const me = view.me();
    const k = kind as 'hammer' | 'goldHammer';
    const ps = view.ps();
    // 1. an officer about to tackle me (bag / load) or a carrying teammate
    if (ps.onField()) {
      const mine = (me.bag ?? 0) >= COINS.policeBagMin || me.grab !== null;
      for (const cop of ps.cops) {
        if (cop.phase === 'stunned' || cop.phase === 'arriving' || ps.stunImmune(cop.id)) continue;
        // (the officer runs at me — loaded, bagged, or the load I just let go of to stun it)
        const onMe = V.dist(cop.pos, me.pos) < 3.2 && (cop.target === view.id || (mine && cop.target === null));
        let onMate = false;
        if (!onMe) for (const m of view.mates()) if ((m.grab || (m.bag ?? 0) >= 60) && cop.target === m.id && V.dist(cop.pos, m.pos) < 3.4) onMate = true;
        if (!onMe && !onMate) continue;
        const p = leadPoint(cop.pos, cop.vel, 0.5 + 0.5 * view.P.leadQuality);
        if (reachesBody(view, p, OFFICER_R, k)) return { p, what: `officer ${cop.id}`, charId: null };
      }
    }
    // 2. an opposing carrier / fat bag / the opponent in my bonk goal — decided on the
    // reaction-delayed view (what / who / that they are in reach), aimed at the current sighting
    for (const o of view.opponents()) {
      if (!o.visible || !o.last || o.last.knockedDown || o.last.protectedNow) continue;
      const bag = o.last.bag ?? 0;
      const target = (g !== null && g.kind === 'bonk' && g.targetId === o.id) || st.tick - this.releasedAt < 12;
      const carrying = o.last.holdingId !== null;
      // (an opponent swinging a hammer at me too: get mine in first)
      const armed = o.last.item === 'hammer' || o.last.item === 'goldHammer';
      if (!target && !carrying && bag < 30 && !armed) continue;
      if (!noticedInReach(view, o.last.pos, o.last.vel, k, ANTICIPATE_FREE)) continue;
      const now = currentSighting(view, o.id);
      if (!now) continue;
      const p = leadPoint(now.pos, now.vel, view.P.leadQuality);
      if (!reachesBody(view, p, CHARACTER.radius, k)) continue;
      const held = carrying ? sim.getLoot(o.last.holdingId!) : undefined;
      return { p, what: `opponent ${o.id}${held ? ` (holding ${held.id})` : ''}`, charId: o.id, piggyOk: held?.variant === 'piggy' };
    }
    // 3. the anchored loot my goal is about to grab (a small safe pops right out)
    if (g && g.kind === 'useItem' && g.targetId !== null) {
      const l = sim.getLoot(g.targetId);
      if (l && l.variant === 'piggy' && inPlayLoot(l)) {
        const q = lootSurfacePoint(l, me.pos);
        if (reachesPoint(view, q, k, 0.2)) return { p: q, what: `piggy ${l.id}`, charId: null, piggyOk: true };
      }
    }
    if (g && g.targetId !== null && (g.kind === 'collectSafe' || g.kind === 'stripBank' || g.kind === 'haulBank' || g.kind === 'assistHaul' || g.kind === 'useItem')) {
      const l = sim.getLoot(g.targetId);
      if (l && !l.recovered && !l.dormant && !l.airborne && l.anchored && hammerProgress(l) > 0 && !me.grab) {
        const q = lootSurfacePoint(l, me.pos);
        if (reachesPoint(view, q, k, 0.2)) return { p: q, what: `loot ${l.id}`, charId: null };
      }
    }
    // 4. a breakable in reach (coins!) when not in the middle of something that matters more
    const busy = g !== null && (g.kind === 'intercept' || g.kind === 'defendDoor' || g.kind === 'escort' || g.kind === 'bonk');
    if (!busy || (g && g.kind === 'useItem')) {
      for (const br of st.breakables) {
        if (br.broken || br.innerValue <= 0) continue;
        if (V.dist(br.center, me.pos) > 3.5) continue;
        if (g && g.kind === 'useItem' && g.breakableId && g.breakableId !== br.id) continue;
        const q = boxSurfacePoint(br, me.pos);
        if (reachesPoint(view, q, k, 0.2)) return { p: q, what: `breakable ${br.id}`, charId: null };
      }
    }
    return null;
  }
}

/**
 * The opponent, as the bot saw it `reactionDelay` ticks ago, was (about) in hammer reach: a person
 * notices "they're in range" with their reaction time, then swings at where they are now. Distance
 * only (the current sighting checks line of sight); a small anticipation slack.
 */
function noticedInReach(view: BotView, pos: Vec2, vel: Vec2, kind: 'hammer' | 'goldHammer', anticipate = 0): boolean {
  // (anticipate: carry the delayed sighting forward along its motion, scaled by lead quality —
  // someone charging straight in is seen coming; a juke inside the reaction time still fools it)
  const ahead = (anticipate * view.P.reactionDelay * view.P.leadQuality) / TICK_RATE;
  const p = leadPoint(V.add(pos, V.scale(vel, ahead)), vel, view.P.leadQuality);
  return V.dist(view.me().pos, p) - CHARACTER.radius <= hammerGeom(kind).reach + LUNGE_BONUS + NOTICE_SLACK;
}

/** The current sighting of an opponent (aim only), null when out of sight / down / protected now. */
function currentSighting(view: BotView, id: EntityId): { pos: Vec2; vel: Vec2 } | null {
  const o = view.opponents(0).find((v) => v.id === id);
  if (!o || !o.visible || !o.last || o.last.knockedDown || o.last.protectedNow) return null;
  return o.last;
}

function inPlayLoot(l: Readonly<LootState>): boolean {
  return !l.recovered && !l.dormant && !l.airborne;
}

function still(grab = false): Command {
  return { move: { x: 0, y: 0 }, grab, dash: false, aim: null, ping: null };
}

function move(m: Vec2): Command {
  return { move: V.clampLen(m, 1), grab: false, dash: false, aim: null, ping: null };
}
