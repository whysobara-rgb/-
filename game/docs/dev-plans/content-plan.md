# 뿌리째 털어라: "Content 2.0" plan (director's cut, merges the "한 판 더" fun plan)

**Owner's playtest verdict (highest-priority input):**
- Feel and effects are good.
- The early loop (pull a bank, drag it home) is flat and gets old fast ("밋밋하다, 금방 질린다").
- Wants more:
  - action content: an action item (a hammer)
  - varied map structures
  - creative interactive items
  - more things to uproot
  - stronger dopamine
- Wants a real commercial main screen.

**What this plan is.** One buildable round that answers all of that and folds in the still-unbuilt fun plan (`plans/fun-plan.md`).

**Inputs:**
- The items, uproot and maps proposals
- fun-plan.md
- design-v0.5
- ART_DIRECTION
- ARCHITECTURE
- the code at HEAD b2140fc plus the working tree

---

## 0. Tree state, read first

- **Fun-round contracts are frozen and partly stubbed in the working tree.** That covers `matchPointInfo` / `swingInfo` in `src/sim/queries.ts`, `src/shared/moments.ts`, `src/game/{moments,feel,challenges}.ts`, `emoteCancel.cause/hitBy`, `DifficultyParams.dashWindupTicks`, and the save v2 work in `src/platform/progress.ts`.
  - **The fun-plan work packages themselves are not built.**
  - Content 2.0 extends those contracts add-only. It never re-opens them.
- **`npm run build` currently fails at tsc** because of the untracked `test/sim/queries-fun.test.ts:259`, which uses `Simulation.over` (that does not exist; it should be `sim.state.over`). The contracts owner fixes this on day 0.
- **Uncommitted owner and contract work** is present in:
  - `bot.ts`, `params.ts`, `ai/types.ts`
  - `audio/director.ts`, `game/match.ts`, `game/setup.ts`
  - `platform/progress.ts`, `render/view.ts`
  - `sim/config.ts`, `sim/types.ts`, `sim/queries.ts`
  - the strings files

  Build on the tree as it is. Never revert anything.
- **Owner overrides of design-v0.5, recorded on day 0** as a new §22 "Content 2.0 오너 결정" in `docs/design-v0.5.md`:
  1. **Toy action items are allowed.** They are picked up by touch and used with the existing dash and grab buttons. There are still no new buttons and no multipliers.
  2. **The economy grows from 3,200 to 4,000** per match map (4,400 with a loot event), and it adds a loose-coin layer.
  3. **Map gimmicks, 2 new maps and scheduled mid-match events** are added.
  4. **Hammers may break fences.**
  5. **Unchanged:** confirmed score cannot be taken; ties are draws; recovery needs value brought home; no catch-up bonuses, rubber-banding, loot boxes or currencies.

---

## 1. Director's diagnosis

From the three proposal teams' headless play and screenshots, plus the fun-plan baseline (n=180 proxy, police on):

1. **Verb starvation.** The game has two verbs: grab (pull or carry) and dash (shove or boost). In the first 30 s the only legal action is walking to a safe.
   - The player's first score comes at about 31 s (38 s on shortcut).
   - 13% of the match is dead time (18% on plaza).
   - Dash has **no world use**: nothing in the world reacts to it.
2. **No small payoffs between big ones.** A knockdown gains nothing visible. The only rewards are 100, 300 or 500+ recoveries every 20–40 s.
3. **Every match runs the same script** (uproot, drag, recover). Nothing new appears mid-match, and nothing in the world moves by itself. That is exactly "금방 질린다".
4. **Still true from the fun plan:**
   - The climax rarely plays: 28% of countdowns run the full 30 s.
   - The game computes tension but never shows it.
   - Rivals have no pulse.
   - New players hit a wall.
5. **The main screen does not read as commercial.**
   - A 200 px logo sits top-left and five small signboards are bunched at the left edge.
   - There is no big Play button, player card, next goal or news.
   - First launch opens a modal over everything.

**Director's thesis.** Keep the two buttons and multiply what they *do*. The game gets:
- a coin layer, so something pays out every 3–5 s and every bonk visibly spills value
- one signature toy weapon, the 뿅망치, plus a small curated item deck that changes every match
- three hero uprootables that each give the uproot a new twist
- one signature gimmick per map that turns hauling into a new verb
- one announced mid-match spectacle per match
- a front door that sells all of this in one glance

The identity sentence must stay true: **"뿌리째 뽑아서 우리 차로 끌고 온다. 움직이는 은행에서 빼 온다."** Every addition is either a new way to pull something out, a new way to haul it home, or a new way to take it from someone who is hauling.

---

## 2. Decisions: what is in, what is cut

### In (curated set)

| Area | In | Why |
|---|---|---|
| Economy | **Loose coins (동전 10 / 지폐 다발 50) + 주머니 (coin bag) + 쏟아붓기 (deposit) + 와르르 (spill)** | Payoff every few seconds. Every knockdown visibly matters. 10-point granularity cuts exact ties. |
| Uprootables | **동전 ATM** (starter, coins spurt while you tug), **대왕 돼지저금통** (kickable kickoff ball, smash for a jackpot), **돈나무** (literally uproot a cash tree, which sheds bills on impact) | Each one is a different verb on the same buttons: tug-spurt, kick and smash, careful carry. The 돈나무 is the most on-brand clip moment. |
| Breakables | **나무 상자** (crate), **자판기** (vending machine) | Something to dash at in the first 5 s, plus small coin pops. |
| Items | **뿅망치** (squeaky toy hammer, owner ask) + **황금 뿅망치** (climax drop), then **뚫어뻥** (plunger yank), **로켓 롤러스케이트**, **비누 거품** (soap slick). Gated wave 3 candidates: 풍선 다발, 재채기 연막. | The hammer answers the owner directly. The other three each add one new verb: ranged steal, speed, trap-and-highway. |
| Drops | **보급 풍선 (supply balloons)**: mirrored item pads + 1 axis pad, a public schedule, a seeded deck, same item on both twins | Mid-match novelty and a decision every ~25 s. Every match plays differently. |
| Existing maps | One signature gimmick each: 광장 **무빙워크 + 분수 쇼**; 상가 **택배 슈트** (+ hammerable fences); 창구 **시소 투석기 + 시계탑 알림** | The first 30 s get a toy. Each map gets a new hauling verb. |
| New maps | **뚝딱 공사장** (belts, crane express, pile drivers) and **반짝 놀이공원** (twin teacups, bumper rinks, Ferris-wheel safes, night) | The two most spectacular hauling verbs: "my bank is flying over your head" and slingshot pinball. 공사장 reuses belts, so it ships first. |
| Events | One **loot event** per match: **돈비**, **황금 금고** or **현금 수송차** (400 each). Plus a 50% **지진** modifier (value-neutral). | A different mid-game beat every match. It guarantees value on the field in the climax. |
| Main screen | Boot splash, front door rewrite (marquee logo, big 게임 시작, player card, next-goal card, mode cards, news ticker), hideout `'front'` framing, play-press ceremony | The owner's explicit ask. It also advertises the new variety. |
| Fun plan | **All 10 packages kept.** WP1 re-scoped (§6). The others extended add-only. | Tension HUD, moments, results hooks, cups and first-hour path, save v2, challenge book, tension audio and bot taunts are still the retention backbone. |

### Cut or deferred (and why)

| Cut | Reason |
|---|---|
| 말굽자석 (magnet) | Overlaps the plunger's yank and coin pickup. One more icon to learn. |
| 뿅 스프링 발판 (placeable launch pad) | Landing-inside-geometry risk. The catapult and teacups already deliver the launch fantasy. |
| Lamp or sign ram pole | A second melee weapon dilutes the hammer. Revisit if hammer telemetry says players want a long-reach option. |
| Manhole tunnels, hydrant geysers, hydrant water jets | Readability (holes are hard to see at camera distance) and nav cost (temporary jump links). |
| Bench barricades, phone-booth secret safe | Low dopamine per day of work. |
| 황금 너구리 동상 (wobble statue) | A new physics state (topple) for a third "heavy careful carry" that the 돈나무 already covers. |
| 자판기 soda slick | The soap item owns the slick verb. The vending machine stays a breakable. |
| Seeded "prop deck" per match | Fixed props keep maps learnable and cheap to validate. Items and events supply the per-match variance. |
| 보석 진열장 bank-interior variant | Good, but a second bank rule set. Round 3. |
| 칙칙폭폭 시장역, 노을 부두 maps | L-size each, with time-windowed nav for bots. Build after 공사장 and 놀이공원 prove the gimmick framework. |
| 정전 (blackout) event | Lighting, perception and accessibility work for one event. Round 3. |
| Mood variants (rain, snow, festival) | Render-only variety, not dopamine. Round 3. |
| "뿅 피드" corner ticker | Stamps and the moments system already narrate. Avoid HUD clutter. |
| Instant replay, results photo | Still fun-plan round 2. They build on WP5's command log. |

### Identity guards, checked every wave

- **Banks stay the main event.** Bank share of points (bank recoveries including loaded safes) must stay between 30% and 45%. No single non-bank source may exceed 25% of points.
- **Items never carry value.** Value only becomes score through zone recovery or a bag deposit.
- **Readability budget:**
  - per map, one signature hazard and at most two interactable gimmicks
  - at most 4 item pickups on the field
  - at most 1 loot event and 1 modifier per match
  - events never stack and are always announced

---

## 3. Economy and scoring rules (precise)

### 3.1 Value sources

| Source | Shell value (recovered as loot) | Coins inside | How the coins come out |
|---|---:|---:|---|
| 작은 금고 | 100 | 0 | – |
| 큰 금고 | 300 | 0 | – |
| 은행 | 500 + loaded unrecovered safes | 0 | – (interior 2 small + 1 large, unchanged) |
| **동전 ATM** | 100 | 100 (10 × 동전 10) | While a character strains to uproot it: 2 coins at 1/3 and 2 at 2/3 of progress. Dash bonk (approach ≥ 4 m/s, 0.5 s cooldown per ATM): 2 coins. Hammer hit: 3 coins + 0.5 uproot progress. Whatever is left rides inside. |
| **대왕 돼지저금통** | 0 | 300 (4 × 지폐 50 + 10 × 동전 10) | Free-standing and kickable. 3 cracks smash it: an opposing dash hit = 1, a hammer hit = 2, a wall impact ≥ 5 m/s = 1, fountain show / pile driver = 1. On the last crack, every coin bursts out radially ("잭팟!"). Recovered intact it pays 300. |
| **돈나무** | 100 | 200 (4 × 지폐 50) | Uproot 2.5 s. One bundle sheds per impact > 2.5 m/s (wall, bump, its carrier knocked down). A hammer hit sheds 2. |
| **나무 상자** (breakable) | – | 20 (2 × 10) | Broken by 1 dash hit or 1 hammer hit. |
| **자판기** (breakable, 3 HP) | – | 60 (6 × 10) | Dash hit: −1 HP, pops 1 coin. Hammer: −3. At 0 HP the rest pops out. |
| **황금 금고** (event) | 400 | 0 | – |
| **돈비** (event) | – | 400 (8 × 50) | Falls in a ring. |
| **현금 수송차** (event) | – | 400 (8 × 50) | Rear door HP 5, then a fan of bundles. |

