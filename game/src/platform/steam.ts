/**
 * Achievements and Steam status.
 *
 * Achievements are always recorded in the save file (so they work offline, in browser builds
 * and when Steam starts after the game) and mirrored to Steam through the preload bridge when
 * Steamworks is available. `syncAchievementsToSteam()` re-sends anything Steam missed.
 *
 * API names here must match steam/achievements.json and the Steamworks partner site.
 * Display text lives in the i18n tables under 'ach.<ID>.name' / 'ach.<ID>.desc'.
 */
import { getNative } from './native';
import { getSaveManager, type SaveManager } from './save';

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

export interface AchievementDef {
  id: AchievementId;
  /** i18n key of the display name. */
  nameKey: string;
  /** i18n key of the description. */
  descKey: string;
  /** Hidden on Steam until unlocked. */
  hidden: boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = ACHIEVEMENT_IDS.map((id) => ({
  id,
  nameKey: `ach.${id}.name`,
  descKey: `ach.${id}.desc`,
  hidden: false,
}));

export function isAchievementId(x: unknown): x is AchievementId {
  return typeof x === 'string' && (ACHIEVEMENT_IDS as readonly string[]).includes(x);
}

export function achievementDef(id: AchievementId): AchievementDef {
  return ACHIEVEMENTS.find((a) => a.id === id)!;
}

/** Steamworks initialised in the desktop build (Steam client running, app owned). */
export function isSteamRunning(): boolean {
  try {
    return getNative()?.steam?.available === true;
  } catch {
    return false;
  }
}

/** Steam persona name, or null outside Steam. */
export function steamPlayerName(): string | null {
  try {
    const n = getNative()?.steam?.playerName;
    return typeof n === 'string' && n.trim() ? n.trim() : null;
  } catch {
    return null;
  }
}

/** Running on a Steam Deck (pick gamepad prompts / larger UI by default). */
export function isSteamDeck(): boolean {
  try {
    return getNative()?.steam?.isSteamDeck === true;
  } catch {
    return false;
  }
}

function pushToSteam(id: AchievementId): boolean {
  try {
    const steam = getNative()?.steam;
    if (!steam?.available) return false;
    return steam.unlock(id) === true;
  } catch (err) {
    console.warn('[steam] unlock failed', id, err);
    return false;
  }
}

const unlockListeners = new Set<(id: AchievementId) => void>();

/** Notified once per newly unlocked achievement (in-game toast). */
export function onAchievementUnlocked(cb: (id: AchievementId) => void): () => void {
  unlockListeners.add(cb);
  return () => unlockListeners.delete(cb);
}

export function hasAchievement(id: AchievementId, save: SaveManager = getSaveManager()): boolean {
  return save.data.achievements.includes(id);
}

/**
 * Unlock an achievement: record it in the save (written immediately) and forward it to
 * Steam. Returns true only the first time (callers may show a toast).
 */
export function unlockAchievement(id: AchievementId, save: SaveManager = getSaveManager()): boolean {
  if (!isAchievementId(id)) return false;
  const isNew = !save.data.achievements.includes(id);
  if (isNew) save.update((d) => d.achievements.push(id), { immediate: true });
  // Always forward: Steam may have been offline when it was first unlocked (idempotent there).
  pushToSteam(id);
  if (isNew) {
    for (const cb of [...unlockListeners]) {
      try {
        cb(id);
      } catch (err) {
        console.error('[steam] achievement listener failed', err);
      }
    }
  }
  return isNew;
}

/**
 * Send every locally recorded achievement that Steam does not have yet (call once at boot).
 * Returns how many were pushed.
 */
export function syncAchievementsToSteam(save: SaveManager = getSaveManager()): number {
  if (!isSteamRunning()) return 0;
  const steam = getNative()!.steam;
  let pushed = 0;
  for (const id of save.data.achievements) {
    if (!isAchievementId(id)) continue;
    let onSteam: boolean | null = null;
    try {
      onSteam = steam.isUnlocked(id);
    } catch {
      onSteam = null;
    }
    if (onSteam !== true && pushToSteam(id)) pushed++;
  }
  return pushed;
}
