/**
 * Title: animated "뿌리째 털어라" wordmark (CSS + SVG roots), English ribbon, tagline and a
 * pulsing "아무 키나 누르세요". Any nav action, any key frame (MenuNav.any) or a click starts.
 */
import { t } from '../i18n';
import { h, svgFromMarkup } from '../core/dom';
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
    <g stroke="#2E2442" stroke-width="17">${ROOT_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>
    <g stroke="#B9774A" stroke-width="9">${ROOT_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>
    <g stroke="#E0A06C" stroke-width="3" opacity=".8">${ROOT_PATHS.slice(0, 6).map((d) => `<path d="${d}" transform="translate(-2 -1)"/>`).join('')}</g>
  </g>
  <path d="M20 14c40-14 120-12 170-4s110 10 180 0 150-8 210 6c-30 10-110 12-190 8s-140 6-210 4-120-2-160-14z" fill="#7A4A30" stroke="#2E2442" stroke-width="6" stroke-linejoin="round"/>
  <g fill="#9C6440" stroke="#2E2442" stroke-width="4"><circle cx="48" cy="34" r="8"/><circle cx="196" cy="30" r="6"/><circle cx="372" cy="34" r="7"/><circle cx="556" cy="30" r="6"/></g>
</svg>`;

export class TitleScreen extends UiScreen<TitleScreenProps> {
  private started = false;

  constructor(props: TitleScreenProps) {
    super(props, { name: 'title' });
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.start();
    });
  }

  protected render(): void {
    const word = (text: string, cls: string, delay0: number): HTMLElement =>
      h(
        'span',
        { class: `uh-wordmark__word ${cls}` },
        Array.from(text).map((ch, i) =>
          h('span', { class: 'uh-wordmark__char', style: { '--d': `${delay0 + i * 90}ms`, '--k': String(i) } }, ch),
        ),
      );
    const title = t('game.title');
    const [first, ...rest] = title.split(' ');
    const wordmark = h(
      'div',
      { class: 'uh-wordmark', role: 'img', 'aria-label': title },
      h('div', { class: 'uh-wordmark__line uh-wordmark__line--a' }, word(first, 'uh-wordmark__word--gold', 0), svgFromMarkup(ROOTS_SVG, 'uh-wordmark__roots')),
      h('div', { class: 'uh-wordmark__line uh-wordmark__line--b' }, word(rest.join(' '), 'uh-wordmark__word--cream', 320)),
      h('div', { class: 'uh-wordmark__ribbon' }, h('span', null, t('game.titleEn'))),
    );
    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-title' },
        h('div', { class: 'uh-title__center' }, wordmark, h('p', { class: 'uh-title__tagline' }, t('game.tagline'))),
        h('div', { class: 'uh-title__press' }, h('span', { class: 'uh-title__pressText' }, t('title.pressAny'))),
        this.props.version ? h('div', { class: 'uh-title__version' }, t('title.version', { version: this.props.version })) : null,
      ),
    );
  }

  protected override onShow(): void {
    this.started = false;
  }

  override handleNav(_action: NavAction): boolean {
    this.start();
    return true;
  }

  handleAnyInput(): boolean {
    this.start();
    return true;
  }

  private start(): void {
    if (this.started || !this.isVisible) return;
    this.started = true;
    uiSound('confirm');
    this.el.classList.add('is-leaving');
    this.props.onStart();
  }
}
