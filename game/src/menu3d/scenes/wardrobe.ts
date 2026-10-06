/**
 * Wardrobe: the player's raccoon on a slowly spinning turntable in a little dressing room
 * (vanity mirror with bulbs, polka-dot backdrop, hat boxes). Focusing a hat pops it on with a
 * squash-and-bounce and a sparkle burst; a locked hat shows a wrapped gift box bobbing on the
 * side table instead (the raccoon peeks at it).
 */
import * as THREE from 'three';
import type { HatId, TeamId } from '../../sim/types';
import { MenuScene, damp, easeOutBack } from '../scene';
import { Puppet } from '../puppet';
import { POP, PropBuilder, addGift, ball, cyl, disposeOwnedMesh, disposeProp, glowDisc, giftBox, roundBox, spotCone, stringLights, type StringLights } from '../kit';

export interface WardrobeSceneOptions {
  hat: HatId;
  team: TeamId;
}

export class WardrobeScene extends MenuScene {
  readonly id = 'wardrobe';
  private readonly room: THREE.Group;
  private readonly turntable: THREE.Group;
  private readonly lights: StringLights;
  private readonly puppet: Puppet;
  private readonly gift: THREE.Group;
  private readonly cone: THREE.Mesh;
  private readonly pool: THREE.Mesh;
  private shownHat: HatId;
  private locked = false;
  private giftT = 0;
  private spin = 0;
  private bounce = 1;

  constructor(o: WardrobeSceneOptions) {
    super({ sky: ['#2A1B5E', '#5A3A8E', '#8A5AA8'], shadowRadius: 8 });
    this.baseFov = 28;
    this.scene.fog = null;
    this.shownHat = o.hat;

    const b = new PropBuilder();
    // floor + backdrop wall with polka dots
    b.add(roundBox(16, 0.4, 10, 0.1), '#F3D9E8', [0, -0.2, -1]);
    for (let i = 0; i < 10; i++) b.add(roundBox(16 / 10 - 0.06, 0.03, 9.9, 0.02), i % 2 ? '#F7E6F0' : '#EBC9DD', [-8 + (i + 0.5) * 1.6, 0.01, -1]);
    b.add(roundBox(16, 8, 0.4, 0.1), POP.pink, [0, 4, -5.6]);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 11; x++) b.add(cyl(0.22, 0.22, 0.06, 14), POP.cream, [-7 + x * 1.4 + (y % 2) * 0.7, 0.8 + y * 1.25, -5.37], { rot: [Math.PI / 2, 0, 0] });
    b.add(roundBox(16.2, 0.4, 0.6, 0.12), POP.grape, [0, 0.2, -5.3]);
    // vanity mirror with bulbs (right side)
    b.add(roundBox(3.2, 3.8, 0.3, 0.3), POP.sun, [3.9, 3.1, -5.1]);
    b.add(roundBox(2.6, 3.2, 0.1, 0.25), '#CFEFFF', [3.9, 3.1, -4.94]);
    b.add(roundBox(4.2, 1.0, 1.4, 0.15), POP.wood, [3.9, 0.5, -4.4]);
    b.add(roundBox(4.3, 0.12, 1.5, 0.05), POP.woodLight, [3.9, 1.04, -4.4]);
    // hat boxes stack (left)
    b.add(cyl(0.75, 0.75, 0.7, 24), POP.sky, [-4.8, 0.35, -3.8]);
    b.add(cyl(0.8, 0.8, 0.14, 24), POP.skyDark, [-4.8, 0.74, -3.8]);
    b.add(cyl(0.6, 0.6, 0.55, 24), POP.mint, [-4.7, 1.08, -3.8]);
    b.add(cyl(0.64, 0.64, 0.12, 24), POP.mintDark, [-4.7, 1.38, -3.8]);
    b.add(cyl(0.45, 0.45, 0.45, 20), POP.tomato, [-4.85, 1.66, -3.8]);
    addGift(b, 0.7, POP.sun, POP.tomato, [-6.3, 0, -2.6]);
    // side table for the gift box
    b.add(cyl(0.7, 0.7, 0.12, 20), POP.wood, [2.6, 1.0, 0.6]);
    b.add(cyl(0.1, 0.14, 1.0, 8), POP.woodDark, [2.6, 0.5, 0.6]);
    b.add(cyl(0.45, 0.5, 0.06, 16), POP.woodDark, [2.6, 0.03, 0.6]);
    // coat rack with a scarf
    b.add(cyl(0.06, 0.07, 3.2, 8), POP.woodDark, [-6.7, 1.6, -4.6]);
    b.add(ball(0.12, 8), POP.sun, [-6.7, 3.25, -4.6]);
    b.add(cyl(0.05, 0.05, 1.1, 6), POP.woodDark, [-6.7, 2.9, -4.6], { rot: [0, 0, Math.PI / 2] });
    b.add(roundBox(0.3, 1.2, 0.12, 0.06), POP.tomato, [-7.15, 2.3, -4.55]);
    this.room = b.build('ward:room');
    this.scene.add(this.room);
    this.batcher.add(this.room);

