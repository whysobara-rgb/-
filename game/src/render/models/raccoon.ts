/**
 * Procedural raccoon character (~1.05 m tall, 0.45 m footprint radius).
 *
 * Silhouette first (doc §13): big round head with round ears, short limbs, chunky pear body,
 * big fluffy ringed tail. Emotions read from eyes (face decal) + body pose. Team identity is
 * never color alone (doc §13 "머리 장식 모양과 팀 문양"): every head decoration carries the
 * wearer's team emblem SHAPE (star / crescent) in the team color, readable from the high
 * camera at any facing: the team caps (pointy star beanie / round moon helmet), and on the
 * reward hats a top-facing emblem (top-hat crown, beret badge, head clip) plus team-colored
 * bands. The back emblem and the team-color scarf back it up.
 *
 * Frame: the model faces local +X (sim angle 0). Place with
 *   root.position.set(sim.x, floorY, sim.y); root.rotation.y = -facing;
 * (see placeOnSim in index.ts).
 *
 * Rig hierarchy (each rigid part = one merged vertex-colored mesh = one draw call):
 *   root (view-owned transform)
 *    └ pivot (hop / knockdown spin)
 *       └ body (lean, squash & stretch; pivot at the feet)
 *          ├ head ─ face decal, mask decal, dizzy stars, sweat drop
 *          ├ armL/armR (shoulder pivots), legL/legR (hip pivots)
 *          ├ tail1 ─ tail2 ─ tail3, scarfTail
 *       └ speedLines
 *    └ blob shadow
 */
import * as THREE from 'three';
import type { CharacterLook, HatId, TeamId } from '../../sim/types';
import { TEAM_STYLES } from '../../shared/teams';
import { PAL } from './palette';
import { G, PartBuilder, lathe, rng } from './geometry';
import { matVC, matTextured, matBasic } from './materials';
import { FACE_DECAL, faceTexture, nunchiMaskTexture, blobShadowTexture, type FaceExpression } from './textures';
import { Highlighter } from './outline';

export type RaccoonExpression = 'normal' | 'blink' | 'happy' | 'cheer' | 'strain' | 'dizzy' | 'sad';

export interface RaccoonPose {
  /** Ground speed in m/s (walk ~5, dash ~11). */
  speed: number;
  grabbing: boolean;
  /** Pulling an anchored target (unanchor in progress). */
  straining: boolean;
  dashing: boolean;
  /** Carry boost (dash while holding). */
  boosting: boolean;
  knockedDown: boolean;
  celebrating: boolean;
  /** Slumped, empty-handed loss reaction (doc §13). */
  sad: boolean;
  /** Seconds (any monotonically increasing clock). */
  time: number;
  /** Optional expression override (UI scenes, results). */
  expression?: RaccoonExpression | null;
  /** Optional head turn relative to the body (radians, +left), e.g. to look at a target. */
  headYaw?: number;
}

export interface RaccoonRig {
  readonly root: THREE.Group;
  /** Empty object at head-top height for name labels / ping icons. */
  readonly labelAnchor: THREE.Object3D;
  readonly team: TeamId | null;
  readonly look: CharacterLook;
  update(dt: number, pose: RaccoonPose): void;
  setLook(look: CharacterLook): void;
  setHighlight(color: THREE.ColorRepresentation | null): void;
  /** Show/hide the soft contact shadow (e.g. off when the view uses only shadow maps). */
  setBlobShadow(visible: boolean): void;
  dispose(): void;
}

export const RACCOON_HEIGHT = 1.05;
export const RACCOON_LABEL_HEIGHT = 1.32;

/** Idle/neutral pose helper. */
export function idlePose(time = 0): RaccoonPose {
  return {
    speed: 0,
    grabbing: false,
    straining: false,
    dashing: false,
    boosting: false,
    knockedDown: false,
    celebrating: false,
    sad: false,
    time,
  };
}

// ---------------------------------------------------------------------------
// Dimensions (raccoon-local, meters)
// ---------------------------------------------------------------------------

const HEAD_R = 0.29;
const HEAD_SCALE: [number, number, number] = [1.0, 0.92, 1.08];
const NECK: [number, number, number] = [0, 0.62, 0];
/** Head center relative to the neck pivot. */
const HEAD_C: [number, number, number] = [0.01, 0.13, 0];
const SHOULDER_Y = 0.5;
const SHOULDER_Z = 0.25;
const HIP_Y = 0.22;
const HIP_Z = 0.12;
const TAIL_BASE: [number, number, number] = [-0.2, 0.24, 0.05];
const TAIL_SEG = [0.15, 0.14, 0.14];

const NEUTRAL_SCARF = '#B9A3F0';

interface LookParams {
  team: TeamId | null;
  hat: HatId;
  rival: 'hodadak' | 'tongkeun' | 'nunchi' | null;
  fur: THREE.Color;
  scarf: string;
  scarfDark: string;
  emblem: 'star' | 'moon' | null;
  /** Body girth multiplier (tongkeun is chubby, hodadak slim). */
  girth: number;
}

function lookParams(team: TeamId | null, look: CharacterLook): LookParams {
  const tint = THREE.MathUtils.clamp(look.furTint ?? 0.5, 0, 1);
  const fur = new THREE.Color(PAL.fur);
  if (tint < 0.5) fur.lerp(new THREE.Color(PAL.furCool), (0.5 - tint) * 2);
  else fur.lerp(new THREE.Color(PAL.furWarm), (tint - 0.5) * 2);
  const style = team === null ? null : TEAM_STYLES[team];
  const rival = look.rival ?? null;
  return {
    team,
    hat: look.hat,
    rival,
    fur,
    scarf: style?.color ?? NEUTRAL_SCARF,
    scarfDark: style?.dark ?? '#7A64B8',
    emblem: style?.emblem ?? null,
    girth: rival === 'tongkeun' ? 1.17 : rival === 'hodadak' ? 0.95 : 1,
  };
}

function lookKey(p: LookParams): string {
  return [p.team ?? 'n', p.hat, p.rival ?? '-', p.fur.getHexString()].join('|');
}

// ---------------------------------------------------------------------------
// Geometry per part (cached per look)
// ---------------------------------------------------------------------------

type PartName = 'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'tail1' | 'tail2' | 'tail3' | 'scarfTail';
type GeoSet = Record<PartName, THREE.BufferGeometry>;

const geoSetCache = new Map<string, GeoSet>();

