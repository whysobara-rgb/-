/**
 * Dev-only model gallery: every procedural model, look, pose and expression in one lit scene,
 * plus a full match layout (when src/sim/layouts is present) seen through the game camera.
 *
 *   npx vite --port 5182 --strictPort  ->  http://127.0.0.1:5182/dev/model-gallery.html
 *
 * URL params: ?cam=<preset>  &hud=0 (hide overlay)  &layout=<id> (plaza|shortcut|counter|tutorial)
 *             &lang=en (English shop signs through the view-style resolver)
 * window.__gallery exposes setCamera / stats / modelStats for automated screenshots.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BANK_FLOOR_Y,
  FxSystem,
  HIGHLIGHT_COLORS,
  buildStaticScenery,
  createBank,
  createBankScar,
  createDecor,
  createDuskLighting,
  createFence,
  createRaccoon,
  createSafe,
  createStaticBox,
  createStaticCircle,
  createVan,
  createZoneMarker,
  idlePose,
  placeOnSim,
  preloadModelFonts,
  setModelTime,
  setOcclusionFocus,
  type BankRig,
  type DebrisBurst,
  type FenceRig,
  type RaccoonPose,
  type RaccoonRig,
  type SafeRig,
  type StaticScenery,
  type VanRig,
  type ZoneMarkerRig,
} from '../models';
import { countTriangles } from '../models/geometry';
import { BANK_MODEL } from '../../sim/config';
import type { CharacterLook, DecorKind, HatId, LayoutDef, LayoutId, StaticBoxDef, StaticCircleDef, TeamId } from '../../sim/types';

const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const lights = createDuskLighting({ shadowRadius: 30, quality: 'high' });
scene.add(lights.group);
scene.background = lights.background;
scene.fog = lights.fog;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.3, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const fx = new FxSystem();
scene.add(fx.root);

type Updater = (dt: number, t: number) => void;
const updaters: Updater[] = [];

// ===========================================================================
// Showcase area (x < 0 region, own ground)
// ===========================================================================
const SHOW = new THREE.Group();
SHOW.position.set(-200, 0, 0);
scene.add(SHOW);
{
  const tex = (await import('../models/textures')).pavingTexture('plaza').clone();
  tex.needsUpdate = true;
  tex.repeat.set(30, 30);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ map: tex }));
  g.receiveShadow = true;
  g.position.set(10, 0, 10);
  SHOW.add(g);
}

// --- raccoons ------------------------------------------------------------------------
function addRaccoon(team: TeamId | null, look: CharacterLook, x: number, z: number, facing: number, pose: (t: number) => RaccoonPose, parent: THREE.Object3D = SHOW): RaccoonRig {
  const rig = createRaccoon({ team, look });
  rig.root.position.set(x, 0, z);
  rig.root.rotation.y = -facing;
  parent.add(rig.root);
  updaters.push((dt, t) => rig.update(dt, pose(t)));
  return rig;
}
const FACE_CAM = Math.PI / 2;
const hats: HatId[] = ['none', 'teamCapA', 'teamCapB', 'hodadakBand', 'tongkeunHat', 'nunchiMask'];
([0, 1] as TeamId[]).forEach((team, row) => {
  hats.forEach((hat, i) => addRaccoon(team, { hat, furTint: 0.5 }, -7.5 + i * 1.5, -6 + row * 1.7, FACE_CAM, (t) => idlePose(t)));
});
(['hodadak', 'tongkeun', 'nunchi'] as const).forEach((rival, i) => {
  const hat: HatId = rival === 'hodadak' ? 'hodadakBand' : rival === 'tongkeun' ? 'tongkeunHat' : 'nunchiMask';
  addRaccoon(1, { hat, rival, furTint: [0.2, 0.8, 0.4][i] }, -7.5 + i * 1.8, -2.4, FACE_CAM, (t) => idlePose(t));
});
addRaccoon(0, { hat: 'teamCapA', rival: 'hodadak' }, -2.2, -2.4, FACE_CAM, (t) => ({ ...idlePose(t), speed: 4.5 }));
addRaccoon(null, { hat: 'none', furTint: 0 }, -0.6, -2.4, FACE_CAM, (t) => idlePose(t));
addRaccoon(null, { hat: 'none', furTint: 1 }, 0.9, -2.4, FACE_CAM, (t) => idlePose(t));
const poseRow: [string, (t: number) => RaccoonPose][] = [
  ['walk', (t) => ({ ...idlePose(t), speed: 4.5 })],
  ['grab', (t) => ({ ...idlePose(t), grabbing: true, speed: 2.5 })],
  ['strain', (t) => ({ ...idlePose(t), grabbing: true, straining: true })],
  ['dash', (t) => ({ ...idlePose(t), dashing: true, speed: 11 })],
  ['boost', (t) => ({ ...idlePose(t), grabbing: true, boosting: true, speed: 4 })],
  ['down', (t) => ({ ...idlePose(t), knockedDown: t % 2.4 < 1.4 })],
  ['cheer', (t) => ({ ...idlePose(t), celebrating: true })],
  ['sad', (t) => ({ ...idlePose(t), sad: true })],
];
poseRow.forEach(([, pose], i) => addRaccoon((i % 2) as TeamId, { hat: i % 2 ? 'teamCapB' : 'teamCapA' }, -7.5 + i * 1.6, 0.6, FACE_CAM - 0.6, pose));
(['normal', 'blink', 'happy', 'cheer', 'strain', 'dizzy', 'sad'] as const).forEach((expression, i) =>
  addRaccoon(0, { hat: 'none' }, -7.5 + i * 1.5, 2.6, FACE_CAM, (t) => ({ ...idlePose(t), expression })),
);
// A highlighted raccoon.
addRaccoon(1, { hat: 'teamCapB' }, 3.2, 0.6, FACE_CAM, (t) => idlePose(t)).setHighlight(HIGHLIGHT_COLORS.ping);

// --- safes ------------------------------------------------------------------------------
const safes: { rig: SafeRig; strain?: boolean; cycle?: boolean }[] = [];
function addSafe(kind: 'smallSafe' | 'largeSafe', x: number, z: number, angle: number, o: { anchored?: boolean; strain?: boolean; cycle?: boolean; hl?: string } = {}): SafeRig {
  const rig = createSafe(kind);
  placeOnSim(rig.root, { x, y: z }, angle);
  SHOW.add(rig.root);
  rig.setAnchored(o.anchored ?? true);
  if (o.hl) rig.setHighlight(o.hl);
  safes.push({ rig, strain: o.strain, cycle: o.cycle });
  return rig;
}
addSafe('smallSafe', 8, -5, 0);
addSafe('largeSafe', 10.5, -5, 0);
addSafe('smallSafe', 13, -5, 0, { anchored: false });
addSafe('largeSafe', 15.5, -5, 0, { anchored: false });
addSafe('smallSafe', 8, -2, 0, { strain: true });
addSafe('largeSafe', 10.5, -2, 0, { strain: true });
addSafe('smallSafe', 13, -2, 0.5, { anchored: false, hl: HIGHLIGHT_COLORS.grab });
addSafe('largeSafe', 15.5, -2, -0.4, { anchored: false, hl: HIGHLIGHT_COLORS.inZone });
addSafe('smallSafe', 8, 1, Math.PI / 4, { cycle: true });
addSafe('largeSafe', 10.5, 1, Math.PI / 2, { anchored: false, hl: HIGHLIGHT_COLORS.loaded });
// Raccoon tugging the straining large safe.
addRaccoon(0, { hat: 'teamCapA' }, 10.5, -0.6, -Math.PI / 2, (t) => ({ ...idlePose(t), grabbing: true, straining: true }));
updaters.push((dt, t) => {
  for (const s of safes) {
    if (s.strain) s.rig.setStrain(0.6 + 0.4 * Math.sin(t * 2));
    if (s.cycle) {
      const phase = t % 4;
      s.rig.setAnchored(phase < 2.5);
      s.rig.setStrain(phase < 2.5 ? Math.min(1, phase / 2.5) : 0);
    }
    s.rig.update(dt);
  }
});

// --- banks ---------------------------------------------------------------------------------
const banks: BankRig[] = [];
const bankA = createBank();
placeOnSim(bankA.root, { x: 28, y: -2 }, 0);
SHOW.add(bankA.root);
banks.push(bankA);
updaters.push((_dt, t) => bankA.setStrain(t % 6 < 3 ? 0.5 + 0.5 * Math.sin(t * 3) : 0));
// Bank with roof hidden and front walls faded, uprooted, being dragged in a small loop.
const bankB = createBank();
SHOW.add(bankB.root);
bankB.setUprooted(true);
bankB.setRoofOpacity(0);
bankB.setWallOpacity(0, 0.2);
bankB.setWallOpacity(1, 0.2);
banks.push(bankB);
const bankBInside: (SafeRig | RaccoonRig)[] = [];
for (const it of BANK_MODEL.interior) {
  const s = createSafe(it.kind);
  placeOnSim(s.root, it.pos, it.angle, BANK_FLOOR_Y);
  s.setAnchored(false);
  bankB.root.add(s.root);
  bankBInside.push(s);
}
addRaccoon(1, { hat: 'teamCapB' }, 0.2, 0.8, 0, (t) => ({ ...idlePose(t), speed: 1 }), bankB.root).root.position.y = BANK_FLOOR_Y;
updaters.push((_dt, t) => {
  const a = t * 0.35;
  placeOnSim(bankB.root, { x: 28 + Math.sin(a) * 3, y: 14 + Math.cos(a * 1.3) * 1.5 }, Math.sin(a * 0.8) * 0.3);
});
const bankC = createBank();
placeOnSim(bankC.root, { x: 44, y: -2 }, Math.PI);
SHOW.add(bankC.root);
bankC.setHighlight(HIGHLIGHT_COLORS.grab);
banks.push(bankC);
const scar = createBankScar();
placeOnSim(scar, { x: 44, y: 14 }, 0.1);
SHOW.add(scar);
updaters.push((dt) => banks.forEach((b) => b.update(dt)));

// --- vans + zones ----------------------------------------------------------------------------
const vans: VanRig[] = [];
const zones: ZoneMarkerRig[] = [];
([0, 1] as TeamId[]).forEach((team, i) => {
  const zone = createZoneMarker({ team, center: { x: 62, y: -4 + i * 15 }, half: { x: 6.5, y: 5.5 }, angle: 0, vanPos: { x: 62, y: -8 + i * 15 }, vanAngle: 0 });
  SHOW.add(zone.root);
  zones.push(zone);
  const van = createVan(team);
  placeOnSim(van.root, { x: 62, y: -11.5 + i * 15 }, 0);
  SHOW.add(van.root);
  vans.push(van);
});
vans[1].setSiren(true);
vans[1].setEngine(true);
updaters.push((dt, t) => {
  const p = (t % 3) / 2;
  zones[0].setActive(1);
  zones[0].setProgress(Math.min(1, p));
  zones[1].setActive(0.5 + 0.5 * Math.sin(t));
  zones[1].setProgress(0);
  if (t % 3 < dt) vans[0].bounce(1);
  zones.forEach((z) => z.update(dt));
  vans.forEach((v) => v.update(dt));
});

// --- fences ------------------------------------------------------------------------------------
const fenceDefs = [
  { id: 'gal.f1', center: { x: 8, y: 8 }, half: { x: 3, y: 0.2 }, angle: 0 },
  { id: 'gal.f2', center: { x: 16, y: 8 }, half: { x: 0.2, y: 2.2 }, angle: 0 },
];
const fences: FenceRig[] = fenceDefs.map((d) => {
  const f = createFence(d);
  SHOW.add(f.root);
  return f;
});
let debris: DebrisBurst[] = [];
let lastBreak = 0;
updaters.push((dt, t) => {
  if (t - lastBreak > 4.5) {
    lastBreak = t;
    const f = fences[0];
    if (f.broken) f.reset();
    else {
      const burst = f.breakApart({ x: 0, y: 1 });
      scene.add(burst.root);
      debris.push(burst);
      fx.dust(new THREE.Vector3(-200 + 8, 0, 8), { count: 14, spread: 1.4 });
    }
  }
  debris = debris.filter((d) => {
    const alive = d.update(dt);
    if (!alive) d.dispose();
    return alive;
  });
});
fences[1].setHighlight(HIGHLIGHT_COLORS.grab);

// --- statics / circles / decor ------------------------------------------------------------------
const styles = ['cafe', 'bakery', 'toy', 'arcade', 'flower', 'hanok', 'brick', 'glass', 'pharmacy', 'ramen'];
styles.forEach((style, i) => {
  const def: StaticBoxDef = { id: `gal.b${i}`, kind: 'building', center: { x: -8 + i * 9.5, y: 46 }, half: { x: 4, y: 2.2 }, angle: 0, height: 6 + (i % 3) * 0.7, style, signKey: `sign.${style === 'books' ? 'books' : style}` };
  SHOW.add(createStaticBox(def, undefined, { x: def.center.x, y: 80 }));
});
const misc: StaticBoxDef[] = [
  { id: 'gal.wall', kind: 'wall', center: { x: -6, y: 22 }, half: { x: 2.5, y: 0.4 }, angle: 0, height: 1.2 },
  { id: 'gal.hedge', kind: 'wall', center: { x: -6, y: 25 }, half: { x: 2.5, y: 0.4 }, angle: 0, height: 1.0, style: 'hedge' },
  { id: 'gal.planter', kind: 'planter', center: { x: 0, y: 23 }, half: { x: 2.2, y: 1.4 }, angle: 0, height: 0.9 },
  { id: 'gal.bench', kind: 'bench', center: { x: 5, y: 23 }, half: { x: 0.9, y: 0.3 }, angle: 0, height: 0.5 },
  { id: 'gal.kiosk1', kind: 'kiosk', center: { x: 11, y: 23 }, half: { x: 2.5, y: 1.2 }, angle: 0, height: 2.6, style: 'tteokbokki' },
  { id: 'gal.kiosk2', kind: 'kiosk', center: { x: 17, y: 23 }, half: { x: 1.2, y: 1.0 }, angle: 0, height: 2.6, style: 'lemonade' },
  { id: 'gal.fountainbox', kind: 'fountain', center: { x: 23, y: 23 }, half: { x: 1.8, y: 1.4 }, angle: 0, height: 1.0 },
  { id: 'gal.barrier', kind: 'barrier', center: { x: 29, y: 23 }, half: { x: 2.5, y: 0.2 }, angle: 0, height: 0.8 },
];
misc.forEach((d) => SHOW.add(createStaticBox(d, undefined, { x: d.center.x, y: 60 })));
const circles: StaticCircleDef[] = [
  { id: 'gal.tree1', kind: 'tree', center: { x: 35, y: 22 }, radius: 0.7, height: 4.8 },
  { id: 'gal.tree2', kind: 'tree', center: { x: 39, y: 24 }, radius: 0.6, height: 4.2 },
  { id: 'gal.lamp', kind: 'lamp', center: { x: 42, y: 22 }, radius: 0.15, height: 3.2 },
  { id: 'gal.pole1', kind: 'pole', center: { x: 44, y: 22 }, radius: 0.15, height: 0.9 },
  { id: 'gal.pole2', kind: 'pole', center: { x: 45, y: 23 }, radius: 0.1, height: 2.4 },
  { id: 'gal.hydrant', kind: 'hydrant', center: { x: 47, y: 22 }, radius: 0.25, height: 0.8 },
  { id: 'gal.fountain', kind: 'fountain', center: { x: 52, y: 23 }, radius: 2.6, height: 1.2 },
  { id: 'gal.statue', kind: 'statue', center: { x: 58, y: 23 }, radius: 0.8, height: 2.6 },
  { id: 'gal.clock', kind: 'statue', center: { x: 63, y: 23 }, radius: 1.2, height: 6 },
];
circles.forEach((c) => SHOW.add(createStaticCircle(c)));
const decorKinds: DecorKind[] = ['flowers', 'cone', 'sign', 'crate', 'umbrella', 'trash', 'bush', 'puddle', 'arrow', 'balloon'];
decorKinds.forEach((kind, i) => SHOW.add(createDecor({ kind, pos: { x: -6 + i * 2.6, y: 16 }, angle: 0 })));

// FX demo near the safes.
let lastFx = 0;
updaters.push((_dt, t) => {
  if (t - lastFx > 1.6) {
    lastFx = t;
    const base = new THREE.Vector3(-200 + 13, 0, 3.5);
    const k = Math.floor(t / 1.6) % 4;
    if (k === 0) fx.confetti(base, { count: 50 });
    if (k === 1) fx.dust(base, { count: 12 });
    if (k === 2) {
      fx.stars(base);
      fx.ring(base, { radius: 2 });
    }
    if (k === 3) {
      fx.coins(base, { count: 14 });
      fx.sparkle(base);
    }
  }
});

// ===========================================================================
// Full layout (when the sim layouts module exists)
// ===========================================================================
const LAYOUT_ROOT = new THREE.Group();
scene.add(LAYOUT_ROOT);
let scenery: StaticScenery | null = null;
let layout: LayoutDef | null = null;
const layoutRaccoons: RaccoonRig[] = [];

async function loadLayout(): Promise<void> {
  const mods = import.meta.glob('../../sim/layouts/index.ts');
  const loader = mods['../../sim/layouts/index.ts'];
  if (!loader) return;
  try {
    const mod = (await loader()) as { LAYOUTS?: Record<LayoutId, LayoutDef> };
    const id = (params.get('layout') ?? 'plaza') as LayoutId;
    layout = mod.LAYOUTS?.[id] ?? null;
  } catch (e) {
    console.warn('layout module failed to load', e);
    layout = null;
  }
  if (!layout) return;
  const t0 = performance.now();
  const lang = params.get('lang') === 'en' ? 'en' : 'ko';
  const strings = (await import('../../sim/layouts/strings')).LAYOUT_STRINGS;
  // Same resolver shape as the game view: language table, then Korean, then the key itself.
  scenery = buildStaticScenery(layout, (k) => strings[lang][k] ?? strings.ko[k] ?? k);
  console.info(`scenery built in ${(performance.now() - t0).toFixed(0)} ms`, scenery.stats);
  LAYOUT_ROOT.add(scenery);
  layout.banks.forEach((bp) => {
    const bank = createBank();
    placeOnSim(bank.root, bp.pos, bp.angle);
    LAYOUT_ROOT.add(bank.root);
    banks.push(bank);
    for (const it of BANK_MODEL.interior) {
      const s = createSafe(it.kind);
      placeOnSim(s.root, it.pos, it.angle, BANK_FLOOR_Y);
      bank.root.add(s.root);
    }
  });
  layout.safes.forEach((sp) => {
    const s = createSafe(sp.kind);
    placeOnSim(s.root, sp.pos, sp.angle);
    LAYOUT_ROOT.add(s.root);
  });
  layout.zones.forEach((z) => {
    const zm = createZoneMarker(z);
    LAYOUT_ROOT.add(zm.root);
    zones.push(zm);
    const v = createVan(z.team);
    placeOnSim(v.root, z.vanPos, z.vanAngle);
    LAYOUT_ROOT.add(v.root);
    vans.push(v);
  });
  layout.fences.forEach((fd) => LAYOUT_ROOT.add(createFence(fd).root));
  layout.spawns.forEach((sp, i) => {
    const look: CharacterLook = { hat: sp.team === 0 ? 'teamCapA' : 'teamCapB', furTint: (i * 0.37) % 1 };
    layoutRaccoons.push(addRaccoon(sp.team, look, sp.pos.x, sp.pos.y, sp.facing, (t) => ({ ...idlePose(t), speed: i % 2 ? 0 : 3 }), LAYOUT_ROOT));
  });
  stageAction(layout);
}

/**
 * A staged "mid-match" moment near the first bank so the game-camera screenshots show the
 * real cast in action: a team pulling the bank, a rival dragging a safe out of the zone path,
 * a dash, a knockdown, a highlighted grab target.
 */
