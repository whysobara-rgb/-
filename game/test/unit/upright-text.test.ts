/**
 * Orientation policy (owner bug "임팩트 텍스트나 말머리표가 기울어져 보인다"): every piece of text
 * and every speech bubble rests exactly upright and never rotates; the punch is scale /
 * squash-and-stretch / translation. Decorative side stickers (dizzy swirl, sparkle) may spin.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { UprootBanners, drawBanner } from '../../src/render/banner';
import { StampPool, STAMP_TEXT, drawStamp, type StampKey } from '../../src/render/effects';
import { EmoteSystem } from '../../src/render/emotes';
import { EMOTE_ATLAS, EMOTE_BUBBLED, EMOTE_CELLS, type EmoteKind } from '../../src/render/models/art';
import { cameraSideOf, emoteSlotRotation, lootTwinPlacements, mirrorTwinYaw, mirrorTwinYawById, slamDrop, slamSquash, TEXT_ROTATION } from '../../src/render/upright';
import { createBank, placeOnSim } from '../../src/render/models';
import { createBreakableRig } from '../../src/render/models/props';
import { LAYOUTS } from '../../src/sim/layouts';
import { SLAM_KEYFRAMES } from '../../src/ui/core/juice';

/** Minimal 2D context that records every call (enough for the stamp / banner painters). */
function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 40 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (..._a: unknown[]) => {
        calls.push(k);
      };
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('upright helpers', () => {
  it('text rotation is 0 and bubbles never take a rotation', () => {
    expect(TEXT_ROTATION).toBe(0);
    for (const r of [-1, -0.25, 0.3, 5]) {
      expect(emoteSlotRotation(true, r)).toBe(0);
      expect(emoteSlotRotation(false, r)).toBe(r);
    }
  });

  it('slam squash stretches on the way in, squashes on impact, then settles', () => {
    expect(slamSquash(-0.1, 0.12)).toBe(0);
    expect(slamSquash(0.06, 0.12)).toBeLessThan(0); // tall stretch while flying in
    expect(slamSquash(0.12, 0.12)).toBeGreaterThan(0.1); // wide squash on landing
    expect(Math.abs(slamSquash(0.7, 0.12))).toBeLessThan(0.001);
    expect(slamDrop(0, 0.12, 1)).toBeCloseTo(1);
    expect(slamDrop(0.12, 0.12, 1)).toBe(0);
  });
});

describe('3D impact stamps / banners stay upright', () => {
  it('stamp and banner textures draw level lettering (no ctx.rotate)', () => {
    for (const key of Object.keys(STAMP_TEXT.ko) as StampKey[]) {
      const { ctx, calls } = recordingCtx();
      drawStamp(ctx, 512, 256, key, STAMP_TEXT.ko[key]);
      expect(calls).toContain('fillText');
      expect(calls, key).not.toContain('rotate');
    }
    const { ctx, calls } = recordingCtx();
    drawBanner(ctx, 512, 256, '뽑았다!');
    expect(calls).toContain('fillText');
    expect(calls).not.toContain('rotate');
  });

  it('stamp sprites never rotate but still squash and drop', () => {
    const pool = new StampPool(3);
    pool.show('jackpot', 0, 2, 0);
    pool.show('homeRun', 3, 2, 0);
    const sprites = pool.root.children as THREE.Sprite[];
    let squashed = false;
    let dropped = false;
    for (let i = 0; i < 60; i++) {
      pool.update(1 / 60);
      for (const s of sprites) {
        if (!s.visible) continue;
        expect((s.material as THREE.SpriteMaterial).rotation).toBe(0);
        if (Math.abs(s.scale.x / s.scale.y - 2) > 0.05) squashed = true; // aspect 0.5 at rest
        if (s.position.y > 2.01 && i < 6) dropped = true;
      }
    }
    expect(squashed).toBe(true);
    expect(dropped).toBe(true);
  });

  it('uproot banner sprites never rotate', () => {
    const b = new UprootBanners();
    b.show(0, 3, 0, 'bank', 'ko');
    for (let i = 0; i < 80; i++) {
      b.update(1 / 60);
      for (const s of b.root.children as THREE.Sprite[]) expect((s.material as THREE.SpriteMaterial).rotation).toBe(0);
    }
  });
});

