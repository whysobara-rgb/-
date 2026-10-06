/**
 * Tiny label de-overlap helper shared by the HUD world labels and the 3D menu price tags.
 *
 * Labels are placed one by one (caller sorts by priority). Each keeps its anchor when free;
 * otherwise it takes the nearest free spot straight above or below (just past one of the boxes
 * it would hit), so it stays in its object's column. O(n²) for the handful of tags on screen.
 */
export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

const cand: number[] = [];

function hits(placed: readonly Box[], l: number, r: number, t: number, b: number, gap: number): boolean {
  for (let i = 0; i < placed.length; i++) {
    const q = placed[i]!;
    if (l < q.r + gap && r > q.l - gap && t < q.b + gap && b > q.t - gap) return true;
  }
  return false;
}

/**
 * Bottom edge for a w×h label whose preferred bottom is `bottom`, centred on `cx`, given the
 * already placed boxes. Pushes the chosen box onto `placed` and returns its bottom.
 */
export function placeLabel(placed: Box[], cx: number, bottom: number, w: number, h: number, gap = 3): number {
  const l = cx - w / 2;
  const r = cx + w / 2;
  let best = bottom;
  if (hits(placed, l, r, bottom - h, bottom, gap)) {
    cand.length = 0;
    for (let i = 0; i < placed.length; i++) {
      const q = placed[i]!;
      if (l >= q.r + gap || r <= q.l - gap) continue;
      cand.push(q.t - gap - 0.01, q.b + gap + h + 0.01);
    }
    cand.sort((a, b) => Math.abs(a - bottom) - Math.abs(b - bottom));
    for (const c of cand) {
      if (!hits(placed, l, r, c - h, c, gap)) {
        best = c;
        break;
      }
    }
  }
  placed.push({ l, t: best - h, r, b: best });
  return best;
}
