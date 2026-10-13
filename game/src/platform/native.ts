/**
 * Typed bridge to the Electron preload (`window.uprootNative`, see electron/preload.cjs).
 * In a plain browser (vite dev, itch-style web build, Playwright) the bridge is absent and
 * every caller falls back to web APIs (localStorage, Fullscreen API, no Steam).
 */

export type SaveSlot = 'main' | 'backup';

export interface UprootSteamBridge {
  /** Steamworks initialised (Steam client running and the user owns the app). */
  readonly available: boolean;
  /** App id the Steam API was initialised with (null when unavailable). */
  readonly appId: number | null;
  /** Steam persona name, for the default player name. */
  readonly playerName: string | null;
  /** Steam per-game language API name ('koreana', 'english', ...). */
  readonly language: string | null;
  /** Running on Steam Deck (SteamDeck=1 in the environment). */
  readonly isSteamDeck: boolean;
  /** Unlock (and store) an achievement. False when Steam is unavailable or the id is unknown. */
  unlock(id: string): boolean;
  /** Achievement state on Steam; null when unknown/unavailable. */
  isUnlocked(id: string): boolean | null;
}

export interface UprootNative {
  /** Bridge contract version (bumped on breaking changes). */
  readonly bridgeVersion: number;
  readonly appVersion: string;
  /** process.platform of the main process ('win32', 'linux', 'darwin'). */
  readonly platform: string;
  readonly isPackaged: boolean;
  /** Synchronous save IO (userData/save.json). Null when the slot does not exist. */
  saveRead(slot?: SaveSlot): string | null;
  /** Atomic write (tmp + fsync + rename); the previous valid save becomes the backup. */
  saveWrite(text: string): boolean;
  /** Keep an unreadable / newer-version save for support instead of overwriting it. */
  saveQuarantine(text: string, reason: string): boolean;
  quit(): void;
  setFullscreen(on: boolean): void;
  isFullscreen(): boolean;
  /** F11 / Alt+Enter / OS changes. Returns an unsubscribe function. */
  onFullscreenChange(cb: (on: boolean) => void): () => void;
  /** Append to userData/logs/main.log. */
  log(level: 'info' | 'warn' | 'error', message: string): void;
  readonly steam: UprootSteamBridge;
}

declare global {
  interface Window {
    uprootNative?: UprootNative;
  }
}

/** The preload bridge, or null outside the desktop build. Never throws. */
export function getNative(): UprootNative | null {
  try {
    const g = globalThis as { uprootNative?: unknown };
    const n = g.uprootNative as UprootNative | undefined;
    if (n && typeof n === 'object' && typeof n.saveRead === 'function' && typeof n.saveWrite === 'function') return n;
  } catch {
    // ignore
  }
  return null;
}

/** Running inside the Electron desktop build. */
export function isDesktopBuild(): boolean {
  return getNative() !== null;
}

/** Fullscreen through the native window when available, else the HTML Fullscreen API. */
export function setFullscreen(on: boolean): void {
  const n = getNative();
  if (n) {
    try {
      n.setFullscreen(on);
    } catch (err) {
      console.warn('[platform] setFullscreen failed', err);
    }
    return;
  }
  if (typeof document === 'undefined') return;
  try {
    if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!on && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  } catch {
    // Browsers require a user gesture; the next settings toggle will retry.
  }
}

export function isFullscreen(): boolean {
  const n = getNative();
  if (n) {
    try {
      return n.isFullscreen();
    } catch {
      return false;
    }
  }
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

/** Subscribe to fullscreen changes from any source (F11, Alt+Enter, Esc in browsers). */
export function onFullscreenChange(cb: (on: boolean) => void): () => void {
  const n = getNative();
  if (n) {
    try {
      return n.onFullscreenChange(cb);
    } catch {
      return () => {};
    }
  }
  if (typeof document === 'undefined') return () => {};
  const fn = (): void => cb(!!document.fullscreenElement);
  document.addEventListener('fullscreenchange', fn);
  return () => document.removeEventListener('fullscreenchange', fn);
}

/** Quit the desktop app (no-op in browsers, where the tab owns the lifetime). */
export function quitApp(): void {
  const n = getNative();
  if (n) n.quit();
}

/** Forward a log line to the desktop log file (console only in browsers). */
export function nativeLog(level: 'info' | 'warn' | 'error', message: string): void {
  const n = getNative();
  if (n) {
    try {
      n.log(level, message);
      return;
    } catch {
      // fall through
    }
  }
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn(`[uproot] ${message}`);
}
