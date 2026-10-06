/**
 * Police-aware bots (owner addition beyond doc v0.5; police are public — everyone sees them):
 * carriers evade officers, teammates body-block and dash-stun an officer about to tackle an ally
 * (officers never tackle empty-handed raccoons), bank hauls are timed around the waves, and the
 * awareness ladder (challenge > normal > novice) only changes how well the bot reads the police.
 */
import { describe, expect, it } from 'vitest';
import { POLICE, TICK_RATE } from '../../src/sim/config';
import { LAYOUTS } from '../../src/sim/layouts/index';
import { Simulation } from '../../src/sim/sim';
import type { EntityId, LayoutId, RosterEntry, SimEvent } from '../../src/sim/types';
import { EMPTY_COMMAND } from '../../src/sim/types';
import { Bot } from '../../src/ai/bot';
import { DIFFICULTY_PARAMS } from '../../src/ai/params';
import { PoliceSense } from '../../src/ai/policeSense';
import type { Difficulty, RivalId } from '../../src/ai/types';
import { createMatch } from '../../src/ai/harness';
import { findSpot } from './helpers';

interface Slot {
  team: 0 | 1;
  bot?: { p: RivalId; d: Difficulty; awareness?: number };
}

function setup(layout: LayoutId, slots: Slot[], seed: number): { sim: Simulation; bots: (Bot | null)[] } {
  const roster: RosterEntry[] = slots.map((s, i) => ({ team: s.team, isBot: !!s.bot, name: `s${i}`, look: { hat: 'none' } }));
  const sim = new Simulation({ layout: LAYOUTS[layout], roster, seed, rules: { police: true } });
  const bots = slots.map((s, slot) =>
    s.bot ? new Bot(sim, { slot, personality: s.bot.p, difficulty: s.bot.d, seed: seed * 17 + slot, tuning: s.bot.awareness !== undefined ? { policeAwareness: s.bot.awareness } : undefined }) : null,
  );
  return { sim, bots };
}

/** Uproot both banks at tick 0 so a wave arrives ~14.6 s in (alarm -> 12 s -> car 2 s -> step out). */
function ringBothAlarms(sim: Simulation): void {
  for (const b of sim.state.loot.filter((l) => l.kind === 'bank')) sim.debug.setAnchored(b.id, false);
}

function step(sim: Simulation, bots: (Bot | null)[], ticks: number, onTick?: (ev: SimEvent[]) => void): void {
  for (let t = 0; t < ticks && !sim.state.over; t++) {
    const ev = sim.step(bots.map((b) => (b ? b.update(sim) : EMPTY_COMMAND)));
    onTick?.(ev);
  }
}

