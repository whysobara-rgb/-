/**
 * [C1] Content 2.0 invariant fuzz (content-plan §3.5, §6 C1): full matches with the rules defaults
 * (items 'on', events 'on', gimmicks true), police on, 2:2, on every layout with a v2 composition —
 * the real maps' `layout.v2` (C4: props, gimmicks, breakables) where attached, else a test
 * composition (their classic safes + mirrored crates / vending machines), plus the full fixture.
 * While the event system is still the day-0 stub (C5 not landed: no event plan), an EventStandIn
 * pours a 400 event out of `pendingValue` through ring / fan bursts the way C5 will, so the event
 * value path (pending value in remainingValue, ring spawns, early decision and "모두 털림" with
 * pending value) is covered; the real events replace it automatically once C5 lands. Each run prints
 * which systems were live and the coin value per spawn source. Drivers: a coin-hungry fuzz driver
 * (scoops piles, smashes breakables, deposits, dashes at rivals, random chaos) and the real bots.
 *
 * Checked every tick: conservation against state.totalValue captured at tick 0 (and the live
 * recomputation), scores only move by this tick's recoveries + deposits, bags in [0, bagCap] in 10s,
 * piles 10 / 50 with unique ascending ids, finite and inside the arena, breakables consistent,
 * "모두 털림" only with nothing left anywhere; plus determinism (same seed -> identical event log)
 * and the step-time budget with 150 piles.
 *
 * Seeds: C1_FUZZ_SEEDS per layout (default 3; the acceptance run uses 50 x 4 layouts = 200 full matches).
 */
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../src/ai/harness';
import { BREAKABLE_SPECS, CHARACTER, COINS } from '../../src/sim/config';
import type { SimContext } from '../../src/sim/context';
import { LAYOUTS, MATCH_LAYOUT_IDS } from '../../src/sim/layouts/index';
import { circleOverlapsOBB, createRng } from '../../src/sim/math';
import { computeRemainingValue, isAllRecovered } from '../../src/sim/rules';
import { Simulation } from '../../src/sim/sim';
import type { BreakableDef, Command, LayoutDef, OBB, RuleConfig, SimEvent, SimState, TeamId, Vec2 } from '../../src/sim/types';
import { FuzzDriver } from './fixtures/fuzzbot';
import { fullLayout, makeSetup } from './fixtures/layouts';

const ctxOf = (sim: Simulation): SimContext => (sim as unknown as { ctx: SimContext }).ctx;
const SEEDS = Number(process.env.C1_FUZZ_SEEDS ?? 3);

// ---------------------------------------------------------------------------------------------
// Test compositions
// ---------------------------------------------------------------------------------------------

/**
 * `layout` with a v2 composition: its own `v2` if it has one, else its classic safes plus mirrored
 * breakables (per side 2 crates + 1 vending machine near the spawns, 1 crate further out) placed on
 * free ground found by search.
 */
