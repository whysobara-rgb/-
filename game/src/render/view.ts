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
 *   ViewSettings.language / signResolver / zoneLabel / toneMapping, render(..., focus: ViewFocus
 *   | null), project() also returns `behind`, advance(), telegraph(), setBotTelegraph(),
 *   takeHitstop(), stats() (incl. contextLost), canvas / mode / webgl / camera getters,
 *   dispose({ keepModelCaches }).
 *
 * Contract notes:
 *   - frameDt = 0 freezes every view animation and smoother (hitstop freeze-frames); only load()
 *     and setMode() snap.
 *   - dispose() and MSAA changes release their WebGL context (forceContextLoss), so repeated
 *     views / quality toggles never push Chromium past its live-context limit.
 *   - An MSAA change replaces the canvas in place and dispatches 'gameviewcanvas'
 *     ({ detail: { canvas, previous } }) on the container: bind pointer listeners to the
 *     container (or re-bind on that event).
 *   - 'match' never rotates the camera (fixed north yaw). 'results' / 'title' aim their shot
 *     (yaw / pitch / distance) with a clearance search against statics and banks.
 *   - World-space aids owned by the view: grab-candidate brackets + anchor dot (doc §4),
 *     recovery ground meters (doc §8 dwell), ping beacons, team ground rings.
 *   - Taunts (owner addition): CharacterState.emote / 'emote' events drive the raccoon's taunt
 *     animation (taunts.ts state machine -> RaccoonPose.taunt), a pink-rimmed taunt bubble over
 *     the head and a few particles. The raccoon turns to the rival the event names (the butt
 *     wiggle turns its back on it). ViewSettings.showOthersTaunts = false hides everyone's
 *     taunts except the focus character's own.
 */
import * as THREE from 'three';
import type {
  CharacterState,
  EmoteId,
  EntityId,
  GrabCandidate,
  LayoutDef,
  LootKind,
  LootState,
  SimEvent,
  Simulation,
  TeamId,
  Vec2,
} from '../sim';
import { BANK_MODEL, EMOTE, PING, PROP_SPECS, SAFE_SPECS, TICK_RATE } from '../sim';
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
  pushShockwave,
  clearShockwaves,
  RACCOON_LABEL_HEIGHT,
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
import { GameCamera, MATCH_DIST, MATCH_FOV, MATCH_PITCH, NORTH_YAW, fitDistance, type CameraGoal, type ViewMode } from './camera';
import { GRAB_MARKER_COLOR, PigeonFlock, ViewEffects, type CharMarker, type PigeonThreat, type SirenGlow } from './effects';
import { qualityPreset, type QualityLevel, type QualityPreset } from './quality';
import { PostFX } from './post';
import { EmoteSystem, POLICE_OWNER, type EmoteKind } from './emotes';
import { OffscreenMarkers } from './markers';
import { UprootBanners } from './banner';
import { MoodDirector } from './moods';
import { UprootDirector, type LootPose } from './uproot';
import { PoliceView } from './police';
import { PoseBuffer, damp, insideRect, lerpAngle, onBankSlab, pointVelocity, toLocal, wrapAngle, type Pose2 } from './sync';
import { TauntTracker, type TauntWorld } from './taunts';
import type { Moment, StreakTier } from '../shared/moments';
// [C7a] Content 2.0 extras (coins, items, props; C7b appends gimmicks / events in extras.ts).
import { createViewExtras, type ViewExtra, type ViewExtrasHost } from './extras';
import { createPropRig, type PropRig } from './models/props';
// [F3] Render beats (glance, getaway, decisive load, steal chance, run heat, wind-up, barks, results poses).
import { BarkBubble, BeatLabel, BEATS, GlanceTracker, LabelScreen, PulseRing, WindupRing, departParam, getawayDepart, vanFreeRun, type ChipSize } from './beats';
import { matchPointInfo, VAN } from '../sim';
import { sharedFraming, type FramePoint, type SharedFrame } from './sharedCamera';
import { lootTwinPlacements, mirrorTwinYaw } from './upright';
import { ko as KO_STRINGS } from '../ui/strings/ko';
import { en as EN_STRINGS } from '../ui/strings/en';

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
  /**
   * (extension) Built-in in-world "뽑았다!" banner on uproots (default true). Turn it off when
   * the HUD shows its own callout from takeCallouts() / onCallout.
   */
  builtinCallouts?: boolean;
  /**
   * (extension) Show other raccoons' taunts (default true). Off hides everyone else's taunt
   * animations, bubbles and particles; the focus character's own always play. Leaving the field
   * out of an applySettings() call keeps the current value.
   */
  showOthersTaunts?: boolean;
}

/** Taunt bubbles sit this much (m) higher and further right than other bubbles, clear of the pose's face (match camera). */
const TAUNT_BUBBLE_CLEAR = 0.4;

/** Taunt bubble sticker per taunt emote. */
export const TAUNT_BUBBLE: Readonly<Record<EmoteId, EmoteKind>> = {
  wiggle: 'tauntWiggle',
  bleh: 'tauntBleh',
  fanCash: 'tauntCash',
  squatBounce: 'tauntSquat',
  hodadakZoom: 'tauntZoom',
  tongkeunFlex: 'tauntFlex',
  nunchiShrug: 'tauntShrug',
};

export interface ViewFocus {
  charId: EntityId;
  grabCandidate: GrabCandidate | null;
  pingTargetIds: EntityId[];
  /** (local multiplayer) Every human player: 2+ ids = one shared camera frames them all. */
  group?: EntityId[];
  /** (local multiplayer) Player colour per `group` entry (ground ring). */
  groupColors?: string[];
}

/**
 * (extension) Presentation moments the HUD / audio can react to (polled with takeCallouts() or
 * pushed through GameView.onCallout). `screen` is the CSS-pixel projection at the event.
 */
export type ViewCallout =
  | { type: 'uproot'; lootId: EntityId; kind: LootKind; byTeam: TeamId | null; value: number; pos: Vec2; screen: { x: number; y: number; onScreen: boolean } }
  | { type: 'landed'; lootId: EntityId; kind: LootKind; pos: Vec2 }
  | { type: 'emote'; ownerId: number; emote: EmoteKind; pos: Vec2; police: boolean }
  | { type: 'tackle'; officerId: EntityId; victimId: EntityId; hit: boolean; pos: Vec2 }
  | { type: 'alarm'; bankId: EntityId; pos: Vec2 }
  | { type: 'policeArrived'; carId: number; pos: Vec2 };

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
  /** The WebGL context is currently lost (three.js restores it when the browser allows). */
  contextLost: boolean;
  /** Draw calls of the scene pass alone (drawCalls includes post-processing passes). */
  sceneDrawCalls: number;
  /** Post-processing composer active (medium / high). */
  post: boolean;
  /** Emote stickers on screen, police officers / cars shown. */
  emotes: number;
  officers: number;
  cars: number;
  /** Off-screen attention markers drawn (police arriving / chasing outside the frame). */
  markers: number;
}

const ZONE_LABELS = { ko: '회수 구역', en: 'RECOVERY ZONE' } as const;
const CHEST_Y = 0.6;
const WALL_FADE = 0.2;
const ROOF_FADE_BEHIND = 0.1;
/** Roof opacity while someone else is inside / a safe inside is being moved (doc §10). */
const ROOF_PEEK = 0.22;
const RESULTS_FOV = 34;
/** Zone pulse strength while something dwells (models' zone washes out at 1). */
const ZONE_PULSE = 0.35;
/** Ground recovery ring around a dwelling bank (inside the 6.5 x 5.5 zone half extents). */
const BANK_METER_RADIUS = 5.25;
/** How far (m) the walking camera may pull back to show a nearby target with the player. */
const FRAME_EXTRA_DIST = 4;
const DEG = Math.PI / 180;

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
  flashUntil: number;
  flashOn: boolean;
  telegraph: { kind: TelegraphKind; until: number; start: number } | null;
  poseObj: RaccoonPose;
  marker: CharMarker;
  /** Seconds of softened turning left after a taunt released the facing. */
  tauntTurn: number;
  /** Taunt shown last frame (dust cadence for the zoom run). */
  tauntFxAcc: number;
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
  /** Render-only yaw added to the sim angle: PI for an east mirror twin (see mirrorTwinYaw). */
  yawFix: number;
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

interface StageSpot {
  x: number;
  y: number;
  facing: number;
  cheer: boolean;
  sad: boolean;
  /** Order within its group (hop phase). */
  index: number;
}

interface ResultsStage {
  center: Vec2;
  spots: Map<EntityId, StageSpot>;
  team: TeamId;
  winner: TeamId | null;
  nextConfetti: number;
  /** Built after the match ended (otherwise rebuilt once the result is known). */
  final: boolean;
  /** Camera shot (clearance-checked against statics). */
  yaw: number;
  pitch: number;
  dist: number;
  clear: boolean;
  confettiAt: Vec2;
  /** Where the losers glance. */
  winnersAt: Vec2;
  nextSigh: number;
}

interface TitleShot {
  target: Vec2;
  yaw: number;
  pitch: number;
  dist: number;
  /** Nothing blocks the raccoons from this shot (scenery x-ray off: no dither). */
  clear: boolean;
}

/** Scar footprint half extents (bank footprint + slab rim + dirt lip). */
const SCAR_HALF: Vec2 = { x: BANK_MODEL.half.x + 0.45, y: BANK_MODEL.half.y + 0.45 };
/** Scar height scale while the bank still stands on it (everything stays below the floor). */
const SCAR_FLAT = 0.14;

