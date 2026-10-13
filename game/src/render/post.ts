/**
 * Post-processing for the game view (docs/ART_DIRECTION.md: toy-box dusk, layered feedback).
 *
 *   RenderPass (HDR half-float target, MSAA on medium/high)
 *   -> soft bloom on bright emissives only (lamps, windows, coins, sirens, alarm, sparkles)
 *   -> OutputPass (tone mapping + sRGB, from the renderer settings)
 *   -> grade pass (display space): warm highlights / lavender shadows, a little saturation,
 *      vignette, chromatic flash on impacts and the manga "impact frame" (radial speed lines +
 *      white flash) for 1-2 frames on knockdowns / tackles / the bank uproot.
 *
 * Quality: low = off (the view renders straight to the canvas, nothing allocated), medium =
 * quarter-res bloom + grade, high = half-res bloom + grade + chromatic flash.
 * reducedMotion drops impact frames and chroma flashes (the grade stays).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { QualityPreset } from './quality';

/** Bloom that runs at a fraction of the composer size. */
class ScaledBloomPass extends UnrealBloomPass {
  scale = 0.5;
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(2, Math.round(width * this.scale * 2)), Math.max(2, Math.round(height * this.scale * 2)));
  }
}

/** Scene pass that remembers how many draw calls the scene itself took (stats). */
class CountingRenderPass extends RenderPass {
  sceneCalls = 0;
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    const before = renderer.info.render.calls;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    this.sceneCalls = renderer.info.render.calls - before;
  }
}

const GradeShader = {
  name: 'UprootGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAspect: { value: 16 / 9 },
    uVignette: { value: 0.32 },
    uWarm: { value: 1 },
    uSat: { value: 1.08 },
    uChroma: { value: 0 },
    uImpact: { value: 0 },
    uImpactCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uImpactSeed: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color('#FFFFFF') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect;
    uniform float uVignette;
    uniform float uWarm;
    uniform float uSat;
    uniform float uChroma;
    uniform float uImpact;
    uniform vec2 uImpactCenter;
    uniform float uImpactSeed;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n * 127.1 + uImpactSeed * 31.7) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      vec3 c;
      if (uChroma > 0.001) {
        vec2 off = d * uChroma * 0.016;
        c.r = texture2D(tDiffuse, uv + off).r;
        c.g = texture2D(tDiffuse, uv).g;
        c.b = texture2D(tDiffuse, uv - off).b;
      } else {
        c = texture2D(tDiffuse, uv).rgb;
      }
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      // Saturation + split tone: lavender shadows, peach highlights (dusk toy box).
      c = mix(vec3(l), c, uSat);
      c += uWarm * vec3(0.035, 0.012, -0.03) * smoothstep(0.45, 1.0, l);
      c += uWarm * vec3(0.012, -0.004, 0.03) * (1.0 - smoothstep(0.0, 0.45, l));
      // Gentle S-curve for pop.
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
      // Vignette (aspect-correct, soft).
      float r = length(d * vec2(uAspect, 1.0)) / length(vec2(uAspect, 1.0) * 0.5);
      c *= 1.0 - uVignette * smoothstep(0.45, 1.15, r);
      // Impact frame: radial ink speed lines toward the edges + white flash.
      if (uImpact > 0.001) {
        vec2 p = (uv - uImpactCenter) * vec2(uAspect, 1.0);
        float ang = atan(p.y, p.x);
        float rr = length(p);
        float sectors = 72.0;
        float s = floor((ang / 6.2831853 + 0.5) * sectors);
        float frac = fract((ang / 6.2831853 + 0.5) * sectors);
        float start = 0.28 + hash(s) * 0.4;
        float width = 0.18 + hash(s + 9.0) * 0.5;
        float on = step(0.45, hash(s + 3.0));
        float wedge = smoothstep(0.5 - width * 0.5, 0.5 - width * 0.5 + 0.08, frac) * (1.0 - smoothstep(0.5 + width * 0.5 - 0.08, 0.5 + width * 0.5, frac));
        float line = on * wedge * smoothstep(start, start + 0.12, rr);
        c = mix(c, vec3(1.0), uImpact * 0.22);
        c = mix(c, vec3(0.13, 0.1, 0.17), line * uImpact * 0.85);
      }
      c = mix(c, uFlashColor, clamp(uFlash, 0.0, 1.0));
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export interface ImpactOptions {
  /** Screen point (0..1, y up) the speed lines radiate from. */
  center?: { x: number; y: number };
  /** 0..1 strength of the speed lines + flash. */
  strength?: number;
  /** Seconds the frame stays (default ~2 frames). */
  duration?: number;
  /** Chromatic aberration kick (0..1). */
  chroma?: number;
}

