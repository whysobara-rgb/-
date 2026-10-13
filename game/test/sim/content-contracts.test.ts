/**
 * Content 2.0 day-0 contracts (C0): ruleset resolution, the v2 build skeleton, the frozen system
 * hook order, the value extension points (remainingValue / totalValue / allRecovered), deposits,
 * id ranges, dash routing and the query helpers. Owners update the "stub" expectations marked
 * below when they implement (add-only: never weaken the shape checks).
 */
import { describe, expect, it } from 'vitest';
import {
  COIN_ID_BASE,
  CONTENT_RNG_SALT,
  CONTENT_V2_BY_DEFAULT,
  DEFAULT_RULES,
  EVENT_RNG_SALT,
  HAZARD_ID_BASE,
  ITEM_FOREVER,
  ITEM_ID_BASE,
  ITEMS,
  KINEMATIC_ID_BASE,
  PROJECTILE_ID_BASE,
  PROP_SPECS,
} from '../../src/sim/config';
import { knockDown } from '../../src/sim/actions';
import { planMatchEvents } from '../../src/sim/events';
import { createRng } from '../../src/sim/math';
import { MOMENT_KINDS } from '../../src/shared/moments';
import type { SimContext } from '../../src/sim/context';
import { addUnanchorProgress } from '../../src/sim/props';
import { heldValue, isCarryable, navClassOf } from '../../src/sim/queries';
import { computeRemainingValue, isAllRecovered, settle, settleDeposits, updateLoading } from '../../src/sim/rules';
import { Simulation } from '../../src/sim/sim';
import { ContentSystems } from '../../src/sim/systems';
import type { LayoutDef, LayoutV2Def, RuleConfig, SimEvent, SimState, TeamId } from '../../src/sim/types';
import { nextEntityId } from '../../src/sim/world';
import { cmd, fullLayout, makeSim, openLayout, run } from './fixtures/layouts';

const ctxOf = (sim: Simulation): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

/** fullLayout with a v2 composition: the 6 small outdoor safes become 2 large ones. */
function v2Layout(): LayoutDef {
  const base = fullLayout();
  const v2: LayoutV2Def = {
    safes: [...base.safes.filter((s) => s.kind === 'largeSafe'), { kind: 'largeSafe', pos: { x: 50, y: 10 }, angle: 0 }],
    props: [],
    breakables: [],
    gimmicks: [],
    itemPads: [],
    eventSpots: [{ x: 50, y: 30 }],
  };
  return { ...base, v2 };
}

/** A v2 match on v2Layout (explicit: the per-layout default is gated by CONTENT_V2_BY_DEFAULT). */
const v2Sim = (teams: TeamId[] = [0, 0, 1, 1], rules: Partial<RuleConfig> = {}): Simulation => makeSim(v2Layout(), teams, { content: 'v2', ...rules });

describe('ruleset resolution', () => {
  it('defaults to classic without layout.v2, to v2 with it once CONTENT_V2_BY_DEFAULT; explicit wins', () => {
    expect(makeSim(fullLayout()).rules.content).toBe('classic');
    // gated until the wave-1 integration flips CONTENT_V2_BY_DEFAULT (C0)
    expect(makeSim(v2Layout()).rules.content).toBe(CONTENT_V2_BY_DEFAULT ? 'v2' : 'classic');
    expect(v2Sim().rules.content).toBe('v2');
    expect(makeSim(v2Layout(), [0, 0, 1, 1], { content: 'classic' }).rules.content).toBe('classic');
    expect(() => makeSim(fullLayout(), [0, 0, 1, 1], { content: 'v2' })).toThrow(RangeError);
    const r = v2Sim().rules;
    expect([r.items, r.events, r.gimmicks]).toEqual(['on', 'on', true]);
    expect(DEFAULT_RULES.content).toBeUndefined();
  });

  it('classic on a v2 layout keeps layout.safes, no content systems, empty arrays', () => {
    const sim = makeSim(v2Layout(), [0, 0, 1, 1], { content: 'classic' });
    const ref = makeSim(fullLayout());
    expect(sim.state.loot.map((l) => [l.id, l.kind, l.pos])).toEqual(ref.state.loot.map((l) => [l.id, l.kind, l.pos]));
    expect(ctxOf(sim).content).toBeNull();
    expect(sim.state.totalValue).toBe(3200);
  });
});

