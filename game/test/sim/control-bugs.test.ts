/**
 * Regression tests for the owner's control bug report: "the character suddenly speeds up, buildings
 * get dragged at very high speed, and while dragging the movement direction veers".
 *
 * Every case here failed before its fix (numbers in the comments are the measured "before"):
 *   1. holder-vs-own-load contact was a one-sided soft push while the grab joint between the same
 *      two bodies is two-sided: the pair created momentum every substep (runaway loads/holders);
 *   2. the grip bearing's reaction acted at the anchor, 0.55 m off its action line: a free couple
 *      that spun a load held by two shoulder-to-shoulder holders forever;
 *   3. the 80 degree push cone had no hysteresis and redirected the whole drive toward the anchor
 *      at its edge: a 2 degree stick change reversed the sideways drag;
 *   4. bank push steering was a pure torque about the centre: the pusher at the 4 m lever swung
 *      against the stick for seconds (now a cart: wheel at the push point, capped swing);
 *   5. a pulled bank swung ~3x more across than along (no yaw grip): the hauler veered 20-28 deg;
 *   6. the push drive aimed at the instantaneous holder->anchor vector, not the grip's handle line:
 *      two pushers on one face drifted 15 degrees off the stick forever;
 *   7. a grab landing during a dash kept the 11 m/s no-drag burst running and yanked the load;
 *   8. a pushed bank (the bug 4 cart) kept running along its face's old normal after the stick
 *      turned: the pusher went 40-50 deg off the stick while the bank turned at ~6 deg/s (now the
 *      bank travels where the stick points, its face swings round and the grip slides along it).
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER } from '../../src/sim/config';
import type { Simulation } from '../../src/sim/sim';
import type { LayoutDef, SafeKind } from '../../src/sim/types';
import { cmd, makeSim, openLayout } from './fixtures/layouts';

const W = { x: -1, y: 0 };
const D = 180 / Math.PI;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function lootSpeed(sim: Simulation, id: number): number {
  const l = sim.getLoot(id)!;
  return Math.hypot(l.vel.x, l.vel.y);
}

function maxCharSpeed(sim: Simulation, n: number): number {
  let m = 0;
  for (const c of sim.state.characters.slice(0, n)) m = Math.max(m, Math.hypot(c.vel.x, c.vel.y));
  return m;
}

/** Content 2.0 layout with one v2 prop (moneyTree, piggy, ...) at (50, 30). */
function propLayout(variant: string): LayoutDef {
  const base = openLayout();
  return { ...base, v2: { safes: [], props: [{ variant, pos: { x: 50, y: 30 }, angle: 0 }], breakables: [], gimmicks: [], itemPads: [], eventSpots: [{ x: 50, y: 45 }] } } as LayoutDef;
}

/**
 * Two raccoons grab the same spot of the north face of a load at (50, 30) (half height `hy`), as a
 * human and a bot co-hauler do when both point at the face centre, then pull apart along the face.
 */
function sameFaceTug(sim: Simulation, id: number, hy: number, ticks = 300): { maxLoot: number; maxChar: number; held: number } {
  sim.debug.setAnchored(id, false);
  sim.state.characters.forEach((c, i) => {
    if (i >= 2) sim.debug.teleport(c.id, { x: 10 + i * 3, y: 55 });
  });
  for (const slot of [0, 1]) sim.debug.teleport(slot + 1, { x: 50, y: 30 - hy - 0.5 }, Math.PI / 2);
  sim.step([cmd(0, 0, true), cmd(0, 0, true), cmd(), cmd()]);
  const held = sim.getLoot(id)!.grabbedBy.length;
  let maxLoot = 0;
  let maxChar = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step([cmd(-1, 0, true), cmd(1, 0, true), cmd(), cmd()]);
    maxLoot = Math.max(maxLoot, lootSpeed(sim, id));
    maxChar = Math.max(maxChar, maxCharSpeed(sim, 2));
  }
  return { maxLoot, maxChar, held };
}

