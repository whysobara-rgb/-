import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBindings, listDuplicateBindings } from '../../src/platform/bindings';
import {
  GRAB_TOGGLE_CANCEL_SECONDS,
  GrabLatch,
  InputManager,
  applyRadialDeadzone,
  buildCommand,
  type GamepadLike,
} from '../../src/platform/input';
import { DT } from '../../src/sim/config';

// ---------------------------------------------------------------------------------------------
// GrabLatch
// ---------------------------------------------------------------------------------------------

const idle = { grabDown: false, grabPressed: false };
const press = { grabDown: true, grabPressed: true };
const hold = { grabDown: true, grabPressed: false };

describe('GrabLatch (hold)', () => {
  it('follows the button level, and a sub-frame tap still yields one tick', () => {
    const l = new GrabLatch('hold');
    expect(l.update(idle, false)).toBe(false);
    expect(l.update(press, false)).toBe(true);
    expect(l.update(hold, true)).toBe(true);
    expect(l.update(idle, true)).toBe(false);
    expect(l.update({ grabDown: false, grabPressed: true }, false)).toBe(true);
    expect(l.update(idle, false)).toBe(false);
  });
});

describe('GrabLatch (toggle)', () => {
  it('each press flips: grab, keep holding without the button, release on the next press', () => {
    const l = new GrabLatch('toggle');
    expect(l.update(press, false)).toBe(true); // tick 1: ask to grab
    expect(l.update(idle, true)).toBe(true); // sim grabbed; button released, still holding
    for (let i = 0; i < 300; i++) expect(l.update(idle, true)).toBe(true);
    expect(l.update(press, true)).toBe(false); // second press releases
    expect(l.update(idle, false)).toBe(false);
  });

  it('cancels a press that grabbed nothing within 0.3 s', () => {
    const l = new GrabLatch('toggle');
    const limit = Math.round(GRAB_TOGGLE_CANCEL_SECONDS / DT);
    expect(l.update(press, false)).toBe(true);
    let ticksTrue = 1;
    for (let i = 0; i < limit + 5; i++) if (l.update(idle, false)) ticksTrue++;
    expect(ticksTrue).toBe(limit);
    expect(l.armed).toBe(false);
    // Walking into a safe later does not grab it by surprise.
    expect(l.update(idle, false)).toBe(false);
  });

  it('a grab caught just before the deadline keeps holding', () => {
    const l = new GrabLatch('toggle');
    l.update(press, false);
    for (let i = 0; i < 10; i++) expect(l.update(idle, false)).toBe(true);
    expect(l.armed).toBe(true);
    expect(l.update(idle, true)).toBe(true);
    for (let i = 0; i < 60; i++) expect(l.update(idle, true)).toBe(true);
  });

  it('pressing again while armed cancels', () => {
    const l = new GrabLatch('toggle');
    l.update(press, false);
    expect(l.update({ grabDown: true, grabPressed: true }, false)).toBe(false);
  });

  it('drops the wish when the sim releases on its own (knockdown)', () => {
    const l = new GrabLatch('toggle');
    l.update(press, false);
    l.update(idle, true);
    l.update(idle, true);
    expect(l.update(idle, false)).toBe(false); // forced release
    expect(l.update(idle, false)).toBe(false);
    // Next press grabs again normally.
    expect(l.update(press, false)).toBe(true);
  });

  it('switching hold -> toggle keeps a held grip', () => {
    const l = new GrabLatch('hold');
    l.update(press, false);
    l.update(hold, true);
    l.setMode('toggle');
    expect(l.update(idle, true)).toBe(true);
    expect(l.update(press, true)).toBe(false);
  });
});

describe('buildCommand', () => {
  it('maps a frame to a sim command', () => {
    const c = buildCommand({ move: { x: 3, y: 4 }, dashDown: false, dashPressed: true }, true);
    expect(c.move.x).toBeCloseTo(0.6);
    expect(c.move.y).toBeCloseTo(0.8);
    expect(c.grab).toBe(true);
    expect(c.dash).toBe(true);
    expect(c.ping).toBeNull();
  });
});

