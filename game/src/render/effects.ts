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
import { FxSystem, HIGHLIGHT_COLORS, PAL, type DebrisBurst } from './models';
import { radialGlowTexture } from './models/textures';
import { G, PartBuilder } from './models/geometry';
import { createToonMaterial } from './models/materials';
import { scaledCount, type QualityPreset } from './quality';

const _v = new THREE.Vector3();

/**
 * Grab-candidate colour (view override of HIGHLIGHT_COLORS.grab '#FFF4B8', which vanishes on
 * the cream bank facade and pink paving at the game camera). Saturated warm gold: distinct from
 * both team colours, the zone green and the loaded-safe yellow is lighter (#FFD45C).
 */
export const GRAB_MARKER_COLOR = '#FFB81C';

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
  readonly root: THREE.Group;
  place(vanPos: Vec2, vanAngle: number): void;
  /** `dt` drives the fade in/out (frame-rate independent; dt = 0 freezes it). */
  update(on: boolean, time: number, dt: number): void;
}

/** Grab-candidate footprint kinds (corner brackets sized to the target). */
export type TargetKind = 'smallSafe' | 'largeSafe' | 'bank';

interface Meter {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
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
  private readonly meters: Meter[] = [];
  private readonly meterGeo: THREE.BufferGeometry;
  private readonly target: { root: THREE.Group; brackets: THREE.Mesh; anchor: THREE.Mesh; mat: THREE.MeshBasicMaterial; anchorMat: THREE.MeshBasicMaterial };
  private readonly bracketGeo = new Map<TargetKind, THREE.BufferGeometry>();
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

