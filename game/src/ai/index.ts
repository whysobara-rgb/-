/**
 * Public entry point of the bot AI (docs/ARCHITECTURE.md "Bot API", doc §11).
 *
 *   const bot = createBot(sim, { slot: 1, personality: 'hodadak', difficulty: 'normal', seed: 7 });
 *   commands[1] = bot.update(sim);   // once per tick, before sim.step
 *
 * - A bot on the human's team behaves as a teammate automatically (doc §11 동료 봇): joins the
 *   human's bank haul (same face, same pull direction), guards the door / escorts against seen
 *   threats, picks up dropped loot, and answers the team's pings (같이 잡자 / 이쪽으로).
 * - Bots read only public loot state, their own team, and opponents they (or a bot teammate)
 *   can see — see perception.ts. Same Command path and physics as humans; never sim.debug.
 * - `bot.intent()` (BotIntent) tells the renderer what the bot is about to do; while
 *   `telegraph` is true the bot pauses and turns toward `targetPos` (짧은 준비 동작).
 * - Rival series: feed every tick to a `RivalObserver(sim, humanTeam)`; after the game call
 *   `chooseAdaptation(observer.summary(), layout, rival)` and pass the result as
 *   `BotOptions.adaptation` for the next game (null = no special plan, line key 'adapt.none').
 * - Scripted tasks (tutorial / tests): `(bot as Bot).assignTask(sim, { kind: 'collect' | 'haul',
 *   targetId } | { kind: 'goto', pos } | null)`.
 * - Creating bots warms the shared navigation caches (~10-40 ms once per match) — do it while
 *   the match is loading.
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
