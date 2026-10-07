/**
 * UI gallery (dev only): renders every screen and the HUD with mock data.
 *
 *   npx vite --port 5181 --strictPort  ->  http://127.0.0.1:5181/dev/ui-gallery.html#menu?lang=en
 *
 * Hash: `#<route>?lang=ko|en&scale=0.8..1.4&rm=1` (rm = reduced motion). Arrow keys / WASD,
 * Enter, Esc, Q/E drive MenuNav; the mouse works everywhere. `L` toggles language.
 * Sets `document.body.dataset.ready = '1'` when the route has rendered (for screenshots).
 */
import type { LayoutDef, LayoutId } from '../../sim/types';
import {
  Backdrop,
  ConfirmDialog,
  Hud,
  LayoutPreview,
  LoadingScreen,
  MainMenu,
  PauseMenu,
  QuickMatchSetup,
  ResultsScreen,
  SeriesIntermission,
  SettingsScreen,
  TitleScreen,
  Toasts,
  TournamentScreen,
  WardrobeScreen,
  attachKeyboardNav,
  createUiRoot,
  fontsReady,
  getLanguage,
  hasKey,
  setLanguage,
  type BindingRow,
  type MainMenuItem,
  type QuickLayoutChoice,
  type UiRoot,
  type UiSettings,
} from '../index';
import { mockHudModel, mockLabels, mockMinimap, mockPlazaLayout, mockTutorialLayout } from './mockData';
// Dev only: the platform's real (pure, DOM-free) binding rules, so the controls tab shows the
// same conflict swaps the game will make.
import { MATCH_ACTIONS, assignBinding, defaultBindings, type Bindings, type MatchAction } from '../../platform/bindings';
import { drawBackground, drawBank, drawLayoutBase, drawSafe, fitTransform, setupCanvas, bankInteriorWorld } from '../hud/mapDraw';

// ---------------------------------------------------------------------------------------------

interface Params {
  route: string;
  lang: 'ko' | 'en';
  scale: number;
  rm: boolean;
}

function parseHash(): Params {
  const raw = location.hash.replace(/^#/, '');
  const [route, query = ''] = raw.split('?');
  const q = new URLSearchParams(query);
  return {
    route: route || 'index',
    lang: q.get('lang') === 'en' ? 'en' : 'ko',
    scale: Number(q.get('scale') ?? '1') || 1,
    rm: q.get('rm') === '1',
  };
}

function go(route: string): void {
  const p = parseHash();
  location.hash = `${route}?lang=${getLanguage()}&scale=${p.scale}${p.rm ? '&rm=1' : ''}`;
}

/** Try the real layouts module (owned by the layout engineer); fall back to mocks. */
async function loadLayouts(): Promise<Partial<Record<LayoutId, LayoutDef>>> {
  const out: Partial<Record<LayoutId, LayoutDef>> = {};
  const mods = import.meta.glob('../../sim/layouts/index.ts');
  const isLayout = (v: unknown): v is LayoutDef =>
    !!v && typeof v === 'object' && 'size' in v && 'statics' in v && 'zones' in v && 'banks' in v;
  for (const load of Object.values(mods)) {
    try {
      const mod = (await load()) as Record<string, unknown>;
      const visit = (v: unknown, depth: number): void => {
        if (depth > 2 || !v) return;
        if (typeof v === 'function' && depth === 0) return;
        if (isLayout(v)) {
          out[v.id] = v;
          return;
        }
        if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
        else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => visit(x, depth + 1));
      };
      Object.values(mod).forEach((v) => visit(v, 0));
    } catch (err) {
      console.warn('[gallery] real layouts unavailable, using mocks', err);
    }
  }
  if (!out.plaza) out.plaza = mockPlazaLayout();
  if (!out.tutorial) out.tutorial = mockTutorialLayout();
  return out;
}

