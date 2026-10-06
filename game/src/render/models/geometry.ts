/**
 * Geometry helpers.
 *
 * PartBuilder is the workhorse: models are authored as many small primitives with a color
 * each, baked into vertex colors and merged per "bucket" (material) with
 * BufferGeometryUtils.mergeGeometries. A whole rigid part (a raccoon head with its hat,
 * a bank wall with its windows and decor, a 20 m chunk of scenery) becomes one draw call.
 *
 * Every geometry fed into a bucket is normalised to the same attribute layout:
 *   position(3) normal(3) uv(2) color(3) fx(2)   + an index
 * so any mix of primitives merges cleanly.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type V3 = readonly [number, number, number];

export interface PartOptions {
  color: THREE.ColorRepresentation;
  pos?: V3;
  rot?: V3;
  scale?: V3 | number;
  /** Emissive strength 0..~1.5 (self-lit at dusk). */
  emissive?: number;
  /** Wind sway weight 0..1. */
  sway?: number;
  bucket?: string;
  /** Remap the geometry's 0..1 uvs into this rect [u0, v0, u1, v1] (texture atlases). */
  uvRect?: readonly [number, number, number, number];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export function composeMatrix(pos?: V3, rot?: V3, scale?: V3 | number, out = new THREE.Matrix4()): THREE.Matrix4 {
  _p.set(pos?.[0] ?? 0, pos?.[1] ?? 0, pos?.[2] ?? 0);
  _e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0, 'XYZ');
  _q.setFromEuler(_e);
  if (typeof scale === 'number') _s.set(scale, scale, scale);
  else _s.set(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1);
  return out.compose(_p, _q, _s);
}

/**
 * Normalise a geometry for merging: clone, transform, ensure index/uv, add color + fx.
 * Unknown attributes (tangents, uv1...) are dropped.
 */
export function prepareGeometry(
  src: THREE.BufferGeometry,
  matrix: THREE.Matrix4 | null,
  color: THREE.ColorRepresentation,
  emissive = 0,
  sway = 0,
  uvRect?: readonly [number, number, number, number],
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.array as ArrayLike<number>), 3));
  const nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm.array as ArrayLike<number>), 3));
  const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const uvArr = new Float32Array(count * 2);
  if (uv) {
    const a = uv.array as ArrayLike<number>;
    for (let i = 0; i < count * 2; i++) uvArr[i] = a[i];
  }
  if (uvRect) {
    const [u0, v0, u1, v1] = uvRect;
    for (let i = 0; i < count; i++) {
      uvArr[i * 2] = u0 + uvArr[i * 2] * (u1 - u0);
      uvArr[i * 2 + 1] = v0 + uvArr[i * 2 + 1] * (v1 - v0);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  if (src.index) {
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array as ArrayLike<number>), 1));
  } else {
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!nrm) g.computeVertexNormals();
  if (matrix) g.applyMatrix4(matrix);
  // Mirrored transforms flip winding: fix it so front faces stay front faces.
  if (matrix && matrix.determinant() < 0) {
    const ia = g.index!.array as Uint32Array;
    for (let i = 0; i < ia.length; i += 3) {
      const t = ia[i + 1];
      ia[i + 1] = ia[i + 2];
      ia[i + 2] = t;
    }
  }
  _c.set(color);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const fx = new Float32Array(count * 2);
  if (emissive || sway) {
    for (let i = 0; i < count; i++) {
      fx[i * 2] = emissive;
      fx[i * 2 + 1] = sway;
    }
  }
  g.setAttribute('fx', new THREE.BufferAttribute(fx, 2));
  return g;
}

/** Collects colored primitives per bucket and merges them. Supports a transform stack. */
export class PartBuilder {
  private readonly buckets = new Map<string, THREE.BufferGeometry[]>();
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  /** Default bucket for add() calls that do not name one. */
  defaultBucket: string;

