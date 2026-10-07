/**
 * Main menu: the gang's cozy rooftop hideout at dusk — party lights, crates, a water tower, a
 * striped awning over a stolen big safe used as the snack table, the city glowing below.
 *
 * The gang reacts to the highlighted menu item:
 *   빠른 대전 → dash pose (running in place, speed lines)
 *   라이벌 대회 → rival silhouettes pop up behind the parapet
 *   옷장 → the lead tries on hats in front of a mirror (pop + sparkle)
 *   연습 → stretching
 *   설정 → tinkering at the safe with a wrench (sparks)
 *   종료 → everyone waves bye
 * Other screens over the hideout (quick match, settings) re-frame the camera to keep the gang
 * visible beside the panel.
 */
import * as THREE from 'three';
import type { HatId } from '../../sim/types';
import { createSafe, type SafeRig } from '../../render/models';
import { MenuScene, damp, easeOutBack } from '../scene';
import { Puppet, type Act } from '../puppet';
import { POP, PropBuilder, addCrate, addGift, ball, cyl, disposeProp, glowDisc, disposeOwnedMesh, mirrorGlass, rng, roundBox, stringLights, wrench, type StringLights } from '../kit';
import { bigRedButton, disposeRope, marqueeSign, marqueeTexture, rope, setRope, squeakyHammer, type BigButton, type MarqueeSign } from '../kit';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type HideoutFocus = 'practice' | 'quickMatch' | 'tournament' | 'wardrobe' | 'settings' | 'quit' | 'play' | 'credits' | 'goal' | null;
/**
 * Camera framing: 'menu' (list on the left), 'left' (panel on the right), 'center', and
 * 'front' (the front door: marquee top-left, the gang centre-left, the right ~40% kept clear for
 * the player card / 게임 시작 / mode cards; portrait screens get a taller variant).
 */
export type HideoutFraming = 'menu' | 'left' | 'right' | 'center' | 'front';

export interface HideoutOptions {
  hat: HatId;
  framing?: HideoutFraming;
  /** Marquee wordmark + ribbon (defaults to the Korean title and the English name). */
  marquee?: { title: string; sub: string };
}

/** Normalised screen rectangle (0..1 of the viewport, y down). */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TRY_HATS: HatId[] = ['teamCapA', 'tongkeunHat', 'hodadakBand', 'nunchiMask', 'teamCapB'];

const FRAMES: Record<HideoutFraming, { pos: [number, number, number]; look: [number, number, number] }> = {
  menu: { pos: [-1.6, 4.7, 12.6], look: [1.0, 1.65, -0.9] },
  left: { pos: [4.4, 4.4, 12.6], look: [5.6, 1.2, 0] },
  right: { pos: [-1.0, 5.0, 13.0], look: [0.4, 1.6, -0.4] },
  center: { pos: [1.2, 5.6, 15.5], look: [1.6, 1.7, -0.6] },
  front: { pos: [2.2, 5.0, 17.0], look: [3.9, 3.0, -1.2] },
};
/** Front door on portrait screens (fov keeps the 16:9 width): marquee on top, gang below it. */
const FRONT_TALL = { pos: [-0.6, 5.4, 7.2] as [number, number, number], look: [-1.2, -2.2, -4.75] as [number, number, number] };

/** Play-press ceremony timeline (seconds). */
const CER = { slam: 0.3, zipStart: 0.5, zipDur: 0.62, stagger: 0.09, coverAt: 0.82 } as const;
/** Zipline cable: from the front-left roof corner down past the camera's left edge. */
const ZIP_A = new THREE.Vector3(-6.9, 2.75, 3.4);
const ZIP_B = new THREE.Vector3(-17, -5.5, 10.5);
const LEAD_HOME = new THREE.Vector3(1.3, 0, 1.5);
/** Where the lead jumps to bonk the button. */
const LEAD_BONK = new THREE.Vector3(2.15, 0, 0.55);
const BUTTON_AT = new THREE.Vector3(2.0, 1.31, -0.42);

export class HideoutScene extends MenuScene {
  readonly id = 'hideout';
  private readonly roof: THREE.Group;
  private readonly city: THREE.Group;
  private readonly cityWindows: THREE.Mesh;
  private readonly lights: StringLights;
  private readonly safe: SafeRig;
  private readonly lead: Puppet;
  private readonly crew: Puppet[] = [];
  private readonly rivals: Puppet[] = [];
  private readonly wrench: THREE.Group;
  private readonly props: THREE.Object3D[] = [];
  private readonly glows: THREE.Mesh[] = [];
  private readonly mirror: THREE.Mesh;
  private readonly marquee: MarqueeSign;
  private readonly hangSafe: SafeRig;
  private readonly hammer: THREE.Group;
  private readonly button: BigButton;
  private readonly zipRope: THREE.Mesh;
  private readonly zipPole: THREE.Group;
  /** Seconds since the play ceremony started (null = idle). */
  private cerT: number | null = null;
  private cerBonked = false;
  private readonly crewHome: THREE.Vector3[] = [];
  private focus: HideoutFocus = null;
  private framing: HideoutFraming;
  private hat: HatId;
  private hatIndex = 0;
  private hatTimer = 0;
  private sparkTimer = 0;
  private focusT = 0;

