/**
 * Subtitle keys for sounds (doc §13: 자막, never rely on sound alone).
 *
 * Only sounds that carry game information are captioned; constant feedback (footsteps, grabs,
 * menu blips, whooshes) would flood the caption area. The engine reports captions through
 * `AudioEngine.setCaptionListener` with the direction the sound came from, and keeps reporting
 * them even when audio is muted or unavailable (deaf / hard-of-hearing players).
 *
 * The UI owns the real strings in src/ui/strings/{ko,en}.ts; CAPTION_FALLBACK mirrors them so
 * the audio module (and its dev gallery) can show text without depending on the UI tables. The HUD
 * resolves captions with the UI's i18n `t(key)`, so a key the UI tables do not have yet would show
 * as the raw key: `installCaptionFallbacks()` (run by `AudioEngine.setCaptionListener`) registers
 * the fallback text of every such key with i18n `registerStrings`. Keys the UI already has are
 * never overridden.
 */
import { hasKey, registerStrings } from '../ui/i18n';
import type { LoopId, SfxId } from './ids';

export const SFX_CAPTION_KEYS: Partial<Record<SfxId, string>> = {
  siren: 'caption.siren',
  unanchorBank: 'caption.unanchorBank',
  unanchorSafe: 'caption.uprootPop',
  fenceBreak: 'caption.fenceBreak',
  scoreBank: 'caption.scoreBank',
  scoreSmall: 'caption.scoreSmall',
  scoreLarge: 'caption.scoreLarge',
  dashHit: 'caption.dashHit',
  knockdown: 'caption.knockdown',
  whistleStart: 'caption.whistleStart',
  hornEnd: 'caption.hornEnd',
  safeLoad: 'caption.safeLoad',
  safeUnload: 'caption.safeUnload',
  recoverStart: 'caption.recoverStart',
  recoverCancel: 'caption.recoverCancel',
  eject: 'caption.eject',
  victory: 'caption.victory',
  defeat: 'caption.defeat',
  draw: 'caption.draw',
  // police (owner addition)
  policeSkid: 'caption.policeSkid',
  policeWhistle: 'caption.policeWhistle',
  policeBark: 'caption.policeBark',
  tackleHit: 'caption.tackle',
  tackleMiss: 'caption.tackleMiss',
  policeStun: 'caption.policeStun',
  policePhew: 'caption.policePhew',
};

/**
 * Caption keys added with the police / presentation audio. Their ko / en texts live in
 * CAPTION_FALLBACK below and are merged into the UI string tables (src/ui/strings) by the UI.
 */
export const POLICE_CAPTION_KEYS: readonly string[] = [
  'caption.uprootPop',
  'caption.policeSiren',
  'caption.alarmBell',
  'caption.policeSkid',
  'caption.policeWhistle',
  'caption.policeBark',
  'caption.tackle',
  'caption.tackleMiss',
  'caption.policeStun',
  'caption.policePhew',
];

/**
 * Minimum ms between two captions with the same key (and side) where the default (450 ms) would
 * crowd the 3-line caption area: officers keep tweeting while they chase, and several officers
 * may shout in a row.
 */
export const CAPTION_REPEAT_MS: Readonly<Record<string, number>> = {
  'caption.policeWhistle': 6000,
  'caption.policeBark': 9000,
};

/**
 * Loops captioned once, when they become audible, instead of being refreshed while they sound
 * (value: minimum ms between two such captions of the loop's key, any instance, any side). Police
 * sirens and bank alarm bells ring for most of a police match; refreshed, each would hold a line of
 * the 3-line caption area for minutes and push out the captions that carry new information
 * (tackles, knockdowns, scores). A loop that goes quiet or out of earshot captions again when it
 * comes back, after this interval.
 */
export const LOOP_CAPTION_ONSET: Partial<Record<LoopId, number>> = {
  policeSiren: 15000,
  alarmBell: 15000,
};

/**
 * Loops captioned when they become audible; unless listed in LOOP_CAPTION_ONSET the caption is
 * refreshed while they stay audible (a hauled bank, the getaway wail, a straining uproot).
 */
export const LOOP_CAPTION_KEYS: Partial<Record<LoopId, string>> = {
  bankRumble: 'caption.bankRumble',
  sirenLoop: 'caption.sirenLoop',
  strain: 'caption.strain',
  policeSiren: 'caption.policeSiren',
  alarmBell: 'caption.alarmBell',
};

/**
 * Fallback texts: a mirror of the UI string tables (the UI owns the wording and may reword; the
 * HUD then shows the UI's text) plus the texts of keys the UI has not merged yet.
 */
