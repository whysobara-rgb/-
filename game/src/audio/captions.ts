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
  // taunts (owner addition)
  tauntWiggle: 'caption.tauntWiggle',
  tauntBleh: 'caption.tauntBleh',
  tauntCash: 'caption.tauntCash',
  tauntSquat: 'caption.tauntSquat',
  tauntZoom: 'caption.tauntZoom',
  tauntFlex: 'caption.tauntFlex',
  tauntShrug: 'caption.tauntShrug',
  // [C9] Content 2.0: items, coins, props, breakables (every cue captioned; see CONTENT_CAPTION_KEYS)
  hammerWindup: 'caption.hammerWindup',
  hammerSwing: 'caption.hammerSwing',
  hammerBonk: 'caption.hammerBonk',
  hammerClash: 'caption.hammerClash',
  itemPickup: 'caption.itemPickup',
  itemDrop: 'caption.itemDrop',
  itemPoof: 'caption.itemPoof',
  supplyIncoming: 'caption.supplyIncoming',
  supplyLand: 'caption.supplyLand',
  goldHammerSting: 'caption.goldHammerSting',
  coinPickup: 'caption.coinPickup',
  billPickup: 'caption.billPickup',
  coinPop: 'caption.coinPop',
  coinSpill: 'caption.coinSpill',
  depositStart: 'caption.depositStart',
  coinDeposit: 'caption.coinDeposit',
  atmSpurt: 'caption.atmSpurt',
  atmBonk: 'caption.atmBonk',
  piggyOink: 'caption.piggyOink',
  piggyCrack: 'caption.piggyCrack',
  piggyJackpot: 'caption.piggyJackpot',
  rootRip: 'caption.rootRip',
  billFlutter: 'caption.billFlutter',
  crateBreak: 'caption.crateBreak',
  vendingHit: 'caption.vendingHit',
  vendingBreak: 'caption.vendingBreak',
  // [C9] end
  // [F8] tension audio (every cue captioned; see TENSION_CAPTION_KEYS)
  tensionHeartbeat: 'caption.tensionHeartbeat',
  stingBlocked: 'caption.stingBlocked',
  stingLead: 'caption.stingLead',
  stingEqual: 'caption.stingEqual',
  streakFill: 'caption.streakFill',
  streakScratch: 'caption.streakScratch',
  runClimb: 'caption.runClimb',
  finalTick: 'caption.finalTick',
  vanRev: 'caption.vanRev',
  vanDriveOff: 'caption.vanDriveOff',
  tauntPunish: 'caption.tauntPunish',
  dodgeWhoosh: 'caption.dodgeWhoosh',
  clashAccent: 'caption.clashAccent',
  barkBlip: 'caption.barkBlip',
  stingGoldHammer: 'caption.stingGoldHammer',
  // [F8] end
};

/** Caption keys of the taunt sounds (owner addition); texts in CAPTION_FALLBACK / the UI tables. */
export const TAUNT_CAPTION_KEYS: readonly string[] = [
  'caption.tauntWiggle',
  'caption.tauntBleh',
  'caption.tauntCash',
  'caption.tauntSquat',
  'caption.tauntZoom',
  'caption.tauntFlex',
  'caption.tauntShrug',
];

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
 * [C9] Caption keys of the Content 2.0 sounds (items, coins, props, breakables). Their ko / en
 * texts live in CAPTION_FALLBACK below (the HUD shows them through installCaptionFallbacks until
 * the UI tables carry them).
 */
export const CONTENT_CAPTION_KEYS: readonly string[] = [
  'caption.hammerWindup',
  'caption.hammerSwing',
  'caption.hammerBonk',
  'caption.hammerClash',
  'caption.itemPickup',
  'caption.itemDrop',
  'caption.itemPoof',
  'caption.supplyIncoming',
  'caption.supplyLand',
  'caption.goldHammerSting',
  'caption.coinPickup',
  'caption.billPickup',
  'caption.coinPop',
  'caption.coinSpill',
  'caption.depositStart',
  'caption.coinDeposit',
  'caption.atmSpurt',
  'caption.atmBonk',
  'caption.piggyOink',
  'caption.piggyCrack',
  'caption.piggyJackpot',
  'caption.rootRip',
  'caption.billFlutter',
  'caption.crateBreak',
  'caption.vendingHit',
  'caption.vendingBreak',
];

