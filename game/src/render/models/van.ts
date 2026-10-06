/**
 * Team getaway van (VAN collider size: 4.6 x 2.3 m, height 2.2). Two-tone toy van in the team
 * color with the team emblem on both sides AND on the roof (readable from the high camera),
 * a roof rack with loot sacks and a beacon that spins during the final countdown.
 *
 * Frame: the van's nose points local +X (sim angle = zone.vanAngle). Place with placeOnSim().
 */
import * as THREE from 'three';
import type { TeamId } from '../../sim/types';
import { VAN } from '../../sim/config';
import { TEAM_STYLES } from '../../shared/teams';
import { PAL } from './palette';
import { G, PartBuilder } from './geometry';
import { createToonMaterial, matVan } from './materials';
import { Highlighter } from './outline';

export interface VanRig {
  readonly root: THREE.Group;
  readonly team: TeamId;
  readonly labelAnchor: THREE.Object3D;
  /** World-space-trackable point at the exhaust pipe (for puff FX). */
  readonly exhaustPoint: THREE.Object3D;
  /** Rooftop beacon spinning + flashing (final countdown / escape siren). */
  setSiren(on: boolean): void;
  /** Engine idle rumble + headlights. */
  setEngine(on: boolean): void;
  /** Suspension bounce (e.g. when loot is recovered). */
  bounce(strength?: number): void;
  /** 0..1 drive-off animation at match end (moves along local +X, ~28 m). */
  setDepart(t: number): void;
  setHighlight(color: THREE.ColorRepresentation | null): void;
  update(dt: number): void;
  dispose(): void;
}

const L = VAN.half.x * 2; // 4.6
const W = VAN.half.y * 2; // 2.3
const HGT = VAN.height; // 2.2
const WHEEL_R = 0.36;

interface VanGeo {
  body: THREE.BufferGeometry;
  wheels: THREE.BufferGeometry;
  beacon: THREE.BufferGeometry;
}
const cache = new Map<TeamId, VanGeo>();

function addEmblem(b: PartBuilder, emblem: 'star' | 'moon', color: string, scale: number): void {
  if (emblem === 'star') b.add(G.star(5, 0.46, 0.3), { color, scale });
  else b.add(G.crescent(0.3), { color, rot: [0, 0, 0], scale });
}

