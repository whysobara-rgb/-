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
import type { EntityId, ItemKind, LayoutId, LootEventKind, LootKind, MatchResult, SimEvent, TeamId } from '../sim/types';
import { RIVALS, RIVAL_REWARD_HAT, getSaveManager, type MatchStatsSummary, type RivalId, type SaveData, type SaveManager } from './save';
import { unlockHat, type CosmeticsData } from './save';
import {
  FUNNEL_KEYS,
  ITEM_TAG_SIGHTINGS,
  MAX_CHALLENGE_IDS,
  MAX_MILESTONES,
  ONBOARDING_STEPS,
  RECENT_MAX,
  RECORDED_IDS_MAX,
  RECORD_KINDS,
  RECORD_LAYOUT_IDS,
  RIVAL_RECORD_KEYS,
  RIVAL_REWARD_EMOTE,
  SAVE_ITEM_KINDS,
  SAVE_LAYOUT_IDS,
  SAVE_LOOT_EVENT_KINDS,
  createEmptyRivalRecord,
  sanitizeLastQuick,
  sanitizeMatchSummary,
  sanitizeSaveData,
  unlockEmote,
  type CupId,
  type FunnelKey,
  type LastQuickMatch,
  type MatchOutcomeSummary,
  type OnboardingStep,
  type RecordKind,
  type RecordLayoutId,
  type RivalRecord,
  type RivalRecordKey,
} from './save';
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
// Save v2 (fun round WP9 + Content 2.0 F9; docs/ARCHITECTURE.md "Fun round contracts").
//
// The schema (types, defaults, sanitizers, the 1 -> 2 migration) lives in `save.ts`; it is
// re-exported here so consumers keep importing the v2 types from `progress.ts` (frozen contract).
// The helpers below are the only writers of the v2 fields. Everything stays local: nothing here
// is ever sent over the network, and gameplay never reads wall-clock values stored here.
// =============================================================================================

export {
  PROGRESS_V2_SAVE_VERSION,
  SAVE_DIFFICULTIES,
  CUP_IDS,
  RECORD_LAYOUT_IDS,
  RIVAL_RECORD_KEYS,
  RECORD_KINDS,
  ONBOARDING_STEPS,
  FUNNEL_KEYS,
  RECENT_MAX,
  RECORDED_IDS_MAX,
  ITEM_TAG_SIGHTINGS,
  SAVE_ITEM_KINDS,
  SAVE_LOOT_EVENT_KINDS,
  RIVAL_REWARD_EMOTE,
  createDefaultCosmeticsV2,
  createEmptyRivalRecord,
  createDefaultProgressV2,
  createDefaultContentSave,
  sanitizeMatchSummary,
} from './save';
export type {
  SaveDifficulty,
  CupId,
  RecordLayoutId,
  RivalRecordKey,
  RivalRecord,
  LayoutRecord,
  GlobalRecords,
  RecordKind,
  ChallengeProgress,
  OnboardingStep,
  OnboardingState,
  FunnelKey,
  FunnelCounters,
  MatchOutcomeSummary,
  ProgressV2,
  CosmeticsV2Fields,
  SeriesProgressV2Fields,
  LastQuickMatch,
  QuickItemsSetting,
  QuickEventsSetting,
  ContentSaveFields,
} from './save';

/** Progress of one cup (WP7 tabs / pips, WP6 next-goal chip). */
export interface CupProgress {
  cup: CupId;
  /** Rivals cleared in this cup, in tournament order. */
  beaten: RivalId[];
  /** Next rival to face (tournament order), null when the cup is cleared. */
  nextRival: RivalId | null;
  cleared: boolean;
}

/** One record a match broke: the new value and the record it beat (WP6 "신기록 1,700 (이전 1,500)"). */
export interface NewRecordInfo {
  kind: RecordKind;
  value: number;
  previous: number;
}

/** What `recordMatchOutcome` returns. `newRecords` is add-only (all broken records, RECORD_KINDS order). */
export interface MatchOutcomeResult {
  newRecord: RecordKind | null;
  newRecords: NewRecordInfo[];
}

