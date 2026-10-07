/**
 * [C2] Items wave 1 (content-plan §5.2, §6 C2): supply drops (schedule, warning, twins, deck,
 * expiry), pickup by touch (pocket, tie rule), the 뿅망치 (sim-enforced wind-up for every slot,
 * knockdown / spill / item drop, protect rule, uproot increments, breakables, fences, police
 * stun, carried small safe, bank bell, clash), the 황금 뿅망치 timing (countdown and
 * no-countdown paths), mirror fairness and slot-order independence.
 */
import { describe, expect, it } from 'vitest';
import { BREAKABLE_SPECS, ITEM_FOREVER, ITEMS, KNOCKDOWN_TICKS, POLICE, PROTECT_TICKS, UNANCHOR_TICKS, secondsToTicks } from '../../src/sim/config';
import type { SimContext } from '../../src/sim/context';
import { computeRemainingValue } from '../../src/sim/rules';
import type { Simulation } from '../../src/sim/sim';
import type { BreakableDef, Command, FenceDef, HeldItem, ItemKind, LayoutDef, RuleConfig, SimEvent, TeamId, Vec2 } from '../../src/sim/types';
import { cmd, lootIds, makeSetup, makeSim, openLayout } from './fixtures/layouts';
import { Simulation as Sim } from '../../src/sim/sim';

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(evs: SimEvent[], t: T): Ev<T>[] => evs.filter((e): e is Ev<T> => e.type === t);
const ctxOf = (sim: Simulation): SimContext => (sim as unknown as { ctx: SimContext }).ctx;
const idle = (n: number): Command[] => Array.from({ length: n }, () => cmd());
const conserved = (sim: Simulation): boolean => {
  const st = sim.state;
  return st.scores[0] + st.scores[1] + st.remainingValue === st.totalValue && computeRemainingValue(st) === st.remainingValue;
};

const PAD_W: Vec2 = { x: 36, y: 30 };
const PAD_E: Vec2 = { x: 64, y: 30 };
const PAD_AXIS: Vec2 = { x: 50, y: 20 };

interface ItemLayoutOpts {
  safes?: LayoutDef['safes'];
  banks?: LayoutDef['banks'];
  breakables?: BreakableDef[];
  fences?: FenceDef[];
  statics?: LayoutDef['statics'];
  pads?: boolean;
}

/** 100 x 60 open arena (zones x 10 / 90, axis x 50) with a v2 composition and 3 item pads. */
function itemLayout(o: ItemLayoutOpts = {}): LayoutDef {
  const base = openLayout({
    safes: o.safes ?? [{ kind: 'largeSafe', pos: { x: 50, y: 50 }, angle: 0 }],
    banks: o.banks ?? [],
    fences: o.fences ?? [],
    statics: o.statics ?? [],
  });
  const pads =
    o.pads === false
      ? []
      : [
          { id: 'pad.w', pos: PAD_W, twin: 'pad.e' },
          { id: 'pad.e', pos: PAD_E, twin: 'pad.w' },
          { id: 'pad.axis', pos: PAD_AXIS, twin: null },
        ];
  return {
    ...base,
    v2: { safes: base.safes, props: [], breakables: o.breakables ?? [], gimmicks: [], itemPads: pads, eventSpots: [{ x: 50, y: 30 }] },
  };
}

function itemSim(layout = itemLayout(), teams: TeamId[] = [0, 1], rules: Partial<RuleConfig> = {}, seed = 1): Simulation {
  const setup = makeSetup(layout, teams, { content: 'v2', events: 'off', ...rules });
  setup.seed = seed;
  return new Sim(setup);
}

function give(sim: Simulation, slot: number, kind: ItemKind = 'hammer', over: Partial<HeldItem> = {}): HeldItem {
  const spec = ITEMS.specs[kind];
  const it: HeldItem = {
    kind,
    uses: spec.uses,
    expiresTick: spec.lifetimeTicks >= ITEM_FOREVER ? ITEM_FOREVER : sim.state.tick + spec.lifetimeTicks,
    cooldown: 0,
    phase: 'idle',
    phaseTicks: 0,
    aim: 0,
    ...over,
  };
  sim.state.characters[slot]!.item = it;
  return it;
}

/** Place character `slot` (id slot + 1) at `pos`, at rest. */
function place(sim: Simulation, slot: number, pos: Vec2): void {
  sim.debug.teleport(slot + 1, pos, 0);
}

/** Press dash (rising edge) for `slot` aiming along `aim`, then run `ticks` more ticks idle. */
function swing(sim: Simulation, slot: number, aim: Vec2, ticks = 30, n = sim.state.characters.length, others: (t: number) => Command[] = () => idle(n)): { press: number; evs: SimEvent[] } {
  const evs: SimEvent[] = [];
  const c = others(0);
  c[slot] = cmd(0, 0, false, true, aim);
  evs.push(...sim.step(c));
  const press = sim.state.tick;
  for (let t = 1; t <= ticks; t++) {
    const k = others(t);
    k[slot] = cmd(0, 0, false, false, aim);
    evs.push(...sim.step(k));
  }
  return { press, evs };
}

function stepN(sim: Simulation, n: number, cmds?: (t: number) => Command[]): SimEvent[] {
  const out: SimEvent[] = [];
  const k = sim.state.characters.length;
  for (let t = 0; t < n && !sim.state.over; t++) out.push(...sim.step(cmds ? cmds(t) : idle(k)));
  return out;
}

/** Non-bank loot ids in layout order. */
const safeIds = (sim: Simulation): number[] => sim.state.loot.filter((l) => l.kind !== 'bank').map((l) => l.id);

