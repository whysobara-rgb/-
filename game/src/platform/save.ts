/**
 * Versioned save data with migrations, corruption recovery and debounced writes.
 *
 * Backends, in order of preference:
 *  1. `window.uprootNative` (Electron preload): synchronous file IO in userData/ with an atomic
 *     tmp + fsync + rename write and a rotating save.bak (electron/save-store.cjs).
 *  2. localStorage (browser builds), same main/backup rotation.
 *  3. memory (storage blocked, private mode, tests) — the game still runs, nothing persists.
 *
 * Recovery rules:
 *  - main unreadable (bad JSON / not an object) -> keep a quarantined copy, load the backup;
 *    if that is unreadable too, start from defaults. The recovered data is written back at once.
 *  - main written by a NEWER game version (Steam beta branch, then rollback) -> keep a
 *    quarantined copy, load what this version understands.
 *  - main from an older version -> run SAVE_MIGRATIONS step by step, then sanitize.
 * Every path ends in `sanitizeSaveData`, so callers always get a complete, valid object.
 *
 * Save v2 (fun round WP9 + Content 2.0 F9): head-to-head rival records, honest personal records,
 * tournament cups, the challenge book, the recent-match ring buffer, the first-hour path, local
 * funnel counters, and the Content 2.0 menu memory (last quick match, seen items / maps, last
 * event kind). The schema lives here (types + defaults + sanitizers); the helpers that write it
 * (`recordMatchOutcome`, `bumpFunnel`, ...) live in `progress.ts`, which re-exports every v2
 * type so consumers keep importing them from there. Everything is local: this module never
 * imports or calls a network API (guarded by test/unit/platform-save-v2.test.ts).
 */
import type { EmoteId, EndReason, HatId, ItemKind, LayoutId, LootEventKind } from '../sim/types';
import { BASE_EMOTES } from '../sim/types';
import { isRecord } from './bindings';
import { getNative, type SaveSlot } from './native';
import { createDefaultSettings, sanitizeSettings, type Settings } from './settings';

export type RivalId = 'hodadak' | 'tongkeun' | 'nunchi';
/** Tournament order (doc §12): 호다닥 -> 통큰이 -> 눈치왕. */
export const RIVALS: readonly RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];
export const HAT_IDS: readonly HatId[] = ['none', 'teamCapA', 'teamCapB', 'hodadakBand', 'tongkeunHat', 'nunchiMask'];
/** Hats every player owns from the start. */
export const DEFAULT_UNLOCKED_HATS: readonly HatId[] = ['none', 'teamCapA', 'teamCapB'];
/** Hat awarded for beating each rival (doc §12). */
export const RIVAL_REWARD_HAT: Readonly<Record<RivalId, HatId>> = {
  hodadak: 'hodadakBand',
  tongkeun: 'tongkeunHat',
  nunchi: 'nunchiMask',
};
/**
 * Every layout id the save may name (series layout, seen maps, recent matches). Typed as an
 * exhaustive list: adding a `LayoutId` (C4b: 'yard' / 'funpark') fails to compile until it is
 * listed here and in RECORD_LAYOUT_IDS / createDefaultProgressV2.
 */
export const SAVE_LAYOUT_IDS = ['plaza', 'shortcut', 'counter', 'tutorial'] as const satisfies readonly LayoutId[];
const LAYOUT_IDS: readonly LayoutId[] = SAVE_LAYOUT_IDS;
type MissingLayoutIds = Exclude<LayoutId, (typeof SAVE_LAYOUT_IDS)[number]>;
const LAYOUT_IDS_EXHAUSTIVE: [MissingLayoutIds] extends [never] ? true : MissingLayoutIds = true;
void LAYOUT_IDS_EXHAUSTIVE;
const ADAPTATION_KINDS = ['ambushChoke', 'stripBank', 'guardDoors'] as const;

/** Rival adaptation chosen for the next game of a series (mirrors ai `Adaptation`). */
export interface SeriesAdaptation {
  kind: (typeof ADAPTATION_KINDS)[number];
  chokepointId?: string;
  lineKey: string;
  lineParams?: Record<string, string>;
}

export interface SeriesProgress {
  rival: RivalId;
  wins: number;
  losses: number;
  draws: number;
  /** Games played in this series, draws included (0-based index of the next game). */
  gameIndex: number;
  /** Layout fixed for the series (doc §12 "한 라이벌과의 시리즈 안에서는 배치를 유지"). */
  layoutId?: LayoutId | null;
  /** Adaptation for the next game, so a series resumed after quitting plays the same. */
  adaptation?: SeriesAdaptation | null;
  /**
   * (save v2, WP9) Cup the series belongs to. Always present after sanitizing (a v1 series is
   * filed under 'normal', the difficulty it was played at); optional in the type so existing
   * builders (`startSeries`) keep compiling — WP7 sets it.
   */
  cup?: CupId;
}

export interface TournamentProgress {
  /**
   * Rivals already beaten (in ANY cup), in tournament order. Progress is never reset by a loss.
   * Kept as the union of `cups` for v1 code (ladder, BEAT_* achievements): a rival listed here
   * but in no cup is filed under 'normal' at load (the cup today's tournament plays at), and
   * every rival in a cup is listed here (`healSaveData`). Cup writers (WP7) update both.
   */
  beaten: RivalId[];
  /** Series in progress, or null. */
  series: SeriesProgress | null;
}

export interface CosmeticsData {
  unlocked: HatId[];
  equipped: HatId;
  /** Hats the player has looked at in the wardrobe (unlocked && !seen => NEW badge). */
  seen: HatId[];
  /**
   * Taunt emotes unlocked beyond the four base ones (rival taunts, earned by beating that rival).
   * Optional: a save without the field has none. The base taunts are always available.
   */
  unlockedEmotes?: EmoteId[];
}

/** Every taunt id in wheel order (base four, then the rival taunts). */
export const EMOTE_IDS: readonly EmoteId[] = ['wiggle', 'bleh', 'fanCash', 'squatBounce', 'hodadakZoom', 'tongkeunFlex', 'nunchiShrug'];
const isEmote = (x: unknown): x is EmoteId => typeof x === 'string' && (EMOTE_IDS as readonly string[]).includes(x);

export interface PlayerStats {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  banksRecovered: number;
  safesRecovered: number;
  bestScore: number;
}

// =============================================================================================
// Save v2 schema (fun round WP9 + Content 2.0 F9). docs/ARCHITECTURE.md "Fun round contracts" /
// "Content 2.0 contracts". Add-only: never rename / remove a field; new fields get defaults
// here and a sanitizer below. `progress.ts` re-exports every name in this section.
// =============================================================================================

