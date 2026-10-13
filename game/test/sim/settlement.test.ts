/**
 * doc §8 "정산의 경계 상황" — every row of the table as its own test, plus settlement details.
 * Scenarios are set up with sim.debug (teleport / unanchor); scores only change through the
 * real per-tick settlement (or the internal settle() for the duplicate-request row).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../../src/sim/config';
import type { SimContext } from '../../src/sim/context';
import { settle } from '../../src/sim/rules';
import type { Simulation } from '../../src/sim/sim';
import type { SimEvent, TeamId, Vec2 } from '../../src/sim/types';
import { bankLocal, cmd, makeSim, openLayout, ZONE0, ZONE1 } from './fixtures/layouts';

const R = DEFAULT_RULES.recoveryTicks;

/** Two banks + 2 small + 1 large outdoor = 2500 points. */
function scenario(rules = {}) {
  const sim = makeSim(
    openLayout({
      banks: [
        { pos: { x: 40, y: 15 }, angle: 0 },
        { pos: { x: 60, y: 45 }, angle: 0 },
      ],
      safes: [
        { kind: 'smallSafe', pos: { x: 30, y: 52 }, angle: 0 },
        { kind: 'smallSafe', pos: { x: 33, y: 52 }, angle: 0 },
        { kind: 'largeSafe', pos: { x: 70, y: 10 }, angle: 0 },
      ],
    }),
    [0, 1],
    rules,
  );
  const [b1, b2] = sim.state.loot.filter((l) => l.kind === 'bank').map((l) => l.id) as [number, number];
  const inside = (b: number) => sim.state.loot.filter((l) => l.homeBank === b).map((l) => l.id);
  const large1 = sim.state.loot.find((l) => l.homeBank === b1 && l.kind === 'largeSafe')!.id;
  const outdoor = sim.state.loot.filter((l) => l.kind !== 'bank' && l.homeBank === null).map((l) => l.id);
  return { sim, b1, b2, inside, large1, outdoor };
}

const zoneCenter = (team: TeamId): Vec2 => (team === 0 ? ZONE0.center : ZONE1.center);
const spot = (team: TeamId, dx: number, dy: number): Vec2 => ({ x: zoneCenter(team).x + dx, y: zoneCenter(team).y + dy });

/** Step n idle ticks checking the value invariant every tick; returns all events. */
function idle(sim: Simulation, n: number): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < n && !sim.state.over; i++) {
    ev.push(...sim.step([cmd(), cmd()]));
    const s = sim.state;
    expect(s.scores[0] + s.scores[1] + s.remainingValue).toBe(s.totalValue);
  }
  return ev;
}

function freeAndPlace(sim: Simulation, id: number, p: Vec2, angle = 0): void {
  sim.debug.setAnchored(id, false);
  sim.debug.teleport(id, p, angle);
}

const recovered = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { type: 'recovered' }> => e.type === 'recovered');