/** Primary binding per action, as the platform's InputManager.bindingRows() reports it. */
function rowsOf(b: Bindings): BindingRow[] {
  return MATCH_ACTIONS.map((action) => ({ action, keyboard: b.keyboard[action][0] ?? null, gamepad: b.gamepad[action][0] ?? null }));
}
let galleryBindings: Bindings = defaultBindings();

function devLog(msg: string): void {
  console.info(`[gallery] ${msg}`);
  const el = document.getElementById('dev-log');
  if (el) {
    el.textContent = msg;
    el.classList.add('is-on');
    window.setTimeout(() => el.classList.remove('is-on'), 1400);
  }
}

// ---------------------------------------------------------------------------------------------
// Fake 3D-ish scene behind the HUD (dev only)
// ---------------------------------------------------------------------------------------------

function fakeScene(layout: LayoutDef): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dev-scene';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  requestAnimationFrame(() => {
    const w = wrap.clientWidth;
    const hh = wrap.clientHeight;
    const ctx = setupCanvas(canvas, w, hh);
    if (!ctx) return;
    drawBackground(ctx, w, hh, 'paper', 0);
    const tf = fitTransform(layout.size, w, hh, 0);
    drawLayoutBase(ctx, layout, tf, { theme: 'paper' });
    for (const b of layout.banks) {
      drawBank(ctx, tf, b.pos, b.angle, { theme: 'paper', doorArrows: true });
      for (const s of bankInteriorWorld(b.pos, b.angle)) drawSafe(ctx, tf, s.kind, s.pos, s.angle, { theme: 'paper' });
    }
    for (const s of layout.safes) drawSafe(ctx, tf, s.kind, s.pos, s.angle, { theme: 'paper' });
  });
  return wrap;
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

const ROUTES = [
  'title',
  'menu',
  'quick',
  'quick-random',
  'preview',
  'tournament',
  'tournament-complete',
  'intermission',
  'intermission-none',
  'wardrobe',
  'settings-game',
  'settings-controls',
  'settings-controls-clash',
  'settings-audio',
  'settings-display',
  'pause',
  'results-win',
  'results-lose',
  'results-draw',
  'results-series',
  'confirm',
  'loading',
  'toasts',
  'hud',
  'hud-final',
  'hud-bank',
  'hud-police',
  'hud-alarm',
  'hud-stamps',
  'hud-practice',
  'perf',
] as const;

