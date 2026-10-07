/**
 * [C3] Props (content-plan §3.1, §5.1): 동전 ATM tug-spurt and bonk, 대왕 돼지저금통 kick / cracks /
 * smash, 돈나무 shed-on-impact, the hammer / hazard entry points, and value conservation.
 * Flights (flyBody) and the physics fuzz live in props-flight.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { PROP_RULES, PROP_SPECS } from '../../src/sim/config';
import { knockDown } from '../../src/sim/actions';
import type { SimContext } from '../../src/sim/context';
import { addUnanchorProgress, mirrorValues } from '../../src/sim/props';
import { computeRemainingValue } from '../../src/sim/rules';
import { Simulation } from '../../src/sim/sim';
import type { Command, LayoutDef, PropPlacementDef, RuleConfig, SimEvent, StaticBoxDef, TeamId, Vec2 } from '../../src/sim/types';
import { cmd, makeSim, openLayout } from './fixtures/layouts';

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(evs: SimEvent[], t: T): Ev<T>[] => evs.filter((e): e is Ev<T> => e.type === t);
const ctxOf = (sim: Simulation): SimContext => (sim as unknown as { ctx: SimContext }).ctx;
const conserved = (sim: Simulation): boolean => {
  const st = sim.state;
  return st.scores[0] + st.scores[1] + st.remainingValue === st.totalValue && computeRemainingValue(st) === st.remainingValue;
};

/** 100 x 60 open arena with a v2 composition of props (no items / events). */
function propLayout(props: PropPlacementDef[], statics: StaticBoxDef[] = []): LayoutDef {
  const base = openLayout({ statics });
  return { ...base, v2: { safes: [], props, breakables: [], gimmicks: [], itemPads: [], eventSpots: [{ x: 50, y: 30 }] } };
}

function propSim(props: PropPlacementDef[], teams: TeamId[] = [0, 1], o: { statics?: StaticBoxDef[]; rules?: Partial<RuleConfig> } = {}): Simulation {
  return makeSim(propLayout(props, o.statics), teams, { content: 'v2', items: 'off', events: 'off', ...o.rules });
}

const wallBox = (x: number, y: number, hx: number, hy: number): StaticBoxDef => ({ id: `w${x}_${y}`, kind: 'wall', center: { x, y }, half: { x: hx, y: hy }, angle: 0, height: 2 });

/** Run with per-tick commands, checking conservation every tick; returns all events. */
function play(sim: Simulation, n: number, cmds: (t: number) => (Command | undefined)[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < n; t++) {
    out.push(...sim.step(cmds(t)));
    expect(conserved(sim)).toBe(true);
    if (sim.state.over) break;
  }
  return out;
}

const idle = (n: number): Command[] => Array.from({ length: n }, () => cmd());
const at = (slot: number, c: Command, n = 2): Command[] => idle(n).map((x, i) => (i === slot ? c : x));
/** A dash toward +x / -x / any heading (aim sets the facing). */
const dash = (dx: number, dy = 0): Command => cmd(0, 0, false, true, { x: dx, y: dy });

describe('build (buildProps)', () => {
  it('appends props after the safes with shell / inner values, bodies and the piggy free-standing', () => {
    const sim = propSim([
      { variant: 'atm', pos: { x: 30, y: 20 }, angle: 0 },
      { variant: 'piggy', pos: { x: 50, y: 30 }, angle: 0 },
      { variant: 'moneyTree', pos: { x: 50, y: 40 }, angle: 0 },
    ]);
    const st = sim.state;
    expect(st.loot.map((l) => [l.id, l.variant, l.kind, l.baseValue, l.innerValue, l.estimatedValue, l.anchored])).toEqual([
      [3, 'atm', 'largeSafe', 100, 100, 200, true],
      [4, 'piggy', 'largeSafe', 0, 300, 300, false],
      [5, 'moneyTree', 'largeSafe', 100, 200, 300, true],
    ]);
    expect(st.loot[1]!.cracks).toBe(0);
    expect(st.totalValue).toBe(800);
    const ctx = ctxOf(sim);
    expect(ctx.loot.map((r) => r.body.motion)).toEqual(['static', 'dynamic', 'static']);
    expect(ctx.loot[1]!.body.shapes[0]!.type).toBe(1); // circle
    expect(ctx.loot[1]!.body.kickable).toBe(true);
    expect(st.loot[1]!.half).toEqual({ x: 0.75, y: 0.75 }); // grab / zone tests use the bounding square
  });
});

