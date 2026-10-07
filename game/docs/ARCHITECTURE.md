# 뿌리째 털어라 (Uproot Heist) — Architecture & Module Contracts

Source of truth for game rules: `docs/design-v0.5.md` (기획 v0.5). Where this file and the
design doc disagree on a rule, the design doc wins; fix this file.

## Stack

- TypeScript (strict) + Vite, three.js for 3D rendering, HTML/CSS overlay for all UI text.
- Deterministic 60 Hz 2D simulation (`src/sim`, no DOM, no three) — runs headless in Node
  for tests, bots-vs-bots balance runs, and (later) an authoritative online server.
- Electron wrapper for Steam (`electron/`), optional `steamworks.js` for achievements/overlay.
- Fonts: `@fontsource/jua` (display, cute rounded Korean) + `@fontsource/noto-sans-kr` (body).
  Fonts are bundled; the game must run fully offline.
- Tests: Vitest (`test/sim`, `test/ai`, `test/unit`), Playwright for browser smoke (`test/e2e`).

Commands (run inside `game/`): `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`.

## Coordinate conventions

- Sim plane: +x east, +y south, meters. Angles: radians, `atan2(y, x)`.
- three.js: sim (x, y) -> world (x, 0, y). Y is up. Camera sits south of the action (+z) high
  up, looking north/down (pitch ~55°). Screen "up" == sim -y. The camera never rotates
  (doc §4: no manual camera rotation), so input "up" maps to sim (0, -1).
- Time: integer ticks at 60 Hz. 240 s = 14400 ticks.

## Directory ownership

| Path | Owner module | Notes |
|---|---|---|
| `src/sim/types.ts`, `src/sim/config.ts` | contracts | Add fields only; never rename/remove. |
| `src/sim/*` | sim core | physics, rules, scoring, timer, world, grab/dash, floors. |
| `src/sim/layouts/*` | level design | 3 match layouts + tutorial + `index.ts` registry. |
| `src/ai/*` | bots | nav, perception, brains, personalities, rival adaptation. |
| `src/render/*` | rendering | models (procedural), view (state sync), camera, fx. |
| `src/ui/*` | UI | screens, HUD, i18n, styles, minimap. |
| `src/audio/*` | audio | procedural WebAudio SFX + music. |
| `src/platform/*` | platform | input, save, settings, steam bridge. |
| `src/game/*`, `src/main.ts`, `index.html` | game flow | app state machine, match loop, tutorial, tournament, results. |
| `electron/*`, `steam/*`, `tools/*` | packaging | Electron main/preload, SteamPipe, store assets. |

## Simulation API (`src/sim/index.ts` re-exports everything below)

```ts
class Simulation {
  constructor(setup: MatchSetup)
  readonly setup: MatchSetup
  readonly rules: RuleConfig            // DEFAULT_RULES merged with setup.rules
  readonly layout: LayoutDef
  readonly state: SimState              // live object, mutated in place by step()
  readonly eventLog: SimEvent[]         // every event since construction
  step(commands: ReadonlyArray<Command | undefined>): SimEvent[]   // exactly one tick; [] once over
  getGrabCandidate(charId: EntityId): GrabCandidate | null         // same logic step() uses
  getLoot(id: EntityId): LootState | undefined
  getCharacter(id: EntityId): CharacterState | undefined
  characterBySlot(slot: number): CharacterState
  lootOBB(id: EntityId): OBB                 // safes: body; banks: outer footprint
  bankWallOBBs(bankId: EntityId): OBB[]      // world-space wall colliders
  bankFloorOBB(bankId: EntityId): OBB        // world-space interior floor rect
  isOnBankFloor(p: Vec2, bankId: EntityId): boolean
  lineOfSight(a: Vec2, b: Vec2): boolean     // blocked by buildings/walls/kiosks/vans/bank walls; not by fences, safes, characters, planters, benches
  isFree(p: Vec2, radius: number): boolean   // no overlap with statics, unbroken fences, vans, bank walls, unrecovered safes
  staticOBBs(): OBB[]                        // boundary + layout statics + vans (+ circles as OBB approximations via staticCircles())
  staticCircles(): { center: Vec2; radius: number }[]
  ticksLeft(): number                        // endTick - tick (Infinity without a time limit)
  readonly debug: SimDebugApi                // TEST / TUTORIAL ONLY: teleport, setAnchored, setVelocity
}
```

Implementation notes (finished sim):
- Pushing works like a shopping cart (stick toward the grip pushes along the grip line with steering);
  pulling = walking away with the object trailing. Sideways grip friction keeps the holder on its side.
- Dash hits only land inside a ±60° forward cone (`DASH.hitConeHalfAngle`); a head-on dash clash makes
  both bounce (`DASH.clashBounceSpeed`) with no knockdown; hits within a substep resolve simultaneously.
- Anything tied to a bank (a rider, a safe on its floor) cannot move that bank by contact; moving a bank
  means grabbing its outer wall (doc §4).
- Fences push back with `FENCE.resistForce`; a slowly pushed bank still breaks them after `FENCE.pressTicks`.
- Bank interior is mirror-symmetric: large safe at the center, small safes at local (±2.8, 0).
- Stall rescue (`STALL_RESCUE`): a raccoon steering with real input that has not moved for ~0.6 s
  while wedged (overlapping geometry, jammed by two opposing contacts in a sub-body-width gap, or
  boxed into a pocket) is moved to the nearest free spot a thin probe reaches in a straight line
  (`unstuck` event; never through walls, fences or safes; holders/riders/dashers excluded). Layout
  validation also forbids anchored outdoor safes leaving a 0–1 m pocket against any solid (`pocket`).
- Tutorial: the fence closes the bank's lane; the practice prompt should say to push the bank from
  behind ("은행 뒤에서 밀어요") — pulling from the front stalls because the puller reaches the fence first.

