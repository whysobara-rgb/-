/**
 * Achievement conditions and stat summaries derived from REAL match records (the sim event
 * log), never from guesses — the same principle as the results screen (doc §12).
 *
 * Pure functions over `SimEvent[]`, so they are unit-testable and give identical answers for
 * replays. Game flow calls them once when a match ends:
 *
 *   const input = { events: sim.eventLog, result: sim.state.result!, humanCharId, humanTeam,
 *                   characters: sim.state.characters, loot: sim.state.loot };
 *   awardAchievements(evaluateMatchAchievements(input));
 *   save.update((d) => { d.stats = applyMatchStats(d.stats, summarizeMatchStats(input)); });
 *
 * Tournament / wardrobe achievements come from the save itself (`progressAchievements`).
 */
import { secondsToTicks } from '../sim/config';
import type { EmoteId, EndReason, EntityId, LayoutId, LootKind, MatchResult, SimEvent, TeamId } from '../sim/types';
import { RIVALS, RIVAL_REWARD_HAT, getSaveManager, type MatchStatsSummary, type RivalId, type SaveData, type SaveManager } from './save';
import { unlockHat, type CosmeticsData } from './save';
import { ACHIEVEMENT_IDS, unlockAchievement, type AchievementId } from './steam';

export interface MatchRecordInput {
  events: readonly SimEvent[];
  result: MatchResult;
  humanCharId: EntityId;
  humanTeam: TeamId;
  /** Every character's id and team (sim.state.characters). */
  characters: ReadonlyArray<{ id: EntityId; team: TeamId }>;
  /** Every loot id and kind (sim.state.loot). */
  loot: ReadonlyArray<{ id: EntityId; kind: LootKind }>;
}

/** A character who let go of an item this recently still counts as having recovered it (pushed it in). */
export const PARTICIPATION_GRACE_TICKS = secondsToTicks(3);
/** LAST_SECONDS: completion within the final 5 s of a match that ran out the clock. */
export const LAST_SECONDS_TICKS = secondsToTicks(5);
/** COMEBACK: win after trailing by more than this many confirmed points. */
export const COMEBACK_DEFICIT = 500;

/** Achievements earned in one finished match, in ACHIEVEMENT_IDS order. */
export function evaluateMatchAchievements(m: MatchRecordInput): AchievementId[] {
  const human = m.humanCharId;
  const myTeam = m.humanTeam;
  const kindOf = new Map(m.loot.map((l) => [l.id, l.kind] as const));
  const teammates = m.characters.filter((c) => c.team === myTeam && c.id !== human).map((c) => c.id);
  const holders = new Map<EntityId, Set<EntityId>>();
  const lastRelease = new Map<string, number>();
  const stolenLarge = new Set<EntityId>();
  const scores: [number, number] = [0, 0];
  let maxDeficit = 0;
  const out = new Set<AchievementId>();

  const key = (charId: EntityId, lootId: EntityId): string => `${charId}:${lootId}`;
  const took = (charId: EntityId, lootId: EntityId, tick: number, atEnd: readonly EntityId[]): boolean => {
    if (atEnd.includes(charId)) return true;
    const rel = lastRelease.get(key(charId, lootId));
    return rel !== undefined && tick - rel <= PARTICIPATION_GRACE_TICKS;
  };

  for (const e of m.events) {
    switch (e.type) {
      case 'grab': {
        let set = holders.get(e.targetId);
        if (!set) holders.set(e.targetId, (set = new Set()));
        set.add(e.charId);
        break;
      }
      case 'release':
        holders.get(e.targetId)?.delete(e.charId);
        lastRelease.set(key(e.charId, e.targetId), e.tick);
        break;
      case 'fenceBroken':
        if (holders.get(e.bankId)?.has(human)) out.add('FENCE_BREAKER');
        break;
      case 'safeUnloaded':
        if (e.byCharId === human && kindOf.get(e.safeId) === 'largeSafe' && e.bankCarrierTeam !== null && e.bankCarrierTeam !== myTeam) {
          stolenLarge.add(e.safeId);
        }
        break;
      case 'recovered': {
        scores[e.team] += e.value;
        maxDeficit = Math.max(maxDeficit, scores[myTeam === 0 ? 1 : 0] - scores[myTeam]);
        if (e.team === myTeam) {
          const humanIn = took(human, e.lootId, e.tick, e.holders);
          if (humanIn) out.add('FIRST_RECOVERY');
          if (e.kind === 'bank' && humanIn) {
            out.add('BANK_WHOLE');
            if (teammates.some((t) => took(t, e.lootId, e.tick, e.holders))) out.add('BANK_HEIST_TEAM');
          }
          if (stolenLarge.has(e.lootId) || e.safeIds.some((id) => stolenLarge.has(id))) out.add('STEAL_LARGE');
          if (humanIn && m.result.reason === 'time' && e.tick >= m.result.endTick - LAST_SECONDS_TICKS) out.add('LAST_SECONDS');
        }
        holders.delete(e.lootId);
        for (const id of e.safeIds) holders.delete(id);
        break;
      }
      default:
        break;
    }
  }
  if (m.result.winner === myTeam && maxDeficit > COMEBACK_DEFICIT) out.add('COMEBACK');
  return ACHIEVEMENT_IDS.filter((id) => out.has(id));
}

