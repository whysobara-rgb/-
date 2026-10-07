/**
 * [C8] Deposit ring under the player (쏟아붓기, content-plan §3.3): while my bag is being emptied
 * in our zone (0.5 s, any knockdown or stepping out resets it), a team-coloured ring lies flat on
 * the ground around my feet and fills; it pops when the coins go in. World layer, one pooled
 * element, transform-only moves.
 */
import type { TeamId } from '../../sim/types';
import { t } from '../i18n';
import { animateEl, h, setText } from '../core/dom';
import { clamp01, fmtScore } from '../core/format';
import { coinGlyph } from './contentIcons';
import type { HudDepositRing } from './contentTypes';

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 40;
const C = 2 * Math.PI * R;

export class DepositRing {
  readonly el: HTMLElement;
  private readonly ring: SVGCircleElement;
  private readonly labelEl: HTMLElement;
  private readonly valueEl: HTMLElement;
  private x = NaN;
  private y = NaN;
  private cProg = -1;
  private cTeam: TeamId | -1 = -1;
  private cValue = -1;
  private last = 0;

  constructor() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'uh-deposit__ring');
    const bg = document.createElementNS(SVG_NS, 'circle');
    bg.setAttribute('cx', '50');
    bg.setAttribute('cy', '50');
    bg.setAttribute('r', String(R));
    bg.setAttribute('class', 'uh-deposit__bg');
    const track = document.createElementNS(SVG_NS, 'circle');
    track.setAttribute('cx', '50');
    track.setAttribute('cy', '50');
    track.setAttribute('r', String(R));
    track.setAttribute('class', 'uh-deposit__track');
    this.ring = document.createElementNS(SVG_NS, 'circle');
    this.ring.setAttribute('cx', '50');
    this.ring.setAttribute('cy', '50');
    this.ring.setAttribute('r', String(R));
    this.ring.setAttribute('class', 'uh-deposit__fg');
    this.ring.setAttribute('transform', 'rotate(-90 50 50)');
    this.ring.setAttribute('stroke-dasharray', String(C));
    this.ring.setAttribute('stroke-dashoffset', String(C));
    svg.append(bg, track, this.ring);
    this.labelEl = h('span', { class: 'uh-deposit__label' });
    this.valueEl = h('span', { class: 'uh-deposit__value uh-num' });
    this.el = h(
      'div',
      { class: 'uh-deposit', 'aria-hidden': 'true' },
      h('div', { class: 'uh-deposit__floor' }, svg),
      h('div', { class: 'uh-deposit__tag' }, coinGlyph('uh-cglyph uh-deposit__coin'), this.labelEl, this.valueEl),
    );
    this.el.hidden = true;
    setText(this.labelEl, t('hud.content.deposit'));
  }

  update(d: HudDepositRing | null): void {
    if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) {
      if (!this.el.hidden) this.finish(this.last >= 0.5);
      return;
    }
    if (this.el.hidden) {
      this.el.hidden = false;
      animateEl(this.el.firstElementChild!, [{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }
    const x = Math.round(d.x * 2) / 2;
    const y = Math.round(d.y * 2) / 2;
    if (x !== this.x || y !== this.y) {
      this.x = x;
      this.y = y;
      this.el.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
    const p = Math.round(clamp01(d.progress) * 100) / 100;
    this.last = p;
    if (p !== this.cProg) {
      this.cProg = p;
      this.ring.setAttribute('stroke-dashoffset', (C * (1 - p)).toFixed(2));
    }
    if (d.team !== this.cTeam) {
      this.cTeam = d.team;
      this.el.dataset.team = String(d.team);
    }
    const v = Math.round(d.value);
    if (v !== this.cValue) {
      this.cValue = v;
      setText(this.valueEl, fmtScore(v));
    }
  }

  relabel(): void {
    setText(this.labelEl, t('hud.content.deposit'));
  }

  reset(): void {
    this.el.hidden = true;
    this.cProg = -1;
    this.cValue = -1;
    this.last = 0;
  }

  /** The timer stopped: a pop when it completed (coins went in), else just vanish. */
  private finish(done: boolean): void {
    this.cProg = -1;
    this.cValue = -1;
    this.last = 0;
    const a = done ? animateEl(this.el.firstElementChild!, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 320, easing: 'ease-out' }) : null;
    if (done) animateEl(this.el.lastElementChild!, [{ transform: 'translate(-50%, 0)', opacity: 1 }, { transform: 'translate(-50%, -1.5rem)', opacity: 0 }], { duration: 320, easing: 'ease-out' });
    if (a) a.onfinish = () => {
      if (this.cProg < 0) this.el.hidden = true;
    };
    else this.el.hidden = true;
  }
}
