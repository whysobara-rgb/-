export const meta = {
  name: 'taunts-sim-bots-unlocks',
  description: 'Owner-requested taunt emotes, part 2: sim support, bot taunts and reactions per rival personality, rival emote unlocks (save, tournament, wardrobe), "킹받네" achievement, e2e — then review and fix',
  phases: [
    { title: 'Build', detail: 'sim + bots + unlocks + achievement' },
    { title: 'Review', detail: 'gameplay + UX review' },
    { title: 'Fix', detail: 'apply findings' },
  ],
}

const ROOT = '/home/user/-/game'
const SCRATCH = '/tmp/claude-0/-home-user--/f0c0347d-03ef-58ae-9fd7-f05f7cc9cfe2/scratchpad'

const COMMON = `
You work on the commercial Steam game "뿌리째 털어라" (Uproot Heist). READ: ${ROOT}/docs/design-v0.5.md (§8 rules must stay intact; §11 bots; §12 cosmetics never change stats; §13 no mandatory mocking voice), ${ROOT}/docs/ART_DIRECTION.md (voice guide per rival), ${ROOT}/docs/ARCHITECTURE.md, and the taunt contract in ${ROOT}/src/sim/types.ts (EmoteId, BASE_EMOTES, EmoteState, Command.emote, CharacterState.emote, 'emote'/'emoteCancel') and ${ROOT}/src/sim/config.ts (EMOTE). Part 1 (render animations, wheel UI, bindings, audio, match wiring sending Command.emote for unlocked ids) is already in the tree — read what it built (git log, src/render emotes, src/ui wheel, src/game/match.ts) and make part 2 light it up end to end.
YOU OWN: src/sim/** + test/sim/** (emote handling only — keep every existing rule/test intact), src/ai/** + test/ai/** (bot taunts/reactions), src/platform/save.ts (+ migration), src/game/{tournament,achievements,app}.ts and src/ui/screens/WardrobeScreen.ts + src/menu3d wardrobe scene (emote unlock display/preview), src/ui/strings/{ko,en}.ts for new strings, steam/achievements.json + src/platform/steam.ts for the new achievement, test/unit/game*.test.ts, test/e2e/** (one emote check). Never run git commands that change state.
Gates: npx tsc --noEmit clean; npm test passes; npm run build passes; npx playwright test passes (E2E_PORT=4711); npx tsx tools/layout-check.ts passes; determinism + invariant fuzz still pass.
Your final message is your report (structured).
`

const TASK = `
TASK:
1. SIM: accept Command.emote as a one-shot request; start when the character is not holding, not dashing, not knocked down and off cooldown (EMOTE.cooldownTicks after the previous end/cancel); set CharacterState.emote {id, startTick, endTick = tick + EMOTE.durationTicks[id]} and emit 'emote' with nearOpponentId (nearest opponent within EMOTE.nearOpponentRadius with lineOfSight, else null); cancel on |move| > EMOTE.cancelMove, grab press, dash, knockdown, match end -> 'emoteCancel'; clear at endTick; initialize emote: null for every character (make the field always present). Purely cosmetic: no effect on physics, scoring, police targeting or recovery. Deterministic. Tests for start/cancel/cooldown/end/nearOpponent and that emotes never change outcomes (same match with/without emote spam yields identical scores except for movement the emote prevented — test with stationary characters).
2. BOTS (src/ai): personality-flavored taunts with strict rate limits (never more than one per ~12 s per bot, never when it costs anything: only when idle-ish, safe and not carrying): hodadak (hodadakZoom/bleh after recovering a safe right under an opponent's nose or stealing), tongkeun (tongkeunFlex/fanCash after a whole-bank recovery), nunchi (nunchiShrug/wiggle after a successful tackle-free steal or a police knockdown of the opponent); difficulty does not change taunting except novice taunts less. Reactions: when the human taunts within sight and range, a bot may react with a short emote (bleh back) or a determined telegraph (no stat change, no rubber-banding). Teammate bots cheer (squatBounce) after the team's bank recovery. Bots use only base emotes plus their own rival emote. Rival adaptation unaffected.
3. UNLOCKS: SaveData.cosmetics.unlockedEmotes (migration: add [] for old saves); beating a rival unlocks its emote alongside its hat (toast "새 도발: 근육 자랑!"), tournament/results reward strings updated; wardrobe shows an emote section with 3D previews (play the emote on the turntable raccoon) and locked gift boxes; match.ts already filters by unlocked ids — verify.
4. ACHIEVEMENT: TAUNT_WIN ("킹받네" / "Cheeky Win"): emote with nearOpponentId set and win that match; add to ACHIEVEMENTS, steam/achievements.json, i18n, detection tests.
5. E2E: in a quick match (autotest) trigger an emote via the real input path and assert the sim state shows it and a bubble renders; no console errors.
6. Run a short headless balance sanity check (tools/headless-match.ts, police on, a few dozen matches) to confirm taunting bots do not change win rates meaningfully (report before/after).
`

const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string' }, knownIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'files', 'verification', 'knownIssues'],
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

phase('Build')
const rep = await agent(COMMON + TASK, { label: 'build:taunts-sim', phase: 'Build', schema: REPORT, effort: 'high' })
phase('Review')
const review = await agent(COMMON + `
TASK: Skeptical reviewer (gameplay + UX). Do NOT edit project files; scratch under ${SCRATCH}/review-taunts-sim/.
Assignment:
<<<A
${TASK}
A>>>
Report:
${JSON.stringify(rep, null, 1)}
Verify end to end in the real game (taunt via Ctrl+1 / digits / wheel; bubble + animation + sound path; cancel rules; cooldown; bots taunting in character and rarely; unlock flow after beating a rival; wardrobe preview; achievement), sim determinism/invariants, no gameplay effect, gates. Concrete evidenced findings only.`, { label: 'review:taunts-sim', phase: 'Review', schema: REVIEW, effort: 'high' })
phase('Fix')
let fix = null
if (review && review.issues && review.issues.length) {
  fix = await agent(COMMON + `
TASK: Fix the review findings (same ownership).
<<<A
${TASK}
A>>>
Previous report:
${JSON.stringify(rep, null, 1)}
Findings (verify each; fix every real one; explain rejections):
${JSON.stringify(review.issues, null, 1)}
Re-run all gates. Report the final state.`, { label: 'fix:taunts-sim', phase: 'Fix', schema: REPORT, effort: 'high' })
}
return { rep, review, fix }
