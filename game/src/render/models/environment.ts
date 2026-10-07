/**
 * Town-plaza scenery: static boxes (buildings, walls, planters, benches, kiosks, fountains,
 * barriers), static circles (trees, lamps, poles, hydrants, fountains, statues / clock
 * tower), visual-only decor, the ground, the arena boundary and an outskirts backdrop.
 *
 * Every builder writes vertex-colored primitives into a PartBuilder at world coordinates.
 * buildStaticScenery() merges a whole layout per material and per spatial chunk (32 m), so
 * a full layout costs a few dozen draw calls; the single-object factories (createStaticBox,
 * createStaticCircle, createDecor) use the same builders for previews/tools.
 *
 * Occlusion (types.ts: a building "fades when between camera and player"): every building,
 * kiosk, tall wall, tree canopy and clock tower gets its own fade group inside the merged
 * chunks. StaticScenery is an occlusion client: each frame (setOcclusionFocus) it fades the
 * groups standing between the camera and the player as a whole, and shows per-chunk ghost
 * twins that redraw the faded / x-rayed parts as translucent shapes (occlusion.ts).
 *
 * Shop signs: layout signKeys go through the sign resolver; kiosks and unnamed buildings
 * ask it for 'sign.style.<style>' and the backdrop for 'sign.backdrop.<n>'; unknown keys fall
 * back to built-in names in the resolver's language (detected from LAYOUT_STRINGS).
 *
 * Sim -> world: (x, y) -> (x, 0, y); an object with sim angle a gets rotation.y = -a.
 */
import * as THREE from 'three';
import type { DecorDef, LayoutDef, StaticBoxDef, StaticCircleDef, Vec2 } from '../../sim/types';
import { LAYOUT_STRINGS } from '../../sim/layouts/strings';
import { PAL, BACKDROP_SIGNS, HANOK_ROOF, buildingStyle, styleFallbackName, type BuildingStyle, type SignLanguage } from './palette';
import { G, PartBuilder, hashString, lathe, rng, type V3 } from './geometry';
import {
  createGhostMaterial,
  createToonMaterial,
  matGlow,
  matScenery,
  matSceneryDouble,
  matSceneryDoubleGhost,
  matSceneryGhost,
  matWater,
} from './materials';
import { createGroundOverlay } from './groundArt';
import { SignAtlas, asphaltTexture, pavingTexture, radialGlowTexture, PAVING_TILE_METERS, type GroundStyle } from './textures';
import {
  addOcclusionClient,
  allocFadeGroup,
  focusTouchesBox,
  releaseFadeGroup,
  removeOcclusionClient,
  segmentHitsAABB,
  setGroupFade,
  type OcclusionClient,
  type OcclusionFocus,
} from './occlusion';

export type SignResolver = (key: string) => string;

/** Default resolver: Korean layout strings, else the key's fallback. */
export const defaultSignResolver: SignResolver = (key) => LAYOUT_STRINGS.ko[key] ?? key;

const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;

/**
 * Which language a sign resolver speaks: compares its answers for the layout sign keys with
 * LAYOUT_STRINGS (the view's resolver returns the key itself for unknown keys, so built-in
 * fallback names must follow the same language). Defaults to Korean.
 */
export function detectSignLanguage(resolver: SignResolver): SignLanguage {
  const langs = Object.keys(LAYOUT_STRINGS) as SignLanguage[];
  const keys = Object.keys(LAYOUT_STRINGS.ko).filter((k) => k.startsWith('sign.') || k.startsWith('layout.'));
  const score: Record<string, number> = {};
  let hangul = 0;
  let latin = 0;
  for (const k of keys) {
    let v: string;
    try {
      v = resolver(k);
    } catch {
      continue;
    }
    if (!v || v === k) continue;
    if (HANGUL.test(v)) hangul++;
    else if (/[A-Za-z]/.test(v)) latin++;
    for (const l of langs) if (LAYOUT_STRINGS[l]?.[k] === v) score[l] = (score[l] ?? 0) + 1;
  }
  let best: SignLanguage | null = null;
  for (const l of langs) if ((score[l] ?? 0) > 0 && (!best || (score[l] ?? 0) > (score[best] ?? 0))) best = l;
  if (best) return best;
  return latin > hangul ? 'en' : 'ko';
}

const HALF_PI = Math.PI / 2;
/** Camera-facing tilt for glow halos (the game camera never rotates; pitch ~55°). */
const HALO_TILT = -THREE.MathUtils.degToRad(55);

interface Ctx {
  atlas: SignAtlas;
  resolve: SignResolver;
  /** Language of the built-in fallback names (follows the resolver, see detectSignLanguage). */
  lang: () => SignLanguage;
  /** World-plane point the shop fronts should face (arena center), or null = local +z. */
  center: Vec2 | null;
  /** Shop window dioramas + window silhouettes (quality). */
  shopInteriors?: boolean;
}

/** Ask the resolver for a key; null when it does not know it (returns the key or nothing). */
function tryResolve(ctx: Ctx, key: string): string | null {
  const t = ctx.resolve(key);
  return t && t !== key ? t : null;
}

/** Sign text for a layout signKey, else the style's name, in the resolver's language. */
function resolveSign(ctx: Ctx, key: string | undefined, style: string | undefined): string {
  if (key) {
    const t = tryResolve(ctx, key);
    if (t) return t;
  }
  const styled = tryResolve(ctx, `sign.style.${style ?? 'default'}`);
  if (styled) return styled;
  const lang = ctx.lang();
  if (key) {
    const own = LAYOUT_STRINGS[lang]?.[key] ?? LAYOUT_STRINGS.ko[key];
    if (own) return own;
  }
  return styleFallbackName(style, lang);
}

/** Push the def's world transform (center + angle) onto the builder. */
function pushDef(b: PartBuilder, center: Vec2, angle: number): void {
  b.push([center.x, 0, center.y], [0, -angle, 0]);
}

