/**
 * Core simulation contracts for 뿌리째 털어라 (Uproot Heist).
 *
 * The simulation is a deterministic, fixed-step (60 Hz) top-down 2D world.
 * Rendering maps sim (x, y) to three.js (x, 0, y): +x = east, +y = south.
 * Angles are radians measured with atan2(y, x).
 *
 * Every module (AI, render, UI, game flow) talks to the sim ONLY through
 * these types plus the `Simulation` class in ./sim.ts. Fields may be added
 * later; existing fields must not be renamed or change meaning.
 */

export type TeamId = 0 | 1;
export type EntityId = number;

export interface Vec2 {
  x: number;
  y: number;
}

/** Oriented box in world space (center, half extents, rotation). */
export interface OBB {
  center: Vec2;
  half: Vec2;
  angle: number;
}

export type LootKind = 'smallSafe' | 'largeSafe' | 'bank';
export type SafeKind = 'smallSafe' | 'largeSafe';

// ---------------------------------------------------------------------------
// Commands: the ONLY way humans and bots act. Same rules for both.
// ---------------------------------------------------------------------------

export type PingKind = 'grabTogether' | 'goHere';

export interface Command {
  /** Desired movement direction in world space, magnitude 0..1 (clamped). */
  move: Vec2;
  /**
   * Level signal: "I want to be holding something".
   * true while not holding -> sim tries to grab the current grab candidate each tick.
   * false while holding -> release.
   * After a forced release (knockdown) the sim requires grab=false once before re-grabbing.
   * Toggle-vs-hold is handled by the input layer, never by the sim.
   */
  grab: boolean;
  /** Level signal; the sim triggers a dash on the rising edge if cooldown is ready. */
  dash: boolean;
  /**
   * Optional aim direction (world space, any length). When present and non-zero it sets the
   * character's facing for grab-target selection even while standing still.
   */
  aim?: Vec2 | null;
  /** One-shot ping request this tick (null/undefined = none). */
  ping?: { pos: Vec2; targetId: EntityId | null } | null;
  /**
   * One-shot taunt request this tick (owner addition: cute taunts like a butt wiggle in front of
   * a rival). Purely cosmetic. Ignored while holding, dashing or knocked down, or on cooldown.
   */
  emote?: EmoteId | null;
}

/**
 * Taunt emotes (owner addition). Four base emotes are always available; the three rival emotes
 * are unlocked by beating that rival in the tournament (unlock checks live in game flow, the sim
 * accepts any id).
 */
export type EmoteId =
  | 'wiggle' // 엉덩이 흔들기 (butt wiggle + tail swish)
  | 'bleh' // 메롱 (tongue out, pulling an eyelid)
  | 'fanCash' // 돈다발 부채질 (fanning itself with loot cash)
  | 'squatBounce' // 쭈그려 뛰기 (cute crouch-bounce)
  | 'hodadakZoom' // 호다닥: 후다닥 포즈
  | 'tongkeunFlex' // 통큰이: 근육 자랑
  | 'nunchiShrug'; // 눈치왕: 어깨 으쓱

/** Why a taunt was cancelled early (`emoteCancel.cause`, fun round contract). */
export type EmoteCancelCause = 'move' | 'grab' | 'dash' | 'hit';

export const BASE_EMOTES: readonly EmoteId[] = ['wiggle', 'bleh', 'fanCash', 'squatBounce'];

export interface EmoteState {
  id: EmoteId;
  startTick: number;
  /** Tick at which the emote finishes on its own (cancelled earlier by move/grab/dash/knockdown). */
  endTick: number;
}

export const EMPTY_COMMAND: Readonly<Command> = Object.freeze({
  move: Object.freeze({ x: 0, y: 0 }),
  grab: false,
  dash: false,
  aim: null,
  ping: null,
});

// ---------------------------------------------------------------------------
// Layout (level data). Arena spans x in [0, size.x], y in [0, size.y];
// the sim adds solid boundary walls automatically.
// ---------------------------------------------------------------------------

export type LayoutId = 'plaza' | 'shortcut' | 'counter' | 'tutorial';

/**
 * (Content 2.0 contract, C0; owner C4b) Ids reserved for the two new maps 뚝딱 공사장 ('yard') and
 * 반짝 놀이공원 ('funpark'). They join `LayoutId` in the SAME change that registers the layout file
 * in `LAYOUTS` / `LAYOUT_META` (every `Record<LayoutId, …>` needs a real entry, so the union
 * cannot grow before the data exists). That union move is a pre-approved C0 change request.
 */
export type PlannedLayoutId = 'yard' | 'funpark';

export type StaticBoxKind =
  | 'building' // tall shop/office block (fades when between camera and player)
  | 'wall' // low/mid wall, alley wall
  | 'planter' // flower bed, hedge
  | 'bench'
  | 'kiosk'
  | 'fountain' // use a box or circle
  | 'barrier'; // concrete barrier / bollard row

