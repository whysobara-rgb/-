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
  // --- uproot presentation (synced with src/render/uproot.ts) ---
  'uprootLand',
  'bankLand',
  // --- callout stingers (HUD "뽑았다!" / "은행째!" / "가로채기!" / "태클 피했다!") ---
  'calloutUproot',
  'calloutBank',
  'calloutSteal',
  'calloutDodge',
  // --- police (owner addition beyond doc v0.5) ---
  'policeSkid',
  'carDoor',
  'carVroom',
  'policeWhistle',
  'policeBark',
  'tackleWhoosh',
  'tackleHit',
  'tackleMiss',
  'policeStun',
  'policePhew',
  // --- taunts (owner addition; ./sfxTaunt.ts) ---
  'tauntWiggle',
  'tauntBleh',
  'tauntCash',
  'tauntSquat',
  'tauntZoom',
  'tauntFlex',
  'tauntShrug',
] as const;
export type SfxId = (typeof SFX_IDS)[number];

/**
 * Continuous sounds driven every frame with an intensity 0..1 (0 = silent).
 * `policeSiren` (one per police car) and `alarmBell` (one per ringing bank) are police additions.
 */
export const LOOP_IDS = ['drag', 'bankRumble', 'strain', 'sirenLoop', 'policeSiren', 'alarmBell'] as const;
export type LoopId = (typeof LOOP_IDS)[number];

/** Music tracks. 'none' fades the current track out. */
export const MUSIC_IDS = ['title', 'match', 'final', 'results', 'none'] as const;
export type MusicId = (typeof MUSIC_IDS)[number];
export type TrackId = Exclude<MusicId, 'none'>;
export const TRACK_IDS: readonly TrackId[] = ['title', 'match', 'final', 'results'];

/** Mixer bus a sound is routed to (each has its own volume slider). */
export type BusId = 'sfx' | 'ui' | 'music';

/**
 * Loops that are "ambience" (sirens, alarm bells): they run through a sub-bus of the sfx bus that
 * scoring sounds duck, so a ringing bank or a parked police car never masks the coins.
 */
export const AMBIENCE_LOOPS: readonly LoopId[] = ['sirenLoop', 'policeSiren', 'alarmBell'];

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
