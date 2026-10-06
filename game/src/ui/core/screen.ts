/**
 * Base class for every menu screen and dialog.
 *
 * Lifecycle:  new XScreen(props) -> mount(parent?) -> show() / hide() ... -> destroy()
 * - mount() is optional: show() mounts into the default UiRoot layer when needed.
 * - update(patch) merges props and re-renders, keeping focus and scroll positions.
 * - Language changes re-render automatically.
 * - While visible, the screen is on the nav stack and receives MenuNav actions.
 */
import { onLanguageChange } from '../i18n';
import { FocusScope, navRouter, uiSound, type NavTarget } from './nav';
import type { NavAction } from './prompts';
import { getUiRoot, type UiLayerName } from './root';
import { clear } from './dom';

/** Dispatched on window when global sizing changes (UI scale); visible screens re-fit. */
export const RELAYOUT_EVENT = 'uh-relayout';

/** True when the frame or one of its direct (non-scrolling) children overflows. */
function frameOverflows(frame: HTMLElement): boolean {
  if (frame.scrollHeight > frame.clientHeight + 1 || frame.scrollWidth > frame.clientWidth + 1) return true;
  for (const c of Array.from(frame.children) as HTMLElement[]) {
    if (c.classList.contains('uh-scroll')) continue;
    if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) return true;
  }
  return false;
}

export interface ScreenOptions {
  /** Modifier for the root class: 'uh-screen--<name>'. */
  name: string;
  /** Default layer when show() mounts implicitly. */
  layer?: UiLayerName;
  /** Vertical focus wrap at list ends (default true). */
  wrapNav?: boolean;
  /** Accessible label (role=dialog for dialogs, region otherwise). */
  role?: 'dialog' | 'region';
}

export abstract class UiScreen<P extends object> implements NavTarget {
  readonly el: HTMLElement;
  protected props: P;
  protected readonly focus: FocusScope;
  private readonly layerName: UiLayerName;
  private visible = false;
  private rendered = false;
  private destroyed = false;
  private enterTimer = 0;
  private unsubLang: (() => void) | null = null;
  /** Cleanups for resources created by render() (observers, timers); run before each re-render. */
  private renderDisposers: (() => void)[] = [];
  private fitRaf = 0;
  private readonly onRelayout = (): void => {
    if (this.visible) this.scheduleFit();
  };

  protected constructor(props: P, opts: ScreenOptions) {
    this.props = props;
    this.layerName = opts.layer ?? 'screens';
    this.el = document.createElement('section');
    this.el.className = `uh-screen uh-screen--${opts.name}`;
    this.el.hidden = true;
    this.el.setAttribute('role', opts.role ?? 'region');
    this.focus = new FocusScope(this.el, {
      wrap: opts.wrapNav !== false,
      onFocusChange: (el) => this.onFocusChanged(el),
    });
    this.unsubLang = onLanguageChange(() => {
      if (this.rendered) this.rerender();
    });
    window.addEventListener('resize', this.onRelayout);
    window.addEventListener(RELAYOUT_EVENT, this.onRelayout);
  }

  /** Attach to a parent element (defaults to the UiRoot layer for this screen type). */
  mount(parent?: HTMLElement): this {
    if (this.destroyed) throw new Error('UiScreen: mount after destroy');
    (parent ?? getUiRoot().layer(this.layerName)).appendChild(this.el);
    return this;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): this {
    if (this.destroyed) return this;
    if (!this.el.isConnected) this.mount();
    if (!this.rendered) this.rerender();
    if (this.visible) return this;
    this.visible = true;
    this.el.hidden = false;
    this.el.classList.add('is-entering');
    window.clearTimeout(this.enterTimer);
    this.enterTimer = window.setTimeout(() => this.el.classList.remove('is-entering'), 900);
    navRouter.push(this);
    this.fitToViewport();
    this.focus.ensure(this.focus.focusedId ?? this.defaultFocus());
    this.onShow();
    this.scheduleFit();
    return this;
  }

  hide(): this {
    if (!this.visible) return this;
    this.visible = false;
    this.el.hidden = true;
    this.el.classList.remove('is-entering');
    navRouter.remove(this);
    this.onHide();
    return this;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.hide();
    this.destroyed = true;
    window.clearTimeout(this.enterTimer);
    this.unsubLang?.();
    this.unsubLang = null;
    cancelAnimationFrame(this.fitRaf);
    window.removeEventListener('resize', this.onRelayout);
    window.removeEventListener(RELAYOUT_EVENT, this.onRelayout);
    this.disposeRender();
    this.onDestroy();
    this.el.remove();
  }

