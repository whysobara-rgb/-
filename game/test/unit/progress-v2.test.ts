/**
 * Save v2 helpers (fun round WP9 + Content 2.0 F9): recordMatchOutcome (one write, idempotent,
 * honest records), head-to-head records, cups, funnel counters, event-log facts and the
 * Content 2.0 menu memory.
 */
import { describe, expect, it } from 'vitest';
import {
  bumpFunnel,
  completeOnboardingStep,
  cupProgress,
  dismissOnboarding,
  funnelReport,
  grantRivalReward,
  localDay,
  markItemSeen,
  markLayoutSeen,
  markMilestone,
  matchOutcomeFacts,
  RECORD_MIN_FASTER_TICKS,
  RECORD_MIN_VALUE,
  recordMatchOutcome,
  rivalRecord,
  rivalRecordKeyOf,
  setLastEventKind,
  setLastQuick,
  setLastSeenVersion,
  unseenItems,
  type MatchOutcomeSummary,
} from '../../src/platform/progress';
import { MemorySaveBackend, SaveManager, createDefaultSaveData } from '../../src/platform/save';
import { createDefaultSettings } from '../../src/platform/settings';
import type { MatchResult, SimEvent } from '../../src/sim/types';

const T0 = new Date(2026, 9, 7, 20, 0, 0).getTime();
const DAY = 24 * 3600 * 1000;

function fresh(): { save: SaveManager; backend: MemorySaveBackend } {
  const backend = new MemorySaveBackend();
  const save = new SaveManager(backend, { flushOnHide: false, defaults: () => createDefaultSaveData(createDefaultSettings({ languages: ['ko'] })) });
  save.load();
  return { save, backend };
}

let n = 0;
function match(patch: Partial<MatchOutcomeSummary> = {}): MatchOutcomeSummary {
  n++;
  return {
    matchId: `seed${n}:${T0 + n}`,
    layoutId: 'plaza',
    rival: 'hodadak',
    mode: 'quick',
    teamMode: '1v1',
    difficulty: 'normal',
    cup: null,
    outcome: 'win',
    myScore: 1700,
    theirScore: 1500,
    endReason: 'time',
    ticks: 14400,
    biggestHaul: 900,
    firstRecoveryTick: 1200,
    maxDeficit: 300,
    finishedAt: T0 + n * 60_000,
    ...patch,
  };
}

