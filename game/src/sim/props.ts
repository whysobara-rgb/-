/**
 * [C3] Props: 동전 ATM, 대왕 돼지저금통, 돈나무, 황금 금고 body (content-plan §3.1, §5.1).
 * Day-0 skeleton by C0: no-op PropSystem hooks, the `buildProps` buildV2 callback and the frozen
 * `addUnanchorProgress` helper (used by hammer C2, plunger C2, stomper C4, quake C5).
 */
import { setLootFree } from './actions';
import { emit, lootById, type SimContext } from './context';
import { ContentSystemBase } from './systemBase';
import type { EntityId, LayoutV2Def, TeamId, Vec2 } from './types';

/**
 * buildV2 callback [C3]: append one prop loot per LayoutV2Def.props entry (ids right after the
 * v2 safes, via appendLoot in world.ts), kind = PROP_SPECS[variant].kind, baseValue = shell,
 * innerValue = Σ inner piles, estimatedValue = shell + innerValue; free-standing props
 * (uprootTicks 0, the piggy) start unanchored. Runs first, before breakables.
 */
export function buildProps(_ctx: SimContext, _v2: LayoutV2Def): void {
  // C3
}

/**
 * Add `amount` of uproot progress (a fraction of the item's uproot time: hammer small 1.0 /
 * large 0.5 / bank 0.25, stomper 0.35, quake 0.5, …) to an anchored, unrecovered, non-dormant
 * loot item. On reaching 1 the item is freed exactly like a pull and the existing `unanchored`
 * event is emitted (byTeam = the team of `byCharId`, null for hazards). Returns true if freed.
 * C3 extends this (ATM spurt thresholds); callers never touch unanchorProgress directly.
 */
export function addUnanchorProgress(ctx: SimContext, lootId: EntityId, amount: number, byCharId: EntityId | null): boolean {
  const r = lootById(ctx, lootId);
  if (!r) return false;
  const l = r.state;
  if (!l.anchored || l.recovered || l.dormant || !(amount > 0)) return false;
  l.unanchorProgress = Math.min(1, l.unanchorProgress + amount);
  if (l.unanchorProgress < 1 - 1e-9) return false;
  setLootFree(ctx, ctx.lootIndex.get(lootId)!);
  for (const cid of l.grabbedBy) {
    const ch = ctx.state.characters[cid - 1];
    if (ch) ch.straining = false;
  }
  const by = byCharId !== null ? ctx.state.characters[byCharId - 1] : undefined;
  const byTeam: TeamId | null = by ? by.team : null;
  emit(ctx, { type: 'unanchored', tick: ctx.state.tick, lootId: l.id, kind: l.kind, byTeam });
  return true;
}

/**
 * [C3] Send loot on a fixed flight (catapult / tube / crane / parachute): disables its body,
 * sets `LootState.airborne` { fromTick: now, toTick: now + ticks, from, to, via } and releases
 * every holder; while flying it moves the disabled body's pose along the fixed arc each tick (so
 * `l.pos` = ground position of the flight, height derivable from `airborne`; stabilize skips it);
 * on `toTick` re-enables the body at `to` or the nearest free spot (spiralSearch), with UNSTUCK /
 * STALL_RESCUE as the fallback, and clears `airborne`. Callers: C4 (catapult, tube,
 * crane), C5 (gold-safe parachute: dormant loot appears through this). Day-0 stub: throws.
 */
export function flyBody(ctx: SimContext, lootId: EntityId, to: Vec2, ticks: number, via: 'catapult' | 'tube' | 'crane' | 'parachute'): void {
  throw new Error(`flyBody not implemented yet (C3): loot ${lootId} -> (${to.x}, ${to.y}) in ${ticks} via ${via} at tick ${ctx.state.tick}`);
}

/**
 * [C3] Prop runtime. Invariant C3 maintains: a prop's `estimatedValue === baseValue + innerValue`
 * (update both in the same statement whenever coins spurt / shed), so heldValue, matchPointInfo,
 * police targeting and the HUD stay right without knowing about props.
 */
export class PropSystem extends ContentSystemBase {
  readonly name = 'props' as const;
}