  /** Merge props and re-render (focus and scroll are preserved). */
  update(patch: Partial<P>): this {
    this.props = { ...this.props, ...patch };
    if (this.rendered) this.rerender();
    return this;
  }

  getProps(): Readonly<P> {
    return this.props;
  }

  /** Move focus to a nav id (e.g. game flow wants "rematch" focused). */
  focusItem(id: string): boolean {
    return this.focus.focus(id, { sound: false });
  }

  // --- navigation -----------------------------------------------------------------------

  handleNav(action: NavAction): boolean {
    switch (action) {
      case 'navUp':
        return this.focus.move('up');
      case 'navDown':
        return this.focus.move('down');
      case 'navLeft':
        return this.focus.adjust(-1) || this.focus.move('left');
      case 'navRight':
        return this.focus.adjust(1) || this.focus.move('right');
      case 'confirm':
        return this.focus.activate();
      case 'back': {
        const ok = this.onBack();
        if (ok) uiSound('back');
        return ok;
      }
      case 'tabPrev':
        return this.onTab(-1);
      case 'tabNext':
        return this.onTab(1);
      default:
        return false;
    }
  }

  // --- hooks for subclasses ---------------------------------------------------------------

  /** Build the screen DOM into `this.el` (it is cleared before each call). */
  protected abstract render(): void;
  /** Nav id focused when the screen is first shown. */
  protected defaultFocus(): string | null {
    return null;
  }
  /** Back/cancel. Return true when handled. */
  protected onBack(): boolean {
    return false;
  }
  /** Tab switching (LB/RB, Q/E). Return true when handled. */
  protected onTab(_dir: -1 | 1): boolean {
    return false;
  }
  /** Focus moved (keyboard/pad or mouse hover). */
  protected onFocusChanged(_el: HTMLElement | null): void {}
  protected onShow(): void {}
  protected onHide(): void {}
  protected onDestroy(): void {}

  /** Register a cleanup for something render() created; it runs before the next render/destroy. */
  protected own(dispose: () => void): void {
    this.renderDisposers.push(dispose);
  }

  private disposeRender(): void {
    const list = this.renderDisposers;
    this.renderDisposers = [];
    for (const d of list) {
      try {
        d();
      } catch (err) {
        console.error('[ui] dispose failed', err);
      }
    }
  }

  /** Re-render now, preserving focus id and scroll offsets. */
  protected rerender(): void {
    const focusId = this.focus.focusedId;
    const scrolls = Array.from(this.el.querySelectorAll<HTMLElement>('.uh-scroll')).map((e) => e.scrollTop);
    this.disposeRender();
    clear(this.el);
    this.render();
    this.rendered = true;
    this.el.querySelectorAll<HTMLElement>('.uh-scroll').forEach((e, i) => {
      if (scrolls[i] !== undefined) e.scrollTop = scrolls[i];
    });
    if (this.visible) this.fitToViewport();
    if (this.visible || focusId) this.focus.ensure(focusId ?? this.defaultFocus());
  }

  // --- fit to viewport ---------------------------------------------------------------------

  /** Re-fit on the next frame (after fonts/layout settle). */
  protected scheduleFit(): void {
    cancelAnimationFrame(this.fitRaf);
    this.fitRaf = requestAnimationFrame(() => {
      if (this.visible) this.fitToViewport();
    });
  }

  /**
   * Shrink-to-fit safety net: when the screen's `.uh-frame` content does not fit the viewport
   * (large UI scale on small screens, e.g. 140% on a Steam Deck), apply CSS zoom to the frame
   * so nothing is clipped. Runs only on show / re-render / resize / UI-scale change.
   */
  protected fitToViewport(): void {
    const frame = this.el.querySelector<HTMLElement>(':scope > .uh-frame');
    if (!frame) return;
    const apply = (k: number): void => {
      if (k >= 0.999) {
        frame.style.removeProperty('zoom');
        frame.style.removeProperty('--uh-fit');
      } else {
        frame.style.setProperty('zoom', k.toFixed(3));
        frame.style.setProperty('--uh-fit', k.toFixed(3));
      }
    };
    apply(1);
    if (!frameOverflows(frame)) return;
    let lo = 0.5;
    let hi = 1;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      apply(mid);
      if (frameOverflows(frame)) hi = mid;
      else lo = mid;
    }
    apply(lo);
  }
}
