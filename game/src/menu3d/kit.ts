/**
 * Small prop kit for the menu dioramas: everything is chunky, rounded, toon shaded and ink
 * outlined so props read like the in-game toys.
 *
 * Props are built with PropBuilder: every coloured part is baked into ONE vertex-coloured
 * mesh (one shared toon material for all props) plus its ink hull, so a whole crate, island or
 * stage is two draw calls, and the batcher then folds every prop of a scene into the same two
 * multi-draw calls. Geometry made here is owned by the prop (`disposeProp`); materials are
 * shared for the session (like the model caches).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InkOutline, createToonMaterial } from '../render/models';

/** Pop palette shared with the UI (src/ui/styles/tokens.css). */
export const POP = {
  sun: '#FFD23F',
  sunDark: '#E0A417',
  tomato: '#FF5A4E',
  tomatoDark: '#C8352C',
  mint: '#4FD6A6',
  mintDark: '#239A72',
  sky: '#4FB6FF',
  skyDark: '#2479C8',
  grape: '#8E6CF0',
  pink: '#FF8FB8',
  cream: '#FFF6E6',
  ink: '#2A2131',
  wood: '#C98B55',
  woodDark: '#8E5A34',
  woodLight: '#E8B27C',
  roof: '#5B4E7A',
  roofDark: '#3F355A',
  roofLight: '#76689A',
  brick: '#C96B5A',
  steel: '#A9B2C6',
  steelDark: '#6B7387',
  grass: '#8CCB6E',
  grassDark: '#5E9E4A',
  soil: '#9A6A45',
  soilDark: '#6E4A30',
  paving: '#F1E2CF',
  pavingDark: '#D9C2A6',
  velvet: '#C8354E',
  velvetDark: '#8E1F38',
} as const;

export type PropColor = THREE.ColorRepresentation;

const toonCache = new Map<string, THREE.Material>();
/** Shared toon material per colour + rim (menu props; lives for the session like the model cache). */
export function matColor(color: THREE.ColorRepresentation, rim = 0.6): THREE.Material {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${rim}`;
  let m = toonCache.get(key);
  if (!m) {
    m = createToonMaterial({ color: c, rim, name: `menu3d:toon#${key}` });
    toonCache.set(key, m);
  }
  return m;
}

let vcMat: THREE.Material | null = null;
/** The one vertex-coloured toon material every baked prop uses. */
export function matPropVC(): THREE.Material {
  if (!vcMat) vcMat = createToonMaterial({ vertexColors: true, rim: 0.6, name: 'menu3d:propVC' });
  return vcMat;
}

/** Deterministic PRNG (props are hand-placed, small variations are seeded). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Prop builder
// ---------------------------------------------------------------------------------------------

export interface PartOptions {
  rot?: readonly [number, number, number];
  scale?: readonly [number, number, number] | number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/** Collects coloured parts and bakes them into one vertex-coloured, ink-outlined mesh. */
export class PropBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: PropColor, at: readonly [number, number, number] = [0, 0, 0], o: PartOptions = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    _e.set(o.rot?.[0] ?? 0, o.rot?.[1] ?? 0, o.rot?.[2] ?? 0);
    _q.setFromEuler(_e);
    if (o.scale === undefined) _s.set(1, 1, 1);
    else if (typeof o.scale === 'number') _s.setScalar(o.scale);
    else _s.set(o.scale[0], o.scale[1], o.scale[2]);
    _p.set(at[0], at[1], at[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    _c.set(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.clearGroups();
    this.parts.push(g);
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** Bake into a group holding one mesh (+ ink hull). `outline: false` skips the hull. */
  build(name: string, o: { outline?: boolean; castShadow?: boolean } = {}): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    if (!this.parts.length) return group;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (!merged) return group;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, matPropVC());
    mesh.name = `${name}:mesh`;
    mesh.castShadow = o.castShadow ?? true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const outlines: InkOutline[] = [];
    if (o.outline !== false) outlines.push(new InkOutline(group));
    owned.set(group, { geos: [merged], outlines });
    return group;
  }
}

const owned = new WeakMap<THREE.Object3D, { geos: THREE.BufferGeometry[]; outlines: InkOutline[] }>();

