/**
 * The shared bank model (BANK_MODEL: 8 x 6 m footprint, wall height 3.2, two doors on the
 * local ±y walls). Visual walls and door gaps come straight from the config so they match
 * the colliders exactly.
 *
 * Frame: local +X = sim local x, local +Z = sim local y (front door faces +Z = south when
 * angle = 0, toward the camera). Place with placeOnSim(rig.root, pos, angle).
 *
 * Structure (each piece is one merged draw call):
 *   root (view transform)
 *    └ body (uproot pop, strain tremble)
 *       ├ slab        foundation (top at BANK_FLOOR_Y) + painted floor + dashed outline
 *       ├ walls[0..5] one Object3D per BANK_MODEL.walls entry, same order (individual fade)
 *       ├ headers     door lintels + awnings (fade with the min of their two walls)
 *       ├ roof        separate object (hide / fade when the player is inside); carries the
 *       │             '은행 BANK' sign on a wobbly pivot
 *       ├ rootsAttached  cartoon roots / pipes / cables running into the ground (anchored)
 *       └ rootsSnapped   snapped stubs + clinging dirt + sparks (uprooted)
 *
 * The title means "uprooted": while anchored the bank is visibly plumbed into the ground;
 * setUprooted(true) snaps everything (pop + big sign wobble). createBankScar() builds the
 * torn-up patch the view can leave where the bank stood.
 */
import * as THREE from 'three';
import { BANK_MODEL } from '../../sim/config';
import { PAL } from './palette';
import { G, PartBuilder, rampSway, taperedTube, rng, type V3 } from './geometry';
import { createToonMaterial, matVC, matWater, setMaterialOpacity } from './materials';
import { bankFloorTexture, bankSignTexture, dashedLineTexture } from './textures';
import { Highlighter } from './outline';

/** Height of the bank floor surface (slab top). Raise characters/safes on the floor by this. */
export const BANK_FLOOR_Y = 0.06;
/** Height for the floating value label above the bank. */
export const BANK_LABEL_HEIGHT = 6.0;

const H = BANK_MODEL.wallHeight;
const T = BANK_MODEL.wallThickness;
const HX = BANK_MODEL.half.x;
const HZ = BANK_MODEL.half.y;
const DOOR_W = BANK_MODEL.doorWidth;
const DOOR_TOP = 2.45;
/** The slab rim extends past the footprint; the dashed band's INNER edge is the exact range. */
const RIM = 0.22;
const SLAB_BOTTOM = -0.25;