function stageAction(l: LayoutDef): void {
  const bp = l.banks[0];
  if (!bp) return;
  const c = Math.cos(bp.angle);
  const s = Math.sin(bp.angle);
  const toWorld = (lx: number, ly: number): { x: number; y: number } => ({ x: bp.pos.x + lx * c - ly * s, y: bp.pos.y + lx * s + ly * c });
  // Two team-0 raccoons gripping the bank's west wall (local -x side), straining.
  for (const ly of [-1.2, 1.2]) {
    const p = toWorld(-BANK_MODEL.half.x - 0.55, ly);
    addRaccoon(0, { hat: 'teamCapA' }, p.x, p.y, bp.angle, (t) => ({ ...idlePose(t), grabbing: true, straining: true }), LAYOUT_ROOT);
  }
  const bankRig = banks[banks.length - l.banks.length];
  bankRig?.setHighlight(HIGHLIGHT_COLORS.grab);
  updaters.push((_dt, t) => bankRig?.setStrain(0.6 + 0.4 * Math.sin(t * 2)));
  // A team-1 raccoon dragging a small safe away (moving in a slow loop).
  const safe = createSafe('smallSafe');
  safe.setAnchored(false);
  safe.setHighlight(HIGHLIGHT_COLORS.inZone);
  LAYOUT_ROOT.add(safe.root);
  const dragger = addRaccoon(1, { hat: 'teamCapB', rival: 'hodadak' }, 0, 0, 0, (t) => ({ ...idlePose(t), grabbing: true, speed: 3.4 }), LAYOUT_ROOT);
  const base = toWorld(0, BANK_MODEL.half.y + 4.5);
  updaters.push((dt, t) => {
    const a = t * 0.45;
    const px = base.x + Math.cos(a) * 3.2;
    const py = base.y + Math.sin(a) * 1.6;
    const vx = -Math.sin(a) * 3.2;
    const vy = Math.cos(a) * 1.6;
    const f = Math.atan2(vy, vx);
    placeOnSim(dragger.root, { x: px, y: py }, f);
    placeOnSim(safe.root, { x: px - Math.cos(f) * 1.0, y: py - Math.sin(f) * 1.0 }, f);
    safe.update(dt);
  });
  // A dash + a knockdown nearby.
  const d = toWorld(BANK_MODEL.half.x + 3, -1);
  addRaccoon(1, { hat: 'teamCapB', rival: 'nunchi' }, d.x, d.y, Math.PI, (t) => ({ ...idlePose(t), dashing: t % 2 < 0.4, speed: t % 2 < 0.4 ? 11 : 0 }), LAYOUT_ROOT);
  const k = toWorld(BANK_MODEL.half.x + 1.6, -1.2);
  addRaccoon(0, { hat: 'teamCapA' }, k.x, k.y, 0, (t) => ({ ...idlePose(t), knockedDown: t % 2 > 0.3 && t % 2 < 1.1 }), LAYOUT_ROOT);
  const cheer = toWorld(-2, BANK_MODEL.half.y + 7);
  addRaccoon(0, { hat: 'teamCapA', rival: 'tongkeun' }, cheer.x, cheer.y, Math.PI / 2, (t) => ({ ...idlePose(t), celebrating: true }), LAYOUT_ROOT);
}

