import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RIVAL_REWARD_HAT as UI_RIVAL_REWARD_HAT, ACHIEVEMENT_IDS as UI_ACHIEVEMENT_IDS } from '../../src/ui/types';
import { en } from '../../src/ui/strings/en';
import { ko } from '../../src/ui/strings/ko';
import { MemorySaveBackend, RIVAL_REWARD_HAT, SaveManager, createDefaultSaveData, unlockHat } from '../../src/platform/save';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_IDS,
  isSteamRunning,
  onAchievementUnlocked,
  steamPlayerName,
  syncAchievementsToSteam,
  unlockAchievement,
} from '../../src/platform/steam';
import { COMEBACK_DEFICIT, evaluateMatchAchievements, progressAchievements, summarizeMatchStats, type MatchRecordInput } from '../../src/platform/progress';
import { createDefaultSettings } from '../../src/platform/settings';
import type { UprootNative } from '../../src/platform/native';
import type { MatchResult, SimEvent } from '../../src/sim/types';
import { secondsToTicks } from '../../src/sim/config';

const root = new URL('../../', import.meta.url);

describe('achievement catalogue', () => {
  it('matches the UI ids and has ko/en text for every achievement', () => {
    expect([...ACHIEVEMENT_IDS]).toEqual([...UI_ACHIEVEMENT_IDS]);
    const k = ko as Record<string, string>;
    const e = en as Record<string, string>;
    for (const a of ACHIEVEMENTS) {
      expect(a.nameKey).toBe(`ach.${a.id}.name`);
      expect(k[a.nameKey], a.nameKey).toBeTruthy();
      expect(k[a.descKey], a.descKey).toBeTruthy();
      expect(e[a.nameKey], a.nameKey).toBeTruthy();
      expect(e[a.descKey], a.descKey).toBeTruthy();
    }
    expect(RIVAL_REWARD_HAT).toEqual(UI_RIVAL_REWARD_HAT);
  });

  it('steam/achievements.json matches the game (ids, hidden flags, ko/en text)', () => {
    const json = JSON.parse(readFileSync(new URL('steam/achievements.json', root), 'utf8')) as {
      achievements: Array<{ apiName: string; hidden: boolean; name: Record<string, string>; description: Record<string, string> }>;
    };
    expect(json.achievements.map((a) => a.apiName)).toEqual([...ACHIEVEMENT_IDS]);
    const k = ko as Record<string, string>;
    const e = en as Record<string, string>;
    for (const a of json.achievements) {
      const def = ACHIEVEMENTS.find((d) => d.id === a.apiName)!;
      expect(a.hidden).toBe(def.hidden);
      expect(a.name.koreana).toBe(k[def.nameKey]);
      expect(a.name.english).toBe(e[def.nameKey]);
      expect(a.description.english).toBe(e[def.descKey]);
      // Steam shows descriptions of LOCKED achievements too, so the Korean text is an
      // instruction ("…하세요"), not the in-game unlock toast's past tense ("…했어요").
      const koDesc = a.description.koreana;
      expect(koDesc, a.apiName).toMatch(/세요\.$/);
      expect(koDesc, a.apiName).not.toMatch(/(었|았|였|했)어요/);
      // Same subject as the UI text (cheap drift guard: identical first word).
      expect(koDesc.split(' ')[0], a.apiName).toBe(k[def.descKey].split(' ')[0]);
    }
  });

  it('steam_appid.txt holds only an app id', () => {
    const text = readFileSync(new URL('steam/steam_appid.txt', root), 'utf8');
    expect(text.trim()).toMatch(/^\d+$/);
  });
});

// ---------------------------------------------------------------------------------------------
// unlock / sync with a fake preload bridge
// ---------------------------------------------------------------------------------------------

function fakeNative(available: boolean): UprootNative & { unlocked: Set<string>; calls: string[] } {
  const unlocked = new Set<string>();
  const calls: string[] = [];
  return {
    unlocked,
    calls,
    bridgeVersion: 1,
    appVersion: '0.5.0',
    platform: 'linux',
    isPackaged: true,
    saveRead: () => null,
    saveWrite: () => true,
    saveQuarantine: () => true,
    quit: () => {},
    setFullscreen: () => {},
    isFullscreen: () => false,
    onFullscreenChange: () => () => {},
    log: () => {},
    steam: {
      available,
      appId: available ? 480 : null,
      playerName: available ? '  너구리  ' : null,
      language: available ? 'koreana' : null,
      isSteamDeck: false,
      unlock: (id: string) => {
        calls.push(id);
        unlocked.add(id);
        return true;
      },
      isUnlocked: (id: string) => unlocked.has(id),
    },
  };
}