describe('recordMatchOutcome', () => {
  it('updates every v2 field in ONE immediate write', () => {
    const { save, backend } = fresh();
    const before = backend.writes;
    recordMatchOutcome(match({ challengeDeltas: { 'apprentice.smallSafes': 2 }, challengeCompleted: ['apprentice.firstRecovery'], eventKind: 'goldSafe', biggestSplash: 60, biggestDeposit: 120 }), save);
    expect(backend.writes - before).toBe(1);
    expect(save.dirty).toBe(false);
    const d = save.data;
    expect(d.rivals.hodadak['quick.normal']).toEqual({ wins: 1, losses: 0, draws: 0, streak: 1, lastScore: 1700, bestMargin: 200 });
    expect(d.records.plaza.hodadak).toEqual({ bestScore: 1700, bestMargin: 200 });
    expect(d.globalRecords).toEqual({ biggestHaul: 900, fastestFirstRecovery: 1200, biggestSplash: 60, biggestDeposit: 120 });
    expect(d.challenges).toEqual({ counters: { 'apprentice.smallSafes': 2 }, completed: ['apprentice.firstRecovery'] });
    expect(d.recent).toHaveLength(1);
    expect(d.seenLayouts).toEqual(['plaza']);
    expect(d.lastEventKind).toBe('goldSafe');
    expect(d.funnel.counts.matchFinished).toBe(1);
    expect(d.funnel).toMatchObject({ matchesThisSession: 1, playDays: 1, lastPlayDay: localDay(T0 + n * 60_000) });
    expect(Object.keys(d.funnel.milestones).sort()).toEqual(['firstMatch', 'firstWin']);
    expect(JSON.parse(backend.read('main')!).recent).toHaveLength(1);
    save.dispose();
  });

  it('is idempotent per match id (a double call does not double count)', () => {
    const { save, backend } = fresh();
    recordMatchOutcome(match({ myScore: 1000, theirScore: 900 }), save);
    const m = match({ myScore: 1800, theirScore: 1000, challengeDeltas: { x: 1 } });
    const first = recordMatchOutcome(m, save);
    expect(first.newRecord).toBe('layoutBestScore');
    const snapshot = JSON.stringify(save.data);
    const writes = backend.writes;
    const second = recordMatchOutcome({ ...m }, save);
    expect(second).toEqual(first); // same answer while it is the latest match
    expect(JSON.stringify(save.data)).toBe(snapshot);
    expect(backend.writes).toBe(writes);
    expect(save.data.rivals.hodadak['quick.normal']!.wins).toBe(2);
    expect(save.data.challenges.counters.x).toBe(1);
    expect(save.data.funnel.counts.matchFinished).toBe(2);
    // An older id: still a no-op, no record claimed.
    recordMatchOutcome(match(), save);
    expect(recordMatchOutcome(m, save)).toEqual({ newRecord: null, newRecords: [] });
    save.dispose();
  });

  it('honest records: the first value is a silent baseline; only a strictly better one is "new"', () => {
    const { save } = fresh();
    expect(recordMatchOutcome(match({ myScore: 1500, theirScore: 1400, biggestHaul: 800, firstRecoveryTick: 1500 }), save).newRecord).toBeNull();
    // Equal is not a record.
    expect(recordMatchOutcome(match({ myScore: 1500, theirScore: 1400, biggestHaul: 800, firstRecoveryTick: 1500 }), save).newRecord).toBeNull();
    // Another rival on the same layout is a fresh cell (baseline again), but the global haul counts.
    const r = recordMatchOutcome(match({ rival: 'nunchi', myScore: 1900, theirScore: 1000, biggestHaul: 1100, firstRecoveryTick: 1400 }), save);
    expect(r.newRecord).toBe('biggestHaul');
    expect(r.newRecords).toEqual([
      { kind: 'biggestHaul', value: 1100, previous: 800 },
      { kind: 'fastestFirstRecovery', value: 1400, previous: 1500 },
    ]);
    // Score + margin + splash in one match: most notable first (RECORD_KINDS order).
    recordMatchOutcome(match({ biggestSplash: 50, firstRecoveryTick: null, biggestHaul: 0 }), save);
    const r2 = recordMatchOutcome(match({ myScore: 2000, theirScore: 1200, biggestHaul: 500, firstRecoveryTick: null, biggestSplash: 90 }), save);
    expect(r2.newRecords.map((x) => x.kind)).toEqual(['layoutBestScore', 'layoutBestMargin', 'biggestSplash']);
    expect(r2.newRecord).toBe('layoutBestScore');
    // A loss never sets a margin; deficits are not records.
    const r3 = recordMatchOutcome(match({ outcome: 'loss', myScore: 2100, theirScore: 2200, biggestHaul: 0, firstRecoveryTick: null }), save);
    expect(r3.newRecords).toEqual([{ kind: 'layoutBestScore', value: 2100, previous: 2000 }]);
    expect(save.data.records.plaza.hodadak).toEqual({ bestScore: 2100, bestMargin: 800 });
    save.dispose();
  });

  it('a record must read as better: 1 s faster first recovery, coin records above their floor', () => {
    const { save } = fresh();
    const base = { firstRecoveryTick: 1500, biggestHaul: 0, biggestSplash: 10, biggestDeposit: 40 };
    expect(recordMatchOutcome(match(base), save).newRecords).toEqual([]);
    // 59 ticks faster (shows the same whole second), a 20-coin splash, an 80-coin deposit: stored silently.
    const small = recordMatchOutcome(match({ ...base, firstRecoveryTick: 1500 - RECORD_MIN_FASTER_TICKS + 1, biggestSplash: 20, biggestDeposit: 80 }), save);
    expect(small.newRecords).toEqual([]);
    expect(save.data.globalRecords).toMatchObject({ fastestFirstRecovery: 1441, biggestSplash: 20, biggestDeposit: 80 });
    // Exactly 1 s faster than the stored best, a splash and a deposit at their floors: all three are new.
    const big = recordMatchOutcome(
      match({ ...base, firstRecoveryTick: 1441 - RECORD_MIN_FASTER_TICKS, biggestSplash: RECORD_MIN_VALUE.biggestSplash!, biggestDeposit: RECORD_MIN_VALUE.biggestDeposit! }),
      save,
    );
    expect(big.newRecords).toEqual([
      { kind: 'biggestSplash', value: 50, previous: 20 },
      { kind: 'biggestDeposit', value: 100, previous: 80 },
      { kind: 'fastestFirstRecovery', value: 1381, previous: 1441 },
    ]);
    expect(RECORD_MIN_FASTER_TICKS).toBe(60);
    save.dispose();
  });

  it('head-to-head streaks, draws, buckets and the "all" view', () => {
    const { save } = fresh();
    const seq: Array<Partial<MatchOutcomeSummary>> = [
      { outcome: 'win' },
      { outcome: 'win' },
      { outcome: 'loss', myScore: 1400, theirScore: 1800 },
      { outcome: 'loss', myScore: 1300, theirScore: 1900 },
      { outcome: 'draw', myScore: 1600, theirScore: 1600 },
      { outcome: 'loss', myScore: 900, theirScore: 2300 },
    ];
    for (const p of seq) recordMatchOutcome(match(p), save);
    expect(rivalRecord('hodadak', 'quick.normal', save)).toEqual({ wins: 2, losses: 3, draws: 1, streak: -1, lastScore: 900, bestMargin: 200 });
    // Tournament match without a cup = today's ladder at 보통.
    expect(rivalRecordKeyOf({ mode: 'tournament', cup: null, difficulty: 'challenge' })).toBe('cup.normal');
    recordMatchOutcome(match({ mode: 'tournament', cup: 'novice', outcome: 'win', myScore: 2000, theirScore: 1000 }), save);
    expect(rivalRecord('hodadak', 'cup.novice', save)).toMatchObject({ wins: 1, streak: 1, bestMargin: 1000 });
    const all = rivalRecord('hodadak', 'all', save);
    expect(all).toEqual({ wins: 3, losses: 3, draws: 1, streak: 1, lastScore: 2000, bestMargin: 1000 });
    expect(rivalRecord('tongkeun', 'all', save)).toEqual({ wins: 0, losses: 0, draws: 0, streak: 0, lastScore: 0, bestMargin: 0 });
    save.dispose();
  });

  it('a tutorial counts in the funnel only', () => {
    const { save } = fresh();
    recordMatchOutcome(match({ mode: 'tutorial', layoutId: 'tutorial', rival: null }), save);
    expect(save.data.recent).toEqual([]);
    expect(save.data.globalRecords.biggestHaul).toBe(0);
    expect(save.data.seenLayouts).toEqual([]);
    expect(save.data.funnel.counts.matchFinished).toBe(1);
    expect(Object.keys(save.data.funnel.milestones)).toEqual(['firstTutorial']);
    save.dispose();
  });

  it('keeps the last 20 summaries, oldest first, and never throws on junk', () => {
    const { save } = fresh();
    for (let i = 0; i < 25; i++) recordMatchOutcome(match(), save);
    expect(save.data.recent).toHaveLength(20);
    expect(save.data.recent.at(-1)!.matchId).toBe(`seed${n}:${T0 + n}`);
    expect(recordMatchOutcome({} as MatchOutcomeSummary, save)).toEqual({ newRecord: null, newRecords: [] });
    expect(recordMatchOutcome(null as unknown as MatchOutcomeSummary, save)).toEqual({ newRecord: null, newRecords: [] });
    save.dispose();
  });

  it('challenge counters accumulate across matches (caps are the producer\'s)', () => {
    const { save } = fresh();
    recordMatchOutcome(match({ challengeDeltas: { 'apprentice.smallSafes': 3, 'apprentice.policeStuns': 2 } }), save);
    recordMatchOutcome(match({ challengeDeltas: { 'apprentice.smallSafes': 3, bad: -4, 'no spaces': 1 } }), save);
    expect(save.data.challenges.counters).toEqual({ 'apprentice.smallSafes': 6, 'apprentice.policeStuns': 2 });
    save.dispose();
  });
});

