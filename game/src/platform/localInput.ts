/**
 * Local multiplayer input ("같이 하기"): one keyboard shared by two players, plus up to four
 * gamepads, each device belonging to exactly one player.
 *
 * Devices:
 *  - 'kbA' — keyboard player A: the player's own keyboard bindings (Settings > 조작) minus the
 *    right-hand keys reserved for player B, plus the mouse (taunt-wheel clicks, ping at cursor).
 *  - 'kbB' — keyboard player B: arrow keys + `.` grab, `/` dash (numpad 1/2 too). Kept apart
 *    from A's keys: any code A uses is dropped from B, and B's keys are dropped from A.
 *  - 'pad:N' — the gamepad at navigator.getGamepads() index N (standard mapping, the player's
 *    gamepad bindings). Steam Remote Play Together guests show up as ordinary pads.
 *
 * The single-player InputManager stays the input for every other screen (menus, pause menu);
 * this router only feeds the join screen and the per-player commands of a local match.
 * Pure routing helpers (key sets, code -> device) are exported for unit tests.
 */
import type { Vec2 } from '../sim/types';
import { DEFAULT_BINDINGS, MATCH_ACTIONS, EMOTE_ACTIONS, cloneBindings, isMouseCode, parsePadCode, type ActionBindings, type Bindings, type MatchAction } from './bindings';
import { applyRadialDeadzone, clampUnit, type GamepadLike, type MatchFrame, type PointerPos } from './input';
import { wheelClickFree } from './emotes';

export type KeyboardDeviceId = 'kbA' | 'kbB';
/** 'kbA' | 'kbB' | 'pad:0'..'pad:3'. */
export type LocalDeviceId = KeyboardDeviceId | `pad:${number}`;

export const MAX_LOCAL_PADS = 4;

/** Player B's default keys (right side of the keyboard; numpad alternates). */
export const KEYBOARD_B_DEFAULTS: Readonly<ActionBindings> = Object.freeze({
  moveUp: ['ArrowUp'],
  moveDown: ['ArrowDown'],
  moveLeft: ['ArrowLeft'],
  moveRight: ['ArrowRight'],
  grab: ['Period', 'Numpad1'],
  dash: ['Slash', 'ShiftRight', 'Numpad2'],
  ping: ['Semicolon', 'Numpad3'],
  pause: ['KeyP', 'Backspace'],
  emote1: ['Digit7'],
  emote2: ['Digit8'],
  emote3: ['Digit9'],
  emote4: ['Digit0'],
  emoteWheel: ['Comma'],
}) as Readonly<ActionBindings>;

/** Keys only player B may use while two keyboard players share the board (A's right-hand alternates). */
const RIGHT_HAND_RESERVED = ['KeyJ', 'KeyK', 'KeyL', 'KeyP', 'ShiftRight', 'Enter', 'NumpadEnter', 'Backspace'];

/** Extra join-screen keys per keyboard player (on top of grab = join/ready, dash = back). */
export const LOBBY_KEYS: Readonly<Record<KeyboardDeviceId, { confirm: readonly string[]; back: readonly string[] }>> = {
  kbA: { confirm: ['Enter'], back: ['Escape'] },
  kbB: { confirm: ['NumpadEnter'], back: ['Backspace'] },
};

export interface KeySets {
  kbA: ActionBindings;
  kbB: ActionBindings;
}

function emptyActions(): ActionBindings {
  const out = {} as ActionBindings;
  for (const a of MATCH_ACTIONS) out[a] = [];
  return out;
}

/**
 * The two keyboard players' key sets from the saved bindings: A keeps its own keys except the
 * arrows / right-hand keys B needs; B gets its defaults (or `bOverride`) minus anything A uses.
 * An action left empty falls back to its default (A: WASD set; B: numpad alternate) so nobody
 * ends up unable to move or grab.
 */
