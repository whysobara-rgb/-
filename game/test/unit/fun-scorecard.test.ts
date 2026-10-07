/**
 * C11 fun / content scorecard (tools/fun): the per-match collector accounts for every point and the
 * report renders. Short matches only (the full scorecard runs from tools/balance-report.ts --fun).
 */
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../src/ai/harness';
import { FunCollector, type FunRec } from '../../tools/fun/collect';
import { funReport } from '../../tools/fun/report';

function play(content: 'classic' | 'v2', seed: number, maxTicks: number): FunRec {
  const col = new FunCollector({ id: seed, block: 'P', group: 'proxy vs nunchi', variant: content, layout: 'counter', seed, aTeam: seed % 2 });
  const team = [{ personality: 'hodadak' as const, difficulty: 'normal' as const, humanProxy: true }];
  const opp = [{ personality: 'nunchi' as const, difficulty: 'normal' as const }];
  const stats = runMatch({ layout: 'counter', team0: seed % 2 === 0 ? team : opp, team1: seed % 2 === 0 ? opp : team, seed, maxTicks, rules: { police: true, content }, onTick: col.onTick });
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

  it('renders the fun + content report with the classic column as the baseline', () => {
    const recs = [play('classic', 4, 60 * 60), play('v2', 4, 60 * 60)];
    const md = funReport(recs, { content: true });
    expect(md).toContain('classic re-baseline');
    expect(md).toContain('Proxy first score, median, worst map (s)');
    expect(md).toContain('content block (content-plan §8)');
  });
});