describe('applyRadialDeadzone', () => {
  it('zeroes the inner disc and rescales the rest without snapping', () => {
    expect(applyRadialDeadzone(0.1, 0.1)).toEqual({ x: 0, y: 0 });
    expect(applyRadialDeadzone(0.19, 0)).toEqual({ x: 0, y: 0 });
    const full = applyRadialDeadzone(1, 0);
    expect(full.x).toBeCloseTo(1);
    const mid = applyRadialDeadzone(0.6, 0);
    expect(mid.x).toBeCloseTo(0.5);
    const diag = applyRadialDeadzone(0.5, 0.5);
    expect(Math.atan2(diag.y, diag.x)).toBeCloseTo(Math.PI / 4);
    const over = applyRadialDeadzone(1, 1);
    expect(Math.hypot(over.x, over.y)).toBeCloseTo(1);
    expect(applyRadialDeadzone(Number.NaN, 0.5).x).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// InputManager with a fake event target and fake pads
// ---------------------------------------------------------------------------------------------

function keyEvent(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat, ctrlKey: false, metaKey: false, altKey: false });
}

function mouseEvent(type: 'mousedown' | 'mouseup' | 'mousemove' | 'click', button: number, x = 0, y = 0): Event {
  return Object.assign(new Event(type, { cancelable: true }), { button, clientX: x, clientY: y });
}

class FakePad implements GamepadLike {
  index = 0;
  id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)';
  connected = true;
  mapping = 'standard';
  buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  axes = [0, 0, 0, 0];
  rumbles: unknown[] = [];
  vibrationActuator = {
    playEffect: (type: 'dual-rumble', params: unknown): Promise<unknown> => {
      this.rumbles.push({ type, params });
      return Promise.resolve('complete');
    },
  };
  set(i: number, on: boolean): void {
    this.buttons[i] = { pressed: on, value: on ? 1 : 0 };
  }
}

function setup(opts: { pads?: Array<GamepadLike | null> } = {}) {
  let t = 1000;
  const target = new EventTarget();
  const pads: Array<GamepadLike | null> = opts.pads ?? [];
  const input = new InputManager({ target, doc: null, now: () => t, getGamepads: () => pads });
  return {
    input,
    pads,
    advance: (ms: number) => (t += ms),
    down: (code: string, repeat = false) => target.dispatchEvent(keyEvent('keydown', code, repeat)),
    up: (code: string) => target.dispatchEvent(keyEvent('keyup', code)),
    mouse: (type: 'mousedown' | 'mouseup' | 'mousemove' | 'click', button: number, x = 0, y = 0) =>
      target.dispatchEvent(mouseEvent(type, button, x, y)),
    blur: () => target.dispatchEvent(new Event('blur')),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('InputManager match polling', () => {
  it('maps WASD and arrows to sim-space movement (screen up = -y), normalized', () => {
    const s = setup();
    s.input.pollMatch();
    s.down('KeyW');
    expect(s.input.pollMatch().move).toEqual({ x: 0, y: -1 });
    s.down('KeyD');
    const m = s.input.pollMatch().move;
    expect(m.x).toBeCloseTo(Math.SQRT1_2);
    expect(m.y).toBeCloseTo(-Math.SQRT1_2);
    s.up('KeyW');
    s.up('KeyD');
    s.down('ArrowDown');
    expect(s.input.pollMatch().move).toEqual({ x: 0, y: 1 });
    s.down('ArrowUp');
    expect(s.input.pollMatch().move).toEqual({ x: 0, y: 0 });
  });

  it('latches a tap between polls and reports it once', () => {
    const s = setup();
    s.input.pollMatch();
    s.down('Space');
    s.up('Space');
    const f = s.input.pollMatch();
    expect(f.grabPressed).toBe(true);
    expect(f.grabDown).toBe(false);
    expect(s.input.pollMatch().grabPressed).toBe(false);
  });

  it('ignores OS key repeat for edges', () => {
    const s = setup();
    s.input.pollMatch();
    s.down('ShiftLeft');
    expect(s.input.pollMatch()).toMatchObject({ dashPressed: true, dashDown: true });
    s.down('ShiftLeft', true);
    s.down('ShiftLeft', true);
    expect(s.input.pollMatch()).toMatchObject({ dashPressed: false, dashDown: true });
  });

  it('right mouse pings at the cursor; E pings without a pointer', () => {
    const s = setup();
    s.input.pollMatch();
    s.mouse('mousedown', 2, 640, 360);
    const f = s.input.pollMatch();
    expect(f.pingPressed).toBe(true);
    expect(f.pingAtPointer).toEqual({ clientX: 640, clientY: 360 });
    expect(f.lastDevice).toBe('mouse');
    s.mouse('mouseup', 2);
    s.down('KeyE');
    const g = s.input.pollMatch();
    expect(g.pingPressed).toBe(true);
    expect(g.pingAtPointer).toBeNull();
  });

  it('Escape always pauses, even when pause is rebound', () => {
    const s = setup();
    const b = defaultBindings();
    b.keyboard.pause = ['KeyO'];
    s.input.setBindings(b);
    s.input.pollMatch();
    s.down('Escape');
    expect(s.input.pollMatch().pausePressed).toBe(true);
    s.up('Escape');
    s.down('KeyO');
    expect(s.input.pollMatch().pausePressed).toBe(true);
  });

  it('clears held keys on blur', () => {
    const s = setup();
    s.input.pollMatch();
    s.down('KeyA');
    expect(s.input.pollMatch().move.x).toBe(-1);
    s.blur();
    expect(s.input.pollMatch().move).toEqual({ x: 0, y: 0 });
  });

  it('a button held across a context switch is ignored until released', () => {
    const s = setup();
    // In the pause menu: Space confirms "resume".
    s.input.pollMenu();
    s.down('Space');
    expect(s.input.pollMenu().confirm).toBe(true);
    s.advance(16);
    s.input.pollMenu();
    // Match resumes much later than the last match poll -> reactivation.
    s.advance(1000);
    const f = s.input.pollMatch();
    expect(f.grabDown).toBe(false);
    expect(f.grabPressed).toBe(false);
    s.advance(16);
    expect(s.input.pollMatch().grabDown).toBe(false);
    s.up('Space');
    s.advance(16);
    s.input.pollMatch();
    s.down('Space');
    s.advance(16);
    expect(s.input.pollMatch()).toMatchObject({ grabDown: true, grabPressed: true });
  });

  it('movement held across a context switch keeps working', () => {
    const s = setup();
    s.input.pollMenu();
    s.down('KeyD');
    s.advance(1000);
    expect(s.input.pollMatch().move.x).toBe(1);
  });

  it('a grab held through pause and resume keeps holding (hold mode does not drop the bank)', () => {
    const s = setup();
    const latch = new GrabLatch('hold');
    s.input.pollMatch();
    s.down('Space');
    s.advance(16);
    expect(latch.update(s.input.pollMatch(), false)).toBe(true);
    s.advance(16);
    expect(latch.update(s.input.pollMatch(), true)).toBe(true);
    // Esc pauses; the pause menu runs for a while; Esc again resumes. Space never released.
    s.down('Escape');
    s.advance(16);
    expect(s.input.pollMatch().pausePressed).toBe(true);
    s.up('Escape');
    for (let i = 0; i < 40; i++) {
      s.advance(16);
      s.input.pollMenu();
    }
    s.down('Escape');
    s.advance(16);
    expect(s.input.pollMenu().pause).toBe(true);
    s.advance(16);
    const f = s.input.pollMatch();
    expect(f.grabDown).toBe(true);
    expect(f.grabPressed).toBe(false);
    expect(f.pausePressed).toBe(false); // the resuming Esc is still held: not a new pause
    expect(latch.update(f, true)).toBe(true);
  });

  it('a long frame stall does not release a held grab', () => {
    const s = setup();
    s.input.pollMatch();
    s.down('Space');
    s.advance(16);
    expect(s.input.pollMatch().grabDown).toBe(true);
    s.advance(650); // > reactivateAfterMs, nothing polled in between
    expect(s.input.pollMatch()).toMatchObject({ grabDown: true, grabPressed: false });
  });

  it('a grab key released and pressed again during the pause is a new press (ignored until released)', () => {
    const s = setup();
    s.input.pollMatch();
    s.down('Space');
    s.advance(16);
    s.input.pollMatch();
    s.down('Escape');
    s.advance(16);
    s.input.pollMatch();
    s.up('Escape');
    s.up('Space');
    s.advance(300);
    s.input.pollMenu();
    s.down('Space'); // confirms "Resume" in the pause menu
    s.advance(16);
    expect(s.input.pollMenu().confirm).toBe(true);
    s.advance(16);
    expect(s.input.pollMatch()).toMatchObject({ grabDown: false, grabPressed: false });
  });

  it('a quick pause / resume does not re-pause on the resuming Esc', () => {
    const s = setup();
    s.input.pollMatch();
    s.down('Escape');
    s.advance(16);
    expect(s.input.pollMatch().pausePressed).toBe(true);
    s.up('Escape');
    s.advance(16);
    s.input.pollMenu();
    s.advance(150);
    s.down('Escape');
    s.up('Escape');
    expect(s.input.pollMenu()).toMatchObject({ pause: true, back: true });
    s.advance(16);
    expect(s.input.pollMatch().pausePressed).toBe(false); // well under reactivateAfterMs (500)
  });

  it('keeps edges when a game flow polls both consumers every frame', () => {
    const s = setup();
    for (let i = 0; i < 3; i++) {
      s.advance(16);
      s.input.pollMatch();
      s.input.pollMenu();
    }
    s.down('KeyK');
    s.advance(16);
    expect(s.input.pollMatch()).toMatchObject({ dashPressed: true, dashDown: true });
    s.input.pollMenu();
    s.advance(16);
    expect(s.input.pollMatch().dashDown).toBe(true);
  });

  it('flush() ignores even continuing holds', () => {
    const s = setup();
    s.input.pollMatch();
    s.down('Space');
    s.advance(16);
    expect(s.input.pollMatch().grabDown).toBe(true);
    s.input.flush();
    s.advance(16);
    expect(s.input.pollMatch().grabDown).toBe(false);
    s.up('Space');
    s.down('Space');
    s.advance(16);
    expect(s.input.pollMatch()).toMatchObject({ grabDown: true, grabPressed: true });
  });

  it('a pad button held through pause and resume keeps holding; a fresh one is ignored', () => {
    const pad = new FakePad();
    const s = setup({ pads: [pad] });
    s.input.pollMatch();
    pad.set(0, true); // A: grab
    s.advance(16);
    expect(s.input.pollMatch().grabDown).toBe(true);
    pad.set(9, true); // Start: pause
    s.advance(16);
    expect(s.input.pollMatch().pausePressed).toBe(true);
    pad.set(9, false);
    s.advance(16);
    s.input.pollMenu();
    expect(s.input.pollMenu().confirm).toBe(false); // the held A does not confirm in the menu
    s.advance(200);
    pad.set(9, true);
    expect(s.input.pollMenu().pause).toBe(true);
    s.advance(16);
    expect(s.input.pollMatch()).toMatchObject({ grabDown: true, grabPressed: false, pausePressed: false });
    // Now release A, pause, and resume with A: that A must not grab.
    pad.set(9, false);
    pad.set(0, false);
    s.advance(16);
    s.input.pollMatch();
    s.advance(300);
    s.input.pollMenu();
    pad.set(0, true);
    s.advance(16);
    expect(s.input.pollMenu().confirm).toBe(true);
    s.advance(16);
    expect(s.input.pollMatch().grabDown).toBe(false);
  });
});

describe('InputManager menu polling', () => {
  it('auto-repeats directions after a delay', () => {
    const s = setup();
    s.input.pollMenu();
    s.down('ArrowDown');
    expect(s.input.pollMenu().navDown).toBe(true);
    s.advance(200);
    expect(s.input.pollMenu().navDown).toBe(false);
    s.advance(250); // 450 ms > 400 ms delay
    expect(s.input.pollMenu().navDown).toBe(true);
    s.advance(50);
    expect(s.input.pollMenu().navDown).toBe(false);
    s.advance(50);
    expect(s.input.pollMenu().navDown).toBe(true);
    s.up('ArrowDown');
    s.advance(500);
    expect(s.input.pollMenu().navDown).toBe(false);
  });

  it('confirm / back / tabs are edge-only; any is set for any press', () => {
    const s = setup();
    s.input.pollMenu();
    s.down('Enter');
    expect(s.input.pollMenu()).toMatchObject({ confirm: true, any: true });
    s.advance(500);
    expect(s.input.pollMenu()).toMatchObject({ confirm: false, any: false });
    s.down('Escape');
    expect(s.input.pollMenu()).toMatchObject({ back: true, pause: true });
    s.down('KeyE');
    expect(s.input.pollMenu().tabNext).toBe(true);
    s.down('KeyZ');
    expect(s.input.pollMenu()).toMatchObject({ any: true, confirm: false });
  });
});

describe('InputManager hard-wired pause', () => {
  it('Start / Esc close the pause menu even when pause is rebound', () => {
    const pad = new FakePad();
    const s = setup({ pads: [pad] });
    const b = defaultBindings();
    b.gamepad.pause = ['button:8'];
    b.keyboard.pause = ['KeyO'];
    s.input.setBindings(b);
    s.input.pollMenu();
    pad.set(9, true);
    expect(s.input.pollMenu().pause).toBe(true);
    pad.set(9, false);
    s.input.pollMenu();
    pad.set(8, true);
    expect(s.input.pollMenu().pause).toBe(true);
    pad.set(8, false);
    s.down('Escape');
    expect(s.input.pollMenu().pause).toBe(true);
    s.down('KeyO');
    expect(s.input.pollMenu().pause).toBe(true);
  });
});

describe('InputManager keyboard layout labels', () => {
  const AZERTY: Array<[string, string]> = [
    ['KeyW', 'z'],
    ['KeyA', 'q'],
    ['KeyS', 's'],
    ['KeyD', 'd'],
    ['KeyQ', 'a'],
    ['KeyZ', 'w'],
    ['Digit2', 'é'],
    ['Semicolon', 'm'],
  ];
  const source = (entries: Array<[string, string]>) => ({
    getLayoutMap: () => Promise.resolve({ forEach: (cb: (v: string, k: string) => void) => entries.forEach(([k, v]) => cb(v, k)) }),
  });

  it('labels prompts from the Keyboard Map API (AZERTY: ZQSD)', async () => {
    const target = new EventTarget();
    const input = new InputManager({ target, doc: null, getGamepads: () => [], keyboard: source(AZERTY) });
    const changes: string[] = [];
    input.onDeviceChange(() => changes.push(input.promptGlyph('move').label));
    await input.refreshKeyboardLayout();
    expect(input.promptGlyph('move').label).toBe('ZQSD');
    expect(input.bindingGlyph('keyboard', 'KeyW').label).toBe('Z');
    expect(input.bindingGlyph('keyboard', 'Digit2').label).toBe('É');
    expect(input.bindingGlyph('keyboard', 'Space').label).toBe('Space');
    expect(input.promptGlyph('grab').label).toBe('Space');
    expect(changes).toContain('ZQSD');
    input.dispose();
  });

  it('learns labels from key presses and ignores IME / modified input', () => {
    const target = new EventTarget();
    const input = new InputManager({ target, doc: null, getGamepads: () => [], keyboard: null });
    const key = (code: string, k: string, extra: Record<string, unknown> = {}) =>
      target.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code, key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra }));
    expect(input.bindingGlyph('keyboard', 'KeyW').label).toBe('W');
    key('KeyW', 'ㅈ'); // Korean IME in Hangul mode: keep the Latin legend
    expect(input.bindingGlyph('keyboard', 'KeyW').label).toBe('W');
    key('KeyW', 'Process');
    key('KeyW', 'Z', { shiftKey: true });
    expect(input.bindingGlyph('keyboard', 'KeyW').label).toBe('W');
    key('KeyW', 'z'); // QWERTZ/AZERTY
    expect(input.bindingGlyph('keyboard', 'KeyW').label).toBe('Z');
    key('ShiftLeft', 'Shift');
    expect(input.bindingGlyph('keyboard', 'ShiftLeft').label).toBe('Shift');
    input.dispose();
  });

  it('keeps physical labels when the layout API is unavailable or throws', async () => {
    const input = new InputManager({
      target: new EventTarget(),
      doc: null,
      getGamepads: () => [],
      keyboard: { getLayoutMap: () => Promise.reject(new Error('SecurityError')) },
    });
    expect(await input.refreshKeyboardLayout()).toBe(false);
    expect(input.promptGlyph('move').label).toBe('WASD');
    input.dispose();
  });
});

