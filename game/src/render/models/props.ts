/**
 * Content 2.0 props (C7a): 동전 ATM, 대왕 돼지저금통, 돈나무, 황금 금고 (loot rigs, SafeRig
 * compatible so the view's safe pipeline — interpolation, uproot lift / strain, highlights,
 * recovery flights — drives them unchanged), the two breakables (나무 상자, 꿀꺽 자판기), and the
 * shared coin art (paw-embossed 동전 and 지폐 다발 geometry used by render/coins.ts and the
 * effects' coin particles).
 *
 * Readability (doc §13, ART §3): every prop has its own silhouette at the high game camera and a
 * team-neutral palette (no team orange / blue on big surfaces):
 *  - ATM: a tall cream kiosk with a raspberry header, a hooded screen and a coin hopper window
 *    whose stack shrinks as coins spurt out; "잔액 부족?!" on the screen when empty.
 *  - 돼지: a big round pink piggy bank (snout, ears, coin slot, curly tail); crack decals per crack
 *    and a broken bowl once smashed.
 *  - 돈나무: a fan-shaped money tree (canopy wide along local x, thin along z, matching its
 *    2.4 x 0.8 collider) in a planter bed; bill bundles hang in the canopy (one cluster per
 *    remaining bundle) and flutter off when it sheds; a root ball shows once it is uprooted.
 *  - 황금 금고: a chunky gold vault with a round door, gem crest and glints.
 *  - Coins: our own design (ART §3) — a round coin with a raised rim and an embossed raccoon paw
 *    (one pad + four toe beans); never a vertically grooved gold oval.
 *
 * Frame: local +X = sim local x, local +Z = sim local y (the front faces local +Z, toward the
 * camera at angle 0). Place with placeOnSim().
 */
import * as THREE from 'three';
import type { BreakableKind, PropVariant, Vec2 } from '../../sim/types';
import { BREAKABLE_SPECS, PROP_SPECS } from '../../sim/config';
import { PAL } from './palette';
import { G, PartBuilder, rng, taperedTube } from './geometry';
import { createToonMaterial, matTextured, matVC } from './materials';
import { blobShadowTexture, makeCanvasTexture, outlinedText, roundRectPath, valueCoinTexture, FONT_STACK } from './textures';
import { Highlighter, InkOutline } from './outline';
import { cameraFacingYaw, trackViewCamera } from './occlusion';
import type { SafeRig } from './safes';

// ===========================================================================
// Shared coin art
// ===========================================================================

export const COIN_ART = {
  /** Coin radius / thickness (m). */
  radius: 0.15,
  thickness: 0.045,
  gold: '#F6C64F',
  goldDark: '#C88F25',
  goldLight: '#FFE7A1',
  bill: '#BFE8B0',
  billDark: '#4E9A63',
} as const;

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Add one paw coin (lying flat, centered at the origin of the current transform). */
function addPawCoin(b: PartBuilder, r: number, t: number, bright = 1): void {
  const gold = new THREE.Color(COIN_ART.gold).multiplyScalar(bright);
  const dark = new THREE.Color(COIN_ART.goldDark).multiplyScalar(bright);
  // Body + raised rim (both faces) — the round rim is part of the design.
  b.add(G.cyl(1, 1, 22), { color: dark, scale: [r, t, r] });
  for (const s of [1, -1]) {
    b.add(G.torus(0.16, 6, 24), { color: gold, pos: [0, (s * t) / 2, 0], rot: [Math.PI / 2, 0, 0], scale: [r * 0.88, r * 0.88, r * 0.7], emissive: 0.12 });
    b.add(G.cyl(1, 1, 20), { color: gold, pos: [0, (s * t) / 2, 0], scale: [r * 0.8, 0.004, r * 0.8], emissive: 0.1 });
    // Embossed paw: one pad + four toe beans (slightly darker relief).
    const y = (s * t) / 2 + s * 0.006;
    b.add(G.sphere(10, 6), { color: dark, pos: [0, y, r * 0.18], scale: [r * 0.3, 0.012, r * 0.25], emissive: 0.05 });
    for (const [dx, dz] of [
      [-0.34, -0.12],
      [-0.12, -0.36],
      [0.12, -0.36],
      [0.34, -0.12],
    ] as const) {
      b.add(G.sphere(8, 5), { color: dark, pos: [dx * r, y, dz * r], scale: [r * 0.12, 0.01, r * 0.12], emissive: 0.05 });
    }
  }
}

/** A single paw coin, lying flat (y = thickness axis), radius COIN_ART.radius. */
export function pawCoinGeometry(): THREE.BufferGeometry {
  return cachedGeo('pawCoin', () => {
    const b = new PartBuilder();
    addPawCoin(b, COIN_ART.radius, COIN_ART.thickness);
    return b.merge('vc')!;
  });
}

/**
 * 동전 10 pile: three paw coins (one flat, one leaning on it, one stacked), ~0.42 m across so it
 * reads at the game camera. Origin on the ground.
 */
export function coinPileGeometry(): THREE.BufferGeometry {
  return cachedGeo('coinPile', () => {
    const r = COIN_ART.radius;
    const t = COIN_ART.thickness;
    const b = new PartBuilder();
    b.push([-0.06, t / 2 + 0.002, 0.03]);
    addPawCoin(b, r, t);
    b.pop();
    b.push([0.0, t * 1.5 + 0.004, -0.0], [0.05, 0.6, -0.04]);
    addPawCoin(b, r, t, 1.04);
    b.pop();
    // Leaning coin (on its rim, tilted against the stack): the edge-on silhouette reads as "coin".
    b.push([0.15, r * 0.8, 0.06], [0.2, -0.5, 1.05]);
    addPawCoin(b, r, t, 1.08);
    b.pop();
    return b.merge('vc')!;
  });
}

/**
 * 지폐 다발 (50): a stack of mint notes tied with a cream paper band (paw stamp). Origin on the
 * ground; long axis local x. The top sheet carries the banknote texture (separate geometry).
 */
export function billBundleGeometry(): THREE.BufferGeometry {
  return cachedGeo('billBundle', () => {
    const b = new PartBuilder();
    const w = 0.5;
    const d = 0.26;
    for (let i = 0; i < 4; i++) {
      const tint = new THREE.Color(COIN_ART.bill).lerp(new THREE.Color('#FFFFFF'), i * 0.06);
      b.add(G.rbox(w, 0.028, d, 0.01), { color: tint, pos: [(i % 2 ? 0.012 : -0.01), 0.016 + i * 0.03, (i % 2 ? -0.008 : 0.01)], rot: [0, (i - 1.5) * 0.05, 0] });
      b.add(G.box(), { color: COIN_ART.billDark, pos: [(i % 2 ? 0.012 : -0.01), 0.016 + i * 0.03, (i % 2 ? -0.008 : 0.01)], rot: [0, (i - 1.5) * 0.05, 0], scale: [w * 1.002, 0.012, d * 0.18] });
    }
    // Paper band with a gold paw seal.
    b.add(G.rbox(0.11, 0.15, d + 0.03, 0.02), { color: '#FFF3DE', pos: [0, 0.07, 0] });
    b.add(G.cyl(1, 1, 16), { color: COIN_ART.gold, pos: [0, 0.147, 0], scale: [0.04, 0.008, 0.04], emissive: 0.15 });
    return b.merge('vc')!;
  });
}

/** Top sheet of a bill bundle (textured with the game's banknote), to lay on billBundleGeometry. */
export function billTopGeometry(): THREE.BufferGeometry {
  return cachedGeo('billTop', () => new THREE.PlaneGeometry(0.48, 0.24).rotateX(-Math.PI / 2).translate(0, 0.123, 0));
}

let billTex: THREE.Texture | null = null;
/**
 * The game's 50 note (a 지폐 다발 is worth 50, so its notes say 50): mint paper, green frame,
 * the paw-print coin roundel, ringed raccoon-tail bands — the same family as banknoteTexture().
 */
