/**
 * Public bot contracts (docs/ARCHITECTURE.md "Bot API", doc §11).
 */
import type { Simulation } from '../sim/sim';
import type { Command, EntityId, Vec2 } from '../sim/types';
import type { DifficultyParams } from './params';

/** 호다닥 / 통큰이 / 눈치왕 */
export type RivalId = 'hodadak' | 'tongkeun' | 'nunchi';
/** 입문 / 보통 / 도전 */
export type Difficulty = 'novice' | 'normal' | 'challenge';

export type AdaptationKind = 'ambushChoke' | 'stripBank' | 'guardDoors';

/** One counter chosen between rival games (doc §11 라이벌전의 다음 판). */
export interface Adaptation {
  kind: AdaptationKind;
  chokepointId?: string;
  /** i18n key of the pre-game line, e.g. 'adapt.hodadak.ambushChoke.2'. */
  lineKey: string;
  /** e.g. { choke: 'choke.plaza.bakeryAlley' } (a key; i18n translates nested keys). */
  lineParams?: Record<string, string>;
}

export interface BotOptions {
  slot: number;
  personality: RivalId;
  difficulty: Difficulty;
  adaptation?: Adaptation | null;
  seed: number;
  /**
   * (fun round contract, owner WP7; add-only) Per-field override merged over
   * `DIFFICULTY_PARAMS[difficulty]` (cup steps between difficulties, see
   * `lerpDifficultyParams`, added by WP7). Absent = the plain difficulty. Already applied by
   * `Bot` (merged after DIFFICULTY_PARAMS, before the tests-only `tuning`); ignored by the human
   * proxy. Set through `MatchConfig.botParams` (src/game/setup.ts), which reaches the rival bots
   * only (never the 2:2 teammate).
   */
  params?: Partial<DifficultyParams>;
}

/**
 * (fun round contract, owner WP2; add-only) Text-only bot barks (no voice), shown as a bubble by
 * the view and rate-limited together with taunts. i18n key = `taunt.bark.<BarkKey>`. Hidden by
 * the `showOthersTaunts` setting like taunts.
 * - 'tongkeun.myBank': 통큰이 "내 은행!!" when its bank haul is broken.
 * - 'nunchi.ohMy': 눈치왕 "어머~" when its steal is stopped.
 * - 'hodadak.zoom': 호다닥's quick cheer after a fast small-safe recovery.
 * New keys are appended here (never renamed).
 */
export type BarkKey = 'tongkeun.myBank' | 'nunchi.ohMy' | 'hodadak.zoom';
export const BARK_KEYS: readonly BarkKey[] = ['tongkeun.myBank', 'nunchi.ohMy', 'hodadak.zoom'];

/**
 * (fun round contract, owner WP2) The bot's latest bark. It stays on the intent (intent() may be
 * read any number of times per tick, and decisions do not run every tick); consumers show a bark
 * once per distinct `tick` per bot (edge-detect on `tick`, like `EmoteState.startTick`).
 */
export interface BotBark {
  key: BarkKey;
  /** `sim.state.tick` at the bot update that started the bark. */
  tick: number;
}

export type GoalKind =
  | 'collectSafe'
  | 'stripBank'
  | 'haulBank'
  | 'assistHaul'
  | 'intercept'
  | 'defendDoor'
  | 'escort'
  | 'ambush'
  | 'followPing'
  | 'reposition'
  | 'idle'
  // (Content 2.0 contract, owner C6; add-only) goals of the content providers (src/ai/goals/*):
  // wave 1: coins / props / items; wave 2: gimmicks / events
  | 'smash'
  | 'scoop'
  | 'deposit'
  | 'fetchItem'
  | 'bonk'
  | 'useItem'
  | 'kickPiggy'
  | 'useGimmick'
  | 'collectEvent'
  | 'stunCraneCat'
  | 'grabGondola';

/**
 * What a bot is doing, for the renderer/HUD (doc §11 "짧은 준비 동작"): while `telegraph` is
 * true the bot pauses and turns toward `targetPos` before committing to a new goal.
 */
export interface BotIntent {
  goal: GoalKind;
  targetId: EntityId | null;
  targetPos: Vec2 | null;
  telegraph: boolean;
  /**
   * Short machine-readable phase ('approach', 'grab', 'strain', 'carry', 'haul', 'guard', ...).
   * (fun round contract, owner WP2) 'windup' = the readable dash wind-up before a dash fires
   * (`DifficultyParams.dashWindupTicks`); the target is `windupTargetId`. The view plays the
   * wind-up telegraph (crouch + spark ring) from it and MomentTracker detects `dodged` from it,
   * so the intent must say 'windup' on EVERY tick the wind-up runs (from the update that starts
   * it to the one that fires or cancels it), not only on decision ticks.
   * (Content 2.0 contract, owner C6) 'itemWindup' = the bot pressed an item (뿅망치 wind-up / swing,
   * sim-enforced for everyone); `windupTargetId` names the character it swings at, if any.
   */
  phase: string;
  /** (fun round contract, owner WP2; add-only) Character targeted by a 'windup' dash; null / absent otherwise. */
  windupTargetId?: EntityId | null;
  /**
   * (fun round contract, owner WP2; add-only) The latest bark (null / absent = none yet). Not a
   * one-shot: show it once per new `bark.tick`.
   */
  bark?: BotBark | null;
}

export interface BotController {
  readonly slot: number;
  update(sim: Simulation): Command;
  /** Current intent (render: telegraph / target highlight; tools: logging). */
  intent?(): BotIntent;
  debug?(): unknown;
}
