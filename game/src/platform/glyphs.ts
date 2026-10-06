/**
 * Button-prompt glyphs for the device the player used last ("(A) 잡기" vs "[Space] 잡기").
 *
 * The returned objects are structurally identical to the UI's `PromptGlyph`
 * (src/ui/core/prompts.ts), so game flow can install them directly:
 *   setPromptGlyphProvider((a) => input.promptGlyph(a));
 *   setBindingLabelFormatter((device, code) => bindingGlyph(device, code, input.padFamily));
 * Pure functions: no DOM access.
 */
import {
  MENU_BINDINGS,
  isMatchAction,
  parsePadCode,
  type BindingDevice,
  type Bindings,
  type MatchAction,
  type MenuAction,
} from './bindings';

export interface Glyph {
  /** Short label drawn inside the chip: 'Enter', 'Esc', 'A', 'LB', 'WASD'. */
  label: string;
  variant?: 'key' | 'wide' | 'pad' | 'shoulder' | 'mouse';
  className?: string;
  title?: string;
}

/** Face-button naming family, detected from `Gamepad.id`. */
export type PadFamily = 'xbox' | 'playstation' | 'nintendo';

/** Everything a prompt chip can stand for (superset of the UI's PromptAction). */
export type GlyphAction = MatchAction | MenuAction | 'move' | 'navigate' | 'adjust' | 'any';

const KEY_NAMES: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Bksp',
  ShiftLeft: 'Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'Alt',
  AltRight: 'R-Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Home: 'Home',
  End: 'End',
  Insert: 'Ins',
  Delete: 'Del',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  CapsLock: 'Caps',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  Lang1: '한/영',
  Lang2: '한자',
};

const MOUSE_NAMES: readonly string[] = ['LMB', 'MMB', 'RMB', 'M4', 'M5'];
const MOUSE_TITLES: readonly string[] = ['Left mouse button', 'Middle mouse button', 'Right mouse button', 'Mouse button 4', 'Mouse button 5'];

interface PadButtonSpec {
  label: string;
  variant: Glyph['variant'];
  className?: string;
}

const DPAD: readonly PadButtonSpec[] = [
  { label: 'D↑', variant: 'key' },
  { label: 'D↓', variant: 'key' },
  { label: 'D←', variant: 'key' },
  { label: 'D→', variant: 'key' },
];

const PAD_BUTTONS: Readonly<Record<PadFamily, readonly PadButtonSpec[]>> = {
  xbox: [
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
    ...DPAD,
    { label: 'Guide', variant: 'wide' },
  ],
  playstation: [
    { label: '✕', variant: 'pad', className: 'uh-pad-ps uh-pad-ps-cross' },
    { label: '○', variant: 'pad', className: 'uh-pad-ps uh-pad-ps-circle' },
    { label: '□', variant: 'pad', className: 'uh-pad-ps uh-pad-ps-square' },
    { label: '△', variant: 'pad', className: 'uh-pad-ps uh-pad-ps-triangle' },
    { label: 'L1', variant: 'shoulder' },
    { label: 'R1', variant: 'shoulder' },
    { label: 'L2', variant: 'shoulder' },
    { label: 'R2', variant: 'shoulder' },
    { label: 'Create', variant: 'wide' },
    { label: 'Options', variant: 'wide' },
    { label: 'L3', variant: 'pad' },
    { label: 'R3', variant: 'pad' },
    ...DPAD,
    { label: 'PS', variant: 'wide' },
  ],
  // Standard mapping is positional: button 0 is the bottom face button, labelled B on Nintendo pads.
  nintendo: [
    { label: 'B', variant: 'pad', className: 'uh-pad-nin' },
    { label: 'A', variant: 'pad', className: 'uh-pad-nin' },
    { label: 'Y', variant: 'pad', className: 'uh-pad-nin' },
    { label: 'X', variant: 'pad', className: 'uh-pad-nin' },
    { label: 'L', variant: 'shoulder' },
    { label: 'R', variant: 'shoulder' },
    { label: 'ZL', variant: 'shoulder' },
    { label: 'ZR', variant: 'shoulder' },
    { label: '−', variant: 'pad' },
    { label: '+', variant: 'pad' },
    { label: 'LS', variant: 'pad' },
    { label: 'RS', variant: 'pad' },
    ...DPAD,
    { label: 'Home', variant: 'wide' },
  ],
};

