/**
 * [C1] Coin economy (content-plan §3.3–3.5): piles, pickup contest, bag cap, deposit (쏟아붓기),
 * spill (와르르), breakables, police targeting of bag carriers, value conservation, early-decision
 * exactness and "모두 털림" with coins. Fuzzing lives in content-fuzz.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BREAKABLE_SPECS, CHARACTER, COINS, POLICE } from '../../src/sim/config';
import { knockDown } from '../../src/sim/actions';
import { damageBreakable } from '../../src/sim/breakables';
import { coinDir } from '../../src/sim/coins';
import type { SimContext } from '../../src/sim/context';
import { heldValue } from '../../src/sim/queries';
import { computeRemainingValue } from '../../src/sim/rules';
import { Simulation } from '../../src/sim/sim';
import type { BreakableDef, Command, LayoutDef, RuleConfig, SimEvent, TeamId, Vec2 } from '../../src/sim/types';
import { cmd, makeSim, openLayout } from './fixtures/layouts';

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(evs: SimEvent[], t: T): Ev<T>[] => evs.filter((e): e is Ev<T> => e.type === t);
type DepositEv = Extract<SimEvent, { type: 'coinDepositStart' | 'coinDepositCancel' }>;
/** coinDepositStart / coinDepositCancel share one union member, so Extract by a single literal is never. */
const depositEvs = (evs: SimEvent[], t: DepositEv['type']): DepositEv[] => evs.filter((e): e is DepositEv => e.type === t);
const ctxOf = (sim: Simulation): SimContext => (sim as unknown as { ctx: SimContext }).ctx;
const idle = (n: number): Command[] => Array.from({ length: n }, () => cmd());
const conserved = (sim: Simulation): boolean => {
  const st = sim.state;
  return st.scores[0] + st.scores[1] + st.remainingValue === st.totalValue && computeRemainingValue(st) === st.remainingValue;
};

const crate = (id: string, x: number, y: number): BreakableDef => ({ id, kind: 'crate', center: { x, y }, half: { ...BREAKABLE_SPECS.crate.half }, angle: 0 });
const vending = (id: string, x: number, y: number, angle = 0): BreakableDef => ({ id, kind: 'vending', center: { x, y }, half: { ...BREAKABLE_SPECS.vending.half }, angle });

/** 100 x 60 open arena (zones at x 10 / 90, y 30) with a v2 composition. */
function coinLayout(o: { breakables?: BreakableDef[]; safes?: LayoutDef['safes']; banks?: LayoutDef['banks'] } = {}): LayoutDef {
  const base = openLayout({ safes: o.safes ?? [], banks: o.banks ?? [] });
  return {
    ...base,
    v2: { safes: base.safes, props: [], breakables: o.breakables ?? [], gimmicks: [], itemPads: [], eventSpots: [{ x: 50, y: 30 }] },
  };
}

function coinSim(layout = coinLayout(), teams: TeamId[] = [0, 1], rules: Partial<RuleConfig> = {}): Simulation {
  return makeSim(layout, teams, { content: 'v2', ...rules });
}

/** Move `value` from loot `lootId`'s shell into a bag (value-conserving test setup). */
function fundBag(sim: Simulation, charId: number, lootId: number, value: number): void {
  const l = sim.getLoot(lootId)!;
  l.baseValue -= value;
  l.estimatedValue -= value;
  const ch = sim.getCharacter(charId)!;
  ch.bag = (ch.bag ?? 0) + value;
}

/** Spawn piles at rest at `pos` from loot `lootId`'s shell (value-conserving test setup). */
function dropPiles(sim: Simulation, lootId: number, pos: Vec2, values: (10 | 50)[]): number[] {
  const ctx = ctxOf(sim);
  const l = sim.getLoot(lootId)!;
  const sum = values.reduce((a, b) => a + b, 0);
  l.baseValue -= sum;
  l.estimatedValue -= sum;
  const ids = ctx.content!.coins.spawnCoins({ pos, dir: 0, values, pattern: 'ring', source: 'rain', sourceId: null, byCharId: null });
  for (const p of sim.state.coins) if (ids.includes(p.id)) p.vel = { x: 0, y: 0 };
  return ids;
}

