/**
 * Police event (owner addition beyond doc v0.5) — deterministic, simulated inside the sim.
 *
 * Alarm: a bank that gets uprooted (anchored -> free) rings its alarm. If no police wave is on
 * the way or on the field, a car is dispatched after POLICE.dispatchDelayTicks (never sooner
 * than POLICE.restTicks after the previous wave left). While banks still ring after a wave
 * leaves, the next wave is scheduled after POLICE.restTicks. The final countdown ("도주 준비")
 * calls a wave immediately if none is on the field. Nothing is ever dispatched after the end.
 *
 * Wave: the car (kinematic, non-colliding, visual) drives from entry.from to entry.park over
 * POLICE.arriveTicks. Layouts park it at the curb OUTSIDE the arena edge (it never covers a
 * lane); officers then hop in over the fence just inside the edge (west/east of the car's line,
 * mirror-symmetric). Entries alternate by wave; on layouts with policeDispatch 'nearestAlarm' (all
 * authored arenas) the car parks at the curb nearest the oldest bank still ringing instead. Officers are dynamic circle bodies
 * with the character drive + drag model; they collide with everything solid, never grab and
 * cannot be grabbed. At the end of a shift they walk back and board only at their car (any of
 * its step-in spots, or the fence beside it); their bodies are then removed from physics.
 *
 * Brain (fixed order: officers by id, characters by slot; perception on every 4th tick for all
 * officers at once so no team is ever "seen first"): targets are characters holding loot,
 * seen within POLICE.sightRadius with sim line of sight — or heard: holding the wall of a bank
 * whose alarm rings, within POLICE.hearRadius (remembered 3 s; the officer pursuing
 * one keeps heading for its last known spot for up to 8 s). The highest held
 * estimatedValue goes first (bank-wall holders count the bank), ties -> nearer -> lower id, and
 * each carrier is handed to the nearest free officer of the car, so two officers split over two
 * carriers and a mirrored situation always gets the mirrored assignment. Chase on a 0.5 m nav
 * grid (A* + string pulling) with local avoidance; patrol toward an uprooted bank (circling it),
 * else zone fronts / chokepoints.
 *
 * Tackle: target within POLICE.tackleRange (center distance) and +-40 deg ahead -> lunge. A lunge
 * that touches a loot-holding character inside the cone (not protected / knocked down) has the
 * exact effect of an opposing dash hit. Empty-handed characters are never tackled, only bumped.
 * A raccoon dash into an officer (dash cone rule) stuns it (1 s re-stun immunity afterwards).
 *
 * Police never touch scores, loot ownership or recovery dwell; they only push bodies around.
 */
import { CHARACTER, DASH, KNOCKDOWN_TICKS, POLICE, POLICE_CAR, PROTECT_TICKS, UNSTUCK, secondsToTicks } from './config';
import { emit, lootById, type SimContext } from './context';
import { doRelease, floorAt } from './actions';
import { CAT_POLICE, type Body } from './physics';
import { PoliceNav } from './policeNav';
import { isFreeCircle, lineOfSight } from './queries';
import type { EntityId, LayoutDef, PoliceCarState, PoliceEntryDef, PoliceOfficerState, PolicePhase, Vec2 } from './types';

/** Officer entity ids are POLICE_ID_BASE + 1, + 2, ... (never collide with characters / loot). */
export const POLICE_ID_BASE = 1000;

/** How long a carrier stays a target after the officer last saw it. */
const MEMORY_TICKS = secondsToTicks(3);
/**
 * The officer actually pursuing a carrier keeps heading for its last known spot this long
 * (it still drops the pursuit on reaching that spot empty): a carrier hiding just behind a
 * wall must not be given up 1-2 m before the officer would see it again.
 */
const CHASE_MEMORY_TICKS = secondsToTicks(8);
/** After getting up from a stun an officer cannot be stunned again for this long. */
export const POLICE_RESTUN_IMMUNE_TICKS = secondsToTicks(1);
/** Step-out pause after the car parks. */
const STEP_OUT_TICKS = secondsToTicks(0.6);
/** Perception (target selection) period in ticks — the same tick for every officer. */
const PERCEPTION_PERIOD = 4;
/** Nav dynamic-layer refresh period (moving banks, broken fences, moved safes). */
const NAV_REFRESH_PERIOD = 10;
/** Replan at least this often while following a path. */
const REPLAN_TICKS = 45;
/** Minimum ticks between two replans of one officer. */
const REPLAN_MIN_TICKS = 8;
/** Tackle cone half-angle (+-40 deg). */
const TACKLE_COS = Math.cos((40 * Math.PI) / 180);
const DASH_HIT_COS = Math.cos(DASH.hitConeHalfAngle);
const DASH_HIT_MIN_CLOSING = -0.25;
/** Bodies closer than this (center distance minus radii) count as touching. */
const CONTACT_GAP = 0.1;
/** An officer boards its car within this distance of a step-out spot of its car. */
const BOARD_DIST = 1.0;
/**
 * Last resort only: a leaving officer that still cannot reach any step-out spot of its car
 * after this long boards where it stands (the car must eventually leave). Walls never seal a
 * step-out spot, so in practice only a permanent body-block can trigger it.
 */
const LEAVE_TIMEOUT_TICKS = secondsToTicks(60);
/** Officers step in this far from the arena edge when the car parks at the curb outside. */
const STEP_IN_DEPTH = 0.75;
/** ... and this far either side of the car's center line (then 1 m deeper per extra pair). */
const STEP_IN_SPREAD = 0.6;
/** Walking back without getting closer to the car for this long = sealed off (see brain). */
const SEALED_TICKS = secondsToTicks(8);
/** Walking-back speed at the end of a shift (m/s). */
const LEAVE_SPEED = (POLICE.patrolSpeed + POLICE.chaseSpeed) / 2;
const PATROL_GOAL_TIMEOUT = secondsToTicks(15);
const PATROL_REACHED = 2.5;
/** Progress monitor: an officer that wants to move but covers less than PROGRESS_MIN m. */
const PROGRESS_PERIOD = 90;
const PROGRESS_MIN = 0.5;
/** Distance bonus (m) for keeping the carrier an officer already chases (no flip-flopping). */
const TARGET_STICKY = 2;
/** Orbit radius around an uprooted bank nobody holds. */
const BANK_ORBIT_R = 7;

