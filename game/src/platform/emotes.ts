/**
 * Taunt emotes on the input side (owner addition): which taunts the player owns, the radial
 * wheel's slot picking, and the per-tick wheel state machine that turns held input into one
 * `Command.emote`. Pure logic (no DOM): game flow feeds it MatchFrames, the HUD draws its state.
 *
 * Wheel layout: eight 45° sectors so every stick direction lands in the middle of one. The four
 * base taunts (always unlocked) sit on the cardinal directions — up, right, down, left, matching
 * keys 1..4 clockwise — and the three rival taunts on the diagonals up-right, down-right and
 * down-left; up-left stays empty. Rival taunts are unlocked only when the save lists them in
 * `cosmetics.unlockedEmotes` (a save without the field owns none). Locked slots can be hovered
 * (the HUD shows a gift box and how to earn it) but never fire.
 *
 * Picking: the pad's stronger stick, the movement keys, or the mouse. A stick / key direction
 * that was already held when the wheel opened (the player was running) is ignored until it goes
 * back to neutral or turns to another slot, so tapping the wheel button while running never fires
 * a taunt by itself. The last stick / key pick sticks when the stick springs back to the middle,
 * so "flick, then let go of LB" works.
 *
 * Mouse: the slot is the one the cursor is on, measured from the wheel's ON-SCREEN center (the HUD
 * reports it, `WheelInput.center`), so the highlight always matches what the player sees, from any
 * cursor position, resolution or UI scale. The mouse takes over only once it has moved a few px
 * (a cursor resting somewhere when the wheel opens pre-selects nothing), and it is not sticky:
 * back on the center disc (or the empty up-left sector) means "no taunt". A stick / key pick
 * belongs to the pad: the mouse takes it back only after a deliberate move
 * (WHEEL_MOUSE_TAKEOVER_PX) onto another slot, never by resting on the center disc. A left click
 * plays the slot under it at once (a locked gift box just shakes; a click on the center closes
 * the wheel); with grab / dash / ping rebound to the left button the click is that action
 * instead (input.ts reports no wheel click, `wheelClickFree`). The press that opens the wheel is
 * never a click (the wheel button itself may be rebound to the left button).
 *
 * Releasing the wheel button confirms; grab / dash / pause / right-click close the wheel without
 * a taunt.
 */
import { BASE_EMOTES, type EmoteId, type EmoteState } from '../sim/types';
import { EMOTE } from '../sim/config';
import type { Vec2 } from '../sim/types';
import { EMOTE_IDS } from './save';

export { EMOTE_IDS };

/** Rival taunts in wheel order (slots 5–7), unlocked by beating that rival. */
export const RIVAL_EMOTES: readonly EmoteId[] = ['hodadakZoom', 'tongkeunFlex', 'nunchiShrug'];

/** The rival each rival taunt belongs to (unlock hint on the wheel). */
export const EMOTE_RIVAL: Readonly<Partial<Record<EmoteId, 'hodadak' | 'tongkeun' | 'nunchi'>>> = {
  hodadakZoom: 'hodadak',
  tongkeunFlex: 'tongkeun',
  nunchiShrug: 'nunchi',
};

/** Stick / key travel that picks a slot. */
export const WHEEL_PICK_DEADZONE = 0.5;
/** Mouse deadzone (CSS px) around the wheel center when the HUD does not report its center disc. */
export const WHEEL_POINTER_PX = 28;
/** Mouse travel (CSS px) before the mouse takes over the pick (a resting cursor picks nothing). */
export const WHEEL_MOUSE_WAKE_PX = 4;

/** Match actions that close the wheel; while one sits on the left mouse button, a click is that action (no click-to-play). */
export const WHEEL_CLICK_BLOCKERS = ['grab', 'dash', 'ping'] as const;

/** Left click may play a wheel slot: Mouse0 is not bound to an action that closes the wheel. */
export function wheelClickFree(keyboard: { readonly [A in (typeof WHEEL_CLICK_BLOCKERS)[number]]?: readonly string[] }): boolean {
  return !WHEEL_CLICK_BLOCKERS.some((a) => (keyboard[a] ?? []).includes('Mouse0'));
}

/** Mouse travel (CSS px) before the mouse takes back a pick the stick / keys made (a bumped desk is not a pick). */
export const WHEEL_MOUSE_TAKEOVER_PX = 24;

/**
 * Client mirror of the sim's taunt cooldown (sim/emotes.ts `emoteReadyTick` = end / cancel tick +
 * EMOTE.cooldownTicks), so the chip says "catching my breath" exactly while the sim would refuse a
 * press, never a tick longer. `tick` is sim.state.tick before the next step (the sim runs that
 * command at tick + 1: it increments state.tick before processCommands), `live` the character's
 * taunt now, `endedTick` when the last one ended or was cancelled (`tauntEndedTick`).
 */
export function tauntCoolingAt(tick: number, live: EmoteState | null | undefined, endedTick: number): boolean {
  // a live taunt is never replaced (even one ending on the next tick: its cooldown starts right there)
  if (live) return true;
  return tick + 1 < endedTick + EMOTE.cooldownTicks;
}

