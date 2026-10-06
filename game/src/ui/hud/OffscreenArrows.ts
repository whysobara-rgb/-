/**
 * Edge arrows for carried / pinged targets that are off-screen (doc §4: "화면 밖 방향 표시는
 * 현재 운반하거나 핑으로 선택한 목표에 집중한다"). Game flow passes projected positions; the UI
 * decides visibility and clamps to an inset rectangle. Pooled, transform-only updates.
 */
import type { TeamId } from '../../sim/types';
import { h, setClass, setText } from '../core/dom';
import { icon, lootIcon, teamEmblem } from '../core/icons';
import { fmtScore, finiteOrNull } from '../core/format';
import type { OffscreenTarget } from './types';

interface Arrow {
  el: HTMLElement;
  pointer: HTMLElement;
  badge: HTMLElement;
  value: HTMLElement;
  x: number;
  y: number;
  angle: number;
  kindKey: string;
  valueNum: number | null;
  shown: boolean;
  seen: boolean;
}

export class OffscreenArrows {
  readonly el: HTMLDivElement;
  private readonly active = new Map<string | number, Arrow>();
  private readonly free: Arrow[] = [];
  private w = 0;
  private h = 0;

  constructor() {
    this.el = h('div', { class: 'uh-arrows', 'aria-hidden': 'true' });
  }

  /** Viewport size (CSS px of the UiRoot box). Call on resize. */
  setViewport(w: number, hgt: number): void {
    this.w = w;
    this.h = hgt;
  }

  update(targets: readonly OffscreenTarget[] | undefined, remPx: number): void {
    for (const a of this.active.values()) a.seen = false;
    if (targets && this.w > 0) {
      const margin = remPx * 3.6;
      const cx = this.w / 2;
      const cy = this.h / 2;
      for (const t of targets) {
        if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
        let dx = t.x - cx;
        let dy = t.y - cy;
        if (t.behind) {
          dx = -dx;
          dy = -dy;
        }
        const inside = !t.behind && t.x >= margin * 0.5 && t.x <= this.w - margin * 0.5 && t.y >= margin * 0.5 && t.y <= this.h - margin * 0.5;
        if (inside) continue;
        const hw = cx - margin;
        const hh = cy - margin;
        const k = Math.min(hw / Math.max(1e-3, Math.abs(dx)), hh / Math.max(1e-3, Math.abs(dy)));
        const x = cx + dx * k;
        const y = cy + dy * k;
        const angle = Math.atan2(dy, dx);
        let a = this.active.get(t.id);
        if (!a) {
          a = this.acquire();
          this.active.set(t.id, a);
        }
        a.seen = true;
        this.paint(a, t, x, y, angle);
      }
    }
    for (const [id, a] of this.active) {
      if (a.seen) continue;
      this.active.delete(id);
      if (a.shown) {
        a.el.hidden = true;
        a.shown = false;
      }
      this.free.push(a);
    }
  }

  private acquire(): Arrow {
    const pooled = this.free.pop();
    if (pooled) return pooled;
    const pointer = h('div', { class: 'uh-arrow__pointer' }, icon('arrow'));
    const badge = h('div', { class: 'uh-arrow__badge' });
    const value = h('div', { class: 'uh-arrow__value' });
    const el = h('div', { class: 'uh-arrow' }, pointer, h('div', { class: 'uh-arrow__body' }, badge, value));
    el.hidden = true;
    this.el.appendChild(el);
    return { el, pointer, badge, value, x: NaN, y: NaN, angle: NaN, kindKey: '', valueNum: null, shown: false, seen: false };
  }

  private paint(a: Arrow, t: OffscreenTarget, x: number, y: number, angle: number): void {
    // Snap to 0.5 px; NaN initial cache never equals, so the first frame always writes.
    const sx = Math.round(x * 2) / 2;
    const sy = Math.round(y * 2) / 2;
    if (sx !== a.x || sy !== a.y) {
      a.x = sx;
      a.y = sy;
      a.el.style.transform = `translate3d(${sx}px,${sy}px,0)`;
    }
    if (!(Math.abs(angle - a.angle) <= 0.004)) {
      a.angle = angle;
      // Icon 'arrow' points up (-y); rotate so it points along the angle.
      a.pointer.style.transform = `rotate(${(angle + Math.PI / 2).toFixed(3)}rad) translateY(-2.1rem)`;
    }
    const kindKey = `${t.kind}:${t.team ?? '-'}`;
    if (kindKey !== a.kindKey) {
      a.kindKey = kindKey;
      a.el.dataset.kind = t.kind;
      if (t.team !== undefined) a.el.dataset.team = String(t.team);
      else delete a.el.dataset.team;
      let art: Element;
      if (t.kind === 'bank') art = lootIcon('bank');
      else if (t.kind === 'safe') art = lootIcon('smallSafe');
      else if (t.kind === 'zone') art = t.team !== undefined ? teamEmblem(t.team as TeamId) : icon('van');
      else if (t.kind === 'ping') art = icon('ping');
      else art = icon('hand');
      a.badge.replaceChildren(art);
    }
    const v = finiteOrNull(t.value);
    if (v !== a.valueNum) {
      a.valueNum = v;
      setText(a.value, v === null ? '' : fmtScore(v));
      setClass(a.el, 'has-value', v !== null);
    }
    if (!a.shown) {
      a.el.hidden = false;
      a.shown = true;
    }
  }
}
