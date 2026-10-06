/**
 * Movement / physics contract tests (doc §4, §5, config.ts movement model).
 */
import { describe, expect, it } from 'vitest';
import { BANK_MODEL, CHARACTER, UNANCHOR_TICKS } from '../../src/sim/config';
import type { SafeKind, SimEvent } from '../../src/sim/types';
import { bankLocal, cmd, invariantHolds, makeSim, openLayout, run, steer, toBankLocal } from './fixtures/layouts';

const W = { x: -1, y: 0 };

function within(actual: number, target: number, tol = 0.15): void {
  expect(actual).toBeGreaterThan(target * (1 - tol));
  expect(actual).toBeLessThan(target * (1 + tol));
}

/** Terminal speed of a free safe pulled east by `holders` characters (grabbing its east face). */
function safeCarrySpeed(kind: SafeKind, holders: number): number {
  const sim = makeSim(openLayout({ safes: [{ kind, pos: { x: 30, y: 30 }, angle: 0 }] }), [0, 0]);
  const id = sim.state.loot[0]!.id;
  sim.debug.setAnchored(id, false);
  const hx = kind === 'smallSafe' ? 0.4 : 0.7;
  const ys = holders === 1 ? [30] : [29.75, 30.25];
  ys.forEach((y, i) => sim.debug.teleport(i + 1, { x: 30 + hx + 0.55, y }, Math.PI));
  sim.step([cmd(0, 0, true, false, W), cmd(0, 0, holders === 2, false, W)]);
  expect(sim.getLoot(id)!.grabbedBy.length).toBe(holders);
  run(sim, 480, [cmd(1, 0, true), cmd(1, 0, holders === 2)]);
  const l = sim.getLoot(id)!;
  return Math.hypot(l.vel.x, l.vel.y);
}

/** Terminal speed of a free bank pulled east by `holders` on its east wall. */
function bankCarrySpeed(holders: number, full: boolean): number {
  const sim = makeSim(openLayout({ banks: [{ pos: { x: 30, y: 30 }, angle: 0 }] }), [0, 0]);
  const bank = sim.state.loot[0]!.id;
  sim.debug.setAnchored(bank, false);
  if (!full) for (const l of sim.state.loot) if (l.kind !== 'bank') sim.debug.teleport(l.id, { x: 10 + l.id * 2, y: 55 });
  const ys = holders === 1 ? [30] : [29, 31];
  ys.forEach((y, i) => sim.debug.teleport(i + 1, { x: 34.55, y }, Math.PI));
  sim.step([cmd(0, 0, true, false, W), cmd(0, 0, holders === 2, false, W)]);
  expect(sim.getLoot(bank)!.grabbedBy.length).toBe(holders);
  run(sim, 720, [cmd(1, 0, true), cmd(1, 0, holders === 2)]);
  const l = sim.getLoot(bank)!;
  expect(l.estimatedValue).toBe(full ? 1000 : 500);
  return Math.hypot(l.vel.x, l.vel.y);
}

describe('carry terminal speeds (config.ts targets, +-15%)', () => {
  const measured: Record<string, number> = {};
  it('free walk ~5 m/s', () => {
    const sim = makeSim(openLayout(), [0]);
    run(sim, 180, [cmd(1, 0)]);
    const v = Math.hypot(sim.state.characters[0]!.vel.x, sim.state.characters[0]!.vel.y);
    measured.walk = v;
    within(v, CHARACTER.walkSpeed, 0.05);
  });
  it('small safe x1 ~4.0', () => within((measured.small1 = safeCarrySpeed('smallSafe', 1)), 4.0));
  it('large safe x1 ~2.8', () => within((measured.large1 = safeCarrySpeed('largeSafe', 1)), 2.8));
  it('large safe x2 ~3.6', () => within((measured.large2 = safeCarrySpeed('largeSafe', 2)), 3.6));
  it('empty bank x1 ~1.1', () => within((measured.bank1 = bankCarrySpeed(1, false)), 1.1));
  it('empty bank x2 ~1.8', () => within((measured.bank2 = bankCarrySpeed(2, false)), 1.8));
  it('1000-pt bank x1 ~0.95', () => within((measured.full1 = bankCarrySpeed(1, true)), 0.95));
  it('1000-pt bank x2 ~1.65', () => within((measured.full2 = bankCarrySpeed(2, true)), 1.65));
  it('doc §5: one raccoon moves everything, two on a bank is better, solo small stays fastest', () => {
    expect(measured.full1).toBeGreaterThan(0.5);
    expect(measured.bank2).toBeGreaterThan(measured.bank1! * 1.4);
    expect(measured.small1).toBeGreaterThan(measured.large1!);
    // eslint-disable-next-line no-console
    console.log('[measured carry speeds m/s]', Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, +v.toFixed(3)])));
  });
});

