#!/usr/bin/env node
/**
 * Steam store capture — reproducible, in-engine, from the REAL game build.
 *
 *   node tools/steam-assets/capture.mjs                 # build + everything (ko + en)
 *   node tools/steam-assets/capture.mjs --only=uproot,steal --frames=shot_ --langs=ko   (jobs / frame prefixes)
 *   node tools/steam-assets/capture.mjs --no-build --dpr=1 --raw=/tmp/x   # quick look
 *   python3 tools/steam-assets/compose.py               # then compose the store art
 *
 * How it works
 *  - `npm run build`, then `vite preview --port 4500 --strictPort` serves exactly what ships;
 *    the game runs with ?autotest=1 (test hooks: window.__uproot) and ?quality=high.
 *    A second Vite dev server (tools/steam-assets/vite.capture.config.mjs, HMR + watch off)
 *    serves tools/steam-assets/pages/models.html for the app-icon model renders.
 *  - lib/clock.js puts rAF / timers / performance.now / CSS animations on a virtual clock, so
 *    every frame is pumped from here: deterministic timing, and the expensive software-GL
 *    draws happen only for the frame that is captured (lib/session.mjs drawFrame()).
 *  - lib/director.js stages the moment inside a real running match: sim.debug teleports (the
 *    dev harness / test API) + real Commands for each character (the autopilot hook for the
 *    human slot, bot.update() for bot slots). Physics, uproot, recovery, police, camera, FX
 *    and HUD are the unmodified game. Every capture is a frame the game itself produces.
 *  - Captures are 2x supersampled (deviceScaleFactor 2; the high preset allows pixel ratio 2)
 *    and saved raw to tools/out/steam-assets/raw/<lang>/; compose.py downsamples them.
 *
 * Outputs (raw): plate_* (no UI: clean in-engine plates), shot_* (with HUD/UI: store
 * screenshots), logo_* (title wordmark from the real title screen, transparent), icon_*
 * (real-model renders for the app icon), manifest.json.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as S from './lib/session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? '1'] : [a, '1'];
  }),
);
const DPR = Number(args.dpr ?? 2);
const LANGS = (args.langs ?? 'ko,en').split(',');
const ONLY = args.only ? args.only.split(',') : null; // job names
const FRAMES = args.frames ? args.frames.split(',') : null; // frame-name prefixes
const RAW = path.resolve(args.raw ?? path.join(ROOT, 'tools/out/steam-assets/raw'));
const PORT = Number(args.port ?? 4500);
const DEV_PORT = Number(args.devPort ?? 4501);
const BUILD = args['no-build'] === undefined;
const EXTERNAL = args.base ?? null; // reuse a running server, e.g. --base=http://127.0.0.1:5191
const SEED = 20261006;
const JOB_TIMEOUT_MS = Number(args.jobTimeout ?? 15) * 60_000;

// ---------------------------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------------------------

const children = [];
function startServer(cmd, argv, url) {
  const p = spawn(cmd, argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(p);
  p.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[server] ${s}`);
  });
  return waitHttp(url);
}
async function waitHttp(url, timeout = 120_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    if (Date.now() - t0 > timeout) throw new Error(`server did not start: ${url}`);
    await S.sleep(300);
  }
}
function stopServers() {
  for (const p of children) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
}
process.on('exit', stopServers);
process.on('SIGINT', () => {
  stopServers();
  process.exit(130);
});

function run(cmd, argv) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${argv.join(' ')} -> ${c}`))));
  });
}

// ---------------------------------------------------------------------------------------------
// Page-side helpers (strings evaluated in the game page)
// ---------------------------------------------------------------------------------------------

const MATCH_PLAYING = `window.__uproot.app.currentMatch && window.__uproot.app.currentMatch.state === 'playing'`;
const APP_STATE = (s) => `document.documentElement.dataset.appState === '${s}'`;

/** Freeze every CSS / Web Animation at a clean pose (end state; loops at phase 0 / twinkle peak). */
const SETTLE_ANIMS = `(() => {
  for (const a of document.getAnimations()) {
    try {
      const t = a.effect.getComputedTiming();
      const delay = Number(t.delay) || 0;
      const dur = Number(t.duration) || 0;
      const name = a.animationName || '';
      a.pause();
      if (Number.isFinite(t.iterations)) a.currentTime = delay + dur * t.iterations;
      else a.currentTime = delay + dur * (2 + (name === 'uh-twinkle' ? 0.5 : 0));
    } catch {}
  }
})()`;

