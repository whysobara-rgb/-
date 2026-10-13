/**
 * Recommended dusk lighting for the toon materials (used by the model gallery and offered
 * to the view). Warm low sun from the south-west with soft shadows, lavender sky fill,
 * a faint cool front fill so faces toward the camera stay readable, and pink haze fog.
 *
 * Not camera code: the view owns the camera; it only calls setFocus() so the shadow
 * frustum follows the action.
 */
import * as THREE from 'three';
import { PAL } from './palette';

export interface DuskLighting {
  readonly group: THREE.Group;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  /** Recommended fog (assign to scene.fog) and clear color. */
  readonly fog: THREE.Fog;
  readonly background: THREE.Color;
  /** Move the shadow frustum to follow a world point (call each frame or on big moves). */
  setFocus(p: THREE.Vector3): void;
  /** 'low' | 'medium' | 'high' shadow quality. */
  setQuality(q: 'low' | 'medium' | 'high'): void;
  dispose(): void;
}

/** Offset of the sun from its target: low warm sun from the south-west (behind-left of the camera). */
const SUN_OFFSET = new THREE.Vector3(-22, 30, 16);

export function createDuskLighting(o: { shadowRadius?: number; quality?: 'low' | 'medium' | 'high' } = {}): DuskLighting {
  const group = new THREE.Group();
  group.name = 'duskLighting';
  // Dusk contrast: a cooler, dimmer sky fill so shade reads lavender and the low warm sun
  // carves the toy shapes (lamp pools and lit windows then glow through the bloom pass).
  const hemi = new THREE.HemisphereLight('#AEB4F2', '#D4B4AE', 1.7);
  group.add(hemi);

  const sun = new THREE.DirectionalLight('#FFC99A', 3.15);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  const r = o.shadowRadius ?? 26;
  const cam = sun.shadow.camera;
  cam.left = -r;
  cam.right = r;
  cam.top = r;
  cam.bottom = -r;
  cam.near = 1;
  cam.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  group.add(sun);
  group.add(sun.target);

  const fill = new THREE.DirectionalLight('#C2C8FF', 0.42);
  fill.position.set(4, 14, 30);
  group.add(fill);
  group.add(fill.target);

  const fog = new THREE.Fog(PAL.fog, 70, 170);
  const background = new THREE.Color(PAL.fog);

  const setQuality = (q: 'low' | 'medium' | 'high'): void => {
    const size = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  };
  setQuality(o.quality ?? 'medium');

  // Snap the shadow camera to texel increments to avoid shimmering while following.
  const snap = new THREE.Vector3();
  const setFocus = (p: THREE.Vector3): void => {
    const texel = (2 * r) / sun.shadow.mapSize.x;
    snap.set(Math.round(p.x / texel) * texel, 0, Math.round(p.z / texel) * texel);
    sun.target.position.copy(snap);
    sun.position.copy(snap).add(SUN_OFFSET);
    fill.target.position.copy(snap);
    fill.position.copy(snap).add(new THREE.Vector3(4, 14, 30));
  };
  setFocus(new THREE.Vector3());

  return {
    group,
    sun,
    hemi,
    fill,
    fog,
    background,
    setFocus,
    setQuality,
    dispose() {
      sun.shadow.map?.dispose();
      group.removeFromParent();
    },
  };
}
