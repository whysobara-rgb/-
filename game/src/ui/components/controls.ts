/**
 * Reusable navigable controls. Each returns a plain element already registered with the
 * focus system (`navigable`), so screens just compose them.
 */
import type { TeamId } from '../../sim/types';
import { TEAM_STYLES } from '../../shared/teams';
import { t, tr, type TextRef } from '../i18n';
import { h, setText, type Child } from '../core/dom';
import { icon, teamEmblem, type IconName } from '../core/icons';
import { navigable, uiSound } from '../core/nav';
import { glyphChip, type PromptAction } from '../core/prompts';
import { clamp } from '../core/format';

// ---------------------------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------------------------

export interface ButtonOptions {
  id: string;
  label: TextRef;
  onActivate: () => void;
  variant?: 'default' | 'primary' | 'mint' | 'danger' | 'night';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Show a prompt glyph inside the button (e.g. confirm glyph on the primary action). */
  glyph?: PromptAction;
  disabled?: boolean;
  className?: string;
}

export function button(o: ButtonOptions): HTMLButtonElement {
  const el = h(
    'button',
    {
      type: 'button',
      tabindex: '-1',
      class: [
        'uh-btn',
        o.variant && o.variant !== 'default' ? `uh-btn--${o.variant}` : '',
        o.size && o.size !== 'md' ? `uh-btn--${o.size}` : '',
        o.className ?? '',
      ],
      'aria-disabled': o.disabled ? 'true' : null,
    },
    o.glyph ? glyphChip(o.glyph) : null,
    o.icon ? icon(o.icon) : null,
    h('span', { class: 'uh-btn__label' }, tr(o.label)),
  );
  return navigable(el, o.id, { onActivate: o.onActivate });
}

// ---------------------------------------------------------------------------------------------
// Option rows
// ---------------------------------------------------------------------------------------------

interface RowBase {
  id: string;
  label: TextRef;
  desc?: TextRef | null;
  icon?: IconName;
  disabled?: boolean;
}

function rowShell(o: RowBase, control: HTMLElement): HTMLDivElement {
  const el = h(
    'div',
    { class: 'uh-row', role: 'group', 'aria-disabled': o.disabled ? 'true' : null },
    h(
      'div',
      { class: 'uh-row__label' },
      h('div', { class: 'uh-row__name' }, o.icon ? icon(o.icon) : null, tr(o.label)),
      o.desc ? h('div', { class: 'uh-row__desc' }, tr(o.desc)) : null,
    ),
    h('div', { class: 'uh-row__control' }, control),
  );
  return el;
}

export interface CyclerOption<V> {
  value: V;
  label: TextRef;
  /** Optional leading visual (emblem, icon) for the value. */
  art?: () => Node;
}

export interface CyclerOptions<V> extends RowBase {
  options: readonly CyclerOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Wrap around at the ends (default true). */
  wrap?: boolean;
}

/** "Label ........ ‹ Value ›" row; left/right or confirm cycles, arrows clickable. */
export function cyclerRow<V>(o: CyclerOptions<V>): HTMLDivElement {
  let index = Math.max(0, o.options.findIndex((x) => x.value === o.value));
  const text = h('span', { class: 'uh-cycler__text' });
  const pips = h('div', { class: 'uh-pips' }, o.options.map(() => h('span', { class: 'uh-pip' })));
  const paint = (): void => {
    const opt = o.options[index];
    text.textContent = '';
    if (opt.art) text.appendChild(opt.art());
    text.appendChild(document.createTextNode(tr(opt.label)));
    Array.from(pips.children).forEach((p, i) => p.classList.toggle('is-on', i === index));
  };
  const step = (dir: -1 | 1): void => {
    let next = index + dir;
    if (o.wrap === false) next = clamp(next, 0, o.options.length - 1);
    else next = (next + o.options.length) % o.options.length;
    if (next === index) return;
    index = next;
    paint();
    o.onChange(o.options[index].value);
  };
  const arrow = (dir: -1 | 1): HTMLElement =>
    h(
      'span',
      {
        class: 'uh-cycler__arrow',
        role: 'button',
        'aria-label': dir < 0 ? 'previous' : 'next',
        onClick: (e: Event) => {
          e.stopPropagation();
          if (o.disabled) return uiSound('error');
          uiSound('adjust');
          step(dir);
        },
      },
      icon(dir < 0 ? 'chevLeft' : 'chevRight'),
    );
  const control = h('div', { class: 'uh-cycler' }, arrow(-1), h('div', { class: 'uh-cycler__value' }, text, pips), arrow(1));
  paint();
  const row = rowShell(o, control);
  return navigable(row, o.id, {
    onAdjust: (dir) => step(dir),
    onActivate: () => step(1),
  });
}

export interface SliderOptions extends RowBase {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Display formatter (default: percent of range). */
  format?: (v: number) => string;
  onChange: (value: number) => void;
}

