/**
 * Fuzz invariants (doc §19 점수 경쟁의 추가 검증, §20 출시를 막는 결함), determinism and the
 * per-step performance budget.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import type { Command, SimEvent } from '../../src/sim/types';
import { FuzzDriver } from './fixtures/fuzzbot';
import { fullLayout, makeSetup } from './fixtures/layouts';

const finite = (v: { x: number; y: number }) => Number.isFinite(v.x) && Number.isFinite(v.y);

interface FuzzStats {
  recovered: number;
  banks: number;
  fences: number;
  knockdowns: number;
  grabs: number;
  unstuck: number;
  over: string | null;
}

function fuzz(seed: number, ticks: number, rules = {}, assistEvery = 0): FuzzStats {
  const sim = new Simulation(makeSetup(fullLayout(), [0, 0, 1, 1], rules));
  const driver = new FuzzDriver(sim, seed);
  const size = sim.layout.size;
  const settledIds = new Set<number>();
  let prev: [number, number] = [0, 0];
  let prevEnd = sim.state.endTick;
  const total0 = sim.state.totalValue;
  const stats: FuzzStats = { recovered: 0, banks: 0, fences: 0, knockdowns: 0, grabs: 0, unstuck: 0, over: null };
  for (let t = 0; t < ticks && !sim.state.over; t++) {
    if (assistEvery) driver.assist(assistEvery);
    const ev = sim.step(driver.commands());
    const s = sim.state;
    // value conservation
    // (Content 2.0: totalValue is constant from tick 0 — never a hard-coded 3200 — and
    // remainingValue covers loot + inner coins, piles, bags, breakables and pending event value)
    expect(s.scores[0] + s.scores[1] + s.remainingValue).toBe(s.totalValue);
    expect(s.totalValue).toBe(total0);
    let rem = 0;
    for (const l of s.loot) if (!l.recovered) rem += l.baseValue + (l.innerValue ?? 0);
    for (const c of s.coins) rem += c.value;
    for (const c of s.characters) rem += c.bag ?? 0;
    for (const b of s.breakables) if (!b.broken) rem += b.innerValue;
    for (const e of s.matchEvents) rem += e.pendingValue;
    expect(s.remainingValue).toBe(rem);
    // scores never decrease, end never later
    expect(s.scores[0]).toBeGreaterThanOrEqual(prev[0]);
    expect(s.scores[1]).toBeGreaterThanOrEqual(prev[1]);
    expect(s.endTick).toBeLessThanOrEqual(prevEnd);
    prev = [s.scores[0], s.scores[1]];
    prevEnd = s.endTick;
    // nothing NaN, nothing outside the arena, nothing lost
    for (const c of s.characters) {
      expect(finite(c.pos) && finite(c.vel)).toBe(true);
      expect(c.pos.x >= 0 && c.pos.x <= size.x && c.pos.y >= 0 && c.pos.y <= size.y).toBe(true);
    }
    for (const l of s.loot) {
      if (l.recovered) continue;
      expect(finite(l.pos) && finite(l.vel) && Number.isFinite(l.angle)).toBe(true);
      expect(l.pos.x >= 0 && l.pos.x <= size.x && l.pos.y >= 0 && l.pos.y <= size.y).toBe(true);
      if (l.kind === 'bank') {
        let v = 500;
        for (const sid of l.loadedSafes) v += sim.getLoot(sid)!.baseValue;
        expect(l.estimatedValue).toBe(v);
      }
    }
    // each id settles at most once; bank value = 500 + its safes
    for (const e of ev) {
      if (e.type === 'recovered') {
        for (const id of [e.lootId, ...e.safeIds]) {
          expect(settledIds.has(id)).toBe(false);
          settledIds.add(id);
        }
        stats.recovered += 1 + e.safeIds.length;
        if (e.kind === 'bank') {
          stats.banks++;
          expect(e.value).toBe(500 + e.safesValue);
        }
      } else if (e.type === 'fenceBroken') stats.fences++;
      else if (e.type === 'dashHit' && e.knockdown) stats.knockdowns++;
      else if (e.type === 'grab') stats.grabs++;
      else if (e.type === 'unstuck') stats.unstuck++;
    }
    // grabs consistent with loot.grabbedBy
    for (const c of s.characters) {
      if (c.grab) expect(sim.getLoot(c.grab.targetId)!.grabbedBy).toContain(c.id);
    }
  }
  stats.over = sim.state.result?.reason ?? null;
  // every settled id is marked recovered, every recovered id was settled
  for (const l of sim.state.loot) expect(l.recovered).toBe(settledIds.has(l.id));
  return stats;
}

describe('invariant fuzz (full-size fixture, 4 characters)', () => {
  const seeds = [1, 2, 3, 4];
  for (const seed of seeds) {
    it(`seed ${seed}: 10k ticks keep every invariant`, () => {
      const stats = fuzz(seed, 10000, { matchTicks: 20000, earlyDecision: seed % 2 === 0 });
      // eslint-disable-next-line no-console
      console.log(`[fuzz seed ${seed}]`, JSON.stringify(stats));
      expect(stats.grabs).toBeGreaterThan(10);
    });
  }
  for (const seed of [11, 12, 13]) {
    it(`seed ${seed} with chaos assist: frequent settlements, ejections and a valid ending`, () => {
      const stats = fuzz(seed, 10000, {}, 180 + seed * 10);
      // eslint-disable-next-line no-console
      console.log(`[fuzz+assist seed ${seed}]`, JSON.stringify(stats));
      expect(stats.recovered).toBeGreaterThan(5);
      expect(stats.over).not.toBeNull();
    });
  }
  it('a full default-rules match runs to a valid result', () => {
    const stats = fuzz(99, 20000);
    expect(stats.over).not.toBeNull();
  });
});

describe('determinism', () => {
  function record(seed: number, ticks: number): { cmds: Command[][]; state: string; log: string } {
    const sim = new Simulation(makeSetup(fullLayout()));
    const driver = new FuzzDriver(sim, seed);
    const cmds: Command[][] = [];
    for (let t = 0; t < ticks; t++) {
      const c = driver.commands();
      cmds.push(JSON.parse(JSON.stringify(c)));
      sim.step(c);
    }
    return { cmds, state: JSON.stringify(sim.state), log: JSON.stringify(sim.eventLog) };
  }

  it('identical command streams produce identical states and events', () => {
    const a = record(7, 3000);
    const sim = new Simulation(makeSetup(fullLayout()));
    for (const c of a.cmds) sim.step(c);
    expect(JSON.stringify(sim.state)).toBe(a.state);
    expect(JSON.stringify(sim.eventLog)).toBe(a.log);
    const b = record(7, 3000);
    expect(b.state).toBe(a.state);
  });

  it('different command streams diverge (sanity)', () => {
    expect(record(8, 600).state).not.toBe(record(9, 600).state);
  });
});

describe('performance', () => {
  it('a full 2v2 layout step averages < 0.5 ms', () => {
    const sim = new Simulation(makeSetup(fullLayout(), [0, 0, 1, 1], { matchTicks: 100000, earlyDecision: false }));
    const driver = new FuzzDriver(sim, 42);
    const cmds: Command[][] = [];
    // pre-generate commands so only sim.step is timed (bots query the sim themselves)
    const warm = 600;
    for (let t = 0; t < warm; t++) sim.step(driver.commands());
    const N = 6000;
    let total = 0;
    let worst = 0;
    const evs: SimEvent[] = [];
    for (let t = 0; t < N; t++) {
      const c = driver.commands();
      cmds.push(c);
      const t0 = performance.now();
      evs.push(...sim.step(c));
      const dt = performance.now() - t0;
      total += dt;
      if (dt > worst) worst = dt;
    }
    const avg = total / N;
    // eslint-disable-next-line no-console
    console.log(`[bench] full 2v2 step: avg ${(avg * 1000).toFixed(1)} us, worst ${worst.toFixed(2)} ms over ${N} ticks`);
    expect(avg).toBeLessThan(0.5);
  });
});
