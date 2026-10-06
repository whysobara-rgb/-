/**
 * Police event (owner addition beyond doc v0.5): alarm + dispatch timing, rest / next wave,
 * getaway wave, target selection, tackles, dash stuns, shift end, fairness.
 * Police never change confirmed scores (doc §8) and treat both teams identically.
 */
import { describe, expect, it } from 'vitest';
import { DASH, POLICE, POLICE_CAR } from '../../src/sim/config';
import { LAYOUTS, MATCH_LAYOUT_IDS } from '../../src/sim/layouts/index';
import { officerStepOutSpot } from '../../src/sim/police';
import type { PoliceNav } from '../../src/sim/policeNav';
import { lineOfSight } from '../../src/sim/queries';
import { Simulation } from '../../src/sim/sim';
import type { Command, LayoutDef, PoliceOfficerState, SimEvent, Vec2 } from '../../src/sim/types';
import { cmd, lootIds, makeSetup, makeSim, openLayout } from './fixtures/layouts';

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(evs: SimEvent[], t: T): Ev<T>[] => evs.filter((e): e is Ev<T> => e.type === t);

const BANK_POS: Vec2 = { x: 50, y: 40 };

/** Open 100 x 60 arena with one bank on the axis and a few outdoor safes. */
function policeLayout(extra: Partial<Parameters<typeof openLayout>[0]> = {}): LayoutDef {
  return openLayout({
    banks: [{ pos: BANK_POS, angle: 0 }],
    safes: [
      { kind: 'smallSafe', pos: { x: 20, y: 10 }, angle: 0 },
      { kind: 'smallSafe', pos: { x: 80, y: 10 }, angle: 0 },
      { kind: 'largeSafe', pos: { x: 20, y: 20 }, angle: 0 },
      { kind: 'largeSafe', pos: { x: 80, y: 20 }, angle: 0 },
    ],
    ...extra,
  });
}

function policeSim(layout = policeLayout(), rules: Record<string, unknown> = {}): Simulation {
  return makeSim(layout, [0, 0, 1, 1], { police: true, ...rules });
}

const idle = (n = 4): Command[] => Array.from({ length: n }, () => cmd());

/** Step until `pred` holds (or `max` ticks); returns all events. */
function stepUntil(sim: Simulation, pred: (evs: SimEvent[]) => boolean, max: number, cmds: (t: number) => Command[] = () => idle()): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < max; t++) {
    const evs = sim.step(cmds(t));
    all.push(...evs);
    if (pred(evs) || sim.state.over) break;
  }
  return all;
}

/** Ring the bank alarm (state-based detection: debug unanchor counts like an uproot). */
function ringBank(sim: Simulation): number {
  const bank = lootIds(sim).banks[0]!;
  sim.debug.setAnchored(bank, false);
  return bank;
}

/** Ring the alarm and run until the first car has parked and officers stepped out. */
function officersOnField(sim: Simulation): PoliceOfficerState[] {
  ringBank(sim);
  stepUntil(sim, (evs) => evs.some((e) => e.type === 'policeArrived'), POLICE.dispatchDelayTicks + POLICE.arriveTicks + 10);
  expect(sim.state.police.length).toBe(POLICE.officersPerWave[0]);
  // wait until they have stepped out (perception starts after that)
  stepUntil(sim, () => sim.state.police.every((o) => o.phase !== 'arriving'), 120);
  return sim.state.police;
}

/**
 * Make each `slot` hold its safe at `pos` (safe freed and teleported, character placed west of
 * it facing it); all grabs land in the same tick, so the next perception sees every carrier.
 */
function makeCarriers(sim: Simulation, list: { slot: number; safe: number; pos: Vec2 }[], base: () => Command[] = idle): SimEvent[] {
  for (const { slot, safe, pos } of list) {
    sim.debug.setAnchored(safe, false);
    sim.debug.teleport(safe, pos, 0);
    const half = sim.getLoot(safe)!.half.x;
    sim.debug.teleport(slot + 1, { x: pos.x - half - 0.6, y: pos.y }, 0);
  }
  const c = base();
  for (const { slot } of list) c[slot] = cmd(0, 0, true, false, { x: 1, y: 0 });
  const evs = sim.step(c);
  for (const { slot, safe } of list) expect(sim.state.characters[slot]!.grab?.targetId).toBe(safe);
  return evs;
}

/** Steps (holding grab for `holders`) until the next perception tick has run. */
function untilPerceived(sim: Simulation, holders: number[], base: () => Command[] = idle): SimEvent[] {
  const out: SimEvent[] = [];
  do {
    const c = base();
    for (const s of holders) c[s] = cmd(0, 0, true);
    out.push(...sim.step(c));
  } while (sim.state.tick % 4 !== 0);
  return out;
}

describe('police: off by default', () => {
  it('rules.police defaults to false: no alarm, no cars, no officers', () => {
    const sim = makeSim(policeLayout());
    expect(sim.rules.police).toBe(false);
    ringBank(sim);
    const evs = stepUntil(sim, () => false, POLICE.dispatchDelayTicks + POLICE.arriveTicks + 60);
    expect(evs.filter((e) => e.type === 'alarm' || e.type.startsWith('police'))).toEqual([]);
    expect(sim.state.police).toEqual([]);
    expect(sim.state.policeCars).toEqual([]);
    expect(sim.state.alarm).toEqual({ ringing: [], dispatchTick: null, waves: 0 });
  });

  it('rejects a non-boolean police rule', () => {
    expect(() => makeSim(policeLayout(), [0, 1], { police: 1 as unknown as boolean })).toThrow(TypeError);
  });
});

