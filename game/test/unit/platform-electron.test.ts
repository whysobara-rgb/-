/**
 * Main-process modules (electron/*.cjs) are plain Node: test the crash-safe save store and the
 * Steam app-id resolution without launching Electron. The full IPC path is covered by
 * `electron . --selftest` (see docs/STEAM_RELEASE.md).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { SaveStore, isJsonObject } = require('../../electron/save-store.cjs') as {
  SaveStore: new (dir: string, log?: unknown) => {
    mainFile: string;
    backupFile: string;
    tmpFile: string;
    quarantineDir: string;
    read(slot: 'main' | 'backup'): string | null;
    write(text: unknown): boolean;
    quarantine(text: string, reason: string): boolean;
    readFullscreenPreference(fallback: boolean): boolean;
  };
  isJsonObject(t: unknown): boolean;
};
const { resolveAppId, parseAppId } = require('../../electron/steam.cjs') as {
  resolveAppId(o: { appRoot: string; isPackaged: boolean }): { appId: number | null; source: string };
  parseAppId(t: unknown): number | null;
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const { loadWindowState, trackWindowState, fitToWorkArea } = require('../../electron/window-state.cjs') as {
  loadWindowState(dir: string, screen: FakeScreen, d: { width: number; height: number; minWidth: number; minHeight: number }): {
    width: number;
    height: number;
    x?: number;
    y?: number;
    maximized: boolean;
  };
  trackWindowState(win: FakeWindow, dir: string, initial?: { width: number; height: number }): void;
  fitToWorkArea(win: FakeWindow, screen: FakeScreen): void;
};

/** A display with a work area (taskbar excluded). */
class FakeScreen {
  constructor(public readonly displays: Array<{ workArea: Rect }>) {}
  getAllDisplays() {
    return this.displays;
  }
  getPrimaryDisplay() {
    return this.displays[0];
  }
  getDisplayMatching(r: Rect) {
    const overlap = (a: Rect) => Math.max(0, Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x)) * Math.max(0, Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y));
    return [...this.displays].sort((a, b) => overlap(b.workArea) - overlap(a.workArea))[0];
  }
}

/** BrowserWindow stand-in with a real frame: outer = content + borders + title bar. */
class FakeWindow {
  static readonly FRAME = { width: 16, height: 39 };
  content: { width: number; height: number };
  pos: { x: number; y: number };
  maximized = false;
  normal: Rect | null = null;
  private readonly handlers = new Map<string, Array<() => void>>();
  constructor(o: { width: number; height: number; x?: number; y?: number; useContentSize: boolean }) {
    const f = o.useContentSize ? { width: 0, height: 0 } : FakeWindow.FRAME;
    this.content = { width: o.width - f.width, height: o.height - f.height };
    this.pos = { x: o.x ?? 100, y: o.y ?? 80 };
  }
  on(ev: string, cb: () => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb]);
  }
  emit(ev: string) {
    for (const cb of this.handlers.get(ev) ?? []) cb();
  }
  isDestroyed() {
    return false;
  }
  isFullScreen() {
    return false;
  }
  isMinimized() {
    return false;
  }
  isMaximized() {
    return this.maximized;
  }
  getBounds(): Rect {
    return { ...this.pos, width: this.content.width + FakeWindow.FRAME.width, height: this.content.height + FakeWindow.FRAME.height };
  }
  getContentSize(): [number, number] {
    return [this.content.width, this.content.height];
  }
  setContentSize(w: number, h: number) {
    this.content = { width: w, height: h };
  }
  setPosition(x: number, y: number) {
    this.pos = { x, y };
  }
  getNormalBounds(): Rect {
    return this.normal ?? this.getBounds();
  }
  maximize(wa: Rect) {
    this.normal = this.getBounds();
    this.maximized = true;
    this.pos = { x: wa.x, y: wa.y };
    this.content = { width: wa.width - FakeWindow.FRAME.width, height: wa.height - FakeWindow.FRAME.height };
    this.emit('maximize');
  }
}