describe('v2 build skeleton', () => {
  it('v2.safes replace layout.safes; totals come from computeRemainingValue; arrays exist', () => {
    const sim = v2Sim();
    const st = sim.state;
    const outdoor = st.loot.filter((l) => l.kind !== 'bank' && l.homeBank === null);
    expect(outdoor.map((l) => l.kind)).toEqual(['largeSafe', 'largeSafe', 'largeSafe']);
    expect(st.totalValue).toBe(2 * 1000 + 3 * 300); // banks with interiors + 3 large
    expect(st.totalValue).toBe(computeRemainingValue(st));
    expect(st.remainingValue).toBe(st.totalValue);
    for (const k of ['coins', 'breakables', 'items', 'hazards', 'projectiles', 'gimmicks', 'matchEvents'] as const) expect(st[k]).toEqual([]);
    // stub: C5 derives a plan from the seed; the day-0 deriveEventPlan returns null
    expect(st.eventPlan).toBeNull();
    expect(ctxOf(sim).content).toBeInstanceOf(ContentSystems);
  });

  it('an explicit eventPlan is kept; events off forces null', () => {
    const plan = { loot: { kind: 'moneyRain' as const, tick: 5000, spot: 0 }, quake: null };
    expect(v2Sim([0, 0, 1, 1], { eventPlan: plan }).state.eventPlan).toEqual(plan);
    expect(v2Sim([0, 0, 1, 1], { eventPlan: plan, events: 'off' }).state.eventPlan).toBeNull();
  });

  it('a v2 match with no-op systems plays like classic and keeps the invariant', () => {
    const sim = v2Sim();
    const evs = run(sim, 600, [cmd(1, 0), cmd(0, 1), cmd(-1, 0), cmd(0, -1, false, true)]);
    expect(evs.length).toBeGreaterThan(0);
    const st = sim.state;
    expect(st.scores[0] + st.scores[1] + st.remainingValue).toBe(st.totalValue);
  });
});

describe('system hook order (frozen, content-plan §4.4)', () => {
  it('calls every hook in the frozen order, post-tick after police in its own order', () => {
    const sim = v2Sim([0, 0, 1, 1], { police: true });
    const ctx = ctxOf(sim);
    const content = ctx.content!;
    const log: string[] = [];
    for (const s of content.ordered) {
      for (const h of ['prePhysics', 'beforeSubstep', 'afterSubstep', 'afterPhysics', 'afterLoading', 'postTick', 'freeze'] as const) {
        (s as unknown as Record<string, () => void>)[h] = () => log.push(`${h}:${s.name}`);
      }
    }
    const police = ctx.police!;
    const pre = police.prePhysics.bind(police);
    police.prePhysics = () => {
      log.push('prePhysics:police');
      pre();
    };
    const post = police.postTick.bind(police);
    police.postTick = () => {
      log.push('postTick:police');
      post();
    };
    sim.step([]);
    const phase = (h: string): string[] => log.filter((x) => x.startsWith(`${h}:`)).map((x) => x.slice(h.length + 1));
    const order = ['coins', 'props', 'items', 'gimmicks', 'events'];
    expect(phase('prePhysics')).toEqual([...order, 'police']);
    expect(phase('beforeSubstep').slice(0, 5)).toEqual(order);
    expect(phase('afterSubstep').slice(0, 5)).toEqual(order);
    expect(phase('afterPhysics')).toEqual(order);
    expect(phase('afterLoading')).toEqual(order);
    expect(phase('postTick')).toEqual(['police', 'events', 'items', 'gimmicks', 'coins', 'props']);
    // step order: pre-physics < substeps < afterPhysics < afterLoading < post-tick
    const first = (s: string): number => log.indexOf(s);
    expect(first('prePhysics:coins')).toBeLessThan(first('beforeSubstep:coins'));
    expect(first('afterSubstep:events')).toBeLessThan(first('afterPhysics:coins'));
    expect(first('afterPhysics:events')).toBeLessThan(first('afterLoading:coins'));
    expect(first('afterLoading:events')).toBeLessThan(first('postTick:police'));
    expect(phase('freeze')).toEqual([]);
  });

  it('freeze runs once on the ending tick, then nothing', () => {
    const sim = v2Sim([0, 0, 1, 1], { matchTicks: 3 });
    const log: string[] = [];
    for (const s of ctxOf(sim).content!.ordered) {
      (s as unknown as Record<string, () => void>).freeze = () => log.push(`freeze:${s.name}`);
      (s as unknown as Record<string, () => void>).postTick = () => log.push(`post:${s.name}`);
    }
    for (let i = 0; i < 5; i++) sim.step([]);
    expect(log.filter((x) => x.startsWith('freeze'))).toEqual(['freeze:events', 'freeze:items', 'freeze:gimmicks', 'freeze:coins', 'freeze:props']);
    expect(log.filter((x) => x.startsWith('post')).length).toBe(2 * 5);
  });

  it('a rising dash edge with an item and empty hands goes to items.onDash instead of a dash', () => {
    const sim = v2Sim();
    const ctx = ctxOf(sim);
    const calls: number[] = [];
    ctx.content!.items.onDash = (slot: number) => void calls.push(slot);
    sim.state.characters[0]!.item = { kind: 'hammer', uses: 5, expiresTick: 9999, cooldown: 0, phase: 'idle', phaseTicks: 0, aim: 0 };
    const evs = sim.step([cmd(0, 0, false, true), cmd(0, 0, false, true)]);
    expect(calls).toEqual([0]);
    expect(evs.filter((e) => e.type === 'dash').map((e) => (e as Extract<SimEvent, { type: 'dash' }>).charId)).toEqual([2]);
  });
});

