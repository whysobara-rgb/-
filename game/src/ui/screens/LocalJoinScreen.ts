/**
 * 같이 하기 (local multiplayer) join screen. Presentational: game flow owns the lobby state and
 * per-device input (src/game/local.ts, src/platform/localInput.ts) and pushes it here with
 * `update()`. Two team columns (별 팀 / 달 팀, two seats each: an empty seat says a bot fills
 * in), a strip saying how each device joins, and the match options that open once everyone is
 * ready. Mouse works everywhere (team arrows, ready, join chips, rows, start).
 */
import type { LayoutId, TeamId } from '../../sim/types';
import { PLAYER_COLORS, PLAYER_INK, playerTag } from '../../shared/players';
import { TEAM_STYLES } from '../../shared/teams';
import { t, tr, type TextRef } from '../i18n';
import { h } from '../core/dom';
import { icon, teamEmblem } from '../core/icons';
import { portrait } from '../core/portrait';
import { uiSound } from '../core/nav';
import { UiScreen } from '../core/screen';
import { button, cyclerRow, promptBar, screenHeader, type CyclerOption } from '../components/controls';
import { DIFFICULTIES, type Difficulty, type MatchMode } from '../types';
import type { HatId } from '../../sim/types';
import type { QuickLayoutChoice } from './QuickMatchSetup';

export interface TogetherOptions {
  layout: LayoutId | 'random';
  mode: MatchMode;
  difficulty: Difficulty;
}

export interface JoinPlayerView {
  /** 0..3 = P1..P4. */
  index: number;
  team: TeamId;
  ready: boolean;
  /** "키보드 왼쪽" / "패드 2". */
  device: TextRef;
  /** Key caps for this player's grab (ready) and dash (back). */
  keys: { grab: string; dash: string };
  hat: HatId;
}

export interface JoinDeviceHint {
  id: string;
  label: TextRef;
  key: string;
  /** Already in (the chip is dimmed). */
  joined: boolean;
}

export interface LocalJoinProps {
  layouts: readonly QuickLayoutChoice[];
  value: TogetherOptions;
  players: readonly JoinPlayerView[];
  hints: readonly JoinDeviceHint[];
  /** 'join' = joining / picking teams; 'options' = everyone is ready, pick the match. */
  phase: 'join' | 'options';
  style: 'versus' | 'coop';
  modes: readonly MatchMode[];
  /** Short notice (team full...) shown under the columns. */
  notice?: TextRef | null;
  onChange: (v: TogetherOptions) => void;
  onStart: () => void;
  onBack: () => void;
  /** Mouse: a join chip clicked. */
  onJoinDevice?: (id: string) => void;
  /** Mouse: team arrow / ready toggle on a card. */
  onTeam?: (index: number, team: TeamId) => void;
  onReady?: (index: number) => void;
  /** Options phase: back to joining. */
  onReopen?: () => void;
}

export class LocalJoinScreen extends UiScreen<LocalJoinProps> {
  constructor(props: LocalJoinProps) {
    super(props, { name: 'together' });
  }

  protected override defaultFocus(): string | null {
    return this.props.phase === 'options' ? 'together:start' : null;
  }

  protected override onBack(): boolean {
    if (this.props.phase === 'options') {
      this.props.onReopen?.();
      return true;
    }
    this.leave(this.props.onBack);
    return true;
  }

  /** Focus the start button (phase switch). */
  focusStart(): void {
    this.focusItem('together:start');
  }

  private set<K extends keyof TogetherOptions>(key: K, v: TogetherOptions[K]): void {
    this.props.onChange({ ...this.props.value, [key]: v });
  }

