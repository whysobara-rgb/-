/**
 * Character actions: command sanitising, facing, grab candidate selection, grab / release,
 * dash and carry boost, dash hits, pings, unanchoring and per-tick drive preparation.
 *
 * Doc references: §4 (controls: grab/release, dash, move; "금고를 가리키면 금고, 외벽을 가리키면
 * 은행"), §5 (unanchor 1 s / 2 s / 3 s, anyone can use an unanchored object), §7 (same-team
 * dash never knocks down), §8 (dash cooldown 4 s shared with carry boost, ~2 s protection).
 */
import {
  BANK_MODEL,
  CHARACTER,
  DASH,
  DT,
  KNOCKDOWN_TICKS,
  PING,
  PROP_SPECS,
  PROTECT_TICKS,
  UNANCHOR_TICKS,
} from './config';
import { emit, lootById, type SimContext } from './context';
import { closestPointOnOBB, obbInsideOBB, pointInOBB, rayCircle, rayOBB } from './math';
import { GrabJoint, SHAPE_CIRCLE, type Body } from './physics';
import type { CharacterState, Command, EntityId, GrabCandidate, KnockdownCause, LootState, OBB, TeamId, Vec2 } from './types';
import { EMPTY_COMMAND } from './types';
import { cancelEmoteOnKnockdown, isEmoteId, stepEmote } from './emotes';
import { boxInertia } from './world';

/** Half-angle of the fallback grab cone when nothing is directly pointed at. */
export const GRAB_CONE = (70 * Math.PI) / 180;
/** How fast a fresh grab pulls the holder to holdDistance (m/s). */
const GRAB_SETTLE_SPEED = 3;
/**
 * Push cone with hysteresis: a stick within PUSH_ENTER of the holder->anchor direction starts
 * pushing, and a push continues until the stick leaves PUSH_LEAVE. (A single 80 degree cone
 * turned the whole drive toward the anchor at its edge, so a 2 degree stick change flipped a
 * sideways drag into a push the other way: the haul veered against the stick.)
 */
export const PUSH_ENTER_COS = Math.cos((50 * Math.PI) / 180);
export const PUSH_LEAVE_COS = Math.cos((70 * Math.PI) / 180);
/** Extra angular drag (1/s) of a hauled bank while nobody pushes it ("yaw grip"). */
export const BANK_PULL_YAW_DRAG = 10;
/** Characters closer than this (center distance minus 2r) count as touched by a dash. */
const DASH_HIT_GAP = 0.1;

// ---------------------------------------------------------------------------
// Geometry accessors (live from physics bodies)
// ---------------------------------------------------------------------------

export function bodyOBB(b: Body, half: Vec2): OBB {
  return { center: { x: b.x, y: b.y }, half: { x: half.x, y: half.y }, angle: b.a };
}

export function bankFootprint(b: Body): OBB {
  return bodyOBB(b, BANK_MODEL.half);
}

export function bankFloor(b: Body): OBB {
  return bodyOBB(b, BANK_MODEL.floorHalf);
}

export function bankWalls(b: Body): OBB[] {
  const c = Math.cos(b.a);
  const s = Math.sin(b.a);
  return BANK_MODEL.walls.map((w) => ({
    center: { x: b.x + w.center.x * c - w.center.y * s, y: b.y + w.center.x * s + w.center.y * c },
    half: { x: w.half.x, y: w.half.y },
    angle: b.a,
  }));
}

/** True if world point p is over the bank's interior floor rectangle. */
export function onFloor(b: Body, x: number, y: number): boolean {
  const dx = x - b.x;
  const dy = y - b.y;
  const c = Math.cos(b.a);
  const s = Math.sin(b.a);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) <= BANK_MODEL.floorHalf.x && Math.abs(ly) <= BANK_MODEL.floorHalf.y;
}

export function lootOBBOf(l: LootState, b: Body): OBB {
  return bodyOBB(b, l.half);
}

/** Unrecovered bank whose floor carries world point (x, y), lowest id first. */
export function floorAt(ctx: SimContext, x: number, y: number): LootState | null {
  const st = ctx.state;
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.kind !== 'bank') continue;
    if (l.recovered) continue;
    if (onFloor(ctx.loot[i]!.body, x, y)) return l;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Occlusion
// ---------------------------------------------------------------------------

/**
 * True if segment a->b crosses a collision blocker: any enabled world static (buildings,
 * planters, trees, vans, boundary, intact fences) or the wall of any unrecovered bank.
 */