export function keySetsFor(bindings: Readonly<Bindings> | null | undefined, bOverride?: Partial<ActionBindings> | null): KeySets {
  const kbSrc = bindings?.keyboard ?? DEFAULT_BINDINGS.keyboard;
  const bBase = { ...cloneBindings({ keyboard: KEYBOARD_B_DEFAULTS as ActionBindings, gamepad: DEFAULT_BINDINGS.gamepad }).keyboard, ...(bOverride ?? {}) };
  const reservedForB = new Set<string>([...RIGHT_HAND_RESERVED]);
  // B's numpad alternates are not reserved: A may rebind onto them (B then loses that alternate).
  for (const a of MATCH_ACTIONS) for (const c of bBase[a] ?? []) if (!c.startsWith('Numpad')) reservedForB.add(c);
  const kbA = emptyActions();
  for (const a of MATCH_ACTIONS) {
    kbA[a] = (kbSrc[a] ?? []).filter((c) => !reservedForB.has(c) && !c.startsWith('Arrow'));
    if (!kbA[a].length && !EMOTE_ACTIONS.includes(a as (typeof EMOTE_ACTIONS)[number]) && a !== 'emoteWheel') {
      kbA[a] = DEFAULT_BINDINGS.keyboard[a].filter((c) => !reservedForB.has(c) && !c.startsWith('Arrow'));
    }
  }
  if (!kbA.pause.includes('Escape')) kbA.pause.unshift('Escape');
  const usedByA = new Set<string>();
  for (const a of MATCH_ACTIONS) for (const c of kbA[a]) usedByA.add(c);
  const kbB = emptyActions();
  for (const a of MATCH_ACTIONS) {
    kbB[a] = (bBase[a] ?? []).filter((c) => !usedByA.has(c) && !isMouseCode(c));
    if (!kbB[a].length) kbB[a] = KEYBOARD_B_DEFAULTS[a].filter((c) => !usedByA.has(c));
  }
  return { kbA, kbB };
}

/** Which keyboard player a key / mouse code belongs to (mouse buttons are always player A's). */
export function keyboardDeviceOf(code: string, sets: KeySets): KeyboardDeviceId | null {
  if (isMouseCode(code)) return 'kbA';
  for (const dev of ['kbA', 'kbB'] as const) {
    for (const a of MATCH_ACTIONS) if (sets[dev][a].includes(code)) return dev;
    if (LOBBY_KEYS[dev].confirm.includes(code) || LOBBY_KEYS[dev].back.includes(code)) return dev;
  }
  return null;
}

export function isPadDevice(d: string): d is `pad:${number}` {
  return /^pad:\d+$/.test(d);
}

export function padIndexOf(d: string): number | null {
  return isPadDevice(d) ? Number(d.slice(4)) : null;
}

/** One poll of join-screen input for one device. */
export interface LobbyFrame {
  /** Grab / Enter / A: join, then ready. */
  confirm: boolean;
  /** Dash / Esc / B: un-ready, then leave. */
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Start / pause key (pads: Start). */
  start: boolean;
}

export const EMPTY_LOBBY_FRAME: Readonly<LobbyFrame> = Object.freeze({ confirm: false, back: false, left: false, right: false, up: false, down: false, start: false });

const PRESS = 0.5;
const RELEASE = 0.35;

interface PadState {
  prev: Set<string>;
  latched: Set<string>;
  /** Codes ignored until released (held across a pause / context switch). */
  suppressed: Set<string>;
}

interface PadRead {
  pad: GamepadLike | null;
  active: Set<string>;
  value(code: string): number;
}

export interface LocalInputOptions {
  target?: EventTarget | null;
  getGamepads?: () => ArrayLike<GamepadLike | null> | null | undefined;
  bindings?: Bindings;
}

function defaultPads(): ArrayLike<GamepadLike | null> | null {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    return navigator.getGamepads();
  } catch {
    return null;
  }
}

/**
 * Per-device input for local multiplayer. Keyboard edges are latched per device until that
 * device is read; pads are read on demand (one read per device per tick).
 */
export class LocalInputRouter {
  private bindings: Bindings;
  private sets: KeySets;
  private readonly target: EventTarget | null;
  private readonly getPads: () => ArrayLike<GamepadLike | null> | null | undefined;
  private readonly held = new Set<string>();
  private readonly pressed: Record<KeyboardDeviceId, Set<string>> = { kbA: new Set(), kbB: new Set() };
  /** Join screen: every keyboard press in order (two taps inside one slow frame are two presses). */
  private readonly queue: Record<KeyboardDeviceId, string[]> = { kbA: [], kbB: [] };
  private readonly kbSuppressed = new Set<string>();
  private readonly pads = new Map<number, PadState>();
  private readonly pressPointer = new Map<string, PointerPos>();
  private pointerPos: PointerPos | null = null;
  private readonly cleanups: Array<() => void> = [];
  /** Keyboard device that typed last (glyph hints). */
  lastKeyboard: KeyboardDeviceId | null = null;

  constructor(opts: LocalInputOptions = {}) {
    this.bindings = cloneBindings(opts.bindings ?? DEFAULT_BINDINGS);
    this.sets = keySetsFor(this.bindings);
    this.target = opts.target !== undefined ? opts.target : typeof window !== 'undefined' ? window : null;
    this.getPads = opts.getGamepads ?? defaultPads;
    this.attach();
  }

