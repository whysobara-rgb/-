/**
 * Bot balance matrix (doc §6, §19 봇과 공정성): 3 layouts x personalities x difficulties x side
 * swaps x 1v1/2v2, plus a human-proxy 2v2 block. Runs matches in parallel worker processes and
 * writes a markdown report.
 *
 *   npx tsx tools/balance-report.ts                 # full matrix (~10 min on 3 workers)
 *   npx tsx tools/balance-report.ts --quick         # fewer seeds (iteration)
 *   npx tsx tools/balance-report.ts --blocks equal  # subset: equal,ladder,team,proxy
 *   npx tsx tools/balance-report.ts --out report.md --workers 3 --seeds 4
 *   npx tsx tools/balance-report.ts --seed-base 500000   # fresh seeds (robustness of the margins)
 *   npx tsx tools/balance-report.ts --police off    # police event off (default ON: quick match / tournament)
 *   npx tsx tools/balance-report.ts --json out.json # also dump per-match records
 *   npx tsx tools/balance-report.ts --tune stripLooseBank=0.5,police.shiftTicks=2700   # experiment knobs
 *
 *   npx tsx tools/balance-report.ts --tune coins.bagCap=150,items.hammer.knockdownTicks=50,items.drop.pairs=15/70/125/160
 *
 * Blocks: equal (1v1 bot vs bot, equal difficulty), ladder (difficulty ladder), team (2v2 bots),
 * proxy (2v2 human proxy + bot mate vs 2 bots), proxy1v1 (1v1 human proxy vs each rival at normal).
 *
 * Fun / content scorecard (C11; fun-plan WP1 step 0, content-plan §8), police on, alternating sides:
 *   npx tsx tools/balance-report.ts --fun                       # classic fun block (re-baseline)
 *   npx tsx tools/balance-report.ts --fun --content             # v2 (everything on) + §8 content block + gates
 *   npx tsx tools/balance-report.ts --fun --content --variants "classic v2"   # A/B, classic column = baseline
 *   npx tsx tools/balance-report.ts --fun --content --variants "v2:items=off v2:items=hammerOnly v2"
 *   npx tsx tools/balance-report.ts --fun --fun-json recs.jsonl # also dump per-match FunRec lines
 *   npx tsx tools/balance-report.ts --fun --content --fun-from a.jsonl=v2,b.jsonl=v2+siren   # report only (=label renames the variant)
 *   ... --fun-ref v2      # reference variant for the paired-by-seed comparison and gate changes (default: first v2)
 * Fun blocks: P = proxy vs each rival at normal (layouts x 3 rivals x --fun-seeds, default n >= 300),
 * B = normal bot vs bot (same size), T2 = 2:2 smoke (layouts x --fun-seeds-t2, default 10);
 * --fun-blocks P,B selects blocks (lever experiments skip T2). With
 * --fun the legacy blocks run only when --blocks is given. Variant = content[:rule=value,...]
 * (rules: items off|hammerOnly|on, events off|on, gimmicks true|false).
 *
 * Default output: <os tmpdir>/balance-report.md (path printed at the end).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { FLOW_HEADER, aggregate, flowMetrics, flowRow, runMatch, type SeriesMatch, type SlotSpec, type SeriesAggregate } from '../src/ai/harness';
import type { Difficulty, RivalId } from '../src/ai/types';
import { BOT_TUNING } from '../src/ai/params';
import { COINS, EVENTS, ITEMS, POLICE } from '../src/sim/config';
import type { LayoutId, RuleConfig, TeamId } from '../src/sim/types';
import { FunCollector, type FunRec } from './fun/collect';
import { funReport } from './fun/report';

const DEFAULT_OUT = join(tmpdir(), 'balance-report.md');
const LAYOUTS: LayoutId[] = ['plaza', 'shortcut', 'counter'];
const PERS: RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];
const DIFFS: Difficulty[] = ['novice', 'normal', 'challenge'];

interface Job {
  id: number;
  block: string;
  group: string;
  layout: LayoutId;
  seed: number;
  aTeam: TeamId;
  a: SlotSpec[];
  b: SlotSpec[];
  police: boolean;
  /** Extra rules (content variant). */
  rules?: Partial<RuleConfig>;
  /** Fun-scorecard job: variant label (collects a FunRec). */
  fun?: { variant: string; label: string };
}

interface JobResult {
  id: number;
  match: SeriesMatch;
  fun?: FunRec;
}

function s(p: RivalId, d: Difficulty, proxy = false): SlotSpec {
  return { personality: p, difficulty: d, humanProxy: proxy };
}

