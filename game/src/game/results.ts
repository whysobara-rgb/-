/**
 * Results screen "biggest event" (doc §12 결과에서 다음 계획으로 연결).
 *
 * Picks the ONE event of the match in which the most value actually moved, using only the
 * real simulation record (sim.eventLog) — never a guessed cause or an invented story:
 *   - the largest single recovery (bank: building + loaded safes breakdown),
 *   - a safe pulled out of a bank the other team was hauling ("은행에서 큰 금고 300점이 빠짐"),
 *   - a recovery in the last seconds of the clock ("마지막 12초에 작은 금고 회수"),
 *   - a fence busted by a moving bank (a shortcut opened for everyone).
 * Ranking: value moved (points) first, then lateness (later wins), then specificity.
 * Every text is an i18n key + params taken straight from event data.
 */
import { SCORE, TICK_RATE } from '../sim/config';
import type { EntityId, LootKind, SimEvent, TeamId } from '../sim/types';

export interface ResultsInput {
  events: readonly SimEvent[];
  /** Every character's id and team (sim.state.characters). */
  characters: ReadonlyArray<{ id: EntityId; team: TeamId }>;
  /** Every loot item (sim.state.loot; recovered items stay in the array). */
  loot: ReadonlyArray<{ id: EntityId; kind: LootKind; baseValue: number; homeBank?: EntityId | null }>;
  rules: { matchTicks: number; timeLimit: boolean };
}

export type BiggestEventType = 'recovery' | 'lastSeconds' | 'steal' | 'fence';

export interface BiggestEvent {
  type: BiggestEventType;
  /** i18n key (event.*). */
  key: string;
  params: Record<string, number>;
  /** Team that made the play (null = nobody in particular). */
  team: TeamId | null;
  /** Icon hint for the results card. */
  kind: LootKind | 'fence' | 'time';
  /** Points moved by this event (ranking key). */
  value: number;
  tick: number;
  lootId: EntityId | null;
}

/** A recovery this close to the scheduled end counts as a last-seconds play. */
export const LAST_SECONDS_WINDOW = 15;

/** Higher = preferred when value and tick are equal. */
const SPECIFICITY: Record<BiggestEventType, number> = { lastSeconds: 4, recovery: 3, steal: 2, fence: 1 };

function better(a: BiggestEvent, b: BiggestEvent | null): boolean {
  if (!b) return true;
  if (a.value !== b.value) return a.value > b.value;
  if (a.tick !== b.tick) return a.tick > b.tick;
  return SPECIFICITY[a.type] > SPECIFICITY[b.type];
}