  protected render(): void {
    const p = this.props;
    const humans = p.players.length;
    const slots = p.value.mode === '1v1' ? 2 : 4;
    const bots = Math.max(0, slots - humans);
    const styleBadge = h(
      'div',
      { class: `uh-together__style is-${p.style}`, 'data-style': p.style },
      h('span', { class: 'uh-together__styleName' }, t(humans ? `together.style.${p.style}` : 'together.style.none')),
      h('span', { class: 'uh-together__styleDesc' }, humans ? t(`together.style.${p.style}.desc`) : t('together.nobody')),
      humans ? h('span', { class: 'uh-together__count' }, t('together.count', { humans, bots })) : null,
    );

    const column = (team: TeamId): HTMLElement => {
      const ts = TEAM_STYLES[team];
      const members = p.players.filter((x) => x.team === team);
      const seatsHere = p.value.mode === '1v1' && p.players.every((x) => p.players.filter((y) => y.team === x.team).length <= 1) ? 1 : 2;
      const cards: HTMLElement[] = members.map((m) => this.playerCard(m));
      for (let i = members.length; i < Math.max(seatsHere, members.length); i++) cards.push(this.emptySeat(team, humans > 0));
      return h(
        'section',
        { class: `uh-together__team uh-together__team--${team}`, style: `--team:${ts.color};--team-tint:${ts.tint};--team-dark:${ts.dark}` },
        h('header', { class: 'uh-together__teamHead' }, teamEmblem(team), h('span', null, t(ts.nameKey))),
        h('div', { class: 'uh-together__seats' }, cards),
      );
    };

    const hints = h(
      'div',
      { class: 'uh-together__join' },
      h('span', { class: 'uh-together__joinLabel' }, t('together.joinHow')),
      p.hints.map((d) =>
        h(
          'button',
          {
            type: 'button',
            tabindex: '-1',
            class: ['uh-together__hint', d.joined ? 'is-joined' : ''],
            'data-device': d.id,
            onClick: () => {
              if (d.joined) return;
              uiSound('confirm');
              p.onJoinDevice?.(d.id);
            },
          },
          h('span', { class: 'uh-together__hintDev' }, tr(d.label)),
          h('kbd', { class: 'uh-together__key' }, d.key),
        ),
      ),
    );

    const options = this.optionsPanel(bots);
    this.el.append(
      h('div', { class: 'uh-together__scrim', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: ['uh-frame', 'uh-together', `is-${p.phase}`] },
        screenHeader('together.title', null, 'sparkle', styleBadge, 'mint'),
        h('div', { class: 'uh-together__board' }, column(0), h('div', { class: 'uh-together__vs', 'aria-hidden': 'true' }, t('common.vs')), column(1)),
        h('p', { class: 'uh-together__notice', role: 'status' }, p.notice ? tr(p.notice) : p.phase === 'join' ? t(humans ? 'together.waiting' : 'together.sub') : ''),
        hints,
        options,
        promptBar(
          p.phase === 'options'
            ? [
                { action: 'adjust', label: 'prompt.adjust' },
                { action: 'confirm', label: 'prompt.select' },
                { action: 'back', label: 'together.backToJoin', onClick: () => p.onReopen?.() },
              ]
            : [{ action: 'back', label: 'prompt.back', onClick: () => this.leave(p.onBack) }],
          h('span', { class: 'uh-together__remote' }, icon('sparkle'), t('together.remote')),
        ),
      ),
    );
  }

