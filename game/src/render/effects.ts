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
import { FxSystem, HIGHLIGHT_COLORS, PAL, DebrisBurst } from './models';
import { radialGlowTexture, makeCanvasTexture, FONT_STACK } from './models/textures';
import { G, PartBuilder } from './models/geometry';
import { createToonMaterial, matVC } from './models/materials';
import { scaledCount, type QualityPreset } from './quality';
import { pawCoinGeometry, piggyShardGeometry } from './models/props';

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
  private readonly bracketGeo = new Map<string, THREE.BufferGeometry>();
  private time = 0;
  /** (C7a) Paw-coin particles (fountains, climbs into the bag, deposits). */
  readonly coinSpray: CoinSpray;
  /** (C7a) World stamps (뿅! / 와르르! / 잭팟! …). */
  readonly stamps: StampPool;

  constructor(preset: QualityPreset) {
    this.preset = preset;
    this.root.name = 'viewEffects';
    this.fx = new FxSystem({ dust: 320, confetti: 420, stars: 96, coins: 140, rings: 12 });
    this.root.add(this.fx.root);
    this.coinSpray = new CoinSpray(160);
    this.root.add(this.coinSpray.mesh);
    // Few slots on purpose: at most ~4 world stamps at once (readability budget), oldest recycled.
    this.stamps = new StampPool(5);
    this.root.add(this.stamps.root);
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
  private bracketGeometry(kind: TargetKind, footprint?: Vec2): THREE.BufferGeometry {
    // (C7a) Props pass their own collider half extents (ATM / piggy / money tree / gold safe).
    const key: string = footprint ? `${kind}|${footprint.x.toFixed(2)}|${footprint.y.toFixed(2)}` : kind;
    const hit = this.bracketGeo.get(key);
    if (hit) return hit;
    const half = footprint ?? (kind === 'bank' ? { x: 4, y: 3 } : kind === 'largeSafe' ? { x: 0.7, y: 0.6 } : { x: 0.4, y: 0.4 });
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
    this.bracketGeo.set(key, g);
    this.owned.push(g);
    return g;
  }

  /**
   * Show the grab marker around a target (sim pose; `y` = floor height) with a pulsing dot at
   * the grab anchor, or hide it with `kind = null`.
   */
  setGrabTarget(
    kind: TargetKind | null,
    pose: { x: number; y: number; a: number },
    y = 0,
    anchor: Vec2 | null = null,
    anchorY = 0,
    color: THREE.ColorRepresentation = GRAB_MARKER_COLOR,
    footprint?: Vec2,
  ): void {
    const tg = this.target;
    if (!kind) {
      tg.root.visible = false;
      tg.anchor.visible = false;
      return;
    }
    tg.root.visible = true;
    const geo = this.bracketGeometry(kind, footprint);
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
    this.coinSpray.update(dt);
    this.stamps.update(dt);
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
    this.coinSpray.clear();
    this.stamps.clear();
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
    this.coinSpray.dispose();
    this.stamps.dispose();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }

  // ---------------------------------------------------------------------------
  // Content 2.0 (C7a): coins, bonks, stamps, splinters
  // ---------------------------------------------------------------------------

  /**
   * Decorative coin fountain (the real piles are drawn by render/coins.ts): `n` paw coins shoot
   * out in a ±60° fan around `dir` (radial when null) with a sparkle and a small ring.
   */
  coinFountain(pos: Vec2, dir: Vec2 | null, n: number, y = 0.4, power = 1): void {
    const count = this.n(Math.min(24, n), 1);
    const base = dir ? Math.atan2(dir.y, dir.x) : 0;
    for (let i = 0; i < count; i++) {
      const a = dir ? base + (count === 1 ? 0 : (i / (count - 1) - 0.5) * 2 * (Math.PI / 3)) + (Math.random() - 0.5) * 0.25 : (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const sp = (1.6 + Math.random() * 2.2) * power;
      _v.set(Math.cos(a) * sp, (4.5 + Math.random() * 3) * power, Math.sin(a) * sp);
      this.coinSpray.burst(pos.x, y, pos.y, _v.x, _v.y, _v.z, 0.9 + Math.random() * 0.5);
    }
    this.fx.sparkle({ x: pos.x, y: y - 0.2, z: pos.y }, { count: this.n(Math.min(14, 4 + n)), radius: 0.5, color: PAL.goldLight });
    if (n >= 4) this.fx.ring({ x: pos.x, y: 0, z: pos.y }, { radius: Math.min(2.6, 1 + n * 0.12), color: PAL.goldLight, duration: 0.45 });
  }

  /**
   * Coin climb (pickup): one coin hops from the pile into `target` (the raccoon's bag) with a
   * sparkle on arrival; `step` (0..) grows the sparkle for consecutive pickups (one scale step
   * per pile, ART §1 "동전 소리가 한 음씩 올라감").
   */
  coinClimb(from: Vec2, target: THREE.Object3D, step: number): void {
    this.coinSpray.homing(from.x, 0.2, from.y, target, 0.24, 0, step);
  }

  /** Deposit pour: `n` coins arc from `from` (the bag) to a ground point, staggered. */
  coinPour(from: THREE.Object3D, to: Vec2, n: number): void {
    const count = this.n(Math.min(18, n), 2);
    from.getWorldPosition(_v);
    for (let i = 0; i < count; i++) this.coinSpray.homingTo(_v.x, _v.y, _v.z, to.x + (Math.random() - 0.5) * 0.8, 0.05, to.y + (Math.random() - 0.5) * 0.8, 0.35, i * 0.035);
  }

  /** Hammer / bonk impact: white ring, a pop flash card, stars and a dust puff (big = golden / home run). */
  bonkImpact(pos: Vec2, dir: Vec2 | null, big: boolean, y = 0.6): void {
    const c = { x: pos.x, y, z: pos.y };
    this.fx.stars(c, { count: this.n(big ? 10 : 6, 3), size: big ? 0.22 : 0.17, color: big ? PAL.goldLight : undefined });
    this.fx.ring({ x: pos.x, y: 0, z: pos.y }, { radius: big ? 3.2 : 2, color: '#FFFFFF', duration: big ? 0.45 : 0.32 });
    this.fx.dust({ x: pos.x, y: 0, z: pos.y }, { count: this.n(big ? 10 : 5), spread: 0.4, size: 0.26, dir: dir ? { x: dir.x * 0.6, y: 0, z: dir.y * 0.6 } : null });
    this.stamps.flash(pos.x, y + 0.35, pos.y, big ? 2.4 : 1.6);
  }

  /** A stamp (sticker word) above a world point; `big` for jackpots / home runs. */
  stamp(key: StampKey, pos: Vec2, o: { y?: number; scale?: number } = {}): void {
    this.stamps.show(key, pos.x, o.y ?? 1.9, pos.y, o.scale ?? 1);
  }

  /** Breakable splinters: rigid debris from BreakableRig.breakApart + dust and wood chips. */
  splinters(pos: Vec2, pieces: readonly { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; velocity: THREE.Vector3; angular: THREE.Vector3; radius: number }[], kind: 'crate' | 'vending'): void {
    const max = this.n(pieces.length, 3);
    const burst = new DebrisBurst(
      pieces.slice(0, max).map((p) => ({ ...p, material: matVC() })),
      2.4,
    );
    this.root.add(burst.root);
    this.bursts.push(burst);
    const c = { x: pos.x, y: 0, z: pos.y };
    this.fx.dust(c, { count: this.n(kind === 'crate' ? 10 : 14), spread: 0.8, size: 0.32, up: 1.3 });
    this.fx.chunks({ x: pos.x, y: 0.3, z: pos.y }, { count: this.n(8, 2), colors: kind === 'crate' ? [PAL.wood, PAL.woodLight, PAL.woodDark] : ['#4FC3A1', '#E8FAFF', '#FFD45C'], size: 0.07, power: 1.2 });
    this.fx.stars(c, { count: this.n(5, 2), size: 0.18 });
    this.fx.ring(c, { radius: kind === 'crate' ? 1.8 : 2.4, color: '#FFFFFF', duration: 0.4 });
  }

  /** Piggy smash: pottery shards fly radially + a big gold sparkle ring. */
  piggyShatter(pos: Vec2): void {
    const n = this.n(10, 4);
    const specs = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(pos.x + Math.cos(a) * 0.4, 0.7, pos.y + Math.sin(a) * 0.4),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(a, a * 2, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      specs.push({
        geometry: piggyShardGeometry(i % 4),
        material: matVC(),
        matrix: m,
        velocity: new THREE.Vector3(Math.cos(a) * (3 + (i % 3)), 4 + (i % 2) * 2, Math.sin(a) * (3 + (i % 3))),
        angular: new THREE.Vector3(8 + i, 6 - i, 4 + i * 0.5),
        radius: 0.06,
      });
    }
    const burst = new DebrisBurst(specs, 2.2);
    this.root.add(burst.root);
    this.bursts.push(burst);
    this.fx.ring({ x: pos.x, y: 0, z: pos.y }, { radius: 4, color: PAL.goldLight, duration: 0.6 });
    this.fx.sparkle({ x: pos.x, y: 0.4, z: pos.y }, { count: this.n(22), radius: 1.6, color: PAL.goldLight });
    this.fx.confetti({ x: pos.x, y: 0.8, z: pos.y }, { count: this.n(40, 8), colors: ['#FF9EC0', '#FFD45C', '#FFFFFF', '#E8739A'], power: 0.8 });
  }

  /** Item poof (ground expiry / pickup spawn). */
  poof(pos: Vec2, y = 0.3, color: THREE.ColorRepresentation = '#FFF3DE'): void {
    this.fx.dust({ x: pos.x, y, z: pos.y }, { count: this.n(8, 3), spread: 0.45, size: 0.3, color, up: 1.2 });
    this.fx.sparkle({ x: pos.x, y, z: pos.y }, { count: this.n(6, 2), radius: 0.4 });
  }

  /** Stamps follow the reduced-motion setting (no wobble / spin, plain pop). */
  setCalm(calm: boolean): void {
    this.stamps.calm = calm;
  }

  /** Stamp language (ko / en). */
  setStampLanguage(lang: 'ko' | 'en'): void {
    this.stamps.lang = lang;
  }
}

// ---------------------------------------------------------------------------
// Content 2.0 (C7a): pooled paw-coin particles
// ---------------------------------------------------------------------------

const _cm = new THREE.Matrix4();
const _cq = new THREE.Quaternion();
const _ce = new THREE.Euler();
const _cp = new THREE.Vector3();
const _cs = new THREE.Vector3();
const _ct = new THREE.Vector3();

/**
 * Fixed-capacity instanced paw coins with two motions: ballistic (fountains; bounce on the ground
 * and fade) and homing (climb into a moving target such as the raccoon's bag, or pour to a
 * ground point). Swap-remove packing, no allocation per frame.
 */
export class CoinSpray {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private n = 0;
  private next = 0;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  private readonly rot: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly delay: Float32Array;
  private readonly mode: Uint8Array;
  private readonly scale: Float32Array;
  private readonly targets: (THREE.Object3D | null)[];
  /** Sparkle callback at homing arrival (step = climb index), set by the owner. */
  onArrive: ((x: number, y: number, z: number, step: number) => void) | null = null;
  private readonly steps: Float32Array;

  constructor(capacity: number) {
    this.cap = capacity;
    this.mesh = new THREE.InstancedMesh(pawCoinGeometry(), matVC(), capacity);
    this.mesh.name = 'coinSpray';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.userData.noOutline = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.from = new Float32Array(capacity * 3);
    this.to = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 2);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.delay = new Float32Array(capacity);
    this.mode = new Uint8Array(capacity);
    this.scale = new Float32Array(capacity);
    this.steps = new Float32Array(capacity);
    this.targets = new Array<THREE.Object3D | null>(capacity).fill(null);
  }

  get alive(): number {
    return this.n;
  }

  private slot(): number {
    if (this.n < this.cap) return this.n++;
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    return i;
  }

  burst(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.slot();
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.rot[i * 2] = Math.random() * 6.28;
    this.rot[i * 2 + 1] = 8 + Math.random() * 10;
    this.life[i] = life;
    this.max[i] = life;
    this.delay[i] = 0;
    this.mode[i] = 0;
    this.scale[i] = 0.85 + Math.random() * 0.3;
    this.targets[i] = null;
  }

  homing(x: number, y: number, z: number, target: THREE.Object3D, dur: number, delay: number, step: number): void {
    const i = this.slot();
    this.from[i * 3] = x;
    this.from[i * 3 + 1] = y;
    this.from[i * 3 + 2] = z;
    this.targets[i] = target;
    this.life[i] = dur;
    this.max[i] = dur;
    this.delay[i] = delay;
    this.mode[i] = 1;
    this.steps[i] = step;
    this.scale[i] = 1;
    this.rot[i * 2] = 0;
    this.rot[i * 2 + 1] = 14;
  }

  homingTo(x: number, y: number, z: number, tx: number, ty: number, tz: number, dur: number, delay: number): void {
    const i = this.slot();
    this.from[i * 3] = x;
    this.from[i * 3 + 1] = y;
    this.from[i * 3 + 2] = z;
    this.to[i * 3] = tx;
    this.to[i * 3 + 1] = ty;
    this.to[i * 3 + 2] = tz;
    this.targets[i] = null;
    this.life[i] = dur;
    this.max[i] = dur;
    this.delay[i] = delay;
    this.mode[i] = 2;
    this.steps[i] = -1;
    this.scale[i] = 0.9;
    this.rot[i * 2] = Math.random() * 6;
    this.rot[i * 2 + 1] = 12;
  }

  private copy(a: number, b: number): void {
    this.p.copyWithin(b * 3, a * 3, a * 3 + 3);
    this.v.copyWithin(b * 3, a * 3, a * 3 + 3);
    this.from.copyWithin(b * 3, a * 3, a * 3 + 3);
    this.to.copyWithin(b * 3, a * 3, a * 3 + 3);
    this.rot.copyWithin(b * 2, a * 2, a * 2 + 2);
    this.life[b] = this.life[a]!;
    this.max[b] = this.max[a]!;
    this.delay[b] = this.delay[a]!;
    this.mode[b] = this.mode[a]!;
    this.scale[b] = this.scale[a]!;
    this.steps[b] = this.steps[a]!;
    this.targets[b] = this.targets[a]!;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      if (this.delay[i]! > 0) {
        this.delay[i] = Math.max(0, this.delay[i]! - dt);
        _cm.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _cm);
        i++;
        continue;
      }
      this.life[i] = this.life[i]! - dt;
      const mode = this.mode[i]!;
      if (this.life[i]! <= 0) {
        if (mode !== 0 && this.onArrive) {
          const tg = this.targets[i];
          if (tg) tg.getWorldPosition(_ct);
          else _ct.set(this.to[i * 3]!, this.to[i * 3 + 1]!, this.to[i * 3 + 2]!);
          this.onArrive(_ct.x, _ct.y, _ct.z, this.steps[i]!);
        }
        this.n--;
        if (i !== this.n) this.copy(this.n, i);
        this.targets[this.n] = null;
        continue;
      }
      this.rot[i * 2] = this.rot[i * 2]! + this.rot[i * 2 + 1]! * dt;
      let s = this.scale[i]!;
      if (mode === 0) {
        const o = i * 3;
        this.v[o + 1] = this.v[o + 1]! - 15 * dt;
        this.p[o] = this.p[o]! + this.v[o]! * dt;
        this.p[o + 1] = this.p[o + 1]! + this.v[o + 1]! * dt;
        this.p[o + 2] = this.p[o + 2]! + this.v[o + 2]! * dt;
        if (this.p[o + 1]! < 0.03) {
          this.p[o + 1] = 0.03;
          if (this.v[o + 1]! < 0) this.v[o + 1] = -this.v[o + 1]! * 0.35;
          this.v[o] = this.v[o]! * 0.6;
          this.v[o + 2] = this.v[o + 2]! * 0.6;
        }
        _cp.set(this.p[o]!, this.p[o + 1]!, this.p[o + 2]!);
        const k = this.life[i]! / this.max[i]!;
        if (k < 0.25) s *= k / 0.25;
      } else {
        const k = 1 - this.life[i]! / this.max[i]!;
        const tg = this.targets[i];
        if (tg) tg.getWorldPosition(_ct);
        else _ct.set(this.to[i * 3]!, this.to[i * 3 + 1]!, this.to[i * 3 + 2]!);
        const o = i * 3;
        _cp.set(this.from[o]!, this.from[o + 1]!, this.from[o + 2]!).lerp(_ct, k);
        _cp.y += Math.sin(Math.PI * k) * (mode === 1 ? 0.9 : 0.6);
        s *= mode === 1 ? 1 - 0.45 * k * k : 1;
      }
      _ce.set(Math.PI / 2 + Math.sin(this.rot[i * 2]! * 0.5) * 0.3, this.rot[i * 2]!, 0);
      _cq.setFromEuler(_ce);
      _cs.setScalar(Math.max(0.001, s));
      _cm.compose(_cp, _cq, _cs);
      this.mesh.setMatrixAt(i, _cm);
      i++;
    }
    this.mesh.count = this.n;
    if (this.n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
    this.targets.fill(null);
  }

  dispose(): void {
    this.clear();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Content 2.0 (C7a): world stamps
// ---------------------------------------------------------------------------

/** Stamp ids (content-plan §4.5: 뿅! / 와르르! / 잭팟! / 홈런! / 털렸다! / 챙! / 쿵! / 슝!). */
export type StampKey = 'bonk' | 'spill' | 'jackpot' | 'homeRun' | 'robbed' | 'clang' | 'thud' | 'whoosh';

export const STAMP_TEXT: Readonly<Record<'ko' | 'en', Readonly<Record<StampKey, string>>>> = {
  ko: { bonk: '뿅!', spill: '와르르!', jackpot: '잭팟!', homeRun: '홈런!', robbed: '털렸다!', clang: '챙!', thud: '쿵!', whoosh: '슝!' },
  en: { bonk: 'BOINK!', spill: 'SPILL!', jackpot: 'JACKPOT!', homeRun: 'HOME RUN!', robbed: 'LOOTED!', clang: 'CLANG!', thud: 'THUD!', whoosh: 'WHOOSH!' },
};

/** Per-stamp colours: burst outer / inner, lettering gradient top / bottom, drop shade, size. */
const STAMP_STYLE: Readonly<Record<StampKey, { burst: string; burst2: string; top: string; bottom: string; drop: string; size: number; spikes: number }>> = {
  bonk: { burst: '#FF6F91', burst2: '#FFB3C8', top: '#FFFFFF', bottom: '#FFE3EC', drop: '#B5345A', size: 1.5, spikes: 12 },
  spill: { burst: '#F6C64F', burst2: '#FFE7A1', top: '#FFF6B0', bottom: '#FFB13D', drop: '#9C6A12', size: 1.7, spikes: 16 },
  jackpot: { burst: '#FF6F91', burst2: '#FFD45C', top: '#FFF6B0', bottom: '#FFC23D', drop: '#9C3A12', size: 2.5, spikes: 18 },
  homeRun: { burst: '#E8505B', burst2: '#FFD45C', top: '#FFFFFF', bottom: '#FFE7A1', drop: '#8A1F2A', size: 2.4, spikes: 14 },
  robbed: { burst: '#B9A3F0', burst2: '#FFD45C', top: '#FFF6B0', bottom: '#FFD23F', drop: '#5B3A9C', size: 2.2, spikes: 16 },
  clang: { burst: '#DCE1EA', burst2: '#FFFFFF', top: '#FFFFFF', bottom: '#FFF2A8', drop: '#5F6779', size: 1.4, spikes: 10 },
  thud: { burst: '#C08A5A', burst2: '#E2B485', top: '#FFF3DE', bottom: '#F2D6B0', drop: '#6E4A30', size: 1.5, spikes: 8 },
  whoosh: { burst: '#8FE3C8', burst2: '#DFF8EF', top: '#FFFFFF', bottom: '#DFF8EF', drop: '#2F9479', size: 1.5, spikes: 10 },
};

function drawStamp(ctx: CanvasRenderingContext2D, w: number, h: number, key: StampKey | 'flash', text: string): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2 + 4;
  const st = key === 'flash' ? null : STAMP_STYLE[key];
  const spikes = st?.spikes ?? 10;
  const burst = (r0: number, r1: number, sx: number, sy: number): void => {
    ctx.beginPath();
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? r0 : r1;
      const x = cx + Math.cos(a) * r * sx;
      const y = cy + Math.sin(a) * r * sy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  if (!st) {
    // Impact flash card: white jagged burst with a pink ink edge (no text).
    burst(54, 118, 1.0, 1.0);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#FF6F91';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    burst(28, 70, 1.0, 1.0);
    ctx.fillStyle = '#FFF2A8';
    ctx.fill();
    return;
  }
  const sx = 1.75;
  const sy = 0.8;
  burst(72, 112, sx, sy);
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#2A2131';
  ctx.stroke();
  ctx.fillStyle = st.burst;
  ctx.fill();
  burst(58, 92, sx, sy);
  ctx.fillStyle = st.burst2;
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.07);
  const size = text.length > 6 ? 62 : text.length > 4 ? 76 : 96;
  ctx.font = `bold ${size}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const maxW = w - 70;
  const m = ctx.measureText(text).width;
  if (m > maxW) ctx.scale(maxW / m, 1);
  ctx.lineWidth = 28;
  ctx.strokeStyle = '#FFFFFF';
  ctx.strokeText(text, 0, 4);
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#2A2131';
  ctx.strokeText(text, 0, 4);
  ctx.fillStyle = st.drop;
  ctx.fillText(text, 0, 10);
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, st.top);
  g.addColorStop(1, st.bottom);
  ctx.fillStyle = g;
  ctx.fillText(text, 0, 4);
  ctx.restore();
}

interface StampSlot {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  life: number;
  size: number;
  aspect: number;
  x: number;
  y: number;
  z: number;
  spin: number;
  flash: boolean;
}

/**
 * Pooled world stamps (sprites over the action, depth-test off): slam in with overshoot,
 * wobble, float up and pop away (~0.95 s; flash cards ~0.2 s). Textures are cached per key and
 * language; sprite materials are allocated once per slot.
 */
export class StampPool {
  readonly root = new THREE.Group();
  calm = false;
  lang: 'ko' | 'en' = 'ko';
  private readonly slots: StampSlot[] = [];
  private readonly textures = new Map<string, THREE.Texture>();
  private cursor = 0;

  constructor(capacity: number) {
    this.root.name = 'stamps';
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 31;
      sprite.userData.noOutline = true;
      sprite.raycast = () => {};
      this.root.add(sprite);
      this.slots.push({ sprite, mat, age: 0, life: 0, size: 1, aspect: 0.5, x: 0, y: 0, z: 0, spin: 1, flash: false });
    }
  }

  private texture(key: StampKey | 'flash'): THREE.Texture {
    const lang = this.lang;
    const id = key === 'flash' ? 'flash' : `${key}|${lang}`;
    let t = this.textures.get(id);
    if (!t) {
      const text = key === 'flash' ? '' : STAMP_TEXT[lang][key];
      t = key === 'flash' ? makeCanvasTexture(256, 256, (ctx, w, h) => drawStamp(ctx, w, h, key, text), { mipmaps: false }) : makeCanvasTexture(512, 256, (ctx, w, h) => drawStamp(ctx, w, h, key, text), { fontText: text, mipmaps: false });
      this.textures.set(id, t);
    }
    return t;
  }

  private take(): StampSlot {
    // Prefer a free slot; otherwise recycle the oldest.
    for (let k = 0; k < this.slots.length; k++) {
      const s = this.slots[(this.cursor + k) % this.slots.length]!;
      if (!s.sprite.visible) {
        this.cursor = (this.cursor + k + 1) % this.slots.length;
        return s;
      }
    }
    let oldest = this.slots[0]!;
    for (const s of this.slots) if (s.age / s.life > oldest.age / oldest.life) oldest = s;
    return oldest;
  }

  show(key: StampKey, x: number, y: number, z: number, scale = 1): void {
    const s = this.take();
    s.mat.map = this.texture(key);
    s.mat.needsUpdate = true;
    s.sprite.visible = true;
    s.age = 0;
    s.life = 0.95;
    // World size at the default match camera (~1.4x the sticker's design size).
    s.size = STAMP_STYLE[key].size * 1.4 * scale;
    s.aspect = 0.5;
    s.x = x;
    s.y = y;
    s.z = z;
    s.spin = Math.random() < 0.5 ? -1 : 1;
    s.flash = false;
  }

  /** Short impact flash card (no text). */
  flash(x: number, y: number, z: number, size: number): void {
    const s = this.take();
    s.mat.map = this.texture('flash');
    s.mat.needsUpdate = true;
    s.sprite.visible = true;
    s.age = 0;
    s.life = 0.2;
    s.size = size;
    s.aspect = 1;
    s.x = x;
    s.y = y;
    s.z = z;
    s.spin = Math.random() * 6;
    s.flash = true;
  }

  get count(): number {
    let n = 0;
    for (const s of this.slots) if (s.sprite.visible) n++;
    return n;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.sprite.visible) continue;
      s.age += dt;
      const t = s.age;
      if (t >= s.life) {
        s.sprite.visible = false;
        continue;
      }
      if (s.flash) {
        const k = t / s.life;
        const sc = s.size * (0.6 + 0.6 * k);
        s.sprite.scale.set(sc, sc, 1);
        s.mat.opacity = 1 - k * k;
        s.mat.rotation = s.spin;
        s.sprite.position.set(s.x, s.y, s.z);
        continue;
      }
      let sc: number;
      if (t < 0.12) sc = 0.25 + 1.1 * (1 - Math.pow(1 - t / 0.12, 3));
      else if (t < 0.24) sc = 1.35 - 0.35 * ((t - 0.12) / 0.12);
      else sc = 1 + (this.calm ? 0 : 0.035 * Math.sin(t * 13));
      let alpha = 1;
      let rise = t > 0.24 ? (t - 0.24) * 0.55 : 0;
      if (t > s.life - 0.2) {
        const k = (s.life - t) / 0.2;
        sc *= 0.7 + 0.3 * k + (1 - k) * 0.25;
        alpha = k;
        rise += (1 - k) * 0.4;
      }
      s.mat.opacity = alpha;
      s.mat.rotation = this.calm ? 0 : s.spin * (t < 0.24 ? 0.2 * (1 - t / 0.24) : 0.03 * Math.sin(t * 7));
      s.sprite.scale.set(s.size * sc, s.size * s.aspect * sc, 1);
      s.sprite.position.set(s.x, s.y + rise, s.z);
    }
  }

  clear(): void {
    for (const s of this.slots) s.sprite.visible = false;
  }

  dispose(): void {
    this.clear();
    for (const s of this.slots) s.mat.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Content 2.0 (C7a): hazard decals (soap slick, sneeze smoke)
// ---------------------------------------------------------------------------

let slickTex: THREE.Texture | null = null;
function slickTexture(): THREE.Texture {
  if (slickTex) return slickTex;
  slickTex = makeCanvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      // Lumpy soapy puddle: lilac-white blob with a bright rim.
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const r = 108 + Math.sin(a * 5) * 7 + Math.sin(a * 3 + 1) * 6;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(cx - 20, cy - 20, 10, cx, cy, 120);
      g.addColorStop(0, 'rgba(255,255,255,0.92)');
      g.addColorStop(0.7, 'rgba(226,214,255,0.85)');
      g.addColorStop(1, 'rgba(196,178,250,0.8)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
      // Bubble rings + shine streaks.
      const bubbles: [number, number, number][] = [
        [-50, -30, 18],
        [40, -50, 12],
        [55, 30, 20],
        [-30, 55, 14],
        [10, 5, 9],
        [-70, 20, 8],
        [75, -10, 7],
      ];
      for (const [x, y, r] of bubbles) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(140,120,220,0.7)';
        ctx.beginPath();
        ctx.arc(cx + x, cy + y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(cx + x - r * 0.35, cy + y - r * 0.35, r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { mipmaps: true },
  );
  return slickTex;
}

/** A soap slick on the ground: shimmering puddle decal plus a few wobbling bubbles. */
export class SlickDecal {
  readonly root = new THREE.Group();
  private readonly decal: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly bubbles: THREE.Mesh[] = [];
  private static bubbleGeo: THREE.BufferGeometry | null = null;
  private static bubbleMat: THREE.MeshBasicMaterial | null = null;

  constructor() {
    this.root.name = 'slick';
    this.mat = new THREE.MeshBasicMaterial({ map: slickTexture(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.decal = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.mat);
    this.decal.position.y = 0.02;
    this.decal.renderOrder = 2;
    this.decal.userData.noOutline = true;
    this.root.add(this.decal);
    if (!SlickDecal.bubbleGeo) SlickDecal.bubbleGeo = new THREE.SphereGeometry(1, 12, 8);
    if (!SlickDecal.bubbleMat) SlickDecal.bubbleMat = new THREE.MeshBasicMaterial({ color: '#F4EEFF', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(SlickDecal.bubbleGeo, SlickDecal.bubbleMat);
      b.userData.noOutline = true;
      this.root.add(b);
      this.bubbles.push(b);
    }
  }

  /** Pose: center, radius, 0..1 opacity (fade in / out), clock (s). */
  set(x: number, z: number, radius: number, alpha: number, time: number): void {
    this.root.position.set(x, 0, z);
    this.decal.scale.set(radius, 1, radius);
    this.decal.rotation.y = Math.sin(time * 0.6) * 0.05;
    this.mat.opacity = alpha;
    this.bubbles.forEach((b, i) => {
      const a = i * 1.26 + time * 0.3;
      const r = radius * (0.25 + 0.15 * i);
      const s = (0.07 + 0.03 * (i % 3)) * (0.8 + 0.2 * Math.sin(time * 3 + i)) * alpha;
      b.position.set(Math.cos(a) * r, 0.05 + s, Math.sin(a) * r);
      b.scale.setScalar(Math.max(0.001, s));
    });
  }

  dispose(): void {
    this.decal.geometry.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}

/** A sneeze-smoke cloud: a cluster of soft pastel puffs that churn slowly (wave 3 item). */
export class SmokeCloud {
  readonly root = new THREE.Group();
  private readonly puffs: THREE.Mesh[] = [];
  private readonly mat: THREE.MeshToonMaterial;

  constructor() {
    this.root.name = 'smoke';
    this.mat = createToonMaterial({ color: '#E9E2F0', transparent: true, opacity: 0.8, rim: 0.5, depthWrite: false });
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(G.ico(1), this.mat);
      m.userData.noOutline = true;
      m.castShadow = false;
      this.root.add(m);
      this.puffs.push(m);
    }
  }

  set(x: number, z: number, radius: number, alpha: number, time: number): void {
    this.root.position.set(x, 0, z);
    this.mat.opacity = 0.8 * alpha;
    this.puffs.forEach((m, i) => {
      const a = (i / this.puffs.length) * Math.PI * 2 + time * 0.25;
      const r = i === 0 ? 0 : radius * (0.45 + 0.2 * Math.sin(i * 2.1));
      const s = radius * (0.38 + 0.08 * Math.sin(time * 1.3 + i)) * (0.4 + 0.6 * alpha);
      m.position.set(Math.cos(a) * r, s * 0.7 + 0.1, Math.sin(a) * r);
      m.scale.set(s, s * 0.8, s);
    });
  }

  dispose(): void {
    this.mat.dispose();
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
