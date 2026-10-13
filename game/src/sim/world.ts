/**
 * Builds the initial SimContext (state + physics bodies + statics) from a MatchSetup.
 *
 * Entity ids: characters 1..N (id = slot + 1), then banks (layout order), then safes
 * (bank interiors first: bank 0's BANK_MODEL.interior in order, then bank 1's ...,
 * then outdoor safes in layout order). All loot starts anchored (doc §5).
 *
 * Content 2.0 (C0 skeleton): with `rules.content === 'v2'` the outdoor safes come from
 * `layout.v2.safes`, then buildV2() runs the package callbacks in the frozen build order
 * props (C3) -> breakables (C1) -> gimmicks (C4) -> item pads (C2) -> events (C5, dormant event
 * loot appended last), and totalValue / remainingValue are computed afterwards (rules.ts
 * computeRemainingValue). Classic never runs any of it.
 */
import {
  BANK_MODEL,
  CHARACTER,
  COIN_ID_BASE,
  CONTENT_RNG_SALT,
  CONTENT_V2_BY_DEFAULT,
  DEFAULT_RULES,
  HAZARD_ID_BASE,
  ITEM_ID_BASE,
  KINEMATIC_ID_BASE,
  PROJECTILE_ID_BASE,
  FENCE,
  SAFE_SPECS,
  SCORE,
  VAN,
} from './config';
import type { CharRuntime, FenceRuntime, LootRuntime, SimContext, ZoneRuntime } from './context';
import { CAT_BANK, CAT_CHARACTER, CAT_SAFE, PhysicsWorld, type Body, type PhysicsParams, type StaticShape } from './physics';
import { buildBreakables } from './breakables';
import { buildEvents } from './events';
import { buildGimmicks } from './gimmicks';
import { buildItemPads } from './items';
import { createRng } from './math';
import { buildProps } from './props';
import { computeRemainingValue } from './rules';
import type {
  CharacterState,
  FenceState,
  LayoutV2Def,
  LootKind,
  LootState,
  MatchSetup,
  RuleConfig,
  SafeKind,
  SimState,
  Vec2,
} from './types';
import { EMPTY_COMMAND } from './types';

/** Box inertia about the center for full extents w x h. */
export const boxInertia = (mass: number, halfX: number, halfY: number): number =>
  (mass * (4 * halfX * halfX + 4 * halfY * halfY)) / 12;

/** Static box kinds that block line of sight (tall things). */
const LOS_BLOCKING_KINDS = new Set(['building', 'wall', 'kiosk']);

export const PHYSICS_PARAMS: PhysicsParams = {
  iterations: 10,
  beta: 0.2,
  slop: 0.005,
  maxBias: 2,
  baseMargin: 0.02,
  softPushFactor: CHARACTER.softPushFactor,
  fenceResistForce: FENCE.resistForce,
  fenceGive: FENCE.give,
  jointBeta: 0.25,
  jointMaxCorr: 2,
  gripBreakForce: CHARACTER.gripBreakForce,
  gripLateralForce: CHARACTER.gripLateralForce,
  impactThreshold: 2.5,
};

/**
 * Merge the setup's partial rules over DEFAULT_RULES. Keys that are present but `undefined`
 * keep the default (callers often build rules conditionally, e.g. `{ timeLimit: practice ?
 * false : undefined }`), and the merged result is validated so a bad value fails loudly at
 * match creation instead of silently producing a match that never times out or never settles.
 */
export function mergeRules(setup: MatchSetup): RuleConfig {
  const rules: RuleConfig = { ...DEFAULT_RULES };
  const src = setup.rules;
  if (src) {
    for (const key of Object.keys(DEFAULT_RULES) as (keyof RuleConfig)[]) {
      const v = src[key];
      if (v !== undefined) (rules as unknown as Record<string, unknown>)[key] = v;
    }
  }
  const tickCount = (key: 'matchTicks' | 'finalCountdownTicks' | 'recoveryTicks', min: number): void => {
    const v = rules[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
      throw new RangeError(`RuleConfig.${key} must be an integer >= ${min} (got ${String(v)})`);
    }
  };
  tickCount('matchTicks', 1);
  tickCount('finalCountdownTicks', 0);
  tickCount('recoveryTicks', 1);
  for (const key of ['earlyDecision', 'timeLimit', 'police', 'gimmicks'] as const) {
    if (typeof rules[key] !== 'boolean') {
      throw new TypeError(`RuleConfig.${key} must be a boolean (got ${String(rules[key])})`);
    }
  }
  // Content 2.0 (C0): resolve the ruleset per layout; always set on the merged rules.
  const content = src?.content ?? (setup.layout.v2 && CONTENT_V2_BY_DEFAULT ? 'v2' : 'classic');
  if (content !== 'classic' && content !== 'v2') throw new RangeError(`RuleConfig.content must be 'classic' or 'v2' (got ${String(content)})`);
  if (content === 'v2' && !setup.layout.v2) throw new RangeError(`RuleConfig.content 'v2' needs layout.v2 (layout ${setup.layout.id} has none)`);
  rules.content = content;
  if (rules.items !== 'off' && rules.items !== 'hammerOnly' && rules.items !== 'on') {
    throw new RangeError(`RuleConfig.items must be 'off' | 'hammerOnly' | 'on' (got ${String(rules.items)})`);
  }
  if (rules.events !== 'off' && rules.events !== 'on') throw new RangeError(`RuleConfig.events must be 'off' | 'on' (got ${String(rules.events)})`);
  if (src && src.eventPlan !== undefined) rules.eventPlan = src.eventPlan;
  return rules;
}

