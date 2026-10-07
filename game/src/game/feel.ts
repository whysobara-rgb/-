/**
 * Game-feel services (docs/ART_DIRECTION.md §2 손맛).
 *
 * TimeScale: hit-stop (the sim accumulator pauses for a few frames on impactful events) and
 * brief slow motion. Only the WALL-CLOCK pace changes — the sim still advances in whole
 * deterministic 60 Hz ticks with the same commands, so rules and replays are unaffected.
 * Everything respects the reduced-motion setting (no hit-stop / slow-mo at all).
 *
 * Rumble: per-event controller patterns (light tick on grab, thud on knockdown, long roll on
 * bank uproot / recovery). Pure description; MatchController plays them through
 * InputManager.vibrate (which already honours the vibration setting).
 */
import type { EntityId, SimEvent, Simulation, TeamId } from '../sim';

/** Defaults from ART_DIRECTION §2. */
export const HITSTOP = { dashKnockdown: 0.07, bankUproot: 0.12, bankRecovery: 0.15, max: 0.2 } as const;
export const SLOWMO = { scale: 0.35, seconds: 0.6, ease: 0.15 } as const;

export class TimeScale {
  private stop = 0;
  private slowLeft = 0;
  private slowTotal = 0;
  private slowScale = 1;
  private enabled = true;

  /** Reduced motion turns both effects off (and cancels running ones). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.reset();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  reset(): void {
    this.stop = 0;
    this.slowLeft = 0;
    this.slowTotal = 0;
    this.slowScale = 1;
  }

  /** Freeze for `seconds` (wall clock). Overlapping requests take the longest, never stack. */
  hitstop(seconds: number): void {
    if (!this.enabled || !(seconds > 0)) return;
    this.stop = Math.min(HITSTOP.max, Math.max(this.stop, seconds));
  }

  /** Run at `scale` for `seconds` (wall clock), easing back to 1 at the end. */
  slowmo(scale: number = SLOWMO.scale, seconds: number = SLOWMO.seconds): void {
    if (!this.enabled || !(seconds > 0)) return;
    const s = Math.min(1, Math.max(0.05, scale));
    this.slowScale = this.slowLeft > 0 ? Math.min(this.slowScale, s) : s;
    this.slowLeft = Math.max(this.slowLeft, seconds);
    this.slowTotal = this.slowLeft;
  }

  get frozen(): boolean {
    return this.stop > 0;
  }

  get slow(): boolean {
    return this.slowLeft > 0;
  }

  /** Current scale (0 while frozen). */
  get scale(): number {
    if (this.stop > 0) return 0;
    return this.currentSlow();
  }

  private currentSlow(): number {
    if (this.slowLeft <= 0) return 1;
    // Ease back to full speed over the last part of the slow-mo.
    const ease = Math.min(SLOWMO.ease, this.slowTotal);
    if (this.slowLeft >= ease || ease <= 0) return this.slowScale;
    const k = this.slowLeft / ease;
    return 1 + (this.slowScale - 1) * k;
  }

