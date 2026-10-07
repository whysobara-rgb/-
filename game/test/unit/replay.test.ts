/**
 * Command log + replay determinism (fun-plan WP5 / content-plan F5; CI gate "replay determinism"):
 * a full police-on match recorded through CommandLog replays bit-exact in a fresh
 * Simulation(sim.setup) — identical event log and final state hash — classic and v2 with every
 * content system on. Plus the encoding itself (lossless round trip, memory budget).
 */
import { describe, expect, it } from 'vitest';
import { createMatch, type SlotSpec } from '../../src/ai/harness';
import { CommandLog, MOVE_STEPS, canonicalizeCommands, hashJSON, quantizeAim, quantizeAxis, replayCommandLog } from '../../src/game/replay';
import { LAYOUTS } from '../../src/sim/layouts/index';
import type { Simulation } from '../../src/sim/sim';
import type { Command, LayoutId, RuleConfig } from '../../src/sim/types';

const proxy: SlotSpec = { personality: 'hodadak', difficulty: 'normal', humanProxy: true };
const bot = (personality: SlotSpec['personality']): SlotSpec => ({ personality, difficulty: 'normal' });

const recorded = new Map<string, { sim: Simulation; log: CommandLog }>();

/** Record a full match the way match.ts does (canonicalize -> step -> record); memoized per setup. */
function recordMatch(layout: LayoutId, team0: SlotSpec[], team1: SlotSpec[], seed: number, rules: Partial<RuleConfig>, maxTicks = 20000): { sim: Simulation; log: CommandLog } {
  const key = JSON.stringify([layout, team0, team1, seed, rules, maxTicks]);
  let rec = recorded.get(key);
  if (!rec) recorded.set(key, (rec = recordFresh(layout, team0, team1, seed, rules, maxTicks)));
  return rec;
}

