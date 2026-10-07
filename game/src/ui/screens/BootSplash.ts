/**
 * Boot splash (C10): cream paper, a paw stamp lands with a "thunk" (~1.2 s with the ring and
 * the wordmark), then the wordmark and a one-line photosensitivity note. Any key, button, click
 * or touch skips it; it ends on its own after `holdMs` of smoothly rendered frames. Game flow shows it only on the first run
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

/** When the stamp hits (ms after the splash goes live), matching the CSS thunk keyframes. */
const THUNK_AT_MS = 450;
/** A frame counts toward the hold for at most this long, so a main-thread stall cannot eat it. */
const MAX_FRAME_MS = 50;
/** The splash goes live (animations start) on the first smooth frame after this many frames. */
const WARM_FRAMES = 2;
/** ...or after this many frames however slow they are. */
const WARM_FRAMES_MAX = 20;
/** A frame shorter than this means the warm-up behind the splash has finished. */
const SMOOTH_FRAME_MS = 120;
/** Wall-clock safety cap on the whole splash (ms), as a multiple of the hold. */
const WALL_CAP_FACTOR = 4;

export class BootSplash extends UiScreen<BootSplashProps> {
  private timers: number[] = [];
  private raf = 0;
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

  /**
   * The hold runs on rendered frames, not the wall clock: the title scene warms its shaders
   * behind the splash, and that first frame can stall the main thread for a long time. The
   * animations stay paused (CSS: .uh-boot:not(.is-live)) until frames come smoothly again, and
   * each frame adds at most MAX_FRAME_MS to the hold, so the stamp, the wordmark and the
   * photosensitivity note are always actually seen for about `holdMs`.
   */
  protected override onShow(): void {
    const hold = Math.max(600, this.props.holdMs ?? 2600);
    const root = this.el.querySelector('.uh-boot');
    const thunkAt = isReducedMotion() ? 0 : THUNK_AT_MS;
    let frames = 0;
    let last = -1;
    let live = false;
    let acc = 0;
    let thunked = false;
    const tick = (now: number): void => {
      this.raf = 0;
      if (this.done) return;
      const dt = last < 0 ? 0 : now - last;
      last = now;
      frames++;
      if (!live) {
        if ((frames > WARM_FRAMES && dt < SMOOTH_FRAME_MS) || frames >= WARM_FRAMES_MAX) {
          live = true;
          root?.classList.add('is-live');
        }
      } else {
        acc += Math.min(dt, MAX_FRAME_MS);
      }
      if (live && !thunked && acc >= thunkAt) {
        thunked = true;
        this.props.onThunk?.();
      }
      if (live && acc >= hold) {
        this.finish();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    // Never trap the player if frames stop coming at all (hidden window, etc.).
    this.timers.push(window.setTimeout(() => this.finish(), hold * WALL_CAP_FACTOR));
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
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.el.classList.add('is-leaving');
    const out = isReducedMotion() ? 0 : 260;
    window.setTimeout(() => this.props.onDone(), out);
  }

  protected override onDestroy(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
