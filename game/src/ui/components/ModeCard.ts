/**
 * Front-door mode card (빠른 대전 / 라이벌 대회 / 연습): a 3D thumbnail strip (portrait snapshot
 * from the menu renderer, or an SVG / icon fallback), the mode name and one live status line
 * ("통큰이 2라운드 진행 중", "새 맵 1"). One press opens the mode. `highlight` adds the first-launch
 * "여기부터!" flag (it replaces the old first-run modal).
 */
import { tr, type TextRef } from '../i18n';
import { h, type Child } from '../core/dom';
import { navigable } from '../core/nav';
import { chip } from './controls';

export type ModeCardTone = 'sun' | 'mint' | 'tomato' | 'sky' | 'grape';

export interface ModeCardOptions {
  /** Nav id (unique in the screen), e.g. 'menu:quickMatch'. */
  id: string;
  title: TextRef;
  status?: TextRef | null;
  /** Thumbnail content (portrait element or icon). */
  art: Child;
  tone: ModeCardTone;
  badge?: TextRef | null;
  /** First-launch flag text (e.g. 'front.highlight'); null = none. */
  highlight?: TextRef | null;
  onActivate: () => void;
}

export function modeCard(o: ModeCardOptions): HTMLElement {
  const el = h(
    'div',
    { class: ['uh-mcard', `uh-mcard--${o.tone}`, o.highlight ? 'is-highlight' : ''], role: 'button' },
    h('div', { class: 'uh-mcard__art', 'aria-hidden': 'true' }, o.art),
    h(
      'div',
      { class: 'uh-mcard__body' },
      h('div', { class: ['uh-mcard__title', tr(o.title).length > 12 ? 'is-long' : ''] }, tr(o.title)),
      o.status ? h('div', { class: 'uh-mcard__status' }, tr(o.status)) : null,
    ),
    o.badge ? h('span', { class: 'uh-mcard__badge' }, chip(o.badge, 'tomato')) : null,
    o.highlight ? h('span', { class: 'uh-mcard__flag' }, tr(o.highlight)) : null,
  );
  return navigable(el, o.id, { onActivate: o.onActivate });
}
