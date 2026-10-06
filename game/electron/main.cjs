'use strict';
/**
 * 뿌리째 털어라 (Uproot Heist) — Electron main process.
 *
 *  - Loads the Vite build (dist/index.html) from file:// in a locked-down renderer:
 *    contextIsolation, no Node, sandbox, no navigation / new windows / webviews, permissions
 *    denied except fullscreen + pointer lock.
 *  - Exposes a tiny synchronous IPC API to electron/preload.cjs (save IO, fullscreen, quit,
 *    Steam achievements, logging). Every handler validates its sender and arguments.
 *  - Steam via steamworks.js (optional; see steam.cjs) + Steam overlay.
 *  - Logs to userData/logs/main.log.
 *
 * Command-line flags:
 *   --selftest   load electron/selftest.html (isolated temp userData), verify the preload save
 *                round-trip and security settings, print PASS/FAIL, exit 0/1
 *   --safe-mode  software WebGL (SwiftShader) for broken GPU drivers (Steam launch option)
 *   --windowed   ignore the saved fullscreen preference for this launch
 *   --no-steam   skip Steamworks (also env UPROOT_NO_STEAM=1)
 * Dev only (unpackaged): env UPROOT_DEV_URL=http://127.0.0.1:5173 loads the Vite dev server.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session } = require('electron');
const { createLogger } = require('./logger.cjs');
const { SaveStore } = require('./save-store.cjs');
const { createSteam } = require('./steam.cjs');
const { fitToWorkArea, loadWindowState, trackWindowState } = require('./window-state.cjs');

const PRODUCT_NAME = '뿌리째 털어라';
/** ASCII folder name for userData (%APPDATA%/UprootHeist, ~/.config/UprootHeist, ...). */
const DATA_DIR_NAME = 'UprootHeist';
/** --uh-night-950, the game's backdrop: no white flash while loading. */
const BACKGROUND = '#150F2B';
const DEFAULT_SIZE = { width: 1600, height: 900, minWidth: 1024, minHeight: 576 };
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'pointerLock']);
const ACH_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const BRIDGE_VERSION = 1;

const args = new Set(process.argv.slice(1));
const SELFTEST = args.has('--selftest');
const SAFE_MODE = args.has('--safe-mode');
const FORCE_WINDOWED = args.has('--windowed');
const NO_STEAM = args.has('--no-steam') || process.env.UPROOT_NO_STEAM === '1';
const APP_ROOT = path.join(__dirname, '..');
const DEV_URL = !app.isPackaged && process.env.UPROOT_DEV_URL ? process.env.UPROOT_DEV_URL : null;
const INDEX_HTML = path.join(APP_ROOT, 'dist', 'index.html');
const SELFTEST_HTML = path.join(__dirname, 'selftest.html');

// ---------------------------------------------------------------------------------------------
// Paths, logging, single instance (all before 'ready')
// ---------------------------------------------------------------------------------------------

app.setName(PRODUCT_NAME);
if (SELFTEST) {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'uproot-selftest-')));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), DATA_DIR_NAME));
}
const USER_DATA = app.getPath('userData');
const log = createLogger(path.join(USER_DATA, 'logs'), { echo: SELFTEST || !app.isPackaged });
log.info(`[app] start v${app.getVersion()} electron ${process.versions.electron} ${process.platform}-${process.arch} packaged=${app.isPackaged} selftest=${SELFTEST} safe=${SAFE_MODE}`);

process.on('uncaughtException', (err) => {
  log.error('[app] uncaught exception', err);
  if (SELFTEST) finishSelftest(false, [`uncaught exception: ${err && err.message}`]);
});
process.on('unhandledRejection', (err) => log.error('[app] unhandled rejection', err));

if (!SELFTEST && !app.requestSingleInstanceLock()) {
  log.info('[app] another instance is running; focusing it and quitting');
  app.quit();
  process.exit(0);
}

const saves = new SaveStore(USER_DATA, log);

// ---------------------------------------------------------------------------------------------
// Steam + Chromium switches (must happen before 'ready')
// ---------------------------------------------------------------------------------------------

const steam = createSteam(log);
steam.init({ appRoot: APP_ROOT, isPackaged: app.isPackaged, disabled: NO_STEAM });
if (steam.state.available && !SELFTEST) steam.enableOverlay();

