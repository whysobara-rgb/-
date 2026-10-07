/**
 * Pre-match layout preview (doc §9: "시작 전 짧은 미리보기로 양쪽에 같은 정보를 준다").
 * The 3D miniature of the real level turns on its turntable behind this overlay (game flow runs
 * the menu3d PreviewScene: banks in cutaway with their safes, floating price tags, vans with
 * flags, route arrows, police entry points). The overlay adds the layout name sticker, both teams
 * with 3D portraits, a legend strip and the "곧 시작" fuse; then 3-2-1-출발! slams in.
 * Identical for both sides: nothing team-private is shown.
 */
import type { HatId, LayoutDef, TeamId } from '../../sim/types';
import { SCORE } from '../../sim/config';
import { TEAM_STYLES } from '../../shared/teams';
import { t, tr, type TextRef } from '../i18n';
import { animateEl, h } from '../core/dom';
import { icon, lootIcon, teamEmblem, type RivalId } from '../core/icons';
import { portrait } from '../core/portrait';
import { uiSound } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chunky } from '../core/juice';
import { chip, promptBar, teamTag } from '../components/controls';

export interface PreviewMember {
  name: TextRef;
  rival?: RivalId | null;
  hat?: HatId;
  isYou?: boolean;
}

export interface PreviewTeam {
  /** Override for the team label (defaults to 별 팀 / 달 팀). */
  label?: TextRef | null;
  members: readonly PreviewMember[];
}

export interface LayoutPreviewProps {
  layout: LayoutDef;
  /** Context line, e.g. { key: 'mode.quickMatch' } or a tournament round. */
  context?: TextRef | null;
  myTeam: TeamId;
  teams: readonly [PreviewTeam, PreviewTeam];
  /** Milliseconds the map is shown before the countdown starts (default 2600). 0 = wait for startCountdown(). */
  holdMs?: number;
  /** Shown as the "곧 시작" fuse when game flow starts the match on its own timer (display only). */
  autoStartMs?: number;
  /** The police event is on (legend shows the police entry marker). */
  police?: boolean;
  /** Countdown start number (default 3). */
  countdownFrom?: number;
  /** Called after "출발!" — start the match. */
  onDone: () => void;
  /** Confirm pressed during the hold: default jumps straight to the countdown. */
  onSkip?: () => void;
  /** Called on every countdown tick (3,2,1,0=출발) — e.g. play 'countdownBeep'. */
  onTick?: (n: number) => void;
  /** Back pressed (e.g. return to quick match setup). Omit to ignore back. */
  onBack?: () => void;
}

/** Total value of a layout (outdoor safes + 2 banks with standard contents) for the header chip. */
export function layoutTotalValue(layout: LayoutDef): number {
  const outdoor = layout.safes.reduce((s, x) => s + (x.kind === 'smallSafe' ? SCORE.smallSafe : SCORE.largeSafe), 0);
  const bank = SCORE.bankBuilding + SCORE.smallSafe * 2 + SCORE.largeSafe;
  return outdoor + layout.banks.length * bank;
}

export class LayoutPreview extends UiScreen<LayoutPreviewProps> {
  private countEl: HTMLElement | null = null;
  private countTimers: number[] = [];
  private holdTimer = 0;
  private counting = false;
  private finished = false;

  constructor(props: LayoutPreviewProps) {
    super(props, { name: 'preview' });
  }

  protected override defaultFocus(): string | null {
    return null;
  }

