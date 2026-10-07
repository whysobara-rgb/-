/**
 * Command log + replay determinism (fun-plan WP5 / content-plan F5; CI gate "replay determinism"):
 * a full police-on match recorded through CommandLog replays bit-exact in a fresh
 * Simulation(sim.setup) — identical event log and final state hash — classic and v2 with every
 * content system on. Plus the encoding itself (lossless round trip, memory budget).
 */
import { describe, expect, it } from 'vitest';
import { createMatch, type SlotSpec } from '../../src/ai/harness';
import { CommandLog, MOVE_STEPS, canonicalizeCommands, hashJSON, quantizeAxis, replayCommandLog } from '../../src/game/replay';
import { LAYOUTS } from '../../src/sim/layouts/index';
import type { Command, LayoutDef, LayoutId, RuleConfig } from '../../src/sim/types';

const proxy: SlotSpec = { personality: 'hodadak', difficulty: 'normal', humanProxy: true };
const bot = (personality: SlotSpec['personality']): SlotSpec => ({ personality, difficulty: 'normal' });

/** Record a full match the way match.ts does (canonicalize -> step -> record). */
function recordMatch(layout: LayoutId | LayoutDef, team0: SlotSpec[], team1: SlotSpec[], seed: number, rules: Partial<RuleConfig>, maxTicks = 20000) {
  const { sim, bots } = createMatch({ layout, team0, team1, seed, rules });
  const log = new CommandLog(bots.length);
  let n = 0;
  while (!sim.state.over && n < maxTicks) {
    const cmds: (Command | undefined)[] = bots.map((b) => b.update(sim));
    canonicalizeCommands(cmds);
    sim.step(cmds);
    log.record(cmds);
    n++;
  }
  return { sim, log };
}

function expectReplayIdentical(rec: ReturnType<typeof recordMatch>): void {
  const { sim, log } = rec;
  // a JSON round trip first (bug-report path), then replay from the original setup
  const again = replayCommandLog(sim.setup, CommandLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON()))));
  expect(again.state.tick).toBe(sim.state.tick);
  expect(again.eventLog.length).toBe(sim.eventLog.length);
  expect(hashJSON(again.eventLog)).toBe(hashJSON(sim.eventLog));
  expect(hashJSON(again.state)).toBe(hashJSON(sim.state));
  expect(JSON.stringify(again.state)).toBe(JSON.stringify(sim.state));
}

/** A v2 layout: the real one once C4 lands it, else the classic safes as a bare v2 composition. */
function v2Of(id: LayoutId): LayoutDef {
  const base = LAYOUTS[id];
  if (base.v2) return base;
  return { ...base, v2: { safes: base.safes, props: [], breakables: [], gimmicks: [], itemPads: [], eventSpots: [] } };
}

describe('command log replay (determinism CI gate)', () => {
  it('a full police-on 1:1 match replays bit-exact (classic)', () => {
    const rec = recordMatch('plaza', [proxy], [bot('tongkeun')], 11, { police: true });
    expect(rec.sim.state.over).toBe(true);
    expect(rec.sim.state.tick).toBeGreaterThan(60 * 60);
    expectReplayIdentical(rec);
  });

  it('a full police-on 2:2 match replays bit-exact (classic)', () => {
    const rec = recordMatch('shortcut', [proxy, bot('hodadak')], [bot('nunchi'), bot('tongkeun')], 5, { police: true });
    expect(rec.sim.state.over).toBe(true);
    expectReplayIdentical(rec);
  });

  it('a full police-on match with every content system on replays bit-exact (v2: items, events, gimmicks)', () => {
    const layout = v2Of('counter');
    const rec = recordMatch(layout, [proxy], [bot('nunchi')], 23, { police: true, content: 'v2', items: 'on', events: 'on', gimmicks: true });
    expect(rec.sim.rules.content).toBe('v2');
    expect(rec.sim.state.over).toBe(true);
    expectReplayIdentical(rec);
  });

  it('memory: <= 150 KB per 4-minute 1:1 match, even when both slots change every tick', () => {
    // measured on a real match, extrapolated to 14400 ticks
    const rec = recordMatch('counter', [proxy], [bot('hodadak')], 3, { police: true });
    const perTick = rec.log.byteSize() / rec.log.ticks;
    expect(perTick * 4 * 60 * 60).toBeLessThanOrEqual(150 * 1024);
    // worst case: two analog sticks moving every single tick for 4 minutes
    const log = new CommandLog(2);
    let x = 0.123;
    for (let t = 0; t < 4 * 60 * 60; t++) {
      x = (x * 9301 + 49297) % 233280;
      const a = (x / 233280) * 2 - 1;
      const cmds: (Command | undefined)[] = [
        { move: { x: a, y: -a / 2 }, grab: t % 50 < 20, dash: false },
        { move: { x: -a, y: a / 3 }, grab: false, dash: t % 240 === 0 },
      ];
      canonicalizeCommands(cmds);
      log.record(cmds);
    }
    expect(log.byteSize()).toBeLessThanOrEqual(150 * 1024);
  });
});

