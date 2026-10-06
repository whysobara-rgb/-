/**
 * Navigation: clearance classes (doc §6 좁은 길: small safes pass the 1.1 m alleys, large safes
 * only the >= 2 m lanes), dynamic bank walls, distance fields.
 */
import { describe, expect, it } from 'vitest';
import { NAV_CLEARANCE, NavGrid, polylineLength } from '../../src/ai/nav';
import type { Vec2 } from '../../src/sim/types';
import { makeMatch } from './helpers';

function samples(pts: Vec2[], step = 0.2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

const inRect = (p: Vec2, x0: number, y0: number, x1: number, y1: number): boolean => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;

describe('nav grid', () => {
  it('plaza: small-safe carries use the 1.1 m bakery alley, large-safe carries detour through the 2.5 m gate lane', () => {
    const { sim } = makeMatch('plaza', [{ team: 0, bot: { personality: 'hodadak' } }]);
    const nav = NavGrid.for(sim);
    // service lane behind the north shops -> boulevard in front of them, alley at x = 12 (11.45..12.55)
    const from = { x: 12, y: 1.25 };
    const to = { x: 12, y: 9 };
    const small = nav.findPath(from, to, 'small')!;
    const large = nav.findPath(from, to, 'large')!;
    expect(small.partial).toBe(false);
    expect(large.partial).toBe(false);
    expect(small.length).toBeLessThan(9);
    expect(samples(small.points).some((p) => inRect(p, 11.4, 3, 12.6, 6))).toBe(true);
    // the large path never enters the alley and is much longer (gate lane at x = 22)
    expect(large.length).toBeGreaterThan(18);
    expect(samples(large.points).some((p) => inRect(p, 11.3, 2.6, 12.7, 6.4))).toBe(false);
    for (const p of samples(large.points)) {
      if (Math.hypot(p.x - from.x, p.y - from.y) < 1 || Math.hypot(p.x - to.x, p.y - to.y) < 1) continue;
      expect(nav.clearanceAt(p.x, p.y)).toBeGreaterThanOrEqual(NAV_CLEARANCE.large - 0.05);
    }
  });

  it('shortcut: the 1.1 m corner alley is open to small safes only', () => {
    const { sim } = makeMatch('shortcut', [{ team: 0, bot: { personality: 'hodadak' } }]);
    const nav = NavGrid.for(sim);
    const from = { x: 10, y: 3 };
    const to = { x: 10, y: 17 };
    const small = nav.findPath(from, to, 'small')!;
    const large = nav.findPath(from, to, 'large')!;
    expect(small.length).toBeLessThan(16);
    expect(samples(small.points).some((p) => inRect(p, 9.4, 6, 10.6, 13))).toBe(true);
    expect(samples(large.points).some((p) => inRect(p, 9.3, 5, 10.7, 14))).toBe(false);
    expect(large.length).toBeGreaterThan(small.length + 6);
  });

  it('bank walls are dynamic: interiors are reachable through the doors and follow a moved bank', () => {
    const { sim } = makeMatch('counter', [{ team: 0, bot: { personality: 'hodadak' } }]);
    const nav = NavGrid.for(sim);
    const bank = sim.state.loot.find((l) => l.kind === 'bank')!;
    const start = sim.characterBySlot(0).pos;
    // a point on the bank floor beside the large safe
    const inside = { x: bank.pos.x + 1.8, y: bank.pos.y + 1.5 };
    const p1 = nav.findPath(start, inside, 'walk')!;
    expect(p1.partial).toBe(false);
    // move the bank 6 m south (test-only teleport): the old floor becomes open ground,
    // the new one is again reachable only through a door
    sim.debug.setAnchored(bank.id, false);
    sim.debug.teleport(bank.id, { x: bank.pos.x, y: bank.pos.y + 6 });
    nav.update(sim, true);
    const wallsNow = sim.bankWallOBBs(bank.id);
    const p2 = nav.findPath(start, { x: bank.pos.x + 1.8, y: bank.pos.y + 1.5 }, 'walk')!;
    expect(p2.partial).toBe(false);
    for (const p of samples(p2.points, 0.1)) {
      for (const w of wallsNow) {
        const c = Math.cos(w.angle);
        const s = Math.sin(w.angle);
        const dx = p.x - w.center.x;
        const dy = p.y - w.center.y;
        const lx = Math.abs(dx * c + dy * s) - w.half.x;
        const ly = Math.abs(-dx * s + dy * c) - w.half.y;
        expect(Math.max(lx, ly)).toBeGreaterThan(0); // never inside a wall
      }
    }
  });

  it('distance fields: carry distances to each zone are finite for every outdoor safe and symmetric', () => {
    for (const id of ['plaza', 'shortcut', 'counter'] as const) {
      const { sim } = makeMatch(id, [{ team: 0, bot: { personality: 'hodadak' } }, { team: 1, bot: { personality: 'hodadak' } }]);
      const nav = NavGrid.for(sim);
      for (const l of sim.state.loot) {
        if (l.kind === 'bank' || l.floorOf !== null) continue;
        const cls = l.kind === 'largeSafe' ? 'large' : 'small';
        const d0 = nav.fieldAt(nav.zoneField(0, cls, 0), l.pos, cls);
        const d1 = nav.fieldAt(nav.zoneField(1, cls, 0), l.pos, cls);
        expect(Number.isFinite(d0)).toBe(true);
        expect(Number.isFinite(d1)).toBe(true);
        // its mirror twin is equally far from the other zone (mirror-symmetric layouts)
        const twin = sim.state.loot.find((m) => m.kind === l.kind && Math.abs(m.pos.x - (sim.layout.size.x - l.pos.x)) < 1e-6 && Math.abs(m.pos.y - l.pos.y) < 1e-6);
        if (twin) expect(Math.abs(nav.fieldAt(nav.zoneField(1, cls, 0), twin.pos, cls) - d0)).toBeLessThan(1.0);
      }
    }
  });

  it('path queries are cheap enough for a 60 Hz budget', () => {
    const { sim } = makeMatch('plaza', [{ team: 0, bot: { personality: 'hodadak' } }]);
    const nav = NavGrid.for(sim);
    const t0 = performance.now();
    let len = 0;
    for (let i = 0; i < 40; i++) len += nav.findPath({ x: 5.5, y: 22 + (i % 5) }, { x: 74, y: 10 + (i % 7) * 4 }, i % 2 ? 'small' : 'large')!.length;
    const per = (performance.now() - t0) / 40;
    expect(len).toBeGreaterThan(0);
    expect(per).toBeLessThan(15);
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
  });
});
