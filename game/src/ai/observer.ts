/**
 * Rival observation and between-game adaptation (doc §11 "라이벌전의 다음 판", §19 라이벌 재대결 검증).
 *
 * RivalObserver records, during a rival game, only what the bot team could really know:
 *  - public recovery records (recovered events) of the human team;
 *  - chokepoints (layout.chokepoints) where a human was SEEN — by a bot of the bot team, within
 *    VISION.radius and line of sight — carrying a small safe;
 *  - thefts from a bank the bots were hauling (safeUnloaded with bankCarrierTeam = bot team and
 *    byCharId on the human team: the bank's estimate visibly drops while they hold it).
 * chooseAdaptation then strengthens exactly ONE existing behavior for the next game — the counter
 * to whatever cost the bots the most points — or nothing. It never changes stats and never makes
 * the bots track unseen players (doc §11: "능력치 상승이나 실시간 머신러닝이 아니다").
 */
import type { Simulation } from '../sim/sim';
import { VISION } from '../sim/config';
import type { EntityId, LayoutDef, LayoutId, SimEvent, TeamId } from '../sim/types';
import type { Adaptation, RivalId } from './types';

export interface ObservationSummary {
  humanTeam: TeamId;
  botTeam: TeamId;
  layoutId: LayoutId;
  /** Ticks observed. */
  ticks: number;
  /** Small safes the human(s) recovered (public record). */
  smallRecoveries: number;
  smallRecoveryValue: number;
  /** Chokepoint id -> distinct small-safe carry trips SEEN passing it. */
  chokeSightings: Record<string, number>;
  /** Chokepoint id -> value of seen-passing small safes that the human team then recovered. */
  chokeValue: Record<string, number>;
  /** Whole banks the human team recovered (public record). */
  bankRecoveries: number;
  bankRecoveryValue: number;
  /** Safes the human team pulled out of a bank the bots were hauling. */
  thefts: number;
  theftValue: number;
}

export class RivalObserver {
  readonly humanTeam: TeamId;
  readonly botTeam: TeamId;
  private readonly s: ObservationSummary;
  /** `${charId}:${safeId}:${chokeId}` trips already counted. */
  private readonly tripSeen = new Set<string>();
  /** safe id -> chokepoints it was seen passing (while carried by a human). */
  private readonly safeChokes = new Map<EntityId, Set<string>>();
  private lastEventIdx = 0;
  private lastTick = -1;

  constructor(sim: Simulation, humanTeam: TeamId) {
    this.humanTeam = humanTeam;
    this.botTeam = (1 - humanTeam) as TeamId;
    this.s = {
      humanTeam,
      botTeam: this.botTeam,
      layoutId: sim.layout.id,
      ticks: 0,
      smallRecoveries: 0,
      smallRecoveryValue: 0,
      chokeSightings: {},
      chokeValue: {},
      bankRecoveries: 0,
      bankRecoveryValue: 0,
      thefts: 0,
      theftValue: 0,
    };
    this.lastEventIdx = sim.eventLog.length;
  }

  /**
   * Call once per tick after sim.step with that step's events (or [] — the observer also reads
   * any events it has not seen yet from sim.eventLog, so passing events is optional).
   */
  observe(sim: Simulation, events: SimEvent[]): void {
    const st = sim.state;
    if (st.tick !== this.lastTick) {
      this.lastTick = st.tick;
      this.s.ticks++;
      this.sight(sim);
    }
    const log = sim.eventLog;
    const fresh = this.lastEventIdx < log.length ? log.slice(this.lastEventIdx) : events;
    this.lastEventIdx = log.length;
    for (const e of fresh) this.onEvent(sim, e);
  }

  summary(): ObservationSummary {
    return {
      ...this.s,
      chokeSightings: { ...this.s.chokeSightings },
      chokeValue: { ...this.s.chokeValue },
    };
  }

