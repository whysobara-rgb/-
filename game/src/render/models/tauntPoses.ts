/**
 * Taunt animations for the raccoon rig (owner addition: cute, player-triggered taunts).
 *
 * Pure math, no three.js: `tauntPose(id, t, dur)` returns the full-body target pose of a taunt
 * `t` seconds in; the rig (raccoon.ts) blends it over its regular pose with a weight that fades
 * in fast and out fast (a cancel blends out from the last frame). Every taunt is authored on its
 * nominal length (EMOTE.durationTicks) and time-scaled to the duration it is actually given.
 *
 * Built for the 55° match camera at 20–29 m: big silhouette changes (bows, squats, raised arms,
 * a fan of banknotes, a tail that sweeps the whole body width), an anticipation beat, overshoot
 * and squash on the hits, and a face change. Original choreography from general animation
 * principles only.
 *
 * Conventions (raccoon-local, the model faces +X):
 *   lean   body.rotation.z   + leans back, - bows forward
 *   roll   body.rotation.x   + tips toward the right paw (+Z)
 *   twist  body.rotation.y   + turns left
 *   arm.fwd  rotation.z (swing forward/up; π = straight up), arm.out (spread away from the body),
 *   arm.inward (twist toward the middle), lift (shoulder shrug, m), stretch (scale along the
 *   arm), bulge (scale across it)
 *   leg.fwd  rotation.z (swing forward), leg.out (spread), lift (m)
 *   head.pitch (+ looks up), head.yaw (+ turns left), head.roll (+ tilts toward +Z)
 *   tail: [yaw, lift] per segment (tail1..3 rotation.y / rotation.z; more negative lift = more upright)
 */
import type { EmoteId } from '../../sim/types';
import { EMOTE, TICK_RATE } from '../../sim/config';
import type { FaceExpression } from './textures';

export interface TauntArm {
  fwd: number;
  out: number;
  inward: number;
  lift: number;
  stretch: number;
  bulge: number;
}

export interface TauntLeg {
  fwd: number;
  out: number;
  lift: number;
}

export interface TauntPose {
  pivotY: number;
  pivotYaw: number;
  lean: number;
  roll: number;
  twist: number;
  bodyX: number;
  bodyZ: number;
  sx: number;
  sy: number;
  sz: number;
  armL: TauntArm;
  armR: TauntArm;
  legL: TauntLeg;
  legR: TauntLeg;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** Head sinks into the shoulders (m, negative = down). */
  neckY: number;
  /** tail1..3: [yaw, lift] each. */
  tail: [number, number, number, number, number, number];
  face: FaceExpression;
  // --- props (0 = hidden) ---
  /** 3D tongue out (메롱). */
  tongue: number;
  /** Tongue wiggle angle (rad). */
  tongueWag: number;
  /** Fan of banknotes in the right paw (scale 0..~1.1, overshoots on the pop). */
  fan: number;
  /** Fanning flap around the arm axis (rad). */
  fanWave: number;
  /** Little banknotes fluttering down beside the fan. */
  bills: number;
  /** Gold glint on the paws (근육 자랑), and its spin (rad). */
  glint: number;
  glintSpin: number;
  /** Star sparkles around the feet; phase 0..1 of the current burst and its index. */
  sparkle: number;
  sparklePhase: number;
  sparkleBurst: number;
  /** Speed lines behind the body (후다닥 포즈). */
  speed: number;
}

/** Nominal length of every taunt in seconds (the sim's EMOTE.durationTicks). */
export const TAUNT_SECONDS: Readonly<Record<EmoteId, number>> = Object.fromEntries(
  (Object.keys(EMOTE.durationTicks) as EmoteId[]).map((id) => [id, EMOTE.durationTicks[id] / TICK_RATE]),
) as Record<EmoteId, number>;