function shade(hex: string, l: number): THREE.Color {
  return new THREE.Color(hex).offsetHSL(0, 0, l);
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/** Yaw for a "facade frame" whose +z points along the given local axis direction. */
function facadeYaw(axis: 'x' | 'z', sign: number): number {
  if (axis === 'z') return sign > 0 ? 0 : Math.PI;
  return sign > 0 ? HALF_PI : -HALF_PI;
}

function addWindowBox(b: PartBuilder, x: number, y: number, z: number, w: number, h: number, lit: boolean, trim: string, flowerBox: boolean, r: () => number): void {
  b.add(G.box(), { color: trim, pos: [x, y, z + 0.02], scale: [w + 0.16, h + 0.16, 0.06] });
  b.add(G.box(), { color: lit ? '#FFE2A6' : '#A9BEDA', pos: [x, y, z + 0.045], scale: [w, h, 0.03], emissive: lit ? 0.55 : 0.08 });
  b.add(G.box(), { color: trim, pos: [x, y, z + 0.065], scale: [0.05, h, 0.02] });
  b.add(G.box(), { color: trim, pos: [x, y - h / 2 - 0.08, z + 0.1], scale: [w + 0.26, 0.07, 0.18] });
  if (lit && r() < 0.35) {
    // Curtain hint.
    b.add(G.box(), { color: '#FFC9D6', pos: [x - w * 0.3, y + h * 0.05, z + 0.05], scale: [w * 0.32, h * 0.9, 0.02] });
  }
  if (flowerBox) {
    b.add(G.box(), { color: PAL.woodDark, pos: [x, y - h / 2 - 0.22, z + 0.2], scale: [w + 0.1, 0.2, 0.26] });
    for (let i = 0; i < 4; i++) {
      b.add(G.ico(0), {
        color: i % 2 ? PAL.leaf : PAL.flowers[Math.floor(r() * PAL.flowers.length)],
        pos: [x - w / 2 + 0.12 + (i * (w - 0.1)) / 3, y - h / 2 - 0.08, z + 0.22],
        scale: 0.11,
        sway: 0.3,
      });
    }
  }
}

function addAwning(b: PartBuilder, x: number, y: number, z: number, w: number, depth: number, color: string, tilt = 0.5, bucket = 'vc'): void {
  const n = Math.max(3, Math.round(w / 0.45));
  const sw = w / n;
  b.push([x, y, z], [tilt, 0, 0]);
  for (let i = 0; i < n; i++) {
    const col = i % 2 === 0 ? color : '#FFFFFF';
    b.add(G.box(), { color: col, pos: [-w / 2 + (i + 0.5) * sw, 0, depth / 2], scale: [sw + 0.002, 0.05, depth], bucket });
    b.add(G.cyl(1, 1, 8, true), { color: col, pos: [-w / 2 + (i + 0.5) * sw, -0.03, depth], rot: [0, 0, HALF_PI], scale: [sw / 2, sw - 0.005, sw / 2], bucket });
  }
  b.pop();
}

function addSignBoard(b: PartBuilder, ctx: Ctx, x: number, y: number, z: number, w: number, source: () => string, st: BuildingStyle, id?: string): void {
  const h = w / 4;
  b.add(G.rbox(w + 0.14, h + 0.14, 0.12, 0.05, 1), { color: st.accent, pos: [x, y, z + 0.06] });
  const uv = ctx.atlas.add({ text: source(), source, bg: st.sign, fg: st.signText, icon: st.icon, id });
  b.add(G.plane(), { color: '#FFFFFF', pos: [x, y, z + 0.125], scale: [w, h, 1], bucket: 'sign', uvRect: uv });
}

function addRooftop(b: PartBuilder, W: number, D: number, h: number, st: BuildingStyle, r: () => number): void {
  // Parapet.
  const pH = 0.35;
  const t = 0.18;
  b.add(G.box(), { color: st.trim, pos: [0, h + pH / 2, D / 2 - t / 2], scale: [W, pH, t] });
  b.add(G.box(), { color: st.trim, pos: [0, h + pH / 2, -D / 2 + t / 2], scale: [W, pH, t] });
  b.add(G.box(), { color: st.trim, pos: [W / 2 - t / 2, h + pH / 2, 0], scale: [t, pH, D - 2 * t] });
  b.add(G.box(), { color: st.trim, pos: [-W / 2 + t / 2, h + pH / 2, 0], scale: [t, pH, D - 2 * t] });
  b.add(G.box(), { color: st.roof, pos: [0, h + 0.03, 0], scale: [W - 2 * t, 0.06, D - 2 * t] });
  // Props.
  const props = Math.max(1, Math.floor(W / 4));
  for (let i = 0; i < props; i++) {
    const px = -W / 2 + 1 + r() * (W - 2);
    const pz = (r() - 0.5) * (D - 1.4);
    const k = r();
    if (k < 0.3) {
      b.add(G.rbox(0.9, 0.6, 0.7, 0.08, 1), { color: PAL.silver, pos: [px, h + 0.36, pz] });
      b.add(G.cyl(1, 1, 14), { color: PAL.steelDark, pos: [px, h + 0.67, pz], scale: [0.25, 0.03, 0.25] });
    } else if (k < 0.55) {
      for (const lx of [-0.3, 0.3]) for (const lz of [-0.3, 0.3]) b.add(G.box(), { color: PAL.woodDark, pos: [px + lx, h + 0.35, pz + lz], scale: [0.07, 0.7, 0.07] });
      b.add(G.cyl(1, 1, 14), { color: '#9FC6E0', pos: [px, h + 1.05, pz], scale: [0.48, 0.7, 0.48] });
      b.add(G.cone(14), { color: '#7AA9C9', pos: [px, h + 1.55, pz], scale: [0.52, 0.3, 0.52] });
    } else if (k < 0.8) {
      for (let j = 0; j < 3; j++) {
        b.add(G.cyl(0.8, 1, 10), { color: '#D98A6A', pos: [px + j * 0.5, h + 0.2, pz], scale: [0.18, 0.3, 0.18] });
        b.add(G.ico(1), { color: j === 1 ? PAL.leafLight : PAL.leaf, pos: [px + j * 0.5, h + 0.5, pz], scale: 0.26, sway: 0.35 });
      }
    } else {
      b.add(G.cyl(1, 1, 6), { color: PAL.steelDark, pos: [px, h + 0.8, pz], scale: [0.03, 1.6, 0.03] });
      b.add(G.box(), { color: PAL.steelDark, pos: [px, h + 1.3, pz], scale: [0.7, 0.03, 0.03] });
      b.add(G.sphere(8, 6), { color: '#FF6B6B', pos: [px, h + 1.62, pz], scale: 0.06, emissive: 1.0 });
    }
  }
}

/** Rise of a hanok roof over a building of depth D (also used for its fade box). */
function hanokRise(D: number): number {
  return THREE.MathUtils.clamp(D * 0.34, 1.5, 2.3);
}

/**
 * Curved giwa roof surface (facade frame: ridge along x, slopes toward ±z, y = 0 at the eave
 * line). Concave slopes that flatten toward the eaves, eave tips curling up, corners swept up
 * (처마 앙곡) and corrugated tile rows (raised light rows over dark valleys) baked into one
 * vertex-colored grid + a wooden underside, eave rims and gable edges.
 */
function hanokRoofGeometry(W: number, D: number): THREE.BufferGeometry {
  const L = W + 1.1; // ridge length incl. gable overhang
  const e = D / 2 + 0.8; // eave half depth
  const rise = hanokRise(D);
  const period = 0.42; // tile row spacing
  // 3 samples per tile row keep the corrugation readable at ~half the triangles of 4.
  const nu = Math.max(18, Math.round((L / period) * 3));
  const nv = 22;
  const thick = 0.16;
  const tile = new THREE.Color(HANOK_ROOF.tile);
  const valley = new THREE.Color(HANOK_ROOF.valley);
  const tileEnd = new THREE.Color(HANOK_ROOF.tileEnd);
  const wood = new THREE.Color(HANOK_ROOF.wood);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const surf = (u: number, v: number, top: boolean, out: THREE.Vector3): number => {
    const au = Math.abs(2 * u - 1);
    const av = Math.abs(v);
    // Eaves flare outward a little at the corners (plan curve).
    const x = (u - 0.5) * L * (1 + 0.035 * av * av);
    const z = v * e * (1 + 0.05 * Math.pow(au, 4));
    let y = rise * Math.pow(1 - av, 1.45) + 0.24 * Math.pow(av, 8) + 0.6 * Math.pow(au, 5) * Math.pow(av, 3);
    let ridge = 0;
    if (top) {
      // Tile rows: rounded convex tiles, flat valleys.
      const ph = (x / period) * Math.PI * 2;
      ridge = Math.max(0, Math.cos(ph));
      y += 0.045 * Math.sqrt(ridge);
    } else {
      y -= thick;
    }
    out.set(x, y, z);
    return ridge;
  };
  const p = new THREE.Vector3();
  const pushGrid = (top: boolean, cu: number, cv: number, color: (ridge: number, u: number, v: number) => THREE.Color): void => {
    const base = pos.length / 3;
    for (let j = 0; j <= cv; j++) {
      const v = -1 + (2 * j) / cv;
      for (let i = 0; i <= cu; i++) {
        const u = i / cu;
        const ridge = surf(u, v, top, p);
        pos.push(p.x, p.y, p.z);
        const c = color(ridge, u, v);
        col.push(c.r, c.g, c.b);
      }
    }
    const row = cu + 1;
    for (let j = 0; j < cv; j++) {
      for (let i = 0; i < cu; i++) {
        const a = base + j * row + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        // Top faces up (+y), underside faces down.
        if (top) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  };
  const tmp = new THREE.Color();
  pushGrid(true, nu, nv, (ridge, _u, v) => {
    // Darker tile ends along the eave lip (막새 row).
    const lip = THREE.MathUtils.smoothstep(Math.abs(v), 0.93, 0.985);
    tmp.copy(valley).lerp(tile, Math.min(1, ridge * 1.3));
    return tmp.lerp(tileEnd, lip * 0.8);
  });
  pushGrid(false, Math.max(8, Math.round(L / 0.6)), 12, () => wood);
  // Edge strips joining top and underside: eave rims (v = ±1) and gable edges (u = 0, 1).
  const strip = (n: number, at: (k: number) => [number, number], color: THREE.Color, flip: boolean): void => {
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const [u, v] = at(k / n);
      surf(u, v, true, p);
      pos.push(p.x, p.y + 0.01, p.z);
      col.push(color.r, color.g, color.b);
      surf(u, v, false, p);
      pos.push(p.x, p.y, p.z);
      col.push(color.r, color.g, color.b);
    }
    for (let k = 0; k < n; k++) {
      const a = base + k * 2;
      if (flip) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const lipColor = new THREE.Color(HANOK_ROOF.mortar);
  strip(nu, (t) => [t, 1], lipColor, true);
  strip(nu, (t) => [t, -1], lipColor, false);
  strip(nv, (t) => [0, -1 + 2 * t], tileEnd, true);
  strip(nv, (t) => [1, -1 + 2 * t], tileEnd, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('fx', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  return g;
}

/** Height of the hanok roof surface above the eave line at depth z (facade frame). */
function hanokRoofY(D: number, z: number): number {
  const e = D / 2 + 0.8;
  const av = Math.min(1, Math.abs(z) / e);
  return hanokRise(D) * Math.pow(1 - av, 1.45) + 0.24 * Math.pow(av, 8);
}

/** Giwa roof with ridge ornaments, gable panels and rafter ends (hanok style). */
function addHanokRoof(b: PartBuilder, W: number, D: number, h: number, st: BuildingStyle): void {
  const base = h - 0.05;
  const rise = hanokRise(D);
  const L = W + 1.1;
  b.push([0, base, 0]);
  const roofGeo = hanokRoofGeometry(W, D);
  b.addPrepared(roofGeo);
  roofGeo.dispose();
  // Ridge (용마루): dark tiled beam with a white mortar band and upturned ends (취두).
  b.add(G.rbox(L - 0.3, 0.26, 0.36, 0.08, 1), { color: HANOK_ROOF.ridge, pos: [0, rise + 0.12, 0] });
  b.add(G.box(), { color: HANOK_ROOF.mortar, pos: [0, rise + 0.02, 0], scale: [L - 0.35, 0.07, 0.4] });
  for (const sx of [-1, 1]) {
    b.add(G.rbox(0.42, 0.42, 0.4, 0.1, 1), { color: HANOK_ROOF.ridge, pos: [sx * (L / 2 - 0.2), rise + 0.27, 0], rot: [0, 0, sx * -0.35] });
    b.add(G.cone(10), { color: HANOK_ROOF.ridge, pos: [sx * (L / 2 - 0.02), rise + 0.52, 0], rot: [0, 0, sx * -0.75], scale: [0.13, 0.36, 0.13] });
  }
  // Gable panels (박공) under the roof at both ends: plaster triangle with a timber frame.
  const zr = D / 2;
  const tri = new THREE.Shape();
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const z = -zr + (2 * zr * i) / steps;
    const y = Math.max(0.05, hanokRoofY(D, z) - 0.2);
    if (i === 0) tri.moveTo(z, 0);
    tri.lineTo(z, y);
  }
  tri.lineTo(zr, 0);
  tri.closePath();
  const panel = new THREE.ShapeGeometry(tri, 2);
  for (const sx of [-1, 1]) {
    b.add(panel, { color: st.body, pos: [sx * (W / 2 + 0.02), 0, 0], rot: [0, sx > 0 ? HALF_PI : -HALF_PI, 0] });
    b.add(G.box(), { color: st.accent, pos: [sx * (W / 2 + 0.04), 0.06, 0], scale: [0.04, 0.12, D] });
    b.add(G.box(), { color: st.accent, pos: [sx * (W / 2 + 0.04), Math.min(rise * 0.55, 1.1), 0], scale: [0.04, 0.1, D * 0.36] });
  }
  panel.dispose();
  // Rafter ends (서까래) peeking out under the front and back eaves.
  const n = Math.max(6, Math.round(W / 0.38));
  for (const sz of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (i + 0.5) * (W / n);
      b.add(G.cyl(1, 1, 8), { color: HANOK_ROOF.rafterEnd, pos: [x, -0.02, sz * (D / 2 + 0.42)], rot: [HALF_PI, 0, 0], scale: [0.055, 0.5, 0.055] });
    }
  }
  b.pop();
}

function addBuilding(b: PartBuilder, def: StaticBoxDef, ctx: Ctx, frontOnly = false): void {
  const st = buildingStyle(def.style);
  const r = rng(hashString(def.id));
  const h = Math.max(2.5, def.height);
  // Facade: long side facing the arena center (or local +z).
  const longX = def.half.x >= def.half.y;
  let fAxis: 'x' | 'z' = longX ? 'z' : 'x';
  let fSign = 1;
  if (ctx.center) {
    const dx = ctx.center.x - def.center.x;
    const dy = ctx.center.y - def.center.y;
    const c = Math.cos(def.angle);
    const s = Math.sin(def.angle);
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    if (fAxis === 'z') fSign = ly >= 0 ? 1 : -1;
    else fSign = lx >= 0 ? 1 : -1;
    if (Math.abs(fAxis === 'z' ? ly : lx) < 0.5) {
      fAxis = fAxis === 'z' ? 'x' : 'z';
      fSign = (fAxis === 'z' ? ly : lx) >= 0 ? 1 : -1;
    }
  }
  const W = 2 * (fAxis === 'z' ? def.half.x : def.half.y);
  const D = 2 * (fAxis === 'z' ? def.half.y : def.half.x);
  pushDef(b, def.center, def.angle);
  b.push(undefined, [0, facadeYaw(fAxis, fSign), 0]);
  const brick = def.style === 'brick';
  const hanok = st.roofKind === 'hanok';
  const bodyCol = st.body;
  // Body + base + floor bands.
  b.add(G.rbox(W, h, D, 0.1, 1), { color: bodyCol, pos: [0, h / 2, 0] });
  b.add(G.box(), { color: shade(bodyCol, -0.12), pos: [0, 0.22, 0], scale: [W + 0.08, 0.44, D + 0.08] });
  const floors = Math.max(1, Math.round(h / 3.1));
  const floorH = h / floors;
  for (let f = 1; f < floors; f++) b.add(G.box(), { color: st.trim, pos: [0, f * floorH, 0], scale: [W + 0.06, 0.12, D + 0.06] });
  if (brick) {
    // Mortar courses: subtle light lines.
    for (let y = 0.8; y < h - 0.3; y += 0.55) b.add(G.box(), { color: shade(bodyCol, 0.06), pos: [0, y, 0], scale: [W + 0.02, 0.04, D + 0.02] });
  }
  if (hanok) {
    // Timber posts on the corners and facade.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(), { color: st.accent, pos: [sx * (W / 2 - 0.1), h / 2, sz * (D / 2 - 0.1)], scale: [0.24, h, 0.24] });
  }
  const zF = D / 2;
  // --- ground floor shop front -------------------------------------------------
  const doorW = 1.0;
  const doorX = W / 2 - 0.9 - (r() < 0.5 ? 0 : W - 1.8);
  const shopW = Math.max(1.2, W - 3.2);
  const shopX = doorX > 0 ? -W / 2 + 0.8 + shopW / 2 : W / 2 - 0.8 - shopW / 2;
  b.add(G.box(), { color: st.trim, pos: [shopX, 1.35, zF + 0.03], scale: [shopW + 0.2, 1.9, 0.08] });
  b.add(G.box(), { color: '#FFE4AE', pos: [shopX, 1.35, zF + 0.075], scale: [shopW, 1.7, 0.03], emissive: 0.65 });
  for (let i = 1; i < Math.max(2, Math.round(shopW / 1.4)); i++) {
    const n = Math.max(2, Math.round(shopW / 1.4));
    b.add(G.box(), { color: st.trim, pos: [shopX - shopW / 2 + (i * shopW) / n, 1.35, zF + 0.095], scale: [0.06, 1.7, 0.03] });
  }
  if (ctx.shopInteriors) addShopDiorama(b, def.style ?? 'default', shopX, zF, shopW, r);
  else {
    // Display goodies behind the glass (cute colored blobs).
    for (let i = 0; i < Math.round(shopW / 0.8); i++) {
      b.add(G.ico(1), { color: PAL.flowers[i % PAL.flowers.length], pos: [shopX - shopW / 2 + 0.4 + i * 0.8, 0.75, zF + 0.1], scale: [0.18, 0.18, 0.06], emissive: 0.15 });
    }
  }
  b.add(G.box(), { color: shade(bodyCol, -0.15), pos: [shopX, 0.35, zF + 0.06], scale: [shopW + 0.2, 0.3, 0.12] });
  // Door.
  b.add(G.box(), { color: st.trim, pos: [doorX, 1.15, zF + 0.03], scale: [doorW + 0.2, 2.3, 0.08] });
  b.add(G.box(), { color: st.accent, pos: [doorX, 1.1, zF + 0.075], scale: [doorW, 2.1, 0.04] });
  b.add(G.box(), { color: '#FFE4AE', pos: [doorX, 1.45, zF + 0.1], scale: [doorW * 0.6, 0.8, 0.02], emissive: 0.55 });
  b.add(G.sphere(8, 6), { color: PAL.gold, pos: [doorX + doorW * 0.32, 1.05, zF + 0.12], scale: 0.05 });
  b.add(G.box(), { color: PAL.stone, pos: [doorX, 0.06, zF + 0.25], scale: [doorW + 0.4, 0.12, 0.5] });
  // Awning + sign.
  addAwning(b, shopX, 2.55, zF + 0.04, shopW + 0.3, 0.55, st.awning);
  const signW = Math.min(3.4, Math.max(1.6, W * 0.55));
  const signY = Math.min(h - 0.5, 3.15);
  // Top of the sign frame: facade window boxes above it must clear it.
  const signTop = signY + signW / 8 + 0.08;
  const signSource = (): string => resolveSign(ctx, def.signKey, def.style);
  const signId = def.signKey ?? `style:${def.style ?? 'default'}`;
  // A facade facing east / west is seen almost edge-on by the north-looking camera, so a flat
  // wall sign there reads sideways. Those shops hang a blade sign instead: perpendicular to the
  // wall, at the camera-side end of the facade, its face turned to world +z so the lettering
  // reads upright, left to right (back face culled, never mirrored).
  const facadeWorldYaw = -def.angle + facadeYaw(fAxis, fSign);
  if (Math.abs(Math.sin(facadeWorldYaw)) > 0.7) {
    const bw = Math.min(1.8, signW);
    const along = -Math.sin(facadeWorldYaw) >= 0 ? 1 : -1; // local x toward world +z
    const bx = along * Math.max(0, W / 2 - 0.45);
    const out = zF + 0.12 + bw / 2;
    b.add(G.box(), { color: st.trim, pos: [bx, signY + bw / 8 + 0.14, zF + (bw + 0.2) / 2], scale: [0.07, 0.07, bw + 0.2] });
    b.push([bx, signY, out], [0, -facadeWorldYaw, 0]);
    addSignBoard(b, ctx, 0, 0, -0.06, bw, signSource, st, signId);
    b.pop();
  } else addSignBoard(b, ctx, 0, signY, zF + 0.04, signW, signSource, st, signId);
  // Little lamp over the door.
  b.add(G.sphere(10, 8), { color: '#FFF1C2', pos: [doorX, 2.45, zF + 0.2], scale: 0.09, emissive: 1.2 });
  // --- upper floor windows on all faces + ground-floor windows on the other faces ----------
  const faces: { yaw: number; width: number; depth: number; facade: boolean }[] = [
    { yaw: 0, width: W, depth: D, facade: true },
    { yaw: Math.PI, width: W, depth: D, facade: false },
    { yaw: HALF_PI, width: D, depth: W, facade: false },
    { yaw: -HALF_PI, width: D, depth: W, facade: false },
  ];
  for (const face of faces) {
    // Backdrop buildings only show their facade (rows touch; backs face away from the plaza).
    if (frontOnly && !face.facade) continue;
    b.push(undefined, [0, face.yaw, 0]);
    const z = face.depth / 2;
    const cols = Math.max(1, Math.floor((face.width - 0.6) / 1.7));
    const startF = face.facade ? 1 : 0;
    for (let f = startF; f < floors; f++) {
      const y = f * floorH + floorH * 0.55;
      if (y + 0.7 > h - 0.2) continue;
      for (let c = 0; c < cols; c++) {
        const x = -face.width / 2 + (c + 0.5) * (face.width / cols);
        if (!face.facade && f === 0 && Math.abs(x) < 0.7 && face.yaw === Math.PI) {
          // Back door instead of a window.
          b.add(G.box(), { color: shade(st.accent, 0.1), pos: [x, 1.05, z + 0.03], scale: [0.95, 2.0, 0.06] });
          b.add(G.sphere(6, 4), { color: '#FFF1C2', pos: [x, 2.25, z + 0.15], scale: 0.07, emissive: 1.0 });
          continue;
        }
        const wh = f === 0 ? 0.9 : 1.1;
        // No flower box where it would hang over the shop sign.
        const overSign = face.facade && Math.abs(x) < signW / 2 + 0.6 && y - wh / 2 - 0.34 < signTop;
        const lit = r() < 0.7;
        addWindowBox(b, x, y, z, 0.85, wh, lit, st.trim, face.facade && f >= 1 && !frontOnly && !overSign && r() < 0.6, r);
        if (ctx.shopInteriors && lit && f >= 1) {
          const k = r();
          if (k < 0.16) addWindowCat(b, x, y - wh / 2, z, r);
          else if (k < 0.26) addWindowPlant(b, x, y - wh / 2, z, r);
        }
      }
    }
    // Drain pipe on a back corner.
    if (!face.facade && face.yaw === Math.PI) {
      b.add(G.cyl(1, 1, 8), { color: shade(st.accent, 0.2), pos: [face.width / 2 - 0.25, h / 2, z + 0.08], scale: [0.06, h, 0.06] });
      if (r() < 0.6) b.add(G.rbox(0.7, 0.5, 0.35, 0.06, 1), { color: PAL.silver, pos: [-face.width / 2 + 0.9, 2.6, z + 0.18] });
    }
    b.pop();
  }
  // --- roof ---------------------------------------------------------------------------
  if (hanok) {
    addHanokRoof(b, W, D, h, st);
  } else if (st.roofKind === 'gable') {
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2 - 0.35, 0);
    tri.lineTo(D / 2 + 0.35, 0);
    tri.lineTo(0, Math.min(2.2, D * 0.55));
    tri.closePath();
    const roof = new THREE.ExtrudeGeometry(tri, { depth: W + 0.3, bevelEnabled: false });
    roof.translate(0, 0, -(W + 0.3) / 2);
    b.add(roof, { color: st.roof, pos: [0, h, 0], rot: [0, HALF_PI, 0] });
    b.add(G.box(), { color: shade(st.roof, -0.15), pos: [0, h + 0.03, 0], scale: [W + 0.34, 0.08, D + 0.72] });
    b.add(G.box(), { color: shade(st.body, -0.2), pos: [W * 0.25, h + Math.min(2.2, D * 0.55) * 0.6, -D * 0.12], scale: [0.45, 1.2, 0.45] });
  } else {
    addRooftop(b, W, D, h, st, r);
  }
  b.pop();
  b.pop();
}


// ---------------------------------------------------------------------------
// Shop window dioramas + window silhouettes (environmental storytelling)
// ---------------------------------------------------------------------------

/** Goods on two lit shelves behind the shop window, per shop style, plus a glass glint. */
function addShopDiorama(b: PartBuilder, style: string, cx: number, zF: number, w: number, r: () => number): void {
  const z = zF + 0.06;
  const x0 = cx - w / 2 + 0.25;
  const n = Math.max(2, Math.floor((w - 0.4) / 0.42));
  const step = (w - 0.5) / Math.max(1, n - 1);
  // Lit backdrop panel + shelves.
  b.add(G.box(), { color: '#FFE9C2', pos: [cx, 1.35, zF + 0.08], scale: [w - 0.05, 1.62, 0.01], emissive: 0.42 });
  for (const y of [0.78, 1.42]) b.add(G.rbox(w - 0.1, 0.04, 0.2, 0.01), { color: PAL.woodLight, pos: [cx, y, z + 0.06] });
  const item = (x: number, y: number, k: number): void => {
    const c = PAL.flowers[(k + Math.floor(r() * 5)) % PAL.flowers.length]!;
    switch (style) {
      case 'cafe':
      case 'tea':
        if (k % 3 === 2) {
          b.add(G.cyl(1, 1, 12), { color: '#FFF6E8', pos: [x, y + 0.1, z + 0.08], scale: [0.11, 0.2, 0.11] });
          b.add(G.cyl(1, 1, 12), { color: '#FF9FBF', pos: [x, y + 0.22, z + 0.08], scale: [0.12, 0.06, 0.12], emissive: 0.1 });
        } else {
          b.add(G.cyl(0.85, 1, 12), { color: k % 2 ? '#FFFFFF' : '#7A5844', pos: [x, y + 0.07, z + 0.08], scale: [0.06, 0.12, 0.06] });
          b.add(G.torus(0.3, 5, 10), { color: '#FFFFFF', pos: [x + 0.07, y + 0.08, z + 0.08], rot: [0, Math.PI / 2, 0], scale: 0.035 });
        }
        break;
      case 'bakery':
        if (k % 2) b.add(G.capsule(0.06, 0.18, 3, 8), { color: '#D9A066', pos: [x, y + 0.07, z + 0.08], rot: [0, 0, Math.PI / 2 + (r() - 0.5) * 0.3] });
        else b.add(G.torus(0.45, 6, 12, Math.PI * 1.3), { color: '#E8B472', pos: [x, y + 0.06, z + 0.08], rot: [Math.PI / 2, 0, 0.6], scale: 0.09 });
        break;
      case 'toy':
      case 'arcade': {
        // Teddy bears and bouncy balls.
        if (k % 2 === 0) {
          const fur = k % 4 === 0 ? '#C99A6B' : '#F2A0AE';
          b.add(G.sphere(10, 8), { color: fur, pos: [x, y + 0.09, z + 0.08], scale: [0.09, 0.1, 0.08] });
          b.add(G.sphere(10, 8), { color: fur, pos: [x, y + 0.24, z + 0.09], scale: 0.075 });
          for (const s of [-1, 1]) b.add(G.sphere(6, 4), { color: fur, pos: [x + s * 0.06, y + 0.31, z + 0.09], scale: 0.03 });
          b.add(G.sphere(6, 4), { color: '#FFF3DE', pos: [x, y + 0.22, z + 0.15], scale: [0.03, 0.025, 0.02] });
        } else b.add(G.sphere(12, 8), { color: c, pos: [x, y + 0.08, z + 0.08], scale: 0.08, emissive: 0.1 });
        break;
      }
      case 'flower':
        b.add(G.cyl(1, 0.8, 10), { color: '#9AA3B6', pos: [x, y + 0.08, z + 0.08], scale: [0.08, 0.16, 0.08] });
        for (let i = 0; i < 4; i++) b.add(G.ico(0), { color: PAL.flowers[(k + i) % PAL.flowers.length]!, pos: [x + (r() - 0.5) * 0.1, y + 0.2 + r() * 0.08, z + 0.08 + (r() - 0.5) * 0.06], scale: 0.045, sway: 0.2 });
        b.add(G.ico(1), { color: PAL.leaf, pos: [x, y + 0.17, z + 0.08], scale: [0.08, 0.05, 0.06], sway: 0.15 });
        break;
      case 'icecream':
        b.add(G.cone(10), { color: '#E8B472', pos: [x, y + 0.08, z + 0.08], rot: [Math.PI, 0, 0], scale: [0.05, 0.14, 0.05] });
        b.add(G.sphere(10, 8), { color: c, pos: [x, y + 0.18, z + 0.08], scale: 0.06, emissive: 0.08 });
        break;
      case 'books':
      case 'music':
        if (style === 'music' && k % 2) b.add(G.cyl(1, 1, 18), { color: '#2E2A36', pos: [x, y + 0.13, z + 0.06], rot: [Math.PI / 2, 0, 0], scale: [0.13, 0.01, 0.13] });
        else for (let i = 0; i < 4; i++) b.add(G.box(), { color: PAL.flowers[(k + i) % PAL.flowers.length]!, pos: [x - 0.09 + i * 0.06, y + 0.1, z + 0.08], rot: [0, 0, (r() - 0.5) * 0.15], scale: [0.045, 0.18 + r() * 0.05, 0.12] });
        break;
      case 'ramen':
      case 'grocery':
        if (style === 'ramen') {
          b.add(G.dome(12, 6), { color: '#FFFFFF', pos: [x, y + 0.11, z + 0.08], rot: [Math.PI, 0, 0], scale: [0.11, 0.08, 0.11] });
          b.add(G.cyl(1, 1, 12), { color: '#C2443C', pos: [x, y + 0.115, z + 0.08], scale: [0.105, 0.01, 0.105] });
        } else {
          b.add(G.rbox(0.3, 0.1, 0.16, 0.02), { color: PAL.woodLight, pos: [x, y + 0.05, z + 0.08] });
          for (let i = 0; i < 3; i++) b.add(G.sphere(8, 6), { color: ['#F2504E', '#FFD23F', '#7CC47A'][k % 3]!, pos: [x - 0.08 + i * 0.08, y + 0.13, z + 0.08], scale: 0.05 });
        }
        break;
      case 'laundry':
        b.add(G.rbox(0.36, 0.36, 0.1, 0.04), { color: '#FFFFFF', pos: [x, y + 0.18, z + 0.04] });
        b.add(G.cyl(1, 1, 16), { color: '#8FC8F2', pos: [x, y + 0.17, z + 0.1], rot: [Math.PI / 2, 0, 0], scale: [0.11, 0.02, 0.11], emissive: 0.25 });
        break;
      case 'pharmacy':
        b.add(G.cyl(1, 1, 10), { color: k % 2 ? '#FFFFFF' : '#9BD8BE', pos: [x, y + 0.08, z + 0.08], scale: [0.04, 0.14, 0.04] });
        b.add(G.cyl(1, 1, 10), { color: '#3FA37C', pos: [x, y + 0.16, z + 0.08], scale: [0.03, 0.03, 0.03] });
        break;
      case 'bike':
        b.add(G.torus(0.12, 6, 16), { color: '#2E2A36', pos: [x, y + 0.16, z + 0.06], scale: 0.14 });
        break;
      case 'brick':
        b.add(G.rbox(0.22, 0.14, 0.16, 0.02), { color: '#D9B58A', pos: [x, y + 0.07, z + 0.08] });
        b.add(G.box(), { color: '#8C5E3B', pos: [x, y + 0.07, z + 0.165], scale: [0.015, 0.145, 0.004] });
        break;
      default:
        b.add(G.cyl(0.8, 1, 10), { color: '#D98A6A', pos: [x, y + 0.06, z + 0.08], scale: [0.06, 0.1, 0.06] });
        b.add(G.ico(1), { color: PAL.leaf, pos: [x, y + 0.17, z + 0.08], scale: 0.08, sway: 0.2 });
        break;
    }
  };
  for (let i = 0; i < n; i++) {
    const x = x0 + i * step;
    item(x, 0.8, i);
    if (i % 2 === 0 || n < 4) item(x + step * 0.3, 1.44, i + 3);
  }
  // Glass glints (two thin diagonal strips) sell the pane without a transparent pass.
  for (const gx of [cx - w * 0.28, cx + w * 0.12]) b.add(G.box(), { color: '#FFFFFF', pos: [gx, 1.5, zF + 0.24], rot: [0, 0, 0.7], scale: [0.04, 0.75, 0.005], emissive: 0.5 });
}

/** A cat silhouette sitting on a lit window sill, watching the heist. */
function addWindowCat(b: PartBuilder, x: number, sill: number, z: number, r: () => number): void {
  const c = r() < 0.5 ? '#3E3550' : '#5A4A62';
  const dx = (r() - 0.5) * 0.3;
  b.add(G.sphere(10, 8), { color: c, pos: [x + dx, sill + 0.22, z + 0.07], scale: [0.14, 0.17, 0.03] });
  b.add(G.sphere(10, 8), { color: c, pos: [x + dx, sill + 0.45, z + 0.07], scale: [0.1, 0.09, 0.03] });
  for (const s of [-1, 1]) b.add(G.cone(4), { color: c, pos: [x + dx + s * 0.06, sill + 0.55, z + 0.07], scale: [0.04, 0.07, 0.02] });
  for (const s of [-1, 1]) b.add(G.sphere(6, 4), { color: '#FFE14D', pos: [x + dx + s * 0.035, sill + 0.46, z + 0.1], scale: [0.018, 0.012, 0.005], emissive: 1.2 });
  b.add(G.torus(0.2, 5, 10, Math.PI), { color: c, pos: [x + dx + 0.13, sill + 0.12, z + 0.07], rot: [0, 0, -0.4], scale: 0.1 });
}

function addWindowPlant(b: PartBuilder, x: number, sill: number, z: number, r: () => number): void {
  b.add(G.cyl(0.8, 1, 10), { color: '#D98A6A', pos: [x, sill + 0.1, z + 0.08], scale: [0.09, 0.16, 0.09] });
  for (let i = 0; i < 4; i++) b.add(G.ico(1), { color: i % 2 ? PAL.leaf : PAL.leafDark, pos: [x + (r() - 0.5) * 0.18, sill + 0.28 + r() * 0.12, z + 0.08], scale: [0.09, 0.11, 0.05], sway: 0.25 });
}

// ---------------------------------------------------------------------------
// Other static boxes
// ---------------------------------------------------------------------------

function longFrame(def: StaticBoxDef): { L: number; T: number; yaw: number } {
  const longX = def.half.x >= def.half.y;
  return { L: 2 * (longX ? def.half.x : def.half.y), T: 2 * (longX ? def.half.y : def.half.x), yaw: longX ? 0 : HALF_PI };
}

function addWall(b: PartBuilder, def: StaticBoxDef): void {
  const { L, T, yaw } = longFrame(def);
  const r = rng(hashString(def.id));
  const h = Math.max(0.4, def.height);
  pushDef(b, def.center, def.angle);
  b.push(undefined, [0, yaw, 0]);
  if (def.style === 'hedge') {
    b.add(G.rbox(L, h, T, Math.min(0.3, T / 2), 2), { color: PAL.hedge, pos: [0, h / 2, 0], sway: 0.05 });
    for (let i = 0; i < Math.round(L * 1.5); i++) {
      b.add(G.ico(0), { color: PAL.flowers[i % PAL.flowers.length], pos: [-L / 2 + r() * L, h * (0.5 + r() * 0.5), (r() < 0.5 ? -1 : 1) * (T / 2 + 0.01)], scale: 0.06 });
    }
  } else {
    const col = def.style === 'brick' ? '#E39A82' : PAL.stone;
    b.add(G.box(), { color: col, pos: [0, h / 2, 0], scale: [L, h, T] });
    b.add(G.rbox(L + 0.1, 0.14, T + 0.12, 0.05, 1), { color: PAL.column, pos: [0, h + 0.05, 0] });
    b.add(G.box(), { color: shade(col, -0.1), pos: [0, 0.15, 0], scale: [L + 0.06, 0.3, T + 0.06] });
    // Stone blocks pattern.
    for (let y = 0.5; y < h - 0.2; y += 0.4) b.add(G.box(), { color: shade(col, 0.05), pos: [0, y, 0], scale: [L + 0.01, 0.035, T + 0.01] });
    // Ivy blobs.
    for (let i = 0; i < Math.round(L / 2.5); i++) {
      const x = -L / 2 + r() * L;
      b.add(G.ico(1), { color: r() < 0.5 ? PAL.leaf : PAL.leafDark, pos: [x, h * (0.4 + r() * 0.5), (r() < 0.5 ? -1 : 1) * T / 2], scale: [0.35, 0.3, 0.12], sway: 0.15 });
    }
  }
  b.pop();
  b.pop();
}

function addPlanter(b: PartBuilder, def: StaticBoxDef): void {
  const r = rng(hashString(def.id));
  const W = def.half.x * 2;
  const D = def.half.y * 2;
  const rimH = Math.min(0.55, Math.max(0.3, def.height * 0.55));
  pushDef(b, def.center, def.angle);
  const rim = 0.18;
  const woodCol = r() < 0.5 ? PAL.wood : '#D9C2A4';
  b.add(G.rbox(W, rimH, rim, 0.05, 1), { color: woodCol, pos: [0, rimH / 2, D / 2 - rim / 2] });
  b.add(G.rbox(W, rimH, rim, 0.05, 1), { color: woodCol, pos: [0, rimH / 2, -D / 2 + rim / 2] });
  b.add(G.rbox(rim, rimH, D - 2 * rim + 0.02, 0.05, 1), { color: woodCol, pos: [W / 2 - rim / 2, rimH / 2, 0] });
  b.add(G.rbox(rim, rimH, D - 2 * rim + 0.02, 0.05, 1), { color: woodCol, pos: [-W / 2 + rim / 2, rimH / 2, 0] });
  b.add(G.box(), { color: PAL.soil, pos: [0, rimH - 0.08, 0], scale: [W - 2 * rim, 0.1, D - 2 * rim] });
  // Hedge blobs along the inner perimeter + flower dots.
  const area = W * D;
  const blobs = Math.max(3, Math.round(area / 2.2));
  for (let i = 0; i < blobs; i++) {
    const x = (r() - 0.5) * (W - 0.6);
    const z = (r() - 0.5) * (D - 0.6);
    const s = 0.35 + r() * 0.3;
    b.add(G.ico(1), { color: r() < 0.5 ? PAL.leaf : PAL.leafDark, pos: [x, rimH + s * 0.45, z], scale: [s, s * 0.8, s], sway: 0.25 });
  }
  const flowers = Math.round(area * 1.6);
  for (let i = 0; i < flowers; i++) {
    const x = (r() - 0.5) * (W - 0.4);
    const z = (r() - 0.5) * (D - 0.4);
    b.add(G.ico(0), { color: PAL.flowers[Math.floor(r() * PAL.flowers.length)], pos: [x, rimH + 0.25 + r() * 0.35, z], scale: 0.09, sway: 0.4, emissive: 0.05 });
  }
  b.pop();
}

function addBench(b: PartBuilder, def: StaticBoxDef): void {
  const { L, T, yaw } = longFrame(def);
  pushDef(b, def.center, def.angle);
  b.push(undefined, [0, yaw, 0]);
  const seatY = 0.45;
  if (hashString(def.id) % 3 === 0) {
    // The bank guard's forgotten lunchbox (gingham cloth, a sandwich peeking out).
    const lx = L * 0.25;
    b.add(G.rbox(0.32, 0.14, 0.22, 0.03), { color: '#E8505B', pos: [lx, seatY + 0.1, 0] });
    b.add(G.rbox(0.33, 0.03, 0.23, 0.01), { color: '#FFFFFF', pos: [lx, seatY + 0.17, 0] });
    b.add(G.box(), { color: '#E8505B', pos: [lx, seatY + 0.18, 0], scale: [0.04, 0.012, 0.23] });
    b.add(G.cyl(1, 1, 3), { color: '#FFE3A8', pos: [lx + 0.24, seatY + 0.05, 0.02], rot: [Math.PI / 2, 0.3, 0], scale: [0.09, 0.05, 0.09] });
    b.add(G.cyl(1, 1, 3), { color: '#7CC47A', pos: [lx + 0.24, seatY + 0.075, 0.02], rot: [Math.PI / 2, 0.3, 0], scale: [0.085, 0.012, 0.085] });
  }
  for (let i = 0; i < 3; i++) {
    b.add(G.rbox(L, 0.05, Math.max(0.12, T / 3 - 0.03), 0.02, 1), { color: i % 2 ? PAL.woodLight : PAL.wood, pos: [0, seatY, -T / 2 + (i + 0.5) * (T / 3)] });
  }
  // Backrest on the -z side.
  for (let i = 0; i < 2; i++) {
    b.add(G.rbox(L, 0.12, 0.05, 0.02, 1), { color: PAL.wood, pos: [0, seatY + 0.2 + i * 0.18, -T / 2 - 0.03], rot: [-0.15, 0, 0] });
  }
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.15);
    b.add(G.box(), { color: PAL.lampPost, pos: [x, seatY / 2, 0], scale: [0.06, seatY, T * 0.9] });
    b.add(G.box(), { color: PAL.lampPost, pos: [x, seatY + 0.25, -T / 2 - 0.02], scale: [0.06, 0.55, 0.06] });
    b.add(G.rbox(0.08, 0.06, T * 0.8, 0.02, 1), { color: PAL.lampPost, pos: [x, seatY + 0.2, 0] });
  }
  b.pop();
  b.pop();
}

function addKiosk(b: PartBuilder, def: StaticBoxDef, ctx: Ctx): void {
  const st = buildingStyle(def.style);
  const { L, T, yaw } = longFrame(def);
  const r = rng(hashString(def.id));
  const h = Math.max(2.0, def.height);
  pushDef(b, def.center, def.angle);
  // Front faces the arena center when possible.
  let front = 1;
  if (ctx.center) {
    // Local +z of the (angle, yaw) frame in sim coordinates is (sin t, cos t), t = yaw - angle.
    const dx = ctx.center.x - def.center.x;
    const dy = ctx.center.y - def.center.y;
    const t = yaw - def.angle;
    front = dx * Math.sin(t) + dy * Math.cos(t) >= 0 ? 1 : -1;
  }
  b.push(undefined, [0, yaw + (front > 0 ? 0 : Math.PI), 0]);
  const stalls = Math.max(1, Math.round(L / 2.8));
  const sw = L / stalls;
  const counterH = 1.0;
  // Base cabinet.
  b.add(G.rbox(L, counterH, T, 0.08, 1), { color: st.body, pos: [0, counterH / 2, 0] });
  b.add(G.rbox(L + 0.12, 0.08, T + 0.16, 0.03, 1), { color: '#FFFFFF', pos: [0, counterH + 0.04, 0.04] });
  // Back wall + posts.
  b.add(G.box(), { color: shade(st.body, -0.08), pos: [0, (counterH + h - 0.35) / 2, -T / 2 + 0.08], scale: [L, h - 0.35 - counterH, 0.12] });
  for (let i = 0; i <= stalls; i++) {
    const x = -L / 2 + i * sw;
    b.add(G.box(), { color: '#FFFFFF', pos: [x * 0.98, (counterH + h) / 2, T / 2 - 0.08], scale: [0.09, h - counterH, 0.09] });
  }
  // Striped canopy per stall (scalloped front edge).
  for (let i = 0; i < stalls; i++) {
    const cx = -L / 2 + (i + 0.5) * sw;
    addAwning(b, cx, h - 0.3, -T / 2 + 0.1, sw + 0.04, T + 0.45, st.awning, 0.16);
  }
  // Goods on the counter.
  const goods = Math.round(L / 0.55);
  for (let i = 0; i < goods; i++) {
    const x = -L / 2 + 0.3 + i * ((L - 0.6) / Math.max(1, goods - 1));
    const z = 0.05 + r() * 0.15;
    if (def.style === 'tteokbokki') {
      if (i % 3 === 0) {
        b.add(G.cyl(1, 1, 16), { color: PAL.steelDark, pos: [x, counterH + 0.12, z], scale: [0.32, 0.1, 0.32] });
        for (let k = 0; k < 5; k++) b.add(G.capsule(0.03, 0.08, 2, 6), { color: '#F2504E', pos: [x + (r() - 0.5) * 0.35, counterH + 0.19, z + (r() - 0.5) * 0.35], rot: [HALF_PI, r() * 3, 0] });
      } else {
        b.add(G.cyl(1, 0.8, 10), { color: '#FFFFFF', pos: [x, counterH + 0.09, z], scale: [0.09, 0.12, 0.09] });
      }
    } else if (def.style === 'lemonade') {
      b.add(G.cyl(1, 1, 12), { color: '#FFF27A', pos: [x, counterH + 0.17, z], scale: [0.1, 0.26, 0.1], emissive: 0.2 });
      b.add(G.sphere(8, 6), { color: '#FFD23F', pos: [x + 0.12, counterH + 0.08, z + 0.1], scale: [0.07, 0.06, 0.06] });
    } else {
      b.add(G.sphere(10, 8), { color: i % 2 ? '#FFFFFF' : st.accent, pos: [x, counterH + 0.12, z], scale: [0.13, 0.11, 0.13] });
      b.add(G.cyl(1, 1, 8), { color: i % 2 ? '#FFFFFF' : st.accent, pos: [x + 0.13, counterH + 0.14, z], rot: [0, 0, -0.6], scale: [0.025, 0.09, 0.025] });
    }
  }
  // Big sign standing on the canopy, leaning back toward the high camera.
  b.push([0, h - 0.05, -T / 2 + 0.35], [-0.45, 0, 0]);
  b.add(G.box(), { color: '#FFFFFF', pos: [-0.6, 0.12, 0], scale: [0.06, 0.3, 0.06] });
  b.add(G.box(), { color: '#FFFFFF', pos: [0.6, 0.12, 0], scale: [0.06, 0.3, 0.06] });
  const kw = Math.min(3.4, Math.max(1.6, L * 0.7));
  addSignBoard(b, ctx, 0, 0.25 + kw / 8, 0, kw, () => resolveSign(ctx, def.signKey, def.style), st, def.signKey ?? `style:${def.style ?? 'default'}`);
  b.pop();
  // Hanging bulbs (string lights).
  for (let i = 0; i < Math.round(L / 0.5); i++) {
    const x = -L / 2 + 0.25 + i * 0.5;
    b.add(G.sphere(6, 4), { color: PAL.flowers[i % PAL.flowers.length], pos: [x, h - 0.98 - Math.sin((i / Math.max(1, L / 0.5)) * Math.PI) * 0.1, T / 2 + 0.2], scale: 0.05, emissive: 1.1 });
  }
  b.pop();
  b.pop();
}

function addBoxFountain(b: PartBuilder, def: StaticBoxDef): void {
  const W = def.half.x * 2;
  const D = def.half.y * 2;
  const rimH = Math.min(0.6, def.height);
  pushDef(b, def.center, def.angle);
  const t = 0.3;
  b.add(G.rbox(W, rimH, t, 0.08, 1), { color: PAL.stone, pos: [0, rimH / 2, D / 2 - t / 2] });
  b.add(G.rbox(W, rimH, t, 0.08, 1), { color: PAL.stone, pos: [0, rimH / 2, -D / 2 + t / 2] });
  b.add(G.rbox(t, rimH, D - 2 * t + 0.02, 0.08, 1), { color: PAL.stone, pos: [W / 2 - t / 2, rimH / 2, 0] });
  b.add(G.rbox(t, rimH, D - 2 * t + 0.02, 0.08, 1), { color: PAL.stone, pos: [-W / 2 + t / 2, rimH / 2, 0] });
  b.add(G.box(), { color: PAL.waterDeep, pos: [0, 0.05, 0], scale: [W - 2 * t, 0.1, D - 2 * t] });
  b.add(G.box(), { color: PAL.water, pos: [0, rimH - 0.15, 0], scale: [W - 2 * t, 0.04, D - 2 * t], bucket: 'water', emissive: 0.15 });
  const ph = Math.max(0.9, def.height);
  b.add(G.cyl(0.7, 1, 14), { color: PAL.column, pos: [0, ph / 2, 0], scale: [0.25, ph, 0.25] });
  b.add(G.cone(14), { color: PAL.water, pos: [0, ph + 0.25, 0], scale: [0.25, 0.5, 0.25], bucket: 'water', emissive: 0.3 });
  b.pop();
}

function addBarrier(b: PartBuilder, def: StaticBoxDef): void {
  const { L, yaw } = longFrame(def);
  pushDef(b, def.center, def.angle);
  b.push(undefined, [0, yaw, 0]);
  const n = Math.max(2, Math.round(L / 1.1) + 1);
  const h = Math.max(0.6, Math.min(1.0, def.height));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i * L) / (n - 1);
    b.add(G.cyl(1, 1, 12), { color: '#FFFFFF', pos: [x, h / 2, 0], scale: [0.12, h, 0.12] });
    b.add(G.cyl(1, 1, 12), { color: PAL.fenceStripe, pos: [x, h * 0.7, 0], scale: [0.125, 0.12, 0.125] });
    b.add(G.sphere(10, 6), { color: PAL.awningYellow, pos: [x, h + 0.02, 0], scale: [0.13, 0.08, 0.13] });
    if (i < n - 1) {
      // Chain between bollards (sagging beads).
      const x2 = -L / 2 + ((i + 1) * L) / (n - 1);
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        b.add(G.sphere(6, 4), { color: PAL.steelDark, pos: [x + (x2 - x) * t, h * 0.8 - Math.sin(t * Math.PI) * 0.18, 0], scale: 0.03 });
      }
    }
  }
  b.pop();
  b.pop();
}

