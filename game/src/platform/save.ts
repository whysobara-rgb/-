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
 */
import type { HatId, LayoutId } from '../sim/types';
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
const LAYOUT_IDS: readonly LayoutId[] = ['plaza', 'shortcut', 'counter', 'tutorial'];
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
}

export interface TournamentProgress {
  /** Rivals already beaten, in tournament order. Progress is never reset by a loss. */
  beaten: RivalId[];
  /** Series in progress, or null. */
  series: SeriesProgress | null;
}

export interface CosmeticsData {
  unlocked: HatId[];
  equipped: HatId;
  /** Hats the player has looked at in the wardrobe (unlocked && !seen => NEW badge). */
  seen: HatId[];
}

export interface PlayerStats {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  banksRecovered: number;
  safesRecovered: number;
  bestScore: number;
}

export interface SaveData {
  version: number;
  settings: Settings;
  tournament: TournamentProgress;
  cosmetics: CosmeticsData;
  stats: PlayerStats;
  /** Unlocked achievement api names (kept even if unknown to this version). */
  achievements: string[];
  /** The practice (연습) was completed or skipped: first launch stops suggesting it. */
  tutorialDone: boolean;
}

export const SAVE_VERSION = 1;

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
    cosmetics: { unlocked: [...DEFAULT_UNLOCKED_HATS], equipped: 'teamCapA', seen: [...DEFAULT_UNLOCKED_HATS] },
    stats: createDefaultStats(),
    achievements: [],
    tutorialDone: false,
  };
}

const isRival = (x: unknown): x is RivalId => typeof x === 'string' && (RIVALS as readonly string[]).includes(x);
const isHat = (x: unknown): x is HatId => typeof x === 'string' && (HAT_IDS as readonly string[]).includes(x);
const ACH_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_COUNT = 1e9;

function count(v: unknown, max = MAX_COUNT): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0;
}

function sanitizeAdaptation(raw: unknown): SeriesAdaptation | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(ADAPTATION_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof raw.lineKey !== 'string' || !raw.lineKey || raw.lineKey.length > 128) return null;
  const out: SeriesAdaptation = { kind: kind as SeriesAdaptation['kind'], lineKey: raw.lineKey };
  if (typeof raw.chokepointId === 'string' && raw.chokepointId.length <= 64) out.chokepointId = raw.chokepointId;
  if (isRecord(raw.lineParams)) {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.lineParams).slice(0, 16)) if (typeof v === 'string' && k.length <= 64 && v.length <= 256) params[k] = v;
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
    layoutId: typeof raw.layoutId === 'string' && (LAYOUT_IDS as readonly string[]).includes(raw.layoutId) ? (raw.layoutId as LayoutId) : null,
    adaptation: sanitizeAdaptation(raw.adaptation),
  };
  return series;
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

  const achievements = Array.isArray(src.achievements)
    ? [...new Set(src.achievements.filter((a): a is string => typeof a === 'string' && ACH_RE.test(a)))].slice(0, 256)
    : [];

  return {
    version: SAVE_VERSION,
    settings: sanitizeSettings(src.settings, defaults.settings),
    tournament: { beaten, series: sanitizeSeries(t.series) },
    cosmetics: { unlocked, equipped, seen },
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
  };
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
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [{ from: 0, to: 1, migrate: (d) => ({ ...d, version: 1 }) }];

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

  constructor(
    readonly backend: SaveBackend = detectSaveBackend(),
    opts: SaveManagerOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 600;
    this.retryMs = opts.retryMs ?? 5000;
    this.makeDefaults = opts.defaults ?? (() => createDefaultSaveData());
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
    // Persist repairs right away so the main slot is valid again; migrations can wait.
    if (report.source === 'backup' || report.recoveredFromCorruption) {
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
    mutator(this.current);
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
    shared = new SaveManager();
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
