/**
 * Fun round contract (WP4): matchPointInfo / swingInfo in src/sim/queries.ts.
 * Handcrafted states (cloned from a real 3200 fixture, then edited) plus real settlements and
 * bot matches checking the query agrees with the sim's own end check.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../../src/sim/config';
import { matchPointInfo, swingInfo } from '../../src/sim/queries';
import type { Simulation } from '../../src/sim/sim';
import type { EntityId, SimState, TeamId, Vec2 } from '../../src/sim/types';
import { cmd, fullLayout, makeSim, openLayout, ZONE0, ZONE1 } from './fixtures/layouts';
import { makeMatch, stepMatch } from '../ai/helpers';

/** Characters 1,2 = team 0; 3,4 = team 1. */
function baseState(): SimState {
  const sim = makeSim(fullLayout(), [0, 0, 1, 1]);
  expect(sim.state.totalValue).toBe(3200);
  return structuredClone(sim.state);
}

const banks = (st: SimState) => st.loot.filter((l) => l.kind === 'bank');
const outdoor = (st: SimState, kind: 'smallSafe' | 'largeSafe') => st.loot.filter((l) => l.kind === kind && l.homeBank === null);
const interior = (st: SimState, bankId: EntityId) => st.loot.filter((l) => l.homeBank === bankId);

function recover(st: SimState, ids: EntityId[], team: TeamId = 0): void {
  for (const id of ids) {
    const l = st.loot.find((x) => x.id === id)!;
    l.recovered = true;
    l.recoveredBy = team;
    l.loadedIn = null;
    l.loadedSafes = [];
  }
  st.remainingValue = st.loot.filter((l) => !l.recovered).reduce((s, l) => s + l.baseValue, 0);
}

function hold(st: SimState, lootId: EntityId, charIds: EntityId[]): void {
  const l = st.loot.find((x) => x.id === lootId)!;
  l.anchored = false;
  l.unanchorProgress = 1;
  l.grabbedBy = [...charIds];
}

function setScores(st: SimState, a: number, b: number): void {
  st.scores = [a, b];
  expect(a + b + st.remainingValue).toBe(st.totalValue); // the 3200 invariant
}