export function segmentBlocked(ctx: SimContext, a: Vec2, b: Vec2): boolean {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  const dir = { x: b.x - a.x, y: b.y - a.y };
  for (const s of ctx.physics.queryStatics(minX, minY, maxX, maxY)) {
    if (!s.enabled) continue;
    if (s.type === SHAPE_CIRCLE) {
      if (rayCircle(a, dir, { x: s.x, y: s.y }, s.r, 1) !== null) return true;
    } else if (rayOBB(a, dir, { center: { x: s.x, y: s.y }, half: { x: s.hx, y: s.hy }, angle: Math.atan2(s.uy, s.ux) }, 1) !== null) {
      return true;
    }
  }
  const st = ctx.state;
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.kind !== 'bank' || l.recovered) continue;
    const body = ctx.loot[i]!.body;
    // cheap reject with the footprint
    if (rayOBB(a, dir, bankFootprint(body), 1) === null) continue;
    for (const w of bankWalls(body)) if (rayOBB(a, dir, w, 1) !== null) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Grab candidate
// ---------------------------------------------------------------------------

interface Cand {
  targetId: EntityId;
  part: 'safe' | 'bankWall';
  ax: number;
  ay: number;
  pointed: boolean;
  dist: number;
  angle: number;
  body: Body;
}

/** Is local point (lx, ly) on the bank footprint boundary on a wall (i.e. not in a door gap)? */
function onExteriorWall(lx: number, ly: number): boolean {
  const hx = BANK_MODEL.half.x;
  const hy = BANK_MODEL.half.y;
  const onSide = Math.abs(Math.abs(lx) - hx) < 1e-4;
  const onFrontBack = Math.abs(Math.abs(ly) - hy) < 1e-4;
  if (onSide) return true;
  if (onFrontBack) return Math.abs(lx) >= BANK_MODEL.doorWidth / 2 - 1e-6;
  return false;
}