describe('unanchoring (doc §5: small 1 s, large 2 s, bank 3 s; 2 holders faster)', () => {
  function unanchorTicks(kind: 'smallSafe' | 'largeSafe' | 'bank', holders: number): number {
    const layout =
      kind === 'bank'
        ? openLayout({ banks: [{ pos: { x: 30, y: 30 }, angle: 0 }] })
        : openLayout({ safes: [{ kind, pos: { x: 30, y: 30 }, angle: 0 }] });
    const sim = makeSim(layout, [0, 1]);
    const id = sim.state.loot[0]!.id;
    const face = kind === 'bank' ? BANK_MODEL.half.x : kind === 'smallSafe' ? 0.4 : 0.7;
    const ys = holders === 1 ? [30] : [29.7, 30.3];
    ys.forEach((y, i) => sim.debug.teleport(i + 1, { x: 30 + face + 0.6, y }, Math.PI));
    const both = holders === 2;
    let first = -1;
    let done = -1;
    for (let t = 0; t < 400 && done < 0; t++) {
      const ev = sim.step([cmd(1, 0, true, false, W), cmd(both ? 1 : 0, 0, both, false, W)]);
      if (first < 0 && ev.some((e) => e.type === 'grab')) first = sim.state.tick;
      const u = ev.find((e) => e.type === 'unanchored');
      if (u && u.type === 'unanchored') {
        done = sim.state.tick;
        expect(u.lootId).toBe(id);
        // mixed teams pulling together -> byTeam null; single team -> that team
        expect(u.byTeam).toBe(both ? null : 0);
      }
      if (t < 5) expect(sim.state.characters[0]!.straining || done > 0).toBe(true);
    }
    expect(first).toBeGreaterThan(0);
    expect(done).toBeGreaterThan(0);
    expect(sim.getLoot(id)!.anchored).toBe(false);
    expect(sim.getLoot(id)!.unanchorProgress).toBe(1);
    return done - first + 1;
  }

  it('small safe 1 s', () => expect(unanchorTicks('smallSafe', 1)).toBe(UNANCHOR_TICKS.smallSafe));
  it('large safe 2 s', () => expect(unanchorTicks('largeSafe', 1)).toBe(UNANCHOR_TICKS.largeSafe));
  it('bank 3 s', () => expect(unanchorTicks('bank', 1)).toBe(UNANCHOR_TICKS.bank));
  it('two holders are twice as fast', () => {
    expect(unanchorTicks('largeSafe', 2)).toBe(UNANCHOR_TICKS.largeSafe / 2);
    expect(unanchorTicks('bank', 2)).toBe(UNANCHOR_TICKS.bank / 2);
  });

  it('progress persists across releases; |move| < 0.5 does not strain; anchored items do not move', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'largeSafe', pos: { x: 30, y: 30 }, angle: 0 }] }), [0]);
    const id = sim.state.loot[0]!.id;
    sim.debug.teleport(1, { x: 31.3, y: 30 }, Math.PI);
    run(sim, 60, [cmd(1, 0, true, false, W)]);
    expect(sim.getLoot(id)!.unanchorProgress).toBeCloseTo(60 / UNANCHOR_TICKS.largeSafe, 6);
    expect(sim.getLoot(id)!.pos).toEqual({ x: 30, y: 30 });
    run(sim, 5, [cmd()]); // release
    expect(sim.state.characters[0]!.grab).toBeNull();
    run(sim, 30, [cmd(0.3, 0, true, false, W)]); // weak pull: holding but not straining
    expect(sim.state.characters[0]!.grab).not.toBeNull();
    expect(sim.state.characters[0]!.straining).toBe(false);
    expect(sim.getLoot(id)!.unanchorProgress).toBeCloseTo(0.5, 6);
    const ev = run(sim, 60, [cmd(1, 0, true)]);
    expect(ev.filter((e) => e.type === 'unanchored').length).toBe(1);
    expect(sim.getLoot(id)!.anchored).toBe(false);
  });
});