export interface BankRig {
  readonly root: THREE.Group;
  /** Roof group (hide or fade when the player is inside). */
  readonly roof: THREE.Object3D;
  /** One object per BANK_MODEL.walls entry, same order. */
  readonly walls: readonly THREE.Object3D[];
  readonly labelAnchor: THREE.Object3D;
  setRoofOpacity(a: number): void;
  setWallOpacity(index: number, a: number): void;
  setUprooted(uprooted: boolean): void;
  /** 0..1 unanchor pull intensity (tremble, taut roots, sign rattle). */
  setStrain(s: number): void;
  /** Kick the sign (e.g. on bumps, fence breaks, unanchor). */
  wobbleSign(amount: number): void;
  setHighlight(color: THREE.ColorRepresentation | null): void;
  /** Advance sign spring, pop, tremble. Reads the root's world motion for inertia. */
  update(dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Wall frames
// ---------------------------------------------------------------------------

interface WallFrame {
  /** Wall center (bank local, three coords). */
  cx: number;
  cz: number;
  /** Length along the wall. */
  len: number;
  /** Yaw so that frame +x runs along the wall and frame +z points outside. */
  yaw: number;
  /** Which frame-u ends touch a door (+1 = +len/2 end, -1 = -len/2 end). */
  doorEnds: number[];
  /** Side walls own the corners. */
  side: boolean;
}

function wallFrames(): WallFrame[] {
  return BANK_MODEL.walls.map((w) => {
    const alongX = w.half.x > w.half.y;
    const len = 2 * (alongX ? w.half.x : w.half.y);
    let yaw: number;
    if (alongX) yaw = w.center.y > 0 ? 0 : Math.PI;
    else yaw = w.center.x > 0 ? Math.PI / 2 : -Math.PI / 2;
    const ux = Math.cos(yaw);
    const uz = -Math.sin(yaw);
    const doorEnds: number[] = [];
    for (const end of [-1, 1]) {
      const ex = w.center.x + ux * end * (len / 2);
      const ez = w.center.y + uz * end * (len / 2);
      for (const d of BANK_MODEL.doors) {
        const dist = Math.hypot(ex - d.center.x, ez - d.center.y);
        if (Math.abs(dist - DOOR_W / 2) < 0.06) doorEnds.push(end);
      }
    }
    return { cx: w.center.x, cz: w.center.y, len, yaw, doorEnds, side: !alongX };
  });
}

/** Arched window on the exterior face of a wall (frame coordinates). */
function addWindow(b: PartBuilder, u: number, w: number, h: number, sill: number): void {
  const z = T / 2;
  const top = sill + h;
  // Glass through the wall (seen from inside and outside), warm interior glow.
  b.add(G.box(), { color: '#FFE3A8', pos: [u, sill + h / 2, 0], scale: [w, h, T + 0.02], emissive: 0.5 });
  b.add(G.cyl(1, 1, 18), { color: '#FFE3A8', pos: [u, top, 0], rot: [Math.PI / 2, 0, 0], scale: [w / 2, T + 0.02, w / 2], emissive: 0.5 });
  // Frame (outside).
  b.add(G.rbox(0.1, h, 0.08, 0.03), { color: PAL.column, pos: [u - w / 2 - 0.04, sill + h / 2, z + 0.02] });
  b.add(G.rbox(0.1, h, 0.08, 0.03), { color: PAL.column, pos: [u + w / 2 + 0.04, sill + h / 2, z + 0.02] });
  b.add(G.torus(0.09, 6, 16, Math.PI), { color: PAL.column, pos: [u, top, z + 0.02], scale: [w / 2 + 0.04, w / 2 + 0.04, 0.45] });
  // Mullions.
  b.add(G.box(), { color: PAL.column, pos: [u, sill + h * 0.55, z + 0.012], scale: [w, 0.05, 0.03] });
  b.add(G.box(), { color: PAL.column, pos: [u, sill + (h + w / 2) / 2, z + 0.012], scale: [0.05, h + w / 2, 0.03] });
  // Sill.
  b.add(G.rbox(w + 0.3, 0.08, 0.16, 0.03), { color: PAL.stone, pos: [u, sill - 0.04, z + 0.04] });
  // Keystone.
  b.add(G.rbox(0.16, 0.2, 0.08, 0.03), { color: PAL.bankTrim, pos: [u, top + w / 2 + 0.06, z + 0.03] });
}

function addSconce(b: PartBuilder, u: number, y: number, z: number, dir: number): void {
  b.add(G.rbox(0.12, 0.2, 0.04, 0.02), { color: PAL.goldDark, pos: [u, y, z] });
  b.add(G.cyl(1, 1, 8), { color: PAL.goldDark, pos: [u, y + 0.06, z + dir * 0.08], rot: [Math.PI / 2, 0, 0], scale: [0.02, 0.14, 0.02] });
  b.add(G.sphere(12, 8), { color: '#FFE6A8', pos: [u, y + 0.14, z + dir * 0.15], scale: [0.08, 0.1, 0.08], emissive: 1.2 });
}

function addFrame(b: PartBuilder, u: number, y: number, z: number, dir: number, w: number, h: number, art: string, accent: string): void {
  b.add(G.rbox(w + 0.12, h + 0.12, 0.05, 0.02), { color: PAL.gold, pos: [u, y, z + dir * 0.02] });
  b.add(G.box(), { color: art, pos: [u, y, z + dir * 0.048], scale: [w, h, 0.01] });
  // Simple motif: hills + sun / coin.
  b.add(G.sphere(12, 8), { color: accent, pos: [u + w * 0.18, y + h * 0.15, z + dir * 0.05], scale: [h * 0.18, h * 0.18, 0.008], emissive: 0.15 });
  b.add(G.sphere(12, 8), { color: '#8CCB7E', pos: [u - w * 0.12, y - h * 0.38, z + dir * 0.052], scale: [w * 0.45, h * 0.3, 0.008] });
}

/** Big round vault door decoration mounted on an interior wall face. */
function addVaultDoor(b: PartBuilder, u: number, y: number, z: number, dir: number): void {
  const r = 0.62;
  b.add(G.cyl(1, 1, 32), { color: PAL.steelDark, pos: [u, y, z + dir * 0.02], rot: [Math.PI / 2, 0, 0], scale: [r + 0.08, 0.04, r + 0.08] });
  b.add(G.cyl(1, 1, 32), { color: PAL.vault, pos: [u, y, z + dir * 0.05], rot: [Math.PI / 2, 0, 0], scale: [r, 0.05, r] });
  b.add(G.torus(0.06, 6, 32), { color: PAL.steel, pos: [u, y, z + dir * 0.075], scale: [r * 0.82, r * 0.82, 0.3] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(G.sphere(8, 6), { color: PAL.silver, pos: [u + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92, z + dir * 0.08], scale: 0.035 });
  }
  b.add(G.cyl(1, 1, 16), { color: PAL.gold, pos: [u, y, z + dir * 0.085], rot: [Math.PI / 2, 0, 0], scale: [0.12, 0.05, 0.12], emissive: 0.1 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    b.add(G.cyl(1, 1, 8), { color: PAL.gold, pos: [u, y, z + dir * 0.095], rot: [0, 0, a], scale: [0.022, r * 0.9, 0.022] });
  }
  // Hinge block.
  b.add(G.rbox(0.14, 0.6, 0.1, 0.03), { color: PAL.steelDark, pos: [u + r + 0.07, y, z + dir * 0.05] });
}

function addClock(b: PartBuilder, u: number, y: number, z: number, dir: number): void {
  b.add(G.cyl(1, 1, 24), { color: PAL.gold, pos: [u, y, z + dir * 0.03], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.05, 0.3] });
  b.add(G.cyl(1, 1, 24), { color: '#FFFBF0', pos: [u, y, z + dir * 0.05], rot: [Math.PI / 2, 0, 0], scale: [0.25, 0.02, 0.25], emissive: 0.15 });
  b.add(G.box(), { color: PAL.ink, pos: [u, y + 0.07, z + dir * 0.065], scale: [0.025, 0.15, 0.01] });
  b.add(G.box(), { color: PAL.ink, pos: [u + 0.05, y, z + dir * 0.065], rot: [0, 0, 0.6], scale: [0.11, 0.022, 0.01] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(G.box(), { color: PAL.goldDark, pos: [u + Math.cos(a) * 0.2, y + Math.sin(a) * 0.2, z + dir * 0.062], rot: [0, 0, a], scale: [0.035, 0.012, 0.01] });
  }
}

/** Teller window panel with bars. */
function addTellerWindow(b: PartBuilder, u: number, z: number, dir: number): void {
  b.add(G.rbox(1.5, 1.1, 0.05, 0.03), { color: '#3E8F80', pos: [u, 1.55, z + dir * 0.02] });
  b.add(G.box(), { color: '#BFE3F2', pos: [u, 1.6, z + dir * 0.048], scale: [1.25, 0.8, 0.01], emissive: 0.25 });
  for (let i = 0; i < 7; i++) {
    b.add(G.cyl(1, 1, 6), { color: PAL.gold, pos: [u - 0.54 + i * 0.18, 1.6, z + dir * 0.06], scale: [0.014, 0.8, 0.014] });
  }
  b.add(G.rbox(1.7, 0.08, 0.12, 0.03), { color: PAL.gold, pos: [u, 1.0, z + dir * 0.06] });
  // Little bell.
  b.add(G.dome(10, 6), { color: PAL.goldLight, pos: [u + 0.45, 1.04, z + dir * 0.07], scale: 0.045, emissive: 0.2 });
}

function buildWall(index: number, f: WallFrame): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.push([f.cx, 0, f.cz], [0, f.yaw, 0]);
  // Front/back segments stop at the inner face of the side walls (the side walls own the
  // corners), so there are no coplanar overlaps.
  let u0 = -f.len / 2;
  let u1 = f.len / 2;
  if (!f.side) {
    for (const end of [-1, 1]) {
      if (f.doorEnds.includes(end)) continue;
      if (end < 0) u0 += T;
      else u1 -= T;
    }
  }
  const L = u1 - u0;
  const uc = (u0 + u1) / 2;
  const y0 = BANK_FLOOR_Y;
  const zIn = -T / 2;
  const zOut = T / 2;
  // Plaster body.
  b.add(G.box(), { color: PAL.plaster, pos: [uc, (y0 + H) / 2, 0], scale: [L, H - y0, T] });
  // Stone base, string course, cornice.
  b.add(G.rbox(L, 0.55, T + 0.06, 0.025), { color: PAL.stone, pos: [uc, y0 + 0.275, 0] });
  b.add(G.rbox(L, 0.09, T + 0.05, 0.02), { color: PAL.plasterShade, pos: [uc, 2.72, 0] });
  b.add(G.rbox(L + (f.side ? 0 : 0.02), 0.16, T + 0.1, 0.03), { color: PAL.column, pos: [uc, H - 0.08, 0] });
  b.add(G.box(), { color: PAL.bankTrim, pos: [uc, H - 0.19, zOut + 0.005], scale: [L, 0.05, 0.03] });
  // Interior wainscot + rail.
  b.add(G.box(), { color: '#A8DCCD', pos: [uc, y0 + 0.5, zIn - 0.012], scale: [L, 1.0, 0.02] });
  b.add(G.rbox(L, 0.07, 0.06, 0.02), { color: PAL.gold, pos: [uc, y0 + 1.02, zIn - 0.02] });

  if (f.side) {
    // Corner pilasters (owned by side walls) with base + capital.
    for (const end of [-1, 1]) {
      const u = end * (f.len / 2 - T / 2);
      b.add(G.rbox(0.5, H + 0.08, 0.5, 0.05), { color: PAL.column, pos: [u, (y0 + H + 0.08) / 2, 0] });
      b.add(G.rbox(0.6, 0.3, 0.6, 0.05), { color: PAL.stone, pos: [u, y0 + 0.15, 0] });
      b.add(G.rbox(0.62, 0.18, 0.62, 0.05), { color: PAL.bankTrim, pos: [u, H + 0.04, 0] });
      // Flutes.
      for (const off of [-0.12, 0, 0.12]) {
        b.add(G.box(), { color: PAL.plasterShade, pos: [u + off, 1.7, 0.252], scale: [0.04, 2.2, 0.01] });
        b.add(G.box(), { color: PAL.plasterShade, pos: [0.252 * (end > 0 ? 1 : -1) + u, 1.7, off], scale: [0.01, 2.2, 0.04] });
      }
    }
    // Two arched windows outside.
    addWindow(b, -1.35, 0.95, 1.15, 1.05);
    addWindow(b, 1.35, 0.95, 1.15, 1.05);
  } else {
    const front = f.cz > 0;
    // Outer end of the segment (away from the door).
    const outer = f.doorEnds.includes(1) ? u0 : u1;
    const inward = f.doorEnds.includes(1) ? 1 : -1;
    if (front) {
      // Arched window near the outer end (the door leaf folds against the inner face).
      addWindow(b, outer + inward * 0.85, 0.95, 1.15, 1.05);
    } else {
      // Back facade: blind relief panel with a coin (the interior face hosts the vault/teller).
      const pu = outer + inward * 1.15;
      b.add(G.rbox(1.3, 1.5, 0.06, 0.04), { color: PAL.plasterShade, pos: [pu, 1.75, T / 2 + 0.01] });
      b.add(G.rbox(1.1, 1.3, 0.06, 0.04), { color: PAL.plaster, pos: [pu, 1.75, T / 2 + 0.025] });
      b.add(G.cyl(1, 1, 20), { color: PAL.gold, pos: [pu, 1.85, T / 2 + 0.06], rot: [Math.PI / 2, 0, 0], scale: [0.28, 0.05, 0.28], emissive: 0.1 });
      b.add(G.star(5, 0.45, 0.3), { color: PAL.goldLight, pos: [pu, 1.85, T / 2 + 0.09], scale: 0.16, emissive: 0.15 });
    }
  }

  // Door jambs + folded-open door leaves + flattened columns flanking the door.
  for (const end of f.doorEnds) {
    const ue = end > 0 ? u1 : u0;
    b.add(G.rbox(0.14, DOOR_TOP - y0 + 0.05, T + 0.1, 0.03), { color: PAL.bankTrim, pos: [ue, (y0 + DOOR_TOP) / 2, 0] });
    if (f.cz > 0) {
      // Front door leaf, folded flat against the interior face.
      const leafW = DOOR_W / 2 - 0.05;
      const lu = ue - end * (leafW / 2 + 0.08);
      b.add(G.rbox(leafW, DOOR_TOP - y0 - 0.1, 0.06, 0.025), { color: '#4FA79A', pos: [lu, (y0 + DOOR_TOP) / 2 - 0.02, zIn - 0.035] });
      b.add(G.rbox(leafW - 0.16, 0.9, 0.03, 0.015), { color: '#6CC2B4', pos: [lu, 0.75, zIn - 0.068] });
      b.add(G.cyl(1, 1, 16), { color: '#FFE3A8', pos: [lu, 1.75, zIn - 0.068], rot: [Math.PI / 2, 0, 0], scale: [0.2, 0.02, 0.2], emissive: 0.35 });
      b.add(G.torus(0.15, 6, 18), { color: PAL.gold, pos: [lu, 1.75, zIn - 0.075], scale: [0.21, 0.21, 0.12] });
      b.add(G.sphere(8, 6), { color: PAL.gold, pos: [lu - end * (leafW / 2 - 0.12), 1.15, zIn - 0.08], scale: 0.03, emissive: 0.15 });
    }
    // Flattened column on the exterior next to the jamb.
    const cu = ue - end * 0.3;
    b.add(G.cyl(1, 1, 16), { color: PAL.column, pos: [cu, (y0 + 2.6) / 2 + 0.2, zOut - 0.05], scale: [0.17, 2.3, 0.1] });
    b.add(G.rbox(0.42, 0.16, 0.22, 0.04), { color: PAL.bankTrim, pos: [cu, 2.62, zOut - 0.02] });
    b.add(G.rbox(0.42, 0.2, 0.22, 0.04), { color: PAL.stone, pos: [cu, y0 + 0.65, zOut - 0.02] });
    // Interior sconce above the door leaf.
    addSconce(b, ue - end * 0.62, 2.72, zIn - 0.02, -1);
  }

  // Interior decor, wall-mounted only (nothing on the floor).
  const dir = -1; // interior faces -z in the wall frame
  const zi = zIn - 0.005;
  // Layout per BANK_MODEL.walls index: 0/1 front (window + door leaf), 2/3 back (vault door,
  // teller window), 4/5 sides (two windows; decor between them).
  switch (index) {
    case 2: // back-left: big round vault door
      addVaultDoor(b, uc + 0.12, 1.42, zi, dir);
      break;
    case 3: // back-right: teller window + clock
      addTellerWindow(b, uc - 0.05, zi, dir);
      addClock(b, uc - 0.05, 2.58, zi, dir);
      break;
    case 4: // west side: painting + sconces
      addFrame(b, 0, 1.95, zi, dir, 1.35, 0.95, '#FFE9C9', PAL.gold);
      addSconce(b, -2.3, 2.1, zi, dir);
      addSconce(b, 2.3, 2.1, zi, dir);
      break;
    case 5: // east side: clock + two small frames
      addClock(b, 0, 2.25, zi, dir);
      addFrame(b, -2.2, 1.85, zi, dir, 0.42, 0.6, '#D8C8F0', '#FFFFFF');
      addFrame(b, 2.2, 1.85, zi, dir, 0.42, 0.6, '#C9EBDD', '#FFD45C');
      break;
    default:
      break;
  }
  b.pop();
  return b.merge('vc')!;
}

/** Lintel, keystone and striped awning over a door (frame: +z = outside). */
function buildHeader(doorIndex: number): THREE.BufferGeometry {
  const d = BANK_MODEL.doors[doorIndex];
  const yaw = d.normal.y > 0 ? 0 : Math.PI;
  const b = new PartBuilder();
  b.push([d.center.x, 0, d.center.y], [0, yaw, 0]);
  const zOut = T / 2;
  const W = DOOR_W + 0.04;
  b.add(G.box(), { color: PAL.plaster, pos: [0, (DOOR_TOP + H) / 2, 0], scale: [W, H - DOOR_TOP, T] });
  b.add(G.rbox(W + 0.14, 0.12, T + 0.1, 0.03), { color: PAL.bankTrim, pos: [0, DOOR_TOP + 0.03, 0] });
  b.add(G.rbox(W, 0.16, T + 0.1, 0.03), { color: PAL.column, pos: [0, H - 0.08, 0] });
  b.add(G.box(), { color: PAL.bankTrim, pos: [0, H - 0.19, zOut + 0.005], scale: [W, 0.05, 0.03] });
  // Keystone with a coin.
  b.add(G.rbox(0.36, 0.42, 0.1, 0.04), { color: PAL.column, pos: [0, DOOR_TOP + 0.33, zOut + 0.03] });
  b.add(G.cyl(1, 1, 18), { color: PAL.gold, pos: [0, DOOR_TOP + 0.35, zOut + 0.09], rot: [Math.PI / 2, 0, 0], scale: [0.12, 0.04, 0.12], emissive: 0.15 });
  // Striped awning (sloped, scalloped valance).
  const aw = DOOR_W + 0.6;
  const n = 7;
  const depth = 0.7;
  const tilt = 0.42;
  b.push([0, 2.98, zOut + 0.02], [tilt, 0, 0]);
  for (let i = 0; i < n; i++) {
    const u = -aw / 2 + (i + 0.5) * (aw / n);
    const col = i % 2 === 0 ? PAL.bankRoof : '#FFF6E8';
    b.add(G.rbox(aw / n + 0.005, 0.05, depth, 0.02), { color: col, pos: [u, 0, depth / 2] });
    b.add(G.cyl(1, 1, 12), { color: col, pos: [u, -0.02, depth], rot: [0, 0, Math.PI / 2], scale: [aw / n / 2, aw / n - 0.01, aw / n / 2] });
  }
  b.pop();
  // Awning brackets.
  for (const s of [-1, 1]) {
    b.add(G.cyl(1, 1, 6), { color: PAL.goldDark, pos: [s * (aw / 2 - 0.1), 2.8, zOut + 0.3], rot: [0.9, 0, 0], scale: [0.02, 0.7, 0.02] });
  }
  b.pop();
  return b.merge('vc')!;
}

// ---------------------------------------------------------------------------
// Slab, floor paint, dashed outline
// ---------------------------------------------------------------------------

function buildSlab(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const sx = (HX + RIM) * 2;
  const sz = (HZ + RIM) * 2;
  b.add(G.box(), { color: PAL.stoneDark, pos: [0, (SLAB_BOTTOM + BANK_FLOOR_Y) / 2, 0], scale: [sx, BANK_FLOOR_Y - SLAB_BOTTOM, sz] });
  // Soft bevel lip so the rim reads as a chunky toy base.
  b.add(G.rbox(sx + 0.04, 0.05, sz + 0.04, 0.02), { color: PAL.stone, pos: [0, BANK_FLOOR_Y - 0.03, 0] });
  // Threshold steps at both doors.
  for (const d of BANK_MODEL.doors) {
    b.add(G.rbox(DOOR_W + 0.3, 0.035, 0.32, 0.015), { color: PAL.column, pos: [d.center.x, BANK_FLOOR_Y + 0.008, d.center.y + d.normal.y * 0.12] });
  }
  return b.merge('vc')!;
}

function stripGeometry(cx: number, cz: number, len: number, width: number, alongX: boolean, period: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(alongX ? len : width, alongX ? width : len).rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    // Repeat along the strip's length; for z-strips swap axes so dashes run along z.
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (alongX) uv.setXY(i, u * (len / period), v);
    else uv.setXY(i, v * (len / period), u);
  }
  g.translate(cx, BANK_FLOOR_Y + 0.004, cz);
  return g;
}

// ---------------------------------------------------------------------------
// Roof + sign
// ---------------------------------------------------------------------------

function triangleShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return s;
}

function buildRoof(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const top = BANK_MODEL.roofHeight;
  // Eave slab with gold trim.
  b.add(G.rbox(HX * 2 + 0.3, 0.24, HZ * 2 + 0.3, 0.06), { color: PAL.plasterShade, pos: [0, H + 0.12, 0] });
  b.add(G.rbox(HX * 2 + 0.36, 0.06, HZ * 2 + 0.36, 0.03), { color: PAL.bankTrim, pos: [0, H + 0.03, 0] });
  // Roof surface.
  b.add(G.rbox(HX * 2 - 0.2, top - H - 0.1, HZ * 2 - 0.2, 0.06), { color: PAL.bankRoof, pos: [0, (H + top) / 2 + 0.05, 0] });
  // Parapet ring.
  const pH = 0.3;
  const py = top + pH / 2 - 0.05;
  b.add(G.rbox(HX * 2 + 0.1, pH, 0.3, 0.06), { color: PAL.bankRoofDark, pos: [0, py, HZ - 0.0] });
  b.add(G.rbox(HX * 2 + 0.1, pH, 0.3, 0.06), { color: PAL.bankRoofDark, pos: [0, py, -HZ + 0.0] });
  b.add(G.rbox(0.3, pH, HZ * 2 - 0.2, 0.06), { color: PAL.bankRoofDark, pos: [HX, py, 0] });
  b.add(G.rbox(0.3, pH, HZ * 2 - 0.2, 0.06), { color: PAL.bankRoofDark, pos: [-HX, py, 0] });
  // Gold balls on the parapet corners.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.sphere(12, 8), { color: PAL.gold, pos: [sx * HX, top + 0.2, sz * HZ], scale: 0.17, emissive: 0.1 });
  }
  // Pediments over both doors with a coin medallion.
  for (const d of BANK_MODEL.doors) {
    const zf = d.center.y + d.normal.y * 0.12;
    b.push([0, top - 0.05, zf], [0, d.normal.y > 0 ? 0 : Math.PI, 0]);
    b.add(new THREE.ExtrudeGeometry(triangleShape(4.2, 1.05), { depth: 0.3, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 }).translate(0, 0, -0.15), {
      color: PAL.plaster,
    });
    b.add(new THREE.ExtrudeGeometry(triangleShape(4.5, 1.2), { depth: 0.12, bevelEnabled: false }).translate(0, -0.06, -0.2), { color: PAL.bankTrim });
    b.add(G.cyl(1, 1, 22), { color: PAL.goldDark, pos: [0, 0.42, 0.17], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.06, 0.3] });
    b.add(G.cyl(1, 1, 22), { color: PAL.gold, pos: [0, 0.42, 0.2], rot: [Math.PI / 2, 0, 0], scale: [0.25, 0.04, 0.25], emissive: 0.12 });
    b.add(G.star(5, 0.45, 0.3), { color: PAL.goldLight, pos: [0, 0.42, 0.225], scale: 0.14, emissive: 0.2 });
    b.pop();
  }
  // Turntable base for the swivelling sign.
  b.add(G.cyl(1, 1.15, 20), { color: PAL.goldDark, pos: [0, top + 0.06, 0.2], scale: [0.42, 0.12, 0.42] });
  b.add(G.cyl(1, 1, 20), { color: PAL.gold, pos: [0, top + 0.13, 0.2], scale: [0.3, 0.04, 0.3], emissive: 0.1 });
  // Roof vents.
  for (const [x, z] of [
    [-2.6, -1.6],
    [2.7, -1.5],
  ]) {
    b.add(G.cyl(1, 1, 12), { color: PAL.steel, pos: [x, top + 0.15, z], scale: [0.22, 0.3, 0.22] });
    b.add(G.cone(12), { color: PAL.steelDark, pos: [x, top + 0.42, z], scale: [0.3, 0.2, 0.3] });
  }
  return b.merge('vc')!;
}

