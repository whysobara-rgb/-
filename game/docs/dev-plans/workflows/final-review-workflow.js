export const meta = {
  name: 'final-review-and-polish',
  description: 'Ship-readiness: 8 independent review lenses play the real game, findings are deduped and adversarially verified, fixed by area owners, then re-checked until dry',
  phases: [
    { title: 'Find', detail: '8 lenses play and inspect the real game' },
    { title: 'Verify', detail: 'adversarial check of each finding' },
    { title: 'Fix', detail: 'area owners fix confirmed findings' },
    { title: 'Recheck', detail: 'next round until dry' },
  ],
}

const ROOT = '/home/user/-/game'
const SCRATCH = '/tmp/claude-0/-home-user--/f0c0347d-03ef-58ae-9fd7-f05f7cc9cfe2/scratchpad'

const COMMON = `
You work on the commercial Steam game "뿌리째 털어라" (Uproot Heist), now feature-complete: deterministic sim with police (src/sim), bots (src/ai), 3D view + models (src/render), 3D menus (src/menu3d), UI/HUD (src/ui), audio (src/audio), platform/Electron/Steam (src/platform, electron/, steam/), game flow (src/game, src/main.ts, index.html).
READ: ${ROOT}/docs/design-v0.5.md (rules), ${ROOT}/docs/ART_DIRECTION.md (binding presentation/feel/craft/voice/copyright rules), ${ROOT}/docs/ARCHITECTURE.md (incl. Police section — police is an owner addition).
OWNER'S BAR: a lavish, polished, Nintendo-feel party game with flashy dopamine-heavy presentation and punchy hit feel; must NEVER look or read like a bland AI-made game; must be fair and bug-free enough to sell on Steam.
How to run the real game: cd ${ROOT} && npm run build && npx vite preview --port <your port 4300-4399> --strictPort (kill it when done). URL hooks (src/game/params.ts): ?autotest=1 (bot drives the human), speed=N, render=N, flow=quick|tutorial|tournament, layout=plaza|shortcut|counter, mode=1v1|2v2, lang=ko|en, quality=low|medium|high, police=0|1, seed=N, matchSeconds=N, fresh=1; window.__uproot debug object under autotest. Headless Chromium at /opt/pw-browsers (Playwright 1.56), WebGL args ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']; software GL is slow. Headless sim tools: npx tsx tools/headless-match.ts, tools/balance-report.ts. LOOK at every screenshot/frame you capture with Read.
Never run git commands that change state. Scratch: ${SCRATCH}/final/<your-label>/.
`