/** Free bank at (50, 30) with its safes parked far away. */
function bankSim(teams: (0 | 1)[]): { sim: Simulation; bank: number } {
  const sim = makeSim(openLayout({ banks: [{ pos: { x: 50, y: 30 }, angle: 0 }] }), teams);
  const bank = sim.state.loot[0]!.id;
  sim.debug.setAnchored(bank, false);
  for (const l of sim.state.loot) if (l.kind !== 'bank') sim.debug.teleport(l.id, { x: 5 + l.id * 2, y: 55 });
  return { sim, bank };
}

type Kind = SafeKind | 'bank';
const HALF: Record<Kind, { x: number; y: number }> = { smallSafe: { x: 0.4, y: 0.4 }, largeSafe: { x: 0.7, y: 0.6 }, bank: { x: 4, y: 3 } };

/** One holder (or two, 0.95 m apart) on the east face of a free load at (100, 100), already gripping. */
function eastGrip(kind: Kind, holders: 1 | 2, spacing?: number): { sim: Simulation; id: number } {
  const L =
    kind === 'bank'
      ? openLayout({ size: { x: 200, y: 200 }, banks: [{ pos: { x: 100, y: 100 }, angle: 0 }] })
      : openLayout({ size: { x: 200, y: 200 }, safes: [{ kind, pos: { x: 100, y: 100 }, angle: 0 }] });
  const sim = makeSim(L, holders === 2 ? [0, 0] : [0]);
  const id = sim.state.loot[0]!.id;
  sim.debug.setAnchored(id, false);
  if (kind === 'bank') for (const l of sim.state.loot) if (l.kind !== 'bank') sim.debug.teleport(l.id, { x: 10 + l.id * 2, y: 190 });
  const h = HALF[kind];
  const sp = spacing ?? (kind === 'bank' ? 1.5 : 0.475);
  const ys = holders === 1 ? [100] : [100 - sp, 100 + sp];
  ys.forEach((y, i) => sim.debug.teleport(i + 1, { x: 100 + h.x + 0.55, y }, Math.PI));
  sim.step(holders === 2 ? [cmd(0, 0, true, false, W), cmd(0, 0, true, false, W)] : [cmd(0, 0, true, false, W)]);
  expect(sim.getLoot(id)!.grabbedBy.length).toBe(holders);
  return { sim, id };
}

/**
 * Hold the stick at each heading (degrees) for `secs`; per 0.5 s window (skipping the first window
 * after each change) the angle between the stick and the first holder's displacement.
 */
function headingErrors(sim: Simulation, holders: 1 | 2, degs: number[], secs = 3): { mean: number; max: number; windows: { deg: number; dx: number; dy: number; err: number }[] } {
  let prev = { ...sim.state.characters[0]!.pos };
  const windows: { deg: number; dx: number; dy: number; err: number }[] = [];
  for (const deg of degs) {
    const th = deg / D;
    const c = cmd(Math.round(Math.cos(th) * 1e6) / 1e6, Math.round(Math.sin(th) * 1e6) / 1e6, true);
    for (let t = 1; t <= secs * 60; t++) {
      sim.step(holders === 2 ? [c, c] : [c]);
      expect(sim.state.characters[0]!.grab).not.toBeNull();
      if (t % 30 === 0) {
        const p = sim.state.characters[0]!.pos;
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (t > 30) windows.push({ deg, dx, dy, err: Math.abs(wrap(Math.atan2(dy, dx) - th)) * D });
        prev = { ...p };
      }
    }
  }
  const errs = windows.map((w) => w.err);
  return { mean: errs.reduce((a, b) => a + b, 0) / errs.length, max: Math.max(...errs), windows };
}

