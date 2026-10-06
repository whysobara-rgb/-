/**
 * HUD minimap (doc §4): statics, zones + vans, live banks (rotation + recovered state),
 * safes by shape, own team always, opponents only when visible, own-team pings.
 *
 * Layered so the per-frame cost stays tiny (the browser composites the layers):
 *  1. static canvas — layout geometry (redrawn on resize / fence breaks only)
 *  2. loot canvas   — transparent: banks + safes from pre-baked sprites, redrawn at most 20 Hz
 *                     and only when loot moved >= 0.5 px
 *  3. actor DOM     — pooled markers for characters and pings, moved with transforms
 *                     (a few style writes per frame; the ping pulse is a CSS animation).
 */
import type { LayoutDef, SafeKind, TeamId } from '../../sim/types';
import { h, svgFromMarkup } from '../core/dom';
import { teamEmblem } from '../core/icons';
import { drawBackground, drawBank, drawLayoutBase, drawSafe, fitTransform, setupCanvas, type MapTransform } from './mapDraw';
import type { MinimapModel } from './types';

/** Redraw cap (20 Hz): at ~3.5 px/m a walking raccoon moves < 1 px per redraw. */
const MIN_FRAME_MS = 50;

interface Marker {
  el: HTMLElement;
  /** Facing wedge (me only). */
  rot: HTMLElement | null;
  kind: 'me' | 'char' | 'ping';
  team: TeamId;
  x: number;
  y: number;
  a: number;
  seen: boolean;
}

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Size in CSS px. */
  w: number;
  h: number;
}

export class Minimap {
  readonly el: HTMLDivElement;
  private readonly lootCanvas: HTMLCanvasElement;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly actorsEl: HTMLDivElement;
  private readonly markers = new Map<string, Marker>();
  private readonly sprites = new Map<string, Sprite>();
  private layout: LayoutDef | null = null;
  private tf: MapTransform | null = null;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private staticKey = '';
  private dirtyStatic = true;
  private lootSig = NaN;
  private lastDraw = -Infinity;
  private readonly ro: ResizeObserver | null;