/** SAVE_VERSION of the v2 format (= SAVE_VERSION now that WP9 landed). */
export const PROGRESS_V2_SAVE_VERSION = 2;

/** Bot difficulty as stored in the save (mirrors ai `Difficulty`; platform does not import ai). */
export type SaveDifficulty = 'novice' | 'normal' | 'challenge';
export const SAVE_DIFFICULTIES: readonly SaveDifficulty[] = ['novice', 'normal', 'challenge'];

/** Tournament cups 입문 / 보통 / 도전 (WP7). Ids match the difficulty names they start from. */
export type CupId = 'novice' | 'normal' | 'challenge';
export const CUP_IDS: readonly CupId[] = ['novice', 'normal', 'challenge'];

/** Match layouts that keep records (the tutorial never does). */
export type RecordLayoutId = Exclude<LayoutId, 'tutorial'>;
export const RECORD_LAYOUT_IDS: readonly RecordLayoutId[] = ['plaza', 'shortcut', 'counter'];

/** Head-to-head bucket: quick match at a difficulty, or a tournament cup. */
export type RivalRecordKey = `quick.${SaveDifficulty}` | `cup.${CupId}`;
export const RIVAL_RECORD_KEYS: readonly RivalRecordKey[] = [
  ...SAVE_DIFFICULTIES.map((d) => `quick.${d}` as const),
  ...CUP_IDS.map((c) => `cup.${c}` as const),
];

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
  /** (Content 2.0, F9; add-only) Biggest single bag spill the player's team knocked loose (0 = none). */
  biggestSplash?: number;
  /** (Content 2.0, F9; add-only) Biggest single bag deposit (쏟아붓기) by the player's team (0 = none). */
  biggestDeposit?: number;
}

/**
 * Which record a match just broke (WP6 shows at most one "신기록" chip). A record only counts as
 * broken when an earlier one existed and was strictly beaten: the first value on a fresh cell
 * sets the baseline silently (no cheap "신기록" on match 1).
 */
export type RecordKind =
  | 'layoutBestScore'
  | 'layoutBestMargin'
  | 'biggestHaul'
  | 'fastestFirstRecovery'
  // Content 2.0 (F9; add-only)
  | 'biggestSplash'
  | 'biggestDeposit';
/** Most notable first: `recordMatchOutcome` returns the first broken kind in this order. */
export const RECORD_KINDS: readonly RecordKind[] = ['biggestHaul', 'layoutBestScore', 'layoutBestMargin', 'biggestSplash', 'biggestDeposit', 'fastestFirstRecovery'];

/** 털이 수첩 progress (WP10 owns the challenge ids; stored as plain strings of <= 32 chars `[A-Za-z][A-Za-z0-9_.:-]*`). */
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
  | 'sessionStarted'
  // Content 2.0 (F9; add-only): front-door 게임 시작 press, quick-setup items toggle change.
  | 'playPressed'
  | 'itemsToggle';
export const FUNNEL_KEYS: readonly FunnelKey[] = [
  'resultsShown',
  'rematchPress',
  'nextPress',
  'menuPress',
  'matchStarted',
  'matchFinished',
  'sessionStarted',
  'playPressed',
  'itemsToggle',
];

export interface FunnelCounters {
  counts: Record<FunnelKey, number>;
  /**
   * Matches finished in the current session. Reset when a session starts: the app-wide manager's
   * first load (`getSaveManager`, SaveManagerOptions.countSession) counts 'sessionStarted' and
   * zeroes this, so game flow never bumps 'sessionStarted' itself.
   */
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
  /** Cup of a tournament match (null otherwise; a tournament match without a cup counts as 'normal'). */
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
  // --- Content 2.0 (F9; add-only, all optional; `matchOutcomeFacts` computes the first two) ---
  /** Biggest single bag spill the player's team knocked loose (bagSpilled.value, byId on the team). */
  biggestSplash?: number;
  /** Biggest single bag deposit by the player's team (coinsBanked.value). */
  biggestDeposit?: number;
  /** Loot event kind that was planned for this match (undefined = unknown / leave lastEventKind). */
  eventKind?: LootEventKind | null;
  /** Challenge ids completed by this match (WP10 decides; appended to `challenges.completed`). */
  challengeCompleted?: string[];
}

/** Ring buffer size of `recent`. */
export const RECENT_MAX = 20;
/** How many recorded match ids are remembered for idempotency (> RECENT_MAX: tutorials too). */
export const RECORDED_IDS_MAX = 32;

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

function createDefaultFunnel(): FunnelCounters {
  const counts = {} as Record<FunnelKey, number>;
  for (const k of FUNNEL_KEYS) counts[k] = 0;
  return { counts, matchesThisSession: 0, playDays: 0, lastPlayDay: null, milestones: {} };
}

/** Defaults for every v2 field (fresh save, and what the migration adds). */
export function createDefaultProgressV2(): ProgressV2 {
  return {
    rivals: { hodadak: {}, tongkeun: {}, nunchi: {} },
    records: { plaza: {}, shortcut: {}, counter: {} },
    globalRecords: { biggestHaul: 0, fastestFirstRecovery: null, biggestSplash: 0, biggestDeposit: 0 },
    cups: { novice: [], normal: [], challenge: [] },
    challenges: { counters: {}, completed: [] },
    recent: [],
    onboarding: { done: [], dismissed: false },
    funnel: createDefaultFunnel(),
  };
}

// --- Content 2.0 menu memory (F9) ------------------------------------------------------------

/** Every item kind (mirrors sim `ItemKind`; exhaustive at compile time). */
export const SAVE_ITEM_KINDS = ['hammer', 'goldHammer', 'plunger', 'skates', 'soap', 'balloons', 'smoke'] as const satisfies readonly ItemKind[];
type MissingItemKinds = Exclude<ItemKind, (typeof SAVE_ITEM_KINDS)[number]>;
const ITEM_KINDS_EXHAUSTIVE: [MissingItemKinds] extends [never] ? true : MissingItemKinds = true;
void ITEM_KINDS_EXHAUSTIVE;

/** Every loot event kind (mirrors sim `LootEventKind`; exhaustive at compile time). */
export const SAVE_LOOT_EVENT_KINDS = ['moneyRain', 'goldSafe', 'cashTruck'] as const satisfies readonly LootEventKind[];
type MissingEventKinds = Exclude<LootEventKind, (typeof SAVE_LOOT_EVENT_KINDS)[number]>;
const EVENT_KINDS_EXHAUSTIVE: [MissingEventKinds] extends [never] ? true : MissingEventKinds = true;
void EVENT_KINDS_EXHAUSTIVE;

