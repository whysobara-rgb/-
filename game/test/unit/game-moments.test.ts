/**
 * MomentTracker (fun-plan WP5 / content-plan F5): one handcrafted event log per moment kind, the
 * purity / ordering contract, the bigPlay cap, and recorded bot matches (lead changes counted
 * exactly like the scorecard).
 */
import { describe, expect, it } from 'vitest';
import { createMatch, runMatch } from '../../src/ai/harness';
import type { BotIntent } from '../../src/ai/types';
import { KICKOFF_CUE_TICKS, MOMENT_KINDS, MOMENT_RULES, MomentTracker, kickoffTarget, type BotIntentSample, type Moment } from '../../src/game/moments';
import type { CharacterState, LootState, SimEvent, SimState, TeamId, Vec2 } from '../../src/sim/types';

// ---------------------------------------------------------------------------------------------
// minimal state builder (only the fields the tracker reads)
// ---------------------------------------------------------------------------------------------

function ch(id: number, team: TeamId, pos: Vec2, extra: Partial<CharacterState> = {}): CharacterState {
  return { id, team, pos: { ...pos }, grab: null, bag: 0, knockdownTicks: 0, dashTicks: 0, ...extra } as unknown as CharacterState;
}

function loot(id: number, kind: LootState['kind'], pos: Vec2, extra: Partial<LootState> = {}): LootState {
  const baseValue = kind === 'bank' ? 500 : kind === 'largeSafe' ? 300 : 100;
  return {
    id,
    kind,
    baseValue,
    pos: { ...pos },
    angle: 0,
    vel: { x: 0, y: 0 },
    angVel: 0,
    half: { x: 1, y: 1 },
    anchored: true,
    unanchorProgress: 0,
    recovered: false,
    recoveredBy: null,
    recoveredTick: null,
    grabbedBy: [],
    recovery: null,
    floorOf: null,
    loadedIn: null,
    homeBank: null,
    loadedSafes: [],
    estimatedValue: baseValue,
    lastHolder: null,
    ...extra,
  } as LootState;
}

function mkState(o: Partial<SimState> & { characters: CharacterState[] }): SimState {
  return {
    layoutId: 'plaza',
    tick: 1,
    endTick: 14400,
    over: false,
    result: null,
    scores: [0, 0],
    loot: [],
    fences: [],
    banksRecovered: 0,
    finalCountdown: false,
    finalCountdownTick: null,
    remainingValue: 3200,
    totalValue: 3200,
    pings: [],
    police: [],
    policeCars: [],
    coins: [],
    breakables: [],
    items: [],
    hazards: [],
    projectiles: [],
    gimmicks: [],
    matchEvents: [],
    eventPlan: null,
    ...o,
  } as unknown as SimState;
}

const kinds = (ms: readonly Moment[]): string[] => ms.map((m) => m.kind);
const tracker = (localCharId: number | null = 1, localTeam: TeamId = 0) => new MomentTracker({ localTeam, localCharId });

/** Two raccoons, one per team. */
const duo = (): CharacterState[] => [ch(1, 0, { x: 10, y: 10 }), ch(2, 1, { x: 20, y: 10 })];

const recovered = (tick: number, lootId: number, team: TeamId, value: number, kind: LootState['kind'] = 'smallSafe', holders: number[] = []): SimEvent => ({ type: 'recovered', tick, lootId, kind, team, value, safeIds: [], safesValue: 0, holders });

// ---------------------------------------------------------------------------------------------

