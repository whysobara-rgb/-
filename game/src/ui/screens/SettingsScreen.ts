/**
 * Settings with four tabs (doc §13 accessibility first):
 *  게임  — language, grab mode hold/toggle, tutorial hints
 *  조작  — keyboard + gamepad rebinding ("키를 누르세요" capture via onRebind promise), reset.
 *          Rows the platform changed as a side effect (conflict swaps) are highlighted with a
 *          short note, and any input still bound to two actions is flagged (icon + text).
 *  오디오 — master / music / sfx / ui volume, subtitles
 *  화면  — fullscreen, quality, screen shake, reduced motion, UI scale, vibration
 *
 * The screen never persists or applies anything itself: every change goes through
 * `onChange(key, value)`; game flow saves and applies (setLanguage, setUiScale, ...).
 */
import { LANGUAGES, t, type Language } from '../i18n';
import { h } from '../core/dom';
import { icon } from '../core/icons';
import { navigable, uiSound } from '../core/nav';
import { bindingChip, type BindingDevice } from '../core/prompts';
import { UiScreen } from '../core/screen';
import { button, cyclerRow, promptBar, screenHeader, sliderRow, stagger, switchRow, tabs } from '../components/controls';
import type { GrabMode, Quality } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

export interface UiVolumes {
  master: number;
  music: number;
  sfx: number;
  ui: number;
}

/** Everything the settings screen edits (mirrors platform Settings + uiScale). */
export interface UiSettings {
  language: Language;
  grabMode: GrabMode;
  showTutorialHints: boolean;
  volumes: UiVolumes;
  subtitles: boolean;
  fullscreen: boolean;
  quality: Quality;
  /** 0..1 */
  screenShake: number;
  reducedMotion: boolean;
  /** 0.8..1.4 */
  uiScale: number;
  vibration: boolean;
}

export type BindableAction = 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'grab' | 'dash' | 'ping' | 'pause';
export const BINDABLE_ACTIONS: readonly BindableAction[] = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'grab', 'dash', 'ping', 'pause'];

export interface BindingRow {
  /** Action id; label is `action.<id>` unless labelKey is given. */
  action: BindableAction | string;
  labelKey?: string;
  /** KeyboardEvent.code, e.g. 'KeyW', 'Space'. Null = unbound. */
  keyboard: string | null;
  /** Gamepad code, e.g. 'button:0', 'axis:1:-'. Null = unbound. */
  gamepad: string | null;
}

/**
 * What `onRebind` resolves with:
 * - `null` — cancelled (Esc, timeout): nothing changed.
 * - `{ bindings }` — PREFERRED: the complete table after the change (e.g. the platform's
 *   `input.bindingRows()`), so swaps the platform made on other actions show up at once.
 * - a code string — minimal form: only the captured code. The screen then mirrors the
 *   platform's swap rule locally (an action that used the same code receives the captured
 *   action's previous code) and flags anything that still clashes.
 */
export type RebindOutcome = { bindings: readonly BindingRow[] } | string | null;

export type SettingsTab = 'game' | 'controls' | 'audio' | 'display';
const TABS: readonly { key: SettingsTab; label: string; icon: 'settings' | 'gamepad' | 'speaker' | 'display' }[] = [
  { key: 'game', label: 'settings.tab.game', icon: 'settings' },
  { key: 'controls', label: 'settings.tab.controls', icon: 'gamepad' },
  { key: 'audio', label: 'settings.tab.audio', icon: 'speaker' },
  { key: 'display', label: 'settings.tab.display', icon: 'display' },
];

export interface SettingsScreenProps {
  settings: UiSettings;
  bindings: readonly BindingRow[];
  tab?: SettingsTab;
  /** Hide the fullscreen row where it does not apply. Default true. */
  showFullscreen?: boolean;
  /** Hide vibration when no gamepad support. Default true. */
  showVibration?: boolean;
  onChange: <K extends keyof UiSettings>(key: K, value: UiSettings[K]) => void;
  /**
   * Start capturing a new binding; the platform input module owns the actual capture.
   * Resolve with the full binding table after the change (preferred), the new code, or null
   * when cancelled — see RebindOutcome. Typical wiring:
   *   onRebind: async (a, d) => (await input.startRebind(a, d)) ? { bindings: input.bindingRows() } : null
   */
  onRebind: (action: string, device: BindingDevice) => Promise<RebindOutcome>;
  /** Restore default bindings; return the new rows. */
  onResetBindings: () => Promise<readonly BindingRow[]> | readonly BindingRow[];
  onBack: () => void;
}

const pct = (v: number): string => `${Math.round(v * 100)}`;
const actionLabelKey = (b: BindingRow): string => b.labelKey ?? `action.${b.action}`;