function buildVan(team: TeamId): VanGeo {
  const st = TEAM_STYLES[team];
  const col = st.color;
  const dark = st.dark;
  const cream = '#FFF6E8';
  const b = new PartBuilder();
  const bodyBottom = 0.32;
  const beltY = 1.28;
  const roofY = HGT - 0.12;
  // Lower body (team color) + upper cabin (cream), chunky rounded.
  b.add(G.rbox(L - 0.1, beltY - bodyBottom, W - 0.1, 0.22, 3), { color: col, pos: [0, (bodyBottom + beltY) / 2, 0] });
  b.add(G.rbox(L - 0.3, roofY - beltY + 0.1, W - 0.16, 0.3, 3), { color: cream, pos: [-0.08, (beltY + roofY) / 2 - 0.02, 0] });
  // Roof cap in team color.
  b.add(G.rbox(L - 0.5, 0.14, W - 0.3, 0.07), { color: col, pos: [-0.1, roofY + 0.05, 0] });
  // Belt stripe.
  b.add(G.rbox(L - 0.06, 0.1, W - 0.06, 0.05), { color: '#FFFFFF', pos: [0, beltY - 0.06, 0] });
  // Windshield (sloped) + side windows.
  b.add(G.rbox(0.12, 0.62, W - 0.42, 0.06), { color: PAL.glass, pos: [L / 2 - 0.26, beltY + 0.4, 0], rot: [0, 0, 0.25], emissive: 0.25 });
  for (const s of [-1, 1]) {
    for (const x of [1.1, 0.0, -1.1]) {
      b.add(G.rbox(0.8, 0.5, 0.06, 0.08), { color: x > 1 ? PAL.glass : '#FFE8B8', pos: [x, beltY + 0.4, s * (W / 2 - 0.07)], emissive: x > 1 ? 0.2 : 0.45 });
    }
    // Side emblem badge.
    b.push([-0.35, (bodyBottom + beltY) / 2 - 0.02, s * (W / 2 - 0.03)], [0, s > 0 ? 0 : Math.PI, 0]);
    b.add(G.cyl(1, 1, 28), { color: '#FFFFFF', rot: [Math.PI / 2, 0, 0], scale: [0.42, 0.06, 0.42] });
    b.push([0, 0, 0.05]);
    addEmblem(b, st.emblem, col, 0.3);
    b.pop();
    b.pop();
    // Door handle + mirror.
    b.add(G.rbox(0.18, 0.05, 0.05, 0.02), { color: PAL.silver, pos: [1.0, beltY - 0.25, s * (W / 2 - 0.02)] });
    b.add(G.rbox(0.12, 0.2, 0.06, 0.03), { color: dark, pos: [L / 2 - 0.55, beltY + 0.2, s * (W / 2 + 0.0)] });
  }
  // Front: grille, bumper, headlights.
  b.add(G.rbox(0.1, 0.36, 1.1, 0.05), { color: PAL.ink, pos: [L / 2 - 0.02, 0.72, 0] });
  for (let i = 0; i < 4; i++) b.add(G.box(), { color: PAL.silver, pos: [L / 2 + 0.03, 0.6 + i * 0.08, 0], scale: [0.02, 0.025, 1.0] });
  b.add(G.rbox(0.18, 0.18, W - 0.1, 0.08), { color: PAL.silver, pos: [L / 2 - 0.06, 0.4, 0] });
  for (const s of [-1, 1]) {
    b.add(G.cyl(1, 1, 18), { color: '#FFF3C4', pos: [L / 2 - 0.02, 0.85, s * 0.78], rot: [0, 0, Math.PI / 2], scale: [0.16, 0.08, 0.16], emissive: 0.9 });
    b.add(G.torus(0.18, 6, 18), { color: PAL.silver, pos: [L / 2 - 0.02, 0.85, s * 0.78], rot: [0, Math.PI / 2, 0], scale: 0.17 });
  }
  // Rear: doors split, tail lights, bumper, exhaust.
  b.add(G.box(), { color: dark, pos: [-L / 2 + 0.04, 0.95, 0], scale: [0.03, 1.1, 0.03] });
  for (const s of [-1, 1]) {
    b.add(G.rbox(0.06, 0.22, 0.14, 0.03), { color: '#FF6B6B', pos: [-L / 2 + 0.03, 1.0, s * (W / 2 - 0.18)], emissive: 0.6 });
    b.add(G.rbox(0.06, 0.05, 0.2, 0.02), { color: PAL.silver, pos: [-L / 2 + 0.04, 0.95, s * 0.2] });
  }
  b.add(G.rbox(0.18, 0.16, W - 0.1, 0.07), { color: PAL.silver, pos: [-L / 2 + 0.06, 0.4, 0] });
  b.add(G.cyl(1, 1, 10), { color: PAL.steelDark, pos: [-L / 2 + 0.02, 0.3, -0.6], rot: [0, 0, Math.PI / 2], scale: [0.06, 0.16, 0.06] });
  // Wheel arches (dark) — wheels themselves are a separate mesh so they can spin.
  for (const x of [L / 2 - 0.95, -L / 2 + 0.95]) for (const s of [-1, 1]) {
    b.add(G.cyl(1, 1, 18, false), { color: PAL.ink, pos: [x, WHEEL_R + 0.02, s * (W / 2 - 0.04)], rot: [Math.PI / 2, 0, 0], scale: [WHEEL_R + 0.08, 0.06, WHEEL_R + 0.08] });
  }
  // Roof: big emblem disc (top-visible), rack + loot sacks.
  b.push([0.35, roofY + 0.13, 0]);
  b.add(G.cyl(1, 1, 32), { color: '#FFFFFF', scale: [0.62, 0.05, 0.62] });
  b.add(G.cyl(1, 1, 32), { color: col, pos: [0, 0.03, 0], scale: [0.54, 0.04, 0.54] });
  b.push([0, 0.07, 0], [-Math.PI / 2, 0, 0]);
  addEmblem(b, st.emblem, '#FFFFFF', 0.38);
  b.pop();
  b.pop();
  // Rack rails.
  for (const s of [-1, 1]) {
    b.add(G.rbox(2.6, 0.06, 0.06, 0.03), { color: PAL.steelDark, pos: [-0.25, roofY + 0.32, s * 0.85] });
    for (const x of [-1.4, -0.25, 0.9]) b.add(G.cyl(1, 1, 6), { color: PAL.steelDark, pos: [x, roofY + 0.22, s * 0.85], scale: [0.03, 0.2, 0.03] });
  }
  // Loot sacks on the back of the roof.
  for (const [x, z, sc] of [
    [-1.3, -0.35, 1],
    [-1.25, 0.4, 0.85],
  ] as const) {
    b.add(G.sphere(14, 10), { color: '#E9D6B0', pos: [x, roofY + 0.36 * sc, z], scale: [0.36 * sc, 0.3 * sc, 0.34 * sc] });
    b.add(G.cone(10), { color: '#E9D6B0', pos: [x, roofY + 0.7 * sc, z], scale: [0.14 * sc, 0.16 * sc, 0.14 * sc] });
    b.add(G.torus(0.3, 6, 12), { color: PAL.rope, pos: [x, roofY + 0.62 * sc, z], rot: [Math.PI / 2, 0, 0], scale: 0.1 * sc });
    b.add(G.cyl(1, 1, 16), { color: PAL.gold, pos: [x + 0.3 * sc, roofY + 0.36 * sc, z], rot: [0, 0, Math.PI / 2], scale: [0.12 * sc, 0.02, 0.12 * sc], emissive: 0.15 });
  }
  const body = b.merge('vc')!;

  const wb = new PartBuilder();
  for (const x of [L / 2 - 0.95, -L / 2 + 0.95]) for (const s of [-1, 1]) {
    wb.push([x, WHEEL_R, s * (W / 2 - 0.12)], [Math.PI / 2, 0, 0]);
    wb.add(G.cyl(1, 1, 20), { color: PAL.black, scale: [WHEEL_R, 0.26, WHEEL_R] });
    wb.add(G.cyl(1, 1, 16), { color: PAL.silver, pos: [0, s * -0.135, 0], scale: [WHEEL_R * 0.55, 0.02, WHEEL_R * 0.55] });
    wb.add(G.cyl(1, 1, 12), { color: col, pos: [0, s * -0.15, 0], scale: [WHEEL_R * 0.25, 0.02, WHEEL_R * 0.25] });
    wb.pop();
  }
  const wheels = wb.merge('vc')!;

  const bb = new PartBuilder();
  bb.add(G.cyl(1, 1, 16), { color: PAL.steelDark, pos: [0, 0.04, 0], scale: [0.2, 0.08, 0.2] });
  bb.add(G.dome(16, 8), { color: col, pos: [0, 0.08, 0], scale: [0.17, 0.24, 0.17], emissive: 0.3 });
  bb.add(G.box(), { color: '#FFFFFF', pos: [0, 0.16, 0], scale: [0.3, 0.06, 0.04], emissive: 0.6 });
  const beacon = bb.merge('vc')!;
  return { body, wheels, beacon };
}

