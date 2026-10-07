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

/** Pop sky look: sunburst rays, ink-outlined toy clouds and stars on top of the gradient. */
export interface SkyStyle {
  /** Sunburst ray colour (null = no rays). */
  rays?: string | null;
  /** Ray strength 0..1 (default 0.35). */
  rayStrength?: number;
  /** Number of ray pairs around the burst (default 14). */
  rayCount?: number;
  /** Height of the burst centre above the horizon (default 0.05). */
  rayCenterY?: number;
  /** Puffy cloud fill colour (null = no clouds). Clouds get the ink outline. */
  clouds?: string | null;
  /** Height band of the cloud centres above the horizon (default [0.1, 0.38]). */
  cloudY?: readonly [number, number];
  /** Star amount 0..1 (default 1). */
  stars?: number;
}

/**
 * Gradient sky dome: [zenith, mid, horizon] gradient with optional sunburst rays (slowly
 * turning, toy-box poster style), a ring of ink-outlined puffy clouds and twinkling stars.
 * One draw call.
 */
export function skyDome(colors: readonly [string, string, string] = ['#2B1F5C', '#7A4A9E', '#FFB38A'], radius = 120, style: SkyStyle = {}): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(colors[0]) },
      uMid: { value: new THREE.Color(colors[1]) },
      uBot: { value: new THREE.Color(colors[2]) },
      uRay: { value: new THREE.Color(style.rays ?? '#FFFFFF') },
      uRayK: { value: style.rays ? (style.rayStrength ?? 0.35) : 0 },
      uRayN: { value: style.rayCount ?? 14 },
      uRayY: { value: style.rayCenterY ?? 0.05 },
      uCloud: { value: new THREE.Color(style.clouds ?? '#FFFFFF') },
      uCloudK: { value: style.clouds ? 1 : 0 },
      uCloudY: { value: new THREE.Vector2(style.cloudY?.[0] ?? 0.1, style.cloudY?.[1] ?? 0.38) },
      uInk: { value: new THREE.Color(POP.ink) },
      uStars: { value: style.stars ?? 1 },
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
      uniform vec3 uRay; uniform float uRayK; uniform float uRayN; uniform float uRayY;
      uniform vec3 uCloud; uniform float uCloudK; uniform vec2 uCloudY; uniform vec3 uInk; uniform float uStars;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y, -0.3, 1.0);
        vec3 c = mix(uBot, uMid, smoothstep(-0.12, 0.16, h));
        c = mix(c, uTop, smoothstep(0.12, 0.6, h));
        // azimuth: 0 straight ahead of the menu cameras (-Z)
        float az = atan(vDir.x, -vDir.z);
        // sunburst rays fanning out from a point just above the horizon
        if (uRayK > 0.0) {
          vec2 q = vec2(az, h - uRayY);
          float ang = atan(q.y, q.x) / 6.2831853;
          float band = fract(ang * uRayN * 2.0 + uTime * 0.012);
          float edge = smoothstep(0.0, 0.03, band) * (1.0 - smoothstep(0.47, 0.5, band));
          float fall = (1.0 - smoothstep(0.05, 1.6, length(q * vec2(0.8, 1.6)))) * smoothstep(-0.06, 0.02, h);
          c = mix(c, uRay, edge * fall * uRayK);
          // soft sun glow at the burst centre
          c = mix(c, uRay, (1.0 - smoothstep(0.0, 0.42, length(q * vec2(1.0, 1.8)))) * uRayK * 0.9);
        }
        // stars (only where the sky is high)
        vec2 uv = vec2(az * 38.0, asin(clamp(vDir.y, -1.0, 1.0)) * 38.0);
        vec2 cell = floor(uv);
        float r = hash(cell);
        vec2 f = fract(uv) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
        float star = step(0.94, r) * (1.0 - smoothstep(0.0, 0.09, length(f))) * smoothstep(0.3, 0.6, h) * uStars;
        star *= 0.55 + 0.45 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
        c += vec3(1.0, 0.95, 0.85) * star;
        // toy clouds: clusters of round puffs with a flat bottom and an ink outline, drifting
        if (uCloudK > 0.0) {
          float x = az * 6.0 + uTime * 0.02;
          float id = floor(x);
          float best = 1e3;
          float cyShade = 0.0;
          for (int k = -1; k <= 1; k++) {
            float cid = id + float(k);
            float present = step(0.45, hash(vec2(cid, 1.7)));
            float cx = cid + 0.5 + (hash(vec2(cid, 4.2)) - 0.5) * 0.4;
            float cy = mix(uCloudY.x, uCloudY.y, hash(vec2(cid, 9.1)));
            float w = 0.075 + hash(vec2(cid, 2.3)) * 0.05;
            vec2 d = vec2((x - cx) / 6.0, h - cy);
            // three puffs + flat base
            float s = length(d - vec2(-w * 0.45, 0.0)) - w * 0.42;
            s = min(s, length(d - vec2(0.0, w * 0.25)) - w * 0.55);
            s = min(s, length(d - vec2(w * 0.5, 0.02)) - w * 0.38);
            s = max(s, -(d.y + w * 0.18));
            s = mix(1e3, s, present);
            if (s < best) { best = s; cyShade = cy - w * 0.05; }
          }
          float fill = 1.0 - smoothstep(-0.0015, 0.0015, best);
          float line = (1.0 - smoothstep(0.006, 0.0085, best)) * (1.0 - fill);
          vec3 cc = mix(uCloud * 0.88, uCloud, smoothstep(cyShade - 0.02, cyShade + 0.03, h));
          c = mix(c, cc, fill * uCloudK);
          c = mix(c, uInk, line * uCloudK * 0.85);
        }
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
  const one = (x: THREE.Material): void => {
    (x as THREE.MeshBasicMaterial).map?.dispose();
    x.dispose();
  };
  if (Array.isArray(mat)) mat.forEach(one);
  else one(mat);
  m.removeFromParent();
}