const BODY_PROFILE: [number, number][] = [
  [0.0, 0.13],
  [0.17, 0.14],
  [0.26, 0.22],
  [0.29, 0.34],
  [0.275, 0.46],
  [0.23, 0.57],
  [0.16, 0.66],
  [0.0, 0.7],
];
/** Body lathe scale (x, z) per unit girth: the body is a little narrower front-to-back. */
const BODY_SX = 0.92;

/** Lathe radius of the body profile at height y. */
function profileRadius(y: number): number {
  const P = BODY_PROFILE;
  if (y <= P[0][1]) return P[0][0];
  for (let i = 1; i < P.length; i++) {
    if (y <= P[i][1]) {
      const t = (y - P[i - 1][1]) / (P[i][1] - P[i - 1][1]);
      return P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t;
    }
  }
  return 0;
}

/**
 * Torso surface helper for decorations that must sit ON the body whatever the girth
 * (belly patch, chain, medallion, bib): the scaled lathe plus the cream belly ellipsoid.
 */
class Torso {
  readonly bellyC: [number, number, number];
  readonly bellyR: [number, number, number];
  constructor(readonly girth: number) {
    const y = 0.37;
    // Belly patch sits 3.5 cm proud of the fur at its center for every girth (no z-fight).
    this.bellyR = [0.17, 0.2, 0.19 * girth];
    this.bellyC = [this.rx(y) + 0.035 - this.bellyR[0], y, 0];
  }
  rx(y: number): number {
    return profileRadius(y) * BODY_SX * this.girth;
  }
  rz(y: number): number {
    return profileRadius(y) * this.girth;
  }
  /** Distance from the body axis to the outer surface (fur or belly) at height y, angle a (0 = front). */
  surface(y: number, a: number): number {
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const rx = Math.max(1e-3, this.rx(y));
    const rz = Math.max(1e-3, this.rz(y));
    let r = 1 / Math.sqrt((dx / rx) ** 2 + (dz / rz) ** 2);
    const [bx, by] = this.bellyC;
    const [ax, ay, az] = this.bellyR;
    const A = (dx / ax) ** 2 + (dz / az) ** 2;
    const B = (-2 * dx * bx) / (ax * ax);
    const C = (bx / ax) ** 2 + ((y - by) / ay) ** 2 - 1;
    const disc = B * B - 4 * A * C;
    if (disc >= 0) r = Math.max(r, (-B + Math.sqrt(disc)) / (2 * A));
    return r;
  }
}