/** Do two equal oriented rectangles overlap? (SAT on both frames) */
function rectsOverlap(a: Vec2, aa: number, b: Vec2, ba: number, half: Vec2): boolean {
  const axes = [aa, aa + Math.PI / 2, ba, ba + Math.PI / 2];
  const cornersOf = (c: Vec2, ang: number): Vec2[] => {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    return [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].map(([sx, sy]) => ({ x: c.x + sx * half.x * ca - sy * half.y * sa, y: c.y + sx * half.x * sa + sy * half.y * ca }));
  };
  const A = cornersOf(a, aa);
  const B = cornersOf(b, ba);
  for (const ax of axes) {
    const ux = Math.cos(ax);
    const uy = Math.sin(ax);
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const p of A) {
      const d = p.x * ux + p.y * uy;
      amin = Math.min(amin, d);
      amax = Math.max(amax, d);
    }
    for (const p of B) {
      const d = p.x * ux + p.y * uy;
      bmin = Math.min(bmin, d);
      bmax = Math.max(bmax, d);
    }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _vel: Vec2 = { x: 0, y: 0 };
const _loc: Vec2 = { x: 0, y: 0 };
// [F3] getaway exhaust puff scratch (vanPuff)
const _puffAt = { x: 0, y: 0, z: 0 };
const _puffDir = { x: 0, y: 0.15, z: 0 };
const _puffOpts = { count: 2, spread: 0.25, size: 0.26, color: '#8E8796', up: 0.35, dir: _puffDir };
const _chest = new THREE.Vector3();

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
  private post!: PostFX;
  private readonly emotes = new EmoteSystem(48);
  private readonly taunts = new TauntTracker();
  private readonly tauntWorld: TauntWorld = {
    posOf: (id) => {
      const cv = this.chars.get(id);
      if (cv) return { x: cv.pose.x, y: cv.pose.y };
      return this.sim?.getCharacter(id)?.pos ?? null;
    },
    nearestOpponent: (c) => this.nearestVisibleOpponent(c),
    // face taunts stay readable: the face never turns far from the camera (taunts.ts)
    cameraDir: (c) => {
      const p = this.cam.camera.position;
      return { x: p.x - c.pos.x, y: p.z - c.pos.y };
    },
  };
  private readonly markers = new OffscreenMarkers(8);
  private readonly banners = new UprootBanners();
  private readonly moods: MoodDirector;
  private readonly uproot: UprootDirector;
  private readonly police: PoliceView;
  private readonly callouts: ViewCallout[] = [];
  /** (extension) Optional push hook for callouts (also queued for takeCallouts()). */
  onCallout: ((c: ViewCallout) => void) | null = null;
  private alarmLevel = 0;
  private readonly pigeons = new PigeonFlock(24);
  private readonly threats: PigeonThreat[] = [];
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
  private titleShot: TitleShot | null = null;
  private lastFocusId: EntityId | null = null;
  private lookAhead = { x: 0, y: 0 };
  /** (local multiplayer) Humans the shared camera frames (null = single-player follow). */
  private focusGroup: EntityId[] | null = null;
  /** (local multiplayer) Last shared-camera target: equally good framings keep to it (no flip-flop). */
  private sharedPrev: { x: number; y: number } | null = null;
  private titleCheer = new Map<EntityId, number>();
  private fontsRequested = false;
  private readonly botTelegraph = new Map<EntityId, boolean>();
  /** Squash/stretch "snap" pulses per entity (grab contact etc.). */
  private readonly pulses = new Map<EntityId, { start: number; amp: number }>();
  private hitstop = 0;
  private resultsDrop = 0;
  private contextLost = false;
  /** Next advance() applies smoothed values instantly (load / mode switch), even with dt = 0. */
  private snapVisuals = true;
  /** [C7a] Content 2.0 view extras (see extras.ts); empty until load(). */
  private extras: ViewExtra[] = [];

  // --- [F3] render beats (fun round WP3; see beats.ts) ---------------------------------------
  private readonly glanceT = new GlanceTracker();
  private readonly glanceOut = { x: 0, y: 0 };
  /** Getaway beat: winner team (null = draw), start time, the winner van's free forward run. */
  private getaway: { team: TeamId | null; start: number; run: number; nextPuff: number; revIdx: number; honked: boolean } | null = null;
  /**
   * End-hold camera shot on the winners' van (playGetaway; null = none, draw or reduced motion):
   * target + distance framing the van (and the player when both fit). The match is over, so the
   * camera may leave the player for the 2.4 s hold.
   */
  private getawayShot: { x: number; y: number; dist: number; cut: boolean } | null = null;
  /** Viewport + HUD zones the beat labels stay clear of (resize / UI scale). */
  private readonly labelScreen = new LabelScreen();
  /** HUD world-chip size (rem) over the decisive load: the label sits on top of it. */
  private readonly decisiveChip: ChipSize = { w: 0, h: 0 };
  /** Default results poses when game flow has not called setResultsPoses (rival won / lost). */
  private readonly defaultPoses: { rival: 'taunt' | 'slump'; player: EmoteId | null } = { rival: 'slump', player: null };
  /** Decisive load (match point): ids as fed (loot first, then bag carriers) + whose. */
  private readonly decisiveIds: EntityId[] = [];
  private decisiveSide: 'ours' | 'theirs' | null = null;
  private readonly decisiveRing = new PulseRing('decisiveRing');
  private readonly decisiveLabel = new BeatLabel('decisiveLabel');
  /** Bag carriers marked as (part of) the decisive load: one extra ring each (2:2 shared hauls). */
  private readonly bagRings: PulseRing[] = [];
  private readonly bagIds: EntityId[] = [];
  private decisiveHl: { id: EntityId; color: string } | null = null;
  private readonly decisiveHlRec: { id: EntityId; color: string } = { id: -1 as EntityId, color: '#FFD23F' };
  /** Steal-chance marker (door glow + "빼내기 +N"). */
  private stealPos: Vec2 | null = null;
  private stealValue = 0;
  private readonly stealRing = new PulseRing('stealRing');
  private readonly stealLabel = new BeatLabel('stealLabel');
  /** Scoring-run heat on a van (tier 0 = none). */
  private runHeat: { team: TeamId | null; tier: 0 | StreakTier } = { team: null, tier: 0 };
  private runHeatShown: (string | null)[] = [null, null];
  private nextHeatSpark = 0;
  /** Bot dash wind-ups (start time, -1 = not winding up) + their spark rings; bark bubbles. */
  private readonly windupList: { id: EntityId; start: number; ring: WindupRing }[] = [];
  private readonly barkList: { id: EntityId; bubble: BarkBubble }[] = [];
  /** Results-stage poses (setResultsPoses). */
  private resultsPoses: { rival: 'taunt' | 'slump'; player: EmoteId | null } | null = null;
  private resultsPoseStart = 0;
  private readonly beatRoot = new THREE.Group();

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
    this.scene.add(this.pigeons.root);
    this.moods = new MoodDirector(this.emotes);
    this.moods.listener = (owner, kind, pos) => this.pushCallout({ type: 'emote', ownerId: owner, emote: kind, pos, police: owner >= POLICE_OWNER });
    this.uproot = new UprootDirector(
      {
        effects: this.effects,
        pose: (id) => this.lootPose(id),
        shake: (at, amount, radius) => this.cam.shake(amount * this.nearFactorAt(at, radius)),
        impact: (at, strength, chroma) => this.impactAt(at, strength, chroma),
        shock: (at, strength) => {
          if (!this.settings.reducedMotion) pushShockwave(at.x, at.y, strength);
        },
        scare: (at, r) => this.pigeons.scare(at, r),
        stage: (id, kind, stage) => this.onUprootStage(id, kind, stage),
        landed: (id, kind) => {
          const p = this.lootPose(id);
          if (kind === 'bank') {
            const bv = this.banks.get(id);
            bv?.rig.wobbleSign(3.5);
            bv?.rig.clangBell(1);
          }
          if (p) this.pushCallout({ type: 'landed', lootId: id, kind, pos: { x: p.x, y: p.y } });
        },
      },
      this.preset,
    );
    this.scene.add(this.uproot.root);
    this.police = new PoliceView({
      effects: this.effects,
      focusId: () => this.lastFocusId,
      impact: (at, strength, chroma) => this.impactAt(at, strength, chroma),
      shake: (at, amount, radius) => this.cam.shake(amount * this.nearFactorAt(at, radius)),
      punch: (dir, strength) => {
        if (!this.settings.reducedMotion) this.cam.punch(dir, strength);
      },
      scare: (at, r) => this.pigeons.scare(at, r),
      charPos: (id) => {
        const cv = this.chars.get(id);
        return cv ? { x: cv.pose.x, y: cv.pose.y } : null;
      },
    });
    this.scene.add(this.police.root);
    this.scene.add(this.emotes.root);
    this.scene.add(this.markers.mesh);
    this.scene.add(this.banners.root);
    // [F3] Beat visuals live outside `world` (it is cleared on unload) and are reused per match.
    this.beatRoot.name = 'beats';
    this.beatRoot.add(this.decisiveRing.root, this.stealRing.root, this.decisiveLabel.sprite, this.stealLabel.sprite);
    this.scene.add(this.beatRoot);

    this.createRenderer();
    this.post = new PostFX(this.renderer, this.scene, this.cam.camera, this.preset);
    this.post.setReducedMotion(settings.reducedMotion);
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
      glow.place(z.vanPos, z.vanAngle);
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
    const twinSpots = lootTwinPlacements(layout);
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
        // [C7a] Props (ATM / piggy / money tree / gold safe) use SafeRig-compatible prop rigs.
        const rig = l.variant ? createPropRig(l.variant, this.settings.language ?? 'ko') : createSafe(l.kind);
        // An east mirror twin turns its door / screen to match its west original (upright text).
        const yawFix = l.homeBank === null ? mirrorTwinYaw(twinSpots, { x: l.pos.x, y: l.pos.y, key: l.variant ?? l.kind }, layout.size.x / 2) : 0;
        placeOnSim(rig.root, l.pos, l.angle + yawFix, l.floorOf !== null ? BANK_FLOOR_Y : 0);
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
          yawFix,
        });
      }
    }

    // Uproot choreography tracks (anchored loot; already-free loot gets its crater).
    for (const l of st.loot) {
      if (l.recovered) continue;
      // [C7a] Free-standing props (the piggy) never had a ground home: no crater / roots.
      if (l.variant && PROP_SPECS[l.variant].uprootTicks === 0) continue;
      const owner = l.kind !== 'bank' && l.homeBank !== null ? l.homeBank : null;
      const ob = owner !== null ? sim.getLoot(owner) : undefined;
      const ownerPose = ob ? { x: ob.pos.x, y: ob.pos.y, a: ob.angle, h: BANK_FLOOR_Y } : null;
      // An interior safe that already left its bank is tracked in the world frame.
      const inHome = owner !== null && l.anchored && l.floorOf === owner;
      this.uproot.track(l, inHome ? owner : null, inHome ? ownerPose : null);
    }
    this.police.setLayout(layout);

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
        flashUntil: 0,
        flashOn: false,
        telegraph: null,
        poseObj: idleRaccoonPose(),
        tauntTurn: 0,
        tauntFxAcc: 0,
      });
    }

    this.pigeons.reset(this.pigeonSpots(sim), layout.id.length * 7919 + layout.statics.length, this.preset.particles);
    // [C7a] Content 2.0 extras (the single registration point).
    this.extras = createViewExtras(this.extrasHost(sim));

    this.poses.clear();
    this.poses.capture(sim);
    this.cam.setArena(layout.size);
    this.cam.snap();
    this.snapVisuals = true;
    this.stage = null;
    this.titleShot = null;
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
    this.police.capture(sim);
  }

  onEvents(events: SimEvent[], sim: Simulation): void {
    if (sim !== this.sim || !events.length) return;
    for (const e of events) this.handleEvent(e, sim);
    for (const x of this.extras) x.onEvents(events);
  }

  render(sim: Simulation, alpha: number, frameDt: number, focus: ViewFocus | null): void {
    if (this.disposed) return;
    this.advance(sim, alpha, frameDt, focus);
    this.draw(Math.min(Math.max(Number.isFinite(frameDt) ? frameDt : 0, 0), 0.1));
  }

  /** Draw the current scene state (post-processing when the preset enables it). */
  private draw(dt: number): void {
    this.renderer.info.reset();
    if (this.post.active) this.post.render(dt);
    else this.renderer.render(this.scene, this.cam.camera);
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

    if (mode === 'results' && (!this.stage || (st.over && !this.stage.final))) this.stage = this.buildStage(sim, focus);

    // --- banks (first: riders depend on them) -----------------------------------------
    for (const bv of this.banks.values()) this.updateBank(bv, sim, alpha, dt);
    // --- safes ------------------------------------------------------------------------
    for (const sv of this.safes.values()) this.updateSafe(sv, sim, alpha, dt);
    // --- [C7a] Content 2.0 extras (after loot poses, before characters) ------------------
    for (const x of this.extras) x.sync(st, alpha, dt);
    // --- characters -------------------------------------------------------------------
    for (const c of st.characters) {
      const cv = this.chars.get(c.id);
      if (cv) this.updateChar(cv, c, sim, alpha, dt, focus);
    }
    this.flushTauntChanges();
    // --- zones, vans, fences ------------------------------------------------------------
    this.updateZones(sim, dt);
    const siren = st.finalCountdown && mode !== 'title';
    for (const van of this.vans) {
      if (!van) continue;
      // [F3] Getaway beat (end hold): the winner's siren + roll, revving engines (bit 1 siren, 2 engine).
      const away = this.getawayVan(van, dt);
      const on = siren || (away & 1) !== 0;
      van.setSiren(on);
      van.setEngine(on || (away & 2) !== 0 || (mode === 'results' && this.stage?.team === van.team));
      van.update(dt);
      // Reduced motion: steady glow instead of flashing.
      this.glows[van.team]?.update(on, this.settings.reducedMotion ? 0 : this.time, dt);
    }
    this.updateRunHeat(dt);
    // --- highlights + pings -------------------------------------------------------------
    this.updateHighlights(sim, focus);
    this.updatePings(sim, focus);

    // --- camera -------------------------------------------------------------------------
    const focusChar = focus ? sim.getCharacter(focus.charId) ?? null : null;
    this.focusGroup = focus?.group && focus.group.length > 1 ? focus.group : null;
    if (!this.focusGroup) this.sharedPrev = null;
    if (focusChar && focusChar.id !== this.lastFocusId) {
      this.cam.snap();
      this.lastFocusId = focusChar.id;
    }
    const goal = this.cameraGoal(sim, focusChar, dt, focus?.grabCandidate ?? null);
    this.cam.update(dt, goal, { screenShake: this.settings.screenShake, reducedMotion: this.settings.reducedMotion });

    // --- occlusion ----------------------------------------------------------------------
    this.updateOcclusion(sim, focusChar, focus, dt);
    this.lights.setFocus(this.cam.focusPoint);
    // --- [F3] world-pinned beats (after the camera: labels are clamped in screen space) ---
    this.updateBeats(sim, dt);

    // --- results extras -----------------------------------------------------------------
    if (mode === 'results' && this.stage && this.stage.winner !== null && this.time >= this.stage.nextConfetti) {
      const s = this.stage;
      const w: TeamId = s.winner as TeamId;
      this.effects.confetti(new THREE.Vector3(s.confettiAt.x, 0.4, s.confettiAt.y), w, 70);
      this.vans[w]?.bounce(0.6);
      s.nextConfetti = this.settings.reducedMotion ? Infinity : this.time + 2.6;
      // Winners pop hearts / sparkles, losers a tear now and then.
      for (const [id, spot] of s.spots) {
        if (spot.cheer) this.emotes.show(id, (spot.index + Math.floor(this.time)) % 2 ? 'heart' : 'sparkle', { duration: 1.6 });
        else if (spot.sad && spot.index === 0) this.emotes.show(id, 'tear', { duration: 2 });
      }
    }

    // --- uproot choreography, police, moods + emotes, alarm grade --------------------------
    this.uproot.update(sim, dt);
    // [F3] No officers / cars on the results stage (fun-plan WP3 §7): the stage is the gang's moment.
    this.police.update(sim, alpha, dt, mode !== 'preview' && mode !== 'results');
    this.moods.update(sim, dt, mode === 'match', this.settings.reducedMotion);
    this.emotes.update(dt, this.cam.camera, (owner, out) => this.emoteAnchor(owner, out));
    this.banners.calm = this.settings.reducedMotion;
    this.banners.update(dt);
    this.markers.calm = this.settings.reducedMotion;
    this.markers.begin();
    if (mode === 'match') this.police.collectMarkers(this.markers, this.cam.camera, this.lastFocusId, sim);
    this.markers.end();
    let alarm = 0;
    if (mode === 'match') {
      for (const id of st.alarm.ringing) {
        const bv = this.banks.get(id);
        if (bv && !bv.done) alarm = Math.max(alarm, this.nearFactorAt(bv.pose, 24));
      }
    }
    this.post.tick(dt);
    this.alarmLevel += (alarm * (0.6 + 0.4 * Math.max(0, Math.sin(this.time * 8))) - this.alarmLevel) * damp(6, dt);
    this.post.setAlarm(this.alarmLevel);

    this.updatePigeons(sim, dt);
    this.effects.update(dt);
    this.snapVisuals = false;
  }

  /** Is this character's taunt shown (setting off: only the focus character's own)? */
  private tauntShown(charId: EntityId): boolean {
    return this.settings.showOthersTaunts !== false || charId === this.lastFocusId;
  }

  /** Nearest opponent within EMOTE.nearOpponentRadius in line of sight (taunt facing fallback). */
  private nearestVisibleOpponent(c: CharacterState): EntityId | null {
    const sim = this.sim;
    if (!sim) return null;
    let best: EntityId | null = null;
    let bestD: number = EMOTE.nearOpponentRadius;
    for (const o of sim.state.characters) {
      if (o.team === c.team || o.id === c.id) continue;
      const d = Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y);
      if (d > bestD) continue;
      if (!sim.lineOfSight(c.pos, o.pos)) continue;
      best = o.id;
      bestD = d;
    }
    return best;
  }

  /** Taunt starts / stops of this frame: bubble pop / hide and a few particles. */
  private flushTauntChanges(): void {
    for (const ch of this.taunts.takeChanges()) {
      const kind = TAUNT_BUBBLE[ch.id];
      if (ch.kind === 'stop') {
        this.emotes.hide(ch.charId, kind);
        continue;
      }
      if (!this.tauntShown(ch.charId) || (this.viewMode !== 'match' && this.viewMode !== 'preview')) continue;
      const dur = EMOTE.durationTicks[ch.id] / TICK_RATE;
      this.emotes.show(ch.charId, kind, { duration: dur + 0.15, priority: 3, scale: 1.22, clear: TAUNT_BUBBLE_CLEAR });
      const cv = this.chars.get(ch.charId);
      if (!cv) continue;
      const head = { x: cv.pose.x, y: cv.y + 1.15, z: cv.pose.y };
      const fx = this.effects.fx;
      switch (ch.id) {
        case 'wiggle':
          fx.sparkle(head, { count: 5, radius: 0.55, color: '#FF9EC0' });
          break;
        case 'bleh':
          fx.sparkle(head, { count: 4, radius: 0.45, color: '#FF7F9C' });
          break;
        case 'fanCash':
          fx.confetti({ x: head.x, y: cv.y + 1.0, z: head.z }, { count: 9, colors: ['#DDF4CB', '#9CD3A4', '#FFD45E'], power: 0.55 });
          break;
        case 'squatBounce':
          fx.dust({ x: cv.pose.x, y: cv.y, z: cv.pose.y }, { count: 4, spread: 0.4, size: 0.2 });
          break;
        case 'hodadakZoom':
          fx.sparkle(head, { count: 3, radius: 0.4, color: '#7FC8FF' });
          break;
        case 'tongkeunFlex':
          fx.sparkle(head, { count: 6, radius: 0.6, color: '#FFD45E' });
          break;
        case 'nunchiShrug':
          fx.sparkle(head, { count: 3, radius: 0.45, color: '#B9A3F0' });
          break;
      }
    }
  }

  /** Head-top point for an emote owner (raccoon id or POLICE_OWNER + officer id). */
  private emoteAnchor(owner: number, out: THREE.Vector3): boolean {
    if (this.viewMode === 'preview') return false;
    if (owner >= POLICE_OWNER) return this.viewMode !== 'results' && this.police.anchor(owner - POLICE_OWNER, out);
    const cv = this.chars.get(owner);
    if (!cv || !cv.rig.root.visible) return false;
    const c = this.sim?.getCharacter(owner);
    const down = c && c.knockdownTicks > 0 ? 0.3 : 0;
    out.set(cv.pose.x, cv.rig.root.position.y + RACCOON_LABEL_HEIGHT - 0.12 - down, cv.pose.y);
    return true;
  }

  /**
   * Where a loot / character is drawn this frame (the pose interpolated between sim ticks by the
   * last render), for HUD label anchors: project(renderedPos(id) ?? simPos, h) stays glued to
   * the object at any display rate. Null when it is not drawn (fall back to the sim position).
   */
  renderedPos(id: EntityId, kind: 'loot' | 'char'): Vec2 | null {
    if (kind === 'char') return this.chars.get(id)?.pose ?? null;
    const bv = this.banks.get(id);
    if (bv) return bv.done ? null : bv.pose;
    const sv = this.safes.get(id);
    return sv && !sv.done ? sv.pose : null;
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
    this.titleShot = null;
    this.cam.snap();
    this.snapVisuals = true;
    if (mode !== 'results') for (const cv of this.chars.values()) cv.cheerUntil = 0;
    // [F3] Beats belong to the mode they were started in (setResultsPoses comes after this call).
    this.endGetaway();
    this.glanceT.clear();
    this.resultsPoses = null;
    this.resultsPoseStart = this.time;
  }

  /**
   * (extension) Suggested hit-stop (seconds) from the events since the last call
   * (docs/ART_DIRECTION.md §2: dash hit ~70 ms, bank uproot ~120 ms, bank recovery ~150 ms).
   * Game flow pauses the sim accumulator for that long (rules unaffected) and may keep
   * rendering with frameDt = 0 for a freeze-frame: frameDt = 0 freezes every view animation
   * and smoother in place (nothing snaps; only load()/setMode() snap). Always 0 with
   * reducedMotion.
   */
  takeHitstop(): number {
    const h = this.settings.reducedMotion ? 0 : this.hitstop;
    this.hitstop = 0;
    return h;
  }

  /**
   * (extension) Presentation callouts since the last call (oldest first): 'uproot' ("뽑았다!"
   * with the screen point), 'landed' (heavy thud), 'emote' (sticker pop sound), 'tackle',
   * 'alarm', 'policeArrived'. Also pushed live through `onCallout`.
   */
  takeCallouts(): ViewCallout[] {
    return this.callouts.splice(0, this.callouts.length);
  }

  /** (extension) Pop an emote over a character (e.g. UI pings, tutorial beats). */
  showEmote(charId: EntityId, kind: EmoteKind, seconds?: number): void {
    this.emotes.show(charId, kind, { duration: seconds, priority: 2 });
  }

  /** (extension) Dollhouse cutaway of the banks (default on). */
  setBankCutaway(on: boolean): void {
    for (const bv of this.banks.values()) bv.rig.setCutaway(on);
  }

  /**
   * (extension) Game-flow camera request (docs/ART_DIRECTION.md §2 카메라 펀치): `punch` pushes
   * the camera along `dir` (sim ground direction) and springs back, `zoom` is a brief zoom-in
   * (fraction of the distance), `shake` adds trauma. The camera already scales all of them by
   * settings.screenShake and drops them entirely with reducedMotion.
   */
  cameraKick(o: { dir?: Vec2 | null; punch?: number; zoom?: number; shake?: number }): void {
    if (this.disposed || this.settings.reducedMotion) return;
    if (o.punch && o.dir) this.cam.punch(o.dir, Math.min(1, o.punch));
    if (o.zoom) this.cam.zoomPunch(Math.min(0.2, o.zoom));
    if (o.shake) this.cam.shake(Math.min(1, o.shake));
  }

  /**
   * (extension) Results framing: place the staged group `fraction` of the screen height below
   * center (0 = centered, default). Game flow uses it to keep the raccoons clear of the results
   * cards.
   */
  setResultsFraming(fraction: number): void {
    this.resultsDrop = Math.min(0.4, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  }

  /** (extension) Show a short preparation tell on a character (bots: 준비 동작). */
  telegraph(charId: EntityId, kind: TelegraphKind, seconds = 0.35): void {
    const cv = this.chars.get(charId);
    if (!cv) return;
    cv.telegraph = { kind, start: this.time, until: this.time + Math.max(0.05, seconds) };
  }

  /**
   * (extension) Feed a bot's intent each tick (BotController.intent(): telegraph + goal); a
   * rising telegraph edge plays a short personality-flavoured 준비 동작 (doc §11): 호다닥 a quick
   * crouch, 통큰이 arms out, 눈치왕 a sly glance; intercepts always crouch like a dash wind-up.
   */
  setBotTelegraph(charId: EntityId, active: boolean, goal?: string | null): void {
    const was = this.botTelegraph.get(charId) ?? false;
    this.botTelegraph.set(charId, active);
    if (!active || was) return;
    const cv = this.chars.get(charId);
    if (!cv) return;
    const rival = cv.rig.look.rival ?? null;
    let kind: TelegraphKind = 'grab';
    if (goal === 'intercept') kind = 'dash';
    else if (rival === 'hodadak') kind = 'dash';
    else if (rival === 'nunchi') kind = 'sly';
    else if (rival === 'tongkeun') kind = 'grab';
    this.telegraph(charId, kind, kind === 'sly' ? 0.5 : 0.4);
  }

  // -------------------------------------------------------------------------------------------
  // Fun round contracts (docs/ARCHITECTURE.md "Fun round contracts"; owner WP3 = Content 2.0 F3).
  // Presentation only (never touch the sim); every one respects reducedMotion. Visual pieces live
  // in beats.ts; the per-frame part is updateBeats() / getawayVan() / updateRunHeat().
  // -------------------------------------------------------------------------------------------

  /**
   * (fun round, WP3) Big-play glance: blend the camera target toward `pos` by `weight` (clamped
   * to 0..0.3) for `ms` milliseconds, then back. No yaw change (doc §4); the shift is capped
   * (BEATS.glance.maxShift) so the player never leaves the frame. No-op with reducedMotion and
   * outside 'match'.
   */
  glance(pos: Vec2, weight: number, ms: number): void {
    if (this.disposed || this.settings.reducedMotion || this.viewMode !== 'match') return;
    this.glanceT.begin(pos, weight, ms, this.time);
  }

  /** (tests / tools) Is a glance blending the camera right now? */
  get glancing(): boolean {
    return this.glanceT.weightAt(this.time) > 0;
  }

  /**
   * (fun round, WP3) Getaway beat during the end hold (match.ts END_HOLD_SECONDS): the winning
   * team's van honks, puffs and pulls away 3–4 m with siren + strobe (less when a static is in
   * the way); its crew hops. `null` (draw) = both vans rev and stay. Call once when the match
   * ends. Never blocks or delays rematch input (pure presentation; setMode() ends it).
   */
  playGetaway(team: TeamId | null): void {
    if (this.disposed || !this.layout || !this.sim) return;
    const t: TeamId | null = team === 0 || team === 1 ? team : null;
    let run = 0;
    const z = t !== null ? this.zoneOf(t) : null;
    if (z) {
      const sim = this.sim;
      run = vanFreeRun(z.vanPos, z.vanAngle, VAN.half, (p, r) => sim.isFree(p, r));
    }
    this.endGetaway();
    this.getaway = { team: t, start: this.time, run, nextPuff: this.time, revIdx: 0, honked: false };
    // The match is over (input no longer steers anything), so for the hold the camera goes to
    // the winners' van, wherever the player stands: van + player when they share the frame,
    // else the van alone (cameraGoal blends it in). A van off screen right now gets a cut (the
    // honk is seen from its first frame, no whip-pan across the map); one already on screen a
    // short pan. Reduced motion: never a pan; only the cut, when the van is off screen.
    this.getawayShot = null;
    if (z && this.viewMode === 'match') {
      const p = this.project(z.vanPos, 1.2);
      const cut = !p.onScreen;
      if (cut || !this.settings.reducedMotion) {
        this.getawayShot = { ...this.getawayFraming(z, run), cut };
        if (cut) this.cam.snap();
      }
    }
    if (t !== null) {
      for (const c of this.sim.state.characters) {
        const cv = c.team === t ? this.chars.get(c.id) : undefined;
        if (cv) cv.cheerUntil = this.time + 2.3;
      }
    }
  }

  /** (tests / tools) The running getaway: winner (null = draw), seconds in, meters rolled. */
  getawayInfo(): { team: TeamId | null; t: number; rolled: number; run: number } | null {
    const g = this.getaway;
    if (!g) return null;
    const t = this.time - g.start;
    return { team: g.team, t, rolled: g.team === null ? 0 : getawayDepart(t, g.run), run: g.run };
  }

  /**
   * (fun round, WP3) Decisive-load glow: pulsing rim + ground ring + world label on the load
   * (`matchPointInfo().lootIds`). `side` = whose match point from the local player's view
   * ('ours' = string `hud.mp.ours` "이게 들어가면 끝!", 'theirs' = `hud.mp.theirs` "막아야 해!";
   * both keys are defined by WP4); `null` (or empty ids with a null side) clears it. Only one
   * label at a time; drawn above police markers and clamped out of the HUD bands. Safe to call
   * every tick (idempotent).
   *
   * Content 2.0 (F3 delta): a coin bag can be the decisive load. A character id among `ids`
   * marks that bag carrier (ring at its feet, label over its head); when `ids` is empty but
   * `side` is set (a bag-only load: `lootIds` is empty), the carriers come from
   * `matchPointInfo().bagCharIds` (WP4's query; nothing is re-derived here).
   */
  setDecisiveLoad(ids: readonly EntityId[], side: 'ours' | 'theirs' | null): void {
    const s = side === 'ours' || side === 'theirs' ? side : null;
    const n = s ? ids.length : 0;
    let same = s === this.decisiveSide && n === this.decisiveIds.length;
    for (let i = 0; same && i < n; i++) if (ids[i] !== this.decisiveIds[i]) same = false;
    if (same) return;
    this.decisiveIds.length = 0;
    for (let i = 0; i < n; i++) this.decisiveIds.push(ids[i]!);
    const sideChanged = s !== this.decisiveSide;
    this.decisiveSide = s;
    this.bagFallbackAt = -1;
    if (!s) this.decisiveLabel.hide();
    else if (sideChanged || !this.decisiveLabel.shown) {
      this.refreshLabelScreen();
      this.decisiveLabel.set(this.decisiveText(s), s);
    }
  }

  /**
   * (fun round, WP3) Steal-chance marker (string `hud.moment.stealChance` "빼내기 +{value}",
   * defined by WP4): one door glow + label at `doorPos`, fed every tick from
   * `MomentTracker.snapshot().stealChance`. `null` clears it. At most one marker. Idempotent.
   */
  setStealChance(doorPos: Vec2 | null, value: number): void {
    if (!doorPos || !Number.isFinite(doorPos.x) || !Number.isFinite(doorPos.y)) {
      if (this.stealPos) {
        this.stealPos = null;
        this.stealLabel.hide();
      }
      return;
    }
    const v = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
    if (!this.stealPos) this.stealPos = { x: doorPos.x, y: doorPos.y };
    else {
      this.stealPos.x = doorPos.x;
      this.stealPos.y = doorPos.y;
    }
    if (v !== this.stealValue || !this.stealLabel.shown) {
      this.stealValue = v;
      this.stealLabel.set(this.beatText('hud.moment.stealChance', { value: v.toLocaleString('en-US') }), 'steal');
    }
  }

  /**
   * (fun round, WP3) Results-stage poses: the rival plays its taunt when it won ('taunt') or
   * slumps when it lost ('slump'); the player's chosen victory taunt plays on a win (`null` =
   * none). Call after setMode('results') (a mode change clears it). Until game flow calls it,
   * the stage plays the defaults from the result it shows (fun-plan WP3): the rival taunts when
   * its team won and slumps when it lost, the player's pose on a win is `wiggle`; a draw keeps
   * the plain stage (resultsPosesNow).
   */
  setResultsPoses(poses: { rival: 'taunt' | 'slump'; player: EmoteId | null }): void {
    if (!poses) return;
    this.resultsPoseStart = this.time;
    this.resultsPoses = { rival: poses.rival === 'taunt' ? 'taunt' : 'slump', player: poses.player && Object.prototype.hasOwnProperty.call(EMOTE.durationTicks, poses.player) ? poses.player : null };
  }

  /**
   * (fun round, WP3) Bot dash wind-up telegraph (crouch + spark ring at the feet), fed every tick
   * from `BotIntent.phase === 'windup'` (+ `windupTargetId`). `null` = not winding up. Edge-
   * detected internally, like setBotTelegraph.
   */
  setBotWindup(charId: EntityId, windup: { targetId: EntityId | null } | null): void {
    let w = this.windupOf(charId);
    if (!windup) {
      if (w) w.start = -1;
      return;
    }
    if ((w && w.start >= 0) || !this.chars.has(charId)) return;
    if (!w) {
      w = { id: charId, start: -1, ring: new WindupRing() };
      this.beatRoot.add(w.ring.mesh);
      this.windupList.push(w);
    }
    w.start = this.time;
  }

  /** Wind-up record of a character (null = never wound up this match). */
  private windupOf(id: EntityId): { id: EntityId; start: number; ring: WindupRing } | null {
    for (let i = 0; i < this.windupList.length; i++) if (this.windupList[i]!.id === id) return this.windupList[i]!;
    return null;
  }

  /**
   * (fun round, WP3) Bark bubble (text only) over a bot, from `BotIntent.bark` (WP2). Called once
   * per new bark (match.ts edge-detects `BotBark.tick`). `text` is already translated
   * (`t('taunt.bark.' + key)`, keys defined by WP2). Hidden when showOthersTaunts is false, like
   * taunt bubbles.
   */
  showBark(charId: EntityId, text: string, seconds?: number): void {
    if (this.disposed || !this.chars.has(charId) || typeof text !== 'string' || !text.trim()) return;
    if (!this.tauntShown(charId)) return;
    let rec: { id: EntityId; bubble: BarkBubble } | null = null;
    for (const r of this.barkList) if (r.id === charId) rec = r;
    if (!rec) {
      rec = { id: charId, bubble: new BarkBubble() };
      this.beatRoot.add(rec.bubble.sprite);
      this.barkList.push(rec);
    }
    rec.bubble.show(text, seconds ?? BEATS.bark.seconds);
  }

  /**
   * (fun round, WP3) Story beats from MomentTracker, once per tick (possibly []). The view owns
   * the render-only reactions here: "!?" sweat mood (moods.ts) on the team that lost the lead
   * (`leadTaken`: the other team) or had its run broken (`streakBroken`), the `impactAt` pulse on
   * `bigPlay` (and the content big plays: jackpot / craneDrop), small flourishes on stamps.
   * Camera glance and time scale are NOT done here (feel calls `glance`; match.ts owns
   * TimeScale). Moments are facts; never re-derive them here.
   */
  onMoments(moments: readonly Moment[]): void {
    const sim = this.sim;
    if (!sim || !moments.length || this.viewMode !== 'match') return;
    const fx = this.effects.fx;
    for (const m of moments) {
      const other = (m.team === 0 ? 1 : 0) as TeamId;
      const at = m.pos ?? null;
      switch (m.kind) {
        case 'leadTaken':
          this.moods.teamReact(sim, other, 'rattled', at);
          this.moods.teamReact(sim, m.team, 'pumped', at);
          break;
        case 'equalized':
          this.moods.teamReact(sim, m.team, 'pumped', at, 14);
          break;
        case 'streakBroken':
          this.moods.teamReact(sim, m.team, 'rattled', at);
          break;
        case 'matchPointStopped':
          // m.team = the team whose match point was stopped.
          this.moods.teamReact(sim, other, 'pumped', at);
          this.moods.teamReact(sim, m.team, 'rattled', at, 20);
          break;
        case 'bigPlay':
          if (at) this.impactAt(at, 0.8, 0.55);
          break;
        case 'jackpot':
        case 'craneDrop':
          if (at) this.impactAt(at, 0.65, 0.45);
          break;
        case 'goldHammer':
          if (at) fx.ring({ x: at.x, y: 0.05, z: at.y }, { radius: 2.6, color: '#FFD23F', duration: 0.55 });
          break;
        case 'tauntPunished':
        case 'dodged':
        case 'counterDash':
          if (at) fx.sparkle({ x: at.x, y: 1.0, z: at.y }, { count: 6, radius: 0.6, color: m.kind === 'dodged' ? '#7FC8FF' : '#FFD45E' });
          break;
        default:
          break;
      }
    }
  }

  /**
   * (fun round, WP3) Scoring-run heat: a subtle rim on `team`'s van while its run has a tier
   * (`MomentTracker.snapshot().run`); `team = null` or `tier = 0` clears it. Fed every tick;
   * idempotent. Tier 2 adds a few warm sparks over the roof (not with reduced motion).
   */
  setRunHeat(team: TeamId | null, tier: 0 | StreakTier): void {
    const on = (team === 0 || team === 1) && (tier === 1 || tier === 2);
    this.runHeat.team = on ? team : null;
    this.runHeat.tier = on ? tier : 0;
  }

  // --- [F3] beat internals ---------------------------------------------------------------------

  /** Bag-only decisive load: carriers resolved from matchPointInfo (refreshed at most 4x / s). */
  private bagFallbackAt = -1;

  private zoneOf(team: TeamId): LayoutDef['zones'][number] | null {
    const zs = this.layout?.zones;
    if (!zs) return null;
    for (let i = 0; i < zs.length; i++) if (zs[i]!.team === team) return zs[i]!;
    return null;
  }

  /** UI strings the beats print (pinned cross-package keys; WP4 defines them). */
  private beatText(key: 'beat.decisive.ours' | 'hud.mp.theirs' | 'hud.moment.stealChance', params?: Record<string, string>): string {
    const lang = this.settings.language ?? 'ko';
    let s: string = (lang === 'en' ? EN_STRINGS[key] : KO_STRINGS[key]) ?? KO_STRINGS[key] ?? key;
    if (params) for (const k in params) s = s.split(`{${k}}`).join(params[k]!);
    return s;
  }

  /**
   * Decisive-load world label: 'ours' = "승부 포인트!" (fun-plan WP3; the HUD prompt above already
   * says "이게 들어가면 끝!", so the world label names the spot instead of repeating it),
   * 'theirs' = "막아야 해!".
   */
  private decisiveText(side: 'ours' | 'theirs'): string {
    return this.beatText(side === 'ours' ? 'beat.decisive.ours' : 'hud.mp.theirs');
  }

  /**
   * Viewport + HUD rem for the beat labels. The HUD's root font size already holds the UI scale
   * (styles/tokens.css), so it is read from the document when there is one (resize, settings,
   * a label appearing); headless: the formula at UI scale 1.
   */
  private refreshLabelScreen(): void {
    let rem: number | undefined;
    try {
      if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
        const fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
        if (Number.isFinite(fs) && fs > 0) rem = fs;
      }
    } catch {
      rem = undefined;
    }
    this.labelScreen.setViewport(this.width, this.height, 1, rem);
  }

  /**
   * HUD world chip over a decisive loot load (WorldLabels / PropLabels, styles/hud*.css): its
   * anchor height (the same world point the HUD projects) and its size in rem, focus scale and
   * the bank breakdown line included. The label sits on top of it. Returns the anchor height.
   */
  private hudChipFor(id: EntityId, out: ChipSize): number {
    const l = this.sim?.getLoot(id);
    if (!l || l.kind === 'bank') {
      out.w = 17.5;
      out.h = 7;
      return BANK_MODEL.roofHeight + 1.2;
    }
    if (l.variant) {
      out.w = 16;
      out.h = 3.3;
      return PROP_SPECS[l.variant].height + 0.7;
    }
    out.w = 11;
    out.h = 3.2;
    return SAFE_SPECS[l.kind].height + 0.6;
  }

  /**
   * End-hold shot on the winners' van (playGetaway): the van's whole drive-off (tail at rest to
   * nose at the end of the roll) centred, with the player too when they share the frame at the
   * walking distance band; else the van alone at the walking distance.
   */
  private getawayFraming(z: LayoutDef['zones'][number], run: number): { x: number; y: number; dist: number } {
    const ca = Math.cos(z.vanAngle);
    const sa = Math.sin(z.vanAngle);
    const roll = run >= BEATS.getaway.minRun ? Math.min(run, BEATS.getaway.distance) : 0;
    const hx = VAN.half.x;
    const mid = { x: z.vanPos.x + ca * roll * 0.5, y: z.vanPos.y + sa * roll * 0.5, h: 1.2 };
    const nose = { x: z.vanPos.x + ca * (roll + hx), y: z.vanPos.y + sa * (roll + hx), h: VAN.height };
    const tail = { x: z.vanPos.x - ca * hx, y: z.vanPos.y - sa * hx, h: VAN.height };
    const aspect = this.width / Math.max(1, this.height);
    const fc = this.lastFocusId !== null ? this.chars.get(this.lastFocusId) : undefined;
    if (fc) {
      const both = this.fitNorth(mid, [nose, tail, { x: fc.pose.x, y: fc.pose.y, h: 1.0 }], mid.x, mid.y, aspect);
      if (both) return both;
    }
    return this.fitNorth(mid, [nose, tail], mid.x, mid.y, aspect) ?? { x: mid.x, y: mid.y, dist: MATCH_DIST.walk };
  }

  /** Stop the getaway and put the vans (and their siren glows) back at their parking spots. */
  private endGetaway(): void {
    this.getawayShot = null;
    if (!this.getaway) return;
    this.getaway = null;
    for (const van of this.vans) {
      if (!van) continue;
      van.setDepart(0);
      const z = this.zoneOf(van.team);
      if (z) this.glows[van.team]?.place(z.vanPos, z.vanAngle);
    }
  }

  /** Exhaust puff behind a van facing (ca, sa) (scratch options: no per-frame closure / literals). */
  private vanPuff(van: VanRig, ca: number, sa: number, n: number, size: number): void {
    van.exhaustPoint.getWorldPosition(_v3);
    _puffAt.x = _v3.x;
    _puffAt.y = _v3.y;
    _puffAt.z = _v3.z;
    _puffDir.x = -ca;
    _puffDir.z = -sa;
    _puffOpts.count = n;
    _puffOpts.size = size;
    this.effects.fx.dust(_puffAt, _puffOpts);
  }

  /**
   * Per-frame getaway for one van (match mode, end hold). Returns bit 1 = siren, bit 2 = engine.
   * Winner: honk (bounce + ring) and rev, then the ease-in-out roll with exhaust puffs and a
   * "슝!" as it pulls away; the siren glow follows the van. Draw: every van revs in place.
   */
  private getawayVan(van: VanRig, dt: number): number {
    const g = this.getaway;
    if (!g || this.viewMode !== 'match') return 0;
    const t = this.time - g.start;
    const prev = t - dt;
    const z = this.zoneOf(van.team);
    if (!z) return 0;
    const ca = Math.cos(z.vanAngle);
    const sa = Math.sin(z.vanAngle);
    const fx = this.effects.fx;
    const G = BEATS.getaway;
    if (g.team === null) {
      for (const r of G.drawRevs) {
        if (prev < r && t >= r) {
          van.bounce(0.55);
          this.vanPuff(van, ca, sa, 4, 0.32);
        }
      }
      return 2;
    }
    if (van.team !== g.team) return 0;
    if (!g.honked) {
      g.honked = true;
      van.bounce(1.1);
      fx.ring({ x: z.vanPos.x + ca * (VAN.half.x + 0.3), y: 0.9, z: z.vanPos.y + sa * (VAN.half.x + 0.3) }, { radius: 2.4, color: '#FFF6B0', duration: 0.4 });
      this.vanPuff(van, ca, sa, 5, 0.34);
    }
    const m = getawayDepart(t, g.run);
    if (prev <= G.revFor && t > G.revFor && g.run >= G.minRun) {
      this.effects.stamp('whoosh', { x: z.vanPos.x + ca * 1.2, y: z.vanPos.y + sa * 1.2 }, { y: 2.9, scale: 1.1 });
      van.bounce(0.6);
    }
    if (this.time >= g.nextPuff && t < G.revFor + G.driveFor + 0.2) {
      g.nextPuff = this.time + G.puffEvery;
      this.vanPuff(van, ca, sa, 2, 0.26);
    }
    van.setDepart(departParam(m));
    const glow = this.glows[van.team];
    if (glow) {
      _loc.x = z.vanPos.x + ca * m;
      _loc.y = z.vanPos.y + sa * m;
      glow.place(_loc, z.vanAngle);
    }
    return 3;
  }

  /** Scoring-run heat rim (+ tier-2 sparks) on the vans; nothing outside 'match'. */
  private updateRunHeat(dt: number): void {
    const heat = this.viewMode === 'match' ? this.runHeat : null;
    for (const van of this.vans) {
      if (!van) continue;
      const on = !!heat && heat.team === van.team && heat.tier > 0;
      const color = on ? (heat!.tier === 2 ? '#FF7A3D' : '#FFC24D') : null;
      if (color !== this.runHeatShown[van.team]) {
        this.runHeatShown[van.team] = color;
        van.setHighlight(color);
      }
      if (on && heat!.tier === 2 && !this.settings.reducedMotion && dt > 0 && this.time >= this.nextHeatSpark) {
        this.nextHeatSpark = this.time + 0.45;
        const z = this.zoneOf(van.team);
        if (z) this.effects.fx.sparkle({ x: z.vanPos.x, y: VAN.height + 0.5, z: z.vanPos.y }, { count: 3, radius: 0.9, color: '#FFB13D' });
      }
    }
  }

  /** Ground-ring radius for a loot id (0 = not a live loot view). */
  private loadRadius(id: EntityId): number {
    const bv = this.banks.get(id);
    if (bv) return bv.done ? 0 : BANK_METER_RADIUS + 0.35;
    const sv = this.safes.get(id);
    if (!sv || sv.done) return 0;
    const fp = (sv.rig as Partial<PropRig>).footprint;
    const h = fp ?? SAFE_SPECS[sv.kind].half;
    return Math.hypot(h.x, h.y) + 0.45;
  }

  /** Per-frame world beats: decisive load, steal marker, wind-up rings, bark bubbles. */
  private updateBeats(sim: Simulation, dt: number): void {
    const match = this.viewMode === 'match';
    const calm = this.settings.reducedMotion;
    const cam = this.cam.camera;
    // --- decisive load ---------------------------------------------------------------------
    const side = match ? this.decisiveSide : null;
    let lootId: EntityId | null = null;
    this.bagIds.length = 0;
    this.decisiveHl = null;
    if (side) {
      for (let i = 0; i < this.decisiveIds.length; i++) {
        const id = this.decisiveIds[i]!;
        if (lootId === null && this.loadRadius(id) > 0) lootId = id;
        else if (this.chars.has(id) && !this.bagIds.includes(id)) this.bagIds.push(id);
      }
      if (lootId === null && !this.bagIds.length) {
        if (this.bagFallbackAt < 0 || this.time - this.bagFallbackAt > 0.25) {
          this.bagFallbackAt = this.time;
          this.bagFallback.length = 0;
          const mp = matchPointInfo(sim.state, { earlyDecision: sim.rules.earlyDecision });
          if (mp && mp.bagCharIds) for (const id of mp.bagCharIds) this.bagFallback.push(id);
        }
        for (let i = 0; i < this.bagFallback.length; i++) if (this.chars.has(this.bagFallback[i]!)) this.bagIds.push(this.bagFallback[i]!);
      }
    }
    const color = side === 'theirs' ? '#FF5A5F' : '#FFD23F';
    let labelX = 0;
    let labelH = 0;
    let labelZ = 0;
    let labelOn = false;
    let chip: ChipSize | null = null;
    const screen = this.labelScreen;
    screen.clearExtras();
    if (lootId !== null) {
      const bv = this.banks.get(lootId);
      const pose = bv ? bv.pose : this.safes.get(lootId)!.pose;
      const floor = bv ? 0 : this.safes.get(lootId)!.y;
      this.decisiveRing.setColor(color);
      this.decisiveRing.update(true, pose.x, floor, pose.y, this.loadRadius(lootId), dt, side === 'theirs' ? 1.6 : 1.1, calm);
      labelX = pose.x;
      labelZ = pose.y;
      // On top of the HUD's own world chip over the load (same anchor point the HUD projects).
      labelH = this.hudChipFor(lootId, this.decisiveChip);
      chip = this.decisiveChip;
      labelOn = true;
      // A load dwelling in a zone also wears the HUD recovery ring higher up: keep clear of it.
      const l = sim.getLoot(lootId);
      if (l?.recovery) {
        const rh = bv ? BANK_MODEL.roofHeight + 3.4 : (l.variant ? PROP_SPECS[l.variant].height : SAFE_SPECS[l.kind as 'smallSafe'].height) + 1.8;
        _v3.set(pose.x, rh, pose.y).project(cam);
        if (_v3.z < 1) {
          const rx = ((_v3.x + 1) / 2) * screen.w;
          const ry = ((1 - _v3.y) / 2) * screen.h;
          const rr = 2.1 * screen.rem;
          screen.addExtra(rx - rr, ry - 2 * rr, rx + rr, ry);
        }
      }
      this.decisiveHlRec.id = lootId;
      this.decisiveHlRec.color = color;
      this.decisiveHl = this.decisiveHlRec;
    } else this.decisiveRing.update(false, 0, 0, 0, 1, dt, 1, calm);
    // bag carriers: one ring each; the label goes over the first one when no loot carries it
    while (this.bagRings.length < this.bagIds.length) {
      const r = new PulseRing('bagRing');
      this.beatRoot.add(r.root);
      this.bagRings.push(r);
    }
    for (let i = 0; i < this.bagRings.length; i++) {
      const id = i < this.bagIds.length ? this.bagIds[i]! : null;
      const cv = id !== null ? this.chars.get(id) : undefined;
      const ring = this.bagRings[i]!;
      if (!cv) {
        ring.update(false, 0, 0, 0, 1, dt, 1, calm);
        continue;
      }
      ring.setColor(color);
      ring.update(true, cv.pose.x, cv.y, cv.pose.y, 1.0, dt, side === 'theirs' ? 1.6 : 1.1, calm);
      if (!labelOn) {
        labelX = cv.pose.x;
        labelZ = cv.pose.y;
        labelOn = true;
        // over the HUD name tag (shown with more than two raccoons, adapters.ts: 2.3 m)
        if (sim.state.characters.length > 2) {
          labelH = 2.3;
          this.decisiveChip.w = 9;
          this.decisiveChip.h = 1.9;
          chip = this.decisiveChip;
        } else labelH = cv.y + RACCOON_LABEL_HEIGHT + 0.75;
      }
    }
    if (labelOn && side) this.decisiveLabel.place(labelX, labelH, labelZ, cam, dt, calm ? 0 : 0.5 + 0.5 * Math.sin(this.time * (side === 'theirs' ? 9 : 6)), screen, chip);
    else this.decisiveLabel.sprite.visible = false;
    // --- steal chance ------------------------------------------------------------------------
    const sp = match ? this.stealPos : null;
    if (sp) {
      this.stealRing.setColor('#7FE0B4');
      this.stealRing.update(true, sp.x, 0, sp.y, 1.7, dt, 1.4, calm);
      // clear of the decisive label too (both can be up at once)
      screen.clearExtras();
      const d = this.decisiveLabel.sprite.visible ? this.decisiveLabel.rect : null;
      if (d) screen.addExtra(d.x0, d.y0, d.x1, d.y1);
      this.stealLabel.place(sp.x, 2.5, sp.y, cam, dt, calm ? 0 : 0.5 + 0.5 * Math.sin(this.time * 5), screen, null);
    } else {
      this.stealRing.update(false, 0, 0, 0, 1, dt, 1, calm);
      this.stealLabel.sprite.visible = false;
    }
    // --- wind-up rings -----------------------------------------------------------------------
    for (let i = 0; i < this.windupList.length; i++) {
      const w = this.windupList[i]!;
      const cv = this.chars.get(w.id);
      if (!match || w.start < 0 || !cv) w.ring.update(null, 0, 0, 0, dt, calm);
      else w.ring.update(this.time - w.start, cv.pose.x, cv.y, cv.pose.y, dt, calm);
    }
    // --- bark bubbles ------------------------------------------------------------------------
    for (let i = 0; i < this.barkList.length; i++) {
      const { id, bubble } = this.barkList[i]!;
      if (!bubble.shown) continue;
      if (!match || !this.tauntShown(id) || !this.emoteAnchor(id, _v3)) {
        bubble.hide();
        continue;
      }
      bubble.update(_v3.x, _v3.y + 1.05, _v3.z, dt, calm);
    }
  }

  private readonly bagFallback: EntityId[] = [];

  /** Free the per-match beat visuals (rings per character, barks) and reset every beat. */
  private resetBeats(): void {
    this.glanceT.clear();
    this.getaway = null;
    this.getawayShot = null;
    this.decisiveIds.length = 0;
    this.decisiveSide = null;
    this.decisiveLabel.hide();
    this.decisiveHl = null;
    this.bagFallback.length = 0;
    this.bagFallbackAt = -1;
    this.stealPos = null;
    this.stealLabel.hide();
    this.runHeat.team = null;
    this.runHeat.tier = 0;
    this.runHeatShown[0] = this.runHeatShown[1] = null;
    for (const w of this.windupList) w.ring.dispose();
    this.windupList.length = 0;
    for (const b of this.barkList) b.bubble.dispose();
    this.barkList.length = 0;
    for (const r of this.bagRings) r.dispose();
    this.bagRings.length = 0;
    this.decisiveRing.update(false, 0, 0, 0, 1, 1, 1, true);
    this.stealRing.update(false, 0, 0, 0, 1, 1, 1, true);
    this.resultsPoses = null;
  }

  /** Taunt the rival plays on the results stage (its signature taunt). */
  private static rivalTaunt(rival: string | null | undefined): EmoteId | null {
    return rival === 'hodadak' ? 'hodadakZoom' : rival === 'tongkeun' ? 'tongkeunFlex' : rival === 'nunchi' ? 'nunchiShrug' : null;
  }

  applySettings(s: ViewSettings): void {
    const prev = this.settings;
    this.settings = { ...s, showOthersTaunts: s.showOthersTaunts ?? prev.showOthersTaunts };
    if (prev.showOthersTaunts !== false && this.settings.showOthersTaunts === false) {
      // Hide the bubbles of taunts already playing (the poses stop on the next frame).
      for (const id of this.chars.keys()) {
        if (id === this.lastFocusId) continue;
        const cur = this.taunts.current(id);
        if (cur) this.emotes.hide(id, TAUNT_BUBBLE[cur]);
      }
    } else if (prev.showOthersTaunts === false && this.settings.showOthersTaunts !== false && (this.viewMode === 'match' || this.viewMode === 'preview')) {
      // Back on mid-taunt: the poses resume on the next frame; bring their bubbles back too,
      // for the time the taunt has left.
      const tick = this.sim?.state.tick ?? 0;
      for (const id of this.chars.keys()) {
        if (id === this.lastFocusId) continue;
        const cur = this.taunts.playing(id);
        if (!cur || cur.endTick <= tick) continue;
        this.emotes.show(id, TAUNT_BUBBLE[cur.id], { duration: (cur.endTick - tick) / TICK_RATE + 0.15, priority: 3, scale: 1.22, clear: TAUNT_BUBBLE_CLEAR });
      }
    }
    const next = qualityPreset(s.quality);
    const old = this.preset;
    this.preset = next;
    if (next.antialias !== old.antialias) {
      this.createRenderer();
      this.post.setRenderer(this.renderer);
      this.resize();
    }
    this.post.setQuality(next, s.reducedMotion);
    this.post.setReducedMotion(s.reducedMotion);
    if (next !== old) {
      this.effects.setQuality(next);
      this.uproot.setQuality(next);
      this.applyQualityToScene();
      this.resize();
      for (const cv of this.chars.values()) cv.rig.setBlobShadow(next.blobShadows);
      if (this.layout && (next.decorDensity !== this.sceneryDecor || next.groundDetail !== old.groundDetail || next.shopInteriors !== old.shopInteriors)) this.buildScenery();
    }
    const langChanged = (prev.language ?? 'ko') !== (s.language ?? 'ko') || prev.signResolver !== s.signResolver;
    if (langChanged && this.scenery) this.scenery.setSignResolver(this.signResolver());
    if (langChanged) {
      // [F3] beat labels follow the language
      if (this.decisiveSide) this.decisiveLabel.set(this.decisiveText(this.decisiveSide), this.decisiveSide);
      if (this.stealPos) this.stealLabel.set(this.beatText('hud.moment.stealChance', { value: this.stealValue.toLocaleString('en-US') }), 'steal');
    }
    this.refreshLabelScreen(); // [F3] UI scale may have changed the HUD rem
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
    if (s.reducedMotion) {
      this.cam.shake(-1);
      this.glanceT.clear(); // [F3]
    }
  }

  resize(): void {
    const w = Math.max(1, Math.round(this.container.clientWidth || this.container.getBoundingClientRect().width || 1));
    const h = Math.max(1, Math.round(this.container.clientHeight || this.container.getBoundingClientRect().height || 1));
    this.width = w;
    this.height = h;
    this.refreshLabelScreen(); // [F3]
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.renderer.setPixelRatio(Math.min(dpr, this.preset.maxPixelRatio));
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
    this.cam.setAspect(w / h);
    this.markers.setSize(w, h);
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
      contextLost: this.contextLost,
      sceneDrawCalls: this.post.active ? this.post.sceneCalls : info.render.calls,
      post: this.post.active,
      emotes: this.emotes.activeCount,
      // [F3] what is on screen: the results stage hides every officer / car
      officers: this.viewMode === 'results' ? 0 : this.police.stats.officers,
      cars: this.viewMode === 'results' ? 0 : this.police.stats.cars,
      markers: this.markers.count,
    };
  }

  /** Free everything (renderer, scene, caches). Pass keepModelCaches if other views remain. */
  dispose(opts: { keepModelCaches?: boolean } = {}): void {
    if (this.disposed) return;
    this.unload();
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.effects.dispose();
    this.uproot.dispose();
    this.police.dispose();
    this.emotes.dispose();
    this.markers.dispose();
    this.banners.dispose();
    // [F3] beat visuals (per-match ones went with unload())
    this.decisiveRing.dispose();
    this.stealRing.dispose();
    this.decisiveLabel.dispose();
    this.stealLabel.dispose();
    this.beatRoot.removeFromParent();
    this.post.dispose();
    this.pigeons.dispose();
    this.lights.dispose();
    setOcclusionFocus(null, null);
    this.scene.clear();
    GameView.releaseRenderer(this.renderer);
    this.renderer.domElement.remove();
    if (!opts.keepModelCaches) disposeModelCaches();
  }

  /**
   * Free a renderer AND its WebGL context. renderer.dispose() alone leaves the context alive
   * until GC, and Chromium/Electron drop the *oldest* live context after ~16 — which would be a
   * long-lived view after enough rematches or quality toggles.
   */
  private static releaseRenderer(r: THREE.WebGLRenderer): void {
    r.renderLists.dispose();
    r.dispose();
    try {
      r.forceContextLoss();
    } catch {
      /* extension missing: GC will reclaim the context */
    }
  }

  // ===========================================================================
  // Setup helpers
  // ===========================================================================

  /**
   * (Re)create the WebGL renderer. An MSAA change needs a new canvas (context attributes are
   * fixed per canvas): the new canvas takes the old one's place in the container (same DOM
   * position, same id/class) and a 'gameviewcanvas' CustomEvent ({ detail: { canvas, previous } })
   * is dispatched on the container. Game flow / HUD should bind pointer listeners to the
   * container (or re-bind on that event).
   */
  private createRenderer(): void {
    const old = this.renderer as THREE.WebGLRenderer | undefined;
    const r = new THREE.WebGLRenderer({ antialias: this.preset.antialias, powerPreference: 'high-performance', alpha: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.applyToneMapping(r);
    r.shadowMap.enabled = this.preset.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    // Reset manually per frame (draw()) so post-processing passes add up in stats().
    r.info.autoReset = false;
    const c = r.domElement;
    c.style.display = 'block';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.touchAction = 'none';
    c.setAttribute('aria-hidden', 'true');
    // three.js itself preventDefault()s the loss and restores its GL state on 'restored';
    // the flag only reports it (stats()). Ignore the loss we force on a replaced canvas.
    c.addEventListener('webglcontextlost', () => {
      if (this.renderer?.domElement === c && !this.disposed) this.contextLost = true;
    });
    c.addEventListener('webglcontextrestored', () => {
      if (this.renderer?.domElement === c) this.contextLost = false;
    });
    if (old) {
      const prev = old.domElement;
      if (prev.id) c.id = prev.id;
      if (prev.className) c.className = prev.className;
      if (prev.parentNode === this.container) prev.replaceWith(c);
      else this.container.appendChild(c);
      GameView.releaseRenderer(old);
      this.renderer = r;
      this.container.dispatchEvent(new CustomEvent('gameviewcanvas', { detail: { canvas: c, previous: prev } }));
      return;
    }
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
    this.scenery = buildStaticScenery(this.layout, this.signResolver(), { decorDensity: density, groundDetail: this.preset.groundDetail, shopInteriors: this.preset.shopInteriors });
    this.sceneryDecor = density;
    this.world.add(this.scenery.root);
  }

  private unload(): void {
    for (const x of this.extras) x.dispose();
    this.extras = [];
    this.resetBeats(); // [F3]
    this.effects.clear();
    this.uproot.clear();
    this.police.clear();
    this.banners.clear();
    this.moods.reset();
    this.taunts.clear();
    clearShockwaves();
    this.callouts.length = 0;
    this.alarmLevel = 0;
    this.post?.setAlarm(0);
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
    this.botTelegraph.clear();
    this.pigeons.reset([], 1);
    this.pulses.clear();
    this.hitstop = 0;
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
    this.moods.onEvent(e, sim);
    this.police.onEvent(e, sim);
    if (e.type === 'emote' || e.type === 'emoteCancel') this.taunts.onEvent(e);
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
        const a = sim.getCharacter(e.attackerId);
        const dir = a ? { x: v.pos.x - a.pos.x, y: v.pos.y - a.pos.y } : { x: 0, y: 0 };
        const involved = e.victimId === this.lastFocusId || e.attackerId === this.lastFocusId;
        if (e.knockdown) {
          this.effects.knockdown(v.pos, cv?.y ?? 0);
          this.pigeons.scare(v.pos, 5);
          this.effects.fx.ring({ x: v.pos.x, y: (cv?.y ?? 0) + 0.05, z: v.pos.y }, { radius: 1.4, color: '#FFFFFF', duration: 0.25 });
          if (cv) cv.flashUntil = this.time + 0.09;
          if (e.victimId === this.lastFocusId) this.cam.shake(0.5);
          else if (e.attackerId === this.lastFocusId) this.cam.shake(0.22);
          if (involved) {
            this.cam.punch(dir, 0.35);
            this.hitstop = Math.max(this.hitstop, 0.07);
            this.impactAt(v.pos, 0.85, 0.6);
          }
        } else {
          this.effects.bump(v.pos, 0.6, cv?.y ?? 0);
          if (involved) this.cam.punch(dir, 0.15);
        }
        this.pulse(e.victimId, 0.12);
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
        // The choreography (explosion, roots snapping, shockwave, crater) lives in uproot.ts.
        this.uproot.pop(l.id, sim);
        if (l.kind === 'bank') {
          const bv = this.banks.get(l.id);
          if (bv) this.uprootBank(bv, true);
          const near = nearFactor(l.pos, 26);
          this.cam.zoomPunch(0.06 * near);
          if (near > 0.3) this.hitstop = Math.max(this.hitstop, 0.12);
        } else {
          const sv = this.safes.get(l.id);
          if (sv) {
            sv.rig.setAnchored(false);
            sv.anchored = false;
          }
          this.pulse(l.id, 0.12);
          if (l.kind === 'largeSafe' && nearFactor(l.pos, 10) > 0.4) this.hitstop = Math.max(this.hitstop, 0.05);
        }
        const sp = this.project(l.pos, l.kind === 'bank' ? 4.5 : 1.6);
        if (this.settings.builtinCallouts !== false && this.viewMode === 'match') {
          const top = (this.lootPose(l.id)?.h ?? 0) + (l.kind === 'bank' ? 5.6 : l.kind === 'largeSafe' ? 2.3 : 1.7);
          this.banners.show(l.pos.x, top, l.pos.y, l.kind, this.settings.language ?? 'ko');
        }
        this.pushCallout({ type: 'uproot', lootId: l.id, kind: l.kind, byTeam: e.byTeam, value: l.estimatedValue, pos: { x: l.pos.x, y: l.pos.y }, screen: { x: sp.x, y: sp.y, onScreen: sp.onScreen } });
        break;
      }
      case 'alarm': {
        const b = sim.getLoot(e.bankId);
        if (b) this.pushCallout({ type: 'alarm', bankId: e.bankId, pos: { x: b.pos.x, y: b.pos.y } });
        break;
      }
      case 'policeArrived':
        this.pushCallout({ type: 'policeArrived', carId: e.carId, pos: { ...e.pos } });
        break;
      case 'policeTackle': {
        const v = sim.getCharacter(e.victimId);
        if (v) this.pushCallout({ type: 'tackle', officerId: e.officerId, victimId: e.victimId, hit: e.hit, pos: { x: v.pos.x, y: v.pos.y } });
        if (e.hit) {
          const cv = this.chars.get(e.victimId);
          if (cv) cv.flashUntil = this.time + 0.09;
          this.pulse(e.victimId, 0.14);
          if (e.victimId === this.lastFocusId) this.hitstop = Math.max(this.hitstop, 0.08);
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
        this.pigeons.scare(e.pos, 11);
        const nf = nearFactor(e.pos, 24);
        this.cam.shake(0.5 * nf + 0.05);
        if (bank) this.cam.punch(bank.vel, 0.4 * nf);
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
        if (e.kind === 'bank') {
          this.cam.zoomPunch(0.09);
          this.hitstop = Math.max(this.hitstop, 0.15);
        } else if (e.kind === 'largeSafe') this.cam.zoomPunch(0.03);
        break;
      case 'grab': {
        // The hands "snap" on: tiny squash on the raccoon and the grabbed safe.
        this.pulse(e.charId, 0.1);
        if (e.part === 'safe') this.pulse(e.targetId, 0.08);
        else this.banks.get(e.targetId)?.rig.wobbleSign(0.4);
        break;
      }
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

  // ===========================================================================
  // Presentation helpers (uproot / police / emotes hosts)
  // ===========================================================================

  private pushCallout(c: ViewCallout): void {
    if (this.callouts.length >= 64) this.callouts.shift();
    this.callouts.push(c);
    try {
      this.onCallout?.(c);
    } catch (err) {
      console.warn('[GameView] onCallout handler failed', err);
    }
  }

  /** [C7a] What the Content 2.0 extras may read / request from the view (extras.ts). */
  private extrasHost(sim: Simulation): ViewExtrasHost {
    return {
      world: this.world,
      effects: this.effects,
      sim,
      time: () => this.time,
      preset: () => this.preset,
      reducedMotion: () => this.settings.reducedMotion,
      language: () => this.settings.language ?? 'ko',
      mode: () => this.viewMode,
      focusId: () => this.lastFocusId,
      charRig: (id) => this.chars.get(id)?.rig ?? null,
      charPose: (id) => {
        const cv = this.chars.get(id);
        return cv ? { x: cv.pose.x, y: cv.pose.y, a: cv.facing, h: cv.y } : null;
      },
      lootRig: (id) => {
        const sv = this.safes.get(id);
        return sv && !sv.done ? sv.rig : null;
      },
      lootPose: (id) => this.lootPose(id),
      officerPos: (id) => this.police.officerPos(id),
      officerRoot: (id) => {
        // The officer rig standing at that officer's pose (PoliceView keeps its map private).
        const p = this.police.officerPos(id);
        if (!p) return null;
        let best: THREE.Object3D | null = null;
        let bd = 0.6 * 0.6;
        for (const o of this.police.root.children) {
          if (o.name !== 'officer') continue;
          const d = (o.position.x - p.x) ** 2 + (o.position.z - p.y) ** 2;
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        return best;
      },
      hitstop: (s) => {
        if (s > 0 && this.viewMode === 'match') this.hitstop = Math.max(this.hitstop, s);
      },
      shake: (at, amount, radius) => this.cam.shake(amount * this.nearFactorAt(at, radius)),
      punch: (dir, strength) => {
        if (!this.settings.reducedMotion) this.cam.punch(dir, strength);
      },
      impact: (at, strength, chroma) => this.impactAt(at, strength, chroma),
      pulse: (id, amp) => this.pulse(id, amp),
      scare: (at, r) => this.pigeons.scare(at, r),
      nearFocus: (at, radius) => {
        const f = this.focusPos();
        return f ? Math.max(0, 1 - Math.hypot(at.x - f.x, at.y - f.y) / radius) : 0;
      },
    };
  }

  /** 0..1 closeness of a sim point to the focus character (0.5 without a focus). */
  private nearFactorAt(p: Vec2, radius: number): number {
    const f = this.focusPos();
    if (!f) return 0.5;
    return Math.max(0, 1 - Math.hypot(p.x - f.x, p.y - f.y) / radius);
  }

  /** Impact frame (post) centered on a sim point + chromatic kick, scaled by closeness. */
  private impactAt(p: Vec2, strength: number, chroma: number): void {
    if (this.settings.reducedMotion || this.viewMode !== 'match') return;
    // Screen flashes are scaled by the screen-shake setting too (0 = none at all).
    const shake = Math.min(1, Math.max(0, this.settings.screenShake));
    if (shake <= 0) return;
    const near = this.nearFactorAt(p, 26);
    const s = strength * (0.35 + 0.65 * near) * shake;
    if (s < 0.08) return;
    const sp = this.project(p, 0.8);
    this.post.impact({ center: { x: sp.x / Math.max(1, this.width), y: 1 - sp.y / Math.max(1, this.height) }, strength: s, chroma: chroma * near * shake });
  }

  /** Interpolated loot pose + floor height (uproot host); banks report their floor. */
  private lootPose(id: EntityId): LootPose | null {
    const bv = this.banks.get(id);
    if (bv) {
      if (bv.done) return null;
      return { x: bv.pose.x, y: bv.pose.y, a: bv.pose.a, h: bv.rig.floorY };
    }
    const sv = this.safes.get(id);
    if (sv) {
      if (sv.done) return null;
      return { x: sv.pose.x, y: sv.pose.y, a: sv.pose.a, h: sv.y };
    }
    return null;
  }

  /** Extra hop of a bank floor (pop / strain lift) for riders and loaded safes. */
  private floorLift(bankId: EntityId | null): number {
    if (bankId === null) return 0;
    const bv = this.banks.get(bankId);
    return bv && !bv.done ? bv.rig.floorY - BANK_FLOOR_Y : 0;
  }

  private onUprootStage(id: EntityId, kind: LootKind, stage: number): void {
    const bv = kind === 'bank' ? this.banks.get(id) : undefined;
    const p = this.lootPose(id);
    if (bv) {
      bv.rig.wobbleSign(0.8 + stage * 0.6);
      if (stage >= 2 && p) this.pigeons.scare({ x: p.x, y: p.y }, 9 + stage * 3);
      if (stage >= 3) bv.rig.clangBell(0.8);
    }
    if (stage >= 2) this.pulse(id, kind === 'smallSafe' ? 0.06 : 0.04);
  }

  private pulse(id: EntityId, amp: number): void {
    if (this.settings.reducedMotion) amp *= 0.4;
    this.pulses.set(id, { start: this.time, amp });
  }

  /** Current snap-pulse scale (1 = none): quick squash that rebounds over ~0.18 s. */
  private pulseScale(id: EntityId): number {
    const p = this.pulses.get(id);
    if (!p) return 1;
    const k = (this.time - p.start) / 0.18;
    if (k >= 1 || k < 0) {
      this.pulses.delete(id);
      return 1;
    }
    return 1 - p.amp * Math.sin(Math.PI * k) * (1 - k);
  }

  /** Pigeon hangouts: in front of benches and by flower beds, on free ground. */
  private pigeonSpots(sim: Simulation): Vec2[] {
    const out: Vec2[] = [];
    const max = this.preset.particles >= 0.8 ? 7 : 4;
    const ok = (p: Vec2): boolean =>
      p.x > 1 && p.y > 1 && p.x < sim.layout.size.x - 1 && p.y < sim.layout.size.y - 1 && sim.isFree(p, 0.9) && out.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 6);
    for (const st of sim.layout.statics) {
      if (out.length >= max) break;
      if (st.kind !== 'bench') continue;
      // front of the bench = local -y side (either side works; pick the free one)
      for (const side of [1, -1]) {
        const lx = 0;
        const ly = side * (st.half.y + 1.3);
        const p = { x: st.center.x + lx * Math.cos(st.angle) - ly * Math.sin(st.angle), y: st.center.y + lx * Math.sin(st.angle) + ly * Math.cos(st.angle) };
        if (ok(p)) {
          out.push(p);
          break;
        }
      }
    }
    for (const d of sim.layout.decor) {
      if (out.length >= max) break;
      if (d.kind !== 'flowers' && d.kind !== 'puddle') continue;
      const p = { x: d.pos.x + 1.1, y: d.pos.y + 0.8 };
      if (ok(p)) out.push(p);
    }
    return out;
  }

  private updatePigeons(sim: Simulation, dt: number): void {
    const th = this.threats;
    th.length = 0;
    if (this.viewMode === 'match' || this.viewMode === 'title') {
      for (const c of sim.state.characters) {
        const cv = this.chars.get(c.id);
        if (!cv) continue;
        const sp = Math.hypot(c.vel.x, c.vel.y);
        if (c.dashTicks > 0) th.push({ x: cv.pose.x, y: cv.pose.y, radius: 4 });
        else if (sp > 1.2) th.push({ x: cv.pose.x, y: cv.pose.y, radius: 2.6 });
      }
      for (const bv of this.banks.values()) {
        if (bv.done || !bv.uprooted) continue;
        const l = sim.getLoot(bv.id);
        if (l && Math.hypot(l.vel.x, l.vel.y) > 0.15) th.push({ x: bv.pose.x, y: bv.pose.y, radius: 7.5 });
      }
    }
    this.pigeons.update(dt, th);
  }

  private uprootBank(bv: BankView, animate: boolean): void {
    if (bv.uprooted) return;
    bv.uprooted = true;
    bv.rig.setUprooted(true);
    if (!animate) bv.rig.update(1); // settle the pop when loading mid-match
    const scar = createBankScar();
    placeOnSim(scar, bv.home.pos, bv.home.angle, 0.002);
    // Flattened under the slab until the bank has moved off its old site (clods would poke
    // through the floor otherwise), then the torn-up patch rises into view.
    bv.scarRise = SCAR_FLAT;
    scar.scale.y = SCAR_FLAT;
    this.world.add(scar);
    bv.scar = scar;
  }

  // ===========================================================================
  // Per-frame entity updates
  // ===========================================================================

  private updateScar(bv: BankView, dt: number): void {
    const scar = bv.scar;
    if (!scar) return;
    const overlap = !bv.done && rectsOverlap(bv.pose, bv.pose.a, bv.home.pos, bv.home.angle, SCAR_HALF);
    const target = overlap ? SCAR_FLAT : 1;
    bv.scarRise += (target - bv.scarRise) * damp(overlap ? 30 : 4, dt);
    if (this.snapVisuals) bv.scarRise = target;
    scar.scale.y = bv.scarRise;
  }

  private updateBank(bv: BankView, sim: Simulation, alpha: number, dt: number): void {
    const l = sim.getLoot(bv.id);
    if (!l) return;
    this.updateScar(bv, dt);
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
    // Strain / lift while someone pulls the anchored bank (uproot.ts), alarm while it rings.
    bv.rig.setStrain(this.uproot.strainOf(bv.id));
    bv.rig.setLift(this.uproot.liftOf(bv.id));
    bv.rig.setAlarm(sim.state.alarm.ringing.includes(bv.id) && this.viewMode !== 'title');
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
    if (this.snapVisuals) sv.y = targetY;
    placeOnSim(sv.rig.root, sv.pose, sv.pose.a + sv.yawFix, sv.y + this.floorLift(l.floorOf));
    const ps = this.pulseScale(sv.id);
    sv.rig.root.scale.set(2 - ps, ps, 2 - ps);
    if (sv.anchored !== l.anchored) {
      sv.anchored = l.anchored;
      sv.rig.setAnchored(l.anchored);
    }
    sv.rig.setStrain(this.uproot.strainOf(sv.id));
    sv.rig.setLift(this.uproot.liftOf(sv.id));
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
      this.updateStagedChar(cv, spot, dt, c);
      return;
    }

    this.poses.sample(c.id, alpha, cv.pose, { pos: c.pos, angle: c.facing });
    const look = cv.rig.look;
    if (look.hat !== c.look.hat || (look.rival ?? null) !== (c.look.rival ?? null) || look.furTint !== c.look.furTint) cv.rig.setLook(c.look);
    // Taunt (owner addition): animation + facing toward (or, for the wiggle, away from) the rival.
    pose.taunt = null;
    let faceTo = cv.pose.a;
    let turnRate = 22;
    if (mode === 'match' || mode === 'preview') {
      const tv = this.taunts.update(c, sim.state.tick - 1 + alpha, this.tauntWorld);
      if (tv && this.tauntShown(c.id)) {
        pose.taunt = { id: tv.id, t: tv.t, dur: tv.dur };
        if (tv.facing !== null) {
          faceTo = tv.facing;
          turnRate = 11;
        }
        cv.tauntTurn = 0.45;
        // The zoom sprint kicks up dust behind the feet.
        if (tv.id === 'hodadakZoom' && tv.t < 0.75 && dt > 0) {
          cv.tauntFxAcc += dt;
          if (cv.tauntFxAcc > 0.09) {
            cv.tauntFxAcc = 0;
            const back = cv.facing + Math.PI;
            this.effects.fx.dust({ x: cv.pose.x + Math.cos(back) * 0.3, y: cv.y, z: cv.pose.y + Math.sin(back) * 0.3 }, { count: 2, spread: 0.2, size: 0.2, up: 0.3 });
          }
        }
      } else if (cv.tauntTurn > 0) {
        cv.tauntTurn = Math.max(0, cv.tauntTurn - dt);
        turnRate = 9;
      }
    }
    // Facing: interpolated + a little extra smoothing for snappy turns.
    if (this.snapVisuals || (Math.abs(wrapAngle(cv.pose.a - cv.facing)) > 2.8 && c.knockdownTicks > 0)) cv.facing = cv.pose.a;
    else cv.facing = lerpAngle(cv.facing, faceTo, damp(turnRate, dt));
    // Floor height (riders on a bank floor), smoothed across the door threshold.
    const onFloor = c.floorOf !== null || this.onAnySlab(cv.pose);
    const targetY = onFloor ? BANK_FLOOR_Y : 0;
    cv.y += (targetY - cv.y) * damp(16, dt);
    if (this.snapVisuals) cv.y = targetY;

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
    // Uproot effort (how far the pull has come), pop tumble and mood faces (moods.ts).
    const held = c.grab ? sim.getLoot(c.grab.targetId) : undefined;
    pose.effort = c.straining && held ? held.unanchorProgress : 0;
    pose.tumble = this.moods.tumble(c.id);
    const moodFace = this.moods.expression(c.id);
    if (moodFace && !pose.knockedDown && !pose.celebrating) pose.expression = moodFace;

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
    // [F3] Readable dash wind-up (BotIntent.phase 'windup'): a coiled crouch + strain face while it
    // lasts (the spark ring at the feet is updateBeats'). Held, not pulsed, so it reads as "about to go".
    const wu = mode === 'match' ? this.windupOf(c.id) : null;
    if (wu && wu.start >= 0 && c.knockdownTicks <= 0) {
      const k = Math.min(1, (this.time - wu.start) / 0.08);
      sqY *= 1 - 0.15 * k;
      sqXZ *= 1 + 0.08 * k;
      pose.expression = 'strain';
    }
    const ps = this.pulseScale(c.id);
    sqY *= ps;
    sqXZ *= 2 - ps;
    cv.rig.root.scale.set(sqXZ, sqY, sqXZ);
    placeOnSim(cv.rig.root, cv.pose, cv.facing, cv.y + this.floorLift(c.floorOf));
    // Impact frame: a white outline flash for a couple of frames on knockdown.
    const flash = this.time < cv.flashUntil && mode === 'match';
    if (flash !== cv.flashOn) {
      cv.flashOn = flash;
      cv.rig.setHighlight(flash ? '#FFFFFF' : null);
    }
    // Ground marker: team ring under everyone, a brighter ring + facing notch for the focus.
    const showMarker = mode === 'match' || mode === 'preview';
    cv.marker.root.visible = showMarker;
    if (showMarker) {
      placeOnSim(cv.marker.root, cv.pose, cv.facing, cv.y + 0.02);
      cv.marker.setFocus(!!focus && (focus.charId === c.id || !!focus.group?.includes(c.id)));
      const gi = focus?.group ? focus.group.indexOf(c.id) : -1;
      cv.marker.setPlayer?.(gi >= 0 ? focus?.groupColors?.[gi] ?? null : null);
    }

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

  /**
   * [F3] Results poses in force: game flow's (setResultsPoses), else the defaults from the
   * result on the stage (rival taunts on its win / slumps on its loss, player `wiggle` on a win;
   * fun-plan WP3). Null on a draw or before the result is known (plain stage).
   */
  private resultsPosesNow(): { rival: 'taunt' | 'slump'; player: EmoteId | null } | null {
    if (this.resultsPoses) return this.resultsPoses;
    const st = this.stage;
    if (!st || !st.final || st.winner === null || this.lastFocusId === null) return null;
    const focusTeam = this.chars.get(this.lastFocusId)?.team;
    if (focusTeam === undefined) return null;
    const won = st.winner === focusTeam;
    this.defaultPoses.rival = won ? 'slump' : 'taunt';
    this.defaultPoses.player = won ? 'wiggle' : null;
    return this.defaultPoses;
  }

  /**
   * Results pose (doc §13): winners hop and cheer in turns (staggered bounces with squash on
   * landing, an occasional spin jump); losers stand slumped and empty-handed, sigh now and then
   * (a little puff) and glance at the winners. Reduced motion: no hops/spins, poses only.
   * [F3] setResultsPoses: the rival loops its signature taunt when it won ('taunt') or slumps
   * when it lost ('slump'); the player's chosen victory taunt loops on a win (between hops).
   */
  private updateStagedChar(cv: CharView, spot: StageSpot, dt: number, c?: CharacterState): void {
    const pose = cv.poseObj;
    const t = this.time;
    const calm = this.settings.reducedMotion;
    const stage = this.stage!;
    cv.pose.x = spot.x;
    cv.pose.y = spot.y;
    pose.speed = 0;
    pose.grabbing = false;
    pose.straining = false;
    pose.dashing = false;
    pose.boosting = false;
    pose.knockedDown = false;
    pose.taunt = null;
    let cheer = spot.cheer;
    let sad = spot.sad;
    // [F3] results poses
    let taunt: EmoteId | null = null;
    let tauntOffset = 0;
    const rp = this.resultsPosesNow();
    if (rp && c) {
      const focusTeam = this.lastFocusId !== null ? this.chars.get(this.lastFocusId)?.team ?? null : null;
      const rivalLook = c.look.rival ?? null;
      if (rivalLook && focusTeam !== null && c.team !== focusTeam) {
        if (rp.rival === 'taunt') taunt = GameView.rivalTaunt(rivalLook);
        else {
          cheer = false;
          sad = true;
        }
      } else if (c.id === this.lastFocusId && rp.player && cheer) {
        taunt = rp.player;
        tauntOffset = 0.9;
      }
    }
    let tauntOn = false;
    if (taunt) {
      const dur = EMOTE.durationTicks[taunt] / TICK_RATE;
      const ph = (t - this.resultsPoseStart + tauntOffset + 0.35) % (dur + 1.1);
      if (ph < dur) {
        pose.taunt = { id: taunt, t: ph, dur };
        tauntOn = true;
      }
    }
    pose.celebrating = cheer && !tauntOn;
    pose.sad = sad;
    let y = 0;
    let sy = 1;
    let sxz = 1;
    let facing = spot.facing;
    if (tauntOn) {
      pose.expression = null;
    } else if (cheer) {
      pose.expression = 'cheer';
      if (!calm) {
        // Bounce: 0.62 s hops, phase-shifted per raccoon; squash on contact.
        const period = 0.62;
        const ph = (t / period + spot.index * 0.37) % 1;
        const air = Math.sin(Math.PI * Math.min(1, ph / 0.72));
        y = ph < 0.72 ? air * 0.42 : 0;
        const land = ph >= 0.72 ? Math.sin(Math.PI * ((ph - 0.72) / 0.28)) : 0;
        sy = 1 + 0.08 * air - 0.16 * land;
        sxz = 1 - 0.04 * air + 0.1 * land;
        // Every 4th hop of each raccoon is a spin jump.
        const hop = Math.floor(t / period + spot.index * 0.37);
        if ((hop + spot.index) % 4 === 0 && ph < 0.72) facing += (ph / 0.72) * Math.PI * 2;
      }
    } else if (sad) {
      pose.expression = 'sad';
      // Sigh: a slow slump-and-release every ~3 s with a tiny puff; glance at the winners.
      const sighPh = ((t + spot.index * 1.3) % 3.2) / 3.2;
      const sigh = sighPh < 0.35 ? Math.sin(Math.PI * (sighPh / 0.35)) : 0;
      sy = 1 - 0.07 * sigh;
      sxz = 1 + 0.035 * sigh;
      const look = Math.atan2(stage.winnersAt.y - spot.y, stage.winnersAt.x - spot.x);
      const glance = Math.sin(t * 0.7 + spot.index) > 0.55 ? 1 : 0;
      pose.headYaw = THREE.MathUtils.clamp(-wrapAngle(look - spot.facing), -0.9, 0.9) * glance;
      if (!calm && dt > 0 && t >= stage.nextSigh && spot.index === 0) {
        stage.nextSigh = t + 3.2;
        this.effects.fx.dust({ x: spot.x + Math.cos(spot.facing) * 0.35, y: 0.75, z: spot.y + Math.sin(spot.facing) * 0.35 }, { count: 2, spread: 0.08, size: 0.12, up: 0.4 });
      }
    } else pose.expression = 'happy';
    if (this.snapVisuals) cv.facing = facing;
    else cv.facing = facing > spot.facing + 0.01 ? facing : lerpAngle(cv.facing, facing, damp(8, dt));
    cv.y = 0;
    cv.rig.root.scale.set(sxz, sy, sxz);
    cv.marker.root.visible = false;
    placeOnSim(cv.rig.root, cv.pose, cv.facing, y);
    if (cv.flashOn) {
      cv.flashOn = false;
      cv.rig.setHighlight(null);
    }
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
      // The zone's own pulse washes its stripes out at full strength: keep it a hint; the
      // per-item ground meter below carries the countdown.
      z.setActive(active * ZONE_PULSE);
      z.setProgress(progress);
      z.update(dt);
    }
    // Recovery meters (doc §8 dwell): a ring around each dwelling item filling clockwise.
    let i = 0;
    if (this.viewMode === 'match') {
      for (const l of st.loot) {
        if (l.recovered || !l.recovery || i >= this.effects.meterCapacity) continue;
        const p = l.recovery.ticks / need;
        if (l.kind === 'bank') {
          const bv = this.banks.get(l.id);
          if (!bv || bv.done) continue;
          _v3.set(bv.pose.x, 0, bv.pose.y);
          this.effects.setRecoveryMeter(i++, _v3, BANK_METER_RADIUS, p);
        } else {
          const sv = this.safes.get(l.id);
          if (!sv || sv.done) continue;
          const h = SAFE_SPECS[sv.kind].half;
          _v3.set(sv.pose.x, sv.y, sv.pose.y);
          this.effects.setRecoveryMeter(i++, _v3, Math.hypot(h.x, h.y) + 0.7, p);
        }
      }
    }
    this.effects.hideRecoveryMetersFrom(i);
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
    const dec = show ? this.decisiveHl : null;
    const decOn = !!dec && (this.settings.reducedMotion || Math.sin(this.time * (this.decisiveSide === 'theirs' ? 10 : 7)) > -0.35);

    const colorFor = (l: LootState, roofOpen: boolean): string | null => {
      if (!show) return null;
      if (cand === l.id) return GRAB_MARKER_COLOR;
      if (l.recovery) return HIGHLIGHT_COLORS.inZone;
      // [F3] Decisive load: a pulsing rim in the side's color (on / off with the ring's beat).
      if (dec && dec.id === l.id) return decOn ? dec.color : null;
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

    // Ground brackets around the whole candidate + a dot at the grab anchor (doc §4).
    const gc = show && focus?.grabCandidate ? focus.grabCandidate : null;
    const gbv = gc ? this.banks.get(gc.targetId) : undefined;
    const gsv = gc ? this.safes.get(gc.targetId) : undefined;
    const fy = focusChar ? this.chars.get(focusChar.id)?.y ?? 0 : 0;
    if (gc && gbv && !gbv.done) this.effects.setGrabTarget('bank', gbv.pose, 0, gc.anchorWorld, fy);
    else if (gc && gsv && !gsv.done) this.effects.setGrabTarget(gsv.kind, gsv.pose, gsv.y, gc.anchorWorld, fy, undefined, (gsv.rig as Partial<PropRig>).footprint);
    else this.effects.setGrabTarget(null, gbv?.pose ?? { x: 0, y: 0, a: 0 });

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
    // (local multiplayer) One shared screen: every human's team pings are shown.
    const teams = new Set<TeamId>(team !== null ? [team] : []);
    for (const id of focus?.group ?? []) {
      const gt = sim.getCharacter(id)?.team;
      if (gt !== undefined) teams.add(gt);
    }
    let i = 0;
    if (team !== null && this.viewMode === 'match') {
      for (const p of st.pings) {
        if (!teams.has(p.team) || p.expiresTick <= st.tick) continue;
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

  private charCentroid(): Vec2 | null {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const cv of this.chars.values()) {
      x += cv.pose.x;
      y += cv.pose.y;
      n++;
    }
    return n ? { x: x / n, y: y / n } : null;
  }

  private focusPos(): Vec2 | null {
    if (this.lastFocusId === null) return null;
    const cv = this.chars.get(this.lastFocusId);
    return cv ? { x: cv.pose.x, y: cv.pose.y } : null;
  }

  /** (local multiplayer) Shared framing of every human (drawn poses) and the loot they hold. */
  private sharedFrame(sim: Simulation, aspect: number): SharedFrame {
    const pts: FramePoint[] = [];
    for (const [owner, id] of (this.focusGroup ?? []).entries()) {
      const c = sim.getCharacter(id);
      if (!c) continue;
      const cv = this.chars.get(id);
      pts.push({ x: cv ? cv.pose.x : c.pos.x, y: cv ? cv.pose.y : c.pos.y, r: 2.2, owner });
      const held = c.grab ? sim.getLoot(c.grab.targetId) : undefined;
      if (held && !held.recovered) {
        const pose = held.kind === 'bank' ? this.banks.get(held.id)?.pose : this.safes.get(held.id)?.pose;
        const q = pose ?? held.pos;
        pts.push({ x: q.x, y: q.y, r: held.kind === 'bank' ? 4.5 : held.kind === 'largeSafe' ? 1.8 : 1.2, owner });
      }
    }
    return sharedFraming(pts, aspect, undefined, undefined, this.sharedPrev);
  }

  /** (local multiplayer) The shared camera's framing right now (tests / HUD), null in single-player. */
  sharedFrameInfo(sim: Simulation): SharedFrame | null {
    return this.focusGroup ? this.sharedFrame(sim, this.width / this.height) : null;
  }

  private cameraGoal(sim: Simulation, fc: CharacterState | null, dt: number, cand: GrabCandidate | null = null): CameraGoal {
    const layout = sim.layout;
    const W = layout.size.x;
    const H = layout.size.y;
    const aspect = this.width / this.height;
    const calm = this.settings.reducedMotion;
    const t = this.time;
    switch (this.viewMode) {
      case 'preview': {
        const pitch = 64;
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
        // Re-aim only when the idle group has wandered off (keeps the attract shot stable).
        const g = this.charCentroid();
        if (!this.titleShot || (g && Math.hypot(g.x - this.titleShot.target.x, g.y - 0.6 - this.titleShot.target.y) > 3)) this.titleShot = this.pickTitleShot(sim);
        const shot = this.titleShot;
        if (shot) {
          // Attract shot: a slow sway around the idle raccoons, aimed where nothing blocks them.
          return {
            target: { x: shot.target.x + Math.sin(t * 0.12) * 1.6 * pan, y: shot.target.y + Math.sin(t * 0.09 + 0.7) * 0.8 * pan },
            distance: shot.dist + Math.sin(t * 0.07) * 1.2 * pan,
            pitch: shot.pitch,
            fov: 36,
            yaw: shot.yaw + Math.sin(t * 0.05) * 0.06 * pan,
            followRate: 1.2,
            clamp: false,
          };
        }
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
        if (!s) return { target: { x: W / 2, y: H / 2 }, distance: 14, pitch: 34, fov: 34, followRate: 2.5, clamp: false };
        const drift = calm ? 0 : 1;
        const rx = -Math.sin(s.yaw);
        const ry = Math.cos(s.yaw);
        const sway = Math.sin(t * 0.2) * 0.35 * drift;
        // Optional framing offset (game flow): drop the staged group below screen center so the
        // results UI cards above it never cover the raccoons.
        const drop = this.resultsDrop > 0 ? (Math.atan(2 * this.resultsDrop * Math.tan((RESULTS_FOV * Math.PI) / 360)) * s.dist) / Math.max(0.3, Math.sin((s.pitch * Math.PI) / 180)) : 0;
        const fx = Math.cos(s.yaw) * drop;
        const fy = Math.sin(s.yaw) * drop;
        return {
          target: { x: s.center.x + rx * sway + fx, y: s.center.y + ry * sway + fy },
          distance: s.dist + Math.sin(t * 0.13) * 0.4 * drift,
          pitch: s.pitch,
          fov: RESULTS_FOV,
          yaw: s.yaw,
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
        frame(q, 0.5);
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
      } else {
        // doc §4 "플레이어와 근처 목표를 보여준다": re-center (and pull back a little) so the
        // nearest outdoor safe / bank / teammate share the frame with the player.
        const f = this.frameInterest(sim, fc, P, tx, ty, cand);
        tx = f.x;
        ty = f.y;
        dist = f.dist;
      }
    }
    // (local multiplayer) One shared camera: frame every human and what they carry.
    if (this.focusGroup) {
      const sf = this.sharedFrame(sim, aspect);
      this.sharedPrev = { x: sf.x, y: sf.y };
      tx = sf.x;
      ty = sf.y;
      dist = sf.dist;
    }
    // Police pulling up nearby: glance toward the parking spot for a moment (the layouts park
    // behind the shop rows), never so far that the player leaves the frame.
    let overscan = 0;
    const att = calm ? null : this.police.attention(P);
    if (att && att.w > 0.01) {
      let dx = att.x - tx;
      let dy = att.y - ty;
      const dl = Math.hypot(dx, dy);
      const maxShift = 4.5;
      if (dl > maxShift) {
        dx *= maxShift / dl;
        dy *= maxShift / dl;
      }
      tx += dx * att.w;
      ty += dy * att.w;
      overscan = 6 * att.w;
    }
    // [F3] Big-play glance (feel.ts plans it; reducedMotion never starts one): blend the target
    // toward the play, capped so the player stays in frame. Position only, never yaw (doc §4).
    if (!calm && this.glanceT.active) {
      const w = this.glanceT.apply(this.time, tx, ty, this.glanceOut);
      if (w > 0) {
        tx = this.glanceOut.x;
        ty = this.glanceOut.y;
        overscan = Math.max(overscan, (5 * w) / BEATS.glance.maxWeight);
      }
    }
    // [F3] Getaway (end hold, match over): frame the winners' van so the drive-off is seen from
    // anywhere (a cut when it was off screen, else eased in over ~0.45 s; never yaw). The shot
    // only exists with reduced motion when it is a cut (playGetaway).
    const shot = this.getaway ? this.getawayShot : null;
    let followRate = 4.5;
    if (shot) {
      const k = shot.cut ? 1 : Math.min(1, Math.max(0, (this.time - this.getaway!.start) / 0.45));
      const w = k * k * (3 - 2 * k);
      tx += (shot.x - tx) * w;
      ty += (shot.y - ty) * w;
      dist += (shot.dist - dist) * w;
      overscan = Math.max(overscan, 6 * w);
      followRate = 3.6;
    }
    return { target: { x: tx, y: ty }, distance: dist, pitch: MATCH_PITCH, fov: MATCH_FOV, followRate, clamp: true, overscan };
  }

  /**
   * Interest framing for the walking match camera. Candidates (in priority order): the grab
   * candidate, the nearest outdoor safe (≤ 15 m), the nearest bank (≤ 15 m), the nearest
   * teammate (≤ 10 m). Each is accepted only if it fits the frame together with the player
   * (player kept within the inner ~60%, targets within the inner ~80%) at a distance of at most
   * MATCH_DIST.walk + FRAME_EXTRA_DIST; the target is centered on the accepted set.
   */
  private frameInterest(sim: Simulation, fc: CharacterState, P: Vec2, tx0: number, ty0: number, cand: GrabCandidate | null): { x: number; y: number; dist: number } {
    const aspect = this.width / this.height;
    const pts: { x: number; y: number; h: number }[] = [];
    const pick: { x: number; y: number; h: number }[] = [];
    if (cand) {
      const sv = this.safes.get(cand.targetId);
      if (sv && !sv.done) pick.push({ x: sv.pose.x, y: sv.pose.y, h: sv.y + 0.6 });
    }
    let best: { x: number; y: number; h: number } | null = null;
    let bd = 15;
    for (const sv of this.safes.values()) {
      if (sv.done) continue;
      const l = sim.getLoot(sv.id);
      if (!l || l.loadedIn !== null || l.floorOf !== null) continue;
      const d = Math.hypot(sv.pose.x - P.x, sv.pose.y - P.y);
      if (d < bd) {
        bd = d;
        best = { x: sv.pose.x, y: sv.pose.y, h: SAFE_SPECS[sv.kind].height + 0.5 };
      }
    }
    if (best) pick.push(best);
    let bank: { x: number; y: number; h: number } | null = null;
    let bk = 15;
    for (const bv of this.banks.values()) {
      if (bv.done) continue;
      const d = Math.hypot(bv.pose.x - P.x, bv.pose.y - P.y);
      if (d < bk) {
        bk = d;
        bank = { x: bv.pose.x, y: bv.pose.y, h: 1.2 };
      }
    }
    if (bank) pick.push(bank);
    let mate: { x: number; y: number; h: number } | null = null;
    let md = 10;
    for (const c of sim.state.characters) {
      if (c.id === fc.id || c.team !== fc.team) continue;
      const cv = this.chars.get(c.id);
      if (!cv) continue;
      const d = Math.hypot(cv.pose.x - P.x, cv.pose.y - P.y);
      if (d < md) {
        md = d;
        mate = { x: cv.pose.x, y: cv.pose.y, h: 1.0 };
      }
    }
    if (mate) pick.push(mate);

    const player = { x: P.x, y: P.y, h: 0.6 };
    let out = { x: tx0, y: ty0, dist: MATCH_DIST.walk as number };
    for (const q of pick) {
      const trial = [...pts, q];
      const fit = this.fitNorth(player, trial, tx0, ty0, aspect);
      if (fit) {
        pts.push(q);
        out = fit;
      }
    }
    return out;
  }

  /**
   * Try to frame `player` + `pts` with the north-facing match camera: the smallest distance
   * (MATCH_DIST.walk .. + FRAME_EXTRA_DIST) at which the player stays near the center (NDC x ±0.45,
   * y [-0.42, 0.3]) and every point fits inside x ±0.82, y [-0.85, 0.74] (room for its HUD value
   * label above it); the target is shifted to center that slack. Null if they cannot share it.
   */
  private fitNorth(player: { x: number; y: number; h: number }, pts: { x: number; y: number; h: number }[], tx0: number, ty0: number, aspect: number): { x: number; y: number; dist: number } | null {
    const p = MATCH_PITCH * DEG;
    const sp = Math.sin(p);
    const cp = Math.cos(p);
    const tanHalf = Math.tan((MATCH_FOV * DEG) / 2);
    const ndc = (q: { x: number; y: number; h: number }, tx: number, ty: number, dist: number): { x: number; y: number } => {
      const dx = q.x - tx;
      const dy = q.h - sp * dist;
      const dz = q.y - (ty + cp * dist);
      const z = Math.max(0.1, -dy * sp - dz * cp);
      const y = dy * cp - dz * sp;
      return { x: dx / (z * tanHalf * aspect), y: y / (z * tanHalf) };
    };
    const all = [player, ...pts];
    const lim = (i: number) => (i === 0 ? { x: 0.45, y0: -0.42, y1: 0.3 } : { x: 0.82, y0: -0.85, y1: 0.74 });
    for (let dist = MATCH_DIST.walk; dist <= MATCH_DIST.walk + FRAME_EXTRA_DIST + 1e-6; dist += 1) {
      let tx = tx0;
      let ty = ty0;
      for (let it = 0; it < 4; it++) {
        // Allowed NDC shift interval per axis; take its middle (the group sits centered).
        let sx0 = -Infinity;
        let sx1 = Infinity;
        let sy0 = -Infinity;
        let sy1 = Infinity;
        all.forEach((q, i) => {
          const n = ndc(q, tx, ty, dist);
          const L = lim(i);
          sx0 = Math.max(sx0, -L.x - n.x);
          sx1 = Math.min(sx1, L.x - n.x);
          sy0 = Math.max(sy0, L.y0 - n.y);
          sy1 = Math.min(sy1, L.y1 - n.y);
        });
        if (sx0 > sx1 || sy0 > sy1) break;
        const sx = (sx0 + sx1) / 2;
        const sy = (sy0 + sy1) / 2;
        if (Math.abs(sx) < 1e-3 && Math.abs(sy) < 1e-3) break;
        // Moving the view by +s NDC moves the points by -s: shift the target the other way.
        tx -= sx * dist * tanHalf * aspect;
        ty += (sy * dist * tanHalf) / Math.max(0.35, sp);
      }
      let ok = true;
      all.forEach((q, i) => {
        const n = ndc(q, tx, ty, dist);
        const L = lim(i);
        if (Math.abs(n.x) > L.x + 0.02 || n.y < L.y0 - 0.02 || n.y > L.y1 + 0.02) ok = false;
      });
      if (ok) return { x: tx, y: ty, dist };
    }
    return null;
  }

  // ===========================================================================
  // Shot clearance (results / title: never put the camera inside or behind a building)
  // ===========================================================================

  /** Is the world point (sim x/y, height h) inside a static prop or bank (padded)? */
  private solidAt(x: number, h: number, y: number, pad: number): boolean {
    const L = this.layout;
    if (!L) return false;
    const p = { x, y };
    for (const st of L.statics) {
      if (h < st.height + pad && insideRect(p, st.center, st.half, st.angle, pad)) return true;
    }
    for (const c of L.circles) {
      // Tree canopies are much wider than their trunk collider.
      const r = c.kind === 'tree' ? Math.max(c.radius, 1.7) : c.kind === 'lamp' || c.kind === 'pole' ? 0 : c.radius;
      if (r <= 0) continue;
      if (h < c.height + pad && Math.hypot(x - c.center.x, y - c.center.y) < r + pad) return true;
    }
    for (const bv of this.banks.values()) {
      if (bv.done) continue;
      if (h < BANK_MODEL.roofHeight + 0.8 + pad && insideRect(p, bv.pose, BANK_MODEL.half, bv.pose.a, pad)) return true;
    }
    // [F3] Results / title shots: outdoor safes, Content 2.0 props (the money tree is 2.6 m) and
    // the vans are solid too, so the camera never parks inside one.
    for (const sv of this.safes.values()) {
      if (sv.done) continue;
      const rig = sv.rig as Partial<PropRig>;
      const half = rig.footprint ?? SAFE_SPECS[sv.kind].half;
      const top = sv.y + (rig.height ?? SAFE_SPECS[sv.kind].height);
      if (h < top + pad && insideRect(p, sv.pose, half, sv.pose.a, pad)) return true;
    }
    // Vans only for the camera position itself (pad >= 1): the winners' van is a point of
    // interest of the results shot, so its own rays must not count it as an obstacle.
    if (pad >= 1) {
      for (const z of L.zones) {
        if (h < VAN.height + 0.3 + pad && insideRect(p, z.vanPos, VAN.half, z.vanAngle, pad)) return true;
      }
    }
    return false;
  }

  /**
   * Blocked-ness of a shot: 100 if the camera sits inside something, +1 per hidden point of
   * interest, +0.4 per frame ray (5 x 3 grid) that hits a prop in the near half of its way to the
   * ground (foreground clutter filling the frame).
   */
  private shotCost(target: Vec2, yaw: number, pitchDeg: number, dist: number, pts: readonly THREE.Vector3[], fovDeg = 36, clutter = true): number {
    const p = pitchDeg * DEG;
    const cp = Math.cos(p);
    const sp = Math.sin(p);
    const cx = target.x - Math.cos(yaw) * cp * dist;
    const cy = target.y - Math.sin(yaw) * cp * dist;
    const ch = sp * dist;
    let cost = this.solidAt(cx, ch, cy, 1.0) ? 100 : 0;
    for (const q of pts) {
      for (let i = 1; i < 24; i++) {
        const t = i / 24;
        if (this.solidAt(cx + (q.x - cx) * t, ch + (q.y - ch) * t, cy + (q.z - cy) * t, 0.25)) {
          cost += 1;
          break;
        }
      }
    }
    if (!clutter) return cost;
    // Frame rays (sim x, height, sim y).
    const tanV = Math.tan((fovDeg * DEG) / 2);
    const tanH = tanV * (this.width / this.height);
    const f = [cp * Math.cos(yaw), -sp, cp * Math.sin(yaw)];
    const r = [-Math.sin(yaw), 0, Math.cos(yaw)];
    const u = [sp * Math.cos(yaw), cp, sp * Math.sin(yaw)];
    for (const a of [-0.85, -0.42, 0, 0.42, 0.85]) {
      for (const b of [-0.8, 0, 0.8]) {
        const dx = f[0] + r[0] * a * tanH + u[0] * b * tanV;
        const dh = f[1] + r[1] * a * tanH + u[1] * b * tanV;
        const dz = f[2] + r[2] * a * tanH + u[2] * b * tanV;
        if (dh >= -0.02) continue;
        const tGround = ch / -dh;
        const tMax = tGround * 0.55;
        const step = 0.45 / Math.hypot(dx, dh, dz);
        for (let t = step; t < tMax; t += step) {
          if (this.solidAt(cx + dx * t, ch + dh * t, cy + dz * t, 0)) {
            cost += 0.4;
            break;
          }
        }
      }
    }
    return cost;
  }

  /** Best clear (yaw, pitch, dist) around a preferred shot; cost ties prefer the preferred one. */
  private pickShot(target: Vec2, yaw0: number, pitches: number[], dists: number[], pts: readonly THREE.Vector3[], fov: number): { yaw: number; pitch: number; dist: number; clear: boolean } {
    let best = { yaw: yaw0, pitch: pitches[0]!, dist: dists[0]!, clear: false };
    let bestScore = Infinity;
    const yaws = [0, -0.3, 0.3, -0.6, 0.6, -0.95, 0.95];
    yaws.forEach((dy, yi) => {
      pitches.forEach((pitch, pi) => {
        dists.forEach((dist, di) => {
          const cost = this.shotCost(target, yaw0 + dy, pitch, dist, pts, fov);
          const score = cost * 10 + yi * 0.6 + pi * 0.5 + di * 0.3;
          if (score < bestScore) {
            bestScore = score;
            best = { yaw: yaw0 + dy, pitch, dist, clear: false };
          }
        });
      });
    });
    best.clear = this.shotCost(target, best.yaw, best.pitch, best.dist, pts, fov, false) === 0;
    return best;
  }

  private pickTitleShot(sim: Simulation): TitleShot | null {
    const g = this.charCentroid();
    if (!g) return null;
    const target = { x: g.x, y: g.y - 0.6 };
    const pts = sim.state.characters.map((c) => {
      const cv = this.chars.get(c.id);
      return new THREE.Vector3(cv?.pose.x ?? c.pos.x, 0.7, cv?.pose.y ?? c.pos.y);
    });
    const s = this.pickShot(target, NORTH_YAW, [36, 44, 52], [15.5, 13.5], pts, 36);
    return { target, yaw: s.yaw, pitch: s.pitch, dist: s.dist, clear: s.clear };
  }

  // ===========================================================================
  // Occlusion (doc §4: 실내에 들어가면 지붕을 감추고, 카메라와 캐릭터 사이의 벽만 투명하게;
  // doc §10: 상대가 금고를 빼낸 것을 숨기지 않는다)
  // ===========================================================================

  private updateOcclusion(sim: Simulation, fc: CharacterState | null, focus: ViewFocus | null, dt: number): void {
    const camPos = this.cam.basePosition;
    const mode = this.viewMode;
    // Scenery x-ray toward the focus (match) / the staged group (results) / the idle group (title).
    let chest: THREE.Vector3 | null = null;
    const fcv = fc ? this.chars.get(fc.id) : undefined;
    if (mode === 'match' && fcv) chest = _chest.set(fcv.pose.x, fcv.y + CHEST_Y, fcv.pose.y);
    else if (mode === 'results' && this.stage && !this.stage.clear) chest = _chest.set(this.stage.center.x, CHEST_Y, this.stage.center.y);
    else if (mode === 'title' && !this.titleShot?.clear) {
      const g = this.charCentroid();
      if (g) chest = _chest.set(g.x, CHEST_Y, g.y);
    }
    setOcclusionFocus(chest ? camPos : null, chest, mode === 'match' ? 2.4 : 3.4);

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
    const k = this.snapVisuals ? 1 : damp(10, dt);
    const st = sim.state;
    for (const bv of this.banks.values()) {
      if (bv.done) continue;
      let roofT = 1;
      const wallT = [1, 1, 1, 1, 1, 1];
      if (mode === 'match' && fc && fcv) {
        const center = { x: bv.pose.x, y: bv.pose.y };
        const ang = bv.pose.a;
        const bl = sim.getLoot(bv.id);
        let inside = fc.floorOf === bv.id || insideRect(fcv.pose, center, BANK_MODEL.half, ang, 0.05);
        for (const sv of interestSafes) {
          const l = sim.getLoot(sv.id);
          if (!l) continue;
          if (l.floorOf === bv.id || l.loadedIn === bv.id || insideRect(sv.pose, center, BANK_MODEL.half, ang, -0.1)) inside = true;
        }
        if (inside) {
          // Glass skylight: keep a whisper of the frame so the building still reads.
          roofT = 0.3;
          // Fade the walls facing the camera (front of the view) so the interior reads (walls
          // already opened by the dollhouse cutaway stay as they are).
          BANK_MODEL.walls.forEach((w, i) => {
            if (bv.rig.wallOpen(i) > 0.5) return;
            // Outward normal (bank local): door walls face ±y, side walls ±x.
            const alongX = w.half.x > w.half.y;
            const nx = alongX ? 0 : Math.sign(w.center.x);
            const ny = alongX ? Math.sign(w.center.y) : 0;
            // World normal (sim): rotate local normal by the bank angle.
            const wy = nx * Math.sin(ang) + ny * Math.cos(ang);
            if (wy > 0.42) wallT[i] = WALL_FADE;
          });
        }
        // Peek (doc §10): another raccoon inside, or a safe being grabbed inside, is never
        // hidden under the roof — e.g. a rival walking the 300 vault out of the bank the
        // player is hauling by its camera-side wall. Roof goes translucent; walls in front fade.
        const peek: THREE.Vector3[] = [];
        for (const c of st.characters) {
          if (c.id === fc.id) continue;
          const cv = this.chars.get(c.id);
          if (!cv) continue;
          if (c.floorOf === bv.id || insideRect(cv.pose, center, BANK_MODEL.half, ang, -0.25)) {
            for (const h of [0.15, CHEST_Y, 1.1]) peek.push(new THREE.Vector3(cv.pose.x, cv.y + h, cv.pose.y));
          }
        }
        for (const sv of this.safes.values()) {
          if (sv.done) continue;
          const l = sim.getLoot(sv.id);
          if (!l || !l.grabbedBy.length) continue;
          if (l.floorOf === bv.id || l.loadedIn === bv.id || insideRect(sv.pose, center, BANK_MODEL.half, ang, -0.1)) {
            peek.push(new THREE.Vector3(sv.pose.x, sv.y + SAFE_SPECS[sv.kind].height * 0.6, sv.pose.y));
          }
        }
        if (peek.length && roofT > ROOF_PEEK) roofT = ROOF_PEEK;
        // Haulers outside the building (either team): walls / door awnings in front of them fade.
        const haulers: THREE.Vector3[] = [];
        if (bl) {
          for (const cid of bl.grabbedBy) {
            if (cid === fc.id) continue;
            const cv = this.chars.get(cid);
            if (cv) haulers.push(new THREE.Vector3(cv.pose.x, cv.y + CHEST_Y, cv.pose.y), new THREE.Vector3(cv.pose.x, cv.y + 1.1, cv.pose.y));
          }
        }
        // Ray tests: walls/roof between the camera and the interest points.
        const near = Math.hypot(bv.pose.x - fcv.pose.x, bv.pose.y - fcv.pose.y) < 22;
        const lc = toLocal({ x: camPos.x, y: camPos.z }, center, ang, { x: 0, y: 0 });
        const wallTest = (p: THREE.Vector3): void => {
          toLocal({ x: p.x, y: p.z }, center, ang, _loc);
          BANK_MODEL.walls.forEach((w, i) => {
            if (wallT[i] <= WALL_FADE || bv.rig.wallOpen(i) > 0.5) return;
            const min: [number, number, number] = [w.center.x - w.half.x - 0.05, 0, w.center.y - w.half.y - 0.05];
            const max: [number, number, number] = [w.center.x + w.half.x + 0.05, H + 0.4, w.center.y + w.half.y + 0.05];
            if (segmentHitsBox(lc.x, camPos.y, lc.y, _loc.x, p.y, _loc.y, min, max)) wallT[i] = WALL_FADE;
          });
          // Door awnings stick out ~1.3 m over the door: they fade with their two walls.
          BANK_MODEL.doors.forEach((d, di) => {
            const ws = di === 0 ? [0, 1] : [2, 3];
            if (wallT[ws[0]!]! <= WALL_FADE && wallT[ws[1]!]! <= WALL_FADE) return;
            const ny = d.normal.y;
            const y0 = d.center.y - ny * 0.2;
            const y1 = d.center.y + ny * 1.5;
            const min: [number, number, number] = [-BANK_MODEL.doorWidth / 2 - 0.5, H - 1.1, Math.min(y0, y1)];
            const max: [number, number, number] = [BANK_MODEL.doorWidth / 2 + 0.5, H + 0.8, Math.max(y0, y1)];
            if (segmentHitsBox(lc.x, camPos.y, lc.y, _loc.x, p.y, _loc.y, min, max)) for (const w of ws) wallT[w] = WALL_FADE;
          });
        };
        if (near) {
          for (const p of pts) {
            wallTest(p);
            if (roofT > ROOF_FADE_BEHIND) {
              const rh = BANK_MODEL.half;
              if (segmentHitsBox(lc.x, camPos.y, lc.y, _loc.x, p.y, _loc.y, [-rh.x - 0.5, H - 0.2, -rh.y - 0.5], [rh.x + 0.5, BANK_MODEL.roofHeight + 1.6, rh.y + 0.5])) roofT = ROOF_FADE_BEHIND;
            }
          }
        }
        if (Math.hypot(bv.pose.x - fcv.pose.x, bv.pose.y - fcv.pose.y) < 36) {
          for (const p of peek) wallTest(p);
          for (const p of haulers) wallTest(p);
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

  /**
   * [F3] Do these world points project inside the results frame (with the game-flow framing drop
   * applied the way cameraGoal does, no sway)? Leaves room at the bottom for the button row.
   */
  private stageFits(center: Vec2, yaw: number, pitchDeg: number, dist: number, pts: readonly THREE.Vector3[]): boolean {
    const cam = (GameView.fitCam ??= new THREE.PerspectiveCamera(RESULTS_FOV, 16 / 9, 0.5, 420));
    cam.fov = RESULTS_FOV;
    cam.aspect = this.width / Math.max(1, this.height);
    cam.updateProjectionMatrix();
    const p = pitchDeg * DEG;
    const drop = this.resultsDrop > 0 ? (Math.atan(2 * this.resultsDrop * Math.tan((RESULTS_FOV * Math.PI) / 360)) * dist) / Math.max(0.3, Math.sin(p)) : 0;
    const tx = center.x + Math.cos(yaw) * drop;
    const ty = center.y + Math.sin(yaw) * drop;
    cam.position.set(tx - Math.cos(yaw) * Math.cos(p) * dist, Math.sin(p) * dist, ty - Math.sin(yaw) * Math.cos(p) * dist);
    cam.lookAt(tx, 0, ty);
    cam.updateMatrixWorld();
    for (const q of pts) {
      _ndc.copy(q).project(cam);
      if (_ndc.z > 1 || Math.abs(_ndc.x) > 0.88 || _ndc.y < -0.78) return false;
    }
    return true;
  }

  private static fitCam: THREE.PerspectiveCamera | null = null;

  // ===========================================================================
  // Results staging (doc §13: winners celebrate at their van; the loser stands empty-handed)
  // ===========================================================================

  /**
   * Winners line up in front of their van (the van fills the background, the camera looks
   * across the zone at it — the zone is open ground, so nothing blocks the shot); losers stand
   * slumped a step closer on the screen-right side, glancing at the winners. Draw: everyone
   * at the focus team's van, happy.
   */
  private buildStage(sim: Simulation, focus: ViewFocus | null): ResultsStage {
    const st = sim.state;
    const layout = sim.layout;
    const winner = st.result ? st.result.winner : st.scores[0] === st.scores[1] ? null : st.scores[0] > st.scores[1] ? 0 : 1;
    const focusTeam = focus ? sim.getCharacter(focus.charId)?.team ?? 0 : 0;
    const team: TeamId = (winner ?? focusTeam) as TeamId;
    const zone = layout.zones.find((z) => z.team === team) ?? layout.zones[0];
    const van = zone?.vanPos ?? { x: layout.size.x / 2, y: layout.size.y / 2 };
    const zc = zone?.center ?? { x: van.x + 6, y: van.y };
    // d: look direction (zone -> van); r: screen-right.
    let dx = van.x - zc.x;
    let dy = van.y - zc.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const rx = -dy;
    const ry = dx;
    const front = { x: van.x - dx * 3.1, y: van.y - dy * 3.1 };
    const faceCam = Math.atan2(-dy, -dx);
    const spots = new Map<EntityId, StageSpot>();
    const winners = st.characters.filter((c) => (winner === null ? true : c.team === winner));
    const losers = winner === null ? [] : st.characters.filter((c) => c.team !== winner);
    const wOff = losers.length ? -0.9 : 0;
    winners.forEach((c, i) => {
      const off = (i - (winners.length - 1) / 2) * 1.45 + wOff;
      const fx = front.x + rx * off - dx * (i % 2) * 0.25;
      const fy = front.y + ry * off - dy * (i % 2) * 0.25;
      spots.set(c.id, { x: fx, y: fy, facing: faceCam - (i - (winners.length - 1) / 2) * 0.22, cheer: winner !== null, sad: false, index: i });
    });
    // Losers: screen-right, a step closer to the camera, facing the camera turned toward the winners.
    // [F3] a smaller step toward the camera (1.6 -> 1.0 m) keeps the losers clear of the button row
    const lBase = { x: front.x + rx * (winners.length * 0.75 + 2.2 + wOff) - dx * 1.0, y: front.y + ry * (winners.length * 0.75 + 2.2 + wOff) - dy * 1.0 };
    losers.forEach((c, i) => {
      const off = i * 1.25;
      const x = lBase.x + rx * off - dx * (i % 2) * 0.3;
      const y = lBase.y + ry * off - dy * (i % 2) * 0.3;
      // Mostly toward the camera (the sad face reads), turned toward the winners (screen-left).
      spots.set(c.id, { x, y, facing: faceCam + 0.5, cheer: false, sad: true, index: i });
    });
    // Frame: winners in the hero spot (center-left), losers inside the right third, van behind.
    let cx = front.x + rx * wOff;
    let cy = front.y + ry * wOff;
    if (losers.length) {
      const lc = { x: lBase.x + rx * (losers.length - 1) * 0.6, y: lBase.y + ry * (losers.length - 1) * 0.6 };
      cx = cx * 0.66 + lc.x * 0.34;
      cy = cy * 0.66 + lc.y * 0.34;
    }
    // Aim a touch toward the van so it stays in frame above the winners.
    cx += dx * 0.5;
    cy += dy * 0.5;
    const center = { x: cx, y: cy };
    const yaw0 = Math.atan2(dy, dx);
    const pts: THREE.Vector3[] = [];
    for (const s of spots.values()) pts.push(new THREE.Vector3(s.x, 0.7, s.y));
    pts.push(new THREE.Vector3(van.x, 1.6, van.y));
    const shot = this.pickShot(center, yaw0, [30, 36, 42], [11.5, 10.5, 13], pts, RESULTS_FOV);
    // [F3] Every staged raccoon stays whole on screen with the results framing drop (the loser
    // stands a step closer to the camera and used to get cut by the bottom edge): back off until
    // they fit (the clearance of the chosen direction holds; only the distance grows).
    const bodies: THREE.Vector3[] = [];
    for (const sp of spots.values()) bodies.push(new THREE.Vector3(sp.x, 0.05, sp.y), new THREE.Vector3(sp.x, 1.45, sp.y));
    for (let k = 0; k < 10 && !this.stageFits(center, shot.yaw, shot.pitch, shot.dist, bodies); k++) shot.dist += 0.6;
    return {
      center,
      spots,
      team,
      winner,
      nextConfetti: this.time + 0.25,
      final: st.over,
      yaw: shot.yaw,
      pitch: shot.pitch,
      dist: shot.dist,
      clear: shot.clear,
      confettiAt: { x: front.x + rx * wOff, y: front.y + ry * wOff },
      winnersAt: { x: front.x + rx * wOff, y: front.y + ry * wOff },
      nextSigh: this.time + 1.4,
    };
  }
}
