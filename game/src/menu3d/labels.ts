/**
 * HTML labels pinned to 3D points of a menu scene (price tags over the diorama safes, names
 * under the tournament pedestals...). Crisp text in both languages, zero draw calls.
 *
 * The layer sits between the menu canvas and the UI root. Scenes register labels once and
 * the stage re-projects them after every render (one transform write per moved label).
 *
 * Tags never pile up or hide under the screen's own cards: after projection they are placed
 * by priority (lower first), each one stepping up or down to the nearest free spot, and areas
 * the screen marks as "keep out" (title card, team cards, VS sticker) count as taken. A tag
 * lifted off its anchor grows its stem down to the object, so it still points at its safe.
 */
import * as THREE from 'three';
import { placeLabel } from '../ui/core/declutter';

interface Pinned {
  /** Positioned wrapper (the tag's own pop-in scale must not scale its position). */
  wrap: HTMLElement;
  el: HTMLElement;
  target: THREE.Object3D | THREE.Vector3;
  offsetY: number;
  prio: number;
  /** Written position (px, layer space). */
  x: number;
  y: number;
  /** Projected anchor this frame. */
  ax: number;
  ay: number;
  w: number;
  h: number;
  dirty: boolean;
  shown: boolean;
  stem: number;
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Keep-out areas in viewport px (e.g. getBoundingClientRect of the screen's cards). */
export type AvoidSource = () => readonly Box[];

const v = new THREE.Vector3();
const GAP = 4;
/** How often keep-out areas and the rem size are re-read (layout reads, so not every frame). */
const POLL_MS = 400;

export class LabelLayer {
  readonly el: HTMLDivElement;
  private readonly pins = new Map<string, Pinned>();
  private avoidSrc: AvoidSource | null = null;
  private avoid: Box[] = [];
  private polledAt = -1e9;
  private rem = 16;
  private readonly order: Pinned[] = [];
  private readonly placed: Box[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'uh-m3d-labels';
    this.el.setAttribute('aria-hidden', 'true');
  }

  /**
   * Pin `el` to a world point / object (its world position + offsetY meters). Lower `prio`
   * keeps its spot when tags collide (e.g. bank 0, vans 1, safes 2).
   */
  pin(id: string, el: HTMLElement, target: THREE.Object3D | THREE.Vector3, offsetY = 0, prio = 5): HTMLElement {
    this.unpin(id);
    const wrap = document.createElement('div');
    wrap.className = 'uh-m3d-label';
    wrap.style.visibility = 'hidden';
    wrap.appendChild(el);
    this.el.appendChild(wrap);
    this.pins.set(id, { wrap, el, target, offsetY, prio, x: NaN, y: NaN, ax: 0, ay: 0, w: 0, h: 0, dirty: true, shown: false, stem: 0 });
    return el;
  }

  get(id: string): HTMLElement | null {
    return this.pins.get(id)?.el ?? null;
  }

  unpin(id: string): void {
    const p = this.pins.get(id);
    if (!p) return;
    p.wrap.remove();
    this.pins.delete(id);
  }

  clear(): void {
    for (const p of this.pins.values()) p.wrap.remove();
    this.pins.clear();
    this.avoidSrc = null;
    this.avoid = [];
  }

  /** Areas tags must stay out of (polled a few times a second); null clears. */
  setAvoid(src: AvoidSource | null): void {
    this.avoidSrc = src;
    this.polledAt = -1e9;
    if (!src) this.avoid = [];
  }

  /** Re-project every label (CSS px inside the layer box). */
  update(camera: THREE.Camera, width: number, height: number): void {
    const now = performance.now();
    if (now - this.polledAt > POLL_MS) this.poll(now);
    const order = this.order;
    order.length = 0;
    for (const p of this.pins.values()) {
      if ((p.target as THREE.Object3D).isObject3D) {
        const o = p.target as THREE.Object3D;
        o.getWorldPosition(v);
        if (!visibleChain(o)) {
          this.setShown(p, false);
          continue;
        }
      } else v.copy(p.target as THREE.Vector3);
      v.y += p.offsetY;
      v.project(camera);
      const on = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3;
      this.setShown(p, on);
      if (!on) continue;
      p.ax = ((v.x + 1) / 2) * width;
      p.ay = ((1 - v.y) / 2) * height;
      if (p.dirty) {
        p.w = p.el.offsetWidth;
        p.h = p.el.offsetHeight;
        // Not laid out yet (layer just shown): measure again next frame.
        p.dirty = p.w <= 0;
      }
      order.push(p);
    }
    order.sort((a, b) => a.prio - b.prio || a.ay - b.ay);
    const placed = this.placed;
    placed.length = 0;
    for (const a of this.avoid) placed.push(a);
    // Tag box relative to its anchor: centred, bottom 0.6rem above (the stem).
    const lift = 0.6 * this.rem;
    for (const p of order) {
      const bottom = p.w > 0 ? placeLabel(placed, p.ax, p.ay - lift, p.w, p.h, GAP) : p.ay - lift;
      const x = Math.round(p.ax * 2) / 2;
      const y = Math.round((bottom + lift) * 2) / 2;
      if (x !== p.x || y !== p.y) {
        p.x = x;
        p.y = y;
        p.wrap.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      // Lifted above its anchor: stretch the stem down to the object. Pushed below: no stem.
      const off = Math.round(p.ay - lift - bottom);
      const stem = off > 1 ? off : off < -1 ? -1 : 0;
      if (stem !== p.stem) {
        p.stem = stem;
        if (stem > 0) p.el.style.setProperty('--stem', `${stem}px`);
        else p.el.style.removeProperty('--stem');
        p.el.classList.toggle('is-below', stem < 0);
      }
    }
  }

  private poll(now: number): void {
    this.polledAt = now;
    this.rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // Sizes can change with UI scale / language.
    for (const p of this.pins.values()) p.dirty = true;
    if (!this.avoidSrc) return;
    const box = this.el.getBoundingClientRect();
    try {
      this.avoid = this.avoidSrc().map((a) => ({ l: a.l - box.left, t: a.t - box.top, r: a.r - box.left, b: a.b - box.top }));
    } catch {
      this.avoid = [];
    }
  }

  private setShown(p: Pinned, on: boolean): void {
    if (p.shown === on) return;
    p.shown = on;
    p.wrap.style.visibility = on ? 'visible' : 'hidden';
  }
}

function visibleChain(o: THREE.Object3D): boolean {
  let q: THREE.Object3D | null = o;
  while (q) {
    if (!q.visible) return false;
    q = q.parent;
  }
  return true;
}
