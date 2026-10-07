/**
 * [F4] Content 2.0 extensions of the fun-round queries (content-plan §4.5 / §6 F4 delta):
 * `matchPointInfo` treats coin bags (주머니) as loads (`bagCharIds`), and `swingInfo` counts coins
 * (10-point steps). Handcrafted states (a classic 3200 fixture with bags written in, keeping the
 * conservation invariant) plus a real v2 deposit that decides a match.
 */
import { describe, expect, it } from 'vitest';
import { COINS } from '../../src/sim/config';
import { matchPointInfo, swingInfo } from '../../src/sim/queries';
import type { Simulation } from '../../src/sim/sim';
import type { Command, EntityId, LayoutDef, SimEvent, SimState, TeamId } from '../../src/sim/types';
import { cmd, fullLayout, makeSim, openLayout } from './fixtures/layouts';

/** Characters 1,2 = team 0; 3,4 = team 1. */
function baseState(): SimState {
  const sim = makeSim(fullLayout(), [0, 0, 1, 1]);
  return structuredClone(sim.state);
}

const outdoor = (st: SimState, kind: 'smallSafe' | 'largeSafe') => st.loot.filter((l) => l.kind === kind && l.homeBank === null);

/** Everything but `keep` recovered; remainingValue recomputed (loot + bags). */
function leaveOnly(st: SimState, keep: EntityId[]): void {
  for (const l of st.loot) {
    if (keep.includes(l.id)) continue;
    l.recovered = true;
    l.recoveredBy = 0;
    l.loadedIn = null;
    l.loadedSafes = [];
  }
  recount(st);
}

function recount(st: SimState): void {
  const loot = st.loot.filter((l) => !l.recovered).reduce((s, l) => s + l.baseValue + (l.innerValue ?? 0), 0);
  const bags = st.characters.reduce((s, c) => s + (c.bag ?? 0), 0);
  st.remainingValue = loot + bags;
}

/** Scores so that the invariant holds against the fixture's 3200. */
function setScores(st: SimState, a: number): void {
  st.scores = [a, st.totalValue - st.remainingValue - a];
  expect(st.scores[1]).toBeGreaterThanOrEqual(0);
  expect(st.scores[0] + st.scores[1] + st.remainingValue).toBe(st.totalValue);
}

/** Turn `value` of a loot shell into a bag (value-conserving). */
function moveToBag(st: SimState, lootId: EntityId, charId: EntityId, value: number): void {
  const l = st.loot.find((x) => x.id === lootId)!;
  l.baseValue -= value;
  l.estimatedValue -= value;
  const c = st.characters.find((x) => x.id === charId)!;
  c.bag = (c.bag ?? 0) + value;
}

function hold(st: SimState, lootId: EntityId, charIds: EntityId[]): void {
  const l = st.loot.find((x) => x.id === lootId)!;
  l.anchored = false;
  l.unanchorProgress = 1;
  l.grabbedBy = [...charIds];
}

