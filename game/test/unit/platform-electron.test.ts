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
