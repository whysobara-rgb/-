/**
 * Moments -> feel (fun-plan WP5 §2): slow-mo 0.5x / 0.4 s on bigPlay and on leadTaken in the
 * final 30 s, a <= 80 ms hit-stop instead while the player steers a load, a camera glance toward
 * big plays, and nothing at all with reduced motion (zero glance / slow-mo calls).
 */
import { describe, expect, it } from 'vitest';
import { MOMENT_FEEL, TimeScale, applyMomentFeel, planMomentFeel, type MomentFeelContext } from '../../src/game/feel';

const ctx = (o: Partial<MomentFeelContext> = {}): MomentFeelContext => ({ reducedMotion: false, speed: 1, steering: false, playerPos: { x: 0, y: 0 }, ticksLeft: 100 * 60, ...o });
const big = { kind: 'bigPlay', pos: { x: 12, y: 0 } };

describe('moment feel', () => {
  it('bigPlay: slow-mo 0.5x for 0.4 s + a glance (weight <= 0.3) toward it', () => {
    const p = planMomentFeel([big], ctx());
    expect(p.slowmo).toEqual({ scale: 0.5, seconds: 0.4 });
    expect(p.hitstop).toBe(0);
    expect(p.glance).toEqual({ pos: { x: 12, y: 0 }, weight: MOMENT_FEEL.glance.weight, ms: MOMENT_FEEL.glance.ms });
    expect(p.glance!.weight).toBeLessThanOrEqual(0.3);
  });

  it('leadTaken slows only in the final 30 s; other moments never change the pace', () => {
    expect(planMomentFeel([{ kind: 'leadTaken', pos: { x: 5, y: 0 } }], ctx({ ticksLeft: 31 * 60 })).slowmo).toBeNull();
    expect(planMomentFeel([{ kind: 'leadTaken', pos: { x: 5, y: 0 } }], ctx({ ticksLeft: 30 * 60 })).slowmo).not.toBeNull();
    expect(planMomentFeel([{ kind: 'streakTier' }, { kind: 'equalized' }, { kind: 'dodged' }], ctx({ ticksLeft: 60 })).slowmo).toBeNull();
  });

  it('while the player steers a load: a short hit-stop (<= 80 ms) instead of slow-mo, and no glance', () => {
    const p = planMomentFeel([big], ctx({ steering: true }));
    expect(p.slowmo).toBeNull();
    expect(p.hitstop).toBeGreaterThan(0);
    expect(p.hitstop).toBeLessThanOrEqual(0.08);
    expect(p.glance).toBeNull();
  });

  it('glances only toward things away from the player (>= 4 m) and in range (<= 40 m); jackpot / craneDrop / goldHammer too', () => {
    expect(planMomentFeel([{ kind: 'bigPlay', pos: { x: 1, y: 1 } }], ctx()).glance).toBeNull();
    expect(planMomentFeel([{ kind: 'bigPlay', pos: { x: 60, y: 0 } }], ctx()).glance).toBeNull();
    for (const kind of ['jackpot', 'craneDrop', 'goldHammer']) expect(planMomentFeel([{ kind, pos: { x: 10, y: 0 } }], ctx()).glance).not.toBeNull();
    expect(planMomentFeel([{ kind: 'stealChance', pos: { x: 10, y: 0 } }], ctx()).glance).toBeNull();
  });

  it('reduced motion: zero glance, slow-mo or hit-stop calls', () => {
    const time = new TimeScale();
    time.setEnabled(false);
    let glances = 0;
    const moments = [big, { kind: 'leadTaken', pos: { x: 8, y: 0 } }, { kind: 'jackpot', pos: { x: 9, y: 0 } }];
    for (const steering of [false, true]) {
      const plan = planMomentFeel(moments, ctx({ reducedMotion: true, steering, ticksLeft: 60 }));
      expect(plan).toEqual({ glance: null, slowmo: null, hitstop: 0 });
      // even a stale plan never runs once TimeScale is disabled
      const stale = planMomentFeel(moments, ctx({ steering }));
      const ran = applyMomentFeel(stale, time, () => glances++);
      expect(ran).toEqual({ glance: false, slowmo: false, hitstop: false });
    }
    expect(glances).toBe(0);
    expect(time.slow).toBe(false);
    expect(time.frozen).toBe(false);
  });

  it('?speed above 1 (tests) never changes the pace; apply runs the plan on TimeScale', () => {
    expect(planMomentFeel([big], ctx({ speed: 4 })).slowmo).toBeNull();
    const time = new TimeScale();
    const seen: number[] = [];
    const ran = applyMomentFeel(planMomentFeel([big], ctx()), time, (_p, w) => seen.push(w));
    expect(ran).toEqual({ glance: true, slowmo: true, hitstop: false });
    expect(time.slow).toBe(true);
    expect(time.scale).toBeCloseTo(0.5, 6);
    expect(seen).toEqual([MOMENT_FEEL.glance.weight]);
    const t2 = new TimeScale();
    applyMomentFeel(planMomentFeel([big], ctx({ steering: true })), t2, () => {});
    expect(t2.frozen).toBe(true);
    expect(t2.advance(0.05)).toBe(0);
  });
});
