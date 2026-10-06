/**
 * Results (doc §12): both confirmed scores, 승리/패배/무승부 headline, ONE biggest real event,
 * series context in the tournament, and 재대결 / 다음 판 / 메뉴 — the primary action is
 * focused so a rematch is a single confirm press. No reward popups: a hat earned is shown
 * inline (toasts are non-blocking).
 */
import type { EndReason, HatId, LootKind, TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h, isReducedMotion } from '../core/dom';
import { icon, lootIcon, raccoon, teamEmblem } from '../core/icons';
import { fmtScore } from '../core/format';
import { UiScreen } from '../core/screen';
import { button, chip, promptBar, teamTag } from '../components/controls';
import type { RivalId } from '../types';
import { seriesPips } from './TournamentScreen';

export type ResultOutcome = 'win' | 'lose' | 'draw';

export interface ResultEventView {
  /** Usually { key: 'event.bankWhole', params: { building: 500, safes: 500, total: 1000 } }. */
  text: TextRef;
  /** Team that made the play (null = neutral). */
  team: TeamId | null;
  /** Icon hint. */
  kind?: LootKind | 'fence' | 'time' | null;
}

export interface ResultSeriesView {
  rival: RivalId;
  playerWins: number;
  rivalWins: number;
  /** Game just finished (1-based). */
  gameNumber: number;
  state: 'ongoing' | 'won' | 'lost';
}

export interface ResultsScreenProps {
  outcome: ResultOutcome;
  myTeam: TeamId;
  scores: readonly [number, number];
  /** Override team labels (e.g. the rival's name for team 1). */
  teamLabels?: readonly [TextRef | null, TextRef | null];
  reason?: EndReason | null;
  biggestEvent: ResultEventView | null;
  series?: ResultSeriesView | null;
  /** Hat earned this game (shown inline, not as a popup). */
  reward?: { hat: HatId } | null;
  /** Which buttons to show. Menu is always shown. */
  actions: { rematch?: boolean; next?: boolean };
  /** Focused on show. Default: 'next' when available, else 'rematch'. */
  primary?: 'rematch' | 'next' | 'menu';
  playerHat?: HatId;
  onRematch?: () => void;
  onNext?: () => void;
  onMenu: () => void;
}

const CONFETTI_COLORS = ['#FFD66B', '#FF8F78', '#7FD3B0', '#A9D4FF', '#FF9EC0', '#B58BE8'];

export class ResultsScreen extends UiScreen<ResultsScreenProps> {
  private raf = 0;

  constructor(props: ResultsScreenProps) {
    super(props, { name: 'results', wrapNav: false });
  }

  protected override defaultFocus(): string {
    const a = this.props.actions;
    const primary = this.props.primary ?? (a.next ? 'next' : a.rematch ? 'rematch' : 'menu');
    return `res:${primary}`;
  }

  /** Back never leaves directly: it moves focus to 메뉴 (one more confirm to leave). */
  protected override onBack(): boolean {
    return this.focus.focus('res:menu');
  }

  protected override onShow(): void {
    this.countUp();
  }

  protected override onHide(): void {
    cancelAnimationFrame(this.raf);
  }

  protected override onDestroy(): void {
    cancelAnimationFrame(this.raf);
  }

