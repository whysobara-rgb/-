/**
 * Front door (C10, replaces the signboard menu). Over the live rooftop hideout ('front'
 * framing: the 3D marquee top-left, the gang centre-left, the hero holding a 뿅망치):
 *
 *   right column   player card · big 게임 시작 (one press: quick match with the last setup, or the
 *                  practice on first launch) · mode cards 빠른 대전 / 라이벌 대회 / 연습 with live
 *                  status lines · "이어서 / 다음 목표" card (+ a small x to hide it)
 *   bottom-left    round dock buttons 옷장 · 설정 · 크레딧 · 종료
 *   bottom edge    LED news strip (offline headlines + honest update notes)
 *
 * Focus starts on 게임 시작 (first launch: the highlighted 연습 card, which replaces the old
 * first-run modal). Back returns to the title. Game flow forwards `onFocusItem` to the 3D gang
 * and runs the play ceremony + `vanWipe` when 게임 시작 is pressed.
 *
 * Portrait / phone width: a single column under the marquee, zoomed to the viewport width
 * with 16 px gutters (fonts keep a 14 px floor after the zoom).
 */
import '../styles/front.css';
import type { HatId, LayoutDef, TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h, isReducedMotion, setText, svgFromMarkup } from '../core/dom';
import { icon, type IconName, type RivalId } from '../core/icons';
import { navigable, uiSound } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chunky } from '../core/juice';
import { getUiRoot } from '../core/root';
import { glyphChip } from '../core/prompts';
import { layoutPortrait, objectPortrait, portrait } from '../core/portrait';
import { chip } from '../components/controls';
import { modeCard } from '../components/ModeCard';
import { playerCard, type PlayerCardModel } from '../components/PlayerCard';
import { nextGoalCard, type NextGoalView } from '../components/NextGoalCard';
import { newsTicker, type NewsItem } from '../components/NewsTicker';

export type MainMenuItem = 'play' | 'practice' | 'quickMatch' | 'tournament' | 'wardrobe' | 'settings' | 'credits' | 'quit' | 'goal';
export type FrontMode = 'quickMatch' | 'tournament' | 'practice';

export type { PlayerCardModel } from '../components/PlayerCard';
export type { NextGoalView, NextGoalKind } from '../components/NextGoalCard';
export type { NewsItem } from '../components/NewsTicker';

export interface MainMenuProps {
  onSelect: (item: MainMenuItem) => void;
  /** Back from the front door (return to the title). Omit to make Back focus 게임 시작. */
  onBack?: () => void;
  /** Show 종료 (desktop builds). Default true. */
  showQuit?: boolean;
  /** Player look (portrait on the player card). */
  hat?: HatId;
  team?: TeamId;
  /** Small badge per item, e.g. { wardrobe: 'common.new' }. */
  badges?: Partial<Record<MainMenuItem, TextRef>>;
  /** Focus on first show (default 'play'). */
  initialFocus?: MainMenuItem;
  /** The focused control changed (the 3D gang reacts). */
  onFocusItem?: (item: MainMenuItem) => void;
  /** Line under 게임 시작, e.g. "빠른 대전 · 1:1 · 랜덤 맵". */
  playSub?: TextRef | null;
  /** First launch: 게임 시작 leads to the practice, and the 연습 card carries the "여기부터!" flag. */
  firstRun?: boolean;
  player?: PlayerCardModel | null;
  /** Live status line per mode card. */
  modeStatus?: Partial<Record<FrontMode, TextRef | null>>;
  /** Layout snapshot for the 빠른 대전 card (null = the bank card). */
  quickArt?: LayoutDef | null;
  /** Rival on the 라이벌 대회 card (the next / current opponent). */
  tournamentRival?: RivalId | null;
  /** The "이어서 / 다음 목표" card (null = hidden). */
  nextGoal?: NextGoalView | null;
  /** Hide the next-goal card for this session. */
  onDismissGoal?: () => void;
  news?: readonly NewsItem[];
  /** The 3D marquee is on screen (false = draw the HTML wordmark instead). Default true. */
  logo3d?: boolean;
}

interface DockSpec {
  id: 'wardrobe' | 'settings' | 'credits' | 'quit';
  icon: IconName;
  tone: string;
  label: string;
}

/**
 * Dock, left to right: 종료 at the outer corner, 설정 next to the panel (so Down from the goal card
 * lands on it). Every control stays reachable with the arrows alone.
 */
