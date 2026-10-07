/**
 * Results "biggest event" (doc §12): only real events, ranked by value moved, lateness as the
 * tiebreak, text = i18n key + params from event data.
 */
import { describe, expect, it } from 'vitest';
import { pickBiggestEvent, resultCandidates, toResultEventView, type ResultsInput } from '../../src/game/results';
import { Simulation } from '../../src/sim';
import { getLayout } from '../../src/sim/layouts';
import { createBot } from '../../src/ai';
import type { SimEvent, TeamId } from '../../src/sim/types';
import { t, setLanguage } from '../../src/ui/i18n';

const MATCH = 14400;
// chars 1 (team 0), 2 (team 1); bank 3 with safes 4 (large), 5, 6 (small); outdoor 7 (small), 8 (large)
const characters = [
  { id: 1, team: 0 as TeamId },
  { id: 2, team: 1 as TeamId },
];
const loot = [
  { id: 3, kind: 'bank' as const, baseValue: 500, homeBank: null },
  { id: 4, kind: 'largeSafe' as const, baseValue: 300, homeBank: 3 },
  { id: 5, kind: 'smallSafe' as const, baseValue: 100, homeBank: 3 },
  { id: 6, kind: 'smallSafe' as const, baseValue: 100, homeBank: 3 },
  { id: 7, kind: 'smallSafe' as const, baseValue: 100, homeBank: null },
  { id: 8, kind: 'largeSafe' as const, baseValue: 300, homeBank: null },
];

function input(events: SimEvent[], rules = { matchTicks: MATCH, timeLimit: true }): ResultsInput {
  return { events, characters, loot, rules };
}

const rec = (tick: number, lootId: number, kind: 'smallSafe' | 'largeSafe' | 'bank', team: TeamId, value: number, safeIds: number[] = [], safesValue = 0, holders: number[] = []): SimEvent => ({
  type: 'recovered',
  tick,
  lootId,
  kind,
  team,
  value,
  safeIds,
  safesValue,
  holders,
});
const grab = (tick: number, charId: number, targetId: number, part: 'safe' | 'bankWall' = 'safe'): SimEvent => ({ type: 'grab', tick, charId, targetId, part });
const unload = (tick: number, safeId: number, byCharId: number | null, bankCarrierTeam: TeamId | null, bankValue = 700): SimEvent => ({
  type: 'safeUnloaded',
  tick,
  safeId,
  bankId: 3,
  bankValue,
  byCharId,
  bankCarrierTeam,
});