/** Guess the face-button family from a Gamepad.id string. */
export function detectPadFamily(id: string | null | undefined): PadFamily {
  const s = (id ?? '').toLowerCase();
  // Xbox first: "Xbox Wireless Controller" must not match the bare PS4 name below.
  if (/xbox|045e|xinput|steam virtual/.test(s)) return 'xbox';
  // A DualShock 4 on Windows reports just "Wireless Controller".
  if (/054c|playstation|dualsense|dualshock|ps[345] controller|^wireless controller/.test(s)) return 'playstation';
  if (/057e|nintendo|switch|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox';
}

/** Label for one binding code. */
export function bindingGlyph(device: BindingDevice, code: string | null | undefined, family: PadFamily = 'xbox'): Glyph {
  if (!code) return { label: '—', variant: 'key' };
  if (device === 'keyboard') {
    const m = /^Mouse([0-4])$/.exec(code);
    if (m) {
      const i = Number(m[1]);
      return { label: MOUSE_NAMES[i], variant: 'mouse', title: MOUSE_TITLES[i] };
    }
    let label = KEY_NAMES[code];
    if (!label) {
      if (code.startsWith('Key')) label = code.slice(3);
      else if (code.startsWith('Digit')) label = code.slice(5);
      else if (code.startsWith('Numpad')) label = `Num ${code.slice(6)}`;
      else label = code;
    }
    return { label, variant: [...label].length > 2 ? 'wide' : 'key' };
  }
  const p = parsePadCode(code);
  if (!p) return { label: code, variant: 'wide' };
  if (p.kind === 'button') {
    const spec = PAD_BUTTONS[family][p.index];
    return spec ? { ...spec } : { label: `B${p.index}`, variant: 'pad' };
  }
  const stick = p.index < 2 ? (family === 'playstation' ? 'L' : 'LS') : p.index < 4 ? (family === 'playstation' ? 'R' : 'RS') : `A${p.index}`;
  const horizontal = p.index % 2 === 0;
  const arrow = horizontal ? (p.sign > 0 ? '→' : '←') : p.sign > 0 ? '↓' : '↑';
  return { label: `${stick}${arrow}`, variant: 'wide' };
}

const MOVE_ACTIONS: readonly MatchAction[] = ['moveUp', 'moveLeft', 'moveDown', 'moveRight'];

/**
 * Glyph for an action on a device, using the player's bindings for match actions and the
 * fixed menu bindings for navigation.
 */
export function actionGlyph(action: GlyphAction, device: BindingDevice, bindings: Readonly<Bindings>, family: PadFamily = 'xbox'): Glyph {
  if (isMatchAction(action)) return bindingGlyph(device, bindings[device][action][0], family);
  switch (action) {
    case 'move':
      return moveGlyph(device, bindings, family);
    case 'navigate':
      return device === 'gamepad' ? { label: 'D-Pad', variant: 'wide' } : { label: '↑↓←→', variant: 'wide' };
    case 'adjust':
      return device === 'gamepad' ? { label: 'D←→', variant: 'wide' } : { label: '←→', variant: 'wide' };
    case 'any':
      return device === 'gamepad' ? bindingGlyph('gamepad', MENU_BINDINGS.gamepad.confirm[0], family) : { label: 'Any', variant: 'wide' };
    default:
      return bindingGlyph(device, MENU_BINDINGS[device][action][0], family);
  }
}

function moveGlyph(device: BindingDevice, bindings: Readonly<Bindings>, family: PadFamily): Glyph {
  const primaries = MOVE_ACTIONS.map((a) => bindings[device][a][0] ?? null);
  if (device === 'gamepad') {
    const first = primaries[0] ? parsePadCode(primaries[0]) : null;
    if (first?.kind === 'axis') return { label: first.index < 2 ? (family === 'playstation' ? 'L' : 'LS') : family === 'playstation' ? 'R' : 'RS', variant: 'pad' };
    return { label: 'D-Pad', variant: 'wide' };
  }
  // Keyboard: "WASD" style when all four primaries are single characters, arrows otherwise.
  const labels = primaries.map((c) => (c ? bindingGlyph('keyboard', c).label : '—'));
  if (labels.every((l) => [...l].length === 1)) return { label: labels.join(''), variant: 'wide' };
  return { label: '↑←↓→', variant: 'wide' };
}
