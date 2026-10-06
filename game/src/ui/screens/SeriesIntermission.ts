/**
 * Between games of a rival series (doc §11 라이벌전의 다음 판): series score + the rival's
 * adaptation line in a speech bubble (only when an adaptation was actually chosen) and what
 * the player could switch to. One confirm starts the next game.
 */
import type { TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h } from '../core/dom';
import { icon, raccoon } from '../core/icons';
import { UiScreen } from '../core/screen';
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

  protected render(): void {
    const p = this.props;
    const matchPoint = p.playerWins === 1 || p.rivalWins === 1;
    const line = p.adaptation ? tr(p.adaptation.line) : t('adapt.none');
    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-inter' },
        h(
          'header',
          { class: 'uh-inter__head' },
          h('div', { class: 'uh-inter__kicker' }, chip('tournament.title', 'night', 'tournament'), chip(p.layoutNameKey, 'gold', 'map')),
          h('h1', { class: 'uh-inter__title uh-outline-text' }, t('series.game', { n: p.gameNumber })),
          h(
            'div',
            { class: 'uh-inter__score uh-panel' },
            h('span', { class: 'uh-inter__scoreLabel' }, t('series.score')),
            h('span', { class: 'uh-inter__scoreNum uh-num' }, `${p.playerWins} : ${p.rivalWins}`),
            seriesPips(p.playerWins, p.rivalWins, p.rival),
            matchPoint ? chip('series.matchPoint', 'gold', 'sparkle') : chip('series.firstTo2', 'ghost'),
          ),
        ),
        h(
          'div',
          { class: 'uh-inter__stage' },
          h('div', { class: 'uh-inter__rival' }, raccoon({ rival: p.rival, team: 1 }), h('span', { class: 'uh-inter__rivalName uh-outline-text' }, t(`rival.${p.rival}.name`))),
          h(
            'div',
            { class: 'uh-inter__talk' },
            h('div', { class: 'uh-inter__says' }, t('intermission.rivalSays', { rival: t(`rival.${p.rival}.name`) })),
            h('blockquote', { class: ['uh-bubble', 'uh-inter__bubble', p.adaptation ? '' : 'is-quiet'] }, line),
            p.adaptation
              ? h(
                  'div',
                  { class: 'uh-inter__hint uh-panel uh-panel--glass' },
                  h('span', { class: 'uh-inter__hintTitle' }, icon('sparkle'), t('intermission.hintTitle')),
                  h('span', { class: 'uh-inter__hintBody' }, t(adaptationHintKey(p.adaptation.kind))),
                )
              : null,
            p.afterDraw ? h('p', { class: 'uh-inter__draw' }, t('results.drawReplay')) : h('p', { class: 'uh-inter__draw' }, t('intermission.sameLayout')),
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
