/**
 * Rival tournament: a little theatre stage. Three pedestals under spotlights, a red velvet
 * curtain, footlights. Each rival stands on its pedestal with a personality idle:
 *   호다닥 — can't stand still (quick hops), dashes in place when highlighted
 *   통큰이 — proud bouncy flex
 *   눈치왕 — slow, smug sway
 * Beaten rivals slump (the UI stamps "잡았다!" over their card), the locked rival is a
 * silhouette with glowing eyes peeking between half-drawn curtains.
 * `setCloseup(rival)` dollies in for the series intermission (the rival "talks").
 */
import * as THREE from 'three';
import type { HatId } from '../../sim/types';
import { MenuScene, damp } from '../scene';
import { Puppet, type Act } from '../puppet';
import { POP, PropBuilder, ball, cyl, disposeOwnedMesh, disposeProp, glowDisc, roundBox, setGlow, spotCone, stringLights, type StringLights } from '../kit';

export type StageRival = 'hodadak' | 'tongkeun' | 'nunchi';
export type StageState = 'locked' | 'available' | 'inProgress' | 'cleared';

export interface TournamentSceneOptions {
  rivals: readonly { rival: StageRival; state: StageState }[];
  focus?: StageRival | null;
  closeup?: StageRival | null;
}

const HAT: Record<StageRival, HatId> = { hodadak: 'hodadakBand', tongkeun: 'tongkeunHat', nunchi: 'nunchiMask' };
const COLOR: Record<StageRival, string> = { hodadak: POP.tomato, tongkeun: POP.sun, nunchi: POP.grape };
/** Pedestal x positions (match the three UI card columns at 16:9). */
export const PEDESTAL_X = [-5.9, 0, 5.9] as const;
const PED_TOP = 1.25;

interface Slot {
  rival: StageRival;
  state: StageState;
  puppet: Puppet;
  cone: THREE.Mesh;
  pool: THREE.Mesh;
  curtain: THREE.Group | null;
  glow: number;
}

export class TournamentScene extends MenuScene {
  readonly id = 'tournament';
  private readonly stage: THREE.Group;
  private readonly lights: StringLights;
  private readonly slots: Slot[] = [];
  private focus: StageRival | null;
  private closeup: StageRival | null;
  private confettiTimer = 0;