function lootValue(kind: LootKind): number {
  return kind === 'bank' ? SCORE.bankBuilding : SCORE[kind];
}

function makeCharBody(physics: PhysicsWorld, id: number, pos: Vec2): Body {
  const b = physics.createBody(id, CAT_CHARACTER);
  b.fixedRotation = true;
  b.addCircle(0, 0, CHARACTER.radius);
  b.setMass(CHARACTER.mass, 0);
  b.linDrag = CHARACTER.drag;
  b.x = pos.x;
  b.y = pos.y;
  return b;
}

function makeBankBody(physics: PhysicsWorld, id: number, pos: Vec2, angle: number): Body {
  const b = physics.createBody(id, CAT_BANK);
  for (const w of BANK_MODEL.walls) b.addBox(w.center.x, w.center.y, w.half.x, w.half.y);
  b.setMass(BANK_MODEL.mass, boxInertia(BANK_MODEL.mass, BANK_MODEL.half.x, BANK_MODEL.half.y));
  b.linDrag = BANK_MODEL.drag;
  b.motion = 'static';
  b.x = pos.x;
  b.y = pos.y;
  b.a = angle;
  return b;
}

function makeSafeBody(physics: PhysicsWorld, id: number, kind: SafeKind, pos: Vec2, angle: number): Body {
  const spec = SAFE_SPECS[kind];
  const b = physics.createBody(id, CAT_SAFE);
  b.addBox(0, 0, spec.half.x, spec.half.y);
  b.setMass(spec.mass, boxInertia(spec.mass, spec.half.x, spec.half.y));
  b.linDrag = spec.drag;
  b.motion = 'static';
  b.x = pos.x;
  b.y = pos.y;
  b.a = angle;
  return b;
}

function newLootState(id: number, kind: LootKind, pos: Vec2, angle: number, half: Vec2, homeBank: number | null): LootState {
  return {
    id,
    kind,
    baseValue: lootValue(kind),
    pos: { x: pos.x, y: pos.y },
    angle,
    vel: { x: 0, y: 0 },
    angVel: 0,
    half: { x: half.x, y: half.y },
    anchored: true,
    unanchorProgress: 0,
    recovered: false,
    recoveredBy: null,
    recoveredTick: null,
    grabbedBy: [],
    recovery: null,
    floorOf: null,
    loadedIn: null,
    homeBank,
    loadedSafes: [],
    estimatedValue: lootValue(kind),
    lastHolder: null,
  };
}

