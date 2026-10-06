/**
 * Transient HUD effects: score popups, banners (incl. the red/blue police alert), the 3-2-1
 * slam, stamp callouts and captions. All self-removing; none of them blocks input.
 */
import type { TeamId } from '../../sim/types';
import { t, type TParams } from '../i18n';
import { animateEl, h, isReducedMotion } from '../core/dom';
import { icon, lootIcon, teamEmblem, type IconName } from '../core/icons';
import { fmtScore } from '../core/format';
import { chunky, slamIn, type StampTone } from '../core/juice';
import type { BannerKind, CaptionOptions, HudStampKind, HudStampOptions, ScorePopupOptions } from './types';

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
      h('span', { class: 'uh-popup__art' }, lootIcon(isBank ? 'bank' : o.kind)),
      h('span', { class: 'uh-popup__text' }, text),
    );
    // Anchor: world position if given, else stacked under the scoreboard.
    const now = performance.now();
    if (now - this.lastAt > 1400) this.stackY = 0;
    this.lastAt = now;
    if (o.x !== undefined && o.y !== undefined && Number.isFinite(o.x) && Number.isFinite(o.y)) {
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
  policeDispatched: 'banner.policeDispatched',
  policeArrived: 'banner.policeArrived',
};

const BANNER_SUB: Partial<Record<BannerKind, string>> = {
  escape: 'banner.escape.sub',
  policeDispatched: 'banner.policeDispatched.sub',
  policeArrived: 'banner.policeArrived.sub',
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
    const subKey = BANNER_SUB[kind];
    const police = kind === 'policeDispatched' || kind === 'policeArrived';
    const siren = kind === 'escape' || police;
    const el = h(
      'div',
      { class: ['uh-banner', `uh-banner--${kind}`, police ? 'uh-banner--police' : ''] },
      police ? h('span', { class: 'uh-banner__flash', 'aria-hidden': 'true' }) : null,
      siren ? h('span', { class: 'uh-banner__siren' }, icon(police ? 'police' : 'siren')) : null,
      h(
        'div',
        { class: 'uh-banner__text' },
        chunky(t(BANNER_TEXT[kind], params), { cls: 'uh-banner__title', tone: kind === 'go' ? 'sun' : 'cream' }),
        subKey ? h('span', { class: 'uh-banner__sub' }, t(subKey, params)) : null,
      ),
      siren ? h('span', { class: 'uh-banner__siren' }, icon('siren')) : null,
    );
    this.el.appendChild(el);
    this.current = el;
    animateEl(el, [{ transform: 'scale(1.9) rotate(-6deg)', opacity: 0 }, { transform: 'scale(0.92, 1.08) rotate(1deg)', opacity: 1, offset: 0.55 }, { transform: 'scale(1) rotate(-1.5deg)', opacity: 1 }], {
      duration: 460,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
    const life = durationMs ?? (kind === 'escape' ? 3200 : kind === 'go' ? 900 : police ? 2800 : 2400);
    this.timer = window.setTimeout(() => this.dismiss(), life);
  }

  /** 3, 2, 1 then 0 = '출발!' — each number slams in with a squash. */
  countdown(n: number): void {
    if (n <= 0) {
      // (The match audio director plays the countdown beeps / start whistle.)
      this.show('go');
      return;
    }
    this.dismiss();
    const el = h('div', { class: 'uh-banner uh-banner--count', 'data-n': String(n) }, chunky(String(n), { cls: 'uh-banner__count', tone: n === 1 ? 'tomato' : n === 2 ? 'sun' : 'mint' }));
    this.el.appendChild(el);
    this.current = el;
    animateEl(el, [{ transform: 'scale(2.6) rotate(-14deg)', opacity: 0 }, { transform: 'scale(0.86, 1.12) rotate(4deg)', opacity: 1, offset: 0.55 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], {
      duration: 380,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
    this.timer = window.setTimeout(() => this.dismiss(), 950);
  }

  dismiss(): void {
    window.clearTimeout(this.timer);
    const el = this.current;
    this.current = null;
    if (!el) return;
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), isReducedMotion() ? 0 : 240);
  }
}

// ---------------------------------------------------------------------------------------------
// Stamp callouts ("뽑았다!", "가로채기!", "은행째!", "태클 피했다!", "경찰이다!")
// ---------------------------------------------------------------------------------------------

const STAMP: Record<HudStampKind, { key: string; icon: IconName; tone: StampTone }> = {
  uproot: { key: 'stamp.uproot', icon: 'bolt', tone: 'sun' },
  steal: { key: 'stamp.steal', icon: 'hand', tone: 'grape' },
  bankWhole: { key: 'stamp.bankWhole', icon: 'trophy', tone: 'tomato' },
  dodge: { key: 'stamp.dodge', icon: 'shield', tone: 'mint' },
  police: { key: 'stamp.police', icon: 'police', tone: 'sky' },
};

export class Stamps {
  readonly el: HTMLDivElement;
  private live: HTMLElement[] = [];
  private lastKey = '';
  private lastAt = 0;

  constructor() {
    this.el = h('div', { class: 'uh-stamps', 'aria-live': 'polite' });
  }

  show(kind: HudStampKind, o: HudStampOptions, myTeam: TeamId): void {
    const spec = STAMP[kind];
    const now = performance.now();
    // The same callout twice within a beat reads as one.
    const k = `${kind}|${o.team ?? '-'}`;
    if (k === this.lastKey && now - this.lastAt < 900) return;
    this.lastKey = k;
    this.lastAt = now;
    const mine = o.team === undefined || o.team === null ? null : o.team === myTeam;
    const el = h(
      'div',
      {
        class: ['uh-callout', `uh-callout--${kind}`, `uh-stamp`, `uh-stamp--${spec.tone}`, mine === null ? '' : mine ? 'is-mine' : 'is-theirs'],
        role: 'status',
      },
      h('span', { class: 'uh-callout__icon' }, icon(spec.icon)),
      h('span', { class: 'uh-stamp__text' }, t(spec.key, o.params)),
      o.team !== undefined && o.team !== null ? h('span', { class: 'uh-callout__team' }, teamEmblem(o.team, 'uh-emblem', 'light')) : null,
    );
    const rot = [-8, 6, -4, 9, -6][Math.floor(now / 97) % 5]!;
    if (o.x !== undefined && o.y !== undefined && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      el.classList.add('is-world');
      el.style.left = `${o.x}px`;
      el.style.top = `${o.y}px`;
    }
    // Keep at most two on screen.
    while (this.live.length >= 2) this.live.shift()?.remove();
    this.el.appendChild(el);
    this.live.push(el);
    slamIn(el, 0, rot);
    const life = kind === 'bankWhole' ? 2000 : 1600;
    window.setTimeout(() => {
      el.classList.add('is-leaving');
      window.setTimeout(() => {
        el.remove();
        this.live = this.live.filter((x) => x !== el);
      }, isReducedMotion() ? 0 : 260);
    }, life);
  }

  clear(): void {
    this.el.replaceChildren();
    this.live = [];
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
      o.side === 'left' ? h('span', { class: 'uh-caption__dir' }, icon('chevLeft')) : null,
      h('span', null, text),
      o.side === 'right' ? h('span', { class: 'uh-caption__dir' }, icon('chevRight')) : null,
    );
    const line: CaptionLine = { key: id, el, timer: 0 };
    line.timer = window.setTimeout(() => this.remove(line), o.durationMs ?? 2600);
    this.lines.push(line);
    this.el.appendChild(el);
    while (this.lines.length > MAX_CAPTIONS) this.remove(this.lines[0]!);
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