describe('coin piles and spawning', () => {
  it('v2 characters start with an empty bag; classic has no bag fields', () => {
    const sim = coinSim();
    expect(sim.state.characters.map((c) => [c.bag, c.depositTicks])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    const classic = makeSim(openLayout(), [0, 1]);
    expect('bag' in classic.state.characters[0]!).toBe(false);
  });

  it('piles slide with drag, stop at statics and never despawn; a buried pile is moved out', () => {
    const layout = coinLayout({ safes: [{ kind: 'smallSafe', pos: { x: 50, y: 10 }, angle: 0 }] });
    layout.statics = [{ id: 'wall', kind: 'wall', center: { x: 52, y: 30 }, half: { x: 0.2, y: 3 }, angle: 0, height: 2 }];
    layout.v2!.safes = layout.safes;
    const sim = coinSim(layout);
    const ctx = ctxOf(sim);
    const safe = sim.state.loot[0]!.id;
    sim.getLoot(safe)!.baseValue -= 20;
    const [a, b] = ctx.content!.coins.spawnCoins({ pos: { x: 50, y: 30 }, dir: 0, values: [10, 10], pattern: 'fan', source: 'spurt', sourceId: safe, byCharId: null });
    expect(conserved(sim)).toBe(true);
    for (let t = 0; t < 240; t++) sim.step(idle(2));
    const piles = sim.state.coins;
    expect(piles.map((p) => p.id)).toEqual([a, b]);
    for (const p of piles) {
      expect(p.vel).toEqual({ x: 0, y: 0 });
      // stopped by the wall face (x = 51.8) minus the pile radius
      expect(p.pos.x).toBeLessThanOrEqual(51.8 - COINS.radius + 1e-9);
      expect(p.pos.x).toBeGreaterThan(50.3);
    }
    // a pile spawned inside the wall pops out to the nearest free spot
    sim.getLoot(safe)!.baseValue -= 10;
    const [c] = ctx.content!.coins.spawnCoins({ pos: { x: 52, y: 30 }, dir: Math.PI / 2, values: [10], pattern: 'ring', source: 'rain', sourceId: null, byCharId: null });
    const pc = sim.state.coins.find((p) => p.id === c)!;
    expect(Math.abs(pc.pos.x - 52)).toBeGreaterThanOrEqual(0.2 + COINS.radius - 1e-9);
    sim.step(idle(2));
    expect(conserved(sim)).toBe(true);
  });

  it('coinSpawn reports the burst; values are only 10 / 50 and ids ascend from 10001', () => {
    const sim = coinSim(coinLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 10 }, angle: 0 }] }));
    const ctx = ctxOf(sim);
    ctx.events = [];
    const ids = dropPiles(sim, sim.state.loot[0]!.id, { x: 50, y: 30 }, [50, 10, 10]);
    expect(ids).toEqual([10001, 10002, 10003]);
    expect(ofType(ctx.events, 'coinSpawn')).toEqual([
      { type: 'coinSpawn', tick: 0, ids, total: 70, pos: { x: 50, y: 30 }, source: 'rain', sourceId: null, byCharId: null },
    ]);
    expect(() => ctx.content!.coins.spawnCoins({ pos: { x: 50, y: 30 }, dir: 0, values: [20 as 10], pattern: 'fan', source: 'spurt', sourceId: null, byCharId: null })).toThrow(RangeError);
    expect(conserved(sim)).toBe(true);
  });

  it('the direction table is mirror-exact: a and π − a give (c, s) and (−c, s) bit for bit', () => {
    for (const a of [0, 0.1, 0.7, 1.2, Math.PI / 2, 2.0, -0.4, -2.9, Math.atan2(1, 3), Math.atan2(-0.3, 0.8)]) {
      const u = coinDir(a);
      const m = coinDir(Math.PI - a);
      expect(Object.is(m.x, -u.x) || (m.x === 0 && u.x === 0)).toBe(true);
      expect(m.y).toBe(u.y);
      expect(Math.hypot(u.x, u.y)).toBeCloseTo(1, 12);
      expect(Math.abs(Math.atan2(u.y, u.x) - Math.atan2(Math.sin(a), Math.cos(a)))).toBeLessThan(0.001);
    }
  });

  it('a mirrored spill gives mirrored piles: launch velocities bit-exact, paths mirrored', () => {
    // two victims mirrored about x = 50, knocked down in the same tick with mirrored knockback
    const sim = coinSim(coinLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 5 }, angle: 0 }] }), [1, 0, 1, 0]);
    const ctx = ctxOf(sim);
    const safe = sim.state.loot[0]!.id;
    sim.debug.teleport(1, { x: 40, y: 30 });
    sim.debug.teleport(2, { x: 60, y: 30 });
    sim.debug.teleport(3, { x: 20, y: 50 });
    sim.debug.teleport(4, { x: 80, y: 50 });
    fundBag(sim, 1, safe, 130);
    fundBag(sim, 2, safe, 130);
    sim.step(idle(4));
    ctx.events = [];
    expect(knockDown(ctx, 0, 3.3, 1.7, 'dash', 3)).toBe(60);
    expect(knockDown(ctx, 1, -3.3, 1.7, 'dash', 4)).toBe(60);
    const spawns = ofType(ctx.events, 'coinSpawn');
    expect(spawns.map((s) => [s.source, s.sourceId, s.byCharId, s.total])).toEqual([
      ['spill', 1, 3, 60],
      ['spill', 2, 4, 60],
    ]);
    expect(ofType(ctx.events, 'bagSpilled').map((e) => [e.charId, e.value, e.byId, e.cause])).toEqual([
      [1, 60, 3, 'dash'],
      [2, 60, 4, 'dash'],
    ]);
    const left = sim.state.coins.filter((p) => spawns[0]!.ids.includes(p.id));
    const right = sim.state.coins.filter((p) => spawns[1]!.ids.includes(p.id));
    expect(left.length).toBe(6);
    // pile i on the left mirrors pile n-1-i on the right (fan order flips under the mirror)
    for (let i = 0; i < left.length; i++) {
      const l = left[i]!;
      const r = right[left.length - 1 - i]!;
      expect(r.vel.x).toBe(-l.vel.x);
      expect(r.vel.y).toBe(l.vel.y);
      expect(r.pos.x).toBe(100 - l.pos.x);
      expect(r.pos.y).toBe(l.pos.y);
      expect([l.noPickupCharId, r.noPickupCharId]).toEqual([1, 2]);
    }
    for (let t = 0; t < 120; t++) sim.step(idle(4));
    for (let i = 0; i < left.length; i++) {
      const l = left[i]!;
      const r = right[left.length - 1 - i]!;
      expect(Math.abs(r.pos.x - (100 - l.pos.x))).toBeLessThan(1e-9);
      expect(Math.abs(r.pos.y - l.pos.y)).toBeLessThan(1e-9);
    }
    expect(conserved(sim)).toBe(true);
  });
});

