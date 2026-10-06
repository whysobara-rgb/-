/**
 * Subtitle keys for sounds (doc §13: 자막, never rely on sound alone).
 *
 * Only sounds that carry game information are captioned; constant feedback (footsteps, grabs,
 * menu blips, whooshes) would flood the caption area. The engine reports captions through
 * `AudioEngine.setCaptionListener` with the direction the sound came from, and keeps reporting
 * them even when audio is muted or unavailable (deaf / hard-of-hearing players).
 *
 * The UI owns the real strings in src/ui/strings/{ko,en}.ts; CAPTION_FALLBACK mirrors them so
 * the audio module (and its dev gallery) can show text without depending on the UI.
 */
import type { LoopId, SfxId } from './ids';

export const SFX_CAPTION_KEYS: Partial<Record<SfxId, string>> = {
  siren: 'caption.siren',
  unanchorBank: 'caption.unanchorBank',
  unanchorSafe: 'caption.unanchorSafe',
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
};

/** Loops captioned when they become audible (and refreshed while they stay audible). */
export const LOOP_CAPTION_KEYS: Partial<Record<LoopId, string>> = {
  bankRumble: 'caption.bankRumble',
  sirenLoop: 'caption.sirenLoop',
  strain: 'caption.strain',
};

/** Fallback texts (kept identical to the UI string tables). */
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
  },
  en: {
    'caption.siren': '[Siren]',
    'caption.unanchorBank': '[Foundations snapping]',
    'caption.unanchorSafe': '[Safe pops loose]',
    'caption.fenceBreak': '[Fence crashing]',
    'caption.scoreBank': '[Bank recovered fanfare]',
    'caption.scoreSmall': '[Clink! Small safe recovered]',
    'caption.scoreLarge': '[Thunk! Large safe recovered]',
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
  },
};

/** Fallback lookup: key -> text in the given language (falls back to Korean, then the key). */
export function captionText(key: string, lang: 'ko' | 'en' = 'ko'): string {
  return CAPTION_FALLBACK[lang][key] ?? CAPTION_FALLBACK.ko[key] ?? key;
}
