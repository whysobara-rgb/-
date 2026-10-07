/**
 * Police (owner addition beyond doc v0.5) — neutral, cute and generic:
 *  - a puppy officer (~1 m): cream pup with floppy ears, a cap with a checker band and a plain
 *    gold shield badge (no real agency insignia), an indigo vest with lime reflective stripes,
 *    a whistle on a yellow lanyard. Expressions are geometry (eyes, brows, tongue, X eyes).
 *  - a rounded toy patrol car: white + indigo, checker side stripe, the same plain shield on the
 *    doors, a light bar whose red / blue strobes flash (and light the ground, see police view).
 *
 * Colors avoid both team colors (orange / blue) so officers never read as a team.
 * Frame: faces local +X (sim angle 0), like the raccoons. Place with placeOnSim().
 */
import * as THREE from 'three';
import type { PolicePhase } from '../../sim/types';
import { G, PartBuilder, lathe, extrudeCentered } from './geometry';
import { createToonMaterial, matVC } from './materials';
import { InkOutline, Highlighter } from './outline';
import { blobShadowTexture } from './textures';

export const POLICE_COLORS = {
  fur: '#F4DFC4',
  furShade: '#E6C9A6',
  ear: '#A8714A',
  vest: '#5A56C2',
  vestDark: '#3E3A96',
  hivis: '#C8F05A',
  cap: '#6E6AD6',
  visor: '#2A2856',
  badge: '#F6C64F',
  car: '#F7F5FF',
  carLow: '#3A3870',
} as const;

/** Plain police shield badge outline (generic: rounded top, pointed bottom). */
function shieldShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-r * 0.8, r * 0.75);
  s.quadraticCurveTo(-r * 0.4, r * 0.95, 0, r * 0.75);
  s.quadraticCurveTo(r * 0.4, r * 0.95, r * 0.8, r * 0.75);
  s.lineTo(r * 0.8, 0);
  s.quadraticCurveTo(r * 0.7, -r * 0.6, 0, -r);
  s.quadraticCurveTo(-r * 0.7, -r * 0.6, -r * 0.8, 0);
  s.closePath();
  return s;
}

let shieldGeo: THREE.BufferGeometry | null = null;
function shieldGeometry(): THREE.BufferGeometry {
  if (!shieldGeo) shieldGeo = extrudeCentered(shieldShape(1), 0.25, 0.08);
  return shieldGeo;
}

// ---------------------------------------------------------------------------
// Officer
// ---------------------------------------------------------------------------

export interface OfficerPose {
  phase: PolicePhase;
  /** Ground speed (m/s). */
  speed: number;
  time: number;
  /** 0..1 progress of the lunge while phase === 'tackle'. */
  tackle: number;
  /** Seconds since entering the current phase. */
  phaseTime: number;
  /** Blowing the whistle (spotting / after a tackle). */
  whistle: boolean;
  /** Arm-waving "멈춰!" (chasing). */
  wave: boolean;
}

export interface OfficerRig {
  readonly root: THREE.Group;
  readonly labelAnchor: THREE.Object3D;
  update(dt: number, pose: OfficerPose): void;
  setHighlight(color: THREE.ColorRepresentation | null): void;
  dispose(): void;
}

export const OFFICER_HEIGHT = 1.0;

interface OfficerGeo {
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  ear: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  eye: THREE.BufferGeometry;
  eyeX: THREE.BufferGeometry;
  brow: THREE.BufferGeometry;
  tongue: THREE.BufferGeometry;
  whistle: THREE.BufferGeometry;
}
let officerGeo: OfficerGeo | null = null;