// ===========================================================================
// Cameras
// ===========================================================================
type CamPreset = { pos: [number, number, number]; target: [number, number, number]; fov?: number; occlude?: boolean };
/** Game camera: pitch 55°, distance ~32 m, FOV 38°, south of the target (never rotates). */
function gameCam(tx: number, tz: number, dist = 32, pitchDeg = 55, fov = 38): CamPreset {
  const p = THREE.MathUtils.degToRad(pitchDeg);
  return { pos: [tx, Math.sin(p) * dist, tz + Math.cos(p) * dist], target: [tx, 0, tz], fov, occlude: true };
}
const S = -200;
const CAMERAS: Record<string, CamPreset> = {
  raccoons: { pos: [S - 2, 5.5, 10], target: [S - 2, 0.6, -1] },
  hats: { pos: [S - 3.8, 2.2, -1.2], target: [S - 3.8, 0.7, -5.3] },
  rivals: { pos: [S - 4.8, 2.0, -0.2], target: [S - 4.8, 0.62, -2.4], fov: 40 },
  poses: { pos: [S - 2, 2.6, 6.2], target: [S - 2, 0.6, 0.6] },
  faces: { pos: [S - 3, 1.3, 5.2], target: [S - 3, 0.8, 2.6], fov: 34 },
  safes: { pos: [S + 12, 4.2, 6.5], target: [S + 12, 0.4, -2] },
  bank: { pos: [S + 28, 9, 12], target: [S + 28, 1.5, -2] },
  bankBack: { pos: [S + 44, 9, -18], target: [S + 44, 1.5, -2] },
  bankInside: { pos: [S + 28, 13, 26], target: [S + 28, 0.5, 14] },
  bankScar: { pos: [S + 44, 9, 24], target: [S + 44, 0, 14] },
  vans: { pos: [S + 70, 10, 14], target: [S + 62, 0.5, 2] },
  fences: { pos: [S + 12, 5, 16], target: [S + 12, 0.6, 8] },
  town: { pos: [S + 30, 16, 68], target: [S + 30, 2, 44] },
  townClose: { pos: [S + 5, 6, 58], target: [S + 5, 2.5, 45] },
  misc: { pos: [S + 12, 7, 33], target: [S + 12, 0.8, 22] },
  circles: { pos: [S + 48, 7, 34], target: [S + 48, 1.5, 22] },
  kiosk: { pos: [S + 12, 2.2, 28.5], target: [S + 12, 1.0, 23] },
  decor: { pos: [S + 6, 5.5, 23.5], target: [S + 6, 0.4, 16], fov: 42 },
  gameShowRaccoons: gameCam(S - 2, -1),
  /** Both teams in every hat at the match camera (team must read from the emblem shapes). */
  hatsGame: gameCam(S - 3.75, -5.2, 21),
  gameShowBank: gameCam(S + 30, 4),
  gameShowSafes: gameCam(S + 12, -2),
  // Layout presets (plaza coords).
  layoutTop: { pos: [40, 95, 70], target: [40, 0, 26], fov: 45 },
  layoutGameZone: gameCam(10, 26),
  layoutGameBank: gameCam(40, 13),
  layoutGameCenter: gameCam(40, 26),
  layoutGameSouth: gameCam(30, 46),
  layoutGameNorthEdge: gameCam(20, 3),
  layoutGameFar: gameCam(40, 26, 40),
  layoutAction: gameCam(40, 16, 28),
  layoutActionClose: gameCam(40, 16, 16),
};