export function buildContext(setup: MatchSetup): SimContext {
  const layout = setup.layout;
  const rules = mergeRules(setup);
  const size = layout.size;
  const physics = new PhysicsWorld(PHYSICS_PARAMS, { minX: 0, minY: 0, maxX: size.x, maxY: size.y });

  // --- statics ------------------------------------------------------------
  const boundaryShapes: StaticShape[] = [];
  const T = 2; // boundary thickness (half = 1)
  const bw = (x: number, y: number, hx: number, hy: number, tag: string): void => {
    const s = physics.addStaticBox(x, y, hx, hy, 0, tag);
    s.blocksLOS = true;
    boundaryShapes.push(s);
  };
  bw(-T / 2, size.y / 2, T / 2, size.y / 2 + T, 'boundary.w');
  bw(size.x + T / 2, size.y / 2, T / 2, size.y / 2 + T, 'boundary.e');
  bw(size.x / 2, -T / 2, size.x / 2 + T, T / 2, 'boundary.n');
  bw(size.x / 2, size.y + T / 2, size.x / 2 + T, T / 2, 'boundary.s');

  for (const s of layout.statics) {
    const sh = physics.addStaticBox(s.center.x, s.center.y, s.half.x, s.half.y, s.angle, s.id);
    sh.blocksLOS = LOS_BLOCKING_KINDS.has(s.kind);
  }
  for (const c of layout.circles) physics.addStaticCircle(c.center.x, c.center.y, c.radius, c.id);

  const vanShapes: StaticShape[] = [];
  const zones: ZoneRuntime[] = [];
  layout.zones.forEach((z, i) => {
    const van = physics.addStaticBox(z.vanPos.x, z.vanPos.y, VAN.half.x, VAN.half.y, z.vanAngle, `van${i}`);
    van.blocksLOS = true;
    vanShapes.push(van);
    zones.push({ team: z.team, obb: { center: { ...z.center }, half: { ...z.half }, angle: z.angle } });
  });

  const fences: FenceRuntime[] = [];
  const fenceStates: FenceState[] = [];
  layout.fences.forEach((f, i) => {
    const sh = physics.addStaticBox(f.center.x, f.center.y, f.half.x, f.half.y, f.angle, f.id);
    sh.fenceIndex = i;
    fences.push({ shape: sh, pressTicks: 0, touched: false, maxApproach: 0, bankId: -1, px: 0, py: 0 });
    fenceStates.push({
      id: f.id,
      center: { ...f.center },
      half: { ...f.half },
      angle: f.angle,
      broken: false,
      brokenTick: null,
    });
  });

  // --- characters -----------------------------------------------------------
  const chars: CharRuntime[] = [];
  const characters: CharacterState[] = [];
  const teamCounts = [0, 0];
  setup.roster.forEach((r, slot) => {
    const id = slot + 1;
    const teamSpawns = layout.spawns.filter((s) => s.team === r.team);
    const k = teamCounts[r.team]!++;
    let pos: Vec2;
    let facing: number;
    if (teamSpawns.length === 0) {
      pos = { x: size.x / 2, y: size.y / 2 };
      facing = 0;
    } else if (k < teamSpawns.length) {
      pos = { ...teamSpawns[k]!.pos };
      facing = teamSpawns[k]!.facing;
    } else {
      // more players than spawns: line them up beside the last spawn
      const last = teamSpawns[teamSpawns.length - 1]!;
      const extra = k - teamSpawns.length + 1;
      pos = {
        x: last.pos.x - Math.sin(last.facing) * 1.2 * extra,
        y: last.pos.y + Math.cos(last.facing) * 1.2 * extra,
      };
      facing = last.facing;
    }
    const body = makeCharBody(physics, id, pos);
    chars.push({
      body,
      prevDash: false,
      dashDirX: 1,
      dashDirY: 0,
      grabLatch: false,
      joint: null,
      lastPingTick: -Infinity,
      stuckTicks: 0,
      lastX: pos.x,
      lastY: pos.y,
      stallTicks: 0,
      stallX: pos.x,
      stallY: pos.y,
      cmd: EMPTY_COMMAND,
      emoteReadyTick: 0,
    });
    characters.push({
      id,
      slot,
      team: r.team,
      name: r.name,
      isBot: r.isBot,
      look: { ...r.look },
      pos: { ...pos },
      vel: { x: 0, y: 0 },
      facing,
      moveIntent: { x: 0, y: 0 },
      grab: null,
      straining: false,
      dashTicks: 0,
      dashCooldown: 0,
      boostTicks: 0,
      knockdownTicks: 0,
      protectTicks: 0,
      floorOf: null,
      emote: null,
    });
  });

  // --- loot ---------------------------------------------------------------
  const loot: LootRuntime[] = [];
  const lootStates: LootState[] = [];
  let nextId = setup.roster.length + 1;
  const bankBodies: Body[] = [];
  for (const bp of layout.banks) {
    const id = nextId++;
    const body = makeBankBody(physics, id, bp.pos, bp.angle);
    bankBodies.push(body);
    loot.push({ body, baseMass: BANK_MODEL.mass, stuckTicks: 0, lastX: bp.pos.x, lastY: bp.pos.y, lastA: bp.angle });
    lootStates.push(newLootState(id, 'bank', bp.pos, bp.angle, BANK_MODEL.half, null));
  }
  layout.banks.forEach((bp, bi) => {
    const bank = bankBodies[bi]!;
    const c = Math.cos(bp.angle);
    const s = Math.sin(bp.angle);
    for (const it of BANK_MODEL.interior) {
      const id = nextId++;
      const pos = { x: bp.pos.x + it.pos.x * c - it.pos.y * s, y: bp.pos.y + it.pos.x * s + it.pos.y * c };
      const angle = bp.angle + it.angle;
      const body = makeSafeBody(physics, id, it.kind, pos, angle);
      body.motion = 'kinematic';
      body.weldParent = bank;
      body.weldLx = it.pos.x;
      body.weldLy = it.pos.y;
      body.weldLa = it.angle;
      loot.push({ body, baseMass: SAFE_SPECS[it.kind].mass, stuckTicks: 0, lastX: pos.x, lastY: pos.y, lastA: angle });
      lootStates.push(newLootState(id, it.kind, pos, angle, SAFE_SPECS[it.kind].half, bank.entityId));
    }
  });
  const v2: LayoutV2Def | null = rules.content === 'v2' ? layout.v2! : null;
  for (const sp of v2 ? v2.safes : layout.safes) {
    const id = nextId++;
    const body = makeSafeBody(physics, id, sp.kind, sp.pos, sp.angle);
    loot.push({ body, baseMass: SAFE_SPECS[sp.kind].mass, stuckTicks: 0, lastX: sp.pos.x, lastY: sp.pos.y, lastA: sp.angle });
    lootStates.push(newLootState(id, sp.kind, sp.pos, sp.angle, SAFE_SPECS[sp.kind].half, null));
  }
  const lootIndex = new Map<number, number>();
  lootStates.forEach((l, i) => lootIndex.set(l.id, i));

  const state: SimState = {
    layoutId: layout.id,
    tick: 0,
    endTick: rules.timeLimit ? rules.matchTicks : Infinity,
    over: false,
    result: null,
    scores: [0, 0],
    characters,
    loot: lootStates,
    fences: fenceStates,
    banksRecovered: 0,
    finalCountdown: false,
    finalCountdownTick: null,
    remainingValue: 0,
    totalValue: 0,
    pings: [],
    police: [],
    policeCars: [],
    alarm: { ringing: [], dispatchTick: null, waves: 0 },
    coins: [],
    breakables: [],
    items: [],
    hazards: [],
    projectiles: [],
    gimmicks: [],
    matchEvents: [],
    eventPlan: null,
  };

  const ctx: SimContext = {
    setup,
    rules,
    layout,
    state,
    physics,
    chars,
    loot,
    lootIndex,
    fences,
    zones,
    vanShapes,
    boundaryShapes,
    events: [],
    pendingEvents: [],
    nextPingId: 1,
    settled: new Set(),
    started: false,
    police: null,
    content: null,
    rng: createRng((setup.seed ^ CONTENT_RNG_SALT) >>> 0),
    nextIds: { item: ITEM_ID_BASE + 1, projectile: PROJECTILE_ID_BASE + 1, hazard: HAZARD_ID_BASE + 1, kinematic: KINEMATIC_ID_BASE + 1, coin: COIN_ID_BASE + 1 },
  };
  if (v2) buildV2(ctx, v2);

  for (const b of physics.bodies) b.updateShapes(0);

  // Constant for the match (content-plan §3.5); classic: Σ loot baseValue (3200 on full layouts).
  state.totalValue = computeRemainingValue(state);
  state.remainingValue = state.totalValue;
  return ctx;
}

