/**
 * Render beats (fun round WP3 / Content 2.0 F3), headless: the glance envelope and its caps, the
 * getaway timeline (3-4 m pull-away, free-run limit), the label screen clamp out of the HUD bands,
 * steady-state churn of the beat visuals (no Object3D / material / texture / geometry created per
 * frame), the reduced-motion guard on GameView.glance and the moment -> mood mapping of
 * GameView.onMoments (called on a stand-in `this`: GameView itself needs WebGL).
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BarkBubble, BeatLabel, BEATS, GlanceTracker, PulseRing, WindupRing, clampNdc, departParam, getawayDepart, labelScaleFor, vanFreeRun } from '../../src/render/beats';
import { GameView } from '../../src/render/view';
import { planMomentFeel } from '../../src/game/feel';
import type { Moment } from '../../src/shared/moments';

/** Next global ids of the three.js object kinds (they increment on every construction). */
function nextIds(): [number, number, number, number] {
  const o = new THREE.Object3D().id;
  const m = new THREE.MeshBasicMaterial();
  const t = new THREE.Texture();
  const g = new THREE.BufferGeometry();
  const ids: [number, number, number, number] = [o, (m as unknown as { id: number }).id, t.id, g.id];
  m.dispose();
  t.dispose();
  g.dispose();
  return ids;
}

describe('GlanceTracker', () => {
  it('clamps the weight to 0.3 and eases in, holds and eases out back to 0', () => {
    const g = new GlanceTracker();
    expect(g.begin({ x: 10, y: 0 }, 0.9, 1000, 0)).toBe(true);
    expect(g.weightAt(0)).toBe(0);
    const peak = g.weightAt(0.5);
    expect(peak).toBeCloseTo(0.3, 6);
    expect(g.weightAt(0.1)).toBeGreaterThan(0);
    expect(g.weightAt(0.1)).toBeLessThan(peak);
    expect(g.weightAt(0.9)).toBeLessThan(peak);
    expect(g.weightAt(1.0)).toBe(0);
    expect(g.active).toBe(false);
  });

  it('rejects bad input and caps the camera shift so the player stays in frame', () => {
    const g = new GlanceTracker();
    expect(g.begin({ x: NaN, y: 0 }, 0.2, 900, 0)).toBe(false);
    expect(g.begin({ x: 1, y: 1 }, 0, 900, 0)).toBe(false);
    expect(g.begin({ x: 1, y: 1 }, 0.2, 0, 0)).toBe(false);
    expect(g.begin({ x: 100, y: 0 }, 0.3, 1000, 0)).toBe(true);
    const out = { x: 0, y: 0 };
    const w = g.apply(0.5, 0, 0, out);
    expect(w).toBeCloseTo(0.3, 6);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(BEATS.glance.maxShift, 6); // 30 m wanted, 6 m allowed
    // a near play shifts by weight x distance (no yaw: only the target moves)
    g.begin({ x: 10, y: 0 }, 0.25, 1000, 0);
    g.apply(0.5, 0, 0, out);
    expect(out.x).toBeCloseTo(2.5, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });
});

describe('getaway timeline', () => {
  it('revs first, then pulls away 3-4 m inside the 2.4 s end hold', () => {
    const G = BEATS.getaway;
    expect(getawayDepart(0, 10)).toBe(0);
    expect(getawayDepart(G.revFor, 10)).toBe(0);
    expect(getawayDepart(G.revFor + G.driveFor / 2, 10)).toBeCloseTo(G.distance / 2, 6);
    const done = getawayDepart(G.revFor + G.driveFor, 10);
    expect(done).toBeGreaterThanOrEqual(3);
    expect(done).toBeLessThanOrEqual(4);
    expect(G.revFor + G.driveFor).toBeLessThanOrEqual(2.4);
    // monotone
    let last = 0;
    for (let t = 0; t <= 2.4; t += 1 / 60) {
      const m = getawayDepart(t, 10);
      expect(m).toBeGreaterThanOrEqual(last - 1e-9);
      last = m;
    }
  });

  it('respects the free run (blocked vans only rev) and maps meters onto van.setDepart', () => {
    expect(getawayDepart(2.4, 2)).toBeCloseTo(2, 6);
    expect(getawayDepart(2.4, 0.5)).toBe(0);
    for (const m of [0, 1, 3.6]) expect(departParam(m) ** 2 * BEATS.getaway.vanDepartMeters).toBeCloseTo(m, 6);
  });

  it('vanFreeRun stops before a wall ahead of the nose', () => {
    const half = { x: 2.3, y: 1.15 };
    const open = vanFreeRun({ x: 10, y: 10 }, 0, half, () => true);
    expect(open).toBeCloseTo(BEATS.getaway.distance, 6);
    // wall at x = 15: the front (x = 12.3) may roll until the probe circle touches it
    const walled = vanFreeRun({ x: 10, y: 10 }, 0, half, (p, r) => p.x + r <= 15);
    expect(walled).toBeGreaterThanOrEqual(1.4);
    expect(walled).toBeLessThanOrEqual(15 - 12.3 + 1e-6);
    expect(vanFreeRun({ x: 10, y: 10 }, 0, half, () => false)).toBe(0);
  });
});

describe('beat label', () => {
  it('clamps into the safe box (below the scoreboard band, inside the screen)', () => {
    const p = { x: 2, y: 0.9 };
    expect(clampNdc(p)).toBe(true);
    expect(p.y).toBe(BEATS.label.maxY);
    expect(p.x).toBe(BEATS.label.maxX);
    const q = { x: 0.1, y: 0.1 };
    expect(clampNdc(q)).toBe(false);
  });

  it('pins to the load, but a load under the top HUD band gets its label pushed down', () => {
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 400);
    cam.position.set(0, 17, 12);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const label = new BeatLabel('t');
    label.set('막아야 해!', 'theirs');
    label.place(0, 2, 0, cam, 1, 0, 0);
    expect(label.sprite.position.x).toBeCloseTo(0, 4);
    expect(label.sprite.position.y).toBeCloseTo(2, 4);
    // default: lifted ~34 px above the anchor (clears the HUD value chip)
    const a = new THREE.Vector3(0, 2, 0).project(cam);
    label.place(0, 2, 0, cam, 1, 0);
    const b = label.sprite.position.clone().project(cam);
    expect(((b.y - a.y) / 2) * 720).toBeCloseTo(BEATS.label.liftPx, 3);
    // far right: the whole plate stays inside the screen
    label.place(60, 2, 0, cam, 1, 0);
    const r = label.sprite.position.clone().project(cam);
    const halfW = (label.sprite.scale.x / (2 * Math.tan(((38 * Math.PI) / 180) / 2) * cam.aspect));
    expect(r.x + halfW).toBeLessThanOrEqual(1);
    // far up-screen (north): projects above the band -> clamped
    label.place(0, 2, -30, cam, 1, 0);
    const ndc = label.sprite.position.clone().project(cam);
    expect(ndc.y).toBeLessThanOrEqual(BEATS.label.maxY + 1e-6);
    // label px at 720p regardless of distance (constant pixel size)
    const px = (label.sprite.scale.y / (2 * Math.tan(((38 * Math.PI) / 180) / 2))) * 720;
    expect(px).toBeCloseTo(BEATS.label.px, 1);
    expect(labelScaleFor(BEATS.label.px, 38)).toBeCloseTo(label.sprite.scale.y, 6);
    label.hide();
    expect(label.shown).toBe(false);
    label.dispose();
  });
});

