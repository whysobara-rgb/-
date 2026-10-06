/**
 * Tunable constants. Values marked "doc" come straight from the design doc v0.5
 * (점수·시간). Everything else is a first-pass tuning value meant for playtests.
 */
import type { RuleConfig, Vec2 } from './types';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const secondsToTicks = (s: number): number => Math.round(s * TICK_RATE);

/** doc §2, §9 */
export const SCORE = {
  smallSafe: 100,
  largeSafe: 300,
  bankBuilding: 500,
} as const;

/** doc §8: 4 min match, 30 s final countdown, 1.5 s recovery dwell. */
export const DEFAULT_RULES: RuleConfig = {
  matchTicks: secondsToTicks(240),
  finalCountdownTicks: secondsToTicks(30),
  recoveryTicks: secondsToTicks(1.5),
  earlyDecision: true,
  timeLimit: true,
  police: false,
};

/**
 * Police event tuning (owner addition beyond doc v0.5). First-pass values for playtests.
 * Officers walk slower than a free raccoon (5 m/s) so an empty-handed raccoon always escapes,
 * but faster than anyone carrying loot, so hauling is risky while police are around.
 */
export const POLICE = {
  /** Delay from the first bank uproot (alarm) to the car arriving. */
  dispatchDelayTicks: secondsToTicks(12),
  /** Car drive-in animation length (officers step out after it). */
  arriveTicks: secondsToTicks(2),
  /** Officers per car in each wave. */
  officersPerWave: [2, 2] as readonly number[],
  /** How long a wave's officers stay before walking back to the car. (balance pass: 40 -> 45 s) */
  shiftTicks: secondsToTicks(45),
  /** Minimum gap between the end of one wave and the next dispatch. (balance pass: 15 -> 12 s) */
  restTicks: secondsToTicks(12),
  /** The final countdown ("도주 준비") always calls a wave if none is on the field. */
  getawayWave: true,
  /**
   * (balance pass) Officers stepping out of the getaway wave's car (0 = officersPerWave): the
   * final 30 s are a scramble past four officers, so a tied field is rarely swept clean.
   */
  getawayOfficers: 0,
  radius: 0.42,
  mass: 70,
  /** Chase speed (m/s) — between a carrier (<= 4) and a free raccoon (5). */
  chaseSpeed: 4.4,
  patrolSpeed: 2.6,
  /** Officers notice carriers within this radius with line of sight. */
  sightRadius: 16,
  /**
   * (balance pass) An uprooted bank's alarm bell gives its haulers away: officers within this
   * radius know who is dragging a ringing bank even when its walls hide the hauler (they still
   * need line of sight to lunge). 0 = sight only.
   */
  hearRadius: 18,
  /** Lunge when the target is within this distance and roughly ahead. */
  tackleRange: 1.5,
  tackleTicks: secondsToTicks(0.22),
  tackleSpeed: 8.5,
  /** Recovery after any tackle attempt (hit or miss). */
  tiredTicks: secondsToTicks(1.6),
  /** Raccoon dash into an officer knocks it over for this long. */
  stunTicks: secondsToTicks(1.8),
} as const;

/**
 * Police car visual footprint (render + layout validation only; the car never collides).
 * Half extents in the car's local frame: x along the heading, y across.
 */
export const POLICE_CAR = {
  half: { x: 2.2, y: 1.0 } as Vec2,
  /**
   * Curb parking: the car stops this far outside the arena edge (center to edge), on the
   * dressed sidewalk / street ring, so it never covers a lane; officers hop the low fence.
   */
  curb: 2.4,
  /** Where the drive-in starts: this far outside the edge, on the same line (off-screen). */
  approach: 12,
} as const;

/** doc §5: unanchor first values (small 1 s, large 2 s, bank 3 s) of valid pulling by one character. */
export const UNANCHOR_TICKS = {
  smallSafe: secondsToTicks(1),
  largeSafe: secondsToTicks(2),
  bank: secondsToTicks(3),
} as const;

/**
 * Movement model (reference): every dynamic body feels viscous ground drag
 * F = -drag * mass * v_rel (v_rel = velocity relative to the floor it stands on).
 * A character applies a constant drive force driveForce * move (|move| <= 1).
 * Free walking terminal speed = driveForce / (drag * mass) = 5 m/s.
 * When holding, the character's drive is transmitted through the grab constraint.
 *
 * Target terminal carry speeds (tests check +-15%):
 *   small safe x1 ~4.0 | large safe x1 ~2.8, x2 ~3.6
 *   empty bank x1 ~1.1, x2 ~1.8 | 1000-pt bank x1 ~0.95, x2 ~1.65
 * Measured in the sim (60 Hz, 2 substeps, test/sim/movement.test.ts), no value changes needed:
 *   walk 5.00 | small 3.96 | large 2.80, 3.59 | empty bank 1.03, 1.71 | 1000-pt bank 0.91, 1.54
 * Pushing (stick toward the grip) moves at the same speeds thanks to the push-steering assist.
 */