  protected render(): void {
    const L = this.props.layout;
    this.countEl = h('div', { class: 'uh-preview__count', 'aria-live': 'assertive' });

    const legendItems: [Node, string][] = [
      [teamEmblem(this.props.myTeam), 'preview.legend.zone'],
      [icon('van'), 'preview.legend.van'],
      [lootIcon('bank', 'uh-loot-icon'), 'preview.legend.bank'],
      [lootIcon('smallSafe', 'uh-loot-icon'), 'preview.legend.smallSafe'],
      [lootIcon('largeSafe', 'uh-loot-icon'), 'preview.legend.largeSafe'],
    ];
    if (L.fences.length > 0) legendItems.push([h('span', { class: 'uh-legend__fence' }), 'preview.legend.fence']);
    if (this.props.police) legendItems.push([icon('police'), 'preview.legend.police']);
    const legend = h(
      'ul',
      { class: 'uh-legend' },
      legendItems.map(([art, key], i) => h('li', { class: 'uh-legend__item', style: { '--i': String(i) } }, h('span', { class: 'uh-legend__art' }, art), h('span', null, t(key)))),
    );

    const teamCard = (team: TeamId): HTMLElement => {
      const spec = this.props.teams[team];
      const mine = team === this.props.myTeam;
      return h(
        'div',
        { class: ['uh-preview__team', `uh-preview__team--${team}`, mine ? 'is-mine' : ''] },
        h('div', { class: 'uh-preview__teamHead' }, teamTag(team, spec.label ?? null), mine ? chip('team.mine', 'gold') : null),
        h(
          'div',
          { class: 'uh-preview__members' },
          spec.members.map((m, i) =>
            h(
              'div',
              { class: 'uh-preview__member', style: { '--i': String(i) } },
              portrait({ rival: m.rival ?? null, hat: m.hat ?? (m.rival ? undefined : TEAM_STYLES[team].hat), team, expression: m.isYou ? 'determined' : undefined }, 'uh-preview__face'),
              h(
                'span',
                { class: 'uh-preview__mname' },
                tr(m.name),
                m.isYou && tr(m.name) !== t('hud.you') ? h('b', { class: 'uh-preview__you' }, t('hud.you')) : null,
              ),
            ),
          ),
        ),
      );
    };

    const fuse = this.props.autoStartMs
      ? h('div', { class: 'uh-preview__fuse', style: { '--ms': `${this.props.autoStartMs}ms` } }, h('span', { class: 'uh-preview__fuseBar' }, h('i')), h('span', { class: 'uh-preview__fuseText' }, t('preview.startsIn')))
      : null;

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-preview' },
        h(
          'header',
          { class: 'uh-preview__head' },
          h(
            'div',
            { class: 'uh-preview__titleCard' },
            h('div', { class: 'uh-preview__kicker' }, chip('preview.title', 'night', 'map'), this.props.context ? chip(this.props.context, 'gold') : null),
            chunky(t(L.nameKey), { tag: 'h1', cls: 'uh-preview__title', tone: 'cream' }),
            h('p', { class: 'uh-preview__desc' }, t(L.descKey)),
          ),
          h('div', { class: 'uh-preview__total' }, icon('coin'), h('span', null, t('preview.total', { value: layoutTotalValue(L) }))),
        ),
        h('div', { class: 'uh-preview__spacer' }, this.countEl),
        h(
          'div',
          { class: 'uh-preview__foot' },
          teamCard(0),
          h('div', { class: 'uh-preview__mid' }, h('div', { class: 'uh-preview__vs' }, chunky(t('common.vs'), { tone: 'sun' })), h('div', { class: 'uh-preview__legendCard' }, legend, h('p', { class: 'uh-preview__same' }, icon('shield'), t('preview.sameInfo'))), fuse),
          teamCard(1),
        ),
        promptBar([{ action: 'confirm', label: 'preview.skip' }, ...(this.props.onBack ? [{ action: 'back' as const, label: 'prompt.back' as TextRef }] : [])]),
      ),
    );
  }

  protected override onShow(): void {
    this.finished = false;
    this.counting = false;
    const hold = this.props.holdMs ?? 2600;
    window.clearTimeout(this.holdTimer);
    if (hold > 0) this.holdTimer = window.setTimeout(() => this.startCountdown(), hold);
  }

  protected override onHide(): void {
    this.stopTimers();
  }

  protected override onDestroy(): void {
    this.stopTimers();
  }

  override handleNav(action: Parameters<UiScreen<LayoutPreviewProps>['handleNav']>[0]): boolean {
    if (this.isLeaving || this.finished) return true;
    if (action === 'confirm') {
      if (this.props.onSkip) {
        this.stopTimers();
        this.leave(this.props.onSkip);
      } else this.startCountdown();
      return true;
    }
    if (action === 'back' && this.props.onBack) {
      this.stopTimers();
      this.leave(this.props.onBack);
      return true;
    }
    return true; // swallow everything else: the preview has no menu
  }

  /**
   * The screen area the cards leave free for the 3D miniature (0..1 viewport fractions), so the
   * board can be framed inside it. Null while hidden.
   */
  safeArea(): { l: number; t: number; r: number; b: number } | null {
    if (!this.isVisible) return null;
    const head = this.el.querySelector<HTMLElement>('.uh-preview__head');
    const foot = this.el.querySelector<HTMLElement>('.uh-preview__foot');
    const frame = this.el.querySelector<HTMLElement>('.uh-frame');
    if (!head || !foot || !frame) return null;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const fr = frame.getBoundingClientRect();
    const desc = this.el.querySelector<HTMLElement>('.uh-preview__desc')?.getBoundingClientRect();
    const top = Math.max(head.getBoundingClientRect().bottom, desc?.bottom ?? 0) + 8;
    // The VS / legend column sits lowest in the middle; the team cards are on the sides.
    const footTop = Math.min(...Array.from(foot.children).map((c) => c.getBoundingClientRect().top)) - 8;
    return { l: Math.max(0, fr.left / vw + 0.02), t: top / vh, r: Math.min(1, fr.right / vw - 0.02), b: footTop / vh };
  }

  /** Cards the 3D price tags must not slide under (viewport px). */
  keepOut(): { l: number; t: number; r: number; b: number }[] {
    if (!this.isVisible) return [];
    const sel = '.uh-preview__titleCard > *, .uh-preview__total, .uh-preview__team, .uh-preview__vs, .uh-preview__legendCard, .uh-preview__fuse, .uh-promptbar';
    return Array.from(this.el.querySelectorAll<HTMLElement>(sel)).map((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    });
  }

  /** Start 3-2-1-출발! now (idempotent). */
  startCountdown(from = this.props.countdownFrom ?? 3): void {
    if (this.counting || this.finished || this.isLeaving) return;
    this.counting = true;
    window.clearTimeout(this.holdTimer);
    for (let i = 0; i <= from; i++) {
      const n = from - i;
      this.countTimers.push(window.setTimeout(() => this.setCountdown(n), i * 1000));
    }
    this.countTimers.push(
      window.setTimeout(() => {
        this.finished = true;
        this.leave(this.props.onDone);
      }, from * 1000 + 650),
    );
  }

  /** Show a countdown value externally (n > 0: number, 0: 출발!, null: hide). */
  setCountdown(n: number | null): void {
    const el = this.countEl;
    if (!el) return;
    if (n === null) {
      el.classList.remove('is-on');
      return;
    }
    el.classList.add('is-on');
    el.classList.toggle('is-go', n === 0);
    el.replaceChildren(chunky(n > 0 ? String(n) : t('banner.go'), { tone: n > 0 ? 'cream' : 'sun' }));
    uiSound(n > 0 ? 'tick' : 'stamp');
    this.props.onTick?.(n);
    animateEl(el, [{ transform: 'scale(2.4)', opacity: 0 }, { transform: 'scale(0.9, 1.1)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: 380,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
  }

  private stopTimers(): void {
    window.clearTimeout(this.holdTimer);
    for (const id of this.countTimers) window.clearTimeout(id);
    this.countTimers = [];
    this.counting = false;
  }
}