/** Slider row; left/right steps, mouse drag/click sets. */
export function sliderRow(o: SliderOptions): HTMLDivElement {
  const min = o.min ?? 0;
  const max = o.max ?? 1;
  const stepSize = o.step ?? 0.05;
  let value = clamp(o.value, min, max);
  const fmt = o.format ?? ((v: number) => `${Math.round(((v - min) / (max - min)) * 100)}`);
  const fill = h('div', { class: 'uh-slider__fill' });
  const knob = h('div', { class: 'uh-slider__knob' });
  const track = h('div', { class: 'uh-slider__track' }, fill, knob);
  const out = h('span', { class: 'uh-slider__value' });
  const slider = h('div', { class: 'uh-slider', role: 'slider', 'aria-valuemin': min, 'aria-valuemax': max }, track, out);
  const paint = (): void => {
    slider.style.setProperty('--v', String((value - min) / (max - min)));
    slider.setAttribute('aria-valuenow', String(value));
    setText(out, fmt(value));
  };
  const set = (v: number, notify = true): void => {
    const snapped = clamp(Math.round((v - min) / stepSize) * stepSize + min, min, max);
    const rounded = Math.round(snapped * 1000) / 1000;
    if (rounded === value) return;
    value = rounded;
    paint();
    if (notify) o.onChange(value);
  };
  const fromPointer = (e: PointerEvent): void => {
    const r = track.getBoundingClientRect();
    set(min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min));
  };
  track.addEventListener('pointerdown', (e) => {
    if (o.disabled) return;
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    fromPointer(e);
    const move = (ev: PointerEvent): void => fromPointer(ev);
    const up = (): void => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
      uiSound('adjust');
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  });
  paint();
  const row = rowShell(o, slider);
  return navigable(row, o.id, { onAdjust: (dir) => set(value + dir * stepSize) });
}

export interface SwitchOptions extends RowBase {
  value: boolean;
  onChange: (value: boolean) => void;
  onLabel?: TextRef;
  offLabel?: TextRef;
}

/** On/off row; confirm or left/right toggles. */
export function switchRow(o: SwitchOptions): HTMLDivElement {
  let value = o.value;
  const sw = h('div', { class: 'uh-switch', role: 'switch' }, h('div', { class: 'uh-switch__knob' }));
  const txt = h('span', { class: 'uh-switch__text' });
  const paint = (): void => {
    sw.classList.toggle('is-on', value);
    sw.setAttribute('aria-checked', String(value));
    setText(txt, tr(value ? (o.onLabel ?? 'common.on') : (o.offLabel ?? 'common.off')));
  };
  const toggle = (): void => {
    value = !value;
    paint();
    o.onChange(value);
  };
  paint();
  const row = rowShell(o, h('div', { class: 'uh-switch-wrap' }, txt, sw));
  return navigable(row, o.id, {
    onActivate: toggle,
    onAdjust: (dir) => {
      if ((dir > 0) !== value) toggle();
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------

export interface TabSpec<K extends string> {
  key: K;
  label: TextRef;
  icon?: IconName;
}

/** Segmented tabs with LB/RB (tabPrev/tabNext) glyphs. Focusing a tab activates it. */
export function tabs<K extends string>(specs: readonly TabSpec<K>[], active: K, onSelect: (k: K) => void): HTMLElement {
  const list = h(
    'div',
    { class: 'uh-tabs__list', role: 'tablist' },
    specs.map((s) => {
      const el = h(
        'div',
        { class: ['uh-tab', s.key === active ? 'is-active' : ''], role: 'tab', 'aria-current': s.key === active ? 'true' : null },
        s.icon ? icon(s.icon) : null,
        tr(s.label),
      );
      return navigable(el, `tab:${s.key}`, {
        onActivate: () => onSelect(s.key),
        onFocus: () => {
          if (s.key !== active) onSelect(s.key);
        },
      });
    }),
  );
  return h('div', { class: 'uh-tabs' }, glyphChip('tabPrev'), list, glyphChip('tabNext'));
}

// ---------------------------------------------------------------------------------------------
// Header + prompt bar
// ---------------------------------------------------------------------------------------------

export function screenHeader(title: TextRef, sub?: TextRef | null, iconName?: IconName, extra?: Child): HTMLElement {
  return h(
    'header',
    { class: 'uh-header' },
    iconName ? h('div', { class: 'uh-header__icon' }, icon(iconName)) : null,
    h(
      'div',
      { class: 'uh-header__titles' },
      h('h1', { class: 'uh-header__title uh-outline-text' }, tr(title)),
      sub ? h('p', { class: 'uh-header__sub' }, tr(sub)) : null,
    ),
    extra ?? null,
  );
}

export interface PromptItem {
  action: PromptAction;
  label: TextRef;
  /** Mouse users can click the hint (e.g. Back). */
  onClick?: () => void;
}

export function promptBar(items: readonly PromptItem[], leading?: Child): HTMLElement {
  return h(
    'footer',
    { class: 'uh-promptbar' },
    leading ? h('div', { class: 'uh-promptbar__lead' }, leading) : null,
    h('div', { class: 'uh-promptbar__spacer' }),
    items.map((it) =>
      h(
        'span',
        {
          class: 'uh-promptbar__item',
          onClick: it.onClick
            ? () => {
                uiSound(it.action === 'back' ? 'back' : 'confirm');
                it.onClick?.();
              }
            : null,
        },
        glyphChip(it.action),
        tr(it.label),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Team & misc
// ---------------------------------------------------------------------------------------------

/** Emblem + team name (or an override label). Never color alone (doc §13). */
export function teamTag(team: TeamId, label?: TextRef | null): HTMLElement {
  return h(
    'span',
    { class: `uh-teamtag uh-teamtag--${team}`, 'data-team': team },
    teamEmblem(team),
    h('span', null, label ? tr(label) : t(TEAM_STYLES[team].nameKey)),
  );
}

export function chip(text: TextRef, variant?: 'gold' | 'mint' | 'night' | 'ghost', iconName?: IconName): HTMLElement {
  return h('span', { class: ['uh-chip', variant ? `uh-chip--${variant}` : ''] }, iconName ? icon(iconName) : null, tr(text));
}

/** Apply stagger indices to children for the entrance animation. */
export function stagger<T extends HTMLElement>(container: T): T {
  container.classList.add('uh-stagger');
  Array.from(container.children).forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
  return container;
}
