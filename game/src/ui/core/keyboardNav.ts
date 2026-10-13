/**
 * Fallback keyboard -> MenuNav adapter (dev gallery, and game flow before the platform input
 * module is wired). The shipping game should feed `InputManager.pollMenu()` instead, which
 * also covers gamepads and rebinding.
 *
 * Arrows/WASD navigate, Enter/Space confirm, Esc/Backspace back, Q/E (PageUp/PageDown) tabs.
 */
import { EMPTY_MENU_NAV, handleMenuNav, type MenuNav } from './nav';
import type { NavAction } from './prompts';

const KEYMAP: Readonly<Record<string, NavAction>> = {
  ArrowUp: 'navUp',
  KeyW: 'navUp',
  ArrowDown: 'navDown',
  KeyS: 'navDown',
  ArrowLeft: 'navLeft',
  KeyA: 'navLeft',
  ArrowRight: 'navRight',
  KeyD: 'navRight',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  Backspace: 'back',
  KeyQ: 'tabPrev',
  PageUp: 'tabPrev',
  KeyE: 'tabNext',
  PageDown: 'tabNext',
};

/** Listen for keydown on `target` and dispatch MenuNav frames. Returns a detach function. */
export function attachKeyboardNav(
  dispatch: (nav: MenuNav) => boolean = handleMenuNav,
  target: Window | HTMLElement = window,
): () => void {
  const onKey = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = KEYMAP[e.code];
    // Holding a direction repeats; holding confirm/back does not.
    if (e.repeat && action && action !== 'navUp' && action !== 'navDown' && action !== 'navLeft' && action !== 'navRight') return;
    const nav: MenuNav = { ...EMPTY_MENU_NAV, any: !e.repeat };
    if (action) nav[action] = true;
    if (dispatch(nav)) e.preventDefault();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
