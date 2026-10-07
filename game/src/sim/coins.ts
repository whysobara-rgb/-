/**
 * [C1] Coin economy: loose piles, bags (주머니), deposit (쏟아붓기), spill (와르르)
 * (content-plan §3.3–3.5). Day-0 skeleton by C0: hooks are no-ops and the cross-package entry
 * points below have FROZEN signatures — C1 fills in the bodies, callers never re-implement them.
 *
 * Callers: props (C3: spurts, bonks, sheds, smash), items (C2: hammer spill), police (tackle ->
 * spillBag, one-line hook), events (C5: rain, truck), gimmicks (C4: hazard spills).
 * Conservation: value only MOVES (innerValue -> pile -> bag -> score); spawnCoins never creates
 * value, the caller subtracts exactly Σ values from its source in the same tick.
 */
import { ContentSystemBase } from './systemBase';
import type { CoinSpawnSource, EntityId, SpillCause, TeamId, Vec2 } from './types';

/** A burst of piles (fixed tables relative to the source, no RNG; mirrored hit -> mirrored piles). */
export interface CoinSpawnRequest {
  /** Burst origin (world). */
  pos: Vec2;
  /** Pattern centre direction in radians (hit / knockback direction); ignored by 'radial'. */
  dir: number;
  /** Pile values in spawn order (index i uses COINS.speeds[i % n]). */
  values: ReadonlyArray<10 | 50>;
  /** 'fan' = ±COINS.fanHalfAngle around dir; 'radial' = evenly around; 'ring' = landing ring. */
  pattern: 'fan' | 'radial' | 'ring';
  source: CoinSpawnSource;
  sourceId: EntityId | string | null;
  byCharId: EntityId | null;
  /** Spill victim: cannot pick these up for COINS.ownSpillLockTicks. */
  noPickupCharId?: EntityId | null;
  /** 'ring' only: landing radius range around pos (돈비 6–9 m). */
  ring?: { min: number; max: number };
}

/** A bag deposit completed this tick (settled in step 4 with the loot recoveries). */
export interface DepositClaim {
  charId: EntityId;
  team: TeamId;
  value: number;
}

export class CoinSystem extends ContentSystemBase {
  readonly name = 'coins' as const;

  /**
   * [C1] Spawn piles for a burst, emit one `coinSpawn`, return the new pile ids (ascending).
   * The CALLER removes Σ values from its source (innerValue / pendingValue / bag) the same tick.
   */
  spawnCoins(req: CoinSpawnRequest): EntityId[] {
    throw new Error(`CoinSystem.spawnCoins not implemented yet (C1); ${req.values.length} piles from ${req.source} would break conservation`);
  }

  /**
   * [C1] 와르르: knock `victimId`'s bag loose (knockdown by an opposing dash, a hammer, a police
   * tackle or a hazard). Spills max(spillMin, floor(bag·spillFraction/10)·10) capped at the bag,
   * as 동전 10 piles fanned around `dir` (knockback direction); emits `bagSpilled`. Returns the
   * spilled value (0 for an empty bag, a protected victim, or a self-inflicted crash).
   */
  spillBag(victimId: EntityId, cause: SpillCause, byId: EntityId | null, dir: number): number {
    const ch = this.ctx.state.characters[victimId - 1];
    if (!ch || !ch.bag) return 0;
    throw new Error(`CoinSystem.spillBag not implemented yet (C1); ${cause} by ${String(byId)} dir ${dir}`);
  }

  /** [C1] Step 4: deposits completed this tick (ascending charId). Settled by settleDeposits (rules.ts). */
  collectDeposits(): DepositClaim[] {
    return NO_DEPOSITS;
  }
}

export const NO_DEPOSITS: DepositClaim[] = [];
