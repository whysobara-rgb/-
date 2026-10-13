/**
 * Bank interior dressing (all wall-mounted or hanging: the floor stays gameplay-clear, nothing
 * down there suggests a collider). Builders write into a wall frame (PartBuilder transform
 * already at the wall center, +x along the wall, +z outward, interior face at z = zi facing -z).
 *
 * Every wall gets dressed because the banks rotate in play (any wall can end up facing the
 * camera as the "back wall" of the dollhouse cut): vault door, teller window with a counter
 * ledge and service bell, safety-deposit wall, gold-bar and money-bag niches, hanging planters,
 * sconces, CCTV brackets, the clock and the cat-banker portrait frame (its canvas is a separate
 * textured quad, see bank.ts).
 */
import * as THREE from 'three';
import { PAL } from './palette';
import { G, PartBuilder } from './geometry';

/** Interior faces point toward -z in the wall frame. */
const IN = -1;

/** Big round vault door: thick ring, bolts, gold wheel and hinge. Radius ~0.66 m. */
export function addVaultDoor(b: PartBuilder, u: number, y: number, z: number): void {
  const dir = IN;
  const r = 0.64;
  // Recessed steel ring + frame.
  b.add(G.cyl(1, 1, 36), { color: '#4F5668', pos: [u, y, z + dir * 0.015], rot: [Math.PI / 2, 0, 0], scale: [r + 0.12, 0.03, r + 0.12] });
  b.add(G.torus(0.14, 8, 36), { color: PAL.steel, pos: [u, y, z + dir * 0.04], scale: [r + 0.05, r + 0.05, 0.35] });
  b.add(G.cyl(1, 1, 36), { color: PAL.vault, pos: [u, y, z + dir * 0.06], rot: [Math.PI / 2, 0, 0], scale: [r, 0.06, r] });
  // Concentric machined rings.
  for (const k of [0.82, 0.6, 0.38]) b.add(G.torus(0.05, 6, 32), { color: k === 0.6 ? '#DCE1EA' : PAL.steel, pos: [u, y, z + dir * 0.092], scale: [r * k, r * k, 0.3] });
  // Locking bolts around the rim.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    b.add(G.cyl(1, 1, 10), { color: PAL.silver, pos: [u + Math.cos(a) * r * 0.93, y + Math.sin(a) * r * 0.93, z + dir * 0.1], rot: [Math.PI / 2, 0, 0], scale: [0.032, 0.03, 0.032], emissive: 0.05 });
  }
  // Gold wheel (5 spokes with ball ends) + hub.
  b.add(G.torus(0.12, 8, 30), { color: PAL.gold, pos: [u, y, z + dir * 0.15], scale: [0.26, 0.26, 0.3], emissive: 0.12 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    b.add(G.cyl(1, 1, 8), { color: PAL.gold, pos: [u + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, z + dir * 0.15], rot: [0, 0, a + Math.PI / 2], scale: [0.02, 0.3, 0.02], emissive: 0.1 });
    b.add(G.sphere(10, 8), { color: PAL.goldLight, pos: [u + Math.cos(a) * 0.36, y + Math.sin(a) * 0.36, z + dir * 0.15], scale: 0.045, emissive: 0.2 });
  }
  b.add(G.cyl(1, 1, 18), { color: PAL.goldDark, pos: [u, y, z + dir * 0.15], rot: [Math.PI / 2, 0, 0], scale: [0.08, 0.06, 0.08], emissive: 0.1 });
  // Dial + hinge.
  b.add(G.cyl(1, 1, 20), { color: '#FFFBF0', pos: [u - 0.36, y + 0.34, z + dir * 0.1], rot: [Math.PI / 2, 0, 0], scale: [0.08, 0.02, 0.08], emissive: 0.1 });
  b.add(G.box(), { color: '#E8505B', pos: [u - 0.36, y + 0.38, z + dir * 0.112], scale: [0.012, 0.05, 0.01] });
  for (const dy of [-0.32, 0.32]) b.add(G.rbox(0.14, 0.26, 0.12, 0.03), { color: '#4F5668', pos: [u + r + 0.1, y + dy, z + dir * 0.07] });
  // "Do not touch" stripe plate under the door.
  b.add(G.rbox(0.62, 0.1, 0.03, 0.02), { color: '#FFD84D', pos: [u, y - r - 0.2, z + dir * 0.02] });
  for (let i = 0; i < 4; i++) b.add(G.box(), { color: PAL.ink, pos: [u - 0.22 + i * 0.15, y - r - 0.2, z + dir * 0.038], rot: [0, 0, 0.7], scale: [0.04, 0.12, 0.005] });
}

