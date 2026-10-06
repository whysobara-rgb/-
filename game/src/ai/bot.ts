/**
 * Rule-based bot (doc §11 "외부 AI 호출 없이 규칙 기반 게임 AI"): utility goal selection with
 * commitment/hysteresis, motor skills (approach-face-grab, strain, carry, bank haul, door
 * guard, dash with lead), team blackboard, personalities and difficulties, rival adaptation.
 *
 * Bots act only through Command (same physics as humans). They read public loot state, their
 * own team, and opponents through TeamPerception only (never sim.state.characters of the other
 * team). They never use sim.debug.
 */
import type { Simulation } from '../sim/sim';
import { BANK_MODEL, DASH, TICK_RATE, UNANCHOR_TICKS, VISION } from '../sim/config';
import { createRng } from '../sim/math';
import type { CharacterState, Command, EntityId, LootState, OBB, PingState, TeamId, Vec2 } from '../sim/types';
import { TeamBoard } from './board';
import {
  GRAB_REACH,
  V,
  bankDoors,
  bankGrabSpots,
  obbInside,
  rayOBB,
  safeGrabSpots,
  wrapAngle,
  zoneOBB,
  zoneOf,
  type GrabSpot,
} from './geom';
import { NAV_CELL, NavGrid, pointAtArc, polylineLength, projectOnPolyline, type NavClass } from './nav';
import { DIFFICULTY_PARAMS, PERSONALITY, type DifficultyParams, type PersonalityWeights } from './params';
import { TeamPerception, type OpponentView } from './perception';
import type { Adaptation, BotController, BotIntent, BotOptions, Difficulty, GoalKind, RivalId } from './types';

// ---------------------------------------------------------------------------
// Constants (estimates of the shared physics; never different per difficulty)
// ---------------------------------------------------------------------------

const WALK = 5;
const CARRY_SPEED: Record<'smallSafe' | 'largeSafe', [number, number]> = {
  smallSafe: [3.9, 4.3],
  largeSafe: [2.75, 3.5],
};
function bankSpeed(value: number, holders: number): number {
  const f = Math.min(1, Math.max(0, (value - 500) / 500));
  return holders >= 2 ? 1.68 - 0.16 * f : 1.0 - 0.11 * f;
}
const DWELL = 1.6;

type Cls = NavClass;

interface PathState {
  goal: Vec2;
  cls: Cls;
  pts: Vec2[];
  idx: number;
  tick: number;
  dynVersion: number;
  partial: boolean;
}

interface Goal {
  kind: GoalKind;
  key: string;
  targetId: EntityId | null;
  bankId: EntityId | null;
  pos: Vec2 | null;
  utility: number;
  value: number;
  est: number;
  started: number;
  phase: string;
  /** Skip the telegraph (chained follow-up such as picking up a knocked-out safe). */
  chained?: boolean;
  /** Strip: denial of an opponent's haul. */
  strip?: boolean;
  /** Mate whose action this goal supports (assist / escort / ping). */
  mateId?: EntityId;
  pingId?: number;
  until?: number;
  // --- execution scratch ---
  spot?: GrabSpot | null;
  spotKey?: string;
  spotTick?: number;
  spotFails?: number;
  spotRef?: Vec2;
  excluded?: Set<string>;
  aimTicks?: number;
  stallRef?: Vec2;
  stallTick?: number;
  stalls?: number;
  regrabs?: number;
  wiggleUntil?: number;
  wiggleDir?: Vec2;
  badFaceTicks?: number;
  mode?: 'pull' | 'push';
  modeUntil?: number;
  carryDir?: Vec2;
  carryDirTick?: number;
  waitStart?: number;
  resumeKey?: string;
}

export interface BotStats {
  decisions: number;
  switches: number;
  telegraphs: number;
  dashes: number;
  boosts: number;
  dashKnockdowns: number;
  finalReplans: number;
  repaths: number;
  stuckRepaths: number;
  goalFails: number;
  pingsAnswered: number;
  goalsByKind: Record<string, number>;
}

const EMPTY: Command = { move: { x: 0, y: 0 }, grab: false, dash: false, aim: null, ping: null };

function cmd(move: Vec2, grab: boolean, aim: Vec2 | null = null, dash = false): Command {
  return { move: V.clampLen(move, 1), grab, dash, aim, ping: null };
}

export interface BotInternalOptions extends BotOptions {
  /** Scripted stand-in for a human player (tools/tests): no claims, private sight. */
  humanProxy?: boolean;
}

export class Bot implements BotController {
  readonly slot: number;
  readonly id: EntityId;
  readonly team: TeamId;
  readonly personality: RivalId;
  readonly difficulty: Difficulty;
  readonly P: DifficultyParams;
  readonly W: PersonalityWeights;
  readonly adaptation: Adaptation | null;
  readonly isProxy: boolean;
  readonly stats: BotStats = {
    decisions: 0,
    switches: 0,
    telegraphs: 0,
    dashes: 0,
    boosts: 0,
    dashKnockdowns: 0,
    finalReplans: 0,
    repaths: 0,
    stuckRepaths: 0,
    goalFails: 0,
    pingsAnswered: 0,
    goalsByKind: {},
  };

  private readonly rng: () => number;
  private readonly board: TeamBoard;
  private readonly nav: NavGrid;
  private readonly perception: TeamPerception;
  private goal: Goal | null = null;
  private nextDecision = 0;
  private urgent = false;
  private telegraphUntil = -1;
  private path: PathState | null = null;
  private lastEventIdx = 0;
  private readonly blacklist = new Map<string, number>();
  private prevDash = false;
  private wasKnocked = false;
  // walk field cache
  private walkField: Float64Array | null = null;
  private walkOrigin: Vec2 = { x: 0, y: 0 };
  private walkTick = -9999;
  // watchdog
  private watchRef: Vec2 = { x: 0, y: 0 };
  private watchTick = 0;
  private watchLevel = 0;
  private nudgeUntil = -1;
  private nudgeDir: Vec2 = { x: 0, y: 0 };
  private avoidSpots: { x: number; y: number; r: number; cost: number; until: number }[] = [];
  // favourite routes (호다닥)
  private trail: Float32Array | null = null;
  private readonly answeredPings = new Set<number>();
  private lastIntent: BotIntent = { goal: 'idle', targetId: null, targetPos: null, telegraph: false, phase: 'idle' };
  /** Recent log lines (tools). */
  readonly log: string[] = [];
  private lastKnockVictimHolding: EntityId | null = null;

  constructor(sim: Simulation, opts: BotInternalOptions) {
    this.slot = opts.slot;
    const me = sim.characterBySlot(opts.slot);
    this.id = me.id;
    this.team = me.team;
    this.personality = opts.personality;
    this.difficulty = opts.difficulty;
    this.P = DIFFICULTY_PARAMS[opts.difficulty];
    this.W = PERSONALITY[opts.personality];
    this.adaptation = opts.adaptation ?? null;
    this.isProxy = opts.humanProxy === true;
    this.rng = createRng((opts.seed ^ (0x9e3779b9 * (opts.slot + 1))) >>> 0);
    this.board = TeamBoard.for(sim, this.team);
    this.nav = this.board.nav;
    if (this.isProxy) {
      this.perception = new TeamPerception(sim, this.team);
    } else {
      this.board.register(this.slot);
      this.perception = this.board.perception;
    }
    if (this.W.routeReuse > 0) this.trail = new Float32Array(this.nav.n);
    // stagger first decisions of teammates
    this.nextDecision = sim.state.tick + Math.floor(this.rng() * 4);
    this.lastEventIdx = sim.eventLog.length;
  }

  // =========================================================================
  // BotController
  // =========================================================================

  intent(): BotIntent {
    return this.lastIntent;
  }

  debug(): unknown {
    const g = this.goal;
    return {
      slot: this.slot,
      personality: this.personality,
      difficulty: this.difficulty,
      goal: g ? { kind: g.kind, key: g.key, phase: g.phase, utility: +g.utility.toFixed(2), value: g.value, est: +g.est.toFixed(1) } : null,
      telegraph: this.lastIntent.telegraph,
      path: this.path ? this.path.pts.slice(this.path.idx) : null,
      stats: this.stats,
    };
  }

  update(sim: Simulation): Command {
    const st = sim.state;
    this.board.tick(sim);
    if (this.isProxy) this.perception.update(sim, [this.slot]);
    if (st.over) return EMPTY;
    const me = this.me(sim);
    this.processEvents(sim);
    const tick = st.tick;
    if (me.knockdownTicks > 0) {
      this.wasKnocked = true;
      this.prevDash = false;
      this.lastIntent = { ...this.lastIntent, telegraph: false, phase: 'knockedDown' };
      return EMPTY;
    }
    if (this.wasKnocked) {
      this.wasKnocked = false;
      this.urgent = true;
      this.path = null;
    }
    if (this.urgent || tick >= this.nextDecision) this.decide(sim);
    let c: Command;
    if (this.goal && tick < this.telegraphUntil) c = this.telegraphCommand(sim, this.goal);
    else c = this.execute(sim);
    // level dash: only a rising edge triggers
    if (c.dash && this.prevDash) c = { ...c, dash: false };
    if (c.dash) {
      if (me.grab) this.stats.boosts++;
      else this.stats.dashes++;
    }
    this.prevDash = c.dash;
    if (this.trail && me.grab) {
      const l = sim.getLoot(me.grab.targetId);
      if (l && l.kind === 'smallSafe') this.markTrail(me.pos);
    }
    this.updateIntent(sim, c);
    return c;
  }

  // =========================================================================
  // Basic accessors
  // =========================================================================

  private me(sim: Simulation): CharacterState {
    return sim.state.characters[this.slot]!;
  }

  private mates(sim: Simulation): CharacterState[] {
    const out: CharacterState[] = [];
    for (const ch of sim.state.characters) if (ch.team === this.team && ch.id !== this.id) out.push(ch);
    return out;
  }

  private opponents(sim: Simulation, delay = this.P.reactionDelay): OpponentView[] {
    return this.perception.opponents(sim.state.tick, delay);
  }