export interface StaticBoxDef {
  id: string;
  kind: StaticBoxKind;
  center: Vec2;
  half: Vec2;
  angle: number;
  /** Visual height in meters (render only). */
  height: number;
  /** Optional render style hint, e.g. 'cafe', 'bakery', 'toy', 'brick', 'glass'. */
  style?: string;
  /** Optional shop sign text key for buildings (render only). */
  signKey?: string;
}

export type StaticCircleKind = 'tree' | 'lamp' | 'pole' | 'hydrant' | 'fountain' | 'statue';

export interface StaticCircleDef {
  id: string;
  kind: StaticCircleKind;
  center: Vec2;
  radius: number;
  height: number;
}

/** A weak fence marked with a bank icon. Blocks everything until a moving bank breaks it. */
export interface FenceDef {
  id: string;
  center: Vec2;
  half: Vec2;
  angle: number;
}

export interface ZoneDef {
  team: TeamId;
  /** Recovery zone rectangle (must comfortably contain a bank footprint). */
  center: Vec2;
  half: Vec2;
  angle: number;
  /** Escape van pose (render + static collider handled by the sim). */
  vanPos: Vec2;
  vanAngle: number;
}

export interface SpawnDef {
  team: TeamId;
  pos: Vec2;
  facing: number;
}

export interface BankPlacementDef {
  pos: Vec2;
  /** Rotation of the shared bank model; the two doors are on the model's local ±y walls. */
  angle: number;
}

export interface SafePlacementDef {
  kind: SafeKind;
  pos: Vec2;
  angle: number;
}

/** Curated route the AI uses to drag a bank to a team's zone (also used by layout validation). */
export interface BankRouteDef {
  bankIndex: number;
  team: TeamId;
  /** Polyline from the bank's start position to inside the team's zone. */
  points: Vec2[];
  /** Fence ids this route requires breaking (empty if none). */
  breaksFences: string[];
  /**
   * (Content 2.0 contract, C0; owner C4/C4b) AI hint only: the route hands the bank to a gimmick
   * (crane pad / belt) on the way. Never read by the sim.
   */
  via?: { gimmickId: string; kind: 'cranePad' | 'belt' };
}

/** Named intersections/alleys used for rival observation ("그 골목") and AI ambushes. */
export interface ChokepointDef {
  id: string;
  /** i18n key for display, e.g. 'choke.northAlley'. */
  nameKey: string;
  pos: Vec2;
  radius: number;
}

export type DecorKind =
  | 'flowers'
  | 'cone'
  | 'sign'
  | 'crate'
  | 'umbrella'
  | 'trash'
  | 'bush'
  | 'puddle'
  | 'arrow'
  | 'balloon';

/** Visual-only decoration (no collision). */
export interface DecorDef {
  kind: DecorKind;
  pos: Vec2;
  angle: number;
  scale?: number;
  color?: string;
}

/** Where a police car enters the arena (edge point) and where it parks to drop officers. */
export interface PoliceEntryDef {
  /** Point outside the arena edge the car drives in from (render only). */
  from: Vec2;
  /**
   * Parking spot. Layouts park the car at the curb just OUTSIDE the arena edge (never on a
   * lane; the from -> park drive stays outside too) and officers hop in over the fence at
   * officerStepOutSpot(). A park spot inside the arena (free space) is still supported:
   * officers then step out west / east of the car.
   */
  park: Vec2;
  /** Car heading while parked (radians). */
  angle: number;
}

export interface LayoutDef {
  id: LayoutId;
  nameKey: string;
  descKey: string;
  size: Vec2;
  statics: StaticBoxDef[];
  circles: StaticCircleDef[];
  fences: FenceDef[];
  zones: ZoneDef[]; // one per team (tutorial: team 0 only)
  spawns: SpawnDef[]; // 2 per team (tutorial: 1)
  banks: BankPlacementDef[]; // 2 (tutorial: 1)
  safes: SafePlacementDef[]; // outdoor safes only; bank interiors are filled automatically
  bankRoutes: BankRouteDef[];
  chokepoints: ChokepointDef[];
  decor: DecorDef[];
  /** Ground paint theme for the renderer. */
  groundStyle?: 'plaza' | 'arcade' | 'square' | 'practice' | 'yard' | 'funpark';
  /**
   * Police car entry/parking points (owner addition beyond doc v0.5). Must be mirror-symmetric
   * (on the mirror axis) so police reach both teams equally. If absent, the sim derives the
   * middle of the north and south arena edges.
   */
  policeEntries?: PoliceEntryDef[];
  /**
   * (balance pass) Which curb a police car uses: 'nearestAlarm' = the entry nearest the oldest
   * bank still ringing (the car answers the alarm; alternate on a tie / nothing ringing),
   * 'alternate' (default) = entries in turn by wave. The authored layouts use 'nearestAlarm'.
   */
  policeDispatch?: 'alternate' | 'nearestAlarm';
  /**
   * (Content 2.0 contract, C0; owner C4/C4b) The Content 2.0 composition of this map. Present =
   * the map supports `RuleConfig.content: 'v2'` (and defaults to it). Absent = classic only.
   */
  v2?: LayoutV2Def;
}

