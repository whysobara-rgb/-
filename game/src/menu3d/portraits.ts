/**
 * Portraits rendered from the real 3D models (render-to-texture snapshots, cached as data URLs):
 * raccoon heads with any hat / rival look / expression / team, silhouettes for locked rivals,
 * and loot "cards" (small safe, big safe, bank) for prompts.
 *
 * Uses the menu renderer (no extra WebGL context). Each new key renders once (a few ms; tens
 * of ms on software GL) and is reused for the rest of the session.
 */
import * as THREE from 'three';
import type { HatId, LayoutDef, LootKind, TeamId } from '../sim/types';
import { createBank, createRaccoon, createSafe, idlePose, setModelTime, setOcclusionFocus, setViewCamera, type RaccoonExpression } from '../render/models';
import { giftBox, disposeProp } from './kit';
import { LabelLayer } from './labels';
import { PreviewScene } from './scenes/preview';

export type PortraitExpression = 'neutral' | 'happy' | 'sad' | 'smug' | 'determined' | 'surprised';

export interface RaccoonPortraitSpec {
  hat?: HatId;
  rival?: 'hodadak' | 'tongkeun' | 'nunchi' | null;
  team?: TeamId | null;
  expression?: PortraitExpression;
  silhouette?: boolean;
  furTint?: number;
  /** 'head' (default) or 'bust' (head + chest, wider). */
  frame?: 'head' | 'bust';
}

const EXPR: Record<PortraitExpression, RaccoonExpression> = {
  neutral: 'normal',
  happy: 'happy',
  sad: 'sad',
  smug: 'sly',
  determined: 'determined',
  surprised: 'shock',
};

const RIVAL_HAT: Record<'hodadak' | 'tongkeun' | 'nunchi', HatId> = {
  hodadak: 'hodadakBand',
  tongkeun: 'tongkeunHat',
  nunchi: 'nunchiMask',
};

const SIZE = 256;
const SS = 2;

