/**
 * Shared materials for every procedural model.
 *
 * Look: soft toon shading (MeshToonMaterial + a 4-step gradient map) with a warm rim light
 * so chunky shapes pop against the dusk plaza. Most geometry is vertex-colored and merged
 * (see geometry.ts PartBuilder), so one material can draw a whole object or a whole chunk
 * of scenery in a single draw call.
 *
 * Shader extensions (injected with onBeforeCompile, program-cached by flag set):
 *  - `fx` vertex attribute (vec3): x = emissive strength (windows, lamps, sparks glow at
 *    dusk), y = wind-sway weight (foliage, flowers, balloons), z = fade group id.
 *  - occlusion (types.ts: "building ... fades when between camera and player"): fragments
 *    of a faded fade group, and fragments inside a soft cylinder around the camera -> focus
 *    segment, are removed from the opaque pass (a narrow dithered band softens the cylinder
 *    edge and fade transitions). A transparent "ghost" twin (ghost: true) redraws exactly the
 *    removed fragments at low alpha, so occluders read as see-through shapes. Driven by
 *    setOcclusionFocus() + occlusion.ts.
 *  - water ripple highlight for fountains/puddles.
 *
 * Everything here is cached; callers never dispose shared materials (use
 * disposeModelCaches() on full teardown).
 */
import * as THREE from 'three';
import { PAL } from './palette';
import { OCCLUSION_FOCUS, fadeTexture, updateOcclusionClients } from './occlusion';

/** Uniform objects shared by reference between all extended materials. */
export const SHARED_UNIFORMS = {
  uTime: { value: 0 },
  uOccCamera: { value: new THREE.Vector3() },
  uOccTarget: { value: new THREE.Vector3() },
  /** 0 disables the x-ray cutout. */
  uOccRadius: { value: 0 },
  /**
   * Fraction of pixels removed inside the cutout by materials WITHOUT a ghost twin (vans);
   * the rest stays as a dithered ghost. Ghosted scenery always removes everything.
   */
  uOccStrength: { value: 0.8 },
  /** Opacity of the ghost pass where an occluder is fully removed. */
  uGhostAlpha: { value: 0.3 },
  /** Per fade-group fade (occlusion.ts). */
  uFadeTex: { value: null as THREE.Texture | null },
  uRimColor: { value: new THREE.Color('#FFE6CC') },
  uRimStrength: { value: 0.32 },
};

/** Advance the shared animation clock (seconds). Call once per rendered frame. */
export function setModelTime(seconds: number): void {
  SHARED_UNIFORMS.uTime.value = seconds;
}

/**
 * Configure the scenery x-ray cutout. `camera` = camera world position, `target` = world
 * position to keep visible (usually the player's chest, y≈0.6). Pass null to disable.
 */
export function setOcclusionFocus(camera: THREE.Vector3 | null, target: THREE.Vector3 | null, radius = 2.4): void {
  const f = OCCLUSION_FOCUS;
  if (!camera || !target) {
    SHARED_UNIFORMS.uOccRadius.value = 0;
    f.active = false;
    f.radius = 0;
  } else {
    SHARED_UNIFORMS.uOccCamera.value.copy(camera);
    SHARED_UNIFORMS.uOccTarget.value.copy(target);
    SHARED_UNIFORMS.uOccRadius.value = radius;
    f.active = true;
    f.camera.copy(camera);
    f.target.copy(target);
    f.radius = radius;
  }
  // Whole-building fades + ghost visibility (scenery registers as a client).
  updateOcclusionClients();
}

/** Ghost pass opacity (0..1) for faded occluders. */
export function setGhostAlpha(alpha: number): void {
  SHARED_UNIFORMS.uGhostAlpha.value = THREE.MathUtils.clamp(alpha, 0, 1);
}

/** Rim light tuning (global). */
export function setRimLight(color: THREE.ColorRepresentation, strength: number): void {
  SHARED_UNIFORMS.uRimColor.value.set(color);
  SHARED_UNIFORMS.uRimStrength.value = strength;
}

