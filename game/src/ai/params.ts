/**
 * Rival personalities and difficulty parameters (doc §11).
 *
 * Personalities share one behavior system and differ only in priority weights (doc §11
 * "세 라이벌은 같은 행동 체계를 공유하고 선택 우선순위가 다르다"). Difficulties differ only in
 * decision interval, reaction delay, choice quality and counter-play depth — never in speed,
 * force or cooldown (doc §11 "힘·최고 속도·돌진 회복 시간은 사람과 같다"), and never change
 * during a series (no hidden rubber-banding).
 */
import type { CharacterLook, LayoutId } from '../sim/types';
import type { Difficulty, RivalId } from './types';

export interface RivalMeta {
  id: RivalId;
  /** i18n key of the display name ('rival.hodadak.name'). */
  nameKey: string;
  titleKey: string;
  personalityKey: string;
  weaknessKey: string;
  introKey: string;
  /** Signature look (doc §11: 같은 너구리 몸체에 장식·표정·짧은 준비 동작). */
  look: CharacterLook;
  /** Hat rewarded for beating this rival (doc §12). */
  rewardHat: CharacterLook['hat'];
  /** Rival-tournament layout (doc §12: 한 라이벌과의 시리즈 안에서는 배치를 유지). */
  preferredLayout: Exclude<LayoutId, 'tutorial'>;
}

export const RIVALS: Readonly<Record<RivalId, RivalMeta>> = {
  hodadak: {
    id: 'hodadak',
    nameKey: 'rival.hodadak.name',
    titleKey: 'rival.hodadak.title',
    personalityKey: 'rival.hodadak.personality',
    weaknessKey: 'rival.hodadak.weakness',
    introKey: 'rival.hodadak.intro',
    look: { hat: 'hodadakBand', rival: 'hodadak', furTint: 0.25 },
    rewardHat: 'hodadakBand',
    preferredLayout: 'plaza',
  },
  tongkeun: {
    id: 'tongkeun',
    nameKey: 'rival.tongkeun.name',
    titleKey: 'rival.tongkeun.title',
    personalityKey: 'rival.tongkeun.personality',
    weaknessKey: 'rival.tongkeun.weakness',
    introKey: 'rival.tongkeun.intro',
    look: { hat: 'tongkeunHat', rival: 'tongkeun', furTint: 0.6 },
    rewardHat: 'tongkeunHat',
    preferredLayout: 'shortcut',
  },
  nunchi: {
    id: 'nunchi',
    nameKey: 'rival.nunchi.name',
    titleKey: 'rival.nunchi.title',
    personalityKey: 'rival.nunchi.personality',
    weaknessKey: 'rival.nunchi.weakness',
    introKey: 'rival.nunchi.intro',
    look: { hat: 'nunchiMask', rival: 'nunchi', furTint: 0.85 },
    rewardHat: 'nunchiMask',
    preferredLayout: 'counter',
  },
};

export const RIVAL_IDS: readonly RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];
export const DIFFICULTIES: readonly Difficulty[] = ['novice', 'normal', 'challenge'];

/** Priority weights (multipliers on the shared utility estimates). */
export interface PersonalityWeights {
  smallSafe: number;
  largeSafe: number;
  /** Whole-bank haul; multiplied further by how full the bank is. */
  bank: number;
  /** Extra weight per 100 points of contents in a bank (통큰이 prefers banks with safes). */
  bankContents: number;
  /** Taking a safe out of a bank (esp. one an opponent is hauling). */
  strip: number;
  /** Knocking a carrier and taking its loot. */
  intercept: number;
  /** Bonus when an opponent is committed to a big haul (bank / large safe) — 눈치왕's trigger. */
  opportunism: number;
  /** Favourite-route reuse strength (A* discount on its own trail), 0..0.4. */
  routeReuse: number;
  /** How much value per second it needs before leaving a goal (commitment). */
  commitment: number;
  /** Dash eagerness against carriers / intruders (0..1) on top of difficulty. */
  aggression: number;
  /** Willingness to join a teammate's bank haul. */
  assist: number;
  /** Uses the dash to move faster on long straight walks when nobody is near (0..1). */
  travelDash: number;
  /**
   * "욕심내서 하나 더" (doc §10): loads a nearby small safe onto the bank it is about to haul
   * (worth more, slower, more exposed through the open door). 0 = never.
   */
  greed: number;
}