// ---------------------------------------------------------------------------------------------
// Event-log facts (pure; WP6 builds MatchOutcomeSummary from these so every number is traceable)
// ---------------------------------------------------------------------------------------------

export interface MatchOutcomeFactsInput {
  events: readonly SimEvent[];
  result: MatchResult;
  humanTeam: TeamId;
  /** Every character's id and team (sim.state.characters): who caused a spill. */
  characters: ReadonlyArray<{ id: EntityId; team: TeamId }>;
}

export type MatchOutcomeFacts = Pick<
  MatchOutcomeSummary,
  'outcome' | 'myScore' | 'theirScore' | 'endReason' | 'ticks' | 'biggestHaul' | 'firstRecoveryTick' | 'maxDeficit' | 'biggestSplash' | 'biggestDeposit'
>;

/**
 * The event-log facts of one finished match for the player's team: biggest single recovery,
 * first recovery tick, largest confirmed deficit, biggest bag spill knocked loose (by a team
 * member), biggest deposit. Confirmed score moves only on `recovered` and `coinsBanked`.
 */
export function matchOutcomeFacts(m: MatchOutcomeFactsInput): MatchOutcomeFacts {
  const mine = m.humanTeam;
  const other: TeamId = mine === 0 ? 1 : 0;
  const teamOf = new Map(m.characters.map((c) => [c.id, c.team] as const));
  const scores: [number, number] = [0, 0];
  let biggestHaul = 0;
  let firstRecoveryTick: number | null = null;
  let maxDeficit = 0;
  let biggestSplash = 0;
  let biggestDeposit = 0;
  for (const e of m.events) {
    if (e.type === 'recovered' || e.type === 'coinsBanked') {
      scores[e.team] += e.value;
      maxDeficit = Math.max(maxDeficit, scores[other] - scores[mine]);
      if (e.team !== mine) continue;
      if (e.type === 'recovered') {
        biggestHaul = Math.max(biggestHaul, e.value);
        if (firstRecoveryTick === null) firstRecoveryTick = e.tick;
      } else biggestDeposit = Math.max(biggestDeposit, e.value);
    } else if (e.type === 'bagSpilled') {
      if (e.byId !== null && teamOf.get(e.byId) === mine && teamOf.get(e.charId) !== mine) biggestSplash = Math.max(biggestSplash, e.value);
    }
  }
  const w = m.result.winner;
  return {
    outcome: w === null ? 'draw' : w === mine ? 'win' : 'loss',
    myScore: m.result.scores[mine],
    theirScore: m.result.scores[other],
    endReason: m.result.reason,
    ticks: m.result.endTick,
    biggestHaul,
    firstRecoveryTick,
    maxDeficit,
    biggestSplash,
    biggestDeposit,
  };
}

// ---------------------------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------------------------

/** Local calendar day 'YYYY-MM-DD' of an epoch ms stamp. */
export function localDay(ms: number): string {
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function applyFunnel(d: SaveData, key: FunnelKey, now: number): void {
  const f = d.funnel;
  f.counts[key] = Math.min(1e9, (f.counts[key] ?? 0) + 1);
  if (key === 'sessionStarted') f.matchesThisSession = 0;
  if (key === 'matchFinished') {
    f.matchesThisSession = Math.min(1e9, f.matchesThisSession + 1);
    const day = localDay(now);
    if (day !== f.lastPlayDay) {
      f.playDays = Math.min(1e9, f.playDays + 1);
      f.lastPlayDay = day;
    }
  }
}

/**
 * Own-property lookup for the id-keyed maps (challenge counters, milestones): a valid id such as
 * 'constructor' or 'toString' must never pick up an Object.prototype member.
 */
function ownCount(map: Readonly<Record<string, number>>, key: string): number | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function applyMilestone(d: SaveData, key: string, now: number): boolean {
  if (typeof key !== 'string' || ownCount(d.funnel.milestones, key) !== undefined || Object.keys(d.funnel.milestones).length >= MAX_MILESTONES) return false;
  if (!CHALLENGE_ID_RE.test(key)) return false;
  d.funnel.milestones[key] = Math.max(0, Math.floor(now));
  return true;
}

/** Head-to-head bucket of a match (a tournament match without a cup = today's ladder = 'normal'). */
export function rivalRecordKeyOf(s: Pick<MatchOutcomeSummary, 'mode' | 'cup' | 'difficulty'>): RivalRecordKey {
  return s.mode === 'tournament' ? `cup.${s.cup ?? 'normal'}` : `quick.${s.difficulty}`;
}

/** Same rule as the save's plain string ids (challenge ids, milestones): <= 32 chars. */
const CHALLENGE_ID_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,31}$/;

