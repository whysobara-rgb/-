/**
 * Lightweight pooled effects the view can fire from sim events:
 *   dust puffs (unanchor, drags, landings), confetti (recoveries, wins), impact stars
 *   (dash hits, knockdowns), sparkles, gold coins, ground shock rings, and flying debris.
 *
 * Each particle family is ONE InstancedMesh (one draw call) with a fixed capacity; spawning
 * past capacity recycles the oldest particle. Nothing allocates per frame.
 */
import * as THREE from 'three';
import { PAL } from './palette';
import { G } from './geometry';
import { createToonMaterial } from './materials';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface PoolOptions {
  capacity: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
}

interface SpawnInit {
  pos: Vec3Like;
  vel: Vec3Like;
  life: number;
  size: number;
  color: THREE.ColorRepresentation;
  gravity?: number;
  drag?: number;
  spin?: number;
  /** Scale curve: 'puff' grows then shrinks, 'shrink' shrinks linearly, 'pop' pops in then shrinks. */
  curve?: 'puff' | 'shrink' | 'pop' | 'flat';
  /** Bounce off the ground (y = 0) instead of passing through. */
  ground?: boolean;
  flutter?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Fixed-capacity instanced particle pool with swap-remove packing. */
class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private n = 0;
  private next = 0;
  // Struct-of-arrays state.
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly ang: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly flut: Float32Array;
  private readonly curve: Uint8Array;
  private readonly ground: Uint8Array;
  private readonly col: Float32Array;