describe('doc §8 정산의 경계 상황 (contract table)', () => {
  it('row 1: pulling the 300 large safe out of a 1000 bank -> bank estimate 700, safe 300, scores unchanged', () => {
    const { sim, b1, large1 } = scenario();
    expect(sim.getLoot(b1)!.estimatedValue).toBe(1000);
    freeAndPlace(sim, large1, bankLocal(sim, b1, 0, 6)); // outside the front door
    const ev = idle(sim, 1);
    expect(ev.find((e) => e.type === 'safeUnloaded')).toMatchObject({ safeId: large1, bankId: b1, bankValue: 700 });
    expect(sim.getLoot(b1)!.estimatedValue).toBe(700);
    expect(sim.getLoot(large1)!.estimatedValue).toBe(300);
    expect(sim.getLoot(large1)!.loadedIn).toBeNull();
    expect(sim.state.scores).toEqual([0, 0]);
    expect(sim.state.remainingValue).toBe(2500);
  });

  it('row 2: opponent recovers that 300 safe at their van -> +300; the bank then pays 700', () => {
    const { sim, b1, large1 } = scenario();
    freeAndPlace(sim, large1, spot(1, 0, 0));
    let ev = idle(sim, R);
    expect(recovered(ev)).toEqual([
      expect.objectContaining({ lootId: large1, team: 1, value: 300, kind: 'largeSafe', safeIds: [], safesValue: 0 }),
    ]);
    expect(sim.state.scores).toEqual([0, 300]);
    expect(sim.getLoot(b1)!.estimatedValue).toBe(700);
    freeAndPlace(sim, b1, spot(0, 0, 0));
    ev = idle(sim, R);
    const r = recovered(ev);
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ lootId: b1, team: 0, value: 700, safesValue: 200, kind: 'bank' });
    expect(sim.state.scores).toEqual([700, 300]);
  });

  it('row 3: a safe pulled out mid bank recovery: bank progress kept, estimate drops, the safe needs its own recovery', () => {
    const { sim, b1, large1 } = scenario();
    freeAndPlace(sim, b1, spot(0, 0, 0));
    idle(sim, 30);
    expect(sim.getLoot(b1)!.recovery).toEqual({ team: 0, ticks: 30 });
    // pull the large safe out of the bank but leave it inside the same zone
    freeAndPlace(sim, large1, spot(0, -3, 4.2));
    let ev = idle(sim, 1);
    expect(sim.getLoot(b1)!.recovery).toEqual({ team: 0, ticks: 31 });
    expect(sim.getLoot(b1)!.estimatedValue).toBe(700);
    expect(ev.some((e) => e.type === 'recoveryCancel')).toBe(false);
    expect(sim.getLoot(large1)!.recovery).toEqual({ team: 0, ticks: 1 });
    ev = idle(sim, R - 31);
    let r = recovered(ev);
    expect(r).toEqual([expect.objectContaining({ lootId: b1, value: 700, safesValue: 200 })]);
    expect(r[0]!.safeIds).not.toContain(large1);
    expect(sim.state.scores).toEqual([700, 0]);
    // the extracted safe settles separately, only after its own full dwell
    ev = idle(sim, 29);
    expect(recovered(ev)).toEqual([]);
    ev = idle(sim, 1);
    r = recovered(ev);
    expect(r).toEqual([expect.objectContaining({ lootId: large1, value: 300, team: 0 })]);
    expect(sim.state.scores).toEqual([1000, 0]);
  });

  it('row 4: at bank completion an opponent holding a still-loaded interior safe -> included in the bank; holder irrelevant', () => {
    const { sim, b1, large1 } = scenario();
    freeAndPlace(sim, b1, spot(0, 0, 0));
    sim.debug.setAnchored(large1, false); // free, but still fully on the floor (loaded)
    // opponent (slot 1, team 1) stands inside and grabs it
    const lp = sim.getLoot(large1)!.pos;
    sim.debug.teleport(2, { x: lp.x + 1.15, y: lp.y }, Math.PI);
    const g = sim.step([cmd(), cmd(0, 0, true)]);
    expect(g.find((e) => e.type === 'grab')).toMatchObject({ charId: 2, targetId: large1 });
    const ev: SimEvent[] = [];
    for (let i = 1; i < R && !sim.state.over; i++) ev.push(...sim.step([cmd(), cmd(0, 0, true)]));
    const r = recovered(ev);
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ lootId: b1, team: 0, value: 1000, safesValue: 500 });
    expect(r[0]!.safeIds).toContain(large1);
    expect(sim.state.scores).toEqual([1000, 0]);
    expect(sim.getLoot(large1)!.recovered).toBe(true);
    expect(sim.getLoot(large1)!.recoveredBy).toBe(0);
    // holder released (not forced) and ejected outside the vanished bank
    expect(ev.find((e) => e.type === 'release')).toMatchObject({ charId: 2, targetId: large1, forced: false });
    const ej = ev.find((e) => e.type === 'ejected');
    expect(ej).toMatchObject({ charId: 2 });
    expect(sim.state.characters[1]!.grab).toBeNull();
    const p = sim.state.characters[1]!.pos;
    expect(sim.isFree(p, 0.45)).toBe(true);
  });

  it('row 5: a safe taken out and loaded again counts once (same unrecovered value only)', () => {
    const { sim, b1, large1 } = scenario();
    freeAndPlace(sim, large1, bankLocal(sim, b1, 0, 6));
    idle(sim, 1);
    expect(sim.getLoot(b1)!.estimatedValue).toBe(700);
    sim.debug.teleport(large1, bankLocal(sim, b1, 0, 0.5), 0);
    let ev = idle(sim, 1);
    expect(ev.find((e) => e.type === 'safeLoaded')).toMatchObject({ safeId: large1, bankValue: 1000 });
    expect(sim.getLoot(b1)!.estimatedValue).toBe(1000);
    // out and in again: still 1000, never 1300
    sim.debug.teleport(large1, bankLocal(sim, b1, 0, 6), 0);
    idle(sim, 1);
    sim.debug.teleport(large1, bankLocal(sim, b1, 0, 0.5), 0);
    idle(sim, 1);
    expect(sim.getLoot(b1)!.estimatedValue).toBe(1000);
    // an extra outdoor small safe loaded raises it by exactly 100
    const { outdoor } = scenario();
    const small = outdoor[0]!;
    freeAndPlace(sim, small, bankLocal(sim, b1, 0, -1.5));
    idle(sim, 1);
    expect(sim.getLoot(b1)!.estimatedValue).toBe(1100);
    freeAndPlace(sim, b1, spot(0, 0, 0));
    ev = idle(sim, R);
    expect(recovered(ev)).toEqual([expect.objectContaining({ lootId: b1, value: 1100, safesValue: 600 })]);
    expect(sim.state.scores).toEqual([1100, 0]);
    expect(sim.state.remainingValue).toBe(2500 - 1100);
  });

  it('row 6: a duplicate settle request for an already recovered safe adds nothing', () => {
    const { sim, outdoor, b1, inside } = scenario();
    const small = outdoor[0]!;
    freeAndPlace(sim, small, spot(0, 0, 0));
    idle(sim, R);
    expect(sim.state.scores).toEqual([100, 0]);
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    expect(settle(ctx, [small, small], 0)).toEqual([]);
    expect(settle(ctx, [small], 1)).toEqual([]);
    expect(sim.state.scores).toEqual([100, 0]);
    // the recovered safe is gone: it cannot be moved back into play
    expect(() => sim.debug.teleport(small, spot(0, 1, 1))).toThrow();
    idle(sim, R * 2);
    expect(sim.state.scores).toEqual([100, 0]);
    // a bank and its loaded safe requested together: the safe is paid once, through the bank
    const res = settle(ctx, [inside(b1)[0]!, b1], 1);
    expect(res.length).toBe(1);
    expect(res[0]!.value).toBe(1000);
    expect(sim.state.scores).toEqual([100, 1000]);
    expect(settle(ctx, [b1, ...inside(b1)], 1)).toEqual([]);
    expect(sim.state.scores[0] + sim.state.scores[1] + sim.state.remainingValue).toBe(sim.state.totalValue);
  });

  it('row 7: holding a safe in the zone at 0 s without a completed dwell scores 0', () => {
    const { sim, outdoor } = scenario({ matchTicks: 200, earlyDecision: false });
    const small = outdoor[0]!;
    idle(sim, 200 - 50);
    freeAndPlace(sim, small, spot(0, 0, 0));
    sim.debug.teleport(1, spot(0, 0.95, 0), Math.PI);
    const ev: SimEvent[] = [];
    while (!sim.state.over) ev.push(...sim.step([cmd(0, 0, true), cmd()]));
    expect(sim.state.characters[0]!.grab?.targetId).toBe(small);
    expect(sim.getLoot(small)!.recovered).toBe(false);
    expect(sim.state.result).toEqual({ reason: 'time', winner: null, scores: [0, 0], endTick: 200 });
    expect(recovered(ev)).toEqual([]);
  });

  it('row 8: an empty bank pays the building only: 500', () => {
    const { sim, b1, inside } = scenario();
    inside(b1).forEach((id, i) => freeAndPlace(sim, id, { x: 40 + i * 3, y: 25 }));
    idle(sim, 1);
    expect(sim.getLoot(b1)!.estimatedValue).toBe(500);
    expect(sim.getLoot(b1)!.loadedSafes).toEqual([]);
    freeAndPlace(sim, b1, spot(1, 0, 0));
    const ev = idle(sim, R);
    expect(recovered(ev)).toEqual([expect.objectContaining({ lootId: b1, team: 1, value: 500, safeIds: [], safesValue: 0 })]);
    expect(ev.find((e) => e.type === 'bankBodyRecovered')).toMatchObject({ bankId: b1, count: 1 });
    expect(sim.state.scores).toEqual([0, 500]);
    expect(sim.state.banksRecovered).toBe(1);
  });

  // rows 9-14 (early decision and timer) live in timer.test.ts with full 3200-point fixtures.
});

