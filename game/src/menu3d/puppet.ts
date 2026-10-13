/**
 * A real game raccoon (createRaccoon) driven by menu "acts" instead of sim state.
 *
 * The rig's own pose system does the heavy lifting (walk cycle, grab, strain, dash lean,
 * cheer, sad slump, tumble, expressions). On top of it a puppet adds what menus need:
 *  - root-level juice: hop, squash & stretch about the feet, lean, spin, pop-in scale;
 *  - limb overrides applied after the rig update (wave one paw, stretch, tinker) — the rig
 *    names its parts ('raccoon:armR'...), and when a part is missing the override is skipped;
 *  - small helpers to pop hats on with a bounce.
 */
import * as THREE from 'three';
import type { CharacterLook, HatId, TeamId } from '../sim/types';
import { createRaccoon, idlePose, type RaccoonExpression, type RaccoonPose, type RaccoonRig } from '../render/models';
import { easeOutBack } from './scene';
import { allowTransparentBatching } from './batcher';

export type Act =
  | 'idle'
  | 'dash' // running in place, leaning forward, speed lines
  | 'stretch' // arms up, side bends
  | 'tryHat' // hat pops on/off (driven by the scene)
  | 'tinker' // reaching forward, paw jiggle (wrench)
  | 'wave' // one paw waving bye
  | 'cheer'
  | 'strain' // pulling (effort 0..1 from the scene)
  | 'sad'
  | 'smug' // nunchi-style sly sway
  | 'flex' // tongkeun: big proud bounce
  | 'hop'; // excited hopping

export interface PuppetOptions {
  team: TeamId | null;
  look: CharacterLook;
  /** Base position / facing (radians around +Y; 0 = facing +X like the rig). */
  pos?: THREE.Vector3;
  yaw?: number;
  scale?: number;
}

const tmp = new THREE.Vector3();

let silMat: THREE.MeshBasicMaterial | null = null;
let eyeGeo: THREE.BufferGeometry | null = null;
let eyeMat: THREE.MeshBasicMaterial | null = null;
function eyeGeometry(): THREE.BufferGeometry {
  if (!eyeGeo) eyeGeo = new THREE.SphereGeometry(0.055, 10, 8);
  return eyeGeo;
}
function eyeMaterial(): THREE.MeshBasicMaterial {
  if (!eyeMat) {
    eyeMat = new THREE.MeshBasicMaterial({ color: '#FFF3B0', toneMapped: false });
    eyeMat.name = 'menu3d:silEyes';
  }
  return eyeMat;
}

/** Shared flat dark-violet material for silhouettes. */
export function silhouetteMaterial(): THREE.MeshBasicMaterial {
  if (!silMat) {
    silMat = new THREE.MeshBasicMaterial({ color: '#3A2A66' });
    silMat.name = 'menu3d:silhouette';
  }
  return silMat;
}

export class Puppet {
  readonly rig: RaccoonRig;
  /** Outer group the scene places; the rig root sits inside (juice applies to the rig root). */
  readonly holder = new THREE.Group();
  readonly pose: RaccoonPose = idlePose(0);
  act: Act = 'idle';
  /** Seconds in the current act. */
  actTime = 0;
  /** 0..1 pull effort for 'strain'. */
  effort = 0;
  expression: RaccoonExpression | null = null;
  /** Head turn override (radians), null = rig idle look-around. */
  headYaw: number | null = null;
  /** Visibility pop (0 hidden .. 1 shown) with overshoot. */
  private popT = 1;
  private popDir = 0;
  private hopT = 9;
  private hopH = 0;
  private readonly parts: Partial<Record<'armL' | 'armR' | 'head' | 'body', THREE.Object3D>> = {};
  private readonly baseScale: number;
  private silhouetted = false;
  private eyes: THREE.Group | null = null;
  private readonly savedMats = new Map<THREE.Mesh, THREE.Material>();
  private readonly seed: number;