function buildGeoSet(p: LookParams): GeoSet {
  const key = lookKey(p);
  const hit = geoSetCache.get(key);
  if (hit) return hit;
  const fur = p.fur;
  const furDark = fur.clone().lerp(new THREE.Color(PAL.furDark), 0.55);
  const merge = (fn: (b: PartBuilder) => void): THREE.BufferGeometry => {
    const b = new PartBuilder();
    fn(b);
    const g = b.merge('vc')!;
    b.clear();
    return g;
  };

  // --- body ------------------------------------------------------------------
  const body = merge((b) => {
    const gx = p.girth;
    const torso = new Torso(gx);
    b.add(lathe(BODY_PROFILE, 18), { color: fur, scale: [BODY_SX * gx, 1, gx] });
    // Cream belly patch (placed from the actual body surface, so chubby bodies keep it proud).
    b.add(G.sphere(14, 10), { color: PAL.cream, pos: torso.bellyC, scale: torso.bellyR });
    // Scarf ring + front knot.
    b.add(G.torus(0.26, 8, 24), { color: p.scarf, pos: [0, 0.635, 0], rot: [Math.PI / 2, 0, 0], scale: [0.245 * gx, 0.245 * gx, 0.25] });
    b.add(G.sphere(10, 8), { color: p.scarfDark, pos: [-0.17 * gx, 0.63, 0.12 * gx], scale: [0.075, 0.07, 0.075] });
    // Back emblem badge (team), tilted up so the high camera sees it.
    if (p.emblem) {
      b.push([-0.255 * gx, 0.43, -0.02], [0, 0, -0.55]);
      b.push(undefined, [0, -Math.PI / 2, 0]);
      b.add(G.cyl(1, 1, 24), { color: p.scarfDark, rot: [Math.PI / 2, 0, 0], scale: [0.115, 0.04, 0.115] });
      b.add(G.cyl(1, 1, 24), { color: '#FFFFFF', pos: [0, 0, 0.012], rot: [Math.PI / 2, 0, 0], scale: [0.1, 0.03, 0.1] });
      if (p.emblem === 'star') b.add(G.star(5, 0.46, 0.3), { color: p.scarf, pos: [0, 0, 0.03], scale: 0.075 });
      else b.add(G.crescent(0.3), { color: p.scarf, pos: [0.006, 0, 0.03], rot: [0, 0, Math.PI / 2], scale: 0.075 });
      b.pop().pop();
    }
    // Rival extras.
    if (p.rival === 'tongkeun') {
      // Chunky gold bead chain from under the scarf down to a medallion on the belly; every
      // bead sits on the actual torso surface.
      for (let i = 0; i <= 10; i++) {
        const a = (-0.5 + i / 10) * Math.PI * 1.1;
        const y = 0.585 - Math.cos(a) * 0.075;
        const r = torso.surface(y, a) + 0.018;
        b.add(G.sphere(8, 6), {
          color: i % 2 ? PAL.goldDark : PAL.gold,
          pos: [Math.cos(a) * r, y, Math.sin(a) * r],
          scale: 0.032,
          emissive: 0.1,
        });
      }
      const my = 0.47;
      b.push([torso.surface(my, 0) + 0.018, my, 0], [0, 0, -0.25]);
      b.add(G.cyl(1, 1, 20), { color: PAL.goldDark, rot: [0, 0, Math.PI / 2], scale: [0.075, 0.03, 0.075] });
      b.add(G.cyl(1, 1, 20), { color: PAL.gold, pos: [0.012, 0, 0], rot: [0, 0, Math.PI / 2], scale: [0.06, 0.02, 0.06], emissive: 0.15 });
      b.add(G.star(5, 0.45, 0.3), { color: PAL.goldLight, pos: [0.024, 0, 0], rot: [0, Math.PI / 2, 0], scale: 0.035, emissive: 0.2 });
      b.pop();
    }
    if (p.rival === 'hodadak') {
      // Racing number bib on the belly.
      const by = 0.37;
      const bx = torso.surface(by, 0) + 0.006;
      b.add(G.rbox(0.03, 0.15, 0.17, 0.012), { color: '#FFFFFF', pos: [bx, by, 0], rot: [0, 0, -0.12] });
      b.add(G.rbox(0.032, 0.035, 0.1, 0.008), { color: '#E8505B', pos: [bx + 0.004, by + 0.04, 0], rot: [0, 0, -0.12] });
    }
  });

  // --- head ------------------------------------------------------------------
  const head = merge((b) => {
    b.push(HEAD_C);
    b.add(G.sphere(24, 16), { color: fur, scale: [HEAD_R * HEAD_SCALE[0], HEAD_R * HEAD_SCALE[1], HEAD_R * HEAD_SCALE[2]] });
    // Cheek fluff tufts (silhouette from the front).
    for (const s of [-1, 1]) {
      b.add(G.cone(7), { color: fur, pos: [0.02, -0.1, s * 0.275], rot: [s * 2.0, 0, 0.5], scale: [0.055, 0.085, 0.05] });
      b.add(G.cone(7), { color: fur, pos: [-0.04, -0.05, s * 0.29], rot: [s * 1.8, 0, 0.3], scale: [0.045, 0.075, 0.04] });
    }
    // Ears (pushed outward so they poke out of the bigger hats).
    const bigHat = p.hat === 'teamCapA' || p.hat === 'tongkeunHat' || p.hat === 'nunchiMask';
    const helmet = p.hat === 'teamCapB';
    const earZ = helmet ? 0.25 : bigHat ? 0.235 : 0.19;
    const earTilt = helmet ? 0.82 : bigHat ? 0.62 : 0.38;
    const earY = helmet ? 0.2 : bigHat ? 0.215 : 0.205;
    for (const s of [-1, 1]) {
      b.push([-0.03, earY, s * earZ], [s * earTilt, 0, 0]);
      b.add(G.sphere(12, 9), { color: fur, scale: [0.075, 0.1, 0.1] });
      b.add(G.sphere(10, 8), { color: furDark, pos: [0.03, -0.005, 0], scale: [0.05, 0.075, 0.07] });
      b.add(G.sphere(8, 6), { color: PAL.earInner, pos: [0.045, -0.01, 0], scale: [0.03, 0.05, 0.045] });
      // light rim tip
      b.add(G.sphere(8, 6), { color: PAL.furLight, pos: [-0.005, 0.07, 0], scale: [0.06, 0.035, 0.07] });
      b.pop();
    }
    // Snout + nose.
    b.add(G.sphere(16, 12), { color: PAL.cream, pos: [0.24, -0.075, 0], scale: [0.115, 0.08, 0.105] });
    b.add(G.sphere(10, 8), { color: PAL.nose, pos: [0.348, -0.05, 0], scale: [0.04, 0.032, 0.048] });
    b.add(G.sphere(8, 6), { color: '#FFFFFF', pos: [0.37, -0.035, -0.012], scale: [0.012, 0.009, 0.014], emissive: 0.4 });
    addHat(b, p);
    b.pop();
  });

  // --- arms & legs -------------------------------------------------------------
  const arm = (side: number): THREE.BufferGeometry =>
    merge((b) => {
      b.add(G.capsule(0.062, 0.12, 4, 10), { color: fur, pos: [0, -0.1, 0] });
      b.add(G.sphere(10, 8), { color: PAL.paw, pos: [0.01, -0.2, side * 0.005], scale: [0.068, 0.062, 0.066] });
      if (p.rival === 'hodadak') {
        // Wrist sweatband.
        b.add(G.cyl(1, 1, 14), { color: '#E8505B', pos: [0, -0.15, 0], scale: [0.07, 0.035, 0.07] });
      }
    });
  const leg = (side: number): THREE.BufferGeometry =>
    merge((b) => {
      b.add(G.capsule(0.075, 0.08, 4, 10), { color: furDark, pos: [0, -0.08, 0] });
      if (p.rival === 'hodadak') {
        // Sneakers: chunky white shoe, red stripe, mint sole.
        b.add(G.rbox(0.2, 0.08, 0.12, 0.035), { color: '#FFFFFF', pos: [0.04, -0.175, 0] });
        b.add(G.rbox(0.21, 0.028, 0.125, 0.012), { color: '#8FE3C8', pos: [0.04, -0.215, 0] });
        b.add(G.rbox(0.09, 0.03, 0.128, 0.01), { color: '#E8505B', pos: [0.02, -0.17, 0], rot: [0, 0, 0.5] });
        b.add(G.sphere(8, 6), { color: '#E8505B', pos: [0.1, -0.15, side * 0.0], scale: [0.02, 0.02, 0.05] });
      } else {
        b.add(G.sphere(12, 8), { color: PAL.paw, pos: [0.035, -0.18, 0], scale: [0.105, 0.055, 0.08] });
        // Toe beans hint.
        b.add(G.sphere(8, 6), { color: PAL.furDark, pos: [0.12, -0.19, side * 0.0], scale: [0.03, 0.025, 0.06] });
      }
    });

  // --- tail (3 segments, ringed) -----------------------------------------------
  const tailSeg = (i: number): THREE.BufferGeometry =>
    merge((b) => {
      const len = TAIL_SEG[i];
      const radii = [
        [0.105, 0.12],
        [0.125, 0.12],
        [0.11, 0.075],
      ][i];
      const colors = i === 2 ? [PAL.tailLight, PAL.tailDark] : [PAL.tailLight, PAL.tailDark];
      const tl = fur.clone().lerp(new THREE.Color(PAL.furLight), 0.35);
      for (let k = 0; k < 2; k++) {
        const t = (k + 0.5) / 2;
        const r = radii[k];
        b.add(G.sphere(14, 10), {
          color: k === 0 ? tl : colors[1],
          pos: [-len * t, 0, 0],
          scale: [len * 0.62, r, r],
        });
      }
      if (i === 2) b.add(G.sphere(10, 8), { color: PAL.tailDark, pos: [-len * 1.02, 0, 0], scale: [0.07, 0.065, 0.065] });
    });

  const scarfTail = merge((b) => {
    const long = p.rival === 'nunchi' ? 1.9 : 1;
    b.add(G.rbox(0.05, 0.17 * long, 0.075, 0.022), { color: p.scarf, pos: [-0.01, -0.075 * long, -0.02], rot: [0.25, 0, -0.35] });
    b.add(G.rbox(0.05, 0.14 * long, 0.07, 0.022), { color: p.scarf, pos: [0.0, -0.06 * long, 0.04], rot: [-0.3, 0, -0.2] });
    b.add(G.rbox(0.055, 0.03, 0.08, 0.012), { color: p.rival === 'nunchi' ? '#7B4FC9' : '#FFFFFF', pos: [-0.04 * long, -0.15 * long, -0.045], rot: [0.25, 0, -0.35] });
    b.add(G.rbox(0.055, 0.03, 0.075, 0.012), { color: p.rival === 'nunchi' ? '#7B4FC9' : '#FFFFFF', pos: [-0.02 * long, -0.125 * long, 0.06], rot: [-0.3, 0, -0.2] });
  });

  const set: GeoSet = {
    body,
    head,
    armL: arm(-1),
    armR: arm(1),
    legL: leg(-1),
    legR: leg(1),
    tail1: tailSeg(0),
    tail2: tailSeg(1),
    tail3: tailSeg(2),
    scarfTail,
  };
  geoSetCache.set(key, set);
  return set;
}