describe('police-aware bots', () => {
  it('difficulty ladder: awareness challenge > normal > novice (same physics)', () => {
    expect(DIFFICULTY_PARAMS.challenge.policeAwareness).toBeGreaterThan(DIFFICULTY_PARAMS.normal.policeAwareness);
    expect(DIFFICULTY_PARAMS.normal.policeAwareness).toBeGreaterThan(DIFFICULTY_PARAMS.novice.policeAwareness);
  });

  it('a carrier evades officers: far fewer tackles than the same bot blind to police', () => {
    const tackles = (aw: number): number => {
      let n = 0;
      for (const seed of [1, 2, 3, 4]) {
        const { sim, bots } = setup('plaza', [{ team: 0, bot: { p: 'hodadak', d: 'challenge', awareness: aw } }, { team: 1 }], seed);
        ringBothAlarms(sim);
        step(sim, bots, 60 * TICK_RATE, (ev) => {
          for (const e of ev) if (e.type === 'policeTackle' && e.hit && e.victimId === 1) n++;
        });
      }
      return n;
    };
    const aware = tackles(1);
    const blind = tackles(0);
    expect(blind).toBeGreaterThan(8);
    expect(aware).toBeLessThan(blind * 0.5);
  });

  it('a teammate body-blocks the officer chasing a carrying ally and dash-stuns it before the tackle', () => {
    let blockTicks = 0;
    let between = 0;
    let mateStuns = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { sim, bots } = setup(
        'plaza',
        [
          { team: 0, bot: { p: 'tongkeun', d: 'challenge' } },
          { team: 0, bot: { p: 'nunchi', d: 'challenge' } },
          { team: 1, bot: { p: 'hodadak', d: 'challenge' } },
          { team: 1, bot: { p: 'tongkeun', d: 'challenge' } },
        ],
        seed,
      );
      const target = new Map<EntityId, EntityId | null>();
      step(sim, bots, 120 * TICK_RATE, (ev) => {
        for (const e of ev) {
          if (e.type !== 'policeStunned') continue;
          const tg = target.get(e.officerId);
          if (tg && tg !== e.byCharId && sim.getCharacter(tg)!.team === sim.getCharacter(e.byCharId)!.team) mateStuns++;
        }
        for (const b of bots) {
          const d = b!.debug() as { goal: { key: string; phase: string } | null };
          if (!d.goal || !d.goal.key.startsWith('copguard:') || d.goal.phase !== 'block') continue;
          blockTicks++;
          const mate = sim.getCharacter(Number(d.goal.key.split(':')[1]))!;
          const cop = sim.state.police.find((o) => o.targetCharId === mate.id);
          if (!cop) continue;
          // covering the ally: right next to it, on the officer's side
          const me = sim.characterBySlot(b!.slot).pos;
          const dMeMate = Math.hypot(me.x - mate.pos.x, me.y - mate.pos.y);
          const dMeCop = Math.hypot(me.x - cop.pos.x, me.y - cop.pos.y);
          const dMateCop = Math.hypot(mate.pos.x - cop.pos.x, mate.pos.y - cop.pos.y);
          if (dMeMate < 2.2 && dMeCop < dMateCop + 0.5) between++;
        }
        for (const o of sim.state.police) target.set(o.id, o.targetCharId);
      });
    }
    expect(blockTicks).toBeGreaterThan(60);
    expect(between / Math.max(1, blockTicks)).toBeGreaterThan(0.25);
    expect(mateStuns).toBeGreaterThanOrEqual(1);
  });

  it('dash-stuns an officer about to tackle an ally (scripted chase)', () => {
    // a human carrier (slot 0) drags a small safe; the bot teammate (slot 1) stands by. As soon
    // as an officer runs at the carrier within dash reach of the bot, the bot knocks it over.
    let stunsByBot = 0;
    let tacklesOnHuman = 0;
    for (const seed of [11, 12, 13]) {
      const { sim, bots } = setup('plaza', [{ team: 0 }, { team: 0, bot: { p: 'nunchi', d: 'challenge' } }], seed);
      ringBothAlarms(sim);
      const safe = sim.state.loot.filter((l) => l.kind === 'smallSafe' && l.floorOf === null).sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)[0]!;
      sim.debug.setAnchored(safe.id, false);
      // wait for the officers to step out and walk into the square
      step(sim, [null, null], POLICE.dispatchDelayTicks + POLICE.arriveTicks + 5 * TICK_RATE);
      expect(sim.state.police.length).toBeGreaterThan(0);
      // the human grabs the safe in the open a few meters from the first officer and walks slowly away
      const cop = sim.state.police[0]!;
      const spot = findSpot(sim, cop.pos, 5, 8, (p) => sim.isFree(p, 1.8) && sim.lineOfSight(cop.pos, p));
      expect(spot).not.toBeNull();
      sim.debug.teleport(safe.id, spot!);
      const s = sim.getLoot(safe.id)!;
      sim.debug.teleport(1, { x: s.pos.x + 0.4 + 0.56, y: s.pos.y });
      sim.debug.teleport(2, { x: s.pos.x + 1.0, y: s.pos.y - 1.6 });
      for (let t = 0; t < 8 * TICK_RATE && !sim.state.over; t++) {
        const h = sim.characterBySlot(0);
        const cmd = h.grab ? { ...EMPTY_COMMAND, grab: true, move: { x: 0.35, y: 0.0 } } : { ...EMPTY_COMMAND, grab: t % 2 === 0, aim: { x: -1, y: 0 } };
        const ev = sim.step([cmd, bots[1]!.update(sim)]);
        for (const e of ev) {
          if (e.type === 'policeStunned' && e.byCharId === 2) stunsByBot++;
          if (e.type === 'policeTackle' && e.hit && e.victimId === 1) tacklesOnHuman++;
        }
      }
    }
    expect(stunsByBot).toBeGreaterThanOrEqual(2);
    expect(stunsByBot).toBeGreaterThan(tacklesOnHuman);
  });

  it('defers a bank haul while a wave is on the field and hauls once the officers leave', () => {
    const { sim, bots } = setup('counter', [{ team: 0, bot: { p: 'tongkeun', d: 'challenge' } }, { team: 1 }], 5);
    const bot = bots[0]!;
    const banks = sim.state.loot.filter((l) => l.kind === 'bank');
    // the far bank is uprooted (by "someone else") -> its alarm calls a wave
    sim.debug.setAnchored(banks[1]!.id, false);
    const ps = (): PoliceSense => PoliceSense.for(sim);
    const hauls = (): number => {
      ps();
      const c = (bot as unknown as { candidates(s: Simulation): { key: string; utility: number }[] }).candidates(sim);
      return c.find((x) => x.key === `haul:${banks[0]!.id}`)?.utility ?? 0;
    };
    const quiet = hauls();
    // officers on the field: hauling the anchored bank now is worth clearly less
    step(sim, [null, null], POLICE.dispatchDelayTicks + POLICE.arriveTicks + 60);
    expect(ps().onField()).toBe(true);
    const during = hauls();
    expect(during).toBeLessThan(quiet * 0.75);
    // the bot itself does not start a bank while the wave is fresh (it carries safes meanwhile)
    // and starts one as the shift runs out
    for (const [layout, seed] of [
      ['counter', 1],
      ['counter', 2],
      ['plaza', 3],
      ['plaza', 4],
    ] as const) {
      const w = setup(layout, [{ team: 0, bot: { p: 'tongkeun', d: 'challenge' } }, { team: 1 }], seed);
      w.sim.debug.setAnchored(w.sim.state.loot.filter((l) => l.kind === 'bank')[1]!.id, false);
      step(w.sim, [null, null], POLICE.dispatchDelayTicks + POLICE.arriveTicks + 60);
      const start = w.sim.state.tick;
      let firstGrab = -1;
      let bankGrab = -1;
      step(w.sim, w.bots, 50 * TICK_RATE, (ev) => {
        for (const e of ev) {
          if (e.type !== 'grab' || e.charId !== 1) continue;
          if (firstGrab < 0) firstGrab = e.tick;
          if (e.part === 'bankWall' && bankGrab < 0) bankGrab = e.tick;
        }
      });
      expect(firstGrab, `${layout} ${seed}: productive meanwhile`).toBeGreaterThan(0);
      expect(firstGrab).toBeLessThan(start + 10 * TICK_RATE);
      expect(bankGrab, `${layout} ${seed}: hauls before long`).toBeGreaterThan(0);
      expect(bankGrab - start, `${layout} ${seed}: not while the wave is fresh`).toBeGreaterThan(15 * TICK_RATE);
    }
  });

  it('never freezes in fear: with police on the field every bot keeps making progress (strict stuck metric)', () => {
    let stuck = 0;
    let scored = 0;
    for (const layout of ['plaza', 'shortcut', 'counter'] as const) {
      const { sim, bots } = createMatch({
        layout,
        team0: [{ personality: 'tongkeun', difficulty: 'novice' }],
        team1: [{ personality: 'hodadak', difficulty: 'challenge' }],
        seed: 9,
        rules: { police: true },
      });
      ringBothAlarms(sim);
      const last = bots.map((b) => ({ ...sim.characterBySlot(b.slot).pos, t: 0 }));
      for (let t = 0; t < 90 * TICK_RATE && !sim.state.over; t++) {
        sim.step(bots.map((b) => b.update(sim)));
        bots.forEach((b, i) => {
          const ch = sim.characterBySlot(b.slot);
          const held = ch.grab ? sim.getLoot(ch.grab.targetId) : null;
          const moved = Math.hypot(ch.pos.x - last[i]!.x, ch.pos.y - last[i]!.y) > 1.25 || ch.straining || ch.knockdownTicks > 0 || (held && held.recovery);
          if (moved) last[i] = { ...ch.pos, t };
          else if (t - last[i]!.t > 8 * TICK_RATE) {
            stuck++;
            last[i]!.t = t;
          }
        });
      }
      scored += sim.state.scores[0] > 0 ? 1 : 0;
      scored += sim.state.scores[1] > 0 ? 1 : 0;
    }
    expect(stuck).toBe(0);
    expect(scored).toBe(6);
  });

  it('police-aware matches stay deterministic', () => {
    const fp = (): string => {
      const { sim, bots } = createMatch({
        layout: 'shortcut',
        team0: [
          { personality: 'tongkeun', difficulty: 'normal' },
          { personality: 'nunchi', difficulty: 'challenge' },
        ],
        team1: [
          { personality: 'hodadak', difficulty: 'normal', humanProxy: true },
          { personality: 'nunchi', difficulty: 'novice' },
        ],
        seed: 77,
        rules: { police: true },
      });
      ringBothAlarms(sim);
      let h = 0;
      for (let t = 0; t < 70 * TICK_RATE && !sim.state.over; t++) {
        const cmds = bots.map((b) => b.update(sim));
        for (const c of cmds) h = (Math.imul(h, 31) + Math.round(c.move.x * 1e6) * 7 + Math.round(c.move.y * 1e6) * 13 + (c.grab ? 1 : 0) + (c.dash ? 2 : 0)) | 0;
        sim.step(cmds);
      }
      return JSON.stringify({ h, police: sim.state.police.map((o) => [o.id, o.pos.x.toFixed(5), o.pos.y.toFixed(5)]), ev: sim.eventLog.length, scores: sim.state.scores });
    };
    const a = fp();
    expect(fp()).toBe(a);
    expect(a).toContain('police');
  });
});