  setBindings(b: Bindings): void {
    this.bindings = cloneBindings(b);
    this.sets = keySetsFor(this.bindings);
  }

  get keySets(): Readonly<KeySets> {
    return this.sets;
  }

  get padBindings(): Readonly<ActionBindings> {
    return this.bindings.gamepad;
  }

  get pointer(): PointerPos | null {
    return this.pointerPos;
  }

  /** Connected pad indices (standard mapping first in Steam's order, i.e. index order). */
  connectedPads(): number[] {
    const out: number[] = [];
    for (const p of this.padList()) out.push(p.index);
    return out.sort((a, b) => a - b);
  }

  /** Drop pending presses; everything held right now is ignored until released. */
  flush(): void {
    for (const s of Object.values(this.pressed)) s.clear();
    for (const q of Object.values(this.queue)) q.length = 0;
    for (const c of this.held) this.kbSuppressed.add(c);
    for (const p of this.padList()) {
      const st = this.padState(p.index);
      const r = this.readPad(p.index);
      st.prev = new Set(r.active);
      st.suppressed = new Set(r.active);
    }
  }

  /**
   * Drop presses that happened while nobody read this router (a pause menu), and ignore inputs
   * pressed in the meantime until released; holds that started before keep going.
   */
  resume(): void {
    for (const s of Object.values(this.pressed)) {
      for (const c of s) if (this.held.has(c)) this.kbSuppressed.add(c);
      s.clear();
    }
    for (const q of Object.values(this.queue)) q.length = 0;
    for (const p of this.padList()) {
      const st = this.padState(p.index);
      const r = this.readPad(p.index);
      for (const c of r.active) if (!st.prev.has(c)) st.suppressed.add(c);
      st.prev = new Set(r.active);
    }
  }

  // ------------------------------------------------------------------ match frames

  /** One match poll for a device (consumes its edges). */
  matchFrame(device: LocalDeviceId): MatchFrame {
    const pi = padIndexOf(device);
    if (pi !== null) return this.padMatchFrame(pi);
    return this.keyMatchFrame(device as KeyboardDeviceId);
  }

  private keyMatchFrame(dev: KeyboardDeviceId): MatchFrame {
    const ks = this.sets[dev];
    const pressed = this.pressed[dev];
    const isDown = (a: MatchAction): boolean => ks[a].some((c) => this.held.has(c) && !this.kbSuppressed.has(c));
    const wasPressed = (a: MatchAction): string | null => ks[a].find((c) => pressed.has(c)) ?? null;
    const key = (a: MatchAction): number => (ks[a].some((c) => this.held.has(c)) ? 1 : 0);
    const mv = clampUnit({ x: key('moveRight') - key('moveLeft'), y: key('moveDown') - key('moveUp') });
    const move = { x: mv.x === 0 ? 0 : mv.x, y: mv.y === 0 ? 0 : mv.y };
    const pingCode = wasPressed('ping');
    let emotePressed: number | null = null;
    for (let i = 0; i < EMOTE_ACTIONS.length && emotePressed === null; i++) if (wasPressed(EMOTE_ACTIONS[i]!)) emotePressed = i;
    const frame: MatchFrame = {
      move,
      grabDown: isDown('grab'),
      grabPressed: wasPressed('grab') !== null,
      dashDown: isDown('dash'),
      dashPressed: wasPressed('dash') !== null,
      pingPressed: pingCode !== null,
      pingAtPointer: pingCode && isMouseCode(pingCode) ? (this.pressPointer.get(pingCode) ?? this.pointerPos) : null,
      pausePressed: wasPressed('pause') !== null,
      lastDevice: 'keyboard',
      emotePressed,
      emoteWheelDown: isDown('emoteWheel'),
      wheelStick: { x: 0, y: 0 },
      wheelKeys: { ...move },
      wheelClick: dev === 'kbA' && pressed.has('Mouse0') && wheelClickFree(ks) ? (this.pressPointer.get('Mouse0') ?? this.pointerPos) : null,
    };
    pressed.clear();
    this.queue[dev].length = 0;
    return frame;
  }