function query(o) {
  const q = new URLSearchParams({ autotest: '1', quality: 'high', fresh: '1', seed: String(SEED), ...o });
  return q.toString();
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

/**
 * Each job opens a fresh game page and saves one or more frames:
 *   shots: [{ name, ui: true|false }] are produced by the job's run(ctx) via ctx.save(name, ui)
 */
const JOBS = [];
const job = (name, spec) => JOBS.push({ name, ...spec });

const ACH_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'steam/achievements.json'), 'utf8')).achievements.map((a) => a.apiName);

/**
 * Wait for the match to be live (and the "출발!" stamp to clear), take over command input and
 * mark achievements as earned so no unlock toast covers a staged screenshot.
 */
async function liveMatch(page, settle = 150, warmSec = 0) {
  await S.pumpUntil(page, MATCH_PLAYING, 3000);
  await S.ev(page, `__dir.quietAchievements(${JSON.stringify(ACH_IDS)})`);
  // Real play first (every slot on its real AI, the human slot on the autotest proxy), so the
  // clock, the scores and the police timers read like a match in progress when the moment is
  // staged — never a whole bank uprooted 4 seconds into a 4:00 match.
  if (warmSec > 0) await S.pump(page, Math.round(warmSec * 60));
  await S.ev(page, `__dir.hijack()`);
  for (let s = 0; s < 4; s++) await S.ev(page, `__dir.set(${s}, __dir.idle())`);
  await S.pump(page, settle);
}

/** Run a staging expression, then let the camera settle on the new spot. */
async function stage(page, expr, settle = 0) {
  const r = await S.ev(page, `(() => { const r = (${expr}); __dir.snapCamera(); return r; })()`);
  if (settle) await S.pump(page, settle);
  return r;
}

// --- title diorama (the real title screen; plates hide the logo UI) ------------------------------
for (const [suffix, w, h] of [
  ['', 1920, 1080],
  ['_tall', 1000, 1500],
  ['_hero', 3840, 1240],
]) {
  job(`title${suffix}`, {
    size: [w, h],
    query: () => ({}),
    async run(c) {
      await S.pumpUntil(c.page, `__uproot.app.stage && __uproot.app.stage.scene && __uproot.app.stage.scene.id === 'title'`, 900);
      const at = (t) => S.pumpUntil(c.page, `Math.abs(__uproot.app.stage.scene.loopT - ${t}) < 0.0045`, 2400, 1000 / 240);
      if (suffix === '') {
        await at(2.7);
        await c.save(`plate_title_strain`, false);
        await at(3.22);
        await c.save(`plate_title_pop`, false);
        await at(4.35);
        await c.save(`plate_title_cheer`, false);
        await S.pump(c.page, 60);
        await c.save(`shot_00_title`, true);
      } else {
        await at(3.22);
        await c.save(`plate_title_pop${suffix}`, false);
        await at(2.7);
        await c.save(`plate_title_strain${suffix}`, false);
      }
    },
  });
}

// --- match start + layout preview diorama (quick match, real bots) -------------------------------
job('start', {
  query: () => ({ flow: 'quick', layout: 'plaza', mode: '2v2', rival: 'tongkeun' }),
  async run(c) {
    await S.pumpUntil(c.page, APP_STATE('preview'), 3000);
    await S.pump(c.page, 100);
    await c.save('shot_09_preview', true);
    await c.save('plate_preview', false);
    await S.pumpUntil(c.page, MATCH_PLAYING, 3000);
    // As the "출발!" stamp clears: both crews sprinting out of the zones toward the first safes.
    await S.pump(c.page, 75);
    await c.save('shot_01_start_a', true);
    await S.pump(c.page, 30);
    await c.save('shot_01_start_b', true);
    await S.pump(c.page, 30);
    await c.save('shot_01_start_c', true);
  },
});

