/**
 * Perception never leaks hidden opponents (doc §11 "시야에서 관찰한 상대와 마지막 관찰 위치만
 * 사용한다", §19 "봇이 시야 밖 상대를 추적한 경우 ... 무엇을 썼는지 확인한다").
 */
import { describe, expect, it } from 'vitest';
import { TeamBoard } from '../../src/ai/board';
import { perceptionAccess } from '../../src/ai/perception';
import { VISION } from '../../src/sim/config';
import type { CharacterState, Command } from '../../src/sim/types';
import { EMPTY_COMMAND } from '../../src/sim/types';
import { findSpot, makeMatch } from './helpers';

describe('perception', () => {
  it('an opponent behind a building is unknown; once seen, only the last sighting is kept', () => {
    const { sim } = makeMatch('plaza', [{ team: 0, bot: { personality: 'nunchi' } }, { team: 1 }]);
    const board = TeamBoard.for(sim, 0);
    const me = { ...sim.characterBySlot(0).pos };
    const hidden = findSpot(sim, me, 6, VISION.radius - 3, (p) => !sim.lineOfSight(me, p));
    const visible = findSpot(sim, me, 6, VISION.radius - 4, (p) => sim.lineOfSight(me, p));
    expect(hidden).not.toBeNull();
    expect(visible).not.toBeNull();
    const idle = (n: number): void => {
      for (let i = 0; i < n; i++) {
        sim.step([EMPTY_COMMAND, EMPTY_COMMAND]);
        board.tick(sim);
      }
    };
    // 1) within vision radius but behind a building: nothing known
    sim.debug.teleport(2, hidden!);
    idle(5);
    let o = board.perception.opponents(sim.state.tick, 0)[0]!;
    expect(o.visible).toBe(false);
    expect(o.last).toBeNull();
    expect(o.age).toBe(Infinity);
    // 2) in plain sight: seen
    sim.debug.teleport(2, visible!);
    idle(2);
    o = board.perception.opponents(sim.state.tick, 0)[0]!;
    expect(o.visible).toBe(true);
    expect(Math.hypot(o.last!.pos.x - visible!.x, o.last!.pos.y - visible!.y)).toBeLessThan(0.3);
    // 3) hidden again: the last sighting stays where it was seen and ages; no new position
    sim.debug.teleport(2, hidden!);
    idle(30);
    o = board.perception.opponents(sim.state.tick, 0)[0]!;
    expect(o.visible).toBe(false);
    expect(Math.hypot(o.last!.pos.x - visible!.x, o.last!.pos.y - visible!.y)).toBeLessThan(0.3);
    expect(o.age).toBeGreaterThanOrEqual(29);
    // 4) reaction delay: a view 20 ticks back does not yet know about anything newer
    sim.debug.teleport(2, visible!);
    idle(3);
    expect(board.perception.opponents(sim.state.tick, 0)[0]!.visible).toBe(true);
    expect(board.perception.opponents(sim.state.tick, 20)[0]!.visible).toBe(false);
  });

  it('beyond the vision radius an opponent is not seen even with a clear line', () => {
    const { sim } = makeMatch('plaza', [{ team: 0, bot: { personality: 'hodadak' } }, { team: 1 }]);
    const board = TeamBoard.for(sim, 0);
    const me = { ...sim.characterBySlot(0).pos };
    const far = findSpot(sim, me, VISION.radius + 2, VISION.radius + 12, (p) => sim.lineOfSight(me, p));
    expect(far).not.toBeNull();
    sim.debug.teleport(2, far!);
    sim.step([EMPTY_COMMAND, EMPTY_COMMAND]);
    board.tick(sim);
    expect(board.perception.opponents(sim.state.tick, 0)[0]!.last).toBeNull();
  });

  it('bots never read opponent character state outside Perception during a full match', () => {
    const { sim, bots } = makeMatch(
      'plaza',
      [
        { team: 0, bot: { personality: 'nunchi', difficulty: 'challenge' } },
        { team: 0, bot: { personality: 'tongkeun', difficulty: 'challenge' } },
        { team: 1, bot: { personality: 'hodadak', difficulty: 'challenge' } },
        { team: 1, bot: { personality: 'nunchi', difficulty: 'challenge' } },
      ],
      11,
    );
    // dynamic (private) fields of a character; roster fields (id, slot, team, isBot, name, look) are public
    const PRIVATE = new Set(['pos', 'vel', 'facing', 'moveIntent', 'grab', 'straining', 'dashTicks', 'dashCooldown', 'boostTicks', 'knockdownTicks', 'protectTicks', 'floorOf']);
    let updatingTeam: number | null = null;
    const leaks: string[] = [];
    const chars = sim.state.characters as CharacterState[];
    for (let i = 0; i < chars.length; i++) {
      const target = chars[i]!;
      chars[i] = new Proxy(target, {
        get(t, prop, recv) {
          if (updatingTeam !== null && t.team !== updatingTeam && perceptionAccess.depth === 0 && typeof prop === 'string' && PRIVATE.has(prop)) {
            if (leaks.length < 10) leaks.push(`team ${updatingTeam} bot read ${String(prop)} of opponent ${t.id}`);
          }
          return Reflect.get(t, prop, recv);
        },
      });
    }
    const cmds: Command[] = [];
    for (let t = 0; t < 4200 && !sim.state.over; t++) {
      for (let s = 0; s < bots.length; s++) {
        updatingTeam = sim.characterBySlot(s).team;
        cmds[s] = bots[s]!.update(sim);
        updatingTeam = null;
      }
      sim.step(cmds);
    }
    expect(leaks).toEqual([]);
    // and the bots did play (not a vacuous pass)
    expect(sim.state.scores[0] + sim.state.scores[1]).toBeGreaterThan(0);
  });
});
