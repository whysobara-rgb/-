/**
 * Tunable constants. Values marked "doc" come straight from the design doc v0.5
 * (점수·시간). Everything else is a first-pass tuning value meant for playtests.
 */
import type { BreakableKind, ItemKind, PropVariant, RuleConfig, SafeKind, Vec2 } from './types';

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
  // Content 2.0 switches (C0). `content` has no fixed default: mergeRules resolves it per layout
  // ('v2' when layout.v2 exists and CONTENT_V2_BY_DEFAULT, else 'classic'). eventPlan undefined =
  // derive from the seed.
  items: 'on',
  events: 'on',
  gimmicks: true,
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
   * Officers stepping out of the getaway wave's car (0 = officersPerWave, like every other wave).
   * Doc §8: the last 30 s are played under the same score and carrying conditions, so the getaway
   * wave is never stronger than a normal one. (A 4-officer getaway wave was measured as its own
   * change: 360 proxy-vs-bot 1v1 matches, same seeds — draws 9.2 % with the normal count vs 9.7 %
   * with 4, median length 172 s both; it bought nothing, so no late-match special rule.)
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
/** Taunt emotes (owner addition). Cosmetic only; never affect physics or scoring. */
export const EMOTE = {
  durationTicks: {
    wiggle: secondsToTicks(1.6),
    bleh: secondsToTicks(1.2),
    fanCash: secondsToTicks(1.8),
    squatBounce: secondsToTicks(1.6),
    hodadakZoom: secondsToTicks(1.4),
    tongkeunFlex: secondsToTicks(1.8),
    nunchiShrug: secondsToTicks(1.4),
  },
  /** Gap after an emote ends (or is cancelled) before the next one can start. */
  cooldownTicks: secondsToTicks(0.8),
  /** Move input above this magnitude cancels an emote. */
  cancelMove: 0.2,
  /** "In front of a rival": nearest opponent within this radius with line of sight. */
  nearOpponentRadius: 6,
} as const;

export const VISION = {
  radius: 18,
} as const;

// =============================================================================================
// Content 2.0 (docs/ARCHITECTURE.md "Content 2.0 contracts"). One block per owner package; only
// the owner changes values in its block (C11 is the single tuning owner once a package lands).
// Values below are the content-plan stubs (§3, §4.3, §5). Nothing here is read in classic.
// =============================================================================================

const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * [C0] Entity id ranges (same pattern as POLICE_ID_BASE = 1000 in police.ts). Characters 1..n,
 * layout loot (banks, interiors, safes, props) right after them, dormant event loot appended at
 * build; then officers 1001+, items 2001+, projectiles 3001+, hazards 4001+, kinematic gimmick /
 * event bodies 5001+ (teacup floors, bumper cars, truck, crane load carrier: any physics Body that
 * is not a character, loot or officer needs a unique `entityId`), coin piles 10001+ (monotonically
 * increasing, never reused). Allocate with `nextEntityId(ctx, kind)` (world.ts).
 */
export const ITEM_ID_BASE = 2000;
export const PROJECTILE_ID_BASE = 3000;
export const HAZARD_ID_BASE = 4000;
export const KINEMATIC_ID_BASE = 5000;
export const COIN_ID_BASE = 10000;

/**
 * [C0] "Forever" for tick / use counts in Content 2.0 state (golden hammer lifetime, skate uses).
 * SimState and SimEvent are JSON (event-log hashes, replays, saves): never store Infinity or NaN.
 * HUD: `uses >= ITEM_FOREVER` = no pips; `expiresTick >= ITEM_FOREVER` = no lifetime ring.
 */
export const ITEM_FOREVER = 0x7fffffff;

/**
 * [C0] Gate for the per-layout default `content: 'v2'` (mergeRules). false until the wave-1
 * integration (C1 + C3 + C4 landed, invariant fuzz green on all v2 maps), so a map that gains
 * `layout.v2` (C4 retrofit) does not silently switch every match, test and tool that uses it to a
 * half-built ruleset. Explicit `content: 'v2'` always works. C0 flips it (with the classic-pinned
 * tests); after the flip the plan's rule holds: 'v2' when the layout has `v2`.
 */
