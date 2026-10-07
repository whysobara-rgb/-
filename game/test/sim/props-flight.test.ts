/**
 * [C3] flyBody (catapult / tube / crane / parachute flights) and the physics fuzz with every prop
 * (content-plan §6 C3 acceptance: 0 NaNs, 0 tunnelling through statics at MAX_SUBSTEPS 8).
 */
import { describe, expect, it } from 'vitest';
import type { SimContext } from '../../src/sim/context';
import { createRng, pointInOBB, segmentIntersectsCircle, segmentIntersectsOBB } from '../../src/sim/math';
import { SHAPE_CIRCLE } from '../../src/sim/physics';
import { createPropLoot, endFlight, flyBody } from '../../src/sim/props';
import { staticToOBB } from '../../src/sim/queries';
import { computeRemainingValue } from '../../src/sim/rules';
import { Simulation } from '../../src/sim/sim';
import type { Command, LayoutDef, LootState, PropPlacementDef, StaticBoxDef, TeamId, Vec2 } from '../../src/sim/types';
import { cmd, fullLayout, makeSim } from './fixtures/layouts';

const ctxOf = (sim: Simulation): SimContext => (sim as unknown as { ctx: SimContext }).ctx;
const idle = (n: number): Command[] => Array.from({ length: n }, () => cmd());
const conserved = (sim: Simulation): boolean => {
  const st = sim.state;
  return st.scores[0] + st.scores[1] + st.remainingValue === st.totalValue && computeRemainingValue(st) === st.remainingValue;
};

const PROPS: PropPlacementDef[] = [
  { variant: 'atm', pos: { x: 30, y: 24 }, angle: 0 },
  { variant: 'atm', pos: { x: 66, y: 24 }, angle: Math.PI },
  { variant: 'piggy', pos: { x: 40, y: 32 }, angle: 0 },
  { variant: 'moneyTree', pos: { x: 56, y: 32 }, angle: Math.PI / 2 },
];

/** The full test arena (buildings, planters, trees, thin fences, two banks) with every prop. */
function v2Full(extraStatics: StaticBoxDef[] = []): LayoutDef {
  const base = fullLayout();
  return {
    ...base,
    statics: [...base.statics, ...extraStatics],
    v2: {
      safes: base.safes.filter((s) => s.kind === 'largeSafe'),
      props: PROPS,
      breakables: [],
      gimmicks: [],
      itemPads: [],
      eventSpots: [{ x: 48, y: 32 }],
    },
  };
}

const fullSim = (teams: TeamId[] = [0, 1], police = false): Simulation =>
  makeSim(v2Full(), teams, { content: 'v2', items: 'off', events: 'off', police });

function lootOf(sim: Simulation, variant: string): LootState {
  return sim.state.loot.find((l) => l.variant === variant)!;
}

/** Enabled statics (incl. intact fences, vans, boundary) overlapping the loot's OBB / circle. */
function insideStatic(ctx: SimContext, l: LootState): boolean {
  const b = ctx.loot[ctx.lootIndex.get(l.id)!]!.body;
  const o = { center: { x: b.x, y: b.y }, half: l.half, angle: b.a };
  const r = Math.hypot(l.half.x, l.half.y);
  for (const s of ctx.physics.queryStatics(b.x - r, b.y - r, b.x + r, b.y + r)) {
    if (!s.enabled) continue;
    if (s.type === SHAPE_CIRCLE) {
      if (Math.hypot(s.x - b.x, s.y - b.y) < s.r + Math.min(l.half.x, l.half.y) - 1e-6) return true;
    } else {
      const so = staticToOBB(s);
      // corners of the loot box inside the static, or the static's center inside the loot box
      const c = Math.cos(o.angle);
      const sn = Math.sin(o.angle);
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]] as const) {
        const lx = sx * l.half.x * 0.98;
        const ly = sy * l.half.y * 0.98;
        if (pointInOBB({ x: b.x + lx * c - ly * sn, y: b.y + lx * sn + ly * c }, so)) return true;
      }
    }
  }
  return false;
}

