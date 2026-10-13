/**
 * Save v2 (fun round WP9 + Content 2.0 F9): migration from v0 / v1, field sanitization,
 * newer-version quarantine, the rival-taunt self-heal, the size budget and the no-network rule.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CUP_IDS,
  FUNNEL_KEYS,
  EMOTE_IDS,
  HAT_IDS,
  MAX_ACHIEVEMENTS,
  MAX_ADAPT_LINE_KEY,
  MAX_ADAPT_PARAMS,
  MAX_ADAPT_PARAM_KEY,
  MAX_ADAPT_PARAM_VALUE,
  MAX_CHALLENGE_IDS,
  MAX_MILESTONES,
  ONBOARDING_STEPS,
  MAX_SUMMARY_CHALLENGES,
  MAX_VAN_PAINTS,
  MemorySaveBackend,
  RECENT_MAX,
  RECORDED_IDS_MAX,
  RECORD_LAYOUT_IDS,
  RIVALS,
  RIVAL_RECORD_KEYS,
  RIVAL_REWARD_EMOTE,
  RIVAL_REWARD_HAT,
  SAVE_ITEM_KINDS,
  SAVE_LAYOUT_IDS,
  SAVE_LOOT_EVENT_KINDS,
  SAVE_VERSION,
  SaveManager,
  createDefaultSaveData,
  migrateSave,
  sanitizeSaveData,
  type MatchOutcomeSummary,
  type SaveData,
} from '../../src/platform/save';
import { EMOTE_RIVAL } from '../../src/platform/emotes';
import { MATCH_ACTIONS, MAX_BINDINGS_PER_ACTION } from '../../src/platform/bindings';
import { createDefaultSettings } from '../../src/platform/settings';
import { LAYOUTS, MATCH_LAYOUT_IDS } from '../../src/sim/layouts';
import { ITEMS } from '../../src/sim/config';

const defaults = (): SaveData => createDefaultSaveData(createDefaultSettings({ languages: ['ko-KR'] }));
const manager = (backend: MemorySaveBackend): SaveManager => new SaveManager(backend, { debounceMs: 50, retryMs: 100, defaults, flushOnHide: false });

/** A save exactly as the v1 game wrote it (SAVE_VERSION 1, before WP9). */
function v1Fixture(): Record<string, unknown> {
  const settings = JSON.parse(JSON.stringify(createDefaultSettings({ languages: ['ko-KR'] }))) as Record<string, unknown>;
  settings.grabMode = 'toggle';
  return {
    version: 1,
    settings,
    tournament: {
      beaten: ['hodadak'],
      series: {
        rival: 'tongkeun',
        wins: 1,
        losses: 0,
        draws: 1,
        gameIndex: 2,
        layoutId: 'shortcut',
        adaptation: { kind: 'stripBank', lineKey: 'adapt.tongkeun.stripBank.1', lineParams: { n: '2' } },
      },
    },
    cosmetics: { unlocked: ['none', 'teamCapA', 'teamCapB', 'hodadakBand'], equipped: 'hodadakBand', seen: ['none', 'teamCapA', 'teamCapB'] },
    stats: { matches: 14, wins: 6, draws: 1, losses: 7, banksRecovered: 3, safesRecovered: 22, bestScore: 2100 },
    achievements: ['FIRST_RECOVERY', 'BEAT_HODADAK'],
    tutorialDone: true,
  };
}

function summary(i: number, patch: Partial<MatchOutcomeSummary> = {}): MatchOutcomeSummary {
  return {
    matchId: `${1000 + i}:${1_760_000_000_000 + i}`,
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
    finishedAt: 1_760_000_000_000 + i,
    ...patch,
  };
}