  private padMatchFrame(index: number): MatchFrame {
    const r = this.readPad(index);
    const st = this.padState(index);
    const gp = this.bindings.gamepad;
    const live = (c: string): boolean => r.active.has(c) && !st.suppressed.has(c);
    const isDown = (a: MatchAction): boolean => gp[a].some(live);
    const wasPressed = (a: MatchAction): boolean => gp[a].some((c) => live(c) && !st.prev.has(c));
    const val = (a: MatchAction): number => gp[a].reduce((m, c) => Math.max(m, r.value(c)), 0);
    const mv = clampUnit({ x: val('moveRight') - val('moveLeft'), y: val('moveDown') - val('moveUp') });
    let wheelStick: Vec2 = { x: 0, y: 0 };
    if (r.pad) {
      const a = applyRadialDeadzone(r.pad.axes[0] ?? 0, r.pad.axes[1] ?? 0);
      const b = applyRadialDeadzone(r.pad.axes[2] ?? 0, r.pad.axes[3] ?? 0);
      wheelStick = Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a;
    }
    let emotePressed: number | null = null;
    for (let i = 0; i < EMOTE_ACTIONS.length && emotePressed === null; i++) if (wasPressed(EMOTE_ACTIONS[i]!)) emotePressed = i;
    const frame: MatchFrame = {
      move: { x: mv.x === 0 ? 0 : mv.x, y: mv.y === 0 ? 0 : mv.y },
      grabDown: isDown('grab'),
      grabPressed: wasPressed('grab'),
      dashDown: isDown('dash'),
      dashPressed: wasPressed('dash'),
      pingPressed: wasPressed('ping'),
      pingAtPointer: null,
      pausePressed: wasPressed('pause') || (live('button:9') && !st.prev.has('button:9')),
      lastDevice: 'gamepad',
      emotePressed,
      emoteWheelDown: isDown('emoteWheel'),
      wheelStick,
      wheelKeys: { x: 0, y: 0 },
      wheelClick: null,
    };
    this.endPadPoll(index, r);
    return frame;
  }

  // ------------------------------------------------------------------ join screen

  /** One join-screen poll for a device (consumes its edges). */
  lobbyFrame(device: LocalDeviceId): LobbyFrame {
    const pi = padIndexOf(device);
    if (pi !== null) {
      const r = this.readPad(pi);
      const st = this.padState(pi);
      const gp = this.bindings.gamepad;
      const edge = (c: string): boolean => r.active.has(c) && !st.prev.has(c) && !st.suppressed.has(c);
      const any = (codes: readonly string[]): boolean => codes.some(edge);
      const out: LobbyFrame = {
        confirm: any(['button:0', ...gp.grab]),
        back: any(['button:1']),
        left: any(['axis:0:-', 'button:14']),
        right: any(['axis:0:+', 'button:15']),
        up: any(['axis:1:-', 'button:12']),
        down: any(['axis:1:+', 'button:13']),
        start: any(['button:9']),
      };
      this.endPadPoll(pi, r);
      return out;
    }
    const dev = device as KeyboardDeviceId;
    const ks = this.sets[dev];
    const q = this.queue[dev];
    this.pressed[dev].clear();
    // One action per call, in press order (pollLobby calls again while presses remain).
    while (q.length) {
      const code = q.shift()!;
      const is = (codes: readonly string[]): boolean => codes.includes(code);
      const out: LobbyFrame = {
        confirm: (!isMouseCode(code) && is(ks.grab)) || is(LOBBY_KEYS[dev].confirm),
        back: (!isMouseCode(code) && is(ks.dash)) || is(LOBBY_KEYS[dev].back),
        left: is(ks.moveLeft),
        right: is(ks.moveRight),
        up: is(ks.moveUp),
        down: is(ks.moveDown),
        start: is(ks.pause) && !is(LOBBY_KEYS[dev].back) && code !== 'Escape',
      };
      if (out.confirm || out.back || out.left || out.right || out.up || out.down || out.start) return out;
    }
    return { ...EMPTY_LOBBY_FRAME };
  }

  /** Every device that pressed something this poll, with its join-screen frame. */
  pollLobby(): Array<{ device: LocalDeviceId; frame: LobbyFrame }> {
    const out: Array<{ device: LocalDeviceId; frame: LobbyFrame }> = [];
    const devs: LocalDeviceId[] = ['kbA', 'kbB', ...this.connectedPads().map((i) => `pad:${i}` as LocalDeviceId)];
    for (const d of devs) {
      for (let i = 0; i < 8; i++) {
        const f = this.lobbyFrame(d);
        if (!(f.confirm || f.back || f.left || f.right || f.up || f.down || f.start)) break;
        out.push({ device: d, frame: f });
        if (isPadDevice(d)) break;
      }
    }
    return out;
  }