function withTestV2(layout: LayoutDef): LayoutDef {
  if (layout.v2) return layout;
  const probe = new Simulation(makeSetup(layout, [0, 1], { content: 'classic' }));
  const axis = layout.size.x / 2;
  const mirror = (p: Vec2): Vec2 => ({ x: 2 * axis - p.x, y: p.y });
  const picked: Vec2[] = [];
  const ok = (p: Vec2): boolean => {
    if (p.x < 3 || p.y < 3 || p.x > layout.size.x - 3 || p.y > layout.size.y - 3) return false;
    if (Math.abs(p.x - axis) < 2.5) return false;
    for (const q of [p, mirror(p)]) {
      if (!probe.isFree(q, 1.4)) return false;
      for (const l of probe.state.loot) if (Math.hypot(l.pos.x - q.x, l.pos.y - q.y) < (l.kind === 'bank' ? 7 : 2.5)) return false;
      for (const z of layout.zones) if (Math.abs(q.x - z.center.x) < z.half.x + 2 && Math.abs(q.y - z.center.y) < z.half.y + 2) return false;
      for (const s of picked) if (Math.hypot(s.x - q.x, s.y - q.y) < 3) return false;
    }
    return true;
  };
  const spawn = layout.spawns.find((s) => s.team === 0)!;
  const homeSide = spawn.pos.x < axis ? 1 : -1;
  const out: BreakableDef[] = [];
  const kinds: ('crate' | 'vending')[] = ['crate', 'vending', 'crate', 'crate'];
  for (let k = 0; k < kinds.length; k++) {
    const rMin = k < 3 ? 5 : 12;
    let found: Vec2 | null = null;
    for (let r = rMin; r <= rMin + 10 && !found; r += 0.5) {
      for (let a = 0; a < 48 && !found; a++) {
        const ang = (a / 48) * Math.PI * 2;
        const p = { x: spawn.pos.x + Math.cos(ang) * r, y: spawn.pos.y + Math.sin(ang) * r };
        // stay on the team's half
        if ((p.x - axis) * homeSide > 0) continue;
        if (ok(p)) found = p;
      }
    }
    if (!found) continue;
    picked.push(found, mirror(found));
    const kind = kinds[k]!;
    const half = { ...BREAKABLE_SPECS[kind].half };
    out.push({ id: `t.${kind}.${k}.w`, kind, center: found, half, angle: 0 });
    out.push({ id: `t.${kind}.${k}.e`, kind, center: mirror(found), half, angle: 0 });
  }
  return {
    ...layout,
    v2: { safes: layout.safes, props: [], breakables: out, gimmicks: [], itemPads: [], eventSpots: [{ x: axis, y: layout.size.y / 2 }] },
  };
}

function fuzzLayouts(): { name: string; layout: LayoutDef }[] {
  const list = [{ name: 'fixture', layout: withTestV2(fullLayout()) }];
  for (const id of MATCH_LAYOUT_IDS) list.push({ name: id, layout: withTestV2(LAYOUTS[id]) });
  return list;
}

// ---------------------------------------------------------------------------------------------
// Coin-hungry driver
// ---------------------------------------------------------------------------------------------

type Mode = 'base' | 'scoop' | 'smash' | 'deposit' | 'hunt';

class CoinFuzzDriver {
  private readonly base: FuzzDriver;
  private readonly rng: () => number;
  private readonly mode: Mode[];
  private readonly modeTicks: number[];
  private readonly prevDash: boolean[];

  constructor(
    private readonly sim: Simulation,
    seed: number,
  ) {
    this.base = new FuzzDriver(sim, seed);
    this.rng = createRng((seed * 7919 + 13) >>> 0);
    const n = sim.state.characters.length;
    this.mode = new Array<Mode>(n).fill('base');
    this.modeTicks = new Array<number>(n).fill(0);
    this.prevDash = new Array<boolean>(n).fill(false);
  }