export const CAPTION_FALLBACK: Readonly<{ ko: Readonly<Record<string, string>>; en: Readonly<Record<string, string>> }> = {
  ko: {
    'caption.siren': '[사이렌]',
    'caption.unanchorBank': '[기초가 끊기는 소리]',
    'caption.unanchorSafe': '[금고가 뽑히는 소리]',
    'caption.fenceBreak': '[펜스가 부서지는 소리]',
    'caption.scoreBank': '[은행 회수 팡파르]',
    'caption.scoreSmall': '[짤랑! 작은 금고 회수]',
    'caption.scoreLarge': '[쿵! 큰 금고 회수]',
    'caption.dashHit': '[퍽! 부딪히는 소리]',
    'caption.whistleStart': '[시작 호루라기]',
    'caption.hornEnd': '[종료 경적]',
    'caption.knockdown': '[털썩]',
    'caption.strain': '[끄응… 당기는 소리]',
    'caption.safeLoad': '[금고가 실리는 소리]',
    'caption.safeUnload': '[금고가 빠지는 소리]',
    'caption.recoverStart': '[회수 시작]',
    'caption.recoverCancel': '[회수 취소]',
    'caption.countdownBeep': '[삐]',
    'caption.victory': '[승리 음악]',
    'caption.defeat': '[아쉬운 음악]',
    'caption.draw': '[무승부 음악]',
    'caption.ping': '[핑]',
    'caption.eject': '[퐁! 밖으로 나오는 소리]',
    'caption.bump': '[콩]',
    'caption.grab': '[덥석]',
    'caption.release': '[툭]',
    'caption.dash': '[휙]',
    'caption.bankRumble': '[은행이 끌리는 소리]',
    'caption.drag': '[드르륵 끌리는 소리]',
    'caption.sirenLoop': '[사이렌 계속]',
    'caption.uprootPop': '[뽕! 뽑히는 소리]',
    'caption.policeSiren': '[경찰 사이렌]',
    'caption.alarmBell': '[은행 경보]',
    'caption.policeSkid': '[끼익! 경찰차 도착]',
    'caption.policeWhistle': '[호루라기]',
    'caption.policeBark': '[경찰: 멈춰!]',
    'caption.tackle': '[와락! 태클]',
    'caption.tackleMiss': '[휙! 태클 빗나감]',
    'caption.policeStun': '[뾰옹~ 경찰이 넘어짐]',
    'caption.policePhew': '[휴~ 경찰차가 떠남]',
  },
  en: {
    'caption.siren': '[Siren]',
    'caption.unanchorBank': '[Foundations snapping]',
    'caption.unanchorSafe': '[Safe pops loose]',
    'caption.fenceBreak': '[Fence crashing]',
    'caption.scoreBank': '[Bank recovered fanfare]',
    'caption.scoreSmall': '[Clink! Small safe recovered]',
    'caption.scoreLarge': '[Thunk! Big safe recovered]',
    'caption.dashHit': '[Whump!]',
    'caption.whistleStart': '[Starting whistle]',
    'caption.hornEnd': '[Final horn]',
    'caption.knockdown': '[Thud]',
    'caption.strain': '[Straining]',
    'caption.safeLoad': '[Safe loaded]',
    'caption.safeUnload': '[Safe slides out]',
    'caption.recoverStart': '[Recovery starts]',
    'caption.recoverCancel': '[Recovery cancelled]',
    'caption.countdownBeep': '[Beep]',
    'caption.victory': '[Victory music]',
    'caption.defeat': '[Wistful music]',
    'caption.draw': '[Draw music]',
    'caption.ping': '[Ping]',
    'caption.eject': '[Pop! Tossed outside]',
    'caption.bump': '[Bonk]',
    'caption.grab': '[Grab]',
    'caption.release': '[Let go]',
    'caption.dash': '[Whoosh]',
    'caption.bankRumble': '[Bank scraping along]',
    'caption.drag': '[Scraping]',
    'caption.sirenLoop': '[Siren continues]',
    'caption.uprootPop': '[Pop! Uprooted]',
    'caption.policeSiren': '[Police siren]',
    'caption.alarmBell': '[Bank alarm]',
    'caption.policeSkid': '[Screech! Police car pulls up]',
    'caption.policeWhistle': '[Whistle]',
    'caption.policeBark': '[Officer: "Stop!"]',
    'caption.tackle': '[Tackle!]',
    'caption.tackleMiss': '[Whoosh! Tackle misses]',
    'caption.policeStun': '[Boing! Officer knocked over]',
    'caption.policePhew': '[Phew! Police drive off]',
  },
};

/** Fallback lookup: key -> text in the given language (falls back to Korean, then the key). */
export function captionText(key: string, lang: 'ko' | 'en' = 'ko'): string {
  return CAPTION_FALLBACK[lang][key] ?? CAPTION_FALLBACK.ko[key] ?? key;
}

/**
 * Register the fallback text of every caption key the UI string tables lack (i18n
 * `registerStrings`), so the HUD never shows a raw key such as "caption.uprootPop" while new keys
 * wait to be merged into src/ui/strings. Keys the UI has keep the UI's text. Idempotent; returns
 * the keys registered (per language).
 */
export function installCaptionFallbacks(): { ko: string[]; en: string[] } {
  const added = { ko: [] as string[], en: [] as string[] };
  for (const lang of ['ko', 'en'] as const) {
    const missing: Record<string, string> = {};
    for (const [key, text] of Object.entries(CAPTION_FALLBACK[lang])) {
      if (hasKey(key, lang)) continue;
      missing[key] = text;
      added[lang].push(key);
    }
    if (added[lang].length > 0) registerStrings(lang, missing);
  }
  return added;
}
