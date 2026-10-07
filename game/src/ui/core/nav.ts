/**
 * Input-agnostic menu navigation.
 *
 * The platform input module produces one `MenuNav` per frame (edge-triggered booleans) and
 * passes it to `handleMenuNav(nav)` (or `UiRoot.handleNav`). The top-most visible screen or
 * dialog receives it. Mouse/touch work independently: hovering focuses, clicking activates —
 * both paths run the same handlers.
 *
 * Focus is virtual (an `is-focused` class + aria-selected), never DOM focus, so a physical
 * Enter/Space can't double-activate a button through the browser's default behaviour.
 */
import type { NavAction } from './prompts';

export type { NavAction } from './prompts';

/** One frame of menu input. All fields are "pressed this frame" (edge) signals. */
export interface MenuNav {
  navUp: boolean;
  navDown: boolean;
  navLeft: boolean;
  navRight: boolean;
  confirm: boolean;
  back: boolean;
  tabPrev: boolean;
  tabNext: boolean;
  /** Any key/button pressed this frame (title screen "아무 키나 누르세요"). Optional. */
  any?: boolean;
}

export const NAV_ACTIONS: readonly NavAction[] = [
  'navUp', 'navDown', 'navLeft', 'navRight', 'confirm', 'back', 'tabPrev', 'tabNext',
] as const;

export const EMPTY_MENU_NAV: Readonly<MenuNav> = Object.freeze({
  navUp: false, navDown: false, navLeft: false, navRight: false,
  confirm: false, back: false, tabPrev: false, tabNext: false, any: false,
});

/** Something that can receive navigation (screens, dialogs). */
export interface NavTarget {
  /** Return true when the action was consumed. */
  handleNav(action: NavAction): boolean;
  /** Called for `MenuNav.any` frames that carried no specific action. */
  handleAnyInput?(): boolean;
  /** The element the paw pointer should point at (screens: the focused item). */
  focusedElement?(): HTMLElement | null;
  /**
   * This target became the top of the stack again because something above it (a dialog, a
   * sub-screen) was removed. Screens use it to re-arm their one-shot actions.
   */
  onNavResume?(): void;
}

// ---------------------------------------------------------------------------------------------
// UI feedback sounds (wired to the audio module by game flow).
// ---------------------------------------------------------------------------------------------

export type UiSoundKind = 'move' | 'confirm' | 'back' | 'error' | 'tab' | 'adjust' | 'pop' | 'whoosh' | 'stamp' | 'coin' | 'tick' | 'sparkle';

export interface UiSoundOptions {
  /** Playback rate multiplier (musical steps: 2^(semitones/12)). */
  pitch?: number;
  volume?: number;
}

let soundHandler: ((kind: UiSoundKind, o?: UiSoundOptions) => void) | null = null;

/** Install a handler that plays menu sounds (e.g. audio.play('uiMove', { pitch })). */
export function setUiSoundHandler(fn: ((kind: UiSoundKind, o?: UiSoundOptions) => void) | null): void {
  soundHandler = fn;
}

export function uiSound(kind: UiSoundKind, o?: UiSoundOptions): void {
  if (!soundHandler) return;
  try {
    soundHandler(kind, o);
  } catch (err) {
    console.error('[ui] sound handler failed', err);
  }
}

/** Major-pentatonic steps: moving down a list climbs a little tune instead of one blip. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
export function noteFor(index: number): number {
  const i = ((index % PENTA.length) + PENTA.length) % PENTA.length;
  return Math.pow(2, PENTA[i]! / 12);
}

// ---------------------------------------------------------------------------------------------
// Router: a stack of targets, top receives input.
// ---------------------------------------------------------------------------------------------

export class NavRouter {
  private readonly stack: NavTarget[] = [];

  push(target: NavTarget): void {
    const i = this.stack.indexOf(target);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(target);
  }

  remove(target: NavTarget): void {
    const i = this.stack.indexOf(target);
    if (i < 0) return;
    const wasTop = i === this.stack.length - 1;
    this.stack.splice(i, 1);
    const next = this.top();
    if (wasTop && next) {
      try {
        next.onNavResume?.();
      } catch (err) {
        console.error('[ui] onNavResume failed', err);
      }
    }
  }

  top(): NavTarget | null {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  }

  /**
   * Dispatch a frame of input (or a single action). Directional actions are processed first;
   * dispatch stops after confirm/back or whenever the receiving target changes, so one press
   * never leaks into a dialog that the same press opened.
   */
  dispatch(nav: MenuNav | NavAction): boolean {
    if (typeof nav === 'string') {
      const t = this.top();
      return t ? t.handleNav(nav) : false;
    }
    let handled = false;
    const start = this.top();
    if (!start) return false;
    for (const a of NAV_ACTIONS) {
      if (!nav[a]) continue;
      const t = this.top();
      if (t !== start) break;
      handled = t.handleNav(a) || handled;
      if (a === 'confirm' || a === 'back') break;
    }
    if (!handled && nav.any && this.top() === start && start.handleAnyInput) handled = start.handleAnyInput();
    return handled;
  }
}