function getOfficerGeo(): OfficerGeo {
  if (officerGeo) return officerGeo;
  const C = POLICE_COLORS;
  const merge = (fn: (b: PartBuilder) => void): THREE.BufferGeometry => {
    const b = new PartBuilder();
    fn(b);
    return b.merge('vc')!;
  };
  const body = merge((b) => {
    b.add(
      lathe(
        [
          [0, 0.12],
          [0.16, 0.13],
          [0.25, 0.22],
          [0.27, 0.34],
          [0.25, 0.46],
          [0.2, 0.56],
          [0.13, 0.64],
          [0, 0.67],
        ],
        18,
      ),
      { color: C.fur, scale: [0.95, 1, 1] },
    );
    // Vest (a slightly bigger band) + reflective stripes + pocket + radio.
    b.add(
      lathe(
        [
          [0.0, 0.22],
          [0.265, 0.23],
          [0.285, 0.34],
          [0.27, 0.46],
          [0.215, 0.56],
          [0.15, 0.6],
          [0, 0.6],
        ],
        18,
      ),
      { color: C.vest, scale: [0.97, 1, 1.02] },
    );
    for (const y of [0.3, 0.42]) b.add(G.torus(0.12, 6, 24), { color: C.hivis, pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], scale: [y < 0.35 ? 0.282 : 0.268, y < 0.35 ? 0.29 : 0.276, 0.25], emissive: 0.25 });
    b.add(G.rbox(0.03, 0.08, 0.1, 0.01), { color: C.vestDark, pos: [0.25, 0.38, -0.1], rot: [0, 0, -0.1] });
    b.add(G.rbox(0.06, 0.12, 0.06, 0.015), { color: '#25222B', pos: [0.18, 0.5, 0.15], rot: [0, 0, -0.4] });
    b.add(G.cyl(1, 1, 6), { color: '#25222B', pos: [0.2, 0.6, 0.15], scale: [0.008, 0.08, 0.008] });
    // Chest badge.
    b.push([0.245, 0.5, -0.1], [0, Math.PI / 2, -0.35]);
    b.add(shieldGeometry(), { color: C.badge, scale: 0.05, emissive: 0.2 });
    b.pop();
    // Belly patch.
    b.add(G.sphere(12, 8), { color: '#FFF6E8', pos: [0.18, 0.2, 0], scale: [0.1, 0.07, 0.14] });
  });
  const head = merge((b) => {
    // Top-down readability (the match camera looks down at 55°): a big cream head, a long
    // snout with a big black nose poking forward, dark ears flaring out to the sides and only a
    // small cap perched on the back of the head — from above it must read "puppy", not "lid".
    b.push([0.01, 0.13, 0]);
    b.add(G.sphere(22, 14), { color: C.fur, scale: [0.29, 0.26, 0.3] });
    // Snout + big nose + cheek fluff.
    b.add(G.sphere(16, 12), { color: '#FFF6E8', pos: [0.24, -0.06, 0], scale: [0.18, 0.115, 0.15] });
    b.add(G.sphere(12, 8), { color: '#2A2131', pos: [0.405, -0.01, 0], scale: [0.068, 0.056, 0.082] });
    b.add(G.sphere(8, 6), { color: '#FFFFFF', pos: [0.44, 0.015, -0.025], scale: [0.016, 0.012, 0.02], emissive: 0.4 });
    b.add(G.box(), { color: '#2A2131', pos: [0.38, -0.09, 0], scale: [0.006, 0.05, 0.006] });
    for (const s of [-1, 1]) b.add(G.sphere(10, 8), { color: '#FFB3C1', pos: [0.19, -0.08, s * 0.19], scale: [0.045, 0.028, 0.045], emissive: 0.05 });
    // Brown patch over one eye (a cute marking) + a brown crown spot, both visible from above.
    b.add(G.sphere(12, 8), { color: C.ear, pos: [0.17, 0.08, -0.13], scale: [0.11, 0.1, 0.1] });
    b.add(G.sphere(12, 8), { color: C.ear, pos: [0.05, 0.2, 0.1], scale: [0.12, 0.08, 0.1] });
    // Small police cap tipped back on the head: crown, checker band, visor, badge.
    b.push([-0.11, 0.21, 0], [0, 0, 0.36], 0.82);
    // Crown in the bright cap color, a darker top (from behind / above the cap must not read
    // as a big bright lid over the puppy).
    b.add(G.cyl(1.15, 1, 20), { color: C.cap, pos: [0, 0.06, 0], scale: [0.15, 0.1, 0.16] });
    b.add(G.cyl(1, 1, 20), { color: C.vestDark, pos: [0.01, 0.115, 0], scale: [0.165, 0.025, 0.175] });
    b.add(G.torus(0.1, 6, 20), { color: '#FFFFFF', pos: [0.01, 0.128, 0], rot: [Math.PI / 2, 0, 0], scale: [0.163, 0.173, 0.08] });
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      b.add(G.box(), { color: i % 2 ? '#FFFFFF' : '#25222B', pos: [Math.cos(a) * 0.158, 0.03, Math.sin(a) * 0.168], rot: [0, -a, 0], scale: [0.01, 0.04, 0.085] });
    }
    b.add(G.cyl(1, 1, 16, false), { color: C.visor, pos: [0.15, -0.005, 0], rot: [0, 0, -0.1], scale: [0.11, 0.02, 0.16] });
    b.push([0.168, 0.07, 0], [0, Math.PI / 2, 0.12]);
    b.add(shieldGeometry(), { color: C.badge, scale: 0.05, emissive: 0.25 });
    b.add(G.sphere(8, 6), { color: '#FFFFFF', pos: [0, 0.01, 0.02], scale: [0.014, 0.014, 0.008], emissive: 0.3 });
    b.pop();
    b.pop();
    b.pop();
  });
  const ear = merge((b) => {
    // Big floppy ear hanging from its pivot (top), outer dark brown, inner pink. The rig splays
    // it outward so its flat face shows from the high camera.
    b.add(G.sphere(12, 8), { color: '#8C5A3A', pos: [0, -0.12, 0], scale: [0.095, 0.16, 0.045] });
    b.add(G.sphere(8, 6), { color: '#D98C78', pos: [0.012, -0.12, 0.014], scale: [0.06, 0.11, 0.03] });
  });
  const arm = merge((b) => {
    b.add(G.capsule(0.06, 0.11, 4, 10), { color: C.vest, pos: [0, -0.09, 0] });
    b.add(G.sphere(10, 8), { color: C.fur, pos: [0.01, -0.2, 0], scale: [0.065, 0.06, 0.065] });
  });
  const leg = merge((b) => {
    b.add(G.capsule(0.07, 0.07, 4, 10), { color: C.vestDark, pos: [0, -0.07, 0] });
    b.add(G.rbox(0.19, 0.08, 0.12, 0.035), { color: '#25222B', pos: [0.04, -0.17, 0] });
    b.add(G.rbox(0.2, 0.025, 0.125, 0.01), { color: '#5F6779', pos: [0.04, -0.205, 0] });
  });
  const tail = merge((b) => {
    b.add(G.capsule(0.04, 0.12, 4, 8), { color: C.fur, pos: [-0.06, 0.06, 0], rot: [0, 0, 0.9] });
    b.add(G.sphere(8, 6), { color: C.ear, pos: [-0.12, 0.12, 0], scale: 0.05 });
  });
  const eye = merge((b) => {
    b.add(G.sphere(10, 8), { color: '#1E1A26', scale: [0.02, 0.05, 0.035] });
    b.add(G.sphere(6, 4), { color: '#FFFFFF', pos: [0.012, 0.018, -0.008], scale: [0.006, 0.014, 0.011], emissive: 0.6 });
  });
  const eyeX = merge((b) => {
    for (const r of [0.75, -0.75]) b.add(G.box(), { color: '#1E1A26', rot: [r, 0, 0], scale: [0.012, 0.075, 0.016] });
  });
  const brow = merge((b) => b.add(G.rbox(0.02, 0.018, 0.075, 0.008), { color: '#6E4A30' }));
  const tongue = merge((b) => {
    b.add(G.sphere(10, 8), { color: '#FF8FA3', pos: [0.02, -0.04, 0], scale: [0.035, 0.05, 0.04] });
    b.add(G.box(), { color: '#E8607A', pos: [0.038, -0.05, 0], scale: [0.004, 0.05, 0.004] });
  });
  const whistle = merge((b) => {
    b.add(G.cyl(1, 1, 12), { color: '#DCE1EA', rot: [0, 0, Math.PI / 2], scale: [0.025, 0.07, 0.025], emissive: 0.15 });
    b.add(G.sphere(10, 8), { color: '#DCE1EA', pos: [-0.02, -0.018, 0], scale: 0.03, emissive: 0.15 });
  });
  officerGeo = { body, head, ear, arm, leg, tail, eye, eyeX, brow, tongue, whistle };
  return officerGeo;
}

