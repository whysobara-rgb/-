/**
 * "뿌리째" — the uproot choreography (the game's title moment), driven by
 * LootState.unanchorProgress, the holders' `straining` flag and the 'unanchored' event.
 *
 *   0-40 %   the object trembles, dirt crumbs skitter, ground cracks start crawling out from
 *            its footprint (decal), roots begin to show.
 *   40-80 %  cracks spread, ROOTS arch up out of the ground under tension (taut, thinning,
 *            quivering) like a giant radish, pebbles pop out, the object lifts a little;
 *            banks shed bricks from the foundation, windows rattle, pigeons get nervous.
 *   80-100 % violent shake, dust jets at the corners, stress glints, camera rumble.
 *   POP      the object hops up and slams down (rig pops), roots snap — the object half
 *            dangles and swings, the ground half springs back into a stub —, dirt explosion,
 *            shockwave ring through the ground and the scenery (lamps / trees wobble), impact
 *            frame on big ones, crater left behind (safes; the bank leaves its scar model).
 *
 * Everything scales with size: a small safe is a cute pop, a large safe a thump, the bank a
 * spectacle. Interior safes live in their bank's frame (cracks and stubs ride the floor).
 * Roots read as radish / ginseng roots from the high camera: pale, chunky, tapering to a point,
 * curly (they straighten as tension builds), with hairy side rootlets, clinging soil and a soil
 * mound where they dive into the ground, all with a dark ink rim. Snapped ground halves curl up
 * into hooked stubs with a pale torn tip; the object halves dangle and swing with a soil ball.
 * Rendering: one decal mesh per active item + four instanced meshes (root segments, clods and
 * their ink hulls).
 */
import * as THREE from 'three';
import type { EntityId, LootKind, LootState, Simulation, Vec2 } from '../sim';
import { BANK_MODEL, SAFE_SPECS } from '../sim';
import { crackTexture } from './models/art';
import { createToonMaterial } from './models/materials';
import { PAL } from './models/palette';
import { BANK_POP } from './models/bank';
import { SAFE_POP } from './models/safes';
import type { ViewEffects } from './effects';
import { scaledCount, type QualityPreset } from './quality';

export interface LootPose {
  x: number;
  y: number;
  a: number;
  /** Floor height under it (0 outdoors, the bank floor inside). */
  h: number;
}

export interface UprootHost {
  readonly effects: ViewEffects;
  /** Interpolated pose of a loot item (or a bank as a frame owner); null when gone. */
  pose(id: EntityId): LootPose | null;
  /** Camera trauma scaled by closeness of `at` to the focus (radius = falloff distance). */
  shake(at: Vec2, amount: number, radius: number): void;
  /** Impact frame + chromatic kick near `at` (strength 0..1). */
  impact(at: Vec2, strength: number, chroma: number): void;
  /** Scenery jelly shockwave. */
  shock(at: Vec2, strength: number): void;
  scare(at: Vec2, radius: number): void;
  /** Stage change while straining (banks: bells, sign, pigeons...). */
  stage(id: EntityId, kind: LootKind, stage: number): void;
  /** The object slammed back down after its pop hop. */
  landed(id: EntityId, kind: LootKind): void;
}

const SEGS = 8;
const DANGLE = 5;
/** Ink rim width (m) around roots / clods: ~1.5 px at the match camera. */
const INK_W = 0.03;

interface Tendril {
  /** Attach point in the object's frame (three local: x, y, z = sim local y). */
  ax: number;
  ay: number;
  az: number;
  /** Ground anchor in the owner frame (sim local x, y). */
  /** Ground anchor relative to the home pose (sim local x, y). */
  glx: number;
  gly: number;
  r0: number;
  arch: number;
  seed: number;
  /** Lateral S-curl amplitude (signed, fraction of the root length). */
  curl: number;
  /** Side of the hairy rootlets (+1 / -1). */
  side: number;
  /** A soil clump clings to the middle of this root. */
  soil: boolean;
  snapped: boolean;
  /** Fraction along the root where it breaks. */
  brk: number;
  /** Dangling chain (world), verlet. */
  pts: Float32Array;
  prev: Float32Array;
  /** Ground stub spring 0..1 (+overshoot). */
  stub: number;
  stubVel: number;
  /** Dangle life left (s); shrinks to nothing after. */
  dangleLife: number;
}

interface Track {
  id: EntityId;
  kind: LootKind;
  half: Vec2;
  height: number;
  /** Size factor (small 0.6, large 1, bank 2.4). */
  S: number;
  owner: EntityId | null;
  /** Home pose in the owner frame (or world when owner is null). */
  hx: number;
  hy: number;
  ha: number;
  decal: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  shown: number;
  stage: number;
  straining: boolean;
  popped: boolean;
  popAge: number;
  landed: boolean;
  crater: number;
  lift: number;
  strain: number;
  tendrils: Tendril[];
  acc: { crumb: number; pebble: number; brick: number; jet: number; glint: number };
  gone: boolean;
}

const decalVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const decalFrag = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uProgress;
  uniform float uCrater;
  uniform float uOpacity;
  uniform vec3 uCrack;
  uniform vec3 uRim;
  uniform vec3 uDirt;
  uniform vec3 uDirtDark;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uTex, vUv);
    float grow = smoothstep(t.g - 0.035, t.g + 0.005, uProgress);
    float crack = t.r * grow;
    float rim = t.a * grow * (1.0 - t.r);
    float crater = t.b * uCrater;
    vec2 cell = floor(vUv * 48.0);
    float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 dirt = mix(uDirtDark, uDirt, 0.25 + 0.6 * n);
    vec4 col = vec4(0.0);
    col = mix(col, vec4(dirt, 1.0), crater);
    col = mix(col, vec4(uRim, 0.45), rim * (1.0 - crater));
    col = mix(col, vec4(uCrack, 1.0), crack);
    if (col.a < 0.01) discard;
    gl_FragColor = vec4(col.rgb, col.a * uOpacity);
    #include <colorspace_fragment>
  }
