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
  | 'counterDash'
  // Content 2.0 (content-plan §4.5; C0 contract, produced by WP5/F5's MomentTracker, add-only)
  | 'coinSplash'
  | 'jackpot'
  | 'hammerBonk'
  | 'homeRun'
  | 'goldHammer'
  | 'tossScore'
  | 'craneDrop'
  | 'eventHaul';

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
  'coinSplash',
  'jackpot',
  'hammerBonk',
  'homeRun',
  'goldHammer',
  'tossScore',
  'craneDrop',
  'eventHaul',
];

/**
 * Scoring-run tier of an unanswered run (MOMENT_RULES in src/game/moments.ts; tuned on the P block
 * to tier 1 in 30-40 % / tier 2 in 15-25 % of matches): tier 1 = 4 recoveries, or 25 % of
 * `state.totalValue` over >= 3 recoveries; tier 2 = 31 % of `state.totalValue` over >= 2
 * recoveries (classic 3200: 800 / ~1000). A coin deposit >= 50 counts as a recovery.
 */
export type StreakTier = 1 | 2;

/**
 * One story beat. Field meaning per kind (`team` is always set):
 *
 * | kind               | team                                   | pos                     | score            | value                          | tier |
 * |--------------------|----------------------------------------|-------------------------|------------------|--------------------------------|------|
 * | leadTaken          | the new leader                          | the flipping recovery   | –                | points of that recovery        | –    |
 * | equalized          | the team that drew level                | the levelling recovery  | –                | points of that recovery        | –    |
 * | matchPointOn       | team on match point (matchPointInfo)    | the decisive load       | –                | its value                      | –    |
 * | matchPointStopped  | team whose match point was STOPPED (by the other team: `cause` / `by`) | where the load ended up | – | its value  | –    |
 * | streakTier         | team on the unanswered scoring run      | last recovery           | –                | run points so far              | 1/2  |
 * | streakBroken       | team whose run was broken               | the breaking recovery   | –                | run points it had              | –    |
 * | bigPlay            | team that made the play                 | where it happened       | big-play rating (≥ 6) | points involved           | –    |
 * | stealChance        | team that can steal (the human's team)  | the best open bank door | –                | points it can pull out (e.g. 300) | – |
 * | tauntPunished      | team of the dasher who hit the taunter  | the hit                 | –                | –                              | –    |
 * | dodged             | team of the character who dodged        | the dodger              | –                | –                              | –    |
 * | counterDash        | team of the local human (clash)         | the clash               | –                | –                              | –    |
 * | coinSplash         | team that CAUSED a spill >= 60          | the spill               | –                | spilled value                  | –    |
 * | jackpot            | team of the smasher / door breaker      | piggy / truck           | –                | value released (300 / 400)     | –    |
 * | hammerBonk         | team of the hammerer                    | the hit                 | –                | victim's held value (loot+bag) | –    |
 * | homeRun            | team of the hammerer (victim on soap)   | the hit                 | –                | victim's held value            | –    |
 * | goldHammer         | team that picked it up                  | the pickup              | –                | –                              | –    |
 * | tossScore          | team that recovered tossed / tubed loot | the recovery            | –                | points of that recovery        | –    |
 * | craneDrop          | team that stunned the crane cat         | where the bank dropped  | –                | the bank's value               | –    |
 * | eventHaul          | team that recovered >= 200 event value  | last event recovery     | –                | event value recovered          | –    |
 *
 * `ids` (optional) names the entities involved, most relevant first:
 * - leadTaken / equalized / streakTier / streakBroken: [recovered loot id] of the recovery that
 *   caused it;
 * - matchPointOn / matchPointStopped: `matchPointInfo().lootIds` (load first, then a bank's safes;
 *   [] for a coin-bag load — its carriers are in `bagCharIds`);
 * - stealChance: [bank id];
 * - bigPlay: [actor character id, ...loot id(s) involved];
 * - tauntPunished / dodged / counterDash: [actor, other] character ids (tauntPunished: [dasher,
 *   taunter]; dodged: [dodger, bot that wound up]; counterDash: [human, other dasher]).
 * - Content 2.0: coinSplash / hammerBonk / homeRun: [actor, victim]; jackpot: [actor, piggy loot
 *   id] (truck: [actor]); goldHammer: [picker]; tossScore: [recovered loot id]; craneDrop: [cat
 *   stunner, bank id]; eventHaul: [event loot id(s)] (coins: []).
 * Content 2.0 timing (F5): streak tiers are fractions of `state.totalValue` (see StreakTier); a
 * deposit (`coinsBanked`) >= 50 counts as a recovery for runs; `bigPlay` adds jackpot 3,
 * hammerBonk on a bank hauler 4, craneDrop 4, homeRun 3.
 *
 * `matchPointStopped` is only produced when an opposing action brought the load down (see
 * `cause`); a load let go, swapped or lost to a police tackle ends the match point silently, so
 * "막았다!" credited to the other team is always true.
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
  /**
   * (add-only, F5) matchPointStopped: what the other team did — 'hit' (knockdown / hammer on a
   * carrier, or a hammer on the load), 'spill' (knocked a decisive bag loose), 'steal' (pulled a
   * safe out of the hauled bank), 'grab' (grabbed the load), 'score' (scored, so the load is no
   * longer decisive).
   */
  cause?: 'hit' | 'spill' | 'steal' | 'grab' | 'score';
  /** (add-only, F5) matchPointStopped: the opposing character who did it (absent if unknown). */
  by?: EntityId;
  /** (add-only, F5) matchPointOn / matchPointStopped: carriers of the decisive coin bags. */
  bagCharIds?: EntityId[];
}