// --- whole-bank uproot (plaza 2v2) ---------------------------------------------------------------
job('uproot', {
  query: () => ({ flow: 'quick', skipIntro: '1', layout: 'plaza', mode: '2v2', rival: 'hodadak' }),
  async run(c) {
    await liveMatch(c.page, 90, 12);
    // The south bank, pulled from its north wall: the bank then sits below the gang on screen and
    // the world-anchored "은행째!" stamp above it lands mid-screen, clear of the top HUD row (on
    // the north bank it slams in under the pills).
    await stage(c.page, "__dir.scenarios.uproot({ bank: 1, side: 'north' })");
    await S.pumpUntil(c.page, `__dir.loot(__dir.banks()[1].id).unanchorProgress >= 0.86`, 900);
    await c.save('plate_uproot_strain', false);
    await S.pumpUntil(c.page, `__dir.hasEvent('unanchored')`, 900);
    await S.pump(c.page, 3);
    await c.save('plate_uproot_pop', false);
    await S.pump(c.page, 7);
    await c.save('plate_uproot_snap', false);
    await S.pump(c.page, 8);
    await c.save('plate_uproot_after', false);
    // The "은행째!" stamp once the HUD pills have settled around it (it slams in over them).
    for (const [k, n] of [['a', 14], ['b', 12], ['c', 14]]) {
      await S.pump(c.page, n);
      await c.save(`shot_02_uproot_${k}`, true);
    }
  },
});

// --- steal the 300 safe out of a moving bank (plaza 2v2) ---------------------------------------
job('steal', {
  query: () => ({ flow: 'quick', skipIntro: '1', layout: 'plaza', mode: '2v2', rival: 'nunchi' }),
  async run(c) {
    await liveMatch(c.page, 90, 34);
    await stage(c.page, '__dir.scenarios.steal()');
    await S.pumpUntil(c.page, `__dir.hasEvent('safeUnloaded')`, 900);
    await S.pump(c.page, 8);
    await c.save('plate_steal', false);
    // The rivals' bank tag drops (예상 1,000 -> 700) while the stamp moves off it.
    for (const [k, n] of [['a', 16], ['b', 20], ['c', 24]]) {
      await S.pump(c.page, n);
      await c.save(`shot_03_steal_${k}`, true);
    }
  },
});

// --- police chase / tackle (counter 1v1) ----------------------------------------------------------
job('police', {
  query: () => ({ flow: 'quick', skipIntro: '1', layout: 'plaza', mode: '2v2', rival: 'hodadak', police: '1' }),
  async run(c) {
    const p = c.page;
    // Real play until the AI's first uproot has called the police (alarm -> car -> officers on
    // their beat around the south bank).
    await liveMatch(p, 60, 24);
    // The player picks up a small safe on the open south boulevard west of the bank and holds
    // still until an officer spots the carrier and comes running; then hauls for the van.
    await S.ev(p, `(() => { const r = __dir.scenarios.police(); window.__pol = r;
      for (let s = 0; s < 4; s++) __dir.set(s, __dir.idle({x: 1, y: 0}));
      const spot = __dir.freeNear({ x: 25, y: 37.5 }, 1.4);
      __dir.tp(r.safeId, spot, 0);
      __dir.tp(__dir.charId(0), { x: spot.x - 0.4 - 0.62, y: spot.y }, 0);
      __dir.set(0, __dir.hold({ x: 0, y: 0 }, { x: 1, y: 0 }));
      __dir.tp(__dir.charId(1), __dir.freeNear({ x: 12, y: 24 }), 0); })()`);
    const near = (d, phases = "o.phase === 'chase'") => `(() => { const me = __dir.sim.state.characters[0]; return __dir.sim.state.police.some(o => (${phases}) && Math.hypot(o.pos.x - me.pos.x, o.pos.y - me.pos.y) < ${d}); })()`;
    await S.pumpUntil(p, near(7.5), 3600);
    await S.ev(p, `(() => { const z = __dir.sim.layout.zones.find(z => z.team === 0);
      __dir.set(0, (s) => { const me = s.state.characters[0];
        // West along the boulevard, then up into the zone: a heavy, nervous haul.
        const goal = me.pos.x > 12 ? { x: 8, y: 37.5 } : z.center;
        const d = { x: goal.x - me.pos.x, y: goal.y - me.pos.y }; const l = Math.hypot(d.x, d.y) || 1;
        return __dir.cmd({ x: d.x / l * 0.45, y: d.y / l * 0.45 }, true, { x: -1, y: 0 }); }); })()`);
    await S.pumpUntil(p, near(4.6), 1800);
    await c.save('shot_04_police_a', true);
    await S.pumpUntil(p, near(3.2), 1800);
    await c.save('plate_police', false);
    await c.save('shot_04_police_b', true);
    try {
      await S.pumpUntil(p, `__dir.sim.state.police.some(o => o.phase === 'tackle')`, 600);
      await S.pump(p, 2);
    } catch {
      S.log('  (police: no lunge within 10 s; the next frames are the chase)');
    }
    await c.save('shot_04_police_c', true);
    await c.save('plate_police_tackle', false);
    await S.pump(p, 14);
    await c.save('shot_04_police_d', true);
  },
});