**Coins inside a shell are settled with the shell**, the same way a bank pays for its loaded safes. Hauling a half-shaken ATM home pays 100 + the coins still inside.

### 3.2 Per-map composition (every match map: base 4,000; +400 with a loot event)

| Group | Count and placement rule | Value |
|---|---|---:|
| Banks (500 + interior 500) | 2 (unchanged positions) | 2,000 |
| 큰 금고 | 2, on the axis (or a mirrored pair) | 600 |
| 작은 금고 | 2, one per side (mirrored). On 놀이공원: both in Ferris-wheel gondolas, on the axis. | 200 |
| 동전 ATM | 2, the mirrored **starter socket**. 8–12 m walk from the spawns, at least 6 m outside the own zone edge, outside every bank-route sweep. | 400 |
| 대왕 돼지저금통 | 1, on the axis, at a contested kickoff spot | 300 |
| 돈나무 | 1, on the axis, in a planter bed. Its haul paths to both zones must have no turn tighter than a 2.5 m lane (layout-check `propHaul`). | 300 |
| Breakables | Per side: 2 crates + 1 vending machine, mirrored. None within 6 m of a zone edge. At least one crate on each spawn's natural path, 5–9 m from spawn. | 200 |
| **Base total** | | **4,000** |
| Loot event (when on) | Dormant from tick 0 | +400 |

**Per-map retrofit of existing outdoor safes (v2 composition):**
- **수집 광장:**
  - Keep: the 2 axis dock large safes and 1 corner-nook small safe per side.
  - The fountain-north small safe becomes the 대왕 돼지저금통 and the fountain-south one becomes the 돈나무.
  - Drop the other corner small safe per side.
  - ATMs go at the starter socket.
- **지름길 상가:**
  - Keep: the 2 back-street large safes and the courtyard small safe per side.
  - Drop the back-street market small safe per side. The ATM goes near its old spot, which was the warm-up spot the fun plan wanted.
  - 돼지 and 돈나무 go in the central crossing, north and south of the axis.
- **열린 창구:**
  - Keep: the 2 square large safes and the edge-nook small safe per side.
  - 돼지 and 돈나무 flank the clock tower on the axis.
- **공사장 / 놀이공원:** authored to the table above (see §5.3).

**Tutorial** stays classic (3,200, no coins, items or events).

**Theoretical shares:**
- Banks are 50% of base value (45% with an event). Measured bank share of points is about 41% today against a 62.5% theoretical share, so the gate is a measured 30–45%.
- Coins: up to 1,300 can become loose coins (ATM 200 + 돼지 300 + 돈나무 200 + breakables 200 + event 400). The target coin share of points is 12–25%.

### 3.3 Coin rules

- **Piles.** Coins exist as piles (`CoinPile`) of value 10 (동전) or 50 (지폐 다발).
  - Point bodies with drag 4/s. They collide only with statics and the arena bounds (via `isFreeCircle`).
  - Bank walls and characters pass over them. They do not ride bank floors.
  - Belts, the fountain show and bumper rinks move them.
  - A pile that comes to rest inside a static is moved to the nearest free spot (`spiralSearch`).
  - **Coins never despawn.**
- **Spawn pattern.** Fixed tables relative to the source and hit direction, with no RNG: a fan of ±60° for hits, radial for smashes, a ring for 돈비. A mirrored hit yields mirrored piles. Fixed speeds per index are `[3.0, 4.2, 3.6, 4.8, 3.3, 4.5, …]` m/s.
- **Pickup (by touch, no button).**
  - Any non-knocked-down character whose center is within 0.8 m of a pile takes it, if `bag + value ≤ 200` (`COINS.bagCap`).
  - Allowed while carrying loot, dashing or holding an item.
  - **Same-tick contest:** the closest center wins. On an exact distance tie, nobody takes it that tick. Slot order never decides.
- **Bag (주머니).**
  - `CharacterState.bag` is 운반 중 (carrying) value. It is never score. The HUD shows it inside the carrying readout.
  - The bag is drawn on the raccoon's back and grows with its value.
- **Deposit (쏟아붓기).**
  - A character whose center is inside **its own team's** zone (zone OBB shrunk by the character radius), not knocked down, for **0.5 s continuously** deposits the whole bag.
  - Leaving the zone or being knocked down resets the timer.
  - Deposits settle in step 4 **together with** loot recoveries (same-tick batch, doc §8). Event: `coinsBanked`.
  - Coins lying on the ground inside a zone are **not** auto-scored. Someone has to pick them up and deposit them.
  - Rationale for 0.5 s instead of 1.5 s: a bag cannot be dragged out of a zone, only knocked loose, so the long contest dwell is not needed.
- **Spill (와르르).**
  - Triggered by a knockdown caused by an opposing dash, a hammer, a police tackle, or a gimmick or event hazard (pile driver, catapult landing, gold-safe landing).
  - The victim spills `max(10, floor(bag / 2 / 10) × 10)` (capped at the bag) as 동전 10 piles, fanned ±60° around the knockback direction.
  - A self-inflicted crash (skate wall crash) spills nothing. Protected characters cannot be knocked down, so they cannot spill.
  - The victim cannot pick up its own spilled piles for 1.0 s (`noPickupCharId` / `noPickupUntil`). Everyone else can, immediately.
- **Police.** The officers' target estimate adds the bag value. A character with empty hands **and** an empty bag is still never tackled, so body-blocking survives.
- **Bots** see coins, bags and pile positions as public state, the same as loot.

### 3.4 Recovery rules (doc §8, extended)

- **Unchanged:**
  - A free safe or prop shell fully inside a zone for 1.5 s scores.
  - Only pulling it out of the zone resets the timer.
  - A bank pays 500 + its loaded unrecovered safes.
  - Each id settles once.
  - Recovered loot is removed.
  - Same-tick completions settle together.
- **Props (`variant != null`) pay `baseValue + innerValue`** at completion. `recovered` gains add-only `innerValue?`.
- **Props never count as bank-loaded contents.** Only plain safes load, which avoids stacking edge cases. A prop on a bank floor rides the floor like any body.
- **Dormant loot** (event loot before it appears, Ferris-wheel gondola safes outside their window) has no body, cannot be grabbed and cannot be recovered. It still counts in `remainingValue`.
- **Airborne loot** (catapult, tube, crane, parachute) cannot be grabbed or recovered while flying.
- **Ties are draws.** Confirmed score is never reduced.

### 3.5 Conservation invariant (checked every tick in fuzz tests)

```
scores[0] + scores[1] + remainingValue === totalValue   (constant from tick 0)

remainingValue = Σ unrecovered loot (baseValue + innerValue)      // dormant included
               + Σ coins[].value                                   // loose piles
               + Σ characters[].bag                                // bags
               + Σ unbroken breakables[].innerValue
               + Σ matchEvents[].pendingValue                      // 돈비 / 수송차 coins not yet spawned
```

- **`earlyDecision`** stays exact: `max > min + remainingValue`. Equality means play on.
- **`allRecovered`** ("모두 털림") requires all of the following: every loot item recovered, no piles, every bag empty, every breakable broken, and no pending event value.
- **Value only moves between terms. It is never created or destroyed.**
  - A spurt moves `innerValue` to a pile.
  - A pickup moves a pile into a bag.
  - A deposit moves a bag into a score.
- **Tests and fuzzers replace the hard-coded 3200 with `state.totalValue`.** The harness already reads `st.totalValue`.

### 3.6 Ruleset switch (for A/B, onboarding and the tutorial)

- `RuleConfig.content: 'classic' | 'v2'`. Default: `'v2'` when the layout has `v2`, otherwise `'classic'`.
- Classic = today's game (3,200, no coins, props, items, gimmicks or events).
- `'v2'` replaces `layout.safes` with `layout.v2.safes` and builds props, breakables, gimmicks, item pads and event spots.
- `items: 'off' | 'hammerOnly' | 'on'` (default `'on'`), `events: 'off' | 'on'` (default `'on'`), `gimmicks: boolean` (default `true`). These can each be toggled for harness blocks and onboarding.

---

## 4. Shared sim contracts (frozen on day 0, add-only)

The contracts owner (**C0**) lands these on day 0. The sim wiring skeleton has no-op systems, so every package compiles against the final shapes from day 1. Nobody else edits `types.ts`. Each package owns its own block in `config.ts`.

### 4.1 `src/sim/types.ts` additions