/**
 * Where officer k of a car parked at `entry` (arena `size`) wants to step out, alternately on
 * the west / east side (k even / odd; mirror-symmetric for an on-axis car):
 *  - car at the curb OUTSIDE the arena (all layouts): just inside the nearest arena edge,
 *    STEP_IN_SPREAD either side of the car's center line (1 m deeper for every extra pair) —
 *    officers hop the low boundary fence;
 *  - car parked inside the arena: beside the car, further out for every extra pair.
 * The sim moves an officer to the nearest free spot (mirrored search order) if this one is taken.
 */
export function officerStepOutSpot(entry: PoliceEntryDef, k: number, size: Vec2): Vec2 {
  const side = k % 2 === 0 ? -1 : 1;
  const row = Math.floor(k / 2);
  const p = entry.park;
  const qx = Math.min(size.x, Math.max(0, p.x));
  const qy = Math.min(size.y, Math.max(0, p.y));
  const ox = p.x - qx;
  const oy = p.y - qy;
  if (ox === 0 && oy === 0) {
    const ext = Math.abs(Math.cos(entry.angle)) * POLICE_CAR.half.x + Math.abs(Math.sin(entry.angle)) * POLICE_CAR.half.y;
    return { x: p.x + side * (ext + 0.75 + row * 1.0), y: p.y };
  }
  // inward normal of the edge the car is parked behind; tangent along +x / +y
  const northSouth = Math.abs(oy) >= Math.abs(ox);
  const nx = northSouth ? 0 : ox < 0 ? 1 : -1;
  const ny = northSouth ? (oy < 0 ? 1 : -1) : 0;
  const depth = STEP_IN_DEPTH + row * 1.0;
  const off = side * STEP_IN_SPREAD;
  return { x: qx + nx * depth + Math.abs(ny) * off, y: qy + ny * depth + Math.abs(nx) * off };
}

/**
 * Police entry points of a layout: layout data, or curb spots on the middle of the north and
 * south edges (outside the arena, like every layout's).
 */
export function policeEntriesFor(layout: LayoutDef): PoliceEntryDef[] {
  if (layout.policeEntries && layout.policeEntries.length > 0) {
    return layout.policeEntries.map((e) => ({ from: { ...e.from }, park: { ...e.park }, angle: e.angle }));
  }
  const ax = layout.size.x / 2;
  const h = layout.size.y;
  return [
    { from: { x: ax, y: -POLICE_CAR.approach }, park: { x: ax, y: -POLICE_CAR.curb }, angle: 0 },
    { from: { x: ax, y: h + POLICE_CAR.approach }, park: { x: ax, y: h + POLICE_CAR.curb }, angle: 0 },
  ];
}

interface Memory {
  tick: number;
  x: number;
  y: number;
}

interface CarRt {
  st: PoliceCarState;
  entry: PoliceEntryDef;
  /** Ticks into the current drive (arriving / leaving). */
  t: number;
  dispatchTick: number;
  officerIds: EntityId[];
  officers: OfficerRt[];
  spawned: boolean;
  /** Where each officer stepped out (they board again at any of these). */
  spots: Vec2[];
}

interface OfficerRt {
  st: PoliceOfficerState;
  body: Body;
  car: CarRt;
  /** -1 = stepped out on the west side, +1 = east (mirror-symmetric behaviour). */
  side: number;
  shiftOver: boolean;
  reStun: number;
  stepOut: number;
  lungeX: number;
  lungeY: number;
  lungeTarget: EntityId;
  memory: Map<EntityId, Memory>;
  path: Vec2[] | null;
  pathIdx: number;
  pathGoalX: number;
  pathGoalY: number;
  planTick: number;
  patrolKey: number;
  patrolSince: number;
  visited: number[];
  stuckTicks: number;
  lastX: number;
  lastY: number;
  progX: number;
  progY: number;
  progTick: number;
  stuckCount: number;
  leaveTicks: number;
  /** Step-out spot of the car this officer is walking back to (index into car.spots). */
  leaveSpot: number;
  /** Ticks left of "lost interest" after being stuck while chasing. */
  ignoreTicks: number;
  /** Orbit post index around an uprooted bank (null = not circling). */
  orbitK: number | null;
  orbitBank: EntityId;
  /** Walking back: best distance to the car's step-out spots so far, and when it was reached. */
  leaveBest: number;
  leaveBestTick: number;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const lerpAngle = (a: number, b: number, t: number): number => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
};

export class PoliceSystem {
  readonly entries: PoliceEntryDef[];
  readonly nav: PoliceNav;
  /** Officers on the field, ascending id. */
  private officers: OfficerRt[] = [];
  private cars: CarRt[] = [];
  private nextCarId = 1;
  private nextOfficerSeq = 1;
  /** Banks whose alarm already went off (each bank rings once). */
  private readonly alarmed = new Set<EntityId>();
  private lastWaveLeftTick = -Infinity;
  private countdownSeen = false;
  private navDirty = true;
  /** Patrol hotspots: zone fronts + chokepoints (mirror-symmetric layout data). */
  private readonly patrolPoints: Vec2[];
  /** Per character slot: -1 if its team's zone is west of the axis, +1 if east. */
  private readonly charSide: number[];