describe('cups, rewards, onboarding', () => {
  it('cupProgress follows the tournament order', () => {
    const { save } = fresh();
    expect(cupProgress('novice', save)).toEqual({ cup: 'novice', beaten: [], nextRival: 'hodadak', cleared: false });
    save.update((d) => (d.cups.novice = ['hodadak', 'tongkeun']));
    expect(cupProgress('novice', save)).toEqual({ cup: 'novice', beaten: ['hodadak', 'tongkeun'], nextRival: 'nunchi', cleared: false });
    save.update((d) => (d.cups.novice = ['hodadak', 'tongkeun', 'nunchi']));
    expect(cupProgress('novice', save)).toMatchObject({ nextRival: null, cleared: true });
    expect(cupProgress('challenge', save).cleared).toBe(false);
    // Clearing a rival in a cup lists it as beaten and grants hat + taunt (self-heal).
    expect(save.data.tournament.beaten).toEqual(['hodadak', 'tongkeun', 'nunchi']);
    expect(save.data.cosmetics.unlockedEmotes).toEqual(['hodadakZoom', 'tongkeunFlex', 'nunchiShrug']);
    save.dispose();
  });

  it('grantRivalReward gives the hat and the taunt once', () => {
    const { save } = fresh();
    let r = { hatNew: false, emoteNew: false };
    save.update((d) => (r = grantRivalReward(d.cosmetics, 'nunchi')));
    expect(r).toEqual({ hatNew: true, emoteNew: true });
    expect(save.data.cosmetics.unlockedEmotes).toEqual(['nunchiShrug']);
    save.update((d) => (r = grantRivalReward(d.cosmetics, 'nunchi')));
    expect(r).toEqual({ hatNew: false, emoteNew: false });
    save.dispose();
  });

  it('onboarding steps are stored in path order; dismiss never locks anything', () => {
    const { save } = fresh();
    expect(completeOnboardingStep('policeMatch', save)).toBe(true);
    expect(completeOnboardingStep('practice', save)).toBe(true);
    expect(completeOnboardingStep('practice', save)).toBe(false);
    expect(save.data.onboarding.done).toEqual(['practice', 'policeMatch']);
    dismissOnboarding(save);
    expect(save.data.onboarding.dismissed).toBe(true);
    save.dispose();
  });
});

