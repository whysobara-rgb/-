/**
 * Between games of a rival series (doc §11 라이벌전의 다음 판): the rival steps into the spotlight
 * on the 3D stage (menu3d TournamentScene close-up, left), and talks from a big speech bubble
 * (right): its adaptation line in its own voice — only when an adaptation was actually chosen —
 * plus what the player could switch to. Series score sticker on top. One confirm starts the
 * next game.
 */
import type { TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h } from '../core/dom';
import { icon } from '../core/icons';
import { portrait } from '../core/portrait';
import { UiScreen } from '../core/screen';
import { chunky, slamIn, stamp } from '../core/juice';
import { button, chip, promptBar } from '../components/controls';
import { adaptationHintKey, type AdaptationKind, type RivalId } from '../types';
import { seriesPips } from './TournamentScreen';

export interface SeriesIntermissionProps {
  rival: RivalId;
  /** Number of the game about to start (1-based; draws replay the same number). */
  gameNumber: number;
  playerWins: number;
  rivalWins: number;
  layoutNameKey: string;
  /**
   * The adaptation the bot chose from real observations (null = none). `line` is usually
   * `{ key: adaptation.lineKey, params: adaptation.lineParams }`.
   */
  adaptation: { kind: AdaptationKind; line: TextRef } | null;
  /** The previous game was a draw (not counted; same game number replays). */
  afterDraw?: boolean;
  myTeam?: TeamId;
  onContinue: () => void;
  onQuit: () => void;
}

export class SeriesIntermission extends UiScreen<SeriesIntermissionProps> {
  constructor(props: SeriesIntermissionProps) {
    super(props, { name: 'intermission' });
  }

  protected override defaultFocus(): string {
    return 'inter:next';
  }

  protected override onBack(): boolean {
    this.leave(this.props.onQuit);
    return true;
  }

  protected override onShow(): void {
    const s = this.el.querySelector<HTMLElement>('.uh-inter__matchPoint');
    if (s) slamIn(s, 500, 8);
  }

  protected render(): void {
    const p = this.props;
    const matchPoint = p.playerWins === 1 || p.rivalWins === 1;
    // No adaptation: the rival still speaks in its own voice (ART_DIRECTION §5), saying it keeps
    // its usual plan — never a narrator line under '{rival}의 한마디'.
    const line = p.adaptation ? tr(p.adaptation.line) : t(`adapt.none.${p.rival}`);
    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-inter' },
        h(
          'header',
          { class: 'uh-inter__head' },
          h(
            'div',
            { class: 'uh-inter__titleCard' },
            h('div', { class: 'uh-inter__kicker' }, chip('tournament.title', 'night', 'tournament'), chip(p.layoutNameKey, 'gold', 'map')),
            chunky(t('series.game', { n: p.gameNumber }), { tag: 'h1', cls: 'uh-inter__title', tone: 'cream' }),
          ),
          h(
            'div',
            { class: 'uh-inter__score uh-panel' },
            h('span', { class: 'uh-inter__scoreLabel' }, t('series.score')),
            h('span', { class: 'uh-inter__scoreNum uh-num' }, `${p.playerWins} : ${p.rivalWins}`),
            seriesPips(p.playerWins, p.rivalWins, p.rival),
            matchPoint ? stamp(t('series.matchPoint'), 'tomato', 'uh-inter__matchPoint') : chip('series.firstTo2', 'cream'),
          ),
        ),
        h(
          'div',
          { class: 'uh-inter__stage' },
          h('div', { class: 'uh-inter__spot', 'aria-hidden': 'true' }, h('span', { class: 'uh-inter__rivalName' }, chunky(t(`rival.${p.rival}.name`), { tone: 'sun' }))),
          h(
            'div',
            { class: 'uh-inter__talk' },
            h('div', { class: 'uh-inter__says' }, portrait({ rival: p.rival, team: 1 }, 'uh-inter__face'), t('intermission.rivalSays', { rival: t(`rival.${p.rival}.name`) })),
            h('blockquote', { class: ['uh-bubble', 'uh-bubble--left', 'uh-inter__bubble', `uh-inter__bubble--${p.rival}`, p.adaptation ? '' : 'is-quiet'] }, line),
            p.adaptation
              ? h(
                  'div',
                  { class: 'uh-inter__hint uh-panel' },
                  h('span', { class: 'uh-inter__hintTitle' }, icon('sparkle'), t('intermission.hintTitle')),
                  h('span', { class: 'uh-inter__hintBody' }, t(adaptationHintKey(p.adaptation.kind))),
                )
              : null,
            h('p', { class: 'uh-inter__draw' }, p.afterDraw ? t('results.drawReplay') : t('intermission.sameLayout')),
          ),
        ),
        h(
          'div',
          { class: 'uh-inter__buttons' },
          button({ id: 'inter:quit', label: 'intermission.quit', variant: 'night', onActivate: () => this.leave(p.onQuit) }),
          button({ id: 'inter:next', label: 'intermission.next', variant: 'primary', size: 'lg', glyph: 'confirm', onActivate: () => this.leave(p.onContinue) }),
        ),
        promptBar([
          { action: 'confirm', label: 'prompt.select' },
          { action: 'back', label: 'intermission.quit', onClick: () => this.leave(p.onQuit) },
        ]),
      ),
    );
  }
}
