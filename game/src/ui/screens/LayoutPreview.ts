/**
 * Pre-match layout preview (doc §9: "시작 전 짧은 미리보기로 양쪽에 같은 정보를 준다").
 * Shows the layout name/description, the full paper map (statics, zones + vans, banks with
 * door direction and contents, safes by shape, bank-breakable fences), a legend, both teams,
 * then a 3-2-1-출발! countdown. Identical for both sides: nothing team-private is drawn.
 */
import type { HatId, LayoutDef, TeamId } from '../../sim/types';
import { SCORE } from '../../sim/config';
import { TEAM_STYLES } from '../../shared/teams';
import { t, tr, type TextRef } from '../i18n';
import { animateEl, h, setText, svgFromMarkup } from '../core/dom';
import { emblemMarkup, lootIcon, raccoon, type RivalId } from '../core/icons';
import { uiSound } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chip, promptBar, teamTag } from '../components/controls';
import { LayoutMap } from '../components/layoutMap';

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

function legendSwatch(kind: 'zone' | 'van' | 'bank' | 'smallSafe' | 'largeSafe' | 'fence', team: TeamId): Element {
  const st = TEAM_STYLES[team];
  switch (kind) {
    case 'zone':
      return svgFromMarkup(
        `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="28" height="24" rx="6" fill="${st.tint}" stroke="${st.dark}" stroke-width="2.4" stroke-dasharray="5 3"/><g transform="translate(8 8) scale(.68)">${emblemMarkup(st.emblem, st.color, '#2E2442', 2.2).replace(/<\/?svg[^>]*>/g, '')}</g></svg>`,
        'uh-legend__swatch',
      );
    case 'van':
      return svgFromMarkup(
        `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="9" width="28" height="15" rx="5" fill="${st.color}" stroke="#2E2442" stroke-width="2.2"/><rect x="21" y="12" width="5" height="9" rx="1.5" fill="#D9F1FF"/></svg>`,
        'uh-legend__swatch',
      );
    case 'bank':
      return svgFromMarkup(
        `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="7" width="24" height="18" rx="1.5" fill="#FFF0C2"/><g fill="#F2C14E" stroke="#2E2442" stroke-width="1.6"><rect x="4" y="7" width="2.6" height="18"/><rect x="25.4" y="7" width="2.6" height="18"/><rect x="4" y="7" width="8.5" height="2.6"/><rect x="19.5" y="7" width="8.5" height="2.6"/><rect x="4" y="22.4" width="8.5" height="2.6"/><rect x="19.5" y="22.4" width="8.5" height="2.6"/></g><path d="M13 28l3 3 3-3zM13 4l3-3 3 3z" fill="#2E2442"/></svg>`,
        'uh-legend__swatch',
      );
    case 'fence':
      return svgFromMarkup(
        `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="uhfc"><rect x="2" y="11" width="28" height="10" rx="2"/></clipPath></defs><g clip-path="url(#uhfc)"><rect x="2" y="11" width="28" height="10" fill="#FFD24A"/><path d="M0 21l10-10M8 21l10-10M16 21l10-10M24 21l10-10" stroke="#2E2442" stroke-width="3"/></g><rect x="2" y="11" width="28" height="10" rx="2" fill="none" stroke="#2E2442" stroke-width="2"/></svg>`,
        'uh-legend__swatch',
      );
    default:
      return lootIcon(kind, 'uh-legend__swatch');
  }
}

export class LayoutPreview extends UiScreen<LayoutPreviewProps> {
  private map: LayoutMap | null = null;
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
    this.map = new LayoutMap(L);
    this.own(() => this.map?.destroy());
    this.countEl = h('div', { class: 'uh-preview__count', 'aria-live': 'assertive' });