  constructor(private readonly ctx: SimContext) {
    this.entries = policeEntriesFor(ctx.layout);
    this.nav = new PoliceNav(ctx);
    const size = ctx.layout.size;
    const pts: Vec2[] = [];
    for (const z of ctx.layout.zones) {
      const toward = z.center.x < size.x / 2 ? 1 : -1;
      pts.push({ x: z.center.x + toward * (z.half.x + 2), y: z.center.y });
    }
    for (const c of ctx.layout.chokepoints) pts.push({ x: c.pos.x, y: c.pos.y });
    if (pts.length === 0) pts.push({ x: size.x / 2, y: size.y / 2 });
    this.patrolPoints = pts;
    this.charSide = ctx.state.characters.map((ch) => {
      const z = ctx.layout.zones.find((q) => q.team === ch.team);
      return z && z.center.x > size.x / 2 ? 1 : -1;
    });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** False if a circle at p overlaps any officer (except `ignoreId`). */
  isFreeOfOfficers(p: Vec2, radius: number, ignoreId?: EntityId): boolean {
    for (const o of this.officers) {
      if (o.st.id === ignoreId) continue;
      if (Math.hypot(o.body.x - p.x, o.body.y - p.y) < radius + POLICE.radius) return false;
    }
    return true;
  }

  private teamSide(charId: EntityId): number {
    return this.charSide[charId - 1] ?? -1;
  }

  private activeWave(): CarRt | null {
    for (const c of this.cars) if (c.st.phase === 'arriving' || c.st.phase === 'parked') return c;
    return null;
  }

  // -------------------------------------------------------------------------
  // 1b. Brains + drive (after commands, before physics)
  // -------------------------------------------------------------------------

  prePhysics(): void {
    if (this.officers.length === 0) return;
    const tick = this.ctx.state.tick;
    if (this.navDirty || tick % NAV_REFRESH_PERIOD === 0) {
      this.nav.refreshDynamic();
      this.navDirty = false;
    }
    if (tick % PERCEPTION_PERIOD === 0) for (const car of this.cars) if (car.spawned) this.perceiveCar(car, tick);
    let boarded: OfficerRt[] | null = null;
    for (const o of this.officers) {
      if (this.brain(o, tick)) (boarded ??= []).push(o);
    }
    if (boarded) for (const o of boarded) this.board(o);
  }

  private resume(o: OfficerRt): PolicePhase {
    if (o.shiftOver) return 'leaving';
    return o.st.targetCharId !== null ? 'chase' : 'patrol';
  }

  /** Returns true when the officer boarded its car this tick. */
  private brain(o: OfficerRt, tick: number): boolean {
    const ctx = this.ctx;
    const s = o.st;
    const b = o.body;
    const f = floorAt(ctx, b.x, b.y);
    b.floor = f ? lootById(ctx, f.id)!.rt.body : null;
    b.fx = 0;
    b.fy = 0;
    b.noDrag = false;
    s.activeTicks++;
    if (o.reStun > 0 && s.phase !== 'stunned') o.reStun--;
    if (o.ignoreTicks > 0) o.ignoreTicks--;
    if (!o.shiftOver && s.activeTicks >= POLICE.shiftTicks) o.shiftOver = true;

    switch (s.phase) {
      case 'stunned':
        if (--s.stunTicks > 0) return false;
        s.stunTicks = 0;
        o.reStun = POLICE_RESTUN_IMMUNE_TICKS;
        s.phase = this.resume(o);
        o.path = null;
        return false;
      case 'tackle':
        if (--s.tackleTicks > 0) {
          b.noDrag = true;
          return false;
        }
        this.endLunge(o, false, o.lungeTarget);
        return false;
      case 'tired':
        if (--s.tiredTicks > 0) return false;
        s.tiredTicks = 0;
        s.phase = this.resume(o);
        return false;
      case 'arriving':
        if (--o.stepOut > 0) return false;
        s.phase = this.resume(o);
        break;
      default:
        break;
    }
    if (o.shiftOver && (s.phase === 'patrol' || s.phase === 'chase')) {
      s.phase = 'leaving';
      s.targetCharId = null;
      o.path = null;
    }

    if (s.phase === 'leaving') {
      o.leaveTicks++;
      if (this.atCar(o) || o.leaveTicks > LEAVE_TIMEOUT_TICKS) return true;
      this.monitorProgress(o, tick);
      const spots = o.car.spots;
      // sealed off (a bank shoved against the gate to the car, a wall of bodies): no step closer
      // to the car for SEALED_TICKS -> the officer squeezes past dynamic bodies (never walls) and
      // still boards only at its car
      let dCar = Infinity;
      for (const p of spots) dCar = Math.min(dCar, Math.hypot(b.x - p.x, b.y - p.y));
      if (dCar < o.leaveBest - 0.75) {
        o.leaveBest = dCar;
        o.leaveBestTick = tick;
      } else if (!b.ghost && tick - o.leaveBestTick > SEALED_TICKS) {
        b.ghost = true;
        o.path = null;
      }
      const goal = spots[o.leaveSpot % spots.length]!;
      this.nav.staticOnly = b.ghost;
      this.steer(o, goal.x, goal.y, LEAVE_SPEED, null, tick, true);
      this.nav.staticOnly = false;
      return false;
    }

    if (s.phase === 'chase' && s.targetCharId !== null) {
      const slot = s.targetCharId - 1;
      const tch = ctx.state.characters[slot]!;
      const tb = ctx.chars[slot]!.body;
      const mem = o.memory.get(tch.id);
      const visible = !!mem && tick - mem.tick <= PERCEPTION_PERIOD;
      if (!mem || !tch.grab) {
        this.loseTarget(o);
      } else {
        const gx = visible ? tb.x : mem.x;
        const gy = visible ? tb.y : mem.y;
        if (!visible && Math.hypot(gx - b.x, gy - b.y) < 1.0) {
          // reached the last known spot and nobody is there
          o.memory.delete(tch.id);
          this.loseTarget(o);
        } else {
          if (visible && this.tryLunge(o, slot)) return false;
          this.monitorProgress(o, tick);
          this.steer(o, gx, gy, POLICE.chaseSpeed, tch.id, tick);
          return false;
        }
      }
    }
    // patrol
    const goal = this.patrolGoal(o, tick);
    this.monitorProgress(o, tick);
    this.steer(o, goal.x, goal.y, POLICE.patrolSpeed, null, tick);
    return false;
  }

  /**
   * Back at the car: within BOARD_DIST of any of the car's step-out spots, or (curb car) right
   * at the fence beside it, so a raccoon standing on a spot cannot keep an officer out.
   */
  private atCar(o: OfficerRt): boolean {
    const b = o.body;
    for (const p of o.car.spots) if (Math.hypot(b.x - p.x, b.y - p.y) <= BOARD_DIST) return true;
    const e = o.car.entry;
    const size = this.ctx.layout.size;
    const fence = POLICE.radius + 1.0;
    const along = POLICE_CAR.half.x + 0.5;
    if (e.park.y < 0) return b.y <= fence && Math.abs(b.x - e.park.x) <= along;
    if (e.park.y > size.y) return b.y >= size.y - fence && Math.abs(b.x - e.park.x) <= along;
    if (e.park.x < 0) return b.x <= fence && Math.abs(b.y - e.park.y) <= along;
    if (e.park.x > size.x) return b.x >= size.x - fence && Math.abs(b.y - e.park.y) <= along;
    return false;
  }

  private loseTarget(o: OfficerRt): void {
    o.st.targetCharId = null;
    if (o.st.phase === 'chase') o.st.phase = 'patrol';
    o.path = null;
  }

  /**
   * Update `o`'s memory of loot carriers (sight radius + line of sight; remembered
   * MEMORY_TICKS) and return what it knows: carrier id -> held value and distance to where the
   * officer last saw it. Non-carriers are forgotten.
   */
  private observe(o: OfficerRt, tick: number): Map<EntityId, { value: number; d: number }> {
    const ctx = this.ctx;
    const st = ctx.state;
    const b = o.body;
    const here = { x: b.x, y: b.y };
    const out = new Map<EntityId, { value: number; d: number }>();
    for (let i = 0; i < st.characters.length; i++) {
      const ch = st.characters[i]!;
      if (!ch.grab || ch.knockdownTicks > 0) {
        o.memory.delete(ch.id);
        continue;
      }
      const cb = ctx.chars[i]!.body;
      const d = Math.hypot(cb.x - b.x, cb.y - b.y);
      let mem = o.memory.get(ch.id);
      // seen, or heard: dragging a bank whose alarm is ringing
      const heard = d <= POLICE.hearRadius && ch.grab.part === 'bankWall' && ctx.state.alarm.ringing.includes(ch.grab.targetId);
      if (heard || (d <= POLICE.sightRadius && lineOfSight(ctx, here, { x: cb.x, y: cb.y }))) {
        if (mem) {
          mem.tick = tick;
          mem.x = cb.x;
          mem.y = cb.y;
        } else {
          mem = { tick, x: cb.x, y: cb.y };
          o.memory.set(ch.id, mem);
        }
      }
      if (!mem) continue;
      if (tick - mem.tick > (o.st.targetCharId === ch.id ? CHASE_MEMORY_TICKS : MEMORY_TICKS)) {
        o.memory.delete(ch.id);
        continue;
      }
      const held = lootById(ctx, ch.grab.targetId);
      const value = held && !held.state.recovered ? held.state.estimatedValue : 0;
      out.set(ch.id, { value, d: Math.hypot(mem.x - b.x, mem.y - b.y) });
    }
    return out;
  }

  /**
   * Target selection for one car's officers (see file header), on the same tick for everyone.
   * Carriers are served in order of held value (desc), then nearest sighting, then id; each
   * goes to the nearest free officer that knows about it (the officer already chasing it gets a
   * small stickiness bonus). Officers left over chase their own best-known carrier. Purely
   * geometric, so a mirrored situation gives the mirrored assignment for either team.
   * Emits 'policeSpotted' whenever an officer acquires a new target.
   */
  private perceiveCar(car: CarRt, tick: number): void {
    const avail: OfficerRt[] = [];
    const known = new Map<OfficerRt, Map<EntityId, { value: number; d: number }>>();
    const taken = new Set<EntityId>();
    for (const o of car.officers) {
      const ph = o.st.phase;
      if (ph === 'tackle' && o.st.targetCharId !== null) taken.add(o.st.targetCharId);
      if (o.shiftOver || (ph !== 'patrol' && ph !== 'chase' && ph !== 'tired')) continue;
      avail.push(o);
      const k = this.observe(o, tick);
      known.set(o, o.ignoreTicks > 0 ? new Map() : k);
    }
    if (avail.length === 0) return;
    const carriers = new Map<EntityId, { id: EntityId; value: number; d: number }>();
    for (const o of avail) {
      for (const [id, k] of known.get(o)!) {
        const c = carriers.get(id);
        if (!c) carriers.set(id, { id, value: k.value, d: k.d });
        else if (k.d < c.d) c.d = k.d;
      }
    }
    const order = [...carriers.values()].sort((p, q) => q.value - p.value || p.d - q.d || p.id - q.id);
    const assigned = new Map<OfficerRt, EntityId>();
    for (const c of order) {
      if (taken.has(c.id)) continue;
      let best: OfficerRt | null = null;
      let bd = Infinity;
      for (const o of avail) {
        if (assigned.has(o)) continue;
        const k = known.get(o)!.get(c.id);
        if (!k) continue;
        const d = k.d - (o.st.targetCharId === c.id ? TARGET_STICKY : 0);
        // exact ties (a carrier on the axis between two mirrored officers): the officer on the
        // carrier's own team side, so a mirrored situation for the other team mirrors the pick
        const tie = best !== null && d <= bd + 1e-9 && o.side !== best.side && o.side === this.teamSide(c.id);
        if (d < bd - 1e-9 || tie) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        assigned.set(best, c.id);
        taken.add(c.id);
      }
    }
    for (const o of avail) {
      if (assigned.has(o)) continue;
      let best: { id: EntityId; value: number; d: number } | null = null;
      for (const [id, k] of known.get(o)!) {
        if (!best || k.value > best.value || (k.value === best.value && (k.d < best.d - 1e-9 || (Math.abs(k.d - best.d) <= 1e-9 && id < best.id)))) {
          best = { id, value: k.value, d: k.d };
        }
      }
      if (best) assigned.set(o, best.id);
    }
    for (const o of avail) {
      const s = o.st;
      const t = assigned.get(o) ?? null;
      if (t === null) {
        if (s.targetCharId !== null) this.loseTarget(o);
        continue;
      }
      if (t !== s.targetCharId) {
        s.targetCharId = t;
        o.path = null;
        emit(this.ctx, { type: 'policeSpotted', tick, officerId: s.id, charId: t });
      }
      if (s.phase === 'patrol') s.phase = 'chase';
    }
  }

  private tryLunge(o: OfficerRt, slot: number): boolean {
    const ctx = this.ctx;
    const tch = ctx.state.characters[slot]!;
    if (!tch.grab || tch.protectTicks > 0 || tch.knockdownTicks > 0) return false;
    const b = o.body;
    const tb = ctx.chars[slot]!.body;
    const dx = tb.x - b.x;
    const dy = tb.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > POLICE.tackleRange || d < 1e-6) return false;
    const nx = dx / d;
    const ny = dy / d;
    const s = o.st;
    if (nx * Math.cos(s.facing) + ny * Math.sin(s.facing) < TACKLE_COS) return false;
    if (!lineOfSight(ctx, { x: b.x, y: b.y }, { x: tb.x, y: tb.y })) return false;
    let fvx = 0;
    let fvy = 0;
    const f = b.floor;
    if (f && f.enabled && f.motion === 'dynamic') {
      fvx = f.vx - f.w * (b.y - f.y);
      fvy = f.vy + f.w * (b.x - f.x);
    }
    s.phase = 'tackle';
    s.tackleTicks = POLICE.tackleTicks;
    s.facing = Math.atan2(ny, nx);
    o.lungeX = nx;
    o.lungeY = ny;
    o.lungeTarget = tch.id;
    b.vx = fvx + nx * POLICE.tackleSpeed;
    b.vy = fvy + ny * POLICE.tackleSpeed;
    b.noDrag = true;
    return true;
  }