const SIGN_W = 3.3;
const SIGN_H = 1.45;
const SIGN_POST = 0.45;
const SIGN_TILT = -0.22; // lean back toward the high camera

function buildSignFrame(): THREE.BufferGeometry {
  const b = new PartBuilder();
  // Central post on a turntable (the sign swivels to face the camera, see update()).
  b.add(G.cyl(1, 1, 12), { color: PAL.goldDark, pos: [0, SIGN_POST / 2, 0], scale: [0.11, SIGN_POST + 0.1, 0.11] });
  b.add(G.rbox(SIGN_W * 0.7, 0.1, 0.12, 0.04), { color: PAL.goldDark, pos: [0, SIGN_POST - 0.02, 0] });
  for (const s of [-1, 1]) {
    b.add(G.cyl(1, 1, 8), { color: PAL.goldDark, pos: [s * SIGN_W * 0.3, SIGN_POST - 0.08, 0], scale: [0.045, 0.16, 0.045] });
  }
  b.add(G.rbox(SIGN_W + 0.16, SIGN_H + 0.16, 0.14, 0.07), { color: PAL.gold, pos: [0, SIGN_POST + SIGN_H / 2, 0], emissive: 0.08 });
  // Little bulbs along the top edge (marquee charm).
  for (let i = 0; i < 9; i++) {
    const x = -SIGN_W / 2 + 0.15 + (i * (SIGN_W - 0.3)) / 8;
    b.add(G.sphere(8, 6), { color: '#FFF1C2', pos: [x, SIGN_POST + SIGN_H + 0.1, 0], scale: 0.06, emissive: 1.1 });
  }
  return b.merge('vc')!;
}

