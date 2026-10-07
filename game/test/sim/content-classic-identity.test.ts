/**
 * Content 2.0 (C0) acceptance: with `content: 'classic'` (the tutorial and every layout without
 * `v2`) the sim is byte-identical to the tree before the Content 2.0 contracts landed.
 *
 * 30 seeded bot matches (real src/ai bots at record time, replayed from their recorded command
 * streams so this test does not depend on src/ai) + 5 seeded FuzzDriver runs (incl. the
 * tutorial) must reproduce the recorded event log (sha256 of the whole log) and final state.
 * Format and regeneration rules: test/sim/fixtures/classicIdentity.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYOUTS } from '../../src/sim/layouts/index';
import { Simulation } from '../../src/sim/sim';
import type { LayoutId } from '../../src/sim/types';
import { classicStateDigest, sha, StreamDecoder, unpackStreams, type IdentityExpect, type IdentityFixture } from './fixtures/classicIdentity';
import { FuzzDriver } from './fixtures/fuzzbot';
import { makeSetup } from './fixtures/layouts';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/content-classic-identity.json', import.meta.url), 'utf8')) as IdentityFixture;

function actual(sim: Simulation): IdentityExpect {
  return {
    ticks: sim.state.tick,
    events: sim.eventLog.length,
    logSha: sha(JSON.stringify(sim.eventLog)),
    stateSha: classicStateDigest(sim.state),
    scores: [sim.state.scores[0], sim.state.scores[1]],
    reason: sim.state.result?.reason ?? null,
  };
}

/** Classic-mode invariants of the Content 2.0 state that hold on every tick. */
function expectClassicContentState(sim: Simulation): void {
  const st = sim.state;
  expect(sim.rules.content).toBe('classic');
  expect(st.coins).toEqual([]);
  expect(st.breakables).toEqual([]);
  expect(st.items).toEqual([]);
  expect(st.hazards).toEqual([]);
  expect(st.projectiles).toEqual([]);
  expect(st.gimmicks).toEqual([]);
  expect(st.matchEvents).toEqual([]);
  expect(st.eventPlan).toBeNull();
  for (const l of st.loot) {
    expect(l.variant ?? null).toBeNull();
    expect(l.innerValue ?? 0).toBe(0);
  }
  for (const c of st.characters) expect(c.bag ?? 0).toBe(0);
}

describe('content: classic is byte-identical to the pre-Content-2.0 sim', () => {
  it('fixture holds 30 bot matches and the fuzz runs', () => {
    expect(FIXTURE.ai.length).toBe(30);
    expect(FIXTURE.fuzz.length).toBeGreaterThanOrEqual(5);
  });

  for (const m of FIXTURE.ai) {
    it(`replays ${m.name}`, () => {
      // classic pinned explicitly (a map gaining `layout.v2` must not switch the replay to v2)
      const sim = new Simulation({ layout: LAYOUTS[m.layout as LayoutId], roster: m.roster, seed: m.seed, rules: { ...m.rules, content: 'classic' } });
      const dec = unpackStreams(m.commands).map((s) => new StreamDecoder(s));
      const n = dec[0]!.length;
      expectClassicContentState(sim);
      for (let t = 0; t < n; t++) sim.step(dec.map((d) => d.next()));
      expect(actual(sim)).toEqual(m.expect);
      expectClassicContentState(sim);
      expect(sim.state.totalValue).toBe(3200);
    });
  }

  for (const f of FIXTURE.fuzz) {
    it(`replays ${f.name}`, () => {
      const sim = new Simulation({ ...makeSetup(LAYOUTS[f.layout as LayoutId], f.teams, { ...f.rules, content: 'classic' }), seed: f.seed });
      const driver = new FuzzDriver(sim, f.seed);
      for (let t = 0; t < f.ticks && !sim.state.over; t++) {
        if (f.assistEvery) driver.assist(f.assistEvery);
        sim.step(driver.commands());
      }
      expect(actual(sim)).toEqual(f.expect);
      expectClassicContentState(sim);
    });
  }
});
