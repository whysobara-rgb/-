/**
 * Loading: a raccoon dragging a bank along a progress track, plus rotating tips.
 * `setProgress(p)` with 0..1, or null for indeterminate.
 */
import { t, type TextRef, tr } from '../i18n';
import { h, setText } from '../core/dom';
import { lootIcon, raccoon } from '../core/icons';
import { UiScreen } from '../core/screen';
import { chunky } from '../core/juice';

export interface LoadingScreenProps {
  /** 0..1, or null for an indeterminate shimmer. */
  progress?: number | null;
  title?: TextRef;
  /** First tip index (1-based, wraps). Random when omitted. */
  tip?: number;
  /** Tip rotation interval in ms (default 5200; 0 = never rotate). */
  tipIntervalMs?: number;
}

const TIP_COUNT = 10;

export class LoadingScreen extends UiScreen<LoadingScreenProps> {
  private bar: HTMLElement | null = null;
  private tipText: HTMLElement | null = null;
  private tipIndex: number;
  private tipTimer = 0;

  constructor(props: LoadingScreenProps = {}) {
    super(props, { name: 'loading', layer: 'dialogs' });
    this.tipIndex = props.tip ?? 1 + Math.floor(Math.random() * TIP_COUNT);
  }

  setProgress(p: number | null): void {
    this.props = { ...this.props, progress: p };
    this.paintProgress();
  }

  override handleNav(): boolean {
    return true; // nothing to navigate while loading
  }

  protected render(): void {
    this.bar = h('div', { class: 'uh-loading__track' }, h('div', { class: 'uh-loading__fill' }), h('div', { class: 'uh-loading__haul' }, h('div', { class: 'uh-loading__bank' }, lootIcon('bank')), h('div', { class: 'uh-loading__racc' }, raccoon({ hat: 'teamCapA', expression: 'determined' }))));
    this.tipText = h('p', { class: 'uh-loading__tipText' });
    this.el.append(
      h('div', { class: 'uh-loading__bg', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'uh-frame uh-loading' },
        chunky(tr(this.props.title ?? 'loading.title'), { tag: 'h1', cls: 'uh-loading__title', tone: 'cream' }),
        this.bar,
        h('div', { class: 'uh-loading__tip uh-panel' }, h('span', { class: 'uh-loading__tipLabel' }, t('loading.tip')), this.tipText),
      ),
    );
    this.paintProgress();
    this.paintTip();
  }

  protected override onShow(): void {
    window.clearInterval(this.tipTimer);
    const ms = this.props.tipIntervalMs ?? 5200;
    if (ms > 0) {
      this.tipTimer = window.setInterval(() => {
        this.tipIndex = (this.tipIndex % TIP_COUNT) + 1;
        this.paintTip();
      }, ms);
    }
  }

  protected override onHide(): void {
    window.clearInterval(this.tipTimer);
  }

  protected override onDestroy(): void {
    window.clearInterval(this.tipTimer);
  }

  private paintProgress(): void {
    if (!this.bar) return;
    const p = this.props.progress;
    const indeterminate = p === null || p === undefined;
    this.bar.classList.toggle('is-indeterminate', indeterminate);
    this.bar.style.setProperty('--p', String(indeterminate ? 0.5 : Math.max(0, Math.min(1, p))));
  }

  private paintTip(): void {
    if (this.tipText) setText(this.tipText, t(`tip.${this.tipIndex}`));
  }
}