let currentCam = params.get('cam') ?? 'raccoons';
let occludeTarget: THREE.Vector3 | null = null;
function setCamera(name: string): void {
  const c = CAMERAS[name] ?? CAMERAS.raccoons;
  camera.position.set(...c.pos);
  controls.target.set(...c.target);
  camera.fov = c.fov ?? 38;
  camera.updateProjectionMatrix();
  controls.update();
  lights.setFocus(new THREE.Vector3(c.target[0], 0, c.target[2]));
  occludeTarget = c.occlude ? new THREE.Vector3(c.target[0], 0.6, c.target[2]) : null;
  currentCam = name;
  renderHud();
}

// ===========================================================================
// Stats + HUD + loop
// ===========================================================================
function meshCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && c.visible) n++;
  });
  return n;
}
function modelStats(): Record<string, { meshes: number; triangles: number }> {
  const out: Record<string, { meshes: number; triangles: number }> = {};
  const measure = (name: string, obj: THREE.Object3D): void => {
    out[name] = { meshes: meshCount(obj), triangles: countTriangles(obj) };
  };
  const r = createRaccoon({ team: 0, look: { hat: 'teamCapA' } });
  measure('raccoon', r.root);
  r.dispose();
  const s1 = createSafe('smallSafe');
  measure('smallSafe', s1.root);
  s1.dispose();
  const s2 = createSafe('largeSafe');
  measure('largeSafe', s2.root);
  s2.dispose();
  const b = createBank();
  measure('bank', b.root);
  b.dispose();
  const v = createVan(0);
  measure('van', v.root);
  v.dispose();
  if (scenery) out.scenery = { meshes: scenery.stats.meshes, triangles: scenery.stats.triangles };
  return out;
}

