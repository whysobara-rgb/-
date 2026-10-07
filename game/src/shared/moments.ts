/**
 * Moment contract (fun round, docs/ARCHITECTURE.md "Fun round contracts"; owner WP5).
 *
 * A Moment is a short, fact-based story beat of the match ("역전!", "막았다!", "피했다!" ...).
 * Moments are produced ONLY by `MomentTracker` (src/game/moments.ts) from the sim state, the
 * tick's sim events and the bots' intents. HUD (WP4), render (WP3), audio (WP8) and feel
 * (src/game/feel.ts) only consume them — they never re-derive a moment from events themselves.
 *
 * The type lives in src/shared so render / audio / ui can import it without depending on game
 * flow; src/game/moments.ts re-exports it. Add-only: new optional fields or new kinds may be
 * appended, nothing is renamed or changes meaning.
 */
import type { EntityId, LootKind, TeamId, Vec2 } from '../sim/types';

export type MomentKind =
  | 'leadTaken'
  | 'equalized'
  | 'matchPointOn'
  | 'matchPointStopped'
  | 'streakTier'
  | 'streakBroken'
  | 'bigPlay'
  | 'stealChance'
  | 'tauntPunished'
  | 'dodged'
  | 'counterDash';

export const MOMENT_KINDS: readonly MomentKind[] = [
  'leadTaken',
  'equalized',
  'matchPointOn',
  'matchPointStopped',
  'streakTier',
  'streakBroken',
  'bigPlay',
  'stealChance',
  'tauntPunished',
  'dodged',
  'counterDash',
];

/** Scoring-run tier (plan WP5: tier 1 = three recoveries in a row or 800 pts, tier 2 = 1000). */
export type StreakTier = 1 | 2;

/**
 * One story beat. Field meaning per kind (`team` is always set):
 *
 * | kind               | team                                   | pos                     | score            | value                          | tier |
 * |--------------------|----------------------------------------|-------------------------|------------------|--------------------------------|------|
 * | leadTaken          | the new leader                          | the flipping recovery   | –                | points of that recovery        | –    |
 * | equalized          | the team that drew level                | the levelling recovery  | –                | points of that recovery        | –    |
 * | matchPointOn       | team on match point (matchPointInfo)    | the decisive load       | –                | its value                      | –    |
 * | matchPointStopped  | team whose match point was STOPPED      | where the load ended up | –                | its value                      | –    |
 * | streakTier         | team on the unanswered scoring run      | last recovery           | –                | run points so far              | 1/2  |
 * | streakBroken       | team whose run was broken               | the breaking recovery   | –                | run points it had              | –    |
 * | bigPlay            | team that made the play                 | where it happened       | big-play rating (≥ 6) | points involved           | –    |
 * | stealChance        | team that can steal (the human's team)  | the best open bank door | –                | points it can pull out (e.g. 300) | – |
 * | tauntPunished      | team of the dasher who hit the taunter  | the hit                 | –                | –                              | –    |
 * | dodged             | team of the character who dodged        | the dodger              | –                | –                              | –    |
 * | counterDash        | team of the local human (clash)         | the clash               | –                | –                              | –    |
 *
 * `ids` (optional) names the entities involved, most relevant first:
 * - leadTaken / equalized / streakTier / streakBroken: [recovered loot id] of the recovery that
 *   caused it;
 * - matchPointOn / matchPointStopped: `matchPointInfo().lootIds` (load first, then a bank's safes);
 * - stealChance: [bank id];
 * - bigPlay: [actor character id, ...loot id(s) involved];
 * - tauntPunished / dodged / counterDash: [actor, other] character ids (tauntPunished: [dasher,
 *   taunter]; dodged: [dodger, bot that wound up]; counterDash: [human, other dasher]).
 *
 * `lootKind` (optional) is the kind of the load involved (leadTaken / equalized / matchPoint* /
 * streak* / bigPlay / stealChance), so HUD (WP4) and audio (WP8) can merge "은행째!" + "역전!" into
 * one stamp / one sting without looking the loot up again.
 *
 * Several moments can share one tick; `observe()` returns them in MOMENT_KINDS order within the
 * tick. Consumers that show only one (banner queue, stingers) pick by their own priority.
 */
export interface Moment {
  kind: MomentKind;
  /** Sim tick the moment happened on. */
  tick: number;
  team: TeamId;
  pos?: Vec2;
  score?: number;
  value?: number;
  tier?: StreakTier;
  ids?: EntityId[];
  lootKind?: LootKind;
}