describe('police: alarm and dispatch', () => {
  it('a real uproot rings the alarm, dispatches after the delay and parks after arriveTicks', () => {
    const sim = policeSim();
    const bank = lootIds(sim).banks[0]!;
    // slot 0 grabs the bank's east side wall and pulls east until it unanchors (3 s)
    sim.debug.teleport(1, { x: BANK_POS.x + 4 + 0.9, y: BANK_POS.y }, Math.PI);
    let uproot = -1;
    const evs = stepUntil(
      sim,
      (e) => e.some((x) => x.type === 'unanchored'),
      400,
      () => [cmd(1, 0, true, false, { x: -1, y: 0 }), cmd(), cmd(), cmd()],
    );
    const un = ofType(evs, 'unanchored');
    expect(un.length).toBe(1);
    uproot = un[0]!.tick;
    const alarm = ofType(evs, 'alarm');
    expect(alarm).toEqual([{ type: 'alarm', tick: uproot, bankId: bank, dispatchTick: uproot + POLICE.dispatchDelayTicks }]);
    expect(sim.state.alarm.ringing).toEqual([bank]);
    expect(sim.state.alarm.dispatchTick).toBe(uproot + POLICE.dispatchDelayTicks);

    const more = stepUntil(sim, (e) => e.some((x) => x.type === 'policeArrived'), POLICE.dispatchDelayTicks + POLICE.arriveTicks + 5);
    const disp = ofType(more, 'policeDispatched');
    expect(disp.length).toBe(1);
    expect(disp[0]!.tick).toBe(uproot + POLICE.dispatchDelayTicks);
    expect(disp[0]!.wave).toBe(1);
    expect(disp[0]!.entryIndex).toBe(0);
    expect(disp[0]!.officerIds.length).toBe(POLICE.officersPerWave[0]);
    const arr = ofType(more, 'policeArrived');
    expect(arr.length).toBe(1);
    expect(arr[0]!.tick).toBe(disp[0]!.tick + POLICE.arriveTicks);
    const entry = sim.policeEntries()[0]!;
    expect(arr[0]!.pos).toEqual(entry.park);
    expect(sim.state.alarm.waves).toBe(1);
    expect(sim.state.alarm.dispatchTick).toBeNull();
    // officers stepped out west and east of the on-axis car, mirror-symmetric
    const [a, b] = sim.state.police;
    expect(sim.state.police.map((o) => o.id)).toEqual(disp[0]!.officerIds);
    expect(a!.phase).toBe('arriving');
    expect(a!.pos.x).toBeLessThan(entry.park.x);
    expect(b!.pos.x).toBeGreaterThan(entry.park.x);
    expect(a!.pos.x + b!.pos.x).toBeCloseTo(2 * entry.park.x, 6);
    expect(a!.pos.y).toBeCloseTo(b!.pos.y, 6);
    const car = sim.state.policeCars[0]!;
    expect(car).toMatchObject({ phase: 'parked', sirenOn: true, wave: 1, entryIndex: 0 });
    // officer ids never collide with characters or loot
    for (const o of sim.state.police) {
      expect(sim.getCharacter(o.id)).toBeUndefined();
      expect(sim.getLoot(o.id)).toBeUndefined();
    }
  });

  it('the car drives in from entry.from: kinematic, never colliding', () => {
    const sim = policeSim();
    ringBank(sim);
    stepUntil(sim, (e) => e.some((x) => x.type === 'policeDispatched'), POLICE.dispatchDelayTicks + 5);
    const entry = sim.policeEntries()[0]!;
    const car = sim.state.policeCars[0]!;
    expect(car.phase).toBe('arriving');
    const ys: number[] = [car.pos.y];
    for (let t = 0; t < POLICE.arriveTicks - 1; t++) {
      sim.step(idle());
      ys.push(car.pos.y);
    }
    // monotonic approach from 'from' toward 'park' along the axis
    expect(ys[0]).toBeCloseTo(entry.from.y, 6);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!);
    expect(car.pos.x).toBeCloseTo(entry.park.x, 9);
    expect(sim.state.police.length).toBe(0); // officers step out only once parked
  });

  it('a second alarm during an active wave reports that wave and schedules nothing new', () => {
    const layout = policeLayout({ banks: [{ pos: BANK_POS, angle: 0 }, { pos: { x: 50, y: 18 }, angle: 0 }] });
    const sim = policeSim(layout);
    const [b0, b1] = lootIds(sim).banks;
    sim.debug.setAnchored(b0!, false);
    const first = stepUntil(sim, (e) => e.some((x) => x.type === 'policeDispatched'), POLICE.dispatchDelayTicks + 5);
    const dispatchTick = ofType(first, 'policeDispatched')[0]!.tick;
    sim.debug.setAnchored(b1!, false);
    const evs = stepUntil(sim, () => false, 30);
    const al = ofType(evs, 'alarm');
    expect(al.length).toBe(1);
    expect(al[0]!.bankId).toBe(b1);
    expect(al[0]!.dispatchTick).toBe(dispatchTick);
    expect(sim.state.alarm.ringing).toEqual([b0, b1]);
    expect(sim.state.alarm.dispatchTick).toBeNull();
  });

  it('shift end -> officers walk back -> car leaves -> gone; banks still ringing call the next wave after the rest', () => {
    const sim = policeSim();
    const bank = ringBank(sim);
    const evs = stepUntil(sim, (e) => e.some((x) => x.type === 'policeDispatched' && x.wave === 2), 9000);
    const arrived = ofType(evs, 'policeArrived')[0]!;
    const leaving = ofType(evs, 'policeLeaving');
    const gone = ofType(evs, 'policeGone');
    expect(leaving.length).toBe(1);
    expect(gone.length).toBe(1);
    // officers stay at least a full shift, then make it back to the car well before the timeout
    expect(leaving[0]!.tick - arrived.tick).toBeGreaterThanOrEqual(POLICE.shiftTicks);
    expect(leaving[0]!.tick - arrived.tick).toBeLessThan(POLICE.shiftTicks + 20 * 60);
    expect(gone[0]!.tick).toBe(leaving[0]!.tick + POLICE.arriveTicks);
    const second = ofType(evs, 'policeDispatched').find((e) => e.wave === 2)!;
    expect(second.tick).toBe(leaving[0]!.tick + POLICE.restTicks);
    expect(second.entryIndex).toBe(1); // alternates north / south
    expect(sim.state.alarm.ringing).toEqual([bank]);
    expect(sim.state.alarm.waves).toBe(2);
    // the first wave's officers were removed, the first car too
    expect(sim.state.police.length).toBe(0);
    expect(sim.state.policeCars.map((c) => c.wave)).toEqual([2]);
  });

  it('a recovered bank stops ringing and no further wave is called', () => {
    const sim = policeSim(policeLayout(), { earlyDecision: false });
    const bank = ringBank(sim);
    sim.step(idle());
    expect(sim.state.alarm.ringing).toEqual([bank]);
    // drop it in team 0's zone: recovered after the dwell (before the police even arrive)
    sim.debug.teleport(bank, { x: 10, y: 30 }, 0);
    const evs = stepUntil(sim, (e) => e.some((x) => x.type === 'recovered'), 200);
    expect(ofType(evs, 'recovered').length).toBe(1);
    expect(sim.state.alarm.ringing).toEqual([]);
    // the already scheduled first wave still comes, but after it leaves nothing more
    const rest = stepUntil(sim, (e) => e.some((x) => x.type === 'policeGone'), 9000);
    expect(ofType(rest, 'policeDispatched').length).toBe(1);
    const after = stepUntil(sim, () => false, POLICE.restTicks + POLICE.dispatchDelayTicks + 60);
    expect(ofType(after, 'policeDispatched')).toEqual([]);
    expect(sim.state.alarm.dispatchTick).toBeNull();
  });

  it('final countdown calls the getaway wave immediately when no officers are on the field', () => {
    const layout = policeLayout({ banks: [{ pos: BANK_POS, angle: 0 }, { pos: { x: 50, y: 18 }, angle: 0 }] });
    const sim = policeSim(layout);
    const [b0, b1] = lootIds(sim).banks;
    sim.debug.setAnchored(b0!, false);
    sim.debug.setAnchored(b1!, false);
    sim.step(idle());
    expect(sim.state.alarm.dispatchTick).toBe(1 + POLICE.dispatchDelayTicks);
    sim.debug.teleport(b0!, { x: 10, y: 30 }, 0);
    sim.debug.teleport(b1!, { x: 90, y: 30 }, 0);
    const evs = stepUntil(sim, (e) => e.some((x) => x.type === 'finalCountdown'), 300);
    const fc = ofType(evs, 'finalCountdown')[0]!;
    const disp = ofType(evs, 'policeDispatched');
    expect(disp.length).toBe(1);
    expect(disp[0]!.tick).toBe(fc.tick);
    expect(sim.state.alarm.dispatchTick).toBeNull();
    expect(sim.state.alarm.ringing).toEqual([]);
    // nothing else is dispatched during the countdown
    const rest = stepUntil(sim, () => false, POLICE.dispatchDelayTicks + 100);
    expect(ofType(rest, 'policeDispatched')).toEqual([]);
  });

  it('never dispatches after the match is over, and officers freeze at the end', () => {
    // the match ends (time) before the scheduled dispatch
    const sim = policeSim(policeLayout(), { matchTicks: 300 });
    ringBank(sim);
    stepUntil(sim, () => false, 400);
    expect(sim.state.over).toBe(true);
    expect(sim.eventLog.some((e) => e.type === 'policeDispatched')).toBe(false);
    expect(sim.state.policeCars).toEqual([]);
    expect(sim.step(idle())).toEqual([]);

    // officers on the field when time runs out stop moving
    const sim2 = policeSim(policeLayout(), { matchTicks: POLICE.dispatchDelayTicks + POLICE.arriveTicks + 200 });
    officersOnField(sim2);
    stepUntil(sim2, () => false, 400);
    expect(sim2.state.over).toBe(true);
    const snap = JSON.stringify(sim2.state.police);
    for (const o of sim2.state.police) expect(o.vel).toEqual({ x: 0, y: 0 });
    sim2.step(idle());
    expect(JSON.stringify(sim2.state.police)).toBe(snap);
  });
});

