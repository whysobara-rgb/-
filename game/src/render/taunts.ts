/**
 * Taunt playback state for the view (owner addition): which taunt each raccoon is playing, how
 * far in it is, where it should face, and when it started / stopped (bubble pop, particles).
 *
 * Sources, so the view lights up as soon as the sim plays taunts:
 *  - `CharacterState.emote` (authoritative when the sim sets the field): a taunt is playing
 *    while `tick < endTick`; it ends early when the field clears or a new one replaces it;
 *  - the 'emote' event (start + `nearOpponentId`, "in front of a rival") and 'emoteCancel';
 *    with no state field at all, the event alone starts a taunt of the nominal length.
 * Whatever the source, the view stops a taunt itself the moment the raccoon grabs, dashes, is
 * knocked down or moves (EMOTE.cancelMove), so a stale state can never freeze a pose.
 *
 * Facing: toward the rival the event names (or, without one, the nearest opponent the view can
 * see within EMOTE.nearOpponentRadius); the butt wiggle turns its back to that rival instead.
 * No rival around: the raccoon keeps its facing. When the view knows where its camera is
 * (`TauntWorld.cameraDir`), the face taunts never turn the face more than TAUNT_FACE_MAX_OFF away
 * from the camera (a rival "up" the screen would otherwise hide the tongue, the fan or the flex
 * behind the back of the head: the raccoon turns to a 3/4 view toward the rival instead), and a
 * wiggle with nobody in front shakes its bottom at the camera (looking back over the shoulder).
 *
 * Pure logic (no three.js): unit-tested with mocked character states.
 */
import type { CharacterState, EmoteId, EntityId, SimEvent, Vec2 } from '../sim/types';
import { EMOTE, TICK_RATE } from '../sim/config';

export interface TauntSample {
  id: EmoteId;
  /** Seconds since the taunt started (frozen at the cancel moment once stopped). */
  t: number;
  /** Total length (s). */
  dur: number;
  /** World facing (sim angle) the body should turn to, or null to keep its own. */
  facing: number | null;
  /** The rival it is aimed at (null: nobody in front). */
  targetId: EntityId | null;
}

export interface TauntChange {
  charId: EntityId;
  id: EmoteId;
  kind: 'start' | 'stop';
  /** 'stop' only: ended before its time (cancel) rather than finishing. */
  cancelled?: boolean;
}

interface Entry {
  id: EmoteId;
  startTick: number;
  endTick: number;
  targetId: EntityId | null;
  /** Started from an event without a state field. */
  fromEvent: boolean;
  live: boolean;
}

interface PendingEvent {
  id: EmoteId;
  tick: number;
  nearOpponentId: EntityId | null;
}

/** Opponent lookup the tracker asks for (view: positions + line of sight). */
export interface TauntWorld {
  /** Position of a character, or null when gone. */
  posOf(id: EntityId): Vec2 | null;
  /** Nearest opponent of `c` within EMOTE.nearOpponentRadius it can see, or null. */
  nearestOpponent(c: CharacterState): EntityId | null;
  /** Ground-plane direction (sim x/y, any length) from `c` toward the camera, or null if unknown. */
  cameraDir?(c: CharacterState): Vec2 | null;
}

/** Most a face taunt turns its face away from the camera (rad): a clear 3/4 view at worst. */
export const TAUNT_FACE_MAX_OFF = (50 * Math.PI) / 180;

/** Wrap an angle to [-π, π). */
const wrapPi = (a: number): number => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

/** `a` turned toward `k` until it is at most `max` away from it. */
function clampToward(a: number, k: number, max: number): number {
  const d = wrapPi(a - k);
  return k + Math.max(-max, Math.min(max, d));
}

const durationTicks = (id: EmoteId): number => EMOTE.durationTicks[id] ?? Math.round(1.4 * TICK_RATE);

export function isEmoteId(x: unknown): x is EmoteId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(EMOTE.durationTicks, x);
}

/** True when the character is doing something that stops a taunt right away. */
export function tauntBlocked(c: CharacterState): boolean {
  if (c.grab || c.dashTicks > 0 || c.knockdownTicks > 0 || c.boostTicks > 0) return true;
  return Math.hypot(c.moveIntent?.x ?? 0, c.moveIntent?.y ?? 0) > EMOTE.cancelMove;
}

export class TauntTracker {
  private readonly entries = new Map<EntityId, Entry>();
  private readonly pending = new Map<EntityId, PendingEvent>();
  private readonly cancels = new Set<EntityId>();
  private changes: TauntChange[] = [];

  /** Feed sim events (start / cancel). */
  onEvent(e: SimEvent): void {
    if (e.type === 'emote') {
      if (!isEmoteId(e.emoteId)) return;
      this.pending.set(e.charId, { id: e.emoteId, tick: e.tick, nearOpponentId: e.nearOpponentId ?? null });
      this.cancels.delete(e.charId);
    } else if (e.type === 'emoteCancel') {
      this.cancels.add(e.charId);
      this.pending.delete(e.charId);
    }
  }

