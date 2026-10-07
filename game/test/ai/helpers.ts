/**
 * Shared helpers for the AI tests (bots, nav, perception, rival adaptation).
 */
import { Simulation } from '../../src/sim/sim';
import { LAYOUTS } from '../../src/sim/layouts/index';
import type { Command, LayoutDef, LayoutId, RosterEntry, SimEvent, TeamId, Vec2 } from '../../src/sim/types';
import { EMPTY_COMMAND } from '../../src/sim/types';
import { Bot } from '../../src/ai/bot';
import type { Difficulty, RivalId } from '../../src/ai/types';

export const MATCH_LAYOUTS: LayoutId[] = ['plaza', 'shortcut', 'counter'];

export interface Member {
  team: TeamId;
  /** Omit for a non-bot (human-controlled) slot driven by the test. */
  bot?: { personality: RivalId; difficulty?: Difficulty };
}

export function makeMatch(layout: LayoutId | LayoutDef, members: Member[], seed = 7): { sim: Simulation; bots: (Bot | null)[] } {
  const def = typeof layout === 'string' ? LAYOUTS[layout] : layout;
  const roster: RosterEntry[] = members.map((m, i) => ({
    team: m.team,
    isBot: !!m.bot,
    name: m.bot ? `${m.bot.personality}${i}` : `human${i}`,
    look: { hat: 'none' },
  }));
  const sim = new Simulation({ layout: def, roster, seed });
  const bots = members.map((m, slot) =>
    m.bot ? new Bot(sim, { slot, personality: m.bot.personality, difficulty: m.bot.difficulty ?? 'normal', seed: seed * 31 + slot }) : null,
  );
  return { sim, bots };
}

/** Step the match; `human(slot, sim)` provides commands for non-bot slots. */
export function stepMatch(
  sim: Simulation,
  bots: (Bot | null)[],
  ticks: number,
  human?: (slot: number, sim: Simulation) => Command,
  until?: (sim: Simulation, events: SimEvent[]) => boolean,
): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < ticks && !sim.state.over; t++) {
    const cmds = bots.map((b, slot) => (b ? b.update(sim) : human ? human(slot, sim) : EMPTY_COMMAND));
    const ev = sim.step(cmds);
    for (const e of ev) all.push(e);
    if (until && until(sim, ev)) break;
  }
  return all;
}

/** A free spot near `from` (ring search) satisfying `pred`. */
export function findSpot(sim: Simulation, from: Vec2, minR: number, maxR: number, pred: (p: Vec2) => boolean): Vec2 | null {
  for (let r = minR; r <= maxR; r += 0.5) {
    const n = Math.max(12, Math.ceil(r * 6));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
      if (p.x < 1 || p.y < 1 || p.x > sim.layout.size.x - 1 || p.y > sim.layout.size.y - 1) continue;
      if (!sim.isFree(p, 0.5)) continue;
      if (pred(p)) return p;
    }
  }
  return null;
}

/** Simple steering command toward a point (for scripted human slots). */
export function toward(sim: Simulation, slot: number, p: Vec2, grab = false): Command {
  const ch = sim.characterBySlot(slot);
  const dx = p.x - ch.pos.x;
  const dy = p.y - ch.pos.y;
  const d = Math.hypot(dx, dy);
  const m = d < 0.15 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
  return { move: m, grab, dash: false, aim: null, ping: null };
}