  constructor(o: HideoutOptions) {
    super({
      sky: ['#2D63C4', '#FF9F7E', '#FFD48A'],
      skyStyle: { rays: '#FFE7B0', rayStrength: 0.22, rayCount: 16, rayCenterY: 0.0, clouds: '#FFE4D6', cloudY: [0.14, 0.3], stars: 0.5 },
      hemi: ['#D6E2FF', '#FFD2B4'],
      shadowRadius: 10,
    });
    this.baseFov = 34;
    this.hat = o.hat;
    this.framing = o.framing ?? 'menu';
    const r = rng(41);

    // --- rooftop: slab, parapet, tar patches, vents, water tower, awning --------------------------
    const b = new PropBuilder();
    b.add(roundBox(15, 0.6, 9.5, 0.08), '#B9967E', [0, -0.3, -0.6]);
    b.add(roundBox(14.4, 0.06, 8.9, 0.03), '#DDB997', [0, 0.02, -0.6]);
    for (let i = 0; i < 9; i++) b.add(roundBox(1 + r() * 1.2, 0.03, 0.8 + r() * 0.9, 0.02), '#CFA683', [-6 + r() * 12, 0.06, -4 + r() * 6], { rot: [0, r() * 0.6, 0] });
    // parapet (back + sides; the front edge stays open toward the camera)
    b.add(roundBox(15.2, 0.9, 0.4, 0.06), POP.brick, [0, 0.45, -5.3]);
    b.add(roundBox(15.4, 0.14, 0.55, 0.04), '#E3C9B6', [0, 0.95, -5.3]);
    for (const x of [-7.5, 7.5]) {
      b.add(roundBox(0.4, 0.9, 9.6, 0.06), POP.brick, [x, 0.45, -0.6]);
      b.add(roundBox(0.55, 0.14, 9.8, 0.04), '#E3C9B6', [x, 0.95, -0.6]);
    }
    // front lip
    b.add(roundBox(15.2, 0.25, 0.35, 0.05), '#E3C9B6', [0, 0.12, 4.1]);
    // water tower (back-left)
    const wx = 6.1;
    const wz = -3.9;
    for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) b.add(cyl(0.08, 0.1, 2.4, 8), POP.woodDark, [wx + lx, 1.2, wz + lz]);
    b.add(cyl(1.15, 1.15, 1.8, 20), POP.wood, [wx, 3.3, wz]);
    for (const y of [2.65, 3.3, 3.95]) b.add(cyl(1.19, 1.19, 0.1, 20), POP.steelDark, [wx, y, wz]);
    b.add(cyl(0.05, 1.3, 0.8, 20), POP.tomato, [wx, 4.6, wz]);
    b.add(ball(0.12, 10), POP.sun, [wx, 5.05, wz]);
    // AC unit + vent pipes (back-right)
    b.add(roundBox(1.6, 0.9, 1.0, 0.08), '#C9D3E2', [-5.7, 0.45, -4.3]);
    b.add(cyl(0.38, 0.38, 0.06, 18), '#8A93A6', [-5.7, 0.92, -4.3]);
    b.add(cyl(0.12, 0.12, 1.4, 10), POP.steel, [3.8, 0.7, -4.6]);
    b.add(cyl(0.2, 0.12, 0.25, 10), POP.steelDark, [3.8, 1.45, -4.6]);
    // antenna
    b.add(cyl(0.04, 0.05, 3.2, 6), POP.steelDark, [6.6, 1.6, -1.6]);
    b.add(roundBox(1.0, 0.06, 0.06, 0.02), POP.steelDark, [6.6, 2.8, -1.6]);
    b.add(roundBox(0.7, 0.06, 0.06, 0.02), POP.steelDark, [6.6, 3.15, -1.6]);
    b.add(ball(0.09, 8), POP.tomato, [6.6, 3.25, -1.6]);
    // crates (hand placed, varied)
    addCrate(b, 0.95, POP.wood, 3, [5.0, 0, -1.7], 0.15);
    addCrate(b, 0.7, '#D99A5E', 6, [6.1, 0, -2.3], -0.4);
    addCrate(b, 0.6, POP.wood, 8, [-6.2, 0, 1.6], 0.5);
    addCrate(b, 0.8, '#B97D4C', 12, [-6.4, 0, 0.5], -0.2);
    addCrate(b, 0.55, POP.wood, 14, [-6.3, 0.8, 0.55], 0.7);
    // cushions + rug by the snack table
    b.add(roundBox(4.2, 0.04, 3.0, 0.02), POP.tomato, [2.8, 0.05, 0.6]);
    for (let i = 0; i < 7; i++) b.add(roundBox(4.2 / 7 - 0.06, 0.045, 3.02, 0.02), i % 2 ? '#FFE3A0' : POP.tomato, [2.8 - 2.1 + (i + 0.5) * 0.6, 0.055, 0.6]);
    b.add(cyl(0.45, 0.5, 0.28, 16), POP.mint, [1.0, 0.14, 2.6]);
    b.add(cyl(0.45, 0.5, 0.28, 16), POP.sky, [4.6, 0.14, 2.4]);
    // awning over the lounge corner (left): posts + striped canopy, a bench of cushions under it
    for (const x of [-4.6, -0.8]) b.add(cyl(0.07, 0.07, 2.8, 8), POP.woodDark, [x, 1.4, -2.9]);
    for (let i = 0; i < 8; i++) {
      const x = -4.6 + (i + 0.5) * (3.8 / 8);
      b.add(roundBox(3.8 / 8 + 0.01, 0.08, 1.7, 0.02), i % 2 ? POP.cream : POP.tomato, [x, 2.85, -2.3], { rot: [0.32, 0, 0] });
      b.add(roundBox(3.8 / 8 - 0.04, 0.32, 0.06, 0.02), i % 2 ? POP.cream : POP.tomato, [x, 2.55, -1.52]);
    }
    b.add(roundBox(3.2, 0.42, 0.9, 0.12), POP.mint, [-2.7, 0.21, -3.9]);
    b.add(roundBox(3.2, 0.6, 0.3, 0.12), POP.mintDark, [-2.7, 0.6, -4.3]);
    for (const [x, c] of [[-3.7, POP.sun], [-1.8, POP.pink]] as const) b.add(roundBox(0.62, 0.5, 0.2, 0.1), c, [x, 0.65, -4.05], { rot: [-0.25, 0, 0.12] });
    // standing mirror (wardrobe corner) + a hat box
    b.add(roundBox(0.95, 1.6, 0.1, 0.42), POP.sun, [-0.3, 1.2, 0.4], { rot: [0, 0.75, 0] });
    for (let k = 0; k < 7; k++) {
      // little bulbs around the frame (dressing-room mirror)
      const a = (k / 6) * Math.PI;
      const lx = Math.cos(a) * 0.5;
      const ly = 1.2 + 0.35 + Math.sin(a) * 0.48;
      b.add(ball(0.06, 6), k % 2 ? POP.cream : POP.tomato, [-0.3 + lx * Math.cos(0.75) + 0.07 * Math.sin(0.75), ly, 0.4 - lx * Math.sin(0.75) + 0.07 * Math.cos(0.75)]);
    }
    b.add(roundBox(0.3, 0.42, 0.3, 0.05), POP.woodDark, [-0.34, 0.21, 0.36]);
    addGift(b, 0.55, POP.pink, POP.sun, [-1.2, 0, 1.4]);
    // toolbox by the safe
    b.add(roundBox(0.7, 0.36, 0.36, 0.05), POP.tomato, [4.3, 0.18, 0.1], { rot: [0, -0.3, 0] });
    b.add(roundBox(0.4, 0.06, 0.08, 0.02), POP.ink, [4.3, 0.42, 0.1], { rot: [0, -0.3, 0] });
    // potted plants
    for (const [x, z, s0] of [[-6.4, 3.2, 1], [6.6, 3.0, 0.85]] as const) {
      b.add(cyl(0.38 * s0, 0.3 * s0, 0.6 * s0, 14), POP.tomato, [x, 0.3 * s0, z]);
      b.add(ball(0.5 * s0, 12), POP.grass, [x, 0.9 * s0, z]);
      b.add(ball(0.36 * s0, 10), POP.grassDark, [x + 0.25 * s0, 1.15 * s0, z - 0.1]);
    }
    // party light poles
    b.add(cyl(0.06, 0.07, 3.0, 8), POP.woodDark, [7.2, 1.5, 3.0]);
    this.roof = b.build('prop:roof');
    this.scene.add(this.roof);
    this.batcher.add(this.roof);
    this.mirror = mirrorGlass(0.74, 1.36);
    this.mirror.position.set(-0.3 + Math.sin(0.75) * 0.058, 1.2, 0.4 + Math.cos(0.75) * 0.058);
    this.mirror.rotation.y = 0.75;
    this.scene.add(this.mirror);