  protected render(): void {
    const p = this.props;
    const mine = p.myTeam;
    const expr = p.outcome === 'win' ? 'happy' : p.outcome === 'lose' ? 'sad' : 'surprised';

    const scoreCard = (team: TeamId): HTMLElement =>
      h(
        'div',
        { class: ['uh-res__team', `uh-res__team--${team}`, team === mine ? 'is-mine' : '', p.outcome !== 'draw' && (team === mine) === (p.outcome === 'win') ? 'is-winner' : ''] },
        h('div', { class: 'uh-res__teamHead' }, teamTag(team, p.teamLabels?.[team] ?? null), team === mine ? chip('team.mine', 'gold') : null),
        h('div', { class: 'uh-res__score uh-num', 'data-target': String(p.scores[team]) }, fmtScore(p.scores[team])),
        h('div', { class: 'uh-res__confirmed' }, icon('check'), t('results.confirmed')),
        h('div', { class: 'uh-res__emblemBg', 'aria-hidden': 'true' }, teamEmblem(team, 'uh-res__emblemBig')),
      );

    const ev = p.biggestEvent;
    const eventCard = h(
      'section',
      { class: 'uh-res__event uh-panel' },
      h('div', { class: 'uh-res__eventKicker' }, icon('sparkle'), t('results.biggest')),
      ev
        ? h(
            'div',
            { class: 'uh-res__eventBody' },
            h(
              'div',
              { class: 'uh-res__eventArt' },
              ev.kind === 'fence' ? icon('bolt') : ev.kind === 'time' ? icon('clock') : lootIcon(ev.kind ?? 'bank', 'uh-loot-icon uh-res__eventLoot'),
            ),
            h('p', { class: 'uh-res__eventText' }, tr(ev.text)),
            ev.team !== null ? h('div', { class: 'uh-res__eventTeam' }, teamTag(ev.team, p.teamLabels?.[ev.team] ?? null)) : null,
          )
        : h('p', { class: 'uh-res__eventText is-empty' }, t('results.noEvent')),
    );

    const s = p.series;
    const seriesStrip = s
      ? h(
          'section',
          { class: 'uh-res__series uh-panel uh-panel--night' },
          h('span', { class: 'uh-res__seriesLabel' }, icon('tournament'), t('series.game', { n: s.gameNumber })),
          seriesPips(s.playerWins, s.rivalWins, s.rival),
          s.state === 'won'
            ? chip('series.won', 'gold', 'trophy')
            : s.state === 'lost'
              ? chip('series.lost', 'night')
              : s.playerWins === 1 || s.rivalWins === 1
                ? chip('series.matchPoint', 'gold', 'sparkle')
                : null,
          p.outcome === 'draw' ? h('span', { class: 'uh-res__drawNote' }, t('results.drawReplay')) : null,
        )
      : null;

    const reward = p.reward
      ? h(
          'div',
          { class: 'uh-res__reward' },
          h('div', { class: 'uh-res__rewardArt' }, raccoon({ hat: p.reward.hat, expression: 'happy' })),
          h('span', null, t('results.reward', { hat: t(`hat.${p.reward.hat}.name`) })),
        )
      : null;

    const buttons = h(
      'div',
      { class: 'uh-res__buttons' },
      button({ id: 'res:menu', label: 'results.menu', icon: 'home', variant: 'night', onActivate: () => this.leave(p.onMenu) }),
      p.actions.rematch
        ? button({
            id: 'res:rematch',
            label: 'results.rematch',
            icon: 'reset',
            variant: p.actions.next ? 'default' : 'primary',
            size: p.actions.next ? 'md' : 'lg',
            glyph: p.actions.next ? undefined : 'confirm',
            onActivate: () => this.leave(p.onRematch),
          })
        : null,
      p.actions.next
        ? button({ id: 'res:next', label: 'results.next', icon: 'play', variant: 'primary', size: 'lg', glyph: 'confirm', onActivate: () => this.leave(p.onNext) })
        : null,
    );

    const confetti =
      p.outcome === 'win'
        ? h(
            'div',
            { class: 'uh-confetti', 'aria-hidden': 'true' },
            Array.from({ length: 28 }, (_, i) =>
              h('i', {
                style: {
                  left: `${(i * 37) % 100}%`,
                  background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                  '--d': `${(i % 7) * 0.18}s`,
                  '--r': `${(i * 53) % 360}deg`,
                  '--x': `${((i * 29) % 21) - 10}rem`,
                },
              }),
            ),
          )
        : null;

    this.el.append(
      confetti ?? '',
      h(
        'div',
        { class: ['uh-frame', 'uh-res', `uh-res--${p.outcome}`] },
        h(
          'header',
          { class: 'uh-res__head' },
          h('div', { class: 'uh-res__face' }, raccoon({ hat: p.playerHat ?? 'teamCapA', team: mine, expression: expr })),
          h(
            'div',
            { class: 'uh-res__headline' },
            h('h1', { class: 'uh-res__title uh-outline-text' }, t(`results.${p.outcome}`)),
            h('p', { class: 'uh-res__sub' }, t(`results.${p.outcome}.sub`)),
            p.reason ? chip(`results.reason.${p.reason}`, 'night', p.reason === 'time' ? 'clock' : 'flag') : null,
          ),
        ),
        h(
          'div',
          { class: 'uh-res__scores' },
          scoreCard(0),
          h('div', { class: 'uh-res__vs uh-outline-text' }, ':'),
          scoreCard(1),
        ),
        h('div', { class: 'uh-res__mid' }, eventCard, seriesStrip, reward),
        buttons,
        promptBar([
          { action: 'navigate', label: 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.select' },
        ]),
      ),
    );
  }

  /** Quick, non-blocking count-up of the two scores. */
  private countUp(): void {
    cancelAnimationFrame(this.raf);
    const els = Array.from(this.el.querySelectorAll<HTMLElement>('.uh-res__score'));
    if (isReducedMotion() || !els.length) return;
    const start = performance.now();
    const dur = 700;
    const tick = (now: number): void => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      for (const el of els) {
        const target = Number(el.dataset.target ?? '0');
        el.textContent = fmtScore(Math.round(target * e / 10) * 10);
      }
      if (k < 1) this.raf = requestAnimationFrame(tick);
      else for (const el of els) el.textContent = fmtScore(Number(el.dataset.target ?? '0'));
    };
    this.raf = requestAnimationFrame(tick);
  }
}