export const PERSONALITY: Readonly<Record<RivalId, PersonalityWeights>> = {
  // 호다닥: frequent quick small-safe runs along favourite routes.
  hodadak: {
    smallSafe: 1.5,
    largeSafe: 1.0,
    bank: 0.9,
    bankContents: 0.0,
    strip: 1.15,
    intercept: 0.7,
    opportunism: 0.2,
    routeReuse: 0.35,
    commitment: 0.2,
    aggression: 0.6,
    assist: 0.7,
    travelDash: 1,
    greed: 0,
  },
  // 통큰이: goes for banks with contents and hauls them.
  tongkeun: {
    smallSafe: 0.7,
    largeSafe: 1.0,
    bank: 1.25,
    bankContents: 0.12,
    strip: 0.75,
    intercept: 0.5,
    opportunism: 0.2,
    routeReuse: 0.0,
    commitment: 0.35,
    aggression: 0.5,
    assist: 1.2,
    travelDash: 0.5,
    greed: 1,
  },
  // 눈치왕: waits for the opponent to commit to a big haul, then intercepts / steals.
  nunchi: {
    smallSafe: 0.75,
    largeSafe: 0.92,
    bank: 0.6,
    bankContents: 0.0,
    strip: 1.5,
    intercept: 1.3,
    opportunism: 1.0,
    routeReuse: 0.0,
    commitment: 0.25,
    aggression: 1.0,
    assist: 0.8,
    travelDash: 0.3,
    greed: 0,
  },
};

export interface DifficultyParams {
  /** Ticks between regular re-evaluations. */
  decisionInterval: number;
  /** Ticks of delay on observed opponent information (reaction). */
  reactionDelay: number;
  /** Probability of taking the best option; otherwise a decent (>= decentRatio) alternative. */
  bestChoiceProb: number;
  decentRatio: number;
  /** Probability per opportunity of reacting to a nearby threat (intercept / defend / escort). */
  threatResponse: number;
  /** Probability of taking a dash opportunity when it is valid. */
  dashUse: number;
  /** Lead prediction quality 0..1 (1 = full lead, plus angular noise when lower). */
  leadQuality: number;
  /**
   * Counter-play depth 0..2 (continuous): 0 = plain collecting, 0.5 = notices obvious hauls,
   * 1 = values denial / races for the other bank, 2 = full denial math + guard reactions.
   */
  counterDepth: number;
  /** Telegraph pause before committing to a new target (ticks). */
  telegraphTicks: number;
  /** Uses the carry boost on straight segments. */
  carryBoost: number;
  /**
   * Relative noise on its own utility estimates (choice quality): a novice misjudges distances
   * and values a bit, so it sometimes commits to a decent-but-not-best target.
   */
  estimateNoise: number;
  /**
   * How much the bot plays around the (public) police event, 0..1: evading officers with a
   * carry, body-blocking / dash-stunning officers chasing a teammate, timing bank hauls around
   * the waves. Same physics for everyone — only how often and how well it reads the officers.
   */
  policeAwareness: number;
}

export const DIFFICULTY_PARAMS: Readonly<Record<Difficulty, DifficultyParams>> = {
  novice: {
    decisionInterval: 72,
    reactionDelay: 36,
    bestChoiceProb: 0.25,
    decentRatio: 0.45,
    threatResponse: 0.35,
    dashUse: 0.3,
    leadQuality: 0.35,
    counterDepth: 0.3,
    telegraphTicks: 30,
    carryBoost: 0.05,
    estimateNoise: 0.35,
    policeAwareness: 0.3,
  },
  normal: {
    decisionInterval: 36,
    reactionDelay: 15,
    bestChoiceProb: 0.85,
    decentRatio: 0.78,
    threatResponse: 0.75,
    dashUse: 0.7,
    leadQuality: 0.75,
    counterDepth: 1,
    telegraphTicks: 18,
    carryBoost: 0.75,
    estimateNoise: 0.07,
    policeAwareness: 0.75,
  },
  challenge: {
    decisionInterval: 18,
    reactionDelay: 5,
    bestChoiceProb: 1,
    decentRatio: 0.92,
    threatResponse: 1,
    dashUse: 0.95,
    leadQuality: 1,
    counterDepth: 1.5,
    telegraphTicks: 7,
    carryBoost: 1,
    estimateNoise: 0,
    policeAwareness: 1,
  },
};

/**
 * Scripted stand-in for a human player (tools / balance only, never shipped as a rival): reacts
 * like an attentive person (~0.3 s), sometimes picks a merely decent option, does not telegraph,
 * reads the police half the time. Its priorities are a per-match random blend of the three
 * rivals' (humanProxyWeights), so it does not mirror any one bot.
 */
export const HUMAN_PROXY_PARAMS: DifficultyParams = {
  decisionInterval: 40,
  reactionDelay: 18,
  bestChoiceProb: 0.72,
  decentRatio: 0.72,
  threatResponse: 0.65,
  dashUse: 0.6,
  leadQuality: 0.6,
  counterDepth: 0.85,
  telegraphTicks: 0,
  carryBoost: 0.55,
  estimateNoise: 0.18,
  policeAwareness: 0.55,
};