    const legend = h(
      'ul',
      { class: 'uh-legend' },
      ([
        ['zone', 'preview.legend.zone'],
        ['van', 'preview.legend.van'],
        ['bank', 'preview.legend.bank'],
        ['smallSafe', 'preview.legend.smallSafe'],
        ['largeSafe', 'preview.legend.largeSafe'],
        ['fence', 'preview.legend.fence'],
      ] as const)
        .filter(([k]) => k !== 'fence' || L.fences.length > 0)
        .map(([k, key]) => h('li', { class: 'uh-legend__item' }, legendSwatch(k, this.props.myTeam), h('span', null, t(key)))),
    );

    const teamCard = (team: TeamId): HTMLElement => {
      const spec = this.props.teams[team];
      return h(
        'div',
        { class: ['uh-preview__team', `uh-preview__team--${team}`, team === this.props.myTeam ? 'is-mine' : ''] },
        h('div', { class: 'uh-preview__teamHead' }, teamTag(team, spec.label ?? null), team === this.props.myTeam ? chip('team.mine', 'gold') : null),
        h(
          'div',
          { class: 'uh-preview__members' },
          spec.members.map((m) =>
            h(
              'div',
              { class: 'uh-preview__member' },
              h('div', { class: 'uh-preview__face' }, raccoon({ rival: m.rival ?? null, hat: m.hat ?? (m.rival ? undefined : TEAM_STYLES[team].hat), team })),
              h(
                'span',
                { class: 'uh-preview__mname' },
                tr(m.name),
                // "나" badge, unless the name already is "나" (default local player name).
                m.isYou && tr(m.name) !== t('hud.you') ? h('b', { class: 'uh-preview__you' }, t('hud.you')) : null,
              ),
            ),
          ),
        ),
      );
    };

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-preview' },
        h(
          'header',
          { class: 'uh-preview__head' },
          h(
            'div',
            { class: 'uh-preview__titles' },
            h('div', { class: 'uh-preview__kicker' }, chip('preview.title', 'night', 'map'), this.props.context ? chip(this.props.context, 'gold') : null),
            h('h1', { class: 'uh-preview__title uh-outline-text' }, t(L.nameKey)),
            h('p', { class: 'uh-preview__desc' }, t(L.descKey)),
          ),
          h('div', { class: 'uh-preview__total' }, chip({ key: 'preview.total', params: { value: layoutTotalValue(L) } }, 'gold')),
        ),
        h(
          'div',
          { class: 'uh-preview__body' },
          h('div', { class: 'uh-preview__mapWrap uh-panel' }, this.map.el, this.countEl),
          h(
            'aside',
            { class: 'uh-preview__side' },
            teamCard(0),
            h('div', { class: 'uh-preview__vs uh-outline-text' }, t('common.vs')),
            teamCard(1),
            h('div', { class: 'uh-preview__legendCard uh-panel' }, legend, h('p', { class: 'uh-preview__same' }, t('preview.sameInfo'))),
          ),
        ),
        promptBar([{ action: 'confirm', label: 'preview.skip' }]),
      ),
    );
  }

  protected override onShow(): void {
    this.finished = false;
    this.counting = false;
    requestAnimationFrame(() => this.map?.draw());
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
    if (action === 'confirm') {
      if (this.props.onSkip) this.props.onSkip();
      else this.startCountdown();
      return true;
    }
    if (action === 'back' && this.props.onBack && !this.finished) {
      this.stopTimers();
      this.props.onBack();
      return true;
    }
    return true; // swallow everything else: the preview has no menu
  }

  /** Start 3-2-1-출발! now (idempotent). */
  startCountdown(from = this.props.countdownFrom ?? 3): void {
    if (this.counting || this.finished) return;
    this.counting = true;
    window.clearTimeout(this.holdTimer);
    for (let i = 0; i <= from; i++) {
      const n = from - i;
      this.countTimers.push(window.setTimeout(() => this.setCountdown(n), i * 1000));
    }
    this.countTimers.push(
      window.setTimeout(() => {
        this.finished = true;
        this.props.onDone();
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
    setText(el, n > 0 ? String(n) : t('banner.go'));
    uiSound(n > 0 ? 'move' : 'confirm');
    this.props.onTick?.(n);
    animateEl(el, [{ transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], {
      duration: 320,
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