    // snacks on the safe table
    const snack = new PropBuilder();
    snack.add(cyl(0.12, 0.1, 0.22, 12), POP.sky, [2.15, 1.44, -0.75]);
    snack.add(cyl(0.12, 0.1, 0.22, 12), POP.pink, [3.1, 1.44, -0.5]);
    snack.add(new THREE.TorusGeometry(0.16, 0.07, 8, 16), '#E9A15E', [2.65, 1.38, -0.3], { rot: [Math.PI / 2, 0, 0] });
    snack.add(new THREE.TorusGeometry(0.16, 0.06, 8, 16), POP.pink, [2.65, 1.41, -0.3], { rot: [Math.PI / 2, 0, 0], scale: [0.98, 0.98, 0.6] });
    snack.add(roundBox(0.5, 0.12, 0.34, 0.03), POP.sun, [2.5, 1.37, -1.1], { rot: [0, 0.3, 0] });
    const snacks = snack.build('prop:snacks');
    this.scene.add(snacks);
    this.batcher.add(snacks);
    this.props.push(snacks);

    // --- the city below and around (one unlit window mesh) --------------------------------------
    const cb = new PropBuilder();
    const winGeos: THREE.BufferGeometry[] = [];
    const cols = ['#3E78C8', '#E07A5F', '#3FA58A', '#E8A94A', '#6A62C8', '#D9667E'];
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI * 0.95 + (i / 25) * Math.PI * 0.9;
      const dist = 26 + r() * 16;
      const w = 4 + r() * 5;
      const h = 4 + r() * 14;
      const x = Math.cos(a) * dist;
      const z = Math.sin(a) * dist - 4;
      const top = -6 + h;
      const col = cols[(i * 5) % cols.length]!;
      cb.add(roundBox(w, h, w * 0.8, 0.2), col, [x, -6 + h / 2, z], { rot: [0, -a, 0] });
      // roof trim + a rooftop story: water tank, sign board or a little shed
      cb.add(roundBox(w + 0.3, 0.35, w * 0.8 + 0.3, 0.1), new THREE.Color(col).lerp(new THREE.Color('#FFF6E6'), 0.45), [x, top + 0.17, z], { rot: [0, -a, 0] });
      const kind = Math.floor(r() * 4);
      if (kind === 0) {
        cb.add(cyl(0.9, 0.9, 1.4, 12), POP.wood, [x, top + 1.25, z]);
        cb.add(cyl(0.05, 1.0, 0.6, 12), POP.tomato, [x, top + 2.2, z]);
      } else if (kind === 1) {
        cb.add(roundBox(w * 0.7, 1.3, 0.15, 0.08), [POP.sun, POP.mint, POP.pink, POP.cream][i % 4]!, [x, top + 1.3, z], { rot: [0, -a + Math.PI / 2, 0] });
      } else if (kind === 2) {
        cb.add(roundBox(w * 0.35, 1.2, w * 0.3, 0.1), new THREE.Color(col).multiplyScalar(0.8), [x, top + 0.95, z], { rot: [0, -a, 0] });
      }
      // windows facing the rooftop
      const nx = -Math.cos(a);
      const nz = -Math.sin(a);
      const tx = -nz;
      const tz = nx;
      for (let wy = top - 1.2; wy > -4; wy -= 1.6) {
        for (let k = -1; k <= 1; k++) {
          if (r() < 0.45) continue;
          const g = new THREE.PlaneGeometry(0.7, 0.9).toNonIndexed();
          g.deleteAttribute('uv');
          g.lookAt(new THREE.Vector3(nx, 0, nz));
          // local +X of the rotated box points away from the roof, so the near face is w/2 in
          g.translate(x + nx * (w * 0.5 + 0.06) + tx * k * w * 0.24, wy, z + nz * (w * 0.5 + 0.06) + tz * k * w * 0.24);
          const c = new THREE.Color(r() < 0.8 ? '#FFD98A' : '#FFB3A0').multiplyScalar(0.75 + r() * 0.35);
          const n = g.attributes.position.count;
          const ca = new Float32Array(n * 3);
          for (let j = 0; j < n; j++) ca.set([c.r, c.g, c.b], j * 3);
          g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
          g.deleteAttribute('normal');
          winGeos.push(g);
        }
      }
    }
    this.city = cb.build('prop:city', { outline: false, castShadow: false });
    this.scene.add(this.city);
    this.batcher.add(this.city);
    const wm = mergeGeometries(winGeos, false)!;
    for (const g of winGeos) g.dispose();
    this.cityWindows = new THREE.Mesh(wm, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }));
    this.cityWindows.name = 'menu3d:windows';
    this.cityWindows.userData.noBatch = true;
    this.scene.add(this.cityWindows);
    this.scene.fog = new THREE.Fog('#F4AE8E', 26, 78);

    // --- live props: the safe table, string lights, glows -----------------------------------------
    this.safe = createSafe('largeSafe');
    this.safe.setAnchored(false);
    this.safe.root.position.set(2.65, 0, -0.7);
    this.safe.root.rotation.y = -0.25;
    this.scene.add(this.safe.root);
    this.batcher.add(this.safe.root);
    this.lights = stringLights([
      { a: new THREE.Vector3(-6.9, 2.75, 3.3), b: new THREE.Vector3(-4.6, 2.75, -2.9), count: 9, sag: 0.4 },
      { a: new THREE.Vector3(-0.8, 2.75, -2.9), b: new THREE.Vector3(6.6, 3.2, -1.6), count: 15, sag: 0.55 },
      { a: new THREE.Vector3(6.6, 3.2, -1.6), b: new THREE.Vector3(7.2, 3.0, 3.0), count: 9, sag: 0.45 },
    ]);
    this.scene.add(this.lights.group);
    this.batcher.add(this.lights.group);
    for (const [x, z, rad, c, a] of [
      [2.8, 0.8, 5.5, '#FFB26E', 0.26],
      [-2.6, -2.8, 3.0, '#FFD27A', 0.2],
    ] as const) {
      const g = glowDisc(rad, c, a);
      g.position.set(x, 0.07, z);
      this.scene.add(g);
      this.glows.push(g);
    }

    // --- the gang ---------------------------------------------------------------------------------
    const faceCam = -Math.PI / 2; // rig faces +X; this turns it toward the camera (+Z)
    this.lead = new Puppet({ team: 0, look: { hat: o.hat, furTint: 0.5 }, pos: new THREE.Vector3(1.3, 0, 1.5), yaw: faceCam + 0.25, scale: 1.2 });
    this.crew.push(
      new Puppet({ team: 0, look: { hat: 'teamCapA', furTint: 0.22 }, pos: new THREE.Vector3(5.0, 0.95, -1.7), yaw: faceCam - 0.35, scale: 1.05 }),
      new Puppet({ team: 0, look: { hat: 'none', furTint: 0.8 }, pos: new THREE.Vector3(4.3, 0, 1.4), yaw: faceCam - 0.45, scale: 1.05 }),
    );
    for (const p of [this.lead, ...this.crew]) {
      this.scene.add(p.holder);
      this.batcher.add(p.holder);
    }
    // rivals hidden behind the back parapet (pop up for 라이벌 대회)
    const rivalIds = ['hodadak', 'tongkeun', 'nunchi'] as const;
    rivalIds.forEach((id, i) => {
      const p = new Puppet({ team: 1, look: { hat: id === 'hodadak' ? 'hodadakBand' : id === 'tongkeun' ? 'tongkeunHat' : 'nunchiMask', rival: id }, pos: new THREE.Vector3(0.6 + i * 2.1, 0.55, -5.9), yaw: faceCam, scale: 1.35 });
      p.setSilhouette(true);
      p.popIn(false, true);
      this.scene.add(p.holder);
      this.batcher.add(p.holder);
      this.rivals.push(p);
    });
    this.hammer = squeakyHammer(0.72);
    this.hammer.visible = false;
    this.wrench = wrench(0.4);
    this.wrench.visible = false;
    const paw = this.lead.rightPaw;
    if (paw) {
      paw.add(this.wrench);
      this.wrench.position.set(0, -0.36, 0.05);
      this.wrench.rotation.set(0, 0, -Math.PI / 2);
    } else this.scene.add(this.wrench);
    if (paw) {
      paw.add(this.hammer);
      this.hammer.position.set(0, -0.38, 0.04);
      this.hammer.rotation.set(0, Math.PI / 2, Math.PI);
    } else this.scene.add(this.hammer);
    this.crewHome.push(...this.crew.map((p) => p.holder.position.clone()));

    // --- front door: rooftop marquee, GO button on the snack safe, zipline, the lead's 뿅망치 -----
    const mq = o.marquee ?? { title: '뿌리째 털어라', sub: 'UPROOT HEIST' };
    this.marquee = marqueeSign(marqueeTexture(mq.title, mq.sub), { legHeight: 3.2 });
    this.marquee.group.position.set(-1.9, 0, -4.75);
    this.marquee.group.rotation.y = 0.12;
    this.scene.add(this.marquee.group);
    this.batcher.add(this.marquee.group);
    this.hangSafe = createSafe('smallSafe');
    this.hangSafe.setAnchored(false);
    this.hangSafe.root.scale.setScalar(0.8);
    this.hangSafe.root.position.set(0, -1.15, 0);
    this.marquee.safePivot.add(this.hangSafe.root);
    for (const sx of [-0.16, 0.16]) {
      const ch = rope(POP.steelDark, 0.025);
      setRope(ch, new THREE.Vector3(sx, -0.62, 0), new THREE.Vector3(sx * 1.6, 0, 0));
      this.marquee.safePivot.add(ch);
      this.props.push(ch);
    }
    this.batcher.add(this.hangSafe.root);
    this.button = bigRedButton(0.4);
    this.button.group.position.copy(BUTTON_AT);
    this.button.group.rotation.y = -0.25;
    this.scene.add(this.button.group);
    const zp = new PropBuilder();
    zp.add(cyl(0.07, 0.09, 2.9, 8), POP.woodDark, [ZIP_A.x + 0.05, 1.45, ZIP_A.z - 0.05]);
    zp.add(roundBox(0.5, 0.12, 0.12, 0.03), POP.woodDark, [ZIP_A.x + 0.05, 2.78, ZIP_A.z - 0.05]);
    zp.add(new THREE.TorusGeometry(0.1, 0.03, 6, 12), POP.steel, [ZIP_A.x, ZIP_A.y - 0.04, ZIP_A.z], { rot: [Math.PI / 2, 0, 0] });
    this.zipPole = zp.build('prop:zipPole');
    this.scene.add(this.zipPole);
    this.batcher.add(this.zipPole);
    this.zipRope = rope(POP.ink, 0.035);
    setRope(this.zipRope, ZIP_A, ZIP_B);
    this.scene.add(this.zipRope);
    this.addShadow(this.scene, 3.4, 2.6, [2.65, 0, -0.7], 0.3);
    this.addShadow(this.scene, 3.4, 3.4, [6.1, 0, -3.9], 0.3);
    this.addShadow(this.scene, 2.6, 2.2, [-6.3, 0, 1.0], 0.25);
    this.addShadow(this.scene, 2.6, 2.2, [5.4, 0, -1.9], 0.25);
    this.addShadow(this.scene, 3.8, 1.6, [-2.7, 0, -4.0], 0.25);

    const f = this.frameFor(this.framing);
    this.camPos.set(...f.pos);
    this.camLook.set(...f.look);
    this.setFocus('quickMatch');
  }

  /** Frame / framing the camera aimed at last update (see the snap rule in update()). */
  private lastFrame: { readonly pos: readonly [number, number, number] } | null = null;
  private lastFraming: HideoutFraming | null = null;

  private frameFor(fr: HideoutFraming): { pos: readonly [number, number, number]; look: readonly [number, number, number] } {
    if (fr === 'front' && this.camera.aspect < 0.95) return FRONT_TALL;
    return FRAMES[fr];
  }

  /**
   * 게임 시작 ceremony: the lead hops to the snack-table safe and bonks the big red button with the
   * 뿅망치, the bulbs flash, then the gang ziplines off the roof. Returns the seconds until the
   * screen should be covered by the van wipe (reduced motion: a cut, no zipline).
   */
  playCeremony(): number {
    if (this.cerT !== null) return Math.max(0, CER.coverAt - this.cerT);
    this.cerT = 0;
    this.cerBonked = false;
    this.cue('whoosh', 0.6);
    return this.reducedMotion ? 0.12 : CER.coverAt;
  }

  /** On-screen rectangle of the marquee face (0..1 of the viewport); null when off-screen. */
  marqueeScreenRect(): ScreenRect | null {
    const face = this.marquee.face;
    face.updateWorldMatrix(true, false);
    const g = face.geometry as THREE.PlaneGeometry;
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const x of [bb.min.x, bb.max.x])
      for (const y of [bb.min.y, bb.max.y]) {
        v.set(x, y, 0).applyMatrix4(face.matrixWorld).project(this.camera);
        const sx = (v.x + 1) / 2;
        const sy = (1 - v.y) / 2;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
    if (!Number.isFinite(x0) || x1 < 0 || x0 > 1 || y1 < 0 || y0 > 1) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** The highlighted main-menu item (null = idle). */
  setFocus(f: HideoutFocus): void {
    if (f === this.focus) return;
    const prev = this.focus;
    this.focus = f;
    this.focusT = 0;
    this.hatTimer = 0.25;
    if (prev === 'wardrobe') this.lead.setHat(this.hat);
    const showRivals = f === 'tournament';
    this.rivals.forEach((p, i) => {
      if (showRivals !== p.shown) {
        p.popIn(showRivals);
        if (showRivals && !this.reducedMotion) window.setTimeout(() => p.hop(0.5), i * 90);
      }
    });
    if (showRivals) this.cue('boing');
    this.wrench.visible = f === 'settings';
    if (f === 'play' && prev !== 'play') this.cue('tick', 0.7);
    if (f && f !== prev && !this.reducedMotion) this.lead.hop(f === 'play' ? 0.4 : 0.28);
  }

  setFraming(fr: HideoutFraming): void {
    this.framing = fr;
    // Shown again after a play ceremony that did not lead anywhere: everyone back on the roof.
    if (this.cerT !== null) {
      this.cerT = null;
      this.lead.holder.position.copy(LEAD_HOME);
      this.crew.forEach((p, i) => {
        p.holder.position.copy(this.crewHome[i]!);
        p.holder.rotation.y = -Math.PI / 2 - (i === 0 ? 0.35 : 0.45);
      });
    }
  }

  /** Equipped hat changed (wardrobe). */
  setHat(hat: HatId): void {
    this.hat = hat;
    if (this.focus !== 'wardrobe') this.lead.setHat(hat);
  }

  protected update(dt: number, t: number): void {
    const rm = this.reducedMotion;
    this.focusT += dt;
    const f = this.focus;
    const front = this.framing === 'front';
    const cer = this.cerT;
    // The hero carries the 뿅망치 on the front door (the wrench replaces it while tinkering).
    this.hammer.visible = (front || cer !== null) && f !== 'settings';
    const leadAct: Act =
      f === 'quickMatch' ? 'dash' : f === 'practice' ? 'stretch' : f === 'wardrobe' ? 'tryHat' : f === 'settings' ? 'tinker' : f === 'quit' ? 'wave' : f === 'play' ? 'hop' : f === 'credits' ? 'wave' : f === 'goal' ? 'cheer' : 'idle';
    this.lead.setAct(cer !== null ? 'cheer' : leadAct);
    this.lead.headYaw = f === 'tournament' ? 0.9 : null;
    // Body turns: toward the safe to tinker, the mirror for hats, half around for the rivals.
    const faceCam = -Math.PI / 2;
    const yawGoal = cer !== null ? faceCam - 1.2 : f === 'settings' ? 0.55 : f === 'wardrobe' ? faceCam - 0.9 : f === 'tournament' ? faceCam + 1.1 : faceCam + 0.25;
    this.lead.holder.rotation.y += (yawGoal - this.lead.holder.rotation.y) * damp(rm ? 40 : 7, dt);
    this.lead.expression = f === 'tournament' ? 'shock' : cer !== null ? 'happy' : null;
    const crewAct: Act = f === 'quickMatch' || f === 'play' ? 'hop' : f === 'practice' ? 'stretch' : f === 'quit' || f === 'credits' ? 'wave' : 'idle';
    this.crew.forEach((p, i) => {
      p.setAct(cer !== null ? 'cheer' : i === 0 && f !== 'quit' && f !== 'practice' && f !== 'credits' ? (f === 'quickMatch' || f === 'play' ? 'cheer' : 'idle') : crewAct);
      p.headYaw = f === 'tournament' ? 1.2 : f === 'settings' ? -0.6 : null;
      p.expression = f === 'tournament' ? 'shock' : null;
    });

    // wardrobe: pop a different hat on every ~0.9 s
    if (f === 'wardrobe') {
      this.hatTimer -= dt;
      if (this.hatTimer <= 0) {
        this.hatTimer = rm ? 2.2 : 0.95;
        this.hatIndex = (this.hatIndex + 1) % TRY_HATS.length;
        this.lead.setHat(TRY_HATS[this.hatIndex]!);
        if (!rm) {
          this.lead.hop(0.22);
          this.fx.sparkle(this.lead.headTop(new THREE.Vector3()), { count: 8, radius: 0.5, color: POP.sun });
        }
        this.cue('sparkle', 0.6);
      }
    }
    // settings: sparks from the safe while tinkering
    if (f === 'settings' && !rm) {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.35 + Math.random() * 0.4;
        this.fx.sparkle({ x: 2.0, y: 0.9, z: 0.1 }, { count: 4, radius: 0.25, color: '#FFE9A0' });
      }
    }
    // quick match: little dust kicks under the running feet
    if (f === 'quickMatch' && !rm && Math.random() < dt * 6) {
      const p = this.lead.holder.position;
      this.fx.dust({ x: p.x - 0.3, y: 0.05, z: p.z - 0.2 }, { count: 2, spread: 0.25, size: 0.22 });
    }
    // 게임 시작 focused: the hero shoulders the hammer and the GO button glints now and then
    if (f === 'play' && !rm && cer === null) {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.9 + Math.random() * 0.5;
        this.fx.sparkle({ x: BUTTON_AT.x, y: BUTTON_AT.y + 0.35, z: BUTTON_AT.z }, { count: 5, radius: 0.3, color: '#FFF1B8' });
      }
    }

    this.lead.update(dt, t, rm);
    for (const p of this.crew) p.update(dt, t, rm);
    this.rivals.forEach((p, i) => {
      p.setAct(i === 0 ? 'hop' : i === 1 ? 'flex' : 'smug');
      p.update(dt, t, rm);
    });
    // Hammer pose (after the rig update: the arm override wins): resting on the shoulder, raised
    // high while 게임 시작 is focused, swung down on the slam.
    const arm = this.lead.rightPaw;
    if (arm && this.hammer.visible) {
      const raised = (f === 'play' && cer === null) || cer !== null;
      let z = 0.3 + (rm ? 0 : Math.sin(t * 2.1) * 0.05);
      if (raised) z = 2.95 + (rm ? 0 : Math.sin(t * 7) * 0.08);
      if (cer !== null) {
        const k = cer / CER.slam;
        z = k < 1 ? 2.5 + k * 0.8 : Math.max(1.05, 3.3 - (cer - CER.slam) * 22);
      }
      arm.rotation.set(raised ? -0.15 : 0.1, 0, z);
      // raised: the hammer extends past the paw; resting: held upright beside the shoulder
      if (raised) {
        this.hammer.position.set(0, -0.38, 0.04);
        this.hammer.rotation.set(0, Math.PI / 2, Math.PI);
      } else {
        this.hammer.position.set(0.02, -0.4, 0.16);
        this.hammer.rotation.set(0, Math.PI / 2, 0.12);
      }
    }
    this.updateCeremony(dt);
    this.safe.update(dt);
    this.lights.twinkle(rm ? 0 : t);
    // marquee: bulb chase, the hanging safe swings on its chains
    const flash = cer !== null && cer >= CER.slam ? Math.max(0, 1 - (cer - CER.slam) * 2.2) : 0;
    this.marquee.update(t, rm, flash);
    this.marquee.safePivot.rotation.z = rm ? 0 : Math.sin(t * 1.7) * 0.2 + Math.sin(t * 0.63) * 0.05;
    this.hangSafe.update(dt);

    // camera: framing + a small push toward the rivals
    const fr = this.frameFor(this.framing);
    // Snap (no swoop) on the first frame and when only the aspect variant changed (e.g. the
    // constructor framed for 16:9 before the stage sized a portrait canvas); framing changes
    // between screens still glide.
    const snap = this.lastFrame === null || (fr !== this.lastFrame && this.lastFraming === this.framing);
    this.lastFrame = fr;
    this.lastFraming = this.framing;
    const k = snap ? 1 : damp(rm ? 30 : 3.2, dt);
    const lift = f === 'tournament' ? 0.6 : 0;
    const breathe = rm ? 0 : Math.sin(t * 0.3) * 0.12;
    this.camPos.lerp(new THREE.Vector3(fr.pos[0] + breathe, fr.pos[1] + lift, fr.pos[2] - lift * 0.6), k);
    this.camLook.lerp(new THREE.Vector3(fr.look[0], fr.look[1] + lift * 0.9, fr.look[2] - lift * 1.6), k);
    void easeOutBack;
  }

  /** Advance the 게임 시작 ceremony (lead bonk, button squash, gang zipline). */
  private updateCeremony(dt: number): void {
    const cap = this.button.cap;
    if (this.cerT === null) {
      cap.scale.set(1, 1, 1);
      return;
    }
    const rm = this.reducedMotion;
    this.cerT += dt;
    const c = this.cerT;
    // lead hops over to the safe-table button
    const lp = this.lead.holder.position;
    if (rm) lp.copy(LEAD_BONK);
    else lp.lerpVectors(LEAD_HOME, LEAD_BONK, Math.min(1, c / (CER.slam * 0.9)));
    if (!rm && c < CER.slam) lp.y = Math.sin(Math.min(1, c / CER.slam) * Math.PI) * 0.55;
    if (!this.cerBonked && (c >= CER.slam || rm)) {
      this.cerBonked = true;
      const at = new THREE.Vector3(BUTTON_AT.x, BUTTON_AT.y + 0.3, BUTTON_AT.z);
      this.cue('boing', 1);
      this.cue('stamp', 0.9);
      this.shake(0.5);
      if (!rm) {
        this.fx.sparkle(at, { count: 14, radius: 0.6, color: POP.sun });
        this.fx.confetti(at, { count: 40 });
      }
    }
    // button squash + elastic return
    const since = c - CER.slam;
    const sq = since < 0 ? 1 : since < 0.08 ? 0.35 : 1 - 0.65 * Math.exp(-(since - 0.08) * 9) * Math.cos((since - 0.08) * 26);
    cap.scale.set(1 + (1 - sq) * 0.35, Math.max(0.3, sq), 1 + (1 - sq) * 0.35);
    if (rm) return;
    // the gang ziplines off the roof, lead last (crew first: they were already cheering)
    const riders = [...this.crew, this.lead];
    riders.forEach((p, i) => {
      const t0 = CER.zipStart + i * CER.stagger;
      if (c < t0) return;
      const k = Math.min(1, (c - t0) / CER.zipDur);
      const start = i < this.crew.length ? this.crewHome[i]! : LEAD_BONK;
      // first 20 %: a hop up to the cable; then slide down it, accelerating
      if (k < 0.2) {
        const q = k / 0.2;
        p.holder.position.lerpVectors(start, ZIP_A, q);
        p.holder.position.y = start.y + (ZIP_A.y - 1.45 - start.y) * q + Math.sin(q * Math.PI) * 0.5;
      } else {
        const q = Math.pow((k - 0.2) / 0.8, 1.6);
        p.holder.position.lerpVectors(ZIP_A, ZIP_B, q);
        p.holder.position.y -= 1.45;
      }
      p.holder.rotation.y = -Math.PI / 2 - 1.1;
      p.setAct('cheer');
    });
  }

  protected override onDispose(): void {
    this.lead.dispose();
    for (const p of this.crew) p.dispose();
    for (const p of this.rivals) p.dispose();
    this.safe.dispose();
    disposeProp(this.wrench);
    disposeProp(this.hammer);
    this.button.dispose();
    this.hangSafe.dispose();
    this.marquee.dispose();
    disposeRope(this.zipRope);
    disposeProp(this.zipPole);
    for (const g of this.glows) disposeOwnedMesh(g);
    disposeOwnedMesh(this.mirror);
    for (const p of this.props) {
      (p.userData.dispose as (() => void) | undefined)?.();
      disposeProp(p);
    }
    this.lights.dispose();
    disposeOwnedMesh(this.cityWindows);
    disposeProp(this.city);
    disposeProp(this.roof);
  }
}