/** Faces each taunt uses (tests, portraits). */
export const TAUNT_FACES: Readonly<Record<EmoteId, readonly FaceExpression[]>> = {
  wiggle: ['cheeky'],
  bleh: ['bleh'],
  fanCash: ['smug'],
  squatBounce: ['happy', 'cheeky'],
  hodadakZoom: ['determined', 'cheeky'],
  tongkeunFlex: ['proud'],
  nunchiShrug: ['smug'],
};

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number): number => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/** 0 -> 1 with an overshoot (back-out) between a and b. */
const pop = (a: number, b: number, x: number, s = 1.9): number => {
  const k = clamp01((x - a) / (b - a));
  const q = k - 1;
  return 1 + (s + 1) * q * q * q + s * q * q;
};
/** 0 -> 1 -> 0 hump over [a, b]. */
const bump = (a: number, b: number, x: number): number => (x <= a || x >= b ? 0 : Math.sin(Math.PI * ((x - a) / (b - a))));
/** Main envelope: pops in by `inEnd`, holds, eases out over [outA, outB]. */
const envelope = (x: number, inA: number, inEnd: number, outA: number, outB: number): number => pop(inA, inEnd, x) * (1 - sstep(outA, outB, x));
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

const NEUTRAL_ARM_OUT = 0.22;

function arm(): TauntArm {
  return { fwd: 0, out: NEUTRAL_ARM_OUT, inward: 0, lift: 0, stretch: 1, bulge: 1 };
}

/** A fresh neutral pose (identical to the rig's idle stance). */
export function neutralTauntPose(): TauntPose {
  return {
    pivotY: 0,
    pivotYaw: 0,
    lean: 0,
    roll: 0,
    twist: 0,
    bodyX: 0,
    bodyZ: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    armL: arm(),
    armR: arm(),
    legL: { fwd: 0, out: 0, lift: 0 },
    legR: { fwd: 0, out: 0, lift: 0 },
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    neckY: 0,
    tail: [0.35, -0.42, 0, -0.45, 0, -0.55],
    face: 'normal',
    tongue: 0,
    tongueWag: 0,
    fan: 0,
    fanWave: 0,
    bills: 0,
    glint: 0,
    glintSpin: 0,
    sparkle: 0,
    sparklePhase: 0,
    sparkleBurst: 0,
    speed: 0,
  };
}

function reset(o: TauntPose): TauntPose {
  const n = neutralTauntPose();
  Object.assign(o, n);
  return o;
}

/**
 * Target pose of taunt `id`, `t` seconds after it started, for a taunt lasting `dur` seconds
 * (default: its nominal length). Writes into `out` when given.
 */
export function tauntPose(id: EmoteId, t: number, dur?: number, out?: TauntPose): TauntPose {
  const o = out ? reset(out) : neutralTauntPose();
  const nominal = TAUNT_SECONDS[id] ?? 1.4;
  const d = dur && dur > 0.05 ? dur : nominal;
  // Author on the nominal clock.
  const T = Math.max(0, Number.isFinite(t) ? t : 0) * (nominal / d);
  switch (id) {
    case 'wiggle':
      wiggle(o, T);
      break;
    case 'bleh':
      bleh(o, T);
      break;
    case 'fanCash':
      fanCash(o, T);
      break;
    case 'squatBounce':
      squatBounce(o, T);
      break;
    case 'hodadakZoom':
      zoom(o, T);
      break;
    case 'tongkeunFlex':
      flex(o, T);
      break;
    case 'nunchiShrug':
      shrug(o, T);
      break;
  }
  return o;
}

/**
 * 엉덩이 흔들기: back to the rival (the view turns the body away), a little crouch, then a deep
 * bow with the bottom swaying side to side at 4 Hz, the big tail sweeping in counter-phase and a
 * cheeky wink over the shoulder.
 */
function wiggle(o: TauntPose, T: number): void {
  const ant = bump(0, 0.24, T);
  const e = envelope(T, 0.1, 0.34, 1.32, 1.6);
  const ph = (T - 0.2) * TAU * 4;
  const sw = Math.sin(ph);
  o.pivotY = -0.06 * ant + e * 0.025 * Math.abs(sw);
  o.lean = -0.55 * e + 0.05 * ant;
  o.roll = e * sw * 0.32;
  o.twist = e * (0.42 + sw * 0.1);
  o.bodyZ = e * sw * 0.05;
  o.sy = 1 - 0.08 * ant + e * 0.03 * Math.cos(ph * 2);
  o.sx = o.sz = 1 + 0.05 * ant;
  // Feet stay planted under the bowing body.
  o.legL = { fwd: 0.55 * e + Math.max(0, sw) * 0.12 * e, out: 0.18 * e, lift: Math.max(0, -sw) * 0.02 * e };
  o.legR = { fwd: 0.55 * e + Math.max(0, -sw) * 0.12 * e, out: 0.18 * e, lift: Math.max(0, sw) * 0.02 * e };
  // Paws on the hips.
  for (const a of [o.armL, o.armR]) {
    a.fwd = -0.5 * e;
    a.out = NEUTRAL_ARM_OUT + 0.6 * e;
    a.inward = -0.2 * e;
  }
  o.headYaw = 1.75 * e;
  o.headPitch = 0.5 * e + 0.04 * Math.sin(ph * 2) * e;
  o.headRoll = e * (0.2 + 0.08 * sw);
  o.tail = [
    mix(0.35, Math.sin(ph + 0.7) * 0.95, e),
    -0.42 - 0.42 * e,
    Math.sin(ph - 0.2) * 0.75 * e,
    -0.45 - 0.12 * e,
    Math.sin(ph - 0.9) * 0.6 * e,
    -0.55,
  ];
  o.face = 'cheeky';
}

