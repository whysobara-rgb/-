/**
 * [C2] Items: pickups, seeded deck, drop schedule, hammer / golden hammer (wave 1), plunger,
 * skates, soap (wave 2), gated balloons / smoke (wave 3) (content-plan §5.2).
 *
 * Wave 1 (this file today): the item framework, supply drops (보급 풍선), the 뿅망치 and the 황금 뿅망치.
 *
 * Rules (content-plan §5.2):
 * - R1 one pocket: pickup by touch (center within ITEMS.drop.pickupRadius, line of sight, not
 *   knocked down; carrying loot is fine). A full pocket ignores items, no swapping. Same-tick
 *   contest: the closest center wins; an exact distance tie means nobody takes it that tick
 *   (slot order never decides).
 * - R2 items add to the dash: empty-handed, the rising dash edge uses the item (`onDash`, routed
 *   by processCommands); holding loot, dash stays the carry boost.
 * - R3 visible, symmetric, finite: uses + lifetime per item; a knockdown drops the item at the
 *   holder's feet with its remaining uses (`dropHeld`, via the knockdown chokepoint); mirrored
 *   twin pads always get the same item.
 * - R4 no value, no multipliers, no rubber-banding: the schedule is a pure function of the tick
 *   (and the public final-countdown tick for the golden hammer); it never reads the score.
 * - R5 all in the sim: bots use items through Command only; the hammer wind-up is sim-enforced.
 *
 * Drops: pad pairs land at ITEMS.drop.pairs (s), the axis pad at ITEMS.drop.center (s), each
 * announced `warnTicks` ahead (`itemIncoming`, phase 'incoming', the crate shows the item's
 * silhouette), landing as phase 'ground' (`itemSpawn`) and expiring `groundLifetime` later
 * (`itemExpired`). A drop needs every pad it uses to be empty and room under `maxOnField`, or it
 * is skipped as a whole (a pair never drops on one side only). With several pairs, the k-th pair
 * drop uses pair k mod n. Decks: seeded shuffle without replacement (ctx.rng, the only draw),
 * refilled when empty; one draw per pair drop (both twins get it), the axis pad has its own deck.
 * 황금 뿅망치: on the axis pad at the final countdown + 8 s, or at end − 35 s when no countdown
 * started by then; announced 3 s ahead; once per match; it replaces whatever lies on the axis pad.
 *
 * 뿅망치 use (dash, empty-handed, cooldown 0 and uses left): wind-up `windupTicks` (aim locked to
 * the facing at the press, no drive), then a `swingTicks` swing with a `lungeSpeed` lunge (a use
 * is spent at the swing), then `recoverTicks` of recovery (half drive). The swing arc (reach,
 * ±halfAngle around the locked aim, line of sight) is checked after every physics substep; the
 * first substep that finds anything hits everything in the arc once and ends the swing. All
 * swings of a substep are collected first and applied together (order-independent):
 *   - two swinging hammers that have each other in their arcs clash (`itemClash`): both bounce,
 *     each loses one more use, nothing else is hit;
 *   - rival (opponent, not protected, not down): forced release, knockdown `knockdownTicks`,
 *     knockback (summed over attackers, like dash hits), bag spill + item drop (chokepoint);
 *     a protected rival or a teammate is only shoved (no spill, no stunlock);
 *   - officer: stunned (PoliceSystem.stunByItem, respects the re-stun immunity);
 *   - props: PropSystem.hammerHit (ATM, 돈나무, 돼지, gold safe); plain anchored loot gains uproot
 *     progress (small 1.0 / large 0.5 / bank 0.25); a free small safe is knocked out of every grip
 *     and flies ~2.5 m; a moving bank rings like a bell (free interior safes slide toward the
 *     nearest door, anchored interior safes gain progress);
 *   - breakables take `breakableDamage`; fences break after `fenceHits` hits (`fenceBroken`,
 *     bankId -1, byCharId).
 *   (Crane cat and truck door targets arrive with C4 / C5 in wave 2.)
 */
import { BANK_MODEL, CHARACTER, ITEM_FOREVER, ITEMS, POLICE, secondsToTicks, type ItemSpec } from './config';
import { emit, type SimContext } from './context';
import { bankFootprint, doRelease, knockDown, lootOBBOf, segmentBlocked } from './actions';
import { damageBreakable } from './breakables';
import { closestPointOnOBB, pointInOBB } from './math';
import { addUnanchorProgress } from './props';
import { nextEntityId } from './world';
import { ContentSystemBase } from './systemBase';
import type { EntityId, HeldItem, ItemKind, ItemPadDef, ItemPickupState, LayoutV2Def, OBB, Vec2 } from './types';

