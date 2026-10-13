/**
 * Bot motor skills on the real match layouts: grab + strain + carry a small safe home,
 * uproot and haul a bank along its curated route (fences included), and take the large safe
 * out of a bank through a door.
 */
import { describe, expect, it } from 'vitest';
import { BANK_MODEL, TICK_RATE } from '../../src/sim/config';
import type { SimEvent, Vec2 } from '../../src/sim/types';
import { projectOnPolyline } from '../../src/ai/nav';
import { MATCH_LAYOUTS, makeMatch, stepMatch } from './helpers';

describe('bot motor skills', () => {
  for (const layoutId of MATCH_LAYOUTS) {
    it(`${layoutId}: a solo bot delivers a small safe to its zone within 40 s from spawn`, () => {
      const { sim, bots } = makeMatch(layoutId, [{ team: 0, bot: { personality: 'hodadak', difficulty: 'normal' } }], 3);
      // the nearest outdoor small safe (alone on the map the bot would rather haul a bank)
      const spawn = sim.characterBySlot(0).pos;
      const smalls = sim.state.loot.filter((l) => l.kind === 'smallSafe' && l.floorOf === null);
      const target = smalls.reduce((a, b) => (Math.hypot(a.pos.x - spawn.x, a.pos.y - spawn.y) <= Math.hypot(b.pos.x - spawn.x, b.pos.y - spawn.y) ? a : b));
      bots[0]!.assignTask(sim, { kind: 'collect', targetId: target.id });
      const events = stepMatch(sim, bots, 40 * TICK_RATE, undefined, (_s, ev) => ev.some((e) => e.type === 'recovered'));
      const rec = events.find((e): e is Extract<SimEvent, { type: 'recovered' }> => e.type === 'recovered');
      expect(rec, 'something recovered within 40 s').toBeDefined();
      expect(rec!.lootId).toBe(target.id);
      expect(rec!.team).toBe(0);
      expect(rec!.holders).toContain(1);
      expect(rec!.tick).toBeLessThanOrEqual(40 * TICK_RATE);
    });

    it(`${layoutId}: a solo bot uproots a bank and hauls it home along its route`, () => {
      const { sim, bots } = makeMatch(layoutId, [{ team: 0, bot: { personality: 'tongkeun', difficulty: 'normal' } }], 5);
      const banks = sim.state.loot.filter((l) => l.kind === 'bank');
      const spawn = sim.characterBySlot(0).pos;
      const bank = banks.reduce((a, b) => (Math.hypot(a.pos.x - spawn.x, a.pos.y - spawn.y) <= Math.hypot(b.pos.x - spawn.x, b.pos.y - spawn.y) ? a : b));
      const route = sim.layout.bankRoutes.find((r) => r.bankIndex === banks.indexOf(bank) && r.team === 0)!.points;
      bots[0]!.assignTask(sim, { kind: 'haul', targetId: bank.id });
      let maxDev = 0;
      const events = stepMatch(sim, bots, sim.rules.matchTicks, undefined, (s, ev) => {
        const b = s.getLoot(bank.id)!;
        if (!b.recovered && !b.anchored && s.state.tick % 15 === 0) maxDev = Math.max(maxDev, projectOnPolyline(route, b.pos).dist);
        return ev.some((e) => e.type === 'recovered' && e.lootId === bank.id);
      });
      const rec = events.find((e): e is Extract<SimEvent, { type: 'recovered' }> => e.type === 'recovered' && e.lootId === bank.id);
      expect(rec, 'bank recovered within the match time').toBeDefined();
      expect(rec!.team).toBe(0);
      expect(rec!.value).toBe(1000); // building + its untouched contents
      // the bank stayed on its curated route (route clearance is ~5 m; a wandering bank snags)
      expect(maxDev).toBeLessThan(3.5);
      for (const f of sim.layout.bankRoutes.find((r) => r.bankIndex === banks.indexOf(bank) && r.team === 0)!.breaksFences) {
        expect(sim.state.fences.find((x) => x.id === f)!.broken).toBe(true);
      }
    });
  }

  it('plaza: a bot takes the large safe out of a bank through a door and recovers it', () => {
    const { sim, bots } = makeMatch('plaza', [{ team: 0, bot: { personality: 'nunchi', difficulty: 'normal' } }], 9);
    const bank = sim.state.loot.find((l) => l.kind === 'bank')!;
    const large = sim.state.loot.find((l) => l.kind === 'largeSafe' && l.loadedIn === bank.id)!;
    bots[0]!.assignTask(sim, { kind: 'collect', targetId: large.id });
    const doors = BANK_MODEL.doors.map((d) => {
      const c = Math.cos(bank.angle);
      const s = Math.sin(bank.angle);
      return { x: bank.pos.x + d.center.x * c - d.center.y * s, y: bank.pos.y + d.center.x * s + d.center.y * c };
    });
    let exitPos: Vec2 | null = null;
    let wasOnFloor = true;
    const events = stepMatch(sim, bots, 60 * TICK_RATE, undefined, (s, ev) => {
      const l = s.getLoot(large.id)!;
      if (wasOnFloor && l.floorOf === null && !l.recovered) {
        wasOnFloor = false;
        exitPos = { ...l.pos };
      }
      return ev.some((e) => e.type === 'recovered' && e.lootId === large.id);
    });
    expect(events.some((e) => e.type === 'safeUnloaded' && e.safeId === large.id && e.byCharId === 1)).toBe(true);
    // it left the floor at a door (not through a wall)
    expect(exitPos).not.toBeNull();
    const dDoor = Math.min(...doors.map((d) => Math.hypot(d.x - exitPos!.x, d.y - exitPos!.y)));
    expect(dDoor).toBeLessThan(2.2);
    const rec = events.find((e): e is Extract<SimEvent, { type: 'recovered' }> => e.type === 'recovered' && e.lootId === large.id);
    expect(rec).toBeDefined();
    expect(rec!.value).toBe(300);
    expect(sim.getLoot(bank.id)!.estimatedValue).toBe(700);
  });
});
