/**
 * Weak fence (doc §5: 은행으로 표시된 약한 펜스): a cheerful striped barricade carrying round
 * "bank can break through" plates (bank pictogram + crack). Only a moving bank breaks it;
 * breakApart() hides the barricade, leaves splintered post stumps and returns a DebrisBurst
 * of flying planks / plates for the view to animate.
 *
 * The fence is placed at its FenceDef center/angle on creation; its long axis is whichever
 * half extent is larger.
 */
import * as THREE from 'three';
import type { FenceDef, Vec2 } from '../../sim/types';
import { FENCE } from '../../sim/config';
import { PAL } from './palette';
import { G, PartBuilder, rng, hashString } from './geometry';
import { matTextured, matVC } from './materials';
import { fenceIconTexture } from './textures';
import { DebrisBurst, type DebrisPieceSpec } from './fx';
import { Highlighter } from './outline';

export interface FenceRig {
  readonly root: THREE.Group;
  readonly id: string;
  readonly broken: boolean;
  /**
   * Break the fence. `dir` = sim-space push direction (e.g. the bank's velocity), optional.
   * Returns flying debris; add `burst.root` to the scene and update it until it ends.
   */
  breakApart(dir?: Vec2 | null): DebrisBurst;
  /** Restore (e.g. when restarting a match with the same scene). */
  reset(): void;
  setHighlight(color: THREE.ColorRepresentation | null): void;
  dispose(): void;
}

const HEIGHT = FENCE.height;
const RAIL_YS = [0.42, 1.0];
const RAIL_H = 0.2;
const RAIL_T = 0.07;
const STRIPE = 0.32;

interface FenceLayout {
  len: number;
  posts: number[];
  signBays: number[];
}

function layoutFor(len: number): FenceLayout {
  const bays = Math.max(1, Math.ceil(len / 1.6));
  const posts: number[] = [];
  for (let i = 0; i <= bays; i++) posts.push(-len / 2 + (i * len) / bays);
  // Plates on every bay for short fences, otherwise alternate bays centered on the middle.
  const mid = Math.floor(bays / 2);
  const signBays: number[] = [];
  for (let i = 0; i < bays; i++) if (bays <= 2 || (i - mid) % 2 === 0) signBays.push(i);
  return { len, posts, signBays };
}

/** One striped rail piece between u0 and u1 (fence frame: +x along the fence). */
function addRail(b: PartBuilder, u0: number, u1: number, y: number, phase: number): void {
  const n = Math.max(1, Math.round((u1 - u0) / STRIPE));
  const w = (u1 - u0) / n;
  for (let k = 0; k < n; k++) {
    b.add(G.rbox(w + 0.002, RAIL_H, RAIL_T, 0.025), {
      color: (k + phase) % 2 === 0 ? PAL.fenceStripe : PAL.fence,
      pos: [u0 + (k + 0.5) * w, y, 0],
    });
  }
}

function addPost(b: PartBuilder, u: number, h: number): void {
  b.add(G.rbox(0.14, h, 0.14, 0.04), { color: PAL.fence, pos: [u, h / 2, 0] });
  b.add(G.rbox(0.22, 0.12, 0.22, 0.04), { color: PAL.steelDark, pos: [u, 0.06, 0] });
  if (h > 1) b.add(G.sphere(12, 8), { color: PAL.fenceStripe, pos: [u, h + 0.05, 0], scale: 0.1 });
}