const DOCK: readonly DockSpec[] = [
  { id: 'quit', icon: 'quit', tone: 'ash', label: 'menu.quit' },
  { id: 'credits', icon: 'star', tone: 'pink', label: 'front.credits' },
  { id: 'wardrobe', icon: 'wardrobe', tone: 'grape', label: 'menu.wardrobe' },
  { id: 'settings', icon: 'settings', tone: 'sky', label: 'menu.settings' },
];

/** Learning order left to right: 연습 -> 빠른 대전 (centre, under 게임 시작) -> 라이벌 대회. */
const MODES: readonly { id: FrontMode; tone: 'sun' | 'tomato' | 'mint'; title: string }[] = [
  { id: 'practice', tone: 'mint', title: 'menu.practice' },
  { id: 'quickMatch', tone: 'sun', title: 'menu.quickMatch' },
  { id: 'tournament', tone: 'tomato', title: 'menu.tournament' },
];

/** What the gang says about the focused control (speech bubble). */
const DESC: Record<string, string> = {
  play: 'front.play.desc',
  quickMatch: 'menu.quickMatch.desc',
  tournament: 'menu.tournament.desc',
  practice: 'menu.practice.desc',
  wardrobe: 'menu.wardrobe.desc',
  settings: 'menu.settings.desc',
  credits: 'front.credits.desc',
  quit: 'menu.quit.desc',
  goal: 'front.goal.desc',
  goalDismiss: 'front.goal.dismiss.desc',
};

/** Phone / portrait layout below this aspect ratio (width / height). */
const TALL_ASPECT = 0.8;

export class MainMenu extends UiScreen<MainMenuProps> {
  private bubble: HTMLElement | null = null;
  private bubbleText: HTMLElement | null = null;
  private lastItem: string | null = null;
  private frontEl: HTMLElement | null = null;
  private zoomEl: HTMLElement | null = null;

  constructor(props: MainMenuProps) {
    super(props, { name: 'menu' });
  }

  protected override defaultFocus(): string {
    return `menu:${this.props.initialFocus ?? 'play'}`;
  }

  private select(item: MainMenuItem): void {
    this.leave(() => this.props.onSelect(item));
  }

  protected render(): void {
    const p = this.props;
    const badges = p.badges ?? {};

    // --- 게임 시작 -------------------------------------------------------------------------------
    const play = navigable(
      h(
        'div',
        { class: ['uh-play', p.firstRun ? 'is-first' : ''], role: 'button' },
        h('span', { class: 'uh-play__icon', 'aria-hidden': 'true' }, icon('play')),
        h(
          'span',
          { class: 'uh-play__text' },
          h('span', { class: 'uh-play__label' }, t('front.play')),
          p.playSub ? h('span', { class: 'uh-play__sub' }, tr(p.playSub)) : null,
        ),
        h('span', { class: 'uh-play__glyph', 'aria-hidden': 'true' }, glyphChip('confirm')),
      ),
      'menu:play',
      { onActivate: () => this.select('play') },
    );

    // --- mode cards ------------------------------------------------------------------------------
    const art = (m: FrontMode): HTMLElement => {
      if (m === 'quickMatch') return (p.quickArt ? layoutPortrait(p.quickArt) : null) ?? objectPortrait('bank');
      if (m === 'tournament') return portrait({ rival: p.tournamentRival ?? 'hodadak', frame: 'head' });
      return objectPortrait('smallSafe');
    };
    const modes = h(
      'div',
      { class: 'uh-front__modes' },
      MODES.map((m) =>
        modeCard({
          id: `menu:${m.id}`,
          title: m.title,
          status: p.modeStatus?.[m.id] ?? null,
          art: art(m.id),
          tone: m.tone,
          badge: badges[m.id] ?? null,
          highlight: p.firstRun && m.id === 'practice' ? 'front.highlight' : null,
          onActivate: () => this.select(m.id),
        }),
      ),
    );

    // --- next goal ---------------------------------------------------------------------------------
    const goal = p.nextGoal
      ? nextGoalCard(p.nextGoal, {
          onActivate: () => this.select('goal'),
          onDismiss: p.onDismissGoal
            ? () => {
                const fn = p.onDismissGoal;
                // Hide in place (no screen change): focus falls back to 게임 시작.
                this.props = { ...this.props, nextGoal: null };
                this.rerender();
                this.focus.focus('menu:play', { sound: false });
                fn?.();
              }
            : undefined,
        })
      : null;

    const panel = h('div', { class: 'uh-front__panel' }, p.player ? playerCard(p.player) : null, play, modes, goal);

    // --- dock --------------------------------------------------------------------------------------
    const dock = h(
      'nav',
      { class: 'uh-front__dock' },
      DOCK.filter((d) => d.id !== 'quit' || p.showQuit !== false).map((d) => {
        const badge = badges[d.id];
        return navigable(
          h(
            'div',
            { class: ['uh-dock', `uh-dock--${d.tone}`], role: 'button' },
            h('span', { class: 'uh-dock__btn' }, icon(d.icon)),
            h('span', { class: 'uh-dock__label' }, t(d.label)),
            badge ? h('span', { class: 'uh-dock__badge' }, chip(badge, 'tomato')) : null,
          ),
          `menu:${d.id}`,
          { onActivate: () => this.select(d.id) },
        );
      }),
    );

    this.bubbleText = h('p', { class: 'uh-front__bubbleText' });
    this.bubble = h('aside', { class: 'uh-front__bubble' }, this.bubbleText);

    const ticker = p.news && p.news.length ? newsTicker(p.news) : null;
    const logo =
      p.logo3d === false
        ? h('div', { class: 'uh-front__logo', role: 'img', 'aria-label': t('game.title') }, chunky(t('game.title'), { cls: 'uh-front__logoWord', tone: 'sun', seed: 2 }), h('span', { class: 'uh-front__logoEn' }, t('game.titleEn')))
        : // The marquee is 3D; keep the name for assistive tech.
          h('h1', { class: 'uh-sr-only', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } }, t('game.title'));

