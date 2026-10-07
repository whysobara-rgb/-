/**
 * Title: a dusk plaza diorama floating in the sky. The raccoon gang heaves on a rope tied to
 * the bank like pulling a giant radish — the bank trembles, its roots strain, dust puffs —
 * then POP: the bank hops out of the ground, the gang tumbles onto their bottoms, springs up
 * and cheers while a few coins and confetti fly. The bank settles back and the loop restarts
 * (~7.4 s). Kept gentle on purpose: no screen shake and a plain gradient sky (no sunburst, no
 * clouds), so the logo above the diorama has clean sky around it.
 */
import * as THREE from 'three';
import type { HatId } from '../../sim/types';
import { createBank, createDecor, createSafe, createStaticCircle, createVan, RACCOON_TUMBLE_TIME, type BankRig, type SafeRig, type VanRig } from '../../render/models';
import { MenuScene, damp } from '../scene';
import { Puppet } from '../puppet';
import { POP, PropBuilder, addCrate, addIsland, disposeOwnedMesh, disposeProp, disposeRope, glowDisc, rope, roundBox, setRope, stringLights, type StringLights } from '../kit';

export const TITLE_LOOP = 7.4;
const PULL_START = 0.5;
const POP_AT = 3.1;
const SETTLE_AT = 6.3;

const BANK_POS = new THREE.Vector3(1.2, 0, -1.4);
/** Bank yaw: the left wall turns a little toward the camera so the pullers read in profile. */
const BANK_YAW = 0.32;

export interface TitleSceneOptions {
  /** The player's equipped hat (the lead puller wears it). */
  hat: HatId;
}

export class TitleScene extends MenuScene {
  readonly id = 'title';
  private readonly island: THREE.Group;
  private readonly bank: BankRig;
  private readonly safes: SafeRig[] = [];
  private readonly van: VanRig;
  private readonly pullers: Puppet[] = [];
  private readonly lookout: Puppet;
  private readonly rope: THREE.Mesh;
  private readonly ropeGroup = new THREE.Group();
  private readonly props: THREE.Object3D[] = [];
  private readonly glows: THREE.Mesh[] = [];
  private readonly lights: StringLights;
  /** Where the rope is tied on the bank's left wall (bank local). */
  private readonly knotLocal = new THREE.Vector3(-4.05, 1.05, 2.3);
  /** Pull direction (unit, xz): the crew faces it, three-quarters toward the camera. */
  private readonly pullDir = new THREE.Vector3(0.8, 0, 0.6).normalize();
  private loopT = 0;
  private popped = false;
  private settled = false;
  private cheered = false;
  private dustTimer = 0;

  constructor(o: TitleSceneOptions) {
    super({
      sky: ['#2F86E0', '#86CCFF', '#FFD08A'],
      skyStyle: { rays: null, clouds: null, stars: 0 },
      fog: '#FFD7A8',
      shadowRadius: 13,
    });
    this.baseFov = 30;

    // --- island + hand-placed crates (one baked prop) -------------------------------------------
    const ib = new PropBuilder();
    addIsland(ib, 9.4, { seed: 11 });
    addCrate(ib, 1.0, POP.wood, 2, [-7.2, 0, -1.2], 0.4);
    addCrate(ib, 0.7, '#D99A5E', 5, [-7.4, 0, 0.2], -0.3);
    addCrate(ib, 0.62, POP.wood, 9, [-7.15, 1.0, -1.25], 0.9);
    ib.add(roundBox(1.3, 0.85, 1.3, 0.07), POP.wood, [-5.2, 0.425, -4.6]);
    ib.add(roundBox(1.36, 0.12, 1.36, 0.04), POP.woodDark, [-5.2, 0.8, -4.6]);
    // A ring of pop-coloured tiles around the plaza edge.
    const tiles = [POP.sun, POP.tomato, POP.mint, POP.sky];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ib.add(roundBox(0.9, 0.06, 0.55, 0.03), tiles[i % 4]!, [Math.cos(a) * 8.6, 0.01, Math.sin(a) * 8.6], { rot: [0, -a, 0] });
    }
    this.island = ib.build('prop:titleIsland');
    this.scene.add(this.island);
    this.batcher.add(this.island);