  constructor(o: PuppetOptions) {
    this.rig = createRaccoon({ team: o.team, look: o.look });
    this.holder.add(this.rig.root);
    this.holder.name = 'menu3d:puppet';
    if (o.pos) this.holder.position.copy(o.pos);
    this.holder.rotation.y = o.yaw ?? 0;
    this.baseScale = o.scale ?? 1;
    this.holder.scale.setScalar(this.baseScale);
    for (const n of ['armL', 'armR', 'head', 'body'] as const) {
      const p = this.rig.root.getObjectByName(`raccoon:${n}`);
      if (p) this.parts[n] = p;
    }
    this.seed = Math.random() * 10;
    // Flat ground blob shadows may share one batched draw (no sorting issue between them).
    const blob = this.rig.root.getObjectByName('raccoon:blob') as THREE.Mesh | undefined;
    if (blob && !Array.isArray(blob.material)) allowTransparentBatching(blob.material);
  }

  get root(): THREE.Object3D {
    return this.holder;
  }

  /** Paw anchor for props (right arm part); null when the rig has no named arm. */
  get rightPaw(): THREE.Object3D | null {
    return this.parts.armR ?? null;
  }

  setAct(a: Act): void {
    if (a === this.act) return;
    this.act = a;
    this.actTime = 0;
  }

  setLook(look: CharacterLook): void {
    this.rig.setLook(look);
  }

  setHat(hat: HatId): void {
    this.rig.setLook({ ...this.rig.look, hat });
  }

  /** Little vertical hop (meters). */
  hop(height = 0.35): void {
    this.hopT = 0;
    this.hopH = height;
  }

  /** Pop in (true) / out (false) with an overshoot scale. */
  popIn(show: boolean, instant = false): void {
    this.popDir = show ? 1 : -1;
    if (instant) {
      this.popT = show ? 1 : 0;
      this.popDir = 0;
    }
  }

  get shown(): boolean {
    return this.popT > 0.001 || this.popDir > 0;
  }