/**
 * 메롱: lean back (anticipation), then snap forward with the head tipped toward the right paw,
 * which tugs the lower eyelid down; the tongue pops out and the head wobbles "nyah-nyah".
 */
function bleh(o: TauntPose, T: number): void {
  const ant = bump(0, 0.2, T);
  const e = envelope(T, 0.12, 0.3, 0.98, 1.2);
  const nyah = Math.sin((T - 0.3) * TAU * 3.2) * sstep(0.3, 0.4, T);
  o.lean = 0.14 * ant - 0.16 * e;
  o.roll = 0.16 * e;
  o.pivotY = -0.035 * ant;
  o.sy = 1 - 0.06 * ant + 0.03 * e;
  o.headRoll = e * (0.45 + nyah * 0.09);
  o.headPitch = 0.22 * ant - 0.04 * e;
  o.headYaw = e * (nyah * 0.13 - 0.12);
  // Right paw up to the eye (stretched a little: toy arms are short).
  o.armR = { fwd: 2.6 * e, out: mix(NEUTRAL_ARM_OUT, -0.12, e), inward: 0.55 * e, lift: 0.035 * e, stretch: 1 + 0.32 * e, bulge: 1 };
  // Left paw on the hip.
  o.armL.fwd = -0.35 * e;
  o.armL.out = NEUTRAL_ARM_OUT + 0.55 * e;
  // A cheeky back kick of the left foot.
  o.legL = { fwd: -0.6 * e, out: 0.05 * e, lift: 0.04 * e };
  o.legR = { fwd: 0.06 * e, out: 0, lift: 0 };
  o.tongue = sstep(0.14, 0.26, T) * (1 - sstep(0.96, 1.1, T));
  o.tongueWag = Math.sin(T * 26) * 0.35;
  o.tail[0] = 0.35 + Math.sin(T * 9) * 0.3 * e;
  o.face = 'bleh';
}

/**
 * 돈다발 부채질: the right paw reaches behind, whips out a fan of banknotes with a pop, then fans
 * the face smugly (leaning back, chin up, other paw on the hip) while notes flutter down.
 */
function fanCash(o: TauntPose, T: number): void {
  const reach = sstep(0, 0.24, T) * (1 - sstep(0.26, 0.4, T));
  const held = sstep(0.26, 0.4, T) * (1 - sstep(1.5, 1.72, T));
  const e = envelope(T, 0.18, 0.42, 1.52, 1.8);
  const f = Math.sin((T - 0.4) * TAU * 3) * sstep(0.38, 0.5, T);
  o.armR = {
    fwd: -0.95 * reach + held * (1.75 + 0.16 * f),
    out: mix(NEUTRAL_ARM_OUT, 0.05, held),
    inward: held * (0.35 + 0.32 * f),
    lift: 0.025 * held,
    stretch: 1,
    bulge: 1,
  };
  o.fan = Math.max(0, pop(0.27, 0.44, T, 2.4)) * (1 - sstep(1.48, 1.66, T));
  o.fanWave = f * 0.65;
  o.bills = sstep(0.45, 0.6, T) * (1 - sstep(1.45, 1.7, T));
  o.armL.fwd = -0.3 * e;
  o.armL.out = NEUTRAL_ARM_OUT + 0.6 * e;
  o.lean = 0.2 * e - 0.08 * reach;
  o.twist = 0.12 * reach - 0.08 * e;
  o.sx = o.sz = 1 + 0.045 * e;
  o.sy = 1 + 0.02 * e;
  o.headPitch = 0.27 * e;
  o.headYaw = -0.22 * e;
  o.headRoll = -0.1 * e + f * 0.035;
  // Casual crossed stance.
  o.legR = { fwd: 0.18 * e, out: -0.12 * e, lift: 0 };
  o.legL = { fwd: -0.05 * e, out: 0.05 * e, lift: 0 };
  o.tail[0] = 0.35 + Math.sin(T * 3.5) * 0.25 * e;
  o.face = 'smug';
}

