/**
 * [C8] World tags for Content 2.0 things (content-plan §6 C8 wave 1, proximity only — doc §4):
 * - props near me / my grab candidate / my held prop: "ATM 200 · 동전 8", "돼지저금통 300 · 금 1/3",
 *   "돈나무 300 · 지폐 4", "황금 금고 400"
 * - breakables near me: "나무 상자 · 동전 2", "꿀꺽 자판기 · 동전 6" with HP pips
 * - item name tags (descending crate or ground pickup), only while `allowItem(kind)` says so: the
 *   first sightings of a kind (F9 `markItemSeen`), with a one-line "how to use" hint.
 *
 * Pooled DOM entries keyed by (kind, id), transform-only moves, text written on change, the
 * same de-overlap pass as the other world labels (item tags first, then focused props, props,
 * breakables).
 */
import type { ItemKind } from '../../sim/types';
import { t } from '../i18n';
import { animateEl, h, setClass, setText } from '../core/dom';
import { fmtScore } from '../core/format';
import { layoutTags, newTagMemory, tagOpacity, type Box, type Tag } from '../core/declutter';
import { breakableGlyph, breakableNameKey, itemGlyph, itemHintKey, itemNameKey, propGlyph, propNameKey } from './contentIcons';
import type { ContentLabelModel } from './contentTypes';

type Kind = ContentLabelModel['kind'];

/** Monotonic age stamp: among equal priorities the older tag keeps its spot. */
let seqNext = 0;

interface Entry extends Tag {
  kind: Kind;
  el: HTMLElement;
  inner: HTMLElement;
  art: HTMLElement;
  main: HTMLElement;
  sub: HTMLElement;
  pips: HTMLElement;
  x: number;
  y: number;
  ax: number;
  ay: number;
  w: number;
  h: number;
  dirty: boolean;
  prio: number;
  seen: boolean;
  /** Content signature (art / text) to diff against. */
  artKey: string;
  textKey: string;
}

const GAP = 3;

export class PropLabels {
  readonly el: HTMLDivElement;
  private readonly active = new Map<string, Entry>();
  private readonly free: Entry[] = [];
  private readonly order: Entry[] = [];
  private readonly placed: Box[] = [];
  /** Time of the previous layout (ms) for easing nudges; NaN = none yet. */
  private lastT = NaN;

  constructor() {
    this.el = h('div', { class: 'uh-ctags', 'aria-hidden': 'true' });
  }