describe('MomentTracker: one event log per moment kind', () => {
  it('leadTaken / equalized follow the strict leader (the first go-ahead is not a lead change)', () => {
    const tr = tracker();
    const L = [loot(3, 'smallSafe', { x: 0, y: 0 }), loot(4, 'largeSafe', { x: 5, y: 0 }), loot(5, 'smallSafe', { x: 9, y: 0 })];
    const step = (tick: number, scores: [number, number], ev: SimEvent[]) => tr.observe(mkState({ tick, characters: duo(), loot: L, scores }), ev, []);
    expect(kinds(step(1, [100, 0], [recovered(1, 3, 0, 100)]))).toEqual([]);
    const eq = step(2, [100, 100], [recovered(2, 5, 1, 100)]);
    expect(kinds(eq)).toEqual(['equalized']);
    expect(eq[0]).toMatchObject({ team: 1, value: 100, ids: [5], lootKind: 'smallSafe' });
    const lt = step(3, [100, 400], [recovered(3, 4, 1, 300, 'largeSafe')]);
    expect(kinds(lt)).toEqual(['leadTaken']);
    expect(lt[0]).toMatchObject({ team: 1, value: 300, ids: [4] });
    expect(tr.snapshot().leader).toBe(1);
    // a deposit (coinsBanked) flips it back: lead changes read the settled scores
    const dep = tr.observe(mkState({ tick: 4, characters: duo(), loot: L, scores: [450, 400] }), [{ type: 'coinsBanked', tick: 4, charId: 1, team: 0, value: 350 }], []);
    expect(kinds(dep)).toContain('leadTaken');
    expect(dep.find((m) => m.kind === 'leadTaken')).toMatchObject({ team: 0, ids: [] });
  });

  it('matchPointOn after a short hold; matchPointStopped only when an opponent brought the load down (2 s grace)', () => {
    const tr = tracker();
    const safe = (held: boolean) => loot(3, 'largeSafe', { x: 12, y: 10 }, { anchored: false, grabbedBy: held ? [1] : [] });
    const st = (tick: number, held: boolean) =>
      mkState({ tick, characters: [ch(1, 0, { x: 11, y: 10 }, held ? { grab: { targetId: 3 } as CharacterState['grab'] } : {}), ch(2, 1, { x: 20, y: 10 })], loot: [safe(held)], scores: [1000, 900], remainingValue: 300 });
    const all: Moment[] = [];
    let tick = 1;
    for (; tick <= MOMENT_RULES.mpOnTicks; tick++) all.push(...tr.observe(st(tick, true), [], []));
    expect(kinds(all)).toEqual(['matchPointOn']);
    expect(all[0]).toMatchObject({ team: 0, value: 300, ids: [3], lootKind: 'largeSafe' });
    expect(tr.snapshot().matchPoint).toMatchObject({ team: 0, kind: 'win' });
    expect(tr.snapshot().matchPointKind).toBe('largeSafe');
    // a brief release (re-grab inside the grace) continues the same episode silently
    for (let i = 0; i < 10; i++) all.push(...tr.observe(st(tick++, false), [], []));
    for (let i = 0; i < 5; i++) all.push(...tr.observe(st(tick++, true), [], []));
    expect(kinds(all)).toEqual(['matchPointOn']);
    // let go with nobody on the other team doing anything: the episode ends silently ("막았다!" would be a lie)
    for (let i = 0; i < MOMENT_RULES.mpStopTicks + 5; i++) all.push(...tr.observe(st(tick++, false), [], []));
    expect(kinds(all)).toEqual(['matchPointOn']);
    // ... and a police tackle is not the other team either
    for (let i = 0; i < 20; i++) all.push(...tr.observe(st(tick++, true), [], []));
    expect(kinds(all)).toEqual(['matchPointOn', 'matchPointOn']);
    all.push(...tr.observe(st(tick, false), [{ type: 'policeTackle', tick, officerId: 90, victimId: 1, hit: true }, { type: 'release', tick, charId: 1, targetId: 3, forced: true }], []));
    tick++;
    for (let i = 0; i < MOMENT_RULES.mpStopTicks + 5; i++) all.push(...tr.observe(st(tick++, false), [], []));
    expect(kinds(all)).toEqual(['matchPointOn', 'matchPointOn']);
    // an opposing knockdown on the carrier: stopped, credited to the dasher
    for (let i = 0; i < 20; i++) all.push(...tr.observe(st(tick++, true), [], []));
    all.push(...tr.observe(st(tick, false), [{ type: 'dashHit', tick, attackerId: 2, victimId: 1, knockdown: true }], []));
    tick++;
    for (let i = 0; i < MOMENT_RULES.mpStopTicks; i++) all.push(...tr.observe(st(tick++, false), [], []));
    expect(kinds(all)).toEqual(['matchPointOn', 'matchPointOn', 'matchPointOn', 'matchPointStopped']);
    expect(all[3]).toMatchObject({ team: 0, value: 300, ids: [3], lootKind: 'largeSafe', cause: 'hit', by: 2 });
    // an opponent grabbing the load also stops it
    for (let i = 0; i < 20; i++) all.push(...tr.observe(st(tick++, true), [], []));
    all.push(...tr.observe(st(tick, false), [{ type: 'grab', tick, charId: 2, targetId: 3, part: 'safe' }], []));
    tick++;
    for (let i = 0; i < MOMENT_RULES.mpStopTicks; i++) all.push(...tr.observe(st(tick++, false), [], []));
    expect(all[all.length - 1]).toMatchObject({ kind: 'matchPointStopped', team: 0, cause: 'grab', by: 2 });
    // the match ending with match point on is not a stop
    const tr2 = tracker();
    for (let t = 1; t <= 20; t++) tr2.observe(st(t, true), [], []);
    const end = mkState({ tick: 21, over: true, characters: duo(), loot: [{ ...safe(false), recovered: true }], scores: [1300, 900], remainingValue: 0 });
    expect(kinds(tr2.observe(end, [recovered(21, 3, 0, 300, 'largeSafe')], []))).not.toContain('matchPointStopped');
  });

  it('a decisive coin bag: matchPointOn names its carrier; knocking it loose is a stop, depositing it is not', () => {
    const st = (tick: number, bag: number, over = false) =>
      mkState({ tick, over, characters: [ch(1, 0, { x: 3, y: 4 }, { bag }), ch(2, 1, { x: 20, y: 10 })], scores: [1900, 1800], remainingValue: 300, totalValue: 4000 });
    const tr = tracker(2, 1);
    const all: Moment[] = [];
    let tick = 1;
    for (; tick <= 20; tick++) all.push(...tr.observe(st(tick, 200), [], []));
    expect(kinds(all)).toEqual(['matchPointOn']);
    expect(all[0]).toMatchObject({ team: 0, value: 200, ids: [], bagCharIds: [1], pos: { x: 3, y: 4 } });
    all.push(...tr.observe(st(tick, 0), [{ type: 'bagSpilled', tick, charId: 1, value: 200, byId: 2, cause: 'hammer' }], []));
    tick++;
    for (let i = 0; i < MOMENT_RULES.mpStopTicks + 60; i++) all.push(...tr.observe(st(tick++, 0), [], []));
    expect(kinds(all)).toEqual(['matchPointOn', 'coinSplash', 'matchPointStopped']);
    expect(all[2]).toMatchObject({ team: 0, value: 200, ids: [], bagCharIds: [1], cause: 'spill', by: 2, pos: { x: 3, y: 4 } });
    // deposited (the match goes on, e.g. not decisive after all): not a stop
    const tr2 = tracker(2, 1);
    const out: Moment[] = [];
    for (let t = 1; t <= 20; t++) out.push(...tr2.observe(st(t, 200), [], []));
    out.push(...tr2.observe(mkState({ tick: 21, characters: [ch(1, 0, { x: 3, y: 4 }), ch(2, 1, { x: 20, y: 10 })], scores: [2100, 1800], remainingValue: 100, totalValue: 4000 }), [{ type: 'coinsBanked', tick: 21, charId: 1, team: 0, value: 200 }], []));
    for (let t = 22; t < 22 + MOMENT_RULES.mpStopTicks + 10; t++) out.push(...tr2.observe(mkState({ tick: t, characters: [ch(1, 0, { x: 3, y: 4 }), ch(2, 1, { x: 20, y: 10 })], scores: [2100, 1800], remainingValue: 100, totalValue: 4000 }), [], []));
    expect(kinds(out)).not.toContain('matchPointStopped');
  });

  it('streakTier 1 at four unanswered recoveries, 2 at 31% of totalValue; streakBroken when answered; lapses after 25 s', () => {
    const tr = tracker();
    const L = [1, 2, 3, 4, 5, 6].map((i) => loot(10 + i, 'smallSafe', { x: i, y: 0 }));
    const out: Moment[] = [];
    let s0 = 0;
    const score = (tick: number, team: TeamId, lootId: number, v: number, s1 = 0) => {
      if (team === 0) s0 += v;
      out.push(...tr.observe(mkState({ tick, characters: duo(), loot: L, scores: [s0, s1] }), [recovered(tick, lootId, team, v)], []));
    };
    score(100, 0, 11, 100);
    score(200, 0, 12, 100);
    expect(tr.snapshot().run).toMatchObject({ team: 0, recoveries: 2, points: 200, tier: 0 });
    score(300, 0, 13, 100);
    expect(out.filter((m) => m.kind === 'streakTier')).toEqual([]);
    score(350, 0, 17, 100);
    expect(out.filter((m) => m.kind === 'streakTier')).toMatchObject([{ team: 0, tier: 1, value: 400 }]);
    score(400, 0, 14, 600); // 1000 >= 0.31 * 3200
    expect(out.filter((m) => m.kind === 'streakTier').map((m) => m.tier)).toEqual([1, 2]);
    expect(tr.snapshot().run).toMatchObject({ tier: 2, points: 1000, recoveries: 5 });
    // answered by the other team -> broken, the other team's run starts
    out.length = 0;
    out.push(...tr.observe(mkState({ tick: 500, characters: duo(), loot: L, scores: [s0, 100] }), [recovered(500, 15, 1, 100)], []));
    expect(out.filter((m) => m.kind === 'streakBroken')).toMatchObject([{ team: 0, value: 1000, ids: [15] }]);
    expect(tr.snapshot().run).toMatchObject({ team: 1, recoveries: 1, tier: 0 });
    // a run lapses silently after the 25 s gap
    tr.observe(mkState({ tick: 500 + MOMENT_RULES.runGapTicks + 1, characters: duo(), loot: L, scores: [s0, 100] }), [], []);
    out.length = 0;
    out.push(...tr.observe(mkState({ tick: 500 + MOMENT_RULES.runGapTicks + 2, characters: duo(), loot: L, scores: [s0 + 100, 100] }), [recovered(500 + MOMENT_RULES.runGapTicks + 2, 16, 0, 100)], []));
    expect(kinds(out)).not.toContain('streakBroken');
    expect(tr.snapshot().run).toMatchObject({ team: 0, recoveries: 1 });
  });

  it('streak tiers scale with totalValue (v2 4000: tier 2 at 1240); one big recovery is not a run; deposits >= 50 count, smaller ones do not answer', () => {
    const tr = tracker();
    const st = (tick: number, scores: [number, number]) => mkState({ tick, characters: duo(), scores, totalValue: 4000, remainingValue: 4000 - scores[0] - scores[1] });
    const out: Moment[] = [];
    out.push(...tr.observe(st(10, [1000, 0]), [{ type: 'coinsBanked', tick: 10, charId: 1, team: 0, value: 1000 }], []));
    expect(tr.snapshot().run).toMatchObject({ team: 0, recoveries: 1, points: 1000, tier: 0 }); // 25 %, but a single recovery
    out.push(...tr.observe(st(20, [1000, 30]), [{ type: 'coinsBanked', tick: 20, charId: 2, team: 1, value: 30 }], []));
    expect(kinds(out)).not.toContain('streakBroken');
    out.push(...tr.observe(st(30, [1240, 30]), [{ type: 'coinsBanked', tick: 30, charId: 1, team: 0, value: 240 }], []));
    expect(out.filter((m) => m.kind === 'streakTier').map((m) => m.tier)).toEqual([2]); // 1240 over two recoveries
  });

  it('bigPlay: a dash KO on a bank hauler (v/100 + 3), at most once per 10 s and 4 per match', () => {
    const tr = tracker();
    const bank = loot(3, 'bank', { x: 20, y: 12 }, { anchored: false, grabbedBy: [2], estimatedValue: 1100 });
    const hauling = (tick: number) => mkState({ tick, characters: [ch(1, 0, { x: 18, y: 10 }), ch(2, 1, { x: 20, y: 10 }, { grab: { targetId: 3 } as CharacterState['grab'] })], loot: [bank] });
    const ko = (tick: number): Moment[] => {
      tr.observe(hauling(tick - 1), [], []);
      return tr.observe(mkState({ tick, characters: duo(), loot: [{ ...bank, grabbedBy: [] }] }), [{ type: 'dashHit', tick, attackerId: 1, victimId: 2, knockdown: true }], []);
    };
    const first = ko(100);
    expect(kinds(first)).toEqual(['bigPlay']);
    expect(first[0]).toMatchObject({ team: 0, score: 14, value: 1100, ids: [1, 3], lootKind: 'bank' });
    expect(kinds(ko(100 + MOMENT_RULES.bigPlayCooldownTicks - 5))).toEqual([]); // cooldown
    let n = 1;
    for (let k = 2; k <= 6; k++) n += ko(100 + k * (MOMENT_RULES.bigPlayCooldownTicks + 10)).length;
    expect(n).toBe(MOMENT_RULES.bigPlayMax);
  });

  it('bigPlay: a stolen safe recovered for the lead in the last 15 s (steal rating carried + flip + late)', () => {
    const tr = tracker();
    const bank = loot(3, 'bank', { x: 20, y: 12 }, { anchored: false, grabbedBy: [2], loadedSafes: [] });
    const safe = loot(4, 'largeSafe', { x: 20, y: 12 }, { anchored: false, homeBank: 3 });
    tr.observe(mkState({ tick: 1, characters: duo(), loot: [bank, safe], scores: [600, 500] }), [], []);
    tr.observe(mkState({ tick: 2, characters: duo(), loot: [bank, safe], scores: [600, 700] }), [recovered(2, 99, 1, 200)], []); // team 1 leads
    const steal = tr.observe(mkState({ tick: 3, characters: duo(), loot: [bank, safe], scores: [600, 700] }), [{ type: 'safeUnloaded', tick: 3, safeId: 4, bankId: 3, bankValue: 500, byCharId: 1, bankCarrierTeam: 1 }], []);
    expect(kinds(steal)).toEqual([]); // 300/100 + 2 = 5 < 6
    const t = 14400 - 600;
    const rec = tr.observe(mkState({ tick: t, characters: duo(), loot: [bank, { ...safe, recovered: true }], scores: [900, 700] }), [recovered(t, 4, 0, 300, 'largeSafe', [1])], []);
    expect(kinds(rec)).toEqual(['leadTaken', 'bigPlay']);
    expect(rec[1]).toMatchObject({ team: 0, score: 300 / 200 + 5 + 3 + 4, ids: [1, 4] });
  });

  it('stealChance: an opposing bank haul that still holds safes, nearest open door <= 20 m (snapshot + one moment)', () => {
    const tr = new MomentTracker({ localTeam: 0, localCharId: 1, isFree: () => true });
    const bank = loot(3, 'bank', { x: 30, y: 10 }, { anchored: false, grabbedBy: [2], loadedSafes: [4, 5], estimatedValue: 900 });
    const L = [bank, loot(4, 'largeSafe', { x: 30, y: 10 }, { loadedIn: 3, homeBank: 3 }), loot(5, 'smallSafe', { x: 27, y: 10 }, { loadedIn: 3, homeBank: 3 })];
    const st = (tick: number, me: Vec2, l = L) => mkState({ tick, characters: [ch(1, 0, me), ch(2, 1, { x: 34.5, y: 10 }, { grab: { targetId: 3 } as CharacterState['grab'] })], loot: l });
    // far away: nothing
    expect(kinds(tr.observe(st(1, { x: 0, y: 40 }), [], []))).toEqual([]);
    expect(tr.snapshot().stealChance).toBeNull();
    // 8 m south of the bank: the back door (local -y) is the nearest
    const m = tr.observe(st(2, { x: 30, y: 2 }), [], []);
    expect(kinds(m)).toEqual(['stealChance']);
    expect(m[0]).toMatchObject({ team: 0, value: 300, ids: [3], lootKind: 'bank' });
    expect(tr.snapshot().stealChance).toMatchObject({ bankId: 3, value: 300 });
    expect(tr.snapshot().stealChance!.doorPos.y).toBeCloseTo(7.2, 6);
    // stays on without re-firing
    expect(kinds(tr.observe(st(3, { x: 30, y: 2 }), [], []))).toEqual([]);
    // the bank emptied -> closes
    tr.observe(st(4, { x: 30, y: 2 }, [{ ...bank, loadedSafes: [] }, L[1]!, L[2]!]), [], []);
    for (let t = 5; t < 30; t++) tr.observe(st(t, { x: 30, y: 2 }, [{ ...bank, loadedSafes: [] }, L[1]!, L[2]!]), [], []);
    expect(tr.snapshot().stealChance).toBeNull();
    // a door against a wall does not count (isFree)
    const walled = new MomentTracker({ localTeam: 0, localCharId: 1, isFree: (p) => p.y > 10 });
    walled.observe(st(1, { x: 30, y: 2 }), [], []);
    expect(walled.snapshot().stealChance!.doorPos.y).toBeCloseTo(12.8, 6);
    // our own haul never shows
    const ours = tracker(2, 1);
    ours.observe(st(1, { x: 30, y: 2 }), [], []);
    expect(ours.snapshot().stealChance).toBeNull();
  });

  it('tauntPunished: a taunt cancelled by an opposing dash hit', () => {
    const tr = tracker();
    const m = tr.observe(mkState({ characters: duo() }), [{ type: 'emoteCancel', tick: 1, charId: 2, emoteId: 'wiggle', cause: 'hit', hitBy: 1 }], []);
    expect(m).toMatchObject([{ kind: 'tauntPunished', team: 0, ids: [1, 2] }]);
    expect(kinds(tr.observe(mkState({ tick: 2, characters: duo() }), [{ type: 'emoteCancel', tick: 2, charId: 2, emoteId: 'wiggle', cause: 'hit', hitBy: null }], []))).toEqual([]);
  });

  it('dodged: a bot wind-up at the human that is cancelled / misses while the human sidesteps >= 1 m', () => {
    const intent = (phase: string): BotIntentSample[] => [{ charId: 2, intent: { goal: 'intercept', targetId: null, targetPos: null, telegraph: false, phase, windupTargetId: phase === 'windup' ? 1 : null } as BotIntent }];
    const st = (tick: number, meY: number, botDash = 0) => mkState({ tick, characters: [ch(1, 0, { x: 10, y: meY }), ch(2, 1, { x: 14, y: 10 }, { dashTicks: botDash })] });
    const tr = tracker();
    tr.observe(st(1, 10), [], intent('windup'));
    tr.observe(st(2, 10.5), [], intent('windup'));
    const out: Moment[] = [];
    out.push(...tr.observe(st(3, 11.4), [{ type: 'dash', tick: 3, charId: 2, carrying: false }], intent('dash')));
    for (let t = 4; t < 25; t++) out.push(...tr.observe(st(t, 11.4), [], intent('approach')));
    expect(out).toMatchObject([{ kind: 'dodged', team: 0, ids: [1, 2] }]);
    // hit -> no dodge
    const tr2 = tracker();
    tr2.observe(st(1, 10), [], intent('windup'));
    const out2: Moment[] = [];
    out2.push(...tr2.observe(st(2, 11.5), [{ type: 'dash', tick: 2, charId: 2, carrying: false }], intent('dash')));
    out2.push(...tr2.observe(st(3, 11.5), [{ type: 'dashHit', tick: 3, attackerId: 2, victimId: 1, knockdown: true }], intent('approach')));
    for (let t = 4; t < 25; t++) out2.push(...tr2.observe(st(t, 11.5), [], intent('approach')));
    expect(kinds(out2)).toEqual([]);
    // cancelled without moving -> nothing
    const tr3 = tracker();
    tr3.observe(st(1, 10), [], intent('windup'));
    expect(kinds(tr3.observe(st(2, 10.2), [], intent('approach')))).toEqual([]);
  });

  it('counterDash: a head-on clash (or a hammer clash) involving the human', () => {
    const tr = tracker();
    const clash = tr.observe(mkState({ characters: duo() }), [
      { type: 'dashHit', tick: 1, attackerId: 1, victimId: 2, knockdown: false },
      { type: 'dashHit', tick: 1, attackerId: 2, victimId: 1, knockdown: false },
    ], []);
    expect(clash).toMatchObject([{ kind: 'counterDash', team: 0, ids: [1, 2] }]);
    expect(kinds(tr.observe(mkState({ tick: 2, characters: duo() }), [{ type: 'dashHit', tick: 2, attackerId: 1, victimId: 2, knockdown: false }], []))).toEqual([]);
    expect(kinds(tr.observe(mkState({ tick: 3, characters: duo() }), [{ type: 'itemClash', tick: 3, aId: 2, bId: 1 }], []))).toEqual(['counterDash']);
  });

  it('coinSplash: a spill >= 60 caused by an opposing character', () => {
    const tr = tracker();
    const m = tr.observe(mkState({ characters: duo() }), [{ type: 'bagSpilled', tick: 1, charId: 2, value: 80, byId: 1, cause: 'hammer' }], []);
    expect(m).toMatchObject([{ kind: 'coinSplash', team: 0, value: 80, ids: [1, 2] }]);
    expect(kinds(tr.observe(mkState({ tick: 2, characters: duo() }), [{ type: 'bagSpilled', tick: 2, charId: 2, value: 50, byId: 1, cause: 'dash' }], []))).toEqual([]);
    expect(kinds(tr.observe(mkState({ tick: 3, characters: duo() }), [{ type: 'bagSpilled', tick: 3, charId: 2, value: 100, byId: 1001, cause: 'police' }], []))).toEqual([]);
  });

  it('jackpot: piggy smashed (also a bigPlay: 300/100 + 3) and the truck opened by a character', () => {
    const tr = tracker();
    const piggy = loot(7, 'largeSafe', { x: 15, y: 15 }, { variant: 'piggy', baseValue: 0, innerValue: 0 });
    const m = tr.observe(mkState({ characters: duo(), loot: [piggy] }), [
      { type: 'coinSpawn', tick: 1, ids: [10000, 10001], total: 300, pos: { x: 15, y: 15 }, source: 'smash', sourceId: 7, byCharId: 2 },
      { type: 'piggyCrack', tick: 1, lootId: 7, cracks: 3, smashed: true, byCharId: 2 },
    ], []);
    expect(kinds(m)).toEqual(['bigPlay', 'jackpot']);
    expect(m.find((x) => x.kind === 'jackpot')).toMatchObject({ team: 1, value: 300, ids: [2, 7] });
    const truck = tr.observe(mkState({ tick: 2000, characters: duo() }), [
      { type: 'itemHit', tick: 2000, charId: 1, kind: 'hammer', target: 'event', targetId: 'cashTruck', knockdown: false },
      { type: 'coinSpawn', tick: 2000, ids: [10002], total: 400, pos: { x: 40, y: 25 }, source: 'truck', sourceId: 'cashTruck', byCharId: null },
      { type: 'matchEvent', tick: 2000, kind: 'cashTruck', phase: 'open', pos: { x: 40, y: 25 } },
    ], []);
    expect(truck.find((x) => x.kind === 'jackpot')).toMatchObject({ team: 0, value: 400, ids: [1] });
  });

  it('hammerBonk (KO on a bag >= 100) and homeRun (victim on soap)', () => {
    const tr = tracker();
    tr.observe(mkState({ characters: [ch(1, 0, { x: 10, y: 10 }), ch(2, 1, { x: 11, y: 10 }, { bag: 120 })] }), [], []);
    const m = tr.observe(mkState({ tick: 2, characters: duo() }), [{ type: 'itemHit', tick: 2, charId: 1, kind: 'hammer', target: 'char', targetId: 2, knockdown: true, homeRun: true }], []);
    expect(kinds(m)).toEqual(['hammerBonk', 'homeRun']);
    expect(m[0]).toMatchObject({ team: 0, value: 120, ids: [1, 2] });
    // an empty-handed victim with a small bag is not a hammerBonk
    tr.observe(mkState({ tick: 3, characters: [ch(1, 0, { x: 10, y: 10 }), ch(2, 1, { x: 11, y: 10 }, { bag: 40 })] }), [], []);
    expect(kinds(tr.observe(mkState({ tick: 4, characters: duo() }), [{ type: 'itemHit', tick: 4, charId: 1, kind: 'hammer', target: 'char', targetId: 2, knockdown: true }], []))).toEqual([]);
  });

  it('hammer KO on a bank hauler is a bigPlay (v/100 + 3 + 4)', () => {
    const tr = tracker();
    const bank = loot(3, 'bank', { x: 20, y: 12 }, { anchored: false, grabbedBy: [2], estimatedValue: 500 });
    tr.observe(mkState({ characters: [ch(1, 0, { x: 18, y: 10 }), ch(2, 1, { x: 20, y: 10 }, { grab: { targetId: 3 } as CharacterState['grab'] })], loot: [bank] }), [], []);
    const m = tr.observe(mkState({ tick: 2, characters: duo(), loot: [bank] }), [{ type: 'itemHit', tick: 2, charId: 1, kind: 'goldHammer', target: 'char', targetId: 2, knockdown: true }], []);
    expect(m.find((x) => x.kind === 'bigPlay')).toMatchObject({ score: 12, ids: [1, 3] });
    expect(kinds(m)).toEqual(['bigPlay', 'hammerBonk']);
  });

  it('goldHammer: picked up', () => {
    const tr = tracker();
    expect(tr.observe(mkState({ characters: duo() }), [{ type: 'itemPickup', tick: 1, charId: 2, itemId: 2001, kind: 'goldHammer' }], [])).toMatchObject([{ kind: 'goldHammer', team: 1, ids: [2] }]);
    expect(kinds(tr.observe(mkState({ tick: 2, characters: duo() }), [{ type: 'itemPickup', tick: 2, charId: 2, itemId: 2002, kind: 'hammer' }], []))).toEqual([]);
  });

  it('tossScore: catapult-flown loot recovered within 6 s of landing (not after)', () => {
    const tr = tracker();
    const flying = loot(5, 'smallSafe', { x: 5, y: 5 }, { anchored: false, airborne: { fromTick: 40, toTick: 106, from: { x: 30, y: 5 }, to: { x: 6, y: 5 }, via: 'catapult' } });
    tr.observe(mkState({ tick: 50, characters: duo(), loot: [flying] }), [], []);
    const m = tr.observe(mkState({ tick: 106 + 300, characters: duo(), loot: [{ ...flying, airborne: null, recovered: true }], scores: [100, 0] }), [recovered(406, 5, 0, 100)], []);
    expect(kinds(m)).toEqual(['tossScore']);
    expect(m[0]).toMatchObject({ team: 0, value: 100, ids: [5] });
    const tr2 = tracker();
    tr2.observe(mkState({ tick: 50, characters: duo(), loot: [flying] }), [], []);
    expect(kinds(tr2.observe(mkState({ tick: 106 + MOMENT_RULES.tossScoreTicks + 1, characters: duo(), loot: [{ ...flying, airborne: null, recovered: true }], scores: [100, 0] }), [recovered(1, 5, 0, 100)], []))).toEqual([]);
  });

  it('craneDrop: the crane cat stunned while a bank hangs (also a bigPlay: v/100 + 4)', () => {
    const tr = tracker();
    const bank = loot(3, 'bank', { x: 38, y: 20 }, { anchored: false, estimatedValue: 800, airborne: { fromTick: 0, toTick: 400, from: { x: 30, y: 20 }, to: { x: 50, y: 20 }, via: 'crane' } });
    const crane = { id: 'crane', kind: 'crane', phase: 'busy', phaseTick: 0, nextTick: 0, pose: { x: 0, y: 0, angle: 0 }, busyWith: [3] };
    tr.observe(mkState({ tick: 100, characters: duo(), loot: [bank], gimmicks: [crane] as unknown as SimState['gimmicks'] }), [], []);
    const m = tr.observe(mkState({ tick: 101, characters: duo(), loot: [{ ...bank, airborne: null }], gimmicks: [{ ...crane, busyWith: [] }] as unknown as SimState['gimmicks'] }), [
      { type: 'itemHit', tick: 101, charId: 2, kind: 'hammer', target: 'gimmick', targetId: 'crane', knockdown: false },
      { type: 'gimmick', tick: 101, id: 'crane', what: 'catStunned', pos: { x: 38, y: 30 } },
    ], []);
    expect(kinds(m)).toEqual(['bigPlay', 'craneDrop']);
    expect(m.find((x) => x.kind === 'craneDrop')).toMatchObject({ team: 1, value: 800, ids: [2, 3] });
  });

  it('eventHaul: a team deposits >= 200 of money-rain coins (and a gold safe counts whole)', () => {
    const tr = tracker();
    const ids = [10010, 10011, 10012, 10013, 10014];
    tr.observe(mkState({ characters: duo() }), [{ type: 'coinSpawn', tick: 1, ids, total: 250, pos: { x: 40, y: 25 }, source: 'rain', sourceId: null, byCharId: null }], []);
    let bag = 0;
    for (const [i, id] of ids.slice(0, 4).entries()) {
      bag += 50;
      tr.observe(mkState({ tick: 2 + i, characters: [ch(1, 0, { x: 10, y: 10 }, { bag }), ch(2, 1, { x: 20, y: 10 })] }), [{ type: 'coinPickup', tick: 2 + i, charId: 1, coinId: id, value: 50, bag }], []);
    }
    const m = tr.observe(mkState({ tick: 10, characters: duo(), scores: [200, 0] }), [{ type: 'coinsBanked', tick: 10, charId: 1, team: 0, value: 200 }], []);
    expect(m.find((x) => x.kind === 'eventHaul')).toMatchObject({ team: 0, value: 200, ids: [] });
    const tr2 = tracker();
    const gold = loot(9, 'largeSafe', { x: 5, y: 5 }, { variant: 'goldSafe', baseValue: 400, estimatedValue: 400, recovered: true });
    const g = tr2.observe(mkState({ tick: 5, characters: duo(), loot: [gold], scores: [0, 400] }), [{ ...(recovered(5, 9, 1, 400, 'largeSafe') as Extract<SimEvent, { type: 'recovered' }>), variant: 'goldSafe' }], []);
    expect(g.find((x) => x.kind === 'eventHaul')).toMatchObject({ team: 1, value: 400, ids: [9] });
  });
});

