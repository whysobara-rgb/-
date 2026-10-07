/**
 * World-label stability (owner report: "물건들 뽑아서 끌고올때 글자가 엄청 떨리네"): the pure seams
 * behind WorldLabels / PropLabels.
 * - declutter hysteresis: a tag overlapping a moving tag keeps its side instead of teleporting a
 *   whole tag height whenever the up / down distances cross; a forced side change across another
 *   tag is a quick fade cut (never a visible slide through it), a short move eases, both settle
 *   in ~150 ms; a nudged tag is pushed along by its blocker with no lag but keeps a little play
 *   when pulled back (a vibrating blocker does not pass its shake on); a tag back on its anchor
 *   takes the near way; at most one switch per SIDE_HOLD, and a second cut waits SIDE_HOLD while
 *   its drawn spot stays free; un-nudged tags follow their anchor exactly;
 *   equal priorities keep a stable order.
 * - springStep: critically damped, no overshoot, frame-rate independent.
 * - adapters: labels anchor on the drawn (interpolated) pose when the view supplies one, and
 *   proximity value tags have a show / hide hysteresis band.
 */
import { describe, expect, it } from 'vitest';
import { CUT_HOLD_REACH, HOLD_STICK, layoutTags, newTagMemory, placeLabel, SIDE_HOLD, sideOf, springStep, tagOpacity, tagPlay, type Box, type Tag } from '../../src/ui/core/declutter';
import { hudModelFromSim, labelsFromSim } from '../../src/ui/hud/adapters';
import { Simulation, type MatchSetup } from '../../src/sim';
import { LAYOUTS } from '../../src/sim/layouts';
import type { Vec2 } from '../../src/sim/types';

const GAP = 3;

function tag(o: Partial<Tag> & Pick<Tag, 'ax' | 'ay' | 'w' | 'h' | 'prio' | 'seq'>): Tag {
  return { ...newTagMemory(), ...o };
}

/** The value tag of a dragged safe bobbing around the point where up / down cost the same. */
function bobbing(t: number): number {
  // name bottom 300, value box 26 high: up = 329 - y, down = y - 277 -> equal at y = 303
  return 303 + 6 * Math.sin(t * 2 * Math.PI * 1.3) + 1 * Math.sin(t * 2 * Math.PI * 7.1);
}

describe('placeLabel hysteresis', () => {
  it('stateless placement flips sides when the distances cross (the bug)', () => {
    let flips = 0;
    let prev = 0;
    for (let f = 0; f < 144 * 5; f++) {
      const placed: Box[] = [];
      placeLabel(placed, 500, bobbing(f / 144), 70, 26, GAP);
      const s = sideOf(300, placeLabel(placed, 505, 300, 60, 20, GAP));
      if (prev !== 0 && s !== prev) flips++;
      if (s !== 0) prev = s;
    }
    expect(flips).toBeGreaterThan(5);
  });

  it('keeps the previous side while it is free and not much farther', () => {
    const placed: Box[] = [{ l: 465, t: 275, r: 535, b: 301 }];
    // down (24 px) is nearer than up (28 px), but the tag was above: it stays above
    const b = placeLabel(placed, 505, 300, 60, 20, GAP, { side: -1 });
    expect(sideOf(300, b)).toBe(-1);
    // the stateless rule would take the nearer side
    expect(sideOf(300, placeLabel([{ l: 465, t: 275, r: 535, b: 301 }], 505, 300, 60, 20, GAP))).toBe(1);
    // ...and so does the hinted one once the other side is nearer by more than the stick margin
    const placed2: Box[] = [{ l: 465, t: 275, r: 535, b: 301 }];
    const b2 = placeLabel(placed2, 505, 300, 60, 20, GAP, { side: -1, stick: 2 });
    expect(sideOf(300, b2)).toBe(1);
  });

  it('switches when its side is blocked, even while a side change holds', () => {
    const placed: Box[] = [
      { l: 465, t: 277, r: 535, b: 303 },
      { l: 0, t: 0, r: 1000, b: 276 }, // everything above is taken
    ];
    const b = placeLabel(placed, 505, 300, 60, 20, GAP, { side: -1, stick: HOLD_STICK * 20 });
    expect(sideOf(300, b)).toBe(1);
    expect(b - 20).toBeGreaterThanOrEqual(303 + GAP);
  });

  it('a nudged tag drops back onto its anchor only once clear by the release margin', () => {
    // the blocker slides out sideways; the tag box spans x 475..535, y 280..300
    // 2 px clear (inside the 4 px release band): stays lifted
    const near: Box[] = [{ l: 400, t: 285, r: 475 - GAP - 2, b: 305 }];
    const b = placeLabel(near, 505, 300, 60, 20, GAP, { side: -1 });
    expect(sideOf(300, b)).toBe(-1);
    expect(b).toBeCloseTo(285 - GAP - 0.01, 5);
    // 6 px clear: back on the anchor
    const far: Box[] = [{ l: 400, t: 285, r: 475 - GAP - 6, b: 305 }];
    expect(placeLabel(far, 505, 300, 60, 20, GAP, { side: -1 })).toBe(300);
    // no memory: the plain rule (free -> anchor)
    const plain: Box[] = [{ l: 400, t: 285, r: 475 - GAP - 2, b: 305 }];
    expect(placeLabel(plain, 505, 300, 60, 20, GAP)).toBe(300);
  });

  it('lean: a name tag goes up first unless down is nearer by more than a tag height', () => {
    const placed: Box[] = [{ l: 465, t: 277, r: 535, b: 303 }];
    expect(sideOf(300, placeLabel(placed, 505, 300, 60, 20, GAP, { lean: -1 }))).toBe(-1);
    const placed2: Box[] = [{ l: 465, t: 285, r: 535, b: 340 }];
    // up 18 px vs down 63 px: up anyway; reversed geometry (down far nearer) goes down
    expect(sideOf(300, placeLabel(placed2, 505, 300, 60, 20, GAP, { lean: -1 }))).toBe(-1);
    const placed3: Box[] = [{ l: 465, t: 230, r: 535, b: 285 }];
    expect(sideOf(300, placeLabel(placed3, 505, 300, 60, 20, GAP, { lean: -1 }))).toBe(1);
  });
});