/**
 * Follow the tick the last taunt ended, called after every sim step with the taunt before (`prev`)
 * and after (`now`) it: a cancel ends it on that step's tick, a natural end on its endTick.
 */
export function tauntEndedTick(prev: EmoteState | null, now: EmoteState | null, tick: number, endedTick: number): number {
  if (prev && (!now || now.startTick !== prev.startTick)) return Math.min(tick, prev.endTick);
  if (now && tick >= now.endTick && endedTick < now.endTick) return now.endTick;
  return endedTick;
}

/** Taunts the player owns: the four base ones plus every rival taunt listed in the save. */
export function unlockedEmotes(cosmetics: { readonly unlockedEmotes?: readonly string[] | null } | null | undefined): EmoteId[] {
  const extra = new Set((cosmetics?.unlockedEmotes ?? []).filter((x): x is string => typeof x === 'string'));
  return EMOTE_IDS.filter((id) => BASE_EMOTES.includes(id) || extra.has(id));
}

/** Center angles (degrees, clockwise from up) of the seven taunt slots, in EMOTE_IDS order. */
const SEVEN_SLOT_DEG: readonly number[] = [0, 90, 180, 270, 45, 135, 225];

/** Center angles (radians, clockwise from up) of a wheel with `slots` slots. */
export function wheelSlotAngles(slots: number): number[] {
  const n = Math.max(1, Math.floor(slots));
  if (n === SEVEN_SLOT_DEG.length) return SEVEN_SLOT_DEG.map((d) => (d * Math.PI) / 180);
  return Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2);
}

/** Half the angular width of one slot's sector (radians). */
function halfSector(n: number): number {
  return n === SEVEN_SLOT_DEG.length ? Math.PI / 8 : Math.PI / n;
}

/**
 * Slot under a direction (screen space, +y down), see the layout in the header. Null when the
 * direction is shorter than `deadzone` (or not finite), or points into the empty sector.
 */
export function wheelSlotAt(dir: Vec2, slots: number, deadzone = WHEEL_PICK_DEADZONE): number | null {
  const n = Math.max(1, Math.floor(slots));
  const x = Number.isFinite(dir.x) ? dir.x : 0;
  const y = Number.isFinite(dir.y) ? dir.y : 0;
  if (Math.hypot(x, y) < deadzone || (x === 0 && y === 0)) return null;
  // Clockwise angle from "up" in [0, 2π).
  let a = Math.atan2(x, -y);
  if (a < 0) a += Math.PI * 2;
  const angles = wheelSlotAngles(n);
  const half = halfSector(n);
  for (let i = 0; i < n; i++) {
    // Signed distance in [-π, π); half-open sectors so a boundary belongs to exactly one slot.
    let d = a - angles[i]!;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (d >= -half && d < half) return i;
  }
  return null;
}

/** Center angle of a slot (radians, clockwise from up) — the HUD lays the wheel out with it. */
export function wheelSlotAngle(slot: number, slots: number): number {
  return wheelSlotAngles(slots)[Math.max(0, Math.floor(slot))] ?? 0;
}

export interface WheelInput {
  /** The wheel button is held. */
  held: boolean;
  /** Pad stick (screen space, deadzone applied). */
  stick: Vec2;
  /** Movement keys (screen space). */
  keys: Vec2;
  /** Cursor position (client px), when known. */
  pointer: { x: number; y: number } | null;
  /**
   * The drawn wheel's center (client px) and the radius of its center disc (the mouse deadzone),
   * from the HUD. Without it the mouse measures from where the cursor was when the wheel opened.
   */
  center?: { x: number; y: number; dead: number } | null;
  /** Left click this tick (client px): plays the slot under it right away. */
  click?: { x: number; y: number } | null;
  /** Grab / dash / pause / right-click pressed: close without a taunt. */
  cancel: boolean;
}

export interface WheelStep {
  open: boolean;
  /** Hovered slot (index into EMOTE_IDS), or null. */
  hover: number | null;
  /** A taunt to send this tick (the wheel was released over an unlocked slot). */
  confirmed: EmoteId | null;
  /** Released over a locked slot (the HUD can wiggle the gift box). */
  lockedPick: EmoteId | null;
  justOpened: boolean;
  justClosed: boolean;
}

export class EmoteWheelController {
  private openValue = false;
  private hoverValue: number | null = null;
  private wasHeld = false;
  private origin: { x: number; y: number } | null = null;
  /** Where the cursor was when the mouse last went idle (open, or a stick / key pick). */
  private mouseAnchor: { x: number; y: number } | null = null;
  /** The mouse drives the hover (it moved since the wheel opened / since the last stick pick). */
  private mouseActive = false;
  /** The current hover came from the stick / keys (the mouse needs a real move to take it back). */
  private padPick = false;
  /** Slot the stick / keys already pointed at when the wheel opened (ignored until it changes). */
  private staleStick: number | null = null;
  private staleKeys: number | null = null;
  private unlocked: ReadonlySet<EmoteId>;

  constructor(unlocked: readonly EmoteId[] = BASE_EMOTES) {
    this.unlocked = new Set(unlocked);
  }