    this.zoomEl = h('div', { class: 'uh-front__zoom' }, logo, h('div', { class: 'uh-front__spacer', 'aria-hidden': 'true' }), panel, dock, this.bubble, ticker?.el ?? null);
    this.frontEl = h('div', { class: 'uh-frame uh-front' }, h('div', { class: 'uh-front__inner' }, this.zoomEl));
    this.el.append(this.frontEl);
    if (ticker) this.own(ticker.start());
    const onResize = (): void => this.layoutTall();
    window.addEventListener('resize', onResize);
    this.own(() => window.removeEventListener('resize', onResize));
    this.layoutTall();
    this.paintDesc(this.focus.focusedId ?? this.defaultFocus(), false);
  }

  /** Portrait / phone: one zoomed column (16 px gutters) under the 3D marquee. */
  private layoutTall(): void {
    const front = this.frontEl;
    const zoom = this.zoomEl;
    if (!front || !zoom) return;
    const w = window.innerWidth || 1;
    const hgt = window.innerHeight || 1;
    const tall = w / hgt < TALL_ASPECT;
    front.classList.toggle('is-tall', tall);
    front.querySelector('.uh-front__inner')?.classList.toggle('uh-scroll', tall);
    if (!tall) {
      zoom.style.removeProperty('zoom');
      this.el.style.setProperty('--fz', '1');
      return;
    }
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // Design column: 45rem panel + 2 x gutter, filling the viewport width.
    const k = Math.max(1, w / (rem * 48));
    zoom.style.setProperty('zoom', k.toFixed(3));
    this.el.style.setProperty('--fz', k.toFixed(3));
    zoom.style.setProperty('--front-gutter', `${(16 / k).toFixed(2)}px`);
    // Room on top for the marquee (the tall framing puts it in the upper ~third).
    zoom.style.setProperty('--front-top', `${((hgt * 0.36) / k).toFixed(1)}px`);
  }

  protected override onBack(): boolean {
    if (this.props.onBack) {
      this.leave(this.props.onBack);
      return true;
    }
    return this.focus.focus('menu:play');
  }

  protected override onShow(): void {
    this.layoutTall();
    this.paintDesc(this.focus.focusedId, false);
  }

  protected override onFocusChanged(el: HTMLElement | null): void {
    this.paintDesc(el?.dataset.nav ?? null, true);
  }

  private paintDesc(navId: string | null, animate: boolean): void {
    if (!navId || !this.bubbleText || !this.bubble) return;
    const id = navId.replace('menu:', '');
    const key = id === 'play' && this.props.firstRun ? 'front.play.desc.first' : DESC[id];
    if (!key) return;
    setText(this.bubbleText, t(key));
    if (animate && id !== this.lastItem && !isReducedMotion()) {
      this.bubble.classList.remove('is-pop');
      void this.bubble.offsetWidth;
      this.bubble.classList.add('is-pop');
    }
    if (id !== this.lastItem) {
      this.lastItem = id;
      if (id !== 'goalDismiss') this.props.onFocusItem?.(id as MainMenuItem);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Van wipe: 게임 시작 -> loading. The gang's van drives across the screen pulling a striped
// curtain; `swap` runs while the screen is covered, then the van drives off the right edge.
// Reduced motion: a quick fade. Runs in the UiRoot 'wipe' layer (survives the screen swap).
// ---------------------------------------------------------------------------------------------

const VAN_SVG = `<svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g stroke="#2A2131" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
    <path d="M-40 70h52M-60 100h60M-30 130h44" fill="none" stroke="#FFF6E6" stroke-width="9" opacity=".9"/>
    <path d="M22 132V58c0-14 10-24 24-24h150c12 0 22 6 29 16l38 50c6 8 9 15 9 24v8c0 8-6 14-14 14H36c-8 0-14-6-14-14z" fill="#FF8A3D"/>
    <path d="M196 46h-8c-6 0-10 4-10 10v34c0 4 3 7 7 7h62c5 0 7-5 4-9l-28-34c-6-6-14-8-27-8z" fill="#ADDCFF"/>
    <rect x="48" y="50" width="108" height="42" rx="12" fill="#FFF6E6"/>
    <path d="M22 112h250" fill="none"/>
    <circle cx="80" cy="140" r="24" fill="#2A2131"/><circle cx="80" cy="140" r="9" fill="#CFC4DD"/>
    <circle cx="228" cy="140" r="24" fill="#2A2131"/><circle cx="228" cy="140" r="9" fill="#CFC4DD"/>
    <polygon points="102,57 108,69 121,70 111,79 114,92 102,85 90,92 93,79 83,70 96,69" fill="#FFD23F" stroke-width="5"/>
    <rect x="254" y="104" width="22" height="12" rx="5" fill="#FFE88A" stroke-width="5"/>
    <path d="M60 34c4-12 14-18 28-18h40c14 0 22 6 26 18z" fill="#FF5A4E"/>
  </g>
</svg>`;

let vanBusy = false;

export function vanWipe(swap: () => void): void {
  let swapped = false;
  const doSwap = (): void => {
    if (swapped) return;
    swapped = true;
    try {
      swap();
    } catch (err) {
      console.error('[ui] van wipe swap failed', err);
    }
  };
  if (vanBusy) {
    doSwap();
    return;
  }
  let layer: HTMLElement;
  try {
    layer = getUiRoot().layer('wipe');
  } catch {
    doSwap();
    return;
  }
  vanBusy = true;
  const reduced = isReducedMotion();
  const van = h('div', { class: 'uh-vanwipe__van' }, svgFromMarkup(VAN_SVG));
  const curtain = h('div', { class: 'uh-vanwipe__curtain' }, van);
  const fade = h('div', { class: 'uh-vanwipe__fade' });
  const el = h('div', { class: 'uh-vanwipe', 'aria-hidden': 'true' }, reduced ? fade : curtain);
  layer.appendChild(el);
  const finish = (): void => {
    el.remove();
    vanBusy = false;
  };
  // Failsafe: a stalled animation (hidden window) never holds the match back.
  const guard = window.setTimeout(() => {
    doSwap();
    finish();
  }, 3000);
  const frames = (n: number): Promise<void> => new Promise((r) => (n <= 0 ? r() : requestAnimationFrame(() => void frames(n - 1).then(r))));
  const run = async (): Promise<void> => {
    if (reduced || typeof el.animate !== 'function') {
      await fade.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'forwards' }).finished.catch(() => undefined);
      doSwap();
      await frames(2);
      await fade.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished.catch(() => undefined);
      return;
    }
    uiSound('whoosh');
    await curtain
      .animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(0%)' }], { duration: 430, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'forwards' })
      .finished.catch(() => undefined);
    van.animate([{ rotate: '0deg' }, { rotate: '-4deg' }, { rotate: '0deg' }], { duration: 220 });
    doSwap();
    await frames(2);
    await new Promise((r) => window.setTimeout(r, 120));
    uiSound('pop');
    await curtain
      .animate([{ transform: 'translateX(0%)' }, { transform: 'translateX(115%)' }], { duration: 520, easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)', fill: 'forwards' })
      .finished.catch(() => undefined);
  };
  void run().finally(() => {
    window.clearTimeout(guard);
    doSwap();
    finish();
  });
}
