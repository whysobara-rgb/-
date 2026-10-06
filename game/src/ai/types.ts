/**
 * Public bot contracts (docs/ARCHITECTURE.md "Bot API", doc §11).
 */
import type { Simulation } from '../sim/sim';
import type { Command, EntityId, Vec2 } from '../sim/types';

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
  | 'idle';

/**
 * What a bot is doing, for the renderer/HUD (doc §11 "짧은 준비 동작"): while `telegraph` is
 * true the bot pauses and turns toward `targetPos` before committing to a new goal.
 */
export interface BotIntent {
  goal: GoalKind;
  targetId: EntityId | null;
  targetPos: Vec2 | null;
  telegraph: boolean;
  /** Short machine-readable phase ('approach', 'grab', 'strain', 'carry', 'haul', 'guard', ...). */
  phase: string;
}

export interface BotController {
  readonly slot: number;
  update(sim: Simulation): Command;
  /** Current intent (render: telegraph / target highlight; tools: logging). */
  intent?(): BotIntent;
  debug?(): unknown;
}
