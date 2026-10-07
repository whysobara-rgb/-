/**
 * Taunt wheel mouse aiming (owner bug report "도발(T)에 들어가서 마우스 위치를 제대로 못따라온다"):
 * the highlighted slot is the one under the cursor on the DRAWN wheel, measured from the wheel's
 * on-screen center the HUD reports, whatever the cursor did before the wheel opened; the center
 * disc is "no taunt"; a resting cursor pre-selects nothing; the stick / keys keep their rules;
 * left click plays at once; cancel closes.
 */
import { describe, expect, it } from 'vitest';
import { EMOTE_IDS, EmoteWheelController, wheelSlotAngle, type WheelInput } from '../../src/platform/emotes';
import { InputManager } from '../../src/platform/input';
import { BASE_EMOTES } from '../../src/sim/types';

const N = EMOTE_IDS.length;

/** Wheel geometry as the HUD draws it (center, slot radius, center-disc radius), per screen. */
const SCREENS = [
  { name: '1280x720 UI 1.0', cx: 640, cy: 360, slotR: 96, dead: 56 },
  { name: '1920x1080 UI 1.0', cx: 960, cy: 540, slotR: 144, dead: 84 },
  { name: '1280x720 UI 1.25', cx: 640, cy: 360, slotR: 120, dead: 70 },
  { name: '3440x1440 ultrawide (safe area centered)', cx: 1720, cy: 720, slotR: 192, dead: 112 },
];

function slotCenter(i: number, g: (typeof SCREENS)[number]) {
  const a = wheelSlotAngle(i, N);
  return { x: g.cx + Math.sin(a) * g.slotR, y: g.cy - Math.cos(a) * g.slotR };
}

const base = (g: (typeof SCREENS)[number]): WheelInput => ({
  held: true,
  stick: { x: 0, y: 0 },
  keys: { x: 0, y: 0 },
  pointer: null,
  center: { x: g.cx, y: g.cy, dead: g.dead },
  cancel: false,
});

/** Glide the cursor from `from` to `to` in a few steps (what a real mouse reports). */
function glide(w: EmoteWheelController, inp: WheelInput, from: { x: number; y: number }, to: { x: number; y: number }, steps = 6) {
  let out = w.update({ ...inp, pointer: from });
  for (let k = 1; k <= steps; k++) out = w.update({ ...inp, pointer: { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps } });
  return out;
}

