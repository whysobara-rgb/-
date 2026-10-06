#!/usr/bin/env node
/**
 * Steam release packager for 뿌리째 털어라 (Uproot Heist).
 *
 *   node tools/package-steam.mjs [options]        (or: npm run dist:steam -- [options])
 *
 * Steps:
 *   1. build the game (npm run build = typecheck + vite build) unless --skip-build
 *   2. electron-builder "dir" targets for each platform (release/<os>-unpacked)
 *   3. stage SteamPipe depot content in release/steam/content/<windows|linux>/ + steam_appid.txt
 *   4. verify each depot (executable, app.asar, unpacked steamworks natives, app id file)
 *   5. write SteamPipe scripts with absolute paths + real IDs to release/steam/scripts/
 *   6. optionally run the packaged Linux build's --selftest under xvfb (--selftest)
 *
 * Options:
 *   --platforms=linux,windows   depots to build (default: linux,windows)
 *   --appid=N                   Steam App ID       (else env STEAM_APPID, else steam/steam_appid.txt)
 *   --depot-windows=N           Windows depot ID   (else env STEAM_DEPOT_WINDOWS, else steam/app_build.vdf)
 *   --depot-linux=N             Linux depot ID     (else env STEAM_DEPOT_LINUX, else steam/app_build.vdf)
 *   --branch=NAME               SetLive branch for the uploaded build (never "default"; set live by hand)
 *   --desc=TEXT                 build description (default: version + git commit)
 *   --preview                   SteamPipe dry run (Preview "1")
 *   --skip-build                reuse the existing dist/
 *   --skip-typecheck            vite build only (emergency builds; CI should typecheck)
 *   --skip-package              reuse existing release/<os>-unpacked folders
 *   --selftest                  run the packaged Linux build's --selftest (needs xvfb-run on Linux)
 *   --help
 *
 * Upload afterwards (steamcmd, Steamworks account with build rights):
 *   steamcmd +login <account> +run_app_build <abs path printed below> +quit
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEAM_DIR = path.join(ROOT, 'steam');
const RELEASE = path.join(ROOT, 'release');
const STAGE = path.join(RELEASE, 'steam');
const require = createRequire(import.meta.url);

const PLATFORMS = {
  windows: {
    builderFlag: '--win',
    unpacked: 'win-unpacked',
    exe: 'UprootHeist.exe',
    natives: ['steamworksjs.win32-x64-msvc.node', 'steam_api64.dll'],
    nativeDir: 'win64',
    depotTemplate: 'depot_build_windows.vdf',
  },
  linux: {
    builderFlag: '--linux',
    unpacked: 'linux-unpacked',
    exe: 'UprootHeist',
    natives: ['steamworksjs.linux-x64-gnu.node', 'libsteam_api.so'],
    nativeDir: 'linux64',
    depotTemplate: 'depot_build_linux.vdf',
  },
};

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) fail(`unknown argument: ${a}`);
    opts[m[1]] = m[2] === undefined ? true : m[2];
  }
  return opts;
}

function fail(msg) {
  console.error(`\n[package-steam] ERROR: ${msg}`);
  process.exit(1);
}

function step(msg) {
  console.log(`\n[package-steam] ${msg}`);
}

function run(cmd, args, options = {}) {
  console.log(`  $ ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm', ...options });
  if (r.error) fail(`${cmd} failed to start: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} exited with ${r.status}`);
}

function positiveInt(v, what) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).trim());
  if (!Number.isInteger(n) || n <= 0) fail(`${what} must be a positive integer (got "${v}")`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Minimal Valve KeyValues (VDF) reader/writer: quoted/unquoted tokens, nested blocks,
// // comments and duplicate keys (SteamPipe allows several FileExclusion entries).
// ---------------------------------------------------------------------------------------------

function parseVdf(text, file) {
  let i = 0;
  const tokens = [];
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '{' || c === '}') {
      tokens.push(c);
      i++;
    } else if (c === '"') {
      let s = '';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          const n = text[i + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          i += 2;
        } else s += text[i++];
      }
      if (text[i] !== '"') fail(`${file}: unterminated string`);
      i++;
      tokens.push({ s });
    } else {
      let s = '';
      while (i < text.length && !/[\s{}"]/.test(text[i])) s += text[i++];
      tokens.push({ s });
    }
  }
  let p = 0;
  const block = (top) => {
    const out = [];
    while (p < tokens.length) {
      const t = tokens[p++];
      if (t === '}') {
        if (top) fail(`${file}: unexpected }`);
        return out;
      }
      if (t === '{') fail(`${file}: unexpected {`);
      const next = tokens[p++];
      if (next === undefined) fail(`${file}: missing value for "${t.s}"`);
      if (next === '{') out.push({ key: t.s, value: block(false) });
      else if (next === '}') fail(`${file}: missing value for "${t.s}"`);
      else out.push({ key: t.s, value: next.s });
    }
    if (!top) fail(`${file}: missing }`);
    return out;
  };
  return block(true);
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function writeVdf(entries, depth = 0) {
  const pad = '\t'.repeat(depth);
  return entries
    .map(({ key, value }) =>
      Array.isArray(value) ? `${pad}"${esc(key)}"\n${pad}{\n${writeVdf(value, depth + 1)}${pad}}\n` : `${pad}"${esc(key)}" "${esc(value)}"\n`,
    )
    .join('');
}

const getEntry = (entries, key) => entries.find((e) => e.key.toLowerCase() === key.toLowerCase());

function setEntry(entries, key, value) {
  const e = getEntry(entries, key);
  if (e) e.value = value;
  else entries.push({ key, value });
}

function readTemplate(name) {
  const file = path.join(STEAM_DIR, name);
  if (!fs.existsSync(file)) fail(`missing ${path.relative(ROOT, file)}`);
  return parseVdf(fs.readFileSync(file, 'utf8'), name);
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const platforms = String(opts.platforms ?? 'linux,windows')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .map((s) => (s === 'win' ? 'windows' : s))
  .filter(Boolean);
for (const p of platforms) if (!PLATFORMS[p]) fail(`unknown platform "${p}" (use linux, windows)`);
if (!platforms.length) fail('no platforms selected');

// IDs: CLI > env > templates.
const appTemplate = readTemplate('app_build.vdf');
const appBuild = getEntry(appTemplate, 'AppBuild');
if (!appBuild || !Array.isArray(appBuild.value)) fail('steam/app_build.vdf: missing "AppBuild" block');
const templateDepots = getEntry(appBuild.value, 'Depots');
const depotIdFromTemplate = (file) => {
  const e = Array.isArray(templateDepots?.value) ? templateDepots.value.find((d) => d.value === file) : null;
  return e ? positiveInt(e.key, `depot id for ${file}`) : null;
};
const appIdFile = path.join(STEAM_DIR, 'steam_appid.txt');
const appId =
  positiveInt(opts.appid, '--appid') ??
  positiveInt(process.env.STEAM_APPID, 'STEAM_APPID') ??
  positiveInt(fs.existsSync(appIdFile) ? fs.readFileSync(appIdFile, 'utf8').trim() : null, 'steam/steam_appid.txt') ??
  fail('no App ID (use --appid, STEAM_APPID or steam/steam_appid.txt)');
const depotIds = {
  windows:
    positiveInt(opts['depot-windows'], '--depot-windows') ??
    positiveInt(process.env.STEAM_DEPOT_WINDOWS, 'STEAM_DEPOT_WINDOWS') ??
    depotIdFromTemplate(PLATFORMS.windows.depotTemplate),
  linux:
    positiveInt(opts['depot-linux'], '--depot-linux') ??
    positiveInt(process.env.STEAM_DEPOT_LINUX, 'STEAM_DEPOT_LINUX') ??
    depotIdFromTemplate(PLATFORMS.linux.depotTemplate),
};
for (const p of platforms) if (!depotIds[p]) fail(`no depot ID for ${p}`);
if (opts.branch !== undefined && (opts.branch === true || !/^[a-z0-9_-]{1,64}$/i.test(opts.branch) || opts.branch.toLowerCase() === 'default')) {
  fail('--branch must be a beta branch name (letters, digits, - _), never "default"');
}

let commit = '';
try {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) commit = r.stdout.trim();
} catch {
  // not a git checkout
}
const desc = typeof opts.desc === 'string' ? opts.desc : `Uproot Heist v${pkg.version}${commit ? ` (${commit})` : ''} ${new Date().toISOString().slice(0, 10)}`;
if (appId === 480) console.warn('[package-steam] WARNING: App ID 480 is the Spacewar test app — set the real App ID before uploading.');

// 1. Build the game.
if (!opts['skip-build']) {
  step('building the game (dist/)');
  if (opts['skip-typecheck']) run(process.execPath, [require.resolve('vite/bin/vite.js'), 'build']);
  else run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
}
const indexHtml = path.join(ROOT, 'dist', 'index.html');
if (!fs.existsSync(indexHtml)) fail('dist/index.html is missing — run without --skip-build');
if (fs.existsSync(path.join(ROOT, 'dist', '.placeholder-by-platform'))) {
  console.warn('[package-steam] WARNING: dist/ is the packaging PLACEHOLDER, not the game. Do not upload this build.');
}

// 2. Package.
const builderCli = require.resolve('electron-builder/cli.js');
for (const p of platforms) {
  const spec = PLATFORMS[p];
  if (opts['skip-package'] && fs.existsSync(path.join(RELEASE, spec.unpacked))) {
    step(`reusing release/${spec.unpacked}`);
    continue;
  }
  step(`electron-builder ${p} (dir)`);
  run(process.execPath, [builderCli, spec.builderFlag, 'dir', '--x64', '--publish', 'never']);
}

// 3 + 4. Stage and verify depots.
const contentRoot = path.join(STAGE, 'content');
for (const p of platforms) {
  const spec = PLATFORMS[p];
  const src = path.join(RELEASE, spec.unpacked);
  const dst = path.join(contentRoot, p);
  step(`staging ${p} depot -> ${path.relative(ROOT, dst)}`);
  if (!fs.existsSync(src)) fail(`missing ${path.relative(ROOT, src)}`);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  // Lets the Steam API initialise when the exe is started outside the Steam client (Steam must run).
  fs.writeFileSync(path.join(dst, 'steam_appid.txt'), `${appId}\n`);

  const problems = [];
  const must = (rel) => {
    if (!fs.existsSync(path.join(dst, rel))) problems.push(`missing ${rel}`);
  };
  must(spec.exe);
  must('resources/app.asar');
  must('steam_appid.txt');
  for (const n of spec.natives) must(`resources/app.asar.unpacked/node_modules/steamworks.js/dist/${spec.nativeDir}/${n}`);
  for (const other of Object.values(PLATFORMS)) {
    if (other.nativeDir === spec.nativeDir) continue;
    if (fs.existsSync(path.join(dst, `resources/app.asar.unpacked/node_modules/steamworks.js/dist/${other.nativeDir}`))) {
      problems.push(`foreign natives shipped: ${other.nativeDir}`);
    }
  }
  if (p === 'linux') {
    try {
      const mode = fs.statSync(path.join(dst, spec.exe)).mode;
      if (!(mode & 0o111)) problems.push(`${spec.exe} is not executable`);
    } catch {
      // reported above
    }
  }
  if (problems.length) fail(`${p} depot is incomplete:\n  - ${problems.join('\n  - ')}`);
  console.log(`  ok: ${spec.exe}, app.asar, steamworks natives (${spec.nativeDir}), steam_appid.txt=${appId}`);
}

// 5. SteamPipe scripts with absolute paths.
step('writing SteamPipe scripts');
const scriptsDir = path.join(STAGE, 'scripts');
const outputDir = path.join(STAGE, 'output');
fs.mkdirSync(scriptsDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
const depotEntries = [];
for (const p of platforms) {
  const tpl = readTemplate(PLATFORMS[p].depotTemplate);
  const cfg = getEntry(tpl, 'DepotBuildConfig');
  if (!cfg || !Array.isArray(cfg.value)) fail(`steam/${PLATFORMS[p].depotTemplate}: missing "DepotBuildConfig" block`);
  setEntry(cfg.value, 'DepotID', String(depotIds[p]));
  setEntry(cfg.value, 'ContentRoot', path.join(contentRoot, p) + path.sep);
  const name = `depot_build_${depotIds[p]}.vdf`;
  fs.writeFileSync(path.join(scriptsDir, name), `// generated by tools/package-steam.mjs from steam/${PLATFORMS[p].depotTemplate}\n${writeVdf(tpl)}`);
  depotEntries.push({ key: String(depotIds[p]), value: name });
}
setEntry(appBuild.value, 'AppID', String(appId));
setEntry(appBuild.value, 'Desc', desc);
setEntry(appBuild.value, 'Preview', opts.preview ? '1' : '0');
setEntry(appBuild.value, 'SetLive', typeof opts.branch === 'string' ? opts.branch : '');
setEntry(appBuild.value, 'ContentRoot', contentRoot + path.sep);
setEntry(appBuild.value, 'BuildOutput', outputDir + path.sep);
setEntry(appBuild.value, 'Depots', depotEntries);
const appScript = path.join(scriptsDir, `app_build_${appId}.vdf`);
fs.writeFileSync(appScript, `// generated by tools/package-steam.mjs from steam/app_build.vdf\n${writeVdf(appTemplate)}`);
console.log(`  ${path.relative(ROOT, appScript)}`);
for (const d of depotEntries) console.log(`  ${path.relative(ROOT, path.join(scriptsDir, d.value))}`);

// 6. Optional packaged self-test.
if (opts.selftest) {
  if (!platforms.includes('linux') || process.platform !== 'linux') {
    console.warn('[package-steam] --selftest runs the Linux depot on a Linux host only; skipped');
  } else {
    step('packaged self-test (linux depot)');
    const exe = path.join(contentRoot, 'linux', PLATFORMS.linux.exe);
    const hasDisplay = !!process.env.DISPLAY;
    const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).stdout.trim();
    if (hasDisplay) run(exe, ['--selftest', '--no-sandbox']);
    else if (xvfb) run(xvfb, ['-a', exe, '--selftest', '--no-sandbox']);
    else fail('no DISPLAY and no xvfb-run: cannot run the self-test');
  }
}

step('done');
console.log(`  App ${appId}  depots: ${platforms.map((p) => `${p}=${depotIds[p]}`).join(', ')}`);
console.log(`  Description: ${desc}`);
console.log(`  Upload:  steamcmd +login <account> +run_app_build "${appScript}" +quit`);
if (!opts.branch) console.log('  The build will appear on the Builds page; set it live on a beta branch first (docs/STEAM_RELEASE.md).');
