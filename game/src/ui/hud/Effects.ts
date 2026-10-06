/**
 * Transient HUD effects: score popups, banners, 3-2-1 countdown and captions.
 * All self-removing; none of them blocks input.
 */
import type { TeamId } from '../../sim/types';
import { t, type TParams } from '../i18n';
import { animateEl, h, isReducedMotion } from '../core/dom';
import { icon, lootIcon, teamEmblem } from '../core/icons';
import { fmtScore } from '../core/format';
import type { BannerKind, CaptionOptions, ScorePopupOptions } from './types';

// ---------------------------------------------------------------------------------------------
// Score popups ('+100', '+300', '건물 500 + 금고 500 = +1,000')
// ---------------------------------------------------------------------------------------------

export class ScorePopups {
  readonly el: HTMLDivElement;
  private stackY = 0;
  private lastAt = 0;

  constructor() {
    this.el = h('div', { class: 'uh-popups', 'aria-live': 'polite' });
  }

  pop(o: ScorePopupOptions, myTeam: TeamId): void {
    const mine = o.team === myTeam;
    const isBank = o.kind === 'bank';
    const text = isBank
      ? o.safes
        ? t('popup.bank', { building: o.building ?? 500, safes: o.safes, total: o.value })
        : t('popup.bankEmpty', { total: o.value })
      : `+${fmtScore(o.value)}`;
    const el = h(
      'div',
      { class: ['uh-popup', `uh-popup--${o.kind}`, `uh-popup--t${o.team}`, mine ? 'is-mine' : 'is-theirs'] },
      h('span', { class: 'uh-popup__emblem' }, teamEmblem(o.team)),
      isBank ? h('span', { class: 'uh-popup__art' }, lootIcon('bank')) : h('span', { class: 'uh-popup__art' }, lootIcon(o.kind)),
      h('span', { class: 'uh-popup__text' }, text),
    );
    // Anchor: world position if given, else stacked under the scoreboard.
    const now = performance.now();
    if (now - this.lastAt > 1400) this.stackY = 0;
    this.lastAt = now;
    if (o.x !== undefined && o.y !== undefined) {
      el.classList.add('is-world');
      el.style.left = `${o.x}px`;
      el.style.top = `${o.y}px`;
    } else {
      el.classList.add('is-top');
      el.style.setProperty('--stack', String(this.stackY));
      this.stackY++;
    }
    this.el.appendChild(el);
    const life = isBank ? 2600 : 1700;
    window.setTimeout(() => el.remove(), isReducedMotion() ? life : life + 50);
  }

  clear(): void {
    this.el.replaceChildren();
  }
}

// ---------------------------------------------------------------------------------------------
// Banners + countdown
// ---------------------------------------------------------------------------------------------

const BANNER_TEXT: Record<BannerKind, string> = {
  escape: 'banner.escape',
  timeUp: 'banner.timeUp',
  decided: 'banner.decided',
  allRecovered: 'banner.allRecovered',
  practiceDone: 'banner.practiceDone',
  go: 'banner.go',
};

export class Banners {
  readonly el: HTMLDivElement;
  private current: HTMLElement | null = null;
  private timer = 0;

  constructor() {
    this.el = h('div', { class: 'uh-banners', 'aria-live': 'assertive' });
  }

  show(kind: BannerKind, params?: TParams, durationMs?: number): void {
    this.dismiss();
    const sub = kind === 'escape' ? t('banner.escape.sub') : null;
    const el = h(
      'div',
      { class: ['uh-banner', `uh-banner--${kind}`] },
      kind === 'escape' ? h('span', { class: 'uh-banner__siren' }, icon('siren')) : null,
      h('div', { class: 'uh-banner__text' }, h('span', { class: 'uh-banner__title' }, t(BANNER_TEXT[kind], params)), sub ? h('span', { class: 'uh-banner__sub' }, sub) : null),
      kind === 'escape' ? h('span', { class: 'uh-banner__siren' }, icon('siren')) : null,
    );
    this.el.appendChild(el);
    this.current = el;
    const life = durationMs ?? (kind === 'escape' ? 3200 : kind === 'go' ? 900 : 2400);
    this.timer = window.setTimeout(() => this.dismiss(), life);
  }

  /** 3, 2, 1 then 0 = '출발!'. */
  countdown(n: number): void {
    if (n <= 0) {
      this.show('go');
      return;
    }
    this.dismiss();
    const el = h('div', { class: 'uh-banner uh-banner--count' }, h('span', { class: 'uh-banner__count uh-num' }, String(n)));
    this.el.appendChild(el);
    this.current = el;
    animateEl(el, [{ transform: 'scale(1.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    this.timer = window.setTimeout(() => this.dismiss(), 950);
  }

  dismiss(): void {
    window.clearTimeout(this.timer);
    const el = this.current;
    this.current = null;
    if (!el) return;
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), isReducedMotion() ? 0 : 220);
  }
}

// ---------------------------------------------------------------------------------------------
// Captions (subtitles for sounds, doc §13)
// ---------------------------------------------------------------------------------------------

interface CaptionLine {
  key: string;
  el: HTMLElement;
  timer: number;
}

const MAX_CAPTIONS = 3;

export class Captions {
  readonly el: HTMLDivElement;
  private enabled = true;
  private lines: CaptionLine[] = [];

  constructor() {
    this.el = h('div', { class: 'uh-captions', 'aria-live': 'polite' });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  show(key: string, o: CaptionOptions = {}): void {
    if (!this.enabled) return;
    const text = t(key, o.params);
    const id = `${key}|${o.side ?? ''}`;
    const existing = this.lines.find((l) => l.key === id);
    if (existing) {
      // Same sound again: refresh instead of stacking duplicates.
      window.clearTimeout(existing.timer);
      existing.timer = window.setTimeout(() => this.remove(existing), o.durationMs ?? 2600);
      animateEl(existing.el, [{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], 180);
      return;
    }
    const el = h(
      'div',
      { class: ['uh-caption', o.side ? `uh-caption--${o.side}` : ''] },
      o.side === 'left' ? h('span', { class: 'uh-caption__dir' }, '◀') : null,
      h('span', null, text),
      o.side === 'right' ? h('span', { class: 'uh-caption__dir' }, '▶') : null,
    );
    const line: CaptionLine = { key: id, el, timer: 0 };
    line.timer = window.setTimeout(() => this.remove(line), o.durationMs ?? 2600);
    this.lines.push(line);
    this.el.appendChild(el);
    while (this.lines.length > MAX_CAPTIONS) this.remove(this.lines[0]);
  }

  clear(): void {
    for (const l of [...this.lines]) this.remove(l);
  }

  private remove(line: CaptionLine): void {
    window.clearTimeout(line.timer);
    const i = this.lines.indexOf(line);
    if (i >= 0) this.lines.splice(i, 1);
    line.el.remove();
  }
}