/**
 * buildV2 callback [C2]: validates LayoutV2Def.itemPads (unique ids; a twin names an existing pad
 * that names it back; at most one axis pad is used for the axis drops). No state is built here:
 * pickups appear at drop time and the per-match runtime (decks, schedule) lives in ItemSystem.
 * Runs after gimmicks, before events. Nothing to check when rules.items is 'off'.
 */
export function buildItemPads(ctx: SimContext, v2: LayoutV2Def): void {
  if (ctx.rules.items === 'off') return;
  const byId = new Map<string, ItemPadDef>();
  for (const p of v2.itemPads) {
    if (byId.has(p.id)) throw new Error(`duplicate item pad id ${p.id}`);
    byId.set(p.id, p);
  }
  for (const p of v2.itemPads) {
    if (p.twin === null) continue;
    const t = byId.get(p.twin);
    if (!t || t.twin !== p.id || t.id === p.id) throw new Error(`item pad ${p.id}: twin ${p.twin} must exist and name it back`);
  }
}

/** One scheduled supply drop. */
interface DropSlot {
  warnTick: number;
  landTick: number;
  pads: ItemPadDef[];
  deck: 'pair' | 'axis';
  done: boolean;
}

/** A target found in a swing arc (pre-resolution). */
type ArcTarget =
  | { t: 'char'; slot: number; id: EntityId; nx: number; ny: number; dist: number }
  | { t: 'police'; id: EntityId; nx: number; ny: number }
  | { t: 'loot'; id: EntityId; dir: number }
  | { t: 'breakable'; id: string; dir: number }
  | { t: 'fence'; idx: number; dir: number };

interface Swing {
  slot: number;
  id: EntityId;
  kind: ItemKind;
  targets: ArcTarget[];
}

/** Which deck rules.items 'on' uses (wave 1: hammers only; wave 2 switches to ITEMS.decks.wave2). */
function deckFor(mode: 'off' | 'hammerOnly' | 'on' | undefined): readonly ItemKind[] {
  if (mode === 'hammerOnly') return ITEMS.decks.hammerOnly;
  return ITEMS.decks[ITEMS.onDeck];
}

export class ItemSystem extends ContentSystemBase {
  readonly name = 'items' as const;

  private readonly enabled: boolean;
  private readonly deckSource: readonly ItemKind[];
  private readonly decks: { pair: ItemKind[]; axis: ItemKind[] } = { pair: [], axis: [] };
  private readonly schedule: DropSlot[] = [];
  private readonly axisPad: ItemPadDef | null;
  /** Golden hammer: 'none' until announced, then 'done'. */
  private goldState: 'none' | 'done' = 'none';
  /** Per slot: tick the current item phase started (no phase countdown on its first tick). */
  private readonly phaseStart: number[];
  /** Per slot: the current swing already hit something (or clashed). */
  private readonly swingDone: boolean[];
  /** Hammer hits per fence index (FenceState has no counter; fences break at ITEMS.hammer.fenceHits). */
  private readonly fenceHits = new Map<number, number>();

  constructor(ctx: SimContext) {
    super(ctx);
    const st = ctx.state;
    for (const ch of st.characters) ch.item = null;
    this.phaseStart = st.characters.map(() => -1);
    this.swingDone = st.characters.map(() => false);
    const pads = ctx.layout.v2?.itemPads ?? [];
    this.enabled = ctx.rules.items !== 'off' && pads.length > 0;
    this.deckSource = deckFor(ctx.rules.items);
    this.axisPad = pads.find((p) => p.twin === null) ?? null;
    if (!this.enabled) return;
    // pairs in layout order (each pair once)
    const pairs: ItemPadDef[][] = [];
    const seen = new Set<string>();
    for (const p of pads) {
      if (p.twin === null || seen.has(p.id)) continue;
      const t = pads.find((q) => q.id === p.twin)!;
      seen.add(p.id);
      seen.add(t.id);
      pairs.push([p, t]);
    }
    const D = ITEMS.drop;
    if (pairs.length) {
      D.pairs.forEach((s, k) => {
        const land = secondsToTicks(s);
        this.schedule.push({ warnTick: Math.max(1, land - D.warnTicks), landTick: land, pads: pairs[k % pairs.length]!, deck: 'pair', done: false });
      });
    }
    if (this.axisPad) {
      for (const s of D.center) {
        const land = secondsToTicks(s);
        this.schedule.push({ warnTick: Math.max(1, land - D.warnTicks), landTick: land, pads: [this.axisPad], deck: 'axis', done: false });
      }
    }
    this.schedule.sort((a, b) => a.warnTick - b.warnTick || (a.deck === b.deck ? 0 : a.deck === 'pair' ? -1 : 1));
  }

