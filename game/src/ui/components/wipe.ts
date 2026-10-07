/**
 * Iris wipe between screens: a patterned curtain whose hole is shaped like a team emblem (star /
 * moon) or a raccoon head. `run(swap)` closes the iris, swaps the screen while fully covered,
 * then opens it again (~0.7 s total). Reduced motion: a quick fade instead.
 *
 * Shapes are authored here (trusted static SVG) and used as a CSS mask: the curtain is the whole
 * screen minus the shape (mask-composite: exclude), and the shape's size is animated.
 */
import { h } from '../core/dom';
import { isReducedMotion } from '../core/dom';
import { MOON_PATH, STAR_POINTS } from '../core/icons';
import { getUiRoot } from '../core/root';
import { uiSound } from '../core/nav';

export type WipeShape = 'star' | 'moon' | 'raccoon' | 'circle';

const RACCOON_PATH =
  'M50 22c11 0 21 4 27 11 3-9 6-17 12-20 3 9 3 21-1 31 5 6 8 13 8 21 0 17-20 31-46 31S4 82 4 65c0-8 3-15 8-21-4-10-4-22-1-31 6 3 9 11 12 20 6-7 16-11 27-11z';

function shapeUrl(shape: WipeShape): string {
  let inner: string;
  let vb = '0 0 24 24';
  switch (shape) {
    case 'star':
      inner = `<polygon points="${STAR_POINTS}" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/>`;
      break;
    case 'moon':
      inner = `<path d="${MOON_PATH}" transform="translate(-2 0)"/>`;
      break;
    case 'raccoon':
      vb = '0 0 100 100';
      inner = `<path d="${RACCOON_PATH}"/>`;
      break;
    default:
      inner = '<circle cx="12" cy="12" r="11"/>';
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="#000">${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const FULL = 'linear-gradient(#000, #000)';

export class IrisWipe {
  readonly el: HTMLElement;
  private running: Promise<void> | null = null;
  private pending: (() => void)[] = [];

  constructor(parent?: HTMLElement) {
    this.el = h('div', { class: 'uh-wipe', 'aria-hidden': 'true' }, h('div', { class: 'uh-wipe__badge' }));
    this.el.hidden = true;
    (parent ?? getUiRoot().layer('wipe')).appendChild(this.el);
  }

  get busy(): boolean {
    return this.running !== null;
  }

  /**
   * Close the iris (`shape`), run `swap` while covered, open again. Calls made while a wipe runs
   * are folded into it (their swaps run in order while covered).
   */
  run(swap: () => void, shape: WipeShape = 'raccoon'): void {
    this.pending.push(swap);
    if (this.running) return;
    // Failsafe: a stalled animation (hidden window) never holds a screen change back for long.
    const guard = window.setTimeout(() => this.flush(), 2500);
    this.running = this.play(shape).finally(() => {
      window.clearTimeout(guard);
      this.flush();
      this.running = null;
    });
  }

  private flush(): void {
    const list = this.pending;
    this.pending = [];
    for (const fn of list) {
      try {
        fn();
      } catch (err) {
        console.error('[ui] wipe swap failed', err);
      }
    }
  }

  private async play(shape: WipeShape): Promise<void> {
    const el = this.el;
    const reduced = isReducedMotion() || typeof el.animate !== 'function';
    el.hidden = false;
    el.dataset.shape = shape;
    if (reduced) {
      el.style.removeProperty('mask-image');
      el.style.removeProperty('-webkit-mask-image');
      await el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 90, fill: 'forwards' }).finished.catch(() => undefined);
      this.flush();
      await nextFrames(2);
      await el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).finished.catch(() => undefined);
      el.hidden = true;
      return;
    }
    const url = shapeUrl(shape);
    const img = `${FULL}, ${url}`;
    el.style.setProperty('mask-image', img);
    el.style.setProperty('-webkit-mask-image', img);
    el.style.opacity = '1';
    uiSound('whoosh');
    const sizes = (s: string): Keyframe => ({ maskSize: `100% 100%, ${s} ${s}`, webkitMaskSize: `100% 100%, ${s} ${s}` } as unknown as Keyframe);
    await el.animate([sizes('320vmax'), sizes('60vmin'), sizes('0vmax')], { duration: 380, easing: 'cubic-bezier(0.55, 0, 0.75, 0.3)', fill: 'forwards' }).finished.catch(() => undefined);
    el.classList.add('is-closed');
    this.flush();
    await nextFrames(2);
    await sleep(110);
    el.classList.remove('is-closed');
    uiSound('pop');
    await el
      .animate([sizes('0vmax'), sizes('70vmin'), sizes('340vmax')], { duration: 460, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' })
      .finished.catch(() => undefined);
    el.hidden = true;
    el.getAnimations().forEach((a) => a.cancel());
  }

  destroy(): void {
    this.el.remove();
  }
}

function nextFrames(n: number): Promise<void> {
  return new Promise((r) => {
    const step = (k: number): void => {
      if (k <= 0) r();
      else requestAnimationFrame(() => step(k - 1));
    };
    step(n);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

let shared: IrisWipe | null = null;
/** The app-wide wipe (created on first use in the UiRoot 'wipe' layer). */
export function irisWipe(): IrisWipe {
  if (!shared || !shared.el.isConnected) shared = new IrisWipe();
  return shared;
}
