/**
 * Main menu: 연습 · 빠른 대전 · 라이벌 대회 · 옷장 · 설정 · 종료 as chunky sticker signboards
 * nailed up on the left (each tilted a little differently, each its own pop colour), over the live
 * rooftop hideout where the gang reacts to the highlighted sign (game flow forwards
 * `onFocusItem` to the 3D scene). The focused sign's description pops up as a speech bubble
 * from the gang.
 */
import type { HatId, TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h, setText } from '../core/dom';
import { icon, type IconName } from '../core/icons';
import { navigable } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chunky } from '../core/juice';
import { chip, promptBar, stagger } from '../components/controls';

export type MainMenuItem = 'practice' | 'quickMatch' | 'tournament' | 'wardrobe' | 'settings' | 'quit';

export interface MainMenuProps {
  onSelect: (item: MainMenuItem) => void;
  /** Back from the main menu (e.g. return to title). Omit to make Back focus "종료". */
  onBack?: () => void;
  /** Hide 종료 (e.g. browser builds). Default true. */
  showQuit?: boolean;
  /** Player look (kept for callers; the 3D hideout shows the raccoon). */
  hat?: HatId;
  team?: TeamId;
  /** Small badge per item, e.g. { tournament: { key: 'tournament.round', params: { n: 2 } } } or 'common.new'. */
  badges?: Partial<Record<MainMenuItem, TextRef>>;
  /** Focus on first show (default 'quickMatch' — the fastest way into a match). */
  initialFocus?: MainMenuItem;
  /** The highlighted sign changed (the 3D gang reacts). */
  onFocusItem?: (item: MainMenuItem) => void;
}

const ITEMS: readonly { id: MainMenuItem; icon: IconName; tone: string; tilt: number }[] = [
  { id: 'practice', icon: 'practice', tone: 'mint', tilt: -2.2 },
  { id: 'quickMatch', icon: 'quick', tone: 'sun', tilt: 1.6 },
  { id: 'tournament', icon: 'tournament', tone: 'tomato', tilt: -1.4 },
  { id: 'wardrobe', icon: 'wardrobe', tone: 'grape', tilt: 2.2 },
  { id: 'settings', icon: 'settings', tone: 'sky', tilt: -1.8 },
  { id: 'quit', icon: 'quit', tone: 'ash', tilt: 1.2 },
];

const LABEL: Record<MainMenuItem, string> = {
  practice: 'menu.practice',
  quickMatch: 'menu.quickMatch',
  tournament: 'menu.tournament',
  wardrobe: 'menu.wardrobe',
  settings: 'menu.settings',
  quit: 'menu.quit',
};

export class MainMenu extends UiScreen<MainMenuProps> {
  private bubble: HTMLElement | null = null;
  private bubbleTitle: HTMLElement | null = null;
  private bubbleBody: HTMLElement | null = null;
  private lastItem: MainMenuItem | null = null;

  constructor(props: MainMenuProps) {
    super(props, { name: 'menu' });
  }

  protected override defaultFocus(): string {
    return `menu:${this.props.initialFocus ?? 'quickMatch'}`;
  }

  protected render(): void {
    const items = ITEMS.filter((i) => i.id !== 'quit' || this.props.showQuit !== false);
    const list = h(
      'nav',
      { class: 'uh-menu__list' },
      items.map((it, i) => {
        const badge = this.props.badges?.[it.id];
        const el = h(
          'div',
          { class: ['uh-sign', `uh-sign--${it.tone}`, it.id === 'quit' ? 'uh-sign--small' : ''], role: 'button', style: { '--tilt': `${it.tilt}deg`, '--i': String(i) } },
          h('span', { class: 'uh-sign__nail uh-sign__nail--l', 'aria-hidden': 'true' }),
          h('span', { class: 'uh-sign__nail uh-sign__nail--r', 'aria-hidden': 'true' }),
          h('span', { class: 'uh-sign__icon' }, icon(it.icon)),
          h('span', { class: 'uh-sign__label' }, t(LABEL[it.id])),
          badge ? h('span', { class: 'uh-sign__badge' }, chip(badge, 'tomato')) : null,
        );
        return navigable(el, `menu:${it.id}`, {
          // One-shot: re-armed when this menu is shown again or a screen/dialog above it closes.
          onActivate: () => this.leave(() => this.props.onSelect(it.id)),
        });
      }),
    );
    stagger(list);

    this.bubbleTitle = h('div', { class: 'uh-menu__bubbleTitle' });
    this.bubbleBody = h('p', { class: 'uh-menu__bubbleBody' });
    this.bubble = h('aside', { class: 'uh-menu__bubble uh-bubble' }, this.bubbleTitle, this.bubbleBody);

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-menu' },
        h(
          'div',
          { class: 'uh-menu__brand' },
          chunky(t('game.title'), { cls: 'uh-menu__logo', tone: 'sun', seed: 1 }),
          h('span', { class: 'uh-menu__logoEn' }, t('game.titleEn')),
        ),
        h('div', { class: 'uh-menu__body' }, list),
        this.bubble,
        promptBar([
          { action: 'navigate', label: 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.select' },
        ]),
      ),
    );
    this.paintDesc(this.focus.focusedId ?? this.defaultFocus(), false);
  }

  protected override onBack(): boolean {
    if (this.props.onBack) {
      this.leave(this.props.onBack);
      return true;
    }
    if (this.props.showQuit === false) return false;
    return this.focus.focus('menu:quit');
  }

  protected override onShow(): void {
    this.paintDesc(this.focus.focusedId, false);
  }

  protected override onFocusChanged(el: HTMLElement | null): void {
    this.paintDesc(el?.dataset.nav ?? null, true);
  }

  private paintDesc(navId: string | null, animate: boolean): void {
    if (!navId || !this.bubbleTitle || !this.bubbleBody || !this.bubble) return;
    const id = navId.replace('menu:', '') as MainMenuItem;
    const spec = ITEMS.find((i) => i.id === id);
    if (!spec) return;
    setText(this.bubbleTitle, t(LABEL[id]));
    setText(this.bubbleBody, tr(`${LABEL[id]}.desc`));
    this.bubble.dataset.tone = spec.tone;
    if (animate && id !== this.lastItem) {
      this.bubble.classList.remove('is-pop');
      void this.bubble.offsetWidth;
      this.bubble.classList.add('is-pop');
    }
    if (id !== this.lastItem) {
      this.lastItem = id;
      this.props.onFocusItem?.(id);
    }
  }
}