    // Recovery meters: ground rings around loot dwelling in a zone (doc §8 1.5 s dwell).
    this.meterGeo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    this.owned.push(this.meterGeo);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uProgress: { value: 0 },
          uInner: { value: 0.8 },
          uFill: { value: new THREE.Color(HIGHLIGHT_COLORS.inZone) },
          uTime: { value: 0 },
          uAlpha: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -7,
        polygonOffsetUnits: -7,
        vertexShader: /* glsl */ `
          varying vec2 vPos;
          void main() {
            vPos = position.xz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uProgress;
          uniform float uInner;
          uniform vec3 uFill;
          uniform float uTime;
          uniform float uAlpha;
          varying vec2 vPos;
          void main() {
            float r = length(vPos);
            float aa = fwidth(r) * 1.5;
            float band = smoothstep(uInner - aa, uInner, r) * (1.0 - smoothstep(1.0 - aa, 1.0, r));
            if (band < 0.01) discard;
            // 0 at screen-up (north, -z), clockwise seen from above.
            float f = fract(atan(vPos.x, -vPos.y) / 6.2831853 + 1.0);
            float filled = step(f, uProgress) * step(0.001, uProgress);
            float head = filled * smoothstep(uProgress - 0.06, uProgress, f);
            // Thin white rims so the ring reads on any paving.
            float w = 1.0 - uInner;
            float rim = 1.0 - smoothstep(0.0, 0.18, min(r - uInner, 1.0 - r) / w);
            vec3 track = vec3(0.16, 0.13, 0.24);
            vec3 c = mix(track, mix(uFill, vec3(1.0), 0.55 * head), filled);
            c = mix(c, vec3(1.0), rim * 0.85);
            float a = mix(0.6, 1.0, max(filled, rim)) * band * uAlpha;
            gl_FragColor = vec4(c, a);
            #include <colorspace_fragment>
          }
        `,
      });
      this.owned.push(mat);
      const mesh = new THREE.Mesh(this.meterGeo, mat);
      mesh.name = `recoveryMeter${i}`;
      mesh.userData.noOutline = true;
      mesh.renderOrder = 5;
      mesh.visible = false;
      mesh.raycast = () => {};
      this.root.add(mesh);
      this.meters.push({ mesh, mat });
    }

    // Grab-candidate marker: corner brackets around the whole target + a dot where the hands go.
    {
      const root = new THREE.Group();
      root.name = 'grabTarget';
      root.visible = false;
      const mat = new THREE.MeshBasicMaterial({
        color: GRAB_MARKER_COLOR,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      });
      const anchorMat = mat.clone();
      this.owned.push(mat, anchorMat);
      const brackets = new THREE.Mesh(this.bracketGeometry('smallSafe'), mat);
      brackets.renderOrder = 4;
      const anchorGeo = new THREE.RingGeometry(0.13, 0.24, 28).rotateX(-Math.PI / 2);
      this.owned.push(anchorGeo);
      const anchor = new THREE.Mesh(anchorGeo, anchorMat);
      anchor.renderOrder = 4;
      for (const m of [brackets, anchor]) {
        m.userData.noOutline = true;
        m.raycast = () => {};
      }
      root.add(brackets);
      this.root.add(root, anchor);
      anchor.visible = false;
      this.target = { root, brackets, anchor, mat, anchorMat };
    }

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

  /** One cached siren glow per team (re-added to the world on every load). */
  sirenGlow(team: TeamId): SirenGlow {
    const hit = this.glows[team];
    if (hit) return hit;
    const tex = radialGlowTexture();
    // Ground pool (normal blending so it reads on the bright paving).
    const poolMat = new THREE.MeshBasicMaterial({
      map: tex,
      color: TEAM_STYLES[team].color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    // Flashing flare at the roof beacon.
    const flareMat = new THREE.SpriteMaterial({ map: tex, color: TEAM_STYLES[team].color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.owned.push(poolMat, flareMat);
    const root = new THREE.Group();
    root.name = 'sirenGlow';
    const pool = new THREE.Mesh(this.glowGeo, poolMat);
    pool.userData.noOutline = true;
    pool.renderOrder = 2;
    pool.position.y = 0.03;
    const flare = new THREE.Sprite(flareMat);
    flare.renderOrder = 4;
    root.add(pool, flare);
    root.visible = false;
    const teamCol = new THREE.Color(TEAM_STYLES[team].color);
    const red = new THREE.Color('#FF4D5E');
    let level = 0;
    return (this.glows[team] = {
      root,
      place: (vanPos: Vec2, vanAngle: number) => {
        root.position.set(vanPos.x, 0, vanPos.y);
        // Beacon sits 1.2 m toward the van's nose on the roof.
        flare.position.set(Math.cos(vanAngle) * 1.2, 2.45, Math.sin(vanAngle) * 1.2);
      },
      update: (on: boolean, time: number, dt: number) => {
        level += ((on ? 1 : 0) - level) * (1 - Math.exp(-7.5 * Math.max(0, dt)));
        root.visible = level > 0.01;
        if (!root.visible) return;
        const phase = Math.sin(time * 9);
        const col = phase > 0 ? teamCol : red;
        poolMat.color.copy(col);
        flareMat.color.copy(col);
        const k = Math.abs(phase);
        poolMat.opacity = level * (0.45 + 0.45 * k);
        pool.scale.set(12 + 2 * k, 1, 12 + 2 * k);
        flareMat.opacity = level * (0.75 + 0.25 * k);
        flare.scale.setScalar(3.6 + 2.6 * k);
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
  // Recovery meters (ground ring around loot dwelling in a zone)
  // ---------------------------------------------------------------------------

  /**
   * Show meter `i`: a ground ring of `radius` m around `pos` (world; y = floor height) filling
   * clockwise from screen-up with `progress` 0..1. Width scales gently with the radius.
   */
  setRecoveryMeter(i: number, pos: THREE.Vector3, radius: number, progress: number): void {
    const m = this.meters[i];
    if (!m) return;
    m.mesh.visible = true;
    m.mesh.position.set(pos.x, pos.y + 0.035, pos.z);
    // Pop in, then a gentle breathing so the ring reads as "running".
    const breathe = 1 + 0.025 * Math.sin(this.time * 7);
    m.mesh.scale.setScalar(radius * breathe);
    const width = Math.min(0.62, 0.26 + radius * 0.07);
    m.mat.uniforms.uInner.value = 1 - width / radius;
    m.mat.uniforms.uProgress.value = THREE.MathUtils.clamp(progress, 0, 1);
    m.mat.uniforms.uAlpha.value = 1;
  }

  hideRecoveryMetersFrom(i: number): void {
    for (let k = i; k < this.meters.length; k++) this.meters[k].mesh.visible = false;
  }

  get meterCapacity(): number {
    return this.meters.length;
  }

  // ---------------------------------------------------------------------------
  // Grab-candidate marker (doc §4: 잡기 전 대상 전체에 윤곽 — plus a ground bracket that reads
  // at the game camera on every paving / facade colour)
  // ---------------------------------------------------------------------------

  /** Corner-bracket frame around a target footprint (cached per kind). */
  private bracketGeometry(kind: TargetKind): THREE.BufferGeometry {
    const hit = this.bracketGeo.get(kind);
    if (hit) return hit;
    const half = kind === 'bank' ? { x: 4, y: 3 } : kind === 'largeSafe' ? { x: 0.7, y: 0.6 } : { x: 0.4, y: 0.4 };
    const margin = kind === 'bank' ? 0.55 : 0.28;
    const t = kind === 'bank' ? 0.26 : 0.1;
    const hx = half.x + margin;
    const hy = half.y + margin;
    const arm = kind === 'bank' ? 1.7 : Math.min(hx, hy) * 0.75;
    const pos: number[] = [];
    const quad = (x0: number, z0: number, x1: number, z1: number): void => {
      pos.push(x0, 0, z0, x1, 0, z1, x1, 0, z0, x0, 0, z0, x0, 0, z1, x1, 0, z1);
    };
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = sx * hx;
        const cz = sz * hy;
        // Horizontal arm and vertical arm of the L (outer edge on the frame line).
        quad(Math.min(cx, cx - sx * arm), Math.min(cz, cz - sz * t), Math.max(cx, cx - sx * arm), Math.max(cz, cz - sz * t));
        quad(Math.min(cx, cx - sx * t), Math.min(cz - sz * t, cz - sz * arm), Math.max(cx, cx - sx * t), Math.max(cz - sz * t, cz - sz * arm));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    this.bracketGeo.set(kind, g);
    this.owned.push(g);
    return g;
  }

  /**
   * Show the grab marker around a target (sim pose; `y` = floor height) with a pulsing dot at
   * the grab anchor, or hide it with `kind = null`.
   */
  setGrabTarget(kind: TargetKind | null, pose: { x: number; y: number; a: number }, y = 0, anchor: Vec2 | null = null, anchorY = 0, color: THREE.ColorRepresentation = GRAB_MARKER_COLOR): void {
    const tg = this.target;
    if (!kind) {
      tg.root.visible = false;
      tg.anchor.visible = false;
      return;
    }
    tg.root.visible = true;
    const geo = this.bracketGeometry(kind);
    if (tg.brackets.geometry !== geo) tg.brackets.geometry = geo;
    tg.root.position.set(pose.x, y + 0.03, pose.y);
    tg.root.rotation.set(0, -pose.a, 0);
    // Brackets breathe in toward the target (reads as "this one").
    const k = 0.5 + 0.5 * Math.sin(this.time * 7.5);
    const s = 1 + (kind === 'bank' ? 0.025 : 0.06) * k;
    tg.root.scale.set(s, 1, s);
    tg.mat.color.set(color);
    tg.mat.opacity = 0.75 + 0.25 * k;
    if (anchor) {
      tg.anchor.visible = true;
      tg.anchor.position.set(anchor.x, anchorY + 0.04, anchor.y);
      tg.anchor.scale.setScalar(0.9 + 0.35 * k);
      tg.anchorMat.color.set(color);
      tg.anchorMat.opacity = 0.6 + 0.4 * (1 - k);
    } else tg.anchor.visible = false;
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
    this.hideRecoveryMetersFrom(0);
    this.setGrabTarget(null, { x: 0, y: 0, a: 0 });
  }

  dispose(): void {
    this.clear();
    this.fx.dispose();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Pigeons (docs/ART_DIRECTION.md §1 "모든 것이 반응": pigeons take off when something rushes by)
// ---------------------------------------------------------------------------

export interface PigeonThreat {
  x: number;
  y: number;
  radius: number;
}

interface Pigeon {
  home: Vec2;
  x: number;
  y: number;
  h: number;
  vx: number;
  vy: number;
  vh: number;
  yaw: number;
  state: 'idle' | 'fly' | 'gone' | 'land';
  t: number;
  peckT: number;
  peck: number;
  hopT: number;
  flap: number;
  respawn: number;
  landFrom: { x: number; y: number; h: number };
  scale: number;
}

const PIGEON_SCALE = 1.45;
const _pm = new THREE.Matrix4();
const _pw = new THREE.Matrix4();
const _pq = new THREE.Quaternion();
const _pe = new THREE.Euler();
const _pp = new THREE.Vector3();
const _ps = new THREE.Vector3();

/** Small flocks of toy pigeons: two instanced draw calls (bodies, wings) for the whole plaza. */
export class PigeonFlock {
  readonly root = new THREE.Group();
  private readonly bodies: THREE.InstancedMesh;
  private readonly wings: THREE.InstancedMesh;
  private readonly owned: (THREE.Material | THREE.BufferGeometry)[] = [];
  private birds: Pigeon[] = [];
  private seed = 1;
  private readonly cap: number;

  constructor(capacity = 24) {
    this.cap = capacity;
    this.root.name = 'pigeons';
    const bb = new PartBuilder();
    const grey = '#A7AEC2';
    bb.add(G.sphere(12, 8), { color: grey, pos: [0, 0.11, 0], scale: [0.13, 0.085, 0.075] });
    bb.add(G.sphere(10, 6), { color: '#E8EAF2', pos: [0.03, 0.085, 0], scale: [0.08, 0.05, 0.055] });
    bb.add(G.torus(0.35, 6, 12), { color: '#7FC4B0', pos: [0.085, 0.165, 0], rot: [0, Math.PI / 2, 0.5], scale: [0.045, 0.045, 0.04] });
    bb.add(G.sphere(10, 8), { color: '#8C93A8', pos: [0.115, 0.2, 0], scale: 0.05 });
    bb.add(G.cone(8), { color: '#F2B8C6', pos: [0.17, 0.197, 0], rot: [0, 0, -Math.PI / 2], scale: [0.016, 0.04, 0.016] });
    for (const s of [-1, 1]) bb.add(G.sphere(6, 4), { color: '#25222B', pos: [0.142, 0.212, s * 0.03], scale: 0.011 });
    bb.add(G.box(), { color: '#6F7690', pos: [-0.14, 0.13, 0], rot: [0, 0, 0.35], scale: [0.11, 0.018, 0.08] });
    for (const s of [-1, 1]) bb.add(G.cyl(1, 1, 5), { color: '#F28C9A', pos: [0.01, 0.03, s * 0.025], scale: [0.007, 0.06, 0.007] });
    const bodyGeo = bb.merge('vc')!;
    bb.clear();
    const wb = new PartBuilder();
    // Wing pivots at the shoulder and extends toward +z (mirrored for the right wing).
    wb.add(G.sphere(10, 6), { color: '#949CB2', pos: [-0.02, 0, 0.075], scale: [0.09, 0.012, 0.075] });
    wb.add(G.box(), { color: '#5E6579', pos: [-0.06, -0.002, 0.11], rot: [0, 0.3, 0], scale: [0.07, 0.01, 0.04] });
    const wingGeo = wb.merge('vc')!;
    wb.clear();
    const bodyMat = createToonMaterial({ vertexColors: true, fx: true, rim: 0.6 });
    const wingMat = createToonMaterial({ vertexColors: true, fx: true, rim: 0.6, side: THREE.DoubleSide });
    this.owned.push(bodyGeo, wingGeo, bodyMat, wingMat);
    this.bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, capacity);
    this.wings = new THREE.InstancedMesh(wingGeo, wingMat, capacity * 2);
    for (const m of [this.bodies, this.wings]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.userData.noOutline = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(m);
    }
  }

  /** Place flocks at the given ground spots (deterministic per layout). */
  reset(spots: Vec2[], seed: number, density = 1): void {
    this.seed = seed || 1;
    this.birds = [];
    const per = density >= 0.9 ? 3 : 2;
    for (const s of spots) {
      for (let i = 0; i < per && this.birds.length < this.cap; i++) {
        const a = this.rand() * Math.PI * 2;
        const r = 0.25 + this.rand() * 0.55;
        const home = { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r };
        this.birds.push({
          home,
          x: home.x,
          y: home.y,
          h: 0,
          vx: 0,
          vy: 0,
          vh: 0,
          yaw: this.rand() * Math.PI * 2,
          state: 'idle',
          t: 0,
          peckT: this.rand() * 2,
          peck: 0,
          hopT: 1 + this.rand() * 4,
          flap: this.rand() * 6,
          respawn: 0,
          landFrom: { x: 0, y: 0, h: 0 },
          scale: 1,
        });
      }
    }
  }

  private rand(): number {
    // xorshift
    let x = this.seed | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x;
    return ((x >>> 0) % 100000) / 100000;
  }

  /** Startle every idle pigeon within `radius` of p (events: uproot, fence break, knockdown). */
  scare(p: Vec2, radius: number): void {
    for (const b of this.birds) if (b.state === 'idle' || b.state === 'land') this.takeOff(b, p, Math.hypot(b.x - p.x, b.y - p.y) <= radius);
  }

  private takeOff(b: Pigeon, from: Vec2, inRange: boolean): void {
    if (!inRange) return;
    let dx = b.x - from.x;
    let dy = b.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const sp = 2.6 + this.rand() * 1.6;
    b.vx = dx * sp + (this.rand() - 0.5) * 1.2;
    b.vy = dy * sp + (this.rand() - 0.5) * 1.2;
    b.vh = 2.6 + this.rand() * 1.4;
    b.state = 'fly';
    b.t = 0;
    b.yaw = Math.atan2(b.vy, b.vx);
  }

  update(dt: number, threats: readonly PigeonThreat[]): void {
    let n = 0;
    for (const b of this.birds) {
      b.t += dt;
      if (b.state === 'idle') {
        for (const th of threats) {
          if (Math.hypot(b.x - th.x, b.y - th.y) < th.radius) {
            this.takeOff(b, th, true);
            break;
          }
        }
      }
      if (b.state === 'idle') {
        b.peckT -= dt;
        if (b.peckT <= 0) {
          b.peck = 0.35;
          b.peckT = 0.6 + this.rand() * 2.4;
        }
        b.peck = Math.max(0, b.peck - dt);
        b.hopT -= dt;
        if (b.hopT <= 0) {
          // little hop-step around home
          b.hopT = 1.5 + this.rand() * 4;
          const a = this.rand() * Math.PI * 2;
          const tx = b.home.x + Math.cos(a) * 0.5;
          const ty = b.home.y + Math.sin(a) * 0.5;
          b.yaw = Math.atan2(ty - b.y, tx - b.x);
          b.vx = (tx - b.x) * 2.5;
          b.vy = (ty - b.y) * 2.5;
          b.vh = 1.0;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.h = Math.max(0, b.h + b.vh * dt);
        b.vh -= 9 * dt;
        if (b.h <= 0) {
          b.h = 0;
          b.vh = 0;
          b.vx *= Math.exp(-dt * 10);
          b.vy *= Math.exp(-dt * 10);
        }
      } else if (b.state === 'fly') {
        b.vh += 2.2 * dt;
        b.vx *= 1 + dt * 0.4;
        b.vy *= 1 + dt * 0.4;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.h += b.vh * dt;
        b.flap += dt * 26;
        if (b.t > 2.6) {
          b.state = 'gone';
          b.respawn = 9 + this.rand() * 9;
        }
      } else if (b.state === 'gone') {
        b.respawn -= dt;
        if (b.respawn <= 0) {
          let clear = true;
          for (const th of threats) if (Math.hypot(b.home.x - th.x, b.home.y - th.y) < th.radius + 4) clear = false;
          if (clear) {
            b.state = 'land';
            b.t = 0;
            const a = this.rand() * Math.PI * 2;
            b.landFrom = { x: b.home.x + Math.cos(a) * 7, y: b.home.y + Math.sin(a) * 7, h: 6 };
            b.yaw = Math.atan2(b.home.y - b.landFrom.y, b.home.x - b.landFrom.x);
          } else b.respawn = 2;
        }
      } else if (b.state === 'land') {
        const k = Math.min(1, b.t / 1.8);
        const e = 1 - (1 - k) * (1 - k);
        b.x = b.landFrom.x + (b.home.x - b.landFrom.x) * e;
        b.y = b.landFrom.y + (b.home.y - b.landFrom.y) * e;
        b.h = b.landFrom.h * (1 - e);
        b.flap += dt * (k < 0.8 ? 18 : 30);
        if (k >= 1) {
          b.state = 'idle';
          b.h = 0;
          b.vx = b.vy = b.vh = 0;
          b.peckT = 0.5;
        }
      }
      if (b.state === 'gone') continue;
      // Body
      const flying = b.state !== 'idle' || b.h > 0.02;
      const pitch = b.state === 'fly' ? 0.35 : b.state === 'land' ? -0.15 : -Math.sin(Math.min(1, b.peck / 0.35) * Math.PI) * 0.55;
      _pe.set(0, -b.yaw, pitch, 'YXZ');
      _pq.setFromEuler(_pe);
      _pp.set(b.x, b.h, b.y);
      _ps.setScalar(PIGEON_SCALE * b.scale);
      _pm.compose(_pp, _pq, _ps);
      this.bodies.setMatrixAt(n, _pm);
      // Wings: folded when idle, flapping in flight.
      const flapA = flying ? 0.2 + Math.sin(b.flap) * 1.0 : 0;
      const fold = flying ? 0 : 1;
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? 1 : -1;
        // Folded: the wing swings back along the body; flying: it flaps about the body axis.
        _pe.set(side * (flapA - 0.18 * fold), -side * 1.42 * fold, 0, 'YXZ');
        _pq.setFromEuler(_pe);
        _pp.set(0.01, 0.15, side * 0.045);
        _ps.set(1, 1, side);
        _pw.compose(_pp, _pq, _ps);
        _pw.premultiply(_pm);
        this.wings.setMatrixAt(n * 2 + s, _pw);
      }
      n++;
    }
    this.bodies.count = n;
    this.wings.count = n * 2;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;
  }

  get count(): number {
    return this.birds.length;
  }

  dispose(): void {
    this.bodies.dispose();
    this.wings.dispose();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}