// ---------------------------------------------------------------------------
// Gradient map
// ---------------------------------------------------------------------------

let gradientTex: THREE.DataTexture | null = null;

/**
 * 4-step toon ramp sampled with half-Lambert (dotNL*0.5+0.5). The terminator sits at the
 * 0.5 boundary; the two lit steps keep pastel colors bright, the dark steps stay soft
 * (the hemisphere light fills them further).
 */
export function toonGradient(): THREE.DataTexture {
  if (gradientTex) return gradientTex;
  const steps = [92, 140, 214, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  gradientTex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gradientTex.minFilter = THREE.NearestFilter;
  gradientTex.magFilter = THREE.NearestFilter;
  gradientTex.generateMipmaps = false;
  gradientTex.needsUpdate = true;
  return gradientTex;
}

// ---------------------------------------------------------------------------
// Extended toon material
// ---------------------------------------------------------------------------

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  /** Geometry carries the `fx` attribute (emissive, sway). */
  fx?: boolean;
  /** X-ray cutout around the occlusion focus + fade groups (scenery, vans). */
  occlusion?: boolean;
  /**
   * With `occlusion`: this material is the transparent ghost twin that draws ONLY what the
   * opaque pass removed (at uGhostAlpha). Implies transparent, no depth writes.
   */
  ghost?: boolean;
  /**
   * With `occlusion`: the opaque pass removes everything inside the cutout because a ghost
   * twin redraws it (default true for scenery). False keeps uOccStrength's dithered ghost.
   */
  ghosted?: boolean;
  /** Rim light multiplier; 0 disables. Default 1. */
  rim?: number;
  /** Animated water highlight. */
  water?: boolean;
  map?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  /** Decal polygon offset (negative factor pulls toward the camera). */
  polygonOffset?: number;
  depthWrite?: boolean;
  name?: string;
}

const BAYER = /* glsl */ `
float uhBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float uhBayer4(vec2 a) { return uhBayer2(0.5 * a) * 0.25 + uhBayer2(a); }
`;

export function createToonMaterial(opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const ghost = !!opts.ghost && !!opts.occlusion;
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    vertexColors: opts.vertexColors ?? false,
    gradientMap: toonGradient(),
    map: opts.map ?? null,
    transparent: ghost || (opts.transparent ?? false),
    opacity: opts.opacity ?? 1,
    alphaTest: opts.alphaTest ?? 0,
    side: opts.side ?? THREE.FrontSide,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  if (opts.name) mat.name = opts.name;
  if (opts.depthWrite !== undefined) mat.depthWrite = opts.depthWrite;
  if (ghost) mat.depthWrite = false;
  if (opts.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = opts.polygonOffset;
    mat.polygonOffsetUnits = opts.polygonOffset;
  }
  extendToon(mat, {
    fx: !!opts.fx,
    occlusion: !!opts.occlusion,
    ghost,
    ghosted: !!opts.occlusion && (ghost || (opts.ghosted ?? true)),
    water: !!opts.water,
    rim: opts.rim ?? 1,
  });
  return mat;
}

/**
 * Ghost twin of an occlusion material (same map/colors/side), see ToonOptions.ghost.
 * Use it on a second mesh sharing the geometry; show that mesh only while something is cut.
 */
export function createGhostMaterial(opts: ToonOptions): THREE.MeshToonMaterial {
  return createToonMaterial({ ...opts, occlusion: true, ghost: true, polygonOffset: opts.polygonOffset });
}

interface ExtendFlags {
  fx: boolean;
  occlusion: boolean;
  ghost: boolean;
  ghosted: boolean;
  water: boolean;
  rim: number;
}

