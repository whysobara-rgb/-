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

/** Which way a label sits from its anchor: -1 lifted above, 1 pushed below, 0 on it. */
export type Side = -1 | 0 | 1;

/**
 * Memory for a label that is re-placed every frame (hysteresis). Without it the "nearest free
 * spot" flips between above and below a moving blocker whenever the two distances cross, and
 * the tag teleports a whole tag height back and forth.
 */
export interface PlaceHint {
  /** Side the label sat on last frame. */
  side?: Side;
  /** Side to try first when the label has to leave its anchor (name tags lean up). */
  lean?: Side;
  /**
   * How much nearer (px) the other side must be before the label switches away from `side` /
   * `lean` (default: one tag height). Infinity = switch only when no spot is left on that side.
   */
  stick?: number;
  /** Extra clearance (px) a nudged label needs before it drops back onto its anchor (default 4). */
  release?: number;
}

/** Stick margin while a fresh side change holds (in tag heights): firm, but never absurd. */
export const HOLD_STICK = 3;

/**
 * Bottom edge for a w×h label whose preferred bottom is `bottom`, centred on `cx`, given the
 * already placed boxes. Pushes the chosen box onto `placed` and returns its bottom.
 * Without `hint` it takes the nearest free spot (stateless, the 3D menu tags).
 */
export function placeLabel(placed: Box[], cx: number, bottom: number, w: number, h: number, gap = 3, hint?: PlaceHint): number {
  const l = cx - w / 2;
  const r = cx + w / 2;
  let best = bottom;
  const side = hint?.side ?? 0;
  const release = hint?.release ?? 4;
  const free = !hits(placed, l, r, bottom - h, bottom, gap);
  // A nudged label stays off its anchor until the anchor is clear by `release` more px.
  const holding = free && side !== 0 && hits(placed, l, r, bottom - h, bottom, gap + release);
  if (!free || holding) {
    cand.length = 0;
    const cg = holding ? gap + release : gap;
    for (let i = 0; i < placed.length; i++) {
      const q = placed[i]!;
      if (l >= q.r + cg || r <= q.l - cg) continue;
      cand.push(q.t - gap - 0.01, q.b + gap + h + 0.01);
    }
    // nearest free spot above (c < bottom) and below
    let up = NaN;
    let dn = NaN;
    for (const c of cand) {
      const d = Math.abs(c - bottom);
      if (c <= bottom ? Number.isFinite(up) && d >= bottom - up : Number.isFinite(dn) && d >= dn - bottom) continue;
      if (hits(placed, l, r, c - h, c, gap)) continue;
      if (c <= bottom) up = c;
      else dn = c;
    }
    const dUp = Number.isFinite(up) ? bottom - up : Infinity;
    const dDn = Number.isFinite(dn) ? dn - bottom : Infinity;
    if (holding) {
      // keep the old side while it is close by (about one blocker past the anchor); otherwise
      // settle back on the anchor
      const c = side < 0 ? up : dn;
      const d = side < 0 ? dUp : dDn;
      if (d <= 2 * (h + gap) + release) best = c;
    } else if (dUp !== Infinity || dDn !== Infinity) {
      best = dUp <= dDn ? up : dn;
      const pref = side !== 0 ? side : (hint?.lean ?? 0);
      if (pref !== 0 && hint) {
        const stick = hint.stick ?? h;
        const dPref = pref < 0 ? dUp : dDn;
        const dOther = pref < 0 ? dDn : dUp;
        if (dPref !== Infinity && dPref <= dOther + stick) best = pref < 0 ? up : dn;
      }
    }
  }
  placed.push({ l, t: best - h, r, b: best });
  return best;
}

/** Side of a placed bottom relative to the anchor bottom (half a px of slack). */
export function sideOf(anchorBottom: number, placedBottom: number): Side {
  const d = placedBottom - anchorBottom;
  return d < -0.5 ? -1 : d > 0.5 ? 1 : 0;
}

/**
 * One step of a critically damped spring (exact solution, stable for any dt): `s.x` moves to
 * `target` with velocity `s.v`. ω = 40/s settles ~95 % in 120 ms with no overshoot.
 */
export function springStep(s: { x: number; v: number }, target: number, dt: number, omega = 40): void {
  if (!(dt > 0)) return;
  const x0 = s.x - target;
  const k = s.v + omega * x0;
  const e = Math.exp(-omega * dt);
  s.x = target + (x0 + k * dt) * e;
  s.v = (s.v - omega * k * dt) * e;
  if (Math.abs(s.x - target) < 0.02 && Math.abs(s.v) < 1) {
    s.x = target;
    s.v = 0;
  }
}

/** A world tag re-placed every frame, with the memory that keeps it steady. */
export interface Tag {
  /** Anchor (centre x, bottom y) this frame, CSS px. */
  ax: number;
  ay: number;
  /** Measured size (px); <= 0 = unknown (kept on its anchor). */
  w: number;
  h: number;
  /** Lower = placed first. */
  prio: number;
  /** Stable tie-break among equal priorities (older tags keep their spot). */
  seq: number;
  /** Side to try first when nudged off the anchor. */
  lean?: Side;
  // --- memory (owned by layoutTags) ---
  side: Side;
  /** Seconds since `side` last changed. */
  sideAge: number;
  /** Last side off the anchor (preferred again when the tag gets blocked anew). */
  lastSide: Side;
  /** Displayed vertical offset from the anchor (eased) and its velocity. */
  off: { x: number; v: number };
  /** Snap the offset this frame (newly shown). */
  fresh: boolean;
}

/** A side change holds at least this long (s) unless the side gets blocked. */
export const SIDE_HOLD = 0.5;

export function newTagMemory(): Pick<Tag, 'side' | 'sideAge' | 'lastSide' | 'off' | 'fresh'> {
  return { side: 0, sideAge: SIDE_HOLD, lastSide: 0, off: { x: 0, v: 0 }, fresh: true };
}

/**
 * De-overlap pass with memory: places `tags` (sorted in place by priority, then age), keeps each
 * on the side it sat on last frame while that side stays reasonable, and eases the vertical
 * offset (never the anchor) so a forced move slides instead of jumping. The anchor itself is
 * followed exactly: an un-nudged tag sits on `ay` with no lag. Afterwards the displayed bottom
 * of a tag is `ay + off.x`.
 */
export function layoutTags(tags: Tag[], placed: Box[], dt: number, gap = 3): void {
  tags.sort((a, b) => a.prio - b.prio || a.seq - b.seq);
  const step = Math.min(Math.max(dt, 0), 0.1);
  for (const t of tags) {
    let bottom = t.ay;
    if (t.w > 0) {
      const stick = t.sideAge < SIDE_HOLD ? HOLD_STICK * t.h : undefined;
      bottom = placeLabel(placed, t.ax, t.ay, t.w, t.h, gap, { side: t.side, lean: t.lean || t.lastSide, stick });
    }
    const side = sideOf(t.ay, bottom);
    if (side !== t.side) {
      t.side = side;
      t.sideAge = 0;
      if (side !== 0) t.lastSide = side;
    } else t.sideAge += step;
    const target = bottom - t.ay;
    if (t.fresh) {
      t.off.x = target;
      t.off.v = 0;
      t.fresh = false;
    } else springStep(t.off, target, step);
  }
}