describe('taunt wheel: the mouse picks the slot it is on (center-relative)', () => {
  for (const g of SCREENS) {
    const starts = [
      { name: 'center', p: { x: g.cx, y: g.cy } },
      { name: 'top-left corner', p: { x: 40, y: 40 } },
      { name: 'bottom-right corner', p: { x: g.cx * 2 - 50, y: g.cy * 2 - 50 } },
      { name: 'off-center', p: { x: g.cx * 1.5, y: g.cy * 0.6 } },
    ];
    for (const s of starts) {
      it(`${g.name}, opened with the cursor at the ${s.name}: every slot highlights and plays itself`, () => {
        for (let i = 0; i < N; i++) {
          const w = new EmoteWheelController(EMOTE_IDS);
          const inp = base(g);
          w.update({ ...inp, held: false, pointer: s.p });
          w.update({ ...inp, pointer: s.p }); // T goes down with the cursor resting here
          const out = glide(w, inp, s.p, slotCenter(i, g));
          expect(out.hover).toBe(i);
          // anywhere on the slot's sticker (radius ~ 3rem = slotR / 3) still that slot
          const c = slotCenter(i, g);
          for (const [dx, dy] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]] as const) {
            expect(w.update({ ...inp, pointer: { x: c.x + dx * g.slotR, y: c.y + dy * g.slotR } }).hover).toBe(i);
          }
          w.update({ ...inp, pointer: c });
          expect(w.update({ ...inp, held: false, pointer: c }).confirmed).toBe(EMOTE_IDS[i]);
        }
      });
    }
  }

  const g = SCREENS[0]!;

  it('a cursor resting on a slot when the wheel opens pre-selects nothing until it moves', () => {
    const w = new EmoteWheelController(EMOTE_IDS);
    const inp = base(g);
    const on1 = slotCenter(1, g);
    w.update({ ...inp, held: false, pointer: on1 });
    expect(w.update({ ...inp, pointer: on1 }).hover).toBeNull();
    expect(w.update({ ...inp, pointer: { x: on1.x + 2, y: on1.y } }).hover).toBeNull();
    expect(w.update({ ...inp, pointer: { x: on1.x + 8, y: on1.y } }).hover).toBe(1);
    // tap T with a resting cursor: nothing fires
    const w2 = new EmoteWheelController(EMOTE_IDS);
    w2.update({ ...inp, pointer: on1 });
    expect(w2.update({ ...inp, held: false, pointer: on1 }).confirmed).toBeNull();
  });

  it('back on the center disc (or the empty up-left sector) means no taunt: not sticky', () => {
    const w = new EmoteWheelController(EMOTE_IDS);
    const inp = base(g);
    w.update({ ...inp, pointer: { x: g.cx, y: g.cy } });
    expect(glide(w, inp, { x: g.cx, y: g.cy }, slotCenter(1, g)).hover).toBe(1);
    expect(glide(w, inp, slotCenter(1, g), { x: g.cx + g.dead * 0.6, y: g.cy }).hover).toBeNull();
    const upLeft = { x: g.cx - g.slotR * 0.7, y: g.cy - g.slotR * 0.7 };
    expect(glide(w, inp, { x: g.cx, y: g.cy }, upLeft).hover).toBeNull();
    const out = w.update({ ...inp, held: false, pointer: upLeft });
    expect(out.confirmed).toBeNull();
    expect(out.lockedPick).toBeNull();
    expect(out.justClosed).toBe(true);
  });

  it('a stationary mouse never overrides a stick / key pick; moving it again takes over', () => {
    const w = new EmoteWheelController(EMOTE_IDS);
    const inp = base(g);
    const rest = { x: 900, y: 600 };
    w.update({ ...inp, pointer: rest });
    expect(w.update({ ...inp, pointer: rest, stick: { x: -1, y: 0 } }).hover).toBe(3);
    expect(w.update({ ...inp, pointer: rest }).hover).toBe(3); // stick sprang back: sticks
    expect(w.update({ ...inp, pointer: rest, keys: { x: 0, y: -1 } }).hover).toBe(0);
    expect(w.update({ ...inp, pointer: rest }).hover).toBe(0);
    expect(glide(w, inp, rest, slotCenter(2, g)).hover).toBe(2);
    // a fresh stick pick takes over again even with the cursor on another slot
    expect(w.update({ ...inp, pointer: slotCenter(2, g), stick: { x: 1, y: 0 } }).hover).toBe(1);
    expect(w.update({ ...inp, pointer: slotCenter(2, g) }).hover).toBe(1);
    expect(w.update({ ...inp, held: false, pointer: slotCenter(2, g) }).confirmed).toBe('bleh');
  });

  it('left click plays the slot under it at once; no reopen while T is still held', () => {
    const w = new EmoteWheelController(BASE_EMOTES);
    const inp = base(g);
    w.update({ ...inp, pointer: { x: 100, y: 100 } });
    const c = slotCenter(3, g);
    const out = w.update({ ...inp, pointer: c, click: c });
    expect(out.confirmed).toBe('squatBounce');
    expect(out.justClosed).toBe(true);
    expect(w.open).toBe(false);
    expect(w.update({ ...inp, pointer: c }).open).toBe(false);
    expect(w.update({ ...inp, held: false, pointer: c }).confirmed).toBeNull();
    // reopens on the next press
    expect(w.update({ ...inp, pointer: c }).justOpened).toBe(true);
  });

  it('click on a locked gift box shakes it and keeps the wheel open; click on the center closes quietly', () => {
    const w = new EmoteWheelController(BASE_EMOTES);
    const inp = base(g);
    w.update({ ...inp, pointer: { x: g.cx, y: g.cy } });
    const gift = slotCenter(5, g);
    const out = w.update({ ...inp, pointer: gift, click: gift });
    expect(out.lockedPick).toBe('tongkeunFlex');
    expect(out.confirmed).toBeNull();
    expect(out.open).toBe(true);
    expect(out.hover).toBe(5);
    const mid = { x: g.cx, y: g.cy };
    const out2 = w.update({ ...inp, pointer: mid, click: mid });
    expect(out2.justClosed).toBe(true);
    expect(out2.confirmed).toBeNull();
    expect(out2.lockedPick).toBeNull();
  });

  it('releasing over a locked slot never plays it; cancel (grab / dash / pause / right-click) closes without a taunt', () => {
    const w = new EmoteWheelController(BASE_EMOTES);
    const inp = base(g);
    w.update({ ...inp, pointer: { x: g.cx, y: g.cy } });
    glide(w, inp, { x: g.cx, y: g.cy }, slotCenter(6, g));
    const rel = w.update({ ...inp, held: false, pointer: slotCenter(6, g) });
    expect(rel.confirmed).toBeNull();
    expect(rel.lockedPick).toBe('nunchiShrug');
    w.update({ ...inp, pointer: { x: g.cx, y: g.cy } });
    glide(w, inp, { x: g.cx, y: g.cy }, slotCenter(0, g));
    const c = w.update({ ...inp, pointer: slotCenter(0, g), cancel: true });
    expect(c.justClosed).toBe(true);
    expect(c.confirmed).toBeNull();
    expect(w.update({ ...inp, held: false, pointer: slotCenter(0, g) }).confirmed).toBeNull();
  });
});

describe('InputManager: wheel click', () => {
  function mouse(type: 'mousedown' | 'mouseup' | 'mousemove', x: number, y: number, button = 0): Event {
    return Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, button });
  }

  it('a left click is reported once at the press position; the right button is a mouse ping', () => {
    const target = new EventTarget();
    const input = new InputManager({ target, doc: null, now: () => 1000, getGamepads: () => [], keyboard: null, chordKeys: true });
    input.pollMatch();
    target.dispatchEvent(mouse('mousemove', 300, 200));
    target.dispatchEvent(mouse('mousedown', 310, 205));
    target.dispatchEvent(mouse('mousemove', 400, 260));
    const f = input.pollMatch();
    expect(f.wheelClick).toEqual({ clientX: 310, clientY: 205 });
    expect(f.pingAtPointer).toBeNull();
    expect(input.pollMatch().wheelClick).toBeNull();
    target.dispatchEvent(mouse('mouseup', 400, 260));
    target.dispatchEvent(mouse('mousedown', 420, 270, 2));
    const g = input.pollMatch();
    expect(g.wheelClick).toBeNull();
    expect(g.pingAtPointer).toEqual({ clientX: 420, clientY: 270 });
  });
});
