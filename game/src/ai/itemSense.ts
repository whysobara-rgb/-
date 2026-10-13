/**
 * (Content 2.0, C6) Item sense for bots: what an item is worth, whether a swing pressed now would
 * land (wind-up + lunge reach), what else the arc would hit (never our own haul / piggy), and the
 * aim with the difficulty's aim error (content-plan §4.5, §5.2).
 *
 * Bots use items through Command only: an empty-handed dash press with an item in the pocket is
 * the item use (the sim routes it, R2); the 뿅망치 wind-up is sim-enforced for everyone, so a bot
 * swing is exactly as readable as a person's. Difficulty changes how often a valid swing is taken
 * (`itemSkill`) and the aim (`aimErrorRad`), never reach, speed or cooldown.
 */
import { BANK_MODEL, CHARACTER, ITEMS, POLICE, TICK_RATE } from '../sim/config';
import type { CharacterState, Command, EntityId, HeldItem, ItemKind, LootState, Vec2 } from '../sim/types';
import type { BotView } from './goals/types';
import { V } from './geom';
import { contentSkill } from './params';

/** Seconds from the press to the swing (sim: ITEMS.hammer.windupTicks). */
export const WINDUP_S = ITEMS.hammer.windupTicks / TICK_RATE;
/**
 * Part of the swing's lunge counted toward reach when deciding to press (the lunge carries the
 * swinger ~1 m during the 9-tick swing; the arc is checked every substep, so the first part of it
 * already extends the reach). Conservative: a press that would only connect at the very end of
 * the lunge is not taken.
 */
export const LUNGE_BONUS = 0.55;

export function isHammer(kind: ItemKind | null | undefined): boolean {
  return kind === 'hammer' || kind === 'goldHammer';
}

/** Reach (m, from my centre to the target surface) and half-angle of a hammer's arc. */
export function hammerGeom(kind: ItemKind): { reach: number; halfAngle: number } {
  return kind === 'goldHammer' ? { reach: ITEMS.goldHammer.reach, halfAngle: ITEMS.goldHammer.halfAngle } : { reach: ITEMS.hammer.reach, halfAngle: ITEMS.hammer.halfAngle };
}

/** My hammer if a press right now would start a swing (idle, off cooldown, uses left, empty hands). */
export function usableHammer(me: Readonly<CharacterState>): HeldItem | null {
  const it = me.item;
  if (!it || !isHammer(it.kind)) return null;
  if (it.phase !== 'idle' || it.cooldown > 0 || it.uses <= 0) return null;
  if (me.grab || me.knockdownTicks > 0 || (me.dizzyTicks ?? 0) > 0) return null;
  return it;
}

/** A swing is under way (wind-up or swing): no grab (it would cancel the wind-up), no steering. */
export function swingBusy(me: Readonly<CharacterState>): boolean {
  const it = me.item;
  return !!it && isHammer(it.kind) && (it.phase === 'windup' || it.phase === 'active');
}

/** Holds a hammer with uses left (whether or not it is ready this tick). */
export function holdsHammer(me: Readonly<CharacterState>): HeldItem | null {
  const it = me.item;
  return it && isHammer(it.kind) && it.uses > 0 ? it : null;
}

/**
 * What holding the item is worth to a bot, in points (a utility scale shared with loot): a 뿅망치
 * is ~5 swings of knockdowns / instant uproots / coin pops; the 황금 뿅망치 lasts the match.
 */
export function itemWorth(kind: ItemKind, secondsLeft: number): number {
  const base = kind === 'goldHammer' ? 260 : kind === 'hammer' ? 110 : 60;
  // (a few seconds before the end it is worth little: no time to use it)
  return base * Math.max(0, Math.min(1, (secondsLeft - 4) / 20));
}

/** Point `p` moving at `vel` when a swing pressed now connects (lead by the bot's lead quality). */
export function leadPoint(p: Vec2, vel: Vec2, quality: number): Vec2 {
  const t = (WINDUP_S + 0.06) * quality;
  return { x: p.x + vel.x * t, y: p.y + vel.y * t };
}

/** Aim with the difficulty's aim error (uniform ±aimErrorRad, the bot's own seeded stream). */
export function aimWithError(view: BotView, dir: Vec2): Vec2 {
  const err = contentSkill(view.P).aimError;
  const n = V.norm(dir);
  if (err <= 0) return n;
  return V.rot(n, (view.rng() * 2 - 1) * err);
}

