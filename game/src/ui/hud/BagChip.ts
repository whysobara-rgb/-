/**
 * [C8] Bag chip (주머니) above the '운반 중' luggage tag (content-plan §3.3, §6 C8 wave 1):
 * "주머니 120 · 차 앞에 쏟아요". The bag is carried value, NEVER score: the chip is a small paper
 * pouch tag (no 확정 tick, no scoreboard digits), it fills toward the cap, and it reads
 * "가득!" at the cap, "쏟는 중…" while the deposit timer runs in our zone, "쏟았다!" for a beat
 * after the bag empties into the score, and "와르르! -60" with a shake when a knockdown spills it.
 */
import { t } from '../i18n';
import { animateEl, h, setClass, setText } from '../core/dom';
import { fmtScore } from '../core/format';
import { bagGlyph } from './contentIcons';
import type { HudBag, HudContentModel } from './contentTypes';

/** How long the "쏟았다!" / "와르르!" beat stays after the bag empties (ms). */
const OUTRO_MS = 900;

type BagState = 'carry' | 'full' | 'deposit' | 'done' | 'spill';

/**
 * Why the bag shrank this frame (ContentHud derives it from the sim: knockdown + team score);
 * null = it didn't. A deposit reads "쏟았다!"; a spill shakes and reads "와르르! -N".
 */
export type BagDrop = 'deposit' | 'spill' | null;

/**
 * Pure per-frame classifier (no DOM). The sim empties a bag only two ways: a deposit (whole bag ->
 * my team's score; never while knocked down) or a knockdown spill (never raises a score). So a
 * drop while standing is a deposit; a drop while down is a spill, unless the bag went in just
 * before the knockdown within one frame (timer was running and my team's score rose by at least
 * what left the bag).
 */
export class BagDropTracker {
  private prevValue = 0;
  private prevScore: number | null = null;
  private prevDepositing = false;

  update(c: Pick<HudContentModel, 'bag' | 'downed' | 'teamScore'> | null): BagDrop {
    const value = c?.bag ? Math.max(0, Math.round(c.bag.value)) : 0;
    const prevValue = this.prevValue;
    const prevScore = this.prevScore;
    const wasDepositing = this.prevDepositing;
    this.prevValue = value;
    this.prevScore = c ? c.teamScore : null;
    this.prevDepositing = !!c?.bag && c.bag.deposit !== null;
    if (!c || value >= prevValue) return null;
    if (!c.downed) return 'deposit';
    const gain = prevScore === null ? 0 : c.teamScore - prevScore;
    return wasDepositing && gain >= prevValue - value ? 'deposit' : 'spill';
  }

  reset(): void {
    this.prevValue = 0;
    this.prevScore = null;
    this.prevDepositing = false;
  }
}

export class BagChip {
  readonly el: HTMLElement;
  private readonly valueEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly deltaEl: HTMLElement;
  private cValue = 0;
  private cState: BagState | '' = '';
  private cFill = -1;
  private lastDeposit: number | null = null;
  private outroUntil = 0;
  private spillValue = 0;

  constructor() {
    this.valueEl = h('span', { class: 'uh-bag__value uh-num' });
    this.noteEl = h('span', { class: 'uh-bag__note' });
    this.fillEl = h('i');
    this.deltaEl = h('span', { class: 'uh-bag__delta uh-num', 'aria-hidden': 'true' });
    this.el = h(
      'div',
      { class: 'uh-bag', role: 'status' },
      h('span', { class: 'uh-bag__art' }, bagGlyph('uh-cglyph uh-bag__glyph')),
      h('span', { class: 'uh-bag__body' }, h('span', { class: 'uh-bag__row' }, h('span', { class: 'uh-bag__label' }, t('hud.content.bag.label')), this.valueEl), h('span', { class: 'uh-bag__bar' }, this.fillEl)),
      this.noteEl,
      this.deltaEl,
    );
    this.el.hidden = true;
  }