export function billNoteTexture(): THREE.Texture {
  if (billTex) return billTex;
  billTex = makeCanvasTexture(
    256,
    128,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#DDF4CB';
      roundRectPath(ctx, 2, 2, w - 4, h - 4, 14);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#3F7F57';
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#7CC08B';
      roundRectPath(ctx, 12, 12, w - 24, h - 24, 9);
      ctx.stroke();
      for (const x0 of [20, w - 44]) {
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 ? '#9CD3A4' : '#4E9A63';
          roundRectPath(ctx, x0, 22 + i * 21, 24, 17, 6);
          ctx.fill();
        }
      }
      const cx = w / 2;
      const cy = h / 2;
      ctx.fillStyle = '#E2A93B';
      ctx.beginPath();
      ctx.arc(cx, cy, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFD45E';
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 30, 0, Math.PI * 2);
      ctx.fill();
      // Big readable value on the roundel (reads at the game camera on a bundle top).
      outlinedText(ctx, '50', cx, cy + 1, 40, '#2F6644', '#FFF6D8', 6, 60);
      ctx.font = `bold 20px ${FONT_STACK}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2F6644';
      ctx.textAlign = 'left';
      ctx.fillText('50', 52, 30);
      ctx.textAlign = 'right';
      ctx.fillText('50', w - 52, h - 28);
    },
    { fontText: '50', anisotropy: 4 },
  );
  return billTex;
}

/** Banknote material (shared, the 50 note). */
export function billTopMaterial(): THREE.Material {
  return matTextured(billNoteTexture(), { rim: 0.3, side: THREE.DoubleSide });
}

// ===========================================================================
// Prop rigs
// ===========================================================================

export interface PropRig extends SafeRig {
  readonly variant: PropVariant;
  /** Collider half extents (grab brackets / labels). */
  readonly footprint: Vec2;
  /** Model height (labels, beacons). */
  readonly height: number;
  /** Coins still inside and the loot's current value (hopper stack, hanging bills, label). */
  setContents(innerValue: number, value: number): void;
  /** Piggy cracks (0..3, 3 = smashed). */
  setCracks(n: number): void;
  /** Visual hit: wobble away from a world direction (radians, null = in place), 0..1+. */
  hit(dir: number | null, strength: number): void;
  /** World velocity (m/s) for lean / sway. */
  setMotion(vx: number, vy: number): void;
  /** ATM spurt (screen flash, receipt), tree shed (bills flutter off). */
  spurt(count?: number): void;
  /** World position of the coin mouth (ATM tray, piggy slot, canopy) into `out`. */
  mouth(out: THREE.Vector3): THREE.Vector3;
}

interface PropGeo {
  body: THREE.BufferGeometry;
  anchors: THREE.BufferGeometry;
  /** Coin label height / z. */
  coinY: number;
  coinZ: number;
  coinR: number;
}

/** Anchor hardware (steel base plate + L brackets with bolts, like the safes). */
function buildAnchors(hx: number, hz: number, perSide: number): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.add(G.rbox(hx * 2 + 0.3, 0.025, hz * 2 + 0.2, 0.012), { color: PAL.steel, pos: [0, 0.0125, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.box(), { color: '#FFD84D', pos: [sx * (hx + 0.1), 0.027, sz * (hz + 0.04)], scale: [0.1, 0.006, 0.05] });
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      const z = perSide === 1 ? 0 : -hz + 0.16 + (i * (hz * 2 - 0.32)) / (perSide - 1);
      const x = sx * (hx + 0.02);
      b.add(G.rbox(0.035, 0.2, 0.13, 0.01), { color: PAL.steelDark, pos: [x, 0.12, z] });
      b.add(G.rbox(0.16, 0.035, 0.13, 0.01), { color: PAL.steelDark, pos: [x + sx * 0.08, 0.04, z] });
      b.add(G.cyl(1, 1, 6), { color: '#FFD84D', pos: [x + sx * 0.1, 0.07, z], scale: [0.032, 0.04, 0.032] });
      b.add(G.cyl(1, 1, 6), { color: '#FFD84D', pos: [x + sx * 0.015, 0.18, z], rot: [0, 0, Math.PI / 2], scale: [0.025, 0.03, 0.025] });
    }
  }
  return b.merge('vc')!;
}

// --- ATM --------------------------------------------------------------------------------

const ATM_COL = { body: '#FFF1DC', shade: '#F1DDC2', header: '#E8507A', headerDark: '#B5345A', dark: '#3A3346', key: ['#FFD45C', '#8FE3C8', '#FF9FBF'] };

function buildAtm(): PropGeo {
  const H = PROP_SPECS.atm.height; // 1.6
  const hx = PROP_SPECS.atm.half.x - 0.05;
  const back = -PROP_SPECS.atm.half.y + 0.03;
  const front = PROP_SPECS.atm.half.y - 0.12;
  const depth = front - back;
  const zc = (front + back) / 2;
  const b = new PartBuilder();
  // Plinth + body + header.
  b.add(G.rbox(hx * 2, 0.1, depth, 0.03), { color: '#5F5A6E', pos: [0, 0.05, zc] });
  b.add(G.rbox(hx * 2 - 0.04, H - 0.38, depth - 0.04, 0.08, 2), { color: ATM_COL.body, pos: [0, 0.1 + (H - 0.38) / 2, zc] });
  b.add(G.rbox(hx * 2 + 0.03, 0.28, depth + 0.04, 0.07, 2), { color: ATM_COL.header, pos: [0, H - 0.14, zc] });
  b.add(G.rbox(hx * 2 - 0.1, 0.03, depth - 0.1, 0.012), { color: '#FF8FA8', pos: [0, H + 0.005, zc] });
  // Side stripes (a toy-like two-tone body).
  for (const sx of [-1, 1]) b.add(G.box(), { color: ATM_COL.shade, pos: [sx * (hx - 0.016), 0.62, zc], scale: [0.012, 0.9, depth - 0.14] });
  // Screen hood + bezel (the screen itself is a textured plane).
  const fz = front;
  b.add(G.rbox(0.78, 0.52, 0.14, 0.05, 2), { color: ATM_COL.headerDark, pos: [0, 1.1, fz + 0.03] });
  b.add(G.rbox(0.68, 0.42, 0.06, 0.03), { color: ATM_COL.dark, pos: [0, 1.1, fz + 0.07] });
  b.add(G.rbox(0.86, 0.06, 0.2, 0.025), { color: ATM_COL.header, pos: [0, 1.38, fz + 0.05] });
  // Keypad shelf (slanted) with 9 chunky keys.
  b.push([0, 0.79, fz + 0.06], [0.42, 0, 0]);
  b.add(G.rbox(0.62, 0.05, 0.2, 0.02), { color: '#E7D3B8' });
  for (let i = 0; i < 9; i++) {
    const kx = ((i % 3) - 1) * 0.1 - 0.12;
    const kz = (Math.floor(i / 3) - 1) * 0.055;
    b.add(G.rbox(0.07, 0.03, 0.04, 0.012), { color: i === 8 ? '#8FE3C8' : i === 6 ? '#FF9FBF' : '#FFFFFF', pos: [kx, 0.035, kz] });
  }
  b.add(G.rbox(0.12, 0.03, 0.12, 0.02), { color: '#FFD45C', pos: [0.18, 0.035, 0] });
  b.pop();
  // Card slot + receipt slot.
  b.add(G.rbox(0.2, 0.05, 0.04, 0.015), { color: '#5F5A6E', pos: [0.2, 0.92, fz + 0.012] });
  b.add(G.box(), { color: PAL.ink, pos: [0.2, 0.92, fz + 0.032], scale: [0.14, 0.012, 0.01] });
  b.add(G.rbox(0.24, 0.04, 0.04, 0.012), { color: '#5F5A6E', pos: [-0.2, 0.92, fz + 0.012] });
  // Coin tray (brass, curved) — the coin mouth.
  b.add(G.rbox(0.4, 0.2, 0.06, 0.04), { color: '#5F5A6E', pos: [0, 0.44, fz + 0.0] });
  b.add(G.cyl(1, 1, 18, false), { color: PAL.goldDark, pos: [0, 0.37, fz + 0.06], rot: [0, 0, Math.PI / 2], scale: [0.07, 0.34, 0.07] });
  b.add(G.box(), { color: PAL.ink, pos: [0, 0.47, fz + 0.033], scale: [0.26, 0.04, 0.01] });
  // Coin hopper windows (both sides): a round porthole; the coin stack inside is a separate mesh.
  for (const sx of [-1, 1]) {
    b.add(G.torus(0.2, 8, 24), { color: ATM_COL.header, pos: [sx * (hx - 0.005), 0.66, zc], rot: [0, Math.PI / 2, 0], scale: [0.2, 0.2, 0.12] });
    b.add(G.cyl(1, 1, 22), { color: '#3A3346', pos: [sx * (hx - 0.03), 0.66, zc], rot: [0, 0, Math.PI / 2], scale: [0.19, 0.02, 0.19] });
  }
  // Little story: a sticky note ("고장 아님") and a paw smudge.
  b.add(G.box(), { color: '#FFE36E', pos: [hx - 0.005, 1.05, zc + 0.2], rot: [0, 0, 0.12], scale: [0.008, 0.14, 0.14] });
  b.add(G.box(), { color: '#C9A43A', pos: [hx - 0.001, 1.07, zc + 0.2], rot: [0, 0, 0.12], scale: [0.004, 0.012, 0.09] });
  b.add(G.box(), { color: '#C9A43A', pos: [hx - 0.001, 1.03, zc + 0.2], rot: [0, 0, 0.12], scale: [0.004, 0.012, 0.07] });
  b.add(G.sphere(8, 6), { color: '#E6CFAF', pos: [-0.3, 0.3, fz + 0.002], scale: [0.04, 0.035, 0.006] });
  for (const dx of [-0.05, -0.017, 0.017, 0.05]) b.add(G.sphere(6, 4), { color: '#E6CFAF', pos: [-0.3 + dx, 0.355, fz + 0.002], scale: [0.013, 0.013, 0.005] });
  return { body: b.merge('vc')!, anchors: buildAnchors(hx, depth / 2, 2), coinY: H + 0.02, coinZ: zc, coinR: 0.36 };
}

type AtmScreen = 'idle' | 'beep' | 'empty';
const ATM_TEXT = {
  ko: { idle: '동전 ATM', beep: '짤랑!', empty: '잔액 부족?!' },
  en: { idle: 'COIN ATM', beep: 'CHA-CHING!', empty: 'LOW FUNDS?!' },
} as const;
const screenTex = new Map<string, THREE.Texture>();
function atmScreenTexture(state: AtmScreen, lang: 'ko' | 'en'): THREE.Texture {
  const key = `${state}|${lang}`;
  let t = screenTex.get(key);
  if (t) return t;
  const text = ATM_TEXT[lang][state];
  t = makeCanvasTexture(
    256,
    160,
    (ctx, w, h) => {
      const bg = state === 'empty' ? '#3B2440' : state === 'beep' ? '#2E5B4F' : '#25404A';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // Scanlines.
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
      if (state === 'empty') {
        // A sad empty coin outline with a question mark-free "?!" face.
        ctx.strokeStyle = '#FF9FBF';
        ctx.lineWidth = 6;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.arc(w / 2, 60, 30, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        outlinedText(ctx, text, w / 2, 124, lang === 'ko' ? 34 : 28, '#FFD3E2', '#2A2131', 6, w - 20);
      } else {
        // Gold paw coin icon.
        const cx = w / 2;
        const cy = state === 'beep' ? 64 : 58;
        ctx.fillStyle = '#C88F25';
        ctx.beginPath();
        ctx.arc(cx, cy, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFD45E';
        ctx.beginPath();
        ctx.arc(cx, cy - 2, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#C98A2A';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 5, 9, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        for (const [dx, dy] of [
          [-10, -6],
          [-3.5, -12],
          [3.5, -12],
          [10, -6],
        ] as const) {
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, 3.6, 0, Math.PI * 2);
          ctx.fill();
        }
        if (state === 'beep') {
          ctx.strokeStyle = '#FFF2A8';
          ctx.lineWidth = 5;
          ctx.lineCap = 'round';
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40);
            ctx.lineTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52);
            ctx.stroke();
          }
        }
        outlinedText(ctx, text, w / 2, 128, lang === 'ko' ? 36 : 28, state === 'beep' ? '#FFF2A8' : '#BFF2E4', '#16252B', 6, w - 20);
      }
    },
    { fontText: text, mipmaps: false },
  );
  screenTex.set(key, t);
  return t;
}

// --- Piggy -------------------------------------------------------------------------------

const PIG = { pink: '#FF9EC0', dark: '#E8739A', light: '#FFC9DC', inner: '#FFB3CB' };
const PIG_BODY = { y: 0.72, rx: 0.6, ry: 0.53, rz: 0.63 };

function buildPiggy(): PropGeo {
  const H = PROP_SPECS.piggy.height; // 1.3
  const b = new PartBuilder();
  const { y, rx, ry, rz } = PIG_BODY;
  b.add(G.sphere(24, 18), { color: PIG.pink, pos: [0, y, 0], scale: [rx, ry, rz] });
  // Belly highlight + painted flowers (a sticker somebody added: little stories).
  b.add(G.sphere(16, 12), { color: PIG.light, pos: [0.05, y - 0.18, 0], scale: [rx * 0.8, ry * 0.55, rz * 0.82] });
  for (const [a, h, c] of [
    [0.7, 0.15, '#FFFFFF'],
    [1.1, -0.05, '#FFD45C'],
    [-0.9, 0.1, '#FFFFFF'],
  ] as const) {
    const px = Math.cos(a) * rx * 0.96;
    const pz = Math.sin(a) * rz * 0.96;
    for (let i = 0; i < 5; i++) {
      const pa = (i / 5) * Math.PI * 2;
      b.add(G.sphere(8, 6), { color: c, pos: [px + Math.cos(pa) * 0.035 * Math.abs(Math.sin(a)), y + h + Math.sin(pa) * 0.035, pz + Math.cos(pa) * 0.035 * Math.abs(Math.cos(a))], scale: 0.026 });
    }
    b.add(G.sphere(8, 6), { color: '#FF6F91', pos: [px * 1.01, y + h, pz * 1.01], scale: 0.022 });
  }
  // Legs.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.cyl(0.85, 1, 14), { color: PIG.dark, pos: [sx * 0.32, 0.13, sz * 0.32], scale: [0.12, 0.26, 0.12] });
    b.add(G.cyl(1, 1, 14), { color: '#C95C82', pos: [sx * 0.32, 0.02, sz * 0.32], scale: [0.125, 0.04, 0.125] });
  }
  // Snout (+x), nostrils.
  b.add(G.cyl(1, 1, 20), { color: PIG.dark, pos: [rx - 0.02, y + 0.02, 0], rot: [0, 0, Math.PI / 2], scale: [0.17, 0.14, 0.17] });
  b.add(G.cyl(1, 1, 20), { color: PIG.inner, pos: [rx + 0.055, y + 0.02, 0], rot: [0, 0, Math.PI / 2], scale: [0.15, 0.01, 0.15] });
  for (const sz of [-1, 1]) b.add(G.sphere(8, 6), { color: '#B24E73', pos: [rx + 0.06, y + 0.03, sz * 0.055], scale: [0.012, 0.045, 0.028] });
  // Eyes + blush.
  for (const sz of [-1, 1]) {
    b.add(G.sphere(10, 8), { color: PAL.ink, pos: [rx * 0.82, y + 0.2, sz * 0.22], scale: [0.04, 0.055, 0.04] });
    b.add(G.sphere(6, 4), { color: '#FFFFFF', pos: [rx * 0.86, y + 0.225, sz * 0.21], scale: 0.014, emissive: 0.4 });
    b.add(G.sphere(8, 6), { color: '#FF7FA6', pos: [rx * 0.78, y + 0.06, sz * 0.36], scale: [0.03, 0.04, 0.06] });
  }
  // Ears.
  for (const sz of [-1, 1]) {
    b.add(G.cone(12), { color: PIG.dark, pos: [0.3, y + ry - 0.02, sz * 0.27], rot: [sz * -0.45, 0, -0.35], scale: [0.11, 0.2, 0.07] });
    b.add(G.cone(12), { color: PIG.inner, pos: [0.32, y + ry - 0.03, sz * 0.275], rot: [sz * -0.45, 0, -0.35], scale: [0.07, 0.15, 0.04] });
  }
  // Coin slot + a gold coin half inserted (reads "piggy bank" from the top camera).
  b.add(G.rbox(0.34, 0.03, 0.08, 0.014), { color: '#B24E73', pos: [-0.06, y + ry - 0.005, 0] });
  b.add(G.box(), { color: PAL.ink, pos: [-0.06, y + ry + 0.008, 0], scale: [0.28, 0.006, 0.03] });
  b.push([-0.06, y + ry + 0.06, 0], [Math.PI / 2, 0, 0]);
  addPawCoin(b, 0.1, 0.03, 1.05);
  b.pop();
  // Curly tail (-x).
  b.add(G.torus(0.28, 8, 18, Math.PI * 1.6), { color: PIG.dark, pos: [-rx - 0.03, y + 0.1, 0], rot: [0, 0, 0.6], scale: [0.07, 0.07, 0.07] });
  return { body: b.merge('vc')!, anchors: new THREE.BufferGeometry(), coinY: H + 0.03, coinZ: 0, coinR: 0.4 };
}

/** Lower half of a smashed piggy (jagged rim). */
function piggyBowlGeometry(): THREE.BufferGeometry {
  return cachedGeo('piggyBowl', () => {
    const { y, rx, ry, rz } = PIG_BODY;
    const b = new PartBuilder();
    const bowl = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
    // Jagged rim: push the top ring vertices up/down.
    const pos = bowl.getAttribute('position') as THREE.BufferAttribute;
    const r = rng(77);
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i);
      if (vy > -0.16) pos.setY(i, vy + (r() - 0.3) * 0.22);
    }
    bowl.computeVertexNormals();
    b.add(bowl, { color: PIG.pink, pos: [0, y, 0], scale: [rx, ry, rz] });
    // Inside (darker, double sided look via an inner shell).
    const inner = bowl.clone();
    inner.scale(-0.96, 0.96, 0.96);
    b.add(inner, { color: '#C95C82', pos: [0, y, 0], scale: [rx, ry, rz] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.add(G.cyl(0.85, 1, 14), { color: PIG.dark, pos: [sx * 0.32, 0.13, sz * 0.32], scale: [0.12, 0.26, 0.12] });
    }
    // Snout chip lying in front.
    b.add(G.cyl(1, 1, 16), { color: PIG.dark, pos: [rx + 0.18, 0.05, 0.12], rot: [0.2, 0.4, 0.1], scale: [0.16, 0.1, 0.16] });
    bowl.dispose();
    inner.dispose();
    return b.merge('vc')!;
  });
}

const crackTexCache = new Map<number, THREE.Texture>();
/** Transparent zig-zag crack decal for the piggy (ink line + white rim). */
function piggyCrackTexture(seed: number): THREE.Texture {
  let t = crackTexCache.get(seed);
  if (t) return t;
  t = makeCanvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const r = rng(seed * 31 + 7);
      const lines: [number, number][][] = [];
      const start: [number, number] = [w * (0.3 + r() * 0.4), h * 0.08];
      const walk = (x: number, y: number, ang: number, len: number, depth: number): void => {
        const pts: [number, number][] = [[x, y]];
        let a = ang;
        let zig = 1;
        for (let i = 0; i < 6; i++) {
          zig = -zig;
          a += zig * (0.45 + r() * 0.35);
          x += Math.cos(a) * len;
          y += Math.sin(a) * len;
          pts.push([x, y]);
          a -= zig * (0.45 + r() * 0.35) * 0.9;
          if (depth < 1 && i === 2 + Math.floor(r() * 2)) walk(x, y, a + zig * 0.9, len * 0.6, depth + 1);
        }
        lines.push(pts);
      };
      walk(start[0], start[1], Math.PI / 2, h * 0.13, 0);
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'round';
      for (const [width, color] of [
        [13, 'rgba(255,255,255,0.95)'],
        [6, '#4A2236'],
      ] as const) {
        ctx.strokeStyle = color;
        for (const pts of lines) {
          ctx.lineWidth = width;
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        }
      }
    },
    { mipmaps: true },
  );
  crackTexCache.set(seed, t);
  return t;
}

// --- Money tree --------------------------------------------------------------------------

const TREE = { trunk: '#9A6B4F', trunkDark: '#7A5039', leaf: '#6CC27A', leafDark: '#4FA563', leafLight: '#9EDB8E', soil: '#7A5A42', bed: '#C08A5A' };
/** Canopy leaf blob centers (local), wide along x, thin along z. */
const TREE_BLOBS: readonly [number, number, number, number][] = [
  [0, 2.25, 0, 0.42],
  [-0.55, 2.05, 0.05, 0.38],
  [0.55, 2.08, -0.04, 0.38],
  [-0.92, 1.72, -0.02, 0.3],
  [0.92, 1.75, 0.03, 0.3],
  [-0.3, 1.7, 0.12, 0.32],
  [0.3, 1.66, -0.1, 0.32],
  [0, 1.95, 0.1, 0.36],
];
/** Where bill bundles hang (one cluster per remaining bundle, up to 4). */
const TREE_BILL_SPOTS: readonly [number, number, number][] = [
  [-0.62, 1.62, 0.28],
  [0.6, 1.66, 0.27],
  [-0.18, 2.0, 0.36],
  [0.25, 1.92, -0.32],
];

function buildTree(): PropGeo {
  const b = new PartBuilder();
  // Trunk: curvy tapered tube + two branches spreading along x.
  const trunk = taperedTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.0, 0), new THREE.Vector3(0.05, 0.6, 0.02), new THREE.Vector3(-0.04, 1.2, 0), new THREE.Vector3(0.0, 1.75, 0)]), (t) => 0.13 - t * 0.06, 14, 8);
  b.add(trunk, { color: TREE.trunk });
  for (const sx of [-1, 1]) {
    const br = taperedTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(sx * 0.4, 1.4, 0.02), new THREE.Vector3(sx * 0.85, 1.62, 0)]), (t) => 0.07 - t * 0.04, 10, 6);
    b.add(br, { color: TREE.trunkDark });
    br.dispose();
  }
  trunk.dispose();
  // Canopy blobs (icosahedra for a chunky toy foliage), flattened along z.
  TREE_BLOBS.forEach(([x, y, z, r], i) => {
    const c = i % 3 === 0 ? TREE.leafLight : i % 3 === 1 ? TREE.leaf : TREE.leafDark;
    b.add(G.ico(1), { color: c, pos: [x, y, z], scale: [r * 1.15, r * 0.9, Math.min(0.38, r * 0.9)], sway: 0.25 });
  });
  // Little coin "fruits" on the canopy (gold glints).
  for (const [x, y, z] of [
    [-0.4, 2.3, 0.2],
    [0.75, 1.95, 0.22],
    [0.1, 2.55, 0.05],
    [-0.8, 1.95, 0.2],
  ] as const) {
    b.push([x, y, z], [Math.PI / 2, 0, 0.3]);
    addPawCoin(b, 0.08, 0.025, 1.06);
    b.pop();
  }
  // Tag on the trunk: "돈나무" plank (little story).
  b.add(G.rbox(0.26, 0.12, 0.03, 0.02), { color: '#FFF3DE', pos: [0.02, 0.85, 0.14], rot: [0, 0, -0.1] });
  b.add(G.box(), { color: TREE.trunkDark, pos: [0.02, 0.93, 0.13], scale: [0.012, 0.06, 0.01] });
  return { body: b.merge('vc')!, anchors: buildTreeBed(), coinY: 2.72, coinZ: 0, coinR: 0.4 };
}

/** Planter bed around the anchored tree (the tree's "anchors": disappears on uproot). */
function buildTreeBed(): THREE.BufferGeometry {
  const hx = PROP_SPECS.moneyTree.half.x;
  const hz = PROP_SPECS.moneyTree.half.y;
  const b = new PartBuilder();
  for (const sz of [-1, 1]) b.add(G.rbox(hx * 2 + 0.16, 0.24, 0.1, 0.035), { color: TREE.bed, pos: [0, 0.12, sz * (hz + 0.03)] });
  for (const sx of [-1, 1]) b.add(G.rbox(0.1, 0.24, hz * 2 + 0.16, 0.035), { color: TREE.bed, pos: [sx * (hx + 0.03), 0.12, 0] });
  b.add(G.rbox(hx * 2, 0.16, hz * 2, 0.04), { color: TREE.soil, pos: [0, 0.09, 0] });
  // Grass tufts + a soil mound around the trunk.
  b.add(G.dome(14, 6), { color: '#6A4E37', pos: [0, 0.16, 0], scale: [0.36, 0.12, 0.3] });
  const r = rng(13);
  for (let i = 0; i < 9; i++) {
    const x = (r() - 0.5) * hx * 1.8;
    const z = (r() - 0.5) * hz * 1.4;
    if (Math.abs(x) < 0.35) continue;
    b.add(G.cone(6), { color: i % 2 ? PAL.grass : PAL.grassDark, pos: [x, 0.22, z], scale: [0.05, 0.14, 0.05], sway: 0.4 });
  }
  return b.merge('vc')!;
}

/** Root ball + dangling roots (visible once uprooted). */
function treeRootGeometry(): THREE.BufferGeometry {
  return cachedGeo('treeRoots', () => {
    const b = new PartBuilder();
    b.add(G.ico(1), { color: TREE.soil, pos: [0, 0.02, 0], scale: [0.36, 0.24, 0.3] });
    b.add(G.ico(1), { color: '#6A4E37', pos: [0.12, -0.04, 0.08], scale: [0.18, 0.13, 0.16] });
    const r = rng(5);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(a) * 0.2, -0.05, Math.sin(a) * 0.18),
        new THREE.Vector3(Math.cos(a) * 0.38, -0.12 - r() * 0.05, Math.sin(a) * 0.32),
        new THREE.Vector3(Math.cos(a + 0.3) * 0.48, -0.16 - r() * 0.1, Math.sin(a + 0.3) * 0.4),
      ]);
      const tube = taperedTube(c, (t) => 0.035 * (1 - t * 0.8), 8, 5);
      b.add(tube, { color: i % 2 ? PAL.root : PAL.rootDark, sway: 0.5 });
      tube.dispose();
    }
    return b.merge('vc')!;
  });
}

/** One hanging bill cluster (3 notes fanned) — textured with the banknote. */
function billClusterGeometry(): THREE.BufferGeometry {
  return cachedGeo('billCluster', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.PlaneGeometry(0.34, 0.17);
      p.translate(0, -0.085, 0);
      p.rotateZ((i - 1) * 0.45);
      p.rotateY((i - 1) * 0.35);
      p.translate((i - 1) * 0.05, 0, i * 0.01);
      parts.push(p);
    }
    const g = mergeSimple(parts);
    for (const p of parts) p.dispose();
    return g;
  });
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Minimal merge for plain position/normal/uv planes (keeps this file free of extra imports).
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const index: number[] = [];
  let o = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position') as THREE.BufferAttribute;
    const na = p.getAttribute('normal') as THREE.BufferAttribute;
    const ua = p.getAttribute('uv') as THREE.BufferAttribute;
    pos.set(pa.array as Float32Array, o * 3);
    nor.set(na.array as Float32Array, o * 3);
    uv.set(ua.array as Float32Array, o * 2);
    if (p.index) for (let i = 0; i < p.index.count; i++) index.push(p.index.getX(i) + o);
    o += pa.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** Merge vertex-coloured part geometries (same attribute layout, as PartBuilder makes them). */
function mergeVc(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(parts[0]!.attributes);
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const g = new THREE.BufferGeometry();
  for (const name of names) {
    const a0 = parts[0]!.getAttribute(name) as THREE.BufferAttribute;
    const out = new Float32Array(n * a0.itemSize);
    let o = 0;
    for (const p of parts) {
      const a = p.getAttribute(name) as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[(o + i) * a0.itemSize + c] = a.getComponent(i, c);
      o += a.count;
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, a0.itemSize, a0.normalized));
  }
  const index: number[] = [];
  let o = 0;
  for (const p of parts) {
    const cnt = p.getAttribute('position').count;
    if (p.index) for (let i = 0; i < p.index.count; i++) index.push(p.index.getX(i) + o);
    else for (let i = 0; i < cnt; i++) index.push(i + o);
    o += cnt;
  }
  g.setIndex(index);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// --- Gold safe ---------------------------------------------------------------------------

const GOLD = { body: '#F6C64F', dark: '#C88F25', light: '#FFE7A1', deep: '#9C6A12', gem: '#FF6F91' };

function buildGoldSafe(): PropGeo {
  const H = PROP_SPECS.goldSafe.height; // 1.4
  const hx = PROP_SPECS.goldSafe.half.x - 0.05;
  const back = -PROP_SPECS.goldSafe.half.y + 0.02;
  const front = PROP_SPECS.goldSafe.half.y - 0.14;
  const depth = front - back;
  const zc = (front + back) / 2;
  const b = new PartBuilder();
  b.add(G.rbox(hx * 2, 0.14, depth, 0.04), { color: GOLD.deep, pos: [0, 0.07, zc] });
  b.add(G.rbox(hx * 2 - 0.04, H - 0.26, depth - 0.04, 0.12, 3), { color: GOLD.body, pos: [0, 0.14 + (H - 0.26) / 2, zc], emissive: 0.08 });
  b.add(G.rbox(hx * 2 + 0.02, 0.12, depth + 0.02, 0.05), { color: GOLD.dark, pos: [0, H - 0.06, zc] });
  b.add(G.rbox(hx * 2 - 0.2, 0.03, depth - 0.2, 0.012), { color: GOLD.light, pos: [0, H + 0.005, zc], emissive: 0.15 });
  // Corner pillars with studs.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.rbox(0.14, H - 0.2, 0.14, 0.05), { color: GOLD.dark, pos: [sx * (hx - 0.06), 0.12 + (H - 0.2) / 2, zc + sz * (depth / 2 - 0.06)] });
    for (const y of [0.4, 0.75, 1.1]) b.add(G.sphere(8, 6), { color: GOLD.light, pos: [sx * (hx - 0.005), y, zc + sz * (depth / 2 - 0.06)], scale: 0.026, emissive: 0.3 });
  }
  // Round vault door with a spoked wheel.
  const fz = front;
  const dy = 0.7;
  b.add(G.cyl(1, 1, 30), { color: GOLD.dark, pos: [0, dy, fz + 0.02], rot: [Math.PI / 2, 0, 0], scale: [0.46, 0.06, 0.46] });
  b.add(G.cyl(1, 1, 30), { color: GOLD.body, pos: [0, dy, fz + 0.05], rot: [Math.PI / 2, 0, 0], scale: [0.4, 0.04, 0.4], emissive: 0.1 });
  b.add(G.torus(0.12, 8, 30), { color: GOLD.light, pos: [0, dy, fz + 0.075], scale: [0.36, 0.36, 0.36], emissive: 0.2 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(G.cyl(1, 1, 8), { color: GOLD.deep, pos: [Math.cos(a) * 0.12, dy + Math.sin(a) * 0.12, fz + 0.12], rot: [0, 0, a + Math.PI / 2], scale: [0.02, 0.24, 0.02] });
    b.add(G.sphere(10, 8), { color: GOLD.light, pos: [Math.cos(a) * 0.26, dy + Math.sin(a) * 0.26, fz + 0.12], scale: 0.04, emissive: 0.3 });
  }
  b.add(G.cyl(1, 1, 16), { color: GOLD.deep, pos: [0, dy, fz + 0.12], rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.06, 0.07] });
  // Gem crest on the crown (a faceted pink gem in a gold claw): reads "special" from above.
  b.add(G.cyl(1, 0.7, 6), { color: GOLD.dark, pos: [0, H + 0.04, zc], scale: [0.16, 0.08, 0.16] });
  b.add(G.ico(0), { color: GOLD.gem, pos: [0, H + 0.14, zc], scale: [0.13, 0.12, 0.13], emissive: 0.35 });
  return { body: b.merge('vc')!, anchors: buildAnchors(hx, depth / 2, 3), coinY: H + 0.02, coinZ: zc + 0.3, coinR: 0.3 };
}

// --- Rig factory -------------------------------------------------------------------------

const propGeoCache = new Map<PropVariant, PropGeo>();
function propGeo(v: PropVariant): PropGeo {
  let g = propGeoCache.get(v);
  if (!g) {
    g = v === 'atm' ? buildAtm() : v === 'piggy' ? buildPiggy() : v === 'moneyTree' ? buildTree() : buildGoldSafe();
    propGeoCache.set(v, g);
  }
  return g;
}

let blobGeo: THREE.BufferGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;
function blob(): THREE.Mesh {
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
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.position.y = 0.01;
  m.userData.noOutline = true;
  m.renderOrder = -1;
  return m;
}

const POP = { time: 0.7, height: 0.4 };
const _wq = new THREE.Quaternion();
const _we = new THREE.Euler();
const _v = new THREE.Vector3();
const _bm = new THREE.Matrix4();
const _bq = new THREE.Quaternion();
const _be = new THREE.Euler();
const _bp = new THREE.Vector3();
const _bs = new THREE.Vector3();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

/** ATM receipt streamer: segments (each a full receipt slip), slot position offset. */
const RECEIPT = { segs: 6, w: 0.16, h: 0.1, step: 0.095 } as const;

/** One mesh for the whole receipt chain: positions rewritten per frame, drawRange = shown slips. */
function receiptStripGeometry(): THREE.BufferGeometry {
  const n = RECEIPT.segs;
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
  const nor = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  nor.setUsage(THREE.DynamicDrawUsage);
  const uv = new Float32Array(n * 4 * 2);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    // Corners: top-left, top-right, bottom-left, bottom-right (PlaneGeometry's uv layout).
    uv.set([0, 1, 1, 1, 0, 0, 1, 0], i * 8);
    const k = i * 4;
    idx.push(k, k + 2, k + 1, k + 2, k + 3, k + 1);
  }
  g.setAttribute('position', pos);
  g.setAttribute('normal', nor);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.3, 0), 0.7);
  return g;
}

/**
 * Pose the receipt chain (slip i hangs from slip i-1 and bends by `angle(i)` about x, as a chain
 * of nested planes would) into the strip geometry; origin = the top of the first slip.
 */
function poseReceiptStrip(g: THREE.BufferGeometry, angle: (i: number) => number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const pa = pos.array as Float32Array;
  const na = nor.array as Float32Array;
  const hw = RECEIPT.w / 2;
  let y = 0;
  let z = 0;
  let a = 0;
  for (let i = 0; i < RECEIPT.segs; i++) {
    a += angle(i);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    // Local (0, -h, 0) rotated about x by a: (0, -h c, -h s); normal (0, 0, 1) -> (0, -s, c).
    const by = y - RECEIPT.h * c;
    const bz = z - RECEIPT.h * sn;
    const o = i * 12;
    pa[o] = -hw;
    pa[o + 1] = y;
    pa[o + 2] = z;
    pa[o + 3] = hw;
    pa[o + 4] = y;
    pa[o + 5] = z;
    pa[o + 6] = -hw;
    pa[o + 7] = by;
    pa[o + 8] = bz;
    pa[o + 9] = hw;
    pa[o + 10] = by;
    pa[o + 11] = bz;
    for (let v = 0; v < 4; v++) {
      na[o + v * 3] = 0;
      na[o + v * 3 + 1] = -sn;
      na[o + v * 3 + 2] = c;
    }
    y -= RECEIPT.step * c;
    z -= RECEIPT.step * sn;
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
}

/** Create a prop loot rig (SafeRig compatible). `lang` picks the ATM screen text. */
export function createPropRig(variant: PropVariant, lang: 'ko' | 'en' = 'ko'): PropRig {
  const spec = PROP_SPECS[variant];
  const geo = propGeo(variant);
  // Animation state as object fields (doubles stored in place: no per-frame heap numbers).
  const A = { screenUntil: 0, receiptLen: 0.25, receiptWob: 0, strain: 0, lift: 0, time: 0, pop: 0, wob: 0, wobDir: 0, wobT: 0, squash: 0, tiltX: 0, tiltZ: 0, vxW: 0, vyW: 0 };
  const root = new THREE.Group();
  root.name = `prop:${variant}`;
  const body = new THREE.Group();
  root.add(body);
  const bodyMesh = new THREE.Mesh(geo.body, matVC());
  bodyMesh.name = `prop:${variant}:body`;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  body.add(bodyMesh);

  // Value coin on top (kept upright toward the camera like the safes').
  const coinGeo = cachedGeo(`propCoin|${geo.coinR}`, () => new THREE.CircleGeometry(geo.coinR, 30).rotateX(-Math.PI / 2));
  let shownValue = spec.shell + spec.inner.c10 * 10 + spec.inner.c50 * 50;
  const coin = new THREE.Mesh(coinGeo, matTextured(valueCoinTexture(shownValue), { alphaTest: 0.35, rim: 0.2, polygonOffset: -1 }));
  coin.name = `prop:${variant}:coin`;
  coin.position.set(0, geo.coinY, geo.coinZ);
  coin.userData.noOutline = true;
  trackViewCamera(coin);
  body.add(coin);

  const anchorMat = createToonMaterial({ vertexColors: true, fx: true, rim: 0.6 });
  const anchors = new THREE.Mesh(geo.anchors, anchorMat);
  anchors.name = `prop:${variant}:anchors`;
  anchors.userData.noOutline = true;
  anchors.receiveShadow = true;
  anchors.castShadow = variant !== 'moneyTree';
  root.add(anchors);

  const shadow = blob();
  shadow.scale.set(spec.half.x * 2.6, 1, spec.half.y * 2.6);
  root.add(shadow);

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.y = spec.height + 0.45;
  root.add(labelAnchor);

  // --- variant parts -------------------------------------------------------------------
  let screen: THREE.Mesh | null = null;
  let screenState: AtmScreen = 'idle';
  let hopper: THREE.Mesh[] = [];
  let receipt: THREE.Mesh | null = null;
  const receiptAngle = (i: number): number => 0.25 + i * 0.12 + Math.sin(A.time * 3 + i) * 0.08 + A.receiptWob * 0.3;
  const disposables: (THREE.Material | THREE.BufferGeometry)[] = [anchorMat];
  if (variant === 'atm') {
    const front = spec.half.y - 0.12;
    screen = new THREE.Mesh(cachedGeo('atmScreen', () => new THREE.PlaneGeometry(0.6, 0.36)), matTextured(atmScreenTexture('idle', lang), { rim: 0 }));
    screen.position.set(0, 1.1, front + 0.102);
    screen.userData.noOutline = true;
    body.add(screen);
    // Coin stacks behind both portholes (scaled by the coins left).
    // Coin columns seen through both portholes (flat coins stacked edge-on, squashed so they
    // stay inside the window); the column height follows the coins left (setContents).
    const stackGeo = cachedGeo('atmStack', () => {
      const b = new PartBuilder();
      for (let i = 0; i < 6; i++) {
        b.push([0, 0.025 + i * 0.052, ((i % 2) - 0.5) * 0.03]);
        addPawCoin(b, 0.115, 0.045, 1 + (i % 2) * 0.06);
        b.pop();
      }
      return b.merge('vc')!;
    });
    const zc = (front + (-spec.half.y + 0.03)) / 2;
    const hxBody = spec.half.x - 0.05;
    // Both porthole columns in one mesh (squashed edge-on, the height follows the coins left).
    const pairGeo = cachedGeo(`atmStackPair|${hxBody}`, () => {
      const parts = [-1, 1].map((sx) => stackGeo.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(sx * (hxBody - 0.012), 0, 0).multiply(new THREE.Matrix4().makeScale(0.12, 1, 1))));
      const g = mergeVc(parts);
      for (const q of parts) q.dispose();
      return g;
    });
    const pair = new THREE.Mesh(pairGeo, matVC());
    pair.position.set(0, 0.66 - 0.17, zc);
    pair.userData.noOutline = true;
    body.add(pair);
    hopper = [pair];
    // Receipt streamer: 6 paper slips that curl down from the receipt slot (one mesh).
    const strip = receiptStripGeometry();
    disposables.push(strip);
    receipt = new THREE.Mesh(strip, matTextured(receiptTexture(), { rim: 0.2, side: THREE.DoubleSide }));
    receipt.userData.noOutline = true;
    receipt.castShadow = false;
    receipt.position.set(-0.2, 0.9, front + 0.036);
    body.add(receipt);
  }
  let cracks: THREE.Mesh[] = [];
  let bowl: THREE.Mesh | null = null;
  if (variant === 'piggy') {
    const { y, rx, ry, rz } = PIG_BODY;
    // Three crack patches around the body (front-top, left, right-back).
    const patches: [number, number, number][] = [
      [Math.PI * 0.25, 0.25, 7],
      [Math.PI * 1.05, 0.35, 11],
      [Math.PI * 1.7, 0.2, 23],
    ];
    cracks = patches.map(([phi, theta, seed]) => {
      const g = new THREE.SphereGeometry(1, 14, 10, phi, Math.PI * 0.55, theta, Math.PI * 0.62);
      disposables.push(g);
      const m = new THREE.Mesh(g, matTextured(piggyCrackTexture(seed), { transparent: true, rim: 0.2, polygonOffset: -2 }));
      m.scale.set(rx * 1.012, ry * 1.012, rz * 1.012);
      m.position.y = y;
      m.visible = false;
      m.userData.noOutline = true;
      m.renderOrder = 1;
      body.add(m);
      return m;
    });
    bowl = new THREE.Mesh(piggyBowlGeometry(), matVC());
    bowl.name = 'prop:piggy:bowl';
    bowl.castShadow = true;
    bowl.visible = false;
    root.add(bowl);
  }
  // Money tree: the hanging bundles are ONE instanced mesh (count = bundles left) and the notes
  // that flutter off on a shed another (hidden instances are zero-scaled).
  let bills: THREE.InstancedMesh | null = null;
  let billsShown = 0;
  let roots: THREE.Mesh | null = null;
  let flutterMesh: THREE.InstancedMesh | null = null;
  const flutter: { x: number; y: number; z: number; t: number; vx: number; vz: number; spin: number }[] = [];
  if (variant === 'moneyTree') {
    const note = matTextured(billNoteTexture(), { rim: 0.3, side: THREE.DoubleSide, alphaTest: 0.3 });
    bills = new THREE.InstancedMesh(billClusterGeometry(), note, TREE_BILL_SPOTS.length);
    bills.name = 'prop:moneyTree:bills';
    bills.userData.noOutline = true;
    bills.castShadow = true;
    bills.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.add(bills);
    roots = new THREE.Mesh(treeRootGeometry(), matVC());
    roots.visible = false;
    body.add(roots);
    // Flutter pool: single notes peeling off when it sheds.
    const one = cachedGeo('flutterNote', () => new THREE.PlaneGeometry(0.3, 0.15));
    flutterMesh = new THREE.InstancedMesh(one, note, 6);
    flutterMesh.name = 'prop:moneyTree:flutter';
    flutterMesh.userData.noOutline = true;
    flutterMesh.frustumCulled = false;
    flutterMesh.visible = false;
    flutterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(flutterMesh);
    for (let i = 0; i < 6; i++) {
      flutterMesh.setMatrixAt(i, _hidden);
      flutter.push({ x: 0, y: 0, z: 0, t: 9, vx: 0, vz: 0, spin: 0 });
    }
  }
  const poseBills = (wobA: number): void => {
    if (!bills) return;
    bills.count = billsShown;
    for (let i = 0; i < billsShown; i++) {
      const sp = TREE_BILL_SPOTS[i]!;
      _be.set(0, (i % 2 ? 0.3 : -0.3) + (sp[2] < 0 ? Math.PI : 0), Math.sin(A.time * 2.2 + i * 1.7) * 0.12 + A.tiltZ * 1.5 + wobA * 0.4);
      _bm.compose(_bp.set(sp[0], sp[1], sp[2]), _bq.setFromEuler(_be), _bs.set(1, 1, 1));
      bills.setMatrixAt(i, _bm);
    }
    if (billsShown) bills.instanceMatrix.needsUpdate = true;
  };

  const highlighter = new Highlighter(body, { pushMax: 0.4, pushSlope: 0.8 });
  const ink = new InkOutline(body, { pushMax: 0.4, pushSlope: 0.8 });

  // --- animation state -----------------------------------------------------------------
  let anchored = spec.uprootTicks > 0;
  anchors.visible = anchored;
  let inner = spec.inner.c10 * 10 + spec.inner.c50 * 50;
  const innerMax = Math.max(1, inner);
  let crackN = 0;

  const setScreen = (s: AtmScreen): void => {
    if (!screen || s === screenState) return;
    screenState = s;
    screen.material = matTextured(atmScreenTexture(s, lang), { rim: 0 });
  };
  const applyContents = (): void => {
    const k = inner / innerMax;
    for (let i = 0; i < hopper.length; i++) {
      const h = hopper[i]!;
      h.visible = inner > 0;
      h.scale.set(1, Math.max(0.15, k), 1);
    }
    if (variant === 'atm' && A.screenUntil <= A.time) setScreen(inner > 0 ? 'idle' : 'empty');
    if (variant === 'moneyTree') {
      billsShown = Math.max(0, Math.min(TREE_BILL_SPOTS.length, Math.round(inner / 50)));
      poseBills(0);
    }
  };

  const update = (dt: number): void => {
    A.time += dt;
    root.getWorldQuaternion(_wq);
    _we.setFromQuaternion(_wq, 'YXZ');
    coin.rotation.y = cameraFacingYaw() - _we.y - body.rotation.y;
    const s = anchored ? A.strain : 0;
    const violent = 0.012 * s + 0.035 * s * s * s;
    // Wobble from hits (decaying spring around a local horizontal axis).
    A.wobT += dt;
    A.wob *= Math.exp(-dt * 4.2);
    const wobA = A.wob * Math.sin(A.wobT * 17);
    A.squash *= Math.exp(-dt * 9);
    // Lean with motion (piggy rolls / tree sways against the motion), smoothed.
    const ang = -root.rotation.y; // sim angle
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const lx = A.vxW * ca + A.vyW * sa;
    const lz = -A.vxW * sa + A.vyW * ca;
    const leanK = variant === 'piggy' ? 0.06 : variant === 'moneyTree' ? 0.05 : 0.02;
    A.tiltX += (THREE.MathUtils.clamp(lz * leanK, -0.3, 0.3) - A.tiltX) * (1 - Math.exp(-dt * 6));
    A.tiltZ += (THREE.MathUtils.clamp(-lx * leanK, -0.3, 0.3) - A.tiltZ) * (1 - Math.exp(-dt * 6));
    body.position.x = Math.sin(A.time * 47) * violent;
    body.position.z = Math.sin(A.time * 39 + 1.1) * violent;
    body.rotation.x = Math.sin(A.time * 7.3) * 0.025 * s + A.tiltX + Math.sin(A.wobDir) * wobA * 0.18;
    body.rotation.z = (Math.sin(A.time * 9) * 0.5 + 0.5) * 0.07 * s + A.tiltZ - Math.cos(A.wobDir) * wobA * 0.18;
    body.rotation.y = 0;
    anchors.position.x = Math.sin(A.time * 61) * 0.006 * s;
    const glow = s * (0.55 + 0.45 * Math.sin(A.time * 14));
    anchorMat.emissive.setRGB(1.0 * glow, 0.35 * glow, 0.12 * glow);
    let sq = 1 - A.squash;
    if (A.pop > 0) {
      A.pop = Math.max(0, A.pop - dt);
      const age = POP.time - A.pop;
      const land = POP.time * 0.62;
      if (age < land) {
        const u = age / land;
        body.position.y = A.lift + POP.height * 4 * u * (1 - u);
        sq *= 1 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.6));
        body.rotation.z += Math.sin(u * Math.PI) * 0.18;
      } else {
        const v = age - land;
        body.position.y = A.lift;
        sq *= 1 - 0.22 * Math.exp(-v * 10) * Math.cos(v * 30);
      }
    } else body.position.y = A.lift;
    body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    // Variant animation.
    if (screen && A.screenUntil > 0 && A.time >= A.screenUntil) {
      A.screenUntil = 0;
      setScreen(inner > 0 ? 'idle' : 'empty');
    }
    if (receipt) {
      A.receiptLen += (0.25 - A.receiptLen) * (1 - Math.exp(-dt * 0.8));
      const shown = Math.max(1, Math.min(RECEIPT.segs, Math.round(A.receiptLen * RECEIPT.segs * 1.6)));
      A.receiptWob = wobA;
      poseReceiptStrip(receipt.geometry, receiptAngle);
      receipt.geometry.setDrawRange(0, shown * 6);
    }
    if (bills) {
      poseBills(wobA);
      if (roots) roots.visible = !anchored;
    }
    if (flutterMesh) {
      let live = 0;
      for (let i = 0; i < flutter.length; i++) {
        const f = flutter[i]!;
        if (f.t >= 1.6) {
          flutterMesh.setMatrixAt(i, _hidden);
          continue;
        }
        f.t += dt;
        const k = Math.min(1, f.t / 1.6);
        live++;
        f.x += f.vx * dt;
        f.z += f.vz * dt;
        f.y = Math.max(0.05, f.y - dt * (0.9 + Math.sin(f.t * 9) * 0.5));
        _be.set(Math.sin(f.t * 7 + f.spin) * 0.9, f.t * f.spin, Math.cos(f.t * 5) * 0.6);
        _bm.compose(_bp.set(f.x, f.y, f.z), _bq.setFromEuler(_be), _bs.setScalar(f.t >= 1.6 ? 0 : 1 - k * k * 0.7));
        flutterMesh.setMatrixAt(i, _bm);
      }
      if (live || flutterMesh.visible) flutterMesh.instanceMatrix.needsUpdate = true;
      flutterMesh.visible = live > 0;
    }
  };

  const rig: PropRig = {
    root,
    kind: spec.kind,
    variant,
    footprint: { x: spec.half.x, y: spec.half.y },
    height: spec.height,
    labelAnchor,
    setAnchored(b: boolean) {
      if (anchored && !b) A.pop = POP.time;
      anchored = b;
      anchors.visible = b;
      if (!b) anchorMat.emissive.setRGB(0, 0, 0);
    },
    setStrain(v: number) {
      A.strain = THREE.MathUtils.clamp(v, 0, 1);
    },
    setLift(y: number) {
      A.lift = Math.max(0, y);
    },
    get popAge() {
      return A.pop > 0 ? POP.time - A.pop : Infinity;
    },
    setHighlight(color) {
      highlighter.set(color);
      ink.setVisible(color === null || color === undefined);
    },
    setContents(innerValue: number, value: number) {
      if (innerValue !== inner) {
        inner = Math.max(0, innerValue);
        applyContents();
      }
      if (value !== shownValue) {
        shownValue = value;
        coin.material = matTextured(valueCoinTexture(Math.max(0, value)), { alphaTest: 0.35, rim: 0.2, polygonOffset: -1 });
      }
      coin.visible = value > 0;
    },
    setCracks(n: number) {
      if (n === crackN) return;
      crackN = n;
      const smashed = n >= 3;
      for (let i = 0; i < cracks.length; i++) cracks[i]!.visible = !smashed && i < n;
      if (bowl) {
        bowl.visible = smashed;
        bodyMesh.visible = !smashed;
        coin.visible = !smashed && shownValue > 0;
        highlighter.rebuild();
        ink.refresh();
      }
    },
    hit(dir: number | null, strength: number) {
      const k = THREE.MathUtils.clamp(strength, 0, 1.6);
      // Wobble away from the hit (local frame).
      const ang = -root.rotation.y;
      A.wobDir = dir === null ? 0 : dir - ang;
      A.wob = Math.max(A.wob, 0.6 * k + 0.25);
      A.wobT = 0;
      A.squash = Math.max(A.squash, 0.12 * k);
    },
    setMotion(vx: number, vy: number) {
      A.vxW = vx;
      A.vyW = vy;
    },
    spurt(count = 2) {
      if (variant === 'atm') {
        A.screenUntil = A.time + 0.7;
        setScreen('beep');
        A.receiptLen = Math.min(1, A.receiptLen + 0.25);
        A.squash = Math.max(A.squash, 0.08);
      } else if (variant === 'moneyTree') {
        let n = Math.max(1, Math.min(3, count));
        for (const f of flutter) {
          if (n <= 0) break;
          if (f.t < 1.6) continue;
          const spot = TREE_BILL_SPOTS[(Math.floor(A.time * 7) + n) % TREE_BILL_SPOTS.length]!;
          // Spot is in body space; the flutter notes live in root space (same origin, no tilt).
          f.x = spot[0];
          f.y = spot[1];
          f.z = spot[2];
          f.t = 0;
          f.spin = 2 + n * 1.3;
          f.vx = spot[0] * 0.6;
          f.vz = (spot[2] >= 0 ? 1 : -1) * 0.5;
          n--;
        }
        A.wob = Math.max(A.wob, 0.35);
        A.wobT = 0;
      }
    },
    mouth(out: THREE.Vector3) {
      if (variant === 'atm') out.set(0, 0.42, spec.half.y + 0.05);
      else if (variant === 'piggy') out.set(0, PIG_BODY.y, 0);
      else if (variant === 'moneyTree') out.set(0, 1.9, 0);
      else out.set(0, 0.7, spec.half.y);
      return root.localToWorld(out);
    },
    update,
    dispose() {
      highlighter.dispose();
      ink.dispose();
      for (const d of disposables) d.dispose();
      bills?.dispose();
      flutterMesh?.dispose();
      root.removeFromParent();
    },
  };
  applyContents();
  if (receipt) poseReceiptStrip(receipt.geometry, receiptAngle);
  return rig;
}

let receiptTex: THREE.Texture | null = null;
function receiptTexture(): THREE.Texture {
  if (receiptTex) return receiptTex;
  receiptTex = makeCanvasTexture(
    64,
    40,
    (ctx, w, h) => {
      ctx.fillStyle = '#FFFDF6';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#C9BFD6';
      for (let y = 6; y < h - 4; y += 7) ctx.fillRect(8, y, w - 16 - ((y * 7) % 20), 2.5);
    },
    { mipmaps: false },
  );
  return receiptTex;
}

// ===========================================================================
// Breakables (crate, 꿀꺽 vending machine)
// ===========================================================================

export interface BreakableRig {
  readonly root: THREE.Group;
  readonly kind: BreakableKind;
  /** Current HP (vending: dents / cracked glass / flicker per lost HP). */
  setHp(hp: number): void;
  /** Visual hit: wobble away from a world direction (radians, null = in place). */
  hit(dir: number | null): void;
  /** Debris pieces for a DebrisBurst at break time (world transforms; the rig hides itself). */
  breakApart(dir: number | null): { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; velocity: THREE.Vector3; angular: THREE.Vector3; radius: number }[];
  setHighlight(color: THREE.ColorRepresentation | null): void;
  update(dt: number): void;
  dispose(): void;
}

const VEND = { body: '#4FC3A1', bodyDark: '#2F9479', cream: '#FFF3DE', sign: '#FFD45C', glass: '#CDEFF5' };

function buildCrate(): THREE.BufferGeometry {
  return cachedGeo('crate', () => {
    const half = BREAKABLE_SPECS.crate.half;
    const H = BREAKABLE_SPECS.crate.height;
    const s = half.x * 2 - 0.04;
    const b = new PartBuilder();
    b.add(G.rbox(s - 0.06, H - 0.06, s - 0.06, 0.03), { color: '#D9A46E', pos: [0, H / 2, 0] });
    // Planks: horizontal slats on each side + corner posts + a diagonal brace (front/back).
    const plank = (pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0], c: string = PAL.wood): void => {
      b.add(G.rbox(1, 1, 1, 0.12), { color: c, pos, scale, rot });
    };
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 3; i++) plank([0, 0.16 + i * 0.29, sz * (s / 2 - 0.01)], [s - 0.08, 0.22, 0.04], [0, 0, 0], i % 2 ? PAL.woodLight : PAL.wood);
      plank([0, H / 2, sz * (s / 2 + 0.012)], [0.07, Math.hypot(s, H) * 0.86, 0.035], [0, 0, 0.78 * sz], PAL.woodDark);
    }
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) plank([sx * (s / 2 - 0.01), 0.16 + i * 0.29, 0], [0.04, 0.22, s - 0.08], [0, 0, 0], i % 2 ? PAL.woodLight : PAL.wood);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank([sx * (s / 2), H / 2, sz * (s / 2)], [0.08, H, 0.08], [0, 0, 0], PAL.woodDark);
    // Lid planks.
    for (let i = 0; i < 3; i++) plank([0, H - 0.01, (i - 1) * 0.27], [s - 0.02, 0.04, 0.24], [0, 0, 0], i % 2 ? PAL.woodLight : PAL.wood);
    // Stenciled paw on the front + a "깨짐주의"-style red stripe tag (little story).
    const fz = s / 2 + 0.03;
    b.add(G.sphere(10, 6), { color: '#8C5E3B', pos: [0.1, 0.42, fz], scale: [0.08, 0.07, 0.006] });
    for (const [dx, dy] of [
      [-0.09, 0.06],
      [-0.03, 0.11],
      [0.03, 0.11],
      [0.09, 0.06],
    ] as const) b.add(G.sphere(8, 5), { color: '#8C5E3B', pos: [0.1 + dx, 0.42 + dy + 0.03, fz], scale: [0.024, 0.024, 0.005] });
    b.add(G.box(), { color: '#FFF3DE', pos: [-0.15, 0.68, fz + 0.002], rot: [0, 0, -0.08], scale: [0.2, 0.08, 0.006] });
    b.add(G.box(), { color: '#E85D6A', pos: [-0.15, 0.68, fz + 0.006], rot: [0, 0, -0.08], scale: [0.16, 0.025, 0.004] });
    return b.merge('vc')!;
  });
}

function buildVending(): THREE.BufferGeometry {
  return cachedGeo('vending', () => {
    const half = BREAKABLE_SPECS.vending.half;
    const H = BREAKABLE_SPECS.vending.height;
    const hx = half.x - 0.03;
    const hz = half.y - 0.04;
    const fz = hz;
    const b = new PartBuilder();
    b.add(G.rbox(hx * 2, 0.08, hz * 2, 0.03), { color: '#5F5A6E', pos: [0, 0.04, 0] });
    b.add(G.rbox(hx * 2, H - 0.3, hz * 2, 0.08, 2), { color: VEND.body, pos: [0, 0.08 + (H - 0.3) / 2, 0] });
    // Brand header ("꿀꺽" sign is a textured plane) and roof cap.
    b.add(G.rbox(hx * 2 + 0.04, 0.26, hz * 2 + 0.04, 0.07, 2), { color: VEND.bodyDark, pos: [0, H - 0.13, 0] });
    b.add(G.rbox(hx * 2 - 0.12, 0.03, hz * 2 - 0.12, 0.012), { color: '#8FE3C8', pos: [0, H + 0.004, 0] });
    // Front window frame with shelves of cans (pastel cylinders).
    b.add(G.rbox(hx * 2 - 0.36, 1.0, 0.06, 0.04), { color: VEND.cream, pos: [-0.12, 1.08, fz + 0.01] });
    const cans = ['#FF8FA3', '#FFD45C', '#B9A3F0', '#8FE3C8', '#FFFFFF'];
    for (let row = 0; row < 3; row++) {
      b.add(G.box(), { color: '#E7D3B8', pos: [-0.12, 0.7 + row * 0.3, fz + 0.03], scale: [hx * 2 - 0.44, 0.02, 0.06] });
      for (let i = 0; i < 4; i++) {
        const c = cans[(row * 4 + i * 3) % cans.length]!;
        b.add(G.cyl(1, 1, 12), { color: c, pos: [-0.12 + (i - 1.5) * 0.17, 0.79 + row * 0.3, fz + 0.035], scale: [0.055, 0.17, 0.055] });
        b.add(G.cyl(1, 1, 12), { color: '#DCE1EA', pos: [-0.12 + (i - 1.5) * 0.17, 0.885 + row * 0.3, fz + 0.035], scale: [0.045, 0.012, 0.045] });
      }
    }
    // Button column + coin slot + bill slot, dispenser flap.
    b.add(G.rbox(0.22, 1.0, 0.05, 0.03), { color: VEND.cream, pos: [hx - 0.15, 1.08, fz + 0.005] });
    for (let i = 0; i < 5; i++) b.add(G.cyl(1, 1, 12), { color: i % 2 ? '#FF8FA3' : '#FFD45C', pos: [hx - 0.15, 1.45 - i * 0.12, fz + 0.035], rot: [Math.PI / 2, 0, 0], scale: [0.035, 0.02, 0.035] });
    b.add(G.box(), { color: PAL.ink, pos: [hx - 0.15, 0.78, fz + 0.034], scale: [0.012, 0.07, 0.01] });
    b.add(G.rbox(hx * 2 - 0.2, 0.2, 0.06, 0.04), { color: '#3A3346', pos: [-0.04, 0.3, fz + 0.01] });
    b.add(G.rbox(hx * 2 - 0.3, 0.12, 0.03, 0.03), { color: '#5F5A6E', pos: [-0.04, 0.3, fz + 0.04] });
    // Side stickers: a cat doodle-free mint stripe and a paw (little story: someone tagged it).
    for (const sx of [-1, 1]) b.add(G.box(), { color: '#FFF3DE', pos: [sx * (hx + 0.002), 1.2, 0], scale: [0.006, 0.08, hz * 1.6] });
    return b.merge('vc')!;
  });
}

const VEND_TEXT = { ko: '꿀꺽', en: 'GULP' } as const;
const vendSignTex = new Map<string, THREE.Texture>();
function vendSignTexture(lang: 'ko' | 'en'): THREE.Texture {
  let t = vendSignTex.get(lang);
  if (t) return t;
  const text = VEND_TEXT[lang];
  t = makeCanvasTexture(
    256,
    96,
    (ctx, w, h) => {
      ctx.fillStyle = '#FFD45C';
      roundRectPath(ctx, 4, 4, w - 8, h - 8, 22);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#2F9479';
      ctx.stroke();
      // A bubbly soda glyph next to the brand.
      ctx.fillStyle = '#FF8FA3';
      roundRectPath(ctx, 26, 22, 30, 52, 10);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      for (const [x, y, r] of [
        [70, 30, 6],
        [80, 50, 4],
        [66, 64, 5],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = `bold 60px ${FONT_STACK}`;
      outlinedText(ctx, text, w / 2 + 34, h / 2 + 4, 60, '#2A2131', '#FFFFFF', 8, w - 110);
    },
    { fontText: text, mipmaps: false },
  );
  vendSignTex.set(lang, t);
  return t;
}

let glassCrackTex: THREE.Texture | null = null;

/** Create a breakable rig ('crate' | 'vending'); `lang` picks the vending brand sign text. */
export function createBreakableRig(kind: BreakableKind, lang: 'ko' | 'en' = 'ko'): BreakableRig {
  const spec = BREAKABLE_SPECS[kind];
  const root = new THREE.Group();
  root.name = `breakable:${kind}`;
  const body = new THREE.Group();
  root.add(body);
  const geo = kind === 'crate' ? buildCrate() : buildVending();
  const mesh = new THREE.Mesh(geo, matVC());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.add(mesh);
  const shadow = blob();
  shadow.scale.set(spec.half.x * 2.5, 1, spec.half.y * 2.5);
  root.add(shadow);
  let sign: THREE.Mesh | null = null;
  let glass: THREE.Mesh | null = null;
  let glassCrack: THREE.Mesh | null = null;
  if (kind === 'vending') {
    const fz = spec.half.y - 0.04;
    sign = new THREE.Mesh(cachedGeo('vendSign', () => new THREE.PlaneGeometry(spec.half.x * 1.8, 0.22)), matTextured(vendSignTexture(lang), { rim: 0, polygonOffset: -1 }));
    sign.position.set(0, spec.height - 0.13, fz + 0.045);
    sign.userData.noOutline = true;
    body.add(sign);
    // Glass pane (slightly blue-white, transparent) over the can shelves.
    glass = new THREE.Mesh(
      cachedGeo('vendGlass', () => new THREE.PlaneGeometry(spec.half.x * 2 - 0.42, 0.94)),
      new THREE.MeshBasicMaterial({ color: '#E8FAFF', transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false }),
    );
    glass.position.set(-0.12, 1.08, fz + 0.075);
    glass.userData.noOutline = true;
    body.add(glass);
    if (!glassCrackTex) glassCrackTex = piggyCrackTexture(41);
    glassCrack = new THREE.Mesh(glass.geometry, matTextured(glassCrackTex, { transparent: true, rim: 0, polygonOffset: -2 }));
    glassCrack.position.copy(glass.position);
    glassCrack.position.z += 0.003;
    glassCrack.visible = false;
    glassCrack.userData.noOutline = true;
    body.add(glassCrack);
  }
  const highlighter = new Highlighter(body, { pushMax: 0.4, pushSlope: 0.8 });
  const ink = new InkOutline(body, { pushMax: 0.4, pushSlope: 0.8 });
  let hp: number = spec.hp;
  // Animation state as object fields (doubles stored in place: no per-frame heap numbers).
  const B = { wob: 0, wobT: 0, wobDir: 0, time: 0, flicker: 0 };
  const update = (dt: number): void => {
    B.time += dt;
    B.wobT += dt;
    B.wob *= Math.exp(-dt * 5);
    const a = B.wob * Math.sin(B.wobT * 20);
    body.rotation.x = Math.sin(B.wobDir) * a * 0.12;
    body.rotation.z = -Math.cos(B.wobDir) * a * 0.12;
    const sq = 1 - Math.max(0, a) * 0.08;
    body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    if (sign) {
      // A damaged machine's sign flickers.
      B.flicker = hp < spec.hp ? (Math.sin(B.time * 23) > 0.6 - (spec.hp - hp) * 0.25 ? 1 : 0) : 0;
      sign.visible = B.flicker === 0 || Math.sin(B.time * 61) > 0;
    }
  };
  return {
    root,
    kind,
    setHp(n: number) {
      hp = n;
      if (glassCrack) glassCrack.visible = n < spec.hp;
      if (glassCrack && n < spec.hp - 1) glassCrack.scale.set(1.15, 1.1, 1);
    },
    hit(dir: number | null) {
      const ang = -root.rotation.y;
      B.wobDir = dir === null ? 0 : dir - ang;
      B.wob = 1;
      B.wobT = 0;
    },
    breakApart(dir: number | null) {
      root.updateMatrixWorld(true);
      const pieces: ReturnType<BreakableRig['breakApart']> = [];
      const dx = dir === null ? 0 : Math.cos(dir);
      const dz = dir === null ? 0 : Math.sin(dir);
      const r = rng(Math.floor(root.position.x * 13 + root.position.z * 7) + 3);
      const n = kind === 'crate' ? 9 : 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3(Math.cos(a) * spec.half.x * 0.6, 0.2 + r() * spec.height * 0.7, Math.sin(a) * spec.half.y * 0.6);
        p.applyMatrix4(root.matrixWorld);
        m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), new THREE.Vector3(1, 1, 1));
        const out = 2 + r() * 2.5;
        pieces.push({
          geometry: kind === 'crate' ? plankPieceGeometry(i % 3) : vendPieceGeometry(i % 4),
          matrix: m,
          velocity: new THREE.Vector3(Math.cos(a) * out + dx * 3, 3 + r() * 4, Math.sin(a) * out + dz * 3),
          angular: new THREE.Vector3((r() - 0.5) * 16, (r() - 0.5) * 16, (r() - 0.5) * 16),
          radius: 0.05,
        });
      }
      root.visible = false;
      return pieces;
    },
    setHighlight(color) {
      highlighter.set(color);
      ink.setVisible(color === null || color === undefined);
    },
    update,
    dispose() {
      highlighter.dispose();
      ink.dispose();
      glass?.material && (glass.material as THREE.Material).dispose();
      root.removeFromParent();
    },
  };
}

/** Debris geometry (vertex colored, matVC): wood planks. */
export function plankPieceGeometry(i: number): THREE.BufferGeometry {
  return cachedGeo(`plank|${i}`, () => {
    const b = new PartBuilder();
    const c = i === 0 ? PAL.wood : i === 1 ? PAL.woodLight : PAL.woodDark;
    b.add(G.rbox(0.42 - i * 0.08, 0.05, 0.13, 0.02), { color: c });
    if (i === 0) b.add(G.cyl(1, 1, 6), { color: PAL.steel, pos: [0.15, 0.03, 0], scale: [0.012, 0.02, 0.012] });
    return b.merge('vc')!;
  });
}

/** Debris geometry: vending panel bits, cans and glass shards. */
export function vendPieceGeometry(i: number): THREE.BufferGeometry {
  return cachedGeo(`vendPiece|${i}`, () => {
    const b = new PartBuilder();
    if (i === 0) b.add(G.rbox(0.36, 0.04, 0.24, 0.02), { color: VEND.body });
    else if (i === 1) b.add(G.cyl(1, 1, 12), { color: '#FF8FA3', scale: [0.055, 0.17, 0.055] });
    else if (i === 2) b.add(G.cyl(1, 1, 12), { color: '#FFD45C', scale: [0.055, 0.17, 0.055] });
    else b.add(G.cone(3), { color: '#E8FAFF', scale: [0.1, 0.02, 0.14], emissive: 0.3 });
    return b.merge('vc')!;
  });
}

/** Debris geometry: piggy pottery shards. */
export function piggyShardGeometry(i: number): THREE.BufferGeometry {
  return cachedGeo(`pigShard|${i}`, () => {
    const b = new PartBuilder();
    const g = new THREE.SphereGeometry(1, 6, 4, i * 0.8, 0.9, 0.6 + (i % 2) * 0.5, 0.8);
    b.add(g, { color: i % 2 ? PIG.pink : PIG.dark, scale: [0.32, 0.28, 0.32] });
    g.dispose();
    return b.merge('vc')!;
  });
}

/** Free cached prop geometry / textures (full teardown only). */
export function disposePropCache(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const g of propGeoCache.values()) {
    g.body.dispose();
    g.anchors.dispose();
  }
  propGeoCache.clear();
  for (const t of screenTex.values()) t.dispose();
  screenTex.clear();
  for (const t of crackTexCache.values()) t.dispose();
  crackTexCache.clear();
  for (const t of vendSignTex.values()) t.dispose();
  vendSignTex.clear();
  receiptTex?.dispose();
  receiptTex = null;
  billTex?.dispose();
  billTex = null;
  glassCrackTex = null;
  blobGeo?.dispose();
  blobMat?.dispose();
  blobGeo = null;
  blobMat = null;
}