const lastResults = new WeakMap<SaveManager, { matchId: string; result: MatchOutcomeResult }>();

/**
 * Record one finished match everywhere in ONE immediate save write; idempotent per
 * `summary.matchId` (a repeat call changes nothing and returns the first call's result while
 * it is the latest recorded match, `{ newRecord: null }` otherwise):
 *  - head-to-head `rivals[rival][bucket]` (W / L / D, signed streak, last score, best margin);
 *  - personal bests `records[layout][rival]` and `globalRecords` (incl. Content 2.0 splash /
 *    deposit) — a record is "new" only when an earlier non-zero record is strictly beaten;
 *  - challenge counters (+ `challengeDeltas`, already capped by WP10) and completed ids;
 *  - the `recent` ring buffer, `seenLayouts`, `lastEventKind` (when `eventKind` is given);
 *  - the funnel: counts `matchFinished` (so do NOT also `bumpFunnel('matchFinished')`),
 *    matches this session, distinct play days, milestones `firstMatch` / `firstWin`.
 * Cups are filed by WP7's `recordTournament` (via the series), not here; stats stay with
 * `applyMatchStats`. A tutorial only counts in the funnel (it never keeps records).
 * Never throws: on bad input it logs and returns no record.
 */
export function recordMatchOutcome(summary: Readonly<MatchOutcomeSummary>, save: SaveManager = getSaveManager()): MatchOutcomeResult {
  const none: MatchOutcomeResult = { newRecord: null, newRecords: [] };
  try {
    const s = sanitizeMatchSummary(summary);
    if (!s) return none;
    const cached = lastResults.get(save);
    if (save.data.recordedMatchIds.includes(s.matchId)) return cached && cached.matchId === s.matchId ? cached.result : none;
    const now = s.finishedAt > 0 ? s.finishedAt : Date.now();
    const broken: NewRecordInfo[] = [];
    save.update(
      (d) => {
        d.recordedMatchIds = [...d.recordedMatchIds, s.matchId].slice(-RECORDED_IDS_MAX);
        applyFunnel(d, 'matchFinished', now);
        if (s.mode === 'tutorial') {
          applyMilestone(d, 'firstTutorial', now);
          return;
        }
        applyMilestone(d, 'firstMatch', now);
        if (s.outcome === 'win') applyMilestone(d, 'firstWin', now);
        const margin = s.outcome === 'win' ? s.myScore - s.theirScore : 0;
        const higher = (kind: RecordKind, value: number, previous: number): void => {
          if (previous > 0 && value > previous) broken.push({ kind, value, previous });
        };

        // Head-to-head.
        if (s.rival) {
          const key = rivalRecordKeyOf(s);
          const rec = d.rivals[s.rival][key] ?? createEmptyRivalRecord();
          if (s.outcome === 'win') {
            rec.wins++;
            rec.streak = rec.streak > 0 ? rec.streak + 1 : 1;
            rec.bestMargin = Math.max(rec.bestMargin, margin);
          } else if (s.outcome === 'loss') {
            rec.losses++;
            rec.streak = rec.streak < 0 ? rec.streak - 1 : -1;
          } else {
            rec.draws++;
            rec.streak = 0;
          }
          rec.lastScore = s.myScore;
          d.rivals[s.rival][key] = rec;
        }

        // Layout x rival personal bests.
        if (s.rival && (RECORD_LAYOUT_IDS as readonly string[]).includes(s.layoutId)) {
          const cell = d.records[s.layoutId as RecordLayoutId];
          const prev = cell[s.rival] ?? { bestScore: 0, bestMargin: 0 };
          higher('layoutBestScore', s.myScore, prev.bestScore);
          higher('layoutBestMargin', margin, prev.bestMargin);
          cell[s.rival] = { bestScore: Math.max(prev.bestScore, s.myScore), bestMargin: Math.max(prev.bestMargin, margin) };
        }

        // Global records.
        const g = d.globalRecords;
        higher('biggestHaul', s.biggestHaul, g.biggestHaul);
        g.biggestHaul = Math.max(g.biggestHaul, s.biggestHaul);
        if (s.firstRecoveryTick !== null) {
          if (g.fastestFirstRecovery !== null && s.firstRecoveryTick < g.fastestFirstRecovery) {
            broken.push({ kind: 'fastestFirstRecovery', value: s.firstRecoveryTick, previous: g.fastestFirstRecovery });
          }
          g.fastestFirstRecovery = g.fastestFirstRecovery === null ? s.firstRecoveryTick : Math.min(g.fastestFirstRecovery, s.firstRecoveryTick);
        }
        const splash = s.biggestSplash ?? 0;
        higher('biggestSplash', splash, g.biggestSplash ?? 0);
        g.biggestSplash = Math.max(g.biggestSplash ?? 0, splash);
        const deposit = s.biggestDeposit ?? 0;
        higher('biggestDeposit', deposit, g.biggestDeposit ?? 0);
        g.biggestDeposit = Math.max(g.biggestDeposit ?? 0, deposit);

        // Challenge book.
        // From the raw summary: `recent` keeps only the first MAX_SUMMARY_CHALLENGES entries.
        for (const [id, raw] of Object.entries(summary.challengeDeltas ?? {})) {
          if (!CHALLENGE_ID_RE.test(id) || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
          const n = Math.min(1000, Math.floor(raw));
          if (n <= 0) continue;
          const prev = ownCount(d.challenges.counters, id);
          if (prev === undefined && Object.keys(d.challenges.counters).length >= MAX_CHALLENGE_IDS) continue;
          d.challenges.counters[id] = Math.min(1e9, (prev ?? 0) + n);
        }
        for (const id of summary.challengeCompleted ?? []) {
          if (typeof id !== 'string' || !CHALLENGE_ID_RE.test(id)) continue;
          if (!d.challenges.completed.includes(id) && d.challenges.completed.length < MAX_CHALLENGE_IDS) d.challenges.completed.push(id);
        }

        // Recent ring, seen maps, event memory.
        d.recent = [...d.recent, s].slice(-RECENT_MAX);
        if (s.layoutId !== 'tutorial' && !d.seenLayouts.includes(s.layoutId)) d.seenLayouts = SAVE_LAYOUT_IDS.filter((id) => id === s.layoutId || d.seenLayouts.includes(id));
        if (s.eventKind !== undefined) d.lastEventKind = s.eventKind;
      },
      { immediate: true },
    );
    broken.sort((a, b) => RECORD_KINDS.indexOf(a.kind) - RECORD_KINDS.indexOf(b.kind));
    const result: MatchOutcomeResult = { newRecord: broken[0]?.kind ?? null, newRecords: broken };
    lastResults.set(save, { matchId: s.matchId, result });
    return result;
  } catch (err) {
    console.warn('[progress] recordMatchOutcome failed', err);
    return none;
  }
}

/**
 * Head-to-head record against `rival` in one bucket, or summed over every bucket with 'all'
 * (streak and last score = the bucket of the most recent match against that rival).
 */
export function rivalRecord(rival: RivalId, diff: RivalRecordKey | 'all', save: SaveManager = getSaveManager()): RivalRecord {
  // Runtime guard for untyped callers: only real rivals / buckets (never an Object.prototype member).
  if (!(RIVALS as readonly string[]).includes(rival)) return createEmptyRivalRecord();
  const buckets = save.data.rivals[rival] ?? {};
  if (diff !== 'all') return (RIVAL_RECORD_KEYS as readonly string[]).includes(diff) ? { ...createEmptyRivalRecord(), ...(buckets[diff] ?? {}) } : createEmptyRivalRecord();
  const out = createEmptyRivalRecord();
  const keys = Object.keys(buckets) as RivalRecordKey[];
  for (const k of keys) {
    const r = buckets[k]!;
    out.wins += r.wins;
    out.losses += r.losses;
    out.draws += r.draws;
    out.bestMargin = Math.max(out.bestMargin, r.bestMargin);
  }
  let lastKey: RivalRecordKey | null = keys.length === 1 ? keys[0]! : null;
  for (let i = save.data.recent.length - 1; i >= 0; i--) {
    const m = save.data.recent[i]!;
    if (m.rival === rival && m.mode !== 'tutorial') {
      lastKey = rivalRecordKeyOf(m);
      break;
    }
  }
  const last = lastKey ? buckets[lastKey] : undefined;
  if (last) {
    out.streak = last.streak;
    out.lastScore = last.lastScore;
  }
  return out;
}

/** Progress of one cup. */
export function cupProgress(cup: CupId, save: SaveManager = getSaveManager()): CupProgress {
  const cleared = new Set(save.data.cups[cup] ?? []);
  const beaten = RIVALS.filter((r) => cleared.has(r));
  const nextRival = RIVALS.find((r) => !cleared.has(r)) ?? null;
  return { cup, beaten, nextRival, cleared: nextRival === null };
}

/**
 * Bump one local funnel counter (and the derived session / play-day fields). Never throws,
 * never blocks input, never touches the network. `recordMatchOutcome` already counts
 * 'matchFinished'; bump it here only for a match that is not recorded. 'sessionStarted' is
 * counted by the app-wide save manager's first load (SaveManagerOptions.countSession), so game
 * flow does not bump it either (a manual bump still works and starts a new session).
 */
export function bumpFunnel(key: FunnelKey, save: SaveManager = getSaveManager(), now: number = Date.now()): void {
  try {
    if (!(FUNNEL_KEYS as readonly string[]).includes(key)) return;
    save.update((d) => applyFunnel(d, key, now));
  } catch (err) {
    console.warn('[progress] bumpFunnel failed', err);
  }
}

/** Stamp a first-time funnel milestone (e.g. 'firstHat', 'starterCupR1'); returns true when new. */
export function markMilestone(key: string, save: SaveManager = getSaveManager(), now: number = Date.now()): boolean {
  let added = false;
  try {
    if (typeof key !== 'string' || ownCount(save.data.funnel.milestones, key) !== undefined) return false;
    save.update((d) => {
      added = applyMilestone(d, key, now);
    });
  } catch (err) {
    console.warn('[progress] markMilestone failed', err);
  }
  return added;
}

/** Plain-text funnel summary for the dev-only playtest debug screen (`window.__uproot`). */
export function funnelReport(save: SaveManager = getSaveManager()): string[] {
  const f = save.data.funnel;
  const c = f.counts;
  const rate = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '-');
  return [
    ...FUNNEL_KEYS.map((k) => `${k}: ${c[k]}`),
    `matchesThisSession: ${f.matchesThisSession}`,
    `playDays: ${f.playDays} (last ${f.lastPlayDay ?? '-'})`,
    `rematch / results: ${rate(c.rematchPress, c.resultsShown)}`,
    `next / results: ${rate(c.nextPress, c.resultsShown)}`,
    `menu / results: ${rate(c.menuPress, c.resultsShown)}`,
    `finished / started: ${rate(c.matchFinished, c.matchStarted)}`,
    ...Object.entries(f.milestones).map(([k, t]) => `milestone ${k}: ${new Date(t).toISOString()}`),
  ];
}