describe('control bug 1: a holder touching the load it holds never propels it (runaway carry)', () => {
  // before: small safe 190-210 m/s, large safe 112-119 m/s (holders flung along with it)
  for (const kind of ['smallSafe', 'largeSafe'] as const) {
    it(`two raccoons on the same spot of a ${kind} pulling apart: no runaway`, () => {
      const sim = makeSim(openLayout({ safes: [{ kind, pos: { x: 50, y: 30 }, angle: 0 }] }), [0, 0, 1, 1]);
      const r = sameFaceTug(sim, sim.state.loot[0]!.id, HALF[kind].y);
      expect(r.held).toBe(2);
      expect(r.maxLoot).toBeLessThan(kind === 'smallSafe' ? 4.4 * 1.15 : 3.6 * 1.15);
      expect(r.maxChar).toBeLessThan(CHARACTER.walkSpeed * 1.15);
    });
  }

  // before: moneyTree 117-123 m/s, piggy 170-185 m/s (Content 2.0, what the owner played)
  for (const [variant, hy] of [
    ['moneyTree', 0.4],
    ['piggy', 0.75],
  ] as const) {
    it(`Content 2.0 ${variant}: same-spot tug of war stays at carry speed`, () => {
      const sim = makeSim(propLayout(variant), [0, 0, 1, 1], { content: 'v2', police: false, timeLimitSeconds: 600 } as never);
      const prop = sim.state.loot.find((l) => !l.recovered && l.pos.x === 50 && l.pos.y === 30)!;
      const r = sameFaceTug(sim, prop.id, hy);
      expect(r.held).toBe(2);
      expect(r.maxLoot).toBeLessThan(6);
      expect(r.maxChar).toBeLessThan(CHARACTER.walkSpeed * 1.15);
    });
  }

  // before: 10.1 m/s peak, still 3.4 m/s after 10 s with idle sticks (target 0)
  it('a bank held by two raccoons on one wall with idle sticks stays put', () => {
    const { sim, bank } = bankSim([0, 0]);
    const y1 = 29.9;
    sim.debug.teleport(1, { x: 54.55, y: y1 }, Math.PI);
    sim.step([cmd(0, 0, true, false, W), cmd()]);
    sim.debug.teleport(2, { x: 54.5, y: y1 + 0.95 }, Math.PI);
    const c2 = sim.state.characters[1]!.pos;
    sim.step([cmd(0, 0, true), cmd(0, 0, true, false, { x: 54 - c2.x, y: y1 + 0.2 - c2.y })]);
    expect(sim.getLoot(bank)!.grabbedBy.length).toBe(2);
    let max = 0;
    for (let t = 0; t < 600; t++) {
      sim.step([cmd(0, 0, true), cmd(0, 0, true)]);
      max = Math.max(max, lootSpeed(sim, bank));
    }
    expect(max).toBeLessThan(0.6);
    expect(lootSpeed(sim, bank)).toBeLessThan(0.05);
  });

  // before: the bank drifted outward (+x, where nobody steers) at 1.0-1.35 m/s
  it('two raccoons on one bank wall pulling apart along it do not shove the bank outward', () => {
    const { sim, bank } = bankSim([0, 0]);
    sim.debug.teleport(1, { x: 54.55, y: 29.5 }, Math.PI);
    sim.debug.teleport(2, { x: 54.55, y: 30.5 }, Math.PI);
    sim.step([cmd(0, 0, true, false, W), cmd(0, 0, true, false, W)]);
    expect(sim.getLoot(bank)!.grabbedBy.length).toBe(2);
    const x0 = sim.getLoot(bank)!.pos.x;
    for (let t = 0; t < 360; t++) sim.step([cmd(0, -1, true), cmd(0, 1, true)]);
    expect(Math.abs(sim.getLoot(bank)!.pos.x - x0)).toBeLessThan(0.5);
    expect(lootSpeed(sim, bank)).toBeLessThan(0.3);
  });
});