const LENSES = [
  { key: 'rules', prompt: 'LENS: rules contract. Verify in the REAL game (sim + HUD) every rule in doc §2, §4, §5, §7, §8 (incl. the §8 boundary table, 4:00 limit, both-banks → min(end, now+30 s), early decision strictness, draws, settlement order, "확정" vs "운반 중" display, bank estimate breakdown, recovery 1.5 s, cancel only by leaving) and the police rules (never touch scores, fair to both teams). Write targeted sim scripts and read HUD values from screenshots. Any mismatch between what the player sees and what the sim does is high severity.' },
  { key: 'onboarding', prompt: 'LENS: first 5 minutes (doc §3, §13, §19 first-play targets). Play the first launch as a brand-new player (fresh=1) in Korean and English: title → first-launch prompt → tutorial (every beat, wandering off, letting go, pulling the bank from the wrong side, skipping) → first match vs novice. Is every step understandable from the screen alone in 30 s? Are prompts short, warm, in-voice? Any dead end, confusing text, unreadable highlight, missing feedback?' },
  { key: 'feel', prompt: 'LENS: game feel and spectacle (ART_DIRECTION §1–§2). Capture FRAME SEQUENCES (10–20 frames each) at the game camera of: grab snap, small/large/bank uproot (full choreography), dash hit + knockdown + hit-stop, police arrival + chase + tackle + dodge, carry boost, fence bust, safe recovery, bank recovery fanfare, final-30-s siren, match end + results celebration. Judge each against a polished console party game: is the impact punchy (anticipation, hit-stop, squash, particles, camera punch, sound sync, stamp callout)? Flag every moment that feels flat, late, mushy, too small to read, or over-cluttered, with concrete improvement proposals.' },
  { key: 'craft', prompt: 'LENS: craft / "never looks AI-made" audit (ART_DIRECTION §3–§4). Screenshot EVERY screen and HUD state in ko and en at 1920x1080 and 1280x720 (title, menu + each reaction, quick setup 1v1/2v2, preview, tournament ladder/intermission, wardrobe, settings tabs incl. rebinding, pause, confirm dialogs, loading, results win/lose/draw/series, toasts, HUD in each phase incl. police and final countdown). Flag: emoji icons, default browser bits, generic gradients, inconsistent spacing/type/outline weights, clipping/overflow, placeholder-looking props, repetitive set dressing, IP-imitating motifs, debug text, anything bland.' },
  { key: 'copy', prompt: 'LENS: Korean + English copy (ART_DIRECTION §5–§6). Read src/ui/strings/ko.ts and en.ts in full plus all layout strings and in-code literals shown to players. Flag translationese, stiff or corporate tone, inconsistent glossary terms (확정/운반 중/회수/뽑기/가로채기/도주 준비), rival voice violations, typos, spacing errors (띄어쓰기), English that is literal/awkward, overlong strings that will clip, exclamation spam, and generic marketing phrases. Provide the exact corrected strings.' },
  { key: 'stability', prompt: 'LENS: stability + performance. Run a soak: at least 40 full matches headlessly across layouts/modes/police on-off with tools/headless-match.ts (invariants, stuck, exceptions), plus 8+ full matches in the real browser build under autotest with speed (console errors, unhandled rejections, memory growth via performance.memory / renderer.info across 5 consecutive matches + menu round-trips, WebGL context count). Check pause/resume, tab hide, rapid menu mashing, settings toggling mid-match, language switch mid-flow, quality switches. Measure frame time proxies per quality. Report crashes, leaks, freezes, error logs, stuck entities.' },
  { key: 'access', prompt: 'LENS: accessibility + input (doc §13). Verify keyboard-only and gamepad-style (simulate via the input module / synthetic events) navigation of every screen, rebinding (conflicts, reset, persistence), grab hold vs toggle, subtitles for every important sound, per-category volume, screen shake 0, reduced motion (no wipes/wobble/particles beyond essentials), UI scale 0.8–1.4 at 1280x720 and 1920x1080, color-independent team/loot identification, focus visibility, no input dropped after pause/resume.' },
  { key: 'steam', prompt: 'LENS: Steam ship readiness. Build Electron packages (linux dir; windows zip via electron-builder with signAndEditExecutable false) and run the packaged Linux build under xvfb to the main menu and through a short autotest match; verify saves persist across restarts in userData, achievements unlock path (mock steam), fullscreen toggle, quit, offline (no network requests at all — log requests), CSP, file:// loading, single instance, crash logging. Check docs/STEAM_RELEASE.md and steam/*.vdf/achievements.json for correctness and completeness, third-party license notices (three.js MIT, fonts OFL, steamworks.js) shown in-game (credits) and shipped as a file, version display, and anything Steam review would reject.' },
]

const FINDINGS = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string', description: 'short unique slug' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      area: { type: 'string', enum: ['sim', 'ai', 'render', 'menu3d', 'ui', 'audio', 'platform', 'game', 'docs'] },
      title: { type: 'string' },
      detail: { type: 'string', description: 'what is wrong, where (file/screen), and the concrete fix proposal' },
      evidence: { type: 'string', description: 'repro steps / screenshot path / measurement' },
    }, required: ['id', 'severity', 'area', 'title', 'detail', 'evidence'] } },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { real: { type: 'boolean' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, note: { type: 'string' } },
  required: ['real', 'severity', 'note'],
}
const FIXREP = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    rejected: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['fixed', 'rejected', 'verification'],
}