/**
 * Give the rewards for beating `rival` in a tournament: the rival's hat AND its taunt
 * (RIVAL_REWARD_EMOTE = emotes.ts EMOTE_RIVAL inverted; the WP9 bug fix). Mutates `cosmetics`
 * (call inside `save.update`). WP7's `recordTournament` (app.ts) calls this instead of
 * `unlockHat`, so WP9 never edits app.ts. (Until then `SaveManager.update` self-heals the taunt
 * for every beaten rival, so the wheel unlocks either way.)
 */
export function grantRivalReward(cosmetics: CosmeticsData, rival: RivalId): { hatNew: boolean; emoteNew: boolean } {
  return { hatNew: unlockHat(cosmetics, RIVAL_REWARD_HAT[rival]), emoteNew: unlockEmote(cosmetics, RIVAL_REWARD_EMOTE[rival]) };
}

// --- First-hour path (WP7 decides when; these only store) -------------------------------------

/** Mark one 첫 출동 step done (idempotent; kept in ONBOARDING_STEPS order). */
export function completeOnboardingStep(step: OnboardingStep, save: SaveManager = getSaveManager()): boolean {
  if (!(ONBOARDING_STEPS as readonly string[]).includes(step) || save.data.onboarding.done.includes(step)) return false;
  save.update((d) => {
    const done = new Set([...d.onboarding.done, step]);
    d.onboarding.done = ONBOARDING_STEPS.filter((x) => done.has(x));
  });
  return true;
}

