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
    default:
      return null;
  }
}
