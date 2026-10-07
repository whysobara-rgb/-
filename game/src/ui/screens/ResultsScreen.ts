/**
 * Results (doc §12): both confirmed scores, a big rubber stamp (승리! / 아쉽다! / 무승부), ONE
 * biggest real event, series context in the tournament, and 재대결 / 다음 판 / 메뉴 — the primary
 * action is focused so a rematch is a single confirm press. The GameView results scene (the
 * raccoons at the van) stays live behind; this layer adds rolling score counters, coin bursts and
 * confetti. No reward popups: a hat earned is shown inline (toasts are non-blocking).
 */
import type { EndReason, HatId, LootKind, TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h, isReducedMotion } from '../core/dom';
import { icon, teamEmblem } from '../core/icons';
import { objectPortrait, portrait } from '../core/portrait';
import { uiSound } from '../core/nav';
import { UiScreen } from '../core/screen';
import { RollingNumber, burst, chunky, slamIn, stamp } from '../core/juice';
import { button, chip, promptBar, teamTag } from '../components/controls';
import type { RivalId } from '../types';
import { seriesPips } from './TournamentScreen';
import { playerColor, playerTag } from '../../shared/players';
import { TEAM_STYLES } from '../../shared/teams';

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
  /** Rival on team 1 (1:1) for its portrait; null = team emblem only. */
  rival?: RivalId | null;
  onRematch?: () => void;
  onNext?: () => void;
  /** Label of the 'next' button (default 'results.next' = 다음 판), e.g. '다음 라이벌' after a won series. */
  nextLabel?: string | null;
  onMenu: () => void;
  /** (local multiplayer) Team-neutral headline (versus) + per-player highlights. */
  local?: ResultsLocalView | null;
}

export interface ResultsLocalView {
  style: 'versus' | 'coop';
  winner: TeamId | null;
  /** Humans (P order): portrait hat per team card. */
  players: ReadonlyArray<{ index: number; team: TeamId; hat: HatId }>;
  /** Who did the most (ties shared); empty = nobody scored. */
  highlights: ReadonlyArray<{ kind: 'uproots' | 'steals' | 'recovered'; players: readonly number[]; value: number }>;
}

const STAMP_TONE = { win: 'sun', lose: 'sky', draw: 'grape' } as const;