/** Free geometry and outlines created for a prop (materials are shared). */
export function disposeProp(group: THREE.Object3D): void {
  group.traverse((c) => {
    const o = owned.get(c);
    if (!o) return;
    for (const l of o.outlines) l.dispose();
    for (const g of o.geos) g.dispose();
    owned.delete(c);
  });
  group.removeFromParent();
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/** Rounded box (bevelled corners), centred at the origin. */
export function roundBox(w: number, h: number, d: number, r = 0.06, seg = 3): THREE.BufferGeometry {
  // The bevel grows the outline by `rr`, so the extruded shape is the box shrunk by rr on every
  // side, with softly rounded corners of its own: the result is w x h x d with rounded edges.
  const rr = Math.max(1e-3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const x0 = Math.max(1e-3, w / 2 - rr);
  const y0 = Math.max(1e-3, h / 2 - rr);
  const c = Math.min(rr, x0, y0) * 0.9;
  const shape = new THREE.Shape();
  shape.moveTo(-x0 + c, -y0);
  shape.lineTo(x0 - c, -y0);
  shape.quadraticCurveTo(x0, -y0, x0, -y0 + c);
  shape.lineTo(x0, y0 - c);
  shape.quadraticCurveTo(x0, y0, x0 - c, y0);
  shape.lineTo(-x0 + c, y0);
  shape.quadraticCurveTo(-x0, y0, -x0, y0 - c);
  shape.lineTo(-x0, -y0 + c);
  shape.quadraticCurveTo(-x0, -y0, -x0 + c, -y0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-3, d - 2 * rr),
    bevelEnabled: true,
    bevelThickness: rr,
    bevelSize: rr * 0.98,
    bevelSegments: seg,
    curveSegments: seg,
  });
  geo.translate(0, 0, -(d - 2 * rr) / 2);
  geo.computeVertexNormals();
  return geo;
}

export function cyl(rTop: number, rBot: number, h: number, seg = 20): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg);
}

export function ball(r: number, seg = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7)));
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/** Crate parts into an existing builder (to merge many crates into one prop). */
export function addCrate(b: PropBuilder, size: number, color: PropColor, seed: number, at: readonly [number, number, number], yaw = 0): void {
  const r = rng(seed);
  const slat = new THREE.Color(color).multiplyScalar(0.72);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const P = (x: number, y: number, z: number): [number, number, number] => [at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c];
  b.add(roundBox(size, size, size, 0.05), color, P(0, size / 2, 0), { rot: [0, yaw, 0] });
  for (const f of [-1, 1]) {
    for (const side of [-1, 1]) {
      b.add(roundBox(size * 1.02, size * 0.14, size * 0.06, 0.02), slat, P(0, size * (0.5 + side * 0.32), f * size * 0.5), { rot: [0, yaw, 0] });
      b.add(roundBox(size * 0.14, size * 1.02, size * 0.06, 0.02), slat, P(side * size * 0.36, size / 2, f * size * 0.5), { rot: [0, yaw, 0] });
    }
    b.add(roundBox(size * 1.2, size * 0.12, size * 0.06, 0.02), slat, P(0, size / 2, f * size * 0.5), { rot: [0, yaw, (Math.PI / 4) * (r() < 0.5 ? 1 : -1)] });
  }
}

/** Wooden crate with slats. */
export function crate(size = 0.9, color: PropColor = POP.wood, seed = 1): THREE.Group {
  const b = new PropBuilder();
  addCrate(b, size, color, seed, [0, 0, 0], 0);
  return b.build('prop:crate');
}

/** Gift box parts into a builder. */
export function addGift(b: PropBuilder, size: number, color: PropColor, ribbon: PropColor, at: readonly [number, number, number] = [0, 0, 0]): void {
  const [x, y, z] = at;
  b.add(roundBox(size, size * 0.82, size, 0.06), color, [x, y + size * 0.41, z]);
  b.add(roundBox(size * 1.08, size * 0.2, size * 1.08, 0.05), color, [x, y + size * 0.86, z]);
  b.add(roundBox(size * 0.18, size * 0.92, size * 1.1, 0.03), ribbon, [x, y + size * 0.47, z]);
  b.add(roundBox(size * 1.1, size * 0.92, size * 0.18, 0.03), ribbon, [x, y + size * 0.47, z]);
  b.add(new THREE.TorusGeometry(size * 0.16, size * 0.055, 8, 18), ribbon, [x - size * 0.15, y + size * 1.07, z], { rot: [0, 0, 0.6], scale: [1, 1, 0.6] });
  b.add(new THREE.TorusGeometry(size * 0.16, size * 0.055, 8, 18), ribbon, [x + size * 0.15, y + size * 1.07, z], { rot: [0, 0, -0.6], scale: [1, 1, 0.6] });
  b.add(ball(size * 0.08), ribbon, [x, y + size * 0.98, z]);
}

