'use strict';
/**
 * Tiny synchronous file logger for the main process: userData/logs/main.log, rotated at 2 MB
 * (main.1.log, main.2.log kept). Logging must never crash the game, so every IO is guarded.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 2;

function createLogger(dir, options = {}) {
  const echo = !!options.echo;
  const file = path.join(dir, 'main.log');
  let ok = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    rotateIfNeeded();
  } catch {
    ok = false;
  }

  function rotateIfNeeded() {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < MAX_BYTES) return;
    for (let i = KEEP; i >= 1; i--) {
      const src = i === 1 ? file : path.join(dir, `main.${i - 1}.log`);
      const dst = path.join(dir, `main.${i}.log`);
      try {
        if (fs.existsSync(src)) fs.renameSync(src, dst);
      } catch {
        // best effort
      }
    }
  }

  let written = 0;
  function write(level, parts) {
    const msg = parts
      .map((p) => (p instanceof Error ? `${p.message}\n${p.stack || ''}` : typeof p === 'string' ? p : safeJson(p)))
      .join(' ');
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
    if (echo) (level === 'error' ? process.stderr : process.stdout).write(line);
    if (!ok) return;
    try {
      fs.appendFileSync(file, line, 'utf8');
      written += line.length;
      if (written > 256 * 1024) {
        written = 0;
        rotateIfNeeded();
      }
    } catch {
      // disk full / permissions: keep running
    }
  }

  return {
    file,
    dir,
    info: (...p) => write('info', p),
    warn: (...p) => write('warn', p),
    error: (...p) => write('error', p),
  };
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

module.exports = { createLogger };
