/**
 * Game camera (doc §4 "카메라는 높은 사선 시점에서 플레이어와 근처 목표를 보여준다. 수동 카메라
 * 회전은 기본 조작에 넣지 않는다").
 *
 * - Fixed yaw in 'match': the camera always sits south of its target (+z) looking north, so
 *   screen-up is sim -y and input mapping never changes. Only position and distance move.
 *   ('results' / 'title' may aim the shot with CameraGoal.yaw; mode switches snap.)
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
import { damp, lerpAngle, wrapAngle } from './sync';

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
  /** Clamp the target to the arena (with overscan). Only meaningful with the default yaw. */
  clamp: boolean;
  /** Extra meters the clamp may show past the arena edges (brief attention glances). */
  overscan?: number;
  /**
   * Ground direction the camera looks along (sim radians, atan2(dy, dx)). Default -PI/2 =
   * north (screen-up = sim -y). 'match' never sets it, so the match view never rotates;
   * 'results' / 'title' may aim the shot (e.g. across the zone at the winners' van).
   */
  yaw?: number;
}

/** Default camera yaw: looking north (sim -y). */
export const NORTH_YAW = -Math.PI / 2;

export const MATCH_PITCH = 55;
export const MATCH_FOV = 38;
/** Base follow distances (m) for the match camera. */
export const MATCH_DIST = {
  walk: 21,
  smallSafe: 20,
  largeSafe: 22,
  nearBank: 24,
  /** Hauling a bank: wide enough for the 8 x 6 m building + its surroundings, close enough
   *  that the hauler still reads as a raccoon (~32 px tall at 720p) next to it. */
  hauling: 25,
} as const;

const DEG = Math.PI / 180;

export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector2();
  private distance: number = MATCH_DIST.walk;
  private pitch = MATCH_PITCH;
  private fov = MATCH_FOV;
  private yaw = NORTH_YAW;
  private snapNext = true;
  private trauma = 0;
  private readonly punchOff = { x: 0, y: 0 };
  private readonly punchVel = { x: 0, y: 0 };
  private zoomOff = 0;
  private zoomVel = 0;
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

  /**
   * Camera punch (docs/ART_DIRECTION.md §2 "카메라 펀치"): a short push along a ground
   * direction (sim) that springs back with a little overshoot. Strength ~0.2..1 (meters-ish).
   */
  punch(dir: Vec2, strength: number): void {
    const l = Math.hypot(dir.x, dir.y);
    if (l < 1e-6 || strength <= 0) return;
    this.punchVel.x += (dir.x / l) * strength * 9;
    this.punchVel.y += (dir.y / l) * strength * 9;
  }

  /** Brief zoom-in (fraction of the distance, e.g. 0.1) that eases back — big recoveries. */
  zoomPunch(amount: number): void {
    this.zoomVel -= Math.max(0, amount) * 9;
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

  /** Current smoothed yaw (sim radians; NORTH_YAW in 'match'). */
  get currentYaw(): number {
    return this.yaw;
  }

  update(dt: number, goal: CameraGoal, opts: { screenShake: number; reducedMotion: boolean }): void {
    this.time += dt;
    let tx = goal.target.x;
    let ty = goal.target.y;
    if (goal.clamp) {
      const c = this.clampTarget(tx, ty, goal.distance, goal.pitch, goal.fov, goal.overscan ?? 0);
      tx = c.x;
      ty = c.y;
    }
    if (this.snapNext) {
      this.target.set(tx, ty);
      this.distance = goal.distance;
      this.pitch = goal.pitch;
      this.fov = goal.fov;
      this.yaw = goal.yaw ?? NORTH_YAW;
      this.snapNext = false;
    } else {
      const k = damp(goal.followRate, dt);
      this.target.x += (tx - this.target.x) * k;
      this.target.y += (ty - this.target.y) * k;
      const kz = damp(Math.min(goal.followRate, 2.2), dt);
      this.distance += (goal.distance - this.distance) * kz;
      this.pitch += (goal.pitch - this.pitch) * kz;
      this.fov += (goal.fov - this.fov) * kz;
      const gy = goal.yaw ?? NORTH_YAW;
      this.yaw = Math.abs(wrapAngle(gy - this.yaw)) < 1e-4 ? gy : lerpAngle(this.yaw, gy, kz);
    }
    // Keep the smoothed target inside the clamp too (zoom changes move the limits).
    if (goal.clamp) {
      const c = this.clampTarget(this.target.x, this.target.y, this.distance, this.pitch, this.fov, goal.overscan ?? 0);
      this.target.set(c.x, c.y);
    }

    // Punch springs (underdamped: push, overshoot a touch, settle). Off with reduced motion.
    const punchScale = opts.reducedMotion ? 0 : Math.min(1, Math.max(0, opts.screenShake));
    if (dt > 0) {
      const K = 170;
      const C = 15;
      // Semi-implicit Euler on these stiff springs is only stable for h below ~0.088 s, and
      // frameDt can be up to 0.1 s (slow machines, ?render=N): integrate in small sub-steps.
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.punchVel.x += (-K * this.punchOff.x - C * this.punchVel.x) * h;
        this.punchVel.y += (-K * this.punchOff.y - C * this.punchVel.y) * h;
        this.punchOff.x += this.punchVel.x * h;
        this.punchOff.y += this.punchVel.y * h;
        this.zoomVel += (-120 * this.zoomOff - 13 * this.zoomVel) * h;
        this.zoomOff += this.zoomVel * h;
      }
    }
    if (punchScale === 0) {
      this.punchOff.x = this.punchOff.y = this.punchVel.x = this.punchVel.y = 0;
      this.zoomOff = this.zoomVel = 0;
    }
    const px = this.punchOff.x * punchScale;
    const py = this.punchOff.y * punchScale;
    const dist = this.distance * (1 + THREE.MathUtils.clamp(this.zoomOff * punchScale, -0.25, 0.25));

    const p = this.pitch * DEG;
    const fx = Math.cos(this.yaw);
    const fy = Math.sin(this.yaw);
    this.focusPoint.set(this.target.x, 0, this.target.y);
    this.basePosition.set(this.target.x + px - fx * Math.cos(p) * dist, Math.sin(p) * dist, this.target.y + py - fy * Math.cos(p) * dist);

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
    this.lookAt.set(this.focusPoint.x + px + sx, sy, this.focusPoint.z + py + sz);
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
  }

  /**
   * Keep the visible ground footprint mostly inside the arena: a few meters of the street /
   * backdrop may show (they are dressed), never a void. If the arena is smaller than the view
   * along an axis, the target centers on it.
   */
  private clampTarget(x: number, y: number, dist: number, pitchDeg: number, fovDeg: number, extra = 0): Vec2 {
    const p = pitchDeg * DEG;
    const vf = fovDeg * DEG;
    const h = Math.sin(p) * dist;
    const back = Math.cos(p) * dist;
    const hw = dist * Math.tan(vf / 2) * this.camera.aspect;
    const topDep = Math.max(0.12, p - vf / 2);
    const botDep = Math.min(Math.PI / 2 - 0.01, p + vf / 2);
    const north = h / Math.tan(topDep) - back; // visible meters north of the target
    const south = back - h / Math.tan(botDep); // visible meters south of the target
    const overX = 6 + extra;
    const overN = 9 + extra;
    const overS = 6 + extra;
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