function buildSignBoard(): THREE.BufferGeometry {
  const front = new THREE.PlaneGeometry(SIGN_W, SIGN_H).translate(0, SIGN_POST + SIGN_H / 2, 0.072);
  const back = new THREE.PlaneGeometry(SIGN_W, SIGN_H).rotateY(Math.PI).translate(0, SIGN_POST + SIGN_H / 2, -0.072);
  const b = new PartBuilder('board');
  b.add(front, { color: '#FFFFFF' });
  b.add(back, { color: '#FFFFFF' });
  return b.merge('board')!;
}

// ---------------------------------------------------------------------------
// Roots / pipes / cables
// ---------------------------------------------------------------------------

type RootKind = 'root' | 'pipe' | 'cable';
interface RootSpot {
  x: number;
  z: number;
  /** Outward yaw (frame +x = outward). */
  yaw: number;
  kind: RootKind;
  seed: number;
}

function rootSpots(): RootSpot[] {
  const spots: RootSpot[] = [];
  const ex = HX + RIM - 0.04;
  const ez = HZ + RIM - 0.04;
  let seed = 0;
  // yaw: frame +x -> world direction (cos yaw, 0, -sin yaw); outward (dx, dz) => atan2(-dz, dx).
  const yawOf = (dx: number, dz: number): number => Math.atan2(-dz, dx);
  // Big root flares at the four corners (two roots fanning out of each corner).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const base = yawOf(sx, sz);
      for (const off of [-0.5, 0.5]) {
        spots.push({ x: sx * (ex - 0.1), z: sz * (ez - 0.1), yaw: base + off, kind: 'root', seed: seed++ });
      }
    }
  }
  // Utilities along the sides (away from the door gaps).
  const side: [number, number, number, number, RootKind][] = [
    // x, z, outward dx, dz, kind
    [-2.5, ez, 0, 1, 'pipe'],
    [2.6, ez, 0, 1, 'cable'],
    [-2.3, -ez, 0, -1, 'cable'],
    [2.4, -ez, 0, -1, 'pipe'],
    [-ex, 0.3, -1, 0, 'root'],
    [-ex, -1.4, -1, 0, 'cable'],
    [ex, -0.4, 1, 0, 'root'],
    [ex, 1.3, 1, 0, 'pipe'],
  ];
  for (const [x, z, dx, dz, kind] of side) spots.push({ x, z, yaw: yawOf(dx, dz) + (kind === 'root' ? 0.25 : 0), kind, seed: seed++ });
  return spots;
}

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Anchored: runs from the slab side out and down into the ground. */
function addAttached(b: PartBuilder, s: RootSpot): void {
  const r = rng(101 + s.seed * 17);
  const side = (r() - 0.5) * 0.5;
  b.push([s.x, 0, s.z], [0, s.yaw, 0]);
  if (s.kind === 'root') {
    // Chunky gnarled root hugging the ground, diving into a dirt mound.
    const curve = new THREE.CatmullRomCurve3([
      v3(-0.15, 0.07, 0),
      v3(0.22, 0.11, side * 0.2),
      v3(0.55, 0.08, side * 0.7),
      v3(0.85, 0.02, side * 1.1),
      v3(1.05, -0.14, side * 1.3),
    ]);
    b.add(taperedTube(curve, (t) => 0.12 - t * 0.07, 12, 7), { color: PAL.root });
    for (const t0 of [0.28, 0.6]) {
      const p = curve.getPointAt(t0);
      b.add(G.sphere(8, 6), { color: PAL.rootDark, pos: [p.x, p.y + 0.03, p.z], scale: [0.07, 0.055, 0.07] });
    }
    const p = curve.getPointAt(0.45);
    const dir = r() < 0.5 ? -1 : 1;
    const c2 = new THREE.CatmullRomCurve3([p, v3(p.x + 0.15, 0.05, p.z + dir * 0.2), v3(p.x + 0.32, -0.06, p.z + dir * 0.34)]);
    b.add(taperedTube(c2, (t) => 0.05 - t * 0.03, 8, 6), { color: PAL.rootDark });
    // Dirt mound + clods + cracked paving chips where it dives in.
    const end = curve.getPointAt(0.93);
    b.add(G.sphere(12, 6), { color: PAL.dirt, pos: [end.x, 0.0, end.z], scale: [0.28, 0.08, 0.24] });
    for (let i = 0; i < 3; i++) {
      b.add(G.ico(0), { color: PAL.dirtDark, pos: [end.x + (r() - 0.5) * 0.4, 0.03, end.z + (r() - 0.5) * 0.4], scale: 0.05 + r() * 0.03 });
    }
    b.add(G.box(), { color: PAL.pavingLine, pos: [end.x + 0.18, 0.03, end.z - 0.12], rot: [0.25, r() * 3, 0.2], scale: [0.2, 0.04, 0.16] });
  } else if (s.kind === 'pipe') {
    const col = s.seed % 2 ? PAL.pipeCopper : PAL.pipe;
    b.add(G.cyl(1, 1, 12), { color: col, pos: [0.22, 0.12, 0], rot: [0, 0, Math.PI / 2], scale: [0.085, 0.6, 0.085] });
    b.add(G.sphere(12, 8), { color: col, pos: [0.52, 0.12, 0], scale: 0.095 });
    b.add(G.cyl(1, 1, 12), { color: col, pos: [0.52, 0.0, 0], scale: [0.085, 0.26, 0.085] });
    for (const x of [0.05, 0.38]) {
      b.add(G.cyl(1, 1, 12), { color: PAL.pipeDark, pos: [x, 0.12, 0], rot: [0, 0, Math.PI / 2], scale: [0.1, 0.05, 0.1] });
    }
    // Valve wheel.
    b.add(G.torus(0.2, 6, 14), { color: '#E8505B', pos: [0.25, 0.26, 0], rot: [Math.PI / 2, 0, 0], scale: 0.09 });
    b.add(G.cyl(1, 1, 6), { color: PAL.pipeDark, pos: [0.25, 0.2, 0], scale: [0.015, 0.12, 0.015] });
    b.add(G.sphere(10, 6), { color: PAL.dirt, pos: [0.52, -0.01, 0], scale: [0.2, 0.05, 0.2] });
  } else {
    const curve = new THREE.CatmullRomCurve3([v3(-0.1, 0.04, 0), v3(0.3, 0.2, side * 0.4), v3(0.75, 0.08, side), v3(1.1, -0.12, side * 1.2)]);
    b.add(taperedTube(curve, () => 0.035, 14, 6), { color: PAL.cable });
    for (const t of [0.2, 0.45, 0.7]) {
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), tan);
      const e = new THREE.Euler().setFromQuaternion(q);
      b.add(G.torus(0.25, 5, 12), { color: PAL.cableStripe, pos: [p.x, p.y, p.z], rot: [e.x, e.y, e.z], scale: [0.04, 0.04, 0.06] });
    }
    // Connector box at the slab.
    b.add(G.rbox(0.16, 0.12, 0.14, 0.03), { color: PAL.cableStripe, pos: [0.0, 0.05, 0] });
  }
  b.pop();
}

