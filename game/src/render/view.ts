/**
 * GameView: the in-game 3D view (docs/ARCHITECTURE.md "Render API").
 *
 * Owns the WebGL renderer, scene, dusk lighting, camera rig and effects, builds a scene for a
 * Simulation's layout from the procedural model factories (src/render/models) and keeps it in
 * sync with the sim:
 *   - captureTick() after every sim.step() stores prev/curr poses; render() blends them with
 *     alpha (shortest-arc angles, snap on teleports > 2 m/tick).
 *   - onEvents() turns sim events into rig state changes and FX (uproot, fence break, recovery
 *     flights, knockdowns, pings, camera shake).
 *   - render() poses every rig, applies highlights (doc §4 grab outline, ping pulse, carried,
 *     zone-green, loaded safes), occlusion (roof/wall fades + scenery x-ray), zones, vans,
 *     camera and draws.
 *
 * Extensions beyond the documented contract (all optional):
 *   ViewSettings.language / signResolver / zoneLabel, render(..., focus: ViewFocus | null),
 *   project() also returns `behind`, telegraph(), stats(), canvas getter, mode getter,
 *   dispose({ keepModelCaches }).
 */
import * as THREE from 'three';
import type {
  CharacterState,
  EntityId,
  GrabCandidate,
  LayoutDef,
  LootState,
  SimEvent,
  Simulation,
  TeamId,
  Vec2,
} from '../sim';
import { BANK_MODEL, PING, SAFE_SPECS } from '../sim';
import { LAYOUT_STRINGS } from '../sim/layouts/strings';
import { TEAM_STYLES } from '../shared/teams';
import {
  BANK_FLOOR_Y,
  HIGHLIGHT_COLORS,
  buildStaticScenery,
  createBank,
  createBankScar,
  createDuskLighting,
  createFence,
  createRaccoon,
  createSafe,
  createVan,
  createZoneMarker,
  disposeModelCaches,
  placeOnSim,
  preloadModelFonts,
  setModelTime,
  setOcclusionFocus,
  type BankRig,
  type DuskLighting,
  type FenceRig,
  type RaccoonPose,
  type RaccoonRig,
  type SafeRig,
  type SignResolver,
  type StaticScenery,
  type VanRig,
  type ZoneMarkerRig,
} from './models';
import { GameCamera, MATCH_DIST, MATCH_FOV, MATCH_PITCH, fitDistance, type CameraGoal, type ViewMode } from './camera';
import { ViewEffects, type CharMarker, type SirenGlow } from './effects';
import { qualityPreset, type QualityLevel, type QualityPreset } from './quality';
import { PoseBuffer, damp, insideRect, lerpAngle, onBankSlab, pointVelocity, toLocal, wrapAngle, type Pose2 } from './sync';

export type { ViewMode } from './camera';

export interface ViewSettings {
  quality: QualityLevel;
  /** 0..1 camera shake strength (0 = off). */
  screenShake: number;
  /** Disables shake, camera drift/pans and other non-essential motion. */
  reducedMotion: boolean;
  /** (extension) Language for shop signs and zone labels (default 'ko'). */
  language?: 'ko' | 'en';
  /** (extension) Custom shop-sign resolver (key -> text); overrides `language`. */
  signResolver?: SignResolver | null;
  /** (extension) Painted zone label override (default by language). */
  zoneLabel?: string | null;
  /**
   * (extension) Tone mapping. 'neutral' (default) keeps the pastel palette saturated — the
   * models are tuned for it; 'aces' is the filmic alternative (desaturates bright pastels).
   */
  toneMapping?: 'neutral' | 'aces';
}

export interface ViewFocus {
  charId: EntityId;
  grabCandidate: GrabCandidate | null;
  pingTargetIds: EntityId[];
}

/** (extension) Short "준비 동작" a bot can show before acting (doc §11 personality tells). */
export type TelegraphKind = 'dash' | 'grab' | 'sly' | 'cheer';

export interface ViewStats {
  quality: QualityLevel;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  particles: number;
  pixelRatio: number;
  width: number;
  height: number;
}

const ZONE_LABELS = { ko: '회수 구역', en: 'RECOVERY ZONE' } as const;
const CHEST_Y = 0.6;
const WALL_FADE = 0.2;
const ROOF_FADE_BEHIND = 0.1;

// ---------------------------------------------------------------------------
// Per-entity view records
// ---------------------------------------------------------------------------

interface CharView {
  id: EntityId;
  rig: RaccoonRig;
  team: TeamId;
  pose: Pose2;
  y: number;
  facing: number;
  stepAcc: number;
  stepSide: number;
  lastX: number;
  lastY: number;
  cheerUntil: number;
  happyUntil: number;
  telegraph: { kind: TelegraphKind; until: number; start: number } | null;
  poseObj: RaccoonPose;
  marker: CharMarker;
}

interface SafeView {
  id: EntityId;
  rig: SafeRig;
  kind: 'smallSafe' | 'largeSafe';
  pose: Pose2;
  y: number;
  anchored: boolean;
  /** In a recovery flight or gone. */
  done: boolean;
  hl: string | null;
  dustAcc: number;
}

interface BankView {
  id: EntityId;
  index: number;
  rig: BankRig;
  pose: Pose2;
  home: { pos: Vec2; angle: number };
  uprooted: boolean;
  scar: THREE.Group | null;
  /** 0..1 scar height (flattened while the bank still overlaps its old site). */
  scarRise: number;
  done: boolean;
  roofA: number;
  wallA: number[];
  hl: string | null;
  dustAcc: number;
  dustSide: number;
}

interface ResultsStage {
  center: Vec2;
  spots: Map<EntityId, { x: number; y: number; facing: number; cheer: boolean; sad: boolean }>;
  team: TeamId;
  winner: TeamId | null;
  nextConfetti: number;
}

const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _vel: Vec2 = { x: 0, y: 0 };
const _loc: Vec2 = { x: 0, y: 0 };

function idleRaccoonPose(): RaccoonPose {
  return { speed: 0, grabbing: false, straining: false, dashing: false, boosting: false, knockedDown: false, celebrating: false, sad: false, time: 0, expression: null, headYaw: undefined };
}