  constructor(o: PoolOptions) {
    this.cap = o.capacity;
    this.mesh = new THREE.InstancedMesh(o.geometry, o.material, o.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = o.castShadow ?? false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(o.capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.userData.noOutline = true;
    const c = o.capacity;
    this.pos = new Float32Array(c * 3);
    this.vel = new Float32Array(c * 3);
    this.rot = new Float32Array(c * 3);
    this.ang = new Float32Array(c * 3);
    this.life = new Float32Array(c);
    this.max = new Float32Array(c);
    this.size = new Float32Array(c);
    this.grav = new Float32Array(c);
    this.drag = new Float32Array(c);
    this.flut = new Float32Array(c);
    this.curve = new Uint8Array(c);
    this.ground = new Uint8Array(c);
    this.col = new Float32Array(c * 3);
  }

  get alive(): number {
    return this.n;
  }

  spawn(s: SpawnInit): void {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else {
      i = this.next;
      this.next = (this.next + 1) % this.cap;
    }
    this.pos.set([s.pos.x, s.pos.y, s.pos.z], i * 3);
    this.vel.set([s.vel.x, s.vel.y, s.vel.z], i * 3);
    this.rot.set([Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28], i * 3);
    const sp = s.spin ?? 0;
    this.ang.set([(Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp], i * 3);
    this.life[i] = s.life;
    this.max[i] = s.life;
    this.size[i] = s.size;
    this.grav[i] = s.gravity ?? 0;
    this.drag[i] = s.drag ?? 0;
    this.flut[i] = s.flutter ?? 0;
    this.curve[i] = { puff: 0, shrink: 1, pop: 2, flat: 3 }[s.curve ?? 'shrink'];
    this.ground[i] = s.ground ? 1 : 0;
    _c.set(s.color);
    this.col.set([_c.r, _c.g, _c.b], i * 3);
  }

  update(dt: number, time: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.copy(this.n - 1, i);
        this.n--;
        continue;
      }
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      if (this.flut[i] > 0) {
        this.vel[i3] += Math.sin(time * 7 + i) * this.flut[i] * dt;
        this.vel[i3 + 2] += Math.cos(time * 6 + i * 1.7) * this.flut[i] * dt;
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.ground[i] && this.pos[i3 + 1] < this.size[i] * 0.3) {
        this.pos[i3 + 1] = this.size[i] * 0.3;
        if (this.vel[i3 + 1] < 0) this.vel[i3 + 1] *= -0.35;
        this.vel[i3] *= 0.7;
        this.vel[i3 + 2] *= 0.7;
        this.ang[i3] *= 0.8;
        this.ang[i3 + 2] *= 0.8;
      }
      this.rot[i3] += this.ang[i3] * dt;
      this.rot[i3 + 1] += this.ang[i3 + 1] * dt;
      this.rot[i3 + 2] += this.ang[i3 + 2] * dt;
      i++;
    }
    for (let k = 0; k < this.n; k++) {
      const k3 = k * 3;
      const t = 1 - this.life[k] / this.max[k];
      let sc: number;
      switch (this.curve[k]) {
        case 0:
          sc = Math.min(1, t * 5) * (1 - t * t);
          break;
        case 2:
          sc = t < 0.15 ? t / 0.15 : 1 - Math.pow((t - 0.15) / 0.85, 2);
          break;
        case 3:
          sc = t > 0.8 ? (1 - t) / 0.2 : 1;
          break;
        default:
          sc = 1 - t;
      }
      sc = Math.max(0.0001, sc * this.size[k]);
      _p.set(this.pos[k3], this.pos[k3 + 1], this.pos[k3 + 2]);
      _e.set(this.rot[k3], this.rot[k3 + 1], this.rot[k3 + 2]);
      _q.setFromEuler(_e);
      _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(k, _m);
      this.mesh.instanceColor!.setXYZ(k, this.col[k3], this.col[k3 + 1], this.col[k3 + 2]);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  private copy(from: number, to: number): void {
    if (from === to) return;
    const f3 = from * 3;
    const t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.rot[t3 + k] = this.rot[f3 + k];
      this.ang[t3 + k] = this.ang[f3 + k];
      this.col[t3 + k] = this.col[f3 + k];
    }
    this.life[to] = this.life[from];
    this.max[to] = this.max[from];
    this.size[to] = this.size[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.flut[to] = this.flut[from];
    this.curve[to] = this.curve[from];
    this.ground[to] = this.ground[from];
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export interface FxOptions {
  dust?: number;
  confetti?: number;
  stars?: number;
  coins?: number;
  rings?: number;
  /** Ballistic pebbles / bricks / dirt clods. */
  chunks?: number;
}

/** All pooled particle effects. Add `root` to the scene, call update(dt) every frame. */
export class FxSystem {
  readonly root = new THREE.Group();
  private readonly dustPool: ParticlePool;
  private readonly confettiPool: ParticlePool;
  private readonly starPool: ParticlePool;
  private readonly sparklePool: ParticlePool;
  private readonly coinPool: ParticlePool;
  private readonly chunkPool: ParticlePool;
  private readonly rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; dur: number; r: number }[] = [];
  private readonly owned: (THREE.Material | THREE.BufferGeometry)[] = [];
  private time = 0;

  constructor(o: FxOptions = {}) {
    this.root.name = 'fx';
    const dustMat = createToonMaterial({ color: '#FFFFFF', rim: 0.5 });
    const confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    const starMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const sparkMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const coinMat = createToonMaterial({ color: '#FFFFFF', rim: 0.8, emissive: '#5A3A00', emissiveIntensity: 0.6 });
    const confGeo = new THREE.PlaneGeometry(1, 0.6);
    const sparkGeo = G.star(4, 0.28, 0.05, false);
    const coinGeo = new THREE.CylinderGeometry(1, 1, 0.22, 16).rotateX(Math.PI / 2);
    const chunkMat = createToonMaterial({ color: '#FFFFFF', rim: 0.4 });
    const chunkGeo = new THREE.DodecahedronGeometry(1, 0).scale(1, 0.7, 0.85);
    this.owned.push(dustMat, confMat, starMat, sparkMat, coinMat, confGeo, coinGeo, chunkMat, chunkGeo);
    this.dustPool = new ParticlePool({ capacity: o.dust ?? 220, geometry: G.ico(1), material: dustMat });
    this.confettiPool = new ParticlePool({ capacity: o.confetti ?? 400, geometry: confGeo, material: confMat });
    this.starPool = new ParticlePool({ capacity: o.stars ?? 96, geometry: G.star(5, 0.45, 0.35), material: starMat });
    this.sparklePool = new ParticlePool({ capacity: 160, geometry: sparkGeo, material: sparkMat });
    this.coinPool = new ParticlePool({ capacity: o.coins ?? 120, geometry: coinGeo, material: coinMat, castShadow: false });
    this.chunkPool = new ParticlePool({ capacity: o.chunks ?? 220, geometry: chunkGeo, material: chunkMat, castShadow: true });
    for (const p of this.pools()) this.root.add(p.mesh);
    const ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
    this.owned.push(ringGeo);
    for (let i = 0; i < (o.rings ?? 8); i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.userData.noOutline = true;
      this.root.add(mesh);
      this.owned.push(mat);
      this.rings.push({ mesh, mat, t: 0, dur: 1, r: 1 });
    }
  }

  /** Soft cream dust puff on the ground (unanchor, heavy drag, landing). */
  dust(pos: Vec3Like, o: { count?: number; spread?: number; size?: number; color?: THREE.ColorRepresentation; up?: number; dir?: Vec3Like | null } = {}): void {
    const n = o.count ?? 10;
    const spread = o.spread ?? 0.6;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.6, 1.6) * spread * 2;
      const d = o.dir;
      this.dustPool.spawn({
        pos: { x: pos.x + Math.cos(a) * spread * 0.4, y: pos.y + 0.12, z: pos.z + Math.sin(a) * spread * 0.4 },
        vel: { x: Math.cos(a) * sp + (d ? d.x * 2 : 0), y: rnd(0.4, 1.4) * (o.up ?? 1), z: Math.sin(a) * sp + (d ? d.z * 2 : 0) },
        life: rnd(0.55, 1.0),
        size: (o.size ?? 0.32) * rnd(0.7, 1.3),
        color: o.color ?? (Math.random() < 0.5 ? '#FFF3DE' : '#EADBC8'),
        drag: 3.2,
        gravity: -0.6,
        curve: 'puff',
        spin: 2,
      });
    }
  }

  /** Confetti burst (recoveries, wins). */
  confetti(pos: Vec3Like, o: { count?: number; colors?: readonly THREE.ColorRepresentation[]; power?: number } = {}): void {
    const n = o.count ?? 60;
    const colors = o.colors ?? PAL.confetti;
    const pw = o.power ?? 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(1.5, 4.5) * pw;
      this.confettiPool.spawn({
        pos: { x: pos.x, y: pos.y + 0.2, z: pos.z },
        vel: { x: Math.cos(a) * sp * 0.6, y: rnd(5, 9) * pw, z: Math.sin(a) * sp * 0.6 },
        life: rnd(1.8, 2.8),
        size: rnd(0.12, 0.2),
        color: colors[i % colors.length],
        drag: 1.6,
        gravity: 7,
        spin: 14,
        flutter: 6,
        curve: 'flat',
        ground: true,
      });
    }
  }

  /** Cartoon impact stars (dash hit, knockdown). */
  stars(pos: Vec3Like, o: { count?: number; size?: number; color?: THREE.ColorRepresentation } = {}): void {
    const n = o.count ?? 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      this.starPool.spawn({
        pos: { x: pos.x, y: pos.y + 0.6, z: pos.z },
        vel: { x: Math.cos(a) * rnd(2.5, 4), y: rnd(2, 4), z: Math.sin(a) * rnd(2.5, 4) },
        life: rnd(0.45, 0.7),
        size: (o.size ?? 0.16) * rnd(0.8, 1.2),
        color: o.color ?? (i % 3 === 0 ? '#FFFFFF' : PAL.gold),
        drag: 4,
        gravity: 6,
        spin: 12,
        curve: 'pop',
      });
    }
  }

