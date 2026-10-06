/**
 * Input actions, binding codes and the pure binding-table logic (defaults, validation,
 * conflict detection, rebinding with swap). No DOM access: everything here runs in Node tests.
 *
 * Binding codes (shared with the UI's binding chips, see src/ui/core/prompts.ts):
 *  - keyboard device: `KeyboardEvent.code` ('KeyW', 'Space', 'ShiftLeft', 'ArrowUp', ...) or a
 *    mouse button 'Mouse0'..'Mouse4' (0 = left, 1 = middle, 2 = right).
 *  - gamepad device (W3C "standard" mapping): 'button:N' or 'axis:N:+' / 'axis:N:-'.
 *
 * Only the match actions are rebindable. Menu navigation uses fixed bindings
 * (MENU_BINDINGS) so a bad rebind can never lock the player out of the settings screen.
 * A few inputs are hard-wired and cannot be captured for other actions:
 *  - Escape always pauses a match / backs out of a menu (and cancels a rebind capture).
 *  - Gamepad Start (button 9) always pauses; Guide/Home (button 16) belongs to the OS/Steam.
 *  - F11 toggles fullscreen in the desktop build.
 * The hard-wired pause inputs (HARDWIRED_PAUSE) work even after the pause action's slots are
 * rebound to something else: InputManager checks them in both pollMatch().pausePressed and
 * pollMenu().pause, so the button that opened the pause menu always closes it too.
 *
 * Taunt emotes (owner addition): `emote1`..`emote4` fire the four base taunts directly, and
 * `emoteWheel` is held to open the radial wheel (every taunt, rival ones included). These five
 * are OPTIONAL actions: they may end up with no code on a device (gamepads reach the taunts
 * through the wheel only). The direct taunts also accept Ctrl chords ('Ctrl+Digit1'): a chord
 * matches only while a Control key is held, and a key pressed with Ctrl held registers as the
 * chord when that chord is bound (otherwise as the plain key). Only the emote actions may hold
 * chords, so movement / grab / dash never depend on a modifier. Plain browser builds: Chrome
 * keeps Ctrl+1..8 for tab switching and never delivers them, so the plain digits are bound too.
 *
 * Invariants kept by assignBinding / sanitizeBindings: per device, every code belongs to at
 * most one match action, and every required (non-optional) match action has at least one code.
 */

export const MATCH_ACTIONS = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'grab', 'dash', 'ping', 'pause', 'emote1', 'emote2', 'emote3', 'emote4', 'emoteWheel'] as const;
export type MatchAction = (typeof MATCH_ACTIONS)[number];

/** Direct taunt actions, in slot order (base taunts 1..4). */
export const EMOTE_ACTIONS = ['emote1', 'emote2', 'emote3', 'emote4'] as const;
export type EmoteAction = (typeof EMOTE_ACTIONS)[number];

/** Actions that may be left without any code on a device (taunts: cosmetic, never required). */
export const OPTIONAL_ACTIONS: ReadonlySet<MatchAction> = new Set<MatchAction>([...EMOTE_ACTIONS, 'emoteWheel']);

/** Actions that may hold Ctrl chords ('Ctrl+Digit1'). */
export const CHORD_ACTIONS: ReadonlySet<MatchAction> = new Set<MatchAction>(EMOTE_ACTIONS);

export function isOptionalAction(a: MatchAction): boolean {
  return OPTIONAL_ACTIONS.has(a);
}

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
    // Taunts: Ctrl+1..4 (the owner's ask; the desktop build gets them) and the plain digits
    // (always delivered, also in browsers). Hold T for the wheel.
    emote1: ['Ctrl+Digit1', 'Digit1'],
    emote2: ['Ctrl+Digit2', 'Digit2'],
    emote3: ['Ctrl+Digit3', 'Digit3'],
    emote4: ['Ctrl+Digit4', 'Digit4'],
    emoteWheel: ['KeyT'],
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
    // Pads reach every taunt through the wheel (hold LB, pick with a stick, release).
    emote1: [],
    emote2: [],
    emote3: [],
    emote4: [],
    emoteWheel: [btn(PAD.LB)],
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
const CHORD_RE = /^Ctrl\+([A-Za-z][A-Za-z0-9]{0,31})$/;
/** Keys that cannot be the main key of a chord (modifiers themselves, Esc). */
const MODIFIER_RE = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

/** Is `code` a modifier key (Ctrl / Shift / Alt / Meta)? */
export function isModifierCode(code: string): boolean {
  return MODIFIER_RE.test(code);
}

/** Main key of a Ctrl chord ('Ctrl+Digit1' -> 'Digit1'), or null for a plain code. */
export function chordBase(code: string): string | null {
  const m = CHORD_RE.exec(code);
  return m ? m[1] : null;
}

/** The chord code for a key pressed with Ctrl held ('Digit1' -> 'Ctrl+Digit1'). */
export function chordCode(code: string): string {
  return `Ctrl+${code}`;
}
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
  if (device === 'keyboard') {
    if (KEY_CODE_RE.test(code) || MOUSE_RE.test(code)) return true;
    const base = chordBase(code);
    return base !== null && !MODIFIER_RE.test(base) && base !== 'Escape' && !MOUSE_RE.test(base);
  }
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
  const base = device === 'keyboard' ? chordBase(code) : null;
  if (base !== null && (!CHORD_ACTIONS.has(action) || FORBIDDEN.keyboard.has(base))) return false;
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
  /**
   * The code it received instead, or null if it simply lost the code (it still has others).
   * Usually the rebound action's previous code (a swap); when that is impossible and the
   * action would be left with nothing, a free default or fallback code (see `pickReplacement`).
   */
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
 * Spare codes handed to an action that would otherwise end up with no binding at all on a
 * device (see `pickReplacement`). Ordered by reach from the default hand position. Only codes
 * no other action uses are ever picked, so these never create conflicts.
 */