// Media keys belong to the player's music app, not to the game.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
if (SAFE_MODE) {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
} else {
  // WebGL2 is required; Chromium's blocklist disables it on many older but working drivers.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

// ---------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------

/** @type {BrowserWindow | null} */
let mainWindow = null;
let rendererCrashes = 0;
const allowedEntryUrls = new Set();

function fileUrl(p) {
  return pathToFileURL(p).href;
}

function stripHash(url) {
  const i = url.search(/[?#]/);
  return i >= 0 ? url.slice(0, i) : url;
}

function isAllowedUrl(url) {
  if (typeof url !== 'string') return false;
  if (allowedEntryUrls.has(stripHash(url))) return true;
  if (DEV_URL) {
    try {
      return new URL(url).origin === new URL(DEV_URL).origin;
    } catch {
      return false;
    }
  }
  return false;
}

/** IPC calls are honored only from our own top-level page. */
function trusted(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame.parent) return false;
  return isAllowedUrl(frame.url);
}

function missingBuildPage() {
  const html = `<!doctype html><meta charset="utf-8"><title>${PRODUCT_NAME}</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:${BACKGROUND};color:#FFF6E6;font:16px sans-serif;text-align:center">
<div><h1>게임 파일을 찾을 수 없어요</h1><p>Game files are missing: <code>dist/index.html</code></p>
<p>Run <code>npm run build</code>, then <code>npm run electron:start</code>.</p></div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function sendFullscreen() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('uproot:fullscreen-changed', mainWindow.isFullScreen());
}

function setFullscreen(on) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFullScreen() !== on) mainWindow.setFullScreen(on);
}

function createWindow() {
  const ws = loadWindowState(USER_DATA, screen, DEFAULT_SIZE);
  const startFullscreen = !SELFTEST && !FORCE_WINDOWED && saves.readFullscreenPreference(true);
  // Taskbar / window icon (Windows, Linux). The Steam client shows its own uploaded icons.
  const iconFile = path.join(__dirname, 'icon.png');
  const icon = fs.existsSync(iconFile) ? iconFile : undefined;

  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    x: ws.x,
    y: ws.y,
    minWidth: DEFAULT_SIZE.minWidth,
    minHeight: DEFAULT_SIZE.minHeight,
    useContentSize: true,
    show: false,
    backgroundColor: BACKGROUND,
    title: PRODUCT_NAME,
    autoHideMenuBar: true,
    fullscreen: startFullscreen,
    fullscreenable: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
      autoplayPolicy: 'no-user-gesture-required',
      devTools: !app.isPackaged || process.env.UPROOT_DEVTOOLS === '1',
    },
  });
  const win = mainWindow;
  win.removeMenu();
  if (ws.maximized && !startFullscreen) win.maximize();
  else if (!startFullscreen) fitToWorkArea(win, screen);
  // ws.width/height are content sizes (useContentSize): the restore size if it starts maximized.
  trackWindowState(win, USER_DATA, { width: ws.width, height: ws.height });

  win.once('ready-to-show', () => {
    if (SELFTEST) return;
    win.show();
    win.focus();
  });
  win.on('enter-full-screen', sendFullscreen);
  win.on('leave-full-screen', () => {
    sendFullscreen();
    // The windowed size may have been chosen on another monitor: keep the frame on screen.
    setTimeout(() => fitToWorkArea(win, screen), 100);
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  win.on('unresponsive', () => log.warn('[window] renderer unresponsive'));
  win.on('responsive', () => log.info('[window] renderer responsive again'));

  const wc = win.webContents;
  // F11 / Alt+Enter fullscreen; F12 devtools in dev builds. Zoom stays at 100% (UI scale is a setting).
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const key = input.key;
    if (key === 'F11' || (input.alt && !input.control && !input.meta && (key === 'Enter' || input.code === 'Enter'))) {
      event.preventDefault();
      setFullscreen(!win.isFullScreen());
    } else if (key === 'F12' && !app.isPackaged) {
      event.preventDefault();
      wc.toggleDevTools();
    } else if ((input.control || input.meta) && ['+', '-', '=', '0'].includes(key)) {
      event.preventDefault();
    }
  });
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  wc.on('zoom-changed', () => wc.setZoomFactor(1));

  wc.on('console-message', (...a) => {
    // Electron >= 35 passes one event object; older versions positional arguments.
    const e = a[0];
    const level = typeof e === 'object' && e && 'level' in e ? e.level : a[1];
    const message = typeof e === 'object' && e && 'message' in e ? e.message : a[2];
    const source = typeof e === 'object' && e && 'sourceId' in e ? `${e.sourceId}:${e.lineNumber}` : `${a[4]}:${a[3]}`;
    if (level === 'warning' || level === 'error' || level === 2 || level === 3) {
      (level === 'error' || level === 3 ? log.error : log.warn)(`[renderer] ${message} (${source})`);
    }
  });
  wc.on('render-process-gone', (_e, details) => {
    log.error('[window] renderer gone', details);
    if (SELFTEST) {
      finishSelftest(false, [`renderer gone: ${details.reason}`]);
      return;
    }
    if (details.reason === 'clean-exit') return;
    rendererCrashes++;
    if (rendererCrashes <= 2 && !win.isDestroyed()) {
      log.warn('[window] reloading after renderer crash');
      wc.reload();
    } else {
      dialog.showErrorBox(PRODUCT_NAME, `게임이 예기치 않게 종료되었어요.\nThe game stopped unexpectedly.\n\nLog: ${log.file}`);
      app.quit();
    }
  });
  wc.on('did-fail-load', (_e, code, desc, url) => log.error('[window] load failed', code, desc, url));

  if (SELFTEST) {
    allowedEntryUrls.add(fileUrl(SELFTEST_HTML));
    win.loadFile(SELFTEST_HTML).catch((err) => finishSelftest(false, [`load selftest page: ${err.message}`]));
  } else if (DEV_URL) {
    log.info('[window] dev server', DEV_URL);
    win.loadURL(DEV_URL).catch((err) => log.error('[window] dev server load failed', err));
  } else if (fs.existsSync(INDEX_HTML)) {
    allowedEntryUrls.add(fileUrl(INDEX_HTML));
    win.loadFile(INDEX_HTML).catch((err) => log.error('[window] load failed', err));
  } else {
    log.error('[window] missing build', INDEX_HTML);
    if (app.isPackaged) {
      dialog.showErrorBox(PRODUCT_NAME, `게임 파일이 손상되었어요. Steam에서 "게임 파일 무결성 확인"을 실행해 주세요.\nGame files are missing. Please verify the game files in Steam.\n\n${INDEX_HTML}`);
      app.quit();
      return;
    }
    win.loadURL(missingBuildPage());
  }
}

// ---------------------------------------------------------------------------------------------
// Hardening for every web contents (also covers anything created later)
// ---------------------------------------------------------------------------------------------

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      log.warn('[security] blocked navigation to', url);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      log.warn('[security] blocked redirect to', url);
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    log.warn('[security] blocked webview');
  });
  contents.setWindowOpenHandler(({ url }) => {
    log.warn('[security] blocked new window', url);
    return { action: 'deny' };
  });
});

function hardenSession(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const ok = ALLOWED_PERMISSIONS.has(permission);
    if (!ok) log.info('[security] denied permission', permission);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event) => {
    event.preventDefault();
    log.warn('[security] blocked download');
  });
  try {
    ses.setSpellCheckerEnabled(false);
  } catch {
    // not available on every platform
  }
}

// ---------------------------------------------------------------------------------------------
// IPC (preload bridge). Sync handlers ALWAYS set returnValue, or the renderer would hang.
// ---------------------------------------------------------------------------------------------

function handleSync(channel, fallback, fn) {
  ipcMain.on(channel, (event, ...a) => {
    if (!trusted(event)) {
      log.warn('[security] rejected IPC', channel, event.senderFrame ? event.senderFrame.url : '(no frame)');
      event.returnValue = fallback;
      return;
    }
    try {
      event.returnValue = fn(...a);
    } catch (err) {
      log.error(`[ipc] ${channel} failed`, err);
      event.returnValue = fallback;
    }
  });
}

function handleAsync(channel, fn) {
  ipcMain.on(channel, (event, ...a) => {
    if (!trusted(event)) {
      log.warn('[security] rejected IPC', channel);
      return;
    }
    try {
      fn(...a);
    } catch (err) {
      log.error(`[ipc] ${channel} failed`, err);
    }
  });
}

handleSync('uproot:info', null, () => ({
  bridgeVersion: BRIDGE_VERSION,
  appVersion: app.getVersion(),
  platform: process.platform,
  isPackaged: app.isPackaged,
  selftest: SELFTEST,
  steam: steam.status(),
}));
handleSync('uproot:save-read', null, (slot) => saves.read(slot === 'backup' ? 'backup' : 'main'));
handleSync('uproot:save-write', false, (text) => saves.write(text));
handleSync('uproot:save-quarantine', false, (text, reason) => saves.quarantine(text, reason));
handleSync('uproot:is-fullscreen', false, () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen());
handleSync('uproot:steam-unlock', false, (id) => typeof id === 'string' && ACH_RE.test(id) && steam.unlock(id));
handleSync('uproot:steam-is-unlocked', null, (id) => (typeof id === 'string' && ACH_RE.test(id) ? steam.isUnlocked(id) : null));
handleAsync('uproot:set-fullscreen', (on) => setFullscreen(on === true));
handleAsync('uproot:quit', () => {
  log.info('[app] quit requested by the game');
  app.quit();
});
// Rate-limited so a renderer error loop cannot fill the disk.
let logBudget = { start: Date.now(), count: 0 };
handleAsync('uproot:log', (level, message) => {
  const now = Date.now();
  if (now - logBudget.start > 60000) logBudget = { start: now, count: 0 };
  if (++logBudget.count > 200) return;
  const text = `[game] ${String(message).slice(0, 4000)}`;
  if (level === 'error') log.error(text);
  else if (level === 'warn') log.warn(text);
  else log.info(text);
});

// ---------------------------------------------------------------------------------------------
// Self-test (--selftest)
// ---------------------------------------------------------------------------------------------

let selftestDone = false;

function finishSelftest(ok, lines) {
  if (selftestDone) return;
  selftestDone = true;
  const out = [`[selftest] ${ok ? 'PASS' : 'FAIL'}`, ...lines.map((l) => `  ${l}`)].join('\n');
  // The logger echoes to stdout in self-test mode.
  log.info(out);
  try {
    if (USER_DATA.includes('uproot-selftest-')) fs.rmSync(USER_DATA, { recursive: true, force: true });
  } catch {
    // temp dir cleanup is best effort
  }
  app.exit(ok ? 0 : 1);
}

function runMainSideChecks(report) {
  const lines = [];
  let ok = true;
  const check = (name, pass, detail) => {
    lines.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!pass) ok = false;
  };
  const results = Array.isArray(report && report.results) ? report.results : [];
  check('renderer reported checks', results.length > 0, `${results.length} checks`);
  for (const r of results) check(`renderer: ${String(r.name)}`, r.ok === true, r.detail ? String(r.detail) : '');
  const read = (f) => {
    try {
      return fs.readFileSync(f, 'utf8');
    } catch {
      return null;
    }
  };
  check('save.json on disk matches', read(saves.mainFile) === report.expectMain);
  check('save.bak on disk matches', read(saves.backupFile) === report.expectBackup);
  check('no leftover tmp files', !fs.existsSync(saves.tmpFile) && !fs.existsSync(saves.backupTmpFile));
  let quarantined = 0;
  try {
    quarantined = fs.readdirSync(saves.quarantineDir).length;
  } catch {
    quarantined = 0;
  }
  check('quarantine file written', quarantined >= 1, `${quarantined} file(s)`);
  check('log file written', fs.existsSync(log.file), log.file);
  const hasGame = fs.existsSync(INDEX_HTML);
  if (app.isPackaged) check('game build packaged (dist/index.html)', hasGame, INDEX_HTML);
  else lines.push(`${hasGame ? 'ok  ' : 'warn'} game build present (dist/index.html)${hasGame ? '' : ' — run npm run build'}`);
  const nativeSupported = ['win32', 'linux', 'darwin'].includes(process.platform) && ['x64', 'arm64'].includes(process.arch);
  if (nativeSupported && !NO_STEAM) {
    check('steamworks.js native module loads', steam.state.moduleLoaded, steam.state.moduleLoaded ? '' : steam.state.error || '');
  }
  lines.push(`info steam available=${steam.state.available} appIdSource=${steam.state.appIdSource} (${steam.state.error || 'ok'})`);
  return { ok, lines };
}

if (SELFTEST) {
  ipcMain.on('uproot:selftest-report', (event, report) => {
    if (!trusted(event)) return;
    const { ok, lines } = runMainSideChecks(report || {});
    finishSelftest(ok, lines);
  });
  setTimeout(() => finishSelftest(false, ['timeout: no report from the self-test page within 30 s']), 30000).unref();
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  // A game quits when its window closes, on every platform.
  app.quit();
});

app.on('child-process-gone', (_e, details) => {
  if (details.type === 'GPU') log.error('[gpu] process gone', details);
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    // Keep Cmd+Q / Cmd+H working on macOS without showing a browser-like menu.
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  hardenSession(session.defaultSession);
  createWindow();
});
