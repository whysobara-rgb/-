/**
 * Public entry point of the bot AI (docs/ARCHITECTURE.md "Bot API", doc §11).
 *
 *   const bot = createBot(sim, { slot: 1, personality: 'hodadak', difficulty: 'normal', seed: 7 });
 *   commands[1] = bot.update(sim);   // once per tick, before sim.step
 *
 * A bot on the human's team behaves as a teammate automatically (doc §11 동료 봇) and answers
 * the team's pings. Bots read only public loot state, their own team, and opponents they (or
 * a bot teammate) can see — see perception.ts.
 */
import type { Simulation } from '../sim/sim';
import { Bot } from './bot';
import type { BotController, BotOptions } from './types';

export type { RivalId, Difficulty, Adaptation, AdaptationKind, BotOptions, BotController, BotIntent, GoalKind } from './types';
export { RIVALS, RIVAL_IDS, DIFFICULTIES, DIFFICULTY_PARAMS, PERSONALITY } from './params';
export type { RivalMeta, DifficultyParams, PersonalityWeights } from './params';
export { RivalObserver, chooseAdaptation } from './observer';
export type { ObservationSummary } from './observer';
export { Bot } from './bot';
export type { BotStats } from './bot';

export function createBot(sim: Simulation, opts: BotOptions): BotController {
  const ch = sim.state.characters[opts.slot];
  if (!ch) throw new Error(`createBot: no character in slot ${opts.slot}`);
  return new Bot(sim, opts);
}
