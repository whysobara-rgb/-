/**
 * [C2] Items: pickups, seeded deck, drop schedule, hammer / golden hammer (wave 1), plunger,
 * skates, soap (wave 2), gated balloons / smoke (wave 3) (content-plan §5.2).
 * Day-0 skeleton by C0: no-op ItemSystem hooks, the `buildItemPads` buildV2 callback and the
 * frozen dash-routing entry point `onDash`.
 */
import type { SimContext } from './context';
import { ContentSystemBase } from './systemBase';
import type { EntityId, LayoutV2Def } from './types';

/**
 * buildV2 callback [C2]: read LayoutV2Def.itemPads (twins share draws), set up the seeded decks
 * (ctx.rng — the item deck is one of the three allowed draws) unless rules.items is 'off'.
 * Runs after gimmicks, before events.
 */
export function buildItemPads(_ctx: SimContext, _v2: LayoutV2Def): void {
  // C2
}

export class ItemSystem extends ContentSystemBase {
  readonly name = 'items' as const;

  /**
   * [C2] Rising dash edge of `slot` while it holds an item and no loot (R2): start the item use
   * (hammer wind-up, plunger aim, soap dash, skate burst …). Called from processCommands INSTEAD
   * of startDash, regardless of the dash cooldown (items keep their own cooldown).
   */
  onDash(_slot: number): void {
    // C2
  }

  /**
   * [C2] Drop `charId`'s item at its feet with its remaining uses (knockdown), emitting
   * `itemDropped`. No-op without an item.
   */
  dropHeld(_charId: EntityId): void {
    // C2
  }
}
