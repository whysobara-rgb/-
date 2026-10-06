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
import { Highlighter } from './outline';

export interface SafeRig {
  readonly root: THREE.Group;
  readonly kind: SafeKind;
  /** Empty object above the safe for value labels. */
  readonly labelAnchor: THREE.Object3D;
  /** Anchored = bolted to the ground (brackets + base plate visible). */
  setAnchored(anchored: boolean): void;
  /** 0..1 unanchor pull intensity: tremble, rock, glowing bolts. */
  setStrain(strain: number): void;
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
  anchors: THREE.BufferGeometry;
}

const geoCache = new Map<SafeKind, SafeGeo>();

function buildSmall(): SafeGeo {
  const col = LOOT_STYLE.smallSafe.color;
  const dark = LOOT_STYLE.smallSafe.dark;
  const light = new THREE.Color(col).lerp(new THREE.Color('#FFFFFF'), 0.35);
  const H = SAFE_SPECS.smallSafe.height; // 0.8
  const hx = SAFE_SPECS.smallSafe.half.x;
  const hz = SAFE_SPECS.smallSafe.half.y;
  const foot = 0.07;
  const bodyH = H - foot;
  const cy = foot + bodyH / 2;
  const b = new PartBuilder();
  // Feet.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.cyl(0.8, 1, 10), { color: PAL.steelDark, pos: [sx * (hx - 0.12), foot / 2 + 0.005, sz * (hz - 0.12)], scale: [0.065, foot + 0.01, 0.065] });
  }
  // Body.
  b.add(G.rbox(hx * 2, bodyH, hz * 2, 0.09, 3), { color: col, pos: [0, cy, 0] });
  // Top lid band (lighter) for a chunky toy look.
  b.add(G.rbox(hx * 2 - 0.1, 0.03, hz * 2 - 0.1, 0.012), { color: light, pos: [0, H - 0.012, 0] });
  // Door.
  const fz = hz;
  b.add(G.rbox(0.6, 0.56, 0.06, 0.04, 2), { color: dark, pos: [0, cy - 0.02, fz - 0.015] });
  b.add(G.rbox(0.54, 0.5, 0.06, 0.035, 2), { color: col, pos: [0, cy - 0.02, fz + 0.0] });
  // Dial.
  const dial: [number, number] = [-0.07, cy - 0.08];
  b.add(G.cyl(1, 1, 22), { color: PAL.silver, pos: [dial[0], dial[1], fz + 0.04], rot: [Math.PI / 2, 0, 0], scale: [0.105, 0.04, 0.105] });
  b.add(G.cyl(1, 1, 22), { color: PAL.steel, pos: [dial[0], dial[1], fz + 0.062], rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.012, 0.07] });
  b.add(G.sphere(10, 8), { color: PAL.ink, pos: [dial[0], dial[1], fz + 0.07], scale: [0.03, 0.03, 0.02] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(G.box(), {
      color: i === 0 ? '#E85D6A' : PAL.ink,
      pos: [dial[0] + Math.cos(a) * 0.088, dial[1] + Math.sin(a) * 0.088, fz + 0.062],
      rot: [0, 0, a],
      scale: [0.022, 0.008, 0.006],
    });
  }
  // Handle lever.
  b.add(G.cyl(1, 1, 10), { color: PAL.steelDark, pos: [0.17, dial[1], fz + 0.045], rot: [Math.PI / 2, 0, 0], scale: [0.03, 0.05, 0.03] });
  b.add(G.rbox(0.05, 0.17, 0.035, 0.016), { color: PAL.silver, pos: [0.17, dial[1] - 0.05, fz + 0.075] });
  // Hinges.
  for (const y of [cy - 0.2, cy + 0.16]) {
    b.add(G.cyl(1, 1, 10), { color: PAL.steelDark, pos: [-0.31, y, fz + 0.02], scale: [0.026, 0.1, 0.026] });
  }
  // Rivets on the front corners and door corners.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    b.add(G.sphere(8, 6), { color: PAL.silver, pos: [sx * (hx - 0.07), cy + sy * (bodyH / 2 - 0.07), fz + 0.004], scale: 0.022 });
    b.add(G.sphere(8, 6), { color: dark, pos: [sx * 0.235, cy - 0.02 + sy * 0.215, fz + 0.03], scale: 0.016 });
  }
  // Side carry handles (cute, also shows the sides from above).
  for (const sx of [-1, 1]) {
    b.add(G.torus(0.22, 6, 14, Math.PI), { color: PAL.steelDark, pos: [sx * (hx + 0.005), cy + 0.12, 0], rot: [0, Math.PI / 2, 0], scale: [0.11, 0.08, 0.1] });
  }
  const body = b.merge('vc')!;

  // Front plate (small, on the door) + round top coin (separate, kept upright).
  const pb = new PartBuilder('plate');
  pb.add(G.plane(), { color: '#FFFFFF', pos: [0, cy + 0.17, fz + 0.034], scale: [0.3, 0.15, 1] });
  const plates = pb.merge('plate')!;
  const coin = new THREE.CircleGeometry(0.3, 28).rotateX(-Math.PI / 2);

  const anchors = buildAnchors(hx, hz, 2);
  return { body, plates, coin, coinY: H + 0.006, anchors };
}