export const CONTENT_V2_BY_DEFAULT: boolean = false;

/**
 * [C0] Salt of the content RNG. Two independent streams, so the number of draws one package makes
 * never shifts the other's results (items off / on, a bigger deck, or a skipped drop must not
 * change the event plan of the same seed):
 * - item deck (C2): `ctx.rng = createRng(setup.seed ^ CONTENT_RNG_SALT)`;
 * - event plan + truck curb side (C5): `planMatchEvents(seed, …)` uses
 *   `createRng(seed ^ CONTENT_RNG_SALT ^ EVENT_RNG_SALT)`, all drawn at build.
 * These are the only allowed draws (content-plan §4.4 / §10). Everything else is a pure function
 * of state and tick (mirrored situations -> mirrored outcomes). Classic never draws from either.
 */
export const CONTENT_RNG_SALT = 0x17e15;
export const EVENT_RNG_SALT = 0x5e7e47;

/** [C1] Loose coins, bags, deposit, spill (content-plan §3.3). */
export const COINS = {
  /** Max bag value (주머니). */
  bagCap: 200,
  /** A non-knocked-down character whose center is this close to a pile takes it. */
  pickupRadius: 0.8,
  /** Continuous ticks inside the own zone (OBB shrunk by the character radius) to deposit. */
  depositTicks: secondsToTicks(0.5),
  /** Spill = max(spillMin, floor(bag * spillFraction / 10) * 10), capped at the bag. */
  spillFraction: 0.5,
  spillMin: 10,
  /** The spill victim cannot pick up its own spilled piles for this long. */
  ownSpillLockTicks: secondsToTicks(1),
  /** Pile ground drag (1/s). */
  drag: 4,
  /** Hit fans span ±this around the hit / knockback direction. */
  fanHalfAngle: deg(60),
  /** Fixed launch speed per pile index (cycled), no RNG. */
  speeds: [3.0, 4.2, 3.6, 4.8, 3.3, 4.5] as readonly number[],
  /** Pile values. */
  coin: 10,
  bill: 50,
  /**
   * Pile collision radius against statics / the arena bounds (piles pass under bodies). Just under
   * CHARACTER.radius on purpose: a pile can only slide through gaps a raccoon fits through and
   * only rests where a raccoon can stand within pickupRadius of it, so no pile is ever stranded.
   */
  radius: 0.4,
  /** A pile slower than this (m/s) comes to rest (vel = 0). */
  restSpeed: 0.05,
  /** 'ring' bursts: landing radius per symmetric index as a fraction of [ring.min, ring.max] (cycled). */
  ringFracs: [0, 1, 0.5] as readonly number[],
  /** Dash bonk on a breakable: centre-to-box gap allowance beyond the character radius (m). */
  dashHitGap: 0.1,
  /** Coins popped by a hit that does not break a breakable come out this far outside its face (m). */
  popMargin: 0.3,
  /**
   * Police: a bag of at least this value counts as carrying (observe / chase / lunge / tackle),
   * like held loot (queries.policeCarrying). 10 = any non-empty bag (content-plan §3.5); a tuning
   * knob for the §8 tackle-rate target (C11).
   */
  policeBagMin: 10,
} as const;

/** [C1] Breakables (content-plan §3.1). Removable statics reusing the fence static-removal path. */
export const BREAKABLE_SPECS: Readonly<Record<BreakableKind, { hp: number; inner: number; half: Vec2; height: number }>> = {
  crate: { hp: 1, inner: 20, half: { x: 0.45, y: 0.45 }, height: 0.9 },
  vending: { hp: 3, inner: 60, half: { x: 0.6, y: 0.5 }, height: 1.9 },
};

/** [C1] Damage per hit source on a breakable. */
export const BREAKABLE_DAMAGE = { dash: 1, hammer: 3, stomper: 1, quake: 1 } as const;