/** Uprooted: short snapped stubs dragging on the ground (sway ramps toward the tip). */
function snappedPart(s: RootSpot): THREE.BufferGeometry {
  const r = rng(303 + s.seed * 13);
  const b = new PartBuilder();
  const side = (r() - 0.5) * 0.3;
  if (s.kind === 'root') {
    const curve = new THREE.CatmullRomCurve3([v3(-0.15, 0.06, 0), v3(0.18, 0.09, side), v3(0.45, 0.06, side * 1.6)]);
    b.add(taperedTube(curve, (t) => 0.12 - t * 0.04, 8, 8), { color: PAL.root });
    const tip = curve.getPointAt(1);
    b.add(G.cyl(1, 1, 8), { color: PAL.woodLight, pos: [tip.x + 0.005, tip.y, tip.z], rot: [0, 0, Math.PI / 2], scale: [0.075, 0.02, 0.075] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r();
      b.add(G.cone(5), {
        color: PAL.woodLight,
        pos: [tip.x + 0.04, tip.y + Math.sin(a) * 0.03, tip.z + Math.cos(a) * 0.03],
        rot: [a, 0, -Math.PI / 2],
        scale: [0.018, 0.08 + r() * 0.05, 0.018],
      });
    }
  } else if (s.kind === 'pipe') {
    const col = s.seed % 2 ? PAL.pipeCopper : PAL.pipe;
    b.add(G.cyl(1, 1, 12), { color: col, pos: [0.12, 0.12, 0], rot: [0, 0, Math.PI / 2], scale: [0.075, 0.38, 0.075] });
    b.add(G.cyl(1, 1, 12), { color: PAL.pipeDark, pos: [0.05, 0.12, 0], rot: [0, 0, Math.PI / 2], scale: [0.1, 0.05, 0.1] });
    // Jagged torn end.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(G.cone(4), {
        color: col,
        pos: [0.33, 0.12 + Math.sin(a) * 0.06, Math.cos(a) * 0.06],
        rot: [a, 0, -Math.PI / 2],
        scale: [0.025, 0.06 + (i % 2) * 0.05, 0.025],
      });
    }
    // Drip.
    b.add(G.sphere(8, 6), { color: PAL.water, pos: [0.36, 0.03, 0], scale: [0.04, 0.03, 0.04], emissive: 0.3 });
  } else {
    const curve = new THREE.CatmullRomCurve3([v3(-0.1, 0.04, 0), v3(0.2, 0.14, side), v3(0.45, 0.06, side * 2)]);
    b.add(taperedTube(curve, () => 0.035, 10, 6), { color: PAL.cable });
    const tip = curve.getPointAt(1);
    for (let i = 0; i < 3; i++) {
      const a = -0.5 + i * 0.5;
      b.add(G.cyl(1, 1, 4), { color: PAL.pipeCopper, pos: [tip.x + 0.05, tip.y + a * 0.05, tip.z + a * 0.04], rot: [a, 0, Math.PI / 2 + a * 0.6], scale: [0.008, 0.1, 0.008] });
    }
    b.add(G.rbox(0.16, 0.12, 0.14, 0.03), { color: PAL.cableStripe, pos: [0.0, 0.05, 0] });
  }
  const g = b.merge('vc')!;
  rampSway(g, 'x', 0.05, 0.5, 2.2);
  return g;
}