/**
 * Content 2.0 build (C0 skeleton): the package callbacks in the frozen build order. Each callback
 * only appends to its own state array / the loot list (appendLoot) and the physics world. They run
 * BEFORE the systems exist (`ctx.content` is still null): per-match runtime (item decks, breakable
 * static indices, gimmick bodies' bookkeeping) is created in the owning system's constructor from
 * `ctx.layout.v2` / `ctx.state`, which runs right after the build (Simulation constructor).
 */
function buildV2(ctx: SimContext, v2: LayoutV2Def): void {
  buildProps(ctx, v2); // C3: prop loot, ids right after the v2 safes
  buildBreakables(ctx, v2); // C1
  buildGimmicks(ctx, v2); // C4 (skips when rules.gimmicks is false)
  buildItemPads(ctx, v2); // C2 (skips when rules.items is 'off')
  buildEvents(ctx, v2); // C5: eventPlan, scheduled events, dormant event loot (appended last)
}

/** Next loot id (after every loot built so far). */
export function nextLootId(ctx: SimContext): number {
  const st = ctx.state;
  return st.loot.length ? st.loot[st.loot.length - 1]!.id + 1 : st.characters.length + 1;
}

/**
 * Append a loot item built by a Content 2.0 callback (props, dormant event loot). `state.id`
 * must be nextLootId(ctx); keeps state.loot / ctx.loot / ctx.lootIndex aligned.
 */
export function appendLoot(ctx: SimContext, state: LootState, rt: LootRuntime): void {
  if (state.id !== nextLootId(ctx)) throw new Error(`appendLoot: id ${state.id} != next loot id ${nextLootId(ctx)}`);
  ctx.lootIndex.set(state.id, ctx.state.loot.length);
  ctx.state.loot.push(state);
  ctx.loot.push(rt);
}

/** Allocate the next id of a Content 2.0 id range (ITEM / PROJECTILE / HAZARD / KINEMATIC / COIN_ID_BASE). */
export function nextEntityId(ctx: SimContext, kind: keyof SimContext['nextIds']): number {
  return ctx.nextIds[kind]++;
}
