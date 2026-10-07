/**
 * Police event fuzz on the real match layouts: value conservation (state.totalValue), scores only change
 * through settlement, officers stay finite / inside the arena / never permanently stuck,
 * tackles only ever hit loot carriers, determinism, and the per-officer performance budget.
 */
import { describe, expect, it } from 'vitest';
import { POLICE, POLICE_CAR } from '../../src/sim/config';
import { LAYOUTS, MATCH_LAYOUT_IDS } from '../../src/sim/layouts/index';
import { Simulation } from '../../src/sim/sim';
import type { Command, LayoutId, RuleConfig, SimEvent } from '../../src/sim/types';
import { FuzzDriver } from './fixtures/fuzzbot';
import { makeSetup } from './fixtures/layouts';

const finite = (v: { x: number; y: number }): boolean => Number.isFinite(v.x) && Number.isFinite(v.y);
/** Generous upper bound of an officer's time on the field (shift + walk back + stuns). */
const MAX_OFFICER_LIFE = POLICE.shiftTicks + 20 * 60 + 15 * 60;
/**
 * Officers only ever board right at their car (never vanish mid-map): within this distance of
 * the curb park spot (curb 2.4 m + step-in 0.75 m + spread / boarding slack).
 */
const BOARD_NEAR_CAR = POLICE_CAR.curb + 0.75 + POLICE_CAR.half.x + 0.5;

interface PoliceStats {
  ticks: number;
  alarms: number;
  waves: number;
  officers: number;
  hits: number;
  misses: number;
  stuns: number;
  gone: number;
  slowWindows: number;
  windows: number;
  maxSlowRun: number;
  recovered: number;
  over: string | null;
}