  private endLunge(o: OfficerRt, hit: boolean, victimId: EntityId): void {
    const s = o.st;
    s.tackleTicks = 0;
    s.phase = 'tired';
    s.tiredTicks = POLICE.tiredTicks;
    o.body.noDrag = false;
    o.path = null;
    emit(this.ctx, { type: 'policeTackle', tick: this.ctx.state.tick, officerId: s.id, victimId, hit });
  }

  private patrolGoal(o: OfficerRt, tick: number): Vec2 {
    const ctx = this.ctx;
    const st = ctx.state;
    const b = o.body;
    // nearest uprooted, unrecovered bank (ties -> lower id)
    let bank: { x: number; y: number } | null = null;
    let bankId = -1;
    let bestD = Infinity;
    for (let i = 0; i < st.loot.length; i++) {
      const l = st.loot[i]!;
      if (l.kind !== 'bank' || l.recovered || l.anchored) continue;
      const lb = ctx.loot[i]!.body;
      const d = Math.hypot(lb.x - b.x, lb.y - b.y);
      if (d < bestD - 1e-9) {
        bestD = d;
        bank = { x: lb.x, y: lb.y };
        bankId = l.id;
      }
    }
    if (bank) {
      if (o.orbitBank !== bankId || (o.orbitK !== null && bestD > BANK_ORBIT_R + 5)) o.orbitK = null;
      o.orbitBank = bankId;
      if (o.orbitK === null) {
        if (bestD > BANK_ORBIT_R + 1) return bank;
        // start circling the bank on 8 posts around it; the direction is mirrored by the side
        // the officer stepped out on (west officers clockwise on screen, east ones counter)
        const a = Math.atan2(b.y - bank.y, b.x - bank.x);
        o.orbitK = Math.round(a / (Math.PI / 4)) + o.side;
      }
      let a = (o.orbitK * Math.PI) / 4;
      let goal = { x: bank.x + Math.cos(a) * BANK_ORBIT_R, y: bank.y + Math.sin(a) * BANK_ORBIT_R };
      if (Math.hypot(goal.x - b.x, goal.y - b.y) < 2 || tick - o.patrolSince > PATROL_GOAL_TIMEOUT / 3) {
        o.orbitK += o.side;
        o.patrolSince = tick;
        o.path = null;
        a = (o.orbitK * Math.PI) / 4;
        goal = { x: bank.x + Math.cos(a) * BANK_ORBIT_R, y: bank.y + Math.sin(a) * BANK_ORBIT_R };
      }
      return goal;
    }
    o.orbitK = null;
    const pts = this.patrolPoints;
    let goal = o.patrolKey >= 0 ? pts[o.patrolKey]! : null;
    if (!goal || Math.hypot(goal.x - b.x, goal.y - b.y) < PATROL_REACHED || tick - o.patrolSince > PATROL_GOAL_TIMEOUT) {
      if (o.patrolKey >= 0) {
        o.visited.push(o.patrolKey);
        if (o.visited.length > 2) o.visited.shift();
      }
      let best = -1;
      let bd = Infinity;
      for (let k = 0; k < pts.length; k++) {
        if (o.visited.includes(k) && pts.length > o.visited.length) continue;
        const d = Math.hypot(pts[k]!.x - b.x, pts[k]!.y - b.y);
        if (d < 4 && pts.length > 1) continue;
        if (d < bd - 1e-9) {
          bd = d;
          best = k;
        }
      }
      if (best < 0) best = (o.patrolKey + 1) % pts.length;
      o.patrolKey = best;
      o.patrolSince = tick;
      o.path = null;
      goal = pts[best]!;
    }
    return goal;
  }

