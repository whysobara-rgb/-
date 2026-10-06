/**
 * What every player can see of the police event (owner addition beyond doc v0.5): officers and
 * cars are drawn on the field for everyone, the alarm rings publicly and the car's arrival is
 * announced. Bots read that public state here — officer poses, phases, whom an officer is
 * running at, the alarm and the dispatch clock — and turn it into a few estimates the brain
 * uses (who is being chased, how dangerous a spot is, how much of a planned haul will happen
 * with police on the field).
 *
 * Perception rule: an officer's target is only used for the bot's OWN team (is my mate being
 * chased?) or for an opponent the team currently sees (perception.ts); it never reveals where an
 * unseen opponent is.
 *
 * One instance per Simulation, refreshed once per tick (shared by all bots of the match).
 */
import { POLICE, TICK_RATE } from '../sim/config';
import type { Simulation } from '../sim/sim';
import type { EntityId, PolicePhase, Vec2 } from '../sim/types';

export interface CopView {
  id: EntityId;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  phase: PolicePhase;
  /** Character the officer is running at (chase / tackle), else null. */
  target: EntityId | null;
  /** Ticks until it can lunge again (stunned / tired / stepping out), 0 = ready. */
  busyTicks: number;
  /** Seconds left of its shift (it walks back to the car afterwards). */
  shiftLeft: number;
}

/** Seconds an officer spends stepping out after the car parks (sim: 0.6 s). */
const STEP_OUT_S = 0.6;
/** Rough walk back to the car at the end of a shift before the car leaves (s). */
const WALK_BACK_S = 6;

export class PoliceSense {
  private static readonly cache = new WeakMap<Simulation, PoliceSense>();
  static for(sim: Simulation): PoliceSense {
    let p = PoliceSense.cache.get(sim);
    if (!p) PoliceSense.cache.set(sim, (p = new PoliceSense(sim)));
    p.update(sim);
    return p;
  }

  readonly enabled: boolean;
  /** Officers on duty (not walking back / gone), ascending id. */
  cops: CopView[] = [];
  /** Officers walking back to the car (harmless). */
  leaving = 0;
  private tick = -1;
  private dispatchTick: number | null = null;
  private ringing = 0;
  private carsActive = 0;
  /** Tick the last officer stun ended, per officer (1 s re-stun immunity is visible: it just got up). */
  private readonly stunEnded = new Map<EntityId, number>();
  private readonly lastPhase = new Map<EntityId, PolicePhase>();

  private constructor(sim: Simulation) {
    this.enabled = sim.rules.police;
  }

  private update(sim: Simulation): void {
    const st = sim.state;
    if (st.tick === this.tick) return;
    this.tick = st.tick;
    this.cops = [];
    this.leaving = 0;
    if (!this.enabled) return;
    for (const o of st.police) {
      const prev = this.lastPhase.get(o.id);
      if (prev === 'stunned' && o.phase !== 'stunned') this.stunEnded.set(o.id, st.tick);
      this.lastPhase.set(o.id, o.phase);
      if (o.phase === 'leaving' || o.phase === 'gone') {
        this.leaving++;
        continue;
      }
      const busy = o.phase === 'stunned' ? o.stunTicks : o.phase === 'tired' ? o.tiredTicks : o.phase === 'tackle' ? o.tackleTicks : o.phase === 'arriving' ? Math.round(STEP_OUT_S * TICK_RATE) : 0;
      this.cops.push({
        id: o.id,
        pos: o.pos,
        vel: o.vel,
        facing: o.facing,
        phase: o.phase,
        target: o.phase === 'chase' || o.phase === 'tackle' || o.phase === 'tired' ? o.targetCharId : null,
        busyTicks: busy,
        shiftLeft: Math.max(0, (POLICE.shiftTicks - o.activeTicks) / TICK_RATE),
      });
    }
    this.dispatchTick = st.alarm.dispatchTick;
    this.ringing = st.alarm.ringing.length;
    this.carsActive = st.policeCars.filter((c) => c.phase === 'arriving' || c.phase === 'parked').length;
  }

  onField(): boolean {
    return this.cops.length > 0;
  }

  /** An officer that got up from a stun less than 1 s ago cannot be stunned again yet. */
  stunImmune(id: EntityId): boolean {
    const t = this.stunEnded.get(id);
    return t !== undefined && this.tick - t < TICK_RATE;
  }

