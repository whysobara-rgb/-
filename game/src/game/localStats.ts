/**
 * Local multiplayer results: honest per-player numbers from the sim events (unit-tested).
 *
 *  - uproots: the player was holding the loot on the tick it came loose ('unanchored');
 *  - steals: the player pulled a safe out of a bank the other team was hauling ('safeUnloaded',
 *    the same rule as the HUD's "가로채기!" stamp);
 *  - recovered: points of every recovery the player was holding at completion ('recovered'
 *    holders; each holder is credited the full value — they hauled it home).
 */
import type { EntityId, SimEvent, TeamId } from '../sim/types';

export interface PlayerStatLine {
  charId: EntityId;
  index: number;
  team: TeamId;
  uproots: number;
  steals: number;
  recovered: number;
}

export interface StatsSimView {
  getLoot(id: EntityId): { grabbedBy: readonly EntityId[] } | undefined;
  getCharacter(id: EntityId): { team: TeamId } | undefined;
}

export class LocalStatsTracker {
  private readonly lines = new Map<EntityId, PlayerStatLine>();

  constructor(players: ReadonlyArray<{ charId: EntityId; index: number; team: TeamId }>) {
    for (const p of players) this.lines.set(p.charId, { charId: p.charId, index: p.index, team: p.team, uproots: 0, steals: 0, recovered: 0 });
  }

  /** Feed one tick's events (call right after sim.step, before the next step). */
  observe(events: readonly SimEvent[], sim: StatsSimView): void {
    for (const e of events) {
      if (e.type === 'unanchored') {
        const holders = sim.getLoot(e.lootId)?.grabbedBy ?? [];
        for (const id of new Set(holders)) {
          const l = this.lines.get(id);
          if (l) l.uproots++;
        }
      } else if (e.type === 'safeUnloaded') {
        if (e.byCharId === null || e.bankCarrierTeam === null) continue;
        const l = this.lines.get(e.byCharId);
        const thief = sim.getCharacter(e.byCharId)?.team;
        if (l && thief !== undefined && thief !== e.bankCarrierTeam) l.steals++;
      } else if (e.type === 'recovered') {
        for (const id of new Set(e.holders)) {
          const l = this.lines.get(id);
          if (l) l.recovered += e.value;
        }
      }
    }
  }

  snapshot(): PlayerStatLine[] {
    return [...this.lines.values()].sort((a, b) => a.index - b.index);
  }
}

export type HighlightKind = 'uproots' | 'steals' | 'recovered';

export interface Highlight {
  kind: HighlightKind;
  /** Player indices sharing the top value (ties are shared, never broken at random). */
  players: number[];
  value: number;
}

/** Who did the most of each thing (rows where nobody scored are left out). */
export function pickHighlights(lines: readonly PlayerStatLine[]): Highlight[] {
  const out: Highlight[] = [];
  for (const kind of ['uproots', 'steals', 'recovered'] as const) {
    const top = Math.max(0, ...lines.map((l) => l[kind]));
    if (top <= 0) continue;
    out.push({ kind, players: lines.filter((l) => l[kind] === top).map((l) => l.index), value: top });
  }
  return out;
}
