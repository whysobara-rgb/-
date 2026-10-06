/**
 * Global error handling: every distinct error is logged ONCE with its stack (console + the
 * desktop log file), and a non-fatal overlay offers "다시 시도" / "메뉴로". The game loop
 * keeps running behind it whenever possible — an error never leaves a frozen black window.
 */
import { getNative, nativeLog } from '../platform/native';
import { ConfirmDialog, t } from '../ui';

export interface ErrorReporterOptions {
  /** "다시 시도": resume / retry what failed. */
  onRetry: () => void;
  /** "메뉴로": abandon it and go to the main menu. */
  onMenu: () => void;
}

export function errorKey(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}\n${(err.stack ?? '').split('\n').slice(0, 3).join('\n')}`;
  return String(err);
}

export class ErrorReporter {
  private readonly seen = new Set<string>();
  private dialog: ConfirmDialog | null = null;
  private fallback: HTMLElement | null = null;
  private opts: ErrorReporterOptions | null = null;
  /** Retry for the failure on screen (e.g. re-run a failed match load); default: opts.onRetry. */
  private pendingRetry: (() => void) | null = null;
  /** True while the overlay is up (the app holds its loop). */
  halted = false;
  /** Count of reported errors (tests read it). */
  count = 0;

  install(opts: ErrorReporterOptions): void {
    this.opts = opts;
    window.addEventListener('error', (e) => {
      // Resource load errors (img/script) have no `error`; still worth one log line.
      this.report(e.error ?? new Error(e.message || 'window error'), 'window.onerror');
    });
    window.addEventListener('unhandledrejection', (e) => this.report(e.reason, 'unhandledrejection'));
  }

  /** Log once per distinct error and show the recovery overlay. */
  report(err: unknown, context: string, opts: { overlay?: boolean; retry?: () => void } = {}): void {
    this.count++;
    const key = errorKey(err);
    if (!this.seen.has(key)) {
      this.seen.add(key);
      const stack = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`[uproot] ${context}:`, err);
      try {
        // Desktop: also into userData/logs/main.log (in a browser the console line is the log).
        if (getNative()) nativeLog('error', `${context}: ${stack}`);
      } catch {
        // logging must never throw
      }
    }
    if (opts.overlay !== false) {
      if (!this.dialog && !this.fallback) this.pendingRetry = opts.retry ?? null;
      this.showOverlay(err);
    }
  }

  private showOverlay(err: unknown): void {
    if (this.dialog || this.fallback) return;
    this.halted = true;
    const msg = err instanceof Error ? err.message : String(err);
    try {
      this.dialog = new ConfirmDialog({
        titleKey: 'error.title',
        bodyKey: 'error.detail',
        params: { message: msg.slice(0, 160) },
        confirmKey: 'error.retry',
        cancelKey: 'error.menu',
        defaultFocus: 'confirm',
        onConfirm: () => this.close('retry'),
        onCancel: () => this.close('menu'),
      });
      this.dialog.el.classList.add('uh-error-dialog');
      this.dialog.show();
    } catch {
      this.dialog = null;
      this.showFallback(msg);
    }
  }

  /** Plain DOM overlay for failures before / outside the UI layer. */
  showFallback(msg: string): void {
    if (this.fallback) return;
    this.halted = true;
    const el = document.createElement('div');
    el.className = 'uh-fatal';
    el.setAttribute('role', 'alertdialog');
    const title = safeT('error.title', '앗, 뭔가 삐끗했어요');
    const body = safeT('error.body', '다시 시도하거나 메뉴로 돌아가요.');
    el.innerHTML = '<div class="uh-fatal__card"><h1></h1><p class="uh-fatal__body"></p><p class="uh-fatal__msg"></p><div class="uh-fatal__buttons"><button data-act="retry"></button><button data-act="menu"></button></div></div>';
    el.querySelector('h1')!.textContent = title;
    el.querySelector('.uh-fatal__body')!.textContent = body;
    el.querySelector('.uh-fatal__msg')!.textContent = msg.slice(0, 200);
    const [retry, menu] = Array.from(el.querySelectorAll('button'));
    retry!.textContent = safeT('error.retry', '다시 시도');
    menu!.textContent = safeT('error.menu', '메뉴로');
    retry!.addEventListener('click', () => this.close('retry'));
    menu!.addEventListener('click', () => this.close('menu'));
    document.body.appendChild(el);
    this.fallback = el;
  }

  private close(action: 'retry' | 'menu'): void {
    this.dialog?.destroy();
    this.dialog = null;
    this.fallback?.remove();
    this.fallback = null;
    this.halted = false;
    const retry = this.pendingRetry;
    this.pendingRetry = null;
    try {
      if (action === 'retry') (retry ?? this.opts?.onRetry)?.();
      else this.opts?.onMenu();
    } catch (err) {
      this.report(err, `error overlay ${action}`);
    }
  }
}

function safeT(key: string, fallback: string): string {
  try {
    const v = t(key);
    return v && v !== key && !v.startsWith('⟦') ? v : fallback;
  } catch {
    return fallback;
  }
}