  private secondsLeft(sim: Simulation): number {
    const st = sim.state;
    if (!Number.isFinite(st.endTick)) return 1e6;
    return Math.max(0, (st.endTick - st.tick) / TICK_RATE);
  }

  private routeFor(sim: Simulation, bank: LootState): Vec2[] | null {
    const banks = sim.state.loot.filter((l) => l.kind === 'bank');
    const bankIndex = banks.findIndex((b) => b.id === bank.id);
    const r = sim.layout.bankRoutes.find((rr) => rr.bankIndex === bankIndex && rr.team === this.team);
    return r ? r.points : null;
  }

  private log1(sim: Simulation, msg: string): void {
    this.log.push(`[${sim.state.tick}] ${msg}`);
    if (this.log.length > 200) this.log.shift();
  }

  private blacklisted(key: string, tick: number): boolean {
    const u = this.blacklist.get(key);
    return u !== undefined && u > tick;
  }

  // =========================================================================
  // Events (public or own-team only)
  // =========================================================================

  private processEvents(sim: Simulation): void {
    const log = sim.eventLog;
    const g = this.goal;
    for (let i = this.lastEventIdx; i < log.length; i++) {
      const e = log[i]!;
      switch (e.type) {
        case 'recovered':
          if (g && (g.targetId === e.lootId || g.bankId === e.lootId || e.safeIds.includes(g.targetId ?? -1))) this.urgent = true;
          break;
        case 'bankBodyRecovered':
          this.urgent = true;
          break;
        case 'finalCountdown':
          this.urgent = true;
          this.finalPending = true;
          break;
        case 'release':
          if (e.charId === this.id && e.forced) this.urgent = true;
          break;
        case 'dashHit':
          if (e.attackerId === this.id && e.knockdown) {
            this.stats.dashKnockdowns++;
            this.knockedVictim = e.victimId;
            this.urgent = true;
          }
          break;
        case 'ping':
          if (e.team === this.team && e.charId !== this.id) this.urgent = true;
          break;
        case 'fenceBroken':
          this.path = null;
          break;
        default:
          break;
      }
    }
    this.lastEventIdx = log.length;
  }

  private finalPending = false;
  private knockedVictim: EntityId | null = null;

  // =========================================================================
  // Decision making
  // =========================================================================

  private decide(sim: Simulation): void {
    const tick = sim.state.tick;
    const wasUrgent = this.urgent;
    this.urgent = false;
    this.nextDecision = tick + this.P.decisionInterval + Math.floor(this.rng() * 6);
    this.stats.decisions++;
    const cands = this.candidates(sim);
    const cur = this.goal;
    let curCand = cur ? cands.find((c) => c.key === cur.key) ?? null : null;
    // chained follow-ups that are not regular candidates (escort/defend in progress) keep their own utility
    if (cur && !curCand && cur.until !== undefined && tick < cur.until && this.goalStillValid(sim, cur)) curCand = cur;
    cands.sort((a, b) => b.utility - a.utility || (a.key < b.key ? -1 : 1));
    let pick: Goal | null = cands[0] ?? null;
    if (pick && this.rng() > this.P.bestChoiceProb) {
      const decent = cands.filter((c) => c !== pick && c.utility >= pick!.utility * this.P.decentRatio && c.kind !== 'idle');
      if (decent.length) pick = decent[Math.floor(this.rng() * decent.length)]!;
    }
    const final = this.finalPending;
    this.finalPending = false;
    if (curCand && pick && curCand.key !== pick.key) {
      const holding = this.me(sim).grab !== null && (this.me(sim).grab!.targetId === cur!.targetId);
      const hyst = 1.15 + this.W.commitment * 0.4 + (holding ? 0.25 : 0);
      if (curCand.utility * hyst >= pick.utility) pick = curCand;
    }
    if (curCand && pick && pick.key === curCand.key && cur) {
      cur.utility = curCand.utility;
      cur.est = curCand.est;
      if (final) this.logFinal(sim, cur, cur, 'kept');
      return;
    }
    if (!pick) {
      if (cur) this.endGoal(sim, 'noCandidates');
      return;
    }
    if (final || (wasUrgent && this.secondsLeft(sim) <= 30.5 && sim.state.finalCountdown)) this.logFinal(sim, cur, pick, 'switched');
    this.startGoal(sim, pick);
  }

  private logFinal(sim: Simulation, from: Goal | null, to: Goal, how: string): void {
    this.stats.finalReplans++;
    const msg = `final30 re-plan: ${from ? from.key : 'none'} -> ${to.key} (${how}, ${this.secondsLeft(sim).toFixed(1)} s left)`;
    this.board.log.push({ tick: sim.state.tick, slot: this.slot, msg });
    this.log1(sim, msg);
  }

  private goalStillValid(sim: Simulation, g: Goal): boolean {
    if (g.kind === 'followPing') return true;
    if (g.kind === 'defendDoor' || g.kind === 'escort') {
      const b = g.bankId !== null ? sim.getLoot(g.bankId) : null;
      if (g.kind === 'defendDoor' && (!b || b.recovered)) return false;
      return true;
    }
    return false;
  }

  private startGoal(sim: Simulation, g: Goal): void {
    const tick = sim.state.tick;
    const prev = this.goal;
    g.started = tick;
    g.phase = 'start';
    this.goal = g;
    this.path = null;
    this.stats.switches++;
    this.stats.goalsByKind[g.kind] = (this.stats.goalsByKind[g.kind] ?? 0) + 1;
    if (!this.isProxy) this.board.setClaim(this.slot, g.key, g.targetId, tick);
    if (g.pingId !== undefined && !this.answeredPings.has(g.pingId)) {
      this.answeredPings.add(g.pingId);
      this.stats.pingsAnswered++;
      this.log1(sim, `answers ping ${g.pingId} with ${g.key}`);
    }
    const sameTarget = prev && prev.targetId === g.targetId && prev.targetId !== null;
    if (!g.chained && !sameTarget && g.kind !== 'idle' && this.P.telegraphTicks > 0) {
      this.telegraphUntil = tick + this.P.telegraphTicks;
      this.stats.telegraphs++;
    } else this.telegraphUntil = -1;
    this.watchRef = { ...this.me(sim).pos };
    this.watchTick = tick;
    this.watchLevel = 0;
    this.log1(sim, `goal ${g.key} u=${g.utility.toFixed(2)} v=${g.value} est=${g.est.toFixed(1)}`);
  }

  private endGoal(sim: Simulation, why: string, blacklistTicks = 0): void {
    const g = this.goal;
    if (!g) return;
    if (blacklistTicks > 0) {
      this.blacklist.set(g.key, sim.state.tick + blacklistTicks);
      this.stats.goalFails++;
    }
    this.log1(sim, `end ${g.key}: ${why}`);
    this.goal = null;
    this.path = null;
    if (!this.isProxy) this.board.setClaim(this.slot, null, null, sim.state.tick);
    this.urgent = true;
  }

  // -------------------------------------------------------------------------
  // Estimates
  // -------------------------------------------------------------------------

  /** Walk distance (m) from me to p (cached Dijkstra field, re-rooted when I move). */
  private walkDist(sim: Simulation, p: Vec2): number {
    const me = this.me(sim);
    const tick = sim.state.tick;
    if (!this.walkField || V.dist(me.pos, this.walkOrigin) > 2.5 || tick - this.walkTick > 150) {
      const k = this.nav.nearestPassable(me.pos, 'walk', 3);
      this.walkField = this.nav.distanceField([k], 'walk', this.walkField ?? undefined);
      this.walkOrigin = { ...me.pos };
      this.walkTick = tick;
    }
    return this.nav.fieldAt(this.walkField, p, 'walk') + V.dist(me.pos, this.walkOrigin) * 0.7;
  }

  private carryDist(sim: Simulation, p: Vec2, cls: Cls, team: TeamId = this.team): number {
    return this.nav.fieldAt(this.nav.zoneField(team, cls, sim.state.tick), p, cls);
  }

  private safeClass(l: LootState): Cls {
    return l.kind === 'largeSafe' ? 'large' : 'small';
  }

  /** Mates (own team) holding a loot item. */
  private mateHolders(sim: Simulation, lootId: EntityId): CharacterState[] {
    const out: CharacterState[] = [];
    for (const ch of sim.state.characters) {
      if (ch.team === this.team && ch.id !== this.id && ch.grab && ch.grab.targetId === lootId) out.push(ch);
    }
    return out;
  }

  /** Opponents currently seen holding a loot item (no delay: the item's motion is public anyway). */
  private oppHolding(sim: Simulation, lootId: EntityId): OpponentView[] {
    return this.opponents(sim, 0).filter((o) => o.visible && o.last && o.last.holdingId === lootId);
  }

  private humanMate(sim: Simulation): CharacterState | null {
    for (const ch of sim.state.characters) if (ch.team === this.team && ch.id !== this.id && !ch.isBot) return ch;
    return null;
  }

