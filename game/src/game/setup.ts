/**
 * Match configuration -> sim MatchSetup + bot specs (pure; unit-tested).
 *
 * Roster rules (integration spec):
 *  - the human is always slot 0, team 0 (star team);
 *  - 1:1 = one bot opponent (team 1) with the chosen rival's personality and look;
 *  - 2:2 = a bot teammate (team 0, team-default hat) + two bot opponents (the rival and a
 *    rival-team bot with the same personality, team-default hat);
 *  - tutorial = the human alone, no time limit, no early decision.
 * Seeds are deterministic: the match seed fixes every bot's seed.
 */
import { RIVALS, type Adaptation, type Difficulty, type DifficultyParams, type RivalId } from '../ai';
import type { CupId } from '../platform/progress';
import { getLayout } from '../sim/layouts';
import type { HatId, LayoutId, MatchSetup, RosterEntry, RuleConfig } from '../sim/types';

export type MatchKind = 'quick' | 'tournament' | 'tutorial';
export type MatchMode = '1v1' | '2v2';

export interface MatchConfig {
  kind: MatchKind;
  layoutId: LayoutId;
  mode: MatchMode;
  /** Opponent personality (ignored by the tutorial). */
  rival: RivalId;
  difficulty: Difficulty;
  /** Tournament only (quick match never adapts). */
  adaptation: Adaptation | null;
  seed: number;
  /** Hat the human wears (the equipped wardrobe hat). */
  humanHat: HatId;
  /** Display name for the human (Steam persona) — defaults to the 'name.you' key. */
  humanName?: string | null;
  /** Test hook: overrides the match length (seconds). */
  matchSeconds?: number | null;
  /**
   * Police event (owner addition beyond doc v0.5, RuleConfig.police): on for real matches
   * unless explicitly false (?police=0); never in the tutorial.
   */
  police?: boolean | null;
  /**
   * (fun round contract, owner WP7; add-only) Tournament cup of this match (null / absent =
   * not a cup match). Set by `tournamentConfig`; read by results (WP6, MatchOutcomeSummary.cup).
   */
  cup?: CupId | null;
  /**
   * (fun round contract, owner WP7; add-only) Cup-step override merged over the rival bots'
   * `DIFFICULTY_PARAMS[difficulty]` (BotOptions.params). Never applied to the 2:2 teammate.
   */
  botParams?: Partial<DifficultyParams> | null;
}

export interface BotSpec {
  slot: number;
  personality: RivalId;
  difficulty: Difficulty;
  adaptation: Adaptation | null;
  seed: number;
  /** BotOptions.params (from MatchConfig.botParams; rival bots only). */
  params?: Partial<DifficultyParams>;
}

export interface BuiltMatch {
  setup: MatchSetup;
  bots: BotSpec[];
  humanSlot: 0;
}

export function botSeed(matchSeed: number, slot: number): number {
  return (Math.imul(matchSeed >>> 0, 7919) + slot * 104729) >>> 0;
}

/** Mix two numbers into a 32-bit seed (FNV-style). */
export function mixSeed(a: number, b: number): number {
  let h = 0x811c9dc5 ^ (a >>> 0);
  h = Math.imul(h, 0x01000193) >>> 0;
  h ^= b >>> 0;
  h = Math.imul(h, 0x01000193) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

export function buildMatch(cfg: MatchConfig): BuiltMatch {
  const layout = getLayout(cfg.layoutId);
  const roster: RosterEntry[] = [];
  const bots: BotSpec[] = [];
  const human: RosterEntry = { team: 0, isBot: false, name: cfg.humanName || 'name.you', look: { hat: cfg.humanHat, furTint: 0.5 } };
  roster.push(human);
  let rules: Partial<RuleConfig> | undefined;

  if (cfg.kind === 'tutorial' || cfg.layoutId === 'tutorial') {
    rules = { timeLimit: false, earlyDecision: false };
  } else {
    const rival = RIVALS[cfg.rival];
    const adaptation = cfg.kind === 'tournament' ? cfg.adaptation : null;
    const params = cfg.botParams ? { params: { ...cfg.botParams } } : {};
    if (cfg.mode === '2v2') {
      roster.push({ team: 0, isBot: true, name: 'name.ally', look: { hat: 'teamCapA', furTint: 0.2 } });
      // The teammate helps with the big hauls (doc §7) and is never weaker than 보통.
      bots.push({ slot: 1, personality: 'tongkeun', difficulty: cfg.difficulty === 'challenge' ? 'challenge' : 'normal', adaptation: null, seed: botSeed(cfg.seed, 1) });
      roster.push({ team: 1, isBot: true, name: rival.nameKey, look: { ...rival.look } });
      bots.push({ slot: 2, personality: cfg.rival, difficulty: cfg.difficulty, adaptation, seed: botSeed(cfg.seed, 2), ...params });
      roster.push({ team: 1, isBot: true, name: 'name.rivalBot', look: { hat: 'teamCapB', furTint: 0.75 } });
      bots.push({ slot: 3, personality: cfg.rival, difficulty: cfg.difficulty, adaptation, seed: botSeed(cfg.seed, 3), ...params });
    } else {
      roster.push({ team: 1, isBot: true, name: rival.nameKey, look: { ...rival.look } });
      bots.push({ slot: 1, personality: cfg.rival, difficulty: cfg.difficulty, adaptation, seed: botSeed(cfg.seed, 1), ...params });
    }
    rules = { police: cfg.police !== false };
    if (cfg.matchSeconds && cfg.matchSeconds > 0) rules.matchTicks = Math.round(cfg.matchSeconds * 60);
  }
  return { setup: { layout, roster, seed: cfg.seed >>> 0, rules }, bots, humanSlot: 0 };
}
