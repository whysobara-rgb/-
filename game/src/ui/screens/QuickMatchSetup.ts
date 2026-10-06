/**
 * Quick match setup (doc §12: everything open from the start, no unlock gates).
 * Rows: 모드 (1:1 / 2:2) · 배치 (layouts + 무작위) · 상대 성향 (3 rivals + 무작위) · 난이도.
 * Right column previews the chosen layout map and the rival's habit / weak spot.
 */
import type { LayoutDef, LayoutId } from '../../sim/types';
import { t, tr, type TextRef } from '../i18n';
import { h } from '../core/dom';
import { icon, raccoon, teamEmblem } from '../core/icons';
import { UiScreen } from '../core/screen';
import { button, chip, cyclerRow, promptBar, screenHeader, stagger, type CyclerOption } from '../components/controls';
import { LayoutMap } from '../components/layoutMap';
import { DIFFICULTIES, MATCH_MODES, RIVAL_ORDER, type Difficulty, type MatchMode, type RivalId } from '../types';

export interface QuickMatchOptions {
  mode: MatchMode;
  layout: LayoutId | 'random';
  rival: RivalId | 'random';
  difficulty: Difficulty;
}

export interface QuickLayoutChoice {
  id: LayoutId;
  nameKey: string;
  descKey: string;
  /** Full layout for the thumbnail map (optional). */
  layout?: LayoutDef | null;
}

export interface QuickMatchSetupProps {
  layouts: readonly QuickLayoutChoice[];
  value: QuickMatchOptions;
  onChange?: (value: QuickMatchOptions) => void;
  onStart: (value: QuickMatchOptions) => void;
  onBack: () => void;
}

export class QuickMatchSetup extends UiScreen<QuickMatchSetupProps> {
  private value: QuickMatchOptions;
  private map: LayoutMap | null = null;
  private side: HTMLElement | null = null;

  constructor(props: QuickMatchSetupProps) {
    super(props, { name: 'quick' });
    this.value = { ...props.value };
  }

  /** Current selection (also reported through onChange). */
  getValue(): QuickMatchOptions {
    return { ...this.value };
  }

  override update(patch: Partial<QuickMatchSetupProps>): this {
    if (patch.value) this.value = { ...patch.value };
    return super.update(patch);
  }

  protected override defaultFocus(): string {
    return 'quick:start';
  }

  protected override onBack(): boolean {
    this.props.onBack();
    return true;
  }

  private set<K extends keyof QuickMatchOptions>(key: K, v: QuickMatchOptions[K]): void {
    this.value = { ...this.value, [key]: v };
    this.props.onChange?.(this.getValue());
    this.paintSide();
  }

