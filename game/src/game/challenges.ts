/**
 * 털이 수첩 challenge book (fun round contract, docs/ARCHITECTURE.md "Fun round contracts";
 * owner WP10). Pure predicates over the event log, in the style of achievements.ts.
 *
 * Consumers build against these signatures now:
 * - WP6 results: `matchChallengeDeltas` -> `MatchOutcomeSummary.challengeDeltas`, and the
 *   next-goal chip from `nextChallenge`.
 * - WP7 menu "이어서 / 다음 목표" card: `nextChallenge`.
 * - WP9 save: stores counters / completed ids as plain strings (ChallengeProgress).
 *
 * STUB: until WP10 lands there are no challenges: deltas are {} and there is no next challenge.
 */
import type { ChallengeProgress } from '../platform/progress';
import type { EntityId, LayoutId, LootKind, MatchResult, SimEvent, TeamId } from '../sim/types';

/** Book pages 견습 / 숙련 / 달인. */
export type ChallengePage = 'apprentice' | 'skilled' | 'master';

/** Cosmetic reward of a challenge (ids owned by WP10: hat ids, van paint ids, the pose slot). */
export interface ChallengeReward {
  kind: 'hat' | 'van' | 'pose';
  id: string;
}

/** One challenge as shown in the book and the next-goal chip. */
export interface ChallengeView {
  id: string;
  page: ChallengePage;
  /** Current progress (cumulative counter, or 0/1 for one-match feats). */
  progress: number;
  /** Requirement (e.g. 10 small safes; 1 for one-match feats). */
  target: number;
  reward: ChallengeReward;
}

/** What one finished match feeds into the book (same shape family as AchievementInput). */
export interface ChallengeMatchInput {
  events: readonly SimEvent[];
  result: MatchResult;
  humanCharId: EntityId;
  humanTeam: TeamId;
  layoutId: LayoutId;
  characters: ReadonlyArray<{ id: EntityId; team: TeamId }>;
  loot: ReadonlyArray<{ id: EntityId; kind: LootKind }>;
  rules: { matchTicks: number; timeLimit: boolean };
}

/**
 * Per-challenge counter increments of one match, with WP10's per-match caps already applied
 * (e.g. small safes ≤ 3 per match). Pure.
 * STUB (WP10): {}.
 */
export function matchChallengeDeltas(input: Readonly<ChallengeMatchInput>): Record<string, number> {
  void input;
  return {};
}

/**
 * The nearest unfinished challenge (the one closest to completion, book order on ties), or null
 * when none is left. Pure.
 * STUB (WP10): null.
 */
export function nextChallenge(progress: Readonly<ChallengeProgress>): ChallengeView | null {
  void progress;
  return null;
}
