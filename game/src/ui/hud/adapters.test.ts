/**
 * Checks the optional SimState -> HUD adapters against the real Simulation (structural
 * compatibility of SimView + sane output). Node environment, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, type Command, type MatchSetup } from '../../sim';
import { LAYOUTS } from '../../sim/layouts';
import { hudModelFromSim, type SimView } from './adapters';

function setup(): MatchSetup {
  return {
    layout: LAYOUTS.plaza,
    seed: 7,
    roster: [
      { team: 0, isBot: false, name: '나', look: { hat: 'teamCapA' } },
      { team: 1, isBot: true, name: '호다닥', look: { hat: 'hodadakBand', rival: 'hodadak' } },
    ],
  };
}

describe('hudModelFromSim', () => {
  it('maps a live simulation to a HudModel', () => {
    const sim = new Simulation(setup());
    const view: SimView = sim; // compile-time structural check
    const me = sim.characterBySlot(0);
    const idle: Command = { move: { x: 0, y: 0 }, grab: false, dash: false };
    for (let i = 0; i < 120; i++) sim.step([{ ...idle, move: { x: 1, y: 0 } }, idle]);

    const project = (p: { x: number; y: number }, h: number) => ({ x: p.x * 20, y: p.y * 20 - h * 10, onScreen: true });
    const m = hudModelFromSim(view, { meId: me.id, myTeam: 0, project });

    expect(m.mode).toBe('match');
    expect(m.scores).toEqual([0, 0]);
    expect(m.banks).toHaveLength(2);
    expect(m.banks.every((b) => !b.recovered)).toBe(true);
    expect(m.timeLeftSec).toBeCloseTo(238, 0);
    expect(m.finalCountdown).toBe(false);
    expect(m.lastBankWarning).toBe(false);
    expect(m.dashCooldown).toBe(0);
    expect(m.minimap?.safes).toHaveLength(14);
    expect(m.minimap?.characters.find((c) => c.isMe)?.visible).toBe(true);
    // Opponents are hidden unless a visibility predicate says otherwise (public info only).
    expect(m.minimap?.characters.find((c) => c.team === 1)?.visible).toBe(false);
    // Banks always carry an estimate label; a fresh bank is worth 1,000.
    const bankLabels = (m.labels ?? []).filter((l) => l.kind === 'bank');
    expect(bankLabels).toHaveLength(2);
    expect(bankLabels.every((l) => l.kind === 'bank' && l.value === 1000)).toBe(true);
  });

  it('reports practice mode for untimed rules', () => {
    const sim = new Simulation({ ...setup(), layout: LAYOUTS.tutorial, roster: [setup().roster[0]], rules: { timeLimit: false } });
    const m = hudModelFromSim(sim, { meId: sim.characterBySlot(0).id, myTeam: 0 });
    expect(m.mode).toBe('practice');
    expect(m.timeLeftSec).toBeNull();
    expect(m.labels).toBeUndefined();
  });
});
