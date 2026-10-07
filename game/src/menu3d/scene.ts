/**
 * Base class for the live 3D menu scenes (title diorama, rooftop hideout, layout turntable,
 * rival stage, wardrobe turntable).
 *
 * Every scene owns: a THREE.Scene with the dusk lighting rig and a gradient sky, a camera
 * whose framing is authored for 16:9 and widened for narrower screens, the draw-call batcher
 * (rigs + props share multi-draw calls), the pooled FX system (dust, confetti, sparkles,
 * coins) and a soft camera shake that respects reduced motion.
 */
import * as THREE from 'three';
import { FxSystem, createDuskLighting, type DuskLighting } from '../render/models';
import { MeshBatcher } from './batcher';
import { contactShadow, contactShadowMaterial, skyDome, type SkyStyle } from './kit';
import { allowTransparentBatching } from './batcher';
import type { LabelLayer } from './labels';

export interface SceneEnv {
  reducedMotion: boolean;
  quality: 'low' | 'medium' | 'high';
  labels: LabelLayer;
}

/** Vertical fov that keeps the 16:9 horizontal coverage on narrower screens. */
export function fitFov(fov16x9: number, aspect: number): number {
  const base = 16 / 9;
  if (aspect >= base) return fov16x9;
  const h = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov16x9) / 2) * base);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect));
}

/** Critically damped approach factor for exponential smoothing. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Back-out easing with overshoot (UI and props share the same feel). */
export function easeOutBack(t: number, s = 1.7): number {
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

export function easeOutElastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

/** Sound cues a scene raises (game flow maps them to the procedural SFX). */
export type MenuCue = 'pop' | 'thud' | 'strain' | 'cheer' | 'sparkle' | 'boing' | 'whoosh' | 'stamp' | 'tick';

export abstract class MenuScene {
  /** Sound hook (set by game flow). */
  onCue: ((cue: MenuCue, strength?: number) => void) | null = null;
  abstract readonly id: string;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 400);
  protected readonly batcher = new MeshBatcher();
  protected readonly fx: FxSystem;
  protected readonly lighting: DuskLighting;
  protected readonly sky: THREE.Mesh;
  protected env: SceneEnv | null = null;
  /** Seconds since the scene started. */
  protected time = 0;
  /** Authored vertical fov at 16:9. */
  protected baseFov = 32;
  /** Camera pose the subclass animates; shake is added on top. */
  protected readonly camPos = new THREE.Vector3(0, 6, 14);
  protected readonly camLook = new THREE.Vector3(0, 1, 0);
  private shakeAmp = 0;
  private readonly shadows: THREE.Mesh[] = [];
  private aspect = 16 / 9;
  private disposed = false;

  protected constructor(
    o: { sky?: readonly [string, string, string]; skyStyle?: SkyStyle; fog?: string; hemi?: readonly [string, string]; shadowRadius?: number } = {},
  ) {
    this.scene.name = 'menu3d';
    this.lighting = createDuskLighting({ shadowRadius: o.shadowRadius ?? 12, quality: 'low' });
    this.scene.add(this.lighting.group);
    // Menus use a brighter, warmer sky fill than the in-match dusk so shade reads sunny, not lavender.
    const [hs, hg] = o.hemi ?? ['#D3E4FF', '#FFD9BC'];
    this.lighting.hemi.color.set(hs);
    this.lighting.hemi.groundColor.set(hg);
    this.lighting.fill.color.set('#FFF0DC');
    this.sky = skyDome(o.sky, 120, o.skyStyle);
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(o.fog ?? '#F2B49A', 60, 160);
    this.fx = new FxSystem({ dust: 120, confetti: 260, stars: 48, coins: 60, rings: 6, chunks: 90 });
    this.scene.add(this.fx.root);
    this.scene.add(this.batcher.root);
  }

  /** Scene clock (seconds). */
  get clock(): number {
    return this.time;
  }

  /** Source meshes drawn through batches (stats). */
  get batchedCount(): number {
    return this.batcher.batchedMeshes;
  }

  get reducedMotion(): boolean {
    return this.env?.reducedMotion ?? false;
  }

  /** Called by the stage when the scene becomes current (labels layer, settings). */
  attach(env: SceneEnv): void {
    this.env = env;
    this.lighting.setQuality(env.quality === 'high' ? 'medium' : 'low');
    this.onAttach();
  }

  applySettings(env: Partial<Pick<SceneEnv, 'reducedMotion' | 'quality'>>): void {
    if (!this.env) return;
    this.env = { ...this.env, ...env };
    if (env.quality) this.lighting.setQuality(env.quality === 'high' ? 'medium' : 'low');
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.fov = fitFov(this.baseFov, aspect);
    this.camera.updateProjectionMatrix();
  }

  /** Small camera jolt (big moments); ignored with reduced motion. */
  shake(amount: number): void {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** One frame: animate, place the camera, sync the batches. */
  step(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.update(dt, this.time);
    this.fx.update(dt);
    // Empty particle pools would still cost a draw call each.
    for (const c of this.fx.root.children) {
      const im = c as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.visible = im.count > 0;
    }
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime!.value = this.time;
    this.camera.position.copy(this.camPos);
    if (this.shakeAmp > 0.001) {
      const t = this.time;
      const a = this.shakeAmp;
      this.camera.position.x += Math.sin(t * 63) * a * 0.12;
      this.camera.position.y += Math.sin(t * 71 + 1.3) * a * 0.1;
      this.shakeAmp *= Math.exp(-dt * 7);
    }
    this.camera.lookAt(this.camLook);
    if (this.camera.fov !== fitFov(this.baseFov, this.aspect)) {
      this.camera.fov = fitFov(this.baseFov, this.aspect);
      this.camera.updateProjectionMatrix();
    }
    this.lighting.setFocus(this.camLook);
    this.scene.updateMatrixWorld();
    this.batcher.sync();
  }

  protected cue(c: MenuCue, strength = 1): void {
    try {
      this.onCue?.(c, strength);
    } catch (err) {
      console.warn('[menu3d] cue failed', err);
    }
  }

  /** Soft contact shadow under a prop (menus use no shadow maps), batched with the others. */
  protected addShadow(parent: THREE.Object3D, w: number, d: number, at: readonly [number, number, number] = [0, 0, 0], opacity?: number): THREE.Mesh {
    const m = contactShadow(w, d, opacity);
    const mat = contactShadowMaterial();
    if (mat) allowTransparentBatching(mat);
    m.position.set(at[0], at[1] + 0.02, at[2]);
    parent.add(m);
    this.shadows.push(m);
    this.batcher.add(m);
    return m;
  }

  /** Let a rig's flat transparent ground decals (blob shadows) share batches. */
  protected batchDecals(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.Material | undefined;
      if (!m.isMesh || !mat || Array.isArray(mat)) return;
      if ((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial && mat.transparent && !mat.depthWrite) allowTransparentBatching(mat);
    });
  }

  protected abstract update(dt: number, t: number): void;
  protected onAttach(): void {}
  protected onDispose(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.env?.labels.clear();
    this.onDispose();
    for (const m of this.shadows) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.batcher.dispose();
    this.fx.dispose();
    this.lighting.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.scene.clear();
  }
}
