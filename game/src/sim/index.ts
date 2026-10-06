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