describe('matchPointInfo (handcrafted states)', () => {
  it('null at kickoff (nothing in play) and once the match is over', () => {
    const st = baseState();
    expect(matchPointInfo(st)).toBeNull();
    const [b1] = banks(st);
    hold(st, b1!.id, [1]);
    st.over = true;
    expect(matchPointInfo(st)).toBeNull();
  });

  it('2:2 shared haul: two teammates hauling the decisive bank -> win for them, both carriers, bank + loaded safes', () => {
    const st = baseState();
    const [b1, b2] = banks(st);
    recover(st, [b2!.id, ...interior(st, b2!.id).map((l) => l.id), ...outdoor(st, 'smallSafe').map((l) => l.id)]);
    setScores(st, 1000, 600); // remaining 1600 = bank1 (1000) + 2 outdoor large
    const b1v = st.loot.find((l) => l.id === b1!.id)!;
    expect(b1v.estimatedValue).toBe(1000);
    hold(st, b1!.id, [2, 1, 3]); // team 0 shares the haul, one opponent hangs on
    const mp = matchPointInfo(st)!;
    expect(mp).toEqual({
      team: 0,
      kind: 'win',
      value: 1000,
      lootIds: [b1!.id, ...[...b1v.loadedSafes].sort((a, b) => a - b)],
      carrierIds: [1, 2],
    });
    expect(mp.lootIds.length).toBe(4);
    // the same haul with the scores swapped is match point for the opponent hanging on
    setScores(st, 600, 1000);
    expect(matchPointInfo(st)).toMatchObject({ team: 1, kind: 'win', value: 1000, carrierIds: [3] });
    // a 300 safe is not decisive here (1300 vs 600 with 1300 left)
    hold(st, b1!.id, []);
    setScores(st, 1000, 600);
    hold(st, outdoor(st, 'largeSafe')[0]!.id, [1]);
    expect(matchPointInfo(st)).toBeNull();
  });

  it('only the opponent carrying the load -> no match point for anyone when it would not decide', () => {
    const st = baseState();
    const [b1, b2] = banks(st);
    recover(st, [b2!.id, ...interior(st, b2!.id).map((l) => l.id), ...outdoor(st, 'smallSafe').map((l) => l.id)]);
    setScores(st, 1000, 600);
    hold(st, b1!.id, [3, 4]); // 1000 vs 1600 with 600 left: not decided
    expect(matchPointInfo(st)).toBeNull();
  });

  it('anchored loot being strained and safes loaded in a bank never count on their own', () => {
    const st = baseState();
    const [b1, b2] = banks(st);
    recover(st, [b2!.id, ...interior(st, b2!.id).map((l) => l.id), ...outdoor(st, 'smallSafe').map((l) => l.id)]);
    setScores(st, 1000, 600);
    const bank = st.loot.find((l) => l.id === b1!.id)!;
    bank.grabbedBy = [1, 2]; // still anchored: straining, not carried
    expect(bank.anchored).toBe(true);
    expect(matchPointInfo(st)).toBeNull();
    const large = interior(st, b1!.id).find((l) => l.kind === 'largeSafe')!;
    expect(large.loadedIn).toBe(b1!.id);
    hold(st, large.id, [1]);
    expect(matchPointInfo(st)).toBeNull();
  });

  it("tie: the last 100 that levels the score is kind 'tie', never 'win'", () => {
    const st = baseState();
    const last = outdoor(st, 'smallSafe')[0]!;
    recover(st, st.loot.filter((l) => l.id !== last.id).map((l) => l.id));
    setScores(st, 1500, 1600);
    hold(st, last.id, [1]);
    expect(matchPointInfo(st)).toEqual({ team: 0, kind: 'tie', value: 100, lootIds: [last.id], carrierIds: [1] });
    // the leader carrying it instead wins
    hold(st, last.id, [3]);
    expect(matchPointInfo(st)).toMatchObject({ team: 1, kind: 'win', value: 100, carrierIds: [3] });
    // contested by both: the win outranks the tie
    hold(st, last.id, [1, 3]);
    expect(matchPointInfo(st)).toMatchObject({ team: 1, kind: 'win', carrierIds: [3] });
    // ties survive earlyDecision = false (they come from the all-recovered rule)
    hold(st, last.id, [1]);
    expect(matchPointInfo(st, { earlyDecision: false })).toMatchObject({ kind: 'tie', team: 0 });
  });

  it('all recovered: the last bank dwelling in the trailing team’s zone wins it for them (no carriers needed)', () => {
    const st = baseState();
    const [b1] = banks(st);
    const keep = new Set([b1!.id, ...interior(st, b1!.id).map((l) => l.id)]);
    recover(st, st.loot.filter((l) => !keep.has(l.id)).map((l) => l.id));
    setScores(st, 1200, 1000);
    expect(st.remainingValue).toBe(1000);
    const bank = st.loot.find((l) => l.id === b1!.id)!;
    bank.anchored = false;
    bank.recovery = { team: 1, ticks: 40 };
    expect(matchPointInfo(st)).toMatchObject({ team: 1, kind: 'win', value: 1000, carrierIds: [] });
    expect(matchPointInfo(st, { earlyDecision: false })).toMatchObject({ team: 1, kind: 'win' });
  });

  it('a load held by one team while it dwells in the other team’s zone is the dwelling team’s match point', () => {
    // seen in a real 2:2 match: the last small safe, held by team 0, recovered by team 1 -> draw
    const st = baseState();
    const last = outdoor(st, 'smallSafe')[0]!;
    recover(st, st.loot.filter((l) => l.id !== last.id).map((l) => l.id));
    setScores(st, 1600, 1500);
    hold(st, last.id, [1]);
    expect(matchPointInfo(st)).toMatchObject({ team: 0, kind: 'win', carrierIds: [1] });
    st.loot.find((l) => l.id === last.id)!.recovery = { team: 1, ticks: 30 };
    expect(matchPointInfo(st)).toMatchObject({ team: 1, kind: 'tie', value: 100, carrierIds: [] });
  });

  it('earlyDecision = false: an early-decision load is not a match point', () => {
    const st = baseState();
    const [b1, b2] = banks(st);
    recover(st, [b2!.id, ...interior(st, b2!.id).map((l) => l.id), ...outdoor(st, 'smallSafe').map((l) => l.id)]);
    setScores(st, 1000, 600);
    hold(st, b1!.id, [1]);
    expect(matchPointInfo(st)).not.toBeNull();
    expect(matchPointInfo(st, { earlyDecision: false })).toBeNull();
  });

  it('picks the single largest decisive load', () => {
    const st = baseState();
    const [b1, b2] = banks(st);
    recover(st, [b2!.id, ...interior(st, b2!.id).map((l) => l.id), ...outdoor(st, 'smallSafe').map((l) => l.id)]);
    setScores(st, 1600, 0); // remaining 1600: anything team 0 recovers decides
    const large = outdoor(st, 'largeSafe')[0]!;
    hold(st, large.id, [1]);
    expect(matchPointInfo(st)).toMatchObject({ value: 300, lootIds: [large.id] });
    hold(st, b1!.id, [2]);
    expect(matchPointInfo(st)).toMatchObject({ value: 1000, lootIds: expect.arrayContaining([b1!.id]), carrierIds: [2] });
  });
});

