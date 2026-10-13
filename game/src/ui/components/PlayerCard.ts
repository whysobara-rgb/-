/**
 * Front-door player chip (read-only, never focusable): a small round portrait of the player's
 * raccoon in the equipped hat and the cosmetic rank title (from rivals beaten; never a stat).
 * It sits quietly in the top-right corner; records and rival stamps live on their own screens.
 */
import type { HatId, TeamId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h } from '../core/dom';
import { portrait } from '../core/portrait';

export interface PlayerChipModel {
  hat: HatId;
  team: TeamId;
  /** Rank title, e.g. 'front.player.rank.1'. */
  rank: TextRef;
}

export function playerChip(m: PlayerChipModel): HTMLElement {
  return h(
    'section',
    { class: 'uh-mechip', 'aria-label': t('front.player.aria') },
    h('span', { class: 'uh-mechip__art', 'aria-hidden': 'true' }, portrait({ hat: m.hat, team: m.team, expression: 'happy' })),
    h('span', { class: 'uh-mechip__name' }, tr(m.rank)),
  );
}
