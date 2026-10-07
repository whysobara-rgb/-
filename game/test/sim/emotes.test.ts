/**
 * Taunt step (src/sim/emotes.ts, owner addition "taunts part 2"): start / end / cooldown,
 * cancel causes, "in front of a rival" (nearOpponentId with line of sight), match end, and the
 * cosmetic-only guarantee (a recorded match replayed with taunt spam ends byte-identical apart
 * from the taunt events themselves).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sanitizeCommand } from '../../src/sim/actions';
import { DASH, EMOTE } from '../../src/sim/config';
import { LAYOUTS } from '../../src/sim/layouts/index';
import { Simulation } from '../../src/sim/sim';
import type { Command, EmoteId, LayoutId, SimEvent } from '../../src/sim/types';
import { classicStateDigest, sha, StreamDecoder, unpackStreams, type IdentityFixture } from './fixtures/classicIdentity';
import { FuzzDriver } from './fixtures/fuzzbot';
import { cmd, makeSetup, makeSim, openLayout, run } from './fixtures/layouts';

const taunt = (id: EmoteId, mx = 0, my = 0, grab = false, dash = false): Command => ({ ...cmd(mx, my, grab, dash), emote: id });
const emoteEvents = (ev: SimEvent[]) => ev.filter((e) => e.type === 'emote' || e.type === 'emoteCancel');

/** Slot 0 (team 0) at (30,30), slot 1 (team 1) at (33,30), slot 2 (team 0) at (30,26). */
function trio(statics = openLayout().statics) {
  const sim = makeSim(openLayout({ statics }), [0, 1, 0]);
  sim.debug.teleport(1, { x: 30, y: 30 }, 0);
  sim.debug.teleport(2, { x: 33, y: 30 }, Math.PI);
  sim.debug.teleport(3, { x: 30, y: 26 }, 0);
  sim.step([cmd(), cmd(), cmd()]); // deliver teleport releases, settle
  return sim;
}

