/**
 * The client's taunt cooldown (match.ts tauntCooling / trackEmote via tauntCoolingAt /
 * tauntEndedTick) says "catching my breath" on exactly the ticks the sim refuses a taunt: never
 * a tick longer (a press the sim would take must not be dropped), never shorter. Checked against
 * the real sim every tick, after natural ends and after cancels.
 */
import { describe, expect, it } from 'vitest';
import { EMOTE } from '../../src/sim/config';
import type { Command, EmoteId, EmoteState, SimEvent } from '../../src/sim/types';
import { tauntCoolingAt, tauntEndedTick } from '../../src/platform/emotes';
import { cmd, makeSim, openLayout } from '../sim/fixtures/layouts';

const taunt = (id: EmoteId, mx = 0): Command => ({ ...cmd(mx, 0), emote: id });
const started = (ev: SimEvent[]) => ev.some((e) => e.type === 'emote' && e.charId === 1);

function duo() {
  const sim = makeSim(openLayout(), [0, 1]);
  sim.debug.teleport(1, { x: 30, y: 30 }, 0);
  sim.debug.teleport(2, { x: 36, y: 30 }, Math.PI);
  sim.step([cmd(), cmd()]);
  return sim;
}

describe('client taunt cooldown mirrors the sim tick for tick', () => {
  it('natural ends: the client allows a press exactly when the sim starts it', () => {
    const sim = duo();
    let ended = -Infinity;
    let prev: EmoteState | null = null;
    let starts = 0;
    const horizon = 3 * (EMOTE.durationTicks.bleh + EMOTE.cooldownTicks) + 10;
    for (let i = 0; i < horizon; i++) {
      const me = sim.state.characters[0]!;
      const cooling = tauntCoolingAt(sim.state.tick, me.emote, ended);
      // press every tick: the sim decides; the client must agree
      const ev = sim.step([taunt('bleh'), cmd()]);
      expect({ tick: sim.state.tick, started: started(ev) }).toEqual({ tick: sim.state.tick, started: !cooling });
      if (started(ev)) starts++;
      const now = sim.state.characters[0]!.emote ?? null;
      ended = tauntEndedTick(prev, now, sim.state.tick, ended);
      prev = now && sim.state.tick < now.endTick ? { ...now } : null;
    }
    expect(starts).toBeGreaterThanOrEqual(3);
  });

  it('cancels (moving off): the cooldown counts from the cancel tick on both sides', () => {
    const sim = duo();
    let ended = -Infinity;
    let prev: EmoteState | null = null;
    let starts = 0;
    let cancels = 0;
    for (let i = 0; i < 4 * (EMOTE.cooldownTicks + 20); i++) {
      const me = sim.state.characters[0]!;
      const cooling = tauntCoolingAt(sim.state.tick, me.emote, ended);
      // a few ticks into each taunt the player walks off (cancel 'move'); otherwise keep pressing
      const live = me.emote;
      const walk = !!live && sim.state.tick - live.startTick >= 5;
      const ev = sim.step([walk ? cmd(1, 0) : taunt('wiggle'), cmd()]);
      if (!walk) expect(started(ev)).toBe(!cooling);
      if (started(ev)) starts++;
      if (ev.some((e) => e.type === 'emoteCancel' && e.charId === 1)) cancels++;
      const now = sim.state.characters[0]!.emote ?? null;
      ended = tauntEndedTick(prev, now, sim.state.tick, ended);
      prev = now && sim.state.tick < now.endTick ? { ...now } : null;
    }
    expect(starts).toBeGreaterThanOrEqual(3);
    expect(cancels).toBeGreaterThanOrEqual(3);
  });
});
