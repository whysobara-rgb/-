/**
 * Emotes: hand-drawn sticker icons (models/art.ts, no emoji) popping over characters' heads —
 * "!", "?", anger veins, sweat, sparkles, hearts, notes, dizzy swirls, panic lines, the
 * determination flame, ^^, >_<, !?, whistle, the officers' "stop" paw, breath puffs, coins,
 * tears and z's.
 *
 * Rendering: ONE instanced billboard draw call for every emote on screen (custom shader: camera
 * facing, per-instance atlas cell / rotation / alpha). Emotes draw on top of the scene (no depth
 * test) so they always read, like name plates.
 *
 * Each owner (character id, or POLICE_OWNER + officer id) has two slots: a bubble above the head
 * and a free "side" sticker beside it (sweat, panic lines, swirl, flame...). A new emote replaces
 * the slot's current one when its priority is at least as high or the old one is ending.
 * Animation: back-out pop in, per-kind idle motion (heart beat, note sway, swirl spin, sweat
 * slide, anger pulse, "!" shake), quick shrink out. Bubbles (and the text / glyphs inside them)
 * never rotate: their sway and shakes are sideways translation and scale; only the free side
 * stickers (dizzy swirl, sparkle) may spin. Reduced motion keeps pop-ins but drops the
 * idle wiggles.
 */
import * as THREE from 'three';
import { EMOTE_ATLAS, EMOTE_BUBBLED, EMOTE_CELLS, emoteAtlasTexture, type EmoteKind } from './models/art';
import { emoteSlotRotation } from './upright';

export type { EmoteKind } from './models/art';

/** Owner key offset for police officers (character ids are small). */
export const POLICE_OWNER = 100000;

export interface EmoteOptions {
  /** Seconds on screen (ignored with loop). Default per kind. */
  duration?: number;
  /** Higher replaces lower; equal replaces too. Default 1. */
  priority?: number;
  /** Stay until hide()/replaced. */
  loop?: boolean;
  /** Size multiplier. */
  scale?: number;
}

interface Slot {
  kind: EmoteKind;
  age: number;
  dur: number;
  loop: boolean;
  priority: number;
  scale: number;
  /** Seconds left in the pop-out (>= 0 while leaving). */
  out: number;
  seed: number;
}

interface OwnerState {
  bubble: Slot | null;
  side: Slot | null;
  /** Previous bubble shrinking out while a new one pops in. */
  leaving: Slot | null;
  /** Declutter (smoothed): bubble shift along camera-right, extra lift, side sticker scale. */
  dx: number;
  lift: number;
  sideK: number;
}

/** Owners whose heads are closer than this (m, ground plane) share one sticker cluster. */
const CLUSTER_DIST = 1.6;
/** Bubble spacing inside a cluster (m along camera-right). */
const CLUSTER_SPACING = 0.95;
/**
 * Smallest bubble offset to the right of its own head (m along camera-right). The atlas tail
 * points down-left, so a bubble must never sit left of its speaker or the tail points away.
 */
const BUBBLE_MIN_DX = 0.24;

interface Gathered {
  owner: number;
  st: OwnerState;
  pos: THREE.Vector3;
  r: number;
  prio: number;
  cluster: number;
  /** Fanned bubble offset before the cluster is shifted right of every speaker. */
  fan: number;
}

const DEFAULT_DUR: Partial<Record<EmoteKind, number>> = {
  exclaim: 1.1,
  question: 1.4,
  angry: 1.6,
  sweat: 1.6,
  sparkle: 1.3,
  heart: 1.8,
  note: 1.6,
  dizzy: 1.5,
  panic: 1.2,
  flame: 1.6,
  happy: 1.5,
  strain: 1.2,
  shock: 1.3,
  whistle: 1.2,
  stop: 1.3,
  puff: 1.0,
  coin: 1.5,
  tear: 2.0,
  zzz: 2.0,
};

