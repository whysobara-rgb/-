/**
 * Player settings (doc §13 accessibility first: rebinding, grab toggle, subtitles, per-category
 * volume, vibration and screen-shake control).
 *
 * `sanitizeSettings(unknown)` is the single gate for anything read from disk or another
 * process: it always returns a complete, valid `Settings` object and never throws.
 */
import { cloneBindings, defaultBindings, isRecord, sanitizeBindings, type Bindings } from './bindings';
import { getNative } from './native';

export type Language = 'ko' | 'en';
export type GrabMode = 'hold' | 'toggle';
export type Quality = 'low' | 'medium' | 'high';

export interface Volumes {
  /** All values 0..1. */
  master: number;
  music: number;
  sfx: number;
  ui: number;
}

export interface Settings {
  language: Language;
  /** 'hold': grab while the button is held. 'toggle': press to grab, press again to release. */
  grabMode: GrabMode;
  bindings: Bindings;
  volumes: Volumes;
  /** Closed captions for important sounds ([사이렌]). */
  subtitles: boolean;
  /** 0 = off .. 1 = full. */
  screenShake: number;
  /** Gamepad rumble. */
  vibration: boolean;
  reducedMotion: boolean;
  quality: Quality;
  fullscreen: boolean;
  /** HUD / menu scale, 0.8..1.4. */
  uiScale: number;
  showTutorialHints: boolean;
  /**
   * Show other raccoons' taunts (bubbles, poses, sounds). Off hides everyone else's taunts;
   * your own always play. Default on.
   */
  showOthersTaunts: boolean;
}

export const LANGUAGES: readonly Language[] = ['ko', 'en'];
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.4;

export interface LanguageHints {
  /** Steam game language API name ('koreana', 'english', ...), when running under Steam. */
  steamLanguage?: string | null;
  /** Browser/OS preference list (navigator.languages). */
  languages?: readonly string[] | null;
}

/**
 * Pick the initial language. Steam's per-game language wins (the player chose it in the
 * Steam client), then the OS/browser preference list. Korean players get Korean, everyone
 * else gets English; with no locale information at all we fall back to Korean, the game's
 * primary language.
 *
 * Deliberate reading of the spec's "default from navigator, ko fallback": a Japanese, German
 * or Chinese locale IS locale information, and those players are far better served by English
 * (the only other shipped language) than by Korean. The UI's own `detectLanguage` (src/ui/i18n)
 * makes the same choice, so the two never disagree. The player can switch in Settings anyway.
 */
export function detectLanguage(hints: LanguageHints = defaultLanguageHints()): Language {
  const steam = hints.steamLanguage?.toLowerCase();
  if (steam) {
    if (steam === 'koreana' || steam === 'korean') return 'ko';
    return 'en';
  }
  const langs = (hints.languages ?? []).filter((l): l is string => typeof l === 'string' && l.length > 0);
  for (const l of langs) {
    const tag = l.toLowerCase();
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('en')) return 'en';
  }
  return langs.length ? 'en' : 'ko';
}

/** Locale hints from the running environment: Steam (desktop build) and navigator. */
export function defaultLanguageHints(): LanguageHints {
  const hints: LanguageHints = {};
  try {
    hints.steamLanguage = getNative()?.steam?.language ?? null;
  } catch {
    hints.steamLanguage = null;
  }
  try {
    if (typeof navigator !== 'undefined') {
      hints.languages = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
    }
  } catch {
    // ignore: no locale information
  }
  return hints;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Fresh defaults, honoring the environment (locale, OS reduced-motion preference). */
export function createDefaultSettings(hints?: LanguageHints): Settings {
  return {
    language: detectLanguage(hints),
    grabMode: 'hold',
    bindings: defaultBindings(),
    volumes: { master: 0.8, music: 0.7, sfx: 0.9, ui: 0.8 },
    subtitles: false,
    screenShake: 1,
    vibration: true,
    reducedMotion: prefersReducedMotion(),
    quality: 'medium',
    fullscreen: true,
    uiScale: 1,
    showTutorialHints: true,
    showOthersTaunts: true,
  };
}

/**
 * Defaults computed once at module load. Treat as read-only; use `createDefaultSettings()` or
 * `cloneSettings(DEFAULT_SETTINGS)` for a mutable copy.
 */
export const DEFAULT_SETTINGS: Readonly<Settings> = freezeSettings(createDefaultSettings());

function freezeSettings(s: Settings): Readonly<Settings> {
  Object.freeze(s.volumes);
  for (const dev of Object.values(s.bindings)) {
    for (const list of Object.values(dev)) Object.freeze(list);
    Object.freeze(dev);
  }
  Object.freeze(s.bindings);
  return Object.freeze(s);
}

export function cloneSettings(s: Readonly<Settings>): Settings {
  return { ...s, volumes: { ...s.volumes }, bindings: cloneBindings(s.bindings) };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Round to 2 decimals so slider values stay tidy in the save file. */
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Validate anything into a complete Settings object. Unknown fields are dropped, invalid or
 * missing ones take the value from `base` (default: DEFAULT_SETTINGS).
 */
export function sanitizeSettings(raw: unknown, base: Readonly<Settings> = DEFAULT_SETTINGS): Settings {
  const src = isRecord(raw) ? raw : {};
  const vol = isRecord(src.volumes) ? src.volumes : {};
  return {
    language: oneOf(src.language, LANGUAGES, base.language),
    grabMode: oneOf(src.grabMode, ['hold', 'toggle'] as const, base.grabMode),
    bindings: src.bindings === undefined ? cloneBindings(base.bindings) : sanitizeBindings(src.bindings),
    volumes: {
      master: round2(num(vol.master, base.volumes.master, 0, 1)),
      music: round2(num(vol.music, base.volumes.music, 0, 1)),
      sfx: round2(num(vol.sfx, base.volumes.sfx, 0, 1)),
      ui: round2(num(vol.ui, base.volumes.ui, 0, 1)),
    },
    subtitles: bool(src.subtitles, base.subtitles),
    screenShake: round2(num(src.screenShake, base.screenShake, 0, 1)),
    vibration: bool(src.vibration, base.vibration),
    reducedMotion: bool(src.reducedMotion, base.reducedMotion),
    quality: oneOf(src.quality, QUALITIES, base.quality),
    fullscreen: bool(src.fullscreen, base.fullscreen),
    uiScale: round2(num(src.uiScale, base.uiScale, UI_SCALE_MIN, UI_SCALE_MAX)),
    showTutorialHints: bool(src.showTutorialHints, base.showTutorialHints),
    showOthersTaunts: bool(src.showOthersTaunts, base.showOthersTaunts),
  };
}

/** Effective volume for a category (master * category). */
export function effectiveVolume(v: Readonly<Volumes>, category: Exclude<keyof Volumes, 'master'>): number {
  return clamp(v.master * v[category], 0, 1);
}