describe('control bug 2: the grip bearing never spins a load on its own', () => {
  // before: the safe spun at 1.8 rad/s and circled at ~1.5 m/s for the whole 10 s
  it('two shoulder-to-shoulder holders with idle sticks leave a large safe at rest', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 30 }, angle: 0 }] }), [0, 0]);
    const id = sim.state.loot[0]!.id;
    sim.debug.setAnchored(id, false);
    sim.debug.teleport(1, { x: 51.25, y: 29.85 }, Math.PI);
    sim.step([cmd(0, 0, true, false, W), cmd()]);
    sim.debug.teleport(2, { x: 51.2, y: 30.8 }, Math.PI);
    const c2 = sim.state.characters[1]!.pos;
    sim.step([cmd(0, 0, true), cmd(0, 0, true, false, { x: 50.7 - c2.x, y: 30.15 - c2.y })]);
    expect(sim.getLoot(id)!.grabbedBy.length).toBe(2);
    for (let t = 0; t < 600; t++) sim.step([cmd(0, 0, true), cmd(0, 0, true)]);
    const l = sim.getLoot(id)!;
    expect(lootSpeed(sim, id)).toBeLessThan(0.05);
    expect(Math.abs(l.angVel)).toBeLessThan(0.05);
    expect(maxCharSpeed(sim, 2)).toBeLessThan(0.05);
  });
});

describe('control bug 3: pull / push switching is continuous (no sideways flip at the cone edge)', () => {
  // before: stick 101 deg -> the large safe holder moved at -158 deg (lateral motion reversed),
  // the bank holder at -123 deg, while stick 99 deg moved at ~100 deg
  for (const kind of ['largeSafe', 'bank'] as const) {
    it(`${kind}: sticks 99 and 101 degrees off the grip both drag toward the stick`, () => {
      const heads: number[] = [];
      for (const deg of [99, 101]) {
        const { sim } = eastGrip(kind, 1);
        const p0 = { ...sim.state.characters[0]!.pos };
        const th = deg / D;
        for (let t = 0; t < 30; t++) sim.step([cmd(Math.cos(th), Math.sin(th), true)]);
        const p = sim.state.characters[0]!.pos;
        expect(p.y - p0.y).toBeGreaterThan(0); // the stick's lateral side (+y)
        const head = Math.atan2(p.y - p0.y, p.x - p0.x) * D;
        expect(Math.abs(wrap((head - deg) / D) * D)).toBeLessThan(25);
        heads.push(head);
      }
      expect(Math.abs(heads[0]! - heads[1]!)).toBeLessThan(10);
    });
  }

  // before: mean heading error 84.8 deg (max 124) on the bank, push-wide-70 49.7 deg
  it('bank: grab then stick 105 degrees off, or push then swing 70 degrees off, follows the stick', () => {
    expect(headingErrors(eastGrip('bank', 1).sim, 1, [105, 105]).mean).toBeLessThan(10);
    expect(headingErrors(eastGrip('bank', 1).sim, 1, [180, 110]).mean).toBeLessThan(10);
  });
});

describe('control bug 4: pushing a bank steers like a cart (the pusher never swings against the stick)', () => {
  // before: after push 180 -> stick 135 the holder moved at 205-215 deg (against the stick's +y side)
  // for seconds: per-0.5 s errors 67, 80, 78, 72, 65, 58 deg
  it('push west, then turn the stick 45 degrees: the pusher bends toward the stick', () => {
    const { sim, id } = eastGrip('bank', 1);
    const r = headingErrors(sim, 1, [180, 135], 3);
    const turn = r.windows.filter((w) => w.deg === 135);
    for (const w of turn) expect(w.dy).toBeGreaterThan(-0.05);
    expect(Math.max(...turn.map((w) => w.err))).toBeLessThan(50);
    // a steady arc toward the stick: the error never grows again (since bug 8 the pusher follows the
    // turned stick within a few degrees at once, so window-to-window noise below 6 deg is fine)
    for (let i = 1; i < turn.length; i++) expect(turn[i]!.err).toBeLessThan(Math.max(turn[i - 1]!.err + 0.5, 6));
    expect(turn[turn.length - 1]!.err).toBeLessThan(40);
    // turning never adds speed: the bank stays within its 1-holder carry speed (1.03 m/s) +15%
    expect(lootSpeed(sim, id)).toBeLessThan(1.03 * 1.15);
  });

  it('turning a pushed bank never makes it faster than the carry targets', () => {
    for (const holders of [1, 2] as const) {
      const { sim, id } = eastGrip('bank', holders);
      const target = holders === 1 ? 1.03 : 1.71;
      let max = 0;
      for (const deg of [180, 135, 90, 150]) {
        const th = deg / D;
        const c = cmd(Math.cos(th), Math.sin(th), true);
        for (let t = 0; t < 120; t++) {
          sim.step(holders === 2 ? [c, c] : [c]);
          max = Math.max(max, lootSpeed(sim, id));
        }
      }
      expect(max).toBeLessThan(target * 1.15);
    }
  });
});

