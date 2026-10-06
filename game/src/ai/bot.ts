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
  STAND_OFF,
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
  fineBest?: number;
  fineTick?: number;
  fineSeen?: number;
  yielding?: boolean;
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
  phaseTick?: number;
  phaseRef?: Vec2;
  patrol?: number;
  tugTicks?: number;
  tugPatience?: number;
  stallLimit?: number;
  /** Load this safe onto that bank's floor instead of recovering it (욕심내서 하나 더). */
  loadInto?: EntityId;
  forcedReleases?: number;
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
  private proxyPinged: EntityId | null = null;
  /** Tick at which a pending urgent re-plan is taken (reaction delay), -1 = none. */
  private urgentAt = -1;
  private travelDash = false;
  /** Pressed grab last tick without holding anything (yet). */
  private lastGrabCmd = false;
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
    this.tasteSeed = (opts.seed * 2654435761 + opts.slot * 40503) >>> 0;
    // per-match style (seeded, constant for the whole match): the same rival does not replay
    // the exact same plan every game, without changing what it is (all within ±12 %)
    const srng = createRng((this.tasteSeed ^ 0x5bd1e995) >>> 0);
    const v = (): number => 0.78 + 0.44 * srng();
    this.style = { small: v(), large: v(), bank: v(), strip: v(), intercept: v() };
    this.board = TeamBoard.for(sim, this.team);
    this.nav = this.board.nav;
    if (this.isProxy) {
      this.perception = new TeamPerception(sim, this.team);
    } else {
      this.board.register(this.slot);
      this.perception = this.board.perception;
    }
    if (this.W.routeReuse > 0) this.trail = new Float32Array(this.nav.n);
    // warm the shared fields now (match loading) so the first ticks have no hitch
    for (const t of [0, 1] as TeamId[]) {
      if (!sim.layout.zones.some((z) => z.team === t)) continue;
      this.nav.zoneField(t, 'small', sim.state.tick);
      this.nav.zoneField(t, 'large', sim.state.tick);
    }
    this.walkDist(sim, me.pos);
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
    // events are noticed after the reaction delay (a novice hesitates a moment after finishing
    // a task or getting up; a challenge bot moves on almost at once)
    if (this.urgent) {
      if (this.urgentAt < 0) this.urgentAt = tick + Math.round(this.P.reactionDelay * 0.8);
      if (tick >= this.urgentAt || !this.goal) {
        if (tick >= this.urgentAt) this.urgentAt = -1;
      }
    }
    if ((this.urgent && this.urgentAt < 0) || tick >= this.nextDecision) {
      this.urgentAt = -1;
      this.decide(sim);
    }
    let c: Command;
    this.travelDash = false;
    if (this.goal && tick < this.telegraphUntil) c = this.telegraphCommand(sim, this.goal);
    else c = this.execute(sim);
    if (this.travelDash && !c.dash && !c.grab && V.len(c.move) > 0.9) c = { ...c, dash: true, aim: null };
    // level dash: only a rising edge triggers
    if (c.dash && this.prevDash) c = { ...c, dash: false };
    if (c.dash) {
      if (me.grab) this.stats.boosts++;
      else this.stats.dashes++;
    }
    this.prevDash = c.dash;
    this.lastGrabCmd = c.grab && !me.grab;
    // scripted human stand-in: asks its teammate for help when it starts on a bank (같이 잡자)
    if (this.isProxy && this.goal && this.goal.kind === 'haulBank' && this.goal.targetId !== null && this.proxyPinged !== this.goal.targetId && this.goal.phase === 'approach') {
      const b = sim.getLoot(this.goal.targetId);
      if (b && this.rng() < 0.5) c = { ...c, ping: { pos: { ...b.pos }, targetId: b.id } };
      this.proxyPinged = this.goal.targetId;
    }
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

  /**
   * Remaining time a plan can count on. Normal/challenge bots anticipate the final countdown:
   * once one bank body is recovered and the other is on its way (moving, public), the match
   * will end ~30 s after that second recovery (doc §8 마지막 30초).
   */
  private effectiveSecondsLeft(sim: Simulation): number {
    const left = this.secondsLeft(sim);
    const st = sim.state;
    if (this.P.counterDepth < 1 || st.finalCountdown || st.banksRecovered !== 1) return left;
    for (const b of st.loot) {
      if (b.kind !== 'bank' || b.recovered || b.anchored) continue;
      if (Math.hypot(b.vel.x, b.vel.y) < 0.3 && !b.recovery) continue;
      // who is hauling it is not needed: estimate the nearer of the two routes to finish
      let eta = Infinity;
      for (const t of [0, 1] as TeamId[]) {
        if (b.recovery && b.recovery.team === t) eta = Math.min(eta, (sim.rules.recoveryTicks - b.recovery.ticks) / TICK_RATE);
        const route = this.routeFor(sim, b, t);
        if (!route) continue;
        const proj = projectOnPolyline(route, b.pos);
        const rem = Math.max(0, polylineLength(route) - proj.s) + proj.dist;
        // only a bank that is actually near its route is "on its way" there
        if (proj.dist < 4) eta = Math.min(eta, rem / 1.1 + DWELL);
      }
      if (Number.isFinite(eta)) return Math.min(left, eta + sim.rules.finalCountdownTicks / TICK_RATE);
    }
    return left;
  }

  private secondsLeft(sim: Simulation): number {
    const st = sim.state;
    if (!Number.isFinite(st.endTick)) return 1e6;
    return Math.max(0, (st.endTick - st.tick) / TICK_RATE);
  }

  private routeFor(sim: Simulation, bank: LootState, team: TeamId = this.team): Vec2[] | null {
    const banks = sim.state.loot.filter((l) => l.kind === 'bank');
    const bankIndex = banks.findIndex((b) => b.id === bank.id);
    const r = sim.layout.bankRoutes.find((rr) => rr.bankIndex === bankIndex && rr.team === team);
    return r ? r.points : null;
  }

  /** Seconds until the other team could finish recovering a bank they are hauling (estimate). */
  private theirBankEta(sim: Simulation, bank: LootState): number {
    const opp = (1 - this.team) as TeamId;
    if (bank.recovery && bank.recovery.team === opp) return (sim.rules.recoveryTicks - bank.recovery.ticks) / TICK_RATE;
    const route = this.routeFor(sim, bank, opp);
    if (!route) return 60;
    const proj = projectOnPolyline(route, bank.pos);
    const remaining = Math.max(0, polylineLength(route) - proj.s) + proj.dist;
    return remaining / 1.2 + DWELL;
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
          if (e.kind === 'bank' && e.team !== this.team) this.oppBankHauls.add(e.lootId);
          break;
        case 'bankBodyRecovered':
          this.urgent = true;
          break;
        case 'finalCountdown':
          this.urgent = true;
          this.finalPending = true;
          break;
        case 'release':
          if (e.charId === this.id && e.forced) {
            this.urgent = true;
            if (g) g.forcedReleases = (g.forcedReleases ?? 0) + 1;
          }
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
  /** Bank stand spots chosen by the bots of this sim (slot -> spot), shared via a static map. */
  private get claimedSpots(): Map<number, Vec2> {
    let m = Bot.spotBoard.get(this.board);
    if (!m) Bot.spotBoard.set(this.board, (m = new Map()));
    return m;
  }
  private static readonly spotBoard = new WeakMap<TeamBoard, Map<number, Vec2>>();
  /** Last ambush watch shift (adaptation ambushChoke). */
  private lastAmbushTick = -1e9;
  /** Endgame posture (decided once in the last ~40 s). */
  private posture: 'bold' | 'steady' | null = null;
  /** Goal key -> tick it was last switched away from (thrash damping). */
  private readonly abandoned = new Map<string, number>();
  /** Current 욕심 plan (bank to load, safe to put on it). */
  private loadPlan: { bank: EntityId; safe: EntityId } | null = null;
  /** Banks this bot already loaded an extra safe onto (once per bank). */
  private readonly loadedBanks = new Set<EntityId>();
  /** Banks the other team has been seen hauling or has recovered (public in-match observation). */
  private readonly oppBankHauls = new Set<EntityId>();
  private knockedVictim: EntityId | null = null;

  // =========================================================================
  // Decision making
  // =========================================================================

  /**
   * Scripted task for tests and the tutorial (game flow): pin one goal — collect a safe (to the
   * zone), haul a bank, or walk to a point — until it completes or fails, then resume normal
   * decisions. Pass null to clear. Same motor skills and rules as regular play.
   */
  assignTask(sim: Simulation, task: { kind: 'collect' | 'haul'; targetId: EntityId } | { kind: 'goto'; pos: Vec2 } | null): void {
    if (!task) {
      this.pinned = false;
      this.endGoal(sim, 'task cleared');
      return;
    }
    let g: Goal;
    if (task.kind === 'goto') g = this.mk('followPing', `task:goto`, null, 1e6, 0, 10, { pos: { ...task.pos }, chained: true, until: sim.state.tick + 120 * TICK_RATE });
    else if (task.kind === 'collect') {
      const l = sim.getLoot(task.targetId);
      const strip = !!l && l.floorOf !== null;
      g = this.mk(strip ? 'stripBank' : 'collectSafe', `collect:${task.targetId}`, task.targetId, 1e6, l?.baseValue ?? 0, 30, { chained: true, strip, bankId: l?.floorOf ?? null });
    } else g = this.mk('haulBank', `haul:${task.targetId}`, task.targetId, 1e6, 0, 60, { chained: true, bankId: task.targetId });
    this.pinned = true;
    this.startGoal(sim, g);
  }
  private pinned = false;

  private decide(sim: Simulation): void {
    const tick = sim.state.tick;
    const wasUrgent = this.urgent;
    this.urgent = false;
    this.nextDecision = tick + this.P.decisionInterval + Math.floor(this.rng() * 6);
    this.stats.decisions++;
    if (this.pinned) {
      if (this.goal) return;
      this.pinned = false;
    }
    const cands = this.candidates(sim);
    // choice quality: noisy self-estimates (a novice misjudges; a challenge bot does not)
    if (this.P.estimateNoise > 0) {
      for (const c of cands) {
        if (c.kind === 'idle' || c.pingId !== undefined) continue;
        c.utility *= Math.max(0.2, 1 + this.P.estimateNoise * (this.rng() + this.rng() + this.rng() - 1.5) * 1.4);
      }
    }
    const cur = this.goal;
    let curCand = cur ? cands.find((c) => c.key === cur.key) ?? null : null;
    // chained follow-ups that are not regular candidates (escort/defend in progress) keep their own utility
    if (cur && !curCand && cur.until !== undefined && tick < cur.until && this.goalStillValid(sim, cur)) curCand = cur;
    // a human teammate's request (ping) stays the priority until it is done or impossible
    if (cur && cur.pingId !== undefined && cur.until !== undefined && tick < cur.until) {
      if (curCand) curCand.utility = Math.max(curCand.utility, cur.utility);
      else if (cur.kind === 'followPing') curCand = cur;
    }
    cands.sort((a, b) => b.utility - a.utility || (a.key < b.key ? -1 : 1));
    let pick: Goal | null = cands[0] ?? null;
    // a human teammate's request is never second-guessed by choice noise
    const requested = pick !== null && pick.pingId !== undefined;
    // near-ties are broken at random (no quality loss: these options are equally good)
    if (pick && !requested && (!cur || pick.key !== cur.key)) {
      const near = cands.filter((c) => c.kind !== 'idle' && c.utility >= pick!.utility * 0.94);
      if (near.length > 1) pick = near[Math.floor(this.rng() * near.length)]!;
    }
    if (pick && !requested && this.rng() > this.P.bestChoiceProb) {
      const decent = cands.filter((c) => c !== pick && c.utility >= pick!.utility * this.P.decentRatio && c.kind !== 'idle');
      if (decent.length) pick = decent[Math.floor(this.rng() * decent.length)]!;
    }
    const final = this.finalPending;
    this.finalPending = false;
    if (curCand && pick && curCand.key !== pick.key) {
      const holding = this.me(sim).grab !== null && (this.me(sim).grab!.targetId === cur!.targetId);
      let hyst = 1.15 + this.W.commitment * 0.4 + (holding ? 0.25 : 0);
      // minimum commitment: a fresh goal is not dropped for a slightly better idea
      if (cur && tick - cur.started < 90 && !wasUrgent) hyst += 0.6;
      if (curCand.utility * hyst >= pick.utility) pick = curCand;
    }
    // switching back to something just abandoned needs a clearly better reason
    if (pick && cur && pick.key !== cur.key) {
      const back = this.abandoned.get(pick.key);
      if (back !== undefined && tick - back < 4 * TICK_RATE && curCand && pick.utility < curCand.utility * 1.8) pick = curCand;
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
    if (prev && prev.key !== g.key) this.abandoned.set(prev.key, tick);
    this.claimedSpots.delete(this.slot);
    g.started = tick;
    g.phase = 'start';
    this.goal = g;
    this.path = null;
    this.stats.switches++;
    this.stats.goalsByKind[g.kind] = (this.stats.goalsByKind[g.kind] ?? 0) + 1;
    if (!this.isProxy) this.board.setClaim(this.slot, g.key, g.targetId, tick);
    if (g.loadInto !== undefined && g.targetId !== null) {
      this.loadPlan = { bank: g.loadInto, safe: g.targetId };
      this.log1(sim, `욕심: loads safe ${g.targetId} onto bank ${g.loadInto} before hauling`);
    } else if (g.kind !== 'haulBank') this.loadPlan = null;
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
    this.claimedSpots.delete(this.slot);
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
    const stale = this.walkField !== null && (V.dist(me.pos, this.walkOrigin) > 4 || tick - this.walkTick > 180);
    if (!this.walkField || (stale && this.nav.fieldsThisTick() < 1)) {
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
    const left = this.effectiveSecondsLeft(sim);
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
      if (this.goal && (this.goal.kind === 'haulBank' || this.goal.kind === 'assistHaul') && this.goal.targetId === l.id) myTeamBanks.add(l.id);
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
          // a loose bank nobody is hauling (ours, or abandoned) is worth more hauled whole than
          // emptied — and never unpack a bank that already sits in our zone
          if (!holdingIt && !oppHaul && !bank.anchored && Math.hypot(bank.vel.x, bank.vel.y) < 0.25) continue;
          if (!holdingIt && this.bankInZone(sim, bank, -3)) continue;
          if (bank.recovery && bank.recovery.team === this.team && !holdingIt) continue;
          if (strip && !holdingIt) {
            // can I get it out before they recover the bank?
            const walkS = Math.max(0, this.walkDist(sim, l.pos) - 0.8) / WALK;
            const tUnS = l.anchored ? (UNANCHOR_TICKS[l.kind as 'smallSafe' | 'largeSafe'] / TICK_RATE) * (1 - l.unanchorProgress) : 0;
            if (walkS * 1.1 + 0.8 + tUnS + 1.6 > this.theirBankEta(sim, bank)) continue;
          }
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
      let w = kind === 'smallSafe' ? W.smallSafe * this.style.small : W.largeSafe * this.style.large;
      if (strip) {
        w = Math.max(w, W.strip * this.style.strip);
        // zero-sum swing: it leaves their haul and joins ours (counter-play depth decides how
        // much of that a bot appreciates)
        if (depth > 0) value *= 1 + Math.min(0.85, 0.6 * depth) * (1 + W.opportunism * 0.3);
      }
      // loose safes dropped in the open are quick pickups
      if (!l.anchored && !strip) w *= 1.08;
      // taking a safe out of a bank also lowers what that bank is worth to the other team —
      // all the more once they have shown they haul banks (in-match observation, public)
      if (!strip && l.floorOf !== null && depth > 0) value *= this.oppBankHauls.size > 0 ? 1 + 0.3 * depth : 1 + 0.15 * Math.min(1, depth);
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
      const rate = (value / t) * w * compete * this.taste(l.id);
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
      // a bank rolling along without any of us on it is someone else's haul (public motion)
      const committed = this.goal !== null && this.goal.targetId === b.id && (this.goal.kind === 'haulBank' || this.goal.kind === 'assistHaul');
      if (!holdingIt && !committed && mh.length === 0 && !b.anchored && Math.hypot(b.vel.x, b.vel.y) > 0.25) {
        this.oppBankHauls.add(b.id);
        continue;
      }
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
        let w = W.bank * this.style.bank * (1 + W.bankContents * contents);
        // an empty-handed opponent closer to this bank will contest it: prefer the other one
        if (!holdingIt) {
          for (const o of freshOpps) {
            if (!o.last || o.last.holdingId !== null || o.age > 120) continue;
            const od = V.dist(o.last.pos, b.pos) - 4.5;
            if (od < 12 && od + 3.5 < walk) w *= 0.55;
          }
        }
        // long exposure with opponents around
        if (freshOpps.length > 0 && t > 30) w *= 0.92;
        if (this.adaptation?.kind === 'stripBank') w *= 0.75;
        // bank race: they haul banks, so whichever bank we leave they will take next
        if (depth > 0 && [...this.oppBankHauls].some((id) => id !== b.id)) w *= 1 + 0.6 * depth;
        rate *= w * this.taste(b.id);
        out.push(this.mk('haulBank', key, b.id, rate, value, t, { bankId: b.id }));
      }
    }

    // --- 욕심내서 하나 더: load one nearby small safe onto the bank about to be hauled ---
    if (W.greed > 0 && (!me.grab || me.grab.targetId === this.loadPlan?.safe)) this.loadCandidates(sim, out, left);

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
      let w = W.intercept * this.style.intercept * (depth < 1 ? 0.55 + 0.45 * depth : 1);
      if (l.kind === 'largeSafe') w *= 1 + W.opportunism * 0.6;
      // the swing: they lose it, we may gain it
      const rate = ((l.baseValue * 1.6 * pHit) / t) * w;
      out.push(this.mk('intercept', key, o.id, rate, l.baseValue, t, { pos: { ...o.last.pos } }));
    }

    // --- harass a bank hauler (knock it off the wall: slows the haul, opens the door) ---
    // Tied or behind late in the match, any bot contests the other team's last haul (a draw is
    // not a goal; doc §11 점수 차와 실제 남은 시간).
    const scoreDiff = st.scores[this.team] - st.scores[(1 - this.team) as TeamId];
    const tieBreak = depth > 0 && scoreDiff <= 0 && (left < 50 || st.remainingValue <= 1100);
    if (!me.grab && ((depth >= 1 && W.aggression > 0.6) || tieBreak)) {
      for (const o of opps) {
        if (!o.visible || !o.last || o.last.holdingPart !== 'bankWall' || o.last.holdingId === null) continue;
        const b = sim.getLoot(o.last.holdingId);
        if (!b || b.recovered || b.anchored || (b.estimatedValue < 600 && !tieBreak)) continue;
        const key = `intercept:${o.id}`;
        if (claimed.has(key) || this.blacklisted(key, tick)) continue;
        const d = V.dist(me.pos, o.last.pos) * 1.2;
        if (d > 20) continue;
        const tReach = d / (WALK - 1) + 0.5;
        if (tReach + 2 > this.theirBankEta(sim, b)) continue;
        const pHit = 0.3 + 0.4 * this.P.dashUse;
        // each knockdown costs them a regrab (~3 s of a ~45 s haul) and lets us strip it
        const value = tieBreak ? b.estimatedValue * 0.3 : b.estimatedValue * 0.12 + (b.estimatedValue - 500) * 0.25;
        const rate = ((value * pHit) / (tReach + 1.5)) * (tieBreak ? 1.2 : W.intercept * W.aggression) * (depth >= 2 ? 1.15 : 1) * this.style.intercept;
        out.push(this.mk('intercept', key, o.id, rate, Math.round(value), tReach + 1.5, { pos: { ...o.last.pos }, bankId: b.id }));
      }
    }

    // --- defend a door of a bank a teammate is hauling ---
    for (const bid of myTeamBanks) {
      if (myGrab === bid) continue;
      const b = sim.getLoot(bid)!;
      if (this.mateHolders(sim, bid).length === 0) continue;
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
          // the one strengthened priority: regular watch shifts at the alley the human kept
          // using (between collections), more when the human is seen around it right now
          let best = 0;
          for (const c of out) if (c.kind !== 'idle' && c.kind !== 'reposition') best = Math.max(best, c.utility);
          const dueShift = tick - this.lastAmbushTick > 20 * TICK_RATE;
          let rate = dueShift ? Math.max(5.5, best * 1.08) : 4;
          const seenNear = freshOpps.some((o) => o.last && o.age < 600 && V.dist(o.last.pos, ch.pos) < ch.radius + 14);
          if (seenNear) rate *= 1.6;
          const carrying = freshOpps.some((o) => o.last && o.age < 60 && o.last.holdingId !== null && V.dist(o.last.pos, ch.pos) < ch.radius + 12);
          if (carrying) rate *= 2;
          if (left < 20) rate *= 0.3;
          out.push(this.mk('ambush', key, null, rate, 100, 10, { pos: { ...ch.pos } }));
        }
      }
    }

    // --- endgame (doc §11: 점수 차와 실제 남은 시간을 보고 욕심의 크기를 정한다) ---
    if (left < 45) {
      const diff = st.scores[this.team] - st.scores[(1 - this.team) as TeamId];
      if (this.posture === null && left < 40) {
        // decided once: behind -> bold, ahead -> steady, tied -> personality-weighted coin
        const pBold = diff < 0 ? 1 : diff > 0 ? 0 : 0.35 + 0.3 * this.W.aggression;
        this.posture = this.rng() < pBold ? 'bold' : 'steady';
        this.log1(sim, `endgame posture ${this.posture} (diff ${diff}, ${left.toFixed(0)} s)`);
      }
      const bold = this.posture === 'bold';
      for (const c of out) {
        if (c.kind === 'intercept' || c.kind === 'stripBank') {
          // tied or behind: take their last carry (a draw is not a goal); ahead: stop anything
          // that would catch us up
          if (diff <= 0) c.utility *= bold ? 2.6 : 1.6;
          else if (c.value >= diff) c.utility *= 1.5;
        } else if (bold && c.kind === 'collectSafe' && c.value >= 300) c.utility *= 1.6;
        else if (bold && c.kind === 'collectSafe') c.utility *= 0.85;
      }
    }
    // --- fallback: guard / patrol where the remaining loot is (never stand around) ---
    if (!me.grab) out.push(this.mk('reposition', 'guard', null, 0.02, 0, 6));
    out.push(this.mk('idle', 'idle', null, 0.001, 0, 1));
    return out;
  }

  /**
   * Small fixed per-bot preference per loot item (±7 %, seeded): two bots of the same
   * personality do not mirror each other exactly. Never changes during a match.
   */
  private taste(id: EntityId): number {
    let v = this.tastes.get(id);
    if (v === undefined) {
      let h = (this.tasteSeed ^ Math.imul(id, 0x9e3779b1)) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
      v = 0.93 + 0.14 * (((h ^ (h >>> 16)) >>> 0) / 4294967296);
      this.tastes.set(id, v);
    }
    return v;
  }
  private readonly tastes = new Map<EntityId, number>();
  private style = { small: 1, large: 1, bank: 1, strip: 1, intercept: 1 };
  private tasteSeed = 0;

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

  /** Candidates for loading an extra small safe onto the bank this bot is about to haul. */
  private loadCandidates(sim: Simulation, out: Goal[], left: number): void {
    const tick = sim.state.tick;
    let bankId: EntityId | null = null;
    if (this.loadPlan) bankId = this.loadPlan.bank;
    else if (this.goal && this.goal.kind === 'haulBank' && this.goal.phase !== 'haul' && this.goal.phase !== 'strain') bankId = this.goal.targetId;
    if (bankId === null || this.loadedBanks.has(bankId)) return;
    const b = sim.getLoot(bankId);
    if (!b || b.recovered || !b.anchored || this.mateHolders(sim, b.id).length > 0 || this.oppHolding(sim, b.id).length > 0) {
      this.loadPlan = null;
      return;
    }
    const haul = out.find((c) => c.key === `haul:${bankId}`);
    if (!haul) return;
    for (const l of sim.state.loot) {
      if (l.recovered || l.kind !== 'smallSafe' || l.recovery || l.loadedIn !== null) continue;
      if (l.floorOf !== null && l.floorOf !== bankId) continue;
      if (this.loadPlan && this.loadPlan.safe !== l.id) continue;
      const key = `load:${l.id}`;
      if (this.blacklisted(key, tick)) continue;
      if (this.mateHolders(sim, l.id).length || this.oppHolding(sim, l.id).length) continue;
      const near = V.dist(l.pos, b.pos);
      if (near > 14) continue;
      const holdingIt = this.me(sim).grab?.targetId === l.id;
      const walk = holdingIt ? 0 : this.walkDist(sim, l.pos);
      if (!Number.isFinite(walk)) continue;
      const tUn = l.anchored ? (UNANCHOR_TICKS.smallSafe / TICK_RATE) * (1 - l.unanchorProgress) : 0;
      const t = walk / WALK + 0.8 + tUn + near / 3.5 + 2.5;
      if (t > 15 || haul.est + t + 5 > left) continue;
      out.push(this.mk('collectSafe', key, l.id, haul.utility * 1.3 * this.W.greed, l.baseValue, t, { loadInto: bankId, bankId }));
    }
  }

  /**
   * Somewhere useful to stand when nothing can be delivered: between the freshest opponent
   * sighting and the loot nearest to it (ready to intercept), else a patrol over the remaining
   * loot (cycling every few seconds).
   */
  private guardSpot(sim: Simulation, g: Goal): Vec2 | null {
    const live = sim.state.loot.filter((l) => !l.recovered);
    let target: Vec2 | null = null;
    const opp = this.opponents(sim)
      .filter((o) => o.last && o.age < 300)
      .sort((a, b) => a.age - b.age)[0];
    if (opp && opp.last && live.length) {
      let near = live[0]!;
      for (const l of live) if (V.dist(l.pos, opp.last.pos) < V.dist(near.pos, opp.last.pos)) near = l;
      target = V.add(near.pos, V.scale(V.sub(opp.last.pos, near.pos), 0.45));
    } else if (live.length) {
      g.patrol = ((g.patrol ?? Math.floor(this.rng() * live.length)) + 1) % live.length;
      target = live[g.patrol]!.pos;
    }
    if (!target) return null;
    const k = this.nav.nearestPassable(target, 'walk', 6);
    return k >= 0 ? { x: this.nav.cellX(k), y: this.nav.cellY(k) } : null;
  }

  private execGuard(sim: Simulation, g: Goal): Command {
    const me = this.me(sim);
    const tick = sim.state.tick;
    if (me.grab) return cmd({ x: 0, y: 0 }, false);
    if (!g.pos || g.waitStart === undefined || tick - g.waitStart > 5 * TICK_RATE) {
      g.pos = this.guardSpot(sim, g);
      g.waitStart = tick;
    }
    if (!g.pos) {
      g.phase = 'guard';
      return cmd({ x: 0, y: 0 }, false);
    }
    const m = this.moveTo(sim, g.pos, 'walk', 1.2);
    if (m.arrived || m.stuck) {
      g.phase = 'guard';
      const opp = this.opponents(sim).find((o) => o.visible && o.last);
      return cmd(this.yieldToMates(sim, { x: 0, y: 0 }), false, opp?.last ? V.sub(opp.last.pos, me.pos) : null);
    }
    g.phase = 'travel';
    return cmd(m.move, false);
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
        out.push(this.mk(humanHolds ? 'assistHaul' : 'haulBank', key, l.id, 60, l.estimatedValue, 30, { bankId: l.id, pingId: p.id, mateId: p.charId, until: st.tick + 60 * TICK_RATE }));
      } else {
        const key = `collect:${l.id}`;
        const walk = this.walkDist(sim, l.pos);
        if (walk / WALK + 3 > left) continue;
        out.push(this.mk('collectSafe', key, l.id, 60, l.baseValue, walk / WALK + 8, { pingId: p.id, mateId: p.charId, until: st.tick + 45 * TICK_RATE }));
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
    const tick = sim.state.tick;
    const before = g.phase;
    const c = this.executeGoal(sim, g);
    if (this.goal === g) {
      if (g.phase !== before || g.phaseTick === undefined) {
        g.phaseTick = tick;
        g.phaseRef = { ...this.me(sim).pos };
      }
      // goal-level progress watchdog: a phase that takes far too long is abandoned
      const limit = this.phaseLimit(sim, g);
      if (tick - g.phaseTick > limit) {
        this.log1(sim, `timeout in ${g.phase} (${((tick - g.phaseTick) / TICK_RATE).toFixed(1)} s)`);
        this.endGoal(sim, `timeout:${g.phase}`, 8 * TICK_RATE);
        return cmd({ x: 0, y: 0 }, false);
      }
    }
    return c;
  }

  private phaseLimit(sim: Simulation, g: Goal): number {
    const s = TICK_RATE;
    switch (g.phase) {
      case 'approach': {
        const ref = g.phaseRef ?? this.me(sim).pos;
        const tp = this.goalTargetPos(sim, g);
        const d = tp ? V.dist(ref, tp) : 20;
        // a target riding a moving bank can run away from (or straight at) the approacher
        const moving = g.targetId !== null && (() => {
          const l = sim.getLoot(g.targetId!);
          const b = l && l.floorOf !== null ? sim.getLoot(l.floorOf) : undefined;
          return !!b && !b.anchored && Math.hypot(b.vel.x, b.vel.y) > 0.25;
        })();
        return Math.max((moving ? 6 : 9) * s, ((d * 2.2) / WALK + (moving ? 2 : 5)) * s);
      }
      case 'grab':
        return 4 * s;
      case 'strain':
        return 7 * s;
      case 'carry':
        return 45 * s;
      case 'load':
        return 14 * s;
      case 'haul':
        return 150 * s;
      case 'chase':
        return 15 * s;
      case 'travel':
        return 30 * s;
      default:
        return 1e9;
    }
  }

  private executeGoal(sim: Simulation, g: Goal): Command {
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
        return this.execMoveGoal(sim, g);
      case 'reposition':
        return this.execGuard(sim, g);
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
    // head-on in a one-lane alley: the one without right of way backs out and steps aside
    if (tick < this.backoffUntil) {
      let bd = this.backoffDir;
      if (nav.clearanceAt(me.pos.x, me.pos.y) >= 1.0) {
        const perp = { x: -bd.y, y: bd.x };
        const l = nav.clearanceAt(me.pos.x + perp.x * 0.8, me.pos.y + perp.y * 0.8);
        const r = nav.clearanceAt(me.pos.x - perp.x * 0.8, me.pos.y - perp.y * 0.8);
        bd = l >= r ? perp : V.scale(perp, -1);
      }
      this.watchRef = { ...me.pos };
      this.watchTick = tick;
      return { move: bd, arrived: false, stuck: false };
    }
    if (tick - this.backoffWindow > 10 * TICK_RATE) {
      this.backoffWindow = tick;
      this.backoffCount = 0;
    }
    if (this.backoffCount < 3 && this.headOnYield(sim, dir, opts.carrying === true)) {
      this.backoffCount++;
      this.backoffDir = V.scale(dir, -1);
      this.backoffUntil = tick + 45;
      this.path = null;
      return { move: this.backoffDir, arrived: false, stuck: false };
    }
    dir = this.avoid(sim, dir, cls, opts.carrying === true, dGoal > 0.9);
    let move = V.scale(dir, mag);
    // watchdog
    const w = this.watchdog(sim, move);
    if (w.nudge) move = w.nudge;
    // travel dash on a long straight stretch with nobody around (the dash is then on cooldown,
    // so bots that keep it for fights use this less)
    if (!opts.carrying && !w.nudge && mag >= 1 && me.dashCooldown === 0 && !me.grab && p && p.idx < p.pts.length && V.dist(me.pos, target) > 4.5) {
      if (this.rngCheck(this.P.carryBoost * this.W.travelDash, 12) && !this.threatNear(sim, me.pos, 12)) this.travelDash = true;
    }
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

  /**
   * Someone is coming at me inside a passage too narrow to pass (a 1.1 m alley): true when I
   * should be the one to back out. Right of way: whoever carries something, then a human, then
   * the lower slot. Opponents count only while visible (their velocity is public when seen).
   */
  private headOnYield(sim: Simulation, dir: Vec2, carrying: boolean): boolean {
    const me = this.me(sim);
    if (carrying || me.grab) return false;
    if (this.nav.clearanceAt(me.pos.x, me.pos.y) >= 0.9) return false;
    const check = (pos: Vec2, vel: Vec2, facing: number, isBot: boolean, slot: number, theyCarry: boolean): boolean => {
      const rel = V.sub(pos, me.pos);
      const d = V.len(rel);
      if (d > 1.9 || d < 1e-6) return false;
      const u = V.scale(rel, 1 / d);
      if (V.dot(u, dir) < 0.6) return false;
      const vl = V.len(vel);
      // coming toward me (someone just standing there is handled by avoidance / the watchdog)
      if (vl <= 0.3 || V.dot(V.scale(vel, 1 / vl), u) > -0.4) return false;
      if (Math.cos(facing - Math.atan2(-u.y, -u.x)) < 0) return false;
      if (theyCarry) return true;
      if (!isBot) return true;
      return slot < this.slot;
    };
    for (const ch of this.mates(sim)) {
      // (a teammate's intent is team knowledge: two mates shoving each other have no velocity)
      if (check(ch.pos, V.len(ch.moveIntent) > 0.3 ? ch.moveIntent : ch.vel, ch.facing, ch.isBot, ch.slot, ch.grab !== null)) return true;
    }
    for (const o of this.perception.opponents(sim.state.tick, 0)) {
      if (!o.visible || !o.last) continue;
      if (check(o.last.pos, o.last.vel, o.last.facing, o.isBot, o.slot, o.last.holdingId !== null)) return true;
    }
    return false;
  }
  private backoffUntil = -1;
  private backoffWindow = 0;
  private backoffCount = 0;
  private backoffDir: Vec2 = { x: 0, y: 0 };

  /** Local avoidance of characters and loose safes (cheap whiskers). */
  private avoid(sim: Simulation, dir: Vec2, cls: Cls, carrying: boolean, avoidTarget = false): Vec2 {
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
      // (the goal's own target too while walking around it to a grab spot on its far side)
      if (l.recovered || l.kind === 'bank' || l.id === holding || (l.id === goalTarget && (!avoidTarget || l.floorOf !== null))) continue;
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
  private grabSkill(sim: Simulation, g: Goal, target: LootState, spot: GrabSpot, part: 'safe' | 'bankWall', tol: number, precise = false): { c: Command; status: 'moving' | 'aiming' | 'held' | 'blocked' } {
    const me = this.me(sim);
    if (me.grab && me.grab.targetId === target.id) return { c: cmd({ x: 0, y: 0 }, true), status: 'held' };
    if (me.grab) return { c: cmd({ x: 0, y: 0 }, false), status: 'moving' };
    const dStand = V.dist(me.pos, spot.stand);
    const toAnchor = V.sub(spot.anchor, me.pos);
    const dAnchor = V.len(toAnchor);
    const inReach = precise ? dStand < 0.12 : dAnchor <= GRAB_REACH - 0.12 && dStand < 0.9;
    if (!inReach && dStand > (precise ? 0.12 : 0.28)) {
      g.aimTicks = 0;
      if (dStand < 1.2 && this.nav.segmentClear(me.pos, spot.stand, 'walk', -0.05)) {
        // fine positioning (P-control): the grab direction decides how the target is driven
        const mag = Math.max(0.12, Math.min(1, dStand / 0.7));
        // no progress for ~1.2 s (someone else is standing on the spot, e.g. an opponent going for
        // the same handle): give the spot up instead of shoving forever
        const tick = sim.state.tick;
        if (g.fineSeen === undefined || tick - g.fineSeen > 2 || g.fineBest === undefined || g.fineTick === undefined || dStand < g.fineBest - 0.08) {
          g.fineBest = dStand;
          g.fineTick = tick;
        } else if (tick - g.fineTick > 72) {
          g.fineSeen = undefined;
          return { c: cmd({ x: 0, y: 0 }, false), status: 'blocked' };
        }
        g.fineSeen = tick;
        return { c: cmd(V.scale(V.norm(V.sub(spot.stand, me.pos)), mag), false), status: 'moving' };
      }
      const m = this.moveTo(sim, spot.stand, 'walk', 0.1, { slow: 0.9 });
      if (m.stuck) return { c: cmd({ x: 0, y: 0 }, false), status: 'blocked' };
      return { c: cmd(m.move, false), status: 'moving' };
    }
    g.aimTicks = (g.aimTicks ?? 0) + 1;
    // a failed / broken grab leaves the sim's grab latch set: release the button for a tick
    if (this.lastGrabCmd) return { c: cmd({ x: 0, y: 0 }, false, toAnchor), status: 'aiming' };
    // never grab while still running at it (a violent yank breaks the grip)
    const rel = V.sub(me.vel, target.vel);
    if (V.len(rel) > 1.1) return { c: cmd({ x: 0, y: 0 }, false, toAnchor), status: 'aiming' };
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
      // a teammate standing (or holding) there owns that spot
      for (const ch of this.mates(sim)) if (V.dist(ch.pos, p) < (ch.grab ? 0.85 : 0.95)) return false;
      // ... or is heading to it (team claims carry the spot through the goal key)
      for (const c of this.board.otherClaims(this.slot)) {
        const mate = sim.state.characters[c.slot];
        if (mate && mate.team === this.team && c.targetId !== null && this.claimedSpots.get(c.slot) && V.dist(this.claimedSpots.get(c.slot)!, p) < 0.9) return false;
      }
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
    const dest = this.carryTarget(sim, l, g);
    const res = this.nav.findPath(l.pos, dest, cls, { maxExpand: 25000 });
    let dir = V.norm(V.sub(dest, l.pos));
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

  /** Where the carrier walks to: the zone center, or a pocket inside the bank it loads. */
  private carryTarget(sim: Simulation, l: LootState, g: Goal): Vec2 {
    if (g.loadInto !== undefined) {
      const b = sim.getLoot(g.loadInto);
      if (b && !b.recovered) return this.loadPoint(sim, b, l);
    }
    return zoneOf(sim.layout, this.team).center;
  }

  /** Pocket beside the entry door inside a bank (clear of the interior safes). */
  private loadPoint(sim: Simulation, b: LootState, l: LootState): Vec2 {
    const doors = bankDoors(b);
    let d = doors[0]!;
    for (const x of doors) if (V.dist(x.center, l.pos) < V.dist(d.center, l.pos)) d = x;
    const t = { x: -d.normal.y, y: d.normal.x };
    const side = V.dot(V.sub(l.pos, d.center), t) >= 0 ? 1 : -1;
    return V.add(V.add(b.pos, V.scale(d.normal, 1.3)), V.scale(t, 1.9 * side));
  }

  private chooseSafeSpot(sim: Simulation, l: LootState, g: Goal): GrabSpot | null {
    const dir = this.carryDirection(sim, l, g);
    const me = this.me(sim);
    const spots = safeGrabSpots(l);
    let best: GrabSpot | null = null;
    let bestS = -Infinity;
    for (const s0 of spots) {
      const k = `f${s0.face}`;
      if (g.excluded?.has(k)) continue;
      // a safe pressed against a wall at an alley mouth: the centered stand may be too tight,
      // so try anchors slid along the face (the pull then just turns the safe a little)
      let s = s0;
      if (!this.spotFree(sim, s.stand)) {
        const t = { x: -s0.normal.y, y: s0.normal.x };
        const tl = V.rot(t, -l.angle);
        const span = Math.abs(tl.x) * l.half.x + Math.abs(tl.y) * l.half.y - 0.1;
        let found: GrabSpot | null = null;
        for (const off of [0.2, -0.2, 0.35, -0.35]) {
          if (Math.abs(off) > span) continue;
          const anchor = V.add(s0.anchor, V.scale(t, off));
          const stand = V.add(anchor, V.scale(s0.normal, STAND_OFF));
          if (!this.spotFree(sim, stand)) continue;
          found = { ...s0, anchor, stand, anchorLocal: V.add(s0.anchorLocal, V.scale(tl, off)) };
          break;
        }
        if (!found) continue;
        s = found;
      }
      // anchor reachable from the stand without a wall in between
      if (!sim.lineOfSight(s.stand, V.add(s.anchor, V.scale(s.normal, 0.05)))) continue;
      if (!Number.isFinite(this.walkDist(sim, s.stand))) continue;
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
    if (g.loadInto !== undefined) {
      const b = sim.getLoot(g.loadInto);
      if (!b || b.recovered || !b.anchored) {
        // the bank left without it: just recover the safe instead
        g.loadInto = undefined;
        this.loadPlan = null;
      } else if (l.loadedIn === b.id) {
        this.loadedBanks.add(b.id);
        this.loadPlan = null;
        this.log1(sim, `loaded safe ${l.id} onto bank ${b.id} (now ${b.estimatedValue})`);
        this.endGoal(sim, 'loaded');
        return cmd({ x: 0, y: 0 }, false);
      } else {
        g.phase = 'load';
        return this.carryStep(sim, g, l, this.loadPoint(sim, b, l));
      }
    }
    const zone = zoneOBB(sim.layout, this.team);
    const obb = sim.lootOBB(l.id);
    // (a safe loaded on a bank floor is only ever recovered with its bank)
    if (obbInside(obb, zone, -0.1) && l.loadedIn === null) {
      g.phase = 'recover';
      // inside: hold still once it is deep inside, else walk past the center so it trails in
      if (obbInside(obb, zone, -1.0)) return cmd({ x: 0, y: 0 }, true);
      const toC = V.norm(V.sub(zone.center, l.pos));
      const p = V.add(zone.center, V.scale(toC, 1.5));
      const d = V.dist(p, me.pos);
      if (d < 0.3) return cmd({ x: 0, y: 0 }, true);
      return cmd(V.scale(V.norm(V.sub(p, me.pos)), Math.min(0.7, d)), true);
    }
    g.phase = 'carry';
    return this.carryStep(sim, g, l, zone.center);
  }

  private carryStep(sim: Simulation, g: Goal, l: LootState, goal: Vec2): Command {
    const me = this.me(sim);
    const tick = sim.state.tick;
    const cls = this.safeClass(l);
    if (g.wiggleUntil !== undefined && tick < g.wiggleUntil) return cmd(g.wiggleDir!, true);
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
        (g.excluded ??= new Set()).add(`f${this.heldFace(sim, l)}`); // faces that already failed stay out
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

  /** Another bank of ours (held by a teammate) that is closer to finishing into the same zone. */
  private mateBankAhead(sim: Simulation, bank: LootState, remaining: number): LootState | null {
    const zone = zoneOf(sim.layout, this.team);
    for (const b of sim.state.loot) {
      if (b.kind !== 'bank' || b.id === bank.id || b.recovered || b.anchored) continue;
      if (V.dist(b.pos, zone.center) > Math.max(zone.half.x, zone.half.y) + 6) continue;
      if (!b.grabbedBy.some((id) => { const c = sim.getCharacter(id); return !!c && c.team === this.team && c.id !== this.id; })) continue;
      const route = this.routeFor(sim, b);
      if (!route) continue;
      const r2 = this.haulDirection(sim, b, route).remaining;
      if (r2 < remaining - 0.5 || (Math.abs(r2 - remaining) <= 0.5 && b.id < bank.id)) return b;
    }
    return null;
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

  private bankInZone(sim: Simulation, bank: LootState, tol = -0.2): boolean {
    return obbInside(sim.lootOBB(bank.id), zoneOBB(sim.layout, this.team), tol);
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
      // tug of war (an opponent seen on it, or felt: the bank does not follow my pull): give up
      // after a random patience so two stubborn bots never deadlock (doc §8 교착: 같은 물건에서
      // 줄다리기만 하는 대신 다른 전리품을 가져갈 선택)
      const pulledBack = !bank.anchored && V.dot(bank.vel, dir) < 0.15 && tick - g.started > 60 && !g.yielding;
      if (this.oppHolding(sim, bank.id).length > 0 || pulledBack) {
        g.tugTicks = (g.tugTicks ?? 0) + 1;
        g.tugPatience ??= Math.round((1.5 + this.rng() * 2.2) * TICK_RATE);
        if (g.tugTicks > g.tugPatience && !human && mates.length === 0) {
          this.endGoal(sim, 'tug of war', 10 * TICK_RATE);
          return cmd({ x: 0, y: 0 }, false);
        }
      } else g.tugTicks = Math.max(0, (g.tugTicks ?? 0) - 2);
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
      // two banks never fit into one zone at once: when a teammate's bank is ahead of mine on
      // the way in, wait short of the zone (backing out if mine is already in its way)
      g.yielding = false;
      if (!human && remaining < 11) {
        const ahead = this.mateBankAhead(sim, bank, remaining);
        if (ahead) {
          g.yielding = true;
          g.stallRef = undefined;
          g.stallTick = undefined;
          if (remaining < 8.5) {
            g.phase = 'yield';
            const anchor = V.toWorld(me.grab!.anchorLocal, bank.pos, bank.angle);
            const away = V.norm(V.sub(bank.pos, ahead.pos));
            // walk so the bank moves away from the other one (pull if I am on that side, else push)
            const pullSide = V.dot(V.sub(anchor, bank.pos), away) > 0;
            return cmd(pullSide ? away : V.norm(V.add(V.norm(V.sub(anchor, me.pos)), V.scale(away, 0.6))), true);
          }
          g.phase = 'wait';
          return cmd({ x: 0, y: 0 }, true);
        }
      }
      // drive with the face we hold: pull when it faces the travel direction, push when it is
      // the rear face (no regrab needed) — except that a puller cannot walk through a fence
      const nd = V.dot(n, dir);
      if (!(g.mode && g.modeUntil !== undefined && tick < g.modeUntil)) mode = nd >= 0 && !fence ? 'pull' : 'push';
      const score = mode === 'pull' ? nd : -nd;
      if (score < 0.3) g.badFaceTicks = (g.badFaceTicks ?? 0) + 1;
      else g.badFaceTicks = 0;
      const limit = score < -0.1 ? 30 : mode === 'push' ? 400 : 150;
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
      if (V.dist(bank.pos, g.stallRef) > 0.6) {
        g.stallRef = { ...bank.pos };
        g.stallTick = tick;
      } else if (tick - g.stallTick > (g.stallLimit ??= 110 + Math.floor(this.rng() * 60))) {
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
    // squeezed (grip keeps breaking): the way is blocked, e.g. by another bank parked on the
    // route — leave it for now instead of grinding
    if ((g.forcedReleases ?? 0) >= 3) {
      this.endGoal(sim, 'pinned while hauling', 8 * TICK_RATE);
      return cmd({ x: 0, y: 0 }, false);
    }
    // (a fresh grab starts a fresh stall / tug measurement)
    g.stallRef = undefined;
    g.stallTick = undefined;
    g.tugTicks = 0;
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
    const r = this.grabSkill(sim, g, bank, g.spot, 'bankWall', 0.35, true);
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
    const spots = bankGrabSpots(bank, 0.56);
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
      const wd = this.walkDist(sim, s.stand);
      if (!Number.isFinite(wd)) continue;
      let score = mode === 'pull' ? V.dot(s.normal, dir) : -V.dot(s.normal, dir);
      if (s.face <= 1) score += 0.08; // side walls: anchor on the center line
      if (onMateFace) score += human ? 1.5 : 0.6; // same face as the teammate -> same direction
      score -= V.dist(me.pos, s.stand) * 0.015;
      if (mode === 'push' && s.face <= 1) score += 0.3; // push through the center line
      if (score > bestS) {
        bestS = score;
        best = s;
      }
    }
    if (best && !human && bestS < -0.2 && mates.length === 0) return best; // still better than nothing
    if (best) {
      g.spotKey = best.slotKey;
      this.claimedSpots.set(this.slot, best.stand);
    }
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
  private dashAt(sim: Simulation, seen: OpponentView, why: string): Command | null {
    const me = this.me(sim);
    if (me.grab || me.dashCooldown > 0 || !seen.visible || !seen.last) return null;
    // the decision to engage used the (reaction-delayed) view; aiming tracks the target the bot
    // is already watching, i.e. the current sighting (still only if it is in sight now)
    const o = this.perception.opponents(sim.state.tick, 0).find((v) => v.id === seen.id);
    if (!o || !o.visible || !o.last) return null;
    if (o.last.knockedDown || o.last.protectedNow) return null;
    const rel = V.sub(o.last.pos, me.pos);
    const d = V.len(rel);
    if (d > 3.6 || d < 0.3) return null;
    const q = this.P.leadQuality;
    const dur = DASH.durationTicks / TICK_RATE;
    let dir = V.norm(rel);
    // closing speed along the dash, then lead the aim by the target's motion
    const away = V.dot(o.last.vel, dir);
    const closing = DASH.speed - Math.max(0, away);
    const tHit = Math.min(dur, Math.max(0, d - 0.95) / Math.max(1, closing));
    const pred = V.add(o.last.pos, V.scale(o.last.vel, tHit * q));
    dir = V.norm(V.sub(pred, me.pos));
    if (q < 1) dir = V.rot(dir, (this.rng() - 0.5) * (1 - q) * 0.5);
    // must reach touching distance within the dash burst
    if (d - 0.95 > closing * dur * 0.92) return null;
    // the dash stops on whatever is in between: walls, a bank, or the very safe they drag
    if (!sim.lineOfSight(me.pos, pred)) return null;
    const end = V.sub(pred, V.scale(dir, 0.9));
    for (const l of sim.state.loot) {
      if (l.recovered || l.kind === 'bank') continue;
      if (V.dist(l.pos, me.pos) > d + 1.5) continue;
      const box = { center: l.pos, half: { x: l.half.x + 0.42, y: l.half.y + 0.42 }, angle: l.angle };
      const seg = V.sub(end, me.pos);
      const len = V.len(seg);
      if (len > 0.05 && rayOBB(me.pos, V.scale(seg, 1 / len), box, len) !== null) return null;
    }
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
      if (l && !l.recovered && l.kind !== 'bank') {
        this.startGoal(sim, this.mk('collectSafe', `collect:${l.id}`, l.id, g.utility, l.baseValue, 10, { chained: true }));
        return cmd({ x: 0, y: 0 }, false);
      }
      if (l && !l.recovered && l.kind === 'bank') {
        // knocked the hauler off: go for the most valuable safe still on that bank
        let best: LootState | null = null;
        for (const sid of l.loadedSafes) {
          const sl = sim.getLoot(sid);
          if (sl && !sl.recovered && (!best || sl.baseValue > best.baseValue)) best = sl;
        }
        if (best) {
          this.startGoal(sim, this.mk('stripBank', `collect:${best.id}`, best.id, g.utility, best.baseValue, 10, { chained: true, strip: true, bankId: l.id }));
          return cmd({ x: 0, y: 0 }, false);
        }
        this.endGoal(sim, 'knocked hauler, bank empty');
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
    // chase a lead point; close in from the side (a carried safe trails behind its carrier and
    // shields it from a chaser coming straight from behind)
    const d = V.dist(me.pos, o.last.pos);
    const lead = Math.min(1.2, d / 6) * this.P.leadQuality;
    let tgt = V.add(o.last.pos, V.scale(o.last.vel, lead));
    const held = o.last.holdingId !== null ? sim.getLoot(o.last.holdingId) : undefined;
    if (held && held.kind !== 'bank' && d < 7) {
      const back = V.norm(V.sub(held.pos, o.last.pos));
      if (V.dot(V.norm(V.sub(me.pos, o.last.pos)), back) > 0.2) {
        const side = { x: -back.y, y: back.x };
        const sgn = V.dot(V.sub(me.pos, o.last.pos), side) >= 0 ? 1 : -1;
        tgt = V.add(tgt, V.scale(side, 1.6 * sgn));
      }
    }
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
    // extend while a threat is near (never beyond 12 s in total: no endless duels)
    const threat = this.nearestThreat(this.opponents(sim), bank.pos, 9);
    if (threat && g.until !== undefined && g.until - tick < 60 && tick - g.started < 12 * TICK_RATE) g.until = tick + 90;
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
      if (tick - g.waitStart > 10 * TICK_RATE) {
        this.lastAmbushTick = tick;
        this.endGoal(sim, 'ambush shift over', 12 * TICK_RATE);
      }
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