export class SettingsScreen extends UiScreen<SettingsScreenProps> {
  private tab: SettingsTab;
  private settings: UiSettings;
  private bindings: BindingRow[];
  private capturing: { action: string; device: BindingDevice } | null = null;
  private dialog: ConfirmDialog | null = null;
  /** Cells changed as a side effect of the last rebind ("action:device"). */
  private swapped = new Set<string>();
  /** Action whose input was taken by the last rebind (for the swap note). */
  private swapNote: string | null = null;

  constructor(props: SettingsScreenProps) {
    super(props, { name: 'settings' });
    this.tab = props.tab ?? 'game';
    this.settings = { ...props.settings, volumes: { ...props.settings.volumes } };
    this.bindings = props.bindings.map((b) => ({ ...b }));
  }

  override update(patch: Partial<SettingsScreenProps>): this {
    if (patch.settings) this.settings = { ...patch.settings, volumes: { ...patch.settings.volumes } };
    if (patch.bindings) this.bindings = patch.bindings.map((b) => ({ ...b }));
    if (patch.tab) this.tab = patch.tab;
    return super.update(patch);
  }

  get activeTab(): SettingsTab {
    return this.tab;
  }

  setTab(tab: SettingsTab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.clearSwapNote();
    uiSound('tab');
    this.rerender();
    this.focus.ensure(`tab:${tab}`);
  }

  protected override defaultFocus(): string {
    return this.firstRowId();
  }

  protected override onBack(): boolean {
    if (this.capturing) return true;
    this.leave(this.props.onBack);
    return true;
  }

  protected override onTab(dir: -1 | 1): boolean {
    if (this.capturing) return true;
    const i = TABS.findIndex((x) => x.key === this.tab);
    const next = TABS[(i + dir + TABS.length) % TABS.length].key;
    this.setTab(next);
    this.focus.ensure(this.firstRowId());
    return true;
  }

  override handleNav(action: Parameters<UiScreen<SettingsScreenProps>['handleNav']>[0]): boolean {
    // While a capture is pending, the platform owns input; swallow menu nav.
    if (this.capturing) return true;
    return super.handleNav(action);
  }

  protected override onDestroy(): void {
    this.dialog?.destroy();
  }

  private firstRowId(): string {
    switch (this.tab) {
      case 'game':
        return 'set:language';
      case 'controls':
        return `bind:${this.bindings[0]?.action ?? 'moveUp'}:keyboard`;
      case 'audio':
        return 'set:master';
      case 'display':
        return this.props.showFullscreen === false ? 'set:quality' : 'set:fullscreen';
    }
  }

  private change<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void {
    this.settings = { ...this.settings, [key]: value };
    this.props.onChange(key, value);
  }

  private setVolume(k: keyof UiVolumes, v: number): void {
    this.change('volumes', { ...this.settings.volumes, [k]: v });
  }