let blobGeo: THREE.BufferGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;

export function createOfficer(seed = 1): OfficerRig {
  const geo = getOfficerGeo();
  const root = new THREE.Group();
  root.name = 'officer';
  const pivot = new THREE.Group();
  const body = new THREE.Group();
  root.add(pivot);
  pivot.add(body);
  // A touch bigger than a raccoon: officers must read instantly in a crowd.
  pivot.scale.setScalar(1.12);
  const mk = (g: THREE.BufferGeometry, parent: THREE.Object3D, pos: readonly number[], name: string, outline = true): THREE.Mesh => {
    const m = new THREE.Mesh(g, matVC());
    m.name = `officer:${name}`;
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(pos[0]!, pos[1]!, pos[2]!);
    if (!outline) m.userData.noOutline = true;
    parent.add(m);
    return m;
  };
  mk(geo.body, body, [0, 0, 0], 'body');
  const head = mk(geo.head, body, [0, 0.6, 0], 'head');
  head.scale.setScalar(1.14);
  const earL = mk(geo.ear, head, [-0.01, 0.3, -0.25], 'earL');
  const earR = mk(geo.ear, head, [-0.01, 0.3, 0.25], 'earR');
  const armL = mk(geo.arm, body, [0, 0.48, -0.25], 'armL');
  const armR = mk(geo.arm, body, [0, 0.48, 0.25], 'armR');
  const legL = mk(geo.leg, body, [0, 0.21, -0.11], 'legL');
  const legR = mk(geo.leg, body, [0, 0.21, 0.11], 'legR');
  const tail = mk(geo.tail, body, [-0.22, 0.22, 0], 'tail');
  const eyes = [mk(geo.eye, head, [0.25, 0.21, -0.095], 'eyeL', false), mk(geo.eye, head, [0.25, 0.21, 0.095], 'eyeR', false)];
  for (const e of eyes) e.scale.setScalar(1.15);
  const xEyes = [mk(geo.eyeX, head, [0.258, 0.21, -0.095], 'xL', false), mk(geo.eyeX, head, [0.258, 0.21, 0.095], 'xR', false)];
  for (const x of xEyes) x.visible = false;
  const brows = [mk(geo.brow, head, [0.235, 0.3, -0.1], 'browL', false), mk(geo.brow, head, [0.235, 0.3, 0.1], 'browR', false)];
  const tongue = mk(geo.tongue, head, [0.34, 0.03, 0.02], 'tongue', false);
  tongue.visible = false;
  // Whistle: rests on the chest, jumps to the mouth when blown.
  const whistle = mk(geo.whistle, body, [0.25, 0.47, 0.05], 'whistle', false);
  if (!blobGeo) blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  if (!blobMat) blobMat = new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.scale.set(0.95, 1, 0.95);
  blob.position.y = 0.012;
  blob.renderOrder = -1;
  blob.userData.noOutline = true;
  root.add(blob);
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.y = 1.3;
  root.add(labelAnchor);
  const highlighter = new Highlighter(root);
  const ink = new InkOutline(root);

  let phase = seed * 1.7;
  let blinkNext = 1 + (seed % 3);
  let blinkUntil = -1;
  const w = { run: 0, dive: 0, tired: 0, down: 0, whistle: 0, wave: 0, hop: 0 };
  const approach = (cur: number, target: number, rate: number, dt: number): number => cur + (target - cur) * (1 - Math.exp(-rate * dt));

  const update = (dt: number, p: OfficerPose): void => {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const t = p.time;
    const run = THREE.MathUtils.clamp(p.speed / 4.4, 0, 1.3);
    w.run = approach(w.run, run, 10, dt);
    w.dive = approach(w.dive, p.phase === 'tackle' ? 1 : 0, p.phase === 'tackle' ? 30 : 6, dt);
    w.tired = approach(w.tired, p.phase === 'tired' ? 1 : 0, 8, dt);
    w.down = approach(w.down, p.phase === 'stunned' ? 1 : 0, p.phase === 'stunned' ? 18 : 5, dt);
    w.whistle = approach(w.whistle, p.whistle ? 1 : 0, 14, dt);
    w.wave = approach(w.wave, p.wave && p.phase === 'chase' ? 1 : 0, 6, dt);
    w.hop = p.phase === 'arriving' ? Math.max(0, 1 - p.phaseTime / 0.5) : 0;
    const mv = Math.min(1, w.run);
    phase += dt * (2.4 + p.speed * 3.3);
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    // Vertical: bob, arrival hop, dive arc, lying down.
    const bob = Math.abs(s) * 0.05 * mv;
    const hop = Math.sin(Math.min(1, p.phaseTime / 0.5) * Math.PI) * 0.35 * (p.phase === 'arriving' ? 1 : 0);
    const diveArc = p.phase === 'tackle' ? Math.sin(Math.PI * Math.min(1, p.tackle)) * 0.28 : 0;
    pivot.position.y = bob + hop + diveArc * w.dive + 0.08 * w.down - 0.05 * w.tired;
    // Lie on the back when stunned (roll back around z), dive horizontal when tackling.
    pivot.rotation.z = 1.45 * w.down;
    let lean = -0.12 * mv - 0.06 * w.wave;
    lean += -1.3 * w.dive;
    lean += -0.5 * w.tired;
    body.rotation.z = lean;
    body.rotation.x = Math.sin(phase) * 0.06 * mv;
    const sq = 1 + Math.sin(t * 18) * 0.02 * w.tired;
    body.scale.set(1 + 0.15 * w.dive, sq * (1 - 0.08 * w.dive), 1);
    // Legs.
    const legAmp = 0.8 * mv * (1 - w.dive) * (1 - w.down);
    legL.rotation.z = s * legAmp - 1.0 * w.dive + Math.sin(t * 9) * 0.6 * w.down + 0.35 * w.tired;
    legR.rotation.z = -s * legAmp - 0.8 * w.dive + Math.sin(t * 9 + 2) * 0.6 * w.down + 0.35 * w.tired;
    legL.position.y = 0.21 + Math.max(0, c) * 0.03 * mv;
    legR.position.y = 0.21 + Math.max(0, -c) * 0.03 * mv;
    // Arms: pump when running, reach forward in the dive, hands on knees when tired, one arm
    // waving "멈춰!" while chasing, whistle hand to the mouth, flailing when stunned.
    for (const [arm, side] of [
      [armL, -1],
      [armR, 1],
    ] as const) {
      let rz = -s * side * 0.8 * mv * (1 - w.dive);
      let rx = side * -0.2;
      rz += 2.7 * w.dive;
      rz += 0.75 * w.tired;
      rx += w.tired * side * 0.25;
      if (side < 0) {
        // Left arm: wave (up high, waggling).
        rz = rz * (1 - w.wave) + w.wave * (2.6 + Math.sin(t * 14) * 0.35);
        rx += w.wave * 0.35;
      } else {
        // Right arm: whistle to the mouth.
        rz = rz * (1 - w.whistle) + w.whistle * 2.2;
        rx = rx * (1 - w.whistle) + w.whistle * -0.9;
      }
      rz = rz * (1 - w.down) + w.down * (2.0 + Math.sin(t * 16 + side) * 0.5);
      arm.rotation.set(rx, 0, rz);
    }
    // Head + ears + tongue.
    head.rotation.z = -0.15 * w.tired + Math.sin(t * 16) * 0.06 * w.tired + 0.25 * w.dive + bob * 1.2;
    head.rotation.y = Math.sin(t * 0.6 + seed) * 0.2 * (1 - mv) * (1 - w.down);
    const flop = Math.sin(phase * 2) * 0.35 * mv + 0.6 * w.dive + Math.sin(t * 11) * 0.25 * w.tired;
    // Splayed out sideways (flat face up toward the camera), flapping when running.
    earL.rotation.set(1.05 + flop * 0.45, 0, 0.2 + flop * 0.6);
    earR.rotation.set(-1.05 - flop * 0.45, 0, 0.2 + flop * 0.6);
    tongue.visible = w.tired > 0.3 || (mv > 0.9 && Math.sin(t * 0.7) > 0.3);
    if (tongue.visible) tongue.scale.set(1, 0.8 + 0.3 * Math.abs(Math.sin(t * 14)), 1);
    tail.rotation.set(0, Math.sin(t * (8 + 8 * mv)) * 0.5, 0.2 - 0.6 * w.down);
    // Whistle position: chest -> mouth.
    whistle.position.set(0.25 + 0.25 * w.whistle, 0.47 + 0.19 * w.whistle, 0.05 - 0.05 * w.whistle);
    whistle.rotation.z = -0.3 * w.whistle;
    // Eyes: blink, X when stunned; brows angle in when chasing, worried when tired.
    if (t >= blinkNext) {
      blinkUntil = t + 0.12;
      blinkNext = t + 2 + ((seed * 7 + Math.floor(t)) % 3);
    }
    const blink = t < blinkUntil ? 0.15 : 1;
    const stunned = w.down > 0.5;
    for (let i = 0; i < 2; i++) {
      eyes[i]!.visible = !stunned;
      xEyes[i]!.visible = stunned;
      eyes[i]!.scale.set(1.15, 1.15 * blink * (1 + 0.25 * w.whistle), 1.15);
      const side = i === 0 ? -1 : 1;
      const angry = p.phase === 'chase' || p.phase === 'tackle' ? 1 : 0;
      brows[i]!.rotation.x = side * (0.5 * angry - 0.45 * w.tired);
      brows[i]!.position.y = 0.3 - 0.02 * angry + 0.02 * w.tired;
    }
  };
  update(0, { phase: 'patrol', speed: 0, time: 0, tackle: 0, phaseTime: 0, whistle: false, wave: false });

  return {
    root,
    labelAnchor,
    update,
    setHighlight(color) {
      highlighter.set(color);
      ink.setVisible(color === null || color === undefined);
    },
    dispose() {
      highlighter.dispose();
      ink.dispose();
      root.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------
// Police car
// ---------------------------------------------------------------------------

export interface PoliceCarRig {
  readonly root: THREE.Group;
  /** Body group (drift yaw / roll / squash is applied here by the view). */
  readonly body: THREE.Group;
  setSiren(on: boolean): void;
  /** Wheel spin from ground speed (m/s). */
  setSpeed(v: number): void;
  update(dt: number, time: number): void;
  /** Current strobe colors (0 = red side lit, 1 = blue side lit) for the ground pools. */
  readonly strobe: { red: number; blue: number };
  dispose(): void;
}

export const POLICE_CAR = { length: 3.7, width: 1.85, height: 1.7 } as const;

interface CarGeo {
  body: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  lensRed: THREE.BufferGeometry;
  lensBlue: THREE.BufferGeometry;
}
let carGeo: CarGeo | null = null;

function getCarGeo(): CarGeo {
  if (carGeo) return carGeo;
  const C = POLICE_COLORS;
  const b = new PartBuilder();
  const L = POLICE_CAR.length;
  const W = POLICE_CAR.width;
  // Chunky rounded body: indigo lower shell, white upper, white cabin bubble.
  b.add(G.rbox(L, 0.5, W, 0.22, 2), { color: C.carLow, pos: [0, 0.48, 0] });
  b.add(G.rbox(L - 0.1, 0.32, W - 0.06, 0.16, 2), { color: C.car, pos: [0, 0.82, 0] });
  b.add(G.rbox(L * 0.52, 0.55, W - 0.2, 0.24, 2), { color: C.car, pos: [-0.22, 1.18, 0] });
  // Windows (dark glass) on the cabin.
  b.add(G.rbox(L * 0.5, 0.36, W - 0.16, 0.16, 2), { color: '#3C4A78', pos: [-0.22, 1.2, 0], emissive: 0.1 });
  b.add(G.rbox(L * 0.54, 0.08, W - 0.18, 0.04, 1), { color: C.car, pos: [-0.22, 1.43, 0] });
  // Checker stripe along both sides.
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const x = -L / 2 + 0.3 + i * ((L - 0.6) / 11);
      for (const row of [0, 1]) b.add(G.box(), { color: (i + row) % 2 ? '#25222B' : '#FFFFFF', pos: [x, 0.64 + row * 0.09, sz * (W / 2 + 0.005)], scale: [0.27, 0.09, 0.02] });
    }
    // Door shield.
    b.push([-0.15, 0.98, sz * (W / 2 - 0.01)], [0, sz > 0 ? 0 : Math.PI, 0]);
    b.add(shieldGeometry(), { color: C.badge, scale: 0.15, emissive: 0.2 });
    b.pop();
  }
  // Bumpers, headlights, tail lights, grille.
  b.add(G.rbox(0.18, 0.2, W + 0.04, 0.08), { color: '#DCE1EA', pos: [L / 2 + 0.02, 0.38, 0] });
  b.add(G.rbox(0.18, 0.2, W + 0.04, 0.08), { color: '#DCE1EA', pos: [-L / 2 - 0.02, 0.38, 0] });
  for (const sz of [-1, 1]) {
    b.add(G.sphere(12, 8), { color: '#FFF6D8', pos: [L / 2 - 0.02, 0.66, sz * 0.62], scale: [0.06, 0.12, 0.16], emissive: 1.4 });
    b.add(G.rbox(0.06, 0.12, 0.26, 0.03), { color: '#FF4D5E', pos: [-L / 2 + 0.02, 0.68, sz * 0.62], emissive: 0.7 });
  }
  b.add(G.rbox(0.05, 0.16, 0.6, 0.03), { color: '#25222B', pos: [L / 2 + 0.01, 0.6, 0] });
  // Light-bar base (lenses are separate, flashing).
  b.add(G.rbox(0.36, 0.08, 1.3, 0.04), { color: '#25222B', pos: [-0.22, 1.5, 0] });
  b.add(G.rbox(0.3, 0.12, 0.16, 0.04), { color: '#FFFFFF', pos: [-0.22, 1.58, 0], emissive: 0.6 });
  // Antenna.
  b.add(G.cyl(1, 1, 6), { color: '#25222B', pos: [-1.2, 1.7, 0.5], scale: [0.01, 0.6, 0.01] });
  b.add(G.sphere(6, 4), { color: '#FF4D5E', pos: [-1.2, 2.0, 0.5], scale: 0.03 });
  const body = b.merge('vc')!;
  const wb = new PartBuilder();
  wb.add(G.cyl(1, 1, 18), { color: '#25222B', rot: [Math.PI / 2, 0, 0], scale: [0.36, 0.26, 0.36] });
  wb.add(G.cyl(1, 1, 14), { color: '#DCE1EA', pos: [0, 0, 0.13], rot: [Math.PI / 2, 0, 0], scale: [0.18, 0.02, 0.18] });
  for (let i = 0; i < 4; i++) wb.add(G.box(), { color: '#9AA3B6', pos: [0, 0, 0.142], rot: [0, 0, (i * Math.PI) / 4], scale: [0.3, 0.04, 0.01] });
  const wheel = wb.merge('vc')!;
  const lr = new PartBuilder();
  lr.add(G.rbox(0.3, 0.16, 0.48, 0.06), { color: '#FF3B4E', emissive: 0.4 });
  const lb = new PartBuilder();
  lb.add(G.rbox(0.3, 0.16, 0.48, 0.06), { color: '#3B7BFF', emissive: 0.4 });
  carGeo = { body, wheel, lensRed: lr.merge('vc')!, lensBlue: lb.merge('vc')! };
  return carGeo;
}

export function createPoliceCar(): PoliceCarRig {
  const geo = getCarGeo();
  const root = new THREE.Group();
  root.name = 'policeCar';
  const body = new THREE.Group();
  root.add(body);
  const bm = new THREE.Mesh(geo.body, matVC());
  bm.castShadow = true;
  bm.receiveShadow = true;
  body.add(bm);
  const wheels: THREE.Mesh[] = [];
  const L = POLICE_CAR.length;
  const W = POLICE_CAR.width;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(geo.wheel, matVC());
    w.position.set(sx * (L / 2 - 0.65), 0.36, sz * (W / 2 - 0.1));
    if (sz < 0) w.rotation.y = Math.PI;
    w.castShadow = true;
    root.add(w);
    wheels.push(w);
  }
  const redMat = createToonMaterial({ vertexColors: true, fx: true, rim: 0.4 });
  const blueMat = createToonMaterial({ vertexColors: true, fx: true, rim: 0.4 });
  const red = new THREE.Mesh(geo.lensRed, redMat);
  red.position.set(-0.22, 1.6, -0.4);
  const blue = new THREE.Mesh(geo.lensBlue, blueMat);
  blue.position.set(-0.22, 1.6, 0.4);
  for (const m of [red, blue]) {
    m.userData.noOutline = true;
    body.add(m);
  }
  if (!blobGeo) blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  if (!blobMat) blobMat = new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.scale.set(L * 1.25, 1, W * 1.5);
  blob.position.y = 0.012;
  blob.renderOrder = -1;
  root.add(blob);
  const ink = new InkOutline(body, { pushMax: 0.6, pushSlope: 0.6 });
  let siren = false;
  let spin = 0;
  let speed = 0;
  const strobe = { red: 0, blue: 0 };
  return {
    root,
    body,
    strobe,
    setSiren(on: boolean) {
      siren = on;
    },
    setSpeed(v: number) {
      speed = v;
    },
    update(dt: number, time: number) {
      spin += (speed * dt) / 0.36;
      for (const w of wheels) w.rotation.z = -spin;
      // Classic alternating double-flash pattern.
      const ph = (time * 2.2) % 1;
      const flashA = siren && ((ph < 0.12) || (ph > 0.2 && ph < 0.32)) ? 1 : 0;
      const flashB = siren && ((ph > 0.5 && ph < 0.62) || (ph > 0.7 && ph < 0.82)) ? 1 : 0;
      strobe.red = flashA;
      strobe.blue = flashB;
      redMat.emissive.setRGB(2.2 * flashA + 0.15, 0.1 * flashA, 0.1 * flashA);
      blueMat.emissive.setRGB(0.1 * flashB, 0.4 * flashB, 2.4 * flashB + 0.15);
    },
    dispose() {
      ink.dispose();
      redMat.dispose();
      blueMat.dispose();
      root.removeFromParent();
    },
  };
}

export function disposePoliceCache(): void {
  if (officerGeo) for (const g of Object.values(officerGeo)) g.dispose();
  officerGeo = null;
  if (carGeo) for (const g of Object.values(carGeo)) g.dispose();
  carGeo = null;
  shieldGeo?.dispose();
  shieldGeo = null;
  blobGeo?.dispose();
  blobMat?.dispose();
  blobGeo = null;
  blobMat = null;
}