function extendToon(mat: THREE.MeshToonMaterial, flags: ExtendFlags): void {
  const defines: string[] = [];
  if (flags.fx) defines.push('#define UH_FX');
  if (flags.occlusion) defines.push('#define UH_OCCLUSION');
  if (flags.ghost) defines.push('#define UH_GHOST');
  if (flags.ghosted) defines.push('#define UH_GHOSTED');
  if (flags.water) defines.push('#define UH_WATER');
  if (flags.rim > 0) defines.push('#define UH_RIM');
  const defineBlock = defines.join('\n') + '\n';
  const rimScale = { value: flags.rim };
  mat.userData.uhRimScale = rimScale;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SHARED_UNIFORMS.uTime;
    shader.uniforms.uOccCamera = SHARED_UNIFORMS.uOccCamera;
    shader.uniforms.uOccTarget = SHARED_UNIFORMS.uOccTarget;
    shader.uniforms.uOccRadius = SHARED_UNIFORMS.uOccRadius;
    shader.uniforms.uOccStrength = SHARED_UNIFORMS.uOccStrength;
    shader.uniforms.uGhostAlpha = SHARED_UNIFORMS.uGhostAlpha;
    if (!SHARED_UNIFORMS.uFadeTex.value) SHARED_UNIFORMS.uFadeTex.value = fadeTexture();
    shader.uniforms.uFadeTex = SHARED_UNIFORMS.uFadeTex;
    shader.uniforms.uRimColor = SHARED_UNIFORMS.uRimColor;
    shader.uniforms.uRimStrength = SHARED_UNIFORMS.uRimStrength;
    shader.uniforms.uRimScale = rimScale;

    shader.vertexShader =
      defineBlock +
      /* glsl */ `
uniform float uTime;
#ifdef UH_FX
attribute vec3 fx;
varying float vUhEmissive;
#endif
#if defined(UH_OCCLUSION) || defined(UH_WATER)
varying vec3 vUhWorld;
#endif
#ifdef UH_OCCLUSION
uniform sampler2D uFadeTex;
varying float vUhFade;
#endif
` +
      shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
#ifdef UH_OCCLUSION
vUhFade = 0.0;
#endif
#ifdef UH_FX
vUhEmissive = fx.x;
#ifdef UH_OCCLUSION
if (fx.z > 0.5) vUhFade = texelFetch(uFadeTex, ivec2(int(fx.z + 0.5), 0), 0).r;
#endif
if (fx.y > 0.0) {
  vec3 uhW0 = (modelMatrix * vec4(position, 1.0)).xyz;
  float uhPh = uhW0.x * 0.31 + uhW0.z * 0.23;
  transformed.x += sin(uTime * 1.6 + uhPh) * 0.05 * fx.y;
  transformed.z += sin(uTime * 1.27 + uhPh * 1.3 + 1.7) * 0.04 * fx.y;
  transformed.y += sin(uTime * 2.1 + uhPh * 0.7) * 0.012 * fx.y;
}
#endif`,
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `#include <project_vertex>
#if defined(UH_OCCLUSION) || defined(UH_WATER)
vUhWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
        );

    shader.fragmentShader =
      defineBlock +
      /* glsl */ `
uniform float uTime;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimScale;
#ifdef UH_FX
varying float vUhEmissive;
#endif
#ifdef UH_OCCLUSION
uniform vec3 uOccCamera;
uniform vec3 uOccTarget;
uniform float uOccRadius;
uniform float uOccStrength;
uniform float uGhostAlpha;
varying float vUhFade;
#endif
#if defined(UH_OCCLUSION) || defined(UH_WATER)
varying vec3 vUhWorld;
#endif
${BAYER}
` +
      shader.fragmentShader
        .replace(
          '#include <clipping_planes_fragment>',
          /* glsl */ `#include <clipping_planes_fragment>
#ifdef UH_OCCLUSION
// How much of this fragment the occlusion removes: its fade group's fade, or the soft
// cylinder around the camera -> focus segment.
float uhGone = vUhFade;
if (uOccRadius > 0.0) {
  vec3 uhCT = uOccTarget - uOccCamera;
  float uhLen2 = max(dot(uhCT, uhCT), 1e-4);
  float uhLen = sqrt(uhLen2);
  float uhT = dot(vUhWorld - uOccCamera, uhCT) / uhLen2;
  if (uhT > 0.0 && uhT < 1.0 - 1.0 / uhLen) {
    vec3 uhClosest = uOccCamera + uhCT * uhT;
    float uhD = length(vUhWorld - uhClosest);
    float uhCut = 1.0 - smoothstep(uOccRadius * 0.8, uOccRadius, uhD);
    uhCut *= smoothstep(uOccTarget.y + 0.15, uOccTarget.y + 0.85, vUhWorld.y);
    uhGone = max(uhGone, uhCut);
  }
}
#ifdef UH_GHOST
if (uhGone < 0.004) discard;
#else
#ifdef UH_GHOSTED
float uhStrength = 1.0;
#else
float uhStrength = uOccStrength;
#endif
// Bayer thresholds are 0..15/16: gone = 1 at full strength removes every fragment, partial
// values (cylinder edge band, fade transitions) dither.
if (uhGone * uhStrength > uhBayer4(gl_FragCoord.xy) + 0.001) discard;
#endif
#endif`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
#ifdef UH_FX
totalEmissiveRadiance += diffuseColor.rgb * vUhEmissive;
#endif
#ifdef UH_WATER
float uhR = sin(vUhWorld.x * 3.1 + uTime * 2.2) * sin(vUhWorld.z * 2.7 - uTime * 1.7);
float uhR2 = sin((vUhWorld.x + vUhWorld.z) * 5.3 - uTime * 3.1);
totalEmissiveRadiance += vec3(0.16, 0.22, 0.26) * (smoothstep(0.55, 0.95, uhR) + 0.5 * smoothstep(0.85, 1.0, uhR2));
#endif`,
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `
#ifdef UH_RIM
float uhRim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
outgoingLight += mix(diffuseColor.rgb, uRimColor, 0.55) * smoothstep(0.6, 0.92, uhRim) * uRimStrength * uRimScale;
#endif
#ifdef UH_GHOST
diffuseColor.a *= uGhostAlpha * clamp(uhGone, 0.0, 1.0);
#endif
#include <opaque_fragment>`,
        );
  };
  mat.customProgramCacheKey = () => `uh-toon|${defineBlock}`;
}