/** Move `value` from loot `lootId`'s shell into a bag (value-conserving test setup). */
function fundBag(sim: Simulation, charId: number, lootId: number, value: number): void {
  const l = sim.getLoot(lootId)!;
  l.baseValue -= value;
  l.estimatedValue -= value;
  const ch = sim.getCharacter(charId)!;
  ch.bag = (ch.bag ?? 0) + value;
}

// ---------------------------------------------------------------------------------------------

describe('items: supply drops', () => {
  it('pairs land at 15 s with a 3 s warning, both twins get the same item, then expire 30 s later', () => {
    const sim = itemSim();
    const land = secondsToTicks(ITEMS.drop.pairs[0]!);
    const warn = land - ITEMS.drop.warnTicks;
    const pre = stepN(sim, warn - 1);
    expect(ofType(pre, 'itemIncoming')).toEqual([]);
    const evs = stepN(sim, 1);
    const inc = ofType(evs, 'itemIncoming');
    expect(inc.map((e) => e.padId).sort()).toEqual(['pad.e', 'pad.w']);
    expect(inc.every((e) => e.landTick === land && e.kind === 'hammer' && e.tick === warn)).toBe(true);
    expect(sim.state.items.map((i) => i.phase)).toEqual(['incoming', 'incoming']);
    expect(sim.state.items.every((i) => i.id > 2000 && i.uses === ITEMS.specs.hammer.uses)).toBe(true);
    // nothing can be picked up while it is still falling
    place(sim, 0, PAD_W);
    const mid = stepN(sim, land - warn - 1);
    expect(ofType(mid, 'itemPickup')).toEqual([]);
    place(sim, 0, { x: 30, y: 50 });
    const at = stepN(sim, 1);
    expect(ofType(at, 'itemSpawn').length).toBe(2);
    expect(sim.state.items.every((i) => i.phase === 'ground' && i.expiresTick === land + ITEMS.drop.groundLifetime)).toBe(true);
    const until = stepN(sim, ITEMS.drop.groundLifetime);
    const exp = ofType(until, 'itemExpired').filter((e) => e.charId === null);
    expect(exp.length).toBe(2);
    expect(exp.every((e) => e.tick === land + ITEMS.drop.groundLifetime)).toBe(true);
    // the axis pad drops at 45 s (its own schedule)
    const axisInc = ofType(until, 'itemIncoming');
    expect(axisInc.map((e) => [e.padId, e.landTick])).toEqual([['pad.axis', secondsToTicks(ITEMS.drop.center[0]!)]]);
    expect(conserved(sim)).toBe(true);
  });

  it("items 'off' drops nothing; 'hammerOnly' drops hammers; no pads -> nothing", () => {
    const off = itemSim(itemLayout(), [0, 1], { items: 'off' });
    expect(ofType(stepN(off, secondsToTicks(50)), 'itemIncoming')).toEqual([]);
    const ho = itemSim(itemLayout(), [0, 1], { items: 'hammerOnly' });
    const evs = ofType(stepN(ho, secondsToTicks(50)), 'itemIncoming');
    expect(evs.length).toBe(3);
    expect(evs.every((e) => e.kind === 'hammer')).toBe(true);
    const none = itemSim(itemLayout({ pads: false }));
    expect(ofType(stepN(none, secondsToTicks(50)), 'itemIncoming')).toEqual([]);
  });

  it('a pair drop is skipped as a whole when one of its pads is still occupied', () => {
    const sim = itemSim();
    // a dropped hammer lying on the west pad when the 15 s pair is due
    stepN(sim, 10);
    give(sim, 0);
    place(sim, 0, PAD_W);
    sim.step(idle(2));
    expect(sim.state.items.length).toBe(0);
    ctxOf(sim).content!.items.dropHeld(1);
    const dropped = sim.state.items[0]!;
    expect(dropped.padId).toBe(null);
    dropped.padId = 'pad.w'; // pretend it is the west pad's own unpicked drop
    place(sim, 0, { x: 30, y: 50 });
    const evs = stepN(sim, secondsToTicks(16) - sim.state.tick);
    expect(ofType(evs, 'itemIncoming')).toEqual([]);
  });

  it('the deck is seeded: same seed -> same draws; consumption never touches the event stream', () => {
    const a = itemSim(itemLayout(), [0, 1], {}, 7);
    const b = itemSim(itemLayout(), [0, 1], {}, 7);
    const ea = stepN(a, secondsToTicks(130));
    const eb = stepN(b, secondsToTicks(130));
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    expect(a.state.eventPlan).toEqual(b.state.eventPlan);
  });
});

