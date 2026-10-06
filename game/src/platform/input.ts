/**
 * InputManager: keyboard (KeyboardEvent.code), mouse and gamepads (W3C standard mapping)
 * turned into match frames and menu navigation, plus rebinding, rumble and prompt glyphs.
 *
 * Usage (game flow):
 *   const input = new InputManager({ bindings: settings.bindings, vibration: settings.vibration });
 *   // menus, once per animation frame:
 *   handleMenuNav(input.pollMenu());
 *   // match, once per simulation tick (each frame's edges are consumed by the poll):
 *   const f = input.pollMatch();
 *   const grab = latch.update(f, sim.getCharacter(humanId)!.grab !== null);
 *   commands[slot] = buildCommand(f, grab, pingFromFrame(f));
 *
 * Edge ("pressed") signals are latched per consumer (match / menu) until that consumer polls,
 * so a tap shorter than a frame is never lost. When a consumer has not polled for a while
 * (a context switch such as closing the pause menu), its stale latches are dropped and every
 * input still held is ignored until released: the A press that resumed the game does not also
 * grab. Call `flush()` to force the same on an explicit transition.
 *
 * Coordinates: the camera never rotates (doc §4), so screen up == sim -y.
 */
import { DT } from '../sim/config';
import type { Command, EntityId, Vec2 } from '../sim/types';
import {
  HARDWIRED_PAUSE,
  MATCH_ACTIONS,
  MENU_ACTIONS,
  MENU_BINDINGS,
  assignBinding,
  cloneBindings,
  defaultBindings,
  isBindable,
  isMouseCode,
  parsePadCode,
  type BindingDevice,
  type BindingRef,
  type Bindings,
  type MatchAction,
  type MenuAction,
  type SwapRecord,
} from './bindings';
import { actionGlyph, detectPadFamily, type Glyph, type GlyphAction, type PadFamily } from './glyphs';
import type { GrabMode } from './settings';

export type InputDevice = 'keyboard' | 'mouse' | 'gamepad';

export interface PointerPos {
  clientX: number;
  clientY: number;
}

/** One poll of match input. */
export interface MatchFrame {
  /** Desired movement in SIM space (screen up = sim -y), |move| <= 1. */
  move: Vec2;
  grabDown: boolean;
  grabPressed: boolean;
  dashDown: boolean;
  dashPressed: boolean;
  pingPressed: boolean;
  /** Set when the ping came from a mouse button: ping at the cursor (GameView.pickGround). */
  pingAtPointer: PointerPos | null;
  pausePressed: boolean;
  lastDevice: InputDevice;
}

/**
 * One poll of menu navigation; structurally a superset of the UI's `MenuNav`
 * (src/ui/core/nav.ts). Directions auto-repeat while held.
 */
export interface MenuNavFrame {
  navUp: boolean;
  navDown: boolean;
  navLeft: boolean;
  navRight: boolean;
  confirm: boolean;
  back: boolean;
  tabPrev: boolean;
  tabNext: boolean;
  /** Any key / mouse button / pad button pressed this frame ("아무 키나 누르세요"). */
  any: boolean;
  /** A pause binding (Esc, P, Start) was pressed: lets the pause menu close on the same button. */
  pause: boolean;
}

export const STICK_DEADZONE = 0.2;
/** Digital threshold for analog inputs (triggers, stick-as-button). */
const PRESS_THRESHOLD = 0.5;
/** Analog release threshold (hysteresis keeps menu navigation from chattering). */
const RELEASE_THRESHOLD = 0.35;
/** Stick/trigger travel needed to capture an analog input while rebinding. */
const CAPTURE_THRESHOLD = 0.6;

/** Toggle mode: a grab press that has not caught anything within this time is cancelled. */
export const GRAB_TOGGLE_CANCEL_SECONDS = 0.3;

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/**
 * Radial deadzone with rescaling: inside `dz` reads 0, the remaining travel maps smoothly to
 * 0..1 while the direction is preserved (no "snap" to the axes).
 */
export function applyRadialDeadzone(x: number, y: number, dz = STICK_DEADZONE): Vec2 {
  const fx = Number.isFinite(x) ? x : 0;
  const fy = Number.isFinite(y) ? y : 0;
  const mag = Math.hypot(fx, fy);
  if (mag <= dz || mag === 0) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - dz) / (1 - dz));
  return { x: (fx / mag) * scaled, y: (fy / mag) * scaled };
}

/** Clamp a vector to the unit disc. */
export function clampUnit(v: Vec2): Vec2 {
  const m = Math.hypot(v.x, v.y);
  return m > 1 ? { x: v.x / m, y: v.y / m } : { x: v.x, y: v.y };
}

/**
 * Turns hold / toggle grab input into the level signal `Command.grab` (the sim never knows
 * which mode the player uses — doc §4 "잡기는 토글 또는 누르기 유지 중 선택").
 *
 * Feed it exactly once per simulation tick with that tick's frame and whether the human's
 * character is holding something right now (`character.grab !== null`).
 *
 * Toggle semantics:
 *  - each press flips the wish to hold;
 *  - a wish that has not caught anything within 0.3 s is dropped (pressing next to nothing does
 *    not leave an invisible "armed" grab that fires seconds later);
 *  - when the sim releases the grip on its own (knockdown, grip break, recovery), the wish is
 *    dropped too, so the player never re-grabs something by surprise.
 */
