/**
 * Public entry point of the audio module. Game code imports from here only.
 */
export {
  AudioEngine,
  getAudioEngine,
  unlockOnFirstGesture,
  type AudioEngineOptions,
  type CaptionEvent,
  type CaptionListener,
  type PlayOptions,
} from './audio';
export { LOOP_IDS, MUSIC_IDS, SFX_IDS, TRACK_IDS, UI_SOUND_SFX, isLoopId, isMusicId, isSfxId, type LoopId, type MusicId, type SfxId, type TrackId } from './ids';
export { CAPTION_FALLBACK, LOOP_CAPTION_KEYS, LOOP_CAPTION_ONSET, POLICE_CAPTION_KEYS, SFX_CAPTION_KEYS, TAUNT_CAPTION_KEYS, captionText, installCaptionFallbacks } from './captions';
export { DEFAULT_VOLUMES, busGains, volumeToGain, type Volumes } from './mixer';
export { SPATIAL, spatialMix, distanceGain, captionSide, type SpatialMix } from './spatial';
export { MatchAudioDirector, TAUNT_SFX, tauntTag, type DirectorOptions, type AudioSimView, type TensionState } from './director';