describe('flyBody', () => {
  it('flies on a fixed arc: body out of the world, not grabbable / recoverable, lands at the target', () => {
    const sim = fullSim();
    const ctx = ctxOf(sim);
    const pig = lootOf(sim, 'piggy');
    sim.step(idle(2));
    // a raccoon holding it lets go
    sim.debug.teleport(1, { x: 40 - 0.75 - 0.6, y: 32 }, 0);
    sim.step([cmd(0, 0, true), cmd()]);
    expect(sim.state.characters[0]!.grab?.targetId).toBe(pig.id);
    const to = { x: 10.5, y: 32 }; // the middle of team 0's zone
    flyBody(ctx, pig.id, to, 60, 'catapult');
    expect(sim.state.characters[0]!.grab).toBeNull();
    expect(pig.airborne).toMatchObject({ fromTick: sim.state.tick, toTick: sim.state.tick + 60, via: 'catapult', to });
    const from = { ...pig.airborne!.from };
    const body = ctx.loot[ctx.lootIndex.get(pig.id)!]!.body;
    for (let t = 1; t < 60; t++) {
      const evs = sim.step([cmd(0, 0, t % 2 === 0), cmd()]);
      expect(evs.some((e) => e.type === 'recoveryStart')).toBe(false);
      expect(body.enabled).toBe(false);
      expect(pig.pos.x).toBeCloseTo(from.x + ((to.x - from.x) * t) / 60, 6);
      expect(sim.state.characters[0]!.grab).toBeNull();
    }
    sim.step(idle(2));
    expect(pig.airborne).toBeNull();
    expect(body.enabled).toBe(true);
    expect(pig.pos).toEqual(to);
    // landed in the zone: it recovers like anything else
    const evs = [];
    for (let t = 0; t < 120; t++) evs.push(...sim.step(idle(2)));
    expect(evs.some((e) => e.type === 'recovered' && e.lootId === pig.id)).toBe(true);
    expect(conserved(sim)).toBe(true);
  });

  it('landing never ends inside a static (500 random targets, fixed seed)', () => {
    const sim = fullSim();
    const ctx = ctxOf(sim);
    const rng = createRng(0xc3);
    const atm = lootOf(sim, 'atm');
    const tree = lootOf(sim, 'moneyTree');
    sim.debug.setAnchored(atm.id, false);
    sim.debug.setAnchored(tree.id, false);
    const movers = [atm, tree, lootOf(sim, 'piggy'), sim.state.loot.find((l) => l.kind === 'largeSafe' && !l.variant && l.homeBank === null)!];
    let bad = 0;
    for (let k = 0; k < 500; k++) {
      const l = movers[k % movers.length]!;
      const to: Vec2 = { x: -2 + rng() * 100, y: -2 + rng() * 68 }; // includes buildings, walls, fences, outside the arena
      flyBody(ctx, l.id, to, 2, k % 2 ? 'tube' : 'crane');
      sim.step(idle(2));
      sim.step(idle(2));
      expect(l.airborne).toBeNull();
      if (insideStatic(ctx, l)) bad++;
      const b = ctx.loot[ctx.lootIndex.get(l.id)!]!.body;
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(96);
    }
    expect(bad).toBe(0);
    expect(conserved(sim)).toBe(true);
  });

  it('anchored dormant loot (the gold safe parachute) wakes and lands anchored; exitVel launches free loot', () => {
    const sim = fullSim();
    const ctx = ctxOf(sim);
    // C5's path: a gold safe built at the end, dormant with its body out of the world
    const before = sim.state.totalValue;
    const st = sim.state;
    expect(before).toBe(computeRemainingValue(st));
    const gs = createPropLoot(ctx, 'goldSafe', { x: 48, y: 32 }, 0);
    gs.dormant = true;
    const gb = ctx.loot[ctx.lootIndex.get(gs.id)!]!.body;
    gb.enabled = false;
    st.totalValue = computeRemainingValue(st);
    st.remainingValue = st.totalValue;
    expect(gs).toMatchObject({ kind: 'largeSafe', variant: 'goldSafe', baseValue: 400, innerValue: 0, anchored: true });
    expect(gb.motion).toBe('static');
    flyBody(ctx, gs.id, { x: 48, y: 38 }, 30, 'parachute');
    expect(gs.dormant).toBe(false);
    for (let t = 0; t < 31; t++) sim.step(idle(2));
    expect(gs.airborne).toBeNull();
    expect(gs.anchored).toBe(true);
    expect(gb.motion).toBe('static');
    expect(gb.enabled).toBe(true);
    // tube pop-out: lands moving
    const pig = lootOf(sim, 'piggy');
    flyBody(ctx, pig.id, { x: 40, y: 44 }, 10, 'tube', { exitVel: { x: 0, y: 3 } });
    for (let t = 0; t < 10; t++) sim.step(idle(2));
    expect(pig.airborne).toBeNull();
    expect(pig.vel.y).toBeGreaterThan(2);
    expect(conserved(sim)).toBe(true);
  });

  it('endFlight drops it where it is on the arc; a flown bank takes its cargo along', () => {
    const sim = fullSim();
    const ctx = ctxOf(sim);
    const pig = lootOf(sim, 'piggy');
    flyBody(ctx, pig.id, { x: 40, y: 50 }, 60, 'crane');
    for (let t = 0; t < 30; t++) sim.step(idle(2));
    endFlight(ctx, pig.id);
    expect(pig.airborne).toBeNull();
    sim.step(idle(2));
    expect(Math.abs(pig.pos.y - 41)).toBeLessThan(1.5);
    // bank 0 with its 3 interior safes, freed, crane-lifted 4 m south
    const bank = sim.state.loot.find((l) => l.kind === 'bank')!;
    sim.debug.setAnchored(bank.id, false);
    sim.step(idle(2));
    const cargo = sim.state.loot.filter((l) => l.loadedIn === bank.id).map((l) => l.id);
    expect(cargo.length).toBe(3);
    const rel = cargo.map((id) => {
      const l = sim.getLoot(id)!;
      return { x: l.pos.x - bank.pos.x, y: l.pos.y - bank.pos.y };
    });
    const target = { x: bank.pos.x, y: bank.pos.y + 4 };
    flyBody(ctx, bank.id, target, 40, 'crane');
    for (const id of cargo) expect(sim.getLoot(id)!.airborne).not.toBeNull();
    for (let t = 0; t < 20; t++) sim.step(idle(2));
    for (const [i, id] of cargo.entries()) {
      const l = sim.getLoot(id)!;
      expect(l.pos.x - bank.pos.x).toBeCloseTo(rel[i]!.x, 6);
      expect(l.loadedIn).toBe(bank.id); // welded interior safes stay loaded (no unload / load noise)
    }
    for (let t = 0; t < 25; t++) sim.step(idle(2));
    expect(bank.airborne).toBeNull();
    expect(Math.hypot(bank.pos.x - target.x, bank.pos.y - target.y)).toBeLessThan(0.5);
    for (const [i, id] of cargo.entries()) {
      const l = sim.getLoot(id)!;
      expect(l.airborne).toBeNull();
      expect(l.pos.x - bank.pos.x).toBeCloseTo(rel[i]!.x, 3);
      expect(l.loadedIn).toBe(bank.id);
    }
    expect(bank.estimatedValue).toBe(1000);
    expect(conserved(sim)).toBe(true);
  });

  it('a flown bank emits no load / unload events (welded and free floor cargo); a safe flown off alone unloads once', () => {
    const sim = fullSim();
    const ctx = ctxOf(sim);
    const bank = sim.state.loot.find((l) => l.kind === 'bank')!;
    sim.debug.setAnchored(bank.id, false);
    sim.step(idle(2));
    const cargo = sim.state.loot.filter((l) => l.loadedIn === bank.id);
    expect(cargo.length).toBe(3);
    // free one interior safe: it now rides the floor as a free (dynamic) safe, still loaded
    sim.debug.setAnchored(cargo[0]!.id, false);
    for (let t = 0; t < 5; t++) sim.step(idle(2));
    expect(cargo[0]!.loadedIn).toBe(bank.id);
    const est0 = bank.estimatedValue;
    flyBody(ctx, bank.id, { x: bank.pos.x, y: bank.pos.y + 4 }, 40, 'crane');
    const loadEvents: string[] = [];
    for (let t = 0; t < 50; t++) {
      for (const e of sim.step(idle(2))) if (e.type === 'safeLoaded' || e.type === 'safeUnloaded') loadEvents.push(`${e.type}@${e.tick}`);
      expect(bank.estimatedValue).toBe(est0);
    }
    expect(bank.airborne).toBeNull();
    expect(loadEvents).toEqual([]);
    for (const l of cargo) expect(l.loadedIn).toBe(bank.id);
    // the free one is free again after landing (the flight weld came off)
    expect(ctx.loot[ctx.lootIndex.get(cargo[0]!.id)!]!.body.weldParent).toBeNull();
    // the free floor safe flown off on its own: exactly one safeUnloaded, the estimate drops
    flyBody(ctx, cargo[0]!.id, { x: bank.pos.x, y: bank.pos.y + 12 }, 30, 'catapult');
    const evs: { type: string; safeId?: number }[] = [];
    for (let t = 0; t < 40; t++) evs.push(...sim.step(idle(2)).filter((e) => e.type === 'safeLoaded' || e.type === 'safeUnloaded'));
    expect(evs.map((e) => `${e.type}:${e.safeId}`)).toEqual([`safeUnloaded:${cargo[0]!.id}`]);
    expect(bank.estimatedValue).toBe(est0 - cargo[0]!.estimatedValue);
    expect(conserved(sim)).toBe(true);
  });
});

