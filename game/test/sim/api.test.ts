/**
 * Public query API (docs/ARCHITECTURE.md "Simulation API"), math helpers and robustness guards.
 */
import { describe, expect, it } from 'vitest';
import { BANK_MODEL, CHARACTER, DEFAULT_RULES, VAN } from '../../src/sim/config';
import type { SimContext } from '../../src/sim/context';
import {
  closestPointOnOBB,
  closestPointOnOBBBoundary,
  createRng,
  obbInsideOBB,
  obbOverlap,
  pointInOBB,
  rayCircle,
  rayOBB,
  segmentIntersectsOBB,
  toLocal,
  toWorld,
  wrapAngle,
} from '../../src/sim/math';
import * as SimIndex from '../../src/sim/index';
import { bankLocal, cmd, makeSim, openLayout, run, ZONE0 } from './fixtures/layouts';

describe('math helpers', () => {
  const box = { center: { x: 10, y: 5 }, half: { x: 2, y: 1 }, angle: Math.PI / 2 };
  it('frames and OBB containment', () => {
    const w = toWorld({ x: 1, y: 0 }, { x: 10, y: 5 }, Math.PI / 2);
    expect(w.x).toBeCloseTo(10);
    expect(w.y).toBeCloseTo(6);
    const l = toLocal(w, { x: 10, y: 5 }, Math.PI / 2);
    expect(l.x).toBeCloseTo(1);
    expect(l.y).toBeCloseTo(0);
    expect(pointInOBB({ x: 10, y: 6.9 }, box)).toBe(true);
    expect(pointInOBB({ x: 11.1, y: 5 }, box)).toBe(false);
    expect(obbInsideOBB({ center: { x: 10, y: 5 }, half: { x: 0.4, y: 0.4 }, angle: 0.3 }, box)).toBe(true);
    expect(obbInsideOBB({ center: { x: 10.8, y: 5 }, half: { x: 0.4, y: 0.4 }, angle: 0 }, box)).toBe(false);
  });
  it('closest points, rays, SAT', () => {
    const q = closestPointOnOBB({ x: 20, y: 5 }, box);
    expect(q.x).toBeCloseTo(11);
    expect(q.y).toBeCloseTo(5);
    const inner = closestPointOnOBBBoundary({ x: 10.8, y: 5 }, box);
    expect(inner.x).toBeCloseTo(11);
    expect(rayOBB({ x: 0, y: 5 }, { x: 1, y: 0 }, box, 100)).toBeCloseTo(9);
    expect(rayOBB({ x: 0, y: 5 }, { x: -1, y: 0 }, box, 100)).toBeNull();
    expect(rayOBB({ x: 10, y: 5 }, { x: 1, y: 0 }, box, 1)).toBe(0);
    expect(segmentIntersectsOBB({ x: 0, y: 8 }, { x: 20, y: 8 }, box)).toBe(false);
    expect(rayCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 }, 1, 10)).toBeCloseTo(4);
    expect(obbOverlap(box, { center: { x: 11.5, y: 5 }, half: { x: 0.6, y: 0.6 }, angle: 0.7 })).toBe(true);
    expect(obbOverlap(box, { center: { x: 12.5, y: 5 }, half: { x: 0.6, y: 0.6 }, angle: 0 })).toBe(false);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
  });
  it('createRng is deterministic and in [0,1)', () => {
    const a = createRng(5);
    const b = createRng(5);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
});