export class ResultsScreen extends UiScreen<ResultsScreenProps> {
  private timers: number[] = [];
  private rollers: [RollingNumber | null, RollingNumber | null] = [null, null];
  private confettiTimer = 0;

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
    this.play();
  }

  protected override onHide(): void {
    this.stop();
  }

  protected override onDestroy(): void {
    this.stop();
  }

  private stop(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    window.clearInterval(this.confettiTimer);
    for (const r of this.rollers) r?.stop();
  }

  protected render(): void {
    const p = this.props;
    const mine = p.myTeam;
    const expr = p.outcome === 'win' ? 'happy' : p.outcome === 'lose' ? 'sad' : 'surprised';

    const scoreCard = (team: TeamId): HTMLElement => {
      const winner = p.outcome !== 'draw' && (team === mine) === (p.outcome === 'win');
      const roll = new RollingNumber('uh-res__score uh-num', isReducedMotion() ? p.scores[team] : 0);
      roll.el.dataset.target = String(p.scores[team]);
      this.rollers[team] = roll;
      const lp = p.local?.players.find((x) => x.team === team);
      const won = p.outcome !== 'draw' && (team === mine) === (p.outcome === 'win');
      const face = p.local
        ? lp
          ? portrait({ hat: lp.hat, team, expression: p.outcome === 'draw' ? 'surprised' : won ? 'happy' : 'sad' }, 'uh-res__face')
          : h('div', { class: 'uh-res__face uh-res__face--emblem' }, teamEmblem(team))
        : team === mine
          ? portrait({ hat: p.playerHat ?? 'teamCapA', team, expression: expr }, 'uh-res__face')
          : p.rival
            ? portrait({ rival: p.rival, team, expression: p.outcome === 'win' ? 'sad' : p.outcome === 'lose' ? 'happy' : 'surprised' }, 'uh-res__face')
            : h('div', { class: 'uh-res__face uh-res__face--emblem' }, teamEmblem(team));
      return h(
        'div',
        { class: ['uh-res__team', `uh-res__team--${team}`, team === mine ? 'is-mine' : '', winner ? 'is-winner' : ''] },
        face,
        h(
          'div',
          { class: 'uh-res__teamHead' },
          teamTag(team, p.teamLabels?.[team] ?? null),
          p.local
            ? h('span', { class: 'uh-res__ptags' }, p.local.players.filter((x) => x.team === team).map((x) => h('span', { class: 'uh-res__ptag', style: `--p:${playerColor(x.index)}` }, playerTag(x.index))))
            : team === mine
              ? chip('team.mine', 'gold')
              : null,
        ),
        roll.el,
        h('div', { class: 'uh-res__confirmed' }, icon('check'), t('results.confirmed')),
        winner ? h('div', { class: 'uh-res__crown', 'aria-hidden': 'true' }, icon('trophy')) : null,
      );
    };

    const ev = p.biggestEvent;
    const eventCard = h(
      'section',
      { class: 'uh-res__event uh-panel' },
      h('div', { class: 'uh-res__eventKicker' }, icon('sparkle'), t('results.biggest')),
      ev
        ? h(
            'div',
            { class: 'uh-res__eventBody' },
            h('div', { class: 'uh-res__eventArt' }, ev.kind === 'fence' ? icon('bolt') : ev.kind === 'time' ? icon('clock') : objectPortrait(ev.kind ?? 'bank', 'uh-res__eventLoot')),
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
                ? chip('series.matchPoint', 'tomato', 'sparkle')
                : null,
          p.outcome === 'draw' ? h('span', { class: 'uh-res__drawNote' }, t('results.drawReplay')) : null,
        )
      : null;

    const loc = p.local;
    const highlights = loc
      ? h(
          'section',
          { class: 'uh-res__hl uh-panel' },
          h('div', { class: 'uh-res__eventKicker' }, icon('trophy'), t('together.hl.title')),
          loc.highlights.length
            ? h(
                'ul',
                { class: 'uh-res__hlList' },
                loc.highlights.map((x) =>
                  h(
                    'li',
                    { class: 'uh-res__hlRow', 'data-kind': x.kind },
                    h('span', { class: 'uh-res__hlLabel' }, t(`together.hl.${x.kind}`)),
                    h('span', { class: 'uh-res__hlWho' }, x.players.map((i) => h('span', { class: 'uh-res__ptag', style: `--p:${playerColor(i)}` }, playerTag(i)))),
                    h('span', { class: 'uh-res__hlNum uh-num' }, x.kind === 'recovered' ? t('together.hl.value', { value: x.value.toLocaleString() }) : t('together.hl.count', { n: x.value })),
                  ),
                ),
              )
            : h('p', { class: 'uh-res__eventText is-empty' }, t('together.hl.none')),
        )
      : null;
    // Versus on one screen: the stamp names the winning team (no "you lost" for half the couch).
    const versus = loc?.style === 'versus';
    const stampText = versus ? (loc!.winner === null ? t('together.draw') : t('together.win', { team: t(TEAM_STYLES[loc!.winner].nameKey) })) : t(`results.stamp.${p.outcome}`);
    const reward = p.reward
      ? h('div', { class: 'uh-res__reward' }, portrait({ hat: p.reward.hat, expression: 'happy' }, 'uh-res__rewardArt'), h('span', null, t('results.reward', { hat: t(`hat.${p.reward.hat}.name`) })))
      : null;

    const buttons = h(
      'div',
      { class: 'uh-res__buttons', 'data-paw-mode': 'top' },
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
        ? button({ id: 'res:next', label: p.nextLabel ?? 'results.next', icon: 'play', variant: 'primary', size: 'lg', glyph: 'confirm', onActivate: () => this.leave(p.onNext) })
        : null,
    );

    this.el.append(
      h('div', { class: 'uh-res__fx', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: ['uh-frame', 'uh-res', `uh-res--${p.outcome}`] },
        h(
          'header',
          { class: 'uh-res__head' },
          stamp(stampText, versus ? (loc!.winner === null ? 'grape' : 'sun') : STAMP_TONE[p.outcome], 'uh-res__stamp'),
          h(
            'div',
            { class: 'uh-res__headline' },
            versus ? null : chunky(t(`results.${p.outcome}.sub`), { tag: 'p', cls: 'uh-res__sub', tone: 'cream' }),
            p.reason ? chip(`results.reason.${p.reason}`, 'night', p.reason === 'time' ? 'clock' : 'flag') : null,
          ),
        ),
        h('div', { class: 'uh-res__scores' }, scoreCard(0), h('div', { class: 'uh-res__vs', 'aria-hidden': 'true' }, h('i'), h('i')), scoreCard(1)),
        h('div', { class: 'uh-res__mid' }, eventCard, highlights, seriesStrip, reward),
        buttons,
        promptBar([
          { action: 'navigate', label: 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.select' },
        ]),
      ),
    );
  }

  /** Stamp slam, then the scores roll up with coin bursts; confetti rain on a win. */
  private play(): void {
    this.stop();
    const st = this.el.querySelector<HTMLElement>('.uh-res__stamp');
    if (st) slamIn(st, 250); // upright: the slam is drop + squash, never a tilt
    this.timers.push(window.setTimeout(() => uiSound('stamp'), 380));
    const reduced = isReducedMotion();
    for (const team of [0, 1] as const) {
      const r = this.rollers[team];
      if (!r) continue;
      const target = this.props.scores[team];
      if (reduced) {
        r.set(target, true);
        continue;
      }
      this.timers.push(
        window.setTimeout(() => {
          r.countTo(target, 650 + Math.min(700, target / 4));
          if (target > 0) {
            uiSound('coin', { pitch: team === this.props.myTeam ? 1.12 : 1 });
            const fx = this.el.querySelector<HTMLElement>('.uh-res__fx');
            const rect = r.el.getBoundingClientRect();
            const host = fx?.getBoundingClientRect();
            if (fx && host) burst(fx, rect.left - host.left + rect.width / 2, rect.top - host.top + rect.height / 2, { kind: 'coins', count: Math.min(18, 4 + Math.round(target / 150)), power: 1.1 });
          }
        }, 700 + team * 220),
      );
    }
    const lv = this.props.local;
    if ((this.props.outcome === 'win' || (lv?.style === 'versus' && lv.winner !== null)) && !reduced) {
      const rain = (): void => {
        const fx = this.el.querySelector<HTMLElement>('.uh-res__fx');
        if (!fx) return;
        const w = fx.clientWidth;
        for (let i = 0; i < 3; i++) burst(fx, Math.random() * w, -20, { kind: 'confetti', count: 6, power: 0.5, spread: 3, up: -6 });
      };
      this.timers.push(window.setTimeout(rain, 300));
      this.confettiTimer = window.setInterval(rain, 420);
      this.timers.push(window.setTimeout(() => window.clearInterval(this.confettiTimer), 9000));
    }
  }
}