describe('pickup contest', () => {
  function pileSim(): { sim: Simulation; safe: number } {
    const sim = coinSim(coinLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 5 }, angle: 0 }] }));
    return { sim, safe: sim.state.loot[0]!.id };
  }

  it('touch picks a pile up into the bag (no button), even while dashing or carrying', () => {
    const { sim, safe } = pileSim();
    sim.debug.teleport(1, { x: 30, y: 30 });
    sim.debug.teleport(2, { x: 70, y: 30 });
    const [id] = dropPiles(sim, safe, { x: 30.7, y: 30 }, [50]);
    const evs = sim.step(idle(2));
    expect(ofType(evs, 'coinPickup')).toEqual([{ type: 'coinPickup', tick: 1, charId: 1, coinId: id, value: 50, bag: 50 }]);
    expect(sim.state.coins).toEqual([]);
    expect(heldValue(sim.state, 1)).toBe(50);
    expect(conserved(sim)).toBe(true);
  });

  it('closest centre wins; an exact tie means nobody takes it that tick (slot order never decides)', () => {
    const { sim, safe } = pileSim();
    sim.debug.teleport(1, { x: 49.5, y: 30 });
    sim.debug.teleport(2, { x: 50.5, y: 30 });
    dropPiles(sim, safe, { x: 50, y: 30 }, [10]);
    for (let t = 0; t < 30; t++) {
      const evs = sim.step(idle(2));
      expect(ofType(evs, 'coinPickup')).toEqual([]);
    }
    expect(sim.state.coins.length).toBe(1);
    // nudge team 1 a hair closer: it wins
    sim.debug.teleport(2, { x: 50.45, y: 30 });
    const evs = sim.step(idle(2));
    expect(ofType(evs, 'coinPickup').map((e) => e.charId)).toEqual([2]);
    // and the mirrored contest goes to team 0
    const m = pileSim();
    m.sim.debug.teleport(1, { x: 49.55, y: 30 });
    m.sim.debug.teleport(2, { x: 50.5, y: 30 });
    dropPiles(m.sim, m.safe, { x: 50, y: 30 }, [10]);
    expect(ofType(m.sim.step(idle(2)), 'coinPickup').map((e) => e.charId)).toEqual([1]);
  });

  it('the bag cap holds; nearest piles first; knocked-down characters cannot pick up', () => {
    const { sim, safe } = pileSim();
    sim.debug.teleport(1, { x: 30, y: 30 });
    sim.debug.teleport(2, { x: 70, y: 30 });
    fundBag(sim, 1, safe, 150);
    dropPiles(sim, safe, { x: 30.3, y: 30 }, [10]);
    dropPiles(sim, safe, { x: 30.2, y: 30 }, [50]);
    dropPiles(sim, safe, { x: 30.5, y: 30 }, [50]);
    const evs = sim.step(idle(2));
    expect(ofType(evs, 'coinPickup').map((e) => e.value)).toEqual([50]); // nearest first -> 200, then full
    expect(sim.getCharacter(1)!.bag).toBe(COINS.bagCap);
    expect(sim.state.coins.length).toBe(2);
    // knocked down: the pile at its feet stays
    const ctx = ctxOf(sim);
    knockDown(ctx, 1, 0, 0, 'hazard', null);
    const before = sim.state.coins.length;
    sim.debug.teleport(2, { x: 60, y: 45 });
    const evs2 = sim.step(idle(2));
    expect(ofType(evs2, 'coinPickup')).toEqual([]);
    expect(sim.state.coins.length).toBeGreaterThanOrEqual(before);
    expect(conserved(sim)).toBe(true);
  });

  it('the spill victim cannot take its own piles for 1 s; everyone else can at once', () => {
    const { sim, safe } = pileSim();
    const ctx = ctxOf(sim);
    sim.debug.teleport(1, { x: 30, y: 30 });
    sim.debug.teleport(2, { x: 70, y: 30 });
    fundBag(sim, 1, safe, 40);
    sim.step(idle(2));
    expect(knockDown(ctx, 0, 0.0, 0.0001, 'police', 1001)).toBe(20);
    expect(sim.getCharacter(1)!.bag).toBe(20);
    const ids = sim.state.coins.map((p) => p.id);
    expect(ids.length).toBe(2);
    for (const p of sim.state.coins) expect([p.noPickupCharId, p.noPickupUntil]).toEqual([1, sim.state.tick + COINS.ownSpillLockTicks]);
    // hold the piles under the victim: it gets up after the knockdown but stays locked out until 1 s
    const picks: Ev<'coinPickup'>[] = [];
    for (let t = 0; t < COINS.ownSpillLockTicks + 5; t++) {
      for (const p of sim.state.coins) {
        p.pos = { x: sim.getCharacter(1)!.pos.x, y: sim.getCharacter(1)!.pos.y };
        p.vel = { x: 0, y: 0 };
      }
      const evs = sim.step(idle(2));
      for (const e of ofType(evs, 'coinPickup')) picks.push(e);
    }
    expect(picks.length).toBe(2);
    expect(picks.every((e) => e.charId === 1 && e.tick >= ctx.state.tick - 5)).toBe(true);
    expect(picks[0]!.tick - (sim.state.tick - COINS.ownSpillLockTicks - 5)).toBeGreaterThanOrEqual(COINS.ownSpillLockTicks);
    expect(conserved(sim)).toBe(true);
  });
});