describe('items: pickup by touch', () => {
  function landed(): Simulation {
    const sim = itemSim();
    stepN(sim, secondsToTicks(ITEMS.drop.pairs[0]!));
    expect(sim.state.items.every((i) => i.phase === 'ground')).toBe(true);
    return sim;
  }

  it('walking onto a ground item takes it into the pocket with a fresh lifetime', () => {
    const sim = landed();
    const item = sim.state.items.find((i) => i.padId === 'pad.w')!;
    place(sim, 0, { x: PAD_W.x - 0.5, y: PAD_W.y });
    const evs = stepN(sim, 1);
    const pk = ofType(evs, 'itemPickup');
    expect(pk).toEqual([{ type: 'itemPickup', tick: sim.state.tick, charId: 1, itemId: item.id, kind: 'hammer' }]);
    const held = sim.state.characters[0]!.item!;
    expect(held).toMatchObject({ kind: 'hammer', uses: 5, phase: 'idle', cooldown: 0 });
    expect(held.expiresTick).toBe(sim.state.tick + ITEMS.specs.hammer.lifetimeTicks);
    expect(sim.state.items.some((i) => i.id === item.id)).toBe(false);
  });

  it('a full pocket ignores items (no swapping)', () => {
    const sim = landed();
    give(sim, 0, 'hammer', { uses: 2 });
    place(sim, 0, PAD_W);
    expect(ofType(stepN(sim, 5), 'itemPickup')).toEqual([]);
    expect(sim.state.characters[0]!.item!.uses).toBe(2);
  });

  it('same-tick contest: the closer center wins; an exact tie means nobody', () => {
    const sim = landed();
    // exact tie: mirrored around the pad
    place(sim, 0, { x: PAD_W.x - 0.6, y: PAD_W.y });
    place(sim, 1, { x: PAD_W.x + 0.6, y: PAD_W.y });
    expect(ofType(stepN(sim, 3), 'itemPickup')).toEqual([]);
    // team 1 steps a little closer
    place(sim, 1, { x: PAD_W.x + 0.5, y: PAD_W.y });
    const pk = ofType(stepN(sim, 1), 'itemPickup');
    expect(pk.map((e) => e.charId)).toEqual([2]);
  });

  it('a knocked-down character cannot pick up; walls block pickup', () => {
    const sim = itemSim(itemLayout({ statics: [{ id: 'w', kind: 'wall', center: { x: PAD_W.x, y: PAD_W.y + 0.45 }, half: { x: 2, y: 0.05 }, angle: 0, height: 2 }] }));
    stepN(sim, secondsToTicks(ITEMS.drop.pairs[0]!));
    place(sim, 0, { x: PAD_W.x, y: PAD_W.y + 0.85 }); // behind the wall, 0.85 m away
    expect(ofType(stepN(sim, 3), 'itemPickup')).toEqual([]);
    sim.state.characters[1]!.knockdownTicks = 30;
    place(sim, 1, { x: PAD_E.x, y: PAD_E.y });
    expect(ofType(stepN(sim, 3), 'itemPickup')).toEqual([]);
  });
});