const quiet = { info() {}, warn() {}, error() {} };
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uproot-store-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SaveStore (electron/save-store.cjs)', () => {
  it('round-trips UTF-8 and rotates only valid saves into the backup', () => {
    const s = new SaveStore(path.join(dir, 'nested'), quiet);
    expect(s.read('main')).toBeNull();
    expect(s.write('{"a":"뿌리째"}')).toBe(true);
    expect(s.read('main')).toBe('{"a":"뿌리째"}');
    expect(s.read('backup')).toBeNull();
    s.write('{"a":2}');
    expect(s.read('backup')).toBe('{"a":"뿌리째"}');
    s.write('{"trunc');
    expect(s.read('backup')).toBe('{"a":2}');
    s.write('{"a":3}');
    expect(s.read('backup')).toBe('{"a":2}');
    expect(fs.existsSync(s.tmpFile)).toBe(false);
  });

  it('recovers a completed tmp file when main is missing (crash before rename)', () => {
    const s = new SaveStore(dir, quiet);
    fs.writeFileSync(s.tmpFile, '{"from":"tmp"}');
    expect(s.read('main')).toBe('{"from":"tmp"}');
    fs.writeFileSync(s.tmpFile, '{"partial');
    expect(s.read('main')).toBeNull();
  });

  it('rejects non-strings and oversized saves', () => {
    const s = new SaveStore(dir, quiet);
    expect(s.write(42)).toBe(false);
    expect(s.write('x'.repeat(5 * 1024 * 1024 + 1))).toBe(false);
  });

  it('quarantines with sanitized names and prunes old files', () => {
    const s = new SaveStore(dir, quiet);
    for (let i = 0; i < 13; i++) expect(s.quarantine(`bad ${i}`, '../../evil name')).toBe(true);
    const files = fs.readdirSync(s.quarantineDir);
    expect(files.length).toBeLessThanOrEqual(10);
    for (const f of files) expect(f).toMatch(/^save\.evilname\.[0-9TZ-]+\.json$/);
  });

  it('reads the fullscreen preference for window creation', () => {
    const s = new SaveStore(dir, quiet);
    expect(s.readFullscreenPreference(true)).toBe(true);
    s.write(JSON.stringify({ settings: { fullscreen: false } }));
    expect(s.readFullscreenPreference(true)).toBe(false);
    fs.writeFileSync(s.mainFile, 'garbage');
    fs.writeFileSync(s.backupFile, JSON.stringify({ settings: { fullscreen: false } }));
    expect(s.readFullscreenPreference(true)).toBe(false);
  });

  it('isJsonObject', () => {
    expect(isJsonObject('{}')).toBe(true);
    expect(isJsonObject('﻿{"a":1}')).toBe(true);
    expect(isJsonObject('[]')).toBe(false);
    expect(isJsonObject('')).toBe(false);
    expect(isJsonObject(null)).toBe(false);
  });
});

describe('Steam app id resolution (electron/steam.cjs)', () => {
  const saved = { STEAM_APPID: process.env.STEAM_APPID, SteamAppId: process.env.SteamAppId };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('parses app id files', () => {
    expect(parseAppId('480\n')).toBe(480);
    expect(parseAppId('  3241660  ')).toBe(3241660);
    expect(parseAppId('abc')).toBeNull();
    expect(parseAppId('-5')).toBeNull();
    expect(parseAppId('')).toBeNull();
  });

  it('env wins, then the project steam_appid.txt in dev, then 480 (dev only)', () => {
    delete process.env.STEAM_APPID;
    delete process.env.SteamAppId;
    expect(resolveAppId({ appRoot: dir, isPackaged: false })).toEqual({ appId: 480, source: 'default' });
    // A shipped build never pretends to be Spacewar.
    expect(resolveAppId({ appRoot: dir, isPackaged: true })).toEqual({ appId: null, source: 'none' });
    fs.mkdirSync(path.join(dir, 'steam'));
    fs.writeFileSync(path.join(dir, 'steam', 'steam_appid.txt'), '1234567\n');
    expect(resolveAppId({ appRoot: dir, isPackaged: false })).toEqual({ appId: 1234567, source: path.join(dir, 'steam', 'steam_appid.txt') });
    // Packaged builds never read the project folder.
    expect(resolveAppId({ appRoot: dir, isPackaged: true }).appId).toBeNull();
    process.env.SteamAppId = '777';
    expect(resolveAppId({ appRoot: dir, isPackaged: false })).toEqual({ appId: 777, source: 'env:SteamAppId' });
    process.env.STEAM_APPID = '888';
    expect(resolveAppId({ appRoot: dir, isPackaged: false })).toEqual({ appId: 888, source: 'env:STEAM_APPID' });
  });
});

