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
  /** Fingertip pressing the lower eyelid down (메롱), 0..1. */
  finger: number;
  /** Forearms folded up from the elbow (근육 자랑: the rig has no elbow, so a forearm prop folds up from the paw end of each arm), 0..1. */
  forearm: number;
  /** Landing ring on the ground (쭈그려 뛰기): 0 = hidden, else its strength; phase 0..1 as it spreads. */
  ring: number;
  ringPhase: number;
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
  tongkeunFlex: ['determined', 'proud'],
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
    finger: 0,
    forearm: 0,
    ring: 0,
    ringPhase: 0,
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
 * 엉덩이 흔들기: back to the rival (the view turns the body away), a little crouch, then a bow
 * with the hips swinging side to side under a steady head (the upper body counter-tilts), the
 * whole bottom swivelling around the hips so the pear silhouette visibly twists from the high
 * camera, the big tail sweeping wide in counter-phase and a cheeky wink over the shoulder.
 */
function wiggle(o: TauntPose, T: number): void {
  const ant = bump(0, 0.24, T);
  const e = envelope(T, 0.1, 0.34, 1.32, 1.6);
  const ph = (T - 0.22) * TAU * 3.2;
  const sw = Math.sin(ph);
  // Hips out to the side, upper body tilting back over them so the head barely moves.
  const hip = e * sw * 0.17;
  o.bodyZ = hip;
  o.roll = -hip / 0.62;
  o.pivotY = -0.06 * ant + e * 0.03 * Math.abs(Math.cos(ph));
  o.lean = -0.34 * e + 0.05 * ant;
  // Swivel: the bottom turns with each swing (reads from above).
  o.twist = e * (0.18 + sw * 0.32);
  o.sy = 1 - 0.08 * ant + e * 0.03 * Math.cos(ph * 2);
  o.sx = o.sz = 1 + 0.05 * ant + 0.04 * e;
  // Feet planted wide under the bowing body.
  o.legL = { fwd: 0.34 * e + Math.max(0, sw) * 0.1 * e, out: 0.24 * e, lift: Math.max(0, -sw) * 0.02 * e };
  o.legR = { fwd: 0.34 * e + Math.max(0, -sw) * 0.1 * e, out: 0.24 * e, lift: Math.max(0, sw) * 0.02 * e };
  // Paws on the knees, elbows out.
  for (const a of [o.armL, o.armR]) {
    a.fwd = 0.35 * e;
    a.out = NEUTRAL_ARM_OUT + 0.55 * e;
    a.inward = -0.2 * e;
  }
  // Look back over the shoulder at the rival, holding the gaze while the body swivels.
  o.headYaw = e * (1.5 - sw * 0.32);
  o.headPitch = 0.3 * e + 0.04 * Math.sin(ph * 2) * e;
  o.headRoll = e * 0.2 + hip * 1.2;
  // Tail: raised high and sweeping across the whole body width, lagging the hips.
  o.tail = [
    mix(0.35, Math.sin(ph - 0.5) * 1.15, e),
    -0.42 - 0.55 * e,
    Math.sin(ph - 1.1) * 0.8 * e,
    -0.45 - 0.2 * e,
    Math.sin(ph - 1.7) * 0.65 * e,
    -0.55,
  ];
  o.face = 'cheeky';
}

/**
 * 메롱: lean back (anticipation), then snap forward with the head tipped toward the right paw;
 * the paw comes up under the right eye and a fingertip drags the lower eyelid down (the face
 * shows the pink under-lid), the tongue pops out and the head wobbles "nyah-nyah".
 */
