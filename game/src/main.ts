/**
 * 뿌리째 털어라 — boot.
 *
 * Loading screen -> save + settings (language, UI scale, reduced motion) -> UI + model fonts
 * -> GameView ('title' backdrop) -> input / audio (unlocked on the first gesture) -> App.
 * Global errors are logged once each and shown in a non-fatal "다시 시도 / 메뉴로" overlay.
 */
import { getAudioEngine, unlockOnFirstGesture } from './audio';
import { GameView } from './render';
import { preloadModelFonts } from './render/models';
import { InputManager } from './platform/input';
import type { GlyphAction } from './platform/glyphs';
import { MemorySaveBackend, SaveManager, getSaveManager, setSaveManager } from './platform/save';
import { cloneSettings, type Settings } from './platform/settings';
import { getNative, isFullscreen, nativeLog, onFullscreenChange, setFullscreen } from './platform/native';
import { onAchievementUnlocked, syncAchievementsToSteam } from './platform/steam';
import {
  Hud,
  LoadingScreen,
  Toasts,
  createUiRoot,
  fontsReady,
  setBindingLabelFormatter,
  setLanguage,
  setPromptGlyphProvider,
} from './ui';
import { App } from './game/app';
import { ErrorReporter } from './game/errors';
import { parseLaunchParams } from './game/params';
import { GAME_VERSION } from './game/version';

