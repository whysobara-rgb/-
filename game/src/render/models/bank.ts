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
 *    └ body (uproot pop, strain tremble, lift)
 *       ├ slab        foundation (top at BANK_FLOOR_Y) + carpet floor + dashed outline
 *       ├ walls[0..5] one Object3D per BANK_MODEL.walls entry, same order (individual fade);
 *       │             exterior facade + fully dressed interior (bankInterior.ts)
 *       ├ headers     door lintels + awnings (fade with the min of their two walls)
 *       ├ art         cat-banker portraits + wanted posters (one textured draw call)
 *       ├ lasers      alarm security lasers (additive, flashing while the alarm rings)
 *       ├ roof        glass pyramid skylight + slim frame + pendant lamps (fades when the player is
 *       │             inside); the '은행 BANK' sign rides a boom on the far side from the
 *       │             camera, with the alarm beacon and two bells on top
 *       ├ rootsAttached  cartoon roots / pipes / cables running into the ground (anchored)
 *       └ rootsSnapped   snapped stubs + clinging dirt + sparks (uprooted)
 *
 * Dollhouse cutaway (투시도): every bank material shares one cut plane (object space) that
 * slices off the camera side of the building above ~0.9 m, sloping up toward the back, so the
 * interior always reads from the game camera; cut solids show a flat cap with a light lip,
 * shadows and outlines follow the cut. Colliders are untouched (pure rendering).
 *
 * The title means "uprooted": while anchored the bank is visibly plumbed into the ground;
 * setUprooted(true) snaps everything (pop + big sign wobble). createBankScar() builds the
 * torn-up patch the view can leave where the bank stood.
 */
import * as THREE from 'three';
import { BANK_MODEL } from '../../sim/config';
import { PAL } from './palette';
import { G, PartBuilder, rampSway, taperedTube, rng, type V3 } from './geometry';
import { createCutDepthMaterial, createCutPlane, createToonMaterial, matVC, matWater, setMaterialOpacity, SHARED_UNIFORMS, type CutPlaneUniform } from './materials';
import { bankSignTexture, dashedLineTexture, radialGlowTexture } from './textures';
import { bankCarpetTexture, catPortraitTexture, wantedPosterTexture } from './art';
import { Highlighter } from './outline';
import { cameraFacingYaw, trackViewCamera } from './occlusion';
import {
  BANK_INTERIOR_COLORS,
  addCctv,
  addPendantLamp,
  addClock,
  addDepositBoxes,
  addHangingPlanter,
  addNiche,
  addPortraitFrame,
  addPosterBacking,
  addSconce as addInteriorSconce,
  addTellerStation,
  addVaultDoor,
} from './bankInterior';

/** Height of the bank floor surface (slab top). Raise characters/safes on the floor by this. */
export const BANK_FLOOR_Y = 0.06;
/** Height for the floating value label above the bank. */
export const BANK_LABEL_HEIGHT = 6.0;
/** Cutaway: height of the cut at the camera-side face, and how fast it rises toward the back. */
export const BANK_CUT_HEIGHT = 0.9;
const CUT_SLOPE = 1.0;
/** Uproot pop timing (seconds): total hop and the moment it slams back down. */
export const BANK_POP = { time: 0.95, land: 0.6, height: 0.95 } as const;

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
  /** Cutaway plane shared by every bank material (object space of the body). */
  readonly cutPlane: CutPlaneUniform;
  /** Roof group (hide or fade when the player is inside). */
  readonly roof: THREE.Object3D;
  /** One object per BANK_MODEL.walls entry, same order. */
  readonly walls: readonly THREE.Object3D[];
  readonly labelAnchor: THREE.Object3D;
  /**
   * Current visual floor height in bank-local space: BANK_FLOOR_Y plus the short uproot hop
   * and strain tremble. Use it to place characters/safes riding the floor.
   */
  readonly floorY: number;
  setRoofOpacity(a: number): void;
  setWallOpacity(index: number, a: number): void;
  setUprooted(uprooted: boolean): void;
  /** 0..1 unanchor pull intensity (tremble, taut roots, sign rattle). */
  setStrain(s: number): void;
  /** Kick the sign (e.g. on bumps, fence breaks, unanchor). */
  wobbleSign(amount: number): void;
  /** Alarm (state.alarm.ringing): roof beacon spins, bells clang, lasers flash, red light pool. */
  setAlarm(on: boolean): void;
  /** Dollhouse cutaway on/off (default on). */
  setCutaway(on: boolean): void;
  /** 0..1 how open wall `index` is (cut low on the camera side): the view skips fading it. */
  wallOpen(index: number): number;
  /** Extra visual lift of the building (uproot strain), meters. */
  setLift(y: number): void;
  /** Ring the alarm bells once (strain spikes, the pop). */
  clangBell(amount: number): void;
  /** Seconds since the uproot pop started (Infinity before / long after). */
  readonly popAge: number;
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
  b.add(G.sphere(12, 8), { color: '#FFE6A8', pos: [u, y + 0.14, z + dir * 0.15], scale: [0.08, 0.1, 0.08], emissive: 1.6 });
}

/** Where the portrait canvases and wanted posters go (wall index, u, y, which face). */
const ART_SPOTS: { wall: number; u: number; y: number; w: number; h: number; kind: 'portrait' | 'poster'; inside: boolean }[] = [
  { wall: 4, u: 0, y: 1.95, w: 1.3, h: 1.0, kind: 'portrait', inside: true },
  { wall: 5, u: 0, y: 1.55, w: 0.5, h: 0.62, kind: 'poster', inside: false },
  { wall: 4, u: 0.15, y: 1.5, w: 0.5, h: 0.62, kind: 'poster', inside: false },
];

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

  // Interior decor, wall-mounted only (nothing on the floor). Every wall is dressed: the
  // banks rotate in play, so any of them can become the dollhouse's back wall.
  const dir = -1; // interior faces -z in the wall frame
  const zi = zIn - 0.005;
  switch (index) {
    case 0:
    case 1: {
      // Door walls (front): hanging planter + CCTV in the outer corner.
      const outer = f.doorEnds.includes(1) ? u0 : u1;
      const inward = f.doorEnds.includes(1) ? 1 : -1;
      addHangingPlanter(b, outer + inward * 0.24, 1.9, zi, index * 1.7);
      addCctv(b, outer + inward * 0.18, 2.86, zi, inward * 0.5);
      break;
    }
    case 2: {
      // Back-left: the big round vault door with the clock above it.
      addVaultDoor(b, uc + 0.12, 1.62, zi);
      addClock(b, uc + 0.12, 2.76, zi);
      const outer = f.doorEnds.includes(1) ? u0 : u1;
      const inward = f.doorEnds.includes(1) ? 1 : -1;
      addCctv(b, outer + inward * 0.18, 2.86, zi, inward * 0.5);
      break;
    }
    case 3: {
      // Back-right: teller station (counter ledge + service bell above head height).
      addTellerStation(b, uc - 0.05, zi);
      const outer = f.doorEnds.includes(1) ? u0 : u1;
      const inward = f.doorEnds.includes(1) ? 1 : -1;
      addHangingPlanter(b, outer + inward * 0.22, 2.0, zi, 4.2);
      break;
    }
    case 4: {
      // West side: cat-banker portrait (canvas quad in the art mesh), gold + bag niches.
      addPortraitFrame(b, 0, 1.95, zi, 1.3, 1.0);
      addNiche(b, -2.18, 1.78, zi, 0.5, 'gold');
      addNiche(b, 2.18, 1.78, zi, 0.5, 'bags');
      addInteriorSconce(b, -2.18, 2.5, zi);
      addInteriorSconce(b, 2.18, 2.5, zi);
      break;
    }
    case 5: {
      // East side: safety-deposit wall between the windows, coin + gold niches.
      addDepositBoxes(b, 0, 1.86, zi);
      addNiche(b, -2.18, 1.78, zi, 0.5, 'coins');
      addNiche(b, 2.18, 1.78, zi, 0.5, 'gold');
      addInteriorSconce(b, -2.18, 2.5, zi);
      addInteriorSconce(b, 2.18, 2.5, zi);
      addCctv(b, 0, 2.86, zi, 0);
      break;
    }
    default:
      break;
  }
  // Exterior: wanted-poster backings (the posters themselves are in the art mesh).
  for (const a of ART_SPOTS) if (a.wall === index && !a.inside) addPosterBacking(b, a.u, a.y, zOut + 0.005, 1);
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
// Roof (glass pyramid skylight) + sign boom + alarm
// ---------------------------------------------------------------------------

function triangleShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return s;
}

/** Skylight pyramid: base rectangle (inset) and apex height. */
const SKY = { hx: HX - 0.42, hz: HZ - 0.42, base: H + 0.26, apex: H + 1.05 } as const;

function buildRoof(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const top = BANK_MODEL.roofHeight;
  // Eave frame: a ring of four strips (the middle is the glass skylight).
  const ew = 0.5;
  const eh = 0.24;
  const ey = H + 0.12;
  b.add(G.rbox(HX * 2 + 0.3, eh, ew, 0.05), { color: PAL.plasterShade, pos: [0, ey, HZ + 0.15 - ew / 2] });
  b.add(G.rbox(HX * 2 + 0.3, eh, ew, 0.05), { color: PAL.plasterShade, pos: [0, ey, -HZ - 0.15 + ew / 2] });
  b.add(G.rbox(ew, eh, HZ * 2 + 0.3 - 2 * ew + 0.02, 0.05), { color: PAL.plasterShade, pos: [HX + 0.15 - ew / 2, ey, 0] });
  b.add(G.rbox(ew, eh, HZ * 2 + 0.3 - 2 * ew + 0.02, 0.05), { color: PAL.plasterShade, pos: [-HX - 0.15 + ew / 2, ey, 0] });
  // Gold trim under the eave.
  for (const sz of [-1, 1]) b.add(G.box(), { color: PAL.bankTrim, pos: [0, H + 0.03, sz * (HZ + 0.17)], scale: [HX * 2 + 0.36, 0.06, 0.04], emissive: 0.05 });
  for (const sx of [-1, 1]) b.add(G.box(), { color: PAL.bankTrim, pos: [sx * (HX + 0.17), H + 0.03, 0], scale: [0.04, 0.06, HZ * 2 + 0.36], emissive: 0.05 });
  // Parapet ring.
  const pH = 0.3;
  const py = top + pH / 2 - 0.12;
  b.add(G.rbox(HX * 2 + 0.1, pH, 0.3, 0.06), { color: PAL.bankRoofDark, pos: [0, py, HZ] });
  b.add(G.rbox(HX * 2 + 0.1, pH, 0.3, 0.06), { color: PAL.bankRoofDark, pos: [0, py, -HZ] });
  b.add(G.rbox(0.3, pH, HZ * 2 - 0.2, 0.06), { color: PAL.bankRoofDark, pos: [HX, py, 0] });
  b.add(G.rbox(0.3, pH, HZ * 2 - 0.2, 0.06), { color: PAL.bankRoofDark, pos: [-HX, py, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.sphere(12, 8), { color: PAL.gold, pos: [sx * HX, top + 0.1, sz * HZ], scale: 0.17, emissive: 0.12 });
  }
  // Skylight frame: base ring, hip rafters, mid purlins (teal + gold), apex finial.
  const base = SKY.base;
  const corners: [number, number][] = [
    [SKY.hx, SKY.hz],
    [-SKY.hx, SKY.hz],
    [-SKY.hx, -SKY.hz],
    [SKY.hx, -SKY.hz],
  ];
  const beam = (a: THREE.Vector3, c: THREE.Vector3, w: number, color: string, em = 0): void => {
    const d = c.clone().sub(a);
    const len = d.length();
    const mid = a.clone().add(c).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    b.add(G.cyl(1, 1, 8), { color, pos: [mid.x, mid.y, mid.z], rot: [e.x, e.y, e.z], scale: [w, len, w], emissive: em });
  };
  const apex = new THREE.Vector3(0, SKY.apex, 0);
  // A light skeleton only (base ring + four slim hip rafters): the cutaway must keep every
  // interior safe readable from the game camera, and from 55° the apex projects ~3 m north of
  // the center — right over a back safe when the bank is turned — so no hub, purlins or
  // finial there.
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i]!;
    const [x1, z1] = corners[(i + 1) % 4]!;
    const a = new THREE.Vector3(x0, base, z0);
    const c = new THREE.Vector3(x1, base, z1);
    beam(a, c, 0.06, PAL.bankRoofDark);
    beam(a, apex, 0.026, PAL.goldLight, 0.06);
  }
  b.add(G.sphere(10, 6), { color: PAL.gold, pos: [0, SKY.apex + 0.02, 0], scale: 0.05, emissive: 0.2 });
  // Ceiling lamps: four little pendant lanterns hung from the rafters, off the safe line
  // (safes sit on local z = 0) so their projection never lands on a safe at any bank angle.
  for (const [sx, sz] of corners) {
    const f = 0.5;
    const lx = sx * (1 - f);
    const lz = sz * (1 - f);
    const top = base + (SKY.apex - base) * f;
    addPendantLamp(b, lx, top, lz);
  }
  // Pediments over both doors with a coin medallion.
  for (const d of BANK_MODEL.doors) {
    const zf = d.center.y + d.normal.y * 0.12;
    b.push([0, top - 0.15, zf], [0, d.normal.y > 0 ? 0 : Math.PI, 0]);
    b.add(new THREE.ExtrudeGeometry(triangleShape(4.2, 1.05), { depth: 0.3, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 }).translate(0, 0, -0.15), {
      color: PAL.plaster,
    });
    b.add(new THREE.ExtrudeGeometry(triangleShape(4.5, 1.2), { depth: 0.12, bevelEnabled: false }).translate(0, -0.06, -0.2), { color: PAL.bankTrim });
    b.add(G.cyl(1, 1, 22), { color: PAL.goldDark, pos: [0, 0.42, 0.17], rot: [Math.PI / 2, 0, 0], scale: [0.3, 0.06, 0.3] });
    b.add(G.cyl(1, 1, 22), { color: PAL.gold, pos: [0, 0.42, 0.2], rot: [Math.PI / 2, 0, 0], scale: [0.25, 0.04, 0.25], emissive: 0.15 });
    b.add(G.star(5, 0.45, 0.3), { color: PAL.goldLight, pos: [0, 0.42, 0.225], scale: 0.14, emissive: 0.2 });
    b.pop();
  }
  return b.merge('vc')!;
}

