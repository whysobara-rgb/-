# 뿌리째 털어라: "한 판 더" implementation plan (director's cut)

Owner's demand: "제일 중요한건 게임이 존나게 재밌어야해 — 중독성 미치도록".
This plan turns that into one focused implementation round: 10 work packages (WP), grouped by code area and built in parallel, each with acceptance gates. A short-term thrill that hurts the match does not count as a win. Every gate is either a harness number or a test.

Inputs:
- The three proposal sets (moment / meta / feel).
- Baseline metrics from `scratchpad/fun/metrics/` (HEAD 1ede9fb, n=180 proxy + 180 bot-vs-bot, 1v1, police on).
- design-v0.5 §1, §3, §6, §8, §10–§12, §14, §18–§19.
- ART_DIRECTION and ARCHITECTURE.

**Tree-state warning, read first.**
- HEAD is now 71a1362. Between 1ede9fb and 71a1362, `src/ai/bot.ts`, `src/ai/params.ts`, `src/game/match.ts` and `src/audio/*` changed.
- The owner has uncommitted work in `src/ai/bot.ts` (cop-guard cover path, `contestLate` removed), `src/ai/params.ts`, `src/ui/hud/Hud.ts`, `src/audio/sfxTaunt.ts` and `test/unit/taunts.test.ts`.
- The sim still does not process `Command.emote`. Only `EMOTE` in config.ts and the types exist; there is no handling in `src/sim/*.ts`.
- Rules for implementers:
  - Build on the working tree as it is. Never revert or overwrite the owner's edits.
  - Re-baseline before changing any tuning (WP1, step 0).

---

## 1. Director's diagnosis

The scoreboard already swings well: about 2 lead changes per match, the go-ahead comes late, and 55% of matches have a late swing. The addiction killers are elsewhere:

1. **The climax the game is built around rarely plays.**
   - Only 28% of countdowns run the full 30 s.
   - 40% end within 2 s of the second bank.
   - The match "suddenly ends" with no warning, even though the deciding carry is visible a median 13 s in advance.
2. **The game hides the tension it already computes.**
   - Match point is never announced.
   - Lead changes (about 1.5–2 per match) get no stamp, sting or crown.
   - Scoring runs never escalate: the coin climb reaches step 3+ in 7% of matches.
3. **The new player meets a wall and a flat loss screen.**
   - The proxy loses 57% at normal.
   - Tournament R1 (호다닥@광장, normal only) has a 21% series win chance, which is about 13 games to get past.
   - Losses show the static "이번엔 빈손…" even after scoring 1,200.
4. **Rivals have no personality during the match** (0 taunts), and being hit is undodgeable. Most of the drama is police happening *to* the player.
5. **Slow start and walking gaps.**
   - The player's own first score comes at about 31 s; the doc §3 target is 10–25 s.
   - 13% of the match is dead time, 18% on plaza.

Fix order: match structure first (it multiplies everything else), then make the tension visible, then give every result a reason for one more, then add longer-term goals.

---

## 2. Proposal scorecard

Impact means effect on fun and addictiveness (1–5). Doc = compatibility with design-v0.5. Risk = risk to stability or balance. Effort: S ≤1 d, M 2–4 d, L 1–2 wk.