/** Stats contribution of one finished match (player's team). */
export function summarizeMatchStats(m: Pick<MatchRecordInput, 'events' | 'result' | 'humanTeam'>): MatchStatsSummary {
  let banks = 0;
  let safes = 0;
  for (const e of m.events) {
    if (e.type !== 'recovered' || e.team !== m.humanTeam) continue;
    if (e.kind === 'bank') {
      banks++;
      safes += e.safeIds.length;
    } else safes++;
  }
  const w = m.result.winner;
  return {
    outcome: w === null ? 'draw' : w === m.humanTeam ? 'win' : 'loss',
    teamScore: m.result.scores[m.humanTeam],
    banksRecovered: banks,
    safesRecovered: safes,
  };
}

const BEAT: Readonly<Record<(typeof RIVALS)[number], AchievementId>> = {
  hodadak: 'BEAT_HODADAK',
  tongkeun: 'BEAT_TONGKEUN',
  nunchi: 'BEAT_NUNCHI',
};

/** Tournament and wardrobe achievements implied by the save (idempotent). */
export function progressAchievements(save: Readonly<SaveData>): AchievementId[] {
  const out = new Set<AchievementId>();
  for (const r of save.tournament.beaten) out.add(BEAT[r]);
  if (RIVALS.every((r) => save.tournament.beaten.includes(r))) out.add('TOURNAMENT_CLEAR');
  if (RIVALS.every((r) => save.cosmetics.unlocked.includes(RIVAL_REWARD_HAT[r]))) out.add('WARDROBE');
  return ACHIEVEMENT_IDS.filter((id) => out.has(id));
}

/** Unlock a list of achievements; returns the ones that were new (for toasts). */
export function awardAchievements(ids: readonly AchievementId[], save: SaveManager = getSaveManager()): AchievementId[] {
  return ids.filter((id) => unlockAchievement(id, save));
}

// =============================================================================================
// Save v2 contract (fun round, docs/ARCHITECTURE.md "Fun round contracts"; owner WP9).
//
// TYPES + HELPER SIGNATURES ONLY. The live save is still SAVE_VERSION 1 and does not hold these
// fields yet; WP9 adds them to `SaveData` (as `SaveData & ProgressV2`), bumps SAVE_VERSION to
// PROGRESS_V2_SAVE_VERSION, appends the 1 -> 2 migration, sanitizes every field, and implements
// the helpers below. Until then the helpers are harmless stubs: they never write the save and
// return neutral values (no record, empty records, no cup progress). Consumers (WP6 results,
// WP7 cups / onboarding / menu card, WP10 challenge book) build against these signatures now.
// Everything stays local: nothing here is ever sent over the network.
// =============================================================================================

/** SAVE_VERSION WP9 moves to (do not use before WP9 lands). */
export const PROGRESS_V2_SAVE_VERSION = 2;

/** Bot difficulty as stored in the save (mirrors ai `Difficulty`; platform does not import ai). */
export type SaveDifficulty = 'novice' | 'normal' | 'challenge';

/** Tournament cups 입문 / 보통 / 도전 (WP7). Ids match the difficulty names they start from. */
export type CupId = 'novice' | 'normal' | 'challenge';
export const CUP_IDS: readonly CupId[] = ['novice', 'normal', 'challenge'];

/** Match layouts that keep records (the tutorial never does). */
export type RecordLayoutId = Exclude<LayoutId, 'tutorial'>;
export const RECORD_LAYOUT_IDS: readonly RecordLayoutId[] = ['plaza', 'shortcut', 'counter'];

/** Head-to-head bucket: quick match at a difficulty, or a tournament cup. */
export type RivalRecordKey = `quick.${SaveDifficulty}` | `cup.${CupId}`;

/** Head-to-head record against one rival in one bucket (results "3승 5패 · 2연패 중"). */
export interface RivalRecord {
  wins: number;
  losses: number;
  draws: number;
  /** Signed current streak: +n = n wins in a row, -n = n losses in a row, 0 = last was a draw / none. */
  streak: number;
  /** Player team's score in the last match against this rival (0 = none yet). */
  lastScore: number;
  /** Best winning margin against this rival (0 = never won). */
  bestMargin: number;
}

