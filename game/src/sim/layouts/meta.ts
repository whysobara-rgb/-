/**
 * Design metadata that travels with each layout but is not part of the sim
 * contract (LayoutDef). The validator uses it to verify that declared path
 * classes really have the intended clear width, and tools/docs use the intent
 * text. Gameplay code never needs it.
 */
import type { Vec2 } from '../types';

/**
 * Path classes (doc §6 "좁은 길"):
 * - narrow: characters and small safes only (clear width 1.05..1.15 m; a large safe's
 *   narrow side is 1.2 m, so it must not fit).
 * - medium: large safes pass, a bank never does (clear width 2.0..3.0 m).
 */
export type PathClass = 'narrow' | 'medium';

export const PATH_CLASS_WIDTH: Readonly<Record<PathClass, { min: number; max: number }>> = {
  narrow: { min: 1.05, max: 1.15 },
  medium: { min: 2.0, max: 3.0 },
};

/** A straight, axis-aligned stretch of a declared path; the validator measures its clear width. */
export interface PathSpec {
  id: string;
  cls: PathClass;
  /** Centerline endpoints (the width is measured perpendicular to a->b). */
  a: Vec2;
  b: Vec2;
}

/**
 * Content 2.0 rules a layout's v2 composition cannot meet on its (frozen, classic) geometry.
 * The validator turns the matching error into a `[warn] waived` line that prints the reason, and
 * errors on a waiver nothing matches any more (so a stale waiver cannot hide a later mistake).
 * Each one is a decision for the content-plan owner, not a tuning knob: keep them rare and specific.
 */
export interface RuleWaiver {
  /** Validator rule code: `crate` (natural-path crate), `pads` (item-pad walk), `truck` (truck approach). */
  rule: 'crate' | 'pads' | 'truck';
  /** What it covers, as the validator names it: `spawn 0`, `pad pad.lane.w`, `spot 0`. */
  subject: string;
  /** Why the rule cannot hold here (shown in the layout-check report). */
  reason: string;
}

export interface LayoutDesignMeta {
  /** Declared narrow alleys / medium lanes (mirrored pairs are listed explicitly). */
  paths: PathSpec[];
  /** One-paragraph design intent (English, for developers). */
  intent: string;
  /** Content 2.0 rule waivers (v2 composition only; absent = none). */
  waivers?: RuleWaiver[];
}

/**
 * Render-style vocabulary used by layout statics (StaticBoxDef.style). Shared by all
 * layouts so the renderer can build one asset set (doc §9: 같은 광장 자산).
 */
export const SHOP_STYLES = [
  'cafe',
  'tea',
  'bakery',
  'toy',
  'arcade',
  'flower',
  'icecream',
  'books',
  'music',
  'ramen',
  'laundry',
  'grocery',
  'pharmacy',
  'bike',
  'glass',
  'brick',
  'hanok',
] as const;
export const KIOSK_STYLES = ['tteokbokki', 'lemonade', 'tea'] as const;