// --- fence bust (shortcut 2v2) ----------------------------------------------------------------------
job('fence', {
  query: () => ({ flow: 'quick', skipIntro: '1', layout: 'shortcut', mode: '2v2', rival: 'tongkeun' }),
  async run(c) {
    // The game's own AI busts both fences of this layout ~12 s in (bank hauled straight down the
    // short way): stage it at the same point of the match, before they do.
    await liveMatch(c.page, 60, 5);
    await stage(c.page, '__dir.scenarios.fence()');
    await S.pumpUntil(c.page, `__dir.hasEvent('fenceBroken')`, 900);
    await S.pump(c.page, 5);
    await c.save('plate_fence', false);
    for (const [k, n] of [['a', 14], ['b', 16]]) {
      await S.pump(c.page, n);
      await c.save(`shot_05_fence_${k}`, true);
    }
  },
});

// --- final 30 s: both banks home, sirens, the getaway police wave (counter 2v2) ---------------------
job('final', {
  query: () => ({ flow: 'quick', skipIntro: '1', layout: 'plaza', mode: '2v2', rival: 'tongkeun', police: '1' }),
  async run(c) {
    const p = c.page;
    // Short real play: the final countdown resets the clock to 0:30 anyway, and the getaway
    // police wave only rolls in when no earlier wave is still on the field.
    await liveMatch(p, 150, 10);
    // Both banks home: the player waits at the east edge of our zone with a small safe in paw.
    await stage(p, `(() => { __dir.scenarios.final();
      const sim = __dir.sim; const z = sim.layout.zones.find(z => z.team === 0);
      const safe = sim.state.loot.find(l => l.kind === 'smallSafe' && l.homeBank === null && !l.recovered);
      sim.debug.setAnchored(safe.id, false);
      // On the north boulevard, where the getaway wave walks in from its car.
      const spot = __dir.freeNear({ x: 24, y: 12 }, 1.4);
      __dir.tp(safe.id, spot, 0);
      __dir.tp(__dir.charId(0), { x: spot.x + 0.4 + 0.62, y: spot.y }, Math.PI);
      __dir.set(0, __dir.hold({ x: 0, y: 0 }, { x: -1, y: 0 }));
      __dir.tp(__dir.charId(1), __dir.freeNear({ x: z.center.x + 2, y: z.center.y - 3 }), 0);
      __dir.set(1, __dir.idle({ x: 1, y: 0 }));
      window.__fin = { safeId: safe.id };
    })()`);
    await S.pumpUntil(p, `__dir.hasEvent('finalCountdown')`, 900);
    await S.pump(p, 36);
    await c.save('shot_06_final_banner', true);
    // The getaway wave answers the sirens; the player bolts for the van once they close in.
    const near = (d) => `(() => { const me = __dir.sim.state.characters[0]; return __dir.sim.state.police.some(o => (o.phase === 'chase' || o.phase === 'tackle') && Math.hypot(o.pos.x - me.pos.x, o.pos.y - me.pos.y) < ${d}); })()`;
    const soft = async (expr, limit) => {
      try {
        await S.pumpUntil(p, expr, limit);
      } catch {
        S.log('  (final: officers never got that close; capturing anyway)');
      }
    };
    await soft(near(5.5), 1500);
    await S.ev(p, `(() => { const z = __dir.sim.layout.zones.find(z => z.team === 0);
      __dir.set(0, (s) => { const me = s.state.characters[0];
        // West along the boulevard, then down the open west side into the zone.
        const goal = me.pos.y < 16 && me.pos.x > 13 ? { x: 11, y: 13 } : { x: z.center.x - 1, y: z.center.y - 1 };
        const d = { x: goal.x - me.pos.x, y: goal.y - me.pos.y }; const k = Math.hypot(d.x, d.y) || 1;
        return __dir.cmd({ x: d.x / k * 0.8, y: d.y / k * 0.8 }, true, { x: -1, y: 0 }); }); })()`);
    await soft(near(4.2), 600);
    await c.save('shot_06_final_a', true);
    await soft(near(3.0), 300);
    await c.save('plate_final_chase', false);
    await c.save('shot_06_final_b', true);
    await S.pump(p, 12);
    await c.save('shot_06_final_c', true);
  },
});

