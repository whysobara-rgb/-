/**
 * Layout registry (doc §9 "두 은행과 세 가지 배치", §3 tutorial).
 *
 * Every match layout shares the same rules, loot total (3,200) and asset vocabulary;
 * they differ in distances, sightlines, door directions and connections.
 * All layouts are validated by tools/layout-check.ts and test/sim/layouts.test.ts.
 *
 * Route convention: `bankRoutes` holds at least one route per (bank, team) pair; when a
 * pair has several, they are listed in order of preference (shortest first).
 */
import type { LayoutDef, LayoutId } from '../types';
import type { LayoutDesignMeta } from './meta';
import { PLAZA, PLAZA_META } from './plaza';
import { SHORTCUT, SHORTCUT_META } from './shortcut';
import { COUNTER, COUNTER_META } from './counter';
import { TUTORIAL, TUTORIAL_META } from './tutorial';

export { LAYOUT_STRINGS } from './strings';
export type { LayoutDesignMeta, PathClass, PathSpec } from './meta';
export { KIOSK_STYLES, SHOP_STYLES } from './meta';

export const LAYOUTS: Readonly<Record<LayoutId, LayoutDef>> = {
  plaza: PLAZA,
  shortcut: SHORTCUT,
  counter: COUNTER,
  tutorial: TUTORIAL,
};

/** Design metadata (declared alleys/lanes + intent) used by validation and tools. */
export const LAYOUT_META: Readonly<Record<LayoutId, LayoutDesignMeta>> = {
  plaza: PLAZA_META,
  shortcut: SHORTCUT_META,
  counter: COUNTER_META,
  tutorial: TUTORIAL_META,
};

/** Layouts offered for matches (quick match / rival tournament); the tutorial is separate. */
export const MATCH_LAYOUT_IDS: LayoutId[] = ['plaza', 'shortcut', 'counter'];

export function getLayout(id: LayoutId): LayoutDef {
  const l = LAYOUTS[id];
  if (!l) throw new Error(`unknown layout id: ${String(id)}`);
  return l;
}

/** Chokepoint lookup helper for rival lines ("그 골목을 지켜볼까?"). */
export function getChokepoint(layoutId: LayoutId, chokepointId: string): LayoutDef['chokepoints'][number] | undefined {
  return LAYOUTS[layoutId]?.chokepoints.find((c) => c.id === chokepointId);
}
