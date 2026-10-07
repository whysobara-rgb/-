/**
 * (Content 2.0, C6) Prop and breakable goals (content-plan §3.1, §5.1, §6 C6):
 *
 * - smash: dash (or swing the 뿅망치) at a 나무 상자 / 자판기 for its coin pops, or bonk the 동전 ATM
 *   (a dash into it at >= 4 m/s pops 2 동전, 0.5 s cooldown per ATM) — chosen by value per second
 *   like everything else; the scoop goal picks the coins up right after.
 * - kickPiggy: the 대왕 돼지저금통 is a kickable ball. When it is contested (an opponent near it), get
 *   behind it relative to the way home and dash it ~6 m that way; then carry it (collect goal).
 *   When the other team touched it last and it already has 2 cracks, a dash cracks it open
 *   (잭팟: every coin bursts out, mostly toward the kicker's side) — the smash when contested.
 *
 * Uprooting / hauling the props themselves (ATM tug-spurt, 돈나무 careful carry, carrying the piggy)
 * are the bot's regular collect goals (bot.ts), valued at shell + coins inside.
 */
import { CHARACTER, COINS, DASH, PROP_RULES, TICK_RATE } from '../../sim/config';
import type { BreakableState, Command, LootState, Vec2 } from '../../sim/types';
import { V } from '../geom';
import { boxSurfacePoint, hammerGeom, holdsHammer, lootSurfacePoint, reachesPoint, swingBusy, swingCommand, usableHammer, aimWithError } from '../itemSense';
import type { BotView, Candidate, Goal, GoalProvider } from './types';

const WALK = 5;
/** Dash burst length (m): DASH.speed x duration. */
const DASH_LEN = DASH.speed * (DASH.durationTicks / TICK_RATE);
/** Where to stand before a dash at a box: this far from its surface (well inside the burst). */
const DASH_STAND = 1.35;
/** Seconds to scoop the coins a hit pops (they land around the box). */
const SCOOP_S = 1.2;

export class PropGoals implements GoalProvider {
  readonly kinds = ['smash', 'kickPiggy'] as const;