  private monitorProgress(o: OfficerRt, tick: number): void {
    if (tick - o.progTick < PROGRESS_PERIOD) return;
    const b = o.body;
    const moved = Math.hypot(b.x - o.progX, b.y - o.progY);
    o.progX = b.x;
    o.progY = b.y;
    o.progTick = tick;
    if (moved >= PROGRESS_MIN) {
      o.stuckCount = 0;
      return;
    }
    o.stuckCount++;
    o.path = null;
    const s = o.st;
    if (s.phase === 'patrol') {
      // give up on this hotspot / orbit post
      o.patrolSince = -Infinity;
    } else if (s.phase === 'chase' && o.stuckCount >= 2) {
      // walled off from the target: look elsewhere for a moment
      this.loseTarget(o);
      o.ignoreTicks = secondsToTicks(2);
    } else if (s.phase === 'leaving' && o.stuckCount >= 2) {
      // blocked on the way back (bodies, a parked safe): head for the car's next step-out spot
      o.leaveSpot++;
      o.stuckCount = 0;
    }
  }

  /**
   * Drive toward (gx, gy) at `speed`: straight when the grid line is clear, else A* (`fullSearch`:
   * no expansion cap, so the walk back to the car never ends in a pocket of a partial path).
   */
  private steer(o: OfficerRt, gx: number, gy: number, speed: number, chaseId: EntityId | null, tick: number, fullSearch = false): void {
    const b = o.body;
    const nav = this.nav;
    const dist = Math.hypot(gx - b.x, gy - b.y);
    if (dist < 0.15) return;
    let tx = gx;
    let ty = gy;
    if (!(dist < 24 && nav.clearLine(b.x, b.y, gx, gy))) {
      const stale =
        !o.path ||
        o.pathIdx >= o.path.length ||
        Math.hypot(gx - o.pathGoalX, gy - o.pathGoalY) > 1.5 ||
        tick - o.planTick >= REPLAN_TICKS;
      if (stale && (!o.path || tick - o.planTick >= REPLAN_MIN_TICKS)) {
        o.path = nav.findPath(b.x, b.y, gx, gy, fullSearch);
        o.pathIdx = 0;
        o.pathGoalX = gx;
        o.pathGoalY = gy;
        o.planTick = tick;
      }
      const path = o.path;
      if (path && path.length > 0) {
        while (o.pathIdx < path.length - 1 && Math.hypot(path[o.pathIdx]!.x - b.x, path[o.pathIdx]!.y - b.y) < 0.45) o.pathIdx++;
        if (o.pathIdx + 1 < path.length && nav.clearLine(b.x, b.y, path[o.pathIdx + 1]!.x, path[o.pathIdx + 1]!.y)) o.pathIdx++;
        const wp = path[Math.min(o.pathIdx, path.length - 1)]!;
        tx = wp.x;
        ty = wp.y;
      }
    } else {
      o.path = null;
    }
    let dx = tx - b.x;
    let dy = ty - b.y;
    let l = Math.hypot(dx, dy);
    if (l < 1e-6) return;
    dx /= l;
    dy /= l;
    // local avoidance: other officers, and characters that are not the chase target
    let ax = 0;
    let ay = 0;
    for (const m of this.officers) {
      if (m === o) continue;
      const ox = b.x - m.body.x;
      const oy = b.y - m.body.y;
      const d = Math.hypot(ox, oy);
      if (d < 1.4 && d > 1e-6) {
        const w = ((1.4 - d) / 1.4) * 1.2;
        ax += (ox / d) * w;
        ay += (oy / d) * w;
        // Head-on (e.g. two officers swapping sides around an obstacle): repulsion alone is
        // a stalemate, so also sidestep away from the other's side of our heading. Exactly
        // in line: only the lower id sidesteps (to its left), which breaks the tie.
        const ahead = -(ox * dx + oy * dy) / d;
        if (ahead > 0.3) {
          const cross = -(dx * oy - dy * ox); // > 0: the other is on our left (+perp)
          const sgn = cross > 1e-6 ? -1 : cross < -1e-6 ? 1 : o.st.id < m.st.id ? 1 : 0;
          const ws = w * ahead;
          ax += -dy * sgn * ws;
          ay += dx * sgn * ws;
        }
      }
    }
    const st = this.ctx.state;
    for (let i = 0; i < st.characters.length; i++) {
      if (st.characters[i]!.id === chaseId) continue;
      const cb = this.ctx.chars[i]!.body;
      const ox = b.x - cb.x;
      const oy = b.y - cb.y;
      const d = Math.hypot(ox, oy);
      if (d < 1.2 && d > 1e-6) {
        const w = ((1.2 - d) / 1.2) * 0.7;
        ax += (ox / d) * w;
        ay += (oy / d) * w;
      }
    }
    if (ax !== 0 || ay !== 0) {
      const ex = dx + ax;
      const ey = dy + ay;
      const el = Math.hypot(ex, ey);
      if (el > 0.2) {
        dx = ex / el;
        dy = ey / el;
      }
    }
    l = Math.min(1, dist / 0.6);
    const force = speed * CHARACTER.drag * POLICE.mass * l;
    b.fx = dx * force;
    b.fy = dy * force;
    o.st.facing = Math.atan2(dy, dx);
  }

