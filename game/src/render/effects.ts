/**
 * View-level effects built on the models' pooled FxSystem:
 *   dash dust, knockdown stars, unanchor pop (dust ring + sparkles), drag dust, footstep puffs,
 *   fence debris bursts, recovery flights (loot arcs into the team van, ~0.6 s; banks lift and
 *   zip in) with coins + team-colored confetti, and world ping beacons.
 *
 * Every particle count is scaled by the quality preset. Nothing here allocates per frame
 * except the short-lived recovery flight records.
 */
import * as THREE from 'three';
import type { TeamId, Vec2 } from '../sim';
import { TEAM_STYLES } from '../shared/teams';
import { FxSystem, PAL, type DebrisBurst } from './models';
import { radialGlowTexture } from './models/textures';
import { scaledCount, type QualityPreset } from './quality';

const _v = new THREE.Vector3();

export interface FlightOptions {
  /** Objects to fly (bank root + its loaded safes, or one safe root). */
  objects: THREE.Object3D[];
  /** World start (pivot) and end points. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  team: TeamId;
  kind: 'safe' | 'bank';
  onArrive?: () => void;
}

interface Flight {
  holder: THREE.Group;
  objects: THREE.Object3D[];
  parents: (THREE.Object3D | null)[];
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  kind: 'safe' | 'bank';
  team: TeamId;
  onArrive?: () => void;
}

/** Ground ring under a raccoon: team color, brighter with a facing notch for the focus. */
export interface CharMarker {
  readonly root: THREE.Group;
  setFocus(focus: boolean): void;
}

/** Pulsing additive glow on the ground around a van while its siren runs. */
export interface SirenGlow {
  readonly root: THREE.Mesh;
  update(on: boolean, time: number): void;
}

interface Beacon {
  root: THREE.Group;
  pointer: THREE.Mesh;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  team: TeamId;
  pulse: number;
}

export function teamConfetti(team: TeamId): string[] {
  const st = TEAM_STYLES[team];
  return [st.color, st.tint, '#FFFFFF', PAL.gold, st.color, st.dark];
}

export class ViewEffects {
  readonly root = new THREE.Group();
  readonly fx: FxSystem;
  private preset: QualityPreset;
  private readonly bursts: DebrisBurst[] = [];
  private readonly flights: Flight[] = [];
  private readonly beacons: Beacon[] = [];
  private readonly owned: (THREE.Material | THREE.BufferGeometry)[] = [];
  private readonly pointerMats: Record<TeamId, THREE.MeshBasicMaterial>;
  private readonly markerGeo: { ring: THREE.BufferGeometry; focusRing: THREE.BufferGeometry; notch: THREE.BufferGeometry };
  private readonly markerMats: Record<TeamId, { dim: THREE.MeshBasicMaterial; bright: THREE.MeshBasicMaterial }>;
  private readonly glowGeo: THREE.BufferGeometry;
  private readonly glows: Partial<Record<TeamId, SirenGlow>> = {};
  private time = 0;