describe('뿅망치: wind-up, swing, effects', () => {
  it('the wind-up is enforced for every slot: fire exactly windupTicks after the press, no hit before', () => {
    const teams: TeamId[] = [0, 0, 1, 1];
    for (let slot = 0; slot < 4; slot++) {
      const sim = itemSim(itemLayout(), teams);
      const team = teams[slot]!;
      const victim = teams.findIndex((t) => t !== team);
      // park everyone far apart, then the victim right in front of the hammerer (in reach at the press)
      for (let s = 0; s < 4; s++) place(sim, s, { x: 20 + s * 15, y: 10 });
      place(sim, slot, { x: 50, y: 30 });
      place(sim, victim, { x: 51.4, y: 30 });
      give(sim, slot);
      const { press, evs } = swing(sim, slot, { x: 1, y: 0 }, 20, 4);
      const use = ofType(evs, 'itemUse');
      expect(use.map((e) => [e.phase, e.tick - press])).toEqual([
        ['windup', 0],
        ['fire', ITEMS.hammer.windupTicks],
      ]);
      const hits = ofType(evs, 'itemHit');
      expect(hits.length).toBe(1);
      expect(hits[0]!.tick - press).toBeGreaterThanOrEqual(ITEMS.hammer.windupTicks);
      expect(hits[0]).toMatchObject({ charId: slot + 1, target: 'char', targetId: victim + 1, knockdown: true, kind: 'hammer' });
      expect(sim.state.characters[slot]!.item!.uses).toBe(ITEMS.specs.hammer.uses - 1);
      // no plain dash happened and the dash cooldown is untouched
      expect(ofType(evs, 'dash')).toEqual([]);
      expect(sim.state.characters[slot]!.dashCooldown).toBe(0);
    }
  });

  it('a KO: forced release, knockdown 60 ticks, 9 m/s knockback, bag spill and item drop', () => {
    const sim = itemSim(itemLayout({ safes: [{ kind: 'smallSafe', pos: { x: 52.5, y: 30 }, angle: 0 }, { kind: 'largeSafe', pos: { x: 50, y: 50 }, angle: 0 }] }));
    const safes = safeIds(sim);
    sim.debug.setAnchored(safes[0]!, false);
    place(sim, 0, { x: 50, y: 30 });
    place(sim, 1, { x: 51.5, y: 30 });
    fundBag(sim, 2, safes[1]!, 120);
    give(sim, 1, 'hammer', { uses: 3 });
    // the victim grabs the small safe east of it
    sim.step([cmd(), cmd(0, 0, true, false, { x: 1, y: 0 })]);
    expect(sim.state.characters[1]!.grab).not.toBe(null);
    give(sim, 0);
    const evs: SimEvent[] = [];
    const press = sim.step([cmd(0, 0, false, true, { x: 1, y: 0 }), cmd(0, 0, true)]);
    evs.push(...press);
    for (let t = 0; t < 7; t++) evs.push(...sim.step([cmd(0, 0, false, false, { x: 1, y: 0 }), cmd(0, 0, true)]));
    const hit = ofType(evs, 'itemHit')[0]!;
    expect(hit).toMatchObject({ charId: 1, targetId: 2, knockdown: true });
    const v = sim.state.characters[1]!;
    expect(v.grab).toBe(null);
    expect(ofType(evs, 'release').some((e) => e.charId === 2 && e.forced)).toBe(true);
    const sinceHit = sim.state.tick - hit.tick;
    expect(v.knockdownTicks).toBe(ITEMS.hammer.knockdownTicks - sinceHit);
    expect(ITEMS.hammer.knockdownTicks).toBeGreaterThan(KNOCKDOWN_TICKS);
    const spill = ofType(evs, 'bagSpilled');
    expect(spill).toMatchObject([{ charId: 2, value: 60, byId: 1, cause: 'hammer' }]);
    expect(v.bag).toBe(60);
    const drop = ofType(evs, 'itemDropped');
    expect(drop).toMatchObject([{ charId: 2, kind: 'hammer', uses: 3 }]);
    expect(v.item).toBe(null);
    expect(sim.state.items.some((i) => i.padId === null && i.uses === 3)).toBe(true);
    // spill / drop precede the itemHit in the log
    const order = evs.map((e) => e.type);
    expect(order.indexOf('bagSpilled')).toBeLessThan(order.indexOf('itemHit'));
    // knockback: the victim flew east fast
    const hitIdx = evs.indexOf(hit);
    expect(hitIdx).toBeGreaterThan(0);
    expect(conserved(sim)).toBe(true);
  });

  it('knockback speed: 9 m/s (golden ×1.5)', () => {
    for (const kind of ['hammer', 'goldHammer'] as const) {
      const sim = itemSim();
      place(sim, 0, { x: 50, y: 30 });
      place(sim, 1, { x: 51.5, y: 30 });
      give(sim, 0, kind);
      let vMax = 0;
      const c0 = [cmd(0, 0, false, true, { x: 1, y: 0 }), cmd()];
      sim.step(c0);
      for (let t = 0; t < 10; t++) {
        const evs = sim.step([cmd(0, 0, false, false, { x: 1, y: 0 }), cmd()]);
        if (ofType(evs, 'itemHit').length) {
          const ctx = ctxOf(sim);
          vMax = Math.hypot(ctx.chars[1]!.body.vx, ctx.chars[1]!.body.vy);
        }
      }
      const want = ITEMS.hammer.knockbackSpeed * (kind === 'goldHammer' ? ITEMS.goldHammer.knockbackScale : 1);
      // measured at the end of the hit tick (after drag of the remaining substeps)
      expect(vMax).toBeGreaterThan(want * 0.8);
      expect(vMax).toBeLessThanOrEqual(want + 1e-6);
    }
  });

  it('protect rule: a victim cannot be knocked down again within PROTECT_TICKS (only shoved, no spill)', () => {
    const sim = itemSim(itemLayout({ safes: [{ kind: 'largeSafe', pos: { x: 50, y: 50 }, angle: 0 }] }));
    const safes = safeIds(sim);
    place(sim, 0, { x: 50, y: 30 });
    place(sim, 1, { x: 51.5, y: 30 });
    give(sim, 0);
    swing(sim, 0, { x: 1, y: 0 }, 70, 2);
    const v = sim.state.characters[1]!;
    expect(v.knockdownTicks).toBe(0); // got up
    expect(v.protectTicks).toBeGreaterThan(0);
    fundBag(sim, 2, safes[0]!, 100);
    place(sim, 0, { x: 50, y: 30 });
    place(sim, 1, { x: 51.5, y: 30 });
    const { evs } = swing(sim, 0, { x: 1, y: 0 }, 16, 2);
    const hits = ofType(evs, 'itemHit');
    expect(hits.length).toBe(1);
    expect(hits[0]!.knockdown).toBe(false);
    expect(v.knockdownTicks).toBe(0);
    expect(ofType(evs, 'bagSpilled')).toEqual([]);
    expect(v.bag).toBe(100);
    expect(PROTECT_TICKS).toBeGreaterThan(ITEMS.hammer.knockdownTicks + ITEMS.hammer.windupTicks);
  });

  it('teammates are only shoved', () => {
    const sim = itemSim(itemLayout(), [0, 0]);
    place(sim, 0, { x: 50, y: 30 });
    place(sim, 1, { x: 51.5, y: 30 });
    give(sim, 0);
    const { evs } = swing(sim, 0, { x: 1, y: 0 }, 16, 2);
    expect(ofType(evs, 'itemHit').map((e) => e.knockdown)).toEqual([false]);
    expect(sim.state.characters[1]!.knockdownTicks).toBe(0);
  });

  it('cooldown 0.75 s between swings, 5 uses, then the hammer is gone (itemExpired)', () => {
    const sim = itemSim();
    place(sim, 0, { x: 50, y: 30 });
    give(sim, 0);
    const presses: number[] = [];
    for (let t = 0; t < 400; t++) {
      const evs = sim.step([cmd(0, 0, false, t % 2 === 0, { x: 0, y: 1 }), cmd()]);
      for (const e of ofType(evs, 'itemUse')) if (e.phase === 'windup') presses.push(e.tick);
      if (!sim.state.characters[0]!.item) break;
    }
    expect(presses.length).toBe(5);
    for (let i = 1; i < presses.length; i++) expect(presses[i]! - presses[i - 1]!).toBeGreaterThanOrEqual(ITEMS.specs.hammer.cooldownTicks);
    expect(sim.state.characters[0]!.item).toBe(null);
  });

  it('the lifetime ends the held hammer (itemExpired), golden hammer never expires by time', () => {
    const sim = itemSim();
    give(sim, 0, 'hammer', { expiresTick: sim.state.tick + 10 });
    give(sim, 1, 'goldHammer');
    const evs = stepN(sim, 12);
    expect(ofType(evs, 'itemExpired')).toMatchObject([{ charId: 1, itemId: null, kind: 'hammer' }]);
    expect(sim.state.characters[1]!.item!.expiresTick).toBe(ITEM_FOREVER);
  });

  it('holding loot, dash is the carry boost (R2); grabbing during the wind-up cancels the use', () => {
    const sim = itemSim(itemLayout({ safes: [{ kind: 'smallSafe', pos: { x: 51, y: 30 }, angle: 0 }, { kind: 'largeSafe', pos: { x: 50, y: 50 }, angle: 0 }] }));
    const safes = safeIds(sim);
    sim.debug.setAnchored(safes[0]!, false);
    place(sim, 0, { x: 50, y: 30 });
    give(sim, 0);
    sim.step([cmd(0, 0, true, false, { x: 1, y: 0 }), cmd()]);
    expect(sim.state.characters[0]!.grab).not.toBe(null);
    const evs = sim.step([cmd(0, 0, true, true, { x: 1, y: 0 }), cmd()]);
    expect(ofType(evs, 'dash')).toMatchObject([{ charId: 1, carrying: true }]);
    expect(ofType(evs, 'itemUse')).toEqual([]);
    // release, start a wind-up, grab again mid-wind-up -> cancelled, no use spent
    stepN(sim, 2);
    sim.step([cmd(0, 0, false, true, { x: 0, y: 1 }), cmd()]);
    expect(sim.state.characters[0]!.item!.phase).toBe('windup');
    sim.step([cmd(0, 0, true, false, { x: 1, y: 0 }), cmd()]);
    const after = stepN(sim, 10, () => [cmd(0, 0, true), cmd()]);
    expect(ofType(after, 'itemUse')).toEqual([]);
    expect(sim.state.characters[0]!.item!.uses).toBe(ITEMS.specs.hammer.uses);
    expect(sim.state.characters[0]!.item!.phase).toBe('idle');
  });

  it('uproot increments: small +1.0, large +0.5, bank +0.25 per hit', () => {
    const cases: { kind: 'smallSafe' | 'largeSafe'; hits: number }[] = [
      { kind: 'smallSafe', hits: 1 },
      { kind: 'largeSafe', hits: 2 },
    ];
    for (const c of cases) {
      const sim = itemSim(itemLayout({ safes: [{ kind: c.kind, pos: { x: 52, y: 30 }, angle: 0 }] }));
      const id = safeIds(sim)[0]!;
      place(sim, 0, { x: 50.2, y: 30 });
      give(sim, 0);
      const seen: number[] = [];
      let freed: Ev<'unanchored'> | undefined;
      for (let h = 0; h < c.hits; h++) {
        place(sim, 0, { x: 50.2, y: 30 });
        const { evs } = swing(sim, 0, { x: 1, y: 0 }, 50, 2);
        expect(ofType(evs, 'itemHit')).toMatchObject([{ target: 'loot', targetId: id }]);
        seen.push(sim.getLoot(id)!.unanchorProgress);
        freed ??= ofType(evs, 'unanchored')[0];
      }
      const step = ITEMS.hammer.progress[c.kind];
      expect(seen).toEqual(seen.map((_, i) => Math.min(1, step * (i + 1))));
      expect(sim.getLoot(id)!.anchored).toBe(false);
      expect(freed).toMatchObject({ lootId: id, byTeam: 0 });
    }
    // bank: 4 hits
    const sim = itemSim(itemLayout({ banks: [{ pos: { x: 50, y: 30 }, angle: 0 }], safes: [] }));
    const bank = lootIds(sim).banks[0]!;
    const before = sim.getLoot(bank)!.unanchorProgress;
    place(sim, 0, { x: 55.2, y: 30 }); // just east of the solid side wall (half x 4)
    give(sim, 0);
    swing(sim, 0, { x: -1, y: 0 }, 50, 2);
    expect(sim.getLoot(bank)!.unanchorProgress).toBeCloseTo(before + ITEMS.hammer.progress.bank, 9);
    expect(UNANCHOR_TICKS.bank).toBeGreaterThan(0);
  });

  it('a carried small safe hit directly: every grip breaks and it flies ~2.5 m', () => {
    const sim = itemSim(itemLayout({ safes: [{ kind: 'smallSafe', pos: { x: 52, y: 30 }, angle: 0 }, { kind: 'largeSafe', pos: { x: 50, y: 50 }, angle: 0 }] }));
    const id = safeIds(sim)[0]!;
    sim.debug.setAnchored(id, false);
    place(sim, 1, { x: 52, y: 31.05 });
    sim.step([cmd(), cmd(0, 0, true, false, { x: 0, y: -1 })]);
    expect(sim.state.characters[1]!.grab?.targetId).toBe(id);
    place(sim, 0, { x: 50.6, y: 30 });
    give(sim, 0);
    const x0 = sim.getLoot(id)!.pos.x;
    const { evs } = swing(sim, 0, { x: 1, y: 0 }, 120, 2, () => [cmd(), cmd(0, 0, true)]);
    const hit = ofType(evs, 'itemHit').find((e) => e.target === 'loot');
    expect(hit).toBeTruthy();
    expect(ofType(evs, 'release').some((e) => e.charId === 2 && e.forced)).toBe(true);
    const travelled = sim.getLoot(id)!.pos.x - x0;
    expect(travelled).toBeGreaterThan(1.8);
    expect(travelled).toBeLessThan(3.4);
  });

  it('breakables take 3 damage (a vending machine breaks in one hit)', () => {
    const vend: BreakableDef = { id: 'v1', kind: 'vending', center: { x: 52, y: 30 }, half: { ...BREAKABLE_SPECS.vending.half }, angle: 0 };
    const sim = itemSim(itemLayout({ breakables: [vend] }));
    place(sim, 0, { x: 50.6, y: 30 });
    give(sim, 0);
    const { evs } = swing(sim, 0, { x: 1, y: 0 }, 20, 2);
    expect(ofType(evs, 'breakableBroken')).toMatchObject([{ id: 'v1', byCharId: 1 }]);
    expect(ofType(evs, 'itemHit')).toMatchObject([{ target: 'breakable', targetId: 'v1' }]);
    expect(conserved(sim)).toBe(true);
  });

  it('fences break after 2 hammer hits (fenceBroken bankId -1, byCharId)', () => {
    const fence: FenceDef = { id: 'f1', center: { x: 52, y: 30 }, half: { x: 2, y: 0.1 }, angle: Math.PI / 2 };
    const sim = itemSim(itemLayout({ fences: [fence] }));
    place(sim, 0, { x: 51, y: 30 });
    give(sim, 0);
    const a = swing(sim, 0, { x: 1, y: 0 }, 50, 2).evs;
    expect(ofType(a, 'itemHit')).toMatchObject([{ target: 'fence', targetId: 'f1' }]);
    expect(ofType(a, 'fenceBroken')).toEqual([]);
    place(sim, 0, { x: 51, y: 30 });
    const b = swing(sim, 0, { x: 1, y: 0 }, 50, 2).evs;
    expect(ofType(b, 'fenceBroken')).toMatchObject([{ fenceId: 'f1', bankId: -1, byCharId: 1 }]);
    expect(sim.state.fences[0]!.broken).toBe(true);
  });

  it('no hits through walls', () => {
    const sim = itemSim(itemLayout({ statics: [{ id: 'w', kind: 'wall', center: { x: 50.7, y: 30 }, half: { x: 0.05, y: 2 }, angle: 0, height: 2 }] }));
    place(sim, 0, { x: 50, y: 30 });
    place(sim, 1, { x: 51.5, y: 30 });
    give(sim, 0);
    const { evs } = swing(sim, 0, { x: 1, y: 0 }, 20, 2);
    expect(ofType(evs, 'itemHit')).toEqual([]);
  });

  it('hammer vs hammer in the same substep: both bounce, each loses one more use, 챙!', () => {
    const sim = itemSim();
    place(sim, 0, { x: 49, y: 30 });
    place(sim, 1, { x: 51, y: 30 });
    give(sim, 0);
    give(sim, 1);
    const evs: SimEvent[] = [];
    evs.push(...sim.step([cmd(0, 0, false, true, { x: 1, y: 0 }), cmd(0, 0, false, true, { x: -1, y: 0 })]));
    for (let t = 0; t < 20; t++) evs.push(...sim.step([cmd(0, 0, false, false, { x: 1, y: 0 }), cmd(0, 0, false, false, { x: -1, y: 0 })]));
    expect(ofType(evs, 'itemClash')).toMatchObject([{ aId: 1, bId: 2 }]);
    expect(ofType(evs, 'itemHit')).toEqual([]);
    expect(sim.state.characters.map((c) => c.knockdownTicks)).toEqual([0, 0]);
    expect(sim.state.characters.map((c) => c.item!.uses)).toEqual([3, 3]);
    // mirrored outcome
    const [a, b] = sim.state.characters;
    expect(a!.pos.x + b!.pos.x).toBeCloseTo(100, 6);
    expect(a!.pos.x).toBeLessThan(49);
  });
});