/** The press-a-swing command (records the intent so the bot does not drop the dash). */
export function swingCommand(view: BotView, aim: Vec2, targetId: EntityId | null): Command {
  view.intendItemUse(targetId);
  return { move: { x: 0, y: 0 }, grab: false, dash: true, aim, ping: null };
}

/** Closest point of an OBB-ish loot shape to p (circle props: the circle). */
export function lootSurfacePoint(l: Readonly<LootState>, p: Vec2): Vec2 {
  if (l.variant === 'piggy') {
    const r = l.half.x;
    const d = V.dist(l.pos, p);
    return d > r ? V.add(l.pos, V.scale(V.sub(p, l.pos), r / d)) : { ...p };
  }
  const half = l.kind === 'bank' ? BANK_MODEL.half : l.half;
  const loc = V.rot(V.sub(p, l.pos), -l.angle);
  const q = { x: Math.max(-half.x, Math.min(half.x, loc.x)), y: Math.max(-half.y, Math.min(half.y, loc.y)) };
  return V.add(l.pos, V.rot(q, l.angle));
}

/** Closest point of a box (center / half / angle) to p. */
export function boxSurfacePoint(b: { center: Vec2; half: Vec2; angle: number }, p: Vec2): Vec2 {
  const loc = V.rot(V.sub(p, b.center), -b.angle);
  const q = { x: Math.max(-b.half.x, Math.min(b.half.x, loc.x)), y: Math.max(-b.half.y, Math.min(b.half.y, loc.y)) };
  return V.add(b.center, V.rot(q, b.angle));
}

export interface ArcSummary {
  /** A free piggy nobody of the other team holds would crack (2 cracks a hit). */
  piggy: boolean;
  /** A bank my team is hauling would ring like a bell (its free safes slide to the doors). */
  ourBank: boolean;
  /** Teammates in the arc (only shoved, but it costs them their step). */
  mates: number;
}

/**
 * What a swing along `aim` from my position would also hit (public state only; opponents are not
 * listed: the caller decides on them). Used to never bell our own hauled bank or crack the piggy.
 */
export function arcSummary(view: BotView, aim: Vec2, kind: ItemKind): ArcSummary {
  const st = view.sim.state;
  const me = view.me();
  const { reach, halfAngle } = hammerGeom(kind);
  const r = reach + LUNGE_BONUS;
  const cos = Math.cos(halfAngle);
  const a = V.norm(aim);
  const inArc = (p: Vec2, extra = 0): boolean => {
    const rel = V.sub(p, me.pos);
    const d = V.len(rel);
    if (d - extra > r) return false;
    return d < 1e-6 || V.dot(rel, a) / d >= cos;
  };
  const out: ArcSummary = { piggy: false, ourBank: false, mates: 0 };
  for (const c of view.mates()) if (inArc(c.pos, CHARACTER.radius)) out.mates++;
  for (const l of st.loot) {
    if (l.recovered || l.dormant || l.airborne) continue;
    if (l.variant === 'piggy') {
      const oppHolds = view.oppHolding(l.id).length > 0;
      if (!oppHolds && inArc(lootSurfacePoint(l, me.pos))) out.piggy = true;
    } else if (l.kind === 'bank' && !l.anchored) {
      const ours = l.grabbedBy.some((id) => st.characters[id - 1]?.team === view.team);
      if (ours && inArc(lootSurfacePoint(l, me.pos))) out.ourBank = true;
    }
  }
  return out;
}

/** Does a press now reach a character-sized target at `p` (centre)? Also needs line of sight. */
export function reachesBody(view: BotView, p: Vec2, bodyR: number, kind: ItemKind): boolean {
  const me = view.me();
  const d = V.dist(me.pos, p) - bodyR;
  if (d > hammerGeom(kind).reach + LUNGE_BONUS) return false;
  return view.sim.lineOfSight(me.pos, p);
}

/** Does a press now reach a surface point `q` (loot / breakable)? Also needs line of sight. */
export function reachesPoint(view: BotView, q: Vec2, kind: ItemKind, slack = 0): boolean {
  const me = view.me();
  const d = V.dist(me.pos, q);
  if (d > hammerGeom(kind).reach + LUNGE_BONUS * 0.6 - slack) return false;
  // (stop a hair short so the target's own surface never blocks the sight line)
  const k = d > 0.06 ? (d - 0.05) / d : 0;
  return view.sim.lineOfSight(me.pos, V.add(me.pos, V.scale(V.sub(q, me.pos), k)));
}

/** Radius of an officer body (for reach checks). */
export const OFFICER_R = POLICE.radius;