const END_REASONS = ['time', 'allRecovered', 'decided'] as const satisfies readonly EndReason[];
type MissingEndReasons = Exclude<EndReason, (typeof END_REASONS)[number]>;
const END_REASONS_EXHAUSTIVE: [MissingEndReasons] extends [never] ? true : MissingEndReasons = true;
void END_REASONS_EXHAUSTIVE;

/** Quick-match item setting (RuleConfig.items). */
export type QuickItemsSetting = 'off' | 'hammerOnly' | 'on';
/** Quick-match event setting (RuleConfig.events). */
export type QuickEventsSetting = 'off' | 'on';

/** The last quick-match setup (front door 게임 시작 = one press into this; C8 toggles save it). */
export interface LastQuickMatch {
  layout: LayoutId | 'random';
  mode: '1v1' | '2v2';
  difficulty: SaveDifficulty;
  rival: RivalId | 'random';
  items: QuickItemsSetting;
  events: QuickEventsSetting;
}

/** Item kinds whose name tag stops after this many sightings (C8 "first 3 sightings"). */
export const ITEM_TAG_SIGHTINGS = 3;

/** Content 2.0 save fields (F9; add-only). */
export interface ContentSaveFields {
  /** Last quick-match setup (null = never played one: game flow picks its defaults). */
  lastQuick: LastQuickMatch | null;
  /** Item kinds the player has seen at least once (catalogue order). */
  seenItems: ItemKind[];
  /** Matches in which each item kind was seen (`markItemSeen`; capped at 999). */
  itemSightings: Partial<Record<ItemKind, number>>;
  /** Layouts the player has seen (played or previewed): no NEW badge (catalogue order). */
  seenLayouts: LayoutId[];
  /** Game version whose news the player has seen (null = never: show the news ticker). */
  lastSeenVersion: string | null;
  /** Loot event kind of the previous match (game flow passes it as `planMatchEvents`'s avoidKind). */
  lastEventKind: LootEventKind | null;
}

export function createDefaultContentSave(): ContentSaveFields {
  return { lastQuick: null, seenItems: [], itemSightings: {}, seenLayouts: [], lastSeenVersion: null, lastEventKind: null };
}

export interface SaveData extends ProgressV2, ContentSaveFields {
  version: number;
  settings: Settings;
  tournament: TournamentProgress;
  cosmetics: CosmeticsData & CosmeticsV2Fields;
  stats: PlayerStats;
  /** Unlocked achievement api names (kept even if unknown to this version). */
  achievements: string[];
  /** The practice (연습) was completed or skipped: first launch stops suggesting it. */
  tutorialDone: boolean;
  /** Match ids already passed to `recordMatchOutcome`, newest last (idempotency; tutorials too). */
  recordedMatchIds: string[];
}

export const SAVE_VERSION = PROGRESS_V2_SAVE_VERSION;

// ---------------------------------------------------------------------------------------------
// Defaults + sanitization
// ---------------------------------------------------------------------------------------------

export function createDefaultStats(): PlayerStats {
  return { matches: 0, wins: 0, draws: 0, losses: 0, banksRecovered: 0, safesRecovered: 0, bestScore: 0 };
}

export function createDefaultSaveData(settings: Settings = createDefaultSettings()): SaveData {
  return {
    version: SAVE_VERSION,
    settings,
    tournament: { beaten: [], series: null },
    cosmetics: { unlocked: [...DEFAULT_UNLOCKED_HATS], equipped: 'teamCapA', seen: [...DEFAULT_UNLOCKED_HATS], ...createDefaultCosmeticsV2() },
    stats: createDefaultStats(),
    achievements: [],
    tutorialDone: false,
    ...createDefaultProgressV2(),
    ...createDefaultContentSave(),
    recordedMatchIds: [],
  };
}

const isRival = (x: unknown): x is RivalId => typeof x === 'string' && (RIVALS as readonly string[]).includes(x);
const isHat = (x: unknown): x is HatId => typeof x === 'string' && (HAT_IDS as readonly string[]).includes(x);
const isCup = (x: unknown): x is CupId => typeof x === 'string' && (CUP_IDS as readonly string[]).includes(x);
const isLayout = (x: unknown): x is LayoutId => typeof x === 'string' && (LAYOUT_IDS as readonly string[]).includes(x);
const isDifficulty = (x: unknown): x is SaveDifficulty => typeof x === 'string' && (SAVE_DIFFICULTIES as readonly string[]).includes(x);
const isItemKind = (x: unknown): x is ItemKind => typeof x === 'string' && (SAVE_ITEM_KINDS as readonly string[]).includes(x);
const isLootEventKind = (x: unknown): x is LootEventKind => typeof x === 'string' && (SAVE_LOOT_EVENT_KINDS as readonly string[]).includes(x);
const oneOf = <T extends string>(x: unknown, list: readonly T[]): x is T => typeof x === 'string' && (list as readonly string[]).includes(x);
const ACH_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Plain string ids from other packages (challenge ids, van paints, milestones): <= 32 chars. */
const ID_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,31}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MATCH_ID_RE = /^[^\u0000-\u001f]{1,64}$/;
const MAX_COUNT = 1e9;
/**
 * Size caps for lists other packages fill with their own ids (the save stays well under 64 KB
 * even when every one is full: test/unit/platform-save-v2.test.ts measures the worst case).
 */
export const MAX_CHALLENGE_IDS = 96;
export const MAX_SUMMARY_CHALLENGES = 8;
export const MAX_MILESTONES = 32;
export const MAX_VAN_PAINTS = 32;
/**
 * Caps on v1 fields, tightened in v2 so the true worst case (every list at its cap) fits the
 * 64 KB budget: 12 achievement ids exist (64 leaves room for future ones); an adaptation line is
 * `adapt.<rival>.<kind>.<n>` with at most one param (`choke` = a choke nameKey, <= 29 chars).
 */
export const MAX_ACHIEVEMENTS = 64;
export const MAX_ADAPT_LINE_KEY = 64;
export const MAX_ADAPT_PARAMS = 4;
export const MAX_ADAPT_PARAM_KEY = 32;
export const MAX_ADAPT_PARAM_VALUE = 64;
/** Epoch ms upper bound (year ~5138): keeps wall-clock stamps finite and sane. */
const MAX_EPOCH_MS = 1e14;

function count(v: unknown, max = MAX_COUNT): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0;
}

/** A signed integer in [-max, max] (0 for anything else). */
function signedInt(v: unknown, max = MAX_COUNT): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(-max, Math.trunc(v))) : 0;
}

/** Unique valid ids in first-seen order, at most `max`. */
function idList(raw: unknown, max: number, re: RegExp = ID_RE): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string' || !re.test(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** `{ id: count }` with valid ids only, at most `maxEntries` entries. */
function countMap(raw: unknown, maxEntries: number, maxValue = MAX_COUNT): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= maxEntries) break;
    if (!ID_RE.test(k) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k] = count(v, maxValue);
    n++;
  }
  return out;
}