  /**
   * `drop`: why the bag shrank (from the sim, see ContentHud.bagDrop). Omitted (direct callers
   * without sim context) = a drop counts as a deposit only when the timer was running and nearly
   * done, else a spill.
   */
  update(b: HudBag | null, now: number = performance.now(), drop?: BagDrop): void {
    const value = b ? Math.max(0, Math.round(b.value)) : 0;
    const prev = this.cValue;
    if (value !== prev) {
      this.cValue = value;
      if (value < prev) {
        // emptied into the score (deposit) or knocked loose (spill): never guess "쏟았다!" for a spill
        const deposited = drop !== undefined ? drop === 'deposit' : value === 0 && this.lastDeposit !== null && this.lastDeposit >= 0.5;
        if (deposited) {
          if (value === 0) this.beginOutro('done', now);
        } else this.spill(prev - value, value === 0, now);
      } else {
        this.bump(value - prev, prev === 0);
      }
    }
    this.lastDeposit = b ? b.deposit : null;

    if (value === 0) {
      if (this.cState === 'done' || this.cState === 'spill') {
        if (now >= this.outroUntil) this.hide();
      } else if (!this.el.hidden) this.hide();
      return;
    }
    if (this.el.hidden) this.el.hidden = false;
    setText(this.valueEl, fmtScore(value));
    const cap = Math.max(1, b!.cap);
    const fill = Math.round(Math.min(1, value / cap) * 100) / 100;
    if (fill !== this.cFill) {
      this.cFill = fill;
      this.fillEl.style.transform = `scaleX(${fill})`;
    }
    const st: BagState = now < this.outroUntil && this.cState === 'spill' ? 'spill' : b!.deposit !== null ? 'deposit' : value >= cap ? 'full' : 'carry';
    this.setState(st, value);
  }

  /** Language changed. */
  relabel(): void {
    const label = this.el.querySelector('.uh-bag__label');
    if (label) setText(label, t('hud.content.bag.label'));
    const st = this.cState;
    this.cState = '';
    if (st) this.setState(st, this.cValue);
  }

  reset(): void {
    this.cValue = 0;
    this.lastDeposit = null;
    this.outroUntil = 0;
    this.hide();
  }

  private setState(st: BagState, value: number): void {
    if (st === this.cState && st !== 'spill') return;
    this.cState = st;
    this.el.dataset.state = st;
    void value;
    const note =
      st === 'deposit' ? t('hud.content.bag.depositing') : st === 'full' ? t('hud.content.bag.full') : st === 'done' ? t('hud.content.bag.deposited') : st === 'spill' ? t('hud.content.bag.spilled', { value: fmtScore(this.spillValue) }) : t('hud.content.bag.hint');
    setText(this.noteEl, note);
  }

  private bump(gain: number, appear: boolean): void {
    this.outroUntil = 0;
    if (appear || this.el.hidden) {
      this.el.hidden = false;
      animateEl(this.el, [{ transform: 'translateY(1.5rem) rotate(8deg) scale(0.6)', opacity: 0 }, { transform: 'rotate(-2deg) scale(1.05)', opacity: 1, offset: 0.65 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    } else {
      animateEl(this.el.querySelector('.uh-bag__art') ?? this.el, [{ transform: 'scale(1)' }, { transform: `scale(${gain >= 50 ? 1.35 : 1.2}) rotate(-8deg)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    }
  }

  private spill(lost: number, emptied: boolean, now: number): void {
    this.spillValue = lost;
    this.cState = '';
    if (emptied) this.beginOutro('spill', now);
    else {
      this.outroUntil = now + OUTRO_MS;
      this.setState('spill', this.cValue);
    }
    setText(this.deltaEl, `-${fmtScore(lost)}`);
    animateEl(this.deltaEl, [{ transform: 'translate(-50%, 0) scale(0.6)', opacity: 0 }, { transform: 'translate(-50%, -1.2rem) scale(1.1)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%, -2.6rem) scale(1)', opacity: 0 }], { duration: OUTRO_MS, easing: 'ease-out' });
    animateEl(this.el, [{ transform: 'translateX(0)' }, { transform: 'translateX(-0.6rem) rotate(-4deg)' }, { transform: 'translateX(0.5rem) rotate(3deg)' }, { transform: 'translateX(-0.3rem)' }, { transform: 'none' }], { duration: 360, easing: 'ease-out' });
  }

  private beginOutro(st: 'done' | 'spill', now: number): void {
    this.outroUntil = now + OUTRO_MS;
    this.el.hidden = false;
    this.cState = '';
    this.setState(st, 0);
    setText(this.valueEl, '0');
    this.fillEl.style.transform = 'scaleX(0)';
    this.cFill = 0;
    if (st === 'done') animateEl(this.el, [{ transform: 'scale(1)' }, { transform: 'scale(1.18) rotate(-3deg)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
  }

  private hide(): void {
    this.cState = '';
    this.cFill = -1;
    delete this.el.dataset.state;
    setClass(this.el, 'is-out', false);
    this.el.hidden = true;
  }
}