  // -------------------------------------------------------------------------
  // Step 1: dash routing (R2)
  // -------------------------------------------------------------------------

  /**
   * [C2] Rising dash edge of `slot` while it holds an item and no loot (R2): start the item use.
   * Called from processCommands INSTEAD of startDash, regardless of the dash cooldown (items keep
   * their own cooldown). Ignored while the item is cooling down, mid-use or out of uses.
   */
  onDash(slot: number): void {
    const st = this.ctx.state;
    const ch = st.characters[slot]!;
    const it = ch.item;
    if (!it || ch.grab || ch.knockdownTicks > 0) return;
    if (it.phase !== 'idle' || it.cooldown > 0 || it.uses <= 0) return;
    if (it.kind === 'hammer' || it.kind === 'goldHammer') {
      it.phase = 'windup';
      it.phaseTicks = ITEMS.hammer.windupTicks;
      it.aim = ch.facing;
      it.cooldown = ITEMS.specs[it.kind].cooldownTicks;
      this.phaseStart[slot] = st.tick;
      emit(this.ctx, { type: 'itemUse', tick: st.tick, charId: ch.id, kind: it.kind, phase: 'windup' });
    }
    // wave 2: plunger aim, soap dash, skate burst
  }

  // -------------------------------------------------------------------------
  // Step 2: phases, drive, lunge (prePhysics) and swing arcs (afterSubstep)
  // -------------------------------------------------------------------------

  override prePhysics(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const H = ITEMS.hammer;
    for (let slot = 0; slot < st.characters.length; slot++) {
      const ch = st.characters[slot]!;
      const it = ch.item;
      if (!it) continue;
      const first = this.phaseStart[slot] === st.tick;
      if (it.cooldown > 0) it.cooldown--;
      if (it.phase === 'idle') continue;
      // grabbing loot during the wind-up cancels the use (nothing spent; the cooldown stays)
      if (it.phase === 'windup' && ch.grab) {
        this.setPhase(slot, it, 'idle', 0);
        continue;
      }
      if (!first && --it.phaseTicks <= 0) {
        if (it.phase === 'windup') this.fire(slot, it);
        else if (it.phase === 'active') this.setPhase(slot, it, 'recover', H.recoverTicks);
        else this.setPhase(slot, it, 'idle', 0);
      }
      const b = ctx.chars[slot]!.body;
      if (ch.knockdownTicks > 0 || ch.dashTicks > 0) continue;
      if (it.phase === 'windup' || it.phase === 'active') {
        ch.facing = it.aim; // aim locked at the press: read the wind-up, sidestep
        b.fx = 0;
        b.fy = 0;
        b.noDrag = it.phase === 'active';
      } else if (it.phase === 'recover') {
        b.fx *= H.recoverDriveScale;
        b.fy *= H.recoverDriveScale;
      }
    }
  }

  private setPhase(slot: number, it: HeldItem, phase: HeldItem['phase'], ticks: number): void {
    it.phase = phase;
    it.phaseTicks = ticks;
    this.phaseStart[slot] = this.ctx.state.tick;
  }

  /** Wind-up over: spend a use, lunge along the locked aim, start checking the arc. */
  private fire(slot: number, it: HeldItem): void {
    const ctx = this.ctx;
    const ch = ctx.state.characters[slot]!;
    const H = ITEMS.hammer;
    this.setPhase(slot, it, 'active', H.swingTicks);
    it.uses = Math.max(0, it.uses - 1);
    this.swingDone[slot] = false;
    const b = ctx.chars[slot]!.body;
    b.vx = b.fvx + Math.cos(it.aim) * H.lungeSpeed;
    b.vy = b.fvy + Math.sin(it.aim) * H.lungeSpeed;
    emit(ctx, { type: 'itemUse', tick: ctx.state.tick, charId: ch.id, kind: it.kind, phase: 'fire' });
  }

  override afterSubstep(_substep: number): void {
    const st = this.ctx.state;
    let swings: Swing[] | null = null;
    for (let slot = 0; slot < st.characters.length; slot++) {
      const ch = st.characters[slot]!;
      const it = ch.item;
      if (!it || it.phase !== 'active' || this.swingDone[slot] || ch.knockdownTicks > 0) continue;
      if (it.kind !== 'hammer' && it.kind !== 'goldHammer') continue;
      const targets = this.arcTargets(slot, it);
      if (targets.length) (swings ??= []).push({ slot, id: ch.id, kind: it.kind, targets });
    }
    if (swings) this.resolveSwings(swings);
  }