/**
 * Per-match human-proxy priorities. A person plays with a plan of their own rather than an
 * average of the rivals: one archetype (bank hauler / collector / opportunist) leads (~70 %),
 * the other two flavour it, and every weight is jittered ±20 %.
 */
export function humanProxyWeights(rng: () => number): PersonalityWeights {
  const ids: RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];
  const lead = Math.min(2, Math.floor(rng() * 3));
  const raw = ids.map((_, i) => (i === lead ? 0.7 : 0.15) * (0.75 + 0.5 * rng()));
  const sum = raw.reduce((a, b) => a + b, 0);
  const out = {} as Record<keyof PersonalityWeights, number>;
  for (const k of Object.keys(PERSONALITY.hodadak) as (keyof PersonalityWeights)[]) {
    let v = 0;
    ids.forEach((id, i) => (v += (PERSONALITY[id][k] * raw[i]!) / sum));
    out[k] = v * (0.8 + 0.4 * rng());
  }
  out.routeReuse = Math.min(0.4, out.routeReuse);
  return out as PersonalityWeights;
}

/**
 * Shared balance knobs of the bot brain (tools/balance-report.ts --tune key=value overrides them
 * for experiments; the values here are the measured defaults, see the balance report).
 */
export const BOT_TUNING = {
  /**
   * Extra value for stripping a safe out of a bank nobody hauls yet (denial of a future haul).
   * Measured: 1 -> 0.5 keeps more banks whole (bank contents 9 % -> 11-15 % of points).
   */
  stripAnchoredBonus: 0.5,
  /**
   * Police drag on a planned solo bank haul, per second of expected police presence (x
   * awareness). Measured haul speed with officers on duty: ~75 % of free, ~70 % while chased;
   * 1.0 made bots haul banks last (the field swept clean -> allRecovered ties), 0.3 keeps banks
   * in the mid-game.
   */
  bankPoliceDrag: 0.3,
  /** Utility cut for starting a bank while a fresh wave is on the field (x awareness). */
  waveDefer: 0.9,
  /** Whole-bank preference: multiplier on hauling a bank that still holds safes. */
  wholeBank: 1.15,
  /** Per-match style spread of a rival's priorities (± fraction; the rival stays recognisable). */
  styleSpread: 0.22,
  /** Per-item taste spread (± fraction) so two bots of one personality do not mirror each other. */
  tasteSpread: 0.07,
  /**
   * Last-bank timing (it starts the 30 s getaway): lock a lead in, avoid triggering it while
   * behind. Measured: no gain in draws or length (it pushes the last bank to the very end) -> off.
   */
  lastBankTiming: 0,
  /** Multiplier on intercepting a carrier (contest instead of parallel collecting). */
  intercept: 1,
  /**
   * Utility kept for a safe / a bank an empty-handed opponent is clearly closer to (contest
   * avoidance). Measured: yielding (0.5 / 0.55) made mirrored bots split the field evenly
   * (parallel collection -> ties); 1 = go for it anyway (tug patience still ends deadlocks).
   */
  yieldSafe: 1,
  yieldBank: 1,
  /**
   * Bank race: once they haul a bank, our weight on the other one (x counter-play depth).
   * Measured: 0.6 made both banks go at once (final countdown before 120 s in ~55 % of 1v1s);
   * 0 leaves the second bank for the mid/late game.
   */
  bankRace: 0,
  /**
   * A solo bank hauler tackled off (or kept off by an officer standing by) one bank n >= 2 times in
   * 20 s while officers are on duty divides that haul's value by
   * 1 + houndedDrop * (n - 1) * (0.5 + 0.5 * awareness) (it scores elsewhere until the wave leaves).
   * Measured: without it a hounded tongkeun crawled ~45 s under two officers (~20 tackles) and
   * scored 0 in 8 % of mirror games on counter; 0.5 (x awareness only) still let novice / normal
   * haulers take 10-20 tackles in a row; 1.0 with the awareness floor ends those chains.
   */
  houndedDrop: 1.0,
  /**
   * Close score late (|diff| <= 300 with < 60 s or <= 900 points left): extra weight (x counter-play
   * depth) on steals and strips out of the other team's haul — taking loot away breaks the
   * mirrored "each collects its half" endings that finish 1600-1600.
   */
  tieDeny: 1.0,
  /**
   * Endgame arithmetic (doc §8: the leader wins only with more than half of what is left beyond
   * its lead; "lead == remaining" still allows a tie): late in the match (or with <= 1000 points
   * left) a load whose recovery decides the match for us, or an opponent carry / haul whose
   * recovery would let them tie or win, gets x(1 + clinch). Before it, a leader often left the
   * last small safe to the trailer — most draws were such 1600-1600 "all recovered" endings.
   */
  clinch: 1.0,
};