/** The four glass faces of the skylight (uv = face-local, for the sheen sweep). */
function buildGlass(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const corners: [number, number][] = [
    [SKY.hx, SKY.hz],
    [-SKY.hx, SKY.hz],
    [-SKY.hx, -SKY.hz],
    [SKY.hx, -SKY.hz],
  ];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i]!;
    const [x1, z1] = corners[(i + 1) % 4]!;
    pos.push(x0, SKY.base, z0, x1, SKY.base, z1, 0, SKY.apex, 0);
    uv.push(0, 0, 1, 0, 0.5, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

const SIGN_W = 3.3;
const SIGN_H = 1.45;
const SIGN_POST = 0.62;
const SIGN_TILT = -0.22; // lean back toward the high camera

function buildSignFrame(): THREE.BufferGeometry {
  const b = new PartBuilder();
  // Little base on the eave + two legs (the sign rides a boom on the far side of the roof).
  b.add(G.rbox(SIGN_W * 0.78, 0.1, 0.4, 0.04), { color: PAL.goldDark, pos: [0, 0.05, 0] });
  for (const s of [-1, 1]) {
    b.add(G.cyl(1, 1, 10), { color: PAL.goldDark, pos: [s * SIGN_W * 0.3, SIGN_POST / 2, 0], scale: [0.06, SIGN_POST, 0.06] });
    b.add(G.cyl(1, 1, 8), { color: PAL.gold, pos: [s * SIGN_W * 0.3, SIGN_POST * 0.35, 0.12], rot: [0.7, 0, 0], scale: [0.025, 0.4, 0.025] });
  }
  b.add(G.rbox(SIGN_W * 0.7, 0.1, 0.12, 0.04), { color: PAL.goldDark, pos: [0, SIGN_POST - 0.02, 0] });
  b.add(G.rbox(SIGN_W + 0.16, SIGN_H + 0.16, 0.14, 0.07), { color: PAL.gold, pos: [0, SIGN_POST + SIGN_H / 2, 0], emissive: 0.1 });
  // Marquee bulbs along the top edge.
  for (let i = 0; i < 9; i++) {
    const x = -SIGN_W / 2 + 0.15 + (i * (SIGN_W - 0.3)) / 8;
    b.add(G.sphere(8, 6), { color: '#FFF1C2', pos: [x, SIGN_POST + SIGN_H + 0.1, 0], scale: 0.07, emissive: 1.8 });
  }
  // Alarm beacon housing on top (the dome + light fans are separate, animated).
  b.add(G.cyl(1, 1.1, 16), { color: PAL.steelDark, pos: [0, SIGN_POST + SIGN_H + 0.2, 0], scale: [0.24, 0.12, 0.24] });
  // Bell brackets at both top corners.
  for (const s of [-1, 1]) b.add(G.rbox(0.3, 0.05, 0.05, 0.02), { color: PAL.goldDark, pos: [s * (SIGN_W / 2 + 0.12), SIGN_POST + SIGN_H + 0.02, 0] });
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

/** Red alarm dome (emissive driven per rig) + a bell (pivot at its top). */
function buildBeaconDome(): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.add(G.dome(18, 10), { color: '#FF4D5E', scale: [0.2, 0.26, 0.2], emissive: 0.3 });
  b.add(G.sphere(8, 6), { color: '#FFFFFF', pos: [0.06, 0.15, 0.08], scale: 0.035, emissive: 0.8 });
  return b.merge('vc')!;
}

function buildBell(): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.add(G.cyl(1, 1, 6), { color: PAL.goldDark, pos: [0, -0.06, 0], scale: [0.015, 0.12, 0.015] });
  b.add(G.dome(18, 8), { color: '#E8505B', pos: [0, -0.32, 0], scale: [0.2, 0.2, 0.2] });
  b.add(G.cyl(1, 1.15, 18, true), { color: '#E8505B', pos: [0, -0.36, 0], scale: [0.2, 0.08, 0.2] });
  b.add(G.torus(0.12, 6, 18), { color: PAL.gold, pos: [0, -0.4, 0], rot: [Math.PI / 2, 0, 0], scale: 0.21 });
  b.add(G.sphere(10, 8), { color: PAL.goldDark, pos: [0, -0.45, 0], scale: 0.05 });
  b.add(G.sphere(8, 6), { color: '#FFFFFF', pos: [0.08, -0.22, 0.1], scale: 0.03, emissive: 0.6 });
  return b.merge('vc')!;
}

/** Portraits (inside) and wanted posters (outside) as textured quads in wall frames. */
function buildArt(kind: 'portrait' | 'poster'): THREE.BufferGeometry | null {
  const frames = wallFrames();
  const b = new PartBuilder('art');
  for (const a of ART_SPOTS) {
    if (a.kind !== kind) continue;
    const f = frames[a.wall]!;
    b.push([f.cx, 0, f.cz], [0, f.yaw, 0]);
    if (a.inside) b.add(G.plane(), { color: '#FFFFFF', pos: [a.u, a.y, -T / 2 - 0.071], rot: [0, Math.PI, 0], scale: [a.w, a.h, 1] });
    else b.add(G.plane(), { color: '#FFFFFF', pos: [a.u, a.y, T / 2 + 0.042], rot: [0, 0, (a.u > 0 ? -1 : 1) * 0.06], scale: [a.w, a.h, 1] });
    b.pop();
  }
  return b.merge('art');
}

/** Security lasers criss-crossing the interior above head height. */
function buildLasers(): THREE.BufferGeometry {
  const b = new PartBuilder('laser');
  const xs = BANK_MODEL.floorHalf.x;
  const lines: [number, number, number, number, number][] = [
    // x0, z0, x1, z1, y
    [-xs, -1.9, xs, 1.2, 1.5],
    [-xs, 1.6, xs, -1.4, 1.75],
    [-xs, -0.6, xs, 2.0, 2.1],
    [-xs, 2.1, xs, -2.1, 2.35],
    [-xs, -2.2, xs, 0.4, 1.95],
  ];
  for (const [x0, z0, x1, z1, y] of lines) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    b.add(G.box(), { color: '#FF3B4E', pos: [(x0 + x1) / 2, y, (z0 + z1) / 2], rot: [0, yaw, 0], scale: [len, 0.03, 0.03] });
    b.add(G.box(), { color: '#FF8A94', pos: [(x0 + x1) / 2, y, (z0 + z1) / 2], rot: [0, yaw, 0], scale: [len, 0.012, 0.012] });
  }
  return b.merge('laser')!;
}

// ---------------------------------------------------------------------------
// Roots / pipes / cables
// ---------------------------------------------------------------------------

type RootKind = 'root' | 'corner' | 'pipe' | 'cable';
interface RootSpot {
  /** Point on the slab edge (bank local). */
  x: number;
  z: number;
  /** Outward yaw (frame +x = outward). */
  yaw: number;
  kind: RootKind;
  seed: number;
}

/**
 * Where the bank is "plugged into" the ground. Everything stays within ~0.35 m of the slab
 * edge (0.6 m on the diagonal at the corners) and below ~0.12 m, because raccoons stand
 * ~0.55 m from the walls to grab them: they step over the roots instead of clipping through.
 */