  /** Everything inside `slot`'s swing arc right now (live body poses), pre-resolution. */
  private arcTargets(slot: number, it: HeldItem): ArcTarget[] {
    const ctx = this.ctx;
    const st = ctx.state;
    const gold = it.kind === 'goldHammer';
    const reach = gold ? ITEMS.goldHammer.reach : ITEMS.hammer.reach;
    const cosHalf = Math.cos(gold ? ITEMS.goldHammer.halfAngle : ITEMS.hammer.halfAngle);
    const ab = ctx.chars[slot]!.body;
    const o: Vec2 = { x: ab.x, y: ab.y };
    const ax = Math.cos(it.aim);
    const ay = Math.sin(it.aim);
    const out: ArcTarget[] = [];
    /** In the arc: within reach (to the surface point p at distance d) and inside the cone. */
    const inCone = (dx: number, dy: number, d: number): boolean => d < 1e-6 || (dx * ax + dy * ay) / d >= cosHalf;
    /** Line of sight to a surface point, stopping just short so the target's own surface never counts. */
    const clear = (p: Vec2, d: number): boolean => {
      if (d <= 0.03) return true;
      const k = (d - 0.03) / d;
      return !segmentBlocked(ctx, o, { x: o.x + (p.x - o.x) * k, y: o.y + (p.y - o.y) * k });
    };
    // characters
    for (let j = 0; j < st.characters.length; j++) {
      if (j === slot) continue;
      const vb = ctx.chars[j]!.body;
      const dx = vb.x - o.x;
      const dy = vb.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d - CHARACTER.radius > reach || !inCone(dx, dy, d)) continue;
      if (segmentBlocked(ctx, o, { x: vb.x, y: vb.y })) continue;
      const nx = d > 1e-6 ? dx / d : ax;
      const ny = d > 1e-6 ? dy / d : ay;
      out.push({ t: 'char', slot: j, id: st.characters[j]!.id, nx, ny, dist: d });
    }
    // officers
    const police = ctx.police;
    if (police) {
      for (const off of police.itemTargets()) {
        const dx = off.x - o.x;
        const dy = off.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d - POLICE.radius > reach || !inCone(dx, dy, d)) continue;
        if (segmentBlocked(ctx, o, { x: off.x, y: off.y })) continue;
        out.push({ t: 'police', id: off.id, nx: d > 1e-6 ? dx / d : ax, ny: d > 1e-6 ? dy / d : ay });
      }
    }
    // loot
    for (let i = 0; i < st.loot.length; i++) {
      const l = st.loot[i]!;
      if (l.recovered || l.dormant || l.airborne) continue;
      if (l.grabbedBy.includes(st.characters[slot]!.id)) continue; // never your own load
      const lb = ctx.loot[i]!.body;
      let p: Vec2;
      if (l.kind === 'bank') {
        const fp = bankFootprint(lb);
        if (pointInOBB(o, fp)) continue; // standing on its floor: the walls are not in front of you
        if (Math.hypot(lb.x - o.x, lb.y - o.y) > reach + Math.hypot(BANK_MODEL.half.x, BANK_MODEL.half.y)) continue;
        p = closestPointOnOBB(o, fp);
      } else {
        if (Math.hypot(lb.x - o.x, lb.y - o.y) > reach + Math.hypot(l.half.x, l.half.y)) continue;
        if (l.variant === 'piggy') {
          const r = l.half.x;
          const cx = lb.x - o.x;
          const cy = lb.y - o.y;
          const cd = Math.hypot(cx, cy);
          p = cd > r ? { x: lb.x - (cx / cd) * r, y: lb.y - (cy / cd) * r } : { x: o.x, y: o.y };
        } else p = closestPointOnOBB(o, lootOBBOf(l, lb));
      }
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > reach || !inCone(dx, dy, d) || !clear(p, d)) continue;
      out.push({ t: 'loot', id: l.id, dir: d > 1e-6 ? Math.atan2(dy, dx) : it.aim });
    }
    // breakables
    for (const br of st.breakables) {
      if (br.broken) continue;
      if (Math.hypot(br.center.x - o.x, br.center.y - o.y) > reach + Math.hypot(br.half.x, br.half.y)) continue;
      const p = closestPointOnOBB(o, { center: br.center, half: br.half, angle: br.angle });
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > reach || !inCone(dx, dy, d) || !clear(p, d)) continue;
      out.push({ t: 'breakable', id: br.id, dir: d > 1e-6 ? Math.atan2(dy, dx) : it.aim });
    }
    // fences
    for (let fi = 0; fi < st.fences.length; fi++) {
      const f = st.fences[fi]!;
      if (f.broken) continue;
      const obb: OBB = { center: f.center, half: f.half, angle: f.angle };
      if (Math.hypot(f.center.x - o.x, f.center.y - o.y) > reach + Math.hypot(f.half.x, f.half.y)) continue;
      const p = closestPointOnOBB(o, obb);
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > reach || !inCone(dx, dy, d) || !clear(p, d)) continue;
      out.push({ t: 'fence', idx: fi, dir: d > 1e-6 ? Math.atan2(dy, dx) : it.aim });
    }
    return out;
  }

  /**
   * Apply every swing of one substep together. Pre-resolution picks (arcTargets) -> clashes ->
   * attacker recoil -> characters (knockback summed per victim, credit to the closest attacker,
   * exact tie -> lower id) -> officers -> loot -> breakables -> fences, each in ascending target
   * id then attacker id. Nothing depends on roster slot order.
   */
  private resolveSwings(swings: Swing[]): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const H = ITEMS.hammer;
    const tick = st.tick;
    // 1. clashes: two swinging hammers with each other in their arcs
    const clashed = new Set<number>();
    for (const a of swings) {
      for (const b of swings) {
        if (b.id <= a.id) continue;
        const aHasB = a.targets.some((t) => t.t === 'char' && t.slot === b.slot);
        const bHasA = b.targets.some((t) => t.t === 'char' && t.slot === a.slot);
        if (!aHasB || !bHasA) continue;
        clashed.add(a.slot);
        clashed.add(b.slot);
        const ba = ctx.chars[a.slot]!.body;
        const bb = ctx.chars[b.slot]!.body;
        const dx = bb.x - ba.x;
        const dy = bb.y - ba.y;
        const d = Math.hypot(dx, dy);
        const nx = d > 1e-6 ? dx / d : Math.cos(st.characters[a.slot]!.item!.aim);
        const ny = d > 1e-6 ? dy / d : Math.sin(st.characters[a.slot]!.item!.aim);
        ba.noDrag = false;
        bb.noDrag = false;
        ba.vx = ba.fvx - nx * H.clashBounceSpeed;
        ba.vy = ba.fvy - ny * H.clashBounceSpeed;
        bb.vx = bb.fvx + nx * H.clashBounceSpeed;
        bb.vy = bb.fvy + ny * H.clashBounceSpeed;
        for (const s of [a, b]) {
          const it = st.characters[s.slot]!.item!;
          it.uses = Math.max(0, it.uses - 1);
        }
        emit(ctx, { type: 'itemClash', tick, aId: a.id, bId: b.id });
      }
    }
    const live = swings.filter((s) => !clashed.has(s.slot));
    for (const s of swings) this.swingDone[s.slot] = true;
    if (!live.length) return;
    // 2. every hitting attacker's lunge ends on what it hit
    for (const s of live) {
      const b = ctx.chars[s.slot]!.body;
      b.noDrag = false;
      b.vx = b.fvx + (b.vx - b.fvx) * H.hitRecoil;
      b.vy = b.fvy + (b.vy - b.fvy) * H.hitRecoil;
    }
    type Hit<T extends ArcTarget['t']> = { s: Swing; t: Extract<ArcTarget, { t: T }> };
    const hitsOf = <T extends ArcTarget['t']>(kind: T): Hit<T>[] => {
      const out: Hit<T>[] = [];
      for (const s of live) for (const t of s.targets) if (t.t === kind) out.push({ s, t: t as Extract<ArcTarget, { t: T }> });
      return out;
    };
    const scaleOf = (s: Swing): number => (s.kind === 'goldHammer' ? ITEMS.goldHammer.knockbackScale : 1);

    // 3. characters
    const charHits = hitsOf('char').sort((a, b) => a.t.id - b.t.id || a.s.id - b.s.id);
    const byVictim = new Map<number, Hit<'char'>[]>();
    for (const h of charHits) {
      const arr = byVictim.get(h.t.slot);
      if (arr) arr.push(h);
      else byVictim.set(h.t.slot, [h]);
    }
    const victims = [...byVictim.keys()].sort((a, b) => st.characters[a]!.id - st.characters[b]!.id);
    for (const vslot of victims) {
      const hs = byVictim.get(vslot)!;
      const v = st.characters[vslot]!;
      const vb = ctx.chars[vslot]!.body;
      const opp = hs.filter((h) => st.characters[h.s.slot]!.team !== v.team);
      const vulnerable = opp.length > 0 && v.protectTicks === 0 && v.knockdownTicks === 0;
      if (vulnerable) {
        let kx = 0;
        let ky = 0;
        let credit = opp[0]!;
        for (const h of opp) {
          const sc = scaleOf(h.s);
          kx += h.t.nx * sc;
          ky += h.t.ny * sc;
          if (h.t.dist < credit.t.dist - 1e-9 || (Math.abs(h.t.dist - credit.t.dist) <= 1e-9 && h.s.id < credit.s.id)) credit = h;
        }
        // cap the summed direction at the strongest single scale (two hammers never stack speed)
        const maxScale = Math.max(...opp.map((h) => scaleOf(h.s)));
        const l = Math.hypot(kx, ky);
        const k = l > maxScale ? (H.knockbackSpeed * maxScale) / l : H.knockbackSpeed;
        knockDown(ctx, vslot, kx * k, ky * k, 'hammer', credit.s.id, H.knockdownTicks);
        for (const h of hs) {
          const kd = h === credit;
          emit(ctx, { type: 'itemHit', tick, charId: h.s.id, kind: h.s.kind, target: 'char', targetId: v.id, knockdown: kd });
        }
      } else {
        for (const h of hs) {
          vb.vx += h.t.nx * H.protectedShoveSpeed;
          vb.vy += h.t.ny * H.protectedShoveSpeed;
          emit(ctx, { type: 'itemHit', tick, charId: h.s.id, kind: h.s.kind, target: 'char', targetId: v.id, knockdown: false });
        }
      }
    }

    // 4. officers
    const police = ctx.police;
    if (police) {
      for (const h of hitsOf('police').sort((a, b) => a.t.id - b.t.id || a.s.id - b.s.id)) {
        const gold = h.s.kind === 'goldHammer';
        const ticks = gold ? ITEMS.goldHammer.policeStunTicks : H.policeStunTicks;
        const sp = H.knockbackSpeed * scaleOf(h.s);
        const stunned = police.stunByItem(h.t.id, ticks, h.t.nx * sp, h.t.ny * sp, h.s.id, H.protectedShoveSpeed);
        emit(ctx, { type: 'itemHit', tick, charId: h.s.id, kind: h.s.kind, target: 'police', targetId: h.t.id, knockdown: stunned });
      }
    }

    // 5. loot
    for (const h of hitsOf('loot').sort((a, b) => a.t.id - b.t.id || a.s.id - b.s.id)) {
      this.hitLoot(h.t.id, h.s, h.t.dir);
      emit(ctx, { type: 'itemHit', tick, charId: h.s.id, kind: h.s.kind, target: 'loot', targetId: h.t.id, knockdown: false });
    }

    // 6. breakables
    for (const h of hitsOf('breakable').sort((a, b) => (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0) || a.s.id - b.s.id)) {
      damageBreakable(ctx, h.t.id, H.breakableDamage, h.s.id, h.t.dir);
      emit(ctx, { type: 'itemHit', tick, charId: h.s.id, kind: h.s.kind, target: 'breakable', targetId: h.t.id, knockdown: false });
    }

    // 7. fences
    for (const h of hitsOf('fence').sort((a, b) => a.t.idx - b.t.idx || a.s.id - b.s.id)) {
      const fs = st.fences[h.t.idx]!;
      emit(ctx, { type: 'itemHit', tick, charId: h.s.id, kind: h.s.kind, target: 'fence', targetId: fs.id, knockdown: false });
      if (fs.broken) continue;
      const n = (this.fenceHits.get(h.t.idx) ?? 0) + 1;
      this.fenceHits.set(h.t.idx, n);
      if (n >= H.fenceHits) this.breakFence(h.t.idx, h.s.id);
    }
  }

  /** The hammer's effect on one loot item (props first, then the plain-safe / bank rules). */
  private hitLoot(lootId: EntityId, s: Swing, dir: number): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const H = ITEMS.hammer;
    const idx = ctx.lootIndex.get(lootId);
    if (idx === undefined) return;
    const l = st.loot[idx]!;
    if (l.recovered || l.dormant || l.airborne) return;
    if (l.variant && ctx.content?.props.hammerHit(lootId, s.id, dir)) return;
    if (l.anchored) {
      addUnanchorProgress(ctx, lootId, H.progress[l.kind], s.id);
      return;
    }
    const b = ctx.loot[idx]!.body;
    if (l.kind === 'smallSafe') {
      // knocked out of every grip, flies ~carriedSmallSafeFly m (linear drag: distance = v / drag)
      for (const cid of [...l.grabbedBy]) {
        const ch = st.characters[cid - 1];
        if (ch) doRelease(ctx, ch.slot, true);
      }
      const v = H.carriedSmallSafeFly * b.linDrag;
      b.vx = b.fvx + Math.cos(dir) * v;
      b.vy = b.fvy + Math.sin(dir) * v;
      l.lastHolder = s.id;
      return;
    }
    if (l.kind === 'bank') {
      // 은행 종 치기: ring the moving bank like a bell
      const c = Math.cos(b.a);
      const sn = Math.sin(b.a);
      for (let i = 0; i < st.loot.length; i++) {
        const q = st.loot[i]!;
        if (q.kind === 'bank' || q.recovered || q.dormant || q.airborne || q.floorOf !== l.id) continue;
        if (q.anchored) {
          addUnanchorProgress(ctx, q.id, H.bankBellProgress, s.id);
          continue;
        }
        const qb = ctx.loot[i]!.body;
        const ly = -(qb.x - b.x) * sn + (qb.y - b.y) * c;
        const doorLy = ly >= 0 ? BANK_MODEL.half.y : -BANK_MODEL.half.y;
        const tx = b.x - doorLy * sn - qb.x;
        const ty = b.y + doorLy * c - qb.y;
        const tl = Math.hypot(tx, ty);
        if (tl < 1e-6) continue;
        qb.vx += (tx / tl) * H.bankBellSafeSpeed;
        qb.vy += (ty / tl) * H.bankBellSafeSpeed;
      }
    }
    // a free large safe just takes the bonk
  }

  /** Break fence `fi` by hammer (mirrors Simulation.breakFence: static off, state, event). */
  private breakFence(fi: number, byCharId: EntityId): void {
    const ctx = this.ctx;
    const f = ctx.fences[fi]!;
    const fs = ctx.state.fences[fi]!;
    if (fs.broken) return;
    f.shape.enabled = false;
    fs.broken = true;
    fs.brokenTick = ctx.state.tick;
    emit(ctx, { type: 'fenceBroken', tick: ctx.state.tick, fenceId: fs.id, bankId: -1, pos: { x: fs.center.x, y: fs.center.y }, byCharId });
  }

  // -------------------------------------------------------------------------
  // Step 3: pickup by touch (after loading, poses current)
  // -------------------------------------------------------------------------

  override afterLoading(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    if (!st.items.length) return;
    const R = ITEMS.drop.pickupRadius;
    const taken = new Set<number>();
    const picked: ItemPickupState[] = [];
    for (const item of st.items) {
      if (item.phase !== 'ground') continue;
      let best = -1;
      let bestD = Infinity;
      let tie = false;
      for (let j = 0; j < st.characters.length; j++) {
        const ch = st.characters[j]!;
        if (ch.item || taken.has(j) || ch.knockdownTicks > 0) continue;
        const b = ctx.chars[j]!.body;
        const d = Math.hypot(b.x - item.pos.x, b.y - item.pos.y);
        if (d > R) continue;
        if (segmentBlocked(ctx, { x: b.x, y: b.y }, item.pos)) continue;
        if (d < bestD - 1e-9) {
          best = j;
          bestD = d;
          tie = false;
        } else if (Math.abs(d - bestD) <= 1e-9) tie = true;
      }
      if (best < 0 || tie) continue;
      taken.add(best);
      picked.push(item);
      const ch = st.characters[best]!;
      const spec: ItemSpec = ITEMS.specs[item.kind];
      // a dropped item keeps the lifetime it had left (item.expiresTick); a fresh one starts its own
      const expires = spec.lifetimeTicks >= ITEM_FOREVER ? ITEM_FOREVER : item.padId === null ? item.expiresTick : st.tick + spec.lifetimeTicks;
      ch.item = { kind: item.kind, uses: item.uses, expiresTick: expires, cooldown: 0, phase: 'idle', phaseTicks: 0, aim: ch.facing };
      this.phaseStart[best] = -1;
      emit(ctx, { type: 'itemPickup', tick: st.tick, charId: ch.id, itemId: item.id, kind: item.kind });
    }
    if (picked.length) st.items = st.items.filter((i) => !picked.includes(i));
  }

  // -------------------------------------------------------------------------
  // Knockdown chokepoint
  // -------------------------------------------------------------------------

  /**
   * [C2] Drop `charId`'s item at its feet with its remaining uses (knockdown), emitting
   * `itemDropped`. No-op without an item; an item with no uses left just expires.
   */
  dropHeld(charId: EntityId): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const ch = st.characters[charId - 1];
    if (!ch || !ch.item) return;
    const it = ch.item;
    ch.item = null;
    this.phaseStart[ch.slot] = -1;
    if (it.uses <= 0 || st.tick >= it.expiresTick) {
      emit(ctx, { type: 'itemExpired', tick: st.tick, charId: ch.id, itemId: null, kind: it.kind });
      return;
    }
    const b = ctx.chars[ch.slot]!.body;
    const id = nextEntityId(ctx, 'item');
    const pos = { x: b.x, y: b.y };
    const expires = Math.min(it.expiresTick, st.tick + ITEMS.drop.groundLifetime);
    st.items.push({ id, kind: it.kind, padId: null, pos, phase: 'ground', landTick: st.tick, expiresTick: expires, uses: it.uses });
    emit(ctx, { type: 'itemDropped', tick: st.tick, charId: ch.id, itemId: id, kind: it.kind, uses: it.uses, pos: { ...pos } });
  }

  // -------------------------------------------------------------------------
  // Step 7: drop schedule, landing, expiry
  // -------------------------------------------------------------------------

  override postTick(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const tick = st.tick;
    // ground expiry (poof) and landing
    if (st.items.length) {
      const gone: ItemPickupState[] = [];
      for (const item of st.items) {
        if (item.phase === 'ground' && tick >= item.expiresTick) {
          gone.push(item);
          emit(ctx, { type: 'itemExpired', tick, charId: null, itemId: item.id, kind: item.kind });
        } else if (item.phase === 'incoming' && tick >= item.landTick) {
          item.phase = 'ground';
          emit(ctx, { type: 'itemSpawn', tick, itemId: item.id, kind: item.kind, pos: { ...item.pos } });
        }
      }
      if (gone.length) st.items = st.items.filter((i) => !gone.includes(i));
    }
    // held items: lifetime over or out of uses (only between uses)
    for (const ch of st.characters) {
      const it = ch.item;
      if (!it || it.phase !== 'idle') continue;
      if (it.uses <= 0 || tick >= it.expiresTick) {
        ch.item = null;
        emit(ctx, { type: 'itemExpired', tick, charId: ch.id, itemId: null, kind: it.kind });
      }
    }
    if (!this.enabled) return;
    // scheduled drops
    for (const d of this.schedule) {
      if (d.done || tick < d.warnTick) continue;
      d.done = true;
      if (tick >= d.landTick) continue; // missed (cannot happen in a normal run)
      if (!this.padsFree(d.pads) || st.items.length + d.pads.length > ITEMS.drop.maxOnField) continue;
      const kind = this.draw(d.deck);
      for (const p of d.pads) this.spawnIncoming(p, kind, d.landTick);
    }
    // 황금 뿅망치
    if (this.goldState === 'none' && this.axisPad) {
      const G = ITEMS.drop.goldHammer;
      let land: number | null = null;
      if (st.finalCountdownTick !== null) land = st.finalCountdownTick + G.afterCountdownTicks;
      else if (Number.isFinite(st.endTick)) land = st.endTick - G.beforeEndTicks;
      if (land !== null && tick >= land - G.announceTicks) {
        this.goldState = 'done';
        land = Math.max(land, tick + 1);
        if (land < st.endTick) {
          // it replaces whatever lies on (or is falling onto) the axis pad
          const pad = this.axisPad;
          const old = st.items.filter((i) => i.padId === pad.id);
          for (const i of old) emit(ctx, { type: 'itemExpired', tick, charId: null, itemId: i.id, kind: i.kind });
          if (old.length) st.items = st.items.filter((i) => i.padId !== pad.id);
          this.spawnIncoming(pad, 'goldHammer', land);
        }
      }
    }
  }

  private padsFree(pads: ItemPadDef[]): boolean {
    for (const p of pads) if (this.ctx.state.items.some((i) => i.padId === p.id)) return false;
    return true;
  }

  /** Seeded shuffle without replacement, refilled when empty (ctx.rng: the item-deck stream). */
  private draw(which: 'pair' | 'axis'): ItemKind {
    const deck = this.decks[which];
    if (deck.length === 0) {
      const fresh = [...this.deckSource];
      for (let i = fresh.length - 1; i > 0; i--) {
        const j = Math.floor(this.ctx.rng() * (i + 1));
        const t = fresh[i]!;
        fresh[i] = fresh[j]!;
        fresh[j] = t;
      }
      deck.push(...fresh);
    }
    return deck.shift()!;
  }

  private spawnIncoming(pad: ItemPadDef, kind: ItemKind, landTick: number): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const id = nextEntityId(ctx, 'item');
    const spec = ITEMS.specs[kind];
    st.items.push({
      id,
      kind,
      padId: pad.id,
      pos: { x: pad.pos.x, y: pad.pos.y },
      phase: 'incoming',
      landTick,
      expiresTick: landTick + ITEMS.drop.groundLifetime,
      uses: spec.uses,
    });
    st.items.sort((a, b) => a.id - b.id);
    emit(ctx, { type: 'itemIncoming', tick: st.tick, padId: pad.id, kind, landTick });
  }
}
