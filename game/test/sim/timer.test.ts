/**
 * doc §8 최대 시간·마지막 회수·조기 종료 + the remaining rows of "정산의 경계 상황".
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, secondsToTicks } from '../../src/sim/config';
import type { Simulation } from '../../src/sim/sim';
import type { SimEvent, TeamId, Vec2 } from '../../src/sim/types';
import { cmd, fullLayout, makeSim, openLayout, ZONE0, ZONE1 } from './fixtures/layouts';

const R = DEFAULT_RULES.recoveryTicks;
const FINAL = DEFAULT_RULES.finalCountdownTicks;

function idle(sim: Simulation, n: number): SimEvent[] {
  const ev: SimEvent[] = [];
  const c = sim.state.characters.map(() => cmd());
  for (let i = 0; i < n && !sim.state.over; i++) {
    ev.push(...sim.step(c));
    const s = sim.state;
    expect(s.scores[0] + s.scores[1] + s.remainingValue).toBe(s.totalValue);
  }
  return ev;
}

/** Idle until state.tick === tick. */
function idleUntil(sim: Simulation, tick: number): void {
  idle(sim, tick - sim.state.tick);
  expect(sim.state.tick).toBe(tick);
}

function free(sim: Simulation, id: number, p: Vec2): void {
  sim.debug.setAnchored(id, false);
  sim.debug.teleport(id, p, 0);
}

// --- full 3200 layout helpers ------------------------------------------------

function full(rules = {}) {
  const sim = makeSim(fullLayout(), [0, 0, 1, 1], rules);
  expect(sim.state.totalValue).toBe(3200);
  const banks = sim.state.loot.filter((l) => l.kind === 'bank').map((l) => l.id);
  const outSmall = sim.state.loot.filter((l) => l.kind === 'smallSafe' && l.homeBank === null).map((l) => l.id);
  const outLarge = sim.state.loot.filter((l) => l.kind === 'largeSafe' && l.homeBank === null).map((l) => l.id);
  expect(outSmall.length).toBe(6);
  expect(outLarge.length).toBe(2);
  return { sim, banks, outSmall, outLarge };
}

/** Put a bank (with its contents) and safes into a team's zone so they all complete together. */
function placeInZone(sim: Simulation, team: TeamId, bankId: number | null, safes: number[]): void {
  const z = sim.layout.zones.find((zz) => zz.team === team)!;
  if (bankId !== null) free(sim, bankId, z.center);
  const slots: Vec2[] = [];
  for (const dy of [-4.25, 4.25]) for (let k = 0; k < 7; k++) slots.push({ x: z.center.x - 5.5 + k * 1.8, y: z.center.y + dy });
  safes.forEach((id, i) => free(sim, id, slots[i]!));
}

describe('doc §8 early decision rows', () => {
  it('row 9: leader 1600, other 1500, remaining 100 -> the match continues (a tie is still possible)', () => {
    const { sim, banks, outSmall, outLarge } = full();
    placeInZone(sim, 0, banks[0]!, [...outLarge]);
    placeInZone(sim, 1, banks[1]!, outSmall.slice(0, 5));
    idle(sim, R);
    expect(sim.state.scores).toEqual([1600, 1500]);
    expect(sim.state.remainingValue).toBe(100);
    expect(sim.state.over).toBe(false);
    expect(sim.state.result).toBeNull();
    idle(sim, 10);
    expect(sim.state.over).toBe(false);
  });

  it('row 10: leader 1700, other 1400, remaining 100 -> decided, leader wins', () => {
    const { sim, banks, outSmall, outLarge } = full();
    placeInZone(sim, 0, banks[0]!, [...outLarge, outSmall[0]!]);
    placeInZone(sim, 1, banks[1]!, outSmall.slice(1, 5));
    const ev = idle(sim, R);
    expect(sim.state.over).toBe(true);
    expect(sim.state.result).toEqual({ reason: 'decided', winner: 0, scores: [1700, 1400], endTick: R });
    expect(ev[ev.length - 1]).toMatchObject({ type: 'matchEnd', result: { reason: 'decided', winner: 0 } });
    expect(sim.step([cmd(), cmd(), cmd(), cmd()])).toEqual([]);
  });

  it('all loot recovered -> ends immediately with allRecovered', () => {
    const { sim, banks, outSmall, outLarge } = full();
    placeInZone(sim, 0, banks[0]!, [...outSmall.slice(0, 4), outLarge[0]!]);
    placeInZone(sim, 1, banks[1]!, [...outSmall.slice(4), outLarge[1]!]);
    idle(sim, R);
    expect(sim.state.remainingValue).toBe(0);
    expect(sim.state.result).toEqual({ reason: 'allRecovered', winner: 0, scores: [1700, 1500], endTick: R });
  });

  it('equal scores at the end are a draw (no tiebreak by last touch or first score)', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'smallSafe', pos: { x: 30, y: 52 }, angle: 0 }, { kind: 'smallSafe', pos: { x: 34, y: 52 }, angle: 0 }] }), [0, 1], {
      matchTicks: 400,
    });
    const [a, b] = sim.state.loot.map((l) => l.id);
    free(sim, a!, ZONE0.center);
    idle(sim, 120);
    free(sim, b!, ZONE1.center);
    idle(sim, 1000);
    expect(sim.state.result).toEqual({ reason: 'allRecovered', winner: null, scores: [100, 100], endTick: 120 + R });
  });

  it('early decision can be disabled', () => {
    const { sim, banks, outSmall, outLarge } = full({ earlyDecision: false, matchTicks: 600 });
    placeInZone(sim, 0, banks[0]!, [...outLarge, outSmall[0]!]);
    placeInZone(sim, 1, banks[1]!, outSmall.slice(1, 5));
    idle(sim, R + 5);
    expect(sim.state.over).toBe(false);
  });
});