  /** Twinkly additive sparkles (loading a safe, zone completion). */
  sparkle(pos: Vec3Like, o: { count?: number; radius?: number; color?: THREE.ColorRepresentation } = {}): void {
    const n = o.count ?? 10;
    const r = o.radius ?? 0.6;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparklePool.spawn({
        pos: { x: pos.x + Math.cos(a) * r * Math.random(), y: pos.y + rnd(0.2, 1.2), z: pos.z + Math.sin(a) * r * Math.random() },
        vel: { x: 0, y: rnd(0.4, 1.2), z: 0 },
        life: rnd(0.5, 0.9),
        size: rnd(0.12, 0.24),
        color: o.color ?? '#FFF1B8',
        spin: 3,
        curve: 'pop',
      });
    }
  }

  /** Gold coins popping out (recovered score). */
  coins(pos: Vec3Like, o: { count?: number; power?: number } = {}): void {
    const n = o.count ?? 12;
    const pw = o.power ?? 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.coinPool.spawn({
        pos: { x: pos.x, y: pos.y + 0.5, z: pos.z },
        vel: { x: Math.cos(a) * rnd(1, 3) * pw, y: rnd(5, 8) * pw, z: Math.sin(a) * rnd(1, 3) * pw },
        life: rnd(1.2, 1.8),
        size: 0.13,
        color: i % 4 === 0 ? PAL.goldLight : PAL.gold,
        gravity: 16,
        drag: 0.5,
        spin: 16,
        curve: 'flat',
        ground: true,
      });
    }
  }

  /**
   * Ballistic chunks that bounce and settle (pebbles popping out of cracks, bricks crumbling off
   * a foundation, dirt clods in an uproot explosion). `dir` biases the throw (ground plane).
   */
  chunks(
    pos: Vec3Like,
    o: { count?: number; colors?: readonly THREE.ColorRepresentation[]; size?: number; power?: number; up?: number; spread?: number; dir?: Vec3Like | null; life?: number } = {},
  ): void {
    const n = o.count ?? 6;
    const colors = o.colors ?? ['#8A6748', '#6A4E37', '#A47E5C'];
    const pw = o.power ?? 1;
    const spread = o.spread ?? 0.2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.6, 2.2) * pw;
      const d = o.dir;
      this.chunkPool.spawn({
        pos: { x: pos.x + Math.cos(a) * spread * Math.random(), y: pos.y + 0.05, z: pos.z + Math.sin(a) * spread * Math.random() },
        vel: { x: Math.cos(a) * sp + (d ? d.x * pw * 2.5 : 0), y: rnd(2, 4.5) * pw * (o.up ?? 1), z: Math.sin(a) * sp + (d ? d.z * pw * 2.5 : 0) },
        life: (o.life ?? 1.4) * rnd(0.8, 1.2),
        size: (o.size ?? 0.09) * rnd(0.6, 1.4),
        color: colors[i % colors.length]!,
        gravity: 15,
        drag: 0.4,
        spin: 14,
        curve: 'flat',
        ground: true,
      });
    }
  }

  /** Expanding flat ring on the ground (impacts, unanchor, zone completion). */
  ring(pos: Vec3Like, o: { radius?: number; color?: THREE.ColorRepresentation; duration?: number } = {}): void {
    let slot = this.rings.find((r) => !r.mesh.visible);
    if (!slot) slot = this.rings.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    slot.mesh.position.set(pos.x, pos.y + 0.03, pos.z);
    slot.mat.color.set(o.color ?? '#FFFFFF');
    slot.t = 0;
    slot.dur = o.duration ?? 0.6;
    slot.r = o.radius ?? 2.2;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(0.01);
  }

  update(dt: number): void {
    this.time += dt;
    this.dustPool.update(dt, this.time);
    this.confettiPool.update(dt, this.time);
    this.starPool.update(dt, this.time);
    this.sparklePool.update(dt, this.time);
    this.coinPool.update(dt, this.time);
    this.chunkPool.update(dt, this.time);
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(Math.max(0.01, e * r.r));
      r.mat.opacity = 0.9 * (1 - k);
    }
  }

  /** Number of live particles (debug/stats). */
  get activeCount(): number {
    let n = 0;
    for (const p of this.pools()) n += p.alive;
    return n;
  }

  private pools(): ParticlePool[] {
    return [this.dustPool, this.confettiPool, this.starPool, this.sparklePool, this.coinPool, this.chunkPool];
  }

  clear(): void {
    for (const p of this.pools()) p.clear();
    for (const r of this.rings) r.mesh.visible = false;
  }

  dispose(): void {
    for (const p of this.pools()) p.dispose();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Debris (fence break): a handful of rigid pieces with simple ballistic motion
// ---------------------------------------------------------------------------

export interface DebrisPieceSpec {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Initial world transform. */
  matrix: THREE.Matrix4;
  velocity: THREE.Vector3;
  angular: THREE.Vector3;
  /** Approx. half height for ground contact. */
  radius: number;
}

/** Self-contained debris animation; add `root` to the scene and update until it returns false. */
export class DebrisBurst {
  readonly root = new THREE.Group();
  private readonly pieces: { mesh: THREE.Mesh; vel: THREE.Vector3; ang: THREE.Vector3; r: number; rest: number }[] = [];
  private t = 0;
  private readonly lifetime: number;

  constructor(specs: DebrisPieceSpec[], lifetime = 3.2) {
    this.root.name = 'debris';
    this.lifetime = lifetime;
    for (const s of specs) {
      const mesh = new THREE.Mesh(s.geometry, s.material);
      s.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.noOutline = true;
      this.root.add(mesh);
      this.pieces.push({ mesh, vel: s.velocity.clone(), ang: s.angular.clone(), r: s.radius, rest: 0 });
    }
  }

  /** Returns false once finished (then remove `root` / call dispose). */
  update(dt: number): boolean {
    this.t += dt;
    const fade = THREE.MathUtils.clamp((this.lifetime - this.t) / 0.6, 0, 1);
    for (const p of this.pieces) {
      p.vel.y -= 18 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < p.r) {
        p.mesh.position.y = p.r;
        if (p.vel.y < 0) p.vel.y *= -0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        p.ang.multiplyScalar(0.6);
      }
      _e.set(p.ang.x * dt, p.ang.y * dt, p.ang.z * dt);
      _q.setFromEuler(_e);
      p.mesh.quaternion.premultiply(_q);
      const s = Math.max(0.001, fade);
      p.mesh.scale.setScalar(s);
    }
    return this.t < this.lifetime;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
