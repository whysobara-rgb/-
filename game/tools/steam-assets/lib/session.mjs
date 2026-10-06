/**
 * Playwright session helpers for the steam-asset capture: open the real game with the virtual
 * clock + director injected, pump frames, draw one frame at full quality and save it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLOCK_JS = fs.readFileSync(path.join(HERE, 'clock.js'), 'utf8');
export const DIRECTOR_JS = fs.readFileSync(path.join(HERE, 'director.js'), 'utf8');

export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...a) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}]`, ...a);
}

/**
 * Open the game. `query` is the URL query (without '?'). Returns { ctx, page, problems }.
 * The viewport is the CSS size; dpr 2 renders every pixel twice in each axis (supersampling).
 */
export async function openGame(browser, { base, query, width = 1920, height = 1080, dpr = 2, pathName = '/' }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme: 'dark' });
  await ctx.addInitScript({ content: CLOCK_JS });
  await ctx.addInitScript({ content: DIRECTOR_JS });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15 * 60 * 1000);
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}${pathName}?${query}`);
  await waitFor(page, `document.documentElement.dataset.booted === '1'`, 240_000);
  return { ctx, page, problems };
}

/** Poll a page expression from Node (never page.waitForFunction: rAF is virtual here). */
export async function waitFor(page, expr, timeout = 120_000, every = 250) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await page.evaluate(`(() => { try { return !!(${expr}); } catch { return false; } })()`);
    } catch {
      ok = false;
    }
    if (ok) return Date.now() - t0;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${expr}`);
    await sleep(every);
  }
}

export const ev = (page, expr) => page.evaluate(expr);

/** Switch to manual virtual time, CSS animations stepped by the clock, draws off. */
export async function takeControl(page) {
  await page.evaluate(`(() => {
    __cap.manual(true);
    __cap.cssManual(true);
    const a = window.__uproot.app;
    const rs = [a.d.view.webgl];
    if (a.stage) rs.push(a.stage.gl);
    __cap.renderers(rs);
    __cap.setDraw(false);
  })()`);
}

/** Re-register renderers (GameView recreates its renderer when MSAA settings change). */
export async function registerRenderers(page) {
  await page.evaluate(`(() => { const a = window.__uproot.app; const rs = [a.d.view.webgl]; if (a.stage) rs.push(a.stage.gl); __cap.renderers(rs); })()`);
}

export async function pump(page, n, dtMs = 1000 / 60) {
  return page.evaluate(([n, dt]) => window.__cap.pump(n, dt), [n, dtMs]);
}

/** Pump until `pred` (a JS expression, evaluated in the page after every frame). */
export async function pumpUntil(page, pred, limit = 3600, dtMs = 1000 / 60) {
  const n = await page.evaluate(`window.__cap.pumpUntil(() => (${pred}), ${limit}, ${dtMs})`);
  if (n < 0) throw new Error(`pumpUntil: not reached in ${limit} frames: ${pred}`);
  return n;
}

/** Draw exactly one frame (the next pumped frame) with every renderer on. */
export async function drawFrame(page, dtMs = 1000 / 60) {
  await registerRenderers(page);
  await page.evaluate(`__cap.setDraw(true)`);
  const t0 = Date.now();
  await pump(page, 1, dtMs);
  // Make sure the GPU finished before the compositor grabs the frame.
  await page.evaluate(`(() => { const a = window.__uproot.app; try { const gl = a.d.view.webgl.getContext(); gl.finish(); } catch {} try { if (a.stage) a.stage.gl.getContext().finish(); } catch {} })()`);
  await page.evaluate(`__cap.setDraw(false)`);
  return Date.now() - t0;
}

/** CSS that hides every UI layer (plates): only the 3D canvases stay. */
export const HIDE_UI_CSS = `
#app > *:not(#stage):not(canvas.uh-m3d-canvas) { visibility: hidden !important; }
`;

export async function setUiHidden(page, hidden) {
  await page.evaluate(
    ([css, on]) => {
      let el = document.getElementById('__cap_hide');
      if (on && !el) {
        el = document.createElement('style');
        el.id = '__cap_hide';
        el.textContent = css;
        document.head.appendChild(el);
      } else if (!on && el) el.remove();
    },
    [HIDE_UI_CSS, hidden],
  );
}

export async function screenshot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, timeout: 15 * 60 * 1000, animations: 'allow', caret: 'hide' });
  return file;
}