/** Slab test: does segment a->b (3D, bank-local) hit the axis-aligned box [min, max]? */
function segmentHitsBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, min: [number, number, number], max: [number, number, number]): boolean {
  let t0 = 0;
  let t1 = 1;
  const a = [ax, ay, az];
  const d = [bx - ax, by - ay, bz - az];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (a[i] < min[i] || a[i] > max[i]) return false;
      continue;
    }
    let ta = (min[i] - a[i]) / d[i];
    let tb = (max[i] - a[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export class GameView {
  private readonly container: HTMLElement;
  private settings: ViewSettings;
  private preset: QualityPreset;
  private renderer!: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly world = new THREE.Group();
  private readonly lights: DuskLighting;
  private readonly cam: GameCamera;
  private readonly effects: ViewEffects;
  private readonly poses = new PoseBuffer();
  private readonly resizeObserver: ResizeObserver | null = null;
  private width = 1;
  private height = 1;
  private viewMode: ViewMode = 'match';
  private time = 0;
  private disposed = false;

  private layout: LayoutDef | null = null;
  private sim: Simulation | null = null;
  private scenery: StaticScenery | null = null;
  private sceneryDecor = 1;
  private readonly chars = new Map<EntityId, CharView>();
  private readonly safes = new Map<EntityId, SafeView>();
  private readonly banks = new Map<EntityId, BankView>();
  private readonly fences = new Map<string, FenceRig>();
  private zones: ZoneMarkerRig[] = [];
  private vans: (VanRig | null)[] = [null, null];
  private glows: (SirenGlow | null)[] = [null, null];
  private stage: ResultsStage | null = null;
  private lastFocusId: EntityId | null = null;
  private lookAhead = { x: 0, y: 0 };
  private titleCheer = new Map<EntityId, number>();
  private fontsRequested = false;

  constructor(container: HTMLElement, settings: ViewSettings) {
    this.container = container;
    this.settings = { ...settings };
    this.preset = qualityPreset(settings.quality);
    this.scene.name = 'gameScene';
    this.world.name = 'world';
    this.scene.add(this.world);

    this.lights = createDuskLighting({ shadowRadius: this.preset.shadowRadius, quality: this.preset.level });
    this.scene.add(this.lights.group);
    this.scene.background = this.lights.background;
    this.scene.fog = this.lights.fog;

    this.cam = new GameCamera();
    this.scene.add(this.cam.camera);
    this.effects = new ViewEffects(this.preset);
    this.scene.add(this.effects.root);

    this.createRenderer();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.resize();
    this.applyQualityToScene();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get mode(): ViewMode {
    return this.viewMode;
  }

  /** The underlying three.js renderer (tests / screenshots). */
  get webgl(): THREE.WebGLRenderer {
    return this.renderer;
  }

  get camera(): THREE.PerspectiveCamera {
    return this.cam.camera;
  }

  /** Build the scene for sim.layout (replaces any previous load). */
  load(sim: Simulation): void {
    this.unload();
    this.sim = sim;
    const layout = sim.layout;
    this.layout = layout;
    const st = sim.state;

    this.buildScenery();

    const zoneLabel = this.zoneLabel();
    this.zones = layout.zones.map((z) => {
      const rig = createZoneMarker(z, zoneLabel);
      this.world.add(rig.root);
      return rig;
    });
    this.vans = [null, null];
    for (const z of layout.zones) {
      const van = createVan(z.team);
      placeOnSim(van.root, z.vanPos, z.vanAngle);
      this.world.add(van.root);
      this.vans[z.team] = van;
      const glow = this.effects.sirenGlow(z.team);
      glow.root.position.set(z.vanPos.x, 0.03, z.vanPos.y);
      this.world.add(glow.root);
      this.glows[z.team] = glow;
    }
    for (const f of layout.fences) {
      const rig = createFence(f);
      this.world.add(rig.root);
      this.fences.set(f.id, rig);
      const fs = st.fences.find((x) => x.id === f.id);
      if (fs?.broken) rig.breakApart(null).dispose();
    }

    let bankIndex = 0;
    for (const l of st.loot) {
      if (l.kind === 'bank') {
        const rig = createBank();
        const home = layout.banks[bankIndex] ?? { pos: { ...l.pos }, angle: l.angle };
        placeOnSim(rig.root, l.pos, l.angle);
        this.world.add(rig.root);
        const bv: BankView = {
          id: l.id,
          index: bankIndex,
          rig,
          pose: { x: l.pos.x, y: l.pos.y, a: l.angle },
          home: { pos: { ...home.pos }, angle: home.angle },
          uprooted: false,
          scar: null,
          scarRise: 0,
          done: l.recovered,
          roofA: 1,
          wallA: [1, 1, 1, 1, 1, 1],
          hl: null,
          dustAcc: 0,
          dustSide: 0,
        };
        bankIndex++;
        if (!l.anchored) this.uprootBank(bv, false);
        rig.root.visible = !l.recovered;
        this.banks.set(l.id, bv);
      } else {
        const rig = createSafe(l.kind);
        placeOnSim(rig.root, l.pos, l.angle, l.floorOf !== null ? BANK_FLOOR_Y : 0);
        rig.setAnchored(l.anchored);
        rig.root.visible = !l.recovered;
        this.world.add(rig.root);
        this.safes.set(l.id, {
          id: l.id,
          rig,
          kind: l.kind,
          pose: { x: l.pos.x, y: l.pos.y, a: l.angle },
          y: l.floorOf !== null ? BANK_FLOOR_Y : 0,
          anchored: l.anchored,
          done: l.recovered,
          hl: null,
          dustAcc: 0,
        });
      }
    }

    for (const c of st.characters) {
      const rig = createRaccoon({ team: c.team, look: c.look });
      rig.setBlobShadow(this.preset.blobShadows);
      placeOnSim(rig.root, c.pos, c.facing, c.floorOf !== null ? BANK_FLOOR_Y : 0);
      this.world.add(rig.root);
      const marker = this.effects.createCharMarker(c.team);
      this.world.add(marker.root);
      this.chars.set(c.id, {
        marker,
        id: c.id,
        rig,
        team: c.team,
        pose: { x: c.pos.x, y: c.pos.y, a: c.facing },
        y: c.floorOf !== null ? BANK_FLOOR_Y : 0,
        facing: c.facing,
        stepAcc: 0,
        stepSide: 0,
        lastX: c.pos.x,
        lastY: c.pos.y,
        cheerUntil: 0,
        happyUntil: 0,
        telegraph: null,
        poseObj: idleRaccoonPose(),
      });
    }

    this.poses.clear();
    this.poses.capture(sim);
    this.cam.setArena(layout.size);
    this.cam.snap();
    this.stage = null;
    this.lastFocusId = null;

    if (!this.fontsRequested) {
      this.fontsRequested = true;
      void preloadModelFonts(Object.values(LAYOUT_STRINGS[this.settings.language ?? 'ko']).join('')).then(() => {
        if (!this.disposed) this.scenery?.setSignResolver(this.signResolver());
      });
    }
  }

  /** Store this tick's poses (call after every sim.step). */
  captureTick(sim: Simulation): void {
    if (sim !== this.sim) return;
    this.poses.capture(sim);
  }

  onEvents(events: SimEvent[], sim: Simulation): void {
    if (sim !== this.sim || !events.length) return;
    for (const e of events) this.handleEvent(e, sim);
  }

  render(sim: Simulation, alpha: number, frameDt: number, focus: ViewFocus | null): void {
    if (this.disposed) return;
    this.advance(sim, alpha, frameDt, focus);
    this.renderer.render(this.scene, this.cam.camera);
  }

  /**
   * (extension) Everything render() does except drawing: poses, FX, camera, occlusion.
   * Useful to fast-forward animations (tests, capture tools) without paying for draws.
   */
  advance(sim: Simulation, alpha: number, frameDt: number, focus: ViewFocus | null): void {
    if (this.disposed) return;
    if (sim !== this.sim) this.load(sim);
    const dt = Math.min(Math.max(Number.isFinite(frameDt) ? frameDt : 0, 0), 0.1);
    this.time += dt;
    setModelTime(this.time);
    const st = sim.state;
    const mode = this.viewMode;

    if (mode === 'results' && !this.stage) this.stage = this.buildStage(sim, focus);

    // --- banks (first: riders depend on them) -----------------------------------------
    for (const bv of this.banks.values()) this.updateBank(bv, sim, alpha, dt);
    // --- safes ------------------------------------------------------------------------
    for (const sv of this.safes.values()) this.updateSafe(sv, sim, alpha, dt);
    // --- characters -------------------------------------------------------------------
    for (const c of st.characters) {
      const cv = this.chars.get(c.id);
      if (cv) this.updateChar(cv, c, sim, alpha, dt, focus);
    }
    // --- zones, vans, fences ------------------------------------------------------------
    this.updateZones(sim, dt);
    const siren = st.finalCountdown && mode !== 'title';
    for (const van of this.vans) {
      if (!van) continue;
      van.setSiren(siren);
      van.setEngine(siren || (mode === 'results' && this.stage?.team === van.team));
      van.update(dt);
      this.glows[van.team]?.update(siren && !this.settings.reducedMotion ? true : siren, this.time);
    }
    // --- highlights + pings -------------------------------------------------------------
    this.updateHighlights(sim, focus);
    this.updatePings(sim, focus);

    // --- camera -------------------------------------------------------------------------
    const focusChar = focus ? sim.getCharacter(focus.charId) ?? null : null;
    if (focusChar && focusChar.id !== this.lastFocusId) {
      this.cam.snap();
      this.lastFocusId = focusChar.id;
    }
    const goal = this.cameraGoal(sim, focusChar, dt);
    this.cam.update(dt, goal, { screenShake: this.settings.screenShake, reducedMotion: this.settings.reducedMotion });

    // --- occlusion ----------------------------------------------------------------------
    this.updateOcclusion(sim, focusChar, focus, dt);
    this.lights.setFocus(this.cam.focusPoint);

    // --- results extras -----------------------------------------------------------------
    if (mode === 'results' && this.stage && this.stage.winner !== null && this.time >= this.stage.nextConfetti) {
      const s = this.stage;
      const w: TeamId = s.winner as TeamId;
      this.effects.confetti(new THREE.Vector3(s.center.x, 0.4, s.center.y - 0.6), w, 70);
      this.vans[w]?.bounce(0.6);
      s.nextConfetti = this.settings.reducedMotion ? Infinity : this.time + 2.6;
    }

    this.effects.update(dt);
  }

  /** Project a sim point at `height` meters to CSS pixels inside the container. */
  project(p: Vec2, height: number): { x: number; y: number; onScreen: boolean; behind: boolean } {
    const cam = this.cam.camera;
    _v3.set(p.x, height, p.y);
    _v3b.copy(_v3).applyMatrix4(cam.matrixWorldInverse);
    const behind = _v3b.z > -cam.near;
    _ndc.copy(_v3).project(cam);
    let nx = _ndc.x;
    let ny = _ndc.y;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }
    const x = ((nx + 1) / 2) * this.width;
    const y = ((1 - ny) / 2) * this.height;
    const onScreen = !behind && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
    return { x, y, onScreen, behind };
  }

  /** Raycast a client (page) point to the ground plane y = 0; returns a sim point. */
  pickGround(clientX: number, clientY: number): Vec2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    _ray.setFromCamera(new THREE.Vector2(nx, ny), this.cam.camera);
    const hit = _ray.ray.intersectPlane(_plane, _v3);
    if (!hit) return null;
    return { x: hit.x, y: hit.z };
  }

  setMode(mode: ViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.stage = null;
    this.cam.snap();
    if (mode !== 'results') for (const cv of this.chars.values()) cv.cheerUntil = 0;
  }

  /** (extension) Show a short preparation tell on a character (bots: 준비 동작). */
  telegraph(charId: EntityId, kind: TelegraphKind, seconds = 0.35): void {
    const cv = this.chars.get(charId);
    if (!cv) return;
    cv.telegraph = { kind, start: this.time, until: this.time + Math.max(0.05, seconds) };
  }

  applySettings(s: ViewSettings): void {
    const prev = this.settings;
    this.settings = { ...s };
    const next = qualityPreset(s.quality);
    const old = this.preset;
    this.preset = next;
    if (next.antialias !== old.antialias) {
      this.createRenderer();
      this.resize();
    }
    if (next !== old) {
      this.effects.setQuality(next);
      this.applyQualityToScene();
      this.resize();
      for (const cv of this.chars.values()) cv.rig.setBlobShadow(next.blobShadows);
      if (this.layout && next.decorDensity !== this.sceneryDecor) this.buildScenery();
    }
    const langChanged = (prev.language ?? 'ko') !== (s.language ?? 'ko') || prev.signResolver !== s.signResolver;
    if (langChanged && this.scenery) this.scenery.setSignResolver(this.signResolver());
    if ((langChanged || prev.zoneLabel !== s.zoneLabel) && this.layout) {
      for (const z of this.zones) z.dispose();
      const label = this.zoneLabel();
      this.zones = this.layout.zones.map((z) => {
        const rig = createZoneMarker(z, label);
        this.world.add(rig.root);
        return rig;
      });
    }
    if (prev.toneMapping !== s.toneMapping) this.applyToneMapping(this.renderer);
    if (s.reducedMotion) this.cam.shake(-1);
  }

  resize(): void {
    const w = Math.max(1, Math.round(this.container.clientWidth || this.container.getBoundingClientRect().width || 1));
    const h = Math.max(1, Math.round(this.container.clientHeight || this.container.getBoundingClientRect().height || 1));
    this.width = w;
    this.height = h;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.renderer.setPixelRatio(Math.min(dpr, this.preset.maxPixelRatio));
    this.renderer.setSize(w, h);
    this.cam.setAspect(w / h);
  }

  /** (extension) Renderer statistics of the last frame + live particles. */
  stats(): ViewStats {
    const info = this.renderer.info;
    return {
      quality: this.preset.level,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      particles: this.effects.stats.particles,
      pixelRatio: this.renderer.getPixelRatio(),
      width: this.width,
      height: this.height,
    };
  }

  /** Free everything (renderer, scene, caches). Pass keepModelCaches if other views remain. */
  dispose(opts: { keepModelCaches?: boolean } = {}): void {
    if (this.disposed) return;
    this.unload();
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.effects.dispose();
    this.lights.dispose();
    setOcclusionFocus(null, null);
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (!opts.keepModelCaches) disposeModelCaches();
  }

  // ===========================================================================
  // Setup helpers
  // ===========================================================================

  private createRenderer(): void {
    const old = this.renderer as THREE.WebGLRenderer | undefined;
    if (old) {
      old.renderLists.dispose();
      old.dispose();
      old.domElement.remove();
    }
    const r = new THREE.WebGLRenderer({ antialias: this.preset.antialias, powerPreference: 'high-performance', alpha: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.applyToneMapping(r);
    r.shadowMap.enabled = this.preset.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = true;
    const c = r.domElement;
    c.style.display = 'block';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.touchAction = 'none';
    c.setAttribute('aria-hidden', 'true');
    this.container.appendChild(c);
    this.renderer = r;
  }

  private applyToneMapping(r: THREE.WebGLRenderer): void {
    const aces = this.settings.toneMapping === 'aces';
    r.toneMapping = aces ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
    r.toneMappingExposure = aces ? 1.1 : 1.0;
  }

  private applyQualityToScene(): void {
    const p = this.preset;
    const wasEnabled = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = p.shadows;
    this.lights.sun.castShadow = p.shadows;
    this.lights.setQuality(p.level);
    if (wasEnabled !== p.shadows) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else m.needsUpdate = true;
      });
    }
  }

  private signResolver(): SignResolver {
    if (this.settings.signResolver) return this.settings.signResolver;
    const lang = this.settings.language ?? 'ko';
    const table = LAYOUT_STRINGS[lang] ?? LAYOUT_STRINGS.ko;
    return (key) => table[key] ?? LAYOUT_STRINGS.ko[key] ?? key;
  }

  private zoneLabel(): string {
    return this.settings.zoneLabel ?? ZONE_LABELS[this.settings.language ?? 'ko'] ?? ZONE_LABELS.ko;
  }

  private buildScenery(): void {
    if (!this.layout) return;
    this.scenery?.dispose();
    const density = this.preset.decorDensity;
    const layout = density >= 1 ? this.layout : { ...this.layout, decor: this.layout.decor.filter((_, i) => ((i * 0.6180339887) % 1) < density) };
    this.scenery = buildStaticScenery(layout, this.signResolver());
    this.sceneryDecor = density;
    this.world.add(this.scenery.root);
    if (!this.preset.shadows) return;
  }

  private unload(): void {
    this.effects.clear();
    for (const cv of this.chars.values()) cv.rig.dispose();
    for (const sv of this.safes.values()) sv.rig.dispose();
    for (const bv of this.banks.values()) {
      bv.rig.dispose();
      bv.scar?.removeFromParent();
    }
    for (const f of this.fences.values()) f.dispose();
    for (const z of this.zones) z.dispose();
    for (const v of this.vans) v?.dispose();
    this.scenery?.dispose();
    this.chars.clear();
    this.safes.clear();
    this.banks.clear();
    this.fences.clear();
    this.zones = [];
    this.vans = [null, null];
    this.glows = [null, null];
    this.scenery = null;
    this.world.clear();
    this.sim = null;
    this.layout = null;
    this.stage = null;
    this.titleCheer.clear();
    this.poses.clear();
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  private handleEvent(e: SimEvent, sim: Simulation): void {
    const focusPos = this.focusPos();
    const nearFactor = (p: Vec2, radius: number): number => {
      if (!focusPos) return 0.5;
      const d = Math.hypot(p.x - focusPos.x, p.y - focusPos.y);
      return Math.max(0, 1 - d / radius);
    };
    switch (e.type) {
      case 'dash': {
        const c = sim.getCharacter(e.charId);
        const cv = this.chars.get(e.charId);
        if (c && cv) this.effects.dashPuff(c.pos, { x: Math.cos(c.facing), y: Math.sin(c.facing) }, cv.y);
        break;
      }
      case 'dashHit': {
        const v = sim.getCharacter(e.victimId);
        if (!v) break;
        const cv = this.chars.get(e.victimId);
        if (e.knockdown) {
          this.effects.knockdown(v.pos, cv?.y ?? 0);
          if (e.victimId === this.lastFocusId) this.cam.shake(0.5);
          else if (e.attackerId === this.lastFocusId) this.cam.shake(0.22);
        } else this.effects.bump(v.pos, 0.6, cv?.y ?? 0);
        break;
      }
      case 'bump': {
        for (const id of [e.aId, e.bId]) {
          const bv = this.banks.get(id);
          if (bv) bv.rig.wobbleSign(Math.min(1.6, e.impulse / 500));
        }
        if (e.impulse > 260) {
          const a = sim.getCharacter(e.aId) ?? sim.getLoot(e.aId);
          if (a) this.effects.bump(a.pos, Math.min(1, e.impulse / 900));
        }
        break;
      }
      case 'unanchored': {
        const l = sim.getLoot(e.lootId);
        if (!l) break;
        if (l.kind === 'bank') {
          const bv = this.banks.get(l.id);
          if (bv) this.uprootBank(bv, true);
          this.effects.bankUproot(l.pos, l.angle, BANK_MODEL.half);
          this.cam.shake(0.65 * nearFactor(l.pos, 26) + 0.08);
        } else {
          const sv = this.safes.get(l.id);
          if (sv) {
            sv.rig.setAnchored(false);
            sv.anchored = false;
          }
          this.effects.safeUnanchor(l.pos, l.kind === 'largeSafe');
          this.cam.shake(0.12 * nearFactor(l.pos, 10));
        }
        break;
      }
      case 'fenceBroken': {
        const rig = this.fences.get(e.fenceId);
        const bank = sim.getLoot(e.bankId);
        if (rig && !rig.broken) {
          const dir = bank && Math.hypot(bank.vel.x, bank.vel.y) > 0.05 ? bank.vel : null;
          const burst = rig.breakApart(dir);
          this.effects.fenceBreak(e.pos, burst);
        }
        this.banks.get(e.bankId)?.rig.wobbleSign(1.6);
        this.cam.shake(0.5 * nearFactor(e.pos, 24) + 0.05);
        break;
      }
      case 'safeLoaded': {
        const l = sim.getLoot(e.safeId);
        if (l) this.effects.fx.sparkle({ x: l.pos.x, y: BANK_FLOOR_Y + 0.2, z: l.pos.y }, { count: 6, radius: 0.5, color: HIGHLIGHT_COLORS.loaded });
        break;
      }
      case 'safeUnloaded': {
        if (e.byCharId !== null) {
          const cv = this.chars.get(e.byCharId);
          if (cv) cv.happyUntil = this.time + 1.2;
        }
        break;
      }
      case 'recovered':
        this.onRecovered(e, sim);
        break;
      case 'ejected':
      case 'unstuck': {
        const id = e.type === 'ejected' ? e.charId : e.entityId;
        this.poses.snap(id);
        const cv = this.chars.get(id);
        if (cv) this.effects.fx.dust({ x: e.pos.x, y: 0, z: e.pos.y }, { count: 5, spread: 0.4, size: 0.24 });
        break;
      }
      case 'ping': {
        if (this.lastFocusTeam(sim) === e.team) this.effects.pingRing(e.pos, e.team);
        break;
      }
      case 'finalCountdown':
        this.cam.shake(0.18);
        break;
      default:
        break;
    }
  }

  private onRecovered(e: Extract<SimEvent, { type: 'recovered' }>, sim: Simulation): void {
    const zone = this.layout?.zones.find((z) => z.team === e.team);
    const van = this.vans[e.team];
    const to = zone ? new THREE.Vector3(zone.vanPos.x, 1.7, zone.vanPos.y) : new THREE.Vector3();
    for (const h of e.holders) {
      const cv = this.chars.get(h);
      if (cv) cv.cheerUntil = this.time + 1.4;
    }
    if (e.kind === 'bank') {
      const bv = this.banks.get(e.lootId);
      if (!bv) return;
      bv.done = true;
      bv.rig.setHighlight(null);
      bv.rig.setRoofOpacity(1);
      for (let i = 0; i < 6; i++) bv.rig.setWallOpacity(i, 1);
      const objs: THREE.Object3D[] = [bv.rig.root];
      for (const sid of e.safeIds) {
        const sv = this.safes.get(sid);
        if (!sv) continue;
        sv.done = true;
        sv.rig.setHighlight(null);
        objs.push(sv.rig.root);
      }
      const from = bv.rig.root.position.clone();
      this.effects.recoveryPop({ x: from.x, y: from.z }, e.team, true);
      this.effects.fly({ objects: objs, from, to: to.clone().setY(1.2), team: e.team, kind: 'bank', onArrive: () => van?.bounce(1.6) }, this.world);
      const fp = this.focusPos();
      const near = fp ? Math.max(0, 1 - Math.hypot(from.x - fp.x, from.z - fp.y) / 30) : 0.5;
      this.cam.shake(0.4 * near);
    } else {
      const sv = this.safes.get(e.lootId);
      if (!sv || sv.done) return;
      sv.done = true;
      sv.rig.setHighlight(null);
      const from = sv.rig.root.position.clone();
      this.effects.recoveryPop({ x: from.x, y: from.z }, e.team, false);
      this.effects.fly({ objects: [sv.rig.root], from, to, team: e.team, kind: 'safe', onArrive: () => van?.bounce(e.kind === 'largeSafe' ? 1 : 0.6) }, this.world);
    }
  }

  private uprootBank(bv: BankView, animate: boolean): void {
    if (bv.uprooted) return;
    bv.uprooted = true;
    bv.rig.setUprooted(true);
    if (!animate) bv.rig.update(1); // settle the pop when loading mid-match
    const scar = createBankScar();
    placeOnSim(scar, bv.home.pos, bv.home.angle, 0.002);
    this.world.add(scar);
    bv.scar = scar;
  }

  // ===========================================================================
  // Per-frame entity updates
  // ===========================================================================

  private updateBank(bv: BankView, sim: Simulation, alpha: number, dt: number): void {
    const l = sim.getLoot(bv.id);
    if (!l) return;
    if (l.recovered || bv.done) {
      if (!bv.done) {
        bv.done = true;
        bv.rig.root.visible = false;
      }
      return;
    }
    const prevX = bv.pose.x;
    const prevY = bv.pose.y;
    this.poses.sample(bv.id, alpha, bv.pose, l);
    placeOnSim(bv.rig.root, { x: bv.pose.x, y: bv.pose.y }, bv.pose.a);
    if (!l.anchored && !bv.uprooted) this.uprootBank(bv, true);
    // Strain while someone pulls the anchored bank.
    let strain = 0;
    if (l.anchored) {
      for (const cid of l.grabbedBy) {
        const c = sim.getCharacter(cid);
        if (c?.straining) strain = Math.max(strain, 0.3 + 0.7 * l.unanchorProgress);
      }
    }
    bv.rig.setStrain(strain);
    // Dust trail while moving.
    const speed = Math.hypot(l.vel.x, l.vel.y) + Math.abs(l.angVel) * 3;
    if (!l.anchored && speed > 0.2 && dt > 0 && this.viewMode !== 'results') {
      bv.dustAcc += dt * (2.5 + speed * 7) * this.preset.particles;
      const v = Math.hypot(l.vel.x, l.vel.y) > 0.05 ? l.vel : { x: prevX - bv.pose.x, y: prevY - bv.pose.y };
      const vl = Math.hypot(v.x, v.y) || 1;
      const dir = { x: v.x / vl, y: v.y / vl };
      while (bv.dustAcc >= 1) {
        bv.dustAcc -= 1;
        // Trailing edge of the footprint, alternating corners.
        bv.dustSide = 1 - bv.dustSide;
        const side = bv.dustSide ? 1 : -1;
        const hx = BANK_MODEL.half.x;
        const hy = BANK_MODEL.half.y;
        const ca = Math.cos(l.angle);
        const sa = Math.sin(l.angle);
        // Pick the corner pair most opposite the motion.
        const corners: Vec2[] = [
          { x: hx, y: hy },
          { x: hx, y: -hy },
          { x: -hx, y: hy },
          { x: -hx, y: -hy },
        ].map((c) => ({ x: bv.pose.x + c.x * ca - c.y * sa, y: bv.pose.y + c.x * sa + c.y * ca }));
        corners.sort((a, b) => (a.x - bv.pose.x) * dir.x + (a.y - bv.pose.y) * dir.y - ((b.x - bv.pose.x) * dir.x + (b.y - bv.pose.y) * dir.y));
        const c = corners[side > 0 ? 0 : 1];
        const t = Math.random() * 0.35;
        const other = corners[side > 0 ? 1 : 0];
        this.effects.dragDust({ x: c.x + (other.x - c.x) * t, y: c.y + (other.y - c.y) * t }, { x: -dir.x, y: -dir.y }, 0.42);
      }
    }
    bv.rig.update(dt);
  }

  private updateSafe(sv: SafeView, sim: Simulation, alpha: number, dt: number): void {
    const l = sim.getLoot(sv.id);
    if (!l) return;
    if (sv.done) return;
    if (l.recovered) {
      sv.done = true;
      sv.rig.root.visible = false;
      return;
    }
    this.poses.sample(sv.id, alpha, sv.pose, l);
    const onFloor = l.floorOf !== null || this.onAnySlab(sv.pose);
    const targetY = onFloor ? BANK_FLOOR_Y : 0;
    sv.y += (targetY - sv.y) * damp(18, dt);
    if (dt <= 0) sv.y = targetY;
    placeOnSim(sv.rig.root, sv.pose, sv.pose.a, sv.y);
    if (sv.anchored !== l.anchored) {
      sv.anchored = l.anchored;
      sv.rig.setAnchored(l.anchored);
    }
    let strain = 0;
    if (l.anchored) {
      for (const cid of l.grabbedBy) {
        const c = sim.getCharacter(cid);
        if (c?.straining) strain = Math.max(strain, 0.35 + 0.65 * l.unanchorProgress);
      }
    }
    sv.rig.setStrain(strain);
    // Drag dust on the ground.
    if (!l.anchored && l.floorOf === null && dt > 0) {
      const sp = Math.hypot(l.vel.x, l.vel.y);
      if (sp > 0.9) {
        sv.dustAcc += dt * sp * (sv.kind === 'largeSafe' ? 2.4 : 1.4) * this.preset.particles;
        while (sv.dustAcc >= 1) {
          sv.dustAcc -= 1;
          const ux = l.vel.x / sp;
          const uy = l.vel.y / sp;
          const back = SAFE_SPECS[sv.kind].half.x;
          this.effects.dragDust({ x: sv.pose.x - ux * back + (Math.random() - 0.5) * 0.6, y: sv.pose.y - uy * back + (Math.random() - 0.5) * 0.6 }, { x: -ux, y: -uy }, sv.kind === 'largeSafe' ? 0.3 : 0.22);
        }
      }
    }
    sv.rig.update(dt);
  }

  private updateChar(cv: CharView, c: CharacterState, sim: Simulation, alpha: number, dt: number, focus: ViewFocus | null): void {
    const mode = this.viewMode;
    const pose = cv.poseObj;
    pose.time = this.time;
    pose.expression = null;
    pose.headYaw = undefined;
    const spot = mode === 'results' ? this.stage?.spots.get(c.id) : undefined;
    if (spot) {
      cv.pose.x = spot.x;
      cv.pose.y = spot.y;
      cv.facing += wrapAngle(spot.facing - cv.facing) * damp(8, dt);
      if (dt <= 0) cv.facing = spot.facing;
      cv.y = 0;
      pose.speed = 0;
      pose.grabbing = false;
      pose.straining = false;
      pose.dashing = false;
      pose.boosting = false;
      pose.knockedDown = false;
      pose.celebrating = spot.cheer;
      pose.sad = spot.sad;
      if (!spot.cheer && !spot.sad) pose.expression = 'happy';
      cv.rig.root.scale.set(1, 1, 1);
      placeOnSim(cv.rig.root, cv.pose, cv.facing, 0);
      cv.rig.setHighlight(null);
      cv.rig.update(dt, pose);
      return;
    }

    this.poses.sample(c.id, alpha, cv.pose, { pos: c.pos, angle: c.facing });
    // Facing: interpolated + a little extra smoothing for snappy turns.
    if (dt <= 0 || Math.abs(wrapAngle(cv.pose.a - cv.facing)) > 2.8 && c.knockdownTicks > 0) cv.facing = cv.pose.a;
    else cv.facing = lerpAngle(cv.facing, cv.pose.a, damp(22, dt));
    // Floor height (riders on a bank floor), smoothed across the door threshold.
    const onFloor = c.floorOf !== null || this.onAnySlab(cv.pose);
    const targetY = onFloor ? BANK_FLOOR_Y : 0;
    cv.y += (targetY - cv.y) * damp(16, dt);
    if (dt <= 0) cv.y = targetY;

    // Speed relative to the floor the character stands on.
    let vx = c.vel.x;
    let vy = c.vel.y;
    if (c.floorOf !== null) {
      const b = sim.getLoot(c.floorOf);
      if (b) {
        pointVelocity(b.pos, b.vel, b.angVel, c.pos, _vel);
        vx -= _vel.x;
        vy -= _vel.y;
      }
    }
    const speed = Math.hypot(vx, vy);
    pose.speed = speed;
    pose.grabbing = c.grab !== null;
    pose.straining = c.straining;
    pose.dashing = c.dashTicks > 0;
    pose.boosting = c.boostTicks > 0;
    pose.knockedDown = c.knockdownTicks > 0;
    pose.celebrating = this.time < cv.cheerUntil;
    pose.sad = false;
    if (this.time < cv.happyUntil && !pose.celebrating) pose.expression = 'happy';

    // Title attract: idle raccoons cheer now and then.
    if (mode === 'title') {
      const next = this.titleCheer.get(c.id) ?? this.time + 1 + Math.random() * 5;
      if (this.time >= next) {
        cv.cheerUntil = this.time + 1.1;
        this.titleCheer.set(c.id, this.time + 4 + Math.random() * 6);
      } else this.titleCheer.set(c.id, next);
    }

    // Head turns toward the focus character's grab candidate (reads "what would I grab").
    if (focus && focus.charId === c.id && focus.grabCandidate && !c.grab && c.knockdownTicks <= 0) {
      const a = Math.atan2(focus.grabCandidate.anchorWorld.y - c.pos.y, focus.grabCandidate.anchorWorld.x - c.pos.x);
      pose.headYaw = THREE.MathUtils.clamp(-wrapAngle(a - cv.facing), -0.8, 0.8);
    }

    // Telegraph (bot 준비 동작).
    let sqY = 1;
    let sqXZ = 1;
    const tg = cv.telegraph;
    if (tg) {
      if (this.time >= tg.until) cv.telegraph = null;
      else {
        const k = (this.time - tg.start) / Math.max(0.05, tg.until - tg.start);
        const env = Math.sin(Math.PI * Math.min(1, k));
        if (tg.kind === 'dash') {
          sqY = 1 - 0.14 * env;
          sqXZ = 1 + 0.08 * env;
          pose.expression = 'strain';
        } else if (tg.kind === 'grab') {
          pose.grabbing = true;
        } else if (tg.kind === 'sly') {
          pose.headYaw = Math.sin(k * Math.PI * 4) * 0.7;
        } else if (tg.kind === 'cheer') {
          pose.celebrating = true;
        }
      }
    }
    cv.rig.root.scale.set(sqXZ, sqY, sqXZ);
    placeOnSim(cv.rig.root, cv.pose, cv.facing, cv.y);

    // Footstep puffs.
    if (dt > 0) {
      const moved = Math.hypot(cv.pose.x - cv.lastX, cv.pose.y - cv.lastY);
      if (moved < 1.5 && speed > 2.2 && !pose.grabbing && !pose.knockedDown && c.floorOf === null) {
        cv.stepAcc += moved;
        if (cv.stepAcc > 0.8) {
          cv.stepAcc = 0;
          cv.stepSide = 1 - cv.stepSide;
          const s = cv.stepSide ? 0.12 : -0.12;
          this.effects.footstep({ x: cv.pose.x - Math.sin(cv.facing) * s, y: cv.pose.y + Math.cos(cv.facing) * s }, cv.y);
        }
      }
    }
    cv.lastX = cv.pose.x;
    cv.lastY = cv.pose.y;
    cv.rig.update(dt, pose);
  }

  private onAnySlab(p: Vec2): boolean {
    for (const bv of this.banks.values()) {
      if (bv.done) continue;
      if (onBankSlab(p, bv.pose, bv.pose.a)) return true;
    }
    return false;
  }

  private updateZones(sim: Simulation, dt: number): void {
    const st = sim.state;
    const need = sim.rules.recoveryTicks;
    for (const z of this.zones) {
      let active = 0;
      let progress = 0;
      for (const l of st.loot) {
        if (l.recovered || !l.recovery || l.recovery.team !== z.team) continue;
        active = 1;
        progress = Math.max(progress, l.recovery.ticks / need);
      }
      z.setActive(active);
      z.setProgress(progress);
      z.update(dt);
    }
  }

  // ===========================================================================
  // Highlights and pings (doc §4)
  // ===========================================================================

  private lastFocusTeam(sim: Simulation): TeamId | null {
    if (this.lastFocusId === null) return null;
    return sim.getCharacter(this.lastFocusId)?.team ?? null;
  }

  private updateHighlights(sim: Simulation, focus: ViewFocus | null): void {
    const st = sim.state;
    const show = this.viewMode === 'match';
    const focusChar = focus ? sim.getCharacter(focus.charId) : undefined;
    const team = focusChar?.team ?? null;
    const pulseOn = Math.sin(this.time * 9) > -0.2;
    const pinged = new Set<EntityId>();
    if (focus) for (const id of focus.pingTargetIds) pinged.add(id);
    if (team !== null) for (const p of st.pings) if (p.team === team && p.targetId !== null && p.expiresTick > st.tick) pinged.add(p.targetId);
    const cand = show && focus?.grabCandidate ? focus.grabCandidate.targetId : null;

    const colorFor = (l: LootState, roofOpen: boolean): string | null => {
      if (!show) return null;
      if (cand === l.id) return HIGHLIGHT_COLORS.grab;
      if (l.recovery) return HIGHLIGHT_COLORS.inZone;
      if (pinged.has(l.id) && team !== null) return pulseOn ? TEAM_STYLES[team].color : TEAM_STYLES[team].tint;
      if (team !== null && l.grabbedBy.length) {
        for (const cid of l.grabbedBy) {
          const c = sim.getCharacter(cid);
          if (c && c.team === team) return TEAM_STYLES[team].tint;
        }
      }
      if (l.kind !== 'bank' && l.loadedIn !== null && roofOpen) return HIGHLIGHT_COLORS.loaded;
      return null;
    };

    for (const bv of this.banks.values()) {
      if (bv.done) continue;
      const l = sim.getLoot(bv.id);
      if (!l) continue;
      const c = colorFor(l, false);
      if (c !== bv.hl) {
        bv.hl = c;
        bv.rig.setHighlight(c);
      }
    }
    for (const sv of this.safes.values()) {
      if (sv.done) continue;
      const l = sim.getLoot(sv.id);
      if (!l) continue;
      let roofOpen = false;
      if (l.loadedIn !== null) {
        const bv = this.banks.get(l.loadedIn);
        roofOpen = !!bv && (bv.roofA < 0.5 || (bv.uprooted && bv.roofA < 0.99));
      }
      const c = colorFor(l, roofOpen);
      if (c !== sv.hl) {
        sv.hl = c;
        sv.rig.setHighlight(c);
      }
    }
  }

  private updatePings(sim: Simulation, focus: ViewFocus | null): void {
    const st = sim.state;
    const team = focus ? sim.getCharacter(focus.charId)?.team ?? null : null;
    let i = 0;
    if (team !== null && this.viewMode === 'match') {
      for (const p of st.pings) {
        if (p.team !== team || p.expiresTick <= st.tick) continue;
        if (i >= this.effects.beaconCapacity) break;
        const life = (p.expiresTick - st.tick) / PING.durationTicks;
        let ground = true;
        if (p.targetId !== null) {
          const bv = this.banks.get(p.targetId);
          const sv = this.safes.get(p.targetId);
          if (bv && !bv.done) {
            _v3.set(bv.pose.x, BANK_MODEL.roofHeight + 2.6, bv.pose.y);
            ground = false;
          } else if (sv && !sv.done) {
            _v3.set(sv.pose.x, sv.y + SAFE_SPECS[sv.kind].height + 0.35, sv.pose.y);
            ground = false;
          } else continue;
        } else _v3.set(p.pos.x, 0.02, p.pos.y);
        this.effects.setBeacon(i++, p.team, _v3, ground, life);
      }
    }
    this.effects.hideBeaconsFrom(i);
  }

  // ===========================================================================
  // Camera
  // ===========================================================================

  private focusPos(): Vec2 | null {
    if (this.lastFocusId === null) return null;
    const cv = this.chars.get(this.lastFocusId);
    return cv ? { x: cv.pose.x, y: cv.pose.y } : null;
  }

  private cameraGoal(sim: Simulation, fc: CharacterState | null, dt: number): CameraGoal {
    const layout = sim.layout;
    const W = layout.size.x;
    const H = layout.size.y;
    const aspect = this.width / this.height;
    const calm = this.settings.reducedMotion;
    const t = this.time;
    switch (this.viewMode) {
      case 'preview': {
        const pitch = 60;
        const fov = 38;
        const dist = fitDistance(W + 4, H + 6, pitch, fov, aspect) * 0.98;
        const drift = calm ? 0 : 1;
        return {
          target: { x: W / 2 + Math.sin(t * 0.16) * 1.6 * drift, y: H / 2 + 1.5 + Math.sin(t * 0.11 + 1) * 1.0 * drift },
          distance: dist,
          pitch,
          fov,
          followRate: 2,
          clamp: false,
        };
      }
      case 'title': {
        const pan = calm ? 0 : 1;
        return {
          target: { x: W / 2 + Math.sin(t * 0.045) * W * 0.28 * pan, y: H / 2 + 3 + Math.sin(t * 0.031 + 0.6) * H * 0.14 * pan },
          distance: 25,
          pitch: 40,
          fov: 36,
          followRate: 1.5,
          clamp: false,
        };
      }
      case 'results': {
        const s = this.stage;
        const c = s ? s.center : { x: W / 2, y: H / 2 };
        const drift = calm ? 0 : 1;
        return {
          target: { x: c.x + Math.sin(t * 0.2) * 0.5 * drift, y: c.y - 0.6 },
          distance: 14 + Math.sin(t * 0.13) * 0.6 * drift,
          pitch: 33,
          fov: 34,
          followRate: 2.5,
          clamp: false,
        };
      }
      default:
        break;
    }
    // --- match -------------------------------------------------------------------------
    if (!fc) {
      return { target: { x: W / 2, y: H / 2 }, distance: fitDistance(W, H, MATCH_PITCH, MATCH_FOV, aspect), pitch: MATCH_PITCH, fov: MATCH_FOV, followRate: 3, clamp: false };
    }
    const cv = this.chars.get(fc.id);
    const P = cv ? { x: cv.pose.x, y: cv.pose.y } : fc.pos;
    // Look-ahead from velocity (smoothed).
    const la = 0.38;
    let lx = fc.vel.x * la;
    let ly = fc.vel.y * la;
    const ll = Math.hypot(lx, ly);
    if (ll > 2.4) {
      lx *= 2.4 / ll;
      ly *= 2.4 / ll;
    }
    const k = damp(2.5, dt);
    this.lookAhead.x += (lx - this.lookAhead.x) * k;
    this.lookAhead.y += (ly - this.lookAhead.y) * k;

    let tx = P.x + this.lookAhead.x;
    let ty = P.y + this.lookAhead.y;
    let dist: number = MATCH_DIST.walk;
    const frame = (q: Vec2, w: number): void => {
      tx += (q.x - tx) * w;
      ty += (q.y - ty) * w;
    };
    const held = fc.grab ? sim.getLoot(fc.grab.targetId) : undefined;
    if (held && !held.recovered) {
      const view = held.kind === 'bank' ? this.banks.get(held.id)?.pose : this.safes.get(held.id)?.pose;
      const q = view ?? held.pos;
      if (held.kind === 'bank') {
        frame(q, 0.55);
        dist = held.anchored ? MATCH_DIST.nearBank : MATCH_DIST.hauling;
      } else if (held.kind === 'largeSafe') {
        frame(q, 0.35);
        dist = MATCH_DIST.largeSafe;
      } else {
        frame(q, 0.3);
        dist = MATCH_DIST.smallSafe;
      }
    } else {
      // Near a bank (or riding one): pull back to frame the building.
      let nearest: BankView | null = null;
      let nd = Infinity;
      for (const bv of this.banks.values()) {
        if (bv.done) continue;
        const d = Math.hypot(bv.pose.x - P.x, bv.pose.y - P.y);
        if (d < nd) {
          nd = d;
          nearest = bv;
        }
      }
      if (nearest && (nd < 9 || fc.floorOf === nearest.id)) {
        dist = MATCH_DIST.nearBank;
        frame(nearest.pose, fc.floorOf === nearest.id ? 0.25 : 0.12);
      }
    }
    return { target: { x: tx, y: ty }, distance: dist, pitch: MATCH_PITCH, fov: MATCH_FOV, followRate: 4.5, clamp: true };
  }

  // ===========================================================================
  // Occlusion (doc §4: 실내에 들어가면 지붕을 감추고, 카메라와 캐릭터 사이의 벽만 투명하게)
  // ===========================================================================

  private updateOcclusion(sim: Simulation, fc: CharacterState | null, focus: ViewFocus | null, dt: number): void {
    const camPos = this.cam.basePosition;
    const mode = this.viewMode;
    // Scenery x-ray toward the focus (match) / the staged group (results).
    let chest: THREE.Vector3 | null = null;
    const fcv = fc ? this.chars.get(fc.id) : undefined;
    if (mode === 'match' && fcv) chest = new THREE.Vector3(fcv.pose.x, fcv.y + CHEST_Y, fcv.pose.y);
    else if (mode === 'results' && this.stage) chest = new THREE.Vector3(this.stage.center.x, CHEST_Y, this.stage.center.y);
    setOcclusionFocus(chest ? camPos : null, chest, mode === 'results' ? 3.2 : 2.4);

    // Interest points that must stay visible: the focus raccoon (+ held / candidate safe).
    const pts: THREE.Vector3[] = [];
    const interestSafes: SafeView[] = [];
    if (mode === 'match' && fc && fcv) {
      for (const h of [0.15, CHEST_Y, 1.1]) pts.push(new THREE.Vector3(fcv.pose.x, fcv.y + h, fcv.pose.y));
      const ids: EntityId[] = [];
      if (fc.grab) ids.push(fc.grab.targetId);
      if (focus?.grabCandidate) ids.push(focus.grabCandidate.targetId);
      for (const id of ids) {
        const sv = this.safes.get(id);
        if (sv && !sv.done) {
          interestSafes.push(sv);
          pts.push(new THREE.Vector3(sv.pose.x, sv.y + SAFE_SPECS[sv.kind].height * 0.6, sv.pose.y));
        }
      }
    }

    const H = BANK_MODEL.wallHeight;
    const k = damp(dt > 0 ? 10 : 1e6, dt > 0 ? dt : 1);
    for (const bv of this.banks.values()) {
      if (bv.done) continue;
      let roofT = 1;
      const wallT = [1, 1, 1, 1, 1, 1];
      if (mode === 'match' && fc && fcv) {
        const center = { x: bv.pose.x, y: bv.pose.y };
        const ang = bv.pose.a;
        let inside = fc.floorOf === bv.id || insideRect(fcv.pose, center, BANK_MODEL.half, ang, 0.05);
        for (const sv of interestSafes) {
          const l = sim.getLoot(sv.id);
          if (!l) continue;
          if (l.floorOf === bv.id || l.loadedIn === bv.id || insideRect(sv.pose, center, BANK_MODEL.half, ang, -0.1)) inside = true;
        }
        if (inside) {
          roofT = 0;
          // Fade the walls facing the camera (front of the view) so the interior reads.
          BANK_MODEL.walls.forEach((w, i) => {
            const len = Math.hypot(w.center.x, w.center.y) || 1;
            const nx = w.center.x / len;
            const ny = w.center.y / len;
            // World normal (sim): rotate local normal by the bank angle.
            const wy = nx * Math.sin(ang) + ny * Math.cos(ang);
            if (wy > 0.3) wallT[i] = WALL_FADE;
          });
        }
        // Ray tests: walls/roof between the camera and the interest points.
        const near = Math.hypot(bv.pose.x - fcv.pose.x, bv.pose.y - fcv.pose.y) < 22;
        if (near && pts.length) {
          const lc = toLocal({ x: camPos.x, y: camPos.z }, center, ang, { x: 0, y: 0 });
          for (const p of pts) {
            toLocal({ x: p.x, y: p.z }, center, ang, _loc);
            BANK_MODEL.walls.forEach((w, i) => {
              if (wallT[i] <= WALL_FADE) return;
              const min: [number, number, number] = [w.center.x - w.half.x - 0.05, 0, w.center.y - w.half.y - 0.05];
              const max: [number, number, number] = [w.center.x + w.half.x + 0.05, H + 0.4, w.center.y + w.half.y + 0.05];
              if (segmentHitsBox(lc.x, camPos.y, lc.y, _loc.x, p.y, _loc.y, min, max)) wallT[i] = WALL_FADE;
            });
            if (roofT > ROOF_FADE_BEHIND) {
              const rh = BANK_MODEL.half;
              if (segmentHitsBox(lc.x, camPos.y, lc.y, _loc.x, p.y, _loc.y, [-rh.x - 0.5, H - 0.2, -rh.y - 0.5], [rh.x + 0.5, BANK_MODEL.roofHeight + 1.6, rh.y + 0.5])) roofT = ROOF_FADE_BEHIND;
            }
          }
        }
      }
      // Smooth and apply.
      const nr = bv.roofA + (roofT - bv.roofA) * k;
      if (Math.abs(nr - bv.roofA) > 0.001 || (roofT !== bv.roofA && Math.abs(nr - roofT) < 0.002)) {
        bv.roofA = Math.abs(nr - roofT) < 0.002 ? roofT : nr;
        bv.rig.setRoofOpacity(bv.roofA);
      }
      for (let i = 0; i < 6; i++) {
        const cur = bv.wallA[i];
        let nw = cur + (wallT[i] - cur) * k;
        if (Math.abs(nw - wallT[i]) < 0.002) nw = wallT[i];
        if (nw !== cur) {
          bv.wallA[i] = nw;
          bv.rig.setWallOpacity(i, nw);
        }
      }
    }
  }

  // ===========================================================================
  // Results staging (doc §13: winners celebrate at their van; the loser stands empty-handed)
  // ===========================================================================

  private buildStage(sim: Simulation, focus: ViewFocus | null): ResultsStage {
    const st = sim.state;
    const layout = sim.layout;
    const winner = st.result ? st.result.winner : st.scores[0] === st.scores[1] ? null : st.scores[0] > st.scores[1] ? 0 : 1;
    const focusTeam = focus ? sim.getCharacter(focus.charId)?.team ?? 0 : 0;
    const team: TeamId = (winner ?? focusTeam) as TeamId;
    const zone = layout.zones.find((z) => z.team === team) ?? layout.zones[0];
    const van = zone?.vanPos ?? { x: layout.size.x / 2, y: layout.size.y / 2 };
    const zc = zone?.center ?? van;
    let dx = zc.x - van.x;
    let dy = zc.y - van.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const front = { x: van.x + dx * 4.4, y: van.y + dy * 4.4 };
    // Losers stand toward the arena center from the winners (screen-sideways).
    const towardCenter = Math.sign(layout.size.x / 2 - front.x) || 1;
    const spots = new Map<EntityId, { x: number; y: number; facing: number; cheer: boolean; sad: boolean }>();
    const winners = st.characters.filter((c) => (winner === null ? true : c.team === winner));
    const losers = winner === null ? [] : st.characters.filter((c) => c.team !== winner);
    const FACE_CAM = Math.PI / 2;
    winners.forEach((c, i) => {
      const off = (i - (winners.length - 1) / 2) * 1.35;
      spots.set(c.id, { x: front.x + off, y: front.y + (i % 2) * 0.35, facing: FACE_CAM + (i - (winners.length - 1) / 2) * 0.25, cheer: winner !== null, sad: false });
    });
    const lx = front.x + towardCenter * (winners.length * 0.7 + 3.4);
    losers.forEach((c, i) => {
      const off = (i - (losers.length - 1) / 2) * 1.3;
      // Face mostly the camera, turned a little toward the winners.
      const facing = FACE_CAM + towardCenter * 0.55;
      spots.set(c.id, { x: lx + off * towardCenter, y: front.y + 0.6 + (i % 2) * 0.3, facing, cheer: false, sad: true });
    });
    let cx = front.x;
    if (losers.length) cx = (front.x + lx) / 2;
    return { center: { x: cx, y: front.y + 0.3 }, spots, team, winner, nextConfetti: this.time + 0.25 };
  }
}