export class GrabLatch {
  private wish = false;
  private waited = 0;
  private wasHolding = false;

  constructor(
    private modeValue: GrabMode = 'hold',
    private readonly cancelAfter = GRAB_TOGGLE_CANCEL_SECONDS,
  ) {}

  get mode(): GrabMode {
    return this.modeValue;
  }

  /** Switch modes; a grip held at the moment is kept in toggle mode. */
  setMode(mode: GrabMode): void {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    this.wish = mode === 'toggle' && this.wasHolding;
    this.waited = 0;
  }

  /** Forget everything (new match, respawn, pause with release). */
  reset(): void {
    this.wish = false;
    this.waited = 0;
    this.wasHolding = false;
  }

  /** Toggle mode: a press is waiting for something to grab. */
  get armed(): boolean {
    return this.modeValue === 'toggle' && this.wish && !this.wasHolding;
  }

  update(input: { grabDown: boolean; grabPressed: boolean }, isHolding: boolean, dt: number = DT): boolean {
    let out: boolean;
    if (this.modeValue === 'hold') {
      // A tap shorter than one poll still produces one tick of grab=true.
      out = input.grabDown || input.grabPressed;
    } else {
      if (input.grabPressed) {
        this.wish = !this.wish;
        this.waited = 0;
      } else if (this.wish) {
        if (isHolding) {
          this.waited = 0;
        } else if (this.wasHolding) {
          this.wish = false; // grip lost without the player asking
        } else {
          this.waited += dt;
          if (this.waited >= this.cancelAfter - 1e-9) this.wish = false;
        }
      }
      out = this.wish;
    }
    this.wasHolding = isHolding;
    return out;
  }
}

/** Assemble the sim command for one tick. `ping` is resolved by game flow (world position). */
export function buildCommand(
  frame: Pick<MatchFrame, 'move' | 'dashDown' | 'dashPressed'>,
  grab: boolean,
  ping: { pos: Vec2; targetId: EntityId | null } | null = null,
  aim: Vec2 | null = null,
): Command {
  return {
    move: clampUnit(frame.move),
    grab,
    // Level signal; a tap shorter than a poll still yields one rising edge.
    dash: frame.dashDown || frame.dashPressed,
    aim,
    ping,
  };
}

// ---------------------------------------------------------------------------------------------
// InputManager
// ---------------------------------------------------------------------------------------------

/** Structural subset of the DOM Gamepad used here (lets tests feed plain objects). */
export interface GamepadLike {
  readonly index: number;
  readonly id: string;
  readonly connected?: boolean;
  readonly mapping?: string;
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean; readonly value: number }>;
  readonly axes: ReadonlyArray<number>;
  readonly vibrationActuator?: {
    playEffect?(type: 'dual-rumble', params: { duration: number; startDelay?: number; strongMagnitude?: number; weakMagnitude?: number }): Promise<unknown>;
  } | null;
  /** Firefox */
  readonly hapticActuators?: ReadonlyArray<{ pulse?(value: number, duration: number): Promise<unknown> }>;
}

export interface InputManagerOptions {
  /** Keyboard / mouse / focus events. Default: `window` (none in Node). */
  target?: EventTarget | null;
  /** Visibility events. Default: `document` (none in Node). */
  doc?: EventTarget | null;
  /** Default: `navigator.getGamepads`. */
  getGamepads?: () => ArrayLike<GamepadLike | null> | null | undefined;
  /** Milliseconds clock. Default: performance.now. */
  now?: () => number;
  bindings?: Bindings;
  vibration?: boolean;
  /** Menu auto-repeat: delay before the first repeat and the interval after it (ms). */
  menuRepeatDelayMs?: number;
  menuRepeatIntervalMs?: number;
  /** A consumer that has not polled for this long is treated as re-activated (ms). */
  reactivateAfterMs?: number;
}

export interface RebindOptions {
  /** 0 = primary binding (default). */
  slot?: number;
  /** Give up after this many ms (resolves null). Default 10000. */
  timeoutMs?: number;
}

export interface RebindResult {
  action: MatchAction;
  device: BindingDevice;
  code: string;
  previous: string | null;
  conflicts: BindingRef[];
  swaps: SwapRecord[];
}

type Consumer = 'match' | 'menu';

interface ConsumerState {
  /** Keyboard/mouse codes pressed since the last poll. */
  pressed: Set<string>;
  /** Cursor position at the moment a mouse code was pressed. */
  pressPointer: Map<string, PointerPos>;
  /** Pad codes active at the last poll (for edges). */
  prevPad: Set<string>;
  /** Codes ignored until physically released. */
  suppressed: Set<string>;
  lastPoll: number;
  /** Menu auto-repeat deadlines per direction. */
  repeatAt: Map<MenuAction, number>;
}