const OWNERSHIP = {
  sim: 'src/sim/** and test/sim/**',
  ai: 'src/ai/**, test/ai/**, tools/headless-match.ts, tools/balance-report.ts',
  render: 'src/render/** and dev/view-harness.html, dev/model-gallery.html',
  menu3d: 'src/menu3d/** and dev/menu3d-gallery.html',
  ui: 'src/ui/** and dev/ui-gallery.html',
  audio: 'src/audio/**, test/unit/audio*.test.ts, dev/audio-gallery.html',
  platform: 'src/platform/**, electron/**, steam/**, tools/package-*.mjs, package.json build/scripts, test/unit/platform*.test.ts',
  game: 'src/game/**, src/main.ts, index.html, public/**, test/e2e/**, test/unit/game*.test.ts, playwright.config.ts',
  docs: 'docs/**',
}

const confirmed = []
const seen = new Set()
let round = 0
let dry = 0
while (round < 3 && dry < 1) {
  round++
  phase('Find')
  const BATCH_VERDICT = {
    type: 'object',
    properties: { verdicts: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, real: { type: 'boolean' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, note: { type: 'string' } },
      required: ['id', 'real', 'severity', 'note'] } } },
    required: ['verdicts'],
  }
  const perLens = await pipeline(
    LENSES,
    l => agent(COMMON + `\nROUND ${round}. ${l.prompt}\nAlready reported in earlier rounds (do not repeat unless still broken after its fix): ${JSON.stringify([...seen]).slice(0, 6000)}\nReport concrete, evidenced findings with a concrete fix proposal each. Prefer fewer, high-impact findings over nitpicks, but list every real defect.`,
      { label: `find:${l.key}:r${round}`, phase: 'Find', schema: FINDINGS }),
    (r, l) => {
      const fresh = ((r && r.findings) || []).filter(f => !seen.has(f.id + '|' + f.title))
      fresh.forEach(f => seen.add(f.id + '|' + f.title))
      if (!fresh.length) return []
      return agent(COMMON + `\nTASK: Adversarially verify each finding below (from the ${l.key} lens). Reproduce each yourself in the real game or code. Default to real=false if you cannot reproduce it or if it contradicts the design doc / owner direction. Adjust severity if mis-rated. Return one verdict per id.\nFINDINGS: ${JSON.stringify(fresh)}`,
        { label: `verify:${l.key}:r${round}`, phase: 'Verify', schema: BATCH_VERDICT, effort: 'medium' })
        .then(v => {
          const byId = new Map(((v && v.verdicts) || []).map(x => [x.id, x]))
          return fresh.filter(f => byId.get(f.id) && byId.get(f.id).real).map(f => ({ ...f, severity: byId.get(f.id).severity, note: byId.get(f.id).note }))
        })
    },
  )
  const real = perLens.filter(Boolean).flat()
  confirmed.push(...real)
  log(`round ${round}: ${real.length} confirmed`)
  if (!real.length) { dry++; continue }

  phase('Fix')
  const byArea = {}
  for (const f of real) (byArea[f.area] = byArea[f.area] || []).push(f)
  await parallel(Object.entries(byArea).map(([area, items]) => () =>
    agent(COMMON + `\nTASK: You own ${OWNERSHIP[area]} for this fix pass (other fixers are editing other areas concurrently — only touch your area; if a fix truly needs a one-line change elsewhere, make it minimal and list it). Fix every confirmed finding below (high first). Keep all tests passing (npm test), typecheck clean, build passing; never weaken tests or doc rules. Verify each fix the way the finding was evidenced (screenshots you LOOK at, measurements, tests).\nFINDINGS:\n${JSON.stringify(items, null, 1)}`,
      { label: `fix:${area}:r${round}`, phase: 'Fix', schema: FIXREP, effort: 'high' })))
}

phase('Recheck')
const gate = await agent(COMMON + `\nTASK: Final gate. Run: npx tsc --noEmit -p ${ROOT}; npm test; npm run build; npx playwright test (E2E_PORT=4391); npx tsx tools/layout-check.ts. Fix only trivial breakages caused by the last fix round (report anything non-trivial). Report the exact results.`, { label: 'gate', phase: 'Recheck', schema: FIXREP })
return { rounds: round, confirmed: confirmed.map(f => ({ id: f.id, area: f.area, severity: f.severity, title: f.title })), gate }
