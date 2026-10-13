/**
 * UI juice kit: chunky hand-lettered headings, rubber stamps, rolling digits and DOM particle bursts
 * (coins, confetti, stars). Everything honours reduced motion (static, no particles).
 */
import { fmtScore } from './format';
import { h, isReducedMotion } from './dom';

// ---------------------------------------------------------------------------------------------
// Chunky heading: Jua, thick ink outline, hard offset shadow, a tiny baseline bounce per word.
// ---------------------------------------------------------------------------------------------

/**
 * Heading element: each word in its own span with a tiny vertical jitter so the line reads
 * hand-lettered rather than typeset. Words stay upright (orientation policy: text is never
 * tilted at rest). `size` picks a CSS size step.
 */
export function chunky(text: string, o: { tag?: 'h1' | 'h2' | 'div' | 'span' | 'p'; cls?: string; seed?: number; tone?: 'cream' | 'sun' | 'tomato' | 'mint' | 'sky' | 'ink'; perLetter?: boolean } = {}): HTMLElement {
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);
  const seed = o.seed ?? 0;
  let k = 0;
  const kids: Node[] = [];
  for (const w of words) {
    if (/^\s+$/.test(w)) {
      kids.push(document.createTextNode(' '));
      continue;
    }
    const dy = ((k + seed) % 3) - 1;
    if (o.perLetter) {
      kids.push(
        h(
          'span',
          { class: 'uh-chunky__word', style: { '--dy': `${dy * 0.04}em` } },
          Array.from(w).map((ch, i) => h('span', { class: 'uh-chunky__ch', style: { '--i': String(i + k * 3) } }, ch)),
        ),
      );
    } else {
      kids.push(h('span', { class: 'uh-chunky__word', style: { '--dy': `${dy * 0.05}em`, '--i': String(k) } }, w));
    }
    k++;
  }
  return h(o.tag ?? 'div', { class: ['uh-chunky', `uh-chunky--${o.tone ?? 'cream'}`, o.cls ?? ''], 'aria-label': text }, kids);
}

// ---------------------------------------------------------------------------------------------
// Rubber stamp ("잡았다!", "승리!", "뽑았다!")
// ---------------------------------------------------------------------------------------------

export type StampTone = 'tomato' | 'mint' | 'sun' | 'sky' | 'grape' | 'ink';

export function stamp(text: string, tone: StampTone = 'tomato', cls = ''): HTMLElement {
  return h('div', { class: `uh-stamp uh-stamp--${tone} ${cls}`, role: 'img', 'aria-label': text }, h('span', { class: 'uh-stamp__text' }, text));
}

/** Stamp slam keyframes: scale + squash-and-stretch + a short drop, no rotation (text stays upright). */
export const SLAM_KEYFRAMES: readonly Keyframe[] = [
  { transform: 'translateY(-0.35em) scale(2.6)', opacity: 0 },
  { transform: 'translateY(0.04em) scale(1.12, 0.84)', opacity: 1, offset: 0.55 },
  { transform: 'translateY(-0.03em) scale(0.95, 1.07)', offset: 0.75 },
  { transform: 'none', opacity: 1 },
];

/**
 * Slam a stamp in (drop + overshoot + squash). Stamps always rest upright (0deg); the punch is
 * scale / squash-and-stretch only. Returns the animation (null with reduced motion).
 */