describe('funnel (local only)', () => {
  it('sessions, matches per session, distinct play days, milestones', () => {
    const { save } = fresh();
    bumpFunnel('sessionStarted', save, T0);
    recordMatchOutcome(match({ finishedAt: T0 + 1000 }), save);
    recordMatchOutcome(match({ finishedAt: T0 + 2000 }), save);
    expect(save.data.funnel).toMatchObject({ matchesThisSession: 2, playDays: 1 });
    bumpFunnel('sessionStarted', save, T0 + DAY);
    expect(save.data.funnel.matchesThisSession).toBe(0);
    recordMatchOutcome(match({ finishedAt: T0 + DAY }), save);
    expect(save.data.funnel).toMatchObject({ matchesThisSession: 1, playDays: 2, lastPlayDay: localDay(T0 + DAY) });
    for (const k of ['resultsShown', 'rematchPress', 'resultsShown', 'playPressed', 'itemsToggle'] as const) bumpFunnel(k, save, T0 + DAY);
    expect(save.data.funnel.counts).toMatchObject({ sessionStarted: 2, resultsShown: 2, rematchPress: 1, playPressed: 1, itemsToggle: 1, matchFinished: 3 });
    expect(markMilestone('firstHat', save, T0)).toBe(true);
    expect(markMilestone('firstHat', save, T0 + 5)).toBe(false);
    expect(save.data.funnel.milestones.firstHat).toBe(T0);
    expect(markMilestone('not ok!', save)).toBe(false);
    const report = funnelReport(save);
    expect(report).toContain('rematch / results: 50%');
    expect(report.some((l) => l.startsWith('playPressed: 1'))).toBe(true);
    // Unknown keys are ignored; nothing throws.
    expect(() => bumpFunnel('bogus' as never, save)).not.toThrow();
    save.dispose();
  });

  it('a session starts on the app-wide manager\'s first load (no caller needed), once per boot', () => {
    const backend = new MemorySaveBackend();
    const opts = { flushOnHide: false, defaults: () => createDefaultSaveData(createDefaultSettings({ languages: ['ko'] })) };
    // Boot 1: getSaveManager() loads, then main.ts loads the same manager again.
    const a = new SaveManager(backend, { ...opts, countSession: true });
    a.load();
    expect(a.data.funnel.counts.sessionStarted).toBe(1);
    expect(a.dirty).toBe(false); // written right away ...
    a.load(); // ... so the second load in the same boot keeps it and does not count again
    expect(a.data.funnel.counts.sessionStarted).toBe(1);
    recordMatchOutcome(match({ finishedAt: T0 }), a);
    recordMatchOutcome(match({ finishedAt: T0 + 1000 }), a);
    expect(a.data.funnel.matchesThisSession).toBe(2);
    a.dispose();
    // Boot 2: matches-this-session starts from zero, the session count goes up.
    const b = new SaveManager(backend, { ...opts, countSession: true });
    b.load();
    expect(b.data.funnel).toMatchObject({ matchesThisSession: 0, counts: expect.objectContaining({ sessionStarted: 2, matchFinished: 2 }) });
    recordMatchOutcome(match({ finishedAt: T0 + DAY }), b);
    expect(b.data.funnel.matchesThisSession).toBe(1);
    b.dispose();
    // Plain managers (tests, ?fresh) never count a session.
    const c = new SaveManager(backend, opts);
    c.load();
    expect(c.data.funnel.counts.sessionStarted).toBe(2);
    expect(c.data.funnel.matchesThisSession).toBe(1);
    c.dispose();
  });

  it('a session start never overwrites a newer-version save by itself', () => {
    const backend = new MemorySaveBackend();
    const newer = JSON.stringify({ ...createDefaultSaveData(createDefaultSettings({ languages: ['ko'] })), version: 99 });
    backend.slots.set('main', newer);
    const m = new SaveManager(backend, { flushOnHide: false, countSession: true });
    expect(m.load().newerVersion).toBe(true);
    expect(m.data.funnel.counts.sessionStarted).toBe(1);
    expect(backend.read('main')).toBe(newer);
    expect(backend.writes).toBe(0);
    m.dispose();
  });

  it('ids named like Object.prototype members are ordinary ids (no NaN, no false "already set")', () => {
    const { save, backend } = fresh();
    recordMatchOutcome(match({ challengeDeltas: { constructor: 2, toString: 1, valueOf: 3 } }), save);
    recordMatchOutcome(match({ challengeDeltas: { constructor: 1 } }), save);
    expect(save.data.challenges.counters).toEqual({ constructor: 3, toString: 1, valueOf: 3 });
    const written = JSON.parse(backend.read('main')!) as { challenges: { counters: Record<string, unknown> } };
    expect(written.challenges.counters).toEqual({ constructor: 3, toString: 1, valueOf: 3 });
    for (const k of ['toString', 'valueOf', 'constructor', 'hasOwnProperty']) {
      expect(markMilestone(k, save, T0), k).toBe(true);
      expect(markMilestone(k, save, T0 + 1), k).toBe(false);
    }
    expect(save.data.funnel.milestones.toString).toBe(T0);
    // Reload keeps them (own properties, finite numbers).
    save.flush();
    const again = new SaveManager(backend, { flushOnHide: false });
    again.load();
    expect(again.data.challenges.counters).toEqual({ constructor: 3, toString: 1, valueOf: 3 });
    expect(Object.keys(again.data.funnel.milestones)).toEqual(expect.arrayContaining(['toString', 'valueOf', 'constructor', 'hasOwnProperty']));
    // rivalRecord with untyped junk returns an empty record instead of an inherited member.
    expect(rivalRecord('constructor' as never, 'all', save)).toEqual(rivalRecord('nunchi', 'all', save));
    expect(rivalRecord('hodadak', 'toString' as never, save).wins).toBe(0);
    save.dispose();
    again.dispose();
  });

  it('bumpFunnel never throws, even if the backend does', () => {
    const throwing = {
      kind: 'memory' as const,
      read: (): string | null => null,
      write: (): boolean => {
        throw new Error('EROFS');
      },
      quarantine: (): boolean => true,
    };
    const save = new SaveManager(throwing, { flushOnHide: false, debounceMs: 0 });
    save.load();
    expect(() => bumpFunnel('menuPress', save)).not.toThrow();
    expect(() => recordMatchOutcome(match(), save)).not.toThrow();
    save.dispose();
  });
});

