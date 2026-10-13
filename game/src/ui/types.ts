/**
 * UI-side domain types. String unions mirror docs/ARCHITECTURE.md (ai/platform modules) so
 * values pass straight through without mapping; the UI does not import those modules.
 */
import type { HatId } from '../sim/types';
import type { RivalId } from './core/icons';

export type { RivalId } from './core/icons';

/** 입문 / 보통 / 도전 (ai Difficulty). */
export type Difficulty = 'novice' | 'normal' | 'challenge';
export const DIFFICULTIES: readonly Difficulty[] = ['novice', 'normal', 'challenge'];

export type MatchMode = '1v1' | '2v2';
export const MATCH_MODES: readonly MatchMode[] = ['1v1', '2v2'];

/** Tournament order (doc §12): 호다닥 -> 통큰이 -> 눈치왕. */
export const RIVAL_ORDER: readonly RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];

/** Hat each rival awards when beaten. */
export const RIVAL_REWARD_HAT: Readonly<Record<RivalId, HatId>> = {
  hodadak: 'hodadakBand',
  tongkeun: 'tongkeunHat',
  nunchi: 'nunchiMask',
};

export const ALL_HATS: readonly HatId[] = ['none', 'teamCapA', 'teamCapB', 'hodadakBand', 'tongkeunHat', 'nunchiMask'];

/** ai Adaptation.kind (doc §11 다음 판). */
export type AdaptationKind = 'ambushChoke' | 'stripBank' | 'guardDoors';

export type GrabMode = 'hold' | 'toggle';
export type Quality = 'low' | 'medium' | 'high';

/** Steam achievement ids (platform/steam.ts uses the same strings). */
export const ACHIEVEMENT_IDS = [
  'FIRST_RECOVERY',
  'BANK_WHOLE',
  'BANK_HEIST_TEAM',
  'STEAL_LARGE',
  'FENCE_BREAKER',
  'LAST_SECONDS',
  'COMEBACK',
  'BEAT_HODADAK',
  'BEAT_TONGKEUN',
  'BEAT_NUNCHI',
  'TOURNAMENT_CLEAR',
  'WARDROBE',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** i18n key for a rival adaptation line variant (1..3). */
export function adaptationLineKey(rival: RivalId, kind: AdaptationKind, variant: 1 | 2 | 3): string {
  return `adapt.${rival}.${kind}.${variant}`;
}

/** i18n key for "what the player can switch to" against an adaptation. */
export function adaptationHintKey(kind: AdaptationKind): string {
  return `adapt.hint.${kind}`;
}