// ---------------------------------------------------------------------------
// Content 2.0 layout data (contracts frozen by C0, docs/ARCHITECTURE.md "Content 2.0 contracts").
// Builders (src/sim/layouts/builder.ts, C4) mirror every non-axis placement automatically.
// ---------------------------------------------------------------------------

/** Prop loot variants (content-plan §3.1). Nav class comes from PROP_SPECS[variant].kind. */
export type PropVariant = 'atm' | 'piggy' | 'moneyTree' | 'goldSafe';

/** One prop placement (builder mirrors unless on the axis). */
export interface PropPlacementDef {
  variant: PropVariant;
  pos: Vec2;
  angle: number;
}

export type BreakableKind = 'crate' | 'vending';

/** A breakable (removable static that pops coins). */
export interface BreakableDef {
  id: string;
  kind: BreakableKind;
  center: Vec2;
  half: Vec2;
  angle: number;
}

/** Supply-balloon item pad. `twin` = id of the mirrored pad, null = the axis pad. */
export interface ItemPadDef {
  id: string;
  pos: Vec2;
  twin: string | null;
}

/** Map gimmicks (content-plan §5.3). Poses are a pure function of the tick or public state. */
export type GimmickDef =
  | { id: string; kind: 'belt'; obb: OBB; dir: number; speed: number }
  | { id: string; kind: 'fountainShow'; center: Vec2; radius: number; firstTick: number; periodTicks: number; telegraphTicks: number; push: number }
  | { id: string; kind: 'tube'; intake: OBB; exit: Vec2; exitDir: number; transitTicks: number; twin: string | null }
  | { id: string; kind: 'catapult'; seat: OBB; pedal: OBB; landing: Vec2; flightTicks: number; cooldownTicks: number; twin: string | null }
  /** `pads[t]` / `drops[t]` serve team t (pad on team t's side, drop spot 8 m in front of team t's zone). */
  | { id: string; kind: 'crane'; base: Vec2; cab: Vec2; pads: [OBB, OBB]; drops: [Vec2, Vec2]; cooldownTicks: number }
  | { id: string; kind: 'stomper'; center: Vec2; radius: number; periodTicks: number; phaseTicks: number; telegraphTicks: number; twin: string | null }
  | { id: string; kind: 'teacup'; center: Vec2; radius: number; stepAngle: number; moveTicks: number; restTicks: number; spin: 1 | -1; twin: string | null }
  | { id: string; kind: 'slick'; obb: OBB; dragScale: number; driveScale: number }
  | { id: string; kind: 'bumperCar'; path: Vec2[]; periodTicks: number; phaseTicks: number; radius: number; twin: string | null }
  | { id: string; kind: 'wheel'; platform: OBB; gondolas: number; periodTicks: number; windowTicks: number; safeGondolas: number[] };

export type GimmickKind = GimmickDef['kind'];

/** The Content 2.0 composition of a map (`LayoutDef.v2`). */
export interface LayoutV2Def {
  /** Replaces `LayoutDef.safes` when `content: 'v2'`. */
  safes: SafePlacementDef[];
  props: PropPlacementDef[];
  breakables: BreakableDef[];
  gimmicks: GimmickDef[];
  itemPads: ItemPadDef[];
  /** Event spots; index 0 is the axis spot used by every loot event (MatchEventPlan.loot.spot). */
  eventSpots: Vec2[];
}

// ---------------------------------------------------------------------------
// Match setup
// ---------------------------------------------------------------------------

export type HatId =
  | 'none'
  | 'teamCapA' // team 0 default: pointy star beanie
  | 'teamCapB' // team 1 default: round helmet with ring
  | 'hodadakBand' // reward: 호다닥 headband
  | 'tongkeunHat' // reward: 통큰이 big top hat
  | 'nunchiMask'; // reward: 눈치왕 eye mask

export interface CharacterLook {
  hat: HatId;
  /** Optional rival identity for bots (render shows their signature details). */
  rival?: 'hodadak' | 'tongkeun' | 'nunchi' | null;
  /** Fur tint variation 0..1 (purely cosmetic). */
  furTint?: number;
}

export interface RosterEntry {
  team: TeamId;
  isBot: boolean;
  name: string;
  look: CharacterLook;
}