  /** Short rumble on one pad (no-op for keyboards). */
  vibrate(device: LocalDeviceId, strength: number, ms: number): void {
    const pi = padIndexOf(device);
    if (pi === null) return;
    const p = this.padList().find((x) => x.index === pi);
    const s = Math.max(0, Math.min(1, strength));
    try {
      void p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, startDelay: 0, strongMagnitude: s, weakMagnitude: s * 0.6 })?.catch?.(() => undefined);
    } catch {
      /* rumble is best-effort */
    }
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
  }

  // ------------------------------------------------------------------ internals

  private attach(): void {
    const t = this.target;
    if (!t) return;
    const on = (type: string, fn: (e: Event) => void): void => {
      t.addEventListener(type, fn);
      this.cleanups.push(() => t.removeEventListener(type, fn));
    };
    on('keydown', (e) => this.keyDown(e as KeyboardEvent));
    on('keyup', (e) => this.keyUp((e as KeyboardEvent).code));
    on('mousedown', (e) => {
      const m = e as MouseEvent;
      const code = `Mouse${m.button}`;
      const ptr = { clientX: m.clientX, clientY: m.clientY };
      this.pointerPos = ptr;
      this.pressPointer.set(code, ptr);
      this.held.add(code);
      this.pressed.kbA.add(code);
      if (this.queue.kbA.length < 32) this.queue.kbA.push(code);
    });
    on('mouseup', (e) => this.keyUp(`Mouse${(e as MouseEvent).button}`));
    on('mousemove', (e) => {
      const m = e as MouseEvent;
      this.pointerPos = { clientX: m.clientX, clientY: m.clientY };
    });
    on('blur', () => {
      this.held.clear();
      this.kbSuppressed.clear();
    });
  }

  /** Test / e2e hook as well: a key went down. */
  keyDown(e: Pick<KeyboardEvent, 'code'> & { repeat?: boolean }): void {
    const code = e.code;
    if (!code || e.repeat) return;
    this.held.add(code);
    const dev = keyboardDeviceOf(code, this.sets);
    if (dev) {
      this.pressed[dev].add(code);
      if (this.queue[dev].length < 32) this.queue[dev].push(code);
      this.lastKeyboard = dev;
    }
  }

  keyUp(code: string): void {
    this.held.delete(code);
    this.kbSuppressed.delete(code);
  }

  private padList(): GamepadLike[] {
    let list: ArrayLike<GamepadLike | null> | null | undefined;
    try {
      list = this.getPads();
    } catch {
      list = null;
    }
    const out: GamepadLike[] = [];
    if (!list) return out;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p && p.connected !== false && p.buttons && p.axes && p.index < 16) out.push(p);
    }
    return out.slice(0, 8);
  }

  private padState(index: number): PadState {
    let s = this.pads.get(index);
    if (!s) {
      s = { prev: new Set(), latched: new Set(), suppressed: new Set() };
      this.pads.set(index, s);
    }
    return s;
  }

  private endPadPoll(index: number, r: PadRead): void {
    const st = this.padState(index);
    for (const c of [...st.suppressed]) if (!r.active.has(c)) st.suppressed.delete(c);
    st.prev = r.active;
  }

  private readPad(index: number): PadRead {
    const pad = this.padList().find((p) => p.index === index) ?? null;
    const active = new Set<string>();
    if (!pad) return { pad: null, active, value: () => 0 };
    const st = this.padState(index);
    const s0 = applyRadialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const s1 = applyRadialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    const axis = (i: number): number => (i === 0 ? s0.x : i === 1 ? s0.y : i === 2 ? s1.x : i === 3 ? s1.y : 0);
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
    const digital = (code: string, v: number, analog: boolean): void => {
      if (!analog) {
        if (v >= PRESS) active.add(code);
        return;
      }
      const was = st.latched.has(code);
      if (v >= PRESS || (was && v >= RELEASE)) {
        active.add(code);
        st.latched.add(code);
      } else if (was) st.latched.delete(code);
    };
    pad.buttons.forEach((b, i) => {
      const trig = i === 6 || i === 7;
      digital(`button:${i}`, b.pressed && !trig ? 1 : Number.isFinite(b.value) ? b.value : 0, trig);
    });
    for (let i = 0; i < 4 && i < pad.axes.length; i++) {
      const v = axis(i);
      digital(`axis:${i}:+`, Math.max(0, v), true);
      digital(`axis:${i}:-`, Math.max(0, -v), true);
    }
    return { pad, active, value };
  }
}