// --- whole-bank recovery at the van (plaza 2v2) -------------------------------------------------------
job('recover', {
  query: () => ({ flow: 'quick', skipIntro: '1', layout: 'plaza', mode: '2v2', rival: 'hodadak', police: '0' }),
  async run(c) {
    await liveMatch(c.page, 90, 30);
    await stage(c.page, '__dir.scenarios.recover()');
    await S.pumpUntil(c.page, `__dir.hasEvent('recoveryStart')`, 1200);
    await S.pump(c.page, 45);
    await c.save('plate_recover_dwell', false);
    await S.pumpUntil(c.page, `__dir.hasEvent('recovered')`, 1200);
    await S.pump(c.page, 4);
    await c.save('plate_recover', false);
    await S.pump(c.page, 14);
    await c.save('plate_recover_late', false);
    await c.save('shot_10_recover', true);
  },
});

// --- results: a whole real match (2v2 plaza, every slot on its real AI) -------------------------------------
job('results', {
  query: () => ({ flow: 'quick', skipIntro: '1', layout: 'plaza', mode: '2v2', rival: 'hodadak' }),
  async run(c) {
    const p = c.page;
    await S.pumpUntil(p, MATCH_PLAYING, 3000);
    await S.ev(p, `__dir.quietAchievements(${JSON.stringify(ACH_IDS)})`);
    // Nothing staged: the match is played out to the end and the results screen shows its real
    // biggest event (sim.eventLog -> pickBiggestEvent).
    await S.pumpUntil(p, APP_STATE('results'), 60 * 60 * 5);
    for (const [k, n] of [['a', 60 * 4], ['b', 60 * 2]]) {
      await S.pump(p, n);
      await c.save(`shot_07_results_${k}`, true);
    }
  },
});

// --- rival tournament: ladder + intermission with the rival's counter line ---------------------------------
job('rival', {
  query: () => ({ flow: 'tournament', police: '0' }),
  async run(c) {
    const p = c.page;
    await S.pumpUntil(p, APP_STATE('tournament'), 1200);
    // Progress as after beating 호다닥: 통큰이 is next (the save is in-memory: ?fresh=1).
    await S.ev(p, `(() => { const d = window.__uproot.save(); d.tournament.beaten = ['hodadak']; d.cosmetics.unlocked.includes('hodadakBand') || d.cosmetics.unlocked.push('hodadakBand'); window.__uproot.app.toTournament('tongkeun'); })()`);
    await S.pump(p, 150);
    await c.save('shot_08b_ladder', true);
    await c.save('plate_rival_ladder', false);
    // Game 1 of the series, played out for real; the intermission then shows 통큰이's answer to
    // what the player actually did.
    await S.ev(p, `window.__uproot.app.startTournamentGame('tongkeun', false)`);
    await S.pumpUntil(p, MATCH_PLAYING, 3000);
    await S.pumpUntil(p, APP_STATE('results'), 60 * 60 * 5);
    await S.pump(p, 200);
    await S.ev(p, `window.__uproot.nav({ confirm: true })`);
    await S.pumpUntil(p, APP_STATE('intermission'), 1200);
    await S.pump(p, 60 * 4);
    await c.save('shot_08_rival_a', true);
    await S.pump(p, 60);
    await c.save('shot_08_rival_b', true);
    await c.save('plate_rival_stage', false);
  },
});