    // --- the bank with its three safes ------------------------------------------------------------
    this.bank = createBank();
    this.bank.root.position.copy(BANK_POS);
    this.bank.root.rotation.y = BANK_YAW;
    // Draw-call diet: interior wall art is hidden behind the roof from this camera.
    this.bank.root.traverse((o) => {
      if (o.name === 'bank:portraits' || o.name === 'bank:posters') o.visible = false;
    });
    this.scene.add(this.bank.root);
    this.batcher.add(this.bank.root);
    for (const [kind, x] of [
      ['smallSafe', -2.8],
      ['largeSafe', 0],
      ['smallSafe', 2.8],
    ] as const) {
      const s = createSafe(kind);
      s.root.position.set(x, 0, 0);
      s.root.rotation.y = Math.PI / 2;
      // No floating value coins on the title (one draw each); blob shadows share a batch.
      s.root.traverse((o) => {
        if (/coin/i.test(o.name)) o.visible = false;
      });
      this.batchDecals(s.root);
      this.bank.root.add(s.root);
      this.batcher.add(s.root);
      this.safes.push(s);
    }

    // --- pullers: a line of three on one rope, in profile (they face +X toward the bank) ----------
    const crew: { hat: HatId; tint: number; team: 0 | null }[] = [
      { hat: o.hat, tint: 0.5, team: 0 },
      { hat: 'hodadakBand', tint: 0.78, team: 0 },
      { hat: 'teamCapA', tint: 0.22, team: 0 },
    ];
    this.rope = rope('#EAD2A6', 0.06);
    this.ropeGroup.add(this.rope);
    this.scene.add(this.ropeGroup);
    this.batcher.add(this.ropeGroup);
    crew.forEach((c, i) => {
      const p = new Puppet({ team: c.team, look: { hat: c.hat, furTint: c.tint }, yaw: Math.atan2(-this.pullDir.z, this.pullDir.x), scale: 1.12 });
      p.setAct('strain');
      p.holder.userData.slot = i;
      this.scene.add(p.holder);
      this.batcher.add(p.holder);
      this.pullers.push(p);
    });
    // Lookout on the big crate, cheering the crew on.
    this.lookout = new Puppet({ team: 0, look: { hat: 'teamCapB', furTint: 0.62 }, pos: new THREE.Vector3(-5.2, 0.86, -4.6), yaw: -0.6 });
    this.lookout.setAct('cheer');
    this.scene.add(this.lookout.holder);
    this.batcher.add(this.lookout.holder);

    // --- getaway van, trees, lamps, decor --------------------------------------------------------
    this.van = createVan(0);
    this.van.root.position.set(6.4, 0, 2.2);
    this.van.root.rotation.y = 2.2;
    this.van.setEngine(true);
    this.scene.add(this.van.root);
    this.batcher.add(this.van.root);
    const scenery: THREE.Object3D[] = [
      createStaticCircle({ id: 't1', kind: 'tree', center: { x: -6.4, y: -5.2 }, radius: 0.9, height: 4.3 }),
      createStaticCircle({ id: 't2', kind: 'tree', center: { x: 7.0, y: -4.4 }, radius: 0.8, height: 3.9 }),
      createStaticCircle({ id: 'l1', kind: 'lamp', center: { x: -2.6, y: -6.2 }, radius: 0.2, height: 3.4 }),
      createStaticCircle({ id: 'l2', kind: 'lamp', center: { x: 5.6, y: -1.4 }, radius: 0.2, height: 3.4 }),
      createDecor({ kind: 'flowers', pos: { x: -7.9, y: 2.4 }, angle: 0.3 }),
      createDecor({ kind: 'flowers', pos: { x: 3.4, y: 7.1 }, angle: -0.6, scale: 0.9 }),
      createDecor({ kind: 'cone', pos: { x: 5.2, y: 5.6 }, angle: 0.4 }),
      createDecor({ kind: 'balloon', pos: { x: 8.0, y: -1.6 }, angle: 0 }),
      createDecor({ kind: 'sign', pos: { x: 1.4, y: 6.6 }, angle: -0.2 }),
    ];
    for (const s of scenery) {
      this.scene.add(s);
      this.batcher.add(s);
      this.props.push(s);
    }
    this.lights = stringLights([
      { a: new THREE.Vector3(-2.6, 3.25, -6.2), b: new THREE.Vector3(5.6, 3.25, -1.4), count: 15, sag: 0.8 },
      { a: new THREE.Vector3(-2.6, 3.25, -6.2), b: new THREE.Vector3(-6.4, 2.9, -5.2), count: 7, sag: 0.4 },
    ]);
    this.scene.add(this.lights.group);
    this.batcher.add(this.lights.group);
    // The lamp models carry their own light pools; one warm glow under the crew is enough.
    for (const [x, z, r, c, a] of [[-3.6, 1.2, 4.6, '#FF9E7A', 0.24]] as const) {
      const g = glowDisc(r, c, a);
      g.position.set(x, 0.03, z);
      this.scene.add(g);
      this.glows.push(g);
    }

