/**
 * Taunt wheel (owner addition): a radial sticker wheel the player holds open (pad LB / keyboard T)
 * to pick a taunt with a stick, the movement keys or the mouse; letting go plays it. Seven slots
 * clockwise from the top: the four base taunts, then the three rival taunts — shown as gift boxes
 * until that rival is beaten. The center names the hovered taunt (or how to unlock it) and wears
 * a cooldown ring; a "can't now" note appears while the raccoon holds something, dashes or is
 * knocked down.
 *
 * Also owns the small taunt chip next to the dash button (wheel glyph + a cooldown sweep), so the
 * feature is discoverable without a tutorial line.
 *
 * Diffed: DOM is touched only when the model changes. Pure presentation — the input logic lives
 * in src/platform/emotes.ts.
 */
import type { EmoteId } from '../../sim/types';
import { t } from '../i18n';
import { animateEl, h, setClass, setText } from '../core/dom';
import { icon } from '../core/icons';
import { objectPortrait } from '../core/portrait';
import { glyphChip, type PromptAction } from '../core/prompts';
import { tauntIcon } from '../core/tauntIcons';

export interface EmoteWheelSlot {
  id: EmoteId;
  unlocked: boolean;
}

export interface EmoteWheelModel {
  open: boolean;
  /** Hovered slot index, or null. */
  hover: number | null;
  slots: readonly EmoteWheelSlot[];
  /** Cooldown left, 1 = just started .. 0 = ready. */
  cooldown: number;
  /** A taunt cannot start right now (holding, dashing, knocked down). */
  blocked: boolean;
  /** Show the direct-key glyphs on the base slots (keyboard players). */
  showKeys: boolean;
}

/** Direct-key prompt per base slot (emote1..emote4). */
const DIRECT: readonly PromptAction[] = ['emote1', 'emote2', 'emote3', 'emote4'];
const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;
const CHIP_R = 21;
const CHIP_C = 2 * Math.PI * CHIP_R;
const SVG_NS = 'http://www.w3.org/2000/svg';

function ring(r: number, cls: string, size: number): { svg: SVGSVGElement; fg: SVGCircleElement } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(SVG_NS, 'circle');
  const fg = document.createElementNS(SVG_NS, 'circle');
  for (const c of [bg, fg]) {
    c.setAttribute('cx', String(size / 2));
    c.setAttribute('cy', String(size / 2));
    c.setAttribute('r', String(r));
  }
  bg.setAttribute('class', `${cls}Bg`);
  fg.setAttribute('class', `${cls}Fg`);
  fg.setAttribute('stroke-dasharray', String(2 * Math.PI * r));
  svg.append(bg, fg);
  return { svg, fg };
}

interface SlotEl {
  root: HTMLElement;
  id: EmoteId;
  unlocked: boolean;
}

export class EmoteWheel {
  /** The wheel overlay (centered in the HUD safe area). */
  readonly el: HTMLElement;
  /** The small taunt chip for the action cluster. */
  readonly chipEl: HTMLElement;
  private readonly disc: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly ringFg: SVGCircleElement;
  private readonly chipFg: SVGCircleElement;
  private slots: SlotEl[] = [];
  private cOpen = false;
  private cHover: number | null = -1;
  private cKey = '';
  private cCool = -1;
  private cBlocked: boolean | null = null;
  private model: EmoteWheelModel | null = null;

  constructor() {
    const r = ring(RING_R, 'uh-ewheel__ring', 100);
    this.ringFg = r.fg;
    this.nameEl = h('div', { class: 'uh-ewheel__name' });
    this.noteEl = h('div', { class: 'uh-ewheel__note' });
    this.disc = h('div', { class: 'uh-ewheel__disc' });
    this.el = h(
      'div',
      { class: 'uh-ewheel', 'aria-hidden': 'true' },
      this.disc,
      h('div', { class: 'uh-ewheel__center' }, r.svg, h('div', { class: 'uh-ewheel__centerText' }, this.nameEl, this.noteEl)),
    );
    this.el.hidden = true;
    const c = ring(CHIP_R, 'uh-tchip__ring', 48);
    this.chipFg = c.fg;
    this.chipEl = h(
      'div',
      { class: 'uh-tchip is-ready' },
      h('div', { class: 'uh-tchip__btn' }, c.svg, h('span', { class: 'uh-tchip__icon' }, tauntIcon('bleh', 'uh-tauntIcon uh-tchip__svg'))),
      glyphChip('emoteWheel'),
    );
  }

  /** Re-label after a language change. */
  relabel(): void {
    this.cHover = -1;
    if (this.model) this.update(this.model);
  }