  /** One frame of tags. `allowItem` gates item name tags (first sightings). */
  update(labels: readonly ContentLabelModel[] | undefined, allowItem: (kind: ItemKind) => boolean): void {
    for (const e of this.active.values()) e.seen = false;
    if (labels) {
      for (let i = 0; i < labels.length; i++) {
        const m = labels[i]!;
        if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
        if (m.kind === 'item' && !allowItem(m.item)) continue;
        const key = `${m.kind}:${m.id}`;
        let e = this.active.get(key);
        if (!e) {
          e = this.acquire(m.kind);
          this.active.set(key, e);
          e.el.hidden = false;
          e.dirty = true;
          if (m.kind === 'item') animateEl(e.inner, [{ transform: 'translate(-50%, -100%) scale(0.4)', opacity: 0 }, { transform: 'translate(-50%, -100%) scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%, -100%)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
        }
        e.seen = true;
        this.apply(e, m);
      }
    }
    for (const [key, e] of this.active) {
      if (e.seen) continue;
      this.active.delete(key);
      e.el.hidden = true;
      e.el.style.opacity = '';
      this.free.push(e);
    }
    this.layout();
  }

  /** Language changed: rewrite every text on the next update. */
  invalidate(): void {
    for (const e of this.active.values()) e.textKey = '';
  }

  clear(): void {
    this.update(undefined, () => false);
  }

  private acquire(kind: Kind): Entry {
    let e = this.free.pop();
    if (!e) {
      const art = h('span', { class: 'uh-ctag__art' });
      const main = h('span', { class: 'uh-ctag__main' });
      const sub = h('span', { class: 'uh-ctag__sub' });
      const pips = h('span', { class: 'uh-ctag__pips' });
      const inner = h('div', { class: 'uh-ctag__in' }, art, h('span', { class: 'uh-ctag__text' }, main, sub), pips);
      const el = h('div', { class: 'uh-ctag' }, inner);
      el.hidden = true;
      this.el.appendChild(el);
      e = { kind, el, inner, art, main, sub, pips, x: NaN, y: NaN, ax: 0, ay: 0, w: 0, h: 0, dirty: true, prio: 0, seen: false, artKey: '', textKey: '', seq: 0, ...newTagMemory() };
    }
    Object.assign(e, newTagMemory());
    e.seq = seqNext++;
    e.kind = kind;
    e.el.className = `uh-ctag uh-ctag--${kind}`;
    e.artKey = '';
    e.textKey = '';
    e.x = e.y = NaN;
    return e;
  }

  private apply(e: Entry, m: ContentLabelModel): void {
    e.ax = m.x;
    e.ay = m.y;
    let artKey: string;
    let textKey: string;
    switch (m.kind) {
      case 'prop': {
        e.prio = m.focus ? 1 : 2;
        artKey = `p:${m.variant}`;
        textKey = `${m.variant}|${m.value}|${m.coins}|${m.bills}|${m.cracks ?? ''}|${m.focus ? 1 : 0}`;
        if (artKey !== e.artKey) e.art.replaceChildren(propGlyph(m.variant, 'uh-cglyph uh-ctag__glyph'));
        if (textKey !== e.textKey) {
          setText(e.main, `${t(propNameKey(m.variant))} ${fmtScore(m.value)}`);
          const sub = m.coins > 0 ? t('hud.content.tag.coins', { n: m.coins }) : m.bills > 0 ? t('hud.content.tag.bills', { n: m.bills }) : m.cracks !== null ? (m.cracks > 0 ? t('hud.content.tag.cracks', { n: m.cracks }) : t('hud.content.tag.kick')) : '';
          setText(e.sub, sub);
          setClass(e.el, 'has-sub', !!sub);
          setClass(e.el, 'is-focus', m.focus);
          e.el.dataset.variant = m.variant;
          if (e.textKey && m.kind === 'prop') animateEl(e.inner, [{ transform: 'translate(-50%, -100%) scale(1.15)' }, { transform: 'translate(-50%, -100%)' }], { duration: 200, easing: 'ease-out' });
        }
        break;
      }
      case 'breakable': {
        e.prio = 3;
        artKey = `b:${m.breakable}`;
        textKey = `${m.breakable}|${m.coins}|${m.hp}|${m.maxHp}`;
        if (artKey !== e.artKey) e.art.replaceChildren(breakableGlyph(m.breakable, 'uh-cglyph uh-ctag__glyph'));
        if (textKey !== e.textKey) {
          setText(e.main, t(breakableNameKey(m.breakable)));
          setText(e.sub, m.coins > 0 ? t('hud.content.tag.coins', { n: m.coins }) : '');
          setClass(e.el, 'has-sub', m.coins > 0);
          const max = Math.max(0, Math.min(6, m.maxHp));
          if (max > 1) {
            const kids: HTMLElement[] = [];
            for (let i = 0; i < max; i++) kids.push(h('i', { class: i < m.hp ? 'is-on' : '' }));
            e.pips.replaceChildren(...kids);
          } else e.pips.replaceChildren();
        }
        break;
      }
      case 'item': {
        e.prio = 0;
        artKey = `i:${m.item}`;
        const sec = m.landSec === null ? -1 : Math.ceil(m.landSec);
        textKey = `${m.item}|${m.incoming ? sec : 'g'}`;
        if (artKey !== e.artKey) e.art.replaceChildren(itemGlyph(m.item, 'uh-cglyph uh-ctag__glyph'));
        if (textKey !== e.textKey) {
          setText(e.main, t(itemNameKey(m.item)));
          setText(e.sub, m.incoming ? t('hud.content.item.incoming', { sec: Math.max(0, sec) }) : t(itemHintKey(m.item)));
          setClass(e.el, 'has-sub', true);
          setClass(e.el, 'is-incoming', m.incoming);
          e.el.dataset.item = m.item;
        }
        break;
      }
    }
    if (artKey !== e.artKey || textKey !== e.textKey) e.dirty = true;
    e.artKey = artKey;
    e.textKey = textKey;
  }

  private layout(): void {
    const now = performance.now();
    const dt = Number.isFinite(this.lastT) ? (now - this.lastT) / 1000 : 0;
    this.lastT = now;
    const order = this.order;
    order.length = 0;
    for (const e of this.active.values()) {
      if (e.dirty) {
        e.w = e.inner.offsetWidth;
        e.h = e.inner.offsetHeight;
        e.dirty = e.w <= 0;
      }
      if (e.w <= 0) this.place(e, e.ax, e.ay);
      else order.push(e);
    }
    // same temporal de-overlap as WorldLabels: sticky sides, eased nudges, exact anchors
    const placed = this.placed;
    placed.length = 0;
    layoutTags(order, placed, dt, GAP);
    for (const e of order) {
      this.place(e, e.ax, e.ay + e.off.x);
      const o = tagOpacity(e.alpha); // cut-overs fade out, jump, fade back in
      if (e.el.style.opacity !== o) e.el.style.opacity = o;
    }
  }

  private place(e: Entry, ax: number, ay: number): void {
    // fractional px (no 0.5 px snapping shimmer); no write for sub-0.05 px changes
    if (Math.abs(ax - e.x) < 0.05 && Math.abs(ay - e.y) < 0.05) return;
    e.x = ax;
    e.y = ay;
    e.el.style.transform = `translate3d(${ax.toFixed(2)}px,${ay.toFixed(2)}px,0)`;
  }
}