/** Teller window with bars, a shallow counter ledge above head height and a service bell. */
export function addTellerStation(b: PartBuilder, u: number, z: number): void {
  const dir = IN;
  // Back panel + window.
  b.add(G.rbox(1.7, 1.25, 0.05, 0.03), { color: '#3E8F80', pos: [u, 1.72, z + dir * 0.02] });
  b.add(G.box(), { color: '#BFE3F2', pos: [u, 1.78, z + dir * 0.048], scale: [1.4, 0.82, 0.01], emissive: 0.35 });
  // A tiny clerk silhouette behind the glass (the bank is staffed!).
  b.add(G.sphere(12, 8), { color: '#6E7FA6', pos: [u - 0.3, 1.7, z + dir * 0.052], scale: [0.16, 0.15, 0.005] });
  b.add(G.dome(12, 6), { color: '#6E7FA6', pos: [u - 0.3, 1.42, z + dir * 0.052], scale: [0.24, 0.18, 0.005] });
  for (const s of [-1, 1]) b.add(G.sphere(8, 6), { color: '#6E7FA6', pos: [u - 0.3 + s * 0.1, 1.84, z + dir * 0.052], scale: [0.05, 0.06, 0.005] });
  for (let i = 0; i < 8; i++) b.add(G.cyl(1, 1, 6), { color: PAL.gold, pos: [u - 0.63 + i * 0.18, 1.78, z + dir * 0.062], scale: [0.014, 0.82, 0.014], emissive: 0.08 });
  // Arched top with coin.
  b.add(G.torus(0.09, 6, 18, Math.PI), { color: PAL.gold, pos: [u, 2.22, z + dir * 0.04], scale: [0.86, 0.3, 0.4] });
  b.add(G.cyl(1, 1, 18), { color: PAL.gold, pos: [u, 2.45, z + dir * 0.05], rot: [Math.PI / 2, 0, 0], scale: [0.12, 0.03, 0.12], emissive: 0.15 });
  // Counter ledge (wall-mounted, underside 1.12 m: clears raccoon heads).
  b.add(G.rbox(1.9, 0.09, 0.26, 0.03), { color: PAL.wood, pos: [u, 1.2, z + dir * 0.13] });
  b.add(G.rbox(1.9, 0.05, 0.28, 0.02), { color: PAL.gold, pos: [u, 1.255, z + dir * 0.13], emissive: 0.05 });
  for (const s of [-0.7, 0, 0.7]) b.add(G.rbox(0.05, 0.08, 0.18, 0.015), { color: PAL.goldDark, pos: [u + s, 1.17, z + dir * 0.1], rot: [0.3, 0, 0] });
  // Service bell, pen holder, little nameplate.
  b.add(G.cyl(1, 1, 14), { color: PAL.steelDark, pos: [u + 0.55, 1.29, z + dir * 0.14], scale: [0.07, 0.015, 0.07] });
  b.add(G.dome(14, 8), { color: PAL.goldLight, pos: [u + 0.55, 1.296, z + dir * 0.14], scale: [0.06, 0.055, 0.06], emissive: 0.25 });
  b.add(G.sphere(8, 6), { color: PAL.goldDark, pos: [u + 0.55, 1.355, z + dir * 0.14], scale: 0.014 });
  b.add(G.cyl(1, 1, 10), { color: '#4F4A7A', pos: [u - 0.6, 1.33, z + dir * 0.14], scale: [0.03, 0.09, 0.03] });
  b.add(G.cyl(1, 1, 6), { color: '#E8505B', pos: [u - 0.59, 1.4, z + dir * 0.145], rot: [0, 0, 0.2], scale: [0.008, 0.08, 0.008] });
  b.add(G.rbox(0.3, 0.07, 0.04, 0.01), { color: '#FFF6E6', pos: [u - 0.1, 1.31, z + dir * 0.2], rot: [-0.35, 0, 0] });
  b.add(G.box(), { color: PAL.ink, pos: [u - 0.1, 1.31, z + dir * 0.222], rot: [-0.35, 0, 0], scale: [0.2, 0.012, 0.004] });
}