function recordFresh(layout: LayoutId, team0: SlotSpec[], team1: SlotSpec[], seed: number, rules: Partial<RuleConfig>, maxTicks = 20000) {
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

const V2_RULES: Partial<RuleConfig> = { police: true, content: 'v2', items: 'on', events: 'on', gimmicks: true };

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
    // the real v2 composition of the map (crates, ATMs, piggy banks, props, gimmicks, item pads)
    expect(LAYOUTS.counter.v2).toBeTruthy();
    const rec = recordMatch('counter', [proxy], [bot('nunchi')], 23, V2_RULES);
    expect(rec.sim.rules.content).toBe('v2');
    expect(rec.sim.state.over).toBe(true);
    // the content systems were actually exercised, not just switched on
    const kinds = new Set(rec.sim.eventLog.map((e) => e.type));
    expect(kinds.has('itemPickup')).toBe(true);
    expect(kinds.has('coinSpawn')).toBe(true);
    expectReplayIdentical(rec);
  });

  it('a full police-on 2:2 match with every content system on replays bit-exact (v2)', () => {
    const rec = recordMatch('plaza', [proxy, bot('nunchi')], [bot('hodadak'), bot('tongkeun')], 80, V2_RULES);
    expect(rec.sim.state.over).toBe(true);
    expectReplayIdentical(rec);
  });

  it('memory: <= 150 KB per 4-minute match, 1:1 and 2:2 (three bots, every content system on)', () => {
    // measured on real matches, extrapolated to 14400 ticks
    const per4min = (rec: ReturnType<typeof recordMatch>) => (rec.log.byteSize() / rec.log.ticks) * 4 * 60 * 60;
    const cases = [
      // the matches the determinism tests above recorded (memoized) + the review's worst 2:2
      recordMatch('plaza', [proxy], [bot('tongkeun')], 11, { police: true }),
      recordMatch('shortcut', [proxy, bot('hodadak')], [bot('nunchi'), bot('tongkeun')], 5, { police: true }),
      recordMatch('counter', [proxy], [bot('nunchi')], 23, V2_RULES),
      recordMatch('plaza', [proxy, bot('nunchi')], [bot('hodadak'), bot('tongkeun')], 80, V2_RULES),
      recordMatch('shortcut', [proxy, bot('hodadak')], [bot('nunchi'), bot('tongkeun')], 79, V2_RULES),
    ];
    for (const rec of cases) {
      expect(per4min(rec)).toBeLessThanOrEqual(150 * 1024);
      expect(rec.log.capacityBytes()).toBeLessThanOrEqual(150 * 1024);
    }
  });

  it('memory: two analog sticks never at rest for 4 minutes stay <= 150 KB; any input is bounded', () => {
    // a human never lets go of the stick (keyboard / pad input carries no aim): a slow sweep, a
    // circle every ~10 s, with a twitch every 2 s
    const stick = (t: number, k: number) => {
      const a = t * 0.01 * k + (t % 120 === 0 ? 1.5 : 0);
      return { x: Math.cos(a), y: Math.sin(a) * 0.9 };
    };
    const log = new CommandLog(2);
    for (let t = 0; t < 4 * 60 * 60; t++) {
      const cmds: (Command | undefined)[] = [
        { move: stick(t, 1), grab: t % 50 < 20, dash: false },
        { move: stick(t, -1.1), grab: false, dash: t % 240 === 0 },
      ];
      canonicalizeCommands(cmds);
      log.record(cmds);
    }
    expect(log.byteSize()).toBeLessThanOrEqual(150 * 1024);
    // adversarial: every slot jumps to a random move and aim on every tick -> at most
    // mask + 10 bytes per slot-tick (header, 4 B move, 4 B aim; no ping / taunt)
    const bad = new CommandLog(2);
    let x = 0.123;
    const rnd = () => ((x = (x * 9301 + 49297) % 233280), (x / 233280) * 2 - 1);
    for (let t = 0; t < 600; t++) {
      const cmds: (Command | undefined)[] = [0, 1].map(() => ({ move: { x: rnd(), y: rnd() }, grab: rnd() > 0, dash: false, aim: { x: rnd(), y: rnd() } }));
      canonicalizeCommands(cmds);
      bad.record(cmds);
    }
    expect(bad.byteSize()).toBeLessThanOrEqual(600 * (1 + 2 * 10));
    const again = CommandLog.fromJSON(JSON.parse(JSON.stringify(bad.toJSON())));
    expect(again.commandsAt(599)).toEqual(bad.commandsAt(599));
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
        { move: { x: 0, y: 0 }, grab: true, dash: true, aim: t % 3 === 0 ? null : t % 37 === 1 ? { x: -1, y: 0.25 } : { x: Math.cos(t * 0.02), y: Math.sin(t * 0.02) * 9 } },
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

  it('canonicalize: on the grid, idempotent, no signed zero, never mutates the caller objects', () => {
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

  it('canonicalize aim: same facing angle within 1e-4 rad, max-norm 1, null when the sim would ignore it', () => {
    for (let i = 0; i < 360; i++) {
      const r = 0.01 + (i % 7) * 3;
      const raw = { x: r * Math.cos(i * 0.0174533 + 0.001), y: r * Math.sin(i * 0.0174533 + 0.001) };
      const q = quantizeAim(raw)!;
      expect(Math.max(Math.abs(q.x), Math.abs(q.y))).toBe(1);
      let d = Math.atan2(q.y, q.x) - Math.atan2(raw.y, raw.x);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      expect(Math.abs(d)).toBeLessThan(1e-4);
      expect(quantizeAim(q)).toEqual(q);
    }
    expect(quantizeAim(null)).toBeNull();
    expect(quantizeAim({ x: 1e-9, y: 0 })).toBeNull();
    expect(quantizeAim({ x: NaN, y: 1 })).toBeNull();
    const aim = { x: 2, y: 1 };
    const cmds: (Command | undefined)[] = [{ move: { x: 0, y: 0 }, grab: false, dash: false, aim }];
    canonicalizeCommands(cmds);
    expect(aim).toEqual({ x: 2, y: 1 });
    expect(cmds[0]!.aim).toEqual({ x: 1, y: quantizeAxis(0.5) });
  });

  it('refuses a JSON log recorded on another grid or with a truncated stream', () => {
    const log = new CommandLog(1);
    const cmds: (Command | undefined)[] = [{ move: { x: 0.5, y: 0.25 }, grab: false, dash: false }];
    canonicalizeCommands(cmds);
    log.record(cmds);
    const j = log.toJSON();
    expect(() => CommandLog.fromJSON({ ...j, steps: 32767 })).toThrow(RangeError);
    expect(() => CommandLog.fromJSON({ ...j, bytes: j.bytes.slice(0, 2) })).toThrow(RangeError);
  });

  it('refuses a move that was not canonicalized (the replay would not be exact)', () => {
    const log = new CommandLog(1);
    expect(() => log.record([{ move: { x: 0.1234567891, y: 0 }, grab: false, dash: false }])).toThrow(RangeError);
  });
});