/** Every candidate event (exported for tests / debugging), in log order. */
export function resultCandidates(input: ResultsInput): BiggestEvent[] {
  const teamOf = new Map<EntityId, TeamId>();
  for (const c of input.characters) teamOf.set(c.id, c.team);
  const lootById = new Map(input.loot.map((l) => [l.id, l] as const));
  const out: BiggestEvent[] = [];

  // Scheduled end of the clock (moves earlier once on 'finalCountdown').
  let endTick = input.rules.timeLimit ? input.rules.matchTicks : Infinity;
  /** Banks that busted a fence. */
  const fenceBanks = new Set<EntityId>();
  /** Bank id -> teams that have held its wall. */
  const bankHolders = new Map<EntityId, Set<TeamId>>();
  /** Safe id -> team that pulled it out of a bank the OTHER team was hauling. */
  const stolenBy = new Map<EntityId, TeamId>();
  /** Bank id -> last known estimate (from load/unload events). */
  const bankValue = new Map<EntityId, number>();
  /** Bank id -> characters holding it right now. */
  const holding = new Map<EntityId, Set<EntityId>>();

  const initialBankValue = (bankId: EntityId): number => {
    let v = SCORE.bankBuilding;
    for (const l of input.loot) if (l.homeBank === bankId) v += l.baseValue;
    return v;
  };

  for (const e of input.events) {
    switch (e.type) {
      case 'grab': {
        const l = lootById.get(e.targetId);
        if (l?.kind === 'bank') {
          const t = teamOf.get(e.charId);
          if (t !== undefined) {
            let s = bankHolders.get(l.id);
            if (!s) bankHolders.set(l.id, (s = new Set()));
            s.add(t);
          }
        }
        let h = holding.get(e.targetId);
        if (!h) holding.set(e.targetId, (h = new Set()));
        h.add(e.charId);
        break;
      }
      case 'release':
        holding.get(e.targetId)?.delete(e.charId);
        break;
      case 'safeLoaded':
        bankValue.set(e.bankId, e.bankValue);
        break;
      case 'safeUnloaded': {
        bankValue.set(e.bankId, e.bankValue);
        if (e.byCharId === null || e.bankCarrierTeam === null) break;
        const t = teamOf.get(e.byCharId);
        if (t === undefined || t === e.bankCarrierTeam) break;
        const l = lootById.get(e.safeId);
        if (!l || l.kind === 'bank') break;
        stolenBy.set(l.id, t);
        out.push({
          type: 'steal',
          key: l.kind === 'largeSafe' ? 'event.largePulled' : 'event.smallPulled',
          params: { value: l.baseValue },
          team: t,
          kind: l.kind,
          value: l.baseValue,
          tick: e.tick,
          lootId: l.id,
        });
        break;
      }
      case 'fenceBroken': {
        fenceBanks.add(e.bankId);
        const holders = holding.get(e.bankId);
        let team: TeamId | null = null;
        if (holders) for (const id of holders) team = teamOf.get(id) ?? team;
        const v = bankValue.get(e.bankId) ?? initialBankValue(e.bankId);
        out.push({ type: 'fence', key: 'event.fenceBroken', params: { value: v }, team, kind: 'fence', value: v, tick: e.tick, lootId: e.bankId });
        break;
      }
      case 'finalCountdown':
        endTick = e.endTick;
        break;
      case 'recovered': {
        const secLeft = (endTick - e.tick) / TICK_RATE;
        const isBank = e.kind === 'bank';
        let ev: BiggestEvent;
        if (Number.isFinite(secLeft) && secLeft >= 0 && secLeft <= LAST_SECONDS_WINDOW) {
          const sec = Math.max(1, Math.ceil(secLeft - 1e-9));
          ev = {
            type: 'lastSeconds',
            key: isBank ? 'event.lastSecondsBank' : e.kind === 'largeSafe' ? 'event.lastSecondsLarge' : 'event.lastSecondsSmall',
            params: isBank ? { sec, total: e.value } : { sec, value: e.value },
            team: e.team,
            kind: e.kind,
            value: e.value,
            tick: e.tick,
            lootId: e.lootId,
          };
        } else if (isBank) {
          const otherHeld = bankHolders.get(e.lootId)?.has((1 - e.team) as TeamId) ?? false;
          let key: string;
          let params: Record<string, number>;
          if (otherHeld) {
            key = 'event.bankStolen';
            params = { total: e.value };
          } else if (fenceBanks.has(e.lootId)) {
            key = 'event.fenceBankRecovered';
            params = { total: e.value };
          } else if (e.safesValue > 0) {
            key = 'event.bankWhole';
            params = { building: e.value - e.safesValue, safes: e.safesValue, total: e.value };
          } else {
            key = 'event.bankEmpty';
            params = { building: e.value };
          }
          ev = { type: 'recovery', key, params, team: e.team, kind: 'bank', value: e.value, tick: e.tick, lootId: e.lootId };
        } else {
          const stolen = e.kind === 'largeSafe' && stolenBy.get(e.lootId) === e.team;
          ev = {
            type: 'recovery',
            key: stolen ? 'event.stolenSafeRecovered' : e.kind === 'largeSafe' ? 'event.largeRecovered' : 'event.smallRecovered',
            params: { value: e.value },
            team: e.team,
            kind: e.kind,
            value: e.value,
            tick: e.tick,
            lootId: e.lootId,
          };
        }
        out.push(ev);
        holding.delete(e.lootId);
        for (const id of e.safeIds) holding.delete(id);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** The single biggest real event of the match, or null when nothing happened. */
export function pickBiggestEvent(input: ResultsInput): BiggestEvent | null {
  let best: BiggestEvent | null = null;
  for (const c of resultCandidates(input)) if (better(c, best)) best = c;
  return best;
}

/** Shape expected by the UI ResultsScreen (`ResultEventView`). */
export function toResultEventView(ev: BiggestEvent | null): { text: { key: string; params: Record<string, number> }; team: TeamId | null; kind: LootKind | 'fence' | 'time' } | null {
  if (!ev) return null;
  return { text: { key: ev.key, params: { ...ev.params } }, team: ev.team, kind: ev.type === 'lastSeconds' ? 'time' : ev.kind };
}