  /**
   * Advance by a real frame dt; returns the scaled dt that game time (the sim accumulator and
   * view animation) should advance by. Hit-stop consumes wall time first.
   */
  advance(realDt: number): number {
    let dt = Number.isFinite(realDt) && realDt > 0 ? realDt : 0;
    let out = 0;
    if (this.stop > 0) {
      const used = Math.min(this.stop, dt);
      this.stop -= used;
      dt -= used;
      if (this.stop < 1e-6) this.stop = 0;
    }
    if (dt > 0 && this.slowLeft > 0) {
      const used = Math.min(this.slowLeft, dt);
      out += used * this.currentSlow();
      this.slowLeft -= used;
      dt -= used;
      if (this.slowLeft < 1e-6) {
        this.slowLeft = 0;
        this.slowScale = 1;
      }
    }
    out += dt;
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// Rumble patterns
// ---------------------------------------------------------------------------------------------

export interface RumblePulse {
  /** 0..1 */
  strength: number;
  ms: number;
  /** Delay after the previous pulse of the pattern (ms). */
  delayMs?: number;
}

export const RUMBLE = {
  grabTick: [{ strength: 0.22, ms: 45 }] as RumblePulse[],
  knockdownThud: [{ strength: 0.95, ms: 140 }, { strength: 0.35, ms: 120, delayMs: 150 }] as RumblePulse[],
  dashHitLight: [{ strength: 0.5, ms: 70 }] as RumblePulse[],
  bankUprootRoll: [{ strength: 0.55, ms: 220 }, { strength: 0.8, ms: 260, delayMs: 230 }, { strength: 0.4, ms: 300, delayMs: 270 }] as RumblePulse[],
  bankRecoveryRoll: [{ strength: 0.6, ms: 200 }, { strength: 1, ms: 380, delayMs: 210 }, { strength: 0.45, ms: 420, delayMs: 390 }] as RumblePulse[],
  safeRecovery: [{ strength: 0.45, ms: 90 }] as RumblePulse[],
  largeRecovery: [{ strength: 0.7, ms: 150 }] as RumblePulse[],
  fenceBreak: [{ strength: 0.75, ms: 180 }] as RumblePulse[],
  siren: [{ strength: 0.4, ms: 160 }, { strength: 0.4, ms: 160, delayMs: 320 }] as RumblePulse[],
} as const;

export type RumbleName = keyof typeof RUMBLE;

/**
 * Which rumble (if any) an event deserves for the local player. Only things the player is
 * part of or right next to rumble; the rest stays quiet so the pad means "you".
 */
export function rumbleFor(e: SimEvent, sim: Pick<Simulation, 'getCharacter' | 'getLoot'>, meId: EntityId, myTeam: TeamId): RumbleName | null {
  const me = sim.getCharacter(meId);
  const near = (p: { x: number; y: number } | undefined, r: number): boolean => !!me && !!p && Math.hypot(p.x - me.pos.x, p.y - me.pos.y) <= r;
  switch (e.type) {
    case 'grab':
      return e.charId === meId ? 'grabTick' : null;
    case 'dashHit':
      if (e.victimId === meId) return e.knockdown ? 'knockdownThud' : 'dashHitLight';
      if (e.attackerId === meId) return e.knockdown ? 'knockdownThud' : 'dashHitLight';
      return null;
    case 'unanchored':
      if (e.kind !== 'bank') return null;
      return sim.getLoot(e.lootId)?.grabbedBy.includes(meId) || near(sim.getLoot(e.lootId)?.pos, 9) ? 'bankUprootRoll' : null;
    case 'fenceBroken':
      return near(e.pos, 12) ? 'fenceBreak' : null;
    case 'recovered':
      if (e.team !== myTeam) return null;
      if (e.kind === 'bank') return 'bankRecoveryRoll';
      return e.holders.includes(meId) ? (e.kind === 'largeSafe' ? 'largeRecovery' : 'safeRecovery') : null;
    case 'finalCountdown':
      return 'siren';
    case 'policeTackle':
      return e.victimId === meId && e.hit ? 'knockdownThud' : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Moments -> feel (fun round WP5 / F5). Pure: match.ts applies the plan to GameView.glance and
// TimeScale. HUD never goes through here; render-only reactions live in view.onMoments (WP3).
// ---------------------------------------------------------------------------------------------

/** Feel rules for moments (fun-plan WP5 §2; ART_DIRECTION §2). */
export const MOMENT_FEEL = {
  /** Slow-mo on `leadTaken` in the final 30 s and on `bigPlay`. */
  slowmo: { scale: 0.5, seconds: 0.4 },
  /** ... replaced by a short hit-stop while the local player steers a load (no input lag). */
  steeringHitstop: 0.08,
  leadTakenFinalTicks: 30 * 60,
  /** Camera glance toward big plays (and jackpot / craneDrop / goldHammer, content-plan F3). */
  glance: { weight: 0.25, ms: 900, minDist: 4, maxDist: 40 },
} as const;

export interface MomentFeelContext {
  /** Settings: reduced motion turns every glance / slow-mo / hit-stop off. */
  reducedMotion: boolean;
  /** Sim speed (?speed=N tests): above 1 nothing changes the pace. */
  speed: number;
  /** The local player holds a load right now (steering it). */
  steering: boolean;
  /** Local player position (glance only toward things away from the player); null = none. */
  playerPos: { x: number; y: number } | null;
  /** Ticks until the end (Infinity without a time limit). */
  ticksLeft: number;
}

export interface MomentFeelPlan {
  glance: { pos: { x: number; y: number }; weight: number; ms: number } | null;
  slowmo: { scale: number; seconds: number } | null;
  hitstop: number;
}

const GLANCE_KINDS = new Set(['bigPlay', 'jackpot', 'craneDrop', 'goldHammer']);

/**
 * What this tick's moments do to the camera and the clock (at most one glance and one pace
 * change per tick). Reduced motion: nothing at all.
 */
export function planMomentFeel(moments: readonly { kind: string; pos?: { x: number; y: number } }[], ctx: MomentFeelContext): MomentFeelPlan {
  const plan: MomentFeelPlan = { glance: null, slowmo: null, hitstop: 0 };
  if (ctx.reducedMotion || !moments.length) return plan;
  const F = MOMENT_FEEL;
  let pace = false;
  for (const m of moments) {
    if (m.kind === 'bigPlay' || (m.kind === 'leadTaken' && ctx.ticksLeft <= F.leadTakenFinalTicks)) pace = true;
    if (!plan.glance && !ctx.steering && m.pos && GLANCE_KINDS.has(m.kind)) {
      const d = ctx.playerPos ? Math.hypot(m.pos.x - ctx.playerPos.x, m.pos.y - ctx.playerPos.y) : Infinity;
      if (d >= F.glance.minDist && d <= F.glance.maxDist) plan.glance = { pos: { x: m.pos.x, y: m.pos.y }, weight: F.glance.weight, ms: F.glance.ms };
    }
  }
  if (pace && ctx.speed <= 1) {
    if (ctx.steering) plan.hitstop = F.steeringHitstop;
    else plan.slowmo = { ...F.slowmo };
  }
  return plan;
}

/** Apply a plan (match.ts): returns which effects actually ran (stats / tests). */
export function applyMomentFeel(plan: MomentFeelPlan, time: TimeScale, glance: (pos: { x: number; y: number }, weight: number, ms: number) => void): { glance: boolean; slowmo: boolean; hitstop: boolean } {
  const ran = { glance: false, slowmo: false, hitstop: false };
  if (!time.isEnabled) return ran;
  if (plan.glance) {
    glance(plan.glance.pos, Math.min(0.3, plan.glance.weight), plan.glance.ms);
    ran.glance = true;
  }
  if (plan.slowmo) {
    time.slowmo(plan.slowmo.scale, plan.slowmo.seconds);
    ran.slowmo = true;
  }
  if (plan.hitstop > 0) {
    time.hitstop(plan.hitstop);
    ran.hitstop = true;
  }
  return ran;
}
