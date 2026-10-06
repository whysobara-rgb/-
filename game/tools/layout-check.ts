/**
 * Layout validation CLI.
 *
 *   npx tsx tools/layout-check.ts [--fast] [--only=plaza,counter]
 *
 * Prints every metric per layout (spawn -> bank distances, bank route lengths and
 * clearances, per-safe walk/carry distances, declared path widths, bypass coverage)
 * and all issues; exits with code 1 if any error is found and 2 on bad usage (unknown
 * argument or --only id), so a typo can never pass as "nothing checked, all OK".
 */
import { pathToFileURL } from 'node:url';
import { LAYOUTS, LAYOUT_META, LAYOUT_STRINGS, MATCH_LAYOUT_IDS } from '../src/sim/layouts/index';
import { formatReport, validateLayout, validateLayoutSet, type ValidationReport } from '../src/sim/layouts/validate';

/** Runs the check; returns the process exit code (0 ok, 1 layout errors, 2 bad usage). */
export function main(args: readonly string[] = process.argv.slice(2)): number {
  const fast = args.includes('--fast');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter((s) => s.length > 0) : null;
  const unknownArgs = args.filter((a) => a !== '--fast' && !a.startsWith('--only='));
  if (unknownArgs.length > 0) {
    console.error(`unknown argument(s): ${unknownArgs.join(' ')}\nusage: npx tsx tools/layout-check.ts [--fast] [--only=plaza,counter]`);
    return 2;
  }
  if (only) {
    // A typo must never turn into a silent "nothing checked, all OK".
    const unknown = only.filter((id) => !(id in LAYOUTS));
    if (only.length === 0 || unknown.length > 0) {
      console.error(`unknown layout id(s) in --only: ${unknown.join(', ') || '(empty)'}; known: ${Object.keys(LAYOUTS).join(', ')}`);
      return 2;
    }
  }
  const reports: ValidationReport[] = [];
  let failed = false;
  for (const def of Object.values(LAYOUTS)) {
    if (only && !only.includes(def.id)) continue;
    const t0 = Date.now();
    const r = validateLayout(def, LAYOUT_META[def.id], { skipBypass: fast });
    reports.push(r);
    console.log(formatReport(r));
    console.log(`   (${Date.now() - t0} ms)\n`);
    if (!r.ok) failed = true;
  }
  if (!only) {
    const set = validateLayoutSet({ layouts: LAYOUTS, matchIds: MATCH_LAYOUT_IDS, strings: LAYOUT_STRINGS, reports });
    console.log(`== cross-layout checks: ${set.length === 0 ? 'OK' : `${set.length} issue(s)`}`);
    for (const i of set) {
      console.log(`   [${i.level}] ${i.code}: ${i.msg}`);
      if (i.level === 'error') failed = true;
    }
  }
  if (reports.length === 0) {
    console.error('no layouts were validated');
    return 2;
  }
  const label = only ? `${reports.length} SELECTED LAYOUT(S) OK (cross-layout checks skipped)` : 'ALL LAYOUTS OK';
  console.log(failed ? '\nLAYOUT CHECK FAILED' : `\n${label}`);
  return failed ? 1 : 0;
}

// Only exit when run as a script (the test suite imports main()).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
