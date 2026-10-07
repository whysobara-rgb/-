/**
 * Small and large safes (SAFE_SPECS). Value is readable by shape AND number, never color
 * alone (doc §13): the small safe is a compact cube on four stubby feet with a single dial;
 * the large safe is a wide double-door vault on a plinth with a big spoked wheel, straps and
 * corner guards. Gold value plates ('100' / '300') sit on the top face (readable from the
 * high camera) and on the front.
 *
 * Frame: local +X = sim local x, local +Z = sim local y; the door faces local +Z
 * (south when angle = 0, i.e. toward the camera). Place with placeOnSim().
 */
import * as THREE from 'three';
import type { SafeKind } from '../../sim/types';
import { SAFE_SPECS, SCORE } from '../../sim/config';
import { LOOT_STYLE } from '../../shared/teams';
import { PAL } from './palette';
import { G, PartBuilder } from './geometry';
import { createToonMaterial, matTextured, matVC } from './materials';
import { blobShadowTexture, valueCoinTexture, valuePlateTexture } from './textures';
import { Highlighter, InkOutline } from './outline';
import { cameraFacingYaw, trackViewCamera } from './occlusion';

export interface SafeRig {
  readonly root: THREE.Group;
  readonly kind: SafeKind;
  /** Empty object above the safe for value labels. */
  readonly labelAnchor: THREE.Object3D;
  /** Anchored = bolted to the ground (brackets + base plate visible). */
  setAnchored(anchored: boolean): void;
  /** 0..1 unanchor pull intensity: tremble, rock, glowing bolts. */
  setStrain(strain: number): void;
  /** Extra visual lift (m) while it is being pulled out of the ground. */
  setLift(y: number): void;
  /** Seconds since the unanchor pop started (Infinity before / long after). */
  readonly popAge: number;
  setHighlight(color: THREE.ColorRepresentation | null): void;
  /** Advance internal animation (tremble, unanchor pop). */
  update(dt: number): void;
  dispose(): void;
}

interface SafeGeo {
  body: THREE.BufferGeometry;
  /** Front plate on the door (rotates with the safe). */
  plates: THREE.BufferGeometry;
  /** Round coin on the top face; the rig keeps it upright toward the camera. */
  coin: THREE.BufferGeometry;
  coinY: number;
  /** Coin center z (the body sits slightly behind the collider center). */
  coinZ: number;
  anchors: THREE.BufferGeometry;
}

const geoCache = new Map<SafeKind, SafeGeo>();

/**
 * Body frame inside the collider (SAFE_SPECS half extents): the box is inset so that every
 * protrusion (dial, wheel, handles, rings) stays within the collider, so safes pushed against
 * each other or a bank wall touch visually instead of interpenetrating.
 */
interface BodyFrame {
  /** Half width of the body box (x). */
  hx: number;
  /** Back face z and front (door) face z. */
  back: number;
  front: number;
}