  private board(o: OfficerRt): void {
    const b = o.body;
    this.ctx.physics.removeBody(b);
    b.vx = 0;
    b.vy = 0;
    b.fx = 0;
    b.fy = 0;
    b.floor = null;
    o.st.phase = 'gone';
    o.st.targetCharId = null;
    o.st.vel = { x: 0, y: 0 };
    this.officers = this.officers.filter((q) => q !== o);
    const st = this.ctx.state;
    st.police = st.police.filter((q) => q !== o.st);
  }

  // -------------------------------------------------------------------------
  // Per substep: raccoon dashes into officers, officer lunges into carriers
  // -------------------------------------------------------------------------

  afterSubstep(): void {
    if (this.officers.length === 0) return;
    const ctx = this.ctx;
    const st = ctx.state;
    const reachCO = CHARACTER.radius + POLICE.radius + CONTACT_GAP;
    // 1. dashes (character-character hits were resolved first by checkDashHits)
    for (let i = 0; i < st.characters.length; i++) {
      const att = st.characters[i]!;
      if (att.dashTicks <= 0) continue;
      const rt = ctx.chars[i]!;
      const ab = rt.body;
      const relVx = ab.vx - ab.fvx;
      const relVy = ab.vy - ab.fvy;
      let best: OfficerRt | null = null;
      let bestD = Infinity;
      let bnx = 0;
      let bny = 0;
      for (const o of this.officers) {
        const dx = o.body.x - ab.x;
        const dy = o.body.y - ab.y;
        const d = Math.hypot(dx, dy);
        if (d > reachCO || d >= bestD) continue;
        const nx = d > 1e-6 ? dx / d : rt.dashDirX;
        const ny = d > 1e-6 ? dy / d : rt.dashDirY;
        if (nx * rt.dashDirX + ny * rt.dashDirY < DASH_HIT_COS) continue;
        if (relVx * nx + relVy * ny < DASH_HIT_MIN_CLOSING) continue;
        best = o;
        bestD = d;
        bnx = nx;
        bny = ny;
      }
      if (!best) continue;
      att.dashTicks = 0;
      ab.noDrag = false;
      ab.vx *= 0.3;
      ab.vy *= 0.3;
      const ob = best.body;
      const s = best.st;
      if (s.phase !== 'stunned' && best.reStun === 0) {
        if (s.phase === 'tackle') this.endLunge(best, false, best.lungeTarget);
        s.phase = 'stunned';
        s.stunTicks = POLICE.stunTicks;
        s.tiredTicks = 0;
        s.tackleTicks = 0;
        ob.noDrag = false;
        ob.fx = 0;
        ob.fy = 0;
        ob.vx = ob.fvx + bnx * DASH.knockbackSpeed;
        ob.vy = ob.fvy + bny * DASH.knockbackSpeed;
        best.path = null;
        emit(ctx, { type: 'policeStunned', tick: st.tick, officerId: s.id, byCharId: att.id });
      } else {
        ob.vx += bnx * DASH.teamShoveSpeed;
        ob.vy += bny * DASH.teamShoveSpeed;
      }
    }
    // 2. lunges
    for (const o of this.officers) {
      const s = o.st;
      if (s.phase !== 'tackle') continue;
      const ob = o.body;
      let best = -1;
      let bestD = Infinity;
      let bnx = 0;
      let bny = 0;
      for (let j = 0; j < st.characters.length; j++) {
        const v = st.characters[j]!;
        if (!v.grab || v.protectTicks > 0 || v.knockdownTicks > 0) continue;
        const vb = ctx.chars[j]!.body;
        const dx = vb.x - ob.x;
        const dy = vb.y - ob.y;
        const d = Math.hypot(dx, dy);
        if (d > reachCO || d >= bestD) continue;
        const nx = d > 1e-6 ? dx / d : o.lungeX;
        const ny = d > 1e-6 ? dy / d : o.lungeY;
        if (nx * o.lungeX + ny * o.lungeY < TACKLE_COS) continue;
        best = j;
        bestD = d;
        bnx = nx;
        bny = ny;
      }
      if (best < 0) continue;
      const victim = st.characters[best]!;
      const vrt = ctx.chars[best]!;
      const vb = vrt.body;
      // exactly the effect of an opposing dash hit
      if (victim.grab) doRelease(ctx, best, true);
      vrt.grabLatch = true;
      victim.knockdownTicks = KNOCKDOWN_TICKS;
      victim.protectTicks = PROTECT_TICKS;
      victim.dashTicks = 0;
      victim.boostTicks = 0;
      victim.straining = false;
      vb.noDrag = false;
      vb.fx = 0;
      vb.fy = 0;
      vb.vx = vb.fvx + bnx * DASH.knockbackSpeed;
      vb.vy = vb.fvy + bny * DASH.knockbackSpeed;
      ob.vx = ob.fvx + (ob.vx - ob.fvx) * 0.3;
      ob.vy = ob.fvy + (ob.vy - ob.fvy) * 0.3;
      o.memory.delete(victim.id);
      this.endLunge(o, true, victim.id);
      s.targetCharId = null;
    }
  }

