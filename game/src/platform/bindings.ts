/**
 * Input actions, binding codes and the pure binding-table logic (defaults, validation,
 * conflict detection, rebinding with swap). No DOM access: everything here runs in Node tests.
 *
 * Binding codes (shared with the UI's binding chips, see src/ui/core/prompts.ts):
 *  - keyboard device: `KeyboardEvent.code` ('KeyW', 'Space', 'ShiftLeft', 'ArrowUp', ...) or a
 *    mouse button 'Mouse0'..'Mouse4' (0 = left, 1 = middle, 2 = right).
 *  - gamepad device (W3C "standard" mapping): 'button:N' or 'axis:N:+' / 'axis:N:-'.
 *
 * Only the eight match actions are rebindable. Menu navigation uses fixed bindings
 * (MENU_BINDINGS) so a bad rebind can never lock the player out of the settings screen.
 * A few inputs are hard-wired and cannot be captured for other actions:
 *  - Escape always pauses a match / backs out of a menu (and cancels a rebind capture).
 *  - Gamepad Start (button 9) always pauses; Guide/Home (button 16) belongs to the OS/Steam.
 *  - F11 toggles fullscreen in the desktop build.
 */

export const MATCH_ACTIONS = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'grab', 'dash', 'ping', 'pause'] as const;
export type MatchAction = (typeof MATCH_ACTIONS)[number];

export const MENU_ACTIONS = ['navUp', 'navDown', 'navLeft', 'navRight', 'confirm', 'back', 'tabPrev', 'tabNext'] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

export type InputAction = MatchAction | MenuAction;
export type BindingDevice = 'keyboard' | 'gamepad';
export const BINDING_DEVICES: readonly BindingDevice[] = ['keyboard', 'gamepad'];

/** Codes per action for one device; index 0 is the primary binding shown in prompts. */
export type ActionBindings = Record<MatchAction, string[]>;

export interface Bindings {
  keyboard: ActionBindings;
  gamepad: ActionBindings;
}

/** Maximum codes stored per action and device (primary + alternates). */
export const MAX_BINDINGS_PER_ACTION = 4;

/** Standard-mapping gamepad button indices. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  START: 9,
  LS: 10,
  RS: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  GUIDE: 16,
} as const;

const btn = (i: number): string => `button:${i}`;

export const DEFAULT_BINDINGS: Readonly<Bindings> = deepFreeze({
  keyboard: {
    moveUp: ['KeyW', 'ArrowUp'],
    moveDown: ['KeyS', 'ArrowDown'],
    moveLeft: ['KeyA', 'ArrowLeft'],
    moveRight: ['KeyD', 'ArrowRight'],
    grab: ['Space', 'KeyJ'],
    dash: ['ShiftLeft', 'KeyK', 'ShiftRight'],
    // Mouse2 (right button) pings at the cursor (MatchFrame.pingAtPointer).
    ping: ['KeyE', 'KeyL', 'Mouse2'],
    pause: ['Escape', 'KeyP'],
  },
  gamepad: {
    moveUp: ['axis:1:-', btn(PAD.DPAD_UP)],
    moveDown: ['axis:1:+', btn(PAD.DPAD_DOWN)],
    moveLeft: ['axis:0:-', btn(PAD.DPAD_LEFT)],
    moveRight: ['axis:0:+', btn(PAD.DPAD_RIGHT)],
    grab: [btn(PAD.A)],
    dash: [btn(PAD.X), btn(PAD.RB)],
    ping: [btn(PAD.Y)],
    pause: [btn(PAD.START)],
  },
});

/** Fixed menu bindings (not user-editable, see header). */
export const MENU_BINDINGS: Readonly<Record<BindingDevice, Readonly<Record<MenuAction, readonly string[]>>>> = deepFreeze({
  keyboard: {
    navUp: ['ArrowUp', 'KeyW'],
    navDown: ['ArrowDown', 'KeyS'],
    navLeft: ['ArrowLeft', 'KeyA'],
    navRight: ['ArrowRight', 'KeyD'],
    confirm: ['Enter', 'Space', 'NumpadEnter'],
    back: ['Escape', 'Backspace'],
    tabPrev: ['KeyQ', 'PageUp'],
    tabNext: ['KeyE', 'PageDown'],
  },
  gamepad: {
    navUp: [btn(PAD.DPAD_UP), 'axis:1:-'],
    navDown: [btn(PAD.DPAD_DOWN), 'axis:1:+'],
    navLeft: [btn(PAD.DPAD_LEFT), 'axis:0:-'],
    navRight: [btn(PAD.DPAD_RIGHT), 'axis:0:+'],
    confirm: [btn(PAD.A)],
    back: [btn(PAD.B)],
    tabPrev: [btn(PAD.LB), btn(PAD.LT)],
    tabNext: [btn(PAD.RB), btn(PAD.RT)],
  },
});

