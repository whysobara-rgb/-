'use strict';
/**
 * Remembers the windowed size/position (userData/window.json) and validates it against the
 * current displays, so a window never reopens off-screen or larger than the screen.
 *
 * Sizes are CONTENT sizes (the game's viewport), matching `useContentSize: true` in main.cjs;
 * x/y are the outer window's top-left, which is what BrowserWindow's x/y mean. (Saving the outer
 * size and restoring it as a content size would grow the window by one frame every launch.)
 */
const fs = require('node:fs');
const path = require('node:path');

/** window.json format. Format 1 (unversioned) stored the OUTER size; its size is ignored. */
const FORMAT = 2;

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
    if (saved.v === FORMAT && Number.isFinite(w) && Number.isFinite(h)) {
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
  // Never larger than the work area of the display the window opens on (first launch on a
  // small laptop screen, or a saved size from a bigger monitor that is gone now).
  const wa = workAreaFor(screen, state);
  if (wa) {
    state.width = Math.min(state.width, Math.max(defaults.minWidth, wa.width));
    state.height = Math.min(state.height, Math.max(defaults.minHeight, wa.height));
  }
  return state;
}

function workAreaFor(screen, r) {
  try {
    if (r.x !== undefined && r.y !== undefined) return screen.getDisplayMatching({ x: r.x, y: r.y, width: r.width, height: r.height }).workArea;
    return screen.getPrimaryDisplay().workArea;
  } catch {
    return null; // headless / no displays
  }
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

/**
 * Shrink / move a windowed window so its OUTER bounds fit the work area of its display. Runs
 * after creation, when the frame size is known (the content-size clamp above cannot see it).
 */
function fitToWorkArea(win, screen) {
  try {
    if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const overW = Math.max(0, b.width - wa.width);
    const overH = Math.max(0, b.height - wa.height);
    let width = b.width;
    let height = b.height;
    if (overW || overH) {
      const [cw, ch] = win.getContentSize();
      win.setContentSize(Math.max(1, cw - overW), Math.max(1, ch - overH));
      const nb = win.getBounds();
      width = nb.width;
      height = nb.height;
    }
    const x = Math.min(Math.max(b.x, wa.x), wa.x + Math.max(0, wa.width - width));
    const y = Math.min(Math.max(b.y, wa.y), wa.y + Math.max(0, wa.height - height));
    if (x !== b.x || y !== b.y) win.setPosition(x, y);
  } catch {
    // Best effort: a slightly oversized window is still usable.
  }
}

/**
 * Persist the windowed geometry. `initialContent` is the content size the window was created
 * with: the restore size when it starts maximized and was never windowed this session.
 */
function trackWindowState(win, dir, initialContent) {
  const file = path.join(dir, 'window.json');
  let timer = null;
  /** Outer minus content size, measured while windowed (null until then). */
  let frame = null;
  let normalContent = initialContent && Number.isFinite(initialContent.width) ? { width: initialContent.width, height: initialContent.height } : null;

  const isWindowed = () => !win.isDestroyed() && !win.isFullScreen() && !win.isMaximized() && !win.isMinimized();
  const measure = () => {
    if (!isWindowed()) return;
    const b = win.getBounds();
    const [cw, ch] = win.getContentSize();
    frame = { width: Math.max(0, b.width - cw), height: Math.max(0, b.height - ch) };
    normalContent = { width: cw, height: ch };
  };
  const save = () => {
    timer = null;
    if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    let pos;
    let size;
    if (maximized) {
      // The restore geometry: Electron tracks the outer normal bounds; convert with the frame
      // measured while windowed, else keep the last known windowed content size.
      pos = win.getNormalBounds();
      size = frame
        ? { width: Math.max(1, pos.width - frame.width), height: Math.max(1, pos.height - frame.height) }
        : normalContent;
    } else {
      measure();
      pos = win.getBounds();
      size = normalContent;
    }
    if (!size) return;
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ v: FORMAT, x: pos.x, y: pos.y, width: Math.round(size.width), height: Math.round(size.height), maximized }),
      );
    } catch {
      // ignore: geometry is a convenience
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  // The frame is only final once the window manager has decorated the shown window; saves
  // re-measure whenever the window is windowed. A maximize right after a resize is still right:
  // the maximized branch uses Electron's normal bounds, not the last measurement's size.
  measure();
  win.on('show', () => setTimeout(measure, 0));
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

module.exports = { loadWindowState, trackWindowState, fitToWorkArea, WINDOW_STATE_FORMAT: FORMAT };
