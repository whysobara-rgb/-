/**
 * Number / time formatting shared by HUD and screens.
 * Every formatter tolerates bad input (NaN, ±Infinity) and renders a neutral placeholder
 * instead of "NaN" — one bad value from game flow must never show garbage on screen.
 */
import { formatNumber } from '../i18n';

/** Shown for a number that is not available (NaN / Infinity). */
export const NO_VALUE = '–';
/** Largest clock value shown (99:59); longer times are clamped. */
const MAX_CLOCK_SEC = 99 * 60 + 59;

/** 1000 -> "1,000" (locale grouping). Non-finite -> "–". */
export function fmtScore(n: number): string {
  return Number.isFinite(n) ? formatNumber(Math.round(n)) : NO_VALUE;
}

/** Signed delta: 300 -> "+300". Non-finite -> "–". */
export function fmtDelta(n: number): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  return (n >= 0 ? '+' : '−') + formatNumber(Math.abs(Math.round(n)));
}

/**
 * Seconds -> "m:ss". Uses ceil so the display reaches 0:00 exactly when time runs out
 * (0.2 s left shows 0:01, never a premature 0:00). NaN -> "–:––", +Infinity -> "∞"
 * (no time limit), negative -> "0:00", more than 99:59 is clamped.
 */
export function fmtClock(sec: number): string {
  if (Number.isNaN(sec)) return '–:––';
  if (sec === Infinity) return '∞';
  const s = Math.min(MAX_CLOCK_SEC, Math.max(0, Math.ceil(sec - 1e-6)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Clamp to 0..1; NaN / non-numbers become `fallback`. */
export function clamp01(x: number | null | undefined, fallback = 0): number {
  if (typeof x !== 'number' || Number.isNaN(x)) return fallback;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** The number itself when finite, else null (for diff caches and "–" display). */
export function finiteOrNull(x: number | null | undefined): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}