async function main(): Promise<void> {
  const p = parseHash();
  setLanguage(p.lang);
  const app = document.getElementById('app')!;
  const root: UiRoot = createUiRoot(app);
  root.setUiScale(p.scale);
  root.setReducedMotion(p.rm);
  attachKeyboardNav();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyL' && !e.repeat) {
      setLanguage(getLanguage() === 'ko' ? 'en' : 'ko');
      const q = parseHash();
      history.replaceState(null, '', `#${q.route}?lang=${getLanguage()}&scale=${q.scale}${q.rm ? '&rm=1' : ''}`);
    }
  });
  window.addEventListener('hashchange', () => location.reload());

  const layouts = await loadLayouts();
  const plaza = layouts.plaza!;
  const layoutChoices: QuickLayoutChoice[] = (['plaza', 'shortcut', 'counter'] as const).map((id) => ({
    id,
    nameKey: layouts[id]?.nameKey ?? `layout.${id}.name`,
    descKey: layouts[id]?.descKey ?? `layout.${id}.desc`,
    layout: layouts[id] ?? (id === 'plaza' ? plaza : null),
  }));

  const backdrop = new Backdrop().mount(root.layer('backdrop'));
  const route = p.route;
  if (!route.startsWith('hud') && route !== 'perf' && route !== 'pause') backdrop.show();
  else backdrop.hide();

  const settings: UiSettings = {
    language: getLanguage(),
    grabMode: 'hold',
    showTutorialHints: true,
    volumes: { master: 0.8, music: 0.6, sfx: 0.9, ui: 0.5 },
    subtitles: true,
    fullscreen: true,
    quality: 'high',
    screenShake: 0.7,
    reducedMotion: p.rm,
    uiScale: p.scale,
    vibration: true,
  };
  const choke = hasKey('choke.northAlley') ? 'choke.northAlley' : getLanguage() === 'ko' ? '북쪽 골목' : 'North Alley';

  switch (route) {
    case 'index': {
      backdrop.hide();
      const list = document.createElement('div');
      list.className = 'dev-index';
      list.innerHTML = `<h1>UI gallery</h1><p>Arrow keys / WASD, Enter, Esc, Q/E · L toggles language</p>`;
      for (const r of ROUTES) {
        const row = document.createElement('div');
        row.innerHTML = `<b>${r}</b> <a href="#${r}?lang=ko">ko</a> <a href="#${r}?lang=en">en</a> <a href="#${r}?lang=ko&scale=1.4">ko@1.4</a> <a href="#${r}?lang=en&rm=1">en rm</a>`;
        list.appendChild(row);
      }
      document.body.appendChild(list);
      break;
    }
    case 'title':
      new TitleScreen({ version: '0.5.0', onStart: () => window.setTimeout(() => go('menu'), 350) }).show();
      break;
    case 'menu': {
      const routeOf: Record<MainMenuItem, string> = {
        practice: 'hud-practice',
        quickMatch: 'quick',
        tournament: 'tournament',
        wardrobe: 'wardrobe',
        settings: 'settings-game',
        quit: 'confirm',
        play: 'preview',
        credits: 'index',
        goal: 'tournament',
      };
      new MainMenu({
        hat: 'teamCapA',
        team: 0,
        badges: { tournament: { key: 'tournament.round', params: { n: 2 } }, wardrobe: 'common.new' },
        onSelect: (item) => go(routeOf[item]),
        onBack: () => go('title'),
      }).show();
      break;
    }
    case 'quick':
    case 'quick-random':
      new QuickMatchSetup({
        layouts: layoutChoices,
        value:
          route === 'quick'
            ? { mode: /[?&]mode=2v2/.test(location.hash) ? '2v2' : '1v1', layout: 'plaza', rival: 'tongkeun', difficulty: 'normal' }
            : { mode: '2v2', layout: 'random', rival: 'random', difficulty: 'challenge' },
        onChange: (v) => devLog(`onChange ${JSON.stringify(v)}`),
        onStart: (v) => {
          devLog(`onStart ${JSON.stringify(v)}`);
          go('preview');
        },
        onBack: () => go('menu'),
      }).show();
      break;
    case 'preview': {
      const pv = new LayoutPreview({
        layout: plaza,
        context: 'mode.quickMatch',
        myTeam: 0,
        teams: [
          { members: [{ name: 'name.you', isYou: true, hat: 'teamCapA' }, { name: 'name.ally', hat: 'teamCapA' }] },
          { members: [{ name: 'rival.hodadak.name', rival: 'hodadak' }, { name: 'rival.hodadak.name', rival: 'hodadak' }] },
        ],
        holdMs: 0,
        onDone: () => go('hud'),
      }).show();
      if (location.search.includes('count') || location.hash.includes('count=1')) pv.startCountdown();
      else pv.setCountdown(2);
      break;
    }
    case 'tournament':
    case 'tournament-complete': {
      const done = route === 'tournament-complete';
      new TournamentScreen({
        complete: done,
        rivals: [
          { rival: 'hodadak', state: 'cleared', playerWins: 2, rivalWins: 1, layoutNameKey: 'layout.plaza.name', rewardHat: 'hodadakBand', rewardOwned: true },
          { rival: 'tongkeun', state: done ? 'cleared' : 'inProgress', playerWins: done ? 2 : 1, rivalWins: done ? 0 : 1, layoutNameKey: 'layout.shortcut.name', rewardHat: 'tongkeunHat', rewardOwned: done },
          { rival: 'nunchi', state: done ? 'cleared' : 'locked', playerWins: done ? 2 : 0, rivalWins: done ? 1 : 0, layoutNameKey: 'layout.counter.name', rewardHat: 'nunchiMask', rewardOwned: done },
        ],
        onSelect: (r) => {
          devLog(`onSelect ${r}`);
          go('intermission');
        },
        onBack: () => go('menu'),
      }).show();
      break;
    }
    case 'intermission':
    case 'intermission-none':
      new SeriesIntermission({
        rival: 'tongkeun',
        gameNumber: 2,
        playerWins: 1,
        rivalWins: 0,
        layoutNameKey: 'layout.shortcut.name',
        adaptation:
          route === 'intermission'
            ? { kind: 'stripBank', line: { key: 'adapt.tongkeun.stripBank.2' } }
            : null,
        onContinue: () => go('preview'),
        onQuit: () => go('tournament'),
      }).show();
      break;
    case 'wardrobe':
      new WardrobeScreen({
        hats: [
          { id: 'none', unlocked: true },
          { id: 'teamCapA', unlocked: true },
          { id: 'teamCapB', unlocked: true },
          { id: 'hodadakBand', unlocked: true, isNew: true },
          { id: 'tongkeunHat', unlocked: false },
          { id: 'nunchiMask', unlocked: false },
        ],
        equipped: 'teamCapA',
        team: 0,
        onEquip: (hat) => devLog(`onEquip ${hat}`),
        onBack: () => go('menu'),
      }).show();
      break;
    case 'settings-game':
    case 'settings-controls':
    case 'settings-controls-clash':
    case 'settings-audio':
    case 'settings-display': {
      const tab = (route === 'settings-controls-clash' ? 'controls' : route.replace('settings-', '')) as 'game' | 'controls' | 'audio' | 'display';
      // The clash route shows a legacy/broken table (same key on two actions) as the screen flags it.
      const rows = rowsOf(galleryBindings);
      if (route === 'settings-controls-clash') rows[6] = { ...rows[6], keyboard: rows[4].keyboard };
      new SettingsScreen({
        settings,
        bindings: rows,
        tab,
        onChange: (k, v) => {
          devLog(`onChange ${String(k)} = ${JSON.stringify(v)}`);
          if (k === 'language') setLanguage(v as 'ko' | 'en');
          if (k === 'uiScale') root.setUiScale(v as number);
          if (k === 'reducedMotion') root.setReducedMotion(v as boolean);
        },
        // Same contract game flow uses: capture, apply with the platform rules, return the table.
        onRebind: (action, device) =>
          new Promise((resolve) => {
            devLog(`capture ${action} (${device}) — press a key, Esc cancels`);
            const onKey = (e: KeyboardEvent): void => {
              // The captured key must not leak into menu navigation (the platform suppresses
              // it the same way): E would otherwise also switch the settings tab.
              e.preventDefault();
              e.stopImmediatePropagation();
              window.removeEventListener('keydown', onKey, true);
              if (e.code === 'Escape') return resolve(null);
              // Gamepad capture in the gallery: digits pick a pad button ('3' -> button:3).
              const code = device === 'keyboard' ? e.code : `button:${/^Digit(\d)$/.exec(e.code)?.[1] ?? '3'}`;
              const res = assignBinding(galleryBindings, action as MatchAction, device, code);
              if (!res.ok) return resolve(null);
              galleryBindings = res.bindings;
              devLog(`bound ${code}; swaps: ${JSON.stringify(res.swaps)}`);
              resolve({ bindings: rowsOf(galleryBindings) });
            };
            window.addEventListener('keydown', onKey, true);
          }),
        onResetBindings: () => {
          galleryBindings = defaultBindings();
          return rowsOf(galleryBindings);
        },
        onBack: () => go('menu'),
      }).show();
      break;
    }
    case 'pause': {
      document.body.appendChild(fakeScene(plaza));
      new PauseMenu({
        context: { text: `${getLanguage() === 'ko' ? '빠른 대전' : 'Quick Match'} · ${getLanguage() === 'ko' ? '수집 광장' : 'Collector Plaza'}` },
        onResume: () => devLog('onResume'),
        onSettings: () => go('settings-game'),
        onRestart: () => devLog('onRestart'),
        onMenu: () => go('menu'),
      }).show();
      break;
    }
    case 'results-win':
    case 'results-lose':
    case 'results-draw':
    case 'results-series': {
      const outcome = route === 'results-lose' ? 'lose' : route === 'results-draw' ? 'draw' : 'win';
      const series = route === 'results-series';
      new ResultsScreen({
        outcome,
        myTeam: 0,
        scores: outcome === 'win' ? [1700, 1200] : outcome === 'lose' ? [900, 1500] : [1300, 1300],
        reason: outcome === 'win' ? 'time' : outcome === 'lose' ? 'decided' : 'time',
        biggestEvent:
          outcome === 'win'
            ? { text: { key: 'event.bankWhole', params: { building: 500, safes: 500, total: 1000 } }, team: 0, kind: 'bank' }
            : outcome === 'lose'
              ? { text: { key: 'event.largePulled', params: { value: 300 } }, team: 1, kind: 'largeSafe' }
              : { text: { key: 'event.lastSecondsSmall', params: { sec: 12 } }, team: 1, kind: 'smallSafe' },
        series: series ? { rival: 'hodadak', playerWins: 2, rivalWins: 1, gameNumber: 3, state: 'won' } : null,
        reward: series ? { hat: 'hodadakBand' } : null,
        teamLabels: series ? [null, 'rival.hodadak.name'] : undefined,
        actions: series ? { rematch: false, next: true } : { rematch: true, next: false },
        playerHat: 'teamCapA',
        onRematch: () => devLog('onRematch'),
        onNext: () => devLog('onNext'),
        onMenu: () => go('menu'),
      }).show();
      break;
    }
    case 'confirm': {
      new MainMenu({ onSelect: () => undefined, initialFocus: 'quit' }).show();
      const dlg: ConfirmDialog = new ConfirmDialog({
        titleKey: 'menu.quitConfirm.title',
        bodyKey: 'menu.quitConfirm.body',
        confirmKey: 'menu.quitConfirm.ok',
        danger: true,
        onConfirm: () => devLog('onConfirm'),
        onCancel: () => {
          dlg.destroy();
          devLog('onCancel');
        },
      });
      dlg.show();
      break;
    }
    case 'loading': {
      const ls = new LoadingScreen({ progress: 0.62, tip: 3, tipIntervalMs: 0 }).show();
      void ls;
      break;
    }
    case 'toasts': {
      new MainMenu({ onSelect: () => undefined }).show();
      const toasts = new Toasts(root.layer('toasts'));
      // Long-lived so screenshots catch them even when the page is slow to settle.
      toasts.achievement('BANK_WHOLE', 60000);
      toasts.hatUnlocked('tongkeunHat', 60000);
      toasts.achievement('FENCE_BREAKER', 60000);
      break;
    }
    case 'hud':
    case 'hud-final':
    case 'hud-bank':
    case 'hud-police':
    case 'hud-alarm':
    case 'hud-stamps':
    case 'hud-practice': {
      const police = route === 'hud-police' || route === 'hud-alarm';
      const variant = route === 'hud' || police || route === 'hud-stamps' ? 'match' : (route.replace('hud-', '') as 'final' | 'bank' | 'practice');
      const L = variant === 'practice' ? layouts.tutorial! : plaza;
      document.body.appendChild(fakeScene(L));
      const hud = new Hud(root);
      hud.setLayout(L);
      if (variant !== 'practice') hud.setTeamLabels([null, 'rival.hodadak.name']);
      hud.show();
      const model = mockHudModel(L, variant);
      const w = root.el.clientWidth;
      const hh = root.el.clientHeight;
      model.labels = mockLabels(w, hh, variant);
      model.arrows = [
        { id: 'zone', x: -300, y: hh * 0.55, kind: 'zone', team: 0 },
        { id: 'ping', x: w + 200, y: hh * 0.2, kind: 'bank', team: 0, value: 1000 },
      ];
      hud.setTeamFaces(variant === 'practice' ? null : [{ hat: 'teamCapA' }, { rival: 'hodadak' }]);
      if (route === 'hud-alarm') model.police = { dispatchInSec: 7.4, officers: 0, alarms: 1 };
      if (route === 'hud-police') model.police = { dispatchInSec: null, officers: 2, alarms: 1 };
      hud.update(model);
      if (route === 'hud-police') {
        hud.banner('policeArrived', undefined, 60000);
        hud.caption('caption.policeSiren', { side: 'left' });
      } else if (route === 'hud-alarm') {
        hud.banner('policeDispatched', undefined, 60000);
      } else if (route === 'hud-stamps') {
        hud.stamp('bankWhole', { team: 0, durationMs: 60000 });
        hud.stamp('steal', { team: 1, x: w * 0.7, y: hh * 0.55, durationMs: 60000 });
      } else if (variant === 'match') {
        hud.caption('caption.unanchorBank', { side: 'right' });
        hud.caption('caption.dashHit');
        hud.popScore({ team: 0, kind: 'largeSafe', value: 300 });
      } else if (variant === 'final') {
        hud.banner('escape', { sec: 30 }, 60000);
        hud.caption('caption.siren');
      } else if (variant === 'bank') {
        hud.popScore({ team: 1, kind: 'bank', value: 1000, building: 500, safes: 500, x: w * 0.72, y: hh * 0.5 });
        hud.caption('caption.fenceBreak', { side: 'left' });
      } else {
        hud.setTutorialPrompt({ text: 'tutorial.uproot', sub: 'tutorial.uproot.sub', actions: ['grab', 'move'], step: 4, total: 7, skipAction: 'pause' });
        hud.caption('caption.strain');
      }
      // Keep the minimap alive (animated mock) for interactive viewing.
      if (variant !== 'practice') {
        const tick = (): void => {
          model.minimap = mockMinimap(L, performance.now());
          if (police && model.minimap) {
            const t = performance.now() / 1000;
            model.minimap.police = [
              { id: 900, x: 30 + Math.sin(t) * 3, y: 20, hunting: true },
              { id: 901, x: 44, y: 34 + Math.cos(t) * 2, stunned: true },
            ];
            model.minimap.policeCars = [{ id: 1, x: 6, y: 4, angle: 0.4, siren: true }];
          }
          hud.update(model);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
      break;
    }
    case 'perf':
      await runPerf(root, plaza);
      break;
    default:
      devLog(`unknown route ${route}`);
  }
  await fontsReady();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.body.dataset.ready = '1';
}

/** HUD update cost benchmark (reported in the page and on window.__perf). */
async function runPerf(root: UiRoot, layout: LayoutDef): Promise<void> {
  document.body.appendChild(fakeScene(layout));
  const hud = new Hud(root);
  hud.setLayout(layout);
  hud.show();
  const w = root.el.clientWidth;
  const hh = root.el.clientHeight;
  const model = mockHudModel(layout, 'match');
  const baseLabels = mockLabels(w, hh, 'bank');
  // 20 moving labels
  const extra = Array.from({ length: 12 }, (_, i) => ({ kind: 'value' as const, id: 100 + i, x: 0, y: 0, loot: (i % 3 ? 'smallSafe' : 'largeSafe') as 'smallSafe' | 'largeSafe', value: i % 3 ? 100 : 300 }));
  const frames = 600;
  const times: number[] = [];
  // Per-part profile: wrap the sub-components' update methods.
  const prof: Record<string, number> = { labels: 0, arrows: 0, minimap: 0 };
  const wrap = <T extends object>(obj: T, key: string, name: string): void => {
    const o = obj as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = o[key].bind(obj);
    o[key] = (...a: unknown[]) => {
      const t0 = performance.now();
      const r = orig(...a);
      prof[name] += performance.now() - t0;
      return r;
    };
  };
  wrap(hud.labels, 'update', 'labels');
  wrap(hud.arrows, 'update', 'arrows');
  wrap(hud.minimap, 'update', 'minimap');
  await new Promise((r) => requestAnimationFrame(r));
  for (let f = 0; f < frames; f++) {
    const tt = f * 16.67;
    model.timeLeftSec = 200 - f / 60;
    model.dashCooldown = (f % 240) / 240;
    model.scores = [900 + Math.floor(f / 300) * 100, 600];
    model.minimap = mockMinimap(layout, tt);
    // Police on: alarm countdown chip, then officers + a car on the minimap.
    model.police = f < 300 ? { dispatchInSec: 10 - f / 60, officers: 0, alarms: 1 } : { dispatchInSec: null, officers: 2, alarms: 1 };
    if (f >= 300) {
      model.minimap.police = [
        { id: 900, x: 30 + Math.sin(tt / 400) * 3, y: 20, hunting: true },
        { id: 901, x: 44, y: 34, stunned: f % 120 < 60 },
      ];
      model.minimap.policeCars = [{ id: 1, x: 6, y: 4, angle: 0.4, siren: true }];
    }
    model.labels = [
      ...baseLabels.map((l) => ({ ...l, x: l.x + Math.sin(tt / 500 + Number(l.id)) * 20, y: l.y + Math.cos(tt / 700) * 10 })),
      ...extra.map((l, i) => ({ ...l, x: 200 + i * 120 + Math.sin(tt / 400 + i) * 30, y: 300 + Math.cos(tt / 300 + i) * 40 })),
    ];
    model.arrows = [{ id: 'z', x: -100, y: hh / 2 + Math.sin(tt / 300) * 100, kind: 'zone', team: 0 }];
    const t0 = performance.now();
    hud.update(model);
    times.push(performance.now() - t0);
    // Real frame pacing (one update per animation frame), like the match loop.
    await new Promise((r) => requestAnimationFrame(r));
  }
  const firstMs = times[0];
  const warm = times.slice(5).sort((a, b) => a - b);
  const avg = warm.reduce((s, x) => s + x, 0) / warm.length;
  // Trimmed mean (drop the slowest 2%): robust against GC pauses / CPU contention outliers.
  const trimmed = warm.slice(0, Math.floor(warm.length * 0.98));
  const trimmedAvg = trimmed.reduce((s, x) => s + x, 0) / trimmed.length;
  const p50 = warm[Math.floor(warm.length * 0.5)];
  const p95 = warm[Math.floor(warm.length * 0.95)];
  const p99 = warm[Math.floor(warm.length * 0.99)];
  const over03 = warm.filter((x) => x > 0.3).length;
  const result = {
    frames,
    firstFrameMs: +firstMs.toFixed(3),
    avgMs: +avg.toFixed(4),
    trimmedAvgMs: +trimmedAvg.toFixed(4),
    p50Ms: +p50.toFixed(4),
    p95Ms: +p95.toFixed(4),
    p99Ms: +p99.toFixed(4),
    maxMs: +warm[warm.length - 1].toFixed(3),
    framesOver03ms: over03,
    partsAvgMs: Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, +(v / frames).toFixed(4)])),
    // Frame indices of the slowest updates (to correlate with clock/score/dash changes).
    spikes: times
      .map((ms, i) => ({ i, ms }))
      .slice(5)
      .filter((x) => x.ms > 0.3)
      .map((x) => `${x.i}:${x.ms.toFixed(1)}`)
      .join(' '),
  };
  (window as unknown as { __perf: unknown }).__perf = result;
  const pre = document.createElement('pre');
  pre.className = 'dev-perf';
  pre.textContent = `HUD update cost\n${JSON.stringify(result, null, 2)}`;
  document.body.appendChild(pre);
}

void main();
