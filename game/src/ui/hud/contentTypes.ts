/**
 * [C8] Content 2.0 HUD view-models (content-plan §6 C8 wave 1). Built by `contentFromSim`
 * (adapters.ts) into `HudModel.content`, painted by `ContentHud` (one mount point in Hud.ts):
 *
 * - item slot: the held item's icon inside the dash ring + use pips + lifetime ring; the dash
 *   label becomes the item's verb ("뿅!") while the hands are empty (R2: then dash uses the item)
 * - bag chip: "주머니 120 · 차 앞에 쏟아요" (carried value, NEVER score)
 * - deposit ring under the player while the bag is being emptied in our zone (0.5 s)
 * - world tags: props "ATM 200 · 동전 8" and breakables (proximity only), item name tags for the
 *   first sightings of a kind (F9 `markItemSeen`)
 *
 * Screen coordinates are CSS px in the UiRoot box (GameView.project), like the other labels.
 */
import type { BreakableKind, EntityId, HeldItem, ItemKind, PropVariant, TeamId } from '../../sim/types';

/** The item in my pocket. */
export interface HudItemSlot {
  kind: ItemKind;
  /** Uses left; null = unlimited (no pips; `ITEM_FOREVER`). */
  uses: number | null;
  /** Uses of a fresh item (pip count); null when unlimited. */
  maxUses: number | null;
  /** Remaining lifetime 0..1; null = until the match ends (no lifetime ring). */
  life: number | null;
  /** Remaining lifetime in seconds; null = forever. */
  lifeSec: number | null;
  /** Item cooldown: 0 = ready .. 1 = just used (independent of the dash cooldown). */
  cooldown: number;
  /** Empty hands: the dash button uses the item (R2). False while carrying (dash = carry boost). */
  armed: boolean;
  phase: HeldItem['phase'];
}

/** My coin bag (주머니): carried value, never score. */
export interface HudBag {
  value: number;
  cap: number;
  /** 0..1 deposit progress while standing in our zone; null otherwise. */
  deposit: number | null;
}

/** Ring under my feet while the bag is being emptied (쏟아붓기). */
export interface HudDepositRing {
  x: number;
  y: number;
  progress: number;
  value: number;
  team: TeamId;
}

interface ContentLabelBase {
  /** Screen anchor (CSS px) of the tag's bottom-center. */
  x: number;
  y: number;
}

/** "ATM 200 · 동전 8" over a prop near me (or my grab candidate / held prop). */
export interface PropTagModel extends ContentLabelBase {
  kind: 'prop';
  id: EntityId;
  variant: PropVariant;
  /** Points if recovered now (shell + coins inside). */
  value: number;
  /** 동전 left inside (ATM) / 지폐 left (돈나무); 0 when none. */
  coins: number;
  bills: number;
  /** 돼지: cracks so far (0..3); null for other props. */
  cracks: number | null;
  focus: boolean;
}

/** "나무 상자 · 동전 2" over a breakable near me. */
export interface BreakableTagModel extends ContentLabelBase {
  kind: 'breakable';
  id: string;
  breakable: BreakableKind;
  coins: number;
  hp: number;
  maxHp: number;
}

/** Item on the field (descending crate or on the ground); tagged only on its first sightings. */
export interface ItemTagModel extends ContentLabelBase {
  kind: 'item';
  id: EntityId;
  item: ItemKind;
  incoming: boolean;
  /** Seconds until it lands (incoming only). */
  landSec: number | null;
}

export type ContentLabelModel = PropTagModel | BreakableTagModel | ItemTagModel;

export interface HudContentModel {
  item: HudItemSlot | null;
  bag: HudBag | null;
  deposit: HudDepositRing | null;
  labels: readonly ContentLabelModel[];
  /**
   * I'm knocked down right now. The bag only ever shrinks by a deposit (never while down) or a
   * knockdown spill, so this tells the two apart when the bag drops (no "쏟았다!" for a spill).
   */
  downed: boolean;
  /** My team's confirmed score (a deposit raises it by the bag; a spill never does). */
  teamScore: number;
}

/** Minimap: a supply-drop pad (static per match). */
export interface MinimapItemPad {
  id: string;
  x: number;
  y: number;
  /** null = the axis pad. */
  twin: string | null;
}

/** Minimap: an item on the field. */
export interface MinimapItem {
  id: EntityId;
  kind: ItemKind;
  x: number;
  y: number;
  incoming: boolean;
}

/** Minimap: a loose coin pile (structurally a CoinPile, so state.coins can be passed as is). */
export interface MinimapCoin {
  pos: { x: number; y: number };
  value: number;
}
