/**
 * Modal yes/no dialog on the 'dialogs' layer. Back = cancel. Destructive dialogs focus
 * cancel by default so a stray confirm press never throws away a match.
 *
 *   const ok = await confirmDialog({ titleKey: 'pause.menuConfirm.title', danger: true });
 */
import { t, type TParams } from '../i18n';
import { h } from '../core/dom';
import { UiScreen } from '../core/screen';
import { button } from '../components/controls';

export interface ConfirmDialogProps {
  titleKey: string;
  bodyKey?: string | null;
  params?: TParams;
  confirmKey?: string;
  cancelKey?: string;
  /** Destructive action: red confirm button, cancel focused first. */
  danger?: boolean;
  defaultFocus?: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel: () => void;
}

export class ConfirmDialog extends UiScreen<ConfirmDialogProps> {
  constructor(props: ConfirmDialogProps) {
    super(props, { name: 'dialog', layer: 'dialogs', role: 'dialog' });
    this.el.setAttribute('aria-modal', 'true');
  }

  protected override defaultFocus(): string {
    const f = this.props.defaultFocus ?? (this.props.danger ? 'cancel' : 'confirm');
    return `dlg:${f}`;
  }

  protected override onBack(): boolean {
    this.leave(this.props.onCancel);
    return true;
  }

  protected render(): void {
    const p = this.props;
    this.el.append(
      h(
        'div',
        {
          class: 'uh-dialog-backdrop',
          onClick: (e: Event) => {
            if (e.target === e.currentTarget) this.leave(p.onCancel);
          },
        },
        h(
          'div',
          { class: 'uh-dialog uh-panel' },
          h('h2', { class: 'uh-dialog__title' }, t(p.titleKey, p.params)),
          p.bodyKey ? h('p', { class: 'uh-dialog__body' }, t(p.bodyKey, p.params)) : null,
          h(
            'div',
            { class: 'uh-dialog__buttons' },
            button({ id: 'dlg:cancel', label: p.cancelKey ?? 'common.cancel', onActivate: () => this.leave(p.onCancel) }),
            button({ id: 'dlg:confirm', label: p.confirmKey ?? 'common.confirm', variant: p.danger ? 'danger' : 'primary', onActivate: () => this.leave(p.onConfirm) }),
          ),
        ),
      ),
    );
  }
}

/** Promise helper: shows a dialog, resolves true on confirm / false on cancel, then destroys it. */
export function confirmDialog(opts: Omit<ConfirmDialogProps, 'onConfirm' | 'onCancel'>, parent?: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg: ConfirmDialog = new ConfirmDialog({
      ...opts,
      onConfirm: () => {
        dlg.destroy();
        resolve(true);
      },
      onCancel: () => {
        dlg.destroy();
        resolve(false);
      },
    });
    if (parent) dlg.mount(parent);
    dlg.show();
  });
}