function bleh(o: TauntPose, T: number): void {
  const ant = bump(0, 0.2, T);
  const e = envelope(T, 0.12, 0.3, 0.98, 1.2);
  const nyah = Math.sin((T - 0.3) * TAU * 3.2) * sstep(0.3, 0.4, T);
  o.lean = 0.14 * ant - 0.18 * e;
  o.roll = 0.2 * e;
  o.pivotY = -0.035 * ant;
  o.sy = 1 - 0.06 * ant + 0.03 * e;
  o.headRoll = e * (0.45 + nyah * 0.07);
  o.headPitch = 0.22 * ant - 0.04 * e;
  o.headYaw = e * (nyah * 0.1 - 0.12);
  // Right paw up under the right eye (fitted to the rig: the paw sits on the cheek below the
  // pulled lid, clear of the eye; toy arms are short, so it stretches a little).
  o.armR = { fwd: 1.7 * e, out: mix(NEUTRAL_ARM_OUT, -0.4, e), inward: 0, lift: 0.06 * e, stretch: 1 + 0.65 * e, bulge: 1 };
  o.finger = sstep(0.22, 0.34, T) * (1 - sstep(0.94, 1.08, T));
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
 * 돈다발 부채질: the right paw reaches behind, whips out a fan of banknotes with a pop, then
 * fans its own face smugly: the paw raised beside the cheek, the fan flapping toward the face,
 * the body leaning back with the hips swaying to the fanning beat, chin up, other paw on the
 * hip, while notes flutter down.
 */
function fanCash(o: TauntPose, T: number): void {
  const reach = sstep(0, 0.24, T) * (1 - sstep(0.26, 0.4, T));
  const held = sstep(0.26, 0.4, T) * (1 - sstep(1.5, 1.72, T));
  const e = envelope(T, 0.18, 0.42, 1.52, 1.8);
  const beat = (T - 0.4) * TAU * 2.6;
  const f = Math.sin(beat) * sstep(0.38, 0.5, T);
  // Paw up beside the right cheek, the fan rising past the side of the head and turned to face
  // it (tilted up so the high camera sees its face too); the wrist flaps it toward the face.
  // Fitted to the rig offline.
  o.armR = {
    fwd: -0.95 * reach + held * (2.0 + 0.16 * f),
    out: mix(NEUTRAL_ARM_OUT, 0.7, held),
    inward: -0.8 * held,
    lift: 0.05 * held,
    stretch: 1 + 0.08 * held,
    bulge: 1,
  };
  o.fan = Math.max(0, pop(0.27, 0.44, T, 2.4)) * (1 - sstep(1.48, 1.66, T));
  o.fanWave = -2.39 * held + f * 0.3;
  o.bills = sstep(0.45, 0.6, T) * (1 - sstep(1.45, 1.7, T));
  o.armL.fwd = -0.3 * e;
  o.armL.out = NEUTRAL_ARM_OUT + 0.7 * e;
  // Lean back, hips swaying with the beat (half time), a little bob on each flap.
  const sway = Math.sin(beat * 0.5) * e;
  o.lean = 0.26 * e - 0.08 * reach;
  o.roll = -0.1 * sway;
  o.bodyZ = 0.05 * sway;
  o.twist = 0.12 * reach - 0.22 * e;
  o.pivotY = -0.02 * Math.abs(f) * e;
  o.sx = o.sz = 1 + 0.045 * e;
  o.sy = 1 + 0.02 * e;
  o.headPitch = 0.3 * e;
  o.headYaw = -0.32 * e;
  o.headRoll = -0.14 * e + f * 0.05 + 0.06 * sway;
  // Casual crossed stance.
  o.legR = { fwd: 0.2 * e, out: -0.14 * e, lift: 0 };
  o.legL = { fwd: -0.05 * e, out: 0.08 * e, lift: 0 };
  o.tail[0] = 0.35 + Math.sin(beat * 0.5) * 0.45 * e;
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
 * 쭈그려 뛰기: four quick crouch-and-hop bounces. Each squat squashes wide and low (a ring
 * puffs out on the ground and star sparkles pop), then the raccoon springs up into a little hop
 * clear of the ground with both arms flung up and out ("boing") — big sideways and up/down
 * changes that read from the high camera, head tipping left / right on alternate bounces.
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
  // Airborne hop between squats (feet leave the ground; the shadow stays).
  const hop = x >= 0 && x < count ? bump(0.5, 0.98, u) : 0;
  o.pivotY = e * (-0.2 * dn + 0.05 * upS + 0.2 * hop);
  o.sy = 1 + e * (-0.3 * dn + 0.15 * upS);
  o.sx = o.sz = 1 + e * (0.3 * dn - 0.07 * upS);
  o.lean = -0.12 * dn * e;
  o.legL = { fwd: 0.55 * dn * e - 0.25 * hop * e, out: 0.55 * dn * e + 0.1 * hop * e, lift: 0 };
  o.legR = { fwd: 0.55 * dn * e - 0.25 * hop * e, out: 0.55 * dn * e + 0.1 * hop * e, lift: 0 };
  // Arms: forward for balance in the squat, flung up and out on the hop.
  const fling = Math.max(upS, hop);
  for (const a of [o.armL, o.armR]) {
    a.fwd = e * (0.7 + 0.45 * dn + 0.5 * fling);
    a.out = NEUTRAL_ARM_OUT + e * (0.35 - 0.15 * dn + 1.05 * fling);
  }
  const side = k % 2 ? 1 : -1;
  o.headRoll = e * 0.3 * side * sstep(0, 0.3, u);
  o.headPitch = e * (0.14 - 0.12 * upS + 0.1 * hop);
  o.tail = [0.35 + Math.sin(T * 14) * 0.55 * e, -0.42 - 0.45 * fling * e, Math.sin(T * 14 - 0.7) * 0.4 * e, -0.45, 0, -0.55];
  // Each landing: sparkles burst and a ring puffs out on the ground.
  const sp = u >= 0.3 ? (u - 0.3) / 0.6 : -1;
  const live = x >= 0 && x < count;
  o.sparkle = live && sp >= 0 && sp <= 1 ? e : 0;
  o.sparklePhase = clamp01(sp);
  o.sparkleBurst = k;
  const rp = u >= 0.22 ? (u - 0.22) / 0.5 : -1;
  o.ring = live && rp >= 0 && rp <= 1 ? e : 0;
  o.ringPhase = clamp01(rp);
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
 * 근육 자랑: arms tuck in and the body crouches (anticipation), then the upper arms snap out level
 * with the shoulders and the forearms fold up into a double-bicep flex (fists beside the head),
 * chest puffed wide, chin up; three pumps squeeze the biceps up and flash a gold glint.
 */
function flex(o: TauntPose, T: number): void {
  const ant = bump(0, 0.3, T);
  const e = Math.max(0, pop(0.24, 0.44, T, 2)) * (1 - sstep(1.55, 1.8, T));
  const pumpT = (T - 0.46) / 0.36;
  const p = T > 0.46 && T < 1.54 ? Math.pow(Math.max(0, Math.sin(Math.PI * (pumpT - Math.floor(pumpT)))), 2) : 0;
  for (const a of [o.armL, o.armR]) {
    a.out = NEUTRAL_ARM_OUT - 0.25 * ant + e * (1.42 + 0.08 * p);
    a.fwd = 0.35 * ant - 0.08 * e;
    a.inward = 0;
    a.bulge = 1 + e * (0.22 + 0.2 * p);
    a.stretch = 1 - 0.05 * e * p;
    a.lift = 0.05 * e + 0.015 * p * e;
  }
  o.forearm = clamp01(e) * (0.92 + 0.08 * p);
  o.lean = 0.16 * e - 0.07 * ant;
  o.sx = 1 + 0.16 * e + 0.04 * p * e;
  o.sz = 1 + 0.18 * e + 0.04 * p * e;
  o.sy = 1 + 0.05 * e - 0.07 * ant;
  o.pivotY = -0.05 * ant + 0.025 * p * e;
  o.headPitch = 0.3 * e;
  o.headYaw = Math.sin(T * 2.4) * 0.2 * e;
  o.legL = { fwd: 0, out: 0.28 * e, lift: 0 };
  o.legR = { fwd: 0, out: 0.28 * e, lift: 0 };
  o.glint = p * e;
  o.glintSpin = T * 5;
  o.tail[1] = -0.42 - 0.2 * e;
  o.face = ant > 0.5 ? 'determined' : 'proud';
}

/**
 * 어깨 으쓱: a slow, unbothered shrug: the shoulders hike up while the head pops up then sinks
 * between them, both paws swing wide open palms-up, the head tilts with a half-lidded smirk and
 * the body sways the other way, a double bob at the top, then a lazy drop.
 */
function shrug(o: TauntPose, T: number): void {
  const up = sstep(0.12, 0.5, T);
  const down = sstep(1.05, 1.38, T);
  const e = up * (1 - down);
  const pop1 = bump(0.1, 0.42, T);
  const bob = T > 0.5 && T < 1.05 ? Math.sin(((T - 0.5) / 0.275) * TAU) : 0;
  // A lazy "meh" head waggle at the top (the hat swivels: reads from above).
  const meh = T > 0.5 && T < 1.05 ? Math.sin(((T - 0.5) / 0.55) * TAU * 1.5) * sstep(0.5, 0.6, T) * (1 - sstep(0.95, 1.05, T)) : 0;
  for (const a of [o.armL, o.armR]) {
    // Wide open, a little above level: the paws stick out past the big head from any camera.
    a.fwd = 0.45 * e;
    a.out = NEUTRAL_ARM_OUT + 1.45 * e;
    a.inward = -0.6 * e;
    a.lift = e * (0.09 + 0.025 * bob);
    a.stretch = 1 + 0.12 * e;
  }
  o.neckY = 0.05 * pop1 - 0.05 * e - 0.012 * bob * e;
  o.headRoll = 0.42 * e;
  o.headPitch = 0.1 * pop1 - 0.04 * e + 0.03 * bob * e;
  o.headYaw = 0.22 * e + 0.32 * meh;
  o.roll = -0.16 * e;
  o.bodyZ = -0.05 * e;
  o.twist = 0.14 * e;
  o.lean = 0.07 * e;
  o.sx = o.sz = 1 + 0.04 * e;
  o.sy = 1 - 0.02 * e + 0.015 * bob * e;
  o.pivotY = 0.02 * pop1;
  o.tail[0] = 0.35 + Math.sin(T * 3) * 0.4 * e;
  o.face = 'smug';
}
