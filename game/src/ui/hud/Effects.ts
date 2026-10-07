/**
 * Transient HUD effects: score popups, banners (incl. the red/blue police alert), the 3-2-1
 * slam, stamp callouts and captions. All self-removing; none of them blocks input.
 * [F4] Banners go through a priority queue (one centre plate at a time, compact climax plate that
 * shrinks into a badge); stamps add the moment stamps with an optional sub-line.
 */
import type { TeamId } from '../../sim/types';
import { t, type TParams } from '../i18n';
import { animateEl, h, isReducedMotion } from '../core/dom';
import { icon, lootIcon, teamEmblem, type IconName } from '../core/icons';
import { fmtScore } from '../core/format';
import { chunky, slamIn, type StampTone } from '../core/juice';
import type { BannerKind, CaptionOptions, HudBannerSpec, HudStampKind, HudStampOptions, ScorePopupOptions } from './types';
import { BannerQueue, MOMENT_STAMP_LOOK, stampEviction, type BannerPriority } from './tension';

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
// Banners + countdown, behind the [F4] priority queue
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

/** [F4] Queue priority of the built-in banner kinds. */
export const BANNER_PRIORITY: Record<BannerKind, BannerPriority> = {
  escape: 'climax',
  timeUp: 'final',
  decided: 'final',
  allRecovered: 'final',
  practiceDone: 'final',
  go: 'other',
  policeDispatched: 'police',
  policeArrived: 'police',
};

type BannerItem = { kind: BannerKind; params?: TParams } | { kind: 'custom'; spec: HudBannerSpec };

/**
 * Centre banners. Every plate goes through a BannerQueue (src/ui/hud/tension.ts): final >
 * climax > event > police > other, never two plates at once. The climax plate ("30초 뒤 출발!")
 * is compact, sits in the top third and after 0.8 s shrinks into the "도주 준비!" badge
 * (`badgeEl`, mounted by the HUD under the scoreboard), which stays for the whole final countdown.
 * Event / custom plates (C8) are compact too. 3-2-1 bypasses the queue (nothing else is up then).
 */
export class Banners {
  /** Centre host (big plates). */
  readonly el: HTMLDivElement;
  /** [F4] Compact host in the top third (climax / event plates). */
  readonly topEl: HTMLDivElement;
  /** [F4] "도주 준비!" badge (the climax plate after it shrinks); the HUD mounts it. */
  readonly badgeEl: HTMLDivElement;
  private current: HTMLElement | null = null;
  private currentClimax = false;
  private timer = 0;
  private readonly queue = new BannerQueue<BannerItem>();
  private climaxArmed = false;
  private finalOn = false;
  /** Called when a compact (top) plate goes up / comes down (the HUD moves the stamp column). */
  onTopPlate: ((up: boolean) => void) | null = null;

  constructor() {
    this.el = h('div', { class: 'uh-banners', 'aria-live': 'assertive' });
    this.topEl = h('div', { class: 'uh-banners uh-banners--top', 'aria-live': 'assertive' });
    this.badgeEl = h('div', { class: 'uh-climaxbadge', role: 'status' });
    this.badgeEl.hidden = true;
  }

  /** Built-in banner (queued by its BANNER_PRIORITY). */
  show(kind: BannerKind, params?: TParams, durationMs?: number): void {
    const police = kind === 'policeDispatched' || kind === 'policeArrived';
    const life = durationMs ?? (kind === 'escape' ? 3200 : kind === 'go' ? 900 : police ? 2800 : 2400);
    this.offer({ kind, params }, BANNER_PRIORITY[kind], life);
  }

  /** [F4] Any banner with an explicit priority (C8 event banners). */
  queueSpec(spec: HudBannerSpec): void {
    this.offer({ kind: 'custom', spec }, spec.priority, spec.durationMs ?? 2400);
  }