/** Write one static box into a builder (world coordinates). */
export function addStaticBox(b: PartBuilder, def: StaticBoxDef, ctx: Ctx): void {
  switch (def.kind) {
    case 'building':
      addBuilding(b, def, ctx);
      break;
    case 'wall':
      addWall(b, def);
      break;
    case 'planter':
      addPlanter(b, def);
      break;
    case 'bench':
      addBench(b, def);
      break;
    case 'kiosk':
      addKiosk(b, def, ctx);
      break;
    case 'fountain':
      addBoxFountain(b, def);
      break;
    case 'barrier':
      addBarrier(b, def);
      break;
  }
}

// ---------------------------------------------------------------------------
// Static circles
// ---------------------------------------------------------------------------

function addTree(b: PartBuilder, def: StaticCircleDef): void {
  const r = rng(hashString(def.id));
  const h = Math.max(2.5, def.height);
  const blossom = r() < 0.3;
  const leafA = blossom ? '#FFC2D8' : PAL.leaf;
  const leafB = blossom ? '#FFA8C5' : PAL.leafDark;
  const leafC = blossom ? '#FFE0EB' : PAL.leafLight;
  b.push([def.center.x, 0, def.center.y]);
  // Only trunk + canopy join the occlusion fade group; the ground patch stays solid.
  const group = b.fadeGroup;
  b.fadeGroup = 0;
  // Grass patch + stone ring (the collider radius).
  b.add(G.disc(20), { color: PAL.grass, pos: [0, 0.006, 0], scale: [def.radius + 0.9, 1, def.radius + 0.9] });
  b.add(G.torus(0.22, 6, 20), { color: PAL.stone, pos: [0, 0.08, 0], rot: [HALF_PI, 0, 0], scale: [def.radius, def.radius, 0.6] });
  b.add(G.cyl(1, 1, 16), { color: PAL.soil, pos: [0, 0.05, 0], scale: [def.radius * 0.95, 0.1, def.radius * 0.95] });
  b.fadeGroup = group;
  // Trunk with a slight bend.
  const trunkH = h * 0.5;
  b.add(G.cyl(0.7, 1, 10), { color: PAL.trunk, pos: [0, trunkH / 2, 0], rot: [0, 0, (r() - 0.5) * 0.12], scale: [0.16, trunkH, 0.16] });
  b.add(G.cyl(0.6, 1, 8), { color: PAL.trunk, pos: [0.25, trunkH * 0.85, 0.05], rot: [0, 0, -0.9], scale: [0.07, 0.6, 0.07] });
  // Canopy: cluster of chunky blobs, top-heavy and round.
  const cr = Math.max(1.1, h * 0.3);
  const cy = h - cr * 0.85;
  const blobs: [number, number, number, number, string][] = [
    [0, cy, 0, cr, leafA],
    [cr * 0.6, cy - cr * 0.25, cr * 0.2, cr * 0.7, leafB],
    [-cr * 0.55, cy - cr * 0.2, -cr * 0.25, cr * 0.72, leafB],
    [cr * 0.1, cy + cr * 0.45, -cr * 0.1, cr * 0.62, leafC],
    [-cr * 0.2, cy - cr * 0.15, cr * 0.6, cr * 0.6, leafA],
  ];
  blobs.forEach(([x, y, z, s, c], i) => b.add(G.ico(i === 0 ? 2 : 1), { color: c, pos: [x, y, z], scale: [s, s * 0.88, s], sway: 0.35 }));
  // Fruit / blossom dots.
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const el = 0.2 + r() * 0.9;
    b.add(G.ico(0), {
      color: blossom ? '#FFFFFF' : r() < 0.5 ? '#FF8FA3' : '#FFD45C',
      pos: [Math.cos(a) * cr * 0.95 * Math.cos(el - 0.5), cy + Math.sin(el - 0.3) * cr * 0.8, Math.sin(a) * cr * 0.95 * Math.cos(el - 0.5)],
      scale: 0.09,
      sway: 0.35,
    });
  }
  b.pop();
}

