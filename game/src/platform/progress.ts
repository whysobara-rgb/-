/**
 * Achievement conditions and stat summaries derived from REAL match records (the sim event
 * log), never from guesses — the same principle as the results screen (doc §12).
 *
 * Pure functions over `SimEvent[]`, so they are unit-testable and give identical answers for
 * replays. Game flow calls them once when a match ends:
 *
 *   const input = { events: sim.eventLog, result: sim.state.result!, humanCharId, humanTeam,
 *                   characters: sim.state.characters, loot: sim.state.loot };
 *   awardAchievements(evaluateMatchAchievements(input));
 *   save.update((d) => { d.stats = applyMatchStats(d.stats, summarizeMatchStats(input)); });
 *
 * Tournament / wardrobe achievements come from the save itself (`progressAchievements`).
 */
import { secondsToTicks } from '../sim/config';
import type { EntityId, LootKind, MatchResult, SimEvent, TeamId } from '../sim/types';
import { RIVALS, RIVAL_REWARD_HAT, getSaveManager, type MatchStatsSummary, type SaveData, type SaveManager } from './save';
import { ACHIEVEMENT_IDS, unlockAchievement, type AchievementId } from './steam';

export interface MatchRecordInput {
  events: readonly SimEvent[];
  result: MatchResult;
  humanCharId: EntityId;
  humanTeam: TeamId;
  /** Every character's id and team (sim.state.characters). */
  characters: ReadonlyArray<{ id: EntityId; team: TeamId }>;
  /** Every loot id and kind (sim.state.loot). */
  loot: ReadonlyArray<{ id: EntityId; kind: LootKind }>;
}

/** A character who let go of an item this recently still counts as having recovered it (pushed it in). */
export const PARTICIPATION_GRACE_TICKS = secondsToTicks(3);
/** LAST_SECONDS: completion within the final 5 s of a match that ran out the clock. */
export const LAST_SECONDS_TICKS = secondsToTicks(5);
/** COMEBACK: win after trailing by more than this many confirmed points. */
export const COMEBACK_DEFICIT = 500;

/** Achievements earned in one finished match, in ACHIEVEMENT_IDS order. */
export function evaluateMatchAchievements(m: MatchRecordInput): AchievementId[] {
  const human = m.humanCharId;
  const myTeam = m.humanTeam;
  const kindOf = new Map(m.loot.map((l) => [l.id, l.kind] as const));
  const teammates = m.characters.filter((c) => c.team === myTeam && c.id !== human).map((c) => c.id);
  const holders = new Map<EntityId, Set<EntityId>>();
  const lastRelease = new Map<string, number>();
  const stolenLarge = new Set<EntityId>();
  const scores: [number, number] = [0, 0];
  let maxDeficit = 0;
  const out = new Set<AchievementId>();

  const key = (charId: EntityId, lootId: EntityId): string => `${charId}:${lootId}`;
  const took = (charId: EntityId, lootId: EntityId, tick: number, atEnd: readonly EntityId[]): boolean => {
    if (atEnd.includes(charId)) return true;
    const rel = lastRelease.get(key(charId, lootId));
    return rel !== undefined && tick - rel <= PARTICIPATION_GRACE_TICKS;
  };

  for (const e of m.events) {
    switch (e.type) {
      case 'grab': {
        let set = holders.get(e.targetId);
        if (!set) holders.set(e.targetId, (set = new Set()));
        set.add(e.charId);
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
      case 'recovered': {
        scores[e.team] += e.value;
        maxDeficit = Math.max(maxDeficit, scores[myTeam === 0 ? 1 : 0] - scores[myTeam]);
        if (e.team === myTeam) {
          const humanIn = took(human, e.lootId, e.tick, e.holders);
          if (humanIn) out.add('FIRST_RECOVERY');
          if (e.kind === 'bank' && humanIn) {
            out.add('BANK_WHOLE');
            if (teammates.some((t) => took(t, e.lootId, e.tick, e.holders))) out.add('BANK_HEIST_TEAM');
          }
          if (stolenLarge.has(e.lootId) || e.safeIds.some((id) => stolenLarge.has(id))) out.add('STEAL_LARGE');
          if (humanIn && m.result.reason === 'time' && e.tick >= m.result.endTick - LAST_SECONDS_TICKS) out.add('LAST_SECONDS');
        }
        holders.delete(e.lootId);
        for (const id of e.safeIds) holders.delete(id);
        break;
      }
      default:
        break;
    }
  }
  if (m.result.winner === myTeam && maxDeficit > COMEBACK_DEFICIT) out.add('COMEBACK');
  return ACHIEVEMENT_IDS.filter((id) => out.has(id));
}

/** Stats contribution of one finished match (player's team). */
export function summarizeMatchStats(m: Pick<MatchRecordInput, 'events' | 'result' | 'humanTeam'>): MatchStatsSummary {
  let banks = 0;
  let safes = 0;
  for (const e of m.events) {
    if (e.type !== 'recovered' || e.team !== m.humanTeam) continue;
    if (e.kind === 'bank') {
      banks++;
      safes += e.safeIds.length;
    } else safes++;
  }
  const w = m.result.winner;
  return {
    outcome: w === null ? 'draw' : w === m.humanTeam ? 'win' : 'loss',
    teamScore: m.result.scores[m.humanTeam],
    banksRecovered: banks,
    safesRecovered: safes,
  };
}

const BEAT: Readonly<Record<(typeof RIVALS)[number], AchievementId>> = {
  hodadak: 'BEAT_HODADAK',
  tongkeun: 'BEAT_TONGKEUN',
  nunchi: 'BEAT_NUNCHI',
};

/** Tournament and wardrobe achievements implied by the save (idempotent). */
export function progressAchievements(save: Readonly<SaveData>): AchievementId[] {
  const out = new Set<AchievementId>();
  for (const r of save.tournament.beaten) out.add(BEAT[r]);
  if (RIVALS.every((r) => save.tournament.beaten.includes(r))) out.add('TOURNAMENT_CLEAR');
  if (RIVALS.every((r) => save.cosmetics.unlocked.includes(RIVAL_REWARD_HAT[r]))) out.add('WARDROBE');
  return ACHIEVEMENT_IDS.filter((id) => out.has(id));
}

/** Unlock a list of achievements; returns the ones that were new (for toasts). */
export function awardAchievements(ids: readonly AchievementId[], save: SaveManager = getSaveManager()): AchievementId[] {
  return ids.filter((id) => unlockAchievement(id, save));
}