describe('beat visuals churn', () => {
  it('creates nothing per frame in steady state', () => {
    const root = new THREE.Group();
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 400);
    cam.position.set(0, 17, 12);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const ring = new PulseRing('r');
    const wind = new WindupRing();
    const label = new BeatLabel('l');
    const bark = new BarkBubble();
    root.add(ring.root, wind.mesh, label.sprite, bark.sprite);
    label.set('이게 들어가면 끝!', 'ours');
    bark.show('내 은행!!', 5);
    const frame = (i: number): void => {
      ring.update(true, i * 0.01, 0, 0, 1.4, 1 / 60, 1.2, false);
      wind.update(i / 60, 0, 0, 0, 1 / 60, false);
      label.place(i * 0.01, 2, 0, cam, 1 / 60, 0.5);
      bark.update(0, 2.5, 0, 1 / 60, false);
    };
    for (let i = 0; i < 30; i++) frame(i); // warm up
    const before = nextIds();
    for (let i = 30; i < 600; i++) frame(i);
    const after = nextIds();
    expect(after.map((v, k) => v - before[k]!)).toEqual([1, 1, 1, 1]); // only the probes themselves
    expect(root.children.length).toBe(4);
    expect(ring.root.visible).toBe(true);
    // same text again: no new texture
    label.set('이게 들어가면 끝!', 'ours');
    const again = nextIds();
    expect(again[2] - after[2]).toBe(1);
    for (const x of [ring, wind, label, bark]) x.dispose();
  });

  it('rings fade out when switched off, calm rings drop the ripple', () => {
    const ring = new PulseRing('r');
    ring.update(true, 0, 0, 0, 1, 1 / 60, 1, true);
    expect(ring.root.visible).toBe(true);
    for (let i = 0; i < 30; i++) ring.update(false, 0, 0, 0, 1, 1 / 60, 1, true);
    expect(ring.root.visible).toBe(false);
    const w = new WindupRing();
    w.update(0, 0, 0, 0, 1 / 30, false);
    expect(w.mesh.visible).toBe(true);
    for (let i = 0; i < 20; i++) w.update(null, 0, 0, 0, 1 / 60, false);
    expect(w.mesh.visible).toBe(false);
    ring.dispose();
    w.dispose();
  });

  it('bark bubbles expire', () => {
    const b = new BarkBubble();
    b.show('어머~', 1);
    let n = 0;
    while (b.update(0, 2, 0, 1 / 60, true)) n++;
    expect(n).toBeGreaterThan(50);
    expect(n).toBeLessThan(70);
    expect(b.shown).toBe(false);
    b.dispose();
  });
});