  propose(view: BotView, out: Candidate[]): void {
    const sim = view.sim;
    if (sim.rules.content !== 'v2') return;
    const st = sim.state;
    const me = view.me();
    if (me.grab) return;
    const left = view.planLeft();
    if (left < 6) return;
    const W = view.W;
    const wSmash = W.smash ?? 1;
    const hammer = holdsHammer(me);
    const bagRoom = COINS.bagCap - (me.bag ?? 0);
    const dashWait = me.dashCooldown / TICK_RATE;
    // ---- breakables ----
    for (const br of st.breakables) {
      if (br.broken || br.innerValue <= 0) continue;
      const key = `smash:${br.id}`;
      if (view.blacklisted(key) || view.claimedByOther(key)) continue;
      if (V.dist(br.center, me.pos) > 30) continue;
      const stand = this.boxStand(view, br, !!hammer);
      if (!stand) continue;
      const walk = view.walkDist(stand);
      if (!Number.isFinite(walk)) continue;
      const tWalk = walk / WALK;
      // one hit per goal (re-decided after it): a hammer breaks anything at once (3 damage), a
      // dash takes 1 HP (a hit that does not break pops one 동전 per HP lost)
      const value = hammer ? br.innerValue : br.hp <= 1 ? br.innerValue : COINS.coin;
      const wait = hammer ? 0 : Math.max(0, dashWait - tWalk);
      const t = tWalk + wait + 0.8 + SCOOP_S;
      let w = wSmash;
      if (Math.min(value, bagRoom) <= 0) w *= 0.3; // full bag: the coins stay for later / others
      out.push(view.mk('smash', key, null, (value / t) * w, value, t, { breakableId: br.id, pos: { ...br.center } }));
    }
    // ---- ATM bonk (a dash; with a hammer the regular hammer use covers it) ----
    if (!hammer) {
      for (const l of st.loot) {
        if (l.variant !== 'atm' || l.recovered || l.dormant || l.airborne) continue;
        if ((l.innerValue ?? 0) < PROP_RULES.atm.bonkCoins * COINS.coin || heldBySeen(view, l) && !l.anchored) continue;
        const key = `bonk:${l.id}`;
        if (view.blacklisted(key) || view.claimedByOther(key) || view.claimedByOther(`collect:${l.id}`)) continue;
        if (V.dist(l.pos, me.pos) > 18) continue;
        const stand = this.lootStand(view, l);
        if (!stand) continue;
        const walk = view.walkDist(stand);
        if (!Number.isFinite(walk)) continue;
        const tWalk = walk / WALK;
        const value = PROP_RULES.atm.bonkCoins * COINS.coin;
        const t = tWalk + Math.max(0, dashWait - tWalk) + 0.6 + SCOOP_S;
        // an opponent tugging it: its spurts land next to them anyway — take some of the coins out
        const contested = view.oppHolding(l.id).length > 0 ? 1.4 : 1;
        out.push(view.mk('smash', key, l.id, (value / t) * wSmash * 0.75 * contested, value, t, { sub: 'atm', pos: { ...l.pos } }));
      }
    }
    // ---- piggy kick / smash ----
    if (hammer) return; // (a hammer would crack our own ball: carry it instead)
    for (const l of st.loot) {
      if (l.variant !== 'piggy' || l.recovered || l.dormant || l.airborne) continue;
      if (heldBySeen(view, l)) continue;
      const d = V.dist(l.pos, me.pos);
      if (d > 14) continue;
      const key = `kick:${l.id}`;
      if (view.blacklisted(key) || view.claimedByOther(key)) continue;
      const opps = view.opponents().filter((o) => o.last && o.age < 90 && !o.last.knockedDown);
      let oppD = Infinity;
      for (const o of opps) oppD = Math.min(oppD, V.dist(o.last!.pos, l.pos));
      const lastOpp = l.lastHolder !== null && view.sim.state.characters[l.lastHolder - 1]?.team !== view.team;
      const value = view.lootValue(l);
      let sub: 'kick' | 'smash' | null = null;
      let u = 0;
      const diff = st.scores[view.team] - st.scores[(1 - view.team) as 0 | 1];
      const cracks = l.cracks ?? 0;
      // (contested and one crack from open, or trailing with it already cracked: bust it open)
      if (lastOpp && oppD < 8 && (cracks >= PROP_RULES.piggy.cracksToSmash - 1 || (diff < 0 && cracks >= 1))) {
        // 잭팟 when contested: crack it open where we stand closest
        sub = 'smash';
        u = (value * 0.5) / (d / WALK + Math.max(0, dashWait - d / WALK) + 1.2);
      } else if (oppD < 9 && oppD < d + 4) {
        // the kickoff scramble: kick it toward home before they get a hand on it
        sub = 'kick';
        u = (value * 0.3) / (d / WALK + Math.max(0, dashWait - d / WALK) + 1.0);
      }
      if (!sub) continue;
      const kdir = this.kickDir(view, l);
      if (!kdir) continue;
      out.push(view.mk('kickPiggy', key, l.id, u * (W.props ?? 1), Math.round(value * 0.3), d / WALK + 1, { sub }));
    }
  }

