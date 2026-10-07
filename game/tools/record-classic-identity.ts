/**
 * Records the classic-identity fixture (test/sim/fixtures/content-classic-identity.json) used by
 * test/sim/content-classic-identity.test.ts. See test/sim/fixtures/classicIdentity.ts.
 *
 *   npx tsx tools/record-classic-identity.ts            # writes the fixture
 *   npx tsx tools/record-classic-identity.ts --check    # re-records in memory and diffs (no write)
 *
 * Regenerate ONLY for an intended, agreed change of classic behaviour (Content 2.0 rule: change
 * requests go through C0). Never to make a failing identity test pass.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createMatch, type SlotSpec } from '../src/ai/harness';
import type { Difficulty, RivalId } from '../src/ai/types';
import { LAYOUTS } from '../src/sim/layouts/index';
import { Simulation } from '../src/sim/sim';
import type { LayoutId, RuleConfig } from '../src/sim/types';
import { FuzzDriver } from '../test/sim/fixtures/fuzzbot';
import { makeSetup } from '../test/sim/fixtures/layouts';
import {
  classicStateDigest,
  packStreams,
  sha,
  StreamEncoder,
  type AiMatchFixture,
  type FuzzMatchFixture,
  type IdentityExpect,
  type IdentityFixture,
} from '../test/sim/fixtures/classicIdentity';

const OUT = new URL('../test/sim/fixtures/content-classic-identity.json', import.meta.url);
const MAX_TICKS = 16000;

const LAYOUT_CYCLE: LayoutId[] = ['plaza', 'shortcut', 'counter'];
const RIVAL_CYCLE: RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];
const DIFF_CYCLE: Difficulty[] = ['normal', 'challenge', 'novice'];

function expectOf(sim: Simulation): IdentityExpect {
  return {
    ticks: sim.state.tick,
    events: sim.eventLog.length,
    logSha: sha(JSON.stringify(sim.eventLog)),
    stateSha: classicStateDigest(sim.state),
    scores: [sim.state.scores[0], sim.state.scores[1]],
    reason: sim.state.result?.reason ?? null,
  };
}

function recordAi(i: number): AiMatchFixture {
  const layout = LAYOUT_CYCLE[i % 3]!;
  const twoVsTwo = i % 3 === 2; // 10 of 30
  const police = i % 2 === 0;
  const proxy = i % 5 === 1; // a scripted human proxy in slot 0 now and then
  const slot = (k: number): SlotSpec => ({
    personality: RIVAL_CYCLE[(i + k) % 3]!,
    difficulty: DIFF_CYCLE[(i + 2 * k) % 3]!,
    humanProxy: proxy && k === 0,
  });
  const team0 = twoVsTwo ? [slot(0), slot(1)] : [slot(0)];
  const team1 = twoVsTwo ? [slot(2), slot(3)] : [slot(1)];
  const seed = 1001 + i * 17;
  // classic pinned explicitly: maps gaining `layout.v2` (C4) must not change what is recorded
  const rules: Partial<RuleConfig> = { police, content: 'classic' };
  const { sim, bots } = createMatch({ layout, team0, team1, seed, rules });
  const enc = bots.map(() => new StreamEncoder());
  while (!sim.state.over && sim.state.tick < MAX_TICKS) {
    const cmds = bots.map((b, k) => enc[k]!.push(b.update(sim)));
    sim.step(cmds);
  }
  return {
    name: `ai${String(i).padStart(2, '0')}-${layout}-${twoVsTwo ? '2v2' : '1v1'}${police ? '-police' : ''}${proxy ? '-proxy' : ''}`,
    layout,
    seed,
    roster: sim.setup.roster,
    rules,
    commands: packStreams(enc.map((e) => e.s)),
    expect: expectOf(sim),
  };
}

function runFuzz(f: Omit<FuzzMatchFixture, 'expect'>): IdentityExpect {
  const sim = new Simulation({ ...makeSetup(LAYOUTS[f.layout as LayoutId], f.teams, { ...f.rules, content: 'classic' }), seed: f.seed });
  const driver = new FuzzDriver(sim, f.seed);
  for (let t = 0; t < f.ticks && !sim.state.over; t++) {
    if (f.assistEvery) driver.assist(f.assistEvery);
    sim.step(driver.commands());
  }
  return expectOf(sim);
}

const FUZZ: Omit<FuzzMatchFixture, 'expect'>[] = [
  { name: 'fuzz-tutorial-solo', layout: 'tutorial', teams: [0], seed: 7, ticks: 5400, assistEvery: 0, rules: { timeLimit: false } },
  { name: 'fuzz-tutorial-assist', layout: 'tutorial', teams: [0], seed: 8, ticks: 5400, assistEvery: 400, rules: { timeLimit: false } },
  { name: 'fuzz-plaza-2v2-assist', layout: 'plaza', teams: [0, 0, 1, 1], seed: 21, ticks: 9000, assistEvery: 300, rules: { police: true } },
  { name: 'fuzz-shortcut-2v2', layout: 'shortcut', teams: [0, 0, 1, 1], seed: 22, ticks: 9000, assistEvery: 0, rules: {} },
  { name: 'fuzz-counter-1v1-assist', layout: 'counter', teams: [0, 1], seed: 23, ticks: 9000, assistEvery: 500, rules: { police: true } },
];

function recordAll(): IdentityFixture {
  const ai: AiMatchFixture[] = [];
  for (let i = 0; i < 30; i++) ai.push(recordAi(i));
  const fuzz = FUZZ.map((f) => ({ ...f, expect: runFuzz(f) }));
  return { recordedAt: 'HEAD 1250caa (pre Content 2.0 contracts)', ai, fuzz };
}

const check = process.argv.includes('--check');
const t0 = Date.now();
const fx = recordAll();
if (check) {
  const old = JSON.parse(readFileSync(OUT, 'utf8')) as IdentityFixture;
  let diffs = 0;
  fx.ai.forEach((m, i) => {
    if (JSON.stringify(m.expect) !== JSON.stringify(old.ai[i]?.expect)) {
      diffs++;
      console.log(`DIFF ${m.name}`, m.expect, old.ai[i]?.expect);
    }
  });
  fx.fuzz.forEach((m, i) => {
    if (JSON.stringify(m.expect) !== JSON.stringify(old.fuzz[i]?.expect)) {
      diffs++;
      console.log(`DIFF ${m.name}`, m.expect, old.fuzz[i]?.expect);
    }
  });
  console.log(`${diffs} differing matches (${Date.now() - t0} ms)`);
  process.exitCode = diffs ? 1 : 0;
} else {
  const json = JSON.stringify(fx, null, 1);
  writeFileSync(OUT, json + '\n');
  for (const m of fx.ai) console.log(m.name, m.expect.ticks, m.expect.events, m.expect.scores.join(':'), m.expect.reason, `${m.commands.length} b64`);
  for (const m of fx.fuzz) console.log(m.name, m.expect.ticks, m.expect.events, m.expect.scores.join(':'), m.expect.reason);
  console.log(`wrote ${json.length} bytes in ${Date.now() - t0} ms`);
}
