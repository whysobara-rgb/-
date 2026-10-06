/**
 * App flow state machine (docs/ARCHITECTURE.md "Game flow"):
 *
 *   Title -> MainMenu -> { 연습 (tutorial)
 *                        | 빠른 대전 setup -> LayoutPreview -> Match -> Results -> 재대결 / 메뉴
 *                        | 라이벌 대회 -> TournamentScreen -> LayoutPreview -> Match -> Results
 *                              -> SeriesIntermission -> next game ...
 *                        | 옷장 | 설정 | 종료 }
 *
 * - One GameView lives for the whole session: the title scene is the live backdrop behind the
 *   menus, matches load into it behind a LoadingScreen, results stage the raccoons at the van.
 * - Input: exactly one consumer per context — InputManager.pollMenu() for menus / pause /
 *   results, pollMatch() (inside MatchController, once per sim tick) during play.
 * - Back is consistent: every screen's back returns to the screen it came from; leaving a
 *   match in progress always asks first (PauseMenu confirm dialogs).
 */
import { RIVALS, type ObservationSummary, type RivalId } from '../ai';
import { UI_SOUND_SFX, type AudioEngine } from '../audio';
import { Simulation } from '../sim';
import { MATCH_LAYOUT_IDS, getLayout } from '../sim/layouts';
import type { HatId, LayoutId, RosterEntry } from '../sim/types';
import type { GameView } from '../render';
import { type InputManager } from '../platform/input';
import { applyMatchStats, unlockHat, newHats, type SaveManager } from '../platform/save';
import { cloneSettings, type Settings } from '../platform/settings';
import { isDesktopBuild, isFullscreen, quitApp, setFullscreen } from '../platform/native';
import { unlockAchievement } from '../platform/steam';
import { summarizeMatchStats } from '../platform/progress';
import type { MatchAction } from '../platform/bindings';
import {
  ConfirmDialog,
  LayoutPreview,
  LoadingScreen,
  MainMenu,
  PauseMenu,
  QuickMatchSetup,
  ResultsScreen,
  SeriesIntermission,
  SettingsScreen,
  TitleScreen,
  TournamentScreen,
  WardrobeScreen,
  navRouter,
  setLanguage,
  setUiSoundHandler,
  uiSound,
  type Hud,
  type MainMenuItem,
  type QuickMatchOptions,
  type ResultsScreenProps,
  type Toasts,
  type UiRoot,
  type UiScreen,
  type UiSettings,
  type BindingRow,
} from '../ui';
import { tournamentAchievements, wardrobeAchievement } from './achievements';
import { MatchController, type MatchSummary } from './match';
import type { LaunchParams } from './params';
import { toResultEventView } from './results';
import { mixSeed, type MatchConfig } from './setup';
import {
  cloneProgress,
  isComplete,
  isSelectable,
  nextGameNumber,
  recordGame,
  rivalCards,
  seriesAdaptation,
  seriesLayout,
  startSeries,
  type GameOutcome,
  type GameRecord,
} from './tournament';
import { TutorialDirector } from './tutorial';

export type AppState =
  | 'boot'
  | 'title'
  | 'menu'
  | 'quickSetup'
  | 'tournament'
  | 'wardrobe'
  | 'settings'
  | 'loading'
  | 'preview'
  | 'match'
  | 'paused'
  | 'results'
  | 'intermission'
  | 'tutorialOffer'
  | 'error';

export interface AppDeps {
  ui: UiRoot;
  view: GameView;
  hud: Hud;
  toasts: Toasts;
  input: InputManager;
  audio: AudioEngine;
  save: SaveManager;
  params: LaunchParams;
  version: string;
  /** Persist + apply a settings change everywhere (view, audio, input, UI). */
  applySettings: (s: Settings, changed: keyof Settings | null) => void;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Non-fatal error overlay ("다시 시도" runs `retry`). */
  reportError: (err: unknown, context: string, retry?: () => void) => void;
}

interface LaunchOpts {
  preview: boolean;
  /** Back from the preview. */
  back?: () => void;
  context?: string | { key: string; params?: Record<string, string | number> } | null;
}