/** Safety-deposit wall: brass-bordered grid of little doors, a couple left ajar. */
export function addDepositBoxes(b: PartBuilder, u: number, y: number, z: number, cols = 5, rows = 4): void {
  const dir = IN;
  const cw = 0.27;
  const ch = 0.24;
  const W = cols * cw + 0.12;
  const H = rows * ch + 0.12;
  b.add(G.rbox(W + 0.08, H + 0.08, 0.06, 0.03), { color: PAL.goldDark, pos: [u, y, z + dir * 0.02] });
  b.add(G.rbox(W, H, 0.07, 0.025), { color: '#8C93A8', pos: [u, y, z + dir * 0.04] });
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = u - (cols * cw) / 2 + (i + 0.5) * cw;
      const yy = y - (rows * ch) / 2 + (j + 0.5) * ch;
      const ajar = (i === 1 && j === 2) || (i === 3 && j === 0);
      if (ajar) {
        // Open box: dark hole + a glint of gold inside, door swung out.
        b.add(G.box(), { color: '#2E2A36', pos: [x, yy, z + dir * 0.077], scale: [cw - 0.05, ch - 0.05, 0.005] });
        b.add(G.sphere(8, 6), { color: PAL.gold, pos: [x, yy - 0.03, z + dir * 0.08], scale: [0.05, 0.03, 0.02], emissive: 0.35 });
        b.add(G.rbox(cw - 0.05, ch - 0.05, 0.02, 0.008), { color: '#C3C9D6', pos: [x + cw * 0.5, yy, z + dir * 0.17], rot: [0, 1.25, 0] });
      } else {
        b.add(G.rbox(cw - 0.04, ch - 0.04, 0.02, 0.008), { color: (i + j) % 2 ? '#C3C9D6' : '#D3D8E3', pos: [x, yy, z + dir * 0.085] });
        b.add(G.cyl(1, 1, 8), { color: PAL.gold, pos: [x + cw * 0.28, yy, z + dir * 0.1], rot: [Math.PI / 2, 0, 0], scale: [0.018, 0.02, 0.018], emissive: 0.15 });
        b.add(G.box(), { color: '#FFF6E6', pos: [x - 0.03, yy + 0.05, z + dir * 0.097], scale: [0.09, 0.03, 0.004] });
      }
    }
  }
  // Brass plaque on top.
  b.add(G.rbox(0.6, 0.12, 0.03, 0.02), { color: PAL.gold, pos: [u, y + H / 2 + 0.14, z + dir * 0.03], emissive: 0.1 });
  b.add(G.box(), { color: PAL.goldDark, pos: [u, y + H / 2 + 0.14, z + dir * 0.047], scale: [0.44, 0.03, 0.004] });
}