describe('carry speeds (content-plan §4.3, ±15%)', () => {
  /** Terminal speed of a freed prop pulled east by one raccoon holding its east face. */
  function carry(variant: PropPlacementDef['variant']): number {
    const sim = propSim([{ variant, pos: { x: 30, y: 30 }, angle: 0 }]);
    // (the gold safe is not a layout prop — C5 builds it — but buildProps makes the same body)
    const l = sim.state.loot[0]!;
    if (l.anchored) sim.debug.setAnchored(l.id, false);
    sim.debug.teleport(1, { x: 30 + l.half.x + 0.55, y: 30 }, Math.PI);
    sim.step([cmd(0, 0, true, false, { x: -1, y: 0 }), cmd()]);
    expect(l.grabbedBy).toEqual([1]);
    for (let t = 0; t < 480; t++) sim.step([cmd(1, 0, true), cmd()]);
    return Math.hypot(l.vel.x, l.vel.y);
  }
  const within = (v: number, target: number): void => {
    expect(v).toBeGreaterThan(target * 0.85);
    expect(v).toBeLessThan(target * 1.15);
  };
  it('ATM ~3.2, piggy ~4.5, 돈나무 ~3.0, gold safe ~2.7 m/s', () => {
    const m = { atm: carry('atm'), piggy: carry('piggy'), moneyTree: carry('moneyTree'), goldSafe: carry('goldSafe') };
    within(m.atm, 3.2);
    within(m.piggy, 4.5);
    within(m.moneyTree, 3.0);
    within(m.goldSafe, 2.7);
    // eslint-disable-next-line no-console
    console.log('[measured prop carry speeds m/s]', Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(3)])));
  });
});

describe('동전 ATM', () => {
  it('tug-spurt: 2 coins at 1/3 and 2 at 2/3 of the 3 s uproot, away from the puller; the rest rides inside', () => {
    const sim = propSim([{ variant: 'atm', pos: { x: 50, y: 30 }, angle: 0 }]);
    const atm = sim.state.loot[0]!;
    sim.debug.teleport(1, { x: 50 - 0.55 - 0.6, y: 30 }, 0); // west of it, facing it
    const evs = play(sim, PROP_SPECS.atm.uprootTicks + 20, (t) => at(0, cmd(t === 0 ? 0 : -1, 0, true)));
    const spurts = ofType(evs, 'coinSpawn').filter((e) => e.source === 'spurt');
    expect(spurts.map((e) => e.total)).toEqual([20, 20]);
    expect(spurts.every((e) => e.sourceId === atm.id && e.byCharId === 1)).toBe(true);
    expect(spurts.every((e) => e.pos.x > 50)).toBe(true); // out of the far side
    const ut = ofType(evs, 'unanchored')[0]!.tick;
    expect(spurts[0]!.tick).toBeLessThan(spurts[1]!.tick);
    expect(spurts[1]!.tick).toBeLessThanOrEqual(ut + 1);
    expect(atm.innerValue).toBe(60);
    expect(atm.estimatedValue).toBe(160);
    expect(atm.anchored).toBe(false);
  });

  it('progress from any source spurts (hammer / quake via addUnanchorProgress)', () => {
    const sim = propSim([{ variant: 'atm', pos: { x: 50, y: 30 }, angle: 0 }]);
    const ctx = ctxOf(sim);
    sim.step(idle(2));
    addUnanchorProgress(ctx, 3, 0.7, null);
    const evs = play(sim, 2, () => idle(2));
    expect(ofType(evs, 'coinSpawn').filter((e) => e.source === 'spurt').length).toBe(2);
    expect(sim.state.loot[0]!.innerValue).toBe(60);
  });

  it('dash bonk: >= 4 m/s pops 2 coins, then a 0.5 s cooldown per ATM', () => {
    const sim = propSim([{ variant: 'atm', pos: { x: 50, y: 30 }, angle: 0 }], [0, 1]);
    sim.debug.teleport(1, { x: 47.5, y: 30 }, 0);
    sim.debug.teleport(2, { x: 50, y: 32.6 }, -Math.PI / 2);
    const evs = play(sim, 60, (t) => [t === 0 ? dash(1) : cmd(), t === 8 ? dash(0, -1) : cmd()]);
    const hits = ofType(evs, 'propHit');
    expect(hits.length).toBe(1); // the second bonk came inside the cooldown
    expect(hits[0]).toMatchObject({ lootId: 3, byCharId: 1, how: 'dash', coins: 2 });
    const spawn = ofType(evs, 'coinSpawn')[0]!;
    expect(spawn.source).toBe('bonk');
    expect(spawn.pos.x).toBeGreaterThan(50); // fanned along the hit
    expect(sim.state.loot[0]!.innerValue).toBe(80);
    // after the cooldown a bonk lands again
    sim.debug.teleport(2, { x: 50, y: 32.6 }, -Math.PI / 2);
    const later = play(sim, 300, (t) => [cmd(), t === 240 ? dash(0, -1) : cmd()]);
    expect(ofType(later, 'propHit').map((e) => e.byCharId)).toEqual([2]);
  });
});