describe('deposit (쏟아붓기) and spill (와르르)', () => {
  function depSim(): { sim: Simulation; safe: number } {
    const sim = coinSim(coinLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 5 }, angle: 0 }] }), [0, 1, 1]);
    return { sim, safe: sim.state.loot[0]!.id };
  }

  it('0.5 s inside the own zone (shrunk by the radius) deposits the whole bag; scores only via step 4', () => {
    const { sim, safe } = depSim();
    fundBag(sim, 1, safe, 120);
    sim.debug.teleport(1, { x: 10, y: 30 });
    const all: SimEvent[] = [];
    for (let t = 0; t < COINS.depositTicks + 2; t++) all.push(...sim.step(idle(3)));
    expect(depositEvs(all, 'coinDepositStart').map((e) => [e.tick, e.charId, e.team])).toEqual([[1, 1, 0]]);
    expect(ofType(all, 'coinsBanked')).toEqual([{ type: 'coinsBanked', tick: COINS.depositTicks, charId: 1, team: 0, value: 120 }]);
    expect(sim.state.scores).toEqual([120, 0]);
    expect(sim.getCharacter(1)!.bag).toBe(0);
    expect(conserved(sim)).toBe(true);
  });

  it('the zone edge counts only with the whole body inside; the opposing zone never deposits', () => {
    const { sim, safe } = depSim();
    fundBag(sim, 1, safe, 50);
    // zone 0: x in [3.5, 16.5]; centre at 16.2 is inside the zone but not by a full radius
    sim.debug.teleport(1, { x: 16.5 - CHARACTER.radius + 0.05, y: 30 });
    for (let t = 0; t < 60; t++) expect(depositEvs(sim.step(idle(3)), 'coinDepositStart')).toEqual([]);
    sim.debug.teleport(1, { x: 90, y: 30 });
    for (let t = 0; t < 60; t++) expect(ofType(sim.step(idle(3)), 'coinsBanked')).toEqual([]);
    expect(sim.state.scores).toEqual([0, 0]);
  });

  it('a knockdown cancels the deposit timer and spills half (rounded down to 10s, at least 10)', () => {
    const { sim, safe } = depSim();
    const ctx = ctxOf(sim);
    fundBag(sim, 1, safe, 130);
    sim.debug.teleport(1, { x: 10, y: 30 });
    for (let t = 0; t < 20; t++) sim.step(idle(3));
    expect(sim.getCharacter(1)!.depositTicks).toBe(20);
    ctx.events = [];
    expect(knockDown(ctx, 0, 4, 0, 'hammer', 2)).toBe(60);
    expect(depositEvs(ctx.events, 'coinDepositCancel').map((e) => e.charId)).toEqual([1]);
    expect(sim.getCharacter(1)!.depositTicks).toBe(0);
    expect(sim.getCharacter(1)!.bag).toBe(70);
    const evs = sim.step(idle(3));
    expect(ofType(evs, 'coinsBanked')).toEqual([]);
    // tiny bags: 10 -> spills 10; 30 -> 10; 0 -> nothing
    const ch = sim.getCharacter(3)!;
    for (const [bag, spill] of [
      [10, 10],
      [30, 10],
      [50, 20],
      [200, 100],
    ] as const) {
      ch.bag = 0;
      fundBag(sim, 3, safe, bag);
      ch.knockdownTicks = 0;
      expect(ctx.content!.coins.spillBag(3, 'dash', 1, 0)).toBe(spill);
      expect(ch.bag).toBe(bag - spill);
      // put the leftovers back so the reservoir stays positive
      sim.state.coins = sim.state.coins.filter((p) => p.noPickupCharId !== 3);
      sim.getLoot(safe)!.baseValue += bag;
      ch.bag = 0;
    }
    expect(ctx.content!.coins.spillBag(3, 'dash', 1, 0)).toBe(0);
    expect(knockDown(ctx, 2, 1, 0, 'self', null)).toBe(0);
    sim.state.remainingValue = computeRemainingValue(sim.state);
    expect(conserved(sim)).toBe(true);
  });

  it('an opposing dash knockdown spills the bag, credits the attacker on dashHit.spilled', () => {
    const { sim, safe } = depSim();
    fundBag(sim, 2, safe, 100);
    sim.debug.teleport(1, { x: 50, y: 30 }, 0);
    sim.debug.teleport(2, { x: 51.2, y: 30 }, 0);
    sim.debug.teleport(3, { x: 50, y: 50 });
    const evs: SimEvent[] = [];
    for (let t = 0; t < 10; t++) evs.push(...sim.step([cmd(1, 0, false, t === 0), cmd(), cmd()]));
    const hit = ofType(evs, 'dashHit')[0]!;
    expect(hit).toMatchObject({ attackerId: 1, victimId: 2, knockdown: true, spilled: 50 });
    expect(ofType(evs, 'bagSpilled')[0]).toMatchObject({ charId: 2, value: 50, byId: 1, cause: 'dash' });
    expect(sim.getCharacter(2)!.bag).toBe(50);
    // the attacker chases the piles (fanned along +x, away from it) and scoops them up
    for (let t = 0; t < 120; t++) {
      const target = sim.state.coins[0];
      const c = target ? { x: target.pos.x - sim.getCharacter(1)!.pos.x, y: target.pos.y - sim.getCharacter(1)!.pos.y } : { x: 0, y: 0 };
      const l = Math.hypot(c.x, c.y) || 1;
      evs.push(...sim.step([cmd(c.x / l, c.y / l), cmd(), cmd()]));
      expect(conserved(sim)).toBe(true);
    }
    expect(sim.getCharacter(1)!.bag).toBe(50);
    expect(ofType(evs, 'coinPickup').every((e) => e.charId === 1)).toBe(true);
  });
});