interface PadSnapshot {
  pad: GamepadLike | null;
  /** Digital view of every button / half-axis currently active. */
  active: Set<string>;
  /** Analog value 0..1 of a code (deadzone applied for sticks). */
  value(code: string): number;
}

interface RebindState {
  action: MatchAction;
  device: BindingDevice;
  slot: number;
  startedAt: number;
  padNeutral: boolean;
  resolve: (code: string | null) => void;
  timeout: ReturnType<typeof setTimeout> | null;
  poll: ReturnType<typeof setInterval> | null;
}

const NEUTRAL_MOVE: Vec2 = Object.freeze({ x: 0, y: 0 }) as Vec2;
const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace', 'PageUp', 'PageDown', 'Home', 'End', 'Slash', 'Quote']);
const MOVE_SET: ReadonlySet<MatchAction> = new Set(['moveUp', 'moveDown', 'moveLeft', 'moveRight']);

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function defaultGetGamepads(): ArrayLike<GamepadLike | null> | null {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    return navigator.getGamepads();
  } catch {
    // Some embedders throw when the Gamepad API is blocked by permissions policy.
    return null;
  }
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || typeof t !== 'object') return false;
  const el = t as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

type Listener<T extends unknown[]> = (...args: T) => void;

class Emitter<T extends unknown[]> {
  private readonly set = new Set<Listener<T>>();
  on(cb: Listener<T>): () => void {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(...args: T): void {
    for (const cb of [...this.set]) {
      try {
        cb(...args);
      } catch (err) {
        console.error('[input] listener failed', err);
      }
    }
  }
}

export class InputManager {
  private bindings: Bindings;
  private vibrationEnabled: boolean;
  private enabledValue = true;
  private readonly target: EventTarget | null;
  private readonly doc: EventTarget | null;
  private readonly getGamepads: () => ArrayLike<GamepadLike | null> | null | undefined;
  private readonly now: () => number;
  private readonly repeatDelay: number;
  private readonly repeatInterval: number;
  private readonly reactivateAfter: number;

  /** Keyboard + mouse codes physically held. */
  private readonly held = new Set<string>();
  private readonly consumers: Record<Consumer, ConsumerState>;
  private pointerPos: PointerPos | null = null;

  private activePadIndex: number | null = null;
  /** Pad codes active at the last physical read (device switching). */
  private lastPadActive = new Set<string>();
  /** Analog hysteresis: half-axes / triggers currently considered "down". */
  private readonly analogLatched = new Set<string>();
  /** Per-pad digital button state at the previous read (active-pad switching). */
  private readonly padButtons = new Map<number, boolean[]>();

  private lastDeviceValue: InputDevice = 'keyboard';
  private padFamilyValue: PadFamily = 'xbox';
  private rebind: RebindState | null = null;
  private suppressClickUntil = 0;
  private lastRebindValue: RebindResult | null = null;

  private readonly deviceEvents = new Emitter<[InputDevice, BindingDevice, PadFamily]>();
  private readonly bindingEvents = new Emitter<[Bindings]>();
  private readonly padEvents = new Emitter<[boolean, string]>();
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: InputManagerOptions = {}) {
    this.bindings = cloneBindings(opts.bindings ?? defaultBindings());
    this.vibrationEnabled = opts.vibration ?? true;
    this.target = opts.target !== undefined ? opts.target : typeof window !== 'undefined' ? window : null;
    this.doc = opts.doc !== undefined ? opts.doc : typeof document !== 'undefined' ? document : null;
    this.getGamepads = opts.getGamepads ?? defaultGetGamepads;
    this.now = opts.now ?? defaultNow;
    this.repeatDelay = opts.menuRepeatDelayMs ?? 400;
    this.repeatInterval = opts.menuRepeatIntervalMs ?? 90;
    this.reactivateAfter = opts.reactivateAfterMs ?? 500;
    const fresh = (): ConsumerState => ({
      pressed: new Set(),
      pressPointer: new Map(),
      prevPad: new Set(),
      suppressed: new Set(),
      lastPoll: -Infinity,
      repeatAt: new Map(),
    });
    this.consumers = { match: fresh(), menu: fresh() };
    this.attach();
  }

  // ------------------------------------------------------------------ configuration

  getBindings(): Bindings {
    return cloneBindings(this.bindings);
  }

  /** Replace the binding table (expects sanitized bindings, e.g. from Settings). */
  setBindings(b: Bindings): void {
    this.bindings = cloneBindings(b);
    this.bindingEvents.emit(this.getBindings());
    this.emitDevice();
  }

  /** Restore defaults for one device or both; returns the new table. */
  resetBindings(device?: BindingDevice): Bindings {
    const d = defaultBindings();
    if (device) {
      const next = cloneBindings(this.bindings);
      next[device] = d[device];
      this.bindings = next;
    } else {
      this.bindings = d;
    }
    this.bindingEvents.emit(this.getBindings());
    this.emitDevice();
    return this.getBindings();
  }