describe('command log encoding', () => {
  it('round-trips every field exactly (aim / ping / emote / absent slots / signed zero), also through JSON', () => {
    const log = new CommandLog(3, 8);
    const ticks: (Command | undefined)[][] = [];
    for (let t = 0; t < 300; t++) {
      const row: (Command | undefined)[] = [
        { move: { x: Math.sin(t * 0.1), y: Math.cos(t * 0.37) * 1.4 }, grab: t % 7 < 3, dash: t % 11 === 0, aim: t % 5 === 0 ? { x: Math.PI * t, y: -1e-300 } : null, ping: t % 50 === 3 ? { pos: { x: 1 / 3, y: -t }, targetId: t % 100 === 3 ? null : 7 } : null },
        t % 13 === 0 ? undefined : { move: { x: -0, y: t % 2 ? 0.5 : -1e-9 }, grab: false, dash: false, emote: t % 40 === 1 ? 'wiggle' : null },
        { move: { x: 0, y: 0 }, grab: true, dash: true },
      ];
      canonicalizeCommands(row);
      ticks.push(row);
      log.record(row);
    }
    const strip = (c: Command | undefined) => (c ? { move: c.move, grab: c.grab, dash: c.dash, aim: c.aim ?? null, ping: c.ping ?? null, emote: c.emote ?? null } : undefined);
    const copy = CommandLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    for (const l of [log, copy]) {
      // sequential, then a backwards jump
      for (let t = 0; t < ticks.length; t++) {
        const got = l.commandsAt(t);
        for (let s = 0; s < 3; s++) {
          expect(strip(got[s])).toEqual(strip(ticks[t]![s]));
          if (got[s]) {
            expect(Object.is(got[s]!.move.x, ticks[t]![s]!.move.x)).toBe(true);
            expect(Object.is(got[s]!.move.y, ticks[t]![s]!.move.y)).toBe(true);
          }
        }
      }
      expect(strip(l.commandsAt(17)[0])).toEqual(strip(ticks[17]![0]));
    }
    // recording continues after a load
    copy.record(ticks[0]!);
    expect(copy.ticks).toBe(301);
    expect(strip(copy.commandsAt(300)[2])).toEqual(strip(ticks[0]![2]));
  });

  it('canonicalize: on the int16 grid, idempotent, no signed zero, never mutates the caller objects', () => {
    const move = { x: 0.7071067811865476, y: -0.7071067811865476 };
    const cmds: (Command | undefined)[] = [{ move, grab: false, dash: false }, undefined, { move: { x: -1e-12, y: 2 }, grab: false, dash: false }];
    canonicalizeCommands(cmds);
    expect(move.x).toBe(0.7071067811865476);
    expect(cmds[0]!.move.x * MOVE_STEPS).toBeCloseTo(Math.round(0.7071067811865476 * MOVE_STEPS), 6);
    expect(Math.abs(cmds[0]!.move.x - move.x)).toBeLessThanOrEqual(0.5 / MOVE_STEPS);
    expect(Object.is(cmds[2]!.move.x, 0)).toBe(true);
    expect(cmds[2]!.move.y).toBe(1);
    const once = cmds.map((c) => (c ? { ...c.move } : null));
    canonicalizeCommands(cmds);
    expect(cmds.map((c) => (c ? { ...c.move } : null))).toEqual(once);
    expect(quantizeAxis(NaN)).toBe(0);
    expect(quantizeAxis(quantizeAxis(0.3))).toBe(quantizeAxis(0.3));
  });

  it('refuses a move that was not canonicalized (the replay would not be exact)', () => {
    const log = new CommandLog(1);
    expect(() => log.record([{ move: { x: 0.1234567891, y: 0 }, grab: false, dash: false }])).toThrow(RangeError);
  });
});
