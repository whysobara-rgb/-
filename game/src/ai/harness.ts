/**
 * Headless match runner shared by tools/headless-match.ts, tools/balance-report.ts and the AI
 * tests. Pure TS (no Node APIs): bots on both teams, an optional scripted "human proxy" in the
 * human slot (a bot with isBot=false in the roster, private sight, no team claims), invariant
 * checks every tick and per-match statistics.
 */
import { Simulation } from '../sim/sim';
import { TICK_RATE } from '../sim/config';
import { LAYOUTS } from '../sim/layouts/index';
import type { Command, EntityId, LayoutDef, LayoutId, MatchResult, RosterEntry, RuleConfig, SimEvent, TeamId } from '../sim/types';
import { Bot } from './bot';
import { TeamBoard } from './board';
import { RIVALS, type DifficultyParams } from './params';
import type { Adaptation, Difficulty, RivalId } from './types';

export interface SlotSpec {
  personality: RivalId;
  difficulty: Difficulty;
  /** Scripted stand-in for a human player (roster isBot=false). */
  humanProxy?: boolean;
  adaptation?: Adaptation | null;
  /**
   * [C11] Per-slot difficulty-parameter override (experiments, e.g. a proxy item-skill sweep). The
   * proxy's "human-ish" content skill (C11 proxy upgrade: item skill 0.7, gimmick skill 0.7, aim
   * error 12°, police awareness 0.55) lives in HUMAN_PROXY_PARAMS, so the proxy runs the same C6
   * goal providers as the rivals.
   */
  tuning?: Partial<DifficultyParams>;
}

export interface MatchSpec {
  layout: LayoutId | LayoutDef;
  /** Team 0 members then team 1 members. */
  team0: SlotSpec[];
  team1: SlotSpec[];
  seed: number;
  rules?: Partial<RuleConfig>;
  /** Stop early after this many ticks (tests). */
  maxTicks?: number;
  /** Called every tick after the step (tests / tracing). */
  onTick?: (sim: Simulation, events: SimEvent[], bots: Bot[]) => void;
  /** Measure bot CPU time (performance.now). */
  timing?: boolean;
}

export interface SlotStats {
  slot: number;
  team: TeamId;
  personality: RivalId;
  difficulty: Difficulty;
  humanProxy: boolean;
  /** Points of recoveries this character was holding at completion (or last held). */
  points: number;
  recoveries: { smallSafe: number; largeSafe: number; bank: number };
  /** Bank recoveries: whole (with >= 1 safe) vs empty. */
  banksWhole: number;
  /** Safes this character pulled out of a bank (any bank). */
  strips: number;
  /** ... out of a bank the other team was hauling. */
  steals: number;
  knockdownsDealt: number;
  knockedDown: number;
  dashes: number;
  boosts: number;
  firstScoreTick: number | null;
  /**
   * Seconds with no meaningful progress (> 3 s windows; the first 3 s are tolerated). Progress =
   * moving > 1.25 m from where the window started, straining, being knocked down, the held object
   * moving > 1.25 m, or an own-team recovery dwell of the held object. Declared waiting does NOT
   * count as progress: windows spent >= 80 % in declared waiting are reported as idle instead.
   */
  stuckSeconds: number;
  /** Longest no-progress stretch that was not declared waiting (s). */
  maxStuck: number;
  /** Non-waiting no-progress stretches longer than 5 s. */
  stuckIncidents5s: number;
  /** Seconds in declared waiting (guard/ambush watch/escort/yield/telegraph). */
  idleSeconds: number;
  /** Declared-waiting stretches without progress longer than 6 s. */
  idleIncidents6s: number;
  /**
   * The previous (looser) metric, for comparison: any 0.75 m move or declared waiting resets the
   * window; stretches longer than 5 s.
   */
  stuckIncidentsLoose: number;
  /** Seconds in the fallback goals (guard patrol / idle) with loot left and > 5 s on the clock. */
  passiveSeconds: number;
  /** ... of which with the own team tied or behind. */
  passiveBehindSeconds: number;
  unstuckEvents: number;
  /** Police tackles this character suffered (hits). */
  tackledByPolice: number;
  /** Officers this character knocked over with a dash. */
  policeStuns: number;
  botMsTotal: number;
  botMsMax: number;
  /** Max after the first 2 s (JIT warm-up excluded). */
  botMsMaxWarm: number;
  /** Updates slower than 2 ms (after warm-up). */
  botSlow2ms: number;
  botTicks: number;
  goals: Record<string, number>;
  finalReplans: number;
  pingsAnswered: number;
  goalFails: number;
  /** No-progress stretches > 5 s: start tick, duration (s), goal/phase at the start, position. */
  incidents: { tick: number; dur: number; what: string; x: number; y: number }[];
  /** Declared-waiting stretches > 6 s (same fields). */
  idleIncidents: { tick: number; dur: number; what: string; x: number; y: number }[];
}

