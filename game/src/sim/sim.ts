/**
 * Simulation: the single authority for a match (doc §16 통신 준비: 단일 권한).
 *
 * Fixed 60 Hz steps; identical setups + identical command streams produce identical states.
 * Per-tick order (doc §8 "같은 시각의 판정 순서", docs/ARCHITECTURE.md):
 *   1. commands (dash edge, grab latch), pings, grab/release, dash
 *   2. physics (drive, grab joints, drag, collisions, moving floor), fence breaking,
 *      unanchor progress, anti-pin / arena clamp / NaN guard
 *   3. loading update (floorOf, loadedIn, loadedSafes, estimatedValue)
 *   4. recovery dwell -> settle all completions together -> remove recovered, eject riders
 *   5. bank body count -> final countdown (once)
 *   6. end check (time / all recovered / decided)
 *   7. police (rules.police only): alarms, dispatch, cars — skipped once the match is over.
 *      Officer brains run right before physics (after commands) and their lunges / dash stuns
 *      resolve after every substep, after character dash hits.
 */
import { BANK_MODEL, CHARACTER, DT, FENCE, UNSTUCK } from './config';
import { emit, lootById, type SimContext } from './context';
import {
  bankFloor,
  bankFootprint,
  bankWalls,
  checkDashHits,
  doRelease,
  grabCandidate,
  handleGripBreaks,
  lootOBBOf,
  onFloor,
  prepareBodies,
  processCommands,
  setLootAnchored,
  setLootFree,
  updateUnanchor,
} from './actions';
import { isFiniteVec } from './math';
import { CAT_BANK, PhysicsWorld, type Body, type PhysicsHooks } from './physics';
import { PoliceSystem, policeEntriesFor } from './police';
import { isFreeCircle, isFreeOBB, lineOfSight, spiralSearch, staticToOBB } from './queries';
import { checkEnd, removeRecovered, settle, updateLoading, updateRecovery, updateRemaining, updateTimer } from './rules';
import { buildContext } from './world';
import type {
  CharacterState,
  Command,
  EntityId,
  GrabCandidate,
  LayoutDef,
  LootState,
  MatchSetup,
  OBB,
  PoliceEntryDef,
  RuleConfig,
  SimEvent,
  SimState,
  Vec2,
} from './types';

/** Minimum ticks between two 'bump' events of the same pair. */
const BUMP_COOLDOWN_TICKS = 20;
/** Max distance a body may travel per substep before more substeps are used (m). */
const MAX_SUBSTEP_TRAVEL = 0.1;
const MIN_SUBSTEPS = 2;
const MAX_SUBSTEPS = 8;

/**
 * Test / tutorial-only controls. They bypass game rules (no unanchor time, no travel) but keep
 * every internal cache consistent (physics bodies, welds, grab joints, broadphase, NaN-guard
 * poses). Derived loading/recovery state is recomputed — with its events — on the next step();
 * releases caused by a teleport are delivered with the next step's events.
 * Never call these from match code: scores still only change through real settlement.
 */
export interface SimDebugApi {
  /**
   * Move a character or loot item. Teleporting a bank carries everything on its floor
   * (characters and safes whose center is over it) rigidly with it. Holders of a teleported
   * item (and a teleported character's own grab) are released. Velocities are zeroed.
   */
  teleport(id: EntityId, pos: Vec2, angle?: number): void;
  /** Anchor (static, or welded to the bank floor under it) or free a loot item instantly. */
  setAnchored(id: EntityId, anchored: boolean): void;
  /** Set the linear velocity of a character or a free (unanchored) loot item. */
  setVelocity(id: EntityId, vel: Vec2): void;
}

export class Simulation {
  readonly setup: MatchSetup;
  readonly rules: RuleConfig;
  readonly layout: LayoutDef;
  readonly state: SimState;
  readonly eventLog: SimEvent[] = [];
  /** Test / tutorial-only controls (see SimDebugApi). */
  readonly debug: SimDebugApi;

