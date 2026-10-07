export const meta = {
  name: 'content-wave',
  description: 'Implement a wave of Content 2.0 / fun-plan work packages in parallel (each: build -> skeptical review -> fix), per scratchpad/plans/content-plan.md',
  phases: [
    { title: 'Build', detail: 'work packages in parallel' },
    { title: 'Review', detail: 'skeptical review per package' },
    { title: 'Fix', detail: 'apply findings' },
  ],
}

const ROOT = '/home/user/-/game'
const SCRATCH = '/tmp/claude-0/-home-user--/f0c0347d-03ef-58ae-9fd7-f05f7cc9cfe2/scratchpad'
const WPS = (args && args.wps) || []

const COMMON = `
You implement part of the "Content 2.0" round for the commercial Steam game "뿌리째 털어라" (Uproot Heist) — the owner played the game and said the core loop gets boring fast; this round adds the squeaky hammer + items, coins/bags, new uprootables, map gimmicks, events, a commercial main screen, and the fun-plan retention packages.
READ FIRST, fully: ${SCRATCH}/plans/content-plan.md (the director's plan — §2 decisions, §3 economy rules, §4 frozen sim contracts, §5 content specs, §6 your work package + the shared-file ownership map, §7 waves, §8 metrics, §10 non-negotiables) and, for F-packages, ${SCRATCH}/plans/fun-plan.md (its spec for your package; content-plan §6 lists the deltas). Also ${ROOT}/docs/design-v0.5.md (incl. §22 owner overrides), ${ROOT}/docs/ART_DIRECTION.md (voice guide, craft checklist, copyright avoidance), ${ROOT}/docs/ARCHITECTURE.md (incl. the "Fun round contracts" and "Content 2.0 contracts" sections — frozen; add-only; change requests go through the contracts owner).
OWNER'S DEMAND: the game must be insanely fun and addictive ("한 판만 더") — ethically (no loot boxes, currency, energy, FOMO, streak penalties, network telemetry) and within the doc's core rules (two buttons, 100/300/500, 3200 total, no multipliers/catch-up bonuses, cosmetics never change stats, nothing basic locked, rematch one press, ties are draws, deterministic sim).
The plan's "owner has uncommitted work" notes referred to other engineers who have since finished — build on the current tree as-is and never revert others' work.
Several packages are being implemented concurrently by other engineers. ONLY edit the files your package owns (listed below and in content-plan.md §6 ownership map); for shared files (match.ts, app.ts, strings ko/en) edit only your designated section/namespaced block, re-reading the file right before each edit. Never run git commands that change state. Use your own ports (given below) for any vite server and kill it when done.
Tools: headless sim harness (src/ai/harness.ts, tools/headless-match.ts, tools/balance-report.ts incl. --fun once WP1 lands), Playwright 1.56 + Chromium at /opt/pw-browsers (WebGL args ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']; software GL is slow), game URL hooks in src/game/params.ts. LOOK at every screenshot you take with Read.
Gates for your package: npx tsc --noEmit -p ${ROOT} clean; npm test passes; npm run build passes; your package's acceptance criteria from content-plan.md (or fun-plan.md for F-packages) measured and reported with numbers. If another package's in-progress edit breaks a gate transiently, note it and retry later; don't "fix" their files.
Your final message is your report (structured).
`

const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
    acceptance: { type: 'string', description: 'each acceptance criterion with measured result' },
    verification: { type: 'string' }, knownIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'files', 'acceptance', 'verification', 'knownIssues'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ship', 'fix-needed'] },
    issues: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['high', 'medium', 'low'] }, file: { type: 'string' },
      description: { type: 'string' }, evidence: { type: 'string' } }, required: ['severity', 'description', 'evidence'] } },
  },
  required: ['verdict', 'issues'],
}

const results = await pipeline(
  WPS,
  wp => agent(COMMON + `\nYOUR PACKAGE: ${wp.id} — implement it exactly as specified in content-plan.md (and, for F-packages, fun-plan.md plus the content-plan delta) — changes + acceptance.\nYOU OWN: ${wp.owns}\nPORTS: ${wp.ports}\n${wp.extra || ''}`,
    { label: `build:${wp.id}`, phase: 'Build', schema: REPORT, effort: 'high' }),
  (rep, wp) => agent(COMMON + `\nTASK: Skeptical reviewer of package ${wp.id} (ownership: ${wp.owns}). Do NOT edit project files; scratch only under ${SCRATCH}/review-${wp.id}/. Ports: ${wp.ports}.\nImplementer report:\n${JSON.stringify(rep, null, 1)}\nVerify every acceptance criterion of ${wp.id} in content-plan.md (and fun-plan.md for F-packages) independently (re-measure with your own seeds where numbers are claimed; LOOK at screenshots), check the non-negotiables (content-plan §10), honesty of any player-facing claim (every number traceable to the event log/save), ethics, determinism, performance, i18n parity, and that nothing outside the package's ownership was changed. Concrete evidenced findings only; empty list if it ships.`,
    { label: `review:${wp.id}`, phase: 'Review', schema: REVIEW, effort: 'high' }).then(review => ({ rep, review })),
  ({ rep, review }, wp) => {
    const todo = (review && review.issues) || []
    if (!todo.length) return { id: wp.id, rep, review, fix: null }
    return agent(COMMON + `\nTASK: Fix the review findings for package ${wp.id} (same ownership: ${wp.owns}; ports ${wp.ports}).\nPrevious report:\n${JSON.stringify(rep, null, 1)}\nFindings (verify each; fix every real one; explain rejections):\n${JSON.stringify(todo, null, 1)}\nRe-run the gates and re-measure the acceptance criteria. Report the final state.`,
      { label: `fix:${wp.id}`, phase: 'Fix', schema: REPORT, effort: 'high' }).then(fix => ({ id: wp.id, rep, review, fix }))
  },
)
return results