describe('matchOutcomeFacts (event log -> summary numbers)', () => {
  const chars = [
    { id: 0, team: 0 as const },
    { id: 1, team: 1 as const },
  ];
  const rec = (tick: number, team: 0 | 1, value: number): SimEvent =>
    ({ type: 'recovered', tick, lootId: 100 + tick, kind: 'smallSafe', team, value, safeIds: [], safesValue: 0, holders: [] }) as SimEvent;

  it('haul, first recovery, deficit, splash and deposit are recomputed from the log', () => {
    const events: SimEvent[] = [
      rec(500, 1, 300),
      rec(900, 1, 500),
      { type: 'coinsBanked', tick: 950, charId: 0, team: 0, value: 120 },
      { type: 'bagSpilled', tick: 1000, charId: 1, value: 90, byId: 0, cause: 'hammer' },
      { type: 'bagSpilled', tick: 1100, charId: 0, value: 200, byId: 1, cause: 'dash' }, // theirs, not ours
      { type: 'bagSpilled', tick: 1150, charId: 1, value: 300, byId: null, cause: 'police' }, // police, not ours
      rec(1200, 0, 1100),
      { type: 'coinsBanked', tick: 1300, charId: 0, team: 0, value: 60 },
      rec(1400, 0, 100),
    ];
    const result: MatchResult = { reason: 'time', winner: 0, scores: [1380, 800], endTick: 14400 };
    expect(matchOutcomeFacts({ events, result, humanTeam: 0, characters: chars })).toEqual({
      outcome: 'win',
      myScore: 1380,
      theirScore: 800,
      endReason: 'time',
      ticks: 14400,
      biggestHaul: 1100,
      firstRecoveryTick: 1200,
      maxDeficit: 800,
      biggestSplash: 90,
      biggestDeposit: 120,
    });
    const theirs = matchOutcomeFacts({ events, result, humanTeam: 1, characters: chars });
    expect(theirs).toMatchObject({ outcome: 'loss', biggestHaul: 500, firstRecoveryTick: 500, maxDeficit: 580, biggestSplash: 200, biggestDeposit: 0 });
    expect(matchOutcomeFacts({ events: [], result: { reason: 'time', winner: null, scores: [0, 0], endTick: 1 }, humanTeam: 0, characters: chars })).toMatchObject({
      outcome: 'draw',
      biggestHaul: 0,
      firstRecoveryTick: null,
      maxDeficit: 0,
    });
  });
});