export interface RuleConfig {
  /** Base match length in ticks (240 s). */
  matchTicks: number;
  /** Final countdown after both bank bodies are recovered (30 s). */
  finalCountdownTicks: number;
  /** Continuous ticks fully inside a zone to complete a recovery (1.5 s). */
  recoveryTicks: number;
  /** End early when the leader can no longer be caught. */
  earlyDecision: boolean;
  /** false = no time limit (practice). */
  timeLimit: boolean;
  /**
   * Police event (owner addition beyond doc v0.5): uprooting a bank sets off its alarm and,
   * after a delay, a police car drops officers who chase and tackle characters carrying loot.
   * Police never touch confirmed scores. Default false (tests/tutorial); matches turn it on.
   */
  police: boolean;
  /**
   * (Content 2.0 contract, C0) Ruleset. 'classic' = the pre-Content-2.0 game (3,200, no coins,
   * props, items, gimmicks or events; byte-identical event log). 'v2' = `layout.v2` replaces
   * `layout.safes` and builds props, breakables, gimmicks, item pads and event spots.
   * Default (resolved by mergeRules, always set on `Simulation.rules`): 'v2' when the layout has
   * `v2`, else 'classic'. Requesting 'v2' on a layout without `v2` throws.
   */
  content?: 'classic' | 'v2';
  /** (Content 2.0, C2) Supply drops: off / hammers only / full deck. Default 'on'. v2 only. */
  items?: 'off' | 'hammerOnly' | 'on';
  /** (Content 2.0, C5) Mid-match loot event + quake modifier. Default 'on'. v2 only. */
  events?: 'off' | 'on';
  /**
   * (Content 2.0, C5) Fixed event plan (game flow override, e.g. never repeat last match's loot
   * kind). undefined = derive from the seed (ctx.rng); null = no events this match.
   */
  eventPlan?: MatchEventPlan | null;
  /** (Content 2.0, C4) Map gimmicks on/off. Default true. v2 only. */
  gimmicks?: boolean;
}

export interface MatchSetup {
  layout: LayoutDef;
  roster: RosterEntry[]; // index = slot = Command index
  seed: number;
  rules?: Partial<RuleConfig>;
}

// ---------------------------------------------------------------------------
// Live state (read-only for everyone except the sim)
// ---------------------------------------------------------------------------

export interface GrabState {
  targetId: EntityId;
  part: 'safe' | 'bankWall';
  /** Anchor point in the target's local frame. */
  anchorLocal: Vec2;
}

export interface CharacterState {
  id: EntityId;
  slot: number;
  team: TeamId;
  name: string;
  isBot: boolean;
  look: CharacterLook;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  /** Last applied (clamped) move input, for animation. */
  moveIntent: Vec2;
  grab: GrabState | null;
  /** True while this character is pulling an anchored target (unanchor in progress). */
  straining: boolean;
  /** >0 while a dash is active. */
  dashTicks: number;
  /** Ticks until dash is ready again (0 = ready). Shared by dash and carry boost. */
  dashCooldown: number;
  /** >0 while the carry boost (dash while holding) is active. */
  boostTicks: number;
  /** >0 while knocked down (no control). */
  knockdownTicks: number;
  /** >0 while immune to knockdown (after a forced release / fall). */
  protectTicks: number;
  /** Bank whose moving floor currently carries this character. */
  floorOf: EntityId | null;
  /** Taunt currently playing (owner addition; optional until every sim path sets it). */
  emote?: EmoteState | null;
  // --- Content 2.0 (C0 contract; absent in classic, set by the v2 systems) ---
  /** (C1) Coin bag (주머니): carried value, NEVER score. 0..COINS.bagCap. */
  bag?: number;
  /** (C1) Consecutive ticks inside the own zone toward a deposit (0..COINS.depositTicks). */
  depositTicks?: number;
  /** (C2) The one item pocket (R1). */
  item?: HeldItem | null;
  /** (C2) >0 while dizzy (plunger pull): no control, no knockdown. */
  dizzyTicks?: number;
}

export interface RecoveryProgress {
  team: TeamId;
  /** Consecutive ticks fully inside the zone, 0..recoveryTicks. */
  ticks: number;
}

export interface LootState {
  id: EntityId;
  kind: LootKind;
  /** Base value: small 100, large 300, bank building 500. */
  baseValue: number;
  pos: Vec2;
  angle: number;
  vel: Vec2;
  angVel: number;
  /** OBB half extents (bank: outer footprint = marked floor range). */
  half: Vec2;
  anchored: boolean;
  /** 0..1 progress toward unanchoring (1 = free). */
  unanchorProgress: number;
  recovered: boolean;
  recoveredBy: TeamId | null;
  recoveredTick: number | null;
  /** Character ids currently holding this. */
  grabbedBy: EntityId[];
  /** Non-null while fully inside a recovery zone (and eligible). */
  recovery: RecoveryProgress | null;
  // --- safes ---
  /** Bank whose floor carries this safe (center over the floor). */
  floorOf: EntityId | null;
  /** Bank in which this safe is FULLY loaded (counts toward that bank's value). */
  loadedIn: EntityId | null;
  /** Bank the safe started in (null for outdoor safes). */
  homeBank: EntityId | null;
  // --- banks ---
  /** Unrecovered safes fully loaded on this bank's floor, ascending id. */
  loadedSafes: EntityId[];
  /**
   * Points awarded if recovered right now.
   * Safe: baseValue. Bank: 500 + sum(baseValue of loadedSafes).
   */
  estimatedValue: number;
  /** Last character who touched/held this (for events/results), or null. */
  lastHolder: EntityId | null;
  // --- Content 2.0 (C0 contract; absent on plain safes and banks) ---
  /** (C3) Prop variant; null/absent = plain safe or bank. Props never load into banks. */
  variant?: PropVariant | null;
  /** (C3) Coins still inside the shell; settled with the shell (pays baseValue + innerValue). */
  innerValue?: number;
  /** (C3) Piggy cracks so far (3 = smashed). */
  cracks?: number;
  /**
   * (C5/C4) Dormant: cannot be grabbed, loaded or recovered, still counts in remainingValue. Its
   * LootRuntime body exists but is `enabled = false` (out of the physics world) until it appears.
   */
  dormant?: boolean;
  /** (C3/C4/C5) In flight (body disabled, see flyBody): cannot be grabbed, loaded or recovered. */
  airborne?: { fromTick: number; toTick: number; from: Vec2; to: Vec2; via: 'catapult' | 'tube' | 'crane' | 'parachute' } | null;
  /** (C3) Ticks until a dash bonk can hit this prop again. */
  bonkCooldown?: number;
}

