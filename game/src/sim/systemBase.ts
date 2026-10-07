/**
 * Content 2.0 system hook interface + no-op base (C0). Kept apart from systems.ts so the system
 * modules (coins, props, items, gimmicks, events) can extend the base without an import cycle.
 * Hook placement inside Simulation.step: see systems.ts.
 */
import type { SimContext } from './context';
import type { Body } from './physics';

/** Hooks every Content 2.0 system implements (no-op by default; see ContentSystemBase). */
export interface ContentSystem {
  readonly name: 'coins' | 'props' | 'items' | 'gimmicks' | 'events';
  /** Step 2, after prepareBodies, before police brains and physics. */
  prePhysics(): void;
  /** Step 2, at the start of every physics substep (before kinematic welds follow parents). */
  beforeSubstep(substep: number, substeps: number): void;
  /** Step 2, after every physics substep (after character dash hits). */
  afterSubstep(substep: number): void;
  /**
   * Step 2, inside a substep: an impact faster than the threshold. Character contacts come from
   * PhysicsHooks.onImpact (before the classic 'bump' cooldown filter); contacts without a
   * character (loot vs wall / loot) from PhysicsHooks.onBodyImpact once C3 reports them.
   */
  onImpact(a: Body, b: Body | null, approach: number): void;
  /** Step 2, after fences, before updateUnanchor (body poses are current; state poses are not). */
  afterPhysics(): void;
  /** Step 3, after updateLoading. */
  afterLoading(): void;
  /** Step 7 while the match goes on. */
  postTick(): void;
  /** Step 7 on the tick the match ended (once). */
  freeze(): void;
}

/** No-op base class: systems override only the hooks they need. */
export abstract class ContentSystemBase implements ContentSystem {
  abstract readonly name: ContentSystem['name'];
  constructor(protected readonly ctx: SimContext) {}
  prePhysics(): void {}
  beforeSubstep(_substep: number, _substeps: number): void {}
  afterSubstep(_substep: number): void {}
  onImpact(_a: Body, _b: Body | null, _approach: number): void {}
  afterPhysics(): void {}
  afterLoading(): void {}
  postTick(): void {}
  freeze(): void {}
}