/** Squat curve of one bounce: +1 = deepest squat, negative = springy stretch. */
function squatCurve(u: number): number {
  if (u < 0.28) return sstep(0, 0.28, u);
  if (u < 0.4) return 1;
  if (u < 0.58) return 1 - 1.38 * sstep(0.4, 0.58, u);
  return -0.38 * (1 - sstep(0.58, 1, u));
}

/** Period / count of the 쭈그려 뛰기 bounces. */
export const SQUAT_BOUNCE = { start: 0.1, period: 0.34, count: 4 } as const;

/**
 * 쭈그려 뛰기: four quick crouch-and-spring bounces, squashing wide at the bottom and stretching
 * tall on the way up ("boing"), arms out for balance, head tipping left/right on alternate
 * bounces, little star sparkles popping at each bottom.
 */
function squatBounce(o: TauntPose, T: number): void {
  const { start, period, count } = SQUAT_BOUNCE;
  const e = envelope(T, 0.0, 0.14, start + period * count - 0.02, start + period * count + 0.14);
  const x = (T - start) / period;
  const k = Math.max(0, Math.min(count - 1, Math.floor(x)));
  const u = x < 0 ? 0 : x >= count ? 1 : x - Math.floor(x);
  const s = x < 0 ? 0 : squatCurve(u);
  const dn = Math.max(0, s);
  const upS = Math.max(0, -s);
  o.pivotY = e * (-0.19 * dn + 0.09 * upS);
  o.sy = 1 + e * (-0.27 * dn + 0.13 * upS);
  o.sx = o.sz = 1 + e * (0.2 * dn - 0.06 * upS);
  o.lean = -0.14 * dn * e;
  o.legL = { fwd: 0.55 * dn * e, out: 0.5 * dn * e, lift: 0 };
  o.legR = { fwd: 0.55 * dn * e, out: 0.5 * dn * e, lift: 0 };
  for (const a of [o.armL, o.armR]) {
    a.fwd = e * (0.75 + 0.5 * dn);
    a.out = NEUTRAL_ARM_OUT + e * (0.55 - 0.25 * dn);
  }
  const side = k % 2 ? 1 : -1;
  o.headRoll = e * 0.24 * side * sstep(0, 0.3, u);
  o.headPitch = e * (0.14 - 0.18 * upS);
  o.tail = [0.35 + Math.sin(T * 14) * 0.45 * e, -0.42 - 0.35 * upS * e, Math.sin(T * 14 - 0.7) * 0.35 * e, -0.45, 0, -0.55];
  // Sparkles burst from each bottom.
  const sp = u >= 0.3 ? (u - 0.3) / 0.6 : -1;
  o.sparkle = x >= 0 && x < count && sp >= 0 && sp <= 1 ? e : 0;
  o.sparklePhase = clamp01(sp);
  o.sparkleBurst = k;
  o.face = dn > 0.35 ? 'happy' : 'cheeky';
}

/**
 * 후다닥 포즈: legs and arms blur through a sprint in place (speed lines streaming behind), then a
 * skidding stop into a pose: knee up, paw pointing ahead, a big grin.
 */