/** Members of `list` that appear in `raw`, in `list` order. */
function orderedSubset<T extends string>(raw: unknown, list: readonly T[]): T[] {
  const set = new Set(Array.isArray(raw) ? raw.filter((x) => oneOf(x, list)) : []);
  return list.filter((x) => set.has(x));
}

function sanitizeAdaptation(raw: unknown): SeriesAdaptation | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(ADAPTATION_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof raw.lineKey !== 'string' || !raw.lineKey || raw.lineKey.length > MAX_ADAPT_LINE_KEY) return null;
  const out: SeriesAdaptation = { kind: kind as SeriesAdaptation['kind'], lineKey: raw.lineKey };
  if (typeof raw.chokepointId === 'string' && raw.chokepointId.length <= 64) out.chokepointId = raw.chokepointId;
  if (isRecord(raw.lineParams)) {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.lineParams).slice(0, MAX_ADAPT_PARAMS)) {
      if (typeof v === 'string' && k.length <= MAX_ADAPT_PARAM_KEY && v.length <= MAX_ADAPT_PARAM_VALUE) params[k] = v;
    }
    out.lineParams = params;
  }
  return out;
}

function sanitizeSeries(raw: unknown): SeriesProgress | null {
  if (!isRecord(raw) || !isRival(raw.rival)) return null;
  const wins = count(raw.wins, 2);
  const losses = count(raw.losses, 2);
  const draws = count(raw.draws, 999);
  const series: SeriesProgress = {
    rival: raw.rival,
    wins,
    losses,
    draws,
    // At least the games already decided; never fewer than wins + losses + draws.
    gameIndex: Math.max(count(raw.gameIndex, 9999), wins + losses + draws),
    layoutId: isLayout(raw.layoutId) ? raw.layoutId : null,
    adaptation: sanitizeAdaptation(raw.adaptation),
    // v1 series (no cup) were played at the 보통 difficulty.
    cup: isCup(raw.cup) ? raw.cup : 'normal',
  };
  return series;
}

function sanitizeRivalRecord(raw: unknown): RivalRecord | null {
  if (!isRecord(raw)) return null;
  return {
    wins: count(raw.wins),
    losses: count(raw.losses),
    draws: count(raw.draws),
    streak: signedInt(raw.streak),
    lastScore: count(raw.lastScore),
    bestMargin: count(raw.bestMargin),
  };
}

function sanitizeRivals(raw: unknown): ProgressV2['rivals'] {
  const src = isRecord(raw) ? raw : {};
  const out = createDefaultProgressV2().rivals;
  for (const r of RIVALS) {
    const buckets = isRecord(src[r]) ? (src[r] as Record<string, unknown>) : {};
    for (const key of RIVAL_RECORD_KEYS) {
      const rec = sanitizeRivalRecord(buckets[key]);
      if (rec) out[r][key] = rec;
    }
  }
  return out;
}

function sanitizeRecords(raw: unknown): ProgressV2['records'] {
  const src = isRecord(raw) ? raw : {};
  const out = createDefaultProgressV2().records;
  for (const layout of RECORD_LAYOUT_IDS) {
    const byRival = isRecord(src[layout]) ? (src[layout] as Record<string, unknown>) : {};
    for (const r of RIVALS) {
      const rec = byRival[r];
      if (isRecord(rec)) out[layout][r] = { bestScore: count(rec.bestScore), bestMargin: count(rec.bestMargin) };
    }
  }
  return out;
}

function sanitizeGlobalRecords(raw: unknown): GlobalRecords {
  const g = isRecord(raw) ? raw : {};
  const fast = g.fastestFirstRecovery;
  return {
    biggestHaul: count(g.biggestHaul),
    fastestFirstRecovery: typeof fast === 'number' && Number.isFinite(fast) && fast >= 0 ? count(fast) : null,
    biggestSplash: count(g.biggestSplash),
    biggestDeposit: count(g.biggestDeposit),
  };
}

function sanitizeCups(raw: unknown): ProgressV2['cups'] {
  const src = isRecord(raw) ? raw : {};
  const out = createDefaultProgressV2().cups;
  for (const cup of CUP_IDS) out[cup] = orderedSubset(src[cup], RIVALS);
  return out;
}

function sanitizeChallenges(raw: unknown): ChallengeProgress {
  const c = isRecord(raw) ? raw : {};
  return { counters: countMap(c.counters, MAX_CHALLENGE_IDS), completed: idList(c.completed, MAX_CHALLENGE_IDS) };
}

/** One recent-match summary, or null when it is not usable (dropped from the ring). */
export function sanitizeMatchSummary(raw: unknown): MatchOutcomeSummary | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.matchId !== 'string' || !raw.matchId || raw.matchId.length > 64) return null;
  if (!isLayout(raw.layoutId)) return null;
  const mode = oneOf(raw.mode, ['quick', 'tournament', 'tutorial'] as const) ? raw.mode : null;
  const outcome = oneOf(raw.outcome, ['win', 'loss', 'draw'] as const) ? raw.outcome : null;
  if (!mode || !outcome) return null;
  const first = raw.firstRecoveryTick;
  const out: MatchOutcomeSummary = {
    matchId: raw.matchId,
    layoutId: raw.layoutId,
    rival: isRival(raw.rival) ? raw.rival : null,
    mode,
    teamMode: raw.teamMode === '2v2' ? '2v2' : '1v1',
    difficulty: isDifficulty(raw.difficulty) ? raw.difficulty : 'normal',
    cup: isCup(raw.cup) ? raw.cup : null,
    outcome,
    myScore: count(raw.myScore),
    theirScore: count(raw.theirScore),
    endReason: oneOf(raw.endReason, END_REASONS) ? raw.endReason : 'time',
    ticks: count(raw.ticks),
    biggestHaul: count(raw.biggestHaul),
    firstRecoveryTick: typeof first === 'number' && Number.isFinite(first) && first >= 0 ? count(first) : null,
    maxDeficit: count(raw.maxDeficit),
    finishedAt: count(raw.finishedAt, MAX_EPOCH_MS),
  };
  if (isRecord(raw.challengeDeltas)) out.challengeDeltas = countMap(raw.challengeDeltas, MAX_SUMMARY_CHALLENGES, 1000);
  if (raw.biggestSplash !== undefined) out.biggestSplash = count(raw.biggestSplash);
  if (raw.biggestDeposit !== undefined) out.biggestDeposit = count(raw.biggestDeposit);
  if (raw.eventKind === null || isLootEventKind(raw.eventKind)) out.eventKind = raw.eventKind;
  if (Array.isArray(raw.challengeCompleted)) out.challengeCompleted = idList(raw.challengeCompleted, MAX_SUMMARY_CHALLENGES);
  return out;
}