describe('breakables', () => {
  it('a crate breaks on one dash: pops 20, its static is gone, the dash ends on it', () => {
    const sim = coinSim(coinLayout({ breakables: [crate('c1', 52, 30)] }));
    expect(sim.state.totalValue).toBe(20);
    const n0 = sim.staticOBBs().length; // 4 bounds + 2 vans + crate
    expect(n0).toBe(7);
    expect(sim.isFree({ x: 52, y: 30 }, 0.2)).toBe(false);
    sim.debug.teleport(1, { x: 50.5, y: 30 }, 0);
    sim.debug.teleport(2, { x: 70, y: 50 });
    const evs: SimEvent[] = [];
    for (let t = 0; t < 20; t++) evs.push(...sim.step([cmd(1, 0, false, t === 0), cmd()]));
    expect(ofType(evs, 'breakableHit').map((e) => [e.id, e.hp, e.byCharId])).toEqual([['c1', 0, 1]]);
    expect(ofType(evs, 'breakableBroken').map((e) => [e.id, e.byCharId])).toEqual([['c1', 1]]);
    const spawn = ofType(evs, 'coinSpawn')[0]!;
    expect([spawn.source, spawn.sourceId, spawn.total, spawn.ids.length]).toEqual(['break', 'c1', 20, 2]);
    expect(sim.state.breakables[0]).toMatchObject({ hp: 0, innerValue: 0, broken: true });
    expect(sim.isFree({ x: 52, y: 30 }, 0.2)).toBe(true);
    expect(sim.staticOBBs().length).toBe(n0 - 1);
    expect(conserved(sim)).toBe(true);
  });

  it('a vending machine takes 3 dashes (1 coin, 1 coin, then the remaining 4) and coughs coins out of its face', () => {
    const sim = coinSim(coinLayout({ breakables: [vending('v1', 53, 30)] }));
    expect(sim.state.totalValue).toBe(60);
    sim.debug.teleport(2, { x: 70, y: 50 });
    const totals: number[] = [];
    for (let k = 0; k < 3; k++) {
      sim.debug.teleport(1, { x: 51.2, y: 30 }, 0);
      const evs: SimEvent[] = [];
      // wait out the dash cooldown, then dash into the machine
      for (let t = 0; t < 260; t++) evs.push(...sim.step([cmd(0, 0, false, t === 250), cmd()]));
      for (const s of ofType(evs, 'coinSpawn')) totals.push(s.total);
      for (const p of sim.state.coins) {
        if (k < 2) expect(p.pos.x).toBeLessThan(53 - 0.6); // came out on the hitter's side
      }
      // clear the coins out of the way (back into the machine's tally is not allowed: keep them)
      expect(conserved(sim)).toBe(true);
    }
    expect(totals).toEqual([10, 10, 40]);
    expect(sim.state.breakables[0]!.broken).toBe(true);
  });

  it('damageBreakable: hammer damage 3 breaks a vending machine at once; broken / unknown ids are no-ops', () => {
    const sim = coinSim(coinLayout({ breakables: [vending('v1', 53, 30), crate('c1', 40, 40)] }));
    const ctx = ctxOf(sim);
    ctx.events = [];
    damageBreakable(ctx, 'v1', 3, 2, Math.PI);
    expect(ofType(ctx.events, 'coinSpawn').map((e) => e.total)).toEqual([60]);
    damageBreakable(ctx, 'v1', 3, 2, Math.PI);
    damageBreakable(ctx, 'nope', 3, 2, 0);
    damageBreakable(ctx, 'c1', 0, 2, 0);
    expect(ofType(ctx.events, 'breakableHit').length).toBe(1);
    sim.step(idle(2));
    expect(conserved(sim)).toBe(true);
  });
});