describe('moving floor (doc §5 움직이는 바닥과 실내 탈취)', () => {
  it('a dragged bank carries a character inside and its loaded safes', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 30, y: 30 }, angle: 0 }] }), [0, 0, 1]);
    const bank = sim.state.loot[0]!.id;
    const [large, small1, small2] = sim.state.loot[0]!.loadedSafes;
    sim.debug.setAnchored(bank, false);
    sim.debug.setAnchored(small1!, false); // free but loaded safe: rides by floor carry, not weld
    sim.debug.teleport(1, { x: 34.55, y: 29 }, Math.PI);
    sim.debug.teleport(2, { x: 34.55, y: 31 }, Math.PI);
    sim.debug.teleport(3, { x: 31.4, y: 31.6 }); // rider (idle) inside, beside the central large safe
    sim.step([cmd(0, 0, true, false, W), cmd(0, 0, true, false, W), cmd()]);
    const rider0 = toBankLocal(sim, bank, sim.state.characters[2]!.pos);
    const s1Local0 = toBankLocal(sim, bank, sim.getLoot(small1!)!.pos);
    const largeLocal0 = toBankLocal(sim, bank, sim.getLoot(large!)!.pos);
    const start = { ...sim.getLoot(bank)!.pos };
    const ev = run(sim, 360, [cmd(1, 0.15, true), cmd(1, 0.15, true), cmd()]);
    const b = sim.getLoot(bank)!;
    expect(b.pos.x - start.x).toBeGreaterThan(5); // moved several meters
    expect(sim.state.characters[2]!.floorOf).toBe(bank);
    const rider1 = toBankLocal(sim, bank, sim.state.characters[2]!.pos);
    expect(Math.hypot(rider1.x - rider0.x, rider1.y - rider0.y)).toBeLessThan(0.3);
    const s1Local1 = toBankLocal(sim, bank, sim.getLoot(small1!)!.pos);
    expect(Math.hypot(s1Local1.x - s1Local0.x, s1Local1.y - s1Local0.y)).toBeLessThan(0.3);
    const largeLocal1 = toBankLocal(sim, bank, sim.getLoot(large!)!.pos);
    expect(Math.hypot(largeLocal1.x - largeLocal0.x, largeLocal1.y - largeLocal0.y)).toBeLessThan(1e-6);
    expect(b.loadedSafes).toEqual([large, small1, small2]);
    expect(b.estimatedValue).toBe(1000);
    expect(ev.some((e) => e.type === 'safeUnloaded')).toBe(false);
    expect(sim.getLoot(small1!)!.loadedIn).toBe(bank);
    expect(invariantHolds(sim)).toBe(true);
  });

  it('extracting the large safe through a door: 1000 -> 700 + safeUnloaded; pulling it back in restores 1000', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 50, y: 30 }, angle: 0 }] }), [0, 1]);
    const bank = sim.state.loot[0]!.id;
    const large = sim.state.loot.find((l) => l.kind === 'largeSafe')!.id;
    // free the interior large safe and stand outside the front door (+y), facing in
    sim.debug.setAnchored(large, false);
    sim.debug.teleport(large, bankLocal(sim, bank, 0, 1.4), 0);
    sim.debug.teleport(1, bankLocal(sim, bank, 0, 3.1), -Math.PI / 2);
    run(sim, 2, [cmd(0, 0, false, false, { x: 0, y: -1 }), cmd()]);
    expect(sim.getLoot(bank)!.estimatedValue).toBe(1000);
    expect(sim.getGrabCandidate(1)?.targetId).toBe(large);
    const events: SimEvent[] = [];
    events.push(...sim.step([cmd(0, 0, true, false, { x: 0, y: -1 }), cmd()]));
    expect(sim.state.characters[0]!.grab?.targetId).toBe(large);
    events.push(...run(sim, 240, [cmd(0, 1, true), cmd()]));
    const unl = events.find((e) => e.type === 'safeUnloaded');
    expect(unl).toBeDefined();
    if (unl?.type === 'safeUnloaded') {
      expect(unl.safeId).toBe(large);
      expect(unl.bankId).toBe(bank);
      expect(unl.bankValue).toBe(700);
      expect(unl.byCharId).toBe(1);
      expect(unl.bankCarrierTeam).toBeNull();
    }
    const l = sim.getLoot(large)!;
    expect(l.loadedIn).toBeNull();
    expect(l.estimatedValue).toBe(300);
    expect(sim.getLoot(bank)!.estimatedValue).toBe(700);
    expect(sim.getLoot(bank)!.loadedSafes).not.toContain(large);
    expect(sim.state.scores).toEqual([0, 0]);
    // the safe is completely outside the bank now (it passed the 2.2 m door)
    expect(toBankLocal(sim, bank, l.pos).y).toBeGreaterThan(3.0 + 0.5);

    // opponent pulls it back in from the doorway side
    run(sim, 3, [cmd(), cmd()]);
    const sp = sim.getLoot(large)!.pos;
    sim.debug.teleport(2, { x: sp.x, y: sp.y - 1.3 }, Math.PI / 2);
    run(sim, 2, [cmd(0, 1), cmd(0, 0, false, false, { x: 0, y: 1 })]);
    expect(sim.getGrabCandidate(2)?.targetId).toBe(large);
    const back = sim.step([cmd(0, 1), cmd(0, 0, true, false, { x: 0, y: 1 })]);
    expect(sim.state.characters[1]!.grab?.targetId).toBe(large);
    back.push(...run(sim, 300, [cmd(0, 1), cmd(0, -1, true)]));
    const ld = back.find((e) => e.type === 'safeLoaded');
    expect(ld).toBeDefined();
    if (ld?.type === 'safeLoaded') expect(ld.bankValue).toBe(1000);
    expect(sim.getLoot(large)!.loadedIn).toBe(bank);
    expect(sim.getLoot(bank)!.estimatedValue).toBe(1000);
    expect(invariantHolds(sim)).toBe(true);
  });

  it('characters inside collide with the inner faces of the side walls', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 50, y: 30 }, angle: 0 }] }), [0]);
    sim.debug.teleport(1, { x: 50, y: 30 });
    run(sim, 240, [cmd(1, 0)]); // walk east into the solid side wall
    const p = toBankLocal(sim, sim.state.loot[0]!.id, sim.state.characters[0]!.pos);
    expect(p.x).toBeLessThan(BANK_MODEL.floorHalf.x - CHARACTER.radius + 0.02);
    expect(sim.state.characters[0]!.floorOf).toBe(sim.state.loot[0]!.id);
    // ...and leave through the front door
    const door = bankLocal(sim, sim.state.loot[0]!.id, 0, 2.0);
    const out = bankLocal(sim, sim.state.loot[0]!.id, 0, 5);
    run(sim, 120, () => [steer(sim, 0, door)]);
    run(sim, 120, () => [steer(sim, 0, out)]);
    const q = toBankLocal(sim, sim.state.loot[0]!.id, sim.state.characters[0]!.pos);
    expect(q.y).toBeGreaterThan(BANK_MODEL.half.y + CHARACTER.radius - 0.05);
    expect(sim.state.characters[0]!.floorOf).toBeNull();
  });
});

