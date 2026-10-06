/**
 * Non-blocking toasts (achievements, hats). Never steal input or need dismissal — doc §12:
 * no reward-popup chains between the player and a rematch. Max 3 visible; extra queue up.
 */
import type { HatId } from '../../sim/types';
import { tr, type TextRef } from '../i18n';
import { h } from '../core/dom';
import { icon, raccoon, type IconName } from '../core/icons';
import { getUiRoot } from '../core/root';

export interface ToastOptions {
  kicker?: TextRef | null;
  title: TextRef;
  body?: TextRef | null;
  icon?: IconName;
  /** Custom art node instead of an icon. */
  art?: () => Node;
  durationMs?: number;
}

const MAX_VISIBLE = 3;

export class Toasts {
  readonly el: HTMLElement;
  private readonly queue: ToastOptions[] = [];
  private visible = 0;

  constructor(parent?: HTMLElement) {
    this.el = h('div', { class: 'uh-toasts', 'aria-live': 'polite' });
    (parent ?? getUiRoot().layer('toasts')).appendChild(this.el);
  }

  show(o: ToastOptions): void {
    this.queue.push(o);
    this.pump();
  }

  /** Achievement unlocked: uses 'ach.<ID>.name' / 'ach.<ID>.desc'. */
  achievement(id: string, durationMs?: number): void {
    this.show({ kicker: 'toast.achievement', title: `ach.${id}.name`, body: `ach.${id}.desc`, icon: 'trophy', durationMs });
  }

  /** Hat unlocked (cosmetic). */
  hatUnlocked(hat: HatId, durationMs?: number): void {
    this.show({
      kicker: 'toast.hat',
      title: `hat.${hat}.name`,
      body: 'toast.hat.body',
      art: () => raccoon({ hat, expression: 'happy' }),
      durationMs,
    });
  }

  clear(): void {
    this.queue.length = 0;
    this.el.replaceChildren();
    this.visible = 0;
  }

  destroy(): void {
    this.clear();
    this.el.remove();
  }

  private pump(): void {
    while (this.visible < MAX_VISIBLE && this.queue.length) {
      const o = this.queue.shift()!;
      this.visible++;
      const el = h(
        'div',
        { class: 'uh-toast', role: 'status' },
        h('div', { class: 'uh-toast__art' }, o.art ? o.art() : icon(o.icon ?? 'sparkle')),
        h(
          'div',
          { class: 'uh-toast__text' },
          o.kicker ? h('span', { class: 'uh-toast__kicker' }, tr(o.kicker)) : null,
          h('span', { class: 'uh-toast__title' }, tr(o.title)),
          o.body ? h('span', { class: 'uh-toast__body' }, tr(o.body)) : null,
        ),
      );
      this.el.appendChild(el);
      window.setTimeout(() => {
        el.classList.add('is-leaving');
        window.setTimeout(() => {
          el.remove();
          this.visible--;
          this.pump();
        }, 260);
      }, o.durationMs ?? 4200);
    }
  }
}
