/**
 * Main menu: 연습 · 빠른 대전 · 라이벌 대회 · 옷장 · 설정 · 종료.
 * Left: chunky item list. Right: description card for the focused item + the player's
 * raccoon in the equipped hat.
 */
import type { HatId, TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h, setText } from '../core/dom';
import { icon, raccoon, type IconName } from '../core/icons';
import { navigable } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chip, promptBar, stagger } from '../components/controls';

export type MainMenuItem = 'practice' | 'quickMatch' | 'tournament' | 'wardrobe' | 'settings' | 'quit';

export interface MainMenuProps {
  onSelect: (item: MainMenuItem) => void;
  /** Back from the main menu (e.g. return to title). Omit to make Back focus "종료". */
  onBack?: () => void;
  /** Hide 종료 (e.g. browser builds). Default true. */
  showQuit?: boolean;
  /** Player look for the mascot card. */
  hat?: HatId;
  team?: TeamId;
  /** Small badge per item, e.g. { tournament: { key: 'tournament.round', params: { n: 2 } } } or 'common.new'. */
  badges?: Partial<Record<MainMenuItem, TextRef>>;
  /** Focus on first show (default 'quickMatch' — the fastest way into a match). */
  initialFocus?: MainMenuItem;
}

const ITEMS: readonly { id: MainMenuItem; icon: IconName; tone: string }[] = [
  { id: 'practice', icon: 'practice', tone: 'mint' },
  { id: 'quickMatch', icon: 'quick', tone: 'gold' },
  { id: 'tournament', icon: 'tournament', tone: 'coral' },
  { id: 'wardrobe', icon: 'wardrobe', tone: 'lilac' },
  { id: 'settings', icon: 'settings', tone: 'sky' },
  { id: 'quit', icon: 'quit', tone: 'ash' },
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
  private descTitle: HTMLElement | null = null;
  private descBody: HTMLElement | null = null;
  private descIcon: HTMLElement | null = null;

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
      items.map((it) => {
        const badge = this.props.badges?.[it.id];
        const el = h(
          'div',
          { class: ['uh-menuitem', `uh-menuitem--${it.tone}`, it.id === 'quit' ? 'uh-menuitem--quit' : ''], role: 'button' },
          h('span', { class: 'uh-menuitem__tile' }, icon(it.icon)),
          h('span', { class: 'uh-menuitem__label' }, t(LABEL[it.id])),
          badge ? h('span', { class: 'uh-menuitem__badge' }, chip(badge, 'gold')) : null,
          h('span', { class: 'uh-menuitem__paw', 'aria-hidden': 'true' }, icon('chevRight')),
        );
        return navigable(el, `menu:${it.id}`, {
          onActivate: () => this.props.onSelect(it.id),
        });
      }),
    );
    stagger(list);

    this.descIcon = h('div', { class: 'uh-menu__descIcon' });
    this.descTitle = h('h2', { class: 'uh-menu__descTitle' });
    this.descBody = h('p', { class: 'uh-menu__descBody' });
    const mascot = h(
      'div',
      { class: 'uh-menu__mascot' },
      raccoon({ hat: this.props.hat ?? 'teamCapA', team: this.props.team ?? 0, expression: 'happy' }),
    );
    const card = h('aside', { class: 'uh-menu__card uh-panel' }, this.descIcon, this.descTitle, this.descBody);

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-menu' },
        h(
          'div',
          { class: 'uh-menu__brand' },
          h('span', { class: 'uh-menu__logo uh-outline-text' }, t('game.title')),
          h('span', { class: 'uh-menu__logoEn' }, t('game.titleEn')),
        ),
        h('div', { class: 'uh-menu__body' }, list, h('div', { class: 'uh-menu__side' }, card, mascot)),
        promptBar([
          { action: 'navigate', label: 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.select' },
        ]),
      ),
    );
    this.paintDesc(this.focus.focusedId ?? this.defaultFocus());
  }

  protected override onBack(): boolean {
    if (this.props.onBack) {
      this.props.onBack();
      return true;
    }
    if (this.props.showQuit === false) return false;
    return this.focus.focus('menu:quit');
  }

  protected override onShow(): void {
    this.paintDesc(this.focus.focusedId);
  }

  protected override onFocusChanged(el: HTMLElement | null): void {
    this.paintDesc(el?.dataset.nav ?? null);
  }

  private paintDesc(navId: string | null): void {
    if (!navId || !this.descTitle || !this.descBody || !this.descIcon) return;
    const id = navId.replace('menu:', '') as MainMenuItem;
    const spec = ITEMS.find((i) => i.id === id);
    if (!spec) return;
    setText(this.descTitle, t(LABEL[id]));
    setText(this.descBody, tr(`${LABEL[id]}.desc`));
    this.descIcon.className = `uh-menu__descIcon uh-menuitem--${spec.tone}`;
    this.descIcon.replaceChildren(icon(spec.icon));
  }
}