describe('대왕 돼지저금통', () => {
  /** Kick it once from a standstill: returns the travel distance and the events. */
  function kick(): { travel: number; evs: SimEvent[]; sim: Simulation } {
    const sim = propSim([{ variant: 'piggy', pos: { x: 40, y: 30 }, angle: 0 }]);
    sim.debug.teleport(1, { x: 40 - 0.75 - 0.45 - 0.4, y: 30 }, 0);
    const evs = play(sim, 400, (t) => at(0, t === 0 ? dash(1) : cmd()));
    return { travel: sim.state.loot[0]!.pos.x - 40, evs, sim };
  }

  it('a dash kicks it 5–7 m on a flat surface; the first kick never cracks', () => {
    const { travel, evs, sim } = kick();
    expect(travel).toBeGreaterThanOrEqual(5);
    expect(travel).toBeLessThanOrEqual(7);
    expect(ofType(evs, 'propHit')).toMatchObject([{ lootId: 3, how: 'dash', byCharId: 1, coins: 0 }]);
    expect(ofType(evs, 'piggyCrack')).toEqual([]);
    expect(sim.state.loot[0]!.lastHolder).toBe(1);
  });

  it('walking into it is a soft push (no kick)', () => {
    const sim = propSim([{ variant: 'piggy', pos: { x: 40, y: 30 }, angle: 0 }]);
    sim.debug.teleport(1, { x: 38, y: 30 }, 0);
    play(sim, 30, () => at(0, cmd(1, 0)));
    play(sim, 200, () => idle(2));
    expect(sim.state.loot[0]!.pos.x - 40).toBeLessThan(1.5);
  });

  it('kicks by alternating teams crack it; the third crack smashes it: radial jackpot, shell out of play', () => {
    const sim = propSim([{ variant: 'piggy', pos: { x: 50, y: 30 }, angle: 0 }], [0, 1]);
    const pig = sim.state.loot[0]!;
    const all: SimEvent[] = [];
    // team 0 kicks east, team 1 kicks west, ... (4 kicks: no crack, crack, crack, smash)
    for (let k = 0; k < 4; k++) {
      const slot = k % 2;
      const dir = slot === 0 ? 1 : -1;
      sim.debug.teleport(slot + 1, { x: pig.pos.x - dir * 1.6, y: pig.pos.y }, slot === 0 ? 0 : Math.PI);
      sim.debug.teleport(2 - slot, { x: pig.pos.x, y: pig.pos.y + 8 }, 0);
      sim.debug.setVelocity(pig.id, { x: 0, y: 0 });
      all.push(...play(sim, 300, (t) => at(slot, t === 0 ? dash(dir) : cmd())));
    }
    const cracks = ofType(all, 'piggyCrack');
    expect(cracks.map((e) => [e.cracks, e.smashed, e.byCharId])).toEqual([
      [1, false, 2],
      [2, false, 1],
      [3, true, 2],
    ]);
    const burst = ofType(all, 'coinSpawn').filter((e) => e.source === 'smash');
    expect(burst.length).toBe(1);
    expect(burst[0]!.total).toBe(300);
    expect(burst[0]!.ids.length).toBe(PROP_SPECS.piggy.inner.c10 + PROP_SPECS.piggy.inner.c50);
    expect(pig.recovered).toBe(true);
    expect(pig.recoveredBy).toBeNull();
    expect(pig.innerValue).toBe(0);
    expect(ofType(all, 'recovered')).toEqual([]);
    expect(ctxOf(sim).loot[0]!.body.enabled).toBe(false);
  });

  it('a teammate kick never cracks it', () => {
    const sim = propSim([{ variant: 'piggy', pos: { x: 50, y: 30 }, angle: 0 }], [0, 0]);
    const pig = sim.state.loot[0]!;
    const evs: SimEvent[] = [];
    for (let k = 0; k < 3; k++) {
      const slot = k % 2;
      sim.debug.teleport(slot + 1, { x: pig.pos.x - 1.6, y: pig.pos.y }, 0);
      sim.debug.teleport(2 - slot, { x: pig.pos.x, y: pig.pos.y + 8 }, 0);
      evs.push(...play(sim, 300, (t) => at(slot, t === 0 ? dash(1) : cmd())));
    }
    expect(ofType(evs, 'propHit').length).toBe(3);
    expect(ofType(evs, 'piggyCrack')).toEqual([]);
  });

  it('a hard knock into a wall (>= 5 m/s) cracks it once per knock', () => {
    const sim = propSim([{ variant: 'piggy', pos: { x: 50, y: 30 }, angle: 0 }], [0, 1], { statics: [wallBox(56, 30, 0.5, 6)] });
    const pig = sim.state.loot[0]!;
    sim.step(idle(2));
    sim.debug.setVelocity(pig.id, { x: 12, y: 0 });
    const evs = play(sim, 120, () => idle(2));
    expect(ofType(evs, 'piggyCrack').map((e) => e.cracks)).toEqual([1]);
    expect(ofType(evs, 'propHit')[0]).toMatchObject({ how: 'impact' });
    // a slow roll into the wall does nothing
    sim.debug.teleport(pig.id, { x: 53, y: 30 });
    sim.step(idle(2));
    sim.debug.setVelocity(pig.id, { x: 5, y: 0 });
    expect(ofType(play(sim, 120, () => idle(2)), 'piggyCrack')).toEqual([]);
  });
});