describe('scoring with coins', () => {
  /** 1 small safe (100) + breakables worth 100 (vending 60 + 2 crates): total 200. */
  function scoreSim(rules: Partial<RuleConfig> = {}): Simulation {
    const layout = coinLayout({
      safes: [{ kind: 'smallSafe', pos: { x: 50, y: 10 }, angle: 0 }],
      breakables: [vending('v', 50, 50), crate('c1', 40, 50), crate('c2', 60, 50)],
    });
    return coinSim(layout, [0, 1], rules);
  }

  function recoverSafe(sim: Simulation): void {
    const id = sim.state.loot[0]!.id;
    sim.debug.setAnchored(id, false);
    sim.debug.teleport(id, { x: 10, y: 30 });
    for (let t = 0; t < 120 && !sim.getLoot(id)!.recovered; t++) sim.step(idle(2));
    expect(sim.getLoot(id)!.recovered).toBe(true);
  }

  it('early decision stays exact with value in bags: equality plays on, one coin more decides', () => {
    const sim = scoreSim();
    sim.debug.teleport(1, { x: 30, y: 20 });
    sim.debug.teleport(2, { x: 70, y: 20 });
    recoverSafe(sim);
    expect(sim.state.scores).toEqual([100, 0]);
    expect(sim.state.remainingValue).toBe(100);
    expect(sim.state.over).toBe(false);
    const ctx = ctxOf(sim);
    for (const b of ['v', 'c1', 'c2']) damageBreakable(ctx, b, 9, 2, 0);
    // team 1 scoops every pile: 100 in its bag, scores 100 : 0, remaining 100 -> play on
    for (let t = 0; t < 30; t++) {
      for (const p of sim.state.coins) p.pos = { ...sim.getCharacter(2)!.pos };
      sim.step(idle(2));
    }
    expect(sim.getCharacter(2)!.bag).toBe(100);
    expect(sim.state.coins).toEqual([]);
    expect(sim.state.remainingValue).toBe(100);
    expect(sim.state.over).toBe(false);
    // spill 50 of it; team 0 scoops 10 and deposits: 110 > 0 + 90 -> decided
    knockDown(ctx, 1, 1, 0, 'dash', 1);
    for (let t = 0; t < 3; t++) sim.step(idle(2));
    const p = sim.state.coins[0]!;
    p.pos = { ...sim.getCharacter(1)!.pos };
    p.vel = { x: 0, y: 0 };
    sim.step(idle(2));
    expect(sim.getCharacter(1)!.bag).toBe(10);
    sim.debug.teleport(1, { x: 10, y: 30 });
    let end: Ev<'matchEnd'> | undefined;
    for (let t = 0; t < 60 && !sim.state.over; t++) end ??= ofType(sim.step(idle(2)), 'matchEnd')[0];
    expect(end?.result).toMatchObject({ reason: 'decided', winner: 0, scores: [110, 0] });
  });

  it('"모두 털림" only once every pile is banked and every bag is empty', () => {
    const sim = scoreSim({ earlyDecision: false });
    const ctx = ctxOf(sim);
    sim.debug.teleport(1, { x: 30, y: 20 });
    sim.debug.teleport(2, { x: 70, y: 20 });
    recoverSafe(sim);
    for (const b of ['v', 'c1', 'c2']) damageBreakable(ctx, b, 9, 1, 0);
    for (let t = 0; t < 120; t++) sim.step(idle(2));
    expect(sim.state.breakables.every((b) => b.broken)).toBe(true);
    expect(sim.state.coins.length).toBe(10);
    // bank all but one pile
    sim.debug.teleport(1, { x: 10, y: 30 });
    const last = sim.state.coins[sim.state.coins.length - 1]!;
    for (let t = 0; t < 60; t++) {
      for (const p of sim.state.coins) if (p !== last) p.pos = { ...sim.getCharacter(1)!.pos };
      sim.step(idle(2));
    }
    expect(sim.state.coins).toEqual([last]);
    expect(sim.state.over).toBe(false);
    expect(sim.state.scores[0]).toBe(190);
    last.pos = { ...sim.getCharacter(1)!.pos };
    let end: Ev<'matchEnd'> | undefined;
    for (let t = 0; t < 60 && !sim.state.over; t++) end ??= ofType(sim.step(idle(2)), 'matchEnd')[0];
    expect(end?.result).toMatchObject({ reason: 'allRecovered', winner: 0, scores: [200, 0] });
  });
});