describe('InputManager gamepads', () => {
  it('is safe without any gamepad API', () => {
    const input = new InputManager({ target: null, doc: null, getGamepads: () => undefined });
    expect(input.pollMatch().move).toEqual({ x: 0, y: 0 });
    expect(input.hasGamepad()).toBe(false);
    expect(input.vibrate(1, 100)).toBe(false);
    const throwing = new InputManager({ target: null, doc: null, getGamepads: () => { throw new Error('blocked'); } });
    expect(throwing.pollMenu().confirm).toBe(false);
  });

  it('reads the left stick with a radial deadzone and the d-pad', () => {
    const pad = new FakePad();
    const s = setup({ pads: [null, pad] });
    pad.axes = [0.1, -0.15, 0, 0];
    expect(s.input.pollMatch().move).toEqual({ x: 0, y: 0 });
    pad.axes = [0, -1, 0, 0];
    const up = s.input.pollMatch().move;
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
    pad.axes = [0, -0.6, 0, 0];
    expect(s.input.pollMatch().move.y).toBeCloseTo(-0.5);
    pad.axes = [0, 0, 0, 0];
    pad.set(15, true); // d-pad right
    expect(s.input.pollMatch().move).toEqual({ x: 1, y: 0 });
    expect(s.input.lastDevice).toBe('gamepad');
  });

  it('A grabs, X or RB dashes, Y pings, Start pauses; B is menu back', () => {
    const pad = new FakePad();
    const s = setup({ pads: [pad] });
    s.input.pollMatch();
    pad.set(0, true);
    expect(s.input.pollMatch()).toMatchObject({ grabPressed: true, grabDown: true });
    expect(s.input.pollMatch()).toMatchObject({ grabPressed: false, grabDown: true });
    pad.set(5, true);
    expect(s.input.pollMatch().dashPressed).toBe(true);
    pad.set(3, true);
    expect(s.input.pollMatch()).toMatchObject({ pingPressed: true, pingAtPointer: null });
    pad.set(9, true);
    expect(s.input.pollMatch().pausePressed).toBe(true);
    for (const i of [0, 3, 5, 9]) pad.set(i, false);
    s.advance(1000);
    s.input.pollMenu();
    pad.set(1, true);
    expect(s.input.pollMenu().back).toBe(true);
  });

  it('switches prompts to the device used last', () => {
    const pad = new FakePad();
    const s = setup({ pads: [pad] });
    const seen: string[] = [];
    s.input.onDeviceChange((_d, g) => seen.push(g));
    s.down('KeyW');
    s.input.pollMatch();
    expect(s.input.promptGlyph('grab').label).toBe('Space');
    pad.set(0, true);
    s.input.pollMatch();
    expect(s.input.glyphDevice).toBe('gamepad');
    expect(s.input.promptGlyph('grab').label).toBe('A');
    expect(s.input.promptGlyph('move').label).toBe('LS');
    s.down('KeyS');
    expect(s.input.promptGlyph('grab').label).toBe('Space');
    expect(seen).toEqual(['gamepad', 'keyboard']);
  });

  it('uses the pad that was pressed last and PlayStation glyphs for it', () => {
    const xbox = new FakePad();
    const ps = new FakePad();
    ps.index = 1;
    ps.id = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
    const s = setup({ pads: [xbox, ps] });
    s.input.pollMatch();
    ps.set(0, true);
    expect(s.input.pollMatch().grabPressed).toBe(true);
    expect(s.input.padFamily).toBe('playstation');
    expect(s.input.promptGlyph('grab').label).toBe('✕');
  });

  it('does not flip between a physical pad and its Steam Input twin reporting the same press', () => {
    const physical = new FakePad();
    physical.id = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
    const virtualPad = new FakePad();
    virtualPad.index = 1;
    virtualPad.id = 'Steam Virtual Gamepad';
    const s = setup({ pads: [physical, virtualPad] });
    let changes = 0;
    s.input.onDeviceChange(() => changes++);
    s.input.pollMatch();
    physical.set(0, true);
    virtualPad.set(0, true);
    expect(s.input.pollMatch().grabPressed).toBe(true);
    const family = s.input.padFamily;
    const before = changes;
    for (let i = 0; i < 10; i++) {
      const f = s.input.pollMatch();
      expect(f.grabDown).toBe(true);
      expect(f.grabPressed).toBe(false);
    }
    expect(s.input.padFamily).toBe(family);
    expect(changes).toBe(before);
  });

  it('ignores extra axes (triggers resting at -1 on non-standard pads)', () => {
    const pad = new FakePad();
    pad.mapping = '';
    pad.axes = [0, 0, 0, 0, -1, -1];
    const s = setup({ pads: [pad] });
    s.input.pollMenu();
    s.advance(16);
    expect(s.input.pollMenu().any).toBe(false);
    expect(s.input.lastDevice).toBe('keyboard');
    expect(s.input.pollMatch().move).toEqual({ x: 0, y: 0 });
  });

  it('vibrates only when enabled', () => {
    const pad = new FakePad();
    const s = setup({ pads: [pad] });
    expect(s.input.vibrate(0.5, 120)).toBe(true);
    expect(pad.rumbles).toHaveLength(1);
    s.input.setVibrationEnabled(false);
    expect(s.input.vibrate(0.5, 120)).toBe(false);
    expect(pad.rumbles).toHaveLength(1);
  });
});

