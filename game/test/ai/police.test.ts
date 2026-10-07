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

  it('a carrier evades officers: far fewer tackles on its safe carries than the same bot blind to police', () => {
    // scripted errands (collect every outdoor safe in turn) with a wave on the field: only the
    // police awareness differs (same physics, same targets)
    const run = (aw: number): { tackles: number; recovered: number } => {
      let tackles = 0;
      let recovered = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { sim, bots } = setup('plaza', [{ team: 0, bot: { p: 'hodadak', d: 'challenge', awareness: aw } }, { team: 1 }], seed);
        // both alarms ring (a wave is called), then the banks settle back on their foundations
        ringBothAlarms(sim);
        step(sim, [null, null], 1);
        for (const b of sim.state.loot.filter((l) => l.kind === 'bank')) sim.debug.setAnchored(b.id, true);
        const bot = bots[0]!;
        const queue = sim.state.loot.filter((l) => l.kind !== 'bank' && l.floorOf === null).map((l) => l.id);
        for (let t = 0; t < 90 * TICK_RATE && !sim.state.over; t++) {
          if (!(bot.debug() as { goal: unknown }).goal && queue.length) bot.assignTask(sim, { kind: 'collect', targetId: queue.shift()! });
          const ev = sim.step([bot.update(sim), EMPTY_COMMAND]);
          for (const e of ev) {
            if (e.type === 'policeTackle' && e.hit && e.victimId === 1) tackles++;
            if (e.type === 'recovered') recovered += e.value;
          }
        }
      }
      return { tackles, recovered };
    };
    const aware = run(1);
    const blind = run(0);
    expect(blind.tackles).toBeGreaterThan(8);
    expect(aware.tackles).toBeLessThan(blind.tackles * 0.5);
    expect(aware.recovered).toBeGreaterThanOrEqual(blind.recovered * 0.9);
  });

  it('a teammate body-blocks the officer chasing a carrying ally and dash-stuns it before the tackle', () => {
    let blockTicks = 0;
    let between = 0;
    let mateStuns = 0;
    let chasedTicks = 0;
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
          chasedTicks++;
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
    // (measured over the block ticks with an officer actually chasing the ally: since carriers let
    // go / stun before a tackle, many block ticks have no chaser at all — the guard keeps covering
    // for a moment — and those say nothing about where it stands)
    expect(chasedTicks).toBeGreaterThan(60);
    expect(between / Math.max(1, chasedTicks)).toBeGreaterThan(0.35);
    expect(mateStuns).toBeGreaterThanOrEqual(1);
  });

  it('dash-stuns an officer about to tackle an ally (scripted chase): fewer tackles on the ally than with a blind mate', () => {
    // a human carrier (slot 0) drags a small safe slowly through the open; the bot teammate
    // (slot 1) starts next to it. Officers only ever tackle carriers, so the mate's dash is the
    // ally's protection.
    const run = (aw: number): { stuns: number; tackles: number } => {
      let stuns = 0;
      let tackles = 0;
      for (const seed of [11, 12, 13, 14, 15, 16]) {
        const { sim, bots } = setup('plaza', [{ team: 0 }, { team: 0, bot: { p: 'nunchi', d: 'challenge', awareness: aw } }], seed);
        ringBothAlarms(sim);
        const safe = sim.state.loot.filter((l) => l.kind === 'smallSafe' && l.floorOf === null).sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)[0]!;
        sim.debug.setAnchored(safe.id, false);
        // wait for the officers to step out and walk into the square
        step(sim, [null, null], POLICE.dispatchDelayTicks + POLICE.arriveTicks + 5 * TICK_RATE);
        expect(sim.state.police.length).toBeGreaterThan(0);
        const cop = sim.state.police[0]!;
        const spot = findSpot(sim, cop.pos, 5, 8, (p) => sim.isFree(p, 1.8) && sim.lineOfSight(cop.pos, p));
        expect(spot).not.toBeNull();
        sim.debug.teleport(safe.id, spot!);
        const s = sim.getLoot(safe.id)!;
        sim.debug.teleport(1, { x: s.pos.x + 0.4 + 0.56, y: s.pos.y });
        sim.debug.teleport(2, { x: s.pos.x + 1.0, y: s.pos.y - 1.6 });
        for (let t = 0; t < 10 * TICK_RATE && !sim.state.over; t++) {
          const h = sim.characterBySlot(0);
          const cmd = h.grab ? { ...EMPTY_COMMAND, grab: true, move: { x: 0.35, y: 0.0 } } : { ...EMPTY_COMMAND, grab: t % 2 === 0, aim: { x: -1, y: 0 } };
          const ev = sim.step([cmd, bots[1]!.update(sim)]);
          for (const e of ev) {
            if (e.type === 'policeStunned' && e.byCharId === 2) stuns++;
            if (e.type === 'policeTackle' && e.hit && e.victimId === 1) tackles++;
          }
        }
      }
      return { stuns, tackles };
    };
    const aware = run(1);
    const blind = run(0);
    expect(aware.stuns).toBeGreaterThanOrEqual(3);
    expect(blind.stuns).toBeLessThan(aware.stuns);
    expect(aware.tackles).toBeLessThan(blind.tackles);
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
      step(w.sim, w.bots, 75 * TICK_RATE, (ev) => {
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

describe('police-aware bots: review fixes', () => {
  /** Longest run of police tackles on one victim spaced <= 2.6 s apart, and all tackle hits. */
  const chainStats = (hits: { v: EntityId; t: number }[]): { longest: number; inChains: number } => {
    let longest = 0;
    let inChains = 0;
    const byV = new Map<EntityId, number[]>();
    for (const h of hits) (byV.get(h.v) ?? byV.set(h.v, []).get(h.v)!).push(h.t);
    for (const ts of byV.values()) {
      let run = 1;
      const flush = (): void => {
        longest = Math.max(longest, run);
        if (run >= 3) inChains += run;
      };
      for (let i = 1; i < ts.length; i++) {
        if (ts[i]! - ts[i - 1]! <= 2.6 * TICK_RATE) run++;
        else {
          flush();
          run = 1;
        }
      }
      flush();
    }
    return { longest, inChains };
  };

  it('no tackle chains: a hauler lets go / stuns before its hit protection runs out and gives a hounded bank up for a while', () => {
    // worst case: both alarms ring at 0 s, two officers on the field from ~15 s, bank-loving bots
    // (before the fix: an officer waited beside the downed hauler and lunged on the very tick its
    // protection ended — tackles every 2.0 s, chains of 10-20, 0 stuns)
    const hits: { v: EntityId; t: number }[] = [];
    let stuns = 0;
    let giveUps = 0;
    let match = 0;
    for (const layout of ['plaza', 'shortcut', 'counter'] as const) {
      for (const d of ['novice', 'normal', 'challenge'] as const) {
        match++;
        const { sim, bots } = createMatch({ layout, team0: [{ personality: 'tongkeun', difficulty: d }], team1: [{ personality: 'tongkeun', difficulty: d }], seed: 21, rules: { police: true } });
        ringBothAlarms(sim);
        for (let t = 0; t < 75 * TICK_RATE && !sim.state.over; t++) {
          for (const e of sim.step(bots.map((b) => b.update(sim)))) {
            // (victims are told apart per match)
            if (e.type === 'policeTackle' && e.hit) hits.push({ v: e.victimId + 1000 * match, t: e.tick });
            if (e.type === 'policeStunned') stuns++;
          }
        }
        for (const b of bots) giveUps += b.log.filter((l) => l.includes('hounded by the police')).length;
      }
    }
    const c = chainStats(hits);
    expect(hits.length).toBeGreaterThan(10);
    expect(c.longest).toBeLessThanOrEqual(3);
    expect(c.inChains / hits.length).toBeLessThan(0.15);
    expect(stuns).toBeGreaterThan(hits.length * 0.3);
    expect(giveUps).toBeGreaterThan(0);
  });

  it('plans around an officer standing in a one-body alley (it never yields to an empty-handed raccoon)', () => {
    // shortcut: the 1.1 m alley between the arcade blocks at x = 25 (y 13..19.75)
    const { sim, bots } = setup('shortcut', [{ team: 0, bot: { p: 'hodadak', d: 'normal' } }, { team: 1 }], 3);
    const bot = bots[0]!;
    sim.debug.teleport(1, { x: 25, y: 22 });
    bot.update(sim);
    const b = bot as unknown as { ps: PoliceSense; computePath: (s: Simulation, g: { x: number; y: number }, c: string) => void; path: { pts: { x: number; y: number }[] } | null };
    const inAlley = (): boolean => {
      const pts = b.path!.pts;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const q = pts[i]!;
        const n = Math.ceil(Math.hypot(q.x - a.x, q.y - a.y) / 0.2);
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((q.x - a.x) * k) / n;
          const y = a.y + ((q.y - a.y) * k) / n;
          if (x > 24.3 && x < 25.7 && y > 14 && y < 19) return true;
        }
      }
      return false;
    };
    const goal = { x: 25, y: 9 };
    b.computePath(sim, goal, 'walk');
    expect(inAlley()).toBe(true); // the short way, with nobody in it
    const real = b.ps;
    const fake = Object.create(real) as PoliceSense;
    Object.defineProperty(fake, 'cops', { value: [{ id: 1001, pos: { x: 25, y: 16 }, vel: { x: 0, y: 0 }, facing: 0, phase: 'patrol', target: null, busyTicks: 0, shiftLeft: 30 }] });
    b.ps = fake;
    b.computePath(sim, goal, 'walk');
    expect(inAlley()).toBe(false);
    b.ps = real;
  });

  it('plans around a sub-body gap a loose safe leaves beside a lamp (no oscillating at it)', () => {
    // counter: a large safe left beside lamp.c (29.5, 21) leaves ~0.85 m
    const { sim, bots } = setup('counter', [{ team: 0, bot: { p: 'nunchi', d: 'normal' } }, { team: 1 }], 3);
    const bot = bots[0]!;
    const safe = sim.state.loot.filter((l) => l.kind === 'largeSafe' && l.floorOf === null).sort((p, q) => p.pos.y - q.pos.y)[0]!;
    sim.debug.setAnchored(safe.id, false);
    sim.debug.teleport(safe.id, { x: 29.7, y: 22.6 }, 0);
    sim.debug.teleport(1, { x: 31.2, y: 20.4 });
    bot.update(sim);
    const b = bot as unknown as { goal: unknown; computePath: (s: Simulation, g: { x: number; y: number }, c: string) => void; path: { pts: { x: number; y: number }[] } | null };
    b.goal = null; // (its own goal target is never avoided)
    b.computePath(sim, { x: 28.0, y: 23.4 }, 'walk');
    const pts = b.path!.pts;
    // the path never crosses the lamp-to-safe segment (the gap)
    const L = { x: 29.5, y: 21.0 };
    const S = { x: 29.7, y: 22.6 };
    const cross = (a: { x: number; y: number }, q: { x: number; y: number }): boolean => {
      const o = (p: { x: number; y: number }, r: { x: number; y: number }, s: { x: number; y: number }): number => Math.sign((r.x - p.x) * (s.y - p.y) - (r.y - p.y) * (s.x - p.x));
      return o(a, q, L) !== o(a, q, S) && o(L, S, a) !== o(L, S, q);
    };
    for (let i = 1; i < pts.length; i++) expect(cross(pts[i - 1]!, pts[i]!)).toBe(false);
  });

  it('reads the officers\' shift only from public information (arrival + the fixed shift), never the sim counter', () => {
    const { sim, bots } = setup('plaza', [{ team: 0, bot: { p: 'hodadak', d: 'normal' } }, { team: 1 }], 4);
    ringBothAlarms(sim);
    let seenAt = -1;
    for (let t = 0; t < 30 * TICK_RATE; t++) {
      sim.step([bots[0]!.update(sim), EMPTY_COMMAND]);
      if (seenAt < 0 && sim.state.police.length > 0) seenAt = sim.state.tick;
    }
    const ps = PoliceSense.for(sim);
    expect(ps.cops.length).toBeGreaterThan(0);
    // whole seconds counted from the moment the officers appeared (a sim-side shift counter that
    // paused or ran differently would not leak through)
    const sinceSeen = (sim.state.tick - seenAt) / TICK_RATE;
    for (const c of ps.cops) {
      expect(Number.isInteger(c.shiftLeft)).toBe(true);
      expect(Math.abs(c.shiftLeft - (POLICE.shiftTicks / TICK_RATE - sinceSeen))).toBeLessThan(1.05);
    }
  });
});

describe('police-aware bots: fair reads and fighting back (fix pass 2)', () => {
  it('reads whom an officer is after from the screen (its run / its victim), never from the sim target', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/ai/policeSense.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/targetCharId|activeTicks/);
    // ... and the on-screen read agrees with the truth most of the time
    let chase = 0;
    let same = 0;
    let patrolNonNull = 0;
    for (const layout of ['plaza', 'counter'] as const) {
      const { sim, bots } = createMatch({ layout, team0: [{ personality: 'tongkeun', difficulty: 'normal' }], team1: [{ personality: 'hodadak', difficulty: 'normal' }], seed: 3, rules: { police: true } });
      for (let t = 0; t < 150 * TICK_RATE && !sim.state.over; t++) {
        sim.step(bots.map((b) => b.update(sim)));
        const ps = PoliceSense.for(sim);
        for (const c of ps.cops) {
          const o = sim.state.police.find((x) => x.id === c.id)!;
          if (o.phase === 'patrol' && c.target !== null) patrolNonNull++;
          if (o.phase !== 'chase' || o.targetCharId === null) continue;
          chase++;
          if (c.target === o.targetCharId) same++;
        }
      }
    }
    expect(chase).toBeGreaterThan(300);
    expect(same / chase).toBeGreaterThan(0.85);
    expect(patrolNonNull).toBe(0);
  });

  it('a solo hauler with a pack of officers on it gives the bank up and comes back once they have left it', () => {
    const { sim, bots } = setup('counter', [{ team: 0, bot: { p: 'tongkeun', d: 'normal' } }, { team: 1 }], 5);
    const bot = bots[0]!;
    const bank = sim.state.loot.find((l) => l.kind === 'bank')!;
    sim.debug.setAnchored(bank.id, false);
    bot.update(sim);
    const b = bot as unknown as { ps: PoliceSense; addHeat: (s: Simulation, id: EntityId, t: number) => void; policeHolds: (s: Simulation, id: EntityId, t: number) => boolean; candidates: (s: Simulation) => { key: string }[] };
    const real = b.ps;
    const cop = (id: number, x: number, y: number): unknown => ({ id, pos: { x, y }, vel: { x: 0, y: 0 }, facing: 0, phase: 'chase', target: 1, busyTicks: 0, shiftLeft: 30 });
    const withCops = (cops: unknown[]): PoliceSense => {
      const fake = Object.create(real) as PoliceSense;
      Object.defineProperty(fake, 'cops', { value: cops });
      return fake;
    };
    const t0 = sim.state.tick;
    // one officer: a single tackle is no reason to quit
    b.ps = withCops([cop(1001, bank.pos.x + 2, bank.pos.y)]);
    b.addHeat(sim, bank.id, t0);
    expect(b.policeHolds(sim, bank.id, t0)).toBe(false);
    // a second ready officer beside it and knocked off again: left to the police
    b.ps = withCops([cop(1001, bank.pos.x + 2, bank.pos.y), cop(1002, bank.pos.x - 2, bank.pos.y)]);
    b.addHeat(sim, bank.id, t0 + 60);
    expect(b.policeHolds(sim, bank.id, t0 + 60)).toBe(true);
    expect(b.candidates(sim).some((c) => c.key === `haul:${bank.id}`)).toBe(false);
    // still circling it after the minimum hold: keep away
    expect(b.policeHolds(sim, bank.id, t0 + 60 + 5 * TICK_RATE)).toBe(true);
    // they walk off (or one is down for long): back on the menu
    b.ps = withCops([cop(1001, bank.pos.x + 20, bank.pos.y), cop(1002, bank.pos.x - 2, bank.pos.y)]);
    expect(b.policeHolds(sim, bank.id, t0 + 60 + 5 * TICK_RATE)).toBe(false);
    b.ps = real;
  });

  it('never knocks an officer over by accident: every stun is a deliberate one (no travel / escape dashes into officers)', () => {
    let stuns = 0;
    let accidental = 0;
    for (const layout of ['plaza', 'shortcut', 'counter'] as const) {
      for (const seed of [1, 2]) {
        const { sim, bots } = createMatch({ layout, team0: [{ personality: 'hodadak', difficulty: 'challenge' }], team1: [{ personality: 'nunchi', difficulty: 'normal' }], seed, rules: { police: true } });
        ringBothAlarms(sim);
        for (let t = 0; t < 120 * TICK_RATE && !sim.state.over; t++) {
          for (const e of sim.step(bots.map((b) => b.update(sim)))) {
            if (e.type !== 'policeStunned') continue;
            stuns++;
            if (!bots[e.byCharId - 1]!.log.slice(-6).some((l) => l.includes('dash-stuns officer'))) accidental++;
          }
        }
      }
    }
    expect(stuns).toBeGreaterThan(10);
    expect(accidental).toBe(0);
  });
});