describe('police and bags (one-line hooks)', () => {
  const BANK = { x: 50, y: 40 };
  function policeCoinSim(): Simulation {
    const layout = coinLayout({
      banks: [{ pos: BANK, angle: 0 }],
      safes: [
        { kind: 'smallSafe', pos: { x: 20, y: 10 }, angle: 0 },
        { kind: 'smallSafe', pos: { x: 80, y: 10 }, angle: 0 },
      ],
    });
    return coinSim(layout, [0, 0, 1, 1], { police: true });
  }

  function officersOut(sim: Simulation): void {
    sim.debug.setAnchored(sim.state.loot.find((l) => l.kind === 'bank')!.id, false);
    for (let t = 0; t < POLICE.dispatchDelayTicks + POLICE.arriveTicks + 200; t++) {
      sim.step(idle(4));
      if (sim.state.police.length && sim.state.police.every((o) => o.phase !== 'arriving')) break;
    }
    expect(sim.state.police.length).toBeGreaterThan(0);
  }

  it('a raccoon with only a coin bag is chased and tackled (spilling); empty hands and bag never are', () => {
    for (const withBag of [true, false]) {
      const sim = policeCoinSim();
      officersOut(sim);
      const o = sim.state.police[0]!;
      // everyone else far away; slot 0 a few metres from the first officer, in sight
      sim.debug.teleport(2, { x: 5, y: 55 });
      sim.debug.teleport(3, { x: 95, y: 55 });
      sim.debug.teleport(4, { x: 95, y: 5 });
      const spot = { x: o.pos.x + (o.pos.x < 50 ? 3 : -3), y: o.pos.y };
      sim.debug.teleport(1, spot);
      if (withBag) fundBag(sim, 1, sim.state.loot.find((l) => l.kind === 'smallSafe')!.id, 80);
      const evs: SimEvent[] = [];
      for (let t = 0; t < 600 && !ofType(evs, 'policeTackle').some((e) => e.hit); t++) {
        evs.push(...sim.step(idle(4)));
        expect(conserved(sim)).toBe(true);
      }
      const hits = ofType(evs, 'policeTackle').filter((e) => e.hit);
      if (withBag) {
        expect(ofType(evs, 'policeSpotted').some((e) => e.charId === 1)).toBe(true);
        expect(hits.map((e) => e.victimId)).toEqual([1]);
        expect(ofType(evs, 'bagSpilled')[0]).toMatchObject({ charId: 1, value: 40, cause: 'police' });
      } else {
        expect(hits).toEqual([]);
        expect(ofType(evs, 'policeSpotted').some((e) => e.charId === 1)).toBe(false);
      }
    }
  });
});