/** The emblem shape itself (star / crescent), extruded along local +z, size = outer radius. */
function addEmblemShape(b: PartBuilder, emblem: 'star' | 'moon', o: { color: string; pos?: readonly [number, number, number]; rot?: readonly [number, number, number]; size: number; emissive?: number }): void {
  if (emblem === 'star') b.add(G.star(5, 0.46, 0.3), { color: o.color, pos: o.pos, rot: o.rot, scale: o.size, emissive: o.emissive });
  else b.add(G.crescent(0.3), { color: o.color, pos: o.pos, rot: o.rot, scale: o.size, emissive: o.emissive });
}

/**
 * Round team badge lying in the current frame's XZ plane, facing +Y: dark rim, white disc and
 * the team emblem in the team color, its top pointing to local +x (topDir 1: a badge lying on
 * top of the head reads "up" toward the face) or -x (topDir -1: a badge standing on the front
 * of a hat, tipped forward, reads upright).
 */
function addTeamBadge(b: PartBuilder, team: TeamId, size: number, topDir: 1 | -1 = 1): void {
  const st = TEAM_STYLES[team];
  b.add(G.cyl(1, 1, 24), { color: st.dark, pos: [0, 0, 0], scale: [size, size * 0.28, size] });
  b.add(G.cyl(1, 1, 24), { color: '#FFFFFF', pos: [0, size * 0.1, 0], scale: [size * 0.84, size * 0.2, size * 0.84] });
  b.push([0, size * 0.22, 0], [0, (-topDir * Math.PI) / 2, 0]);
  addEmblemShape(b, st.emblem, { color: st.color, rot: [-Math.PI / 2, 0, 0], size: size * 0.66, emissive: 0.08 });
  b.pop();
}

/**
 * Team emblem pin on top of the head (reward hats without a crown / no hat): a badge tipped
 * slightly forward so the high camera reads its shape at any facing.
 */
function addHeadPin(b: PartBuilder, p: LookParams, x = -0.035, y = 0.262): void {
  if (p.team === null) return;
  b.push([x, y, 0], [0, 0, -0.22]);
  b.add(G.cyl(1, 1, 8), { color: TEAM_STYLES[p.team].dark, pos: [0, -0.02, 0], scale: [0.025, 0.05, 0.025] });
  b.push([0, 0.012, 0]);
  addTeamBadge(b, p.team, 0.115);
  b.pop();
  b.pop();
}