describe('value extension points (content-plan §3.5)', () => {
  function state(): SimState {
    return structuredClone(makeSim(fullLayout()).state);
  }

  it('remainingValue sums loot (+ innerValue), piles, bags, unbroken breakables and pending events', () => {
    const st = state();
    const base = computeRemainingValue(st);
    expect(base).toBe(3200);
    st.loot[st.loot.length - 1]!.innerValue = 70;
    st.coins.push({ id: COIN_ID_BASE + 1, pos: { x: 1, y: 1 }, vel: { x: 0, y: 0 }, value: 50, noPickupCharId: null, noPickupUntil: 0 });
    st.characters[0]!.bag = 30;
    st.breakables.push({ id: 'b', kind: 'crate', center: { x: 0, y: 0 }, half: { x: 0.45, y: 0.45 }, angle: 0, hp: 1, innerValue: 20, broken: false });
    st.breakables.push({ id: 'c', kind: 'crate', center: { x: 0, y: 0 }, half: { x: 0.45, y: 0.45 }, angle: 0, hp: 0, innerValue: 20, broken: true });
    st.matchEvents.push({ kind: 'moneyRain', phase: 'scheduled', startTick: 100, pos: { x: 0, y: 0 }, pendingValue: 400 });
    expect(computeRemainingValue(st)).toBe(base + 70 + 50 + 30 + 20 + 400);
  });

  it('allRecovered needs every loot recovered, no piles, empty bags, broken breakables, no pending value', () => {
    const st = state();
    expect(isAllRecovered(st)).toBe(false);
    for (const l of st.loot) l.recovered = true;
    expect(isAllRecovered(st)).toBe(true);
    st.characters[1]!.bag = 10;
    expect(isAllRecovered(st)).toBe(false);
    st.characters[1]!.bag = 0;
    st.matchEvents.push({ kind: 'cashTruck', phase: 'scheduled', startTick: 1, pos: { x: 0, y: 0 }, pendingValue: 400 });
    expect(isAllRecovered(st)).toBe(false);
  });

  it('settleDeposits moves bags into scores (ascending charId) and keeps the invariant', () => {
    const sim = v2Sim();
    const ctx = ctxOf(sim);
    const st = sim.state;
    // pretend 120 of loot value became bag value (as C1's pickup will do)
    st.characters[2]!.bag = 70;
    st.characters[0]!.bag = 50;
    st.loot[st.loot.length - 1]!.baseValue -= 120;
    ctx.events = [];
    settleDeposits(ctx, [
      { charId: 3, team: 1, value: 70 },
      { charId: 1, team: 0, value: 50 },
    ]);
    expect(st.scores).toEqual([50, 70]);
    expect(st.characters[0]!.bag).toBe(0);
    expect(ctx.events.map((e) => (e as Extract<SimEvent, { type: 'coinsBanked' }>).charId)).toEqual([1, 3]);
    expect(st.scores[0] + st.scores[1] + st.remainingValue).toBe(st.totalValue);
  });
});