export const CHARACTER = {
  radius: 0.45,
  mass: 60,
  drag: 10,
  driveForce: 3000,
  walkSpeed: 5,
  /** Extra reach beyond the body radius for grabbing. */
  reach: 0.75,
  /** Grab constraint rest distance from character center to anchor (radius + gap). */
  holdDistance: 0.55,
  /** Constraint impulse limit; above this the grip breaks (e.g. violent yank). */
  gripBreakForce: 9000,
  /** Non-grab body contact against loot: loot inverse mass is multiplied by this (soft push). */
  softPushFactor: 0.15,
  /**
   * (sim addition) Bounded lateral "grip friction" (N) that keeps a holder on the side it
   * grabbed from. A pure point-distance joint is unstable in compression (pushing jackknifes
   * within ~1 s); this keeps pushing controllable while a sideways walk (driveForce > this)
   * still swings the raccoon around the target. Never breaks the grip.
   */
  gripLateralForce: 1500,
} as const;

/** doc §8 돌진: cooldown 4 s shared by dash and carry boost; ~2 s hit protection. */
export const DASH = {
  cooldownTicks: secondsToTicks(4),
  durationTicks: secondsToTicks(0.25),
  speed: 11,
  /** Dash while holding: drive force multiplier for a short boost. */
  boostTicks: secondsToTicks(0.4),
  boostMultiplier: 2.5,
  /** Knockback speed given to a knocked-down victim. */
  knockbackSpeed: 6,
  /** Same-team dash: only a gentle shove, never a knockdown. */
  teamShoveSpeed: 2,
  /**
   * Head-on clash (two characters dash into each other in the same substep): nobody is knocked
   * down, both bounce apart at this speed. Symmetric so the outcome never depends on slot order
   * (doc §7: humans and bots get identical abilities).
   */
  clashBounceSpeed: 4,
  /**
   * A dash only lands on a character inside this half-angle (radians) around the dash heading:
   * the burst is a forward shove (doc §4 "짧게 앞으로 뛰며 상대를 밀침"); dashing away from or
   * past someone you are touching does nothing to them.
   */
  hitConeHalfAngle: (60 * Math.PI) / 180,
} as const;

export const KNOCKDOWN_TICKS = secondsToTicks(0.7);
export const PROTECT_TICKS = secondsToTicks(2);

export const SAFE_SPECS = {
  smallSafe: { half: { x: 0.4, y: 0.4 } as Vec2, mass: 40, drag: 3.75, height: 0.8 },
  largeSafe: { half: { x: 0.7, y: 0.6 } as Vec2, mass: 120, drag: 3.75, height: 1.3 },
} as const;

/**
 * The single shared bank model (doc: 같은 은행 모델의 지점 2개).
 * Local frame: footprint 8 x 6 m. Doors centered on the local +y (front) and -y (back) walls.
 * Side walls (local +-x) are solid.
 */