function addLamp(b: PartBuilder, def: StaticCircleDef): void {
  const h = Math.max(2, def.height);
  b.push([def.center.x, 0, def.center.y]);
  b.add(G.cyl(1, 1, 12), { color: PAL.lampPost, pos: [0, 0.12, 0], scale: [0.2, 0.24, 0.2] });
  b.add(G.cyl(0.7, 1, 10), { color: PAL.lampPost, pos: [0, h / 2, 0], scale: [0.07, h, 0.07] });
  b.add(G.torus(0.25, 6, 14, Math.PI), { color: PAL.lampPost, pos: [0.0, h - 0.35, 0], scale: 0.25 });
  // Lantern.
  b.add(G.cone(6), { color: PAL.lampPost, pos: [0, h + 0.28, 0], scale: [0.26, 0.2, 0.26] });
  b.add(G.cyl(1, 0.8, 6), { color: '#FFE6A8', pos: [0, h + 0.05, 0], scale: [0.18, 0.32, 0.18], emissive: 1.4 });
  b.add(G.cyl(1, 1, 6), { color: PAL.lampPost, pos: [0, h - 0.13, 0], scale: [0.16, 0.05, 0.16] });
  b.add(G.sphere(6, 4), { color: PAL.gold, pos: [0, h + 0.42, 0], scale: 0.05 });
  // Glow halo (faces the fixed game camera) + warm pool of light on the ground.
  b.add(G.plane(), { color: '#D9994A', pos: [0, h + 0.05, 0.05], rot: [HALO_TILT, 0, 0], scale: [1.3, 1.3, 1], bucket: 'glow' });
  b.add(G.flat(), { color: '#9A6A34', pos: [0, 0.02, 0], scale: [5.0, 1, 5.0], bucket: 'glow' });
  b.pop();
}