  update(dt: number, t: number, reducedMotion: boolean): void {
    this.actTime += dt;
    const p = this.pose;
    p.time = t + this.seed;
    p.speed = 0;
    p.grabbing = false;
    p.straining = false;
    p.dashing = false;
    p.boosting = false;
    p.knockedDown = false;
    p.celebrating = false;
    p.sad = false;
    p.effort = undefined;
    p.expression = this.expression;
    p.headYaw = this.headYaw ?? undefined;
    const a = this.act;
    switch (a) {
      case 'dash':
        p.dashing = true;
        p.speed = 9;
        p.expression = this.expression ?? 'determined';
        break;
      case 'stretch':
        p.celebrating = true;
        p.expression = this.expression ?? 'happy';
        break;
      case 'cheer':
        p.celebrating = true;
        break;
      case 'tinker':
        p.grabbing = true;
        p.expression = this.expression ?? 'determined';
        break;
      case 'strain':
        p.grabbing = true;
        p.straining = this.effort > 0.02;
        p.effort = this.effort;
        break;
      case 'sad':
        p.sad = true;
        break;
      case 'smug':
        p.expression = this.expression ?? 'sly';
        p.speed = 0.6;
        break;
      case 'flex':
        p.celebrating = Math.sin(this.actTime * 3) > -0.2;
        p.expression = this.expression ?? 'happy';
        break;
      case 'hop':
        p.expression = this.expression ?? 'happy';
        break;
      case 'wave':
        p.expression = this.expression ?? 'happy';
        break;
      default:
        break;
    }
    this.rig.update(dt, p);

    // --- limb overrides after the rig pose -------------------------------------------------
    const armR = this.parts.armR;
    const armL = this.parts.armL;
    if (a === 'wave' && armR) {
      armR.rotation.set(-0.5, 0, 2.75 + Math.sin(this.actTime * 11) * 0.45);
    }
    if (a === 'stretch' && armR && armL) {
      const bend = Math.sin(this.actTime * 1.8);
      armR.rotation.z = 2.9 + bend * 0.15;
      armL.rotation.z = 2.9 - bend * 0.15;
    }
    if (a === 'tinker' && armR) {
      armR.rotation.z = 1.45 + Math.sin(this.actTime * 14) * 0.25;
      armR.rotation.x = -0.25 + Math.sin(this.actTime * 7) * 0.12;
    }

    // --- root juice ----------------------------------------------------------------------
    const r = this.rig.root;
    let y = 0;
    let sy = 1;
    let lean = 0;
    let roll = 0;
    if (!reducedMotion) {
      if (a === 'stretch') roll = Math.sin(this.actTime * 1.8) * 0.22;
      if (a === 'smug') roll = Math.sin(this.actTime * 2.2) * 0.08;
      if (a === 'flex') {
        const k = Math.abs(Math.sin(this.actTime * 3));
        y += k * 0.08;
        sy = 1 + Math.sin(this.actTime * 6) * 0.04;
      }
      if (a === 'hop') {
        const k = (this.actTime * 2.4) % 1;
        y += Math.sin(k * Math.PI) * 0.32;
        sy = k < 0.08 || k > 0.92 ? 0.86 : 1.06;
      }
      if (a === 'dash') lean = -0.12;
      if (this.hopT < 1) {
        this.hopT += dt * 2.6;
        const k = Math.min(1, this.hopT);
        y += Math.sin(k * Math.PI) * this.hopH;
        sy *= k < 0.12 ? 0.85 : k > 0.9 ? 0.9 : 1.05;
      }
    }
    // pop in / out
    if (this.popDir !== 0) {
      this.popT += this.popDir * dt * (this.popDir > 0 ? 2.8 : 4.5);
      if ((this.popDir > 0 && this.popT >= 1) || (this.popDir < 0 && this.popT <= 0)) {
        this.popT = Math.min(1, Math.max(0, this.popT));
        this.popDir = 0;
      }
    }
    const pk = reducedMotion ? (this.popT > 0.5 ? 1 : 0) : this.popDir < 0 ? this.popT : easeOutBack(this.popT, 2.4);
    r.visible = pk > 0.001;
    r.position.set(0, y, 0);
    r.rotation.set(roll, 0, lean);
    const s = Math.max(0.0001, pk);
    r.scale.set(s / Math.sqrt(sy), s * sy, s / Math.sqrt(sy));
  }

  /** Dark silhouette (mystery rivals): every part drawn flat, face hidden. */
  setSilhouette(on: boolean): void {
    if (on === this.silhouetted) return;
    this.silhouetted = on;
    this.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.isOutlineHull) return;
      if (m.name === 'raccoon:face' || m.name === 'raccoon:mask' || m.name === 'raccoon:blob') {
        m.layers.set(on ? 31 : 0);
        return;
      }
      if (on) {
        if (!this.savedMats.has(m)) this.savedMats.set(m, m.material as THREE.Material);
        m.material = silhouetteMaterial();
      } else {
        const orig = this.savedMats.get(m);
        if (orig) m.material = orig;
      }
    });
    if (!on) this.savedMats.clear();
    if (on && !this.eyes && this.parts.head) {
      const eyes = new THREE.Group();
      for (const z of [-0.1, 0.1]) {
        const e = new THREE.Mesh(eyeGeometry(), eyeMaterial());
        e.position.set(0.27, 0.15, z);
        e.scale.set(0.6, 1, 1);
        e.userData.noOutline = true;
        eyes.add(e);
      }
      this.parts.head.add(eyes);
      this.eyes = eyes;
    }
    if (this.eyes) this.eyes.visible = on;
  }

  /** World position of the head top (for labels / sparkles). */
  headTop(out = tmp): THREE.Vector3 {
    const head = this.parts.head;
    if (head) head.getWorldPosition(out);
    else this.holder.getWorldPosition(out).setY(1);
    out.y += 0.45 * this.baseScale;
    return out;
  }

  dispose(): void {
    this.eyes?.removeFromParent();
    this.rig.dispose();
    this.holder.removeFromParent();
  }
}
