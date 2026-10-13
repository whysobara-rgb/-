/**
 * Late-match decisions and robustness (review fixes): a safe that can still score is carried to
 * the end (doc §11 마지막 30초), a loose safe plugging a bank door blocks the nav, and a bot
 * wedged in a gap narrower than its body breaks out.
 */
import { describe, expect, it } from 'vitest';
import { createMatch } from '../../src/ai/harness';
import { NavGrid } from '../../src/ai/nav';
import { bankDoors } from '../../src/ai/geom';
import { TICK_RATE } from '../../src/sim/config';
import type { Command, EntityId, LayoutId } from '../../src/sim/types';
import { EMPTY_COMMAND } from '../../src/sim/types';
import { makeMatch, stepMatch } from './helpers';

describe('endgame: never drop what can still score', () => {
  for (const layout of ['plaza', 'counter'] as LayoutId[]) {
    it(`${layout}: with the clock cut mid-carry to just enough time, the carrier still delivers`, () => {
      const spec = {
        layout,
        team0: [{ personality: 'hodadak' as const, difficulty: 'challenge' as const }],
        team1: [{ personality: 'tongkeun' as const, difficulty: 'challenge' as const }],
        seed: 2,
      };
      // reference run: the first outdoor safe slot 0 picks up, and when it is recovered
      const A = createMatch(spec);
      const cmds: Command[] = [];
      let grabTick = -1;
      let lootId: EntityId = -1;
      let recTick = -1;
      while (!A.sim.state.over && A.sim.state.tick < 120 * TICK_RATE && recTick < 0) {
        for (let i = 0; i < 2; i++) cmds[i] = A.bots[i]!.update(A.sim);
        for (const e of A.sim.step(cmds)) {
          if (e.type === 'grab' && e.charId === 1 && grabTick < 0 && e.part === 'safe' && A.sim.getLoot(e.targetId)!.floorOf === null) {
            grabTick = e.tick;
            lootId = e.targetId;
          }
          if (e.type === 'release' && e.charId === 1 && e.targetId === lootId && recTick < 0 && !A.sim.getLoot(lootId)!.recovery) {
            grabTick = -1;
            lootId = -1;
          }
          if (e.type === 'recovered' && e.lootId === lootId && grabTick >= 0) recTick = e.tick;
        }
      }
      expect(recTick, 'reference carry found').toBeGreaterThan(0);
      // replay with the end of the match moved to 0.5 s after that recovery, set mid-carry
      const B = createMatch(spec);
      const cut = grabTick + Math.floor((recTick - grabTick) * 0.4);
      let delivered = false;
      while (!B.sim.state.over) {
        if (B.sim.state.tick === cut) (B.sim.state as { endTick: number }).endTick = recTick + 30;
        for (let i = 0; i < 2; i++) cmds[i] = B.bots[i]!.update(B.sim);
        for (const e of B.sim.step(cmds)) if (e.type === 'recovered' && e.lootId === lootId) delivered = true;
      }
      expect(delivered).toBe(true);
    });
  }
});

describe('door plugs and pins', () => {
  it('a loose safe resting in a bank doorway blocks the nav there (routes use the other door)', () => {
    const { sim, bots } = makeMatch('plaza', [{ team: 0 }, { team: 1 }], 1);
    const nav = NavGrid.for(sim);
    const bank = sim.state.loot.find((l) => l.kind === 'bank')!;
    const door = bankDoors(bank)[0]!;
    const inDoor = { x: door.center.x, y: door.center.y };
    stepMatch(sim, bots, 2);
    nav.update(sim, true);
    expect(nav.isFreeAt(inDoor, 'walk')).toBe(true);
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.floorOf === null)!;
    sim.debug.setAnchored(safe.id, false);
    sim.debug.teleport(safe.id, inDoor, bank.angle);
    stepMatch(sim, bots, 30);
    nav.update(sim, true);
    expect(nav.isFreeAt(inDoor, 'walk')).toBe(false);
    // the other door stays open
    expect(nav.isFreeAt(bankDoors(bank)[1]!.center, 'walk')).toBe(true);
  });

  it('counter: a bot wedged between a wall and an anchored safe (a gap narrower than its body) breaks out', () => {
    // (sim: a character pinned in this 0.85 m gap does not move in any walking direction)
    const { sim, bots } = makeMatch('counter', [{ team: 0 }, { team: 1, bot: { personality: 'nunchi', difficulty: 'normal' } }], 3);
    sim.debug.teleport(2, { x: 62.32, y: 11.45 });
    stepMatch(sim, bots, 2);
    const p0 = { ...sim.characterBySlot(1).pos };
    stepMatch(sim, bots, 5 * TICK_RATE, () => EMPTY_COMMAND);
    const p1 = sim.characterBySlot(1).pos;
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeGreaterThan(1.5);
  });
});