/** Recessed wall niche (above head height) with stacked gold bars or money bags. */
export function addNiche(b: PartBuilder, u: number, y: number, z: number, w: number, kind: 'gold' | 'bags' | 'coins'): void {
  const dir = IN;
  const h = 0.62;
  // Frame + dark back (reads as a recess) + lit lip.
  b.add(G.rbox(w + 0.12, h + 0.12, 0.05, 0.03), { color: PAL.column, pos: [u, y, z + dir * 0.02] });
  b.add(G.box(), { color: '#5A3F4E', pos: [u, y, z + dir * 0.046], scale: [w, h, 0.005] });
  b.add(G.torus(0.08, 6, 16, Math.PI), { color: PAL.column, pos: [u, y + h / 2, z + dir * 0.03], scale: [w / 2 + 0.06, 0.16, 0.4] });
  b.add(G.rbox(w + 0.04, 0.05, 0.2, 0.015), { color: PAL.stone, pos: [u, y - h / 2 + 0.03, z + dir * 0.1] });
  const base = y - h / 2 + 0.06;
  if (kind === 'gold') {
    // Pyramid of gold bars.
    const bw = 0.17;
    const rows = [3, 2, 1];
    rows.forEach((n, r) => {
      for (let i = 0; i < n; i++) {
        const x = u + (i - (n - 1) / 2) * (bw + 0.015);
        b.add(G.rbox(bw, 0.065, 0.11, 0.015), { color: r % 2 ? PAL.goldLight : PAL.gold, pos: [x, base + 0.035 + r * 0.07, z + dir * 0.11], emissive: 0.32 });
      }
    });
  } else if (kind === 'bags') {
    for (const [dx, s] of [
      [-0.12, 1],
      [0.1, 0.85],
    ] as const) {
      b.add(G.sphere(14, 10), { color: '#D9C2A4', pos: [u + dx, base + 0.12 * s, z + dir * 0.12], scale: [0.13 * s, 0.13 * s, 0.1] });
      b.add(G.cyl(0.6, 1, 10), { color: '#C4A984', pos: [u + dx, base + 0.24 * s, z + dir * 0.12], scale: [0.045 * s, 0.07, 0.045 * s] });
      b.add(G.torus(0.3, 6, 12), { color: '#8C5E3B', pos: [u + dx, base + 0.21 * s, z + dir * 0.12], rot: [Math.PI / 2, 0, 0], scale: 0.05 * s });
      // Coin sign stamped on the bag.
      b.add(G.cyl(1, 1, 14), { color: PAL.gold, pos: [u + dx, base + 0.11 * s, z + dir * 0.2], rot: [Math.PI / 2, 0, 0], scale: [0.05 * s, 0.01, 0.05 * s], emissive: 0.25 });
    }
  } else {
    // Coin towers.
    for (const [dx, n] of [
      [-0.13, 5],
      [0, 8],
      [0.13, 4],
    ] as const) {
      for (let i = 0; i < n; i++) b.add(G.cyl(1, 1, 14), { color: i % 2 ? PAL.gold : PAL.goldLight, pos: [u + dx, base + 0.015 + i * 0.028, z + dir * 0.11], scale: [0.05, 0.024, 0.05], emissive: 0.3 });
    }
  }
}