/** Hats, authored relative to the head center. */
function addHat(b: PartBuilder, p: LookParams): void {
  const team0 = TEAM_STYLES[0];
  const team1 = TEAM_STYLES[1];
  const st = p.team === null ? null : TEAM_STYLES[p.team];
  switch (p.hat) {
    case 'teamCapA': {
      // Pointy knitted beanie (team 0 default). Knit in the wearer's team color, and the tip
      // emblem is always the WEARER's emblem (a moon-team raccoon in a beanie gets a crescent).
      const col = st?.color ?? team0.color;
      const dark = st?.dark ?? team0.dark;
      const emblem = st?.emblem ?? 'star';
      b.push([-0.02, 0.04, 0], [0, 0, 0.2]);
      b.add(G.torus(0.2, 8, 26), { color: '#FFF6E8', pos: [0, 0.135, 0], rot: [Math.PI / 2, 0, 0], scale: [0.245, 0.262, 0.22] });
      b.add(
        lathe(
          [
            [0.0, 0.12],
            [0.242, 0.13],
            [0.235, 0.21],
            [0.2, 0.31],
            [0.14, 0.41],
            [0.075, 0.5],
            [0.025, 0.565],
            [0.0, 0.575],
          ],
          18,
        ),
        { color: col, scale: [1, 1, 1.07] },
      );
      // Knit ridges.
      for (const y of [0.24, 0.35]) {
        const r = y < 0.3 ? 0.225 : 0.17;
        b.add(G.torus(0.08, 5, 20), { color: dark, pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], scale: [r, r * 1.07, 0.18] });
      }
      // Big emblem on the tip, facing up/forward.
      b.push([0.02, 0.6, 0], [0, 0, -0.5]);
      addEmblemShape(b, emblem, { color: PAL.gold, rot: [-Math.PI / 2, 0, 0], size: 0.105, emissive: 0.12 });
      b.pop();
      b.pop();
      break;
    }
    case 'teamCapB': {
      // Round helmet with a ring brim and a crest (team 1 default). The crest is the wearer's
      // emblem (a star-team raccoon in the helmet gets a star crest).
      const col = st?.color ?? team1.color;
      const dark = st?.dark ?? team1.dark;
      const emblem = st?.emblem ?? 'moon';
      b.add(G.dome(22, 10), { color: col, pos: [-0.015, 0.145, 0], scale: [0.272, 0.215, 0.292] });
      b.add(G.torus(0.12, 8, 30), { color: '#FFF6E8', pos: [-0.015, 0.155, 0], rot: [Math.PI / 2, 0, 0], scale: [0.29, 0.31, 0.3] });
      // Top button.
      b.add(G.sphere(10, 8), { color: dark, pos: [-0.015, 0.36, 0], scale: [0.04, 0.03, 0.04] });
      // Crest standing on the front, leaning back.
      b.push([0.15, 0.32, 0], [0, 0, 0.6]);
      if (emblem === 'moon') addEmblemShape(b, 'moon', { color: PAL.gold, rot: [0, Math.PI / 2, Math.PI / 2], size: 0.12, emissive: 0.12 });
      else addEmblemShape(b, 'star', { color: PAL.gold, rot: [0, Math.PI / 2, 0], size: 0.12, emissive: 0.12 });
      b.pop();
      break;
    }
    case 'hodadakBand': {
      // Sweatband in the team color (호다닥 red without a team), white stripe, a team badge
      // on the forehead, gold lightning bolts on the sides and flapping knot tails.
      const band = st?.color ?? '#E8505B';
      const knot = st?.dark ?? '#C93F4C';
      b.push([0, 0.17, 0], [0, 0, 0.1]);
      b.add(G.torus(0.14, 8, 28), { color: band, rot: [Math.PI / 2, 0, 0], scale: [0.236, 0.254, 0.3] });
      b.add(G.torus(0.05, 6, 28), { color: '#FFFFFF', pos: [0, 0.0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.246, 0.264, 0.3] });
      for (const sz of [-1, 1]) {
        b.push([-0.02, 0.0, sz * 0.262], [0, 0, 0]);
        b.add(G.bolt(0.3), { color: PAL.gold, rot: [0, sz > 0 ? 0 : Math.PI, 0], scale: 0.06, emissive: 0.25 });
        b.pop();
      }
      b.pop();
      // Forehead plate: the team badge standing on the band (white disc + bolt without team).
      b.push([0.235, 0.205, 0], [0, 0, 0.45 - Math.PI / 2]);
      if (p.team !== null) addTeamBadge(b, p.team, 0.092, -1);
      else {
        b.add(G.cyl(1, 1, 16), { color: '#FFFFFF', scale: [0.085, 0.03, 0.085] });
        b.push([0, 0.02, 0], [-Math.PI / 2, 0, Math.PI / 2]);
        b.add(G.bolt(0.3), { color: PAL.gold, scale: 0.075, emissive: 0.25 });
        b.pop();
      }
      b.pop();
      b.add(G.sphere(8, 6), { color: knot, pos: [-0.235, 0.15, 0], scale: [0.04, 0.045, 0.05] });
      b.add(G.rbox(0.03, 0.04, 0.17, 0.012), { color: band, pos: [-0.29, 0.1, -0.07], rot: [0.4, 0.5, -0.3] });
      b.add(G.rbox(0.03, 0.04, 0.15, 0.012), { color: band, pos: [-0.29, 0.08, 0.06], rot: [-0.5, -0.4, -0.4] });
      // Emblem pin on top so the team reads from behind as well.
      addHeadPin(b, p, -0.06, 0.258);
      break;
    }
    case 'tongkeunHat': {
      // Big top hat, tilted jauntily: team-colored band with the team badge in front, and the
      // team emblem inlaid on the crown top (the high camera sees the crown first).
      const band = st?.color ?? PAL.gold;
      b.push([-0.02, 0.2, 0], [0.12, 0, 0.1]);
      b.add(G.cyl(1, 1, 30), { color: PAL.ink, pos: [0, 0.0, 0], scale: [0.34, 0.035, 0.34] });
      b.add(G.cyl(0.93, 1, 30), { color: PAL.ink, pos: [0, 0.22, 0], scale: [0.225, 0.42, 0.225] });
      b.add(G.cyl(1, 1, 30, true), { color: band, pos: [0, 0.075, 0], scale: [0.232, 0.1, 0.232], emissive: st ? 0 : 0.08 });
      b.add(G.cyl(1, 1, 30), { color: '#3A3546', pos: [0, 0.43, 0], scale: [0.21, 0.012, 0.21] });
      if (p.team !== null) {
        // Crown-top emblem.
        b.push([0, 0.437, 0]);
        b.add(G.torus(0.08, 6, 26), { color: PAL.gold, rot: [Math.PI / 2, 0, 0], scale: [0.18, 0.18, 0.12], emissive: 0.1 });
        b.push(undefined, [0, -Math.PI / 2, 0]);
        addEmblemShape(b, TEAM_STYLES[p.team].emblem, { color: TEAM_STYLES[p.team].color, rot: [-Math.PI / 2, 0, 0], size: 0.15, emissive: 0.1 });
        b.pop();
        b.pop();
        // Badge on the band, facing forward.
        b.push([0.232, 0.08, 0], [0, 0, 0.2 - Math.PI / 2]);
        addTeamBadge(b, p.team, 0.075, -1);
        b.pop();
      } else {
        b.add(G.sphere(10, 8), { color: PAL.goldLight, pos: [0.225, 0.07, 0], scale: [0.03, 0.045, 0.045], emissive: 0.2 });
      }
      b.pop();
      break;
    }
    case 'nunchiMask': {
      // Phantom-thief look: the domino mask is a face decal (see rig); a beret in the team
      // color (눈치왕 purple without a team) tilted on the head, team badge pinned on top and
      // a purple feather.
      const col = st?.color ?? '#7B4FC9';
      const dark = st?.dark ?? '#5A3796';
      b.push([-0.03, 0.2, -0.02], [0.2, 0, 0.12]);
      b.add(G.dome(20, 8), { color: col, pos: [0, 0, 0], scale: [0.27, 0.1, 0.28] });
      b.add(G.torus(0.14, 6, 26), { color: dark, pos: [0, 0.008, 0], rot: [Math.PI / 2, 0, 0], scale: [0.25, 0.26, 0.2] });
      b.add(G.sphere(8, 6), { color: dark, pos: [0, 0.105, 0], scale: [0.03, 0.035, 0.03] });
      if (p.team !== null) {
        b.push([0.08, 0.09, 0.04], [0, 0, -0.3]);
        addTeamBadge(b, p.team, 0.105);
        b.pop();
      }
      b.push([-0.12, 0.06, -0.17], [0.5, 0, 0.6]);
      b.add(G.sphere(10, 8), { color: '#7B4FC9', scale: [0.028, 0.12, 0.028] });
      b.pop();
      b.pop();
      break;
    }
    case 'none':
    default:
      // No hat: the team emblem pin alone carries the team on the head.
      addHeadPin(b, p);
      break;
  }
}

// ---------------------------------------------------------------------------
// Shared non-merged pieces
// ---------------------------------------------------------------------------

let faceGeo: THREE.BufferGeometry | null = null;
let maskGeo: THREE.BufferGeometry | null = null;
function decalGeometry(scale: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(
    HEAD_R * scale,
    26,
    15,
    Math.PI - FACE_DECAL.phiLength / 2,
    FACE_DECAL.phiLength,
    FACE_DECAL.thetaStart,
    FACE_DECAL.thetaLength,
  );
  g.scale(HEAD_SCALE[0], HEAD_SCALE[1], HEAD_SCALE[2]);
  return g;
}