function policeFuzz(id: LayoutId, seed: number, ticks: number, rules: Partial<RuleConfig> = {}, assistEvery = 0): PoliceStats {
  const sim = new Simulation(makeSetup(LAYOUTS[id], [0, 0, 1, 1], { police: true, ...rules }));
  const driver = new FuzzDriver(sim, seed);
  const size = sim.layout.size;
  const st = sim.state;
  const stats: PoliceStats = {
    ticks: 0,
    alarms: 0,
    waves: 0,
    officers: 0,
    hits: 0,
    misses: 0,
    stuns: 0,
    gone: 0,
    slowWindows: 0,
    windows: 0,
    maxSlowRun: 0,
    recovered: 0,
    over: null,
  };
  const life = new Map<number, number>();
  const entries = sim.policeEntries();
  const carEntry = new Map<number, number>();
  const lastSeen = new Map<number, { x: number; y: number; carId: number }>();
  const physics = (sim as unknown as { ctx: { physics: { bodies: unknown[] } } }).ctx.physics;
  const baseBodies = physics.bodies.length;
  const windowStart = new Map<number, { x: number; y: number; phase: string; run: number }>();
  let prevScores: [number, number] = [0, 0];
  const total0 = st.totalValue;
  for (let t = 0; t < ticks && !st.over; t++) {
    if (assistEvery) driver.assist(assistEvery);
    const heldBefore = st.characters.map((c) => c.grab !== null);
    const protectedBefore = st.characters.map((c) => c.protectTicks > 1 || c.knockdownTicks > 1);
    const evs: SimEvent[] = sim.step(driver.commands());
    stats.ticks++;
    // --- value conservation and scores (police never touch them) ---
    expect(st.scores[0] + st.scores[1] + st.remainingValue).toBe(st.totalValue);
    expect(st.totalValue).toBe(total0);
    let settled: [number, number] = [0, 0];
    for (const e of evs) {
      if (e.type === 'recovered') {
        settled[e.team] += e.value;
        stats.recovered++;
      }
    }
    expect(st.scores[0] - prevScores[0]).toBe(settled[0]);
    expect(st.scores[1] - prevScores[1]).toBe(settled[1]);
    prevScores = [st.scores[0], st.scores[1]];
    settled = [0, 0];
    // --- police events ---
    for (const e of evs) {
      switch (e.type) {
        case 'alarm':
          stats.alarms++;
          expect(st.loot.find((l) => l.id === e.bankId)!.kind).toBe('bank');
          break;
        case 'policeDispatched':
          carEntry.set(e.carId, e.entryIndex);
          stats.waves++;
          expect(st.over).toBe(false);
          break;
        case 'policeTackle':
          if (e.hit) {
            stats.hits++;
            // only ever a character carrying loot (held since last tick, or grabbed this tick
            // before physics) that was not protected / down
            const grabbedNow = evs.some((g) => g.type === 'grab' && g.charId === e.victimId);
            expect(heldBefore[e.victimId - 1] || grabbedNow).toBe(true);
            expect(protectedBefore[e.victimId - 1]).toBe(false);
            const v = st.characters[e.victimId - 1]!;
            expect(v.grab).toBeNull();
            expect(v.knockdownTicks).toBeGreaterThan(0);
          } else stats.misses++;
          break;
        case 'policeStunned':
          stats.stuns++;
          break;
        case 'policeGone':
          stats.gone++;
          break;
        default:
          break;
      }
    }
    // --- officers: finite, inside, unique, bounded lifetime, not stuck ---
    const ids = new Set<number>();
    for (const o of st.police) {
      expect(ids.has(o.id)).toBe(false);
      ids.add(o.id);
      expect(finite(o.pos) && finite(o.vel) && Number.isFinite(o.facing)).toBe(true);
      expect(o.pos.x >= 0 && o.pos.x <= size.x && o.pos.y >= 0 && o.pos.y <= size.y).toBe(true);
      expect(o.phase).not.toBe('gone');
      const l = (life.get(o.id) ?? 0) + 1;
      life.set(o.id, l);
      expect(l).toBeLessThan(MAX_OFFICER_LIFE);
      if (st.tick % 180 === 0) {
        const w = windowStart.get(o.id);
        const moving = o.phase === 'patrol' || o.phase === 'chase' || o.phase === 'leaving';
        let run = 0;
        if (w && moving && w.phase === o.phase) {
          stats.windows++;
          if (Math.hypot(o.pos.x - w.x, o.pos.y - w.y) < 0.5) {
            stats.slowWindows++;
            run = w.run + 1;
            stats.maxSlowRun = Math.max(stats.maxSlowRun, run);
          }
        }
        windowStart.set(o.id, { x: o.pos.x, y: o.pos.y, phase: o.phase, run });
      }
    }
    // boarded officers: only at their car, and their physics bodies are gone for good
    for (const [id, p] of lastSeen) {
      if (ids.has(id)) continue;
      const park = entries[carEntry.get(p.carId)!]!.park;
      expect(Math.hypot(p.x - park.x, p.y - park.y)).toBeLessThan(BOARD_NEAR_CAR);
      lastSeen.delete(id);
    }
    for (const o of st.police) lastSeen.set(o.id, { x: o.pos.x, y: o.pos.y, carId: o.carId });
    if (st.police.length === 0) expect(physics.bodies.length).toBe(baseBodies);
    expect(st.policeCars.length).toBeLessThanOrEqual(2);
    for (const c of st.policeCars) expect(finite(c.pos) && Number.isFinite(c.angle)).toBe(true);
    for (const c of st.characters) expect(c.pos.x >= 0 && c.pos.x <= size.x && c.pos.y >= 0 && c.pos.y <= size.y).toBe(true);
  }
  stats.officers = life.size;
  stats.over = st.result?.reason ?? null;
  if (st.over) {
    // nothing dispatched after the end
    const endTick = st.result!.endTick;
    expect(sim.eventLog.filter((e) => e.type === 'policeDispatched' && e.tick > endTick)).toEqual([]);
  }
  return stats;
}

