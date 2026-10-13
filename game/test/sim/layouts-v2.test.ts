/**
 * [C4] Content 2.0 compositions of the existing maps (content-plan §3.2, §6 C4 wave 1) and the v2
 * validator rules: the classic definitions stay byte-identical, every v2 composition passes the
 * validator (4,000, starter sockets, breakables, natural-path crates, item pads, event spots,
 * 돈나무 haul, squeeze, hammerable fences, chirality), the sim builds them, and the validator
 * catches broken compositions (negative tests).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BREAKABLE_SPECS, PROP_SPECS } from '../../src/sim/config';
import { LayoutBuilder } from '../../src/sim/layouts/builder';
import { dist, mirrorPoint } from '../../src/sim/layouts/geometry';
import { LAYOUTS, LAYOUT_META, MATCH_LAYOUT_IDS } from '../../src/sim/layouts/index';
import type { LayoutDesignMeta } from '../../src/sim/layouts/meta';
import {
  BREAKABLE_ZONE_GAP,
  ITEM_PAD_WALK,
  NATURAL_CRATE_WALK,
  STARTER_WALK,
  STARTER_ZONE_GAP,
  TRUCK_HALF,
  V2_TOTAL,
  propValue,
  truckApproach,
  v2TotalValue,
  validateLayout,
  type ValidationReport,
} from '../../src/sim/layouts/validate';
import type { GimmickDef, LayoutDef, LayoutId, LayoutV2Def, OBB } from '../../src/sim/types';
import { main as layoutCheckMain } from '../../tools/layout-check';
import { makeSim } from './fixtures/layouts';

const V2_IDS = MATCH_LAYOUT_IDS;
const reports = new Map<string, ValidationReport>();
function v2Report(id: LayoutId): ValidationReport {
  let r = reports.get(id);
  if (!r) {
    r = validateLayout(LAYOUTS[id], LAYOUT_META[id], { content: 'v2' });
    reports.set(id, r);
  }
  return r;
}
const errors = (r: ValidationReport, code?: string): string[] =>
  r.issues.filter((i) => i.level === 'error' && (!code || i.code === code)).map((i) => `${i.code}: ${i.msg}`);
const codes = (r: ValidationReport): Set<string> => new Set(r.issues.filter((i) => i.level === 'error').map((i) => i.code));

/** sha256 of the classic LayoutDef (everything but `v2`) recorded before the v2 retrofit. */
const CLASSIC_SHA: Readonly<Record<LayoutId, string>> = {
  plaza: 'ed70199931c17a7181f7dae8e36b0d7e0e88c328701dfc2673d738dd36760189',
  shortcut: '3b1db67940acb8e5a2a23dbf8dbb86548d71ed102f8dfc943e73a7252bb683b0',
  counter: '3411549ce7ec746a7628e31ae09a73af3b4fbb9ea68ceba87c5a6b12e66c8615',
  tutorial: 'adfea298673ff0f983a6742c3bbaf272c59f5ed865d50023d1c12dc754c56be6',
} as Record<LayoutId, string>;

function classicSha(def: LayoutDef): string {
  const { v2: _v2, ...classic } = def;
  return createHash('sha256').update(JSON.stringify(classic)).digest('hex');
}

/** A layout with its v2 composition (and optionally its design meta) edited (fast validation: bypass skipped). */
function withV2(id: LayoutId, edit: (v2: LayoutV2Def, def: LayoutDef) => void, editMeta?: (m: LayoutDesignMeta) => void): ValidationReport {
  const def = structuredClone(LAYOUTS[id]);
  edit(def.v2!, def);
  const meta = structuredClone(LAYOUT_META[id]);
  editMeta?.(meta);
  return validateLayout(def, meta, { content: 'v2', skipBypass: true });
}
const warnings = (r: ValidationReport, code?: string): string[] =>
  r.issues.filter((i) => i.level === 'warn' && (!code || i.code === code)).map((i) => `${i.code}: ${i.msg}`);
/** Spawns / pads a layout waives a rule for (the waiver names one; its mirror twin is covered too). */
const waived = (id: LayoutId, rule: string): string[] => (LAYOUT_META[id].waivers ?? []).filter((w) => w.rule === rule).map((w) => w.subject);
const mirrorX = (def: LayoutDef, x: number): number => def.size.x - x;