describe('pickBiggestEvent', () => {
  it('returns null for a match where nothing moved', () => {
    expect(pickBiggestEvent(input([{ type: 'matchStart', tick: 0 }]))).toBeNull();
    expect(toResultEventView(null)).toBeNull();
  });

  it('largest single recovery wins; bank shows the building + safes breakdown', () => {
    const ev = pickBiggestEvent(input([rec(1000, 7, 'smallSafe', 0, 100), rec(5000, 3, 'bank', 1, 1000, [4, 5, 6], 500), rec(6000, 8, 'largeSafe', 0, 300)]));
    expect(ev).toMatchObject({ type: 'recovery', key: 'event.bankWhole', params: { building: 500, safes: 500, total: 1000 }, team: 1, kind: 'bank', value: 1000 });
    setLanguage('ko');
    expect(t(ev!.key, ev!.params)).toBe('은행째 회수! 건물 500 + 금고 500 = +1,000');
  });

  it('an empty bank reads as the building only', () => {
    const ev = pickBiggestEvent(input([rec(5000, 3, 'bank', 0, 500, [], 0)]));
    expect(ev).toMatchObject({ key: 'event.bankEmpty', params: { building: 500 } });
  });

  it('a safe pulled out of a bank the OTHER team was hauling ("은행에서 큰 금고 300점이 빠짐")', () => {
    const ev = pickBiggestEvent(input([rec(1000, 7, 'smallSafe', 1, 100), unload(3000, 4, 1, 1)]));
    expect(ev).toMatchObject({ type: 'steal', key: 'event.largePulled', params: { value: 300 }, team: 0, kind: 'largeSafe', value: 300 });
    setLanguage('ko');
    expect(t(ev!.key, ev!.params)).toBe('은행에서 큰 금고 300점이 빠짐');
  });

  it('own-team unloads and unloads with nobody pulling are not steals', () => {
    expect(resultCandidates(input([unload(3000, 4, 1, 0), unload(3100, 5, null, 1), unload(3200, 6, 2, null)]))).toEqual([]);
  });

  it('a stolen big safe that is then recovered beats the pull itself (same value, later)', () => {
    const ev = pickBiggestEvent(input([unload(3000, 4, 1, 1), rec(3600, 4, 'largeSafe', 0, 300, [], 0, [1])]));
    expect(ev).toMatchObject({ type: 'recovery', key: 'event.stolenSafeRecovered', params: { value: 300 }, team: 0 });
  });

  it('last-seconds recoveries use the real seconds left on the clock', () => {
    const ev = pickBiggestEvent(input([rec(MATCH - 12 * 60, 7, 'smallSafe', 0, 100)]));
    expect(ev).toMatchObject({ type: 'lastSeconds', key: 'event.lastSecondsSmall', params: { sec: 12 } });
    setLanguage('ko');
    expect(t(ev!.key, ev!.params)).toBe('마지막 12초에 작은 금고 회수');
    expect(toResultEventView(ev)!.kind).toBe('time');
  });

  it('the scheduled end follows the final countdown (30 s after the second bank)', () => {
    const fc: SimEvent = { type: 'finalCountdown', tick: 6000, endTick: 6000 + 1800, previousEndTick: MATCH };
    const ev = pickBiggestEvent(input([fc, rec(6000 + 1800 - 5 * 60, 7, 'smallSafe', 0, 100)]));
    expect(ev).toMatchObject({ type: 'lastSeconds', params: { sec: 5 } });
    // well before the (moved) end: a plain recovery
    const ev2 = pickBiggestEvent(input([fc, rec(6100, 7, 'smallSafe', 0, 100)]));
    expect(ev2).toMatchObject({ type: 'recovery', key: 'event.smallRecovered' });
  });

  it('no last-seconds framing without a time limit (practice)', () => {
    const ev = pickBiggestEvent(input([rec(100, 7, 'smallSafe', 0, 100)], { matchTicks: MATCH, timeLimit: false }));
    expect(ev?.type).toBe('recovery');
  });

  it('ties on value go to the later event', () => {
    const ev = pickBiggestEvent(input([rec(1000, 8, 'largeSafe', 0, 300), rec(2000, 4, 'largeSafe', 1, 300)]));
    expect(ev).toMatchObject({ lootId: 4, team: 1, tick: 2000 });
  });

  it('a bank recovered by the team that took it from the other team reads as stolen', () => {
    const ev = pickBiggestEvent(input([grab(100, 2, 3, 'bankWall'), grab(900, 1, 3, 'bankWall'), rec(5000, 3, 'bank', 0, 800, [4, 5], 400, [1])]));
    expect(ev).toMatchObject({ key: 'event.bankStolen', params: { total: 800 }, team: 0 });
  });

  it('fence busts move no points: any real recovery or steal outranks them; alone they are the story', () => {
    const fence: SimEvent = { type: 'fenceBroken', tick: 2000, fenceId: 'f', bankId: 3, pos: { x: 1, y: 1 } };
    // Review regression (shortcut layout): a 1000-pt bank busting a fence must not hide a real
    // recovery, even a small one that happened earlier.
    const small = pickBiggestEvent(input([grab(100, 1, 3, 'bankWall'), rec(1500, 7, 'smallSafe', 1, 100), fence]));
    expect(small).toMatchObject({ type: 'recovery', key: 'event.smallRecovered', value: 100, team: 1 });
    const only = pickBiggestEvent(input([grab(100, 1, 3, 'bankWall'), fence]));
    expect(only).toMatchObject({ type: 'fence', key: 'event.fenceBroken', team: 0, value: 0, kind: 'fence' });
    setLanguage('ko');
    expect(t(only!.key, only!.params)).toBe('은행으로 펜스를 뚫어 지름길이 열림');
    const home = pickBiggestEvent(input([grab(100, 1, 3, 'bankWall'), fence, rec(4000, 3, 'bank', 0, 1000, [4, 5, 6], 500, [1])]));
    expect(home).toMatchObject({ type: 'recovery', key: 'event.fenceBankRecovered', params: { total: 1000 } });
  });

  it.each(['plaza', 'shortcut'] as const)('on a real bots-vs-bots match (%s) the pick is one of the logged events and its text resolves', (layoutId) => {
    setLanguage('ko');
    const layout = getLayout(layoutId);
    const sim = new Simulation({
      layout,
      seed: 11,
      roster: [
        { team: 0, isBot: true, name: 'a', look: { hat: 'teamCapA' } },
        { team: 1, isBot: true, name: 'b', look: { hat: 'teamCapB' } },
      ],
      rules: { matchTicks: 60 * 90 },
    });
    const bots = [createBot(sim, { slot: 0, personality: 'tongkeun', difficulty: 'challenge', seed: 1 }), createBot(sim, { slot: 1, personality: 'hodadak', difficulty: 'challenge', seed: 2 })];
    while (!sim.state.over) sim.step(bots.map((b) => b.update(sim)));
    const ev = pickBiggestEvent({ events: sim.eventLog, characters: sim.state.characters, loot: sim.state.loot, rules: sim.rules });
    const recs = sim.eventLog.filter((e) => e.type === 'recovered');
    if (recs.length) {
      expect(ev).not.toBeNull();
      const max = Math.max(...recs.map((r) => (r.type === 'recovered' ? r.value : 0)));
      expect(ev!.value).toBeGreaterThanOrEqual(max);
      expect(ev!.type).not.toBe('fence');
      expect(sim.eventLog.some((e) => e.tick === ev!.tick)).toBe(true);
      const text = t(ev!.key, ev!.params);
      expect(text).not.toMatch(/⟦|\{/);
    }
  }, 120000);
});
