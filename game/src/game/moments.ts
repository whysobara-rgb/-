/**
 * MomentTracker (fun round contract, docs/ARCHITECTURE.md "Fun round contracts"; owner WP5).
 *
 *   const tracker = new MomentTracker({ localTeam: 0, localCharId: meId });
 *   const events = sim.step(cmds);
 *   const moments = tracker.observe(sim.state, events, botIntents);   // once per tick, after step
 *   const snap = tracker.snapshot();                                  // continuous state
 *
 * Per-tick wiring in match.ts (MatchController.stepOnce, see docs/ARCHITECTURE.md):
 *   `funObserve` (WP5): observe -> feel (glance / slow-mo / hit-stop), view.onMoments,
 *   view.setDecisiveLoad / setStealChance / setRunHeat / setBotWindup / showBark from the
 *   snapshot and intents, director.setTension + director.onMoments — all BEFORE
 *   director.onEvents of the same tick, so the coin climb already sees this tick's run.
 *   `funHud` (WP4): the same moments + snapshot -> HUD stamps, match-point prompt, crown, banners.
 *
 * Pure and deterministic: the same (state, events, intents) sequence always yields the same
 * moments; no wall clock, no Math.random, no DOM. Match point itself comes from
 * `matchPointInfo` (src/sim/queries.ts) — the tracker turns its on/off edges into moments.
 *
 * Moments are EDGES (something happened this tick). Things that are shown WHILE they last
 * (decisive-load glow, steal marker, scoring-run heat, heartbeat, crown) come from `snapshot()`,
 * so no consumer has to work out on its own when such a state ends (a run expiring after a
 * 25 s gap, a steal chance closing, ...).
 *
 * STUB: until WP5 lands, observe() returns [] and snapshot() returns the neutral snapshot
 * (consumers must already handle "no moments" / "nothing active").
 */
import type { BotIntent } from '../ai/types';
import type { MatchPointInfo } from '../sim/queries';
import type { EntityId, LootKind, SimEvent, SimState, TeamId, Vec2 } from '../sim/types';
import type { Moment, StreakTier } from '../shared/moments';

export type { Moment, MomentKind, StreakTier } from '../shared/moments';
export { MOMENT_KINDS } from '../shared/moments';

/** One bot's intent this tick (from `BotController.intent()`), keyed by its character id. */
export interface BotIntentSample {
  charId: EntityId;
  intent: BotIntent;
}

export interface MomentTrackerOptions {
  /** Team of the local human (stealChance, dodged and counterDash are about the human). */
  localTeam: TeamId;
  /** Character id of the local human (null = spectating / bot-only harness). */
  localCharId: EntityId | null;
  /** Mirror of RuleConfig.earlyDecision for matchPointInfo (default true). */
  earlyDecision?: boolean;
}

/** The current unanswered scoring run (only one team can be on a run at a time). */
export interface ScoringRun {
  team: TeamId;
  /** Recoveries in the run so far (>= 1); drives the coin pitch climb (WP8). */
  recoveries: number;
  /** Points scored in the run so far. */
  points: number;
  /** 0 = no tier yet; 1 / 2 as in `streakTier` (drives the van heat rim, WP3). */
  tier: 0 | StreakTier;
  /** Tick of the run's latest recovery (the run lapses 25 s after it). */
  lastTick: number;
}

/** The single best steal opportunity for the local human (marker "빼내기 +{value}"). */
export interface StealChanceInfo {
  /** Opposing bank being hauled that still holds safes. */
  bankId: EntityId;
  /** World position of the chosen open door. */
  doorPos: Vec2;
  /** Points that can be pulled out (the best safe through that door). */
  value: number;
}

/** Continuous tracker state after the latest observe() (read-only; replaced each tick). */
export interface MomentSnapshot {
  /** Tick of the latest observe() (-1 before the first). */
  tick: number;
  /** `matchPointInfo(state, { earlyDecision })` as of that tick. */
  matchPoint: MatchPointInfo | null;
  /** Team strictly ahead on confirmed score (null = level). Crown (WP4). */
  leader: TeamId | null;
  run: ScoringRun | null;
  stealChance: StealChanceInfo | null;
  /** Kind of the decisive load (convenience for labels / stings; null without match point). */
  matchPointKind: LootKind | null;
}

/** Snapshot before the first observe() / after reset(), and the stub's constant answer. */
export const EMPTY_MOMENT_SNAPSHOT: Readonly<MomentSnapshot> = Object.freeze({
  tick: -1,
  matchPoint: null,
  leader: null,
  run: null,
  stealChance: null,
  matchPointKind: null,
});

export class MomentTracker {
  readonly options: Readonly<MomentTrackerOptions>;

  constructor(options: MomentTrackerOptions) {
    this.options = { ...options };
  }

  /**
   * Feed one sim tick (call after `sim.step`, with that step's events and the bots' intents read
   * for the same tick). Returns the moments that happened on this tick, oldest first; [] when
   * nothing did. Never mutates its inputs.
   */
  observe(_state: Readonly<SimState>, _events: readonly SimEvent[], _botIntents: readonly BotIntentSample[]): Moment[] {
    return [];
  }

  /**
   * Continuous state as of the latest observe() (see MomentSnapshot). Cheap; safe to call any
   * number of times per tick and from any consumer.
   */
  snapshot(): Readonly<MomentSnapshot> {
    return EMPTY_MOMENT_SNAPSHOT;
  }

  /** Forget all history (new match / rematch on the same tracker). */
  reset(): void {}
}