function sanitizeRecent(raw: unknown): MatchOutcomeSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: MatchOutcomeSummary[] = [];
  for (const r of raw.slice(-RECENT_MAX * 2)) {
    const s = sanitizeMatchSummary(r);
    if (s) out.push(s);
  }
  return out.slice(-RECENT_MAX);
}

function sanitizeOnboarding(raw: unknown): OnboardingState {
  const o = isRecord(raw) ? raw : {};
  return { done: orderedSubset(o.done, ONBOARDING_STEPS), dismissed: o.dismissed === true };
}

function sanitizeFunnel(raw: unknown): FunnelCounters {
  const f = isRecord(raw) ? raw : {};
  const out = createDefaultFunnel();
  const counts = isRecord(f.counts) ? f.counts : {};
  for (const k of FUNNEL_KEYS) out.counts[k] = count(counts[k]);
  out.matchesThisSession = count(f.matchesThisSession);
  out.playDays = count(f.playDays);
  out.lastPlayDay = typeof f.lastPlayDay === 'string' && DAY_RE.test(f.lastPlayDay) ? f.lastPlayDay : null;
  out.milestones = countMap(f.milestones, MAX_MILESTONES, MAX_EPOCH_MS);
  return out;
}

/** A stored quick-match setup, or null when unusable. */
export function sanitizeLastQuick(raw: unknown): LastQuickMatch | null {
  if (!isRecord(raw)) return null;
  const layout = raw.layout === 'random' || (isLayout(raw.layout) && raw.layout !== 'tutorial') ? (raw.layout as LastQuickMatch['layout']) : 'random';
  return {
    layout,
    mode: raw.mode === '2v2' ? '2v2' : '1v1',
    difficulty: isDifficulty(raw.difficulty) ? raw.difficulty : 'normal',
    rival: raw.rival === 'random' || isRival(raw.rival) ? (raw.rival as LastQuickMatch['rival']) : 'random',
    items: oneOf(raw.items, ['off', 'hammerOnly', 'on'] as const) ? raw.items : 'on',
    events: raw.events === 'off' ? 'off' : 'on',
  };
}

function sanitizeContent(src: Record<string, unknown>): ContentSaveFields {
  const sightings: Partial<Record<ItemKind, number>> = {};
  if (isRecord(src.itemSightings)) {
    for (const k of SAVE_ITEM_KINDS) {
      const n = count(src.itemSightings[k], 999);
      if (n > 0) sightings[k] = n;
    }
  }
  // An item sighted at least once is "seen" even if the list lost it.
  const seenItemsSet = new Set<ItemKind>([...orderedSubset(src.seenItems, SAVE_ITEM_KINDS), ...(Object.keys(sightings) as ItemKind[])]);
  return {
    lastQuick: sanitizeLastQuick(src.lastQuick),
    seenItems: SAVE_ITEM_KINDS.filter((k) => seenItemsSet.has(k)),
    itemSightings: sightings,
    seenLayouts: orderedSubset(src.seenLayouts, LAYOUT_IDS),
    lastSeenVersion: typeof src.lastSeenVersion === 'string' && VERSION_RE.test(src.lastSeenVersion) ? src.lastSeenVersion : null,
    lastEventKind: isLootEventKind(src.lastEventKind) ? src.lastEventKind : null,
  };
}

function sanitizeCosmeticsV2(c: Record<string, unknown>, ownedEmotes: ReadonlySet<EmoteId>): CosmeticsV2Fields {
  const vanPaints = idList(c.vanPaints, MAX_VAN_PAINTS);
  const vanPaint = typeof c.vanPaint === 'string' && vanPaints.includes(c.vanPaint) ? c.vanPaint : null;
  const victoryPose = isEmote(c.victoryPose) && ownedEmotes.has(c.victoryPose) ? c.victoryPose : null;
  return { vanPaints, vanPaint, victoryPose };
}

/** Rival taunt awarded with each rival's hat (mirrors emotes.ts `EMOTE_RIVAL`, inverted). */
export const RIVAL_REWARD_EMOTE: Readonly<Record<RivalId, EmoteId>> = {
  hodadak: 'hodadakZoom',
  tongkeun: 'tongkeunFlex',
  nunchi: 'nunchiShrug',
};

/** Unlock a rival taunt; returns true when it was new (the field is created on first unlock). */
export function unlockEmote(cosmetics: CosmeticsData, emote: EmoteId): boolean {
  if (!isEmote(emote) || BASE_EMOTES.includes(emote) || cosmetics.unlockedEmotes?.includes(emote)) return false;
  const set = new Set([...(cosmetics.unlockedEmotes ?? []), emote]);
  cosmetics.unlockedEmotes = EMOTE_IDS.filter((id) => set.has(id));
  return true;
}

/**
 * Derived-state self-heal (cheap, idempotent, never throws). Runs after every
 * `SaveManager.update` and at the end of `sanitizeSaveData`:
 *  - every rival cleared in a cup is listed in `tournament.beaten`;
 *  - a beaten rival always grants its hat AND its taunt (WP9 bug fix: the taunt was never
 *    written, so the wheel slot stayed a gift box forever);
 *  - with `fileLegacy` (load time only): a rival in `tournament.beaten` but in no cup is filed
 *    under 'normal' (a v1 / pre-cups ladder win, played at 보통). Never done in-session, so a
 *    cup writer (WP7) that updates `beaten` and `cups` in separate writes is never misfiled.
 */
export function healSaveData(d: SaveData, opts: { fileLegacy?: boolean } = {}): void {
  try {
    const inCup = new Set<RivalId>();
    for (const cup of CUP_IDS) for (const r of d.cups[cup] ?? []) inCup.add(r);
    if (opts.fileLegacy) {
      const missing = d.tournament.beaten.filter((r) => !inCup.has(r));
      if (missing.length) {
        const normal = new Set([...(d.cups.normal ?? []), ...missing]);
        d.cups.normal = RIVALS.filter((r) => normal.has(r));
      }
    }
    const beaten = new Set<RivalId>([...d.tournament.beaten, ...inCup]);
    if (beaten.size !== d.tournament.beaten.length) d.tournament.beaten = RIVALS.filter((r) => beaten.has(r));
    for (const r of beaten) {
      unlockHat(d.cosmetics, RIVAL_REWARD_HAT[r]);
      unlockEmote(d.cosmetics, RIVAL_REWARD_EMOTE[r]);
    }
  } catch (err) {
    console.warn('[save] heal failed', err);
  }
}

