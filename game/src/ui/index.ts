/**
 * Public API of the UI layer (src/ui). Framework-free TypeScript + CSS.
 * Importing this module installs fonts and stylesheets.
 */
import './fonts';
import './styles';

// i18n
export {
  t,
  tr,
  tMaybe,
  setLanguage,
  getLanguage,
  onLanguageChange,
  detectLanguage,
  isLanguage,
  hasKey,
  listKeys,
  registerStrings,
  formatNumber,
  configureI18n,
  LANGUAGES,
} from './i18n';
export type { Language, TextRef, TParams, TParamValue } from './i18n';
export type { StringKey } from './strings/ko';

// core
export { UiRoot, createUiRoot, getUiRoot, UI_SCALE_MIN, UI_SCALE_MAX } from './core/root';
export type { UiLayerName } from './core/root';
export { UiScreen } from './core/screen';
export type { ScreenOptions } from './core/screen';
export {
  handleMenuNav,
  navRouter,
  NavRouter,
  FocusScope,
  navigable,
  setUiSoundHandler,
  uiSound,
  NAV_ACTIONS,
  EMPTY_MENU_NAV,
} from './core/nav';
export type { MenuNav, NavTarget, NavItemHandlers, UiSoundKind } from './core/nav';
export {
  setPromptGlyphProvider,
  promptGlyph,
  glyphChip,
  refreshPromptGlyphs,
  DEFAULT_KEYBOARD_GLYPHS,
  setBindingLabelFormatter,
  bindingLabel,
  bindingChip,
  defaultBindingLabel,
} from './core/prompts';
export type { NavAction, PromptAction, PromptGlyph, PromptGlyphProvider, BindingDevice, BindingLabelFormatter } from './core/prompts';
export { attachKeyboardNav } from './core/keyboardNav';
export { fontsReady } from './fonts';
export { fmtClock, fmtScore, fmtDelta } from './core/format';
export { installTheme } from './core/theme';
export { icon, lootIcon, teamEmblem, raccoon, raccoonMarkup } from './core/icons';
export type { IconName, Expression, RaccoonOptions } from './core/icons';

// domain types
export * from './types';

// components
export { Backdrop } from './components/backdrop';
export { Toasts } from './components/Toasts';
export type { ToastOptions } from './components/Toasts';
export { LayoutMap } from './components/layoutMap';
export { button, cyclerRow, sliderRow, switchRow, tabs, promptBar, screenHeader, teamTag, chip } from './components/controls';

// screens
export { TitleScreen } from './screens/TitleScreen';
export type { TitleScreenProps } from './screens/TitleScreen';
export { MainMenu } from './screens/MainMenu';
export type { MainMenuProps, MainMenuItem } from './screens/MainMenu';
export { QuickMatchSetup } from './screens/QuickMatchSetup';
export type { QuickMatchSetupProps, QuickMatchOptions, QuickLayoutChoice } from './screens/QuickMatchSetup';
export { LayoutPreview, layoutTotalValue } from './screens/LayoutPreview';
export type { LayoutPreviewProps, PreviewTeam, PreviewMember } from './screens/LayoutPreview';
export { TournamentScreen, seriesPips } from './screens/TournamentScreen';
export type { TournamentScreenProps, TournamentRivalCard, TournamentCardState } from './screens/TournamentScreen';
export { SeriesIntermission } from './screens/SeriesIntermission';
export type { SeriesIntermissionProps } from './screens/SeriesIntermission';
export { WardrobeScreen } from './screens/WardrobeScreen';
export type { WardrobeScreenProps, WardrobeHat } from './screens/WardrobeScreen';
export { SettingsScreen, BINDABLE_ACTIONS } from './screens/SettingsScreen';
export type { SettingsScreenProps, UiSettings, UiVolumes, BindingRow, BindableAction, SettingsTab } from './screens/SettingsScreen';
export { PauseMenu } from './screens/PauseMenu';
export type { PauseMenuProps } from './screens/PauseMenu';
export { ResultsScreen } from './screens/ResultsScreen';
export type { ResultsScreenProps, ResultOutcome, ResultEventView, ResultSeriesView } from './screens/ResultsScreen';
export { ConfirmDialog, confirmDialog } from './screens/ConfirmDialog';
export type { ConfirmDialogProps } from './screens/ConfirmDialog';
export { LoadingScreen } from './screens/LoadingScreen';
export type { LoadingScreenProps } from './screens/LoadingScreen';

// HUD
export { Hud } from './hud/Hud';
export { Minimap } from './hud/Minimap';
export { WorldLabels } from './hud/WorldLabels';
export { OffscreenArrows } from './hud/OffscreenArrows';
export { hudModelFromSim, hudBanksFromState, minimapFromState, carryFromState, grabFromState, labelsFromSim, carrierTeam } from './hud/adapters';
export type { SimView, Projector, HudAdapterOptions } from './hud/adapters';
export type {
  HudModel,
  HudBank,
  HudCarry,
  HudGrab,
  MinimapModel,
  MinimapBank,
  MinimapSafe,
  MinimapCharacter,
  MinimapPing,
  WorldLabelModel,
  ValueLabel,
  BankLabel,
  RecoveryLabel,
  PingLabel,
  NameLabel,
  OffscreenTarget,
  ScorePopupOptions,
  BannerKind,
  TutorialPromptModel,
  CaptionOptions,
} from './hud/types';