function buildJobs(blocks: Set<string>, seedsEq: number, seedsLadder: number, seedsTeam: number, diffs: Difficulty[] = DIFFS, layouts: LayoutId[] = LAYOUTS, seedBase = 0, police = true, seedsProxy1 = seedsEq): Job[] {
  const jobs: Job[] = [];
  let id = 0;
  const push = (block: string, group: string, a: SlotSpec[], b: SlotSpec[], seeds: number): void => {
    for (const layout of layouts) {
      for (let k = 1; k <= seeds; k++) {
        // (a mirror pairing played from the other side is the very same match: use another seed)
        const mirror = JSON.stringify(a) === JSON.stringify(b);
        for (const aTeam of [0, 1] as TeamId[]) jobs.push({ id: id++, block, group, layout, seed: seedBase + 1000 * k + 17 + (mirror && aTeam === 1 ? 500 : 0), aTeam, a, b, police });
      }
    }
  };
  if (blocks.has('equal')) {
    for (const d of diffs) {
      for (let i = 0; i < PERS.length; i++) {
        for (let j = i; j < PERS.length; j++) push('equal', `${PERS[i]} vs ${PERS[j]} @${d}`, [s(PERS[i]!, d)], [s(PERS[j]!, d)], seedsEq);
      }
    }
  }
  if (blocks.has('ladder')) {
    for (const [hi, lo] of [
      ['challenge', 'novice'],
      ['normal', 'novice'],
      ['challenge', 'normal'],
    ] as [Difficulty, Difficulty][]) {
      for (const pa of PERS) for (const pb of PERS) push('ladder', `${hi} vs ${lo}`, [s(pa, hi)], [s(pb, lo)], seedsLadder);
    }
  }
  if (blocks.has('team')) {
    const comps: [RivalId, RivalId][] = [
      ['hodadak', 'hodadak'],
      ['tongkeun', 'tongkeun'],
      ['nunchi', 'nunchi'],
      ['hodadak', 'tongkeun'],
      ['tongkeun', 'nunchi'],
      ['hodadak', 'nunchi'],
    ];
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        const A = comps[i]!;
        const B = comps[j]!;
        push('team', `${A.join('+')} vs ${B.join('+')}`, [s(A[0], 'normal'), s(A[1], 'normal')], [s(B[0], 'normal'), s(B[1], 'normal')], seedsTeam);
      }
    }
  }
  if (blocks.has('proxy1v1')) {
    for (const p of PERS) push('proxy1v1', `proxy vs ${p}`, [s('hodadak', 'normal', true)], [s(p, 'normal')], seedsProxy1);
  }
  if (blocks.has('proxy')) {
    const opps: [RivalId, RivalId][] = [
      ['hodadak', 'tongkeun'],
      ['tongkeun', 'nunchi'],
      ['nunchi', 'hodadak'],
    ];
    for (const mate of PERS) {
      for (const o of opps) push('proxy', `proxy+${mate} vs ${o.join('+')}`, [s('hodadak', 'normal', true), s(mate, 'normal')], [s(o[0], 'normal'), s(o[1], 'normal')], seedsTeam);
    }
  }
  return jobs;
}

function runJob(j: Job): SeriesMatch {
  return runJobFun(j).match;
}

function runJobFun(j: Job): { match: SeriesMatch; fun?: FunRec } {
  const team0 = j.aTeam === 0 ? j.a : j.b;
  const team1 = j.aTeam === 0 ? j.b : j.a;
  const col = j.fun ? new FunCollector({ id: j.id, block: j.block, group: j.group, variant: j.fun.variant, layout: j.layout, seed: j.seed, aTeam: j.aTeam }) : null;
  const stats = runMatch({ layout: j.layout, team0, team1, seed: j.seed, timing: true, rules: { police: j.police, ...j.rules }, onTick: col ? col.onTick : undefined });
  const w = stats.result.winner;
  const match: SeriesMatch = {
    layout: j.layout,
    seed: j.seed,
    aTeam: j.aTeam,
    winner: w === null ? null : w === j.aTeam ? 'A' : 'B',
    scoreA: stats.teamScores[j.aTeam],
    scoreB: stats.teamScores[(1 - j.aTeam) as TeamId],
    stats,
  };
  return { match, fun: col ? col.finish(stats) : undefined };
}

/** Fun / content scorecard jobs (C11): blocks P, B, T2 per variant, police on, alternating sides. */
function buildFunJobs(variants: string[], layouts: LayoutId[], seedsP: number, seedsB: number, seedsT2: number, seedBase: number, firstId: number): Job[] {
  const jobs: Job[] = [];
  let id = firstId;
  const pairs: [RivalId, RivalId][] = [
    ['hodadak', 'tongkeun'],
    ['tongkeun', 'nunchi'],
    ['nunchi', 'hodadak'],
  ];
  const comps: [RivalId, RivalId][] = [
    ['hodadak', 'tongkeun'],
    ['tongkeun', 'nunchi'],
    ['nunchi', 'hodadak'],
  ];
  for (const v of variants) {
    const rules = parseVariant(v);
    const fun = (label: string): Job['fun'] => ({ variant: v, label });
    for (const layout of layouts)
      for (const r of PERS)
        for (let k = 1; k <= seedsP; k++) {
          const seed = seedBase + k;
          jobs.push({ id: id++, block: 'P', group: `proxy vs ${r}`, layout, seed, aTeam: (seed % 2) as TeamId, a: [s('hodadak', 'normal', true)], b: [s(r, 'normal')], police: true, rules, fun: fun(`proxy vs ${r}`) });
        }
    for (const layout of layouts)
      for (const [x, y] of pairs)
        for (let k = 1; k <= seedsB; k++) {
          const seed = seedBase + k + 100;
          jobs.push({ id: id++, block: 'B', group: `${x} vs ${y}`, layout, seed, aTeam: (k % 2) as TeamId, a: [s(x, 'normal')], b: [s(y, 'normal')], police: true, rules, fun: fun(`${x} vs ${y}`) });
        }
    for (const layout of layouts)
      for (let k = 1; k <= seedsT2; k++) {
        const seed = seedBase + k + 200;
        const A = comps[k % 3]!;
        const B = comps[(k + 1) % 3]!;
        jobs.push({ id: id++, block: 'T2', group: `${A.join('+')} vs ${B.join('+')}`, layout, seed, aTeam: (k % 2) as TeamId, a: [s(A[0], 'normal'), s(A[1], 'normal')], b: [s(B[0], 'normal'), s(B[1], 'normal')], police: true, rules, fun: fun('2v2') });
      }
  }
  return jobs;
}

