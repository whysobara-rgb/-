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
 * Picking: the pad's stronger stick, the movement keys, or the mouse moved away from where it was
 * when the wheel opened. A stick / key direction that was already held when the wheel opened
 * (the player was running) is ignored until it goes back to neutral or turns to another slot, so
 * tapping the wheel button while running never fires a taunt by itself. The last pick sticks when
 * the stick springs back to the middle, so "flick, then let go of LB" works. Releasing the wheel
 * button confirms; grab / dash / pause close the wheel without a taunt.
 */
import { BASE_EMOTES, type EmoteId } from '../sim/types';
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
/** Mouse travel (CSS px from where the wheel opened) that picks a slot. */
export const WHEEL_POINTER_PX = 28;

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
  /** Grab / dash / pause pressed: close without a taunt. */
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
    this.staleStick = this.staleKeys = null;
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
    // Pick: stick, then keys, then the mouse (each only when deliberately pushed).
    let pick = this.fresh(wheelSlotAt(inp.stick, n), 'staleStick');
    const keyPick = this.fresh(wheelSlotAt(inp.keys, n), 'staleKeys');
    if (pick === null) pick = keyPick;
    if (pick === null && inp.pointer) {
      if (!this.origin) this.origin = { ...inp.pointer };
      pick = wheelSlotAt({ x: inp.pointer.x - this.origin.x, y: inp.pointer.y - this.origin.y }, n, WHEEL_POINTER_PX);
    }
    if (pick !== null) this.hoverValue = pick;
    if (!inp.held) {
      const id = this.hoverValue !== null ? EMOTE_IDS[this.hoverValue] : undefined;
      if (id !== undefined) {
        if (this.unlocked.has(id)) out.confirmed = id;
        else out.lockedPick = id;
      }
      this.close();
      out.justClosed = true;
      return out;
    }
    out.open = true;
    out.hover = this.hoverValue;
    return out;
  }
}