  protected render(): void {
    const modeOpts: CyclerOption<MatchMode>[] = MATCH_MODES.map((m) => ({ value: m, label: `mode.${m}` }));
    const layoutOpts: CyclerOption<LayoutId | 'random'>[] = [
      ...this.props.layouts.map((l) => ({ value: l.id as LayoutId | 'random', label: l.nameKey })),
      { value: 'random', label: 'layout.random', art: () => icon('dice') },
    ];
    const rivalOpts: CyclerOption<RivalId | 'random'>[] = [
      ...RIVAL_ORDER.map((r) => ({ value: r as RivalId | 'random', label: `rival.${r}.name` })),
      { value: 'random', label: 'common.random', art: () => icon('dice') },
    ];
    const diffOpts: CyclerOption<Difficulty>[] = DIFFICULTIES.map((d) => ({ value: d, label: `difficulty.${d}` }));

    const rows = h(
      'div',
      { class: 'uh-quick__rows' },
      cyclerRow({
        id: 'quick:mode',
        label: 'quick.mode',
        desc: `mode.${this.value.mode}.desc`,
        icon: 'flag',
        options: modeOpts,
        value: this.value.mode,
        onChange: (v) => {
          this.set('mode', v);
          this.rerender();
        },
      }),
      cyclerRow({ id: 'quick:layout', label: 'quick.layout', icon: 'map', options: layoutOpts, value: this.value.layout, onChange: (v) => this.set('layout', v) }),
      cyclerRow({ id: 'quick:rival', label: 'quick.opponent', icon: 'sparkle', options: rivalOpts, value: this.value.rival, onChange: (v) => this.set('rival', v) }),
      cyclerRow({
        id: 'quick:difficulty',
        label: 'quick.difficulty',
        desc: `difficulty.${this.value.difficulty}.desc`,
        icon: 'bolt',
        options: diffOpts,
        value: this.value.difficulty,
        onChange: (v) => {
          this.set('difficulty', v);
          this.rerender();
        },
      }),
    );
    stagger(rows);

    const start = button({
      id: 'quick:start',
      label: 'quick.start',
      variant: 'primary',
      size: 'lg',
      glyph: 'confirm',
      className: 'uh-quick__start',
      onActivate: () => this.props.onStart(this.getValue()),
    });

    this.side = h('aside', { class: 'uh-quick__side' });
    this.map = new LayoutMap(null, { compact: true });
    this.own(() => this.map?.destroy());

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-quick' },
        screenHeader('quick.title', 'quick.subtitle', 'quick'),
        h(
          'div',
          { class: 'uh-quick__body' },
          h('div', { class: 'uh-quick__main uh-panel' }, h('div', { class: 'uh-quick__scroll uh-scroll' }, rows), h('div', { class: 'uh-quick__startWrap' }, h('p', { class: 'uh-quick__note' }, t('difficulty.note')), start)),
          this.side,
        ),
        promptBar([
          { action: 'adjust', label: 'prompt.adjust' },
          { action: 'confirm', label: 'prompt.select' },
          { action: 'back', label: 'prompt.back', onClick: () => this.props.onBack() },
        ]),
      ),
    );
    this.paintSide();
  }

  private paintSide(): void {
    const side = this.side;
    if (!side || !this.map) return;
    const v = this.value;
    const choice = v.layout === 'random' ? null : this.props.layouts.find((l) => l.id === v.layout) ?? null;

    // Layout card
    const mapBox = h('div', { class: 'uh-quick__mapBox' });
    if (choice?.layout) {
      this.map.setLayout(choice.layout);
      mapBox.appendChild(this.map.el);
      requestAnimationFrame(() => this.map?.draw());
    } else {
      mapBox.appendChild(h('div', { class: 'uh-quick__mystery' }, icon('dice'), h('span', null, '?')));
    }
    const layoutCard = h(
      'section',
      { class: 'uh-quick__card uh-panel' },
      mapBox,
      h(
        'div',
        { class: 'uh-quick__cardText' },
        h('h3', { class: 'uh-quick__cardTitle' }, choice ? t(choice.nameKey) : t('quick.randomLayout')),
        h('p', { class: 'uh-quick__cardDesc' }, choice ? t(choice.descKey) : t('quick.randomLayout.desc')),
      ),
    );

    // Rival card
    const rival = v.rival;
    const rivalCard =
      rival === 'random'
        ? h(
            'section',
            { class: 'uh-quick__rival uh-panel' },
            h('div', { class: 'uh-quick__portrait is-mystery' }, raccoon({ silhouette: true, expression: 'smug' })),
            h(
              'div',
              { class: 'uh-quick__rivalText' },
              h('h3', { class: 'uh-quick__cardTitle' }, t('quick.randomRival')),
              h('p', { class: 'uh-quick__cardDesc' }, t('quick.randomRival.desc')),
            ),
          )
        : h(
            'section',
            { class: 'uh-quick__rival uh-panel' },
            h('div', { class: 'uh-quick__portrait' }, raccoon({ rival, team: 1 })),
            h(
              'div',
              { class: 'uh-quick__rivalText' },
              h(
                'h3',
                { class: 'uh-quick__cardTitle' },
                t(`rival.${rival}.name`),
                h('span', { class: 'uh-quick__rivalTitle' }, t(`rival.${rival}.title`)),
              ),
              this.factLine('quick.habit', `rival.${rival}.personality`),
              this.factLine('quick.weakness', `rival.${rival}.weakness`),
            ),
          );

    const vs = h(
      'div',
      { class: 'uh-quick__vsline' },
      chip(`mode.${v.mode}`, 'gold'),
      h('span', { class: 'uh-quick__vsText' }, t(`mode.${v.mode}.desc`)),
      h('span', { class: 'uh-quick__emblems' }, teamEmblem(0), h('b', null, t('common.vs')), teamEmblem(1)),
      chip(`difficulty.${v.difficulty}`, 'night'),
    );
    side.replaceChildren(layoutCard, rivalCard, vs);
  }

  private factLine(label: TextRef, body: TextRef): HTMLElement {
    return h('p', { class: 'uh-quick__fact' }, h('span', { class: 'uh-quick__factLabel' }, tr(label)), h('span', null, tr(body)));
  }
}
