/**
 * In-match pause: 계속 · 설정 · 다시 시작 · 메뉴로. Back resumes. Restart / menu ask for
 * confirmation (cancel focused) unless `confirmDestructive` is false. Also shows a short
 * controls reminder with live prompt glyphs.
 */
import { t, type TextRef } from '../i18n';
import { h } from '../core/dom';
import { glyphChip, type PromptAction } from '../core/prompts';
import { UiScreen } from '../core/screen';
import { chunky } from '../core/juice';
import { button, chip, promptBar, stagger } from '../components/controls';
import { ConfirmDialog } from './ConfirmDialog';
import type { GrabMode } from '../types';

export interface PauseMenuProps {
  onResume: () => void;
  onSettings: () => void;
  onRestart: () => void;
  onMenu: () => void;
  /** Ask before restart / leaving (default true). */
  confirmDestructive?: boolean;
  /** Context chip, e.g. '빠른 대전 · 수집 광장'. */
  context?: TextRef | null;
  /** Body text of the leave-to-menu confirmation (default 'pause.menuConfirm.body'). */
  menuConfirmBody?: string | null;
  /** Hide 다시 시작 (e.g. tutorial). Default true. */
  showRestart?: boolean;
  /** For the controls reminder line. */
  grabMode?: GrabMode;
}

export class PauseMenu extends UiScreen<PauseMenuProps> {
  private dialog: ConfirmDialog | null = null;

  constructor(props: PauseMenuProps) {
    super(props, { name: 'pause' });
  }

  protected override defaultFocus(): string {
    return 'pause:resume';
  }

  protected override onBack(): boolean {
    this.leave(this.props.onResume);
    return true;
  }

  protected override onHide(): void {
    this.closeDialog();
  }

  protected override onDestroy(): void {
    this.closeDialog();
  }

  protected render(): void {
    const p = this.props;
    const buttons = stagger(
      h(
        'div',
        { class: 'uh-pause__buttons' },
        button({ id: 'pause:resume', label: 'pause.resume', variant: 'primary', size: 'lg', icon: 'play', onActivate: () => this.leave(p.onResume) }),
        button({ id: 'pause:settings', label: 'pause.settings', icon: 'settings', onActivate: () => this.leave(p.onSettings) }),
        p.showRestart === false
          ? null
          : button({ id: 'pause:restart', label: 'pause.restart', icon: 'reset', onActivate: () => this.ask('restart') }),
        button({ id: 'pause:menu', label: 'pause.menu', icon: 'home', onActivate: () => this.ask('menu') }),
      ),
    );
    const hint = (action: PromptAction, key: string): HTMLElement =>
      h('span', { class: 'uh-pause__hint' }, glyphChip(action), t(key));
    this.el.append(
      h('div', { class: 'uh-dim uh-dim--stripes' }),
      h(
        'div',
        { class: 'uh-frame uh-pause' },
        h(
          'div',
          { class: 'uh-pause__card uh-panel' },
          h('div', { class: 'uh-pause__badge' }, h('span', { class: 'uh-pause__bars' })),
          chunky(t('pause.title'), { tag: 'h1', cls: 'uh-pause__title', tone: 'cream' }),
          p.context ? h('div', { class: 'uh-pause__context' }, chip(p.context, 'gold', 'map')) : null,
          buttons,
          h(
            'div',
            { class: 'uh-pause__hints' },
            hint('move', 'hint.move'),
            hint('grab', 'hint.grab'),
            hint('dash', 'hint.dash'),
            hint('ping', 'hint.ping'),
            hint('emoteWheel', 'hint.emoteWheel'),
          ),
          h('p', { class: 'uh-pause__grabNote' }, t(p.grabMode === 'toggle' ? 'hint.grabToggle' : 'hint.grabHold')),
        ),
        promptBar([
          { action: 'confirm', label: 'prompt.select' },
          { action: 'back', label: 'pause.resume', onClick: () => this.leave(p.onResume) },
        ]),
      ),
    );
  }

  private ask(kind: 'restart' | 'menu'): void {
    const act = kind === 'restart' ? this.props.onRestart : this.props.onMenu;
    if (this.props.confirmDestructive === false) {
      this.leave(act);
      return;
    }
    this.closeDialog();
    this.dialog = new ConfirmDialog({
      titleKey: kind === 'restart' ? 'pause.restartConfirm.title' : 'pause.menuConfirm.title',
      bodyKey: kind === 'restart' ? 'pause.restartConfirm.body' : this.props.menuConfirmBody ?? 'pause.menuConfirm.body',
      confirmKey: kind === 'restart' ? 'pause.restartConfirm.ok' : 'pause.menuConfirm.ok',
      danger: true,
      onConfirm: () => {
        this.closeDialog();
        this.leave(act);
      },
      onCancel: () => this.closeDialog(),
    });
    this.dialog.show();
  }

  private closeDialog(): void {
    this.dialog?.destroy();
    this.dialog = null;
  }
}