function rootSpots(): RootSpot[] {
  const spots: RootSpot[] = [];
  const ex = HX + RIM - 0.06;
  const ez = HZ + RIM - 0.06;
  let seed = 0;
  // yaw: frame +x -> world direction (cos yaw, 0, -sin yaw); outward (dx, dz) => atan2(-dz, dx).
  const yawOf = (dx: number, dz: number): number => Math.atan2(-dz, dx);
  // Corner flares: three roots fanning out of each corner.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const base = yawOf(sx, sz);
      for (const off of [-0.45, 0, 0.45]) spots.push({ x: sx * ex, z: sz * ez, yaw: base + off, kind: 'corner', seed: seed++ });
    }
  }
  // Root arches + utilities along the sides (never in the door gaps, |x| < door/2 + 0.3).
  const side: [number, number, number, number, RootKind][] = [
    // x, z, outward dx, dz, kind
    [-2.9, ez, 0, 1, 'root'],
    [-1.75, ez, 0, 1, 'root'],
    [1.8, ez, 0, 1, 'root'],
    [2.85, ez, 0, 1, 'pipe'],
    [-2.6, -ez, 0, -1, 'cable'],
    [-1.6, -ez, 0, -1, 'root'],
    [1.7, -ez, 0, -1, 'root'],
    [2.9, -ez, 0, -1, 'root'],
    [-ex, -1.6, -1, 0, 'root'],
    [-ex, -0.2, -1, 0, 'pipe'],
    [-ex, 1.3, -1, 0, 'root'],
    [ex, -1.2, 1, 0, 'root'],
    [ex, 0.4, 1, 0, 'cable'],
    [ex, 1.7, 1, 0, 'root'],
  ];
  for (const [x, z, dx, dz, kind] of side) spots.push({ x, z, yaw: yawOf(dx, dz), kind, seed: seed++ });
  return spots;
}

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Flat cracked-earth patch where something dives into the paving. */
function addDirtPatch(b: PartBuilder, x: number, z: number, size: number, r: () => number): void {
  b.add(G.disc(9), { color: PAL.dirtDark, pos: [x, 0.004, z], rot: [0, r() * 3, 0], scale: [size, 1, size * (0.7 + r() * 0.3)] });
  b.add(G.disc(7), { color: PAL.dirt, pos: [x + 0.02, 0.008, z - 0.01], rot: [0, r() * 3, 0], scale: [size * 0.6, 1, size * 0.45] });
  for (let i = 0; i < 2; i++) {
    b.add(G.ico(0), { color: PAL.dirt, pos: [x + (r() - 0.5) * size * 1.6, 0.015, z + (r() - 0.5) * size * 1.6], rot: [r() * 3, r() * 3, 0], scale: [0.045, 0.022, 0.04] });
  }
}

/** Anchored: a root / pipe / cable emerging from under the slab and diving into the ground. */
function addAttached(b: PartBuilder, s: RootSpot): void {
  const r = rng(101 + s.seed * 17);
  const side = (r() - 0.5) * 0.6;
  b.push([s.x, 0, s.z], [0, s.yaw, 0]);
  if (s.kind === 'root' || s.kind === 'corner') {
    // Gnarled root arching out of the slab's underside and back into the ground.
    const big = s.kind === 'corner';
    const reach = big ? 0.34 + r() * 0.1 : 0.26 + r() * 0.06;
    const lift = big ? 0.1 : 0.075;
    const r0 = big ? 0.085 : 0.06;
    const curve = new THREE.CatmullRomCurve3([
      v3(-0.12, 0.02, 0),
      v3(reach * 0.35, lift, side * 0.08),
      v3(reach * 0.75, lift * 0.7, side * 0.18),
      v3(reach, -0.05, side * 0.24),
    ]);
    b.add(taperedTube(curve, (t) => r0 * (1 - t * 0.55), 10, 7), { color: PAL.root });
    // Knots + bark stripe for a woody read from the high camera.
    const k = curve.getPointAt(0.42);
    b.add(G.sphere(8, 6), { color: PAL.rootDark, pos: [k.x, k.y + r0 * 0.55, k.z], scale: [r0 * 0.9, r0 * 0.55, r0 * 0.8] });
    if (big) {
      // Thin side rootlet.
      const p = curve.getPointAt(0.55);
      const dir = r() < 0.5 ? -1 : 1;
      const c2 = new THREE.CatmullRomCurve3([p, v3(p.x + 0.08, 0.05, p.z + dir * 0.12), v3(p.x + 0.14, -0.03, p.z + dir * 0.2)]);
      b.add(taperedTube(c2, (t) => 0.032 - t * 0.016, 6, 5), { color: PAL.rootDark });
    }
    const end = curve.getPointAt(0.97);
    addDirtPatch(b, end.x, end.z, big ? 0.16 : 0.11, r);
    if (big && s.seed % 3 === 1) {
      // A paving tile lifted by the root (low, tilted) sells "plugged into the ground".
      b.add(G.rbox(0.28, 0.035, 0.24, 0.012), { color: PAL.pavingLine, pos: [reach * 0.55, 0.035, -side * 0.5 - 0.12], rot: [0.22, r() * 0.6, 0.18] });
    }
  } else if (s.kind === 'pipe') {
    // Short elbow: out of the slab, down into a flanged ground socket, red valve on top.
    const col = s.seed % 2 ? PAL.pipeCopper : PAL.pipe;
    b.add(G.cyl(1, 1, 12), { color: col, pos: [0.06, 0.08, 0], rot: [0, 0, Math.PI / 2], scale: [0.06, 0.3, 0.06] });
    b.add(G.sphere(12, 8), { color: col, pos: [0.21, 0.08, 0], scale: 0.066 });
    b.add(G.cyl(1, 1, 12), { color: col, pos: [0.21, 0.035, 0], scale: [0.06, 0.09, 0.06] });
    b.add(G.cyl(1, 1, 14), { color: PAL.pipeDark, pos: [0.21, 0.012, 0], scale: [0.11, 0.024, 0.11] });
    b.add(G.cyl(1, 1, 12), { color: PAL.pipeDark, pos: [0.0, 0.08, 0], rot: [0, 0, Math.PI / 2], scale: [0.075, 0.04, 0.075] });
    b.add(G.torus(0.22, 6, 14), { color: '#E8505B', pos: [0.08, 0.16, 0], rot: [Math.PI / 2, 0, 0], scale: 0.065 });
    b.add(G.cyl(1, 1, 6), { color: PAL.pipeDark, pos: [0.08, 0.125, 0], scale: [0.012, 0.07, 0.012] });
  } else {
    // Utility cable hugging the ground into a little hatch.
    const curve = new THREE.CatmullRomCurve3([v3(-0.06, 0.04, 0), v3(0.12, 0.035, side * 0.2), v3(0.26, 0.03, side * 0.35)]);
    b.add(taperedTube(curve, () => 0.028, 10, 6), { color: PAL.cable });
    b.add(G.rbox(0.12, 0.08, 0.12, 0.025), { color: PAL.cableStripe, pos: [-0.02, 0.05, 0] });
    const end = curve.getPointAt(1);
    b.add(G.rbox(0.2, 0.025, 0.2, 0.01), { color: PAL.steel, pos: [end.x + 0.04, 0.012, end.z] });
    b.add(G.box(), { color: PAL.steelDark, pos: [end.x + 0.04, 0.026, end.z], scale: [0.12, 0.006, 0.03] });
  }
  b.pop();
}