  /** Officers running at this character. */
  chasers(charId: EntityId): CopView[] {
    return this.cops.filter((c) => c.target === charId);
  }

  /**
   * How threatening the officers are to a carrier at `p` (0..1+): an officer chasing it counts
   * fully when close, any other free officer nearby a little (it may switch to this carrier).
   */
  threatAt(p: Vec2, charId: EntityId | null, radius = 9): number {
    let t = 0;
    for (const c of this.cops) {
      const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y);
      if (d > radius) continue;
      const near = 1 - d / radius;
      if (charId !== null && c.target === charId) t += 0.5 + near;
      else if (c.target === null) t += 0.6 * near;
      else t += 0.25 * near;
    }
    return t;
  }

  /** Nearest officer on duty to p (optionally only those chasing `charId`). */
  nearest(p: Vec2, chasing?: EntityId): { cop: CopView; d: number } | null {
    let best: { cop: CopView; d: number } | null = null;
    for (const c of this.cops) {
      if (chasing !== undefined && c.target !== chasing) continue;
      const d = Math.hypot(c.pos.x - p.x, c.pos.y - p.y);
      if (!best || d < best.d) best = { cop: c, d };
    }
    return best;
  }

  /**
   * Seconds until police can bother a carrier: 0 while officers are on duty, the time to the
   * scheduled car's officers stepping out, or Infinity when nothing is coming.
   */
  arrivalIn(): number {
    if (!this.enabled) return Infinity;
    if (this.cops.length > 0) return 0;
    if (this.dispatchTick !== null) return Math.max(0, (this.dispatchTick - this.tick) / TICK_RATE) + POLICE.arriveTicks / TICK_RATE + STEP_OUT_S;
    if (this.carsActive > 0) return POLICE.arriveTicks / TICK_RATE + STEP_OUT_S;
    return Infinity;
  }

  /** Seconds until the officers on duty end their shift (0 when none are on duty). */
  shiftLeft(): number {
    let s = 0;
    for (const c of this.cops) s = Math.max(s, c.shiftLeft);
    return s;
  }

  /**
   * Seconds of police presence (officers on duty) expected during the next `dur` seconds,
   * following the public alarm clock (sim police.ts): a wave stays POLICE.shiftTicks, the next
   * one comes POLICE.restTicks after the car left while any bank still rings. `uproots` = the
   * plan itself rings a new alarm now (a bank that is still anchored).
   */
  exposure(dur: number, uproots: boolean): number {
    if (!this.enabled || dur <= 0) return 0;
    const shift = POLICE.shiftTicks / TICK_RATE;
    const rest = POLICE.restTicks / TICK_RATE;
    const arrive = POLICE.arriveTicks / TICK_RATE + STEP_OUT_S;
    let ringing = this.ringing > 0 || uproots;
    let start: number;
    let end: number;
    if (this.cops.length > 0) {
      start = 0;
      end = this.shiftLeft();
    } else {
      const a = this.arrivalIn();
      if (Number.isFinite(a)) start = a;
      else if (uproots) start = POLICE.dispatchDelayTicks / TICK_RATE + arrive;
      else return 0;
      end = start + shift;
    }
    let total = 0;
    for (let k = 0; k < 4 && start < dur; k++) {
      total += Math.max(0, Math.min(dur, end) - start);
      if (!ringing) break;
      start = end + WALK_BACK_S + rest + arrive;
      end = start + shift;
      ringing = true;
    }
    return total;
  }

  /** Avoidance circles (path planning) around officers that could go for a carrier. */
  avoidCircles(charId: EntityId, until: number, strength = 1): { x: number; y: number; r: number; cost: number; until: number }[] {
    const out: { x: number; y: number; r: number; cost: number; until: number }[] = [];
    for (const c of this.cops) {
      if (c.target !== null && c.target !== charId && c.phase !== 'tired') continue;
      const lead = 0.6;
      const x = c.pos.x + c.vel.x * lead;
      const y = c.pos.y + c.vel.y * lead;
      out.push({ x, y, r: c.target === charId ? 4.0 : 3.2, cost: 6 * strength, until });
    }
    return out;
  }
}