describe('police: target selection', () => {
  function carriersSetup(): { sim: Simulation; small: number[]; large: number[] } {
    const sim = policeSim();
    officersOnField(sim);
    const { small, large } = lootIds(sim);
    return { sim, small, large };
  }

  it('chases the highest held value first; two officers split over two carriers', () => {
    const { sim, small, large } = carriersSetup();
    const [o1, o2] = sim.state.police;
    // a small-safe carrier right in front of both officers, a large-safe carrier farther west
    const evs = makeCarriers(sim, [
      { slot: 0, safe: small[0]!, pos: { x: 50, y: 8 } },
      { slot: 2, safe: large[0]!, pos: { x: 40, y: 12 } },
    ]);
    evs.push(...untilPerceived(sim, [0, 2]));
    const spotted = ofType(evs, 'policeSpotted');
    expect(spotted.map((e) => [e.officerId, e.charId])).toEqual([
      [o1!.id, 3], // the 300 carrier goes first, to its nearest officer (although the 100 carrier is nearer to it)
      [o2!.id, 1], // its partner takes the other carrier
    ]);
    expect(o1!.targetCharId).toBe(3);
    expect(o2!.targetCharId).toBe(1);
    expect(o1!.phase).toBe('chase');

    // mirrored: the 300 carrier on the east goes to the east officer — never a crossing chase
    const m = carriersSetup();
    const [m1, m2] = m.sim.state.police;
    makeCarriers(m.sim, [
      { slot: 0, safe: m.small[0]!, pos: { x: 50, y: 8 } },
      { slot: 2, safe: m.large[1]!, pos: { x: 60, y: 12 } },
    ]);
    untilPerceived(m.sim, [0, 2]);
    expect(m1!.targetCharId).toBe(1);
    expect(m2!.targetCharId).toBe(3);
  });

  it('equal values: the nearer carrier wins; both officers chase the only carrier', () => {
    const { sim, small } = carriersSetup();
    const [o1, o2] = sim.state.police;
    const before = sim.state.characters.map((c) => ({ ...c.pos }));
    const evs = makeCarriers(sim, [
      { slot: 0, safe: small[0]!, pos: { x: 42, y: 12 } },
      { slot: 2, safe: small[1]!, pos: { x: 47, y: 8 } },
    ]);
    void before;
    // distances as seen at the perception tick (positions before that step)
    let at: Vec2[] = [];
    let o1pos: Vec2 = { ...o1!.pos };
    do {
      at = sim.state.characters.map((c) => ({ ...c.pos }));
      o1pos = { ...o1!.pos };
      evs.push(...sim.step([cmd(0, 0, true), cmd(), cmd(0, 0, true), cmd()]));
    } while (sim.state.tick % 4 !== 0);
    const d = (p: Vec2): number => Math.hypot(p.x - o1pos.x, p.y - o1pos.y);
    const nearer = d(at[0]!) < d(at[2]!) ? 1 : 3;
    const farther = nearer === 1 ? 3 : 1;
    expect(nearer).toBe(3);
    expect(ofType(evs, 'policeSpotted').map((e) => [e.officerId, e.charId])).toEqual([
      [o1!.id, nearer],
      [o2!.id, farther],
    ]);

    // only one carrier: both chase it
    const { sim: s2, small: sm2 } = carriersSetup();
    makeCarriers(s2, [{ slot: 2, safe: sm2[1]!, pos: { x: 50, y: 10 } }]);
    untilPerceived(s2, [2]);
    expect(s2.state.police.map((o) => o.targetCharId)).toEqual([3, 3]);
  });

  it('a bank-wall holder counts the bank estimate (500+) over a large safe', () => {
    const { sim, large } = carriersSetup();
    const [o1] = sim.state.police;
    const bank = lootIds(sim).banks[0]!;
    // move the (already free) bank near the officers and grab its side wall at the north end
    // (in plain view of the officers who hopped in at the north edge)
    sim.debug.teleport(bank, { x: 45, y: 16 }, 0);
    sim.debug.teleport(1, { x: 45 - 4 - 0.9, y: 13.4 }, 0);
    for (let t = 0; t < 10 && !sim.state.characters[0]!.grab; t++) sim.step([cmd(0, 0, true, false, { x: 1, y: 0 }), cmd(), cmd(), cmd()]);
    expect(sim.state.characters[0]!.grab?.part).toBe('bankWall');
    const evs = makeCarriers(sim, [{ slot: 2, safe: large[1]!, pos: { x: 55, y: 6 } }], () => [cmd(0, 0, true), cmd(), cmd(), cmd()]);
    evs.push(...untilPerceived(sim, [0, 2]));
    expect(ofType(evs, 'policeSpotted')[0]).toMatchObject({ officerId: o1!.id, charId: 1 });
    expect(o1!.targetCharId).toBe(1);
  });

  it('does not see carriers behind walls or beyond sight radius', () => {
    const wall = { id: 'wall', kind: 'building' as const, center: { x: 50, y: 12 }, half: { x: 12, y: 0.5 }, angle: 0, height: 6 };
    const sim = policeSim(policeLayout({ statics: [wall] }));
    officersOnField(sim);
    const { small } = lootIds(sim);
    const evs = makeCarriers(sim, [
      { slot: 0, safe: small[0]!, pos: { x: 50, y: 16 } }, // just behind the wall
      { slot: 2, safe: small[1]!, pos: { x: 92, y: 4 } }, // > 16 m away, in plain view
    ]);
    evs.push(...stepUntil(sim, () => false, 8, () => [cmd(0, 0, true), cmd(), cmd(0, 0, true), cmd()]));
    expect(ofType(evs, 'policeSpotted')).toEqual([]);
    expect(sim.state.police.every((o) => o.targetCharId === null)).toBe(true);
  });
});

