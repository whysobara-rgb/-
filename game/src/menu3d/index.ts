/**
 * Live 3D menus (second WebGL context, owned by game flow while menus own the screen).
 * See stage.ts for the lifecycle and scenes/ for the dioramas.
 */
export { MenuStage, type MenuStageOptions, type MenuStageStats } from './stage';
export { MenuScene, type MenuCue } from './scene';
export { PortraitCache, type RaccoonPortraitSpec } from './portraits';
export { TitleScene, type TitleSceneOptions } from './scenes/title';
export { HideoutScene, type HideoutFocus, type HideoutFraming, type HideoutOptions } from './scenes/hideout';
export { PreviewScene, type PreviewSceneOptions } from './scenes/preview';
export { TournamentScene, type TournamentSceneOptions, type StageRival, type StageState } from './scenes/tournament';
export { WardrobeScene, type WardrobeSceneOptions } from './scenes/wardrobe';