/** [C3] One prop row (content-plan §4.3 PROP_SPECS). */
export interface PropSpec {
  /** Nav / grab / carry class (AI ripple stays small). */
  kind: SafeKind;
  shape: 'box' | 'circle';
  /** Box half extents; circle: { x: r, y: r } (OBB grab and zone tests use the bounding square). */
  half: Vec2;
  mass: number;
  drag: number;
  /** Uproot time of valid pulling by one character; 0 = free-standing (starts unanchored). */
  uprootTicks: number;
  /** Shell value (LootState.baseValue). */
  shell: number;
  /** Coins inside at build (LootState.innerValue) as piles: count of 10s and 50s. */
  inner: { c10: number; c50: number };
  /** A dashing character skips softPushFactor against it (kickable ball). */
  kickable: boolean;
  height: number;
}

/** [C3] Prop specs per variant (content-plan §3.1 / §4.3). */
export const PROP_SPECS: Readonly<Record<PropVariant, PropSpec>> = {
  atm: { kind: 'largeSafe', shape: 'box', half: { x: 0.55, y: 0.45 }, mass: 90, drag: 3.75, uprootTicks: secondsToTicks(3), shell: 100, inner: { c10: 10, c50: 0 }, kickable: false, height: 1.6 },
  piggy: { kind: 'largeSafe', shape: 'circle', half: { x: 0.75, y: 0.75 }, mass: 60, drag: 1.2, uprootTicks: 0, shell: 0, inner: { c10: 10, c50: 4 }, kickable: true, height: 1.3 },
  moneyTree: { kind: 'largeSafe', shape: 'box', half: { x: 1.2, y: 0.4 }, mass: 110, drag: 3.75, uprootTicks: secondsToTicks(2.5), shell: 100, inner: { c10: 0, c50: 4 }, kickable: false, height: 2.6 },
  goldSafe: { kind: 'largeSafe', shape: 'box', half: { x: 0.75, y: 0.65 }, mass: 140, drag: 3.75, uprootTicks: secondsToTicks(2.5), shell: 400, inner: { c10: 0, c50: 0 }, kickable: false, height: 1.4 },
};

/** [C3] Prop behaviour (content-plan §3.1). */
export const PROP_RULES = {
  atm: {
    /** Uproot-progress thresholds that spurt coins, and coins per spurt. */
    spurtAt: [1 / 3, 2 / 3] as readonly number[],
    spurtCoins: 2,
    /** Dash bonk: approach >= bonkSpeed, per-ATM cooldown, coins per bonk. */
    bonkSpeed: 4,
    bonkCooldownTicks: secondsToTicks(0.5),
    bonkCoins: 2,
    hammerCoins: 3,
    hammerProgress: 0.5,
  },
  piggy: {
    /** Restitution of a dash kick (with the full-mass hit: about 6 m of travel on flat ground). */
    kickRestitution: 0.3,
    cracksToSmash: 3,
    /** A dash kick by the team opposing whoever touched it last (kick or grab); teammates never crack it. */
    dashCracks: 1,
    hammerCracks: 2,
    wallCrackSpeed: 5,
    /** One knock = one crack: further wall cracks wait this long (contacts re-report while settling). */
    wallCrackDebounceTicks: secondsToTicks(0.3),
    hazardCracks: 1,
  },
  /** One dash counts once per prop: further contacts of the same dasher wait this long. */
  dashHitDebounceTicks: secondsToTicks(0.3),
  moneyTree: {
    /** One bundle sheds per impact faster than this (debounced). */
    shedSpeed: 2.5,
    shedDebounceTicks: secondsToTicks(0.3),
    hammerBundles: 2,
    hammerProgress: 0.4,
  },
  /** The gold safe takes the hammer like a large safe. */
  goldSafe: {
    hammerProgress: 0.5,
  },
} as const;

/** [C2] Per-item specs (content-plan §5.2). Ticks unless noted. */
export interface ItemSpec {
  uses: number;
  /** Lifetime after pickup (ITEM_FOREVER = until the match ends). */
  lifetimeTicks: number;
  cooldownTicks: number;
}