describe('riders cannot propel their own bank (doc §4 의도와 다른 대상을 움직이지 않는다)', () => {
  function push(inside: boolean, n: number) {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 30, y: 30 }, angle: 0 }] }), Array(n).fill(0));
    const bank = sim.state.loot[0]!.id;
    sim.debug.setAnchored(bank, false);
    for (let i = 0; i < n; i++) sim.debug.teleport(i + 1, inside ? { x: 31.5, y: 29.4 + i * 1.2 } : { x: 25.4, y: 29.4 + i * 1.2 }, 0);
    run(sim, 600, Array(n).fill(cmd(1, 0)));
    return { dx: sim.getLoot(bank)!.pos.x - 30, floors: sim.state.characters.map((c) => c.floorOf), bank };
  }

  it('walking into the inner wall moves nothing; the same push from outside does', () => {
    for (const n of [1, 2]) {
      const inside = push(true, n);
      expect(Math.abs(inside.dx)).toBeLessThan(1e-6);
      expect(inside.floors.every((f) => f === inside.bank)).toBe(true);
      expect(push(false, n).dx).toBeGreaterThan(0.5);
    }
  });

  it('a rider shoving a loaded safe into the wall or dashing into it does not move the bank', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 30, y: 30 }, angle: 0 }] }), [0]);
    const bank = sim.state.loot[0]!.id;
    sim.debug.setAnchored(bank, false);
    for (const sid of sim.getLoot(bank)!.loadedSafes) sim.debug.setAnchored(sid, false);
    sim.debug.teleport(1, { x: 27, y: 30 }, 0);
    run(sim, 300, (t) => [cmd(1, 0, false, t % 60 === 0, { x: 1, y: 0 })]);
    const b = sim.getLoot(bank)!;
    expect(Math.hypot(b.pos.x - 30, b.pos.y - 30)).toBeLessThan(1e-6);
    expect(sim.state.characters[0]!.floorOf).toBe(bank);
  });
});

