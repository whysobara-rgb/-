/**
 * [C3] Physics contracts of Content 2.0 (content-plan §4.5): ground fields and scales, kickable
 * bodies, kinematic floors / setKinematicPose, non-character impact reports.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER, DT, PROP_SPECS } from '../../src/sim/config';
import { Body, CAT_CHARACTER, CAT_SAFE, PhysicsWorld, setKinematicPose, type PhysicsHooks } from '../../src/sim/physics';
import { PHYSICS_PARAMS, boxInertia } from '../../src/sim/world';

const world = (): PhysicsWorld => new PhysicsWorld(PHYSICS_PARAMS, { minX: 0, minY: 0, maxX: 100, maxY: 60 });

function character(w: PhysicsWorld, id: number, x: number, y: number): Body {
  const b = w.createBody(id, CAT_CHARACTER);
  b.fixedRotation = true;
  b.addCircle(0, 0, CHARACTER.radius);
  b.setMass(CHARACTER.mass, 0);
  b.linDrag = CHARACTER.drag;
  b.x = x;
  b.y = y;
  return b;
}

function safeBody(w: PhysicsWorld, id: number, x: number, y: number, hx = 0.4, hy = 0.4, mass = 40): Body {
  const b = w.createBody(id, CAT_SAFE);
  b.addBox(0, 0, hx, hy);
  b.setMass(mass, boxInertia(mass, hx, hy));
  b.linDrag = 3.75;
  b.x = x;
  b.y = y;
  return b;
}

function piggyBody(w: PhysicsWorld, id: number, x: number, y: number): Body {
  const s = PROP_SPECS.piggy;
  const b = w.createBody(id, CAT_SAFE);
  b.addCircle(0, 0, s.half.x);
  b.setMass(s.mass, 0.5 * s.mass * s.half.x * s.half.x);
  b.linDrag = s.drag;
  b.kickable = s.kickable;
  b.x = x;
  b.y = y;
  return b;
}

describe('ground fields and scales (belts, slicks)', () => {
  const terminal = (fieldVx: number, move: number, dragScale = 1, driveScale = 1): number => {
    const w = world();
    const c = character(w, 1, 50, 30);
    for (let t = 0; t < 240; t++) {
      c.fieldVx = fieldVx;
      c.dragScale = dragScale;
      c.driveScale = driveScale;
      c.fx = CHARACTER.driveForce * move;
      w.step(DT, 2, {});
    }
    return c.vx;
  };

  it('neutral values reproduce classic walking exactly', () => {
    expect(terminal(0, 1)).toBeCloseTo(CHARACTER.walkSpeed, 6);
  });

  it('a 2.2 m/s belt: with it ~7.2, against it ~2.8, standing on it rides at 2.2', () => {
    expect(terminal(2.2, 1)).toBeCloseTo(7.2, 3);
    expect(terminal(-2.2, 1)).toBeCloseTo(2.8, 3);
    expect(terminal(2.2, 0)).toBeCloseTo(2.2, 3);
  });

  it('drag and drive scales: equal scales keep top speed (rink), soap trades grip for glide', () => {
    expect(terminal(0, 1, 0.3, 0.3)).toBeCloseTo(CHARACTER.walkSpeed, 2);
    // coasting on soap: a shoved body keeps far more of its speed after 0.5 s
    const coast = (dragScale: number): number => {
      const w = world();
      const s = safeBody(w, 10, 20, 30);
      s.vx = 6;
      for (let t = 0; t < 30; t++) {
        s.dragScale = dragScale;
        w.step(DT, 2, {});
      }
      return s.vx;
    };
    expect(coast(0.15)).toBeGreaterThan(coast(1) * 3);
  });
});

describe('kickable bodies', () => {
  const shove = (kickable: boolean, dashing: boolean): number => {
    const w = world();
    const c = character(w, 1, 40, 30);
    const p = piggyBody(w, 10, 41.3, 30);
    p.kickable = kickable;
    c.vx = 11;
    c.noDrag = dashing;
    for (let t = 0; t < 3; t++) w.step(DT, 4, {});
    return p.vx;
  };

  it('a dashing character hits a kickable body at full mass; walking (or non-kickable) is a soft push', () => {
    const kick = shove(true, true);
    expect(kick).toBeGreaterThan(4);
    expect(shove(false, true)).toBeLessThan(kick / 2);
    expect(shove(true, false)).toBeLessThan(kick / 2);
  });
});

describe('kinematic floors (setKinematicPose)', () => {
  /** Smoothstep 90° turn in 1.5 s about (cx, cy); riders at radius r; returns the final drift. */
  function turnDrift(r: number, substeps: number, rider: 'char' | 'safe', translate = 0): number {
    const w = world();
    const cx = 50;
    const cy = 30;
    const floor = w.createBody(5001, 0);
    // a rim of four boxes outside the riders (a teacup), so nothing touches them
    floor.addBox(5.2, 0, 0.2, 5);
    floor.addBox(-5.2, 0, 0.2, 5);
    floor.addBox(0, 5.2, 5, 0.2);
    floor.addBox(0, -5.2, 5, 0.2);
    floor.setMass(1000, 1000);
    floor.motion = 'kinematic';
    floor.x = cx;
    floor.y = cy;
    const b = rider === 'char' ? character(w, 1, cx + r, cy) : safeBody(w, 10, cx + r, cy);
    b.floor = floor;
    const T = 90;
    const pose = (t: number): [number, number, number, number, number, number] => {
      const u = Math.min(1, Math.max(0, t / (T * DT)));
      const s = 3 * u * u - 2 * u * u * u;
      const ds = t < T * DT ? (6 * u - 6 * u * u) / (T * DT) : 0;
      return [cx + translate * s, cy, (Math.PI / 2) * s, translate * ds, 0, (Math.PI / 2) * ds];
    };
    let tick = 0;
    const hooks: PhysicsHooks = {
      beforeSubstep: (sub, n) => {
        const [x, y, a, vx, vy, wv] = pose((tick + sub / n) * DT);
        setKinematicPose(floor, x, y, a, vx, vy, wv);
      },
    };
    for (; tick < T + 30; tick++) w.step(DT, substeps, hooks);
    const ex = cx + translate; // rider rotated 90° about the floor center
    const ey = cy + r;
    return Math.hypot(b.x - ex, b.y - ey);
  }

  it('carries a raccoon through 90° with < 2 cm drift (2 and 8 substeps, rim radius)', () => {
    expect(turnDrift(4, 2, 'char')).toBeLessThan(0.02);
    expect(turnDrift(4, 8, 'char')).toBeLessThan(0.02);
    expect(turnDrift(2, 2, 'char')).toBeLessThan(0.02);
  });

  it('carries loot too (rotating and translating floor)', () => {
    expect(turnDrift(3, 2, 'safe')).toBeLessThan(0.02);
    expect(turnDrift(3, 2, 'char', 4)).toBeLessThan(0.02);
  });

  it('a match of teacup steps (40 x 90°, 4.5 m cup): loot and raccoons stay put on the floor (< 2 cm, no outward creep)', () => {
    for (const rider of ['char', 'safe'] as const) {
      for (const sub of [2, 3]) {
        const w = world();
        const floor = w.createBody(5001, 0);
        floor.addCircle(0, 0, 0.1);
        floor.setMass(1000, 1000);
        floor.motion = 'kinematic';
        floor.x = 50;
        floor.y = 30;
        const r = 4;
        const b = rider === 'char' ? character(w, 1, 50 + r, 30) : safeBody(w, 10, 50 + r, 30, 0.55, 0.45, 90);
        b.floor = floor;
        const MOVE = 90;
        const PER = 270;
        const STEPS = 40;
        const ang = (t: number): [number, number] => {
          const k = Math.floor(t / PER);
          const ph = t - k * PER;
          if (k >= STEPS) return [(STEPS * Math.PI) / 2, 0];
          if (ph >= MOVE) return [((k + 1) * Math.PI) / 2, 0];
          const u = ph / MOVE;
          return [((k + 3 * u * u - 2 * u * u * u) * Math.PI) / 2, (((6 * u - 6 * u * u) / (MOVE * DT)) * Math.PI) / 2];
        };
        let tick = 0;
        for (; tick < PER * STEPS + 10; tick++) {
          w.step(DT, sub, {
            beforeSubstep: (s2, n) => {
              const [a, wv] = ang(tick + s2 / n);
              setKinematicPose(floor, 50, 30, a, 0, 0, wv);
            },
          });
        }
        const [a] = ang(tick);
        expect(Math.hypot(b.x - (50 + r * Math.cos(a)), b.y - (30 + r * Math.sin(a)))).toBeLessThan(0.02);
        expect(Math.abs(Math.hypot(b.x - 50, b.y - 30) - r)).toBeLessThan(0.005);
      }
    }
  });

  it('a truck whose first pose is already moving carries its rider from the start (start and stop alike)', () => {
    for (const sub of [2, 5]) {
      const w = world();
      const truck = w.createBody(5003, 0);
      truck.addBox(0, 2, 3, 0.2);
      truck.addBox(0, -2, 3, 0.2);
      truck.setMass(1000, 1000);
      truck.motion = 'kinematic';
      truck.x = 20;
      truck.y = 30;
      const b = character(w, 1, 21, 30.5);
      b.floor = truck;
      // 6 m/s from the first pose for 2 s, then parked
      const pose = (t: number): [number, number] => (t < 120 ? [20 + 6 * t * DT, 6] : [20 + 6 * 120 * DT, 0]);
      let tick = 0;
      let worst = 0;
      for (; tick < 200; tick++) {
        w.step(DT, sub, {
          beforeSubstep: (s2, n) => {
            const [x, v] = pose(tick + s2 / n);
            setKinematicPose(truck, x, 30, 0, v, 0, 0);
          },
        });
        worst = Math.max(worst, Math.hypot(b.x - truck.x - 1, b.y - 30.5));
      }
      expect(worst).toBeLessThan(0.02);
      expect(Math.abs(b.vx)).toBeLessThan(1e-6);
    }
  });

  it('pushes dynamic bodies like a moving wall', () => {
    const w = world();
    const car = w.createBody(5002, 0);
    car.addCircle(0, 0, 1);
    car.setMass(500, 250);
    const c = character(w, 1, 32, 30);
    let tick = 0;
    for (; tick < 60; tick++) {
      w.step(DT, 4, { beforeSubstep: (sub, n) => setKinematicPose(car, 28 + 4 * (tick + sub / n) * DT, 30, 0, 4, 0, 0) });
    }
    expect(car.x).toBeCloseTo(32, 1);
    expect(c.x).toBeGreaterThan(car.x + 1 + CHARACTER.radius - 0.05);
  });
});

describe('impact reports', () => {
  it('loot vs wall reports through onBodyImpact, character impacts through onImpact only', () => {
    const w = world();
    w.addStaticBox(60, 30, 0.5, 5, 0, 'wall');
    const s = safeBody(w, 10, 57.5, 30);
    s.vx = 12;
    const c = character(w, 1, 55, 40);
    const body: number[] = [];
    const chars: number[] = [];
    const hooks: PhysicsHooks = { onBodyImpact: (_a, _b, ap) => void body.push(ap), onImpact: (_a, _b, ap) => void chars.push(ap) };
    for (let t = 0; t < 60; t++) w.step(DT, 4, hooks);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toBeGreaterThan(5);
    expect(chars.length).toBe(0);
    c.vx = 9;
    c.noDrag = true;
    c.y = 30;
    c.x = 50;
    s.x = 52;
    s.vx = 0;
    body.length = 0;
    for (let t = 0; t < 30; t++) w.step(DT, 4, hooks);
    expect(chars.length).toBeGreaterThan(0);
  });
});