function angleBetween(fx: number, fy: number, dx: number, dy: number): number {
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return 0;
  const c = (fx * dx + fy * dy) / d;
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

/**
 * What the grab button would take right now. Same function step() uses.
 * Rules: the facing ray picks the nearest pointed-at safe / exterior bank wall within reach
 * (CHARACTER.radius + CHARACTER.reach from the center to the target surface); otherwise the
 * best target inside a GRAB_CONE around the facing (smallest angle). Safes win exact ties over
 * walls, then lower ids. Never through walls/statics; never one's own floor bank.
 */
export function grabCandidate(ctx: SimContext, slot: number): GrabCandidate | null {
  const ch = ctx.state.characters[slot]!;
  if (ch.grab || ch.knockdownTicks > 0) return null;
  const body = ctx.chars[slot]!.body;
  const px = body.x;
  const py = body.y;
  const fx = Math.cos(ch.facing);
  const fy = Math.sin(ch.facing);
  const reach = CHARACTER.radius + CHARACTER.reach;
  const origin = { x: px, y: py };
  const dir = { x: fx, y: fy };
  const cands: Cand[] = [];
  const st = ctx.state;

  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.recovered || l.dormant || l.airborne) continue; // Content 2.0: = !isCarryable(l)
    const lb = ctx.loot[i]!.body;
    if (l.kind === 'bank') {
      const fp = bankFootprint(lb);
      if (pointInOBB(origin, fp)) continue; // on the floor / in the doorway: cannot grab this bank
      const quick = Math.hypot(lb.x - px, lb.y - py);
      if (quick > reach + Math.hypot(BANK_MODEL.half.x, BANK_MODEL.half.y)) continue;
      const c = Math.cos(lb.a);
      const s = Math.sin(lb.a);
      const toLocal = (x: number, y: number): [number, number] => {
        const dx = x - lb.x;
        const dy = y - lb.y;
        return [dx * c + dy * s, -dx * s + dy * c];
      };
      const t = rayOBB(origin, dir, fp, reach);
      let added = false;
      if (t !== null) {
        const ax = px + fx * t;
        const ay = py + fy * t;
        const [lx, ly] = toLocal(ax, ay);
        if (onExteriorWall(lx, ly)) {
          cands.push({ targetId: l.id, part: 'bankWall', ax, ay, pointed: true, dist: t, angle: 0, body: lb });
          added = true;
        }
      }
      if (!added) {
        const q = closestPointOnOBB(origin, fp);
        let [lx, ly] = toLocal(q.x, q.y);
        if (!onExteriorWall(lx, ly)) {
          // door gap: snap to the nearest door jamb corner on that face
          const hw = BANK_MODEL.doorWidth / 2;
          lx = lx >= 0 ? hw : -hw;
        }
        const ax = lb.x + lx * c - ly * s;
        const ay = lb.y + lx * s + ly * c;
        const d = Math.hypot(ax - px, ay - py);
        if (d <= reach) {
          const ang = angleBetween(fx, fy, ax - px, ay - py);
          if (ang <= GRAB_CONE) cands.push({ targetId: l.id, part: 'bankWall', ax, ay, pointed: false, dist: d, angle: ang, body: lb });
        }
      }
    } else {
      const obb = lootOBBOf(l, lb);
      const quick = Math.hypot(lb.x - px, lb.y - py);
      if (quick > reach + Math.hypot(l.half.x, l.half.y)) continue;
      const t = rayOBB(origin, dir, obb, reach);
      if (t !== null && t > 0) {
        cands.push({ targetId: l.id, part: 'safe', ax: px + fx * t, ay: py + fy * t, pointed: true, dist: t, angle: 0, body: lb });
      } else {
        const q = closestPointOnOBB(origin, obb);
        const d = Math.hypot(q.x - px, q.y - py);
        if (d < 1e-6 || d > reach) continue;
        const ang = angleBetween(fx, fy, q.x - px, q.y - py);
        if (ang <= GRAB_CONE) cands.push({ targetId: l.id, part: 'safe', ax: q.x, ay: q.y, pointed: false, dist: d, angle: ang, body: lb });
      }
    }
  }
  if (cands.length === 0) return null;

  cands.sort((a, b) => {
    if (a.pointed !== b.pointed) return a.pointed ? -1 : 1;
    if (a.pointed) {
      if (Math.abs(a.dist - b.dist) > 1e-6) return a.dist - b.dist;
    } else if (Math.abs(a.angle - b.angle) > 1e-6) return a.angle - b.angle;
    if (a.part !== b.part) return a.part === 'safe' ? -1 : 1;
    return a.targetId - b.targetId;
  });

  for (const c of cands) {
    // never through walls: stop just short of the anchor so the target's own surface doesn't count
    const dx = c.ax - px;
    const dy = c.ay - py;
    const d = Math.hypot(dx, dy);
    const k = d > 0.03 ? (d - 0.03) / d : 0;
    if (k > 0 && segmentBlocked(ctx, origin, { x: px + dx * k, y: py + dy * k })) continue;
    const b = c.body;
    const cs = Math.cos(b.a);
    const sn = Math.sin(b.a);
    const rx = c.ax - b.x;
    const ry = c.ay - b.y;
    return {
      targetId: c.targetId,
      part: c.part,
      anchorWorld: { x: c.ax, y: c.ay },
      anchorLocal: { x: rx * cs + ry * sn, y: -rx * sn + ry * cs },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grab / release
// ---------------------------------------------------------------------------

function insertSorted(arr: EntityId[], id: EntityId): void {
  if (arr.includes(id)) return;
  arr.push(id);
  arr.sort((a, b) => a - b);
}

export function doGrab(ctx: SimContext, slot: number, cand: GrabCandidate): void {
  const ch = ctx.state.characters[slot]!;
  const rt = ctx.chars[slot]!;
  const target = lootById(ctx, cand.targetId);
  if (!target) return;
  const tb = target.rt.body;
  const dx = rt.body.x - cand.anchorWorld.x;
  const dy = rt.body.y - cand.anchorWorld.y;
  const dist = Math.hypot(dx, dy);
  // handle direction (anchor -> holder) in the target frame, for the bounded bearing term
  const c = Math.cos(tb.a);
  const s = Math.sin(tb.a);
  let hlx = dist > 1e-6 ? (dx * c + dy * s) / dist : 1;
  let hly = dist > 1e-6 ? (-dx * s + dy * c) / dist : 0;
  if (dist <= 1e-6) {
    const l = Math.hypot(cand.anchorLocal.x, cand.anchorLocal.y);
    if (l > 1e-6) {
      hlx = cand.anchorLocal.x / l;
      hly = cand.anchorLocal.y / l;
    }
  }
  const joint = new GrabJoint(rt.body, tb, cand.anchorLocal.x, cand.anchorLocal.y, Math.max(dist, 0.05), hlx, hly);
  ctx.physics.addJoint(joint);
  rt.joint = joint;
  // A grab that lands during an empty-handed dash ends the burst: the dash (11 m/s, no drag) kept
  // running while holding and yanked the load through the full-mass joint (a small safe shot off
  // at 6.4 m/s, a large one at 3.5 m/s). Speeding up a load is the carry boost's job.
  if (ch.dashTicks > 0) {
    ch.dashTicks = 0;
    const b = rt.body;
    b.noDrag = false;
    const sp = Math.hypot(b.vx - b.fvx, b.vy - b.fvy);
    if (sp > CHARACTER.walkSpeed) {
      const k = CHARACTER.walkSpeed / sp;
      b.vx = b.fvx + (b.vx - b.fvx) * k;
      b.vy = b.fvy + (b.vy - b.fvy) * k;
    }
  }
  ch.grab = { targetId: cand.targetId, part: cand.part, anchorLocal: { ...cand.anchorLocal } };
  insertSorted(target.state.grabbedBy, ch.id);
  target.state.lastHolder = ch.id;
  emit(ctx, { type: 'grab', tick: ctx.state.tick, charId: ch.id, targetId: cand.targetId, part: cand.part });
}

export function doRelease(ctx: SimContext, slot: number, forced: boolean): void {
  const ch = ctx.state.characters[slot]!;
  const rt = ctx.chars[slot]!;
  if (!ch.grab) return;
  const targetId = ch.grab.targetId;
  if (rt.joint) ctx.physics.removeJoint(rt.joint);
  rt.joint = null;
  const target = lootById(ctx, targetId);
  if (target) {
    const i = target.state.grabbedBy.indexOf(ch.id);
    if (i >= 0) target.state.grabbedBy.splice(i, 1);
  }
  ch.grab = null;
  ch.straining = false;
  ch.boostTicks = 0;
  if (forced) rt.grabLatch = true;
  emit(ctx, { type: 'release', tick: ctx.state.tick, charId: ch.id, targetId, forced });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Clamp/validate a raw command (robust against garbage from input or network). */
export function sanitizeCommand(raw: Command | undefined | null): Command {
  if (!raw) return EMPTY_COMMAND;
  let mx = raw.move && finite(raw.move.x) ? raw.move.x : 0;
  let my = raw.move && finite(raw.move.y) ? raw.move.y : 0;
  const l = Math.hypot(mx, my);
  if (l > 1) {
    mx /= l;
    my /= l;
  }
  let aim: Vec2 | null = null;
  if (raw.aim && finite(raw.aim.x) && finite(raw.aim.y) && Math.hypot(raw.aim.x, raw.aim.y) > 1e-6) {
    aim = { x: raw.aim.x, y: raw.aim.y };
  }
  let ping: Command['ping'] = null;
  if (raw.ping && raw.ping.pos && finite(raw.ping.pos.x) && finite(raw.ping.pos.y)) {
    const tid = raw.ping.targetId;
    ping = { pos: { x: raw.ping.pos.x, y: raw.ping.pos.y }, targetId: typeof tid === 'number' && Number.isInteger(tid) ? tid : null };
  }
  const out: Command = { move: { x: mx, y: my }, grab: raw.grab === true, dash: raw.dash === true, aim, ping };
  if (isEmoteId(raw.emote)) out.emote = raw.emote; // taunt request (emotes.ts), only when valid
  return out;
}

function decTimers(ch: CharacterState): void {
  if (ch.knockdownTicks > 0) ch.knockdownTicks--;
  if (ch.protectTicks > 0) ch.protectTicks--;
  if (ch.dashTicks > 0) ch.dashTicks--;
  if (ch.boostTicks > 0) ch.boostTicks--;
  if (ch.dashCooldown > 0) ch.dashCooldown--;
}

function updateFacing(ctx: SimContext, slot: number, cmd: Command): void {
  const ch = ctx.state.characters[slot]!;
  const rt = ctx.chars[slot]!;
  if (ch.grab && rt.joint) {
    const ax = rt.joint.anchorWorldX();
    const ay = rt.joint.anchorWorldY();
    const dx = ax - rt.body.x;
    const dy = ay - rt.body.y;
    if (dx * dx + dy * dy > 1e-8) ch.facing = Math.atan2(dy, dx);
    return;
  }
  if (cmd.aim) {
    ch.facing = Math.atan2(cmd.aim.y, cmd.aim.x);
    return;
  }
  if (Math.hypot(cmd.move.x, cmd.move.y) > 1e-3) ch.facing = Math.atan2(cmd.move.y, cmd.move.x);
}

/**
 * Start a dash (empty hands) or a carry boost (holding loot). Exported for C2 (Content 2.0): the
 * soap item is "a normal dash that leaves a slick", skates modify the burst / boost here.
 */
export function startDash(ctx: SimContext, slot: number): void {
  const ch = ctx.state.characters[slot]!;
  const body = ctx.chars[slot]!.body;
  ch.dashCooldown = DASH.cooldownTicks;
  if (ch.grab) {
    ch.boostTicks = DASH.boostTicks;
    emit(ctx, { type: 'dash', tick: ctx.state.tick, charId: ch.id, carrying: true });
    return;
  }
  ch.dashTicks = DASH.durationTicks;
  let fvx = 0;
  let fvy = 0;
  const f = body.floor;
  if (f && f.enabled && f.motion === 'dynamic') {
    fvx = f.vx - f.w * (body.y - f.y);
    fvy = f.vy + f.w * (body.x - f.x);
  }
  const rt = ctx.chars[slot]!;
  rt.dashDirX = Math.cos(ch.facing);
  rt.dashDirY = Math.sin(ch.facing);
  body.vx = fvx + rt.dashDirX * DASH.speed;
  body.vy = fvy + rt.dashDirY * DASH.speed;
  emit(ctx, { type: 'dash', tick: ctx.state.tick, charId: ch.id, carrying: false });
}

function handlePing(ctx: SimContext, slot: number, ping: NonNullable<Command['ping']>): void {
  const ch = ctx.state.characters[slot]!;
  const rt = ctx.chars[slot]!;
  const st = ctx.state;
  if (st.tick - rt.lastPingTick < PING.cooldownTicks) return;
  rt.lastPingTick = st.tick;
  let targetId: EntityId | null = null;
  if (ping.targetId !== null) {
    const t = lootById(ctx, ping.targetId);
    if (t && !t.state.recovered) targetId = ping.targetId;
  }
  const kind = targetId !== null ? 'grabTogether' : 'goHere';
  // one active ping per character: replace
  st.pings = st.pings.filter((p) => p.charId !== ch.id);
  const id = ctx.nextPingId++;
  const pos = { x: ping.pos.x, y: ping.pos.y };
  st.pings.push({ id, team: ch.team, charId: ch.id, pos, targetId, kind, expiresTick: st.tick + PING.durationTicks });
  emit(ctx, { type: 'ping', tick: st.tick, pingId: id, team: ch.team, charId: ch.id, pos: { ...pos }, targetId, kind });
}

/** Phase 1 of a tick: read commands (edge/latch), pings, grab/release, dash. */
export function processCommands(ctx: SimContext, commands: ReadonlyArray<Command | undefined>): void {
  const st = ctx.state;
  // prune expired pings
  if (st.pings.length) st.pings = st.pings.filter((p) => p.expiresTick > st.tick);
  for (let slot = 0; slot < st.characters.length; slot++) {
    const ch = st.characters[slot]!;
    const rt = ctx.chars[slot]!;
    const raw = sanitizeCommand(commands[slot]);
    decTimers(ch);
    const knocked = ch.knockdownTicks > 0;
    const cmd = knocked ? EMPTY_COMMAND : raw;
    rt.cmd = cmd;
    if (!raw.grab) rt.grabLatch = false;
    const risingDash = raw.dash && !rt.prevDash;
    rt.prevDash = raw.dash;
    ch.moveIntent = { x: cmd.move.x, y: cmd.move.y };
    stepEmote(ctx, slot, cmd, risingDash); // taunts: expire / cancel / start (cosmetic only)
    if (knocked) {
      ch.straining = false;
      continue;
    }
    updateFacing(ctx, slot, cmd);
    // grab is a level signal
    if (ch.grab && !cmd.grab) doRelease(ctx, slot, false);
    else if (!ch.grab && cmd.grab && !rt.grabLatch) {
      const cand = grabCandidate(ctx, slot);
      if (cand) {
        doGrab(ctx, slot, cand);
        updateFacing(ctx, slot, cmd);
      }
    }
    // Content 2.0 (C0 skeleton, R2): empty-handed with an item, the dash edge uses the item (C2)
    if (risingDash && ch.item && !ch.grab && ctx.content) ctx.content.items.onDash(slot);
    else if (risingDash && ch.dashCooldown === 0) startDash(ctx, slot);
    if (cmd.ping) handlePing(ctx, slot, cmd.ping);
    // straining: pulling an anchored target with a meaningful stick input
    let straining = false;
    if (ch.grab) {
      const t = lootById(ctx, ch.grab.targetId);
      straining = !!t && t.state.anchored && Math.hypot(cmd.move.x, cmd.move.y) >= 0.5;
    }
    ch.straining = straining;
  }
}

// ---------------------------------------------------------------------------
// Pre-physics preparation
// ---------------------------------------------------------------------------

/** Set masses, riders, drive forces and joint rest lengths for this tick's physics. */
export function prepareBodies(ctx: SimContext): void {
  const st = ctx.state;
  // bank effective mass = building + cargo (loaded safes) — doc §5 "더 실으면 운반 무게도 늘어난다"
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.kind !== 'bank' || l.recovered) continue;
    let m = ctx.loot[i]!.baseMass;
    for (const sid of l.loadedSafes) {
      const s = lootById(ctx, sid);
      if (s) m += s.rt.baseMass;
    }
    ctx.loot[i]!.body.setMass(m, boxInertia(m, BANK_MODEL.half.x, BANK_MODEL.half.y));
  }
  // riders (moving floor)
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    const b = ctx.loot[i]!.body;
    if (l.kind === 'bank' || l.recovered || b.motion !== 'dynamic') {
      b.floor = null;
      continue;
    }
    const f = floorAt(ctx, b.x, b.y);
    b.floor = f ? lootById(ctx, f.id)!.rt.body : null;
  }
  for (let slot = 0; slot < st.characters.length; slot++) {
    const ch = st.characters[slot]!;
    const rt = ctx.chars[slot]!;
    const b = rt.body;
    const f = floorAt(ctx, b.x, b.y);
    b.floor = f ? lootById(ctx, f.id)!.rt.body : null;
    const dashing = ch.dashTicks > 0;
    b.noDrag = dashing;
    if (ch.knockdownTicks > 0 || dashing) {
      b.fx = 0;
      b.fy = 0;
    } else {
      const mult = ch.boostTicks > 0 && ch.grab ? DASH.boostMultiplier : 1;
      b.fx = CHARACTER.driveForce * mult * rt.cmd.move.x;
      b.fy = CHARACTER.driveForce * mult * rt.cmd.move.y;
    }
    const j = rt.joint;
    if (j) {
      // Pushing = stick pointing toward the anchor. Like a cart: the raccoon pushes along the
      // push line (holder -> anchor) and the bounded steering assist turns the target toward
      // the stick. (A sideways shove at the far end would torque it the wrong way.)
      j.pushHeading = null;
      const mx = rt.cmd.move.x;
      const my = rt.cmd.move.y;
      const ml = Math.hypot(mx, my);
      let pushing = false;
      if (ml >= 0.3 && ch.knockdownTicks === 0 && !dashing) {
        const ax = j.anchorWorldX() - b.x;
        const ay = j.anchorWorldY() - b.y;
        const al = Math.hypot(ax, ay);
        const tgt = j.targetBody;
        const cosErr = al > 1e-6 ? (mx * ax + my * ay) / (ml * al) : -1;
        if (cosErr > (j.pushing ? PUSH_LEAVE_COS : PUSH_ENTER_COS) && tgt.motion === 'dynamic') {
          pushing = true;
          j.pushHeading = Math.atan2(my, mx);
          // drive along the grip's handle line (world), the line the steering assist turns
          // toward the stick: the instantaneous holder->anchor vector drifts off it whenever the
          // holder is shoved off its line (a co-hauler's shoulder), which pushed the load sideways
          // forever while the steering reported "aligned"
          const cs = Math.cos(tgt.a);
          const sn = Math.sin(tgt.a);
          const px = -(j.hlx * cs - j.hly * sn);
          const py = -(j.hlx * sn + j.hly * cs);
          const cosH = (mx * px + my * py) / ml;
          const mag = Math.hypot(b.fx, b.fy) * (0.5 + 0.5 * cosH);
          b.fx = px * mag;
          b.fy = py * mag;
        }
      }
      j.pushing = pushing;
      const step = GRAB_SETTLE_SPEED * DT;
      if (j.rest > CHARACTER.holdDistance) j.rest = Math.max(CHARACTER.holdDistance, j.rest - step);
      else if (j.rest < CHARACTER.holdDistance) j.rest = Math.min(CHARACTER.holdDistance, j.rest + step);
    }
  }
  // Yaw grip of a hauled bank: while held and nobody pushes it, the bank resists turning. With the
  // plain drag a sideways force at a 4 m grip swung the bank (and with it the grip point and the
  // hauler) ~3x more across than along: a bank pulled at 60 degrees dragged its hauler 80 degrees.
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (l.kind !== 'bank') continue;
    const body = ctx.loot[i]!.body;
    let extra = 0;
    if (l.grabbedBy.length > 0 && body.motion === 'dynamic') {
      extra = BANK_PULL_YAW_DRAG;
      for (let s = 0; s < ctx.chars.length; s++) {
        const jj = ctx.chars[s]!.joint;
        if (jj && jj.targetBody === body && jj.pushHeading !== null) extra = 0;
      }
    }
    body.yawDragExtra = extra;
  }
}