describe('taunt step: start, end, cooldown', () => {
  it('every character starts with emote: null', () => {
    const sim = makeSim(openLayout(), [0, 1, 0, 1]);
    for (const c of sim.state.characters) expect(c.emote).toBeNull();
  });

  it('sanitizeCommand keeps a valid taunt id and drops garbage', () => {
    expect(sanitizeCommand(taunt('wiggle')).emote).toBe('wiggle');
    expect(sanitizeCommand({ ...cmd(), emote: 'nope' as EmoteId }).emote).toBeUndefined();
    expect(sanitizeCommand({ ...cmd(), emote: 'toString' as EmoteId }).emote).toBeUndefined();
    expect(sanitizeCommand(cmd())).toEqual(cmd());
  });

  it('a request starts the taunt with its duration and an emote event naming the rival in front', () => {
    const sim = trio();
    const ev = sim.step([taunt('wiggle'), cmd(), cmd()]);
    const t = sim.state.tick;
    expect(sim.state.characters[0]!.emote).toEqual({ id: 'wiggle', startTick: t, endTick: t + EMOTE.durationTicks.wiggle });
    expect(emoteEvents(ev)).toEqual([{ type: 'emote', tick: t, charId: 1, emoteId: 'wiggle', nearOpponentId: 2 }]);
    // a second request while playing is ignored (no restart, no event)
    const ev2 = sim.step([taunt('bleh'), cmd(), cmd()]);
    expect(emoteEvents(ev2)).toEqual([]);
    expect(sim.state.characters[0]!.emote!.id).toBe('wiggle');
  });

  it('ends on its own at endTick without an event, then cools down EMOTE.cooldownTicks', () => {
    const sim = trio();
    sim.step([taunt('bleh'), cmd(), cmd()]);
    const end = sim.state.characters[0]!.emote!.endTick;
    const ev = run(sim, end - sim.state.tick - 1, [cmd(), cmd(), cmd()]);
    expect(emoteEvents(ev)).toEqual([]);
    expect(sim.state.characters[0]!.emote).not.toBeNull();
    sim.step([cmd(), cmd(), cmd()]);
    expect(sim.state.tick).toBe(end);
    expect(sim.state.characters[0]!.emote).toBeNull();
    // cooldown: requests are dropped until end + cooldown
    const spam = run(sim, EMOTE.cooldownTicks - 1, [taunt('wiggle'), cmd(), cmd()]);
    expect(emoteEvents(spam)).toEqual([]);
    expect(sim.state.characters[0]!.emote).toBeNull();
    expect(sim.state.tick).toBe(end + EMOTE.cooldownTicks - 1);
    const go = sim.step([taunt('wiggle'), cmd(), cmd()]);
    expect(emoteEvents(go).map((e) => e.type)).toEqual(['emote']);
    expect(sim.state.characters[0]!.emote!.startTick).toBe(end + EMOTE.cooldownTicks);
  });

  it('ignores unknown ids and requests from teammates do not interfere', () => {
    const sim = trio();
    const ev = sim.step([{ ...cmd(), emote: 'moonwalk' as EmoteId }, taunt('squatBounce'), taunt('fanCash')]);
    expect(sim.state.characters[0]!.emote).toBeNull();
    expect(sim.state.characters[1]!.emote!.id).toBe('squatBounce');
    expect(sim.state.characters[2]!.emote!.id).toBe('fanCash');
    const es = emoteEvents(ev);
    expect(es).toHaveLength(2);
    // slot 1's rival in front is slot 0 (3 m) rather than slot 2 (5 m)
    expect(es[0]).toMatchObject({ charId: 2, emoteId: 'squatBounce', nearOpponentId: 1 });
    expect(es[1]).toMatchObject({ charId: 3, emoteId: 'fanCash', nearOpponentId: 2 });
  });

  it('cannot start while moving, asking to grab, starting a dash, dashing or knocked down', () => {
    const sim = trio();
    expect(emoteEvents(sim.step([taunt('wiggle', 1, 0), cmd(), cmd()]))).toEqual([]);
    expect(emoteEvents(sim.step([taunt('wiggle', 0, 0, true), cmd(), cmd()]))).toEqual([]);
    run(sim, 2, [cmd(), cmd(), cmd()]);
    expect(emoteEvents(sim.step([taunt('wiggle', 0, 0, false, true), cmd(), cmd()]))).toEqual([]);
    expect(sim.state.characters[0]!.dashTicks).toBeGreaterThan(0);
    expect(emoteEvents(sim.step([taunt('wiggle'), cmd(), cmd()]))).toEqual([]);
    // a small stick drift below EMOTE.cancelMove still starts
    const sim2 = trio();
    expect(emoteEvents(sim2.step([taunt('wiggle', EMOTE.cancelMove * 0.5, 0), cmd(), cmd()])).map((e) => e.type)).toEqual(['emote']);
  });
});

