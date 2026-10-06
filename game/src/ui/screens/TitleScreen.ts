/**
 * Title: the logo SLAMS in over the live 3D diorama (overshoot + squash, letters jiggle in one by
 * one, dangling roots grow), the "UPROOT HEIST" ribbon flips in, and a bobbing "아무 키나
 * 누르세요" sticker waits. Any nav action, any key frame (MenuNav.any) or a click starts.
 */
import { t } from '../i18n';
import { h, svgFromMarkup } from '../core/dom';
import { icon } from '../core/icons';
import { UiScreen } from '../core/screen';
import { uiSound } from '../core/nav';
import type { NavAction } from '../core/prompts';

export interface TitleScreenProps {
  /** Shown bottom-right, e.g. '0.5.0'. */
  version?: string;
  onStart: () => void;
}

const ROOT_PATHS = [
  'M70 10c-8 26 10 40-4 62s-30 24-36 42',
  'M135 10c8 22-6 34 8 52',
  'M230 10c-4 30 22 38 14 60s10 28 6 40',
  'M330 10c10 18 30 22 26 46',
  'M420 10c-4 24-30 32-20 54s-8 32-4 46',
  'M520 10c10 28 30 28 28 54',
  'M66 46c-14 2-22 10-28 18M240 56c14 0 22 6 28 14M410 40c-12-2-22 2-30 10M140 40c10 4 14 10 16 18',
];
/** Dangling roots under "뿌리째" (ink outline + two browns, sticker style). */
const ROOTS_SVG = `<svg viewBox="0 0 600 130" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="#2A2131" stroke-width="19">${ROOT_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>
    <g stroke="#B9774A" stroke-width="10">${ROOT_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>
    <g stroke="#E8AE78" stroke-width="3.5" opacity=".85">${ROOT_PATHS.slice(0, 6).map((d) => `<path d="${d}" transform="translate(-2.5 -1.5)"/>`).join('')}</g>
  </g>
  <path d="M20 14c40-14 120-12 170-4s110 10 180 0 150-8 210 6c-30 10-110 12-190 8s-140 6-210 4-120-2-160-14z" fill="#7A4A30" stroke="#2A2131" stroke-width="7" stroke-linejoin="round"/>
  <g fill="#9C6440" stroke="#2A2131" stroke-width="4.5"><circle cx="48" cy="34" r="8"/><circle cx="196" cy="30" r="6"/><circle cx="372" cy="34" r="7"/><circle cx="556" cy="30" r="6"/></g>
</svg>`;

/** Little sparkle stars around the logo (static SVG, CSS twinkles them). */
const SPARK = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z" fill="#FFF6E6" stroke="#2A2131" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

const TILT = [-7, 4, -3, 6, -5, 3];

export class TitleScreen extends UiScreen<TitleScreenProps> {
  constructor(props: TitleScreenProps) {
    super(props, { name: 'title' });
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.start();
    });
  }

  protected render(): void {
    const word = (text: string, tone: 'sun' | 'cream', delay0: number, seed: number): HTMLElement =>
      h(
        'span',
        { class: `uh-logo__word uh-logo__word--${tone}` },
        Array.from(text).map((ch, i) =>
          h('span', { class: 'uh-logo__char', style: { '--d': `${delay0 + i * 85}ms`, '--tilt': `${TILT[(i + seed) % TILT.length]}deg`, '--k': String(i) } }, ch),
        ),
      );
    const title = t('game.title');
    const [first, ...rest] = title.split(' ');
    const logo = h(
      'div',
      // Short titles (Korean: 3 + 3 syllables) get bigger letters so both languages fill the sky.
      { class: ['uh-logo', Math.max(first.length, rest.join(' ').length) <= 4 ? 'uh-logo--short' : ''], role: 'img', 'aria-label': title },
      h('div', { class: 'uh-logo__line uh-logo__line--a' }, word(first, 'sun', 260, 0), svgFromMarkup(ROOTS_SVG, 'uh-logo__roots uh-deco')),
      h('div', { class: 'uh-logo__line uh-logo__line--b' }, word(rest.join(' '), 'cream', 560, 3)),
      h('div', { class: 'uh-logo__ribbon' }, h('span', null, t('game.titleEn'))),
      [0, 1, 2, 3].map((i) => h('span', { class: `uh-logo__spark uh-logo__spark--${i} uh-deco` }, svgFromMarkup(SPARK))),
    );
    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-title' },
        h('div', { class: 'uh-title__center' }, logo, h('p', { class: 'uh-title__tagline' }, t('game.tagline'))),
        h('div', { class: 'uh-title__press' }, h('span', { class: 'uh-title__pressPaw' }, icon('paw')), h('span', { class: 'uh-title__pressText' }, t('title.pressAny'))),
        this.props.version ? h('div', { class: 'uh-title__version' }, t('title.version', { version: this.props.version })) : null,
      ),
    );
  }

  override handleNav(_action: NavAction): boolean {
    this.start();
    return true;
  }

  handleAnyInput(): boolean {
    this.start();
    return true;
  }

  /** Fires onStart once per show (any key, pad button, click or touch). */
  private start(): void {
    if (!this.isVisible || this.isLeaving) return;
    uiSound('confirm');
    this.leave(() => this.props.onStart());
  }
}