function zoom(o: TauntPose, T: number): void {
  const run = sstep(0, 0.1, T) * (1 - sstep(0.6, 0.72, T));
  const p = Math.max(0, pop(0.64, 0.8, T, 2.2)) * (1 - sstep(1.2, 1.4, T));
  const ph = T * 34;
  const s = Math.sin(ph);
  o.legL = { fwd: s * 1.15 * run - 0.2 * p, out: 0.04 * p, lift: Math.max(0, Math.cos(ph)) * 0.05 * run };
  o.legR = { fwd: -s * 1.15 * run + 1.25 * p, out: 0, lift: Math.max(0, -Math.cos(ph)) * 0.05 * run + 0.05 * p };
  o.armL = { fwd: -s * 1.3 * run - 1.0 * p, out: NEUTRAL_ARM_OUT + 0.45 * p, inward: 0, lift: 0, stretch: 1, bulge: 1 };
  o.armR = { fwd: s * 1.3 * run + 2.3 * p, out: NEUTRAL_ARM_OUT - 0.1 * p, inward: 0.15 * p, lift: 0.02 * p, stretch: 1 + 0.1 * p, bulge: 1 };
  o.lean = -0.36 * run + 0.12 * p;
  o.bodyX = Math.sin(T * 61) * 0.012 * run;
  o.pivotY = Math.abs(s) * 0.05 * run + 0.03 * p;
  o.sy = 1 + 0.06 * p - 0.04 * run * Math.abs(Math.cos(ph));
  o.twist = -0.28 * p;
  o.headPitch = 0.16 * p - 0.1 * run;
  o.headRoll = -0.2 * p;
  o.headYaw = 0.3 * p;
  o.tail = [Math.sin(ph * 0.5) * 0.25 * run + 0.35 * (1 - run), -0.42 + 0.25 * run, 0, -0.45 + 0.2 * run, 0, -0.55];
  o.speed = Math.max(run, p * (1 - sstep(0.8, 1.15, T)));
  o.face = run > 0.4 ? 'determined' : 'cheeky';
}

/**
 * 근육 자랑: arms tuck in and the body crouches (anticipation), then both arms snap up and out
 * into a double-arm flex, chest puffed, chin up; three pumps bulge the arms and flash a gold
 * glint.
 */
function flex(o: TauntPose, T: number): void {
  const ant = bump(0, 0.3, T);
  const e = Math.max(0, pop(0.24, 0.44, T, 2)) * (1 - sstep(1.55, 1.8, T));
  const pumpT = (T - 0.46) / 0.36;
  const p = T > 0.46 && T < 1.54 ? Math.pow(Math.max(0, Math.sin(Math.PI * (pumpT - Math.floor(pumpT)))), 2) : 0;
  for (const a of [o.armL, o.armR]) {
    a.out = NEUTRAL_ARM_OUT - 0.25 * ant + e * (1.95 - 0.18 * p);
    a.fwd = 0.35 * ant - 0.12 * e;
    a.inward = -0.25 * e;
    a.bulge = 1 + e * (0.25 + 0.22 * p);
    a.stretch = 1 - 0.06 * e * p;
    a.lift = 0.03 * e;
  }
  o.lean = 0.15 * e - 0.07 * ant;
  o.sx = 1 + 0.12 * e + 0.035 * p * e;
  o.sz = 1 + 0.1 * e;
  o.sy = 1 + 0.04 * e - 0.07 * ant;
  o.pivotY = -0.05 * ant + 0.02 * p * e;
  o.headPitch = 0.3 * e;
  o.headYaw = Math.sin(T * 2.4) * 0.2 * e;
  o.legL = { fwd: 0, out: 0.24 * e, lift: 0 };
  o.legR = { fwd: 0, out: 0.24 * e, lift: 0 };
  o.glint = p * e;
  o.glintSpin = T * 5;
  o.tail[1] = -0.42 - 0.2 * e;
  o.face = ant > 0.5 ? 'determined' : 'proud';
}

/**
 * 어깨 으쓱: a slow, unbothered shrug: shoulders rise, paws open palms-up, head tilts with a
 * half-lidded smirk, a tiny double bob at the top, then a lazy drop.
 */
function shrug(o: TauntPose, T: number): void {
  const up = sstep(0.12, 0.55, T);
  const down = sstep(1.05, 1.38, T);
  const e = up * (1 - down);
  const bob = T > 0.55 && T < 1.05 ? Math.sin(((T - 0.55) / 0.25) * TAU) * 0.5 : 0;
  for (const a of [o.armL, o.armR]) {
    a.fwd = 0.8 * e;
    a.out = NEUTRAL_ARM_OUT + 0.95 * e;
    a.inward = -0.3 * e;
    a.lift = e * (0.05 + 0.014 * bob);
  }
  o.neckY = -0.03 * e;
  o.headRoll = 0.3 * e;
  o.headPitch = -0.06 * e + 0.02 * bob * e;
  o.headYaw = 0.22 * e;
  o.twist = 0.12 * e;
  o.lean = 0.05 * e;
  o.sy = 1 - 0.02 * e + 0.01 * bob * e;
  o.tail[0] = 0.35 + Math.sin(T * 3) * 0.32 * e;
  o.face = 'smug';
}
