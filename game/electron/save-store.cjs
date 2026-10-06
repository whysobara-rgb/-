'use strict';
/**
 * Crash-safe save file IO (main process, synchronous — saves are a few KB).
 *
 *   userData/save.json        current save
 *   userData/save.bak         previous VALID save (never overwritten by a corrupt file)
 *   userData/save.json.tmp    in-flight write
 *   userData/quarantine/      unreadable or newer-version saves kept for support
 *
 * Write sequence: tmp (write + fsync) -> copy current valid main to save.bak (via its own tmp
 * + rename) -> rename tmp over main -> fsync the directory. A crash at any point leaves either
 * the old or the new main intact; the renderer falls back to save.bak if main is unreadable.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_SAVE_BYTES = 5 * 1024 * 1024;
const MAX_QUARANTINE_FILES = 10;

function isJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  try {
    const v = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}

/** Synchronous sleep for rename retries (Windows antivirus / indexer locks). */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

function renameWithRetry(from, to) {
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      lastErr = err;
      if (!err || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(15 * (attempt + 1));
    }
  }
  throw lastErr;
}

function writeFileDurable(file, text) {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, text, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDir(dir) {
  if (process.platform === 'win32') return; // directories cannot be fsynced on Windows
  try {
    const fd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Not supported on some filesystems; the rename is still atomic.
  }
}

class SaveStore {
  constructor(dir, log) {
    this.dir = dir;
    this.log = log || { info() {}, warn() {}, error() {} };
    this.mainFile = path.join(dir, 'save.json');
    this.backupFile = path.join(dir, 'save.bak');
    this.tmpFile = path.join(dir, 'save.json.tmp');
    this.backupTmpFile = path.join(dir, 'save.bak.tmp');
    this.quarantineDir = path.join(dir, 'quarantine');
  }

  /** @param {'main'|'backup'} slot */
  read(slot) {
    const file = slot === 'backup' ? this.backupFile : this.mainFile;
    try {
      return fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        // A crash between "tmp complete" and "rename" on the very first save leaves only tmp.
        if (slot === 'main') {
          try {
            const tmp = fs.readFileSync(this.tmpFile, 'utf8');
            if (isJsonObject(tmp)) {
              this.log.warn('[save] main missing, using completed tmp file');
              return tmp;
            }
          } catch {
            // no tmp either
          }
        }
        return null;
      }
      this.log.error('[save] read failed', slot, err);
      return null;
    }
  }

  write(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_SAVE_BYTES) {
      this.log.warn('[save] rejected write (type or size)');
      return false;
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      writeFileDurable(this.tmpFile, text);
      // Rotate the current main into the backup only when it is a valid save.
      let current = null;
      try {
        current = fs.readFileSync(this.mainFile, 'utf8');
      } catch (err) {
        if (!err || err.code !== 'ENOENT') this.log.warn('[save] could not read current main for backup', err);
      }
      if (current !== null && current !== text && isJsonObject(current)) {
        writeFileDurable(this.backupTmpFile, current);
        renameWithRetry(this.backupTmpFile, this.backupFile);
      }
      renameWithRetry(this.tmpFile, this.mainFile);
      fsyncDir(this.dir);
      return true;
    } catch (err) {
      this.log.error('[save] write failed', err);
      return false;
    }
  }

  quarantine(text, reason) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_SAVE_BYTES) return false;
    const safeReason = String(reason || 'unknown').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'unknown';
    try {
      fs.mkdirSync(this.quarantineDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(this.quarantineDir, `save.${safeReason}.${stamp}.json`);
      writeFileDurable(file, text);
      this.log.warn(`[save] quarantined (${safeReason}) -> ${file}`);
      this.prune();
      return true;
    } catch (err) {
      this.log.error('[save] quarantine failed', err);
      return false;
    }
  }

  prune() {
    try {
      const files = fs
        .readdirSync(this.quarantineDir)
        .filter((f) => f.startsWith('save.') && f.endsWith('.json'))
        .map((f) => ({ f, t: fs.statSync(path.join(this.quarantineDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const { f } of files.slice(MAX_QUARANTINE_FILES)) fs.unlinkSync(path.join(this.quarantineDir, f));
    } catch {
      // best effort
    }
  }

  /** settings.fullscreen from the current save (main process reads it before creating the window). */
  readFullscreenPreference(fallback) {
    for (const slot of ['main', 'backup']) {
      const text = this.read(slot);
      if (!isJsonObject(text)) continue;
      try {
        const v = JSON.parse(text);
        if (v && v.settings && typeof v.settings.fullscreen === 'boolean') return v.settings.fullscreen;
        return fallback;
      } catch {
        // try next
      }
    }
    return fallback;
  }
}

module.exports = { SaveStore, isJsonObject, MAX_SAVE_BYTES };
