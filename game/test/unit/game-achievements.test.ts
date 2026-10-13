/**
 * Achievement detection from real match records (src/game/achievements.ts).
 */
import { describe, expect, it } from 'vitest';
import { COMEBACK_DEFICIT, evaluateMatchAchievements, tournamentAchievements, wardrobeAchievement, type AchievementInput } from '../../src/game/achievements';
import type { MatchResult, SimEvent, TeamId } from '../../src/sim/types';

const END = 14400;
// 1 = human (team 0), 2 = teammate (team 0, 2:2 only), 3 = opponent (team 1)
// 10 = bank, 11 = large safe in the bank, 12/13 small safes in the bank, 20 = outdoor small, 21 = outdoor large
const loot = [
  { id: 10, kind: 'bank' as const },
  { id: 11, kind: 'largeSafe' as const },
  { id: 12, kind: 'smallSafe' as const },
  { id: 13, kind: 'smallSafe' as const },
  { id: 20, kind: 'smallSafe' as const },
  { id: 21, kind: 'largeSafe' as const },
];
const c1v1 = [
  { id: 1, team: 0 as TeamId },
  { id: 3, team: 1 as TeamId },
];
const c2v2 = [
  { id: 1, team: 0 as TeamId },
  { id: 2, team: 0 as TeamId },
  { id: 3, team: 1 as TeamId },
  { id: 4, team: 1 as TeamId },
];

function input(events: SimEvent[], o: { result?: Partial<MatchResult> | null; chars?: typeof c1v1; timeLimit?: boolean } = {}): AchievementInput {
  return {
    events,
    result: o.result === null ? null : { reason: 'time', winner: 0, scores: [0, 0], endTick: END, ...(o.result ?? {}) },
    humanCharId: 1,
    humanTeam: 0,
    characters: o.chars ?? c1v1,
    loot,
    rules: { matchTicks: END, timeLimit: o.timeLimit ?? true },
  };
}
const rec = (tick: number, lootId: number, kind: 'smallSafe' | 'largeSafe' | 'bank', team: TeamId, value: number, holders: number[], safeIds: number[] = []): SimEvent => ({
  type: 'recovered',
  tick,
  lootId,
  kind,
  team,
  value,
  safeIds,
  safesValue: safeIds.length ? value - 500 : 0,
  holders,
});
const grab = (tick: number, charId: number, targetId: number): SimEvent => ({ type: 'grab', tick, charId, targetId, part: targetId === 10 ? 'bankWall' : 'safe' });
const release = (tick: number, charId: number, targetId: number): SimEvent => ({ type: 'release', tick, charId, targetId, forced: false });

