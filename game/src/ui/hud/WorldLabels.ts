/**
 * Pooled DOM labels anchored to screen positions supplied every frame (GameView.project()).
 * - value tags (safe shape + 100 / 300), bank estimate ('예상 1,000' + breakdown line),
 *   recovery progress rings, ping markers ('같이 잡자' / '이쪽으로'), name tags.
 * - Elements are reused by (kind, id); positions use translate3d only; text/attributes are
 *   written only when they change. Unused entries are hidden and recycled.
 * - Labels never pile up: after positioning, overlapping tags are nudged apart (bank estimate
 *   first, then pings, focused tags, value tags, names), each moving the shorter way up or
 *   down. Sizes are measured only when a label's content changes.
 */
import type { TeamId } from '../../sim/types';
import { t, trName, type TextRef } from '../i18n';
import { h, setClass, setText } from '../core/dom';
import { lootIcon, teamEmblem } from '../core/icons';
import { clamp01, fmtScore, finiteOrNull } from '../core/format';
import type { WorldLabelModel } from './types';
import { placeLabel, type Box } from '../core/declutter';

type Kind = WorldLabelModel['kind'];

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

interface Entry {
  kind: Kind;
  el: HTMLElement;
  inner: HTMLElement;
  /** Written transform position. */
  x: number;
  y: number;
  /** Anchor this frame (before de-overlap). */
  ax: number;
  ay: number;
  /** Measured tag size (px, incl. focus scale); 0 = unknown. */
  w: number;
  h: number;
  dirty: boolean;
  prio: number;
  shown: boolean;
  seen: boolean;
  /** Cached kind-specific state (strings / numbers) to diff against. */
  a: string | number | boolean | null;
  b: string | number | boolean | null;
  c: string | number | boolean | null;
  // parts
  text?: HTMLElement;
  sub?: HTMLElement;
  art?: HTMLElement;
  ring?: SVGCircleElement;
}

/** Cheap identity for a TextRef so the label only re-resolves when the reference changes. */
function refKey(r: TextRef): string {
  if (typeof r === 'string') return r;
  if ('text' in r) return `\u0001${r.text}`;
  return r.params ? `${r.key}\u0002${JSON.stringify(r.params)}` : r.key;
}

/** Lower = placed first (keeps its spot). Recovery rings sit on the ground and never move. */
function priority(m: WorldLabelModel): number {
  switch (m.kind) {
    case 'bank':
      return 0;
    case 'ping':
      return 1;
    case 'value':
      return m.focus ? 2 : 3;
    case 'name':
      return 4;
    default:
      return -1;
  }
}

const GAP = 3;

export class WorldLabels {
  readonly el: HTMLDivElement;
  private readonly active = new Map<string, Entry>();
  private readonly order: Entry[] = [];
  private readonly placed: Box[] = [];
  private readonly free: Record<Kind, Entry[]> = { value: [], bank: [], recovery: [], ping: [], name: [] };

  constructor() {
    this.el = h('div', { class: 'uh-wlabels', 'aria-hidden': 'true' });
  }

  /** Apply one frame of labels. */
  update(labels: readonly WorldLabelModel[] | undefined): void {
    for (const e of this.active.values()) e.seen = false;
    if (labels) {
      for (let i = 0; i < labels.length; i++) {
        const m = labels[i];
        // A label without a usable screen position is treated as absent (hidden / recycled).
        if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
        const key = `${m.kind}:${m.id}`;
        let e = this.active.get(key);
        if (!e) {
          e = this.acquire(m.kind);
          this.active.set(key, e);
        }
        e.seen = true;
        this.apply(e, m);
      }
    }
    for (const [key, e] of this.active) {
      if (e.seen) continue;
      this.active.delete(key);
      this.release(e);
    }
    this.layout();
  }