describe('layoutTags (temporal de-overlap)', () => {
  for (const hz of [60, 120, 144]) {
    it(`a name tag beside a dragged safe's tag never switches sides and never jumps @ ${hz} Hz`, () => {
      const value = tag({ ax: 500, ay: 0, w: 70, h: 26, prio: 3, seq: 0 });
      const name = tag({ ax: 505, ay: 300, w: 60, h: 20, prio: 4, seq: 1, lean: -1 });
      const dt = 1 / hz;
      let flips = 0;
      let prevSide = 0;
      let prevRel = NaN;
      let maxStep = 0;
      let maxBlocker = 0;
      for (let f = 0; f < hz * 6; f++) {
        const t = f * dt;
        // the whole group glides across the screen (camera follow) while the tag bobs
        const pan = 400 * t;
        value.ax = 500 + pan;
        value.ay = bobbing(t);
        if (f > 0) maxBlocker = Math.max(maxBlocker, Math.abs(value.ay - bobbing(t - dt)));
        name.ax = 505 + pan;
        name.ay = 300;
        layoutTags([value, name], [], dt, GAP);
        if (name.side !== 0 && prevSide !== 0 && name.side !== prevSide) flips++;
        if (name.side !== 0) prevSide = name.side;
        const rel = name.off.x; // displayed bottom - anchor bottom
        if (Number.isFinite(prevRel)) maxStep = Math.max(maxStep, Math.abs(rel - prevRel));
        prevRel = rel;
        expect(value.off.x).toBe(0); // the higher-priority tag sits on its anchor exactly
      }
      expect(flips).toBe(0);
      expect(name.side).toBe(-1); // lean up: off the raccoon's head, not onto it
      // it only ever glides with the tag it sits on (no 50 px teleports): < 1 px/frame at 120+ Hz
      expect(maxStep).toBeLessThanOrEqual(maxBlocker + 1e-6);
      if (hz >= 120) expect(maxStep).toBeLessThan(1);
      else expect(maxStep).toBeLessThan(2);
    });
  }

  for (const hz of [60, 120, 144]) {
    it(`a forced side change across another tag is a quick cut: never slides through it, never jumps while visible, settles within 150 ms @ ${hz} Hz`, () => {
      const value = tag({ ax: 500, ay: 303, w: 70, h: 26, prio: 3, seq: 0 });
      const name = tag({ ax: 505, ay: 300, w: 60, h: 20, prio: 4, seq: 1, lean: -1 });
      const dt = 1 / hz;
      for (let f = 0; f < hz; f++) layoutTags([value, name], [], dt, GAP);
      expect(name.side).toBe(-1);
      const from = name.off.x;
      const target = 303 + GAP + 20 + 0.01 - 300;
      // a banner-sized keep-out drops in above: the up side is blocked
      const keepOut: Box = { l: 0, t: 0, r: 1000, b: 270 };
      let prev = from;
      let prevA = 1;
      let settledAt = NaN;
      let rising = false;
      for (let f = 1; f <= hz / 2; f++) {
        layoutTags([value, name], [keepOut], dt, GAP);
        const step = Math.abs(name.off.x - prev);
        // it only moves while invisible: no visible slide across '100', no visible teleport
        if (step > 1e-9) expect(Math.min(prevA, name.alpha)).toBe(0);
        // the drawn tag never covers the value tag while it is more than half visible
        const top = 300 + name.off.x - 20;
        if (name.alpha >= 0.5) expect(top >= 303 || 300 + name.off.x <= 303 - 26).toBe(true);
        // one fade out, then one fade in (no flicker)
        if (name.alpha > prevA) rising = true;
        else if (rising) expect(name.alpha).toBeGreaterThanOrEqual(prevA);
        prev = name.off.x;
        prevA = name.alpha;
        if (!Number.isFinite(settledAt) && name.alpha === 1 && Math.abs(name.off.x - target) < 0.05) settledAt = f * dt;
      }
      expect(name.side).toBe(1);
      expect(Math.abs(target - from)).toBeGreaterThan(45); // a whole tag height and more
      expect(settledAt).toBeLessThanOrEqual(0.15 + 1e-9);
      expect(name.off.x).toBeCloseTo(target, 5);
    });
  }

  it('a short move that crosses nothing eases (slides, stays visible) and settles within ~150 ms', () => {
    // the tag sits lifted above a blocker; the blocker slides away sideways -> back onto the anchor
    const name = tag({ ax: 505, ay: 300, w: 60, h: 20, prio: 4, seq: 1, lean: -1 });
    const dt = 1 / 144;
    const blocker = (x: number): Box => ({ l: x, t: 285, r: x + 70, b: 305 });
    for (let f = 0; f < 72; f++) layoutTags([name], [blocker(440)], dt, GAP);
    const from = name.off.x;
    expect(from).toBeCloseTo(285 - GAP - 0.01 - 300, 5);
    let prev = from;
    let maxStep = 0;
    let settledAt = NaN;
    for (let f = 1; f <= 72; f++) {
      layoutTags([name], [blocker(300)], dt, GAP);
      expect(name.alpha).toBe(1);
      maxStep = Math.max(maxStep, Math.abs(name.off.x - prev));
      prev = name.off.x;
      if (!Number.isFinite(settledAt) && Math.abs(name.off.x) < 0.05 * Math.abs(from)) settledAt = f * dt;
    }
    expect(name.side).toBe(0);
    expect(maxStep).toBeLessThan(Math.abs(from) / 4); // eased over several frames
    expect(settledAt).toBeLessThanOrEqual(0.15);
    expect(name.off.x).toBe(0);
  });

  it('a tag back on its anchor is nudged the near way, not back to its old side far off (no 58 px hop)', () => {
    // just dropped back onto its anchor after sitting above (lastSide up, side change 0.3 s ago);
    // a tall stack above now grazes its top: 1 px down clears it, the old side is 57 px up
    const name = tag({ ax: 505, ay: 300, w: 60, h: 19, prio: 4, seq: 1, lean: -1, side: 0, sideAge: 0.3, lastSide: -1, fresh: false });
    const stack: Box = { l: 470, t: 246, r: 540, b: 279 };
    layoutTags([name], [stack], 1 / 60, GAP);
    expect(name.side).toBe(1);
    expect(name.tgt).toBeGreaterThan(0);
    expect(name.tgt).toBeLessThan(2);
    // a fresh side change still holds firmly (the hysteresis against flip-flop is unchanged)
    const held = tag({ ax: 505, ay: 300, w: 60, h: 19, prio: 4, seq: 1, side: -1, sideAge: 0.3, lastSide: -1, fresh: false });
    expect(sideOf(300, placeLabel([{ ...stack }], 505, 300, 60, 19, GAP, { side: -1, stick: HOLD_STICK * 19 }))).toBe(-1);
    layoutTags([held], [{ l: 470, t: 246, r: 540, b: 279 }], 1 / 60, GAP);
    expect(held.side).toBe(-1);
  });

  for (const hz of [60, 144]) {
    it(`a nudged tag riding a fast-moving blocker is pushed along at once (no lag, no trailing overlap), pulled back within its play @ ${hz} Hz`, () => {
      const value = tag({ ax: 500, ay: 300, w: 70, h: 26, prio: 3, seq: 0 });
      const name = tag({ ax: 505, ay: 300, w: 60, h: 20, prio: 4, seq: 1, lean: -1 });
      const dt = 1 / hz;
      for (let f = 0; f < hz * 2; f++) {
        // the blocker's tag bobs under the name tag at up to ~300 px/s relative to its anchor;
        // the name tag stays lifted above it the whole time
        value.ay = 310 + 15 * Math.sin(f * dt * 2 * Math.PI * 3.2);
        layoutTags([value, name], [], dt, GAP);
        if (f > 0) {
          // never behind its spot (toward the blocker), at most the play beyond it
          expect(name.off.x).toBeLessThanOrEqual(name.tgt + 1e-6);
          expect(name.off.x).toBeGreaterThanOrEqual(name.tgt - tagPlay(20) - 1e-6);
        }
        expect(name.alpha).toBe(1);
        // never drawn over the value tag
        const b = name.ay + name.off.x;
        expect(b <= value.ay - 26 - GAP + 0.02 || b - 20 >= value.ay + GAP - 0.02).toBe(true);
      }
    });
  }

  for (const hz of [60, 144]) {
    for (const freq of [7, 12]) {
      it(`a tag pushed by a vibrating blocker does not take on its shake (±6 px @ ${freq} Hz, ${hz} Hz display)`, () => {
        // a held bank's estimate tag shaking (holder spring) brushes the carrier's name tag below it
        const bank = tag({ ax: 400, ay: 300, w: 140, h: 50, prio: 0, seq: 0 });
        const name = tag({ ax: 410, ay: 325, w: 70, h: 20, prio: 4, seq: 1, lean: -1 });
        const dt = 1 / hz;
        let lo = Infinity;
        let hi = -Infinity;
        for (let f = 0; f < hz * 4; f++) {
          bank.ay = 300 + 6 * Math.sin(2 * Math.PI * freq * f * dt);
          layoutTags([bank, name], [], f ? dt : 0, GAP);
          expect(name.alpha).toBe(1);
          // never drawn over the shaking tag
          expect(name.ay + name.off.x - 20).toBeGreaterThanOrEqual(bank.ay + GAP - 1e-6);
          if (f * dt > 2) {
            lo = Math.min(lo, name.off.x);
            hi = Math.max(hi, name.off.x);
          }
        }
        // the blocker moves 12 px peak to peak; riding it 1:1 gave the name tag ~3-4 px of shake
        expect(hi - lo).toBeLessThan(1.5);
      });
    }
  }

  it('a second cut within SIDE_HOLD is held off while the spot the tag is drawn at stays free', () => {
    const value = tag({ ax: 500, ay: 303, w: 70, h: 26, prio: 3, seq: 0 });
    const name = tag({ ax: 505, ay: 300, w: 60, h: 20, prio: 4, seq: 1, lean: -1 });
    const keepOut: Box = { l: 0, t: 0, r: 1000, b: 270 }; // the up side is taken (a banner)
    const dt = 1 / 120;
    const cuts: number[] = [];
    let prevA = 1;
    let t = 0;
    const run = (secs: number, extra: Box[]) => {
      for (let f = 0; f < Math.round(secs / dt); f++) {
        layoutTags([value, name], extra.map((b) => ({ ...b })), dt, GAP);
        t += dt;
        if (name.alpha < 1 && prevA >= 1) cuts.push(t);
        prevA = name.alpha;
      }
    };
    run(1, [keepOut]);
    expect(name.side).toBe(1); // below the value tag, settled
    expect(cuts).toHaveLength(0);
    // another object's tag drops onto its spot: the only free spot is past it (a long move: cut 1)
    const below: Box = { l: 470, t: 320, r: 540, b: 340 };
    run(0.2, [keepOut, below]);
    expect(cuts).toHaveLength(1);
    expect(name.off.x).toBeCloseTo(340 + GAP + 20 + 0.01 - 300, 5);
    const held = name.off.x;
    // the up side frees up and is much nearer now: without the hold it would cut straight back
    // across both tags; it stays where it is (visible, still) until SIDE_HOLD has passed
    run(0.25, [below]);
    expect(cuts).toHaveLength(1);
    expect(name.alpha).toBe(1);
    expect(name.off.x).toBe(held);
    run(0.6, [below]);
    expect(cuts).toHaveLength(2);
    expect(cuts[1]! - cuts[0]!).toBeGreaterThanOrEqual(SIDE_HOLD - 1e-9);
    expect(name.side).toBe(-1); // then it takes the near spot above the value tag
  });

  it('placeLabel near: keeps a free spot where the tag is drawn, but never strays far from the anchor', () => {
    const v: Box = { l: 465, t: 277, r: 535, b: 303 };
    const k: Box = { l: 470, t: 320, r: 540, b: 340 };
    // drawn below k (63 px down): free and within reach of the nearest spot (26 px up) -> kept
    expect(placeLabel([{ ...v }, { ...k }], 505, 300, 60, 20, GAP, { near: 363.01, stick: CUT_HOLD_REACH * 20 })).toBeCloseTo(363.01, 5);
    // drawn spot taken: the free spot nearest to it (just below the new blocker) while in reach
    const k2: Box = { l: 470, t: 350, r: 540, b: 370 };
    expect(placeLabel([{ ...v }, { ...k }, { ...k2 }], 505, 300, 60, 20, GAP, { near: 363.01, stick: 4 * 20 })).toBeCloseTo(370 + GAP + 20 + 0.01, 5);
    // ...unless that is more than `stick` farther from the anchor than the nearest spot: nearest it is
    expect(placeLabel([{ ...v }, { ...k }, { ...k2 }], 505, 300, 60, 20, GAP, { near: 363.01, stick: 20 })).toBeCloseTo(277 - GAP - 0.01, 5);
  });

  it('tagOpacity: blank when shown, rounded otherwise', () => {
    expect(tagOpacity(1)).toBe('');
    expect(tagOpacity(0.999)).toBe('');
    expect(tagOpacity(0.5)).toBe('0.5');
    expect(tagOpacity(0.123)).toBe('0.12');
    expect(tagOpacity(0)).toBe('0');
  });

  it('switches sides at most once per SIDE_HOLD while the old side stays free', () => {
    const value = tag({ ax: 500, ay: 290, w: 70, h: 50, prio: 3, seq: 0 });
    const name = tag({ ax: 505, ay: 300, w: 60, h: 20, prio: 4, seq: 1 });
    const dt = 1 / 120;
    const changes: number[] = [];
    let prev = 0;
    for (let f = 0; f < 120 * 4; f++) {
      const t = f * dt;
      // the blocker jumps between "down nearer by 50 px" and "up nearer by 30 px" every 0.1 s
      value.ay = Math.floor(t / 0.1) % 2 ? 330 : 290;
      layoutTags([value, name], [], dt, GAP);
      if (name.side !== 0 && name.side !== prev) {
        if (prev !== 0) changes.push(t);
        prev = name.side;
      }
    }
    expect(changes.length).toBeGreaterThanOrEqual(2); // it does follow the nearer side, slowly
    for (let i = 1; i < changes.length; i++) expect(changes[i]! - changes[i - 1]!).toBeGreaterThanOrEqual(SIDE_HOLD - 1e-9);
  });

  it('un-nudged tags follow a moving anchor exactly (no lag, no smoothing of the anchor)', () => {
    const a = tag({ ax: 100, ay: 100, w: 60, h: 20, prio: 3, seq: 0 });
    for (let f = 0; f < 200; f++) {
      a.ax = 100 + f * 3.7;
      a.ay = 100 + Math.sin(f / 7) * 40;
      layoutTags([a], [], 1 / 144, GAP);
      expect(a.off.x).toBe(0);
      expect(a.side).toBe(0);
    }
  });

  it('equal priorities keep a stable order (older tag keeps its spot), not screen height', () => {
    const older = tag({ ax: 500, ay: 300, w: 60, h: 20, prio: 3, seq: 1 });
    const newer = tag({ ax: 500, ay: 290, w: 60, h: 20, prio: 3, seq: 2 });
    for (let f = 0; f < 60; f++) {
      // they swap which one is higher on screen (a rotating bank's '실림' tags)
      older.ay = 300 + Math.sin(f / 5) * 8;
      newer.ay = 300 - Math.sin(f / 5) * 8;
      layoutTags([newer, older], [], 1 / 60, GAP);
      expect(older.off.x).toBe(0);
      expect(newer.side).not.toBe(0);
    }
  });

  it('a newly shown tag appears at its place without sliding in', () => {
    const value = tag({ ax: 500, ay: 303, w: 70, h: 26, prio: 3, seq: 0 });
    const name = tag({ ax: 505, ay: 300, w: 60, h: 20, prio: 4, seq: 1, lean: -1 });
    layoutTags([value, name], [], 1 / 60, GAP);
    expect(name.off.x).toBeCloseTo(277 - GAP - 0.01 - 300, 5);
  });
});