function buildSmall(): SafeGeo {
  const col = LOOT_STYLE.smallSafe.color;
  const dark = LOOT_STYLE.smallSafe.dark;
  const light = new THREE.Color(col).lerp(new THREE.Color('#FFFFFF'), 0.35);
  const H = SAFE_SPECS.smallSafe.height; // 0.8
  const spec = SAFE_SPECS.smallSafe.half;
  // Side handles stick out 0.027, door hardware 0.072.
  const f: BodyFrame = { hx: spec.x - 0.031, back: -spec.y + 0.005, front: spec.y - 0.076 };
  const hx = f.hx;
  const depth = f.front - f.back;
  const zc = (f.front + f.back) / 2;
  const foot = 0.07;
  const bodyH = H - foot;
  const cy = foot + bodyH / 2;
  const b = new PartBuilder();
  // Feet.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.cyl(0.8, 1, 10), { color: PAL.steelDark, pos: [sx * (hx - 0.12), foot / 2 + 0.005, zc + sz * (depth / 2 - 0.12)], scale: [0.065, foot + 0.01, 0.065] });
  }
  // Body.
  b.add(G.rbox(hx * 2, bodyH, depth, 0.09, 3), { color: col, pos: [0, cy, zc] });
  // Top lid band (lighter) for a chunky toy look.
  b.add(G.rbox(hx * 2 - 0.1, 0.03, depth - 0.1, 0.012), { color: light, pos: [0, H - 0.012, zc] });
  // Door.
  const fz = f.front;
  b.add(G.rbox(0.58, 0.56, 0.06, 0.04, 2), { color: dark, pos: [0, cy - 0.02, fz - 0.015] });
  b.add(G.rbox(0.52, 0.5, 0.06, 0.035, 2), { color: col, pos: [0, cy - 0.02, fz + 0.0] });
  // Dial (flat, chunky).
  const dial: [number, number] = [-0.07, cy - 0.08];
  b.add(G.cyl(1, 1, 22), { color: PAL.silver, pos: [dial[0], dial[1], fz + 0.03], rot: [Math.PI / 2, 0, 0], scale: [0.105, 0.03, 0.105] });
  b.add(G.cyl(1, 1, 22), { color: PAL.steel, pos: [dial[0], dial[1], fz + 0.05], rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.012, 0.07] });
  b.add(G.sphere(10, 8), { color: PAL.ink, pos: [dial[0], dial[1], fz + 0.058], scale: [0.03, 0.03, 0.014] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(G.box(), {
      color: i === 0 ? '#E85D6A' : PAL.ink,
      pos: [dial[0] + Math.cos(a) * 0.088, dial[1] + Math.sin(a) * 0.088, fz + 0.05],
      rot: [0, 0, a],
      scale: [0.022, 0.008, 0.006],
    });
  }
  // Handle lever.
  b.add(G.cyl(1, 1, 10), { color: PAL.steelDark, pos: [0.17, dial[1], fz + 0.035], rot: [Math.PI / 2, 0, 0], scale: [0.03, 0.04, 0.03] });
  b.add(G.rbox(0.05, 0.17, 0.03, 0.014), { color: PAL.silver, pos: [0.17, dial[1] - 0.05, fz + 0.055] });
  // Hinges.
  for (const y of [cy - 0.2, cy + 0.16]) {
    b.add(G.cyl(1, 1, 10), { color: PAL.steelDark, pos: [-0.3, y, fz + 0.02], scale: [0.026, 0.1, 0.026] });
  }
  // Rivets on the front corners and door corners.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    b.add(G.sphere(8, 6), { color: PAL.silver, pos: [sx * (hx - 0.06), cy + sy * (bodyH / 2 - 0.07), fz + 0.004], scale: 0.022 });
    b.add(G.sphere(8, 6), { color: dark, pos: [sx * 0.225, cy - 0.02 + sy * 0.215, fz + 0.03], scale: 0.016 });
  }
  // Side carry handles (cute, also shows the sides from above).
  for (const sx of [-1, 1]) {
    b.add(G.torus(0.22, 6, 14, Math.PI), { color: PAL.steelDark, pos: [sx * (hx + 0.005), cy + 0.12, zc], rot: [0, Math.PI / 2, 0], scale: [0.11, 0.08, 0.1] });
  }
  // Stickers somebody slapped on it (a cherry and a "fragile" stripe tag) — little stories.
  b.push([hx * 0.55, H - 0.004, zc - depth * 0.28], [-Math.PI / 2, 0, 0.4]);
  b.add(G.cyl(1, 1, 14), { color: '#FFFFFF', rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.006, 0.07] });
  b.add(G.sphere(8, 6), { color: '#E8505B', pos: [-0.018, -0.012, 0.006], scale: [0.026, 0.026, 0.008] });
  b.add(G.sphere(8, 6), { color: '#E8505B', pos: [0.02, -0.016, 0.006], scale: [0.026, 0.026, 0.008] });
  b.add(G.box(), { color: '#5DAA67', pos: [0.006, 0.024, 0.006], rot: [0, 0, 0.5], scale: [0.008, 0.045, 0.004] });
  b.pop();
  b.add(G.box(), { color: '#FFD84D', pos: [-hx - 0.004, cy - 0.08, zc + 0.06], rot: [0, 0, 0.12], scale: [0.006, 0.07, 0.22] });
  b.add(G.box(), { color: PAL.ink, pos: [-hx - 0.007, cy - 0.08, zc + 0.06], rot: [0, 0, 0.12], scale: [0.004, 0.018, 0.16] });
  const body = b.merge('vc')!;

  // Front plate (small, on the door) + round top coin (separate, kept upright).
  const pb = new PartBuilder('plate');
  pb.add(G.plane(), { color: '#FFFFFF', pos: [0, cy + 0.17, fz + 0.034], scale: [0.3, 0.15, 1] });
  const plates = pb.merge('plate')!;
  const coin = new THREE.CircleGeometry(0.29, 28).rotateX(-Math.PI / 2);

  const anchors = buildAnchors(hx, depth / 2, zc, 2);
  return { body, plates, coin, coinY: H + 0.006, coinZ: zc, anchors };
}