describe('narrow passages and fences', () => {
  /** Two wall blocks along x = 60 leaving a gap of `gap` meters centered at y = 30. */
  function gapLayout(gap: number) {
    const h = (60 - gap) / 4;
    return openLayout({
      banks: [{ pos: { x: 48, y: 30 }, angle: 0 }],
      safes: [{ kind: 'largeSafe', pos: { x: 54, y: 30 }, angle: 0 }],
      statics: [
        { id: 'w.n', kind: 'wall', center: { x: 60, y: 30 - gap / 2 - h }, half: { x: 0.1, y: h }, angle: 0, height: 2 },
        { id: 'w.s', kind: 'wall', center: { x: 60, y: 30 + gap / 2 + h }, half: { x: 0.1, y: h }, angle: 0, height: 2 },
      ],
    });
  }

  it('a bank cannot pass a 3 m gap; a large safe can', () => {
    const sim = makeSim(gapLayout(3), [0, 0]);
    const bank = sim.state.loot[0]!.id;
    const safe = sim.state.loot.find((l) => l.kind === 'largeSafe' && l.homeBank === null)!.id;
    sim.debug.setAnchored(bank, false);
    sim.debug.teleport(safe, { x: 20, y: 50 });
    sim.debug.teleport(1, { x: 52.55, y: 29 }, Math.PI);
    sim.debug.teleport(2, { x: 52.55, y: 31 }, Math.PI);
    sim.step([cmd(0, 0, true, false, W), cmd(0, 0, true, false, W)]);
    let maxX = -Infinity;
    for (let t = 0; t < 900; t++) {
      sim.step([cmd(1, 0, true), cmd(1, 0, true)]);
      const corners = sim.lootOBB(bank);
      const ext = Math.abs(Math.cos(corners.angle)) * 4 + Math.abs(Math.sin(corners.angle)) * 3;
      maxX = Math.max(maxX, corners.center.x + ext);
    }
    expect(maxX).toBeLessThan(60.15);
    expect(sim.getLoot(bank)!.pos.x).toBeLessThan(57);

    // large safe through the same gap
    const sim2 = makeSim(gapLayout(3), [0]);
    const s2 = sim2.state.loot.find((l) => l.kind === 'largeSafe' && l.homeBank === null)!.id;
    sim2.debug.teleport(sim2.state.loot[0]!.id, { x: 20, y: 10 });
    sim2.debug.setAnchored(s2, false);
    sim2.debug.teleport(1, { x: 55.25, y: 30 }, Math.PI);
    sim2.step([cmd(0, 0, true, false, W)]);
    expect(sim2.state.characters[0]!.grab?.targetId).toBe(s2);
    run(sim2, 480, [cmd(1, 0, true)]);
    expect(sim2.getLoot(s2)!.pos.x).toBeGreaterThan(62);
  });

  it('fences: characters and safes never break them; an unanchored moving bank does', () => {
    const layout = openLayout({
      banks: [{ pos: { x: 40, y: 30 }, angle: 0 }],
      safes: [{ kind: 'largeSafe', pos: { x: 60, y: 15 }, angle: 0 }],
      fences: [{ id: 'f1', center: { x: 50, y: 30 }, half: { x: 4, y: 0.1 }, angle: Math.PI / 2 }],
    });
    const sim = makeSim(layout, [0, 0]);
    const bank = sim.state.loot[0]!.id;
    // a dash into the fence
    sim.debug.teleport(1, { x: 47.5, y: 30 }, 0);
    run(sim, 30, [cmd(1, 0, false, true), cmd()]);
    expect(sim.state.characters[0]!.pos.x).toBeLessThan(50);
    expect(sim.state.fences[0]!.broken).toBe(false);
    // a safe dragged/pushed into it hard
    const safe = sim.state.loot.find((l) => l.kind === 'largeSafe' && l.homeBank === null)!.id;
    sim.debug.setAnchored(safe, false);
    sim.debug.teleport(safe, { x: 48, y: 30 });
    sim.debug.setVelocity(safe, { x: 5, y: 0 });
    sim.debug.teleport(1, { x: 46.5, y: 30 }, 0);
    run(sim, 120, [cmd(1, 0), cmd()]);
    expect(sim.state.fences[0]!.broken).toBe(false);
    expect(sim.getLoot(safe)!.pos.x).toBeLessThan(50);
    sim.debug.teleport(safe, { x: 70, y: 50 });
    // an anchored bank never breaks it either (even if shoved)
    run(sim, 10, [cmd(), cmd()]);
    expect(sim.state.fences[0]!.broken).toBe(false);
    // now drag the bank into it
    sim.debug.setAnchored(bank, false);
    sim.debug.teleport(1, { x: 35.45, y: 29 }, 0);
    sim.debug.teleport(2, { x: 35.45, y: 31 }, 0);
    sim.step([cmd(0, 0, true, false, { x: 1, y: 0 }), cmd(0, 0, true, false, { x: 1, y: 0 })]);
    expect(sim.getLoot(bank)!.grabbedBy).toEqual([1, 2]);
    const ev = run(sim, 600, [cmd(1, 0, true), cmd(1, 0, true)]); // push it east
    const fb = ev.find((e) => e.type === 'fenceBroken');
    expect(fb).toBeDefined();
    if (fb?.type === 'fenceBroken') {
      expect(fb.fenceId).toBe('f1');
      expect(fb.bankId).toBe(bank);
    }
    expect(sim.state.fences[0]!.broken).toBe(true);
    expect(sim.state.fences[0]!.brokenTick).not.toBeNull();
    // broken fences stop colliding: a character walks through the old line
    sim.debug.teleport(1, { x: 50, y: 50 });
    sim.debug.teleport(1, { x: 48, y: 22 });
    run(sim, 120, [cmd(1, 0), cmd()]);
    expect(sim.state.characters[0]!.pos.x).toBeGreaterThan(52);
  });

  it('a slowly pressing bank breaks a fence after FENCE.pressTicks', () => {
    const layout = openLayout({
      banks: [{ pos: { x: 45.85, y: 30 }, angle: 0 }],
      fences: [{ id: 'f1', center: { x: 50, y: 30 }, half: { x: 4, y: 0.1 }, angle: Math.PI / 2 }],
    });
    const sim = makeSim(layout, [0]);
    const bank = sim.state.loot[0]!.id;
    sim.debug.setAnchored(bank, false);
    sim.debug.teleport(1, { x: 41.4, y: 30 }, 0);
    sim.step([cmd(0, 0, true, false, { x: 1, y: 0 })]); // push from the west wall
    const ev = run(sim, 240, [cmd(1, 0, true)]);
    expect(ev.some((e) => e.type === 'fenceBroken')).toBe(true);
  });
});