Entity ids: characters `1..N` (id = slot + 1), then banks, then safes (bank interiors first,
then outdoor safes in layout order). Ids are stable for the match and never reused.

### Per-tick order (doc §8 "같은 시각의 판정 순서")

1. Read commands (edge detection for dash, latch for grab), pings, grab/release, dash. Taunts
   (`src/sim/emotes.ts`, cosmetic only) expire / cancel / start here, before grab and dash; a
   knockdown cancels a taunt inside `knockDown`, and the match ending cancels one after step 6.
2. Physics: drive forces, grab constraints, drag, integration, collisions, moving-floor carry,
   fence breaking, unanchor progress, anti-pin (unstuck).
3. Loading update: recompute `floorOf`, `loadedIn`, `loadedSafes`, `estimatedValue`
   (emit `safeLoaded`/`safeUnloaded`).
4. Recovery: update every eligible item's dwell; collect ALL completions this tick and settle
   them together (each id once; bank = 500 + loaded safes at that moment; loaded safes are
   settled with the bank, never separately). Remove recovered items; eject characters from a
   recovered bank to a safe spot nearby.
5. Bank body count; when it reaches 2 for the first time: `endTick = min(endTick, tick + 30 s)`.
6. End check: `tick >= endTick`, all loot recovered, or (earlyDecision) leader > other + remainingValue.

Invariant at every tick: `scores[0] + scores[1] + remainingValue === totalValue` (classic 3200;
Content 2.0 v2 maps 4000 / 4400 — always read `state.totalValue`, never a constant). With
`rules.content === 'v2'` the Content 2.0 systems hook into these steps (see "Content 2.0 contracts").

## Bot API (`src/ai/index.ts`)

```ts
type RivalId = 'hodadak' | 'tongkeun' | 'nunchi'   // 호다닥 / 통큰이 / 눈치왕
type Difficulty = 'novice' | 'normal' | 'challenge' // 입문 / 보통 / 도전
interface Adaptation { kind: 'ambushChoke' | 'stripBank' | 'guardDoors'; chokepointId?: string; lineKey: string; lineParams?: Record<string, string> }
interface BotOptions { slot: number; personality: RivalId; difficulty: Difficulty; adaptation?: Adaptation | null; seed: number }
interface BotController { readonly slot: number; update(sim: Simulation): Command; debug?(): unknown }
function createBot(sim: Simulation, opts: BotOptions): BotController
class RivalObserver { constructor(sim: Simulation, humanTeam: TeamId); observe(sim: Simulation, events: SimEvent[]): void; summary(): ObservationSummary }
function chooseAdaptation(summary: ObservationSummary, layout: LayoutDef, rival: RivalId): Adaptation | null
```