  private sight(sim: Simulation): void {
    const st = sim.state;
    const bots = st.characters.filter((c) => c.team === this.botTeam && c.isBot);
    if (!bots.length || !sim.layout.chokepoints.length) return;
    const r2 = VISION.radius * VISION.radius;
    for (const h of st.characters) {
      if (h.team !== this.humanTeam || h.isBot) continue;
      // seen by a bot of the bot team? (only then may we look at what it carries)
      let seen = false;
      for (const b of bots) {
        const dx = h.pos.x - b.pos.x;
        const dy = h.pos.y - b.pos.y;
        if (dx * dx + dy * dy > r2) continue;
        if (sim.lineOfSight(b.pos, h.pos)) {
          seen = true;
          break;
        }
      }
      if (!seen || !h.grab) continue;
      const l = sim.getLoot(h.grab.targetId);
      if (!l || l.kind !== 'smallSafe') continue;
      for (const c of sim.layout.chokepoints) {
        if (Math.hypot(h.pos.x - c.pos.x, h.pos.y - c.pos.y) > c.radius) continue;
        const key = `${h.id}:${l.id}:${c.id}`;
        if (this.tripSeen.has(key)) continue;
        this.tripSeen.add(key);
        this.s.chokeSightings[c.id] = (this.s.chokeSightings[c.id] ?? 0) + 1;
        let set = this.safeChokes.get(l.id);
        if (!set) this.safeChokes.set(l.id, (set = new Set()));
        set.add(c.id);
      }
    }
  }

  private isHuman(sim: Simulation, id: EntityId | null): boolean {
    if (id === null) return false;
    const ch = sim.getCharacter(id);
    return !!ch && ch.team === this.humanTeam && !ch.isBot;
  }

  private onEvent(sim: Simulation, e: SimEvent): void {
    if (e.type === 'recovered' && e.team === this.humanTeam) {
      if (e.kind === 'smallSafe') {
        const seenChokes = this.safeChokes.get(e.lootId);
        if (e.holders.some((h) => this.isHuman(sim, h)) || seenChokes) {
          this.s.smallRecoveries++;
          this.s.smallRecoveryValue += e.value;
        }
        if (seenChokes) for (const c of seenChokes) this.s.chokeValue[c] = (this.s.chokeValue[c] ?? 0) + e.value;
      } else if (e.kind === 'bank') {
        this.s.bankRecoveries++;
        this.s.bankRecoveryValue += e.value;
      }
    } else if (e.type === 'safeUnloaded' && e.bankCarrierTeam === this.botTeam && e.byCharId !== null) {
      const ch = sim.getCharacter(e.byCharId);
      if (ch && ch.team === this.humanTeam) {
        const l = sim.getLoot(e.safeId);
        this.s.thefts++;
        this.s.theftValue += l ? l.baseValue : 0;
      }
    }
  }
}

/**
 * Pick exactly one counter for the next rival game (or null):
 *  - ambushChoke{chokepointId}: >= 2 sightings of small-safe carries at the same chokepoint;
 *  - stripBank: the human recovered a bank whole;
 *  - guardDoors: >= 1 theft from a bank the bots were hauling.
 * Among those that qualify, the one whose behavior cost the bots the most points wins.
 */
export function chooseAdaptation(summary: ObservationSummary, layout: LayoutDef, rival: RivalId): Adaptation | null {
  const opts: { kind: Adaptation['kind']; cost: number; order: number; choke?: LayoutDef['chokepoints'][number] }[] = [];
  // ambush: the most used chokepoint with >= 2 sightings
  let bestChoke: LayoutDef['chokepoints'][number] | null = null;
  let bestScore = -1;
  for (const c of layout.chokepoints) {
    const n = summary.chokeSightings[c.id] ?? 0;
    if (n < 2) continue;
    const score = (summary.chokeValue[c.id] ?? 0) + n * 50;
    if (score > bestScore) {
      bestScore = score;
      bestChoke = c;
    }
  }
  if (bestChoke) {
    const n = summary.chokeSightings[bestChoke.id] ?? 0;
    opts.push({ kind: 'ambushChoke', cost: Math.max(summary.chokeValue[bestChoke.id] ?? 0, n * 50), order: 2, choke: bestChoke });
  }
  if (summary.bankRecoveries >= 1) opts.push({ kind: 'stripBank', cost: summary.bankRecoveryValue, order: 0 });
  if (summary.thefts >= 1) opts.push({ kind: 'guardDoors', cost: summary.theftValue, order: 1 });
  if (!opts.length) return null;
  opts.sort((a, b) => b.cost - a.cost || a.order - b.order);
  const best = opts[0]!;
  const n = 1 + ((summary.smallRecoveries * 7 + summary.thefts * 13 + summary.bankRecoveries * 31 + Math.floor(summary.ticks / 60)) % 3);
  const lineKey = `adapt.${rival}.${best.kind}.${n}`;
  if (best.kind === 'ambushChoke' && best.choke) {
    return { kind: 'ambushChoke', chokepointId: best.choke.id, lineKey, lineParams: { choke: best.choke.nameKey } };
  }
  return { kind: best.kind, lineKey };
}
