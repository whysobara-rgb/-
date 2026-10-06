# Steam store assets (tools/steam-assets)

Reproducible pipeline for the store art, screenshots, app icons and third-party notices.
Everything visual comes from the real game: in-engine frames of staged moments, the title
wordmark rendered by the real title screen, and the real 3D models.

```bash
node tools/steam-assets/capture.mjs     # npm run build + vite preview :4500, ~30-60 min on software GL
python3 tools/steam-assets/compose.py   # plates, screenshots, logos, capsules, icons -> steam/store, build/
node tools/steam-assets/notices.mjs     # LICENSES/THIRD_PARTY_NOTICES.txt from node_modules (--check in CI)
```

Useful flags: `capture.mjs --only=uproot,steal --frames=shot_ --langs=ko --dpr=1 --no-build
--base=http://127.0.0.1:5173 --raw=/tmp/raw`; `compose.py capsules` runs one step
(`plates | screens | logos | capsules | icons`).

| File | Role |
|---|---|
| `capture.mjs` | Job list (one fresh game page per moment and language), servers, raw output + manifest |
| `lib/clock.js` | Virtual clock injected before the game loads: rAF, timers, `performance.now`, CSS animations; draws switched off between captured frames |
| `lib/director.js` | Stages moments inside a running match: `sim.debug` teleports + real Commands per character (human slot via the MatchScript autopilot hook, bots via `update()`) |
| `lib/session.mjs` | Playwright helpers (open, pump, draw one frame, hide UI, screenshot) |
| `pages/models.*` | Transparent renders of the real raccoon / bank models for the app icon (dev server) |
| `compose.py` | Crops, scales and lays the wordmark over the plates; icon badge + toy outline; `.ico` |
| `notices.mjs` | Third-party notices (shown in-game under Settings → Credits → Licenses, shipped as `resources/THIRD_PARTY_NOTICES.txt`) |
| `vite.capture.config.mjs` | Dev server with HMR and file watching off (restart it after editing files it serves) |

Raw 2x frames land in `tools/out/steam-assets/raw/` (git-ignored). Outputs are listed in
`steam/store/README.md`.