/** Per layout x rival personal bests (results record chip). */
export interface LayoutRecord {
  bestScore: number;
  /** Best winning margin (0 = never won here). */
  bestMargin: number;
}

export interface GlobalRecords {
  /** Biggest single recovery (points) by the player's team (0 = none). */
  biggestHaul: number;
  /** Fewest ticks from match start to the player's team's first recovery (null = none yet). */
  fastestFirstRecovery: number | null;
}

/** Which record a match just broke (WP6 shows at most one "신기록" chip). */
export type RecordKind = 'layoutBestScore' | 'layoutBestMargin' | 'biggestHaul' | 'fastestFirstRecovery';

/** 털이 수첩 progress (WP10 owns the challenge ids; stored as plain strings). */
export interface ChallengeProgress {
  /** Cumulative counters by challenge id (already capped per match by WP10's caps). */
  counters: Record<string, number>;
  /** Completed challenge ids, in completion order. */
  completed: string[];
}

/** First-hour path "첫 출동" (WP7): 연습 -> 첫 대전 -> 경찰 출동 대전 -> 대회 입문 컵. */
export type OnboardingStep = 'practice' | 'firstMatch' | 'policeMatch' | 'starterCup';
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['practice', 'firstMatch', 'policeMatch', 'starterCup'];

export interface OnboardingState {
  /** Steps done, in ONBOARDING_STEPS order. */
  done: OnboardingStep[];
  /** The player dismissed the strip (or it auto-skipped after a win at normal). Nothing is ever locked. */
  dismissed: boolean;
}

/** Local-only funnel counters (playtest debug screen; never sent anywhere). */
export type FunnelKey =
  | 'resultsShown'
  | 'rematchPress'
  | 'nextPress'
  | 'menuPress'
  | 'matchStarted'
  | 'matchFinished'
  | 'sessionStarted';
export const FUNNEL_KEYS: readonly FunnelKey[] = [
  'resultsShown',
  'rematchPress',
  'nextPress',
  'menuPress',
  'matchStarted',
  'matchFinished',
  'sessionStarted',
];

export interface FunnelCounters {
  counts: Record<FunnelKey, number>;
  /** Matches finished in the current session (reset on sessionStarted). */
  matchesThisSession: number;
  /** Distinct local calendar days with at least one finished match. */
  playDays: number;
  /** Last play day as local 'YYYY-MM-DD' (null = never). */
  lastPlayDay: string | null;
  /** First-time milestones (e.g. 'firstWin', 'firstHat', 'starterCupR1') -> epoch ms. */
  milestones: Record<string, number>;
}

/** Facts about one finished match, built by game flow from the event log + result (WP6). */
export interface MatchOutcomeSummary {
  /** Unique per match (e.g. `${seed}:${startedAtMs}`); recordMatchOutcome is idempotent per id. */
  matchId: string;
  layoutId: LayoutId;
  /** Rival personality of the opposing team (null = no rival, e.g. the tutorial). */
  rival: RivalId | null;
  /** Match kind (MatchConfig.kind). */
  mode: 'quick' | 'tournament' | 'tutorial';
  /** Team size (MatchConfig.mode): records and head-to-head may treat 2:2 differently. */
  teamMode: '1v1' | '2v2';
  /** Quick-match difficulty (tournament matches are bucketed by `cup` instead). */
  difficulty: SaveDifficulty;
  /** Cup of a tournament match (null otherwise). */
  cup: CupId | null;
  outcome: 'win' | 'loss' | 'draw';
  /** Player team's confirmed score. */
  myScore: number;
  /** Opposing team's confirmed score. */
  theirScore: number;
  endReason: EndReason;
  /** Ticks played. */
  ticks: number;
  /** Biggest single recovery by the player's team (0 = none). */
  biggestHaul: number;
  /** Tick of the player's team's first recovery (null = none). */
  firstRecoveryTick: number | null;
  /** Largest deficit the player's team overcame or suffered (confirmed points, >= 0). */
  maxDeficit: number;
  /** Per-challenge counter increments of this match (WP10 caps applied by the producer). */
  challengeDeltas?: Record<string, number>;
  /** Wall-clock epoch ms when the match finished (funnel / recent list only; never gameplay). */
  finishedAt: number;
}

/** Ring buffer size of `recent`. */
export const RECENT_MAX = 20;

/** Fields WP9 adds to SaveData in v2. */
export interface ProgressV2 {
  rivals: Record<RivalId, Partial<Record<RivalRecordKey, RivalRecord>>>;
  records: Record<RecordLayoutId, Partial<Record<RivalId, LayoutRecord>>>;
  globalRecords: GlobalRecords;
  /** Rivals cleared per cup (the v1 `tournament.beaten` list migrates under 'normal'). */
  cups: Record<CupId, RivalId[]>;
  challenges: ChallengeProgress;
  /** Last RECENT_MAX match summaries, oldest first. */
  recent: MatchOutcomeSummary[];
  onboarding: OnboardingState;
  funnel: FunnelCounters;
}

