/**
 * Procedural model factories for 뿌리째 털어라 (render/models).
 *
 * Conventions shared by every factory:
 *  - Sim (x, y) maps to world (x, 0, y). An object with sim angle `a` gets rotation.y = -a.
 *    Local +X = sim local x, local +Z = sim local y. Characters and vans face local +X.
 *    Use placeOnSim() to apply both.
 *  - Dynamic rigs (raccoon, safe, bank, van, zone, fence) own a `root` the view transforms
 *    (zones/fences are pre-placed from their defs), expose update(dt) for internal animation,
 *    setHighlight(color | null) for the grab outline, and dispose().
 *  - Geometry and materials are cached and shared; dispose() only frees per-instance data.
 *    disposeModelCaches() frees everything (full renderer teardown).
 *  - Call setModelTime(seconds) once per frame (wind sway, water) and
 *    setOcclusionFocus(cameraPos, playerChestPos) so scenery never hides the player: buildings,
 *    kiosks, tall walls and trees between the camera and the player fade as a whole to a
 *    translucent ghost, anything else is cut by a soft x-ray cylinder.
 *  - Camera-facing labels (safe value coins, the bank sign) follow the render camera's
 *    orientation automatically (captured in onBeforeRender); setViewCamera() forces it.
 *  - Inside a bank, raise characters and safes by BANK_FLOOR_Y (or rig.floorY).
 */
import * as THREE from 'three';
import type { Vec2 } from '../../sim/types';
import { disposeBankCache } from './bank';
import { disposeGeometryCache } from './geometry';
import { disposeMaterialCache } from './materials';
import { disposeOcclusionCache } from './occlusion';
import { disposeOutlineCache } from './outline';
import { disposeRaccoonCache } from './raccoon';
import { disposeSafeCache } from './safes';
import { disposeTextureCache } from './textures';
import { disposeVanCache } from './van';

export { createRaccoon, idlePose, RACCOON_HEIGHT, RACCOON_LABEL_HEIGHT } from './raccoon';
export type { RaccoonRig, RaccoonPose, RaccoonExpression } from './raccoon';
export { createSafe } from './safes';
export type { SafeRig } from './safes';
export { createBank, createBankScar, BANK_FLOOR_Y, BANK_LABEL_HEIGHT } from './bank';
export type { BankRig } from './bank';
export { createVan } from './van';
export type { VanRig } from './van';
export { createZoneMarker } from './zone';
export type { ZoneMarkerRig } from './zone';
export { createFence } from './fence';
export type { FenceRig } from './fence';
export {
  buildStaticScenery,
  StaticScenery,
  createGround,
  createStaticBox,
  createStaticCircle,
  createDecor,
  defaultSignResolver,
  detectSignLanguage,
} from './environment';
export type { SignResolver, SceneryStats, SceneryOptions } from './environment';
export type { SignLanguage } from './palette';
export { FxSystem, DebrisBurst } from './fx';
export type { FxOptions, DebrisPieceSpec, Vec3Like } from './fx';
export { Highlighter, OUTLINE_THICKNESS } from './outline';
export type { OutlineOptions } from './outline';
export { createDuskLighting } from './lighting';
export type { DuskLighting } from './lighting';
export {
  setModelTime,
  setOcclusionFocus,
  setRimLight,
  setMaterialOpacity,
  setGhostAlpha,
  createToonMaterial,
  SHARED_UNIFORMS,
} from './materials';
export { setViewCamera, viewCameraPosition, cameraFacingYaw } from './occlusion';
export { preloadModelFonts, loadJua, FONT_STACK } from './textures';
export { PAL, HIGHLIGHT_COLORS } from './palette';

/** Place an object at a sim position/angle (y = height above the ground). */
export function placeOnSim(obj: THREE.Object3D, pos: Vec2, angle: number, y = 0): void {
  obj.position.set(pos.x, y, pos.y);
  obj.rotation.set(0, -angle, 0);
}

/** Free every cached geometry, material and texture (call only on full teardown). */
export function disposeModelCaches(): void {
  disposeRaccoonCache();
  disposeSafeCache();
  disposeBankCache();
  disposeVanCache();
  disposeOutlineCache();
  disposeGeometryCache();
  disposeMaterialCache();
  disposeTextureCache();
  disposeOcclusionCache();
}