/** Set a per-material rim multiplier on an extended toon material. */
export function setMaterialRim(mat: THREE.Material, rim: number): void {
  const u = mat.userData.uhRimScale as { value: number } | undefined;
  if (u) u.value = rim;
}

/**
 * Fade a (non-shared) material. Switches the transparent flag only when needed
 * (it changes the shader program variant) and disables depth writes while faded so
 * what is behind stays visible.
 */
export function setMaterialOpacity(mat: THREE.Material, opacity: number): void {
  const a = THREE.MathUtils.clamp(opacity, 0, 1);
  const wantTransparent = a < 0.999;
  if (mat.transparent !== wantTransparent) {
    mat.transparent = wantTransparent;
    mat.depthWrite = !wantTransparent;
    mat.needsUpdate = true;
  }
  mat.opacity = a;
}

// ---------------------------------------------------------------------------
// Shared material cache
// ---------------------------------------------------------------------------

const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.name = m.name || key;
    cache.set(key, m);
  }
  return m;
}

/** Bucket names used by PartBuilder; each maps to one shared material. */
export type BucketName = 'vc' | 'vcScenery' | 'water' | 'glow' | 'sign';

/** Vertex-colored toon for dynamic objects (raccoons, safes, bank, fences). */
export function matVC(): THREE.MeshToonMaterial {
  return cached('vc', () => createToonMaterial({ vertexColors: true, fx: true }));
}

/** Vertex-colored toon for static scenery: occlusion cut + fade groups (ghost twin below). */
export function matScenery(): THREE.MeshToonMaterial {
  return cached('vcScenery', () => createToonMaterial({ vertexColors: true, fx: true, occlusion: true }));
}