```ts
// layouts
export type LayoutId = 'plaza' | 'shortcut' | 'counter' | 'tutorial' | 'yard' | 'funpark';
// LayoutDef.groundStyle += 'yard' | 'funpark'
export type PropVariant = 'atm' | 'piggy' | 'moneyTree' | 'goldSafe';
export interface PropPlacementDef { variant: PropVariant; pos: Vec2; angle: number }       // builder mirrors unless on axis
export type BreakableKind = 'crate' | 'vending';
export interface BreakableDef { id: string; kind: BreakableKind; center: Vec2; half: Vec2; angle: number }
export interface ItemPadDef { id: string; pos: Vec2; twin: string | null }                 // null = axis pad
export type GimmickDef =
  | { id: string; kind: 'belt'; obb: OBB; dir: number; speed: number }
  | { id: string; kind: 'fountainShow'; center: Vec2; radius: number; firstTick: number; periodTicks: number; telegraphTicks: number; push: number }
  | { id: string; kind: 'tube'; intake: OBB; exit: Vec2; exitDir: number; transitTicks: number; twin: string | null }
  | { id: string; kind: 'catapult'; seat: OBB; pedal: OBB; landing: Vec2; flightTicks: number; cooldownTicks: number; twin: string | null }
  | { id: string; kind: 'crane'; base: Vec2; cab: Vec2; pads: [OBB, OBB]; drops: [Vec2, Vec2]; cooldownTicks: number }
  | { id: string; kind: 'stomper'; center: Vec2; radius: number; periodTicks: number; phaseTicks: number; telegraphTicks: number; twin: string | null }
  | { id: string; kind: 'teacup'; center: Vec2; radius: number; stepAngle: number; moveTicks: number; restTicks: number; spin: 1 | -1; twin: string | null }
  | { id: string; kind: 'slick'; obb: OBB; dragScale: number; driveScale: number }
  | { id: string; kind: 'bumperCar'; path: Vec2[]; periodTicks: number; phaseTicks: number; radius: number; twin: string | null }
  | { id: string; kind: 'wheel'; platform: OBB; gondolas: number; periodTicks: number; windowTicks: number; safeGondolas: number[] };
export interface LayoutV2Def {
  safes: SafePlacementDef[]; props: PropPlacementDef[]; breakables: BreakableDef[];
  gimmicks: GimmickDef[]; itemPads: ItemPadDef[]; eventSpots: Vec2[];
}
// LayoutDef.v2?: LayoutV2Def;   BankRouteDef.via?: { gimmickId: string; kind: 'cranePad' | 'belt' } (AI hint only)

// rules
// RuleConfig.content?: 'classic' | 'v2'; items?: 'off' | 'hammerOnly' | 'on'; events?: 'off' | 'on';
// RuleConfig.eventPlan?: MatchEventPlan | null (undefined = derive from seed); gimmicks?: boolean;

// loot (LootState add-only)
//   variant?: PropVariant | null; innerValue?: number; cracks?: number; dormant?: boolean;
//   airborne?: { fromTick: number; toTick: number; from: Vec2; to: Vec2; via: 'catapult' | 'tube' | 'crane' | 'parachute' } | null;
//   bonkCooldown?: number;

// characters (CharacterState add-only)
//   bag?: number; depositTicks?: number; item?: HeldItem | null; dizzyTicks?: number;

export interface CoinPile { id: EntityId; pos: Vec2; vel: Vec2; value: 10 | 50; noPickupCharId: EntityId | null; noPickupUntil: number }
export interface BreakableState { id: string; kind: BreakableKind; center: Vec2; half: Vec2; angle: number; hp: number; innerValue: number; broken: boolean }
export type ItemKind = 'hammer' | 'goldHammer' | 'plunger' | 'skates' | 'soap' | 'balloons' | 'smoke';
export interface HeldItem { kind: ItemKind; uses: number; expiresTick: number; cooldown: number;
  phase: 'idle' | 'windup' | 'active' | 'recover'; phaseTicks: number; aim: number }
export interface ItemPickupState { id: EntityId; kind: ItemKind; padId: string | null; pos: Vec2;
  phase: 'incoming' | 'ground'; landTick: number; expiresTick: number; uses: number }
export interface HazardState { id: EntityId; kind: 'slick' | 'smoke'; pos: Vec2; radius: number; untilTick: number; ownerTeam: TeamId }
export interface ProjectileState { id: EntityId; kind: 'plunger'; ownerId: EntityId; pos: Vec2; vel: Vec2; dieTick: number }
export interface GimmickState { id: string; kind: GimmickDef['kind']; phase: 'idle' | 'telegraph' | 'active' | 'busy' | 'cooldown';
  phaseTick: number; nextTick: number; pose: { x: number; y: number; angle: number }; busyWith: EntityId[]; stunTicks?: number }
export type LootEventKind = 'moneyRain' | 'goldSafe' | 'cashTruck';
export interface MatchEventPlan { loot: { kind: LootEventKind; tick: number; spot: number } | null; quake: { tick: number } | null }
export interface MatchEventState { kind: LootEventKind | 'quake'; phase: 'warn' | 'active' | 'done'; startTick: number;
  pos: Vec2; pendingValue: number; doorHp?: number; truckFrom?: 'north' | 'south' }

// SimState add-only:
//   coins: CoinPile[]; breakables: BreakableState[]; items: ItemPickupState[]; hazards: HazardState[];
//   projectiles: ProjectileState[]; gimmicks: GimmickState[]; matchEvents: MatchEventState[]; eventPlan: MatchEventPlan | null;
```

**Entity id ranges.** Each range follows the `POLICE_ID_BASE` pattern, so order stays stable and nothing collides:

| Entities | Ids |
|---|---|
| Characters | 1..n |
| Layout loot (banks, interiors, safes, props) | after the characters |
| Dormant event loot | appended at build |
| Officers | 1000+ |
| Items | 2000+ |
| Projectiles | 3000+ |
| Hazards | 4000+ |
| Coin piles | 10000+, monotonically increasing |

### 4.2 `SimEvent` additions (add-only union members)

```ts
| { type: 'coinSpawn'; tick; ids: EntityId[]; total: number; pos: Vec2;
    source: 'spurt' | 'bonk' | 'break' | 'smash' | 'shed' | 'spill' | 'rain' | 'truck' | 'quake'; sourceId: EntityId | string | null; byCharId: EntityId | null }
| { type: 'coinPickup'; tick; charId; coinId; value; bag }
| { type: 'coinDepositStart' | 'coinDepositCancel'; tick; charId; team }
| { type: 'coinsBanked'; tick; charId; team; value }
| { type: 'bagSpilled'; tick; charId; value; byId: EntityId | null; cause: 'dash' | 'hammer' | 'police' | 'hazard' }
| { type: 'breakableHit'; tick; id: string; hp: number; byCharId: EntityId | null }
| { type: 'breakableBroken'; tick; id: string; byCharId: EntityId | null }
| { type: 'propHit'; tick; lootId; byCharId: EntityId | null; how: 'dash' | 'hammer' | 'impact' | 'plunger' | 'hazard'; coins: number }
| { type: 'piggyCrack'; tick; lootId; cracks: number; smashed: boolean; byCharId: EntityId | null }
| { type: 'itemIncoming'; tick; padId: string; kind: ItemKind; landTick: number }
| { type: 'itemSpawn'; tick; itemId; kind: ItemKind; pos: Vec2 }
| { type: 'itemPickup'; tick; charId; itemId; kind: ItemKind }
| { type: 'itemUse'; tick; charId; kind: ItemKind; phase: 'windup' | 'fire' }
| { type: 'itemHit'; tick; charId; kind: ItemKind; target: 'char' | 'police' | 'loot' | 'breakable' | 'fence' | 'gimmick' | 'event';
    targetId: EntityId | string; knockdown: boolean; homeRun?: boolean }
| { type: 'itemClash'; tick; aId; bId }
| { type: 'itemDropped'; tick; charId; itemId; kind: ItemKind; uses: number; pos: Vec2 }
| { type: 'itemExpired'; tick; charId: EntityId | null; itemId: EntityId | null; kind: ItemKind }
| { type: 'hazard'; tick; id; kind: 'slick' | 'smoke'; phase: 'start' | 'end'; pos: Vec2 }
| { type: 'gimmick'; tick; id: string; what: string; pos?: Vec2; ids?: EntityId[] }      // generic, keeps the union stable
| { type: 'matchEvent'; tick; kind: LootEventKind | 'quake'; phase: 'warn' | 'start' | 'open' | 'end'; pos?: Vec2 }
// fenceBroken: add-only `byCharId?: EntityId` (bankId stays -1 for non-bank breaks)
// recovered:   add-only `innerValue?: number`
// dashHit:     add-only `spilled?: number`
```

### 4.3 `src/sim/config.ts` blocks (one owner each)

| Block | Contents | Owner |
|---|---|---|
| `COINS` | `bagCap: 200`, `pickupRadius: 0.8`, `depositTicks: 30`, `spillFraction: 0.5`, `spillMin: 10`, `ownSpillLockTicks: 60`, `drag: 4`, `fanHalfAngle: 60°`, `speeds[]` | C1 |
| `BREAKABLE_SPECS` | `crate {hp 1, inner 20, half 0.45²}`, `vending {hp 3, inner 60, half 0.6×0.5}` | C1 |
| `PROP_SPECS` | One row per variant. See the table below. | C3 |
| `ITEMS` | Per-item specs (§5.2) plus `drop: { pairs: [15,70,125,160] s, center: [45,100] s, warnTicks: 180, maxOnField: 4, groundLifetime: 1800, goldHammer: 'countdown+8s or end−35s' }` | C2 |
| `GIMMICKS` | Shared defaults (belt speed 2.2, catapult arm speed, crane timings, …) | C4 |
| `EVENTS` | `lootWindow: [75,110] s`, `warnTicks: 300`, `countdownFireDelay: 180`, `quakeChance: 0.5`, `quakeWindow: [130,175] s`, `quakeGapTicks: 1800`, `truckDoorHp: 5`, `truckAutoOpen: 1800` | C5 |
| `POLICE`, `BOT_TUNING` values | Tuning only | C11 (single tuning owner) |

`PROP_SPECS` rows (nav class comes from `kind`, so AI ripple stays small):

| Variant | Kind (nav class) | Shape | Size | Mass | Drag | Uproot | Shell | Inner | Carry speed |
|---|---|---|---|---:|---:|---|---:|---:|---|
| atm | largeSafe | box | half 0.55 × 0.45 | 90 | 3.75 | 3 s | 100 | 100 | about 3.2 m/s |
| piggy | largeSafe | circle | r 0.75 | 60 | 1.2 | free-standing | 0 | 300 | about 4.5 m/s |
| moneyTree | largeSafe | box | half 1.2 × 0.4 | 110 | 3.75 | 2.5 s | 100 | 200 | about 3.0 m/s |
| goldSafe | largeSafe | box | half 0.75 × 0.65 | 140 | 3.75 | 2.5 s | 400 | 0 | about 2.7 m/s |

The piggy is flagged **kickable**.

### 4.4 Tick order (extends ARCHITECTURE "Per-tick order"; frozen)

All system hooks have a fixed call order: **coins (C1) → props (C3) → items (C2) → gimmicks (C4) → events (C5) → police**.

1. **Commands.** `processCommands` sends the rising dash edge to `items.use()` when `ch.item && !ch.grab`, otherwise to `startDash`. Skates modify `startDash` and the carry boost. Plunger aim is taken from the facing.
2. **Physics.**
   - `prePhysics`: gimmick kinematic poses and fields; item wind-up and swing phase; police.
   - Substeps:
     - `beforeSubstep`: kinematic pose = f(tick, sub), so nothing drifts.
     - `afterSubstep`: `checkDashHits`, item swing arcs, kick and impact detection, collected then applied in id order (order-independent).
   - `afterPhysics`:
     - integrate projectiles and coins
     - expire hazards
     - breakable damage
     - prop spurts and sheds
     - gimmick triggers (catapult, tube, crane, stomper, wheel window)
     - `updateUnanchor` (plus an `addUnanchorProgress()` helper used by the hammer, plunger, stomper and quake, which emits the existing `unanchored` event)
3. **Loading** (unchanged), then **coin pickup** (contest rule §3.3).
4. **Recovery and settlement.** Loot recoveries and bag deposits are collected, then settled in one batch (ascending id; bag deposits after loot within a team, which is irrelevant to the totals).
5. **Bank bodies → final countdown** (unchanged).
6. **End check** (the extended `remainingValue` and `allRecovered`).
7. **Post-tick:** police, then events (warn, fire, truck), then items (drop schedule, ground expiry), then gimmicks (cooldowns). Each system has a `freeze()` that runs once `over` is set.

**One seeded RNG** is used only for the item deck, the event plan and the truck's curb side: `ctx.rng = createRng(setup.seed ^ 0x17E15)`. Everything else is a pure function of state and tick, so mirrored situations produce mirrored outcomes.

