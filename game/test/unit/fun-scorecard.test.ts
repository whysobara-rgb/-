/**
 * C11 fun / content scorecard (tools/fun): the per-match collector accounts for every point and the
 * report renders. Short matches only (the full scorecard runs from tools/balance-report.ts --fun).
 */
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../src/ai/harness';
import type { Simulation } from '../../src/sim/sim';
import { FunCollector, type FunRec } from '../../tools/fun/collect';
import { bootCI, funReport, pairedDiff } from '../../tools/fun/report';

/** Initial value of outdoor / bank-interior safes (plain safes only; props have a variant). */
interface SafeCaps {
  outdoorLarge: number;
  outdoorSmall: number;
  interior: number;
}

function play(content: 'classic' | 'v2', seed: number, maxTicks: number, caps?: SafeCaps): FunRec {
  const col = new FunCollector({ id: seed, block: 'P', group: 'proxy vs nunchi', variant: content, layout: 'counter', seed, aTeam: seed % 2 });
  const team = [{ personality: 'hodadak' as const, difficulty: 'normal' as const, humanProxy: true }];
  const opp = [{ personality: 'nunchi' as const, difficulty: 'normal' as const }];
  let first = true;
  const onTick = (sim: Simulation, ev: Parameters<FunCollector['onTick']>[1]): void => {
    if (first && caps) {
      first = false;
      for (const l of sim.state.loot) {
        if (l.kind === 'bank' || l.variant) continue;
        if (l.homeBank !== null) caps.interior += l.baseValue;
        else if (l.kind === 'largeSafe') caps.outdoorLarge += l.baseValue;
        else caps.outdoorSmall += l.baseValue;
      }
    }
    col.onTick(sim, ev);
  };
  const stats = runMatch({ layout: 'counter', team0: seed % 2 === 0 ? team : opp, team1: seed % 2 === 0 ? opp : team, seed, maxTicks, rules: { police: true, content }, onTick });
  return col.finish(stats);
}

describe('fun scorecard collector (C11)', () => {
  for (const content of ['classic', 'v2'] as const) {
    it(`accounts for every point (${content})`, () => {
      const r = play(content, 3, 90 * 60);
      const scored = r.scores[0] + r.scores[1];
      const rows = r.rec.reduce((a, x) => a + x[2], 0);
      const bySource = Object.values(r.pointsBySource).reduce((a, x) => a + x, 0);
      expect(rows).toBe(scored);
      expect(bySource).toBeCloseTo(scored, 0);
      expect(r.coinPoints).toBe(r.rec.filter((x) => x[5] === 1).reduce((a, x) => a + x[2], 0));
      expect(r.content).toBe(content);
      expect(r.totalValue).toBe(content === 'v2' ? 4000 : 3200);
      expect(r.invariantViolations).toBe(0);
      expect(r.proxyId).not.toBeNull();
      const proxy = r.chars.find((c) => c.id === r.proxyId)!;
      expect(proxy.isBot).toBe(false);
      expect(proxy.verbs.length).toBeGreaterThan(0);
      // JSON-safe (records go through worker pipes / jsonl files)
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    });
  }

  it('splits bank-interior safes from outdoor safes and tags every row with a transport mode', () => {
    const caps: SafeCaps = { outdoorLarge: 0, outdoorSmall: 0, interior: 0 };
    const r = play('v2', 5, 150 * 60, caps);
    expect(caps.interior).toBeGreaterThan(0);
    // a source can never pay more than the safes of that class on the map
    expect(r.pointsBySource.largeSafe ?? 0).toBeLessThanOrEqual(caps.outdoorLarge);
    expect(r.pointsBySource.smallSafe ?? 0).toBeLessThanOrEqual(caps.outdoorSmall);
    expect(r.pointsBySource.bankSafe ?? 0).toBeLessThanOrEqual(caps.interior);
    for (const row of r.rec) {
      expect(['solo', 'team', 'loose', 'bag']).toContain(row[6]);
      expect(row[6] === 'bag').toBe(row[5] === 1);
    }
    // per-item stats add up to the per-character totals
    for (const c of r.chars) {
      const items = Object.values(c.items ?? {});
      expect(items.reduce((a, s) => a + s.pickups, 0)).toBe(c.itemPickups);
      expect(items.reduce((a, s) => a + s.uses, 0)).toBe(c.itemUses);
      expect(items.reduce((a, s) => a + s.heldTicks, 0)).toBe(c.itemHeldTicks);
    }
  });

  it('bootstrap interval and paired difference', () => {
    const a = Array.from({ length: 101 }, (_, i) => i);
    const ci = bootCI(a)!;
    expect(ci[0]).toBeLessThan(50);
    expect(ci[1]).toBeGreaterThan(50);
    expect(bootCI(a)).toEqual(ci); // deterministic
    expect(bootCI([1, 2])).toBeNull();
    const d = pairedDiff(Array.from({ length: 40 }, (_, i) => 1 + (i % 2 ? 0.1 : -0.1)))!;
    expect(d.mean).toBeCloseTo(1, 6);
    expect(d.lo).toBeGreaterThan(0.9);
    expect(d.hi).toBeLessThan(1.1);
  });

  it('renders the fun + content report with the classic column as the baseline', () => {
    const recs = [play('classic', 4, 60 * 60), play('v2', 4, 60 * 60)];
    const md = funReport(recs, { content: true });
    expect(md).toContain('classic re-baseline');
    expect(md).toContain('Proxy first score, median, worst map (s)');
    expect(md).toContain('content block (content-plan §8)');
    expect(md).toContain('per item (P + B + T2 pooled)');
    expect(md).toContain('feature reach / watch list');
    expect(md).toContain('Variety index ÷ classic');
    expect(md).toContain('Sim step median, 2:2 every system on (T2), ms');
  });

  it('lists gate changes and the paired comparison against the reference variant', () => {
    const v2 = play('v2', 6, 60 * 60);
    const lever = { ...JSON.parse(JSON.stringify(v2)), variant: 'v2+lever' } as FunRec;
    const md = funReport([v2, lever], { content: true });
    expect(md).toContain('Gate changes vs `v2`');
    expect(md).toContain('`v2+lever`: no must-gate regression');
    expect(md).toContain('Paired comparison: `v2+lever` vs `v2`');
  });
});