describe('springStep', () => {
  it('is critically damped (no overshoot) and settles within ~150 ms', () => {
    const s = { x: 0, v: 0 };
    let max = 0;
    let t95 = NaN;
    for (let f = 1; f <= 60; f++) {
      springStep(s, 50, 1 / 144);
      max = Math.max(max, s.x);
      if (!Number.isFinite(t95) && s.x >= 47.5) t95 = f / 144;
    }
    expect(max).toBeLessThanOrEqual(50);
    expect(t95).toBeLessThanOrEqual(0.15);
    expect(s.x).toBe(50);
  });

  it('is frame-rate independent (exact solution)', () => {
    const a = { x: 0, v: 0 };
    const b = { x: 0, v: 0 };
    for (let f = 0; f < 6; f++) springStep(a, 40, 1 / 60);
    for (let f = 0; f < 12; f++) springStep(b, 40, 1 / 120);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.v).toBeCloseTo(b.v, 4);
  });

  it('ignores zero / negative / NaN dt', () => {
    const s = { x: 3, v: 1 };
    springStep(s, 10, 0);
    springStep(s, 10, -1);
    springStep(s, 10, NaN);
    expect(s).toEqual({ x: 3, v: 1 });
  });
});

describe('label anchors (adapters)', () => {
  const setup = (): MatchSetup => ({
    layout: LAYOUTS.plaza,
    seed: 7,
    roster: [
      { team: 0, isBot: false, name: '나', look: { hat: 'teamCapA' } },
      { team: 0, isBot: true, name: 'ally-bot', look: { hat: 'teamCapA' } },
      { team: 1, isBot: true, name: 'b1', look: { hat: 'teamCapB' } },
      { team: 1, isBot: true, name: 'b2', look: { hat: 'teamCapB' } },
    ],
  });
  const project = (p: Vec2, h: number) => ({ x: p.x * 10, y: p.y * 10 - h, onScreen: true });

  it('anchors bank / value / name tags on the drawn pose when the view supplies one', () => {
    const sim = new Simulation(setup());
    const me = sim.characterBySlot(0);
    const drawn = (p: Vec2): Vec2 => ({ x: p.x + 0.25, y: p.y - 0.125 });
    const posOf = (id: number, kind: 'loot' | 'char'): Vec2 | null => {
      if (kind === 'char') {
        const c = sim.state.characters.find((cc) => cc.id === id);
        return c ? drawn(c.pos) : null;
      }
      const l = sim.getLoot(id);
      return l ? drawn(l.pos) : null;
    };
    const raw = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project, nearRadius: 500 });
    const m = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project, nearRadius: 500, posOf });
    const kinds = new Set<string>();
    for (const l of m.labels ?? []) {
      const r = (raw.labels ?? []).find((q) => q.kind === l.kind && q.id === l.id)!;
      expect(r).toBeTruthy();
      if (l.kind === 'ping') continue;
      kinds.add(l.kind);
      expect(l.x - r.x).toBeCloseTo(2.5, 6);
      expect(l.y - r.y).toBeCloseTo(-1.25, 6);
    }
    expect([...kinds].sort()).toEqual(['bank', 'name', 'value']);
    // no rendered pose (not drawn): the sim position
    const m2 = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project, nearRadius: 500, posOf: () => null });
    expect(m2.labels).toEqual(raw.labels);
  });

  it('proximity value tags have a show / hide hysteresis band', () => {
    const sim = new Simulation(setup());
    const me = sim.characterBySlot(0);
    const l = sim.state.loot
      .filter((q) => q.kind !== 'bank' && !q.variant && !q.dormant)
      .map((q) => ({ q, d: Math.hypot(q.pos.x - me.pos.x, q.pos.y - me.pos.y) }))
      .filter((o) => o.d > 4)
      .sort((a, b) => a.d - b.d)[0]!;
    const shown = (r: number): boolean => labelsFromSim(sim, me, project, { nearRadius: r }).labels.some((x) => x.kind === 'value' && x.id === l.q.id);
    expect(shown(l.d + 0.1)).toBe(true); // inside
    expect(shown(l.d - 0.4)).toBe(true); // just outside, was shown: held
    expect(shown(l.d - 1.0)).toBe(false); // past the band: hidden
    expect(shown(l.d - 0.4)).toBe(false); // was hidden: needs to come inside the radius again
    expect(shown(l.d + 0.1)).toBe(true);
  });
});