describe('Simulation query API', () => {
  const layout = () =>
    openLayout({
      banks: [{ pos: { x: 50, y: 30 }, angle: Math.PI / 2 }],
      safes: [{ kind: 'smallSafe', pos: { x: 30, y: 20 }, angle: 0.4 }],
      statics: [
        { id: 'bld', kind: 'building', center: { x: 70, y: 30 }, half: { x: 3, y: 3 }, angle: 0, height: 8 },
        { id: 'bench', kind: 'bench', center: { x: 30, y: 40 }, half: { x: 1, y: 0.3 }, angle: 0, height: 0.5 },
      ],
      circles: [{ id: 'tree', kind: 'tree', center: { x: 20, y: 40 }, radius: 0.6, height: 5 }],
      fences: [{ id: 'f', center: { x: 80, y: 45 }, half: { x: 3, y: 0.1 }, angle: 0 }],
    });

  it('ids, lookups and characterBySlot', () => {
    const sim = makeSim(layout(), [0, 1, 1]);
    expect(sim.state.characters.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(sim.characterBySlot(2).id).toBe(3);
    expect(() => sim.characterBySlot(3)).toThrow();
    expect(sim.state.loot.map((l) => l.kind)).toEqual(['bank', 'largeSafe', 'smallSafe', 'smallSafe', 'smallSafe']);
    expect(sim.state.loot.map((l) => l.id)).toEqual([4, 5, 6, 7, 8]);
    expect(sim.getLoot(4)!.loadedSafes).toEqual([5, 6, 7]);
    expect(sim.getLoot(5)!.homeBank).toBe(4);
    expect(sim.getLoot(8)!.homeBank).toBeNull();
    expect(sim.getCharacter(2)!.team).toBe(1);
    expect(sim.getLoot(99)).toBeUndefined();
    expect(sim.rules.recoveryTicks).toBe(90);
    expect(sim.state.totalValue).toBe(1100);
    expect(sim.state.remainingValue).toBe(1100);
    expect(sim.state.loot.every((l) => l.anchored)).toBe(true);
  });

  it('bank geometry: footprint, floor, walls, isOnBankFloor', () => {
    const sim = makeSim(layout(), [0]);
    const bank = sim.state.loot[0]!.id;
    const fp = sim.lootOBB(bank);
    expect(fp.half).toEqual(BANK_MODEL.half);
    expect(fp.angle).toBeCloseTo(Math.PI / 2);
    expect(sim.bankFloorOBB(bank).half).toEqual(BANK_MODEL.floorHalf);
    const walls = sim.bankWallOBBs(bank);
    expect(walls.length).toBe(6);
    // side walls rotate with the bank: local (+-3.8, 0) -> world (50, 30 +- 3.8)
    expect(walls[5]!.center.x).toBeCloseTo(50);
    expect(walls[5]!.center.y).toBeCloseTo(33.8);
    expect(sim.isOnBankFloor({ x: 50, y: 30 }, bank)).toBe(true);
    expect(sim.isOnBankFloor({ x: 50, y: 33.9 }, bank)).toBe(false);
    expect(sim.isOnBankFloor(bankLocal(sim, bank, 3.5, 2.5), bank)).toBe(true);
    expect(() => sim.bankFloorOBB(5)).toThrow();
  });

  it('lineOfSight: blocked by buildings, vans and bank walls; not by fences, trees, benches, safes', () => {
    const sim = makeSim(layout(), [0]);
    expect(sim.lineOfSight({ x: 60, y: 30 }, { x: 80, y: 30 })).toBe(false); // building
    expect(sim.lineOfSight({ x: 40, y: 30 }, { x: 47, y: 30 })).toBe(true);
    expect(sim.lineOfSight({ x: 40, y: 32 }, { x: 60, y: 32 })).toBe(false); // bank side walls
    // through the bank doors (local +-y = world -+x for angle pi/2): door line along x at y = 30
    expect(sim.lineOfSight({ x: 40, y: 30 }, { x: 60, y: 30 })).toBe(true);
    expect(sim.lineOfSight({ x: 80, y: 40 }, { x: 80, y: 50 })).toBe(true); // fence
    expect(sim.lineOfSight({ x: 15, y: 40 }, { x: 35, y: 40 })).toBe(true); // tree + bench
    expect(sim.lineOfSight({ x: 25, y: 20 }, { x: 35, y: 20 })).toBe(true); // safe
    expect(sim.lineOfSight({ x: ZONE0.vanPos.x - 5, y: ZONE0.vanPos.y }, { x: ZONE0.vanPos.x + 5, y: ZONE0.vanPos.y })).toBe(false); // van
  });

  it('isFree / staticOBBs / staticCircles', () => {
    const sim = makeSim(layout(), [0]);
    expect(sim.isFree({ x: 40, y: 50 }, 0.45)).toBe(true);
    expect(sim.isFree({ x: 70, y: 30 }, 0.45)).toBe(false); // building
    expect(sim.isFree({ x: 20, y: 40.9 }, 0.45)).toBe(false); // tree
    expect(sim.isFree({ x: 80, y: 45.3 }, 0.45)).toBe(false); // fence
    expect(sim.isFree({ x: 30.3, y: 20 }, 0.45)).toBe(false); // safe
    expect(sim.isFree({ x: 51.5, y: 31.8 }, 0.45)).toBe(true); // bank interior floor (off the central large safe)
    expect(sim.isFree({ x: 50, y: 33.8 }, 0.45)).toBe(false); // bank side wall
    expect(sim.isFree({ x: 0.2, y: 30 }, 0.45)).toBe(false); // arena edge
    const obbs = sim.staticOBBs();
    expect(obbs.length).toBe(4 + 2 + 2); // boundary + layout boxes + vans
    expect(obbs.some((o) => o.half.x === VAN.half.x && o.half.y === VAN.half.y)).toBe(true);
    expect(sim.staticCircles()).toEqual([{ center: { x: 20, y: 40 }, radius: 0.6 }]);
  });

  it('index re-exports the public surface', () => {
    expect(typeof SimIndex.Simulation).toBe('function');
    expect(SimIndex.DEFAULT_RULES.matchTicks).toBe(14400);
    expect(SimIndex.EMPTY_COMMAND.grab).toBe(false);
    expect(typeof SimIndex.obbInsideOBB).toBe('function');
  });
});

describe('rule merging (MatchSetup.rules)', () => {
  it('present-but-undefined keys keep the defaults', () => {
    const sim = makeSim(openLayout(), [0], { matchTicks: undefined, recoveryTicks: undefined, timeLimit: undefined });
    // Content 2.0: `content` is resolved per layout (no layout.v2 -> 'classic') and always set
    expect(sim.rules).toEqual({ ...DEFAULT_RULES, content: 'classic' });
    expect(sim.state.endTick).toBe(DEFAULT_RULES.matchTicks);
    const practice = makeSim(openLayout(), [0], { timeLimit: false, earlyDecision: undefined });
    expect(practice.rules).toEqual({ ...DEFAULT_RULES, timeLimit: false, content: 'classic' });
    expect(practice.state.endTick).toBe(Infinity);
  });

  it('invalid values fail loudly at match creation', () => {
    expect(() => makeSim(openLayout(), [0], { matchTicks: 0 })).toThrow(/matchTicks/);
    expect(() => makeSim(openLayout(), [0], { recoveryTicks: 1.5 })).toThrow(/recoveryTicks/);
    expect(() => makeSim(openLayout(), [0], { finalCountdownTicks: -1 })).toThrow(/finalCountdownTicks/);
    expect(() => makeSim(openLayout(), [0], { matchTicks: NaN })).toThrow(/matchTicks/);
    expect(() => makeSim(openLayout(), [0], { timeLimit: 'no' as unknown as boolean })).toThrow(/timeLimit/);
    expect(() => makeSim(openLayout(), [0], { finalCountdownTicks: 0, recoveryTicks: 1 })).not.toThrow();
    // Content 2.0 switches
    expect(() => makeSim(openLayout(), [0], { content: 'v2' })).toThrow(/layout\.v2/);
    expect(() => makeSim(openLayout(), [0], { content: 'v3' as unknown as 'v2' })).toThrow(/content/);
    expect(() => makeSim(openLayout(), [0], { items: 'some' as unknown as 'on' })).toThrow(/items/);
    expect(() => makeSim(openLayout(), [0], { events: true as unknown as 'on' })).toThrow(/events/);
    expect(() => makeSim(openLayout(), [0], { gimmicks: 'yes' as unknown as boolean })).toThrow(/gimmicks/);
  });
});

describe('robustness guards', () => {
  it('NaN guard restores the last valid pose', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'smallSafe', pos: { x: 30, y: 30 }, angle: 0 }] }), [0]);
    run(sim, 5, [cmd(1, 0)]);
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const p = { ...sim.state.characters[0]!.pos };
    ctx.chars[0]!.body.vx = NaN;
    sim.debug.setAnchored(sim.state.loot[0]!.id, false);
    ctx.loot[0]!.body.w = Infinity;
    sim.step([cmd(1, 0)]);
    const c = sim.state.characters[0]!;
    expect(Number.isFinite(c.pos.x) && Number.isFinite(c.vel.x)).toBe(true);
    expect(Math.abs(c.pos.x - p.x)).toBeLessThan(0.2);
    const l = sim.state.loot[0]!;
    expect(Number.isFinite(l.angle) && Number.isFinite(l.angVel)).toBe(true);
    run(sim, 30, [cmd(1, 0)]);
    expect(Number.isFinite(sim.state.characters[0]!.pos.x)).toBe(true);
  });

  it('everything is clamped inside the arena', () => {
    const sim = makeSim(openLayout(), [0]);
    sim.debug.teleport(1, { x: -5, y: 70 });
    sim.step([cmd(-1, 1)]);
    const p = sim.state.characters[0]!.pos;
    expect(p.x).toBeGreaterThanOrEqual(CHARACTER.radius - 1e-9);
    expect(p.y).toBeLessThanOrEqual(60 - CHARACTER.radius + 1e-9);
    expect(() => sim.debug.teleport(1, { x: NaN, y: 0 })).toThrow();
  });

  it('anti-pin also frees a safe jammed into a building', () => {
    const sim = makeSim(
      openLayout({
        safes: [{ kind: 'largeSafe', pos: { x: 30, y: 50 }, angle: 0 }],
        statics: [{ id: 'block', kind: 'building', center: { x: 50, y: 30 }, half: { x: 3, y: 3 }, angle: 0, height: 6 }],
      }),
      [0],
    );
    const id = sim.state.loot[0]!.id;
    sim.debug.setAnchored(id, false);
    sim.debug.teleport(id, { x: 50, y: 30 });
    const ev = run(sim, 60, [cmd()]);
    expect(ev.find((e) => e.type === 'unstuck')).toMatchObject({ entityId: id });
    expect(sim.lootOBB(id).center.x === 50 && sim.lootOBB(id).center.y === 30).toBe(false);
  });

  it('bump events report hard impacts (bId 0 = world static), rate-limited per pair', () => {
    const sim = makeSim(
      openLayout({ statics: [{ id: 'w', kind: 'wall', center: { x: 33, y: 30 }, half: { x: 0.2, y: 3 }, angle: 0, height: 2 }] }),
      [0],
    );
    sim.debug.teleport(1, { x: 31, y: 30 }, 0);
    const ev = run(sim, 30, (t) => [cmd(1, 0, false, t === 0)]);
    const bumps = ev.filter((e) => e.type === 'bump');
    expect(bumps.length).toBe(1);
    expect(bumps[0]).toMatchObject({ aId: 1, bId: 0 });
    expect((bumps[0] as { impulse: number }).impulse).toBeGreaterThan(100);
  });

  it('safeUnloaded reports the team carrying the bank (내용물 탈취 for results)', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 40, y: 30 }, angle: 0 }] }), [0, 1]);
    const bank = sim.state.loot[0]!.id;
    const large = sim.getLoot(bank)!.loadedSafes[0]!;
    sim.debug.setAnchored(bank, false);
    sim.debug.teleport(1, { x: 44.55, y: 30 }, Math.PI);
    sim.step([cmd(0, 0, true, false, { x: -1, y: 0 }), cmd()]);
    run(sim, 30, [cmd(1, 0, true), cmd()]);
    sim.debug.setAnchored(large, false);
    sim.debug.teleport(large, bankLocal(sim, bank, 0, 6));
    const ev = run(sim, 1, [cmd(1, 0, true), cmd()]);
    expect(ev.find((e) => e.type === 'safeUnloaded')).toMatchObject({ safeId: large, bankValue: 700, bankCarrierTeam: 0, byCharId: null });
  });

  it('teleporting a bank carries its riders and keeps welded safes welded', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 40, y: 30 }, angle: 0 }] }), [0]);
    const bank = sim.state.loot[0]!.id;
    sim.debug.teleport(1, bankLocal(sim, bank, 1, 1));
    sim.debug.teleport(bank, { x: 60, y: 20 }, Math.PI / 2);
    const c = sim.state.characters[0]!.pos;
    const expected = bankLocal(sim, bank, 1, 1);
    expect(c.x).toBeCloseTo(expected.x, 6);
    expect(c.y).toBeCloseTo(expected.y, 6);
    for (const sid of sim.getLoot(bank)!.loadedSafes) expect(sim.isOnBankFloor(sim.getLoot(sid)!.pos, bank)).toBe(true);
    const ev = sim.step([cmd()]);
    expect(ev.some((e) => e.type === 'safeUnloaded')).toBe(false);
    expect(sim.getLoot(bank)!.estimatedValue).toBe(1000);
  });
});
