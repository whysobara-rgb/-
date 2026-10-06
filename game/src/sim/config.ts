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
};

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
  /** Initial interior contents (doc: small x2 + large x1), anchored to the floor. */
  interior: [
    { kind: 'largeSafe', pos: { x: -2.6, y: 0 }, angle: Math.PI / 2 },
    { kind: 'smallSafe', pos: { x: 2.8, y: -1.7 }, angle: 0 },
    { kind: 'smallSafe', pos: { x: 2.8, y: 1.7 }, angle: 0 },
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

/** Bot perception (doc §11: public loot info + observed opponents only). */
export const VISION = {
  radius: 18,
} as const;
