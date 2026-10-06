/**
 * Achievement detection for game flow (Steam ids in src/platform/steam.ts).
 *
 * Pure functions over the real simulation record (SimEvent[]), so they are unit-testable and
 * give the same answer for replays. Match achievements can be evaluated while the match is
 * running (toast at the moment it happens) and once more at the end (COMEBACK needs the
 * result). Tournament / wardrobe achievements come from flow decisions.
 *
 * Rules (integration spec):
 *   FIRST_RECOVERY   the human took part in a recovery by their team
 *   BANK_WHOLE       ... of a bank with >= 1 safe loaded inside
 *   BANK_HEIST_TEAM  2:2 — a bank recovered while the human AND a teammate both held it
 *   STEAL_LARGE      the human pulled a large safe out of a bank the opponents were hauling,
 *                    and the human's team then recovered that safe
 *   FENCE_BREAKER    a fence broken by a bank the human was holding
 *   LAST_SECONDS     the human took part in a recovery within the final 5 s of the clock
 *   COMEBACK         won after trailing by >= 500 confirmed points
 * "Took part" = holding the item at completion, or let go of it within the last 3 s (a push
 * into the zone counts).
 */
import { secondsToTicks } from '../sim/config';
import type { EntityId, LootKind, MatchResult, SimEvent, TeamId } from '../sim/types';
import type { AchievementId } from '../platform/steam';
import type { RivalId } from '../ai';

export interface AchievementInput {
  events: readonly SimEvent[];
  /** null while the match is running. */
  result: MatchResult | null;
  humanCharId: EntityId;
  humanTeam: TeamId;
  characters: ReadonlyArray<{ id: EntityId; team: TeamId }>;
  loot: ReadonlyArray<{ id: EntityId; kind: LootKind }>;
  rules: { matchTicks: number; timeLimit: boolean };
}

export const PARTICIPATION_GRACE_TICKS = secondsToTicks(3);
export const LAST_SECONDS_TICKS = secondsToTicks(5);
export const COMEBACK_DEFICIT = 500;

const ORDER: readonly AchievementId[] = [
  'FIRST_RECOVERY',
  'BANK_WHOLE',
  'BANK_HEIST_TEAM',
  'STEAL_LARGE',
  'FENCE_BREAKER',
  'LAST_SECONDS',
  'COMEBACK',
  'BEAT_HODADAK',
  'BEAT_TONGKEUN',
  'BEAT_NUNCHI',
  'TOURNAMENT_CLEAR',
  'WARDROBE',
];

export function evaluateMatchAchievements(m: AchievementInput): AchievementId[] {
  const human = m.humanCharId;
  const myTeam = m.humanTeam;
  const kindOf = new Map(m.loot.map((l) => [l.id, l.kind] as const));
  const teammates = m.characters.filter((c) => c.team === myTeam && c.id !== human).map((c) => c.id);
  const holders = new Map<EntityId, Set<EntityId>>();
  const lastRelease = new Map<string, number>();
  const stolenLarge = new Set<EntityId>();
  const scores: [number, number] = [0, 0];
  let maxDeficit = 0;
  let endTick = m.rules.timeLimit ? m.rules.matchTicks : Infinity;
  const out = new Set<AchievementId>();

  const key = (c: EntityId, l: EntityId): string => `${c}:${l}`;
  const tookPart = (c: EntityId, lootId: EntityId, tick: number, atEnd: readonly EntityId[]): boolean => {
    if (atEnd.includes(c)) return true;
    const rel = lastRelease.get(key(c, lootId));
    return rel !== undefined && tick - rel <= PARTICIPATION_GRACE_TICKS;
  };

  for (const e of m.events) {
    switch (e.type) {
      case 'grab': {
        let s = holders.get(e.targetId);
        if (!s) holders.set(e.targetId, (s = new Set()));
        s.add(e.charId);
        break;
      }
      case 'release':
        holders.get(e.targetId)?.delete(e.charId);
        lastRelease.set(key(e.charId, e.targetId), e.tick);
        break;
      case 'fenceBroken':
        if (holders.get(e.bankId)?.has(human)) out.add('FENCE_BREAKER');
        break;
      case 'safeUnloaded':
        if (e.byCharId === human && kindOf.get(e.safeId) === 'largeSafe' && e.bankCarrierTeam !== null && e.bankCarrierTeam !== myTeam) {
          stolenLarge.add(e.safeId);
        }
        break;
      case 'finalCountdown':
        endTick = e.endTick;
        break;
      case 'recovered': {
        scores[e.team] += e.value;
        maxDeficit = Math.max(maxDeficit, scores[(1 - myTeam) as TeamId] - scores[myTeam]);
        if (e.team === myTeam) {
          const humanIn = tookPart(human, e.lootId, e.tick, e.holders);
          if (humanIn) out.add('FIRST_RECOVERY');
          if (e.kind === 'bank' && humanIn && e.safeIds.length >= 1) out.add('BANK_WHOLE');
          if (e.kind === 'bank' && humanIn && teammates.some((t) => tookPart(t, e.lootId, e.tick, e.holders))) out.add('BANK_HEIST_TEAM');
          if (stolenLarge.has(e.lootId) || e.safeIds.some((id) => stolenLarge.has(id))) out.add('STEAL_LARGE');
          if (humanIn && Number.isFinite(endTick) && e.tick <= endTick && e.tick >= endTick - LAST_SECONDS_TICKS) out.add('LAST_SECONDS');
        }
        holders.delete(e.lootId);
        for (const id of e.safeIds) holders.delete(id);
        break;
      }
      default:
        break;
    }
  }
  if (m.result && m.result.winner === myTeam && maxDeficit >= COMEBACK_DEFICIT) out.add('COMEBACK');
  return ORDER.filter((id) => out.has(id));
}

export const BEAT_ACHIEVEMENT: Readonly<Record<RivalId, AchievementId>> = {
  hodadak: 'BEAT_HODADAK',
  tongkeun: 'BEAT_TONGKEUN',
  nunchi: 'BEAT_NUNCHI',
};

/** Tournament achievements implied by the beaten list (idempotent). */
export function tournamentAchievements(beaten: readonly RivalId[]): AchievementId[] {
  const out = new Set<AchievementId>();
  for (const r of beaten) out.add(BEAT_ACHIEVEMENT[r]);
  if ((['hodadak', 'tongkeun', 'nunchi'] as const).every((r) => beaten.includes(r))) out.add('TOURNAMENT_CLEAR');
  return ORDER.filter((id) => out.has(id));
}

const REWARD_HATS = new Set(['hodadakBand', 'tongkeunHat', 'nunchiMask']);

/** WARDROBE: equipping one of the rival reward hats. */
export function wardrobeAchievement(equipped: string): AchievementId[] {
  return REWARD_HATS.has(equipped) ? ['WARDROBE'] : [];
}