describe('ids, rng, helpers', () => {
  it('id ranges and the content RNG salt are frozen', () => {
    expect([ITEM_ID_BASE, PROJECTILE_ID_BASE, HAZARD_ID_BASE, KINEMATIC_ID_BASE, COIN_ID_BASE]).toEqual([2000, 3000, 4000, 5000, 10000]);
    expect(CONTENT_RNG_SALT).toBe(0x17e15);
    const ctx = ctxOf(v2Sim());
    expect([
      nextEntityId(ctx, 'coin'),
      nextEntityId(ctx, 'coin'),
      nextEntityId(ctx, 'item'),
      nextEntityId(ctx, 'hazard'),
      nextEntityId(ctx, 'projectile'),
      nextEntityId(ctx, 'kinematic'),
    ]).toEqual([10001, 10002, 2001, 4001, 3001, 5001]);
  });

  it('ctx.rng is the item-deck stream; the event plan has its own stream (pure planMatchEvents)', () => {
    const sim = v2Sim();
    const ctx = ctxOf(sim);
    expect(ctx.rng()).toBe(createRng((sim.setup.seed ^ CONTENT_RNG_SALT) >>> 0)());
    expect(EVENT_RNG_SALT).not.toBe(0);
    // stub: C5 returns a plan; it must be a pure function of (seed, v2, opts)
    const v2 = v2Layout().v2!;
    expect(planMatchEvents(sim.setup.seed, v2, { avoidKind: 'moneyRain' })).toEqual(planMatchEvents(sim.setup.seed, v2, { avoidKind: 'moneyRain' }));
    expect(planMatchEvents(sim.setup.seed, v2)).toBeNull();
  });

  it('content state is JSON-safe: no Infinity in item specs (ITEM_FOREVER instead)', () => {
    for (const spec of Object.values(ITEMS.specs)) {
      expect(Number.isFinite(spec.uses)).toBe(true);
      expect(Number.isFinite(spec.lifetimeTicks)).toBe(true);
    }
    expect(ITEMS.specs.goldHammer.lifetimeTicks).toBe(ITEM_FOREVER);
    expect(Number.isSafeInteger(ITEM_FOREVER)).toBe(true);
  });

  it('Content 2.0 moment kinds are part of the moment contract', () => {
    for (const k of ['coinSplash', 'jackpot', 'hammerBonk', 'homeRun', 'goldHammer', 'tossScore', 'craneDrop', 'eventHaul'] as const) {
      expect(MOMENT_KINDS).toContain(k);
    }
  });

  it('addUnanchorProgress frees at 1 and emits the existing unanchored event', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 30 }, angle: 0 }] }), [0, 1]);
    const ctx = ctxOf(sim);
    const id = sim.state.loot[0]!.id;
    ctx.events = [];
    expect(addUnanchorProgress(ctx, id, 0.5, 1)).toBe(false);
    expect(sim.getLoot(id)!.unanchorProgress).toBe(0.5);
    expect(addUnanchorProgress(ctx, id, 0.5, 1)).toBe(true);
    expect(sim.getLoot(id)!.anchored).toBe(false);
    expect(ctx.events).toEqual([{ type: 'unanchored', tick: 0, lootId: id, kind: 'largeSafe', byTeam: 0 }]);
    expect(addUnanchorProgress(ctx, id, 1, null)).toBe(false);
  });

  it('heldValue / isCarryable / navClassOf', () => {
    const sim = makeSim(fullLayout());
    const st = sim.state;
    const safe = st.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!;
    expect(heldValue(st, 1)).toBe(0);
    st.characters[0]!.grab = { targetId: safe.id, part: 'safe', anchorLocal: { x: 0, y: 0 } };
    st.characters[0]!.bag = 40;
    expect(heldValue(st, 1)).toBe(140);
    expect(isCarryable(safe)).toBe(true);
    expect(isCarryable({ ...safe, dormant: true })).toBe(false);
    expect(isCarryable({ ...safe, airborne: { fromTick: 0, toTick: 9, from: safe.pos, to: safe.pos, via: 'tube' } })).toBe(false);
    expect(navClassOf(safe)).toBe('smallSafe');
    expect(navClassOf({ kind: 'largeSafe', variant: 'piggy' })).toBe(PROP_SPECS.piggy.kind);
  });
});