export function slamIn(el: HTMLElement, delayMs = 0): Animation | null {
  if (isReducedMotion() || typeof el.animate !== 'function') return null;
  return el.animate([...SLAM_KEYFRAMES], { duration: 520, delay: delayMs, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)', fill: 'backwards' });
}

// ---------------------------------------------------------------------------------------------
// Rolling digits: an odometer per digit, springy overshoot, commas stay put.
// ---------------------------------------------------------------------------------------------

export class RollingNumber {
  readonly el: HTMLElement;
  private value: number | null = null;
  private text = '';
  private readonly cols: (HTMLElement | null)[] = [];
  private tween = 0;

  constructor(cls = '', initial: number | null = 0) {
    this.el = h('span', { class: `uh-roll ${cls}`, 'aria-live': 'off' });
    this.set(initial, true);
  }

  get current(): number | null {
    return this.value;
  }

  /**
   * Count up (or down) to `target` over `ms` like a score tally: the shown number ticks through
   * real values (never zero-padded strips), eases out, then pops. Reduced motion: instant.
   */
  countTo(target: number, ms = 900, onDone?: () => void): void {
    cancelAnimationFrame(this.tween);
    const from = this.value ?? 0;
    if (isReducedMotion() || ms <= 0 || from === target || typeof requestAnimationFrame !== 'function') {
      this.set(target, true);
      onDone?.();
      return;
    }
    const t0 = performance.now();
    const q = Math.abs(target - from) >= 200 ? 10 : 1;
    const tick = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = k >= 1 ? target : Math.round((from + (target - from) * e) / q) * q;
      this.set(v, true);
      if (k < 1) {
        this.tween = requestAnimationFrame(tick);
        return;
      }
      this.tween = 0;
      this.el.classList.remove('is-pop');
      void this.el.offsetWidth;
      this.el.classList.add('is-pop');
      onDone?.();
    };
    this.tween = requestAnimationFrame(tick);
  }

  /** Stop a running countTo (the number stays where it is). */
  stop(): void {
    cancelAnimationFrame(this.tween);
    this.tween = 0;
  }

  /** Show `v` (null = "–"). `instant` skips the roll. */
  set(v: number | null, instant = false): void {
    if (v === this.value) return;
    this.value = v;
    const text = v === null || !Number.isFinite(v) ? '–' : fmtScore(v);
    if (text === this.text) return;
    const rebuild = text.length !== this.text.length || text.replace(/\d/g, '0') !== this.text.replace(/\d/g, '0');
    this.text = text;
    this.el.setAttribute('aria-label', text);
    const reduced = isReducedMotion();
    if (rebuild) {
      this.el.replaceChildren();
      this.cols.length = 0;
      for (const ch of text) {
        if (/\d/.test(ch)) {
          const strip = h('span', { class: 'uh-roll__strip' }, Array.from({ length: 10 }, (_, i) => h('span', { class: 'uh-roll__d' }, String(i))));
          const col = h('span', { class: 'uh-roll__col' }, strip);
          this.el.appendChild(col);
          this.cols.push(strip);
        } else {
          this.el.appendChild(h('span', { class: 'uh-roll__sep' }, ch));
          this.cols.push(null);
        }
      }
    }
    for (let i = 0; i < text.length; i++) {
      const strip = this.cols[i];
      if (!strip) continue;
      const d = Number(text[i]);
      if (instant || reduced || rebuild) strip.style.transition = 'none';
      else strip.style.transition = '';
      strip.style.setProperty('--d', String(d));
      strip.style.transitionDelay = instant || reduced ? '0ms' : `${(text.length - i) * 35}ms`;
    }
    if (rebuild && !instant && !reduced) {
      // Let the new strips start from 0 and roll to their digit.
      for (const s of this.cols) if (s) s.style.setProperty('--d', '0');
      void this.el.offsetWidth;
      for (let i = 0; i < text.length; i++) {
        const s = this.cols[i];
        if (!s) continue;
        s.style.transition = '';
        s.style.setProperty('--d', text[i]!);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// DOM particle bursts (coins / confetti / stars), self-removing.
// ---------------------------------------------------------------------------------------------

export type BurstKind = 'coins' | 'confetti' | 'stars';

const CONFETTI = ['#FFD23F', '#FF5A4E', '#4FD6A6', '#4FB6FF', '#FF8FB8', '#8E6CF0'];

/**
 * Burst `count` particles from (x, y) (CSS px inside `host`, which must be positioned).
 * Particles fly out with gravity; cheap (Web Animations, transform/opacity only).
 */
export function burst(host: HTMLElement, x: number, y: number, o: { kind?: BurstKind; count?: number; power?: number; spread?: number; up?: number } = {}): void {
  if (isReducedMotion() || typeof host.animate !== 'function') return;
  const kind = o.kind ?? 'coins';
  const n = o.count ?? 10;
  const power = o.power ?? 1;
  for (let i = 0; i < n; i++) {
    const p = h('i', { class: `uh-particle uh-particle--${kind}` });
    if (kind === 'confetti') p.style.background = CONFETTI[i % CONFETTI.length]!;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    host.appendChild(p);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * (o.spread ?? 2.4);
    const v = (6 + Math.random() * 8) * power;
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v - (o.up ?? 2);
    const g = 14;
    const dur = 700 + Math.random() * 500;
    const rot = (Math.random() - 0.5) * 900;
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      frames.push({
        transform: `translate(${(dx * t).toFixed(2)}rem, ${(dy * t + g * t * t * 0.5).toFixed(2)}rem) rotate(${(rot * t).toFixed(0)}deg) scale(${k === 0 ? 0.4 : 1})`,
        opacity: t > 0.75 ? String(1 - (t - 0.75) * 4) : '1',
      });
    }
    const anim = p.animate(frames, { duration: dur, easing: 'linear', fill: 'forwards' });
    anim.onfinish = () => p.remove();
    window.setTimeout(() => p.remove(), dur + 200);
  }
}