/** Hide the 첫 출동 strip (dismissed, or auto-skipped after a win at normal). Nothing locks. */
export function dismissOnboarding(save: SaveManager = getSaveManager()): void {
  if (!save.data.onboarding.dismissed) save.update((d) => (d.onboarding.dismissed = true));
}

// --- Content 2.0 menu memory (F9) --------------------------------------------------------------

/** Remember the quick-match setup (sanitized); the front door's 게임 시작 replays it in one press. */
export function setLastQuick(q: Readonly<LastQuickMatch>, save: SaveManager = getSaveManager()): LastQuickMatch | null {
  try {
    const clean = sanitizeLastQuick(q);
    if (clean) save.update((d) => (d.lastQuick = clean));
    return clean ?? save.data.lastQuick;
  } catch (err) {
    console.warn('[progress] setLastQuick failed', err);
    return save.data.lastQuick;
  }
}

/**
 * Count one sighting of an item kind (call once per match, the first time the kind appears on
 * the field). Returns the sightings so far and whether the name tag should still show (the
 * first ITEM_TAG_SIGHTINGS sightings, C8).
 */
export function markItemSeen(kind: ItemKind, save: SaveManager = getSaveManager()): { sightings: number; showTag: boolean } {
  if (!(SAVE_ITEM_KINDS as readonly string[]).includes(kind)) return { sightings: 0, showTag: false };
  let sightings = 0;
  save.update((d) => {
    sightings = Math.min(999, (d.itemSightings[kind] ?? 0) + 1);
    d.itemSightings[kind] = sightings;
    if (!d.seenItems.includes(kind)) d.seenItems = SAVE_ITEM_KINDS.filter((k) => k === kind || d.seenItems.includes(k));
  });
  return { sightings, showTag: sightings <= ITEM_TAG_SIGHTINGS };
}