/** The app-wide router used by every UiScreen. */
export const navRouter = new NavRouter();

/** Feed one frame of menu input (or one action) to the top-most screen. */
export function handleMenuNav(nav: MenuNav | NavAction): boolean {
  return navRouter.dispatch(nav);
}

// ---------------------------------------------------------------------------------------------
// Navigable elements + spatial focus.
// ---------------------------------------------------------------------------------------------

export interface NavItemHandlers {
  /** Confirm / click. Omit for elements that use their own click listener. */
  onActivate?: () => void;
  /** Left/right adjust (sliders, option cyclers). When present, left/right never moves focus. */
  onAdjust?: (dir: -1 | 1) => void;
  /** Called when this element becomes focused (tabs switch on focus). */
  onFocus?: () => void;
}

const handlers = new WeakMap<Element, NavItemHandlers>();

/**
 * Mark an element as navigable. `id` must be unique within its screen; it is how focus is
 * restored after a re-render (language switch, props update).
 */
export function navigable<T extends HTMLElement>(el: T, id: string, h: NavItemHandlers = {}): T {
  el.dataset.nav = id;
  el.setAttribute('aria-selected', 'false');
  handlers.set(el, h);
  if (h.onActivate) {
    const act = h.onActivate;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (el.getAttribute('aria-disabled') === 'true') {
        uiSound('error');
        return;
      }
      uiSound('confirm');
      act();
    });
  }
  // Keep mouse clicks from moving DOM focus (prevents browser key activation).
  el.addEventListener('mousedown', (e) => e.preventDefault());
  return el;
}

export function getNavHandlers(el: Element): NavItemHandlers | undefined {
  return handlers.get(el);
}

type Dir = 'up' | 'down' | 'left' | 'right';

interface Cand {
  el: HTMLElement;
  r: DOMRect;
}

function isShown(el: HTMLElement): boolean {
  if (el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function rangeGap(a0: number, a1: number, b0: number, b1: number): number {
  if (a1 < b0) return b0 - a1;
  if (b1 < a0) return a0 - b1;
  return 0;
}

function pickSpatial(from: DOMRect, cands: Cand[], dir: Dir): HTMLElement | null {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    const cx = c.r.left + c.r.width / 2;
    const cy = c.r.top + c.r.height / 2;
    let primary: number;
    let gap: number;
    let offset: number;
    if (dir === 'down' || dir === 'up') {
      primary = dir === 'down' ? cy - fy : fy - cy;
      // Must actually lie beyond the current element's edge (tolerate small overlaps).
      const edgeOk = dir === 'down' ? c.r.top >= from.top + from.height * 0.5 - 1 : c.r.bottom <= from.bottom - from.height * 0.5 + 1;
      if (primary <= 1 || !edgeOk) continue;
      gap = rangeGap(c.r.left, c.r.right, from.left, from.right);
      offset = Math.abs(cx - fx);
    } else {
      primary = dir === 'right' ? cx - fx : fx - cx;
      const edgeOk = dir === 'right' ? c.r.left >= from.left + from.width * 0.5 - 1 : c.r.right <= from.right - from.width * 0.5 + 1;
      if (primary <= 1 || !edgeOk) continue;
      gap = rangeGap(c.r.top, c.r.bottom, from.top, from.bottom);
      offset = Math.abs(cy - fy);
    }
    const score = primary + gap * 3 + offset * 0.25;
    if (score < bestScore) {
      bestScore = score;
      best = c.el;
    }
  }
  return best;
}

function pickWrap(from: DOMRect, cands: Cand[], dir: Dir): HTMLElement | null {
  // Only vertical wrap: jump to the extreme item of the same column.
  if (dir !== 'down' && dir !== 'up') return null;
  const aligned = cands.filter((c) => rangeGap(c.r.left, c.r.right, from.left, from.right) === 0);
  const pool = aligned.length ? aligned : cands;
  let best: Cand | null = null;
  for (const c of pool) {
    if (!best) best = c;
    else if (dir === 'down' ? c.r.top < best.r.top : c.r.bottom > best.r.bottom) best = c;
  }
  return best ? best.el : null;
}

/** Nearest scrollable ancestor marked `.uh-scroll` (inside root). */
function scrollParent(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p && p !== root.parentElement) {
    if (p.classList.contains('uh-scroll')) return p;
    p = p.parentElement;
  }
  return null;
}

export interface FocusScopeOptions {
  /** Wrap vertically at list ends. Default true. */
  wrap?: boolean;
  onFocusChange?: (el: HTMLElement | null) => void;
}