let starsGeo: THREE.BufferGeometry | null = null;
function dizzyStarsGeometry(): THREE.BufferGeometry {
  if (starsGeo) return starsGeo;
  const b = new PartBuilder();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(G.star(5, 0.45, 0.35), {
      color: i === 1 ? '#FFFFFF' : PAL.gold,
      pos: [Math.cos(a) * 0.3, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.3],
      rot: [-0.9, a, 0],
      scale: 0.065,
      emissive: 0.6,
    });
  }
  starsGeo = b.merge('vc')!;
  return starsGeo;
}

let sweatGeo: THREE.BufferGeometry | null = null;
function sweatGeometry(): THREE.BufferGeometry {
  if (sweatGeo) return sweatGeo;
  const b = new PartBuilder();
  b.add(G.sphere(12, 10), { color: '#9FE0FF', scale: [0.04, 0.045, 0.04], emissive: 0.25 });
  b.add(G.cone(12), { color: '#9FE0FF', pos: [0, 0.05, 0], scale: [0.034, 0.06, 0.034], emissive: 0.25 });
  b.add(G.sphere(6, 4), { color: '#FFFFFF', pos: [0.02, 0.01, 0.025], scale: 0.01, emissive: 0.6 });
  sweatGeo = b.merge('vc')!;
  return sweatGeo;
}

let speedGeo: THREE.BufferGeometry | null = null;
function speedLineGeometry(): THREE.BufferGeometry {
  if (!speedGeo) speedGeo = new THREE.BoxGeometry(1, 0.022, 0.022).translate(-0.5, 0, 0);
  return speedGeo;
}

let blobGeo: THREE.BufferGeometry | null = null;
function blobGeometry(): THREE.BufferGeometry {
  if (!blobGeo) blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  return blobGeo;
}
let blobMat: THREE.MeshBasicMaterial | null = null;
function blobMaterial(): THREE.MeshBasicMaterial {
  if (!blobMat) {
    blobMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
  }
  return blobMat;
}