describe('police: tackles', () => {
  it('tackling a carrier = an opposing dash hit: forced release, knockdown, protection, event', () => {
    const sim = policeSim();
    officersOnField(sim);
    const { small } = lootIds(sim);
    makeCarriers(sim, [{ slot: 0, safe: small[0]!, pos: { x: 50, y: 9 } }]);
    const scores = [...sim.state.scores];
    const prevGrab: (number | null)[] = [];
    const evs = stepUntil(
      sim,
      (e) => e.some((x) => x.type === 'policeTackle' && x.hit),
      600,
      () => {
        prevGrab.splice(0, 4, ...sim.state.characters.map((c) => c.grab?.targetId ?? null));
        return [cmd(-0.3, 0, true), cmd(), cmd(), cmd()]; // trudging away slowly with the safe
      },
    );
    const hit = ofType(evs, 'policeTackle').find((e) => e.hit)!;
    expect(hit).toBeDefined();
    expect(hit.victimId).toBe(1);
    const tickEvs = evs.filter((e) => e.tick === hit.tick);
    expect(tickEvs).toContainEqual({ type: 'release', tick: hit.tick, charId: 1, targetId: small[0], forced: true });
    const victim = sim.state.characters[0]!;
    expect(victim.grab).toBeNull();
    expect(victim.knockdownTicks).toBeGreaterThan(0);
    expect(victim.protectTicks).toBeGreaterThan(0);
    expect(Math.hypot(victim.vel.x, victim.vel.y)).toBeGreaterThan(2);
    const officer = sim.state.police.find((o) => o.id === hit.officerId)!;
    expect(officer.phase).toBe('tired');
    expect(officer.tiredTicks).toBeGreaterThan(0);
    // ownership / scores untouched
    expect(sim.state.scores).toEqual(scores);
    expect(sim.getLoot(small[0]!)!.recovered).toBe(false);
    // the grab latch: holding grab does not re-grab until it is released once
    sim.step([cmd(0, 0, true), cmd(), cmd(), cmd()]);
    expect(sim.state.characters[0]!.grab).toBeNull();
  });

  it('never tackles empty-handed characters (they only bump) — body-blocking is legal', () => {
    const sim = policeSim();
    const [o1] = officersOnField(sim);
    // stand right in front of the officers for 20 s, wiggling around them
    const evs = stepUntil(sim, () => false, 1200, (t) => {
      const target = sim.state.police[0]?.pos ?? o1!.pos;
      const me = sim.state.characters[0]!.pos;
      const dx = target.x - me.x;
      const dy = target.y - me.y;
      const l = Math.hypot(dx, dy) || 1;
      return [cmd(dx / l, dy / l), cmd(Math.sin(t / 20), 0), cmd(), cmd()];
    });
    expect(ofType(evs, 'policeTackle')).toEqual([]);
    expect(sim.state.characters.every((c) => c.knockdownTicks === 0)).toBe(true);
    expect(sim.state.police.every((o) => o.targetCharId === null)).toBe(true);
  });

  it('never tackles a protected carrier', () => {
    const sim = policeSim();
    officersOnField(sim);
    const { small } = lootIds(sim);
    makeCarriers(sim, [{ slot: 0, safe: small[0]!, pos: { x: 50, y: 9 } }]);
    let knocked = false;
    const evs = stepUntil(sim, () => false, 600, () => {
      sim.state.characters[0]!.protectTicks = 100; // test hook: keep the carrier protected
      if (sim.state.characters[0]!.knockdownTicks > 0) knocked = true;
      return [cmd(0, 0, true), cmd(), cmd(), cmd()];
    });
    // officers come close and stay on it, but never land (or even try) a tackle
    const minD = Math.min(...sim.state.police.map((o) => Math.hypot(o.pos.x - sim.state.characters[0]!.pos.x, o.pos.y - sim.state.characters[0]!.pos.y)));
    expect(minD).toBeLessThan(2);
    expect(ofType(evs, 'policeTackle').filter((e) => e.hit)).toEqual([]);
    expect(knocked).toBe(false);
    expect(sim.state.characters[0]!.grab).not.toBeNull();
  });
});