/** Inputs that are always bound to pause and may not be captured for another action. */
export const HARDWIRED_PAUSE: Readonly<Record<BindingDevice, string>> = { keyboard: 'Escape', gamepad: btn(PAD.START) };

/** Codes that can never be bound (owned by the OS/shell). */
const FORBIDDEN: Readonly<Record<BindingDevice, ReadonlySet<string>>> = {
  keyboard: new Set(['F11', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'PrintScreen']),
  gamepad: new Set([btn(PAD.GUIDE)]),
};

const KEY_CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const MOUSE_RE = /^Mouse[0-4]$/;
const PAD_BUTTON_RE = /^button:(\d{1,2})$/;
const PAD_AXIS_RE = /^axis:(\d{1,2}):([+-])$/;

export function isMatchAction(x: unknown): x is MatchAction {
  return typeof x === 'string' && (MATCH_ACTIONS as readonly string[]).includes(x);
}

export function isMouseCode(code: string): boolean {
  return MOUSE_RE.test(code);
}

/** Syntactic validity of a code for a device (does not check reservations). */
export function isValidCode(device: BindingDevice, code: unknown): code is string {
  if (typeof code !== 'string') return false;
  if (device === 'keyboard') return KEY_CODE_RE.test(code) || MOUSE_RE.test(code);
  const b = PAD_BUTTON_RE.exec(code);
  if (b) return Number(b[1]) <= 31;
  const a = PAD_AXIS_RE.exec(code);
  return !!a && Number(a[1]) <= 15;
}

/**
 * Whether `code` may be bound to `action` on `device`: syntactically valid, not owned by the
 * OS, and hard-wired pause inputs only on the pause action.
 */
export function isBindable(action: MatchAction, device: BindingDevice, code: unknown): code is string {
  if (!isValidCode(device, code)) return false;
  if (FORBIDDEN[device].has(code)) return false;
  if (code === HARDWIRED_PAUSE[device] && action !== 'pause') return false;
  return true;
}

/** Parse a gamepad code. */
export function parsePadCode(code: string): { kind: 'button'; index: number } | { kind: 'axis'; index: number; sign: 1 | -1 } | null {
  const b = PAD_BUTTON_RE.exec(code);
  if (b) return { kind: 'button', index: Number(b[1]) };
  const a = PAD_AXIS_RE.exec(code);
  if (a) return { kind: 'axis', index: Number(a[1]), sign: a[2] === '+' ? 1 : -1 };
  return null;
}

export function cloneBindings(b: Readonly<Bindings>): Bindings {
  const out = { keyboard: {}, gamepad: {} } as Bindings;
  for (const d of BINDING_DEVICES) for (const a of MATCH_ACTIONS) out[d][a] = [...(b[d][a] ?? [])];
  return out;
}

export function defaultBindings(): Bindings {
  return cloneBindings(DEFAULT_BINDINGS);
}

export interface BindingRef {
  action: MatchAction;
  device: BindingDevice;
  slot: number;
  code: string;
}

/** Every place `code` is bound on `device` (optionally ignoring one action). */
export function findBindingConflicts(
  bindings: Readonly<Bindings>,
  device: BindingDevice,
  code: string,
  exceptAction?: MatchAction,
): BindingRef[] {
  const out: BindingRef[] = [];
  for (const action of MATCH_ACTIONS) {
    if (action === exceptAction) continue;
    bindings[device][action].forEach((c, slot) => {
      if (c === code) out.push({ action, device, slot, code });
    });
  }
  return out;
}

/** All codes bound to more than one action, per device (for diagnostics and tests). */
export function listDuplicateBindings(bindings: Readonly<Bindings>): BindingRef[] {
  const out: BindingRef[] = [];
  for (const device of BINDING_DEVICES) {
    const seen = new Map<string, MatchAction>();
    for (const action of MATCH_ACTIONS) {
      bindings[device][action].forEach((code, slot) => {
        const first = seen.get(code);
        if (first && first !== action) out.push({ action, device, slot, code });
        else seen.set(code, action);
      });
    }
  }
  return out;
}