// ---------------------------------------------------------------------------
// Dash hits (checked after every physics substep)
// ---------------------------------------------------------------------------

/** cos of DASH.hitConeHalfAngle (forward cone a dash can land in). */
const DASH_HIT_COS = Math.cos(DASH.hitConeHalfAngle);
/**
 * The attacker must not be moving away from the victim (floor-relative speed along the contact
 * normal, m/s). Slightly negative so a dash stopped dead against a pinned victim still lands.
 */
const DASH_HIT_MIN_CLOSING = -0.25;

interface DashHit {
  att: number;
  vic: number;
  /** Unit normal attacker -> victim. */
  nx: number;
  ny: number;
  /** Victim could be knocked down (opponent, not protected, not already down) - pre-resolution. */
  vulnerable: boolean;
  /** Both dashed into each other this substep. */
  clash: boolean;
}

/**
 * Resolve dash hits after a physics substep. Order-independent by construction:
 *   1. every dashing character picks at most one target from the pre-resolution state - the
 *      nearest character in touch range that lies inside its forward cone (DASH.hitConeHalfAngle
 *      around the dash heading) and that it is not moving away from (ties -> lower slot);
 *   2. mutual picks are a head-on clash: both bounce apart, nobody is knocked down;
 *   3. all other hits are applied together: every attacker's burst ends first, then victims are
 *      shoved (teammates / protected) or knocked down (vulnerable opponents, doc §7/§8).
 * So a symmetric clash never depends on roster slot order (doc §7 equal abilities).
 */