  private readonly ctx: SimContext;
  private readonly hooks: PhysicsHooks;
  private readonly bumpTicks = new Map<number, number>();

  constructor(setup: MatchSetup) {
    this.ctx = buildContext(setup);
    this.setup = setup;
    this.rules = this.ctx.rules;
    this.layout = setup.layout;
    this.state = this.ctx.state;
    this.hooks = {
      onFenceContact: (fi, bank, approach, px, py) => this.onFenceContact(fi, bank, approach, px, py),
      onImpact: (a, b, approach) => this.onImpact(a, b, approach),
      afterSubstep: () => {
        checkDashHits(this.ctx);
        this.ctx.police?.afterSubstep();
      },
    };
    this.debug = {
      teleport: (id, pos, angle) => this.debugTeleport(id, pos, angle),
      setAnchored: (id, anchored) => this.debugSetAnchored(id, anchored),
      setVelocity: (id, vel) => this.debugSetVelocity(id, vel),
    };
    if (this.rules.police) this.ctx.police = new PoliceSystem(this.ctx);
    // initial derived state (interior safes loaded, estimates) without events
    updateLoading(this.ctx);
    this.ctx.events = [];
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  /** Advance exactly one tick. Returns this tick's events ([] once the match is over). */
  step(commands: ReadonlyArray<Command | undefined>): SimEvent[] {
    const ctx = this.ctx;
    const st = this.state;
    if (st.over) return [];
    ctx.events = [];
    if (!ctx.started) {
      ctx.started = true;
      emit(ctx, { type: 'matchStart', tick: st.tick });
    }
    if (ctx.pendingEvents.length) {
      for (const e of ctx.pendingEvents) ctx.events.push(e);
      ctx.pendingEvents = [];
    }
    st.tick++;

    // 1. commands
    processCommands(ctx, commands);

    // 2. physics + fences + unanchor + stability (police brains drive officers like commands)
    prepareBodies(ctx);
    ctx.police?.prePhysics();
    for (const f of ctx.fences) {
      f.touched = false;
      f.maxApproach = 0;
    }
    ctx.physics.step(DT, this.substepCount(), this.hooks);
    handleGripBreaks(ctx);
    this.updateFences();
    updateUnanchor(ctx);
    this.stabilize();
    this.syncState();
    ctx.police?.afterPhysics();

    // 3. loading
    updateLoading(ctx);

    // 4. recovery + settlement (all completions of this tick together)
    const completed = updateRecovery(ctx);
    if (completed.length) {
      const settled = settle(ctx, completed);
      removeRecovered(ctx, settled);
      if (settled.length) updateLoading(ctx);
    }
    updateRemaining(ctx);

    // 5. bank bodies -> final countdown
    updateTimer(ctx);

    // 6. end check
    checkEnd(ctx);

    // 7. police: alarms, dispatch, cars (owner addition; never after the end — officers freeze)
    if (ctx.police) {
      if (st.over) ctx.police.freeze();
      else ctx.police.postTick();
    }

    for (const e of ctx.events) this.eventLog.push(e);
    return ctx.events;
  }

  private substepCount(): number {
    let maxTravel = 0;
    for (const b of this.ctx.physics.bodies) {
      if (!b.enabled || b.motion !== 'dynamic') continue;
      const ext = b.cat === CAT_BANK ? Math.hypot(BANK_MODEL.half.x, BANK_MODEL.half.y) : 1;
      const v = Math.hypot(b.vx, b.vy) + Math.abs(b.w) * ext;
      if (v > maxTravel) maxTravel = v;
    }
    const n = Math.ceil((maxTravel * DT) / MAX_SUBSTEP_TRAVEL);
    return Math.min(MAX_SUBSTEPS, Math.max(MIN_SUBSTEPS, n));
  }

  // -------------------------------------------------------------------------
  // Physics hooks
  // -------------------------------------------------------------------------

  private onFenceContact(fi: number, bank: Body, approach: number, px: number, py: number): void {
    const f = this.ctx.fences[fi];
    if (!f || !f.shape.enabled) return;
    f.touched = true;
    if (approach > f.maxApproach) {
      f.maxApproach = approach;
      f.bankId = bank.entityId;
      f.px = px;
      f.py = py;
    }
    if (f.bankId < 0) f.bankId = bank.entityId;
    if (approach > FENCE.instantBreakSpeed) this.breakFence(fi, bank.entityId, px, py);
  }

  private breakFence(fi: number, bankId: EntityId, px: number, py: number): void {
    const f = this.ctx.fences[fi]!;
    const fs = this.state.fences[fi]!;
    if (fs.broken) return;
    f.shape.enabled = false;
    fs.broken = true;
    fs.brokenTick = this.state.tick;
    emit(this.ctx, { type: 'fenceBroken', tick: this.state.tick, fenceId: fs.id, bankId, pos: { x: px, y: py } });
  }

  private updateFences(): void {
    const ctx = this.ctx;
    for (let i = 0; i < ctx.fences.length; i++) {
      const f = ctx.fences[i]!;
      if (this.state.fences[i]!.broken) continue;
      if (f.touched && f.maxApproach > FENCE.minPressSpeed) {
        f.pressTicks++;
        if (f.pressTicks >= FENCE.pressTicks) this.breakFence(i, f.bankId, f.px, f.py);
      } else f.pressTicks = 0;
    }
  }

  private onImpact(a: Body, b: Body | null, approach: number): void {
    const aId = a.entityId;
    const bId = b ? b.entityId : 0;
    const key = Math.min(aId, bId) * 100003 + Math.max(aId, bId);
    const last = this.bumpTicks.get(key);
    const tick = this.state.tick;
    if (last !== undefined && tick - last < BUMP_COOLDOWN_TICKS) return;
    this.bumpTicks.set(key, tick);
    const ma = a.mass;
    const mb = b && b.motion === 'dynamic' ? b.mass : Infinity;
    const reduced = mb === Infinity ? ma : (ma * mb) / (ma + mb);
    emit(this.ctx, { type: 'bump', tick, aId, bId, impulse: approach * reduced });
  }

  // -------------------------------------------------------------------------
  // Stability: anti-pin, arena clamp, NaN guard (doc §8 교착, §16 물체 소실·영구 끼임)
  // -------------------------------------------------------------------------

  private stabilize(): void {
    const ctx = this.ctx;
    const st = this.state;
    const size = this.layout.size;
    // NaN guard + clamp
    for (let i = 0; i < st.characters.length; i++) {
      const rt = ctx.chars[i]!;
      const b = rt.body;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
        b.x = rt.lastX;
        b.y = rt.lastY;
        b.vx = 0;
        b.vy = 0;
      }
      this.clampBody(b, CHARACTER.radius, size);
    }
    for (let i = 0; i < st.loot.length; i++) {
      const l = st.loot[i]!;
      const rt = ctx.loot[i]!;
      const b = rt.body;
      if (l.recovered) continue;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.a) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy) || !Number.isFinite(b.w)) {
        b.x = rt.lastX;
        b.y = rt.lastY;
        b.a = rt.lastA;
        b.vx = 0;
        b.vy = 0;
        b.w = 0;
        if (b.motion === 'kinematic') PhysicsWorld.syncWeld(b);
      }
      if (b.motion === 'dynamic') this.clampBody(b, Math.min(l.half.x, l.half.y), size);
    }
    // anti-pin: characters
    const limit = UNSTUCK.penetration;
    for (let i = 0; i < st.characters.length; i++) {
      const rt = ctx.chars[i]!;
      const b = rt.body;
      rt.stuckTicks = b.maxPen > limit ? rt.stuckTicks + 1 : 0;
      if (rt.stuckTicks >= UNSTUCK.ticks) {
        rt.stuckTicks = 0;
        const id = st.characters[i]!.id;
        const spot = spiralSearch({ x: b.x, y: b.y }, (p) => isFreeCircle(ctx, p, CHARACTER.radius, { characters: true, ignoreCharId: id }), 15, 0.25);
        if (spot) {
          b.x = spot.x;
          b.y = spot.y;
          b.vx = 0;
          b.vy = 0;
          b.updateShapes(0);
          emit(ctx, { type: 'unstuck', tick: st.tick, entityId: id, pos: { ...spot } });
        }
      }
    }
    // anti-pin: free safes
    for (let i = 0; i < st.loot.length; i++) {
      const l = st.loot[i]!;
      const rt = ctx.loot[i]!;
      const b = rt.body;
      if (l.kind === 'bank' || l.recovered || b.motion !== 'dynamic') {
        rt.stuckTicks = 0;
        continue;
      }
      rt.stuckTicks = b.maxPen > limit ? rt.stuckTicks + 1 : 0;
      if (rt.stuckTicks >= UNSTUCK.ticks) {
        rt.stuckTicks = 0;
        const half = l.half;
        const a = b.a;
        const spot = spiralSearch(
          { x: b.x, y: b.y },
          (p) => isFreeOBB(ctx, { center: p, half, angle: a }, { characters: true, ignoreLootId: l.id }),
          15,
          0.25,
        );
        if (spot) {
          b.x = spot.x;
          b.y = spot.y;
          b.vx = 0;
          b.vy = 0;
          b.w = 0;
          b.updateShapes(0);
          emit(ctx, { type: 'unstuck', tick: st.tick, entityId: l.id, pos: { ...spot } });
        }
      }
    }
    // remember valid poses
    for (const rt of ctx.chars) {
      rt.lastX = rt.body.x;
      rt.lastY = rt.body.y;
    }
    for (const rt of ctx.loot) {
      rt.lastX = rt.body.x;
      rt.lastY = rt.body.y;
      rt.lastA = rt.body.a;
    }
  }

  private clampBody(b: Body, margin: number, size: Vec2): void {
    const m = Math.min(margin, size.x / 2, size.y / 2);
    if (b.x < m) {
      b.x = m;
      if (b.vx < 0) b.vx = 0;
    } else if (b.x > size.x - m) {
      b.x = size.x - m;
      if (b.vx > 0) b.vx = 0;
    }
    if (b.y < m) {
      b.y = m;
      if (b.vy < 0) b.vy = 0;
    } else if (b.y > size.y - m) {
      b.y = size.y - m;
      if (b.vy > 0) b.vy = 0;
    }
  }

  /** Copy body poses/velocities into the public state. */
  private syncState(): void {
    const ctx = this.ctx;
    const st = this.state;
    for (let i = 0; i < st.characters.length; i++) {
      const ch = st.characters[i]!;
      const b = ctx.chars[i]!.body;
      ch.pos.x = b.x;
      ch.pos.y = b.y;
      ch.vel.x = b.vx;
      ch.vel.y = b.vy;
    }
    for (let i = 0; i < st.loot.length; i++) {
      const l = st.loot[i]!;
      if (l.recovered) continue;
      const b = ctx.loot[i]!.body;
      l.pos.x = b.x;
      l.pos.y = b.y;
      l.angle = b.a;
      l.vel.x = b.vx;
      l.vel.y = b.vy;
      l.angVel = b.w;
    }
  }

  // -------------------------------------------------------------------------
  // Queries (public API per docs/ARCHITECTURE.md)
  // -------------------------------------------------------------------------

  /** What the grab button would take right now (same logic step() uses). */
  getGrabCandidate(charId: EntityId): GrabCandidate | null {
    const slot = charId - 1;
    if (slot < 0 || slot >= this.state.characters.length) return null;
    return grabCandidate(this.ctx, slot);
  }

  getLoot(id: EntityId): LootState | undefined {
    return lootById(this.ctx, id)?.state;
  }

  getCharacter(id: EntityId): CharacterState | undefined {
    return this.state.characters[id - 1];
  }

  characterBySlot(slot: number): CharacterState {
    const c = this.state.characters[slot];
    if (!c) throw new Error(`no character in slot ${slot}`);
    return c;
  }

  /** Safes: body OBB. Banks: outer footprint (the marked floor range used for recovery). */
  lootOBB(id: EntityId): OBB {
    const r = this.requireLoot(id);
    return r.state.kind === 'bank' ? bankFootprint(r.rt.body) : lootOBBOf(r.state, r.rt.body);
  }

  bankWallOBBs(bankId: EntityId): OBB[] {
    return bankWalls(this.requireBank(bankId).rt.body);
  }

  bankFloorOBB(bankId: EntityId): OBB {
    return bankFloor(this.requireBank(bankId).rt.body);
  }

  isOnBankFloor(p: Vec2, bankId: EntityId): boolean {
    const r = this.requireBank(bankId);
    return !r.state.recovered && onFloor(r.rt.body, p.x, p.y);
  }

  lineOfSight(a: Vec2, b: Vec2): boolean {
    return lineOfSight(this.ctx, a, b);
  }

  isFree(p: Vec2, radius: number): boolean {
    return isFreeCircle(this.ctx, p, radius);
  }

  /** Boundary walls + layout static boxes + vans (circles: staticCircles(); fences: state.fences). */
  staticOBBs(): OBB[] {
    return this.ctx.physics.statics.filter((s) => s.type === 0 && s.fenceIndex < 0).map(staticToOBB);
  }

  staticCircles(): { center: Vec2; radius: number }[] {
    return this.ctx.physics.statics.filter((s) => s.type === 1).map((s) => ({ center: { x: s.x, y: s.y }, radius: s.r }));
  }

  /**
   * Police car entry points (layout.policeEntries, or the derived north/south edge middles).
   * PoliceCarState.entryIndex indexes this list.
   */
  policeEntries(): PoliceEntryDef[] {
    return this.ctx.police ? this.ctx.police.entries.map((e) => ({ from: { ...e.from }, park: { ...e.park }, angle: e.angle })) : policeEntriesFor(this.layout);
  }

  /** Ticks left until endTick (Infinity without a time limit). */
  ticksLeft(): number {
    return Math.max(0, this.state.endTick - this.state.tick);
  }

  // -------------------------------------------------------------------------
  // Debug (test / tutorial only)
  // -------------------------------------------------------------------------

  private requireLoot(id: EntityId): { state: LootState; rt: SimContext['loot'][number] } {
    const r = lootById(this.ctx, id);
    if (!r) throw new Error(`unknown loot id ${id}`);
    return r;
  }

  private requireBank(id: EntityId): { state: LootState; rt: SimContext['loot'][number] } {
    const r = this.requireLoot(id);
    if (r.state.kind !== 'bank') throw new Error(`loot ${id} is not a bank`);
    return r;
  }

  /** Run fn with ctx.events redirected to pendingEvents (delivered by the next step). */
  private deferEvents(fn: () => void): void {
    const ctx = this.ctx;
    const saved = ctx.events;
    ctx.events = ctx.pendingEvents;
    try {
      fn();
    } finally {
      ctx.pendingEvents = ctx.events;
      ctx.events = saved;
    }
  }

  private releaseHoldersOf(id: EntityId): void {
    const r = lootById(this.ctx, id);
    if (!r) return;
    for (const cid of [...r.state.grabbedBy]) doRelease(this.ctx, cid - 1, false);
  }

  private debugTeleport(id: EntityId, pos: Vec2, angle?: number): void {
    if (!isFiniteVec(pos) || (angle !== undefined && !Number.isFinite(angle))) throw new Error('teleport: non-finite pose');
    const ctx = this.ctx;
    const st = this.state;
    this.deferEvents(() => {
      const ch = st.characters[id - 1];
      if (ch && ch.id === id) {
        const rt = ctx.chars[id - 1]!;
        if (ch.grab) doRelease(ctx, id - 1, false);
        const b = rt.body;
        b.x = pos.x;
        b.y = pos.y;
        b.vx = 0;
        b.vy = 0;
        if (angle !== undefined) ch.facing = angle;
        rt.stuckTicks = 0;
        b.updateShapes(0);
        return;
      }
      const r = this.requireLoot(id);
      if (r.state.recovered) throw new Error(`teleport: loot ${id} is already recovered`);
      this.releaseHoldersOf(id);
      const b = r.rt.body;
      const newA = angle ?? b.a;
      if (r.state.kind === 'bank') {
        // carry riders (characters / free safes over the floor) rigidly; welded safes follow via weld
        const oc = Math.cos(b.a);
        const os = Math.sin(b.a);
        const nc = Math.cos(newA);
        const ns = Math.sin(newA);
        const move = (o: Body): void => {
          const dx = o.x - b.x;
          const dy = o.y - b.y;
          const lx = dx * oc + dy * os;
          const ly = -dx * os + dy * oc;
          o.x = pos.x + lx * nc - ly * ns;
          o.y = pos.y + lx * ns + ly * nc;
          o.a += newA - b.a;
          o.vx = 0;
          o.vy = 0;
          o.w = 0;
          o.updateShapes(0);
        };
        for (const crt of ctx.chars) if (onFloor(b, crt.body.x, crt.body.y)) move(crt.body);
        for (let i = 0; i < st.loot.length; i++) {
          const l = st.loot[i]!;
          const lb = ctx.loot[i]!.body;
          if (l.kind === 'bank' || l.recovered || lb.motion !== 'dynamic') continue;
          if (onFloor(b, lb.x, lb.y)) move(lb);
        }
        b.x = pos.x;
        b.y = pos.y;
        b.a = newA;
        b.vx = 0;
        b.vy = 0;
        b.w = 0;
        b.updateShapes(0);
        for (const lr of ctx.loot) {
          if (lr.body.weldParent === b) {
            PhysicsWorld.syncWeld(lr.body);
            lr.body.updateShapes(0);
          }
        }
      } else {
        b.x = pos.x;
        b.y = pos.y;
        b.a = newA;
        b.vx = 0;
        b.vy = 0;
        b.w = 0;
        if (r.state.anchored) {
          const idx = ctx.lootIndex.get(id)!;
          setLootAnchored(ctx, idx); // re-weld to the floor under the new spot, or static
        }
        b.updateShapes(0);
      }
    });
    this.refreshPoses();
  }

  private debugSetAnchored(id: EntityId, anchored: boolean): void {
    const r = this.requireLoot(id);
    if (r.state.recovered) throw new Error(`setAnchored: loot ${id} is already recovered`);
    const idx = this.ctx.lootIndex.get(id)!;
    if (anchored) setLootAnchored(this.ctx, idx);
    else setLootFree(this.ctx, idx);
    this.refreshPoses();
  }

  private debugSetVelocity(id: EntityId, vel: Vec2): void {
    if (!isFiniteVec(vel)) throw new Error('setVelocity: non-finite velocity');
    const ch = this.state.characters[id - 1];
    let b: Body;
    if (ch && ch.id === id) b = this.ctx.chars[id - 1]!.body;
    else {
      const r = this.requireLoot(id);
      if (r.state.recovered || r.rt.body.motion !== 'dynamic') return;
      b = r.rt.body;
    }
    b.vx = vel.x;
    b.vy = vel.y;
    this.syncState();
  }

  /** After debug edits: mirror bodies into state and reset NaN-guard poses. */
  private refreshPoses(): void {
    this.syncState();
    for (const rt of this.ctx.chars) {
      rt.lastX = rt.body.x;
      rt.lastY = rt.body.y;
    }
    for (const rt of this.ctx.loot) {
      rt.lastX = rt.body.x;
      rt.lastY = rt.body.y;
      rt.lastA = rt.body.a;
    }
  }
}