// --- the title wordmark (real title screen DOM + CSS + fonts), transparent ---------------------------------
const TILT = [-7, 4, -3, 6, -5, 3];
job('logo', {
  size: [1920, 1080],
  dpr: 4,
  langs: ['ko'],
  query: () => ({ quality: 'low' }),
  async run(c) {
    const p = c.page;
    await S.pumpUntil(p, `document.querySelector('.uh-logo')`, 900);
    await S.pump(p, 60 * 4);
    await p.evaluate(() => {
      const st = document.createElement('style');
      st.id = '__cap_logo';
      st.textContent = `html,body,#app{background:transparent!important} #stage,canvas{display:none!important}
        #app *{visibility:hidden!important} #app .uh-logo, #app .uh-logo *{visibility:visible!important}
        body.__nospark #app .uh-logo__spark, body.__nospark #app .uh-logo__spark *{visibility:hidden!important}`;
      document.head.appendChild(st);
    });
    const shoot = async (name, sparks) => {
      await p.evaluate((on) => document.body.classList.toggle('__nospark', !on), sparks);
      await p.evaluate(SETTLE_ANIMS);
      await S.pump(p, 1);
      const bb = await (await p.$('.uh-logo')).boundingBox();
      const pad = 160;
      const file = path.join(c.rawDir, `${name}.png`);
      await p.screenshot({ path: file, omitBackground: true, clip: { x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - 60), width: Math.min(1920, bb.width + pad * 2), height: Math.min(1080, bb.height + 200) } });
      c.record(name, { ui: true, file });
    };
    await shoot('logo_ko', false);
    await shoot('logo_ko_sparks', true);
    // English-first lockup: the same TitleScreen structure, classes, font and roots art with the
    // English title in the big chunky lines and the Korean title on the ribbon.
    await p.evaluate((tilt) => {
      const logo = document.querySelector('.uh-logo');
      logo.classList.remove('uh-logo--short');
      const words = logo.querySelectorAll('.uh-logo__word');
      const fill = (el, text, seed) => {
        el.textContent = '';
        Array.from(text).forEach((ch, i) => {
          const s = document.createElement('span');
          s.className = 'uh-logo__char';
          s.style.setProperty('--tilt', `${tilt[(i + seed) % tilt.length]}deg`);
          s.style.setProperty('--k', String(i));
          // A hair of air between the chunky Latin capitals (their ink drop shadows touch).
          s.style.marginInline = seed ? '0.035em' : '0.01em';
          s.textContent = ch;
          el.appendChild(s);
        });
      };
      fill(words[0], 'UPROOT', 0);
      fill(words[1], 'HEIST', 3);
      // The two lines keep the title's stagger, a little narrower (Latin lines are wider than
      // the Korean ones; the stock offsets would push HEIST off the ribbon's axis).
      logo.querySelector('.uh-logo__line--a').style.translate = '-2.75rem 0';
      logo.querySelector('.uh-logo__line--b').style.translate = '3.25rem 0';
      const rib = logo.querySelector('.uh-logo__ribbon');
      rib.style.letterSpacing = '0.16em';
      const span = rib.querySelector('span');
      span.textContent = '뿌리째 털어라';
      span.style.marginRight = '-0.16em';
      logo.setAttribute('aria-label', 'Uproot Heist');
    }, TILT);
    await S.pump(p, 2);
    await shoot('logo_en', false);
    await shoot('logo_en_sparks', true);
  },
});

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

const manifest = { generated: new Date().toISOString(), dpr: DPR, seed: SEED, frames: {} };

/** True when a saved frame is mostly the dark clear colour (the world did not draw). */
async function looksBlank(page, file) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const w = 192;
    const h = Math.round((img.height / img.width) * w);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 120) dark++;
    return dark / (w * h) > 0.35;
  }, b64);
}

