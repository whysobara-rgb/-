/**
 * Identifiers of every sound the audio module can make.
 *
 * The lists are runtime arrays (the gallery, tests and offline QA iterate them) and the union
 * types are derived from them, so adding a sound means adding exactly one string here plus its
 * recipe in ./sfx.ts (the compiler then demands the recipe).
 */

/** One-shot sound effects (docs/ARCHITECTURE.md "Audio API"). `uiTab`/`uiAdjust` are additions. */
export const SFX_IDS = [
  'grab',
  'release',
  'dash',
  'dashHit',
  'bump',
  'knockdown',
  'strain',
  'unanchorSafe',
  'unanchorBank',
  'fenceBreak',
  'safeLoad',
  'safeUnload',
  'recoverStart',
  'recoverCancel',
  'scoreSmall',
  'scoreLarge',
  'scoreBank',
  'siren',
  'countdownBeep',
  'whistleStart',
  'hornEnd',
  'victory',
  'defeat',
  'draw',
  'ping',
  'eject',
  'footstep',
  'uiMove',
  'uiConfirm',
  'uiBack',
  'uiError',
  'uiTab',
  'uiAdjust',
  'popup',
] as const;
export type SfxId = (typeof SFX_IDS)[number];

/** Continuous sounds driven every frame with an intensity 0..1 (0 = silent). */
export const LOOP_IDS = ['drag', 'bankRumble', 'strain', 'sirenLoop'] as const;
export type LoopId = (typeof LOOP_IDS)[number];

/** Music tracks. 'none' fades the current track out. */
export const MUSIC_IDS = ['title', 'match', 'final', 'results', 'none'] as const;
export type MusicId = (typeof MUSIC_IDS)[number];
export type TrackId = Exclude<MusicId, 'none'>;
export const TRACK_IDS: readonly TrackId[] = ['title', 'match', 'final', 'results'];

/** Mixer bus a sound is routed to (each has its own volume slider). */
export type BusId = 'sfx' | 'ui' | 'music';

/** Menu sound kinds emitted by the UI layer (`src/ui/core/nav.ts` UiSoundKind). */
export const UI_SOUND_SFX: Readonly<Record<'move' | 'confirm' | 'back' | 'error' | 'tab' | 'adjust', SfxId>> = {
  move: 'uiMove',
  confirm: 'uiConfirm',
  back: 'uiBack',
  error: 'uiError',
  tab: 'uiTab',
  adjust: 'uiAdjust',
};

export function isSfxId(x: string): x is SfxId {
  return (SFX_IDS as readonly string[]).includes(x);
}
export function isLoopId(x: string): x is LoopId {
  return (LOOP_IDS as readonly string[]).includes(x);
}
export function isMusicId(x: string): x is MusicId {
  return (MUSIC_IDS as readonly string[]).includes(x);
}