describe('query helpers (C1)', () => {
  it('canPickUp / nearestPile / depositProgress / looseCoinValue follow the sim rules', async () => {
    const { canPickUp, nearestPile, depositProgress, looseCoinValue } = await import('../../src/sim/queries');
    const sim = coinSim(coinLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 5 }, angle: 0 }] }));
    const safe = sim.state.loot[0]!.id;
    sim.debug.teleport(1, { x: 30, y: 30 });
    sim.debug.teleport(2, { x: 70, y: 30 });
    const [a] = dropPiles(sim, safe, { x: 40, y: 30 }, [10]);
    const [b] = dropPiles(sim, safe, { x: 36, y: 30 }, [50]);
    expect(looseCoinValue(sim.state)).toBe(60);
    expect(nearestPile(sim.state, 1, { x: 30, y: 30 })!.id).toBe(b);
    expect(nearestPile(sim.state, 1, { x: 30, y: 30 }, 5)).toBeNull();
    fundBag(sim, 1, safe, 160);
    // 160 + 50 > cap: the 50 is out of reach for slot 0, the 10 is not
    expect(canPickUp(sim.state, 1, sim.state.coins.find((p) => p.id === b)!)).toBe(false);
    expect(nearestPile(sim.state, 1, { x: 30, y: 30 })!.id).toBe(a);
    expect(canPickUp(sim.state, 2, { value: 10, noPickupCharId: 2, noPickupUntil: sim.state.tick + 1 })).toBe(false);
    expect(depositProgress(sim.state, 1)).toBe(0);
    sim.getCharacter(1)!.depositTicks = COINS.depositTicks / 2;
    expect(depositProgress(sim.state, 1)).toBe(0.5);
  });
});