function buildLarge(): SafeGeo {
  const col = LOOT_STYLE.largeSafe.color;
  const dark = LOOT_STYLE.largeSafe.dark;
  const light = new THREE.Color(col).lerp(new THREE.Color('#FFFFFF'), 0.3);
  const H = SAFE_SPECS.largeSafe.height; // 1.3
  const hx = SAFE_SPECS.largeSafe.half.x; // 0.7
  const hz = SAFE_SPECS.largeSafe.half.y; // 0.6
  const plinth = 0.13;
  const crown = 0.08;
  const bodyH = H - plinth - crown;
  const cy = plinth + bodyH / 2;
  const b = new PartBuilder();
  // Plinth + chunky feet.
  b.add(G.rbox(hx * 2 - 0.04, plinth, hz * 2 - 0.04, 0.04), { color: PAL.steelDark, pos: [0, plinth / 2, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.rbox(0.2, 0.06, 0.2, 0.025), { color: PAL.ink, pos: [sx * (hx - 0.12), 0.03, sz * (hz - 0.12)] });
  }
  // Body + crown molding.
  b.add(G.rbox(hx * 2 - 0.02, bodyH, hz * 2 - 0.02, 0.1, 3), { color: col, pos: [0, cy, 0] });
  b.add(G.rbox(hx * 2, crown, hz * 2, 0.035), { color: dark, pos: [0, H - crown / 2, 0] });
  b.add(G.rbox(hx * 2 - 0.16, 0.025, hz * 2 - 0.16, 0.01), { color: light, pos: [0, H + 0.005, 0] });
  // Corner guards.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.rbox(0.12, bodyH + 0.02, 0.12, 0.04), { color: dark, pos: [sx * (hx - 0.045), cy, sz * (hz - 0.045)] });
    for (const y of [cy - bodyH * 0.35, cy, cy + bodyH * 0.35]) {
      b.add(G.sphere(8, 6), { color: PAL.silver, pos: [sx * (hx - 0.01), y, sz * (hz - 0.045)], scale: 0.022 });
    }
  }
  // Strap band (lower) around the body.
  b.add(G.rbox(hx * 2 + 0.02, 0.07, hz * 2 + 0.02, 0.03), { color: dark, pos: [0, plinth + 0.17, 0] });
  // Double doors.
  const fz = hz;
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
    b.add(G.sphere(10, 8), { color: PAL.goldLight, pos: [Math.cos(a) * 0.29, wy + Math.sin(a) * 0.29, wz], scale: 0.038, emissive: 0.08 });
  }
  // Keyhole plate on the right door.
  b.add(G.rbox(0.07, 0.12, 0.02, 0.02), { color: PAL.silver, pos: [0.17, wy + 0.02, fz + 0.04] });
  b.add(G.sphere(8, 6), { color: PAL.ink, pos: [0.17, wy + 0.04, fz + 0.052], scale: [0.012, 0.012, 0.006] });
  // Side lifting rings.
  for (const sx of [-1, 1]) {
    b.add(G.torus(0.2, 6, 16), { color: PAL.steelDark, pos: [sx * (hx + 0.03), cy + 0.2, 0], rot: [0, Math.PI / 2, 0], scale: 0.1 });
  }
  const body = b.merge('vc')!;

  const pb = new PartBuilder('plate');
  pb.add(G.plane(), { color: '#FFFFFF', pos: [0, doorY + doorH / 2 - 0.13, fz + 0.042], scale: [0.4, 0.2, 1] });
  const plates = pb.merge('plate')!;
  const coin = new THREE.CircleGeometry(0.47, 32).rotateX(-Math.PI / 2);

  const anchors = buildAnchors(hx, hz, 3);
  return { body, plates, coin, coinY: H + 0.022, anchors };
}

/**
 * Anchor hardware: a steel base plate under the safe plus L-brackets with chunky bolt heads
 * on the two long sides (visible from the high camera).
 */
function buildAnchors(hx: number, hz: number, perSide: number): THREE.BufferGeometry {
  const b = new PartBuilder();
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
  coin.position.y = geo.coinY;
  coin.userData.noOutline = true;
  coin.receiveShadow = true;
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

  const highlighter = new Highlighter(body);

  let anchored = true;
  let strain = 0;
  let time = Math.random() * 10;
  let pop = 0; // seconds remaining of the unanchor pop
  const POP_TIME = 0.45;
  const rockSign = Math.random() < 0.5 ? -1 : 1;

  const wq = new THREE.Quaternion();
  const we = new THREE.Euler();
  const update = (dt: number): void => {
    time += dt;
    // Keep the coin's number upright toward the camera (world +Z side).
    root.getWorldQuaternion(wq);
    we.setFromQuaternion(wq, 'YXZ');
    coin.rotation.y = -we.y - body.rotation.y;
    const s = anchored ? strain : 0;
    // Tremble + rocking while being pulled.
    body.position.x = Math.sin(time * 47) * 0.012 * s;
    body.position.z = Math.sin(time * 39 + 1.1) * 0.012 * s;
    body.rotation.z = rockSign * (Math.sin(time * 9) * 0.5 + 0.5) * 0.045 * s;
    body.rotation.x = Math.sin(time * 7.3) * 0.02 * s;
    anchors.position.x = Math.sin(time * 61) * 0.006 * s;
    const glow = s * (0.55 + 0.45 * Math.sin(time * 14));
    anchorMat.emissive.setRGB(1.0 * glow, 0.35 * glow, 0.12 * glow);
    // Unanchor pop: little hop with squash & stretch.
    if (pop > 0) {
      pop = Math.max(0, pop - dt);
      const k = 1 - pop / POP_TIME;
      const hop = Math.sin(k * Math.PI) * (kind === 'smallSafe' ? 0.16 : 0.1);
      body.position.y = hop;
      const sq = 1 + Math.sin(k * Math.PI * 2) * 0.08 * (1 - k);
      body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    } else {
      body.position.y = 0;
      body.scale.set(1, 1, 1);
    }
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
    setHighlight(color) {
      highlighter.set(color);
    },
    update,
    dispose() {
      highlighter.dispose();
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