  /** Apply the input-related parts of Settings. */
  applySettings(s: { bindings?: Bindings; vibration?: boolean }): void {
    if (typeof s.vibration === 'boolean') this.vibrationEnabled = s.vibration;
    if (s.bindings) this.setBindings(s.bindings);
  }

  setVibrationEnabled(on: boolean): void {
    this.vibrationEnabled = on;
  }

  /** Disabled: polls return neutral frames (e.g. while a native dialog is open). */
  get enabled(): boolean {
    return this.enabledValue;
  }

  set enabled(on: boolean) {
    if (on === this.enabledValue) return;
    this.enabledValue = on;
    if (!on) this.clearAll();
  }

  /** Rows for the settings screen (structurally the UI's BindingRow). */
  bindingRows(): Array<{ action: MatchAction; keyboard: string | null; gamepad: string | null }> {
    return MATCH_ACTIONS.map((action) => ({
      action,
      keyboard: this.bindings.keyboard[action][0] ?? null,
      gamepad: this.bindings.gamepad[action][0] ?? null,
    }));
  }

  // ------------------------------------------------------------------ device info

  get lastDevice(): InputDevice {
    return this.lastDeviceValue;
  }

  /** Which glyph set prompts should show. */
  get glyphDevice(): BindingDevice {
    return this.lastDeviceValue === 'gamepad' ? 'gamepad' : 'keyboard';
  }

  get padFamily(): PadFamily {
    return this.padFamilyValue;
  }

  /** Last known cursor position (client px), or null before the mouse moved. */
  get pointer(): PointerPos | null {
    return this.pointerPos ? { ...this.pointerPos } : null;
  }

  /** Whether any gamepad is connected right now. */
  hasGamepad(): boolean {
    return this.connectedPads().length > 0;
  }

  /** Prompt glyph for an action on the device used last. */
  promptGlyph(action: GlyphAction): Glyph {
    return actionGlyph(action, this.glyphDevice, this.bindings, this.padFamilyValue);
  }

  /**
   * Prompt glyphs may have changed: the glyph device (keyboard <-> pad), the pad family or the
   * bindings changed. Game flow refreshes the UI's glyph provider here.
   */
  onDeviceChange(cb: (device: InputDevice, glyphDevice: BindingDevice, family: PadFamily) => void): () => void {
    return this.deviceEvents.on(cb);
  }

  onBindingsChange(cb: (b: Bindings) => void): () => void {
    return this.bindingEvents.on(cb);
  }

  /** Gamepad connected (true) / disconnected (false). Game flow may pause on disconnect. */
  onGamepadConnection(cb: (connected: boolean, id: string) => void): () => void {
    return this.padEvents.on(cb);
  }

  // ------------------------------------------------------------------ polling

  pollMatch(): MatchFrame {
    const st = this.consumer('match');
    const pad = this.readPad();
    if (this.rebind || !this.enabledValue) {
      this.finishPoll(st, pad);
      return this.neutralFrame();
    }
    const down = (a: MatchAction): boolean => this.isDown(st, pad, this.bindings.keyboard[a], this.bindings.gamepad[a], !MOVE_SET.has(a));
    const pressedCode = (a: MatchAction): string | null => this.pressedCode(st, pad, this.bindings.keyboard[a], this.bindings.gamepad[a]);

    const pingCode = pressedCode('ping');
    let pingAtPointer: PointerPos | null = null;
    if (pingCode && isMouseCode(pingCode)) pingAtPointer = st.pressPointer.get(pingCode) ?? this.pointer;

    const escape = HARDWIRED_PAUSE.keyboard;
    const start = HARDWIRED_PAUSE.gamepad;
    const pausePressed =
      pressedCode('pause') !== null ||
      (st.pressed.has(escape) && !st.suppressed.has(escape)) ||
      (pad.active.has(start) && !st.prevPad.has(start) && !st.suppressed.has(start));

    const frame: MatchFrame = {
      move: this.readMove(pad),
      grabDown: down('grab'),
      grabPressed: pressedCode('grab') !== null,
      dashDown: down('dash'),
      dashPressed: pressedCode('dash') !== null,
      pingPressed: pingCode !== null,
      pingAtPointer,
      pausePressed,
      lastDevice: this.lastDeviceValue,
    };
    this.finishPoll(st, pad);
    return frame;
  }