describe('control bug 5: pulling a bank goes where the stick points', () => {
  // before: stick 30/60/90 -> per-window errors up to 23-25 deg (the hauler rode the bank's swing)
  it('bank pull at 30, 60 and 90 degrees off the grip', () => {
    const r = headingErrors(eastGrip('bank', 1).sim, 1, [0, 30, 60, 90]);
    expect(r.mean).toBeLessThan(6);
    expect(r.max).toBeLessThan(12);
  });

  // guard of the fix: the yaw grip is off while the bank is pressed against a static, so a bank
  // snagged on a post still swings free (yaw grip always on: 2.4 m in 10 s instead of 4.3 m)
  it('a bank snagged on a lamp post still swings free', () => {
    const sim = makeSim(openLayout({ banks: [{ pos: { x: 50, y: 30 }, angle: 0 }], circles: [{ id: 'post', kind: 'lamp', center: { x: 55.2, y: 27.3 }, radius: 0.4, height: 4 }] }), [0]);
    const bank = sim.state.loot[0]!.id;
    sim.debug.setAnchored(bank, false);
    for (const l of sim.state.loot) if (l.kind !== 'bank') sim.debug.teleport(l.id, { x: 5 + l.id * 2, y: 55 });
    sim.debug.teleport(1, { x: 54.55, y: 30 }, Math.PI);
    sim.step([cmd(0, 0, true, false, W)]);
    const p0 = { ...sim.getLoot(bank)!.pos };
    for (let t = 0; t < 600; t++) sim.step([cmd(1, 0, true)]);
    const p = sim.getLoot(bank)!.pos;
    expect(sim.state.characters[0]!.grab).not.toBeNull();
    expect(Math.hypot(p.x - p0.x, p.y - p0.y)).toBeGreaterThan(3.5);
  });
});

describe('control bug 6: two pushers on one face push along the stick', () => {
  // before: a large safe pushed by two holders at stick 150 deg moved at ~165 deg for good;
  // two pushers turning a large safe 45 / 90 deg drifted 11 deg on average
  it('large safe, two pushers, stick 150 degrees: the load follows the stick', () => {
    // shoulder to shoulder (0.6 m apart, closer than two bodies): one holder is pushed off its line
    const { sim, id } = eastGrip('largeSafe', 2, 0.3);
    const th = (150 * Math.PI) / 180;
    const c = cmd(Math.cos(th), Math.sin(th), true);
    for (let t = 0; t < 120; t++) sim.step([c, c]);
    const p0 = { ...sim.getLoot(id)!.pos };
    for (let t = 0; t < 120; t++) sim.step([c, c]);
    const p = sim.getLoot(id)!.pos;
    const head = Math.atan2(p.y - p0.y, p.x - p0.x);
    expect(Math.abs(wrap(head - th)) * D).toBeLessThan(6);
  });
});

describe('control bug 7: grabbing during a dash does not slingshot the load', () => {
  // before: small safe 6.37 m/s (carry 4.0), large safe 3.45 m/s (carry 2.8)
  for (const [kind, carry] of [
    ['smallSafe', 4.0],
    ['largeSafe', 2.8],
  ] as const) {
    it(`${kind}: dash toward it, grab mid-dash`, () => {
      for (const g of [3, 6, 10]) {
        const sim = makeSim(openLayout({ safes: [{ kind, pos: { x: 50, y: 30 }, angle: 0 }] }), [0]);
        const id = sim.state.loot[0]!.id;
        sim.debug.setAnchored(id, false);
        sim.debug.teleport(1, { x: 52.6, y: 30 }, Math.PI);
        sim.step([cmd(-1, 0, false, false, W)]);
        let max = 0;
        for (let t = 0; t < 90; t++) {
          sim.step([cmd(0, 0, t >= g, t === 0, W)]);
          max = Math.max(max, lootSpeed(sim, id));
        }
        expect(sim.state.characters[0]!.grab).not.toBeNull();
        expect(max).toBeLessThan(carry * 1.15);
      }
    });
  }
});