/** Uprooted: short snapped stubs hanging off the slab edge (sway ramps toward the tip). */
function snappedPart(s: RootSpot): THREE.BufferGeometry {
  const r = rng(303 + s.seed * 13);
  const b = new PartBuilder();
  const side = (r() - 0.5) * 0.3;
  if (s.kind === 'root' || s.kind === 'corner') {
    const big = s.kind === 'corner';
    const len = big ? 0.26 : 0.18;
    const r0 = big ? 0.07 : 0.05;
    const curve = new THREE.CatmullRomCurve3([v3(-0.1, 0.05, 0), v3(len * 0.5, 0.05, side * 0.3), v3(len, 0.02, side * 0.6)]);
    b.add(taperedTube(curve, (t) => r0 * (1 - t * 0.3), 6, 7), { color: PAL.root });
    const tip = curve.getPointAt(1);
    b.add(G.cyl(1, 1, 8), { color: PAL.woodLight, pos: [tip.x + 0.004, tip.y, tip.z], rot: [0, 0, Math.PI / 2], scale: [r0 * 0.75, 0.016, r0 * 0.75] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r();
      b.add(G.cone(5), {
        color: PAL.woodLight,
        pos: [tip.x + 0.03, tip.y + Math.sin(a) * r0 * 0.4, tip.z + Math.cos(a) * r0 * 0.4],
        rot: [a, 0, -Math.PI / 2],
        scale: [0.014, 0.05 + r() * 0.04, 0.014],
      });
    }
  } else if (s.kind === 'pipe') {
    const col = s.seed % 2 ? PAL.pipeCopper : PAL.pipe;
    b.add(G.cyl(1, 1, 12), { color: col, pos: [0.06, 0.08, 0], rot: [0, 0, Math.PI / 2], scale: [0.06, 0.24, 0.06] });
    b.add(G.cyl(1, 1, 12), { color: PAL.pipeDark, pos: [0.0, 0.08, 0], rot: [0, 0, Math.PI / 2], scale: [0.075, 0.04, 0.075] });
    // Jagged torn end.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(G.cone(4), {
        color: col,
        pos: [0.19, 0.08 + Math.sin(a) * 0.045, Math.cos(a) * 0.045],
        rot: [a, 0, -Math.PI / 2],
        scale: [0.018, 0.04 + (i % 2) * 0.035, 0.018],
      });
    }
    // Drip.
    b.add(G.sphere(8, 6), { color: PAL.water, pos: [0.22, 0.02, 0], scale: [0.03, 0.022, 0.03], emissive: 0.3 });
  } else {
    const curve = new THREE.CatmullRomCurve3([v3(-0.06, 0.04, 0), v3(0.1, 0.06, side), v3(0.22, 0.03, side * 1.6)]);
    b.add(taperedTube(curve, () => 0.028, 8, 6), { color: PAL.cable });
    const tip = curve.getPointAt(1);
    for (let i = 0; i < 3; i++) {
      const a = -0.5 + i * 0.5;
      b.add(G.cyl(1, 1, 4), { color: PAL.pipeCopper, pos: [tip.x + 0.04, tip.y + a * 0.04, tip.z + a * 0.03], rot: [a, 0, Math.PI / 2 + a * 0.6], scale: [0.007, 0.08, 0.007] });
    }
    b.add(G.rbox(0.12, 0.08, 0.12, 0.025), { color: PAL.cableStripe, pos: [-0.02, 0.05, 0] });
  }
  const g = b.merge('vc')!;
  rampSway(g, 'x', 0.02, 0.3, 1.6);
  return g;
}

/** Strip of fresh soil along the slab edges (the bank is "planted"), skipping the doors. */
function addSoilSeam(b: PartBuilder): void {
  const r = rng(909);
  const ox = HX + RIM;
  const oz = HZ + RIM;
  const gap = DOOR_W / 2 + 0.25;
  const run = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    b.add(G.box(), { color: PAL.dirtDark, pos: [(x0 + x1) / 2 + nx * 0.07, 0.006, (z0 + z1) / 2 + nz * 0.07], rot: [0, yaw, 0], scale: [len, 0.012, 0.15] });
    const n = Math.max(2, Math.round(len / 0.28));
    for (let i = 0; i < n; i++) {
      const t = (i + r()) / n;
      const x = x0 + (x1 - x0) * t + nx * (0.05 + r() * 0.1);
      const z = z0 + (z1 - z0) * t + nz * (0.05 + r() * 0.1);
      const sz = 0.04 + r() * 0.04;
      b.add(G.ico(0), { color: r() < 0.5 ? PAL.dirt : PAL.dirtDark, pos: [x, 0.012, z], rot: [r() * 3, r() * 3, r() * 3], scale: [sz * 1.4, sz * 0.5, sz] });
    }
  };
  for (const sz of [-1, 1]) {
    run(-ox, sz * oz, -gap, sz * oz, 0, sz);
    run(gap, sz * oz, ox, sz * oz, 0, sz);
  }
  for (const sx of [-1, 1]) run(sx * ox, -oz, sx * ox, oz, sx, 0);
}

