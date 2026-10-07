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
import type { HatId, LayoutId, MatchSetup, RosterEntry, RuleConfig, TeamId } from '../sim/types';
import type { LocalMatchSetup, LocalSeat } from './local';

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
  /**
   * Local multiplayer ("같이 하기"): the human seats (device, P-number, team). Null / absent =
   * the classic single-player roster above. Quick-match kind only (never tutorial / tournament).
   */
  local?: LocalMatchSetup | null;
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
  /** P1's slot (the save owner; slot 0 in single-player). */
  humanSlot: number;
  /** Every human slot with its local seat (single-player: one seat without a device). */
  humans: Array<{ slot: number; seat: LocalSeat | null }>;
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
  if (cfg.local && cfg.local.seats.length && cfg.kind === 'quick' && cfg.layoutId !== 'tutorial') return buildLocalMatch(cfg, cfg.local);
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
  return { setup: { layout, roster, seed: cfg.seed >>> 0, rules }, bots, humanSlot: 0, humans: [{ slot: 0, seat: null }] };
}

/** Hats for P2..P4 (P1 wears the equipped wardrobe hat): readable silhouettes, never a rival's. */
const LOCAL_HATS: readonly HatId[] = ['teamCapA', 'teamCapB', 'none', 'teamCapA'];

/**
 * Local multiplayer roster: 1:1 = slots 0 (team 0) / 1 (team 1); 2:2 = slots 0-1 (team 0) /
 * 2-3 (team 1). Humans take their team's slots in P order; the rest are bots. A bot on a team
 * with a human is a helper (the 2:2 teammate rules: 통큰이, never weaker than 보통); a bot on a
 * team without humans is the rival team at the chosen difficulty.
 */
export function buildLocalMatch(cfg: MatchConfig, local: LocalMatchSetup): BuiltMatch {
  const layout = getLayout(cfg.layoutId);
  const seats = [...local.seats].sort((a, b) => a.index - b.index);
  const perTeam = [0, 1].map((t) => seats.filter((s) => s.team === t).length);
  const mode: MatchMode = cfg.mode === '1v1' && perTeam[0]! <= 1 && perTeam[1]! <= 1 ? '1v1' : '2v2';
  const teamOfSlot: TeamId[] = mode === '1v1' ? [0, 1] : [0, 0, 1, 1];
  const rival = RIVALS[cfg.rival];
  const adaptation = null;
  const params = cfg.botParams ? { params: { ...cfg.botParams } } : {};
  const roster: RosterEntry[] = [];
  const bots: BotSpec[] = [];
  const humans: BuiltMatch['humans'] = [];
  const placed = new Set<LocalSeat>();
  let rivalNamed = false;
  teamOfSlot.forEach((team, slot) => {
    const seat = seats.find((s) => s.team === team && !placed.has(s));
    if (seat) {
      placed.add(seat);
      const hat: HatId = seat.index === 0 ? cfg.humanHat : LOCAL_HATS[seat.index] ?? 'none';
      roster.push({ team, isBot: false, name: `P${seat.index + 1}`, look: { hat, furTint: [0.5, 0.3, 0.7, 0.15][seat.index] ?? 0.5 } });
      humans.push({ slot, seat });
      return;
    }
    const humanTeam = perTeam[team]! > 0;
    if (humanTeam) {
      roster.push({ team, isBot: true, name: 'name.ally', look: { hat: team === 0 ? 'teamCapA' : 'teamCapB', furTint: 0.2 } });
      bots.push({ slot, personality: 'tongkeun', difficulty: cfg.difficulty === 'challenge' ? 'challenge' : 'normal', adaptation: null, seed: botSeed(cfg.seed, slot) });
    } else if (!rivalNamed) {
      rivalNamed = true;
      roster.push({ team, isBot: true, name: rival.nameKey, look: { ...rival.look } });
      bots.push({ slot, personality: cfg.rival, difficulty: cfg.difficulty, adaptation, seed: botSeed(cfg.seed, slot), ...params });
    } else {
      roster.push({ team, isBot: true, name: 'name.rivalBot', look: { hat: team === 0 ? 'teamCapA' : 'teamCapB', furTint: 0.75 } });
      bots.push({ slot, personality: cfg.rival, difficulty: cfg.difficulty, adaptation, seed: botSeed(cfg.seed, slot), ...params });
    }
  });
  const rules: Partial<RuleConfig> = { police: cfg.police !== false };
  if (cfg.matchSeconds && cfg.matchSeconds > 0) rules.matchTicks = Math.round(cfg.matchSeconds * 60);
  const p1 = humans.find((h) => h.seat?.index === 0) ?? humans[0]!;
  return { setup: { layout, roster, seed: cfg.seed >>> 0, rules }, bots, humanSlot: p1.slot, humans };
}