declare global {
  interface Window {
    __uproot?: Record<string, unknown>;
  }
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

async function boot(): Promise<void> {
  const params = parseLaunchParams(location.search, import.meta.env.DEV);
  const errors = new ErrorReporter();
  let app: App | null = null;
  errors.install({
    onRetry: () => {
      /* the loop resumes on its own once the overlay closes */
    },
    onMenu: () => app?.recoverToMenu(),
  });

  // --- save + settings ------------------------------------------------------------------
  const save = params.fresh ? new SaveManager(new MemorySaveBackend(), { flushOnHide: false }) : getSaveManager();
  if (params.fresh) setSaveManager(save);
  const report = save.load();
  if (report.recoveredFromCorruption) nativeLog('warn', `[boot] save recovered from ${report.source}`);
  if (params.lang && save.data.settings.language !== params.lang) {
    const s = cloneSettings(save.data.settings);
    s.language = params.lang;
    save.setSettings(s);
  }
  const settings0 = save.data.settings;
  setLanguage(settings0.language);

  // --- UI root + loading ------------------------------------------------------------------
  const appEl = document.getElementById('app')!;
  const stage = document.getElementById('stage')!;
  const ui = createUiRoot(appEl);
  ui.setUiScale(settings0.uiScale);
  ui.setReducedMotion(settings0.reducedMotion);
  const loading = new LoadingScreen({ progress: 0.1, tipIntervalMs: 0 });
  loading.show();
  document.getElementById('boot-splash')?.remove();
  await nextFrame();

  // --- fonts (UI + 3D signs) ------------------------------------------------------------------
  await Promise.race([Promise.all([fontsReady(), preloadModelFonts().catch(() => false)]), new Promise((r) => setTimeout(r, 4000))]);
  loading.setProgress(0.45);
  await nextFrame();

  // --- 3D view ----------------------------------------------------------------------------------
  let view: GameView;
  try {
    view = new GameView(stage, {
      quality: params.quality ?? settings0.quality,
      screenShake: settings0.screenShake,
      reducedMotion: settings0.reducedMotion,
      language: settings0.language,
    });
  } catch (err) {
    loading.destroy();
    errors.report(err, 'GameView (WebGL)', { overlay: false });
    errors.showFallback(err instanceof Error ? err.message : String(err));
    return;
  }
  loading.setProgress(0.7);

  // --- input / audio / HUD -------------------------------------------------------------------
  // Autotest: software-GL frames can stall for seconds; never treat that as a context switch.
  const input = new InputManager({ bindings: settings0.bindings, vibration: settings0.vibration, ...(params.autotest ? { reactivateAfterMs: 60000 } : {}) });
  const installGlyphs = (): void => {
    setPromptGlyphProvider((a) => input.promptGlyph(a as GlyphAction));
    setBindingLabelFormatter((d, c) => input.bindingGlyph(d, c));
  };
  installGlyphs();
  input.onDeviceChange(installGlyphs);
  input.onBindingsChange(installGlyphs);

  const audio = getAudioEngine();
  audio.setVolumes(settings0.volumes);
  unlockOnFirstGesture(audio);

  const hud = new Hud(ui);
  hud.setCaptionsEnabled(settings0.subtitles);
  const toasts = new Toasts();
  audio.setCaptionListener((e) => {
    if (save.data.settings.subtitles && app && (app.state === 'match' || app.state === 'paused')) hud.caption(e.key, { side: e.side });
  });
  onAchievementUnlocked((id) => toasts.achievement(id));
  try {
    syncAchievementsToSteam(save);
  } catch (err) {
    nativeLog('warn', `[boot] steam sync failed: ${String(err)}`);
  }

  // --- settings application (live) ------------------------------------------------------------
  const applySettings = (next: Settings, changed: keyof Settings | null): void => {
    save.setSettings(next);
    const s = save.data.settings;
    setLanguage(s.language);
    ui.setUiScale(s.uiScale);
    ui.setReducedMotion(s.reducedMotion);
    view.applySettings({ quality: params.quality ?? s.quality, screenShake: s.screenShake, reducedMotion: s.reducedMotion, language: s.language });
    audio.setVolumes(s.volumes);
    if (changed === 'bindings' || changed === 'vibration' || changed === null) input.applySettings({ bindings: s.bindings, vibration: s.vibration });
    hud.setCaptionsEnabled(s.subtitles);
  };

  // --- desktop integration -----------------------------------------------------------------------
  onFullscreenChange((on) => {
    if (save.data.settings.fullscreen === on) return;
    const s = cloneSettings(save.data.settings);
    s.fullscreen = on;
    save.setSettings(s);
  });
  if (getNative() && isFullscreen() !== settings0.fullscreen) setFullscreen(settings0.fullscreen);
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- app ----------------------------------------------------------------------------------------
  app = new App({
    ui,
    view,
    hud,
    toasts,
    input,
    audio,
    save,
    params,
    version: getNative()?.appVersion || GAME_VERSION,
    applySettings,
    log: (level, msg) => nativeLog(level, msg),
  });
  const theApp = app;
  input.onGamepadConnection((connected) => {
    if (!connected) theApp.requestPause();
  });
  if (!params.autotest) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) theApp.requestPause();
    });
    window.addEventListener('blur', () => theApp.requestPause());
  }

  loading.setProgress(1);
  await nextFrame();
  loading.destroy();
  try {
    theApp.start();
  } catch (err) {
    errors.report(err, 'app.start');
  }

  // --- main loop -----------------------------------------------------------------------------------
  let last = performance.now();
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    if (errors.halted) {
      // Only the error dialog takes input while it is up.
      ui.handleNav(input.pollMenu());
      return;
    }
    try {
      theApp.frame(dt);
    } catch (err) {
      errors.report(err, 'frame');
    }
  };
  requestAnimationFrame(loop);

  // --- test hooks (autotest or dev builds only) -------------------------------------------------------
  if (params.hooks) {
    window.__uproot = {
      app: theApp,
      params,
      state: () => theApp.debugState(),
      get sim() {
        return theApp.currentMatch?.sim ?? null;
      },
      endMatch: () => theApp.currentMatch?.endNow('test'),
      forceResult: (r: Record<string, unknown>) => theApp.currentMatch?.forceResult(r),
      nav: (a: Parameters<typeof ui.handleNav>[0]) => ui.handleNav(a),
      save: () => save.data,
      errors: () => errors.count,
      view: () => view.stats(),
    };
  }
  document.documentElement.dataset.booted = '1';
}

void boot().catch((err) => {
  console.error('[uproot] boot failed', err);
  try {
    nativeLog('error', `boot failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  } catch {
    // ignore
  }
  const el = document.getElementById('boot-splash');
  if (el) el.dataset.failed = '1';
});