/** Wrapped gift box (locked hats): pastel box, ribbon cross and a floppy bow. */
export function giftBox(size = 0.8, color: PropColor = POP.grape, ribbon: PropColor = POP.sun): THREE.Group {
  const b = new PropBuilder();
  addGift(b, size, color, ribbon);
  return b.build('prop:gift');
}

/** Hand wrench (attached to a raccoon paw for "설정"). */
export function wrench(len = 0.42): THREE.Group {
  const b = new PropBuilder();
  b.add(roundBox(len, len * 0.13, len * 0.08, 0.02), POP.steel, [len / 2, 0, 0]);
  b.add(new THREE.TorusGeometry(len * 0.13, len * 0.055, 6, 14, Math.PI * 1.4), POP.steel, [len + len * 0.06, 0, 0], { rot: [0, 0, -Math.PI * 0.2] });
  b.add(roundBox(len * 0.4, len * 0.15, len * 0.1, 0.02), POP.tomato, [len * 0.2, 0, 0]);
  return b.build('prop:wrench', { castShadow: false });
}

let bulbVC: THREE.MeshBasicMaterial | null = null;
function bulbVCMaterial(): THREE.MeshBasicMaterial {
  if (!bulbVC) {
    bulbVC = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    bulbVC.name = 'menu3d:bulbs';
  }
  return bulbVC;
}

export interface StringLights {
  group: THREE.Group;
  twinkle: (t: number) => void;
  dispose: () => void;
}

/**
 * Strings of party bulbs between point pairs (catenary sag). Wires are one baked prop; all bulbs
 * are one unlit vertex-coloured mesh whose colours twinkle via `twinkle(t)`.
 */
export function stringLights(spans: readonly { a: THREE.Vector3; b: THREE.Vector3; count?: number; sag?: number }[]): StringLights {
  const wires = new PropBuilder();
  const bulbGeos: THREE.BufferGeometry[] = [];
  const cols = [POP.sun, POP.tomato, POP.mint, POP.sky, POP.pink];
  const base: THREE.Color[] = [];
  const counts: number[] = [];
  let k = 0;
  for (const sp of spans) {
    const count = sp.count ?? 12;
    const sag = sp.sag ?? 0.6;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const p = sp.a.clone().lerp(sp.b, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      pts.push(p);
    }
    wires.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.018, 5, false), POP.ink);
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const p = sp.a.clone().lerp(sp.b, t);
      p.y -= Math.sin(t * Math.PI) * sag + 0.1;
      const g = new THREE.SphereGeometry(0.08, 8, 6).toNonIndexed();
      g.deleteAttribute('uv');
      g.translate(p.x, p.y, p.z);
      const c = new THREE.Color(cols[k++ % cols.length]!).lerp(new THREE.Color('#FFFFFF'), 0.2);
      base.push(c);
      counts.push(g.attributes.position.count);
      bulbGeos.push(g);
    }
  }
  const group = wires.build('prop:lightWires', { outline: false, castShadow: false });
  const merged = mergeGeometries(bulbGeos, false)!;
  for (const g of bulbGeos) g.dispose();
  const colArr = new Float32Array(merged.attributes.position.count * 3);
  merged.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const bulbs = new THREE.Mesh(merged, bulbVCMaterial());
  bulbs.name = 'prop:bulbs';
  bulbs.userData.noOutline = true;
  bulbs.userData.noBatch = true;
  group.add(bulbs);
  const tmp = new THREE.Color();
  const twinkle = (t: number): void => {
    let v = 0;
    for (let i = 0; i < base.length; i++) {
      const on = 0.6 + 0.4 * Math.max(0, Math.sin(t * 2.6 + i * 1.9));
      tmp.copy(base[i]!).multiplyScalar(on);
      for (let j = 0; j < counts[i]!; j++, v++) {
        colArr[v * 3] = tmp.r;
        colArr[v * 3 + 1] = tmp.g;
        colArr[v * 3 + 2] = tmp.b;
      }
    }
    (merged.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  };
  twinkle(0);
  return {
    group,
    twinkle,
    dispose: () => {
      merged.dispose();
      disposeProp(group);
    },
  };
}

