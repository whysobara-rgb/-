/**
 * Rival tournament ladder (doc §12): 호다닥 → 통큰이 → 눈치왕, each best of 3 on a fixed
 * layout. Cards show locked / available / in progress / cleared, the series score pips,
 * the layout name and the reward hat preview. Progress is never reset on a loss.
 */
import type { HatId } from '../../sim/types';
import { t } from '../i18n';
import { h } from '../core/dom';
import { icon, raccoon, teamEmblem } from '../core/icons';
import { navigable } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chip, promptBar, screenHeader, stagger } from '../components/controls';
import type { RivalId } from '../types';

export type TournamentCardState = 'locked' | 'available' | 'inProgress' | 'cleared';

export interface TournamentRivalCard {
  rival: RivalId;
  state: TournamentCardState;
  /** Current (or best finished) series score; draws are not counted. */
  playerWins: number;
  rivalWins: number;
  /** i18n key of the layout used for this rival's series. */
  layoutNameKey: string;
  rewardHat: HatId;
  /** True once the hat is in the wardrobe. */
  rewardOwned?: boolean;
}

export interface TournamentScreenProps {
  rivals: readonly TournamentRivalCard[];
  /** All three cleared: show the champion banner. */
  complete?: boolean;
  onSelect: (rival: RivalId) => void;
  onBack: () => void;
  initialFocus?: RivalId;
}

const STATE_ICON = { locked: 'lock', available: 'play', inProgress: 'flag', cleared: 'check' } as const;

function pips(count: number, filled: number, kind: 'you' | 'rival'): HTMLElement {
  return h(
    'span',
    { class: `uh-spips uh-spips--${kind}` },
    Array.from({ length: count }, (_, i) => h('span', { class: ['uh-spip', i < filled ? 'is-on' : ''] })),
  );
}

/** "나 ●○ : ○○ 호다닥" — best-of-3 needs 2 wins. */
export function seriesPips(playerWins: number, rivalWins: number, rival: RivalId): HTMLElement {
  return h(
    'div',
    { class: 'uh-seriespips' },
    h('span', { class: 'uh-seriespips__who' }, teamEmblem(0), t('series.you')),
    pips(2, playerWins, 'you'),
    h('span', { class: 'uh-seriespips__colon' }, ':'),
    pips(2, rivalWins, 'rival'),
    h('span', { class: 'uh-seriespips__who' }, t(`rival.${rival}.name`)),
  );
}

export class TournamentScreen extends UiScreen<TournamentScreenProps> {
  constructor(props: TournamentScreenProps) {
    super(props, { name: 'tournament', wrapNav: false });
  }

  protected override defaultFocus(): string | null {
    if (this.props.initialFocus) return `rival:${this.props.initialFocus}`;
    const next = this.props.rivals.find((r) => r.state === 'inProgress' || r.state === 'available');
    return `rival:${(next ?? this.props.rivals[0])?.rival}`;
  }

  protected override onBack(): boolean {
    this.props.onBack();
    return true;
  }

  protected render(): void {
    const cards = h(
      'div',
      { class: 'uh-tour__cards' },
      this.props.rivals.map((c, i) => {
        const locked = c.state === 'locked';
        const actionKey =
          c.state === 'inProgress' ? 'tournament.resume' : c.state === 'cleared' ? 'tournament.rechallenge' : 'tournament.challenge';
        const card = h(
          'article',
          { class: ['uh-tourcard', `uh-tourcard--${c.state}`, `uh-tourcard--${c.rival}`], 'aria-disabled': locked ? 'true' : null },
          h(
            'div',
            { class: 'uh-tourcard__top' },
            h('span', { class: 'uh-tourcard__round' }, t('tournament.round', { n: i + 1 })),
            h('span', { class: `uh-tourcard__state uh-tourcard__state--${c.state}` }, icon(STATE_ICON[c.state]), t(`tournament.state.${c.state}`)),
          ),
          h(
            'div',
            { class: 'uh-tourcard__portrait' },
            raccoon(locked ? { rival: c.rival, silhouette: true } : { rival: c.rival, team: 1 }),
            c.state === 'cleared' ? h('div', { class: 'uh-tourcard__stamp' }, icon('check'), t('tournament.state.cleared')) : null,
          ),
          h('h2', { class: 'uh-tourcard__name' }, locked ? '???' : t(`rival.${c.rival}.name`)),
          h('p', { class: 'uh-tourcard__title' }, locked ? t('tournament.lockedHint') : t(`rival.${c.rival}.title`)),
          h(
            'div',
            { class: 'uh-tourcard__meta' },
            chip(locked ? 'common.locked' : c.layoutNameKey, 'ghost', 'map'),
            chip('tournament.bestOf3', 'ghost', 'trophy'),
          ),
          seriesPips(c.playerWins, c.rivalWins, c.rival),
          h(
            'div',
            { class: 'uh-tourcard__reward' },
            h('div', { class: 'uh-tourcard__rewardArt' }, raccoon({ hat: c.rewardHat, silhouette: !c.rewardOwned && locked, expression: 'happy' })),
            h(
              'div',
              { class: 'uh-tourcard__rewardText' },
              h('span', { class: 'uh-tourcard__rewardLabel' }, icon('hat'), t('tournament.reward')),
              h('span', { class: 'uh-tourcard__rewardName' }, t(`hat.${c.rewardHat}.name`)),
            ),
            c.rewardOwned ? h('span', { class: 'uh-tourcard__owned' }, icon('check')) : null,
          ),
          h('div', { class: 'uh-tourcard__cta' }, locked ? icon('lock') : icon('play'), t(locked ? 'common.locked' : actionKey)),
        );
        return navigable(card, `rival:${c.rival}`, {
          onActivate: () => this.props.onSelect(c.rival),
        });
      }),
    );
    // Arrows between the cards: 호다닥 → 통큰이 → 눈치왕
    const withArrows = h('div', { class: 'uh-tour__row' });
    Array.from(cards.children).forEach((c, i) => {
      if (i > 0) withArrows.appendChild(h('div', { class: 'uh-tour__arrow', 'aria-hidden': 'true' }, icon('chevRight')));
      withArrows.appendChild(c);
    });
    stagger(withArrows);

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-tour' },
        screenHeader(
          'tournament.title',
          'tournament.subtitle',
          'tournament',
          this.props.complete ? h('div', { class: 'uh-tour__champ' }, icon('trophy'), t('tournament.complete')) : null,
        ),
        withArrows,
        h('p', { class: 'uh-tour__note' }, icon('sparkle'), t('tournament.drawNote')),
        promptBar([
          { action: 'navigate', label: 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.select' },
          { action: 'back', label: 'prompt.back', onClick: () => this.props.onBack() },
        ]),
      ),
    );
  }
}