  protected render(): void {
    const tabBar = tabs(
      TABS.map((x) => ({ key: x.key, label: x.label, icon: x.icon })),
      this.tab,
      (k) => this.setTab(k),
    );
    let content: HTMLElement;
    switch (this.tab) {
      case 'game':
        content = this.renderGame();
        break;
      case 'controls':
        content = this.renderControls();
        break;
      case 'audio':
        content = this.renderAudio();
        break;
      default:
        content = this.renderDisplay();
    }
    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-settings' },
        screenHeader('settings.title', null, 'settings', tabBar),
        h('div', { class: 'uh-settings__panel uh-panel' }, h('div', { class: 'uh-scroll uh-settings__scroll' }, content)),
        promptBar([
          { action: 'tabPrev', label: 'prompt.tabs' },
          { action: 'adjust', label: 'prompt.adjust' },
          { action: 'confirm', label: this.tab === 'controls' ? 'prompt.rebind' : 'prompt.select' },
          { action: 'back', label: 'prompt.back', onClick: () => this.leave(this.props.onBack) },
        ]),
      ),
    );
  }

  private renderGame(): HTMLElement {
    const s = this.settings;
    return stagger(
      h(
        'div',
        { class: 'uh-settings__rows' },
        cyclerRow<Language>({
          id: 'set:language',
          label: 'settings.language',
          icon: 'globe',
          options: LANGUAGES.map((l) => ({ value: l, label: `lang.${l}` })),
          value: s.language,
          onChange: (v) => this.change('language', v),
        }),
        cyclerRow<GrabMode>({
          id: 'set:grabMode',
          label: 'settings.grabMode',
          desc: 'settings.grabMode.desc',
          icon: 'hand',
          options: [
            { value: 'hold', label: 'settings.grabMode.hold' },
            { value: 'toggle', label: 'settings.grabMode.toggle' },
          ],
          value: s.grabMode,
          onChange: (v) => this.change('grabMode', v),
        }),
        switchRow({
          id: 'set:hints',
          label: 'settings.tutorialHints',
          desc: 'settings.tutorialHints.desc',
          icon: 'sparkle',
          value: s.showTutorialHints,
          onChange: (v) => this.change('showTutorialHints', v),
        }),
      ),
    );
  }

  private renderAudio(): HTMLElement {
    const v = this.settings.volumes;
    return stagger(
      h(
        'div',
        { class: 'uh-settings__rows' },
        sliderRow({ id: 'set:master', label: 'settings.audio.master', icon: 'speaker', value: v.master, format: pct, onChange: (x) => this.setVolume('master', x) }),
        sliderRow({ id: 'set:music', label: 'settings.audio.music', value: v.music, format: pct, onChange: (x) => this.setVolume('music', x) }),
        sliderRow({ id: 'set:sfx', label: 'settings.audio.sfx', value: v.sfx, format: pct, onChange: (x) => this.setVolume('sfx', x) }),
        sliderRow({ id: 'set:ui', label: 'settings.audio.ui', value: v.ui, format: pct, onChange: (x) => this.setVolume('ui', x) }),
        switchRow({
          id: 'set:subtitles',
          label: 'settings.subtitles',
          desc: 'settings.subtitles.desc',
          value: this.settings.subtitles,
          onChange: (x) => this.change('subtitles', x),
        }),
      ),
    );
  }

  private renderDisplay(): HTMLElement {
    const s = this.settings;
    return stagger(
      h(
        'div',
        { class: 'uh-settings__rows' },
        this.props.showFullscreen === false
          ? null
          : switchRow({ id: 'set:fullscreen', label: 'settings.fullscreen', icon: 'display', value: s.fullscreen, onChange: (x) => this.change('fullscreen', x) }),
        cyclerRow<Quality>({
          id: 'set:quality',
          label: 'settings.quality',
          icon: 'sparkle',
          options: [
            { value: 'low', label: 'quality.low' },
            { value: 'medium', label: 'quality.medium' },
            { value: 'high', label: 'quality.high' },
          ],
          value: s.quality,
          wrap: false,
          onChange: (x) => this.change('quality', x),
        }),
        sliderRow({ id: 'set:shake', label: 'settings.screenShake', value: s.screenShake, format: pct, onChange: (x) => this.change('screenShake', x) }),
        switchRow({
          id: 'set:reducedMotion',
          label: 'settings.reducedMotion',
          desc: 'settings.reducedMotion.desc',
          value: s.reducedMotion,
          onChange: (x) => this.change('reducedMotion', x),
        }),
        sliderRow({
          id: 'set:uiScale',
          label: 'settings.uiScale',
          value: s.uiScale,
          min: 0.8,
          max: 1.4,
          step: 0.05,
          format: (x) => `${Math.round(x * 100)}%`,
          onChange: (x) => this.change('uiScale', x),
        }),
        this.props.showVibration === false
          ? null
          : switchRow({ id: 'set:vibration', label: 'settings.vibration', icon: 'gamepad', value: s.vibration, onChange: (x) => this.change('vibration', x) }),
      ),
    );
  }

  private renderControls(): HTMLElement {
    const head = h(
      'div',
      { class: 'uh-binds__head' },
      h('span', null, t('settings.controls.action')),
      h('span', null, icon('keyboard'), t('settings.controls.keyboard')),
      h('span', null, icon('gamepad'), t('settings.controls.gamepad')),
    );
    const clashes = this.findClashes();
    const rows = this.bindings.map((b) =>
      h(
        'div',
        { class: 'uh-binds__row' },
        h('span', { class: 'uh-binds__label' }, t(actionLabelKey(b))),
        this.bindCell(b, 'keyboard', clashes),
        this.bindCell(b, 'gamepad', clashes),
      ),
    );
    // One message slot (same height whatever it says): a clash warning wins, then the note
    // about a swap the last rebind caused, otherwise the usage hint.
    const swapRow = this.swapNote ? this.bindings.find((r) => r.action === this.swapNote) : undefined;
    const message = clashes.size
      ? h('p', { class: 'uh-binds__msg uh-binds__note uh-binds__note--clash' }, icon('alert'), t('settings.controls.conflict'))
      : swapRow
        ? h('p', { class: 'uh-binds__msg uh-binds__note uh-binds__note--swap' }, icon('swap'), t('settings.controls.swapped', { action: actionLabelKey(swapRow) }))
        : h('p', { class: 'uh-binds__msg uh-binds__hint' }, t('settings.controls.hint'));
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    const reset = button({
      id: 'bind:reset',
      label: 'settings.controls.reset',
      icon: 'reset',
      size: 'sm',
      variant: 'night',
      onActivate: () => this.confirmReset(),
    });
    return h(
      'div',
      { class: 'uh-binds' },
      message,
      head,
      stagger(h('div', { class: 'uh-binds__rows' }, rows)),
      h('div', { class: 'uh-binds__foot' }, reset),
    );
  }

  private bindCell(b: BindingRow, device: BindingDevice, clashes: ReadonlySet<string>): HTMLElement {
    const code = device === 'keyboard' ? b.keyboard : b.gamepad;
    const cellKey = `${b.action}:${device}`;
    const capturingThis = this.capturing?.action === b.action && this.capturing.device === device;
    const clash = !capturingThis && clashes.has(cellKey);
    const swapped = !capturingThis && !clash && this.swapped.has(cellKey);
    const cell = h(
      'div',
      {
        class: ['uh-binds__cell', capturingThis ? 'is-capturing' : '', clash ? 'is-clash' : '', swapped ? 'is-swapped' : ''],
        role: 'button',
        title: clash ? t('settings.controls.conflict') : null,
      },
      capturingThis
        ? h('span', { class: 'uh-binds__capture' }, t(device === 'keyboard' ? 'settings.controls.pressKey' : 'settings.controls.pressButton'))
        : code
          ? bindingChip(device, code)
          : h('span', { class: 'uh-binds__unbound' }, t('settings.controls.unbound')),
      // Never color alone: a clash / swap carries an icon + word tag.
      clash
        ? h('span', { class: 'uh-binds__tag uh-binds__tag--clash' }, icon('alert'), t('settings.controls.conflictTag'))
        : swapped
          ? h('span', { class: 'uh-binds__tag uh-binds__tag--swap' }, icon('swap'), t('settings.controls.swappedTag'))
          : null,
    );
    return navigable(cell, `bind:${b.action}:${device}`, { onActivate: () => void this.capture(b.action, device) });
  }

  /** Cells ("action:device") whose input is also bound to another action on that device. */
  private findClashes(): Set<string> {
    const out = new Set<string>();
    for (const device of ['keyboard', 'gamepad'] as const) {
      const byCode = new Map<string, string[]>();
      for (const r of this.bindings) {
        const code = device === 'keyboard' ? r.keyboard : r.gamepad;
        if (!code) continue;
        const list = byCode.get(code) ?? [];
        list.push(r.action);
        byCode.set(code, list);
      }
      for (const list of byCode.values()) if (list.length > 1) for (const a of list) out.add(`${a}:${device}`);
    }
    return out;
  }

  private clearSwapNote(): void {
    this.swapped.clear();
    this.swapNote = null;
  }

  private async capture(action: string, device: BindingDevice): Promise<void> {
    if (this.capturing) return;
    this.capturing = { action, device };
    this.clearSwapNote();
    this.rerender();
    let outcome: RebindOutcome = null;
    try {
      outcome = await this.props.onRebind(action, device);
    } catch (err) {
      console.error('[ui] rebind failed', err);
    }
    this.capturing = null;
    if (outcome !== null && outcome !== undefined && outcome !== '') this.applyRebind(action, device, outcome);
    if (!this.isVisible) return;
    this.rerender();
    this.focus.ensure(`bind:${action}:${device}`);
  }

  /** Apply a rebind outcome and remember which OTHER cells changed because of it. */
  private applyRebind(action: string, device: BindingDevice, outcome: Exclude<RebindOutcome, null>): void {
    const before = this.bindings.map((r) => ({ ...r }));
    if (typeof outcome === 'string') {
      const row = this.bindings.find((r) => r.action === action);
      if (!row) return;
      const previous = row[device];
      row[device] = outcome;
      // Mirror the platform's rule: whoever used this code gets our previous one (swap).
      for (const other of this.bindings) {
        if (other !== row && other[device] === outcome) other[device] = previous !== outcome ? previous : null;
      }
    } else {
      this.bindings = outcome.bindings.map((r) => ({ ...r }));
    }
    for (const r of this.bindings) {
      if (r.action === action) continue;
      const old = before.find((x) => x.action === r.action);
      for (const d of ['keyboard', 'gamepad'] as const) {
        if (old && old[d] !== r[d]) {
          this.swapped.add(`${r.action}:${d}`);
          if (d === device && !this.swapNote) this.swapNote = r.action;
        }
      }
    }
  }

  private confirmReset(): void {
    this.dialog?.destroy();
    this.dialog = new ConfirmDialog({
      titleKey: 'settings.controls.resetConfirm.title',
      bodyKey: 'settings.controls.resetConfirm.body',
      confirmKey: 'settings.controls.resetConfirm.ok',
      danger: true,
      onConfirm: async () => {
        this.dialog?.destroy();
        this.dialog = null;
        const rows = await this.props.onResetBindings();
        this.bindings = rows.map((r) => ({ ...r }));
        this.clearSwapNote();
        this.rerender();
        this.focus.ensure('bind:reset');
      },
      onCancel: () => {
        this.dialog?.destroy();
        this.dialog = null;
      },
    });
    this.dialog.show();
  }
}