async function runJob(browser, base, j, lang) {
  const [w, h] = j.size ?? [1920, 1080];
  const dpr = j.dpr ?? DPR;
  const rawDir = path.join(RAW, lang);
  fs.mkdirSync(rawDir, { recursive: true });
  const q = query({ lang, ...j.query(lang) });
  S.log(`job ${j.name} [${lang}] ${w}x${h}@${dpr}  ?${q}`);
  const { ctx, page, problems } = await S.openGame(browser, { base, query: q, width: w, height: h, dpr });
  await S.takeControl(page);
  const c = {
    page,
    primed: false,
    lang,
    rawDir,
    record(name, info) {
      manifest.frames[`${lang}/${name}`] = { ...info, file: path.relative(ROOT, info.file), size: [w, h], dpr, job: j.name };
    },
    async save(name, ui) {
      if (FRAMES && !FRAMES.some((o) => name.startsWith(o))) return;
      await S.setUiHidden(page, !ui);
      if (!c.primed) {
        // The very first frame drawn in a page after a long draw-less stretch can come out
        // without the world (seen on the police wave): draw in place and grab one throwaway
        // frame first. No game time passes.
        c.primed = true;
        await S.warmUp(page);
        await S.warmUp(page);
        await page.screenshot({ timeout: 15 * 60 * 1000 });
      }
      const ms = await S.drawFrame(page);
      const file = path.join(rawDir, `${name}.png`);
      await S.screenshot(page, file);
      // Software GL under load sometimes presents a frame without the world (dark, flat). Check
      // the saved image and redraw the same state in place (no game time passes) until it is whole.
      for (let attempt = 0; attempt < 4 && (await looksBlank(page, file)); attempt++) {
        S.log(`  ${name}: blank world in the presented frame, redrawing in place (${attempt + 1})`);
        await S.warmUp(page);
        await S.warmUp(page);
        await page.evaluate(`__cap.setDraw(false)`);
        await page.evaluate(`__cap.realFrames(4)`);
        await S.screenshot(page, file);
      }
      await S.setUiHidden(page, false);
      const state = await page.evaluate(`(() => { try { return window.__dir.match ? window.__dir.state() : null; } catch { return null; } })()`);
      c.record(name, { ui, drawMs: ms, file, state });
      S.log(`  saved ${lang}/${name} (draw ${ms} ms)`);
    },
  };
  try {
    await j.run(c);
  } finally {
    if (problems.length) S.log(`  console problems: ${problems.slice(0, 5).join(' | ')}`);
    await ctx.close();
  }
}

async function main() {
  let base = EXTERNAL;
  if (!base) {
    if (BUILD) await run('npm', ['run', 'build']);
    base = `http://127.0.0.1:${PORT}`;
    await startServer('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], `${base}/`);
  }
  // A fresh browser per job: a software-GL GPU process that just drew a 7680 px frame is better
  // not reused (it can stall), and every job starts from the same clean state.
  const launch = () => chromium.launch({ args: S.GL_ARGS });
  let browser = await launch();
  try {
    const wanted = (j) => !ONLY || ONLY.includes(j.name);
    for (const j of JOBS) {
      if (!wanted(j)) continue;
      for (const lang of j.langs ?? LANGS) {
        await browser.close().catch(() => undefined);
        browser = await launch();
        let timer;
        try {
          const guard = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`timeout after ${JOB_TIMEOUT_MS / 60000} min`)), JOB_TIMEOUT_MS)));
          await Promise.race([runJob(browser, base, j, lang), guard]);
        } catch (err) {
          S.log(`!! job ${j.name} [${lang}] failed: ${err && err.stack ? err.stack : err}`);
          manifest.failed = [...(manifest.failed ?? []), `${j.name}/${lang}: ${String(err && err.message)}`];
        } finally {
          clearTimeout(timer);
        }
      }
    }
    if (!ONLY || ONLY.includes('icon') || ONLY.includes('keyart')) {
      await browser.close().catch(() => undefined);
      browser = await launch();
      await modelRenders(browser, { icons: !ONLY || ONLY.includes('icon'), keyart: !ONLY || ONLY.includes('keyart') });
    }
  } finally {
    await browser.close();
    const mf = path.join(RAW, 'manifest.json');
    let prev = {};
    try {
      prev = JSON.parse(fs.readFileSync(mf, 'utf8'));
    } catch {
      /* first run */
    }
    fs.writeFileSync(mf, JSON.stringify({ ...prev, ...manifest, frames: { ...(prev.frames ?? {}), ...manifest.frames } }, null, 2));
    stopServers();
  }
  if (manifest.failed?.length) {
    S.log(`FAILED: ${manifest.failed.join('\n')}`);
    process.exitCode = 1;
  }
}

/**
 * Capsule key art: the real title diorama (TitleScene) at the heave just before the pop, re-lit
 * for night with the game's own sky dome (docs/STEAM_RELEASE.md: night-sky indigo + gold bank),
 * one framing per capsule shape so the logo always has open sky. Sizes are the Steam sizes;
 * renders are KEYART_SCALE x larger (supersampled) and compose.py scales them down.
 */