/** Spatial focus manager for one screen root. */
export class FocusScope {
  private current: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement, private readonly opts: FocusScopeOptions = {}) {
    // Hover focuses (mouse users get the same ring + description panels as pad users).
    root.addEventListener('pointerover', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-nav]');
      if (t && root.contains(t) && t !== this.current) this.focus(t, { sound: false, scroll: false, pointer: true });
    });
  }

  get focused(): HTMLElement | null {
    return this.current && this.current.isConnected ? this.current : null;
  }

  get focusedId(): string | null {
    return this.focused?.dataset.nav ?? null;
  }

  items(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>('[data-nav]')).filter(isShown);
  }

  byId(id: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`[data-nav="${CSS.escape(id)}"]`);
  }

  /**
   * Focus an element or nav id. `pointer: true` (hover) skips the element's onFocus handler so
   * hovering over tabs does not switch them; only explicit navigation does.
   */
  focus(target: HTMLElement | string | null, o: { sound?: boolean; scroll?: boolean; pointer?: boolean } = {}): boolean {
    const el = typeof target === 'string' ? this.byId(target) : target;
    if (!el) return false;
    if (this.current && this.current !== el) {
      this.current.classList.remove('is-focused');
      this.current.setAttribute('aria-selected', 'false');
    }
    const changed = this.current !== el;
    this.current = el;
    el.classList.add('is-focused');
    el.setAttribute('aria-selected', 'true');
    if (o.scroll !== false) this.scrollTo(el);
    if (changed) {
      if (o.sound !== false) uiSound('move', { pitch: noteFor(this.items().indexOf(el)) });
      if (!o.pointer) handlers.get(el)?.onFocus?.();
      this.opts.onFocusChange?.(el);
    }
    return true;
  }

  focusFirst(): boolean {
    const items = this.items();
    return items.length ? this.focus(items[0], { sound: false }) : false;
  }

  /** Ensure something sensible is focused (after re-render or when the focused item vanished). */
  ensure(preferredId?: string | null): void {
    if (preferredId && this.focus(preferredId, { sound: false })) return;
    if (this.focused && isShown(this.focused)) return;
    this.focusFirst();
  }

  move(dir: Dir): boolean {
    const items = this.items();
    if (!items.length) return false;
    const cur = this.focused && isShown(this.focused) ? this.focused : null;
    if (!cur) return this.focus(items[0]);
    const from = cur.getBoundingClientRect();
    const cands: Cand[] = [];
    for (const el of items) if (el !== cur) cands.push({ el, r: el.getBoundingClientRect() });
    let next = pickSpatial(from, cands, dir);
    if (!next && this.opts.wrap !== false) next = pickWrap(from, cands, dir);
    if (!next) return false;
    // Entering a group (e.g. a tab row) from outside lands on its current item, not on the
    // spatially nearest one (which, for tabs, would switch the tab).
    const group = next.closest<HTMLElement>('[data-nav-group]');
    if (group && !group.contains(cur)) {
      const current = group.querySelector<HTMLElement>('[data-nav][aria-current="true"]');
      if (current && isShown(current)) next = current;
    }
    return this.focus(next);
  }

  /** Left/right on an adjustable element. Returns false if the element is not adjustable. */
  adjust(dir: -1 | 1): boolean {
    const el = this.focused;
    const h = el ? handlers.get(el) : undefined;
    if (!el || !h?.onAdjust) return false;
    if (el.getAttribute('aria-disabled') === 'true') {
      uiSound('error');
      return true;
    }
    h.onAdjust(dir);
    uiSound('adjust');
    return true;
  }

  activate(): boolean {
    const el = this.focused;
    if (!el) return false;
    if (el.getAttribute('aria-disabled') === 'true') {
      uiSound('error');
      return true;
    }
    uiSound('confirm');
    pressFeedback(el);
    const h = handlers.get(el);
    if (h?.onActivate) h.onActivate();
    else el.click();
    return true;
  }

  private scrollTo(el: HTMLElement): void {
    const sp = scrollParent(el, this.root);
    if (!sp) return;
    const er = el.getBoundingClientRect();
    const pr = sp.getBoundingClientRect();
    const pad = Math.min(48, pr.height * 0.12);
    if (er.top < pr.top + pad) sp.scrollTop -= pr.top + pad - er.top;
    else if (er.bottom > pr.bottom - pad) sp.scrollTop += er.bottom - (pr.bottom - pad);
  }
}

/** Brief "pressed" state so pad/keyboard confirms show the same 3D press as a mouse click. */
export function pressFeedback(el: HTMLElement): void {
  el.classList.add('is-pressed');
  window.setTimeout(() => el.classList.remove('is-pressed'), 120);
}