/** [C2] Items, drops and decks (content-plan §5.2). */
export const ITEMS = {
  specs: {
    hammer: { uses: 5, lifetimeTicks: secondsToTicks(25), cooldownTicks: secondsToTicks(0.75) },
    goldHammer: { uses: 8, lifetimeTicks: ITEM_FOREVER, cooldownTicks: secondsToTicks(0.75) },
    plunger: { uses: 2, lifetimeTicks: secondsToTicks(30), cooldownTicks: secondsToTicks(0.75) },
    skates: { uses: ITEM_FOREVER, lifetimeTicks: secondsToTicks(10), cooldownTicks: 0 },
    soap: { uses: 3, lifetimeTicks: secondsToTicks(20), cooldownTicks: secondsToTicks(0.75) },
    balloons: { uses: 3, lifetimeTicks: secondsToTicks(20), cooldownTicks: 0 },
    smoke: { uses: 2, lifetimeTicks: secondsToTicks(30), cooldownTicks: secondsToTicks(0.75) },
  } as Readonly<Record<ItemKind, ItemSpec>>,
  hammer: {
    windupTicks: 6,
    swingTicks: 9,
    lungeSpeed: 7,
    recoverTicks: secondsToTicks(0.4),
    reach: 1.7,
    halfAngle: deg(70),
    knockdownTicks: 60,
    knockbackSpeed: 9,
    /** A protected rival is only shoved (no spill, no stunlock). */
    protectedShoveSpeed: 3,
    policeStunTicks: secondsToTicks(3),
    /** Uproot progress per hit (fraction of the uproot time). */
    progress: { smallSafe: 1.0, largeSafe: 0.5, bank: 0.25 } as Readonly<Record<'smallSafe' | 'largeSafe' | 'bank', number>>,
    /** 은행 종 치기: free interior safes pushed toward the nearest door; anchored ones gain progress. */
    bankBellSafeSpeed: 1.5,
    bankBellProgress: 0.35,
    carriedSmallSafeFly: 2.5,
    breakableDamage: 3,
    fenceHits: 2,
    truckDoorDamage: 2,
    /** Drive multiplier during the recovery (the wind-up and swing have no drive). */
    recoverDriveScale: 0.5,
    /** A swing that lands keeps this fraction of the lunge (the bonk stops you, like a dash hit). */
    hitRecoil: 0.3,
    /** Hammer vs hammer (챙!): both bounce back at this speed (m/s). */
    clashBounceSpeed: 4,
  },
  goldHammer: { reach: 2.1, halfAngle: deg(80), knockbackScale: 1.5, policeStunTicks: secondsToTicks(4) },
  plunger: {
    aimTicks: secondsToTicks(0.2),
    speed: 25,
    range: 8,
    yankMax: 9,
    yankPerMeter: 2.5,
    autoGrabTicks: secondsToTicks(0.6),
    rivalPull: 3,
    dizzyTicks: secondsToTicks(0.4),
    anchoredProgress: 0.5,
    zipSpeed: 12,
    zipStopShort: 0.6,
  },
  skates: {
    burstTicks: secondsToTicks(0.5),
    carryBoostTicks: secondsToTicks(1.2),
    carryBoostMultiplier: 3.0,
    walkSpeed: 6.5,
    dashCooldownTicks: secondsToTicks(2),
    turnRate: 6,
    crashSpeed: 6,
    crashKnockdownTicks: secondsToTicks(0.5),
  },
  soap: {
    slickRadius: 1.6,
    slickTicks: secondsToTicks(10),
    dragScale: 0.15,
    driveScale: 0.35,
    policeSlipSpeed: 3.5,
    policeSlipStunTicks: secondsToTicks(1.2),
    homeRunScale: 2,
  },
  drop: {
    /** Mirrored pad pairs drop at these match times (s). */
    pairs: [15, 70, 125, 160] as readonly number[],
    /** The axis pad drops at these match times (s). */
    center: [45, 100] as readonly number[],
    warnTicks: secondsToTicks(3),
    maxOnField: 4,
    groundLifetime: secondsToTicks(30),
    /** 황금 뿅망치 on the axis pad: final countdown + 8 s, or end − 35 s without a countdown; announced 3 s ahead. */
    goldHammer: { afterCountdownTicks: secondsToTicks(8), beforeEndTicks: secondsToTicks(35), announceTicks: secondsToTicks(3) },
    /** Pickup by touch within this center distance. */
    pickupRadius: 0.9,
  },
  /** Deck used by rules.items 'on' (wave 1: 'wave1' = hammers only; wave 2 switches to 'wave2'). */
  onDeck: 'wave1' as 'wave1' | 'wave2',
  /** Seeded decks (shuffle without replacement, refilled when empty; twins always match). */
  decks: {
    wave1: ['hammer'] as readonly ItemKind[],
    wave2: ['hammer', 'hammer', 'plunger', 'skates', 'soap'] as readonly ItemKind[],
    hammerOnly: ['hammer'] as readonly ItemKind[],
  },
} as const;