export interface MatchStats {
  layout: LayoutId;
  seed: number;
  result: MatchResult;
  ticks: number;
  invariantViolations: number;
  slots: SlotStats[];
  teamScores: [number, number];
  firstScoreTick: [number | null, number | null];
  finalLog: { tick: number; slot: number; msg: string }[];
  fencesBroken: number;
  /** Tick of the first / second bank body recovery (null = never). */
  firstBankTick: number | null;
  secondBankTick: number | null;
  /** The first bank recovered: by which team, and whether it started in the north half. */
  firstBank: { team: TeamId; north: boolean } | null;
  /** Tick the final countdown started (null = never). */
  finalCountdownTick: number | null;
  /** Points by source (both teams): small / large safes, bank buildings, safes recovered inside a bank. */
  pointsBy: { small: number; large: number; bankBuilding: number; bankContents: number };
  /** Police event statistics (all zero when rules.police is off). */
  police: {
    waves: number;
    tackleAttempts: number;
    tackles: number;
    stuns: number;
    /** Forced releases of an uprooted bank's wall (a haul broken off) by a police tackle / an opponent dash. */
    bankInterruptsPolice: number;
    bankInterruptsDash: number;
    /** Forced releases of a carried safe by a police tackle. */
    safeInterruptsPolice: number;
    /**
     * Tackle chains: runs of police tackle hits on one victim spaced <= 2.6 s apart (the officer
     * waiting beside a downed hauler for its protection to end). Hits in runs of >= 3, and the
     * longest run.
     */
    chainHits: number;
    chainLongest: number;
  };
}

function rosterFor(spec: MatchSpec): { roster: RosterEntry[]; slots: SlotSpec[] } {
  const roster: RosterEntry[] = [];
  const slots: SlotSpec[] = [];
  const add = (team: TeamId, s: SlotSpec, i: number): void => {
    const meta = RIVALS[s.personality];
    roster.push({
      team,
      isBot: !s.humanProxy,
      name: s.humanProxy ? `P${team}` : `${s.personality}-${team}${i}`,
      look: s.humanProxy ? { hat: team === 0 ? 'teamCapA' : 'teamCapB' } : { ...meta.look },
    });
    slots.push(s);
  };
  spec.team0.forEach((s, i) => add(0, s, i));
  spec.team1.forEach((s, i) => add(1, s, i));
  return { roster, slots };
}