| # | Proposal (source) | Impact | Doc | Ethics | Effort | Risk | Decision |
|---|---|---|---|---|---|---|---|
| A | Race the siren: police dispatch 12→18 s, `bankPoliceDrag` 0, `waveDefer` 0.3 (moment 1) | 5 | §3 flow ✔, §6 bank share ≤50% ✔ | ✔ | S | med (balance) | **WP1** |
| B | Warm-up small safe near spawn + kickoff cue (moment 4) | 4 | §3 10–25 s ✔; §4 arrow only at kickoff | ✔ | S | med (layout-check) | **WP1 + WP5** |
| C | Match-point query + "승부 포인트 / 막아야 해!" + heartbeat + "막았다!" (moment 2, feel 5 merged) | 5 | §3/§8 emphasis ✔, rules unchanged | ✔ | M | low | **WP4 + WP5 + WP8** |
| D | Lead-change "역전!/동점!" + crown (feel 2) | 4 | §10 ✔ | ✔ | S | low | **WP4/5/8** |
| E | Scoring-run heat replacing the 8 s coin climb, "끊었다!" (feel 8) | 3 | ART §1 ✔, no multiplier | ✔ | S | low | **WP4/5/8** |
| F | Banner priority queue, compact climax banner (moment 8) | 3 | §10 ✔ | ✔ | S | low | **WP4** |
| G | Getaway drive-off on every ending inside the 2.4 s hold (moment 8, feel 5) | 4 | §10 ✔, §12 rematch not delayed | ✔ | S | low | **WP3** |
| H | Big-play director: slow-mo / glance / hit-stop at score ≥6, max 4 per match (feel 4) | 4 | ART §2 ✔ | ✔ | M | med (input feel) | **WP5 + WP3** |
| I | Readable steal opportunity "빼내기 +300" (moment 7) | 4 | §4, §10 ✔ | ✔ | S | low | **WP5 + WP3** |
| J | Bot taunts, punishable "도발 응징!" (moment 5, feel 6) | 4 | §11, §13 ✔ (optional, hideable) | ✔ if cute + toggle | S–M | med (depends on sim emote) | **WP2** |
| K | Readable bot dash wind-up, "피했다! / 맞불!" (moment 6) | 4 | §11: difficulty = decision timing ✔ | ✔ | S–M | med (bot strength) | **WP2** |
| L | Results next-match strip: factual chip, record chip, next goal, rival line, rematch relabel, series match-point fix (meta 1 + feel 3 + feel 9 + meta 6 records merged) | 5 | §12 real records only ✔, no popups | ✔ | M | low | **WP6** |
| M | Score timeline chart on results (feel 3) | 3 | §12 ✔ | ✔ | S | low | **WP6** |
| N | Margin-aware stamp and subtitle, officers hidden on results stage (moment 8, feel 3) | 3 | §12 ✔ | ✔ | S | low | **WP6 + WP3** |
| O | Tournament cups 입문/보통/도전 with fixed visible steps (meta 2) | 5 | §11 (no hidden change in a series) ✔, §12 order ✔ | ✔ | M | med (save migration) | **WP7 + WP9** |
| P | Rival relationship layer: head-to-head records, 숙적, results pose (meta 3) | 4 | §11 ✔ | ✔ (facts only) | M | low | **WP6 + WP9 + WP3** (best-of-3 quick-match option deferred) |
| Q | First-hour path "첫 출동" + menu "이어서 / 다음 목표" card (meta 5, meta 8) | 4 | §3, §12 nothing locked ✔ | ✔ dismissible | S–M | low | **WP7** |
| R | 털이 수첩 challenge book + procedural cosmetics (meta 4) | 4 | §12 cosmetic only ✔; §13 team readability | ✔ no RNG, no currency | L → cut to M–L | med | **WP10 (lite: 12 challenges, hats + van paints, no fur)** |
| S | Rival taunt unlock fix (`unlockedEmotes` never written) + victory pose (meta 9) | 3 | §12 ✔ | ✔ | S | low | **WP9 (+ pose in WP10)** |
| T | Instant replay of the deciding moment (feel 1, moment 10) | 4 | §14 OK if no export | ✔ | M–L | med–high (2nd WebGL context, perf) | **Defer to round 2**; only the command-log recording and determinism CI test land now (WP5) |
| U | Shareable results photo (feel 7) | 2 | §14 ✔ | ✔ | M | low | Defer (needs T) |
| V | 1 officer per wave in 1v1, "cop1" (moment 3) | 3 | owner's police tuning | ✔ | S | med | **Do not ship this round.** It combined badly with A (draws 19%, proxy wins 27%). Keep it as a harness knob only, and revisit after human playtests. |
| W | Officers target the leader, "heat" (moment 3 optional) | – | **Violates §19** "역전 빈도를 맞추려고 자동 보너스를 주지 않는다" | – | – | – | **Dropped** |
| X | fastbank (drag 1.8→1.1) | – | bank share 53% > §6 | – | – | – | **Dropped** (measured worse) |
| Y | "Dazed" officers after a tackle | 1 | ✔ | ✔ | S | – | **Dropped** (no measured gain) |
| Z | Fence on plaza and counter (moment 9) | 3 | §14 ✔ but blurs shortcut's identity | ✔ | M | med (route lengths, re-validation) | Defer: first see whether pacing changes drama on those layouts |
| AA | Daily seeded heist (meta 7) | 3 | §16 ✔ (no seasons, no streak) | ✔ cumulative stamps only | M | low | Defer to round 2 (needs WP9 / WP10 first) |
| AB | 도장판 27-medal grid (meta 6) | 3 | ✔ | ✔ | M | med (some cells near impossible: 통큰이@창구 1/20) | Defer until per-cell odds are measured; records ship in WP6/WP9 |
| AC | Growth signals / 기록부 screen (meta 10) | 2 | §19 metrics ✔ | ✔ improvements only | S–M | low | Defer; the ring buffer of the last 20 summaries is added in WP9 so it can be built later |
| AD | World reactions + LED news ticker (feel 10) | 2 | ART §1/§4 ✔ | ✔ | M | low | Defer |
| AE | Counterfactual lines ("carrying it would have flipped it") | – | §12 violation; never true in the data (0 of 127) | – | – | – | **Dropped** |
| AF | Streak counters, comeback timers, expiring challenges, random drops, XP gates | – | – | ✗ | – | – | **Excluded** (dark patterns) |

---

## 3. Work packages

Effort is in developer-days for one agent. Total is about 30 days across up to 10 parallel agents; the critical path is about 5–6 days.

### Shared contracts (frozen on day 0, before parallel work)

These let the packages build in parallel. Each contract has one owner, noted in brackets.

1. **`src/sim/queries.ts`** (add only, pure, no sim behaviour change) [WP4]:
   - `matchPointInfo(state): { team: TeamId; kind: 'win' | 'tie'; value: number; lootIds: EntityId[]; carrierIds: EntityId[] } | null`. It returns the single largest decisive carried or loading load, using the same arithmetic as `checkEnd` (`lead > other + remainingValue`, or all-recovered).
   - `swingInfo(state, team): { toTie: number; toLead: number; remaining: number }`.
2. **`src/game/moments.ts`** `MomentTracker` (pure, deterministic, unit-tested) [WP5]:
   - `observe(state, simEvents, botIntents): Moment[]`.
   - `Moment.kind` is one of: `leadTaken | equalized | matchPointOn | matchPointStopped | streakTier | streakBroken | bigPlay | stealChance | tauntPunished | dodged | counterDash`.
   - Each moment carries `team`, `pos?`, `score?`, `value?` and `tier?`.
   - WP4 (HUD), WP8 (audio) and WP3 (render) only consume moments. They never re-derive them.
3. **`EmoteCancel` cause** [WP2]: add an optional `cause?: 'move' | 'grab' | 'dash' | 'hit'` to the `emoteCancel` event in `types.ts`. This is add only, per ARCHITECTURE contracts.
4. **Render API additions** [WP3]:
   - `view.glance(pos, weight ≤0.3, ms)`
   - `view.playGetaway(team)`
   - `view.setDecisiveLoad(ids, side | null)`
   - `view.setStealChance(doorPos | null, value)`
   - `view.setResultsPoses({ rival: 'taunt' | 'slump', player: EmoteId | null })`
   - a `windup` telegraph read from `BotIntent.phase`
5. **Audio API** [WP8]: `director.onMoments(moments)` and `director.setTension({ matchPoint: 'ours' | 'theirs' | null, secondsLeft })`.
6. **Save API v2** [WP9]: `rivals`, `records`, `cups`, `challenges`, `recent[20]`, `funnel`, plus helpers:
   - `recordMatchOutcome(summary)` returns `{ newRecord: RecordKind | null }`
   - `rivalRecord(rival, diff)`
   - `cupProgress(cup)`
   - `bumpFunnel(key)`
