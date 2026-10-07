/**
 * Front door (C10, calm pass). One focal point over the live rooftop hideout:
 *
 *   left column   the logo lockup, one big 게임 시작 (one press: quick match with the last
 *                 setup, or the practice on first launch) with a small "맵·상대 바꾸기" link
 *                 beside it, a caption naming that setup, an optional one-line next goal (with
 *                 an x to hide it), then a short quiet list:
 *                 빠른 대전 · 연습 · 라이벌 대회 | 옷장 · 설정 · 크레딧 · 종료
 *   top right     a small chip with the player's portrait and rank title (not a control)
 *   bottom left   one quiet line saying what the focused item does
 *
 * The 3D gang stands in the right half. Under the UI the scene goes a touch softer (a fading
 * blur behind the column, slightly less saturation / contrast, a dusk scrim) so text reads at
 * a glance. Focus
 * starts on 게임 시작. Back returns to the title. Game flow forwards `onFocusItem` to the 3D
 * scene (only 게임 시작 gets a reaction) and runs the play ceremony + `vanWipe` on 게임 시작.
 *
 * Everything sits in normal flow inside the 16:9 `.uh-frame`, so the shared shrink-to-fit
 * keeps the column whole at 140 % UI scale. Portrait / phone width stacks the same column at
 * the bottom with 16 px gutters (the gang stays visible above it).
 */
import '../styles/front.css';
import type { HatId, TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h, isReducedMotion, setText, svgFromMarkup } from '../core/dom';
import { icon } from '../core/icons';
import { navigable, uiSound } from '../core/nav';
import { UiScreen } from '../core/screen';
import { getUiRoot } from '../core/root';
import { playerChip, type PlayerChipModel } from '../components/PlayerCard';
import { nextGoalLine, type NextGoalView } from '../components/NextGoalCard';
import { logoLockup } from './TitleScreen';

export type MainMenuItem = 'play' | 'practice' | 'quickMatch' | 'together' | 'tournament' | 'wardrobe' | 'settings' | 'credits' | 'quit' | 'goal';

export type { PlayerChipModel } from '../components/PlayerCard';
export type { NextGoalView, NextGoalKind } from '../components/NextGoalCard';

export interface MainMenuProps {
  onSelect: (item: MainMenuItem) => void;
  /** Back from the front door (return to the title). Omit to make Back focus 게임 시작. */
  onBack?: () => void;
  /** Show 종료 (desktop builds). Default true. */
  showQuit?: boolean;
  /** Player look: a plain corner chip (rookie title) when `player` is omitted. */
  hat?: HatId;
  team?: TeamId;
  /** Small badge per list item, e.g. { wardrobe: 'common.new' }. */
  badges?: Partial<Record<MainMenuItem, TextRef>>;
  /** Focus on first show (default 'play'). */
  initialFocus?: MainMenuItem;
  /** The focused control changed (the 3D scene may react). */
  onFocusItem?: (item: MainMenuItem) => void;
  /** Caption under 게임 시작, e.g. "빠른 대전 · 1:1 · 랜덤 맵". */
  playSub?: TextRef | null;
  /** First launch: 게임 시작 leads to the practice (and the setup link is hidden). */
  firstRun?: boolean;
  /** Corner chip (portrait + rank title). null = none. */
  player?: PlayerChipModel | null;
  /** One short next-goal line under 게임 시작 (null = hidden). */
  nextGoal?: NextGoalView | null;
  /** Hide the next-goal line for this session. */
  onDismissGoal?: () => void;
  /**
   * Soften the 3D behind the UI with backdrop filters (blur + less saturation). Default true;
   * game flow turns it off at low graphics quality (only the plain scrim is drawn then).
   */
  softBackdrop?: boolean;
}

type ListId = 'quickMatch' | 'together' | 'practice' | 'tournament' | 'wardrobe' | 'settings' | 'credits' | 'quit';

/** The quiet list, in two groups: ways to play, then the rest. */
const LIST: readonly (readonly { id: ListId; label: string }[])[] = [
  [
    { id: 'quickMatch', label: 'menu.quickMatch' },
    { id: 'together', label: 'menu.together' },
    { id: 'practice', label: 'menu.practice' },
    { id: 'tournament', label: 'menu.tournament' },
  ],
  [
    { id: 'wardrobe', label: 'menu.wardrobe' },
    { id: 'settings', label: 'menu.settings' },
    { id: 'credits', label: 'front.credits' },
    { id: 'quit', label: 'menu.quit' },
  ],
];

