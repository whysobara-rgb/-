/**
 * Public entry point of the deterministic simulation core.
 * Other modules (AI, render, UI, game flow) import from here only.
 */
export * from './types';
export * from './config';
export { Simulation, type SimDebugApi } from './sim';
export * from './math';
export { GRAB_CONE } from './actions';
export { POLICE_ID_BASE, POLICE_RESTUN_IMMUNE_TICKS, officerStepOutSpot, policeEntriesFor } from './police';
export { matchPointInfo, swingInfo, type MatchPointInfo, type MatchPointOptions, type SwingInfo } from './queries';
// Content 2.0 contracts (C0; docs/ARCHITECTURE.md "Content 2.0 contracts")
export { heldValue, isCarryable, navClassOf } from './queries';
export { computeRemainingValue, isAllRecovered } from './rules';
export type { CoinSpawnRequest, DepositClaim } from './coins';
export type { ContentSystem } from './systemBase';
export { planMatchEvents, type EventPlanOptions } from './events';