function addPole(b: PartBuilder, def: StaticCircleDef): void {
  b.push([def.center.x, 0, def.center.y]);
  if (def.height < 1.3) {
    const h = def.height;
    b.add(G.cyl(0.9, 1, 12), { color: PAL.lampPost, pos: [0, h / 2, 0], scale: [Math.max(0.1, def.radius), h, Math.max(0.1, def.radius)] });
    b.add(G.sphere(12, 8), { color: PAL.awningYellow, pos: [0, h, 0], scale: [Math.max(0.1, def.radius) * 1.05, 0.1, Math.max(0.1, def.radius) * 1.05] });
    b.add(G.cyl(1, 1, 12), { color: '#FFFFFF', pos: [0, h * 0.75, 0], scale: [Math.max(0.1, def.radius) * 0.98 + 0.005, 0.08, Math.max(0.1, def.radius) * 0.98 + 0.005] });
  } else {
    const h = def.height;
    b.add(G.cyl(1, 1, 8), { color: '#DCE1EA', pos: [0, h / 2, 0], scale: [0.05, h, 0.05] });
    b.add(G.cyl(1, 1, 20), { color: '#FFFFFF', pos: [0, h - 0.3, 0.06], rot: [HALF_PI, 0, 0], scale: [0.32, 0.03, 0.32] });
    b.add(G.cyl(1, 1, 20), { color: '#5FA8E8', pos: [0, h - 0.3, 0.075], rot: [HALF_PI, 0, 0], scale: [0.27, 0.02, 0.27] });
    b.add(G.box(), { color: '#FFFFFF', pos: [0, h - 0.3, 0.09], scale: [0.3, 0.07, 0.01] });
    b.add(G.cone(3), { color: '#FFFFFF', pos: [0.17, h - 0.3, 0.09], rot: [0, 0, -HALF_PI], scale: [0.08, 0.1, 0.01] });
  }
  b.pop();
}

function addHydrant(b: PartBuilder, def: StaticCircleDef): void {
  const h = Math.max(0.6, Math.min(1.0, def.height));
  const r = Math.max(0.15, def.radius * 0.8);
  b.push([def.center.x, 0, def.center.y]);
  b.add(G.cyl(1, 1, 12), { color: PAL.hydrant, pos: [0, 0.06, 0], scale: [r * 1.3, 0.12, r * 1.3] });
  b.add(G.cyl(1, 1, 12), { color: PAL.hydrant, pos: [0, h * 0.45, 0], scale: [r, h * 0.8, r] });
  b.add(G.dome(12, 6), { color: PAL.hydrant, pos: [0, h * 0.85, 0], scale: [r * 1.05, r * 0.9, r * 1.05] });
  b.add(G.cyl(1, 1, 8), { color: PAL.gold, pos: [0, h * 0.85 + r * 0.9, 0], scale: [0.05, 0.08, 0.05] });
  b.add(G.cyl(1, 1, 12), { color: '#FFFFFF', pos: [0, h * 0.82, 0], scale: [r * 1.02, 0.06, r * 1.02] });
  for (const s of [-1, 1]) b.add(G.cyl(1, 1, 10), { color: PAL.gold, pos: [s * r * 1.1, h * 0.55, 0], rot: [0, 0, HALF_PI], scale: [0.07, 0.14, 0.07] });
  b.add(G.cyl(1, 1, 10), { color: PAL.gold, pos: [0, h * 0.55, r * 1.1], rot: [HALF_PI, 0, 0], scale: [0.09, 0.14, 0.09] });
  b.pop();
}

function addRoundFountain(b: PartBuilder, def: StaticCircleDef): void {
  const R = def.radius;
  const h = Math.max(1.0, def.height);
  b.push([def.center.x, 0, def.center.y]);
  // Basin.
  b.add(lathe([[R - 0.32, 0], [R, 0], [R + 0.05, 0.42], [R - 0.05, 0.55], [R - 0.3, 0.55], [R - 0.32, 0.1]], 40), { color: PAL.stone });
  b.add(G.torus(0.12, 6, 40), { color: PAL.column, pos: [0, 0.56, 0], rot: [HALF_PI, 0, 0], scale: [R - 0.17, R - 0.17, 0.5] });
  b.add(G.cyl(1, 1, 36), { color: PAL.waterDeep, pos: [0, 0.05, 0], scale: [R - 0.3, 0.1, R - 0.3] });
  b.add(G.disc(40), { color: PAL.water, pos: [0, 0.42, 0], scale: [R - 0.3, 1, R - 0.3], bucket: 'water', emissive: 0.12 });
  // Tiered center.
  b.add(G.cyl(0.8, 1, 16), { color: PAL.column, pos: [0, h * 0.45, 0], scale: [0.32, h * 0.9, 0.32] });
  b.add(lathe([[0.1, 0], [R * 0.45, 0.12], [R * 0.48, 0.22], [0.1, 0.18]], 28), { color: PAL.column, pos: [0, h * 0.9, 0] });
  b.add(G.disc(28), { color: PAL.water, pos: [0, h * 0.9 + 0.17, 0], scale: [R * 0.42, 1, R * 0.42], bucket: 'water', emissive: 0.2 });
  b.add(G.cyl(0.8, 1, 12), { color: PAL.column, pos: [0, h * 1.2, 0], scale: [0.12, h * 0.6, 0.12] });
  b.add(lathe([[0.05, 0], [R * 0.2, 0.08], [R * 0.22, 0.14], [0.05, 0.12]], 20), { color: PAL.column, pos: [0, h * 1.48, 0] });
  // Water: falling curtain from the upper bowl + jet on top.
  b.add(G.cyl(1, 1.15, 28, true), { color: PAL.water, pos: [0, h * 0.67, 0], scale: [R * 0.46, h * 0.46, R * 0.46], bucket: 'water', emissive: 0.25 });
  b.add(G.cone(12), { color: '#C8F1FF', pos: [0, h * 1.75, 0], scale: [0.1, 0.5, 0.1], bucket: 'water', emissive: 0.4 });
  b.add(G.sphere(10, 8), { color: '#C8F1FF', pos: [0, h * 1.6, 0], scale: [0.16, 0.12, 0.16], bucket: 'water', emissive: 0.35 });
  // Gold star finial + coins glinting in the basin.
  b.add(G.star(5, 0.45, 0.3), { color: PAL.gold, pos: [0, h * 2.05, 0], scale: 0.16, emissive: 0.3 });
  const rr = rng(hashString(def.id));
  for (let i = 0; i < 9; i++) {
    const a = rr() * Math.PI * 2;
    const d = 0.6 + rr() * (R - 1.1);
    b.add(G.cyl(1, 1, 10), { color: PAL.gold, pos: [Math.cos(a) * d, 0.12, Math.sin(a) * d], scale: [0.09, 0.02, 0.09], emissive: 0.3 });
  }
  b.pop();
}

function addStatue(b: PartBuilder, def: StaticCircleDef): void {
  const h = Math.max(1.5, def.height);
  const R = Math.max(0.5, def.radius);
  b.push([def.center.x, 0, def.center.y]);
  if (h >= 4) {
    // Clock tower ("시계탑").
    const s = R * 1.3;
    b.add(G.rbox(s * 2, 0.6, s * 2, 0.08, 1), { color: PAL.stone, pos: [0, 0.3, 0] });
    b.add(G.rbox(s * 1.5, h * 0.62, s * 1.5, 0.08, 1), { color: PAL.plaster, pos: [0, 0.6 + h * 0.31, 0] });
    for (let y = 1.4; y < h * 0.62; y += 0.9) b.add(G.box(), { color: PAL.plasterShade, pos: [0, y, 0], scale: [s * 1.52, 0.06, s * 1.52] });
    const top = 0.6 + h * 0.62;
    b.add(G.rbox(s * 1.8, 0.22, s * 1.8, 0.06, 1), { color: PAL.bankTrim, pos: [0, top + 0.1, 0] });
    b.add(G.rbox(s * 1.6, h * 0.2, s * 1.6, 0.1, 1), { color: PAL.column, pos: [0, top + 0.2 + h * 0.1, 0] });
    const cy = top + 0.2 + h * 0.1;
    for (let k = 0; k < 4; k++) {
      b.push([0, cy, 0], [0, (k * Math.PI) / 2, 0]);
      const z = s * 0.8 + 0.01;
      b.add(G.cyl(1, 1, 24), { color: PAL.gold, pos: [0, 0, z], rot: [HALF_PI, 0, 0], scale: [s * 0.62, 0.06, s * 0.62] });
      b.add(G.cyl(1, 1, 24), { color: '#FFFBF0', pos: [0, 0, z + 0.03], rot: [HALF_PI, 0, 0], scale: [s * 0.54, 0.03, s * 0.54], emissive: 0.45 });
      b.add(G.box(), { color: PAL.ink, pos: [0, s * 0.18, z + 0.06], scale: [0.05, s * 0.36, 0.02] });
      b.add(G.box(), { color: PAL.ink, pos: [s * 0.14, 0, z + 0.06], rot: [0, 0, 0.5], scale: [s * 0.3, 0.05, 0.02] });
      b.pop();
    }
    b.add(G.cone(4), { color: PAL.bankRoof, pos: [0, cy + h * 0.1 + 0.55, 0], rot: [0, Math.PI / 4, 0], scale: [s * 1.25, 1.1, s * 1.25] });
    b.add(G.sphere(10, 8), { color: PAL.gold, pos: [0, cy + h * 0.1 + 1.15, 0], scale: 0.16, emissive: 0.3 });
    // Lit arched windows on the shaft.
    for (let k = 0; k < 4; k++) {
      b.push([0, h * 0.4, 0], [0, (k * Math.PI) / 2 + Math.PI / 4 - Math.PI / 4, 0]);
      b.add(G.box(), { color: '#FFE2A6', pos: [0, 0, s * 0.75 + 0.01], scale: [0.35, 0.7, 0.03], emissive: 0.6 });
      b.pop();
    }
  } else {
    // Golden raccoon statue hugging a money sack on a pedestal (town mascot).
    const pH = h * 0.45;
    b.add(G.rbox(R * 1.5, pH, R * 1.5, 0.08, 1), { color: PAL.stone, pos: [0, pH / 2, 0] });
    b.add(G.rbox(R * 1.65, 0.15, R * 1.65, 0.05, 1), { color: PAL.column, pos: [0, pH, 0] });
    const s = (h - pH) / 1.1;
    b.push([0, pH + 0.07, 0], [0, -HALF_PI * 0.5, 0], s);
    const gold = PAL.gold;
    const goldD = PAL.goldDark;
    b.add(lathe([[0, 0.13], [0.26, 0.22], [0.28, 0.4], [0.2, 0.6], [0, 0.68]], 14), { color: gold });
    b.add(G.sphere(16, 12), { color: gold, pos: [0.01, 0.82, 0], scale: [0.29, 0.27, 0.31] });
    for (const z of [-1, 1]) b.add(G.sphere(10, 8), { color: goldD, pos: [-0.03, 1.02, z * 0.19], scale: [0.07, 0.1, 0.1] });
    b.add(G.sphere(10, 8), { color: goldD, pos: [0.25, 0.75, 0], scale: [0.11, 0.08, 0.1] });
    for (let k = 0; k < 3; k++) b.add(G.sphere(10, 8), { color: k % 2 ? goldD : gold, pos: [-0.3 - k * 0.12, 0.3 + k * 0.12, 0.1], scale: [0.12, 0.12, 0.12] });
    b.add(G.sphere(12, 10), { color: '#E9D6B0', pos: [0.3, 0.38, 0], scale: [0.2, 0.18, 0.18] });
    b.add(G.cyl(1, 1, 10), { color: goldD, pos: [0.32, 0.4, 0], rot: [0, 0, HALF_PI], scale: [0.08, 0.03, 0.08], emissive: 0.2 });
    b.pop();
    // Plaque.
    b.add(G.box(), { color: PAL.gold, pos: [0, pH * 0.55, R * 0.76], scale: [R * 0.8, 0.22, 0.03], emissive: 0.2 });
  }
  b.pop();
}