describe('police fuzz on the real match layouts', () => {
  for (const id of MATCH_LAYOUT_IDS) {
    for (const seed of [3, 4]) {
      it(`${id} seed ${seed}: long match with police keeps every invariant`, () => {
        const s = policeFuzz(id, seed, 24000, { matchTicks: 24000, earlyDecision: false });
        // eslint-disable-next-line no-console
        console.log(`[police fuzz ${id} ${seed}]`, JSON.stringify(s));
        expect(s.alarms).toBeGreaterThan(0);
        expect(s.waves).toBeGreaterThan(0);
        expect(s.officers).toBeGreaterThan(0);
        // officers keep moving: rarely stalled for a 3 s window, never for long
        expect(s.slowWindows).toBeLessThanOrEqual(Math.max(3, s.windows * 0.12));
        expect(s.maxSlowRun).toBeLessThanOrEqual(4);
      });
    }
    it(`${id}: default-rules match with chaos assist ends validly`, () => {
      const s = policeFuzz(id, 21, 20000, {}, 400);
      expect(s.over).not.toBeNull();
    });
  }
});

describe('police determinism', () => {
  function record(id: LayoutId, seed: number, ticks: number): { cmds: Command[][]; state: string; log: string } {
    const sim = new Simulation(makeSetup(LAYOUTS[id], [0, 0, 1, 1], { police: true, earlyDecision: false }));
    const driver = new FuzzDriver(sim, seed);
    const cmds: Command[][] = [];
    for (let t = 0; t < ticks; t++) {
      const c = driver.commands();
      cmds.push(JSON.parse(JSON.stringify(c)) as Command[]);
      sim.step(c);
    }
    return { cmds, state: JSON.stringify(sim.state), log: JSON.stringify(sim.eventLog) };
  }

  for (const id of MATCH_LAYOUT_IDS) {
    it(`${id}: identical command streams give identical police states and events`, () => {
      const a = record(id, 5, 6000);
      expect(a.log).toContain('policeArrived');
      const sim = new Simulation(makeSetup(LAYOUTS[id], [0, 0, 1, 1], { police: true, earlyDecision: false }));
      for (const c of a.cmds) sim.step(c);
      expect(JSON.stringify(sim.state)).toBe(a.state);
      expect(JSON.stringify(sim.eventLog)).toBe(a.log);
    });
  }
});

describe('police performance', () => {
  it('officer brains + nav + contacts average < 0.1 ms per officer per tick', () => {
    const sim = new Simulation(makeSetup(LAYOUTS.plaza, [0, 0, 1, 1], { police: true, matchTicks: 100000, earlyDecision: false }));
    const driver = new FuzzDriver(sim, 42);
    // instrument the police runtime (internal) to time only the police work
    const pol = (sim as unknown as { ctx: { police: Record<string, (...a: unknown[]) => unknown> } }).ctx.police;
    let total = 0;
    for (const m of ['prePhysics', 'afterSubstep', 'afterPhysics', 'postTick']) {
      const f = pol[m]!.bind(pol);
      pol[m] = (...a: unknown[]) => {
        const t0 = performance.now();
        const r = f(...a);
        total += performance.now() - t0;
        return r;
      };
    }
    let officerTicks = 0;
    let stepTotal = 0;
    for (let t = 0; t < 12000; t++) {
      const c = driver.commands();
      const t0 = performance.now();
      sim.step(c);
      stepTotal += performance.now() - t0;
      officerTicks += sim.state.police.length;
    }
    expect(officerTicks).toBeGreaterThan(5000);
    const perOfficer = total / officerTicks;
    // eslint-disable-next-line no-console
    console.log(
      `[bench] police: ${(perOfficer * 1000).toFixed(1)} us per officer-tick over ${officerTicks} officer-ticks; full step avg ${((stepTotal / 12000) * 1000).toFixed(1)} us`,
    );
    expect(perOfficer).toBeLessThan(0.1);
    expect(stepTotal / 12000).toBeLessThan(0.5);
  });
});
