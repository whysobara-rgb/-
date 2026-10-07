/**
 * Content 2.0 per-tick system hook skeleton (C0; docs/ARCHITECTURE.md "Content 2.0 contracts").
 *
 * Every Content 2.0 system plugs into Simulation.step through the hooks below, called in ONE
 * frozen order: coins (C1) -> props (C3) -> items (C2) -> gimmicks (C4) -> events (C5) -> police.
 * The one documented exception is the post-tick phase (content-plan §4.4 step 7):
 * police -> events -> items -> gimmicks -> coins -> props.
 *
 * Where each hook runs inside Simulation.step (content-plan §4.4):
 *   1. commands     processCommands; a rising dash edge goes to `items.onDash(slot)` instead of
 *                   startDash when the character holds an item and no loot (actions.ts).
 *   2. physics      prepareBodies -> `prePhysics` (systems, then police) -> physics substeps:
 *                     `beforeSubstep(sub, n)` (kinematic poses = f(tick, sub); before welds sync)
 *                     `afterSubstep(sub)`     (after checkDashHits, before police.afterSubstep)
 *                   `onImpact` from the physics impact hook (before the 'bump' cooldown filter)
 *                   -> handleGripBreaks -> fences -> `afterPhysics` -> updateUnanchor -> stabilize
 *                   -> syncState -> police.afterPhysics.
 *                   NOTE: in `afterPhysics` the public state poses (ch.pos, l.pos) are still last
 *                   tick's; read body poses from ctx.chars[i].body / ctx.loot[i].body.
 *   3. loading      updateLoading -> `afterLoading` (coin pickup contest, C1)
 *   4. settlement   updateRecovery + `coins.collectDeposits()` -> settle loot, then deposits, in
 *                   one batch (C1) -> removeRecovered -> updateRemaining
 *   5. countdown    updateTimer (unchanged)
 *   6. end check    checkEnd (extended remainingValue / allRecovered, rules.ts)
 *   7. post-tick    police.postTick, then `postTick` (order above); once `over` is set every
 *                   system gets `freeze()` exactly like police.
 *
 * Knockdowns: every source calls `knockDown` (actions.ts), which calls `onKnockdown` below (bag
 * spill, then item drop). Ground fields: `prePhysics` resets every body's fieldVx / fieldVy /
 * dragScale / driveScale before the systems' own prePhysics add / multiply theirs.
 *
 * Rules for system authors: a hook must be deterministic (no Math.random, no wall clock, the only
 * RNG is ctx.rng for the allowed draws); collect hits within a substep then apply them in id
 * order (never slot order); never change confirmed scores outside step 4.
 */
import type { SimContext } from './context';
import type { Body } from './physics';
import type { ContentSystem } from './systemBase';
import type { EntityId, KnockdownCause } from './types';
import { CoinSystem } from './coins';
import { PropSystem } from './props';
import { ItemSystem } from './items';
import { GimmickSystem } from './gimmicks';
import { EventSystem } from './events';

/** The v2 systems of one match, called in the frozen order. Built only when rules.content is 'v2'. */
export class ContentSystems {
  readonly coins: CoinSystem;
  readonly props: PropSystem;
  readonly items: ItemSystem;
  readonly gimmicks: GimmickSystem;
  readonly events: EventSystem;
  /** coins -> props -> items -> gimmicks -> events (frozen). */
  readonly ordered: readonly ContentSystem[];
  /** Post-tick order (frozen): events -> items -> gimmicks -> coins -> props (police runs first). */
  readonly postOrder: readonly ContentSystem[];

  constructor(private readonly ctx: SimContext) {
    this.coins = new CoinSystem(ctx);
    this.props = new PropSystem(ctx);
    this.items = new ItemSystem(ctx);
    this.gimmicks = new GimmickSystem(ctx);
    this.events = new EventSystem(ctx);
    this.ordered = [this.coins, this.props, this.items, this.gimmicks, this.events];
    this.postOrder = [this.events, this.items, this.gimmicks, this.coins, this.props];
  }

  prePhysics(): void {
    // per-body ground fields back to neutral; systems then ADD field velocities and MULTIPLY scales
    for (const b of this.ctx.physics.bodies) {
      b.fieldVx = 0;
      b.fieldVy = 0;
      b.dragScale = 1;
      b.driveScale = 1;
    }
    for (const s of this.ordered) s.prePhysics();
  }
  beforeSubstep(substep: number, substeps: number): void {
    for (const s of this.ordered) s.beforeSubstep(substep, substeps);
  }
  afterSubstep(substep: number): void {
    for (const s of this.ordered) s.afterSubstep(substep);
  }
  onImpact(a: Body, b: Body | null, approach: number): void {
    for (const s of this.ordered) s.onImpact(a, b, approach);
  }
  afterPhysics(): void {
    for (const s of this.ordered) s.afterPhysics();
  }
  afterLoading(): void {
    for (const s of this.ordered) s.afterLoading();
  }
  postTick(): void {
    for (const s of this.postOrder) s.postTick();
  }
  freeze(): void {
    for (const s of this.postOrder) s.freeze();
  }

  /**
   * Called by `knockDown` (actions.ts) for every knockdown in v2, after the knockback is applied:
   * spills the bag (C1 `spillBag`; never for cause 'self') then drops the held item (C2
   * `dropHeld`). `dir` = knockback direction (radians). Returns the spilled value. Owners change
   * only their own call's internals; new knockdown side effects are added HERE (via C0), not at
   * the knockdown sites.
   */
  onKnockdown(victimId: EntityId, cause: KnockdownCause, byId: EntityId | null, dir: number): number {
    const spilled = cause === 'self' ? 0 : this.coins.spillBag(victimId, cause, byId, dir);
    this.items.dropHeld(victimId);
    return spilled;
  }
}

export { ContentSystemBase, type ContentSystem } from './systemBase';