### 4.5 Other frozen interfaces

- **Physics (C3 owns `physics.ts`):**
  - Per-body `fieldVx`, `fieldVy`, `dragScale`, `driveScale`, set in `prepareBodies` from belts, slicks and soap.
  - A `kickable` flag: a dashing character skips `softPushFactor` against it.
  - `setKinematicPose(b, x, y, a, vx, vy, w)`.
  - Kinematic floors carry riders: step 7 relaxes `f.motion !== 'dynamic'`.
  - `flyBody(loot, to, ticks, via)`: disables the body, lands at `to` or the nearest free spot (via `spiralSearch`), with UNSTUCK / STALL_RESCUE as the fallback.
- **Queries (C1 owns the additions in `queries.ts`; F4 owns the fun functions):**
  - `heldValue(state, charId)` = loot estimate + bag.
  - `isCarryable(l)` and `navClassOf(l)`.
  - `matchPointInfo` and `swingInfo` read the new `remainingValue` automatically. F4 adds bag carriers as loads: add-only `bagCharIds?: EntityId[]` on `MatchPointInfo`.
- **Moments (F5, add-only `MomentKind`s):**

  | Kind | When |
  |---|---|
  | `coinSplash` | A team caused a spill ≥ 60 |
  | `jackpot` | Piggy smashed, or truck opened |
  | `hammerBonk` | Hammer KO on a carrier, or on a bag ≥ 100 |
  | `homeRun` | Hammer on a soaped victim |
  | `goldHammer` | Picked up |
  | `tossScore` | Tossed or tubed loot recovered within 6 s |
  | `craneDrop` | Crane cat stunned mid-swing |
  | `eventHaul` | A team recovered ≥ 200 of the event value |

  `bigPlay` scoring adds: jackpot 3, hammerBonk on a bank hauler 4, craneDrop 4, homeRun 3. Streak thresholds become fractions of `totalValue`: tier 1 at 25%, tier 2 at 31%. A deposit of ≥ 50 counts as a recovery for runs.
- **AI goal providers (C6 owns this new contract):**
  - `src/ai/goals/types.ts`: `GoalProvider { kinds: GoalKind[]; propose(view: BotView, out: Candidate[]): void; execute(view: BotView, goal: Goal): Command | null }`.
  - `bot.ts candidates()` / `executeGoal()` call the registered providers. Existing goals stay in place.
  - `GoalKind` add-only: `'smash' | 'scoop' | 'deposit' | 'fetchItem' | 'bonk' | 'useItem' | 'kickPiggy' | 'useGimmick' | 'collectEvent' | 'stunCraneCat' | 'grabGondola'`.
  - `DifficultyParams` add-only: `itemSkill` (novice 0.4 / normal 0.75 / challenge 1.0), `gimmickSkill` (0.4 / 0.8 / 1.0), `aimErrorRad` (25° / 10° / 4°). These change decision rate and aim only, never physics.
  - `BotIntent.phase` adds `'itemWindup'`.
- **Render (C7 owns the new sync modules; F3 owns the beats):**
  - `view.ts` gets one registration point: `this.extras = [coinsSync, itemsSync, propsSync, gimmickSync, eventSync]`, each `{ sync(state, alpha), onEvents(events), dispose() }`.
  - New effects APIs: `coinFountain(pos, dir, n)`, `bonkImpact(pos, dir, big)`, `stamp(key, pos)` for 뿅! / 와르르! / 잭팟! / 홈런! / 털렸다! / 챙! / 쿵! / 슝!.
- **Strings:** namespaced blocks, one owner each. Prefixes:
  - `item.*`, `hud.item.*`, `hud.bag.*`
  - `prop.*`, `gimmick.*`, `event.*`
  - `layout.yard.*`, `layout.funpark.*`
  - `front.*`, `news.*`, `onboard.content.*`
- **Save (F9 only):** add-only fields:
  - `lastQuick` `{layout | 'random', mode, difficulty, items, events}`
  - `seenItems[]`, `seenLayouts[]`, `lastSeenVersion`, `lastEventKind`
  - `records.biggestSplash`, `records.biggestDeposit`

---

## 5. Content specs

### 5.1 Uprootables and breakables (summary of feel)

| Thing | Verb it adds | Signature moment | Presentation |
|---|---|---|---|
| 동전 ATM | **Tug-spurt:** coins shoot out while you strain, and a rival standing next to you can snatch them. **Bonk:** dash it for 2 coins. | First payoff in about 3 s. "Shake it, or haul it whole?" | Beep-boop, then a cha-ching; receipt streamers; a "잔액 부족?!" screen; 40 ms hit-stop per spurt. |
| 대왕 돼지저금통 | **Kick** (a dash knocks it about 6 m), **smash** (3 cracks). | The kickoff becomes a soccer scramble on the axis. Smash it when you're behind or contested. | Squeaky synth "oink" glide, crack decals, a radial coin burst with "잭팟!", slow-mo only for big plays (respects reduced motion). |
| 돈나무 | **Careful carry:** bills shed on every hard impact. | "He pulled out a TREE of money." Fast or careful? | Root ball tearing out of the bed with soil chunks and a crackle-thump; fluttering bill leaves (instanced); bills rain on impacts. |
| 나무 상자 / 자판기 | **Dash at the world.** | Something to hit within 5 s of spawn. | Splinters (`DebrisBurst`); the vending machine coughs coins; fictional brand "꿀꺽". |

### 5.2 Items

**Rules for every item:**
- **R1, one pocket.** Pickup by touch. A full pocket ignores other items. No swapping.
- **R2, items add to the dash.** Empty-handed, dash uses the item. While holding loot, dash is the normal carry boost (skates excepted).
- **R3, visible, symmetric and finite:**
  - Uses and a lifetime per item.
  - A knockdown drops the item at your feet with its remaining uses.
  - Mirrored twins get the same item.
  - Same-tick pickup tie: the closer center wins; on an exact tie, nobody.
- **R4, no value, no multipliers, no rubber-banding.** The drop schedule ignores the score.
- **R5, all in the sim.** Bots use items through `Command` only. The hammer's wind-up is enforced by the sim for everyone.

| Item | Wave | Pickup | Use (dash, empty-handed) | Effects | Counterplay |
|---|---|---|---|---|---|
| **뿅망치** | 1 | 5 swings, 25 s, 0.75 s swing cooldown (dash cooldown untouched) | Wind-up 6 ticks (crouch, glint, rising squeak), then a 9-tick swing with a 7 m/s lunge, then 0.4 s recovery. Arc reach 1.7 m, ±70°, checked every substep. | See the hammer effects list below this table. | Read the 0.1 s wind-up and sidestep. Knock the hammerer down to steal the hammer. |
| **황금 뿅망치** | 1 | Drops on the axis pad at the final countdown + 8 s, or at end − 35 s if there is no countdown. 8 swings; lasts until the match ends. | As the hammer, with reach 2.1 m, ±80°. | Knockback × 1.5; police stun 4 s; everything else as the hammer. | The same. It is announced 3 s ahead, so both sides race for it. |
| **뚫어뻥** | 2 | 2 shots, 30 s | 0.2 s aim (a dotted line is visible), then a plunger at 25 m/s with 8 m range (ray march vs `segmentBlocked`). | See the plunger effects list below this table. | The line is visible, geometry blocks the shot, and you can dash out of a pull. |
| **로켓 롤러스케이트** | 2 | 10 s | Empty-handed dash becomes a 0.5 s long burst. With loot, the carry boost lasts 1.2 s at × 3.0. | Walk 5 → 6.5 m/s. Dash cooldown 4 → 2 s while worn. Turning is capped at 6 rad/s. Hitting a wall above 6 m/s knocks you down 0.5 s ("쿵") with **no** spill. | Rockets whine and glow; skaters crash into walls. |
| **비누 거품** | 2 | 3 uses, 20 s | A normal dash that leaves a slick (r 1.6 m, 10 s) behind you. | Any body centered on a slick gets drag × 0.15 and drive × 0.35. Officers entering above 3.5 m/s slip (stun 1.2 s). Loot glides, so a soaped lane is also your own highway. A hammer hit on a victim standing on soap is a **홈런** (knockback × 2). | Visible bubbles; walk around. |
| 풍선 다발 | 3, gated | Touch; tie it on by grabbing loot | – | Safe mass × 0.4, bank × 0.6, for 20 s or 3 balloons. Any dash or hammer hit pops one. | Pop the balloons. |
| 재채기 연막 | 3, gated | 2 uses | Lobbed 5 m: a 3.5 m cloud for 6 s | Blocks *vision* only (police `observe`, bot perception). Officers entering it sneeze (stun 1 s, once). | Walk around it; wait it out. |

**뿅망치 effects:**
- **Rival:** forced release, knockdown 60 ticks, knockback 9 m/s, bag spill, item drop. A protected rival is only shoved 3 m/s, with no spill (no stunlock).
- **Police:** stun 3.0 s, respecting `POLICE_RESTUN_IMMUNE_TICKS`.
- **Anchored loot (uproot progress per hit):**

  | Target | Per hit |
  |---|---|
  | Small safe | +1.0 |
  | Large safe | +0.5 |
  | Bank | +0.25 |
  | ATM | +0.5, plus 3 coins |
  | 돈나무 | +0.4, plus 2 bundles |

- **Moving bank wall (은행 종 치기):** free interior safes get 1.5 m/s toward the nearest door; anchored interior safes get +0.35 progress.
- **A carried small safe hit directly:** the grip breaks and the safe flies 2.5 m.
- **Other targets:** 돼지 2 cracks; breakables 3 damage; fence 2 hits; truck door −2; crane cat stun.
- **Hammer vs hammer in the same substep:** both bounce, each loses 1 use, sparks, "챙!".

**뚫어뻥 effects (by what the plunger sticks to):**
- **Free loot up to a large safe, the 돼지 included:** yanked toward you at `min(9, 2.5·d)` m/s, and you auto-grab it if it arrives within reach in 0.6 s. Banks are immune.
- **Rival:** pulled 3 m toward you and dizzy 0.4 s, with no knockdown. A carried small safe is released.
- **Anchored loot:** +0.5 progress.
- **Static:** zips *you* toward it at 12 m/s, stopping 0.6 m short.

**Drops (보급 풍선):**
- Each `ItemPadDef` pair is mirrored, 12–18 m from each spawn, outside the bank-route sweeps. There is 1 axis pad.
- Schedule: pairs at 15 / 70 / 125 / 160 s, the axis pad at 45 / 100 s, and the golden hammer as above. At most 4 pickups on the field. A ground item expires after 30 s with a poof.
- **3 s warning:** a crate descends under a balloon with a growing ground shadow. **The crate shows the item's silhouette, never a question mark** (ART §3).
- **Deck:** a seeded shuffle without replacement, refilled when empty. Pair twins always match; the axis pad draws from its own deck.
  - Wave 1 deck: hammer only.
  - Wave 2 deck: {hammer ×2, plunger, skates, soap}.
  - `hammerOnly` mode: hammers only.