describe('stability', () => {
  it('a dash at 11 m/s never tunnels through a 0.2 m wall', () => {
    for (let k = 0; k < 12; k++) {
      const ang = -0.6 + (k / 11) * 1.2;
      const sim = makeSim(
        openLayout({ statics: [{ id: 'thin', kind: 'wall', center: { x: 50, y: 30 }, half: { x: 0.1, y: 6 }, angle: 0, height: 2 }] }),
        [0],
      );
      sim.debug.teleport(1, { x: 48.6 - k * 0.1, y: 30 + k * 0.2 }, ang);
      run(sim, 60, [cmd(Math.cos(ang), Math.sin(ang), false, k === 0 || k > 0)]);
      expect(sim.state.characters[0]!.pos.x).toBeLessThan(50 - 0.1 - CHARACTER.radius + 0.03);
    }
  });

  it('heavy bank vs character (mass ratio 20): no explosion, character is pushed not crushed through', () => {
    const sim = makeSim(
      openLayout({
        banks: [{ pos: { x: 40, y: 30 }, angle: 0 }],
        statics: [{ id: 'wall', kind: 'wall', center: { x: 47, y: 30 }, half: { x: 0.2, y: 8 }, angle: 0, height: 2 }],
      }),
      [0, 0, 1],
    );
    const bank = sim.state.loot[0]!.id;
    sim.debug.setAnchored(bank, false);
    sim.debug.teleport(1, { x: 35.45, y: 29 }, 0);
    sim.debug.teleport(2, { x: 35.45, y: 31 }, 0);
    sim.debug.teleport(3, { x: 45.5, y: 30 }); // standing between the bank and the wall
    sim.step([cmd(0, 0, true, false, { x: 1, y: 0 }), cmd(0, 0, true, false, { x: 1, y: 0 }), cmd()]);
    let maxSpeed = 0;
    for (let t = 0; t < 600; t++) {
      sim.step([cmd(1, 0, true), cmd(1, 0, true), cmd()]);
      for (const c of sim.state.characters) {
        expect(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.y)).toBe(true);
        maxSpeed = Math.max(maxSpeed, Math.hypot(c.vel.x, c.vel.y));
      }
      const v = sim.getLoot(bank)!.vel;
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y));
    }
    expect(maxSpeed).toBeLessThan(12);
    // the victim never ends up inside/through the static wall
    expect(sim.state.characters[2]!.pos.x).toBeLessThan(47 - 0.2 - CHARACTER.radius + 0.05);
  });

  it('resting contact does not jitter (character pressing a safe against a wall)', () => {
    const sim = makeSim(
      openLayout({
        safes: [{ kind: 'smallSafe', pos: { x: 48, y: 30 }, angle: 0 }],
        statics: [{ id: 'wall', kind: 'wall', center: { x: 50, y: 30 }, half: { x: 0.2, y: 4 }, angle: 0, height: 2 }],
      }),
      [0],
    );
    const id = sim.state.loot[0]!.id;
    sim.debug.setAnchored(id, false);
    sim.debug.teleport(1, { x: 46.8, y: 30 }, 0);
    run(sim, 180, [cmd(1, 0)]);
    const p0 = { ...sim.getLoot(id)!.pos };
    const c0 = { ...sim.state.characters[0]!.pos };
    let maxV = 0;
    for (let t = 0; t < 120; t++) {
      sim.step([cmd(1, 0)]);
      maxV = Math.max(maxV, Math.hypot(sim.getLoot(id)!.vel.x, sim.getLoot(id)!.vel.y));
    }
    expect(Math.hypot(sim.getLoot(id)!.pos.x - p0.x, sim.getLoot(id)!.pos.y - p0.y)).toBeLessThan(0.01);
    expect(Math.hypot(sim.state.characters[0]!.pos.x - c0.x, sim.state.characters[0]!.pos.y - c0.y)).toBeLessThan(0.01);
    expect(maxV).toBeLessThan(0.05);
    // the safe rests against the wall face without sinking in
    expect(sim.getLoot(id)!.pos.x).toBeGreaterThan(50 - 0.2 - 0.4 - 0.02);
  });

  it('walking into an unanchored bank only soft-pushes it (much slower than dragging)', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 40, y: 30 }, angle: 0 }] }), [0]);
    const bank = sim.state.loot[0]!.id;
    sim.debug.setAnchored(bank, false);
    sim.debug.teleport(1, { x: 35.4, y: 30 });
    run(sim, 300, [cmd(1, 0)]);
    const v = Math.hypot(sim.getLoot(bank)!.vel.x, sim.getLoot(bank)!.vel.y);
    expect(v).toBeGreaterThan(0.05);
    expect(v).toBeLessThan(0.4);
  });

  it('no entity is ever lost: anti-pin moves a deeply stuck character to a free spot', () => {
    const sim = makeSim(
      openLayout({ statics: [{ id: 'block', kind: 'building', center: { x: 50, y: 30 }, half: { x: 2, y: 2 }, angle: 0, height: 6 }] }),
      [0],
    );
    // jam the character deep into a building (as if squeezed there by a bank)
    sim.debug.teleport(1, { x: 50, y: 30 });
    const ev = run(sim, 40, [cmd()]);
    const u = ev.find((e) => e.type === 'unstuck');
    expect(u).toBeDefined();
    const p = sim.state.characters[0]!.pos;
    expect(sim.isFree(p, CHARACTER.radius)).toBe(true);
  });
});