  constructor() {
    this.staticCanvas = h('canvas', { class: 'uh-minimap__canvas', 'aria-hidden': 'true' });
    this.lootCanvas = h('canvas', { class: 'uh-minimap__canvas', 'aria-hidden': 'true' });
    this.actorsEl = h('div', { class: 'uh-minimap__actors', 'aria-hidden': 'true' });
    this.el = h('div', { class: 'uh-minimap' }, this.staticCanvas, this.lootCanvas, this.actorsEl);
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.measure()) : null;
    this.ro?.observe(this.el);
  }

  setLayout(layout: LayoutDef | null): void {
    this.layout = layout;
    if (layout) this.el.style.setProperty('--aspect', String(layout.size.x / layout.size.y));
    this.invalidate();
    this.measure();
  }

  destroy(): void {
    this.ro?.disconnect();
    this.el.remove();
  }

  /** Redraw if due. `now` = performance.now(). */
  update(m: MinimapModel, myTeam: TeamId, now: number): void {
    if (!this.layout) return;
    const fenceKey = m.brokenFences && m.brokenFences.length ? m.brokenFences.join('|') : '';
    if (fenceKey !== this.staticKey) {
      this.staticKey = fenceKey;
      this.invalidate();
    }
    if (this.dirtyStatic) this.rebuildStatic(m.brokenFences);
    const tf = this.tf;
    if (!tf) return;

    // Loot layer (throttled + change-detected).
    if (now - this.lastDraw >= MIN_FRAME_MS) {
      const lootSig = this.lootSignature(m);
      if (lootSig !== this.lootSig) {
        this.lootSig = lootSig;
        this.lastDraw = now;
        this.rebuildLoot(m, tf);
      }
    }

    // Actor markers (every frame, DOM writes only on visible change).
    for (const mk of this.markers.values()) mk.seen = false;
    for (const c of m.characters) {
      if (c.team !== myTeam && !c.visible) continue;
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      const mk = this.marker(`c:${c.id}`, c.isMe ? 'me' : 'char', c.team);
      this.place(mk, tf.ox + c.x * tf.scale, tf.oy + c.y * tf.scale, c.isMe ? c.facing : 0);
    }
    if (m.pings) {
      for (const p of m.pings) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const mk = this.marker(`p:${p.id}`, 'ping', p.team);
        this.place(mk, tf.ox + p.x * tf.scale, tf.oy + p.y * tf.scale, 0);
      }
    }
    for (const [key, mk] of this.markers) {
      if (mk.seen) continue;
      mk.el.remove();
      this.markers.delete(key);
    }
  }

  // --- actor markers --------------------------------------------------------------------------

  private marker(key: string, kind: Marker['kind'], team: TeamId): Marker {
    let mk = this.markers.get(key);
    if (!mk || mk.kind !== kind || mk.team !== team) {
      mk?.el.remove();
      const el = h('div', { class: `uh-mm uh-mm--${kind}`, 'data-team': team });
      let rot: HTMLElement | null = null;
      if (kind === 'me') {
        rot = h(
          'div',
          { class: 'uh-mm__facing' },
          svgFromMarkup('<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M3 3.5L18 10L3 16.5L6.5 10Z" fill="#FFD66B" stroke="#2E2442" stroke-width="2.2" stroke-linejoin="round"/></svg>'),
        );
        el.append(rot, h('div', { class: 'uh-mm__ring' }, teamEmblem(team)));
      } else if (kind === 'char') {
        el.append(teamEmblem(team, 'uh-emblem', 'color'));
      } else {
        el.append(h('div', { class: 'uh-mm__pulse' }), h('div', { class: 'uh-mm__dot' }));
      }
      // Me on top of everything else.
      if (kind === 'me') this.actorsEl.appendChild(el);
      else this.actorsEl.insertBefore(el, this.actorsEl.firstChild);
      mk = { el, rot, kind, team, x: NaN, y: NaN, a: NaN, seen: true };
      this.markers.set(key, mk);
    }
    mk.seen = true;
    return mk;
  }

  private place(mk: Marker, x: number, y: number, angle: number): void {
    const sx = Math.round(x * 2) / 2;
    const sy = Math.round(y * 2) / 2;
    if (sx !== mk.x || sy !== mk.y) {
      mk.x = sx;
      mk.y = sy;
      mk.el.style.transform = `translate3d(${sx}px,${sy}px,0)`;
    }
    if (mk.rot) {
      const a = Number.isFinite(angle) ? Math.round(angle * 50) / 50 : 0;
      if (a !== mk.a) {
        mk.a = a;
        mk.rot.style.transform = `rotate(${a}rad)`;
      }
    }
  }

  // --- layers ------------------------------------------------------------------------------

  private invalidate(): void {
    this.dirtyStatic = true;
    this.lootSig = NaN;
    this.lastDraw = -Infinity;
    for (const mk of this.markers.values()) {
      mk.x = NaN;
      mk.y = NaN;
    }
  }

  private measure(): void {
    const w = this.el.clientWidth;
    const hgt = this.el.clientHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (w === this.cssW && hgt === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = hgt;
    this.dpr = dpr;
    this.sprites.clear();
    this.invalidate();
  }

  private rebuildStatic(broken: readonly string[] | undefined): void {
    const L = this.layout;
    if (!L || this.cssW < 4 || this.cssH < 4) return;
    const ctx = setupCanvas(this.staticCanvas, this.cssW, this.cssH);
    if (!ctx) return;
    drawBackground(ctx, this.cssW, this.cssH, 'night', Math.min(this.cssW, this.cssH) * 0.08);
    this.tf = fitTransform(L.size, this.cssW, this.cssH, Math.max(4, this.cssW * 0.035));
    drawLayoutBase(ctx, L, this.tf, { theme: 'night', brokenFences: new Set(broken ?? []) });
    this.dirtyStatic = false;
    this.lootSig = NaN;
  }

  private rebuildLoot(m: MinimapModel, tf: MapTransform): void {
    const ctx = setupCanvas(this.lootCanvas, this.cssW, this.cssH);
    if (!ctx) return;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    for (const b of m.banks) {
      const sp = this.bankSprite(b.recovered, b.carriedBy ?? null);
      this.blit(ctx, sp, tf.ox + b.x * tf.scale, tf.oy + b.y * tf.scale, b.angle);
    }
    for (const s of m.safes) {
      if (s.recovered) continue;
      const sp = this.safeSprite(s.kind, !!s.loaded, s.heldBy ?? null);
      this.blit(ctx, sp, tf.ox + s.x * tf.scale, tf.oy + s.y * tf.scale, s.angle);
    }
  }

  // --- sprites -------------------------------------------------------------------------------

  private blit(ctx: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, angle: number): void {
    if (angle) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
      ctx.restore();
    } else {
      ctx.drawImage(sp.canvas, x - sp.w / 2, y - sp.h / 2, sp.w, sp.h);
    }
  }

  private makeSprite(key: string, w: number, hgt: number, draw: (ctx: CanvasRenderingContext2D) => void): Sprite {
    let sp = this.sprites.get(key);
    if (sp) return sp;
    const canvas = document.createElement('canvas');
    const ctx = setupCanvas(canvas, w, hgt);
    if (ctx) draw(ctx);
    sp = { canvas, w, h: hgt };
    this.sprites.set(key, sp);
    return sp;
  }

  private safeSprite(kind: SafeKind, loaded: boolean, heldBy: TeamId | null): Sprite {
    const tf = this.tf!;
    const minSafe = Math.max(5, this.cssW * 0.028) * (loaded ? 0.75 : 1);
    const size = Math.ceil(Math.max(minSafe, 1.4 * tf.scale) + 8);
    return this.makeSprite(`safe:${kind}:${loaded ? 1 : 0}:${heldBy ?? '-'}`, size, size, (ctx) => {
      drawSafe(ctx, { scale: tf.scale, ox: size / 2, oy: size / 2 }, kind, { x: 0, y: 0 }, 0, {
        theme: 'night',
        minPx: minSafe,
        loaded,
        heldBy,
      });
    });
  }

  private bankSprite(recovered: boolean, carriedBy: TeamId | null): Sprite {
    const tf = this.tf!;
    const minPx = this.cssW * 0.11;
    const long = Math.max(minPx, 8 * tf.scale);
    const w = Math.ceil(long + 10);
    const hgt = Math.ceil(long * 0.75 + 10);
    return this.makeSprite(`bank:${recovered ? 1 : 0}:${carriedBy ?? '-'}`, w, hgt, (ctx) => {
      drawBank(ctx, { scale: tf.scale, ox: w / 2, oy: hgt / 2 }, { x: 0, y: 0 }, 0, { theme: 'night', recovered, carriedBy, minPx });
    });
  }



  // --- change detection ------------------------------------------------------------------------

  /** Quantized (~0.5 px) hash of loot poses and states. */
  private lootSignature(m: MinimapModel): number {
    const q = (this.tf?.scale ?? 1) * 2;
    let hsh = 17;
    const mix = (v: number): void => {
      hsh = (Math.imul(hsh, 31) + (Math.round(v * q) | 0)) | 0;
    };
    for (const b of m.banks) {
      mix(b.x);
      mix(b.y);
      mix(b.angle * 20);
      mix(b.recovered ? 1 : 0);
      mix(b.carriedBy ?? -1);
    }
    for (const s of m.safes) {
      mix(s.x);
      mix(s.y);
      mix(s.angle * 8);
      mix(s.recovered ? 1 : 0);
      mix(s.heldBy ?? -1);
      mix(s.loaded ? 1 : 0);
    }
    return hsh;
  }

}
