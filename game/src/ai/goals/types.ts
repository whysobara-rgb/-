/**
 * (Content 2.0 contract, owner C6) AI goal providers (content-plan §4.5).
 *
 * The rule-based bot (src/ai/bot.ts) builds its candidate goals in `candidates()` and runs the
 * chosen one in `executeGoal()`. Content goals (coins, props, items; wave 2: gimmicks, events) live
 * in providers under src/ai/goals/: every provider proposes candidates for the same utility
 * auction (value per second, x personality, x difficulty noise, hysteresis) and executes the goals
 * of its own `kinds`. Existing goals stay in bot.ts.
 *
 * Rules for providers:
 * - Act only through the returned `Command` (same physics as humans); never sim.debug.
 * - Read only public state: loot, coins, breakables, items on the field, gimmicks, events, police,
 *   own team; opponents ONLY through `view.opponents()` (perception: sight + last sighting, incl.
 *   the visible bag and item). Who holds a piece of loot: own team from `LootState.grabbedBy`
 *   filtered to `view.team`, opponents ONLY through `view.oppHolding(id)` (seen holding it).
 * - Engage opponents with the bot's reaction time: decide on `view.opponents()` (reaction-delayed
 *   by default); `view.opponents(0)` (the current sighting) is for aiming / local avoidance only.
 * - No hidden schedules: a drop / event / gimmick is acted on from its public announcement (or a
 *   visible telegraph) on, never from the config timetable ahead of it.
 * - Difficulty changes decisions and aim only (`DifficultyParams.itemSkill / gimmickSkill /
 *   aimErrorRad`), never speeds, forces or cooldowns.
 * - Deterministic: randomness only from `view.rng()` (the bot's seeded stream).
 * - Classic (`sim.rules.content !== 'v2'`): propose nothing.
 */
import type { Simulation } from '../../sim/sim';
import type { CharacterState, Command, EntityId, LootState, OBB, SimEvent, TeamId, Vec2 } from '../../sim/types';
import type { TeamBoard } from '../board';
import type { GrabSpot } from '../geom';
import type { NavClass, NavGrid } from '../nav';
import type { DifficultyParams, PersonalityWeights } from '../params';
import type { CopView, PoliceSense } from '../policeSense';
import type { OpponentView } from '../perception';
import type { GoalKind, RivalId } from '../types';

/** A bot goal (also the candidate type of the utility auction). */
export interface Goal {
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
  nearBest?: number;
  nearTick?: number;
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
  /** Cop guard: the officer's way to the covered mate around a bank / wall (re-planned now and then). */
  coverPath?: { tick: number; pts: Vec2[] | null };
  /** Cop guard: the officer last covered against. */
  coverCopId?: EntityId;
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
  /** Intercept: what the chased opponent was last seen holding. */
  chasedLoot?: EntityId | null;
  exitDoor?: number;
  exitBank?: EntityId;
  /** The safe this goal already brought out through a door (no second exit manoeuvre). */
  exitDone?: EntityId;
  objPath?: Vec2[] | null;
  stallBest?: number;
  stallPath?: Vec2[] | null;
  objPathTick?: number;
  objPathGoal?: Vec2;
  objPathVer?: number;
  exitRef?: Vec2;
  exitTick?: number;
  exitTries?: number;
  enterRef?: Vec2;
  enterBest?: number;
  exitBest?: number;
  enterTick?: number;
  enterTries?: number;
  enterBackUntil?: number;
  // --- content providers' scratch (src/ai/goals/*, C6) ---
  /** Scoop: the piles this goal set out for (cluster). */
  pileIds?: EntityId[];
  /** Provider sub-mode (e.g. kickPiggy 'kick' | 'smash', useItem target kind). */
  sub?: string;
  /** Stand point a provider walks to before acting (smash / kick). */
  stand?: Vec2;
  /** Tick the provider's action (dash / swing) was pressed, -1 = not yet. */
  pressedTick?: number;
  /** Provider retries / misses on this goal. */
  tries?: number;
  /** Reference value to detect the action's effect (breakable hp, prop coins inside). */
  ref?: number;
  /** Breakable id (smash). */
  breakableId?: string;
}

/** Candidates are goals with a utility (value per second, already weighted). */
export type Candidate = Goal;

export interface MoveResult {
  move: Vec2;
  arrived: boolean;
  stuck: boolean;
}