export function addStaticCircle(b: PartBuilder, def: StaticCircleDef): void {
  switch (def.kind) {
    case 'tree':
      addTree(b, def);
      break;
    case 'lamp':
      addLamp(b, def);
      break;
    case 'pole':
      addPole(b, def);
      break;
    case 'hydrant':
      addHydrant(b, def);
      break;
    case 'fountain':
      addRoundFountain(b, def);
      break;
    case 'statue':
      addStatue(b, def);
      break;
  }
}

// ---------------------------------------------------------------------------
// Decor (visual only)
// ---------------------------------------------------------------------------

export function addDecor(b: PartBuilder, def: DecorDef, seedKey = ''): void {
  const r = rng(hashString(`${def.kind}|${def.pos.x.toFixed(2)}|${def.pos.y.toFixed(2)}|${seedKey}`));
  const s = def.scale ?? 1;
  b.push([def.pos.x, 0, def.pos.y], [0, -def.angle, 0], s);
  switch (def.kind) {
    case 'flowers': {
      const n = 6 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * 0.55;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const hh = 0.18 + r() * 0.22;
        const col = def.color && r() < 0.65 ? def.color : PAL.flowers[Math.floor(r() * PAL.flowers.length)];
        b.add(G.cyl(1, 1, 4, true), { color: PAL.leafDark, pos: [x, hh / 2, z], scale: [0.015, hh, 0.015], sway: 0.3 });
        if (i % 2 === 0) b.add(G.ico(0), { color: PAL.leaf, pos: [x + 0.05, hh * 0.4, z], scale: [0.07, 0.03, 0.05], sway: 0.25 });
        // Blossom: a puffy flattened head + a yellow heart.
        b.add(G.ico(0), { color: col, pos: [x, hh + 0.02, z], scale: [0.09, 0.045, 0.09], sway: 0.5 });
        b.add(G.ico(0), { color: '#FFE14D', pos: [x, hh + 0.05, z], scale: 0.03, sway: 0.5 });
      }
      b.add(G.disc(14), { color: PAL.grassDark, pos: [0, 0.008, 0], scale: [0.7, 1, 0.7] });
      break;
    }
    case 'cone': {
      const col = def.color ?? PAL.cone;
      b.add(G.rbox(0.42, 0.05, 0.42, 0.02, 1), { color: col, pos: [0, 0.025, 0] });
      b.add(G.cyl(0.25, 1, 14), { color: col, pos: [0, 0.33, 0], scale: [0.17, 0.56, 0.17] });
      b.add(G.cyl(0.45, 0.62, 14, true), { color: '#FFFFFF', pos: [0, 0.38, 0], scale: [0.181, 0.1, 0.181] });
      b.add(G.cyl(0.7, 0.82, 14, true), { color: '#FFFFFF', pos: [0, 0.22, 0], scale: [0.181, 0.09, 0.181] });
      break;
    }
    case 'sign': {
      // A-frame sidewalk board with chalk doodles.
      const col = def.color ?? '#3E4A4F';
      for (const sd of [-1, 1]) {
        b.push([0, 0, sd * 0.16], [sd * 0.22, 0, 0]);
        b.add(G.rbox(0.62, 0.9, 0.04, 0.02, 1), { color: PAL.wood, pos: [0, 0.46, 0] });
        b.add(G.box(), { color: col, pos: [0, 0.5, sd * 0.022], scale: [0.5, 0.66, 0.01] });
        b.add(G.box(), { color: '#FFFFFF', pos: [-0.05, 0.65, sd * 0.028], rot: [0, 0, 0.1], scale: [0.3, 0.035, 0.005] });
        b.add(G.box(), { color: '#FFD45C', pos: [0.02, 0.5, sd * 0.028], rot: [0, 0, -0.05], scale: [0.36, 0.035, 0.005] });
        b.add(G.sphere(6, 4), { color: '#FF8FA3', pos: [0.12, 0.35, sd * 0.028], scale: [0.06, 0.06, 0.004] });
        b.pop();
      }
      break;
    }
    case 'crate': {
      const col = def.color ?? PAL.wood;
      b.add(G.rbox(0.62, 0.55, 0.62, 0.03, 1), { color: col, pos: [0, 0.275, 0] });
      for (const y of [0.08, 0.47]) {
        b.add(G.box(), { color: shade(col, -0.12), pos: [0, y, 0], scale: [0.64, 0.07, 0.64] });
      }
      b.add(G.box(), { color: shade(col, -0.12), pos: [0, 0.28, 0.315], rot: [0, 0, 0.75], scale: [0.62, 0.06, 0.02] });
      b.add(G.box(), { color: shade(col, -0.12), pos: [0.315, 0.28, 0], rot: [0.75, 0, 0], scale: [0.02, 0.06, 0.62] });
      if (r() < 0.5) {
        for (let i = 0; i < 4; i++) b.add(G.sphere(8, 6), { color: i % 2 ? '#FF6B6B' : '#FFD45C', pos: [(r() - 0.5) * 0.35, 0.6, (r() - 0.5) * 0.35], scale: 0.09 });
      }
      break;
    }
    case 'umbrella': {
      const col = def.color ?? PAL.awningRed;
      // Table + stools.
      b.add(G.cyl(1, 1, 16), { color: '#FFFFFF', pos: [0, 0.72, 0], scale: [0.42, 0.04, 0.42] });
      b.add(G.cyl(1, 1, 8), { color: PAL.lampPost, pos: [0, 0.36, 0], scale: [0.04, 0.72, 0.04] });
      b.add(G.cyl(1, 1, 12), { color: PAL.lampPost, pos: [0, 0.02, 0], scale: [0.25, 0.04, 0.25] });
      for (const a of [0.4, 2.6, 4.4]) {
        b.add(G.cyl(1, 1, 12), { color: col, pos: [Math.cos(a) * 0.65, 0.45, Math.sin(a) * 0.65], scale: [0.17, 0.06, 0.17] });
        b.add(G.cyl(1, 1, 6), { color: PAL.lampPost, pos: [Math.cos(a) * 0.65, 0.22, Math.sin(a) * 0.65], scale: [0.03, 0.44, 0.03] });
      }
      // Pole + striped canopy.
      b.add(G.cyl(1, 1, 8), { color: '#FFFFFF', pos: [0, 1.3, 0], scale: [0.03, 1.7, 0.03] });
      const segs = 8;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        b.add(new THREE.ConeGeometry(1.05, 0.42, 1, 1, true, a, (Math.PI * 2) / segs), {
          color: i % 2 ? '#FFFFFF' : col,
          pos: [0, 2.12, 0],
          bucket: 'double',
          sway: 0.15,
        });
      }
      b.add(G.sphere(8, 6), { color: col, pos: [0, 2.36, 0], scale: 0.06 });
      break;
    }
    case 'trash': {
      const col = def.color ?? PAL.trash;
      b.add(G.cyl(0.88, 1, 16), { color: col, pos: [0, 0.38, 0], scale: [0.26, 0.76, 0.26] });
      b.add(G.dome(16, 6), { color: shade(col, -0.1), pos: [0, 0.76, 0], scale: [0.27, 0.12, 0.27] });
      b.add(G.box(), { color: PAL.ink, pos: [0, 0.65, 0.22], scale: [0.2, 0.06, 0.04] });
      b.add(G.cyl(1, 1, 12, true), { color: '#FFFFFF', pos: [0, 0.48, 0], scale: [0.25, 0.08, 0.25] });
      b.add(G.sphere(6, 4), { color: '#FFFFFF', pos: [0, 0.89, 0], scale: [0.05, 0.03, 0.05] });
      break;
    }
    case 'bush': {
      const n = 3 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r();
        const d = i === 0 ? 0 : 0.28;
        const sz = i === 0 ? 0.5 : 0.36 + r() * 0.1;
        b.add(G.ico(1), { color: def.color ?? (i % 2 ? PAL.leafDark : PAL.leaf), pos: [Math.cos(a) * d, sz * 0.75, Math.sin(a) * d], scale: [sz, sz * 0.85, sz], sway: 0.18 });
      }
      for (let i = 0; i < 6; i++) {
        const a = r() * Math.PI * 2;
        b.add(G.sphere(6, 4), { color: PAL.flowers[i % PAL.flowers.length], pos: [Math.cos(a) * 0.45, 0.4 + r() * 0.35, Math.sin(a) * 0.45], scale: 0.05, sway: 0.2 });
      }
      break;
    }
    case 'puddle': {
      const col = def.color ?? PAL.water;
      b.add(G.disc(20), { color: col, pos: [0, 0.008, 0], scale: [0.9, 1, 0.6], bucket: 'water', emissive: 0.15 });
      b.add(G.disc(16), { color: col, pos: [0.5, 0.008, 0.2], scale: [0.5, 1, 0.4], bucket: 'water', emissive: 0.15 });
      b.add(G.disc(12), { color: '#E6FAFF', pos: [-0.25, 0.011, -0.15], scale: [0.25, 1, 0.06], bucket: 'water', emissive: 0.5 });
      break;
    }
    case 'arrow': {
      const col = def.color ?? '#FFFFFF';
      b.add(G.box(), { color: col, pos: [-0.25, 0.01, 0], scale: [0.9, 0.012, 0.3] });
      const tri = new THREE.Shape();
      tri.moveTo(0, -0.42);
      tri.lineTo(0.55, 0);
      tri.lineTo(0, 0.42);
      tri.closePath();
      b.add(new THREE.ShapeGeometry(tri).rotateX(-HALF_PI), { color: col, pos: [0.2, 0.016, 0] });
      break;
    }
    case 'balloon': {
      const base = def.color;
      b.add(G.cyl(1, 1, 10), { color: PAL.steelDark, pos: [0, 0.06, 0], scale: [0.12, 0.12, 0.12] });
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.3;
        const hx = Math.cos(a) * 0.32;
        const hz = Math.sin(a) * 0.32;
        const hy = 1.9 + i * 0.22;
        const col = i === 0 && base ? base : PAL.balloon[(i + Math.floor(r() * 5)) % PAL.balloon.length];
        const curve = new THREE.LineCurve3(new THREE.Vector3(0, 0.12, 0), new THREE.Vector3(hx, hy - 0.3, hz));
        b.add(new THREE.TubeGeometry(curve, 1, 0.008, 3, false), { color: '#FFFFFF', sway: 0.6 });
        b.add(G.sphere(12, 8), { color: col, pos: [hx, hy, hz], scale: [0.26, 0.31, 0.26], sway: 1.0, emissive: 0.1 });
        b.add(G.cone(6), { color: col, pos: [hx, hy - 0.32, hz], scale: [0.05, 0.06, 0.05], sway: 1.0 });
        b.add(G.sphere(6, 4), { color: '#FFFFFF', pos: [hx - 0.08, hy + 0.1, hz + 0.12], scale: [0.05, 0.08, 0.03], sway: 1.0, emissive: 0.5 });
      }
      break;
    }
  }
  b.pop();
}

// ---------------------------------------------------------------------------
// Ground, boundary and outskirts
// ---------------------------------------------------------------------------

/** Outskirts band widths (m) outside the arena. */
const SIDEWALK = 3;
const STREET = 8;
const OUTER_WALK = 3;
const BACKDROP_DEPTH = 7;

/** Ground planes: far grass, street ring, sidewalk ring and the arena paving. */
export function createGround(layout: LayoutDef, opts: { detail?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ground';
  const sx = layout.size.x;
  const sy = layout.size.y;
  const cx = sx / 2;
  const cz = sy / 2;
  // Content 2.0: 'yard' / 'funpark' ground art arrives with C7b; until then they use the plaza paving.
  const ls = layout.groundStyle ?? 'plaza';
  const style: GroundStyle = ls === 'yard' || ls === 'funpark' ? 'plaza' : ls;
  const plane = (w: number, d: number, y: number, mat: THREE.Material, name: string): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-HALF_PI), mat);
    m.position.set(cx, y, cz);
    m.receiveShadow = true;
    m.name = name;
    m.userData.noOutline = true;
    g.add(m);
    return m;
  };
  plane(sx + 360, sy + 360, -0.06, createToonMaterial({ color: PAL.grass, rim: 0 }), 'ground:grass');
  const streetW = sx + 2 * (SIDEWALK + STREET);
  const streetD = sy + 2 * (SIDEWALK + STREET);
  const asphalt = asphaltTexture().clone();
  asphalt.needsUpdate = true;
  asphalt.repeat.set(streetW / 8, streetD / 8);
  plane(streetW + 2 * (OUTER_WALK + BACKDROP_DEPTH + 6), streetD + 2 * (OUTER_WALK + BACKDROP_DEPTH + 6), -0.045, createToonMaterial({ color: '#E7DCCB', rim: 0 }), 'ground:outer');
  plane(streetW, streetD, -0.03, createToonMaterial({ map: asphalt, rim: 0 }), 'ground:street');
  const walk = pavingTexture('plaza').clone();
  walk.needsUpdate = true;
  walk.repeat.set((sx + 2 * SIDEWALK) / PAVING_TILE_METERS, (sy + 2 * SIDEWALK) / PAVING_TILE_METERS);
  plane(sx + 2 * SIDEWALK, sy + 2 * SIDEWALK, -0.015, createToonMaterial({ map: walk, color: '#F4ECE0', rim: 0 }), 'ground:sidewalk');
  const pave = pavingTexture(style).clone();
  pave.needsUpdate = true;
  pave.repeat.set(sx / PAVING_TILE_METERS, sy / PAVING_TILE_METERS);
  plane(sx, sy, 0, createToonMaterial({ map: pave, rim: 0 }), 'ground:arena');
  // Painted paths, lanes, manholes, grass rings, wear and chalk doodles (groundArt.ts).
  if ((opts.detail ?? 20) > 0) {
    const overlay = createGroundOverlay(layout, opts.detail ?? 20);
    if (overlay) g.add(overlay);
  }
  return g;
}