  update(m: EmoteWheelModel): void {
    this.model = m;
    const key = m.slots.map((s) => `${s.id}:${s.unlocked ? 1 : 0}`).join('|');
    if (key !== this.cKey) {
      this.cKey = key;
      this.build(m.slots);
      this.cHover = -1;
    }
    if (m.open !== this.cOpen) {
      this.cOpen = m.open;
      this.el.hidden = !m.open;
      setClass(this.el, 'is-open', m.open);
      if (m.open)
        animateEl(
          this.disc,
          [
            { transform: 'scale(0.55) rotate(-25deg)', opacity: 0 },
            { transform: 'scale(1.07) rotate(3deg)', opacity: 1, offset: 0.65 },
            { transform: 'scale(1) rotate(0deg)', opacity: 1 },
          ],
          { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
    }
    if (m.hover !== this.cHover || m.blocked !== this.cBlocked) {
      this.cHover = m.hover;
      this.slots.forEach((s, i) => setClass(s.root, 'is-hover', i === m.hover));
      const slot = m.hover !== null ? m.slots[m.hover] : undefined;
      if (!slot) {
        setText(this.nameEl, t('taunt.wheel.title'));
        setText(this.noteEl, t(m.blocked ? 'taunt.wheel.blocked' : 'taunt.wheel.pick'));
      } else if (slot.unlocked) {
        setText(this.nameEl, t(`emote.${slot.id}.name`));
        setText(this.noteEl, t(m.blocked ? 'taunt.wheel.blocked' : 'taunt.wheel.release'));
      } else {
        setText(this.nameEl, t('taunt.wheel.locked'));
        setText(this.noteEl, t(`emote.${slot.id}.unlock`));
      }
      setClass(this.el, 'is-lockedHover', !!slot && !slot.unlocked);
    }
    const cool = Math.round(Math.min(1, Math.max(0, m.cooldown)) * 100) / 100;
    if (cool !== this.cCool) {
      this.cCool = cool;
      this.ringFg.setAttribute('stroke-dashoffset', String(RING_C * (1 - cool)));
      this.chipFg.setAttribute('stroke-dashoffset', String(CHIP_C * (1 - cool)));
      setClass(this.el, 'is-cooling', cool > 0);
      setClass(this.chipEl, 'is-cooling', cool > 0);
    }
    setClass(this.el, 'is-keys', m.showKeys);
    if (m.blocked !== this.cBlocked) {
      this.cBlocked = m.blocked;
      setClass(this.el, 'is-blocked', m.blocked);
    }
    setClass(this.chipEl, 'is-ready', cool <= 0 && !m.blocked);
  }

  /** Released over a locked slot: the gift box shakes. */
  lockedPick(index: number): void {
    const s = this.slots[index];
    const nope: Keyframe[] = [{ translate: '0 0' }, { translate: '-0.3rem 0' }, { translate: '0.3rem 0' }, { translate: '-0.2rem 0' }, { translate: '0 0' }];
    if (s) animateEl(s.root.firstElementChild ?? s.root, nope, { duration: 300, easing: 'ease-out' });
    animateEl(this.chipEl, nope, { duration: 300, easing: 'ease-out' });
  }

  /** A taunt was sent: the chip pops. */
  fired(): void {
    animateEl(this.chipEl, [{ scale: '1' }, { scale: '1.25', offset: 0.35 }, { scale: '0.95', offset: 0.7 }, { scale: '1' }], { duration: 320, easing: 'ease-out' });
  }

  private build(slots: readonly EmoteWheelSlot[]): void {
    const n = Math.max(1, slots.length);
    this.slots = slots.map((s, i) => {
      const a = (i / n) * 360;
      const face = s.unlocked ? h('div', { class: 'uh-ewheel__art' }, tauntIcon(s.id)) : h('div', { class: 'uh-ewheel__art uh-ewheel__art--gift' }, objectPortrait('gift'));
      const root = h(
        'div',
        {
          class: ['uh-ewheel__slot', s.unlocked ? '' : 'is-locked'],
          style: `--a:${a}deg`,
          'data-emote': s.id,
        },
        h('div', { class: 'uh-ewheel__sticker' }, face, !s.unlocked ? h('span', { class: 'uh-ewheel__lock' }, icon('lock')) : null),
        i < DIRECT.length && s.unlocked ? h('span', { class: 'uh-ewheel__key' }, glyphChip(DIRECT[i]!)) : null,
      );
      return { root, id: s.id, unlocked: s.unlocked };
    });
    this.disc.replaceChildren(...this.slots.map((s) => s.root));
  }
}