Police awareness (owner addition): bots read the public police state (`src/ai/policeSense.ts`:
officers, the alarm / dispatch clock). Whom an officer is after is read the way a player reads it
on screen — the loot-holding raccoon a chasing officer runs or faces at, or the one a tired officer
stands over, with a short memory while its run bends around a corner — never from the sim's target
id; an officer's remaining shift is estimated from its public arrival + the fixed shift. Carriers
route around officers and burst away; a carrier about to be tackled lets go and dash-stuns the
officer a few ticks before its own hit protection ends (an officer waits beside a downed hauler for
exactly that tick), then picks the load up again. Against a pack (two or more officers ready to
lunge) one stun only hands the next officer the tackle, so a solo hauler lets go and steps back
instead, and after being knocked / kept off twice it leaves that bank to the police for a while (a
third time in 20 s with one officer, a fourth a few steps from home) and comes back once fewer than
two ready officers stand near it or their shift ends. With an officer standing by, a bot stuns it
before taking hold of a load, or keeps its hands off for a moment (bounded) when the dash is not
ready; the dash is saved for stuns (no bank-haul boosts, no travel dashes) while an officer is near,
and a bot never dashes out of a spot an officer pins it in. Teammates (incl. the human's bot mate)
body-block and dash-stun an officer chasing a carrying ally; bank hauls are deferred while a fresh
wave is on the field; 눈치왕 cashes in on police chaos (loot an opponent just lost to a tackle,
carriers/hauls with an officer on them). Path planning treats an officer standing in a one-body
passage and a loose safe leaving a sub-body gap beside a wall as cost circles; a walker blocked by
an officer that chases nobody picks another goal for a few seconds.
How much a bot does this is `DifficultyParams.policeAwareness` (novice 0.3 < normal 0.75 <
challenge 1). Shared balance knobs live in `BOT_TUNING` (src/ai/params.ts).

A bot on the human's team behaves as a teammate (doc §11 동료 봇) automatically, and reads
`state.pings` of its team. Bots read only public info: loot positions/values/state,
fences, their own team, and opponents within `VISION.radius` with `sim.lineOfSight`
(otherwise last-seen position + tick). Same physical stats as humans — only decision
interval / reaction / planning quality differ by difficulty.

## Render API (`src/render/view.ts`)

```ts
interface ViewSettings { quality: 'low' | 'medium' | 'high'; screenShake: number; reducedMotion: boolean }
interface ViewFocus { charId: EntityId; grabCandidate: GrabCandidate | null; pingTargetIds: EntityId[] }
class GameView {
  constructor(container: HTMLElement, settings: ViewSettings)
  load(sim: Simulation): void                 // build scene for sim.layout
  captureTick(sim: Simulation): void          // after every sim.step (stores prev/curr transforms for interpolation)
  onEvents(events: SimEvent[], sim: Simulation): void
  render(sim: Simulation, alpha: number, frameDt: number, focus: ViewFocus): void
  project(p: Vec2, height: number): { x: number; y: number; onScreen: boolean }  // CSS px within container
  pickGround(clientX: number, clientY: number): Vec2 | null
  setMode(mode: 'match' | 'preview' | 'results' | 'title'): void
  applySettings(s: ViewSettings): void
  resize(): void
  dispose(): void
}
```
`src/render/models.ts` exposes procedural model factories (raccoon rig with animation
controls, small/large safe, bank rig with roof/walls/sign, van, fence, statics, decor, zone).

## Audio API (`src/audio/audio.ts`)

```ts
type SfxId = 'grab' | 'release' | 'dash' | 'dashHit' | 'bump' | 'knockdown' | 'strain' | 'unanchorSafe' | 'unanchorBank'
  | 'fenceBreak' | 'safeLoad' | 'safeUnload' | 'recoverStart' | 'recoverCancel' | 'scoreSmall' | 'scoreLarge' | 'scoreBank'
  | 'siren' | 'countdownBeep' | 'whistleStart' | 'hornEnd' | 'victory' | 'defeat' | 'draw' | 'ping' | 'eject' | 'footstep'
  | 'uiMove' | 'uiConfirm' | 'uiBack' | 'uiError' | 'popup'
type LoopId = 'drag' | 'bankRumble' | 'strain' | 'sirenLoop'
type MusicId = 'title' | 'match' | 'final' | 'results' | 'none'
class AudioEngine {
  unlock(): Promise<void>                      // call on first user gesture
  setVolumes(v: { master: number; music: number; sfx: number; ui: number }): void
  setListener(p: Vec2): void
  play(id: SfxId, o?: { pos?: Vec2; volume?: number; pitch?: number }): void
  setLoop(id: LoopId, intensity: number, pos?: Vec2): void   // 0 = silent
  playMusic(id: MusicId): void
  setMusicIntensity(x: number): void
}
const SFX_CAPTION_KEYS: Partial<Record<SfxId, string>>   // i18n keys for subtitles
```

## Platform API (`src/platform/`)

- `settings.ts`: `Settings` type + `DEFAULT_SETTINGS` (language, grabMode 'hold'|'toggle',
  bindings, volumes, subtitles, screenShake 0..1, vibration, reducedMotion, quality,
  fullscreen, showTutorialHints).
- `input.ts`: `InputManager` (keyboard, mouse, gamepad via Gamepad API), rebinding,
  `pollMatch(): HumanFrame` and `pollMenu(): MenuNav`, `buildCommand(frame, toggleState)`.
- `save.ts`: `loadSave()/writeSave()` using `window.uprootNative` (Electron preload) or
  `localStorage`. Versioned `SaveData` (settings, tournament progress, cosmetics, stats).
- `steam.ts`: achievement ids + `unlockAchievement(id)`; no-op outside Steam.

## UI (`src/ui/`)

All visible strings go through `t(key, params)` in `src/ui/i18n.ts` (ko default, en).
Screens: title, main menu, quick match setup, layout preview, rival tournament, wardrobe,
settings (with rebinding), pause, results, tutorial prompts, HUD (timer, confirmed scores,
two bank icons, carry estimate labelled '운반 중', grab prompt + dash cooldown, minimap,
off-screen arrow for carried/pinged target, world value labels, final countdown banner,
'회수하면 도주 준비 시작' warning, score popups, captions).
Accessibility: never rely on color alone (shapes/icons/text), subtitles, scalable UI.

## Game flow (`src/game/`)

`app.ts` state machine: boot -> title -> menu -> {tutorial | quick setup -> preview -> match
-> results -> rematch | tournament -> preview -> match ... | wardrobe | settings}.
`match.ts` MatchController: owns the Simulation, bot controllers, human input, fixed-step
accumulator (60 Hz) and drives GameView, Hud, AudioEngine from events.
`results.ts`: picks the single largest real event for the results screen (doc §12).
`tournament.ts`: 호다닥 -> 통큰이 -> 눈치왕, each best-of-3 on a fixed layout, observation-based
adaptation between games, progress saved, hat reward per rival, draws replayed.

## Fun round contracts ("한 판 더", frozen day 0)

Shared interfaces for the fun round (plan: 10 work packages WP1–WP10 built in parallel). They
exist in code as compilable, documented stubs so every package can build against them now.

**Rule: add-only; owners implement; consumers never re-derive.** Nobody renames, removes or
changes the meaning of anything below. Only the owner package fills in a stub's behaviour; other
packages call it and never recompute match point, swing, moments, runs or records on their own.

| Contract | File | Owner | Consumers |
|---|---|---|---|
| `matchPointInfo(state, opts?) => MatchPointInfo \| null` — `{ team, kind: 'win' \| 'tie', value, lootIds, carrierIds }`, same arithmetic as `checkEnd` (implemented + tested) | `src/sim/queries.ts` (re-exported by `src/sim/index.ts`) | WP4 | WP5 tracker, WP4 HUD, WP1 tools |
| `swingInfo(state, team) => { toTie, toLead, remaining }` (implemented + tested) | `src/sim/queries.ts` | WP4 | WP4 HUD |
| `Moment` (`kind: MomentKind`, `tick`, `team`, `pos?`, `score?`, `value?`, `tier?: 1 \| 2`, `ids?`, `lootKind?`), `MOMENT_KINDS`, `StreakTier` | `src/shared/moments.ts` (re-exported by `src/game/moments.ts`) | WP5 | WP3, WP4, WP8, feel |
| `MomentTracker` — `constructor({ localTeam, localCharId, earlyDecision? })`, `observe(state, events, botIntents: BotIntentSample[]) => Moment[]` (edges), `snapshot() => MomentSnapshot` (`matchPoint`, `leader`, `run: ScoringRun`, `stealChance: StealChanceInfo`, `matchPointKind`; continuous state), `reset()` (stub: `[]` / `EMPTY_MOMENT_SNAPSHOT`) | `src/game/moments.ts` | WP5 | match.ts hooks (WP5, WP4) |
| `emoteCancel.cause?: EmoteCancelCause` (`'move' \| 'grab' \| 'dash' \| 'hit'`), `emoteCancel.hitBy?: EntityId \| null` (dasher for a dash hit, null for a police tackle) | `src/sim/types.ts` | WP2 (sim emote step built: `src/sim/emotes.ts` — start / end / cooldown, cancel causes, `nearOpponentId`, match-end cancel; cosmetic only, `test/sim/emotes.test.ts`) | WP5 (`tauntPunished`), render/audio |
| `BotIntent.phase === 'windup'` (on every wind-up tick), `BotIntent.windupTargetId?`, `BotIntent.bark?: BotBark \| null` (`{ key: BarkKey, tick }`, show once per new tick), `BarkKey`, `BARK_KEYS` | `src/ai/types.ts` | WP2 | WP5 (feeds view, `dodged`), WP3, WP8 |
| `DifficultyParams.dashWindupTicks?` | `src/ai/params.ts` | WP2 | bots |
| `BotOptions.params?: Partial<DifficultyParams>` (already applied by `Bot`), `MatchConfig.botParams?` / `MatchConfig.cup?` -> `BotSpec.params` (rival bots only) -> `createBot` in match.ts (wired); `lerpDifficultyParams` is WP7's to add in params.ts | `src/ai/types.ts`, `src/ai/bot.ts`, `src/game/setup.ts` | WP7 | tournament cups, WP6 (`cup`) |
| `GameView.glance(pos, weight ≤ 0.3, ms)`, `playGetaway(team \| null)`, `setDecisiveLoad(ids, 'ours' \| 'theirs' \| null)`, `setStealChance(doorPos \| null, value)`, `setRunHeat(team \| null, tier)`, `onMoments(moments)` (moods, impact pulses), `setResultsPoses({ rival: 'taunt' \| 'slump', player: EmoteId \| null })`, `setBotWindup(charId, { targetId } \| null)`, `showBark(charId, text, seconds?)` (no-op stubs) | `src/render/view.ts` | WP3 | match.ts `funObserve` / `funEnding` (WP5); `setResultsPoses` from `toResults` (WP6) |
| `MatchAudioDirector.onMoments(moments)`, `setTension({ matchPoint, secondsLeft, run? })` + `TensionState` (no-op stubs; the old private police `setTension(x)` is now `setPoliceTension`) | `src/audio/director.ts` | WP8 | match.ts `funObserve` (WP5) |
| Save v2 types: `ProgressV2` (`rivals`, `records`, `globalRecords`, `cups`, `challenges`, `recent`, `onboarding`, `funnel`), `RivalRecord`, `LayoutRecord`, `GlobalRecords`, `RecordKind`, `CupId`, `RivalRecordKey`, `OnboardingStep`, `FunnelKey`, `MatchOutcomeSummary` (incl. `teamMode`), `CupProgress`, `createDefaultProgressV2()`, `CosmeticsV2Fields` (`vanPaints`, `vanPaint`, `victoryPose`) + `createDefaultCosmeticsV2()` | `src/platform/progress.ts` | WP9 | WP6, WP7, WP10 |
| `recordMatchOutcome(summary, save?) => { newRecord: RecordKind \| null }`, `rivalRecord(rival, key \| 'all', save?)`, `cupProgress(cup, save?)`, `bumpFunnel(key, save?)` (stubs: never write, neutral values), `grantRivalReward(cosmetics, rival) => { hatNew, emoteNew }` (stub: hat only, today's behaviour) | `src/platform/progress.ts` | WP9 | WP6, WP7 (`recordTournament` calls `grantRivalReward`), WP10 |
| 털이 수첩: `ChallengeView`, `ChallengeMatchInput`, `matchChallengeDeltas(input) => Record<id, n>` (caps applied), `nextChallenge(progress) => ChallengeView \| null` (stubs: `{}` / `null`) | `src/game/challenges.ts` | WP10 | WP6 (deltas, next-goal chip), WP7 (menu card) |
| match.ts hooks: `funObserve(events) => Moment[]`, `funFocusTargets()`, `funArrows()`, `funEnding(result)` [WP5]; `funHud(moments)` [WP4] — call sites already in place (no-op bodies) | `src/game/match.ts` | WP5 / WP4 | — |
| Per-package string blocks (empty, with markers) | `src/ui/strings/ko.ts`, `en.ts` | each package | — |

Per-tick order in `MatchController.stepOnce` (frozen): `sim.step` -> `view.captureTick` /
`view.onEvents` / callouts / `setBotTelegraph` -> `observer.observe` -> **`funObserve`** (WP5:
command log, `tracker.observe`, feel glance / slow-mo / hit-stop, `view.onMoments`, the
`set*` view calls from `tracker.snapshot()` and bot intents, `director.setTension`,
`director.onMoments`) -> `director.onEvents` / `script.onEvents` / `handleEvents` ->
**`funHud`** (WP4) -> end check (`beginEnding` -> **`funEnding`**, WP5: `view.playGetaway`).
Moments are edges; anything shown *while it lasts* (glow, steal marker, run heat, heartbeat,
crown) is fed every tick from `snapshot()`. `src/game/feel.ts` (WP5) maps moments to `glance`
and TimeScale only; render-only reactions (moods, impact pulse) live in `view.onMoments` (WP3);
HUD never goes through feel.

Notes:
- `SAVE_VERSION` stays 1 until WP9 lands its 1 -> 2 migration (`PROGRESS_V2_SAVE_VERSION = 2`).
- Strings: each package adds keys only between its own `[WPn] begin` / `[WPn] end` markers at
  the end of `src/ui/strings/ko.ts` and `en.ts`: WP2 `taunt.bark.*`; WP4 `hud.mp.*`,
  `hud.moment.*`; WP6 `results.hook.*`, `rivalLine.*`; WP7 `cup.*`, `onboard.*`; WP8 new
  `caption.*`; WP10 `book.*` + new `hat.*`. Cross-package keys are pinned: `hud.mp.ours`,
  `hud.mp.theirs`, `hud.moment.stealChance` (`{value}`) are defined by WP4 and read by WP3;
  `taunt.bark.<BarkKey>` is defined by WP2 and translated in `funObserve` (WP5).
- Shared-file ownership: `match.ts` — WP5 and WP4 edit only their `fun*` hook bodies (plus new
  private fields and NEW import lines); WP4 additionally owns the existing banner calls (banner
  queue). `app.ts` — WP6 owns `toResults` / `onMatchFinished` (builds `MatchOutcomeSummary`,
  calls `recordMatchOutcome`, `bumpFunnel`, `setResultsPoses`); WP7 owns `toMenu`,
  `tournamentConfig`, `offerAfterTutorial` and `recordTournament` (cup filing; it reads the cup
  itself, so WP7 never edits `onMatchFinished`). `setup.ts` — WP7. `bot.ts` — WP2 (the
  `params` merge is already in). `save.ts` — WP9 only; WP9 never edits `app.ts`.
  `POLICE` / `BOT_TUNING` values — WP1 only.
- Imports in shared files: add a NEW import line instead of extending an existing one (duplicate
  module specifiers are fine), so two packages never edit the same import line.
- Unit tests guarding the frozen shapes: `test/sim/queries-fun.test.ts`,
  `test/unit/fun-contracts.test.ts` (owners update the "stub" expectations when they implement).

## Content 2.0 contracts (C0, frozen day 0)

Plan: `plans/content-plan.md` (§3 economy, §4 shared sim contracts, §5 content, §6 packages).
Design overrides: `docs/design-v0.5.md` §22 "Content 2.0 오너 결정". These contracts exist in
code as compilable stubs / no-op systems so every package builds against the final shapes now.

**Rules.**
- **Add-only.** Nobody renames, removes or changes the meaning of anything below or in the fun-round
  contracts above; new fields are optional, new union members are appended.
- **`src/sim/types.ts` is read-only after day 0.** Any change (a field, a union member, a new id) is a
  change request to C0, who lands it for everyone. Pre-approved: C4b moves `'yard'` / `'funpark'` from
  `PlannedLayoutId` into `LayoutId` in the same change that registers the layout in `LAYOUTS` /
  `LAYOUT_META` (and adds them to `RECORD_LAYOUT_IDS` / the v2 save defaults with F9).
- **`src/sim/config.ts`:** each package edits only its own block (table below); after a package lands,
  values are tuned only by C11 (single tuning owner, single-lever changes, n >= 300).
- **Classic is frozen.** `content: 'classic'` (the tutorial, every layout without `v2`, or an explicit
  override) must stay byte-identical: `test/sim/content-classic-identity.test.ts` replays 30 recorded bot
  matches + 5 fuzz runs and compares the full event log (sha256) and final state. Classic never builds
  content systems (`ctx.content === null`) and never draws from `ctx.rng`. Regenerating the fixture
  (`npx tsx tools/record-classic-identity.ts`; `--check` diffs without writing) is only for an intended,
  agreed classic change (e.g. C11 police tuning, WP2's emote step) and goes through C0.
- **Determinism.** The content RNG has two independent streams so one package's draw count never shifts
  the other's results: the item deck (C2) uses `ctx.rng = createRng(setup.seed ^ CONTENT_RNG_SALT)`; the
  event plan and the truck's curb side (C5) are drawn at build inside the pure
  `planMatchEvents(seed, v2, opts)` from `createRng(seed ^ CONTENT_RNG_SALT ^ EVENT_RNG_SALT)` (so items
  off / on or a bigger deck never change a seed's events, and game flow can compute the same plan).
  No other draws. Everything else is a pure function of state and tick; hits inside a substep are
  collected then applied in id order (never slot order); mirrored situations give mirrored outcomes.
- **JSON-safe state.** `SimState` / `SimEvent` never hold `Infinity` / `NaN` (event-log hashes, replays,
  saves): "forever" is `ITEM_FOREVER` (`0x7fffffff`; HUD: no pips / no lifetime ring at or above it).
- **Default-v2 gate.** `mergeRules` defaults to `'v2'` on a layout with `v2` only once
  `CONTENT_V2_BY_DEFAULT` (config.ts, C0) is true. It stays false until the wave-1 integration (C1 + C3 + C4
  landed, invariant fuzz green on every v2 map), so C4 attaching `layout.v2` to plaza / shortcut / counter
  does not switch every match, test and tool on those maps to a half-built ruleset. Until then v2 work and
  tests pass `content: 'v2'` explicitly. At the flip C0 pins the classic-dependent tests (3200 on real
  layouts: `timer`, `queries-fun`, `layouts`, AI expectations) to `content: 'classic'`; the identity test
  and its recorder already pin it.
- **Conservation.** Value only moves between terms (innerValue -> pile -> bag -> score); `totalValue` is
  computed once at build (after `buildV2`) and never changes.

### Files and owners

| Contract | File | Owner | Consumers |
|---|---|---|---|
| Layout data: `PropVariant`, `PropPlacementDef`, `BreakableKind`, `BreakableDef`, `ItemPadDef`, `GimmickDef` (10 kinds) / `GimmickKind`, `LayoutV2Def { safes, props, breakables, gimmicks, itemPads, eventSpots }`, `LayoutDef.v2?`, `LayoutDef.groundStyle` += `'yard' \| 'funpark'`, `BankRouteDef.via?` (AI hint), `PlannedLayoutId` | `src/sim/types.ts` | C0 (data: C4 existing maps, C4b new maps) | builder, validator, sim build, AI, render, previews |
| `RuleConfig.content? / items? / events? / eventPlan? / gimmicks?` — resolved by `mergeRules` (world.ts): `content` defaults to `'v2'` iff `layout.v2` (and `CONTENT_V2_BY_DEFAULT`), explicit `'v2'` without `layout.v2` throws; `items 'on'`, `events 'on'`, `gimmicks true` in `DEFAULT_RULES`; `eventPlan` undefined = derive from the seed, null = none | `src/sim/types.ts`, `config.ts`, `world.ts` | C0 | game flow (C8 toggles, F7 onboarding, F9 `lastQuick` / `lastEventKind`), harness (C11 A/B) |
| `LootState` add-only: `variant?`, `innerValue?`, `cracks?`, `dormant?`, `airborne?`, `bonkCooldown?` (absent on plain safes / banks) | `types.ts` | C3 (props), C5 (dormant / parachute), C4 (airborne) | rules, AI, render, HUD |
| `CharacterState` add-only: `bag?`, `depositTicks?`, `item?: HeldItem \| null`, `dizzyTicks?` (absent in classic; read with `?? 0`) | `types.ts` | C1 (bag, deposit), C2 (item, dizzy) | police, AI, render, HUD |
| Live state: `CoinPile`, `BreakableState`, `ItemKind`, `HeldItem`, `ItemPickupState`, `HazardState`, `ProjectileState`, `GimmickState`, `LootEventKind`, `MatchEventPlan` (`loot.tick` = the FIRE tick, warning starts `EVENTS.warnTicks` earlier; add-only `loot.truckFrom?`), `MatchEventState` (phase adds `'scheduled'`: exists from tick 0 so pending value is in `totalValue`); `KnockdownCause = SpillCause \| 'self'`. Dormant loot keeps a LootRuntime body with `enabled = false`; airborne loot's disabled body follows the flight arc (`flyBody`) | `types.ts` | C1 / C2 / C4 / C5 | everyone (read-only) |
| `SimState` add-only, always present, empty / null in classic: `coins`, `breakables`, `items`, `hazards`, `projectiles`, `gimmicks`, `matchEvents`, `eventPlan` | `types.ts`, built in `world.ts` | C1 / C2 / C4 / C5 | everyone |
| `SimEvent` members: `coinSpawn` (`source: CoinSpawnSource`), `coinPickup`, `coinDepositStart \| coinDepositCancel`, `coinsBanked`, `bagSpilled` (`cause: SpillCause`), `breakableHit`, `breakableBroken`, `propHit`, `piggyCrack`, `itemIncoming`, `itemSpawn`, `itemPickup`, `itemUse`, `itemHit`, `itemClash`, `itemDropped`, `itemExpired`, `hazard`, `gimmick` (generic `what`), `matchEvent`; add-only fields `fenceBroken.byCharId?` (bankId -1 for non-bank breaks), `recovered.innerValue?` + `recovered.variant?` (props only; F6 points-by-source, F10 predicates), `dashHit.spilled?` (only on the knocking attacker's event) | `types.ts` | emitter per member: C1 coins / breakables, C3 props, C2 items / hazards, C4 gimmick, C5 matchEvent | render (C7), audio (C9), HUD (C8), moments (F5), challenges (F10), results (F6) |
| Id ranges `ITEM_ID_BASE 2000`, `PROJECTILE_ID_BASE 3000`, `HAZARD_ID_BASE 4000`, `KINEMATIC_ID_BASE 5000` (every non-character / non-loot / non-officer physics Body: teacup floors, bumper cars, truck, crane carrier), `COIN_ID_BASE 10000` (officers stay `POLICE_ID_BASE 1000`; layout loot incl. props right after the characters; dormant event loot appended last); allocate with `nextEntityId(ctx, 'item' \| 'projectile' \| 'hazard' \| 'kinematic' \| 'coin')`; loot via `nextLootId(ctx)` + `appendLoot(ctx, state, rt)`; `ITEM_FOREVER` | `config.ts`, `world.ts`, `context.ts` (`ctx.nextIds`) | C0 | C1, C2, C3, C4, C5 |
| `CONTENT_RNG_SALT = 0x17e15` (`ctx.rng`, item deck), `EVENT_RNG_SALT` (inside `planMatchEvents`), `CONTENT_V2_BY_DEFAULT` | `config.ts`, `world.ts`, `context.ts` | C0 | C2 (deck), C5 (plan, curb) only |
| Config blocks: `COINS` + `BREAKABLE_SPECS` + `BREAKABLE_DAMAGE` (C1), `PROP_SPECS` (`PropSpec`) + `PROP_RULES` (C3), `ITEMS` (`ItemSpec`, hammer / goldHammer / plunger / skates / soap, `drop`, `decks`) (C2), `GIMMICKS` (C4/C4b), `EVENTS` (C5); `POLICE` / `BOT_TUNING` values stay with C11 | `config.ts` | per block | — |
| System hooks: `ContentSystem` (`prePhysics`, `beforeSubstep(sub, n)`, `afterSubstep(sub)`, `onImpact(a, b, approach)`, `afterPhysics`, `afterLoading`, `postTick`, `freeze`) + no-op `ContentSystemBase`; `ContentSystems` (`coins`, `props`, `items`, `gimmicks`, `events`, `ordered`, `postOrder`, `onKnockdown(victimId, cause, byId, dir): number` = `coins.spillBag` (not for `'self'`) then `items.dropHeld`), built only for `content: 'v2'` as `ctx.content` after the build; build callbacks never touch `ctx.content` (per-match runtime such as decks lives in the system constructors) | `src/sim/systemBase.ts`, `src/sim/systems.ts`, wired in `sim.ts` | C0 (wiring frozen; sim.ts body C1) | C1–C5 |
| **Knockdown chokepoint** `knockDown(ctx, slot, kvx, kvy, cause: KnockdownCause, byId, ticks = KNOCKDOWN_TICKS): number` — release, timers, knockback, then `ctx.content.onKnockdown`; used by dash hits and police tackles today and by the hammer (C2), skate crash (`'self'`, C2), hazards (C4), gold-safe landing (C5). No package wires spill / item drop at its own knockdown site | `src/sim/actions.ts` | C0 (C2 owns actions.ts) | C1, C2, C4, C5, police |
| Physics: `PhysicsHooks.beforeSubstep?(sub, n)` (before kinematic welds sync); `PhysicsHooks.onBodyImpact?` (non-character impacts; the Simulation routes them to `content.onImpact` only, never to `bump`; C3 makes the solver report them); `Body.fieldVx / fieldVy / dragScale / driveScale / kickable` (neutral defaults; v2 `prePhysics` resets them each tick, then systems ADD fields and MULTIPLY scales; C3 makes the solver read them); `setKinematicPose(b, x, y, a, vx, vy, w)` (stub throws until C3) | `src/sim/physics.ts` | C0 contract, C3 owns physics.ts | C2 soap, C4 belts / slicks / kinematics, C5 truck |
| `CoinSystem.spawnCoins(req: CoinSpawnRequest): EntityId[]`, `spillBag(victimId, cause, byId, dir): number`, `collectDeposits(): DepositClaim[]` (stubs: spawnCoins throws until C1 lands; spillBag returns 0 for an empty bag) | `src/sim/coins.ts` | C1 | C2, C3, C4, C5, police (tackle hook) |
| `buildBreakables(ctx, v2)`, `damageBreakable(ctx, id, damage, byCharId, dir)` | `src/sim/breakables.ts` | C1 | C2 hammer, C4 stomper, C5 quake |
| `buildProps(ctx, v2)`, `addUnanchorProgress(ctx, lootId, amount, byCharId): boolean` (implemented: progress fraction, frees at 1, emits the existing `unanchored`), `flyBody(ctx, lootId, to, ticks, via)` (stub throws until C3), `PropSystem` (C3 keeps a prop's `estimatedValue === baseValue + innerValue`) | `src/sim/props.ts` | C3 | C2 hammer / plunger, C4 stomper / catapult / tube / crane, C5 quake / parachute |
| `buildItemPads(ctx, v2)`, `ItemSystem.onDash(slot)` (rising dash edge with an item and empty hands, called by `processCommands` instead of `startDash`; `startDash` is exported for soap / skates), `ItemSystem.dropHeld(charId)` (called by `onKnockdown`) | `src/sim/items.ts`, hook in `actions.ts` | C2 | knockdown chokepoint |
| `buildGimmicks(ctx, v2)`, `GimmickSystem` | `src/sim/gimmicks.ts` | C4 / C4b | — |
| `planMatchEvents(seed, v2, { avoidKind?, quake? }): MatchEventPlan \| null` (pure, own RNG stream; stub null; re-exported by `index.ts` so game flow builds the `eventPlan` override — never-repeat `lastEventKind`, novice cup without quake), `deriveEventPlan(ctx)` (= `planMatchEvents(seed, layout.v2)`), `buildEvents(ctx, v2)` (resolves `state.eventPlan`; creates scheduled events + dormant loot), `EventSystem` | `src/sim/events.ts` | C5 | game flow (F7 / F9 plan override) |
| Value extension points: `computeRemainingValue(state)` (Σ loot baseValue + innerValue incl. dormant, + piles + bags + unbroken breakables' innerValue + pending event value), `isAllRecovered(state)` (all loot recovered, no piles, empty bags, every breakable broken, no pending value) — used by `updateRemaining`, `checkEnd` and the build; `settleDeposits(ctx, claims)` (step-4 batch after loot, ascending charId, emits `coinsBanked`). Already landed by C0 (classic-safe, the fields are absent in classic): `settle` pays `baseValue + innerValue` and adds `recovered.innerValue` / `variant` for props; dormant / airborne loot never starts recovery, never loads, has no floor, is skipped by `grabCandidate` and by stabilize; props never load into banks; `updateUnanchor` uses `PROP_SPECS[variant].uprootTicks` for props (C3 detects ATM spurt thresholds by comparing `unanchorProgress` with its last-seen value in `afterPhysics`, no edit to `updateUnanchor`) | `src/sim/rules.ts`, `actions.ts`, `sim.ts` | C0 formula, C1 producers | checkEnd, queries, F4 |
| Queries: `heldValue(state, charId)` (held loot estimate + bag), `isCarryable(l)` (not recovered / dormant / airborne), `navClassOf(l)` (prop -> PROP_SPECS kind) | `src/sim/queries.ts` (re-exported by `index.ts`) | C1 | police targeting, C6 bots, C8 HUD, F4 (`MatchPointInfo.bagCharIds?` is F4's add) |
| Moments: `MomentKind` += `coinSplash`, `jackpot`, `hammerBonk`, `homeRun`, `goldHammer`, `tossScore`, `craneDrop`, `eventHaul` (appended to `MOMENT_KINDS`; field table in `src/shared/moments.ts`) | `src/shared/moments.ts` | C0 shape, F5 produces | F3, F4, F8, C8, C9 |

### Build order (`buildV2`, world.ts; v2 only)

`layout.v2.safes` replace `layout.safes` (ids keep the classic order: characters, banks, interiors,
outdoor safes) -> `buildProps` (C3, prop loot ids follow) -> `buildBreakables` (C1) -> `buildGimmicks`
(C4; nothing when `gimmicks: false`) -> `buildItemPads` (C2; nothing when `items: 'off'`) ->
`buildEvents` (C5; dormant event loot appended last) -> `totalValue = remainingValue =
computeRemainingValue(state)`. `ContentSystems` is constructed by the `Simulation` constructor after the
build (systems read what the callbacks built).

### Tick order with content (content-plan §4.4; frozen)

Order of every hook: **coins (C1) -> props (C3) -> items (C2) -> gimmicks (C4) -> events (C5) -> police**;
post-tick only: **police -> events -> items -> gimmicks -> coins -> props**.

1. Commands: `processCommands`; a rising dash edge goes to `items.onDash(slot)` when `ch.item && !ch.grab`,
   otherwise `startDash` (dash cooldown applies to the dash only).
2. Physics: `prepareBodies` -> `content.prePhysics` (first resets every body's `fieldVx / fieldVy /
   dragScale / driveScale` to neutral; then gimmicks add belt / fountain fields and multiply slick
   scales, items multiply soap scales) -> `police.prePhysics` -> substeps (`beforeSubstep` -> integrate / solve -> `checkDashHits` ->
   `content.afterSubstep` -> `police.afterSubstep`; `content.onImpact` from the impact hook, before the
   `bump` cooldown) -> `handleGripBreaks` -> fences -> **`content.afterPhysics`** (projectiles, coins,
   hazards, breakable damage, prop spurts / sheds, gimmick triggers) -> `updateUnanchor` -> stabilize ->
   `syncState` -> `police.afterPhysics`. In `afterPhysics` state poses are still last tick's: read
   `ctx.chars[i].body` / `ctx.loot[i].body`.
3. Loading (unchanged) -> `content.afterLoading` (coin pickup contest: closest center wins, exact tie =
   nobody).
4. `updateRecovery` -> `settle` loot -> `removeRecovered` -> `coins.collectDeposits()` ->
   `settleDeposits` -> `updateRemaining`.
5. Bank bodies -> final countdown (unchanged). 6. `checkEnd` (extended `remainingValue` /
   `isAllRecovered`; earlyDecision stays `max > min + remainingValue`).
7. `police.postTick` -> `content.postTick` (events: warn / fire / truck; items: drop schedule, ground
   expiry; gimmicks: cooldowns); on the ending tick `police.freeze` -> `content.freeze` instead.

### Shared-file ownership (content-plan §6)

`sim/types.ts` C0 (read-only after day 0) · `sim/config.ts` per block · `sim/sim.ts`, `world.ts`,
`rules.ts`, `context.ts` C1 (systems plug in via the hooks and build callbacks above, in their own
files) · `sim/actions.ts` C2 (C1 provides `spillBag`, C3 `addUnanchorProgress`) · `sim/physics.ts` C3 ·
`sim/police.ts` police owner (tackle spill / item drop already go through `knockDown`; C1 adds bag
carriers to tackle eligibility and `heldValue` targeting; C2 hammer / soap stun entry points) · `sim/queries.ts` C1 new helpers, F4 fun functions · `sim/layouts/*`, `validate.ts`,
`tools/layout-check.ts` C4 (existing maps + validator), C4b (new map files) · `ai/bot.ts` C6 (provider
hook, then all new goals; F2 `dashAt` after it) · AI contracts (`src/ai/goals/types.ts` `GoalProvider`,
`GoalKind` adds, `DifficultyParams.itemSkill / gimmickSkill / aimErrorRad`, `BotIntent.phase
'itemWindup'`) are C6's · render `view.ts` `extras` registration C7, beats F3 · `ui/hud/Hud.ts` F4 +
C8 (separate components, one mount point) · `game/match.ts` F5 / F4 (C8 pushes event banners through
F4's queue) · `game/app.ts` F6 / F7 / C10 · `platform/save.ts`, `progress.ts` F9 only · main screen
files C10 · quick setup / preview C8 · `audio/*` F8 + C9 (namespaced director sections).
String prefixes: `item.*`, `hud.item.*`, `hud.bag.*`, `prop.*`, `gimmick.*`, `event.*`, `layout.yard.*`,
`layout.funpark.*`, `front.*`, `news.*`, `onboard.content.*` — each in its own marked block.

Tests guarding these shapes: `test/sim/content-contracts.test.ts` (rules, build skeleton, hook order,
value extension points, deposits, ids, helpers — owners update the stub expectations when they
implement) and `test/sim/content-classic-identity.test.ts` (classic byte-identity). Fuzzers and tests
check conservation against `state.totalValue` captured at tick 0, never a hard-coded 3200.

## Police event (owner addition beyond doc v0.5)

Enabled per match with `rules.police` (default false; quick match and tournament turn it on, the
tutorial and the first match after practice keep it off). Implemented inside the sim
(`src/sim/police.ts`, `src/sim/policeNav.ts`) so it is deterministic and authoritative.

- Uprooting a bank rings its alarm (`alarm` event, `state.alarm.ringing`). If no wave is on the way,
  a car is scheduled after `POLICE.dispatchDelayTicks` (respecting `restTicks` after the last wave).
  The final countdown calls a wave immediately when none is on the field.
- Cars park at the curb just outside the north/south edge on the mirror axis (`policeEntries`,
  `POLICE_CAR`); officers hop in at `officerStepOutSpot(entry, k)`. On the authored layouts
  (`policeDispatch: 'nearestAlarm'`) the car answers the alarm: it parks at the curb nearest the
  oldest bank still ringing (alternating on a tie or when nothing rings); otherwise entries
  alternate by wave.
- Officers (ids from `POLICE_ID_BASE + 1`) chase the visible carrier with the highest held estimate
  (a raccoon dragging a bank whose alarm rings is also heard within `POLICE.hearRadius`),
  split targets between officers, and lunge (`policeTackle`) when close: a hit equals an opposing
  dash hit (forced release + knockdown + protection). Empty-handed raccoons are never tackled, so
  body-blocking is a real tactic. A raccoon dash stuns an officer (`policeStunned`).
- After `shiftTicks` officers walk back and the car leaves (`policeLeaving` → `policeGone`). An
  officer sealed off from its car (no step closer for 8 s, e.g. a bank shoved against the gate)
  squeezes past dynamic bodies (never walls) and still boards only at its car. The getaway wave
  brings `POLICE.getawayOfficers` officers (0 = the usual `officersPerWave`: doc §8 keeps the same
  carrying conditions to the end).
- Police never change scores, loot ownership or recovery; the value invariant (`state.totalValue`) is
  fuzz-tested with police on. Mirror-fairness tests check team 0 and team 1 get mirrored outcomes.
- Render: `src/render/police.ts` + `models/police.ts` (puppy cops, police car with strobe light,
  edge markers). Audio: `MatchAudioDirector` maps police events and alarm loops.
