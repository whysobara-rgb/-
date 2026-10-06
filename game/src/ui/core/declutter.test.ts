import { describe, expect, it } from 'vitest';
import { placeLabel, type Box } from './declutter';

const overlaps = (a: Box, b: Box): boolean => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

describe('placeLabel', () => {
  it('keeps a free label on its anchor', () => {
    const placed: Box[] = [];
    expect(placeLabel(placed, 100, 200, 60, 20)).toBe(200);
    expect(placeLabel(placed, 300, 200, 60, 20)).toBe(200);
  });

  it('moves a colliding label to the nearest free spot in its column', () => {
    const placed: Box[] = [];
    placeLabel(placed, 100, 200, 80, 30); // occupies 180..170? (t=170, b=200)
    const b = placeLabel(placed, 110, 205, 60, 20);
    // below the first one (205 -> 223.01) is nearer than above (167 -> 38 px away)
    expect(b).toBeGreaterThan(200);
    expect(overlaps(placed[0]!, placed[1]!)).toBe(false);
  });

  it('never leaves a pile overlapping (stack of five tags at one point)', () => {
    const placed: Box[] = [];
    for (let i = 0; i < 5; i++) placeLabel(placed, 500, 400, 70, 24);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
  });

  it('treats pre-placed keep-out boxes as taken', () => {
    const placed: Box[] = [{ l: 0, t: 0, r: 1000, b: 100 }];
    const b = placeLabel(placed, 500, 90, 60, 20);
    expect(b - 20).toBeGreaterThanOrEqual(100);
  });
});