7. **Strings:** each package appends one namespaced block to `src/ui/strings/ko.ts` and `en.ts`. Prefixes: `hud.mp.*`, `hud.moment.*`, `results.hook.*`, `rivalLine.*`, `cup.*`, `onboard.*`, `book.*`, `taunt.bark.*`. No package edits another package's block.
8. **File ownership inside shared files:**
   - `match.ts`:
     - WP5 owns the tracker call, cues and the command log.
     - WP4 owns the moments → HUD and banner-queue code.
     - Nobody else edits it.
   - `app.ts`:
     - WP6 owns `toResults` / `onMatchFinished`.
     - WP7 owns `toMenu`, `tournamentConfig` and `offerAfterTutorial`.
   - `save.ts`: WP9 only.

---

### WP1: Match pacing "Race the siren" + warm-up safes + fun scorecard (sim / ai / layouts)

**Effort:** M (3 d). **Wave:** A, start immediately; it gates final tuning for everyone.

**Step 0, fun scorecard tool.**
- Port `scratchpad/fun/metrics/measure.ts` + `agg.ts` + `extra.py`, plus the match-point tracker from `fun/moment/exp/mp.py`, into the repo as a `--fun` block of `tools/balance-report.ts`.
- It must print every metric in §4 of this plan, per layout and in total, for blocks P (proxy vs each rival at normal, 3×3×20 seeds, alternating sides), B (normal bot vs bot, 3×3×20) and T2 (2:2 smoke, 3 layouts × 10 seeds).
- Re-run the baseline at the current tree and record it in the report header. All targets below are deltas against this re-baseline. If it differs from 1ede9fb by more than 5 points on any gated metric, flag it.

**Changes:**
1. `src/sim/config.ts`: `POLICE.dispatchDelayTicks` = `secondsToTicks(18)`. This is a value change; no fields are renamed.
2. `src/ai/params.ts`: `BOT_TUNING.bankPoliceDrag` 0.3 → 0, and `waveDefer` 0.9 → 0.3. These are used at `bot.ts` around lines 1272–1274. `policeSense.ts` reads the delay from config automatically.
3. Warm-up safe on every layout where proxy median first score > 15 s:
   - `shortcut.ts` (back-street small safe and its mirror) is certain.
   - Check `plaza.ts`.
   - Target: about 12–15 m walk and about 10 m carry from spawn, **outside every bank route sweep**. The tested spot (19.5, 21.4) fails `layout-check`.
   - Mirror symmetry and the 3200 total are unchanged.
4. If draws are still above the gate after 1–3, try these levers one at a time, re-measuring each with n=180:
   - (a) A tied-score late-contest rule: when R ≤ 400 and the score is tied, a bot prefers to dash or steal from an opposing carrier of the last load over taking the mirrored safe. Check why the owner removed `contestLate` first; do not resurrect it blindly.
   - (b) Small spawn-distance asymmetry of the *last* small safes. This is allowed only if mirror fairness still holds.
   - No tie-break rules: ties stay draws (§8).

**Acceptance (P block n=180 unless noted; all vs the re-baseline):**

| Metric | Baseline | Gate (must) | Target |
|---|---|---|---|
| Full 30 s countdown played (of matches reaching it) | 28% | ≥ 40% | ≥ 45% |
| Ended ≤ 2 s after 2nd bank | 40% | ≤ 32% | ≤ 30% |
| Countdown start, median | 144 s | 100–130 s | 105–125 s |
| Value on field at countdown, median | 300 | ≥ 400 | ≥ 500 |
| Draws, P / B | 14% / 11% | ≤ 12% / ≤ 10% | ≤ 10% / ≤ 9% |
| Draws on plaza (P) | 20% | ≤ 15% | ≤ 12% |
| Proxy first score, median, **every layout** | 31 s (shortcut 38) | ≤ 18 s | ≤ 15 s |
| Longest no-score stretch, median | 34 s | ≤ 32 s | ≤ 30 s |
| Proxy dead time (stretches > 8 s) | 13% (plaza 18%) | ≤ 11% (plaza ≤ 14%) | ≤ 10% (plaza ≤ 12%) |
| Proxy blowout losses | 13% | ≤ 6% | ≤ 4% |
| Proxy comeback wins (≥ 500) | 8% | ≥ 13% | ≥ 16% |
| Rematch-worthy | 73% | ≥ 78% | ≥ 82% |
| Late swing | 55% | ≥ 60% | ≥ 63% |
| Proxy W / L | 28 / 57 | W ≥ 32, L ≤ 54 | W ≥ 35 |
| Bank share of points | 41% | ≤ 50% | 42–48% |
| Police tackles/min; proxy tackled ≥ 5 | 2.3; 26% | ≤ 2.5; ≤ 26% | ≤ 2.3; ≤ 22% |
| Dash KOs/min | 0.3 | ≥ 0.3 | ≥ 0.4 |
| Match length median; reaching 240 s | 158 s; 6% | 135–165 s; ≤ 8% | – |
| 2:2 smoke (T2): crashes, invariant violations, draws | – | 0, 0, ≤ 12% | – |

**Hard gates (all packages, run in CI):**
- `npm run typecheck`, `npm test`, `npx tsx tools/layout-check.ts`.
- The 3200 invariant fuzz test and the mirror-fairness tests pass.
- 0 crashes and 0 invariant violations across P + B + T2.

---

### WP2: Rivals with a pulse: bot taunts + readable dash wind-up (ai)

**Effort:** M (3 d). **Wave:** B. It starts after WP1's two constant edits are merged and the sim processes emotes.

**Dependency:** sim emote processing. `Command.emote` must become `EmoteState`, with `emote` / `emoteCancel` events, cancelled on move, grab, dash or knockdown, as in the `EMOTE` config.
- This is the owner's in-progress work. Ask the owner first.
- If it has not landed by the start of wave B, WP2 implements exactly the contract already in `types.ts` / `config.ts`, plus the `cause` field.
- The sim emote step must not touch physics, scoring or recovery (unit test: identical state hash with and without emotes, except the `emote` fields).