/**
 * Painted mirror glass (one unlit textured quad): a sky-blue reflection gradient with a warm
 * horizon glow, two diagonal shine streaks and a little star sticker in the corner, so a mirror
 * reads as a mirror instead of a blank slab. Rounded corners are cut by alpha. Faces +Z.
 */
export function mirrorGlass(w: number, h: number, o: { top?: string; bottom?: string; glow?: string; sticker?: string } = {}): THREE.Mesh {
  const W = 128;
  const H = Math.max(32, Math.round((128 * h) / w));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (g) {
    const rad = Math.min(W, H) * 0.22;
    g.beginPath();
    g.moveTo(rad, 0);
    g.arcTo(W, 0, W, H, rad);
    g.arcTo(W, H, 0, H, rad);
    g.arcTo(0, H, 0, 0, rad);
    g.arcTo(0, 0, W, 0, rad);
    g.closePath();
    g.save();
    g.clip();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, o.top ?? '#8FD0FF');
    grad.addColorStop(0.62, o.bottom ?? '#E3F5FF');
    grad.addColorStop(0.78, o.glow ?? '#FFD9B8');
    grad.addColorStop(1, o.bottom ?? '#E3F5FF');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // diagonal shine streaks
    g.fillStyle = 'rgba(255,255,255,0.78)';
    const streak = (x0: number, wd: number): void => {
      g.beginPath();
      g.moveTo(x0, H);
      g.lineTo(x0 + wd, H);
      g.lineTo(x0 + wd + H * 0.55, 0);
      g.lineTo(x0 + H * 0.55, 0);
      g.closePath();
      g.fill();
    };
    streak(-H * 0.32 + W * 0.18, W * 0.16);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    streak(-H * 0.32 + W * 0.42, W * 0.06);
    g.restore();
    // star sticker (bottom-right corner) with an ink rim
    const sx = W * 0.8;
    const sy = H - W * 0.2;
    const R = W * 0.1;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? R * 0.48 : R;
      g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = o.sticker ?? POP.sun;
    g.strokeStyle = POP.ink;
    g.lineWidth = W * 0.022;
    g.lineJoin = 'round';
    g.fill();
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: false, alphaTest: 0.5, toneMapped: false, fog: false });
  mat.name = 'menu3d:mirror';
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.name = 'menu3d:mirror';
  m.userData.noBatch = true;
  m.userData.noOutline = true;
  return m;
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

