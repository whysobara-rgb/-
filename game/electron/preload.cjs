'use strict';
/**
 * Preload (sandboxed): exposes `window.uprootNative` — the typed contract lives in
 * src/platform/native.ts (UprootNative). Only plain data and wrapped functions cross the
 * context bridge; the page never sees ipcRenderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('uproot:info') || {};
const steamInfo = info.steam || {};

const str = (v) => (typeof v === 'string' ? v : null);

const api = {
  bridgeVersion: Number(info.bridgeVersion) || 1,
  appVersion: String(info.appVersion || ''),
  platform: String(info.platform || ''),
  isPackaged: info.isPackaged === true,

  saveRead(slot) {
    return str(ipcRenderer.sendSync('uproot:save-read', slot === 'backup' ? 'backup' : 'main'));
  },
  saveWrite(text) {
    return typeof text === 'string' && ipcRenderer.sendSync('uproot:save-write', text) === true;
  },
  saveQuarantine(text, reason) {
    return typeof text === 'string' && ipcRenderer.sendSync('uproot:save-quarantine', text, String(reason || '')) === true;
  },
  quit() {
    ipcRenderer.send('uproot:quit');
  },
  setFullscreen(on) {
    ipcRenderer.send('uproot:set-fullscreen', on === true);
  },
  isFullscreen() {
    return ipcRenderer.sendSync('uproot:is-fullscreen') === true;
  },
  onFullscreenChange(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = (_event, on) => {
      try {
        cb(on === true);
      } catch (err) {
        console.error('[uprootNative] fullscreen listener failed', err);
      }
    };
    ipcRenderer.on('uproot:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('uproot:fullscreen-changed', handler);
  },
  log(level, message) {
    const lv = level === 'error' || level === 'warn' ? level : 'info';
    ipcRenderer.send('uproot:log', lv, String(message).slice(0, 4000));
  },
  steam: {
    available: steamInfo.available === true,
    appId: Number.isInteger(steamInfo.appId) ? steamInfo.appId : null,
    playerName: str(steamInfo.playerName),
    language: str(steamInfo.language),
    isSteamDeck: steamInfo.isSteamDeck === true,
    unlock(id) {
      return typeof id === 'string' && ipcRenderer.sendSync('uproot:steam-unlock', id) === true;
    },
    isUnlocked(id) {
      if (typeof id !== 'string') return null;
      const v = ipcRenderer.sendSync('uproot:steam-is-unlocked', id);
      return typeof v === 'boolean' ? v : null;
    },
  },
};

contextBridge.exposeInMainWorld('uprootNative', api);

if (info.selftest === true) {
  contextBridge.exposeInMainWorld('uprootSelftest', {
    report(result) {
      ipcRenderer.send('uproot:selftest-report', result);
    },
  });
}