**Changes:**
1. New file `src/ai/tauntPolicy.ts`: pure and deterministic. No `Math.random` and no wall clock; any variation comes from the bot's seeded RNG or the tick.
   - Bots set `Command.emote` only when all of these hold:
     - empty-handed
     - no officer within 8 m
     - no opposing carrier the bot should be contesting
     - at least 25 s since its last taunt
     - fewer than 4 taunts this match (novice 2, normal 3, challenge 4)
     - the bot is ahead, or it is right after its own play
   - Triggers:
     - 통큰이 `tongkeunFlex` after its own bank recovery.
     - 호다닥 `hodadakZoom` within 3 s of a quick 100.
     - 눈치왕 `nunchiShrug` or `bleh` after stealing from the player's haul, or when the player is tackled within its sight.
   - It prefers to taunt 4–6 m from the nearest human when that costs no more than 1.5 s of detour, so the human can punish it with a dash.
   - At normal and challenge, if a human taunts within dash reach and the bot's dash is ready, it may answer with a dash. The probability is `threatResponse` (decision logic, not physics).
2. Two-phase dash in `Bot.dashAt` (around `bot.ts:3121`):
   - Wind-up length by difficulty: novice 0.45 s, normal 0.30 s, challenge 0.15 s. This is a `DifficultyParams.dashWindupTicks` field, added only.
   - During the wind-up, `intent().phase = 'windup'` with the target id.
   - At the end it re-checks validity and fires, or cancels.
   - Police stuns and teammate cover dashes keep a shorter wind-up (≤ 0.15 s), so the owner's police-AI timing (stun a few ticks before protection ends) does not regress. The owner's police tests must pass unchanged.
3. Bot barks are text bubbles only, no voice, rate-limited with the taunts:
   - 통큰이 "내 은행!!" when its haul is broken.
   - 눈치왕 "어머~" when its steal is stopped.
   - Emitted as an intent field `bark?: BarkKey`. WP3 renders them; they respect the existing `showOthersTaunts` setting.

**Acceptance:**
- Bot taunts per bot per match: median 1–3, max ≤ cap. 0 taunts while holding, within 8 m of an officer, or in the final 10 s while their own team is not clinched.
- Share of bot taunts that start within 6 m of the human with line of sight: ≥ 50%.
- Tested in the P block with a proxy patch that dashes at a taunting bot in reach. "Taunt punishable" means the proxy hits it ≥ 60% of the times it tries from ≤ 5 m.
- Dash KOs by normal bots on the proxy drop by ≤ 25%. Proxy win rate vs normal stays ≤ 50%: bots must not become pushovers.
- The WP1 scorecard gates still hold after WP2 (re-run P + B).
- Determinism: same seed gives the identical event log twice. `npm test` passes, including the owner's `test/ai/police.test.ts` and `test/unit/taunts.test.ts`.

---

### WP3: Render beats: getaway on every ending, decisive-load glow, big-play camera, telegraphs, results stage (render + menu3d)

**Effort:** M (4 d). **Wave:** A. It implements the APIs against stub moments; final wiring is in wave B.

**Changes:**
1. **Getaway on every ending.** During the existing 2.4 s end hold (`match.ts:43` → `view.playGetaway(winnerTeam)`):
   - The winner's van honks, puffs exhaust and pulls away 3–4 m with the siren and strobe.
   - Today `view.ts:733` only turns the siren on during the countdown.
   - On a draw, both vans rev and do not leave.
   - Rematch input is buffered, never blocked.
