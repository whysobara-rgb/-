/**
 * Game camera (doc §4 "카메라는 높은 사선 시점에서 플레이어와 근처 목표를 보여준다. 수동 카메라
 * 회전은 기본 조작에 넣지 않는다").
 *
 * - Fixed yaw: the camera always sits south of its target (+z) looking north, so screen-up is
 *   sim -y in every mode and input mapping never changes. Only position, distance and (outside
 *   'match') pitch move.
 * - 'match': high oblique (pitch 55°) smooth follow with a little look-ahead; distance frames
 *   the carried object and nearby targets (out when hauling / near a bank, in for small loot);
 *   the target is clamped so the view never drifts far outside the arena.
 * - 'preview': whole-layout overview, gentle drift. 'title': slow attract pan over the plaza.
 *   'results': low close shot of the staged winners (and the slumped loser) at a van.
 * - Shake: translational trauma shake scaled by settings.screenShake, disabled entirely by
 *   reducedMotion (so is drift / panning).
 */
import * as THREE from 'three';
import type { Vec2 } from '../sim';
import { damp } from './sync';

export type ViewMode = 'match' | 'preview' | 'results' | 'title';

/** Where the camera wants to be this frame (before smoothing, clamping and shake). */
export interface CameraGoal {
  /** Look-at point on the ground (sim coordinates). */
  target: Vec2;
  /** Distance from the target along the view direction (m). */
  distance: number;
  /** Pitch below the horizon (degrees). */
  pitch: number;
  /** Vertical field of view (degrees). */
  fov: number;
  /** Follow stiffness (1/s); higher = snappier. */
  followRate: number;
  /** Clamp the target to the arena (with overscan). */
  clamp: boolean;
}

export const MATCH_PITCH = 55;
export const MATCH_FOV = 38;
/** Base follow distances (m) for the match camera. */
export const MATCH_DIST = {
  walk: 21,
  smallSafe: 20,
  largeSafe: 22,
  nearBank: 26,
  hauling: 29,
} as const;

const DEG = Math.PI / 180;

export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector2();
  private distance: number = MATCH_DIST.walk;
  private pitch = MATCH_PITCH;
  private fov = MATCH_FOV;
  private snapNext = true;
  private trauma = 0;
  private time = 0;
  private bounds = { x: 80, y: 52 };
  private readonly lookAt = new THREE.Vector3();
  /** Unshaken look-at point (world) — used for shadow focus and occlusion. */
  readonly focusPoint = new THREE.Vector3();
  /** Unshaken camera position (world). */
  readonly basePosition = new THREE.Vector3();

  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(MATCH_FOV, aspect, 0.5, 420);
    this.camera.name = 'gameCamera';
  }

  setArena(size: Vec2): void {
    this.bounds = { x: size.x, y: size.y };
  }

  setAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the next goal (mode changes, loads, teleports of the focus). */
  snap(): void {
    this.snapNext = true;
  }

  /** Add shake trauma (0..1, accumulates, capped at 1). */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
  }

  get shakeTrauma(): number {
    return this.trauma;
  }

  /** Current smoothed target (sim). */
  get currentTarget(): Vec2 {
    return { x: this.target.x, y: this.target.y };
  }

  get currentDistance(): number {
    return this.distance;
  }

  update(dt: number, goal: CameraGoal, opts: { screenShake: number; reducedMotion: boolean }): void {
    this.time += dt;
    let tx = goal.target.x;
    let ty = goal.target.y;
    if (goal.clamp) {
      const c = this.clampTarget(tx, ty, goal.distance, goal.pitch, goal.fov);
      tx = c.x;
      ty = c.y;
    }
    if (this.snapNext) {
      this.target.set(tx, ty);
      this.distance = goal.distance;
      this.pitch = goal.pitch;
      this.fov = goal.fov;
      this.snapNext = false;
    } else {
      const k = damp(goal.followRate, dt);
      this.target.x += (tx - this.target.x) * k;
      this.target.y += (ty - this.target.y) * k;
      const kz = damp(Math.min(goal.followRate, 2.2), dt);
      this.distance += (goal.distance - this.distance) * kz;
      this.pitch += (goal.pitch - this.pitch) * kz;
      this.fov += (goal.fov - this.fov) * kz;
    }
    // Keep the smoothed target inside the clamp too (zoom changes move the limits).
    if (goal.clamp) {
      const c = this.clampTarget(this.target.x, this.target.y, this.distance, this.pitch, this.fov);
      this.target.set(c.x, c.y);
    }

    const p = this.pitch * DEG;
    this.focusPoint.set(this.target.x, 0, this.target.y);
    this.basePosition.set(this.target.x, Math.sin(p) * this.distance, this.target.y + Math.cos(p) * this.distance);

    // Translational trauma shake (never rotates the view).
    let sx = 0;
    let sy = 0;
    let sz = 0;
    if (!opts.reducedMotion && opts.screenShake > 0 && this.trauma > 0) {
      const amp = this.trauma * this.trauma * 0.55 * Math.min(1, opts.screenShake);
      const t = this.time;
      sx = (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 83.1 + 1.3) * 0.4) * amp;
      sy = (Math.sin(t * 59.7 + 2.1) * 0.6 + Math.sin(t * 97.9 + 0.4) * 0.4) * amp * 0.6;
      sz = (Math.sin(t * 53.9 + 4.2) * 0.6 + Math.sin(t * 71.3 + 2.7) * 0.4) * amp;
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    if (opts.reducedMotion) this.trauma = 0;

    if (this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(this.basePosition.x + sx, this.basePosition.y + sy, this.basePosition.z + sz);
    this.lookAt.set(this.focusPoint.x + sx, sy, this.focusPoint.z + sz);
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
  }

  /**
   * Keep the visible ground footprint mostly inside the arena: a few meters of the street /
   * backdrop may show (they are dressed), never a void. If the arena is smaller than the view
   * along an axis, the target centers on it.
   */
  private clampTarget(x: number, y: number, dist: number, pitchDeg: number, fovDeg: number): Vec2 {
    const p = pitchDeg * DEG;
    const vf = fovDeg * DEG;
    const h = Math.sin(p) * dist;
    const back = Math.cos(p) * dist;
    const hw = dist * Math.tan(vf / 2) * this.camera.aspect;
    const topDep = Math.max(0.12, p - vf / 2);
    const botDep = Math.min(Math.PI / 2 - 0.01, p + vf / 2);
    const north = h / Math.tan(topDep) - back; // visible meters north of the target
    const south = back - h / Math.tan(botDep); // visible meters south of the target
    const overX = 6;
    const overN = 9;
    const overS = 6;
    const W = this.bounds.x;
    const H = this.bounds.y;
    const minX = hw * 0.85 - overX;
    const maxX = W - hw * 0.85 + overX;
    const minY = north - overN;
    const maxY = H - south + overS;
    return {
      x: minX > maxX ? W / 2 : Math.min(maxX, Math.max(minX, x)),
      y: minY > maxY ? (minY + maxY) / 2 : Math.min(maxY, Math.max(minY, y)),
    };
  }
}

/** Distance at which a (w x d) ground rectangle fits the view at the given pitch / fov. */
export function fitDistance(w: number, d: number, pitchDeg: number, fovDeg: number, aspect: number): number {
  const vf = fovDeg * DEG;
  const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
  const byW = w / 2 / Math.tan(hf / 2);
  // Ground depth seen ≈ projected height / sin(pitch).
  const byD = (d * Math.sin(pitchDeg * DEG)) / 2 / Math.tan(vf / 2);
  return Math.max(byW, byD);
}