describe('뿅망치: police stun', () => {
  it('stuns an officer for 3 s (golden 4 s), respecting the re-stun immunity', () => {
    const layout = itemLayout({ banks: [{ pos: { x: 50, y: 40 }, angle: 0 }], safes: [{ kind: 'largeSafe', pos: { x: 20, y: 20 }, angle: 0 }] });
    const sim = itemSim(layout, [0, 0, 1, 1], { police: true });
    const bank = lootIds(sim).banks[0]!;
    sim.debug.setAnchored(bank, false);
    for (let t = 0; t < POLICE.dispatchDelayTicks + POLICE.arriveTicks + 300; t++) {
      sim.step(idle(4));
      if (sim.state.police.length && sim.state.police.every((o) => o.phase !== 'arriving')) break;
    }
    expect(sim.state.police.length).toBeGreaterThan(0);
    const o = sim.state.police[0]!;
    for (const [kind, ticks] of [
      ['hammer', ITEMS.hammer.policeStunTicks],
      ['goldHammer', ITEMS.goldHammer.policeStunTicks],
    ] as const) {
      while (o.phase === 'stunned') sim.step(idle(4));
      stepN(sim, secondsToTicks(1.2)); // re-stun immunity over
      give(sim, 0, kind);
      const evs: SimEvent[] = [];
      for (let t = 0; t < 16; t++) {
        const me = sim.state.characters[0]!;
        if (t === 0) sim.debug.teleport(1, { x: o.pos.x - 1.5, y: o.pos.y }, 0);
        const aim = { x: o.pos.x - me.pos.x, y: o.pos.y - me.pos.y };
        const c = idle(4);
        c[0] = cmd(0, 0, false, t === 0, aim);
        evs.push(...sim.step(c));
        if (ofType(evs, 'itemHit').length) break;
      }
      const hit = ofType(evs, 'itemHit');
      expect(hit).toMatchObject([{ target: 'police', targetId: o.id, knockdown: true, kind }]);
      expect(ofType(evs, 'policeStunned')).toMatchObject([{ officerId: o.id, byCharId: 1 }]);
      expect(o.phase).toBe('stunned');
      expect(o.stunTicks).toBeGreaterThan(ticks - 3);
      expect(o.stunTicks).toBeLessThanOrEqual(ticks);
      sim.state.characters[0]!.item = null;
    }
    // immune right after getting up: a hit only shoves
    while (o.phase === 'stunned') sim.step(idle(4));
    give(sim, 0);
    sim.debug.teleport(1, { x: o.pos.x - 1.5, y: o.pos.y }, 0);
    const evs: SimEvent[] = [];
    for (let t = 0; t < 16; t++) {
      const me = sim.state.characters[0]!;
      const c = idle(4);
      c[0] = cmd(0, 0, false, t === 0, { x: o.pos.x - me.pos.x, y: o.pos.y - me.pos.y });
      evs.push(...sim.step(c));
    }
    const hit = ofType(evs, 'itemHit');
    if (hit.length) expect(hit[0]!.knockdown).toBe(false);
    expect(ofType(evs, 'policeStunned')).toEqual([]);
  });
});

