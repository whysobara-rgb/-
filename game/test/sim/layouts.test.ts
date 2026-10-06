/**
 * Layout validation (doc §3, §6, §8, §9, §16). Geometry only — independent of the
 * physics core. The heavy lifting lives in src/sim/layouts/validate.ts, shared with
 * tools/layout-check.ts; this file asserts every requirement explicitly and also
 * proves the validator catches broken layouts (negative tests).
 */
import { describe, expect, it } from 'vitest';
import { BANK_MODEL, POLICE_CAR, SCORE, ZONE_DEFAULT_HALF } from '../../src/sim/config';
import { officerStepOutSpot } from '../../src/sim/police';
import type { LayoutDef, LayoutId } from '../../src/sim/types';
import { LAYOUTS, LAYOUT_META, LAYOUT_STRINGS, MATCH_LAYOUT_IDS, getChokepoint, getLayout } from '../../src/sim/layouts/index';
import {
  INTERIOR_FAIRNESS_TOL,
  MIN_DRESSING,
  MIN_ONE_SPOT_DOOR_COVER,
  bankDoorExteriors,
  layoutStringKeys,
  validateLayout,
  validateLayoutSet,
  type ValidationReport,
} from '../../src/sim/layouts/validate';
import { main as layoutCheckMain } from '../../tools/layout-check';
import { dist, mirrorPoint } from '../../src/sim/layouts/geometry';

const ALL_IDS = Object.keys(LAYOUTS) as LayoutId[];
const reports = new Map<LayoutId, ValidationReport>();
function report(id: LayoutId): ValidationReport {
  let r = reports.get(id);
  if (!r) {
    r = validateLayout(LAYOUTS[id], LAYOUT_META[id]);
    reports.set(id, r);
  }
  return r;
}
const errors = (r: ValidationReport, code?: string): string[] =>
  r.issues.filter((i) => i.level === 'error' && (!code || i.code === code)).map((i) => `${i.code}: ${i.msg}`);

function clone(def: LayoutDef): LayoutDef {
  return structuredClone(def);
}

describe('layout registry', () => {
  it('exposes the three match layouts and the tutorial', () => {
    expect(MATCH_LAYOUT_IDS).toEqual(['plaza', 'shortcut', 'counter']);
    expect(ALL_IDS.sort()).toEqual(['counter', 'plaza', 'shortcut', 'tutorial']);
    for (const id of ALL_IDS) {
      expect(getLayout(id).id).toBe(id);
      expect(LAYOUT_META[id].paths.length).toBeGreaterThan(0);
    }
    expect(() => getLayout('nope' as LayoutId)).toThrow();
    expect(getChokepoint('plaza', 'choke.plaza.fountain')?.nameKey).toBe('choke.plaza.fountain');
  });

  it('has Korean and English strings for every key a layout uses', () => {
    for (const def of Object.values(LAYOUTS)) {
      for (const k of layoutStringKeys(def)) {
        expect(LAYOUT_STRINGS.ko[k], `ko ${k}`).toBeTruthy();
        expect(LAYOUT_STRINGS.en[k], `en ${k}`).toBeTruthy();
      }
    }
    expect(Object.keys(LAYOUT_STRINGS.ko).sort()).toEqual(Object.keys(LAYOUT_STRINGS.en).sort());
  });
});