function buildLarge(): SafeGeo {
  const col = LOOT_STYLE.largeSafe.color;
  const dark = LOOT_STYLE.largeSafe.dark;
  const light = new THREE.Color(col).lerp(new THREE.Color('#FFFFFF'), 0.3);
  const H = SAFE_SPECS.largeSafe.height; // 1.3
  const spec = SAFE_SPECS.largeSafe.half; // 0.7 x 0.6
  // Lifting rings stick out 0.045, the wheel 0.138.
  const f: BodyFrame = { hx: spec.x - 0.046, back: -spec.y + 0.016, front: spec.y - 0.142 };
  const hx = f.hx;
  const depth = f.front - f.back;
  const zc = (f.front + f.back) / 2;
  const plinth = 0.13;
  const crown = 0.08;
  const bodyH = H - plinth - crown;
  const cy = plinth + bodyH / 2;
  const b = new PartBuilder();
  // Plinth + chunky feet.
  b.add(G.rbox(hx * 2 - 0.04, plinth, depth - 0.04, 0.04), { color: PAL.steelDark, pos: [0, plinth / 2, zc] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.rbox(0.2, 0.06, 0.2, 0.025), { color: PAL.ink, pos: [sx * (hx - 0.12), 0.03, zc + sz * (depth / 2 - 0.12)] });
  }
  // Body + crown molding.
  b.add(G.rbox(hx * 2 - 0.02, bodyH, depth - 0.02, 0.1, 3), { color: col, pos: [0, cy, zc] });
  b.add(G.rbox(hx * 2, crown, depth, 0.035), { color: dark, pos: [0, H - crown / 2, zc] });
  b.add(G.rbox(hx * 2 - 0.16, 0.025, depth - 0.16, 0.01), { color: light, pos: [0, H + 0.005, zc] });
  // Corner guards.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const gz = zc + sz * (depth / 2 - 0.045);
    b.add(G.rbox(0.12, bodyH + 0.02, 0.12, 0.04), { color: dark, pos: [sx * (hx - 0.045), cy, gz] });
    for (const y of [cy - bodyH * 0.35, cy, cy + bodyH * 0.35]) {
      b.add(G.sphere(8, 6), { color: PAL.silver, pos: [sx * (hx - 0.01), y, gz], scale: 0.022 });
    }
  }
  // Strap band (lower) around the body.
  b.add(G.rbox(hx * 2 + 0.02, 0.07, depth + 0.02, 0.03), { color: dark, pos: [0, plinth + 0.17, zc] });
  // Double doors.
  const fz = f.front;
  const doorY = cy + 0.03;
  const doorH = bodyH - 0.2;
  for (const sx of [-1, 1]) {
    b.add(G.rbox(0.5, doorH, 0.06, 0.04, 2), { color: light, pos: [sx * 0.265, doorY, fz - 0.005] });
    b.add(G.rbox(0.44, doorH - 0.08, 0.05, 0.035, 2), { color: col, pos: [sx * 0.265, doorY, fz + 0.012] });
    // Hinges on the outer edges.
    for (const dy of [-0.28, 0.28]) {
      b.add(G.cyl(1, 1, 12), { color: PAL.steelDark, pos: [sx * 0.53, doorY + dy, fz + 0.03], scale: [0.035, 0.16, 0.035] });
      b.add(G.sphere(8, 6), { color: PAL.silver, pos: [sx * 0.53, doorY + dy + 0.085, fz + 0.03], scale: 0.03 });
    }
  }
  // Door seam.
  b.add(G.box(), { color: dark, pos: [0, doorY, fz + 0.03], scale: [0.025, doorH - 0.04, 0.02] });
  // Big spoked wheel (capstan), gold, offset in front of the seam.
  const wy = doorY - 0.06;
  const wz = fz + 0.1;
  b.add(G.cyl(1, 1, 18), { color: PAL.steelDark, pos: [0, wy, fz + 0.05], rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.1, 0.07] });
  b.add(G.torus(0.13, 8, 30), { color: PAL.gold, pos: [0, wy, wz], scale: [0.21, 0.21, 0.21], emissive: 0.06 });
  b.add(G.cyl(1, 1, 16), { color: PAL.goldDark, pos: [0, wy, wz], rot: [Math.PI / 2, 0, 0], scale: [0.065, 0.06, 0.065] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    b.add(G.cyl(1, 1, 8), { color: PAL.gold, pos: [Math.cos(a) * 0.12, wy + Math.sin(a) * 0.12, wz], rot: [0, 0, a + Math.PI / 2], scale: [0.018, 0.22, 0.018] });
    b.add(G.sphere(10, 8), { color: PAL.goldLight, pos: [Math.cos(a) * 0.29, wy + Math.sin(a) * 0.29, wz], scale: 0.036, emissive: 0.08 });
  }
  // Keyhole plate on the right door.
  b.add(G.rbox(0.07, 0.12, 0.02, 0.02), { color: PAL.silver, pos: [0.17, wy + 0.02, fz + 0.04] });
  b.add(G.sphere(8, 6), { color: PAL.ink, pos: [0.17, wy + 0.04, fz + 0.052], scale: [0.012, 0.012, 0.006] });
  // Side lifting rings.
  for (const sx of [-1, 1]) {
    b.add(G.torus(0.2, 6, 16), { color: PAL.steelDark, pos: [sx * (hx + 0.024), cy + 0.2, zc], rot: [0, Math.PI / 2, 0], scale: 0.1 });
  }
  // A smiley sticker on the crown and a gold "VIP" star tag on the side.
  b.push([-hx * 0.55, H + 0.008, zc + depth * 0.22], [-Math.PI / 2, 0, -0.3]);
  b.add(G.cyl(1, 1, 16), { color: '#FFD45C', rot: [Math.PI / 2, 0, 0], scale: [0.09, 0.006, 0.09] });
  for (const sx of [-1, 1]) b.add(G.sphere(6, 4), { color: PAL.ink, pos: [sx * 0.03, 0.02, 0.006], scale: [0.011, 0.016, 0.004] });
  b.add(G.torus(0.25, 4, 10, Math.PI), { color: PAL.ink, pos: [0, -0.012, 0.006], rot: [0, 0, Math.PI], scale: [0.04, 0.03, 0.02] });
  b.pop();
  b.add(G.box(), { color: '#FF8FA3', pos: [hx + 0.003, cy - 0.15, zc - 0.1], rot: [0.15, 0, 0], scale: [0.006, 0.1, 0.18] });
  const body = b.merge('vc')!;

  const pb = new PartBuilder('plate');
  pb.add(G.plane(), { color: '#FFFFFF', pos: [0, doorY + doorH / 2 - 0.13, fz + 0.042], scale: [0.4, 0.2, 1] });
  const plates = pb.merge('plate')!;
  const coin = new THREE.CircleGeometry(0.45, 32).rotateX(-Math.PI / 2);

  const anchors = buildAnchors(hx, depth / 2, zc, 3);
  return { body, plates, coin, coinY: H + 0.022, coinZ: zc, anchors };
}