2. **Decisive-load glow:** `setDecisiveLoad(ids, 'ours' | 'theirs')`. A pulsing rim plus a world label anchored to the load ("승부 포인트" / "막아야 해!" text comes from WP4's strings). Only one load at a time. Shown on top of police markers.
3. **Steal chance marker:** `setStealChance(doorPos, value)`, using the existing `markers.ts` / WorldLabels. One marker at most: a door glow plus "빼내기 +300".
4. **Big-play beat:**
   - `glance(pos, weight ≤ 0.3, ms)` blends the camera toward the event, with no yaw change (doc §4).
   - `impactAt` pulse.
   - When the local player is steering a load, use a hit-stop ≤ 80 ms instead of slow-mo.
   - Respect reduced motion: no glance and no slow-mo.
5. **Telegraphs:**
   - Bot `windup` phase: crouch pose plus a spark ring at the feet, readable at the default camera distance.
   - Bark bubble (WP2).
   - "!?" sweat mood on the team that lost the lead or had its streak broken, from moments, via `moods.ts`.
6. **Scoring-run flame:** a subtle rim on that team's van while a streak tier is active (tier 1 / tier 2).
7. **Results stage:**
   - Hide or move police officers.
   - Fix camera clipping into models: test at speed 1 and at a low render scale.
   - `setResultsPoses`: the rival plays its taunt when it wins and slumps when it loses. The player's chosen victory pose plays on a win (default `wiggle`).

**Acceptance:**
- Screenshot checks (headless Chromium, 1280×720 and 1920×1080, plus a 16 px gutter check at phone width for menus):
  - every ending type (time / decided / allRecovered / draw) shows the getaway beat
  - the decisive-load label is visible and does not overlap the HUD
  - no officers on the results stage
  - no camera clipping
- Frame time: on the reference quality preset, the getaway and big-play beats add ≤ 1 ms median frame time. No new allocations per frame in steady state (check the heap snapshot delta).
- Time from match end to an accepted rematch press is unchanged (≤ 2.4 s hold + results). A buffered press during the drive-off starts the rematch.
- Reduced-motion setting: zero glance or slow-mo calls (unit test on the feel layer).

---

### WP4: Tension HUD: match point, swing readout, lead and streak stamps, banner queue (ui / hud + sim queries)

**Effort:** M (3 d). **Wave:** A. It owns the `queries.ts` contract, delivered on day 1.

**Changes:**
1. `queries.ts` `matchPointInfo` / `swingInfo`. Unit tests over handcrafted states:
   - one equality case (a load that ties shows `kind: 'tie'`, never "win")
   - an all-recovered case
   - a 2:2 shared-haul case
   - a fuzz test: for 50 seeded bot matches, every `decided` / `allRecovered` ending tick is preceded by a non-null `matchPointInfo` for the winner, unless the deciding recovery started under 1.5 s before.
2. HUD (`src/ui/hud/adapters.ts`, `Hud.ts`, `Effects.ts`):
   - Extend `lastBankWarning` into a general decisive-load prompt: "이게 들어가면 끝!" for ours, "막아야 해!" for theirs. Only the single largest load is shown.
   - Readout under the scores, from `swingInfo`: "역전까지 N · 남은 M", shown only after the first bank recovery or when M ≤ 1000.
   - Stamps from moments: `leadTaken` "역전!", `equalized` "동점!", `matchPointStopped` "막았다!", `streakTier` "연속 {pts}점", `streakBroken` "끊었다!", `tauntPunished` "도발 응징!", `dodged` "피했다!", `counterDash` "맞불!".
   - When a lead change happens together with "은행째!", merge them into one stamp with a sub-line.
   - Keep the stamp column cap at 2.
3. Crown icon that hops to the leading team's score panel (`Hud.setLeader`). The emblem plus a shape difference, not color alone (§13).
4. Banner priority queue (`match.ts` around lines 520–545 plus the banner component):
   - Priority: climax (countdown) > police > others.
   - The climax banner is compact, sits in the top third and shrinks to a badge after 0.8 s.
   - No two centre plates at once.
5. Final 10 s: the timer digits slam each second, with a digit scale pulse only.

**Acceptance:**
- In the WP1 scorecard, match point is visible for ≥ 3 s before the end in ≥ 85% of `decided` + `allRecovered` endings. Measured with `matchPointInfo` itself.
- Stamps per match: median 2–5 and p90 ≤ 9. No more than 2 on screen. No stamp is shown for an event that did not happen (unit tests per stamp against recorded event logs).
- At countdown start: screenshot shows at most 1 centre plate, and the action under the plate stays ≥ 60% visible.
- The HUD never claims "승리 확정" for a `tie` load. Unit test against the 3200 invariant, using `remainingValue` from the sim.

---

### WP5: Moment director + opportunity cues + command log (game flow)

**Effort:** M (3 d). **Wave:** A. `MomentTracker` is delivered on day 1–2.

**Changes:**
1. `src/game/moments.ts` `MomentTracker` (pure):
   - Lead before vs after each tick's recoveries → `leadTaken` / `equalized`.
   - `matchPointOn` / `matchPointStopped`: a decisive load ends without ending the match.
   - Unanswered scoring runs with gaps ≤ 25 s: `streakTier` 1 at three recoveries in a row or 800 pts, tier 2 at 1000; `streakBroken`.
   - `bigPlay` scoring, emitted at ≥ 6, at most 4 per match, with a 10 s cooldown:
     - steal from a moving bank: v/100 + 2
     - dash KO on a carrier: v/100 + 1.5, or + 3 if it was a bank
     - bank grabbed from the rival's haul and recovered: + 3
     - lead-flipping recovery: + 3
     - recovery with ≤ 15 s left: + 4
     - fence bust: 4
   - `stealChance`: an opponent hauls a bank that still holds safes and the nearest open door is ≤ 20 m from the human, or on screen. Choose the single best door.
   - `tauntPunished`: `emoteCancel` with cause `hit` by an opposing dash.
   - `dodged`: a bot wind-up targeting the human is cancelled or misses while the human moved ≥ 1 m sideways.
   - `counterDash`: a symmetric clash event.
2. `src/game/feel.ts`: maps moments to render (WP3), HUD (WP4) and audio (WP8) calls. It applies the time-scale rules: slow-mo 0.5× for 0.4 s on `leadTaken` in the final 30 s and on `bigPlay`; hit-stop ≤ 80 ms when the human is steering.
3. Kickoff cue:
   - For the first 5 s of a match, pulse the nearest small safe to the human.
   - Only for players with fewer than 10 completed matches is a single short arrow also shown (`scriptArrows`).
   - After that, the pulse ring only (§4 arrow rule).
4. Command log: in `stepOnce()`, copy `cmds` exactly into `src/game/replay.ts` `CommandLog` (compact typed arrays, no rounding).
   - Add a CI test that records a full police-on match, replays it in a fresh `Simulation(sim.setup)` with the same commands, and asserts an identical event log and final state hash.
   - This is the foundation for round 2's instant replay and makes bug reports reproducible.

**Acceptance:**
- `MomentTracker` unit tests against recorded event logs, with at least one log per moment kind.
- Harness counts over the P block:
  - `bigPlay` with the human involved: 1–3 per match (median)
  - `leadTaken` + `equalized`: matches the scorecard's lead changes exactly
  - streak tier 1 in 30–40% of matches, tier 2 in 15–25%
  - `stealChance` shown in ≥ 60% of opponent bank hauls that hold safes
- Proxy steals per match +20% or more when the proxy patch follows `stealChance` (tests the cue's usefulness, not just its presence).
- Replay determinism test is green in CI. Command-log memory ≤ 150 KB per 4-minute match.
- Kickoff arrow appears only in matches 1–9 of a fresh save (e2e).

---

### WP6: Results that pull you back: next-match strip, timeline, honest stamps, rival line (ui + game flow)

**Effort:** M (3 d). **Wave:** B. It needs the WP9 save API, but can stub it on day 1.

**Changes:**
1. `src/game/resultsHooks.ts` (pure). It reads `sim.eventLog`, the end state and the saved records, and produces at most 3 chips.
   - **Factual chip, one of:**
     - Loss by d ≤ 300: "{d}점 차 — 작은 금고 {d/100}개 차이", or "큰 금고 하나 차이" when d = 300.
     - Loss where the player led late: "종료 {sec}초 전까지 앞섰어요". This is true in 76% of proxy losses.
     - Loss by more than 300: "끌던 은행을 {n}번 놓쳤어요 (경찰 {a} · {rival} {b})" or "빼앗긴 금고 {v}점".
     - Win ≤ 300: "{d}점 차로 지켜냈어요".
     - Comeback ≥ 500: "최대 {x}점 뒤지다 역전".
     - Draw: "완전 동점 {s}:{s} — 결판은 다음 판에".
   - **Record chip:** at most one. "신기록" per layout × rival best score or best winning margin, plus global biggest single haul and fastest first recovery. The target hit rate is 25–40%.
   - **Next-goal chip:** the nearest unfinished 수첩 challenge from WP10 ("작은 금고 9/10 → 별 스티커 밴"), or the next cup round from WP7.
   - No counterfactual wording. Every number is traceable to the event log or the save.
2. Score timeline: an SVG step chart of both teams.
   - Team emblems and solid vs dashed lines, so it doesn't rely on color.
   - Icons for bank recoveries, steals, KOs on carriers and the countdown start.
   - It goes in place of the static biggest-moment icon area. The single biggest event card stays (§12).
3. Margin-aware stamp and subtitle:
   - "아깝다!" for a loss ≤ 300, "아쉽다!" otherwise.
   - `results.lose.sub` becomes a factual line with the margin ("300점 차 — 큰 금고 하나"). Replace the static string (`ko.ts:365`) and its en counterpart.
4. Rival line and head-to-head:
   - Speech bubble from the rival at 2.0 s, text only, behind a settings toggle (§13), in the ART_DIRECTION §5 voices.
   - Chosen by outcome × margin bucket × streak, with 3 variants each, and only true facts ("벌써 3연승이네~" only when true).
   - Head-to-head line "3승 5패 · 2연패 중".
   - "숙적" badge on the rival with the most wins over the player; a "숙적 격파" chip when the player beats them.
5. Rematch button relabel ("복수전!" / "한 판 더" / "결판 내자"), with the same action.
   - Fix the series chip so it says whose match point: "호다닥 매치 포인트!" / "내 매치 포인트!".
6. Timing:
   - Stamp and roll-up as today (about 1.4 s).
   - Chips slide in at 1.6 s, the bubble at 2.0 s.
   - Focus is on rematch from the first frame. Enter at any time rematches; nothing needs dismissing.
   - Bump the funnel counters (WP9).

**Acceptance:**
- Unit tests:
  - Every chip number equals a value recomputed from the event log, for 30 recorded matches across outcomes.
  - The draw chip appears only when the scores are equal.
  - At most 3 chips.
  - The record chip hit rate over a resampled sequence of 180 harness matches is 25–40% at match 10.
- e2e: the results-to-rematch path takes 1 press at t = 0.1 s, 1.6 s and 3 s, and the rematch starts. No modal appears. Small screens collapse to 1 chip.
- Every proxy loss shows a non-generic factual chip (0% "이번엔 빈손" after scoring > 0).
- ko and en key parity test passes (`i18n.test.ts`).

---

### WP7: Tournament cups + first-hour path + menu "next" card (game flow + ui)

**Effort:** M (3 d). **Wave:** B. It needs WP9's `cups` and `onboarding` save fields.

**Changes:**
1. `src/ai/params.ts`: add `lerpDifficultyParams(a, b, t)`. It is a pure function over numeric `DifficultyParams`, and a `BotOptions.params?` override. No change to existing values.
2. `src/game/tournament.ts`: a `CUP_ROUNDS` table.
   - 입문: novice → 0.35 → 0.6 (fraction of the way to normal).
   - 보통: 0.6 → 0.8 → normal.
   - 도전: normal → 0.5 → challenge.
   - Rival order stays 호다닥 → 통큰이 → 눈치왕 (§12). Steps are fixed and shown as ★ pips; results never move them (§11).
   - Re-pick each round's layout from harness data so the series odds rise smoothly. 호다닥@창구 is the candidate for R1, since 호다닥@광장 is the hardest first slot. Each rival keeps one fixed layout per cup, shown before the series starts.
   - `startSeries(p, rival, cup)`.
3. `app.ts tournamentConfig`: uses the cup's params, not `difficulty ?? 'normal'`.
   - `TournamentScreen.ts`: cup tabs, all open from the start (§12), with a "추천" badge on 입문 for saves with fewer than 5 matches.
   - Rewards stay cosmetic:
     - first clear of a rival in any cup: that rival's hat + taunt
     - cleared at 보통: silver ribbon on the hat
     - cleared at 도전: gold ribbon
     - all three cleared at 도전: '광장의 왕관'
4. First-hour path "첫 출동": a 4-stamp strip on the menu and results: 연습 → 첫 대전 → 경찰 출동 대전 → 대회 입문 컵.
   - The first match after practice moves from plaza to 열린 창구. Today it is `app.ts` around line 672; proxy dead time there is 5% vs 18% on plaza.
   - During onboarding the results primary button is "다음: 경찰 출동 대전". It is still a single press into a match, with rematch as the secondary button.
   - The strip is dismissible, and auto-skips after a win at normal. Nothing is locked.
5. Menu "이어서 / 다음 목표" card (`toMenu`, `MainMenu.ts`), with initial focus and one press.
   - Priority: series in progress → next onboarding step → nearest 수첩 challenge.

**Acceptance (harness: proxy vs the round's bot, 60 seeds per cell, police on, draws replayed):**

| Cup | R1 series odds | R3 series odds | Rule |
|---|---|---|---|
| 입문 | ≥ 80% | 55–70% | monotone non-increasing within ±5 |
| 보통 | 55–65% | 35–45% | same |
| 도전 | 30–40% | 15–25% | same |

- Expected games to clear 입문 R1 ≤ 4 (today at normal: about 13).
- Save migration: a v1 save with `beaten = [hodadak]` and a series in progress loads into v2 with hodadak filed under 보통, the series kept and the hat kept. Covered by unit tests in `test/unit` that run v1 fixtures → v2.
- e2e: from a fresh save, tutorial → first match (창구, police off) → results primary "다음" → police match → tournament with 입문 recommended. Every step is a single press.

---

### WP8: Tension audio (audio)

**Effort:** S–M (2 d). **Wave:** A, against stubbed moments.

**Changes (`src/audio/director.ts`, `sfx*.ts`, `ids.ts`, `captions.ts`):**
1. Match-point heartbeat layer, from `setTension`: ours is warm and theirs is tense, ducking the music by 3 dB. On `matchPointStopped`, a "막았다" sting.
2. Lead-change sting: rising in key for us, falling for them. On a merged "은행째 + 역전", a single sting.
3. Coin pitch climb driven by unanswered scoring runs (gaps ≤ 25 s) instead of the 8 s window. Streak tier 2 adds a percussion layer. `streakBroken` gets a record-scratch blip.
4. Final 10 s: ticking on the last 3 s, van rev under the music, and a honk plus drive-off on `playGetaway` on every ending.
5. Taunt-punish "boing", a dodge whoosh, a counter-dash clash accent, and bark blips: non-verbal and per-rival timbre (§13, no mocking voice).
6. Captions for every new cue (accessibility).

**Acceptance:**
- Offline renders (`src/audio/offline.ts`): the new cues have peak ≤ −1 dBFS and the mix integrated loudness changes by ≤ 1 LU vs today over a recorded match.
- No cue overlaps itself more than 2 voices deep, with a voice limiter.
- Heartbeat is active only while `matchPointInfo` is non-null (unit test with the director on a recorded event log).
- Coin climb reaches step ≥ 3 in 30–40% of P-block matches (today 7%).
- Caption for each new cue exists in ko and en.

---

### WP9: Save v2, honest records, rival records, emote unlock fix, funnel counters (platform / save)

**Effort:** M (2–3 d). **Wave:** A. The API stub is on day 1; WP6, WP7 and WP10 build against it.

**Changes (`src/platform/save.ts`, `progress.ts`, `emotes.ts`):**
1. `SAVE_VERSION` 2, with migration step 1 → 2 (add fields; file the old `beaten` list under the 보통 cup, keep the series).
   - Sanitize every new field. A save from a newer version is quarantined as today.
2. New save fields:
   - `rivals[rival][difficultyOrCup]` = {W, L, D, streak, lastScore, bestMargin}
   - `records[layout][rival]` = {bestScore, bestMargin}
   - `globalRecords` = {biggestHaul, fastestFirstRecovery}
   - `cups` = `Record<Cup, RivalId[]>`, plus `series.cup`
   - `challenges` (progress counters and completed ids)
   - `recent` (ring buffer of the last 20 match summaries)
   - `onboarding` (strip state)
   - `funnel` (local only: results shown, rematch / next / menu presses, matches per session, distinct play days, milestone timestamps)
3. **Bug fix:** `recordTournament` adds the rival's emote to `unlockedEmotes` whenever it awards the rival's hat (via `EMOTE_RIVAL`).
   - `sanitizeSaveData` self-heals: a beaten rival means its emote is unlocked, as already done for hats.
   - The results reward strip text becomes "새 모자 + 새 도발" (WP6 renders it).
4. `recordMatchOutcome(summary)` updates all of the above in one write and returns `{ newRecord }` for WP6. Cumulative challenge counters are capped per match (WP10 supplies the caps).
5. A debug screen (dev builds only) shows funnel counters for playtests. Nothing is ever sent over the network: no network API is imported in `src/platform/save.ts`, enforced by a lint/test grep.

**Acceptance:**
- Unit tests:
  - v0 / v1 fixtures migrate to v2 losslessly
  - a corrupt field is sanitized without losing the rest
  - a newer-version save is quarantined
  - the emote unlock is self-healed for a v1 save with beaten rivals
  - `recordMatchOutcome` is idempotent per match id (a double call does not double count)
- e2e: beating a rival unlocks its taunt in the emote wheel. Today the slot stays a gift box forever.
- Save size stays ≤ 64 KB with 20 recent summaries.

---

### WP10: 털이 수첩 lite + procedural cosmetics (game + ui + render)

**Effort:** M–L (4 d). **Wave:** B (needs WP9). It owns the new hat and van models in `src/render/models/*` and the wardrobe screen.

**Changes:**
1. `src/game/challenges.ts`: pure predicates over the event log, in the style of `achievements.ts`. 12 challenges on 3 pages, each with a fixed, visible requirement and reward:

| Page | Challenge | Reward |
|---|---|---|
| 견습 | First recovery | van 별 스티커 |
| 견습 | 10 small safes recovered (cumulative, ≤ 3 per match) | hat 베레모 |
| 견습 | Whole bank with a safe inside | van 체크무늬 |
| 견습 | 5 police stuns (≤ 2 per match) | hat 밀짚모자 |
| 숙련 | One match on each of the 3 layouts | van 발자국 |
| 숙련 | Steal a big safe from a bank the opponent is hauling, then recover it | hat 공사장 헬멧 |
| 숙련 | Win by 300 or less | van 금박 라인 |
| 숙련 | Recovery in the last 10 s | hat 우체부 모자 |
| 달인 | Comeback of 500+ | hat 꽃 화관 |
| 달인 | Both banks in one match | van 물방울 |
| 달인 | Punish a taunt and win | victory pose slot unlock: the player can choose which owned taunt plays after a win |
| 달인 | Beat all 3 rivals in any cup | hat 수영 고글 |

2. Six new `HatId`s in `src/sim/types.ts` (add only; `HAT_IDS` extended). Procedural hat meshes in `src/render/models/raccoon.ts`, about 30 lines each.
   - Rules: no police-looking shapes, and the team emblem stays dominant (§13).
3. Van paints: procedural pattern textures within the team's color family in `src/render/models/van.ts`. Team color stays the dominant hue.
4. `WardrobeScreen.ts`: tabs 모자 / 밴 / 포즈 / 수첩.
   - Progress shows in the 수첩 tab and in WP6's next-goal chip.
   - Completion is an inline row plus a non-blocking toast after rematch focus.
5. Cosmetics never change stats (`setup.ts` passes them only to render). There is no randomness, no currency and no timers.

**Acceptance:**
- Unit tests: each predicate is true on a crafted event log and false on near-miss logs, and per-match caps hold.
- Harness pacing over P-block matches, replayed as a sequence: the median number of matches to finish the 견습 page is 3–6, and 숙련 is 10–25. No challenge is below 2% per-match odds for the proxy at 입문/보통.
- Screenshot: all 6 hats and 4 van paints on both teams pass a team-readability check. Each team stays identifiable in grayscale by emblem and van shape.
- e2e: completing a challenge never adds a step before rematch; the toast appears only after focus lands on rematch.

---

## 4. Build order

| Wave | Days | Packages |
|---|---|---|
| Day 0 | 0.5 | Freeze the shared contracts (§3). Re-baseline the scorecard (WP1 step 0). Ask the owner about sim emote status. |
| A | 1–3 | WP1, WP3, WP4, WP5, WP8 and WP9 run in parallel. WP4 delivers `queries.ts` on day 1, WP5 delivers `MomentTracker` on day 1–2, WP9 delivers the save API stub on day 1. |
| B | 3–6 | WP2 (after the WP1 constants and the sim emote step), WP6, WP7 (needs harness odds, so it runs alongside WP1's tuning), WP10. |
| Integration | 6–7 | Full scorecard re-run (P + B + T2, n = 180 / 180 / 30). All gates are re-checked after WP2 lands, because WP2 changes bot strength. Screenshot pass. e2e rematch-path pass. |

**Rule:** pacing levers interact. They did not add up in the experiments: early + cop1 was worse than early alone. So WP1 changes one lever at a time, with n ≥ 180 per change. Nobody else changes `POLICE` or `BOT_TUNING` values.

---

## 5. Fun scorecard to measure after implementation

Run with `tools/balance-report.ts --fun` (WP1). P = proxy vs each rival at normal, 3 layouts × 3 rivals × 20 seeds, alternating sides. B = normal bot vs bot. T2 = 2:2 smoke. All with police on.

**Structure and pacing:**
- Countdown start (median), value left at the countdown, full 30 s played, ended ≤ 2 s after the 2nd bank.
- Match length, matches reaching 240 s, end reasons.

**Closeness:**
- Draws in total and per layout, and the share of 1600:1600 all-recovered draws.
- Margin buckets, decided by ≤ 300, blowouts.
- Lead changes, late swing, comeback wins, rematch-worthy.

**Player experience (proxy):**
- First score, per layout.
- Dead time and longest no-score stretch.
- Tackled ≥ 5, haul broken ≥ 4, KOs dealt vs received, steals.

**Visible tension:**
- Share of early endings with ≥ 3 s of visible match point.
- Stopped match points per match.
- Stamps per match (median, p90).
- `bigPlay` moments per match, streak tier rates, coin-climb ≥ 3 rate.

**Rivals:**
- Bot taunts per bot per match, taunts punished.
- Wind-up dodge rate (proxy with a sidestep patch).

**Progression (harness):**
- Cup series odds per round.
- Record-chip hit rate by match index.
- Challenge completion pacing.

**Stability:**
- Crashes, invariant violations, mirror fairness, replay determinism.
- Frame-time delta, save migration tests.

**Local funnel (playtest builds, debug screen):**
- Results → rematch / next / menu split, and time to the rematch press.
- Matches per session, distinct play days.
- Time to first hat, share of players clearing 입문 R1 within 3 series.

**Headline targets for the round (P block unless noted):**

| Metric | Baseline | Target |
|---|---|---|
| Full 30 s countdown played | 28% | ≥ 45% |
| Quick endings (≤ 2 s after 2nd bank) | 40% | ≤ 30% |
| Draws (P / B) | 14% / 11% | ≤ 10% / ≤ 10% |
| Proxy first score, every layout | 31 s | ≤ 15 s |
| Proxy dead time | 13% | ≤ 10% |
| Blowout losses | 13% | ≤ 4% |
| Comeback wins | 8% | ≥ 16% |
| Rematch-worthy | 73% | ≥ 82% |
| Early endings with ≥ 3 s visible match point | 0% (never shown) | ≥ 85% |
| Lead changes with feedback | 0% | 100% |
| Bot taunts per bot per match | 0 | 1–3 |
| Losses with a factual results chip | 0% | 100% |
| 입문 R1 games to clear | about 13 (normal only) | ≤ 4 |
| Crashes / invariant violations | 0 / 0 | 0 / 0 |

---

## 6. Items that must wait for real human playtests (§19)

The proxy is a scripted bot. These questions cannot be settled by the harness:

1. **Voluntary rematch.** §19 targets: "스스로 재대전 ≥ 14/20" for new players, and ≥ 8/12 after two sessions. Run an A/B with the WP6 strip on and off. This is the single most important number for the owner's demand.
2. **"It suddenly ended" complaints** (§19 last-30 s question) before and after WP1 + WP4. Also check whether "막아야 해!" is understood: at least 16 of 20 should explain it unprompted.
3. **Real difficulty curve.**
   - Human win rate vs normal and cup series odds.
   - Whether police feel like hidden difficulty: the proxy reads police at 0.55 awareness vs bots at 0.75. Revisit the cop1 lever (1 officer per 1v1 wave) only with human data.
4. **Draw rate with humans.** Humans may contest the last load more than the proxy, especially with match point visible. Only if draws stay above 10% should a deeper rule or layout change be considered. Ties stay draws.
5. **Taunts:**
   - Do bot taunts read as cute or mean?
   - How many players turn `showOthersTaunts` off?
   - Do players feel a "nemesis / 복수전" pull?
6. **Dash wind-up:**
   - Dodge rate should be 20–40% for humans.
   - Does it feel fair, or does it make bots feel slow or weak?
7. **Slow-mo and glance:** does any slow-mo feel like input lag? Measure the complaint rate, and check that the hit-stop fallback is enough.
8. **Challenge book pacing and appeal.** Do new hats and van paints motivate play? Do any challenges feel grindy? This decides whether fur palettes, the daily heist and the medal grid get built in round 2.
9. **Silent 10 s clip test** (§19: 16 of 20) with the getaway and big-play beats in place. This decides whether instant replay (deferred item T) is worth its cost in round 2.
10. **Results rival lines:** are they read as facts or as fake narrative (§12)?

## 7. Round 2 candidates, in order

1. Instant replay of the deciding moment. Built on WP5's command log; a second low-quality `GameView` behind the results card, with no export.
2. Results photo save (needs 1).
3. Daily seeded heist with cumulative stamps and no streaks.
4. 도장판 medal grid (after per-cell odds are measured).
5. Fur palettes, after the §13 readability check.
6. Fence flourish on plaza and counter, if fence busts are still 0.
7. 기록부 growth screen, from the `recent[20]` ring buffer.
8. World reactions and news ticker.
9. Best-of-3 option in quick match.

## 8. Non-negotiables checked for every package

- Two buttons only (grab, dash).
- Values 100 / 300 / 500 and a 3200 total.
- No score multipliers and no catch-up bonuses (§19).
- No combat abilities and no new core action buttons.
- Cosmetics never change stats.
- No basic choice hidden behind an unlock: all cups, layouts, rivals and difficulties are open from the start.
- Rematch is always one press with no popup chain.
- Ties are draws.
- No loot boxes, gacha, currency, energy, FOMO, streak penalties, expiring rewards or network telemetry.
- Single-player only; deterministic sim (replay test in CI).
- Procedural art and audio only.