describe('황금 뿅망치 timing', () => {
  it('no countdown: lands on the axis pad at end − 35 s, announced 3 s ahead, replacing the axis item', () => {
    const sim = itemSim(itemLayout(), [0, 1], { matchTicks: secondsToTicks(80) });
    const G = ITEMS.drop.goldHammer;
    const land = secondsToTicks(80) - G.beforeEndTicks; // 45 s: the axis hammer is due at the same time
    const evs = stepN(sim, land + 2);
    const gold = ofType(evs, 'itemIncoming').filter((e) => e.kind === 'goldHammer');
    expect(gold).toMatchObject([{ padId: 'pad.axis', landTick: land, tick: land - G.announceTicks }]);
    const spawn = ofType(evs, 'itemSpawn').filter((e) => e.kind === 'goldHammer');
    expect(spawn.map((e) => e.tick)).toEqual([land]);
    // the axis pad holds only the golden hammer
    expect(sim.state.items.filter((i) => i.padId === 'pad.axis').map((i) => i.kind)).toEqual(['goldHammer']);
    // pick it up: 8 swings, never expires
    place(sim, 0, PAD_AXIS);
    stepN(sim, 1);
    expect(sim.state.characters[0]!.item).toMatchObject({ kind: 'goldHammer', uses: 8, expiresTick: ITEM_FOREVER });
    // once per match
    const rest = stepN(sim, secondsToTicks(40));
    expect(ofType(rest, 'itemIncoming').filter((e) => e.kind === 'goldHammer')).toEqual([]);
  });

  it('countdown path: final countdown + 8 s (announced at + 5 s), once', () => {
    const layout = itemLayout({
      banks: [
        { pos: { x: 50, y: 12 }, angle: 0 },
        { pos: { x: 50, y: 48 }, angle: Math.PI },
      ],
      safes: [{ kind: 'largeSafe', pos: { x: 30, y: 30 }, angle: 0 }],
    });
    const sim = itemSim(layout, [0, 1]);
    const [b1, b2] = lootIds(sim).banks;
    stepN(sim, 60);
    for (const [b, z] of [
      [b1!, sim.layout.zones[0]!],
      [b2!, sim.layout.zones[1]!],
    ] as const) {
      sim.debug.setAnchored(b, false);
      sim.debug.teleport(b, { x: z.center.x, y: z.center.y }, 0);
    }
    const evs = stepN(sim, secondsToTicks(12));
    const fct = sim.state.finalCountdownTick;
    expect(fct).not.toBe(null);
    const G = ITEMS.drop.goldHammer;
    const gold = ofType(evs, 'itemIncoming').filter((e) => e.kind === 'goldHammer');
    expect(gold).toMatchObject([{ padId: 'pad.axis', tick: fct! + G.afterCountdownTicks - G.announceTicks, landTick: fct! + G.afterCountdownTicks }]);
    expect(ofType(evs, 'itemSpawn').filter((e) => e.kind === 'goldHammer').map((e) => e.tick)).toEqual([fct! + G.afterCountdownTicks]);
    const rest = stepN(sim, secondsToTicks(30));
    expect(ofType(rest, 'itemIncoming').filter((e) => e.kind === 'goldHammer')).toEqual([]);
    expect(conserved(sim)).toBe(true);
  });

  it('golden hammer: wider arc (±80° vs ±70°): a rival at 75° off the aim is hit only by the golden one', () => {
    for (const [kind, hit] of [
      ['hammer', false],
      ['goldHammer', true],
    ] as const) {
      const sim = itemSim();
      const a = (75 * Math.PI) / 180;
      place(sim, 0, { x: 50, y: 30 });
      place(sim, 1, { x: 50 + Math.cos(a) * 1.2, y: 30 + Math.sin(a) * 1.2 });
      give(sim, 0, kind);
      const { evs } = swing(sim, 0, { x: 1, y: 0 }, 20, 2);
      expect(ofType(evs, 'itemHit').length > 0).toBe(hit);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Fairness: mirrored commands -> mirrored outcomes; slot order never decides
// ---------------------------------------------------------------------------------------------

describe('items: fairness', () => {
  it('mirror: mirrored hammer swings, pickups and drops give mirrored outcomes (bit-exact x + x\' = 100)', () => {
    const layout = itemLayout({
      safes: [
        { kind: 'smallSafe', pos: { x: 42.5, y: 36 }, angle: 0 },
        { kind: 'smallSafe', pos: { x: 57.5, y: 36 }, angle: 0 },
        { kind: 'largeSafe', pos: { x: 50, y: 52 }, angle: 0 },
      ],
      breakables: [
        { id: 'c.w', kind: 'crate', center: { x: 44, y: 24 }, half: { ...BREAKABLE_SPECS.crate.half }, angle: 0 },
        { id: 'c.e', kind: 'crate', center: { x: 56, y: 24 }, half: { ...BREAKABLE_SPECS.crate.half }, angle: 0 },
      ],
    });
    // slots: 0 team0 hammerer (west), 1 team1 victim (west), 2 team1 hammerer (east), 3 team0 victim (east)
    const sim = itemSim(layout, [0, 1, 1, 0], { police: false });
    const safes = safeIds(sim);
    const big = safes[2]!;
    fundBag(sim, 2, big, 80);
    fundBag(sim, 4, big, 80);
    place(sim, 0, { x: 40, y: 30 });
    place(sim, 1, { x: 41.4, y: 30.3 });
    place(sim, 2, { x: 60, y: 30 });
    place(sim, 3, { x: 58.6, y: 30.3 });
    give(sim, 0);
    give(sim, 2);
    const mirror = (v: Vec2): Vec2 => ({ x: -v.x, y: v.y });
    const script = (t: number): Command[] => {
      const west0 = t < 40 ? cmd(0, 0, false, t === 0 || t === 50, { x: 1, y: 0.2 }) : t < 140 ? cmd(0.6, -0.8, false, t === 100) : cmd(0, 1, false, t % 30 === 0);
      const west1 = t < 30 ? cmd() : cmd(0.3, 0.9, t > 60 && t < 160);
      const m = (c: Command): Command => ({ ...c, move: mirror(c.move), aim: c.aim ? mirror(c.aim) : null });
      return [west0, west1, m(west0), m(west1)];
    };
    for (let t = 0; t < 900; t++) {
      sim.step(script(t));
      const ch = sim.state.characters;
      for (const [a, b] of [
        [0, 2],
        [1, 3],
      ] as const) {
        expect(ch[a]!.pos.x + ch[b]!.pos.x).toBe(100);
        expect(ch[a]!.pos.y).toBe(ch[b]!.pos.y);
        expect(ch[a]!.knockdownTicks).toBe(ch[b]!.knockdownTicks);
        expect(ch[a]!.bag).toBe(ch[b]!.bag);
        expect(ch[a]!.item?.uses ?? -1).toBe(ch[b]!.item?.uses ?? -1);
      }
    }
    const hits = ofType(sim.eventLog, 'itemHit');
    expect(hits.filter((h) => h.target === 'char' && h.knockdown).length).toBe(2);
    // dropped items at mirrored spots, pad drops always in twins
    const inc = ofType(sim.eventLog, 'itemIncoming').filter((e) => e.padId !== 'pad.axis');
    expect(inc.length % 2).toBe(0);
    expect(conserved(sim)).toBe(true);
  });

  /** One hammer swing scenario with the two characters in either slot order. */
  function permuted(swap: boolean): { log: string; state: string } {
    const layout = itemLayout({ safes: [{ kind: 'smallSafe', pos: { x: 52.6, y: 31 }, angle: 0 }, { kind: 'largeSafe', pos: { x: 50, y: 52 }, angle: 0 }] });
    const sH = swap ? 1 : 0; // hammerer slot (team 0)
    const sV = swap ? 0 : 1; // victim slot (team 1)
    const teams: TeamId[] = swap ? [1, 0] : [0, 1];
    const sim = itemSim(layout, teams);
    const safes = safeIds(sim);
    fundBag(sim, sV + 1, safes[1]!, 70);
    place(sim, sH, { x: 50, y: 30 });
    place(sim, sV, { x: 51.4, y: 30.2 });
    give(sim, sH);
    give(sim, sV, 'hammer', { uses: 2 });
    for (let t = 0; t < 200; t++) {
      const c: Command[] = [cmd(), cmd()];
      c[sH] = cmd(t > 40 ? 0.5 : 0, 0, false, t === 0 || t === 60, { x: 1, y: 0.1 });
      c[sV] = cmd(0, t > 20 ? 0.4 : 0, false, t === 80);
      sim.step(c);
    }
    const idMap = (id: number): string => (id === sH + 1 ? 'H' : id === sV + 1 ? 'V' : String(id));
    const charKeys = new Set(['charId', 'attackerId', 'victimId', 'byCharId', 'byId', 'aId', 'bId']);
    const norm = sim.eventLog.map((e) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e)) {
        if (charKeys.has(k) && typeof v === 'number') o[k] = idMap(v);
        else if (k === 'targetId' && e.type === 'itemHit' && e.target === 'char') o[k] = idMap(v as number);
        else if (k === 'sourceId' && e.type === 'coinSpawn' && e.source === 'spill') o[k] = idMap(v as number);
        else o[k] = v;
      }
      // physics reports a contact pair in body order: compare the pair as a set
      if (e.type === 'bump') [o.aId, o.bId] = [String(o.aId), String(o.bId)].sort();
      return o;
    });
    const chars = [sH, sV].map((s) => {
      const c = sim.state.characters[s]!;
      return { pos: c.pos, vel: c.vel, kd: c.knockdownTicks, bag: c.bag, item: c.item };
    });
    return { log: JSON.stringify(norm), state: JSON.stringify({ chars, coins: sim.state.coins, items: sim.state.items, scores: sim.state.scores }) };
  }

  it('a hammer swing resolves identically regardless of slot order (permuted slots, same log)', () => {
    const a = permuted(false);
    const b = permuted(true);
    expect(b.log).toBe(a.log);
    expect(b.state).toBe(a.state);
  });
});