describe('InputManager rebinding', () => {
  it('captures a key, swaps the conflict and reports it', async () => {
    const s = setup();
    const changes: unknown[] = [];
    s.input.onBindingsChange((b) => changes.push(b));
    const p = s.input.startRebind('grab', 'keyboard');
    expect(s.input.isRebinding).toBe(true);
    s.down('KeyK');
    await expect(p).resolves.toBe('KeyK');
    const b = s.input.getBindings();
    expect(b.keyboard.grab[0]).toBe('KeyK');
    expect(b.keyboard.dash).toContain('Space');
    expect(listDuplicateBindings(b)).toEqual([]);
    expect(s.input.lastRebind?.swaps).toEqual([{ action: 'dash', replacement: 'Space' }]);
    expect(changes).toHaveLength(1);
    // The captured key is still held: it must not act in menus or the match.
    expect(s.input.pollMenu().any).toBe(false);
    expect(s.input.pollMatch().grabDown).toBe(false);
  });

  it('Escape cancels and leaves bindings untouched', async () => {
    const s = setup();
    const p = s.input.startRebind('dash', 'keyboard');
    s.down('Escape');
    await expect(p).resolves.toBeNull();
    expect(s.input.getBindings()).toEqual(defaultBindings());
    expect(s.input.isRebinding).toBe(false);
  });

  it('ignores reserved keys and OS repeats while waiting', async () => {
    const s = setup();
    const p = s.input.startRebind('ping', 'keyboard');
    s.down('F11');
    s.down('KeyQ', true);
    expect(s.input.isRebinding).toBe(true);
    s.down('KeyQ');
    await expect(p).resolves.toBe('KeyQ');
  });

  it('swallows input while capturing', () => {
    const s = setup();
    s.input.pollMenu();
    void s.input.startRebind('grab', 'gamepad');
    s.down('Enter');
    expect(s.input.pollMenu().confirm).toBe(false);
    s.input.cancelRebind();
  });

  it('captures a mouse button for the keyboard device', async () => {
    const s = setup();
    const p = s.input.startRebind('grab', 'keyboard');
    s.advance(300);
    s.mouse('mousedown', 0, 10, 10);
    await expect(p).resolves.toBe('Mouse0');
  });

  it('captures a pad button only after the opening press is released', async () => {
    vi.useFakeTimers();
    const pad = new FakePad();
    const s = setup({ pads: [pad] });
    pad.set(0, true); // the A that activated the settings row
    const p = s.input.startRebind('dash', 'gamepad');
    vi.advanceTimersByTime(50);
    expect(s.input.isRebinding).toBe(true);
    pad.set(0, false);
    vi.advanceTimersByTime(20);
    pad.set(4, true); // LB
    vi.advanceTimersByTime(20);
    await expect(p).resolves.toBe('button:4');
    expect(s.input.getBindings().gamepad.dash[0]).toBe('button:4');
  });

  it('captures a stick direction and cancels on Start', async () => {
    vi.useFakeTimers();
    const pad = new FakePad();
    const s = setup({ pads: [pad] });
    const p = s.input.startRebind('moveUp', 'gamepad');
    vi.advanceTimersByTime(20);
    pad.axes = [0.2, -0.9, 0, 0];
    vi.advanceTimersByTime(20);
    await expect(p).resolves.toBe('axis:1:-');
    pad.axes = [0, 0, 0, 0];
    const q = s.input.startRebind('grab', 'gamepad');
    vi.advanceTimersByTime(20);
    pad.set(9, true);
    vi.advanceTimersByTime(20);
    await expect(q).resolves.toBeNull();
  });

  it('times out', async () => {
    vi.useFakeTimers();
    const s = setup();
    const p = s.input.startRebind('grab', 'keyboard', { timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(p).resolves.toBeNull();
  });

  it('resets to defaults per device', () => {
    const s = setup();
    const b = defaultBindings();
    b.keyboard.grab = ['KeyZ'];
    b.gamepad.grab = ['button:7'];
    s.input.setBindings(b);
    const r = s.input.resetBindings('keyboard');
    expect(r.keyboard.grab).toEqual(['Space', 'KeyJ']);
    expect(r.gamepad.grab).toEqual(['button:7']);
    expect(s.input.resetBindings()).toEqual(defaultBindings());
    expect(s.input.bindingRows().find((x) => x.action === 'grab')).toEqual({ action: 'grab', keyboard: 'Space', gamepad: 'button:0' });
  });
});