### 5.3 Map gimmicks

**Chirality rule:** anything that moves or rotates either sits on the axis with an axis-symmetric effect, or is a mirrored twin moving in mirrored phase. Poses are a pure function of the tick or of public state. Bots read the same public schedule that a human reads from the clock, lights and HUD.

**Existing maps (one signature each):**

| Map | Gimmick | Spec | New verb |
|---|---|---|---|
| 수집 광장 | **무빙워크** | The 2.5 m flower road becomes two 1.2 m lanes at 2.2 m/s: one toward the fountain, one toward home. Walking with it gives about 7 m/s; a small-safe carry about 6 m/s; walking against it about 2.8 m/s. It carries anything, coins included. | Ride home fast. Shove a rival onto the wrong lane. |
| 수집 광장 | **분수 쇼** | Every 40 s from 30 s, after a 2 s ripple telegraph, the fountain erupts. It pushes raccoons, loose loot and coins within 4.5 m radially outward at +6 m/s (banks are immune), and gives the 돼지 1 crack. | Timing scramble around the 돼지 and the 돈나무. |
| 지름길 상가 | **택배 슈트** + hammerable fences | One tube per side, from the back street to the pocket garden by that side's zone. It takes small safes and empty-handed raccoons, one at a time. Transit 3 s with a visible bulge, then pops out at 3 m/s ("퉁!"). The axis fences now break with 2 hammer hits (as well as by a bank). | First back-street safe home at about 15 s. Fence busts happen more often. |
| 열린 창구 | **시소 투석기** pair + **시계탑** | Put a safe, prop or raccoon on the seat, then dash onto the pedal (or hit it at ≥ 6 m/s). The load flies 1.1 s on a fixed arc to a landing disc 5 m short of that side's zone, so recovery still needs a push. Cooldown 3 s. Landing on someone is a bonk (knockdown, spill). Banks don't fit on the seat. The clock tower's cuckoo announces every event, so the warning is diegetic. | Fling it home. Raccoon cannonball. |

**New map 1: 뚝딱 공사장 (Construction Yard), 76×50, axis x=38 (wave 2):**
- **Home belts.** Two belt pairs run from the axis toward each zone. An opponent stealing from "your" belt walks against it.
- **Crane express (axis):**
  - Push a bank fully onto **your** pad and hold it there 1.0 s.
  - Riders are ejected (boing). The crane then lifts the bank 1.2 s, swings it 4.5 s and lowers it 1.0 s to the drop spot 8 m in front of your zone. Loaded safes ride along.
  - Cooldown 15 s. If both pads trigger in the same tick, neither is served and the cat shrugs "?!".
  - **Counter:** dash or hammer the hard-hat crane cat in the cab at the axis base. The bank drops at its current arc point (nearest free spot) with a stomp, dust and pigeons.
  - A lifted bank cannot be recovered mid-air. At match end it is simply not recovered.
- **Pile drivers (mirrored twins):** period 7 s, same phase, 1 s shadow telegraph, radius 2.6 m.
  - Knockdown, forced release and spill (hazard).
  - Anchored loot inside gets +0.35 progress; breakables −1 HP.
  - Standing a safe under one is a timing trick.
- **Loot:** the §3.2 composition (2 large safes on mirrored docks, small safes at the mixers, ATMs by the site offices, 돼지 and 돈나무 on the axis).
- **First 30 s:** spawn → crate → ATM 9 m away → belt → first score at about 12 s.

**New map 2: 반짝 놀이공원 (Night Funpark), 80×52, night palette (wave 3):**
- **Twin teacups:** radius 4.5 m, counter-rotating in mirrored phase, 90° in 1.5 s then 3 s rest. They are kinematic floors, so anything on them is carried. Dashing off the rim adds the rim speed (about +4.7 m/s): a slingshot.
- **Bumper rinks (mirrored):**
  - Slick floor: drag × 0.3 and drive × 0.3, so top speed is unchanged and only grip drops.
  - 2 scripted bumper cars per rink on a figure-8 (kinematic, mirrored phase). A bump is a "boing" 5 m/s knockback with no knockdown and no spill.
  - A shoved safe slides 8–10 m, like air hockey.
  - The north bank's short route crosses the rink.
- **Ferris wheel (axis):** 8 gondolas, 6 s each. The 2 small safes ride in gondolas.
  - A safe is dormant except during a 3 s window at the bottom platform.
  - If nobody grabs it, it goes round again.
- **Game-booth row:** decor only. It sits around the axis item pad, so the hammer has a diegetic home.
- **First 30 s:** cotton-candy crate → ATM → teacup slingshot toward home → first score at about 13 s.

### 5.4 Mid-match events

- **Plan.** When `events: 'on'` and `eventPlan` is undefined, the sim derives the plan from the seed:
  - The loot kind is drawn uniformly from the 3.
  - It fires at a tick uniform in 75–110 s.
  - 지진 has a 50% chance, uniform in 130–175 s, and at least 30 s after the loot event.
  - **Game flow overrides the plan** so the previous match's loot kind never repeats (F9 `lastEventKind`).
- **Warning:** 5 s, with a banner, a sting, a minimap ping, a world marker and the cuckoo on 창구.
- **Climax guarantee.** If the final countdown starts before the loot event has fired, the event fires at countdown + 3 s with a 3 s warning. This guarantees ≥ 400 of value on the field during the climax. The golden hammer then arrives at countdown + 8 s, so the two never land together.
- **Never:** in the tutorial; in the first match after practice; a 지진 during the countdown (a pending one is cancelled). The novice cup gets the loot event only.

| Event | Spec | Verb |
|---|---|---|
| **돈비** | A pink piggy-bank balloon drifts in and pops above the axis event spot. 8 × 지폐 50 land in a ring 6–9 m around the spot, in mirrored pairs every 0.25 s (angles θ and π−θ). | Bag scramble. Bonk carriers for the spill. |
| **황금 금고** | Parachute drop with a 5 s growing shadow. Landing within 1 m of a raccoon is a bonk (hazard knockdown + spill). Anchored 2.5 s, glows, 400. | A 400 tug-of-war at the centre. |
| **현금 수송차** | Enters from the north or south curb on the axis (seeded) and parks at the spot: a kinematic body that becomes a temporary static. Rear door HP 5 (dash −1, hammer −2, 1 s of grab-strain on the bumper −1; both teams contribute). At 0 HP it opens ("털렸다!") and fans 8 × 50 symmetrically about the axis. Auto-opens after 30 s parked. Leaves 3 s after opening. | Everyone bashes the same door. |
| **지진** (modifier) | 3 s warning ("흔들려요!"), then a 4 s quake: every anchored loot gets +0.5 of its uproot time (bank alarms ring only on a full uproot); every breakable −1 HP at +1 s; 돼지 +1 crack; raccoons move × 0.8; camera shake respects settings. Value-neutral. | A sudden uproot rush and a coin pop. |

---

## 6. Work packages

**Effort scale:** S ≤ 1 d, M 2–4 d, L 1–2 wk, in single-agent days.
- **C** = Content 2.0 package.
- **F** = fun-plan package (kept). Its spec is in fun-plan.md; only the deltas are listed here.

### Ownership map for shared files (prevents parallel collisions)

| File | Owner | Others |
|---|---|---|
| `sim/types.ts` | C0 (day 0 freeze) | Read-only after day 0. A change request goes through C0. |
| `sim/config.ts` | Per block (§4.3) | – |
| `sim/sim.ts`, `world.ts`, `rules.ts`, `context.ts` | C1 | Systems plug in via the day-0 hook skeleton and `buildV2()` callbacks in their own files. |
| `sim/actions.ts` | C2 | C1 provides `spillBag()`; C3 provides `addUnanchorProgress()`. |
| `sim/physics.ts` | C3 | – |
| `sim/police.ts` | Police owner. C1 makes one-line hook calls (`spillBag` on tackle, `heldValue` for targeting); C2 adds hammer and soap stun entry points. | – |
| `sim/queries.ts` | C1 for new helpers, F4 for the fun functions | – |
| `sim/layouts/*`, `validate.ts`, `tools/layout-check.ts` | C4 (existing maps + validator), C4b (new map files) | – |
| `ai/bot.ts` | C6 (provider hook refactor, then all new goals) | F2 edits `dashAt` only, sequenced after the C6 hook lands. |
| `ai/harness.ts` (proxy), `tools/balance-report.ts` | C11 | – |
| `render/view.ts` | F3 (beats) + C7 (one `extras` registration) | – |
| `ui/hud/Hud.ts` | F4 (stamps, banners, crown) + C8 (item slot, bag chip, event chip as separate components with one mount point) | – |
| `game/match.ts` | F5 (tracker, cues, log), F4 (moments → HUD, banner queue) | C8 pushes event banners through F4's queue. |
| `game/app.ts` | F6 `toResults`; F7 `toMenu`, `tournamentConfig`, onboarding; C10 boot, title and front-door props | – |
| `platform/save.ts`, `progress.ts` | F9 only | – |
| `ui/screens/MainMenu.ts`, `menu3d/scenes/hideout.ts`, `menu3d/kit.ts` | C10 | F7 supplies `nextGoal()` data. |
| `ui/screens/QuickMatchSetup.ts`, `LayoutPreview.ts`, `menu3d/scenes/preview.ts` | C8 | – |
| `audio/*` | F8 (tension) + C9 (content SFX, motifs). `director.ts` mapping is split by namespaced sections. | – |

### C0: Contracts, skeleton, design override (day 0–1, S–M)

- Land §4 exactly:
  - types and config block stubs
  - the system hook skeleton in `sim.ts` (no-op `CoinSystem`, `PropSystem`, `ItemSystem`, `GimmickSystem`, `EventSystem`, in the frozen order)
  - `buildV2()` callbacks
  - the id ranges
  - the RNG
  - the generic event members
- Fix `test/sim/queries-fun.test.ts:259` (`Simulation.over` → `sim.state.over`) so `npm run build` is green.
- Write design-v0.5 §22 (owner overrides, §0 of this plan) and the ARCHITECTURE section "Content 2.0 contracts".
- **Acceptance:**
  - typecheck, test and build are green
  - with `content: 'classic'`, the event log is identical to HEAD for 30 seeded bot matches (no behaviour change)
  - every new state array exists and is empty

### C1: Sim economy core: coins, bags, deposit, spill, breakables, conservation (wave 1, L)