describe('돈나무', () => {
  function treeSim(statics: StaticBoxDef[] = []): Simulation {
    return propSim([{ variant: 'moneyTree', pos: { x: 50, y: 30 }, angle: Math.PI / 2 }], [0, 1], { statics });
  }

  it('uproots in 2.5 s', () => {
    const sim = treeSim();
    sim.debug.teleport(1, { x: 50 - 0.4 - 0.6, y: 30 }, 0);
    const evs = play(sim, 200, (t) => at(0, cmd(t === 0 ? 0 : -1, 0, true)));
    const u = ofType(evs, 'unanchored')[0]!;
    expect(u.tick).toBeGreaterThanOrEqual(PROP_SPECS.moneyTree.uprootTicks);
    expect(u.tick).toBeLessThanOrEqual(PROP_SPECS.moneyTree.uprootTicks + 3);
  });

  it('sheds at most 1 bundle per impact event (debounced 0.3 s), one per separate impact', () => {
    const sim = treeSim([wallBox(56, 30, 0.5, 6)]);
    const tree = sim.state.loot[0]!;
    sim.debug.setAnchored(tree.id, false);
    const knock = (x: number, v: number): SimEvent[] => {
      sim.debug.teleport(tree.id, { x, y: 30 }, Math.PI / 2);
      sim.step(idle(2));
      sim.debug.setVelocity(tree.id, { x: v, y: 0 });
      return play(sim, 90, () => idle(2));
    };
    // one hard impact (with its settling contacts) -> one bundle
    let evs = knock(54, 9);
    expect(ofType(evs, 'propHit').length).toBe(1);
    expect(ofType(evs, 'coinSpawn').map((e) => [e.source, e.total])).toEqual([['shed', 50]]);
    expect(tree.innerValue).toBe(150);
    expect(tree.estimatedValue).toBe(250);
    // a second, separate impact sheds again
    evs = knock(54, 9);
    expect(ofType(evs, 'propHit').length).toBe(1);
    expect(tree.innerValue).toBe(100);
    // a gentle bump (< 2.5 m/s) sheds nothing
    expect(ofType(knock(54.8, 2), 'propHit')).toEqual([]);
    expect(tree.innerValue).toBe(100);
  });

  it('a raccoon walking into a resting tree sheds nothing; dashes never drain an anchored tree', () => {
    const sim = treeSim();
    sim.debug.teleport(1, { x: 47, y: 30 }, 0);
    expect(ofType(play(sim, 60, () => at(0, cmd(1, 0))), 'propHit')).toEqual([]);
    // dash farming the anchored tree (one dash per dash cooldown, both teams): nothing sheds
    for (let k = 0; k < 4; k++) {
      sim.debug.teleport(1 + (k % 2), { x: k % 2 ? 52 : 48, y: 30 }, k % 2 ? Math.PI : 0);
      const evs = play(sim, 70, (t) => at(k % 2, t === 0 ? dash(k % 2 ? -1 : 1) : cmd()));
      expect(ofType(evs, 'propHit')).toEqual([]);
    }
    expect(sim.state.loot[0]!.innerValue).toBe(200);
    expect(sim.state.loot[0]!.anchored).toBe(true);
  });

  it('a dash into an uprooted tree is a bump: sheds one', () => {
    const sim = treeSim();
    sim.debug.setAnchored(sim.state.loot[0]!.id, false);
    sim.debug.teleport(1, { x: 48, y: 30 }, 0);
    const evs = play(sim, 60, (t) => at(0, t === 0 ? dash(1) : cmd()));
    expect(ofType(evs, 'propHit')).toMatchObject([{ how: 'dash', byCharId: 1, coins: 1 }]);
    expect(sim.state.loot[0]!.innerValue).toBe(150);
  });

  it('its carrier knocked down sheds a bundle', () => {
    const sim = treeSim();
    const tree = sim.state.loot[0]!;
    sim.debug.setAnchored(tree.id, false);
    sim.debug.teleport(1, { x: 50 - 0.4 - 0.6, y: 30 }, 0);
    play(sim, 5, () => at(0, cmd(0, 0, true)));
    expect(sim.state.characters[0]!.grab?.targetId).toBe(tree.id);
    const ctx = ctxOf(sim);
    knockDown(ctx, 0, -6, 0, 'dash', 2);
    ctx.content!.props.postTick();
    expect(tree.innerValue).toBe(150);
    expect(conserved(sim)).toBe(true);
  });
});