export function checkDashHits(ctx: SimContext): void {
  const st = ctx.state;
  const n = st.characters.length;
  const reachSq = (2 * CHARACTER.radius + DASH_HIT_GAP) ** 2;
  let hits: DashHit[] | null = null;
  for (let i = 0; i < n; i++) {
    const att = st.characters[i]!;
    if (att.dashTicks <= 0) continue;
    const rt = ctx.chars[i]!;
    const ab = rt.body;
    const relVx = ab.vx - ab.fvx;
    const relVy = ab.vy - ab.fvy;
    let best = -1;
    let bestD2 = Infinity;
    let bnx = 0;
    let bny = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const vb = ctx.chars[j]!.body;
      const dx = vb.x - ab.x;
      const dy = vb.y - ab.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > reachSq || d2 >= bestD2) continue;
      const d = Math.sqrt(d2);
      // coincident centres (degenerate): treat the victim as straight ahead
      const nx = d > 1e-6 ? dx / d : rt.dashDirX;
      const ny = d > 1e-6 ? dy / d : rt.dashDirY;
      if (nx * rt.dashDirX + ny * rt.dashDirY < DASH_HIT_COS) continue; // not in front
      if (relVx * nx + relVy * ny < DASH_HIT_MIN_CLOSING) continue; // moving away
      best = j;
      bestD2 = d2;
      bnx = nx;
      bny = ny;
    }
    if (best < 0) continue;
    const victim = st.characters[best]!;
    hits ??= [];
    hits.push({
      att: i,
      vic: best,
      nx: bnx,
      ny: bny,
      vulnerable: victim.team !== att.team && victim.protectTicks === 0 && victim.knockdownTicks === 0,
      clash: false,
    });
  }
  if (!hits) return;
  for (const h of hits) {
    for (const o of hits) {
      if (o.att === h.vic && o.vic === h.att) h.clash = true;
    }
  }
  // (a) every attacker's burst ends on the body it hit
  for (const h of hits) {
    const ch = st.characters[h.att]!;
    const ab = ctx.chars[h.att]!.body;
    ch.dashTicks = 0;
    ab.noDrag = false;
    if (h.clash) {
      // head-on: bounce straight back (relative to the floor under it)
      ab.vx = ab.fvx - h.nx * DASH.clashBounceSpeed;
      ab.vy = ab.fvy - h.ny * DASH.clashBounceSpeed;
    } else {
      ab.vx *= 0.3;
      ab.vy *= 0.3;
    }
  }
  // (b) victims: shoves add up; knockdowns take the (capped) sum of their knockback directions
  const knock = new Map<number, { x: number; y: number }>();
  for (const h of hits) {
    if (h.clash) continue;
    const vb = ctx.chars[h.vic]!.body;
    if (h.vulnerable) {
      const k = knock.get(h.vic);
      if (k) {
        k.x += h.nx;
        k.y += h.ny;
      } else knock.set(h.vic, { x: h.nx, y: h.ny });
    } else {
      // teammates and protected opponents: a gentle shove only (doc §7)
      vb.vx += h.nx * DASH.teamShoveSpeed;
      vb.vy += h.ny * DASH.teamShoveSpeed;
    }
  }
  // Content 2.0: the knocking attacker (lowest slot among this victim's hits) gets the spill credit
  let spills: Map<number, { att: number; value: number }> | null = null;
  for (let j = 0; j < n; j++) {
    const k = knock.get(j);
    if (!k) continue;
    const l = Math.hypot(k.x, k.y);
    const s = l > 1 ? DASH.knockbackSpeed / l : DASH.knockbackSpeed;
    let att = -1;
    for (const h of hits) if (h.vic === j && !h.clash && h.vulnerable && (att < 0 || h.att < att)) att = h.att;
    const spilled = knockDown(ctx, j, k.x * s, k.y * s, 'dash', att >= 0 ? st.characters[att]!.id : null);
    if (spilled > 0) (spills ??= new Map()).set(j, { att, value: spilled });
  }
  for (const h of hits) {
    const knockdown = !h.clash && h.vulnerable;
    const sp = knockdown ? spills?.get(h.vic) : undefined;
    emit(ctx, {
      type: 'dashHit',
      tick: st.tick,
      attackerId: st.characters[h.att]!.id,
      victimId: st.characters[h.vic]!.id,
      knockdown,
      ...(sp && sp.att === h.att ? { spilled: sp.value } : {}),
    });
  }
}

