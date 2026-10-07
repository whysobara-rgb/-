/**
 * Boot splash (C10): cream paper, a paw stamp lands with a "thunk" (~1.2 s with the ring and
 * the wordmark), then the wordmark and a one-line photosensitivity note. Any key, button, click
 * or touch skips it; it ends on its own after `holdMs`. Game flow shows it only on the first run
 * (and warms the title scene's shaders behind it), and plays the sting only in Electron (browsers
 * need a gesture before audio).
 */
import '../styles/front.css';
import { t } from '../i18n';
import { h, isReducedMotion, svgFromMarkup } from '../core/dom';
import { icon } from '../core/icons';
import { UiScreen } from '../core/screen';
import { chunky } from '../core/juice';
import type { NavAction } from '../core/prompts';

export interface BootSplashProps {
  /** Total time before it continues on its own (ms). Default 2600. */
  holdMs?: number;
  /** The stamp landed (game flow plays the sting here, Electron only). */
  onThunk?: () => void;
  /** Splash finished (timeout or skip). Called once. */
  onDone: () => void;
}

const PAW_SVG =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor" stroke="#2A2131" stroke-width="2.6" stroke-linejoin="round">' +
  '<path d="M32 30c9 0 17 7.5 17 15.5 0 6-4.5 9.5-10 9.5-3 0-4.6-1.4-7-1.4S28 55 25 55c-5.5 0-10-3.5-10-9.5C15 37.5 23 30 32 30z"/>' +
  '<ellipse cx="14.5" cy="25" rx="5.4" ry="7" transform="rotate(-18 14.5 25)"/><ellipse cx="25" cy="14.5" rx="5.6" ry="7.4" transform="rotate(-6 25 14.5)"/>' +
  '<ellipse cx="39" cy="14.5" rx="5.6" ry="7.4" transform="rotate(6 39 14.5)"/><ellipse cx="49.5" cy="25" rx="5.4" ry="7" transform="rotate(18 49.5 25)"/></g></svg>';

/** When the stamp hits (ms after show), matching the CSS thunk keyframes. */
const THUNK_AT_MS = 450;

export class BootSplash extends UiScreen<BootSplashProps> {
  private timers: number[] = [];
  private done = false;

  constructor(props: BootSplashProps) {
    super(props, { name: 'boot', layer: 'dialogs' });
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.finish();
    });
  }

  protected render(): void {
    this.el.append(
      h(
        'div',
        { class: 'uh-boot' },
        h(
          'div',
          { class: 'uh-boot__mark' },
          h('span', { class: 'uh-boot__ring', 'aria-hidden': 'true' }),
          h('div', { class: 'uh-boot__stamp', 'aria-hidden': 'true' }, svgFromMarkup(PAW_SVG)),
        ),
        chunky(t('game.title'), { tag: 'h1', cls: 'uh-boot__word', tone: 'sun', seed: 4 }),
        h('div', { class: 'uh-boot__en' }, t('game.titleEn')),
        h('p', { class: 'uh-boot__note' }, icon('alert'), t('front.boot.note')),
        h('div', { class: 'uh-boot__skip' }, t('front.boot.skip')),
      ),
    );
  }

  protected override onShow(): void {
    const hold = Math.max(600, this.props.holdMs ?? 2600);
    this.timers.push(window.setTimeout(() => this.props.onThunk?.(), isReducedMotion() ? 0 : THUNK_AT_MS));
    this.timers.push(window.setTimeout(() => this.finish(), hold));
  }

  override handleNav(_action: NavAction): boolean {
    this.finish();
    return true;
  }

  handleAnyInput(): boolean {
    this.finish();
    return true;
  }

  /** Fade out and hand over (once). */
  finish(): void {
    if (this.done) return;
    this.done = true;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    this.el.classList.add('is-leaving');
    const out = isReducedMotion() ? 0 : 260;
    window.setTimeout(() => this.props.onDone(), out);
  }

  protected override onDestroy(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
  }
}