/** Turn any object into a complete, self-consistent SaveData (never throws). */
export function sanitizeSaveData(raw: unknown, defaults: SaveData = createDefaultSaveData()): SaveData {
  const src = isRecord(raw) ? raw : {};
  const t = isRecord(src.tournament) ? src.tournament : {};
  const c = isRecord(src.cosmetics) ? src.cosmetics : {};
  const s = isRecord(src.stats) ? src.stats : {};

  const beatenSet = new Set(Array.isArray(t.beaten) ? t.beaten.filter(isRival) : []);
  const beaten = RIVALS.filter((r) => beatenSet.has(r));

  const unlockedSet = new Set<HatId>([...DEFAULT_UNLOCKED_HATS, ...(Array.isArray(c.unlocked) ? c.unlocked.filter(isHat) : [])]);
  // Self-heal: a beaten rival always grants its hat (e.g. a crash between the two writes).
  for (const r of beaten) unlockedSet.add(RIVAL_REWARD_HAT[r]);
  const unlocked = HAT_IDS.filter((h) => unlockedSet.has(h));
  const equipped = isHat(c.equipped) && unlockedSet.has(c.equipped) ? c.equipped : defaults.cosmetics.equipped;
  const seenSet = new Set<HatId>([...DEFAULT_UNLOCKED_HATS, ...(Array.isArray(c.seen) ? c.seen.filter(isHat) : unlocked)]);
  const seen = HAT_IDS.filter((h) => seenSet.has(h) && unlockedSet.has(h));
  const cosmeticsV1: CosmeticsData = { unlocked, equipped, seen };
  if (Array.isArray(c.unlockedEmotes)) {
    const set = new Set(c.unlockedEmotes.filter(isEmote));
    cosmeticsV1.unlockedEmotes = EMOTE_IDS.filter((id) => set.has(id));
  }

  const achievements = Array.isArray(src.achievements)
    ? [...new Set(src.achievements.filter((a): a is string => typeof a === 'string' && ACH_RE.test(a)))].slice(0, MAX_ACHIEVEMENTS)
    : [];

  const cups = sanitizeCups(src.cups);
  // Owned taunts for the victory pose: base + listed + the ones the heal below will grant.
  const owned = new Set<EmoteId>([...BASE_EMOTES, ...(cosmeticsV1.unlockedEmotes ?? [])]);
  for (const r of beaten) owned.add(RIVAL_REWARD_EMOTE[r]);
  for (const cup of CUP_IDS) for (const r of cups[cup]) owned.add(RIVAL_REWARD_EMOTE[r]);

  const out: SaveData = {
    version: SAVE_VERSION,
    settings: sanitizeSettings(src.settings, defaults.settings),
    tournament: { beaten, series: sanitizeSeries(t.series) },
    cosmetics: { ...cosmeticsV1, ...sanitizeCosmeticsV2(c, owned) },
    stats: {
      matches: count(s.matches),
      wins: count(s.wins),
      draws: count(s.draws),
      losses: count(s.losses),
      banksRecovered: count(s.banksRecovered),
      safesRecovered: count(s.safesRecovered),
      bestScore: count(s.bestScore),
    },
    achievements,
    tutorialDone: src.tutorialDone === true,
    rivals: sanitizeRivals(src.rivals),
    records: sanitizeRecords(src.records),
    globalRecords: sanitizeGlobalRecords(src.globalRecords),
    cups,
    challenges: sanitizeChallenges(src.challenges),
    recent: sanitizeRecent(src.recent),
    onboarding: sanitizeOnboarding(src.onboarding),
    funnel: sanitizeFunnel(src.funnel),
    ...sanitizeContent(src),
    recordedMatchIds: idList(Array.isArray(src.recordedMatchIds) ? src.recordedMatchIds.slice(-RECORDED_IDS_MAX) : [], RECORDED_IDS_MAX, MATCH_ID_RE),
  };
  healSaveData(out, { fileLegacy: true });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------------------------

export interface SaveMigration {
  /** Version this step reads. */
  from: number;
  /** Version it produces (must be > from). */
  to: number;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Ordered migration steps. Version 0 is any pre-release / unversioned object: its fields
 * already use today's names, so the step only stamps the version and `sanitizeSaveData` fills
 * the rest. Future format changes append a step here (and bump SAVE_VERSION) — never edit an
 * existing step, players may still have data at that version.
 */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [
  { from: 0, to: 1, migrate: (d) => ({ ...d, version: 1 }) },
  {
    // v2 (WP9): file the v1 `beaten` list under the 보통 cup (the difficulty v1 tournaments ran
    // at) and tag the series in progress with it. Every other v2 field is filled by
    // `sanitizeSaveData` defaults; nothing v1 is dropped.
    from: 1,
    to: 2,
    migrate: (d) => {
      const t = isRecord(d.tournament) ? d.tournament : {};
      const beaten = Array.isArray(t.beaten) ? t.beaten.filter(isRival) : [];
      const prevCups = isRecord(d.cups) ? d.cups : {};
      const prevNormal = Array.isArray(prevCups.normal) ? prevCups.normal : [];
      const series = isRecord(t.series) ? { ...t.series, cup: isCup(t.series.cup) ? t.series.cup : 'normal' } : t.series;
      return {
        ...d,
        version: 2,
        tournament: { ...t, series },
        cups: { ...prevCups, normal: [...prevNormal, ...beaten] },
      };
    },
  },
];

export interface MigrationOutcome {
  data: SaveData;
  /** Version found in the input (0 for unversioned). */
  fromVersion: number;
  /** At least one migration step ran. */
  migrated: boolean;
  /** Written by a newer game version; loaded best-effort. */
  newer: boolean;
}

/** Read the version stamp of a parsed save; 0 when missing or invalid. */
export function readSaveVersion(raw: unknown): number {
  if (!isRecord(raw)) return 0;
  const v = raw.version;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
}

/** Migrate a parsed save object to `target` and sanitize it. */
export function migrateSave(
  raw: unknown,
  migrations: readonly SaveMigration[] = SAVE_MIGRATIONS,
  target: number = SAVE_VERSION,
  defaults?: SaveData,
): MigrationOutcome {
  const fromVersion = readSaveVersion(raw);
  let data: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  let version = fromVersion;
  let migrated = false;
  if (version > target) {
    return { data: sanitizeSaveData(data, defaults), fromVersion, migrated: false, newer: true };
  }
  // Walk the chain; a gap (no step for the current version) stops and sanitizes what we have.
  for (let guard = 0; version < target && guard < 1000; guard++) {
    const step = migrations.find((m) => m.from === version && m.to > version && m.to <= target);
    if (!step) break;
    try {
      const next = step.migrate(data);
      data = isRecord(next) ? next : data;
    } catch (err) {
      console.error(`[save] migration ${step.from}->${step.to} failed; keeping sanitized data`, err);
    }
    version = step.to;
    migrated = true;
  }
  return { data: sanitizeSaveData(data, defaults), fromVersion, migrated, newer: false };
}

/** Parse save text: null when it is not JSON or not an object (= corrupt). */
export function parseSaveText(text: string | null): Record<string, unknown> | null {
  if (text === null || text === undefined) return null;
  // Strip a UTF-8 BOM some editors add when players hand-edit the file.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!clean.trim()) return null;
  try {
    const v: unknown = JSON.parse(clean);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------------------------

export interface SaveBackend {
  readonly kind: 'native' | 'localStorage' | 'memory';
  read(slot: SaveSlot): string | null;
  /** Atomic write of the main slot; a previous main that parses becomes the backup. */
  write(text: string): boolean;
  /** Keep an unreadable / foreign save aside for support. */
  quarantine(text: string, reason: string): boolean;
}

/** Electron preload bridge. */
export class NativeSaveBackend implements SaveBackend {
  readonly kind = 'native' as const;
  read(slot: SaveSlot): string | null {
    const n = getNative();
    if (!n) return null;
    const v = n.saveRead(slot);
    return typeof v === 'string' ? v : null;
  }
  write(text: string): boolean {
    const n = getNative();
    return !!n && n.saveWrite(text) === true;
  }
  quarantine(text: string, reason: string): boolean {
    const n = getNative();
    return !!n && n.saveQuarantine(text, reason) === true;
  }
}

/** Minimal Storage subset (localStorage or a test double). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class LocalStorageSaveBackend implements SaveBackend {
  readonly kind = 'localStorage' as const;
  constructor(
    private readonly storage: StorageLike,
    private readonly prefix = 'uprootHeist.save',
  ) {}
  private key(slot: SaveSlot): string {
    return slot === 'main' ? this.prefix : `${this.prefix}.bak`;
  }
  read(slot: SaveSlot): string | null {
    try {
      return this.storage.getItem(this.key(slot));
    } catch {
      return null;
    }
  }
  write(text: string): boolean {
    try {
      const prev = this.storage.getItem(this.key('main'));
      if (prev !== null && prev !== text && parseSaveText(prev)) this.storage.setItem(this.key('backup'), prev);
      this.storage.setItem(this.key('main'), text);
      return true;
    } catch {
      // QuotaExceededError / SecurityError (storage disabled).
      return false;
    }
  }
  quarantine(text: string, reason: string): boolean {
    try {
      const safe = reason.replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'unknown';
      this.storage.setItem(`${this.prefix}.quarantine.${safe}`, text);
      return true;
    } catch {
      return false;
    }
  }
}

export class MemorySaveBackend implements SaveBackend {
  readonly kind = 'memory' as const;
  readonly slots = new Map<SaveSlot, string>();
  readonly quarantined: Array<{ text: string; reason: string }> = [];
  writes = 0;
  /** Test hook: make the next writes fail. */
  failWrites = false;
  read(slot: SaveSlot): string | null {
    return this.slots.get(slot) ?? null;
  }
  write(text: string): boolean {
    if (this.failWrites) return false;
    const prev = this.slots.get('main');
    if (prev !== undefined && prev !== text && parseSaveText(prev)) this.slots.set('backup', prev);
    this.slots.set('main', text);
    this.writes++;
    return true;
  }
  quarantine(text: string, reason: string): boolean {
    this.quarantined.push({ text, reason });
    return true;
  }
}

function usableLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const probe = '__uprootHeist_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/** Best available backend for this environment. */
export function detectSaveBackend(): SaveBackend {
  if (getNative()) return new NativeSaveBackend();
  const ls = usableLocalStorage();
  if (ls) return new LocalStorageSaveBackend(ls);
  return new MemorySaveBackend();
}

// ---------------------------------------------------------------------------------------------
// SaveManager
// ---------------------------------------------------------------------------------------------

export interface LoadReport {
  source: 'main' | 'backup' | 'default';
  backend: SaveBackend['kind'];
  /** Version found on disk (null when starting from defaults). */
  fromVersion: number | null;
  migrated: boolean;
  /** The main slot existed but could not be read (a quarantined copy was kept). */
  recoveredFromCorruption: boolean;
  /** The save came from a newer game version (a quarantined copy was kept). */
  newerVersion: boolean;
}

export interface SaveManagerOptions {
  /** Delay before a scheduled write (ms). Default 600. */
  debounceMs?: number;
  /** Retry delay after a failed write (ms). Default 5000. */
  retryMs?: number;
  /** Defaults factory (fresh environment-aware settings by default). */
  defaults?: () => SaveData;
  /** Flush on pagehide / beforeunload / hidden (browser only). Default true. */
  flushOnHide?: boolean;
  /**
   * Treat this manager's first load as the start of a play session: count funnel
   * 'sessionStarted', zero `funnel.matchesThisSession`, and write that right away (so a second
   * `load()` in the same boot reads it back instead of losing it). Later loads of the same
   * manager do not count again. Default false; `getSaveManager()` (the app-wide manager) sets it.
   */
  countSession?: boolean;
}

export class SaveManager {
  private current: SaveData;
  private isLoaded = false;
  private isDirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastErrorValue: string | null = null;
  private readonly listeners = new Set<(d: Readonly<SaveData>) => void>();
  private readonly cleanups: Array<() => void> = [];
  private readonly debounceMs: number;
  private readonly retryMs: number;
  private readonly makeDefaults: () => SaveData;
  private readonly countSession: boolean;
  private sessionCounted = false;

  constructor(
    readonly backend: SaveBackend = detectSaveBackend(),
    opts: SaveManagerOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 600;
    this.retryMs = opts.retryMs ?? 5000;
    this.makeDefaults = opts.defaults ?? (() => createDefaultSaveData());
    this.countSession = opts.countSession === true;
    this.current = this.makeDefaults();
    if (opts.flushOnHide !== false) this.installHideFlush();
  }

  get data(): Readonly<SaveData> {
    return this.current;
  }

  get loaded(): boolean {
    return this.isLoaded;
  }

  get dirty(): boolean {
    return this.isDirty;
  }

  get lastError(): string | null {
    return this.lastErrorValue;
  }

  /** Read from the backend, recovering from corruption. Safe to call again (reloads). */
  load(): LoadReport {
    this.cancelTimer();
    const defaults = this.makeDefaults();
    const report: LoadReport = {
      source: 'default',
      backend: this.backend.kind,
      fromVersion: null,
      migrated: false,
      recoveredFromCorruption: false,
      newerVersion: false,
    };
    const mainText = this.safeRead('main');
    const main = parseSaveText(mainText);
    let outcome: MigrationOutcome | null = null;
    if (main) {
      outcome = migrateSave(main, SAVE_MIGRATIONS, SAVE_VERSION, defaults);
      report.source = 'main';
      if (outcome.newer && mainText !== null) this.safeQuarantine(mainText, `newer-v${outcome.fromVersion}`);
    } else {
      if (mainText !== null && mainText.trim() !== '') {
        report.recoveredFromCorruption = true;
        this.safeQuarantine(mainText, 'corrupt');
      }
      const bakText = this.safeRead('backup');
      const bak = parseSaveText(bakText);
      if (bak) {
        outcome = migrateSave(bak, SAVE_MIGRATIONS, SAVE_VERSION, defaults);
        report.source = 'backup';
      } else if (bakText !== null && bakText.trim() !== '') {
        this.safeQuarantine(bakText, 'corrupt-backup');
      }
    }
    if (outcome) {
      this.current = outcome.data;
      report.fromVersion = outcome.fromVersion;
      report.migrated = outcome.migrated;
      report.newerVersion = outcome.newer;
    } else {
      this.current = defaults;
    }
    this.isLoaded = true;
    // Session start (funnel 'sessionStarted' + matches-this-session reset), once per manager.
    let sessionStarted = false;
    if (this.countSession && !this.sessionCounted) {
      this.sessionCounted = true;
      sessionStarted = true;
      const f = this.current.funnel;
      f.counts.sessionStarted = Math.min(MAX_COUNT, f.counts.sessionStarted + 1);
      f.matchesThisSession = 0;
    }
    // Persist repairs (and a session start) right away so the main slot is valid again and a
    // reload in the same boot keeps them; migrations alone can wait. A newer-version save is
    // never overwritten just for the session count (it rides along with the next real write).
    if (report.source === 'backup' || report.recoveredFromCorruption || (sessionStarted && !report.newerVersion)) {
      this.isDirty = true;
      this.flush();
    } else if (report.migrated) {
      this.markDirty();
    }
    this.emit();
    return report;
  }

  /** Mutate the data in place and schedule a write. */
  update(mutator: (d: SaveData) => void, opts: { immediate?: boolean } = {}): void {
    try {
      mutator(this.current);
    } finally {
      // Derived state (beaten rival -> hat + taunt) stays consistent in-session,
      // not only after the next load.
      healSaveData(this.current);
    }
    this.markDirty();
    if (opts.immediate) this.flush();
    this.emit();
  }

  /** Replace the settings (sanitized) and schedule a write. */
  setSettings(settings: Settings): void {
    this.update((d) => {
      d.settings = sanitizeSettings(settings, d.settings);
    });
  }

  /** Schedule a debounced write. */
  markDirty(): void {
    this.isDirty = true;
    this.schedule(this.debounceMs);
  }

  /** Write now if anything changed. Returns false when the backend refused the write. */
  flush(): boolean {
    this.cancelTimer();
    if (!this.isDirty) return true;
    let ok = false;
    try {
      ok = this.backend.write(JSON.stringify(this.current, null, 2));
      this.lastErrorValue = ok ? null : 'write refused';
    } catch (err) {
      this.lastErrorValue = err instanceof Error ? err.message : String(err);
    }
    if (ok) this.isDirty = false;
    else {
      console.warn('[save] write failed, will retry:', this.lastErrorValue);
      this.schedule(this.retryMs);
    }
    return ok;
  }

  /** Called with the data after every load/update. Returns an unsubscribe function. */
  onChange(cb: (d: Readonly<SaveData>) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.flush();
    this.cancelTimer();
    for (const c of this.cleanups.splice(0)) c();
    this.listeners.clear();
  }

  private emit(): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(this.current);
      } catch (err) {
        console.error('[save] listener failed', err);
      }
    }
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private safeRead(slot: SaveSlot): string | null {
    try {
      const v = this.backend.read(slot);
      return typeof v === 'string' ? v : null;
    } catch (err) {
      console.warn(`[save] read ${slot} failed`, err);
      return null;
    }
  }

  private safeQuarantine(text: string, reason: string): void {
    try {
      this.backend.quarantine(text, reason);
    } catch (err) {
      console.warn('[save] quarantine failed', err);
    }
  }

  private installHideFlush(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const flush = (): void => {
      this.flush();
    };
    const onVis = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    this.cleanups.push(() => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    });
  }
}