// ---------------------------------------------------------------------------------------------
// Front door props (C10): rooftop marquee sign, squeaky toy hammer, big red button
// ---------------------------------------------------------------------------------------------

/**
 * Canvas texture for the marquee face: the wordmark in chunky sun-yellow letters with an ink
 * outline and a stacked hard shadow, a tomato ribbon with the English name, on a dotted plum
 * panel. Redraws once the Jua glyphs are loaded (the canvas falls back to the font stack first).
 */
export function marqueeTexture(title: string, sub: string, o: { width?: number; height?: number } = {}): THREE.CanvasTexture {
  const W = o.width ?? 1024;
  const H = o.height ?? 420;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const stack = '"Jua", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const draw = (): void => {
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#4A3590');
    bg.addColorStop(1, '#2B1F5C');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // dot grid (marquee panel)
    g.fillStyle = 'rgba(255, 246, 230, 0.07)';
    for (let y = 14; y < H; y += 26) for (let x = 14 + ((y / 26) % 2) * 13; x < W; x += 26) g.fillRect(x - 2.5, y - 2.5, 5, 5);
    // warm glow behind the letters
    const glow = g.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.42, W * 0.55);
    glow.addColorStop(0, 'rgba(255, 196, 92, 0.38)');
    glow.addColorStop(1, 'rgba(255, 196, 92, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    // wordmark: each syllable tilted a little differently, like stuck-on sign letters
    const chars = Array.from(title);
    let size = Math.round(H * 0.5);
    g.font = `${size}px ${stack}`;
    const measure = (): number => chars.reduce((s, ch) => s + (ch === ' ' ? size * 0.28 : g.measureText(ch).width * 1.02), 0);
    while (measure() > W * 0.9 && size > 40) {
      size -= 4;
      g.font = `${size}px ${stack}`;
    }
    const total = measure();
    let x = (W - total) / 2;
    const baseY = H * 0.6;
    const tilts = [-0.08, 0.05, -0.03, 0, 0.06, -0.05, 0.04];
    const lifts = [0, -0.04, 0.02, 0, -0.03, 0.03, -0.02];
    g.lineJoin = 'round';
    g.textBaseline = 'alphabetic';
    chars.forEach((ch, i) => {
      if (ch === ' ') {
        x += size * 0.28;
        return;
      }
      const w = g.measureText(ch).width * 1.02;
      g.save();
      g.translate(x + w / 2, baseY + lifts[i % lifts.length]! * size);
      g.rotate(tilts[i % tilts.length]!);
      // stacked hard shadow
      g.fillStyle = POP.ink;
      for (let k = 4; k >= 1; k--) g.fillText(ch, -w / 2 + k * size * 0.022, k * size * 0.03);
      g.lineWidth = size * 0.16;
      g.strokeStyle = POP.ink;
      g.strokeText(ch, -w / 2, 0);
      g.fillStyle = i % 4 === 1 ? '#FFB21E' : i >= chars.indexOf(' ') && chars.indexOf(' ') > 0 ? POP.cream : POP.sun;
      g.fillText(ch, -w / 2, 0);
      // little shine on top of each letter
      g.globalAlpha = 0.35;
      g.fillStyle = '#FFFFFF';
      g.fillRect(-w * 0.32, -size * 0.66, w * 0.18, size * 0.07);
      g.globalAlpha = 1;
      g.restore();
      x += w;
    });
    // ribbon
    const rw = W * 0.5;
    const rh = H * 0.17;
    const rx = (W - rw) / 2;
    const ry = H * 0.73;
    g.save();
    g.translate(W / 2, ry + rh / 2);
    g.rotate(-0.025);
    g.translate(-W / 2, -(ry + rh / 2));
    g.fillStyle = POP.ink;
    g.beginPath();
    g.moveTo(rx - 26, ry + 8);
    g.lineTo(rx + rw + 26, ry + 8);
    g.lineTo(rx + rw + 8, ry + rh / 2 + 8);
    g.lineTo(rx + rw + 26, ry + rh + 8);
    g.lineTo(rx - 26, ry + rh + 8);
    g.lineTo(rx - 8, ry + rh / 2 + 8);
    g.closePath();
    g.fill();
    g.fillStyle = POP.tomato;
    g.strokeStyle = POP.ink;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(rx - 30, ry);
    g.lineTo(rx + rw + 30, ry);
    g.lineTo(rx + rw + 12, ry + rh / 2);
    g.lineTo(rx + rw + 30, ry + rh);
    g.lineTo(rx - 30, ry + rh);
    g.lineTo(rx - 12, ry + rh / 2);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = POP.cream;
    g.font = `${Math.round(rh * 0.62)}px ${stack}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const spaced = Array.from(sub).join(' ');
    g.fillText(spaced, W / 2, ry + rh * 0.54);
    g.restore();
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts
      .load(`64px "Jua"`, title + sub)
      .then((faces) => {
        if (!faces.length) return;
        draw();
        tex.needsUpdate = true;
      })
      .catch(() => undefined);
  }
  return tex;
}

export interface MarqueeSign {
  /** Root (origin on the roof between the legs; the face looks down +Z). */
  readonly group: THREE.Group;
  /** The lit face quad (screen bounds are measured from it). */
  readonly face: THREE.Mesh;
  /** Pivot the little hanging safe swings from (scene attaches a safe rig to it). */
  readonly safePivot: THREE.Group;
  /** Animate the bulb chase (t = seconds; `flash` 0..1 lights every bulb at once). */
  update(t: number, reducedMotion: boolean, flash?: number): void;
  dispose(): void;
}

/**
 * Rooftop marquee billboard for the front door: a tomato cabinet with the wordmark face
 * (`marqueeTexture`), a ring of chasing bulbs, lattice legs, a fringe of roots dangling from the
 * bottom edge (the "뿌리째" motif) and a pivot for a small safe swinging on two chains.
 * Bulbs are one unlit vertex-coloured mesh (one draw call); the cabinet, legs and roots are one
 * baked prop. Reduced motion: the bulbs glow steadily (no chase).
 */
export function marqueeSign(tex: THREE.Texture, o: { width?: number; height?: number; legHeight?: number } = {}): MarqueeSign {
  const W = o.width ?? 7.2;
  const H = o.height ?? 2.95;
  const legH = o.legHeight ?? 1.9;
  const cy = legH + H / 2;
  const r = rng(77);
  const b = new PropBuilder();
  // cabinet + inner recess + top crest
  b.add(roundBox(W + 0.62, H + 0.62, 0.42, 0.14), POP.tomato, [0, cy, 0]);
  b.add(roundBox(W + 0.18, H + 0.18, 0.12, 0.05), POP.ink, [0, cy, 0.2]);
  b.add(roundBox(W * 0.34, 0.36, 0.3, 0.12), POP.sun, [0, cy + H / 2 + 0.38, 0.02]);
  b.add(roundBox(W * 0.34 + 0.12, 0.12, 0.34, 0.05), POP.sunDark, [0, cy + H / 2 + 0.2, 0.02]);
  // lattice legs (two A-frames) + braces
  for (const sx of [-1, 1]) {
    const x = sx * W * 0.3;
    for (const dz of [-0.45, 0.25]) b.add(cyl(0.07, 0.08, legH + 0.3, 8), POP.steelDark, [x, (legH + 0.3) / 2, dz - 0.1]);
    for (let k = 0; k < 3; k++) {
      const y = 0.35 + k * 0.55;
      b.add(roundBox(0.06, 0.06, 0.78, 0.02), POP.steel, [x, y, -0.2], { rot: [k % 2 ? 0.55 : -0.55, 0, 0] });
    }
    b.add(roundBox(0.5, 0.12, 0.9, 0.04), POP.steelDark, [x, 0.06, -0.15]);
  }
  b.add(roundBox(W * 0.62, 0.08, 0.08, 0.02), POP.steel, [0, legH * 0.55, -0.42]);
  // soil lip + roots dangling from the bottom edge
  const by = cy - H / 2 - 0.3;
  for (let i = 0; i < 9; i++) {
    const x = -W / 2 + 0.3 + (i / 8) * (W - 0.6) + (r() - 0.5) * 0.2;
    b.add(ball(0.2 + r() * 0.14, 9), i % 2 ? POP.soil : POP.soilDark, [x, by + 0.05, 0.08 + r() * 0.1], { scale: [1.5, 0.8, 1] });
  }
  const rootXs = [-0.44, -0.33, -0.2, -0.06, 0.07, 0.17];
  rootXs.forEach((fx, i) => {
    const start = new THREE.Vector3(fx * W, by, 0.12);
    const pts = [start];
    let p = start.clone();
    const len = 3 + Math.floor(r() * 2);
    for (let k = 0; k < len; k++) {
      p = p.clone().add(new THREE.Vector3((r() - 0.5) * 0.36, -0.22 - r() * 0.18, (r() - 0.5) * 0.12 + 0.03));
      pts.push(p);
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.055 + r() * 0.03, 6, false), i % 2 ? '#B9774A' : '#9C6440');
    // a hair root off the side
    const mid = pts[Math.min(2, pts.length - 1)]!;
    const side = [mid, mid.clone().add(new THREE.Vector3(r() < 0.5 ? -0.22 : 0.22, -0.12, 0.02)), mid.clone().add(new THREE.Vector3(r() < 0.5 ? -0.3 : 0.3, -0.3, 0.04))];
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(side), 8, 0.03, 5, false), '#C98B55');
  });
  // hook bar for the swinging safe
  const hookX = W * 0.33;
  b.add(roundBox(0.9, 0.1, 0.1, 0.03), POP.steelDark, [hookX, by + 0.02, 0.18]);
  const group = b.build('prop:marquee');

  // lit face
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false });
  faceMat.name = 'menu3d:marqueeFace';
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), faceMat);
  face.name = 'menu3d:marqueeFace';
  face.position.set(0, cy, 0.27);
  face.userData.noBatch = true;
  face.userData.noOutline = true;
  group.add(face);

  // bulbs around the cabinet rim (front face), clockwise from the top-left corner
  const bulbGeos: THREE.BufferGeometry[] = [];
  const counts: number[] = [];
  const hw = W / 2 + 0.16;
  const hh = H / 2 + 0.16;
  const per = 2 * (2 * hw + 2 * hh);
  const n = Math.round(per / 0.36);
  const pos = (s: number): [number, number] => {
    let d = s * per;
    if (d < 2 * hw) return [-hw + d, hh];
    d -= 2 * hw;
    if (d < 2 * hh) return [hw, hh - d];
    d -= 2 * hh;
    if (d < 2 * hw) return [hw - d, -hh];
    d -= 2 * hw;
    return [-hw, -hh + d];
  };
  for (let i = 0; i < n; i++) {
    const [x, y] = pos(i / n);
    const gb = new THREE.SphereGeometry(0.085, 8, 6).toNonIndexed();
    gb.deleteAttribute('uv');
    gb.translate(x, cy + y, 0.25);
    counts.push(gb.attributes.position.count);
    bulbGeos.push(gb);
  }
  const merged = mergeGeometries(bulbGeos, false)!;
  for (const gb of bulbGeos) gb.dispose();
  const colArr = new Float32Array(merged.attributes.position.count * 3);
  merged.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const bulbs = new THREE.Mesh(merged, bulbVCMaterial());
  bulbs.name = 'prop:marqueeBulbs';
  bulbs.userData.noOutline = true;
  bulbs.userData.noBatch = true;
  group.add(bulbs);
  const bright = new THREE.Color('#FFF1B8');
  const dim = new THREE.Color('#B9763A');
  const warm = new THREE.Color('#FFD36B');
  const tmp = new THREE.Color();
  let lastStep = -1;
  let lastFlash = -1;
  const update = (t: number, rm: boolean, flash = 0): void => {
    const step = rm ? 0 : Math.floor(t * 9);
    const fl = Math.round(flash * 20) / 20;
    if (step === lastStep && fl === lastFlash) return;
    lastStep = step;
    lastFlash = fl;
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (rm) tmp.copy(warm);
      else tmp.copy((i + step) % 3 === 0 ? bright : dim);
      if (fl > 0) tmp.lerp(bright, fl);
      for (let j = 0; j < counts[i]!; j++, v++) {
        colArr[v * 3] = tmp.r;
        colArr[v * 3 + 1] = tmp.g;
        colArr[v * 3 + 2] = tmp.b;
      }
    }
    (merged.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  };
  update(0, false);

  const safePivot = new THREE.Group();
  safePivot.name = 'menu3d:marqueeSafePivot';
  safePivot.position.set(hookX, by, 0.2);
  group.add(safePivot);

  return {
    group,
    face,
    safePivot,
    update,
    dispose: () => {
      merged.dispose();
      face.geometry.dispose();
      faceMat.dispose();
      tex.dispose();
      disposeProp(group);
    },
  };
}

/**
 * 뿅망치 (squeaky toy hammer): a fat accordion head (alternating tomato / sun pleats between two
 * cream bumpers) on a chunky striped handle. Original shape: the head is a squat bellows drum,
 * not a mallet from any game. Grip at the origin, handle along +Y, head axis along X.
 */
export function squeakyHammer(len = 0.62, o: { gold?: boolean } = {}): THREE.Group {
  const b = new PropBuilder();
  const gold = o.gold === true;
  const a = gold ? '#FFC21F' : POP.tomato;
  const c2 = gold ? '#FFE88A' : POP.sun;
  const cap = gold ? '#FFF1B8' : POP.cream;
  const handle = gold ? '#E0A417' : POP.sun;
  const hr = len * 0.07;
  b.add(cyl(hr, hr * 1.1, len, 10), handle, [0, len / 2, 0]);
  for (let k = 0; k < 3; k++) b.add(cyl(hr * 1.18, hr * 1.18, len * 0.06, 10), a, [0, len * (0.12 + k * 0.11), 0]);
  b.add(ball(hr * 1.4, 10), a, [0, 0, 0]);
  const headR = len * 0.26;
  const headL = len * 0.62;
  const pleats = 7;
  for (let k = 0; k < pleats; k++) {
    const x = -headL / 2 + (k + 0.5) * (headL / pleats);
    const rr = headR * (k % 2 ? 0.88 : 1);
    b.add(cyl(rr, rr, headL / pleats + 0.004, 18), k % 2 ? c2 : a, [x, len + headR * 0.6, 0], { rot: [0, 0, Math.PI / 2] });
  }
  for (const sx of [-1, 1]) {
    b.add(cyl(headR * 1.05, headR * 1.05, len * 0.07, 20), cap, [sx * (headL / 2 + len * 0.035), len + headR * 0.6, 0], { rot: [0, 0, Math.PI / 2] });
    b.add(cyl(headR * 0.45, headR * 0.45, len * 0.03, 14), a, [sx * (headL / 2 + len * 0.075), len + headR * 0.6, 0], { rot: [0, 0, Math.PI / 2] });
  }
  return b.build(gold ? 'prop:goldHammer' : 'prop:squeakyHammer', { castShadow: false });
}

export interface BigButton {
  readonly group: THREE.Group;
  /** The red cap (scaled for the press squash). */
  readonly cap: THREE.Group;
  dispose(): void;
}

/** Big red arcade-style push button on a steel pedestal plate (snack-table safe "GO" button). */
export function bigRedButton(size = 0.42): BigButton {
  const base = new PropBuilder();
  base.add(roundBox(size * 1.5, size * 0.18, size * 1.5, 0.04), POP.steel, [0, size * 0.09, 0]);
  base.add(cyl(size * 0.62, size * 0.68, size * 0.18, 20), POP.ink, [0, size * 0.26, 0]);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) base.add(ball(size * 0.06, 6), POP.steelDark, [x * size * 0.6, size * 0.19, z * size * 0.6]);
  const group = base.build('prop:bigButton');
  const capB = new PropBuilder();
  capB.add(cyl(size * 0.5, size * 0.55, size * 0.22, 22), POP.tomato, [0, size * 0.11, 0]);
  capB.add(ball(size * 0.5, 18), POP.tomato, [0, size * 0.2, 0], { scale: [1, 0.45, 1] });
  capB.add(ball(size * 0.14, 8), '#FFB0A8', [-size * 0.18, size * 0.36, -size * 0.12], { scale: [1, 0.4, 1] });
  const cap = capB.build('prop:bigButtonCap');
  cap.position.y = size * 0.34;
  group.add(cap);
  return {
    group,
    cap,
    dispose: () => {
      disposeProp(cap);
      disposeProp(group);
    },
  };
}