  /** 3, 2, 1 then 0 = '출발!' — each number slams in with a squash. */
  countdown(n: number): void {
    if (n <= 0) {
      // (The match audio director plays the countdown beeps / start whistle.)
      this.show('go');
      return;
    }
    this.queue.clear();
    window.clearTimeout(this.timer);
    this.takeDown();
    const el = h('div', { class: 'uh-banner uh-banner--count', 'data-n': String(n) }, chunky(String(n), { cls: 'uh-banner__count', tone: n === 1 ? 'tomato' : n === 2 ? 'sun' : 'mint' }));
    this.el.appendChild(el);
    this.current = el;
    // Opacity snaps in over the first few frames only: a slow fade of thick outlined digits
    // reads as a grey ghost.
    animateEl(el, [{ transform: 'scale(2.6) rotate(-14deg)', opacity: 0 }, { transform: 'scale(2.1) rotate(-10deg)', opacity: 1, offset: 0.1 }, { transform: 'scale(0.86, 1.12) rotate(4deg)', opacity: 1, offset: 0.55 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], {
      duration: 380,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
    this.timer = window.setTimeout(() => this.takeDown(), 950);
  }

  /** [F4] Final countdown running (HudModel.finalCountdown): keeps the climax badge up. */
  setFinalCountdown(on: boolean): void {
    if (on === this.finalOn) return;
    this.finalOn = on;
    if (!on) this.climaxArmed = false;
    this.paintBadge();
  }

  /** Take everything down (between matches, results). */
  dismiss(): void {
    window.clearTimeout(this.timer);
    this.queue.clear();
    this.takeDown();
    this.climaxArmed = false;
    this.finalOn = false;
    this.paintBadge();
  }

  /** [F4] Is a centre or compact plate up right now (tests / gallery)? */
  get plateUp(): boolean {
    return this.current !== null;
  }

  private offer(item: BannerItem, priority: BannerPriority, durationMs: number): void {
    const r = this.queue.push({ item, priority, durationMs }, performance.now());
    if (r.show) this.put(r.show.item, r.show.priority);
    this.schedule();
  }

  private pump(): void {
    const r = this.queue.update(performance.now());
    if (r.show) this.put(r.show.item, r.show.priority);
    else if (r.hide) this.takeDown();
    this.schedule();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    const at = this.queue.nextChange;
    if (at !== null) this.timer = window.setTimeout(() => this.pump(), Math.max(0, at - performance.now()));
  }

  private put(item: BannerItem, priority: BannerPriority): void {
    this.takeDown();
    const climax = priority === 'climax';
    const compact = item.kind === 'custom' ? item.spec.compact ?? (priority === 'climax' || priority === 'event') : climax;
    const el = item.kind === 'custom' ? this.buildCustom(item.spec) : this.buildKind(item.kind, item.params);
    if (compact) el.classList.add('uh-banner--compact');
    (compact ? this.topEl : this.el).appendChild(el);
    this.current = el;
    this.currentClimax = climax;
    if (compact) this.onTopPlate?.(true);
    if (priority === 'final') {
      // the match is over: the getaway badge has nothing left to say
      this.climaxArmed = false;
      this.paintBadge();
    }
    animateEl(el, [{ transform: 'scale(1.9) rotate(-6deg)', opacity: 0 }, { transform: 'scale(1.6) rotate(-4.5deg)', opacity: 1, offset: 0.1 }, { transform: 'scale(0.92, 1.08) rotate(1deg)', opacity: 1, offset: 0.55 }, { transform: 'scale(1) rotate(-1.5deg)', opacity: 1 }], {
      duration: compact ? 380 : 460,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
  }

  private buildKind(kind: BannerKind, params?: TParams): HTMLElement {
    const subKey = BANNER_SUB[kind];
    const police = kind === 'policeDispatched' || kind === 'policeArrived';
    const siren = kind === 'escape' || police;
    return h(
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
  }

  private buildCustom(spec: HudBannerSpec): HTMLElement {
    const tone = spec.tone ?? 'grape';
    const police = tone === 'police';
    return h(
      'div',
      { class: ['uh-banner', 'uh-banner--custom', `uh-banner--tone-${tone}`, police ? 'uh-banner--police' : ''] },
      police ? h('span', { class: 'uh-banner__flash', 'aria-hidden': 'true' }) : null,
      spec.icon ? h('span', { class: 'uh-banner__siren uh-banner__badgeIcon' }, icon(spec.icon)) : null,
      h(
        'div',
        { class: 'uh-banner__text' },
        chunky(t(spec.title, spec.params), { cls: 'uh-banner__title', tone: 'cream' }),
        spec.sub ? h('span', { class: 'uh-banner__sub' }, t(spec.sub, spec.params)) : null,
      ),
    );
  }

  /** Take the current plate down (a climax plate shrinks into the badge instead of fading). */
  private takeDown(): void {
    const el = this.current;
    const wasClimax = this.currentClimax;
    this.current = null;
    this.currentClimax = false;
    if (!el) return;
    const top = el.parentElement === this.topEl;
    if (wasClimax) {
      el.classList.add('is-badging');
      this.climaxArmed = true;
      this.paintBadge();
    } else el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), isReducedMotion() ? 0 : wasClimax ? 300 : 240);
    if (top) this.onTopPlate?.(false);
  }

  private paintBadge(): void {
    const on = this.climaxArmed && this.finalOn;
    if (on === !this.badgeEl.hidden) return;
    this.badgeEl.hidden = !on;
    if (on) {
      this.badgeEl.replaceChildren(h('span', { class: 'uh-climaxbadge__icon' }, icon('siren')), h('span', null, t('hud.moment.climaxBadge')));
      animateEl(this.badgeEl, [{ transform: 'translateY(2.5rem) scale(1.8)', opacity: 0 }, { transform: 'scale(0.92, 1.08)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Stamp callouts ("뽑았다!", "가로채기!", "은행째!", "태클 피했다!", "경찰이다!") + [F4] moment stamps
// ("역전!", "동점!", "막았다!", "연속 N점", "끊었다!", "잭팟 300!", ...)
// ---------------------------------------------------------------------------------------------

const STAMP: Record<HudStampKind, { key: string; icon: IconName; tone: StampTone }> = {
  uproot: { key: 'stamp.uproot', icon: 'bolt', tone: 'sun' },
  steal: { key: 'stamp.steal', icon: 'hand', tone: 'grape' },
  bankWhole: { key: 'stamp.bankWhole', icon: 'trophy', tone: 'tomato' },
  dodge: { key: 'stamp.dodge', icon: 'shield', tone: 'mint' },
  police: { key: 'stamp.police', icon: 'police', tone: 'sky' },
  ...MOMENT_STAMP_LOOK,
};

/** [F4] Stamps that outrank the others when the column is full (they push older ones out first). */
const BIG_STAMPS = new Set<HudStampKind>(['leadTaken', 'equalized', 'mpStopped', 'jackpot', 'craneDrop']);

export class Stamps {
  /** Column under the scoreboard (stamps without a screen anchor). */
  readonly el: HTMLDivElement;
  /** Full-screen layer for world-anchored stamps (no transformed ancestors: px = viewport px). */
  readonly worldEl: HTMLDivElement;
  private live: { el: HTMLElement; kind: HudStampKind }[] = [];
  private lastKey = '';
  private lastAt = 0;
  /** [F4] Stamps shown since the last clear (tests / gallery / metrics). */
  shownCount = 0;

  constructor() {
    this.el = h('div', { class: 'uh-stamps', 'aria-live': 'polite' });
    this.worldEl = h('div', { class: 'uh-stamps-world', 'aria-live': 'polite' });
  }

  show(kind: HudStampKind, o: HudStampOptions, myTeam: TeamId): void {
    const spec = STAMP[kind];
    const now = performance.now();
    // The same callout twice within a beat reads as one.
    const k = `${kind}|${o.team ?? '-'}|${o.key ?? ''}`;
    if (k === this.lastKey && now - this.lastAt < 900) return;
    // Keep at most two on screen: a new stamp pushes out the oldest small one first. A big one
    // (역전! / 막았다! ...) is pushed out only by another big one; a small callout arriving while
    // both live stamps are big is dropped, so routine callouts never cut a lead-change short.
    const big = BIG_STAMPS.has(kind);
    const slot = stampEviction(this.live.map((x) => BIG_STAMPS.has(x.kind)), big);
    if (slot.drop) return;
    this.lastKey = k;
    this.lastAt = now;
    const mine = o.team === undefined || o.team === null ? null : o.team === myTeam;
    const el = h(
      'div',
      {
        class: ['uh-callout', `uh-callout--${kind}`, `uh-stamp`, `uh-stamp--${spec.tone}`, mine === null ? '' : mine ? 'is-mine' : 'is-theirs', o.sub ? 'has-sub' : ''],
        role: 'status',
      },
      h('span', { class: 'uh-callout__icon' }, icon(spec.icon)),
      o.sub
        ? h('span', { class: 'uh-stamp__stack' }, h('span', { class: 'uh-stamp__text' }, t(o.key ?? spec.key, o.params)), h('span', { class: 'uh-stamp__sub' }, t(o.sub, o.params)))
        : h('span', { class: 'uh-stamp__text' }, t(o.key ?? spec.key, o.params)),
      o.team !== undefined && o.team !== null ? h('span', { class: 'uh-callout__team' }, teamEmblem(o.team, 'uh-emblem', 'light')) : null,
    );
    const rot = [-8, 6, -4, 9, -6][Math.floor(now / 97) % 5]!;
    const world = o.x !== undefined && o.y !== undefined && Number.isFinite(o.x) && Number.isFinite(o.y);
    if (world) {
      el.classList.add('is-world');
      el.style.left = `${o.x}px`;
      el.style.top = `${o.y}px`;
    }
    if (slot.evict !== null) this.live.splice(slot.evict, 1)[0]?.el.remove();
    while (this.live.length >= 2) this.live.shift()?.el.remove(); // defensive: never more than 2
    (world ? this.worldEl : this.el).appendChild(el);
    this.live.push({ el, kind });
    this.shownCount++;
    slamIn(el, 0, rot);
    const life = o.durationMs ?? (kind === 'bankWhole' || o.sub ? 2000 : big ? 1800 : 1600);
    window.setTimeout(() => {
      el.classList.add('is-leaving');
      window.setTimeout(() => {
        el.remove();
        this.live = this.live.filter((x) => x.el !== el);
      }, isReducedMotion() ? 0 : 260);
    }, life);
  }

  /** Stamps on screen right now (at most 2). */
  get liveCount(): number {
    return this.live.length;
  }

  clear(): void {
    this.el.replaceChildren();
    this.worldEl.replaceChildren();
    this.live = [];
    this.shownCount = 0;
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
