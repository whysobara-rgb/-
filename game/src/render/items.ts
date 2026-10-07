/**
 * Items (C7a, content-plan §5.2): toy models, supply drops, held items, hits, hazards and
 * plungers. Pure view of `state.items / hazards / projectiles`, `CharacterState.item /
 * dizzyTicks` and the item events. Nothing here can change a score.
 *
 * Models (all original toy shapes, team-neutral colours, ART §3 — no franchise hammer shapes):
 *  - 뿅망치: an accordion-bellows head (pink pleats, cream end caps with a paw stamp) on a lemon
 *    handle with grip tape; the bellows squash on every bonk. 황금 뿅망치: gold pleats, pink gem
 *    caps, glints.
 *  - 뚫어뻥: red rubber cup on a wooden stick; in flight the cup trails a sagging rope of dashes
 *    back to the thrower's paw.
 *  - 로켓 롤러스케이트: cream skate plates with pink wheels and a little rocket on the heel whose
 *    sparkle flame roars while dashing.
 *  - 비누 거품: a lilac pump bottle; its slicks are shimmering puddle decals with bubbles.
 *  - 보급 풍선: a crate printed with the item's SILHOUETTE (never a question mark, ART §3) drops
 *    under a balloon with a growing ground shadow during the 3 s warning, bursts on landing and
 *    leaves the item spinning over a glow ring (blinks in its last 3 s before it poofs).
 *
 * Feel (ART §2): hammer wind-up glint + crouch (rig), swing swoosh, bonk = flash card + stars +
 * ring + "뿅!" stamp + accordion squash of the victim + 90 ms hit-stop when the focus is involved;
 * home run (soap) is bigger; hammer clash = sparks + "챙!".
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterState, EntityId, HazardState, ItemKind, ItemPickupState, ProjectileState, SimEvent, SimState } from '../sim';
import { ITEMS, ITEM_FOREVER } from '../sim';
import type { ViewExtra, ViewExtrasHost } from './extras';
import type { RaccoonGrip, RaccoonItemPose, RaccoonRig } from './models/raccoon';
import { G, PartBuilder, lathe } from './models/geometry';
import { matTextured, matVC } from './models/materials';
import { blobShadowTexture, makeCanvasTexture, radialGlowTexture, roundRectPath } from './models/textures';
import { InkOutline } from './models/outline';
import { PAL } from './models/palette';
import { plankPieceGeometry } from './models/props';
import { SlickDecal, SmokeCloud } from './effects';
import { damp } from './sync';

// ===========================================================================
// Item models
// ===========================================================================

const HAMMER = {
  pleatA: '#F0506E',
  pleatB: '#FF8FA3',
  cap: '#FFF3DE',
  capRim: '#8FE3C8',
  handle: '#FFD45C',
  grip: '#FF6F91',
  goldA: '#F6C64F',
  goldB: '#FFE7A1',
  gem: '#FF6F91',
};

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Hammer handle: grip at the origin, handle down local -y (0.5 m). */
function hammerHandleGeometry(gold: boolean): THREE.BufferGeometry {
  return cached(`hammerHandle|${gold}`, () => {
    const b = new PartBuilder();
    b.add(G.cyl(1, 1, 12), { color: gold ? HAMMER.cap : HAMMER.handle, pos: [0, -0.24, 0], scale: [0.032, 0.56, 0.032] });
    // Grip tape spiral (three bands) + end knob.
    for (let i = 0; i < 3; i++) b.add(G.cyl(1, 1, 12), { color: gold ? HAMMER.goldA : HAMMER.grip, pos: [0, 0.0 - i * 0.07, 0], rot: [0.25, 0, 0], scale: [0.036, 0.03, 0.036] });
    b.add(G.sphere(10, 8), { color: gold ? HAMMER.goldA : HAMMER.grip, pos: [0, 0.05, 0], scale: 0.045 });
    return b.merge('vc')!;
  });
}

/** Hammer head (accordion bellows along local x), centered at its origin. */
function hammerHeadGeometry(gold: boolean): THREE.BufferGeometry {
  return cached(`hammerHead|${gold}`, () => {
    const b = new PartBuilder();
    const pleats = 9;
    const len = 0.44;
    for (let i = 0; i < pleats; i++) {
      const x = -len / 2 + (i + 0.5) * (len / pleats);
      const wide = i % 2 === 0;
      b.add(G.cyl(1, 1, 18), {
        color: gold ? (wide ? HAMMER.goldA : HAMMER.goldB) : wide ? HAMMER.pleatA : HAMMER.pleatB,
        pos: [x, 0, 0],
        rot: [0, 0, Math.PI / 2],
        scale: [wide ? 0.15 : 0.125, len / pleats + 0.002, wide ? 0.15 : 0.125],
        emissive: gold ? 0.18 : 0.04,
      });
    }
    // End caps (rounded) with a paw stamp (or a gem on the golden one).
    for (const s of [-1, 1]) {
      b.add(G.cyl(1, 1, 20), { color: gold ? '#FFFFFF' : HAMMER.cap, pos: [s * (len / 2 + 0.03), 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.165, 0.06, 0.165] });
      b.add(G.torus(0.16, 6, 20), { color: gold ? HAMMER.goldA : HAMMER.capRim, pos: [s * (len / 2 + 0.03), 0, 0], rot: [0, Math.PI / 2, 0], scale: [0.16, 0.16, 0.12] });
      const fx = s * (len / 2 + 0.062);
      if (gold) b.add(G.ico(0), { color: HAMMER.gem, pos: [fx, 0, 0], scale: 0.06, emissive: 0.5 });
      else {
        b.add(G.sphere(10, 6), { color: HAMMER.pleatA, pos: [fx, -0.02, 0], scale: [0.008, 0.045, 0.05] });
        for (const [dy, dz] of [
          [0.04, -0.05],
          [0.065, -0.018],
          [0.065, 0.018],
          [0.04, 0.05],
        ] as const) b.add(G.sphere(6, 4), { color: HAMMER.pleatA, pos: [fx, dy, dz], scale: [0.006, 0.018, 0.018] });
      }
    }
    // Socket where the handle meets the head.
    b.add(G.cyl(1, 1, 12), { color: gold ? HAMMER.goldA : HAMMER.capRim, pos: [0, 0.13, 0], scale: [0.05, 0.06, 0.05] });
    return b.merge('vc')!;
  });
}

function plungerStickGeometry(): THREE.BufferGeometry {
  return cached('plungerStick', () => {
    const b = new PartBuilder();
    b.add(G.cyl(1, 1, 10), { color: PAL.woodLight, pos: [0, -0.22, 0], scale: [0.026, 0.52, 0.026] });
    b.add(G.sphere(8, 6), { color: PAL.wood, pos: [0, 0.04, 0], scale: 0.035 });
    return b.merge('vc')!;
  });
}

/** Rubber cup, opening toward local -y, rim at y = 0. */
function plungerCupGeometry(): THREE.BufferGeometry {
  return cached('plungerCup', () => {
    const b = new PartBuilder();
    const cup = lathe(
      [
        [0.0, 0.17],
        [0.04, 0.165],
        [0.09, 0.12],
        [0.13, 0.05],
        [0.15, 0.0],
        [0.14, -0.01],
      ],
      18,
    );
    b.add(cup, { color: '#E8505B' });
    cup.dispose();
    b.add(G.torus(0.12, 6, 20), { color: '#C23A47', pos: [0, 0.0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.145, 0.145, 0.1] });
    b.add(G.sphere(8, 6), { color: '#FFFFFF', pos: [0.05, 0.13, 0.04], scale: [0.03, 0.015, 0.02], emissive: 0.3 });
    return b.merge('vc')!;
  });
}