function buildRoots(snapped: boolean): THREE.BufferGeometry {
  const b = new PartBuilder();
  for (const s of rootSpots()) {
    if (snapped) b.addPrepared(snappedPart(s), { pos: [s.x, 0, s.z], rot: [0, s.yaw, 0] });
    else addAttached(b, s);
  }
  if (snapped) {
    // Dirt clinging to the slab edges.
    const r = rng(77);
    const per = (len: number) => Math.round(len * 2.2);
    const edges: [number, number, number, number, number][] = [
      // x0, z0, x1, z1, outward yaw
      [-HX, HZ + RIM, HX, HZ + RIM, -Math.PI / 2],
      [-HX, -HZ - RIM, HX, -HZ - RIM, Math.PI / 2],
      [-HX - RIM, -HZ, -HX - RIM, HZ, Math.PI],
      [HX + RIM, -HZ, HX + RIM, HZ, 0],
    ];
    for (const [x0, z0, x1, z1] of edges) {
      const n = per(Math.hypot(x1 - x0, z1 - z0));
      for (let i = 0; i < n; i++) {
        const t = (i + r()) / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        const sz = 0.07 + r() * 0.09;
        b.add(G.ico(0), { color: r() < 0.5 ? PAL.dirt : PAL.dirtDark, pos: [x, 0.02 + r() * 0.04, z], rot: [r() * 3, r() * 3, r() * 3], scale: [sz * 1.3, sz * 0.7, sz] });
      }
    }
  }
  return b.merge('vc')!;
}

/** Spark stars at cable ends (toggled for flicker). */
function buildSparks(): THREE.BufferGeometry {
  const b = new PartBuilder();
  for (const s of rootSpots()) {
    if (s.kind !== 'cable') continue;
    b.push([s.x, 0, s.z], [0, s.yaw, 0]);
    b.add(G.star(4, 0.3, 0.2), { color: PAL.spark, pos: [0.58, 0.12, 0.0], rot: [0, 0.6, 0.3], scale: 0.12, emissive: 1.5 });
    b.add(G.star(4, 0.3, 0.2), { color: '#FFFFFF', pos: [0.62, 0.2, 0.08], rot: [0.4, -0.5, 0], scale: 0.07, emissive: 1.5 });
    b.pop();
  }
  return b.merge('vc')!;
}

// ---------------------------------------------------------------------------
// Shared geometry cache
// ---------------------------------------------------------------------------

interface BankGeo {
  slab: THREE.BufferGeometry;
  floor: THREE.BufferGeometry;
  dashes: THREE.BufferGeometry;
  walls: THREE.BufferGeometry[];
  headers: THREE.BufferGeometry[];
  roof: THREE.BufferGeometry;
  signFrame: THREE.BufferGeometry;
  signBoard: THREE.BufferGeometry;
  rootsAttached: THREE.BufferGeometry;
  rootsSnapped: THREE.BufferGeometry;
  sparks: THREE.BufferGeometry;
}
let bankGeo: BankGeo | null = null;