describe('GameView beats (stand-in this)', () => {
  it('glance is a no-op with reduced motion or outside the match (feel layer plans none either)', () => {
    const begin = vi.fn();
    const self = { disposed: false, settings: { reducedMotion: true }, viewMode: 'match', glanceT: { begin }, time: 0 };
    GameView.prototype.glance.call(self as unknown as GameView, { x: 1, y: 2 }, 0.25, 900);
    expect(begin).not.toHaveBeenCalled();
    self.settings.reducedMotion = false;
    self.viewMode = 'results';
    GameView.prototype.glance.call(self as unknown as GameView, { x: 1, y: 2 }, 0.25, 900);
    expect(begin).not.toHaveBeenCalled();
    self.viewMode = 'match';
    GameView.prototype.glance.call(self as unknown as GameView, { x: 1, y: 2 }, 0.25, 900);
    expect(begin).toHaveBeenCalledTimes(1);
    // feel: reduced motion plans no glance / slow-mo / hit-stop for any moment
    const ms = [{ kind: 'bigPlay', pos: { x: 20, y: 0 } }, { kind: 'jackpot', pos: { x: 20, y: 0 } }, { kind: 'craneDrop', pos: { x: 20, y: 0 } }, { kind: 'goldHammer', pos: { x: 20, y: 0 } }];
    const plan = planMomentFeel(ms, { reducedMotion: true, speed: 1, steering: false, playerPos: { x: 0, y: 0 }, ticksLeft: 60 });
    expect(plan).toEqual({ glance: null, slowmo: null, hitstop: 0 });
    // and the content big plays do glance with motion on
    for (const m of ms) expect(planMomentFeel([m], { reducedMotion: false, speed: 1, steering: false, playerPos: { x: 0, y: 0 }, ticksLeft: 6000 }).glance).not.toBeNull();
  });

  it('onMoments: rattles the team that lost the lead / had its run broken, pulses big plays', () => {
    const teamReact = vi.fn();
    const impactAt = vi.fn();
    const fx = { ring: vi.fn(), sparkle: vi.fn() };
    const self = { sim: { state: {} }, viewMode: 'match', moods: { teamReact }, effects: { fx }, impactAt };
    const m = (kind: Moment['kind'], team: 0 | 1): Moment => ({ kind, team, tick: 10, pos: { x: 5, y: 6 } });
    GameView.prototype.onMoments.call(self as unknown as GameView, [m('leadTaken', 0), m('streakBroken', 1), m('bigPlay', 0), m('jackpot', 1), m('goldHammer', 0), m('dodged', 0)]);
    expect(teamReact).toHaveBeenCalledWith(self.sim, 1, 'rattled', { x: 5, y: 6 });
    expect(teamReact).toHaveBeenCalledWith(self.sim, 0, 'pumped', { x: 5, y: 6 });
    expect(teamReact.mock.calls.filter((c) => c[1] === 1 && c[2] === 'rattled')).toHaveLength(2);
    expect(impactAt).toHaveBeenCalledTimes(2);
    expect(fx.ring).toHaveBeenCalledTimes(1);
    expect(fx.sparkle).toHaveBeenCalledTimes(1);
    // outside the match nothing reacts
    teamReact.mockClear();
    self.viewMode = 'results';
    GameView.prototype.onMoments.call(self as unknown as GameView, [m('leadTaken', 0)]);
    expect(teamReact).not.toHaveBeenCalled();
  });
});