/**
 * Hold the stick at each heading (degrees) for `secs` with every holder pushing; per 0.5 s window
 * (skipping the first window after each change) the angle between the stick and the displacement of
 * the first holder and of the load's centre, and the load's top speed after the first window.
 */
function pushTrack(sim: Simulation, id: number, holders: 1 | 2, degs: number[], secs = 3): { char: number[]; load: number[]; vmax: number } {
  let pc = { ...sim.state.characters[0]!.pos };
  let pl = { ...sim.getLoot(id)!.pos };
  const char: number[] = [];
  const load: number[] = [];
  let vmax = 0;
  for (const deg of degs) {
    const th = deg / D;
    const c = cmd(Math.round(Math.cos(th) * 1e6) / 1e6, Math.round(Math.sin(th) * 1e6) / 1e6, true);
    for (let t = 1; t <= secs * 60; t++) {
      sim.step(holders === 2 ? [c, c] : [c]);
      expect(sim.state.characters[0]!.grab).not.toBeNull();
      if (t > 30) vmax = Math.max(vmax, lootSpeed(sim, id));
      if (t % 30 === 0) {
        const p = sim.state.characters[0]!.pos;
        const q = sim.getLoot(id)!.pos;
        if (t > 30) {
          char.push(Math.abs(wrap(Math.atan2(p.y - pc.y, p.x - pc.x) - th)) * D);
          load.push(Math.abs(wrap(Math.atan2(q.y - pl.y, q.x - pl.x) - th)) * D);
        }
        pc = { ...p };
        pl = { ...q };
      }
    }
  }
  return { char, load, vmax };
}

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

