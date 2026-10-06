/**
 * The paw pointer: one bouncing paw that hops (spring + overshoot) to whatever the top screen
 * has focused — the game's focus indicator instead of a browser-ish ring. Items can ask for the
 * paw on top (`data-paw="top"`, grid cards) or none (`data-paw="none"`).
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
}

class PawPointer {
  private el: HTMLElement | null = null;
  private raf = 0;
  private x = -100;
  private y = -100;
  private vx = 0;
  private vy = 0;
  private mode: 'left' | 'top' = 'left';
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
    const mode = t!.getAttribute('data-paw') === 'top' || t!.closest('[data-paw-mode="top"]') ? 'top' : 'left';
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gx = mode === 'top' ? r.left + r.width / 2 - pr.left : r.left - pr.left - 0.6 * rem;
    const gy = mode === 'top' ? r.top - pr.top - 0.4 * rem : r.top + r.height / 2 - pr.top;
    const reduced = document.documentElement.classList.contains('uh-reduced-motion');
    if (t !== this.target || !this.visible) {
      if (!this.visible || reduced) {
        this.x = gx;
        this.y = gy;
        this.vx = 0;
        this.vy = 0;
      }
      this.target = t;
      this.mode = mode;
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

  private setVisible(on: boolean): void {
    if (on === this.visible || !this.el) return;
    this.visible = on;
    this.el.classList.toggle('is-on', on);
  }
}

export const pawPointer = new PawPointer();