describe('knockdown chokepoint (actions.ts knockDown -> ContentSystems.onKnockdown)', () => {
  /** Characters 0 (team 0) and 1 (team 1) face each other; 0 dashes into 1. */
  function dashSetup(rules: Partial<RuleConfig>): Simulation {
    const sim = makeSim(rules.content === 'v2' ? v2Layout() : fullLayout(), [0, 1], rules);
    const ctx = ctxOf(sim);
    const a = ctx.chars[0]!.body;
    const b = ctx.chars[1]!.body;
    a.x = 50;
    a.y = 40;
    b.x = 51.2;
    b.y = 40;
    sim.state.characters[0]!.facing = 0;
    return sim;
  }

  it('a dash knockdown calls onKnockdown(victim, dash, attacker, dir) and dashHit carries the spill', () => {
    const sim = dashSetup({ content: 'v2' });
    const calls: unknown[][] = [];
    ctxOf(sim).content!.onKnockdown = (...args: unknown[]) => {
      calls.push(args);
      return 30;
    };
    const evs: SimEvent[] = [];
    for (let t = 0; t < 30 && !evs.some((e) => e.type === 'dashHit'); t++) evs.push(...sim.step([cmd(1, 0, false, t === 0), cmd(0, 0)]));
    const hit = evs.find((e) => e.type === 'dashHit') as Extract<SimEvent, { type: 'dashHit' }>;
    expect(hit).toMatchObject({ attackerId: 1, victimId: 2, knockdown: true, spilled: 30 });
    expect(calls.length).toBe(1);
    expect(calls[0]!.slice(0, 3)).toEqual([2, 'dash', 1]);
    expect(Math.abs(calls[0]![3] as number)).toBeLessThan(0.5); // knocked along +x
  });

  it('classic: no content call, no spilled field', () => {
    const sim = dashSetup({});
    const evs: SimEvent[] = [];
    for (let t = 0; t < 30 && !evs.some((e) => e.type === 'dashHit'); t++) evs.push(...sim.step([cmd(1, 0, false, t === 0), cmd(0, 0)]));
    const hit = evs.find((e) => e.type === 'dashHit')!;
    expect(hit).toMatchObject({ knockdown: true });
    expect('spilled' in hit).toBe(false);
  });

  it('knockDown applies the classic knockdown and skips the spill for a self crash', () => {
    const sim = v2Sim([0, 1]);
    const ctx = ctxOf(sim);
    const causes: string[] = [];
    ctx.content!.coins.spillBag = (_v, cause) => {
      causes.push(cause);
      return 0;
    };
    const dropped: number[] = [];
    ctx.content!.items.dropHeld = (id) => void dropped.push(id);
    expect(knockDown(ctx, 0, 3, 0, 'self', null, 30)).toBe(0);
    expect(knockDown(ctx, 1, -3, 0, 'hammer', 1)).toBe(0);
    expect(causes).toEqual(['hammer']);
    expect(dropped).toEqual([1, 2]);
    expect(sim.state.characters[0]!.knockdownTicks).toBe(30);
    expect(ctx.chars[0]!.body.vx).toBeCloseTo(ctx.chars[0]!.body.fvx + 3);
  });
});