/** One rocket skate (origin under the paw sole, +x forward). */
function skateGeometry(): THREE.BufferGeometry {
  return cached('skate', () => {
    const b = new PartBuilder();
    b.add(G.rbox(0.26, 0.05, 0.14, 0.02), { color: '#FFF3DE', pos: [0.03, 0.0, 0] });
    b.add(G.rbox(0.16, 0.07, 0.15, 0.03), { color: '#B9A3F0', pos: [-0.01, 0.05, 0] });
    for (const x of [-0.07, 0.11]) for (const z of [-0.055, 0.055]) {
      b.add(G.cyl(1, 1, 14), { color: '#FF8FA3', pos: [x, -0.045, z], rot: [Math.PI / 2, 0, 0], scale: [0.042, 0.03, 0.042] });
      b.add(G.cyl(1, 1, 10), { color: '#FFFFFF', pos: [x, -0.045, z], rot: [Math.PI / 2, 0, 0], scale: [0.016, 0.034, 0.016] });
    }
    // Heel rocket (red body, white band, fins).
    b.add(G.cyl(1, 1, 14), { color: '#E8505B', pos: [-0.12, 0.08, 0], rot: [0, 0, Math.PI / 2], scale: [0.045, 0.16, 0.045] });
    b.add(G.cone(14), { color: '#FFFFFF', pos: [-0.02, 0.08, 0], rot: [0, 0, -Math.PI / 2], scale: [0.045, 0.06, 0.045] });
    b.add(G.cyl(1, 1, 14), { color: '#FFFFFF', pos: [-0.12, 0.08, 0], rot: [0, 0, Math.PI / 2], scale: [0.047, 0.03, 0.047] });
    for (const s of [-1, 1]) b.add(G.box(), { color: '#FFD45C', pos: [-0.19, 0.08 + s * 0.03, 0], rot: [0, 0, s * 0.5], scale: [0.06, 0.012, 0.03] });
    b.add(G.cyl(1, 0.7, 12), { color: '#5F5A6E', pos: [-0.205, 0.08, 0], rot: [0, 0, Math.PI / 2], scale: [0.03, 0.02, 0.03] });
    return b.merge('vc')!;
  });
}

function flameGeometry(): THREE.BufferGeometry {
  return cached('flame', () => new THREE.ConeGeometry(0.05, 0.22, 10).rotateZ(Math.PI / 2).translate(-0.11, 0, 0));
}

/** Soap pump bottle (origin at the bottom). */
function soapGeometry(): THREE.BufferGeometry {
  return cached('soap', () => {
    const b = new PartBuilder();
    const body = lathe(
      [
        [0.0, 0.0],
        [0.075, 0.005],
        [0.085, 0.04],
        [0.085, 0.17],
        [0.06, 0.21],
        [0.03, 0.225],
        [0.0, 0.23],
      ],
      16,
    );
    b.add(body, { color: '#C9B5FA' });
    body.dispose();
    b.add(G.cyl(1, 1, 12), { color: '#FFFFFF', pos: [0, 0.25, 0], scale: [0.03, 0.05, 0.03] });
    b.add(G.rbox(0.09, 0.025, 0.035, 0.01), { color: '#FFFFFF', pos: [0.025, 0.28, 0] });
    // Label with bubbles.
    b.add(G.cyl(1, 1, 16, true), { color: '#FFFFFF', pos: [0, 0.1, 0], scale: [0.087, 0.08, 0.087] });
    for (const [y, a, r] of [
      [0.11, 0.2, 0.022],
      [0.085, 0.7, 0.014],
      [0.125, -0.3, 0.012],
    ] as const) b.add(G.sphere(8, 6), { color: '#9FE0FF', pos: [Math.cos(a) * 0.089, y, Math.sin(a) * 0.089], scale: [r * 0.4, r, r] });
    return b.merge('vc')!;
  });
}

function balloonsGeometry(): THREE.BufferGeometry {
  return cached('balloons', () => {
    const b = new PartBuilder();
    const cols = ['#FF8FA3', '#FFD45C', '#8FE3C8'];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const x = Math.cos(a) * 0.12;
      const z = Math.sin(a) * 0.12;
      b.add(G.sphere(14, 10), { color: cols[i]!, pos: [x, 0.55 + i * 0.05, z], scale: [0.14, 0.17, 0.14] });
      b.add(G.cone(8), { color: cols[i]!, pos: [x, 0.37 + i * 0.05, z], rot: [Math.PI, 0, 0], scale: [0.03, 0.04, 0.03] });
      b.add(G.cyl(1, 1, 4), { color: '#FFFFFF', pos: [x / 2, 0.18 + i * 0.025, z / 2], rot: [z * 2, 0, -x * 2], scale: [0.004, 0.38, 0.004] });
    }
    return b.merge('vc')!;
  });
}

function smokeBombGeometry(): THREE.BufferGeometry {
  return cached('smokeBomb', () => {
    const b = new PartBuilder();
    b.add(G.sphere(16, 12), { color: '#D9CFE6', pos: [0, 0.14, 0], scale: [0.14, 0.13, 0.14] });
    b.add(G.cone(10), { color: '#B9A3F0', pos: [0, 0.3, 0], scale: [0.06, 0.07, 0.06] });
    b.add(G.torus(0.3, 6, 12), { color: '#FF8FA3', pos: [0, 0.26, 0], rot: [Math.PI / 2, 0, 0], scale: [0.05, 0.05, 0.04] });
    // A cartoon nose (sneeze!) on the front.
    b.add(G.sphere(8, 6), { color: '#FF9DB0', pos: [0.13, 0.15, 0], scale: [0.03, 0.026, 0.035] });
    return b.merge('vc')!;
  });
}

/** A display model of an item kind (ground pickup / crate reveal / gallery). Origin at the bottom. */
export interface ItemModel {
  readonly root: THREE.Group;
  /** Accordion head (hammers) for the squash, else null. */
  readonly head: THREE.Object3D | null;
  /** Rocket flames (skates). */
  readonly flames: THREE.Mesh[];
  /** Plunger cup (hidden while it flies). */
  readonly cup: THREE.Object3D | null;
  dispose(): void;
}

let flameMat: THREE.MeshBasicMaterial | null = null;

/**
 * Build an item model. `held` = the in-paw orientation (grip at the origin, handle down -y);
 * otherwise a display pose standing on the ground (origin at the bottom). Skates come as a pair
 * in display mode and as ONE skate when `held` (attach one to each foot).
 */