- **Files:** new `src/sim/coins.ts`, `src/sim/breakables.ts`; `rules.ts`; `world.ts`; `sim.ts`.
- **Deliverables:**
  - §3.3–3.5
  - `spillBag()`, `spawnCoins(pattern)`, coin integration, the pickup contest
  - deposit in the step-4 batch
  - breakables as removable statics, reusing the fence static-removal path
  - `remainingValue` / `allRecovered` / `totalValue` extended
  - police hooks
  - `heldValue` / `isCarryable` / `navClassOf`
- **Tests:**
  - invariant fuzz (all systems on, police on, 2:2, 200 seeds × full matches)
  - mirror test: a mirrored spill gives mirrored piles bit-exact
  - pickup tie rule
  - deposit cancel on knockdown
  - early-decision exactness with coins in bags
  - `allRecovered` only when coins = 0
- **Acceptance:**
  - 0 invariant violations
  - same seed gives an identical event log twice
  - sim step median ≤ 1.0 ms with 150 piles in 2:2 (Node, reference machine)

### C2: Sim items: framework, drops, hammer, golden hammer (wave 1), plunger, skates, soap (wave 2), gated pair (wave 3) (L)

- **Files:** new `src/sim/items.ts`; `actions.ts` (dash routing, skate dash, swing arcs in `afterSubstep`); a stun entry point in `police.ts`.
- **Deliverables:**
  - §5.2: pickups, deck, schedule, warning, expiry
  - drop on knockdown
  - clash rule
  - hazards (slick) and projectiles (plunger)
  - all events
