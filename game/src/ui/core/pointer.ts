/**
 * The paw pointer: one bouncing paw that hops (spring + overshoot) to whatever the top screen
 * has focused — the game's focus indicator instead of a browser-ish ring. Items can ask for the
 * paw on top (`data-paw="top"`, grid cards) or none (`data-paw="none"`).
 *
 * Otherwise the paw picks a side that is free: left of the item, then right, above, below.
 * A side is free when the paw would not cover another control or a line of text, so it never
 * hides the label it points at (button rows, a note beside the start button, cards).
 */
import { h, svgFromMarkup } from './dom';
import { navRouter } from './nav';

/** A raccoon paw poking right: ringed arm, round paw, four toes, pink beans. */
const PAW_SVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g stroke="#2A2131" stroke-width="3.6" stroke-linejoin="round">
    <rect x="1" y="24" width="24" height="16" rx="6" fill="#9C93AC"/>
    <path d="M8 24.5v15M15 24.5v15" stroke="#4A4458" stroke-width="4.2"/>
    <circle cx="50.5" cy="21.5" r="5.6" fill="#9C93AC"/>
    <circle cx="56" cy="30" r="5.6" fill="#9C93AC"/>
    <circle cx="56" cy="38.6" r="5.6" fill="#9C93AC"/>
    <circle cx="50.5" cy="46.5" r="5.6" fill="#9C93AC"/>
    <ellipse cx="37" cy="33.5" rx="16" ry="14.5" fill="#9C93AC"/>
  </g>
  <ellipse cx="38" cy="35.5" rx="7.2" ry="6" fill="#FF8FB8"/>
  <circle cx="51.5" cy="21.8" r="2.3" fill="#FF8FB8"/>
  <circle cx="56.6" cy="30" r="2.3" fill="#FF8FB8"/>
  <circle cx="56.6" cy="38.6" r="2.3" fill="#FF8FB8"/>
  <circle cx="51.5" cy="46.2" r="2.3" fill="#FF8FB8"/>
  <path d="M30 26c2-2.4 5-3.4 8-3" fill="none" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;

interface Target {
  focusedElement?: () => HTMLElement | null;
  el?: HTMLElement;
}

type PawMode = 'left' | 'right' | 'top' | 'bottom';
const SIDES: PawMode[] = ['left', 'right', 'top', 'bottom'];
/** How often the side is re-checked while the target stays the same (layout can move). */
const RECHECK_MS = 600;

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Paw anchor (gx, gy) and its drawn box for a side, in viewport px. */
function placement(mode: PawMode, r: DOMRect, rem: number): { gx: number; gy: number; box: Box } {
  const s = 3.75 * rem;
  switch (mode) {
    case 'right': {
      const gx = r.right + 0.6 * rem;
      const gy = r.top + r.height / 2;
      return { gx, gy, box: { l: gx - 0.15 * rem, t: gy - s / 2, r: gx - 0.15 * rem + s, b: gy + s / 2 } };
    }
    case 'top': {
      const gx = r.left + r.width / 2;
      const gy = r.top - 0.4 * rem;
      return { gx, gy, box: { l: gx - s / 2, t: gy - 3.4 * rem, r: gx + s / 2, b: gy - 3.4 * rem + s } };
    }
    case 'bottom': {
      const gx = r.left + r.width / 2;
      const gy = r.bottom + 0.4 * rem;
      return { gx, gy, box: { l: gx - s / 2, t: gy - 0.35 * rem, r: gx + s / 2, b: gy - 0.35 * rem + s } };
    }
    default: {
      const gx = r.left - 0.6 * rem;
      const gy = r.top + r.height / 2;
      return { gx, gy, box: { l: gx - 3.6 * rem, t: gy - s / 2, r: gx - 3.6 * rem + s, b: gy + s / 2 } };
    }
  }
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Things the paw must not cover: other controls and lines of text in the top screen. */
function obstacles(root: ParentNode, target: HTMLElement): Box[] {
  const out: Box[] = [];
  const push = (e: Element): void => {
    if (e === target || target.contains(e) || e.contains(target)) return;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  };
  root.querySelectorAll('[data-nav]').forEach(push);
  // Text leaves: elements that directly hold visible text (labels, notes, card copy).
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const p = n.parentElement;
    if (!p || seen.has(p) || p.closest('[hidden],[aria-hidden="true"]')) continue;
    seen.add(p);
    push(p);
  }
  return out;
}