export function createItemModel(kind: ItemKind, held: boolean): ItemModel {
  const root = new THREE.Group();
  root.name = `item:${kind}`;
  let head: THREE.Object3D | null = null;
  let cup: THREE.Object3D | null = null;
  const flames: THREE.Mesh[] = [];
  const mesh = (g: THREE.BufferGeometry, parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(g, matVC());
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  if (kind === 'hammer' || kind === 'goldHammer') {
    const gold = kind === 'goldHammer';
    const holder = new THREE.Group();
    root.add(holder);
    mesh(hammerHandleGeometry(gold), holder);
    const h = new THREE.Group();
    h.position.set(0, -0.62, 0);
    holder.add(h);
    mesh(hammerHeadGeometry(gold), h);
    head = h;
    if (held) {
      // A quarter twist so the bellows show their side from more camera angles (still swings flat).
      holder.rotation.set(0, 0.5, 0);
    } else {
      // Display: standing on its head (grip up), slightly tilted.
      holder.rotation.set(0, 0, -0.22);
      holder.position.set(-0.14, 0.62 + 0.16, 0);
    }
  } else if (kind === 'plunger') {
    const holder = new THREE.Group();
    root.add(holder);
    mesh(plungerStickGeometry(), holder);
    // Cup closed end on the stick, rim facing away from the grip (local -y).
    const c = new THREE.Group();
    c.position.set(0, -0.46 - 0.17, 0);
    holder.add(c);
    mesh(plungerCupGeometry(), c);
    cup = c;
    if (!held) holder.position.set(0, 0.63 + 0.02, 0);
  } else if (kind === 'skates') {
    if (!flameMat) flameMat = new THREE.MeshBasicMaterial({ color: '#FFB13D', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const one = (z: number, yaw: number): void => {
      const g = new THREE.Group();
      g.position.set(0, held ? 0 : 0.07, z);
      g.rotation.y = yaw;
      root.add(g);
      mesh(skateGeometry(), g);
      const f = new THREE.Mesh(flameGeometry(), flameMat!);
      f.position.set(-0.21, 0.08, 0);
      f.userData.noOutline = true;
      f.castShadow = false;
      g.add(f);
      flames.push(f);
    };
    if (held) one(0, 0);
    else {
      one(-0.11, 0.2);
      one(0.11, -0.1);
    }
  } else if (kind === 'soap') {
    const m = mesh(soapGeometry());
    if (held) m.position.set(0.02, -0.08, 0);
    else m.scale.setScalar(1.6);
  } else if (kind === 'balloons') {
    const m = mesh(balloonsGeometry());
    if (held) m.position.set(0, -0.1, 0);
  } else {
    const m = mesh(smokeBombGeometry());
    if (!held) m.scale.setScalar(1.4);
  }
  if (!held) {
    // Display pose (ground pickups): one merged mesh per kind (+ its outline) instead of one per
    // part; nothing squashes or flies on the ground, and the skate flames stay off there.
    const merged = displayGeometry(kind, root);
    if (merged) {
      for (let i = root.children.length - 1; i >= 0; i--) root.children[i]!.removeFromParent();
      mesh(merged);
      head = null;
      cup = null;
      flames.length = 0;
    }
  }
  const ink = new InkOutline(root);
  return {
    root,
    head,
    flames,
    cup,
    dispose() {
      ink.dispose();
      root.removeFromParent();
    },
  };
}

const displayCache = new Map<ItemKind, THREE.BufferGeometry | null>();
/** All outlined part meshes of a display model merged into one geometry (null: a single part). */
function displayGeometry(kind: ItemKind, root: THREE.Group): THREE.BufferGeometry | null {
  if (displayCache.has(kind)) return displayCache.get(kind) ?? null;
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.noOutline) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    parts.push(g);
  });
  let merged: THREE.BufferGeometry | null = null;
  if (parts.length > 1) {
    try {
      merged = mergeGeometries(parts, false);
    } catch {
      merged = null;
    }
    merged?.computeBoundingSphere();
    merged?.computeBoundingBox();
  }
  for (const p of parts) p.dispose();
  displayCache.set(kind, merged);
  return merged;
}

// --- supply crate --------------------------------------------------------------------------

const silTex = new Map<ItemKind, THREE.Texture>();
/** Crate side panel: cream board, pink border, the item's silhouette in ink (never a "?"). */
function crateSideTexture(kind: ItemKind): THREE.Texture {
  let t = silTex.get(kind);
  if (t) return t;
  t = makeCanvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#E2B485';
      ctx.fillRect(0, 0, w, h);
      // Plank seams.
      ctx.fillStyle = '#C08A5A';
      for (const y of [84, 170]) ctx.fillRect(0, y, w, 6);
      ctx.fillStyle = kind === 'goldHammer' ? '#FFF1B8' : '#FFF3DE';
      roundRectPath(ctx, 26, 26, w - 52, h - 52, 30);
      ctx.fill();
      ctx.lineWidth = 12;
      ctx.strokeStyle = kind === 'goldHammer' ? '#F6C64F' : '#FF6F91';
      ctx.stroke();
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.fillStyle = kind === 'goldHammer' ? '#C88F25' : '#2A2131';
      drawSilhouette(ctx, kind);
      ctx.restore();
    },
    { mipmaps: true },
  );
  silTex.set(kind, t);
  return t;
}