describe('taunt step: cancel causes', () => {
  function playing() {
    const sim = trio();
    sim.step([taunt('fanCash'), cmd(), cmd()]);
    expect(sim.state.characters[0]!.emote).not.toBeNull();
    return sim;
  }

  it('move above EMOTE.cancelMove cancels with cause move and starts the cooldown', () => {
    const sim = playing();
    expect(emoteEvents(sim.step([cmd(EMOTE.cancelMove * 0.9, 0), cmd(), cmd()]))).toEqual([]);
    const ev = sim.step([cmd(0, 1), cmd(), cmd()]);
    const t = sim.state.tick;
    expect(emoteEvents(ev)).toEqual([{ type: 'emoteCancel', tick: t, charId: 1, emoteId: 'fanCash', cause: 'move' }]);
    expect(sim.state.characters[0]!.emote).toBeNull();
    const spam = run(sim, EMOTE.cooldownTicks - 1, [taunt('wiggle'), cmd(), cmd()]);
    expect(emoteEvents(spam)).toEqual([]);
    expect(emoteEvents(sim.step([taunt('wiggle'), cmd(), cmd()])).map((e) => e.type)).toEqual(['emote']);
  });

  it('grab cancels with cause grab', () => {
    const sim = playing();
    const ev = sim.step([cmd(0, 0, true), cmd(), cmd()]);
    expect(emoteEvents(ev)).toEqual([expect.objectContaining({ type: 'emoteCancel', cause: 'grab', emoteId: 'fanCash' })]);
  });

  it('dash cancels with cause dash (and the dash still happens)', () => {
    const sim = playing();
    const ev = sim.step([cmd(0, 0, false, true), cmd(), cmd()]);
    expect(emoteEvents(ev)).toEqual([expect.objectContaining({ type: 'emoteCancel', cause: 'dash' })]);
    expect(ev.some((e) => e.type === 'dash')).toBe(true);
    expect(sim.state.characters[0]!.dashTicks).toBe(DASH.durationTicks);
  });

  it('an opposing dash knockdown cancels with cause hit and hitBy = the dasher, before the dashHit', () => {
    const sim = trio();
    // slot 1 (id 2) taunts, slot 0 (id 1) dashes into it from 3 m
    sim.step([cmd(), taunt('wiggle'), cmd()]);
    const ev: SimEvent[] = [];
    for (let t = 0; t < 12; t++) ev.push(...sim.step([cmd(0, 0, false, t === 0, { x: 1, y: 0 }), cmd(), cmd()]));
    const hitIdx = ev.findIndex((e) => e.type === 'dashHit' && e.knockdown);
    const cancelIdx = ev.findIndex((e) => e.type === 'emoteCancel');
    expect(hitIdx).toBeGreaterThanOrEqual(0);
    expect(ev[cancelIdx]).toMatchObject({ type: 'emoteCancel', charId: 2, emoteId: 'wiggle', cause: 'hit', hitBy: 1 });
    expect(cancelIdx).toBeLessThan(hitIdx);
    expect(ev[cancelIdx]!.tick).toBe(ev[hitIdx]!.tick);
    expect(sim.state.characters[1]!.emote).toBeNull();
  });

  it('a police / other knockdown cancels with cause hit and hitBy null', () => {
    const sim = trio();
    sim.step([taunt('bleh'), cmd(), cmd()]);
    const ctx = (sim as unknown as { ctx: Parameters<typeof import('../../src/sim/actions').knockDown>[0] }).ctx;
    return import('../../src/sim/actions').then(({ knockDown }) => {
      ctx.events = [];
      knockDown(ctx, 0, 1, 0, 'police', 99);
      expect(emoteEvents(ctx.events)).toEqual([expect.objectContaining({ type: 'emoteCancel', cause: 'hit', hitBy: null })]);
      expect(sim.state.characters[0]!.emote).toBeNull();
    });
  });

  it('the match ending stops a live taunt (emoteCancel without a cause)', () => {
    const sim = new Simulation({ ...makeSetup(openLayout(), [0, 1]), rules: { matchTicks: 60, timeLimit: true } });
    run(sim, 50, [cmd(), cmd()]);
    expect(sim.state.over).toBe(false);
    sim.step([taunt('squatBounce'), cmd()]);
    expect(sim.state.characters[0]!.emote).not.toBeNull();
    const ev = run(sim, 400, [cmd(), cmd()]);
    expect(sim.state.over).toBe(true);
    const cancel = emoteEvents(ev).find((e) => e.type === 'emoteCancel');
    expect(cancel).toBeDefined();
    expect(cancel).not.toHaveProperty('cause');
    expect(sim.state.characters[0]!.emote).toBeNull();
  });
});

describe('taunt step: rival in front (nearOpponentId)', () => {
  it('null when the only rival is out of EMOTE.nearOpponentRadius', () => {
    const sim = trio();
    sim.debug.teleport(2, { x: 30 + EMOTE.nearOpponentRadius + 0.5, y: 30 }, Math.PI);
    sim.step([cmd(), cmd(), cmd()]);
    const ev = sim.step([taunt('wiggle'), cmd(), cmd()]);
    expect(emoteEvents(ev)[0]).toMatchObject({ type: 'emote', nearOpponentId: null });
  });

  it('null when a building blocks the line of sight; teammates never count', () => {
    const wall = { id: 'w', kind: 'building' as const, center: { x: 31.5, y: 30 }, half: { x: 0.3, y: 2 }, angle: 0, height: 8 };
    const sim = trio([wall]);
    sim.debug.teleport(2, { x: 33.5, y: 30 }, Math.PI);
    sim.step([cmd(), cmd(), cmd()]);
    const ev = sim.step([taunt('bleh'), cmd(), cmd()]);
    expect(emoteEvents(ev)[0]).toMatchObject({ type: 'emote', charId: 1, nearOpponentId: null });
  });

  it('ties go to the lower slot', () => {
    const sim = makeSim(openLayout(), [0, 1, 1]);
    sim.debug.teleport(1, { x: 30, y: 30 }, 0);
    sim.debug.teleport(2, { x: 33, y: 30 }, Math.PI);
    sim.debug.teleport(3, { x: 27, y: 30 }, 0);
    sim.step([cmd(), cmd(), cmd()]);
    const ev = sim.step([taunt('bleh'), cmd(), cmd()]);
    expect(emoteEvents(ev)[0]).toMatchObject({ nearOpponentId: 2 });
  });
});

