/**
 * Bot perception (doc §11 "공개된 전리품 위치와 가치, 시야에서 관찰한 상대와 마지막 관찰 위치만
 * 사용한다", §19 "봇이 시야 밖 상대를 추적한 경우 공개 목표·마지막 관찰 정보 중 무엇을 썼는지").
 *
 * This is the ONLY place in src/ai that reads opponent CharacterState. An opponent is seen
 * when a bot of the observing team is within VISION.radius and sim.lineOfSight holds
 * (team-shared sight between bot teammates). Otherwise bots get the last sighting (position,
 * velocity, what it held, tick), which ages. A reaction delay is applied per bot by reading
 * the history `delay` ticks back — a novice notices things later, it never knows more.
 *
 * Loot holders: the public loot state lists every holder id; bots only learn opponent
 * holders through sight as well (`holdersOf`).
 */
import type { Simulation } from '../sim/sim';
import { VISION } from '../sim/config';
import type { CharacterState, EntityId, LootState, TeamId, Vec2 } from '../sim/types';

/** Instrumentation for tests: >0 while perception is reading opponent state. */
export const perceptionAccess = { depth: 0 };

export interface Sighting {
  tick: number;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  /** Loot id held when seen (null = empty-handed). */
  holdingId: EntityId | null;
  holdingPart: 'safe' | 'bankWall' | null;
  knockedDown: boolean;
  /** Seen with knockdown protection active (render shows it). */
  protectedNow: boolean;
  onFloorOf: EntityId | null;
}

export interface OpponentView {
  id: EntityId;
  slot: number;
  team: TeamId;
  isBot: boolean;
  /** Seen at the (delayed) query tick. */
  visible: boolean;
  /** Last sighting at or before the query tick (null = never seen). */
  last: Sighting | null;
  /** Ticks since that sighting (Infinity when never seen). */
  age: number;
}

const HISTORY = 64;

interface Track {
  id: EntityId;
  slot: number;
  team: TeamId;
  isBot: boolean;
  /** Ring buffer: per tick, whether visible and the latest sighting known at that tick. */
  visible: Uint8Array;
  known: (Sighting | null)[];
  ticks: Int32Array;
  latest: Sighting | null;
}

export class TeamPerception {
  private readonly tracks: Track[] = [];
  private lastTick = -1;
  /** Sight checks performed (instrumentation). */
  losChecks = 0;

  constructor(
    sim: Simulation,
    readonly team: TeamId,
  ) {
    for (const ch of sim.state.characters) {
      if (ch.team === team) continue;
      this.tracks.push({
        id: ch.id,
        slot: ch.slot,
        team: ch.team,
        isBot: ch.isBot,
        visible: new Uint8Array(HISTORY),
        known: new Array<Sighting | null>(HISTORY).fill(null),
        ticks: new Int32Array(HISTORY).fill(-1),
        latest: null,
      });
    }
  }

  /** Once per tick: sight from every bot of this team. */
  update(sim: Simulation, observerSlots: ReadonlyArray<number>): void {
    const tick = sim.state.tick;
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    const observers: CharacterState[] = [];
    for (const s of observerSlots) {
      const o = sim.state.characters[s];
      if (o) observers.push(o);
    }
    const r2 = VISION.radius * VISION.radius;
    perceptionAccess.depth++;
    try {
      for (const t of this.tracks) {
        const ch = sim.state.characters[t.slot]!;
        let seen = false;
        for (const o of observers) {
          const dx = ch.pos.x - o.pos.x;
          const dy = ch.pos.y - o.pos.y;
          if (dx * dx + dy * dy > r2) continue;
          this.losChecks++;
          if (sim.lineOfSight(o.pos, ch.pos)) {
            seen = true;
            break;
          }
        }
        if (seen) {
          t.latest = {
            tick,
            pos: { x: ch.pos.x, y: ch.pos.y },
            vel: { x: ch.vel.x, y: ch.vel.y },
            facing: ch.facing,
            holdingId: ch.grab ? ch.grab.targetId : null,
            holdingPart: ch.grab ? ch.grab.part : null,
            knockedDown: ch.knockdownTicks > 0,
            protectedNow: ch.protectTicks > 0,
            onFloorOf: ch.floorOf,
          };
        }
        const i = tick % HISTORY;
        t.visible[i] = seen ? 1 : 0;
        t.known[i] = t.latest;
        t.ticks[i] = tick;
      }
    } finally {
      perceptionAccess.depth--;
    }
  }

  /** Opponents as known `delay` ticks ago (clamped to the history). */
  opponents(tick: number, delay = 0): OpponentView[] {
    const d = Math.max(0, Math.min(HISTORY - 1, delay));
    const q = tick - d;
    const out: OpponentView[] = [];
    for (const t of this.tracks) {
      const i = ((q % HISTORY) + HISTORY) % HISTORY;
      let visible = false;
      let last: Sighting | null = null;
      if (q >= 0 && t.ticks[i] === q) {
        visible = t.visible[i] === 1;
        last = t.known[i]!;
      } else if (t.latest && t.latest.tick <= q) {
        last = t.latest;
      }
      out.push({ id: t.id, slot: t.slot, team: t.team, isBot: t.isBot, visible, last, age: last ? tick - last.tick : Infinity });
    }
    return out;
  }

  /** Latest sighting of one opponent (no delay). */
  latest(id: EntityId): Sighting | null {
    return this.tracks.find((t) => t.id === id)?.latest ?? null;
  }
}

/**
 * Holders of a loot item that this team may know about: own-team holders always, opponent
 * holders only when currently seen holding it (no delay applied here; callers that react to
 * opponents should use `opponents(tick, delay)`).
 */
export function holdersOf(sim: Simulation, l: LootState, team: TeamId, perception: TeamPerception): EntityId[] {
  const out: EntityId[] = [];
  for (const ch of sim.state.characters) {
    if (ch.team !== team) continue;
    if (ch.grab && ch.grab.targetId === l.id) out.push(ch.id);
  }
  for (const o of perception.opponents(sim.state.tick, 0)) {
    if (o.visible && o.last && o.last.holdingId === l.id) out.push(o.id);
  }
  return out;
}