/**
 * Anchor hardware: a steel base plate under the safe plus L-brackets with chunky bolt heads
 * on the two long sides (visible from the high camera).
 */
function buildAnchors(hx: number, hz: number, zc: number, perSide: number): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.push([0, 0, zc]);
  b.add(G.rbox(hx * 2 + 0.36, 0.025, hz * 2 + 0.2, 0.012), { color: PAL.steel, pos: [0, 0.0125, 0] });
  // Hazard corner marks on the plate.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.box(), { color: '#FFD84D', pos: [sx * (hx + 0.12), 0.027, sz * (hz + 0.04)], scale: [0.1, 0.006, 0.05] });
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      const z = perSide === 1 ? 0 : -hz + 0.18 + (i * (hz * 2 - 0.36)) / (perSide - 1);
      const x = sx * (hx + 0.02);
      // Vertical plate against the safe side.
      b.add(G.rbox(0.035, 0.2, 0.13, 0.01), { color: PAL.steelDark, pos: [x, 0.12, z] });
      // Foot plate.
      b.add(G.rbox(0.16, 0.035, 0.13, 0.01), { color: PAL.steelDark, pos: [x + sx * 0.08, 0.04, z] });
      // Bolt heads (emissive channel used for the strain glow).
      b.add(G.cyl(1, 1, 6), { color: '#FFD84D', pos: [x + sx * 0.1, 0.07, z], scale: [0.032, 0.04, 0.032] });
      b.add(G.cyl(1, 1, 6), { color: '#FFD84D', pos: [x + sx * 0.015, 0.18, z], rot: [0, 0, Math.PI / 2], scale: [0.025, 0.03, 0.025] });
    }
  }
  b.pop();
  return b.merge('vc')!;
}

