/**
 * Headless bot matches (doc §19 봇과 공정성).
 *
 *   npx tsx tools/headless-match.ts --layout plaza --a hodadak --b tongkeun --n 6 --swap
 *   npx tsx tools/headless-match.ts --mode 2v2 --a proxy,hodadak --b tongkeun,nunchi --diff normal
 *   npx tsx tools/headless-match.ts --layout all --a nunchi:challenge --b hodadak:novice --seeds 1-10
 *
 * Options
 *   --layout plaza|shortcut|counter|all   (default plaza)
 *   --mode 1v1|2v2                        (default 1v1; 2v2 duplicates single entries)
 *   --a / --b  comma list of members: <personality>[:<difficulty>] or 'proxy' (scripted human)
 *   --diff novice|normal|challenge        default difficulty (default normal)
 *   --n N | --seeds 1-10 | --seeds 3,7,9  (default --n 4)
 *   --swap                                also play every seed with sides swapped
 *   --quiet                               aggregate only
 *   --log                                 print the final-30-s re-plan log lines
 *
 * Checks the score invariant every tick (scores + remaining = total) and prints per-match and
 * aggregate stats; exits with code 1 on any invariant violation.
 */
import { aggregate, formatAggregate, runSeries, type SideSpec, type SlotSpec } from '../src/ai/harness';
import type { Difficulty, RivalId } from '../src/ai/types';
import type { LayoutId } from '../src/sim/types';

export interface CliOptions {
  layouts: LayoutId[];
  mode: '1v1' | '2v2';
  a: SideSpec;
  b: SideSpec;
  seeds: number[];
  swap: boolean;
  quiet: boolean;
  log: boolean;
}

const RIVAL_SET = new Set(['hodadak', 'tongkeun', 'nunchi']);
const DIFF_SET = new Set(['novice', 'normal', 'challenge']);

export function parseMember(tok: string, diff: Difficulty): SlotSpec {
  if (tok === 'proxy' || tok.startsWith('proxy:')) {
    const d = tok.split(':')[1];
    return { personality: 'hodadak', difficulty: (d && DIFF_SET.has(d) ? d : 'normal') as Difficulty, humanProxy: true };
  }
  const [p, d] = tok.split(':');
  if (!p || !RIVAL_SET.has(p)) throw new Error(`unknown personality "${tok}"`);
  if (d && !DIFF_SET.has(d)) throw new Error(`unknown difficulty "${d}"`);
  return { personality: p as RivalId, difficulty: (d ?? diff) as Difficulty };
}

function parseSeeds(s: string): number[] {
  if (s.includes('-')) {
    const [a, b] = s.split('-').map(Number);
    const out: number[] = [];
    for (let i = a!; i <= b!; i++) out.push(i);
    return out;
  }
  return s.split(',').map(Number);
}

export function parseArgs(argv: string[]): CliOptions {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const diff = (get('diff') ?? 'normal') as Difficulty;
  const mode = (get('mode') ?? '1v1') as '1v1' | '2v2';
  const lay = get('layout') ?? 'plaza';
  const layouts: LayoutId[] = lay === 'all' ? ['plaza', 'shortcut', 'counter'] : (lay.split(',') as LayoutId[]);
  const side = (s: string | undefined, def: string): SideSpec => {
    const members = (s ?? def).split(',').map((t) => parseMember(t.trim(), diff));
    if (mode === '2v2' && members.length === 1) members.push({ ...members[0]!, humanProxy: false });
    if (mode === '1v1' && members.length > 1) members.length = 1;
    return { members };
  };
  const seeds = get('seeds') ? parseSeeds(get('seeds')!) : Array.from({ length: Number(get('n') ?? 4) }, (_, i) => i + 1);
  return { layouts, mode, a: side(get('a'), 'hodadak'), b: side(get('b'), 'tongkeun'), seeds, swap: has('swap'), quiet: has('quiet'), log: has('log') };
}

function describe(s: SideSpec): string {
  return s.members.map((m) => (m.humanProxy ? 'proxy' : `${m.personality}:${m.difficulty}`)).join('+');
}

export function main(argv: string[]): number {
  const o = parseArgs(argv);
  const t0 = Date.now();
  const matches = runSeries({
    layouts: o.layouts,
    a: o.a,
    b: o.b,
    seeds: o.seeds,
    swap: o.swap,
    timing: true,
    onMatch: (m) => {
      if (o.quiet) return;
      const r = m.stats.result;
      const slots = m.stats.slots
        .map((s) => `${s.humanProxy ? 'proxy' : s.personality[0]}${s.team}:${s.points.toFixed(0)}(${s.recoveries.smallSafe.toFixed(0)}s${s.recoveries.largeSafe.toFixed(0)}L${s.recoveries.bank.toFixed(0)}B ko${s.knockdownsDealt} st${s.steals} stuck${s.maxStuck.toFixed(1)})`)
        .join(' ');
      console.log(
        `${m.layout.padEnd(8)} seed ${String(m.seed).padStart(3)} A=team${m.aTeam}  ${m.scoreA}-${m.scoreB}  ${m.winner ?? 'draw'}  ${r.reason} @${(r.endTick / 60).toFixed(1)}s  ${slots}${m.stats.invariantViolations ? '  INVARIANT!' : ''}`,
      );
      if (o.log) for (const l of m.stats.finalLog) console.log(`    [${(l.tick / 60).toFixed(1)}s] slot ${l.slot}: ${l.msg}`);
    },
  });
  const agg = aggregate(matches);
  console.log(formatAggregate(agg, `${o.mode} ${describe(o.a)} (A) vs ${describe(o.b)} (B) on ${o.layouts.join(',')}${o.swap ? ' (side swap)' : ''}`));
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return agg.invariantViolations > 0 ? 1 : 0;
}

const isMain = typeof process !== 'undefined' && process.argv[1] !== undefined && /headless-match\.ts$/.test(process.argv[1]);
if (isMain) process.exitCode = main(process.argv.slice(2));
