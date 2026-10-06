/**
 * Internal mutable simulation context shared by world/actions/rules/sim.
 * Not part of the public API (consumers use Simulation + types.ts).
 */
import type { Body, GrabJoint, PhysicsWorld, StaticShape } from './physics';
import type { PoliceSystem } from './police';
import type { Command, LayoutDef, LootState, MatchSetup, OBB, RuleConfig, SimEvent, SimState } from './types';

export interface CharRuntime {
  body: Body;
  /** Dash button level last tick (rising-edge detection). */
  prevDash: boolean;
  /** Unit heading of the current dash burst (valid while dashTicks > 0). */
  dashDirX: number;
  dashDirY: number;
  /** After a forced release the grab signal must be seen false once before re-grabbing. */
  grabLatch: boolean;
  joint: GrabJoint | null;
  lastPingTick: number;
  /** Consecutive ticks penetrated deeper than UNSTUCK.penetration. */
  stuckTicks: number;
  /** Last pose known to be finite and inside the arena (NaN guard). */
  lastX: number;
  lastY: number;
  /** Sanitised command of the current tick. */
  cmd: Command;
}

export interface LootRuntime {
  body: Body;
  /** Real (unscaled) mass of the item. Banks: building mass without cargo. */
  baseMass: number;
  stuckTicks: number;
  lastX: number;
  lastY: number;
  lastA: number;
}

export interface FenceRuntime {
  shape: StaticShape;
  /** Consecutive ticks a moving bank pressed it faster than FENCE.minPressSpeed. */
  pressTicks: number;
  /** Per-tick accumulation from physics contacts. */
  touched: boolean;
  maxApproach: number;
  bankId: number;
  px: number;
  py: number;
}

export interface ZoneRuntime {
  team: 0 | 1;
  obb: OBB;
}

export interface SimContext {
  setup: MatchSetup;
  rules: RuleConfig;
  layout: LayoutDef;
  state: SimState;
  physics: PhysicsWorld;
  /** Index = slot. */
  chars: CharRuntime[];
  /** Index-aligned with state.loot. */
  loot: LootRuntime[];
  /** Entity id -> index into state.loot. */
  lootIndex: Map<number, number>;
  fences: FenceRuntime[];
  zones: ZoneRuntime[];
  /** Static shapes that are not fences (boundary, layout statics, circles, vans). */
  vanShapes: StaticShape[];
  boundaryShapes: StaticShape[];
  /** Events of the tick being simulated. */
  events: SimEvent[];
  /** Events produced outside step() (debug API) delivered with the next step. */
  pendingEvents: SimEvent[];
  nextPingId: number;
  /** Ids already settled (guards against double settlement). */
  settled: Set<number>;
  started: boolean;
  /** Police event runtime (null unless rules.police). */
  police: PoliceSystem | null;
}

export function lootById(ctx: SimContext, id: number): { state: LootState; rt: LootRuntime } | null {
  const i = ctx.lootIndex.get(id);
  if (i === undefined) return null;
  return { state: ctx.state.loot[i]!, rt: ctx.loot[i]! };
}

export function emit(ctx: SimContext, e: SimEvent): void {
  ctx.events.push(e);
}