  /** Starts / stops since the last call (bubble pops, particles, tests). */
  takeChanges(): TauntChange[] {
    const out = this.changes;
    this.changes = [];
    return out;
  }

  /** The taunt a character is playing right now, or null (no sampling side effects). */
  current(charId: EntityId): EmoteId | null {
    const e = this.entries.get(charId);
    return e && e.live ? e.id : null;
  }

  /** The live taunt of a character with its end tick, or null. */
  playing(charId: EntityId): { id: EmoteId; endTick: number } | null {
    const e = this.entries.get(charId);
    return e && e.live ? { id: e.id, endTick: e.endTick } : null;
  }

  /**
   * Advance one character and return what it should show. `tickF` is the presentation tick
   * (sim tick + interpolation fraction).
   */
  update(c: CharacterState, tickF: number, world: TauntWorld): TauntSample | null {
    const tick = Math.floor(tickF);
    let entry = this.entries.get(c.id);
    const state = c.emote;
    const hasField = state !== undefined;
    const pend = this.pending.get(c.id);

    // --- start ---------------------------------------------------------------------------
    let want: { id: EmoteId; startTick: number; endTick: number; fromEvent: boolean } | null = null;
    if (hasField && state && isEmoteId(state.id) && tick < state.endTick) {
      want = { id: state.id, startTick: state.startTick, endTick: state.endTick, fromEvent: false };
    } else if (!hasField && pend) {
      want = { id: pend.id, startTick: pend.tick, endTick: pend.tick + durationTicks(pend.id), fromEvent: true };
    }
    if (want && !(entry && entry.startTick === want.startTick && entry.id === want.id)) {
      // A different (or first) taunt: replace whatever played.
      if (entry && entry.live) this.stop(c.id, entry, true);
      if (tick >= want.endTick) want = null;
      else {
        let target: EntityId | null = null;
        if (pend && pend.id === want.id && Math.abs(pend.tick - want.startTick) <= 2) target = pend.nearOpponentId;
        else target = world.nearestOpponent(c);
        entry = { id: want.id, startTick: want.startTick, endTick: want.endTick, targetId: target, fromEvent: want.fromEvent, live: true };
        this.entries.set(c.id, entry);
        this.pending.delete(c.id);
        this.changes.push({ charId: c.id, id: entry.id, kind: 'start' });
      }
    } else if (pend && entry && pend.tick <= entry.startTick + 2 && pend.id === entry.id) {
      // The event of the taunt already started from the state: take its rival.
      if (pend.nearOpponentId !== null) entry.targetId = pend.nearOpponentId;
      this.pending.delete(c.id);
    }
    if (!entry || !entry.live) {
      this.cancels.delete(c.id);
      return null;
    }

    // --- stop ----------------------------------------------------------------------------
    const ended = tick >= entry.endTick;
    const cleared = !entry.fromEvent && hasField && (!state || state.startTick !== entry.startTick);
    const cancelled = this.cancels.has(c.id) || tauntBlocked(c);
    this.cancels.delete(c.id);
    if (ended || cleared || cancelled) {
      this.stop(c.id, entry, !ended);
      return null;
    }

    const dur = (entry.endTick - entry.startTick) / TICK_RATE;
    const t = Math.min(dur, Math.max(0, (tickF - entry.startTick) / TICK_RATE));
    let facing: number | null = null;
    const tp = entry.targetId !== null ? world.posOf(entry.targetId) : null;
    if (tp) {
      const a = Math.atan2(tp.y - c.pos.y, tp.x - c.pos.x);
      facing = entry.id === 'wiggle' ? a + Math.PI : a;
    }
    const cam = world.cameraDir?.(c) ?? null;
    if (cam && Number.isFinite(cam.x) && Number.isFinite(cam.y) && Math.hypot(cam.x, cam.y) > 1e-6) {
      const k = Math.atan2(cam.y, cam.x);
      // the wiggle with a rival keeps its back to the rival (bottom or face over the shoulder:
      // either way the joke reads); with nobody in front it wiggles at the camera
      if (entry.id !== 'wiggle') facing = clampToward(facing ?? c.facing, k, TAUNT_FACE_MAX_OFF);
      else if (!tp) facing = clampToward(c.facing, k + Math.PI, TAUNT_FACE_MAX_OFF);
    }
    return { id: entry.id, t, dur, facing, targetId: entry.targetId };
  }

  /** A character left the view (despawn / reload): forget it silently. */
  forget(charId: EntityId): void {
    this.entries.delete(charId);
    this.pending.delete(charId);
    this.cancels.delete(charId);
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
    this.cancels.clear();
    this.changes = [];
  }

  private stop(charId: EntityId, entry: Entry, cancelled: boolean): void {
    entry.live = false;
    this.changes.push({ charId, id: entry.id, kind: 'stop', cancelled });
  }
}
