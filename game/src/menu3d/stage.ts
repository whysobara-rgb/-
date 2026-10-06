/**
 * MenuStage: the second (and last) WebGL context of the game, dedicated to the live 3D menus.
 *
 *   const stage = new MenuStage(appEl, uiRoot.el, { quality, reducedMotion });
 *   stage.setScene(new TitleScene(...));   // shows the canvas, disposes the previous scene
 *   each frame while menus own the screen:  stage.frame(dt)   (GameView is NOT rendered then)
 *   stage.setScene(null)                    // hides the canvas (match / results use GameView)
 *
 * The canvas and the 3D-anchored label layer are inserted right before the UI root, so they
 * cover the GameView canvas and sit under every UI layer. The renderer also serves the
 * portrait cache (render-to-texture snapshots of the real models).
 */
import * as THREE from 'three';
import { setModelTime, setOcclusionFocus, setViewCamera } from '../render/models';
import { LabelLayer } from './labels';
import { PortraitCache } from './portraits';
import type { MenuScene } from './scene';

export interface MenuStageOptions {
  quality: 'low' | 'medium' | 'high';
  reducedMotion: boolean;
  /** Draw every N-th frame (software-GL test hook, ?render=N). */
  renderEvery?: number;
}

export interface MenuStageStats {
  scene: string | null;
  drawCalls: number;
  triangles: number;
  batched: number;
  frameMs: number;
}

export class MenuStage {
  readonly canvas: HTMLCanvasElement;
  readonly labels = new LabelLayer();
  readonly portraits: PortraitCache;
  private readonly renderer: THREE.WebGLRenderer;
  private current: MenuScene | null = null;
  private opts: MenuStageOptions;
  private frameNo = 0;
  private pendingDt = 0;
  private width = 1;
  private height = 1;
  private readonly ro: ResizeObserver | null;
  private lastCalls = 0;
  private lastTris = 0;
  private lastMs = 0;
  private disposed = false;

  constructor(private readonly host: HTMLElement, before: Element | null, o: MenuStageOptions) {
    this.opts = { ...o };
    this.renderer = new THREE.WebGLRenderer({ antialias: o.quality !== 'low', alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    // No shadow maps in the menus (draw-call budget): contact shadows + blob shadows instead.
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor('#2B1F5C');
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'uh-m3d-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    this.canvas.style.cssText = 'position:absolute;inset:0;display:none;width:100%;height:100%;touch-action:none;';
    this.labels.el.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    this.labels.el.hidden = true;
    host.insertBefore(this.canvas, before);
    host.insertBefore(this.labels.el, before);
    this.portraits = new PortraitCache(this.renderer);
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(host);
    this.resize();
  }

  get scene(): MenuScene | null {
    return this.current;
  }

  get active(): boolean {
    return this.current !== null;
  }

  /** Make `scene` current (null = hide the stage). The previous scene is disposed. */
  setScene<S extends MenuScene>(scene: S): S;
  setScene(scene: null): null;
  setScene(scene: MenuScene | null): MenuScene | null {
    if (this.disposed) return null;
    if (scene === this.current) return scene;
    const prev = this.current;
    this.current = scene;
    if (prev) prev.dispose();
    this.labels.clear();
    if (scene) {
      scene.attach({ reducedMotion: this.opts.reducedMotion, quality: this.opts.quality, labels: this.labels });
      scene.setAspect(this.width / this.height);
      scene.step(0);
    }
    const on = scene !== null;
    // (inline display wins over the [hidden] attribute's UA style: toggle both)
    this.canvas.hidden = !on;
    this.canvas.style.display = on ? 'block' : 'none';
    this.labels.el.hidden = !on;
    this.labels.el.style.display = on ? '' : 'none';
    this.pendingDt = 0;
    return scene;
  }

  applySettings(o: Partial<MenuStageOptions>): void {
    this.opts = { ...this.opts, ...o };
    this.current?.applySettings({ reducedMotion: this.opts.reducedMotion, quality: this.opts.quality });
    this.resize();
  }

  /** Advance + draw the current scene (call once per animation frame while it owns the screen). */
  frame(dt: number): void {
    const s = this.current;
    if (!s || this.disposed) return;
    this.frameNo++;
    this.pendingDt += dt;
    const every = Math.max(1, this.opts.renderEvery ?? 1);
    if (every > 1 && this.frameNo % every !== 0) return;
    const step = Math.min(0.1 * every, this.pendingDt);
    this.pendingDt = 0;
    const t0 = performance.now();
    s.step(step);
    this.draw(s);
    this.lastMs = performance.now() - t0;
  }

  /** Draw once without advancing (e.g. right after a scene change). */
  redraw(): void {
    if (this.current) this.draw(this.current);
  }

  private draw(s: MenuScene): void {
    setModelTime(s.clock);
    setOcclusionFocus(null, null);
    setViewCamera(s.camera);
    this.renderer.info.reset();
    this.renderer.render(s.scene, s.camera);
    this.lastCalls = this.renderer.info.render.calls;
    this.lastTris = this.renderer.info.render.triangles;
    this.labels.update(s.camera, this.width, this.height);
  }

  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.round(this.host.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.round(this.host.clientHeight || window.innerHeight));
    this.width = w;
    this.height = h;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const cap = this.opts.quality === 'high' ? 2 : this.opts.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.renderer.setSize(w, h, false);
    this.current?.setAspect(w / h);
  }

  stats(): MenuStageStats {
    return {
      scene: this.current?.id ?? null,
      drawCalls: this.lastCalls,
      triangles: this.lastTris,
      batched: this.current?.batchedCount ?? 0,
      frameMs: this.lastMs,
    };
  }

  /** The renderer (portrait cache, dev galleries). */
  get gl(): THREE.WebGLRenderer {
    return this.renderer;
  }

  dispose(): void {
    if (this.disposed) return;
    this.setScene(null);
    this.disposed = true;
    this.ro?.disconnect();
    this.portraits.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.el.remove();
  }
}
