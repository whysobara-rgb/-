/**
 * Local multiplayer player identity (shared by game flow, render and UI).
 * P1..P4 colours (ring, tag, chip, offscreen arrow): sun, mint, pink, grape — away from both
 * team hues (star orange / moon blue) and always shown with the P-number, never colour alone.
 */
export const PLAYER_COLORS: readonly string[] = ['#FFD23F', '#4FD6A6', '#FF8FB8', '#A98BFF'];
/** Darker partner shade for outlines / text on light chips. */
export const PLAYER_INK: readonly string[] = ['#9C7413', '#1F7A58', '#B83A6E', '#5A3FC0'];

/** "P1".."P4". */
export function playerTag(index: number): string {
  return `P${index + 1}`;
}

export function playerColor(index: number): string {
  return PLAYER_COLORS[index] ?? PLAYER_COLORS[0]!;
}

export function playerInk(index: number): string {
  return PLAYER_INK[index] ?? PLAYER_INK[0]!;
}