describe.each(ALL_IDS)('layout %s', (id) => {
  const def = LAYOUTS[id];
  const isMatch = id !== 'tutorial';

  it('passes every validation check', () => {
    const r = report(id);
    expect(errors(r)).toEqual([]);
  });

  it('has the expected size, teams and loot total', () => {
    const r = report(id);
    if (isMatch) {
      expect(def.size.x).toBeGreaterThanOrEqual(64);
      expect(def.size.x).toBeLessThanOrEqual(80);
      expect(def.size.y).toBeGreaterThanOrEqual(44);
      expect(def.size.y).toBeLessThanOrEqual(52);
      expect(def.zones.map((z) => z.team).sort()).toEqual([0, 1]);
      expect(def.spawns.filter((s) => s.team === 0)).toHaveLength(2);
      expect(def.spawns.filter((s) => s.team === 1)).toHaveLength(2);
      expect(def.banks).toHaveLength(2);
      expect(def.safes.filter((s) => s.kind === 'smallSafe')).toHaveLength(6);
      expect(def.safes.filter((s) => s.kind === 'largeSafe')).toHaveLength(2);
      expect(r.metrics.totalValue).toBe(3200);
      // Doc §9 arithmetic: 10 small + 4 large + 2 bank bodies = 3200.
      const interior = BANK_MODEL.interior.reduce((a, s) => a + SCORE[s.kind], 0);
      expect(6 * SCORE.smallSafe + 2 * SCORE.largeSafe + 2 * (SCORE.bankBuilding + interior)).toBe(3200);
    } else {
      expect(def.size).toEqual({ x: 40, y: 28 });
      expect(def.zones).toHaveLength(1);
      expect(def.spawns).toHaveLength(1);
      expect(def.banks).toHaveLength(1);
      expect(def.safes.every((s) => s.kind === 'smallSafe')).toBe(true);
      expect(def.safes.length).toBeGreaterThanOrEqual(2);
      expect(def.safes.length).toBeLessThanOrEqual(3);
    }
  });

  it('places west team 0 / east team 1 zones with the van just outside on the far side', () => {
    for (const z of def.zones) {
      expect(z.half).toEqual(ZONE_DEFAULT_HALF);
      if (z.team === 0) {
        expect(z.center.x).toBeLessThan(def.size.x / 2);
        expect(z.vanPos.x).toBeLessThan(z.center.x - z.half.x);
      } else {
        expect(z.center.x).toBeGreaterThan(def.size.x / 2);
        expect(z.vanPos.x).toBeGreaterThan(z.center.x + z.half.x);
      }
    }
    expect(errors(report(id), 'zone')).toEqual([]);
    expect(errors(report(id), 'van')).toEqual([]);
  });

  it('is perfectly mirror-symmetric', () => {
    expect(errors(report(id), 'symmetry')).toEqual([]);
    if (isMatch) {
      const axis = def.size.x / 2;
      for (const b of def.banks) {
        expect(b.pos.x).toBeCloseTo(axis, 6);
        const k = Math.round(b.angle / (Math.PI / 2));
        expect(Math.abs(b.angle - (k * Math.PI) / 2)).toBeLessThan(1e-6);
      }
      for (const s of def.safes) {
        const m = mirrorPoint(s.pos, axis);
        expect(def.safes.some((t) => t.kind === s.kind && dist(t.pos, m) < 1e-6)).toBe(true);
      }
    }
  });

  it('keeps banks far enough apart that one spot cannot guard both', () => {
    if (!isMatch) return;
    const m = report(id).metrics;
    expect(m.bankSeparation).toBeGreaterThanOrEqual(24);
    // Doc §6: no walkable spot is within ~2 s of a door of both banks.
    expect(m.oneSpot.anyDoor).toBeGreaterThanOrEqual(MIN_ONE_SPOT_DOOR_COVER);
    expect(m.oneSpot.allDoors).toBeGreaterThan(m.oneSpot.anyDoor);
  });

  it('gives both teams the same chances at every bank interior', () => {
    if (!isMatch) return;
    const m = report(id).metrics;
    expect(m.interior).toHaveLength(def.banks.length * BANK_MODEL.interior.length);
    // Interior value balances across the mirror axis.
    let balance = 0;
    for (const it of m.interior) {
      const dx = it.pos.x - def.size.x / 2;
      if (Math.abs(dx) > 1e-3) balance += Math.sign(dx) * SCORE[it.kind];
    }
    expect(balance).toBe(0);
    // Every interior safe has a same-bank twin whose team 1 distances equal its team 0 ones.
    for (const s of m.interior) {
      const twin = m.interior.find(
        (q) =>
          q.bankIndex === s.bankIndex &&
          q.kind === s.kind &&
          Math.abs(s.walk[0] - q.walk[1]) <= INTERIOR_FAIRNESS_TOL &&
          Math.abs(s.carry[0] - q.carry[1]) <= INTERIOR_FAIRNESS_TOL,
      );
      expect(twin, `${id} bank ${s.bankIndex} ${s.kind}`).toBeDefined();
    }
    expect(errors(report(id), 'interior')).toEqual([]);
  });

  it('sweeps a 5 m disc along every curated bank route without touching anything', () => {
    const r = report(id);
    expect(errors(r, 'route')).toEqual([]);
    for (const rt of r.metrics.routes) expect(rt.minClearance).toBeGreaterThanOrEqual(5 - 1e-6);
    for (const b of def.banks.keys()) {
      for (const z of def.zones) expect(def.bankRoutes.some((rt) => rt.bankIndex === b && rt.team === z.team)).toBe(true);
    }
  });

  it('has alleys and lanes of the declared width classes', () => {
    const r = report(id);
    expect(errors(r, 'path')).toEqual([]);
    for (const p of r.metrics.paths) {
      if (p.cls === 'narrow') {
        expect(p.minWidth).toBeGreaterThanOrEqual(1.05 - 1e-3);
        expect(p.maxWidth).toBeLessThan(1.2); // a large safe's narrow side never fits
      } else {
        expect(p.minWidth).toBeGreaterThanOrEqual(2.0 - 1e-3);
        expect(p.maxWidth).toBeLessThanOrEqual(3.0 + 1e-3);
      }
    }
    if (isMatch) {
      expect(r.metrics.paths.some((p) => p.cls === 'narrow')).toBe(true);
      expect(r.metrics.paths.some((p) => p.cls === 'medium')).toBe(true);
    }
  });

  it('lets every spawn reach every safe and bank, and every safe reach both zones by size class', () => {
    const r = report(id);
    expect(errors(r, 'reach')).toEqual([]);
    for (const s of r.metrics.safes) {
      for (const d of s.walkFromSpawn) expect(Number.isFinite(d)).toBe(true);
      for (const z of def.zones) expect(Number.isFinite(s.carryToZone[z.team])).toBe(true);
    }
    for (const row of r.metrics.spawnToBank) for (const d of row) expect(Number.isFinite(d)).toBe(true);
  });

  it('keeps a small-safe bypass open with both banks anywhere along their routes', () => {
    const r = report(id);
    expect(r.metrics.bypass.combos).toBeGreaterThan(0);
    expect(r.metrics.bypass.failures).toBe(0);
  });

  it('has 4..8 named chokepoints on walkable ground, never on loot (match layouts)', () => {
    if (isMatch) {
      expect(def.chokepoints.length).toBeGreaterThanOrEqual(4);
      expect(def.chokepoints.length).toBeLessThanOrEqual(8);
    }
    for (const c of def.chokepoints) {
      for (const sf of def.safes) expect(dist(c.pos, sf.pos), `${c.id} vs safe`).toBeGreaterThan(1.2);
    }
    expect(errors(report(id), 'choke')).toEqual([]);
  });

  it('uses every shop sign once, so chokepoint names point at one landmark', () => {
    const signs = def.statics.flatMap((s) => (s.signKey ? [s.signKey] : []));
    expect(new Set(signs).size).toBe(signs.length);
  });

  it('never overlaps statics with loot, spawns or zones, and keeps decor out of alleys and zone paint', () => {
    const r = report(id);
    for (const code of ['safe', 'bank', 'spawn', 'decor']) expect(errors(r, code)).toEqual([]);
  });

  it('has police entries north then south at the curb outside the arena (on the mirror axis for matches)', () => {
    const entries = def.policeEntries ?? [];
    expect(entries.length).toBe(2);
    // the car never sits on the play field: it parks beyond the north / south edge ...
    expect(entries[0]!.park.y + POLICE_CAR.half.y).toBeLessThan(0);
    expect(entries[1]!.park.y - POLICE_CAR.half.y).toBeGreaterThan(def.size.y);
    // ... and officers hop in just inside that edge
    for (const e of entries) {
      for (let k = 0; k < 2; k++) {
        const p = officerStepOutSpot(e, k, def.size);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(def.size.x);
        expect(Math.min(p.y, def.size.y - p.y)).toBeCloseTo(0.75, 9);
      }
    }
    if (isMatch) {
      for (const e of entries) {
        expect(e.park.x).toBeCloseTo(def.size.x / 2, 9);
        expect(e.from.x).toBeCloseTo(def.size.x / 2, 9);
      }
    }
    for (const e of entries) {
      // the car drives in from off-screen on the same side, never across the arena
      expect(e.park.y < 0 ? e.from.y : def.size.y - e.from.y).toBeLessThan(-POLICE_CAR.curb);
    }
    expect(errors(report(id), 'police')).toEqual([]);
  });
});

