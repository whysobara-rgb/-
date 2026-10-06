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

1. Read commands (edge detection for dash, latch for grab), pings, grab/release, dash.
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

Invariant at every tick: `scores[0] + scores[1] + remainingValue === totalValue` (3200).

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
officers, whom they run at, the alarm / dispatch clock; an officer's remaining shift is estimated
from its public arrival + the fixed shift, never read from the sim). Carriers route around officers
and burst away; a carrier about to be tackled lets go and dash-stuns the officer a few ticks before
its own hit protection ends (an officer waits beside a downed hauler for exactly that tick), then
picks the load up again; with an officer standing by, a bot stuns it before taking hold of a load,
or keeps its hands off for a moment (bounded) when the dash is not ready; the dash is saved for
stuns (no bank-haul boosts) while an officer is near; a bank the bot was knocked off three times in
20 s is given up for a while (score elsewhere, back when the officers leave). Teammates (incl. the
human's bot mate) body-block and dash-stun an officer chasing a carrying ally; bank hauls are
deferred while a fresh wave is on the field; 눈치왕 cashes in on police chaos (loot an opponent just
lost to a tackle, carriers/hauls with an officer on them). Path planning treats an officer standing
in a one-body passage and a loose safe leaving a sub-body gap beside a wall as cost circles.
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
- Police never change scores, loot ownership or recovery; the 3200 invariant is fuzz-tested with
  police on. Mirror-fairness tests check team 0 and team 1 get mirrored outcomes.
- Render: `src/render/police.ts` + `models/police.ts` (puppy cops, police car with strobe light,
  edge markers). Audio: `MatchAudioDirector` maps police events and alarm loops.