function renderHud(): void {
  if (params.get('hud') === '0') {
    hud.classList.add('hidden');
    return;
  }
  const info = renderer.info.render;
  const sc = scenery ? `<br/>scenery: ${scenery.stats.meshes} meshes · ${scenery.stats.triangles.toLocaleString()} tris · ${scenery.stats.chunks} chunks` : '';
  hud.innerHTML =
    `<b>뿌리째 털어라 · model gallery</b><br/>frame: ${info.calls} draw calls · ${info.triangles.toLocaleString()} tris${sc}<br/>` +
    Object.keys(CAMERAS)
      .map((k) => `<button class="${k === currentCam ? 'on' : ''}" data-cam="${k}">${k}</button>`)
      .join('');
  hud.querySelectorAll('button[data-cam]').forEach((btn) => btn.addEventListener('click', () => setCamera((btn as HTMLElement).dataset.cam!)));
}

const timer = new THREE.Timer();
let elapsed = 0;
let frames = 0;
const camWorld = new THREE.Vector3();
function frame(now?: number): void {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  elapsed += dt;
  setModelTime(elapsed);
  for (const u of updaters) u(dt, elapsed);
  fx.update(dt);
  controls.update();
  camera.getWorldPosition(camWorld);
  setOcclusionFocus(occludeTarget ? camWorld : null, occludeTarget);
  renderer.render(scene, camera);
  if (++frames % 30 === 0) renderHud();
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

declare global {
  interface Window {
    __gallery?: {
      ready: boolean;
      setCamera(name: string): void;
      cameras: string[];
      stats(): { calls: number; triangles: number; scenery: StaticScenery['stats'] | null };
      modelStats(): Record<string, { meshes: number; triangles: number }>;
      breakdown(): Record<string, { count: number; triangles: number }>;
      selftest(): unknown;
      advance(seconds: number): void;
    };
  }
}

await preloadModelFonts('너구리 카페 몽글 찻집 말랑 빵집 동글 도넛 뽀짝 장난감 뿅뿅 오락실 꽃방울 꽃집 사르르 아이스크림 책벌레 책방 빙글 음반가게 후루룩 라멘 뽀송 빨래방 도토리 우체국 토닥 약국 떡볶이 레모네이드');
await loadLayout();
setCamera(currentCam);
let selftest: unknown = null;
if (params.get('selftest')) {
  const { runModelSelfTest } = await import('./model-selftest');
  let all: Record<string, LayoutDef> | null = null;
  const loader = import.meta.glob('../../sim/layouts/index.ts')['../../sim/layouts/index.ts'];
  if (loader) {
    try {
      all = ((await loader()) as { LAYOUTS?: Record<string, LayoutDef> }).LAYOUTS ?? null;
    } catch {
      all = null;
    }
  }
  selftest = await runModelSelfTest(all);
}
window.__gallery = {
  ready: true,
  setCamera,
  cameras: Object.keys(CAMERAS),
  stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, scenery: scenery?.stats ?? null }),
  modelStats,
  selftest: () => selftest,
  breakdown() {
    // Triangles per static kind for the loaded layout (perf tuning aid).
    const out: Record<string, { count: number; triangles: number }> = {};
    const add = (k: string, g: THREE.Group): void => {
      const e = (out[k] ??= { count: 0, triangles: 0 });
      e.count++;
      e.triangles += countTriangles(g);
      (g.userData.dispose as () => void)();
    };
    if (layout) {
      for (const d of layout.statics) add(`box:${d.kind}`, createStaticBox(d));
      for (const c of layout.circles) add(`circle:${c.kind}`, createStaticCircle(c));
      for (const d of layout.decor) add(`decor:${d.kind}`, createDecor(d));
    }
    return out;
  },
  advance(seconds: number) {
    elapsed += seconds;
  },
};
frame();