/**
 * Gradient sky dome (dusk): deep violet at the top, warm peach at the horizon and twinkling
 * stars. One draw call. `colors` = [zenith, mid, horizon].
 */
export function skyDome(colors: readonly [string, string, string] = ['#2B1F5C', '#7A4A9E', '#FFB38A'], radius = 120): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(colors[0]) },
      uMid: { value: new THREE.Color(colors[1]) },
      uBot: { value: new THREE.Color(colors[2]) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform float uTime;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y, -0.3, 1.0);
        vec3 c = mix(uBot, uMid, smoothstep(-0.12, 0.12, h));
        c = mix(c, uTop, smoothstep(0.1, 0.5, h));
        vec2 uv = vec2(atan(vDir.z, vDir.x) * 38.0, asin(clamp(vDir.y, -1.0, 1.0)) * 38.0);
        vec2 cell = floor(uv);
        float r = hash(cell);
        vec2 f = fract(uv) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
        float star = step(0.93, r) * smoothstep(0.09, 0.0, length(f)) * smoothstep(0.08, 0.35, h);
        star *= 0.55 + 0.45 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
        c += vec3(1.0, 0.95, 0.85) * star;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  mat.name = 'menu3d:sky';
  const m = new THREE.Mesh(geo, mat);
  m.name = 'menu3d:sky';
  m.frustumCulled = false;
  m.renderOrder = -10;
  m.userData.noBatch = true;
  return m;
}

/**
 * A big gingham tablecloth (canvas texture, one draw call) for the toy dioramas to sit on, with
 * a soft vignette baked in so the edges fall off into the backdrop.
 */