describe('emote bubbles stay upright', () => {
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  camera.position.set(0, 20, 14);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  it('bubbled kinds (note / whistle / stop / !) never rotate; side stickers may spin', () => {
    const em = new EmoteSystem(8);
    const heads = new Map<number, THREE.Vector3>();
    const kinds: EmoteKind[] = ['note', 'whistle', 'stop', 'exclaim', 'dizzy'];
    kinds.forEach((k, i) => {
      heads.set(i, new THREE.Vector3(i * 6, 1.4, 0));
      em.show(i, k, { loop: true });
    });
    const anchor = (o: number, out: THREE.Vector3): boolean => {
      const p = heads.get(o);
      if (!p) return false;
      out.copy(p);
      return true;
    };
    const bubbleCells = new Set([...EMOTE_BUBBLED].map((k) => EMOTE_CELLS[k]));
    let sideSpun = false;
    for (let f = 0; f < 90; f++) {
      em.update(1 / 30, camera, anchor);
      const d = (em as unknown as { data: THREE.InstancedBufferAttribute }).data;
      for (let i = 0; i < em.activeCount; i++) {
        if (bubbleCells.has(d.getX(i))) expect(d.getY(i)).toBe(0);
        else if (d.getY(i) !== 0) sideSpun = true;
      }
    }
    expect(sideSpun).toBe(true); // dizzy swirl keeps its decorative spin
  });

  it('clustered bubbles sit right of their own speaker (their down-left tails point at them)', () => {
    const em = new EmoteSystem(8);
    const heads = new Map<number, THREE.Vector3>([
      [1, new THREE.Vector3(0, 1.4, 0)],
      [2, new THREE.Vector3(0.1, 1.4, 0.05)],
      [3, new THREE.Vector3(-0.3, 1.4, 0.1)],
    ]);
    for (const id of heads.keys()) em.show(id, 'exclaim', { loop: true });
    const anchor = (o: number, out: THREE.Vector3): boolean => {
      const p = heads.get(o);
      if (!p) return false;
      out.copy(p);
      return true;
    };
    for (let f = 0; f < 60; f++) em.update(1 / 30, camera, anchor);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const owners = (em as unknown as { owners: Map<number, { dx: number }> }).owners;
    const xs: number[] = [];
    for (const [id, st] of owners) {
      expect(st.dx, `owner ${id}`).toBeGreaterThan(0.2);
      xs.push(heads.get(id)!.dot(right) + st.dx);
    }
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(0.8); // still fanned, no overlap
  });

  it('screen-edge markers use a tail-less badge cell', () => {
    expect(EMOTE_BUBBLED.has('alert')).toBe(false);
    const cells = Object.values(EMOTE_CELLS);
    expect(new Set(cells).size).toBe(cells.length);
    expect(EMOTE_CELLS.alert).toBeLessThan(EMOTE_ATLAS.cols * EMOTE_ATLAS.rows);
    const police = fs.readFileSync(path.resolve(__dirname, '../../src/render/police.ts'), 'utf8');
    expect(police).not.toMatch(/icon:\s*'exclaim'/);
  });
});