/**
 * What a provider may see and use of its bot: public state accessors and the bot's motor skills
 * (path following with avoidance and watchdog, goal bookkeeping). One per bot.
 */
export interface BotView {
  readonly sim: Simulation;
  readonly id: EntityId;
  readonly slot: number;
  readonly team: TeamId;
  readonly personality: RivalId;
  /** Scripted human stand-in (tools): no team claims. */
  readonly isProxy: boolean;
  readonly P: DifficultyParams;
  readonly W: PersonalityWeights;
  readonly nav: NavGrid;
  readonly board: TeamBoard;
  /** Public police state (refreshed every tick). */
  ps(): PoliceSense;
  /** The goal currently running (null = none). */
  goal(): Goal | null;
  me(): CharacterState;
  /** Own teammates (not me). */
  mates(): CharacterState[];
  /** Opponents as this bot perceives them (reaction-delayed by default). */
  opponents(delay?: number): OpponentView[];
  /** The bot's seeded random stream. */
  rng(): number;
  /** Throttled probability check (one roll per `period` ticks). */
  rngCheck(p: number, period: number): boolean;
  /** Plain seconds left on the clock. */
  secondsLeft(): number;
  /** Seconds a plan can count on (anticipates the final countdown). */
  planLeft(): number;
  /** Walk distance (m) from me to p (Infinity = unreachable). */
  walkDist(p: Vec2): number;
  /** Carry distance (m) from p to a team's zone for a nav class. */
  carryDist(p: Vec2, cls: NavClass, team?: TeamId): number;
  zoneCenter(team?: TeamId): Vec2;
  zoneOBB(team?: TeamId): OBB;
  /** Another bot of my team claims this goal key / this target id. */
  claimedByOther(key: string, targetId?: EntityId | null): boolean;
  blacklisted(key: string): boolean;
  blacklist(key: string, ticks: number): void;
  mk(kind: GoalKind, key: string, targetId: EntityId | null, utility: number, value: number, est: number, extra?: Partial<Goal>): Goal;
  moveTo(goal: Vec2, cls: NavClass, arrive: number, opts?: { slow?: number; carrying?: boolean }): MoveResult;
  startGoal(g: Goal): void;
  endGoal(why: string, blacklistTicks?: number): void;
  /** Re-decide at the next update (after the reaction delay). */
  markUrgent(): void;
  log(msg: string): void;
  /** A fresh opponent sighting within r of p. */
  threatNear(p: Vec2, r: number): boolean;
  /** Opponents seen holding this loot right now. */
  oppHolding(lootId: EntityId): OpponentView[];
  mateHolders(lootId: EntityId): CharacterState[];
  /** Points a loot item pays if recovered now (props: shell + coins inside). */
  lootValue(l: LootState): number;
  /**
   * Mark this tick's dash as a deliberate item use (a swing). Any other dash an item holder sends
   * with empty hands is dropped by the bot (it would fire the item at nothing).
   */
  intendItemUse(targetId: EntityId | null): void;
  /** Dash at an officer if the burst would knock it over, else null. */
  dashAtCop(cop: CopView): Command | null;
  /** Grab skill (walk to a grab spot, face the anchor, grab exactly that target). */
  grabSkill(g: Goal, target: LootState, spot: GrabSpot, part: 'safe' | 'bankWall', tol: number): { c: Command; status: 'moving' | 'aiming' | 'held' | 'blocked' };
}

/**
 * A provider of content goals (one instance per bot). `propose` appends candidates for the
 * shared auction; `execute` runs a goal of one of its `kinds` (null = idle this tick). Optional
 * (C6 add-only extension of content-plan §4.5's `{ kinds; propose; execute }`):
 * `overlay` may replace the command of whatever goal runs (opportunistic swing, scoop detour;
 * bot.ts runs them each tick in this order: items' swing, police reflexes, props' dash-in-passing,
 * coins' scoop detour; the first non-null wins); `onEvents` sees the new sim events once per update.
 */
export interface GoalProvider {
  readonly kinds: readonly GoalKind[];
  propose(view: BotView, out: Candidate[]): void;
  execute(view: BotView, goal: Goal): Command | null;
  overlay?(view: BotView, c: Command): Command | null;
  onEvents?(view: BotView, events: readonly SimEvent[]): void;
}