function faceMaterial(kind: FaceExpression): THREE.Material {
  return matTextured(faceTexture(kind), { transparent: true, rim: 0.0, polygonOffset: -1 });
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

interface Weights {
  move: number;
  grab: number;
  strain: number;
  dash: number;
  boost: number;
  down: number;
  cheer: number;
  sad: number;
}

let rigCounter = 0;

export function createRaccoon(opts: { team: TeamId | null; look: CharacterLook }): RaccoonRig {
  const team = opts.team;
  let look: CharacterLook = { ...opts.look };
  let params = lookParams(team, look);
  let geos = buildGeoSet(params);
  const seed = ++rigCounter * 7919;
  const rand = rng(seed);

  const root = new THREE.Group();
  root.name = 'raccoon';
  const pivot = new THREE.Group();
  const body = new THREE.Group();
  root.add(pivot);
  pivot.add(body);

  const mk = (part: PartName, parent: THREE.Object3D, pos: readonly number[]): THREE.Mesh => {
    const m = new THREE.Mesh(geos[part], matVC());
    m.name = `raccoon:${part}`;
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(pos[0], pos[1], pos[2]);
    parent.add(m);
    return m;
  };

  const bodyMesh = mk('body', body, [0, 0, 0]);
  const head = mk('head', body, NECK);
  const armL = mk('armL', body, [0, SHOULDER_Y, -SHOULDER_Z]);
  const armR = mk('armR', body, [0, SHOULDER_Y, SHOULDER_Z]);
  const legL = mk('legL', body, [0, HIP_Y, -HIP_Z]);
  const legR = mk('legR', body, [0, HIP_Y, HIP_Z]);
  const tail1 = mk('tail1', body, TAIL_BASE);
  const tail2 = mk('tail2', tail1, [-TAIL_SEG[0], 0, 0]);
  const tail3 = mk('tail3', tail2, [-TAIL_SEG[1], 0, 0]);
  const scarfTail = mk('scarfTail', body, [-0.18, 0.62, 0.12]);

  // Face decal + optional mask overlay.
  if (!faceGeo) faceGeo = decalGeometry(1.006);
  if (!maskGeo) maskGeo = decalGeometry(1.014);
  let faceKind: FaceExpression = 'normal';
  const face = new THREE.Mesh(faceGeo, faceMaterial('normal'));
  face.name = 'raccoon:face';
  face.position.set(HEAD_C[0], HEAD_C[1], HEAD_C[2]);
  face.userData.noOutline = true;
  face.receiveShadow = true;
  face.renderOrder = 1;
  head.add(face);
  const mask = new THREE.Mesh(maskGeo, matTextured(nunchiMaskTexture(), { transparent: true, rim: 0.3, polygonOffset: -2 }));
  mask.name = 'raccoon:mask';
  mask.position.copy(face.position);
  mask.userData.noOutline = true;
  mask.receiveShadow = true;
  mask.renderOrder = 2;
  head.add(mask);

  // FX children.
  const stars = new THREE.Mesh(dizzyStarsGeometry(), matVC());
  stars.name = 'raccoon:dizzy';
  stars.position.set(0, HEAD_C[1] + 0.36, 0);
  stars.userData.noOutline = true;
  stars.castShadow = false;
  head.add(stars);
  const sweat = new THREE.Mesh(sweatGeometry(), matVC());
  sweat.name = 'raccoon:sweat';
  sweat.userData.noOutline = true;
  sweat.castShadow = false;
  sweat.position.set(0.12, HEAD_C[1] + 0.2, -0.3);
  head.add(sweat);

  const speedLines = new THREE.Group();
  speedLines.name = 'raccoon:speedLines';
  const speedMat = matBasic('#FFFFFF', 0.85);
  const lineSpecs = [
    [0.3, -0.22],
    [0.55, 0.26],
    [0.8, -0.12],
    [0.42, 0.05],
    [0.95, 0.18],
  ];
  const lines = lineSpecs.map(([y, z]) => {
    const l = new THREE.Mesh(speedLineGeometry(), speedMat);
    l.position.set(-0.4, y, z);
    l.userData.noOutline = true;
    l.castShadow = false;
    speedLines.add(l);
    return l;
  });
  pivot.add(speedLines);

  const blob = new THREE.Mesh(blobGeometry(), blobMaterial());
  blob.name = 'raccoon:blob';
  blob.scale.set(1.0, 1, 1.0);
  blob.position.y = 0.012;
  blob.userData.noOutline = true;
  blob.renderOrder = -1;
  root.add(blob);

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.y = RACCOON_LABEL_HEIGHT;
  root.add(labelAnchor);

  const highlighter = new Highlighter(root);

  // --- look application ---------------------------------------------------------
  const applyLook = (): void => {
    params = lookParams(team, look);
    geos = buildGeoSet(params);
    bodyMesh.geometry = geos.body;
    head.geometry = geos.head;
    armL.geometry = geos.armL;
    armR.geometry = geos.armR;
    legL.geometry = geos.legL;
    legR.geometry = geos.legR;
    tail1.geometry = geos.tail1;
    tail2.geometry = geos.tail2;
    tail3.geometry = geos.tail3;
    scarfTail.geometry = geos.scarfTail;
    const g = params.girth;
    armL.position.z = -SHOULDER_Z * g;
    armR.position.z = SHOULDER_Z * g;
    legL.position.z = -HIP_Z * Math.sqrt(g);
    legR.position.z = HIP_Z * Math.sqrt(g);
    tail1.position.set(TAIL_BASE[0] * g, TAIL_BASE[1], TAIL_BASE[2]);
    scarfTail.position.set(-0.18 * g, 0.62, 0.12 * g);
    mask.visible = look.hat === 'nunchiMask';
    blob.scale.setScalar(0.95 * g);
    highlighter.rebuild();
  };
  applyLook();

  // --- animation state -------------------------------------------------------------
  const w: Weights = { move: 0, grab: 0, strain: 0, dash: 0, boost: 0, down: 0, cheer: 0, sad: 0 };
  let phase = rand() * Math.PI * 2;
  let spin = 0;
  let spinVel = 0;
  let wasDown = false;
  let nextBlink = 1.5 + rand() * 3;
  let blinkUntil = -1;
  const idleSeed = rand() * 10;

  const approach = (cur: number, target: number, rate: number, dt: number): number =>
    cur + (target - cur) * (1 - Math.exp(-rate * dt));

  const setFace = (kind: FaceExpression): void => {
    if (kind === faceKind) return;
    faceKind = kind;
    face.material = faceMaterial(kind);
  };

  const update = (dt: number, pose: RaccoonPose): void => {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const t = pose.time;
    const rival = params.rival;
    const moveTarget = THREE.MathUtils.clamp(pose.speed / 5, 0, 1.6);
    w.move = approach(w.move, moveTarget, 10, dt);
    w.grab = approach(w.grab, pose.grabbing ? 1 : 0, 14, dt);
    w.strain = approach(w.strain, pose.straining ? 1 : 0, 10, dt);
    w.dash = approach(w.dash, pose.dashing ? 1 : 0, pose.dashing ? 24 : 8, dt);
    w.boost = approach(w.boost, pose.boosting ? 1 : 0, pose.boosting ? 20 : 7, dt);
    w.down = approach(w.down, pose.knockedDown ? 1 : 0, pose.knockedDown ? 20 : 5, dt);
    w.cheer = approach(w.cheer, pose.celebrating ? 1 : 0, 8, dt);
    w.sad = approach(w.sad, pose.sad ? 1 : 0, 5, dt);
    const mv = Math.min(w.move, 1);
    const athletic = rival === 'hodadak' ? 1 : 0;

    // Gait: short legs scamper (≈2.5 strides/s at walk speed).
    phase += dt * (2.2 + pose.speed * (2.9 + athletic * 0.4));
    const s = Math.sin(phase);
    const c = Math.cos(phase);

    // --- knockdown spin (starts fast, decays; snaps back to a full turn) -------------
    if (pose.knockedDown && !wasDown) spinVel = 16;
    wasDown = pose.knockedDown;
    if (pose.knockedDown) {
      spinVel *= Math.exp(-dt * 2.5);
      spin += spinVel * dt;
    } else {
      const target = Math.round(spin / (Math.PI * 2)) * Math.PI * 2;
      spin = approach(spin, target, 8, dt);
      if (Math.abs(spin - target) < 1e-3) spin = 0;
    }
    pivot.rotation.y = spin;

    // --- vertical: bob, cheer hops, knockdown sit -------------------------------------
    const bob = Math.abs(s) * 0.045 * mv;
    const hop = Math.max(0, Math.sin(t * 7.5)) * 0.2 * w.cheer;
    pivot.position.y = bob + hop - 0.1 * w.down - 0.03 * w.sad;

    // --- body lean / squash ---------------------------------------------------------------
    const breathe = Math.sin(t * 2.4 + idleSeed) * 0.015;
    let lean = -0.08 * mv - 0.08 * athletic * (0.4 + mv); // forward lean when running
    lean += 0.12 * w.grab * mv; // dragging: lean back
    lean += 0.34 * w.strain; // tug of war
    lean -= 0.2 * w.dash;
    lean -= 0.18 * w.boost;
    lean += 0.55 * w.down;
    lean -= 0.2 * w.sad;
    body.rotation.z = lean;
    body.rotation.x = Math.sin(phase) * 0.05 * mv * (1 - w.strain) + Math.sin(t * 40) * 0.02 * w.strain;
    const tremble = w.strain * 0.014;
    body.position.x = Math.sin(t * 53.0) * tremble;
    body.position.z = Math.sin(t * 41.0 + 1.3) * tremble;
    const stretch = 1 + 0.22 * w.dash + 0.1 * w.boost;
    const squash = 1 - 0.15 * w.dash - 0.06 * w.boost + breathe + Math.sin(t * 15) * 0.05 * w.cheer;
    body.scale.set(stretch, squash, 1 / Math.sqrt(stretch * squash));

    // --- legs -------------------------------------------------------------------------
    const legAmp = 0.75 * mv * (1 - w.down) * (1 - 0.6 * w.strain);
    const brace = 0.45 * w.strain;
    const sitLegs = 1.25 * w.down;
    legL.rotation.z = s * legAmp + brace + sitLegs;
    legR.rotation.z = -s * legAmp + brace * 0.8 + sitLegs * 0.9;
    legL.rotation.x = -0.12 * w.down;
    legR.rotation.x = 0.12 * w.down;
    // Lift the swinging foot a little.
    legL.position.y = HIP_Y + Math.max(0, c) * 0.03 * mv;
    legR.position.y = HIP_Y + Math.max(0, -c) * 0.03 * mv;

    // --- arms -------------------------------------------------------------------------
    const swing = -s * 0.7 * mv;
    const free = 1 - w.grab;
    const sadHang = w.sad;
    for (const [arm, side, sw] of [
      [armL, -1, swing],
      [armR, 1, -swing],
    ] as const) {
      let rz = sw * free * (1 - w.down) * (1 - w.cheer);
      let rx = side * -0.22; // slight A-pose
      // Grab: both arms reach forward and inward.
      rz += w.grab * (1.3 + 0.2 * w.strain);
      rx += w.grab * side * 0.12;
      const ry = w.grab * side * 0.42 * (1 - w.down);
      // Dash without holding: arms swept back.
      rz += -1.0 * w.dash * free;
      // Cheer: arms up and waving.
      const wave = Math.sin(t * 12 + (side > 0 ? 0 : 1.6)) * 0.35;
      rz += w.cheer * (2.6 + wave) * free;
      rx += w.cheer * side * -0.35;
      // Knocked down: flail.
      rz += w.down * (2.2 + Math.sin(t * 18 + side) * 0.5);
      rx += w.down * side * -0.6;
      // Sad: limp, slightly forward.
      rz = rz * (1 - sadHang) + sadHang * (0.12 + Math.sin(t * 1.3) * 0.03);
      rx = rx * (1 - sadHang) + sadHang * side * -0.05;
      arm.rotation.set(rx, ry * (1 - sadHang), rz);
      arm.position.y = SHOULDER_Y + Math.sin(t * 53 + side) * 0.006 * w.strain;
    }

    // --- head ------------------------------------------------------------------------
    const look = pose.headYaw ?? Math.sin(t * 0.37 + idleSeed) * 0.25 * (1 - mv) * (1 - w.grab) * (1 - w.sad);
    head.rotation.y = look * (1 - w.down);
    head.rotation.z = -0.38 * w.sad + 0.12 * w.strain - 0.1 * w.dash + Math.sin(t * 15) * 0.06 * w.cheer + bob * 1.2;
    head.rotation.x = Math.sin(t * 9) * 0.05 * w.down + Math.sin(phase * 0.5) * 0.04 * mv;

    // --- tail ------------------------------------------------------------------------
    const wagSpeed = 2.2 + 9 * w.cheer + 3 * mv;
    const wagAmp = 0.22 + 0.25 * w.cheer + 0.12 * mv - 0.15 * w.sad;
    const droop = w.sad * 0.75 - 0.25 * w.dash;
    tail1.rotation.set(0, 0.35 + Math.sin(t * wagSpeed) * wagAmp, -0.42 + droop * 0.7);
    tail2.rotation.set(0.1, Math.sin(t * wagSpeed - 0.7) * wagAmp * 0.8, -0.45 + droop * 0.5);
    tail3.rotation.set(0.15, Math.sin(t * wagSpeed - 1.4) * wagAmp * 0.6, -0.55 + droop * 0.3);

    // --- scarf tails flap -----------------------------------------------------------------
    scarfTail.rotation.z = 0.25 + mv * 0.7 + w.dash * 0.6 + Math.sin(t * (6 + mv * 10)) * 0.12 * (0.3 + mv);
    scarfTail.rotation.x = Math.sin(t * 4.3) * 0.1;

    // --- FX children ----------------------------------------------------------------------
    stars.visible = w.down > 0.05;
    if (stars.visible) {
      stars.rotation.y = t * 6;
      stars.scale.setScalar(Math.min(1, w.down * 1.4));
      stars.position.y = HEAD_C[1] + 0.36 + Math.sin(t * 5) * 0.02;
    }
    sweat.visible = w.strain > 0.3 || w.boost > 0.5;
    if (sweat.visible) {
      const k = (t * 1.5) % 1;
      sweat.position.set(0.12, HEAD_C[1] + 0.22 - k * 0.12, -0.31);
      sweat.scale.setScalar(Math.max(w.strain, w.boost) * (1 - k * 0.3));
    }
    const lineW = Math.max(w.dash, w.boost * 0.8);
    speedLines.visible = lineW > 0.05;
    if (speedLines.visible) {
      lines.forEach((l, i) => {
        const k = (t * 5 + i * 0.37) % 1;
        l.position.x = -0.3 - k * 0.5;
        l.scale.set((0.35 + 0.35 * (1 - k)) * lineW, 1, 1);
      });
    }

    // --- expression ---------------------------------------------------------------------
    let kind: FaceExpression;
    const override = pose.expression ?? null;
    if (override) kind = override;
    else if (pose.knockedDown || w.down > 0.6) kind = 'dizzy';
    else if (pose.celebrating) kind = 'cheer';
    else if (pose.sad) kind = 'sad';
    else if (pose.straining || pose.boosting) kind = 'strain';
    else if (pose.dashing) kind = 'happy';
    else kind = rival === 'nunchi' ? 'sly' : 'normal';
    // Blinking for open-eyed faces.
    if (kind === 'normal' || kind === 'sly') {
      if (t >= nextBlink) {
        blinkUntil = t + 0.13;
        nextBlink = t + 2 + rand() * 3.5;
      }
      if (t < blinkUntil) kind = kind === 'sly' ? 'slyBlink' : 'blink';
    }
    if (nextBlink - t > 10) nextBlink = t + 2; // clock jumped backwards
    setFace(kind);
  };

  update(0, idlePose(0));

  return {
    root,
    labelAnchor,
    team,
    get look() {
      return look;
    },
    update,
    setLook(next: CharacterLook) {
      look = { ...next };
      applyLook();
    },
    setHighlight(color) {
      highlighter.set(color);
    },
    setBlobShadow(visible: boolean) {
      blob.visible = visible;
    },
    dispose() {
      highlighter.dispose();
      root.removeFromParent();
      // Geometries/materials are shared caches; nothing per-instance to free.
    },
  };
}

/** Free cached raccoon geometry (full teardown only). */
export function disposeRaccoonCache(): void {
  for (const set of geoSetCache.values()) for (const g of Object.values(set)) g.dispose();
  geoSetCache.clear();
  faceGeo?.dispose();
  maskGeo?.dispose();
  starsGeo?.dispose();
  sweatGeo?.dispose();
  speedGeo?.dispose();
  blobGeo?.dispose();
  blobMat?.dispose();
  faceGeo = maskGeo = starsGeo = sweatGeo = speedGeo = blobGeo = null;
  blobMat = null;
}