  constructor(defaultBucket = 'vc') {
    this.defaultBucket = defaultBucket;
  }

  get top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  /** Push a local transform (relative to the current one). */
  push(pos?: V3, rot?: V3, scale?: V3 | number): this {
    const local = composeMatrix(pos, rot, scale);
    this.stack.push(this.top.clone().multiply(local));
    return this;
  }

  pushMatrix(m: THREE.Matrix4): this {
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  add(geo: THREE.BufferGeometry, o: PartOptions): this {
    composeMatrix(o.pos, o.rot, o.scale, _m);
    const full = this.top.clone().multiply(_m);
    const g = prepareGeometry(geo, full, o.color, o.emissive ?? 0, o.sway ?? 0, o.uvRect);
    const key = o.bucket ?? this.defaultBucket;
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(g);
    return this;
  }

  /**
   * Add an already prepared geometry (has color + fx, e.g. from another builder's merge)
   * keeping its vertex attributes; only the transform is applied.
   */
  addPrepared(geo: THREE.BufferGeometry, o: { pos?: V3; rot?: V3; scale?: V3 | number; bucket?: string } = {}): this {
    composeMatrix(o.pos, o.rot, o.scale, _m);
    const full = this.top.clone().multiply(_m);
    const g = geo.clone();
    g.applyMatrix4(full);
    if (full.determinant() < 0 && g.index) {
      const ia = g.index.array as Uint32Array;
      for (let i = 0; i < ia.length; i += 3) {
        const t = ia[i + 1];
        ia[i + 1] = ia[i + 2];
        ia[i + 2] = t;
      }
    }
    const key = o.bucket ?? this.defaultBucket;
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(g);
    return this;
  }

  /** Move another builder's parts into this one (applying the current transform). */
  absorb(other: PartBuilder): this {
    for (const [key, list] of other.buckets) {
      let mine = this.buckets.get(key);
      if (!mine) this.buckets.set(key, (mine = []));
      for (const g of list) {
        const c = g.clone();
        c.applyMatrix4(this.top);
        mine.push(c);
      }
    }
    return this;
  }

  bucketNames(): string[] {
    return [...this.buckets.keys()];
  }

  isEmpty(): boolean {
    for (const l of this.buckets.values()) if (l.length) return false;
    return true;
  }

  /** Merge one bucket (null when empty). Consumes nothing; call once per bucket. */
  merge(bucket: string): THREE.BufferGeometry | null {
    const list = this.buckets.get(bucket);
    if (!list || list.length === 0) return null;
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) throw new Error(`PartBuilder: merge failed for bucket "${bucket}"`);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  /** Merge all buckets into meshes using `materialFor(bucket)`. */
  build(
    materialFor: (bucket: string) => THREE.Material,
    o: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {},
  ): THREE.Group {
    const group = new THREE.Group();
    if (o.name) group.name = o.name;
    for (const key of this.buckets.keys()) {
      const geo = this.merge(key);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, materialFor(key));
      mesh.name = `${o.name ?? 'part'}:${key}`;
      mesh.castShadow = o.castShadow ?? true;
      mesh.receiveShadow = o.receiveShadow ?? true;
      group.add(mesh);
    }
    return group;
  }

  /** Merge a single bucket into a mesh (null when empty). */
  buildMesh(bucket: string, material: THREE.Material, name?: string): THREE.Mesh | null {
    const geo = this.merge(bucket);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, material);
    if (name) mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Release the intermediate geometries (after build when not reusing). */
  clear(): void {
    this.buckets.clear();
    this.stack.length = 1;
  }
}

// ---------------------------------------------------------------------------
// Cached primitive sources (unit-ish; PartBuilder clones and transforms them)
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();