  constructor(o: TournamentSceneOptions) {
    super({ sky: ['#2A0E1E', '#45162C', '#5A1E34'], hemi: ['#FFD9D0', '#FFC9A8'], shadowRadius: 12 });
    this.baseFov = 30;
    this.focus = o.focus ?? null;
    this.closeup = o.closeup ?? null;
    this.scene.fog = null;
    this.lighting.sun.intensity *= 0.55;
    this.lighting.hemi.intensity *= 0.75;

    // --- the theatre ------------------------------------------------------------------------------
    const b = new PropBuilder();
    // stage floor + lip + steps
    b.add(roundBox(20, 0.9, 8.5, 0.12), POP.wood, [0, -0.45, -0.6]);
    for (let i = 0; i < 14; i++) b.add(roundBox(20 / 14 - 0.05, 0.04, 8.4, 0.02), i % 2 ? POP.woodLight : POP.wood, [-10 + (i + 0.5) * (20 / 14), 0.01, -0.6]);
    b.add(roundBox(20.4, 0.35, 0.5, 0.1), POP.sun, [0, -0.15, 3.55]);
    b.add(roundBox(20.6, 0.6, 1.2, 0.14), POP.velvetDark, [0, -1.15, 4.0]);
    // back curtain: soft folds
    for (let i = 0; i < 34; i++) {
      const x = -11 + i * 0.66;
      b.add(cyl(0.42, 0.46, 10, 12), i % 2 ? POP.velvet : POP.velvetDark, [x, 4.6, -4.6 + (i % 2) * 0.18]);
    }
    // valance + gold fringe
    b.add(roundBox(23, 1.3, 0.8, 0.2), POP.velvet, [0, 9.0, -3.9]);
    for (let i = 0; i < 46; i++) b.add(ball(0.13, 8), POP.sun, [-11.25 + i * 0.5, 8.3, -3.5]);
    for (let i = 0; i < 7; i++) b.add(roundBox(2.8, 0.25, 0.3, 0.1), POP.sun, [-9.6 + i * 3.2, 9.7, -3.45]);
    // side curtains (drawn)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) b.add(cyl(0.5, 0.75, 10, 12), i % 2 ? POP.velvet : POP.velvetDark, [side * (10.6 - i * 0.55), 4.6, -2.4 + i * 0.4]);
      b.add(new THREE.TorusGeometry(0.6, 0.12, 8, 16), POP.sun, [side * 9.9, 3.2, -1.2], { rot: [0, Math.PI / 2, 0] });
    }
    // pedestals
    PEDESTAL_X.forEach((x, i) => {
      const col = COLOR[o.rivals[i]?.rival ?? 'hodadak'];
      b.add(cyl(1.45, 1.6, PED_TOP - 0.15, 32), col, [x, (PED_TOP - 0.15) / 2, 0]);
      b.add(cyl(1.62, 1.62, 0.18, 32), POP.cream, [x, PED_TOP - 0.06, 0]);
      b.add(cyl(1.5, 1.5, 0.08, 32), new THREE.Color(col).lerp(new THREE.Color('#FFFFFF'), 0.35), [x, PED_TOP + 0.04, 0]);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        b.add(ball(0.09, 6), POP.cream, [x + Math.cos(a) * 1.55, 0.45, Math.sin(a) * 1.55]);
      }
    });
    this.stage = b.build('tour:stage');
    this.scene.add(this.stage);
    this.batcher.add(this.stage);

    // footlights along the lip
    this.lights = stringLights([{ a: new THREE.Vector3(-9.8, 0.1, 3.55), b: new THREE.Vector3(9.8, 0.1, 3.55), count: 24, sag: 0 }]);
    this.scene.add(this.lights.group);
    this.batcher.add(this.lights.group);

    // --- rivals, spots, curtains ------------------------------------------------------------------
    o.rivals.forEach((r, i) => {
      const x = PEDESTAL_X[i] ?? 0;
      const puppet = new Puppet({ team: 1, look: { hat: HAT[r.rival], rival: r.rival }, pos: new THREE.Vector3(x, PED_TOP + 0.08, 0.1), yaw: -Math.PI / 2, scale: 1.45 });
      this.scene.add(puppet.holder);
      this.batcher.add(puppet.holder);
      const cone = spotCone(9, 2.2, '#FFF1C8', 0.0);
      cone.position.set(x, 10.5, 0.2);
      this.scene.add(cone);
      const pool = glowDisc(2.0, '#FFE6A8', 0.0);
      pool.position.set(x, PED_TOP + 0.1, 0.1);
      this.scene.add(pool);
      let curtain: THREE.Group | null = null;
      if (r.state === 'locked') {
        puppet.setSilhouette(true);
        const cb = new PropBuilder();
        // A little drawn curtain in front of the pedestal: the silhouette peeks through the gap.
        const ch = 3.3;
        const cy = PED_TOP + ch / 2;
        for (let k = 0; k < 4; k++) {
          cb.add(cyl(0.2, 0.26, ch, 10), k % 2 ? POP.velvet : POP.velvetDark, [x - 1.65 + k * 0.32, cy, 1.7]);
          cb.add(cyl(0.2, 0.26, ch, 10), k % 2 ? POP.velvet : POP.velvetDark, [x + 1.65 - k * 0.32, cy, 1.7]);
        }
        cb.add(roundBox(3.9, 0.45, 0.45, 0.14), POP.velvetDark, [x, PED_TOP + ch + 0.15, 1.7]);
        cb.add(roundBox(4.0, 0.14, 0.5, 0.05), POP.sun, [x, PED_TOP + ch - 0.1, 1.72]);
        for (const sx of [-1, 1]) cb.add(new THREE.TorusGeometry(0.22, 0.06, 6, 12), POP.sun, [x + sx * 1.25, cy - 0.3, 1.95]);
        curtain = cb.build(`tour:curtain${i}`);
        this.scene.add(curtain);
        this.batcher.add(curtain);
      }
      this.slots.push({ rival: r.rival, state: r.state, puppet, cone, pool, curtain, glow: 0 });
    });

    // The rivals stand in the upper half: the UI cards fill the lower half of the screen.
    this.camPos.set(0, 2.9, 18.6);
    this.camLook.set(0, 1.3, 0);
    this.lighting.setFocus(new THREE.Vector3(0, 0, 0));
  }

  setFocus(r: StageRival | null): void {
    if (r === this.focus) return;
    this.focus = r;
    const s = this.slots.find((x) => x.rival === r);
    if (s && s.state !== 'locked' && !this.reducedMotion) {
      s.puppet.hop(0.45);
      if (s.state === 'cleared') this.fx.confetti(s.puppet.headTop(new THREE.Vector3()), { count: 26, power: 0.6 });
    }
    this.cue('tick');
  }

  /** Close-up on one rival (series intermission), or back to the full stage. */
  setCloseup(r: StageRival | null): void {
    this.closeup = r;
  }

  protected update(dt: number, t: number): void {
    const rm = this.reducedMotion;
    for (const s of this.slots) {
      const focused = s.rival === this.focus || s.rival === this.closeup;
      let act: Act;
      if (s.state === 'locked') act = 'idle';
      else if (s.state === 'cleared') act = focused ? 'cheer' : 'sad';
      else if (s.rival === 'hodadak') act = focused ? 'dash' : 'hop';
      else if (s.rival === 'tongkeun') act = 'flex';
      else act = 'smug';
      s.puppet.setAct(act);
      s.puppet.expression = s.state === 'cleared' && !focused ? 'dizzy' : null;
      s.puppet.update(dt, t, rm);
      const want = s.state === 'locked' ? (focused ? 0.35 : 0.12) : this.closeup ? (focused ? 0.45 : 0.1) : focused ? 1 : this.focus ? 0.35 : 0.6;
      s.glow += (want - s.glow) * damp(6, dt);
      setGlow(s.cone, 0.085 * s.glow);
      setGlow(s.pool, 0.5 * s.glow);
    }
    // a little confetti rain over a highlighted cleared rival
    const fs = this.slots.find((x) => x.rival === this.focus && x.state === 'cleared');
    if (fs && !rm) {
      this.confettiTimer -= dt;
      if (this.confettiTimer <= 0) {
        this.confettiTimer = 0.9;
        this.fx.confetti({ x: PEDESTAL_X[this.slots.indexOf(fs)] ?? 0, y: 6.5, z: 0.4 }, { count: 10, power: 0.35 });
      }
    }
    this.lights.twinkle(rm ? 0 : t * 1.4);

    // camera: full stage, or a dolly toward the close-up rival
    const ci = this.closeup ? this.slots.findIndex((x) => x.rival === this.closeup) : -1;
    // The round cards cover the lower third: look a little low so the pedestals and rivals sit
    // in the upper two thirds, close enough that each rival reads as a character.
    const goalPos = new THREE.Vector3(0, 2.9, 18.6);
    const goalLook = new THREE.Vector3(0, 1.3, 0);
    if (ci >= 0) {
      const x = PEDESTAL_X[ci] ?? 0;
      // The rival stands in the left third; the intermission card fills the right.
      goalPos.set(x + 2.2, 3.3, 11.5);
      goalLook.set(x + 3.1, 1.9, 0);
    } else if (!rm) {
      goalPos.x += Math.sin(t * 0.25) * 0.4;
    }
    const k = damp(rm ? 50 : 3, dt);
    this.camPos.lerp(goalPos, k);
    this.camLook.lerp(goalLook, k);
  }

  protected override onDispose(): void {
    for (const s of this.slots) {
      s.puppet.dispose();
      disposeOwnedMesh(s.cone);
      disposeOwnedMesh(s.pool);
      if (s.curtain) disposeProp(s.curtain);
    }
    this.lights.dispose();
    disposeProp(this.stage);
  }
}