  constructor(preset: QualityPreset) {
    this.preset = preset;
    this.root.name = 'viewEffects';
    this.fx = new FxSystem({ dust: 320, confetti: 420, stars: 96, coins: 140, rings: 12 });
    this.root.add(this.fx.root);
    const pointerGeo = new THREE.ConeGeometry(0.32, 0.75, 4).rotateX(Math.PI);
    const ringGeo = new THREE.RingGeometry(0.62, 0.86, 40).rotateX(-Math.PI / 2);
    this.owned.push(pointerGeo, ringGeo);
    this.pointerMats = {
      0: new THREE.MeshBasicMaterial({ color: TEAM_STYLES[0].color, toneMapped: false }),
      1: new THREE.MeshBasicMaterial({ color: TEAM_STYLES[1].color, toneMapped: false }),
    };
    this.owned.push(this.pointerMats[0], this.pointerMats[1]);
    // Character ground markers (shared geometry / materials).
    const notch = new THREE.BufferGeometry();
    notch.setAttribute('position', new THREE.Float32BufferAttribute([0.86, 0, 0, 0.66, 0, -0.17, 0.66, 0, 0.17], 3));
    notch.setIndex([0, 1, 2]);
    notch.computeVertexNormals();
    this.markerGeo = {
      ring: new THREE.RingGeometry(0.5, 0.6, 36).rotateX(-Math.PI / 2),
      focusRing: new THREE.RingGeometry(0.5, 0.66, 36).rotateX(-Math.PI / 2),
      notch,
    };
    this.owned.push(this.markerGeo.ring, this.markerGeo.focusRing, notch);
    const mkMat = (team: TeamId, opacity: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({
        color: TEAM_STYLES[team].color,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      });
      this.owned.push(m);
      return m;
    };
    this.markerMats = {
      0: { dim: mkMat(0, 0.45), bright: mkMat(0, 0.95) },
      1: { dim: mkMat(1, 0.45), bright: mkMat(1, 0.95) },
    };
    this.glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.owned.push(this.glowGeo);

    for (let i = 0; i < 8; i++) {
      const root = new THREE.Group();
      root.name = `pingBeacon${i}`;
      const pointer = new THREE.Mesh(pointerGeo, this.pointerMats[0]);
      pointer.userData.noOutline = true;
      const ringMat = new THREE.MeshBasicMaterial({
        color: TEAM_STYLES[0].color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      });
      this.owned.push(ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.userData.noOutline = true;
      ring.renderOrder = 3;
      root.add(pointer, ring);
      root.visible = false;
      this.root.add(root);
      this.beacons.push({ root, pointer, ring, ringMat, team: 0, pulse: Math.random() });
    }
  }

  createCharMarker(team: TeamId): CharMarker {
    const root = new THREE.Group();
    root.name = 'charMarker';
    const mats = this.markerMats[team];
    const ring = new THREE.Mesh(this.markerGeo.ring, mats.dim);
    const notch = new THREE.Mesh(this.markerGeo.notch, mats.bright);
    for (const m of [ring, notch]) {
      m.userData.noOutline = true;
      m.renderOrder = 1;
      m.raycast = () => {};
    }
    notch.visible = false;
    root.add(ring, notch);
    let focus = false;
    return {
      root,
      setFocus: (f: boolean) => {
        if (f === focus) return;
        focus = f;
        ring.geometry = f ? this.markerGeo.focusRing : this.markerGeo.ring;
        ring.material = f ? mats.bright : mats.dim;
        notch.visible = f;
      },
    };
  }

  /** One cached glow per team (re-added to the world on every load). */
  sirenGlow(team: TeamId): SirenGlow {
    const hit = this.glows[team];
    if (hit) return hit;
    const mat = new THREE.MeshBasicMaterial({
      map: radialGlowTexture(),
      color: TEAM_STYLES[team].color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.owned.push(mat);
    const mesh = new THREE.Mesh(this.glowGeo, mat);
    mesh.name = 'sirenGlow';
    mesh.userData.noOutline = true;
    mesh.renderOrder = 2;
    mesh.visible = false;
    const teamCol = new THREE.Color(TEAM_STYLES[team].color);
    const red = new THREE.Color('#FF4D5E');
    let level = 0;
    return (this.glows[team] = {
      root: mesh,
      update: (on: boolean, time: number) => {
        level += ((on ? 1 : 0) - level) * 0.12;
        mesh.visible = level > 0.01;
        if (!mesh.visible) return;
        const phase = Math.sin(time * 9);
        mat.color.copy(phase > 0 ? teamCol : red);
        mat.opacity = level * (0.35 + 0.45 * Math.abs(phase));
        mesh.scale.setScalar(7.5 + 1.2 * Math.abs(phase));
      },
    });
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
  }

  private n(base: number, min = 1): number {
    return scaledCount(base, this.preset, min);
  }

  // ---------------------------------------------------------------------------
  // One-shot effects
  // ---------------------------------------------------------------------------

  dashPuff(p: Vec2, dir: Vec2, y = 0): void {
    this.fx.dust({ x: p.x, y, z: p.y }, { count: this.n(7), spread: 0.35, size: 0.26, dir: { x: -dir.x, y: 0, z: -dir.y } });
  }

  knockdown(p: Vec2, y = 0): void {
    this.fx.stars({ x: p.x, y: y + 0.3, z: p.y }, { count: this.n(7, 4), size: 0.17 });
    this.fx.dust({ x: p.x, y, z: p.y }, { count: this.n(6), spread: 0.4, size: 0.24 });
  }

  bump(p: Vec2, strength: number, y = 0): void {
    if (strength < 0.2) return;
    this.fx.stars({ x: p.x, y: y + 0.1, z: p.y }, { count: this.n(Math.round(2 + strength * 3), 1), size: 0.1 + 0.05 * strength });
  }

  safeUnanchor(p: Vec2, large: boolean): void {
    const c = { x: p.x, y: 0, z: p.y };
    this.fx.dust(c, { count: this.n(large ? 14 : 9), spread: large ? 0.9 : 0.6, size: large ? 0.34 : 0.28 });
    this.fx.ring(c, { radius: large ? 2.2 : 1.6, color: '#FFF3DE', duration: 0.5 });
    this.fx.sparkle({ x: p.x, y: 0.2, z: p.y }, { count: this.n(8), radius: 0.6, color: PAL.spark });
  }

  /** Bank uprooted: roots snap, big dust ring around the footprint, debris clods. */
  bankUproot(center: Vec2, angle: number, half: Vec2): void {
    const c = { x: center.x, y: 0, z: center.y };
    this.fx.ring(c, { radius: 7.5, color: '#FFF3DE', duration: 0.9 });
    this.fx.ring(c, { radius: 5.2, color: PAL.dirt, duration: 0.6 });
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const per = this.n(5, 2);
    const edge = (lx: number, ly: number): void => {
      const wx = center.x + lx * ca - ly * sa;
      const wy = center.y + lx * sa + ly * ca;
      _v.set(wx - center.x, 0, wy - center.y).normalize();
      this.fx.dust({ x: wx, y: 0, z: wy }, { count: per, spread: 0.9, size: 0.5, dir: { x: _v.x * 0.8, y: 0, z: _v.z * 0.8 }, up: 1.3 });
    };
    for (let i = 0; i <= 4; i++) {
      const t = -1 + (i / 4) * 2;
      edge(t * half.x, half.y + 0.3);
      edge(t * half.x, -half.y - 0.3);
    }
    for (let i = 0; i <= 3; i++) {
      const t = -1 + (i / 3) * 2;
      edge(half.x + 0.3, t * half.y);
      edge(-half.x - 0.3, t * half.y);
    }
    // Dirt clods + sparks from the snapped cables.
    this.fx.dust(c, { count: this.n(10), spread: 2.6, size: 0.22, color: PAL.dirt, up: 3 });
    this.fx.sparkle({ x: center.x, y: 0.3, z: center.y }, { count: this.n(16), radius: 4, color: PAL.spark });
    this.fx.stars(c, { count: this.n(6, 3), size: 0.24, color: PAL.goldLight });
  }

  fenceBreak(p: Vec2, burst: DebrisBurst): void {
    this.root.add(burst.root);
    this.bursts.push(burst);
    const c = { x: p.x, y: 0, z: p.y };
    this.fx.dust(c, { count: this.n(14), spread: 1.4, size: 0.38, up: 1.4 });
    this.fx.stars(c, { count: this.n(8, 4), size: 0.22 });
    this.fx.ring(c, { radius: 3.4, color: '#FFFFFF', duration: 0.5 });
  }

  /** Light ground dust behind dragged loot / a moving bank (rate controlled by the caller). */
  dragDust(p: Vec2, dir: Vec2 | null, size = 0.26): void {
    if (!this.preset.dragDust) return;
    this.fx.dust({ x: p.x, y: 0, z: p.y }, { count: 1, spread: 0.3, size, up: 0.4, dir: dir ? { x: dir.x * 0.3, y: 0, z: dir.y * 0.3 } : null });
  }

  footstep(p: Vec2, y = 0): void {
    if (!this.preset.footsteps) return;
    this.fx.dust({ x: p.x, y, z: p.y }, { count: 1, spread: 0.12, size: 0.11, up: 0.25 });
  }

  /** Zone completion pop at the loot (before it flies). */
  recoveryPop(p: Vec2, team: TeamId, big: boolean): void {
    const c = { x: p.x, y: 0, z: p.y };
    this.fx.ring(c, { radius: big ? 7 : 2.4, color: TEAM_STYLES[team].color, duration: 0.6 });
    this.fx.sparkle({ x: p.x, y: 0.3, z: p.y }, { count: this.n(big ? 22 : 10), radius: big ? 3.5 : 0.8, color: '#FFF1B8' });
  }

  /** Coins + confetti in team colors at the van (score feedback). */
  celebrate(at: THREE.Vector3, team: TeamId, big: boolean): void {
    this.fx.coins(at, { count: this.n(big ? 30 : 12, 4), power: big ? 1.25 : 1 });
    this.fx.confetti(at, { count: this.n(big ? 120 : 40, 10), colors: teamConfetti(team), power: big ? 1.15 : 0.85 });
  }

  /** Results-screen confetti. */
  confetti(at: THREE.Vector3, team: TeamId | null, count: number): void {
    this.fx.confetti(at, { count: this.n(count, 10), colors: team === null ? PAL.confetti : teamConfetti(team), power: 1 });
  }

  /** Expanding team-colored ring (ping placed). */
  pingRing(p: Vec2, team: TeamId, y = 0): void {
    this.fx.ring({ x: p.x, y, z: p.y }, { radius: 1.8, color: TEAM_STYLES[team].color, duration: 0.55 });
  }

  // ---------------------------------------------------------------------------
  // Recovery flights
  // ---------------------------------------------------------------------------

  fly(o: FlightOptions, parent: THREE.Object3D): void {
    const holder = new THREE.Group();
    holder.name = `flight:${o.kind}`;
    holder.position.copy(o.from);
    parent.add(holder);
    holder.updateMatrixWorld(true);
    const parents: (THREE.Object3D | null)[] = [];
    for (const obj of o.objects) {
      parents.push(obj.parent);
      holder.attach(obj);
    }
    this.flights.push({
      holder,
      objects: o.objects,
      parents,
      from: o.from.clone(),
      to: o.to.clone(),
      t: 0,
      dur: o.kind === 'bank' ? 1.15 : 0.6,
      kind: o.kind,
      team: o.team,
      onArrive: o.onArrive,
    });
  }

  get flying(): number {
    return this.flights.length;
  }

  private updateFlights(dt: number): void {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const h = f.holder;
      if (f.kind === 'safe') {
        // Hop up and arc into the van, shrinking a little.
        const e = k * k * (3 - 2 * k);
        h.position.lerpVectors(f.from, f.to, e);
        h.position.y += Math.sin(Math.PI * k) * 2.6;
        const s = 1 - 0.55 * k * k;
        h.scale.set(s, s * (1 + 0.15 * Math.sin(Math.PI * k)), s);
        h.rotation.y = k * 1.2;
      } else {
        // Bank: squash, lift with a wobble, then zip into the van while shrinking.
        const lift = 0.32;
        if (k < lift) {
          const q = k / lift;
          h.position.copy(f.from);
          h.position.y += Math.sin(q * Math.PI * 0.5) * 1.2;
          const sq = 1 - 0.12 * Math.sin(q * Math.PI);
          h.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
          h.rotation.z = Math.sin(q * Math.PI * 3) * 0.03;
        } else {
          const q = (k - lift) / (1 - lift);
          const e = q * q;
          h.position.lerpVectors(f.from, f.to, e);
          h.position.y += 1.2 * (1 - q) + Math.sin(Math.PI * q) * 3.2;
          const s = Math.max(0.03, 1 - 0.97 * q);
          h.scale.setScalar(s);
          h.rotation.z = 0;
          h.rotation.y = q * 0.6;
        }
      }
      if (k >= 1) {
        f.objects.forEach((obj, j) => {
          const p = f.parents[j];
          if (p) p.attach(obj);
          obj.visible = false;
        });
        h.removeFromParent();
        this.flights.splice(i, 1);
        this.celebrate(f.to, f.team, f.kind === 'bank');
        f.onArrive?.();
      }
    }
  }

  /** Finish all running flights immediately (unload / mode switch). */
  finishFlights(): void {
    for (const f of this.flights) {
      f.objects.forEach((obj, j) => {
        const p = f.parents[j];
        if (p) p.attach(obj);
        obj.visible = false;
      });
      f.holder.removeFromParent();
    }
    this.flights.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Ping beacons (driven every frame from state.pings)
  // ---------------------------------------------------------------------------

  /** Show beacon `i` at a world point; `height` > 0 floats it above a target. */
  setBeacon(i: number, team: TeamId, pos: THREE.Vector3, ground: boolean, life01: number): void {
    const b = this.beacons[i];
    if (!b) return;
    b.root.visible = true;
    if (b.team !== team) {
      b.team = team;
      b.pointer.material = this.pointerMats[team];
      b.ringMat.color.set(TEAM_STYLES[team].color);
    }
    b.root.position.copy(pos);
    const bob = Math.sin(this.time * 5 + i) * 0.12;
    b.pointer.position.set(0, (ground ? 1.25 : 0.55) + bob, 0);
    b.pointer.rotation.y = this.time * 2.4;
    b.ring.visible = ground;
    b.pulse = (b.pulse + 0.016) % 1;
    const ps = 0.85 + 0.25 * Math.sin(this.time * 6 + i);
    b.ring.scale.setScalar(ps);
    // Fade out over the last 15% of the ping's life.
    const fade = Math.min(1, life01 / 0.15);
    b.ringMat.opacity = 0.85 * fade;
    b.pointer.scale.setScalar(Math.max(0.01, fade));
  }

  hideBeaconsFrom(i: number): void {
    for (let k = i; k < this.beacons.length; k++) this.beacons[k].root.visible = false;
  }

  get beaconCapacity(): number {
    return this.beacons.length;
  }

  // ---------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    this.fx.update(dt);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (!this.bursts[i].update(dt)) {
        this.bursts[i].dispose();
        this.bursts.splice(i, 1);
      }
    }
    this.updateFlights(dt);
  }

  get stats(): { particles: number; bursts: number; flights: number } {
    return { particles: this.fx.activeCount, bursts: this.bursts.length, flights: this.flights.length };
  }

  /** Drop every running effect (match unload). */
  clear(): void {
    this.fx.clear();
    for (const b of this.bursts) b.dispose();
    this.bursts.length = 0;
    this.finishFlights();
    this.hideBeaconsFrom(0);
  }

  dispose(): void {
    this.clear();
    this.fx.dispose();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}