describe('save v2: migration', () => {
  it('SAVE_VERSION is 2 and a fresh save holds every v2 field', () => {
    expect(SAVE_VERSION).toBe(2);
    const d = defaults();
    expect(d.version).toBe(2);
    expect(Object.keys(d.cups)).toEqual([...CUP_IDS]);
    expect(Object.keys(d.records)).toEqual([...RECORD_LAYOUT_IDS]);
    expect(Object.keys(d.funnel.counts)).toEqual([...FUNNEL_KEYS]);
    expect(FUNNEL_KEYS).toContain('playPressed');
    expect(FUNNEL_KEYS).toContain('itemsToggle');
    expect(d.globalRecords).toEqual({ biggestHaul: 0, fastestFirstRecovery: null, biggestSplash: 0, biggestDeposit: 0 });
    expect(d.cosmetics).toMatchObject({ vanPaints: [], vanPaint: null, victoryPose: null });
    expect(d).toMatchObject({ lastQuick: null, seenItems: [], itemSightings: {}, seenLayouts: [], lastSeenVersion: null, lastEventKind: null, recordedMatchIds: [] });
    // A fresh save is already a sanitize fixpoint (no hidden repair on first load).
    expect(sanitizeSaveData(JSON.parse(JSON.stringify(d)), defaults())).toEqual(d);
  });

  it('v1 -> v2 is lossless: beaten filed under 보통, series kept (with cup), hat kept, taunt healed', () => {
    const v1 = v1Fixture();
    const r = migrateSave(JSON.parse(JSON.stringify(v1)), undefined, undefined, defaults());
    expect(r).toMatchObject({ fromVersion: 1, migrated: true, newer: false });
    const d = r.data;
    expect(d.version).toBe(2);
    // Every v1 field survives unchanged.
    expect(d.settings).toEqual(sanitizeSaveData(v1, defaults()).settings);
    expect(d.settings.grabMode).toBe('toggle');
    expect(d.tournament.beaten).toEqual(['hodadak']);
    expect(d.tournament.series).toEqual({ ...(v1.tournament as { series: object }).series, cup: 'normal' });
    expect(d.cosmetics.unlocked).toEqual(['none', 'teamCapA', 'teamCapB', 'hodadakBand']);
    expect(d.cosmetics.equipped).toBe('hodadakBand');
    expect(d.cosmetics.seen).toEqual(['none', 'teamCapA', 'teamCapB']);
    expect(d.stats).toEqual(v1.stats);
    expect(d.achievements).toEqual(v1.achievements);
    expect(d.tutorialDone).toBe(true);
    // v2 filing + the emote bug fix.
    expect(d.cups).toEqual({ novice: [], normal: ['hodadak'], challenge: [] });
    expect(d.cosmetics.unlockedEmotes).toEqual(['hodadakZoom']);
    // Everything else starts empty.
    expect(d.recent).toEqual([]);
    expect(d.rivals).toEqual({ hodadak: {}, tongkeun: {}, nunchi: {} });
  });

  it('v0 (unversioned) -> v2 runs both steps and keeps the old fields', () => {
    const r = migrateSave({ stats: { wins: 2, matches: 3 }, tournament: { beaten: ['nunchi', 'hodadak'] }, tutorialDone: true }, undefined, undefined, defaults());
    expect(r).toMatchObject({ fromVersion: 0, migrated: true });
    expect(r.data.version).toBe(2);
    expect(r.data.stats).toMatchObject({ wins: 2, matches: 3 });
    expect(r.data.tournament.beaten).toEqual(['hodadak', 'nunchi']);
    expect(r.data.cups.normal).toEqual(['hodadak', 'nunchi']);
    expect(r.data.cosmetics.unlocked).toEqual(expect.arrayContaining(['hodadakBand', 'nunchiMask']));
    expect(r.data.cosmetics.unlockedEmotes).toEqual(['hodadakZoom', 'nunchiShrug']);
    expect(r.data.tutorialDone).toBe(true);
  });

  it('a v1 save on disk loads as v2 and is written back after the debounce (old file kept as backup)', async () => {
    const b = new MemorySaveBackend();
    const text = JSON.stringify(v1Fixture());
    b.slots.set('main', text);
    const m = manager(b);
    expect(m.load()).toMatchObject({ source: 'main', fromVersion: 1, migrated: true, newerVersion: false });
    expect(m.data.cups.normal).toEqual(['hodadak']);
    await new Promise((r) => setTimeout(r, 80));
    expect(JSON.parse(b.read('main')!).version).toBe(2);
    expect(b.read('backup')).toBe(text);
    m.dispose();
  });

  it('a newer-version save (v3) is quarantined and loaded best-effort', () => {
    const b = new MemorySaveBackend();
    const future = JSON.stringify({ ...defaults(), version: 3, stats: { ...defaults().stats, wins: 9 }, futureThing: { a: 1 } });
    b.slots.set('main', future);
    const m = manager(b);
    const r = m.load();
    expect(r).toMatchObject({ newerVersion: true, migrated: false });
    expect(b.quarantined).toEqual([{ text: future, reason: 'newer-v3' }]);
    expect(m.data.stats.wins).toBe(9);
    expect(m.data.version).toBe(2);
    m.dispose();
  });

  it('a v2 save reloads identically', () => {
    const b = new MemorySaveBackend();
    const m = manager(b);
    m.load();
    m.update((d) => {
      d.tournament.beaten.push('tongkeun');
      d.cups.normal = ['tongkeun'];
      d.cups.challenge = ['hodadak'];
      d.rivals.nunchi['quick.challenge'] = { wins: 1, losses: 4, draws: 0, streak: -3, lastScore: 800, bestMargin: 100 };
      d.records.counter.tongkeun = { bestScore: 1900, bestMargin: 400 };
      d.globalRecords = { biggestHaul: 1300, fastestFirstRecovery: 640, biggestSplash: 120, biggestDeposit: 250 };
      d.challenges = { counters: { 'apprentice.smallSafes': 4 }, completed: ['apprentice.firstRecovery'] };
      d.recent.push(summary(1, { eventKind: 'goldSafe', biggestSplash: 60, challengeDeltas: { 'apprentice.smallSafes': 2 } }));
      d.onboarding = { done: ['practice', 'firstMatch'], dismissed: false };
      d.funnel.counts.playPressed = 3;
      d.funnel.milestones.firstWin = 1_760_000_000_000;
      d.cosmetics.vanPaints = ['starSticker'];
      d.cosmetics.vanPaint = 'starSticker';
      d.cosmetics.victoryPose = 'bleh';
      d.lastQuick = { layout: 'counter', mode: '2v2', difficulty: 'challenge', rival: 'random', items: 'hammerOnly', events: 'off' };
      d.seenItems = ['hammer'];
      d.itemSightings = { hammer: 2 };
      d.seenLayouts = ['plaza', 'counter'];
      d.lastSeenVersion = '1.1.0';
      d.lastEventKind = 'cashTruck';
      d.recordedMatchIds = ['a:1'];
    }, { immediate: true });
    const m2 = manager(b);
    expect(m2.load().source).toBe('main');
    expect(m2.data).toEqual(m.data);
    m.dispose();
    m2.dispose();
  });
});