/** Item kinds never seen yet (C10 news / onboarding hints). */
export function unseenItems(save: SaveManager = getSaveManager()): ItemKind[] {
  return SAVE_ITEM_KINDS.filter((k) => !save.data.seenItems.includes(k));
}

/** Mark a layout seen (played or previewed): its NEW badge goes away. Returns true when new. */
export function markLayoutSeen(id: LayoutId, save: SaveManager = getSaveManager()): boolean {
  if (!(SAVE_LAYOUT_IDS as readonly string[]).includes(id) || save.data.seenLayouts.includes(id)) return false;
  save.update((d) => {
    d.seenLayouts = SAVE_LAYOUT_IDS.filter((x) => x === id || d.seenLayouts.includes(x));
  });
  return true;
}

/** Remember the game version whose news the player saw (C10 news ticker). Invalid strings are ignored. */
export function setLastSeenVersion(version: string, save: SaveManager = getSaveManager()): void {
  const clean = sanitizeSaveData({ lastSeenVersion: version }).lastSeenVersion;
  if (clean !== null && clean !== save.data.lastSeenVersion) save.update((d) => (d.lastSeenVersion = clean));
}

/** Remember this match's planned loot event kind (game flow, at match start or end). */
export function setLastEventKind(kind: LootEventKind | null, save: SaveManager = getSaveManager()): void {
  const clean = kind !== null && (SAVE_LOOT_EVENT_KINDS as readonly string[]).includes(kind) ? kind : null;
  if (clean !== save.data.lastEventKind) save.update((d) => (d.lastEventKind = clean));
}