/**
 * THE knockdown (doc §7/§8, Content 2.0 chokepoint): forced release, knockdown + protection timers,
 * dash / boost / strain cleared, drive zeroed, knockback velocity (kvx, kvy) relative to the floor
 * under the victim. Then, in v2 only, `ctx.content.onKnockdown` spills the bag (C1; not for
 * 'self') and drops the held item (C2). Returns the spilled value (0 in classic).
 *
 * Every knockdown source calls this — dash hits, police tackles, the hammer (C2), skate crashes
 * ('self', C2), pile drivers / catapult landings (C4), gold-safe landings (C5) — so spill and item
 * drop never need per-source wiring. The caller checks vulnerability (opponent, not protected,
 * not already down). Spill events (`bagSpilled`, `coinSpawn`) precede the caller's own event
 * (`dashHit`, `policeTackle`, `itemHit`, ...) in the log of the same tick.
 */
export function knockDown(
  ctx: SimContext,
  slot: number,
  kvx: number,
  kvy: number,
  cause: KnockdownCause,
  byId: EntityId | null,
  ticks: number = KNOCKDOWN_TICKS,
): number {
  const victim = ctx.state.characters[slot]!;
  const vrt = ctx.chars[slot]!;
  const vb = vrt.body;
  cancelEmoteOnKnockdown(ctx, slot, cause, byId); // a taunting victim stops (cause 'hit')
  if (victim.grab) doRelease(ctx, slot, true);
  vrt.grabLatch = true;
  victim.knockdownTicks = ticks;
  victim.protectTicks = PROTECT_TICKS;
  victim.dashTicks = 0;
  victim.boostTicks = 0;
  victim.straining = false;
  vb.noDrag = false;
  vb.fx = 0;
  vb.fy = 0;
  vb.vx = vb.fvx + kvx;
  vb.vy = vb.fvy + kvy;
  return ctx.content ? ctx.content.onKnockdown(victim.id, cause, byId, Math.atan2(kvy, kvx)) : 0;
}

