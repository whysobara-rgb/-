/**
 * [C8] Item slot inside the dash button (content-plan §6 C8 wave 1).
 *
 * While an item is in the pocket the dash button shows it: the item sticker replaces the bolt,
 * pips under it count the uses left, a thin outer ring drains with the item's lifetime (blinks in
 * its last 5 s; no ring for "until the match ends"), and the inner ring shows the item's own
 * cooldown. With empty hands the dash press uses the item (R2), so the label under the glyph chip
 * becomes the item's verb ("Shift 뿅!"); while carrying loot the dash is the normal carry boost:
 * the item sticker shrinks into a corner badge and the regular dash ring + label come back.
 *
 * Decorates the Hud's existing dash element (no layout of its own). DOM writes only on change.
 */
import type { ItemKind } from '../../sim/types';
import { t } from '../i18n';
import { animateEl, h, setClass, setText } from '../core/dom';
import { clamp01 } from '../core/format';
import { itemGlyph, itemVerbKey } from './contentIcons';
import type { HudItemSlot } from './contentTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CD_R = 26;
const CD_C = 2 * Math.PI * CD_R;
const LIFE_R = 34;
const LIFE_C = 2 * Math.PI * LIFE_R;
/** Pips shown at most (the golden hammer has 8 swings). */
const MAX_PIPS = 8;
/** Lifetime left (s) below which the ring blinks. */
const LOW_SEC = 5;

function circle(r: number, cx: number, cls: string): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cx));
  c.setAttribute('r', String(r));
  c.setAttribute('class', cls);
  return c;
}

export class ItemSlot {
  private readonly dash: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly glyphEl: HTMLElement;
  private readonly pipsEl: HTMLElement;
  private readonly lifeSvg: SVGSVGElement;
  private readonly lifeRing: SVGCircleElement;
  private readonly cdRing: SVGCircleElement;
  private readonly verbEl: HTMLElement;
  private pips: HTMLElement[] = [];

  private cKind: ItemKind | null = null;
  private cUses = -1;
  private cMax = -1;
  private cLife = -2;
  private cLow = false;
  private cCd = -1;
  private cArmed: boolean | null = null;
  private cReady: boolean | null = null;
  private cPhase = '';

  constructor(dash: HTMLElement) {
    this.dash = dash;
    const btn = dash.querySelector<HTMLElement>('.uh-dash__btn') ?? dash;

    const cdSvg = document.createElementNS(SVG_NS, 'svg');
    cdSvg.setAttribute('viewBox', '0 0 64 64');
    cdSvg.setAttribute('class', 'uh-item__cd');
    cdSvg.setAttribute('aria-hidden', 'true');
    this.cdRing = circle(CD_R, 32, 'uh-item__cdFg');
    this.cdRing.setAttribute('stroke-dasharray', String(CD_C));
    cdSvg.append(circle(CD_R, 32, 'uh-item__cdBg'), this.cdRing);

    this.lifeSvg = document.createElementNS(SVG_NS, 'svg');
    this.lifeSvg.setAttribute('viewBox', '0 0 76 76');
    this.lifeSvg.setAttribute('class', 'uh-item__life');
    this.lifeSvg.setAttribute('aria-hidden', 'true');
    this.lifeRing = circle(LIFE_R, 38, 'uh-item__lifeFg');
    this.lifeRing.setAttribute('stroke-dasharray', String(LIFE_C));
    this.lifeSvg.append(circle(LIFE_R, 38, 'uh-item__lifeBg'), this.lifeRing);

    this.glyphEl = h('span', { class: 'uh-item__glyph' });
    this.pipsEl = h('span', { class: 'uh-item__pips' });
    this.layer = h('span', { class: 'uh-item', 'aria-hidden': 'true' }, this.lifeSvg, cdSvg, this.glyphEl, this.pipsEl);
    this.layer.hidden = true;
    btn.appendChild(this.layer);

    this.verbEl = h('span', { class: 'uh-item__verb' });
    this.verbEl.hidden = true;
    dash.appendChild(this.verbEl);
  }