function getGeo(team: TeamId): VanGeo {
  let g = cache.get(team);
  if (!g) cache.set(team, (g = buildVan(team)));
  return g;
}

export function createVan(team: TeamId): VanRig {
  const geo = getGeo(team);
  const root = new THREE.Group();
  root.name = `van${team}`;
  const mover = new THREE.Group(); // depart offset
  const chassis = new THREE.Group(); // suspension bounce, engine rumble
  root.add(mover);
  mover.add(chassis);

  const bodyMat = matVan();
  const body = new THREE.Mesh(geo.body, bodyMat);
  body.name = 'van:body';
  body.castShadow = true;
  body.receiveShadow = true;
  chassis.add(body);
  const wheels = new THREE.Mesh(geo.wheels, bodyMat);
  wheels.name = 'van:wheels';
  wheels.castShadow = true;
  mover.add(wheels);
  const beaconMat = createToonMaterial({ vertexColors: true, fx: true, rim: 0.4 });
  const beacon = new THREE.Mesh(geo.beacon, beaconMat);
  beacon.name = 'van:beacon';
  beacon.position.set(1.2, HGT - 0.0, 0);
  beacon.castShadow = false;
  beacon.userData.noOutline = true;
  chassis.add(beacon);

  const exhaustPoint = new THREE.Object3D();
  exhaustPoint.position.set(-L / 2 - 0.1, 0.3, -0.6);
  chassis.add(exhaustPoint);
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, HGT + 1.2, 0);
  mover.add(labelAnchor);

  const highlighter = new Highlighter(mover, { pushMax: 1.1, pushSlope: 0.7 });
  const teamColor = new THREE.Color(TEAM_STYLES[team].color);

  let siren = false;
  let engine = false;
  let time = Math.random() * 5;
  let bounceV = 0;
  let bounceY = 0;
  let depart = 0;

  return {
    root,
    team,
    labelAnchor,
    exhaustPoint,
    setSiren(on: boolean) {
      siren = on;
    },
    setEngine(on: boolean) {
      engine = on;
    },
    bounce(strength = 1) {
      bounceV -= 1.6 * strength;
    },
    setDepart(t: number) {
      depart = THREE.MathUtils.clamp(t, 0, 1);
    },
    setHighlight(color) {
      highlighter.set(color);
    },
    update(dt: number) {
      dt = Math.min(Math.max(dt, 0), 0.1);
      time += dt;
      // Suspension spring.
      bounceV += (-140 * bounceY - 9 * bounceV) * dt;
      bounceY += bounceV * dt;
      const rumble = engine || siren ? Math.sin(time * 38) * 0.01 + Math.sin(time * 23) * 0.006 : 0;
      chassis.position.y = bounceY + rumble;
      chassis.rotation.x = rumble * 0.4;
      chassis.rotation.z = -bounceY * 0.12;
      // Drive-off: ease-in along +X with a little nose-up squat while accelerating.
      mover.position.x = depart * depart * 28;
      chassis.rotation.z += depart > 0 && depart < 1 ? 0.04 * (1 - depart) : 0;
      // Beacon.
      beacon.visible = true;
      if (siren) {
        beacon.rotation.y = time * 9;
        const flash = 0.5 + 0.5 * Math.sin(time * 18);
        beaconMat.emissive.copy(teamColor).multiplyScalar(0.6 + flash * 1.4);
        beacon.scale.setScalar(1 + flash * 0.08);
      } else {
        beaconMat.emissive.setRGB(0, 0, 0);
        beacon.scale.setScalar(1);
      }
    },
    dispose() {
      highlighter.dispose();
      beaconMat.dispose();
      root.removeFromParent();
    },
  };
}

export function disposeVanCache(): void {
  for (const g of cache.values()) {
    g.body.dispose();
    g.wheels.dispose();
    g.beacon.dispose();
  }
  cache.clear();
}
