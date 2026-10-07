/**
 * Front-door player card (read-only, never focusable): the player's raccoon portrait with the
 * equipped hat, a cosmetic rank title (from rivals beaten; never a stat), the hat name, the
 * win / loss / draw record with the best score, and three rival stamps (beaten = inked stamp,
 * not yet = dashed outline). Fresh saves show "첫 판을 기다리는 중" instead of 0-0-0.
 */
import type { HatId, TeamId } from '../../sim/types';
import { t, tr, formatNumber, type TextRef } from '../i18n';
import { h } from '../core/dom';
import { portrait } from '../core/portrait';
import type { RivalId } from '../core/icons';

export interface PlayerCardModel {
  hat: HatId;
  team: TeamId;
  /** Rank title, e.g. 'front.player.rank.1'. */
  rank: TextRef;
  /** Equipped hat name, e.g. 'hat.teamCapA.name'. */
  hatName: TextRef;
  /** null = no finished match yet. */
  record: { wins: number; losses: number; draws: number; best: number } | null;
  rivals: readonly { rival: RivalId; beaten: boolean }[];
}

export function playerCard(m: PlayerCardModel): HTMLElement {
  const stats = m.record
    ? h(
        'div',
        { class: 'uh-pcard__stats' },
        h('span', null, t('front.player.record', { w: m.record.wins, l: m.record.losses, d: m.record.draws })),
        m.record.best > 0 ? h('span', { class: 'uh-pcard__best' }, t('front.player.best', { score: formatNumber(m.record.best) })) : null,
      )
    : h('div', { class: 'uh-pcard__stats' }, h('span', null, t('front.player.fresh')));
  return h(
    'section',
    { class: 'uh-pcard', 'aria-label': t('front.player.aria') },
    h('div', { class: 'uh-pcard__art', 'aria-hidden': 'true' }, portrait({ hat: m.hat, team: m.team, expression: 'happy' })),
    h('div', { class: 'uh-pcard__body' }, h('div', { class: 'uh-pcard__rank' }, tr(m.rank)), h('div', { class: 'uh-pcard__hat' }, tr(m.hatName)), stats),
    h(
      'div',
      { class: 'uh-pcard__stamps' },
      h('div', { class: 'uh-pcard__stampsLabel' }, t('front.player.rivals')),
      h(
        'div',
        { class: 'uh-pcard__stampRow' },
        m.rivals.map((r) =>
          h(
            'span',
            { class: ['uh-pcard__stamp', r.beaten ? 'is-beaten' : ''], title: t(`rival.${r.rival}.name`) },
            portrait({ rival: r.rival, silhouette: !r.beaten }),
          ),
        ),
      ),
    ),
  );
}