describe('evaluateMatchAchievements', () => {
  it('FIRST_RECOVERY needs the human to take part (holding, or let go within 3 s)', () => {
    expect(evaluateMatchAchievements(input([rec(100, 20, 'smallSafe', 0, 100, [1])]))).toEqual(['FIRST_RECOVERY']);
    expect(evaluateMatchAchievements(input([grab(10, 1, 20), release(100, 1, 20), rec(200, 20, 'smallSafe', 0, 100, [])]))).toEqual(['FIRST_RECOVERY']);
    expect(evaluateMatchAchievements(input([grab(10, 1, 20), release(100, 1, 20), rec(400, 20, 'smallSafe', 0, 100, [])]))).toEqual([]);
    // the other team's recovery never counts
    expect(evaluateMatchAchievements(input([rec(100, 20, 'smallSafe', 1, 100, [3])], { result: { winner: 1 } }))).toEqual([]);
  });

  it('BANK_WHOLE needs at least one safe inside the recovered bank', () => {
    expect(evaluateMatchAchievements(input([rec(900, 10, 'bank', 0, 1000, [1], [11, 12, 13])]))).toContain('BANK_WHOLE');
    expect(evaluateMatchAchievements(input([rec(900, 10, 'bank', 0, 600, [1], [12])]))).toContain('BANK_WHOLE');
    expect(evaluateMatchAchievements(input([rec(900, 10, 'bank', 0, 500, [1], [])]))).not.toContain('BANK_WHOLE');
  });

  it('BANK_HEIST_TEAM: 2:2 bank recovered while the human AND the teammate held it', () => {
    const both = evaluateMatchAchievements(input([grab(100, 2, 10), rec(900, 10, 'bank', 0, 1000, [1, 2], [11, 12, 13])], { chars: c2v2 }));
    expect(both).toContain('BANK_HEIST_TEAM');
    const humanOnly = evaluateMatchAchievements(input([rec(900, 10, 'bank', 0, 1000, [1], [11, 12, 13])], { chars: c2v2 }));
    expect(humanOnly).not.toContain('BANK_HEIST_TEAM');
    const mateOnly = evaluateMatchAchievements(input([rec(900, 10, 'bank', 0, 1000, [2], [11, 12, 13])], { chars: c2v2 }));
    expect(mateOnly).not.toContain('BANK_HEIST_TEAM');
    expect(mateOnly).not.toContain('BANK_WHOLE');
    // never in 1:1 (no teammate)
    expect(evaluateMatchAchievements(input([rec(900, 10, 'bank', 0, 1000, [1], [11])]))).not.toContain('BANK_HEIST_TEAM');
  });

  it('STEAL_LARGE: the human pulls a big safe out of a bank the opponents were hauling and the team recovers it', () => {
    const steal: SimEvent = { type: 'safeUnloaded', tick: 500, safeId: 11, bankId: 10, bankValue: 700, byCharId: 1, bankCarrierTeam: 1 };
    expect(evaluateMatchAchievements(input([steal, rec(800, 11, 'largeSafe', 0, 300, [1])]))).toContain('STEAL_LARGE');
    // pulled but recovered by the opponents
    expect(evaluateMatchAchievements(input([steal, rec(800, 11, 'largeSafe', 1, 300, [3])], { result: { winner: 1 } }))).not.toContain('STEAL_LARGE');
    // our own bank, a small safe, or nobody hauling: no
    expect(evaluateMatchAchievements(input([{ ...steal, bankCarrierTeam: 0 }, rec(800, 11, 'largeSafe', 0, 300, [1])]))).not.toContain('STEAL_LARGE');
    expect(evaluateMatchAchievements(input([{ ...steal, safeId: 12 }, rec(800, 12, 'smallSafe', 0, 100, [1])]))).not.toContain('STEAL_LARGE');
    expect(evaluateMatchAchievements(input([{ ...steal, bankCarrierTeam: null }, rec(800, 11, 'largeSafe', 0, 300, [1])]))).not.toContain('STEAL_LARGE');
  });

  it('FENCE_BREAKER: a fence broken by a bank the human was holding', () => {
    const fence: SimEvent = { type: 'fenceBroken', tick: 200, fenceId: 'f', bankId: 10, pos: { x: 0, y: 0 } };
    expect(evaluateMatchAchievements(input([grab(10, 1, 10), fence]))).toEqual(['FENCE_BREAKER']);
    expect(evaluateMatchAchievements(input([grab(10, 1, 10), release(150, 1, 10), fence]))).toEqual([]);
    expect(evaluateMatchAchievements(input([grab(10, 3, 10), fence]))).toEqual([]);
  });

  it('LAST_SECONDS: a recovery in the final 5 s of the clock (even if it decides the match early)', () => {
    expect(evaluateMatchAchievements(input([rec(END - 240, 20, 'smallSafe', 0, 100, [1])]))).toContain('LAST_SECONDS');
    expect(evaluateMatchAchievements(input([rec(END - 360, 20, 'smallSafe', 0, 100, [1])]))).not.toContain('LAST_SECONDS');
    // decided early by that very recovery
    expect(evaluateMatchAchievements(input([rec(END - 100, 20, 'smallSafe', 0, 100, [1])], { result: { reason: 'decided', endTick: END - 100 } }))).toContain('LAST_SECONDS');
    // the final countdown moves the end: 4 s before the NEW end counts
    const fc: SimEvent = { type: 'finalCountdown', tick: 6000, endTick: 7800, previousEndTick: END };
    expect(evaluateMatchAchievements(input([fc, rec(7800 - 240, 20, 'smallSafe', 0, 100, [1])]))).toContain('LAST_SECONDS');
    // no clock, no last seconds; evaluation while running works too
    expect(evaluateMatchAchievements(input([rec(END - 60, 20, 'smallSafe', 0, 100, [1])], { timeLimit: false }))).not.toContain('LAST_SECONDS');
    expect(evaluateMatchAchievements(input([rec(END - 60, 20, 'smallSafe', 0, 100, [1])], { result: null }))).toContain('LAST_SECONDS');
  });

  it(`COMEBACK: win after trailing by >= ${COMEBACK_DEFICIT}`, () => {
    const events = [rec(100, 10, 'bank', 1, 500, [3]), rec(200, 21, 'largeSafe', 0, 300, [1]), rec(300, 20, 'smallSafe', 0, 100, [1]), rec(400, 11, 'largeSafe', 0, 300, [1])];
    expect(evaluateMatchAchievements(input(events, { result: { winner: 0 } }))).toContain('COMEBACK');
    expect(evaluateMatchAchievements(input(events, { result: null }))).not.toContain('COMEBACK');
    const smaller = [rec(100, 21, 'largeSafe', 1, 300, [3]), rec(150, 20, 'smallSafe', 1, 100, [3]), rec(200, 11, 'largeSafe', 0, 300, [1]), rec(300, 12, 'smallSafe', 0, 100, [1]), rec(400, 13, 'smallSafe', 0, 100, [1])];
    expect(evaluateMatchAchievements(input(smaller, { result: { winner: 0 } }))).not.toContain('COMEBACK');
    expect(evaluateMatchAchievements(input(events, { result: { winner: null } }))).not.toContain('COMEBACK');
  });
});

describe('tournament / wardrobe achievements', () => {
  it('BEAT_* per rival and TOURNAMENT_CLEAR when all three are beaten', () => {
    expect(tournamentAchievements([])).toEqual([]);
    expect(tournamentAchievements(['hodadak'])).toEqual(['BEAT_HODADAK']);
    expect(tournamentAchievements(['hodadak', 'tongkeun', 'nunchi'])).toEqual(['BEAT_HODADAK', 'BEAT_TONGKEUN', 'BEAT_NUNCHI', 'TOURNAMENT_CLEAR']);
  });

  it('WARDROBE when a rival reward hat is equipped', () => {
    expect(wardrobeAchievement('hodadakBand')).toEqual(['WARDROBE']);
    expect(wardrobeAchievement('nunchiMask')).toEqual(['WARDROBE']);
    expect(wardrobeAchievement('teamCapA')).toEqual([]);
    expect(wardrobeAchievement('none')).toEqual([]);
  });
});