describe('Content 2.0 menu memory', () => {
  it('lastQuick is sanitized and survives a reload', () => {
    const { save, backend } = fresh();
    expect(save.data.lastQuick).toBeNull();
    const q = setLastQuick({ layout: 'counter', mode: '2v2', difficulty: 'challenge', rival: 'nunchi', items: 'hammerOnly', events: 'off' }, save);
    expect(q).toEqual({ layout: 'counter', mode: '2v2', difficulty: 'challenge', rival: 'nunchi', items: 'hammerOnly', events: 'off' });
    expect(setLastQuick({ layout: 'tutorial', mode: '1v1', difficulty: 'normal', rival: 'random', items: 'on', events: 'on' }, save)!.layout).toBe('random');
    save.flush();
    const again = new SaveManager(backend, { flushOnHide: false });
    again.load();
    expect(again.data.lastQuick).toEqual({ layout: 'random', mode: '1v1', difficulty: 'normal', rival: 'random', items: 'on', events: 'on' });
    save.dispose();
    again.dispose();
  });

  it('item sightings drive the name tag for the first 3 sightings', () => {
    const { save } = fresh();
    expect(unseenItems(save)).toContain('hammer');
    const tags = [1, 2, 3, 4].map(() => markItemSeen('hammer', save));
    expect(tags).toEqual([
      { sightings: 1, showTag: true },
      { sightings: 2, showTag: true },
      { sightings: 3, showTag: true },
      { sightings: 4, showTag: false },
    ]);
    markItemSeen('soap', save);
    expect(save.data.seenItems).toEqual(['hammer', 'soap']);
    expect(unseenItems(save)).not.toContain('hammer');
    expect(markItemSeen('laser' as never, save)).toEqual({ sightings: 0, showTag: false });
    save.dispose();
  });

  it('seen layouts, last seen version, last event kind', () => {
    const { save } = fresh();
    expect(markLayoutSeen('counter', save)).toBe(true);
    expect(markLayoutSeen('counter', save)).toBe(false);
    expect(markLayoutSeen('plaza', save)).toBe(true);
    expect(save.data.seenLayouts).toEqual(['plaza', 'counter']);
    setLastSeenVersion('1.2.0-beta.1', save);
    setLastSeenVersion('<bad>', save);
    expect(save.data.lastSeenVersion).toBe('1.2.0-beta.1');
    setLastEventKind('cashTruck', save);
    expect(save.data.lastEventKind).toBe('cashTruck');
    setLastEventKind('meteor' as never, save);
    expect(save.data.lastEventKind).toBeNull();
    save.dispose();
  });
});