class PawPointer {
  private el: HTMLElement | null = null;
  private raf = 0;
  private x = -100;
  private y = -100;
  private vx = 0;
  private vy = 0;
  private mode: PawMode = 'left';
  private checkedAt = 0;
  private target: HTMLElement | null = null;
  private last = 0;
  private visible = false;

  attach(parent: HTMLElement): void {
    if (this.el) return;
    this.el = h('div', { class: 'uh-paw', 'aria-hidden': 'true' }, h('div', { class: 'uh-paw__bob' }, svgFromMarkup(PAW_SVG, 'uh-paw__svg')));
    parent.appendChild(this.el);
    this.last = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      this.tick(Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.el?.remove();
    this.el = null;
  }

  private tick(dt: number): void {
    const el = this.el;
    if (!el) return;
    const top = navRouter.top() as (Target & object) | null;
    const t = top && typeof top.focusedElement === 'function' ? top.focusedElement() : null;
    const ok = !!t && t.isConnected && !t.closest('[hidden]') && t.closest('[data-paw="none"]') === null && t.getAttribute('data-paw') !== 'none';
    if (!ok) {
      this.setVisible(false);
      this.target = null;
      return;
    }
    const r = t!.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      this.setVisible(false);
      return;
    }
    const pr = el.parentElement!.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const now = performance.now();
    if (t !== this.target || !this.visible || now - this.checkedAt > RECHECK_MS) {
      this.checkedAt = now;
      // Items / rows can prefer the top (grid cards, button rows); a covered top still falls
      // back to a free side.
      const preferTop = t!.getAttribute('data-paw') === 'top' || !!t!.closest('[data-paw-mode="top"]');
      const next = this.pickSide(t!, r, rem, (top as Target).el ?? document.body, preferTop);
      if (t === this.target && next !== this.mode) {
        el.dataset.mode = next;
      }
      this.mode = next;
    }
    const mode = this.mode;
    const p0 = placement(mode, r, rem);
    const gx = p0.gx - pr.left;
    const gy = p0.gy - pr.top;
    const reduced = document.documentElement.classList.contains('uh-reduced-motion');
    if (t !== this.target || !this.visible) {
      if (!this.visible || reduced) {
        this.x = gx;
        this.y = gy;
        this.vx = 0;
        this.vy = 0;
      }
      this.target = t;
      el.dataset.mode = mode;
      if (!reduced) {
        el.classList.remove('is-hop');
        void el.offsetWidth;
        el.classList.add('is-hop');
      }
    }
    if (reduced) {
      this.x = gx;
      this.y = gy;
    } else {
      // Springy follow (slight overshoot).
      const k = 420;
      const c = 24;
      this.vx += (k * (gx - this.x) - c * this.vx) * dt;
      this.vy += (k * (gy - this.y) - c * this.vy) * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }
    this.setVisible(true);
    el.style.transform = `translate3d(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px, 0)`;
  }

  /** First side (left, right, top, bottom) where the paw covers nothing; else the least covered. */
  private pickSide(t: HTMLElement, r: DOMRect, rem: number, root: ParentNode, preferTop = false): PawMode {
    const obs = obstacles(root, t);
    const order: PawMode[] = preferTop ? ['top', 'left', 'right', 'bottom'] : SIDES;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let best: PawMode = order[0]!;
    let bestCost = Infinity;
    for (const side of order) {
      const { box } = placement(side, r, rem);
      if (box.l < 0 || box.t < 0 || box.r > vw || box.b > vh) continue;
      let cost = 0;
      for (const o of obs) cost += overlap(box, o);
      if (cost < 1) return side;
      if (cost < bestCost) {
        bestCost = cost;
        best = side;
      }
    }
    return best;
  }

  private setVisible(on: boolean): void {
    if (on === this.visible || !this.el) return;
    this.visible = on;
    this.el.classList.toggle('is-on', on);
  }
}

export const pawPointer = new PawPointer();
