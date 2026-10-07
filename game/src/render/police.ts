/**
 * Police presentation (owner addition beyond doc v0.5): consumes state.police /
 * state.policeCars and the police events exactly as typed in src/sim/types.ts. Pure view —
 * officers treat both teams identically in the sim; nothing here can change a score.
 *
 *  - Cars: interpolated poses; a drive-in that ends in a drifting stop (yaw kick that springs
 *    back, body roll, dust + skid marks), wheel spin, red / blue light-bar strobes that light
 *    the ground on either side, and a drive-out. If the sim parks a car without animating its
 *    arrival, the view plays the drive-in from the layout's police entry itself.
 *  - Officers: puppy-cop rigs (models/police.ts) animated from their phase: run, comic lunge
 *    dive, tired panting, stunned on their backs, whistle, arm-waving "멈춰!". They hop out
 *    of the car on arrival and pop back into it when they leave.
 *  - Tackles: star burst + ring + impact frame / camera punch when it involves the player.
 */
import * as THREE from 'three';
import type { EntityId, LayoutDef, PoliceCarState, PoliceEntryDef, PoliceOfficerState, PolicePhase, SimEvent, Simulation, Vec2 } from '../sim';
import { POLICE, policeEntriesFor } from '../sim';
import { createOfficer, createPoliceCar, placeOnSim, type OfficerRig, type PoliceCarRig } from './models';
import { radialGlowTexture } from './models/textures';
import type { ViewEffects } from './effects';
import type { OffscreenMarkers } from './markers';
import { damp, lerpAngle, wrapAngle, type Pose2 } from './sync';

export interface PoliceHost {
  readonly effects: ViewEffects;
  focusId(): EntityId | null;
  impact(at: Vec2, strength: number, chroma: number): void;
  shake(at: Vec2, amount: number, radius: number): void;
  punch(dir: Vec2, strength: number): void;
  scare(at: Vec2, radius: number): void;
  /** Character's interpolated position (for tackle FX placement), or null. */
  charPos(id: EntityId): Vec2 | null;
}

interface PoseEntry {
  prev: Pose2;
  curr: Pose2;
  tick: number;
}

interface OfficerView {
  id: EntityId;
  rig: OfficerRig;
  pose: Pose2;
  facing: number;
  phase: PolicePhase;
  phaseStart: number;
  spawnT: number;
  /** >= 0 while popping out after leaving the state. */
  goneT: number;
  whistleUntil: number;
  lastX: number;
  lastY: number;
  speed: number;
  stepAcc: number;
}

interface CarView {
  id: number;
  rig: PoliceCarRig;
  pose: Pose2;
  entry: PoliceEntryDef | null;
  /** Scripted drive-in (sim parked it without motion). */
  scripted: boolean;
  t: number;
  phase: string;
  speed: number;
  lastX: number;
  lastY: number;
  driftYaw: number;
  driftVel: number;
  roll: number;
  goneT: number;
  pools: THREE.Mesh[];
  dustAcc: number;
  arrivedFx: boolean;
  /** View time the car appeared / parked (attention markers + camera hint). */
  spawnedAt: number;
  parkedAt: number;
}

const _v = new THREE.Vector3();

function entryFor(layout: LayoutDef, idx: number): PoliceEntryDef | null {
  const all = policeEntriesFor(layout);
  return all.length ? all[idx % all.length]! : null;
}

