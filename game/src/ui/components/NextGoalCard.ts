/**
 * Front-door next goal: one short line under 게임 시작 ("이어서 · 호다닥 상대로 3판 2선승 이어 하기 ›")
 * with a small x that hides it for the session. One press continues the suggested step (series
 * in progress -> next onboarding step -> next rival; F7's `nextGoal()` supplies it, game flow has
 * a v1 fallback). No timers, no streaks, nothing expires.
 */
import { t, tr, type TextRef } from '../i18n';
import { h, svgFromMarkup } from '../core/dom';
import { icon, type IconName } from '../core/icons';
import { navigable } from '../core/nav';

export type NextGoalKind = 'series' | 'onboarding' | 'challenge' | 'tournament' | 'practice' | 'other';

export interface NextGoalView {
  /** Stable id (game flow routes the press by it). */
  id: string;
  kind: NextGoalKind;
  /** Small lead-in before the title (default 'front.goal.label'; a series uses 'front.goal.continue'). */
  label?: TextRef | null;
  title: TextRef;
  icon?: IconName;
}

const CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

export interface NextGoalHandlers {
  onActivate: () => void;
  /** Hide the line (omit to render no close button). */
  onDismiss?: () => void;
}

/** The row: [goal line][x]. Nav ids 'menu:goal' and 'menu:goalDismiss'. */
export function nextGoalLine(goal: NextGoalView, hs: NextGoalHandlers): HTMLElement {
  const line = h(
    'div',
    { class: ['uh-goal', `uh-goal--${goal.kind}`], role: 'button' },
    h('span', { class: 'uh-goal__icon', 'aria-hidden': 'true' }, icon(goal.icon ?? 'flag')),
    h('span', { class: 'uh-goal__label' }, tr(goal.label ?? 'front.goal.label')),
    h('span', { class: 'uh-goal__title' }, tr(goal.title)),
    h('span', { class: 'uh-goal__arrow', 'aria-hidden': 'true' }, icon('chevRight')),
  );
  navigable(line, 'menu:goal', { onActivate: hs.onActivate });
  const close = hs.onDismiss
    ? navigable(h('div', { class: 'uh-goal__close', role: 'button', 'aria-label': t('front.goal.dismiss'), title: t('front.goal.dismiss') }, svgFromMarkup(CLOSE_SVG)), 'menu:goalDismiss', {
        onActivate: hs.onDismiss,
      })
    : null;
  return h('div', { class: 'uh-front__goalRow' }, line, close);
}