- **Tests:**
  - an item fuzz next to `police-fuzz.test.ts`
  - mirror fairness with items on (mirrored commands give mirrored outcomes)
  - wind-up enforced for every slot
  - protect rule (no stunlock: a victim can't be knocked down again within `PROTECT_TICKS`)
  - hammer uproot increments
  - golden hammer timing (countdown and no-countdown paths)
- **Acceptance:**
  - 0 invariant or mirror failures
  - a hammer swing resolves identically regardless of slot order (permute slots, compare logs)

### C3: Sim physics + props: ATM, 돼지, 돈나무, gold safe body (wave 1, M–L)

- **Files:** `physics.ts`, new `src/sim/props.ts`.
- **Deliverables:**
  - the §4.5 physics contracts (fields, scales, kickable, kinematic floors and poses, `flyBody`)
  - circle-shaped loot bodies (the piggy), with OBB grab and zone tests using the bounding square
  - tug-spurt hooked to `updateUnanchor` progress thresholds
  - bonk detection via `onImpact` while `dashTicks > 0`
  - shed-on-impact (> 2.5 m/s) for the 돈나무
  - crack counting for the 돼지
  - `addUnanchorProgress()`
- **Tests:**
  - kicked piggy travel 5–7 m on a flat surface
  - the 돈나무 sheds at most 1 bundle per impact event (debounced 0.3 s)
  - kinematic floor carries a rider through 90° with < 2 cm drift
  - `flyBody` landing never ends inside a static (fuzz of 500 random targets)
  - existing physics, stall and wedge tests unchanged
- **Acceptance:** physics fuzz with all props: 0 NaNs, 0 tunnelling through statics at `MAX_SUBSTEPS` 8.

### C4: Gimmick system + existing-map v2 retrofit + validator (wave 1 placements, wave 2 gimmicks, L)

- **Files:** new `src/sim/gimmicks.ts`; `layouts/{plaza,shortcut,counter}.ts`; `builder.ts` (`prop()`, `breakable()`, `itemPad()`, `eventSpot()`, `belt()`, `toss()`, `tube()`, … with auto-mirroring); `validate.ts`; `layout-check`.
- **Wave 1:**
  - v2 compositions per §3.2: starter sockets, breakables, pads, event spots
  - fences become hammerable
- **Wave 2:** belt, fountainShow, tube, catapult (plus the generic kinematic and stomper code that C4b reuses).
- **Validator additions:**
  - chirality (axis-symmetric or mirrored twin with opposite spin and the same phase)
  - per-map value total of 4,000 and mirror value balance
  - starter socket distances
  - no breakable within 6 m of a zone
  - landing and exit discs clear of solids by 1.2 m
  - the small-safe bypass still holds with every gimmick at its worst pose
  - `propHaul` for the 돈나무
  - item pads outside bank sweeps
- **Acceptance:** `layout-check` green for all 5 maps in both `classic` and `v2`. Classic layouts are byte-identical to today's.

### C4b: New maps: 뚝딱 공사장 (wave 2), 반짝 놀이공원 (wave 3) (L each)

- **Files:** `layouts/yard.ts`, `layouts/funpark.ts`, `meta.ts` (building styles warehouse / siteOffice / boothRow / rideFence), `strings.ts`.
- Crane, stomper, teacup, slick, bumperCar and wheel kinds go in `gimmicks.ts`. They are coordinated with the C4 owner: the same agent, or a sub-module per kind.
- **Acceptance:**
  - validator green
  - mirror win split within ±3 points over B-block runs
  - proxy first score ≤ 15 s
  - dead time ≤ 8%
  - crane used in ≥ 50% of 공사장 matches, with cat-stun counterplay succeeding 25–45% of the time it's attempted
  - teacup or rink involved in ≥ 50% of 놀이공원 steals and intercepts
  - gondola safes taken 50% ± 6 per side

### C5: Event system: 돈비, 황금 금고, 현금 수송차, 지진 (wave 2, M–L)

- **Files:** new `src/sim/events.ts`; dormant event loot in `world.ts` via the C1 callback.
- **Deliverables:** §5.4, the truck kinematic and static switch, the countdown fire rule, game-flow override support.
- **Tests:**
  - invariant across every event kind and timing (pre-countdown, in-countdown)
  - truck never pinches (fuzz: 200 seeds with bots clustered at the spot)
  - mirror-symmetric spawns
- **Acceptance:**
  - value on the field at countdown start, median ≥ 400
  - event loot share of points 8–14%
  - the team that recovers most of the event value wins ≤ 65% of those matches

### C6: Bots use everything (wave 1 for coins, props, breakables and hammer; wave 2 for gimmicks, events and items; L+)

- **Files:**
  - new `src/ai/goals/{coins,props,items,gimmicks,events}.ts`
  - new `src/ai/itemSense.ts` (utility, use triggers, aim lead)
  - new `src/ai/gimmickSense.ts` (`forecast`, `beltFlow`, `windowOf`)
  - `nav.ts` (`PathOptions.flow` for belts; cost circles for slicks, smoke, stomper forecasts and teacups; temporary statics for the truck)
  - `board.ts` (team claims on drops, coin clusters and the event)
  - `params.ts` (add-only fields)
  - the provider hook in `bot.ts`
- **Behaviour:**
  - **smash:** breakables and the ATM bonk, by value per second.
  - **scoop:** a detour when piles lie within 4 m of the path.
  - **deposit:** when the bag ≥ 120, a threat is near, or time is low.
  - **fetchItem:** utility discounted by walk time and personality.
  - **bonk:** hammer on an opposing carrier within 10 m of path. Otherwise uproot its own target, smash, or stun an officer chasing a teammate.
  - **kickPiggy:** get behind the ball relative to the zone, then dash when aligned. Smash it when behind or contested.
  - **useGimmick:** take a toss, tube or crane when walk + flight + push beats a direct carry by more than 2 s.
  - **collectEvent:** pre-position during the warning, by utility.
  - **stunCraneCat:** when an enemy bank is hoisting and the cab is reachable in under 4 s.
  - **grabGondola:** time the arrival to the window.
- **Personalities:**

  | Rival | Favourites |
  |---|---|
  | 호다닥 | coins, skates, belts, ATM tugging |
  | 통큰이 | hammer on banks, crane, 돈나무, 황금 금고 |
  | 눈치왕 | plunger, spill scavenging, cat stun, bashing the truck door last |

- Bots wind up like everyone else (sim-enforced). Aim error comes from `aimErrorRad`.
- **Acceptance (P and B blocks):**
  - ≥ 85% of bot item pickups produce at least one use before expiry
  - bot item uses per held-minute within ±25% of the proxy's
  - bot hammer KOs on the proxy ≤ 1.3× the proxy's hammer KOs on bots
  - bot gimmick use within ±15% of the proxy's
  - hazard self-hits ≤ 0.3 per match at normal
  - think time within `ASTAR_TICK_BUDGET` with every system on in 2:2

### C7: Render: coins, props, items, gimmicks, events, new map art (wave 1 for C7a, waves 2–3 for C7b; L each)

- **C7a (wave 1):**
  - `render/coins.ts`: instanced 동전 with the raccoon-paw emboss and a round rim (ART §3); instanced 지폐 다발; bag on the back scaled by value.
  - `models/props.ts`: ATM, 돼지 with crack decals, 돈나무 with root ball and instanced bills, gold safe.
  - Breakable crate and 꿀꺽 vending machine.
  - `render/items.ts`:
    - squeaky hammer: an accordion head, original shape, gold variant
    - plunger with a sagging rope tube
    - rocket skates with a sparkle flame
    - soap bottle and bubbles
    - supply-balloon crate printed with the item silhouette
  - Rig attach points in `raccoon.ts`; hit reactions (dizzy-star halo, accordion squash, flattened officer).
  - Effects: coin fountain, coin climb sparkle, splinters, slick and smoke decals.
- **C7b (waves 2–3):**
  - `models/gimmicks/*`: belt chevrons, fountain jets, tube bulge, seesaw, crane lattice with the hard-hat cat, pile driver, teacups, bumper cars, Ferris wheel (instanced gondolas).
  - Event models: balloon piggy, parachute gold safe, truck.
  - New map environments and ground art; funpark night lighting (reusing the bulb strings from `menu3d/kit.ts`).
  - Telegraph language: yellow-black stripes for danger, a growing shadow for drops, a pulsing ring for "goes in 3 s", chevrons for belts.
- **Every verb gets 3 layers (ART §2):** screen, sound and rumble. Hit-stop values: hammer 90 ms, ATM spurt 40 ms, piggy jackpot 120 ms, crane drop 120 ms, truck open 100 ms.
- **Acceptance:**
  - screenshot checks at 1280×720 and 1920×1080 for every new object at the default camera distance (readable silhouette, team-neutral colours)
  - ≤ +1.5 ms median frame time on the reference preset with every system on
  - no per-frame allocations in steady state
  - reduced-motion and shake settings honoured

### C8: HUD, screens, onboarding UI, strings (waves 1–3, M–L)

- **Wave 1:**
  - Item icon in the dash ring with use pips and a lifetime ring. The prompt changes with the item ("Shift 뿅!", "Shift 쭉!").
  - Bag chip: "주머니 120 · 차 앞에 쏟아요".
  - Deposit ring under the player.
  - Item name tag for the first 3 sightings (F9 `seenItems`).
  - Prop world labels: "ATM 200 · 동전 8" (proximity only, §4).
  - Minimap: item pads, drops, coin density.
- **Wave 2:**
  - Event banner and chip through F4's queue. Banner priority: climax > event > police > other.
  - One "next beat" chip at a time ("사건 0:05", "분수 쇼 0:03", "크레인 준비").
  - Hazard outlines on the minimap.
  - `LayoutPreview` / `preview.ts` gimmick flyover: 2–3 callout cards per map, shown on the first visit and on demand afterwards.
- **Wave 3:**
  - `QuickMatchSetup` becomes a **map board**: 5 maps plus a default "랜덤" card, gimmick icons and NEW badges.
  - Toggles: "보급품 켬 / 망치만 / 끔" and "사건 켬 / 끔", saved through F9 `lastQuick`.
- **Strings:** ko first, natural en (ART §5 voices and §6 glossary). New glossary rows: 동전 / Coins, 주머니 / Bag, 쏟아붓기 / Deposit, 와르르 / Spill, 보급 풍선 / Supply drop, 사건 / Event.
- **Acceptance:**
  - i18n parity test
  - nothing under 14 px at 720p
  - HUD never shows bag value as score
  - no more than 2 stamps and 1 chip at once

### C9: Content audio (waves 1–3, M)

- **Files:** `audio/sfxItems.ts`, `sfxProps.ts`, `sfxGimmicks.ts`, `jingles.ts` additions; `director.ts` mapping (its own section); `captions.ts`.
- **Sounds:**
  - Hammer squeak in the song key (`theory.ts`); "챙!" clash; plunger "뽁!"; soap squeak loop; rocket whoosh loop.
  - Coin pickup climb, one scale step per pile within 1.5 s; a descending cascade for spills; ATM cha-ching; synth oink; root-rip crackle; bill flutter.
  - Belt hum; fountain whoosh; tube "퉁"; seesaw boing-whoosh; crane whirr and clank; cat "냥?"; stomp in key; teacup calliope (original procedural melody); bumper boing.
  - Event stings: balloon pop with coin cascade, truck horn fanfare, parachute whistle, rumble loop.
  - Every gimmick gets a 2-note motif in the current key, so it reads off-screen.
- **Acceptance:**
  - new cues peak ≤ −1 dBFS
  - mix integrated loudness within ±1 LU of today over a recorded match
  - voice limiter: ≤ 2 overlapping instances per cue (coins ≤ 4)
  - captions in ko and en for every cue

### C10: Commercial main screen (wave 1, M; independent of the sim)

- **Boot splash** (new `BootSplash.ts`):
  - Inline cream background in `index.html`.
  - Electron `backgroundColor` and `show: false` until ready-to-show.
  - 1.2 s paw-stamp "thunk", then the wordmark and a one-line photosensitivity note.
  - Warms shaders by rendering the title scene hidden.
  - Any key skips it; auto-skipped after the first run.
  - The sting plays only in Electron (browsers need a gesture for audio).
- **Title:** keep the logo slam. Attract mode is a wave 3 stretch (below).
- **Front door** (rewrite of `MainMenu.ts`; new components `ModeCard`, `PlayerCard`, `NextGoalCard`, `NewsTicker`):

```
+--------------------------------------------------------------------------+
| [3D MARQUEE: 뿌리째 털어라]  bulbs chase,      [PLAYER CARD               ] |
|  roots dangle, a small safe swings (≥30% w)    | hat portrait · name      | |
|                                                | 12승 8패 3무 · 최고 1,400 | |
|   (gang on the rooftop, centre-left,           | rival stamps  o o .      | |
|    reacting to focus; hero holds a 뿅망치)     +--------------------------+ |
|                                                +--------------------------+ |
|                                                | > 게임 시작       (BIG)  | |
|                                                | 빠른 대전 · 1:1 · 랜덤 맵 | |
|                                                +--------------------------+ |
|                                                [빠른 대전][라이벌 대회][연습] |
|                                                [이어서 / 다음 목표  ->     ] |
| (옷장) (설정) (크레딧) (종료)                                               |
| == 광장 소식: 뚝딱 공사장 개장! 크레인 고양이 조심 · 호다닥, 돼지저금통 또 노림 == |
+--------------------------------------------------------------------------+
```

- **게임 시작:**
  - At least 2× the area of any other control, sun yellow, a slow pulse, initial focus.
  - One press starts a quick match with F9 `lastQuick`.
  - On first launch it routes to 연습 as a highlighted card. This replaces today's modal.
  - Back returns to the title.
- **Mode cards:** 3D thumbnails (`menu3d/portraits.ts`) and a live status line ("통큰이 2라운드 진행 중", "새 맵 1").
- **Player card:** reads F9 (v1 fallback until F9 lands).
- **Next-goal card:** F7's `nextGoal()`, one press, dismissible.
- **News ticker:** an LED strip with about 40 handwritten in-world headlines in the game's voice, plus honest update notes from a bundled `public/news.json`.
  - Offline, never fetches.
  - NEW marks content added since `lastSeenVersion`.
  - No timers, no FOMO.
- **3D (`hideout.ts`, `kit.ts`):**
  - `'front'` framing; `marqueeSign(canvasTex)` with chasing bulbs.
  - On 게임 시작, the lead raccoon bonks a big red button on the snack-table safe with a 뿅망치, the gang ziplines off the roof, and a new `'van'` wipe plays.
- **Audio:** title song through a "hideout" low-pass; focus on 게임 시작 raises `setMusicIntensity`; a sting on press.
- **Reduced motion:** stops the bulbs, the swing and the zipline (a cut instead).
- **Wave 3 stretches (only if wave 3 is ahead of schedule):**
  - **Title attract mode:** after 25 s idle, a letterboxed 2-bot demo on a random map with a "구경 중 — 아무 키나" sticker. Skipped at low quality.
  - **Rooftop playground:** your raccoon can bonk 2 crates on the roof for coin confetti while browsing. Cosmetic, no value.
- **Acceptance:**
  - Screenshots at 1280×720, 1920×1080 and phone width (16 px gutter):
    - logo ≥ 25% of the viewport width
    - Play ≥ 2× any other control
    - nothing under 14 px at 720p
  - A returning player gets from title to match input with **1 confirm press** in ≤ 15 s including loading.
  - Keyboard and gamepad reach every control. No browser-default focus rings.
  - **Owner's yes/no on "looks commercial".**

### C11: Content scorecard, proxy upgrade, tuning owner (re-scoped fun-plan WP1) (wave 0 → continuous, M+)

- **Step 0 (day 0–1):** the fun-plan WP1 step-0 port (`tools/balance-report.ts --fun`), plus a `--content` block.
  - Re-baseline the classic game at the current tree. All gates are deltas vs that.
- **Proxy upgrade:** the harness proxy uses the same C6 goal providers with "human-ish" parameters (0.55 police awareness as today, `itemSkill` 0.7, `aimErrorRad` 12°). Without it, the content metrics are meaningless.
- **Blocks** (all police on, alternating sides):

  | Block | What | Size |
  |---|---|---|
  | P | Proxy vs each rival at normal | 5 maps × 3 rivals × 20 seeds = 300 |
  | B | Normal bot vs bot | 300 |
  | T2 | 2:2 smoke | 5 maps × 10 seeds |
  | A/B | `classic` vs `v2`; items off / hammerOnly / on; events off / on | P-size each |

- **Tuning levers** (one at a time, n ≥ 300, nobody else touches them):
  - The fun plan's "race the siren" set (police dispatch 12 → 18 s, `bankPoliceDrag` 0, `waveDefer` 0.3), **re-measured after wave 1 content lands**, because coins and the hammer change pacing.
  - Drop schedule times; coin values within the §3.2 total.
  - `bagCap` (150–250); spill fraction (0.4–0.6).
  - Hammer knockdown (45–70 ticks).
  - Event window.
  - **The fun plan's warm-up safe is superseded by the ATM starter socket.**
- **Hard CI gates, every package:**
  - typecheck, test, layout-check
  - invariant fuzz (`totalValue`) with every system on
  - mirror-fairness tests per map
  - replay determinism (F5 command log, all systems on)
  - 0 crashes and 0 invariant violations across P + B + T2

### F-packages (from fun-plan.md, kept, with Content 2.0 deltas)

| Pkg | Kept as specified | Content 2.0 delta | Wave |
|---|---|---|---|
| **F1** pacing | Scorecard and levers | Merged into **C11**. Gates replaced by §8 targets. | 0 → continuous |
| **F2** rivals with a pulse | Taunts, two-phase readable dash, barks | Taunt triggers add "after a 잭팟", "after a hammer bonk on the player", "after a crane drop". The sim-level hammer wind-up already gives telegraphs, so F2's dash wind-up applies to plain dashes only. Lands after the C6 provider hook. | 2 |
| **F3** render beats | Getaway on every ending, decisive-load glow, big-play glance, telegraphs, results stage | The decisive-load glow also marks a **bag carrier** when the bag is decisive. A big-play glance on jackpot, craneDrop and goldHammer. | 1 |
| **F4** tension HUD | Match point, swing readout, stamps, crown, banner queue, final-10 s digits | `matchPointInfo` gains bag loads. Stamps for the new moments. Banner priority: climax > event > police > other. The swing readout counts coins. | 1 |
| **F5** moments + cues + command log | Everything | New moment kinds and `bigPlay` weights (§4.5). Streak thresholds become fractions of `totalValue`. The kickoff cue pulses the nearest crate or ATM (not a safe). The command log must replay items, events and gimmicks bit-exact. | 1 |
| **F6** results hooks | Factual chip, records, next goal, timeline, margin stamp, rival line, rematch relabel | New factual chips (only true facts): "뿅망치로 동전 120 와르르", "돼지저금통 잭팟 300", "수송차 문을 마지막에 깼어요". Timeline icons for events, jackpots and crane drops. Points-by-source bar (banks / safes / props / coins / event). | 2 |
| **F7** cups + first-hour path + menu card | Cups 입문 / 보통 / 도전, `lerpDifficultyParams`, first-hour path | First-hour path: 연습 (+ a new 20 s coin beat in the tutorial: break a crate, scoop, deposit) → 첫 대전 (창구, v2, items off, events off) → 보급품 대전 (items on, hammerOnly the first time) → 경찰 + 사건 대전 → 입문 컵. New maps enter cups from 보통 (each rival keeps one fixed map per cup, shown before the series). The menu card is rendered by **C10**; F7 supplies `nextGoal()`. | 2 |
| **F8** tension audio | Heartbeat, lead stings, streak climb, final 10 s, taunt-punish | The streak climb counts deposits ≥ 50. The event warning ducks the heartbeat. A 황금 뿅망치 spawn sting. | 1 |
| **F9** save v2 | Everything | Add `lastQuick`, `seenItems`, `seenLayouts`, `lastSeenVersion`, `lastEventKind`, `records.biggestSplash`, `records.biggestDeposit`. Funnel adds `playPressed`, `itemsToggle`. | 1 |
| **F10** 털이 수첩 lite | 12 challenges, hats, van paints | New page **말썽꾼** (6 challenges, cosmetic rewards, per-match caps): 뿅망치로 금고 든 상대 넘어뜨리기 · 돼지저금통 잭팟 · 지폐 4장 그대로 돈나무 회수 · 투석기/슈트로 보낸 금고 회수 · 크레인으로 은행 회수 · 황금 뿅망치 줍고 승리. All predicates are over the event log; no RNG and no timers. | 2–3 |

---

## 7. Build order

The critical path runs C0 → C1/C2/C3 → C6 (wave 1) → C11 scorecard.

| Wave | Days | Packages | Ships as |
|---|---|---|---|
| **0** | 0–1 | C0 contracts, skeleton and build fix; design §22; C11 step 0 re-baseline | – |
| **1: "망치와 동전"** | 1–7 | C1, C2 (framework + hammer + drops + golden hammer), C3, C4 (v2 placements + hammerable fences), C6 (coins / props / breakables / hammer / drops), C7a, C8 wave 1, C9 (wave 1 sounds), **C10 main screen**, F3, F4, F5, F8, F9 | **Owner playtest build 1:** front door, coins, ATM, 돼지, 돈나무, crates, the hammer and the golden hammer on the 3 existing maps. Directly answers the feedback. |
| **2: "움직이는 광장"** | 7–13 | C4 gimmicks (belts, fountain show, tube, catapult), C5 events, C2 (plunger, skates, soap), C4b 뚝딱 공사장, C6 (gimmicks / events / new items), C7b, C8 wave 2, C9, F2, F6, F7, F10 | **Owner playtest build 2:** every existing map has its signature gimmick, events are on, 4 items, 1 new map. |
| **3: "새 동네"** | 13–19 | C4b 반짝 놀이공원, C8 map board and toggles, cups rotation (F7), gated items (풍선, 연막) **only if** wave 2 gates pass with margin, C10 stretches (attract mode, rooftop playground) if ahead | Release candidate. |
| **Integration** | after each wave (1–2 d) | Full scorecard (P + B + T2 + A/B), screenshot pass, e2e (title → match in 1 press; results → rematch in 1 press), perf pass | – |

**Rules:**
- **Single-lever tuning** (fun plan §4): one change at a time, n ≥ 300.
- **A wave cannot start new content while the previous wave fails a hard gate** (§8).
- **Every new item or gimmick ships behind its rule toggle**, so a bad one can be switched off without a code revert.

---

## 8. What to measure (scorecard `tools/balance-report.ts --fun --content`)

**Definitions:**
- **First action:** the proxy's first coin pickup, breakable or ATM hit, uproot-progress start or item pickup.
- **Dead time:** the share of match time spent in stretches > 8 s with no payoff event involving the proxy. Payoff events: pickup, hit given or received, uproot progress, deposit, recovery, item use, gimmick use.
  - The fun plan's old no-score definition is reported alongside, for continuity.
- **Drama events per minute:** spawns ≥ 20 coins, item hits on characters or police, KOs, steals (`safeUnloaded` by an opponent), toss / tube / crane launches, recoveries ≥ 200, event opens and jackpots.

Targets are for v2 with everything on, P block, against the classic re-baseline unless noted.

| Metric | Baseline (classic) | Gate (must) | Target |
|---|---|---|---|
| Proxy first action, median, every map | ≈ walk to first safe (not tracked) | ≤ 10 s | **≤ 8 s** |
| Proxy first score (deposit or recovery), median, every map | 31 s (shortcut 38) | ≤ 18 s | **≤ 15 s** |
| Proxy dead time | 13% (plaza 18%) | ≤ 10% | **≤ 8%** (no map > 10%) |
| Longest no-score stretch, median | 34 s | ≤ 28 s | ≤ 24 s |
| Drama events per minute (all / proxy-involved) | not tracked | ≥ 4 / ≥ 2 | **≥ 6 / ≥ 3** |
| Distinct verbs the proxy used per match (grab, carry, dash-hit, smash, tug-spurt, kick, scoop, deposit, item, gimmick) | ~3 | ≥ 5 | ≥ 6 |
| Distinct value sources the proxy scored from (median) | 2–3 | ≥ 3 | ≥ 4 |
| Bank share of points | 41% | **30–45%** | 35–42% |
| Largest single non-bank source share | – | ≤ 25% | ≤ 20% |
| Coin share of points | – | 10–28% | 12–25% |
| Event-loot share of points (events on) | – | 6–15% | 8–12% |
| Full 30 s countdown played | 28% | ≥ 40% | ≥ 45% |
| Value on field at countdown, median | 300 | ≥ 400 | ≥ 500 |
| Draws, P / B | 14% / 11% | ≤ 9% / ≤ 9% | ≤ 7% / ≤ 7% |
| Lead changes per match | ~2 | ≥ 2.2 | ≥ 2.5 |
| Comeback wins (≥ 500) | 8% | ≥ 12% | ≥ 16% |
| Blowout losses | 13% | ≤ 8% | ≤ 5% |
| Match length median; reaching 240 s | 158 s; 6% | 140–185 s; ≤ 15% | 150–175 s; ≤ 10% |
| Police tackles per minute | 2.3 | ≤ 2.5 | ≤ 2.3 |
| Hammer KOs per minute (all) | – | 0.4–1.5 | 0.6–1.2 |
| Spills per match; spill coins re-taken by the other team | – | 2–8; ≥ 1 | 3–6; ≥ 2 |
| Drops contested (both teams within 6 m at pickup) | – | ≥ 25% | ≥ 35% |
| **Bot item use:** pickups used before expiry | – | ≥ 85% | ≥ 92% |
| **Bot vs proxy** item uses per held-minute | – | within ±25% | within ±15% |
| **Bot vs proxy** gimmick use | – | within ±20% | within ±15% |
| Bot hammer KOs on proxy ÷ proxy hammer KOs on bots | – | ≤ 1.3 | 0.8–1.2 |
| **Fairness:** mirror win split per map (B block) | ±3 | ±3 | ±2 |
| **Fairness:** win-rate delta for "held a hammer at least once" | – | ≤ +12 pts | ≤ +8 pts |
| **Fairness:** win-rate delta for "got the golden hammer" | – | ≤ +15 pts | ≤ +10 pts |
| **Fairness:** winner of the first drop | – | ≤ +10 pts | ≤ +6 pts |
| Proxy W / L vs normal | 28 / 57 | W ≥ 32 | W ≥ 35 |
| Rematch-worthy | 73% | ≥ 78% | ≥ 82% |
| Crashes / invariant / mirror / replay failures | 0 | 0 | 0 |
| Sim step median, 2:2, every system on | – | ≤ 1.5 ms | ≤ 1.0 ms |
| Frame time delta, reference preset | – | ≤ +2 ms | ≤ +1.5 ms |

**Also tracked:**
- **Per gimmick:** usage per match per side; hazard hits; crane counterplay rate; tube and catapult score conversions.
- **Per event kind:** first-visit open rate (truck ≥ 80%), lead change within 15 s of the event (≤ 35% of all lead changes), event-haul team win rate.
- **Per item:** uses, hits, KOs, win delta, average hold time. Ranked so the weakest item can be cut.
- **Variety index:** entropy of (value source × transport mode) per match. Target ≥ 1.5× classic.
- **The fun-plan visible-tension metrics carry over unchanged:** match point visible ≥ 3 s, stamps per match, `bigPlay` rate, streak tiers, coin-climb ≥ 3 rate, taunts, record-chip hit rate, cup odds.
- **Local funnel (playtest builds):** % of match starts via 게임 시작; title → match time; matches per session; items-toggle usage.

---

## 9. What waits for human playtests (§19 protocol, cannot be settled by the harness)

1. **Does it still get old?** Run 10 consecutive matches (random map, items and events on) vs the classic A/B.
   - Rate "금방 질린다" on a 5-point scale (target: at least +1.0 better).
   - Voluntary extra matches (target: +40%).
   - This is the owner's core question.
2. **"Most memorable moment" recall.** Target: ≥ 60% name an item, prop, gimmick or event; ≥ 1 in 3 still name a bank moment (identity check).
3. **Hammer feel.** Does the 0.1 s wind-up read? Is the human dodge rate 20–40%? Does being bonked feel funny or annoying? This decides the knockdown length (45–70 ticks) and whether fences stay hammerable.
4. **Coin readability.** Do new players understand that the bag is not score until 쏟아붓기? (16 of 20 should explain it unprompted after 2 matches.) Is the 50% spill motivating or frustrating?
5. **Clutter.** Can players tell interactables from decor at a glance on each map? Is the night funpark readable on low quality and software GL?
6. **Item set.** Which item is picked up least or complained about most? The weakest wave 2 item is cut before wave 3 gated items are considered.
7. **Bots with items.** Do bots feel fair or "aimbot"? Are bots with hammers bullies at normal? This tunes `aimErrorRad` and `itemSkill`, never physics.
8. **Events.** Do players feel events "decide" matches? Is the truck door bash fun or a dogpile? Is 지진 welcome or noise?
9. **Main screen.** The owner's "looks commercial" verdict. Do first-time players find 게임 시작 within 3 s? Does anyone miss the old signboards?
10. **Carried over from the fun plan §6:** rematch rate with the results strip (≥ 14/20), "it suddenly ended" complaints, the real difficulty curve, draws with humans, taunt tone, slow-mo vs input-lag complaints, challenge-book pacing, the silent 10 s clip test (16/20). Clip candidates: 돈나무 uproot, 돼지 잭팟, crane drop, golden-hammer climax.

---

## 10. Non-negotiables, checked for every package

- **Two buttons only (grab, dash), plus movement.** Items are picked up by touch and used through dash or grab.
- **Identity:** pull things out by the roots and haul them home; steal from moving banks. Banks are 30–45% of points.
- **Deterministic sim:**
  - seeded, with the RNG used only for the item deck, the event plan and the truck's curb
  - mirrored spawns and patterns; symmetric tie rules (never slot order)
  - replay test in CI
  - ready for online authority later
- **Bots can use every item, prop, gimmick and event, through `Command` only.** Difficulty changes decisions and aim, never physics.
- **Scoring:** confirmed score cannot be taken; recovery or deposit is required in your own zone; ties are draws; the conservation invariant holds every tick; no multipliers, no catch-up bonuses, no score-aware drops.
- **Cute and comedic:** bonks, boings, dizzy stars, squeaks. No blood and no realistic weapons. Hammers are toys.
- **Ethical retention:** no loot boxes, gacha, currency, energy, FOMO, streak penalties, expiring rewards or network telemetry. News is honest and offline. Nothing basic is locked.
- **Procedural art and audio only.** No IP imitation (ART §3): no question-mark crates, no franchise hammer shapes, the paw-embossed coin design, fictional brands only.
- **Rematch is always one press. The front door is one press to play.**