function buildRoots(snapped: boolean): THREE.BufferGeometry {
  const b = new PartBuilder();
  if (!snapped) addSoilSeam(b);
  for (const s of rootSpots()) {
    if (snapped) b.addPrepared(snappedPart(s), { pos: [s.x, 0, s.z], rot: [0, s.yaw, 0] });
    else addAttached(b, s);
  }
  if (snapped) {
    // Dirt clinging to the slab edges.
    const r = rng(77);
    const per = (len: number) => Math.round(len * 2.2);
    const edges: [number, number, number, number][] = [
      // x0, z0, x1, z1
      [-HX, HZ + RIM, HX, HZ + RIM],
      [-HX, -HZ - RIM, HX, -HZ - RIM],
      [-HX - RIM, -HZ, -HX - RIM, HZ],
      [HX + RIM, -HZ, HX + RIM, HZ],
    ];
    for (const [x0, z0, x1, z1] of edges) {
      const n = per(Math.hypot(x1 - x0, z1 - z0));
      for (let i = 0; i < n; i++) {
        const t = (i + r()) / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        const sz = 0.06 + r() * 0.06;
        b.add(G.ico(0), { color: r() < 0.5 ? PAL.dirt : PAL.dirtDark, pos: [x, 0.02 + r() * 0.03, z], rot: [r() * 3, r() * 3, r() * 3], scale: [sz * 1.3, sz * 0.7, sz] });
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
    b.add(G.star(4, 0.3, 0.2), { color: PAL.spark, pos: [0.3, 0.1, 0.0], rot: [0, 0.6, 0.3], scale: 0.11, emissive: 1.5 });
    b.add(G.star(4, 0.3, 0.2), { color: '#FFFFFF', pos: [0.33, 0.18, 0.07], rot: [0.4, -0.5, 0], scale: 0.065, emissive: 1.5 });
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
  glass: THREE.BufferGeometry;
  signFrame: THREE.BufferGeometry;
  signBoard: THREE.BufferGeometry;
  beacon: THREE.BufferGeometry;
  bell: THREE.BufferGeometry;
  fan: THREE.BufferGeometry;
  portraits: THREE.BufferGeometry | null;
  posters: THREE.BufferGeometry | null;
  lasers: THREE.BufferGeometry;
  pool: THREE.BufferGeometry;
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
  // Beacon light fan: an open cone lying along +x (apex at the dome).
  const fan = new THREE.ConeGeometry(0.32, 1.5, 16, 1, true).rotateZ(Math.PI / 2).translate(0.75, 0, 0);
  bankGeo = {
    slab: buildSlab(),
    floor: new THREE.PlaneGeometry(HX * 2, HZ * 2).rotateX(-Math.PI / 2).translate(0, BANK_FLOOR_Y + 0.002, 0),
    dashes: db.merge('dash')!,
    walls: frames.map((f, i) => buildWall(i, f)),
    headers: [buildHeader(0), buildHeader(1)],
    roof: buildRoof(),
    glass: buildGlass(),
    signFrame: buildSignFrame(),
    signBoard: buildSignBoard(),
    beacon: buildBeaconDome(),
    bell: buildBell(),
    fan,
    portraits: buildArt('portrait'),
    posters: buildArt('poster'),
    lasers: buildLasers(),
    pool: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    rootsAttached: buildRoots(false),
    rootsSnapped: buildRoots(true),
    sparks: buildSparks(),
  };
  return bankGeo;
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

function glassMaterial(cut: CutPlaneUniform): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: SHARED_UNIFORMS.uTime, uOpacity: { value: 1 }, uCutPlane: cut },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vLocal;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec4 uCutPlane;
      varying vec2 vUv;
      varying vec3 vLocal;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        if (dot(vLocal, uCutPlane.xyz) > uCutPlane.w) discard;
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.0);
        float s = vUv.x * 0.8 + vUv.y * 0.6 - fract(uTime * 0.11) * 2.6;
        float band = smoothstep(0.1, 0.0, abs(s - 0.4)) + 0.6 * smoothstep(0.04, 0.0, abs(s - 0.58));
        vec3 col = mix(vec3(0.74, 0.92, 1.0), vec3(1.0), clamp(band, 0.0, 1.0));
        float a = (0.12 + 0.22 * fres + 0.42 * band) * uOpacity;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function laserMaterial(cut: CutPlaneUniform): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uCutPlane: cut },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vColor;
      void main() {
        vLocal = position;
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec4 uCutPlane;
      varying vec3 vLocal;
      varying vec3 vColor;
      void main() {
        if (dot(vLocal, uCutPlane.xyz) > uCutPlane.w + 0.6) discard;
        gl_FragColor = vec4(vColor * 1.6 * uOpacity, 1.0);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createBank(): BankRig {
  const geo = getBankGeo();
  const root = new THREE.Group();
  root.name = 'bank';
  const body = new THREE.Group();
  root.add(body);
  const cutPlane = createCutPlane();
  const cutDepth = createCutDepthMaterial(cutPlane);
  const cutOpts = { cutPlane, cutCap: BANK_INTERIOR_COLORS.cutCap, cutEdge: BANK_INTERIOR_COLORS.cutEdge };
  const owned: THREE.Material[] = [cutDepth];

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string, parent: THREE.Object3D, shadow = true, cut = false): THREE.Mesh => {
    const me = new THREE.Mesh(g, m);
    me.name = `bank:${name}`;
    me.castShadow = shadow;
    me.receiveShadow = true;
    if (cut) me.customDepthMaterial = cutDepth;
    parent.add(me);
    return me;
  };
  const own = <M extends THREE.Material>(m: M): M => {
    owned.push(m);
    return m;
  };

  mesh(geo.slab, matVC(), 'slab', body);
  const floor = mesh(geo.floor, own(createToonMaterial({ map: bankCarpetTexture(), rim: 0, polygonOffset: -1 })), 'floor', body, false);
  floor.userData.noOutline = true;
  const dashes = mesh(geo.dashes, own(createToonMaterial({ map: dashedLineTexture(), alphaTest: 0.4, rim: 0, polygonOffset: -2, emissive: '#3A2E10', emissiveIntensity: 1 })), 'dashes', body, false);
  dashes.userData.noOutline = true;

  const wallMats = geo.walls.map(() => own(createToonMaterial({ vertexColors: true, fx: true, ...cutOpts })));
  const walls = geo.walls.map((g, i) => {
    const grp = new THREE.Group();
    grp.name = `bank:wall${i}`;
    mesh(g, wallMats[i]!, `wall${i}`, grp, true, true);
    body.add(grp);
    return grp;
  });
  const headerMats = geo.headers.map(() => own(createToonMaterial({ vertexColors: true, fx: true, ...cutOpts })));
  const headers = geo.headers.map((g, i) => mesh(g, headerMats[i]!, `header${i}`, body, true, true));

  // Portraits (inside) + wanted posters (outside): textured quads, cut with the walls.
  const artMats: THREE.MeshToonMaterial[] = [];
  for (const [g, tex, name] of [
    [geo.portraits, catPortraitTexture(), 'portraits'],
    [geo.posters, wantedPosterTexture(), 'posters'],
  ] as const) {
    if (!g) continue;
    const m = own(createToonMaterial({ map: tex, rim: 0.1, polygonOffset: -2, cutPlane }));
    m.emissiveMap = tex;
    m.emissive.set('#FFFFFF');
    m.emissiveIntensity = name === 'portraits' ? 0.22 : 0.08;
    artMats.push(m);
    const am = mesh(g, m, name, body, false);
    am.userData.noOutline = true;
  }

  const laserMat = own(laserMaterial(cutPlane));
  const lasers = mesh(geo.lasers, laserMat, 'lasers', body, false);
  lasers.userData.noOutline = true;
  lasers.visible = false;
  lasers.renderOrder = 4;

  const roof = new THREE.Group();
  roof.name = 'bank:roof';
  body.add(roof);
  const roofMat = own(createToonMaterial({ vertexColors: true, fx: true, ...cutOpts }));
  mesh(geo.roof, roofMat, 'roofBody', roof, true, true);
  const glassMat = own(glassMaterial(cutPlane));
  const glass = mesh(geo.glass, glassMat, 'glass', roof, false);
  glass.userData.noOutline = true;
  glass.renderOrder = 3;

  // Sign chain: pivot (eave height) -> yaw (faces the camera) -> back (boom to the far side of
  // the roof, so the sign never hides the interior) -> wobble (spring) -> tilt (leans back).
  const signPivot = new THREE.Group();
  signPivot.position.set(0, H + 0.24, 0);
  roof.add(signPivot);
  const signYaw = new THREE.Group();
  signPivot.add(signYaw);
  const signBack = new THREE.Group();
  signYaw.add(signBack);
  const signWobble = new THREE.Group();
  signBack.add(signWobble);
  const signTilt = new THREE.Group();
  signTilt.rotation.x = SIGN_TILT;
  signWobble.add(signTilt);
  const signFrameMat = own(createToonMaterial({ vertexColors: true, fx: true }));
  const signFrame = mesh(geo.signFrame, signFrameMat, 'signFrame', signTilt);
  signFrame.userData.noOutline = true;
  const signBoardMat = own(createToonMaterial({ map: bankSignTexture(), rim: 0.15, emissive: '#FFFFFF', emissiveIntensity: 0.0 }));
  signBoardMat.emissiveMap = bankSignTexture();
  signBoardMat.emissive.set('#FFFFFF');
  signBoardMat.emissiveIntensity = 0.32;
  const board = mesh(geo.signBoard, signBoardMat, 'signBoard', signTilt);
  board.userData.noOutline = true;
  trackViewCamera(board);

  // Alarm: beacon dome + two light fans on top of the sign, bells on its corners.
  const beaconMat = own(createToonMaterial({ vertexColors: true, fx: true, rim: 0.6 }));
  const beacon = mesh(geo.beacon, beaconMat, 'beacon', signTilt, false);
  beacon.position.set(0, SIGN_POST + SIGN_H + 0.26, 0);
  beacon.userData.noOutline = true;
  const fanMat = own(new THREE.MeshBasicMaterial({ color: '#FF3B4E', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
  const fans = new THREE.Group();
  fans.position.copy(beacon.position).add(new THREE.Vector3(0, 0.12, 0));
  for (const a of [0, Math.PI]) {
    const f = mesh(geo.fan, fanMat, 'fan', fans, false);
    f.rotation.y = a;
    f.userData.noOutline = true;
    f.renderOrder = 5;
  }
  fans.visible = false;
  signTilt.add(fans);
  const bells: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(s * (SIGN_W / 2 + 0.22), SIGN_POST + SIGN_H + 0.02, 0);
    const bm = mesh(geo.bell, matVC(), 'bell', piv);
    bm.userData.noOutline = true;
    signTilt.add(piv);
    bells.push(piv);
  }
  // Red light pool + two sweeping beams on the ground while the alarm rings.
  const alarmGround = new THREE.Group();
  alarmGround.name = 'bank:alarmGround';
  alarmGround.position.y = 0.04;
  alarmGround.visible = false;
  const poolMat = own(new THREE.MeshBasicMaterial({ map: radialGlowTexture(), color: '#FF2238', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const pool = mesh(geo.pool, poolMat, 'alarmPool', alarmGround, false);
  pool.scale.set(11, 1, 9.5);
  pool.userData.noOutline = true;
  pool.renderOrder = 2;
  // Short, faint sweeps: a readable "rotating light" cue near the building without washing a
  // pink band across the play area for the whole (long) alarm phase.
  const sweepMat = own(poolMat.clone());
  const sweep = new THREE.Group();
  for (const a of [0, Math.PI]) {
    const beam = mesh(geo.pool, sweepMat, 'alarmSweep', sweep, false);
    beam.scale.set(7.5, 1, 1.5);
    beam.position.set(Math.cos(a) * 4.6, 0.005, -Math.sin(a) * 4.6);
    beam.rotation.y = a;
    beam.userData.noOutline = true;
    beam.renderOrder = 2;
  }
  alarmGround.add(sweep);
  root.add(alarmGround);

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

  // Silhouette-only outline: hulls slide back behind the building's own surface (outline.ts);
  // they follow the cutaway too.
  const highlighter = new Highlighter(body, { pushMax: 1.6, pushSlope: 0.75, cutPlane });

  // --- state -----------------------------------------------------------------------
  const wallAlpha = [1, 1, 1, 1, 1, 1];
  const wallOpenAmt = [0, 0, 0, 0, 0, 0];
  const wallNormals = BANK_MODEL.walls.map((w) => {
    const alongX = w.half.x > w.half.y;
    return alongX ? { x: 0, z: Math.sign(w.center.y) } : { x: Math.sign(w.center.x), z: 0 };
  });
  let roofAlpha = 1;
  let uprooted = false;
  let strain = 0;
  let lift = 0;
  let time = 0;
  let popAge = Infinity;
  let alarm = false;
  let alarmLevel = 0;
  let bellAmp = 0;
  let cutaway = true;
  let backOffset = 2.6;
  // Sign spring (pitch about x, roll about z) + a free spin kicked by the pop.
  const sp = { ax: 0, az: 0, vx: 0, vz: 0, spin: 0, spinVel: 0 };
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
  const rnd = rng(Math.floor(Math.random() * 1e6));

  const applyHeaderAlpha = (): void => {
    const a0 = Math.min(wallAlpha[0]!, wallAlpha[1]!);
    const a1 = Math.min(wallAlpha[2]!, wallAlpha[3]!);
    setMaterialOpacity(headerMats[0]!, a0);
    setMaterialOpacity(headerMats[1]!, a1);
    headers[0]!.visible = a0 > 0.01;
    headers[1]!.visible = a1 > 0.01;
    highlighter.setMeshEnabled(headers[0]!, a0 > 0.6);
    highlighter.setMeshEnabled(headers[1]!, a1 > 0.6);
  };

  const updateCut = (): void => {
    const cx = Math.sin(signYawAngle);
    const cz = Math.cos(signYawAngle);
    const extent = Math.abs(cx) * HX + Math.abs(cz) * HZ;
    if (cutaway) {
      const sFront = extent + 0.2;
      const len = Math.hypot(CUT_SLOPE * cx, 1, CUT_SLOPE * cz);
      cutPlane.value.set((CUT_SLOPE * cx) / len, 1 / len, (CUT_SLOPE * cz) / len, (BANK_CUT_HEIGHT + CUT_SLOPE * sFront) / len);
    } else cutPlane.value.set(0, 1, 0, 1e4);
    for (let i = 0; i < 6; i++) {
      const n = wallNormals[i]!;
      const d = n.x * cx + n.z * cz;
      wallOpenAmt[i] = cutaway ? THREE.MathUtils.smoothstep(d, 0.3, 0.7) : 0;
    }
    // Sign boom to the far side of the roof.
    const target = Math.max(0, extent - 0.18);
    backOffset += (target - backOffset) * 0.2;
    signBack.position.z = -backOffset;
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
      if (acc.lengthSq() > 400) acc.set(0, 0, 0);
      prevPos.copy(curPos);
      prevVel.copy(vel);
    }
    // Swivel the sign toward the camera, lagging like a weather vane.
    root.getWorldQuaternion(q);
    eul.setFromQuaternion(q, 'YXZ');
    const target = cameraFacingYaw() - eul.y;
    if (!signYawInit) {
      signYawAngle = target;
      signYawInit = true;
    }
    let dYaw = target - signYawAngle;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    signYawAngle += dYaw * (1 - Math.exp(-dt * 5));
    signYaw.rotation.y = signYawAngle;
    updateCut();
    sp.vz += THREE.MathUtils.clamp(dYaw, -0.35, 0.35) * 25 * dt;
    const k = 70;
    const c = 2.6;
    const gain = 0.06;
    const tr = uprooted ? 0 : strain;
    const jitter = tr * 7 * (Math.sin(time * 37) + Math.sin(time * 23.7));
    sp.vx += (-k * sp.ax - c * sp.vx - acc.z * gain * 10 + jitter * 0.6) * dt;
    sp.vz += (-k * sp.az - c * sp.vz + acc.x * gain * 10 + jitter * 0.4) * dt;
    sp.ax = THREE.MathUtils.clamp(sp.ax + sp.vx * dt, -0.7, 0.7);
    sp.az = THREE.MathUtils.clamp(sp.az + sp.vz * dt, -0.6, 0.6);
    // Free spin (pop): decays, then snaps back to the nearest full turn.
    if (Math.abs(sp.spinVel) > 0.3) {
      sp.spin += sp.spinVel * dt;
      sp.spinVel *= Math.exp(-dt * 1.8);
    } else {
      const full = Math.round(sp.spin / (Math.PI * 2)) * Math.PI * 2;
      sp.spin += (full - sp.spin) * (1 - Math.exp(-dt * 6));
      if (Math.abs(full - sp.spin) < 1e-3) sp.spin = 0;
      sp.spinVel = 0;
    }
    signWobble.rotation.set(sp.ax, sp.spin, sp.az);

    // Strain tremble, lift, pop hop.
    let y = lift;
    let sq = 1;
    let rz = Math.sin(time * 11) * 0.008 * tr;
    let rx = Math.sin(time * 9.3) * 0.007 * tr;
    if (popAge < BANK_POP.time + 0.6) {
      popAge += dt;
      const t = popAge;
      if (t < BANK_POP.land) {
        const u = t / BANK_POP.land;
        y += BANK_POP.height * 4 * u * (1 - u);
        sq = 1 + 0.07 * Math.sin(Math.PI * Math.min(1, u * 2));
        rz += Math.sin(u * Math.PI * 2) * 0.05;
      } else {
        const v = t - BANK_POP.land;
        y += Math.max(0, Math.sin(Math.min(1, v / 0.22) * Math.PI)) * 0.12 * Math.exp(-v * 2);
        sq = 1 - 0.1 * Math.exp(-v * 9) * Math.cos(v * 26);
        rz += Math.sin(v * 17) * 0.03 * Math.exp(-v * 4);
        rx += Math.sin(v * 13 + 1) * 0.02 * Math.exp(-v * 4);
      }
    }
    body.position.set(Math.sin(time * 43) * 0.05 * tr, y + Math.abs(Math.sin(time * 29)) * 0.03 * tr, Math.sin(time * 37 + 0.7) * 0.05 * tr);
    body.rotation.z = rz;
    body.rotation.x = rx;
    body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    // Windows rattle: each wall jitters on its own while the building strains.
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]!;
      const a = tr * tr * 0.022;
      w.position.set(Math.sin(time * (51 + i * 7)) * a, Math.abs(Math.sin(time * (33 + i * 5))) * a * 0.6, Math.sin(time * (47 + i * 3) + i) * a);
    }
    // Taut roots vibrate.
    rootsAttached.scale.set(1 + tr * 0.08 * (0.5 + 0.5 * Math.sin(time * 55)), 1 - tr * 0.1, 1);
    // Sparks flicker for a while after uprooting, then occasionally.
    if (uprooted) {
      sparkTimer += dt;
      const rate = sparkTimer < 4 ? 0.55 : 0.12;
      sparks.visible = Math.sin(time * 31) + Math.sin(time * 17.3) > 2 - rate * 4;
    }
    // Alarm.
    alarmLevel += ((alarm ? 1 : 0) - alarmLevel) * (1 - Math.exp(-dt * 6));
    if (!alarm) bellAmp *= Math.exp(-dt * 3);
    else bellAmp = Math.max(bellAmp, 0.55 + 0.45 * Math.max(0, Math.sin(time * 3.1)));
    const on = alarmLevel > 0.02;
    fans.visible = on;
    lasers.visible = on;
    alarmGround.visible = on;
    const flash = 0.5 + 0.5 * Math.sin(time * 16);
    beaconMat.emissive.setRGB(1.6 * alarmLevel * (0.55 + 0.45 * flash), 0.08 * alarmLevel, 0.1 * alarmLevel);
    if (on) {
      fans.rotation.y = time * 7.5;
      fanMat.opacity = 0.2 * alarmLevel;
      laserMat.uniforms.uOpacity.value = alarmLevel * (Math.sin(time * 11) > -0.3 ? 0.55 + 0.45 * flash : 0.08);
      poolMat.opacity = alarmLevel * (0.05 + 0.07 * flash);
      sweepMat.opacity = alarmLevel * 0.09;
      sweep.rotation.y = -time * 7.5 - signYawAngle;
    }
    for (let i = 0; i < bells.length; i++) {
      const b = bells[i]!;
      b.rotation.z = Math.sin(time * 36 + i * 1.7) * 0.4 * bellAmp;
      b.rotation.x = Math.sin(time * 29 + i) * 0.15 * bellAmp;
    }
  };

  return {
    root,
    roof,
    walls,
    labelAnchor,
    cutPlane,
    get floorY() {
      return BANK_FLOOR_Y + body.position.y;
    },
    get popAge() {
      return popAge;
    },
    setRoofOpacity(a: number) {
      roofAlpha = THREE.MathUtils.clamp(a, 0, 1);
      for (const m of [roofMat, signFrameMat, signBoardMat, beaconMat]) setMaterialOpacity(m, roofAlpha);
      glassMat.uniforms.uOpacity.value = roofAlpha;
      roof.visible = roofAlpha > 0.01;
      roof.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.userData.isOutlineHull) highlighter.setMeshEnabled(o, roofAlpha > 0.6);
      });
    },
    setWallOpacity(index: number, a: number) {
      if (index < 0 || index >= walls.length) return;
      wallAlpha[index] = THREE.MathUtils.clamp(a, 0, 1);
      setMaterialOpacity(wallMats[index]!, wallAlpha[index]!);
      walls[index]!.visible = wallAlpha[index]! > 0.01;
      const m = walls[index]!.children[0];
      if (m) highlighter.setMeshEnabled(m, wallAlpha[index]! > 0.6);
      applyHeaderAlpha();
    },
    setUprooted(b: boolean) {
      if (b && !uprooted) {
        popAge = 0;
        sp.vx += 5.5;
        sp.vz += (rnd() - 0.5) * 4;
        sp.spinVel = (rnd() < 0.5 ? -1 : 1) * (9 + rnd() * 5);
        sparkTimer = 0;
        bellAmp = 1;
      }
      uprooted = b;
      rootsAttached.visible = !b;
      rootsSnapped.visible = b;
      sparks.visible = b;
    },
    setStrain(s: number) {
      strain = THREE.MathUtils.clamp(s, 0, 1);
    },
    setLift(y: number) {
      lift = Math.max(0, y);
    },
    wobbleSign(amount: number) {
      sp.vx += amount * (0.6 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1);
      sp.vz += amount * (rnd() - 0.5) * 1.2;
    },
    setAlarm(b: boolean) {
      if (b && !alarm) bellAmp = 1;
      alarm = b;
    },
    clangBell(amount: number) {
      bellAmp = Math.max(bellAmp, Math.min(1, amount));
    },
    setCutaway(b: boolean) {
      cutaway = b;
      updateCut();
    },
    wallOpen(index: number) {
      return wallOpenAmt[index] ?? 0;
    },
    setHighlight(color) {
      highlighter.set(color);
    },
    update,
    dispose() {
      highlighter.dispose();
      for (const m of owned) m.dispose();
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
    if (s.kind === 'root' || s.kind === 'corner') {
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
    const g = bankGeo;
    const all = [g.slab, g.floor, g.dashes, ...g.walls, ...g.headers, g.roof, g.glass, g.signFrame, g.signBoard, g.beacon, g.bell, g.fan, g.portraits, g.posters, g.lasers, g.pool, g.rootsAttached, g.rootsSnapped, g.sparks];
    all.forEach((x) => x?.dispose());
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