/**
 * v2 additions to `CosmeticsData` (WP9 stores + sanitizes them; WP10 owns the paint ids and
 * rewards). Cosmetic only: setup passes them to render, never to the sim rules.
 */
export interface CosmeticsV2Fields {
  /** Van paints unlocked (WP10 ids, stored as plain strings). */
  vanPaints: string[];
  /** Equipped van paint (null = the team's default van). */
  vanPaint: string | null;
  /** Owned taunt played after a win on the results stage (null = default 'wiggle'; WP10 slot unlock). */
  victoryPose: EmoteId | null;
}

export function createDefaultCosmeticsV2(): CosmeticsV2Fields {
  return { vanPaints: [], vanPaint: null, victoryPose: null };
}

/** v2 addition to `SeriesProgress` (WP9): the cup the series belongs to. */
export interface SeriesProgressV2Fields {
  cup: CupId;
}

export function createEmptyRivalRecord(): RivalRecord {
  return { wins: 0, losses: 0, draws: 0, streak: 0, lastScore: 0, bestMargin: 0 };
}

/** Defaults for every v2 field (fresh save, and what the migration adds). */
export function createDefaultProgressV2(): ProgressV2 {
  return {
    rivals: { hodadak: {}, tongkeun: {}, nunchi: {} },
    records: { plaza: {}, shortcut: {}, counter: {} },
    globalRecords: { biggestHaul: 0, fastestFirstRecovery: null },
    cups: { novice: [], normal: [], challenge: [] },
    challenges: { counters: {}, completed: [] },
    recent: [],
    onboarding: { done: [], dismissed: false },
    funnel: {
      counts: { resultsShown: 0, rematchPress: 0, nextPress: 0, menuPress: 0, matchStarted: 0, matchFinished: 0, sessionStarted: 0 },
      matchesThisSession: 0,
      playDays: 0,
      lastPlayDay: null,
      milestones: {},
    },
  };
}

/** Progress of one cup (WP7 tabs / pips, WP6 next-goal chip). */
export interface CupProgress {
  cup: CupId;
  /** Rivals cleared in this cup, in tournament order. */
  beaten: RivalId[];
  /** Next rival to face (tournament order), null when the cup is cleared. */
  nextRival: RivalId | null;
  cleared: boolean;
}

/**
 * Record one finished match everywhere (rival record, layout / global records, cups via series,
 * challenge counters, recent ring buffer, funnel) in ONE save write; idempotent per
 * `summary.matchId`. Returns the single most notable record broken (null = none).
 * STUB (WP9): writes nothing, returns { newRecord: null }.
 */
export function recordMatchOutcome(summary: Readonly<MatchOutcomeSummary>, save?: SaveManager): { newRecord: RecordKind | null } {
  void summary;
  void save;
  return { newRecord: null };
}

/**
 * Head-to-head record against `rival` in one bucket, or summed over every bucket with 'all'
 * (streak = the most recent bucket's streak).
 * STUB (WP9): always an empty record.
 */
export function rivalRecord(rival: RivalId, diff: RivalRecordKey | 'all', save?: SaveManager): RivalRecord {
  void rival;
  void diff;
  void save;
  return createEmptyRivalRecord();
}

/**
 * Progress of one cup.
 * STUB (WP9): nothing cleared, next rival = the first in tournament order.
 */
export function cupProgress(cup: CupId, save?: SaveManager): CupProgress {
  void save;
  return { cup, beaten: [], nextRival: RIVALS[0] ?? null, cleared: false };
}

/**
 * Bump one local funnel counter (and the derived session / play-day fields). Never throws,
 * never blocks input, never touches the network.
 * STUB (WP9): no-op.
 */
export function bumpFunnel(key: FunnelKey, save?: SaveManager): void {
  void key;
  void save;
}

/**
 * Give the rewards for beating `rival` in a tournament: the rival's hat AND its taunt
 * (EMOTE_RIVAL; the WP9 bug fix — today `unlockedEmotes` is never written). Mutates `cosmetics`
 * (call inside `save.update`). WP7's `recordTournament` (app.ts) calls this instead of
 * `unlockHat`, so WP9 never edits app.ts.
 * STUB (WP9): unlocks the hat only (today's behaviour); emoteNew is always false.
 */
export function grantRivalReward(cosmetics: CosmeticsData, rival: RivalId): { hatNew: boolean; emoteNew: boolean } {
  return { hatNew: unlockHat(cosmetics, RIVAL_REWARD_HAT[rival]), emoteNew: false };
}