describe('layout identities (doc §9 table)', () => {
  it('plaza: easy outer small safes, long forced-around bank paths', () => {
    const r = report('plaza');
    for (const rt of r.metrics.routes) expect(rt.length).toBeGreaterThan(rt.straight * 1.15);
    const nearest = Math.min(...r.metrics.safes.filter((s) => s.kind === 'smallSafe').map((s) => s.walkFromSpawn[0]));
    expect(nearest).toBeLessThan(15);
    expect(errors(r, 'identity')).toEqual([]);
  });

  it('shortcut: bank routes bust mirrored weak fences and the gap shortens safe carries', () => {
    const def = LAYOUTS.shortcut;
    const r = report('shortcut');
    // The fence is the court's only bank-wide exit.
    for (const row of r.metrics.fenceFreeBankTrip) for (const d of row) expect(d).toBe(Infinity);
    expect(def.fences.length).toBeGreaterThanOrEqual(2);
    expect(def.fences.length).toBeLessThanOrEqual(4);
    for (const rt of def.bankRoutes) expect(rt.breaksFences.length).toBeGreaterThan(0);
    const gain = Math.max(...r.metrics.safes.map((s) => (s.fenceEffect ? s.fenceEffect.standing[0] - s.fenceEffect.busted[0] : 0)));
    expect(gain).toBeGreaterThanOrEqual(10);
    expect(errors(r, 'identity')).toEqual([]);
  });

  it('counter: every bank has a door facing the shared central crossing', () => {
    const def = LAYOUTS.counter;
    const c = { x: def.size.x / 2, y: def.size.y / 2 };
    for (const b of def.banks) {
      const facing = bankDoorExteriors(b).some((d) => {
        const to = { x: c.x - d.pos.x, y: c.y - d.pos.y };
        return (to.x * d.normal.x + to.y * d.normal.y) / Math.hypot(to.x, to.y) > 0.9;
      });
      expect(facing).toBe(true);
    }
    expect(errors(report('counter'), 'identity')).toEqual([]);
  });

  it('tutorial: nearby small safe, bank route busts the weak fence', () => {
    const r = report('tutorial');
    expect(Math.min(...r.metrics.safes.map((s) => s.walkFromSpawn[0]))).toBeLessThanOrEqual(10);
    expect(LAYOUTS.tutorial.bankRoutes[0].breaksFences).toHaveLength(1);
    // The bank cannot get home without busting the fence.
    expect(r.metrics.fenceFreeBankTrip[0][0]).toBe(Infinity);
    expect(errors(r, 'identity')).toEqual([]);
  });

  it('cross-layout: distinct distances, dense dressing, shared vocabulary', () => {
    const set = validateLayoutSet({
      layouts: LAYOUTS,
      matchIds: MATCH_LAYOUT_IDS,
      strings: LAYOUT_STRINGS,
      reports: MATCH_LAYOUT_IDS.map((id) => report(id)),
    });
    expect(set.filter((i) => i.level === 'error').map((i) => i.msg)).toEqual([]);
    expect(set.filter((i) => i.level === 'warn').map((i) => i.msg)).toEqual([]);
  });

  it('cross-layout: every match layout uses the full set-dressing vocabulary', () => {
    for (const id of MATCH_LAYOUT_IDS) {
      const def = LAYOUTS[id];
      for (const [kind, min] of Object.entries(MIN_DRESSING)) {
        const n = def.statics.filter((s) => s.kind === kind).length + def.circles.filter((c) => c.kind === kind).length;
        expect(n, `${id} ${kind}`).toBeGreaterThanOrEqual(min);
      }
    }
  });
});