describe('window state (electron/window-state.cjs)', () => {
  const DEFAULTS = { width: 1600, height: 900, minWidth: 1024, minHeight: 576 };
  const big = new FakeScreen([{ workArea: { x: 0, y: 0, width: 2560, height: 1400 } }]);

  /** One launch: create like main.cjs (useContentSize), run `during`, close. */
  function launch(screen: FakeScreen, during?: (w: FakeWindow) => void) {
    const ws = loadWindowState(dir, screen, DEFAULTS);
    const win = new FakeWindow({ width: ws.width, height: ws.height, x: ws.x, y: ws.y, useContentSize: true });
    if (!ws.maximized) fitToWorkArea(win, screen);
    trackWindowState(win, dir, { width: ws.width, height: ws.height });
    during?.(win);
    win.emit('close');
    return { ws, win };
  }

  it('does not grow by one frame per launch', () => {
    const first = launch(big, (w) => {
      w.setPosition(300, 200);
      w.emit('move');
    });
    expect(first.win.getContentSize()).toEqual([1600, 900]);
    let last = first;
    for (let i = 0; i < 5; i++) last = launch(big);
    expect(last.ws).toMatchObject({ width: 1600, height: 900, x: 300, y: 200, maximized: false });
    expect(last.win.getContentSize()).toEqual([1600, 900]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'window.json'), 'utf8'))).toMatchObject({ v: 2, width: 1600, height: 900 });
  });

  it('saves the restore (content) size while maximized', () => {
    launch(big, (w) => {
      w.setContentSize(1280, 720);
      w.emit('resize');
      w.maximize(big.displays[0].workArea);
    });
    const ws = loadWindowState(dir, big, DEFAULTS);
    expect(ws).toMatchObject({ width: 1280, height: 720, maximized: true });
  });

  it('clamps a saved size to the work area even when a position was saved', () => {
    launch(big, (w) => {
      w.setContentSize(2400, 1300);
      w.setPosition(10, 10);
      w.emit('resize');
    });
    const laptop = new FakeScreen([{ workArea: { x: 0, y: 0, width: 1366, height: 728 } }]);
    const ws = loadWindowState(dir, laptop, DEFAULTS);
    expect(ws.x).toBe(10);
    expect(ws.width).toBeLessThanOrEqual(1366);
    expect(ws.height).toBeLessThanOrEqual(728);
    // After creation the outer frame fits too.
    const { win } = launch(laptop);
    const b = win.getBounds();
    expect(b.width).toBeLessThanOrEqual(1366);
    expect(b.height).toBeLessThanOrEqual(728);
    expect(b.x + b.width).toBeLessThanOrEqual(1366);
    expect(b.y + b.height).toBeLessThanOrEqual(728);
  });

  it('ignores the outer size stored by the old unversioned format', () => {
    fs.writeFileSync(path.join(dir, 'window.json'), JSON.stringify({ x: 50, y: 60, width: 1616, height: 939, maximized: false }));
    expect(loadWindowState(dir, big, DEFAULTS)).toMatchObject({ width: 1600, height: 900, x: 50, y: 60 });
  });
});