describe('police: raccoon dash stuns officers', () => {
  /** Put `slot` 1.4 m from the officer, aimed at it, and dash. */
  function dashInto(sim: Simulation, slot: number, officerId: number): SimEvent[] {
    const o = sim.state.police.find((q) => q.id === officerId)!;
    const from = { x: o.pos.x - 1.4, y: o.pos.y + 0.0 };
    sim.debug.teleport(slot + 1, from, 0);
    const out: SimEvent[] = [];
    for (let t = 0; t < 20; t++) {
      const c = idle();
      const me = sim.state.characters[slot]!.pos;
      c[slot] = cmd(0, 0, false, t < 3, { x: o.pos.x - me.x, y: o.pos.y - me.y });
      out.push(...sim.step(c));
    }
    return out;
  }

  it('stuns for POLICE.stunTicks, then 1 s of re-stun immunity', () => {
    const sim = policeSim();
    const [o1] = officersOnField(sim);
    const id = o1!.id;
    const e1 = dashInto(sim, 0, id);
    const st = ofType(e1, 'policeStunned');
    expect(st.length).toBe(1);
    expect(st[0]).toMatchObject({ officerId: id, byCharId: 1 });
    expect(ofType(e1, 'dash').length).toBe(1);
    const off = sim.state.police.find((q) => q.id === id)!;
    expect(off.phase).toBe('stunned');
    // stays down for stunTicks (counted from the hit)
    const left = off.stunTicks;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(POLICE.stunTicks);
    stepUntil(sim, () => off.phase !== 'stunned', POLICE.stunTicks + 5);
    expect(off.phase).not.toBe('stunned');
    // immediately dashed again by another raccoon: immune, only shoved
    const e2 = dashInto(sim, 1, id);
    expect(ofType(e2, 'policeStunned')).toEqual([]);
    expect(off.phase).not.toBe('stunned');
    // after the immunity a fresh dash knocks it over again
    stepUntil(sim, () => false, 70);
    const e3 = dashInto(sim, 2, id);
    expect(ofType(e3, 'policeStunned').length).toBe(1);
  });

  it('dashing away from an officer you touch does nothing (dash cone)', () => {
    const sim = policeSim();
    const [o1] = officersOnField(sim);
    const o = o1!;
    sim.debug.teleport(1, { x: o.pos.x - 0.9, y: o.pos.y }, Math.PI);
    const evs: SimEvent[] = [];
    for (let t = 0; t < 20; t++) evs.push(...sim.step([cmd(0, 0, false, t < 2, { x: -1, y: 0 }), cmd(), cmd(), cmd()]));
    expect(ofType(evs, 'policeStunned')).toEqual([]);
  });

  it('a dash into a lunging officer stuns it and the lunge misses (hit: false)', () => {
    let checked = 0;
    for (const y of [9, 10, 11]) {
      const sim = policeSim();
      officersOnField(sim);
      const { small } = lootIds(sim);
      makeCarriers(sim, [{ slot: 0, safe: small[0]!, pos: { x: 50, y } }]);
      stepUntil(sim, () => sim.state.police.some((o) => o.phase === 'tackle'), 600, () => [cmd(0, 0, true), cmd(), cmd(), cmd()]);
      const lunger = sim.state.police.find((o) => o.phase === 'tackle');
      if (!lunger) continue;
      // a teammate rams the lunging officer from the side
      const px = -Math.sin(lunger.facing);
      const py = Math.cos(lunger.facing);
      sim.debug.teleport(2, { x: lunger.pos.x + px * 0.9, y: lunger.pos.y + py * 0.9 }, 0);
      const evs = sim.step([cmd(0, 0, true), cmd(0, 0, false, true, { x: -px, y: -py }), cmd(), cmd()]);
      expect(ofType(evs, 'policeStunned')).toContainEqual({ type: 'policeStunned', tick: sim.state.tick, officerId: lunger.id, byCharId: 2 });
      expect(ofType(evs, 'policeTackle')).toContainEqual({ type: 'policeTackle', tick: sim.state.tick, officerId: lunger.id, victimId: 1, hit: false });
      expect(lunger.phase).toBe('stunned');
      expect(lunger.tackleTicks).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(DASH.speed).toBeGreaterThan(POLICE.tackleSpeed);
  });
});

describe('police: fairness (mirrored scenarios)', () => {
  /** Run a scenario; `mirror` swaps to the mirrored setup for team 1. */
  function run(mirror: boolean): { tackleTick: number; victim: number; trace: Vec2[][]; scores: [number, number] } {
    const sim = policeSim();
    officersOnField(sim);
    const { small } = lootIds(sim);
    const mx = (p: Vec2): Vec2 => (mirror ? { x: 100 - p.x, y: p.y } : p);
    const slot = mirror ? 2 : 0;
    const safe = mirror ? small[1]! : small[0]!;
    // carrier: safe east of the character (team 0) / west (team 1, mirrored)
    sim.debug.setAnchored(safe, false);
    sim.debug.teleport(safe, mx({ x: 41, y: 12 }), 0);
    sim.debug.teleport(slot + 1, mx({ x: 41 + 1.0, y: 12 }), mirror ? 0 : Math.PI);
    const c = (t: number): Command[] => {
      const out = idle();
      const dir = mirror ? 1 : -1; // walking toward the own zone, dragging the safe
      out[slot] = cmd(t < 5 ? 0 : dir * 0.9, 0, true, false, t < 5 ? { x: -dir, y: 0 } : null);
      return out;
    };
    const trace: Vec2[][] = [];
    let tackleTick = -1;
    let victim = -1;
    for (let t = 0; t < 900; t++) {
      const evs = sim.step(c(t));
      if (t % 30 === 0) trace.push(sim.state.police.map((o) => (mirror ? { x: 100 - o.pos.x, y: o.pos.y } : { ...o.pos })));
      const hit = ofType(evs, 'policeTackle').find((e) => e.hit);
      if (hit && tackleTick < 0) {
        tackleTick = hit.tick;
        victim = hit.victimId;
      }
    }
    return { tackleTick, victim, trace, scores: [...sim.state.scores] as [number, number] };
  }

  it('a team 1 carrier is chased and tackled exactly like the mirrored team 0 carrier', () => {
    const a = run(false);
    const b = run(true);
    // eslint-disable-next-line no-console
    console.log(`[police fairness] tackle ticks ${a.tackleTick} vs ${b.tackleTick}`);
    expect(a.tackleTick).toBeGreaterThan(0);
    expect(b.tackleTick).toBeGreaterThan(0);
    expect(Math.abs(a.tackleTick - b.tackleTick)).toBeLessThanOrEqual(1);
    expect(a.victim).toBe(1);
    expect(b.victim).toBe(3);
    // officer positions mirror each other (officer order swaps west <-> east)
    for (let k = 0; k < Math.min(a.trace.length, b.trace.length); k++) {
      const pa = a.trace[k]!;
      const pb = b.trace[k]!;
      if (pa.length !== 2 || pb.length !== 2) continue;
      const err = Math.max(Math.hypot(pa[0]!.x - pb[1]!.x, pa[0]!.y - pb[1]!.y), Math.hypot(pa[1]!.x - pb[0]!.x, pa[1]!.y - pb[0]!.y));
      expect(err).toBeLessThan(0.75);
    }
    expect(a.scores).toEqual([0, 0]);
    expect(b.scores).toEqual([0, 0]);
  });

  it('two mirrored carriers at once are pressured equally (one officer each, similar timing)', () => {
    const sim = policeSim();
    officersOnField(sim);
    const { small } = lootIds(sim);
    for (const [slot, safe, x] of [
      [0, small[0]!, 41],
      [2, small[1]!, 59],
    ] as const) {
      sim.debug.setAnchored(safe, false);
      sim.debug.teleport(safe, { x, y: 12 }, 0);
      sim.debug.teleport(slot + 1, { x: x < 50 ? x + 1 : x - 1, y: 12 }, x < 50 ? Math.PI : 0);
    }
    const hits = new Map<number, number>();
    const targets = new Set<string>();
    for (let t = 0; t < 900; t++) {
      const c = idle();
      c[0] = cmd(t < 5 ? 0 : -0.9, 0, true, false, t < 5 ? { x: 1, y: 0 } : null);
      c[2] = cmd(t < 5 ? 0 : 0.9, 0, true, false, t < 5 ? { x: -1, y: 0 } : null);
      const evs = sim.step(c);
      if (t === 12) targets.add(sim.state.police.map((o) => o.targetCharId).join(','));
      for (const e of ofType(evs, 'policeTackle')) if (e.hit && !hits.has(e.victimId)) hits.set(e.victimId, e.tick);
    }
    expect([...targets]).toEqual(['1,3']); // west officer -> team 0 carrier, east -> team 1
    expect(hits.has(1)).toBe(true);
    expect(hits.has(3)).toBe(true);
    expect(Math.abs(hits.get(1)! - hits.get(3)!)).toBeLessThanOrEqual(3);
  });
});

describe('police: layout entries', () => {
  it('derives north/south curb entries on the mirror axis when a layout has none', () => {
    const sim = policeSim();
    const e = sim.policeEntries();
    expect(e.length).toBe(2);
    expect(e[0]!.park).toEqual({ x: 50, y: -POLICE_CAR.curb });
    expect(e[1]!.park).toEqual({ x: 50, y: 60 + POLICE_CAR.curb });
    expect(e[0]!.from.y).toBeLessThan(e[0]!.park.y);
    expect(e[1]!.from.y).toBeGreaterThan(e[1]!.park.y);
    expect(POLICE_CAR.half.x).toBeGreaterThan(POLICE_CAR.half.y);
  });

  it('the car stays off the field for the whole drive-in and officers hop in just inside the edge', () => {
    for (const id of MATCH_LAYOUT_IDS) {
      const sim = new Simulation(makeSetup(LAYOUTS[id], [0, 0, 1, 1], { police: true }));
      const size = sim.layout.size;
      const bank = lootIds(sim).banks[0]!;
      sim.debug.setAnchored(bank, false);
      for (let t = 0; t < POLICE.dispatchDelayTicks + POLICE.arriveTicks + 5; t++) {
        sim.step(idle());
        for (const c of sim.state.policeCars) {
          // the whole (turning) car footprint stays beyond the north / south edge
          const ext = Math.abs(Math.sin(c.angle)) * POLICE_CAR.half.x + Math.abs(Math.cos(c.angle)) * POLICE_CAR.half.y;
          expect(c.pos.y + ext < 0 || c.pos.y - ext > size.y).toBe(true);
        }
      }
      const entry = sim.policeEntries()[0]!;
      expect(sim.state.police.length).toBe(2);
      sim.state.police.forEach((o, k) => {
        const want = officerStepOutSpot(entry, k, size);
        expect(Math.hypot(o.pos.x - want.x, o.pos.y - want.y)).toBeLessThan(0.3);
        expect(o.pos.y).toBeGreaterThan(0);
      });
    }
  });

  it('officers of a curb car get going on every real layout (no head-on stalemate at the step-in)', () => {
    for (const id of MATCH_LAYOUT_IDS) {
      const sim = new Simulation(makeSetup(LAYOUTS[id], [0, 0, 1, 1], { police: true }));
      const banks = sim.state.loot.filter((l) => l.kind === 'bank');
      sim.debug.setAnchored(banks.reduce((a, b) => (a.pos.y < b.pos.y ? a : b)).id, false);
      stepUntil(sim, (evs) => evs.some((e) => e.type === 'policeArrived'), POLICE.dispatchDelayTicks + POLICE.arriveTicks + 10);
      const start = sim.state.police.map((o) => ({ ...o.pos }));
      stepUntil(sim, () => false, 6 * 60);
      sim.state.police.forEach((o, k) => expect(Math.hypot(o.pos.x - start[k]!.x, o.pos.y - start[k]!.y)).toBeGreaterThan(5));
    }
  });
});

describe('police: pursuit memory', () => {
  it('keeps pursuing a carrier hidden behind a wall to its last known spot past the 3 s sight memory', () => {
    // a see-through planter between the officers and the carrier, flanked by sight-blocking walls:
    // the officers must walk around the wall end, out of sight for > 3 s
    const statics = [
      { id: 'planter', kind: 'planter' as const, center: { x: 50, y: 5.5 }, half: { x: 10, y: 0.4 }, angle: 0, height: 0.8 },
      { id: 'wallW', kind: 'wall' as const, center: { x: 32.5, y: 5.5 }, half: { x: 7.5, y: 0.4 }, angle: 0, height: 2 },
      { id: 'wallE', kind: 'wall' as const, center: { x: 67.5, y: 5.5 }, half: { x: 7.5, y: 0.4 }, angle: 0, height: 2 },
    ];
    const layout = openLayout({
      statics,
      banks: [{ pos: BANK_POS, angle: 0 }],
      safes: [
        { kind: 'smallSafe', pos: { x: 20, y: 20 }, angle: 0 },
        { kind: 'smallSafe', pos: { x: 80, y: 20 }, angle: 0 },
      ],
    });
    const sim = policeSim(layout);
    officersOnField(sim);
    makeCarriers(sim, [{ slot: 0, safe: lootIds(sim).small[0]!, pos: { x: 50, y: 9 } }]);
    const ctx = (sim as unknown as { ctx: Parameters<typeof lineOfSight>[0] }).ctx;
    let hidden = 0;
    let maxHidden = 0;
    let pursued = false;
    let tackled = -1;
    for (let t = 0; t < 20 * 60 && tackled < 0; t++) {
      const evs = sim.step([cmd(0, 0, true), cmd(), cmd(), cmd()]);
      const c = sim.state.characters[0]!.pos;
      const seen = sim.state.police.some((o) => Math.hypot(o.pos.x - c.x, o.pos.y - c.y) <= POLICE.sightRadius && lineOfSight(ctx, o.pos, c));
      hidden = seen ? 0 : hidden + 1;
      maxHidden = Math.max(maxHidden, hidden);
      if (sim.state.police.some((o) => o.targetCharId === 1)) pursued = true;
      // once pursued, someone stays on it the whole way (no drop when the 3 s memory runs out)
      else if (pursued) expect(evs.some((e) => e.type === 'policeTackle')).toBe(true);
      const hit = ofType(evs, 'policeTackle').find((e) => e.hit && e.victimId === 1);
      if (hit) tackled = t;
    }
    expect(maxHidden).toBeGreaterThan(3 * 60);
    expect(tackled).toBeGreaterThan(0);
  });
});

describe('police: boarding', () => {
  it('officers board only at their car and their physics bodies are removed', () => {
    const sim = policeSim();
    const physics = (sim as unknown as { ctx: { physics: { bodies: unknown[] } } }).ctx.physics;
    const base = physics.bodies.length;
    officersOnField(sim);
    expect(physics.bodies.length).toBe(base + 2);
    const entry = sim.policeEntries()[0]!;
    const last = new Map<number, Vec2>();
    // a raccoon parks itself on officer 0's step-in spot: the officer still gets home
    const spot = officerStepOutSpot(entry, 0, sim.layout.size);
    sim.debug.teleport(1, { x: spot.x, y: spot.y + 0.3 }, 0);
    const evs = stepUntil(sim, (e) => e.some((x) => x.type === 'policeLeaving'), POLICE.shiftTicks + 60 * 60, () => {
      for (const o of sim.state.police) last.set(o.id, { ...o.pos });
      return [cmd(0, -0.2), cmd(), cmd(), cmd()];
    });
    expect(ofType(evs, 'policeLeaving').length).toBe(1);
    expect(sim.state.police.length).toBe(0);
    for (const p of last.values()) expect(Math.hypot(p.x - entry.park.x, p.y - entry.park.y)).toBeLessThan(POLICE_CAR.curb + 0.75 + POLICE_CAR.half.x + 0.5);
    expect(physics.bodies.length).toBe(base);
  });
});

describe('police: mirror-canonical navigation', () => {
  it('mirrored start/goal pairs get mirror-image paths on every real layout', () => {
    for (const id of MATCH_LAYOUT_IDS) {
      const sim = new Simulation(makeSetup(LAYOUTS[id], [0, 0, 1, 1], { police: true }));
      const nav = (sim as unknown as { ctx: { police: { nav: PoliceNav } } }).ctx.police.nav;
      nav.refreshDynamic();
      const W = sim.layout.size.x;
      const H = sim.layout.size.y;
      let seed = 7;
      const rnd = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
      let compared = 0;
      for (let n = 0; n < 60; n++) {
        const a = { x: 1 + rnd() * (W - 2), y: 1 + rnd() * (H - 2) };
        const b = { x: 1 + rnd() * (W - 2), y: 1 + rnd() * (H - 2) };
        const p = nav.findPath(a.x, a.y, b.x, b.y);
        const q = nav.findPath(W - a.x, a.y, W - b.x, b.y);
        expect(p === null).toBe(q === null);
        if (!p || !q) continue;
        compared++;
        expect(q.length).toBe(p.length);
        p.forEach((pt, i) => {
          expect(q[i]!.x).toBeCloseTo(W - pt.x, 6);
          expect(q[i]!.y).toBeCloseTo(pt.y, 6);
        });
      }
      expect(compared).toBeGreaterThan(30);
    }
  });
});

describe('police: sealed off from the car', () => {
  it('officers whose gate is sealed by a bank squeeze past it and still board at their car in time', () => {
    // counter: the north bank shoved 2 m north against the on-axis police gate (found by the fuzz)
    const sim = new Simulation(makeSetup(LAYOUTS.counter, [0, 0, 1, 1], { police: true, matchTicks: 30000 }));
    const banks = sim.state.loot.filter((l) => l.kind === 'bank');
    const north = banks.find((b) => b.pos.y < sim.layout.size.y / 2)!;
    const south = banks.find((b) => b !== north)!;
    sim.debug.setAnchored(south.id, false); // rings: a wave comes for it
    const idle = (): Command[] => [cmd(), cmd(), cmd(), cmd()];
    for (let t = 0; t < POLICE.dispatchDelayTicks + POLICE.arriveTicks + 30; t++) sim.step(idle());
    const entry = sim.policeEntries()[0]!;
    expect(sim.state.police.length).toBeGreaterThan(0);
    // seal the gate behind the north bank once the officers are out in the square
    for (let t = 0; t < 30 * 60 && !sim.state.police.every((o) => o.pos.y > 14); t++) sim.step(idle());
    expect(sim.state.police.every((o) => o.pos.y > 14)).toBe(true);
    sim.debug.teleport(north.id, { x: 36.7, y: 8.1 }, (12 * Math.PI) / 180);
    for (let x = 30; x <= 38; x += 0.25) expect(sim.isFree({ x, y: 4.75 }, POLICE.radius)).toBe(false);
    const born = sim.state.tick;
    const boarded = new Map<number, Vec2>();
    const last = new Map<number, Vec2>();
    for (let t = 0; t < POLICE.shiftTicks + 40 * 60 && sim.state.police.length > 0; t++) {
      sim.step(idle());
      for (const [id, p] of last) if (!sim.state.police.some((o) => o.id === id)) boarded.set(id, p);
      last.clear();
      for (const o of sim.state.police) last.set(o.id, { ...o.pos });
    }
    expect(sim.state.police.length).toBe(0);
    expect(sim.state.tick - born).toBeLessThan(POLICE.shiftTicks + 30 * 60);
    for (const p of boarded.values()) expect(Math.hypot(p.x - entry.park.x, p.y - entry.park.y)).toBeLessThan(POLICE_CAR.curb + 0.75 + POLICE_CAR.half.x + 0.5);
  });
});