function memo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export const G = {
  box: (): THREE.BufferGeometry => memo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  /** Rounded box with absolute size (radius in meters). */
  rbox: (w: number, h: number, d: number, r: number, seg = 1): THREE.BufferGeometry =>
    memo(`rbox|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r)),
  sphere: (w = 16, h = 12): THREE.BufferGeometry => memo(`sphere|${w}|${h}`, () => new THREE.SphereGeometry(1, w, h)),
  /** Hemisphere (dome) of radius 1 sitting on y=0. */
  dome: (w = 16, h = 8): THREE.BufferGeometry =>
    memo(`dome|${w}|${h}`, () => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, Math.PI / 2)),
  ico: (detail = 1): THREE.BufferGeometry => memo(`ico|${detail}`, () => new THREE.IcosahedronGeometry(1, detail)),
  /** Cylinder height 1 centered at origin. */
  cyl: (rTop = 1, rBot = 1, seg = 16, open = false): THREE.BufferGeometry =>
    memo(`cyl|${rTop}|${rBot}|${seg}|${open}`, () => new THREE.CylinderGeometry(rTop, rBot, 1, seg, 1, open)),
  cone: (seg = 16): THREE.BufferGeometry => memo(`cone|${seg}`, () => new THREE.ConeGeometry(1, 1, seg)),
  torus: (tube = 0.25, radial = 10, tubular = 24, arc = Math.PI * 2): THREE.BufferGeometry =>
    memo(`torus|${tube}|${radial}|${tubular}|${arc.toFixed(3)}`, () => new THREE.TorusGeometry(1, tube, radial, tubular, arc)),
  capsule: (r = 0.5, len = 1, cap = 6, radial = 12): THREE.BufferGeometry =>
    memo(`capsule|${r}|${len}|${cap}|${radial}`, () => new THREE.CapsuleGeometry(r, len, cap, radial)),
  /** Plane 1x1 lying flat (normal +y). */
  flat: (): THREE.BufferGeometry =>
    memo('flat', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
  /** Plane 1x1 standing (normal +z). */
  plane: (): THREE.BufferGeometry => memo('plane', () => new THREE.PlaneGeometry(1, 1)),
  /** Flat disc radius 1 (normal +y). */
  disc: (seg = 24): THREE.BufferGeometry => memo(`disc|${seg}`, () => new THREE.CircleGeometry(1, seg).rotateX(-Math.PI / 2)),
  /** Flat ring (normal +y). */
  ring: (inner: number, seg = 32): THREE.BufferGeometry =>
    memo(`ring|${inner}|${seg}`, () => new THREE.RingGeometry(inner, 1, seg, 1).rotateX(-Math.PI / 2)),
  star: (points = 5, inner = 0.45, depth = 0.3, bevel = true): THREE.BufferGeometry =>
    memo(`star|${points}|${inner}|${depth}|${bevel}`, () => extrudeCentered(starShape(1, inner, points), depth, bevel ? 0.12 : 0)),
  crescent: (depth = 0.3): THREE.BufferGeometry => memo(`crescent|${depth}`, () => extrudeCentered(crescentShape(1), depth, 0.1)),
  bolt: (depth = 0.3): THREE.BufferGeometry => memo(`bolt|${depth}`, () => extrudeCentered(lightningShape(1), depth, 0.06)),
  heart: (depth = 0.3): THREE.BufferGeometry => memo(`heart|${depth}`, () => extrudeCentered(heartShape(1), depth, 0.08)),
  /** Rounded slab from a rounded-rect shape (extruded along z). */
  roundRect: (w: number, h: number, r: number, depth: number): THREE.BufferGeometry =>
    memo(`rrect|${w}|${h}|${r}|${depth}`, () => extrudeCentered(roundedRectShape(w, h, r), depth, Math.min(0.02, depth * 0.3))),
};

export function disposeGeometryCache(): void {
  geoCache.forEach((g) => g.dispose());
  geoCache.clear();
}

// ---------------------------------------------------------------------------
// 2D shapes
// ---------------------------------------------------------------------------

export function starShape(outer: number, innerRatio: number, points = 5): THREE.Shape {
  const s = new THREE.Shape();
  const n = points * 2;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (i / n) * Math.PI * 2;
    const r = i % 2 === 0 ? outer : outer * innerRatio;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  return s;
}

/** Crescent moon opening to the right (+x), radius r. */
export function crescentShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  // Outer arc (left side of the outer circle) from top to bottom, inner arc back.
  const a0 = Math.PI * 0.32;
  s.absarc(0, 0, r, a0, Math.PI * 2 - a0, false);
  // Inner circle offset to the right; trace back counter-wise.
  const cx = r * 0.48;
  const endX = Math.cos(a0) * r;
  const endY = Math.sin(a0) * r;
  const ir = Math.hypot(endX - cx, endY);
  const b0 = Math.atan2(-endY, endX - cx);
  const b1 = Math.atan2(endY, endX - cx);
  s.absarc(cx, 0, ir, b0, b1, true);
  return s;
}

export function lightningShape(h: number): THREE.Shape {
  const s = new THREE.Shape();
  const p: [number, number][] = [
    [0.18, 1],
    [-0.42, -0.08],
    [-0.02, -0.08],
    [-0.2, -1],
    [0.46, 0.16],
    [0.06, 0.16],
    [0.34, 1],
  ];
  p.forEach(([x, y], i) => (i === 0 ? s.moveTo(x * h, y * h) : s.lineTo(x * h, y * h)));
  return s;
}

export function heartShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -r);
  s.bezierCurveTo(r * 1.4, -r * 0.1, r * 0.75, r * 1.05, 0, r * 0.45);
  s.bezierCurveTo(-r * 0.75, r * 1.05, -r * 1.4, -r * 0.1, 0, -r);
  return s;
}

export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Extrude a shape along +z, centered on z (depth total), with an optional soft bevel. */
export function extrudeCentered(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 10,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

/**
 * Tube along a curve with a radius profile (taper). Built on TubeGeometry then each ring
 * is scaled around its curve point.
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  radius: (t: number) => number,
  tubular = 16,
  radial = 7,
  capEnd = true,
): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, c);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  pos.needsUpdate = true;
  if (!capEnd) return g;
  // Rounded caps: small spheres at both ends, merged in.
  const parts: THREE.BufferGeometry[] = [prepareGeometry(g, null, 0xffffff)];
  for (const t of [0, 1]) {
    const r = radius(t);
    if (r < 0.004) continue;
    curve.getPointAt(t, c);
    const s = new THREE.SphereGeometry(r, radial + 1, 6);
    s.translate(c.x, c.y, c.z);
    parts.push(prepareGeometry(s, null, 0xffffff));
    s.dispose();
  }
  g.dispose();
  const merged = mergeGeometries(parts, false)!;
  // Strip the helper attributes so the result looks like a plain geometry to PartBuilder.
  merged.deleteAttribute('color');
  merged.deleteAttribute('fx');
  return merged;
}

/**
 * Overwrite the sway channel (fx.y) of a prepared geometry with a ramp along one axis:
 * 0 at `from`, `amp` at `to` (clamped). Used for dangling roots and cables.
 */
export function rampSway(geo: THREE.BufferGeometry, axis: 'x' | 'y' | 'z', from: number, to: number, amp: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const fx = geo.getAttribute('fx') as THREE.BufferAttribute;
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const arr = pos.array as ArrayLike<number>;
  for (let i = 0; i < pos.count; i++) {
    const v = arr[i * 3 + ai];
    const k = THREE.MathUtils.clamp((v - from) / (to - from), 0, 1);
    fx.setY(i, k * k * amp);
  }
  fx.needsUpdate = true;
}

/** Lathe from (radius, y) pairs, smooth. */
export function lathe(points: [number, number][], segments = 18): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

/** Mulberry32 seeded PRNG. */
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

/** Stable 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Count triangles in an object tree (for stats). */
export function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    tris += (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
  });
  return Math.round(tris);
}
