/**
 * Layout validation CLI.
 *
 *   npx tsx tools/layout-check.ts [--fast] [--only=plaza,counter] [--content=classic|v2|both]
 *
 * Prints every metric per layout (spawn -> bank distances, bank route lengths and
 * clearances, per-safe walk/carry distances, declared path widths, bypass coverage)
 * and all issues; exits with code 1 if any error is found and 2 on bad usage (unknown
 * argument or --only id), so a typo can never pass as "nothing checked, all OK".
 *
 * Content 2.0: every layout is checked in its classic composition, and every layout with a
 * `LayoutDef.v2` composition is checked again as v2 (starter sockets incl. the bot haul lane,
 * breakables, natural-path crates, item pads from each own spawn, event spots, the cash truck's
 * curb approach, 돈나무 haul, squeeze, hammerable fences, chirality, 4,000 total, …). Rule waivers
 * a layout declares (LayoutDesignMeta.waivers) print as `[warn] waived` lines with their reason.
 * `--content=classic` / `--content=v2` restricts the run to one of them (default: both).
 */
import { pathToFileURL } from 'node:url';
import { LAYOUTS, LAYOUT_META, LAYOUT_STRINGS, MATCH_LAYOUT_IDS } from '../src/sim/layouts/index';
import { formatReport, validateLayout, validateLayoutSet, type ValidationReport } from '../src/sim/layouts/validate';

/** Runs the check; returns the process exit code (0 ok, 1 layout errors, 2 bad usage). */
export function main(args: readonly string[] = process.argv.slice(2)): number {
  const fast = args.includes('--fast');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter((s) => s.length > 0) : null;
  const contentArg = args.find((a) => a.startsWith('--content='));
  const contentMode = contentArg ? contentArg.slice(10) : 'both';
  const unknownArgs = args.filter((a) => a !== '--fast' && !a.startsWith('--only=') && !a.startsWith('--content='));
  if (unknownArgs.length > 0 || !['classic', 'v2', 'both'].includes(contentMode)) {
    const bad = [...unknownArgs, ...(['classic', 'v2', 'both'].includes(contentMode) ? [] : [contentArg ?? ''])];
    console.error(`unknown argument(s): ${bad.join(' ')}\nusage: npx tsx tools/layout-check.ts [--fast] [--only=plaza,counter] [--content=classic|v2|both]`);
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
    const contents: ('classic' | 'v2')[] = [];
    if (contentMode !== 'v2') contents.push('classic');
    if (contentMode !== 'classic' && def.v2) contents.push('v2');
    for (const content of contents) {
      const t0 = Date.now();
      const r = validateLayout(def, LAYOUT_META[def.id], { skipBypass: fast, content });
      reports.push(r);
      console.log(formatReport(r));
      console.log(`   (${Date.now() - t0} ms)\n`);
      if (!r.ok) failed = true;
    }
  }
  if (!only && contentMode !== 'v2') {
    const classic = reports.filter((r) => r.content === 'classic');
    const set = validateLayoutSet({ layouts: LAYOUTS, matchIds: MATCH_LAYOUT_IDS, strings: LAYOUT_STRINGS, reports: classic });
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
  const label = only || contentMode === 'v2' ? `${reports.length} SELECTED REPORT(S) OK (cross-layout checks skipped)` : `ALL LAYOUTS OK (${reports.length} reports)`;
  console.log(failed ? '\nLAYOUT CHECK FAILED' : `\n${label}`);
  return failed ? 1 : 0;
}

// Only exit when run as a script (the test suite imports main()).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
