'use strict';
/**
 * Remembers the windowed size/position (userData/window.json) and validates it against the
 * current displays, so a window never reopens off-screen after a monitor change.
 */
const fs = require('node:fs');
const path = require('node:path');

function loadWindowState(dir, screen, defaults) {
  const file = path.join(dir, 'window.json');
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    saved = null;
  }
  const state = { width: defaults.width, height: defaults.height, x: undefined, y: undefined, maximized: false };
  if (saved && typeof saved === 'object') {
    const w = Number(saved.width);
    const h = Number(saved.height);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      state.width = Math.max(defaults.minWidth, Math.round(w));
      state.height = Math.max(defaults.minHeight, Math.round(h));
    }
    state.maximized = saved.maximized === true;
    const x = Number(saved.x);
    const y = Number(saved.y);
    if (Number.isFinite(x) && Number.isFinite(y) && isVisibleOnSomeDisplay(screen, { x, y, width: state.width, height: state.height })) {
      state.x = Math.round(x);
      state.y = Math.round(y);
    }
  }
  // Never larger than the primary work area (first launch on a small laptop screen).
  try {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    if (state.x === undefined) {
      state.width = Math.min(state.width, Math.max(defaults.minWidth, wa.width));
      state.height = Math.min(state.height, Math.max(defaults.minHeight, wa.height));
    }
  } catch {
    // headless
  }
  return state;
}

function isVisibleOnSomeDisplay(screen, r) {
  try {
    return screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      const ix = Math.max(0, Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x));
      const iy = Math.max(0, Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y));
      return ix >= 160 && iy >= 120;
    });
  } catch {
    return false;
  }
}

function trackWindowState(win, dir) {
  const file = path.join(dir, 'window.json');
  let timer = null;
  const save = () => {
    timer = null;
    if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    try {
      fs.writeFileSync(file, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }));
    } catch {
      // ignore
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

module.exports = { loadWindowState, trackWindowState };