export function createMatch(spec: MatchSpec): { sim: Simulation; bots: Bot[] } {
  const layout = typeof spec.layout === 'string' ? LAYOUTS[spec.layout] : spec.layout;
  const { roster, slots } = rosterFor(spec);
  const sim = new Simulation({ layout, roster, seed: spec.seed, rules: spec.rules });
  const bots = slots.map(
    (s, slot) =>
      new Bot(sim, {
        slot,
        personality: s.personality,
        difficulty: s.difficulty,
        adaptation: s.adaptation ?? null,
        seed: (spec.seed * 7919 + slot * 104729) >>> 0,
        humanProxy: s.humanProxy === true,
        tuning: s.tuning,
      }),
  );
  return { sim, bots };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Run one full match headless and collect statistics. */
export function runMatch(spec: MatchSpec): MatchStats {
  const { sim, bots } = createMatch(spec);
  const st = sim.state;
  const n = bots.length;
  const slotStats: SlotStats[] = bots.map((b) => ({
    slot: b.slot,
    team: b.team,
    personality: b.personality,
    difficulty: b.difficulty,
    humanProxy: b.isProxy,
    points: 0,
    recoveries: { smallSafe: 0, largeSafe: 0, bank: 0 },
    banksWhole: 0,
    strips: 0,
    steals: 0,
    knockdownsDealt: 0,
    knockedDown: 0,
    dashes: 0,
    boosts: 0,
    firstScoreTick: null,
    stuckSeconds: 0,
    maxStuck: 0,
    stuckIncidents5s: 0,
    idleSeconds: 0,
    idleIncidents6s: 0,
    stuckIncidentsLoose: 0,
    passiveSeconds: 0,
    passiveBehindSeconds: 0,
    unstuckEvents: 0,
    tackledByPolice: 0,
    policeStuns: 0,
    botMsTotal: 0,
    botMsMax: 0,
    botMsMaxWarm: 0,
    botSlow2ms: 0,
    botTicks: 0,
    goals: {},
    finalReplans: 0,
    pingsAnswered: 0,
    goalFails: 0,
    incidents: [],
    idleIncidents: [],
  }));
  const stuckWhat: string[] = bots.map(() => '');
  const waitTicks = bots.map(() => 0);
  const looseRef = bots.map((b) => ({ ...sim.characterBySlot(b.slot).pos }));
  const looseHeld = bots.map(() => ({ id: -1 as EntityId, x: 0, y: 0 }));
  const looseStart = bots.map(() => 0);
  // progress tracking (no meaningful progress for > 3 s)
  const ref = bots.map((b) => ({ ...sim.characterBySlot(b.slot).pos }));
  const refHeld = bots.map(() => ({ id: -1 as EntityId, x: 0, y: 0 }));
  const lastProgress = bots.map(() => 0);
  let violations = 0;
  const firstScore: [number | null, number | null] = [null, null];
  const commands: Command[] = new Array(n);
  const maxTicks = spec.maxTicks ?? Infinity;
  let fences = 0;
  let firstBankTick: number | null = null;
  let secondBankTick: number | null = null;
  let firstBank: { team: TeamId; north: boolean } | null = null;
  const bankStartY = new Map(st.loot.filter((l) => l.kind === 'bank').map((l) => [l.id, l.pos.y] as const));
  let fcTick: number | null = null;
  const pointsBy = { small: 0, large: 0, bankBuilding: 0, bankContents: 0 };
  const pol = { waves: 0, tackleAttempts: 0, tackles: 0, stuns: 0, bankInterruptsPolice: 0, bankInterruptsDash: 0, safeInterruptsPolice: 0, chainHits: 0, chainLongest: 0 };
  const chain = new Map<EntityId, { last: number; run: number }>();
  const closeChain = (c: { run: number }): void => {
    if (c.run >= 3) pol.chainHits += c.run;
    pol.chainLongest = Math.max(pol.chainLongest, c.run);
  };
  // last holder per safe (for attributing recoveries completed without a holder)
  const lastHolder = new Map<EntityId, EntityId>();
  while (!st.over && st.tick < maxTicks) {
    for (let i = 0; i < n; i++) {
      const b = bots[i]!;
      if (spec.timing && !b.isProxy) {
        const t0 = now();
        commands[i] = b.update(sim);
        const dt = now() - t0;
        const s = slotStats[i]!;
        s.botMsTotal += dt;
        s.botTicks++;
        if (dt > s.botMsMax) s.botMsMax = dt;
        if (st.tick > 2 * TICK_RATE) {
          if (dt > s.botMsMaxWarm) s.botMsMaxWarm = dt;
          if (dt > 2) s.botSlow2ms++;
        }
      } else commands[i] = b.update(sim);
    }
    const events = sim.step(commands);
    if (st.scores[0] + st.scores[1] + st.remainingValue !== st.totalValue) violations++;
    // forced releases this tick (cause: a police tackle or an opponent dash on the same victim)
    const tackled = new Set<EntityId>();
    const dashed = new Set<EntityId>();
    for (const e of events) {
      if (e.type === 'policeTackle' && e.hit) tackled.add(e.victimId);
      else if (e.type === 'dashHit' && e.knockdown) dashed.add(e.victimId);
    }
    for (const e of events) {
      switch (e.type) {
        case 'release': {
          if (!e.forced) break;
          const l = sim.getLoot(e.targetId);
          if (!l) break;
          if (l.kind === 'bank') {
            if (!l.anchored) {
              if (tackled.has(e.charId)) pol.bankInterruptsPolice++;
              else if (dashed.has(e.charId)) pol.bankInterruptsDash++;
            }
          } else if (tackled.has(e.charId)) pol.safeInterruptsPolice++;
          break;
        }
        case 'policeTackle':
          pol.tackleAttempts++;
          if (e.hit) {
            pol.tackles++;
            if (e.victimId <= n) slotStats[e.victimId - 1]!.tackledByPolice++;
            const c = chain.get(e.victimId);
            if (c && e.tick - c.last <= CHAIN_GAP_TICKS) {
              c.run++;
              c.last = e.tick;
            } else {
              if (c) closeChain(c);
              chain.set(e.victimId, { last: e.tick, run: 1 });
            }
          }
          break;
        case 'policeStunned':
          pol.stuns++;
          if (e.byCharId <= n) slotStats[e.byCharId - 1]!.policeStuns++;
          break;
        case 'policeDispatched':
          pol.waves++;
          break;
        case 'bankBodyRecovered':
          if (e.count === 1) firstBankTick = e.tick;
          else if (e.count === 2) secondBankTick = e.tick;
          break;
        case 'finalCountdown':
          fcTick = e.tick;
          break;
        case 'grab':
          lastHolder.set(e.targetId, e.charId);
          break;
        case 'recovered': {
          if (firstScore[e.team] === null) firstScore[e.team] = e.tick;
          if (e.kind === 'bank' && firstBank === null) firstBank = { team: e.team, north: (bankStartY.get(e.lootId) ?? 0) < sim.layout.size.y / 2 };
          if (e.kind === 'smallSafe') pointsBy.small += e.value;
          else if (e.kind === 'largeSafe') pointsBy.large += e.value;
          else {
            pointsBy.bankBuilding += e.value - e.safesValue;
            pointsBy.bankContents += e.safesValue;
          }
          let holders = e.holders.filter((h) => sim.getCharacter(h)!.team === e.team);
          if (!holders.length) {
            const lh = lastHolder.get(e.lootId);
            if (lh !== undefined && sim.getCharacter(lh)!.team === e.team) holders = [lh];
          }
          for (const h of holders) {
            const s = slotStats[h - 1]!;
            s.points += e.value / holders.length;
            s.recoveries[e.kind] += 1 / holders.length;
            if (e.kind === 'bank' && e.safeIds.length > 0) s.banksWhole += 1 / holders.length;
            if (s.firstScoreTick === null) s.firstScoreTick = e.tick;
          }
          break;
        }
        case 'safeUnloaded':
          if (e.byCharId !== null) {
            const s = slotStats[e.byCharId - 1]!;
            s.strips++;
            const by = sim.getCharacter(e.byCharId)!;
            if (e.bankCarrierTeam !== null && e.bankCarrierTeam !== by.team) s.steals++;
          }
          break;
        case 'dashHit':
          if (e.knockdown) {
            slotStats[e.attackerId - 1]!.knockdownsDealt++;
            slotStats[e.victimId - 1]!.knockedDown++;
          }
          break;
        case 'unstuck':
          if (e.entityId <= n) slotStats[e.entityId - 1]!.unstuckEvents++;
          break;
        case 'fenceBroken':
          fences++;
          break;
        default:
          break;
      }
    }
    // progress / stuck accounting
    for (let i = 0; i < n; i++) {
      const b = bots[i]!;
      const ch = sim.characterBySlot(b.slot);
      const intent = b.intent();
      let progress = false;
      if (Math.hypot(ch.pos.x - ref[i]!.x, ch.pos.y - ref[i]!.y) > 1.25) progress = true;
      if (ch.straining || ch.knockdownTicks > 0) progress = true;
      if (ch.grab) {
        const l = sim.getLoot(ch.grab.targetId);
        if (l) {
          const rh = refHeld[i]!;
          if (rh.id !== l.id) {
            rh.id = l.id;
            rh.x = l.pos.x;
            rh.y = l.pos.y;
          } else if (Math.hypot(l.pos.x - rh.x, l.pos.y - rh.y) > 1.25) progress = true;
          if (l.recovery && l.recovery.team === ch.team) progress = true;
        }
      }
      // declared waiting (guarding a door / watching a chokepoint / escorting / yielding /
      // body-blocking an officer that chases a carrying teammate — an escort against the police)
      const waiting = intent.telegraph || ['guard', 'wait', 'escort', 'yield', 'block'].includes(intent.phase);
      if (waiting) slotStats[i]!.idleSeconds += 1 / TICK_RATE;
      const left = (st.endTick - st.tick) / TICK_RATE;
      if ((intent.goal === 'reposition' || intent.goal === 'idle') && !ch.grab && st.remainingValue > 0 && left > 5) {
        slotStats[i]!.passiveSeconds += 1 / TICK_RATE;
        if (st.scores[ch.team] <= st.scores[(1 - ch.team) as TeamId]) slotStats[i]!.passiveBehindSeconds += 1 / TICK_RATE;
      }
      if (st.tick - lastProgress[i]! === 3 * TICK_RATE) {
        const d = b.debug() as { goal: { key: string; phase: string } | null };
        stuckWhat[i] = d.goal ? `${d.goal.key}:${d.goal.phase}` : 'none';
      }
      // loose metric (previous definition)
      {
        let lp = waiting || ch.straining || ch.knockdownTicks > 0 || Math.hypot(ch.pos.x - looseRef[i]!.x, ch.pos.y - looseRef[i]!.y) > 0.75;
        if (ch.grab) {
          const l = sim.getLoot(ch.grab.targetId);
          const lh = looseHeld[i]!;
          if (l) {
            if (lh.id !== l.id || Math.hypot(l.pos.x - lh.x, l.pos.y - lh.y) > 0.75 || (l.recovery && l.recovery.team === ch.team)) lp = true;
            if (lp) looseHeld[i] = { id: l.id, x: l.pos.x, y: l.pos.y };
          }
        }
        if (lp) {
          if (st.tick - looseStart[i]! > 5 * TICK_RATE) slotStats[i]!.stuckIncidentsLoose++;
          looseStart[i] = st.tick;
          looseRef[i] = { ...ch.pos };
        }
      }
      if (progress) {
        closeWindow(slotStats[i]!, lastProgress[i]!, st.tick, waitTicks[i]!, stuckWhat[i]!, ref[i]!);
        ref[i] = { ...ch.pos };
        if (ch.grab) {
          const l = sim.getLoot(ch.grab.targetId);
          if (l) refHeld[i] = { id: l.id, x: l.pos.x, y: l.pos.y };
        }
        lastProgress[i] = st.tick;
        waitTicks[i] = 0;
      } else if (waiting) waitTicks[i]!++;
    }
    spec.onTick?.(sim, events, bots);
  }
  for (let i = 0; i < n; i++) {
    closeWindow(slotStats[i]!, lastProgress[i]!, st.tick, waitTicks[i]!, stuckWhat[i]!, ref[i]!);
    if (st.tick - looseStart[i]! > 5 * TICK_RATE) slotStats[i]!.stuckIncidentsLoose++;
    const b = bots[i]!;
    const s = slotStats[i]!;
    s.dashes = b.stats.dashes;
    s.boosts = b.stats.boosts;
    s.goals = { ...b.stats.goalsByKind };
    s.finalReplans = b.stats.finalReplans;
    s.pingsAnswered = b.stats.pingsAnswered;
    s.goalFails = b.stats.goalFails;
  }
  const layoutId = sim.layout.id;
  const finalLog = [...TeamBoard.for(sim, 0).log, ...TeamBoard.for(sim, 1).log].sort((a, b) => a.tick - b.tick);
  return {
    layout: layoutId,
    seed: spec.seed,
    result: st.result ?? { reason: 'time', winner: st.scores[0] === st.scores[1] ? null : st.scores[0] > st.scores[1] ? 0 : 1, scores: [st.scores[0], st.scores[1]], endTick: st.tick },
    ticks: st.tick,
    invariantViolations: violations,
    slots: slotStats,
    teamScores: [st.scores[0], st.scores[1]],
    firstScoreTick: firstScore,
    finalLog,
    fencesBroken: fences,
    firstBankTick,
    secondBankTick,
    finalCountdownTick: fcTick,
    firstBank,
    pointsBy,
    police: (() => {
      for (const c of chain.values()) closeChain(c);
      return pol;
    })(),
  };
}

/** Police tackles on one victim at most this far apart belong to one chain. */
const CHAIN_GAP_TICKS = Math.round(2.6 * TICK_RATE);

function closeWindow(s: SlotStats, start: number, end: number, waitTicks: number, what: string, pos: { x: number; y: number }): void {
  const dur = (end - start) / TICK_RATE;
  if (dur <= 3) return;
  const rec = { tick: start, dur: +dur.toFixed(1), what, x: +pos.x.toFixed(1), y: +pos.y.toFixed(1) };
  if (waitTicks >= 0.8 * (end - start)) {
    if (dur > 6) {
      s.idleIncidents6s++;
      if (s.idleIncidents.length < 20) s.idleIncidents.push(rec);
    }
    return;
  }
  // the first 3 s of a no-progress window are tolerated
  s.stuckSeconds += dur - 3;
  if (dur > s.maxStuck) s.maxStuck = dur;
  if (dur > 5) {
    s.stuckIncidents5s++;
    if (s.incidents.length < 20) s.incidents.push(rec);
  }
}

// ---------------------------------------------------------------------------
// Series of matches (A vs B, optional side swap) + aggregation
// ---------------------------------------------------------------------------

export interface SideSpec {
  /** One entry per character on this side (1 for 1v1, 2 for 2v2). */
  members: SlotSpec[];
  label?: string;
}

export interface SeriesSpec {
  layouts: LayoutId[];
  a: SideSpec;
  b: SideSpec;
  seeds: number[];
  /** Also play every seed with A on team 1. */
  swap: boolean;
  timing?: boolean;
  rules?: Partial<RuleConfig>;
  onMatch?: (m: SeriesMatch) => void;
}

export interface SeriesMatch {
  layout: LayoutId;
  seed: number;
  /** Team index A played. */
  aTeam: TeamId;
  winner: 'A' | 'B' | null;
  scoreA: number;
  scoreB: number;
  stats: MatchStats;
}

export function runSeries(spec: SeriesSpec): SeriesMatch[] {
  const out: SeriesMatch[] = [];
  for (const layout of spec.layouts) {
    for (const seed of spec.seeds) {
      for (const aTeam of spec.swap ? ([0, 1] as TeamId[]) : ([0] as TeamId[])) {
        const team0 = aTeam === 0 ? spec.a.members : spec.b.members;
        const team1 = aTeam === 0 ? spec.b.members : spec.a.members;
        const stats = runMatch({ layout, team0, team1, seed, timing: spec.timing, rules: spec.rules });
        const w = stats.result.winner;
        const m: SeriesMatch = {
          layout,
          seed,
          aTeam,
          winner: w === null ? null : w === aTeam ? 'A' : 'B',
          scoreA: stats.teamScores[aTeam],
          scoreB: stats.teamScores[(1 - aTeam) as TeamId],
          stats,
        };
        spec.onMatch?.(m);
        out.push(m);
      }
    }
  }
  return out;
}

export interface PersonalityAgg {
  key: string;
  bots: number;
  points: number;
  small: number;
  large: number;
  bank: number;
  banksWhole: number;
  strips: number;
  steals: number;
  knockdowns: number;
  dashes: number;
  boosts: number;
  stuckSeconds: number;
  idleSeconds: number;
  stuck5: number;
  idle6: number;
  passive: number;
  passiveBehind: number;
  maxStuck: number;
  unstuck: number;
  scoredMatches: number;
  firstScoreSum: number;
  firstScoreN: number;
  finalReplans: number;
}

export interface SeriesAggregate {
  matches: number;
  aWins: number;
  bWins: number;
  draws: number;
  /** Win rate of whichever side played team 0 (side fairness). */
  team0Wins: number;
  reasons: Record<string, number>;
  avgScoreA: number;
  avgScoreB: number;
  invariantViolations: number;
  avgFirstScoreS: [number | null, number | null];
  byKey: Record<string, PersonalityAgg>;
  botMsAvg: number;
  botMsMax: number;
  botMsMaxWarm: number;
  /** Share of bot updates slower than 2 ms (after warm-up). */
  botSlowShare: number;
  stuck5: number;
  /** Declared-waiting stretches > 6 s (bots only). */
  idle6: number;
  /** Stuck > 5 s by the previous, looser definition (comparison). */
  stuck5Loose: number;
  /** Seconds per bot per match in the fallback goals with loot left (tied/behind). */
  passiveBehindPerBot: number;
  finalReplans: number;
  /** Human-proxy matches: share of the proxy team's points earned by the bot teammate. */
  teammateShare: number | null;
}

export function aggregate(ms: SeriesMatch[]): SeriesAggregate {
  const agg: SeriesAggregate = {
    matches: ms.length,
    aWins: 0,
    bWins: 0,
    draws: 0,
    team0Wins: 0,
    reasons: {},
    avgScoreA: 0,
    avgScoreB: 0,
    invariantViolations: 0,
    avgFirstScoreS: [null, null],
    byKey: {},
    botMsAvg: 0,
    botMsMax: 0,
    botMsMaxWarm: 0,
    botSlowShare: 0,
    stuck5: 0,
    idle6: 0,
    stuck5Loose: 0,
    passiveBehindPerBot: 0,
    finalReplans: 0,
    teammateShare: null,
  };
  let msTot = 0;
  let msTicks = 0;
  let slow = 0;
  const fs: [number[], number[]] = [[], []];
  let shareNum = 0;
  let shareDen = 0;
  let passiveB = 0;
  let nBots = 0;
  for (const m of ms) {
    if (m.winner === 'A') agg.aWins++;
    else if (m.winner === 'B') agg.bWins++;
    else agg.draws++;
    if (m.stats.result.winner === 0) agg.team0Wins++;
    agg.reasons[m.stats.result.reason] = (agg.reasons[m.stats.result.reason] ?? 0) + 1;
    agg.avgScoreA += m.scoreA / ms.length;
    agg.avgScoreB += m.scoreB / ms.length;
    agg.invariantViolations += m.stats.invariantViolations;
    const fA = m.stats.firstScoreTick[m.aTeam];
    const fB = m.stats.firstScoreTick[(1 - m.aTeam) as TeamId];
    if (fA !== null) fs[0].push(fA / TICK_RATE);
    if (fB !== null) fs[1].push(fB / TICK_RATE);
    for (const s of m.stats.slots) {
      const side = s.team === m.aTeam ? 'A' : 'B';
      const key = s.humanProxy ? `${side}:proxy` : `${side}:${s.personality}/${s.difficulty}`;
      const a = (agg.byKey[key] ??= {
        key,
        bots: 0,
        points: 0,
        small: 0,
        large: 0,
        bank: 0,
        banksWhole: 0,
        strips: 0,
        steals: 0,
        knockdowns: 0,
        dashes: 0,
        boosts: 0,
        stuckSeconds: 0,
        idleSeconds: 0,
        stuck5: 0,
        idle6: 0,
        passive: 0,
        passiveBehind: 0,
        maxStuck: 0,
        unstuck: 0,
        scoredMatches: 0,
        firstScoreSum: 0,
        firstScoreN: 0,
        finalReplans: 0,
      });
      a.bots++;
      a.points += s.points;
      a.small += s.recoveries.smallSafe;
      a.large += s.recoveries.largeSafe;
      a.bank += s.recoveries.bank;
      a.banksWhole += s.banksWhole;
      a.strips += s.strips;
      a.steals += s.steals;
      a.knockdowns += s.knockdownsDealt;
      a.dashes += s.dashes;
      a.boosts += s.boosts;
      a.stuckSeconds += s.stuckSeconds;
      a.idleSeconds += s.idleSeconds;
      a.stuck5 += s.stuckIncidents5s;
      a.idle6 += s.idleIncidents6s;
      a.passive += s.passiveSeconds;
      a.passiveBehind += s.passiveBehindSeconds;
      a.maxStuck = Math.max(a.maxStuck, s.maxStuck);
      a.unstuck += s.unstuckEvents;
      a.finalReplans += s.finalReplans;
      if (s.points > 0) a.scoredMatches++;
      if (s.firstScoreTick !== null) {
        a.firstScoreSum += s.firstScoreTick / TICK_RATE;
        a.firstScoreN++;
      }
      if (!s.humanProxy) {
        msTot += s.botMsTotal;
        msTicks += s.botTicks;
        agg.botMsMax = Math.max(agg.botMsMax, s.botMsMax);
        agg.botMsMaxWarm = Math.max(agg.botMsMaxWarm, s.botMsMaxWarm);
        slow += s.botSlow2ms;
        agg.stuck5 += s.stuckIncidents5s;
        agg.idle6 += s.idleIncidents6s;
        agg.stuck5Loose += s.stuckIncidentsLoose;
        passiveB += s.passiveBehindSeconds;
        nBots++;
        agg.finalReplans += s.finalReplans;
      }
    }
    const proxy = m.stats.slots.find((s) => s.humanProxy);
    if (proxy) {
      const mates = m.stats.slots.filter((s) => s.team === proxy.team && !s.humanProxy);
      const matePts = mates.reduce((x, s) => x + s.points, 0);
      shareNum += matePts;
      shareDen += matePts + proxy.points;
    }
  }
  agg.botMsAvg = msTicks > 0 ? msTot / msTicks : 0;
  agg.botSlowShare = msTicks > 0 ? slow / msTicks : 0;
  agg.avgFirstScoreS = [fs[0].length ? avg(fs[0]) : null, fs[1].length ? avg(fs[1]) : null];
  agg.teammateShare = shareDen > 0 ? shareNum / shareDen : null;
  agg.passiveBehindPerBot = nBots > 0 ? passiveB / nBots : 0;
  return agg;
}

function avg(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

export function formatAggregate(agg: SeriesAggregate, title = ''): string {
  const pct = (x: number): string => `${((100 * x) / Math.max(1, agg.matches)).toFixed(1)}%`;
  const L: string[] = [];
  if (title) L.push(`== ${title}`);
  L.push(
    `matches ${agg.matches}  A wins ${agg.aWins} (${pct(agg.aWins)})  B wins ${agg.bWins} (${pct(agg.bWins)})  draws ${agg.draws} (${pct(agg.draws)})  team0 wins ${pct(agg.team0Wins)}`,
  );
  L.push(
    `end reasons ${Object.entries(agg.reasons)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}  avg score A ${agg.avgScoreA.toFixed(0)} B ${agg.avgScoreB.toFixed(0)}  first score A ${agg.avgFirstScoreS[0]?.toFixed(1) ?? '-'}s B ${agg.avgFirstScoreS[1]?.toFixed(1) ?? '-'}s  invariant violations ${agg.invariantViolations}`,
  );
  L.push(
    `bot cpu avg ${agg.botMsAvg.toFixed(3)} ms/tick/bot  max ${agg.botMsMax.toFixed(2)} ms (after warm-up ${agg.botMsMaxWarm.toFixed(2)} ms, ${(agg.botSlowShare * 100).toFixed(3)}% of updates > 2 ms)  stuck>5s ${agg.stuck5} (looser old metric ${agg.stuck5Loose})  idle>6s ${agg.idle6}  passive-while-not-ahead ${agg.passiveBehindPerBot.toFixed(1)} s/bot  final-30s re-plans ${agg.finalReplans}` +
      (agg.teammateShare !== null ? `  teammate share ${(agg.teammateShare * 100).toFixed(1)}%` : ''),
  );
  L.push('  per bot (averages per match):  pts | small large bank (whole) | strips steals | KOs dashes boosts | stuck s idle s max-stuck stuck>5 idle>6 passive(not ahead) s unstuck | scored% first-score');
  for (const a of Object.values(agg.byKey).sort((x, y) => (x.key < y.key ? -1 : 1))) {
    const n = Math.max(1, a.bots);
    L.push(
      `  ${a.key.padEnd(26)} ${(a.points / n).toFixed(0).padStart(5)} | ${(a.small / n).toFixed(2)} ${(a.large / n).toFixed(2)} ${(a.bank / n).toFixed(2)} (${(a.banksWhole / n).toFixed(2)}) | ${(a.strips / n).toFixed(2)} ${(a.steals / n).toFixed(2)} | ${(a.knockdowns / n).toFixed(2)} ${(a.dashes / n).toFixed(2)} ${(a.boosts / n).toFixed(2)} | ${(a.stuckSeconds / n).toFixed(1)} ${(a.idleSeconds / n).toFixed(1)} ${a.maxStuck.toFixed(1)} ${a.stuck5} ${a.idle6} ${(a.passive / n).toFixed(1)}(${(a.passiveBehind / n).toFixed(1)}) ${(a.unstuck / n).toFixed(2)} | ${((100 * a.scoredMatches) / n).toFixed(0)}% ${a.firstScoreN ? (a.firstScoreSum / a.firstScoreN).toFixed(1) + 's' : '-'}`,
    );
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Match-flow / police metrics (doc §3 match flow, §19 targets; owner police event)
// ---------------------------------------------------------------------------

export interface FlowMetrics {
  matches: number;
  /** Match length quartiles (s). */
  lenQ1: number;
  lenMedian: number;
  lenQ3: number;
  /** Median time of the first bank recovery among matches that had one (s), and share of matches with one. */
  firstBankMedian: number | null;
  firstBankShare: number;
  /** Share of matches whose final countdown (both banks recovered) started before 120 s. */
  fcBefore120: number;
  /** Share of matches whose final countdown started at all. */
  fcShare: number;
  draws: number;
  drawRate: number;
  /** Team 0 wins / decided games. */
  team0Share: number | null;
  tacklesPerMatch: number;
  tackleAttemptsPerMatch: number;
  stunsPerMatch: number;
  wavesPerMatch: number;
  bankInterruptsPolicePerMatch: number;
  bankInterruptsDashPerMatch: number;
  safeInterruptsPolicePerMatch: number;
  /** Share of all recovered points from small safes / large safes / bank buildings / bank contents. */
  shareSmall: number;
  shareLarge: number;
  shareBankBuilding: number;
  shareBankContents: number;
  /** Strict stuck metric: non-waiting no-progress windows > 5 s (all characters incl. proxies). */
  stuck5: number;
  /** ... of which by human proxies. */
  stuck5Proxy: number;
  /** Longest such window of any human proxy (s). */
  proxyMaxStuck: number;
  /** Sim 'unstuck' nudges of characters. */
  unstuck: number;
  /** Share of matches whose first recovered bank was the north one (of those with a bank). */
  firstBankNorth: number | null;
  /** Decided games won by the team that recovered the first bank. */
  firstBankTeamWins: number | null;
  /** Share of police tackle hits that fall in chains of >= 3 on one victim (<= 2.6 s apart). */
  chainShare: number;
  /** Longest tackle chain in any match. */
  chainLongest: number;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

export function flowMetrics(ms: SeriesMatch[]): FlowMetrics {
  const n = Math.max(1, ms.length);
  const lens = ms.map((m) => m.stats.ticks / TICK_RATE).sort((a, b) => a - b);
  const fb = ms.filter((m) => m.stats.firstBankTick !== null).map((m) => m.stats.firstBankTick! / TICK_RATE).sort((a, b) => a - b);
  let draws = 0;
  let t0 = 0;
  let stuck5 = 0;
  let stuck5Proxy = 0;
  let proxyMax = 0;
  let unstuck = 0;
  const pts = { small: 0, large: 0, bankBuilding: 0, bankContents: 0 };
  const pol = { tackles: 0, att: 0, stuns: 0, waves: 0, bip: 0, bid: 0, sip: 0, chainHits: 0, chainLongest: 0 };
  for (const m of ms) {
    const w = m.stats.result.winner;
    if (w === null) draws++;
    else if (w === 0) t0++;
    for (const s of m.stats.slots) {
      stuck5 += s.stuckIncidents5s;
      unstuck += s.unstuckEvents;
      if (s.humanProxy) {
        stuck5Proxy += s.stuckIncidents5s;
        proxyMax = Math.max(proxyMax, s.maxStuck);
      }
    }
    const p = m.stats.pointsBy;
    pts.small += p.small;
    pts.large += p.large;
    pts.bankBuilding += p.bankBuilding;
    pts.bankContents += p.bankContents;
    const q = m.stats.police;
    pol.tackles += q.tackles;
    pol.att += q.tackleAttempts;
    pol.stuns += q.stuns;
    pol.waves += q.waves;
    pol.bip += q.bankInterruptsPolice;
    pol.bid += q.bankInterruptsDash;
    pol.sip += q.safeInterruptsPolice;
    pol.chainHits += q.chainHits ?? 0;
    pol.chainLongest = Math.max(pol.chainLongest, q.chainLongest ?? 0);
  }
  const tot = Math.max(1, pts.small + pts.large + pts.bankBuilding + pts.bankContents);
  const decided = ms.length - draws;
  const withFb = ms.filter((m) => m.stats.firstBank);
  const fbDecided = withFb.filter((m) => m.stats.result.winner !== null);
  return {
    matches: ms.length,
    lenQ1: quantile(lens, 0.25),
    lenMedian: quantile(lens, 0.5),
    lenQ3: quantile(lens, 0.75),
    firstBankMedian: fb.length ? quantile(fb, 0.5) : null,
    firstBankShare: fb.length / n,
    fcBefore120: ms.filter((m) => m.stats.finalCountdownTick !== null && m.stats.finalCountdownTick < 120 * TICK_RATE).length / n,
    fcShare: ms.filter((m) => m.stats.finalCountdownTick !== null).length / n,
    draws,
    drawRate: draws / n,
    team0Share: decided > 0 ? t0 / decided : null,
    tacklesPerMatch: pol.tackles / n,
    tackleAttemptsPerMatch: pol.att / n,
    stunsPerMatch: pol.stuns / n,
    wavesPerMatch: pol.waves / n,
    bankInterruptsPolicePerMatch: pol.bip / n,
    bankInterruptsDashPerMatch: pol.bid / n,
    safeInterruptsPolicePerMatch: pol.sip / n,
    shareSmall: pts.small / tot,
    shareLarge: pts.large / tot,
    shareBankBuilding: pts.bankBuilding / tot,
    shareBankContents: pts.bankContents / tot,
    stuck5,
    stuck5Proxy,
    proxyMaxStuck: proxyMax,
    unstuck,
    firstBankNorth: withFb.length ? withFb.filter((m) => m.stats.firstBank!.north).length / withFb.length : null,
    firstBankTeamWins: fbDecided.length ? fbDecided.filter((m) => m.stats.firstBank!.team === m.stats.result.winner).length / fbDecided.length : null,
    chainShare: pol.tackles > 0 ? pol.chainHits / pol.tackles : 0,
    chainLongest: pol.chainLongest,
  };
}

export const FLOW_HEADER = ['group', 'n', 'len q1/med/q3 s', '1st bank med s (share)', '1st bank north / its team wins', 'FC<120s', 'FC any', 'draws', 'team0 (decided)', 'tackles (att)', 'tackle chains: share / longest', 'stuns', 'waves', 'bank haul broken: police / dash', 'safe carry broken by police', 'pts small / large / bank bldg / bank contents', 'stuck>5s (proxy)', 'unstuck'];

export function flowRow(label: string, f: FlowMetrics): string[] {
  const p = (x: number): string => `${(100 * x).toFixed(0)}%`;
  return [
    label,
    String(f.matches),
    `${f.lenQ1.toFixed(0)} / ${f.lenMedian.toFixed(0)} / ${f.lenQ3.toFixed(0)}`,
    f.firstBankMedian === null ? '-' : `${f.firstBankMedian.toFixed(0)} (${p(f.firstBankShare)})`,
    f.firstBankNorth === null ? '-' : `${p(f.firstBankNorth)} / ${f.firstBankTeamWins === null ? '-' : p(f.firstBankTeamWins)}`,
    p(f.fcBefore120),
    p(f.fcShare),
    `${f.draws} (${p(f.drawRate)})`,
    f.team0Share === null ? '-' : p(f.team0Share),
    `${f.tacklesPerMatch.toFixed(2)} (${f.tackleAttemptsPerMatch.toFixed(2)})`,
    `${p(f.chainShare)} / ${f.chainLongest}`,
    f.stunsPerMatch.toFixed(2),
    f.wavesPerMatch.toFixed(2),
    `${f.bankInterruptsPolicePerMatch.toFixed(2)} / ${f.bankInterruptsDashPerMatch.toFixed(2)}`,
    f.safeInterruptsPolicePerMatch.toFixed(2),
    `${p(f.shareSmall)} / ${p(f.shareLarge)} / ${p(f.shareBankBuilding)} / ${p(f.shareBankContents)}`,
    `${f.stuck5} (${f.stuck5Proxy}, proxy max ${f.proxyMaxStuck.toFixed(1)} s)`,
    String(f.unstuck),
  ];
}
