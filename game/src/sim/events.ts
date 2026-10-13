/**
 * [C5] Mid-match events: 돈비, 황금 금고, 현금 수송차 (loot, 400 each) and the 지진 modifier
 * (content-plan §5.4). Day-0 skeleton by C0: no-op EventSystem hooks, the `buildEvents` buildV2
 * callback (event plan + dormant event loot + pending value) and `deriveEventPlan`.
 */
import type { SimContext } from './context';
import { ContentSystemBase } from './systemBase';
import type { LayoutV2Def, LootEventKind, MatchEventPlan } from './types';

/** Game-flow options for `planMatchEvents` (content-plan §5.4). */
export interface EventPlanOptions {
  /** Never pick this loot kind (F9 `lastEventKind`: the previous match's kind never repeats). */
  avoidKind?: LootEventKind | null;
  /** false = no quake (novice cup gets the loot event only). Default true. */
  quake?: boolean;
}

/**
 * [C5] The seeded plan — a PURE function of (seed, layout v2, options), so game flow can build
 * the `RuleConfig.eventPlan` override with the exact same draws the sim would make. Uses its own
 * stream `createRng(seed ^ CONTENT_RNG_SALT ^ EVENT_RNG_SALT)` (never ctx.rng, the item deck's):
 * loot kind uniform over the 3 kinds minus `avoidKind`, at a fire tick uniform in
 * EVENTS.lootWindow, spot 0 (the axis spot); `truckFrom` drawn for a cash truck; quake with
 * EVENTS.quakeChance in EVENTS.quakeWindow, at least EVENTS.quakeGapTicks after the loot event.
 * Day-0 stub: null (no events) until C5 lands.
 */
export function planMatchEvents(_seed: number, _v2: LayoutV2Def, _opts: EventPlanOptions = {}): MatchEventPlan | null {
  return null;
}

/** [C5] The plan the sim derives when `rules.eventPlan` is undefined: planMatchEvents(seed, v2). */
export function deriveEventPlan(ctx: SimContext): MatchEventPlan | null {
  return ctx.layout.v2 ? planMatchEvents(ctx.setup.seed, ctx.layout.v2) : null;
}

/**
 * buildV2 callback [C5]: resolve ctx.state.eventPlan (rules.events 'off' -> null; an explicit
 * rules.eventPlan wins; undefined -> deriveEventPlan), then create the plan's MatchEventStates in
 * phase 'scheduled' (pendingValue for 돈비 / 수송차; the truck's curb side from the plan, or drawn
 * here from the event stream when an explicit plan omits it) and append dormant event loot
 * (황금 금고, body disabled) via appendLoot — all at build, so totalValue (4,400 with a loot
 * event) is constant from tick 0. Runs last.
 */
export function buildEvents(ctx: SimContext, _v2: LayoutV2Def): void {
  const rules = ctx.rules;
  ctx.state.eventPlan = rules.events !== 'on' ? null : rules.eventPlan === undefined ? deriveEventPlan(ctx) : rules.eventPlan;
  // C5: matchEvents + dormant loot from ctx.state.eventPlan
}

export class EventSystem extends ContentSystemBase {
  readonly name = 'events' as const;
}