`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
// Pale radish / ginseng tones: they must pop against both the warm paving and the dark dirt.
const ROOT_COLORS = ['#EBC89C', '#E0B887', '#F2D5AE', '#D8AA78'].map((c) => new THREE.Color(c));
const ROOTLET_COLOR = new THREE.Color('#D2A273');
const TORN_COLOR = new THREE.Color('#FFF1DA');
const INK = '#3E2724';
const DIRT = ['#8A6748', '#6A4E37', '#A47E5C'];
const PEBBLES = ['#C7B59D', '#A79A8E', '#8A6748', '#D2C5B5'];
const BRICKS = ['#D9826B', '#E39A82', '#C7B59D', '#B9695A'];

function rngFrom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export class UprootDirector {
  readonly root = new THREE.Group();
  private readonly tracks = new Map<EntityId, Track>();
  private readonly segMesh: THREE.InstancedMesh;
  private readonly clodMesh: THREE.InstancedMesh;
  private readonly segInk: THREE.InstancedMesh;
  private readonly clodInk: THREE.InstancedMesh;
  private readonly inkMat: THREE.MeshBasicMaterial;
  private readonly segGeo: THREE.CylinderGeometry;
  private readonly clodGeo: THREE.IcosahedronGeometry;
  private readonly rootMat: THREE.MeshToonMaterial;
  private readonly decalGeo: THREE.PlaneGeometry;
  private preset: QualityPreset;
  private time = 0;
  private readonly segCap = 2400;
  private readonly clodCap = 900;
  /** Instances written this frame. */
  private seg = 0;
  private clod = 0;

  constructor(
    private readonly host: UprootHost,
    preset: QualityPreset,
  ) {
    this.preset = preset;
    this.root.name = 'uproot';
    this.segGeo = new THREE.CylinderGeometry(0.84, 1, 1, 8, 1);
    this.clodGeo = new THREE.IcosahedronGeometry(1, 1);
    this.rootMat = createToonMaterial({ color: '#FFFFFF', rim: 0.5 });
    this.inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    this.segMesh = new THREE.InstancedMesh(this.segGeo, this.rootMat, this.segCap);
    this.clodMesh = new THREE.InstancedMesh(this.clodGeo, this.rootMat, this.clodCap);
    this.segInk = new THREE.InstancedMesh(this.segGeo, this.inkMat, this.segCap);
    this.clodInk = new THREE.InstancedMesh(this.clodGeo, this.inkMat, this.clodCap);
    for (const m of [this.segInk, this.clodInk]) {
      m.count = 0;
      m.frustumCulled = false;
      m.userData.noOutline = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.raycast = () => {};
      this.root.add(m);
    }
    for (const m of [this.segMesh, this.clodMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.noOutline = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _c.set('#FFFFFF'));
      this.root.add(m);
    }
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
  }

  private n(base: number, min = 1): number {
    return scaledCount(base, this.preset, min);
  }

  /** Register an anchored loot item (call at load). Already free items get their crater. */
  track(l: LootState, ownerBank: EntityId | null, ownerPose: LootPose | null): void {
    if (this.tracks.has(l.id)) return;
    const kind = l.kind;
    const half = kind === 'bank' ? BANK_MODEL.half : SAFE_SPECS[kind].half;
    const height = kind === 'bank' ? BANK_MODEL.wallHeight : SAFE_SPECS[kind].height;
    const S = kind === 'bank' ? 2.4 : kind === 'largeSafe' ? 1 : 0.6;
    // Home pose in the owner frame.
    let hx = l.pos.x;
    let hy = l.pos.y;
    let ha = l.angle;
    if (ownerBank !== null && ownerPose) {
      const c = Math.cos(ownerPose.a);
      const s = Math.sin(ownerPose.a);
      const dx = l.pos.x - ownerPose.x;
      const dy = l.pos.y - ownerPose.y;
      hx = dx * c + dy * s;
      hy = -dx * s + dy * c;
      ha = l.angle - ownerPose.a;
    }
    // Decal: footprint + a generous crack margin.
    const grow = kind === 'bank' ? 1.9 : 3.2;
    const dx = half.x * grow;
    const dy = half.y * grow;
    const tex = crackTexture((l.id * 7) % 5, 1 / grow, 1, kind === 'bank' ? 1 : kind === 'largeSafe' ? 2.2 : 2.6);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex },
        uProgress: { value: 0 },
        uCrater: { value: 0 },
        uOpacity: { value: 1 },
        uCrack: { value: new THREE.Color('#6E4B4C') },
        uRim: { value: new THREE.Color('#FFF3DE') },
        uDirt: { value: new THREE.Color('#9A7452') },
        uDirtDark: { value: new THREE.Color('#5E4232') },
      },
      vertexShader: decalVert,
      fragmentShader: decalFrag,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const decal = new THREE.Mesh(this.decalGeo, mat);
    decal.name = `uproot:decal${l.id}`;
    decal.scale.set(dx * 2, 1, dy * 2);
    decal.renderOrder = 1;
    decal.visible = false;
    decal.userData.noOutline = true;
    decal.raycast = () => {};
    this.root.add(decal);
    // Roots around the footprint.
    const r = rngFrom(l.id * 7919 + 17);
    const count = kind === 'bank' ? 14 : kind === 'largeSafe' ? 7 : 5;
    const tendrils: Tendril[] = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.5;
      // Point on the footprint edge in that direction.
      const cx = Math.cos(ang);
      const cz = Math.sin(ang);
      const k = 1 / Math.max(Math.abs(cx) / half.x, Math.abs(cz) / half.y);
      const ex = cx * k * 0.92;
      const ez = cz * k * 0.92;
      const reach = kind === 'bank' ? 1.5 + r() * 1.1 : kind === 'largeSafe' ? 0.8 + r() * 0.4 : 0.6 + r() * 0.28;
      // Ground anchor (owner frame): out from the edge, rotated by the home angle.
      const gxL = ex + cx * reach;
      const gzL = ez + cz * reach;
      tendrils.push({
        ax: ex * 0.96,
        ay: 0.04,
        az: ez * 0.96,
        glx: gxL,
        gly: gzL,
        r0: kind === 'bank' ? 0.2 + r() * 0.07 : kind === 'largeSafe' ? 0.11 + r() * 0.025 : 0.085 + r() * 0.015,
        arch: kind === 'bank' ? 0.9 + r() * 0.5 : kind === 'largeSafe' ? 0.5 + r() * 0.2 : 0.38 + r() * 0.12,
        seed: r() * 100,
        curl: (r() < 0.5 ? -1 : 1) * (0.12 + r() * 0.1),
        side: r() < 0.5 ? -1 : 1,
        soil: r() < 0.55,
        snapped: false,
        brk: 0.45 + r() * 0.2,
        pts: new Float32Array(DANGLE * 3),
        prev: new Float32Array(DANGLE * 3),
        stub: 0,
        stubVel: 0,
        dangleLife: 0,
      });
    }
    const t: Track = {
      id: l.id,
      kind,
      half,
      height,
      S,
      owner: ownerBank,
      hx,
      hy,
      ha,
      decal,
      mat,
      shown: 0,
      stage: 0,
      straining: false,
      popped: false,
      popAge: 99,
      landed: true,
      crater: 0,
      lift: 0,
      strain: 0,
      tendrils,
      acc: { crumb: 0, pebble: 0, brick: 0, jet: 0, glint: 0 },
      gone: false,
    };
    if (!l.anchored) {
      // Loaded mid-match: already uprooted (crater + stubs, no fireworks).
      t.popped = true;
      t.shown = 1;
      t.crater = kind === 'bank' ? 0 : 1;
      for (const td of tendrils) {
        td.snapped = true;
        td.stub = 1;
        td.dangleLife = 0;
      }
    }
    this.tracks.set(l.id, t);
  }

  /** Visual shake (0..1) for a rig while it is being pulled. */
  strainOf(id: EntityId): number {
    return this.tracks.get(id)?.strain ?? 0;
  }

  /** Visual lift (m) for a rig while it is being pulled. */
  liftOf(id: EntityId): number {
    return this.tracks.get(id)?.lift ?? 0;
  }

  /** Current strain stage 0..3 (debug / tests). */
  stageOf(id: EntityId): number {
    return this.tracks.get(id)?.stage ?? 0;
  }

  clear(): void {
    for (const t of this.tracks.values()) {
      t.decal.removeFromParent();
      t.mat.dispose();
    }
    this.tracks.clear();
    this.segMesh.count = 0;
    this.clodMesh.count = 0;
    this.segInk.count = 0;
    this.clodInk.count = 0;
  }

  dispose(): void {
    this.clear();
    this.segMesh.dispose();
    this.clodMesh.dispose();
    this.segInk.dispose();
    this.clodInk.dispose();
    this.inkMat.dispose();
    this.segGeo.dispose();
    this.clodGeo.dispose();
    this.decalGeo.dispose();
    this.rootMat.dispose();
    this.root.removeFromParent();
  }

  // -------------------------------------------------------------------------
  // Frames
  // -------------------------------------------------------------------------

  /** Owner frame -> world (sim x, y) + floor height. */
  private ownerToWorld(t: Track, lx: number, ly: number, out: { x: number; y: number; h: number }): boolean {
    if (t.owner === null) {
      out.x = lx;
      out.y = ly;
      out.h = 0;
      return true;
    }
    const o = this.host.pose(t.owner);
    if (!o) return false;
    const c = Math.cos(o.a);
    const s = Math.sin(o.a);
    out.x = o.x + lx * c - ly * s;
    out.y = o.y + lx * s + ly * c;
    out.h = o.h;
    return true;
  }

  /** A root's ground anchor in world sim coords (+ floor height). */
  private anchorWorld(t: Track, td: Tendril, out: { x: number; y: number; h: number }): boolean {
    const c = Math.cos(t.ha);
    const s = Math.sin(t.ha);
    return this.ownerToWorld(t, t.hx + td.glx * c - td.gly * s, t.hy + td.glx * s + td.gly * c, out);
  }

  /** Object frame (three local x, y, z) -> world three coords. */
  private objToWorld(p: LootPose, lift: number, lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    return out.set(p.x + lx * c - lz * s, p.h + lift + ly, p.y + lx * s + lz * c);
  }

  /** A random point on the object's footprint edge (+ margin), world sim coords. */
  private edgePoint(p: LootPose, half: Vec2, margin: number, r: number, out: { x: number; y: number }): void {
    const side = Math.floor(r * 4);
    const t = (r * 4 - side) * 2 - 1;
    let lx: number;
    let ly: number;
    if (side === 0) [lx, ly] = [t * half.x, half.y + margin];
    else if (side === 1) [lx, ly] = [t * half.x, -half.y - margin];
    else if (side === 2) [lx, ly] = [half.x + margin, t * half.y];
    else [lx, ly] = [-half.x - margin, t * half.y];
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    out.x = p.x + lx * c - ly * s;
    out.y = p.y + lx * s + ly * c;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /** The 'unanchored' event: the POP. */
  pop(id: EntityId, sim: Simulation): void {
    const t = this.tracks.get(id);
    const l = sim.getLoot(id);
    if (!t || !l || t.popped) return;
    const p = this.host.pose(id) ?? { x: l.pos.x, y: l.pos.y, a: l.angle, h: 0 };
    t.popped = true;
    t.popAge = 0;
    t.landed = false;
    t.shown = 1;
    t.stage = 0;
    t.strain = 0;
    const S = t.S;
    const fx = this.host.effects.fx;
    const c3 = { x: p.x, y: p.h, z: p.y };
    // Dirt explosion: clods + a dust ring thrown outward + shock rings + gold stars.
    fx.chunks(c3, { count: this.n(Math.round(9 * S), 4), colors: DIRT, size: 0.08 * Math.sqrt(S), power: 1.1 * Math.pow(S, 0.35), spread: Math.max(t.half.x, t.half.y) * 0.8, up: 1.1 });
    const ring = this.n(t.kind === 'bank' ? 22 : 10, 6);
    const tmp = { x: 0, y: 0 };
    for (let i = 0; i < ring; i++) {
      this.edgePoint(p, t.half, 0.15, (i + Math.random() * 0.5) / ring, tmp);
      _d.set(tmp.x - p.x, 0, tmp.y - p.y).normalize();
      fx.dust({ x: tmp.x, y: p.h, z: tmp.y }, { count: 1, spread: 0.3, size: 0.32 * Math.pow(S, 0.6), up: 1.2, dir: { x: _d.x * 1.2 * Math.sqrt(S), y: 0, z: _d.z * 1.2 * Math.sqrt(S) }, color: i % 3 ? '#F3E7D4' : '#C9A882' });
    }
    fx.ring(c3, { radius: t.kind === 'bank' ? 10 : 2.4 * S + 0.6, color: '#FFFFFF', duration: t.kind === 'bank' ? 0.75 : 0.45 });
    fx.ring(c3, { radius: t.kind === 'bank' ? 6.5 : 1.5 * S + 0.4, color: '#9A7452', duration: 0.5 });
    fx.stars({ x: p.x, y: p.h + t.height * 0.5, z: p.y }, { count: this.n(Math.round(4 + 3 * S), 3), size: 0.16 + 0.05 * S, color: PAL.goldLight });
    fx.sparkle({ x: p.x, y: p.h + 0.2, z: p.y }, { count: this.n(Math.round(6 * S), 4), radius: Math.max(t.half.x, t.half.y) + 0.5, color: '#FFF2A8' });
    // Roots snap: the object half keeps dangling, the ground half springs into a stub.
    for (const td of t.tendrils) {
      td.snapped = true;
      td.stub = 0;
      td.stubVel = 9 + Math.random() * 4;
      td.dangleLife = t.kind === 'bank' ? 5.5 : 3.6;
      const pts = this.rootPoints(t, td, p, 1, SEGS);
      const b = Math.round(td.brk * SEGS);
      for (let i = 0; i < DANGLE; i++) {
        const k = Math.min(b, Math.round((i / (DANGLE - 1)) * b));
        td.pts[i * 3] = pts[k * 3]!;
        td.pts[i * 3 + 1] = pts[k * 3 + 1]!;
        td.pts[i * 3 + 2] = pts[k * 3 + 2]!;
        // Kick: fling outward and up.
        td.prev[i * 3] = td.pts[i * 3]! - (td.pts[i * 3]! - p.x) * 0.02;
        td.prev[i * 3 + 1] = td.pts[i * 3 + 1]! - 0.04 * (i / DANGLE);
        td.prev[i * 3 + 2] = td.pts[i * 3 + 2]! - (td.pts[i * 3 + 2]! - p.y) * 0.02;
      }
      const bx = pts[b * 3]!;
      const by = pts[b * 3 + 1]!;
      const bz = pts[b * 3 + 2]!;
      fx.dust({ x: bx, y: by, z: bz }, { count: 1, spread: 0.1, size: 0.14 * Math.sqrt(S), color: '#A47E5C', up: 0.8 });
    }
    const at = { x: p.x, y: p.y };
    this.host.shock(at, Math.min(1, 0.3 * S));
    this.host.shake(at, t.kind === 'bank' ? 0.55 : t.kind === 'largeSafe' ? 0.22 : 0.1, t.kind === 'bank' ? 30 : 14);
    if (t.kind === 'bank') this.host.impact(at, 0.8, 1);
    else if (t.kind === 'largeSafe') this.host.impact(at, 0.35, 0.45);
    this.host.scare(at, t.kind === 'bank' ? 18 : 5 * S);
  }

  // -------------------------------------------------------------------------
  // Per frame
  // -------------------------------------------------------------------------

  update(sim: Simulation, dt: number): void {
    this.time += dt;
    this.seg = 0;
    this.clod = 0;
    const tmp = { x: 0, y: 0, h: 0 };
    const fx = this.host.effects.fx;
    for (const t of this.tracks.values()) {
      const l = sim.getLoot(t.id);
      if (!l) continue;
      // Frame of the home (cracks, anchors, crater).
      if (t.owner === null && l.anchored && !t.popped && Math.hypot(l.pos.x - t.hx, l.pos.y - t.hy) > 0.25) {
        t.hx = l.pos.x;
        t.hy = l.pos.y;
        t.ha = l.angle;
      }
      const homeOk = this.ownerToWorld(t, t.hx, t.hy, tmp);
      if (!homeOk) {
        t.decal.visible = false;
        continue;
      }
      const homeX = tmp.x;
      const homeY = tmp.y;
      const homeH = tmp.h;
      let homeA = t.ha;
      if (t.owner !== null) homeA += this.host.pose(t.owner)?.a ?? 0;
      const pose = l.recovered ? null : this.host.pose(t.id);
      // --- strain state -------------------------------------------------------
      let straining = false;
      if (l.anchored && !l.recovered) for (const cid of l.grabbedBy) if (sim.getCharacter(cid)?.straining) straining = true;
      t.straining = straining;
      if (!l.anchored && !t.popped) {
        t.popped = true;
        t.popAge = 99;
        t.landed = true;
        t.crater = t.kind === 'bank' ? 0 : 1;
        for (const td of t.tendrils) {
          td.snapped = true;
          td.stub = 1;
          td.dangleLife = 0;
        }
      }
      const prog = l.anchored ? l.unanchorProgress : 1;
      const target = t.popped ? 1 : prog;
      t.shown += (target - t.shown) * (1 - Math.exp(-dt * 10));
      if (!t.popped && l.anchored) {
        const stage = !straining || prog <= 0 ? 0 : prog < 0.4 ? 1 : prog < 0.8 ? 2 : 3;
        if (stage !== t.stage) {
          if (stage > 0) this.host.stage(t.id, t.kind, stage);
          t.stage = stage;
        }
        const pr = t.shown;
        const want = straining ? 0.25 + 0.75 * Math.pow(pr, 1.3) : 0;
        t.strain += (want - t.strain) * (1 - Math.exp(-dt * 12));
        const maxLift = t.kind === 'bank' ? 0.24 : t.kind === 'largeSafe' ? 0.1 : 0.08;
        const wantLift = straining && pr > 0.4 ? Math.pow((pr - 0.4) / 0.6, 1.5) * maxLift : pr > 0.4 ? maxLift * 0.3 * ((pr - 0.4) / 0.6) : 0;
        t.lift += (wantLift - t.lift) * (1 - Math.exp(-dt * 8));
        if (straining && pose && dt > 0) this.emitStrainFx(t, pose, pr, dt);
      } else {
        t.strain = 0;
        t.lift += (0 - t.lift) * (1 - Math.exp(-dt * 10));
      }
      if (t.popped) {
        t.popAge += dt;
        const land = t.kind === 'bank' ? BANK_POP.land : (t.kind === 'smallSafe' ? SAFE_POP.small.time : SAFE_POP.large.time) * 0.62;
        if (!t.landed && t.popAge >= land) {
          t.landed = true;
          if (pose) {
            const c3 = { x: pose.x, y: pose.h, z: pose.y };
            fx.ring(c3, { radius: t.kind === 'bank' ? 7.5 : 1.6 * t.S + 0.5, color: '#F3E7D4', duration: 0.45 });
            fx.dust(c3, { count: this.n(Math.round(6 * t.S), 3), spread: Math.max(t.half.x, t.half.y) * 0.9, size: 0.3 * Math.sqrt(t.S), up: 0.8 });
            if (t.kind === 'bank') {
              this.host.shock({ x: pose.x, y: pose.y }, 0.55);
              this.host.shake({ x: pose.x, y: pose.y }, 0.35, 28);
            }
          }
          this.host.landed(t.id, t.kind);
        }
        if (t.kind !== 'bank') t.crater = Math.min(1, t.crater + dt / 0.25);
      }
      // --- decal ---------------------------------------------------------------
      const show = t.shown > 0.003 || t.popped;
      t.decal.visible = show;
      if (show) {
        t.decal.position.set(homeX, homeH + 0.012, homeY);
        t.decal.rotation.set(0, -homeA, 0);
        t.mat.uniforms.uProgress.value = Math.min(1.05, t.shown * 1.04);
        t.mat.uniforms.uCrater.value = t.crater;
      }
      // --- roots ---------------------------------------------------------------
      if (!show) continue;
      const vis = t.popped ? 1 : THREE.MathUtils.smoothstep(t.shown, 0.03, 0.3);
      if (vis <= 0.01) continue;
      const sz = Math.sqrt(t.S);
      for (const td of t.tendrils) {
        if (!td.snapped) {
          if (!pose) continue;
          const pts = this.rootPoints(t, td, pose, vis, SEGS);
          // Thick at the object, thinning to a point where it dives in; thinner under tension.
          const rb = td.r0 * (1 - 0.3 * t.shown) * (0.4 + 0.6 * vis);
          this.pushChain(pts, SEGS + 1, rb, rb * 0.22, td.seed, -1);
          // Hairy side rootlets (alternating sides), pointing back into the ground.
          for (const [i, side] of [
            [3, td.side],
            [5, -td.side],
          ] as const) {
            this.pushRootlet(pts, i, SEGS, side, rb * (1 - 0.72 * (i / SEGS)) * 0.45, 0.24 * sz * vis, td.seed + i);
          }
          // Clinging soil clump on top of the root.
          if (td.soil) {
            const k = 4 * 3;
            this.pushClod(pts[k]!, pts[k + 1]! + rb * 0.45, pts[k + 2]!, rb * 0.95, rb * 0.6, rb * 0.85, td.seed, 1);
          }
          // Soil mound where it dives into the ground (heaves as the pull grows).
          const gx = pts[SEGS * 3]!;
          const gz = pts[SEGS * 3 + 2]!;
          const heave = 0.7 + 0.5 * t.shown;
          this.pushClod(gx, homeH + 0.01, gz, rb * 2.5 * vis, rb * 0.62 * heave * vis, rb * 2.1 * vis, td.seed, 0);
          this.pushClod(gx + Math.sin(td.seed) * rb * 1.5, homeH + 0.01, gz + Math.cos(td.seed) * rb * 1.5, rb * 1.3 * vis, rb * 0.5 * heave * vis, rb * 1.15 * vis, td.seed + 1, 2);
        } else {
          // Ground stub (owner frame, springs back then rests).
          if (dt > 0) {
            td.stubVel += (-160 * (td.stub - 1) - 14 * td.stubVel) * dt;
            td.stub += td.stubVel * dt;
          }
          const gw = this.anchorWorld(t, td, tmp);
          if (gw) {
            const ox = tmp.x;
            const oz = tmp.y;
            const oh = tmp.h;
            const dxo = ox - homeX;
            const dzo = oz - homeY;
            const dl = Math.hypot(dxo, dzo) || 1;
            // u = back toward the hole, l = lateral.
            const ux = -dxo / dl;
            const uz = -dzo / dl;
            const lx = -uz * td.side;
            const lz = ux * td.side;
            const sh = Math.max(0, td.stub);
            const k = sz * 0.85;
            const stub = STUB;
            const put = (i: number, fu: number, fl: number, fy: number): void => {
              stub[i * 3] = ox + (ux * fu + lx * fl) * k;
              stub[i * 3 + 1] = oh + fy * k * sh;
              stub[i * 3 + 2] = oz + (uz * fu + lz * fl) * k;
            };
            // Curls up out of its mound and hooks over like a pig tail, torn tip pale.
            put(0, 0, 0, -0.06);
            put(1, 0.03, 0.01, 0.2);
            put(2, 0.11, 0.05, 0.33);
            put(3, 0.21, 0.1, 0.32);
            put(4, 0.27, 0.12, 0.22);
            const r0 = td.r0 * 0.62;
            this.pushChain(stub, 5, r0, r0 * 0.4, td.seed, -1);
            this.pushRootlet(stub, 2, 4, -td.side, r0 * 0.45, 0.16 * k * sh, td.seed + 7);
            this.pushClod(stub[12]!, stub[13]!, stub[14]!, r0 * 0.5, r0 * 0.5, r0 * 0.5, td.seed, 3);
            this.pushClod(ox, oh + 0.01, oz, r0 * 2.5, r0 * 0.62, r0 * 2.2, td.seed, 0);
            this.pushClod(ox - ux * r0 * 1.7, oh + 0.01, oz - uz * r0 * 1.7, r0 * 1.3, r0 * 0.5, r0 * 1.15, td.seed + 2, 2);
          }
          // Dangling half (follows the object; shrinks away after a while).
          if (td.dangleLife > 0 && pose) {
            td.dangleLife -= dt;
            const life = Math.min(1, td.dangleLife / 0.8);
            this.objToWorld(pose, this.rigLift(t), td.ax, td.ay, td.az, _p);
            this.stepDangle(td, _p, dt, t.S);
            const r0 = td.r0 * 0.95 * life;
            this.pushChain(td.pts, DANGLE, r0, r0 * 0.35, td.seed, -1);
            const e = (DANGLE - 1) * 3;
            // A ball of soil still stuck to the torn end, and the pale torn tip.
            if (td.soil) this.pushClod(td.pts[e]!, td.pts[e + 1]!, td.pts[e + 2]!, r0 * 1.15, r0 * 1.0, r0 * 1.1, td.seed, 1);
            else this.pushClod(td.pts[e]!, td.pts[e + 1]!, td.pts[e + 2]!, r0 * 0.4, r0 * 0.4, r0 * 0.4, td.seed, 3);
          }
        }
      }
    }
    this.segMesh.count = this.segInk.count = this.seg;
    this.clodMesh.count = this.clodInk.count = this.clod;
    for (const m of [this.segMesh, this.clodMesh, this.segInk, this.clodInk]) m.instanceMatrix.needsUpdate = true;
    if (this.segMesh.instanceColor) this.segMesh.instanceColor.needsUpdate = true;
    if (this.clodMesh.instanceColor) this.clodMesh.instanceColor.needsUpdate = true;
  }

  /** Lift the rig shows right now (strain lift; the pop hop is the rig's own). */
  private rigLift(t: Track): number {
    return t.lift;
  }

  /**
   * Root polyline (world three coords, `n + 1` points) from the object's base edge arching
   * over the ground into its anchor; `vis` grows it out of the ground.
   */
  private rootPoints(t: Track, td: Tendril, pose: LootPose, vis: number, n: number): Float32Array {
    const out = PTS;
    const a = this.objToWorld(pose, t.lift, td.ax, td.ay, td.az, _p);
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const g = { x: 0, y: 0, h: 0 };
    this.anchorWorld(t, td, g);
    const p = t.popped ? 1 : t.shown;
    // Arch rises out of the ground with tension; tremble at high strain.
    const arch = (-0.06 + td.arch * (0.15 + 0.85 * p)) * vis;
    const tremble = t.straining ? 0.012 * t.S * p * p : 0;
    // Lateral S-curl (a curly root), pulled straighter as the tension builds.
    const len = Math.hypot(g.x - ax, g.y - az) || 1;
    const lx = -(g.y - az) / len;
    const lz = (g.x - ax) / len;
    const curl = td.curl * len * (1 - 0.6 * p);
    const ph = td.seed % 6.283;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const x = ax + (g.x - ax) * s;
      const z = az + (g.y - az) * s;
      const base = ay + (g.h - 0.06 - ay) * s;
      // Taut: the curve flattens toward a straight line as p -> 1 (string under tension).
      const bulge = Math.sin(Math.PI * Math.pow(s, 0.8)) * arch * (1 - 0.35 * p);
      const tw = Math.sin(this.time * 63 + td.seed + i * 1.7) * tremble * Math.sin(Math.PI * s);
      const c = curl * Math.sin(Math.PI * s) * Math.sin(Math.PI * 1.6 * s + ph);
      out[i * 3] = x + tw + lx * c;
      out[i * 3 + 1] = base + bulge;
      out[i * 3 + 2] = z - tw + lz * c;
    }
    return out;
  }

  private stepDangle(td: Tendril, pin: THREE.Vector3, dt: number, S: number): void {
    const pts = td.pts;
    const prev = td.prev;
    if (dt > 0) {
      const g = 14 * dt * dt;
      for (let i = 1; i < DANGLE; i++) {
        const k = i * 3;
        const vx = (pts[k]! - prev[k]!) * 0.94;
        const vy = (pts[k + 1]! - prev[k + 1]!) * 0.94;
        const vz = (pts[k + 2]! - prev[k + 2]!) * 0.94;
        prev[k] = pts[k]!;
        prev[k + 1] = pts[k + 1]!;
        prev[k + 2] = pts[k + 2]!;
        pts[k] = pts[k]! + vx;
        pts[k + 1] = Math.max(0.02, pts[k + 1]! + vy - g);
        pts[k + 2] = pts[k + 2]! + vz;
      }
    }
    pts[0] = pin.x;
    pts[1] = pin.y;
    pts[2] = pin.z;
    // Distance constraints.
    const L = 0.13 * Math.sqrt(S);
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < DANGLE; i++) {
        const a = (i - 1) * 3;
        const b = i * 3;
        const dx = pts[b]! - pts[a]!;
        const dy = pts[b + 1]! - pts[a + 1]!;
        const dz = pts[b + 2]! - pts[a + 2]!;
        const d = Math.hypot(dx, dy, dz) || 1e-4;
        const corr = (d - L) / d;
        if (i === 1) {
          pts[b] = pts[b]! - dx * corr;
          pts[b + 1] = pts[b + 1]! - dy * corr;
          pts[b + 2] = pts[b + 2]! - dz * corr;
        } else {
          pts[a] = pts[a]! + dx * corr * 0.5;
          pts[a + 1] = pts[a + 1]! + dy * corr * 0.5;
          pts[a + 2] = pts[a + 2]! + dz * corr * 0.5;
          pts[b] = pts[b]! - dx * corr * 0.5;
          pts[b + 1] = pts[b + 1]! - dy * corr * 0.5;
          pts[b + 2] = pts[b + 2]! - dz * corr * 0.5;
        }
      }
    }
  }

  /**
   * Write a tapered chain of cylinders through `count` points (radius rA at the first point to
   * rB at the last) plus its ink hull. `tone` < 0 picks a root tone from the seed.
   */
  private pushChain(pts: Float32Array, count: number, rA: number, rB: number, seed: number, tone: number, color?: THREE.Color): void {
    if (rA <= 0.002) return;
    for (let i = 0; i < count - 1 && this.seg < this.segCap; i++) {
      const k = i * 3;
      const r = rA + (rB - rA) * (i / Math.max(1, count - 2));
      const col = color ?? ROOT_COLORS[((tone < 0 ? Math.floor(seed * 3) : tone) + (i >> 1)) % ROOT_COLORS.length]!;
      this.pushSeg(pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!, pts[k + 4]!, pts[k + 5]!, r, col);
    }
  }

  private pushSeg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, col: THREE.Color): void {
    if (this.seg >= this.segCap) return;
    _d.set(bx - ax, by - ay, bz - az);
    const len = _d.length();
    if (len < 1e-4) return;
    _d.divideScalar(len);
    _q.setFromUnitVectors(_up, _d);
    _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _s.set(r, len * 1.14, r);
    _m.compose(_p, _q, _s);
    this.segMesh.setMatrixAt(this.seg, _m);
    this.segMesh.setColorAt(this.seg, col);
    _s.set(r + INK_W, len * 1.14 + INK_W, r + INK_W);
    _m.compose(_p, _q, _s);
    this.segInk.setMatrixAt(this.seg, _m);
    this.seg++;
  }

  /** Two-segment hairy side rootlet off point `i` of a chain, bending down into the ground. */
  private pushRootlet(pts: Float32Array, i: number, n: number, side: number, r: number, L: number, seed: number): void {
    if (r <= 0.004 || L <= 0.01) return;
    const k = i * 3;
    const px = pts[k]!;
    const py = pts[k + 1]!;
    const pz = pts[k + 2]!;
    const qx = pts[Math.min(n, i + 1) * 3]! - pts[Math.max(0, i - 1) * 3]!;
    const qz = pts[Math.min(n, i + 1) * 3 + 2]! - pts[Math.max(0, i - 1) * 3 + 2]!;
    const ql = Math.hypot(qx, qz) || 1;
    // Lateral (+ a little forward) then curling down.
    const dx = ((-qz / ql) * side * 0.85 + (qx / ql) * 0.4) * L;
    const dz = ((qx / ql) * side * 0.85 + (qz / ql) * 0.4) * L;
    const mx = px + dx * 0.55;
    const my = py + 0.03 + Math.sin(seed) * 0.02;
    const mz = pz + dz * 0.55;
    const ex = px + dx;
    const ey = Math.max(0.0, py - L * 0.45);
    const ez = pz + dz;
    this.pushSeg(px, py, pz, mx, my, mz, r, ROOTLET_COLOR);
    this.pushSeg(mx, my, mz, ex, ey, ez, r * 0.6, ROOTLET_COLOR);
  }

  /** A soil clod / mound / torn tip. tone: 0 mound, 1 clinging soil, 2 dark lump, 3 torn tip. */
  private pushClod(x: number, y: number, z: number, sx: number, sy: number, sz: number, seed: number, tone: number): void {
    if (this.clod >= this.clodCap || Math.min(sx, sy, sz) <= 0.003) return;
    const i = this.clod;
    _p.set(x, y, z);
    _q.setFromAxisAngle(_up, seed);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    this.clodMesh.setMatrixAt(i, _m);
    const col = tone === 3 ? TORN_COLOR : tone === 2 ? _c.set(DIRT[1]!) : tone === 1 ? _c.set(DIRT[0]!) : _c.set(DIRT[2]!);
    this.clodMesh.setColorAt(i, col);
    _s.set(sx + INK_W, sy + INK_W * 0.7, sz + INK_W);
    _m.compose(_p, _q, _s);
    this.clodInk.setMatrixAt(i, _m);
    this.clod++;
  }

  private emitStrainFx(t: Track, pose: LootPose, p: number, dt: number): void {
    const fx = this.host.effects.fx;
    const bank = t.kind === 'bank';
    const k = this.preset.particles;
    const acc = t.acc;
    const pt = { x: 0, y: 0 };
    acc.crumb += dt * (bank ? 16 : t.kind === 'largeSafe' ? 9 : 7) * k;
    while (acc.crumb >= 1) {
      acc.crumb -= 1;
      this.edgePoint(pose, t.half, 0.08, Math.random(), pt);
      fx.dust({ x: pt.x, y: pose.h, z: pt.y }, { count: 1, spread: 0.05, size: 0.07 + Math.random() * 0.05 * t.S, color: DIRT[Math.floor(Math.random() * 3)], up: 0.6 });
    }
    if (p >= 0.4) {
      acc.pebble += dt * (bank ? 10 : t.kind === 'largeSafe' ? 5 : 3) * k;
      while (acc.pebble >= 1) {
        acc.pebble -= 1;
        this.edgePoint(pose, t.half, 0.25 + Math.random() * 0.4 * t.S, Math.random(), pt);
        fx.chunks({ x: pt.x, y: pose.h, z: pt.y }, { count: 1, colors: PEBBLES, size: bank ? 0.1 : 0.06, power: 0.8, up: 0.9, spread: 0.05 });
      }
      if (bank) {
        acc.brick += dt * 6 * k;
        while (acc.brick >= 1) {
          acc.brick -= 1;
          this.edgePoint(pose, t.half, 0.05, Math.random(), pt);
          fx.chunks({ x: pt.x, y: pose.h + 0.1 + Math.random() * 0.3 + t.lift, z: pt.y }, { count: 1, colors: BRICKS, size: 0.11, power: 0.7, up: 0.5, spread: 0.05 });
        }
      }
    }
    if (p >= 0.8) {
      acc.jet += dt * (bank ? 12 : t.kind === 'largeSafe' ? 6 : 4) * k;
      while (acc.jet >= 1) {
        acc.jet -= 1;
        // Corners.
        const sx = Math.random() < 0.5 ? -1 : 1;
        const sy = Math.random() < 0.5 ? -1 : 1;
        const c = Math.cos(pose.a);
        const s = Math.sin(pose.a);
        const lx = sx * (t.half.x + 0.1);
        const ly = sy * (t.half.y + 0.1);
        fx.dust({ x: pose.x + lx * c - ly * s, y: pose.h, z: pose.y + lx * s + ly * c }, { count: 1, spread: 0.12, size: (bank ? 0.5 : 0.28) * (0.7 + Math.random() * 0.5), up: 3.4, color: '#F3E7D4' });
      }
      acc.glint += dt * (bank ? 10 : 5) * k;
      while (acc.glint >= 1) {
        acc.glint -= 1;
        this.edgePoint(pose, t.half, -0.05, Math.random(), pt);
        fx.sparkle({ x: pt.x, y: pose.h + t.height * (0.5 + Math.random() * 0.55) + t.lift, z: pt.y }, { count: 1, radius: 0.05, color: '#FFFFFF' });
      }
      this.host.shake({ x: pose.x, y: pose.y }, dt * (bank ? 0.7 : t.kind === 'largeSafe' ? 0.25 : 0.1), bank ? 26 : 12);
    } else if (bank && p >= 0.4) {
      this.host.shake({ x: pose.x, y: pose.y }, dt * 0.25, 24);
    }
  }
}

const PTS = new Float32Array((SEGS + 1) * 3);
const STUB = new Float32Array(15);

/** Loot kinds that get an uproot track. */
export function tracksLoot(kind: LootKind): boolean {
  return kind === 'bank' || kind === 'smallSafe' || kind === 'largeSafe';
}