describe('HUD / screen text never tilts', () => {
  const css = (f: string): string => fs.readFileSync(path.resolve(__dirname, '../../src/ui/styles', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (src: string, sel: string): string => {
    const i = src.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThanOrEqual(0);
    return src.slice(i, src.indexOf('}', i));
  };
  const keyframes = (src: string, name: string): string => {
    const i = src.indexOf(`@keyframes ${name}`);
    expect(i, name).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let j = src.indexOf('{', i); j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
    }
    return src.slice(i);
  };

  it('slamIn keyframes are rotation-free and end at rest', () => {
    for (const k of SLAM_KEYFRAMES) expect(String(k.transform ?? '')).not.toMatch(/rotate/);
    expect(SLAM_KEYFRAMES[SLAM_KEYFRAMES.length - 1]!.transform).toBe('none');
  });

  it('stamps, chunky words, panels and bubbles carry no resting rotation', () => {
    const c = css('components.css');
    for (const sel of ['.uh-stamp', '.uh-panel', '.uh-btn', '.uh-bubble', '.uh-toast']) expect(rule(c, sel), sel).not.toMatch(/(^|[;\s])rotate\s*:/);
    expect(rule(c, '.uh-chunky__ch')).not.toMatch(/rotate/);
    for (const k of ['uh-wobble', 'uh-sticker-in', 'uh-toast-in', 'uh-toast-out']) expect(keyframes(c, k), k).not.toMatch(/rotate/);
  });

  it('HUD text animations pulse / jitter instead of rocking', () => {
    const hud = css('hud.css');
    for (const k of ['uh-timer-wobble', 'uh-warn', 'uh-pop-world']) expect(keyframes(hud, k), k).not.toMatch(/rotate/);
    for (const sel of ['.uh-banner', '.uh-carry', '.uh-police', '.uh-practice', '.uh-tut']) expect(rule(hud, sel), sel).not.toMatch(/(^|[;\s])rotate\s*:/);
    const tension = css('hud-tension.css');
    for (const k of ['uh-mp-ours', 'uh-mp-theirs']) expect(keyframes(tension, k), k).not.toMatch(/rotate/);
  });

  it('HUD callouts / results / tournament stamps no longer pass a tilt to slamIn', () => {
    const src = (f: string): string => fs.readFileSync(path.resolve(__dirname, '../../src/ui', f), 'utf8');
    for (const f of ['hud/Effects.ts', 'screens/ResultsScreen.ts', 'screens/TournamentScreen.ts', 'screens/SeriesIntermission.ts']) {
      for (const m of src(f).matchAll(/slamIn\(([^)]*)\)/g)) expect(m[1]!.split(',').length, `${f}: ${m[0]}`).toBeLessThanOrEqual(2);
    }
  });

  it('the logotype stands upright and no rule reads a --tilt rotation', () => {
    const s = css('screens.css');
    for (const sel of ['.uh-logo__line--a', '.uh-logo__line--b', '.uh-logo__char', '.uh-logo--compact .uh-logo__line--b']) expect(rule(s, sel), sel).not.toMatch(/(^|[;\s])rotate\s*:/);
    const title = fs.readFileSync(path.resolve(__dirname, '../../src/ui/screens/TitleScreen.ts'), 'utf8');
    expect(title).not.toMatch(/--tilt/);
    // Every former reader of the per-element tilt is gone, so a stray --tilt value can never
    // bring a resting text tilt back.
    const dir = path.resolve(__dirname, '../../src/ui/styles');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.css'))) expect(css(f), f).not.toMatch(/var\(--tilt/);
  });
});