describe('swingInfo', () => {
  it('toTie / toLead / remaining', () => {
    const st = baseState();
    recover(st, outdoor(st, 'smallSafe').map((l) => l.id).concat(outdoor(st, 'largeSafe').map((l) => l.id)));
    setScores(st, 400, 800);
    expect(swingInfo(st, 0)).toEqual({ toTie: 400, toLead: 500, remaining: 2000 });
    expect(swingInfo(st, 1)).toEqual({ toTie: 0, toLead: 0, remaining: 2000 });
    setScores(st, 600, 600);
    expect(swingInfo(st, 0)).toEqual({ toTie: 0, toLead: 100, remaining: 2000 });
    expect(swingInfo(st, 1)).toEqual({ toTie: 0, toLead: 100, remaining: 2000 });
  });
});

// ---------------------------------------------------------------------------------------------
// Agreement with the real end check
// ---------------------------------------------------------------------------------------------

const R = DEFAULT_RULES.recoveryTicks;

function place(sim: Simulation, id: EntityId, p: Vec2): void {
  sim.debug.setAnchored(id, false);
  sim.debug.teleport(id, p, 0);
}

/** Idle until the match ends; returns the matchPointInfo seen on the state right before the end. */
function idleToEnd(sim: Simulation, max: number) {
  let before = matchPointInfo(sim.state);
  for (let i = 0; i < max && !sim.state.over; i++) {
    before = matchPointInfo(sim.state);
    sim.step([cmd(), cmd()]);
  }
  return before;
}

describe('matchPointInfo agrees with the sim end check', () => {
  it("a real last-safe tie settles as a draw ('allRecovered'), shown as kind 'tie' during the whole dwell", () => {
    const sim = makeSim(
      openLayout({
        safes: [
          { kind: 'smallSafe', pos: { x: 40, y: 10 }, angle: 0 },
          { kind: 'smallSafe', pos: { x: 60, y: 10 }, angle: 0 },
        ],
      }),
      [0, 1],
    );
    const [s1, s2] = sim.state.loot.map((l) => l.id) as [number, number];
    place(sim, s1, ZONE0.center);
    for (let i = 0; i < R; i++) {
      expect(matchPointInfo(sim.state)).toBeNull(); // 100 with 100 left is not decisive
      sim.step([cmd(), cmd()]);
    }
    expect(sim.state.scores).toEqual([100, 0]);
    place(sim, s2, ZONE1.center);
    sim.step([cmd(), cmd()]);
    expect(matchPointInfo(sim.state)).toEqual({ team: 1, kind: 'tie', value: 100, lootIds: [s2], carrierIds: [] });
    const before = idleToEnd(sim, R + 5);
    expect(before).toMatchObject({ team: 1, kind: 'tie' });
    expect(sim.state.result).toMatchObject({ reason: 'allRecovered', winner: null, scores: [100, 100] });
  });

  it("a real early decision ('decided') is announced as kind 'win' for the winner", () => {
    const sim = makeSim(
      openLayout({
        safes: [
          { kind: 'largeSafe', pos: { x: 40, y: 10 }, angle: 0 },
          { kind: 'smallSafe', pos: { x: 60, y: 10 }, angle: 0 },
        ],
      }),
      [0, 1],
    );
    const large = sim.state.loot.find((l) => l.kind === 'largeSafe')!.id;
    place(sim, large, ZONE0.center);
    sim.step([cmd(), cmd()]);
    expect(matchPointInfo(sim.state)).toMatchObject({ team: 0, kind: 'win', value: 300 });
    idleToEnd(sim, R + 5);
    expect(sim.state.result).toMatchObject({ reason: 'decided', winner: 0, scores: [300, 0] });
  });

  it('2:2 bot matches: every decided / allRecovered ending shows match point for the winner on the tick before', () => {
    // seeds picked so the three ending kinds are covered: decided (shared bank haul), allRecovered win, allRecovered draw
    const cases = [
      { seed: 6, reason: 'decided' },
      { seed: 3, reason: 'allRecovered' },
      { seed: 7, reason: 'allRecovered' },
    ] as const;
    for (const c of cases) {
      const { sim, bots } = makeMatch(
        'counter',
        [
          { team: 0, bot: { personality: 'hodadak' } },
          { team: 0, bot: { personality: 'nunchi' } },
          { team: 1, bot: { personality: 'tongkeun' } },
          { team: 1, bot: { personality: 'hodadak' } },
        ],
        c.seed,
      );
      let before = matchPointInfo(sim.state);
      stepMatch(sim, bots, 15000, undefined, (s) => {
        if (!s.state.over) before = matchPointInfo(s.state);
        return false;
      });
      const res = sim.state.result!;
      // bot tuning may move these endings; the agreement below is what this test guards
      if (res.reason === 'time') continue;
      expect(before).not.toBeNull();
      if (res.winner === null) expect(before!.kind).toBe('tie');
      else expect(before).toMatchObject({ team: res.winner, kind: 'win' });
    }
  });
});