describe('taunts are cosmetic and deterministic', () => {
  const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/content-classic-identity.json', import.meta.url), 'utf8')) as IdentityFixture;
  const IDS: EmoteId[] = ['wiggle', 'bleh', 'fanCash', 'squatBounce', 'hodadakZoom', 'tongkeunFlex', 'nunchiShrug'];

  /** Ask for a taunt on every tick a character stands still with free paws (it starts whenever allowed). */
  function spam(c: Command, slot: number, tick: number): Command {
    if (Math.hypot(c.move.x, c.move.y) > EMOTE.cancelMove || c.grab || c.dash) return c;
    return { ...c, emote: IDS[(slot + Math.floor(tick / 7)) % IDS.length]! };
  }

  function replay(m: IdentityFixture['ai'][number], withSpam: boolean) {
    const sim = new Simulation({ layout: LAYOUTS[m.layout as LayoutId], roster: m.roster, seed: m.seed, rules: { ...m.rules, content: 'classic' } });
    const dec = unpackStreams(m.commands).map((s) => new StreamDecoder(s));
    const n = dec[0]!.length;
    let started = 0;
    for (let t = 0; t < n; t++) {
      const cs = dec.map((d, slot) => (withSpam ? spam(d.next(), slot, t) : d.next()));
      for (const e of sim.step(cs)) if (e.type === 'emote') started++;
    }
    const log = sim.eventLog.filter((e) => e.type !== 'emote' && e.type !== 'emoteCancel');
    return { sim, started, logSha: sha(JSON.stringify(log)), stateSha: classicStateDigest(sim.state), scores: [...sim.state.scores] };
  }

  for (const m of FIXTURE.ai.slice(0, 4)) {
    it(`taunt spam leaves ${m.name} identical (scores, positions, every other event)`, () => {
      const spammed = replay(m, true);
      expect(spammed.started).toBeGreaterThan(0);
      // compared with the same replay without taunts (not the frozen fixture, so physics work in
      // progress elsewhere never makes this test about anything but taunts)
      const plain = replay(m, false);
      expect(plain.started).toBe(0);
      expect({ logSha: spammed.logSha, stateSha: spammed.stateSha, scores: spammed.scores }).toEqual({
        logSha: sha(JSON.stringify(plain.sim.eventLog)),
        stateSha: plain.stateSha,
        scores: plain.scores,
      });
      expect(spammed.sim.state.characters.every((c) => !c.emote || c.emote.endTick > spammed.sim.state.tick)).toBe(true);
    });
  }

  it('fuzz runs with taunt spam are deterministic and keep the score invariant', () => {
    const go = () => {
      const sim = new Simulation({ ...makeSetup(LAYOUTS.plaza, [0, 0, 1, 1]), seed: 77 });
      const driver = new FuzzDriver(sim, 77);
      for (let t = 0; t < 1500 && !sim.state.over; t++) {
        driver.assist(120);
        sim.step(driver.commands().map((c, slot) => spam(c, slot, t)));
        const st = sim.state;
        expect(st.scores[0] + st.scores[1] + st.remainingValue).toBe(st.totalValue);
        for (const c of st.characters) {
          if (!c.emote) continue;
          expect(c.grab).toBeNull();
          expect(c.knockdownTicks).toBe(0);
          expect(st.tick).toBeLessThan(c.emote.endTick);
        }
      }
      return sha(JSON.stringify(sim.eventLog));
    };
    expect(go()).toBe(go());
  });
});
