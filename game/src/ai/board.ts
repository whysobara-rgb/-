/**
 * Team blackboard (doc §11 동료 봇: "팀 안의 운반 담당과 목적지를 간단히 공유해 같은 위치를
 * 계속 밀거나 둘 다 빈 은행만 추격하지 않게 한다").
 *
 * One per (Simulation, team). Holds the team-shared perception, the shared nav grid, goal
 * claims of the team's bots (so two teammates never chase the same thing or push the same
 * spot) and bank-face slots for co-hauling. Updated once per tick by whichever bot of the
 * team runs first.
 */
import type { Simulation } from '../sim/sim';
import type { EntityId, TeamId } from '../sim/types';
import { NavGrid } from './nav';
import { TeamPerception } from './perception';

export interface Claim {
  key: string;
  slot: number;
  tick: number;
  /** Target loot / character id (for UI/debug and teammate inference). */
  targetId: EntityId | null;
}

export class TeamBoard {
  private static readonly cache = new WeakMap<Simulation, TeamBoard[]>();
  static for(sim: Simulation, team: TeamId): TeamBoard {
    let arr = TeamBoard.cache.get(sim);
    if (!arr) {
      arr = [new TeamBoard(sim, 0), new TeamBoard(sim, 1)];
      TeamBoard.cache.set(sim, arr);
    }
    return arr[team]!;
  }

  readonly perception: TeamPerception;
  readonly nav: NavGrid;
  /** Slots of the bots registered on this team (sight sources). */
  readonly botSlots: number[] = [];
  private readonly claims = new Map<number, Claim>();
  private lastTick = -1;
  /** Final-30-s re-plans logged by bots (tools). */
  readonly log: { tick: number; slot: number; msg: string }[] = [];

  private constructor(
    sim: Simulation,
    readonly team: TeamId,
  ) {
    this.perception = new TeamPerception(sim, team);
    this.nav = NavGrid.for(sim);
  }

  register(slot: number): void {
    if (!this.botSlots.includes(slot)) this.botSlots.push(slot);
    this.botSlots.sort((a, b) => a - b);
  }

  /** Idempotent per tick. */
  tick(sim: Simulation): void {
    const t = sim.state.tick;
    if (t === this.lastTick) return;
    this.lastTick = t;
    this.nav.update(sim);
    this.nav.service(t);
    this.perception.update(sim, this.botSlots);
  }

  setClaim(slot: number, key: string | null, targetId: EntityId | null, tick: number): void {
    if (key === null) this.claims.delete(slot);
    else this.claims.set(slot, { key, slot, tick, targetId });
  }

  claimOf(slot: number): Claim | undefined {
    return this.claims.get(slot);
  }

  /** Claims of the other bots of this team. */
  otherClaims(slot: number): Claim[] {
    const out: Claim[] = [];
    for (const c of this.claims.values()) if (c.slot !== slot) out.push(c);
    return out;
  }

  isClaimedByOther(slot: number, key: string): boolean {
    for (const c of this.claims.values()) if (c.slot !== slot && c.key === key) return true;
    return false;
  }
}
