/**
 * Rival tournament ladder (doc §12): 호다닥 → 통큰이 → 눈치왕, each best of 3 on a fixed
 * layout. The rivals stand on 3D stage pedestals under spotlights (menu3d TournamentScene; game
 * flow forwards `onFocusRival` so the highlighted rival hops into its signature move). Under each
 * pedestal a sticker card shows locked / ready / in progress / cleared, the series pips, the
 * layout and the reward hat. Beaten rivals get a big "잡았다!" rubber stamp. Progress is never
 * reset on a loss.
 */
import type { HatId } from '../../sim/types';
import { t } from '../i18n';
import { h } from '../core/dom';
import { icon, teamEmblem } from '../core/icons';
import { portrait } from '../core/portrait';
import { navigable } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chunky, slamIn, stamp } from '../core/juice';
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
  /** The highlighted rival changed (the 3D stage reacts). */
  onFocusRival?: (rival: RivalId) => void;
}

const STATE_ICON = { locked: 'lock', available: 'play', inProgress: 'flag', cleared: 'check' } as const;

function pips(count: number, filled: number, kind: 'you' | 'rival'): HTMLElement {
  return h(
    'span',
    { class: `uh-spips uh-spips--${kind}` },
    Array.from({ length: count }, (_, i) => h('span', { class: ['uh-spip', i < filled ? 'is-on' : ''] }, i < filled ? icon(kind === 'you' ? 'star' : 'moon') : null)),
  );
}

/** "나 ●○ : ○○ 호다닥" — best-of-3 needs 2 wins. `hideName`: locked card ('???', no spoiler). */
export function seriesPips(playerWins: number, rivalWins: number, rival: RivalId, hideName = false): HTMLElement {
  return h(
    'div',
    { class: 'uh-seriespips' },
    h('span', { class: 'uh-seriespips__who' }, teamEmblem(0), t('series.you')),
    pips(2, playerWins, 'you'),
    h('span', { class: 'uh-seriespips__colon' }, ':'),
    pips(2, rivalWins, 'rival'),
    h('span', { class: 'uh-seriespips__who' }, hideName ? '???' : t(`rival.${rival}.name`)),
  );
}

export class TournamentScreen extends UiScreen<TournamentScreenProps> {
  private lastFocus: RivalId | null = null;

  constructor(props: TournamentScreenProps) {
    super(props, { name: 'tournament', wrapNav: false });
  }

  protected override defaultFocus(): string | null {
    if (this.props.initialFocus) return `rival:${this.props.initialFocus}`;
    const next = this.props.rivals.find((r) => r.state === 'inProgress' || r.state === 'available');
    return `rival:${(next ?? this.props.rivals[0])?.rival}`;
  }

  protected override onBack(): boolean {
    this.leave(this.props.onBack);
    return true;
  }

  protected override onFocusChanged(el: HTMLElement | null): void {
    const id = el?.dataset.nav?.replace('rival:', '') as RivalId | undefined;
    if (id && id !== this.lastFocus) {
      this.lastFocus = id;
      this.props.onFocusRival?.(id);
    }
  }

  protected override onShow(): void {
    // Stamps slam in once the cards have landed.
    this.el.querySelectorAll<HTMLElement>('.uh-tourcard__stamp').forEach((s, i) => slamIn(s, 420 + i * 120, -11));
    const id = this.focus.focusedId?.replace('rival:', '') as RivalId | undefined;
    if (id) this.onFocusChanged(this.focus.focused);
  }

  protected render(): void {
    const cards = h(
      'div',
      { class: 'uh-tour__row' },
      this.props.rivals.map((c, i) => {
        const locked = c.state === 'locked';
        const actionKey = c.state === 'inProgress' ? 'tournament.resume' : c.state === 'cleared' ? 'tournament.rechallenge' : 'tournament.challenge';
        const card = h(
          'article',
          {
            class: ['uh-tourcard', `uh-tourcard--${c.state}`, `uh-tourcard--${c.rival}`],
            'aria-disabled': locked ? 'true' : null,
            'data-paw': 'top',
            style: { '--tilt': `${[-1.5, 1, -1][i] ?? 0}deg`, '--i': String(i) },
          },
          h(
            'div',
            { class: 'uh-tourcard__top' },
            h('span', { class: 'uh-tourcard__round' }, t('tournament.round', { n: i + 1 })),
            h('span', { class: `uh-tourcard__state uh-tourcard__state--${c.state}` }, icon(STATE_ICON[c.state]), t(`tournament.state.${c.state}`)),
          ),
          chunky(locked ? '???' : t(`rival.${c.rival}.name`), { tag: 'h2', cls: 'uh-tourcard__name', tone: locked ? 'cream' : 'cream', seed: i }),
          h('p', { class: 'uh-tourcard__title' }, locked ? t('tournament.lockedHint') : t(`rival.${c.rival}.title`)),
          // One compact row (layout + series score) so the cards stay low and the 3D stage shows.
          h('div', { class: 'uh-tourcard__meta' }, chip(locked ? 'common.locked' : c.layoutNameKey, 'cream', 'map'), seriesPips(c.playerWins, c.rivalWins, c.rival, locked)),
          h(
            'div',
            { class: 'uh-tourcard__reward' },
            portrait({ hat: c.rewardHat, silhouette: !c.rewardOwned && locked, expression: 'happy' }, 'uh-tourcard__rewardArt'),
            h(
              'div',
              { class: 'uh-tourcard__rewardText' },
              h('span', { class: 'uh-tourcard__rewardLabel' }, icon('hat'), t('tournament.reward')),
              // Hat names carry the rival's name: keep the reveal for when the card unlocks.
              h('span', { class: 'uh-tourcard__rewardName' }, locked && !c.rewardOwned ? '???' : t(`hat.${c.rewardHat}.name`)),
            ),
            c.rewardOwned ? h('span', { class: 'uh-tourcard__owned' }, icon('check')) : null,
          ),
          h('div', { class: 'uh-tourcard__cta' }, locked ? icon('lock') : icon('play'), t(locked ? 'common.locked' : actionKey)),
          c.state === 'cleared' ? stamp(t('tournament.caught'), 'tomato', 'uh-tourcard__stamp') : null,
        );
        return navigable(card, `rival:${c.rival}`, {
          onActivate: () => this.leave(() => this.props.onSelect(c.rival)),
        });
      }),
    );
    stagger(cards);

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-tour' },
        screenHeader(
          'tournament.title',
          'tournament.subtitle',
          'tournament',
          this.props.complete ? h('div', { class: 'uh-tour__champ' }, icon('trophy'), t('tournament.complete')) : null,
          'tomato',
        ),
        h('div', { class: 'uh-tour__stage', 'aria-hidden': 'true' }),
        cards,
        h('p', { class: 'uh-tour__note' }, icon('sparkle'), t('tournament.drawNote')),
        promptBar([
          { action: 'navigate', label: 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.select' },
          { action: 'back', label: 'prompt.back', onClick: () => this.leave(this.props.onBack) },
        ]),
      ),
    );
  }
}