/** Arena edge (visual for the sim's solid boundary): low cute picket fence + hedge + curbs. */
function addBoundary(chunks: ChunkGrid, layout: LayoutDef, density = 1): void {
  const sx = layout.size.x;
  const sy = layout.size.y;
  const r = rng(hashString(layout.id) + 3);
  // Picket fence just outside the arena on all four sides (low on the camera side).
  const sides: { a: [number, number]; b: [number, number]; out: [number, number]; h: number }[] = [
    { a: [0, 0], b: [sx, 0], out: [0, -1], h: 0.95 },
    { a: [0, sy], b: [sx, sy], out: [0, 1], h: 0.7 },
    { a: [0, 0], b: [0, sy], out: [-1, 0], h: 0.95 },
    { a: [sx, 0], b: [sx, sy], out: [1, 0], h: 0.95 },
  ];
  for (const sd of sides) {
    const len = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
    const dx = (sd.b[0] - sd.a[0]) / len;
    const dz = (sd.b[1] - sd.a[1]) / len;
    const yaw = -Math.atan2(dz, dx);
    const step = 0.42;
    for (let d = 0.2; d < len; d += step) {
      const x = sd.a[0] + dx * d + sd.out[0] * 0.25;
      const z = sd.a[1] + dz * d + sd.out[1] * 0.25;
      const b = chunks.at(x, z);
      b.add(G.box(), { color: PAL.fence, pos: [x, sd.h / 2, z], rot: [0, yaw, 0], scale: [0.13, sd.h, 0.06] });
      b.add(G.cone(4), { color: PAL.fence, pos: [x, sd.h + 0.06, z], rot: [0, yaw + Math.PI / 4, 0], scale: [0.09, 0.12, 0.09] });
    }
    // Rails + curb + hedge strip, in 6 m pieces so they land in the right chunks.
    for (let d = 0; d < len; d += 6) {
      const seg = Math.min(6, len - d);
      const mx = sd.a[0] + dx * (d + seg / 2);
      const mz = sd.a[1] + dz * (d + seg / 2);
      const b = chunks.at(mx, mz);
      for (const y of [sd.h * 0.35, sd.h * 0.75]) {
        b.add(G.box(), { color: PAL.fence, pos: [mx + sd.out[0] * 0.25, y, mz + sd.out[1] * 0.25], rot: [0, yaw, 0], scale: [seg, 0.07, 0.04] });
      }
      b.add(G.box(), { color: PAL.curb, pos: [mx + sd.out[0] * 0.3, 0.06, mz + sd.out[1] * 0.3], rot: [0, yaw, 0], scale: [seg + 0.6, 0.12, 0.6] });
      // Street curb.
      const co = SIDEWALK;
      b.add(G.box(), { color: PAL.curbDark, pos: [mx + sd.out[0] * co, 0.03, mz + sd.out[1] * co], rot: [0, yaw, 0], scale: [seg + 0.3, 0.12, 0.25] });
      // Hedge blobs behind the fence (thinned with the decor density).
      for (let k = 0; k < 3; k++) {
        if (!keepDecor(`hedge|${sd.a.join(',')}|${d}|${k}`, density)) continue;
        const t = (k + r()) / 3;
        const hx = sd.a[0] + dx * (d + seg * t) + sd.out[0] * 0.9;
        const hz = sd.a[1] + dz * (d + seg * t) + sd.out[1] * 0.9;
        const s = 0.45 + r() * 0.2;
        b.add(G.ico(1), { color: r() < 0.5 ? PAL.hedge : PAL.leafDark, pos: [hx, s * 0.6, hz], scale: [s * 1.3, s * (sd.h < 0.8 ? 0.9 : 1.2), s], sway: 0.12 });
      }
    }
  }
  // Street markings: dashed center line + crosswalks at each side's middle.
  const streetMid = SIDEWALK + STREET / 2;
  const lines: { x0: number; z0: number; x1: number; z1: number }[] = [
    { x0: -streetMid, z0: -streetMid, x1: sx + streetMid, z1: -streetMid },
    { x0: -streetMid, z0: sy + streetMid, x1: sx + streetMid, z1: sy + streetMid },
    { x0: -streetMid, z0: -streetMid, x1: -streetMid, z1: sy + streetMid },
    { x0: sx + streetMid, z0: -streetMid, x1: sx + streetMid, z1: sy + streetMid },
  ];
  for (const l of lines) {
    const len = Math.hypot(l.x1 - l.x0, l.z1 - l.z0);
    const dx = (l.x1 - l.x0) / len;
    const dz = (l.z1 - l.z0) / len;
    const yaw = -Math.atan2(dz, dx);
    for (let d = 1; d < len; d += 3) {
      const x = l.x0 + dx * d;
      const z = l.z0 + dz * d;
      chunks.at(x, z).add(G.box(), { color: PAL.asphaltLine, pos: [x, -0.02, z], rot: [0, yaw, 0], scale: [1.5, 0.02, 0.15] });
    }
    // Crosswalk at the middle.
    const mx = (l.x0 + l.x1) / 2;
    const mz = (l.z0 + l.z1) / 2;
    for (let k = -3; k <= 3; k++) {
      chunks.at(mx, mz).add(G.box(), { color: '#FFFFFF', pos: [mx + dx * k * 0.9, -0.018, mz + dz * k * 0.9], rot: [0, yaw, 0], scale: [0.5, 0.02, STREET - 1.2] });
    }
  }
}

/** Backdrop rows outside the street: shops N/E/W facing the plaza, a low park strip south. */
function addBackdrop(chunks: ChunkGrid, layout: LayoutDef, ctx: Ctx, density = 1): void {
  const sx = layout.size.x;
  const sy = layout.size.y;
  const r = rng(hashString(layout.id) + 11);
  const off = SIDEWALK + STREET + OUTER_WALK + BACKDROP_DEPTH / 2;
  let signIdx = 0;
  const row = (x0: number, x1: number, z: number, angle: number, horizontal: boolean): void => {
    let p = x0;
    while (p < x1 - 3) {
      const w = Math.min(x1 - p, 6 + r() * 4);
      const h = 5 + r() * 6;
      const sgn = BACKDROP_SIGNS[signIdx % BACKDROP_SIGNS.length];
      const key = `sign.backdrop.${signIdx % BACKDROP_SIGNS.length}`;
      signIdx++;
      const center = horizontal ? { x: p + w / 2, y: z } : { x: z, y: p + w / 2 };
      const def: StaticBoxDef = {
        id: `backdrop.${signIdx}`,
        kind: 'building',
        center,
        half: horizontal ? { x: w / 2 - 0.15, y: BACKDROP_DEPTH / 2 } : { x: BACKDROP_DEPTH / 2, y: w / 2 - 0.15 },
        angle,
        height: h,
        style: sgn.style,
        signKey: key,
      };
      // Resolver first ('sign.backdrop.N'), else the built-in name in the resolver's language.
      const local: Ctx = {
        ...ctx,
        resolve: (k) => {
          if (k !== key) return ctx.resolve(k);
          const t = ctx.resolve(k);
          if (t && t !== k) return t;
          return ctx.lang() === 'en' ? sgn.en : sgn.text;
        },
      };
      addBuilding(chunks.at(center.x, center.y), def, local, true);
      p += w;
    }
  };
  row(-off + BACKDROP_DEPTH / 2, sx + off - BACKDROP_DEPTH / 2, -off, 0, true); // north
  row(-off + BACKDROP_DEPTH / 2 + 1, sy + off - BACKDROP_DEPTH / 2, -off, 0, false); // west
  row(-off + BACKDROP_DEPTH / 2 + 1, sy + off - BACKDROP_DEPTH / 2, sx + off, 0, false); // east
  // South park strip: trees, lamps, benches (nothing tall right in front of the camera).
  const sz = sy + SIDEWALK + STREET + OUTER_WALK + 2.5;
  for (let x = -6; x < sx + 6; x += 7 + r() * 3) {
    const t: StaticCircleDef = { id: `backdrop.tree.${x.toFixed(1)}`, kind: 'tree', center: { x, y: sz + r() * 2 }, radius: 0.5, height: 3.6 + r() * 0.8 };
    if (keepDecor(t.id, density)) addTree(chunks.at(t.center.x, t.center.y), t);
  }
  for (let x = 2; x < sx; x += 12) {
    addLamp(chunks.at(x, sz - 1.8), { id: `backdrop.lamp.${x}`, kind: 'lamp', center: { x, y: sz - 1.8 }, radius: 0.15, height: 3.0 });
    addBench(chunks.at(x + 3, sz - 1.6), { id: `backdrop.bench.${x}`, kind: 'bench', center: { x: x + 3, y: sz - 1.6 }, half: { x: 0.9, y: 0.3 }, angle: Math.PI, height: 0.5 });
  }
  // Street lamps along the outer sidewalk of the other three sides.
  const lampOff = SIDEWALK + STREET + 1.2;
  for (let x = 4; x < sx; x += 14) {
    addLamp(chunks.at(x, -lampOff), { id: `bl.n${x}`, kind: 'lamp', center: { x, y: -lampOff }, radius: 0.15, height: 3.2 });
  }
  for (let y = 6; y < sy; y += 14) {
    addLamp(chunks.at(-lampOff, y), { id: `bl.w${y}`, kind: 'lamp', center: { x: -lampOff, y }, radius: 0.15, height: 3.2 });
    addLamp(chunks.at(sx + lampOff, y), { id: `bl.e${y}`, kind: 'lamp', center: { x: sx + lampOff, y }, radius: 0.15, height: 3.2 });
  }
  // A couple of parked toy cars on the street.
  const cars: [number, number, number, string][] = [
    [sx * 0.25, -SIDEWALK - 1.6, 0, '#FF9FBF'],
    [sx * 0.7, -SIDEWALK - 1.6, Math.PI, '#8FE3C8'],
    [-SIDEWALK - 1.6, sy * 0.3, HALF_PI, '#FFD45C'],
    [sx + SIDEWALK + 1.6, sy * 0.65, -HALF_PI, '#B9A3F0'],
  ];
  for (const [x, z, a, col] of cars) addToyCar(chunks.at(x, z), x, z, a, col);
}

function addToyCar(b: PartBuilder, x: number, z: number, yaw: number, col: string): void {
  b.push([x, 0, z], [0, yaw, 0]);
  b.add(G.rbox(3.2, 0.7, 1.6, 0.3, 2), { color: col, pos: [0, 0.6, 0] });
  b.add(G.rbox(1.8, 0.6, 1.4, 0.28, 2), { color: '#FFF6E8', pos: [-0.2, 1.15, 0] });
  b.add(G.box(), { color: PAL.glass, pos: [-0.2, 1.17, 0], scale: [1.85, 0.36, 1.3], emissive: 0.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.cyl(1, 1, 14), { color: PAL.black, pos: [sx * 1.0, 0.3, sz * 0.72], rot: [HALF_PI, 0, 0], scale: [0.3, 0.2, 0.3] });
    b.add(G.cyl(1, 1, 10), { color: PAL.silver, pos: [sx * 1.0, 0.3, sz * 0.83], rot: [HALF_PI, 0, 0], scale: [0.14, 0.02, 0.14] });
  }
  for (const sz of [-1, 1]) b.add(G.sphere(8, 6), { color: '#FFF3C4', pos: [1.6, 0.65, sz * 0.5], scale: [0.04, 0.1, 0.12], emissive: 0.8 });
  b.pop();
}

// ---------------------------------------------------------------------------
// Chunked merge
// ---------------------------------------------------------------------------

const CHUNK = 32;