export interface SwapRecord {
  /** Action that lost `code`. */
  action: MatchAction;
  /** The code it received instead (the rebound action's previous code), or null if it just lost it. */
  replacement: string | null;
}

export interface AssignResult {
  bindings: Bindings;
  /** False when the code is not bindable to that action (bindings unchanged). */
  ok: boolean;
  /** Other actions that used the code (resolved by swapping). */
  conflicts: BindingRef[];
  swaps: SwapRecord[];
  /** Code previously in the target slot. */
  previous: string | null;
}

/**
 * Bind `code` to `action` at `slot` (0 = primary) on `device` and return a NEW table.
 * If another action already uses the code, the two swap: that action receives the code this
 * action had in the slot (unless it already has it), otherwise it simply loses the code.
 * This keeps every code mapped to at most one action without silently unbinding things.
 */
export function assignBinding(
  bindings: Readonly<Bindings>,
  action: MatchAction,
  device: BindingDevice,
  code: string,
  slot = 0,
): AssignResult {
  const next = cloneBindings(bindings);
  const list = next[device][action];
  const previous = list[slot] ?? null;
  if (!isBindable(action, device, code)) return { bindings: next, ok: false, conflicts: [], swaps: [], previous };
  const conflicts = findBindingConflicts(bindings, device, code, action);
  const swaps: SwapRecord[] = [];
  for (const other of new Set(conflicts.map((c) => c.action))) {
    const otherList = next[device][other];
    const idx = otherList.indexOf(code);
    if (idx < 0) continue;
    const canSwap =
      previous !== null && previous !== code && !otherList.includes(previous) && isBindable(other, device, previous);
    if (canSwap) {
      otherList[idx] = previous;
      swaps.push({ action: other, replacement: previous });
    } else {
      otherList.splice(idx, 1);
      swaps.push({ action: other, replacement: null });
    }
    // Remove any later duplicates the other action might still hold.
    next[device][other] = dedupe(otherList);
  }
  // Move (not copy) the code if this action already had it in another slot.
  const existing = list.indexOf(code);
  if (existing >= 0 && existing !== slot) list.splice(existing, 1);
  const s = Math.max(0, Math.min(slot, list.length));
  if (s < list.length) list[s] = code;
  else list.push(code);
  next[device][action] = dedupe(list).slice(0, MAX_BINDINGS_PER_ACTION);
  return { bindings: next, ok: true, conflicts, swaps, previous };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/**
 * Validate an unknown value (e.g. from a save file) into a complete, conflict-free table.
 * Invalid / reserved codes are dropped, missing or empty actions fall back to their defaults,
 * and a code bound to several actions stays only on the first (in MATCH_ACTIONS order).
 */
export function sanitizeBindings(raw: unknown): Bindings {
  const src = isRecord(raw) ? raw : {};
  const out = defaultBindings();
  for (const device of BINDING_DEVICES) {
    const dev = isRecord(src[device]) ? (src[device] as Record<string, unknown>) : {};
    // Pass 1: per-action validation.
    for (const action of MATCH_ACTIONS) {
      const value = dev[action];
      const list = Array.isArray(value)
        ? dedupe(value.filter((c): c is string => isBindable(action, device, c))).slice(0, MAX_BINDINGS_PER_ACTION)
        : [];
      out[device][action] = list.length ? list : [...DEFAULT_BINDINGS[device][action]];
    }
    // Pass 2: cross-action uniqueness (first action wins).
    const used = new Set<string>();
    for (const action of MATCH_ACTIONS) {
      const kept = out[device][action].filter((c) => !used.has(c));
      if (!kept.length) {
        for (const c of DEFAULT_BINDINGS[device][action]) if (!used.has(c)) kept.push(c);
      }
      kept.forEach((c) => used.add(c));
      out[device][action] = kept;
    }
  }
  return out;
}

export function bindingsEqual(a: Readonly<Bindings>, b: Readonly<Bindings>): boolean {
  for (const d of BINDING_DEVICES)
    for (const act of MATCH_ACTIONS) {
      const x = a[d][act];
      const y = b[d][act];
      if (x.length !== y.length || x.some((c, i) => c !== y[i])) return false;
    }
  return true;
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