let shared: SaveManager | null = null;

/** The app-wide save manager (created and loaded on first use). */
export function getSaveManager(): SaveManager {
  if (!shared) {
    shared = new SaveManager(undefined, { countSession: true });
    shared.load();
  }
  return shared;
}

/** Replace the app-wide manager (tests, custom backends). Pass null to reset. */
export function setSaveManager(m: SaveManager | null): void {
  shared = m;
}

// ---------------------------------------------------------------------------------------------
// Small progress helpers (pure, used by game flow)
// ---------------------------------------------------------------------------------------------

export interface MatchStatsSummary {
  outcome: 'win' | 'draw' | 'loss';
  /** Confirmed score of the player's team. */
  teamScore: number;
  /** Bank bodies recovered by the player's team. */
  banksRecovered: number;
  /** Safes recovered by the player's team (alone or inside a bank). */
  safesRecovered: number;
}

/** New stats after one finished match. */
export function applyMatchStats(stats: Readonly<PlayerStats>, m: MatchStatsSummary): PlayerStats {
  return {
    matches: stats.matches + 1,
    wins: stats.wins + (m.outcome === 'win' ? 1 : 0),
    draws: stats.draws + (m.outcome === 'draw' ? 1 : 0),
    losses: stats.losses + (m.outcome === 'loss' ? 1 : 0),
    banksRecovered: stats.banksRecovered + count(m.banksRecovered),
    safesRecovered: stats.safesRecovered + count(m.safesRecovered),
    bestScore: Math.max(stats.bestScore, count(m.teamScore)),
  };
}

/** Unlock a hat; returns true when it was new. */
export function unlockHat(cosmetics: CosmeticsData, hat: HatId): boolean {
  if (!isHat(hat) || cosmetics.unlocked.includes(hat)) return false;
  const set = new Set([...cosmetics.unlocked, hat]);
  cosmetics.unlocked = HAT_IDS.filter((h) => set.has(h));
  return true;
}

/** Hats unlocked but not yet viewed in the wardrobe. */
export function newHats(cosmetics: Readonly<CosmeticsData>): HatId[] {
  return cosmetics.unlocked.filter((h) => !cosmetics.seen.includes(h));
}
