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
import { RIVALS } from './params';
import type { Adaptation, Difficulty, RivalId } from './types';

export interface SlotSpec {
  personality: RivalId;
  difficulty: Difficulty;
  /** Scripted stand-in for a human player (roster isBot=false). */
  humanProxy?: boolean;
  adaptation?: Adaptation | null;
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
  /** Seconds with no meaningful progress (> 3 s windows). */
  stuckSeconds: number;
  /** Longest no-progress stretch (s). */
  maxStuck: number;
  /** Stretches longer than 5 s. */
  stuckIncidents5s: number;
  /** Seconds in declared waiting (guard/ambush/escort/recovery dwell). */
  idleSeconds: number;
  unstuckEvents: number;
  botMsTotal: number;
  botMsMax: number;
  botTicks: number;
  goals: Record<string, number>;
  finalReplans: number;
  pingsAnswered: number;
  goalFails: number;
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
    unstuckEvents: 0,
    botMsTotal: 0,
    botMsMax: 0,
    botTicks: 0,
    goals: {},
    finalReplans: 0,
    pingsAnswered: 0,
    goalFails: 0,
  }));
  // progress tracking (no meaningful progress for > 3 s)
  const ref = bots.map((b) => ({ ...sim.characterBySlot(b.slot).pos }));
  const refHeld = bots.map(() => ({ id: -1 as EntityId, x: 0, y: 0 }));
  const lastProgress = bots.map(() => 0);
  const stuckStart = bots.map(() => -1);
  let violations = 0;
  const firstScore: [number | null, number | null] = [null, null];
  const commands: Command[] = new Array(n);
  const maxTicks = spec.maxTicks ?? Infinity;
  let fences = 0;
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
      } else commands[i] = b.update(sim);
    }
    const events = sim.step(commands);
    if (st.scores[0] + st.scores[1] + st.remainingValue !== st.totalValue) violations++;
    for (const e of events) {
      switch (e.type) {
        case 'grab':
          lastHolder.set(e.targetId, e.charId);
          break;
        case 'recovered': {
          if (firstScore[e.team] === null) firstScore[e.team] = e.tick;
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
      if (Math.hypot(ch.pos.x - ref[i]!.x, ch.pos.y - ref[i]!.y) > 0.75) progress = true;
      if (ch.straining || ch.knockdownTicks > 0) progress = true;
      if (ch.grab) {
        const l = sim.getLoot(ch.grab.targetId);
        if (l) {
          const rh = refHeld[i]!;
          if (rh.id !== l.id) {
            rh.id = l.id;
            rh.x = l.pos.x;
            rh.y = l.pos.y;
          } else if (Math.hypot(l.pos.x - rh.x, l.pos.y - rh.y) > 0.75) progress = true;
          if (l.recovery && l.recovery.team === ch.team) progress = true;
        }
      }
      const waiting = intent.telegraph || ['guard', 'wait', 'recover', 'escort'].includes(intent.phase) || intent.goal === 'idle' && false;
      if (waiting) slotStats[i]!.idleSeconds += 1 / TICK_RATE;
      if (progress || waiting) {
        ref[i] = { ...ch.pos };
        if (ch.grab) {
          const l = sim.getLoot(ch.grab.targetId);
          if (l) refHeld[i] = { id: l.id, x: l.pos.x, y: l.pos.y };
        }
        if (stuckStart[i]! >= 0) {
          const dur = (st.tick - stuckStart[i]!) / TICK_RATE;
          closeStuck(slotStats[i]!, dur);
          stuckStart[i] = -1;
        }
        lastProgress[i] = st.tick;
      } else if (st.tick - lastProgress[i]! > 3 * TICK_RATE && stuckStart[i]! < 0) {
        stuckStart[i] = lastProgress[i]!;
      }
    }
    spec.onTick?.(sim, events, bots);
  }
  for (let i = 0; i < n; i++) {
    if (stuckStart[i]! >= 0) closeStuck(slotStats[i]!, (st.tick - stuckStart[i]!) / TICK_RATE);
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
  };
}

function closeStuck(s: SlotStats, dur: number): void {
  // the first 3 s of a no-progress window are tolerated
  s.stuckSeconds += Math.max(0, dur - 3);
  if (dur > s.maxStuck) s.maxStuck = dur;
  if (dur > 5) s.stuckIncidents5s++;
}
