/**
 * Positional mixing: stereo pan by x offset, distance attenuation (ref 6 m, silent by 40 m),
 * air-absorption cutoff, caption direction.
 */
import { describe, expect, it } from 'vitest';
import { SPATIAL, captionSide, distanceGain, spatialMix } from '../../src/audio/spatial';

describe('distance attenuation', () => {
  it('is full inside the reference distance and silent beyond 40 m', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(SPATIAL.refDistance)).toBe(1);
    expect(distanceGain(40)).toBe(0);
    expect(distanceGain(80)).toBe(0);
    expect(distanceGain(Number.NaN)).toBe(0);
  });

  it('decreases monotonically and stays clearly audible on screen', () => {
    let prev = 1;
    for (let d = 6; d <= 40; d += 0.5) {
      const g = distanceGain(d);
      expect(g).toBeLessThanOrEqual(prev + 1e-12);
      prev = g;
    }
    // ~12 m (edge of the screen): only a few dB down.
    expect(20 * Math.log10(distanceGain(12))).toBeGreaterThan(-6);
    // 30 m: well down but not gone.
    const g30 = distanceGain(30);
    expect(g30).toBeGreaterThan(0.05);
    expect(g30).toBeLessThan(0.3);
  });
});

describe('stereo pan', () => {
  it('follows the x offset (screen right = sim +x), bounded by maxPan', () => {
    const L = { x: 10, y: 10 };
    expect(spatialMix(L, { x: 20, y: 10 }).pan).toBeGreaterThan(0.4);
    expect(spatialMix(L, { x: 0, y: 10 }).pan).toBeLessThan(-0.4);
    expect(spatialMix(L, { x: 60, y: 10 }).pan).toBeCloseTo(SPATIAL.maxPan, 5);
    // Pure vertical offset: centered.
    expect(spatialMix(L, { x: 10, y: 25 }).pan).toBeCloseTo(0, 6);
  });

  it('collapses toward center for sounds right on top of the listener', () => {
    const near = spatialMix({ x: 0, y: 0 }, { x: 0.4, y: 0 });
    expect(Math.abs(near.pan)).toBeLessThan(0.01);
  });

  it('no position means centered and unattenuated', () => {
    const m = spatialMix({ x: 5, y: 5 }, undefined);
    expect(m).toMatchObject({ gain: 1, pan: 0 });
    expect(spatialMix({ x: 5, y: 5 }, { x: Number.NaN, y: 1 }).gain).toBe(1);
  });

  it('distant sounds get darker', () => {
    const near = spatialMix({ x: 0, y: 0 }, { x: 3, y: 0 });
    const far = spatialMix({ x: 0, y: 0 }, { x: 30, y: 0 });
    expect(near.cutoff).toBeGreaterThanOrEqual(18000);
    expect(far.cutoff).toBeLessThan(near.cutoff);
    expect(far.cutoff).toBeGreaterThanOrEqual(SPATIAL.farCutoff);
  });
});

describe('caption direction', () => {
  it('reports left/right only for clearly off-center sounds', () => {
    const L = { x: 0, y: 0 };
    expect(captionSide(spatialMix(L, { x: -10, y: 0 }))).toBe('left');
    expect(captionSide(spatialMix(L, { x: 10, y: 0 }))).toBe('right');
    expect(captionSide(spatialMix(L, { x: 1, y: 8 }))).toBeNull();
  });
});