describe('entry points for items / gimmicks / events', () => {
  it('hammerHit: ATM +0.5 and 3 coins, 돈나무 +0.4 and 2 bundles, piggy 2 cracks; false for a plain safe', () => {
    const layout = propLayout([
      { variant: 'atm', pos: { x: 30, y: 30 }, angle: 0 },
      { variant: 'moneyTree', pos: { x: 50, y: 30 }, angle: 0 },
      { variant: 'piggy', pos: { x: 70, y: 30 }, angle: 0 },
    ]);
    layout.v2!.safes = [{ kind: 'smallSafe', pos: { x: 50, y: 45 }, angle: 0 }];
    const sim = makeSim(layout, [0, 1], { content: 'v2', items: 'off', events: 'off' });
    const ctx = ctxOf(sim);
    const props = ctx.content!.props;
    sim.step(idle(2));
    const [safe, atm, tree, pig] = sim.state.loot;
    ctx.events = [];
    expect(props.hammerHit(atm!.id, 1, 0)).toBe(true);
    expect(props.hammerHit(tree!.id, 1, Math.PI)).toBe(true);
    expect(props.hammerHit(pig!.id, 2, 0)).toBe(true);
    expect(props.hammerHit(safe!.id, 1, 0)).toBe(false);
    expect(atm!.unanchorProgress).toBeCloseTo(0.5);
    expect(atm!.innerValue).toBe(70);
    expect(tree!.unanchorProgress).toBeCloseTo(0.4);
    expect(tree!.innerValue).toBe(100);
    expect(pig!.cracks).toBe(2);
    expect(pig!.lastHolder).toBe(2);
    expect(ofType(ctx.events, 'propHit').map((e) => [e.lootId, e.how, e.coins])).toEqual([
      [atm!.id, 'hammer', 3],
      [tree!.id, 'hammer', 2],
      [pig!.id, 'hammer', 0],
    ]);
    // the ATM's progress crossed 1/3: the next tick spurts 2 more
    const evs = sim.step(idle(2));
    expect(ofType(evs, 'coinSpawn').filter((e) => e.source === 'spurt').length).toBe(1);
    expect(atm!.innerValue).toBe(50);
    expect(atm!.estimatedValue).toBe(atm!.baseValue + atm!.innerValue!);
    // a hazard is the piggy's third crack
    ctx.events = [];
    expect(props.hazardHit(pig!.id)).toBe(true);
    expect(pig!.recovered).toBe(true);
    expect(ofType(ctx.events, 'piggyCrack')[0]).toMatchObject({ cracks: 3, smashed: true });
    sim.step(idle(2));
    expect(conserved(sim)).toBe(true);
  });

  it('an emptied shell still pays its shell value when recovered', () => {
    const sim = propSim([{ variant: 'atm', pos: { x: 20, y: 30 }, angle: 0 }]);
    const ctx = ctxOf(sim);
    sim.step(idle(2));
    const atm = sim.state.loot[0]!;
    for (let k = 0; k < 4; k++) ctx.content!.props.hammerHit(atm.id, 1, Math.PI);
    sim.step(idle(2));
    expect(atm.innerValue).toBe(0);
    sim.debug.teleport(atm.id, { x: 10, y: 30 });
    const evs = play(sim, 120, () => idle(2));
    expect(ofType(evs, 'recovered')[0]).toMatchObject({ lootId: atm.id, value: 100, innerValue: 0, variant: 'atm' });
  });
});