  /** De-overlap pass: place labels by priority, nudging later ones up or down. */
  private layout(): void {
    const order = this.order;
    order.length = 0;
    for (const e of this.active.values()) {
      if (e.dirty && e.prio >= 0) {
        const k = e.el.classList.contains('is-focus') ? (e.kind === 'bank' ? 1.12 : 1.2) : 1;
        e.w = e.inner.offsetWidth * k;
        e.h = e.inner.offsetHeight * k;
        // HUD not laid out yet (hidden): try again next frame.
        e.dirty = e.w <= 0;
      }
      if (e.prio < 0 || e.w <= 0) this.place(e, e.ax, e.ay);
      else order.push(e);
    }
    order.sort((a, b) => a.prio - b.prio || a.ay - b.ay);
    const placed = this.placed;
    placed.length = 0;
    for (const e of order) this.place(e, e.ax, (window as unknown as { __noDeclutter?: boolean }).__noDeclutter ? e.ay : placeLabel(placed, e.ax, e.ay, e.w, e.h, GAP));
  }

  private place(e: Entry, ax: number, ay: number): void {
    // Position snapped to 0.5 px: no write when the camera moved less than that.
    const x = Math.round(ax * 2) / 2;
    const y = Math.round(ay * 2) / 2;
    if (x !== e.x || y !== e.y) {
      e.x = x;
      e.y = y;
      e.el.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
  }

  /** Language changed: force text refresh on next update. */
  invalidate(): void {
    for (const e of this.active.values()) {
      e.a = e.b = e.c = null;
    }
  }

  clear(): void {
    this.update(undefined);
  }

  private acquire(kind: Kind): Entry {
    const pooled = this.free[kind].pop();
    if (pooled) {
      pooled.shown = false;
      return pooled;
    }
    const e = this.create(kind);
    this.el.appendChild(e.el);
    return e;
  }

  private release(e: Entry): void {
    if (e.shown) {
      e.el.hidden = true;
      e.shown = false;
    }
    this.free[e.kind].push(e);
  }

  private create(kind: Kind): Entry {
    const inner = h('div', { class: 'uh-wl__in' });
    const base: Entry = { kind, el: h('div', { class: `uh-wl uh-wl--${kind}` }), inner, x: NaN, y: NaN, ax: 0, ay: 0, w: 0, h: 0, dirty: true, prio: -1, shown: false, seen: false, a: null, b: null, c: null };
    base.el.hidden = true;
    base.el.appendChild(inner);
    switch (kind) {
      case 'value': {
        base.art = h('span', { class: 'uh-wl__art' });
        base.text = h('span', { class: 'uh-wl__num' });
        base.sub = h('span', { class: 'uh-wl__loaded' });
        inner.append(base.art, base.text, base.sub);
        break;
      }
      case 'bank': {
        base.art = h('span', { class: 'uh-wl__art' }, lootIcon('bank'));
        base.text = h('span', { class: 'uh-wl__num' });
        base.sub = h('span', { class: 'uh-wl__sub' });
        inner.append(h('div', { class: 'uh-wl__row' }, base.art, base.text), base.sub);
        break;
      }
      case 'recovery': {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 56 56');
        svg.setAttribute('class', 'uh-wl__ringSvg');
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bg.setAttribute('cx', '28');
        bg.setAttribute('cy', '28');
        bg.setAttribute('r', String(RING_R));
        bg.setAttribute('class', 'uh-wl__ringBg');
        const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        fg.setAttribute('cx', '28');
        fg.setAttribute('cy', '28');
        fg.setAttribute('r', String(RING_R));
        fg.setAttribute('class', 'uh-wl__ringFg');
        fg.setAttribute('stroke-dasharray', String(RING_C));
        fg.setAttribute('stroke-dashoffset', String(RING_C));
        svg.append(bg, fg);
        base.ring = fg;
        base.art = h('span', { class: 'uh-wl__ringIcon' });
        inner.append(svg, base.art);
        break;
      }
      case 'ping': {
        base.art = h('span', { class: 'uh-wl__pin' });
        base.text = h('span', { class: 'uh-wl__pingText' });
        inner.append(base.text, base.art);
        break;
      }
      case 'name': {
        base.art = h('span', { class: 'uh-wl__nameArt' });
        base.text = h('span', { class: 'uh-wl__name' });
        inner.append(base.art, base.text);
        break;
      }
    }
    return base;
  }

  private apply(e: Entry, m: WorldLabelModel): void {
    e.ax = m.x;
    e.ay = m.y;
    e.prio = priority(m);
    if (!e.shown) {
      e.el.hidden = false;
      e.shown = true;
      e.dirty = true;
    }
    // Any content / flag change below can change the tag size: re-measure once.
    const a0 = e.a;
    const b0 = e.b;
    const c0 = e.c;
    this.applyContent(e, m);
    // Recovery rings never move (fixed size): no re-measure for their progress ticks.
    if (e.prio >= 0 && (e.a !== a0 || e.b !== b0 || e.c !== c0)) e.dirty = true;
  }

  private applyContent(e: Entry, m: WorldLabelModel): void {
    switch (m.kind) {
      case 'value': {
        if (e.a !== m.loot) {
          e.a = m.loot;
          e.art!.replaceChildren(lootIcon(m.loot));
          e.el.dataset.loot = m.loot;
        }
        const value = finiteOrNull(m.value);
        if (e.b !== value) {
          e.b = value;
          setText(e.text!, fmtScore(value ?? NaN));
        }
        const flags = (m.loaded ? 1 : 0) | (m.focus ? 2 : 0);
        if (e.c !== flags) {
          e.c = flags;
          setClass(e.el, 'is-focus', !!m.focus);
          setClass(e.el, 'is-loaded', !!m.loaded);
          setText(e.sub!, m.loaded ? t('hud.loaded') : '');
        }
        break;
      }
      case 'bank': {
        const value = finiteOrNull(m.value);
        if (e.a !== value) {
          e.a = value;
          setText(e.text!, t('hud.estimate', { value: value ?? NaN }));
        }
        const sub = m.showBreakdown && m.building !== undefined ? `${m.building}|${m.safes ?? 0}` : '';
        if (e.b !== sub) {
          e.b = sub;
          setText(e.sub!, sub ? t('hud.bankBreakdown', { building: m.building ?? 0, safes: m.safes ?? 0 }) : '');
          setClass(e.el, 'has-sub', !!sub);
        }
        const flags = `${m.carriedBy ?? '-'}${m.focus ? 'f' : ''}`;
        if (e.c !== flags) {
          e.c = flags;
          setClass(e.el, 'is-focus', !!m.focus);
          setClass(e.el, 'is-carried-0', m.carriedBy === 0);
          setClass(e.el, 'is-carried-1', m.carriedBy === 1);
        }
        break;
      }
      case 'recovery': {
        const p = clamp01(m.progress);
        const q = Math.round(p * 100) / 100;
        if (e.a !== q) {
          e.a = q;
          e.ring!.setAttribute('stroke-dashoffset', String((RING_C * (1 - q)).toFixed(2)));
          setClass(e.el, 'is-full', q >= 1);
        }
        if (e.b !== m.team) {
          e.b = m.team;
          e.el.dataset.team = String(m.team);
          e.art!.replaceChildren(teamEmblem(m.team as TeamId));
        }
        break;
      }
      case 'ping': {
        if (e.a !== m.ping) {
          e.a = m.ping;
          e.c = null;
        }
        if (e.c === null) {
          e.c = 1;
          setText(e.text!, t(m.ping === 'grabTogether' ? 'hud.ping.grabTogether' : 'hud.ping.goHere'));
          e.el.dataset.ping = m.ping;
        }
        if (e.b !== m.team) {
          e.b = m.team;
          e.el.dataset.team = String(m.team);
          e.art!.replaceChildren(teamEmblem(m.team as TeamId, 'uh-emblem', 'light'));
        }
        break;
      }
      case 'name': {
        const ref = refKey(m.text);
        if (e.a !== ref) {
          e.a = ref;
          setText(e.text!, trName(m.text));
        }
        const k = `${m.team}${m.isMe ? 'm' : ''}`;
        if (e.b !== k) {
          e.b = k;
          e.el.dataset.team = String(m.team);
          setClass(e.el, 'is-me', !!m.isMe);
          e.art!.replaceChildren(teamEmblem(m.team as TeamId));
        }
        break;
      }
    }
  }
}
