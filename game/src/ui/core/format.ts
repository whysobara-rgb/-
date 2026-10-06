/** Number / time formatting shared by HUD and screens. */
import { formatNumber } from '../i18n';

/** 1000 -> "1,000" (locale grouping). */
export function fmtScore(n: number): string {
  return formatNumber(Math.round(n));
}

/** Signed delta: 300 -> "+300". */
export function fmtDelta(n: number): string {
  return (n >= 0 ? '+' : '−') + formatNumber(Math.abs(Math.round(n)));
}

/**
 * Seconds -> "m:ss". Uses ceil so the display reaches 0:00 exactly when time runs out
 * (0.2 s left shows 0:01, never a premature 0:00).
 */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-6));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
