/**
 * Button-prompt glyphs ("[Enter] 선택", "(A) 잡기") with a pluggable provider.
 *
 * The platform/input module calls `setPromptGlyphProvider()` whenever the active device or
 * bindings change; every glyph chip already on screen is refreshed in place
 * (`[data-prompt]` elements), so screens never need to re-render for a device swap.
 */
import { h } from './dom';

/** Menu navigation actions (see MenuNav in ./nav.ts). */
export type NavAction = 'navUp' | 'navDown' | 'navLeft' | 'navRight' | 'confirm' | 'back' | 'tabPrev' | 'tabNext';

/** Everything a prompt chip can stand for. */
export type PromptAction = NavAction | 'grab' | 'dash' | 'ping' | 'pause' | 'move' | 'navigate' | 'adjust' | 'any';

export interface PromptGlyph {
  /** Short label drawn inside the chip: 'Enter', 'Esc', 'A', 'LB', '↑↓', 'WASD'. */
  label: string;
  /**
   * Chip shape: 'key' keycap, 'wide' long keycap, 'pad' round face button,
   * 'shoulder' pill (LB/RB/LT/RT), 'mouse' mouse icon + label.
   */
  variant?: 'key' | 'wide' | 'pad' | 'shoulder' | 'mouse';
  /** Optional extra class, e.g. 'uh-pad-a' for face-button colors. */
  className?: string;
  /** Accessible name; defaults to label. */
  title?: string;
}

export type PromptGlyphProvider = (action: PromptAction) => PromptGlyph;

/** Default keyboard prompts (used until the platform module installs its provider). */
export const DEFAULT_KEYBOARD_GLYPHS: Readonly<Record<PromptAction, PromptGlyph>> = {
  navUp: { label: '↑', variant: 'key' },
  navDown: { label: '↓', variant: 'key' },
  navLeft: { label: '←', variant: 'key' },
  navRight: { label: '→', variant: 'key' },
  navigate: { label: '↑↓←→', variant: 'wide' },
  adjust: { label: '←→', variant: 'wide' },
  confirm: { label: 'Enter', variant: 'wide' },
  back: { label: 'Esc', variant: 'key' },
  tabPrev: { label: 'Q', variant: 'key' },
  tabNext: { label: 'E', variant: 'key' },
  grab: { label: 'Space', variant: 'wide' },
  dash: { label: 'Shift', variant: 'wide' },
  ping: { label: 'F', variant: 'key' },
  pause: { label: 'Esc', variant: 'key' },
  move: { label: 'WASD', variant: 'wide' },
  any: { label: 'Any', variant: 'wide' },
};

let provider: PromptGlyphProvider = (a) => DEFAULT_KEYBOARD_GLYPHS[a];

/** Install (or reset with null) the glyph provider and refresh every chip in the document. */
export function setPromptGlyphProvider(p: PromptGlyphProvider | null): void {
  provider = p ?? ((a) => DEFAULT_KEYBOARD_GLYPHS[a]);
  if (typeof document !== 'undefined') refreshPromptGlyphs(document);
}

export function promptGlyph(action: PromptAction): PromptGlyph {
  try {
    return provider(action) ?? DEFAULT_KEYBOARD_GLYPHS[action];
  } catch {
    return DEFAULT_KEYBOARD_GLYPHS[action];
  }
}

function paintGlyph(el: HTMLElement, g: PromptGlyph): void {
  const variant = g.variant ?? (g.label.length > 2 ? 'wide' : 'key');
  el.className = `uh-glyph uh-glyph--${variant}${g.className ? ` ${g.className}` : ''}`;
  el.textContent = g.label;
  el.title = g.title ?? g.label;
}

/** A glyph chip that follows provider changes automatically. */
export function glyphChip(action: PromptAction): HTMLElement {
  const el = h('span', { 'data-prompt': action, 'aria-hidden': 'true' });
  paintGlyph(el, promptGlyph(action));
  return el;
}

