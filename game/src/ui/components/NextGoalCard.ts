/**
 * Front-door "이어서 / 다음 목표" card: one press continues the suggested next step (series in
 * progress -> next onboarding step -> nearest 수첩 challenge; F7's `nextGoal()` supplies it, game
 * flow has a v1 fallback). The small x next to it hides the card for the session. No timers,
 * no streaks, nothing expires.
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
  /** Small caption above the title (default 'front.goal.label'; a series uses 'front.goal.continue'). */
  label?: TextRef | null;
  title: TextRef;
  detail?: TextRef | null;
  icon?: IconName;
  /** Optional progress pips (e.g. onboarding 1 / 4). */
  progress?: { done: number; total: number } | null;
}

const CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';

export interface NextGoalHandlers {
  onActivate: () => void;
  /** Hide the card (omit to render no close button). */
  onDismiss?: () => void;
}

/** The card row: [goal card][x]. Nav ids 'menu:goal' and 'menu:goalDismiss'. */
export function nextGoalCard(goal: NextGoalView, hs: NextGoalHandlers): HTMLElement {
  const p = goal.progress;
  const card = h(
    'div',
    { class: ['uh-goal', `uh-goal--${goal.kind}`], role: 'button' },
    h('span', { class: 'uh-goal__icon', 'aria-hidden': 'true' }, icon(goal.icon ?? 'flag')),
    h(
      'span',
      { class: 'uh-goal__text' },
      h('span', { class: 'uh-goal__label' }, tr(goal.label ?? 'front.goal.label')),
      h('span', { class: 'uh-goal__title' }, tr(goal.title)),
      goal.detail ? h('span', { class: 'uh-goal__detail' }, tr(goal.detail)) : null,
    ),
    p && p.total > 0
      ? h(
          'span',
          { class: 'uh-goal__pips', 'aria-label': `${p.done}/${p.total}` },
          Array.from({ length: p.total }, (_, i) => h('span', { class: ['uh-goal__pip', i < p.done ? 'is-done' : ''] })),
        )
      : null,
    h('span', { class: 'uh-goal__arrow', 'aria-hidden': 'true' }, icon('chevRight')),
  );
  navigable(card, 'menu:goal', { onActivate: hs.onActivate });
  const close = hs.onDismiss
    ? navigable(h('div', { class: 'uh-goal__close', role: 'button', 'aria-label': t('front.goal.dismiss'), title: t('front.goal.dismiss') }, svgFromMarkup(CLOSE_SVG)), 'menu:goalDismiss', {
        onActivate: hs.onDismiss,
      })
    : null;
  return h('div', { class: 'uh-front__goalRow' }, card, close);
}