  /**
   * Dash at the world on the way: walking somewhere with the dash ready and nobody to save it
   * for, a crate / vending machine / ATM right ahead within the burst gets bonked in passing
   * (coins pop; the scoop detour or a scoop goal picks them up).
   */
  overlay(view: BotView, c: Command): Command | null {
    const sim = view.sim;
    if (sim.rules.content !== 'v2' || c.dash || c.grab) return null;
    const me = view.me();
    if (me.grab || me.item || me.dashCooldown > 0 || me.knockdownTicks > 0) return null;
    const g = view.goal();
    if (!g || (g.phase !== 'travel' && g.phase !== 'approach' && g.phase !== 'scoop')) return null;
    if (g.kind === 'smash' || g.kind === 'kickPiggy' || g.kind === 'intercept' || g.kind === 'escort' || g.kind === 'defendDoor' || g.kind === 'bonk') return null;
    const ml = V.len(c.move);
    if (ml < 0.6) return null;
    const dir = V.scale(c.move, 1 / ml);
    // keep the dash for a fight / an officer when one is close
    const ps = view.ps();
    if (ps.onField()) {
      const n = ps.nearest(me.pos);
      if (n && n.d < 9) return null;
    }
    if (view.threatNear(me.pos, 7)) return null;
    const st = sim.state;
    const reach = DASH_LEN * 0.8;
    let aim: Vec2 | null = null;
    for (const br of st.breakables) {
      if (br.broken || br.innerValue <= 0) continue;
      if (V.dist(br.center, me.pos) > 4) continue;
      const q = boxSurfacePoint(br, me.pos);
      const rel = V.sub(q, me.pos);
      const d = V.len(rel);
      if (d < CHARACTER.radius + 0.1 || d - CHARACTER.radius > reach) continue;
      if (V.dot(rel, dir) / d < 0.8 || !sim.lineOfSight(me.pos, q)) continue;
      aim = V.scale(rel, 1 / d);
      break;
    }
    if (!aim) {
      for (const l of st.loot) {
        if (l.variant !== 'atm' || !l.anchored || l.recovered || l.bonkCooldown || (l.innerValue ?? 0) < PROP_RULES.atm.bonkCoins * COINS.coin) continue;
        if (V.dist(l.pos, me.pos) > 4) continue;
        const q = lootSurfacePoint(l, me.pos);
        const rel = V.sub(q, me.pos);
        const d = V.len(rel);
        // (a bonk needs speed at contact: not from touching distance)
        if (d < 1.0 || d - CHARACTER.radius > reach) continue;
        if (V.dot(rel, dir) / d < 0.85 || !sim.lineOfSight(me.pos, q)) continue;
        if (l.grabbedBy.some((id) => st.characters[id - 1]?.team === view.team)) continue;
        aim = V.norm(V.sub(l.pos, me.pos));
        break;
      }
    }
    if (!aim) return null;
    if (!view.rngCheck(Math.min(1, 0.55 * (view.W.smash ?? 1)), 3)) return null;
    view.log('bonks the world in passing');
    return { move: aim, grab: false, dash: true, aim, ping: null };
  }

  execute(view: BotView, g: Goal): Command | null {
    if (g.kind === 'kickPiggy') return this.execKick(view, g);
    return g.sub === 'atm' ? this.execAtm(view, g) : this.execSmash(view, g);
  }

  // -------------------------------------------------------------------------

