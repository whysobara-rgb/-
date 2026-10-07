# Integration TODO (collected from workflow known issues)
## From fun wave 1 (F9/F5/F4/F3/F8) — 2026-10-07
- match.ts funObserve: call this.director.onBark(s.charId, bark.key, sim) next to view.showBark (F8) — bark blips silent.
- match.ts:~816 setDecisiveLoad: pass [...mp.lootIds, ...(mp.bagCharIds ?? [])]; then delete bag-only fallback in render/beats updateBeats (F3).
- app.ts toResults: view.setResultsPoses({ rival: rivalWon ? 'taunt' : 'slump', player: save.victoryPose ?? 'wiggle' }) (F3/F6).
- app.ts onMatchFinished/toResults: call recordMatchOutcome / bumpFunnel (F9 helpers not wired yet; WP6).
- OffscreenArrows: keep top-edge arrows clear of scoreboard (F5 kickoff arrow hidden).
- View: breakable-highlight hook so crates pulse as kickoff target (F5/C7) — v2.
- v2 stamps per match median 6 (target 2–5): merge quick back-and-forth lead changes into one stamp (F4) — director call.
- ARCHITECTURE.md: document add-only contract changes (Moment.cause/by/bagCharIds, MatchPointOptions.uprooting, bagCharIds, hud.queueBanner, kickoffCueInfo, momentSnapshot/commandLog/replayCheck, RECORD_MIN_*, SaveManagerOptions.countSession, MAX_ACHIEVEMENTS, MAX_ADAPT_*, director.onBark, view fun methods getaway/results poses).
- Heartbeat exposure high (53–80% matches have match point; 3 dB duck whole MP) — owner by-ear check; consider shorter duck.
- test/ai/police.test.ts 'never freezes in fear' 5 vs 6 on seed 9 after control-bug physics fix — AI owner.
- police body-block test timeout / police-fuzz perf bench under load — re-run when idle.
- i18n.test: front.goal.series '{rival}와' particle issue (C10/front-calm).
- Label '나' tag: hide or pin while carrying (label-jitter known issue) — design call: pin to held tag group.
- Browser build: Ctrl+1..4 taken by Chrome tab switching → plain 1..4 fallback (done in taunts fix); InputManager drops presses during >500 ms frame gaps (reactivateAfter).
- Re-capture steam store screenshots after upright-text fix.
## From front-calm
- e2e tournament persistence test fails: saved series now has cup:'normal' (F9) → update test expectation.
- e2e tutorial/match/kickoff screenshot timeouts under load → re-run when idle.
- Hideout scene props removed globally (settings/credits slightly plainer) — acceptable.
- Quick setup lower-left empty deck under shade — minor.
## From C6/C11 (bots use Content 2.0 + balance scorecard) — 2026-10-07
- v2 vs classic (C11 scorecard, n≈1,560): drama/min 9.3 vs 3.3, draws 1% vs 13%, variety 1.63×, lead changes 2.61 vs 2.11, full countdown played 47% vs 34%, proxy wins 47%. → Recommend flipping CONTENT_V2_BY_DEFAULT = true (director call; update default-dependent tests/fixtures).
- v2 misses: first score worst map 18.1 s (CI spans 18), longest no-score 34 s (≤28), blowouts 10% (≤8%), drops contested 14% (≥25%), rematch-worthy 70% (classic 86%, gate ≥78%), dead-time definition open.
- Piggy jackpot almost never happens (1.9%): bots skip kick/smash while holding a hammer; intact haul pays same 300 → make smash pay more or bots go for opponent-carried piggy (C6/C3).
- Race-the-siren tuning set: land police-dispatch half alone, re-measure (it changes classic fixture).
- Human proxy opening noise changed → classic proxy baseline shifted.
## From soft-drag audio (shipped; review #3 'ship')
- Bank rumble still mostly masked under match music on small-speaker models (400–500 Hz HP): consider a soft 400–900 Hz "heave" layer or a music duck while a bank moves.
- Captions updated to the soft sound (done).
- Owner by-ear check of the new drag/bank sound still pending (all judgement from offline renders).