describe('settlement details', () => {
  it('standalone safe: whole OBB inside, consecutive ticks, only leaving resets (no speed condition)', () => {
    const { sim, outdoor } = scenario();
    const small = outdoor[0]!;
    // partially inside: no progress
    freeAndPlace(sim, small, { x: ZONE0.center.x + ZONE0.half.x - 0.2, y: 30 });
    idle(sim, 10);
    expect(sim.getLoot(small)!.recovery).toBeNull();
    // fully inside and moving fast: progress counts
    sim.debug.teleport(small, spot(0, -4, 0));
    sim.debug.setVelocity(small, { x: 3, y: 0 });
    let ev = idle(sim, 1);
    expect(ev.find((e) => e.type === 'recoveryStart')).toMatchObject({ lootId: small, team: 0 });
    idle(sim, 40);
    expect(sim.getLoot(small)!.recovery!.ticks).toBe(41);
    // leaving resets
    sim.debug.teleport(small, { x: 30, y: 30 });
    ev = idle(sim, 1);
    expect(ev.find((e) => e.type === 'recoveryCancel')).toMatchObject({ lootId: small, team: 0, progressTicks: 41 });
    expect(sim.getLoot(small)!.recovery).toBeNull();
    sim.debug.teleport(small, spot(0, 0, 0));
    ev = idle(sim, R - 1);
    expect(recovered(ev)).toEqual([]);
    ev = idle(sim, 1);
    expect(recovered(ev)).toEqual([expect.objectContaining({ lootId: small, value: 100 })]);
  });

  it('a standing opponent or a grabbing opponent does not cancel a recovery', () => {
    const { sim, outdoor } = scenario();
    const small = outdoor[0]!;
    freeAndPlace(sim, small, spot(0, 0, 0));
    sim.debug.teleport(2, spot(0, 0.95, 0), Math.PI);
    const ev: SimEvent[] = [];
    for (let i = 0; i < R; i++) ev.push(...sim.step([cmd(), cmd(0, 0, true)]));
    expect(recovered(ev)).toEqual([expect.objectContaining({ lootId: small, team: 0, holders: [2] })]);
  });

  it('moving the bank out of the zone resets its dwell', () => {
    const { sim, b1 } = scenario();
    freeAndPlace(sim, b1, spot(0, 0, 0));
    idle(sim, 50);
    sim.debug.teleport(b1, spot(0, 3, 0)); // footprint pokes out of the zone
    const ev = idle(sim, 1);
    expect(ev.find((e) => e.type === 'recoveryCancel')).toMatchObject({ lootId: b1, progressTicks: 50 });
    sim.debug.teleport(b1, spot(0, 0, 0));
    idle(sim, R - 1);
    expect(sim.getLoot(b1)!.recovered).toBe(false);
    idle(sim, 1);
    expect(sim.getLoot(b1)!.recovered).toBe(true);
  });

  it('loaded safes never settle separately when their bank sits in a zone', () => {
    const { sim, b1, inside } = scenario();
    freeAndPlace(sim, b1, spot(0, 0, 0));
    inside(b1).forEach((id) => sim.debug.setAnchored(id, false));
    const ev = idle(sim, R);
    const r = recovered(ev);
    expect(r.length).toBe(1);
    expect(r[0]!.lootId).toBe(b1);
    expect([...r[0]!.safeIds].sort()).toEqual([...inside(b1)].sort());
    for (const id of inside(b1)) {
      expect(ev.some((e) => e.type === 'recoveryStart' && e.lootId === id)).toBe(false);
      expect(sim.getLoot(id)!.recovered).toBe(true);
    }
  });

  it('anchored items never recover (they must be pulled loose first)', () => {
    const { sim, outdoor } = scenario();
    const small = outdoor[0]!;
    sim.debug.teleport(small, spot(0, 0, 0));
    expect(sim.getLoot(small)!.anchored).toBe(true);
    idle(sim, R + 5);
    expect(sim.getLoot(small)!.recovered).toBe(false);
  });

  it('an anchored outdoor safe under a bank is never loaded, estimated or settled with it', () => {
    // a free bank parked over an anchored small safe in team 0's zone, then recovered there
    const { sim, b1, inside, outdoor } = scenario();
    const small = outdoor[0]!;
    sim.debug.teleport(small, spot(0, 0, 1));
    expect(sim.getLoot(small)!.anchored).toBe(true);
    freeAndPlace(sim, b1, spot(0, 0, 0));
    const ev = idle(sim, R + 5);
    expect(ev.some((e) => e.type === 'safeLoaded' && e.safeId === small)).toBe(false);
    const r = recovered(ev);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ lootId: b1, value: 1000 });
    expect([...r[0]!.safeIds].sort()).toEqual([...inside(b1)].sort());
    expect(sim.getLoot(small)!.recovered).toBe(false);
    expect(sim.getLoot(small)!.loadedIn).toBeNull();
    expect(sim.state.scores).toEqual([1000, 0]);
  });

  it('a bank driven over an anchored safe (real physics) never counts it as loaded', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 30, y: 30 }, angle: 0 }], safes: [{ kind: 'smallSafe', pos: { x: 30, y: 36 }, angle: 0 }] }), [0, 0]);
    const bank = sim.state.loot[0]!.id;
    const small = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!.id;
    sim.debug.setAnchored(bank, false);
    // two holders on the back (north) wall push the bank south through the safe's door lane
    sim.debug.teleport(1, { x: 28, y: 26.45 }, Math.PI / 2);
    sim.debug.teleport(2, { x: 32, y: 26.45 }, Math.PI / 2);
    sim.step([cmd(0, 0, true), cmd(0, 0, true)]);
    expect(sim.getLoot(bank)!.grabbedBy).toEqual([1, 2]);
    let overlapped = false;
    const ev: SimEvent[] = [];
    for (let t = 0; t < 600; t++) {
      ev.push(...sim.step([cmd(0, 1, true), cmd(0, 1, true)]));
      const s = sim.getLoot(small)!;
      if (s.floorOf === bank) overlapped = true;
      expect(s.loadedIn).toBeNull();
      expect(sim.getLoot(bank)!.estimatedValue).toBe(1000);
    }
    expect(overlapped).toBe(true); // the bank really passed over it
    expect(sim.getLoot(small)!.pos).toEqual({ x: 30, y: 36 });
    expect(ev.some((e) => (e.type === 'safeLoaded' || e.type === 'safeUnloaded') && e.safeId === small)).toBe(false);
  });

  it('recovered items leave physics: nothing collides with them and holders are released', () => {
    const { sim, outdoor } = scenario();
    const small = outdoor[0]!;
    freeAndPlace(sim, small, spot(0, 0, 0));
    sim.debug.teleport(1, spot(0, 0.95, 0), Math.PI);
    const ev: SimEvent[] = [];
    for (let i = 0; i < R; i++) ev.push(...sim.step([cmd(0, 0, true), cmd()]));
    expect(ev.find((e) => e.type === 'release')).toMatchObject({ charId: 1, targetId: small, forced: false });
    expect(sim.getLoot(small)!.grabbedBy).toEqual([]);
    // walk straight through where it was
    for (let i = 0; i < 60; i++) sim.step([cmd(-1, 0), cmd()]);
    expect(sim.state.characters[0]!.pos.x).toBeLessThan(spot(0, -1.5, 0).x);
  });

  it('characters on a recovered bank are ejected to a free spot outside the footprint', () => {
    const { sim, b1 } = scenario();
    freeAndPlace(sim, b1, spot(1, 0, 0));
    sim.debug.teleport(1, bankLocal(sim, b1, 1, 0));
    sim.debug.teleport(2, bankLocal(sim, b1, -1, 0.5));
    const ev = idle(sim, R);
    const ej = ev.filter((e) => e.type === 'ejected');
    expect(ej.length).toBe(2);
    for (const c of sim.state.characters) {
      expect(c.floorOf).toBeNull();
      expect(sim.isFree(c.pos, 0.45)).toBe(true);
    }
    expect(Math.hypot(sim.state.characters[0]!.pos.x - sim.state.characters[1]!.pos.x, sim.state.characters[0]!.pos.y - sim.state.characters[1]!.pos.y)).toBeGreaterThan(0.89);
  });
});