describe('validator catches broken layouts', () => {
  const base = LAYOUTS.plaza;
  const meta = LAYOUT_META.plaza;
  const fast = { skipBypass: true };

  it('flags a safe without a mirror twin', () => {
    const d = clone(base);
    d.safes[0].pos.y += 1;
    expect(errors(validateLayout(d, meta, fast), 'symmetry').length).toBeGreaterThan(0);
  });

  it('flags a wrong loot total', () => {
    const d = clone(base);
    d.safes.pop();
    expect(errors(validateLayout(d, meta, fast), 'total').length).toBeGreaterThan(0);
  });

  it('flags a static blocking a bank route', () => {
    const d = clone(base);
    const p = d.bankRoutes[0].points[1];
    d.circles.push({ id: 'blocker', kind: 'tree', center: { x: p.x, y: p.y + 4 }, radius: 0.5, height: 4 });
    expect(errors(validateLayout(d, meta, fast), 'route').length).toBeGreaterThan(0);
  });

  it('flags an alley wide enough for a large safe', () => {
    const d = clone(base);
    const shop = d.statics.find((s) => s.id === 'shop.n0.w')!;
    shop.half.x -= 0.1; // widens the bakery alley to ~1.2 m
    shop.center.x -= 0.1;
    expect(errors(validateLayout(d, meta, fast), 'path').length).toBeGreaterThan(0);
  });

  it('flags a safe sealed off from the zones', () => {
    const d = clone(base);
    const s = d.safes[0];
    for (const [dx, dy] of [
      [0, -1.2],
      [0, 1.2],
      [-1.2, 0],
      [1.2, 0],
    ]) {
      d.statics.push({ id: `cage${dx}${dy}`, kind: 'wall', center: { x: s.pos.x + dx, y: s.pos.y + dy }, half: { x: dx ? 0.2 : 1.4, y: dy ? 0.2 : 1.4 }, angle: 0, height: 1 });
    }
    expect(errors(validateLayout(d, meta, fast), 'reach').length).toBeGreaterThan(0);
  });

  it('flags banks that cut off the small-safe bypass', () => {
    const d = clone(LAYOUTS.tutorial);
    // Seal both side gates: with the bank parked in the fence gap nothing can get through.
    d.statics.push({ id: 'plugN', kind: 'wall', center: { x: 20, y: 2.75 }, half: { x: 0.5, y: 1.3 }, angle: 0, height: 1 });
    d.statics.push({ id: 'plugS', kind: 'wall', center: { x: 20, y: 25.25 }, half: { x: 0.5, y: 1.3 }, angle: 0, height: 1 });
    const r = validateLayout(d, LAYOUT_META.tutorial);
    expect(r.metrics.bypass.failures).toBeGreaterThan(0);
  });

  it('keeps bank interiors balanced for any bank angle (BANK_MODEL.interior is mirror-symmetric)', () => {
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const d = clone(LAYOUTS.counter);
      d.banks[0].angle = angle;
      d.banks[1].angle = angle;
      const msgs = errors(validateLayout(d, LAYOUT_META.counter, fast), 'symmetry');
      expect(msgs.some((m) => m.includes('bank interiors favor'))).toBe(false);
    }
  });

  it('flags a fence a bank could simply drive around', () => {
    const d = clone(LAYOUTS.tutorial);
    // A 1 m fence alone still blocks (the two 4 m gaps are narrower than any bank), so also
    // open the north divider wall and hedge: now the bank can roll around the fence.
    d.fences[0].half.y = 0.5;
    d.statics = d.statics.filter((s) => s.id !== 'wall.nm' && s.id !== 'hedge.n');
    const r = validateLayout(d, LAYOUT_META.tutorial, fast);
    expect(errors(r, 'fence').length + errors(r, 'identity').length).toBeGreaterThan(0);
    expect(Number.isFinite(r.metrics.fenceFreeBankTrip[0][0])).toBe(true);
  });

  it('flags a chokepoint placed on a safe', () => {
    const d = clone(base);
    d.chokepoints[0].pos = { ...d.safes[0].pos };
    expect(errors(validateLayout(d, meta, fast), 'choke').length).toBeGreaterThan(0);
  });

  it('flags banks whose doors one spot can guard', () => {
    const d = clone(LAYOUTS.counter);
    d.banks[0].pos.y += 2;
    d.banks[1].pos.y -= 2;
    const msgs = errors(validateLayout(d, LAYOUT_META.counter, fast), 'banks');
    expect(msgs.some((m) => m.includes('one spot'))).toBe(true);
  });

  it('flags duplicate shop signs and missing dressing kinds across layouts', () => {
    const d = clone(LAYOUTS.counter);
    const signed = d.statics.filter((s) => s.signKey);
    signed[1].signKey = signed[0].signKey;
    d.statics = d.statics.filter((s) => s.kind !== 'kiosk');
    const set = validateLayoutSet({
      layouts: { ...LAYOUTS, counter: d },
      matchIds: MATCH_LAYOUT_IDS,
      strings: LAYOUT_STRINGS,
      reports: MATCH_LAYOUT_IDS.map((id) => report(id)),
    });
    const msgs = set.filter((i) => i.level === 'error').map((i) => i.msg);
    expect(msgs.some((m) => m.includes('used more than once'))).toBe(true);
    expect(msgs.some((m) => m.includes('kiosk'))).toBe(true);
  });

  it('layout-check CLI refuses unknown ids and arguments instead of reporting success', () => {
    const quiet = { log: console.log, error: console.error };
    console.log = console.error = () => {};
    try {
      expect(layoutCheckMain(['--only=bogus'])).toBe(2);
      expect(layoutCheckMain(['--only='])).toBe(2);
      expect(layoutCheckMain(['--fats'])).toBe(2);
      expect(layoutCheckMain(['--fast', '--only=tutorial'])).toBe(0);
    } finally {
      console.log = quiet.log;
      console.error = quiet.error;
    }
  });

  it('flags police cars off the axis, on the field, driving across it, with a blocked or walled-off step-in, and missing entries', () => {
    const off = clone(base);
    off.policeEntries![0]!.park.x += 3;
    off.policeEntries![0]!.from.x += 3;
    expect(errors(validateLayout(off, meta, fast), 'symmetry').some((m) => m.includes('police'))).toBe(true);
    // parked inside the arena (on the service lane / on a safe): never allowed any more
    const inside = clone(base);
    inside.policeEntries![0]!.park = { x: inside.size.x / 2, y: 1.25 };
    expect(errors(validateLayout(inside, meta, fast), 'police').some((m) => m.includes('curb outside'))).toBe(true);
    const onSafe = clone(base);
    const large = onSafe.safes.find((sf) => sf.kind === 'largeSafe')!;
    onSafe.policeEntries![0]!.park = { x: large.pos.x, y: large.pos.y };
    expect(errors(validateLayout(onSafe, meta, fast), 'police').some((m) => m.includes('curb outside'))).toBe(true);
    // too far out to hop in from
    const far = clone(base);
    far.policeEntries![0]!.park.y = -6;
    expect(errors(validateLayout(far, meta, fast), 'police').some((m) => m.includes('> 3 m'))).toBe(true);
    // drive-in through the arena (from the opposite edge)
    const across = clone(base);
    across.policeEntries![0]!.from = { x: across.size.x / 2, y: across.size.y + 12 };
    expect(errors(validateLayout(across, meta, fast), 'police').some((m) => m.includes('crosses the arena'))).toBe(true);
    // a safe parked on the step-in spot
    const blocked = clone(base);
    const p0 = officerStepOutSpot(blocked.policeEntries![0]!, 0, blocked.size);
    blocked.safes.push({ kind: 'smallSafe', pos: { x: p0.x, y: p0.y + 0.3 }, angle: 0 });
    expect(errors(validateLayout(blocked, meta, fast), 'police').some((m) => m.includes('no room to step in'))).toBe(true);
    // a step-in pocket walled off from the field
    const sealed = clone(base);
    const q = officerStepOutSpot(sealed.policeEntries![0]!, 0, sealed.size);
    // a tiny walled yard around officer 0's spot (open only to the boundary)
    sealed.statics.push(
      { id: 'sealS', kind: 'wall', center: { x: q.x, y: q.y + 0.9 }, half: { x: 0.9, y: 0.15 }, angle: 0, height: 1 },
      { id: 'sealW', kind: 'wall', center: { x: q.x - 0.9, y: (q.y + 0.9) / 2 }, half: { x: 0.15, y: (q.y + 0.9) / 2 }, angle: 0, height: 1 },
      { id: 'sealE', kind: 'wall', center: { x: q.x + 0.9, y: (q.y + 0.9) / 2 }, half: { x: 0.15, y: (q.y + 0.9) / 2 }, angle: 0, height: 1 },
    );
    expect(errors(validateLayout(sealed, meta, fast), 'police').some((m) => m.includes('walled off'))).toBe(true);
    const none = clone(base);
    delete none.policeEntries;
    expect(errors(validateLayout(none, meta, fast), 'police').length).toBeGreaterThan(0);
    const sameHalf = clone(base);
    sameHalf.policeEntries![1] = structuredClone(sameHalf.policeEntries![0]!);
    expect(errors(validateLayout(sameHalf, meta, fast), 'police').some((m) => m.includes('alternate'))).toBe(true);
  });

  it('flags decor dropped in a narrow alley', () => {
    const d = clone(base);
    d.decor.push({ kind: 'crate', pos: { x: 12, y: 4.5 }, angle: 0 });
    expect(errors(validateLayout(d, meta, fast), 'decor').length).toBeGreaterThan(0);
  });
});