  private playerCard(m: JoinPlayerView): HTMLElement {
    const p = this.props;
    const color = PLAYER_COLORS[m.index] ?? PLAYER_COLORS[0]!;
    const ink = PLAYER_INK[m.index] ?? PLAYER_INK[0]!;
    const other: TeamId = m.team === 0 ? 1 : 0;
    const arrow = (dir: 'left' | 'right'): HTMLElement | null => {
      const to: TeamId = dir === 'left' ? 0 : 1;
      if (m.ready || to === m.team) return h('span', { class: 'uh-together__arrow is-off', 'aria-hidden': 'true' });
      return h(
        'button',
        {
          type: 'button',
          tabindex: '-1',
          class: 'uh-together__arrow',
          'aria-label': t(TEAM_STYLES[to].nameKey),
          onClick: () => {
            uiSound('adjust');
            p.onTeam?.(m.index, to);
          },
        },
        icon(dir === 'left' ? 'chevLeft' : 'chevRight'),
      );
    };
    void other;
    return h(
      'article',
      {
        class: ['uh-together__card', m.ready ? 'is-ready' : ''],
        'data-player': String(m.index + 1),
        style: `--p:${color};--p-ink:${ink}`,
      },
      h('div', { class: 'uh-together__tag' }, playerTag(m.index)),
      h('div', { class: 'uh-together__face' }, portrait({ hat: m.hat, team: m.team, expression: m.ready ? 'happy' : 'determined' }, 'uh-together__portrait')),
      h(
        'div',
        { class: 'uh-together__info' },
        h('span', { class: 'uh-together__dev' }, tr(m.device)),
        m.ready
          ? h('span', { class: 'uh-together__ready' }, t('together.ready'))
          : h('span', { class: 'uh-together__how' }, t('together.readyHow', { grab: m.keys.grab, dash: m.keys.dash })),
      ),
      h(
        'div',
        { class: 'uh-together__teamPick' },
        arrow('left'),
        h(
          'button',
          {
            type: 'button',
            tabindex: '-1',
            class: 'uh-together__readyBtn',
            onClick: () => {
              uiSound(m.ready ? 'back' : 'confirm');
              p.onReady?.(m.index);
            },
          },
          m.ready ? icon('check') : t('together.readyShort'),
        ),
        arrow('right'),
      ),
    );
  }

  private emptySeat(team: TeamId, anyone: boolean): HTMLElement {
    return h(
      'div',
      { class: 'uh-together__empty', 'data-team': String(team) },
      h('div', { class: 'uh-together__emptyFace' }, portrait({ silhouette: true, team }, 'uh-together__portrait')),
      h('span', null, t(anyone ? 'together.botSeat' : 'together.openSeat')),
    );
  }

  private optionsPanel(bots: number): HTMLElement {
    const p = this.props;
    const open = p.phase === 'options';
    const v = p.value;
    const layoutOpts: CyclerOption<LayoutId | 'random'>[] = [
      ...p.layouts.map((l) => ({ value: l.id as LayoutId | 'random', label: l.nameKey })),
      { value: 'random', label: 'layout.random', art: () => icon('dice') },
    ];
    const modeOpts: CyclerOption<MatchMode>[] = p.modes.map((m) => ({ value: m, label: `mode.${m}` }));
    const diffOpts: CyclerOption<Difficulty>[] = DIFFICULTIES.map((d) => ({ value: d, label: `difficulty.${d}` }));
    if (!open) {
      return h('div', { class: 'uh-together__options is-closed uh-panel' }, h('span', { class: 'uh-together__lock' }, icon('flag'), t('together.optionsLater')));
    }
    const rows = h(
      'div',
      { class: 'uh-together__rows' },
      cyclerRow({ id: 'together:layout', label: 'quick.layout', icon: 'map', options: layoutOpts, value: v.layout, onChange: (x) => this.set('layout', x) }),
      cyclerRow({ id: 'together:mode', label: 'together.size', icon: 'flag', options: modeOpts, value: v.mode, onChange: (x) => this.set('mode', x) }),
      bots > 0
        ? cyclerRow({ id: 'together:difficulty', label: 'together.difficulty', icon: 'bolt', options: diffOpts, value: v.difficulty, onChange: (x) => this.set('difficulty', x) })
        : h('div', { class: 'uh-together__noBots' }, t('together.noBots')),
    );
    const start = button({ id: 'together:start', label: 'together.start', variant: 'primary', size: 'lg', className: 'uh-together__start', onActivate: () => this.leave(p.onStart) });
    return h('div', { class: 'uh-together__options uh-panel' }, rows, start);
  }
}
