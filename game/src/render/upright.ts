/**
 * Orientation policy for text and speech bubbles (owner bar): every piece of text and every
 * speech / thought bubble rests exactly upright on screen (0 rad) and is never mirrored. The
 * toy punch comes from scale, squash-and-stretch and translation, never from rotation. Pure
 * helpers so the slam curves can be unit-tested without three.js or a canvas.
 */

/** Screen-plane rotation for any text / bubble sprite: always 0 (kept as a seam for tests). */
export const TEXT_ROTATION = 0;

/**
 * Squash-and-stretch factor for a slam that lands at `t0` (seconds): a short tall stretch while
 * it flies in, then a damped wide squash on impact. Returns q; apply as scale (1 + q, 1 - q).
 * 0 before the motion starts and decays to ~0 a few tenths of a second after landing.
 */
export function slamSquash(t: number, t0: number, amp = 0.16): number {
  if (t < 0) return 0;
  if (t < t0) return -amp * 0.6 * (t / t0);
  const u = t - t0;
  return amp * Math.exp(-u * 14) * Math.cos(u * 28);
}

/**
 * Drop-in offset (world units, added to y) for a slam that lands at `t0`: starts `h` above and
 * falls onto the rest position with an ease-in, so the word lands like a stamp.
 */
export function slamDrop(t: number, t0: number, h: number): number {
  if (t >= t0 || t0 <= 0) return 0;
  const k = 1 - Math.max(0, t) / t0;
  return h * k * k;
}

/** Per-instance rotation for an emote slot: bubbles never rotate; side stickers may spin. */
export function emoteSlotRotation(bubbled: boolean, rot: number): number {
  return bubbled ? TEXT_ROTATION : rot;
}