describe('matchPointInfo: coin bags are loads (F4)', () => {
  it('a decisive bag on its own: no loot ids, the bag carrier as carrier and bagCharIds', () => {
    const st = baseState();
    const [s1] = outdoor(st, 'smallSafe');
    const [l1] = outdoor(st, 'largeSafe');
    leaveOnly(st, [s1!.id, l1!.id]); // 400 left
    moveToBag(st, l1!.id, 3, 120); // team 1 carries 120 in a bag; large safe now worth 180
    recount(st);
    setScores(st, 1400); // 1400 : 1400, 400 left
    expect(matchPointInfo(st)).toBeNull(); // 120 does not decide (1520 vs 1400 + 280)
    setScores(st, 1100); // 1100 : 1700 — team 1 banks 120 -> 1820 > 1100 + 280
    expect(matchPointInfo(st)).toEqual({ team: 1, kind: 'win', value: 120, lootIds: [], carrierIds: [3], bagCharIds: [3] });
  });

  it("a bag that would level the score as the last value is kind 'tie' (never 'win')", () => {
    const st = baseState();
    const [s1] = outdoor(st, 'smallSafe');
    leaveOnly(st, [s1!.id]);
    moveToBag(st, s1!.id, 1, 100); // the whole last 100 is in character 1's bag (shell 0)
    st.loot.find((l) => l.id === s1!.id)!.recovered = true; // empty shell gone
    recount(st);
    expect(st.remainingValue).toBe(100);
    setScores(st, 1550); // 1550 : 1550 -> banking the last 100 wins
    expect(matchPointInfo(st)).toMatchObject({ team: 0, kind: 'win', value: 100, lootIds: [], bagCharIds: [1] });
    setScores(st, 1500); // 1500 : 1600 -> banking it levels the score: a draw
    expect(matchPointInfo(st)).toEqual({ team: 0, kind: 'tie', value: 100, lootIds: [], carrierIds: [1], bagCharIds: [1] });
  });

  it("a carrier's bag rides with the held load (value includes it) and can make a load decisive", () => {
    const st = baseState();
    const [s1] = outdoor(st, 'smallSafe');
    const [l1] = outdoor(st, 'largeSafe');
    leaveOnly(st, [s1!.id, l1!.id]); // 100 + 300
    moveToBag(st, l1!.id, 1, 150); // char 1 bag 150, large shell 150
    recount(st);
    setScores(st, 1400); // 1400 : 1400, 400 left
    hold(st, s1!.id, [1]);
    // 100 alone: 1500 vs 1400 + 300 no; bag alone 150: 1550 vs 1400 + 250 no; together 250: 1650 > 1400 + 150
    const mp = matchPointInfo(st)!;
    expect(mp).toEqual({ team: 0, kind: 'win', value: 250, lootIds: [s1!.id], carrierIds: [1], bagCharIds: [1] });
    // a teammate's bag elsewhere does not ride along
    const st2 = structuredClone(st);
    st2.characters.find((c) => c.id === 1)!.bag = 0;
    st2.characters.find((c) => c.id === 2)!.bag = 150;
    expect(matchPointInfo(st2)).toBeNull();
  });

  it('classic answers carry no bagCharIds key at all (old toEqual expectations hold)', () => {
    const st = baseState();
    const [s1] = outdoor(st, 'smallSafe');
    leaveOnly(st, [s1!.id]);
    setScores(st, 1600);
    hold(st, s1!.id, [1]);
    const mp = matchPointInfo(st)!;
    expect(mp).toMatchObject({ team: 0, kind: 'win', value: 100 });
    expect('bagCharIds' in mp).toBe(false);
  });

  it('largest load wins; a bag mid-deposit beats an equal held load (dwelling)', () => {
    const st = baseState();
    const [s1] = outdoor(st, 'smallSafe');
    const [l1] = outdoor(st, 'largeSafe');
    leaveOnly(st, [s1!.id, l1!.id]);
    moveToBag(st, l1!.id, 2, 100); // char 2 bag 100, large shell 200
    recount(st);
    setScores(st, 1900); // anything team 0 banks decides (1900 vs 900 + 400)
    hold(st, s1!.id, [1]);
    expect(matchPointInfo(st)).toMatchObject({ value: 100, lootIds: [s1!.id], carrierIds: [1] }); // lower id first
    st.characters.find((c) => c.id === 2)!.depositTicks = 10;
    expect(matchPointInfo(st)).toMatchObject({ value: 100, lootIds: [], carrierIds: [2], bagCharIds: [2] });
    hold(st, l1!.id, [1]);
    expect(matchPointInfo(st)).toMatchObject({ value: 200, lootIds: [l1!.id] });
  });
});

describe('matchPointInfo uprooting option (F4 HUD prompt, add-only)', () => {
  it('an anchored deciding load pulled by one team counts only with the option, and only when nothing in play decides', () => {
    const st = baseState();
    const [s1, s2] = outdoor(st, 'smallSafe');
    leaveOnly(st, [s1!.id, s2!.id]); // 200 left
    setScores(st, 1600); // 1600 : 1400 -> team 0 banking 100 wins (1700 > 1400 + 100)
    const a = st.loot.find((l) => l.id === s1!.id)!;
    expect(a.anchored).toBe(true);
    a.grabbedBy = [1];
    a.unanchorProgress = 0.4;
    expect(matchPointInfo(st)).toBeNull(); // the frozen default: anchored never counts
    const up = matchPointInfo(st, { uprooting: true })!;
    expect(up).toEqual({ team: 0, kind: 'win', value: 100, lootIds: [s1!.id], carrierIds: [1], uprooting: true });
    // contested (both teams pulling): nobody's
    a.grabbedBy = [1, 3];
    expect(matchPointInfo(st, { uprooting: true })).toBeNull();
    // nobody pulling: nothing
    a.grabbedBy = [];
    expect(matchPointInfo(st, { uprooting: true })).toBeNull();
    // a carried / dwelling deciding load outranks any uprooting one
    a.grabbedBy = [1];
    hold(st, s2!.id, [3]); // team 1 banking 100 -> 1500 vs 1600 + 0? not decisive
    expect(matchPointInfo(st, { uprooting: true })).toMatchObject({ uprooting: true, lootIds: [s1!.id] });
    hold(st, s2!.id, [2]);
    const carried = matchPointInfo(st, { uprooting: true })!;
    expect(carried).toEqual({ team: 0, kind: 'win', value: 100, lootIds: [s2!.id], carrierIds: [2] });
    expect('uprooting' in carried).toBe(false);
  });

  it("a non-deciding or 'tie' uprooting load is reported with the same end arithmetic", () => {
    const st = baseState();
    const [s1] = outdoor(st, 'smallSafe');
    leaveOnly(st, [s1!.id]); // the last 100
    setScores(st, 1500); // 1500 : 1600 -> team 0 banking it levels: a draw
    const a = st.loot.find((l) => l.id === s1!.id)!;
    a.grabbedBy = [2];
    expect(matchPointInfo(st, { uprooting: true })).toMatchObject({ team: 0, kind: 'tie', uprooting: true });
    a.grabbedBy = [4]; // team 1 banking it -> 1700 : 1500, the last value: a win
    expect(matchPointInfo(st, { uprooting: true })).toMatchObject({ team: 1, kind: 'win', uprooting: true });
  });
});