  /** Loot a human teammate is probably going for (not holding): nearest item ahead within 4 m. */
  private humanTargetGuess(sim: Simulation, h: CharacterState): EntityId | null {
    if (h.grab) return h.grab.targetId;
    const mv = h.moveIntent;
    const ml = V.len(mv);
    let best: EntityId | null = null;
    let bestD = 4;
    for (const l of sim.state.loot) {
      if (l.recovered) continue;
      const d = l.kind === 'bank' ? V.dist(h.pos, l.pos) - 4 : V.dist(h.pos, l.pos);
      if (d > bestD) continue;
      if (ml > 0.3 && d > 1.5) {
        const dir = V.norm(V.sub(l.pos, h.pos));
        if (V.dot(dir, V.scale(mv, 1 / ml)) < 0.5) continue;
      }
      best = l.id;
      bestD = d;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Candidates
  // -------------------------------------------------------------------------

  private mk(kind: GoalKind, key: string, targetId: EntityId | null, utility: number, value: number, est: number, extra: Partial<Goal> = {}): Goal {
    return { kind, key, targetId, bankId: null, pos: null, utility, value, est, started: 0, phase: 'start', ...extra };
  }

  private candidates(sim: Simulation): Goal[] {
    const st = sim.state;
    const tick = st.tick;
    const me = this.me(sim);
    const out: Goal[] = [];
    const left = this.secondsLeft(sim);
    const opps = this.opponents(sim);
    const freshOpps = opps.filter((o) => o.last && o.age < 150);
    const human = this.humanMate(sim);
    const humanTarget = human ? this.humanTargetGuess(sim, human) : null;
    const claimed = new Set<string>();
    if (!this.isProxy) for (const c of this.board.otherClaims(this.slot)) claimed.add(c.key);
    const W = this.W;
    const depth = this.P.counterDepth;
    const myGrab = me.grab ? me.grab.targetId : null;
    const finalPhase = left <= 30;
    // proxy humans don't coordinate through the board: avoid what bot mates visibly hold only
    const pingGoals = this.pingCandidates(sim);
    for (const p of pingGoals) out.push(p);

    // banks my team is hauling (for skip rules + defense)
    const myTeamBanks = new Set<EntityId>();
    for (const l of st.loot) {
      if (l.kind !== 'bank' || l.recovered) continue;
      if (this.mateHolders(sim, l.id).length > 0 || myGrab === l.id) myTeamBanks.add(l.id);
      if (!this.isProxy) for (const c of this.board.otherClaims(this.slot)) if (c.targetId === l.id && (c.key.startsWith('haul:') || c.key.startsWith('assist:'))) myTeamBanks.add(l.id);
    }

    // --- safes ---
    for (const l of st.loot) {
      if (l.recovered || l.kind === 'bank') continue;
      const key = `collect:${l.id}`;
      if (this.blacklisted(key, tick)) continue;
      if (claimed.has(key)) continue;
      const holdingIt = myGrab === l.id;
      const mh = this.mateHolders(sim, l.id);
      if (mh.length > 0 && !holdingIt) continue; // a teammate has it (co-carry only via pings)
      if (!holdingIt && humanTarget === l.id) continue; // never race the human teammate
      const oh = this.oppHolding(sim, l.id);
      if (oh.length > 0 && !holdingIt) continue; // intercept instead
      // inside a bank floor?
      let strip = false;
      let bankMoving = false;
      if (l.floorOf !== null) {
        const bank = sim.getLoot(l.floorOf);
        if (bank && !bank.recovered) {
          if (myTeamBanks.has(bank.id) && !holdingIt) continue; // never unload our own haul
          bankMoving = !bank.anchored;
          const oppHaul = this.oppHolding(sim, bank.id).length > 0;
          strip = oppHaul || bankMoving;
          if (bank.recovery && bank.recovery.team === this.team && !holdingIt) continue;
        }
      }
      if (l.recovery && l.recovery.team !== this.team && !holdingIt) {
        // about to be recovered by them: only worth it if very close
        if (V.dist(me.pos, l.pos) > 4) continue;
      }
      const cls = this.safeClass(l);
      const walk = holdingIt ? 0 : Math.max(0, this.walkDist(sim, l.pos) - 0.8);
      const carry = this.carryDist(sim, l.pos, cls);
      if (!Number.isFinite(walk) || !Number.isFinite(carry)) continue;
      const kind = l.kind as 'smallSafe' | 'largeSafe';
      const helpers = 1;
      const speed = CARRY_SPEED[kind][helpers - 1]!;
      const tUn = l.anchored ? (UNANCHOR_TICKS[kind] / TICK_RATE) * (1 - l.unanchorProgress) : 0;
      const inZone = l.recovery && l.recovery.team === this.team;
      const t = inZone ? DWELL : (walk / WALK) * 1.08 + (holdingIt ? 0 : 0.7) + tUn + (carry / speed) * 1.12 + DWELL + 0.3;
      if (t * 1.04 + 0.4 > left) continue;
      let value = l.baseValue;
      let w = kind === 'smallSafe' ? W.smallSafe : W.largeSafe;
      if (strip) {
        w = Math.max(w, W.strip);
        if (depth >= 1) value *= 1 + 0.5 * Math.min(1, depth / 2 + 0.25) * (1 + W.opportunism * 0.5);
      }
      // loose safes dropped in the open are quick pickups
      if (!l.anchored && !strip) w *= 1.08;
      // competition: an empty-handed opponent much closer to it
      let compete = 1;
      if (!holdingIt) {
        for (const o of freshOpps) {
          if (!o.last || o.last.holdingId !== null) continue;
          const od = V.dist(o.last.pos, l.pos) * 1.15 + (o.age / TICK_RATE) * 2.5;
          if (od + 2.5 < walk) compete = Math.min(compete, 0.5);
        }
      }
      // adaptation stripBank: prefer extracting the large safe of the nearest bank
      if (this.adaptation?.kind === 'stripBank' && l.floorOf !== null && kind === 'largeSafe') w *= 1.6;
      // final phase: deliverable small safes first (doc §11 마지막 30초)
      if (finalPhase && kind === 'smallSafe') w *= 1.1;
      const rate = (value / t) * w * compete;
      out.push(
        this.mk(strip ? 'stripBank' : 'collectSafe', key, l.id, rate, l.baseValue, t, {
          strip,
          bankId: l.floorOf,
        }),
      );
    }

    // --- banks: haul / assist ---
    for (const b of st.loot) {
      if (b.kind !== 'bank' || b.recovered) continue;
      const route = this.routeFor(sim, b);
      if (!route) continue;
      const oh = this.oppHolding(sim, b.id);
      const mh = this.mateHolders(sim, b.id);
      const holdingIt = myGrab === b.id;
      if (oh.length > 0 && !holdingIt && mh.length === 0) continue; // their haul: strip it instead
      const routeLen = polylineLength(route);
      const proj = projectOnPolyline(route, b.pos);
      const remaining = Math.max(0, routeLen - proj.s) + proj.dist * 1.3;
      const inZone = b.recovery && b.recovery.team === this.team;
      const holders = Math.max(1, mh.length + (holdingIt ? 1 : 0));
      const value = b.estimatedValue;
      const walk = holdingIt ? 0 : Math.max(0, this.walkDist(sim, b.pos) - 4.5);
      if (!Number.isFinite(walk)) continue;
      const otherBotHauling = !this.isProxy && this.board.otherClaims(this.slot).some((c) => c.key === `haul:${b.id}`);
      const isAssist = (mh.length > 0 || otherBotHauling) && (!holdingIt || this.goal?.kind === 'assistHaul');
      const nAfter = isAssist ? Math.min(2, holders + 1) : holders;
      const tUn = b.anchored ? (UNANCHOR_TICKS.bank / TICK_RATE / nAfter) * (1 - b.unanchorProgress) : 0;
      const t = inZone ? DWELL : (walk / WALK) * 1.08 + 1.2 + tUn + (remaining / bankSpeed(value, nAfter)) * 1.18 + DWELL + 1;
      if (t * 1.05 + 1 > left) continue;
      let rate = value / t;
      if (isAssist) {
        const key = `assist:${b.id}`;
        if (claimed.has(key) || this.blacklisted(key, tick)) continue;
        if (mh.length >= 2) continue;
        const humanHauling = human !== null && mh.some((m) => m.id === human.id);
        // marginal team gain of a second hauler, plus helping the human without orders
        let u = rate * 0.55 * W.assist;
        if (humanHauling) u = Math.max(u * 1.8, 9);
        out.push(this.mk('assistHaul', key, b.id, u, value, t, { bankId: b.id, mateId: mh[0]?.id }));
      } else {
        const key = `haul:${b.id}`;
        if (claimed.has(key) || this.blacklisted(key, tick)) continue;
        const contents = (value - 500) / 100;
        let w = W.bank * (1 + W.bankContents * contents);
        // long exposure with opponents around
        if (freshOpps.length > 0 && t > 30) w *= 0.92;
        if (this.adaptation?.kind === 'stripBank') w *= 0.75;
        rate *= w;
        out.push(this.mk('haulBank', key, b.id, rate, value, t, { bankId: b.id }));
      }
    }

    // --- intercept carriers ---
    for (const o of opps) {
      if (!o.last || o.age > 40 || o.last.holdingId === null) continue;
      if (me.grab) break;
      const l = sim.getLoot(o.last.holdingId);
      if (!l || l.recovered || l.kind === 'bank') continue;
      const key = `intercept:${o.id}`;
      if (claimed.has(key) || this.blacklisted(key, tick)) continue;
      const d = V.dist(me.pos, o.last.pos) * 1.15;
      if (d > 26) continue;
      const vo = V.len(o.last.vel);
      const closing = Math.max(1.4, WALK - 0.55 * vo);
      const tReach = d / closing;
      const cls = this.safeClass(l);
      // will they score before I get there?
      const theirLeft = this.carryDist(sim, o.last.pos, cls, o.team);
      const tTheirs = Number.isFinite(theirLeft) ? theirLeft / Math.max(1.5, CARRY_SPEED[l.kind as 'smallSafe' | 'largeSafe'][0]) : 99;
      if (tReach > tTheirs + 0.5) continue;
      const myCarry = this.carryDist(sim, o.last.pos, cls);
      if (!Number.isFinite(myCarry)) continue;
      const t = tReach + 1.5 + myCarry / CARRY_SPEED[l.kind as 'smallSafe' | 'largeSafe'][0] + DWELL;
      if (t > left) continue;
      const pHit = 0.35 + 0.35 * this.P.dashUse;
      let w = W.intercept * (depth === 0 ? 0.55 : 1);
      if (l.kind === 'largeSafe') w *= 1 + W.opportunism * 0.6;
      // the swing: they lose it, we may gain it
      const rate = ((l.baseValue * 1.6 * pHit) / t) * w;
      out.push(this.mk('intercept', key, o.id, rate, l.baseValue, t, { pos: { ...o.last.pos } }));
    }

    // --- defend a door of a bank my team is hauling ---
    for (const bid of myTeamBanks) {
      if (myGrab === bid) continue;
      const b = sim.getLoot(bid)!;
      const threat = this.nearestThreat(freshOpps, b.pos, 11);
      if (!threat) continue;
      const key = `defend:${bid}`;
      if (claimed.has(key) || this.blacklisted(key, tick)) continue;
      const contents = b.estimatedValue - 500;
      if (contents <= 0) continue;
      let w = 1 * this.P.threatResponse;
      if (this.adaptation?.kind === 'guardDoors') w *= 1.8;
      const d = this.walkDist(sim, b.pos);
      const rate = ((contents * 0.6) / (d / WALK + 6)) * w;
      out.push(this.mk('defendDoor', key, threat.id, rate, contents, d / WALK + 6, { bankId: bid, until: tick + 6 * TICK_RATE }));
    }

    // --- escort a human teammate carrying a safe ---
    if (human && human.grab && !this.isProxy) {
      const hl = sim.getLoot(human.grab.targetId);
      if (hl && hl.kind !== 'bank' && !hl.recovered) {
        const threat = this.nearestThreat(freshOpps, human.pos, 12);
        if (threat && this.rng() < this.P.threatResponse + 0.1) {
          const key = `escort:${human.id}`;
          if (!claimed.has(key)) {
            const d = V.dist(me.pos, human.pos);
            const rate = ((hl.baseValue * 0.9) / (d / WALK + 5)) * (0.8 + 0.4 * W.aggression);
            out.push(this.mk('escort', key, threat.id, rate, hl.baseValue, d / WALK + 5, { mateId: human.id, until: tick + 5 * TICK_RATE }));
          }
        }
      }
    }

    // --- adaptation: ambush the chokepoint the human kept using ---
    if (this.adaptation?.kind === 'ambushChoke' && this.adaptation.chokepointId && !me.grab) {
      const ch = sim.layout.chokepoints.find((c) => c.id === this.adaptation!.chokepointId);
      if (ch) {
        const key = `ambush:${ch.id}`;
        if (!this.blacklisted(key, tick)) {
          let rate = 5.5;
          const seenNear = freshOpps.some((o) => o.last && o.age < 600 && V.dist(o.last.pos, ch.pos) < ch.radius + 14);
          if (seenNear) rate *= 1.6;
          const carrying = freshOpps.some((o) => o.last && o.age < 60 && o.last.holdingId !== null && V.dist(o.last.pos, ch.pos) < ch.radius + 12);
          if (carrying) rate *= 2;
          if (left < 20) rate *= 0.3;
          out.push(this.mk('ambush', key, null, rate, 100, 10, { pos: { ...ch.pos } }));
        }
      }
    }

    // --- fallback ---
    if (!me.grab) {
      const pos = this.repositionSpot(sim);
      if (pos && V.dist(pos, me.pos) > 3) out.push(this.mk('reposition', `repos:${Math.round(pos.x)},${Math.round(pos.y)}`, null, 0.02, 0, 5, { pos }));
    }
    out.push(this.mk('idle', 'idle', null, 0.001, 0, 1));
    return out;
  }

  private nearestThreat(opps: OpponentView[], p: Vec2, radius: number): OpponentView | null {
    let best: OpponentView | null = null;
    let bestD = radius;
    for (const o of opps) {
      if (!o.last || o.age > 90) continue;
      if (o.last.knockedDown) continue;
      const d = V.dist(o.last.pos, p);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Somewhere useful to wait: the unrecovered loot centroid nearest to the middle. */
  private repositionSpot(sim: Simulation): Vec2 | null {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const l of sim.state.loot) {
      if (l.recovered) continue;
      sx += l.pos.x;
      sy += l.pos.y;
      n++;
    }
    if (!n) return null;
    const p = { x: sx / n, y: sy / n };
    const k = this.nav.nearestPassable(p, 'walk', 6);
    return k >= 0 ? { x: this.nav.cellX(k), y: this.nav.cellY(k) } : null;
  }

  /** Pings from teammates (doc §4/§11: 같이 잡자 / 이쪽으로). */
  private pingCandidates(sim: Simulation): Goal[] {
    if (this.isProxy) return [];
    const out: Goal[] = [];
    const st = sim.state;
    const left = this.secondsLeft(sim);
    for (const p of st.pings as PingState[]) {
      if (p.team !== this.team || p.charId === this.id || p.expiresTick <= st.tick) continue;
      if (this.answeredPings.has(p.id)) continue;
      const pinger = sim.getCharacter(p.charId);
      if (!pinger) continue;
      // bot teammates coordinate through claims; pings matter for human mates
      if (pinger.isBot) continue;
      if (p.kind === 'goHere') {
        out.push(this.mk('followPing', `ping:${p.id}`, null, 60, 0, 5, { pos: { ...p.pos }, pingId: p.id, mateId: p.charId, until: p.expiresTick + 120 }));
        continue;
      }
      if (p.targetId === null) continue;
      const l = sim.getLoot(p.targetId);
      if (!l || l.recovered) continue;
      if (l.kind === 'bank') {
        const humanHolds = pinger.grab && pinger.grab.targetId === l.id;
        const key = humanHolds ? `assist:${l.id}` : `haul:${l.id}`;
        out.push(this.mk(humanHolds ? 'assistHaul' : 'haulBank', key, l.id, 60, l.estimatedValue, 30, { bankId: l.id, pingId: p.id, mateId: p.charId }));
      } else {
        const key = `collect:${l.id}`;
        const walk = this.walkDist(sim, l.pos);
        if (walk / WALK + 3 > left) continue;
        out.push(this.mk('collectSafe', key, l.id, 60, l.baseValue, walk / WALK + 8, { pingId: p.id, mateId: p.charId }));
      }
    }
    return out;
  }

  // =========================================================================
  // Execution
  // =========================================================================

  private telegraphCommand(sim: Simulation, g: Goal): Command {
    const me = this.me(sim);
    const tp = this.goalTargetPos(sim, g);
    const aim = tp ? V.sub(tp, me.pos) : null;
    // keep holding only if the new goal is about the same object
    const keep = me.grab !== null && me.grab.targetId === g.targetId;
    return cmd({ x: 0, y: 0 }, keep, aim && V.len(aim) > 0.1 ? aim : null);
  }

  private goalTargetPos(sim: Simulation, g: Goal): Vec2 | null {
    if (g.kind === 'intercept' || g.kind === 'escort' || g.kind === 'defendDoor') {
      if (g.kind === 'defendDoor' && g.bankId !== null) return sim.getLoot(g.bankId)?.pos ?? null;
      if (g.targetId !== null) {
        const s = this.perception.latest(g.targetId);
        if (s) return s.pos;
      }
      return g.pos;
    }
    if (g.targetId !== null) {
      const l = sim.getLoot(g.targetId);
      if (l) return l.pos;
    }
    return g.pos;
  }

  private updateIntent(sim: Simulation, c: Command): void {
    const g = this.goal;
    const tick = sim.state.tick;
    this.lastIntent = {
      goal: g ? g.kind : 'idle',
      targetId: g ? g.targetId : null,
      targetPos: g ? this.goalTargetPos(sim, g) : null,
      telegraph: !!g && tick < this.telegraphUntil,
      phase: g ? g.phase : 'idle',
    };
  }

  private execute(sim: Simulation): Command {
    const g = this.goal;
    if (!g) return this.idleCommand(sim);
    switch (g.kind) {
      case 'collectSafe':
      case 'stripBank':
        return this.execCollect(sim, g);
      case 'haulBank':
      case 'assistHaul':
        return this.execHaul(sim, g);
      case 'intercept':
        return this.execIntercept(sim, g);
      case 'defendDoor':
        return this.execDefend(sim, g);
      case 'escort':
        return this.execEscort(sim, g);
      case 'ambush':
        return this.execAmbush(sim, g);
      case 'followPing':
      case 'reposition':
        return this.execMoveGoal(sim, g);
      default:
        return this.idleCommand(sim);
    }
  }

  private idleCommand(sim: Simulation): Command {
    // don't stand in a teammate's way
    return cmd(this.yieldToMates(sim, { x: 0, y: 0 }), false);
  }

  // -------------------------------------------------------------------------
  // Movement: path following, local avoidance, watchdog
  // -------------------------------------------------------------------------

  private moveTo(sim: Simulation, goal: Vec2, cls: Cls, arrive: number, opts: { slow?: number; carrying?: boolean } = {}): { move: Vec2; arrived: boolean; stuck: boolean } {
    const me = this.me(sim);
    const tick = sim.state.tick;
    const dGoal = V.dist(me.pos, goal);
    if (dGoal <= arrive) {
      this.watchRef = { ...me.pos };
      this.watchTick = tick;
      return { move: { x: 0, y: 0 }, arrived: true, stuck: false };
    }
    const nav = this.nav;
    let p = this.path;
    const needRepath =
      !p ||
      p.cls !== cls ||
      V.dist(p.goal, goal) > 0.75 ||
      (tick - p.tick > 75 && p.dynVersion !== nav.dynVersion) ||
      (me.floorOf !== null && tick - p.tick > 20) ||
      tick - p.tick > 240;
    if (needRepath) {
      this.computePath(sim, goal, cls);
      p = this.path;
    }
    let target = goal;
    if (p && p.pts.length > 1) {
      // advance waypoints
      while (p.idx < p.pts.length - 1 && V.dist(me.pos, p.pts[p.idx]!) < 0.5) p.idx++;
      if (p.idx < p.pts.length - 1 && (tick + this.slot) % 4 === 0 && nav.segmentClear(me.pos, p.pts[p.idx + 1]!, cls, 0.05)) p.idx++;
      // off the path: re-plan soon
      const a = p.pts[Math.max(0, p.idx - 1)]!;
      const b = p.pts[p.idx]!;
      const proj = projectOnPolyline([a, b], me.pos);
      if (proj.dist > 1.8 && tick - p.tick > 20) {
        this.computePath(sim, goal, cls);
        p = this.path!;
      }
      target = p.pts[Math.min(p.idx, p.pts.length - 1)]!;
      if (p.partial && p.idx >= p.pts.length - 1 && V.dist(me.pos, target) < 0.6) {
        // reached the closest reachable point of an unreachable goal
        return { move: { x: 0, y: 0 }, arrived: false, stuck: true };
      }
    }
    let dir = V.norm(V.sub(target, me.pos));
    let mag = 1;
    const slow = opts.slow ?? 0.7;
    const isLast = !p || p.idx >= p.pts.length - 1;
    if (isLast && dGoal < slow) mag = Math.max(0.35, dGoal / slow);
    dir = this.avoid(sim, dir, cls, opts.carrying === true);
    let move = V.scale(dir, mag);
    // watchdog
    const w = this.watchdog(sim, move);
    if (w.nudge) move = w.nudge;
    return { move, arrived: false, stuck: w.stuck };
  }

  private computePath(sim: Simulation, goal: Vec2, cls: Cls): void {
    const me = this.me(sim);
    const tick = sim.state.tick;
    this.avoidSpots = this.avoidSpots.filter((a) => a.until > tick);
    const res = this.nav.findPath(me.pos, goal, cls, {
      discount: this.trail && this.trail.length ? this.trail : null,
      avoid: this.avoidSpots.length ? this.avoidSpots : undefined,
      maxExpand: 30000,
    });
    this.stats.repaths++;
    if (!res) {
      this.path = { goal: { ...goal }, cls, pts: [{ ...me.pos }, { ...goal }], idx: 1, tick, dynVersion: this.nav.dynVersion, partial: true };
      return;
    }
    this.path = { goal: { ...goal }, cls, pts: res.points, idx: 1, tick, dynVersion: this.nav.dynVersion, partial: res.partial };
  }

  /** Local avoidance of characters and loose safes (cheap whiskers). */
  private avoid(sim: Simulation, dir: Vec2, cls: Cls, carrying: boolean): Vec2 {
    const me = this.me(sim);
    const perp = { x: -dir.y, y: dir.x };
    let side = 0;
    const consider = (p: Vec2, r: number, k: number): void => {
      const rel = V.sub(p, me.pos);
      const d = V.len(rel);
      if (d > 2.4 + r || d < 1e-6) return;
      const ahead = V.dot(rel, dir);
      if (ahead < 0.05) return;
      const lat = V.dot(rel, perp);
      const clearR = 0.5 + r;
      if (Math.abs(lat) > clearR) return;
      const s = (1 - Math.min(1, (d - r) / 2.4)) * k;
      side += lat >= 0 ? -s : s;
    };
    for (const ch of sim.state.characters) {
      if (ch.id === this.id || ch.team !== this.team) continue;
      consider(ch.pos, ch.isBot ? 0.45 : 0.75, ch.isBot ? 0.8 : 1.3);
    }
    for (const o of this.perception.opponents(sim.state.tick, 0)) {
      if (!o.visible || !o.last) continue;
      consider(o.last.pos, 0.45, 0.7);
    }
    const holding = me.grab ? me.grab.targetId : null;
    const goalTarget = this.goal ? this.goal.targetId : null;
    for (const l of sim.state.loot) {
      if (l.recovered || l.kind === 'bank' || l.id === holding || l.id === goalTarget) continue;
      if (Math.abs(l.pos.x - me.pos.x) > 3.5 || Math.abs(l.pos.y - me.pos.y) > 3.5) continue;
      consider(l.pos, Math.hypot(l.half.x, l.half.y), 1);
    }
    if (side === 0) return dir;
    const s = Math.max(-1.2, Math.min(1.2, side));
    const nd = V.norm(V.add(dir, V.scale(perp, s)));
    const r = this.nav.clearanceAt(me.pos.x + nd.x * 0.6, me.pos.y + nd.y * 0.6);
    return r >= (carrying ? 0.5 : 0.46) ? nd : dir;
  }

  /** Keep out of a teammate's way when idle; returns a small step aside. */
  private yieldToMates(sim: Simulation, move: Vec2): Vec2 {
    const me = this.me(sim);
    for (const ch of sim.state.characters) {
      if (ch.team !== this.team || ch.id === this.id) continue;
      const rel = V.sub(me.pos, ch.pos);
      const d = V.len(rel);
      if (d > 2.2 || d < 1e-6) continue;
      const mv = ch.moveIntent;
      const ml = V.len(mv);
      if (ml < 0.3) continue;
      const toMe = V.scale(rel, 1 / d);
      if (V.dot(toMe, V.scale(mv, 1 / ml)) < 0.6) continue;
      // step perpendicular to their motion, toward the free side
      const perp = { x: -mv.y / ml, y: mv.x / ml };
      const sgn = V.dot(perp, toMe) >= 0 ? 1 : -1;
      return V.add(move, V.scale(perp, sgn));
    }
    return move;
  }

  /** No-progress watchdog: re-path, nudge, then report stuck. */
  private watchdog(sim: Simulation, move: Vec2): { stuck: boolean; nudge: Vec2 | null } {
    const me = this.me(sim);
    const tick = sim.state.tick;
    if (V.len(move) < 0.3 || me.straining) {
      this.watchRef = { ...me.pos };
      this.watchTick = tick;
      this.watchLevel = 0;
      return { stuck: false, nudge: null };
    }
    if (tick < this.nudgeUntil) return { stuck: false, nudge: this.nudgeDir };
    if (V.dist(me.pos, this.watchRef) > 0.6) {
      this.watchRef = { ...me.pos };
      this.watchTick = tick;
      this.watchLevel = 0;
      return { stuck: false, nudge: null };
    }
    if (tick - this.watchTick < 40) return { stuck: false, nudge: null };
    this.watchTick = tick;
    this.watchLevel++;
    this.stats.stuckRepaths++;
    this.avoidSpots.push({ x: me.pos.x + move.x * 0.8, y: me.pos.y + move.y * 0.8, r: 1.4, cost: 3, until: tick + 240 });
    this.path = null;
    const perp = { x: -move.y, y: move.x };
    const sgn = this.watchLevel % 2 === 0 ? 1 : -1;
    let nd = V.norm(V.add(V.scale(perp, sgn), V.scale(move, -0.4)));
    if (this.nav.clearanceAt(me.pos.x + nd.x * 0.6, me.pos.y + nd.y * 0.6) < 0.4) nd = V.scale(nd, -1);
    this.nudgeDir = nd;
    this.nudgeUntil = tick + 14;
    return { stuck: this.watchLevel >= 4, nudge: nd };
  }

  // -------------------------------------------------------------------------
  // Grab skill
  // -------------------------------------------------------------------------

  /**
   * Walk to `spot.stand`, face the anchor and grab exactly `target` (verified with
   * sim.getGrabCandidate before pressing grab).
   */
  private grabSkill(sim: Simulation, g: Goal, target: LootState, spot: GrabSpot, part: 'safe' | 'bankWall', tol: number): { c: Command; status: 'moving' | 'aiming' | 'held' | 'blocked' } {
    const me = this.me(sim);
    if (me.grab && me.grab.targetId === target.id) return { c: cmd({ x: 0, y: 0 }, true), status: 'held' };
    if (me.grab) return { c: cmd({ x: 0, y: 0 }, false), status: 'moving' };
    const dStand = V.dist(me.pos, spot.stand);
    const toAnchor = V.sub(spot.anchor, me.pos);
    const dAnchor = V.len(toAnchor);
    const inReach = dAnchor <= GRAB_REACH - 0.12 && dStand < 0.9;
    if (!inReach && dStand > 0.28) {
      g.aimTicks = 0;
      const m = this.moveTo(sim, spot.stand, 'walk', 0.2, { slow: 0.9 });
      if (m.stuck) return { c: cmd({ x: 0, y: 0 }, false), status: 'blocked' };
      return { c: cmd(m.move, false), status: 'moving' };
    }
    g.aimTicks = (g.aimTicks ?? 0) + 1;
    const aimAng = Math.atan2(toAnchor.y, toAnchor.x);
    const aligned = Math.abs(wrapAngle(me.facing - aimAng)) < 0.06;
    let move: Vec2 = { x: 0, y: 0 };
    if (g.aimTicks > 10 && dAnchor > 0.7) move = V.scale(V.norm(toAnchor), 0.35);
    if (aligned) {
      const cand = sim.getGrabCandidate(this.id);
      if (cand && cand.targetId === target.id && cand.part === part && V.dist(cand.anchorLocal, spot.anchorLocal) <= tol) {
        return { c: cmd({ x: 0, y: 0 }, true, toAnchor), status: 'aiming' };
      }
    }
    if (g.aimTicks > 50) return { c: cmd({ x: 0, y: 0 }, false, toAnchor), status: 'blocked' };
    return { c: cmd(move, false, toAnchor), status: 'aiming' };
  }

  private spotFree(sim: Simulation, p: Vec2, ignoreMate = false): boolean {
    if (this.nav.clearanceAt(p.x, p.y) < 0.44) return false;
    if (!sim.isFree(p, 0.42)) return false;
    if (!ignoreMate) {
      for (const ch of this.mates(sim)) if (V.dist(ch.pos, p) < 0.85 && ch.grab) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Collect / strip
  // -------------------------------------------------------------------------

  private carryDirection(sim: Simulation, l: LootState, g: Goal): Vec2 {
    const tick = sim.state.tick;
    if (g.carryDir && g.carryDirTick !== undefined && tick - g.carryDirTick < 45) return g.carryDir;
    const cls = this.safeClass(l);
    const z = zoneOf(sim.layout, this.team);
    const res = this.nav.findPath(l.pos, z.center, cls, { maxExpand: 25000 });
    let dir = V.norm(V.sub(z.center, l.pos));
    if (res && res.points.length > 1) {
      // first point at least ~1.5 m away from the safe
      let tgt = res.points[res.points.length - 1]!;
      for (const p of res.points) {
        if (V.dist(p, l.pos) > 1.5) {
          tgt = p;
          break;
        }
      }
      dir = V.norm(V.sub(tgt, l.pos));
    }
    g.carryDir = dir;
    g.carryDirTick = tick;
    return dir;
  }

  private chooseSafeSpot(sim: Simulation, l: LootState, g: Goal): GrabSpot | null {
    const dir = this.carryDirection(sim, l, g);
    const me = this.me(sim);
    const spots = safeGrabSpots(l);
    let best: GrabSpot | null = null;
    let bestS = -Infinity;
    for (const s of spots) {
      const k = `f${s.face}`;
      if (g.excluded?.has(k)) continue;
      if (!this.spotFree(sim, s.stand)) continue;
      // anchor reachable from the stand without a wall in between
      if (!sim.lineOfSight(s.stand, V.add(s.anchor, V.scale(s.normal, 0.05)))) continue;
      const score = V.dot(s.normal, dir) * 2 - V.dist(me.pos, s.stand) * 0.04;
      if (score > bestS) {
        bestS = score;
        best = s;
      }
    }
    return best;
  }

  private execCollect(sim: Simulation, g: Goal): Command {
    const l = g.targetId !== null ? sim.getLoot(g.targetId) : undefined;
    const me = this.me(sim);
    const tick = sim.state.tick;
    if (!l || l.recovered) {
      this.endGoal(sim, 'gone');
      return cmd({ x: 0, y: 0 }, false);
    }
    const holding = me.grab !== null && me.grab.targetId === l.id;
    if (!holding) {
      if (this.oppHolding(sim, l.id).length > 0 && !l.anchored) {
        // they grabbed it first: re-decide (intercept candidate)
        this.urgent = true;
      }
      // spot (re)selection
      if (!g.spot || g.spotTick === undefined || tick - g.spotTick > 30 || V.dist(l.pos, g.spotRef ?? l.pos) > 0.4) {
        g.spot = this.chooseSafeSpot(sim, l, g);
        g.spotTick = tick;
        g.spotRef = { ...l.pos };
        g.stallRef = undefined;
        g.stallTick = undefined;
        if (!g.spot) {
          g.excluded = new Set();
          g.spot = this.chooseSafeSpot(sim, l, g);
        }
        if (!g.spot) {
          g.phase = 'approach';
          const m = this.moveTo(sim, l.pos, 'walk', 1.2);
          if (m.stuck || m.arrived) this.endGoal(sim, 'no grab spot', 240);
          return cmd(m.move, false);
        }
      }
      g.phase = 'approach';
      const r = this.grabSkill(sim, g, l, g.spot, 'safe', 0.3);
      if (r.status === 'aiming') g.phase = 'grab';
      if (r.status === 'blocked') {
        g.excluded ??= new Set();
        g.excluded.add(`f${g.spot.face}`);
        g.spot = null;
        g.spotFails = (g.spotFails ?? 0) + 1;
        g.aimTicks = 0;
        if (g.spotFails >= 4) this.endGoal(sim, 'grab failed', 300);
      }
      return r.c;
    }
    // --- holding it ---
    if (l.anchored) {
      g.phase = 'strain';
      const dir = this.carryDirection(sim, l, g);
      return cmd(dir, true);
    }
    const zone = zoneOBB(sim.layout, this.team);
    const obb = sim.lootOBB(l.id);
    if (obbInside(obb, zone, -0.1)) {
      g.phase = 'recover';
      // stay put; nudge deeper if close to the edge
      const lc = V.toLocal(l.pos, zone.center, zone.angle);
      const margin = Math.min(zone.half.x - Math.abs(lc.x), zone.half.y - Math.abs(lc.y));
      if (margin < 1.2) {
        const m = this.moveTo(sim, zone.center, this.safeClass(l), 0.6, { carrying: true });
        return cmd(V.scale(m.move, 0.5), true);
      }
      return cmd({ x: 0, y: 0 }, true);
    }
    g.phase = 'carry';
    return this.carryStep(sim, g, l, zone);
  }

  private carryStep(sim: Simulation, g: Goal, l: LootState, zone: OBB): Command {
    const me = this.me(sim);
    const tick = sim.state.tick;
    const cls = this.safeClass(l);
    // regrab when pushing backwards for long (jackknife)
    if (g.wiggleUntil !== undefined && tick < g.wiggleUntil) return cmd(g.wiggleDir!, true);
    const goal = zone.center;
    const m = this.moveTo(sim, goal, cls, 0.5, { carrying: true, slow: 1.2 });
    let move = m.move;
    // snag / stall detection on the carried object
    if (!g.stallRef || g.stallTick === undefined) {
      g.stallRef = { ...l.pos };
      g.stallTick = tick;
    }
    if (V.dist(l.pos, g.stallRef) > 0.5) {
      g.stallRef = { ...l.pos };
      g.stallTick = tick;
    } else if (tick - g.stallTick > 50 && V.len(move) > 0.3) {
      g.stalls = (g.stalls ?? 0) + 1;
      g.stallTick = tick;
      this.path = null;
      if (g.stalls % 3 === 0) {
        // regrab from another side
        g.regrabs = (g.regrabs ?? 0) + 1;
        g.excluded = new Set([`f${this.heldFace(sim, l)}`]);
        g.spot = null;
        if (g.regrabs > 3) {
          this.endGoal(sim, 'carry stalled', 360);
          return cmd({ x: 0, y: 0 }, false);
        }
        return cmd({ x: 0, y: 0 }, false);
      }
      // wiggle: step sideways relative to the pull line, then continue
      const anchorDir = V.norm(V.sub(l.pos, me.pos));
      const perp = { x: -anchorDir.y, y: anchorDir.x };
      const sgn = g.stalls % 2 === 0 ? 1 : -1;
      g.wiggleDir = V.norm(V.add(V.scale(perp, sgn), V.scale(anchorDir, 0.5)));
      g.wiggleUntil = tick + 18;
      return cmd(g.wiggleDir, true);
    }
    // jackknife: path direction points back through the safe for long -> regrab
    const toSafe = V.norm(V.sub(l.pos, me.pos));
    if (V.dot(V.norm(move), toSafe) > 0.75) {
      g.badFaceTicks = (g.badFaceTicks ?? 0) + 1;
      if (g.badFaceTicks > 50) {
        g.badFaceTicks = 0;
        g.regrabs = (g.regrabs ?? 0) + 1;
        g.excluded = new Set([`f${this.heldFace(sim, l)}`]);
        g.spot = null;
        g.carryDir = undefined;
        if (g.regrabs > 4) {
          this.endGoal(sim, 'jackknife', 300);
        }
        return cmd({ x: 0, y: 0 }, false);
      }
    } else g.badFaceTicks = 0;
    // carry boost on straight stretches when no threat is near
    let dash = false;
    if (me.dashCooldown === 0 && this.path && this.rngCheck(this.P.carryBoost, 20)) {
      const p = this.path;
      const nxt = p.pts[p.idx];
      if (nxt && V.dist(me.pos, nxt) > 5 && V.dot(V.norm(V.sub(nxt, me.pos)), V.norm(move)) > 0.95 && !this.threatNear(sim, me.pos, 10)) dash = true;
    }
    return cmd(move, true, null, dash);
  }

  /** Throttled probability check (one roll per `period` ticks). */
  private rngCheck(p: number, period: number): boolean {
    if (p >= 1) return true;
    if (p <= 0) return false;
    this.rollTick = (this.rollTick ?? 0) + 1;
    if (this.rollTick % period !== 0) return false;
    return this.rng() < p;
  }
  private rollTick = 0;

  /** Face index (0:+x 1:-x 2:+y 3:-y) of an anchor in a safe's local frame. */
  private heldFace(sim: Simulation, l: LootState): number {
    const g = this.me(sim).grab;
    if (!g || g.targetId !== l.id) return -1;
    const a = g.anchorLocal;
    if (Math.abs(a.x) / l.half.x >= Math.abs(a.y) / l.half.y) return a.x >= 0 ? 0 : 1;
    return a.y >= 0 ? 2 : 3;
  }

  private threatNear(sim: Simulation, p: Vec2, r: number): boolean {
    for (const o of this.opponents(sim)) {
      if (!o.last || o.age > 120) continue;
      if (V.dist(o.last.pos, p) < r) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Bank haul / assist
  // -------------------------------------------------------------------------

  /** Desired bank motion direction along the team route; null once inside the zone. */
  private haulDirection(sim: Simulation, bank: LootState, route: Vec2[]): { dir: Vec2; remaining: number } {
    const total = polylineLength(route);
    const proj = projectOnPolyline(route, bank.pos);
    const remaining = total - proj.s;
    const look = 3.5;
    let target: Vec2;
    if (remaining < look) target = route[route.length - 1]!;
    else target = pointAtArc(route, proj.s + look);
    // pull back toward the route when far off it
    let dir = V.norm(V.sub(target, bank.pos));
    if (proj.dist > 1) dir = V.norm(V.add(dir, V.scale(V.norm(V.sub(proj.point, bank.pos)), Math.min(1, proj.dist / 4))));
    return { dir, remaining: remaining + proj.dist };
  }

  private fenceAhead(sim: Simulation, bank: LootState, dir: Vec2): boolean {
    const perp = { x: -dir.y, y: dir.x };
    for (const f of sim.state.fences) {
      if (f.broken) continue;
      for (const off of [0, 2.8, -2.8]) {
        const o = V.add(bank.pos, V.scale(perp, off));
        const t = rayOBB(o, dir, f, 9);
        if (t !== null) return true;
      }
    }
    return false;
  }

  private bankInZone(sim: Simulation, bank: LootState): boolean {
    return obbInside(sim.lootOBB(bank.id), zoneOBB(sim.layout, this.team), -0.2);
  }

  private execHaul(sim: Simulation, g: Goal): Command {
    const bank = g.targetId !== null ? sim.getLoot(g.targetId) : undefined;
    const me = this.me(sim);
    const tick = sim.state.tick;
    if (!bank || bank.recovered) {
      this.endGoal(sim, 'bank gone');
      return cmd({ x: 0, y: 0 }, false);
    }
    const route = this.routeFor(sim, bank);
    if (!route) {
      this.endGoal(sim, 'no route', 600);
      return cmd({ x: 0, y: 0 }, false);
    }
    const holding = me.grab !== null && me.grab.targetId === bank.id;
    const mates = this.mateHolders(sim, bank.id);
    const human = mates.find((m) => !m.isBot) ?? null;
    if (g.kind === 'assistHaul' && mates.length === 0 && !holding && g.pingId === undefined) {
      // the teammate let go: becomes a regular haul decision
      const otherBotHauling = this.board.otherClaims(this.slot).some((c) => c.key === `haul:${bank.id}`);
      if (!otherBotHauling) {
        this.endGoal(sim, 'mate released');
        return cmd({ x: 0, y: 0 }, false);
      }
    }
    const { dir, remaining } = this.haulDirection(sim, bank, route);
    const inZone = this.bankInZone(sim, bank);
    const fence = this.fenceAhead(sim, bank, dir);
    let mode: 'pull' | 'push' = fence ? 'push' : 'pull';
    if (g.mode && g.modeUntil !== undefined && tick < g.modeUntil) mode = g.mode;
    // guard reaction while hauling (adaptation guardDoors / deeper counter-play)
    if (holding && !bank.anchored) {
      const d = this.intruderCheck(sim, bank);
      if (d) {
        this.log1(sim, `leaves the wall to guard ${bank.id} against ${d.id}`);
        const resume = g.key;
        this.startGoal(sim, this.mk('defendDoor', `defend:${bank.id}`, d.id, g.utility, g.value, 6, { bankId: bank.id, until: tick + 5 * TICK_RATE, chained: true, resumeKey: resume }));
        this.telegraphUntil = -1;
        return cmd({ x: 0, y: 0 }, false);
      }
    }
    if (holding) {
      const face = this.faceOfLocal(me.grab!.anchorLocal);
      const n = V.rot(face.n, bank.angle);
      if (inZone) {
        g.phase = 'recover';
        return cmd({ x: 0, y: 0 }, true);
      }
      if (bank.anchored) {
        g.phase = 'strain';
        // strain: pull straight away from the wall (any |move| >= 0.5 counts)
        if (human && V.len(human.moveIntent) > 0.3) return cmd(V.norm(human.moveIntent), true);
        return cmd(n, true);
      }
      g.phase = 'haul';
      const score = mode === 'pull' ? V.dot(n, dir) : -V.dot(n, dir);
      if (score < 0.3) g.badFaceTicks = (g.badFaceTicks ?? 0) + 1;
      else g.badFaceTicks = 0;
      const limit = score < -0.1 ? 25 : 110;
      if ((g.badFaceTicks ?? 0) > limit && !human) {
        g.badFaceTicks = 0;
        g.spot = null;
        g.regrabs = (g.regrabs ?? 0) + 1;
        g.mode = mode;
        g.modeUntil = tick + 360;
        this.log1(sim, `regrab bank ${bank.id} (${mode}, face score ${score.toFixed(2)})`);
        return cmd({ x: 0, y: 0 }, false);
      }
      // a human co-hauler leads: pull exactly where they pull (never fight their direction)
      if (human) {
        const hm = human.moveIntent;
        if (V.len(hm) > 0.3) return cmd(V.norm(hm), true);
        return cmd({ x: 0, y: 0 }, true);
      }
      let move: Vec2;
      if (mode === 'pull') {
        // pull along dir; keep myself ahead of the bank center on the dir line
        const lead = V.add(bank.pos, V.scale(dir, 5.2));
        const corr = V.clampLen(V.sub(lead, me.pos), 1.5);
        move = V.norm(V.add(dir, V.scale(corr, 0.35)));
      } else {
        // push: stick within ~65 deg of the push line (holder -> anchor), steering toward dir
        const anchor = V.toWorld(me.grab!.anchorLocal, bank.pos, bank.angle);
        const pushLine = V.norm(V.sub(anchor, me.pos));
        const a = Math.atan2(pushLine.y, pushLine.x);
        let b = Math.atan2(dir.y, dir.x);
        let dA = wrapAngle(b - a);
        const lim = (65 * Math.PI) / 180;
        if (dA > lim) dA = lim;
        else if (dA < -lim) dA = -lim;
        b = a + dA;
        move = { x: Math.cos(b), y: Math.sin(b) };
      }
      // slow down at the end of the route
      if (remaining < 3) move = V.scale(move, Math.max(0.45, remaining / 3));
      // stall detection
      if (!g.stallRef || g.stallTick === undefined) {
        g.stallRef = { ...bank.pos };
        g.stallTick = tick;
      }
      if (V.dist(bank.pos, g.stallRef) > 0.35) {
        g.stallRef = { ...bank.pos };
        g.stallTick = tick;
      } else if (tick - g.stallTick > 120) {
        g.stalls = (g.stalls ?? 0) + 1;
        g.stallTick = tick;
        this.log1(sim, `bank ${bank.id} stalled (${g.stalls})`);
        if (g.stalls >= 4) {
          this.endGoal(sim, 'bank stuck', 900);
          return cmd({ x: 0, y: 0 }, false);
        }
        // switch mode and regrab
        g.mode = mode === 'pull' ? 'push' : 'pull';
        g.modeUntil = tick + 420;
        g.spot = null;
        return cmd({ x: 0, y: 0 }, false);
      }
      // carry boost on long straight stretches
      let dash = false;
      if (me.dashCooldown === 0 && remaining > 6 && this.rngCheck(this.P.carryBoost * 0.6, 30) && !this.threatNear(sim, me.pos, 9)) dash = true;
      return cmd(move, true, null, dash);
    }
    // --- approach a face ---
    if (inZone && !bank.anchored) {
      g.phase = 'guard';
      return this.guardBank(sim, bank);
    }
    if (!g.spot || g.spotTick === undefined || tick - g.spotTick > 30) {
      g.spot = this.chooseBankSpot(sim, g, bank, dir, mode, mates);
      g.spotTick = tick;
      g.aimTicks = 0;
      if (!g.spot) {
        g.phase = 'approach';
        const m = this.moveTo(sim, bank.pos, 'walk', 5.5);
        if (m.arrived || m.stuck) {
          g.spotFails = (g.spotFails ?? 0) + 1;
          if (g.spotFails > 60) this.endGoal(sim, 'no bank spot', 300);
        }
        return cmd(m.move, false);
      }
    }
    g.phase = 'approach';
    const r = this.grabSkill(sim, g, bank, g.spot, 'bankWall', 0.6);
    if (r.status === 'aiming') g.phase = 'grab';
    if (r.status === 'blocked') {
      g.excluded ??= new Set();
      g.excluded.add(g.spotKey ?? '');
      g.spot = null;
      g.spotFails = (g.spotFails ?? 0) + 1;
      if (g.spotFails >= 6) this.endGoal(sim, 'bank grab failed', 300);
    }
    return r.c;
  }

  private faceOfLocal(a: Vec2): { n: Vec2; face: number } {
    const hx = BANK_MODEL.half.x;
    const hy = BANK_MODEL.half.y;
    if (Math.abs(Math.abs(a.x) - hx) < 0.05) return a.x > 0 ? { n: { x: 1, y: 0 }, face: 0 } : { n: { x: -1, y: 0 }, face: 1 };
    if (Math.abs(Math.abs(a.y) - hy) < 0.05) return a.y > 0 ? { n: { x: 0, y: 1 }, face: 2 } : { n: { x: 0, y: -1 }, face: 3 };
    // fall back: the larger normalized coordinate
    return Math.abs(a.x) / hx > Math.abs(a.y) / hy
      ? a.x > 0
        ? { n: { x: 1, y: 0 }, face: 0 }
        : { n: { x: -1, y: 0 }, face: 1 }
      : a.y > 0
        ? { n: { x: 0, y: 1 }, face: 2 }
        : { n: { x: 0, y: -1 }, face: 3 };
  }

  private chooseBankSpot(sim: Simulation, g: Goal, bank: LootState, dir: Vec2, mode: 'pull' | 'push', mates: CharacterState[]): GrabSpot | null {
    const me = this.me(sim);
    const spots = bankGrabSpots(bank);
    // faces held by mates
    const mateFaces = new Map<number, Vec2[]>();
    for (const m of mates) {
      if (!m.grab) continue;
      const f = this.faceOfLocal(m.grab.anchorLocal);
      const arr = mateFaces.get(f.face) ?? [];
      arr.push(m.grab.anchorLocal);
      mateFaces.set(f.face, arr);
    }
    const human = mates.find((m) => !m.isBot);
    let best: (GrabSpot & { slotKey: string }) | null = null;
    let bestS = -Infinity;
    for (const s of spots) {
      if (g.excluded?.has(s.slotKey)) continue;
      const onMateFace = mateFaces.get(s.face);
      if (onMateFace) {
        // pair anchors next to the mate (never the same spot)
        if (s.solo && s.face <= 1) continue;
        if (onMateFace.some((a) => V.dist(a, s.anchorLocal) < 1.2)) continue;
      } else if (!s.solo && mates.length === 0) continue;
      if (!this.spotFree(sim, s.stand)) continue;
      if (!sim.lineOfSight(s.stand, V.add(s.anchor, V.scale(s.normal, 0.05)))) continue;
      let score = mode === 'pull' ? V.dot(s.normal, dir) : -V.dot(s.normal, dir);
      if (s.face <= 1) score += 0.08; // side walls: anchor on the center line
      if (onMateFace) score += human ? 1.5 : 0.6; // same face as the teammate -> same direction
      score -= V.dist(me.pos, s.stand) * 0.015;
      if (score > bestS) {
        bestS = score;
        best = s;
      }
    }
    if (best && !human && bestS < -0.2 && mates.length === 0) return best; // still better than nothing
    if (best) g.spotKey = best.slotKey;
    return best;
  }

  /** Opponent inside my hauled bank or at its door: guard reaction (adaptation guardDoors). */
  private intruderCheck(sim: Simulation, bank: LootState): OpponentView | null {
    if (bank.loadedSafes.length === 0) return null;
    const guard = this.adaptation?.kind === 'guardDoors';
    // 통큰이's readable weakness: it keeps hauling unless adapted (doc §11 table)
    let p = guard ? 0.9 : this.personality === 'tongkeun' ? 0 : this.P.counterDepth >= 2 ? 0.25 : 0;
    if (p <= 0) return null;
    p *= this.P.threatResponse;
    if (this.me(sim).dashCooldown > 0 && !guard) return null;
    for (const o of this.opponents(sim)) {
      if (!o.visible || !o.last || o.last.knockedDown) continue;
      const inside = o.last.onFloorOf === bank.id;
      let nearDoor = false;
      for (const d of bankDoors(bank)) if (V.dist(o.last.pos, V.add(d.center, V.scale(d.normal, 1))) < 2.6) nearDoor = true;
      if (!inside && !nearDoor) continue;
      if (this.rngCheck(p, 15)) return o;
    }
    return null;
  }

  private guardBank(sim: Simulation, bank: LootState): Command {
    const me = this.me(sim);
    const threat = this.nearestThreat(this.opponents(sim), bank.pos, 10);
    const doors = bankDoors(bank);
    let door = doors[0]!;
    const ref = threat?.last?.pos ?? me.pos;
    for (const d of doors) if (V.dist(d.center, ref) < V.dist(door.center, ref)) door = d;
    const spot = V.add(door.center, V.scale(door.normal, 1.0));
    if (threat && threat.visible && threat.last) {
      const dc = this.dashAt(sim, threat, 'guard');
      if (dc) return dc;
    }
    const m = this.moveTo(sim, spot, 'walk', 0.4);
    return cmd(m.move, false, door.normal);
  }

  // -------------------------------------------------------------------------
  // Dash attacks
  // -------------------------------------------------------------------------

  /** Dash at an opponent if the hit would land (cone/cooldown/lead); returns the command or null. */
  private dashAt(sim: Simulation, o: OpponentView, why: string): Command | null {
    const me = this.me(sim);
    if (me.grab || me.dashCooldown > 0 || !o.visible || !o.last) return null;
    if (o.last.knockedDown || o.last.protectedNow) return null;
    const rel = V.sub(o.last.pos, me.pos);
    const d = V.len(rel);
    if (d > 3.4 || d < 0.3) return null;
    const tHit = Math.max(0, d - 0.95) / DASH.speed;
    const q = this.P.leadQuality;
    const pred = V.add(o.last.pos, V.scale(o.last.vel, tHit * q));
    let dir = V.norm(V.sub(pred, me.pos));
    if (q < 1) dir = V.rot(dir, (this.rng() - 0.5) * (1 - q) * 0.5);
    if (V.dist(pred, me.pos) > 3.1) return null;
    // a teammate in the cone would take the hit instead
    for (const m of this.mates(sim)) {
      const r = V.sub(m.pos, me.pos);
      if (V.len(r) < 3.2 && V.dot(V.norm(r), dir) > 0.5 && V.len(r) < d) return null;
    }
    if (!this.rngCheck(Math.min(1, this.P.dashUse * (0.6 + 0.6 * this.W.aggression)), 8)) return null;
    this.log1(sim, `dash at ${o.id} (${why}, d=${d.toFixed(2)})`);
    return cmd(dir, false, dir, true);
  }

  // -------------------------------------------------------------------------
  // Intercept / defend / escort / ambush / move goals
  // -------------------------------------------------------------------------

  private execIntercept(sim: Simulation, g: Goal): Command {
    const me = this.me(sim);
    const tick = sim.state.tick;
    if (me.grab) return cmd({ x: 0, y: 0 }, false);
    // after a successful knockdown: pick up what they dropped
    if (this.knockedVictim === g.targetId && this.lastSeenHolding(g.targetId!) !== null) {
      const lootId = this.lastSeenHolding(g.targetId!)!;
      this.knockedVictim = null;
      const l = sim.getLoot(lootId);
      if (l && !l.recovered) {
        this.startGoal(sim, this.mk(l.kind === 'bank' ? 'haulBank' : 'collectSafe', l.kind === 'bank' ? `haul:${l.id}` : `collect:${l.id}`, l.id, g.utility, l.baseValue, 10, { chained: true, bankId: l.kind === 'bank' ? l.id : null }));
        return cmd({ x: 0, y: 0 }, false);
      }
    }
    const views = this.opponents(sim);
    const o = views.find((v) => v.id === g.targetId);
    if (!o || !o.last || o.age > 75 || tick - g.started > 14 * TICK_RATE) {
      this.endGoal(sim, 'lost target', 120);
      return cmd({ x: 0, y: 0 }, false);
    }
    if (o.last.holdingId === null && o.visible) {
      this.endGoal(sim, 'target dropped loot');
      return cmd({ x: 0, y: 0 }, false);
    }
    g.phase = 'chase';
    if (o.visible) {
      const dc = this.dashAt(sim, o, 'intercept');
      if (dc) return dc;
    }
    // chase a lead point
    const d = V.dist(me.pos, o.last.pos);
    const lead = Math.min(1.2, d / 6) * this.P.leadQuality;
    const tgt = V.add(o.last.pos, V.scale(o.last.vel, lead));
    if (d < 6 && this.nav.segmentClear(me.pos, tgt, 'walk', 0)) {
      const dir = V.norm(V.sub(tgt, me.pos));
      return cmd(dir, false, null);
    }
    const m = this.moveTo(sim, tgt, 'walk', 0.8);
    return cmd(m.move, false);
  }

  private lastSeenHolding(oppId: EntityId): EntityId | null {
    const s = this.perception.latest(oppId);
    return s ? s.holdingId : null;
  }

  private execDefend(sim: Simulation, g: Goal): Command {
    const tick = sim.state.tick;
    const bank = g.bankId !== null ? sim.getLoot(g.bankId) : undefined;
    if (!bank || bank.recovered || (g.until !== undefined && tick > g.until)) {
      const resume = g.resumeKey;
      this.endGoal(sim, 'defend over');
      if (resume && bank && !bank.recovered) this.nextDecision = tick; // re-evaluates (haul usually wins again)
      return cmd({ x: 0, y: 0 }, false);
    }
    const me = this.me(sim);
    if (me.grab) return cmd({ x: 0, y: 0 }, false);
    g.phase = 'guard';
    // extend while a threat is near
    const threat = this.nearestThreat(this.opponents(sim), bank.pos, 9);
    if (threat && g.until !== undefined && g.until - tick < 60) g.until = tick + 90;
    return this.guardBank(sim, bank);
  }

  private execEscort(sim: Simulation, g: Goal): Command {
    const tick = sim.state.tick;
    const mate = g.mateId !== undefined ? sim.getCharacter(g.mateId) : undefined;
    if (!mate || !mate.grab || (g.until !== undefined && tick > g.until)) {
      this.endGoal(sim, 'escort over');
      return cmd({ x: 0, y: 0 }, false);
    }
    const me = this.me(sim);
    if (me.grab) return cmd({ x: 0, y: 0 }, false);
    const views = this.opponents(sim);
    const o = views.find((v) => v.id === g.targetId);
    g.phase = 'escort';
    if (o && o.visible && o.last) {
      const dc = this.dashAt(sim, o, 'escort');
      if (dc) return dc;
      // stand between the mate and the threat
      const between = V.add(mate.pos, V.scale(V.norm(V.sub(o.last.pos, mate.pos)), 1.8));
      const m = this.moveTo(sim, between, 'walk', 0.4);
      return cmd(m.move, false, V.sub(o.last.pos, me.pos));
    }
    const m = this.moveTo(sim, mate.pos, 'walk', 2.2);
    return cmd(this.yieldToMates(sim, m.move), false);
  }

  private execAmbush(sim: Simulation, g: Goal): Command {
    const me = this.me(sim);
    const tick = sim.state.tick;
    if (me.grab) return cmd({ x: 0, y: 0 }, false);
    const pos = g.pos!;
    // a carrier at the chokepoint: intercept right away (no telegraph — we were waiting for it)
    for (const o of this.opponents(sim)) {
      if (!o.visible || !o.last || o.last.holdingId === null) continue;
      const l = sim.getLoot(o.last.holdingId);
      if (!l || l.kind !== 'smallSafe') continue;
      if (V.dist(o.last.pos, pos) > 9) continue;
      this.startGoal(sim, this.mk('intercept', `intercept:${o.id}`, o.id, g.utility * 2, l.baseValue, 4, { chained: true, pos: { ...o.last.pos } }));
      return this.execIntercept(sim, this.goal!);
    }
    const m = this.moveTo(sim, pos, 'walk', 1.0);
    if (m.arrived) {
      g.phase = 'wait';
      g.waitStart ??= tick;
      if (tick - g.waitStart > 14 * TICK_RATE) this.endGoal(sim, 'ambush timeout', 6 * TICK_RATE);
      // watch toward the bot team's opponents' side (their zone)
      const oz = zoneOf(sim.layout, (1 - this.team) as TeamId).center;
      return cmd({ x: 0, y: 0 }, false, V.sub(oz, me.pos));
    }
    g.phase = 'travel';
    return cmd(m.move, false);
  }

  private execMoveGoal(sim: Simulation, g: Goal): Command {
    const me = this.me(sim);
    const tick = sim.state.tick;
    if (me.grab) return cmd({ x: 0, y: 0 }, false);
    const m = this.moveTo(sim, g.pos!, 'walk', 1.0);
    g.phase = 'travel';
    if (m.arrived || m.stuck || (g.until !== undefined && tick > g.until)) {
      this.endGoal(sim, m.arrived ? 'arrived' : 'stuck', g.kind === 'reposition' ? 180 : 600);
    }
    return cmd(m.move, false);
  }

  // -------------------------------------------------------------------------
  // Favourite routes
  // -------------------------------------------------------------------------

  private markTrail(p: Vec2): void {
    const t = this.trail!;
    const nav = this.nav;
    const ci = Math.round(p.x / NAV_CELL);
    const cj = Math.round(p.y / NAV_CELL);
    const r = 2;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= nav.nx || j >= nav.ny) continue;
        const k = j * nav.nx + i;
        const v = this.W.routeReuse * (1 - Math.hypot(di, dj) / (r + 1));
        if (v > t[k]!) t[k] = v;
      }
    }
  }
}