  commands(): Command[] {
    const sim = this.sim;
    const st = sim.state;
    const r = this.rng;
    const baseCmds = this.base.commands();
    return st.characters.map((ch, slot) => {
      if (--this.modeTicks[slot]! <= 0) {
        const x = r();
        this.mode[slot] = x < 0.35 ? 'base' : x < 0.55 ? 'scoop' : x < 0.7 ? 'smash' : x < 0.85 ? 'deposit' : 'hunt';
        this.modeTicks[slot] = 60 + Math.floor(r() * 300);
      }
      const mode = this.mode[slot]!;
      const go = (to: Vec2, dashNear = 0, aim: Vec2 | null = null): Command => {
        const dx = to.x - ch.pos.x + (r() - 0.5) * 0.6;
        const dy = to.y - ch.pos.y + (r() - 0.5) * 0.6;
        const d = Math.hypot(dx, dy) || 1;
        // rising dash edges only every other tick at most
        let dash = dashNear > 0 && d < dashNear && !this.prevDash[slot] && r() < 0.3;
        if (r() < 0.004) dash = !this.prevDash[slot];
        this.prevDash[slot] = dash;
        return { move: { x: dx / d, y: dy / d }, grab: false, dash, aim, ping: null };
      };
      if (ch.grab || mode === 'base') {
        const c = baseCmds[slot]!;
        this.prevDash[slot] = c.dash;
        return c;
      }
      if (mode === 'scoop' && st.coins.length) {
        let best = st.coins[0]!;
        let bd = Infinity;
        for (const p of st.coins) {
          const d = Math.hypot(p.pos.x - ch.pos.x, p.pos.y - ch.pos.y);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        return go(best.pos);
      }
      if (mode === 'smash') {
        const live = st.breakables.filter((b) => !b.broken);
        if (live.length) {
          let best = live[0]!;
          let bd = Infinity;
          for (const b of live) {
            const d = Math.hypot(b.center.x - ch.pos.x, b.center.y - ch.pos.y);
            if (d < bd) {
              bd = d;
              best = b;
            }
          }
          return go(best.center, 2.2);
        }
      }
      if (mode === 'deposit' && (ch.bag ?? 0) > 0) {
        const z = sim.layout.zones.find((zz) => zz.team === ch.team)!;
        return go(z.center);
      }
      if (mode === 'hunt') {
        // dash at the richest opposing bag in reach of the eye
        let best: SimState['characters'][number] | null = null;
        for (const o of st.characters) if (o.team !== ch.team && (o.bag ?? 0) > 0 && (!best || (o.bag ?? 0) > (best.bag ?? 0))) best = o;
        if (best) return go(best.pos, 2.0);
      }
      const c = baseCmds[slot]!;
      this.prevDash[slot] = c.dash;
      return c;
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Invariant checker
// ---------------------------------------------------------------------------------------------

interface FuzzStats {
  ticks: number;
  violations: string[];
  spawned: number;
  pickups: number;
  banked: number;
  spills: number;
  spilledValue: number;
  broken: number;
  tackles: number;
  maxPiles: number;
  end: string | null;
  /** Coin value spawned per CoinSpawnSource. */
  bySource: Record<string, number>;
}

class InvariantChecker {
  readonly stats: FuzzStats = { ticks: 0, violations: [], spawned: 0, pickups: 0, banked: 0, spills: 0, spilledValue: 0, broken: 0, tackles: 0, maxPiles: 0, end: null, bySource: {} };
  private readonly total0: number;
  private prevScores: [number, number];
  private lastCoinId = 0;

  constructor(private readonly sim: Simulation) {
    const st = sim.state;
    this.total0 = st.totalValue;
    this.prevScores = [...st.scores] as [number, number];
    if (st.totalValue !== computeRemainingValue(st)) this.fail(`tick 0: totalValue ${st.totalValue} != recomputed ${computeRemainingValue(st)}`);
  }

  private fail(msg: string): void {
    if (this.stats.violations.length < 20) this.stats.violations.push(msg);
  }

  check(evs: SimEvent[]): void {
    const sim = this.sim;
    const st = sim.state;
    const s = this.stats;
    const t = st.tick;
    s.ticks++;
    if (st.totalValue !== this.total0) this.fail(`t${t}: totalValue changed ${this.total0} -> ${st.totalValue}`);
    if (st.scores[0] + st.scores[1] + st.remainingValue !== this.total0) this.fail(`t${t}: conservation ${st.scores} + ${st.remainingValue} != ${this.total0}`);
    const live = computeRemainingValue(st);
    if (live !== st.remainingValue) this.fail(`t${t}: remainingValue ${st.remainingValue} != recomputed ${live}`);
    const gain: [number, number] = [0, 0];
    for (const e of evs) {
      if (e.type === 'recovered') gain[e.team] += e.value;
      else if (e.type === 'coinsBanked') {
        gain[e.team] += e.value;
        s.banked += e.value;
        const ch = st.characters[e.charId - 1]!;
        if (ch.team !== e.team) this.fail(`t${t}: coinsBanked team mismatch`);
      } else if (e.type === 'coinSpawn') {
        s.spawned += e.total;
        s.bySource[e.source] = (s.bySource[e.source] ?? 0) + e.total;
        let sum = 0;
        for (const id of e.ids) {
          if (id <= this.lastCoinId) this.fail(`t${t}: coin id ${id} not ascending (last ${this.lastCoinId})`);
          this.lastCoinId = Math.max(this.lastCoinId, id);
          const p = st.coins.find((c) => c.id === id);
          if (p) sum += p.value;
        }
        if (e.ids.length === 0) this.fail(`t${t}: empty coinSpawn`);
        void sum;
      } else if (e.type === 'coinPickup') s.pickups += e.value;
      else if (e.type === 'bagSpilled') {
        s.spills++;
        s.spilledValue += e.value;
        if (e.value <= 0 || e.value % COINS.coin !== 0) this.fail(`t${t}: bad spill ${e.value}`);
      } else if (e.type === 'breakableBroken') s.broken++;
      else if (e.type === 'policeTackle' && e.hit) s.tackles++;
      else if (e.type === 'matchEnd') {
        s.end = e.result.reason;
        if (e.result.reason === 'allRecovered' && !isAllRecovered(st)) this.fail(`t${t}: allRecovered with value left`);
        if (e.result.reason === 'decided') {
          const [a, b] = e.result.scores;
          if (!(Math.max(a, b) > Math.min(a, b) + st.remainingValue)) this.fail(`t${t}: decided without a strict lead`);
        }
        if (e.result.winner === null && e.result.scores[0] !== e.result.scores[1]) this.fail(`t${t}: draw with unequal scores`);
      }
    }
    for (const team of [0, 1] as const) {
      if (st.scores[team] - this.prevScores[team] !== gain[team]) this.fail(`t${t}: team ${team} score moved ${this.prevScores[team]} -> ${st.scores[team]} with settlements ${gain[team]}`);
    }
    this.prevScores = [...st.scores] as [number, number];
    for (const ch of st.characters) {
      const bag = ch.bag ?? 0;
      if (bag < 0 || bag > COINS.bagCap || bag % COINS.coin !== 0) this.fail(`t${t}: bag ${bag} of ${ch.id}`);
      const dt = ch.depositTicks ?? 0;
      if (dt < 0 || dt > COINS.depositTicks) this.fail(`t${t}: depositTicks ${dt}`);
    }
    s.maxPiles = Math.max(s.maxPiles, st.coins.length);
    const size = sim.layout.size;
    const ids = new Set<number>();
    for (const p of st.coins) {
      if (p.value !== 10 && p.value !== 50) this.fail(`t${t}: pile value ${p.value}`);
      if (ids.has(p.id)) this.fail(`t${t}: duplicate pile id ${p.id}`);
      ids.add(p.id);
      if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y) || !Number.isFinite(p.vel.x) || !Number.isFinite(p.vel.y)) this.fail(`t${t}: non-finite pile ${p.id}`);
      if (p.pos.x < 0 || p.pos.y < 0 || p.pos.x > size.x || p.pos.y > size.y) this.fail(`t${t}: pile ${p.id} outside the arena`);
    }
    for (const b of st.breakables) {
      if (b.innerValue < 0 || b.innerValue % COINS.coin !== 0) this.fail(`t${t}: breakable ${b.id} inner ${b.innerValue}`);
      if (b.broken !== (b.hp === 0)) this.fail(`t${t}: breakable ${b.id} broken ${b.broken} hp ${b.hp}`);
      if (b.broken && b.innerValue !== 0) this.fail(`t${t}: broken breakable ${b.id} kept ${b.innerValue}`);
    }
  }
}

/**
 * No pile is ever stranded: for every pile there is a spot within pickupRadius where a raccoon fits
 * against the statics (boundary, buildings, vans, intact fences, unbroken breakables).
 */
function checkReachable(sim: Simulation, stats: FuzzStats): void {
  const boxes: OBB[] = [...sim.staticOBBs(), ...sim.state.fences.filter((f) => !f.broken)];
  const circles = sim.staticCircles();
  const R = CHARACTER.radius;
  const fits = (p: Vec2): boolean => {
    for (const o of boxes) if (circleOverlapsOBB(p, R, o)) return false;
    for (const c of circles) if (Math.hypot(p.x - c.center.x, p.y - c.center.y) < c.radius + R) return false;
    return true;
  };
  for (const pile of sim.state.coins) {
    let ok = false;
    for (let r = 0; r <= COINS.pickupRadius - 0.05 && !ok; r += 0.1) {
      for (let k = 0; k < 24 && !ok; k++) {
        const a = (k / 24) * Math.PI * 2;
        if (fits({ x: pile.pos.x + Math.cos(a) * r, y: pile.pos.y + Math.sin(a) * r })) ok = true;
      }
    }
    if (!ok && stats.violations.length < 20) stats.violations.push(`t${sim.state.tick}: pile ${pile.id} at (${pile.pos.x.toFixed(2)}, ${pile.pos.y.toFixed(2)}) unreachable`);
  }
}

/**
 * Stand-in for the C5 loot events while events.ts is the day-0 stub (events 'on' but no plan):
 * one 400 event per match (seeded: 돈비 or 수송차) added as a MatchEventState with pendingValue
 * before tick 0 (totalValue adjusted), poured out exactly as content-plan §5.4 describes —
 * 돈비: 'ring' bursts (6–9 m) of five 동전 10 / one 지폐 50 around the axis spot every 0.5 s;
 * 수송차: 'fan' bursts of 지폐 50 from a point driving along the axis. Value only moves
 * pendingValue -> piles in the same tick. Inactive once the real event system makes a plan.
 */
class EventStandIn {
  readonly active: boolean;
  private readonly kind: 'moneyRain' | 'cashTruck';
  private readonly start: number;
  private burst = 0;

  constructor(
    private readonly sim: Simulation,
    seed: number,
  ) {
    const st = sim.state;
    const v2 = sim.layout.v2;
    this.active = !!v2 && sim.rules.events === 'on' && st.eventPlan === null && st.matchEvents.length === 0;
    const r = createRng((seed * 104729 + 7) >>> 0);
    this.kind = r() < 0.5 ? 'moneyRain' : 'cashTruck';
    this.start = 1800 + Math.floor(r() * 3600);
    if (!this.active) return;
    const spot = v2!.eventSpots[0] ?? { x: sim.layout.size.x / 2, y: sim.layout.size.y / 2 };
    st.matchEvents.push({ kind: this.kind, phase: 'scheduled', startTick: this.start, pos: { x: spot.x, y: spot.y }, pendingValue: 400 });
    st.totalValue += 400;
    st.remainingValue += 400;
  }

  /** After each step (the slot of ContentSystems.postTick): pour out the pending value. */
  tick(): void {
    if (!this.active) return;
    const st = this.sim.state;
    const ev = st.matchEvents[st.matchEvents.length - 1]!;
    if (st.over || st.tick < this.start || ev.pendingValue <= 0 || (st.tick - this.start) % 30 !== 0) return;
    ev.phase = 'active';
    const coins = ctxOf(this.sim).content!.coins;
    const k = this.burst++;
    if (this.kind === 'moneyRain') {
      const values: (10 | 50)[] = k % 2 === 0 ? [10, 10, 10, 10, 10] : [50];
      ev.pendingValue -= 50;
      coins.spawnCoins({ pos: ev.pos, dir: k * 0.7, values, pattern: 'ring', source: 'rain', sourceId: null, byCharId: null, ring: { min: 6, max: 9 } });
    } else {
      const H = this.sim.layout.size.y;
      const y = 2 + ((k * 3) % Math.max(4, H - 4));
      ev.pendingValue -= 100;
      coins.spawnCoins({ pos: { x: ev.pos.x, y }, dir: k % 2 ? 0 : Math.PI, values: [50, 50], pattern: 'fan', source: 'truck', sourceId: null, byCharId: null });
    }
    if (ev.pendingValue <= 0) ev.phase = 'done';
  }
}

interface FuzzRun {
  stats: FuzzStats;
  log: string;
  /** Which systems were live: props / gimmicks / breakables in the v2 composition, real event plan, stand-in. */
  live: { props: number; gimmicks: number; breakables: number; realEvents: boolean; standIn: boolean };
}

function fuzzMatch(layout: LayoutDef, seed: number, rules: Partial<RuleConfig> = {}, teams: TeamId[] = [0, 0, 1, 1]): FuzzRun {
  const setup = { ...makeSetup(layout, teams, { content: 'v2', police: true, ...rules }), seed };
  const sim = new Simulation(setup);
  const standIn = new EventStandIn(sim, seed);
  const driver = new CoinFuzzDriver(sim, seed);
  const check = new InvariantChecker(sim);
  const maxTicks = sim.rules.matchTicks + 60;
  for (let t = 0; t < maxTicks && !sim.state.over; t++) {
    const evs = sim.step(driver.commands());
    standIn.tick(); // emits into this step's event array
    check.check(evs);
    if (sim.state.tick % 600 === 0) checkReachable(sim, check.stats);
  }
  checkReachable(sim, check.stats);
  const v2 = sim.layout.v2!;
  return {
    stats: check.stats,
    log: JSON.stringify(sim.eventLog),
    live: { props: v2.props.length, gimmicks: sim.rules.gimmicks ? v2.gimmicks.length : 0, breakables: v2.breakables.length, realEvents: sim.state.eventPlan !== null, standIn: standIn.active },
  };
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('Content 2.0 invariant fuzz (v2, every system on, police on, 2:2)', () => {
  const layouts = fuzzLayouts();

  it('the test compositions are mirrored and add value only through breakables', () => {
    for (const { name, layout } of layouts) {
      const v2 = layout.v2!;
      const axis = layout.size.x / 2;
      expect(v2.breakables.length, name).toBeGreaterThanOrEqual(4);
      for (const b of v2.breakables) {
        const twin = v2.breakables.find((o) => o !== b && o.kind === b.kind && Math.abs(o.center.x - (2 * axis - b.center.x)) < 1e-9 && o.center.y === b.center.y);
        expect(twin, `${name} ${b.id}`).toBeDefined();
      }
    }
  });

  for (const { name, layout } of layouts) {
    it(`${name}: ${SEEDS} full fuzz matches, 0 violations`, () => {
      const agg = { spawned: 0, pickups: 0, banked: 0, spills: 0, spilledValue: 0, broken: 0, tackles: 0, maxPiles: 0, ticks: 0, ends: {} as Record<string, number> };
      const bySource: Record<string, number> = {};
      let live: FuzzRun['live'] | null = null;
      let realEvents = 0;
      let standIns = 0;
      for (let k = 0; k < SEEDS; k++) {
        const run = fuzzMatch(layout, 1000 + k * 37);
        const { stats } = run;
        live = run.live;
        if (run.live.realEvents) realEvents++;
        if (run.live.standIn) standIns++;
        for (const [src, v] of Object.entries(stats.bySource)) bySource[src] = (bySource[src] ?? 0) + v;
        expect(stats.violations, `${name} seed ${1000 + k * 37}`).toEqual([]);
        agg.spawned += stats.spawned;
        agg.pickups += stats.pickups;
        agg.banked += stats.banked;
        agg.spills += stats.spills;
        agg.spilledValue += stats.spilledValue;
        agg.broken += stats.broken;
        agg.tackles += stats.tackles;
        agg.ticks += stats.ticks;
        agg.maxPiles = Math.max(agg.maxPiles, stats.maxPiles);
        agg.ends[stats.end ?? 'none'] = (agg.ends[stats.end ?? 'none'] ?? 0) + 1;
      }
      // eslint-disable-next-line no-console
      console.log(`[content-fuzz] ${name}: ${SEEDS} matches ${agg.ticks} ticks, coins spawned ${agg.spawned} picked ${agg.pickups} banked ${agg.banked}, spills ${agg.spills} (${agg.spilledValue}), breakables broken ${agg.broken}, police tackles ${agg.tackles}, max piles ${agg.maxPiles}, ends ${JSON.stringify(agg.ends)}`);
      // eslint-disable-next-line no-console
      console.log(`[content-fuzz] ${name}: live props ${live!.props} gimmicks ${live!.gimmicks} breakables ${live!.breakables}, real event plans ${realEvents}/${SEEDS}, event stand-ins ${standIns}/${SEEDS}; coin value by source ${JSON.stringify(bySource)}`);
      // event value reached the field one way or the other
      expect((bySource.rain ?? 0) + (bySource.truck ?? 0)).toBeGreaterThan(0);
      // the driver exercises every term of the economy
      expect(agg.spawned).toBeGreaterThan(0);
      expect(agg.pickups).toBeGreaterThan(0);
      expect(agg.banked).toBeGreaterThan(0);
      expect(agg.broken).toBeGreaterThan(0);
    });
  }

  it('items / events / gimmicks toggles and 1:1 keep the invariant too', () => {
    const layout = layouts[1]!.layout;
    for (const rules of [{ items: 'off' as const, events: 'off' as const, gimmicks: false }, { items: 'hammerOnly' as const }, { police: false }]) {
      const { stats } = fuzzMatch(layout, 4242, rules, [0, 1]);
      expect(stats.violations, JSON.stringify(rules)).toEqual([]);
    }
  });

  it('same seed -> identical event log, twice', () => {
    for (const { layout } of layouts.slice(0, 2)) {
      const a = fuzzMatch(layout, 777);
      const b = fuzzMatch(layout, 777);
      expect(a.log.length).toBeGreaterThan(1000);
      expect(b.log).toBe(a.log);
    }
  });

  it('real bots on every map (v2 test composition, police on): 0 invariant violations', () => {
    for (const id of MATCH_LAYOUT_IDS) {
      const layout = withTestV2(LAYOUTS[id]);
      let checker: InvariantChecker | null = null;
      const stats = runMatch({
        layout,
        team0: [
          { personality: 'hodadak', difficulty: 'normal' },
          { personality: 'tongkeun', difficulty: 'normal' },
        ],
        team1: [
          { personality: 'nunchi', difficulty: 'normal' },
          { personality: 'hodadak', difficulty: 'normal' },
        ],
        seed: 31 + id.length,
        rules: { content: 'v2', police: true },
        onTick: (sim, evs) => {
          checker ??= new InvariantChecker(sim);
          checker.check(evs);
        },
      });
      expect(stats.invariantViolations).toBe(0);
      expect(checker!.stats.violations, id).toEqual([]);
    }
  });
});

describe('performance', () => {
  it('sim step median with 150 loose piles in 2:2 (v2, police on)', () => {
    const layout = withTestV2(LAYOUTS.plaza);
    const sim = new Simulation({ ...makeSetup(layout, [0, 0, 1, 1], { content: 'v2', police: true }), seed: 5 });
    const ctx = ctxOf(sim);
    // 150 piles moved out of the largest outdoor safe's shell (value-conserving), spread over the map
    const safe = sim.state.loot.filter((l) => l.kind === 'largeSafe' && l.homeBank === null)[0]!;
    safe.baseValue -= 1500;
    safe.estimatedValue -= 1500;
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * Math.PI * 2;
      const pos = { x: layout.size.x / 2 + Math.cos(a) * (6 + (i % 7) * 2), y: layout.size.y / 2 + Math.sin(a) * (4 + (i % 5) * 2) };
      ctx.content!.coins.spawnCoins({ pos, dir: a, values: [10], pattern: 'fan', source: 'rain', sourceId: null, byCharId: null });
    }
    // nobody near the piles: characters idle in their zones so the piles stay on the field
    for (const ch of sim.state.characters) sim.debug.teleport(ch.id, sim.layout.zones.find((z) => z.team === ch.team)!.center);
    const idle: Command[] = sim.state.characters.map(() => ({ move: { x: 0, y: 0 }, grab: false, dash: false, aim: null, ping: null }));
    for (let t = 0; t < 120; t++) sim.step(idle);
    const times: number[] = [];
    const busy: Command[] = sim.state.characters.map((_, i) => ({ move: { x: Math.cos(i), y: Math.sin(i) }, grab: false, dash: false, aim: null, ping: null }));
    for (let t = 0; t < 600; t++) {
      // keep piles sliding half the time (belts / fountain will do this in v2)
      if (t % 60 === 0) for (const p of sim.state.coins) p.vel = { x: Math.cos(p.id) * 3, y: Math.sin(p.id) * 3 };
      const t0 = performance.now();
      sim.step(t % 120 < 60 ? idle : busy);
      times.push(performance.now() - t0);
    }
    expect(sim.state.coins.length).toBeGreaterThanOrEqual(140);
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1]!;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    // eslint-disable-next-line no-console
    console.log(`[content-fuzz perf] ${sim.state.coins.length} piles, 2:2 police on: step median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`);
    expect(median).toBeLessThan(3); // budget 1.0 ms on the reference machine (reported); generous for CI noise
    expect(sim.state.scores[0] + sim.state.scores[1] + sim.state.remainingValue).toBe(sim.state.totalValue);
  });
});