/** [C4] Gimmick shared defaults (content-plan §5.3). Per-instance values live in GimmickDef. */
export const GIMMICKS = {
  belt: { speed: 2.2, laneWidth: 1.2 },
  fountainShow: { firstTick: secondsToTicks(30), periodTicks: secondsToTicks(40), telegraphTicks: secondsToTicks(2), radius: 4.5, push: 6, piggyCracks: 1 },
  tube: { transitTicks: secondsToTicks(3), exitSpeed: 3 },
  catapult: { flightTicks: secondsToTicks(1.1), cooldownTicks: secondsToTicks(3), pedalSpeed: 6, landShort: 5 },
  crane: {
    holdTicks: secondsToTicks(1),
    liftTicks: secondsToTicks(1.2),
    swingTicks: secondsToTicks(4.5),
    lowerTicks: secondsToTicks(1),
    cooldownTicks: secondsToTicks(15),
    dropDistance: 8,
  },
  stomper: { periodTicks: secondsToTicks(7), telegraphTicks: secondsToTicks(1), radius: 2.6, progress: 0.35, breakableDamage: 1 },
  teacup: { radius: 4.5, stepAngle: deg(90), moveTicks: secondsToTicks(1.5), restTicks: secondsToTicks(3) },
  rink: { dragScale: 0.3, driveScale: 0.3 },
  bumperCar: { knockback: 5 },
  wheel: { gondolas: 8, gondolaTicks: secondsToTicks(6), windowTicks: secondsToTicks(3) },
} as const;

/** [C5] Mid-match events (content-plan §5.4). */
export const EVENTS = {
  /** Loot event fires at a tick uniform in this window (s). */
  lootWindow: [75, 110] as readonly [number, number],
  warnTicks: secondsToTicks(5),
  /** Countdown started before the loot event fired: fire at countdown + this, with a short warning. */
  countdownFireDelay: secondsToTicks(3),
  countdownWarnTicks: secondsToTicks(3),
  quakeChance: 0.5,
  quakeWindow: [130, 175] as readonly [number, number],
  /** Quake at least this long after the loot event. */
  quakeGapTicks: secondsToTicks(30),
  quakeWarnTicks: secondsToTicks(3),
  quakeTicks: secondsToTicks(4),
  quakeProgress: 0.5,
  quakeBreakableDelayTicks: secondsToTicks(1),
  quakeMoveScale: 0.8,
  /** Value of every loot event. */
  lootValue: 400,
  moneyRain: { bills: 8, ringMin: 6, ringMax: 9, pairIntervalTicks: secondsToTicks(0.25) },
  goldSafe: { shadowTicks: secondsToTicks(5), bonkRadius: 1 },
  truckDoorHp: 5,
  truckAutoOpen: secondsToTicks(30),
  truckLeaveTicks: secondsToTicks(3),
  truckBills: 8,
} as const;
