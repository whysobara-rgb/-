# UI overhaul brief (owner feedback 2026-10-06)

Owner looked at the UI and said: "닌텐도 느낌이 전혀 없고, 밋밋한 AI 게임처럼 보여" — full overhaul.
Specific asks: Nintendo-like feel; buildings in the UI as 3D models instead of a 2D floor plan;
uproot ("뽑는") presentation with emotion; 3D cutaway buildings showing what's inside; enterable bank
with rich content; police chase events; "전면 고도화".

Diagnosis of the current UI (src/ui): clean flat-vector "modern app" look — SVG portraits, flat
cards, purple dusk gradient backdrop, 2D paper-map layout preview. Competent but generic.

Target (general Nintendo-like principles only, never imitating any IP — see docs/ART_DIRECTION.md):
- Live 3D everywhere in menus, built from the real game models (src/render/models):
  - Title: live diorama of the plaza at dusk; the raccoon gang uproots a bank in a loop; logo slams in.
  - Main menu: 3D hideout/rooftop scene; the gang reacts to the highlighted option
    (빠른 대전 → dash pose, 라이벌 대회 → rivals pop up, 옷장 → tries a hat, 연습 → stretches, 설정 → tinkers).
  - Layout preview: a 3D miniature diorama of the actual level on a turntable (banks in cutaway with
    contents visible, floating price tags, team vans with flags, route arrows) — replaces the 2D map.
  - Rival tournament: rivals on stage pedestals under spotlights with idle personality animations,
    "잡았다!" stamp on beaten rivals, locked rival as a silhouette behind a curtain.
  - Wardrobe: raccoon on a turntable, hats pop on with bounce + sparkle.
  - Results: 3D celebration + rolling score counters + stamps + confetti.
  - Portraits: render-to-texture snapshots of the real 3D raccoons (not SVG drawings).
- Typography: chunky Jua headings with thick outline + offset hard shadow, per-word tilt; rolling digits.
- Panels: sticker-like, thick dark outline, hard offset shadow, slight tilt; animated patterned
  backgrounds (stripes, polka dots, paw prints); bright pop palette (sunny yellow, tomato, mint, sky)
  over the dusk scene — no purple gradient look.
- Motion: springy everything (overshoot easings), focus = bouncing paw pointer, iris wipes shaped like
  team emblems / raccoon head, musical UI sounds, button squash on press.
- HUD: bouncier score boxes with rolling digits + coin burst on gain, wobbling timer bubble in the final
  30 s, stamp callouts ("뽑았다!", "가로채기!", "은행째!", "태클 피했다!"), police alert banner with
  red/blue flashing, emote integration.
- Keep: every screen API/callback the integration lead wired, i18n keys, accessibility (reduced motion,
  UI scale, never color-only), performance budgets.

Sequencing:
- Part A (running): police in sim; presentation overhaul in src/render.
- Part B (after integration lead finishes): UI3D agent owns src/ui/** + new src/menu3d/** (own renderer
  using the model factories; GameView paused while menus are up) + menu wiring in src/game/app.ts;
  bot police-awareness agent owns src/ai/**.
- Part C: police integration (match HUD alerts, minimap police icons, audio: whistle/police siren/
  alarm bell/"멈춰!" chirps, quick-match toggle "경찰 출동", settings) → juice pass → final review.