  pollMenu(): MenuNavFrame {
    const st = this.consumer('menu');
    const pad = this.readPad();
    const out: MenuNavFrame = {
      navUp: false,
      navDown: false,
      navLeft: false,
      navRight: false,
      confirm: false,
      back: false,
      tabPrev: false,
      tabNext: false,
      any: false,
      pause: false,
    };
    if (this.rebind || !this.enabledValue) {
      st.repeatAt.clear();
      this.finishPoll(st, pad);
      return out;
    }
    const now = this.now();
    for (const action of MENU_ACTIONS) {
      const kb = MENU_BINDINGS.keyboard[action];
      const gp = MENU_BINDINGS.gamepad[action];
      const pressed = this.pressedCode(st, pad, kb, gp) !== null;
      const isDir = action === 'navUp' || action === 'navDown' || action === 'navLeft' || action === 'navRight';
      if (!isDir) {
        out[action] = pressed;
        continue;
      }
      const held = this.isDown(st, pad, kb, gp, true);
      if (pressed) {
        out[action] = true;
        st.repeatAt.set(action, now + this.repeatDelay);
      } else if (held) {
        const at = st.repeatAt.get(action);
        if (at === undefined) st.repeatAt.set(action, now + this.repeatDelay);
        else if (now >= at) {
          out[action] = true;
          // Never queue a burst after a hitch: schedule from now.
          st.repeatAt.set(action, now + this.repeatInterval);
        }
      } else {
        st.repeatAt.delete(action);
      }
    }
    out.pause = this.pressedCode(st, pad, this.bindings.keyboard.pause, this.bindings.gamepad.pause) !== null;
    for (const code of st.pressed) if (!st.suppressed.has(code)) out.any = true;
    for (const code of pad.active) if (code.startsWith('button:') && !st.prevPad.has(code) && !st.suppressed.has(code)) out.any = true;
    this.finishPoll(st, pad);
    return out;
  }

  /**
   * Explicit context switch: drop pending presses and ignore everything currently held until
   * it is released (both consumers).
   */
  flush(): void {
    const pad = this.readPad();
    for (const st of Object.values(this.consumers)) this.resetConsumer(st, pad);
  }

  // ------------------------------------------------------------------ rebinding

  get isRebinding(): boolean {
    return this.rebind !== null;
  }

  /** Details of the last successful rebind (conflicts that were swapped), for a toast. */
  get lastRebind(): RebindResult | null {
    return this.lastRebindValue;
  }

  /**
   * Capture the next key / mouse button (keyboard device) or pad button / stick direction
   * (gamepad device) and bind it to `action`, swapping with any action that used it.
   * Resolves with the code, or null when cancelled (Esc, pad Start, timeout, cancelRebind()).
   * Reserved inputs (F11, Guide, Esc/Start outside pause) are ignored while waiting.
   */
  startRebind(action: MatchAction, device: BindingDevice, opts: RebindOptions = {}): Promise<string | null> {
    this.cancelRebind();
    return new Promise<string | null>((resolve) => {
      const state: RebindState = {
        action,
        device,
        slot: Math.max(0, Math.floor(opts.slot ?? 0)),
        startedAt: this.now(),
        // Wait for every pad input to be released first (the A that opened the capture).
        padNeutral: false,
        resolve,
        timeout: null,
        poll: null,
      };
      this.rebind = state;
      const timeoutMs = opts.timeoutMs ?? 10000;
      if (timeoutMs > 0 && Number.isFinite(timeoutMs)) state.timeout = setTimeout(() => this.finishRebind(state, null), timeoutMs);
      // Pads have no events: poll while capturing. Keyboard captures also watch the pad so
      // pressing Start cancels from either device.
      state.poll = setInterval(() => this.pollRebindPad(state), 16);
    });
  }

  cancelRebind(): void {
    if (this.rebind) this.finishRebind(this.rebind, null);
  }

  // ------------------------------------------------------------------ rumble

