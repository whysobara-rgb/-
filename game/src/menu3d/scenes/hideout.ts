/**
 * Main menu: the gang's cozy rooftop hideout at dusk — crates, a water tower, a striped awning,
 * a stolen big safe used as their table with the big red button on it, the city glowing below.
 * Deliberately sparse (no string lights, antenna, snacks or cushions): the gang and the safe are
 * the subject, and the deck runs on past the bottom of the frame so no roof edge cuts across.
 *
 * On the front door ('front' framing) and quick setup ('left') the scene stays calm: the gang
 * idles slowly and only 게임 시작 gets a reaction (the lead lifts the 뿅망치). Other screens
 * over the hideout re-frame the camera to keep the gang visible beside their panel, and the gang
 * still acts out what they are about:
 *   빠른 대전 → dash pose (running in place)
 *   라이벌 대회 → rival silhouettes pop up behind the parapet
 *   옷장 → the lead tries on hats in front of a mirror
 *   설정 → tinkering at the safe with a wrench
 *   크레딧 → a wave
 */
import * as THREE from 'three';
import type { HatId } from '../../sim/types';
import { createSafe, type SafeRig } from '../../render/models';
import { MenuScene, damp, easeOutBack } from '../scene';
import { Puppet, type Act } from '../puppet';
import { POP, PropBuilder, addCrate, addGift, ball, cyl, disposeProp, glowDisc, disposeOwnedMesh, mirrorGlass, rng, roundBox, wrench } from '../kit';
import { bigRedButton, disposeRope, rope, setRope, squeakyHammer, type BigButton } from '../kit';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type HideoutFocus = 'practice' | 'quickMatch' | 'tournament' | 'wardrobe' | 'settings' | 'quit' | 'play' | 'credits' | 'goal' | null;
/**
 * Camera framing: 'menu' (list on the left), 'left' (panel on the right), 'center', and
 * 'front' (the front door: a close, low view of the gang and the snack-table safe in the right
 * half, the left ~45% kept quiet for the logo / 게임 시작 / list; portrait screens get a taller
 * variant with the gang above the column).
 */
export type HideoutFraming = 'menu' | 'left' | 'right' | 'center' | 'front';

export interface HideoutOptions {
  hat: HatId;
  framing?: HideoutFraming;
}

const TRY_HATS: HatId[] = ['teamCapA', 'tongkeunHat', 'hodadakBand', 'nunchiMask', 'teamCapB'];