    // Contact shadows (menus use no shadow maps).
    this.addShadow(this.scene, 10.5, 8.2, [BANK_POS.x, 0, BANK_POS.z], 0.36).rotation.y = BANK_YAW;
    this.addShadow(this.scene, 5.6, 3.2, [6.4, 0, 2.2], 0.3).rotation.y = 2.2;
    this.addShadow(this.scene, 2.6, 3.4, [-7.2, 0, -0.6], 0.25);
    this.addShadow(this.scene, 1.9, 1.9, [-5.2, 0, -4.6], 0.25);
    this.addShadow(this.scene, 2.6, 2.6, [-6.4, 0, -5.2], 0.3);
    this.addShadow(this.scene, 2.4, 2.4, [7.0, 0, -4.4], 0.3);

    this.camPos.set(4, 8, 27);
    this.camLook.set(0.5, 5.1, 0);
  }

  /** World position of the rope knot on the bank wall (follows the hop). */
  private knot(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.knotLocal);
    out.y += this.bank.floorY - 0.06;
    return this.bank.root.localToWorld(out);
  }

  protected update(dt: number, t: number): void {
    const rm = this.reducedMotion;
    // Reduced motion: hold the proud "just uprooted" moment (no shakes, no hops, no loop).
    this.loopT = rm ? POP_AT + 1.6 : (this.loopT + dt) % TITLE_LOOP;
    const lt = this.loopT;
    if (lt < POP_AT && (this.popped || this.settled)) {
      this.popped = false;
      this.settled = false;
      this.cheered = false;
    }

    // --- heave / pop / cheer / settle --------------------------------------------------------
    let effort = 0;
    if (lt >= PULL_START && lt < POP_AT) {
      const k = (lt - PULL_START) / (POP_AT - PULL_START);
      effort = Math.min(1, k * 1.08) * (0.86 + 0.14 * Math.sin(lt * 8.5));
      this.dustTimer -= dt;
      if (this.dustTimer <= 0 && !rm) {
        this.dustTimer = 0.3 - 0.17 * k;
        const a = Math.random() * Math.PI * 2;
        const p = new THREE.Vector3(Math.cos(a) * 4.4, 0.05, Math.sin(a) * 3.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), BANK_YAW).add(BANK_POS);
        this.fx.dust(p, { count: 3 + Math.round(k * 4), spread: 0.6, size: 0.35 + k * 0.3 });
      }
      if (k > 0.5 && Math.random() < dt * 5) this.bank.wobbleSign(0.45 * k);
      if (k > 0.2 && Math.random() < dt * 2.2) this.cue('strain', k);
    }
    if (!this.popped && lt >= POP_AT) {
      this.popped = true;
      this.bank.setUprooted(true);
      if (!rm) {
        this.fx.dust(BANK_POS, { count: 18, spread: 4.2, size: 0.85, up: 2.2 });
        this.fx.ring({ x: BANK_POS.x, y: 0.06, z: BANK_POS.z }, { radius: 6.5, color: '#FFF1D6', duration: 0.75 });
        this.fx.chunks({ x: BANK_POS.x - 3.6, y: 0.4, z: BANK_POS.z + 1.2 }, { count: 12, power: 1.0 });
        this.fx.coins({ x: BANK_POS.x, y: 3.4, z: BANK_POS.z + 1 }, { count: 10, power: 1.0 });
      }
      this.cue('pop');
    }
    if (this.popped && !this.cheered && lt >= POP_AT + 1.0) {
      this.cheered = true;
      if (!rm) this.fx.confetti({ x: -2, y: 4.8, z: 2 }, { count: 36, power: 1.0 });
      this.cue('cheer');
    }
    if (this.popped && !this.settled && lt >= SETTLE_AT + 0.45) {
      this.settled = true;
      this.bank.setUprooted(false);
      if (!rm) this.fx.dust(BANK_POS, { count: 12, spread: 4, size: 0.55 });
      this.cue('thud', 0.6);
    }
    this.bank.setStrain(effort);
    let lift = 0;
    if (this.popped && !this.settled) {
      const u = lt - POP_AT - 0.95;
      if (u > 0) lift = Math.min(1, u * 2) * (0.24 + Math.sin(t * 2.4) * 0.06) * (lt > SETTLE_AT ? Math.max(0, 1 - (lt - SETTLE_AT) * 2.4) : 1);
    }
    this.bank.setLift(lift);
    this.bank.update(dt);
    for (const s of this.safes) {
      s.root.position.y = this.bank.floorY;
      s.update(dt);
    }

    // --- pullers ---------------------------------------------------------------------------------
    const knot = this.knot(new THREE.Vector3());
    const d = this.pullDir;
    const sincePop = lt - POP_AT;
    const slack = this.popped && lt < SETTLE_AT + 0.3;
    this.pullers.forEach((p, i) => {
      // Line up along the rope, away from the wall; lean back with the effort.
      const along = 1.45 + i * 1.3 + effort * 0.35;
      const target = new THREE.Vector3(knot.x - d.x * along + (i % 2) * 0.12, 0, knot.z - d.z * along);
      if (!p.holder.userData.placed) {
        p.holder.position.copy(target);
        p.holder.userData.placed = true;
      }
      p.holder.position.lerp(target, damp(slack ? 3 : 9, dt));
      if (this.popped && sincePop < RACCOON_TUMBLE_TIME && !rm) {
        p.setAct('idle');
        p.pose.tumble = sincePop + i * 0.04;
      } else {
        p.pose.tumble = undefined;
        if (slack) p.setAct(i === 1 ? 'hop' : 'cheer');
        else p.setAct('strain');
      }
      p.effort = effort;
      p.headYaw = slack ? 0.7 : null;
      p.update(dt, t, rm);
    });
    // One rope from behind the last puller, through every pair of paws, to the knot.
    const last = this.pullers[this.pullers.length - 1]!.holder.position;
    const tail = new THREE.Vector3(last.x - d.x * 0.8, slack ? 0.1 : 0.62, last.z - d.z * 0.8);
    const end = slack ? new THREE.Vector3(knot.x - d.x * 0.6, 0.12, knot.z - d.z * 0.6) : knot;
    setRope(this.rope, tail, end);

    this.lookout.update(dt, t, rm);
    this.van.update(dt);
    this.lights.twinkle(rm ? 0 : t);

    // --- camera: a slow drift and a small push during the heave; the diorama sits low in the
    // frame so the logo has the sky to itself ------------------------------------------------------
    const sway = rm ? 0.12 : 0.12 + Math.sin(t * 0.12) * 0.1;
    const push = effort * 0.8;
    const r = 28 - push;
    this.camPos.set(Math.sin(sway) * r, 7.6 - push * 0.2, Math.cos(sway) * r);
    this.camLook.set(-0.3, 5.0 - push * 0.15, 0);
  }

  protected override onDispose(): void {
    for (const p of this.pullers) p.dispose();
    this.lookout.dispose();
    for (const s of this.safes) s.dispose();
    disposeRope(this.rope);
    for (const g of this.glows) disposeOwnedMesh(g);
    for (const p of this.props) (p.userData.dispose as (() => void) | undefined)?.();
    for (const p of this.props) p.removeFromParent();
    this.lights.dispose();
    this.van.dispose();
    this.bank.dispose();
    disposeProp(this.island);
  }
}