export class PoliceView {
  readonly root = new THREE.Group();
  private readonly officers = new Map<EntityId, OfficerView>();
  private readonly cars = new Map<number, CarView>();
  private readonly poses = new Map<string, PoseEntry>();
  private readonly poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly poolMats: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];
  private readonly skid: THREE.InstancedMesh;
  private readonly skidGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly skidMat = new THREE.MeshBasicMaterial({ color: '#3A3443', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  private readonly skids: { x: number; y: number; a: number; len: number; life: number }[] = [];
  private time = 0;
  private layout: LayoutDef | null = null;

  constructor(private readonly host: PoliceHost) {
    this.root.name = 'police';
    const mk = (color: string): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ map: radialGlowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.poolMats = [mk('#FF3B4E'), mk('#3B7BFF')];
    this.skid = new THREE.InstancedMesh(this.skidGeo, this.skidMat, 64);
    this.skid.count = 0;
    this.skid.frustumCulled = false;
    this.skid.renderOrder = 1;
    this.skid.userData.noOutline = true;
    this.root.add(this.skid);
  }

  setLayout(layout: LayoutDef | null): void {
    this.layout = layout;
  }

  /** Store this tick's officer / car poses (call after every sim.step with captureTick). */
  capture(sim: Simulation): void {
    const st = sim.state;
    for (const o of st.police) this.put(`o${o.id}`, o.pos.x, o.pos.y, o.facing, st.tick);
    for (const c of st.policeCars) this.put(`c${c.id}`, c.pos.x, c.pos.y, c.angle, st.tick);
  }

  private put(key: string, x: number, y: number, a: number, tick: number): void {
    let e = this.poses.get(key);
    if (!e) {
      e = { prev: { x, y, a }, curr: { x, y, a }, tick };
      this.poses.set(key, e);
      return;
    }
    if (tick !== e.tick) {
      e.prev.x = e.curr.x;
      e.prev.y = e.curr.y;
      e.prev.a = e.curr.a;
      e.tick = tick;
    }
    e.curr.x = x;
    e.curr.y = y;
    e.curr.a = a;
    if (Math.hypot(x - e.prev.x, y - e.prev.y) > 3) {
      e.prev.x = x;
      e.prev.y = y;
      e.prev.a = a;
    }
  }

  private sample(key: string, alpha: number, out: Pose2, fx: number, fy: number, fa: number): Pose2 {
    const e = this.poses.get(key);
    if (!e) {
      out.x = fx;
      out.y = fy;
      out.a = fa;
      return out;
    }
    const t = Math.min(1, Math.max(0, alpha));
    out.x = e.prev.x + (e.curr.x - e.prev.x) * t;
    out.y = e.prev.y + (e.curr.y - e.prev.y) * t;
    out.a = lerpAngle(e.prev.a, e.curr.a, t);
    return out;
  }

  /** Head-top anchor for emotes; false if the officer is not on screen. */
  anchor(officerId: EntityId, out: THREE.Vector3): boolean {
    const v = this.officers.get(officerId);
    if (!v || v.goneT >= 0) return false;
    const down = v.phase === 'stunned' ? 0.55 : v.phase === 'tackle' ? 0.5 : 0;
    out.set(v.pose.x, 1.28 - down, v.pose.y);
    return true;
  }

  /** Officer pose for the camera / tests. */
  officerPos(id: EntityId): Vec2 | null {
    const v = this.officers.get(id);
    return v ? { x: v.pose.x, y: v.pose.y } : null;
  }

  get stats(): { officers: number; cars: number } {
    return { officers: this.officers.size, cars: this.cars.size };
  }

  onEvent(e: SimEvent, sim: Simulation): void {
    const fx = this.host.effects.fx;
    switch (e.type) {
      case 'policeTackle': {
        const ov = this.officers.get(e.officerId);
        if (ov) ov.whistleUntil = this.time + (e.hit ? 1.2 : 0);
        const vp = this.host.charPos(e.victimId) ?? sim.getCharacter(e.victimId)?.pos ?? null;
        if (!vp) break;
        const focus = this.host.focusId();
        const involved = focus === e.victimId;
        if (e.hit) {
          fx.stars({ x: vp.x, y: 0.4, z: vp.y }, { count: 9, size: 0.24 });
          fx.stars({ x: vp.x, y: 0.5, z: vp.y }, { count: 4, size: 0.3, color: '#FFFFFF' });
          fx.ring({ x: vp.x, y: 0.02, z: vp.y }, { radius: 2.2, color: '#FFE14D', duration: 0.35 });
          fx.ring({ x: vp.x, y: 0.03, z: vp.y }, { radius: 1.3, color: '#FFFFFF', duration: 0.25 });
          fx.dust({ x: vp.x, y: 0, z: vp.y }, { count: 8, spread: 0.6, size: 0.3 });
          this.host.scare(vp, 6);
          if (ov) {
            const dir = { x: vp.x - ov.pose.x, y: vp.y - ov.pose.y };
            if (involved) this.host.punch(dir, 0.5);
          }
          this.host.impact(vp, involved ? 0.9 : 0.45, involved ? 0.8 : 0.3);
          this.host.shake(vp, involved ? 0.5 : 0.2, 18);
        } else if (ov) {
          // Whiff: a belly-slide puff.
          fx.dust({ x: ov.pose.x, y: 0, z: ov.pose.y }, { count: 6, spread: 0.5, size: 0.26, dir: { x: Math.cos(ov.facing), y: 0, z: Math.sin(ov.facing) } });
        }
        break;
      }
      case 'policeStunned': {
        const ov = this.officers.get(e.officerId);
        if (ov) {
          fx.stars({ x: ov.pose.x, y: 0.4, z: ov.pose.y }, { count: 7, size: 0.2 });
          fx.ring({ x: ov.pose.x, y: 0.02, z: ov.pose.y }, { radius: 1.6, color: '#FFFFFF', duration: 0.3 });
          if (this.host.focusId() === e.byCharId) this.host.impact({ x: ov.pose.x, y: ov.pose.y }, 0.5, 0.4);
        }
        break;
      }
      case 'policeSpotted': {
        const ov = this.officers.get(e.officerId);
        if (ov) ov.whistleUntil = this.time + 0.9;
        break;
      }
      case 'policeArrived': {
        const cv = this.cars.get(e.carId);
        if (cv && !cv.arrivedFx) this.arrivalFlourish(cv);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Screen-edge markers for police the player cannot see: a car on its way in / just parked
   * (siren on) and officers chasing the focus character from outside the frame. The layouts
   * park the car behind the shop rows, so without this the chase starts with officers
   * "appearing from nowhere".
   */
  collectMarkers(markers: OffscreenMarkers, camera: THREE.Camera, focusId: EntityId | null, sim: Simulation): void {
    for (const cv of this.cars.values()) {
      if (cv.goneT >= 0) continue;
      const parked = cv.parkedAt >= 0 ? this.time - cv.parkedAt : 0;
      if (cv.phase !== 'arriving' && !(cv.phase === 'parked' && parked < 5)) continue;
      const fade = cv.phase === 'parked' ? Math.min(1, (5 - parked) / 0.8) : Math.min(1, (this.time - cv.spawnedAt) / 0.25);
      // Parked outside the arena = behind the shop rows: keep the sticker over it.
      const L = this.layout?.size;
      const outside = !!L && (cv.pose.x < 0.5 || cv.pose.y < 0.5 || cv.pose.x > L.x - 0.5 || cv.pose.y > L.y - 0.5);
      markers.add(camera, { x: cv.pose.x, y: 1, z: cv.pose.y, icon: 'siren', alpha: fade, siren: true, occluded: outside }, this.time);
    }
    if (focusId === null) return;
    for (const o of sim.state.police) {
      if (o.targetCharId !== focusId || (o.phase !== 'chase' && o.phase !== 'tackle')) continue;
      const ov = this.officers.get(o.id);
      if (!ov || ov.goneT >= 0) continue;
      markers.add(camera, { x: ov.pose.x, y: 0.8, z: ov.pose.y, icon: 'alert', scale: 0.8, siren: true }, this.time);
    }
  }

  /**
   * Camera hint while a car pulls up near the focus: a ground point to glance toward and a
   * 0..1 weight envelope (rises, holds ~1.2 s, eases back). Null when nothing to show.
   */
  attention(focus: Vec2): { x: number; y: number; w: number } | null {
    let best: { x: number; y: number; w: number } | null = null;
    for (const cv of this.cars.values()) {
      if (cv.goneT >= 0) continue;
      const t = this.time - cv.spawnedAt;
      const T = POLICE.arriveTicks / 60 + 1.6;
      if (t < 0 || t > T) continue;
      const d = Math.hypot(cv.pose.x - focus.x, cv.pose.y - focus.y);
      if (d > 26) continue;
      const env = Math.min(1, t / 0.6) * Math.min(1, (T - t) / 0.8);
      const w = env * Math.min(1, (26 - d) / 6);
      // Look at where the car is heading (its parking spot) rather than chasing the drive-in.
      const tx = cv.entry ? cv.entry.park.x : cv.pose.x;
      const ty = cv.entry ? cv.entry.park.y : cv.pose.y;
      if (!best || w > best.w) best = { x: tx, y: ty, w };
    }
    return best;
  }

  private arrivalFlourish(cv: CarView): void {
    cv.arrivedFx = true;
    cv.driftVel += (Math.random() < 0.5 ? -1 : 1) * 7;
    cv.roll = 0.12;
    const fx = this.host.effects.fx;
    const c = Math.cos(cv.pose.a);
    const s = Math.sin(cv.pose.a);
    for (const sz of [-1, 1]) {
      const x = cv.pose.x - c * 1.2 - s * sz * 0.8;
      const y = cv.pose.y - s * 1.2 + c * sz * 0.8;
      fx.dust({ x, y: 0, z: y }, { count: 6, spread: 0.5, size: 0.42, up: 0.8 });
      this.addSkid(x, y, cv.pose.a + sz * 0.2, 2.2);
    }
    fx.ring({ x: cv.pose.x, y: 0.02, z: cv.pose.y }, { radius: 3.5, color: '#FFFFFF', duration: 0.4 });
    this.host.shake({ x: cv.pose.x, y: cv.pose.y }, 0.15, 20);
    this.host.scare({ x: cv.pose.x, y: cv.pose.y }, 8);
  }

  private addSkid(x: number, y: number, a: number, len: number): void {
    if (this.skids.length >= 60) this.skids.shift();
    this.skids.push({ x, y, a, len, life: 5 });
  }

  update(sim: Simulation, alpha: number, dt: number, show: boolean): void {
    this.time += dt;
    this.root.visible = show;
    const st = sim.state;
    // --- cars ------------------------------------------------------------------
    const seenCars = new Set<number>();
    for (const c of st.policeCars) {
      if (c.phase === 'gone') continue;
      seenCars.add(c.id);
      let cv = this.cars.get(c.id);
      if (!cv) cv = this.spawnCar(c);
      this.updateCar(cv, c, alpha, dt);
    }
    for (const [id, cv] of this.cars) {
      if (seenCars.has(id)) continue;
      // Drove off the field: keep going along the heading, then free.
      if (cv.goneT < 0) cv.goneT = 0;
      cv.goneT += dt;
      cv.pose.x += Math.cos(cv.pose.a) * 9 * dt;
      cv.pose.y += Math.sin(cv.pose.a) * 9 * dt;
      cv.rig.setSpeed(9);
      placeOnSim(cv.rig.root, cv.pose, cv.pose.a);
      cv.rig.update(dt, this.time);
      this.updatePools(cv, 0);
      if (cv.goneT > 2) {
        this.disposeCar(cv);
        this.cars.delete(id);
        this.poses.delete(`c${id}`);
      }
    }
    // --- officers ------------------------------------------------------------------
    const seen = new Set<EntityId>();
    for (const o of st.police) {
      if (o.phase === 'gone') continue;
      seen.add(o.id);
      let ov = this.officers.get(o.id);
      if (!ov) ov = this.spawnOfficer(o);
      this.updateOfficer(ov, o, alpha, dt);
    }
    for (const [id, ov] of this.officers) {
      if (seen.has(id)) continue;
      if (ov.goneT < 0) {
        ov.goneT = 0;
        this.host.effects.fx.dust({ x: ov.pose.x, y: 0, z: ov.pose.y }, { count: 5, spread: 0.3, size: 0.25 });
      }
      ov.goneT += dt;
      const k = Math.max(0, 1 - ov.goneT / 0.25);
      ov.rig.root.scale.setScalar(Math.max(0.001, k * (1 + 0.3 * Math.sin(k * Math.PI))));
      if (ov.goneT > 0.25) {
        ov.rig.dispose();
        this.officers.delete(id);
        this.poses.delete(`o${id}`);
      }
    }
    // --- skid marks -------------------------------------------------------------
    let n = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let i = this.skids.length - 1; i >= 0; i--) {
      const s = this.skids[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        this.skids.splice(i, 1);
        continue;
      }
    }
    for (const s of this.skids) {
      q.setFromAxisAngle(_v.set(0, 1, 0), -s.a);
      sc.set(s.len, 1, 0.22 * Math.min(1, s.life / 1.5));
      m.compose(_v.set(s.x, 0.015, s.y), q, sc);
      this.skid.setMatrixAt(n++, m);
    }
    this.skid.count = n;
    this.skid.instanceMatrix.needsUpdate = true;
  }

  private spawnCar(c: PoliceCarState): CarView {
    const rig = createPoliceCar();
    this.root.add(rig.root);
    const pools = this.poolMats.map((mat) => {
      const p = new THREE.Mesh(this.poolGeo, mat.clone());
      p.renderOrder = 2;
      p.userData.noOutline = true;
      p.scale.set(7, 1, 7);
      this.root.add(p);
      return p;
    });
    const entry = this.layout ? entryFor(this.layout, c.entryIndex) : null;
    const scripted = c.phase === 'arriving' && !!entry && Math.hypot(c.pos.x - entry.park.x, c.pos.y - entry.park.y) < 0.6;
    const cv: CarView = {
      id: c.id,
      rig,
      pose: { x: c.pos.x, y: c.pos.y, a: c.angle },
      entry,
      scripted,
      t: 0,
      phase: c.phase,
      speed: 0,
      lastX: c.pos.x,
      lastY: c.pos.y,
      driftYaw: 0,
      driftVel: 0,
      roll: 0,
      goneT: -1,
      pools,
      dustAcc: 0,
      arrivedFx: false,
      spawnedAt: c.phase === 'arriving' ? this.time : this.time - 99,
      parkedAt: c.phase === 'parked' ? this.time - 99 : -1,
    };
    this.cars.set(c.id, cv);
    return cv;
  }

  private disposeCar(cv: CarView): void {
    cv.rig.dispose();
    for (const p of cv.pools) {
      (p.material as THREE.Material).dispose();
      p.removeFromParent();
    }
  }

  private updateCar(cv: CarView, c: PoliceCarState, alpha: number, dt: number): void {
    const arriveSec = POLICE.arriveTicks / 60;
    if (cv.scripted && cv.entry && c.phase === 'arriving') {
      cv.t += dt;
      const k = Math.min(1, cv.t / arriveSec);
      // Fast in, hard brake at the end (ease-out cubic), heading toward the park spot.
      const e = 1 - Math.pow(1 - k, 3);
      const from = cv.entry.from;
      const to = cv.entry.park;
      cv.pose.x = from.x + (to.x - from.x) * e;
      cv.pose.y = from.y + (to.y - from.y) * e;
      const travel = Math.atan2(to.y - from.y, to.x - from.x);
      cv.pose.a = lerpAngle(travel, cv.entry.angle, THREE.MathUtils.smoothstep(k, 0.7, 1));
      if (k > 0.82 && !cv.arrivedFx) this.arrivalFlourish(cv);
    } else {
      cv.scripted = false;
      this.sample(`c${c.id}`, alpha, cv.pose, c.pos.x, c.pos.y, c.angle);
    }
    if (c.phase !== cv.phase) {
      if (c.phase === 'parked' && !cv.arrivedFx) this.arrivalFlourish(cv);
      if (c.phase === 'parked') cv.parkedAt = this.time;
      if (c.phase === 'leaving') cv.driftVel += 2.5;
      cv.phase = c.phase;
    }
    // Speed (for wheels + dust).
    if (dt > 0) {
      const v = Math.hypot(cv.pose.x - cv.lastX, cv.pose.y - cv.lastY) / dt;
      cv.speed += (Math.min(20, v) - cv.speed) * damp(10, dt);
    }
    cv.lastX = cv.pose.x;
    cv.lastY = cv.pose.y;
    // Drift spring.
    if (dt > 0) {
      cv.driftVel += (-60 * cv.driftYaw - 7 * cv.driftVel) * dt;
      cv.driftYaw += cv.driftVel * dt;
      cv.roll *= Math.exp(-dt * 4);
    }
    placeOnSim(cv.rig.root, cv.pose, cv.pose.a);
    cv.rig.body.rotation.set(cv.roll * Math.sin(this.time * 9), -cv.driftYaw, 0);
    cv.rig.body.position.y = Math.abs(Math.sin(this.time * 16)) * 0.02 * Math.min(1, cv.speed / 6);
    cv.rig.setSpeed(cv.speed);
    cv.rig.setSiren(c.sirenOn);
    cv.rig.update(dt, this.time);
    // Dust while driving fast.
    if (cv.speed > 3 && dt > 0) {
      cv.dustAcc += dt * cv.speed * 0.9;
      const ca = Math.cos(cv.pose.a);
      const sa = Math.sin(cv.pose.a);
      while (cv.dustAcc >= 1) {
        cv.dustAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.host.effects.dragDust({ x: cv.pose.x - ca * 1.3 - sa * side * 0.8, y: cv.pose.y - sa * 1.3 + ca * side * 0.8 }, { x: -ca, y: -sa }, 0.36);
      }
    }
    this.updatePools(cv, c.sirenOn ? 1 : 0);
  }

  private updatePools(cv: CarView, on: number): void {
    const [red, blue] = cv.pools as [THREE.Mesh, THREE.Mesh];
    const ca = Math.cos(cv.pose.a);
    const sa = Math.sin(cv.pose.a);
    // Red on the car's left (-z local), blue on its right.
    red.position.set(cv.pose.x + sa * 2.2, 0.03, cv.pose.y - ca * 2.2);
    blue.position.set(cv.pose.x - sa * 2.2, 0.03, cv.pose.y + ca * 2.2);
    (red.material as THREE.MeshBasicMaterial).opacity = on * (0.08 + 0.55 * cv.rig.strobe.red);
    (blue.material as THREE.MeshBasicMaterial).opacity = on * (0.08 + 0.55 * cv.rig.strobe.blue);
    red.visible = blue.visible = on > 0;
  }

  private spawnOfficer(o: PoliceOfficerState): OfficerView {
    const rig = createOfficer(o.id);
    this.root.add(rig.root);
    this.host.effects.fx.dust({ x: o.pos.x, y: 0, z: o.pos.y }, { count: 5, spread: 0.3, size: 0.25 });
    const ov: OfficerView = {
      id: o.id,
      rig,
      pose: { x: o.pos.x, y: o.pos.y, a: o.facing },
      facing: o.facing,
      phase: o.phase,
      phaseStart: this.time,
      spawnT: 0,
      goneT: -1,
      whistleUntil: this.time + 1,
      lastX: o.pos.x,
      lastY: o.pos.y,
      speed: 0,
      stepAcc: 0,
    };
    this.officers.set(o.id, ov);
    return ov;
  }

  private updateOfficer(ov: OfficerView, o: PoliceOfficerState, alpha: number, dt: number): void {
    this.sample(`o${o.id}`, alpha, ov.pose, o.pos.x, o.pos.y, o.facing);
    if (o.phase !== ov.phase) {
      ov.phase = o.phase;
      ov.phaseStart = this.time;
    }
    ov.facing = Math.abs(wrapAngle(ov.pose.a - ov.facing)) > 2.6 ? ov.pose.a : lerpAngle(ov.facing, ov.pose.a, damp(18, dt));
    if (dt > 0) {
      const v = Math.hypot(ov.pose.x - ov.lastX, ov.pose.y - ov.lastY) / dt;
      ov.speed += (Math.min(12, v) - ov.speed) * damp(14, dt);
      // Footstep puffs when running.
      if (ov.speed > 2.5 && o.phase !== 'tackle') {
        ov.stepAcc += ov.speed * dt;
        if (ov.stepAcc > 0.9) {
          ov.stepAcc = 0;
          this.host.effects.footstep({ x: ov.pose.x, y: ov.pose.y });
        }
      }
    }
    ov.lastX = ov.pose.x;
    ov.lastY = ov.pose.y;
    ov.spawnT += dt;
    const pop = Math.min(1, ov.spawnT / 0.22);
    const sc = pop < 1 ? Math.max(0.001, pop * (1 + 0.35 * Math.sin(pop * Math.PI))) : 1;
    ov.rig.root.scale.setScalar(sc);
    placeOnSim(ov.rig.root, ov.pose, ov.facing);
    const tackle = o.phase === 'tackle' ? 1 - o.tackleTicks / Math.max(1, POLICE.tackleTicks) : 0;
    ov.rig.update(dt, {
      phase: o.phase,
      speed: ov.speed,
      time: this.time + o.id * 1.3,
      tackle,
      phaseTime: this.time - ov.phaseStart,
      whistle: this.time < ov.whistleUntil,
      wave: o.phase === 'chase' && Math.sin(this.time * 0.9 + o.id) > -0.2,
    });
    // Tackle streak dust.
    if (o.phase === 'tackle' && dt > 0 && Math.random() < 0.5) this.host.effects.fx.dust({ x: ov.pose.x, y: 0, z: ov.pose.y }, { count: 1, spread: 0.2, size: 0.22, up: 0.3 });
  }

  clear(): void {
    for (const ov of this.officers.values()) ov.rig.dispose();
    for (const cv of this.cars.values()) this.disposeCar(cv);
    this.officers.clear();
    this.cars.clear();
    this.poses.clear();
    this.skids.length = 0;
    this.skid.count = 0;
  }

  dispose(): void {
    this.clear();
    this.poolGeo.dispose();
    for (const m of this.poolMats) m.dispose();
    this.skid.dispose();
    this.skidGeo.dispose();
    this.skidMat.dispose();
    this.root.removeFromParent();
  }
}