class ChunkGrid {
  readonly builders = new Map<string, PartBuilder>();
  keyAt(x: number, z: number): string {
    return `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  }
  at(x: number, z: number): PartBuilder {
    const key = this.keyAt(x, z);
    let b = this.builders.get(key);
    if (!b) this.builders.set(key, (b = new PartBuilder()));
    return b;
  }
}

export interface SceneryStats {
  meshes: number;
  /** Main-pass draw calls (one per mesh); shadow passes add one per shadow-casting mesh. */
  drawCalls: number;
  shadowCasters: number;
  triangles: number;
  chunks: number;
  /** Objects that fade as a whole when they hide the player (buildings, kiosks, trees...). */
  fadeGroups: number;
  /** Ghost twins (hidden unless something is faded / x-rayed in their chunk). */
  ghosts: number;
}

// ---------------------------------------------------------------------------
// Occlusion fade groups + ghost twins
// ---------------------------------------------------------------------------

interface FadeGroupInfo {
  id: number;
  /** Scenery-local AABB of the whole object. */
  min: THREE.Vector3;
  max: THREE.Vector3;
  fade: number;
  chunk: string;
}

interface GhostChunk {
  ghosts: THREE.Mesh[];
  /** Scenery-local bounds of the chunk geometry. */
  box: THREE.Box3;
  groups: FadeGroupInfo[];
}

/** Fade box (scenery-local AABB) for a static box that should fade as a whole, or null. */
function fadeBoxForStatic(def: StaticBoxDef): THREE.Box3 | null {
  let margin = 0;
  let top = 0;
  const h = def.height;
  if (def.kind === 'building') {
    const st = buildingStyle(def.style);
    const D = 2 * Math.min(def.half.x, def.half.y);
    margin = st.roofKind === 'hanok' ? 1.2 : 0.9;
    top = Math.max(2.5, h) + (st.roofKind === 'hanok' ? hanokRise(D) + 0.8 : st.roofKind === 'gable' ? Math.min(2.2, D * 0.55) + 0.3 : 1.9);
  } else if (def.kind === 'kiosk') {
    margin = 0.75;
    top = Math.max(2, h) + 1.3;
  } else if (def.kind === 'wall' && h >= 2) {
    margin = 0.2;
    top = h + 0.25;
  } else {
    return null;
  }
  const c = Math.abs(Math.cos(def.angle));
  const sn = Math.abs(Math.sin(def.angle));
  const ex = def.half.x * c + def.half.y * sn + margin;
  const ez = def.half.x * sn + def.half.y * c + margin;
  return new THREE.Box3(new THREE.Vector3(def.center.x - ex, 0, def.center.y - ez), new THREE.Vector3(def.center.x + ex, top, def.center.y + ez));
}

/** Fade box for a static circle (tree canopy, clock tower / statue), or null. */
function fadeBoxForCircle(def: StaticCircleDef): THREE.Box3 | null {
  let r = 0;
  let top = 0;
  if (def.kind === 'tree') {
    const h = Math.max(2.5, def.height);
    r = Math.max(1.1, h * 0.3) * 1.45;
    top = h + 0.3;
  } else if (def.kind === 'statue' && def.height >= 2.4) {
    const R = Math.max(0.5, def.radius);
    r = R * 1.3 + 0.4;
    top = def.height >= 4 ? def.height + 2.2 : def.height + 0.3;
  } else {
    return null;
  }
  return new THREE.Box3(new THREE.Vector3(def.center.x - r, 0, def.center.y - r), new THREE.Vector3(def.center.x + r, top, def.center.y + r));
}

function ghostMaterialFor(bucket: string, signGhost: THREE.Material): THREE.Material | null {
  switch (bucket) {
    case 'vc':
      return matSceneryGhost();
    case 'double':
      return matSceneryDoubleGhost();
    case 'sign':
      return signGhost;
    default:
      return null;
  }
}

/** Add hidden ghost twins (shared geometry) for every occlusion-capable mesh of a chunk. */
function attachGhosts(group: THREE.Group, signGhost: THREE.Material): GhostChunk {
  const ghosts: THREE.Mesh[] = [];
  const box = new THREE.Box3();
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    if (m.geometry.boundingBox) box.union(m.geometry.boundingBox);
    const bucket = m.name.split(':').pop() ?? '';
    const mat = ghostMaterialFor(bucket, signGhost);
    if (!mat) continue;
    const gm = new THREE.Mesh(m.geometry, mat);
    gm.name = `${m.name}:ghost`;
    gm.visible = false;
    gm.castShadow = false;
    gm.receiveShadow = true;
    gm.renderOrder = 1;
    gm.userData.noOutline = true;
    gm.userData.ghost = true;
    group.add(gm);
    ghosts.push(gm);
  }
  return { ghosts, box, groups: [] };
}

const _inv = new THREE.Matrix4();
const _cam = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _samples = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _wbox = new THREE.Box3();
const FADE_IN_RATE = 9;
const FADE_OUT_RATE = 3.5;

/**
 * Per-frame occlusion for one scenery: fade every group that stands between the camera and
 * the focus (or the area just around it: the carried safe, the feet, a step to each side),
 * then show the ghost twins of chunks that have something faded or x-rayed.
 */
function updateSceneryOcclusion(root: THREE.Object3D, chunks: Iterable<GhostChunk>, groups: readonly FadeGroupInfo[], focus: Readonly<OcclusionFocus>, dt: number): void {
  let samples = 0;
  if (focus.active) {
    _inv.copy(root.matrixWorld).invert();
    _cam.copy(focus.camera).applyMatrix4(_inv);
    _tgt.copy(focus.target).applyMatrix4(_inv);
    _dir.set(_cam.x - _tgt.x, 0, _cam.z - _tgt.z);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
    _dir.normalize();
    _right.set(_dir.z, 0, -_dir.x);
    _samples[0].copy(_tgt);
    _samples[1].set(_tgt.x, Math.max(0.15, _tgt.y - 0.45), _tgt.z);
    _samples[2].copy(_tgt).addScaledVector(_right, 1.0);
    _samples[3].copy(_tgt).addScaledVector(_right, -1.0);
    _samples[4].copy(_tgt).addScaledVector(_dir, 0.9);
    samples = 5;
  }
  for (const g of groups) {
    let hit = false;
    for (let i = 0; i < samples && !hit; i++) {
      const p = _samples[i];
      // A sample inside the object itself (player hugging a wall) says nothing about occlusion.
      if (p.x > g.min.x - 0.1 && p.x < g.max.x + 0.1 && p.z > g.min.z - 0.1 && p.z < g.max.z + 0.1 && p.y < g.max.y) continue;
      hit = segmentHitsAABB(_cam, p, g.min, g.max, 0, 0.995);
    }
    const target = hit ? 1 : 0;
    const rate = target > g.fade ? FADE_IN_RATE : FADE_OUT_RATE;
    g.fade += (target - g.fade) * (1 - Math.exp(-rate * dt));
    if (target === 0 && g.fade < 0.01) g.fade = 0;
    if (target === 1 && g.fade > 0.99) g.fade = 1;
    setGroupFade(g.id, g.fade);
  }
  for (const c of chunks) {
    let on = false;
    for (const g of c.groups) if (g.fade > 0.004) on = true;
    if (!on && focus.active) {
      _wbox.copy(c.box).applyMatrix4(root.matrixWorld);
      on = focusTouchesBox(_wbox);
    }
    for (const gm of c.ghosts) gm.visible = on;
  }
}

/**
 * The merged static scenery of a layout. It IS a THREE.Group (add it to the scene directly),
 * with draw-call stats, a sign-text refresh for language changes, and dispose(). It fades
 * occluding buildings/trees automatically from setOcclusionFocus() (occlusion client).
 */
export class StaticScenery extends THREE.Group implements OcclusionClient {
  stats: SceneryStats = { meshes: 0, drawCalls: 0, shadowCasters: 0, triangles: 0, chunks: 0, fadeGroups: 0, ghosts: 0 };
  /** Same object (kept for call sites that prefer `.root`). */
  get root(): THREE.Group {
    return this;
  }
  private refreshSigns: (r: SignResolver) => void = () => {};
  private disposeOwned: () => void = () => {};
  private occlusion: (focus: Readonly<OcclusionFocus>, dt: number) => void = () => {};
  private signList: () => string[] = () => [];
  private occDebug: () => { groups: number; faded: number; fading: number; ghostsVisible: number } = () => ({ groups: 0, faded: 0, fading: 0, ghostsVisible: 0 });

  /** @internal */
  bind(
    refresh: (r: SignResolver) => void,
    dispose: () => void,
    occlusion: (focus: Readonly<OcclusionFocus>, dt: number) => void,
    signs: () => string[],
    occDebug: () => { groups: number; faded: number; fading: number; ghostsVisible: number },
  ): void {
    this.refreshSigns = refresh;
    this.disposeOwned = dispose;
    this.occlusion = occlusion;
    this.signList = signs;
    this.occDebug = occDebug;
  }

  /** Re-resolve every shop sign (e.g. after a language change). */
  setSignResolver(resolver: SignResolver): void {
    this.refreshSigns(resolver);
  }

  /** Current text of every sign slot (tests / tools). */
  signTexts(): string[] {
    return this.signList();
  }

  /** Occlusion state (tests / tools): fade groups, fully faded, partially faded, visible ghosts. */
  occlusionState(): { groups: number; faded: number; fading: number; ghostsVisible: number } {
    return this.occDebug();
  }

  /** @internal OcclusionClient (called from setOcclusionFocus). */
  occlusionUpdate(focus: Readonly<OcclusionFocus>, dt: number): void {
    this.occlusion(focus, dt);
  }

  /** Frees the merged geometries, sign atlas, fade groups and ground materials (shared caches stay). */
  override dispose(): void {
    this.disposeOwned();
    this.disposeOwned = () => {};
    this.occlusion = () => {};
    this.removeFromParent();
    super.dispose();
  }
}

function sceneryMaterial(bucket: string, signMat: THREE.Material): THREE.Material {
  switch (bucket) {
    case 'water':
      return matWater();
    case 'glow':
      return matGlow(radialGlowTexture());
    case 'double':
      return matSceneryDouble();
    case 'sign':
      return signMat;
    default:
      return matScenery();
  }
}

/** Sign atlas material + its ghost twin. Signs glow softly at dusk so they stay readable. */
function signMaterials(atlas: SignAtlas): { mat: THREE.MeshToonMaterial; ghost: THREE.MeshToonMaterial } {
  const mat = createToonMaterial({ map: atlas.texture, fx: true, occlusion: true, rim: 0.1, polygonOffset: -1 });
  const ghost = createGhostMaterial({ map: atlas.texture, fx: true, rim: 0.1, polygonOffset: -1 });
  for (const m of [mat, ghost]) {
    m.emissiveMap = atlas.texture;
    m.emissive.set('#FFFFFF');
    m.emissiveIntensity = 0.3;
  }
  return { mat, ghost };
}

function finishMeshes(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.ghost) return;
    const bucket = m.name.split(':').pop();
    m.userData.noOutline = true;
    m.castShadow = bucket === 'vc' || bucket === 'double';
    m.receiveShadow = bucket !== 'glow';
    if (bucket === 'glow') m.renderOrder = 2;
    if (bucket === 'water') m.renderOrder = 1;
  });
}

export interface SceneryOptions {
  /** Include createGround() planes (default true). */
  ground?: boolean;
  /** Include the arena fence, street and backdrop (default true). */
  outskirts?: boolean;
  /** Ground overlay texture detail (px per meter, 0 = no overlay). Default 20. */
  groundDetail?: number;
  /** Shop window dioramas, window silhouettes and other small stories (default true). */
  shopInteriors?: boolean;
  /**
   * Fraction (0..1) of purely decorative props kept (layout decor + outskirts hedges/trees).
   * Deterministic per item, so the same props survive at a given density. Default 1.
   */
  decorDensity?: number;
  /**
   * Language of the built-in fallback sign names (kiosks, unnamed shops, backdrop) when the
   * resolver does not know their keys. Default: detected from the resolver.
   */
  language?: SignLanguage;
}

/** Deterministic keep/drop for decor density thinning. */
function keepDecor(key: string, density: number): boolean {
  if (density >= 1) return true;
  if (density <= 0) return false;
  return (hashString(key) % 1000) / 1000 < density;
}

/**
 * Build every static visual of a layout (ground, statics, circles, decor, boundary,
 * outskirts) merged per material per 32 m chunk. Dynamic objects (banks, safes, fences,
 * vans, zones, characters) are NOT included.
 */
export function buildStaticScenery(layout: LayoutDef, signResolver: SignResolver = defaultSignResolver, opts: SceneryOptions = {}): StaticScenery {
  const root = new StaticScenery();
  root.name = `scenery:${layout.id}`;
  const atlas = new SignAtlas(4, 12);
  let resolver = signResolver;
  let lang: SignLanguage = opts.language ?? detectSignLanguage(signResolver);
  const ctx: Ctx = { atlas, resolve: (k) => resolver(k), lang: () => lang, center: { x: layout.size.x / 2, y: layout.size.y / 2 }, shopInteriors: opts.shopInteriors ?? true };
  const chunks = new ChunkGrid();
  const groups: FadeGroupInfo[] = [];
  const fadeGroupFor = (box: THREE.Box3 | null, chunk: string): number => {
    if (!box) return 0;
    const id = allocFadeGroup();
    if (!id) return 0;
    groups.push({ id, min: box.min, max: box.max, fade: 0, chunk });
    return id;
  };
  for (const s of layout.statics) {
    const b = chunks.at(s.center.x, s.center.y);
    const gid = fadeGroupFor(fadeBoxForStatic(s), chunks.keyAt(s.center.x, s.center.y));
    b.withFadeGroup(gid, () => addStaticBox(b, s, ctx));
  }
  for (const c of layout.circles) {
    const b = chunks.at(c.center.x, c.center.y);
    const gid = fadeGroupFor(fadeBoxForCircle(c), chunks.keyAt(c.center.x, c.center.y));
    b.withFadeGroup(gid, () => addStaticCircle(b, c));
  }
  const density = THREE.MathUtils.clamp(opts.decorDensity ?? 1, 0, 1);
  layout.decor.forEach((d, i) => {
    if (keepDecor(`${layout.id}|decor|${i}`, density)) addDecor(chunks.at(d.pos.x, d.pos.y), d, String(i));
  });
  if (opts.outskirts !== false) {
    addBoundary(chunks, layout, density);
    addBackdrop(chunks, layout, ctx, density);
  }
  atlas.redraw();
  const signMats = signMaterials(atlas);
  const ghostChunks = new Map<string, GhostChunk>();
  for (const [key, b] of chunks.builders) {
    const g = b.build((bucket) => sceneryMaterial(bucket, signMats.mat), { name: `chunk${key}` });
    b.clear();
    finishMeshes(g);
    ghostChunks.set(key, attachGhosts(g, signMats.ghost));
    root.add(g);
  }
  for (const gr of groups) ghostChunks.get(gr.chunk)?.groups.push(gr);
  if (opts.ground !== false) root.add(createGround(layout, { detail: opts.groundDetail }));
  let meshes = 0;
  let casters = 0;
  let tris = 0;
  let ghosts = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData.ghost) {
      ghosts++;
      return;
    }
    meshes++;
    if (m.castShadow) casters++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  root.stats = { meshes, drawCalls: meshes, shadowCasters: casters, triangles: Math.round(tris), chunks: chunks.builders.size, fadeGroups: groups.length, ghosts };
  const chunkList = [...ghostChunks.values()];
  root.bind(
    (next) => {
      resolver = next;
      lang = opts.language ?? detectSignLanguage(next);
      atlas.refresh();
    },
    () => {
      removeOcclusionClient(root);
      for (const gr of groups) releaseFadeGroup(gr.id);
      groups.length = 0;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !m.userData.ghost) {
          m.geometry.dispose();
          // Ground materials + sign material are owned here; shared ones are cached.
          if (m.name.startsWith('ground:')) {
            const mat = m.material as THREE.MeshToonMaterial;
            mat.map?.dispose();
            mat.dispose();
          }
        }
      });
      signMats.mat.dispose();
      signMats.ghost.dispose();
      atlas.dispose();
    },
    (focus, dt) => updateSceneryOcclusion(root, chunkList, groups, focus, dt),
    () => atlas.texts(),
    () => {
      let ghostsVisible = 0;
      for (const c of chunkList) for (const g of c.ghosts) if (g.visible) ghostsVisible++;
      return {
        groups: groups.length,
        faded: groups.filter((g) => g.fade >= 0.99).length,
        fading: groups.filter((g) => g.fade > 0 && g.fade < 0.99).length,
        ghostsVisible,
      };
    },
  );
  addOcclusionClient(root);
  return root;
}

// ---------------------------------------------------------------------------
// Single-object factories (previews, tools, gallery)
// ---------------------------------------------------------------------------

function buildSingle(fill: (b: PartBuilder, ctx: Ctx) => void, name: string): THREE.Group {
  const atlas = new SignAtlas(1, 2);
  const ctx: Ctx = { atlas, resolve: defaultSignResolver, lang: () => 'ko', center: null, shopInteriors: true };
  const b = new PartBuilder();
  fill(b, ctx);
  atlas.redraw();
  const signMats = signMaterials(atlas);
  const g = b.build((bucket) => sceneryMaterial(bucket, signMats.mat), { name });
  b.clear();
  finishMeshes(g);
  // Ghost twins so the x-ray cut shows a translucent shape (previews have no fade groups).
  const chunk = attachGhosts(g, signMats.ghost);
  const client: OcclusionClient = {
    occlusionUpdate: (focus, dt) => updateSceneryOcclusion(g, [chunk], [], focus, dt),
  };
  addOcclusionClient(client);
  g.userData.dispose = () => {
    removeOcclusionClient(client);
    g.traverse((o) => (o as THREE.Mesh).isMesh && !o.userData.ghost && (o as THREE.Mesh).geometry.dispose());
    signMats.mat.dispose();
    signMats.ghost.dispose();
    atlas.dispose();
  };
  return g;
}

/**
 * One static box in world space (shop fronts face local +z unless `faceToward` is given).
 * Call `group.userData.dispose()` to free it.
 */
export function createStaticBox(def: StaticBoxDef, signResolver: SignResolver = defaultSignResolver, faceToward: Vec2 | null = null): THREE.Group {
  const lang = detectSignLanguage(signResolver);
  return buildSingle((b, ctx) => addStaticBox(b, def, { ...ctx, resolve: signResolver, lang: () => lang, center: faceToward }), `static:${def.id}`);
}

export function createStaticCircle(def: StaticCircleDef): THREE.Group {
  return buildSingle((b) => addStaticCircle(b, def), `circle:${def.id}`);
}

export function createDecor(def: DecorDef): THREE.Group {
  return buildSingle((b) => addDecor(b, def), `decor:${def.kind}`);
}

/** Helper for tools: a world point as a V3 at ground level. */
export function groundPoint(p: Vec2, y = 0): V3 {
  return [p.x, y, p.y];
}