export function tablecloth(size: number, base = '#4B2F86', stripe = '#6A48AE', repeat = 14): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = base;
    g.fillRect(0, 0, 64, 64);
    g.globalAlpha = 0.55;
    g.fillStyle = stripe;
    g.fillRect(0, 0, 32, 64);
    g.fillRect(0, 0, 64, 32);
    g.globalAlpha = 0.35;
    g.fillRect(0, 0, 32, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uRepeat: { value: repeat } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform sampler2D map; uniform float uRepeat; varying vec2 vUv;
      void main() { vec4 c = texture2D(map, vUv * uRepeat); float d = distance(vUv, vec2(0.5)) * 2.0;
      float v = mix(1.0, 0.35, smoothstep(0.25, 1.0, d)); gl_FragColor = vec4(c.rgb * v, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = -Math.PI / 2;
  m.name = 'tablecloth';
  m.userData.noBatch = true;
  m.userData.noOutline = true;
  return m;
}

/** Dispose a tablecloth (geometry, material, texture). */
export function disposeTablecloth(m: THREE.Mesh): void {
  const mat = m.material as THREE.ShaderMaterial;
  (mat.uniforms.map?.value as THREE.Texture | undefined)?.dispose();
  mat.dispose();
  m.geometry.dispose();
  m.removeFromParent();
}

/** Soft radial glow disc on the ground (additive), e.g. under lamps or spotlights. */
export function glowDisc(radius: number, color: PropColor, opacity = 0.5): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 32).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main() { float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(uColor * a * a * uOpacity, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.userData.noBatch = true;
  m.userData.noOutline = true;
  m.renderOrder = 2;
  return m;
}

/** Volumetric-looking spotlight cone (additive, fades toward the floor). Apex at the origin. */
export function spotCone(height: number, radius: number, color: PropColor = '#FFF1C8', opacity = 0.35): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius * 0.12, radius, height, 28, 1, true);
  geo.translate(0, -height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uH: { value: height } },
    vertexShader: /* glsl */ `varying float vY; varying vec3 vN; varying vec3 vV;
      void main() { vY = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; uniform float uH; varying float vY; varying vec3 vN; varying vec3 vV;
      void main() { float k = clamp(-vY / uH, 0.0, 1.0); float edge = pow(abs(dot(vN, vV)), 1.2);
      float a = edge * mix(1.0, 0.3, k) * uOpacity; gl_FragColor = vec4(uColor * a, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.userData.noBatch = true;
  m.userData.noOutline = true;
  m.renderOrder = 3;
  return m;
}

/** Set the opacity uniform of a glowDisc / spotCone. */
export function setGlow(m: THREE.Mesh, opacity: number): void {
  const u = (m.material as THREE.ShaderMaterial).uniforms?.uOpacity;
  if (u) u.value = opacity;
}

/** Dispose a self-owned (non-cached) mesh: geometry + material. */
export function disposeOwnedMesh(m: THREE.Mesh): void {
  m.geometry.dispose();
  const mat = m.material;
  if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
  else mat.dispose();
  m.removeFromParent();
}

/**
 * Floating toy diorama island: paved top with a grass rim, a chunky soil skirt and dangling
 * roots underneath (the game's "uprooted" motif). Top surface at y = 0.
 */
export function dioramaIsland(radius = 8.5, o: { top?: PropColor; rim?: PropColor; seed?: number; depth?: number } = {}): THREE.Group {
  const b = new PropBuilder();
  addIsland(b, radius, o);
  return b.build('prop:island');
}

export function addIsland(b: PropBuilder, radius: number, o: { top?: PropColor; rim?: PropColor; seed?: number; depth?: number } = {}): void {
  const depth = o.depth ?? 1.7;
  const r = rng(o.seed ?? 3);
  b.add(cyl(radius, radius, 0.22, 64), o.top ?? POP.paving, [0, -0.11, 0]);
  b.add(cyl(radius + 0.32, radius + 0.32, 0.3, 64), o.rim ?? POP.grass, [0, -0.2, 0]);
  b.add(cyl(radius + 0.28, radius * 0.86, depth * 0.55, 48), POP.soil, [0, -0.35 - depth * 0.275, 0]);
  b.add(cyl(radius * 0.86, radius * 0.45, depth * 0.45, 40), POP.soilDark, [0, -0.35 - depth * 0.55 - depth * 0.225, 0]);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + r() * 0.3;
    const rr = radius + 0.2 - r() * 0.2;
    b.add(ball(0.12 + r() * 0.1, 8), r() < 0.5 ? '#B98A62' : '#7E5A3C', [Math.cos(a) * rr, -0.55 - r() * 0.6, Math.sin(a) * rr]);
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.4;
    const start = new THREE.Vector3(Math.cos(a) * radius * 0.6, -0.35 - depth * 0.7, Math.sin(a) * radius * 0.6);
    const pts = [start];
    let p = start.clone();
    for (let k = 0; k < 4; k++) {
      p = p.clone().add(new THREE.Vector3((r() - 0.5) * 0.9 - Math.cos(a) * 0.25, -0.45 - r() * 0.4, (r() - 0.5) * 0.9 - Math.sin(a) * 0.25));
      pts.push(p);
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.09 + r() * 0.05, 6, false), i % 2 ? POP.soil : '#B07A4E');
  }
}

/** Simple rope between two world points (a scaled unit cylinder; call setRope each frame). */
export function rope(color: PropColor = '#E9D6B0', radius = 0.045): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, 1, 8, 1);
  geo.translate(0, 0.5, 0);
  const m = new THREE.Mesh(geo, matColor(color, 0.3));
  m.castShadow = true;
  return m;
}

/** Free a rope (its own geometry; the material is shared). */
export function disposeRope(m: THREE.Mesh): void {
  m.geometry.dispose();
  m.removeFromParent();
}

const up = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();
export function setRope(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  dir.copy(b).sub(a);
  const len = dir.length();
  m.position.copy(a);
  m.scale.set(1, Math.max(0.001, len), 1);
  if (len > 1e-4) m.quaternion.setFromUnitVectors(up, dir.divideScalar(len));
}

let shadowMat: THREE.MeshBasicMaterial | null = null;
let shadowTex: THREE.CanvasTexture | null = null;
/** Soft contact shadow decal (no shadow maps in the menus): a blurred dark ellipse on the floor. */
export function contactShadow(w: number, d: number, opacity = 0.32): THREE.Mesh {
  if (!shadowMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(40,20,60,1)');
    g.addColorStop(0.55, 'rgba(40,20,60,0.7)');
    g.addColorStop(1, 'rgba(40,20,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    shadowTex = new THREE.CanvasTexture(c);
    shadowTex.colorSpace = THREE.SRGBColorSpace;
    shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    shadowMat.name = 'menu3d:contactShadow';
  }
  const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, shadowMat);
  m.name = 'menu3d:shadow';
  m.position.y = 0.02;
  m.userData.noOutline = true;
  m.renderOrder = -1;
  return m;
}

/** The shared contact-shadow material (to allow batching it). */
export function contactShadowMaterial(): THREE.Material | null {
  return shadowMat;
}