describe('physics fuzz with every prop (MAX_SUBSTEPS 8)', () => {
  /** Random play with hard knocks; counts NaNs and centre segments crossing an enabled static. */
  function fuzz(seed: number, ticks: number): { nan: number; tunnels: number; kicks: number; spawns: number } {
    const sim = makeSim(v2Full(), [0, 0, 1, 1], { content: 'v2', items: 'off', events: 'off', police: seed % 2 === 0 });
    const ctx = ctxOf(sim);
    const rng = createRng(seed);
    const st = sim.state;
    const n = st.characters.length;
    let held: Command[] = idle(n);
    let nan = 0;
    let tunnels = 0;
    let kicks = 0;
    let spawns = 0;
    const prev = new Map<number, Vec2>();
    const remember = (): void => {
      for (const rt of ctx.chars) prev.set(rt.body.entityId, { x: rt.body.x, y: rt.body.y });
      for (const rt of ctx.loot) prev.set(rt.body.entityId, { x: rt.body.x, y: rt.body.y });
    };
    remember();
    for (let t = 0; t < ticks && !st.over; t++) {
      if (t % 20 === 0) {
        held = Array.from({ length: n }, () => {
          const a = rng() * Math.PI * 2;
          return cmd(Math.cos(a), Math.sin(a), rng() < 0.4, false);
        });
      }
      const cmds = held.map((c) => ({ ...c, dash: rng() < 0.03 }));
      // hard knocks: props flung at walls up to 50 m/s, hammer hits
      if (t % 45 === 0) {
        const props = st.loot.filter((l) => l.variant && !l.recovered && !l.airborne);
        const l = props[Math.floor(rng() * props.length)];
        if (l) {
          const a = rng() * Math.PI * 2;
          const v = 6 + rng() * 44; // up to 50 m/s: needs the MAX_SUBSTEPS 8 cap
          if (rng() < 0.5) ctx.content!.props.hammerHit(l.id, 1 + Math.floor(rng() * n), a);
          else if (!l.anchored) {
            sim.debug.setVelocity(l.id, { x: Math.cos(a) * v, y: Math.sin(a) * v });
            kicks++;
          }
        }
      }
      const evs = sim.step(cmds);
      const moved = new Set<number>();
      for (const e of evs) {
        if (e.type === 'unstuck') moved.add(e.entityId);
        if (e.type === 'coinSpawn') spawns++;
      }
      expect(conserved(sim)).toBe(true);
      const check = (id: number, x: number, y: number): void => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          nan++;
          return;
        }
        const p = prev.get(id);
        if (!p || moved.has(id)) return;
        const a = p;
        const b = { x, y };
        for (const s of ctx.physics.queryStatics(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
          if (!s.enabled) continue;
          const hit = s.type === SHAPE_CIRCLE ? segmentIntersectsCircle(a, b, { x: s.x, y: s.y }, s.r) : segmentIntersectsOBB(a, b, staticToOBB(s));
          if (hit) tunnels++;
        }
      };
      for (const rt of ctx.chars) check(rt.body.entityId, rt.body.x, rt.body.y);
      for (let i = 0; i < st.loot.length; i++) {
        const l = st.loot[i]!;
        if (l.recovered || l.airborne) continue;
        const b = ctx.loot[i]!.body;
        check(b.entityId, b.x, b.y);
        if (!Number.isFinite(b.a) || !Number.isFinite(b.vx) || !Number.isFinite(b.w)) nan++;
      }
      remember();
    }
    return { nan, tunnels, kicks, spawns };
  }

  it('0 NaNs and 0 tunnelling through statics over 5 seeds x 2400 ticks, conservation every tick', () => {
    let kicks = 0;
    let spawns = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = fuzz(seed, 2400);
      expect(r.nan).toBe(0);
      expect(r.tunnels).toBe(0);
      kicks += r.kicks;
      spawns += r.spawns;
    }
    expect(kicks).toBeGreaterThan(20);
    expect(spawns).toBeGreaterThan(10);
  });
});