/** Item silhouettes for crates (and the HUD can reuse the same drawing). Centered, ~150 px. */
export function drawSilhouette(ctx: CanvasRenderingContext2D, kind: ItemKind): void {
  const rr = (x: number, y: number, w: number, h: number, r: number): void => {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  };
  const circle = (x: number, y: number, r: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (kind) {
    case 'hammer':
    case 'goldHammer': {
      ctx.rotate(-0.5);
      rr(-9, -10, 18, 92, 9);
      // Bellows head: pleats.
      for (let i = 0; i < 7; i++) rr(-62 + i * 16, -52 + (i % 2 ? 5 : 0), 14, i % 2 ? 40 : 50, 6);
      rr(-74, -58, 16, 62, 8);
      rr(56, -58, 16, 62, 8);
      if (kind === 'goldHammer') {
        ctx.rotate(0.5);
        for (const [x, y, r] of [
          [62, -56, 10],
          [-64, 40, 8],
        ] as const) {
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const k = i % 2 ? r * 0.4 : r;
            ctx.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      break;
    }
    case 'plunger': {
      ctx.rotate(0.35);
      rr(-8, -82, 16, 110, 8);
      ctx.beginPath();
      ctx.moveTo(-50, 70);
      ctx.quadraticCurveTo(-46, 22, 0, 20);
      ctx.quadraticCurveTo(46, 22, 50, 70);
      ctx.closePath();
      ctx.fill();
      rr(-56, 64, 112, 14, 7);
      break;
    }
    case 'skates': {
      rr(-50, -60, 56, 70, 18);
      rr(-62, 4, 120, 26, 12);
      for (const x of [-42, 30]) circle(x, 46, 16);
      // Rocket + flame.
      rr(-92, -18, 40, 22, 10);
      ctx.beginPath();
      ctx.moveTo(-92, -24);
      ctx.lineTo(-128, -7);
      ctx.lineTo(-92, 10);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'soap': {
      rr(-38, -30, 76, 104, 26);
      rr(-12, -58, 24, 32, 6);
      rr(-12, -66, 52, 14, 6);
      for (const [x, y, r] of [
        [56, -40, 14],
        [70, 0, 9],
        [52, 30, 7],
      ] as const) circle(x, y, r);
      break;
    }
    case 'balloons': {
      for (const [x, y] of [
        [-36, -34],
        [30, -44],
        [0, -10],
      ] as const) circle(x, y, 32);
      ctx.fillRect(-2, 20, 4, 60);
      break;
    }
    default: {
      for (const [x, y, r] of [
        [-40, 10, 34],
        [0, -20, 42],
        [40, 10, 34],
        [0, 24, 36],
      ] as const) circle(x, y, r);
      break;
    }
  }
}

function crateGeometry(): THREE.BufferGeometry {
  return cached('supplyCrate', () => {
    const b = new PartBuilder();
    b.add(G.rbox(0.62, 0.62, 0.62, 0.05), { color: PAL.woodLight, pos: [0, 0.31, 0] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.rbox(0.08, 0.64, 0.08, 0.025), { color: PAL.woodDark, pos: [sx * 0.29, 0.32, sz * 0.29] });
    for (const y of [0.02, 0.62]) b.add(G.rbox(0.64, 0.05, 0.64, 0.02), { color: PAL.wood, pos: [0, y, 0] });
    // Rope harness on top (to the balloon).
    b.add(G.torus(0.2, 6, 12), { color: PAL.rope, pos: [0, 0.68, 0], scale: [0.06, 0.06, 0.06] });
    return b.merge('vc')!;
  });
}

function crateSidesGeometry(): THREE.BufferGeometry {
  return cached('supplyCrateSides', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.PlaneGeometry(0.5, 0.5);
      p.translate(0, 0, 0.316);
      p.rotateY((i * Math.PI) / 2);
      p.translate(0, 0.33, 0);
      parts.push(p);
    }
    const top = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2).translate(0, 0.651, 0);
    parts.push(top);
    let n = 0;
    for (const p of parts) n += p.getAttribute('position').count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    let o = 0;
    for (const p of parts) {
      pos.set(p.getAttribute('position').array as Float32Array, o * 3);
      nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
      uv.set(p.getAttribute('uv').array as Float32Array, o * 2);
      for (let i = 0; i < p.index!.count; i++) idx.push(p.index!.getX(i) + o);
      o += p.getAttribute('position').count;
      p.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  });
}

function balloonGeometry(): THREE.BufferGeometry {
  return cached('supplyBalloon', () => {
    const b = new PartBuilder();
    b.add(G.sphere(20, 14), { color: '#FF8FA3', pos: [0, 1.0, 0], scale: [0.55, 0.65, 0.55] });
    b.add(G.sphere(10, 8), { color: '#FFFFFF', pos: [-0.2, 1.25, 0.32], scale: [0.09, 0.14, 0.06], emissive: 0.4 });
    b.add(G.cone(10), { color: '#E8739A', pos: [0, 0.32, 0], rot: [Math.PI, 0, 0], scale: [0.07, 0.08, 0.07] });
    // Four strings down to the crate corners.
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const len = Math.hypot(0.2, 0.31);
      b.add(G.cyl(1, 1, 4), { color: '#FFFFFF', pos: [x * 0.1, 0.16, z * 0.1], rot: [z * Math.atan2(0.2, 0.31) * 0.7, 0, -x * Math.atan2(0.2, 0.31) * 0.7], scale: [0.006, len + 0.05, 0.006] });
    }
    return b.merge('vc')!;
  });
}

// ===========================================================================
// ItemsSync
// ===========================================================================

interface GroundView {
  id: EntityId;
  kind: ItemKind;
  root: THREE.Group;
  model: ItemModel;
  crate: THREE.Group | null;
  shadow: THREE.Mesh;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  phase: 'incoming' | 'ground';
  /** View time the item reached the ground (pop-in). */
  landed: number;
  /** Dropped by a knocked-down holder: hops out. */
  dropped: boolean;
  seen: boolean;
}

interface HeldView {
  charId: EntityId;
  kind: ItemKind;
  models: ItemModel[];
  /** Sim phase last frame + view time it started. */
  phase: string;
  phaseStart: number;
  squash: number;
  swoosh: THREE.Mesh | null;
  swooshMat: THREE.MeshBasicMaterial | null;
  stowed: boolean;
  nextGlint: number;
  /** Reused arm pose (no allocation per frame). */
  pose: RaccoonItemPose;
}

interface HazardView {
  id: EntityId;
  decal: SlickDecal | SmokeCloud;
  born: number;
  seen: boolean;
}

interface PlungerView {
  id: EntityId;
  cup: THREE.Group;
  seen: boolean;
}

const DROP_HEIGHT = 11;
/** Ground pickups drawn by the shared instanced shadow / glow ring (more fall back to their own). */
const PAD_CAP = 24;
/** Officer flatten (s / fraction): total time, flat hold, vertical squash, sideways spread. */
const FLAT = { time: 1.1, hold: 0.55, depth: 0.62, spread: 0.4 } as const;
const RING_GOLD = new THREE.Color(PAL.gold);
const RING_CREAM = new THREE.Color('#FFF1B8');
const ROPE_DASHES = 14;
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _c = new THREE.Vector3();

let swooshGeo: THREE.BufferGeometry | null = null;
/** Swing trail: a curved ribbon in the arm's swing plane (around the shoulder). */
function swooshGeometry(): THREE.BufferGeometry {
  if (swooshGeo) return swooshGeo;
  const seg = 16;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = 0.4 + t * 2.7; // forward-low .. overhead
    for (const r of [0.55, 0.95]) {
      pos.push(Math.sin(a) * r, -Math.cos(a) * r, 0);
      uv.push(t, r > 0.6 ? 1 : 0);
    }
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  swooshGeo = new THREE.BufferGeometry();
  swooshGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  swooshGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  swooshGeo.setIndex(idx);
  return swooshGeo;
}

export class ItemsSync implements ViewExtra {
  private readonly host: ViewExtrasHost;
  private readonly root = new THREE.Group();
  private readonly ground = new Map<EntityId, GroundView>();
  private readonly held = new Map<EntityId, HeldView>();
  private readonly hazards = new Map<EntityId, HazardView>();
  private readonly plungers = new Map<EntityId, PlungerView>();
  private readonly rope: THREE.InstancedMesh;
  private readonly owned: (THREE.Material | THREE.BufferGeometry)[] = [];
  private readonly droppedIds = new Set<EntityId>();
  /** Shared blob shadows + glow rings under resting pickups (one draw call each). */
  private readonly padShadow: THREE.InstancedMesh;
  private readonly padRing: THREE.InstancedMesh;
  private readonly padRingMat: THREE.MeshBasicMaterial;
  private pads = 0;
  /** Hammer-flattened officers (pivot squash, restored at the end). */
  private readonly flats: { id: EntityId; pivot: THREE.Object3D; t: number; bx: number; by: number; bz: number }[] = [];
  // Pre-bound per-frame sweep callbacks (Map.forEach: no iterator / entry garbage per frame).
  private readonly unseeGround = (g: GroundView): void => {
    g.seen = false;
  };
  private readonly sweepGround = (g: GroundView, id: EntityId): void => {
    if (g.seen) return;
    this.disposeGround(g);
    this.ground.delete(id);
  };
  private readonly unseeHazard = (hv: HazardView): void => {
    hv.seen = false;
  };
  private readonly sweepHazard = (hv: HazardView, id: EntityId): void => {
    if (hv.seen) return;
    hv.decal.dispose();
    this.hazards.delete(id);
  };
  private readonly unseePlunger = (p: PlungerView): void => {
    p.seen = false;
  };
  private readonly sweepPlunger = (p: PlungerView, id: EntityId): void => {
    if (p.seen) return;
    p.cup.removeFromParent();
    this.plungers.delete(id);
  };

  constructor(host: ViewExtrasHost) {
    this.host = host;
    this.root.name = 'items';
    host.world.add(this.root);
    const ropeGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
    this.owned.push(ropeGeo);
    this.rope = new THREE.InstancedMesh(ropeGeo, matVC(), ROPE_DASHES * 6);
    this.rope.count = 0;
    this.rope.frustumCulled = false;
    this.rope.userData.noOutline = true;
    this.rope.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rope.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ROPE_DASHES * 6 * 3).fill(0.93), 3);
    this.root.add(this.rope);
    const shadowMat = new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.padRingMat = new THREE.MeshBasicMaterial({ map: radialGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.owned.push(shadowMat, this.padRingMat);
    this.padShadow = new THREE.InstancedMesh(this.flatGeo(), shadowMat, PAD_CAP);
    this.padShadow.name = 'pickupShadows';
    this.padShadow.renderOrder = -1;
    this.padRing = new THREE.InstancedMesh(this.flatGeo(), this.padRingMat, PAD_CAP);
    this.padRing.name = 'pickupRings';
    this.padRing.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PAD_CAP * 3).fill(1), 3);
    for (const m of [this.padShadow, this.padRing]) {
      m.count = 0;
      m.frustumCulled = false;
      m.userData.noOutline = true;
      m.castShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(m);
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  onEvents(events: readonly SimEvent[]): void {
    const h = this.host;
    for (const e of events) {
      switch (e.type) {
        case 'itemUse': {
          if (e.phase === 'windup' && (e.kind === 'hammer' || e.kind === 'goldHammer')) {
            // Wind-up glint at the hammer head (the 0.1 s telegraph everyone can read).
            const hv = this.held.get(e.charId);
            const head = hv?.models[0]?.head;
            if (head) {
              head.getWorldPosition(_v);
              h.effects.fx.sparkle({ x: _v.x, y: _v.y - 0.6, z: _v.z }, { count: 3, radius: 0.15, color: '#FFFFFF' });
            }
          } else if (e.phase === 'fire' && e.kind === 'plunger') {
            const p = h.charPose(e.charId);
            if (p) h.effects.stamp('whoosh', p, { y: p.h + 1.7, scale: 0.7 });
          }
          break;
        }
        case 'itemHit':
          this.onHit(e);
          break;
        case 'itemClash': {
          const a = h.charPose(e.aId);
          const b = h.charPose(e.bId);
          if (a && b) {
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            h.effects.fx.sparkle({ x: mid.x, y: 0.9, z: mid.y }, { count: 10, radius: 0.5, color: '#FFFFFF' });
            h.effects.fx.stars({ x: mid.x, y: 0.6, z: mid.y }, { count: 5, size: 0.12, color: '#DCE1EA' });
            h.effects.stamp('clang', mid, { y: 2.0 });
            if (e.aId === h.focusId() || e.bId === h.focusId()) h.hitstop(0.06);
          }
          for (const id of [e.aId, e.bId]) {
            h.charRig(id)?.react('clash');
            const hv = this.held.get(id);
            if (hv) hv.squash = 0.6;
          }
          break;
        }
        case 'itemPickup': {
          const p = h.charPose(e.charId);
          if (p) {
            h.effects.fx.sparkle({ x: p.x, y: p.h + 0.4, z: p.y }, { count: e.kind === 'goldHammer' ? 18 : 8, radius: 0.6, color: e.kind === 'goldHammer' ? PAL.goldLight : '#FFFFFF' });
            h.effects.fx.ring({ x: p.x, y: p.h + 0.02, z: p.y }, { radius: e.kind === 'goldHammer' ? 2.6 : 1.4, color: e.kind === 'goldHammer' ? PAL.gold : '#FFFFFF', duration: 0.4 });
          }
          h.pulse(e.charId, 0.12);
          break;
        }
        case 'itemDropped':
          this.droppedIds.add(e.itemId);
          h.effects.poof(e.pos, 0.4);
          break;
        case 'itemExpired': {
          const p = e.charId !== null ? h.charPose(e.charId) : null;
          const gv = e.itemId !== null ? this.ground.get(e.itemId) : undefined;
          if (p) h.effects.poof(p, p.h + 0.7);
          else if (gv) h.effects.poof({ x: gv.root.position.x, y: gv.root.position.z }, 0.4);
          break;
        }
        case 'itemSpawn': {
          const gv = this.ground.get(e.itemId);
          if (gv && gv.crate) this.burstCrate(gv);
          break;
        }
        case 'hazard':
          if (e.phase === 'start' && e.kind === 'slick') {
            h.effects.fx.sparkle({ x: e.pos.x, y: 0.1, z: e.pos.y }, { count: 8, radius: 1.2, color: '#F4EEFF' });
          }
          break;
        default:
          break;
      }
    }
  }

  private onHit(e: Extract<SimEvent, { type: 'itemHit' }>): void {
    const h = this.host;
    const hammer = e.kind === 'hammer' || e.kind === 'goldHammer';
    const big = e.kind === 'goldHammer' || !!e.homeRun;
    const attacker = h.charPose(e.charId);
    const hv = this.held.get(e.charId);
    if (hv && hammer) hv.squash = 1;
    const focus = h.focusId();
    let at: { x: number; y: number } | null = null;
    let y = 0.6;
    if (e.target === 'char' && typeof e.targetId === 'number') {
      const v = h.charPose(e.targetId);
      if (v) {
        at = v;
        y = v.h + 0.7;
      }
      const rig = h.charRig(e.targetId as EntityId);
      if (hammer) rig?.react(e.homeRun ? 'homeRun' : 'bonk');
      else rig?.react('boing');
      const involved = e.targetId === focus || e.charId === focus;
      if (hammer) {
        if (involved) h.hitstop(e.homeRun ? 0.12 : 0.09);
        if (at) {
          h.shake(at, e.homeRun ? 0.6 : 0.4, 18);
          if (involved && attacker) h.punch({ x: at.x - attacker.x, y: at.y - attacker.y }, e.homeRun ? 0.5 : 0.32);
          if (involved || h.nearFocus(at, 8) > 0.4) h.impact(at, e.homeRun ? 1 : 0.75, 0.6);
          h.scare(at, 6);
        }
      }
    } else if (e.target === 'police' && typeof e.targetId === 'number') {
      at = h.officerPos(e.targetId);
      // Flattened officer: a pancake dust ring + stars over the spot, and the officer rig itself
      // squashes flat (pivot scale, see syncFlats) while it falls into its stunned pose.
      if (at) {
        h.effects.fx.ring({ x: at.x, y: 0, z: at.y }, { radius: 1.6, color: '#FFF3DE', duration: 0.35 });
        h.effects.fx.dust({ x: at.x, y: 0, z: at.y }, { count: 8, spread: 0.7, size: 0.3, up: 0.3 });
        if (e.charId === focus) h.hitstop(0.09);
      }
      if (hammer) this.flatten(e.targetId);
    } else {
      const l = typeof e.targetId === 'number' ? h.lootPose(e.targetId) : null;
      if (l) {
        at = l;
        y = 0.9;
      } else if (attacker) {
        const f = attacker.a;
        at = { x: attacker.x + Math.cos(f) * 1.1, y: attacker.y + Math.sin(f) * 1.1 };
      }
      if (e.charId === focus && hammer) h.hitstop(0.05);
    }
    if (!at) return;
    const dir = attacker ? { x: at.x - attacker.x, y: at.y - attacker.y } : null;
    if (hammer || e.kind === 'plunger') h.effects.bonkImpact(at, dir, big, y);
    if (e.target === 'char' || e.target === 'police') {
      h.effects.stamp(e.homeRun ? 'homeRun' : 'bonk', at, { y: y + 1.3, scale: big ? 1.2 : 1 });
      if (e.homeRun) h.effects.fx.confetti({ x: at.x, y: 1, z: at.y }, { count: 30, power: 0.8 });
    }
  }

  /** Start (or restart) the pancake squash on an officer's rig. */
  private flatten(officerId: EntityId): void {
    for (const f of this.flats) {
      if (f.id === officerId) {
        f.t = 0;
        return;
      }
    }
    const root = this.host.officerRoot?.(officerId);
    const pivot = root?.children[0];
    if (!pivot) return;
    this.flats.push({ id: officerId, pivot, t: 0, bx: pivot.scale.x, by: pivot.scale.y, bz: pivot.scale.z });
  }

  /**
   * Officer pancake: slam flat in 60 ms, stay flat, then spring back with a wobble. The squash is
   * vertical in the world: as the officer tips onto its back (pivot rotation z), the flattened
   * local axis moves from y to x.
   */
  private syncFlats(dt: number): void {
    for (let i = this.flats.length - 1; i >= 0; i--) {
      const f = this.flats[i]!;
      f.t += dt;
      const p = f.pivot;
      const done = f.t >= FLAT.time || !p.parent?.parent;
      let k = 0;
      if (!done) {
        if (f.t < 0.06) k = f.t / 0.06;
        else if (f.t < FLAT.hold) k = 1;
        else {
          const v = f.t - FLAT.hold;
          k = Math.exp(-v * 7) * Math.cos(v * 17);
        }
      }
      const vert = 1 - FLAT.depth * k;
      const wide = 1 + FLAT.spread * k;
      const sn = Math.sin(p.rotation.z);
      const s2 = sn * sn;
      const c2 = 1 - s2;
      p.scale.set(f.bx * (wide * c2 + vert * s2), f.by * (vert * c2 + wide * s2), f.bz * wide);
      if (done) {
        p.scale.set(f.bx, f.by, f.bz);
        this.flats[i] = this.flats[this.flats.length - 1]!;
        this.flats.pop();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Frame sync
  // ---------------------------------------------------------------------------

  sync(state: SimState, alpha: number, dt: number): void {
    void alpha;
    const h = this.host;
    const now = h.time();
    // Stamps follow the settings (reduced motion: no wobble) and the language.
    h.effects.setCalm(h.reducedMotion());
    h.effects.setStampLanguage(h.language());
    // --- field pickups ----------------------------------------------------------------------
    this.ground.forEach(this.unseeGround);
    this.pads = 0;
    // Shared glow-ring pulse (same phase for every resting pickup).
    this.padRingMat.opacity = 0.55 + 0.25 * Math.sin(now * 4);
    const items = state.items;
    for (let i = 0; i < items.length; i++) this.syncGround(items[i]!, state, now, dt);
    this.ground.forEach(this.sweepGround);
    this.padShadow.count = this.pads;
    this.padRing.count = this.pads;
    if (this.pads) {
      this.padShadow.instanceMatrix.needsUpdate = true;
      this.padRing.instanceMatrix.needsUpdate = true;
      this.padRing.instanceColor!.needsUpdate = true;
    }
    // --- held items ---------------------------------------------------------------------------
    const chars = state.characters;
    for (let i = 0; i < chars.length; i++) this.syncHeld(chars[i]!, state, now, dt);
    this.syncFlats(dt);
    // --- hazards ------------------------------------------------------------------------------
    this.hazards.forEach(this.unseeHazard);
    const hz = state.hazards;
    for (let i = 0; i < hz.length; i++) this.syncHazard(hz[i]!, state, now);
    this.hazards.forEach(this.sweepHazard);
    // --- plungers in flight ---------------------------------------------------------------------
    this.plungers.forEach(this.unseePlunger);
    let dashes = 0;
    const prs = state.projectiles;
    for (let i = 0; i < prs.length; i++) dashes = this.syncPlunger(prs[i]!, dashes);
    this.plungers.forEach(this.sweepPlunger);
    this.rope.count = dashes;
    if (dashes) this.rope.instanceMatrix.needsUpdate = true;
  }

  private syncGround(it: ItemPickupState, state: SimState, now: number, dt: number): void {
    let g = this.ground.get(it.id);
    if (!g) g = this.createGround(it, now);
    g.seen = true;
    const t = now;
    if (g.phase === 'incoming' && it.phase === 'ground') this.burstCrate(g);
    g.phase = it.phase;
    g.root.position.set(it.pos.x, 0, it.pos.y);
    if (it.phase === 'incoming') {
      const warn = ITEMS.drop.warnTicks;
      const left = Math.max(0, it.landTick - state.tick);
      const k = Math.min(1, left / warn);
      const y = DROP_HEIGHT * k * k;
      g.crate!.position.y = y;
      g.crate!.rotation.y = Math.sin(t * 1.4) * 0.15;
      g.crate!.rotation.z = Math.sin(t * 2.1) * 0.06;
      // Growing shadow = "lands here in 3 s" (content-plan §5.2, telegraph language).
      const s = 0.5 + 1.1 * (1 - k);
      g.shadow.scale.set(s, 1, s);
      (g.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * (1 - k);
      g.shadow.visible = true;
      g.ring.visible = true;
      g.ringMat.opacity = 0.35 + 0.35 * Math.sin(t * 8) * (1 - k);
      g.ring.scale.setScalar(1.2 + 0.3 * k);
      g.model.root.visible = false;
    } else {
      // On the ground: bob + spin over a pulsing glow ring; blink in the last 3 s.
      const age = now - g.landed;
      const pop = age < 0.25 ? 0.3 + 0.7 * Math.sin((age / 0.25) * Math.PI * 0.5) * 1.15 : 1;
      const calm = this.host.reducedMotion();
      const hop = g.dropped && age < 0.45 ? 0.9 * 4 * (age / 0.45) * (1 - age / 0.45) : 0;
      g.model.root.visible = true;
      g.model.root.position.y = 0.3 + hop + (calm ? 0 : Math.sin(t * 2.6 + it.id) * 0.07);
      g.model.root.rotation.y += dt * (calm ? 0.4 : 1.4);
      g.model.root.scale.setScalar(pop * 1.15);
      const left = it.expiresTick - state.tick;
      const blink = left < 180 && left > 0 && Math.sin(t * (left < 60 ? 30 : 16)) < -0.2;
      g.model.root.visible = !blink;
      const rs = 1 + 0.08 * Math.sin(t * 4);
      if (this.pads < PAD_CAP) {
        // Shared instanced shadow + ring (one draw call each for every resting pickup).
        const i = this.pads++;
        g.shadow.visible = false;
        g.ring.visible = false;
        _q.identity();
        _m.compose(_c.set(it.pos.x, 0.012, it.pos.y), _q, _s.set(0.9, 1, 0.9));
        this.padShadow.setMatrixAt(i, _m);
        _m.compose(_c.set(it.pos.x, 0.02, it.pos.y), _q, _s.set(rs, 1, rs));
        this.padRing.setMatrixAt(i, _m);
        this.padRing.setColorAt(i, g.kind === 'goldHammer' ? RING_GOLD : RING_CREAM);
      } else {
        g.shadow.visible = true;
        g.shadow.scale.set(0.9, 1, 0.9);
        (g.shadow.material as THREE.MeshBasicMaterial).opacity = 0.45;
        g.ring.visible = true;
        g.ring.scale.setScalar(rs);
        g.ringMat.opacity = this.padRingMat.opacity;
      }
      const fl = g.model.flames;
      for (let i = 0; i < fl.length; i++) fl[i]!.visible = false;
    }
  }

  private createGround(it: ItemPickupState, now: number): GroundView {
    const root = new THREE.Group();
    root.name = `pickup:${it.id}`;
    const model = createItemModel(it.kind, false);
    root.add(model.root);
    const shadowMat = new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const shadow = new THREE.Mesh(this.flatGeo(), shadowMat);
    shadow.position.y = 0.012;
    shadow.userData.noOutline = true;
    shadow.renderOrder = -1;
    root.add(shadow);
    const gold = it.kind === 'goldHammer';
    const ringMat = new THREE.MeshBasicMaterial({ map: radialGlowTexture(), color: gold ? PAL.gold : '#FFF1B8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const ring = new THREE.Mesh(this.flatGeo(), ringMat);
    ring.position.y = 0.02;
    ring.scale.setScalar(gold ? 2.6 : 1.8);
    ring.userData.noOutline = true;
    root.add(ring);
    let crate: THREE.Group | null = null;
    if (it.phase === 'incoming') {
      crate = new THREE.Group();
      const box = new THREE.Mesh(crateGeometry(), matVC());
      box.castShadow = true;
      const sides = new THREE.Mesh(crateSidesGeometry(), matTextured(crateSideTexture(it.kind), { rim: 0.3, polygonOffset: -1 }));
      sides.userData.noOutline = true;
      const balloon = new THREE.Mesh(balloonGeometry(), matVC());
      balloon.position.y = 0.4;
      balloon.castShadow = true;
      crate.add(box, sides, balloon);
      crate.userData.balloon = balloon;
      root.add(crate);
      new InkOutline(box);
    }
    this.root.add(root);
    const g: GroundView = {
      id: it.id,
      kind: it.kind,
      root,
      model,
      crate,
      shadow,
      ring,
      ringMat,
      phase: it.phase,
      landed: it.phase === 'ground' ? now : 0,
      dropped: this.droppedIds.delete(it.id) || it.padId === null,
      seen: true,
    };
    if (it.phase === 'ground' && it.padId !== null) g.landed = now - 1; // already there at load
    this.ground.set(it.id, g);
    return g;
  }

  private flatGeoCache: THREE.BufferGeometry | null = null;
  private flatGeo(): THREE.BufferGeometry {
    if (!this.flatGeoCache) {
      this.flatGeoCache = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      this.owned.push(this.flatGeoCache);
    }
    return this.flatGeoCache;
  }

  /** Landing: the crate bursts into planks, the balloon pops, the item pops up. */
  private burstCrate(g: GroundView): void {
    if (!g.crate) return;
    const h = this.host;
    const p = { x: g.root.position.x, y: g.root.position.z };
    const pieces = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pieces.push({
        geometry: plankPieceGeometry(i % 3),
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(p.x + Math.cos(a) * 0.25, 0.35, p.y + Math.sin(a) * 0.25), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0.3)), new THREE.Vector3(1, 1, 1)),
        velocity: new THREE.Vector3(Math.cos(a) * 3, 3.5, Math.sin(a) * 3),
        angular: new THREE.Vector3(6, 9, 4),
        radius: 0.04,
      });
    }
    h.effects.splinters(p, pieces, 'crate');
    h.effects.fx.confetti({ x: p.x, y: 1.4, z: p.y }, { count: 24, colors: ['#FF8FA3', '#FFFFFF', '#FFD45C'], power: 0.6 });
    h.effects.fx.ring({ x: p.x, y: 0, z: p.y }, { radius: g.kind === 'goldHammer' ? 3.5 : 2.2, color: g.kind === 'goldHammer' ? PAL.gold : '#FFFFFF', duration: 0.45 });
    if (g.kind === 'goldHammer') h.effects.fx.sparkle({ x: p.x, y: 0.4, z: p.y }, { count: 24, radius: 1.4, color: PAL.goldLight });
    g.crate.removeFromParent();
    g.crate = null;
    g.landed = h.time();
    g.phase = 'ground';
  }

  private disposeGround(g: GroundView): void {
    g.model.dispose();
    (g.shadow.material as THREE.Material).dispose();
    g.ringMat.dispose();
    g.root.removeFromParent();
  }

  private syncHeld(c: CharacterState, state: SimState, now: number, dt: number): void {
    const item = c.item ?? null;
    let hv = this.held.get(c.id);
    const rig = this.host.charRig(c.id);
    if (!item || !rig) {
      if (hv) {
        this.disposeHeld(hv, rig);
        this.held.delete(c.id);
      }
      rig?.setDizzy((c.dizzyTicks ?? 0) > 0);
      return;
    }
    if (hv && hv.kind !== item.kind) {
      this.disposeHeld(hv, rig);
      this.held.delete(c.id);
      hv = undefined;
    }
    if (!hv) hv = this.createHeld(c.id, item.kind, rig);
    rig.setDizzy((c.dizzyTicks ?? 0) > 0);
    // Phase timing (from the view's own clock: robust to how the sim counts phaseTicks).
    if (item.phase !== hv.phase) {
      hv.phase = item.phase;
      hv.phaseStart = now;
    }
    const since = now - hv.phaseStart;
    const kind = item.kind;
    const hammer = kind === 'hammer' || kind === 'goldHammer';
    let grip: RaccoonGrip = 'none';
    let pose: RaccoonItemPose['phase'] = 'idle';
    let t = 0;
    const H = ITEMS.hammer;
    if (hammer) {
      grip = 'hammer';
      if (item.phase === 'windup') {
        pose = 'windup';
        t = since / (H.windupTicks / 60);
      } else if (item.phase === 'active') {
        pose = 'swing';
        t = since / (H.swingTicks / 60);
      } else if (item.phase === 'recover') {
        pose = 'recover';
        t = since / (H.recoverTicks / 60);
      }
    } else if (kind === 'plunger') {
      grip = 'plunger';
      if (item.phase === 'windup') pose = 'aim';
      else if (item.phase === 'active') {
        pose = 'swing';
        t = since / 0.2;
      }
    } else if (kind === 'soap' || kind === 'smoke' || kind === 'balloons') {
      grip = 'bottle';
      if (item.phase === 'active' || item.phase === 'windup') {
        pose = 'swing';
        t = since / 0.25;
      }
    }
    // Grabbing loot stows the item on the back (R2: dash = carry boost while holding loot).
    const stow = c.grab !== null && grip !== 'none';
    if (stow !== hv.stowed) {
      hv.stowed = stow;
      const m = hv.models[0]!;
      if (stow) {
        rig.attach.back.add(m.root);
        m.root.position.set(-0.05, 0.12, 0);
        m.root.rotation.set(0.0, 0, 2.6);
        m.root.scale.setScalar(0.85);
      } else {
        rig.attach.handR.add(m.root);
        m.root.position.set(0, 0, 0);
        m.root.rotation.set(0, 0, 0);
        m.root.scale.setScalar(1);
      }
    }
    if (grip === 'none' || stow) rig.setItemPose(null);
    else {
      hv.pose.grip = grip;
      hv.pose.phase = pose;
      hv.pose.t = Math.min(1, Math.max(0, t));
      rig.setItemPose(hv.pose);
    }
    // Accordion head squash on hit / clash (spring back).
    if (hv.squash > 0) {
      hv.squash = Math.max(0, hv.squash - dt * 3.2);
      const head = hv.models[0]?.head;
      if (head) {
        const k = hv.squash;
        const sx = 1 - 0.45 * k * Math.cos((1 - k) * 14);
        head.scale.set(Math.max(0.4, sx), 1 / Math.sqrt(Math.max(0.4, sx)), 1 / Math.sqrt(Math.max(0.4, sx)));
      }
    }
    // Swing swoosh (fades through the swing / early recover).
    if (hv.swoosh && hv.swooshMat) {
      const on = pose === 'swing' || (pose === 'recover' && since < 0.12);
      hv.swoosh.visible = on && !stow;
      if (on) hv.swooshMat.opacity = pose === 'swing' ? 0.75 * Math.min(1, t * 3) : 0.75 * (1 - since / 0.12);
    }
    // Skate flames roar while dashing / boosting.
    const roar = c.dashTicks > 0 || c.boostTicks > 0 ? 1 : 0.25;
    for (const m of hv.models) {
      for (const f of m.flames) {
        const fl = roar * (0.75 + 0.25 * Math.sin(now * 40 + f.id));
        f.scale.set(0.3 + fl * 1.2, 0.6 + fl * 0.6, 0.6 + fl * 0.6);
        f.visible = c.knockdownTicks <= 0;
      }
    }
    // Lifetime blink in the last 3 s (never for "until the end").
    const left = item.expiresTick >= ITEM_FOREVER ? Infinity : item.expiresTick - state.tick;
    const blink = left < 180 && Math.sin(now * (left < 60 ? 30 : 16)) < -0.3;
    for (const m of hv.models) m.root.visible = !blink;
    // Golden hammer glints.
    if (kind === 'goldHammer' && now >= hv.nextGlint && dt > 0) {
      hv.nextGlint = now + 0.25;
      const head = hv.models[0]?.head;
      if (head) {
        head.getWorldPosition(_v);
        this.host.effects.fx.sparkle({ x: _v.x, y: _v.y - 0.7, z: _v.z }, { count: 1, radius: 0.2, color: PAL.goldLight });
      }
    }
    // Soap bubbles trail while dashing.
    if (kind === 'soap' && c.dashTicks > 0 && dt > 0 && Math.random() < dt * 20) {
      const p = this.host.charPose(c.id);
      if (p) this.host.effects.fx.sparkle({ x: p.x, y: p.h + 0.1, z: p.y }, { count: 1, radius: 0.3, color: '#F4EEFF' });
    }
  }

  private createHeld(charId: EntityId, kind: ItemKind, rig: RaccoonRig): HeldView {
    const models: ItemModel[] = [];
    if (kind === 'skates') {
      for (const foot of [rig.attach.footL, rig.attach.footR]) {
        const m = createItemModel(kind, true);
        foot.add(m.root);
        models.push(m);
      }
    } else {
      const m = createItemModel(kind, true);
      rig.attach.handR.add(m.root);
      models.push(m);
    }
    let swoosh: THREE.Mesh | null = null;
    let swooshMat: THREE.MeshBasicMaterial | null = null;
    if (kind === 'hammer' || kind === 'goldHammer') {
      swooshMat = new THREE.MeshBasicMaterial({ color: kind === 'goldHammer' ? '#FFE7A1' : '#FFFFFF', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
      swoosh = new THREE.Mesh(swooshGeometry(), swooshMat);
      swoosh.userData.noOutline = true;
      swoosh.castShadow = false;
      swoosh.visible = false;
      // In the body frame at the right shoulder, in the arm's swing plane (x-y).
      swoosh.position.set(0, 0.5, 0.3);
      rig.attach.back.parent?.add(swoosh);
    }
    const hv: HeldView = { charId, kind, models, phase: 'idle', phaseStart: this.host.time(), squash: 0, swoosh, swooshMat, stowed: false, nextGlint: 0, pose: { grip: 'none', phase: 'idle', t: 0 } };
    this.held.set(charId, hv);
    return hv;
  }

  private disposeHeld(hv: HeldView, rig: RaccoonRig | null): void {
    for (const m of hv.models) m.dispose();
    hv.swoosh?.removeFromParent();
    hv.swooshMat?.dispose();
    rig?.setItemPose(null);
  }

  private syncHazard(hz: HazardState, state: SimState, now: number): void {
    let hv = this.hazards.get(hz.id);
    if (!hv) {
      const decal = hz.kind === 'slick' ? new SlickDecal() : new SmokeCloud();
      this.root.add(decal.root);
      hv = { id: hz.id, decal, born: now, seen: true };
      this.hazards.set(hz.id, hv);
    }
    hv.seen = true;
    const left = (hz.untilTick - state.tick) / 60;
    const age = now - hv.born;
    const alpha = Math.min(1, age / 0.2, Math.max(0, left / 0.8));
    const grow = Math.min(1, 0.4 + age / 0.25);
    hv.decal.set(hz.pos.x, hz.pos.y, hz.radius * grow, alpha, now);
  }

  private syncPlunger(pr: ProjectileState, dashes: number): number {
    let pv = this.plungers.get(pr.id);
    if (!pv) {
      const cup = new THREE.Group();
      const m = new THREE.Mesh(plungerCupGeometry(), matVC());
      m.castShadow = true;
      m.rotation.set(0, 0, Math.PI / 2); // opening forward (+x)
      cup.add(m);
      this.root.add(cup);
      pv = { id: pr.id, cup, seen: true };
      this.plungers.set(pr.id, pv);
    }
    pv.seen = true;
    const ang = Math.atan2(pr.vel.y, pr.vel.x);
    pv.cup.position.set(pr.pos.x, 0.65, pr.pos.y);
    pv.cup.rotation.set(0, -ang, 0);
    // Rope: dashes along a sagging curve from the thrower's paw to the cup.
    const rig = this.host.charRig(pr.ownerId);
    if (!rig || dashes + ROPE_DASHES > this.rope.instanceMatrix.count) return dashes;
    rig.attach.handR.getWorldPosition(_a);
    pv.cup.getWorldPosition(_v);
    const len = _a.distanceTo(_v);
    const sag = Math.min(0.5, len * 0.06);
    for (let i = 0; i < ROPE_DASHES; i++) {
      const t0 = i / ROPE_DASHES;
      const t1 = (i + 0.55) / ROPE_DASHES;
      const p0x = _a.x + (_v.x - _a.x) * t0;
      const p0y = _a.y + (_v.y - _a.y) * t0 - Math.sin(Math.PI * t0) * sag;
      const p0z = _a.z + (_v.z - _a.z) * t0;
      const p1x = _a.x + (_v.x - _a.x) * t1;
      const p1y = _a.y + (_v.y - _a.y) * t1 - Math.sin(Math.PI * t1) * sag;
      const p1z = _a.z + (_v.z - _a.z) * t1;
      _d.set(p1x - p0x, p1y - p0y, p1z - p0z);
      const l = _d.length();
      if (l < 1e-4) continue;
      _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / l));
      _s.set(1, l, 1);
      _m.compose(_c.set((p0x + p1x) / 2, (p0y + p1y) / 2, (p0z + p1z) / 2), _q, _s);
      this.rope.setMatrixAt(dashes++, _m);
    }
    return dashes;
  }

  dispose(): void {
    for (const g of this.ground.values()) this.disposeGround(g);
    this.ground.clear();
    for (const hv of this.held.values()) this.disposeHeld(hv, this.host.charRig(hv.charId));
    this.held.clear();
    for (const hv of this.hazards.values()) hv.decal.dispose();
    this.hazards.clear();
    for (const p of this.plungers.values()) p.cup.removeFromParent();
    this.plungers.clear();
    for (const f of this.flats) f.pivot.scale.set(f.bx, f.by, f.bz);
    this.flats.length = 0;
    this.rope.dispose();
    this.padShadow.dispose();
    this.padRing.dispose();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}

/** Free cached item geometry / textures (full teardown only). */
export function disposeItemCache(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const g of displayCache.values()) g?.dispose();
  displayCache.clear();
  for (const t of silTex.values()) t.dispose();
  silTex.clear();
  swooshGeo?.dispose();
  swooshGeo = null;
  flameMat?.dispose();
  flameMat = null;
}
