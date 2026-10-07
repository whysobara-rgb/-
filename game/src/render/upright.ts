/**
 * Orientation policy for text and speech bubbles (owner bar): every piece of text and every
 * speech / thought bubble rests exactly upright on screen (0 rad) and is never mirrored. The
 * toy punch comes from scale, squash-and-stretch and translation, never from rotation. Pure
 * helpers so the slam curves can be unit-tested without three.js or a canvas.
 */
import type { LayoutDef } from '../sim/types';

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

/** One layout placement for the mirror-twin lookup (`key` = kind / variant). */
export interface TwinPlacement {
  x: number;
  y: number;
  key: string;
}

/**
 * Extra render yaw (0 or PI) for a model whose readable front is local +z (safes, ATMs, vending
 * machines, crates) when it is the east mirror twin of a layout placement. The layout builder
 * mirrors a heading as PI - a, which is the true mirror of a +x-forward heading (raccoons, vans)
 * but turns a +z-front model by PI: the east twin's door / screen / brand sign ends up facing the
 * wall its west original backs onto, or away from the camera. The sim box is symmetric under PI,
 * so turning the model back is purely visual. A twin is an entry at x > axis whose mirrored
 * position holds a west entry of the same key (a lone east entry, as on the tutorial map, is
 * authored as is and keeps its yaw).
 */
export function mirrorTwinYaw(list: readonly TwinPlacement[], self: TwinPlacement, axisX: number, eps = 1e-3): number {
  if (self.x <= axisX + eps) return 0;
  const mx = 2 * axisX - self.x;
  let own = false;
  let west = false;
  for (const p of list) {
    if (p.key !== self.key || Math.abs(p.y - self.y) > eps) continue;
    if (Math.abs(p.x - self.x) <= eps) own = true;
    else if (Math.abs(p.x - mx) <= eps) west = true;
  }
  return own && west ? Math.PI : 0;
}

/** Every outdoor safe / prop placement of a layout (classic and v2 lists) for mirrorTwinYaw. */
export function lootTwinPlacements(layout: LayoutDef): TwinPlacement[] {
  const out: TwinPlacement[] = [];
  for (const s of layout.safes) out.push({ x: s.pos.x, y: s.pos.y, key: s.kind });
  for (const s of layout.v2?.safes ?? []) out.push({ x: s.pos.x, y: s.pos.y, key: s.kind });
  for (const p of layout.v2?.props ?? []) out.push({ x: p.pos.x, y: p.pos.y, key: p.variant });
  return out;
}

/** Breakables carry their twin in the id (`name.w` / `name.e`): PI for an east twin. */
export function mirrorTwinYawById(id: string, has: (id: string) => boolean): number {
  return id.endsWith('.e') && has(`${id.slice(0, -2)}.w`) ? Math.PI : 0;
}

/**
 * Sign side for a +z-front model at sim `angle` (placed with placeOnSim): its front then faces
 * world (-sin a, cos a). Facing east / west, a front sign is seen edge-on by the north-looking
 * match camera (a sideways sliver); returns +1 / -1 for the local side (+x / -x) that faces the
 * camera (world +z) so the sign can sit there upright, or 0 when the front itself is fine.
 */
export function cameraSideOf(angle: number): -1 | 0 | 1 {
  const s = Math.sin(angle);
  if (Math.abs(s) <= 0.7) return 0;
  return s > 0 ? 1 : -1;
}