  /**
   * Rumble the active pad. `strength` 0..1, `ms` duration. No-op (false) when vibration is off
   * in settings, no pad is connected or the browser has no haptics.
   */
  vibrate(strength: number, ms: number): boolean {
    if (!this.vibrationEnabled) return false;
    const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0));
    const d = Math.min(5000, Math.max(0, Number.isFinite(ms) ? ms : 0));
    if (s <= 0 || d <= 0) return false;
    const pad = this.activePad();
    if (!pad) return false;
    try {
      const act = pad.vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        act.playEffect('dual-rumble', { duration: d, startDelay: 0, strongMagnitude: s, weakMagnitude: Math.min(1, s * 0.6 + 0.1) }).catch(() => {});
        return true;
      }
      const h = pad.hapticActuators?.[0];
      if (h && typeof h.pulse === 'function') {
        h.pulse(s, d).catch(() => {});
        return true;
      }
    } catch {
      // Haptics are best effort.
    }
    return false;
  }

  // ------------------------------------------------------------------ lifecycle

  /** Release everything (blur, visibility loss, disable). */
  clearAll(): void {
    this.held.clear();
    this.analogLatched.clear();
    for (const st of Object.values(this.consumers)) {
      st.pressed.clear();
      st.pressPointer.clear();
      st.repeatAt.clear();
      st.suppressed.clear();
      // Pads keep reporting while unfocused in some browsers: treat anything still held as old.
      st.prevPad = new Set(this.lastPadActive);
    }
  }

  dispose(): void {
    this.cancelRebind();
    for (const c of this.cleanups.splice(0)) c();
    this.clearAll();
  }

  // ------------------------------------------------------------------ internals: events

  private attach(): void {
    const on = (t: EventTarget | null, type: string, fn: (e: Event) => void, capture = true): void => {
      if (!t || typeof t.addEventListener !== 'function') return;
      t.addEventListener(type, fn, { capture, passive: false });
      this.cleanups.push(() => t.removeEventListener(type, fn, { capture }));
    };
    on(this.target, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    on(this.target, 'keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    on(this.target, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
    on(this.target, 'mouseup', (e) => this.onMouseUp(e as MouseEvent));
    on(this.target, 'mousemove', (e) => this.onPointerMove(e as MouseEvent), false);
    on(this.target, 'click', (e) => this.onClick(e));
    on(this.target, 'auxclick', (e) => this.onClick(e));
    on(this.target, 'contextmenu', (e) => e.preventDefault());
    on(this.target, 'blur', () => this.clearAll(), false);
    on(this.doc, 'visibilitychange', () => {
      const hidden = (this.doc as { visibilityState?: string } | null)?.visibilityState === 'hidden';
      if (hidden) this.clearAll();
    }, false);
    on(this.target, 'gamepadconnected', (e) => this.onPadConnection(e as GamepadEvent, true), false);
    on(this.target, 'gamepaddisconnected', (e) => this.onPadConnection(e as GamepadEvent, false), false);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const code = e.code;
    if (!code) return;
    if (this.rebind) {
      this.captureKey(e);
      return;
    }
    if (isEditableTarget(e.target)) return;
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (SCROLL_KEYS.has(code) || this.isBoundKeyboardCode(code))) e.preventDefault();
    this.setDevice('keyboard');
    if (e.repeat && this.held.has(code)) return;
    this.held.add(code);
    for (const st of Object.values(this.consumers)) st.pressed.add(code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    const code = e.code;
    if (!code) return;
    this.held.delete(code);
    for (const st of Object.values(this.consumers)) st.suppressed.delete(code);
  }

  private onMouseDown(e: MouseEvent): void {
    this.onPointerMove(e);
    const code = `Mouse${e.button}`;
    if (!isMouseCode(code)) return;
    if (this.rebind) {
      this.captureMouse(e, code);
      return;
    }
    this.setDevice('mouse');
    this.held.add(code);
    const pos = this.pointerPos ? { ...this.pointerPos } : null;
    for (const st of Object.values(this.consumers)) {
      st.pressed.add(code);
      if (pos) st.pressPointer.set(code, pos);
    }
  }

  private onMouseUp(e: MouseEvent): void {
    const code = `Mouse${e.button}`;
    this.held.delete(code);
    for (const st of Object.values(this.consumers)) st.suppressed.delete(code);
  }

  private onPointerMove(e: MouseEvent): void {
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') this.pointerPos = { clientX: e.clientX, clientY: e.clientY };
  }

  /** Swallow the click that follows a mouse-button capture so it does not hit the UI. */
  private onClick(e: Event): void {
    if (this.rebind || this.now() < this.suppressClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  private onPadConnection(e: GamepadEvent, connected: boolean): void {
    const pad = (e as { gamepad?: GamepadLike }).gamepad;
    const id = pad?.id ?? '';
    if (pad && !connected && this.activePadIndex === pad.index) {
      this.activePadIndex = null;
      this.analogLatched.clear();
    }
    this.padEvents.emit(connected, id);
  }

  private isBoundKeyboardCode(code: string): boolean {
    for (const a of MATCH_ACTIONS) if (this.bindings.keyboard[a].includes(code)) return true;
    for (const a of MENU_ACTIONS) if (MENU_BINDINGS.keyboard[a].includes(code)) return true;
    return false;
  }

  private setDevice(d: InputDevice): void {
    if (d === this.lastDeviceValue) return;
    const glyphBefore = this.glyphDevice;
    this.lastDeviceValue = d;
    if (this.glyphDevice !== glyphBefore) this.emitDevice();
  }

  private emitDevice(): void {
    this.deviceEvents.emit(this.lastDeviceValue, this.glyphDevice, this.padFamilyValue);
  }

  // ------------------------------------------------------------------ internals: consumers

  private consumer(kind: Consumer): ConsumerState {
    const st = this.consumers[kind];
    const now = this.now();
    if (now - st.lastPoll > this.reactivateAfter) this.resetConsumer(st, null);
    st.lastPoll = now;
    return st;
  }

  private resetConsumer(st: ConsumerState, pad: PadSnapshot | null): void {
    st.pressed.clear();
    st.pressPointer.clear();
    st.repeatAt.clear();
    st.suppressed = new Set(this.held);
    const active = pad ? pad.active : this.readPad().active;
    for (const c of active) st.suppressed.add(c);
    st.prevPad = new Set(active);
  }

  private finishPoll(st: ConsumerState, pad: PadSnapshot): void {
    st.pressed.clear();
    st.pressPointer.clear();
    st.prevPad = new Set(pad.active);
    for (const c of [...st.suppressed]) {
      const stillHeld = c.includes(':') ? pad.active.has(c) : this.held.has(c);
      if (!stillHeld) st.suppressed.delete(c);
    }
  }

  private isDown(st: ConsumerState, pad: PadSnapshot, kb: readonly string[], gp: readonly string[], respectSuppression: boolean): boolean {
    for (const c of kb) if (this.held.has(c) && !(respectSuppression && st.suppressed.has(c))) return true;
    for (const c of gp) if (pad.active.has(c) && !(respectSuppression && st.suppressed.has(c))) return true;
    return false;
  }

  /** The first code of the lists that was pressed since the consumer's last poll. */
  private pressedCode(st: ConsumerState, pad: PadSnapshot, kb: readonly string[], gp: readonly string[]): string | null {
    for (const c of kb) if (st.pressed.has(c) && !st.suppressed.has(c)) return c;
    for (const c of gp) if (pad.active.has(c) && !st.prevPad.has(c) && !st.suppressed.has(c)) return c;
    return null;
  }

  private neutralFrame(): MatchFrame {
    return {
      move: { ...NEUTRAL_MOVE },
      grabDown: false,
      grabPressed: false,
      dashDown: false,
      dashPressed: false,
      pingPressed: false,
      pingAtPointer: null,
      pausePressed: false,
      lastDevice: this.lastDeviceValue,
    };
  }

  private readMove(pad: PadSnapshot): Vec2 {
    const kb = this.bindings.keyboard;
    const key = (a: MatchAction): number => (kb[a].some((c) => this.held.has(c)) ? 1 : 0);
    const k = clampUnit({ x: key('moveRight') - key('moveLeft'), y: key('moveDown') - key('moveUp') });
    const gp = this.bindings.gamepad;
    const val = (a: MatchAction): number => gp[a].reduce((m, c) => Math.max(m, pad.value(c)), 0);
    const p = clampUnit({ x: val('moveRight') - val('moveLeft'), y: val('moveDown') - val('moveUp') });
    const sum = clampUnit({ x: k.x + p.x, y: k.y + p.y });
    // Avoid -0 noise in the command stream.
    return { x: sum.x === 0 ? 0 : sum.x, y: sum.y === 0 ? 0 : sum.y };
  }

  // ------------------------------------------------------------------ internals: gamepads

  private connectedPads(): GamepadLike[] {
    let list: ArrayLike<GamepadLike | null> | null | undefined;
    try {
      list = this.getGamepads();
    } catch {
      list = null;
    }
    const out: GamepadLike[] = [];
    if (!list) return out;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p && p.connected !== false && p.buttons && p.axes) out.push(p);
    }
    return out;
  }

  private activePad(): GamepadLike | null {
    const pads = this.connectedPads();
    if (!pads.length) {
      this.activePadIndex = null;
      this.padButtons.clear();
      return null;
    }
    // Which pads had a button go down since the previous read.
    const fresh = new Set<number>();
    for (const p of pads) {
      const prev = this.padButtons.get(p.index) ?? [];
      const now = p.buttons.map((b, i) => i !== 16 && (b.pressed || b.value > PRESS_THRESHOLD));
      if (now.some((v, i) => v && !prev[i])) fresh.add(p.index);
      this.padButtons.set(p.index, now);
    }
    for (const k of [...this.padButtons.keys()]) if (!pads.some((p) => p.index === k)) this.padButtons.delete(k);
    const current = pads.find((p) => p.index === this.activePadIndex);
    // Switch to a pad the player just pressed a button on (they picked up another pad). When the
    // active pad registered a new press too, stay: with Steam Input a physical pad and Steam's
    // virtual pad report the same press, and following both would flip every frame.
    if (!(current && fresh.has(current.index))) {
      const next = pads.find((p) => p.index !== this.activePadIndex && fresh.has(p.index));
      if (next) {
        this.activatePad(next);
        return next;
      }
    }
    if (current) return current;
    const first = pads.find((p) => p.mapping === 'standard') ?? pads[0];
    this.activatePad(first);
    return first;
  }

  private activatePad(p: GamepadLike): void {
    const changedPad = this.activePadIndex !== p.index;
    this.activePadIndex = p.index;
    if (changedPad) this.analogLatched.clear();
    const family = detectPadFamily(p.id);
    if (family !== this.padFamilyValue) {
      this.padFamilyValue = family;
      if (this.glyphDevice === 'gamepad') this.emitDevice();
    }
  }

  private readPad(): PadSnapshot {
    const pad = this.activePad();
    const active = new Set<string>();
    if (!pad) {
      this.lastPadActive = active;
      return { pad: null, active, value: () => 0 };
    }
    const axes = pad.axes;
    const s0 = applyRadialDeadzone(axes[0] ?? 0, axes[1] ?? 0);
    const s1 = applyRadialDeadzone(axes[2] ?? 0, axes[3] ?? 0);
    const axis = (i: number): number => {
      if (i === 0) return s0.x;
      if (i === 1) return s0.y;
      if (i === 2) return s1.x;
      if (i === 3) return s1.y;
      const v = axes[i] ?? 0;
      return Number.isFinite(v) && Math.abs(v) > STICK_DEADZONE ? v : 0;
    };
    const value = (code: string): number => {
      const p = parsePadCode(code);
      if (!p) return 0;
      if (p.kind === 'button') {
        const b = pad.buttons[p.index];
        if (!b) return 0;
        return Math.max(b.pressed ? 1 : 0, Number.isFinite(b.value) ? Math.min(1, Math.max(0, b.value)) : 0);
      }
      return Math.max(0, axis(p.index) * p.sign);
    };
    // Digital view with hysteresis for analog sources.
    const digital = (code: string, v: number, analog: boolean): void => {
      if (!analog) {
        if (v >= PRESS_THRESHOLD) active.add(code);
        return;
      }
      const latched = this.analogLatched.has(code);
      if (v >= PRESS_THRESHOLD || (latched && v >= RELEASE_THRESHOLD)) {
        active.add(code);
        this.analogLatched.add(code);
      } else if (latched) this.analogLatched.delete(code);
    };
    pad.buttons.forEach((b, i) => {
      const code = `button:${i}`;
      const isTrigger = i === 6 || i === 7;
      digital(code, b.pressed && !isTrigger ? 1 : Number.isFinite(b.value) ? b.value : 0, isTrigger);
    });
    // Digital half-axis codes for the two sticks only: non-standard pads often expose triggers
    // as extra axes resting at -1, which would read as a permanently held direction.
    for (let i = 0; i < axes.length && i < 4; i++) {
      const v = axis(i);
      digital(`axis:${i}:+`, Math.max(0, v), true);
      digital(`axis:${i}:-`, Math.max(0, -v), true);
    }
    // Device switching: a newly active pad input makes the pad the prompt device.
    for (const c of active) {
      if (!this.lastPadActive.has(c) && c !== 'button:16') {
        this.setDevice('gamepad');
        break;
      }
    }
    this.lastPadActive = active;
    return { pad, active, value };
  }

  // ------------------------------------------------------------------ internals: rebinding

  private captureKey(e: KeyboardEvent): void {
    const st = this.rebind;
    if (!st) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.finishRebind(st, null);
      return;
    }
    if (st.device !== 'keyboard') return;
    if (isBindable(st.action, 'keyboard', e.code)) this.finishRebind(st, e.code);
  }

  private captureMouse(e: MouseEvent, code: string): void {
    const st = this.rebind;
    if (!st) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Ignore the tail of the click that opened the capture.
    if (this.now() - st.startedAt < 150) return;
    this.suppressClickUntil = this.now() + 600;
    if (st.device === 'gamepad') {
      // Reaching for the mouse during a pad capture means "never mind".
      this.finishRebind(st, null);
      return;
    }
    if (isBindable(st.action, 'keyboard', code)) this.finishRebind(st, code);
  }

  private pollRebindPad(st: RebindState): void {
    if (this.rebind !== st) return;
    const pad = this.activePad();
    if (!pad) return;
    // Strong-threshold view of the pad (captures need a deliberate press / push).
    const candidates: Array<{ code: string; v: number }> = [];
    pad.buttons.forEach((b, i) => {
      const v = Math.max(b.pressed ? 1 : 0, Number.isFinite(b.value) ? b.value : 0);
      if (v >= CAPTURE_THRESHOLD) candidates.push({ code: `button:${i}`, v });
    });
    const s = [applyRadialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0), applyRadialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0)];
    s.forEach((stick, k) => {
      const ax = Math.abs(stick.x) >= Math.abs(stick.y) ? 0 : 1;
      const v = ax === 0 ? stick.x : stick.y;
      if (Math.abs(v) >= CAPTURE_THRESHOLD) candidates.push({ code: `axis:${k * 2 + ax}:${v > 0 ? '+' : '-'}`, v: Math.abs(v) });
    });
    if (!st.padNeutral) {
      if (candidates.length === 0) st.padNeutral = true;
      return;
    }
    if (!candidates.length) return;
    this.setDevice('gamepad');
    if (candidates.some((c) => c.code === HARDWIRED_PAUSE.gamepad)) {
      this.finishRebind(st, null);
      return;
    }
    if (st.device !== 'gamepad') return;
    candidates.sort((a, b) => b.v - a.v);
    const pick = candidates.find((c) => isBindable(st.action, 'gamepad', c.code));
    if (pick) this.finishRebind(st, pick.code);
  }

  private finishRebind(st: RebindState, code: string | null): void {
    if (this.rebind !== st) return;
    this.rebind = null;
    if (st.timeout) clearTimeout(st.timeout);
    if (st.poll) clearInterval(st.poll);
    let result: string | null = null;
    if (code) {
      const res = assignBinding(this.bindings, st.action, st.device, code, st.slot);
      if (res.ok) {
        this.bindings = res.bindings;
        this.lastRebindValue = { action: st.action, device: st.device, code, previous: res.previous, conflicts: res.conflicts, swaps: res.swaps };
        result = code;
        this.bindingEvents.emit(this.getBindings());
        this.emitDevice();
      }
    }
    // Whatever is still held (the captured key, Esc, the pad button) must not leak into menus.
    this.flush();
    st.resolve(result);
  }
}
