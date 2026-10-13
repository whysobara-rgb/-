/**
 * Integration regression (found while wiring human input): a player who walks into a safe while
 * holding the grab button, or pulls an anchored safe sideways, must keep the grip. Only a real
 * yank breaks it (the sim's own yank test covers that side).
 */
import { describe, expect, it } from 'vitest';
import { Simulation, type SimEvent } from '../../src/sim';
import { buildMatch } from '../../src/game/setup';

function practice(): Simulation {
  const b = buildMatch({ kind: 'tutorial', layoutId: 'tutorial', mode: '1v1', rival: 'hodadak', difficulty: 'novice', adaptation: null, seed: 1, humanHat: 'teamCapA' });
  return new Simulation(b.setup);
}

const forcedReleases = (log: readonly SimEvent[]): number => log.filter((e) => e.type === 'release' && e.forced).length;

describe('grip from human-style input', () => {
  it('running into an anchored safe with grab held grabs it and keeps it', () => {
    const sim = practice();
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!;
    for (let i = 0; i < 200; i++) {
      const me = sim.state.characters[0]!;
      const dx = safe.pos.x - me.pos.x;
      const dy = safe.pos.y - me.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      // full stick toward the safe until holding, then pull straight away
      const move = me.grab ? { x: -dx / d, y: -dy / d } : { x: dx / d, y: dy / d };
      sim.step([{ move, grab: true, dash: false, aim: { x: dx, y: dy }, ping: null }]);
    }
    expect(forcedReleases(sim.eventLog)).toBe(0);
    expect(sim.eventLog.some((e) => e.type === 'unanchored' && e.lootId === safe.id)).toBe(true);
    expect(sim.state.characters[0]!.grab?.targetId).toBe(safe.id);
  });

  it.each([0, 45, 90, 135])('pulling an anchored safe at %i° off the grip line never breaks the grip', (deg) => {
    const sim = practice();
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!;
    sim.debug.teleport(1, { x: safe.pos.x - 1.15, y: safe.pos.y }, 0);
    const a = Math.PI - (deg * Math.PI) / 180;
    for (let i = 0; i < 150; i++) {
      const move = i < 5 ? { x: 0, y: 0 } : { x: Math.cos(a), y: Math.sin(a) };
      sim.step([{ move, grab: true, dash: false, aim: { x: 1, y: 0 }, ping: null }]);
    }
    expect(forcedReleases(sim.eventLog)).toBe(0);
    expect(sim.eventLog.some((e) => e.type === 'unanchored' && e.lootId === safe.id)).toBe(true);
  });
});
