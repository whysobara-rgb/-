/**
 * HTML labels pinned to 3D points of a menu scene (price tags over the diorama safes, names
 * under the tournament pedestals...). Crisp text in both languages, zero draw calls.
 *
 * The layer sits between the menu canvas and the UI root. Scenes register labels once and
 * the stage re-projects them after every render (one transform write per moved label).
 */
import * as THREE from 'three';

interface Pinned {
  el: HTMLElement;
  target: THREE.Object3D | THREE.Vector3;
  offsetY: number;
  x: number;
  y: number;
  shown: boolean;
}

const v = new THREE.Vector3();

export class LabelLayer {
  readonly el: HTMLDivElement;
  private readonly pins = new Map<string, Pinned>();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'uh-m3d-labels';
    this.el.setAttribute('aria-hidden', 'true');
  }

  /** Pin `el` to a world point / object (its world position + offsetY meters). */
  pin(id: string, el: HTMLElement, target: THREE.Object3D | THREE.Vector3, offsetY = 0): HTMLElement {
    this.unpin(id);
    el.classList.add('uh-m3d-label');
    el.style.visibility = 'hidden';
    this.el.appendChild(el);
    this.pins.set(id, { el, target, offsetY, x: NaN, y: NaN, shown: false });
    return el;
  }

  get(id: string): HTMLElement | null {
    return this.pins.get(id)?.el ?? null;
  }

  unpin(id: string): void {
    const p = this.pins.get(id);
    if (!p) return;
    p.el.remove();
    this.pins.delete(id);
  }

  clear(): void {
    for (const p of this.pins.values()) p.el.remove();
    this.pins.clear();
  }

  /** Re-project every label (CSS px inside the layer box). */
  update(camera: THREE.Camera, width: number, height: number): void {
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
      const x = Math.round(((v.x + 1) / 2) * width * 2) / 2;
      const y = Math.round(((1 - v.y) / 2) * height * 2) / 2;
      if (x !== p.x || y !== p.y) {
        p.x = x;
        p.y = y;
        p.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
    }
  }

  private setShown(p: Pinned, on: boolean): void {
    if (p.shown === on) return;
    p.shown = on;
    p.el.style.visibility = on ? 'visible' : 'hidden';
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
