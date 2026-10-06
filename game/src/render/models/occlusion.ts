/**
 * Shared view state for the models: the occlusion focus (camera -> player) and the camera
 * position seen by the last render.
 *
 * Occlusion (types.ts: a building "fades when between camera and player"; doc §4 keeps the
 * player readable):
 *  - Cylinder x-ray: every material built with `occlusion: true` cuts the fragments inside a
 *    soft cylinder around the camera -> target segment (materials.ts shader).
 *  - Whole-object fade: merged scenery stamps a fade-group id into fx.z per building / tree;
 *    a 256 x 1 data texture holds each group's fade (0..1). Clients (StaticScenery) decide
 *    which groups occlude the focus and write their fades here every frame.
 *  - Ghosts: what the opaque pass cuts away is redrawn by a transparent "ghost" twin at low
 *    alpha, so a faded building reads as a see-through shape instead of a dotted hole.
 *
 * View camera: models that must stay readable for the fixed-but-not-always-north camera
 * (safe value coins, the bank sign) turn toward the camera position recorded here. It is
 * captured automatically from `onBeforeRender` (see trackViewCamera) and can also be set
 * explicitly with setViewCamera().
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Focus state
// ---------------------------------------------------------------------------

export interface OcclusionFocus {
  /** False when no focus is set (nothing is cut or faded). */
  active: boolean;
  camera: THREE.Vector3;
  target: THREE.Vector3;
  radius: number;
}

export const OCCLUSION_FOCUS: OcclusionFocus = {
  active: false,
  camera: new THREE.Vector3(),
  target: new THREE.Vector3(),
  radius: 0,
};

/** Something that reacts to focus changes (fades its groups, toggles its ghosts). */
export interface OcclusionClient {
  occlusionUpdate(focus: Readonly<OcclusionFocus>, dt: number): void;
}

const clients = new Set<OcclusionClient>();

export function addOcclusionClient(c: OcclusionClient): void {
  clients.add(c);
}

export function removeOcclusionClient(c: OcclusionClient): void {
  clients.delete(c);
}

let lastUpdate = -1;

/** Called by setOcclusionFocus (materials.ts) once per frame. */
export function updateOcclusionClients(): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = lastUpdate < 0 ? 1 / 60 : THREE.MathUtils.clamp((now - lastUpdate) / 1000, 0, 0.1);
  lastUpdate = now;
  for (const c of clients) c.occlusionUpdate(OCCLUSION_FOCUS, dt);
}

// ---------------------------------------------------------------------------
// Fade groups (data texture indexed by fx.z)
// ---------------------------------------------------------------------------

export const FADE_GROUPS = 256;
const fadeData = new Uint8Array(FADE_GROUPS * 4);
let fadeTex: THREE.DataTexture | null = null;
const used = new Uint8Array(FADE_GROUPS);
used[0] = 1; // group 0 = "never fades"