/** Preview hold before the in-world countdown (ms); confirm skips it. */
const PREVIEW_HOLD_MS = 3400;

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export class App {
  private stateValue: AppState = 'boot';
  private screen: UiScreen<object> | null = null;
  private overlay: UiScreen<object> | null = null;
  private loading: LoadingScreen | null = null;
  private match: MatchController | null = null;
  private lastSummary: MatchSummary | null = null;
  private lastRecord: GameRecord | null = null;
  private titleSim: Simulation;
  private sceneTime = 0;
  private frameNo = 0;
  private seedCounter = 0;
  private readonly baseSeed: number;
  private quickOpts: QuickMatchOptions = { mode: '1v1', layout: 'plaza', rival: 'hodadak', difficulty: 'normal' };
  private drawStreak = 0;
  private firstRunAsked = false;
  private previewTimer = 0;
  /** Starts the match from the layout preview (re-armed when the player comes back). */
  private previewGo: (() => void) | null = null;
  /** The window lost focus / the tab is hidden: nothing may start on its own. */
  private awayValue = false;
  private settingsReturn: (() => void) | null = null;
  private transitionToken = 0;

  constructor(private readonly d: AppDeps) {
    this.baseSeed = d.params.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
    if (d.params.mode) this.quickOpts.mode = d.params.mode;
    if (d.params.layout && d.params.layout !== 'tutorial') this.quickOpts.layout = d.params.layout;
    if (d.params.rival) this.quickOpts.rival = d.params.rival;
    if (d.params.difficulty) this.quickOpts.difficulty = d.params.difficulty;
    this.titleSim = this.buildTitleSim();
    setUiSoundHandler((kind) => d.audio.play(UI_SOUND_SFX[kind]));
  }

  get state(): AppState {
    return this.stateValue;
  }

  get currentMatch(): MatchController | null {
    return this.match;
  }

  get settings(): Readonly<Settings> {
    return this.d.save.data.settings;
  }

  // ------------------------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------------------------

  /** Title backdrop: the plaza with a few idle raccoons by the first bank. */
  private buildTitleSim(): Simulation {
    const layout = getLayout('plaza');
    const hat = this.d.save.data.cosmetics.equipped;
    const roster: RosterEntry[] = [
      { team: 0, isBot: false, name: 'name.you', look: { hat, furTint: 0.5 } },
      { team: 0, isBot: true, name: 'name.ally', look: { hat: 'teamCapA', furTint: 0.2 } },
      { team: 1, isBot: true, name: RIVALS.tongkeun.nameKey, look: { ...RIVALS.tongkeun.look } },
      { team: 1, isBot: true, name: RIVALS.hodadak.nameKey, look: { ...RIVALS.hodadak.look } },
    ];
    const sim = new Simulation({ layout, roster, seed: 1 });
    // Title only (never a match): gather the cast in front of a bank door.
    const bank = sim.state.loot.find((l) => l.kind === 'bank');
    if (bank) {
      const front = { x: bank.pos.x - Math.sin(bank.angle) * 4.6, y: bank.pos.y + Math.cos(bank.angle) * 4.6 };
      const spots = [
        { x: -1.6, y: 0.4 },
        { x: -0.4, y: 1.1 },
        { x: 0.9, y: 0.2 },
        { x: 2.0, y: 1.0 },
      ];
      const placed: { x: number; y: number }[] = [];
      sim.state.characters.forEach((c, i) => {
        const s = spots[i]!;
        // First free spot near the planned one, away from the others already placed.
        for (let r = 0; r < 4; r += 0.5) {
          let done = false;
          for (let k = 0; k < 8 && !done; k++) {
            const a = (k / 8) * Math.PI * 2;
            const p = { x: front.x + s.x + Math.cos(a) * r, y: front.y + s.y + Math.sin(a) * r };
            if (!sim.isFree(p, 0.55) || placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1.1)) continue;
            sim.debug.teleport(c.id, p, Math.atan2(bank.pos.y - p.y, bank.pos.x - p.x) + (i - 1.5) * 0.35);
            placed.push(p);
            done = true;
          }
          if (done) break;
        }
      });
    }
    return sim;
  }

  /** Called once fonts / save / view are ready. */
  start(): void {
    const p = this.d.params;
    this.d.view.load(this.titleSim);
    this.d.view.setMode('title');
    if (p.flow === 'tutorial') {
      this.startTutorial();
      return;
    }
    if (p.flow === 'quick') {
      this.startQuick({ ...this.quickOpts }, p.skipIntro ? false : true);
      return;
    }
    if (p.flow === 'tournament') {
      this.toTournament();
      return;
    }
    if (p.skipIntro) this.toMenu();
    else this.toTitle();
  }

  // ------------------------------------------------------------------------------------------
  // Per frame
  // ------------------------------------------------------------------------------------------

  frame(dt: number): void {
    this.frameNo++;
    const st = this.stateValue;
    const m = this.match;
    if (m && (st === 'match' || st === 'paused')) {
      if (st === 'paused') this.pollMenu();
      else if (m.state !== 'playing' && m.state !== 'countdown') this.d.input.pollMenu();
      // A pause-menu press may have left the match (menu / forfeit / restart) this very frame.
      if (this.match === m) m.frame(dt);
      return;
    }
    if (st === 'match' || st === 'loading' || st === 'boot') {
      // Match between phases / loading: keep the view alive. The menu consumer is drained every
      // frame here (presses discarded) so the input module only ever sees a long poll gap on a
      // real hitch — which then keeps its presses (see main.ts reactivateAfterMs).
      this.d.input.pollMenu();
      if (this.match) this.match.frame(dt);
      return;
    }
    // Menus, preview, results, intermission: menu input + the scene behind them.
    this.pollMenu();
    this.renderScene(dt);
  }

  private pollMenu(): void {
    let nav = this.d.input.pollMenu();
    if (this.stateValue === 'paused' && nav.pause && !this.overlay) {
      // Esc / Start closes the pause menu only when the pause menu itself has focus. With its
      // own confirm dialog (restart / leave) on top, the same press backs out of the dialog.
      if (this.screen instanceof PauseMenu && navRouter.top() === this.screen) {
        this.resumeMatch();
        return;
      }
      if (!nav.back) nav = { ...nav, back: true };
    }
    this.d.ui.handleNav(nav);
  }

  private renderScene(dt: number): void {
    const every = this.d.params.renderEvery;
    this.sceneTime += dt;
    if (every > 1 && this.frameNo % every !== 0) return;
    const m = this.match;
    if (m && (this.stateValue === 'preview' || this.stateValue === 'results' || this.stateValue === 'intermission' || this.stateValue === 'tutorialOffer')) {
      this.d.view.render(m.sim, 1, Math.min(0.1, this.sceneTime), m.focus());
    } else {
      this.d.view.render(this.titleSim, 1, Math.min(0.1, this.sceneTime), null);
    }
    this.sceneTime = 0;
  }

  // ------------------------------------------------------------------------------------------
  // Screen helpers
  // ------------------------------------------------------------------------------------------

  private setState(s: AppState): void {
    this.stateValue = s;
    document.documentElement.dataset.appState = s;
  }

  private show<T extends UiScreen<object>>(screen: T, state: AppState): T {
    this.closeOverlay();
    const prev = this.screen;
    this.screen = screen;
    this.setState(state);
    screen.show();
    if (prev && prev !== screen) prev.destroy();
    return screen;
  }

  private clearScreen(): void {
    this.closeOverlay();
    this.screen?.destroy();
    this.screen = null;
  }

  private closeOverlay(): void {
    this.overlay?.destroy();
    this.overlay = null;
  }

  private toSceneTitle(): void {
    const v = this.d.view;
    if (this.match) this.disposeMatch();
    this.d.hud.hide();
    this.d.hud.reset();
    v.load(this.titleSim);
    v.setMode('title');
    this.d.audio.playMusic('title');
  }

  private disposeMatch(): void {
    this.match?.dispose();
    this.match = null;
    window.clearTimeout(this.previewTimer);
    this.previewGo = null;
  }

  private nextSeed(): number {
    this.seedCounter++;
    return mixSeed(this.baseSeed, this.seedCounter);
  }

  // ------------------------------------------------------------------------------------------
  // Title / menu
  // ------------------------------------------------------------------------------------------

  toTitle(): void {
    if (this.match) this.toSceneTitle();
    this.d.audio.playMusic('title');
    this.show(new TitleScreen({ version: this.d.version, onStart: () => this.toMenu() }), 'title');
  }

  toMenu(focus?: MainMenuItem): void {
    if (this.match || this.d.view.mode !== 'title') this.toSceneTitle();
    this.d.audio.playMusic('title');
    const data = this.d.save.data;
    const fresh = !data.tutorialDone && data.stats.matches === 0;
    const badges: Partial<Record<MainMenuItem, string | { key: string; params?: Record<string, number> }>> = {};
    if (fresh) badges.practice = 'common.new';
    if (data.tournament.series) badges.tournament = { key: 'tournament.round', params: { n: ['hodadak', 'tongkeun', 'nunchi'].indexOf(data.tournament.series.rival) + 1 } };
    if (newHats(data.cosmetics).length) badges.wardrobe = 'common.new';
    const menu = new MainMenu({
      onSelect: (item) => this.onMenuSelect(item),
      onBack: () => this.toTitle(),
      showQuit: isDesktopBuild(),
      hat: data.cosmetics.equipped,
      team: 0,
      badges,
      initialFocus: focus ?? (fresh ? 'practice' : 'quickMatch'),
    });
    this.show(menu, 'menu');
    // First launch suggests the practice once per session (never forced).
    if (fresh && !this.firstRunAsked && !this.d.params.autotest) {
      this.firstRunAsked = true;
      this.overlay = new ConfirmDialog({
        titleKey: 'firstRun.title',
        bodyKey: 'firstRun.body',
        confirmKey: 'firstRun.ok',
        cancelKey: 'firstRun.later',
        defaultFocus: 'confirm',
        onConfirm: () => {
          this.closeOverlay();
          this.startTutorial();
        },
        onCancel: () => {
          this.closeOverlay();
          menu.rearm();
        },
      });
      this.overlay.show();
    }
  }

  private onMenuSelect(item: MainMenuItem): void {
    switch (item) {
      case 'practice':
        this.startTutorial();
        break;
      case 'quickMatch':
        this.toQuickSetup();
        break;
      case 'tournament':
        this.toTournament();
        break;
      case 'wardrobe':
        this.toWardrobe();
        break;
      case 'settings':
        this.toSettings(() => this.toMenu('settings'));
        break;
      case 'quit':
        this.confirmQuit();
        break;
    }
  }

  private confirmQuit(): void {
    const menu = this.screen;
    this.overlay = new ConfirmDialog({
      titleKey: 'menu.quitConfirm.title',
      bodyKey: 'menu.quitConfirm.body',
      confirmKey: 'menu.quitConfirm.ok',
      danger: true,
      onConfirm: () => {
        this.closeOverlay();
        this.d.save.flush();
        quitApp();
        menu?.rearm();
      },
      onCancel: () => {
        this.closeOverlay();
        menu?.rearm();
      },
    });
    this.overlay.show();
  }

  // ------------------------------------------------------------------------------------------
  // Quick match
  // ------------------------------------------------------------------------------------------

  toQuickSetup(): void {
    const layouts = MATCH_LAYOUT_IDS.map((id) => {
      const l = getLayout(id);
      return { id, nameKey: l.nameKey, descKey: l.descKey, layout: l };
    });
    this.show(
      new QuickMatchSetup({
        layouts,
        value: { ...this.quickOpts },
        onChange: (v) => (this.quickOpts = { ...v }),
        onStart: (v) => {
          this.quickOpts = { ...v };
          this.startQuick(v, true);
        },
        onBack: () => this.toMenu('quickMatch'),
      }),
      'quickSetup',
    );
  }

  private resolveQuick(o: QuickMatchOptions): MatchConfig {
    const seed = this.nextSeed();
    const layoutId: LayoutId = o.layout === 'random' ? MATCH_LAYOUT_IDS[seed % MATCH_LAYOUT_IDS.length]! : o.layout;
    const rivals: RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];
    const rival: RivalId = o.rival === 'random' ? rivals[(seed >>> 8) % 3]! : o.rival;
    return {
      kind: 'quick',
      layoutId,
      mode: o.mode,
      rival,
      difficulty: o.difficulty,
      adaptation: null,
      seed,
      humanHat: this.d.save.data.cosmetics.equipped,
      matchSeconds: this.d.params.matchSeconds,
      police: this.d.params.police,
    };
  }

  startQuick(o: QuickMatchOptions, preview: boolean): void {
    const cfg = this.resolveQuick(o);
    void this.launch(cfg, { preview, back: () => this.toQuickSetup(), context: 'mode.quickMatch' });
  }

  // ------------------------------------------------------------------------------------------
  // Tutorial
  // ------------------------------------------------------------------------------------------

  startTutorial(): void {
    const cfg: MatchConfig = {
      kind: 'tutorial',
      layoutId: 'tutorial',
      mode: '1v1',
      rival: 'hodadak',
      difficulty: 'novice',
      adaptation: null,
      seed: this.nextSeed(),
      humanHat: this.d.save.data.cosmetics.equipped,
    };
    void this.launch(cfg, { preview: false });
  }

  private markTutorialDone(): void {
    if (!this.d.save.data.tutorialDone) this.d.save.update((s) => (s.tutorialDone = true), { immediate: true });
  }

  private offerAfterTutorial(): void {
    this.setState('tutorialOffer');
    this.closeOverlay();
    this.overlay = new ConfirmDialog({
      titleKey: 'tutorial.offer.title',
      bodyKey: 'tutorial.offer.body',
      confirmKey: 'tutorial.offer.match',
      cancelKey: 'tutorial.offer.menu',
      defaultFocus: 'confirm',
      onConfirm: () => {
        this.closeOverlay();
        const cfg: MatchConfig = {
          kind: 'quick',
          layoutId: 'plaza',
          mode: '1v1',
          rival: 'hodadak',
          difficulty: 'novice',
          adaptation: null,
          seed: this.nextSeed(),
          humanHat: this.d.save.data.cosmetics.equipped,
          matchSeconds: this.d.params.matchSeconds,
          // The onboarding match right after the practice (doc §3) keeps to what the practice
          // taught: no police unless forced with ?police=1.
          police: this.d.params.police === true,
        };
        this.quickOpts = { mode: '1v1', layout: 'plaza', rival: 'hodadak', difficulty: 'novice' };
        void this.launch(cfg, { preview: true, back: () => this.toMenu(), context: 'mode.quickMatch' });
      },
      onCancel: () => {
        this.closeOverlay();
        this.toMenu();
      },
    });
    this.overlay.show();
  }

  // ------------------------------------------------------------------------------------------
  // Tournament
  // ------------------------------------------------------------------------------------------

  toTournament(focus?: RivalId): void {
    if (this.match) this.toSceneTitle();
    const p = this.d.save.data.tournament;
    const cards = rivalCards(p).map((c) => ({
      rival: c.rival,
      state: c.state,
      playerWins: c.playerWins,
      rivalWins: c.rivalWins,
      layoutNameKey: c.layoutNameKey,
      rewardHat: c.rewardHat,
      rewardOwned: this.d.save.data.cosmetics.unlocked.includes(c.rewardHat),
    }));
    const screen: TournamentScreen = this.show(
      new TournamentScreen({
        rivals: cards,
        complete: isComplete(p),
        initialFocus: focus,
        onSelect: (r) => {
          if (!isSelectable(this.d.save.data.tournament, r) && !(this.d.save.data.tournament.series?.rival === r)) {
            uiSound('error');
            this.d.toasts.show({ title: 'tournament.lockedPick', icon: 'lock', durationMs: 2000 });
            screen.rearm();
            return;
          }
          const cur = this.d.save.data.tournament.series;
          if (cur && cur.rival !== r && cur.wins + cur.losses + cur.draws > 0) {
            // Switching rivals abandons the series in progress: ask first.
            this.overlay = new ConfirmDialog({
              titleKey: 'tournament.abandon.title',
              bodyKey: 'tournament.abandon.body',
              params: { rival: RIVALS[cur.rival].nameKey },
              confirmKey: 'tournament.abandon.ok',
              danger: true,
              onConfirm: () => {
                this.closeOverlay();
                this.startTournamentGame(r, true);
              },
              onCancel: () => {
                this.closeOverlay();
                screen.rearm();
              },
            });
            this.overlay.show();
            return;
          }
          this.startTournamentGame(r, true);
        },
        onBack: () => this.toMenu('tournament'),
      }),
      'tournament',
    );
  }

  private tournamentConfig(rival: RivalId): MatchConfig {
    const prog = cloneProgress(this.d.save.data.tournament);
    const s = startSeries(prog, rival);
    this.d.save.update((d) => (d.tournament = prog), { immediate: true });
    return {
      kind: 'tournament',
      layoutId: (s.layoutId ?? seriesLayout(rival)) as LayoutId,
      mode: '1v1',
      rival,
      difficulty: this.d.params.difficulty ?? 'normal',
      adaptation: seriesAdaptation(s),
      seed: mixSeed(this.baseSeed ^ 0x7a11, (['hodadak', 'tongkeun', 'nunchi'].indexOf(rival) + 1) * 1000 + s.gameIndex + this.seedCounter++),
      humanHat: this.d.save.data.cosmetics.equipped,
      matchSeconds: this.d.params.matchSeconds,
      police: this.d.params.police,
    };
  }

  private startTournamentGame(rival: RivalId, preview: boolean): void {
    const cfg = this.tournamentConfig(rival);
    const s = this.d.save.data.tournament.series!;
    void this.launch(cfg, {
      preview,
      back: () => this.toTournament(rival),
      context: { key: 'series.game', params: { n: nextGameNumber(s) } },
    });
  }

  // ------------------------------------------------------------------------------------------
  // Wardrobe / settings
  // ------------------------------------------------------------------------------------------

  toWardrobe(): void {
    const data = this.d.save.data;
    const fresh = new Set(newHats(data.cosmetics));
    const hats = (['none', 'teamCapA', 'teamCapB', 'hodadakBand', 'tongkeunHat', 'nunchiMask'] as HatId[]).map((id) => ({ id, unlocked: data.cosmetics.unlocked.includes(id), isNew: fresh.has(id) }));
    // Viewing the wardrobe clears the NEW badges.
    if (fresh.size) this.d.save.update((s) => (s.cosmetics.seen = [...s.cosmetics.unlocked]));
    const screen: WardrobeScreen = this.show(
      new WardrobeScreen({
        hats,
        equipped: data.cosmetics.equipped,
        team: 0,
        onEquip: (hat) => {
          if (!this.d.save.data.cosmetics.unlocked.includes(hat)) {
            uiSound('error');
            return;
          }
          this.d.save.update((s) => (s.cosmetics.equipped = hat));
          screen.update({ equipped: hat });
          for (const id of wardrobeAchievement(hat)) unlockAchievement(id);
          this.titleSim.state.characters[0]!.look.hat = hat;
          this.d.view.load(this.titleSim);
        },
        onBack: () => this.toMenu('wardrobe'),
      }),
      'wardrobe',
    );
  }

  private uiSettings(): UiSettings {
    const s = this.settings;
    return {
      language: s.language,
      grabMode: s.grabMode,
      showTutorialHints: s.showTutorialHints,
      volumes: { ...s.volumes },
      subtitles: s.subtitles,
      // Browser builds cannot start fullscreen without a gesture: show the real state there.
      fullscreen: isDesktopBuild() ? s.fullscreen : isFullscreen(),
      quality: s.quality,
      screenShake: s.screenShake,
      reducedMotion: s.reducedMotion,
      uiScale: s.uiScale,
      vibration: s.vibration,
    };
  }

  private bindingRows(): BindingRow[] {
    return this.d.input.bindingRows().map((r) => ({ action: r.action, keyboard: r.keyboard, gamepad: r.gamepad }));
  }

  /** Settings screen; `back` returns to wherever it was opened from (menu or pause). */
  toSettings(back: () => void): void {
    this.settingsReturn = back;
    const screen = new SettingsScreen({
      settings: this.uiSettings(),
      bindings: this.bindingRows(),
      showFullscreen: true,
      showVibration: true,
      onChange: (key, value) => {
        const next = cloneSettings(this.settings);
        (next as unknown as Record<string, unknown>)[key] = value;
        if (key === 'language') setLanguage(value as Settings['language']);
        this.d.applySettings(next, key as keyof Settings);
        if (key === 'fullscreen') setFullscreen(value === true);
        this.match?.applySettings(next);
      },
      onRebind: async (action, device) => {
        const code = await this.d.input.startRebind(action as MatchAction, device);
        if (!code) return null;
        const next = cloneSettings(this.settings);
        next.bindings = this.d.input.getBindings();
        this.d.applySettings(next, 'bindings');
        return { bindings: this.bindingRows() };
      },
      onResetBindings: () => {
        this.d.input.resetBindings();
        const next = cloneSettings(this.settings);
        next.bindings = this.d.input.getBindings();
        this.d.applySettings(next, 'bindings');
        return this.bindingRows();
      },
      onBack: () => {
        const r = this.settingsReturn;
        this.settingsReturn = null;
        this.d.save.flush();
        if (r) r();
        else this.toMenu('settings');
      },
    });
    if (this.stateValue === 'paused') {
      // Over the pause menu: the pause menu is hidden, not destroyed.
      this.overlay?.destroy();
      this.overlay = screen;
      this.screen?.hide();
      screen.show();
      return;
    }
    this.show(screen, 'settings');
  }

  // ------------------------------------------------------------------------------------------
  // Match lifecycle
  // ------------------------------------------------------------------------------------------

  private async launch(cfg: MatchConfig, opts: LaunchOpts): Promise<void> {
    const token = ++this.transitionToken;
    this.clearScreen();
    this.disposeMatch();
    this.d.hud.hide();
    this.setState('loading');
    this.loading?.destroy();
    this.loading = new LoadingScreen({ progress: null });
    this.loading.show();
    this.d.audio.playMusic('none');
    await nextFrame();
    await nextFrame();
    if (token !== this.transitionToken) return;
    let ctl: MatchController | null = null;
    try {
      ctl = new MatchController(
        {
          view: this.d.view,
          hud: this.d.hud,
          input: this.d.input,
          audio: this.d.audio,
          toasts: this.d.toasts,
          settings: () => this.settings,
          params: this.d.params,
          log: (m) => this.d.log('warn', m),
        },
        cfg,
        {
          onPauseRequest: () => this.openPause(),
          onFinished: (s) => this.onMatchFinished(s),
        },
      );
      this.loading?.setProgress(0.6);
      await nextFrame();
      if (token !== this.transitionToken) {
        ctl.dispose();
        return;
      }
      ctl.load();
      if (cfg.kind === 'tutorial') {
        ctl.attachScript(new TutorialDirector(ctl.sim, ctl.meId, this.d.hud, { autopilot: this.d.params.autotest }));
      }
    } catch (err) {
      ctl?.dispose();
      if (token === this.transitionToken) {
        this.loading?.destroy();
        this.loading = null;
        this.d.reportError(err, 'match load', () => void this.launch(cfg, opts));
      }
      return;
    }
    if (token !== this.transitionToken) {
      ctl.dispose();
      return;
    }
    this.loading?.destroy();
    this.loading = null;
    this.match = ctl;
    this.lastSummary = null;
    if (opts.preview) this.showPreview(ctl, opts);
    else {
      this.beginMatch();
      // Loaded while the player was away (alt-tab, hidden tab): hold at the countdown.
      if (this.awayValue) this.openPause();
    }
  }

  private showPreview(ctl: MatchController, opts: LaunchOpts): void {
    const sim = ctl.sim;
    const st = sim.state;
    const member = (c: (typeof st.characters)[number]) => ({
      name: c.id === ctl.meId ? 'name.you' : c.name,
      rival: c.look.rival ?? null,
      hat: c.look.hat,
      isYou: c.id === ctl.meId,
    });
    const team = (t: 0 | 1) => ({ members: st.characters.filter((c) => c.team === t).map(member) });
    const go = (): void => {
      window.clearTimeout(this.previewTimer);
      if (this.stateValue === 'preview' && this.match === ctl) this.beginMatch();
    };
    const preview = new LayoutPreview({
      layout: sim.layout,
      context: opts.context ?? null,
      myTeam: 0,
      teams: [team(0), team(1)],
      holdMs: 0,
      onDone: go,
      onSkip: go,
      onBack: opts.back
        ? () => {
            window.clearTimeout(this.previewTimer);
            this.disposeMatch();
            opts.back!();
          }
        : undefined,
    });
    this.show(preview, 'preview');
    this.d.view.setMode('preview');
    this.previewGo = go;
    this.armPreview();
  }

  /** (Re)start the preview's auto-start timer — never while the player is away. */
  private armPreview(): void {
    window.clearTimeout(this.previewTimer);
    if (this.stateValue !== 'preview' || !this.previewGo || this.awayValue) return;
    this.previewTimer = window.setTimeout(this.previewGo, this.d.params.skipIntro ? 300 : PREVIEW_HOLD_MS);
  }

  private beginMatch(): void {
    const m = this.match;
    if (!m) return;
    this.clearScreen();
    this.setState('match');
    m.beginCountdown();
  }

  private openPause(): void {
    const m = this.match;
    if (!m || this.stateValue !== 'match') return;
    m.pause();
    this.setState('paused');
    const tut = m.isPractice;
    // Rival series: a started game can't be thrown away — no restart, and leaving forfeits it
    // (recorded as a loss, progress saved) so best-of-3 pressure holds.
    const tour = m.config.kind === 'tournament';
    const forfeits = tour && m.sim.state.tick > 0 && !m.sim.state.over;
    const pause = new PauseMenu({
      onResume: () => this.resumeMatch(),
      onSettings: () => this.toSettings(() => this.reopenPause()),
      onRestart: () => {
        const cfg = m.config;
        void this.launch({ ...cfg }, { preview: false });
      },
      onMenu: () => {
        if (tut) this.markTutorialDone();
        if (tour) {
          const rival = m.config.rival;
          if (forfeits) this.recordTournament(rival, 'loss', m.observer ? m.observer.summary() : null);
          this.toTournament(rival);
          return;
        }
        this.toMenu(tut ? 'practice' : undefined);
      },
      confirmDestructive: !tut,
      menuConfirmBody: forfeits ? 'tournament.forfeit.body' : null,
      showRestart: !tut && !tour,
      context: tut ? 'mode.practice' : m.config.kind === 'tournament' ? 'mode.tournament' : 'mode.quickMatch',
      grabMode: this.settings.grabMode,
    });
    this.closeOverlay();
    this.screen?.destroy();
    this.screen = pause;
    pause.show();
  }

  private reopenPause(): void {
    this.closeOverlay();
    if (this.screen && this.stateValue === 'paused') {
      this.screen.show();
      return;
    }
  }

  resumeMatch(): void {
    const m = this.match;
    if (!m) return;
    this.clearScreen();
    this.setState('match');
    m.resume();
  }

  /**
   * Pause from outside (pad disconnect, or the player went away): a running match or its 3-2-1
   * countdown opens the pause menu, and the layout preview stops counting down to the start
   * (confirm still starts it).
   */
  requestPause(): void {
    const m = this.match;
    if (this.stateValue === 'match' && m && (m.state === 'playing' || m.state === 'countdown')) this.openPause();
    else if (this.stateValue === 'preview') window.clearTimeout(this.previewTimer);
  }

  /**
   * Window focus / tab visibility (desktop alt-tab, minimise, hidden tab). While away nothing
   * starts on its own: the preview holds, a match that finishes loading waits paused at its
   * countdown, and a running match pauses. Coming back re-arms the preview timer only.
   */
  setAway(away: boolean): void {
    if (this.awayValue === away) return;
    this.awayValue = away;
    if (away) this.requestPause();
    else this.armPreview();
  }

  private onMatchFinished(summary: MatchSummary): void {
    this.lastSummary = summary;
    const cfg = summary.config;
    if (cfg.kind === 'tutorial') {
      this.markTutorialDone();
      this.offerAfterTutorial();
      return;
    }
    // Stats (doc §12: real records only).
    const sim = this.match!.sim;
    try {
      const st = summarizeMatchStats({ events: sim.eventLog, result: summary.result, humanTeam: 0 });
      this.d.save.update((d) => (d.stats = applyMatchStats(d.stats, st)));
    } catch (err) {
      this.d.log('warn', `[app] stats update failed: ${String(err)}`);
    }
    let record: GameRecord | null = null;
    if (cfg.kind === 'tournament') {
      const outcome = summary.outcome === 'win' ? 'win' : summary.outcome === 'lose' ? 'loss' : 'draw';
      record = this.recordTournament(cfg.rival, outcome, summary.observation);
    }
    this.lastRecord = record;
    this.toResults(summary, record);
  }

  /** Record one series game (finished, or forfeited from the pause menu) and save at once. */
  private recordTournament(rival: RivalId, outcome: GameOutcome, observation: ObservationSummary | null): GameRecord | null {
    const prog = cloneProgress(this.d.save.data.tournament);
    if (!prog.series || prog.series.rival !== rival) return null;
    const rec = recordGame(prog, outcome, observation, this.drawStreak, (m) => this.d.log('warn', m));
    this.drawStreak = rec.drawStreak;
    if (rec.seriesState !== 'ongoing') this.drawStreak = 0;
    let hatNew = false;
    this.d.save.update(
      (d) => {
        d.tournament = prog;
        if (rec.rewardHat) hatNew = unlockHat(d.cosmetics, rec.rewardHat);
      },
      { immediate: true },
    );
    if (rec.rewardHat && hatNew) this.d.toasts.hatUnlocked(rec.rewardHat);
    for (const id of tournamentAchievements(prog.beaten)) unlockAchievement(id);
    return rec;
  }

  private toResults(summary: MatchSummary, record: GameRecord | null): void {
    const m = this.match;
    if (!m) return;
    this.d.hud.hide();
    this.d.view.setResultsFraming(0.19);
    this.d.view.setMode('results');
    window.setTimeout(() => {
      if (this.stateValue === 'results') this.d.audio.playMusic('results');
    }, 2600);
    const cfg = summary.config;
    const props: ResultsScreenProps = {
      outcome: summary.outcome,
      myTeam: 0,
      scores: summary.result.scores,
      teamLabels: cfg.mode === '1v1' ? [null, RIVALS[cfg.rival].nameKey] : undefined,
      reason: summary.result.reason,
      biggestEvent: toResultEventView(summary.biggest),
      actions: { rematch: true },
      playerHat: cfg.humanHat,
      onRematch: () => this.rematch(),
      onMenu: () => this.toMenu(),
    };
    if (cfg.kind === 'tournament' && record) {
      props.series = {
        rival: record.rival,
        playerWins: record.playerWins,
        rivalWins: record.rivalWins,
        gameNumber: record.gameNumber,
        state: record.seriesState,
      };
      props.reward = record.rewardHat ? { hat: record.rewardHat } : null;
      if (record.seriesState === 'ongoing') {
        props.actions = { next: true };
        props.onNext = () => this.toIntermission(record);
      } else if (record.seriesState === 'won') {
        // The next press goes to the ladder (next rival), not to another game of this series.
        props.actions = { next: true };
        props.nextLabel = isComplete(this.d.save.data.tournament) ? 'results.toLadder' : 'results.nextRival';
        props.onNext = () => this.toTournament(this.nextRivalFocus(record.rival));
      } else {
        // A lost series retries that rival only (doc §12).
        props.actions = { rematch: true };
        props.onRematch = () => this.startTournamentGame(record.rival, true);
      }
      props.onMenu = () => this.toTournament(record.rival);
    }
    this.show(new ResultsScreen(props), 'results');
  }

  private nextRivalFocus(beaten: RivalId): RivalId {
    const order: RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];
    const i = order.indexOf(beaten);
    return order[Math.min(order.length - 1, i + 1)]!;
  }

  /** One press: same setup, fresh seed, straight into the countdown. */
  rematch(): void {
    const s = this.lastSummary;
    if (!s) {
      this.toMenu();
      return;
    }
    const cfg: MatchConfig = { ...s.config, seed: this.nextSeed(), humanHat: this.d.save.data.cosmetics.equipped };
    void this.launch(cfg, { preview: false });
  }

  private toIntermission(rec: GameRecord): void {
    const series = this.d.save.data.tournament.series;
    if (!series) {
      this.toTournament(rec.rival);
      return;
    }
    const adaptation = seriesAdaptation(series);
    this.show(
      new SeriesIntermission({
        rival: rec.rival,
        gameNumber: nextGameNumber(series),
        playerWins: series.wins,
        rivalWins: series.losses,
        layoutNameKey: getLayout((series.layoutId ?? seriesLayout(rec.rival)) as LayoutId).nameKey,
        adaptation: adaptation ? { kind: adaptation.kind, line: { key: adaptation.lineKey, params: adaptation.lineParams } } : null,
        afterDraw: rec.afterDraw,
        myTeam: 0,
        onContinue: () => this.startTournamentGame(rec.rival, false),
        onQuit: () => this.toTournament(rec.rival),
      }),
      'intermission',
    );
  }

  // ------------------------------------------------------------------------------------------
  // Error recovery
  // ------------------------------------------------------------------------------------------

  /** "메뉴로" from the error overlay: drop whatever was running and go to the main menu. */
  recoverToMenu(): void {
    try {
      this.loading?.destroy();
      this.loading = null;
      this.transitionToken++;
      this.disposeMatch();
      this.toMenu();
    } catch (err) {
      this.d.log('error', `[app] recoverToMenu failed: ${String(err)}`);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Test hooks
  // ------------------------------------------------------------------------------------------

  debugState(): Record<string, unknown> {
    const m = this.match;
    return {
      app: this.stateValue,
      screen: this.screen ? this.screen.el.className : null,
      overlay: this.overlay ? this.overlay.el.className : null,
      match: m ? m.debugInfo() : null,
      config: m ? { ...m.config } : null,
      summary: this.lastSummary
        ? { outcome: this.lastSummary.outcome, result: this.lastSummary.result, biggest: this.lastSummary.biggest }
        : null,
      record: this.lastRecord,
      tournament: this.d.save.data.tournament,
      tutorialDone: this.d.save.data.tutorialDone,
      tutorialBeat: m && m.scriptRef && 'currentBeat' in m.scriptRef ? (m.scriptRef as TutorialDirector).currentBeat : null,
    };
  }
}
