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

declare global {
  interface Window {
    __models?: { ready: boolean; render(spec: ShotSpec): string };
  }
}

window.__models = { ready: false, render };
void preloadModelFonts()
  .catch(() => false)
  .then(() => {
    window.__models!.ready = true;
  });