function getGeo(kind: SafeKind): SafeGeo {
  let g = geoCache.get(kind);
  if (!g) {
    g = kind === 'smallSafe' ? buildSmall() : buildLarge();
    geoCache.set(kind, g);
  }
  return g;
}

let blobGeo: THREE.BufferGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;

/** Unanchor pop timing per safe size (seconds / meters); landing at 62 % of the time. */
export const SAFE_POP = {
  small: { time: 0.6, height: 0.55 },
  large: { time: 0.7, height: 0.4 },
} as const;

export function createSafe(kind: SafeKind): SafeRig {
  const geo = getGeo(kind);
  const spec = SAFE_SPECS[kind];
  const value = kind === 'smallSafe' ? SCORE.smallSafe : SCORE.largeSafe;

  const root = new THREE.Group();
  root.name = kind;
  const body = new THREE.Group();
  root.add(body);

  const bodyMesh = new THREE.Mesh(geo.body, matVC());
  bodyMesh.name = `${kind}:body`;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  body.add(bodyMesh);

  const plates = new THREE.Mesh(geo.plates, matTextured(valuePlateTexture(value), { alphaTest: 0.35, rim: 0.2, polygonOffset: -1 }));
  plates.name = `${kind}:plates`;
  plates.userData.noOutline = true;
  plates.receiveShadow = true;
  body.add(plates);
  // Top coin: a round plate, so it can turn to keep the number upright for the fixed
  // camera without looking misaligned with the box.
  const coin = new THREE.Mesh(geo.coin, matTextured(valueCoinTexture(value), { alphaTest: 0.35, rim: 0.2, polygonOffset: -1 }));
  coin.name = `${kind}:coin`;
  coin.position.set(0, geo.coinY, geo.coinZ);
  coin.userData.noOutline = true;
  coin.receiveShadow = true;
  trackViewCamera(coin);
  body.add(coin);

  // Per-instance material so the bolts can glow with strain.
  const anchorMat = createToonMaterial({ vertexColors: true, fx: true, rim: 0.6 });
  const anchors = new THREE.Mesh(geo.anchors, anchorMat);
  anchors.name = `${kind}:anchors`;
  anchors.userData.noOutline = true;
  anchors.receiveShadow = true;
  anchors.castShadow = true;
  root.add(anchors);

  if (!blobGeo) blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  if (!blobMat)
    blobMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.scale.set(spec.half.x * 2.7, 1, spec.half.y * 2.7);
  blob.position.y = 0.01;
  blob.userData.noOutline = true;
  blob.renderOrder = -1;
  root.add(blob);

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.y = spec.height + 0.45;
  root.add(labelAnchor);

  // Silhouette-only outline (the dial / wheel / hinges do not get inner lines) + a permanent
  // ink silhouette so loot pops at the game camera (inside banks too).
  const highlighter = new Highlighter(body, { pushMax: 0.4, pushSlope: 0.8 });
  const ink = new InkOutline(body, { pushMax: 0.4, pushSlope: 0.8 });

  let anchored = true;
  let strain = 0;
  let lift = 0;
  let time = Math.random() * 10;
  let pop = 0; // seconds remaining of the unanchor pop
  const POP_TIME = kind === 'smallSafe' ? SAFE_POP.small.time : SAFE_POP.large.time;
  const POP_H = kind === 'smallSafe' ? SAFE_POP.small.height : SAFE_POP.large.height;
  const spinDir = Math.random() < 0.5 ? -1 : 1;
  const rockSign = Math.random() < 0.5 ? -1 : 1;

  const wq = new THREE.Quaternion();
  const we = new THREE.Euler();
  const update = (dt: number): void => {
    time += dt;
    const s = anchored ? strain : 0;
    // Tremble + rocking while being pulled.
    const violent = 0.012 * s + 0.035 * s * s * s;
    body.position.x = Math.sin(time * 47) * violent;
    body.position.z = Math.sin(time * 39 + 1.1) * violent;
    body.rotation.z = rockSign * (Math.sin(time * 9) * 0.5 + 0.5) * 0.07 * s + Math.sin(time * 33) * 0.03 * s * s * s;
    body.rotation.x = Math.sin(time * 7.3) * 0.025 * s;
    anchors.position.x = Math.sin(time * 61) * 0.006 * s;
    const glow = s * (0.55 + 0.45 * Math.sin(time * 14));
    anchorMat.emissive.setRGB(1.0 * glow, 0.35 * glow, 0.12 * glow);
    // Unanchor pop: big hop (stretch up, a flip for the small one), slam + squash on landing.
    body.rotation.y = 0;
    if (pop > 0) {
      pop = Math.max(0, pop - dt);
      const age = POP_TIME - pop;
      const land = POP_TIME * 0.62;
      let sq = 1;
      if (age < land) {
        const u = age / land;
        body.position.y = lift + POP_H * 4 * u * (1 - u);
        sq = 1 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.6));
        if (kind === 'smallSafe') body.rotation.y = spinDir * u * Math.PI * 2;
        else body.rotation.z += Math.sin(u * Math.PI) * 0.18 * spinDir;
      } else {
        const v = age - land;
        body.position.y = lift;
        sq = 1 - 0.22 * Math.exp(-v * 10) * Math.cos(v * 30);
      }
      body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    } else {
      body.position.y = lift;
      body.scale.set(1, 1, 1);
    }
    // Keep the coin's number upright on screen for the current camera (north-looking match
    // camera: world yaw 0; results / title shots may look from elsewhere). Runs after the pop
    // so it cancels THIS frame's body spin (the small safe's flip), not last frame's.
    root.getWorldQuaternion(wq);
    we.setFromQuaternion(wq, 'YXZ');
    coin.rotation.y = cameraFacingYaw() - we.y - body.rotation.y;
  };

  return {
    root,
    kind,
    labelAnchor,
    setAnchored(b: boolean) {
      if (anchored && !b) pop = POP_TIME;
      anchored = b;
      anchors.visible = b;
      if (!b) anchorMat.emissive.setRGB(0, 0, 0);
    },
    setStrain(s: number) {
      strain = THREE.MathUtils.clamp(s, 0, 1);
    },
    setLift(y: number) {
      lift = Math.max(0, y);
    },
    get popAge() {
      return pop > 0 ? POP_TIME - pop : Infinity;
    },
    setHighlight(color) {
      highlighter.set(color);
      ink.setVisible(color === null || color === undefined);
    },
    update,
    dispose() {
      highlighter.dispose();
      ink.dispose();
      anchorMat.dispose();
      root.removeFromParent();
    },
  };
}

export function disposeSafeCache(): void {
  for (const g of geoCache.values()) {
    g.body.dispose();
    g.plates.dispose();
    g.coin.dispose();
    g.anchors.dispose();
  }
  geoCache.clear();
  blobGeo?.dispose();
  blobMat?.dispose();
  blobGeo = null;
  blobMat = null;
}
