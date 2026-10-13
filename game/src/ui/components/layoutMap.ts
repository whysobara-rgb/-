/**
 * Canvas map of a LayoutDef in the "paper" theme: statics, zones + vans with emblems, banks
 * with door direction and their interior safes, outdoor safes by shape, bank-breakable
 * fences. Used by the layout preview (doc §9: identical info for both sides) and the quick
 * match thumbnail. Redraws itself on resize.
 */
import type { LayoutDef } from '../../sim/types';
import { h } from '../core/dom';
import {
  bankInteriorWorld,
  drawBackground,
  drawBank,
  drawLayoutBase,
  drawSafe,
  fitTransform,
  setupCanvas,
} from '../hud/mapDraw';

export class LayoutMap {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ro: ResizeObserver | null;
  private layout: LayoutDef | null;

  constructor(layout: LayoutDef | null, private readonly opts: { compact?: boolean } = {}) {
    this.layout = layout;
    this.canvas = h('canvas', { class: 'uh-layoutmap__canvas', 'aria-hidden': 'true' });
    this.el = h('div', { class: ['uh-layoutmap', opts.compact ? 'uh-layoutmap--compact' : ''] }, this.canvas);
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.draw()) : null;
    this.ro?.observe(this.el);
  }

  setLayout(layout: LayoutDef | null): void {
    this.layout = layout;
    this.draw();
  }

  draw(): void {
    const w = this.el.clientWidth;
    const hgt = this.el.clientHeight;
    if (w < 4 || hgt < 4) return;
    const ctx = setupCanvas(this.canvas, w, hgt);
    if (!ctx) return;
    const radius = Math.min(w, hgt) * 0.04;
    drawBackground(ctx, w, hgt, 'paper', radius);
    const L = this.layout;
    if (!L) return;
    const pad = Math.min(w, hgt) * (this.opts.compact ? 0.05 : 0.045);
    const tf = fitTransform(L.size, w, hgt, pad);
    drawLayoutBase(ctx, L, tf, { theme: 'paper', spawns: !this.opts.compact });
    // Safes are tiny at map scale: enforce a readable minimum (shape still tells the kind).
    const minSafe = this.opts.compact ? 7 : Math.max(15, Math.min(w, hgt) * 0.022);
    for (const b of L.banks) {
      drawBank(ctx, tf, b.pos, b.angle, { theme: 'paper', doorArrows: true, minPx: this.opts.compact ? 26 : 0 });
      if (!this.opts.compact) {
        for (const s of bankInteriorWorld(b.pos, b.angle)) drawSafe(ctx, tf, s.kind, s.pos, s.angle, { theme: 'paper', minPx: 0, loaded: true });
      }
    }
    for (const s of L.safes) drawSafe(ctx, tf, s.kind, s.pos, s.angle, { theme: 'paper', minPx: minSafe });
  }

  destroy(): void {
    this.ro?.disconnect();
    this.el.remove();
  }
}