function buildIntact(L: FenceLayout): { body: THREE.BufferGeometry; signs: THREE.BufferGeometry } {
  const b = new PartBuilder();
  for (const u of L.posts) addPost(b, u, HEIGHT);
  for (let i = 0; i < L.posts.length - 1; i++) {
    RAIL_YS.forEach((y, r) => addRail(b, L.posts[i] + 0.07, L.posts[i + 1] - 0.07, y, (i + r) % 2));
  }
  // Warning tape tied to the first post.
  b.add(G.box(), { color: '#FFE14D', pos: [L.posts[0] + 0.05, 0.75, 0.09], rot: [0, 0, -0.3], scale: [0.04, 0.3, 0.01] });
  const sb = new PartBuilder('sign');
  for (const i of L.signBays) {
    const u = (L.posts[i] + L.posts[i + 1]) / 2;
    // Backing disc (vc) and textured faces on both sides.
    b.add(G.cyl(1, 1, 24), { color: PAL.ink, pos: [u, 0.71, 0], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.06, 0.3] });
    sb.add(G.plane(), { color: '#FFFFFF', pos: [u, 0.71, 0.035], scale: [0.58, 0.58, 1] });
    sb.add(G.plane(), { color: '#FFFFFF', pos: [u, 0.71, -0.035], rot: [0, Math.PI, 0], scale: [0.58, 0.58, 1] });
  }
  return { body: b.merge('vc')!, signs: sb.merge('sign')! };
}