export interface FenceState {
  id: string;
  center: Vec2;
  half: Vec2;
  angle: number;
  broken: boolean;
  brokenTick: number | null;
}

export interface PingState {
  id: number;
  team: TeamId;
  charId: EntityId;
  pos: Vec2;
  targetId: EntityId | null;
  kind: PingKind;
  expiresTick: number;
}

// ---------------------------------------------------------------------------
// Police (owner addition beyond doc v0.5). Neutral NPCs simulated inside the sim, deterministic.
// They chase characters that carry loot and tackle them (knockdown + forced release, the same
// effect as an opposing dash). They never grab loot, never change scores and never block recovery.
// ---------------------------------------------------------------------------

export type PolicePhase =
  | 'arriving' // stepping out of the car
  | 'patrol' // walking toward hotspots (hauled banks, zones) with no carrier in sight
  | 'chase' // pursuing targetCharId
  | 'tackle' // lunge in progress (tackleTicks > 0)
  | 'tired' // short recovery after a tackle attempt
  | 'stunned' // knocked over by a raccoon dash (stunTicks > 0)
  | 'leaving' // walking back to the car
  | 'gone'; // removed from the field

export interface PoliceOfficerState {
  id: EntityId;
  carId: number;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  phase: PolicePhase;
  /** Character currently pursued (null when patrolling/leaving). */
  targetCharId: EntityId | null;
  /** >0 while lunging. */
  tackleTicks: number;
  /** >0 while knocked over by a dash. */
  stunTicks: number;
  /** >0 while catching breath after a tackle attempt. */
  tiredTicks: number;
  /** Ticks this officer has been on the field (for the shift length). */
  activeTicks: number;
}

export type PoliceCarPhase = 'arriving' | 'parked' | 'leaving' | 'gone';

export interface PoliceCarState {
  id: number;
  /** Index into the layout's police entries. */
  entryIndex: number;
  pos: Vec2;
  angle: number;
  phase: PoliceCarPhase;
  sirenOn: boolean;
  /** Dispatch wave number (1 = first alarm, 2 = second alarm / getaway). */
  wave: number;
}

export interface AlarmState {
  /** Bank ids whose alarm is ringing (uprooted and not yet recovered). */
  ringing: EntityId[];
  /** Tick at which the next police car is due, or null if none is scheduled. */
  dispatchTick: number | null;
  /** Number of waves dispatched so far. */
  waves: number;
}

// ---------------------------------------------------------------------------
// Content 2.0 live state (contracts frozen by C0; owners in brackets)
// ---------------------------------------------------------------------------

/** [C1] A loose coin pile (동전 10 / 지폐 다발 50). Ids from COIN_ID_BASE, monotonically increasing. */
export interface CoinPile {
  id: EntityId;
  pos: Vec2;
  vel: Vec2;
  value: 10 | 50;
  /** The spill victim who may not pick this pile up before `noPickupUntil` (tick). */
  noPickupCharId: EntityId | null;
  noPickupUntil: number;
}

/** [C1] A breakable (crate / vending machine). */
export interface BreakableState {
  id: string;
  kind: BreakableKind;
  center: Vec2;
  half: Vec2;
  angle: number;
  hp: number;
  /** Coins still inside (counts in remainingValue until broken / popped). */
  innerValue: number;
  broken: boolean;
}

export type ItemKind = 'hammer' | 'goldHammer' | 'plunger' | 'skates' | 'soap' | 'balloons' | 'smoke';

/** [C2] The item in a character's pocket. */
export interface HeldItem {
  kind: ItemKind;
  uses: number;
  /** Tick the item expires (ITEM_FOREVER = until the match ends; never Infinity: state is JSON). */
  expiresTick: number;
  /** Ticks until the item can be used again (independent of the dash cooldown). */
  cooldown: number;
  phase: 'idle' | 'windup' | 'active' | 'recover';
  phaseTicks: number;
  /** Aim angle (radians) locked at use. */
  aim: number;
}

