/*
 * Virtual clock for deterministic capture (injected with page.addInitScript before the game
 * loads). requestAnimationFrame, setTimeout/setInterval, performance.now and — in manual mode —
 * every CSS / Web Animation run on one virtual timeline:
 *
 *   auto mode (default): a real rAF driver advances virtual time with the wall clock, so boot,
 *                        font loading and menus behave exactly as usual.
 *   manual mode:         time only moves when Node calls __cap.pump(frames, dtMs). Each pumped
 *                        frame fires the due timers, steps CSS animations by dt and runs the
 *                        queued rAF callbacks (the game's own main loop) once.
 *
 * __cap.setDraw(false) turns every WebGLRenderer.render into a no-op so pumping hundreds of
 * frames (sim ticks, HUD timers, FX) costs nothing; the frame that is actually captured is
 * pumped with drawing back on. Nothing here changes game logic: the game still runs its own
 * frame(), sim steps, view and HUD code — only *when* frames happen is controlled.
 */
(() => {
  const W = window;
  const realRAF = W.requestAnimationFrame.bind(W);
  const realST = W.setTimeout.bind(W);
  const realNow = performance.now.bind(performance);
  let vnow = realNow();
  let auto = true;
  let cssManual = false;
  let nextId = 1;
  let frames = 0;
  const rafQ = new Map();
  const timers = new Map();

  W.requestAnimationFrame = (cb) => {
    const id = nextId++;
    rafQ.set(id, cb);
    return id;
  };
  W.cancelAnimationFrame = (id) => void rafQ.delete(id);
  W.setTimeout = (cb, ms = 0, ...args) => {
    const id = nextId++;
    timers.set(id, { at: vnow + Math.max(0, Number(ms) || 0), cb, args, interval: 0, seq: id });
    return id;
  };
  W.clearTimeout = (id) => void timers.delete(id);
  W.setInterval = (cb, ms = 0, ...args) => {
    const id = nextId++;
    const iv = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: vnow + iv, cb, args, interval: iv, seq: id });
    return id;
  };
  W.clearInterval = (id) => void timers.delete(id);
  Object.defineProperty(performance, 'now', { value: () => vnow, configurable: true, writable: true });

  const report = (e) => {
    try {
      console.error('[cap] callback threw', e && e.stack ? e.stack : String(e));
    } catch {
      /* ignore */
    }
  };

  function fireTimers(until) {
    for (let guard = 0; guard < 10000; guard++) {
      let bestId = -1;
      let best = null;
      for (const [id, t] of timers) {
        if (t.at <= until && (!best || t.at < best.at || (t.at === best.at && t.seq < best.seq))) {
          best = t;
          bestId = id;
        }
      }
      if (!best) break;
      if (best.at > vnow) vnow = best.at;
      if (best.interval) best.at += best.interval;
      else timers.delete(bestId);
      try {
        if (typeof best.cb === 'function') best.cb(...best.args);
      } catch (e) {
        report(e);
      }
    }
    if (until > vnow) vnow = until;
  }

  function stepCss(dtMs) {
    if (!cssManual || typeof document.getAnimations !== 'function') return;
    for (const a of document.getAnimations()) {
      try {
        if (!a.__capV) {
          a.__capV = 1;
          a.pause();
        } else if (dtMs > 0 && !a.__capDone) {
          const t = (Number(a.currentTime) || 0) + dtMs;
          const end = a.effect ? Number(a.effect.getComputedTiming().endTime) : Infinity;
          if (Number.isFinite(end) && t >= end) {
            // Finish so `animation.finished` / animationend fire like they would in real time.
            a.__capDone = 1;
            a.finish();
          } else a.currentTime = t;
        }
      } catch {
        /* ignore */
      }
    }
  }

  function frame(dtMs) {
    fireTimers(vnow + dtMs);
    stepCss(dtMs);
    frames++;
    const cbs = [...rafQ.values()];
    rafQ.clear();
    for (const cb of cbs) {
      try {
        cb(vnow);
      } catch (e) {
        report(e);
      }
    }
  }

  let lastReal = realNow();
  const driver = () => {
    const now = realNow();
    const d = Math.min(100, Math.max(0, now - lastReal));
    lastReal = now;
    if (auto) frame(d);
    realRAF(driver);
  };
  realRAF(driver);

  // --- drawing switch -------------------------------------------------------------------------
  const patched = new Set();
  let drawOn = true;
  /**
   * mode 'all': skip every draw (GameView: its post-processing passes are only for display).
   * mode 'screen': skip only draws to the canvas; render-to-texture work (the menu renderer's
   * portrait snapshots used by the HUD / results cards) always runs.
   */
  function patchRenderer(r, mode) {
    if (!r || patched.has(r)) return;
    patched.add(r);
    const orig = r.render.bind(r);
    r.render = (...a) => {
      if (drawOn || (mode === 'screen' && r.getRenderTarget() !== null)) return orig(...a);
      return undefined;
    };
  }

  const yieldReal = () => new Promise((r) => realST(r, 0));

  W.__cap = {
    get now() {
      return vnow;
    },
    get frames() {
      return frames;
    },
    get auto() {
      return auto;
    },
    /** Stop the real-time driver: time moves only through pump(). */
    manual(on = true) {
      auto = !on;
      lastReal = realNow();
    },
    /** Step every CSS / Web Animation with the virtual clock (manual) or let them run (off). */
    cssManual(on = true) {
      cssManual = on;
      if (!on && typeof document.getAnimations === 'function') {
        for (const a of document.getAnimations()) {
          if (a.__capV) {
            a.__capV = 0;
            try {
              a.play();
            } catch {
              /* ignore */
            }
          }
        }
      } else stepCss(0);
    },
    /** Register renderers whose draws setDraw() switches. */
    renderers(list, mode = 'all') {
      for (const r of list) patchRenderer(r, mode);
      return patched.size;
    },
    setDraw(on) {
      drawOn = !!on;
    },
    /** Pump n virtual frames of dtMs (yielding to the real event loop every `yieldEvery`). */
    async pump(n = 1, dtMs = 1000 / 60, yieldEvery = 4) {
      for (let i = 0; i < n; i++) {
        frame(dtMs);
        if ((i + 1) % yieldEvery === 0) await yieldReal();
      }
      await yieldReal();
      return vnow;
    },
    /** Pump until pred() is truthy (checked after each frame). Returns frames pumped or -1. */
    async pumpUntil(pred, limit = 3600, dtMs = 1000 / 60) {
      for (let i = 1; i <= limit; i++) {
        frame(dtMs);
        if (i % 4 === 0) await yieldReal();
        let ok = false;
        try {
          ok = !!pred();
        } catch {
          ok = false;
        }
        if (ok) return i;
      }
      return -1;
    },
    realSleep: (ms) => new Promise((r) => realST(r, ms)),
  };
})();