export const BANK_MODEL = {
  /** Outer footprint half extents = the marked floor range used for recovery. */
  half: { x: 4, y: 3 } as Vec2,
  wallThickness: 0.4,
  wallHeight: 3.2,
  roofHeight: 3.6,
  doorWidth: 2.2,
  /** Interior walkable floor (local, centered). A safe is "loaded" iff its OBB is fully inside. */
  floorHalf: { x: 3.6, y: 2.6 } as Vec2,
  mass: 1200,
  drag: 1.8,
  /** Wall colliders in bank-local space (center, half). Four door-split segments + two sides. */
  walls: [
    { center: { x: -2.55, y: 2.8 }, half: { x: 1.45, y: 0.2 } }, // front-left
    { center: { x: 2.55, y: 2.8 }, half: { x: 1.45, y: 0.2 } }, // front-right
    { center: { x: -2.55, y: -2.8 }, half: { x: 1.45, y: 0.2 } }, // back-left
    { center: { x: 2.55, y: -2.8 }, half: { x: 1.45, y: 0.2 } }, // back-right
    { center: { x: -3.8, y: 0 }, half: { x: 0.2, y: 3 } }, // side-west (local -x)
    { center: { x: 3.8, y: 0 }, half: { x: 0.2, y: 3 } }, // side-east (local +x)
  ] as ReadonlyArray<{ center: Vec2; half: Vec2 }>,
  /** Door openings in local space (center of the gap on the wall line). */
  doors: [
    { center: { x: 0, y: 2.8 }, normal: { x: 0, y: 1 } }, // front
    { center: { x: 0, y: -2.8 }, normal: { x: 0, y: -1 } }, // back
  ] as ReadonlyArray<{ center: Vec2; normal: Vec2 }>,
  /**
   * Initial interior contents (doc: small x2 + large x1), anchored to the floor.
   * Symmetric under both local mirrors so every bank angle (0, PI/2, PI, 3PI/2) stays fair:
   * the large safe sits in the middle, visible and reachable from both doors
   * (doc §10 "움직이는 은행에 들어가 큰 금고만 빼냄"); the small safes flank it by the side walls.
   */
  interior: [
    { kind: 'largeSafe', pos: { x: 0, y: 0 }, angle: 0 },
    { kind: 'smallSafe', pos: { x: -2.8, y: 0 }, angle: 0 },
    { kind: 'smallSafe', pos: { x: 2.8, y: 0 }, angle: 0 },
  ] as ReadonlyArray<{ kind: 'smallSafe' | 'largeSafe'; pos: Vec2; angle: number }>,
} as const;

/** Fence breaking: a moving (unanchored) bank pressing into a fence. */
export const FENCE = {
  /** Instant break when the bank's approach speed exceeds this (m/s). */
  instantBreakSpeed: 0.6,
  /** Otherwise break after this many ticks of contact with approach speed > minPressSpeed. */
  pressTicks: secondsToTicks(0.2),
  minPressSpeed: 0.15,
  height: 1.4,
  /**
   * (sim addition) Maximum force an intact fence exerts on a pressing bank. Fences are weak:
   * a bank dragged by one raccoon keeps creeping forward (~0.3 m/s) so the press timer can
   * break it, while characters and safes are stopped completely (they never break fences).
   */
  resistForce: 2000,
  /** (sim addition) Penetration (m) a bank may bend an intact fence before it pushes back. */
  give: 0.1,
} as const;

/** Escape van static collider size (render uses the same). */
export const VAN = { half: { x: 2.3, y: 1.15 } as Vec2, height: 2.2 } as const;

/** Recovery zone default size: fits the 8x6 bank at any rotation when roughly centered. */
export const ZONE_DEFAULT_HALF: Vec2 = { x: 6.5, y: 5.5 };

export const PING = {
  durationTicks: secondsToTicks(6),
  /** Minimum ticks between pings from the same character. */
  cooldownTicks: secondsToTicks(0.75),
} as const;

/** Anti-pinning (doc: 은행에 끼워 영구 제압할 수 없게). */
export const UNSTUCK = {
  penetration: 0.25,
  ticks: secondsToTicks(0.5),
} as const;

/**
 * (sim addition) Stall rescue: a character steering with real input (|move| >= minInput) that has
 * not moved more than maxMove for `ticks` while wedged in geometry gets nudged to the nearest free
 * spot ('unstuck' event). "Wedged" = its own spot overlaps geometry, the way it steers is free
 * but the contact solver jams it (two opposing contacts in a gap narrower than the body, where the
 * overlap stays below UNSTUCK.penetration), or it is boxed in (no free spot boxProbe away in any
 * direction: a pocket closed by sub-body gaps that only a shove could get it into). Holders, riders of a moving floor, knocked-down and
 * dashing characters are never nudged; walking into a wall or another character never triggers it.
 * The nudge only goes where a thin probe (probeRadius) can travel in a straight line from the
 * current spot (no clipping through walls, fences or safes), at most maxNudge away.
 */
export const STALL_RESCUE = {
  ticks: secondsToTicks(0.6),
  minInput: 0.5,
  maxMove: 0.05,
  /** Overlap tolerance (m) when testing whether a spot is wedged / free. */
  tolerance: 0.01,
  /** How far ahead (m) the steering direction is probed. */
  probe: 0.1,
  probeRadius: 0.2,
  /** Boxed-in test: no free body spot this far away (m) in any of 16 directions. */
  boxProbe: 0.35,
  maxNudge: 1.5,
  searchStep: 0.1,
} as const;

/** Bot perception (doc §11: public loot info + observed opponents only). */
export const VISION = {
  radius: 18,
} as const;
