/**
 * UiRoot: the single HTML overlay that hosts every UI layer.
 *
 *   const ui = createUiRoot(document.getElementById('app')!);
 *   ui.setUiScale(settings.uiScale); ui.setReducedMotion(settings.reducedMotion);
 *   // each frame (menus): ui.handleNav(input.pollMenu());
 *
 * Layers (bottom -> top): backdrop, world (HUD world labels), hud, screens, dialogs, toasts.
 * The root is `position:absolute; inset:0` inside its container, which should be the same
 * element (or same box) as the 3D view container so world-label pixel coordinates line up.
 */
import '../fonts';
import '../styles';
import { installTheme } from './theme';
import { handleMenuNav, type MenuNav } from './nav';
import type { NavAction } from './prompts';
import { clamp } from './format';

/** Window event telling visible screens to re-check their fit (UI scale / font changes). */
export const RELAYOUT_EVENT = 'uh-relayout';
import { getLanguage, onLanguageChange } from '../i18n';

export type UiLayerName = 'backdrop' | 'world' | 'hud' | 'screens' | 'dialogs' | 'toasts';
const LAYERS: readonly UiLayerName[] = ['backdrop', 'world', 'hud', 'screens', 'dialogs', 'toasts'];

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.4;

let defaultRoot: UiRoot | null = null;

export class UiRoot {
  readonly el: HTMLDivElement;
  readonly layers: Readonly<Record<UiLayerName, HTMLDivElement>>;
  private scale = 1;
  private readonly unsubLang: () => void;

  constructor(readonly container: HTMLElement = document.body) {
    installTheme();
    this.el = document.createElement('div');
    this.el.className = 'uh-root';
    this.el.setAttribute('lang', getLanguage());
    const layers = {} as Record<UiLayerName, HTMLDivElement>;
    for (const name of LAYERS) {
      const layer = document.createElement('div');
      layer.className = `uh-layer uh-layer--${name}`;
      layer.dataset.layer = name;
      this.el.appendChild(layer);
      layers[name] = layer;
    }
    this.layers = layers;
    if (getComputedStyle(container).position === 'static' && container !== document.body) {
      container.style.position = 'relative';
    }
    container.appendChild(this.el);
    document.documentElement.lang = getLanguage();
    this.unsubLang = onLanguageChange((lang) => this.el.setAttribute('lang', lang));
    // Web fonts load lazily (unicode-range subsets); text metrics change when they arrive, so
    // visible screens re-check their fit (UiScreen.fitToViewport).
    document.fonts?.addEventListener('loadingdone', this.onFontsLoaded);
    if (!defaultRoot) defaultRoot = this;
  }

  layer(name: UiLayerName): HTMLDivElement {
    return this.layers[name];
  }

  /** Player UI size setting, clamped to 0.8..1.4. */
  setUiScale(scale: number): void {
    this.scale = clamp(Number.isFinite(scale) ? scale : 1, UI_SCALE_MIN, UI_SCALE_MAX);
    document.documentElement.style.setProperty('--uh-ui-scale', String(this.scale));
    // Visible screens re-check whether they still fit (see UiScreen.fitToViewport).
    window.dispatchEvent(new Event(RELAYOUT_EVENT));
  }

  getUiScale(): number {
    return this.scale;
  }

  /** Reduced-motion setting: disables CSS animations/transitions and JS micro-animations. */
  setReducedMotion(on: boolean): void {
    document.documentElement.classList.toggle('uh-reduced-motion', on);
  }

  /** Forward one frame of menu input (or a single action) to the top-most screen/dialog. */
  handleNav(nav: MenuNav | NavAction): boolean {
    return handleMenuNav(nav);
  }

  private readonly onFontsLoaded = (): void => {
    window.dispatchEvent(new Event(RELAYOUT_EVENT));
  };

  destroy(): void {
    document.fonts?.removeEventListener('loadingdone', this.onFontsLoaded);
    this.unsubLang();
    this.el.remove();
    if (defaultRoot === this) defaultRoot = null;
  }
}

/** Create the overlay inside `container` and make it the default parent for screens. */
export function createUiRoot(container?: HTMLElement): UiRoot {
  const root = new UiRoot(container);
  defaultRoot = root;
  return root;
}

/** The default root (created lazily on document.body if none exists yet). */
export function getUiRoot(): UiRoot {
  if (!defaultRoot) defaultRoot = new UiRoot(document.body);
  return defaultRoot;
}