describe('determinism and mirror symmetry', () => {
  /** Mirrored kick + mirrored bonk: mirrored piles. */
  function scene(mirror: boolean): { piles: Vec2[]; evs: string } {
    const mx = (x: number): number => (mirror ? 100 - x : x);
    const sim = propSim([
      { variant: 'atm', pos: { x: mx(30), y: 30 }, angle: mirror ? Math.PI : 0 },
      { variant: 'piggy', pos: { x: mx(40), y: 20 }, angle: 0 },
    ]);
    sim.debug.teleport(1, { x: mx(27.5), y: 30 }, mirror ? Math.PI : 0);
    sim.debug.teleport(2, { x: mx(38.4), y: 20 }, mirror ? Math.PI : 0);
    const d = mirror ? -1 : 1;
    const evs = play(sim, 120, (t) => (t === 0 ? [dash(d), cmd()] : t === 30 ? [cmd(), dash(d)] : idle(2)));
    return { piles: sim.state.coins.map((p) => ({ x: mx(p.pos.x), y: p.pos.y })), evs: JSON.stringify(ofType(evs, 'propHit').map((e) => [e.how, e.coins])) };
  }

  it('mirrored hits give mirrored piles; same inputs give identical logs', () => {
    const a = scene(false);
    const b = scene(true);
    expect(a.evs).toBe(b.evs);
    expect(a.piles.length).toBe(2);
    const order = (p: Vec2, q: Vec2): number => p.y - q.y || p.x - q.x;
    a.piles.sort(order);
    b.piles.sort(order);
    for (let i = 0; i < a.piles.length; i++) {
      expect(b.piles[i]!.x).toBeCloseTo(a.piles[i]!.x, 6);
      expect(b.piles[i]!.y).toBeCloseTo(a.piles[i]!.y, 6);
    }
    expect(JSON.stringify(scene(false))).toBe(JSON.stringify(a));
  });

  /** Piggy on the mirror axis (x = 50), smashed by `smash`; coin piles once they come to rest. */
  function piggySmash(smash: (ctx: SimContext, id: number) => void): { piles: { x: number; y: number; v: number }[]; west: number; east: number } {
    const sim = propSim([{ variant: 'piggy', pos: { x: 50, y: 30 }, angle: Math.PI / 2 }]);
    smash(ctxOf(sim), sim.state.loot[0]!.id);
    play(sim, 180, () => idle(2));
    const piles = sim.state.coins.map((c) => ({ x: c.pos.x - 50, y: c.pos.y - 30, v: c.value }));
    let west = 0;
    let east = 0;
    for (const p of piles) {
      if (p.x < -1e-6) west += p.v;
      else if (p.x > 1e-6) east += p.v;
    }
    expect(piles.reduce((a, p) => a + p.v, 0)).toBe(300);
    return { piles, west, east };
  }

  it('the piggy jackpot (mixed 10s and 50s) is mirror-symmetric: hazard smash splits evenly, mirrored hammers mirror', () => {
    const hz = piggySmash((ctx, id) => {
      for (let k = 0; k < 3; k++) ctx.content!.props.hazardHit(id, null);
    });
    expect(hz.west).toBe(hz.east);
    // each bill has a mirrored bill
    const bills = hz.piles.filter((p) => p.v === 50);
    expect(bills.length).toBe(4);
    for (const b of bills) expect(bills.some((q) => Math.abs(q.x + b.x) < 1e-6 && Math.abs(q.y - b.y) < 1e-6)).toBe(true);
    // team 0 aims θ, team 1 aims π − θ (after a crack each): mirrored piles, values included
    for (const th of [0.3, 1.1, -2.0]) {
      const a = piggySmash((ctx, id) => {
        ctx.content!.props.crackPiggy(id, 1, 1);
        ctx.content!.props.hammerHit(id, 1, th);
      });
      const b = piggySmash((ctx, id) => {
        ctx.content!.props.crackPiggy(id, 1, 2);
        ctx.content!.props.hammerHit(id, 2, Math.PI - th);
      });
      expect([b.west, b.east]).toEqual([a.east, a.west]);
      const key = (p: { x: number; y: number; v: number }): string => `${p.v}@${p.x.toFixed(5)},${p.y.toFixed(5)}`;
      const am = a.piles.map((p) => key({ x: -p.x, y: p.y, v: p.v })).sort();
      expect(b.piles.map(key).sort()).toEqual(am);
    }
  });

  it('mirrorValues: pattern partners always carry equal values', () => {
    for (const pattern of ['fan', 'radial'] as const) {
      for (let n50 = 0; n50 <= 6; n50++) {
        for (let n10 = 0; n10 <= 12; n10++) {
          for (const prefer of [10, 50] as const) {
            const v = mirrorValues(n50, n10, pattern, prefer);
            const n = v.length;
            const c50 = v.filter((x) => x === 50).length;
            // nothing invented; at most one pile held back (an even fan with odd counts)
            expect(c50).toBeLessThanOrEqual(n50);
            expect(n - c50).toBeLessThanOrEqual(n10);
            expect(n50 + n10 - n).toBe(pattern === 'fan' && (n50 + n10) % 2 === 0 && n50 % 2 === 1 ? 1 : 0);
            for (let i = 0; i < n; i++) expect(v[i]).toBe(v[pattern === 'fan' ? n - 1 - i : (n - i) % n]);
          }
        }
      }
    }
    expect(mirrorValues(4, 10, 'radial', 50)).toEqual([50, 10, 10, 10, 50, 10, 10, 50, 10, 10, 50, 10, 10, 10]);
  });

  it('PROP_RULES stay within the plan (ATM 4 spurt coins + bonk 2 + hammer 3 <= 10 inside)', () => {
    expect(PROP_RULES.atm.spurtAt.length * PROP_RULES.atm.spurtCoins).toBe(4);
    expect(PROP_SPECS.atm.inner.c10).toBe(10);
  });
});