/** One quiet line about the focused control. */
const DESC: Record<string, string> = {
  play: 'front.play.desc',
  change: 'front.play.change.desc',
  quickMatch: 'menu.quickMatch.desc',
  together: 'menu.together.desc',
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
  private hint: HTMLElement | null = null;
  private lastItem: string | null = null;
  private frontEl: HTMLElement | null = null;
  private zoomEl: HTMLElement | null = null;

  constructor(props: MainMenuProps) {
    super(props, { name: 'menu' });
  }

  protected override defaultFocus(): string {
    const f = this.props.initialFocus ?? 'play';
    return `menu:${f === 'goal' && !this.props.nextGoal ? 'play' : f}`;
  }

  private select(item: MainMenuItem): void {
    this.leave(() => this.props.onSelect(item));
  }

  protected render(): void {
    const p = this.props;
    const badges = p.badges ?? {};

    // --- 게임 시작 (the one accent on the screen) -----------------------------------------------
    const play = navigable(
      h(
        'div',
        { class: 'uh-play', role: 'button', 'aria-describedby': p.playSub ? 'uh-front-caption' : null },
        h('span', { class: 'uh-play__icon', 'aria-hidden': 'true' }, icon('play')),
        h('span', { class: 'uh-play__label' }, t('front.play')),
      ),
      'menu:play',
      { onActivate: () => this.select('play') },
    );

    // the small link next to it (change the setup 게임 시작 replays) + the caption naming that setup
    const change = p.firstRun
      ? null
      : navigable(
          h('span', { class: 'uh-front__link', role: 'button' }, h('span', null, t('front.play.change')), icon('chevRight')),
          'menu:change',
          { onActivate: () => this.select('quickMatch') },
        );
    const playRow = h('div', { class: 'uh-front__playRow' }, play, change);
    const caption = p.playSub ? h('p', { class: 'uh-front__caption', id: 'uh-front-caption' }, tr(p.playSub)) : null;

    // --- next goal (one dismissible line) ----------------------------------------------------------
    const goal = p.nextGoal
      ? nextGoalLine(p.nextGoal, {
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

    // --- the quiet list ----------------------------------------------------------------------------
    const groups = LIST.map((group) =>
      h(
        'div',
        { class: 'uh-front__group', role: 'group' },
        group
          .filter((it) => it.id !== 'quit' || p.showQuit !== false)
          .map((it) => {
            const badge = badges[it.id];
            return navigable(
              h(
                'div',
                { class: 'uh-mitem', role: 'button' },
                h('span', { class: 'uh-mitem__label' }, t(it.label)),
                badge ? h('span', { class: 'uh-mitem__badge' }, tr(badge)) : null,
              ),
              `menu:${it.id}`,
              { onActivate: () => this.select(it.id) },
            );
          }),
      ),
    );
    const list = h('nav', { class: 'uh-front__list', 'aria-label': t('front.menu.aria') }, groups);

    // --- frame -------------------------------------------------------------------------------------
    const logo = logoLockup({ compact: true, cls: 'uh-front__logo' });
    const me = p.player === undefined ? (p.hat ? { hat: p.hat, team: p.team ?? 0, rank: 'front.player.rank.0' } : null) : p.player;
    const chip = me ? playerChip(me) : null;
    this.hint = h('p', { class: 'uh-front__hint', 'aria-live': 'polite' });
    this.zoomEl = h(
      'div',
      { class: 'uh-front__zoom' },
      h('header', { class: 'uh-front__top' }, logo, chip),
      h('div', { class: 'uh-front__main' }, h('div', { class: 'uh-front__hero' }, playRow, caption, goal), list),
      h('footer', { class: 'uh-front__foot' }, this.hint),
    );
    this.frontEl = h('div', { class: 'uh-frame uh-front' }, this.zoomEl);
    // Backdrop treatment (under the UI): the left side of the 3D goes soft and the whole scene a
    // touch calmer (less saturation / contrast), then a dusk scrim behind the column.
    this.el.classList.toggle('is-lite', p.softBackdrop === false);
    this.el.append(h('div', { class: 'uh-front__soften', 'aria-hidden': 'true' }), h('div', { class: 'uh-front__scrim', 'aria-hidden': 'true' }), this.frontEl);
    const onResize = (): void => this.layoutTall();
    window.addEventListener('resize', onResize);
    this.own(() => window.removeEventListener('resize', onResize));
    this.layoutTall();
    this.paintDesc(this.focus.focusedId ?? this.defaultFocus());
  }

  /**
   * Portrait / phone: the column moves to the bottom and is zoomed to fill the width with 16 px
   * gutters (rem follows the short side, so it would be tiny otherwise). Font floors divide by
   * --fz so nothing renders under 14 px after the zoom.
   */
  private layoutTall(): void {
    const zoom = this.zoomEl;
    if (!zoom) return;
    const w = window.innerWidth || 1;
    const hgt = window.innerHeight || 1;
    const tall = w / hgt < TALL_ASPECT;
    this.el.classList.toggle('is-tall', tall);
    if (!tall) {
      for (const k of ['zoom', 'height', 'padding']) zoom.style.removeProperty(k);
      this.el.style.setProperty('--fz', '1');
      return;
    }
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // Design column: 30rem between two 16 px gutters.
    const k = Math.max(1, (w - 32) / (rem * 30));
    zoom.style.setProperty('zoom', k.toFixed(3));
    zoom.style.setProperty('height', `${(hgt / k).toFixed(1)}px`);
    zoom.style.setProperty('padding', `${(24 / k).toFixed(2)}px ${(16 / k).toFixed(2)}px`);
    this.el.style.setProperty('--fz', k.toFixed(3));
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
    this.paintDesc(this.focus.focusedId);
  }

  protected override onFocusChanged(el: HTMLElement | null): void {
    this.paintDesc(el?.dataset.nav ?? null);
  }

  private paintDesc(navId: string | null): void {
    if (!navId || !this.hint) return;
    const id = navId.replace('menu:', '');
    const key = id === 'play' && this.props.firstRun ? 'front.play.desc.first' : DESC[id];
    if (!key) return;
    setText(this.hint, t(key));
    if (id !== this.lastItem) {
      this.lastItem = id;
      if (id === 'change') this.props.onFocusItem?.('quickMatch');
      else if (id !== 'goalDismiss') this.props.onFocusItem?.(id as MainMenuItem);
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