describe('MomentTracker contract', () => {
  it('moments of one tick come in MOMENT_KINDS order; observe never mutates its inputs; deterministic', () => {
    const run = () => {
      const tr = tracker();
      const st = mkState({ characters: [ch(1, 0, { x: 10, y: 10 }), ch(2, 1, { x: 11, y: 10 }, { bag: 150 })] });
      tr.observe(st, [], []);
      const ev: SimEvent[] = [
        { type: 'itemPickup', tick: 2, charId: 2, itemId: 2001, kind: 'goldHammer' },
        { type: 'bagSpilled', tick: 2, charId: 2, value: 70, byId: 1, cause: 'hammer' },
        { type: 'itemHit', tick: 2, charId: 1, kind: 'hammer', target: 'char', targetId: 2, knockdown: true, homeRun: true },
      ];
      const st2 = mkState({ tick: 2, characters: duo() });
      const frozen = JSON.stringify([st2, ev]);
      const m = tr.observe(st2, ev, []);
      expect(JSON.stringify([st2, ev])).toBe(frozen);
      return m;
    };
    const a = run();
    expect(kinds(a)).toEqual(['coinSplash', 'hammerBonk', 'homeRun', 'goldHammer']);
    const order = a.map((m) => MOMENT_KINDS.indexOf(m.kind));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(run()).toEqual(a);
  });

  it('reset() forgets everything', () => {
    const tr = tracker();
    tr.observe(mkState({ characters: duo(), scores: [100, 0] }), [recovered(1, 3, 0, 100)], []);
    expect(tr.snapshot().run).not.toBeNull();
    tr.reset();
    expect(tr.snapshot()).toMatchObject({ tick: -1, run: null, leader: null, matchPoint: null, stealChance: null });
  });

  it('kickoff target: classic = nearest outdoor small safe still anchored; never a bank interior safe', () => {
    const me = ch(1, 0, { x: 0, y: 0 });
    const st = mkState({
      characters: [me, ch(2, 1, { x: 50, y: 0 })],
      loot: [loot(3, 'smallSafe', { x: 3, y: 0 }, { homeBank: 9 }), loot(4, 'smallSafe', { x: 8, y: 0 }), loot(5, 'largeSafe', { x: 4, y: 0 }), loot(6, 'smallSafe', { x: 6, y: 0 }, { anchored: false })],
    });
    expect(kickoffTarget(st, 1)).toMatchObject({ id: 4, kind: 'smallSafe' });
    // v2: crate or ATM (never a safe); lootOnly -> the ATM
    const v2 = mkState({
      characters: [me],
      loot: [loot(4, 'smallSafe', { x: 2, y: 0 }), loot(7, 'largeSafe', { x: 9, y: 0 }, { variant: 'atm' })],
      breakables: [{ id: 'crate:w1', kind: 'crate', center: { x: 6, y: 0 }, half: { x: 0.45, y: 0.45 }, angle: 0, hp: 1, innerValue: 20, broken: false }],
    });
    expect(kickoffTarget(v2, 1)).toMatchObject({ id: 'crate:w1', kind: 'crate' });
    expect(kickoffTarget(v2, 1, { lootOnly: true })).toMatchObject({ id: 7, kind: 'atm' });
    expect(KICKOFF_CUE_TICKS).toBe(300);
    // the real plaza v2 start: the cue (match.ts uses no lootOnly) sends each side to its nearest
    // starter, a crate when that is closer than the ATM (review: ATM 18.2 m vs crate 7.8 m)
    const { sim } = createMatch({ layout: 'plaza', team0: [{ personality: 'hodadak', difficulty: 'normal' }], team1: [{ personality: 'nunchi', difficulty: 'normal' }], seed: 1, rules: { content: 'v2' } });
    for (const c of sim.state.characters) {
      const k = kickoffTarget(sim.state, c.id)!;
      const atm = kickoffTarget(sim.state, c.id, { lootOnly: true })!;
      const d = (p: Vec2) => Math.hypot(p.x - c.pos.x, p.y - c.pos.y);
      expect(['crate', 'atm']).toContain(k.kind);
      expect(d(k.pos)).toBeLessThanOrEqual(d(atm.pos));
      expect(d(k.pos)).toBeLessThan(10);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// recorded bot matches
// ---------------------------------------------------------------------------------------------

describe('MomentTracker on recorded bot matches', () => {
  it('leadTaken + equalized match the scorecard lead changes / equalizers exactly; leader = score sign; moments are well-formed', () => {
    let matches = 0;
    let anyMoments = 0;
    for (const [layout, seed] of [
      ['plaza', 1],
      ['shortcut', 2],
      ['counter', 3],
      ['plaza', 4],
    ] as const) {
      const tr = new MomentTracker({ localTeam: 0, localCharId: 1 });
      const all: Moment[] = [];
      const timeline: [number, TeamId, number][] = [];
      runMatch({
        layout,
        seed,
        team0: [{ personality: 'hodadak', difficulty: 'normal', humanProxy: true }],
        team1: [{ personality: 'tongkeun', difficulty: 'normal' }],
        rules: { police: true },
        onTick: (sim, events, bots) => {
          const samples = bots.map((b) => ({ charId: sim.characterBySlot(b.slot).id, intent: b.intent() }));
          const m = tr.observe(sim.state, events, samples);
          for (const x of m) {
            expect(x.tick).toBe(sim.state.tick);
            expect(MOMENT_KINDS).toContain(x.kind);
            expect([0, 1]).toContain(x.team);
          }
          all.push(...m);
          for (const e of events) if (e.type === 'recovered') timeline.push([e.tick, e.team, e.value]);
          const [a, b] = sim.state.scores;
          expect(tr.snapshot().leader).toBe(a > b ? 0 : b > a ? 1 : null);
        },
      });
      // the scorecard's definition (scratchpad fun/metrics/agg.ts), from the recovery timeline
      const s = [0, 0];
      const states: number[] = [0];
      for (let i = 0; i < timeline.length; ) {
        const t = timeline[i]![0];
        while (i < timeline.length && timeline[i]![0] === t) {
          s[timeline[i]![1]]! += timeline[i]![2];
          i++;
        }
        states.push(s[0]! - s[1]!);
      }
      const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
      let lc = 0;
      let eq = 0;
      let last = 0;
      for (let i = 1; i < states.length; i++) {
        const g = sign(states[i]!);
        if (g === 0 && sign(states[i - 1]!) !== 0) eq++;
        if (g !== 0) {
          if (last !== 0 && g !== last) lc++;
          last = g;
        }
      }
      expect(all.filter((m) => m.kind === 'leadTaken').length).toBe(lc);
      expect(all.filter((m) => m.kind === 'equalized').length).toBe(eq);
      expect(all.filter((m) => m.kind === 'bigPlay').length).toBeLessThanOrEqual(MOMENT_RULES.bigPlayMax);
      anyMoments += all.length;
      matches++;
    }
    expect(matches).toBe(4);
    expect(anyMoments).toBeGreaterThan(0);
  });
});
