/**
 * Taunt step (owner addition, "taunts part 2" / WP2's emote step). Cosmetic only: it sets
 * `CharacterState.emote` and emits 'emote' / 'emoteCancel' events, and nothing in the sim ever
 * reads `ch.emote` back for physics, scoring, police, recovery, items or coins.
 *
 * Rules (deterministic, pure function of state + commands):
 *  - `Command.emote` is a one-shot request. It starts a taunt when the raccoon is not holding,
 *    not dashing / boosting, not knocked down or dizzy, not asking to grab, not starting a dash
 *    this tick, not moving (|move| <= EMOTE.cancelMove), not already taunting, and off cooldown
 *    (EMOTE.cooldownTicks after the previous taunt ended or was cancelled). A request that cannot
 *    start is dropped (never queued).
 *  - Start: `emote = { id, startTick: tick, endTick: tick + EMOTE.durationTicks[id] }` and an
 *    'emote' event with `nearOpponentId` = the nearest opponent raccoon within
 *    EMOTE.nearOpponentRadius in line of sight (ties: the lower slot), else null.
 *  - Cancel (an 'emoteCancel' event with its cause): move input above EMOTE.cancelMove ('move'),
 *    the grab signal ('grab'), a dash / boost / item-dash edge ('dash'), a knockdown or a dizzy
 *    pull ('hit'; `hitBy` = the opposing raccoon for a dash knockdown, else null), and the match
 *    ending (no cause).
 *  - At `tick >= endTick` the taunt clears on its own, without an event.
 */
import { EMOTE } from './config';
import { emit, type SimContext } from './context';
import { lineOfSight } from './queries';
import type { Command, EmoteCancelCause, EmoteId, EntityId, KnockdownCause } from './types';

/** A valid taunt id (an own key of EMOTE.durationTicks). */
export function isEmoteId(x: unknown): x is EmoteId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(EMOTE.durationTicks, x);
}

/** Nearest opponent raccoon within EMOTE.nearOpponentRadius in line of sight, else null. */
export function nearestTauntTarget(ctx: SimContext, slot: number): EntityId | null {
  const st = ctx.state;
  const me = st.characters[slot]!;
  let best: EntityId | null = null;
  let bestD2 = EMOTE.nearOpponentRadius * EMOTE.nearOpponentRadius;
  for (let i = 0; i < st.characters.length; i++) {
    const o = st.characters[i]!;
    if (i === slot || o.team === me.team) continue;
    const dx = o.pos.x - me.pos.x;
    const dy = o.pos.y - me.pos.y;
    const d2 = dx * dx + dy * dy;
    // strictly closer wins: equal distances keep the lower slot
    if (d2 > bestD2 || (best !== null && d2 >= bestD2)) continue;
    if (!lineOfSight(ctx, me.pos, o.pos)) continue;
    best = o.id;
    bestD2 = d2;
  }
  return best;
}

/** Stop a live taunt early: event + cooldown. No-op without one. */
export function cancelEmote(ctx: SimContext, slot: number, cause: EmoteCancelCause | null, hitBy?: EntityId | null): void {
  const ch = ctx.state.characters[slot]!;
  const em = ch.emote;
  if (!em) return;
  const tick = ctx.state.tick;
  ch.emote = null;
  ctx.chars[slot]!.emoteReadyTick = tick + EMOTE.cooldownTicks;
  emit(ctx, {
    type: 'emoteCancel',
    tick,
    charId: ch.id,
    emoteId: em.id,
    ...(cause !== null ? { cause } : {}),
    ...(cause === 'hit' ? { hitBy: hitBy ?? null } : {}),
  });
}

/** Knockdown hook (actions.knockDown, every source): a taunting victim stops with cause 'hit'. */
export function cancelEmoteOnKnockdown(ctx: SimContext, slot: number, cause: KnockdownCause, byId: EntityId | null): void {
  const ch = ctx.state.characters[slot]!;
  if (!ch.emote) return;
  let hitBy: EntityId | null = null;
  if (cause === 'dash' && byId !== null) {
    const att = ctx.state.characters.find((c) => c.id === byId);
    if (att && att.team !== ch.team) hitBy = byId;
  }
  cancelEmote(ctx, slot, 'hit', hitBy);
}

/**
 * Phase 1 (processCommands, once per character per tick, before grab / dash run): expire, cancel
 * and start. `cmd` is the sanitised command the character obeys this tick (EMPTY_COMMAND while
 * knocked down), `risingDash` the dash button's rising edge.
 */
export function stepEmote(ctx: SimContext, slot: number, cmd: Command, risingDash: boolean): void {
  const st = ctx.state;
  const ch = st.characters[slot]!;
  const rt = ctx.chars[slot]!;
  if (ch.emote === undefined) ch.emote = null;
  const tick = st.tick;
  // finish on its own
  if (ch.emote && tick >= ch.emote.endTick) {
    rt.emoteReadyTick = ch.emote.endTick + EMOTE.cooldownTicks;
    ch.emote = null;
  }
  const knocked = ch.knockdownTicks > 0 || (ch.dizzyTicks ?? 0) > 0;
  const moving = Math.hypot(cmd.move.x, cmd.move.y) > EMOTE.cancelMove;
  const busy = ch.grab !== null || ch.dashTicks > 0 || ch.boostTicks > 0;
  // cancel
  if (ch.emote) {
    if (knocked) cancelEmote(ctx, slot, 'hit', null);
    else if (risingDash || busy) cancelEmote(ctx, slot, ch.grab !== null && !risingDash ? 'grab' : 'dash');
    else if (cmd.grab) cancelEmote(ctx, slot, 'grab');
    else if (moving) cancelEmote(ctx, slot, 'move');
  }
  // start
  const id = cmd.emote;
  if (!isEmoteId(id) || ch.emote || knocked || busy || cmd.grab || risingDash || moving) return;
  if (tick < rt.emoteReadyTick) return;
  ch.emote = { id, startTick: tick, endTick: tick + EMOTE.durationTicks[id] };
  emit(ctx, { type: 'emote', tick, charId: ch.id, emoteId: id, nearOpponentId: nearestTauntTarget(ctx, slot) });
}

/** After the end check: a taunt still playing when the match ends stops (no cause). */
export function endEmotes(ctx: SimContext): void {
  const st = ctx.state;
  for (let slot = 0; slot < st.characters.length; slot++) {
    const ch = st.characters[slot]!;
    if (!ch.emote) continue;
    if (st.tick >= ch.emote.endTick) {
      ch.emote = null;
      continue;
    }
    cancelEmote(ctx, slot, null);
  }
}
