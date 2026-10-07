/**
 * Steam-asset model renders (tools/steam-assets/capture.mjs): the game's real procedural models
 * (createRaccoon / createBank from src/render/models, the same rigs the match and menus use),
 * posed and lit like the in-game portraits, rendered on a transparent background at any size.
 *
 *   window.__models.render({ shot: 'icon' | 'head', size }) -> PNG data URL
 */
import * as THREE from 'three';
import { createBank, createRaccoon, idlePose, preloadModelFonts, setModelTime, setOcclusionFocus, setViewCamera, type RaccoonExpression } from '../../../src/render/models';
import type { HatId } from '../../../src/sim/types';
import { TitleScene } from '../../../src/menu3d/scenes/title';
import { LabelLayer } from '../../../src/menu3d/labels';
import { skyDome } from '../../../src/menu3d/kit';

export interface ShotSpec {
  shot: 'icon' | 'head';
  size: number;
  hat?: HatId;
  expression?: RaccoonExpression;
  /** Extra yaw of the raccoon (radians). */
  yaw?: number;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

function lights(scene: THREE.Scene): void {
  // Same rig as the in-game portraits (src/menu3d/portraits.ts), a touch brighter key.
  const hemi = new THREE.HemisphereLight('#E9E4FF', '#D9B6A6', 2.0);
  const key = new THREE.DirectionalLight('#FFE2C4', 2.8);
  key.position.set(3, 4, 2.5);
  const rim = new THREE.DirectionalLight('#B9C8FF', 1.6);
  rim.position.set(-3, 2, -2);
  scene.add(hemi, key, rim);
}

function render(spec: ShotSpec): string {
  const scene = new THREE.Scene();
  lights(scene);
  const camera = new THREE.PerspectiveCamera(20, 1, 0.05, 80);
  const hat: HatId = spec.hat ?? 'nunchiMask';
  const rig = createRaccoon({ team: 0, look: { hat, furTint: 0.5 } });
  rig.setBlobShadow(false);
  scene.add(rig.root);
  const disposers: (() => void)[] = [() => rig.dispose()];
  const t = 1.3;
  setModelTime(t);
  // Face the camera three-quarters (rig faces local +X).
  rig.root.rotation.y = -Math.PI / 2 + 0.42 + (spec.yaw ?? 0);
  if (spec.shot === 'icon') {
    const pose = { ...idlePose(t), grabbing: true, expression: spec.expression ?? 'happy' };
    for (let i = 0; i < 30; i++) rig.update(1 / 60, { ...pose, time: t + i / 60 });
    // A tiny bank held up in both paws (the real bank model, toy scale).
    const bank = createBank();
    bank.setCutaway(false);
    bank.update(0.016);
    const s = 0.074;
    bank.root.scale.setScalar(s);
    const fwd = new THREE.Vector3(Math.cos(-rig.root.rotation.y), 0, Math.sin(-rig.root.rotation.y));
    bank.root.position.set(fwd.x * 0.46, 0.33, fwd.z * 0.46);
    bank.root.rotation.y = rig.root.rotation.y + Math.PI / 2 - 0.12;
    scene.add(bank.root);
    disposers.push(() => bank.dispose());
    camera.fov = 22;
    camera.position.set(0.4, 1.35, 4.2);
    camera.lookAt(0.02, 0.6, 0);
  } else {
    // Head + shoulders with air around the ears (the bust is cut by the badge edge later).
    const pose = { ...idlePose(t), expression: spec.expression ?? 'normal' };
    for (let i = 0; i < 30; i++) rig.update(1 / 60, { ...pose, time: t + i / 60 });
    camera.fov = 20;
    camera.position.set(0.3, 1.0, 3.5);
    camera.lookAt(0.02, 0.8, 0);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  setOcclusionFocus(null, null);
  setViewCamera(camera);
  renderer.setSize(spec.size, spec.size, false);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  for (const d of disposers) d();
  return url;
}

/**
 * Capsule key art (docs/STEAM_RELEASE.md: every capsule in night-sky indigo with the gold bank):
 * the REAL title diorama (TitleScene — the same bank, roots, rope, crew, van and FX the title
 * screen plays) stepped to a moment of its loop, re-lit for night with the game's own sky dome
 * (menu3d kit skyDome: toy clouds, stars, a gold burst behind the bank) and a warm key light on
 * the bank, framed by a camera of our own. The title screen itself plays at dusk.
 */
export interface KeyArtSpec {
  w: number;
  h: number;
  /** Title loop time (s): ~2.9 heave, 3.1 pop, ~4.2 bank afloat + cheer. */
  t: number;
  cam: [number, number, number];
  look: [number, number, number];
  fov: number;
  /** Lens shift (fraction of the frame) to keep the subject off-centre without turning the camera. */
  shift?: [number, number];
  hat?: HatId;
  /** Hide the FX layer (dust, coins, confetti). */
  noFx?: boolean;
  /** Transparent background (sky dome hidden). */
  alpha?: boolean;
  /** Extra bank hop (m) on top of the loop's own (the title hops ~0.3 m). */
  lift?: number;
  /** Sky burst colour / strength. */
  rays?: [string, number];
}

/** Deterministic Math.random for the scene's dust / wobble jitter (same art on every run). */
function seedRandom(seed: number): () => void {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    Math.random = orig;
  };
}

function keyArt(spec: KeyArtSpec): string {
  const restore = seedRandom(20261006);
  const labels = new LabelLayer();
  const sc = new TitleScene({ hat: spec.hat ?? 'teamCapA' });
  try {
    sc.attach({ reducedMotion: false, quality: 'high', labels });
    sc.setAspect(spec.w / spec.h);
    sc.step(0);
    const dt = 1 / 120;
    const inner = sc as unknown as { bank: { root: THREE.Object3D; readonly popAge: number; setCutaway(b: boolean): void; setLift(y: number): void; update(dt: number): void }; batcher: { remove(o: THREE.Object3D): void; sync(): void } };
    const bank = inner.bank;
    // Draw the bank as itself (not through the menu draw-call batches) so the walls-up state
    // below reaches every wall material.
    inner.batcher.remove(bank.root);
    if (spec.lift) {
      // A higher hop than the title's own (the loop and the safes inside follow it).
      const setLift = bank.setLift.bind(bank);
      const extra = spec.lift;
      // From the pop on (popAge is Infinity before it): the building springs up out of its roots.
      bank.setLift = (y: number) => setLift(y + (Number.isFinite(bank.popAge) ? extra * Math.min(1, bank.popAge * 5) : 0));
    }
    for (let lt = 0; lt + dt <= spec.t + 1e-6; lt += dt) {
      sc.step(dt);
      // The whole building, walls up (menus and matches cut the camera-side walls away).
      bank.setCutaway(false);
    }
    // --- night: the game's sky dome with indigo clouds, stars and a gold burst behind the bank
    const any = sc as unknown as { sky: THREE.Mesh; lighting: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; fill: THREE.DirectionalLight }; fx: { root: THREE.Object3D } };
    sc.scene.remove(any.sky);
    any.sky = skyDome(['#191245', '#2B1F6A', '#4C3592'], 120, { rays: spec.rays?.[0] ?? '#6656C8', rayStrength: spec.rays?.[1] ?? 0.32, rayCount: 13, rayCenterY: 0.02, clouds: '#3C2F85', cloudY: [0.08, 0.2], stars: 1 });
    (any.sky.material as THREE.ShaderMaterial).uniforms.uTime!.value = 2.2;
    any.sky.visible = !spec.alpha;
    sc.scene.add(any.sky);
    sc.scene.fog = new THREE.Fog('#2E2268', 70, 170);
    const L = any.lighting;
    L.hemi.color.set('#9C98F0');
    L.hemi.groundColor.set('#6E5A9E');
    L.hemi.intensity = 1.45;
    L.sun.color.set('#FFD58A');
    L.sun.intensity = 3.3;
    L.fill.color.set('#8FA2FF');
    L.fill.intensity = 0.9;
    if (spec.noFx) any.fx.root.visible = false;
    // --- our framing
    const cam = sc.camera;
    cam.fov = spec.fov;
    cam.aspect = spec.w / spec.h;
    cam.position.set(...spec.cam);
    cam.lookAt(new THREE.Vector3(...spec.look));
    if (spec.shift) cam.setViewOffset(spec.w, spec.h, -spec.shift[0] * spec.w, -spec.shift[1] * spec.h, spec.w, spec.h);
    cam.updateProjectionMatrix();
    sc.scene.updateMatrixWorld();
    inner.batcher.sync();
    console.log('DBG', JSON.stringify((sc as any).pullers.map((p: any) => p.holder.position.toArray().map((v: number) => +v.toFixed(2)))), JSON.stringify((sc as any).van.root.position), JSON.stringify(bank.root.position));
    setModelTime(sc.clock);
    setOcclusionFocus(null, null);
    setViewCamera(cam);
    renderer.setSize(spec.w, spec.h, false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(sc.scene, cam);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    sc.dispose();
    restore();
  }
}

declare global {
  interface Window {
    __models?: { ready: boolean; render(spec: ShotSpec): string; keyArt(spec: KeyArtSpec): string };
  }
}

window.__models = { ready: false, render, keyArt };
void preloadModelFonts()
  .catch(() => false)
  .then(() => {
    window.__models!.ready = true;
  });