describe('in-world lettering faces the camera the right way round', () => {
  // Rendered front of a +z-front model placed with placeOnSim at sim angle a: (-sin a, cos a).
  const front = (a: number): { x: number; z: number } => ({ x: -Math.sin(a), z: Math.cos(a) });

  it('east mirror twins turn their door / screen / sign to mirror their west original', () => {
    let pairs = 0;
    for (const L of Object.values(LAYOUTS)) {
      const axis = L.size.x / 2;
      const spots = lootTwinPlacements(L);
      const loot = [...L.safes.map((s) => ({ ...s.pos, key: s.kind, a: s.angle })), ...(L.v2?.safes ?? []).map((s) => ({ ...s.pos, key: s.kind, a: s.angle })), ...(L.v2?.props ?? []).map((p) => ({ ...p.pos, key: p.variant, a: p.angle }))];
      for (const e of loot) {
        const fix = mirrorTwinYaw(spots, e, axis);
        const w = loot.find((o) => o.key === e.key && Math.abs(o.y - e.y) < 1e-3 && Math.abs(o.x - (2 * axis - e.x)) < 1e-3 && o.x < axis);
        if (e.x <= axis + 1e-3 || !w) {
          expect(fix, `${L.id} ${e.key}@${e.x},${e.y}`).toBe(0);
          continue;
        }
        pairs++;
        const fe = front(e.a + fix);
        const fw = front(w.a + mirrorTwinYaw(spots, w, axis));
        expect(fe.x, `${L.id} ${e.key}@${e.x},${e.y}`).toBeCloseTo(-fw.x, 6);
        expect(fe.z, `${L.id} ${e.key}@${e.x},${e.y}`).toBeCloseTo(fw.z, 6);
      }
      const bs = L.v2?.breakables ?? [];
      const has = (id: string): boolean => bs.some((b) => b.id === id);
      for (const b of bs) {
        if (!b.id.endsWith('.e')) {
          expect(mirrorTwinYawById(b.id, has)).toBe(0);
          continue;
        }
        const w = bs.find((o) => o.id === `${b.id.slice(0, -2)}.w`)!;
        pairs++;
        const fe = front(b.angle + mirrorTwinYawById(b.id, has));
        const fw = front(w.angle);
        expect(fe.x, b.id).toBeCloseTo(-fw.x, 6);
        expect(fe.z, b.id).toBeCloseTo(fw.z, 6);
      }
    }
    expect(pairs).toBeGreaterThan(10);
    // A lone east entry (tutorial: no mirror) keeps its authored yaw.
    expect(mirrorTwinYaw([{ x: 30, y: 5, key: 'smallSafe' }], { x: 30, y: 5, key: 'smallSafe' }, 20)).toBe(0);
  });

  it('a vending machine facing east / west wears its brand sign on the camera-side header face', () => {
    expect(cameraSideOf(0)).toBe(0);
    expect(cameraSideOf(Math.PI)).toBe(0);
    for (const a of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
      const rig = createBreakableRig('vending', 'ko', a);
      const root = new THREE.Group();
      root.add(rig.root);
      placeOnSim(rig.root, { x: 0, y: 0 }, a);
      root.updateMatrixWorld(true);
      const sign = rig.root.children[0]!.children.find((m) => m instanceof THREE.Mesh && (m as THREE.Mesh).geometry instanceof THREE.PlaneGeometry && ((m as THREE.Mesh).geometry as THREE.PlaneGeometry).parameters.height === 0.22)!;
      expect(sign, `angle ${a}`).toBeTruthy();
      const n = new THREE.Vector3(0, 0, 1).transformDirection(sign.matrixWorld);
      const r = new THREE.Vector3(1, 0, 0).transformDirection(sign.matrixWorld);
      if (cameraSideOf(a) !== 0) {
        expect(n.z, `angle ${a}`).toBeCloseTo(1, 6); // faces the north-looking camera
        expect(r.x, `angle ${a}`).toBeCloseTo(1, 6); // reads left to right, not mirrored
      } else expect(Math.abs(n.z), `angle ${a}`).toBeCloseTo(1, 6); // front sign as authored
    }
  });

  it('the bank sign hops on the uproot pop instead of spinning, and never rolls with the body', () => {
    const rig = createBank();
    const root = new THREE.Group();
    root.add(rig.root);
    const board = rig.root.getObjectByName('bank:signBoard')!;
    expect(board).toBeTruthy();
    const wobble = board.parent!.parent!;
    rig.update(1 / 60);
    rig.setUprooted(true);
    let hopped = false;
    for (let i = 0; i < 150; i++) {
      rig.update(1 / 60);
      root.updateMatrixWorld(true);
      expect(wobble.rotation.y).toBe(0);
      const r = new THREE.Vector3(1, 0, 0).transformDirection(board.matrixWorld);
      expect(Math.abs(r.y), `frame ${i}`).toBeLessThan(0.01); // baseline stays level
      if (wobble.position.y > 0.1) hopped = true;
    }
    expect(hopped).toBe(true);
  });
});