  update(s: HudItemSlot | null): void {
    if (!s) {
      if (this.cKind !== null) this.clear(true);
      return;
    }
    if (s.kind !== this.cKind) {
      const fresh = this.cKind === null;
      this.cKind = s.kind;
      this.cUses = this.cMax = -1;
      this.cLife = -2;
      this.cCd = -1;
      this.cArmed = this.cReady = null;
      this.cPhase = '';
      this.layer.hidden = false;
      this.verbEl.hidden = false;
      this.dash.dataset.item = s.kind;
      this.glyphEl.replaceChildren(itemGlyph(s.kind, 'uh-cglyph uh-item__art'));
      setText(this.verbEl, t(itemVerbKey(s.kind)));
      // picked up: the sticker slaps onto the button
      animateEl(this.glyphEl, [{ transform: 'scale(2.2) rotate(-25deg)', opacity: 0 }, { transform: 'scale(0.85) rotate(6deg)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: fresh ? 460 : 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      animateEl(this.dash, [{ scale: '1' }, { scale: '1.22' }, { scale: '0.94', offset: 0.6 }, { scale: '1' }], { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    }

    // Use pips
    const max = s.maxUses === null ? 0 : Math.min(MAX_PIPS, Math.max(0, Math.round(s.maxUses)));
    const uses = s.uses === null ? 0 : Math.min(max, Math.max(0, Math.round(s.uses)));
    if (max !== this.cMax) {
      this.cMax = max;
      this.pips = [];
      for (let i = 0; i < max; i++) this.pips.push(h('i', { class: 'uh-item__pip' }));
      this.pipsEl.replaceChildren(...this.pips);
      this.pipsEl.hidden = max === 0;
      this.cUses = -1;
    }
    if (uses !== this.cUses) {
      const prev = this.cUses;
      this.cUses = uses;
      for (let i = 0; i < this.pips.length; i++) setClass(this.pips[i]!, 'is-spent', i >= uses);
      if (prev > uses) {
        for (let i = uses; i < Math.min(prev, this.pips.length); i++) animateEl(this.pips[i]!, [{ transform: 'scale(1.8)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
        animateEl(this.glyphEl, [{ transform: 'rotate(-28deg) scale(1.15)' }, { transform: 'rotate(8deg) scale(0.92)', offset: 0.5 }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      }
    }

    // Lifetime ring (quantized to 1/200)
    const life = s.life === null ? -1 : Math.round(clamp01(s.life) * 200) / 200;
    if (life !== this.cLife) {
      this.cLife = life;
      this.lifeSvg.style.display = life < 0 ? 'none' : '';
      if (life >= 0) this.lifeRing.setAttribute('stroke-dashoffset', (LIFE_C * (1 - life)).toFixed(2));
    }
    const low = s.lifeSec !== null && s.lifeSec <= LOW_SEC;
    if (low !== this.cLow) {
      this.cLow = low;
      setClass(this.layer, 'is-low', low);
    }

    // Item cooldown ring (quantized to 1/60)
    const cd = Math.round(clamp01(s.cooldown) * 60) / 60;
    if (cd !== this.cCd) {
      this.cCd = cd;
      this.cdRing.setAttribute('stroke-dashoffset', (CD_C * cd).toFixed(2));
    }

    if (s.armed !== this.cArmed) {
      this.cArmed = s.armed;
      this.dash.dataset.armed = s.armed ? '1' : '0';
    }
    const ready = s.armed && s.phase === 'idle' && cd === 0 && (s.uses === null || s.uses > 0);
    if (ready !== this.cReady) {
      const was = this.cReady;
      this.cReady = ready;
      this.dash.dataset.itemReady = ready ? '1' : '0';
      if (ready && was === false) animateEl(this.glyphEl, [{ transform: 'scale(1.25)' }, { transform: 'scale(0.95)', offset: 0.5 }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    }
    if (s.phase !== this.cPhase) {
      this.cPhase = s.phase;
      this.dash.dataset.itemPhase = s.phase;
    }
  }

  /** Language changed: rewrite the verb. */
  relabel(): void {
    if (this.cKind) setText(this.verbEl, t(itemVerbKey(this.cKind)));
  }

  /** Remove the item (lost / expired / used up / match reset). */
  clear(animate = false): void {
    this.cKind = null;
    this.cUses = this.cMax = -1;
    this.cLife = -2;
    this.cLow = false;
    this.cCd = -1;
    this.cArmed = this.cReady = null;
    this.cPhase = '';
    delete this.dash.dataset.item;
    delete this.dash.dataset.armed;
    delete this.dash.dataset.itemReady;
    delete this.dash.dataset.itemPhase;
    setClass(this.layer, 'is-low', false);
    this.verbEl.hidden = true;
    const hide = (): void => {
      if (this.cKind !== null) return;
      this.layer.hidden = true;
      this.glyphEl.replaceChildren();
    };
    const a = animate ? animateEl(this.glyphEl, [{ transform: 'none', opacity: 1 }, { transform: 'scale(0.2) rotate(40deg)', opacity: 0 }], { duration: 220, easing: 'ease-in' }) : null;
    if (a) a.onfinish = hide;
    else hide();
  }
}
