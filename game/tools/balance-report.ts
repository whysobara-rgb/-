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
 *
 * Default output: <os tmpdir>/balance-report.md (path printed at the end).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { aggregate, runMatch, type SeriesMatch, type SlotSpec, type SeriesAggregate } from '../src/ai/harness';
import type { Difficulty, RivalId } from '../src/ai/types';
import type { LayoutId, TeamId } from '../src/sim/types';

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
}

interface JobResult {
  id: number;
  match: SeriesMatch;
}

function s(p: RivalId, d: Difficulty, proxy = false): SlotSpec {
  return { personality: p, difficulty: d, humanProxy: proxy };
}

function buildJobs(blocks: Set<string>, seedsEq: number, seedsLadder: number, seedsTeam: number, diffs: Difficulty[] = DIFFS, layouts: LayoutId[] = LAYOUTS, seedBase = 0): Job[] {
  const jobs: Job[] = [];
  let id = 0;
  const push = (block: string, group: string, a: SlotSpec[], b: SlotSpec[], seeds: number): void => {
    for (const layout of layouts) {
      for (let k = 1; k <= seeds; k++) {
        // (a mirror pairing played from the other side is the very same match: use another seed)
        const mirror = JSON.stringify(a) === JSON.stringify(b);
        for (const aTeam of [0, 1] as TeamId[]) jobs.push({ id: id++, block, group, layout, seed: seedBase + 1000 * k + 17 + (mirror && aTeam === 1 ? 500 : 0), aTeam, a, b });
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
  const team0 = j.aTeam === 0 ? j.a : j.b;
  const team1 = j.aTeam === 0 ? j.b : j.a;
  const stats = runMatch({ layout: j.layout, team0, team1, seed: j.seed, timing: true });
  const w = stats.result.winner;
  return {
    layout: j.layout,
    seed: j.seed,
    aTeam: j.aTeam,
    winner: w === null ? null : w === j.aTeam ? 'A' : 'B',
    scoreA: stats.teamScores[j.aTeam],
    scoreB: stats.teamScores[(1 - j.aTeam) as TeamId],
    stats,
  };
}

// ---------------------------------------------------------------------------
// Worker mode: read jobs (JSON) from argv file, write one JSON line per result.
// ---------------------------------------------------------------------------

async function worker(jobsJson: string): Promise<void> {
  const jobs = JSON.parse(jobsJson) as Job[];
  for (const j of jobs) {
    const m = runJob(j);
    // drop bulky logs
    m.stats.finalLog = m.stats.finalLog.slice(0, 6);
    process.stdout.write(JSON.stringify({ id: j.id, match: m } satisfies JobResult) + '\n');
  }
}

function runWorkers(jobs: Job[], workers: number, onProgress: (done: number) => void): Promise<Map<number, SeriesMatch>> {
  const chunks: Job[][] = Array.from({ length: workers }, () => []);
  // interleave so heavy blocks spread across workers
  jobs.forEach((j, i) => chunks[i % workers]!.push(j));
  const results = new Map<number, SeriesMatch>();
  const self = resolve(process.argv[1]!);
  return new Promise((res, rej) => {
    let alive = 0;
    for (const chunk of chunks) {
      if (!chunk.length) continue;
      alive++;
      const tmp = join(tmpdir(), `balance-jobs-${process.pid}-${alive}.json`);
      writeFileSync(tmp, JSON.stringify(chunk));
      const child = spawn(process.execPath, [...process.execArgv, self, '--worker', tmp], { stdio: ['ignore', 'pipe', 'inherit'] });
      let buf = '';
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const r = JSON.parse(line) as JobResult;
          results.set(r.id, r.match);
          onProgress(results.size);
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

export function buildReport(jobs: Job[], results: Map<number, SeriesMatch>, elapsed: number, workersUsed = 3): { md: string; checks: Record<string, boolean | string> } {
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

async function main(argv: string[]): Promise<void> {
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
  const blocks = new Set((get('blocks') ?? 'equal,ladder,team,proxy').split(','));
  const seeds = Number(get('seeds') ?? (quick ? 1 : 3));
  const diffs = (get('diffs')?.split(',') ?? DIFFS) as Difficulty[];
  const layouts = (get('layouts')?.split(',') ?? LAYOUTS) as LayoutId[];
  const seedBase = Number(get('seed-base') ?? 0);
  const jobs = buildJobs(blocks, seeds, Math.max(1, Math.round(seeds / 2)), Math.max(1, Math.round(seeds / 2)), diffs, layouts, seedBase);
  const workers = Number(get('workers') ?? 3);
  const out = get('out') ?? DEFAULT_OUT;
  const t0 = Date.now();
  process.stderr.write(`balance-report: ${jobs.length} matches on ${workers} workers\n`);
  let last = 0;
  const results = await runWorkers(jobs, workers, (done) => {
    if (done - last >= 20 || done === jobs.length) {
      last = done;
      process.stderr.write(`  ${done}/${jobs.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
    }
  });
  const { md, checks } = buildReport(jobs, results, Date.now() - t0, workers);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.log(md);
  console.log(`\nwritten ${out}`);
  const failed = Object.entries(checks).filter(([, v]) => v !== true);
  if (failed.length) console.log(`checks not met: ${failed.map(([k]) => k).join('; ')}`);
}

void main(process.argv.slice(2));