/**
 * [F8] Caption keys of the tension cues (heartbeat, stings, run, final seconds, getaway, taunt /
 * dodge / clash accents, barks, golden hammer landing). Texts in CAPTION_FALLBACK below and in the
 * UI tables' [WP8] block.
 */
export const TENSION_CAPTION_KEYS: readonly string[] = [
  'caption.tensionHeartbeat',
  'caption.stingBlocked',
  'caption.stingLead',
  'caption.stingEqual',
  'caption.streakFill',
  'caption.streakScratch',
  'caption.runClimb',
  'caption.finalTick',
  'caption.vanRev',
  'caption.vanDriveOff',
  'caption.tauntPunish',
  'caption.dodgeWhoosh',
  'caption.clashAccent',
  'caption.barkBlip',
  'caption.stingGoldHammer',
];

/**
 * Minimum ms between two captions with the same key (and side) where the default (450 ms) would
 * crowd the 3-line caption area: officers keep tweeting while they chase, and several officers
 * may shout in a row.
 */
export const CAPTION_REPEAT_MS: Readonly<Record<string, number>> = {
  'caption.policeWhistle': 6000,
  'caption.policeBark': 9000,
  // [C9] coins and swings come in bursts (a scoop takes 5 piles in a second): one line per burst
  'caption.coinPickup': 2500,
  'caption.billPickup': 2500,
  'caption.coinPop': 1500,
  'caption.hammerSwing': 1200,
  'caption.hammerWindup': 800,
  'caption.depositStart': 1500,
  'caption.piggyOink': 1500,
  // [F8] the heartbeat beats every ~0.7 s while a match point lasts: one line per 8 s; barks in bursts
  'caption.tensionHeartbeat': 8000,
  'caption.barkBlip': 3000,
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
    'caption.tauntWiggle': '[뿌뿌~ 엉덩이 흔드는 소리]',
    'caption.tauntBleh': '[부르르~ 메롱 소리]',
    'caption.tauntCash': '[촤라락 돈다발 부채질]',
    'caption.tauntSquat': '[뽀잉뽀잉 쭈그려 뛰기]',
    'caption.tauntZoom': '[후다닥 슝]',
    'caption.tauntFlex': '[반짝 근육 자랑]',
    'caption.tauntShrug': '[으쓱~]',
    // [C9] Content 2.0
    'caption.hammerWindup': '[뀨잇~ 뿅망치를 치켜드는 소리]',
    'caption.hammerSwing': '[휙! 뿅망치 휘두르는 소리]',
    'caption.hammerBonk': '[뿅! 뿅망치에 맞는 소리]',
    'caption.hammerClash': '[챙! 뿅망치끼리 부딪힘]',
    'caption.itemPickup': '[뾱뾱, 아이템을 주웠어요]',
    'caption.itemDrop': '[딸그락, 아이템을 떨어뜨림]',
    'caption.itemPoof': '[펑, 아이템이 사라짐]',
    'caption.supplyIncoming': '[딩동~ 보급 풍선이 내려와요]',
    'caption.supplyLand': '[쿵! 보급 상자 도착]',
    'caption.goldHammerSting': '[두구두구… 황금 뿅망치가 와요]',
    'caption.coinPickup': '[짤랑, 동전 줍는 소리]',
    'caption.billPickup': '[팔락, 지폐 다발 줍는 소리]',
    'caption.coinPop': '[짤랑짤랑, 동전이 튀어나옴]',
    'caption.coinSpill': '[와르르! 주머니 동전이 쏟아짐]',
    'caption.depositStart': '[스르륵, 주머니 여는 소리]',
    'caption.coinDeposit': '[촤르르, 쏟아붓기 완료]',
    'caption.atmSpurt': '[삐빅, 철컹! ATM에서 동전이 튀어나옴]',
    'caption.atmBonk': '[텅! ATM을 들이받는 소리]',
    'caption.piggyOink': '[꿀꿀! 돼지저금통]',
    'caption.piggyCrack': '[쩍! 돼지저금통에 금이 감]',
    'caption.piggyJackpot': '[와장창! 돼지저금통 잭팟]',
    'caption.rootRip': '[뿌드득! 돈나무 뿌리가 뽑히는 소리]',
    'caption.billFlutter': '[팔랑팔랑, 지폐가 날림]',
    'caption.crateBreak': '[와직! 나무 상자가 부서짐]',
    'caption.vendingHit': '[덜컹! 자판기가 콜록]',
    'caption.vendingBreak': '[와장창! 자판기가 부서짐]',
    // [F8] tension audio
    'caption.tensionHeartbeat': '[두근두근, 승부처 심장 소리]',
    'caption.stingBlocked': '[빰! 승부처가 막힘]',
    'caption.stingLead': '[빠라밤! 선두가 바뀜]',
    'caption.stingEqual': '[띵동, 동점]',
    'caption.streakFill': '[두구두구, 연속 득점 중]',
    'caption.streakScratch': '[끼긱~ 연속 득점이 끊김]',
    'caption.runClimb': '[띠링! 연속 득점]',
    'caption.finalTick': '[째깍]',
    'caption.vanRev': '[부릉부릉, 도주 차량 시동]',
    'caption.vanDriveOff': '[부아앙~ 도주 차량 출발]',
    'caption.tauntPunish': '[뾰요옹~ 도발하다 혼남]',
    'caption.dodgeWhoosh': '[휙! 피했다]',
    'caption.clashAccent': '[빰! 정면충돌]',
    'caption.barkBlip': '[라이벌이 소리침]',
    'caption.stingGoldHammer': '[반짝! 황금 뿅망치 도착]',
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
    'caption.tauntWiggle': '[toot-toot booty wiggle]',
    'caption.tauntBleh': '[raspberry blat]',
    'caption.tauntCash': '[cash fan flutter]',
    'caption.tauntSquat': '[boing boing]',
    'caption.tauntZoom': '[zoom]',
    'caption.tauntFlex': '[muscle sparkle]',
    'caption.tauntShrug': '[smug shrug]',
    // [C9] Content 2.0
    'caption.hammerWindup': '[Squeak! Hammer winding up]',
    'caption.hammerSwing': '[Whoosh! Hammer swing]',
    'caption.hammerBonk': '[Boink! Squeaky hammer hit]',
    'caption.hammerClash': '[Clang! Hammers clash]',
    'caption.itemPickup': '[Squeak-squeak, item grabbed]',
    'caption.itemDrop': '[Clatter, item dropped]',
    'caption.itemPoof': '[Poof, item gone]',
    'caption.supplyIncoming': '[Ding-dong, supply drop coming down]',
    'caption.supplyLand': '[Thud! Supply crate lands]',
    'caption.goldHammerSting': '[Drumroll... Golden hammer incoming]',
    'caption.coinPickup': '[Clink, coin scooped]',
    'caption.billPickup': '[Flap, bills scooped]',
    'caption.coinPop': '[Coins popping out]',
    'caption.coinSpill': '[Spill! Coins everywhere]',
    'caption.depositStart': '[Bag opening]',
    'caption.coinDeposit': '[Coins pouring in, deposited]',
    'caption.atmSpurt': '[Beep-boop, cha-ching! ATM spits coins]',
    'caption.atmBonk': '[Bong! ATM bonked]',
    'caption.piggyOink': '[Oink! Piggy bank]',
    'caption.piggyCrack': '[Crack! Piggy bank cracking]',
    'caption.piggyJackpot': '[Smash! Piggy bank jackpot]',
    'caption.rootRip': '[Rrrip! Money tree uprooted]',
    'caption.billFlutter': '[Bills fluttering down]',
    'caption.crateBreak': '[Crunch! Crate smashed]',
    'caption.vendingHit': '[Thunk! Vending machine coughs]',
    'caption.vendingBreak': '[Crash! Vending machine busted]',
    // [F8] tension audio
    'caption.tensionHeartbeat': '[Thump-thump, match point heartbeat]',
    'caption.stingBlocked': '[Stab! Match point stopped]',
    'caption.stingLead': '[Fanfare run, the lead changes]',
    'caption.stingEqual': '[Ding-dong, scores level]',
    'caption.streakFill': '[Drum fill, scoring run]',
    'caption.streakScratch': '[Record scratch, run broken]',
    'caption.runClimb': '[Ting! The run goes on]',
    'caption.finalTick': '[Tick]',
    'caption.vanRev': '[Vroom, getaway van revving]',
    'caption.vanDriveOff': '[Vroom! Getaway van pulls away]',
    'caption.tauntPunish': '[Boing! Taunter bonked]',
    'caption.dodgeWhoosh': '[Whoosh! Dodged]',
    'caption.clashAccent': '[Ta! Head-on clash]',
    'caption.barkBlip': '[Rival hoots]',
    'caption.stingGoldHammer': '[Sparkle! Golden hammer has landed]',
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