/** [C2] An item on the field (descending under its balloon, or on the ground). Ids from ITEM_ID_BASE. */
export interface ItemPickupState {
  id: EntityId;
  kind: ItemKind;
  /** Pad it drops on; null = dropped by a knocked-down holder. */
  padId: string | null;
  pos: Vec2;
  phase: 'incoming' | 'ground';
  landTick: number;
  expiresTick: number;
  uses: number;
}

/** [C2] Soap slick / sneeze cloud. Ids from HAZARD_ID_BASE. */
export interface HazardState {
  id: EntityId;
  kind: 'slick' | 'smoke';
  pos: Vec2;
  radius: number;
  untilTick: number;
  ownerTeam: TeamId;
}

/** [C2] Plunger in flight. Ids from PROJECTILE_ID_BASE. */
export interface ProjectileState {
  id: EntityId;
  kind: 'plunger';
  ownerId: EntityId;
  pos: Vec2;
  vel: Vec2;
  dieTick: number;
}

/** [C4] Public gimmick state (one per GimmickDef, same order and id). */
export interface GimmickState {
  id: string;
  kind: GimmickKind;
  phase: 'idle' | 'telegraph' | 'active' | 'busy' | 'cooldown';
  phaseTick: number;
  nextTick: number;
  /** Kinematic pose (teacup angle, crane hook, bumper car, wheel angle, …). */
  pose: { x: number; y: number; angle: number };
  /** Entities the gimmick currently holds (tube, catapult load, crane bank). */
  busyWith: EntityId[];
  /** Crane cat stun. */
  stunTicks?: number;
}

export type LootEventKind = 'moneyRain' | 'goldSafe' | 'cashTruck';

/**
 * [C5] The match's event schedule (derived from the seed unless RuleConfig.eventPlan is set; game
 * flow builds an override with `planMatchEvents` from events.ts). `tick` is the tick the event
 * FIRES (matchEvent phase 'start'); its warning starts EVENTS.warnTicks earlier (quake:
 * EVENTS.quakeWarnTicks). `spot` indexes LayoutV2Def.eventSpots.
 */
export interface MatchEventPlan {
  loot: {
    kind: LootEventKind;
    tick: number;
    spot: number;
    /** cashTruck only: curb the truck enters from (seeded in planMatchEvents; absent = C5 draws it at build). */
    truckFrom?: 'north' | 'south';
  } | null;
  quake: { tick: number } | null;
}

/**
 * [C5] A planned / running event. 'scheduled' (C0 addition to the plan's union) = exists from
 * tick 0 so its `pendingValue` (돈비 / 수송차 coins not yet spawned) is part of totalValue.
 */
export interface MatchEventState {
  kind: LootEventKind | 'quake';
  phase: 'scheduled' | 'warn' | 'active' | 'done';
  startTick: number;
  pos: Vec2;
  /** Value not yet on the field (counts in remainingValue). */
  pendingValue: number;
  doorHp?: number;
  truckFrom?: 'north' | 'south';
}

export type EndReason = 'time' | 'allRecovered' | 'decided';

export interface MatchResult {
  reason: EndReason;
  /** null = draw (equal scores). */
  winner: TeamId | null;
  scores: [number, number];
  endTick: number;
}

export interface SimState {
  layoutId: LayoutId;
  tick: number;
  /** Tick at which the match ends (may move earlier once, never later). Infinity if no limit. */
  endTick: number;
  over: boolean;
  result: MatchResult | null;
  /** Confirmed scores, index = team. Never decrease. */
  scores: [number, number];
  characters: CharacterState[];
  /** Safes and banks (recovered ones stay in the array with recovered=true). */
  loot: LootState[];
  fences: FenceState[];
  /** Number of bank BODIES recovered (0..2). */
  banksRecovered: number;
  /** True once both bank bodies are recovered (siren / "30초 뒤 출발!"). */
  finalCountdown: boolean;
  finalCountdownTick: number | null;
  /**
   * Every point still on the field (content-plan §3.5): Σ unrecovered loot (baseValue +
   * innerValue, dormant included) + Σ coin piles + Σ bags + Σ unbroken breakables' innerValue +
   * Σ matchEvents' pendingValue. Classic: unrecovered safes + 500 per unrecovered bank body.
   */
  remainingValue: number;
  /**
   * Total value at match start, constant for the match (classic full layouts 3200; v2 maps 4000,
   * 4400 with a loot event). Invariant: scores[0] + scores[1] + remainingValue === totalValue.
   * Tests and tools read this, never a hard-coded number.
   */
  totalValue: number;
  pings: PingState[];
  /** Police officers (empty unless rules.police). Gone officers are removed. */
  police: PoliceOfficerState[];
  policeCars: PoliceCarState[];
  alarm: AlarmState;
  // --- Content 2.0 (C0 contract). Always present; empty / null in classic. ---
  /** [C1] Loose coin piles, ascending id. */
  coins: CoinPile[];
  /** [C1] Breakables in layout order (broken ones stay with broken=true). */
  breakables: BreakableState[];
  /** [C2] Item pickups on the field, ascending id. */
  items: ItemPickupState[];
  /** [C2] Active hazards, ascending id. */
  hazards: HazardState[];
  /** [C2] Projectiles in flight, ascending id. */
  projectiles: ProjectileState[];
  /** [C4] One per LayoutV2Def.gimmicks entry (empty when gimmicks are off). */
  gimmicks: GimmickState[];
  /** [C5] Planned / running / finished events. */
  matchEvents: MatchEventState[];
  /** [C5] This match's event plan (null = none: classic, events off, or a null plan). */
  eventPlan: MatchEventPlan | null;
}

