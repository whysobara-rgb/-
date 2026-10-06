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
  groundStyle?: 'plaza' | 'arcade' | 'square' | 'practice';
  /**
   * Police car entry/parking points (owner addition beyond doc v0.5). Must be mirror-symmetric
   * (on the mirror axis) so police reach both teams equally. If absent, the sim derives the
   * middle of the north and south arena edges.
   */
  policeEntries?: PoliceEntryDef[];
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
  /** Sum of every unrecovered safe value + 500 per unrecovered bank body. */
  remainingValue: number;
  /** Total value at match start (3200 for full layouts). */
  totalValue: number;
  pings: PingState[];
  /** Police officers (empty unless rules.police). Gone officers are removed. */
  police: PoliceOfficerState[];
  policeCars: PoliceCarState[];
  alarm: AlarmState;
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
  | { type: 'dashHit'; tick: number; attackerId: EntityId; victimId: EntityId; knockdown: boolean }
  | { type: 'bump'; tick: number; aId: EntityId; bId: EntityId; impulse: number }
  | { type: 'fenceBroken'; tick: number; fenceId: string; bankId: EntityId; pos: Vec2 }
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
  | { type: 'matchEnd'; tick: number; result: MatchResult };

export type SimEventType = SimEvent['type'];

/** What the grab button would take right now (for highlight outlines and prompts). */
export interface GrabCandidate {
  targetId: EntityId;
  part: 'safe' | 'bankWall';
  anchorWorld: Vec2;
  anchorLocal: Vec2;
}