describe('save v2: sanitization', () => {
  it('a corrupt v2 field is repaired without losing the rest', () => {
    const good = JSON.parse(JSON.stringify(defaults())) as Record<string, unknown>;
    good.stats = { ...(good.stats as object), wins: 5 };
    good.records = { plaza: { hodadak: { bestScore: 1800, bestMargin: 300 } } };
    good.rivals = 'garbage';
    good.cups = { novice: ['tongkeun', 'boss', 'hodadak', 'hodadak'], normal: 7 };
    good.recent = [summary(1), { matchId: 'x' }, null, summary(2, { myScore: -50, layoutId: 'moon' as never }), summary(3, { ticks: Number.NaN })];
    good.funnel = { counts: { resultsShown: 2.7, rematchPress: -1, bogus: 4 }, playDays: 'many', lastPlayDay: '2026/10/07', milestones: { firstWin: 5, 'bad key!': 1 } };
    good.globalRecords = { biggestHaul: Infinity, fastestFirstRecovery: -3, biggestSplash: 40 };
    good.challenges = { counters: { ok: 3, '': 9, nope: 'x' }, completed: ['ok', 'ok', 5] };
    good.onboarding = { done: ['starterCup', 'practice', 'flying'], dismissed: 'yes' };
    good.lastQuick = { layout: 'tutorial', mode: '3v3', difficulty: 'insane', rival: 'boss', items: 'all', events: 0 };
    good.seenItems = ['soap', 'laser', 'hammer', 'soap'];
    good.itemSightings = { plunger: 4.5, laser: 2, hammer: -1 };
    good.seenLayouts = ['counter', 'moon', 'plaza'];
    good.lastSeenVersion = '<script>';
    good.lastEventKind = 'meteor';
    good.cosmetics = { ...(good.cosmetics as object), vanPaints: ['a', 'a', 7, 'b'], vanPaint: 'zzz', victoryPose: 'tongkeunFlex' };
    good.recordedMatchIds = ['a', 7, '', 'b'];
    const d = sanitizeSaveData(good, defaults());
    expect(d.stats.wins).toBe(5);
    expect(d.records.plaza.hodadak).toEqual({ bestScore: 1800, bestMargin: 300 });
    expect(d.records.shortcut).toEqual({});
    expect(d.rivals).toEqual({ hodadak: {}, tongkeun: {}, nunchi: {} });
    expect(d.cups).toEqual({ novice: ['hodadak', 'tongkeun'], normal: [], challenge: [] });
    // Rivals cleared in a cup count as beaten (hat + taunt).
    expect(d.tournament.beaten).toEqual(['hodadak', 'tongkeun']);
    expect(d.cosmetics.unlockedEmotes).toEqual(['hodadakZoom', 'tongkeunFlex']);
    expect(d.cosmetics.victoryPose).toBe('tongkeunFlex');
    expect(d.recent.map((r) => r.matchId)).toEqual([summary(1).matchId, summary(3).matchId]);
    expect(d.recent[1]!.ticks).toBe(0);
    expect(d.funnel.counts).toMatchObject({ resultsShown: 2, rematchPress: 0 });
    expect(d.funnel.counts).not.toHaveProperty('bogus');
    expect(d.funnel).toMatchObject({ playDays: 0, lastPlayDay: null, milestones: { firstWin: 5 } });
    expect(d.globalRecords).toEqual({ biggestHaul: 0, fastestFirstRecovery: null, biggestSplash: 40, biggestDeposit: 0 });
    expect(d.challenges).toEqual({ counters: { ok: 3 }, completed: ['ok'] });
    expect(d.onboarding).toEqual({ done: ['practice', 'starterCup'], dismissed: false });
    expect(d.lastQuick).toEqual({ layout: 'random', mode: '1v1', difficulty: 'normal', rival: 'random', items: 'on', events: 'on' });
    expect(d.seenItems).toEqual(['hammer', 'plunger', 'soap']);
    expect(d.itemSightings).toEqual({ plunger: 4 });
    expect(d.seenLayouts).toEqual(['plaza', 'counter']);
    expect(d.lastSeenVersion).toBeNull();
    expect(d.lastEventKind).toBeNull();
    expect(d.cosmetics).toMatchObject({ vanPaints: ['a', 'b'], vanPaint: null });
    expect(d.recordedMatchIds).toEqual(['a', 'b']);
    // JSON-safe: no NaN / Infinity anywhere.
    expect(JSON.stringify(d)).not.toMatch(/null,\s*"NaN"|Infinity|NaN/);
  });

  it('a victory pose the player does not own is dropped', () => {
    expect(sanitizeSaveData({ cosmetics: { victoryPose: 'nunchiShrug' } }).cosmetics.victoryPose).toBeNull();
    expect(sanitizeSaveData({ cosmetics: { victoryPose: 'fanCash' } }).cosmetics.victoryPose).toBe('fanCash');
  });

  it('keeps the ring buffers bounded', () => {
    const d = sanitizeSaveData({
      recent: Array.from({ length: 50 }, (_, i) => summary(i)),
      recordedMatchIds: Array.from({ length: 80 }, (_, i) => `m${i}`),
    });
    expect(d.recent).toHaveLength(RECENT_MAX);
    expect(d.recent[RECENT_MAX - 1]!.matchId).toBe(summary(49).matchId);
    expect(d.recordedMatchIds).toHaveLength(RECORDED_IDS_MAX);
    expect(d.recordedMatchIds.at(-1)).toBe('m79');
  });
});