/** Re-paint every `[data-prompt]` chip under `root`. */
export function refreshPromptGlyphs(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-prompt]').forEach((el) => {
    const action = el.dataset.prompt as PromptAction;
    paintGlyph(el, promptGlyph(action));
  });
}

// ---------------------------------------------------------------------------------------------
// Binding labels for the rebinding screen.
// ---------------------------------------------------------------------------------------------

export type BindingDevice = 'keyboard' | 'gamepad';
export type BindingLabelFormatter = (device: BindingDevice, code: string) => PromptGlyph;

const KEY_NAMES: Readonly<Record<string, string>> = {
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Bksp',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'Meta', MetaRight: 'Meta',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', CapsLock: 'Caps',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB',
};

/** Standard Gamepad API button indices (Xbox-style names). */
const PAD_BUTTONS: readonly { label: string; variant: PromptGlyph['variant']; className?: string }[] = [
  { label: 'A', variant: 'pad', className: 'uh-pad-a' },
  { label: 'B', variant: 'pad', className: 'uh-pad-b' },
  { label: 'X', variant: 'pad', className: 'uh-pad-x' },
  { label: 'Y', variant: 'pad', className: 'uh-pad-y' },
  { label: 'LB', variant: 'shoulder' },
  { label: 'RB', variant: 'shoulder' },
  { label: 'LT', variant: 'shoulder' },
  { label: 'RT', variant: 'shoulder' },
  { label: 'View', variant: 'wide' },
  { label: 'Menu', variant: 'wide' },
  { label: 'LS', variant: 'pad' },
  { label: 'RS', variant: 'pad' },
  { label: 'D↑', variant: 'key' },
  { label: 'D↓', variant: 'key' },
  { label: 'D←', variant: 'key' },
  { label: 'D→', variant: 'key' },
];

/** Default formatter: KeyboardEvent.code for keys; 'button:N' / 'axis:N:+|-' for pads. */
export const defaultBindingLabel: BindingLabelFormatter = (device, code) => {
  if (!code) return { label: '—', variant: 'key' };
  if (device === 'keyboard') {
    let label = KEY_NAMES[code];
    if (!label) {
      if (code.startsWith('Key')) label = code.slice(3);
      else if (code.startsWith('Digit')) label = code.slice(5);
      else if (code.startsWith('Numpad')) label = `Num ${code.slice(6)}`;
      else label = code;
    }
    return { label, variant: label.length > 2 ? 'wide' : 'key' };
  }
  const btn = /^(?:button:|pad:|b)?(\d+)$/.exec(code);
  if (btn) {
    const spec = PAD_BUTTONS[Number(btn[1])];
    if (spec) return { label: spec.label, variant: spec.variant, className: spec.className };
    return { label: `B${btn[1]}`, variant: 'pad' };
  }
  const axis = /^axis:(\d+):([+-])$/.exec(code);
  if (axis) {
    const stick = Number(axis[1]) < 2 ? 'LS' : 'RS';
    const horizontal = Number(axis[1]) % 2 === 0;
    const arrow = horizontal ? (axis[2] === '+' ? '→' : '←') : axis[2] === '+' ? '↓' : '↑';
    return { label: `${stick}${arrow}`, variant: 'wide' };
  }
  return { label: code, variant: 'wide' };
};

let bindingFormatter: BindingLabelFormatter = defaultBindingLabel;

export function setBindingLabelFormatter(f: BindingLabelFormatter | null): void {
  bindingFormatter = f ?? defaultBindingLabel;
}

export function bindingLabel(device: BindingDevice, code: string): PromptGlyph {
  return bindingFormatter(device, code);
}

/** Chip for a concrete binding code (rebinding rows). */
export function bindingChip(device: BindingDevice, code: string | null): HTMLElement {
  const el = h('span', { 'aria-hidden': 'true' });
  if (!code) {
    el.className = 'uh-glyph uh-glyph--key uh-glyph--empty';
    el.textContent = '—';
    return el;
  }
  paintGlyph(el, bindingLabel(device, code));
  return el;
}