const KEYART_SCALE = Number(args.keyartScale ?? 2);
const KEYART_LIGHT = { hemi: ['#8C86E6', '#5E4C8E', 0.9], sun: ['#FFC468', 3.8], fill: ['#7F93FF', 1.0] };
const KEYART = {
  // shift: lens shift as a fraction of the frame (+x moves the subject right, +y moves it down).
  header: { size: [920, 430], cam: [-2.0, 3.6, 9.5], look: [-0.2, 2.4, -1.5], fov: 42, shift: [0.24, 0.03] },
  small: { size: [462, 174], cam: [-2.0, 3.6, 8.0], look: [-0.8, 2.0, -1.0], fov: 38, shift: [0.4, 0.02] },
  main: { size: [1232, 706], cam: [-2.0, 3.6, 9.5], look: [-0.2, 2.4, -1.5], fov: 44, shift: [0.2, 0.07] },
  vertical: { size: [748, 896], cam: [-2.0, 3.6, 10.5], look: [-0.6, 2.4, -1.5], fov: 56, shift: [0.16, 0.16] },
  library: { size: [600, 900], cam: [-2.0, 3.6, 10.5], look: [-0.6, 2.4, -1.5], fov: 60, shift: [0.18, 0.18] },
  hero: { size: [3840, 1240], cam: [-2.4, 3.8, 12.5], look: [-0.2, 2.4, -1.5], fov: 28, shift: [0.22, 0.03], scale: 1.5 },
  page: { size: [1438, 810], cam: [-2.0, 3.6, 9.5], look: [-0.2, 2.4, -1.5], fov: 44, shift: [0.2, 0.07] },
};
const KEYART_ONLY = args.keyartOnly ? args.keyartOnly.split(',') : null;

/** Real-model renders: app icon figures and the capsule key art (pages/models.ts, dev server). */
async function modelRenders(browser, want) {
  const dev = args.devBase ?? `http://127.0.0.1:${DEV_PORT}`;
  if (!args.devBase) await startServer('npx', ['vite', '--config', 'tools/steam-assets/vite.capture.config.mjs', '--port', String(DEV_PORT), '--strictPort'], `${dev}/tools/steam-assets/pages/models.html`);
  const page = await browser.newPage();
  await page.goto(`${dev}/tools/steam-assets/pages/models.html`);
  await S.waitFor(page, 'window.__models && window.__models.ready', 180_000);
  if (want.keyart) {
    const kdir = path.join(RAW, 'keyart');
    fs.mkdirSync(kdir, { recursive: true });
    for (const [name, k] of Object.entries(KEYART)) {
      if (KEYART_ONLY && !KEYART_ONLY.includes(name)) continue;
      const sc = k.scale ? Math.min(KEYART_SCALE, k.scale) : KEYART_SCALE;
      const spec = { w: Math.round(k.size[0] * sc), h: Math.round(k.size[1] * sc), t: 3.05, cam: k.cam, look: k.look, fov: k.fov, shift: k.shift, light: KEYART_LIGHT };
      const t0 = Date.now();
      const url = await page.evaluate((s) => window.__models.keyArt(s), spec);
      const file = path.join(kdir, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      manifest.frames[`keyart/${name}`] = { file: path.relative(ROOT, file), spec, size: k.size };
      S.log(`  saved keyart/${name} ${spec.w}x${spec.h} (${Date.now() - t0} ms)`);
    }
  }
  if (!want.icons) {
    await page.close();
    return;
  }
  const dir = path.join(RAW, 'icon');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, spec] of [
    // No hat: the raccoon's own black eye mask and the ringed tail (turned a little so it shows).
    ['icon_full', { shot: 'icon', size: 2048, hat: 'none', yaw: 0.35 }],
    ['icon_head', { shot: 'head', size: 1024, hat: 'none' }],
  ]) {
    const url = await page.evaluate((s) => window.__models.render(s), spec);
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    manifest.frames[`icon/${name}`] = { file: path.relative(ROOT, file), spec };
    S.log(`  saved icon/${name}`);
  }
  await page.close();
}

await main();