const FRAMES: Record<HideoutFraming, { pos: [number, number, number]; look: [number, number, number] }> = {
  menu: { pos: [-1.6, 4.7, 12.6], look: [1.0, 1.65, -0.9] },
  // quick setup: the gang in the left third, beside the setup panel
  left: { pos: [8.9, 4.8, 18.4], look: [10.5, 1.5, -0.6] },
  right: { pos: [-1.0, 5.0, 13.0], look: [0.4, 1.6, -0.4] },
  center: { pos: [1.2, 5.6, 15.5], look: [1.6, 1.7, -0.6] },
  front: { pos: [0.4, 3.4, 12.4], look: [1.0, 1.25, -0.6] },
};
/** Front door on portrait screens (fov keeps the 16:9 width): the gang above the column. */
const FRONT_TALL = { pos: [2.8, 4.6, 11.5] as [number, number, number], look: [2.8, -2.6, -0.5] as [number, number, number] };
/** Standing mirror (x, z): in the lounge, left of the gang. */
const MIRROR_AT = [-3.2, -0.5] as const;
/** Idle pace on the front door (the gang breathes slower there than on the busier screens). */
const FRONT_PACE = 0.7;

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
  private readonly safe: SafeRig;
  private readonly lead: Puppet;
  private readonly crew: Puppet[] = [];
  private readonly rivals: Puppet[] = [];
  private readonly wrench: THREE.Group;
  private readonly glows: THREE.Mesh[] = [];
  private readonly mirror: THREE.Mesh;
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
  /** Idle clock: runs slower on the front door (FRONT_PACE). */
  private idleT = 0;
  /** Smoothed hammer-arm angle. */
  private armZ = 0.3;

  constructor(o: HideoutOptions) {
    super({
      // Calm dusk: a slightly softer gradient, no sunburst, a few clouds high up, faint stars.
      sky: ['#3F68B8', '#F2A386', '#F8D39C'],
      skyStyle: { rays: null, clouds: '#FFE4D6', cloudY: [0.2, 0.32], cloudDensity: 0.22, stars: 0.3 },
      hemi: ['#D6E2FF', '#FFD2B4'],
      shadowRadius: 10,
    });
    this.baseFov = 34;
    this.hat = o.hat;
    this.framing = o.framing ?? 'menu';
    const r = rng(41);

    // --- rooftop: slab, parapet, tar patches, vents, water tower, awning --------------------------
    // The deck runs on toward the camera (front edge z ≈ 7.7) so the roof edge stays below the
    // front-door frame instead of drawing heavy dark lines across the bottom of the screen.
    const b = new PropBuilder();
    b.add(roundBox(15, 0.6, 13.1, 0.08), '#B9967E', [0, -0.3, 1.2]);
    b.add(roundBox(14.4, 0.06, 12.5, 0.03), '#DDB997', [0, 0.02, 1.2]);
    for (let i = 0; i < 9; i++) b.add(roundBox(1 + r() * 1.2, 0.03, 0.8 + r() * 0.9, 0.02), '#CFA683', [-6 + r() * 12, 0.06, -4 + r() * 6], { rot: [0, r() * 0.6, 0] });
    // parapet (back + sides; the front edge stays open toward the camera)
    b.add(roundBox(15.2, 0.9, 0.4, 0.06), POP.brick, [0, 0.45, -5.3]);
    b.add(roundBox(15.4, 0.14, 0.55, 0.04), '#E3C9B6', [0, 0.95, -5.3]);
    for (const x of [-7.5, 7.5]) {
      b.add(roundBox(0.4, 0.9, 13.2, 0.06), POP.brick, [x, 0.45, 1.2]);
      b.add(roundBox(0.55, 0.14, 13.4, 0.04), '#E3C9B6', [x, 0.95, 1.2]);
    }
    // front lip
    b.add(roundBox(15.2, 0.25, 0.35, 0.05), '#E3C9B6', [0, 0.12, 7.7]);
    // water tower (back-left)
    const wx = 6.1;
    const wz = -3.9;
    for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) b.add(cyl(0.08, 0.1, 2.4, 8), POP.woodDark, [wx + lx, 1.2, wz + lz]);
    b.add(cyl(1.15, 1.15, 1.8, 20), POP.wood, [wx, 3.3, wz]);
    for (const y of [2.65, 3.3, 3.95]) b.add(cyl(1.19, 1.19, 0.1, 20), POP.steelDark, [wx, y, wz]);
    b.add(cyl(0.05, 1.3, 0.8, 20), POP.tomato, [wx, 4.6, wz]);
    b.add(ball(0.12, 10), POP.sun, [wx, 5.05, wz]);
    // AC unit (back-left)
    b.add(roundBox(1.6, 0.9, 1.0, 0.08), '#C9D3E2', [-5.7, 0.45, -4.3]);
    b.add(cyl(0.38, 0.38, 0.06, 18), '#8A93A6', [-5.7, 0.92, -4.3]);
    // crates (hand placed, varied)
    addCrate(b, 0.95, POP.wood, 3, [5.0, 0, -1.7], 0.15);
    addCrate(b, 0.7, '#D99A5E', 6, [6.1, 0, -2.3], -0.4);
    addCrate(b, 0.6, POP.wood, 8, [-6.2, 0, 1.6], 0.5);
    addCrate(b, 0.8, '#B97D4C', 12, [-6.4, 0, 0.5], -0.2);
    addCrate(b, 0.55, POP.wood, 14, [-6.3, 0.8, 0.55], 0.7);
    // rug by the safe table
    b.add(roundBox(4.2, 0.04, 3.0, 0.02), POP.tomato, [2.8, 0.05, 0.6]);
    for (let i = 0; i < 7; i++) b.add(roundBox(4.2 / 7 - 0.06, 0.045, 3.02, 0.02), i % 2 ? '#FFE3A0' : POP.tomato, [2.8 - 2.1 + (i + 0.5) * 0.6, 0.055, 0.6]);
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
    // (in the lounge, under the front door's shaded column: a bright prop on the shade's edge
    // would pull the eye away from the gang)
    const [mx, mz] = MIRROR_AT;
    b.add(roundBox(0.95, 1.6, 0.1, 0.42), POP.sun, [mx, 1.2, mz], { rot: [0, 0.75, 0] });
    for (let k = 0; k < 7; k++) {
      // little bulbs around the frame (dressing-room mirror)
      const a = (k / 6) * Math.PI;
      const lx = Math.cos(a) * 0.5;
      const ly = 1.2 + 0.35 + Math.sin(a) * 0.48;
      b.add(ball(0.06, 6), k % 2 ? POP.cream : POP.tomato, [mx + lx * Math.cos(0.75) + 0.07 * Math.sin(0.75), ly, mz - lx * Math.sin(0.75) + 0.07 * Math.cos(0.75)]);
    }
    b.add(roundBox(0.3, 0.42, 0.3, 0.05), POP.woodDark, [mx - 0.04, 0.21, mz - 0.04]);
    addGift(b, 0.55, POP.pink, POP.sun, [-1.2, 0, 1.4]);
    // toolbox by the safe
    b.add(roundBox(0.7, 0.36, 0.36, 0.05), POP.tomato, [4.3, 0.18, 0.1], { rot: [0, -0.3, 0] });
    b.add(roundBox(0.4, 0.06, 0.08, 0.02), POP.ink, [4.3, 0.42, 0.1], { rot: [0, -0.3, 0] });
    // potted plant (front-left corner)
    for (const [x, z, s0] of [[-6.4, 3.2, 1]] as const) {
      b.add(cyl(0.38 * s0, 0.3 * s0, 0.6 * s0, 14), POP.tomato, [x, 0.3 * s0, z]);
      b.add(ball(0.5 * s0, 12), POP.grass, [x, 0.9 * s0, z]);
      b.add(ball(0.36 * s0, 10), POP.grassDark, [x + 0.25 * s0, 1.15 * s0, z - 0.1]);
    }
    this.roof = b.build('prop:roof');
    this.scene.add(this.roof);
    this.batcher.add(this.roof);
    this.mirror = mirrorGlass(0.74, 1.36);
    this.mirror.position.set(mx + Math.sin(0.75) * 0.058, 1.2, mz + Math.cos(0.75) * 0.058);
    this.mirror.rotation.y = 0.75;
    this.scene.add(this.mirror);

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
    // Haze the city a little more so the rooftop reads first (a soft depth-of-field feel).
    this.scene.fog = new THREE.Fog('#F2B79A', 20, 66);

    // --- live props: the safe table, glows ----------------------------------------------------------
    this.safe = createSafe('largeSafe');
    this.safe.setAnchored(false);
    // Unanchoring plays the "uprooted" hop; the snack table has stood here for ages, so skip it.
    this.safe.update(10);
    this.safe.root.position.set(2.65, 0, -0.7);
    this.safe.root.rotation.y = -0.25;
    this.scene.add(this.safe.root);
    this.batcher.add(this.safe.root);
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

    // --- front door: GO button on the snack safe, zipline, the lead's 뿅망치 --------------------------
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
   * 뿅망치, then the gang ziplines off the roof. Returns the seconds until the
   * screen should be covered by the van wipe (reduced motion: a cut, no zipline).
   */
  playCeremony(): number {
    if (this.cerT !== null) return Math.max(0, CER.coverAt - this.cerT);
    this.cerT = 0;
    this.cerBonked = false;
    this.cue('whoosh', 0.6);
    return this.reducedMotion ? 0.12 : CER.coverAt;
  }

  /** Front door and quick setup: slow idle, one reaction at most. */
  private get calm(): boolean {
    return this.framing === 'front' || this.framing === 'left';
  }

  /**
   * The highlighted main-menu item (null = idle). On the calm framings (front door, quick setup)
   * only 게임 시작 gets a reaction (the lead lifts the 뿅망치); anything else leaves the gang idling.
   */
  setFocus(f: HideoutFocus): void {
    if (this.calm && f !== 'play') f = null;
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
    if (f && f !== prev && f !== 'play' && !this.reducedMotion) this.lead.hop(0.28);
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
    // Idle clock: slower on the front door (the play ceremony runs at full speed).
    const pace = this.calm && cer === null ? FRONT_PACE : 1;
    const idt = dt * pace;
    this.idleT += idt;
    const it = this.idleT;
    // The hero carries the 뿅망치 on the front door (the wrench replaces it while tinkering).
    this.hammer.visible = (front || cer !== null) && f !== 'settings';
    const leadAct: Act =
      f === 'quickMatch' ? 'dash' : f === 'practice' ? 'stretch' : f === 'wardrobe' ? 'tryHat' : f === 'settings' ? 'tinker' : f === 'quit' ? 'wave' : f === 'credits' ? 'wave' : f === 'goal' ? 'cheer' : 'idle';
    this.lead.setAct(cer !== null ? 'cheer' : leadAct);
    this.lead.headYaw = f === 'tournament' ? 0.9 : null;
    // Body turns: toward the safe to tinker, the mirror for hats, half around for the rivals.
    const faceCam = -Math.PI / 2;
    const yawGoal = cer !== null ? faceCam - 1.2 : f === 'settings' ? 0.55 : f === 'wardrobe' ? faceCam - 0.9 : f === 'tournament' ? faceCam + 1.1 : faceCam + 0.25;
    this.lead.holder.rotation.y += (yawGoal - this.lead.holder.rotation.y) * damp(rm ? 40 : 7, dt);
    // 게임 시작 focused (the front door's one reaction): a happy face and the hammer lifted a little.
    this.lead.expression = f === 'tournament' ? 'shock' : cer !== null || f === 'play' ? 'happy' : null;
    const crewAct: Act = f === 'quickMatch' ? 'hop' : f === 'practice' ? 'stretch' : f === 'quit' || f === 'credits' ? 'wave' : 'idle';
    this.crew.forEach((p, i) => {
      p.setAct(cer !== null ? 'cheer' : i === 0 && f !== 'quit' && f !== 'practice' && f !== 'credits' ? (f === 'quickMatch' ? 'cheer' : 'idle') : crewAct);
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
    this.lead.update(idt, it, rm);
    for (const p of this.crew) p.update(idt, it, rm);
    this.rivals.forEach((p, i) => {
      p.setAct(i === 0 ? 'hop' : i === 1 ? 'flex' : 'smug');
      p.update(idt, it, rm);
    });
    // Hammer pose (after the rig update: the arm override wins): resting at the side, lifted a
    // little while 게임 시작 is focused, raised and swung down on the slam (ceremony).
    const arm = this.lead.rightPaw;
    if (arm && this.hammer.visible) {
      const raised = cer !== null;
      let z = (f === 'play' ? 0.75 : 0.3) + (rm ? 0 : Math.sin(it * 2.1) * 0.05);
      if (raised) z = 2.95;
      if (cer !== null) {
        const k = cer / CER.slam;
        z = k < 1 ? 2.5 + k * 0.8 : Math.max(1.05, 3.3 - (cer - CER.slam) * 22);
        this.armZ = z;
      } else {
        // lift / lower the hammer smoothly (no snap when 게임 시작 gains or loses focus)
        this.armZ += (z - this.armZ) * damp(rm ? 60 : 9, dt);
        z = this.armZ;
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
    const breathe = rm ? 0 : Math.sin(it * 0.3) * (front ? 0.08 : 0.12);
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
    disposeRope(this.zipRope);
    disposeProp(this.zipPole);
    for (const g of this.glows) disposeOwnedMesh(g);
    disposeOwnedMesh(this.mirror);
    disposeOwnedMesh(this.cityWindows);
    disposeProp(this.city);
    disposeProp(this.roof);
  }
}