/** Ghost twin of matScenery (draws only what the occlusion removed, see createGhostMaterial). */
export function matSceneryGhost(): THREE.MeshToonMaterial {
  return cached('vcSceneryGhost', () => createGhostMaterial({ vertexColors: true, fx: true }));
}

/** Double-sided variant for thin cards (awnings, umbrella canopies, flags). */
export function matSceneryDouble(): THREE.MeshToonMaterial {
  return cached('vcSceneryDouble', () =>
    createToonMaterial({ vertexColors: true, fx: true, occlusion: true, side: THREE.DoubleSide, rim: 0.5 }),
  );
}

export function matSceneryDoubleGhost(): THREE.MeshToonMaterial {
  return cached('vcSceneryDoubleGhost', () => createGhostMaterial({ vertexColors: true, fx: true, side: THREE.DoubleSide, rim: 0.5 }));
}

/**
 * Vans: the cylinder x-ray without a ghost twin keeps a dithered ghost (uOccStrength), so a
 * van never vanishes completely between the camera and the player.
 */
export function matVan(): THREE.MeshToonMaterial {
  return cached('vcVan', () => createToonMaterial({ vertexColors: true, fx: true, occlusion: true, ghosted: false }));
}

export function matWater(): THREE.MeshToonMaterial {
  return cached('water', () =>
    createToonMaterial({ vertexColors: true, fx: true, water: true, rim: 0.6, transparent: true, opacity: 0.88 }),
  );
}

/** Additive radial glow (lamp halos, light pools on the ground). Uses the radial texture. */
export function matGlow(radial: THREE.Texture): THREE.MeshBasicMaterial {
  return cached('glow', () => {
    const m = new THREE.MeshBasicMaterial({
      map: radial,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  });
}

/** Unlit vertex-colored material (speed lines, sparks). */
export function matUnlit(): THREE.MeshBasicMaterial {
  return cached('unlit', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
}

/** Textured toon (decals, plates, signs). Cached by texture uuid + flags. */
export function matTextured(
  tex: THREE.Texture,
  o: { alphaTest?: number; transparent?: boolean; rim?: number; polygonOffset?: number; side?: THREE.Side; occlusion?: boolean; fx?: boolean; vertexColors?: boolean } = {},
): THREE.MeshToonMaterial {
  const key = `tex|${tex.uuid}|${o.alphaTest ?? 0}|${o.transparent ?? false}|${o.rim ?? 0.4}|${o.polygonOffset ?? 0}|${o.side ?? 0}|${o.occlusion ?? false}|${o.fx ?? false}|${o.vertexColors ?? false}`;
  return cached(key, () =>
    createToonMaterial({
      map: tex,
      alphaTest: o.alphaTest,
      transparent: o.transparent,
      rim: o.rim ?? 0.4,
      polygonOffset: o.polygonOffset,
      side: o.side,
      occlusion: o.occlusion,
      fx: o.fx,
      vertexColors: o.vertexColors,
    }),
  );
}

/** Plain colored toon (rarely needed; most parts are vertex colored). */
export function matColor(color: THREE.ColorRepresentation, rim = 1): THREE.MeshToonMaterial {
  const c = new THREE.Color(color);
  return cached(`col|${c.getHexString()}|${rim}`, () => createToonMaterial({ color: c, rim }));
}

/** Simple transparent unlit color, cached (speed lines, shadows...). */
export function matBasic(color: THREE.ColorRepresentation, opacity = 1, additive = false): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color);
  return cached(`basic|${c.getHexString()}|${opacity}|${additive}`, () =>
    new THREE.MeshBasicMaterial({
      color: c,
      transparent: opacity < 1 || additive,
      opacity,
      depthWrite: !(opacity < 1 || additive),
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    }),
  );
}

/** Dispose every cached material (full renderer teardown only). */
export function disposeMaterialCache(): void {
  cache.forEach((m) => m.dispose());
  cache.clear();
  gradientTex?.dispose();
  gradientTex = null;
}

/** Default dusk rim color. */
export const RIM_DEFAULT = PAL.goldLight;