/** Hanging planter on a wall bracket (corners): pot, trailing leaves and a few flowers. */
export function addHangingPlanter(b: PartBuilder, u: number, y: number, z: number, seed: number): void {
  const dir = IN;
  b.add(G.rbox(0.05, 0.05, 0.36, 0.015), { color: PAL.goldDark, pos: [u, y + 0.42, z + dir * 0.18] });
  b.add(G.cyl(1, 1, 6), { color: PAL.goldDark, pos: [u, y + 0.24, z + dir * 0.34], scale: [0.008, 0.36, 0.008] });
  b.add(G.cyl(1, 0.7, 14), { color: '#D98A6A', pos: [u, y, z + dir * 0.34], scale: [0.15, 0.17, 0.15] });
  b.add(G.torus(0.2, 6, 16), { color: '#C2705A', pos: [u, y + 0.085, z + dir * 0.34], rot: [Math.PI / 2, 0, 0], scale: 0.15 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + seed;
    const fall = (i % 3) * 0.12;
    b.add(G.ico(1), { color: i % 2 ? PAL.leaf : PAL.leafDark, pos: [u + Math.cos(a) * 0.15, y + 0.1 - fall, z + dir * (0.34 + Math.sin(a) * 0.15)], scale: [0.09, 0.12 + fall * 0.4, 0.09], sway: 0.25 });
  }
  b.add(G.ico(1), { color: PAL.leafLight, pos: [u, y + 0.16, z + dir * 0.34], scale: [0.16, 0.1, 0.16], sway: 0.2 });
  for (let i = 0; i < 3; i++) {
    const a = seed * 2 + i * 2.1;
    b.add(G.ico(0), { color: PAL.flowers[(i + Math.round(seed * 3)) % PAL.flowers.length], pos: [u + Math.cos(a) * 0.1, y + 0.2, z + dir * (0.34 + Math.sin(a) * 0.1)], scale: 0.045, emissive: 0.05 });
  }
}

/** Ornate portrait frame (the canvas itself is a textured quad placed by the bank rig). */
export function addPortraitFrame(b: PartBuilder, u: number, y: number, z: number, w: number, h: number): void {
  const dir = IN;
  b.add(G.rbox(w + 0.26, h + 0.26, 0.06, 0.04), { color: PAL.goldDark, pos: [u, y, z + dir * 0.02] });
  b.add(G.rbox(w + 0.16, h + 0.16, 0.06, 0.03), { color: PAL.gold, pos: [u, y, z + dir * 0.035], emissive: 0.1 });
  // Corner rosettes + crest knob on top.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) b.add(G.sphere(10, 8), { color: PAL.goldLight, pos: [u + sx * (w / 2 + 0.08), y + sy * (h / 2 + 0.08), z + dir * 0.07], scale: 0.05, emissive: 0.2 });
  b.add(G.star(5, 0.5, 0.3), { color: PAL.goldLight, pos: [u, y + h / 2 + 0.2, z + dir * 0.05], scale: 0.1, emissive: 0.15 });
  // Little picture light above.
  b.add(G.rbox(w * 0.6, 0.05, 0.08, 0.02), { color: PAL.goldDark, pos: [u, y + h / 2 + 0.36, z + dir * 0.1] });
  b.add(G.box(), { color: '#FFF1C2', pos: [u, y + h / 2 + 0.33, z + dir * 0.12], scale: [w * 0.55, 0.012, 0.03], emissive: 1.4 });
}

/** Wall clock (gold rim, roman-ish ticks, hands at "heist o'clock"). */
export function addClock(b: PartBuilder, u: number, y: number, z: number): void {
  const dir = IN;
  b.add(G.cyl(1, 1, 28), { color: PAL.gold, pos: [u, y, z + dir * 0.03], rot: [Math.PI / 2, 0, 0], scale: [0.32, 0.05, 0.32] });
  b.add(G.cyl(1, 1, 28), { color: '#FFFBF0', pos: [u, y, z + dir * 0.05], rot: [Math.PI / 2, 0, 0], scale: [0.26, 0.02, 0.26], emissive: 0.2 });
  b.add(G.box(), { color: PAL.ink, pos: [u, y + 0.08, z + dir * 0.065], scale: [0.025, 0.16, 0.01] });
  b.add(G.box(), { color: PAL.ink, pos: [u + 0.05, y - 0.02, z + dir * 0.065], rot: [0, 0, 0.9], scale: [0.11, 0.022, 0.01] });
  b.add(G.sphere(8, 6), { color: '#E8505B', pos: [u, y, z + dir * 0.07], scale: 0.02 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(G.box(), { color: i % 3 === 0 ? PAL.ink : PAL.goldDark, pos: [u + Math.cos(a) * 0.21, y + Math.sin(a) * 0.21, z + dir * 0.062], rot: [0, 0, a], scale: [i % 3 === 0 ? 0.05 : 0.03, 0.014, 0.01] });
  }
}

/** Wall sconce (warm bulb). */
export function addSconce(b: PartBuilder, u: number, y: number, z: number): void {
  const dir = IN;
  b.add(G.rbox(0.12, 0.2, 0.04, 0.02), { color: PAL.goldDark, pos: [u, y, z] });
  b.add(G.cyl(1, 1, 8), { color: PAL.goldDark, pos: [u, y + 0.06, z + dir * 0.08], rot: [Math.PI / 2, 0, 0], scale: [0.02, 0.14, 0.02] });
  b.add(G.cyl(0.6, 1, 12), { color: '#FFF6E6', pos: [u, y + 0.2, z + dir * 0.15], scale: [0.09, 0.1, 0.09], emissive: 0.7 });
  b.add(G.sphere(12, 8), { color: '#FFE6A8', pos: [u, y + 0.14, z + dir * 0.15], scale: [0.07, 0.08, 0.07], emissive: 1.6 });
}

/** CCTV bracket + camera body (static part; the view does not need it animated). */
export function addCctv(b: PartBuilder, u: number, y: number, z: number, yaw: number): void {
  const dir = IN;
  b.add(G.rbox(0.12, 0.12, 0.04, 0.02), { color: '#DCE1EA', pos: [u, y, z + dir * 0.02] });
  b.add(G.cyl(1, 1, 8), { color: '#9AA3B6', pos: [u, y, z + dir * 0.12], rot: [Math.PI / 2, 0, 0], scale: [0.02, 0.2, 0.02] });
  b.push([u, y - 0.03, z + dir * 0.24], [0.45, yaw, 0]);
  b.add(G.rbox(0.13, 0.12, 0.3, 0.04), { color: '#F4F6FA', pos: [0, 0, 0] });
  b.add(G.rbox(0.15, 0.03, 0.34, 0.012), { color: '#DCE1EA', pos: [0, 0.075, 0.02] });
  b.add(G.cyl(1, 1, 14), { color: PAL.ink, pos: [0, 0, -0.16], rot: [Math.PI / 2, 0, 0], scale: [0.045, 0.03, 0.045] });
  b.add(G.sphere(8, 6), { color: '#5FA8FF', pos: [0, 0, -0.176], scale: [0.025, 0.025, 0.01], emissive: 0.8 });
  b.add(G.sphere(6, 4), { color: '#FF3B4E', pos: [0.045, 0.04, -0.15], scale: 0.014, emissive: 2.2 });
  b.pop();
}

/** Pendant ceiling lantern hanging from a skylight rafter at (x, top, z) (bank local). */
export function addPendantLamp(b: PartBuilder, x: number, top: number, z: number): void {
  const y = 2.85;
  b.add(G.cyl(1, 1, 6), { color: PAL.goldDark, pos: [x, (top + y) / 2 + 0.08, z], scale: [0.012, top - y - 0.16, 0.012] });
  b.add(G.dome(14, 6), { color: PAL.gold, pos: [x, y + 0.1, z], scale: [0.15, 0.1, 0.15], emissive: 0.15 });
  b.add(G.torus(0.12, 6, 18), { color: PAL.goldDark, pos: [x, y + 0.1, z], rot: [Math.PI / 2, 0, 0], scale: 0.15 });
  b.add(G.sphere(10, 8), { color: '#FFE6A8', pos: [x, y + 0.04, z], scale: [0.08, 0.07, 0.08], emissive: 1.3 });
  b.add(G.ico(0), { color: '#E8F6FF', pos: [x, y - 0.06, z], scale: [0.03, 0.05, 0.03], emissive: 0.7 });
}

/** Little wanted-poster board frame (the poster canvas is textured; see bank.ts). */
export function addPosterBacking(b: PartBuilder, u: number, y: number, z: number, outward: number): void {
  b.add(G.rbox(0.62, 0.76, 0.03, 0.01), { color: '#8C5E3B', pos: [u, y, z + outward * 0.02] });
  for (const sx of [-1, 1]) b.add(G.sphere(6, 4), { color: '#E8505B', pos: [u + sx * 0.22, y + 0.3, z + outward * 0.045], scale: 0.02 });
}

export const BANK_INTERIOR_COLORS = {
  cutCap: new THREE.Color('#E79A86'),
  cutEdge: new THREE.Color('#FFF3DE'),
};