// ---------------------------------------------------------------------------
// Post-physics: grip breaks and unanchoring
// ---------------------------------------------------------------------------

export function handleGripBreaks(ctx: SimContext): void {
  const st = ctx.state;
  for (let slot = 0; slot < st.characters.length; slot++) {
    const rt = ctx.chars[slot]!;
    if (rt.joint && rt.joint.broke) {
      doRelease(ctx, slot, true);
      st.characters[slot]!.protectTicks = Math.max(st.characters[slot]!.protectTicks, PROTECT_TICKS);
    }
  }
}

/** Make a loot item free. Interior safes leave their weld; banks become dynamic. */
export function setLootFree(ctx: SimContext, idx: number): void {
  const l = ctx.state.loot[idx]!;
  const b = ctx.loot[idx]!.body;
  l.anchored = false;
  l.unanchorProgress = 1;
  if (b.motion === 'kinematic') {
    // keep the floor velocity it had while welded (continuity)
    b.weldParent = null;
  }
  b.motion = 'dynamic';
}

/** Anchor a loot item where it stands: welded to the bank floor under it, else static. */
export function setLootAnchored(ctx: SimContext, idx: number): void {
  const l = ctx.state.loot[idx]!;
  const b = ctx.loot[idx]!.body;
  l.anchored = true;
  l.unanchorProgress = 0;
  b.vx = 0;
  b.vy = 0;
  b.w = 0;
  if (l.kind !== 'bank') {
    const f = floorAt(ctx, b.x, b.y);
    if (f) {
      const fb = lootById(ctx, f.id)!.rt.body;
      const c = Math.cos(fb.a);
      const s = Math.sin(fb.a);
      const dx = b.x - fb.x;
      const dy = b.y - fb.y;
      b.weldParent = fb;
      b.weldLx = dx * c + dy * s;
      b.weldLy = -dx * s + dy * c;
      b.weldLa = b.a - fb.a;
      b.motion = 'kinematic';
      return;
    }
  }
  b.weldParent = null;
  b.motion = 'static';
}