/** Variant label -> rules: `classic`, `v2`, `v2:items=off,events=off,gimmicks=false`. */
function parseVariant(v: string): Partial<RuleConfig> {
  const [content, rest] = v.split(':');
  if (content !== 'classic' && content !== 'v2') throw new Error(`unknown content variant "${v}"`);
  const rules: Partial<RuleConfig> = { content };
  for (const kv of (rest ?? '').split(',').filter(Boolean)) {
    const [k, val] = kv.split('=');
    if (k === 'items' && (val === 'off' || val === 'hammerOnly' || val === 'on')) rules.items = val;
    else if (k === 'events' && (val === 'off' || val === 'on')) rules.events = val;
    else if (k === 'gimmicks' && (val === 'true' || val === 'false')) rules.gimmicks = val === 'true';
    else throw new Error(`unknown variant rule "${kv}" in "${v}"`);
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Worker mode: read jobs (JSON) from argv file, write one JSON line per result.
// ---------------------------------------------------------------------------

async function worker(jobsJson: string): Promise<void> {
  const jobs = JSON.parse(jobsJson) as Job[];
  for (const j of jobs) {
    if (j.fun) {
      // fun jobs: a crash is a scorecard number (content-plan §8 "0 crashes"), not a dead worker
      let r: { match: SeriesMatch; fun?: FunRec } | null = null;
      let err: string | null = null;
      try {
        r = runJobFun(j);
      } catch (e) {
        err = String((e as Error)?.stack ?? e);
      }
      if (r) {
        r.match.stats.finalLog = r.match.stats.finalLog.slice(0, 6);
        r.match.stats.slots.forEach((x) => ((x.incidents = x.incidents.slice(0, 3)), (x.idleIncidents = [])));
        process.stdout.write(JSON.stringify({ id: j.id, match: r.match, fun: r.fun } satisfies JobResult) + '\n');
      } else {
        const fun = { id: j.id, block: j.block, group: j.group, variant: j.fun.variant, layout: j.layout, seed: j.seed, aTeam: j.aTeam, error: err } as unknown as FunRec;
        process.stdout.write(JSON.stringify({ id: j.id, match: null as unknown as SeriesMatch, fun } satisfies JobResult) + '\n');
      }
      continue;
    }
    const m = runJob(j);
    // drop bulky logs
    m.stats.finalLog = m.stats.finalLog.slice(0, 6);
    process.stdout.write(JSON.stringify({ id: j.id, match: m } satisfies JobResult) + '\n');
  }
}

function runWorkers(jobs: Job[], workers: number, onProgress: (done: number) => void, onFun?: (r: FunRec) => void): Promise<Map<number, SeriesMatch>> {
  const chunks: Job[][] = Array.from({ length: workers }, () => []);
  // interleave so heavy blocks spread across workers
  jobs.forEach((j, i) => chunks[i % workers]!.push(j));
  const results = new Map<number, SeriesMatch>();
  let done = 0;
  const self = resolve(process.argv[1]!);
  return new Promise((res, rej) => {
    let alive = 0;
    for (const chunk of chunks) {
      if (!chunk.length) continue;
      alive++;
      const tmp = join(tmpdir(), `balance-jobs-${process.pid}-${alive}.json`);
      writeFileSync(tmp, JSON.stringify(chunk));
      const tune = process.argv.indexOf('--tune');
      const extra = tune >= 0 ? ['--tune', process.argv[tune + 1]!] : [];
      const child = spawn(process.execPath, [...process.execArgv, self, '--worker', tmp, ...extra], { stdio: ['ignore', 'pipe', 'inherit'] });
      let buf = '';
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const r = JSON.parse(line) as JobResult;
          if (r.match) results.set(r.id, r.match);
          if (r.fun) onFun?.(r.fun);
          done++;
          onProgress(done);
        }
      });
      child.on('exit', (code) => {
        try {
          unlinkSync(tmp);
        } catch {
          /* already gone */
        }
        if (code !== 0) rej(new Error(`worker exited with ${code}`));
        if (--alive === 0) res(results);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pct(x: number, n: number): string {
  return n ? `${((100 * x) / n).toFixed(0)}%` : '-';
}

function table(rows: string[][]): string {
  const head = rows[0]!;
  const out = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows.slice(1)) out.push(`| ${r.join(' | ')} |`);
  return out.join('\n');
}

function perBotRows(agg: SeriesAggregate): string[][] {
  const rows: string[][] = [['bot', 'pts/match', 'small', 'large', 'bank (whole)', 'strips', 'steals', 'KOs', 'dashes', 'boosts', 'stuck s', 'max stuck s', 'stuck>5s', 'idle s', 'idle>6s', 'passive s (not ahead)', 'unstuck', 'scored', 'first score']];
  for (const a of Object.values(agg.byKey).sort((x, y) => (x.key < y.key ? -1 : 1))) {
    const n = Math.max(1, a.bots);
    rows.push([
      a.key,
      (a.points / n).toFixed(0),
      (a.small / n).toFixed(2),
      (a.large / n).toFixed(2),
      `${(a.bank / n).toFixed(2)} (${(a.banksWhole / n).toFixed(2)})`,
      (a.strips / n).toFixed(2),
      (a.steals / n).toFixed(2),
      (a.knockdowns / n).toFixed(2),
      (a.dashes / n).toFixed(2),
      (a.boosts / n).toFixed(2),
      (a.stuckSeconds / n).toFixed(2),
      a.maxStuck.toFixed(1),
      String(a.stuck5),
      (a.idleSeconds / n).toFixed(1),
      String(a.idle6),
      `${(a.passive / n).toFixed(1)} (${(a.passiveBehind / n).toFixed(1)})`,
      (a.unstuck / n).toFixed(2),
      pct(a.scoredMatches, a.bots),
      a.firstScoreN ? `${(a.firstScoreSum / a.firstScoreN).toFixed(1)} s` : '-',
    ]);
  }
  return rows;
}

export /** Wilson score interval (95 %) for k successes in n trials. */
function wilson(k: number, n: number): [number, number] {
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function buildReport(jobs: Job[], results: Map<number, SeriesMatch>, elapsed: number, workersUsed = 3): { md: string; checks: Record<string, boolean | string> } {
  const L: string[] = [];
  const all: SeriesMatch[] = [];
  const byGroup = new Map<string, { block: string; ms: SeriesMatch[] }>();
  for (const j of jobs) {
    const m = results.get(j.id);
    if (!m) continue;
    all.push(m);
    const g = byGroup.get(`${j.block}|${j.group}`) ?? { block: j.block, ms: [] };
    g.ms.push(m);
    byGroup.set(`${j.block}|${j.group}`, g);
  }
  const total = aggregate(all);
  const checks: Record<string, boolean | string> = {};
  L.push('# Bot balance report (뿌리째 털어라)');
  L.push('');
  L.push(`Matches: ${all.length} · seeds ${[...new Set(jobs.map((j) => j.seed))].sort((a, b) => a - b).join(', ')} · wall time ${(elapsed / 1000).toFixed(0)} s · invariant violations (scores + remaining = total, checked every tick): **${total.invariantViolations}**`);
  L.push('');
  L.push(`Bot CPU (${workersUsed} parallel worker processes, so wall-clock maxima include scheduling noise): avg **${total.botMsAvg.toFixed(3)} ms** per bot per tick (budget 0.3), max single update ${total.botMsMax.toFixed(1)} ms (after a 2 s warm-up ${total.botMsMaxWarm.toFixed(1)} ms; ${(total.botSlowShare * 100).toFixed(3)}% of updates > 2 ms). Stuck > 5 s incidents (all bots, all matches): **${total.stuck5}** (by the previous, looser definition — 0.75 m moves and declared waiting reset the window: ${total.stuck5Loose}). Final-30-s re-plans logged: ${total.finalReplans}.`);
  L.push('');
  L.push(`Stuck metric: a window with no meaningful progress (no move > 1.25 m, no strain, held object not moved > 1.25 m, no recovery dwell) longer than 5 s that was not >= 80 % declared waiting. Declared-waiting windows > 6 s (guarding a door, ambush watch, escort, two-bank yield): **${total.idle6}**. Seconds per bot per match in the fallback guard/idle goals while loot was left and the own team was tied or behind: **${total.passiveBehindPerBot.toFixed(2)} s**.`);
  {
    const lens = (filter: (j: Job) => boolean): string => {
      const v = jobs.filter((j) => filter(j) && results.has(j.id)).map((j) => results.get(j.id)!.stats.ticks / 60).sort((a, b) => a - b);
      if (!v.length) return '-';
      return `median ${v[Math.floor(v.length / 2)]!.toFixed(0)} s (p10 ${v[Math.floor(v.length * 0.1)]!.toFixed(0)}, p90 ${v[Math.floor(v.length * 0.9)]!.toFixed(0)})`;
    };
    L.push('');
    L.push('Match length (the match ends 30 s after the second bank recovery, or at 4:00):');
    L.push('');
    for (const layout of LAYOUTS) {
      L.push(`- ${layout}: 1v1 ${lens((j) => j.layout === layout && j.a.length === 1)}; 2v2 ${lens((j) => j.layout === layout && j.a.length === 2)}`);
    }
  }
  {
    L.push('');
    L.push(`Match flow and police (police ${jobs[0]?.police ? 'ON' : 'off'}). FC = final countdown (both banks recovered). Bank haul broken = forced release of an uprooted bank's wall; stuck>5s = strict no-progress windows (all characters):`);
    L.push('');
    const rows: string[][] = [FLOW_HEADER];
    const blocksSeen = [...new Set(jobs.map((j) => j.block))];
    for (const b of blocksSeen) {
      const bj = jobs.filter((j) => j.block === b && results.has(j.id));
      if (!bj.length) continue;
      rows.push(flowRow(`**${b}** (all)`, flowMetrics(bj.map((j) => results.get(j.id)!))));
      for (const layout of LAYOUTS) {
        const lj = bj.filter((j) => j.layout === layout);
        if (lj.length) rows.push(flowRow(`${b} ${layout}`, flowMetrics(lj.map((j) => results.get(j.id)!))));
      }
      if (b === 'equal') {
        for (const d of DIFFS) {
          const dj = bj.filter((j) => j.a[0]!.difficulty === d);
          if (dj.length) rows.push(flowRow(`equal @${d}`, flowMetrics(dj.map((j) => results.get(j.id)!))));
        }
      }
      if (b === 'proxy1v1') {
        for (const p of PERS) {
          const pj = bj.filter((j) => j.b[0]!.personality === p);
          if (pj.length) rows.push(flowRow(`proxy vs ${p}`, flowMetrics(pj.map((j) => results.get(j.id)!))));
        }
      }
    }
    L.push(table(rows));
    const p1 = jobs.filter((j) => j.block === 'proxy1v1' && results.has(j.id));
    if (p1.length) {
      const f = flowMetrics(p1.map((j) => results.get(j.id)!));
      checks['proxy-vs-bot draws <10%'] = f.drawRate < 0.1;
      const won = p1.filter((j) => results.get(j.id)!.winner === 'A').length;
      L.push('');
      L.push(`Human proxy vs bot (normal, 1v1): proxy won ${pct(won, p1.length)}, draws ${pct(f.draws, f.matches)}.`);
    }
    const eqj = jobs.filter((j) => j.block === 'equal' && results.has(j.id));
    if (eqj.length) {
      const f = flowMetrics(eqj.map((j) => results.get(j.id)!));
      checks['1v1 median length 150-220 s'] = f.lenMedian >= 150 && f.lenMedian <= 220;
      checks['1v1 FC before 120 s in < 50% of matches'] = f.fcBefore120 < 0.5;
    }
    checks['no permanently stuck human proxy (max stuck < 30 s)'] = flowMetrics(all).proxyMaxStuck < 30;
  }
  checks['invariant'] = total.invariantViolations === 0;
  checks['cpu<0.3ms'] = total.botMsAvg < 0.3;
  checks['stuck>5s==0'] = total.stuck5 === 0;
  checks['final30 re-plans logged'] = total.finalReplans > 0;
  L.push('');

  // --- equal difficulty ---
  const eq = all.filter((_, i) => jobs[i] && jobs[i]!.block === 'equal');
  const eqJobs = jobs.filter((j) => j.block === 'equal' && results.has(j.id));
  if (eqJobs.length) {
    const ms = eqJobs.map((j) => results.get(j.id)!);
    const ag = aggregate(ms);
    L.push('## 1v1, equal difficulty');
    L.push('');
    L.push(`Draws ${ag.draws}/${ag.matches} (**${pct(ag.draws, ag.matches)}**, target < 10%). Side fairness: team 0 won ${pct(ag.team0Wins, ag.matches - ag.draws)} of decided games (target 40–60%).`);
    const decided = ag.matches - ag.draws;
    checks['draws<10%'] = ag.draws / Math.max(1, ag.matches) < 0.1;
    checks['side 40-60%'] = decided > 0 && ag.team0Wins / decided >= 0.4 && ag.team0Wins / decided <= 0.6;
    L.push('');
    // Subgroup side fairness with its sampling uncertainty: a few seeds per difficulty / layout
    // swing far beyond the 40-60 % band between seed sets, so a subgroup only counts as fair (or
    // unfair) when its 95 % interval says so; otherwise it is "not established".
    {
      const sub: string[][] = [['subgroup', 'decided', 'team0 wins', '95% CI', 'verdict']];
      const add = (label: string, js: Job[]): void => {
        const a = aggregate(js.map((j) => results.get(j.id)!));
        const n = a.matches - a.draws;
        if (n === 0) return;
        const [lo, hi] = wilson(a.team0Wins, n);
        const verdict = lo >= 0.4 && hi <= 0.6 ? 'within 40-60 %' : hi < 0.4 || lo > 0.6 ? '**outside 40-60 %**' : 'not established (n too small)';
        sub.push([label, String(n), pct(a.team0Wins, n), `${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)} %`, verdict]);
      };
      add('all', eqJobs);
      for (const d of DIFFS) add(`@${d}`, eqJobs.filter((j) => j.group.endsWith(`@${d}`)));
      for (const l of LAYOUTS) add(l, eqJobs.filter((j) => j.layout === l));
      L.push('Side fairness by subgroup (team 0 share of decided games, Wilson 95 % interval):');
      L.push('');
      L.push(table(sub));
      L.push('');
    }
    const rows: string[][] = [['pairing', 'matches', 'A wins', 'B wins', 'draws', 'avg A–B', 'team0 wins', 'end reasons']];
    let worst = 0;
    for (const [key, g] of byGroup) {
      if (g.block !== 'equal') continue;
      const a = aggregate(g.ms);
      const name = key.split('|')[1]!;
      const dec = a.matches - a.draws;
      const mirror = name.split(' vs ')[0] === name.split(' vs ')[1]!.split(' @')[0];
      if (!mirror && dec > 0) worst = Math.max(worst, a.aWins / dec, a.bWins / dec);
      rows.push([name, String(a.matches), pct(a.aWins, a.matches), pct(a.bWins, a.matches), pct(a.draws, a.matches), `${a.avgScoreA.toFixed(0)}–${a.avgScoreB.toFixed(0)}`, pct(a.team0Wins, dec), Object.entries(a.reasons).map(([k, v]) => `${k} ${v}`).join(', ')]);
    }
    L.push(`Worst single pairing at one difficulty (decided games): ${(worst * 100).toFixed(0)}% (info).`);
    L.push('');
    L.push(table(rows));
    L.push('');
    // aggregate personality vs personality across difficulties
    const pp: string[][] = [['A \\ B', ...PERS]];
    for (const pa of PERS) {
      const row: string[] = [pa];
      for (const pb of PERS) {
        let w = 0;
        let n = 0;
        for (const j of eqJobs) {
          const m = results.get(j.id)!;
          const A = j.a[0]!.personality;
          const B = j.b[0]!.personality;
          if (A === pa && B === pb) {
            n++;
            if (m.winner === 'A') w++;
            else if (m.winner === null) w += 0.5;
          } else if (A === pb && B === pa) {
            n++;
            if (m.winner === 'B') w++;
            else if (m.winner === null) w += 0.5;
          }
        }
        row.push(pa === pb ? `(${n})` : `${pct(w, n)} (${n})`);
      }
      pp.push(row);
    }
    let worstAgg = 0;
    for (const r of pp.slice(1)) for (const cell of r.slice(1)) {
      const m = /^(\d+)%/.exec(cell);
      if (m) worstAgg = Math.max(worstAgg, Number(m[1]) / 100);
    }
    checks['no personality >80% vs another at equal difficulty (aggregate)'] = worstAgg <= 0.8;
    L.push('Aggregate win share of the row personality against the column personality (all difficulties, draws = ½):');
    L.push('');
    L.push(table(pp));
    L.push('');
    L.push('Per-bot behavior (equal-difficulty 1v1):');
    L.push('');
    const byP = aggregate(ms);
    // merge A/B keys per personality+difficulty
    L.push(table(perBotRows(byP)));
    L.push('');
    // personality distinctness
    const sum: Record<string, { small: number; bankWhole: number; steals: number; kos: number; n: number }> = {};
    for (const a of Object.values(byP.byKey)) {
      const p = a.key.split(':')[1]!.split('/')[0]!;
      const t = (sum[p] ??= { small: 0, bankWhole: 0, steals: 0, kos: 0, n: 0 });
      t.small += a.small;
      t.bankWhole += a.banksWhole;
      t.steals += a.steals;
      t.kos += a.knockdowns;
      t.n += a.bots;
    }
    const dist: string[][] = [['personality', 'small-safe recoveries/match', 'whole-bank recoveries/match', 'steals/match', 'knockdowns/match']];
    for (const p of PERS) {
      const t = sum[p];
      if (!t) continue;
      dist.push([p, (t.small / t.n).toFixed(2), (t.bankWhole / t.n).toFixed(2), (t.steals / t.n).toFixed(2), (t.kos / t.n).toFixed(2)]);
    }
    L.push('Personality signatures:');
    L.push('');
    L.push(table(dist));
    L.push('');
    const r = (p: string, k: 'small' | 'bankWhole' | 'steals' | 'kos'): number => (sum[p] ? sum[p]![k] / sum[p]!.n : 0);
    checks['hodadak most small'] = r('hodadak', 'small') > r('tongkeun', 'small') && r('hodadak', 'small') > r('nunchi', 'small');
    checks['tongkeun most whole banks'] = r('tongkeun', 'bankWhole') > r('hodadak', 'bankWhole') && r('tongkeun', 'bankWhole') > r('nunchi', 'bankWhole');
    checks['nunchi most steals+KOs'] = r('nunchi', 'steals') + r('nunchi', 'kos') > r('hodadak', 'steals') + r('hodadak', 'kos') && r('nunchi', 'steals') + r('nunchi', 'kos') > r('tongkeun', 'steals') + r('tongkeun', 'kos');
    // every bot scores in every layout
    let scoredAll = true;
    for (const layout of LAYOUTS) {
      for (const p of PERS) {
        const slots = eqJobs
          .filter((j) => j.layout === layout)
          .flatMap((j) => results.get(j.id)!.stats.slots.filter((x) => x.personality === p && !x.humanProxy));
        const zero = slots.filter((x) => x.points === 0).length;
        if (slots.length && zero > 0) scoredAll = false;
        if (zero) L.push(`- ${p} scored 0 in ${zero}/${slots.length} games on ${layout}`);
      }
    }
    checks['every bot scores in every layout'] = scoredAll;
    L.push('');
    void eq;
  }

  // --- difficulty ladder ---
  const ladder = jobs.filter((j) => j.block === 'ladder' && results.has(j.id));
  if (ladder.length) {
    L.push('## Difficulty ladder (1v1, all personality pairings, both sides)');
    L.push('');
    const rows: string[][] = [['pairing', 'matches', 'stronger wins', 'weaker wins', 'draws', 'avg score strong–weak']];
    for (const [key, g] of byGroup) {
      if (g.block !== 'ladder') continue;
      const a = aggregate(g.ms);
      const name = key.split('|')[1]!;
      rows.push([name, String(a.matches), pct(a.aWins, a.matches), pct(a.bWins, a.matches), pct(a.draws, a.matches), `${a.avgScoreA.toFixed(0)}–${a.avgScoreB.toFixed(0)}`]);
      const dec = a.matches;
      if (name === 'challenge vs novice') checks['challenge beats novice >75%'] = a.aWins / dec > 0.75;
      if (name === 'normal vs novice') checks['normal beats novice >60%'] = a.aWins / dec > 0.6;
    }
    L.push(table(rows));
    L.push('');
  }

  // --- 2v2 bot teams ---
  const team = jobs.filter((j) => j.block === 'team' && results.has(j.id));
  if (team.length) {
    const ms = team.map((j) => results.get(j.id)!);
    const ag = aggregate(ms);
    L.push('## 2v2 bot teams (normal)');
    L.push('');
    L.push(`Draws ${pct(ag.draws, ag.matches)}; team 0 won ${pct(ag.team0Wins, ag.matches - ag.draws)} of decided games.`);
    L.push('');
    const rows: string[][] = [['pairing', 'matches', 'A wins', 'B wins', 'draws', 'avg A–B']];
    for (const [key, g] of byGroup) {
      if (g.block !== 'team') continue;
      const a = aggregate(g.ms);
      rows.push([key.split('|')[1]!, String(a.matches), pct(a.aWins, a.matches), pct(a.bWins, a.matches), pct(a.draws, a.matches), `${a.avgScoreA.toFixed(0)}–${a.avgScoreB.toFixed(0)}`]);
    }
    L.push(table(rows));
    L.push('');
    L.push(table(perBotRows(ag)));
    L.push('');
  }

  // --- human proxy ---
  const proxy = jobs.filter((j) => j.block === 'proxy' && results.has(j.id));
  if (proxy.length) {
    const ms = proxy.map((j) => results.get(j.id)!);
    const ag = aggregate(ms);
    L.push('## 2v2 human proxy + bot teammate vs 2 bots (normal)');
    L.push('');
    L.push(`The human slot is a scripted proxy (isBot=false, private sight, no team claims). Teammate share of the proxy team's points: **${((ag.teammateShare ?? 0) * 100).toFixed(1)}%** (target ≥ 30%). Proxy team won ${pct(ag.aWins, ag.matches)}, draws ${pct(ag.draws, ag.matches)}.`);
    checks['teammate share >=30%'] = (ag.teammateShare ?? 0) >= 0.3;
    L.push('');
    const rows: string[][] = [['pairing', 'matches', 'proxy team wins', 'draws', 'avg', 'teammate share']];
    for (const [key, g] of byGroup) {
      if (g.block !== 'proxy') continue;
      const a = aggregate(g.ms);
      rows.push([key.split('|')[1]!, String(a.matches), pct(a.aWins, a.matches), pct(a.draws, a.matches), `${a.avgScoreA.toFixed(0)}–${a.avgScoreB.toFixed(0)}`, `${((a.teammateShare ?? 0) * 100).toFixed(0)}%`]);
    }
    L.push(table(rows));
    L.push('');
    L.push(table(perBotRows(ag)));
    L.push('');
  }

  // stuck incidents (all) and long declared waits (sample)
  const inc: string[] = [];
  const idl: string[] = [];
  for (const j of jobs) {
    const m = results.get(j.id);
    if (!m) continue;
    const who = (slot: number): string => {
      const sl = m.stats.slots[slot]!;
      return `${sl.humanProxy ? 'proxy' : `${sl.personality}:${sl.difficulty}`} (slot ${slot})`;
    };
    for (const sl of m.stats.slots) {
      for (const x of sl.incidents) inc.push(`${j.layout} seed ${j.seed} ${j.block} "${j.group}" A=team ${j.aTeam}: ${who(sl.slot)} ${x.dur} s at ${(x.tick / 60).toFixed(1)} s, ${x.what} @(${x.x}, ${x.y})`);
      for (const x of sl.idleIncidents) idl.push(`${j.layout} seed ${j.seed} "${j.group}": ${who(sl.slot)} ${x.dur} s at ${(x.tick / 60).toFixed(1)} s, ${x.what} @(${x.x}, ${x.y})`);
    }
  }
  if (inc.length) {
    L.push('## Stuck > 5 s incidents');
    L.push('');
    for (const x of inc) L.push(`- ${x}`);
    L.push('');
  }
  if (idl.length) {
    L.push('## Declared waits > 6 s (sample)');
    L.push('');
    for (const x of idl.slice(0, 30)) L.push(`- ${x}`);
    L.push('');
  }

  // final-30-s log samples
  const finals = all.flatMap((m) => m.stats.finalLog.map((l) => `${m.layout} seed ${m.seed}: [${(l.tick / 60).toFixed(1)} s] slot ${l.slot} ${l.msg}`)).slice(0, 12);
  if (finals.length) {
    L.push('## Final-30-s re-plan log (sample)');
    L.push('');
    for (const f of finals) L.push(`- ${f}`);
    L.push('');
  }
  L.push('## Acceptance checks');
  L.push('');
  for (const [k, v] of Object.entries(checks)) L.push(`- [${v === true ? 'x' : ' '}] ${k}${typeof v === 'string' ? ` (${v})` : ''}`);
  L.push('');
  return { md: L.join('\n'), checks };
}

/**
 * Experiment knobs: `--tune key=value,...`. `police.<key>`, `coins.<key>`, `items.<path>`,
 * `events.<path>` set config values (dotted paths into the C11-tuned blocks; `a/b/c` = a number
 * list), any other key is a BOT_TUNING field. Applied in every worker before any match is built.
 */
function applyTune(spec: string): void {
  const roots: Record<string, Record<string, unknown>> = {
    police: POLICE as unknown as Record<string, unknown>,
    coins: COINS as unknown as Record<string, unknown>,
    items: ITEMS as unknown as Record<string, unknown>,
    events: EVENTS as unknown as Record<string, unknown>,
  };
  for (const kv of spec.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!k || v === undefined) continue;
    const parts = k.split('.');
    const root = roots[parts[0]!];
    if (root && parts.length >= 2) {
      let o = root;
      for (const p of parts.slice(1, -1)) {
        const next = o[p];
        if (typeof next !== 'object' || next === null) throw new Error(`unknown knob ${k}`);
        o = next as Record<string, unknown>;
      }
      const key = parts[parts.length - 1]!;
      if (!(key in o)) throw new Error(`unknown knob ${k}`);
      o[key] = v.includes('/') ? v.split('/').map(Number) : Number(v);
    } else {
      if (!(k in BOT_TUNING)) throw new Error(`unknown bot knob ${k}`);
      BOT_TUNING[k as keyof typeof BOT_TUNING] = Number(v);
    }
  }
}

async function main(argv: string[]): Promise<void> {
  // experiment knobs (bot tuning / config overrides): --tune key=value,key=value
  const ti = argv.indexOf('--tune');
  if (ti >= 0) applyTune(argv[ti + 1] ?? '');
  const wi = argv.indexOf('--worker');
  if (wi >= 0) {
    const { readFileSync } = await import('node:fs');
    await worker(readFileSync(argv[wi + 1]!, 'utf8'));
    return;
  }
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const quick = argv.includes('--quick');
  const fun = argv.includes('--fun');
  const content = argv.includes('--content');
  const out = get('out') ?? DEFAULT_OUT;
  const funFrom = get('fun-from');
  if (funFrom) {
    // report only, from saved FunRec lines
    const { readFileSync } = await import('node:fs');
    const recs: FunRec[] = [];
    // file[=label]: the label replaces the records' variant (compare runs of one variant, e.g. a lever)
    for (const spec of funFrom.split(',')) {
      const [f, label] = spec.split('=');
      for (const l of readFileSync(f!, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        const r = JSON.parse(l) as FunRec;
        if (label) r.variant = label;
        recs.push(r);
      }
    }
    const md = `# Fun / content scorecard (뿌리째 털어라)\n\nFrom ${funFrom}.\n\n${funReport(recs, { content, ref: get('fun-ref') })}`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md);
    console.log(md);
    console.log(`\nwritten ${out}`);
    return;
  }
  const blocks = new Set((get('blocks') ?? (fun ? '' : 'equal,ladder,team,proxy,proxy1v1')).split(',').filter(Boolean));
  const seeds = Number(get('seeds') ?? (quick ? 1 : 3));
  const diffs = (get('diffs')?.split(',') ?? DIFFS) as Difficulty[];
  const layouts = (get('layouts')?.split(',') ?? LAYOUTS) as LayoutId[];
  const seedBase = Number(get('seed-base') ?? 0);
  const police = get('police') !== 'off';
  const jobs = buildJobs(blocks, seeds, Math.max(1, Math.round(seeds / 2)), Math.max(1, Math.round(seeds / 2)), diffs, layouts, seedBase, police, Number(get('seeds-proxy1') ?? seeds * 2));
  let funJobs: Job[] = [];
  if (fun) {
    const variants = (get('variants') ?? (content ? 'v2' : 'classic')).split(/\s+/).filter(Boolean);
    // n >= 300 per block (content-plan §7 single-lever rule): seeds per (layout, rival)
    const seedsP = Number(get('fun-seeds') ?? (quick ? 2 : Math.ceil(300 / (layouts.length * PERS.length))));
    const seedsB = Number(get('fun-seeds-b') ?? seedsP);
    const seedsT2 = Number(get('fun-seeds-t2') ?? (quick ? 1 : 10));
    const fb = new Set((get('fun-blocks') ?? 'P,B,T2').split(','));
    funJobs = buildFunJobs(variants, layouts, fb.has('P') ? seedsP : 0, fb.has('B') ? seedsB : 0, fb.has('T2') ? seedsT2 : 0, seedBase, jobs.length);
  }
  const allJobs = [...jobs, ...funJobs];
  const workers = Number(get('workers') ?? 3);
  const t0 = Date.now();
  process.stderr.write(`balance-report: ${allJobs.length} matches on ${workers} workers${fun ? ` (${funJobs.length} fun-scorecard)` : ''}\n`);
  let last = 0;
  const funRecs: FunRec[] = [];
  const funJson = get('fun-json');
  if (funJson) writeFileSync(funJson, '');
  const results = await runWorkers(
    allJobs,
    workers,
    (done) => {
      if (done - last >= 20 || done === allJobs.length) {
        last = done;
        process.stderr.write(`  ${done}/${allJobs.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
      }
    },
    (r) => {
      funRecs.push(r);
      if (funJson) appendFileSync(funJson, JSON.stringify(r) + '\n');
    },
  );
  const parts: string[] = [];
  let checks: Record<string, boolean | string> = {};
  if (jobs.length) {
    const rep = buildReport(jobs, results, Date.now() - t0, workers);
    parts.push(rep.md);
    checks = rep.checks;
  }
  if (fun) {
    const tune = get('tune');
    const head = [
      '# Fun / content scorecard (뿌리째 털어라)',
      '',
      `${new Date().toISOString()} · ${funJobs.length} matches · wall time ${((Date.now() - t0) / 1000).toFixed(0)} s on ${workers} workers · police on · seeds base ${seedBase}${tune ? ` · tune \`${tune}\`` : ''}`,
      `Config: police dispatch ${(POLICE.dispatchDelayTicks / 60).toFixed(0)} s · bankPoliceDrag ${BOT_TUNING.bankPoliceDrag} · waveDefer ${BOT_TUNING.waveDefer} · bagCap ${COINS.bagCap} · spill ${COINS.spillFraction} · hammer KD ${ITEMS.hammer.knockdownTicks} ticks · drops ${ITEMS.drop.pairs.join('/')} + axis ${ITEMS.drop.center.join('/')} s`,
      '',
    ].join('\n');
    parts.unshift(head + funReport(funRecs, { content, ref: get('fun-ref') }));
  }
  const md = parts.join('\n\n');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  const jsonOut = get('json');
  if (jsonOut) {
    // per-match records for offline analysis (draw causes, outliers)
    const rows = jobs.filter((j) => results.has(j.id)).map((j) => {
      const m = results.get(j.id)!;
      const st = m.stats;
      return { block: j.block, group: j.group, layout: j.layout, seed: j.seed, aTeam: j.aTeam, winner: m.winner, scoreA: m.scoreA, scoreB: m.scoreB, reason: st.result.reason, ticks: st.ticks, firstBankTick: st.firstBankTick, secondBankTick: st.secondBankTick, firstBank: st.firstBank, fcTick: st.finalCountdownTick, police: st.police, pointsBy: st.pointsBy, slots: st.slots.map((x) => ({ slot: x.slot, team: x.team, p: x.personality, d: x.difficulty, proxy: x.humanProxy, points: x.points, rec: x.recoveries, stuck5: x.stuckIncidents5s, incidents: x.incidents, tackled: x.tackledByPolice, stuns: x.policeStuns, unstuck: x.unstuckEvents })) };
    });
    writeFileSync(jsonOut, JSON.stringify(rows));
  }
  console.log(md);
  console.log(`\nwritten ${out}`);
  const failed = Object.entries(checks).filter(([, v]) => v !== true);
  if (failed.length) console.log(`checks not met: ${failed.map(([k]) => k).join('; ')}`);
}

void main(process.argv.slice(2));