const POP_IN = 0.17;
const POP_OUT = 0.14;
const BUBBLE_SIZE = 0.82;
const SIDE_SIZE = 0.72;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _base = new THREE.Vector3();

function backOut(k: number): number {
  const c1 = 2.2;
  const c3 = c1 + 1;
  const x = k - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

export class EmoteSystem {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly data: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.PlaneGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly owners = new Map<number, OwnerState>();
  private readonly cap: number;
  private seed = 1;
  private readonly gathered: Gathered[] = [];
  private readonly posPool: THREE.Vector3[] = [];
  /** Drop idle wiggles (pop-ins stay). */
  calm = false;

  constructor(capacity = 64) {
    this.cap = capacity;
    this.root.name = 'emotes';
    this.geo = new THREE.PlaneGeometry(1, 1);
    const { cols, rows } = EMOTE_ATLAS;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: emoteAtlasTexture() } },
      defines: { COLS: `${cols}.0`, ROWS: `${rows}.0` },
      vertexShader: /* glsl */ `
        attribute vec4 iData; // cell, rotation, alpha, -
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float s = length(instanceMatrix[0].xyz);
          float c = cos(iData.y);
          float sn = sin(iData.y);
          vec2 p = vec2(c * position.x - sn * position.y, sn * position.x + c * position.y);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = center + (right * p.x + up * p.y) * s;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          float col = mod(iData.x, COLS);
          float row = floor(iData.x / COLS + 0.001);
          vUv = (vec2(col, ROWS - 1.0 - row) + uv) / vec2(COLS, ROWS);
          vAlpha = iData.z;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          if (t.a * vAlpha < 0.02) discard;
          // Slightly under 1.0 so white stickers never trigger the bloom pass.
          gl_FragColor = vec4(t.rgb * 0.93, t.a * vAlpha);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity * 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.userData.noOutline = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3 * 4), 4);
    this.data.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iData', this.data);
    this.root.add(this.mesh);
  }

  /** Show an emote; returns true when it actually (re)started (play the pop sound then). */
  show(owner: number, kind: EmoteKind, o: EmoteOptions = {}): boolean {
    let st = this.owners.get(owner);
    if (!st) {
      if (this.owners.size >= this.cap) return false;
      st = { bubble: null, side: null, leaving: null, dx: 0.28, lift: 0, sideK: -1 };
      this.owners.set(owner, st);
    }
    const bubbled = EMOTE_BUBBLED.has(kind);
    const cur = bubbled ? st.bubble : st.side;
    const prio = o.priority ?? 1;
    if (cur && cur.out < 0) {
      const ending = !cur.loop && cur.age > cur.dur - 0.25;
      if (cur.kind === kind) {
        // Refresh instead of re-popping (keeps loops steady).
        cur.dur = Math.max(cur.dur, cur.age + (o.duration ?? DEFAULT_DUR[kind] ?? 1.4));
        cur.loop = o.loop ?? cur.loop;
        cur.priority = Math.max(cur.priority, prio);
        return false;
      }
      if (prio < cur.priority && !ending) return false;
    }
    const slot: Slot = {
      kind,
      age: 0,
      dur: o.duration ?? DEFAULT_DUR[kind] ?? 1.4,
      loop: !!o.loop,
      priority: prio,
      scale: o.scale ?? 1,
      out: -1,
      seed: (this.seed = (this.seed * 16807) % 2147483647) / 2147483647,
    };
    if (bubbled) {
      if (cur && cur.out < 0) {
        cur.out = POP_OUT * 0.7;
        st.leaving = cur;
      }
      st.bubble = slot;
    } else st.side = slot;
    return true;
  }

  /** End an owner's emote of `kind` (or every emote of the owner). */
  hide(owner: number, kind?: EmoteKind): void {
    const st = this.owners.get(owner);
    if (!st) return;
    for (const s of [st.bubble, st.side]) if (s && (!kind || s.kind === kind) && s.out < 0) s.out = POP_OUT;
  }

  /** Current emote kinds of an owner (debug / tests). */
  current(owner: number): EmoteKind[] {
    const st = this.owners.get(owner);
    if (!st) return [];
    return [st.bubble, st.side].filter((s): s is Slot => !!s && s.out < 0).map((s) => s.kind);
  }

  get activeCount(): number {
    return this.mesh.count;
  }

  /**
   * Advance and lay out. `anchor` writes the owner's head-top world position into `out` and
   * returns false when the owner is gone/hidden (its emotes are dropped).
   */
  update(dt: number, camera: THREE.Camera, anchor: (owner: number, out: THREE.Vector3) => boolean): void {
    const right = _a.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    let n = 0;
    const max = this.cap * 3;
    // --- gather anchors, then declutter overlapping owners --------------------------
    // (a tackle puts officer + victim in one spot: their stickers would stack and hide both)
    const g = this.gathered;
    g.length = 0;
    for (const [owner, st] of this.owners) {
      if (!anchor(owner, _p)) {
        this.owners.delete(owner);
        continue;
      }
      const pos = this.posPool[g.length] ?? (this.posPool[g.length] = new THREE.Vector3());
      pos.copy(_p);
      let prio = -1;
      for (const sl of [st.bubble, st.side]) if (sl && sl.out < 0) prio = Math.max(prio, sl.priority + (sl === st.bubble ? 0.5 : 0));
      g.push({ owner, st, pos, r: pos.dot(right), prio, cluster: g.length, fan: 0.28 });
    }
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i]!;
        const b = g[j]!;
        if (a.cluster === b.cluster) continue;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > CLUSTER_DIST) continue;
        const from = b.cluster;
        for (const q of g) if (q.cluster === from) q.cluster = a.cluster;
      }
    }
    const k = 1 - Math.exp(-Math.max(0, dt) * 14);
    for (const e of g) {
      let m = 0;
      let idx = 0;
      let sum = 0;
      for (const q of g) {
        if (q.cluster !== e.cluster) continue;
        m++;
        sum += q.r;
        if (q.r < e.r || (q.r === e.r && q.owner < e.owner)) idx++;
      }
      e.fan = m > 1 ? sum / m + (idx - (m - 1) / 2) * CLUSTER_SPACING - e.r : 0.28;
    }
    for (const e of g) {
      // Shift the whole fan right until every bubble sits right of its own speaker, so each
      // down-left tail still points at (the side of) its speaker's head.
      let shift = 0;
      for (const q of g) if (q.cluster === e.cluster) shift = Math.max(shift, BUBBLE_MIN_DX - q.fan);
      let m = 0;
      let top: Gathered = e;
      for (const q of g) {
        if (q.cluster !== e.cluster) continue;
        m++;
        if (q.prio > top.prio || (q.prio === top.prio && q.owner < top.owner)) top = q;
      }
      let wantDx = 0.28;
      let wantLift = 0;
      let wantSide = 1;
      if (m > 1) {
        // Fan the bubbles out side by side above the group, lift them clear of the actors,
        // and keep only the most important owner's side sticker.
        wantDx = e.fan + shift;
        wantLift = 0.3;
        wantSide = top === e ? 1 : 0;
      }
      const st = e.st;
      if (dt <= 0 || st.sideK < 0) {
        st.dx = wantDx;
        st.lift = wantLift;
        st.sideK = wantSide;
      } else {
        st.dx += (wantDx - st.dx) * k;
        st.lift += (wantLift - st.lift) * k;
        st.sideK += (wantSide - st.sideK) * k;
      }
    }
    for (const e of g) {
      const owner = e.owner;
      const st = e.st;
      const base = _base.copy(e.pos);
      for (const which of ['leaving', 'bubble', 'side'] as const) {
        const s = st[which];
        if (!s) continue;
        s.age += dt;
        if (s.out < 0 && !s.loop && s.age >= s.dur) s.out = POP_OUT;
        if (s.out >= 0) {
          s.out -= dt;
          if (s.out < 0) {
            st[which] = null;
            continue;
          }
        }
        if (n >= max) continue;
        const bubbled = which !== 'side';
        if (!bubbled && st.sideK < 0.05) continue;
        let scale = (bubbled ? BUBBLE_SIZE : SIDE_SIZE) * s.scale * (bubbled ? 1 : st.sideK);
        let rot = 0;
        let alpha = 1;
        let ox = 0;
        let oy = 0;
        const t = s.age;
        // Pop in / out.
        if (t < POP_IN) scale *= Math.max(0.01, backOut(t / POP_IN));
        if (s.out >= 0) {
          const k = s.out / POP_OUT;
          scale *= 0.2 + 0.8 * k;
          alpha = k;
          oy += (1 - k) * 0.25;
        }
        if (!this.calm) {
          switch (s.kind) {
            case 'exclaim':
            case 'shock':
              if (t < 0.45) ox += Math.sin(t * 70) * 0.04 * (1 - t / 0.45);
              scale *= 1 + 0.08 * Math.max(0, Math.sin(t * 9));
              break;
            case 'angry':
              scale *= 1 + 0.16 * Math.abs(Math.sin(t * 12));
              break;
            case 'heart':
              scale *= 1 + 0.14 * Math.pow(Math.max(0, Math.sin(t * 9)), 4);
              oy += t * 0.12;
              break;
            case 'note':
            case 'whistle':
              // Sway sideways (translate) with a little hum pulse; the bubble stays level.
              ox += Math.sin(t * 6 + s.seed * 6) * 0.035;
              scale *= 1 + 0.05 * Math.max(0, Math.sin(t * 6 + s.seed * 6 + 1.2));
              oy += Math.sin(t * 5) * 0.04 + t * 0.08;
              break;
            case 'dizzy':
              rot = -t * 5;
              break;
            case 'sweat':
              oy -= ((t * 0.7 + s.seed) % 1) * 0.18;
              break;
            case 'sparkle':
              rot = t * 1.2;
              scale *= 0.9 + 0.2 * Math.abs(Math.sin(t * 7 + s.seed * 5));
              break;
            case 'panic':
              ox += Math.sin(t * 50) * 0.025;
              oy += Math.sin(t * 43) * 0.02;
              break;
            case 'flame':
              scale *= 1 + 0.08 * Math.sin(t * 24);
              break;
            case 'puff':
              ox += t * 0.3;
              oy += t * 0.15;
              alpha *= Math.max(0, 1 - t / Math.max(0.3, s.dur));
              break;
            case 'zzz':
            case 'tear':
              oy += t * 0.1;
              break;
            case 'stop':
              // Paw "wave": quick sideways jitter + pulse (no rotation of the bubble).
              ox += Math.sin(t * 14) * 0.03;
              scale *= 1 + 0.06 * Math.abs(Math.sin(t * 14));
              break;
            default:
              break;
          }
        }
        _s.set(scale, scale, scale);
        if (bubbled) {
          _p.copy(base).addScaledVector(right, st.dx + ox);
          _p.y += 0.42 + st.lift + oy;
        } else {
          _p.copy(base).addScaledVector(right, -0.5 + ox);
          _p.y += 0.02 + st.lift * 0.5 + oy;
        }
        _m.compose(_p, _q.identity(), _s);
        this.mesh.setMatrixAt(n, _m);
        this.data.setXYZW(n, EMOTE_CELLS[s.kind], emoteSlotRotation(bubbled, rot), alpha, 0);
        n++;
      }
      if (!st.bubble && !st.side && !st.leaving) this.owners.delete(owner);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.data.needsUpdate = true;
  }

  clear(): void {
    this.owners.clear();
    this.mesh.count = 0;
  }

  dispose(): void {
    this.clear();
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}