/** 256 x 1 texture: R = fade of group i (0..1). Shared by every occlusion material. */
export function fadeTexture(): THREE.DataTexture {
  if (!fadeTex) {
    fadeTex = new THREE.DataTexture(fadeData, FADE_GROUPS, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    fadeTex.minFilter = THREE.NearestFilter;
    fadeTex.magFilter = THREE.NearestFilter;
    fadeTex.generateMipmaps = false;
    fadeTex.colorSpace = THREE.NoColorSpace;
    fadeTex.needsUpdate = true;
  }
  return fadeTex;
}

/** Reserve a fade group id (1..255); 0 when all are taken (the object then never fades). */
export function allocFadeGroup(): number {
  for (let i = 1; i < FADE_GROUPS; i++) {
    if (!used[i]) {
      used[i] = 1;
      fadeData[i * 4] = 0;
      return i;
    }
  }
  return 0;
}

export function releaseFadeGroup(id: number): void {
  if (id <= 0 || id >= FADE_GROUPS) return;
  used[id] = 0;
  if (fadeData[id * 4] !== 0) {
    fadeData[id * 4] = 0;
    if (fadeTex) fadeTex.needsUpdate = true;
  }
}

/** Set a group's fade (0 = solid, 1 = fully ghosted). Uploads only on change. */
export function setGroupFade(id: number, fade: number): void {
  if (id <= 0 || id >= FADE_GROUPS) return;
  const v = Math.round(THREE.MathUtils.clamp(fade, 0, 1) * 255);
  if (fadeData[id * 4] === v) return;
  fadeData[id * 4] = v;
  if (fadeTex) fadeTex.needsUpdate = true;
}

/**
 * Free the fade texture's GPU copy (full teardown). The texture object stays referenced by
 * the shared uniform, so a renderer created afterwards simply uploads it again.
 */
export function disposeOcclusionCache(): void {
  fadeTex?.dispose();
  if (fadeTex) fadeTex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Segment a->b against an axis-aligned box; true when the segment passes through the box
 * for some t in [t0, t1].
 */
export function segmentHitsAABB(a: THREE.Vector3, b: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3, t0 = 0, t1 = 1): boolean {
  let lo = t0;
  let hi = t1;
  for (let k = 0; k < 3; k++) {
    const o = a.getComponent(k);
    const d = b.getComponent(k) - o;
    const mn = min.getComponent(k);
    const mx = max.getComponent(k);
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return false;
      continue;
    }
    let ta = (mn - o) / d;
    let tb = (mx - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
    if (lo > hi) return false;
  }
  return true;
}

const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

/** Does the current x-ray cylinder touch this world-space box? */
export function focusTouchesBox(box: THREE.Box3): boolean {
  const f = OCCLUSION_FOCUS;
  if (!f.active || f.radius <= 0) return false;
  _min.copy(box.min).subScalar(f.radius);
  _max.copy(box.max).addScalar(f.radius);
  return segmentHitsAABB(f.camera, f.target, _min, _max);
}

// ---------------------------------------------------------------------------
// View camera tracking
// ---------------------------------------------------------------------------

const viewCam = new THREE.Vector3(0, 30, 1e5);
/** Screen "up" projected on the ground (unit, xz); default = north (-z) for the match camera. */
const viewUp = new THREE.Vector2(0, -1);
let viewCamKnown = false;

function setUpFrom(ux: number, uz: number, fx: number, fz: number): void {
  // A pitched camera's up vector leans toward where it looks; a level camera has none, so
  // fall back to its forward direction.
  let x = ux;
  let z = uz;
  if (x * x + z * z < 0.0025) {
    x = fx;
    z = fz;
  }
  const l = Math.hypot(x, z);
  if (l > 1e-6) viewUp.set(x / l, z / l);
}

/**
 * Explicitly set the view camera (optional; it is also captured automatically from renders).
 * Pass the camera object, or null to forget it.
 */
export function setViewCamera(camera: THREE.Camera | null): void {
  if (!camera) {
    viewCamKnown = false;
    viewUp.set(0, -1);
    return;
  }
  camera.updateMatrixWorld();
  noteViewCamera(camera, true);
}

/** Last known camera world position, or null before anything was rendered. */
export function viewCameraPosition(): THREE.Vector3 | null {
  return viewCamKnown ? viewCam : null;
}

/** Record the camera of a main (perspective) render pass. Cheap; safe to call per object. */
export function noteViewCamera(camera: THREE.Camera, force = false): void {
  if (!force && !(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
  const e = camera.matrixWorld.elements;
  viewCam.set(e[12], e[13], e[14]);
  setUpFrom(e[4], e[6], -e[8], -e[10]);
  viewCamKnown = true;
}

/** Install the camera capture hook on a mesh (keeps any existing onBeforeRender). */
export function trackViewCamera(mesh: THREE.Object3D): void {
  const prev = mesh.onBeforeRender;
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    noteViewCamera(camera);
    prev.call(this, renderer, scene, camera, geometry, material, group);
  };
}

/**
 * World yaw (rotation.y) that makes camera-facing labels read upright on screen: a flat
 * label's text top (local -z) points up the screen, a standing sign's front (local +z) faces
 * the camera. Uses the camera's orientation (not its position), so labels do not swivel while
 * the fixed-yaw match camera pans. Yaw 0 for the default north-looking camera.
 */
export function cameraFacingYaw(): number {
  return Math.atan2(-viewUp.x, -viewUp.y);
}