describe('player-visible state', () => {
  it('facing follows move, aim overrides, and points at the anchor while holding', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'smallSafe', pos: { x: 30, y: 30 }, angle: 0 }] }), [0]);
    sim.step([cmd(0, 1)]);
    expect(sim.state.characters[0]!.facing).toBeCloseTo(Math.PI / 2);
    sim.step([cmd(0, 1, false, false, { x: -1, y: 0 })]);
    expect(Math.abs(sim.state.characters[0]!.facing)).toBeCloseTo(Math.PI);
    sim.debug.teleport(1, { x: 30, y: 31.1 }, -Math.PI / 2);
    sim.step([cmd(0, 0, true)]);
    expect(sim.state.characters[0]!.grab?.targetId).toBe(sim.state.loot[0]!.id);
    run(sim, 5, [cmd(1, 0, true)]);
    const ch = sim.state.characters[0]!;
    const l = sim.state.loot[0]!;
    const c = Math.cos(l.angle);
    const s = Math.sin(l.angle);
    const ax = l.pos.x + ch.grab!.anchorLocal.x * c - ch.grab!.anchorLocal.y * s;
    const ay = l.pos.y + ch.grab!.anchorLocal.x * s + ch.grab!.anchorLocal.y * c;
    const expected = Math.atan2(ay - ch.pos.y, ax - ch.pos.x);
    sim.step([cmd(1, 0, true)]);
    expect(Math.abs(Math.atan2(Math.sin(ch.facing - expected), Math.cos(ch.facing - expected)))).toBeLessThan(0.15);
    expect(ch.moveIntent).toEqual({ x: 1, y: 0 });
  });

  it('commands are sanitised: NaN / oversized input is clamped', () => {
    const sim = makeSim(openLayout(), [0]);
    sim.step([{ move: { x: NaN, y: 5 }, grab: false, dash: false }]);
    expect(sim.state.characters[0]!.moveIntent).toEqual({ x: 0, y: 1 });
    run(sim, 120, [{ move: { x: 100, y: 0 }, grab: false, dash: false }]);
    expect(Math.hypot(sim.state.characters[0]!.vel.x, sim.state.characters[0]!.vel.y)).toBeLessThan(5.1);
  });
});