  get open(): boolean {
    return this.openValue;
  }

  get hover(): number | null {
    return this.hoverValue;
  }

  setUnlocked(ids: readonly EmoteId[]): void {
    this.unlocked = new Set(ids);
  }

  isUnlocked(id: EmoteId): boolean {
    return this.unlocked.has(id);
  }

  /** Close without a taunt (pause, match end). The button must be released before reopening. */
  close(): void {
    this.openValue = false;
    this.hoverValue = null;
    this.origin = null;
    this.mouseAnchor = null;
    this.mouseActive = false;
    this.padPick = false;
    this.staleStick = this.staleKeys = null;
  }

  /** Slot under a cursor position on the drawn wheel (null: center disc, empty sector, unknown). */
  private mouseSlot(p: { x: number; y: number }, inp: WheelInput): number | null {
    const c = inp.center ?? (this.origin ? { ...this.origin, dead: WHEEL_POINTER_PX } : null);
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
    const dead = Number.isFinite(c.dead) && c.dead > 0 ? c.dead : WHEEL_POINTER_PX;
    return wheelSlotAt({ x: p.x - c.x, y: p.y - c.y }, EMOTE_IDS.length, dead);
  }

  /** Play (or, for a gift box, shake) a slot and close; null closes without a taunt. */
  private finish(slot: number | null, out: WheelStep): WheelStep {
    const id = slot !== null ? EMOTE_IDS[slot] : undefined;
    if (id !== undefined) {
      if (this.unlocked.has(id)) out.confirmed = id;
      else out.lockedPick = id;
    }
    this.close();
    out.justClosed = true;
    return out;
  }

  /** A direction held since the wheel opened counts only once it went neutral or changed slot. */
  private fresh(slot: number | null, which: 'staleStick' | 'staleKeys'): number | null {
    const stale = this[which];
    if (stale === null) return slot;
    if (slot === stale) return null;
    this[which] = null;
    return slot;
  }

  update(inp: WheelInput): WheelStep {
    const n = EMOTE_IDS.length;
    const out: WheelStep = { open: false, hover: null, confirmed: null, lockedPick: null, justOpened: false, justClosed: false };
    const rising = inp.held && !this.wasHeld;
    this.wasHeld = inp.held;
    if (!this.openValue && rising && !inp.cancel) {
      this.openValue = true;
      this.hoverValue = null;
      this.origin = inp.pointer ? { ...inp.pointer } : null;
      this.mouseAnchor = this.origin;
      this.mouseActive = false;
      this.padPick = false;
      this.staleStick = wheelSlotAt(inp.stick, n);
      this.staleKeys = wheelSlotAt(inp.keys, n);
      out.justOpened = true;
    }
    if (!this.openValue) return out;
    if (inp.cancel) {
      this.close();
      out.justClosed = true;
      return out;
    }
    // Pick: stick, then keys (each only when deliberately pushed; the last pick sticks), then the
    // mouse once it moved (the slot under the cursor on the drawn wheel; not sticky).
    let pick = this.fresh(wheelSlotAt(inp.stick, n), 'staleStick');
    const keyPick = this.fresh(wheelSlotAt(inp.keys, n), 'staleKeys');
    if (pick === null) pick = keyPick;
    const p = inp.pointer;
    if (p && !this.origin) this.origin = { ...p };
    if (p && !this.mouseAnchor) this.mouseAnchor = { ...p };
    if (pick !== null) {
      this.hoverValue = pick;
      // the stick / keys took over: the mouse waits until it moves again
      this.mouseActive = false;
      this.padPick = true;
      this.mouseAnchor = p ? { ...p } : null;
    } else if (p) {
      const a = this.mouseAnchor!;
      // a resting cursor wakes after a few px; after a stick / key pick it takes a deliberate move
      // (a bumped mouse or desk must not steal the pad player's pick)
      const wake = this.padPick ? WHEEL_MOUSE_TAKEOVER_PX : WHEEL_MOUSE_WAKE_PX;
      if (!this.mouseActive && Math.hypot(p.x - a.x, p.y - a.y) > wake) this.mouseActive = true;
      if (this.mouseActive) {
        const m = this.mouseSlot(p, inp);
        // the center disc / empty sector clears only a mouse pick, never a stick / key one
        if (m !== null || !this.padPick) {
          this.hoverValue = m;
          this.padPick = false;
        }
      }
    }
    // Left click: play the slot under the click at once (a gift box shakes and the wheel stays).
    // Not on the poll that opened the wheel: that press is the one that opened it (the wheel button
    // itself may sit on Mouse0) or came before the wheel was even drawn.
    if (inp.click && !out.justOpened) {
      const slot = this.mouseSlot(inp.click, inp);
      const id = slot !== null ? EMOTE_IDS[slot] : undefined;
      if (id !== undefined && !this.unlocked.has(id)) {
        this.hoverValue = slot;
        this.mouseActive = true;
        this.padPick = false;
        out.lockedPick = id;
      } else return this.finish(slot, out);
    }
    if (!inp.held) return this.finish(this.hoverValue, out);
    out.open = true;
    out.hover = this.hoverValue;
    return out;
  }
}