    const tb = new PropBuilder();
    tb.add(cyl(1.9, 2.05, 0.45, 48), POP.grape, [0, 0.22, 0]);
    tb.add(cyl(1.95, 1.95, 0.08, 48), POP.cream, [0, 0.47, 0]);
    tb.add(cyl(1.75, 1.75, 0.06, 48), '#B79CF6', [0, 0.53, 0]);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      tb.add(ball(0.08, 6), k % 2 ? POP.sun : POP.cream, [Math.cos(a) * 1.98, 0.28, Math.sin(a) * 1.98]);
      tb.add(roundBox(0.5, 0.02, 0.12, 0.01), POP.cream, [Math.cos(a) * 1.4, 0.57, Math.sin(a) * 1.4], { rot: [0, -a, 0] });
    }
    this.turntable = tb.build('ward:turntable');
    this.turntable.position.set(-1.2, 0, 0.4);
    this.scene.add(this.turntable);
    this.batcher.add(this.turntable);

    this.lights = stringLights([
      { a: new THREE.Vector3(2.3, 5.0, -4.9), b: new THREE.Vector3(5.5, 5.0, -4.9), count: 7, sag: 0 },
      { a: new THREE.Vector3(2.35, 1.3, -4.9), b: new THREE.Vector3(2.35, 4.9, -4.9), count: 6, sag: 0 },
      { a: new THREE.Vector3(5.45, 1.3, -4.9), b: new THREE.Vector3(5.45, 4.9, -4.9), count: 6, sag: 0 },
      { a: new THREE.Vector3(-8, 7.6, -5.2), b: new THREE.Vector3(8, 7.6, -5.2), count: 22, sag: 0.9 },
    ]);
    this.scene.add(this.lights.group);
    this.batcher.add(this.lights.group);

    this.puppet = new Puppet({ team: o.team, look: { hat: o.hat, furTint: 0.5 }, pos: new THREE.Vector3(0, 0.56, 0), yaw: -Math.PI / 2, scale: 1.6 });
    this.turntable.add(this.puppet.holder);
    this.batcher.add(this.puppet.holder);

    this.gift = giftBox(0.85, POP.grape, POP.sun);
    this.gift.position.set(2.6, 1.06, 0.6);
    this.gift.scale.setScalar(0.001);
    this.scene.add(this.gift);
    this.batcher.add(this.gift);

    this.cone = spotCone(7.5, 2.4, '#FFF1C8', 0.07);
    this.cone.position.set(-1.2, 8.2, 0.4);
    this.scene.add(this.cone);
    this.pool = glowDisc(2.6, '#FFE6A8', 0.3);
    this.pool.position.set(-1.2, 0.6, 0.4);
    this.scene.add(this.pool);
    this.addShadow(this.scene, 4.6, 4.6, [-1.2, 0, 0.4], 0.3);

    this.camPos.set(0.4, 3.0, 12.5);
    this.camLook.set(0.4, 2.0, 0);
  }

  /** Show `hat` on the raccoon (pop + sparkle), or a wrapped gift box when it is locked. */
  showHat(hat: HatId, unlocked: boolean): void {
    this.locked = !unlocked;
    if (unlocked && hat !== this.shownHat) {
      this.shownHat = hat;
      this.puppet.setHat(hat);
      this.bounce = 0;
      if (!this.reducedMotion) {
        this.fx.sparkle(this.puppet.headTop(new THREE.Vector3()), { count: 14, radius: 0.9, color: POP.sun });
        this.puppet.hop(0.3);
      }
      this.cue('sparkle');
    } else if (!unlocked) {
      this.giftT = 0;
      this.cue('boing', 0.5);
    }
  }

  /** Equipped: a cheer and confetti. */
  celebrate(): void {
    if (!this.reducedMotion) this.fx.confetti(this.puppet.headTop(new THREE.Vector3()), { count: 40, power: 0.8 });
    this.puppet.setAct('cheer');
    this.cheerT = 1.4;
    this.cue('cheer', 0.7);
  }

  private cheerT = 0;

  protected update(dt: number, t: number): void {
    const rm = this.reducedMotion;
    this.spin += dt * (rm ? 0 : 0.45);
    // turntable: gentle back-and-forth so the face stays mostly toward us
    this.turntable.rotation.y = Math.sin(this.spin) * 0.75;
    this.bounce = Math.min(1, this.bounce + dt * 2.4);
    const sq = rm ? 1 : 1 + (1 - easeOutBack(this.bounce, 3)) * 0.25;
    this.puppet.holder.scale.set(1.6 / Math.sqrt(sq), 1.6 * sq, 1.6 / Math.sqrt(sq));
    if (this.cheerT > 0) {
      this.cheerT -= dt;
      if (this.cheerT <= 0) this.puppet.setAct('idle');
    }
    this.puppet.headYaw = this.locked ? -0.9 : null;
    this.puppet.expression = this.locked ? 'shock' : this.cheerT > 0 ? null : 'happy';
    this.puppet.update(dt, t, rm);
    // gift box pops in on its table when a locked hat is highlighted
    const gk = this.locked ? Math.min(1, (this.giftT += dt * 2.2)) : 0;
    const gs = this.locked ? (rm ? 1 : easeOutBack(gk, 2.2)) : Math.max(0.001, this.gift.scale.x * (1 - damp(12, dt)));
    this.gift.scale.setScalar(Math.max(0.001, gs));
    this.gift.visible = gs > 0.01;
    this.gift.rotation.y = rm ? 0.3 : Math.sin(t * 1.6) * 0.25 + 0.3;
    this.gift.position.y = 1.06 + (rm ? 0 : Math.abs(Math.sin(t * 3.2)) * 0.12 * (this.locked ? 1 : 0));
    this.lights.twinkle(rm ? 0 : t);
  }

  protected override onDispose(): void {
    this.puppet.dispose();
    disposeProp(this.gift);
    disposeOwnedMesh(this.cone);
    disposeOwnedMesh(this.pool);
    this.lights.dispose();
    disposeProp(this.turntable);
    disposeProp(this.room);
  }
}