function getBankGeo(): BankGeo {
  if (bankGeo) return bankGeo;
  const frames = wallFrames();
  const period = 0.55;
  const ox = HX + RIM / 2;
  const oz = HZ + RIM / 2;
  const sx = (HX + RIM) * 2;
  const sz = (HZ + RIM) * 2;
  const dashParts = [
    stripGeometry(0, oz, sx, RIM, true, period),
    stripGeometry(0, -oz, sx, RIM, true, period),
    stripGeometry(ox, 0, sz - RIM * 2, RIM, false, period),
    stripGeometry(-ox, 0, sz - RIM * 2, RIM, false, period),
  ];
  const db = new PartBuilder('dash');
  for (const g of dashParts) db.add(g, { color: '#FFFFFF' });
  bankGeo = {
    slab: buildSlab(),
    floor: new THREE.PlaneGeometry(HX * 2, HZ * 2).rotateX(-Math.PI / 2).translate(0, BANK_FLOOR_Y + 0.002, 0),
    dashes: db.merge('dash')!,
    walls: frames.map((f, i) => buildWall(i, f)),
    headers: [buildHeader(0), buildHeader(1)],
    roof: buildRoof(),
    signFrame: buildSignFrame(),
    signBoard: buildSignBoard(),
    rootsAttached: buildRoots(false),
    rootsSnapped: buildRoots(true),
    sparks: buildSparks(),
  };
  return bankGeo;
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

export function createBank(): BankRig {
  const geo = getBankGeo();
  const root = new THREE.Group();
  root.name = 'bank';
  const body = new THREE.Group();
  root.add(body);

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string, parent: THREE.Object3D, shadow = true): THREE.Mesh => {
    const me = new THREE.Mesh(g, m);
    me.name = `bank:${name}`;
    me.castShadow = shadow;
    me.receiveShadow = true;
    parent.add(me);
    return me;
  };

  mesh(geo.slab, matVC(), 'slab', body);
  const floor = mesh(
    geo.floor,
    createToonMaterial({ map: bankFloorTexture(), rim: 0, polygonOffset: -1 }),
    'floor',
    body,
    false,
  );
  floor.userData.noOutline = true;
  const dashes = mesh(geo.dashes, createToonMaterial({ map: dashedLineTexture(), alphaTest: 0.4, rim: 0, polygonOffset: -2, emissive: '#3A2E10', emissiveIntensity: 1 }), 'dashes', body, false);
  dashes.userData.noOutline = true;

  const wallMats = geo.walls.map(() => createToonMaterial({ vertexColors: true, fx: true }));
  const walls = geo.walls.map((g, i) => {
    const grp = new THREE.Group();
    grp.name = `bank:wall${i}`;
    mesh(g, wallMats[i], `wall${i}`, grp);
    body.add(grp);
    return grp;
  });
  const headerMats = geo.headers.map(() => createToonMaterial({ vertexColors: true, fx: true }));
  const headers = geo.headers.map((g, i) => mesh(g, headerMats[i], `header${i}`, body));

  const roof = new THREE.Group();
  roof.name = 'bank:roof';
  body.add(roof);
  const roofMat = createToonMaterial({ vertexColors: true, fx: true });
  mesh(geo.roof, roofMat, 'roofBody', roof);
  // Sign chain: pivot (position) -> yaw (swivels to face the fixed camera) -> wobble
  // (spring) -> tilt (leans back toward the high camera).
  const signPivot = new THREE.Group();
  signPivot.position.set(0, BANK_MODEL.roofHeight + 0.12, 0.2);
  roof.add(signPivot);
  const signYaw = new THREE.Group();
  signPivot.add(signYaw);
  const signWobble = new THREE.Group();
  signYaw.add(signWobble);
  const signTilt = new THREE.Group();
  signTilt.rotation.x = SIGN_TILT;
  signWobble.add(signTilt);
  const signFrameMat = createToonMaterial({ vertexColors: true, fx: true });
  mesh(geo.signFrame, signFrameMat, 'signFrame', signTilt);
  const signBoardMat = createToonMaterial({ map: bankSignTexture(), rim: 0.15, emissive: '#FFFFFF', emissiveIntensity: 0.0 });
  // Mild self-illumination so the sign stays readable at dusk.
  signBoardMat.emissiveMap = bankSignTexture();
  signBoardMat.emissive.set('#FFFFFF');
  signBoardMat.emissiveIntensity = 0.28;
  const board = mesh(geo.signBoard, signBoardMat, 'signBoard', signTilt);
  board.userData.noOutline = true;

  const rootsAttached = mesh(geo.rootsAttached, matVC(), 'rootsAttached', body);
  rootsAttached.userData.noOutline = true;
  const rootsSnapped = mesh(geo.rootsSnapped, matVC(), 'rootsSnapped', body);
  rootsSnapped.userData.noOutline = true;
  rootsSnapped.visible = false;
  const sparks = mesh(geo.sparks, matVC(), 'sparks', body, false);
  sparks.userData.noOutline = true;
  sparks.visible = false;

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.y = BANK_LABEL_HEIGHT;
  root.add(labelAnchor);

  const highlighter = new Highlighter(body);

  // --- state -----------------------------------------------------------------------
  const wallAlpha = [1, 1, 1, 1, 1, 1];
  let roofAlpha = 1;
  let uprooted = false;
  let strain = 0;
  let time = 0;
  let pop = 0;
  const POP_TIME = 0.6;
  // Sign spring (pitch about x, roll about z).
  const sp = { ax: 0, az: 0, vx: 0, vz: 0 };
  const prevPos = new THREE.Vector3();
  const prevVel = new THREE.Vector3();
  const curPos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  let signYawAngle = 0;
  let signYawInit = false;
  let hasPrev = false;
  let sparkTimer = 0;

  const applyHeaderAlpha = (): void => {
    const a0 = Math.min(wallAlpha[0], wallAlpha[1]);
    const a1 = Math.min(wallAlpha[2], wallAlpha[3]);
    setMaterialOpacity(headerMats[0], a0);
    setMaterialOpacity(headerMats[1], a1);
    headers[0].visible = a0 > 0.01;
    headers[1].visible = a1 > 0.01;
    highlighter.setMeshEnabled(headers[0], a0 > 0.6);
    highlighter.setMeshEnabled(headers[1], a1 > 0.6);
  };

  const update = (dt: number): void => {
    dt = Math.min(Math.max(dt, 0), 0.1);
    time += dt;
    // Inertia from the root's world motion (dragging, turning, bumps).
    root.updateWorldMatrix(true, false);
    curPos.setFromMatrixPosition(root.matrixWorld);
    if (!hasPrev || dt <= 0) {
      prevPos.copy(curPos);
      prevVel.set(0, 0, 0);
      hasPrev = true;
    }
    if (dt > 0) {
      vel.copy(curPos).sub(prevPos).divideScalar(dt);
      acc.copy(vel).sub(prevVel).divideScalar(dt);
      // Teleports (spawn, ejections) should not explode the spring.
      if (acc.lengthSq() > 400) acc.set(0, 0, 0);
      prevPos.copy(curPos);
      prevVel.copy(vel);
    }
    // Swivel the sign so it keeps facing world +Z (the camera side; the game camera never
    // rotates), lagging a little behind the bank's turns like a weather vane.
    root.getWorldQuaternion(q);
    eul.setFromQuaternion(q, 'YXZ');
    const target = -eul.y;
    if (!signYawInit) {
      signYawAngle = target;
      signYawInit = true;
    }
    let dYaw = target - signYawAngle;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    signYawAngle += dYaw * (1 - Math.exp(-dt * 5));
    signYaw.rotation.y = signYawAngle;
    sp.vz += dYaw * 2.5 * dt * 10;
    const k = 70;
    const c = 2.6;
    const gain = 0.06;
    const jitter = strain * 6 * (Math.sin(time * 37) + Math.sin(time * 23.7));
    sp.vx += (-k * sp.ax - c * sp.vx - acc.z * gain * 10 + jitter * 0.6) * dt;
    sp.vz += (-k * sp.az - c * sp.vz + acc.x * gain * 10 + jitter * 0.4) * dt;
    sp.ax = THREE.MathUtils.clamp(sp.ax + sp.vx * dt, -0.6, 0.6);
    sp.az = THREE.MathUtils.clamp(sp.az + sp.vz * dt, -0.5, 0.5);
    signWobble.rotation.set(sp.ax, 0, sp.az);

    // Strain tremble + pop.
    const tr = uprooted ? 0 : strain;
    let y = 0;
    let sq = 1;
    if (pop > 0) {
      pop = Math.max(0, pop - dt);
      const kk = 1 - pop / POP_TIME;
      y = Math.sin(kk * Math.PI) * 0.16;
      sq = 1 + Math.sin(kk * Math.PI * 2) * 0.03 * (1 - kk);
    }
    body.position.set(Math.sin(time * 43) * 0.03 * tr, y + Math.abs(Math.sin(time * 29)) * 0.02 * tr, Math.sin(time * 37 + 0.7) * 0.03 * tr);
    body.rotation.z = Math.sin(time * 11) * 0.006 * tr;
    body.rotation.x = Math.sin(time * 9.3) * 0.005 * tr;
    body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    // Taut roots vibrate.
    rootsAttached.scale.set(1 + tr * 0.06 * (0.5 + 0.5 * Math.sin(time * 55)), 1 - tr * 0.08, 1);
    // Sparks flicker for a while after uprooting, then occasionally.
    if (uprooted) {
      sparkTimer += dt;
      const rate = sparkTimer < 4 ? 0.55 : 0.12;
      sparks.visible = Math.sin(time * 31) + Math.sin(time * 17.3) > 2 - rate * 4;
    }
  };

  return {
    root,
    roof,
    walls,
    labelAnchor,
    setRoofOpacity(a: number) {
      roofAlpha = THREE.MathUtils.clamp(a, 0, 1);
      for (const m of [roofMat, signFrameMat, signBoardMat]) setMaterialOpacity(m, roofAlpha);
      roof.visible = roofAlpha > 0.01;
      roof.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.userData.isOutlineHull) highlighter.setMeshEnabled(o, roofAlpha > 0.6);
      });
    },
    setWallOpacity(index: number, a: number) {
      if (index < 0 || index >= walls.length) return;
      wallAlpha[index] = THREE.MathUtils.clamp(a, 0, 1);
      setMaterialOpacity(wallMats[index], wallAlpha[index]);
      walls[index].visible = wallAlpha[index] > 0.01;
      const m = walls[index].children[0];
      if (m) highlighter.setMeshEnabled(m, wallAlpha[index] > 0.6);
      applyHeaderAlpha();
    },
    setUprooted(b: boolean) {
      if (b && !uprooted) {
        pop = POP_TIME;
        sp.vx += 3.5;
        sp.vz += (Math.random() - 0.5) * 3;
        sparkTimer = 0;
      }
      uprooted = b;
      rootsAttached.visible = !b;
      rootsSnapped.visible = b;
      sparks.visible = b;
    },
    setStrain(s: number) {
      strain = THREE.MathUtils.clamp(s, 0, 1);
    },
    wobbleSign(amount: number) {
      sp.vx += amount * (0.6 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1);
      sp.vz += amount * (Math.random() - 0.5) * 1.2;
    },
    setHighlight(color) {
      highlighter.set(color);
    },
    update,
    dispose() {
      highlighter.dispose();
      for (const m of [...wallMats, ...headerMats, roofMat, signFrameMat, signBoardMat]) m.dispose();
      (floor.material as THREE.Material).dispose();
      (dashes.material as THREE.Material).dispose();
      root.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------
// Uproot scar (left in the world where the bank stood)
// ---------------------------------------------------------------------------

let scarGeo: { soil: THREE.BufferGeometry; water: THREE.BufferGeometry } | null = null;

function getScarGeo(): { soil: THREE.BufferGeometry; water: THREE.BufferGeometry } {
  if (scarGeo) return scarGeo;
  const b = new PartBuilder();
  const r = rng(4242);
  const sx = (HX + RIM) * 2;
  const sz = (HZ + RIM) * 2;
  b.add(G.box(), { color: PAL.dirtDark, pos: [0, 0.006, 0], scale: [sx - 0.1, 0.012, sz - 0.1] });
  b.add(G.box(), { color: PAL.dirt, pos: [0, 0.01, 0], scale: [sx - 0.6, 0.012, sz - 0.6] });
  // Lighter churned patches + a raised dirt lip along the border.
  for (let i = 0; i < 9; i++) {
    b.add(G.disc(12), { color: '#A47E5C', pos: [(r() - 0.5) * (sx - 1.6), 0.018, (r() - 0.5) * (sz - 1.6)], rot: [0, r() * 3, 0], scale: [0.4 + r() * 0.7, 1, 0.3 + r() * 0.5] });
  }
  const lip = (n: number, fx: (t: number) => [number, number]): void => {
    for (let i = 0; i < n; i++) {
      const [x, z] = fx((i + r()) / n);
      const s = 0.18 + r() * 0.12;
      b.add(G.ico(1), { color: r() < 0.5 ? PAL.dirt : '#7A5A3E', pos: [x, 0.02, z], rot: [r(), r() * 3, r()], scale: [s * 1.6, s * 0.45, s] });
    }
  };
  lip(18, (t) => [-sx / 2 + 0.25 + t * (sx - 0.5), sz / 2 - 0.25]);
  lip(18, (t) => [-sx / 2 + 0.25 + t * (sx - 0.5), -sz / 2 + 0.25]);
  lip(13, (t) => [sx / 2 - 0.25, -sz / 2 + 0.25 + t * (sz - 0.5)]);
  lip(13, (t) => [-sx / 2 + 0.25, -sz / 2 + 0.25 + t * (sz - 0.5)]);
  // Worms! (tiny pink squiggles, cute detail)
  for (let i = 0; i < 3; i++) {
    const x = (r() - 0.5) * (sx - 2);
    const z = (r() - 0.5) * (sz - 2);
    const curve = new THREE.CatmullRomCurve3([v3(x, 0.03, z), v3(x + 0.1, 0.05, z + 0.08), v3(x + 0.2, 0.03, z), v3(x + 0.28, 0.04, z + 0.07)]);
    b.add(taperedTube(curve, () => 0.022, 10, 5), { color: '#F2A0AE' });
  }
  // Broken paving chunks around the rim.
  const ring = (n: number, fx: (t: number) => [number, number]): void => {
    for (let i = 0; i < n; i++) {
      const [x, z] = fx((i + r()) / n);
      b.add(G.rbox(0.36, 0.08, 0.3, 0.03), { color: r() < 0.5 ? PAL.paving : PAL.pavingLine, pos: [x, 0.03, z], rot: [(r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5] });
    }
  };
  ring(14, (t) => [-sx / 2 + t * sx, sz / 2 + 0.05]);
  ring(14, (t) => [-sx / 2 + t * sx, -sz / 2 - 0.05]);
  ring(10, (t) => [sx / 2 + 0.05, -sz / 2 + t * sz]);
  ring(10, (t) => [-sx / 2 - 0.05, -sz / 2 + t * sz]);
  // Dirt clods inside.
  for (let i = 0; i < 26; i++) {
    const s = 0.08 + r() * 0.14;
    b.add(G.ico(1), { color: r() < 0.5 ? PAL.dirt : PAL.dirtDark, pos: [(r() - 0.5) * (sx - 1), 0.03, (r() - 0.5) * (sz - 1)], rot: [r() * 3, r() * 3, 0], scale: [s * 1.3, s * 0.6, s] });
  }
  // Snapped ends poking out of the soil where the roots were.
  for (const s of rootSpots()) {
    b.push([s.x * 0.93, 0, s.z * 0.93], [0, s.yaw + Math.PI, 0]);
    if (s.kind === 'root') {
      const curve = new THREE.CatmullRomCurve3([v3(-0.6, -0.1, 0), v3(-0.3, 0.06, 0), v3(-0.05, 0.16, 0.03)]);
      b.add(taperedTube(curve, (t) => 0.06 - t * 0.02, 8, 6), { color: PAL.root });
      b.add(G.cyl(1, 1, 8), { color: PAL.woodLight, pos: [-0.04, 0.17, 0.03], rot: [0, 0, -0.6], scale: [0.04, 0.02, 0.04] });
    } else if (s.kind === 'pipe') {
      const col = s.seed % 2 ? PAL.pipeCopper : PAL.pipe;
      b.add(G.cyl(1, 1, 12), { color: col, pos: [-0.3, 0.14, 0], scale: [0.075, 0.3, 0.075] });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.add(G.cone(4), { color: col, pos: [-0.3 + Math.cos(a) * 0.055, 0.32, Math.sin(a) * 0.055], scale: [0.02, 0.07 + (i % 2) * 0.04, 0.02] });
      }
    } else {
      const curve = new THREE.CatmullRomCurve3([v3(-0.5, -0.1, 0), v3(-0.3, 0.12, 0.05), v3(-0.1, 0.2, 0.12)]);
      b.add(taperedTube(curve, () => 0.03, 8, 6), { color: PAL.cable });
      b.add(G.star(4, 0.3, 0.2), { color: PAL.spark, pos: [-0.06, 0.26, 0.14], scale: 0.09, emissive: 1.4 });
    }
    b.pop();
  }
  const soil = b.merge('vc')!;
  // A puddle from the burst pipes.
  const wb = new PartBuilder('water');
  wb.add(G.disc(24), { color: PAL.water, pos: [1.6, 0.025, -1.4], scale: [1.1, 1, 0.75] });
  wb.add(G.disc(20), { color: PAL.water, pos: [-2.2, 0.025, 1.6], scale: [0.6, 1, 0.45] });
  const water = wb.merge('water')!;
  scarGeo = { soil, water };
  return scarGeo;
}

/** The torn-up patch left behind after a bank is uprooted (place at the bank's start pose). */
export function createBankScar(): THREE.Group {
  const g = getScarGeo();
  const grp = new THREE.Group();
  grp.name = 'bankScar';
  const soil = new THREE.Mesh(g.soil, matVC());
  soil.receiveShadow = true;
  soil.castShadow = true;
  grp.add(soil);
  const water = new THREE.Mesh(g.water, matWater());
  water.receiveShadow = true;
  grp.add(water);
  return grp;
}

export function disposeBankCache(): void {
  if (bankGeo) {
    const all = [bankGeo.slab, bankGeo.floor, bankGeo.dashes, ...bankGeo.walls, ...bankGeo.headers, bankGeo.roof, bankGeo.signFrame, bankGeo.signBoard, bankGeo.rootsAttached, bankGeo.rootsSnapped, bankGeo.sparks];
    all.forEach((g) => g.dispose());
    bankGeo = null;
  }
  if (scarGeo) {
    scarGeo.soil.dispose();
    scarGeo.water.dispose();
    scarGeo = null;
  }
}

/** Debug: the wall frame of a BANK_MODEL wall (used by tests/gallery). */
export function bankWallFrames(): ReadonlyArray<{ center: V3; len: number; yaw: number }> {
  return wallFrames().map((f) => ({ center: [f.cx, 0, f.cz] as V3, len: f.len, yaw: f.yaw }));
}
