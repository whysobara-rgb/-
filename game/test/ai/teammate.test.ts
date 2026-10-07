/**
 * Teammate bots (doc §11 동료 봇, §4 핑): answer pings, join a human's bank haul without orders,
 * pull in the human's direction.
 */
import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../../src/sim/config';
import type { Command, SimEvent } from '../../src/sim/types';
import { EMPTY_COMMAND } from '../../src/sim/types';
import { makeMatch, stepMatch } from './helpers';

describe('teammate bot', () => {
  it('answers a "같이 잡자" (grabTogether) ping by going to grab that target', () => {
    const { sim, bots } = makeMatch('plaza', [{ team: 0 }, { team: 0, bot: { personality: 'hodadak', difficulty: 'normal' } }], 21);
    // a target the bot would not pick by itself first: the large safe on the far (south) dock
    const target = sim.state.loot.filter((l) => l.kind === 'largeSafe' && l.floorOf === null).sort((a, b) => b.pos.y - a.pos.y)[0]!;
    let pinged = false;
    const human = (slot: number): Command => {
      if (slot !== 0) return EMPTY_COMMAND;
      if (!pinged && sim.state.tick >= 3) {
        pinged = true;
        return { ...EMPTY_COMMAND, ping: { pos: { ...target.pos }, targetId: target.id } };
      }
      return EMPTY_COMMAND;
    };
    const events = stepMatch(sim, bots, 30 * TICK_RATE, human, (_s, ev) => ev.some((e) => e.type === 'grab' && e.charId === 2));
    expect(events.some((e) => e.type === 'ping' && e.kind === 'grabTogether' && e.targetId === target.id)).toBe(true);
    const grab = events.find((e): e is Extract<SimEvent, { type: 'grab' }> => e.type === 'grab' && e.charId === 2);
    expect(grab, 'the teammate grabbed something within 30 s').toBeDefined();
    expect(grab!.targetId).toBe(target.id);
    expect(bots[1]!.stats.pingsAnswered).toBeGreaterThanOrEqual(1);
  });

  it('answers a "이쪽으로" (goHere) ping by moving there', () => {
    const { sim, bots } = makeMatch('counter', [{ team: 0 }, { team: 0, bot: { personality: 'tongkeun', difficulty: 'novice' } }], 22);
    const spot = { x: 30, y: 33 };
    let pinged = false;
    const human = (slot: number): Command => {
      if (slot !== 0 || pinged || sim.state.tick < 3) return EMPTY_COMMAND;
      pinged = true;
      return { ...EMPTY_COMMAND, ping: { pos: spot, targetId: null } };
    };
    let reached = false;
    stepMatch(sim, bots, 20 * TICK_RATE, human, (s) => {
      const p = s.characterBySlot(1).pos;
      reached = Math.hypot(p.x - spot.x, p.y - spot.y) < 1.6;
      return reached;
    });
    expect(reached).toBe(true);
  });

  it('joins a human hauling a bank (no orders) and pulls the same way', () => {
    const { sim, bots } = makeMatch('plaza', [{ team: 0 }, { team: 0, bot: { personality: 'nunchi', difficulty: 'normal' } }], 23);
    const bank = sim.state.loot.find((l) => l.kind === 'bank')!; // north bank, angle PI/2
    // human stands at the bank's local +x side wall (world south face) and grabs it
    const c = Math.cos(bank.angle);
    const s = Math.sin(bank.angle);
    const n = { x: c, y: s };
    const anchor = { x: bank.pos.x + 4 * n.x, y: bank.pos.y + 4 * n.y };
    sim.debug.teleport(1, { x: anchor.x + n.x * 0.56, y: anchor.y + n.y * 0.56 });
    const human = (slot: number): Command => {
      if (slot !== 0) return EMPTY_COMMAND;
      const t = sim.state.tick;
      if (t < 3) return { ...EMPTY_COMMAND, aim: { x: -n.x, y: -n.y } };
      if (!sim.characterBySlot(0).grab) return { ...EMPTY_COMMAND, grab: t % 2 === 0, aim: { x: -n.x, y: -n.y } };
      // strain straight away from the wall until it comes loose, then pull west (the route)
      if (sim.getLoot(bank.id)!.anchored) return { move: { x: n.x, y: n.y }, grab: true, dash: false, aim: null, ping: null };
      return { move: { x: -1, y: 0 }, grab: true, dash: false, aim: null, ping: null };
    };
    let botOnBank = false;
    let sameDirTicks = 0;
    let bothTicks = 0;
    stepMatch(sim, bots, 40 * TICK_RATE, human, (st) => {
      const b = st.getLoot(bank.id)!;
      const bot = st.characterBySlot(1);
      if (b.grabbedBy.includes(2) && b.grabbedBy.includes(1)) {
        botOnBank = true;
        bothTicks++;
        const mi = bot.moveIntent;
        if (Math.hypot(mi.x, mi.y) > 0.3 && mi.x < -0.7) sameDirTicks++;
      }
      return bothTicks > 120;
    });
    expect(sim.getLoot(bank.id)!.grabbedBy).toContain(1);
    expect(botOnBank).toBe(true);
    // while both hold it, the bot pulls where the human pulls (never fights the human)
    expect(sameDirTicks / Math.max(1, bothTicks)).toBeGreaterThan(0.8);
  });
});