describe('control bug 8: a pushed bank goes where the stick points, the pusher with it', () => {
  // before (cart pivoting at the push point, steering 6 deg/s): push west then stick 135 -> the
  // pusher ran on west, per-window errors 45, 40, 35 ... (mean 19.4, max 45), the bank 6.3 / 18 and
  // it had turned 17 deg after 3 s
  for (const deg of [135, 225]) {
    it(`push west, then stick ${deg}: bank and pusher follow within a few degrees, the bank's nose swings round`, () => {
      const { sim, id } = eastGrip('bank', 1);
      const r = pushTrack(sim, id, 1, [180, deg]);
      expect(mean(r.char)).toBeLessThan(4);
      expect(Math.max(...r.char)).toBeLessThan(10);
      expect(mean(r.load)).toBeLessThan(4);
      expect(Math.max(...r.load)).toBeLessThan(10);
      // the pushed face turns toward the stick (45 deg away): most of the way within 3 s
      const yaw = wrap(sim.getLoot(id)!.angle) * D;
      expect(yaw * Math.sign(deg - 180)).toBeGreaterThan(25);
      // the pusher stays on the east wall, its grip slid along it
      const g = sim.state.characters[0]!.grab!;
      expect(g.anchorLocal.x).toBeCloseTo(4, 6);
      expect(Math.abs(g.anchorLocal.y)).toBeLessThanOrEqual(2.5 + 1e-9);
    });
  }

  // before: two pushers 18.8 / 43 (bank 11.1 / 27); push + pull pair 15.8 / 43 (bank 8.4 / 26)
  it('two pushers, and a pusher with a puller on the far wall, follow a turned stick', () => {
    const two = eastGrip('bank', 2);
    const a = pushTrack(two.sim, two.id, 2, [180, 135]);
    expect(mean(a.char)).toBeLessThan(5);
    expect(mean(a.load)).toBeLessThan(5);
    const { sim, bank } = bankSim([0, 0]);
    sim.debug.teleport(1, { x: 54.55, y: 30 }, Math.PI);
    sim.debug.teleport(2, { x: 45.45, y: 30 }, 0);
    sim.step([cmd(0, 0, true, false, W), cmd(0, 0, true, false, { x: 1, y: 0 })]);
    expect(sim.getLoot(bank)!.grabbedBy.length).toBe(2);
    const b = pushTrack(sim, bank, 2, [180, 135, 180]);
    expect(mean(b.char)).toBeLessThan(5);
    expect(mean(b.load)).toBeLessThan(5);
  });

  // before: zigzag 26.1 / 52 (x1), 24.7 / 49 (x2); off-centre push at 150 deg 17.3 / 31 (it is still
  // the weakest case, ~13 deg: the grip starts 0.4 m from the end of its wall, so the bank turns
  // slowly and swings the pusher a little)
  it('zigzagging a push stays on the stick and never runs faster than the carry targets', () => {
    for (const holders of [1, 2] as const) {
      const { sim, id } = eastGrip('bank', holders);
      const r = pushTrack(sim, id, holders, [180, 140, 220, 160, 200], 2);
      expect(mean(r.char)).toBeLessThan(6);
      expect(mean(r.load)).toBeLessThan(6);
      expect(r.vmax).toBeLessThan((holders === 1 ? 1.03 : 1.71) * 1.15);
      for (const c of sim.state.characters.slice(0, holders)) expect(c.grab!.anchorLocal.x).toBeCloseTo(4, 6);
    }
    const { sim, id } = eastGrip('bank', 1);
    sim.step([cmd(0, 0, false)]);
    sim.debug.teleport(1, { x: 104.55, y: 102.1 }, Math.PI);
    sim.step([cmd(0, 0, true, false, W)]);
    const r = pushTrack(sim, id, 1, [150, 150]);
    expect(mean(r.char)).toBeLessThan(16);
    expect(mean(r.load)).toBeLessThan(4);
  });

  // before: pushed straight into a lamp post at its corner, the bank stuck there (0.6 m in 9 s):
  // the push steering held it square against the post (now it lets go while pressed on a static)
  it('a bank pushed into a lamp post at its corner swings free; pushed into a wall it slides along it', () => {
    const post = makeSim(openLayout({ size: { x: 200, y: 200 }, banks: [{ pos: { x: 100, y: 100 }, angle: 0 }], circles: [{ id: 'post', kind: 'lamp', center: { x: 95, y: 97.4 }, radius: 0.4, height: 4 }] }), [0]);
    const wall = makeSim(openLayout({ size: { x: 200, y: 200 }, banks: [{ pos: { x: 100, y: 100 }, angle: 0 }], statics: [{ id: 'w', kind: 'wall', center: { x: 90, y: 104.2 }, half: { x: 20, y: 1 }, angle: 0, height: 2 }] }), [0]);
    for (const [sim, deg, min] of [
      [post, 180, 2.5],
      [wall, 135, 3], // a diagonal push into a wall keeps sliding along it (cos 45 of the push)
    ] as const) {
      const id = sim.state.loot[0]!.id;
      sim.debug.setAnchored(id, false);
      for (const l of sim.state.loot) if (l.kind !== 'bank') sim.debug.teleport(l.id, { x: 10 + l.id * 2, y: 190 });
      sim.debug.teleport(1, { x: 104.55, y: 100 }, Math.PI);
      sim.step([cmd(0, 0, true, false, W)]);
      const p0 = { ...sim.getLoot(id)!.pos };
      const th = deg / D;
      for (let t = 0; t < 540; t++) sim.step([cmd(Math.cos(th), Math.sin(th), true)]);
      const p = sim.getLoot(id)!.pos;
      expect(sim.state.characters[0]!.grab).not.toBeNull();
      expect(Math.hypot(p.x - p0.x, p.y - p0.y)).toBeGreaterThan(min);
    }
  });
});
