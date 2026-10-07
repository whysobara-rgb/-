/**
 * Tiny, dependency-free i18n for the whole game.
 *
 *   t('hud.estimate', { value: 1000 })   -> '예상 1,000'
 *   setLanguage('en'); onLanguageChange(lang => ...)
 *
 * Rules
 * - Placeholders are `{name}`. Numbers are formatted with digit grouping (1000 -> "1,000").
 * - A string param that is itself a known key (e.g. a chokepoint `nameKey` passed as
 *   `{ choke: 'choke.northAlley' }`) is translated automatically, so callers can pass keys.
 * - Missing key: in dev builds a visible `⟦key⟧` marker plus a one-time console.warn; in
 *   production the key text itself.
 * - LAYOUT_STRINGS (owned by the layout module) is merged over the UI dictionaries.
 *
 * Node-safe: no DOM access except optional `document.documentElement.lang` updates.
 */
import { ko } from './strings/ko';
import { en } from './strings/en';
import { LAYOUT_STRINGS } from '../sim/layouts/strings';

export type Language = 'ko' | 'en';
export const LANGUAGES: readonly Language[] = ['ko', 'en'] as const;

export type TParamValue = string | number;
export type TParams = Readonly<Record<string, TParamValue | null | undefined>>;

/**
 * Text reference accepted by every screen prop that shows text:
 * - a plain string is an i18n key,
 * - `{ key, params }` is a key with params,
 * - `{ text }` is literal text (player names etc.), shown as-is.
 */
export type TextRef = string | { key: string; params?: TParams } | { text: string };

type Dict = Record<string, string>;

const dicts: Record<Language, Dict> = {
  ko: { ...ko, ...(LAYOUT_STRINGS?.ko ?? {}) },
  en: { ...en, ...(LAYOUT_STRINGS?.en ?? {}) },
};

let current: Language = 'ko';
let devMode: boolean = readDevFlag();
const listeners = new Set<(lang: Language) => void>();
const warned = new Set<string>();
const numberFormats: Partial<Record<Language, Intl.NumberFormat>> = {};

function readDevFlag(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/** Override dev/prod missing-key behaviour (tests, tools). */
export function configureI18n(opts: { dev?: boolean }): void {
  if (opts.dev !== undefined) devMode = opts.dev;
}

export function getLanguage(): Language {
  return current;
}

export function isLanguage(x: unknown): x is Language {
  return x === 'ko' || x === 'en';
}

/** Best guess from the OS/browser locale; the saved setting should win when present. */
export function detectLanguage(): Language {
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/** Switch language and notify subscribers (no-op when unchanged). */
export function setLanguage(lang: Language): void {
  if (!isLanguage(lang) || lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const cb of [...listeners]) {
    try {
      cb(lang);
    } catch (err) {
      console.error('[i18n] language listener failed', err);
    }
  }
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLanguageChange(cb: (lang: Language) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function hasKey(key: string, lang: Language = current): boolean {
  return Object.prototype.hasOwnProperty.call(dicts[lang], key);
}

/**
 * Add or override strings at runtime (e.g. another module's own text). Later calls win.
 * Prefer adding keys to the dictionaries in src/ui/strings; this exists for modules that
 * must stay self-contained.
 */
export function registerStrings(lang: Language, strings: Readonly<Record<string, string>>): void {
  Object.assign(dicts[lang], strings);
}

/** All keys of a language (tests / tooling). */
export function listKeys(lang: Language): string[] {
  return Object.keys(dicts[lang]);
}

export function formatNumber(n: number, lang: Language = current): string {
  // Never render "NaN" / "∞" from a bad value; a neutral dash reads as "not available".
  if (!Number.isFinite(n)) return '–';
  let f = numberFormats[lang];
  if (!f) {
    f = new Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { maximumFractionDigits: 0 });
    numberFormats[lang] = f;
  }
  return f.format(n);
}

function warnOnce(id: string, msg: string): void {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(msg);
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Translate `key` in the current language, substituting `{param}` placeholders. */
export function t(key: string, params?: TParams): string {
  const dict = dicts[current];
  const raw = dict[key];
  if (raw === undefined) {
    if (devMode) {
      warnOnce(`${current}:${key}`, `[i18n] missing key "${key}" (${current})`);
      return `⟦${key}⟧`;
    }
    return key;
  }
  if (!params || raw.indexOf('{') < 0) return raw;
  return raw.replace(PLACEHOLDER, (whole, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) {
      if (devMode) warnOnce(`${current}:${key}:{${name}}`, `[i18n] missing param {${name}} for "${key}"`);
      return devMode ? whole : '';
    }
    if (typeof v === 'number') return formatNumber(v);
    // A param may itself be a key (e.g. a chokepoint nameKey or 'loot.largeSafe.name').
    if (v.indexOf('.') > 0 && dict[v] !== undefined) return dict[v];
    return v;
  });
}

/** Resolve a TextRef (key, key+params, or literal text). */
export function tr(ref: TextRef | null | undefined): string {
  if (ref === null || ref === undefined) return '';
  if (typeof ref === 'string') return t(ref);
  if ('text' in ref) return ref.text;
  return t(ref.key, ref.params);
}

/**
 * Resolve a name that may be either an i18n key or literal text: like tr(), except that a
 * plain string which is NOT a dictionary key is shown as-is (no missing-key marker). Used for
 * character names: 'rival.hodadak.name' / 'name.ally' follow the language, a player-entered
 * name stays literal.
 */
export function trName(ref: TextRef | null | undefined): string {
  if (typeof ref === 'string') return hasKey(ref) ? t(ref) : ref;
  return tr(ref);
}

/** Like t() but returns null instead of a fallback when the key does not exist. */
export function tMaybe(key: string, params?: TParams): string | null {
  return hasKey(key) ? t(key, params) : null;
}