describe('unlockAchievement', () => {
  let save: SaveManager;
  let backend: MemorySaveBackend;
  beforeEach(() => {
    backend = new MemorySaveBackend();
    save = new SaveManager(backend, { flushOnHide: false, defaults: () => createDefaultSaveData(createDefaultSettings({ languages: ['ko'] })) });
    save.load();
  });
  afterEach(() => {
    delete (globalThis as { uprootNative?: unknown }).uprootNative;
    save.dispose();
  });

  it('works without Steam (browser build): saved immediately, reported once', () => {
    expect(isSteamRunning()).toBe(false);
    expect(steamPlayerName()).toBeNull();
    const seen: string[] = [];
    const off = onAchievementUnlocked((id) => seen.push(id));
    expect(unlockAchievement('FIRST_RECOVERY', save)).toBe(true);
    expect(unlockAchievement('FIRST_RECOVERY', save)).toBe(false);
    expect(seen).toEqual(['FIRST_RECOVERY']);
    expect(JSON.parse(backend.read('main')!).achievements).toEqual(['FIRST_RECOVERY']);
    off();
  });

  it('forwards to Steam and re-syncs what Steam missed', () => {
    unlockAchievement('BANK_WHOLE', save); // unlocked while Steam was offline
    const native = fakeNative(true);
    (globalThis as { uprootNative?: unknown }).uprootNative = native;
    expect(isSteamRunning()).toBe(true);
    expect(steamPlayerName()).toBe('너구리');
    expect(unlockAchievement('FENCE_BREAKER', save)).toBe(true);
    expect(native.calls).toEqual(['FENCE_BREAKER']);
    expect(syncAchievementsToSteam(save)).toBe(1);
    expect([...native.unlocked].sort()).toEqual(['BANK_WHOLE', 'FENCE_BREAKER']);
    expect(syncAchievementsToSteam(save)).toBe(0);
  });

  it('ignores unknown ids', () => {
    expect(unlockAchievement('NOPE' as never, save)).toBe(false);
    expect(save.data.achievements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Achievement rules from synthetic event logs
// ---------------------------------------------------------------------------------------------

// Characters: 1 = human (team 0), 2 = teammate (team 0), 3/4 = opponents (team 1).
// Loot: 5,6 = banks; 7 = large safe (bank 5 interior); 8,9 = small safes; 10 = outdoor small.
const characters = [
  { id: 1, team: 0 as const },
  { id: 2, team: 0 as const },
  { id: 3, team: 1 as const },
  { id: 4, team: 1 as const },
];
const loot = [
  { id: 5, kind: 'bank' as const },
  { id: 6, kind: 'bank' as const },
  { id: 7, kind: 'largeSafe' as const },
  { id: 8, kind: 'smallSafe' as const },
  { id: 9, kind: 'smallSafe' as const },
  { id: 10, kind: 'smallSafe' as const },
];
const END = secondsToTicks(240);

function rec(tick: number, lootId: number, kind: 'bank' | 'largeSafe' | 'smallSafe', team: 0 | 1, value: number, holders: number[], safeIds: number[] = []): SimEvent {
  return { type: 'recovered', tick, lootId, kind, team, value, safeIds, safesValue: kind === 'bank' ? value - 500 : 0, holders };
}
const grab = (tick: number, charId: number, targetId: number): SimEvent => ({ type: 'grab', tick, charId, targetId, part: 'safe' });
const release = (tick: number, charId: number, targetId: number): SimEvent => ({ type: 'release', tick, charId, targetId, forced: false });

function input(events: SimEvent[], result: Partial<MatchResult> = {}): MatchRecordInput {
  return {
    events,
    result: { reason: 'time', winner: 0, scores: [0, 0], endTick: END, ...result },
    humanCharId: 1,
    humanTeam: 0,
    characters,
    loot,
  };
}

describe('evaluateMatchAchievements', () => {
  it('FIRST_RECOVERY needs the player to take part (holding or just let go)', () => {
    expect(evaluateMatchAchievements(input([rec(100, 10, 'smallSafe', 0, 100, [2])]))).toEqual([]);
    expect(evaluateMatchAchievements(input([rec(100, 10, 'smallSafe', 0, 100, [1])]))).toEqual(['FIRST_RECOVERY']);
    // Pushed into the zone and released 2 s before completion: still counts.
    expect(evaluateMatchAchievements(input([grab(10, 1, 10), release(100, 1, 10), rec(220, 10, 'smallSafe', 0, 100, [])]))).toEqual(['FIRST_RECOVERY']);
    // Released long before: someone else finished it.
    expect(evaluateMatchAchievements(input([grab(10, 1, 10), release(100, 1, 10), rec(600, 10, 'smallSafe', 0, 100, [])]))).toEqual([]);
    // Opponent recoveries never count.
    expect(evaluateMatchAchievements(input([rec(100, 10, 'smallSafe', 1, 100, [1])], { winner: 1 }))).toEqual([]);
  });

  it('BANK_WHOLE and BANK_HEIST_TEAM', () => {
    const solo = evaluateMatchAchievements(input([rec(900, 5, 'bank', 0, 1000, [1], [7, 8, 9])]));
    expect(solo).toEqual(['FIRST_RECOVERY', 'BANK_WHOLE']);
    const team = evaluateMatchAchievements(input([grab(100, 2, 5), release(890, 2, 5), rec(900, 5, 'bank', 0, 1000, [1], [7, 8, 9])]));
    expect(team).toEqual(['FIRST_RECOVERY', 'BANK_WHOLE', 'BANK_HEIST_TEAM']);
  });

  it('STEAL_LARGE: pulled out of an opponent-hauled bank, then recovered by our team', () => {
    const unload = (byCharId: number | null, carrier: 0 | 1 | null): SimEvent => ({
      type: 'safeUnloaded',
      tick: 300,
      safeId: 7,
      bankId: 5,
      bankValue: 700,
      byCharId,
      bankCarrierTeam: carrier,
    });
    expect(evaluateMatchAchievements(input([unload(1, 1), rec(800, 7, 'largeSafe', 0, 300, [2])]))).toContain('STEAL_LARGE');
    // Re-loaded into our own bank and recovered with it also counts.
    expect(evaluateMatchAchievements(input([unload(1, 1), rec(800, 6, 'bank', 0, 800, [2], [7])]))).toContain('STEAL_LARGE');
    // Our own team's bank, or nobody pulling it out: no.
    expect(evaluateMatchAchievements(input([unload(1, 0), rec(800, 7, 'largeSafe', 0, 300, [1])]))).not.toContain('STEAL_LARGE');
    expect(evaluateMatchAchievements(input([unload(null, 1), rec(800, 7, 'largeSafe', 0, 300, [1])]))).not.toContain('STEAL_LARGE');
    // Stolen but the opponent got it back.
    expect(evaluateMatchAchievements(input([unload(1, 1), rec(800, 7, 'largeSafe', 1, 300, [3])], { winner: 1 }))).toEqual([]);
  });

  it('FENCE_BREAKER only while the player holds the bank', () => {
    const fence = (tick: number): SimEvent => ({ type: 'fenceBroken', tick, fenceId: 'f1', bankId: 5, pos: { x: 0, y: 0 } });
    expect(evaluateMatchAchievements(input([grab(10, 1, 5), fence(50)]))).toEqual(['FENCE_BREAKER']);
    expect(evaluateMatchAchievements(input([grab(10, 1, 5), release(40, 1, 5), fence(50)]))).toEqual([]);
    expect(evaluateMatchAchievements(input([grab(10, 3, 5), fence(50)]))).toEqual([]);
  });

  it('LAST_SECONDS only when the clock ran out', () => {
    const late = rec(END - secondsToTicks(4), 10, 'smallSafe', 0, 100, [1]);
    expect(evaluateMatchAchievements(input([late]))).toContain('LAST_SECONDS');
    expect(evaluateMatchAchievements(input([rec(END - secondsToTicks(6), 10, 'smallSafe', 0, 100, [1])]))).not.toContain('LAST_SECONDS');
    expect(evaluateMatchAchievements(input([late], { reason: 'allRecovered', endTick: late.tick }))).not.toContain('LAST_SECONDS');
  });

  it('COMEBACK after trailing by more than 500', () => {
    const trailing = [rec(100, 6, 'bank', 1, COMEBACK_DEFICIT + 100, [3]), rec(800, 5, 'bank', 0, 1000, [1], [7, 8, 9])];
    expect(evaluateMatchAchievements(input(trailing))).toContain('COMEBACK');
    const close = [rec(100, 6, 'bank', 1, COMEBACK_DEFICIT, [3]), rec(800, 5, 'bank', 0, 1000, [1], [7, 8, 9])];
    expect(evaluateMatchAchievements(input(close))).not.toContain('COMEBACK');
    expect(evaluateMatchAchievements(input(trailing, { winner: null }))).not.toContain('COMEBACK');
  });

  it('summarizes stats for the player team', () => {
    const s = summarizeMatchStats(
      input(
        [rec(100, 10, 'smallSafe', 0, 100, [1]), rec(900, 5, 'bank', 0, 1000, [1], [7, 8, 9]), rec(950, 6, 'bank', 1, 500, [3])],
        { scores: [1100, 500], winner: 0 },
      ),
    );
    expect(s).toEqual({ outcome: 'win', teamScore: 1100, banksRecovered: 1, safesRecovered: 4 });
    expect(summarizeMatchStats(input([], { winner: null })).outcome).toBe('draw');
    expect(summarizeMatchStats(input([], { winner: 1 })).outcome).toBe('loss');
  });
});

describe('progressAchievements', () => {
  it('derives tournament and wardrobe achievements from the save', () => {
    const d = createDefaultSaveData();
    expect(progressAchievements(d)).toEqual([]);
    d.tournament.beaten = ['hodadak', 'tongkeun'];
    expect(progressAchievements(d)).toEqual(['BEAT_HODADAK', 'BEAT_TONGKEUN']);
    d.tournament.beaten.push('nunchi');
    for (const hat of Object.values(RIVAL_REWARD_HAT)) unlockHat(d.cosmetics, hat);
    expect(progressAchievements(d)).toEqual(['BEAT_HODADAK', 'BEAT_TONGKEUN', 'BEAT_NUNCHI', 'TOURNAMENT_CLEAR', 'WARDROBE']);
  });
});