  /** Stand point in front of a breakable: dash distance (or hammer distance) from its nearest face. */
  private boxStand(view: BotView, br: BreakableState, hammer: boolean): Vec2 | null {
    const me = view.me();
    const q = boxSurfacePoint(br, me.pos);
    let n = V.sub(me.pos, q);
    if (V.len(n) < 1e-3) n = V.sub(me.pos, br.center);
    n = V.norm(n);
    const off = hammer ? 1.2 : DASH_STAND;
    for (const rot of [0, 0.6, -0.6, 1.2, -1.2, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const nn = V.rot(n, rot);
      const qq = boxSurfacePoint(br, V.add(br.center, V.scale(nn, 5)));
      const p = V.add(qq, V.scale(nn, off));
      if (view.nav.clearanceAt(p.x, p.y) < 0.5) continue;
      if (!view.sim.lineOfSight(p, V.add(qq, V.scale(nn, 0.05)))) continue;
      return p;
    }
    return null;
  }

  private lootStand(view: BotView, l: LootState): Vec2 | null {
    const me = view.me();
    let n = V.norm(V.sub(me.pos, l.pos));
    if (V.len(n) < 1e-3) n = { x: 1, y: 0 };
    for (const rot of [0, 0.7, -0.7, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const nn = V.rot(n, rot);
      const q = lootSurfacePoint(l, V.add(l.pos, V.scale(nn, 5)));
      const p = V.add(q, V.scale(nn, 1.6));
      if (view.nav.clearanceAt(p.x, p.y) < 0.5) continue;
      if (!view.sim.lineOfSight(p, V.add(q, V.scale(nn, 0.05)))) continue;
      return p;
    }
    return null;
  }

  private execSmash(view: BotView, g: Goal): Command {
    const st = view.sim.state;
    const me = view.me();
    const br = st.breakables.find((b) => b.id === g.breakableId);
    if (!br || br.broken) {
      view.endGoal('smashed');
      return still();
    }
    if (me.grab) return still();
    if (swingBusy(me)) return still();
    // the action was taken: wait for its effect, then re-decide (coins to scoop)
    if (g.pressedTick !== undefined && g.pressedTick >= 0) {
      if (br.hp < (g.ref ?? br.hp + 1) || st.tick - g.pressedTick > 30) {
        const hit = br.hp < (g.ref ?? br.hp + 1);
        g.tries = (g.tries ?? 0) + (hit ? 0 : 1);
        if (hit || (g.tries ?? 0) >= 2) {
          view.endGoal(hit ? 'hit' : 'missed', hit ? 0 : 6 * TICK_RATE);
          return still();
        }
        g.pressedTick = -1;
      } else return still();
    }
    const hammer = usableHammer(me);
    const held = holdsHammer(me);
    const q = boxSurfacePoint(br, me.pos);
    const dq = V.dist(me.pos, q);
    if (held) {
      g.phase = 'approach';
      if (hammer && reachesPoint(view, q, hammer.kind, 0.25)) {
        g.phase = 'itemWindup';
        g.pressedTick = st.tick;
        g.ref = br.hp;
        return swingCommand(view, aimWithError(view, V.sub(q, me.pos)), null);
      }
      if (dq < hammerGeom(held.kind).reach && view.nav.segmentClear(me.pos, q, 'walk', -0.3)) return { ...still(), aim: V.sub(q, me.pos) };
      const stand = g.stand ?? (g.stand = this.boxStand(view, br, true) ?? undefined);
      if (!stand) {
        view.endGoal('no stand', 6 * TICK_RATE);
        return still();
      }
      const m = view.moveTo(stand, 'walk', 0.4);
      if (m.stuck) view.endGoal('stuck', 6 * TICK_RATE);
      return move(m.move);
    }
    // dash: from the stand point, aimed at the nearest surface point
    if (!g.stand || st.tick % 30 === 0) g.stand = this.boxStand(view, br, false) ?? g.stand;
    if (!g.stand) {
      view.endGoal('no stand', 6 * TICK_RATE);
      return still();
    }
    const dStand = V.dist(me.pos, g.stand);
    const reachable = dq - CHARACTER.radius - COINS.dashHitGap < DASH_LEN * 0.8 && dq > 0.4;
    if ((dStand < 0.45 || (reachable && dStand < 1.2)) && view.sim.lineOfSight(me.pos, q)) {
      g.phase = 'aim';
      const aim = V.norm(V.sub(q, me.pos));
      if (me.dashCooldown === 0) {
        g.pressedTick = st.tick;
        g.ref = br.hp;
        return { move: aim, grab: false, dash: true, aim, ping: null };
      }
      return { ...still(), aim };
    }
    g.phase = 'approach';
    const m = view.moveTo(g.stand, 'walk', 0.35, { slow: 0.9 });
    if (m.stuck) view.endGoal('stuck', 6 * TICK_RATE);
    return move(m.move);
  }

  private execAtm(view: BotView, g: Goal): Command {
    const st = view.sim.state;
    const me = view.me();
    const l = g.targetId !== null ? view.sim.getLoot(g.targetId) : undefined;
    if (!l || l.recovered || l.airborne || (l.innerValue ?? 0) < PROP_RULES.atm.bonkCoins * COINS.coin) {
      view.endGoal('atm gone');
      return still();
    }
    if (me.grab || holdsHammer(me)) {
      view.endGoal('hands busy');
      return still();
    }
    if (g.pressedTick !== undefined && g.pressedTick >= 0) {
      const hit = (l.innerValue ?? 0) < (g.ref ?? 0);
      if (hit || st.tick - g.pressedTick > 30) {
        view.endGoal(hit ? 'bonked' : 'missed', hit ? 2 * TICK_RATE : 6 * TICK_RATE);
      }
      return still();
    }
    if (!g.stand || st.tick % 30 === 0) g.stand = this.lootStand(view, l) ?? g.stand;
    if (!g.stand) {
      view.endGoal('no stand', 6 * TICK_RATE);
      return still();
    }
    const q = lootSurfacePoint(l, me.pos);
    const dq = V.dist(me.pos, q);
    const dStand = V.dist(me.pos, g.stand);
    // a bonk needs speed at contact: dash from a little way off (not from touching distance)
    if ((dStand < 0.45 || (dq > 1.0 && dq < 2.2)) && view.sim.lineOfSight(me.pos, q) && !l.bonkCooldown) {
      g.phase = 'aim';
      const aim = V.norm(V.sub(l.pos, me.pos));
      if (me.dashCooldown === 0) {
        g.pressedTick = st.tick;
        g.ref = l.innerValue ?? 0;
        return { move: aim, grab: false, dash: true, aim, ping: null };
      }
      return { ...still(), aim };
    }
    g.phase = 'approach';
    const m = view.moveTo(g.stand, 'walk', 0.35, { slow: 0.9 });
    if (m.stuck) view.endGoal('stuck', 6 * TICK_RATE);
    return move(m.move);
  }

  /**
   * Direction to kick the piggy: down the team's large-class carry field (cheap: 12 samples of the
   * cached zone distance field, no path search), with room to roll and room behind for the kicker.
   */
  private kickDir(view: BotView, l: LootState): Vec2 | null {
    const field = view.nav.zoneField(view.team, 'large', view.sim.state.tick);
    const here = view.nav.fieldAt(field, l.pos, 'large');
    let best: Vec2 | null = null;
    let bestV = Number.isFinite(here) ? here - 0.5 : Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      const v = view.nav.fieldAt(field, V.add(l.pos, V.scale(d, 2.5)), 'large');
      if (v < bestV) {
        bestV = v;
        best = d;
      }
    }
    if (!best) return null;
    const dir = best;
    // room to roll a few metres, and room behind it for the kicker
    if (!view.nav.segmentClear(l.pos, V.add(l.pos, V.scale(dir, 3)), 'small', 0)) return null;
    const behind = V.sub(l.pos, V.scale(dir, l.half.x + CHARACTER.radius + 1.0));
    if (view.nav.clearanceAt(behind.x, behind.y) < 0.5) return null;
    return dir;
  }

  private execKick(view: BotView, g: Goal): Command {
    const st = view.sim.state;
    const me = view.me();
    const l = g.targetId !== null ? view.sim.getLoot(g.targetId) : undefined;
    if (!l || l.recovered || l.airborne) {
      view.endGoal('piggy gone');
      return still();
    }
    if (me.grab || holdsHammer(me)) {
      view.endGoal('hands busy');
      return still();
    }
    if (g.pressedTick !== undefined && g.pressedTick >= 0) {
      if (st.tick - g.pressedTick > 12) view.endGoal('kicked');
      return still();
    }
    if (mateHolds(view, l) && g.sub === 'kick') {
      view.endGoal('a mate has it');
      return still();
    }
    if (!g.stand || st.tick % 20 === 0) {
      const dir = g.sub === 'smash' ? V.norm(V.sub(l.pos, me.pos)) : this.kickDir(view, l);
      if (!dir) {
        view.endGoal('no kick line', 5 * TICK_RATE);
        return still();
      }
      g.stand = V.sub(l.pos, V.scale(dir, l.half.x + CHARACTER.radius + 0.9));
    }
    const dStand = V.dist(me.pos, g.stand);
    const dBall = V.dist(me.pos, l.pos) - l.half.x - CHARACTER.radius;
    const toBall = V.norm(V.sub(l.pos, me.pos));
    const behind = g.stand ? V.dot(V.norm(V.sub(l.pos, g.stand)), toBall) > 0.9 : false;
    if ((dStand < 0.5 || (behind && dBall < 1.6)) && dBall > 0.15 && dBall < DASH_LEN * 0.8) {
      g.phase = 'aim';
      if (me.dashCooldown === 0) {
        g.pressedTick = st.tick;
        return { move: toBall, grab: false, dash: true, aim: toBall, ping: null };
      }
      return { ...still(), aim: toBall };
    }
    g.phase = 'approach';
    const m = view.moveTo(g.stand, 'walk', 0.4, { slow: 0.9 });
    if (m.stuck) view.endGoal('stuck', 5 * TICK_RATE);
    return move(m.move);
  }
}

function still(): Command {
  return { move: { x: 0, y: 0 }, grab: false, dash: false, aim: null, ping: null };
}

function move(m: Vec2): Command {
  return { move: V.clampLen(m, 1), grab: false, dash: false, aim: null, ping: null };
}

/**
 * Holders a bot may know of: its own team's (public to the team, as in bot.ts) and opponents seen
 * holding it (perception `oppHolding`) — never the raw holder list (perception.ts header).
 */
function mateHolds(view: BotView, l: Readonly<LootState>): boolean {
  const chars = view.sim.state.characters;
  return l.grabbedBy.some((id) => chars[id - 1]?.team === view.team);
}

function heldBySeen(view: BotView, l: Readonly<LootState>): boolean {
  return mateHolds(view, l) || view.oppHolding(l.id).length > 0;
}