export function updateUnanchor(ctx: SimContext): void {
  const st = ctx.state;
  for (let i = 0; i < st.loot.length; i++) {
    const l = st.loot[i]!;
    if (!l.anchored || l.recovered || l.grabbedBy.length === 0) continue;
    let count = 0;
    let team: TeamId | null = null;
    let mixed = false;
    for (const cid of l.grabbedBy) {
      const ch = st.characters[cid - 1];
      if (!ch || !ch.straining || !ch.grab || ch.grab.targetId !== l.id) continue;
      count++;
      if (team === null) team = ch.team;
      else if (team !== ch.team) mixed = true;
    }
    if (count === 0) continue;
    // Content 2.0: a prop uproots in PROP_SPECS[variant].uprootTicks (ATM 3 s, 돈나무 / gold safe 2.5 s)
    const uproot = l.variant ? PROP_SPECS[l.variant].uprootTicks : UNANCHOR_TICKS[l.kind];
    l.unanchorProgress = Math.min(1, l.unanchorProgress + count / uproot);
    if (l.unanchorProgress >= 1 - 1e-9) {
      setLootFree(ctx, i);
      for (const cid of l.grabbedBy) {
        const ch = st.characters[cid - 1];
        if (ch) ch.straining = false;
      }
      emit(ctx, { type: 'unanchored', tick: st.tick, lootId: l.id, kind: l.kind, byTeam: mixed ? null : team });
    }
  }
}

/** True if the safe OBB lies completely on the bank floor. */
export function safeFullyOnFloor(safe: OBB, bankBody: Body): boolean {
  return obbInsideOBB(safe, bankFloor(bankBody), 1e-6);
}