describe('v2 compositions: classic stays byte-identical', () => {
  it('every classic layout definition (without v2) hashes exactly as before the retrofit', () => {
    for (const id of Object.keys(LAYOUTS) as LayoutId[]) {
      if (!(id in CLASSIC_SHA)) continue; // new maps (C4b) have no pre-retrofit classic record
      expect(classicSha(LAYOUTS[id]), id).toBe(CLASSIC_SHA[id]);
    }
  });

  it('the three match maps carry a v2 composition; the tutorial stays classic', () => {
    for (const id of V2_IDS) expect(LAYOUTS[id].v2, id).toBeDefined();
    expect(LAYOUTS.tutorial.v2).toBeUndefined();
    const r = validateLayout(LAYOUTS.tutorial, LAYOUT_META.tutorial, { content: 'v2', skipBypass: true });
    expect(codes(r).has('v2')).toBe(true);
  });

  it('the classic validation reports content "classic" and still totals 3,200', () => {
    for (const id of V2_IDS) {
      const r = validateLayout(LAYOUTS[id], LAYOUT_META[id], { skipBypass: true });
      expect(r.content).toBe('classic');
      expect(r.metrics.totalValue).toBe(3200);
      expect(r.metrics.v2).toBeUndefined();
    }
  });
});

describe.each(V2_IDS)('v2 composition of %s', (id) => {
  const def = LAYOUTS[id];
  const v2 = def.v2!;
  const axis = def.size.x / 2;

  it('passes every validation check (incl. the bypass)', () => {
    const r = v2Report(id);
    expect(r.content).toBe('v2');
    expect(errors(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.metrics.bypass.failures).toBe(0);
  });

  it('totals 4,000 with the §3.2 composition and balanced halves', () => {
    expect(v2TotalValue(def, v2)).toBe(V2_TOTAL);
    expect(v2Report(id).metrics.totalValue).toBe(V2_TOTAL);
    expect(v2.safes.filter((s) => s.kind === 'smallSafe')).toHaveLength(2);
    expect(v2.safes.filter((s) => s.kind === 'largeSafe')).toHaveLength(2);
    expect(v2.props.filter((p) => p.variant === 'atm')).toHaveLength(2);
    expect(v2.props.filter((p) => p.variant === 'piggy')).toHaveLength(1);
    expect(v2.props.filter((p) => p.variant === 'moneyTree')).toHaveLength(1);
    for (const p of v2.props) if (p.variant !== 'atm') expect(p.pos.x).toBeCloseTo(axis, 6);
    for (const t of ['crate', 'vending'] as const) {
      expect(v2.breakables.filter((b) => b.kind === t && b.center.x < axis)).toHaveLength(t === 'crate' ? 2 : 1);
      expect(v2.breakables.filter((b) => b.kind === t && b.center.x > axis)).toHaveLength(t === 'crate' ? 2 : 1);
    }
    // §3.2 arithmetic: 2,000 banks + 600 large + 200 small + 400 ATMs + 300 돼지 + 300 돈나무 + 200 breakables
    expect(2000 + 600 + 200 + 2 * propValue('atm') + propValue('piggy') + propValue('moneyTree') + 2 * (2 * BREAKABLE_SPECS.crate.inner + BREAKABLE_SPECS.vending.inner)).toBe(4000);
    const sv = v2Report(id).metrics.v2!.sideValue;
    expect(sv[0]).toBe(sv[1]);
  });

  it('mirrors every v2 element (props, breakables, pads with named twins, event spots)', () => {
    for (const p of v2.props) {
      const m = mirrorPoint(p.pos, axis);
      expect(v2.props.some((q) => q.variant === p.variant && dist(q.pos, m) < 1e-6), `${p.variant}`).toBe(true);
    }
    for (const b of v2.breakables) {
      const m = mirrorPoint(b.center, axis);
      expect(v2.breakables.some((q) => q.kind === b.kind && dist(q.center, m) < 1e-6), b.id).toBe(true);
    }
    const pads = new Map(v2.itemPads.map((p) => [p.id, p]));
    expect(v2.itemPads.filter((p) => p.twin === null)).toHaveLength(1);
    for (const p of v2.itemPads) {
      if (p.twin === null) {
        expect(p.pos.x).toBeCloseTo(axis, 6);
        continue;
      }
      const t = pads.get(p.twin)!;
      expect(t.twin).toBe(p.id);
      expect(dist(t.pos, mirrorPoint(p.pos, axis))).toBeLessThan(1e-6);
    }
    expect(v2.eventSpots[0].x).toBeCloseTo(axis, 6);
  });

  it('puts the ATM starter socket 8-12 m from a spawn, 6 m clear of the zone, out of the bank sweeps, haulable by bots', () => {
    const st = v2Report(id).metrics.v2!.starters;
    expect(st).toHaveLength(2);
    for (const s of st) {
      expect(s.walk).toBeGreaterThanOrEqual(STARTER_WALK.min);
      expect(s.walk).toBeLessThanOrEqual(STARTER_WALK.max);
      expect(s.walkFar).toBeGreaterThanOrEqual(s.walk);
      expect(s.zoneGap).toBeGreaterThanOrEqual(STARTER_ZONE_GAP);
      expect(s.sweepGap).toBeGreaterThanOrEqual(0);
      // a 1.6 m lane home with every crate standing (bot large-carry clearance)
      expect(Number.isFinite(s.haul)).toBe(true);
      expect(s.haul).toBeLessThan(12);
    }
    expect(st[0].walk).toBeCloseTo(st[1].walk, 6);
    expect(st[0].haul).toBeCloseTo(st[1].haul, 6);
  });

  it('keeps breakables 6 m from the zones and gives every spawn a crate on its first path (or a stated waiver)', () => {
    const m = v2Report(id).metrics.v2!;
    for (const b of m.breakables) expect(b.zoneGap, b.id).toBeGreaterThanOrEqual(BREAKABLE_ZONE_GAP);
    expect(m.naturalCrates).toHaveLength(def.spawns.length);
    const w = waived(id, 'crate');
    const mirrorOf = (si: number): number => (si + def.spawns.length / 2) % def.spawns.length;
    m.naturalCrates.forEach((n, si) => {
      if (w.includes(`spawn ${si}`) || w.includes(`spawn ${mirrorOf(si)}`)) {
        expect(n, `spawn ${si} is waived, so it has no crate`).toBeNull();
        return;
      }
      expect(n, `spawn ${si}`).not.toBeNull();
      expect(n!.walk).toBeGreaterThanOrEqual(NATURAL_CRATE_WALK.min);
      expect(n!.walk).toBeLessThanOrEqual(NATURAL_CRATE_WALK.max);
      expect(n!.target.startsWith('pad'), 'item pads are never a first target').toBe(false);
    });
    // at most one spawn pair per layout goes without (shortcut: the starter ATM's lane)
    expect(w.length).toBeLessThanOrEqual(1);
  });

  it('places mirrored item pads 12-18 m from each own spawn (or a stated waiver) and clear of the bank sweeps, and a free event spot on the axis', () => {
    const m = v2Report(id).metrics.v2!;
    const w = waived(id, 'pads');
    for (const p of m.pads) {
      if (p.twin === null) continue;
      expect(p.walk, p.id).toBeGreaterThanOrEqual(ITEM_PAD_WALK.min);
      if (!w.includes(`pad ${p.id}`) && !w.includes(`pad ${p.twin}`)) expect(p.walkFar, p.id).toBeLessThanOrEqual(ITEM_PAD_WALK.max);
      expect(p.sweepGap, p.id).toBeGreaterThanOrEqual(0);
    }
    expect(m.spots[0].clearance).toBeGreaterThan(2.1);
    expect(m.spots[0].ringOpen).toBeGreaterThanOrEqual(0.5);
  });

  it('measures the cash-truck drive to event spot 0 from both curbs and parks it clear', () => {
    const t = v2Report(id).metrics.v2!.truck!;
    expect(t.approaches.map((a) => a.from)).toEqual(['north', 'south']);
    expect(t.parkGap).toBeGreaterThanOrEqual(0);
    const open = t.approaches.filter((a) => a.clearance >= TRUCK_HALF.x);
    if (open.length === 0) expect(waived(id, 'truck')).toEqual(['spot 0']);
    else expect(waived(id, 'truck')).toEqual([]);
  });

  it('hauls the 돈나무 home on 2.4 m lanes, equally far for both teams', () => {
    const h = v2Report(id).metrics.v2!.haul;
    expect(h).toHaveLength(1);
    expect(Number.isFinite(h[0].toZone[0])).toBe(true);
    expect(h[0].toZone[0]).toBeCloseTo(h[0].toZone[1], 6);
  });

  it('builds in the sim: v2 = 4,000 with props, breakables and the composition; classic = 3,200', () => {
    const v = makeSim(def, [0, 0, 1, 1], { content: 'v2', events: 'off' });
    expect(v.state.totalValue).toBe(4000);
    expect(v.state.remainingValue).toBe(4000);
    expect(v.state.breakables).toHaveLength(6);
    expect(v.state.loot.filter((l) => l.variant).map((l) => l.variant).sort()).toEqual(['atm', 'atm', 'moneyTree', 'piggy']);
    const c = makeSim(def, [0, 0, 1, 1], { content: 'classic' });
    expect(c.state.totalValue).toBe(3200);
    expect(c.state.breakables).toHaveLength(0);
  });
});

describe('per-map placements behind the review fixes', () => {
  it('shortcut: the ATM lane has no crate in it, the south lane leads spawn 1 past its crate to the small safe', () => {
    const v2 = LAYOUTS.shortcut.v2!;
    const atm = v2.props.find((p) => p.variant === 'atm' && p.pos.x < 35)!;
    // nothing breakable in the 2.5 m north edge lane (x 0..2.5, y 4..15.5)
    expect(v2.breakables.filter((b) => b.center.x < 2.5 && b.center.y > 4 && b.center.y < 15.5)).toEqual([]);
    expect(atm.pos.y).toBeLessThan(15.5);
    const m = v2Report('shortcut').metrics.v2!;
    expect(m.naturalCrates[1]?.target).toMatch(/^safe /);
    expect(m.naturalCrates[1]?.detour).toBeLessThanOrEqual(0.5);
    const small = v2.safes.find((s) => s.kind === 'smallSafe' && s.pos.x < 35)!;
    expect(small.pos.x).toBeLessThan(2.5); // in the south edge lane
    expect(small.pos.y).toBeGreaterThan(34.5);
  });

  it('counter: spawn 1 breaks its crate on the way to the south bank back door', () => {
    const n = v2Report('counter').metrics.v2!.naturalCrates[1];
    expect(n?.id).toBe('crate.south.w');
    expect(n?.target).toMatch(/^bank 1 door/);
    expect(n?.detour).toBeLessThanOrEqual(0.5);
  });

  it('the fence-effect metric starts flush props from the free cell beside them (no ∞ for the shortcut ATMs)', () => {
    for (const s of v2Report('shortcut').metrics.safes) {
      expect(s.fenceEffect, `${s.variant ?? s.kind} ${s.index}`).toBeDefined();
      for (const t of [0, 1]) expect(Number.isFinite(s.fenceEffect!.standing[t]), `${s.variant ?? s.kind} ${s.index}`).toBe(true);
    }
  });

  it('truckApproach: plaza is walled by the docks, counter by the clock tower to the south, shortcut only by its fences', () => {
    const at = (id: LayoutId, from: 'north' | 'south') => truckApproach(LAYOUTS[id], LAYOUTS[id].v2!.eventSpots[0], from);
    expect(at('plaza', 'north').blocker).toBe('dock.n');
    expect(at('plaza', 'south').clearance).toBeLessThan(0);
    expect(at('counter', 'north').clearance).toBeGreaterThanOrEqual(TRUCK_HALF.x);
    expect(at('counter', 'south').blocker).toBe('clock');
    for (const from of ['north', 'south'] as const) {
      const a = at('shortcut', from);
      expect(a.clearance).toBeGreaterThanOrEqual(TRUCK_HALF.x);
      expect(a.fences).toEqual([from === 'north' ? 'fence.north' : 'fence.south']);
      expect(a.banks).toEqual([from === 'north' ? 0 : 1]);
    }
  });
});

describe('shortcut: hammerable fences', () => {
  it('both axis fences have a hammer spot both teams reach equally fast', () => {
    const f = v2Report('shortcut').metrics.v2!.fenceHammer;
    expect(f.map((x) => x.id).sort()).toEqual(['fence.north', 'fence.south']);
    for (const x of f) {
      expect(Number.isFinite(x.walk[0])).toBe(true);
      expect(x.walk[0]).toBeCloseTo(x.walk[1], 6);
    }
  });
});

describe('layout builder: v2 helpers', () => {
  const mk = (): LayoutBuilder =>
    new LayoutBuilder({ id: 'plaza', size: { x: 80, y: 52 }, nameKey: 'n', descKey: 'd', groundStyle: 'plaza' });

  it('emits no v2 composition unless a v2 helper is used', () => {
    expect(mk().build('x').def.v2).toBeUndefined();
  });

  it('mirrors off-axis placements and links pad twins; spot 0 must sit on the axis', () => {
    const b = mk();
    b.v2Safe('smallSafe', 10, 10, 0.3).prop('atm', 12, 20, Math.PI / 2).prop('piggy', 40, 26);
    b.breakable('crate.a', 'crate', 8, 12).breakable('vend', 'vending', 40, 5);
    b.itemPad('pad', 20, 26).itemPad('mid', 40, 30);
    b.eventSpot(40, 18).eventSpot(20, 10);
    const v2 = b.build('x').def.v2!;
    expect(v2.safes.map((s) => s.pos)).toEqual([{ x: 10, y: 10 }, { x: 70, y: 10 }]);
    expect(v2.safes[1].angle).toBeCloseTo(Math.PI - 0.3, 9);
    expect(v2.props.map((p) => [p.variant, p.pos.x])).toEqual([['atm', 12], ['atm', 68], ['piggy', 40]]);
    expect(v2.breakables.map((x) => x.id)).toEqual(['crate.a.w', 'crate.a.e', 'vend']);
    expect(v2.breakables[0].half).toEqual(BREAKABLE_SPECS.crate.half);
    expect(v2.itemPads).toEqual([
      { id: 'pad.w', pos: { x: 20, y: 26 }, twin: 'pad.e' },
      { id: 'pad.e', pos: { x: 60, y: 26 }, twin: 'pad.w' },
      { id: 'mid', pos: { x: 40, y: 30 }, twin: null },
    ]);
    expect(v2.eventSpots).toEqual([{ x: 40, y: 18 }, { x: 20, y: 10 }, { x: 60, y: 10 }]);
    expect(v2.gimmicks).toEqual([]);
    expect(() => mk().eventSpot(10, 10)).toThrow(/axis/);
    expect(() => mk().breakable('a', 'crate', 5, 5).breakable('a', 'crate', 6, 6)).toThrow(/duplicate/);
  });
});

describe('v2 validator catches broken compositions', () => {
  it('flags a missing / extra prop and a broken total', () => {
    const r = withV2('plaza', (v2) => void v2.props.splice(v2.props.findIndex((p) => p.variant === 'piggy'), 1));
    expect(codes(r).has('v2')).toBe(true);
    expect(codes(r).has('total')).toBe(true);
  });

  it('flags an ATM without its mirror twin and a value imbalance', () => {
    const r = withV2('counter', (v2) => {
      const a = v2.props.find((p) => p.variant === 'atm' && p.pos.x < 34)!;
      a.pos = { x: a.pos.x + 0.5, y: a.pos.y };
      const crate = v2.breakables.find((b) => b.kind === 'vending' && b.center.x > 34)!;
      crate.kind = 'crate';
    });
    expect(codes(r).has('symmetry')).toBe(true);
    expect(codes(r).has('balance')).toBe(true);
  });

  it('flags an ATM too close to its zone, too close to the spawn, or in a bank sweep', () => {
    const near = withV2('plaza', (v2, def) => {
      for (const p of v2.props.filter((q) => q.variant === 'atm')) {
        const west = p.pos.x < def.size.x / 2;
        p.pos = { x: west ? 5.5 : mirrorX(def, 5.5), y: 39.5 };
      }
    });
    expect(errors(near, 'starter').some((e) => /outside its zone/.test(e))).toBe(true);
    expect(errors(near, 'starter').some((e) => /walk/.test(e))).toBe(true);
    const swept = withV2('plaza', (v2, def) => {
      for (const p of v2.props.filter((q) => q.variant === 'atm')) {
        const west = p.pos.x < def.size.x / 2;
        p.pos = { x: west ? 20 : mirrorX(def, 20), y: 43 };
      }
    });
    expect(errors(swept, 'starter').some((e) => /sweep/.test(e))).toBe(true);
  });

  it('flags a breakable near a zone, in a bank route, sealing an alley, and a spawn without a natural crate', () => {
    const r = withV2('plaza', (v2, def) => {
      // the north crates (spawn 0's natural crate) move next to the zone
      for (const b of v2.breakables.filter((q) => q.id.startsWith('crate.north'))) {
        const west = b.center.x < def.size.x / 2;
        b.center = { x: west ? 17.6 : mirrorX(def, 17.6), y: 26 };
      }
    });
    expect(errors(r, 'breakable').some((e) => /from a zone/.test(e))).toBe(true);
    const route = withV2('plaza', (v2, def) => {
      for (const b of v2.breakables.filter((q) => q.id.startsWith('crate.south'))) {
        const west = b.center.x < def.size.x / 2;
        b.center = { x: west ? 25 : mirrorX(def, 25), y: 39.5 };
      }
    });
    expect(codes(route).has('route')).toBe(true);
    expect(codes(route).has('crate')).toBe(true);
    // a crate in the 1.1 m bakery alley (x = 12, y 2.5..6.5) plugs it
    const plug = withV2('plaza', (v2, def) => {
      for (const b of v2.breakables.filter((q) => q.id.startsWith('crate.north'))) {
        const west = b.center.x < def.size.x / 2;
        b.center = { x: west ? 12 : mirrorX(def, 12), y: 4.5 };
      }
    });
    expect(errors(plug, 'breakable').some((e) => /plugs narrow alley alley\.n1/.test(e))).toBe(true);
    expect(codes(plug).has('crate')).toBe(true); // spawn 0 lost its natural crate
  });

  it('flags lanes sealed by breakables / anchored loot (squeeze)', () => {
    // shortcut: crates beside the ATM in the north edge lane, flush on the arena edge too -> sealed
    const r = withV2('shortcut', (v2, def) => {
      for (const side of [0, 1]) {
        const x = side === 0 ? 0.5 : mirrorX(def, 0.5);
        const atm = v2.props.find((p) => p.variant === 'atm')!;
        v2.breakables.push({ id: `plug.${side}`, kind: 'crate', center: { x, y: atm.pos.y }, half: { ...BREAKABLE_SPECS.crate.half }, angle: 0 });
      }
    });
    expect(codes(r).has('squeeze')).toBe(true);
  });

  it('flags a 돈나무 with no 2.4 m haul lane (propHaul)', () => {
    // the empty north arcade courtyard: only 1.1 m alleys lead out
    const r = withV2('shortcut', (v2) => {
      v2.props.find((p) => p.variant === 'moneyTree')!.pos = { x: 22.5, y: 12.2 }; // beside the courtyard crate
    });
    expect(errors(r, 'propHaul').some((e) => /no haul path to zone 0/.test(e))).toBe(true);
  });

  it('flags item pads off their twins, in a sweep, too far, and event spots off the axis / on a solid', () => {
    const r = withV2('counter', (v2, def) => {
      // a second pair: the west pad off its twin, the east one ...
      v2.itemPads.push({ id: 'p2.w', pos: { x: 15.5, y: 16.5 }, twin: 'p2.e' }, { id: 'p2.e', pos: { x: mirrorX(def, 15.5), y: 15.5 }, twin: 'p2.w' });
      const yard = v2.itemPads.filter((p) => p.id.startsWith('pad.yard'));
      for (const p of yard) p.pos = { x: p.pos.x < def.size.x / 2 ? 20 : mirrorX(def, 20), y: 22 }; // diagonal sweep
      v2.eventSpots[0] = { x: 30, y: 24 };
    });
    expect(codes(r).has('symmetry')).toBe(true);
    expect(errors(r, 'pads').some((e) => /sweep/.test(e))).toBe(true);
    expect(errors(r, 'spots').some((e) => /axis/.test(e))).toBe(true);
    const solid = withV2('counter', (v2) => {
      v2.eventSpots[0] = { x: 34, y: 22.4 }; // next to the clock tower
      v2.itemPads.find((p) => p.twin === null)!.twin = 'pad.yard.w';
    });
    expect(errors(solid, 'spots').some((e) => /free ground/.test(e))).toBe(true);
    expect(codes(solid).has('symmetry')).toBe(true);
  });

  it('measures item pads from EACH own spawn: the old north-terrace pad is 23 m from spawn 1', () => {
    const r = withV2('counter', (v2, def) => {
      for (const p of v2.itemPads.filter((q) => q.twin !== null)) p.pos = { x: p.pos.x < def.size.x / 2 ? 15.5 : mirrorX(def, 15.5), y: 15.5 };
    });
    expect(errors(r, 'pads').some((e) => /15\.7 \/ 23\.2 m walk from its own spawns/.test(e))).toBe(true);
  });

  it('never counts an item pad as a first target (they stay empty until the first drop)', () => {
    // shortcut as first shipped: the small safe back in the south courtyard, the pad in the south
    // lane behind spawn 1's crate -> the crate leads to nothing spawn 1 can act on at kickoff
    const r = withV2('shortcut', (v2, def) => {
      for (const s of v2.safes.filter((q) => q.kind === 'smallSafe')) s.pos = { x: s.pos.x < def.size.x / 2 ? 20.5 : mirrorX(def, 20.5), y: 39 };
      for (const p of v2.itemPads.filter((q) => q.twin !== null)) p.pos = { x: p.pos.x < def.size.x / 2 ? 1.25 : mirrorX(def, 1.25), y: 41.5 };
    });
    expect(errors(r, 'crate').some((e) => /spawn 1 has no crate/.test(e))).toBe(true);
    expect(errors(r, 'crate').some((e) => /spawn 3 has no crate/.test(e))).toBe(true);
  });

  it('flags a starter ATM fronted by a crate bots cannot haul past (the shipped shortcut lane)', () => {
    const r = withV2('shortcut', (v2, def) => {
      for (const a of v2.props.filter((p) => p.variant === 'atm')) a.pos = { x: a.pos.x, y: 10.5 };
      for (const side of [0, 1]) {
        const x = side === 0 ? 2.44 - 0.45 : mirrorX(def, 2.44 - 0.45);
        v2.breakables.push({ id: `lane.${side}`, kind: 'crate', center: { x, y: 13 }, half: { ...BREAKABLE_SPECS.crate.half }, angle: 0 });
      }
      // keep the per-side counts: drop the courtyard crates
      v2.breakables = v2.breakables.filter((b) => !b.id.startsWith('crate.court'));
    });
    expect(errors(r, 'starter').some((e) => /cannot be hauled to its zone on a 1\.6 m lane/.test(e))).toBe(true);
    expect(codes(r).has('squeeze')).toBe(false); // a hand-carried ATM still squeezes past
  });

  it('waivers: a waived rule prints its reason as a warning, a stale waiver is an error', () => {
    const plain = withV2('shortcut', () => {}, (m) => void delete m.waivers);
    expect(errors(plain, 'crate').some((e) => /spawn 0 has no crate/.test(e))).toBe(true);
    expect(errors(plain, 'pads').length).toBe(2);
    const shipped = withV2('shortcut', () => {});
    expect(errors(shipped)).toEqual([]);
    expect(warnings(shipped, 'waived').some((w) => /spawn 2 has no crate.*waived: /.test(w))).toBe(true);
    const stale = withV2('counter', () => {}, (m) => void (m.waivers = [{ rule: 'crate', subject: 'spawn 0', reason: 'test' }]));
    expect(errors(stale, 'waiver').some((e) => /matches no failing check/.test(e))).toBe(true);
    const plaza = withV2('plaza', () => {}, (m) => void delete m.waivers);
    expect(errors(plaza, 'truck').some((e) => /no curb approach/.test(e))).toBe(true);
  });

  it('flags a fence no hammer can reach', () => {
    const r = withV2('shortcut', (_v2, def) => {
      // a tiny fence deep inside the ramen shop (and its mirror): nobody stands within 1.7 m of it
      def.fences.push({ id: 'buried.w', center: { x: 13.8, y: 11 }, half: { x: 0.15, y: 0.15 }, angle: 0 });
      def.fences.push({ id: 'buried.e', center: { x: mirrorX(def, 13.8), y: 11 }, half: { x: 0.15, y: 0.15 }, angle: 0 });
    });
    expect(codes(r).has('fenceHammer')).toBe(true);
  });

  it('enforces gimmick chirality and clear landing / exit discs', () => {
    const box = (x: number, y: number, a = 0): OBB => ({ center: { x, y }, half: { x: 1, y: 0.6 }, angle: a });
    const mirrorOk: GimmickDef[] = [
      { id: 'belt.w', kind: 'belt', obb: box(20, 26), dir: 0, speed: 2.2 },
      { id: 'belt.e', kind: 'belt', obb: box(60, 26), dir: Math.PI, speed: 2.2 },
      { id: 'show', kind: 'fountainShow', center: { x: 40, y: 26 }, radius: 4.5, firstTick: 1800, periodTicks: 2400, telegraphTicks: 120, push: 6 },
      { id: 'cup.w', kind: 'teacup', center: { x: 20, y: 40 }, radius: 4.5, stepAngle: Math.PI / 2, moveTicks: 90, restTicks: 180, spin: 1, twin: 'cup.e' },
      { id: 'cup.e', kind: 'teacup', center: { x: 60, y: 40 }, radius: 4.5, stepAngle: Math.PI / 2, moveTicks: 90, restTicks: 180, spin: -1, twin: 'cup.w' },
    ];
    const ok = withV2('plaza', (v2) => void (v2.gimmicks = structuredClone(mirrorOk)));
    expect(codes(ok).has('chirality')).toBe(false);
    const bad = withV2('plaza', (v2) => {
      v2.gimmicks = structuredClone(mirrorOk);
      (v2.gimmicks[1] as Extract<GimmickDef, { kind: 'belt' }>).dir = 0; // both belts run east
      (v2.gimmicks[4] as Extract<GimmickDef, { kind: 'teacup' }>).spin = 1; // same spin: chiral
      v2.gimmicks.push({ id: 'lone', kind: 'teacup', center: { x: 40, y: 44 }, radius: 3, stepAngle: 1, moveTicks: 60, restTicks: 60, spin: 1, twin: null });
      v2.gimmicks.push({ id: 'cat.w', kind: 'catapult', seat: box(14, 20), pedal: box(16, 20), landing: { x: 4.2, y: 3.6 }, flightTicks: 66, cooldownTicks: 180, twin: 'cat.e' });
      v2.gimmicks.push({ id: 'cat.e', kind: 'catapult', seat: box(66, 20), pedal: box(64, 20), landing: { x: 75.8, y: 3.6 }, flightTicks: 66, cooldownTicks: 180, twin: 'cat.w' });
    });
    const chir = errors(bad, 'chirality');
    expect(chir.some((e) => /belt\.w|belt\.e/.test(e))).toBe(true);
    expect(chir.some((e) => /cup\.w/.test(e))).toBe(true);
    expect(chir.some((e) => /lone/.test(e))).toBe(true);
    expect(errors(bad, 'landing').length).toBeGreaterThan(0); // landing inside the cafe on the north row
  });

  it('layout-check CLI validates both compositions and refuses a bad --content', () => {
    expect(layoutCheckMain(['--fast', '--only=counter', '--content=v2'])).toBe(0);
    expect(layoutCheckMain(['--fast', '--content=bogus'])).toBe(2);
  });
});

// keep the prop spec import honest (the ATM stands flush on shop fronts by its half depth)
it('PROP_SPECS ATM depth is what the flush placements assume', () => {
  expect(PROP_SPECS.atm.half.y).toBeCloseTo(0.45, 9);
});