describe('doc §8 timer rows', () => {
  /** Two banks; team 0 recovers bank 1, team 1 recovers bank 2 (scores stay level: no early end). */
  function twoBanks(rules = {}) {
    const sim = makeSim(
      openLayout({
        banks: [
          { pos: { x: 40, y: 15 }, angle: 0 },
          { pos: { x: 60, y: 45 }, angle: 0 },
        ],
        safes: [
          { kind: 'smallSafe', pos: { x: 30, y: 52 }, angle: 0 },
          { kind: 'smallSafe', pos: { x: 34, y: 52 }, angle: 0 },
          { kind: 'largeSafe', pos: { x: 70, y: 10 }, angle: 0 },
        ],
      }),
      [0, 1],
      rules,
    );
    const [b1, b2] = sim.state.loot.filter((l) => l.kind === 'bank').map((l) => l.id) as [number, number];
    const outdoor = sim.state.loot.filter((l) => l.kind !== 'bank' && l.homeBank === null).map((l) => l.id);
    return { sim, b1, b2, outdoor };
  }

  /** Make `bankId` complete exactly at tick `at` for `team`. */
  function completeBankAt(sim: Simulation, bankId: number, team: TeamId, at: number): SimEvent[] {
    idleUntil(sim, at - R);
    free(sim, bankId, team === 0 ? ZONE0.center : ZONE1.center);
    const ev = idle(sim, R);
    expect(sim.getLoot(bankId)!.recoveredTick).toBe(at);
    return ev;
  }

  it('row 11: second bank with 90 s left -> 30 s left', () => {
    const { sim, b1, b2 } = twoBanks();
    expect(sim.state.endTick).toBe(secondsToTicks(240));
    completeBankAt(sim, b1, 0, 200);
    expect(sim.state.endTick).toBe(secondsToTicks(240));
    const at = secondsToTicks(240) - secondsToTicks(90);
    const ev = completeBankAt(sim, b2, 1, at);
    expect(ev.find((e) => e.type === 'finalCountdown')).toEqual({
      type: 'finalCountdown',
      tick: at,
      endTick: at + FINAL,
      previousEndTick: secondsToTicks(240),
    });
    expect(sim.state.finalCountdown).toBe(true);
    expect(sim.state.finalCountdownTick).toBe(at);
    expect(sim.state.endTick - sim.state.tick).toBe(secondsToTicks(30));
    expect(sim.ticksLeft()).toBe(secondsToTicks(30));
    idle(sim, FINAL + 10);
    expect(sim.state.result).toMatchObject({ reason: 'time', endTick: at + FINAL, winner: null, scores: [1000, 1000] });
  });

  it('row 12: second bank with 12 s left -> stays 12 s', () => {
    const { sim, b1, b2 } = twoBanks();
    completeBankAt(sim, b1, 0, 300);
    const at = secondsToTicks(240) - secondsToTicks(12);
    const ev = completeBankAt(sim, b2, 1, at);
    expect(ev.find((e) => e.type === 'finalCountdown')).toMatchObject({ endTick: secondsToTicks(240), previousEndTick: secondsToTicks(240) });
    expect(sim.state.endTick).toBe(secondsToTicks(240));
    expect(sim.state.endTick - sim.state.tick).toBe(secondsToTicks(12));
  });

  it('row 13: only one bank recovered (the other is being carried) -> original end time', () => {
    const { sim, b1, b2 } = twoBanks({ matchTicks: 1200 });
    completeBankAt(sim, b1, 0, 300);
    expect(sim.state.banksRecovered).toBe(1);
    sim.debug.setAnchored(b2, false);
    sim.debug.setVelocity(b2, { x: -0.5, y: 0 });
    const ev = idle(sim, 2000);
    expect(ev.some((e) => e.type === 'finalCountdown')).toBe(false);
    expect(sim.state.finalCountdown).toBe(false);
    expect(sim.state.result).toMatchObject({ reason: 'time', endTick: 1200 });
  });

  it('row 14: recoveries after the second bank add points but never extend the end', () => {
    const { sim, b1, b2, outdoor } = twoBanks();
    completeBankAt(sim, b1, 0, 200);
    completeBankAt(sim, b2, 1, 400);
    const end = sim.state.endTick;
    expect(end).toBe(400 + FINAL);
    free(sim, outdoor[0]!, ZONE0.center);
    idle(sim, R);
    free(sim, outdoor[2]!, ZONE1.center);
    idle(sim, R);
    expect(sim.state.scores).toEqual([1100, 1300]);
    expect(sim.state.endTick).toBe(end);
    expect(sim.eventLog.filter((e) => e.type === 'finalCountdown').length).toBe(1);
  });

  it('a recovery completing exactly on endTick counts; one tick later does not', () => {
    const { sim, outdoor } = twoBanks({ matchTicks: 600, earlyDecision: false });
    idleUntil(sim, 600 - R);
    free(sim, outdoor[0]!, ZONE0.center);
    idle(sim, 1);
    free(sim, outdoor[1]!, ZONE1.center); // would complete at 601
    idle(sim, 1000);
    expect(sim.state.result).toEqual({ reason: 'time', winner: 0, scores: [100, 0], endTick: 600 });
    expect(sim.getLoot(outdoor[0]!)!.recoveredTick).toBe(600);
    expect(sim.getLoot(outdoor[1]!)!.recovered).toBe(false);
    expect(sim.state.tick).toBe(600);
  });

  it('simultaneous recoveries by both teams are both counted before the end check', () => {
    const { sim, outdoor } = twoBanks({ matchTicks: 600, earlyDecision: false });
    idleUntil(sim, 600 - R);
    free(sim, outdoor[0]!, ZONE0.center);
    free(sim, outdoor[2]!, ZONE1.center);
    const ev = idle(sim, R);
    expect(ev.filter((e) => e.type === 'recovered').length).toBe(2);
    const endIdx = ev.findIndex((e) => e.type === 'matchEnd');
    expect(endIdx).toBe(ev.length - 1);
    expect(sim.state.result).toEqual({ reason: 'time', winner: 1, scores: [100, 300], endTick: 600 });
  });

  it('simultaneous completions are settled together before early decision', () => {
    const { sim, banks, outSmall, outLarge } = full();
    placeInZone(sim, 0, banks[0]!, [...outLarge]); // 1600 vs 0, remaining 1600 -> continue
    idle(sim, R);
    expect(sim.state.over).toBe(false);
    placeInZone(sim, 0, null, [outSmall[0]!]); // alone this would decide 1700 > 0 + 1500
    placeInZone(sim, 1, banks[1]!, []); // ...but team 1's bank completes the same tick
    idle(sim, R);
    expect(sim.state.result).toMatchObject({ reason: 'decided', winner: 0, scores: [1700, 1000] });
  });

  it('timeLimit=false: endTick is Infinity, no time end, no countdown', () => {
    const { sim, b1, b2 } = twoBanks({ timeLimit: false, earlyDecision: false });
    expect(sim.state.endTick).toBe(Infinity);
    free(sim, b1, ZONE0.center);
    free(sim, b2, ZONE1.center);
    idle(sim, R + 2000);
    expect(sim.state.banksRecovered).toBe(2);
    expect(sim.state.endTick).toBe(Infinity);
    expect(sim.state.over).toBe(false);
    expect(sim.ticksLeft()).toBe(Infinity);
  });

  it('matchStart is the first event; tick counts start at 1', () => {
    const { sim } = twoBanks();
    const ev = sim.step([cmd(), cmd()]);
    expect(ev[0]).toEqual({ type: 'matchStart', tick: 0 });
    expect(sim.state.tick).toBe(1);
    expect(sim.step([cmd(), cmd()]).some((e) => e.type === 'matchStart')).toBe(false);
  });
});