describe('save v2: rival taunt unlock (WP9 bug fix)', () => {
  it('the rival -> taunt table is emotes.ts EMOTE_RIVAL inverted', () => {
    for (const r of RIVALS) expect(EMOTE_RIVAL[RIVAL_REWARD_EMOTE[r]]).toBe(r);
    expect(Object.keys(EMOTE_RIVAL).sort()).toEqual(Object.values(RIVAL_REWARD_EMOTE).sort());
  });

  it('a v1 save with beaten rivals but no taunts self-heals on load', () => {
    const d = sanitizeSaveData({ version: 1, tournament: { beaten: ['nunchi', 'tongkeun'] } });
    expect(d.cosmetics.unlockedEmotes).toEqual(['tongkeunFlex', 'nunchiShrug']);
    expect(d.cosmetics.unlocked).toEqual(expect.arrayContaining([RIVAL_REWARD_HAT.tongkeun, RIVAL_REWARD_HAT.nunchi]));
  });

  it('beating a rival through today\'s app path (beaten + unlockHat in one update) unlocks the taunt in-session', () => {
    const m = manager(new MemorySaveBackend());
    m.load();
    expect(m.data.cosmetics.unlockedEmotes).toBeUndefined();
    m.update((d) => {
      d.tournament = { beaten: ['hodadak'], series: null };
    });
    expect(m.data.cosmetics.unlockedEmotes).toEqual(['hodadakZoom']);
    expect(m.data.cosmetics.unlocked).toContain('hodadakBand');
    // Cup filing of a pre-cups ladder win happens at load only (never misfiles a WP7 write).
    expect(m.data.cups.normal).toEqual([]);
    m.flush();
    const m2 = manager(m.backend as MemorySaveBackend);
    m2.load();
    expect(m2.data.cups.normal).toEqual(['hodadak']);
    expect(m2.data.cosmetics.unlockedEmotes).toEqual(['hodadakZoom']);
    m.dispose();
    m2.dispose();
  });
});