// ---------------------------------------------------------------------------
// Events emitted by Simulation.step (also appended to Simulation.eventLog)
// ---------------------------------------------------------------------------

export type SimEvent =
  | { type: 'matchStart'; tick: number }
  | { type: 'grab'; tick: number; charId: EntityId; targetId: EntityId; part: 'safe' | 'bankWall' }
  | { type: 'release'; tick: number; charId: EntityId; targetId: EntityId; forced: boolean }
  | { type: 'unanchored'; tick: number; lootId: EntityId; kind: LootKind; byTeam: TeamId | null }
  | { type: 'dash'; tick: number; charId: EntityId; carrying: boolean }
  | {
      type: 'dashHit';
      tick: number;
      attackerId: EntityId;
      victimId: EntityId;
      knockdown: boolean;
      /** (Content 2.0, C1; add-only) Bag value the victim spilled (absent = 0 / classic). */
      spilled?: number;
    }
  | { type: 'bump'; tick: number; aId: EntityId; bId: EntityId; impulse: number }
  | {
      type: 'fenceBroken';
      tick: number;
      fenceId: string;
      /** The breaking bank; -1 for a non-bank break (hammer). */
      bankId: EntityId;
      pos: Vec2;
      /** (Content 2.0, C2/C4; add-only) Character whose hammer broke it. */
      byCharId?: EntityId;
    }
  | { type: 'safeLoaded'; tick: number; safeId: EntityId; bankId: EntityId; bankValue: number }
  | {
      type: 'safeUnloaded';
      tick: number;
      safeId: EntityId;
      bankId: EntityId;
      bankValue: number;
      /** Character pulling it out, if any. */
      byCharId: EntityId | null;
      /** Team that had been dragging the bank at that moment (null if none). */
      bankCarrierTeam: TeamId | null;
    }
  | { type: 'recoveryStart'; tick: number; lootId: EntityId; team: TeamId }
  | { type: 'recoveryCancel'; tick: number; lootId: EntityId; team: TeamId; progressTicks: number }
  | {
      type: 'recovered';
      tick: number;
      lootId: EntityId;
      kind: LootKind;
      team: TeamId;
      /** Points added. Bank: 500 + safesValue. */
      value: number;
      /** Bank only: safe ids recovered together with the building. */
      safeIds: EntityId[];
      safesValue: number;
      /** Characters holding it at completion (may be empty). */
      holders: EntityId[];
      /** (Content 2.0, C1; add-only) Prop: coins inside paid with the shell (value includes it). */
      innerValue?: number;
      /** (Content 2.0, C1; add-only) Prop variant of the recovered loot (absent = plain safe / bank). */
      variant?: PropVariant;
    }
  | { type: 'bankBodyRecovered'; tick: number; bankId: EntityId; count: number }
  | { type: 'finalCountdown'; tick: number; endTick: number; previousEndTick: number }
  | { type: 'ejected'; tick: number; charId: EntityId; pos: Vec2 }
  | { type: 'unstuck'; tick: number; entityId: EntityId; pos: Vec2 }
  | {
      type: 'ping';
      tick: number;
      pingId: number;
      team: TeamId;
      charId: EntityId;
      pos: Vec2;
      targetId: EntityId | null;
      kind: PingKind;
    }
  | { type: 'alarm'; tick: number; bankId: EntityId; dispatchTick: number }
  | { type: 'policeDispatched'; tick: number; carId: number; wave: number; officerIds: EntityId[]; entryIndex: number }
  | { type: 'policeArrived'; tick: number; carId: number; pos: Vec2 }
  | { type: 'policeSpotted'; tick: number; officerId: EntityId; charId: EntityId }
  | { type: 'policeTackle'; tick: number; officerId: EntityId; victimId: EntityId; hit: boolean }
  | { type: 'policeStunned'; tick: number; officerId: EntityId; byCharId: EntityId }
  | { type: 'policeLeaving'; tick: number; carId: number }
  | { type: 'policeGone'; tick: number; carId: number }
  | {
      type: 'emote';
      tick: number;
      charId: EntityId;
      emoteId: EmoteId;
      /** Nearest opponent within EMOTE.nearOpponentRadius with line of sight ("in front of a rival"), else null. */
      nearOpponentId: EntityId | null;
    }
  | {
      type: 'emoteCancel';
      tick: number;
      charId: EntityId;
      emoteId: EmoteId;
      /**
       * (fun round contract, owner WP2; add-only) Why the taunt stopped early: the raccoon moved,
       * grabbed, dashed, or was knocked down by a hit (opposing dash or police tackle). Absent
       * when unknown (older emitters). MomentTracker turns cause 'hit' by an opposing dash into
       * `tauntPunished`.
       */
      cause?: EmoteCancelCause;
      /**
       * (fun round contract, owner WP2; add-only) With cause 'hit': the opposing CHARACTER whose
       * dash knocked the taunter down (the same tick's `dashHit.attackerId`); null for a police
       * tackle or any other hit. Absent otherwise.
       */
      hitBy?: EntityId | null;
    }
  | { type: 'matchEnd'; tick: number; result: MatchResult }
  // --- Content 2.0 (C0 contract, add-only members; owner in brackets) ---
  | {
      /** [C1] Piles spawned together (one event per spawn burst). */
      type: 'coinSpawn';
      tick: number;
      ids: EntityId[];
      total: number;
      pos: Vec2;
      source: CoinSpawnSource;
      sourceId: EntityId | string | null;
      byCharId: EntityId | null;
    }
  | { type: 'coinPickup'; tick: number; charId: EntityId; coinId: EntityId; value: number; bag: number } // [C1]
  | { type: 'coinDepositStart' | 'coinDepositCancel'; tick: number; charId: EntityId; team: TeamId } // [C1]
  | { type: 'coinsBanked'; tick: number; charId: EntityId; team: TeamId; value: number } // [C1]
  | { type: 'bagSpilled'; tick: number; charId: EntityId; value: number; byId: EntityId | null; cause: SpillCause } // [C1]
  | { type: 'breakableHit'; tick: number; id: string; hp: number; byCharId: EntityId | null } // [C1]
  | { type: 'breakableBroken'; tick: number; id: string; byCharId: EntityId | null } // [C1]
  | {
      /** [C3] */
      type: 'propHit';
      tick: number;
      lootId: EntityId;
      byCharId: EntityId | null;
      how: 'dash' | 'hammer' | 'impact' | 'plunger' | 'hazard';
      coins: number;
    }
  | { type: 'piggyCrack'; tick: number; lootId: EntityId; cracks: number; smashed: boolean; byCharId: EntityId | null } // [C3]
  | { type: 'itemIncoming'; tick: number; padId: string; kind: ItemKind; landTick: number } // [C2]
  | { type: 'itemSpawn'; tick: number; itemId: EntityId; kind: ItemKind; pos: Vec2 } // [C2]
  | { type: 'itemPickup'; tick: number; charId: EntityId; itemId: EntityId; kind: ItemKind } // [C2]
  | { type: 'itemUse'; tick: number; charId: EntityId; kind: ItemKind; phase: 'windup' | 'fire' } // [C2]
  | {
      /** [C2] */
      type: 'itemHit';
      tick: number;
      charId: EntityId;
      kind: ItemKind;
      target: 'char' | 'police' | 'loot' | 'breakable' | 'fence' | 'gimmick' | 'event';
      targetId: EntityId | string;
      knockdown: boolean;
      homeRun?: boolean;
    }
  | { type: 'itemClash'; tick: number; aId: EntityId; bId: EntityId } // [C2]
  | { type: 'itemDropped'; tick: number; charId: EntityId; itemId: EntityId; kind: ItemKind; uses: number; pos: Vec2 } // [C2]
  | { type: 'itemExpired'; tick: number; charId: EntityId | null; itemId: EntityId | null; kind: ItemKind } // [C2]
  | { type: 'hazard'; tick: number; id: EntityId; kind: 'slick' | 'smoke'; phase: 'start' | 'end'; pos: Vec2 } // [C2]
  /** [C4] Generic gimmick beat (keeps the union stable): `what` e.g. 'erupt', 'launch', 'land', 'catStunned'. */
  | { type: 'gimmick'; tick: number; id: string; what: string; pos?: Vec2; ids?: EntityId[] }
  | { type: 'matchEvent'; tick: number; kind: LootEventKind | 'quake'; phase: 'warn' | 'start' | 'open' | 'end'; pos?: Vec2 }; // [C5]

/** Where a coinSpawn burst came from (Content 2.0). */
export type CoinSpawnSource = 'spurt' | 'bonk' | 'break' | 'smash' | 'shed' | 'spill' | 'rain' | 'truck' | 'quake';

/** Why a bag spilled (Content 2.0). Self-inflicted crashes never spill. */
export type SpillCause = 'dash' | 'hammer' | 'police' | 'hazard';

/**
 * Why a character was knocked down (Content 2.0; `knockDown` in actions.ts). 'self' = a
 * self-inflicted crash (skates into a wall): drops the item, never spills the bag.
 */
export type KnockdownCause = SpillCause | 'self';

export type SimEventType = SimEvent['type'];

/** What the grab button would take right now (for highlight outlines and prompts). */
export interface GrabCandidate {
  targetId: EntityId;
  part: 'safe' | 'bankWall';
  anchorWorld: Vec2;
  anchorLocal: Vec2;
}