const FALLBACK_CODES: Readonly<Record<BindingDevice, readonly string[]>> = {
  keyboard: [
    'KeyF', 'KeyR', 'KeyG', 'KeyQ', 'KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyT', 'KeyH', 'KeyU', 'KeyI',
    'KeyO', 'KeyN', 'KeyM', 'KeyB', 'KeyY', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Tab',
  ],
  gamepad: [
    btn(PAD.LB), btn(PAD.LT), btn(PAD.RT), btn(PAD.B), btn(PAD.LS), btn(PAD.RS), btn(PAD.VIEW),
    btn(PAD.X), btn(PAD.Y), btn(PAD.A), btn(PAD.RB),
    btn(PAD.DPAD_UP), btn(PAD.DPAD_DOWN), btn(PAD.DPAD_LEFT), btn(PAD.DPAD_RIGHT),
  ],
};

/**
 * A code for `action` on `device` that is not in `taken`: `preferred` first, then the action's
 * own defaults (for pause this includes the hard-wired Esc / Start, which no other action may
 * hold), then FALLBACK_CODES. Null only if every candidate is taken (cannot happen with eight
 * actions, but callers handle it).
 */
export function pickReplacement(
  device: BindingDevice,
  action: MatchAction,
  taken: ReadonlySet<string>,
  preferred: string | null = null,
): string | null {
  const candidates = [...(preferred ? [preferred] : []), ...DEFAULT_BINDINGS[device][action], ...FALLBACK_CODES[device]];
  for (const c of candidates) if (!taken.has(c) && isBindable(action, device, c)) return c;
  return null;
}

function codesInUse(table: Readonly<ActionBindings>): Set<string> {
  const out = new Set<string>();
  for (const a of MATCH_ACTIONS) for (const c of table[a]) out.add(c);
  return out;
}

/**
 * Bind `code` to `action` at `slot` (0 = primary) on `device` and return a NEW table.
 * If another action already uses the code, the two swap: that action receives the code this
 * action had in the slot (unless it already has it or may not hold it). Otherwise it simply
 * loses the code — but never its last one: an action that would be left unbound on the device
 * gets a free replacement (`pickReplacement`), reported in `swaps` so the UI can show it.
 * Every code stays mapped to at most one action and every action keeps at least one code.
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

  // 1. Place the code. Move (not copy) it if this action already had it in another slot; an
  //    out-of-range slot appends, but never past MAX_BINDINGS_PER_ACTION (the new code must win).
  const existing = list.indexOf(code);
  if (existing >= 0 && existing !== slot) list.splice(existing, 1);
  const s = Math.max(0, Math.min(slot, list.length, MAX_BINDINGS_PER_ACTION - 1));
  if (s < list.length) list[s] = code;
  else list.push(code);
  next[device][action] = dedupe(list).slice(0, MAX_BINDINGS_PER_ACTION);

  // 2. Take the code away from every other action that had it.
  const swaps: SwapRecord[] = [];
  for (const other of new Set(conflicts.map((c) => c.action))) {
    const otherList = next[device][other];
    const idx = otherList.indexOf(code);
    if (idx < 0) continue;
    const taken = codesInUse(next[device]);
    const canSwap =
      previous !== null && previous !== code && !taken.has(previous) && isBindable(other, device, previous);
    let replacement: string | null = null;
    if (canSwap) {
      otherList[idx] = previous;
      replacement = previous;
    } else {
      otherList.splice(idx, 1);
      if (otherList.length === 0 && !OPTIONAL_ACTIONS.has(other)) {
        // `taken` still holds `code` (now owned by `action`) and everything else in use.
        replacement = pickReplacement(device, other, taken);
        if (replacement) otherList.push(replacement);
      }
    }
    swaps.push({ action: other, replacement });
    // Remove any later duplicates the other action might still hold.
    next[device][other] = dedupe(otherList);
  }
  return { bindings: next, ok: true, conflicts, swaps, previous };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/**
 * Validate an unknown value (e.g. from a save file) into a complete, conflict-free table.
 * Invalid / reserved codes are dropped, missing or empty actions fall back to their defaults
 * (an optional action stored as an empty list stays empty; a missing one gets its defaults),
 * and a code bound to several actions stays only on the first (in MATCH_ACTIONS order). An
 * action whose codes and defaults were all claimed by earlier actions (a hand-edited save)
 * gets a free code (`pickReplacement`), so no action is ever left unbound.
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
      const keepEmpty = OPTIONAL_ACTIONS.has(action) && Array.isArray(value) && value.length === 0;
      out[device][action] = list.length || keepEmpty ? list : [...DEFAULT_BINDINGS[device][action]];
    }
    // Pass 2: cross-action uniqueness (first action wins).
    const used = new Set<string>();
    MATCH_ACTIONS.forEach((action, i) => {
      const kept = out[device][action].filter((c) => !used.has(c));
      if (!kept.length && !OPTIONAL_ACTIONS.has(action)) {
        // Own defaults first, then any code neither an earlier action kept nor a later one claims.
        const taken = new Set(used);
        for (const later of MATCH_ACTIONS.slice(i + 1)) for (const c of out[device][later]) taken.add(c);
        for (const c of DEFAULT_BINDINGS[device][action]) if (!taken.has(c)) kept.push(c);
        const pick = kept.length ? null : pickReplacement(device, action, taken);
        if (pick) kept.push(pick);
      }
      kept.forEach((c) => used.add(c));
      out[device][action] = kept;
    });
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