export class PostFX {
  private composer: EffectComposer | null = null;
  private target: THREE.WebGLRenderTarget | null = null;
  private renderPass: CountingRenderPass | null = null;
  private bloom: ScaledBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private preset: QualityPreset;
  private reducedMotion = false;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private impactT = 0;
  private impactDur = 0;
  private impactStrength = 0;
  private chroma = 0;
  private flash = 0;
  private flashColor = new THREE.Color('#FFFFFF');
  private alarm = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    preset: QualityPreset,
  ) {
    this.preset = preset;
    this.rebuild();
  }

  /** Composer is in use (medium / high). */
  get active(): boolean {
    return this.composer !== null;
  }

  /** Scene draw calls of the last frame (without post passes). */
  get sceneCalls(): number {
    return this.renderPass?.sceneCalls ?? 0;
  }

  setRenderer(r: THREE.WebGLRenderer): void {
    this.renderer = r;
    this.rebuild();
  }

  setQuality(preset: QualityPreset, reducedMotion: boolean): void {
    const changed = preset.post !== this.preset.post || preset.msaaSamples !== this.preset.msaaSamples;
    this.preset = preset;
    this.reducedMotion = reducedMotion;
    if (changed) this.rebuild();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (on) {
      this.impactT = this.impactDur = 0;
      this.chroma = 0;
    }
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.width = w;
    this.height = h;
    this.pixelRatio = pixelRatio;
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(w, h);
    }
    if (this.grade) this.grade.uniforms.uAspect.value = w / Math.max(1, h);
  }

  /** Manga impact frame (knockdown, tackle, uproot). Ignored with reducedMotion / post off. */
  impact(o: ImpactOptions = {}): void {
    if (this.reducedMotion) return;
    const s = THREE.MathUtils.clamp(o.strength ?? 1, 0, 1);
    if (s >= this.impactStrength * Math.max(0, 1 - this.impactT / Math.max(1e-3, this.impactDur)) || this.impactT >= this.impactDur) {
      this.impactStrength = s;
      this.impactT = 0;
      this.impactDur = o.duration ?? 0.075;
      if (this.grade) {
        this.grade.uniforms.uImpactCenter.value.set(o.center?.x ?? 0.5, o.center?.y ?? 0.5);
        this.grade.uniforms.uImpactSeed.value = Math.random() * 100;
      }
    }
    if (o.chroma) this.kickChroma(o.chroma);
  }

  kickChroma(amount: number): void {
    if (this.reducedMotion || !this.preset.chroma) return;
    this.chroma = Math.min(1.5, this.chroma + amount);
  }

  /** Full-screen color flash (decays fast). */
  flashColorOnce(color: THREE.ColorRepresentation, amount: number): void {
    if (this.reducedMotion) amount *= 0.35;
    this.flashColor.set(color);
    this.flash = Math.max(this.flash, Math.min(0.6, amount));
  }

  /** 0..1 alarm tint pulse (red vignette edge while a nearby bank alarm rings). */
  setAlarm(level: number): void {
    this.alarm = THREE.MathUtils.clamp(level, 0, 1);
  }

  /** Advance flash / impact timers (call once per view frame, also when nothing is drawn). */
  tick(dt: number): void {
    if (dt <= 0) return;
    this.impactT += dt;
    this.chroma *= Math.exp(-dt * 9);
    this.flash *= Math.exp(-dt * 14);
  }

  /** Draw the frame (or nothing when inactive: the caller renders directly). */
  render(dt: number): void {
    if (!this.composer || !this.grade) return;
    const u = this.grade.uniforms;
    const imp = this.impactT < this.impactDur ? this.impactStrength : 0;
    u.uImpact.value = imp;
    u.uChroma.value = this.chroma > 0.01 ? this.chroma : 0;
    u.uFlash.value = this.flash > 0.004 ? this.flash : 0;
    u.uFlashColor.value.copy(this.flashColor);
    u.uVignette.value = 0.3 + this.alarm * 0.12;
    this.composer.render(dt);
  }

  dispose(): void {
    this.teardown();
  }

  private teardown(): void {
    if (this.composer) {
      for (const p of this.composer.passes) (p as { dispose?: () => void }).dispose?.();
      this.composer.dispose();
    }
    this.target?.dispose();
    this.composer = null;
    this.target = null;
    this.renderPass = null;
    this.bloom = null;
    this.grade = null;
  }

  private rebuild(): void {
    this.teardown();
    const p = this.preset;
    if (!p.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: p.msaaSamples,
    });
    rt.texture.name = 'post.scene';
    const composer = new EffectComposer(this.renderer, rt);
    const rp = new CountingRenderPass(this.scene, this.camera);
    composer.addPass(rp);
    const bloom = new ScaledBloomPass(new THREE.Vector2(size.x, size.y), p.bloomStrength, 0.42, 1.75);
    bloom.scale = p.bloomScale;
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const grade = new ShaderPass(GradeShader);
    grade.uniforms.uAspect.value = this.width / Math.max(1, this.height);
    composer.addPass(grade);
    this.composer = composer;
    this.target = rt;
    this.renderPass = rp;
    this.bloom = bloom;
    this.grade = grade;
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
  }
}