describe('save v2: budget and locality', () => {
  it('stays <= 64 KB in the true worst case: 20 recent summaries and EVERY capped field full', () => {
    const id = (p: string, i: number): string => `${p}${String(i).padStart(3, '0')}`.padEnd(32, 'x');
    const deltas = Object.fromEntries(Array.from({ length: MAX_SUMMARY_CHALLENGES }, (_, i) => [id('c', i), 1000]));
    const done = Array.from({ length: MAX_SUMMARY_CHALLENGES }, (_, i) => id('c', i));
    const d = defaults();
    // v1 fields at their caps (tightened in v2 so this fits).
    const keyboard = d.settings.bindings.keyboard as Record<string, string[]>;
    MATCH_ACTIONS.forEach((a, ai) => {
      keyboard[a] = Array.from({ length: MAX_BINDINGS_PER_ACTION }, (_, k) => `K${ai}x${k}`.padEnd(32, 'y'));
    });
    d.tournament = {
      beaten: [...RIVALS],
      series: {
        rival: 'nunchi',
        wins: 1,
        losses: 1,
        draws: 999,
        gameIndex: 9999,
        layoutId: 'counter',
        cup: 'challenge',
        adaptation: {
          kind: 'ambushChoke',
          chokepointId: 'c'.repeat(64),
          lineKey: 'k'.repeat(MAX_ADAPT_LINE_KEY),
          lineParams: Object.fromEntries(Array.from({ length: MAX_ADAPT_PARAMS }, (_, i) => [`p${i}`.padEnd(MAX_ADAPT_PARAM_KEY, 'p'), 'v'.repeat(MAX_ADAPT_PARAM_VALUE)])),
        },
      },
    };
    d.cosmetics.unlocked = [...HAT_IDS];
    d.cosmetics.seen = [...HAT_IDS];
    d.cosmetics.unlockedEmotes = [...EMOTE_IDS];
    d.cosmetics.victoryPose = 'nunchiShrug';
    d.achievements = Array.from({ length: MAX_ACHIEVEMENTS }, (_, i) => `A${i}`.padEnd(64, 'X'));
    for (const k of Object.keys(d.stats) as Array<keyof SaveData['stats']>) d.stats[k] = 1e9;
    // v2 fields at their caps.
    d.recent = Array.from({ length: RECENT_MAX }, (_, i) =>
      summary(i, {
        matchId: 'm'.repeat(64 - String(i).length) + i,
        teamMode: '2v2',
        difficulty: 'challenge',
        cup: 'challenge',
        mode: 'tournament',
        outcome: 'draw',
        endReason: 'allRecovered',
        myScore: 1e9,
        theirScore: 1e9,
        ticks: 1e9,
        biggestHaul: 1e9,
        firstRecoveryTick: 1e9,
        maxDeficit: 1e9,
        finishedAt: 1e14,
        challengeDeltas: deltas,
        challengeCompleted: done,
        biggestSplash: 1e9,
        biggestDeposit: 1e9,
        eventKind: 'cashTruck',
      }),
    );
    d.challenges = {
      counters: Object.fromEntries(Array.from({ length: MAX_CHALLENGE_IDS }, (_, i) => [id('k', i), 1e9])),
      completed: Array.from({ length: MAX_CHALLENGE_IDS }, (_, i) => id('k', i)),
    };
    for (const k of FUNNEL_KEYS) d.funnel.counts[k] = 1e9;
    d.funnel.matchesThisSession = 1e9;
    d.funnel.playDays = 1e9;
    d.funnel.lastPlayDay = '2026-10-07';
    for (let i = 0; i < MAX_MILESTONES; i++) d.funnel.milestones[id('ms', i)] = 1e14;
    d.cosmetics.vanPaints = Array.from({ length: MAX_VAN_PAINTS }, (_, i) => id('v', i));
    d.cosmetics.vanPaint = d.cosmetics.vanPaints[0]!;
    d.recordedMatchIds = Array.from({ length: RECORDED_IDS_MAX }, (_, i) => 'r'.repeat(60) + String(i).padStart(4, '0'));
    for (const r of RIVALS) for (const k of RIVAL_RECORD_KEYS) d.rivals[r][k] = { wins: 1e9, losses: 1e9, draws: 1e9, streak: -1e9, lastScore: 1e9, bestMargin: 1e9 };
    for (const l of RECORD_LAYOUT_IDS) for (const r of RIVALS) d.records[l][r] = { bestScore: 1e9, bestMargin: 1e9 };
    d.globalRecords = { biggestHaul: 1e9, fastestFirstRecovery: 1e9, biggestSplash: 1e9, biggestDeposit: 1e9 };
    for (const c of CUP_IDS) d.cups[c] = [...RIVALS];
    d.onboarding = { done: [...ONBOARDING_STEPS], dismissed: true };
    d.lastQuick = { layout: 'shortcut', mode: '2v2', difficulty: 'challenge', rival: 'tongkeun', items: 'hammerOnly', events: 'off' };
    d.seenItems = [...SAVE_ITEM_KINDS];
    d.itemSightings = Object.fromEntries(SAVE_ITEM_KINDS.map((k) => [k, 999]));
    d.seenLayouts = [...SAVE_LAYOUT_IDS];
    d.lastSeenVersion = '9'.repeat(32);
    d.lastEventKind = 'goldSafe';

    // Feed MORE than every cap: the sanitizer must cut it back to the measured worst case.
    const over = JSON.parse(JSON.stringify(d)) as Record<string, any>;
    over.achievements = Array.from({ length: 300 }, (_, i) => `A${i}`.padEnd(64, 'X'));
    over.tournament.series.adaptation.lineParams = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`p${i}`.padEnd(MAX_ADAPT_PARAM_KEY, 'p'), 'v'.repeat(MAX_ADAPT_PARAM_VALUE)]));
    const clean = sanitizeSaveData(over, defaults());
    expect(clean.achievements).toHaveLength(MAX_ACHIEVEMENTS);
    expect(Object.keys(clean.tournament.series!.adaptation!.lineParams!)).toHaveLength(MAX_ADAPT_PARAMS);
    expect(clean.tournament.series!.adaptation!.lineKey).toHaveLength(MAX_ADAPT_LINE_KEY);
    // Every filled field survived at its cap (the case really is "everything full").
    expect(clean.recent).toHaveLength(RECENT_MAX);
    expect(clean.recent[0]!.challengeDeltas).toEqual(deltas);
    expect(Object.keys(clean.challenges.counters)).toHaveLength(MAX_CHALLENGE_IDS);
    expect(clean.challenges.completed).toHaveLength(MAX_CHALLENGE_IDS);
    expect(Object.keys(clean.funnel.milestones)).toHaveLength(MAX_MILESTONES);
    expect(clean.cosmetics.vanPaints).toHaveLength(MAX_VAN_PAINTS);
    expect(clean.recordedMatchIds).toHaveLength(RECORDED_IDS_MAX);
    expect(clean.cosmetics.unlockedEmotes).toEqual([...EMOTE_IDS]);
    expect(clean.settings.bindings.keyboard.grab).toHaveLength(MAX_BINDINGS_PER_ACTION);
    expect(clean.lastSeenVersion).toBe(d.lastSeenVersion);
    expect(clean.tournament.series!.adaptation!.chokepointId).toHaveLength(64);
    // Exactly what SaveManager.flush writes.
    const bytes = new TextEncoder().encode(JSON.stringify(clean, null, 2)).length;
    expect(bytes).toBeLessThanOrEqual(64 * 1024);
    // Typical 20-match save, for the report.
    const typical = defaults();
    typical.recent = Array.from({ length: RECENT_MAX }, (_, i) => summary(i, { challengeDeltas: { 'apprentice.smallSafes': 2 }, eventKind: 'moneyRain' }));
    const typicalBytes = new TextEncoder().encode(JSON.stringify(sanitizeSaveData(typical, defaults()), null, 2)).length;
    expect(typicalBytes).toBeLessThan(bytes);
    console.info(`[save v2 size] worst case ${bytes} B, typical 20-match save ${typicalBytes} B`);
  });

  it('never imports or calls a network API (save.ts, progress.ts)', () => {
    for (const f of ['save.ts', 'progress.ts']) {
      const src = readFileSync(resolve(__dirname, '../../src/platform', f), 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection|navigator\.connection|\bhttps?:\/\//);
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) expect(['../sim/types', '../sim/config', './bindings', './native', './settings', './save', './steam']).toContain(spec);
    }
  });

  it('layout / item / event lists cover the sim registries (C4b / C2 / C5 must extend the save with them)', () => {
    expect([...SAVE_LAYOUT_IDS].sort()).toEqual(Object.keys(LAYOUTS).sort());
    for (const id of MATCH_LAYOUT_IDS) expect(RECORD_LAYOUT_IDS).toContain(id);
    for (const k of Object.keys(ITEMS.specs ?? {})) expect(SAVE_ITEM_KINDS as readonly string[]).toContain(k);
    expect(SAVE_LOOT_EVENT_KINDS).toEqual(['moneyRain', 'goldSafe', 'cashTruck']);
  });
});