describe('carryability and prop settlement (classic-safe extension points)', () => {
  it('a prop pays baseValue + innerValue; recovered carries innerValue and variant; invariant holds', () => {
    const sim = v2Sim();
    const ctx = ctxOf(sim);
    const st = sim.state;
    const l = st.loot[st.loot.length - 1]!;
    // turn a large safe into a half-shaken ATM worth 100 + 60 (value moves, never appears)
    l.variant = 'atm';
    l.baseValue = 100;
    l.innerValue = 60;
    l.estimatedValue = 160;
    l.anchored = false;
    st.totalValue = computeRemainingValue(st);
    ctx.events = [];
    settle(ctx, [l.id], 1);
    sim.state.remainingValue = computeRemainingValue(st);
    expect(st.scores[1]).toBe(160);
    expect(ctx.events[0]).toMatchObject({ type: 'recovered', value: 160, innerValue: 60, variant: 'atm' });
    expect(st.scores[0] + st.scores[1] + st.remainingValue).toBe(st.totalValue);
  });

  it('plain safes keep the classic recovered event shape', () => {
    const sim = makeSim(fullLayout());
    const ctx = ctxOf(sim);
    const l = sim.state.loot.find((x) => x.kind === 'smallSafe' && x.homeBank === null)!;
    ctx.events = [];
    settle(ctx, [l.id], 0);
    expect('innerValue' in ctx.events[0]! || 'variant' in ctx.events[0]!).toBe(false);
  });

  it('dormant loot cannot be grabbed; dormant / airborne loot never starts recovery or loads', () => {
    const setup = (dormant: boolean) => {
      const sim = v2Sim([0, 1]);
      const ctx = ctxOf(sim);
      const st = sim.state;
      const l = st.loot.find((x) => x.kind === 'largeSafe' && x.homeBank === null)!;
      l.dormant = dormant;
      const body = ctx.loot[ctx.lootIndex.get(l.id)!]!.body;
      const ch = ctx.chars[0]!.body;
      ch.x = body.x - 1.4;
      ch.y = body.y;
      st.characters[0]!.facing = 0;
      sim.step([cmd(0, 0, true), cmd(0, 0)]);
      return { sim, ctx, st, l, body };
    };
    expect(setup(false).st.characters[0]!.grab).not.toBeNull(); // control: in reach
    const { sim, ctx, st, l, body } = setup(true);
    expect(st.characters[0]!.grab).toBeNull();
    sim.step([cmd(0, 0), cmd(0, 0)]); // release the grab button
    // inside a zone, unanchored, but airborne: no recovery
    l.dormant = false;
    l.anchored = false;
    l.airborne = { fromTick: 0, toTick: 999, from: l.pos, to: l.pos, via: 'catapult' };
    body.x = 10;
    body.y = 30;
    ctx.events = [];
    sim.step([cmd(0, 0), cmd(0, 0)]);
    expect(ctx.events.some((e) => e.type === 'recoveryStart' && e.lootId === l.id)).toBe(false);
    updateLoading(ctx);
    expect(l.floorOf).toBeNull();
    l.airborne = null; // control: the same spot recovers once it has landed
    ctx.events = [];
    sim.step([cmd(0, 0), cmd(0, 0)]);
    expect(ctx.events.some((e) => e.type === 'recoveryStart' && e.lootId === l.id)).toBe(true);
  });

  it('a prop uproots in PROP_SPECS[variant].uprootTicks, not its nav class time', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 30 }, angle: 0 }] }), [0, 1]);
    const l = sim.state.loot[0]!;
    l.variant = 'atm';
    sim.debug.teleport(1, { x: 50 + 0.7 + 0.6, y: 30 }, Math.PI); // facing the safe from +x
    let first = -1;
    let done = -1;
    for (let t = 0; t < 400 && done < 0; t++) {
      const ev = sim.step([cmd(1, 0, true, false, { x: -1, y: 0 }), cmd(0, 0)]);
      if (first < 0 && ev.some((e) => e.type === 'grab')) first = sim.state.tick;
      if (ev.some((e) => e.type === 'unanchored')) done = sim.state.tick;
    }
    expect(first).toBeGreaterThan(0);
    expect(done).toBeGreaterThan(0);
    expect(Math.abs(done - first - PROP_SPECS.atm.uprootTicks)).toBeLessThanOrEqual(3);
  });

  it('bodies carry neutral ground fields; v2 prePhysics resets them every tick', () => {
    const sim = v2Sim();
    const ctx = ctxOf(sim);
    const b = ctx.chars[0]!.body;
    expect([b.fieldVx, b.fieldVy, b.dragScale, b.driveScale, b.kickable]).toEqual([0, 0, 1, 1, false]);
    b.fieldVx = 2;
    b.dragScale = 0.15;
    sim.step([]);
    expect([b.fieldVx, b.dragScale]).toEqual([0, 1]);
  });
});