describe('swingInfo counts coins (F4)', () => {
  it('10-point steps once coins / bags are on the field; classic stays at 100', () => {
    const st = baseState();
    const [s1] = outdoor(st, 'smallSafe');
    const [l1] = outdoor(st, 'largeSafe');
    leaveOnly(st, [s1!.id, l1!.id]);
    setScores(st, 1400); // 1400 : 1400
    expect(swingInfo(st, 0)).toEqual({ toTie: 0, toLead: 100, remaining: 400 });
    moveToBag(st, l1!.id, 3, 30);
    recount(st);
    setScores(st, 1400); // still level; bag 30 -> step gcd(100, 270, 30) = 10
    expect(swingInfo(st, 0).toLead).toBe(10);
    setScores(st, 1370); // behind by 60
    expect(swingInfo(st, 0)).toMatchObject({ toTie: 60, toLead: 70 });
    // loose piles count too
    const st2 = baseState();
    leaveOnly(st2, [s1!.id]);
    st2.coins = [{ id: 10000, pos: { x: 1, y: 1 }, vel: { x: 0, y: 0 }, value: 50, noPickupCharId: null, noPickupUntil: 0 }];
    st2.loot.find((l) => l.id === s1!.id)!.baseValue = 50;
    st2.loot.find((l) => l.id === s1!.id)!.estimatedValue = 50;
    // level score, a 50 pile on the field: one coin ahead is enough
    expect(st2.scores[0]).toBe(st2.scores[1]);
    expect(swingInfo(st2, 0).toLead).toBe(COINS.coin);
  });
});

// ---------------------------------------------------------------------------------------------
// Real v2 sim: a deposit that decides the match is announced as a bag match point
// ---------------------------------------------------------------------------------------------

function v2Layout(): LayoutDef {
  const base = openLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 5 }, angle: 0 }] });
  return { ...base, v2: { safes: base.safes, props: [], breakables: [], gimmicks: [], itemPads: [], eventSpots: [{ x: 50, y: 30 }] } };
}

describe('matchPointInfo agrees with a real v2 deposit ending', () => {
  it("a 200 bag deposited against a 100 shell decides the match and was shown as the bag's match point", () => {
    const sim: Simulation = makeSim(v2Layout(), [0, 1] as TeamId[], { content: 'v2' });
    const safe = sim.state.loot[0]!;
    // value-conserving setup: 200 of the large safe moves into character 1's bag
    safe.baseValue -= 200;
    safe.estimatedValue -= 200;
    sim.getCharacter(1)!.bag = 200;
    expect(sim.state.scores[0] + sim.state.scores[1] + sim.state.remainingValue).toBe(sim.state.totalValue);
    sim.debug.teleport(1, { x: 10, y: 30 });
    const idle: Command[] = [cmd(), cmd()];
    let before = matchPointInfo(sim.state);
    const all: SimEvent[] = [];
    for (let t = 0; t < COINS.depositTicks + 5 && !sim.state.over; t++) {
      before = matchPointInfo(sim.state);
      expect(before).toMatchObject({ team: 0, kind: 'win', value: 200, lootIds: [], bagCharIds: [1] });
      all.push(...sim.step(idle));
    }
    expect(sim.state.result).toMatchObject({ reason: 'decided', winner: 0, scores: [200, 0] });
    expect(all.some((e) => e.type === 'coinsBanked')).toBe(true);
    expect(before).toMatchObject({ team: 0, kind: 'win', bagCharIds: [1] });
  });
});
