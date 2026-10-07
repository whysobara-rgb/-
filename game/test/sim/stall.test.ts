/**
 * Stall rescue (STALL_RESCUE; doc §16/§20 "영구 끼임"): a raccoon wedged in a gap narrower than its
 * body (overlap below UNSTUCK.penetration, so the deep-penetration anti-pin never fires) is nudged
 * to the nearest reachable free spot once it has steered without moving for ~0.6 s.
 *
 * Repro of the reported bug (counter, before the layout fix): sim.debug.teleport(2, {x: 62.32,
 * y: 11.45}) between building r1a.n.e (south face y = 11.0) and the anchored terrace safe at
 * y = 12.25, then any move -> frozen forever. The shipped layout now places that safe flush with
 * the building; these tests rebuild the old pocket on a copy to exercise the generic sim rule.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER, STALL_RESCUE } from '../../src/sim/config';
import { LAYOUTS } from '../../src/sim/layouts/index';
import { Simulation } from '../../src/sim/sim';
import type { Command, LayoutDef, RosterEntry, SimEvent, Vec2 } from '../../src/sim/types';
import { EMPTY_COMMAND } from '../../src/sim/types';

function oldCounter(): LayoutDef {
  const d = structuredClone(LAYOUTS.counter);
  for (const s of d.safes) if (Math.abs(s.pos.y - 11.46) < 0.01) s.pos.y = 12.25;
  return d;
}

function makeSim(layout: LayoutDef, n = 4, police = false): Simulation {
  const roster: RosterEntry[] = Array.from({ length: n }, (_, i) => ({ team: (i < n / 2 ? 0 : 1) as 0 | 1, isBot: false, name: `p${i}`, look: { hat: 'none' } }));
  return new Simulation({ layout, roster, seed: 3, rules: { police } });
}

const move = (x: number, y: number): Command => ({ ...EMPTY_COMMAND, move: { x, y } });

function run(sim: Simulation, ticks: number, cmds: (t: number) => (Command | undefined)[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) out.push(...sim.step(cmds(t)));
  return out;
}

describe('stall rescue (wedged between a wall and an anchored safe)', () => {
  const WEDGE: Vec2 = { x: 62.32, y: 11.45 };

  it('the reported repro is frozen without the rescue window and freed within ~1 s by it', () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const sim = makeSim(oldCounter());
      sim.debug.teleport(2, WEDGE);
      // before the rescue window elapses nothing moves (this is the bug: the solver jams it)
      run(sim, STALL_RESCUE.ticks - 2, () => [undefined, move(dx!, dy!)]);
      const p0 = sim.characterBySlot(1).pos;
      expect(Math.hypot(p0.x - WEDGE.x, p0.y - WEDGE.y)).toBeLessThan(STALL_RESCUE.maxMove);
      const ev = run(sim, 60, () => [undefined, move(dx!, dy!)]);
      const un = ev.filter((e): e is Extract<SimEvent, { type: 'unstuck' }> => e.type === 'unstuck' && e.entityId === 2);
      expect(un.length, `dir ${dx},${dy}`).toBeGreaterThanOrEqual(1);
      const spot = un[0]!.pos;
      // nearest free spot: close by, still on the street side of the building (never through it)
      expect(Math.hypot(spot.x - WEDGE.x, spot.y - WEDGE.y)).toBeLessThanOrEqual(STALL_RESCUE.maxNudge + 1e-6);
      expect(spot.y).toBeGreaterThan(11.0 + CHARACTER.radius - 0.02);
      expect(sim.isFree(spot, CHARACTER.radius)).toBe(true);
    }
  });

  it('is deterministic and mirror-fair (the mirrored wedge gets the mirrored spot)', () => {
    const W = LAYOUTS.counter.size.x;
    const spotFor = (slot: number, p: Vec2, dx: number): Vec2 => {
      const sim = makeSim(oldCounter());
      sim.debug.teleport(slot + 1, p);
      const ev = run(sim, 90, () => {
        const c: (Command | undefined)[] = [undefined, undefined, undefined, undefined];
        c[slot] = move(dx, 0);
        return c;
      });
      const un = ev.find((e): e is Extract<SimEvent, { type: 'unstuck' }> => e.type === 'unstuck' && e.entityId === slot + 1);
      expect(un).toBeDefined();
      return un!.pos;
    };
    const a = spotFor(1, WEDGE, 1);
    const a2 = spotFor(1, WEDGE, 1);
    expect(a2).toEqual(a);
    const b = spotFor(3, { x: W - WEDGE.x, y: WEDGE.y }, -1);
    expect(b.x).toBeCloseTo(W - a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('never fires for walking into a wall, shoving another raccoon, or a tug of war', () => {
    const sim = makeSim(LAYOUTS.counter);
    const layout = sim.layout;
    // walk north into the building r1a.n.e from below for 4 s
    sim.debug.teleport(1, { x: 60, y: 11.9 });
    // two raccoons shoving each other head-on in the open
    sim.debug.teleport(2, { x: 34, y: 34 });
    sim.debug.teleport(3, { x: 34.95, y: 34 });
    const ev = run(sim, 240, () => [move(0, -1), move(1, 0), move(-1, 0), undefined]);
    expect(ev.filter((e) => e.type === 'unstuck')).toEqual([]);
    expect(layout.id).toBe('counter');
    // tug of war over one anchored-free small safe: holders are never nudged
    const sim2 = makeSim(LAYOUTS.plaza, 2);
    const safe = sim2.state.loot.find((l) => l.kind === 'smallSafe' && l.floorOf === null)!;
    sim2.debug.setAnchored(safe.id, false);
    sim2.debug.teleport(1, { x: safe.pos.x - 0.4 - 0.56, y: safe.pos.y });
    sim2.debug.teleport(2, { x: safe.pos.x + 0.4 + 0.56, y: safe.pos.y });
    const ev2 = run(sim2, 300, (t) => [
      { ...EMPTY_COMMAND, grab: t > 2, aim: { x: 1, y: 0 }, move: t > 20 ? { x: -1, y: 0 } : { x: 0, y: 0 } },
      { ...EMPTY_COMMAND, grab: t > 2, aim: { x: -1, y: 0 }, move: t > 20 ? { x: 1, y: 0 } : { x: 0, y: 0 } },
    ]);
    expect(sim2.getLoot(safe.id)!.grabbedBy.length).toBe(2);
    expect(ev2.filter((e) => e.type === 'unstuck')).toEqual([]);
  });

  it('no spot near any outdoor safe of the shipped layouts freezes a raccoon (police on)', () => {
    let tested = 0;
    for (const id of ['plaza', 'shortcut', 'counter'] as const) {
      const base = makeSim(LAYOUTS[id], 2, true);
      for (const sf of base.state.loot.filter((l) => l.kind !== 'bank' && l.floorOf === null)) {
        for (let x = sf.pos.x - 1.6; x <= sf.pos.x + 1.6; x += 0.4) {
          for (let y = sf.pos.y - 1.6; y <= sf.pos.y + 1.6; y += 0.4) {
            const p = { x, y };
            if (base.isFree(p, CHARACTER.radius) || !base.isFree(p, 0.28)) continue;
            tested++;
            let moved = false;
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const sim = makeSim(LAYOUTS[id], 2, true);
              sim.debug.teleport(1, p);
              run(sim, 90, () => [move(dx!, dy!), undefined]);
              const q = sim.characterBySlot(0).pos;
              if (Math.hypot(q.x - p.x, q.y - p.y) > 0.3) {
                moved = true;
                break;
              }
            }
            expect(moved, `${id} (${x.toFixed(2)}, ${y.toFixed(2)})`).toBe(true);
          }
        }
      }
    }
    expect(tested).toBeGreaterThan(50);
  });
});