function buildStumps(L: FenceLayout, seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new PartBuilder();
  for (const u of L.posts) {
    const h = 0.25 + r() * 0.25;
    b.add(G.rbox(0.14, h, 0.14, 0.04), { color: PAL.fence, pos: [u, h / 2, 0] });
    b.add(G.rbox(0.22, 0.12, 0.22, 0.04), { color: PAL.steelDark, pos: [u, 0.06, 0] });
    for (let k = 0; k < 3; k++) {
      b.add(G.cone(4), { color: PAL.woodLight, pos: [u + (r() - 0.5) * 0.08, h + 0.04, (r() - 0.5) * 0.08], rot: [(r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6], scale: [0.03, 0.1 + r() * 0.08, 0.03] });
    }
  }
  // A few splinters on the ground.
  for (let k = 0; k < L.posts.length * 2; k++) {
    b.add(G.box(), { color: r() < 0.5 ? PAL.fence : PAL.fenceStripe, pos: [(r() - 0.5) * L.len, 0.015, (r() - 0.5) * 0.9], rot: [0, r() * 3, 0], scale: [0.18 + r() * 0.12, 0.03, 0.05] });
  }
  return b.merge('vc')!;
}

// Debris piece geometries (shared).
let plankGeo: THREE.BufferGeometry | null = null;
let postTopGeo: THREE.BufferGeometry | null = null;
let plateGeo: THREE.BufferGeometry | null = null;
function debrisGeos(): { plank: THREE.BufferGeometry; postTop: THREE.BufferGeometry; plate: THREE.BufferGeometry } {
  if (!plankGeo) {
    const b = new PartBuilder();
    b.add(G.rbox(STRIPE, RAIL_H, RAIL_T, 0.025), { color: PAL.fenceStripe, pos: [-STRIPE / 2, 0, 0] });
    b.add(G.rbox(STRIPE, RAIL_H, RAIL_T, 0.025), { color: PAL.fence, pos: [STRIPE / 2, 0, 0] });
    plankGeo = b.merge('vc')!;
    const pb = new PartBuilder();
    pb.add(G.rbox(0.14, 0.8, 0.14, 0.04), { color: PAL.fence, pos: [0, 0, 0] });
    pb.add(G.sphere(10, 8), { color: PAL.fenceStripe, pos: [0, 0.45, 0], scale: 0.1 });
    postTopGeo = pb.merge('vc')!;
    const sb = new PartBuilder('sign');
    sb.add(G.plane(), { color: '#FFFFFF', pos: [0, 0, 0.012], scale: [0.58, 0.58, 1] });
    sb.add(G.plane(), { color: '#FFFFFF', pos: [0, 0, -0.012], rot: [0, Math.PI, 0], scale: [0.58, 0.58, 1] });
    plateGeo = sb.merge('sign')!;
  }
  return { plank: plankGeo!, postTop: postTopGeo!, plate: plateGeo! };
}

export function createFence(def: FenceDef): FenceRig {
  const alongX = def.half.x >= def.half.y;
  const len = 2 * (alongX ? def.half.x : def.half.y);
  const L = layoutFor(len);
  const geo = buildIntact(L);
  const stumpsGeo = buildStumps(L, hashString(def.id));
  const signMat = matTextured(fenceIconTexture(), { alphaTest: 0.4, rim: 0.2, side: THREE.FrontSide });

  const root = new THREE.Group();
  root.name = `fence:${def.id}`;
  root.position.set(def.center.x, 0, def.center.y);
  root.rotation.y = -def.angle + (alongX ? 0 : -Math.PI / 2);

  const intact = new THREE.Group();
  root.add(intact);
  const body = new THREE.Mesh(geo.body, matVC());
  body.castShadow = true;
  body.receiveShadow = true;
  body.name = 'fence:body';
  intact.add(body);
  const signs = new THREE.Mesh(geo.signs, signMat);
  signs.userData.noOutline = true;
  signs.name = 'fence:signs';
  intact.add(signs);
  const stumps = new THREE.Mesh(stumpsGeo, matVC());
  stumps.castShadow = true;
  stumps.receiveShadow = true;
  stumps.visible = false;
  stumps.userData.noOutline = true;
  root.add(stumps);

  const highlighter = new Highlighter(intact, { pushMax: 0.4, pushSlope: 0.6 });
  let broken = false;

  return {
    root,
    id: def.id,
    get broken() {
      return broken;
    },
    breakApart(dir?: Vec2 | null) {
      broken = true;
      intact.visible = false;
      stumps.visible = true;
      highlighter.set(null);
      root.updateWorldMatrix(true, false);
      const world = root.matrixWorld;
      const d = new THREE.Vector3(dir?.x ?? 0, 0, dir?.y ?? 0);
      if (d.lengthSq() < 1e-6) {
        // Default: push out along the fence normal.
        d.set(0, 0, 1).transformDirection(world);
      }
      d.normalize();
      const pieces: DebrisPieceSpec[] = [];
      const dg = debrisGeos();
      const r = rng(hashString(def.id) + 9);
      const local = new THREE.Matrix4();
      const spawn = (geom: THREE.BufferGeometry, mat: THREE.Material, u: number, y: number, radius: number): void => {
        local.makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 0.4, (r() - 0.5) * 0.4, (r() - 0.5) * 0.6));
        local.setPosition(u, y, 0);
        const m = world.clone().multiply(local);
        const sp = 3 + r() * 4;
        pieces.push({
          geometry: geom,
          material: mat,
          matrix: m,
          velocity: new THREE.Vector3(d.x * sp + (r() - 0.5) * 2, 2.5 + r() * 3.5, d.z * sp + (r() - 0.5) * 2),
          angular: new THREE.Vector3((r() - 0.5) * 12, (r() - 0.5) * 12, (r() - 0.5) * 12),
          radius,
        });
      };
      for (let i = 0; i < L.posts.length - 1; i++) {
        const a = L.posts[i];
        const bb = L.posts[i + 1];
        for (const y of RAIL_YS) {
          for (let k = 0; k < 2; k++) spawn(dg.plank, matVC(), a + (bb - a) * (0.25 + 0.5 * k), y, 0.1);
        }
      }
      for (const u of L.posts) spawn(dg.postTop, matVC(), u, 0.95, 0.07);
      for (const i of L.signBays) spawn(dg.plate, signMat, (L.posts[i] + L.posts[i + 1]) / 2, 0.71, 0.03);
      return new DebrisBurst(pieces, 3.0);
    },
    reset() {
      broken = false;
      intact.visible = true;
      stumps.visible = false;
    },
    setHighlight(color) {
      if (!broken) highlighter.set(color);
    },
    dispose() {
      highlighter.dispose();
      geo.body.dispose();
      geo.signs.dispose();
      stumpsGeo.dispose();
      root.removeFromParent();
    },
  };
}
