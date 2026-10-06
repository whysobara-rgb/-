# steam/

Steamworks / SteamPipe source files. Full procedure: [`docs/STEAM_RELEASE.md`](../docs/STEAM_RELEASE.md).

| File | What it is | Before release |
|---|---|---|
| `steam_appid.txt` | The App ID, digits only (no comments: Steam reads the whole first line). `480` = Valve's public test app "Spacewar", used for development. | Replace with the real App ID (or pass `--appid` / `STEAM_APPID` to the packager). |
| `app_build.vdf` | SteamPipe app build script. Paths are relative to this folder. | Put the real depot IDs in `"Depots"` (examples: 481 = Windows, 482 = Linux). |
| `depot_build_windows.vdf` / `depot_build_linux.vdf` | Depot scripts: whole `release/steam/content/<os>/` folder. | Nothing — the packager fills the depot ID and absolute paths. |
| `achievements.json` | Achievement API names, ko/en names and descriptions, hidden flags, icon file names, unlock rules. Checked against the game by `test/unit/platform-steam.test.ts` (Korean descriptions are instructions, "…하세요", because Steam also shows locked achievements). | Enter on the partner site; make the 64×64 icons. |

`tools/package-steam.mjs` (`npm run dist:steam`) builds the game, packages it with electron-builder,
stages `release/steam/content/{windows,linux}/` and writes ready-to-run copies of these scripts
(absolute paths, real IDs) to `release/steam/scripts/`. Upload with:

```bash
steamcmd +login <build_account> +run_app_build "<abs>/release/steam/scripts/app_build_<AppID>.vdf" +quit
```

Development runs (`npm run electron:start`) read `steam/steam_appid.txt` and use 480 when nothing
else is set. Packaged builds use the id the Steam client passes (`SteamAppId`) or a
`steam_appid.txt` beside the executable, and never fall back to 480.
