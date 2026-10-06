/**
 * Public entry point of the renderer (docs/ARCHITECTURE.md "Render API").
 * Game flow imports GameView from here; model factories stay available via './models'.
 */
export { GameView } from './view';
export type { ViewSettings, ViewFocus, ViewMode, ViewStats, TelegraphKind, ViewCallout } from './view';
export type { EmoteKind } from './emotes';
export { GameCamera, MATCH_DIST, MATCH_FOV, MATCH_PITCH, NORTH_YAW, fitDistance } from './camera';
export { GRAB_MARKER_COLOR } from './effects';
export type { CameraGoal } from './camera';
export { QUALITY_PRESETS, qualityPreset } from './quality';
export type { QualityLevel, QualityPreset } from './quality';
export { PoseBuffer, SNAP_DISTANCE, lerpAngle, wrapAngle } from './sync';
