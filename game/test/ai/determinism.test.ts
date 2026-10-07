/**
 * Same seed = same match (bots are deterministic: seeded RNG, no wall clock, no Math.random).
 */
import { describe, expect, it } from 'vitest';
import { createMatch, runMatch } from '../../src/ai/harness';

function fingerprint(seed: number): string {
  const { sim, bots } = createMatch({
    layout: 'shortcut',
    team0: [
      { personality: 'tongkeun', difficulty: 'normal' },
      { personality: 'hodadak', difficulty: 'challenge' },
    ],
    team1: [
      { personality: 'nunchi', difficulty: 'novice' },
      { personality: 'tongkeun', difficulty: 'challenge' },
    ],
    seed,
  });
  let h = 0;
  for (let t = 0; t < 3600 && !sim.state.over; t++) {
    const cmds = bots.map((b) => b.update(sim));
    for (const c of cmds) h = (Math.imul(h, 31) + Math.round(c.move.x * 1e6) * 7 + Math.round(c.move.y * 1e6) * 13 + (c.grab ? 1 : 0) + (c.dash ? 2 : 0)) | 0;
    sim.step(cmds);
  }
  const st = sim.state;
  return JSON.stringify({ h, tick: st.tick, scores: st.scores, pos: st.characters.map((c) => [c.pos.x.toFixed(6), c.pos.y.toFixed(6)]), events: sim.eventLog.length });
}

describe('determinism', () => {
  it('identical seeds produce identical 2v2 matches; another seed differs', () => {
    const a = fingerprint(42);
    const b = fingerprint(42);
    expect(a).toBe(b);
    expect(fingerprint(43)).not.toBe(a);
  });

  it('a full 1v1 match replays identically', () => {
    const spec = { layout: 'counter' as const, team0: [{ personality: 'hodadak' as const, difficulty: 'normal' as const }], team1: [{ personality: 'nunchi' as const, difficulty: 'normal' as const }], seed: 5 };
    const r1 = runMatch(spec);
    const r2 = runMatch(spec);
    expect(r2.result).toEqual(r1.result);
    expect(r2.slots.map((s) => [s.points, s.dashes, s.knockdownsDealt])).toEqual(r1.slots.map((s) => [s.points, s.dashes, s.knockdownsDealt]));
    expect(r1.invariantViolations).toBe(0);
  });
});