export class PortraitCache {
  private readonly cache = new Map<string, string>();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(20, 1, 0.05, 50);
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly pixels = new Uint8Array(SIZE * SS * SIZE * SS * 4);
  private readonly canvas: HTMLCanvasElement;
  private readonly big: HTMLCanvasElement;
  private silMat: THREE.MeshBasicMaterial | null = null;
  private disposed = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const hemi = new THREE.HemisphereLight('#E9E4FF', '#D9B6A6', 2.0);
    const key = new THREE.DirectionalLight('#FFE2C4', 2.6);
    key.position.set(3, 4, 2.5);
    const rim = new THREE.DirectionalLight('#B9C8FF', 1.4);
    rim.position.set(-3, 2, -2);
    this.scene.add(hemi, key, rim);
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.big = document.createElement('canvas');
    this.big.width = SIZE * SS;
    this.big.height = SIZE * SS;
  }

  /** Data URL of a raccoon portrait (transparent background). */
  raccoon(spec: RaccoonPortraitSpec): string | null {
    const hat: HatId = spec.hat ?? (spec.rival ? RIVAL_HAT[spec.rival] : 'none');
    const expr = spec.expression ?? (spec.rival === 'nunchi' ? 'smug' : spec.rival === 'tongkeun' ? 'happy' : spec.rival === 'hodadak' ? 'determined' : 'neutral');
    const frame = spec.frame ?? 'head';
    const key = `r|${hat}|${spec.rival ?? '-'}|${spec.team ?? '-'}|${expr}|${spec.silhouette ? 1 : 0}|${spec.furTint ?? 0.5}|${frame}`;
    return this.cached(key, () => {
      const rig = createRaccoon({ team: spec.team ?? null, look: { hat, rival: spec.rival ?? null, furTint: spec.furTint ?? 0.5 } });
      const pose = idlePose(1.3);
      pose.expression = EXPR[expr];
      pose.headYaw = 0.18;
      rig.setBlobShadow(false);
      // Facing the camera three-quarters (the rig faces +X).
      rig.root.rotation.y = -0.55;
      rig.update(0, pose);
      rig.update(0.016, pose);
      if (spec.silhouette) this.silhouette(rig.root);
      this.scene.add(rig.root);
      const bust = frame === 'bust';
      // Head framing keeps the tallest hats (beanie pompom, star) inside the frame.
      this.camera.fov = bust ? 27 : 23;
      this.camera.position.set(2.6, bust ? 1.05 : 1.12, 0.2);
      this.camera.lookAt(0.02, bust ? 0.66 : 0.9, 0.05);
      this.camera.updateProjectionMatrix();
      const url = this.shoot();
      rig.dispose();
      return url;
    });
  }

  /** Data URL of a loot card (small safe, big safe, bank) or the wrapped gift box. */
  object(kind: LootKind | 'gift'): string | null {
    return this.cached(`o|${kind}`, () => {
      let root: THREE.Object3D;
      let done: () => void;
      let dist = 3;
      let h = 0.5;
      if (kind === 'bank') {
        const b = createBank();
        b.setCutaway(false);
        b.update(0.016);
        root = b.root;
        done = () => b.dispose();
        dist = 15;
        h = 1.9;
      } else if (kind === 'gift') {
        root = giftBox(0.8);
        done = () => disposeProp(root);
        dist = 3.2;
        h = 0.5;
      } else {
        const s = createSafe(kind);
        s.setAnchored(false);
        s.update(0.016);
        root = s.root;
        done = () => s.dispose();
        dist = kind === 'largeSafe' ? 4.4 : 3.2;
        h = kind === 'largeSafe' ? 0.6 : 0.45;
      }
      root.rotation.y = -0.6;
      this.scene.add(root);
      this.camera.fov = 22;
      this.camera.position.set(dist * 0.85, h + dist * 0.42, dist * 0.55);
      this.camera.lookAt(0, h, 0);
      this.camera.updateProjectionMatrix();
      const url = this.shoot();
      done();
      root.removeFromParent();
      return url;
    });
  }

  /**
   * Snapshot of the 3D layout miniature (the same diorama the layout preview shows), used on
   * the quick-match setup card. Rendered once per layout at 16:10.
   */
  layout(layout: LayoutDef): string | null {
    return this.cached(`l|${layout.id}`, () => {
      const W = 640;
      const H = 400;
      const scene = new PreviewScene({ layout, police: false, myTeam: 0 });
      const labels = new LabelLayer();
      try {
        scene.attach({ reducedMotion: true, quality: 'low', labels });
        scene.setAspect(W / H);
        scene.step(3);
        setModelTime(scene.clock);
        setOcclusionFocus(null, null);
        setViewCamera(scene.camera);
        return this.shootScene(scene.scene, scene.camera, W, H, false);
      } finally {
        labels.clear();
        scene.dispose();
      }
    });
  }

  private shootScene(scene: THREE.Scene, camera: THREE.Camera, W: number, H: number, transparent: boolean): string | null {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const px = new Uint8Array(W * H * 4);
    const prevRt = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    try {
      r.setRenderTarget(rt);
      if (transparent) r.setClearColor(0x000000, 0);
      r.clear(true, true, true);
      r.render(scene, camera);
      r.readRenderTargetPixels(rt, 0, 0, W, H, px);
    } finally {
      r.setRenderTarget(prevRt);
      r.setClearColor(prevClear, prevAlpha);
      rt.dispose();
    }
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(W, H);
    const row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.86);
  }

  private cached(key: string, make: () => string | null): string | null {
    if (this.disposed) return null;
    const hit = this.cache.get(key);
    if (hit) return hit;
    try {
      const url = make();
      if (url) this.cache.set(key, url);
      return url;
    } catch (err) {
      console.warn('[menu3d] portrait failed', key, err);
      return null;
    }
  }

  private silhouette(root: THREE.Object3D): void {
    if (!this.silMat) this.silMat = new THREE.MeshBasicMaterial({ color: '#3B2F5C' });
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.userData.isOutlineHull) return;
      if (m.name === 'raccoon:face' || m.name === 'raccoon:mask') {
        m.visible = false;
        return;
      }
      m.material = this.silMat!;
    });
  }

  private shoot(): string | null {
    const r = this.renderer;
    const W = SIZE * SS;
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(W, W, { depthBuffer: true });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const prevRt = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevShadow = r.shadowMap.enabled;
    setModelTime(1.3);
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.shadowMap.enabled = false;
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    r.readRenderTargetPixels(this.rt, 0, 0, W, W, this.pixels);
    r.setRenderTarget(prevRt);
    r.setClearColor(prevClear, prevAlpha);
    r.shadowMap.enabled = prevShadow;
    // Flip Y into the big canvas, then downsample (supersampled edges).
    const bctx = this.big.getContext('2d');
    const ctx = this.canvas.getContext('2d');
    if (!bctx || !ctx) return null;
    const img = bctx.createImageData(W, W);
    const row = W * 4;
    for (let y = 0; y < W; y++) img.data.set(this.pixels.subarray((W - 1 - y) * row, (W - y) * row), y * row);
    bctx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.big, 0, 0, SIZE, SIZE);
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.disposed = true;
    this.rt?.dispose();
    this.rt = null;
    this.silMat?.dispose();
    this.cache.clear();
  }
}
