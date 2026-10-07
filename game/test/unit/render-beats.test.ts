/**
 * Render beats (fun round WP3 / Content 2.0 F3), headless: the glance envelope and its caps, the
 * getaway timeline (3-4 m pull-away, free-run limit), the label layout clear of the HUD zones,
 * steady-state churn of the beat visuals (no Object3D / material / texture / geometry created per
 * frame), the reduced-motion guard on GameView.glance and the moment -> mood mapping of
 * GameView.onMoments (called on a stand-in `this`: GameView itself needs WebGL).
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BarkBubble, BeatLabel, BEATS, GlanceTracker, LabelScreen, PulseRing, WindupRing, departParam, getawayDepart, hudRem, labelScaleFor, layoutLabel, vanFreeRun } from '../../src/render/beats';
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
  const cover = (x: number, b: number, pw: number, lh: number, r: { x0: number; y0: number; x1: number; y1: number }): number =>
    Math.max(0, Math.min(x + pw / 2, r.x1) - Math.max(x - pw / 2, r.x0)) * Math.max(0, Math.min(b, r.y1) - Math.max(b - lh, r.y0));

  it('HUD rem and zones follow styles/tokens.css + hud.css (720p and 1080p)', () => {
    expect(hudRem(1280, 720)).toBeCloseTo(10.6667, 3);
    expect(hudRem(1920, 1080)).toBeCloseTo(16, 6);
    expect(hudRem(1280, 720, 1.4)).toBeCloseTo(14.9333, 3);
    const s = new LabelScreen();
    s.setViewport(1280, 720);
    // measured HUD rects at 1280x720: top cluster x 339-941 y 11-115 (+ prompt to ~160), minimap
    // x 17-244 y 541-703, action buttons x 1096-1259 y 578-701 -> each inside its zone
    const inside = (z: { x0: number; y0: number; x1: number; y1: number }, x0: number, y0: number, x1: number, y1: number) => z.x0 <= x0 && z.y0 <= y0 && z.x1 >= x1 && z.y1 >= y1;
    expect(inside(s.zones[0]!, 339, 11, 941, 160)).toBe(true);
    expect(inside(s.zones[2]!, 17, 541, 244, 703)).toBe(true);
    expect(inside(s.zones[3]!, 1096, 578, 1259, 701)).toBe(true);
  });

  it('layoutLabel keeps a clear spot, steps out of HUD zones / the chip, stays inside the 16 px gutter', () => {
    const s = new LabelScreen();
    s.setViewport(1280, 720);
    const out = { cx: 0, by: 0 };
    const pw = 200;
    const lh = 52;
    // clear spot: unchanged
    expect(layoutLabel(640, 400, pw, lh, s, null, out)).toBe(0);
    expect(out).toEqual({ cx: 640, by: 400 });
    // under the top cluster: pushed out of it, no overlap left
    expect(layoutLabel(640, 120, pw, lh, s, null, out)).toBe(0);
    s.zones.forEach((z, i) => s.zoneWeight[i]! >= 1 && expect(cover(out.cx, out.by, pw, lh, z)).toBe(0));
    // pinned to the bottom-right corner (off-screen load): clear of the dash button
    expect(layoutLabel(5000, 5000, pw, lh, s, null, out)).toBe(0);
    expect(cover(out.cx, out.by, pw, lh, s.zones[3]!)).toBe(0);
    expect(out.cx + pw / 2).toBeLessThanOrEqual(1280 - 16);
    expect(out.by).toBeLessThanOrEqual(720 - 16);
    // bottom-left corner: clear of the minimap
    expect(layoutLabel(-300, 800, pw, lh, s, null, out)).toBe(0);
    expect(cover(out.cx, out.by, pw, lh, s.zones[2]!)).toBe(0);
    expect(out.cx - pw / 2).toBeGreaterThanOrEqual(16);
    // a bank chip just under the top cluster: the label can't go above it -> beside / below it, clear
    const chip = { x0: 560, y0: 168, x1: 747, y1: 243 };
    expect(layoutLabel(653, 168 - 5, pw, lh, s, chip, out)).toBe(0);
    expect(cover(out.cx, out.by, pw, lh, chip)).toBe(0);
    s.zones.forEach((z, i) => s.zoneWeight[i]! >= 1 && expect(cover(out.cx, out.by, pw, lh, z)).toBe(0));
    // the stamp column is soft: a label just under it stays put rather than leaving its load
    expect(layoutLabel(640, 250, pw, lh, s, null, out)).toBe(0);
    expect(out).toEqual({ cx: 640, by: 250 });
    // extras (another label) are avoided too
    s.clearExtras();
    s.addExtra(540, 300, 740, 352);
    expect(layoutLabel(640, 352, pw, lh, s, null, out)).toBe(0);
    expect(cover(out.cx, out.by, pw, lh, s.extras[0]!)).toBe(0);
    s.clearExtras();
  });

  it('place(): sits on top of the HUD chip over the load, HUD-sized, and never under a HUD zone', () => {
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 400);
    cam.position.set(0, 17, 12);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const s = new LabelScreen();
    s.setViewport(1280, 720);
    const label = new BeatLabel('t');
    label.set('막아야 해!', 'theirs');
    // a safe in the middle: tail tip = chip top - gap, centred on the load
    const chip = { w: 11, h: 3.2 };
    label.place(0, 2, 0, cam, 1, 0, s, chip);
    const a = new THREE.Vector3(0, 2, 0).project(cam);
    const ay = ((1 - a.y) / 2) * 720;
    const ax = ((a.x + 1) / 2) * 1280;
    expect(label.lastCover).toBe(0);
    expect((label.rect.x0 + label.rect.x1) / 2).toBeCloseTo(ax, 3);
    expect(Math.abs(label.rect.y1 - (ay - (chip.h + BEATS.label.gapRem) * s.rem))).toBeLessThan(1.5);
    // sprite projects to the same bottom-centre (sizeAttenuation off: constant pixels)
    const p = label.sprite.position.clone().project(cam);
    expect(((1 - p.y) / 2) * 720).toBeCloseTo(label.rect.y1, 2);
    const px = (label.sprite.scale.y / (2 * Math.tan(((38 * Math.PI) / 180) / 2))) * 720;
    expect(px).toBeCloseTo(BEATS.label.rem * s.rem, 1);
    expect(labelScaleFor(BEATS.label.rem * s.rem, 38, 720)).toBeCloseTo(label.sprite.scale.y, 6);
    // a bank far up-screen (its 7 rem chip right under the top cluster): clear of chip + zones
    for (const z of [-14, -18, -22, -30]) {
      const lab = new BeatLabel('b');
      lab.set('승부 포인트!', 'ours');
      lab.place(0, 6, z, cam, 1, 0, s, { w: 17.5, h: 7 });
      expect(lab.lastCover).toBe(0);
      s.zones.forEach((zone, i) => s.zoneWeight[i]! >= 1 && expect(cover((lab.rect.x0 + lab.rect.x1) / 2, lab.rect.y1, lab.rect.x1 - lab.rect.x0, lab.rect.y1 - lab.rect.y0, zone)).toBe(0));
      lab.dispose();
    }
    // far right / off-screen: whole plate inside the gutter
    label.place(60, 2, 20, cam, 1, 0, s, chip);
    expect(label.rect.x1).toBeLessThanOrEqual(1280 - 16 + 1e-6);
    expect(label.rect.y1).toBeLessThanOrEqual(720 - 16 + 1e-6);
    expect(label.lastCover).toBe(0);
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
    const screen = new LabelScreen();
    const chip = { w: 17.5, h: 7 };
    const bark = new BarkBubble();
    root.add(ring.root, wind.mesh, label.sprite, bark.sprite);
    label.set('이게 들어가면 끝!', 'ours');
    bark.show('내 은행!!', 5);
    const frame = (i: number): void => {
      ring.update(true, i * 0.01, 0, 0, 1.4, 1 / 60, 1.2, false);
      wind.update(i / 60, 0, 0, 0, 1 / 60, false);
      label.place(i * 0.01, 2, 0, cam, 1 / 60, 0.5, screen, chip);
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

describe('beat CPU budget', () => {
  it('every beat active at once costs far below the 1 ms frame budget', () => {
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 400);
    cam.position.set(0, 17, 12);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const rings = [new PulseRing('a'), new PulseRing('b'), new PulseRing('c')];
    const labels = [new BeatLabel('a'), new BeatLabel('b')];
    const screen = new LabelScreen();
    const chip = { w: 17.5, h: 7 };
    labels[0]!.set('막아야 해!', 'theirs');
    labels[1]!.set('빼내기 +300', 'steal');
    const winds = [new WindupRing(), new WindupRing(), new WindupRing()];
    const bark = new BarkBubble();
    bark.show('내 은행!!', 6);
    const g = new GlanceTracker();
    const out = { x: 0, y: 0 };
    const frame = (i: number): void => {
      const dt = 1 / 60;
      rings.forEach((r, k) => r.update(true, i * 0.001 + k, 0, k, 1 + k, dt, 1.5, false));
      // worst case: a bank chip right under the top cluster -> the full two-step search
      labels[0]!.place(i * 0.001, 6, -22, cam, dt, 0.5, screen, chip);
      screen.clearExtras();
      const r = labels[0]!.rect;
      screen.addExtra(r.x0, r.y0, r.x1, r.y1);
      labels[1]!.place(3, 2.5, 3, cam, dt, 0.5, screen, null);
      for (const w of winds) w.update(i / 60, 0, 0, 0, dt, false);
      bark.update(0, 2, 0, 0.0001, false);
      if (!g.active) g.begin({ x: 20, y: 0 }, 0.3, 900, i / 60);
      g.apply(i / 60, 0, 0, out);
      departParam(getawayDepart((i % 144) / 60, 3.6));
    };
    for (let i = 0; i < 2000; i++) frame(i);
    const N = 20000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) frame(i);
    const us = ((performance.now() - t0) / N) * 1000;
    console.log(`[F3] beat CPU per frame, all beats active: ${us.toFixed(2)} us`);
    expect(us).toBeLessThan(250);
  });
});