describe('end-to-end heist (no debug moves after setup)', () => {
  it('two raccoons unanchor a 1000-pt bank, drag it home with a rider inside, recover 1000 and eject the rider', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 40, y: 30 }, angle: 0 }] }), [0, 0, 1]);
    const bank = sim.state.loot[0]!.id;
    sim.debug.teleport(1, { x: 35.4, y: 28.8 }, 0);
    sim.debug.teleport(2, { x: 35.4, y: 31.2 }, 0);
    sim.debug.teleport(3, bankLocal(sim, bank, 1, 0)); // opponent loitering inside
    const ev: SimEvent[] = [];
    ev.push(...sim.step([cmd(0, 0, true, false, { x: 1, y: 0 }), cmd(0, 0, true, false, { x: 1, y: 0 }), cmd()]));
    expect(sim.getLoot(bank)!.grabbedBy).toEqual([1, 2]);
    for (let t = 0; t < 2400 && !sim.getLoot(bank)!.recovered; t++) {
      const b = sim.getLoot(bank)!;
      const pull = b.pos.x > 10.2 ? cmd(-1, (30 - b.pos.y) * 0.5, true) : cmd(0, 0, true);
      ev.push(...sim.step([pull, pull, cmd()]));
    }
    expect(ev.find((e) => e.type === 'unanchored')).toMatchObject({ lootId: bank, kind: 'bank', byTeam: 0 });
    const rec = ev.find((e) => e.type === 'recovered');
    expect(rec).toMatchObject({ lootId: bank, team: 0, value: 1000, safesValue: 500, holders: [1, 2] });
    expect(ev.find((e) => e.type === 'bankBodyRecovered')).toMatchObject({ count: 1 });
    expect(ev.find((e) => e.type === 'ejected')).toMatchObject({ charId: 3 });
    expect(sim.state.scores).toEqual([1000, 0]);
    expect(ev.filter((e) => e.type === 'release' && e.forced).length).toBe(0);
    expect(sim.state.characters.every((c) => c.grab === null)).toBe(true);
    expect(invariantHolds(sim)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[heist] 1000-pt bank recovered at tick ${(rec as { tick: number }).tick} (~${((rec as { tick: number }).tick / 60).toFixed(1)} s incl. 3 s/2 unanchor + 1.5 s dwell)`);
  });
});

describe('pushing (doc §4 "원하는 방향으로 끌거나 밀기")', () => {
  it('pushing a safe straight ahead is stable and as fast as pulling', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'largeSafe', pos: { x: 30, y: 30 }, angle: 0 }] }), [0]);
    const id = sim.state.loot[0]!.id;
    sim.debug.setAnchored(id, false);
    sim.debug.teleport(1, { x: 28.75, y: 30.3 }, 0); // slightly off-center grip
    sim.step([cmd(0, 0, true, false, { x: 1, y: 0 })]);
    run(sim, 300, [cmd(1, 0, true)]);
    const l = sim.getLoot(id)!;
    const c = sim.state.characters[0]!;
    expect(l.pos.x).toBeGreaterThan(c.pos.x + 1); // still in front: no jackknife
    expect(Math.abs(Math.atan2(Math.sin(l.angle), Math.cos(l.angle)))).toBeLessThan(0.1);
    within(l.vel.x, 2.8);
  });

  it('pushing steers like a cart: the push line turns toward the stick (safe and bank)', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 40, y: 30 }, angle: 0 }] }), [0]);
    const id = sim.state.loot[0]!.id;
    sim.debug.setAnchored(id, false);
    sim.debug.teleport(1, { x: 35.45, y: 30 }, 0);
    sim.step([cmd(0, 0, true, false, { x: 1, y: 0 })]);
    run(sim, 240, [cmd(1, 0, true)]);
    run(sim, 480, [cmd(Math.SQRT1_2, Math.SQRT1_2, true)]);
    const b = sim.getLoot(id)!;
    expect(b.angle).toBeGreaterThan(Math.PI / 4 - 0.1);
    expect(b.angle).toBeLessThan(Math.PI / 4 + 0.1);
    expect(b.vel.x).toBeGreaterThan(0.3);
    expect(b.vel.y).toBeGreaterThan(0.3);
    expect(sim.state.characters[0]!.grab?.targetId).toBe(id);
  });
});
