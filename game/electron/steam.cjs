'use strict';
/**
 * Steamworks (steamworks.js) wrapper for the main process. Everything is optional: when the
 * native module cannot load, Steam is not running or the user does not own the app, the game
 * runs normally and achievements are kept in the save file only.
 *
 * App id resolution (first match wins):
 *   1. env STEAM_APPID, or SteamAppId (set by the Steam client when it launches the game)
 *   2. steam_appid.txt beside the executable, in resources/, or (dev) in <project>/steam/
 *   3. 480 (Valve's public "Spacewar" test app) — UNPACKAGED dev runs only. A packaged build
 *      without an id never falls back to 480 (that would show "Playing Spacewar"); Steam is
 *      simply unavailable then.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEV_APP_ID = 480;
const ACH_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

function parseAppId(text) {
  const n = Number(String(text || '').trim().split(/\s+/)[0]);
  return Number.isInteger(n) && n > 0 && n < 2 ** 32 ? n : null;
}

function resolveAppId({ appRoot, isPackaged }) {
  for (const key of ['STEAM_APPID', 'SteamAppId']) {
    const id = parseAppId(process.env[key]);
    if (id) return { appId: id, source: `env:${key}` };
  }
  const candidates = [path.join(path.dirname(process.execPath), 'steam_appid.txt')];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'steam_appid.txt'));
  if (!isPackaged) {
    candidates.push(path.join(appRoot, 'steam', 'steam_appid.txt'));
    candidates.push(path.join(process.cwd(), 'steam_appid.txt'));
  }
  for (const file of candidates) {
    try {
      const id = parseAppId(fs.readFileSync(file, 'utf8'));
      if (id) return { appId: id, source: file };
    } catch {
      // not there
    }
  }
  if (!isPackaged) return { appId: DEV_APP_ID, source: 'default' };
  return { appId: null, source: 'none' };
}

function createSteam(log) {
  let steamworks = null;
  let client = null;
  const state = {
    moduleLoaded: false,
    available: false,
    appId: null,
    appIdSource: null,
    playerName: null,
    language: null,
    isSteamDeck: process.env.SteamDeck === '1',
    error: null,
  };

  function init({ appRoot, isPackaged, disabled }) {
    if (disabled) {
      state.error = 'disabled';
      log.info('[steam] disabled by flag/env');
      return state;
    }
    try {
      steamworks = require('steamworks.js');
      state.moduleLoaded = true;
    } catch (err) {
      state.error = `module: ${err && err.message ? err.message : err}`;
      log.warn('[steam] steamworks.js not available:', state.error);
      return state;
    }
    const { appId, source } = resolveAppId({ appRoot, isPackaged });
    state.appIdSource = source;
    if (appId === null) {
      state.error = 'no app id (not launched by Steam and no steam_appid.txt)';
      log.info('[steam] not initialised:', state.error);
      return state;
    }
    try {
      client = steamworks.init(appId);
      state.available = true;
      state.appId = appId;
    } catch (err) {
      // Typical: Steam client not running, or app not owned. Not an error for the player.
      state.error = `init: ${err && err.message ? err.message : err}`;
      log.info(`[steam] not initialised (app ${appId} from ${source}):`, state.error);
      return state;
    }
    try {
      state.playerName = client.localplayer.getName() || null;
    } catch (err) {
      log.warn('[steam] getName failed', err);
    }
    try {
      state.language = client.apps.currentGameLanguage() || null;
    } catch (err) {
      log.warn('[steam] currentGameLanguage failed', err);
    }
    log.info(`[steam] ready: app ${appId} (${source}), language ${state.language}, deck ${state.isSteamDeck}`);
    return state;
  }

  /** Must run before app 'ready' (adds GPU command-line switches). */
  function enableOverlay() {
    if (!steamworks || !state.available) return false;
    try {
      steamworks.electronEnableSteamOverlay();
      log.info('[steam] overlay enabled');
      return true;
    } catch (err) {
      log.warn('[steam] overlay setup failed', err);
      return false;
    }
  }

  function unlock(id) {
    if (!state.available || typeof id !== 'string' || !ACH_RE.test(id)) return false;
    try {
      const ok = client.achievement.activate(id) === true;
      log.info(`[steam] achievement ${id}: ${ok ? 'unlocked' : 'rejected'}`);
      return ok;
    } catch (err) {
      log.warn('[steam] achievement unlock failed', id, err);
      return false;
    }
  }

  function isUnlocked(id) {
    if (!state.available || typeof id !== 'string' || !ACH_RE.test(id)) return null;
    try {
      return client.achievement.isActivated(id) === true;
    } catch {
      return null;
    }
  }

  /** Plain-data status for the preload bridge. */
  function status() {
    return {
      available: state.available,
      appId: state.appId,
      playerName: state.playerName,
      language: state.language,
      isSteamDeck: state.isSteamDeck,
    };
  }

  return { state, init, enableOverlay, unlock, isUnlocked, status };
}

module.exports = { createSteam, resolveAppId, parseAppId, DEV_APP_ID };
