/**
 * [C8] Content 2.0 HUD (content-plan §6 C8 wave 1), mounted ONCE by Hud.ts:
 *
 *   this.content = new ContentHud({ dash, bottom, before: carryEl, world });   // constructor
 *   this.content.update(m.content ?? null);                                    // every frame
 *   this.content.reset() / destroy()
 *
 * Parts (each its own component): ItemSlot (item icon + pips + lifetime ring inside the dash
 * button, verb label), BagChip ("주머니 120 · 차 앞에 쏟아요", above the '운반 중' tag),
 * DepositRing (ring under my feet while the bag empties), PropLabels (prop / breakable tags,
 * item name tags on the first sightings of a kind). Minimap layers live in Minimap.ts.
 *
 * Item name tags: the first time a kind is seen on screen in a match, `sightings(kind)` decides
 * whether it gets a tag this match (default: F9 `markItemSeen(kind).showTag`, i.e. the player's
 * first ITEM_TAG_SIGHTINGS matches with that item). Game flow / dev pages may inject their own.
 */
import type { ItemKind } from '../../sim/types';
import { onLanguageChange } from '../i18n';
import { markItemSeen } from '../../platform/progress';
import { ItemSlot } from './ItemSlot';
import { BagChip, BagDropTracker } from './BagChip';
import { DepositRing } from './DepositRing';
import { PropLabels } from './PropLabels';
import type { HudContentModel } from './contentTypes';
import '../styles/hud-content.css';

export interface ContentHudMount {
  /** The Hud's dash element (`.uh-dash`): the item slot decorates it. */
  dash: HTMLElement;
  /** Bottom-centre column: the bag chip goes in here... */
  bottom: HTMLElement;
  /** ...right before this element (the '운반 중' tag); appended when null. */
  before?: HTMLElement | null;
  /** Full-size world layer (labels / rings positioned in CSS px). */
  world: HTMLElement;
}

/** Returns whether a newly sighted item kind gets a name tag this match. */
export type ItemSightingFn = (kind: ItemKind) => boolean;

const defaultSightings: ItemSightingFn = (kind) => {
  try {
    return markItemSeen(kind).showTag;
  } catch {
    return false;
  }
};

export class ContentHud {
  readonly item: ItemSlot;
  readonly bag: BagChip;
  readonly deposit: DepositRing;
  private readonly bagDrops = new BagDropTracker();
  readonly tags: PropLabels;
  private sightings: ItemSightingFn = defaultSightings;
  /** Per match: kind -> tagged this match. */
  private readonly tagged = new Map<ItemKind, boolean>();
  private readonly allowItem = (kind: ItemKind): boolean => {
    let ok = this.tagged.get(kind);
    if (ok === undefined) {
      ok = this.sightings(kind);
      this.tagged.set(kind, ok);
    }
    return ok;
  };
  private readonly unsubLang: () => void;

  constructor(m: ContentHudMount) {
    this.item = new ItemSlot(m.dash);
    this.bag = new BagChip();
    this.deposit = new DepositRing();
    this.tags = new PropLabels();
    if (m.before && m.before.parentElement === m.bottom) m.bottom.insertBefore(this.bag.el, m.before);
    else m.bottom.appendChild(this.bag.el);
    m.world.append(this.deposit.el, this.tags.el);
    this.unsubLang = onLanguageChange(() => this.relabel());
  }

  /** Replace the sighting hook (null = the F9 default). Takes effect for kinds not yet seen this match. */
  setItemSightings(fn: ItemSightingFn | null): void {
    this.sightings = fn ?? defaultSightings;
  }

  update(c: HudContentModel | null, now: number = performance.now()): void {
    const drop = this.bagDrops.update(c);
    this.item.update(c?.item ?? null);
    this.bag.update(c?.bag ?? null, now, drop);
    this.deposit.update(c?.deposit ?? null, drop);
    this.tags.update(c?.labels, this.allowItem);
  }

  /** New match: clear everything and the per-match sighting memo. */
  reset(): void {
    this.bagDrops.reset();
    this.tagged.clear();
    this.item.clear(false);
    this.bag.reset();
    this.deposit.reset();
    this.tags.clear();
  }

  destroy(): void {
    this.unsubLang();
    this.bag.el.remove();
    this.deposit.el.remove();
    this.tags.el.remove();
  }

  private relabel(): void {
    this.item.relabel();
    this.bag.relabel();
    this.deposit.relabel();
    this.tags.invalidate();
  }
}