  // -------------------------------------------------------------------------
  // 2b. After physics: NaN guard, arena clamp, anti-pin, sync
  // -------------------------------------------------------------------------

  afterPhysics(): void {
    if (this.officers.length === 0) return;
    const ctx = this.ctx;
    const size = ctx.layout.size;
    const m = POLICE.radius;
    for (const o of this.officers) {
      const b = o.body;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
        b.x = o.lastX;
        b.y = o.lastY;
        b.vx = 0;
        b.vy = 0;
      }
      if (b.x < m) {
        b.x = m;
        if (b.vx < 0) b.vx = 0;
      } else if (b.x > size.x - m) {
        b.x = size.x - m;
        if (b.vx > 0) b.vx = 0;
      }
      if (b.y < m) {
        b.y = m;
        if (b.vy < 0) b.vy = 0;
      } else if (b.y > size.y - m) {
        b.y = size.y - m;
        if (b.vy > 0) b.vy = 0;
      }
      o.stuckTicks = b.maxPen > UNSTUCK.penetration ? o.stuckTicks + 1 : 0;
      if (o.stuckTicks >= UNSTUCK.ticks) {
        o.stuckTicks = 0;
        const id = o.st.id;
        const spot = this.symmetricSearch(b.x, b.y, o.side, (p) => isFreeCircle(ctx, p, POLICE.radius, { characters: true, ignoreCharId: id }), 15, 0.25);
        if (spot) {
          b.x = spot.x;
          b.y = spot.y;
          b.vx = 0;
          b.vy = 0;
          b.updateShapes(0);
          o.path = null;
          emit(ctx, { type: 'unstuck', tick: ctx.state.tick, entityId: id, pos: { ...spot } });
        }
      }
      o.lastX = b.x;
      o.lastY = b.y;
      const s = o.st;
      s.pos.x = b.x;
      s.pos.y = b.y;
      s.vel.x = b.vx;
      s.vel.y = b.vy;
    }
  }

  /**
   * Nearest acceptable spot on rings around (x, y). The angular order is mirrored for side -1
   * so officers stepping out west / east of an on-axis car land on mirror-image spots.
   */
  private symmetricSearch(x: number, y: number, side: number, test: (p: Vec2) => boolean, maxR: number, step: number): Vec2 | null {
    if (test({ x, y })) return { x, y };
    for (let r = step; r <= maxR + 1e-9; r += step) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const ca = side < 0 ? -Math.cos(a) : Math.cos(a);
        const p = { x: x + ca * r, y: y + Math.sin(a) * r };
        if (test(p)) return p;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 7. Alarm, dispatch, cars (after the end check; never once the match is over)
  // -------------------------------------------------------------------------

  postTick(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const tick = st.tick;
    const alarm = st.alarm;
    // alarms: newly uprooted banks ring; recovered banks stop ringing
    for (const l of st.loot) {
      if (l.kind !== 'bank') continue;
      if (l.recovered) {
        const i = alarm.ringing.indexOf(l.id);
        if (i >= 0) alarm.ringing.splice(i, 1);
        continue;
      }
      if (l.anchored || this.alarmed.has(l.id)) continue;
      this.alarmed.add(l.id);
      alarm.ringing.push(l.id);
      const active = this.activeWave();
      let due: number;
      if (active) due = active.dispatchTick;
      else {
        if (alarm.dispatchTick === null) {
          alarm.dispatchTick = Math.max(tick + POLICE.dispatchDelayTicks, this.lastWaveLeftTick + POLICE.restTicks);
        }
        due = alarm.dispatchTick;
      }
      emit(ctx, { type: 'alarm', tick, bankId: l.id, dispatchTick: due });
    }
    // getaway wave
    if (st.finalCountdown && !this.countdownSeen) {
      this.countdownSeen = true;
      if (POLICE.getawayWave && !this.activeWave()) this.dispatch(tick, POLICE.getawayOfficers);
    }
    // scheduled wave
    if (alarm.dispatchTick !== null && tick >= alarm.dispatchTick) {
      if (this.activeWave()) alarm.dispatchTick = null;
      else this.dispatch(tick);
    }
    // cars
    for (const car of [...this.cars]) this.updateCar(car, tick);
  }

  /**
   * Entry of a wave. Default: entries alternate by wave. (balance pass) Layouts with
   * policeDispatch 'nearestAlarm': the car answers the alarm — it parks at the curb nearest the
   * oldest bank still ringing (where that bank is now); nothing ringing (a getaway wave) or an
   * exact tie: alternate. Banks and entries sit on the mirror axis, so both teams always face the
   * same rule. (Before: wave 1 always used entry 0 — on a layout with one bank nearer the zones,
   * whoever won the race for that bank hauled it police-free while the loser's bank got the car.)
   */
  private entryForWave(wave: number): number {
    const n = this.entries.length;
    const alt = (wave - 1) % n;
    if (this.ctx.layout.policeDispatch !== 'nearestAlarm') return alt;
    const ringId = this.ctx.state.alarm.ringing[0];
    const bank = ringId !== undefined ? lootById(this.ctx, ringId)?.state : undefined;
    if (!bank) return alt;
    let best = alt;
    let bestD = Infinity;
    let tie = false;
    for (let i = 0; i < n; i++) {
      const p = this.entries[i]!.park;
      const d = Math.hypot(p.x - bank.pos.x, p.y - bank.pos.y);
      if (d < bestD - 1e-6) {
        best = i;
        bestD = d;
        tie = false;
      } else if (Math.abs(d - bestD) <= 1e-6) tie = true;
    }
    return tie ? alt : best;
  }

  private dispatch(tick: number, officers = 0): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const alarm = st.alarm;
    alarm.dispatchTick = null;
    const wave = ++alarm.waves;
    const entryIndex = this.entryForWave(wave);
    const entry = this.entries[entryIndex]!;
    const per = POLICE.officersPerWave;
    const count = officers > 0 ? officers : Math.max(1, per[Math.min(wave - 1, per.length - 1)] ?? 2);
    const officerIds: EntityId[] = [];
    for (let k = 0; k < count; k++) officerIds.push(POLICE_ID_BASE + this.nextOfficerSeq++);
    const heading = Math.atan2(entry.park.y - entry.from.y, entry.park.x - entry.from.x);
    const carState: PoliceCarState = {
      id: this.nextCarId++,
      entryIndex,
      pos: { x: entry.from.x, y: entry.from.y },
      angle: heading,
      phase: 'arriving',
      sirenOn: true,
      wave,
    };
    const car: CarRt = { st: carState, entry, t: 0, dispatchTick: tick, officerIds, officers: [], spawned: false, spots: [] };
    this.cars.push(car);
    st.policeCars.push(carState);
    emit(ctx, { type: 'policeDispatched', tick, carId: carState.id, wave, officerIds: [...officerIds], entryIndex });
  }

  private updateCar(car: CarRt, tick: number): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const c = car.st;
    const e = car.entry;
    const T = Math.max(1, POLICE.arriveTicks);
    if (c.phase === 'arriving') {
      if (car.dispatchTick === tick) return; // reported at entry.from on its dispatch tick
      car.t++;
      const u = Math.min(1, car.t / T);
      const k = easeOut(u);
      c.pos.x = e.from.x + (e.park.x - e.from.x) * k;
      c.pos.y = e.from.y + (e.park.y - e.from.y) * k;
      const heading = Math.atan2(e.park.y - e.from.y, e.park.x - e.from.x);
      c.angle = u < 0.6 ? heading : lerpAngle(heading, e.angle, (u - 0.6) / 0.4);
      if (car.t >= T) {
        c.phase = 'parked';
        c.pos.x = e.park.x;
        c.pos.y = e.park.y;
        c.angle = e.angle;
        this.spawnOfficers(car);
        emit(ctx, { type: 'policeArrived', tick, carId: c.id, pos: { x: c.pos.x, y: c.pos.y } });
      }
      return;
    }
    if (c.phase === 'parked') {
      if (car.spawned && car.officers.every((o) => o.st.phase === 'gone')) {
        c.phase = 'leaving';
        c.sirenOn = false;
        car.t = 0;
        this.lastWaveLeftTick = tick;
        emit(ctx, { type: 'policeLeaving', tick, carId: c.id });
        const alarm = st.alarm;
        if (alarm.ringing.length > 0 && alarm.dispatchTick === null && !this.activeWave()) {
          alarm.dispatchTick = tick + POLICE.restTicks;
        }
      }
      return;
    }
    if (c.phase === 'leaving') {
      car.t++;
      const u = Math.min(1, car.t / T);
      const k = easeIn(u);
      c.pos.x = e.park.x + (e.from.x - e.park.x) * k;
      c.pos.y = e.park.y + (e.from.y - e.park.y) * k;
      const out = Math.atan2(e.from.y - e.park.y, e.from.x - e.park.x);
      c.angle = u < 0.4 ? lerpAngle(e.angle, out, u / 0.4) : out;
      if (car.t >= T) {
        c.phase = 'gone';
        c.sirenOn = false;
        this.cars = this.cars.filter((q) => q !== car);
        st.policeCars = st.policeCars.filter((q) => q !== c);
        emit(ctx, { type: 'policeGone', tick, carId: c.id });
      }
    }
  }

  private spawnOfficers(car: CarRt): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const e = car.entry;
    const placed: Vec2[] = [];
    const free = (p: Vec2): boolean => {
      if (!isFreeCircle(ctx, p, POLICE.radius + 0.05, { characters: true })) return false;
      for (const q of placed) if (Math.hypot(q.x - p.x, q.y - p.y) < 2 * POLICE.radius + 0.1) return false;
      return true;
    };
    car.officerIds.forEach((id, k) => {
      const side = k % 2 === 0 ? -1 : 1;
      const want = officerStepOutSpot(e, k, ctx.layout.size);
      const spot = this.symmetricSearch(want.x, want.y, side, free, 12, 0.25) ?? want;
      placed.push(spot);
      car.spots.push({ x: spot.x, y: spot.y });
      const body = ctx.physics.createBody(id, CAT_POLICE);
      body.fixedRotation = true;
      body.addCircle(0, 0, POLICE.radius);
      body.setMass(POLICE.mass, 0);
      body.linDrag = CHARACTER.drag;
      body.x = spot.x;
      body.y = spot.y;
      body.updateShapes(0);
      // face away from the car (into the arena for a curb car)
      const inside = e.park.x >= 0 && e.park.y >= 0 && e.park.x <= ctx.layout.size.x && e.park.y <= ctx.layout.size.y;
      const facing = inside ? (side < 0 ? Math.PI : 0) : Math.atan2(spot.y - e.park.y, spot.x - e.park.x);
      const ost: PoliceOfficerState = {
        id,
        carId: car.st.id,
        pos: { x: spot.x, y: spot.y },
        vel: { x: 0, y: 0 },
        facing,
        phase: 'arriving',
        targetCharId: null,
        tackleTicks: 0,
        stunTicks: 0,
        tiredTicks: 0,
        activeTicks: 0,
      };
      const o: OfficerRt = {
        st: ost,
        body,
        car,
        side,
        shiftOver: false,
        reStun: 0,
        stepOut: STEP_OUT_TICKS,
        lungeX: 1,
        lungeY: 0,
        lungeTarget: -1,
        memory: new Map(),
        path: null,
        pathIdx: 0,
        pathGoalX: 0,
        pathGoalY: 0,
        planTick: -Infinity,
        patrolKey: -1,
        patrolSince: 0,
        visited: [],
        stuckTicks: 0,
        lastX: spot.x,
        lastY: spot.y,
        progX: spot.x,
        progY: spot.y,
        progTick: st.tick,
        stuckCount: 0,
        leaveTicks: 0,
        leaveSpot: k,
        ignoreTicks: 0,
        orbitK: null,
        orbitBank: -1,
        leaveBest: Infinity,
        leaveBestTick: st.tick,
      };
      car.officers.push(o);
      this.officers.push(o);
      st.police.push(ost);
    });
    car.spawned = true;
    this.navDirty = true;
  }

  /** Match over: officers freeze where they stand (recovered banks still stop ringing). */
  freeze(): void {
    const alarm = this.ctx.state.alarm;
    for (const l of this.ctx.state.loot) {
      if (l.kind !== 'bank' || !l.recovered) continue;
      const i = alarm.ringing.indexOf(l.id);
      if (i >= 0) alarm.ringing.splice(i, 1);
    }
    for (const o of this.officers) {
      o.body.vx = 0;
      o.body.vy = 0;
      o.body.fx = 0;
      o.body.fy = 0;
      o.st.vel.x = 0;
      o.st.vel.y = 0;
    }
  }
}
