/**
 * Content 2.0 view extras (C7; content-plan §4.5 "Render"): the one registration point the
 * GameView calls for everything Content 2.0 draws — coins and bags (coins.ts), items, hazards
 * and plungers (items.ts), props and breakables (props.ts) — and, from wave 2, gimmicks and
 * events (C7b appends its syncs in `createViewExtras`, nothing else changes in view.ts).
 *
 * Every extra is a pure view of SimState + SimEvents: nothing here can change a score.
 *
 * Contract for an extra:
 *  - `sync(state, alpha, dt)` once per rendered frame, after banks / safes are posed and before
 *    characters are (so rig attachments and item poses apply this frame). `dt = 0` freezes every
 *    animation (hitstop freeze-frames); `alpha` interpolates between the last two sim ticks.
 *  - `onEvents(events)` with each batch of sim events (after the view handled them itself).
 *  - `dispose()` on unload (match end / reload): remove and free everything it created.
 *  - It never allocates per frame in steady state (pools, cached geometry / materials).
 *
 * In classic matches every Content 2.0 array is empty, so the extras draw nothing and cost a few
 * empty loops per frame.
 */
import type * as THREE from 'three';
import type { EntityId, SimEvent, SimState, Simulation, Vec2 } from '../sim';
import type { RaccoonRig } from './models/raccoon';
import type { SafeRig } from './models/safes';
import type { ViewEffects } from './effects';
import type { QualityPreset } from './quality';
import { CoinsSync } from './coins';
import { ItemsSync } from './items';
import { PropsSync } from './props';

export interface ViewExtra {
  sync(state: SimState, alpha: number, dt: number): void;
  onEvents(events: readonly SimEvent[]): void;
  dispose(): void;
}

/** Interpolated pose of a rendered entity (sim plane) plus its floor height. */
export interface ExtraPose {
  x: number;
  y: number;
  a: number;
  h: number;
}

/** What the GameView lends its extras (all reads are of this frame's interpolated view state). */
export interface ViewExtrasHost {
  /** Scene group for world objects (cleared with the match). */
  readonly world: THREE.Group;
  readonly effects: ViewEffects;
  readonly sim: Simulation;
  /** View clock (s; frozen by dt = 0). */
  time(): number;
  preset(): QualityPreset;
  reducedMotion(): boolean;
  language(): 'ko' | 'en';
  /** Match / preview / results / title. */
  mode(): string;
  /** The focus character (player), or null. */
  focusId(): EntityId | null;
  /** Raccoon rig of a character, or null. */
  charRig(id: EntityId): RaccoonRig | null;
  /** Interpolated character pose (x, y, facing, floor height), or null. */
  charPose(id: EntityId): ExtraPose | null;
  /** Rig of a non-bank loot item (props are PropRig), or null once recovered / gone. */
  lootRig(id: EntityId): SafeRig | null;
  /** Interpolated loot pose, or null once recovered / gone. */
  lootPose(id: EntityId): ExtraPose | null;
  /** Interpolated police officer position, or null. */
  officerPos(id: EntityId): Vec2 | null;
  /** Freeze-frame request (seconds; the max of all requests this frame wins). */
  hitstop(seconds: number): void;
  /** Camera shake scaled by distance to the focus (respects the shake setting). */
  shake(at: Vec2, amount: number, radius: number): void;
  /** Directional camera punch (skipped with reduced motion). */
  punch(dir: Vec2, strength: number): void;
  /** Impact frame (white flash + chroma), scaled by distance and the shake setting. */
  impact(at: Vec2, strength: number, chroma: number): void;
  /** Squash pulse on a character / loot rig. */
  pulse(id: EntityId, amp: number): void;
  /** Startle pigeons. */
  scare(at: Vec2, radius: number): void;
  /** 0..1 how close a point is to the focus character (1 = on it, 0 = beyond `radius`). */
  nearFocus(at: Vec2, radius: number): number;
}

/** Build the extras for a freshly loaded match (C7a: coins, items, props; C7b adds gimmicks, events). */
export function createViewExtras(host: ViewExtrasHost): ViewExtra[] {
  return [new CoinsSync(host), new ItemsSync(host), new PropsSync(host)];
}
